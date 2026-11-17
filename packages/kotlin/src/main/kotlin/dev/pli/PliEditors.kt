package dev.pli

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.Base64

// A workbook, a deck and a PDF, as Kotlin opens them. Everything they can do is generated (`Sheets.generated.kt`,
// `Decks.generated.kt`, `Pdf.generated.kt`) from the same catalog the engine checks calls against.

private fun b64(data: ByteArray) = Base64.getEncoder().encodeToString(data)

private fun PliEditorCore.warningsOf(): List<String> =
    stateJson()["warnings"]?.let { lenient.decodeFromJsonElement(ListSerializer(String.serializer()), it) } ?: emptyList()

/**
 * A workbook: sheets of cells with formulas that recalculate, number formats, styles, tables and charts. Comments anchor to a cell or
 * range (`commentOnRange`). Files: `.xlsx`, CSV and PDF.
 *
 * ```kotlin
 * PliWorkbook(title = "Budget").use { book ->
 *     book.setCells("Sheet1", mapOf("A1" to 10, "A2" to 32, "A3" to "=SUM(A1:A2)"))
 *     println(book.text("Sheet1", "A3"))   // "42"
 *     val file: ByteArray = book.exportXlsx()
 * }
 * ```
 *
 * @param json A saved workbook ([documentJson] gave it earlier). Without it, a new one is made.
 * @param title The title of a new workbook.
 * @param sheets The names of the sheets of a new workbook (one, `Sheet1`, by default).
 * @param user Who is editing: stamps notes and decides what a protected sheet allows.
 * @param host What your app provides: a comment store, a directory of people.
 */
class PliWorkbook private constructor(engine: PliEngine, host: PliHost, opener: () -> Int) : PliEditorCore(engine, host, opener) {
    constructor(
        json: String? = null,
        title: String = "Untitled",
        sheets: List<String>? = null,
        user: PliUser? = null,
        host: PliHost = PliHost(),
        engine: PliEngine = PliEngine.shared(PliEditorKind.SHEETS),
    ) : this(engine, host, { start(engine, PliEditorKind.SHEETS, "json", json, mapOf("title" to title, "sheets" to sheets), host, user) })

    /** What reading an .xlsx file couldn't carry over, in plain words. */
    fun warnings(): List<String> = warningsOf()

    companion object {
        /** Opens an .xlsx file. */
        fun fromXlsx(data: ByteArray, user: PliUser? = null, host: PliHost = PliHost(), engine: PliEngine = PliEngine.shared(PliEditorKind.SHEETS)): PliWorkbook =
            PliWorkbook(engine, host) { start(engine, PliEditorKind.SHEETS, "xlsx", b64(data), emptyMap(), host, user) }

        /** Opens CSV text as a workbook with one sheet. */
        fun fromCsv(text: String, user: PliUser? = null, host: PliHost = PliHost(), engine: PliEngine = PliEngine.shared(PliEditorKind.SHEETS)): PliWorkbook =
            PliWorkbook(engine, host) { start(engine, PliEditorKind.SHEETS, "csv", text, emptyMap(), host, user) }
    }
}

/**
 * A deck of slides: masters and layouts, text, shapes, pictures, tables and charts, with notes and transitions. Comments anchor to a
 * slide or one of its elements. Files: `.pptx` and PDF.
 *
 * ```kotlin
 * PliDeck(title = "Launch").use { deck ->
 *     val slide = deck.slides()[0].id
 *     deck.addTextBox(slide, 40.0, 200.0, 400.0, 40.0, "Quarterly review")
 *     val file: ByteArray = deck.exportPptx()
 * }
 * ```
 */
class PliDeck private constructor(engine: PliEngine, host: PliHost, opener: () -> Int) : PliEditorCore(engine, host, opener) {
    constructor(
        json: String? = null,
        title: String = "Untitled presentation",
        user: PliUser? = null,
        host: PliHost = PliHost(),
        engine: PliEngine = PliEngine.shared(PliEditorKind.DECKS),
    ) : this(engine, host, { start(engine, PliEditorKind.DECKS, "json", json, mapOf("title" to title), host, user) })

    /** What reading a .pptx file couldn't carry over, in plain words. */
    fun warnings(): List<String> = warningsOf()

    companion object {
        /** Opens a .pptx file. */
        fun fromPptx(data: ByteArray, user: PliUser? = null, host: PliHost = PliHost(), engine: PliEngine = PliEngine.shared(PliEditorKind.DECKS)): PliDeck =
            PliDeck(engine, host) { start(engine, PliEditorKind.DECKS, "pptx", b64(data), emptyMap(), host, user) }
    }
}

/**
 * A PDF: pages, annotations, form fields, text search and redaction. It writes back as the original file plus your changes, so what
 * you didn't touch stays byte for byte. Comments are kept in the PDF (as notes and replies other readers show) or in your store.
 *
 * ```kotlin
 * PliPdf.open(file).use { pdf ->
 *     val page = pdf.pages()[0].id
 *     pdf.addNote(page, 100.0, 100.0, "Check this")
 *     val saved: ByteArray = pdf.exportPdf()
 * }
 * ```
 */
class PliPdf private constructor(engine: PliEngine, host: PliHost, opener: () -> Int) : PliEditorCore(engine, host, opener) {
    /** A new PDF with one blank page (Letter size unless told). */
    constructor(
        width: Double = 612.0,
        height: Double = 792.0,
        user: PliUser? = null,
        host: PliHost = PliHost(),
        engine: PliEngine = PliEngine.shared(PliEditorKind.PDF),
    ) : this(engine, host, { start(engine, PliEditorKind.PDF, "json", null, mapOf("width" to width, "height" to height), host, user) })

    /** Whether there are changes the last `exportPdf` didn't write. */
    fun isDirty(): Boolean = stateJson()["dirty"]?.jsonPrimitive?.booleanOrNull ?: false

    companion object {
        /**
         * Opens a PDF file.
         * @param name The file's name, kept with the document.
         * @param password For an encrypted file.
         * @param user Who is editing: stamped on annotations and comments.
         * @param host What your app provides. With a storage adapter, the PDF's own file is kept there as well.
         */
        fun open(data: ByteArray, name: String? = null, password: String? = null, user: PliUser? = null, host: PliHost = PliHost(), engine: PliEngine = PliEngine.shared(PliEditorKind.PDF)): PliPdf =
            PliPdf(engine, host) { start(engine, PliEditorKind.PDF, "pdf", b64(data), mapOf("name" to name, "password" to password), host, user) }
    }
}
