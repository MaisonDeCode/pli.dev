package dev.pli.example

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.pli.PliBlocks
import dev.pli.PliToolbar
import dev.pli.rememberPliDocumentState
import dev.pli.wrapPicture

/**
 * The native building blocks: the document drawn as editable blocks ([PliBlocks]), with a toolbar of buttons and menus
 * ([PliToolbar]) bound to it. Both read and change one document state.
 *
 * Here they are laid out by hand, so you can see where your own views would go. Each piece of the toolbar (`PliMarkButtons`,
 * `PliStyleMenu`, `PliListMenu`…) works on its own, too.
 */
@Composable
fun NativeEditorScreen() {
    val state = rememberPliDocumentState(title = "Native")
    // Start with a title and a line to type into.
    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (state.blocks.all { it.text.isEmpty() }) {
            state.perform {
                setTitle()
                typeText("Native building blocks")
                splitBlock()
                setParagraph()
                typeText("Type here. The toolbar below is made of the same pieces you can use on their own.")
                // A small table to try the rows, columns and cells menu on: press and drag from one cell to another to merge them.
                splitBlock()
                insertTable(2, 3)
            }
            val labels = listOf("Item", "Qty", "Price", "Pens", "4", "$2")
            val cells = state.blocks.lastOrNull { it.type == "table" }?.rows.orEmpty().flatMap { it.cells }
            for ((cell, label) in cells.zip(labels)) {
                val id = cell.blocks.firstOrNull()?.id ?: continue
                state.perform {
                    select(id, 0, id, 0)
                    typeText(label)
                }
            }
        }
    }
    // A picture to try resizing on: tap it, then drag the dot on its corner.
    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (state.blocks.none { it.type == "image" }) {
            val bitmap = android.graphics.Bitmap.createBitmap(300, 180, android.graphics.Bitmap.Config.ARGB_8888)
            android.graphics.Canvas(bitmap).drawRect(
                0f, 0f, 300f, 180f,
                android.graphics.Paint().apply {
                    shader = android.graphics.LinearGradient(0f, 0f, 300f, 180f, 0xFF6366F1.toInt(), 0xFF06B6D4.toInt(), android.graphics.Shader.TileMode.CLAMP)
                },
            )
            val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
            state.blocks.lastOrNull { it.isText }?.let { state.focus(it.id) }
            state.perform { insertImage("data:image/png;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP), 150, 90, "A gradient") }
            // Text wraps around a picture set to wrap, like this one: choose it from the picture menu (Text on the right), or crop it there.
            state.blocks.firstOrNull { it.type == "image" }?.let { picture ->
                state.wrapPicture(picture.id, "left")
                state.blocks.lastOrNull { it.isText }?.let { state.focus(it.id) }
                state.perform {
                    typeText("This text runs along the side of the picture, and carries on under it once it is past. ")
                    typeText("Pictures can be cropped from the picture menu, and text wrapped around them, as in a word processor. ")
                    typeText("Tap the picture to select it, then use the menu in the toolbar.")
                }
            }
            // A picture in a table cell has text wrapped around it too: type the text first, then put the picture in front of it.
            state.blocks.lastOrNull { it.isText }?.let { state.focus(it.id) }
            state.perform { splitBlock(); insertTable(1, 1) }
            state.blocks.lastOrNull { it.type == "table" }?.rows?.firstOrNull()?.cells?.firstOrNull()?.blocks?.firstOrNull()?.let { cell ->
                state.focus(cell.id)
                state.perform {
                    typeText("Text in a table cell wraps around a picture in the same cell, just as it does in the body of the page.")
                    select(cell.id, 0, cell.id, 0)
                    insertImage("data:image/png;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP), 90, 54, "A gradient in a cell")
                }
                state.blocks.lastOrNull { it.type == "table" }?.rows?.firstOrNull()?.cells?.firstOrNull()?.blocks?.firstOrNull { it.type == "image" }?.let { state.wrapPicture(it.id, "left") }
            }
        }
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        PliBlocks(state, Modifier.weight(1f))
        PliToolbar(state)
    }
}
