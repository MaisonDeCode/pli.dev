import Foundation

/// Character formatting on a run of text.
public struct PliMarks: Codable, Equatable, Sendable {
    public var bold: Bool?
    public var italic: Bool?
    public var underline: Bool?
    public var strike: Bool?
    public var code: Bool?
    public var superscript: Bool?
    public var `subscript`: Bool?
    /// A web address, mail address or phone number the text links to.
    public var link: String?
    /// A hex colour such as `#b91c1c`.
    public var color: String?
    public var highlight: String?
    public var fontFamily: String?
    /// In points.
    public var fontSize: Double?
    /// Set on the one character that stands for a footnote reference.
    public var footnote: String?
    /// Set on text that is a computed value, such as a page number: `page` or `pages`.
    public var field: String?
}

/// A stretch of text with the same formatting.
public struct PliRun: Codable, Equatable, Sendable {
    public var text: String
    public var marks: PliMarks?
}

/// How much of a picture is cut away from each edge, as a share of the whole picture (0 to 0.9).
public struct PliCrop: Codable, Equatable, Sendable {
    public var top: Double
    public var right: Double
    public var bottom: Double
    public var left: Double
    public static let none = PliCrop(top: 0, right: 0, bottom: 0, left: 0)
    public init(top: Double, right: Double, bottom: Double, left: Double) { self.top = top; self.right = right; self.bottom = bottom; self.left = left }
}

/// Spacing and indents of a paragraph, in points.
public struct PliParagraphFormat: Codable, Equatable, Sendable {
    public var lineHeight: Double?
    public var spaceBefore: Double?
    public var spaceAfter: Double?
    public var indentLeft: Double?
    public var indentRight: Double?
    public var indentFirst: Double?
}

public struct PliTableCell: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    /// The blocks in the cell. A cell covered by a merged cell has none worth drawing.
    public var blocks: [PliContentBlock]
    public var colSpan: Int?
    public var rowSpan: Int?
    public var covered: Bool?
    public var shade: String?
}

public struct PliTableRow: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public var cells: [PliTableCell]
    /// The least height of the row, in points. Unset means it fits its content.
    public var height: Double?
}

/// A block of the document with everything needed to draw it: its text in runs with their formatting, a table's cells, a picture's source.
///
/// `type` is `paragraph`, `heading`, `title`, `subtitle`, `quote`, `code_block`, `list_item`, `table`, `image`, `divider`, `page_break`,
/// `toc` or `section_break`. Only the fields that belong to a type are set.
public struct PliContentBlock: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public var type: String
    // Text blocks
    public var runs: [PliRun]?
    public var level: Int?
    public var align: String?
    public var format: PliParagraphFormat?
    // List items
    public var list: String?
    public var depth: Int?
    /// The marker as it is shown: `1.`, `iv.`, `•`.
    public var label: String?
    // Pictures
    public var src: String?
    public var width: Double?
    public var height: Double?
    public var alt: String?
    /// `left` or `right`: text wraps around the picture, which sits at that edge. Without it the picture is on a line of its own.
    public var wrap: String?
    /// What is cut away from the picture. `width` and `height` are the size of what is left.
    public var crop: PliCrop?
    // Tables
    public var rows: [PliTableRow]?
    public var columns: [Double]?
    public var headerRow: Bool?

    /// The text of a text block, without formatting.
    public var text: String { (runs ?? []).map(\.text).joined() }
    public var isText: Bool { runs != nil }
}

/// A value that may differ across the selection.
public struct PliMixed<Value: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    /// The value of the first selected character, or nil if it has none.
    public var value: Value?
    /// True when the selected characters have different values.
    public var mixed: Bool
}

/// What a toolbar needs to know about the selection: which formatting is on, the kind of block, the alignment, undo and redo.
public struct PliFormat: Codable, Equatable, Sendable {
    public struct Block: Codable, Equatable, Sendable {
        /// `paragraph`, `heading`, `title`, `subtitle`, `quote`, `code_block` or `list_item`.
        public var type: String
        public var level: Int?
        /// `bullet` or `ordered`, for a list item.
        public var list: String?
    }

    public struct Marks: Codable, Equatable, Sendable {
        public var bold = false
        public var italic = false
        public var underline = false
        public var strike = false
        public var code = false
        public var superscript = false
        public var `subscript` = false
    }

    public struct List: Codable, Equatable, Sendable {
        public var kind: String
        public var marker: String
        public var number: Int?
        public var restarts: Bool
    }

    /// The table the selection is in, if any.
    public struct Image: Codable, Equatable, Sendable {
        public var id: String
        public var wrap: String?
    }

    public struct Table: Codable, Equatable, Sendable {
        public var id: String
        public var rows: Int
        public var columns: Int
        /// The cell the caret is in, or the first cell of a selection of cells.
        public var row: Int?
        public var column: Int?
        public var selectedRows: Int
        public var selectedColumns: Int
        public var headerRow: Bool
        public var shade: String?
        /// True when the selection runs from one cell to another, so the cells can be merged.
        public var canMerge: Bool
        /// True when the selection includes a merged cell.
        public var canSplit: Bool
    }

    public var marks: Marks
    public var fontFamily: PliMixed<String>
    public var fontSize: PliMixed<Double>
    public var color: PliMixed<String>
    public var highlight: PliMixed<String>
    public var link: PliMixed<String>
    /// The kind of every selected block, or nil if they differ.
    public var block: Block?
    public var align: String?
    public var list: List?
    public var table: Table?
    /// The picture that is selected, if any.
    public var image: Image?
    public var canIndent: Bool
    public var canOutdent: Bool
    public var canUndo: Bool
    public var canRedo: Bool

    public static let empty = PliFormat(
        marks: Marks(), fontFamily: .init(value: nil, mixed: false), fontSize: .init(value: nil, mixed: false), color: .init(value: nil, mixed: false),
        highlight: .init(value: nil, mixed: false), link: .init(value: nil, mixed: false), block: nil, align: nil, list: nil, table: nil, image: nil,
        canIndent: false, canOutdent: false, canUndo: false, canRedo: false
    )
}

extension PliDocument {
    /// The blocks of the document with their text in runs, for drawing them.
    public func content() throws -> [PliContentBlock] { try read("content") }

    /// What a toolbar needs to know about the selection.
    public func format() throws -> PliFormat { try read("format") }

    /// The selected text as plain text, one line per block (cells of a table in tab-separated rows).
    public func selectedText() throws -> String { try read("selectedText") }
}

/// The selected content as a clipboard wants it: plain text, and HTML that keeps the formatting.
public struct PliClipboardContent: Codable, Equatable, Sendable {
    public var text: String
    public var html: String
}

extension PliDocument {
    /// The selection as plain text and as HTML, to put on a pasteboard.
    public func clipboard() throws -> PliClipboardContent { try read("clipboard") }
}
