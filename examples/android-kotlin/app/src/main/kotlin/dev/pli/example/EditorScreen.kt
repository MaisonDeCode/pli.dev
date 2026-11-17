package dev.pli.example

import android.webkit.WebView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.text.KeyboardOptions
import dev.pli.PliAlignment
import dev.pli.PliBlock
import dev.pli.PliListMarker

/**
 * The whole screen: the document's blocks (or how it exports), a bar of commands, and a field to type in.
 *
 * There is no ready-made editing view for Android yet, so this app draws the blocks itself from `blocks()`. Each button is one
 * call on the document, such as `toggleBold()` or `setHeading(1)`.
 */
@Composable
fun EditorScreen(editor: EditorViewModel) {
    val ui by editor.state.collectAsState()
    val context = LocalContext.current
    var tab by remember { mutableStateOf(0) }
    var askStart by remember { mutableStateOf(false) }

    val exporters = ExportFormat.entries.associateWith { format ->
        rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(format.mime)) { uri ->
            if (uri != null) editor.export(format, uri, context.contentResolver)
        }
    }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) editor.importDocx(uri, context.contentResolver)
    }

    Column(Modifier.fillMaxSize()) {
        Text("Pli", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        Toolbar(
            editor = editor,
            canUndo = ui.state?.canUndo == true,
            canRedo = ui.state?.canRedo == true,
            onStartAt = { askStart = true },
            onExport = { format -> exporters.getValue(format).launch("Document.${format.extension}") },
            onImport = { importer.launch(arrayOf("*/*")) },
        )
        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Blocks") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Preview") })
        }
        Box(Modifier.weight(1f)) {
            if (tab == 0) BlocksList(ui.blocks, ui.current, editor::place) else Preview(ui.html)
        }
        if (tab == 0) TypingBar(editor)
        Text(
            "${ui.statistics?.words ?: 0} words" + (ui.current?.let { "  ·  In: ${it.type.replace('_', ' ')}" } ?: ""),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp).alpha(0.7f),
        )
    }

    if (askStart) StartDialog(onDismiss = { askStart = false }) { number -> editor.run { it.setListStart(number) } }
    ui.message?.let { message ->
        AlertDialog(
            onDismissRequest = editor::dismissMessage,
            confirmButton = { TextButton(onClick = editor::dismissMessage) { Text("OK") } },
            text = { Text(message) },
        )
    }
}

@Composable
private fun Toolbar(
    editor: EditorViewModel,
    canUndo: Boolean,
    canRedo: Boolean,
    onStartAt: () -> Unit,
    onExport: (ExportFormat) -> Unit,
    onImport: () -> Unit,
) {
    Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        TextButton(onClick = { editor.run { it.undo() } }, enabled = canUndo) { Text("Undo") }
        TextButton(onClick = { editor.run { it.redo() } }, enabled = canRedo) { Text("Redo") }
        Menu("Format") {
            item("Bold") { editor.run { it.toggleBold() } }
            item("Italic") { editor.run { it.toggleItalic() } }
            item("Underline") { editor.run { it.toggleUnderline() } }
            item("Strikethrough") { editor.run { it.toggleStrikethrough() } }
            item("Code") { editor.run { it.toggleCode() } }
            item("Red text") { editor.run { it.setTextColor("#b91c1c") } }
            item("Highlight") { editor.run { it.setHighlight("#fef08a") } }
            item("Clear formatting") { editor.run { it.clearFormatting() } }
            item("Align left") { editor.run { it.setAlignment(PliAlignment.LEFT) } }
            item("Align centre") { editor.run { it.setAlignment(PliAlignment.CENTER) } }
            item("Align right") { editor.run { it.setAlignment(PliAlignment.RIGHT) } }
        }
        Menu("Block") {
            item("Paragraph") { editor.run { it.setParagraph() } }
            item("Title") { editor.run { it.setTitle() } }
            item("Heading 1") { editor.run { it.setHeading(1) } }
            item("Heading 2") { editor.run { it.setHeading(2) } }
            item("Heading 3") { editor.run { it.setHeading(3) } }
            item("Quote") { editor.run { it.setQuote() } }
        }
        Menu("List") {
            item("Bulleted list") { editor.run { it.toggleBulletedList() } }
            item("Numbered list") { editor.run { it.toggleNumberedList() } }
            item("1. 2. 3.") { editor.run { it.setListMarker(PliListMarker.DECIMAL) } }
            item("a. b. c.") { editor.run { it.setListMarker(PliListMarker.LOWER_ALPHA) } }
            item("A. B. C.") { editor.run { it.setListMarker(PliListMarker.UPPER_ALPHA) } }
            item("i. ii. iii.") { editor.run { it.setListMarker(PliListMarker.LOWER_ROMAN) } }
            item("I. II. III.") { editor.run { it.setListMarker(PliListMarker.UPPER_ROMAN) } }
            item("Restart at 1") { editor.run { it.setListStart(1) } }
            item("Start at…") { onStartAt() }
            item("Continue numbering") { editor.run { it.continueNumbering() } }
            item("Indent") { editor.run { it.indent() } }
            item("Outdent") { editor.run { it.outdent() } }
        }
        Menu("Insert") {
            item("Table (2 × 3)") { editor.run { it.insertTable(2, 3) } }
            item("Horizontal line") { editor.run { it.insertDivider() } }
            item("Page break") { editor.run { it.insertPageBreak() } }
        }
        Menu("File") {
            ExportFormat.entries.forEach { format -> item("Save as ${format.title}") { onExport(format) } }
            item("Open a DOCX file…") { onImport() }
            item("Start over") { editor.startOver() }
        }
    }
}

private class MenuItems {
    val items = mutableListOf<Pair<String, () -> Unit>>()
    fun item(label: String, action: () -> Unit) {
        items += label to action
    }
}

/** A button that opens a menu of commands. */
@Composable
private fun Menu(label: String, build: MenuItems.() -> Unit) {
    var open by remember { mutableStateOf(false) }
    val entries = MenuItems().apply(build).items
    Box {
        TextButton(onClick = { open = true }) { Text(label) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            entries.forEach { (text, action) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { open = false; action() })
            }
        }
    }
}

/** Every block, as a row. Tapping one puts the caret at the end of it. */
@Composable
private fun BlocksList(blocks: List<PliBlock>, current: PliBlock?, onPlace: (PliBlock) -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        items(blocks, key = { it.id }) { block ->
            val background = if (block.id == current?.id) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent
            Row(
                Modifier.fillMaxWidth().clickable { onPlace(block) }.padding(start = 16.dp + 20.dp * (block.depth ?: 0), end = 16.dp, top = 10.dp, bottom = 10.dp),
                verticalAlignment = androidx.compose.ui.Alignment.Top,
            ) {
                block.label?.let { Text(it, modifier = Modifier.width(32.dp), textAlign = TextAlign.End, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (block.label != null) Spacer(Modifier.width(8.dp))
                BlockText(block)
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun BlockText(block: PliBlock) {
    val type = MaterialTheme.typography
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    when (block.type) {
        "title" -> Text(block.text, style = type.headlineLarge, fontWeight = FontWeight.Bold)
        "subtitle" -> Text(block.text, style = type.titleMedium, color = muted)
        "heading" -> Text(block.text, style = when (block.level ?: 1) { 1 -> type.headlineMedium; 2 -> type.titleLarge; else -> type.titleMedium }, fontWeight = FontWeight.Bold)
        "quote" -> Text(block.text, fontStyle = FontStyle.Italic, color = muted, modifier = Modifier.padding(start = 8.dp))
        "code_block" -> Text(block.text, fontFamily = FontFamily.Monospace)
        "table" -> Text("Table, ${block.rows ?: 0} × ${block.columns ?: 0}", color = muted)
        "image" -> Text("Picture", color = muted)
        "divider" -> HorizontalDivider(Modifier.padding(vertical = 8.dp))
        "page_break" -> Text("Page break", color = muted)
        else -> Text(block.text.ifEmpty { " " })
    }
}

/** The document as `html()` writes it, in a web view: bold, lists in their styles, tables. */
@Composable
private fun Preview(html: String) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { WebView(it) },
        update = { view ->
            val page = """
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>body { font-family: sans-serif; margin: 16px; line-height: 1.45; }
                table { border-collapse: collapse; } td, th { border: 1px solid #bbb; padding: 4px 8px; }</style>
                $html
            """.trimIndent()
            view.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
        },
    )
}

/** A field to type into the document at the caret, and the keys a keyboard would have. */
@Composable
private fun TypingBar(editor: EditorViewModel) {
    var typed by remember { mutableStateOf("") }
    val send = {
        editor.type(typed)
        typed = ""
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        OutlinedTextField(value = typed, onValueChange = { typed = it }, placeholder = { Text("Type at the caret…") }, singleLine = true, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Button(onClick = send, enabled = typed.isNotEmpty()) { Text("Add") }
        TextButton(onClick = { editor.run { it.splitBlock() } }) { Text("Enter") }
        TextButton(onClick = { editor.run { it.backspace() } }) { Text("⌫") }
    }
}

@Composable
private fun StartDialog(onDismiss: () -> Unit, onApply: (Int) -> Unit) {
    var text by remember { mutableStateOf("1") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Start numbering at") },
        text = { OutlinedTextField(value = text, onValueChange = { text = it.filter(Char::isDigit) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true) },
        confirmButton = { TextButton(onClick = { text.toIntOrNull()?.let(onApply); onDismiss() }) { Text("Apply") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
