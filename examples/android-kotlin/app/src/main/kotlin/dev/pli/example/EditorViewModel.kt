package dev.pli.example

import android.app.Application
import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.pli.PliBlock
import dev.pli.PliDocument
import dev.pli.PliState
import dev.pli.PliStatistics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

/** What the screen draws: everything is read from the document again after each change. */
data class EditorState(
    val blocks: List<PliBlock> = emptyList(),
    val state: PliState? = null,
    val statistics: PliStatistics? = null,
    val html: String = "",
    val message: String? = null,
) {
    /** The block the caret is in. */
    val current: PliBlock? get() = state?.selection?.focus?.block?.let { id -> blocks.firstOrNull { it.id == id } }
}

enum class ExportFormat(val title: String, val extension: String, val mime: String) {
    DOCX("DOCX file (.docx)", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    MARKDOWN("Markdown (.md)", "md", "text/markdown"),
    HTML("Web page (.html)", "html", "text/html"),
}

/**
 * Holds a [PliDocument] and the state read from it. Every change goes through [run], which does it on a background thread
 * (the engine blocks while it works), saves the document, and reads it again: the document is the one source of truth.
 */
class EditorViewModel(app: Application) : AndroidViewModel(app) {
    private val file = File(app.filesDir, "Example.pli.json")
    private var document: PliDocument? = null

    private val _state = MutableStateFlow(EditorState())
    val state: StateFlow<EditorState> = _state

    init {
        viewModelScope.launch(Dispatchers.Default) {
            // Open what was saved last time, or start with a short sample.
            val saved = runCatching { file.readText() }.getOrNull()
            document = saved?.let { runCatching { PliDocument(json = it) }.getOrNull() }
                ?: PliDocument(title = "My document").also { writeSample(it) }
            refresh()
        }
    }

    fun run(change: (PliDocument) -> Unit) {
        viewModelScope.launch(Dispatchers.Default) {
            val doc = document ?: return@launch
            try {
                change(doc)
                file.writeText(doc.json())
            } catch (e: Exception) {
                _state.update { it.copy(message = e.message) }
            }
            refresh()
        }
    }

    /** Puts the caret at the end of a block, as tapping on it does. */
    fun place(block: PliBlock) = run { it.select(block.id, block.text.length, block.id, block.text.length) }

    fun type(text: String) {
        if (text.isNotEmpty()) run { it.typeText(text) }
    }

    fun dismissMessage() = _state.update { it.copy(message = null) }

    // Files.

    fun export(format: ExportFormat, uri: Uri, resolver: ContentResolver) {
        viewModelScope.launch(Dispatchers.IO) {
            val doc = document ?: return@launch
            try {
                val bytes = when (format) {
                    ExportFormat.DOCX -> doc.exportDocx()
                    ExportFormat.MARKDOWN -> doc.markdown().toByteArray()
                    ExportFormat.HTML -> doc.html().toByteArray()
                }
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
            } catch (e: Exception) {
                _state.update { it.copy(message = e.message) }
            }
        }
    }

    fun importDocx(uri: Uri, resolver: ContentResolver) {
        viewModelScope.launch(Dispatchers.IO) {
            val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return@launch
            run { doc ->
                val result = doc.importDocx(bytes)
                if (result.warnings.isNotEmpty()) _state.update { it.copy(message = "Opened, with notes: " + result.warnings.joinToString(" ")) }
            }
        }
    }

    fun startOver() = run {
        it.selectAll()
        it.deleteSelection()
        writeSample(it)
    }

    private fun refresh() {
        val doc = document ?: return
        try {
            _state.update {
                it.copy(blocks = doc.blocks(), state = doc.state(), statistics = doc.statistics(), html = doc.html())
            }
        } catch (e: Exception) {
            _state.update { it.copy(message = e.message) }
        }
    }

    private fun writeSample(doc: PliDocument) {
        doc.setParagraph()
        doc.typeText("Welcome to Pli")
        doc.setHeading(1)
        doc.splitBlock()
        doc.typeText("This is an ordinary document made through the Kotlin API. Tap a block to move the caret, use the buttons above to format it, and type below.")
        doc.splitBlock()
        doc.typeText("It has lists")
        doc.splitBlock()
        doc.typeText("Numbered, lettered or in roman numerals")
        doc.toggleNumberedList()
        doc.splitBlock()
        doc.typeText("Restarted or started at any number")
        doc.splitBlock()
        doc.typeText("Saved as a DOCX file")
    }

    override fun onCleared() {
        document?.close()
    }
}
