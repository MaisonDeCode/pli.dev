package dev.pli

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.PopupProperties

// Buttons and menus for a `PliDocumentState`. Each one reads what is on at the selection from `state.format` and does its work with
// a command, so you can use them one by one in your own layout, or use `PliToolbar` for all of them in a row.

/**
 * A button that shows whether something is on at the selection (bold, a list) and toggles it.
 *
 * @param label What the button shows: a letter or a symbol.
 * @param description What a screen reader says.
 */
@Composable
fun PliToggleButton(
    label: String,
    description: String,
    isOn: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    labelStyle: TextStyle = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Medium),
    onClick: () -> Unit,
) {
    val tint = if (isOn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
    Box(
        modifier
            .size(40.dp)
            .alpha(if (enabled) 1f else 0.35f)
            .clip(RoundedCornerShape(8.dp))
            .background(if (isOn) MaterialTheme.colorScheme.primary.copy(alpha = 0.16f) else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick)
            .semantics {
                contentDescription = description
                selected = isOn
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        BasicText(label, style = labelStyle.copy(color = tint))
    }
}

/** A button that opens a menu. */
@Composable
internal fun PliMenuButton(label: String, description: String, tint: Color? = null, enabled: Boolean = true, content: @Composable (close: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        PliToggleButton(label, description, isOn = false, enabled = enabled, labelStyle = TextStyle(fontSize = 17.sp, color = tint ?: Color.Unspecified)) { open = true }
        // The menu doesn't take the window's focus, so the keyboard stays up while you pick.
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, properties = PopupProperties(focusable = false)) {
            content { open = false }
        }
    }
}

@Composable
private fun PliMenuItem(title: String, checked: Boolean = false, close: () -> Unit, action: () -> Unit) {
    DropdownMenuItem(
        text = { Text(if (checked) "✓  $title" else title) },
        onClick = {
            action()
            close()
        },
    )
}

/** Undo and Redo. */
@Composable
fun PliUndoRedoButtons(state: PliDocumentState) {
    Row {
        PliToggleButton("↶", "Undo", false, enabled = state.format.canUndo) { state.perform { undo() } }
        PliToggleButton("↷", "Redo", false, enabled = state.format.canRedo) { state.perform { redo() } }
    }
}

/** Text, Title, Subtitle, headings, Quote and Code, with the current one checked. */
@Composable
fun PliStyleMenu(state: PliDocumentState) {
    var open by remember { mutableStateOf(false) }
    val block = state.format.block
    val current = when (block?.type) {
        null -> "Mixed"
        "heading" -> "Heading ${block.level ?: 1}"
        "title" -> "Title"
        "subtitle" -> "Subtitle"
        "quote" -> "Quote"
        "code_block" -> "Code"
        "list_item" -> if (block.list == "ordered") "Numbered" else "Bulleted"
        else -> "Text"
    }
    fun isCurrent(type: String, level: Int? = null) = block?.type == type && (level == null || block.level == level)
    Box {
        Row(
            Modifier
                .height(40.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.07f))
                .clickable { open = true }
                .padding(horizontal = 12.dp)
                .semantics { contentDescription = "Text style" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicText(current, style = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface))
            BasicText("  ▾", style = TextStyle(fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, properties = PopupProperties(focusable = false)) {
            val close = { open = false }
            PliMenuItem("Text", isCurrent("paragraph"), close) { state.perform { setParagraph() } }
            PliMenuItem("Title", isCurrent("title"), close) { state.perform { setTitle() } }
            PliMenuItem("Subtitle", isCurrent("subtitle"), close) { state.perform { setSubtitle() } }
            PliMenuItem("Heading 1", isCurrent("heading", 1), close) { state.perform { setHeading(1) } }
            PliMenuItem("Heading 2", isCurrent("heading", 2), close) { state.perform { setHeading(2) } }
            PliMenuItem("Heading 3", isCurrent("heading", 3), close) { state.perform { setHeading(3) } }
            PliMenuItem("Quote", isCurrent("quote"), close) { state.perform { setQuote() } }
            PliMenuItem("Code", isCurrent("code_block"), close) { state.perform { setCodeBlock() } }
        }
    }
}

/** Bold, italic, underline and strikethrough. */
@Composable
fun PliMarkButtons(state: PliDocumentState) {
    val marks = state.format.marks
    Row {
        PliToggleButton("B", "Bold", marks.bold, labelStyle = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold)) { state.perform { toggleBold() } }
        PliToggleButton("I", "Italic", marks.italic, labelStyle = TextStyle(fontSize = 17.sp, fontStyle = FontStyle.Italic, fontWeight = FontWeight.Medium)) { state.perform { toggleItalic() } }
        PliToggleButton("U", "Underline", marks.underline, labelStyle = TextStyle(fontSize = 17.sp, textDecoration = TextDecoration.Underline, fontWeight = FontWeight.Medium)) { state.perform { toggleUnderline() } }
        PliToggleButton("S", "Strikethrough", marks.strike, labelStyle = TextStyle(fontSize = 17.sp, textDecoration = TextDecoration.LineThrough, fontWeight = FontWeight.Medium)) { state.perform { toggleStrikethrough() } }
    }
}

/** Bulleted and numbered lists, and indent and outdent. */
@Composable
fun PliListButtons(state: PliDocumentState) {
    val format = state.format
    Row {
        PliToggleButton("•≡", "Bulleted list", format.block?.list == "bullet") { state.perform { toggleBulletedList() } }
        PliToggleButton("1.", "Numbered list", format.block?.list == "ordered") { state.perform { toggleNumberedList() } }
        PliToggleButton("⇤", "Outdent", false, enabled = format.canOutdent) { state.perform { outdent() } }
        PliToggleButton("⇥", "Indent", false, enabled = format.canIndent) { state.perform { indent() } }
    }
}

/** How a list is marked (1. 2. 3., a. b. c., i. ii. iii., bullets), where numbering starts, and whether it carries on from the list above. */
@Composable
fun PliListMenu(state: PliDocumentState) {
    val list = state.format.list
    val markers = listOf(
        PliListMarker.DECIMAL to "1. 2. 3.", PliListMarker.LOWER_ALPHA to "a. b. c.", PliListMarker.UPPER_ALPHA to "A. B. C.",
        PliListMarker.LOWER_ROMAN to "i. ii. iii.", PliListMarker.UPPER_ROMAN to "I. II. III.",
        PliListMarker.DISC to "• Disc", PliListMarker.CIRCLE to "◦ Circle", PliListMarker.SQUARE to "▪ Square",
    )
    PliMenuButton("1.i", "List options", enabled = list != null) { close ->
        for ((marker, title) in markers) PliMenuItem(title, list?.marker == marker.wire, close) { state.perform { setListMarker(marker) } }
        if (list?.kind == "ordered") {
            HorizontalDivider()
            PliMenuItem("Restart at 1", false, close) { state.perform { setListStart(1) } }
            PliMenuItem("Continue numbering", false, close) { state.perform { continueNumbering() } }
        }
    }
}

/** Left, centre, right and justified. */
@Composable
fun PliAlignmentMenu(state: PliDocumentState) {
    val current = state.format.align ?: "left"
    val choices = listOf(PliAlignment.LEFT to "Align left", PliAlignment.CENTER to "Align centre", PliAlignment.RIGHT to "Align right", PliAlignment.JUSTIFY to "Justify")
    val icon = when (current) { "center" -> "≣"; "right" -> "☰"; else -> "≡" }
    PliMenuButton(icon, "Alignment") { close ->
        for ((alignment, title) in choices) PliMenuItem(title, current == alignment.wire, close) { state.perform { setAlignment(alignment) } }
    }
}

/** A few colours for text or its highlight, and a way to take the colour off. */
@Composable
fun PliColorMenu(state: PliDocumentState, highlight: Boolean = false) {
    val colors = if (highlight) {
        listOf("Yellow" to "#fef08a", "Green" to "#bbf7d0", "Blue" to "#bfdbfe", "Pink" to "#fbcfe8", "Orange" to "#fed7aa", "Gray" to "#e5e7eb")
    } else {
        listOf("Black" to "#111827", "Red" to "#b91c1c", "Orange" to "#c2410c", "Green" to "#15803d", "Blue" to "#1d4ed8", "Purple" to "#7e22ce", "Gray" to "#6b7280")
    }
    val current = (if (highlight) state.format.highlight.value else state.format.color.value)?.lowercase()
    val tint = current?.let { hex -> runCatching { Color(0xFF000000 or hex.removePrefix("#").toLong(16)) }.getOrNull() }
    PliMenuButton(if (highlight) "▮" else "A", if (highlight) "Highlight" else "Text colour", tint = if (highlight) tint else tint) { close ->
        for ((name, hex) in colors) {
            PliMenuItem(name, current == hex, close) { state.perform { if (highlight) setHighlight(hex) else setTextColor(hex) } }
        }
        HorizontalDivider()
        PliMenuItem(if (highlight) "No highlight" else "Automatic", false, close) { state.perform { if (highlight) setHighlight(null) else setTextColor(null) } }
    }
}

/** More character formatting: code, superscript, subscript, line spacing, and clearing formatting. */
@Composable
fun PliFormatMenu(state: PliDocumentState) {
    val marks = state.format.marks
    PliMenuButton("Aa", "More formatting") { close ->
        PliMenuItem("Code", marks.code, close) { state.perform { toggleCode() } }
        PliMenuItem("Superscript", marks.superscript, close) { state.perform { toggleSuperscript() } }
        PliMenuItem("Subscript", marks.`subscript`, close) { state.perform { toggleSubscript() } }
        HorizontalDivider()
        for (spacing in listOf(1.0, 1.15, 1.5, 2.0)) {
            PliMenuItem(if (spacing == 1.0) "Line spacing: single" else "Line spacing: $spacing", false, close) { state.perform { setLineSpacing(spacing) } }
        }
        HorizontalDivider()
        PliMenuItem("Clear formatting", false, close) { state.perform { clearFormatting() } }
    }
}

/**
 * Things to put in the document: a picture from the photo picker, a table, a divider, a page break.
 *
 * @param extra Your own items, after the built-in ones. Call `close()` when one is picked.
 */
@Composable
fun PliInsertMenu(state: PliDocumentState, extra: (@Composable (close: () -> Unit) -> Unit)? = null) {
    val context = LocalContext.current
    // The system photo picker needs no permission: the app sees only what is chosen.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) state.insertPicture(context, uri) }
    PliMenuButton("＋", "Insert") { close ->
        PliMenuItem("Picture", false, close) { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
        PliMenuItem("Table", false, close) { state.perform { insertTable(3, 3) } }
        PliMenuItem("Divider", false, close) { state.perform { insertDivider() } }
        PliMenuItem("Page break", false, close) { state.perform { insertPageBreak() } }
        extra?.invoke(close)
    }
}

/**
 * What to do with the selected picture: crop it, wrap text around it, set its size, or delete it. Tap a picture to select it; drag the
 * dot on its corner to resize it freely. It does nothing when no picture is selected, so show it only when `state.format.image` is set.
 */
@Composable
fun PliPictureMenu(state: PliDocumentState) {
    val id = state.format.image?.id
    val picture = id?.let { state.findBlock(it) }
    PliMenuButton("▣", "Picture", enabled = id != null) { close ->
        if (id != null) {
            val cropping = state.croppingPicture == id
            PliMenuItem(if (cropping) "Done cropping" else "Crop", cropping, close) { state.setCropping(id, !cropping) }
            for ((name, aspect) in listOf("Crop to square" to 1.0, "Crop to 4 : 3" to 4.0 / 3, "Crop to 16 : 9" to 16.0 / 9, "Crop to 3 : 4" to 3.0 / 4)) {
                PliMenuItem(name, false, close) { state.cropPicture(id, aspect) }
            }
            if (picture?.crop != null) PliMenuItem("Show all of it", false, close) { state.cropPicture(id, null) }
            HorizontalDivider()
            for ((name, side) in listOf("On its own line" to null, "Text on the right" to "left", "Text on the left" to "right")) {
                PliMenuItem(name, picture?.wrap == side, close) { state.wrapPicture(id, side) }
            }
            HorizontalDivider()
        }
        for ((name, target) in listOf("Small" to 160, "Medium" to 320, "Large" to 480)) {
            PliMenuItem(name, false, close) {
                val w = picture?.width ?: return@PliMenuItem
                val h = picture.height ?: return@PliMenuItem
                if (w > 0) state.setImageSize(picture.id, target, Math.round(h * target / w).toInt())
            }
        }
        HorizontalDivider()
        PliMenuItem("Delete picture", false, close) { id?.let { state.deletePicture(it) } }
    }
}

/**
 * Rows and columns of the table the caret is in: add and delete them, merge and split cells, a header row, a colour for cells.
 * Select from one cell to another (press and drag) to merge them. It does nothing outside a table, so show it only when `state.format.table` is set.
 */
@Composable
fun PliTableMenu(state: PliDocumentState) {
    val table = state.format.table
    val shades = listOf("Yellow" to "#fef08a", "Green" to "#bbf7d0", "Blue" to "#bfdbfe", "Pink" to "#fbcfe8", "Gray" to "#e5e7eb")
    PliMenuButton("▦", "Table") { close ->
        PliMenuItem("Insert row above", false, close) { state.perform { addRowAbove() } }
        PliMenuItem("Insert row below", false, close) { state.perform { addRowBelow() } }
        PliMenuItem("Insert column left", false, close) { state.perform { addColumnLeft() } }
        PliMenuItem("Insert column right", false, close) { state.perform { addColumnRight() } }
        HorizontalDivider()
        if (table?.canMerge == true) PliMenuItem("Merge cells", false, close) { state.perform { mergeCells() } }
        if (table?.canSplit == true) PliMenuItem("Split cells", false, close) { state.perform { splitCells() } }
        PliMenuItem("Header row", table?.headerRow == true, close) { state.perform { setHeaderRow(table?.headerRow != true) } }
        for ((name, hex) in shades) PliMenuItem("Cell colour: $name", false, close) { state.perform { setCellShade(hex) } }
        PliMenuItem("No cell colour", false, close) { state.perform { setCellShade(null) } }
        HorizontalDivider()
        PliMenuItem("Delete row", false, close) { state.perform { deleteRow() } }
        PliMenuItem("Delete column", false, close) { state.perform { deleteColumn() } }
        PliMenuItem("Delete table", false, close) { state.perform { deleteTable() } }
    }
}

/** Select all, cut, copy and paste, with formatting. To select across blocks by hand, press and hold on text and drag. */
@Composable
fun PliEditMenu(state: PliDocumentState) {
    val context = LocalContext.current
    PliMenuButton("⎘", "Edit") { close ->
        PliMenuItem("Select all", false, close) { state.selectAll() }
        HorizontalDivider()
        PliMenuItem("Cut", false, close) { state.cutToClipboard(context) }
        PliMenuItem("Copy", false, close) { state.copyToClipboard(context) }
        PliMenuItem("Paste", false, close) { state.pasteFromClipboard(context) }
    }
}

/**
 * All of the buttons and menus in a row that scrolls sideways: undo and redo, the text style, bold and the other marks, colours,
 * lists, alignment, insert, the table's menu while the caret is in a table, and more formatting. Use the pieces on their own for a toolbar of your own.
 */
@Composable
fun PliToolbar(state: PliDocumentState, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer)) {
        HorizontalDivider()
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PliUndoRedoButtons(state)
            PliToolbarDivider()
            PliStyleMenu(state)
            PliToolbarDivider()
            PliMarkButtons(state)
            PliColorMenu(state)
            PliColorMenu(state, highlight = true)
            PliToolbarDivider()
            PliListButtons(state)
            PliListMenu(state)
            PliAlignmentMenu(state)
            PliToolbarDivider()
            PliInsertMenu(state)
            if (state.format.table != null) PliTableMenu(state)
            if (state.format.image != null) PliPictureMenu(state)
            PliFormatMenu(state)
            PliEditMenu(state)
        }
    }
}

@Composable
private fun PliToolbarDivider() {
    Box(Modifier.padding(horizontal = 4.dp).width(1.dp).height(22.dp).background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.15f)))
}
