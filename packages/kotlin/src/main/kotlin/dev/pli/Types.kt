package dev.pli

import kotlinx.serialization.Serializable

/** Where a caret or an end of a selection is: a block, and a position in its text in UTF-16 units (what a Kotlin `String` index counts). */
@Serializable
data class PliPoint(val block: String, val offset: Int)

@Serializable
data class PliSelection(val anchor: PliPoint, val focus: PliPoint) {
    val isCollapsed: Boolean get() = anchor == focus
}

/** A block of the document as a list shows it. [text] is empty for blocks with none (a divider, a picture). */
@Serializable
data class PliBlock(
    val id: String,
    /** `paragraph`, `heading`, `title`, `subtitle`, `quote`, `code_block`, `list_item`, `table`, `image`, `divider`, `page_break`, `toc`, `section_break`. */
    val type: String,
    val text: String = "",
    val level: Int? = null,
    val list: String? = null,
    val depth: Int? = null,
    /** For a list item: how it is marked (`decimal`, `lower-alpha`, `upper-roman`, `square`, …). */
    val marker: String? = null,
    /** For a list item: the marker as shown, such as `3.`, `iv.` or `•`. */
    val label: String? = null,
    val align: String? = null,
    val style: String? = null,
    val rows: Int? = null,
    val columns: Int? = null,
    val width: Int? = null,
    val height: Int? = null,
    val description: String? = null,
)

/** A heading, for a table of contents or an outline. */
@Serializable
data class PliOutlineEntry(val id: String, val level: Int, val text: String)

@Serializable
data class PliStatistics(val words: Int, val characters: Int, val charactersNoSpaces: Int)

/** A change someone proposed that nobody has accepted or rejected. */
@Serializable
data class PliSuggestion(
    val id: String,
    /** `insert` or `delete`. */
    val kind: String,
    /** The user id of who suggested it. */
    val by: String,
    /** When, as milliseconds since 1970. */
    val at: Double,
    val text: String,
    val block: String,
    val from: Int,
)

/** A named style of the document. */
@Serializable
data class PliStyle(
    val name: String,
    /** `paragraph` or `character`. */
    val kind: String,
    val basedOn: String? = null,
)

/**
 * Who is using the document, for suggestions and comments. Your app knows who the user is; Pli stores only the [id].
 * [role] is `viewer`, `commenter` or `editor`.
 */
@Serializable
data class PliUser(
    val id: String,
    val name: String,
    val role: String = "editor",
    /** A URL for the person's picture. Without it, their initials are shown. */
    val avatar: String? = null,
    /** A hex colour for their comments and cursor. Without it, one is chosen from the id. */
    val color: String? = null,
    val email: String? = null,
)

/** What reading a .docx file found. */
@Serializable
data class PliImportResult(
    /** What couldn't be carried over, in plain words. */
    val warnings: List<String>,
    /** The people who wrote the file's comments and tracked changes. */
    val authors: List<Author>,
) {
    @Serializable
    data class Author(val id: String, val name: String)
}

/** How to treat tracked changes in a .docx file. */
enum class PliTrackedChanges(val wire: String) {
    /** Make each a suggestion to accept or reject. */
    KEEP("keep"),

    /** Read the text as if every change were accepted. */
    ACCEPT("accept"),
}

/** The state a toolbar needs. */
@Serializable
data class PliState(
    val selection: PliSelection? = null,
    val canUndo: Boolean,
    val canRedo: Boolean,
    val suggesting: Boolean,
    val canSuggest: Boolean,
)
