import Foundation

/// Where a caret or an end of a selection is: a block, and a position in its text in UTF-16 units (what `String.utf16` counts).
public struct PliPoint: Codable, Equatable, Sendable {
    public var block: String
    public var offset: Int
    public init(block: String, offset: Int) { self.block = block; self.offset = offset }
}

public struct PliSelection: Codable, Equatable, Sendable {
    public var anchor: PliPoint
    public var focus: PliPoint
    public var isCollapsed: Bool { anchor == focus }
    public init(anchor: PliPoint, focus: PliPoint) { self.anchor = anchor; self.focus = focus }
}

/// A block of the document as a list shows it. `text` is empty for blocks with none (a divider, a picture).
public struct PliBlock: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    /// `paragraph`, `heading`, `title`, `subtitle`, `quote`, `code_block`, `list_item`, `table`, `image`, `divider`, `page_break`, `toc`, `section_break`.
    public let type: String
    public let text: String
    public let level: Int?
    public let list: String?
    public let depth: Int?
    /// For a list item: how it is marked (`decimal`, `lower-alpha`, `upper-roman`, `square`, …).
    public let marker: String?
    /// For a list item: the marker as shown, such as `3.`, `iv.` or `•`.
    public let label: String?
    public let align: String?
    public let style: String?
    public let rows: Int?
    public let columns: Int?
    public let width: Int?
    public let height: Int?
    public let description: String?

    enum CodingKeys: String, CodingKey { case id, type, text, level, list, depth, marker, label, align, style, rows, columns, width, height, description }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decode(String.self, forKey: .type)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        level = try c.decodeIfPresent(Int.self, forKey: .level)
        list = try c.decodeIfPresent(String.self, forKey: .list)
        depth = try c.decodeIfPresent(Int.self, forKey: .depth)
        marker = try c.decodeIfPresent(String.self, forKey: .marker)
        label = try c.decodeIfPresent(String.self, forKey: .label)
        align = try c.decodeIfPresent(String.self, forKey: .align)
        style = try c.decodeIfPresent(String.self, forKey: .style)
        rows = try c.decodeIfPresent(Int.self, forKey: .rows)
        columns = try c.decodeIfPresent(Int.self, forKey: .columns)
        width = try c.decodeIfPresent(Int.self, forKey: .width)
        height = try c.decodeIfPresent(Int.self, forKey: .height)
        description = try c.decodeIfPresent(String.self, forKey: .description)
    }
}

/// A heading, for a table of contents or an outline.
public struct PliOutlineEntry: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let level: Int
    public let text: String
}

public struct PliStatistics: Codable, Equatable, Sendable {
    public let words: Int
    public let characters: Int
    public let charactersNoSpaces: Int
}

/// A change someone proposed that nobody has accepted or rejected.
public struct PliSuggestion: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    /// `insert` or `delete`.
    public let kind: String
    /// The user id of who suggested it.
    public let by: String
    /// When, as milliseconds since 1970.
    public let at: Double
    public let text: String
    public let block: String
    public let from: Int
    public var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

/// A named style of the document.
public struct PliStyle: Codable, Equatable, Sendable {
    public let name: String
    /// `paragraph` or `character`.
    public let kind: String
    public let basedOn: String?
}

/// Who is using the document, for suggestions and comments. Your app knows who the user is; Pli stores only the `id`.
public struct PliUser: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    /// `viewer`, `commenter` or `editor`.
    public var role: String
    /// A URL for the person's picture. Without it, their initials are shown.
    public var avatar: String?
    /// A hex colour for their comments and cursor. Without it, one is chosen from the id.
    public var color: String?
    public var email: String?
    public init(id: String, name: String, role: String = "editor", avatar: String? = nil, color: String? = nil, email: String? = nil) {
        self.id = id; self.name = name; self.role = role; self.avatar = avatar; self.color = color; self.email = email
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "editor"
        avatar = try c.decodeIfPresent(String.self, forKey: .avatar)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        email = try c.decodeIfPresent(String.self, forKey: .email)
    }
    private enum CodingKeys: String, CodingKey { case id, name, role, avatar, color, email }
}

/// What reading a .docx file found.
public struct PliImportResult: Codable, Equatable, Sendable {
    /// What couldn't be carried over, in plain words.
    public let warnings: [String]
    /// The people who wrote the file's comments and tracked changes.
    public let authors: [Author]
    public struct Author: Codable, Equatable, Sendable { public let id: String; public let name: String }
}

/// How to treat tracked changes in a .docx file.
public enum PliTrackedChanges: String, Sendable {
    /// Make each a suggestion to accept or reject.
    case keep
    /// Read the text as if every change were accepted.
    case accept
}

/// The state a toolbar needs.
public struct PliState: Codable, Equatable, Sendable {
    public let selection: PliSelection?
    public let canUndo: Bool
    public let canRedo: Bool
    public let suggesting: Bool
    public let canSuggest: Bool
}
