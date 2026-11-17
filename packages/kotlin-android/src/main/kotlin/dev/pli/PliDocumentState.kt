package dev.pli

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * A document for your own screens: the engine's [PliDocument] plus what a composable needs, kept up to date. Every change goes
 * through [perform], which makes it and reads the document again, so views only draw what the document says.
 *
 * ```kotlin
 * val state = rememberPliDocumentState(json = saved)
 * state.onChange = { json -> save(json) }
 *
 * Column {
 *     PliBlocks(state, Modifier.weight(1f))     // the document, with its formatting, editable
 *     PliToolbar(state)                          // buttons and menus for the selection
 * }
 * Button(onClick = { state.perform { toggleBold() } }) { Text("Bold") }   // or any command, from your own button
 * ```
 *
 * Call everything here on the main thread. The engine is quick, and a keystroke is one call.
 */
class PliDocumentState(
    /** The engine's document. Use it to read, or to make changes through [perform]. */
    val document: PliDocument,
) {
    /** The blocks to draw, with their text in runs. */
    var blocks by mutableStateOf<List<PliContentBlock>>(emptyList())
        private set

    /** What a toolbar shows: which formatting is on at the selection, and so on. */
    var format by mutableStateOf(PliFormat())
        private set

    /** Where the caret or selection is. */
    var selection by mutableStateOf<PliSelection?>(null)
        private set

    /** The picture whose crop is being set, if any: it shows all of the picture with a grip on each edge. */
    var croppingPicture by mutableStateOf<String?>(null)
        private set

    /** The block whose text field should take the keyboard, when the caret has moved there (after Enter, say). */
    var focusRequest by mutableStateOf<String?>(null)
        internal set

    /** True while a finger is dragging out a selection that may cross blocks. */
    var dragging by mutableStateOf(false)
        internal set

    /** When the last drag selection ended (nanoseconds), so the text field's own press, which ends at about the same time, can be told apart. */
    internal var dragEndedAt = 0L

    /** Where each text block is on screen and how its text is laid out, for working out what a touch is on. */
    internal class Hit {
        var coordinates: LayoutCoordinates? = null
        var layout: TextLayoutResult? = null

        /** Where line breaks were added to the drawn text, as offsets in the block's text (text beside a picture that text wraps around). */
        var inserted: List<Int> = emptyList()

        /** A place in the block's text, as an offset in the text that was laid out. */
        fun toLaid(original: Int): Int = original + inserted.count { it <= original }

        /** A place in the text that was laid out, as an offset in the block's text. */
        fun toOriginal(laid: Int): Int = (laid - inserted.indices.count { inserted[it] + it < laid }).coerceAtLeast(0)
    }

    internal val hits = HashMap<String, Hit>()

    /** The blocks that have text, in reading order, and how long each text is: what a selection across blocks is measured in. */
    private var order: List<Pair<String, Int>> = emptyList()
    private var index: Map<String, Int> = emptyMap()

    /** Called after each change, with the whole document as JSON, so you can save it. */
    var onChange: ((String) -> Unit)? = null

    /** Called when a command can't be done, with the engine's message. */
    var onError: ((String) -> Unit)? = null

    init {
        refresh()
    }

    /** Makes a change to the document, then reads it again. This is the one way to change what is on screen. */
    fun perform(change: PliDocument.() -> Unit): Boolean {
        val ok = try {
            document.change()
            // When a command moves the caret to another block (a table was inserted, an undo), the keyboard follows it.
            runCatching { document.selection() }.getOrNull()?.let { now -> if (now.focus.block != selection?.focus?.block) focusRequest = now.focus.block }
            true
        } catch (e: Exception) {
            onError?.invoke(e.message ?: e.toString())
            false
        }
        refresh()
        if (ok) onChange?.let { callback -> runCatching { document.json() }.getOrNull()?.let(callback) }
        return ok
    }

    /** Reads the blocks, the formatting and the selection again. */
    fun refresh() {
        runCatching { document.content() }.getOrNull()?.let { blocks = it }
        runCatching { document.format() }.getOrNull()?.let { format = it }
        selection = runCatching { document.selection() }.getOrNull()
        if (croppingPicture != null && format.image?.id != croppingPicture) croppingPicture = null
        val next = ArrayList<Pair<String, Int>>()
        fun collect(list: List<PliContentBlock>) {
            for (block in list) {
                if (block.isText) next.add(block.id to block.text.length)
                block.rows?.forEach { row -> row.cells.forEach { cell -> collect(cell.blocks) } }
            }
        }
        collect(blocks)
        order = next
        index = next.withIndex().associate { it.value.first to it.index }
    }

    // Selecting across blocks.

    /** True when the selection runs from one block to another. */
    val isMultiBlock: Boolean get() = selection?.let { it.anchor.block != it.focus.block } == true

    /** The part of a block's text that a selection across blocks covers, or null if it doesn't cover any of it (or the selection is in one block). */
    fun selectedRange(block: String): IntRange? {
        val s = selection ?: return null
        val a = index[s.anchor.block] ?: return null
        val f = index[s.focus.block] ?: return null
        val b = index[block] ?: return null
        if (a == f) return null
        val (first, last) = if (a <= f) s.anchor to s.focus else s.focus to s.anchor
        val low = minOf(a, f)
        val high = maxOf(a, f)
        if (b < low || b > high) return null
        val length = order[b].second
        val from = (if (b == low) first.offset else 0).coerceIn(0, length)
        val to = (if (b == high) last.offset else length).coerceIn(0, length)
        return from until maxOf(from, to)
    }

    /** The text block before or after another, with its text's length. */
    internal fun neighbor(block: String, step: Int): Pair<String, Int>? = index[block]?.let { order.getOrNull(it + step) }

    internal fun indexOf(block: String): Int? = index[block]

    internal fun length(block: String): Int = index[block]?.let { order[it].second } ?: 0

    /** Selects from one place to another, which may be in different blocks. Doesn't count as a change to the document. */
    fun selectRange(anchor: PliPoint, focus: PliPoint) {
        if (selection == PliSelection(anchor, focus)) return
        try {
            document.select(anchor.block, anchor.offset, focus.block, focus.offset)
        } catch (e: Exception) {
            onError?.invoke(e.message ?: e.toString())
        }
        refresh()
    }

    /** Selects the whole document. */
    fun selectAll() {
        runCatching { document.selectAll() }
        refresh()
    }

    /** The selected text, as plain text. */
    fun selectedText(): String = runCatching { document.selectedText() }.getOrDefault("")

    /** Removes the selected text, after [copy] has put it somewhere. */
    fun deleteSelection() {
        perform { deleteSelection() }
        focusRequest = selection?.focus?.block
    }

    /** Puts [text] in at the caret, over any selection. */
    fun paste(text: String) {
        if (text.isEmpty()) return
        perform { pasteText(text) }
        focusRequest = selection?.focus?.block
    }

    /** Types, splits or deletes over a selection that spans blocks. */
    internal fun replaceSelection(text: String) {
        perform {
            when {
                text.isEmpty() -> deleteSelection()
                text == "\n" -> splitBlock()
                text.contains('\n') -> pasteText(text)
                else -> typeText(text)
            }
        }
        focusRequest = selection?.focus?.block
    }

    /** The place in the text block nearest to a point in the window, for what a finger is touching. */
    internal fun hitAt(window: Offset): PliPoint? {
        var best: Triple<String, Hit, Float>? = null
        for ((id, hit) in hits) {
            val coordinates = hit.coordinates?.takeIf { it.isAttached } ?: continue
            val bounds = coordinates.boundsInWindow()
            val dx = maxOf(bounds.left - window.x, 0f, window.x - bounds.right)
            val dy = maxOf(bounds.top - window.y, 0f, window.y - bounds.bottom)
            val distance = kotlin.math.hypot(dx, dy)
            if (best == null || distance < best.third) best = Triple(id, hit, distance)
        }
        val (id, hit, _) = best ?: return null
        val layout = hit.layout ?: return null
        val local = hit.coordinates!!.windowToLocal(window)
        val offset = when {
            local.y <= 0f -> 0
            local.y >= layout.size.height -> length(id)
            else -> hit.toOriginal(layout.getOffsetForPosition(local))
        }
        return PliPoint(id, offset.coerceIn(0, length(id)))
    }

    /** Moves the caret to a place, in any block, and takes the keyboard there. */
    internal fun moveCaret(to: PliPoint) {
        selectRange(to, to)
        focusRequest = to.block
    }

    /** Where a selection's focus goes when it moves one step: a character, or a line. */
    private fun moved(focus: PliPoint, key: PliArrow): PliPoint? {
        val length = length(focus.block)
        return when (key) {
            PliArrow.Left -> if (focus.offset > 0) PliPoint(focus.block, focus.offset - 1) else neighbor(focus.block, -1)?.let { PliPoint(it.first, it.second) }
            PliArrow.Right -> if (focus.offset < length) PliPoint(focus.block, focus.offset + 1) else neighbor(focus.block, 1)?.let { PliPoint(it.first, 0) }
            PliArrow.Up, PliArrow.Down -> {
                val up = key == PliArrow.Up
                val hit = hits[focus.block] ?: return null
                val layout = hit.layout ?: return null
                val laid = hit.toLaid(focus.offset.coerceAtMost(length))
                val line = layout.getLineForOffset(laid)
                val x = layout.getHorizontalPosition(laid, true)
                if (up && line == 0 || !up && line == layout.lineCount - 1) {
                    val next = neighbor(focus.block, if (up) -1 else 1) ?: return PliPoint(focus.block, if (up) 0 else length)
                    crossing(x, next.first, atTop = !up)
                } else {
                    val target = layout.getOffsetForPosition(Offset(x, (if (up) layout.getLineTop(line) - 1f else layout.getLineBottom(line) + 1f)))
                    PliPoint(focus.block, hit.toOriginal(target))
                }
            }
        }
    }

    /** A place in another block, at the same distance from the left (for Up and Down). */
    private fun crossing(x: Float, block: String, atTop: Boolean): PliPoint {
        val hit = hits[block]
        val layout = hit?.layout ?: return PliPoint(block, if (atTop) 0 else length(block))
        return PliPoint(block, hit.toOriginal(layout.getOffsetForPosition(Offset(x, if (atTop) 1f else layout.size.height - 1f))).coerceIn(0, length(block)))
    }

    /**
     * An arrow key in a text field. It is handled here when it takes the caret out of the block, or changes a selection that spans
     * blocks; anything else is the text field's own business. [from] and [to] are the field's selection.
     */
    internal fun arrow(block: String, key: PliArrow, extend: Boolean, from: Int, to: Int): Boolean {
        val s = selection
        if (s != null && isMultiBlock) {
            if (extend) {
                moved(s.focus, key)?.let { selectRange(s.anchor, it) }
            } else {
                val a = index[s.anchor.block] ?: 0
                val f = index[s.focus.block] ?: 0
                val anchorFirst = a < f || a == f && s.anchor.offset <= s.focus.offset
                val backward = key == PliArrow.Left || key == PliArrow.Up
                moveCaret(if (backward == anchorFirst) s.anchor else s.focus)
            }
            return true
        }
        val low = minOf(from, to)
        val high = maxOf(from, to)
        val length = length(block)
        val hit = hits[block]
        val layout = hit?.layout
        when (key) {
            PliArrow.Left -> {
                if (low != 0 || !extend && high != low) return false
                val previous = neighbor(block, -1) ?: return false
                val end = PliPoint(previous.first, previous.second)
                if (extend) selectRange(PliPoint(block, high), end) else moveCaret(end)
            }
            PliArrow.Right -> {
                if (high != length || !extend && high != low) return false
                val next = neighbor(block, 1) ?: return false
                val start = PliPoint(next.first, 0)
                if (extend) selectRange(PliPoint(block, low), start) else moveCaret(start)
            }
            PliArrow.Up, PliArrow.Down -> {
                val up = key == PliArrow.Up
                layout ?: return false
                hit ?: return false
                val at = hit.toLaid(if (up) low else high)
                val line = layout.getLineForOffset(at)
                if (!(up && line == 0 || !up && line == layout.lineCount - 1) || !extend && high != low) return false
                val next = neighbor(block, if (up) -1 else 1) ?: return false
                val target = crossing(layout.getHorizontalPosition(at, true), next.first, atTop = !up)
                if (extend) selectRange(PliPoint(block, if (up) high else low), target) else moveCaret(target)
            }
        }
        return true
    }

    /** Tells the document where the caret is, from a text field. Doesn't change the text. */
    internal fun place(block: String, from: Int, to: Int) {
        val wanted = PliSelection(PliPoint(block, from), PliPoint(block, to))
        if (selection == wanted) return
        try {
            document.select(block, from, block, to)
            selection = document.selection()
            format = document.format()
        } catch (e: Exception) {
            onError?.invoke(e.message ?: e.toString())
        }
    }

    /** Replaces a range of a block's text (in UTF-16 units) with [text]. */
    internal fun replace(block: String, from: Int, to: Int, text: String) {
        val wanted = PliSelection(PliPoint(block, from), PliPoint(block, to))
        perform {
            // Moving the selection to where it already is would drop formatting that was switched on for the next characters.
            if (selection() != wanted) select(block, from, block, to)
            when {
                text.isEmpty() -> deleteSelection()
                text.contains('\n') -> pasteText(text)
                else -> typeText(text)
            }
        }
    }

    /** Enter at a place in a block. */
    internal fun split(block: String, from: Int, to: Int) {
        perform {
            select(block, from, block, to)
            splitBlock()
        }
        focusRequest = selection?.focus?.block
    }

    /** Backspace at the very start of a block. */
    internal fun backspaceAtStart(block: String) {
        if (isMultiBlock) {
            replaceSelection("")
            return
        }
        perform {
            select(block, 0, block, 0)
            backspace()
        }
        focusRequest = selection?.focus?.block
    }

    internal fun setCroppingPicture(id: String?) {
        croppingPicture = id
    }

    /** A block of the document by id, in a table cell too. */
    fun findBlock(id: String): PliContentBlock? {
        fun visit(list: List<PliContentBlock>): PliContentBlock? {
            for (b in list) {
                if (b.id == id) return b
                b.rows?.forEach { row -> row.cells.forEach { cell -> visit(cell.blocks)?.let { return it } } }
            }
            return null
        }
        return visit(blocks)
    }

    /** Puts the caret at the end of a block, and asks for the keyboard there. */
    fun focus(block: String) {
        val found = blocks.firstOrNull { it.id == block } ?: return
        val end = found.text.length
        perform { select(block, end, block, end) }
        focusRequest = block
    }

    /** Frees what the engine holds for the document. */
    fun close() = document.close()
}

/**
 * A [PliDocumentState] for a composable, made once and closed when it leaves the screen.
 *
 * @param json A saved document, or null for a new one.
 */
@Composable
fun rememberPliDocumentState(json: String? = null, title: String = "Untitled", user: PliUser? = null): PliDocumentState {
    val state = remember { PliDocumentState(PliDocument(json = json, title = title, user = user)) }
    DisposableEffect(state) { onDispose { state.close() } }
    return state
}

/** The arrow keys. */
internal enum class PliArrow { Left, Right, Up, Down }
