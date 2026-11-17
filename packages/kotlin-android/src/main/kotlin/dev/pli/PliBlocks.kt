package dev.pli

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.layout.Placeable
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.Layout
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.text.ParagraphStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import kotlinx.coroutines.android.awaitFrame
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * How a block's text looks on screen: the sizes and colours that go with each kind of block. Change what you need with `copy`:
 *
 * ```kotlin
 * PliBlocks(state, style = PliBlockStyle.default().copy(bodySize = 18.sp))
 * ```
 */
data class PliBlockStyle(
    /** The size of body text. */
    val bodySize: TextUnit = 17.sp,
    /** How much a document's own font sizes (in points) are scaled, so that 11 pt text sits comfortably next to [bodySize]. */
    val documentScale: Float = 17f / 11f,
    val textColor: Color = Color.Unspecified,
    val secondaryColor: Color = Color.Gray,
    val linkColor: Color = Color(0xFF1D4ED8),
) {
    companion object {
        /** The look that follows the app's Material theme. */
        @Composable
        fun default(): PliBlockStyle = PliBlockStyle(
            textColor = MaterialTheme.colorScheme.onSurface,
            secondaryColor = MaterialTheme.colorScheme.onSurfaceVariant,
            linkColor = MaterialTheme.colorScheme.primary,
        )
    }
}

/** Blocks and their runs as Compose text: what a block looks like, and its formatted text. */
object PliRichText {
    private data class Base(val size: Float, val bold: Boolean, val italic: Boolean, val mono: Boolean, val secondary: Boolean)

    private fun base(block: PliContentBlock, style: PliBlockStyle): Base {
        val body = style.bodySize.value
        return when (block.type) {
            "title" -> Base(body * 2f, true, false, false, false)
            "subtitle" -> Base(body * 1.25f, false, false, false, true)
            "heading" -> Base(body * listOf(1.7f, 1.45f, 1.25f, 1.1f, 1f, 1f)[((block.level ?: 1) - 1).coerceIn(0, 5)], true, false, false, false)
            "quote" -> Base(body, false, true, false, true)
            "code_block" -> Base(body * 0.9f, false, false, true, false)
            else -> Base(body, false, false, false, false)
        }
    }

    private fun family(name: String?): FontFamily? = when {
        name == null -> null
        name.contains("mono", true) || name.contains("courier", true) || name.contains("consolas", true) -> FontFamily.Monospace
        name.contains("times", true) || name.contains("georgia", true) || name.contains("serif", true) && !name.contains("sans", true) -> FontFamily.Serif
        else -> null
    }

    private fun color(hex: String?): Color? {
        var text = hex?.trim() ?: return null
        if (text.startsWith("#")) text = text.drop(1)
        if (text.length == 3) text = text.map { "$it$it" }.joinToString("")
        if (text.length != 6) return null
        val value = text.toLongOrNull(16) ?: return null
        return Color(0xFF000000 or value)
    }

    /** The look of a block's text as a whole: its size, weight, alignment and line spacing. */
    fun textStyle(block: PliContentBlock, style: PliBlockStyle): TextStyle {
        val base = base(block, style)
        return TextStyle(
            fontSize = base.size.sp,
            fontWeight = if (base.bold) FontWeight.Bold else FontWeight.Normal,
            fontStyle = if (base.italic) FontStyle.Italic else FontStyle.Normal,
            fontFamily = if (base.mono) FontFamily.Monospace else FontFamily.Default,
            color = if (base.secondary) style.secondaryColor else style.textColor,
            textAlign = when (block.align) {
                "center" -> TextAlign.Center
                "right" -> TextAlign.End
                "justify" -> TextAlign.Justify
                else -> TextAlign.Start
            },
            lineHeight = block.format?.lineHeight?.takeIf { it > 1 }?.let { (base.size * 1.3f * it.toFloat()).sp } ?: TextUnit.Unspecified,
        )
    }

    /** The text of a block with its formatting (bold, colour, links and the rest). It has the same length as the block's text. */
    fun annotated(block: PliContentBlock, style: PliBlockStyle): AnnotatedString = buildAnnotatedString {
        val base = base(block, style)
        for (run in block.runs.orEmpty()) {
            val marks = run.marks
            var decoration = TextDecoration.None
            if (marks?.underline == true) decoration += TextDecoration.Underline
            if (marks?.strike == true) decoration += TextDecoration.LineThrough
            var size = marks?.fontSize?.let { it.toFloat() * style.documentScale }
            if (marks?.superscript == true || marks?.`subscript` == true) size = (size ?: base.size) * 0.75f
            val link = marks?.link != null
            val span = SpanStyle(
                fontWeight = if (marks?.bold == true) FontWeight.Bold else null,
                fontStyle = if (marks?.italic == true) FontStyle.Italic else null,
                fontFamily = if (marks?.code == true) FontFamily.Monospace else family(marks?.fontFamily),
                fontSize = size?.sp ?: TextUnit.Unspecified,
                color = if (link) style.linkColor else color(marks?.color) ?: Color.Unspecified,
                background = color(marks?.highlight) ?: if (marks?.code == true) style.secondaryColor.copy(alpha = 0.15f) else Color.Unspecified,
                textDecoration = if (link) decoration + TextDecoration.Underline else decoration,
                baselineShift = when {
                    marks?.superscript == true -> BaselineShift.Superscript
                    marks?.`subscript` == true -> BaselineShift.Subscript
                    else -> null
                },
            )
            pushStyle(span)
            append(run.text)
            pop()
        }
    }
}

/**
 * The document as a scrolling column of editable blocks: paragraphs, headings, lists, tables, pictures. Every block is drawn from the
 * document, and every edit goes through the state, so the toolbar, your own buttons and the typing all change the same document.
 *
 * ```kotlin
 * Column(Modifier.fillMaxSize().imePadding()) {
 *     PliBlocks(state, Modifier.weight(1f))
 *     PliToolbar(state)
 * }
 * ```
 *
 * @param editable Whether the text can be changed.
 */
@Composable
fun PliBlocks(
    state: PliDocumentState,
    modifier: Modifier = Modifier,
    style: PliBlockStyle = PliBlockStyle.default(),
    editable: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(16.dp),
) {
    val list = rememberLazyListState()
    val context = LocalContext.current
    val platformToolbar = LocalTextToolbar.current
    // The menu above a selection (Cut, Copy, Paste) goes through the document, so it keeps formatting.
    val toolbar = remember(platformToolbar, state, context) {
        object : TextToolbar by platformToolbar {
            override fun showMenu(
                rect: androidx.compose.ui.geometry.Rect,
                onCopyRequested: (() -> Unit)?,
                onPasteRequested: (() -> Unit)?,
                onCutRequested: (() -> Unit)?,
                onSelectAllRequested: (() -> Unit)?,
            ) {
                platformToolbar.showMenu(
                    rect,
                    onCopyRequested = onCopyRequested?.let { { state.copyToClipboard(context); platformToolbar.hide() } },
                    onPasteRequested = onPasteRequested?.let { { state.pasteFromClipboard(context); platformToolbar.hide() } },
                    onCutRequested = onCutRequested?.let { { state.cutToClipboard(context); platformToolbar.hide() } },
                    onSelectAllRequested = onSelectAllRequested,
                )
            }
        }
    }
    val focus = state.focusRequest
    // A block that has just been made may be off screen: bring it in, and its own field takes the keyboard.
    LaunchedEffect(focus) {
        if (focus != null) {
            val index = state.blocks.indexOfFirst { it.id == focus }
            if (index >= 0 && list.layoutInfo.visibleItemsInfo.none { it.index == index }) list.animateScrollToItem(index)
        }
    }
    var container by remember { mutableStateOf<LayoutCoordinates?>(null) }
    CompositionLocalProvider(LocalTextToolbar provides toolbar) {
    LazyColumn(
        state = list,
        modifier = modifier
            .onGloballyPositioned { container = it }
            .pliSelectByDragging(state, list) { container },
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // A picture that text wraps around goes with the blocks after it, which run beside it and then under it.
        items(pliEntries(state.blocks), key = { it.first.id }) { entry ->
            if (entry.second.isEmpty() && entry.first.wrap == null) {
                PliBlockView(entry.first, state, style, editable)
            } else {
                PliWrappedGroup(entry.first, entry.second, state, style, editable)
            }
        }
        // A tap below the last block puts the caret at the end of the document.
        item(key = "pli-end") {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = editable) {
                        state.blocks.lastOrNull { it.isText }?.let { state.focus(it.id) }
                    },
            )
        }
    }
    }
}

@Composable
private fun PliBlockView(block: PliContentBlock, state: PliDocumentState, style: PliBlockStyle, editable: Boolean, wrap: PliWrapBeside? = null) {
    when (block.type) {
        "image" -> Box(Modifier.fillMaxWidth()) { PliImageBlock(block, state, editable) }
        "table" -> PliTableBlock(block, state, style, editable)
        "divider" -> HorizontalDivider(Modifier.padding(vertical = 10.dp))
        "page_break" -> PliMarkerBlock("Page break", style)
        "section_break" -> PliMarkerBlock("Section break", style)
        "toc" -> PliMarkerBlock("Table of contents", style)
        else -> PliTextBlock(block, state, style, editable, wrap)
    }
}

@Composable
private fun PliMarkerBlock(label: String, style: PliBlockStyle) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f))
        BasicText(label, Modifier.padding(horizontal = 8.dp), style = TextStyle(fontSize = 12.sp, color = style.secondaryColor))
        HorizontalDivider(Modifier.weight(1f))
    }
}

/** The blocks as list entries: each is a block with the blocks that go beside a picture that text wraps around, if it is one. */
private fun pliEntries(blocks: List<PliContentBlock>): List<Pair<PliContentBlock, List<PliContentBlock>>> {
    val entries = ArrayList<Pair<PliContentBlock, List<PliContentBlock>>>()
    var i = 0
    while (i < blocks.size) {
        val block = blocks[i]
        if (block.type == "image" && block.wrap != null) {
            // Up to a dozen blocks after it, or the next picture that text wraps around.
            var end = i + 1
            while (end < blocks.size && end - i <= 12 && !(blocks[end].type == "image" && blocks[end].wrap != null)) end++
            entries.add(block to blocks.subList(i + 1, end))
            i = end
        } else {
            entries.add(block to emptyList())
            i++
        }
    }
    return entries
}

/**
 * A picture that text wraps around, with the blocks after it. They run along its side until the picture is passed, and carry on
 * under it. A block that reaches past the picture's bottom stays beside it; text doesn't flow under it within a block.
 */
@Composable
private fun PliWrappedGroup(picture: PliContentBlock, followers: List<PliContentBlock>, state: PliDocumentState, style: PliBlockStyle, editable: Boolean) {
    val gap = 14.dp
    val spacing = 6.dp
    val right = picture.wrap == "right"
    // How much room each block has beside the picture is found while measuring, and handed to the block, which cuts its lines to fit.
    val wraps = remember(picture.id) { mutableStateMapOf<String, PliWrapBeside?>() }
    Layout(
        content = {
            PliImageBlock(picture, state, editable)
            for (block in followers) PliBlockView(block, state, style, editable, wraps[block.id])
        },
        modifier = Modifier.fillMaxWidth(),
        measurePolicy = object : MeasurePolicy {
            override fun MeasureScope.measure(measurables: List<Measurable>, constraints: Constraints): MeasureResult {
                val full = constraints.maxWidth
                val pic = measurables[0].measure(Constraints(maxWidth = full))
                val side = (full - pic.width - gap.roundToPx()).coerceAtLeast(full / 3)
                val area = pic.height + spacing.roundToPx()
                val placed = ArrayList<Triple<Placeable, Int, Int>>()
                var y = 0
                for ((index, block) in followers.withIndex()) {
                    val remaining = area - y
                    val beside = remaining > 0
                    val wrap = if (beside && block.isText) PliWrapBeside((full - side).toDp(), remaining.toDp(), leading = !right) else null
                    if (wraps[block.id] != wrap) wraps[block.id] = wrap
                    // A block of text is as wide as the page, and cuts its own lines short beside the picture; anything else is as wide as the room beside it.
                    val width = if (beside && !block.isText) side else full
                    val placeable = measurables[index + 1].measure(Constraints.fixedWidth(width))
                    placed.add(Triple(placeable, if (beside && !block.isText && !right) full - side else 0, y))
                    y += placeable.height + spacing.roundToPx()
                }
                return layout(full, maxOf(y - spacing.roundToPx(), pic.height, 0)) {
                    pic.place(if (right) full - pic.width else 0, 0)
                    placed.forEach { (placeable, x, top) -> placeable.place(x, top) }
                }
            }

            // A row of a table asks how tall this will be (to make its cells equal): the picture, or the blocks one under another. Blocks
            // that can't say (a picture is measured by its room) count for the size they were given.
            private fun IntrinsicMeasureScope.pictureHeight(): Int = (picture.height ?: 150.0).toFloat().dp.roundToPx()

            private fun IntrinsicMeasureScope.followersHeight(measurables: List<IntrinsicMeasurable>, width: Int, max: Boolean): Int =
                measurables.drop(1).withIndex().sumOf { (index, m) ->
                    runCatching { if (max) m.maxIntrinsicHeight(width) else m.minIntrinsicHeight(width) }
                        .getOrElse { (followers[index].height ?: 0.0).toFloat().dp.roundToPx() }
                }

            override fun IntrinsicMeasureScope.minIntrinsicHeight(measurables: List<IntrinsicMeasurable>, width: Int): Int =
                maxOf(pictureHeight(), followersHeight(measurables, width, false))

            override fun IntrinsicMeasureScope.maxIntrinsicHeight(measurables: List<IntrinsicMeasurable>, width: Int): Int =
                maxOf(pictureHeight(), followersHeight(measurables, width, true))

            override fun IntrinsicMeasureScope.minIntrinsicWidth(measurables: List<IntrinsicMeasurable>, height: Int): Int = 0

            override fun IntrinsicMeasureScope.maxIntrinsicWidth(measurables: List<IntrinsicMeasurable>, height: Int): Int = 0
        },
    )
}

/**
 * A picture. A `data:` source is decoded here. Tap it to select it; a dot on its corner then resizes it. While it is being cropped,
 * all of it is shown, with what is cut away dimmed, and a grip on each edge.
 */
@Composable
private fun PliImageBlock(block: PliContentBlock, state: PliDocumentState, editable: Boolean) {
    val bitmap = remember(block.src) {
        val src = block.src
        if (src != null && src.startsWith("data:") && src.contains(",")) {
            runCatching {
                val bytes = Base64.decode(src.substringAfter(","), Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        } else {
            null
        }
    }
    val focus = LocalFocusManager.current
    val density = LocalDensity.current
    val selected = editable && state.format.image?.id == block.id
    val cropping = selected && state.croppingPicture == block.id
    val crop = block.crop ?: PliCrop.None
    val across = (1 - crop.left - crop.right).toFloat().coerceAtLeast(0.05f)
    val down = (1 - crop.top - crop.bottom).toFloat().coerceAtLeast(0.05f)
    // The box is what is kept, or all of the picture while it is cropped.
    val width = (block.width ?: 200.0).toFloat() / (if (cropping) across else 1f)
    val height = (block.height ?: 150.0).toFloat() / (if (cropping) down else 1f)
    BoxWithConstraints(Modifier.padding(vertical = 4.dp)) {
        // Never wider than the room there is, whatever size it was given.
        val shown = minOf(width, maxWidth.value)
        val shownHeight = height * shown / width
        val latest by androidx.compose.runtime.rememberUpdatedState(Triple(shown, block, state))
        val primary = MaterialTheme.colorScheme.primary
        Box(Modifier.width(shown.dp).height(shownHeight.dp)) {
            Box(
                Modifier
                    .matchParentSize()
                    .clipToBounds()
                    .then(if (bitmap == null) Modifier.background(Color.Gray.copy(alpha = 0.15f)) else Modifier)
                    .then(if (selected && !cropping) Modifier.border(2.dp, primary) else Modifier)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = editable) {
                        focus.clearFocus()
                        state.selectPicture(block.id)
                    },
            ) {
                if (bitmap != null) {
                    // A cropped picture is drawn bigger than its box and shifted, so only what is kept shows.
                    val shownCrop = if (cropping) PliCrop.None else crop
                    val fullWidth = shown / (1 - shownCrop.left - shownCrop.right).toFloat().coerceAtLeast(0.05f)
                    val fullHeight = shownHeight / (1 - shownCrop.top - shownCrop.bottom).toFloat().coerceAtLeast(0.05f)
                    Image(
                        bitmap,
                        block.alt,
                        Modifier
                            .requiredSize(fullWidth.dp, fullHeight.dp)
                            .offset((-shownCrop.left * fullWidth).dp, (-shownCrop.top * fullHeight).dp),
                        contentScale = ContentScale.FillBounds,
                        alignment = Alignment.TopStart,
                    )
                }
                if (cropping) {
                    // What is cut away is dimmed.
                    Canvas(Modifier.matchParentSize()) {
                        val l = (crop.left * size.width).toFloat()
                        val t = (crop.top * size.height).toFloat()
                        val r = size.width - (crop.right * size.width).toFloat()
                        val b = size.height - (crop.bottom * size.height).toFloat()
                        val dim = Color.Black.copy(alpha = 0.5f)
                        drawRect(dim, Offset(0f, 0f), Size(size.width, t))
                        drawRect(dim, Offset(0f, b), Size(size.width, size.height - b))
                        drawRect(dim, Offset(0f, t), Size(l, b - t))
                        drawRect(dim, Offset(r, t), Size(size.width - r, b - t))
                        drawRect(primary, Offset(l, t), Size(r - l, b - t), style = Stroke(width = 2.dp.toPx()))
                    }
                }
            }
            if (cropping) {
                // A grip on each edge of the part that is kept: 0 left, 1 top, 2 right, 3 bottom.
                for (edge in 0..3) {
                    val x = when (edge) { 0 -> crop.left; 2 -> 1 - crop.right; else -> (crop.left + 1 - crop.right) / 2 }
                    val y = when (edge) { 1 -> crop.top; 3 -> 1 - crop.bottom; else -> (crop.top + 1 - crop.bottom) / 2 }
                    var start = PliCrop.None
                    var total = Offset.Zero
                    var first = true
                    Box(
                        Modifier
                            .offset((x * shown).dp - 22.dp, (y * shownHeight).dp - 22.dp)
                            .size(44.dp)
                            .pointerInput(block.id, edge) {
                                detectDragGestures(onDragStart = {
                                    start = latest.second.crop ?: PliCrop.None
                                    total = Offset.Zero
                                    first = true
                                }) { change, drag ->
                                    change.consume()
                                    total += drag
                                    val dx = (total.x / density.density / latest.first).toDouble()
                                    val dy = (total.y / density.density / (shownHeight)).toDouble()
                                    // An edge can go no further than 10% of the picture from the one across.
                                    val next = when (edge) {
                                        0 -> start.copy(left = (start.left + dx).coerceIn(0.0, 0.9 - start.right))
                                        1 -> start.copy(top = (start.top + dy).coerceIn(0.0, 0.9 - start.bottom))
                                        2 -> start.copy(right = (start.right - dx).coerceIn(0.0, 0.9 - start.left))
                                        else -> start.copy(bottom = (start.bottom - dy).coerceIn(0.0, 0.9 - start.top))
                                    }
                                    latest.third.setImageCrop(latest.second.id, next, merge = !first)
                                    first = false
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        val vertical = edge % 2 == 0
                        Box(
                            Modifier
                                .size(if (vertical) 8.dp else 28.dp, if (vertical) 28.dp else 8.dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(Color.White)
                                .border(1.dp, primary, RoundedCornerShape(2.dp)),
                        )
                    }
                }
            }
            if (selected && !cropping) {
                var start = 0f
                var total = 0f
                var first = true
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .offset(14.dp, 14.dp)
                        .size(28.dp)
                        .pointerInput(block.id) {
                            detectDragGestures(
                                onDragStart = {
                                    start = latest.first
                                    total = 0f
                                    first = true
                                },
                            ) { change, drag ->
                                change.consume()
                                total += drag.x * (if (latest.second.wrap == "right") -1 else 1)
                                val next = (start + total / density.density).coerceAtLeast(32f)
                                val ratio = (latest.second.height ?: 150.0).toFloat() / (latest.second.width ?: 200.0).toFloat()
                                latest.third.setImageSize(latest.second.id, next.roundToInt(), (next * ratio).roundToInt(), merge = !first)
                                first = false
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(14.dp).clip(CircleShape).background(primary).border(2.dp, MaterialTheme.colorScheme.surface, CircleShape))
                }
            }
        }
    }
}

/** A table: a grid of cells, each with blocks of its own that can be edited. While the caret is in it, the edges between columns have handles to drag. */
@Composable
private fun PliTableBlock(block: PliContentBlock, state: PliDocumentState, style: PliBlockStyle, editable: Boolean) {
    val columns = block.columns.orEmpty()
    val border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant)
    var width by remember { mutableStateOf(0) }
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).onSizeChanged { width = it.width }) {
        Column(Modifier.fillMaxWidth()) {
            block.rows.orEmpty().forEachIndexed { rowIndex, row ->
              Box(Modifier.fillMaxWidth()) {
                var rowPx by remember { mutableStateOf(0) }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .onSizeChanged { rowPx = it.height }
                        // A row is at least as tall as it was set to (in the document's points, drawn bigger).
                        .heightIn(min = ((row.height ?: 0.0) * style.documentScale).dp)
                        .height(androidx.compose.foundation.layout.IntrinsicSize.Min),
                ) {
                    var column = 0
                    var skip = 0
                    for (cell in row.cells) {
                        val here = column
                        column++
                        // A cell that another cell reaches over, to its left, has no place of its own.
                        if (skip > 0) {
                            skip--
                            continue
                        }
                        val span = (cell.colSpan ?: 1).coerceAtLeast(1)
                        skip = span - 1
                        val weight = if (columns.isEmpty()) span.toFloat() else columns.drop(here).take(span).sum().toFloat().coerceAtLeast(0.01f)
                        val shade = color(cell.shade) ?: if (rowIndex == 0 && block.headerRow == true) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent
                        Column(
                            Modifier
                                .weight(weight)
                                .fillMaxHeight()
                                // A cell that a merged cell above it reaches over is a gap in the row.
                                .then(if (cell.covered == true) Modifier else Modifier.border(border).background(shade))
                                .padding(horizontal = 6.dp, vertical = 4.dp),
                        ) {
                            if (cell.covered != true) {
                                // A picture in a cell can have text wrap around it, too.
                                for (entry in pliEntries(cell.blocks)) {
                                    if (entry.second.isEmpty() && entry.first.wrap == null) PliBlockView(entry.first, state, style, editable)
                                    else PliWrappedGroup(entry.first, entry.second, state, style, editable)
                                }
                            }
                        }
                    }
                }
                if (editable && state.format.table?.id == block.id) {
                    val density = LocalDensity.current
                    Box(
                        Modifier
                            .align(Alignment.BottomStart)
                            .offset(6.dp, 14.dp)
                            .size(28.dp)
                            .pointerInput(rowIndex, block.id) {
                                var start = 0
                                var total = 0f
                                var first = true
                                detectVerticalDragGestures(onDragStart = { start = rowPx; total = 0f; first = true }) { change, drag ->
                                    change.consume()
                                    total += drag
                                    val points = ((start + total) / density.density / style.documentScale).toDouble().coerceAtLeast(16.0)
                                    state.setRowHeight(block.id, rowIndex, Math.round(points).toDouble(), !first)
                                    first = false
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(Modifier.width(28.dp).height(4.dp).clip(RoundedCornerShape(2.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)))
                    }
                }
              }
            }
        }
        if (editable && state.format.table?.id == block.id && columns.size > 1 && width > 0) {
            val total = columns.sum().coerceAtLeast(0.0001)
            Box(Modifier.matchParentSize()) {
                var before = 0.0
                for (index in 0 until columns.size - 1) {
                    before += columns[index]
                    PliColumnHandle(
                        left = (width * (before / total)).toFloat(),
                        width = width,
                        onMove = { fraction, merge -> state.moveColumnEdge(block.id, index, fraction, merge) },
                    )
                }
            }
        }
    }
}

/** The grip on the edge between two columns. Dragging it moves the edge. */
@Composable
private fun PliColumnHandle(left: Float, width: Int, onMove: (Double, Boolean) -> Unit) {
    val reach = 28.dp
    val reachPx = with(androidx.compose.ui.platform.LocalDensity.current) { reach.toPx() }
    val edge by androidx.compose.runtime.rememberUpdatedState(left)
    val move by androidx.compose.runtime.rememberUpdatedState(onMove)
    Box(
        Modifier
            .offset { androidx.compose.ui.unit.IntOffset((edge - reachPx / 2).roundToInt(), 0) }
            .width(reach)
            .fillMaxHeight()
            .pointerInput(width) {
                var first = true
                detectHorizontalDragGestures(onDragStart = { first = true }) { change, _ ->
                    change.consume()
                    // The finger is where the edge should be: its place in the handle, plus where the handle is.
                    move(((edge - reachPx / 2 + change.position.x) / width).toDouble(), !first)
                    first = false
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.width(4.dp).height(28.dp).clip(RoundedCornerShape(2.dp)).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)))
    }
}

private fun color(hex: String?): Color? {
    var text = hex?.trim() ?: return null
    if (text.startsWith("#")) text = text.drop(1)
    if (text.length != 6) return null
    return text.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
}

/** A paragraph, heading, quote, code block or list item: editable text with its formatting. */
@Composable
private fun PliTextBlock(block: PliContentBlock, state: PliDocumentState, style: PliBlockStyle, editable: Boolean, wrap: PliWrapBeside? = null) {
    val text = block.text
    var selection by remember(block.id) { mutableStateOf(TextRange(text.length)) }
    var composition by remember(block.id) { mutableStateOf<TextRange?>(null) }
    val requester = remember { FocusRequester() }
    val hit = remember(block.id) { state.hits.getOrPut(block.id) { PliDocumentState.Hit() } }

    // The caret goes where the document says it is: after Enter, after Backspace joins two blocks.
    LaunchedEffect(state.focusRequest) {
        if (state.focusRequest == block.id) {
            state.selection?.takeIf { it.focus.block == block.id }?.let {
                val anchor = if (it.anchor.block == block.id) it.anchor.offset else it.focus.offset
                selection = TextRange(anchor.coerceIn(0, text.length), it.focus.offset.coerceIn(0, text.length))
            }
            // The field may not be attached for a frame or two, if the block has only just been made.
            for (attempt in 0 until 3) {
                if (runCatching { requester.requestFocus() }.isSuccess) break
                awaitFrame()
            }
            state.focusRequest = null
        }
    }

    // A selection made by dragging, or by the arrow keys, is the document's; the field follows it.
    val engine = state.selection
    LaunchedEffect(engine, text) {
        val s = engine ?: return@LaunchedEffect
        if (s.anchor.block == block.id && s.focus.block == block.id) {
            val wanted = TextRange(s.anchor.offset.coerceIn(0, text.length), s.focus.offset.coerceIn(0, text.length))
            if (wanted != selection) selection = wanted
        } else if (s.focus.block == block.id) {
            // With a selection across blocks, the keyboard stays at its end, so typing and Delete go over the whole selection.
            val wanted = TextRange(s.focus.offset.coerceIn(0, text.length))
            if (wanted != selection) selection = wanted
            if (!state.dragging) runCatching { requester.requestFocus() }
        }
    }

    val value = TextFieldValue(
        text = text,
        selection = TextRange(selection.start.coerceAtMost(text.length), selection.end.coerceAtMost(text.length)),
        composition = composition?.takeIf { it.end <= text.length },
    )
    // Text that a selection across blocks covers is tinted here; the one block that has the caret shows its own.
    val covered = state.selectedRange(block.id)?.takeIf { !it.isEmpty() }
    val tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
    val annotated = remember(block, style, covered, tint) {
        val base = PliRichText.annotated(block, style)
        if (covered == null || covered.last >= base.length) {
            base
        } else {
            androidx.compose.ui.text.buildAnnotatedString {
                append(base)
                addStyle(SpanStyle(background = tint), covered.first, covered.last + 1)
            }
        }
    }
    val textStyle = PliRichText.textStyle(block, style)
    // Text beside a picture that text wraps around: the lines that are beside it are cut short, line by line, and the rest run on at full width.
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    var fieldWidth by remember { mutableStateOf(0) }
    val wrapped = remember(annotated, wrap, fieldWidth, textStyle) {
        if (wrap == null || fieldWidth == 0 || annotated.isEmpty()) {
            null
        } else {
            val indent = with(density) { wrap.indent.toPx() }
            val narrow = (fieldWidth - indent).toInt().coerceAtLeast(60)
            val result = measurer.measure(annotated, textStyle, constraints = Constraints(maxWidth = narrow))
            val limit = with(density) { wrap.height.toPx() }
            val ends = ArrayList<Int>()
            var line = 0
            while (line < result.lineCount && result.getLineTop(line) < limit) {
                ends.add(result.getLineEnd(line))
                line++
            }
            PliWrappedText(annotated, ends, if (wrap.leading) with(density) { indent.toSp() } else null)
        }
    }
    val transformation = remember(annotated, wrapped) {
        if (wrapped == null) {
            VisualTransformation { TransformedText(annotated, OffsetMapping.Identity) }
        } else {
            VisualTransformation { TransformedText(wrapped.text, wrapped.mapping) }
        }
    }
    hit.inserted = wrapped?.inserted.orEmpty()
    val isItem = block.type == "list_item"
    val left = ((block.depth ?: 0) * 24 + (block.format?.indentLeft ?: 0.0) * style.documentScale).dp

    Row(
        Modifier
            .fillMaxWidth()
            .then(if (block.type == "code_block") Modifier.background(style.secondaryColor.copy(alpha = 0.1f)) else Modifier)
            .padding(start = left),
    ) {
        if (isItem) {
            BasicText(
                (block.label ?: "") + " ",
                Modifier.width(28.dp),
                style = textStyle.copy(color = style.secondaryColor, fontWeight = FontWeight.Normal, textAlign = TextAlign.End),
            )
        }
        if (block.type == "quote") {
            Box(Modifier.padding(end = 10.dp).width(3.dp).fillMaxHeight().background(style.secondaryColor.copy(alpha = 0.4f)))
        }
        BasicTextField(
            value = value,
            onValueChange = { new ->
                // Edits can arrive faster than the screen is redrawn: compare with the document's text now, not the text this was drawn with.
                val current = state.blocks.firstOrNull { it.id == block.id }?.text ?: text
                if (new.text != current) {
                    val change = diff(current, new.text)
                    if (state.isMultiBlock && new.composition == null) {
                        // With a selection across blocks, what is typed or deleted goes over all of it.
                        state.replaceSelection(change.inserted)
                    } else if (change.inserted == "\n" && change.from == change.to && new.composition == null) {
                        state.split(block.id, change.from, change.to)
                    } else {
                        selection = new.selection
                        composition = new.composition
                        state.replace(block.id, change.from, change.to, change.inserted)
                    }
                } else {
                    // The field's own press selects a word as the drag starts, and ends with the drag: the selection that was dragged out stays.
                    if (state.dragging || System.nanoTime() - state.dragEndedAt < 600_000_000L) return@BasicTextField
                    selection = new.selection
                    composition = new.composition
                    if (new.composition == null) state.place(block.id, new.selection.min, new.selection.max)
                }
            },
            modifier = Modifier
                .weight(1f)
                .focusRequester(requester)
                .onFocusChanged {
                    if (it.isFocused && !state.isMultiBlock && !state.dragging) state.place(block.id, selection.min.coerceAtMost(text.length), selection.max.coerceAtMost(text.length))
                }
                .onPreviewKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    val arrow = when (event.key) {
                        Key.DirectionLeft -> PliArrow.Left
                        Key.DirectionRight -> PliArrow.Right
                        Key.DirectionUp -> PliArrow.Up
                        Key.DirectionDown -> PliArrow.Down
                        else -> null
                    }
                    when {
                        event.key == Key.Backspace && state.isMultiBlock -> {
                            state.replaceSelection("")
                            true
                        }
                        event.key == Key.Backspace && selection.collapsed && selection.start == 0 && composition == null -> {
                            state.backspaceAtStart(block.id)
                            true
                        }
                        arrow != null && composition == null -> state.arrow(block.id, arrow, event.isShiftPressed, selection.start, selection.end)
                        else -> false
                    }
                }
                .padding(vertical = 3.dp)
                .onGloballyPositioned { hit.coordinates = it; fieldWidth = it.size.width },
            readOnly = !editable,
            textStyle = textStyle,
            cursorBrush = SolidColor(style.textColor.takeIf { it != Color.Unspecified } ?: Color.Black),
            visualTransformation = transformation,
            onTextLayout = { hit.layout = it },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
    }
}

/** What changed between two texts: the stretch between what they share at the start and at the end. */
internal data class PliTextChange(val from: Int, val to: Int, val inserted: String)

internal fun diff(old: String, new: String): PliTextChange {
    var prefix = 0
    val shortest = minOf(old.length, new.length)
    while (prefix < shortest && old[prefix] == new[prefix]) prefix++
    // Don't cut an emoji or another surrogate pair in half.
    if (prefix > 0 && prefix < new.length && new[prefix].isLowSurrogate()) prefix--
    var suffix = 0
    while (suffix < shortest - prefix && old[old.length - 1 - suffix] == new[new.length - 1 - suffix]) suffix++
    if (suffix > 0 && new[new.length - suffix].isLowSurrogate()) suffix--
    return PliTextChange(prefix, old.length - suffix, new.substring(prefix, new.length - suffix))
}

/**
 * Press and hold on text, then drag to select, from one block into another. Until the press has been held the touch is left to the
 * list (scrolling) and the text fields (taps, the caret); after it, the drag is the selection's.
 */
private fun Modifier.pliSelectByDragging(state: PliDocumentState, list: LazyListState, container: () -> LayoutCoordinates?): Modifier =
    pointerInput(state) {
        coroutineScope {
            val scope = this
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                var gone = false
                val held = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                    while (!gone) {
                        val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id }
                        if (change == null || !change.pressed || (change.position - down.position).getDistance() > viewConfiguration.touchSlop) gone = true
                    }
                    true
                }
                if (held != null) return@awaitEachGesture

                fun window(position: Offset): Offset = container()?.localToWindow(position) ?: position
                var anchor = state.hitAt(window(down.position)) ?: return@awaitEachGesture
                state.dragging = true
                // A press without moving selects the word under the finger, as in one block.
                state.hits[anchor.block]?.layout?.let { layout ->
                    val word = layout.getWordBoundary(anchor.offset.coerceIn(0, state.length(anchor.block)))
                    state.selectRange(PliPoint(anchor.block, word.start), PliPoint(anchor.block, word.end))
                    anchor = PliPoint(anchor.block, word.start)
                }
                var finger = down.position
                val edge = 64.dp.toPx()
                val autoscroll = scope.launch {
                    while (true) {
                        delay(16)
                        val height = size.height
                        val step = when {
                            finger.y < edge -> -((edge - finger.y) / 4f + 2f).coerceAtMost(28f)
                            finger.y > height - edge -> ((finger.y - (height - edge)) / 4f + 2f).coerceAtMost(28f)
                            else -> 0f
                        }
                        if (step != 0f) {
                            list.scrollBy(step)
                            state.hitAt(window(finger))?.let { state.selectRange(anchor, it) }
                        }
                    }
                }
                try {
                    while (true) {
                        val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: break
                        change.consume()
                        if (!change.pressed) break
                        finger = change.position
                        state.hitAt(window(finger))?.let { state.selectRange(anchor, it) }
                    }
                } finally {
                    autoscroll.cancel()
                    state.dragging = false
                    state.dragEndedAt = System.nanoTime()
                    // The field that ends up holding the caret takes the keyboard.
                    state.selection?.let { state.focusRequest = it.focus.block }
                }
            }
        }
    }

/** How much room a picture that text wraps around takes beside a block: [indent] across, for [height] down. */
internal data class PliWrapBeside(val indent: androidx.compose.ui.unit.Dp, val height: androidx.compose.ui.unit.Dp, val leading: Boolean)

/** A block's text with line breaks added where the narrow lines beside a picture end, and what is needed to map places in it. */
internal class PliWrappedText(base: AnnotatedString, lineEnds: List<Int>, indent: TextUnit?) {
    /** Offsets in the block's text where a line break was added. The last line beside the picture ends a paragraph instead. */
    val inserted: List<Int> = lineEnds.dropLast(1).filter { it in 1 until base.length }
    val text: AnnotatedString
    val mapping: OffsetMapping

    init {
        val regionEnd = (lineEnds.lastOrNull() ?: 0).coerceAtMost(base.length)
        val builder = AnnotatedString.Builder()
        var from = 0
        for (offset in inserted) {
            builder.append(base.subSequence(from, offset))
            builder.append("\n")
            from = offset
        }
        builder.append(base.subSequence(from, base.length))
        text = builder.toAnnotatedString().let { whole ->
            if (regionEnd <= 0 || regionEnd >= base.length && inserted.isEmpty() && indent == null) {
                whole
            } else {
                // The lines beside the picture are one paragraph (indented, when the picture is on the left); the rest is another.
                val end = regionEnd + inserted.size
                androidx.compose.ui.text.AnnotatedString.Builder().also {
                    it.append(whole)
                    it.addStyle(ParagraphStyle(textIndent = if (indent != null) TextIndent(indent, indent) else null), 0, end)
                }.toAnnotatedString()
            }
        }
        mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int = offset + inserted.count { it <= offset }
            override fun transformedToOriginal(offset: Int): Int = (offset - inserted.indices.count { inserted[it] + it < offset }).coerceAtLeast(0)
        }
    }
}
