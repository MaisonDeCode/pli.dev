package dev.pli.example

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import dev.pli.PliEditor
import java.io.File

/**
 * The whole editor, in a few lines: [PliEditor] is the same editor as the JavaScript package's `PliDocument`, with its menus,
 * toolbar, pages, tables, lists, comments, and DOCX and PDF files. It keeps the document in a string you own, so saving it is
 * writing that string somewhere.
 */
@Composable
fun FullEditorScreen() {
    val file = File(LocalContext.current.filesDir, "Editor.pli.json")
    var document by remember { mutableStateOf(runCatching { file.readText() }.getOrDefault("")) }

    PliEditor(
        json = document,
        onJsonChange = {
            document = it
            file.writeText(it)
        },
        modifier = Modifier.fillMaxSize(),
    )
}
