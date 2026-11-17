package dev.pli

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive

/** Character formatting on a run of text. */
@Serializable
data class PliMarks(
    val bold: Boolean? = null,
    val italic: Boolean? = null,
    val underline: Boolean? = null,
    val strike: Boolean? = null,
    val code: Boolean? = null,
    val superscript: Boolean? = null,
    val `subscript`: Boolean? = null,
    /** A web address, mail address or phone number the text links to. */
    val link: String? = null,
    /** A hex colour such as `#b91c1c`. */
    val color: String? = null,
    val highlight: String? = null,
    val fontFamily: String? = null,
    /** In points. */
    val fontSize: Double? = null,
    /** Set on the one character that stands for a footnote reference. */
    val footnote: String? = null,
    /** Set on text that is a computed value, such as a page number: `page` or `pages`. */
    val field: String? = null,
)

/** A stretch of text with the same formatting. */
@Serializable
data class PliRun(val text: String, val marks: PliMarks? = null)

/** How much of a picture is cut away from each edge, as a share of the whole picture (0 to 0.9). */
@Serializable
data class PliCrop(val top: Double = 0.0, val right: Double = 0.0, val bottom: Double = 0.0, val left: Double = 0.0) {
    companion object {
        val None = PliCrop()
    }
}

/** Spacing and indents of a paragraph, in points. */
@Serializable
data class PliParagraphFormat(
    val lineHeight: Double? = null,
    val spaceBefore: Double? = null,
    val spaceAfter: Double? = null,
    val indentLeft: Double? = null,
    val indentRight: Double? = null,
    val indentFirst: Double? = null,
)

@Serializable
data class PliTableCell(
    val id: String,
    /** The blocks in the cell. A cell covered by a merged cell has none worth drawing. */
    val blocks: List<PliContentBlock> = emptyList(),
    val colSpan: Int? = null,
    val rowSpan: Int? = null,
    val covered: Boolean? = null,
    val shade: String? = null,
)

@Serializable
data class PliTableRow(
    val id: String,
    val cells: List<PliTableCell> = emptyList(),
    /** The least height of the row, in points. Unset means it fits its content. */
    val height: Double? = null,
)

/**
 * A block of the document with everything needed to draw it: its text in [runs] with their formatting, a table's cells, a picture's source.
 *
 * [type] is `paragraph`, `heading`, `title`, `subtitle`, `quote`, `code_block`, `list_item`, `table`, `image`, `divider`, `page_break`,
 * `toc` or `section_break`. Only the fields that belong to a type are set.
 */
@Serializable
data class PliContentBlock(
    val id: String,
    val type: String,
    // Text blocks
    val runs: List<PliRun>? = null,
    val level: Int? = null,
    val align: String? = null,
    val format: PliParagraphFormat? = null,
    // List items
    val list: String? = null,
    val depth: Int? = null,
    /** The marker as it is shown: `1.`, `iv.`, `•`. */
    val label: String? = null,
    // Pictures
    val src: String? = null,
    val width: Double? = null,
    val height: Double? = null,
    val alt: String? = null,
    /** `left` or `right`: text wraps around the picture, which sits at that edge. Without it the picture is on a line of its own. */
    val wrap: String? = null,
    /** What is cut away from the picture. [width] and [height] are the size of what is left. */
    val crop: PliCrop? = null,
    // Tables
    val rows: List<PliTableRow>? = null,
    val columns: List<Double>? = null,
    val headerRow: Boolean? = null,
) {
    /** The text of a text block, without formatting. */
    val text: String get() = runs.orEmpty().joinToString("") { it.text }
    val isText: Boolean get() = runs != null
}

/** A value that may differ across the selection. */
@Serializable
data class PliMixed<Value>(
    /** The value of the first selected character, or null if it has none. */
    val value: Value? = null,
    /** True when the selected characters have different values. */
    val mixed: Boolean = false,
)

/** What a toolbar needs to know about the selection: which formatting is on, the kind of block, the alignment, undo and redo. */
@Serializable
data class PliFormat(
    val marks: Marks = Marks(),
    val fontFamily: PliMixed<String> = PliMixed(),
    val fontSize: PliMixed<Double> = PliMixed(),
    val color: PliMixed<String> = PliMixed(),
    val highlight: PliMixed<String> = PliMixed(),
    val link: PliMixed<String> = PliMixed(),
    /** The kind of every selected block, or null if they differ. */
    val block: Block? = null,
    val align: String? = null,
    val list: ListState? = null,
    /** The picture that is selected, if any. */
    val image: Image? = null,
    /** The table the selection is in, if any. */
    val table: Table? = null,
    val canIndent: Boolean = false,
    val canOutdent: Boolean = false,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
) {
    @Serializable
    data class Block(
        /** `paragraph`, `heading`, `title`, `subtitle`, `quote`, `code_block` or `list_item`. */
        val type: String,
        val level: Int? = null,
        /** `bullet` or `ordered`, for a list item. */
        val list: String? = null,
    )

    @Serializable
    data class Marks(
        val bold: Boolean = false,
        val italic: Boolean = false,
        val underline: Boolean = false,
        val strike: Boolean = false,
        val code: Boolean = false,
        val superscript: Boolean = false,
        val `subscript`: Boolean = false,
    )

    @Serializable
    data class Image(val id: String, val wrap: String? = null)

    @Serializable
    data class Table(
        val id: String,
        val rows: Int,
        val columns: Int,
        /** The cell the caret is in, or the first cell of a selection of cells. */
        val row: Int? = null,
        val column: Int? = null,
        val selectedRows: Int = 1,
        val selectedColumns: Int = 1,
        val headerRow: Boolean = false,
        val shade: String? = null,
        /** True when the selection runs from one cell to another, so the cells can be merged. */
        val canMerge: Boolean = false,
        /** True when the selection includes a merged cell. */
        val canSplit: Boolean = false,
    )

    @Serializable
    data class ListState(val kind: String, val marker: String, val number: Int? = null, val restarts: Boolean = false)
}

private val contentJson = Json { ignoreUnknownKeys = true; coerceInputValues = true }

/** The blocks of the document with their text in runs, for drawing them. */
fun PliDocument.content(): List<PliContentBlock> = contentJson.decodeFromString(ListSerializer(PliContentBlock.serializer()), readJson("content"))

/** What a toolbar needs to know about the selection. */
fun PliDocument.format(): PliFormat = contentJson.decodeFromString(PliFormat.serializer(), readJson("format"))

/** The selected text as plain text, one line per block (cells of a table in tab-separated rows). */
fun PliDocument.selectedText(): String = Json.parseToJsonElement(readJson("selectedText")).jsonPrimitive.content

/** The selected content as a clipboard wants it: plain text, and HTML that keeps the formatting. */
@Serializable
data class PliClipboardContent(val text: String, val html: String)

/** The selection as plain text and as HTML, to put on the clipboard. */
fun PliDocument.clipboard(): PliClipboardContent = contentJson.decodeFromString(PliClipboardContent.serializer(), readJson("clipboard"))
