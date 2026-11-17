import Foundation

// A workbook, a deck and a PDF, as Swift opens them. Everything they can do is generated (`Sheets.generated.swift`,
// `Decks.generated.swift`, `Pdf.generated.swift`) from the same catalog the engine checks calls against.

/// A workbook: sheets of cells with formulas that recalculate, number formats, styles, tables and charts. Comments anchor to a cell or
/// range (`commentOnRange`). Files: `.xlsx`, CSV and PDF.
///
/// ```swift
/// let book = try PliWorkbook(title: "Budget")
/// try book.setCells(sheet: "Sheet1", ["A1": 10, "A2": 32, "A3": "=SUM(A1:A2)"])
/// print(try book.text(sheet: "Sheet1", address: "A3"))   // "42"
/// let file = try book.exportXlsx()
/// ```
public final class PliWorkbook: PliEditorCore, @unchecked Sendable {
    /// Opens a workbook from the JSON `documentJSON()` gave earlier, or a new one.
    /// - Parameters:
    ///   - json: A saved workbook. Without it, a new one is made.
    ///   - title: The title of a new workbook.
    ///   - sheets: The names of the sheets of a new workbook (one, `Sheet1`, by default).
    ///   - user: Who is editing: stamps notes and decides what a protected sheet allows.
    ///   - host: What your app provides: a comment store, a directory of people.
    public init(json: String? = nil, title: String = "Untitled", sheets: [String]? = nil, user: PliUser? = nil, host: PliHost = PliHost()) throws {
        var options: [String: PliJSON] = ["title": .string(title)]
        if let sheets { options["sheets"] = .array(sheets.map { .string($0) }) }
        let (engine, handle) = try PliEditorCore.start(.sheets, format: "json", data: json, options: options, host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    /// Opens an .xlsx file. What couldn't be carried over is in `warnings`.
    public init(xlsx data: Data, user: PliUser? = nil, host: PliHost = PliHost()) throws {
        let (engine, handle) = try PliEditorCore.start(.sheets, format: "xlsx", data: data.base64EncodedString(), options: [:], host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    /// Opens CSV text as a workbook with one sheet.
    public init(csv text: String, user: PliUser? = nil, host: PliHost = PliHost()) throws {
        let (engine, handle) = try PliEditorCore.start(.sheets, format: "csv", data: text, options: [:], host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    /// What reading an .xlsx file couldn't carry over, in plain words.
    public func warnings() throws -> [String] { try stateJSON()["warnings"]?.decode([String].self) ?? [] }
}

/// A deck of slides: masters and layouts, text, shapes, pictures, tables and charts, with notes and transitions. Comments anchor to a
/// slide or one of its elements. Files: `.pptx` and PDF.
///
/// ```swift
/// let deck = try PliDeck(title: "Launch")
/// let slide = try deck.slides()[0].id
/// try deck.addTextBox(slide, x: 40, y: 200, w: 400, h: 40, text: "Quarterly review")
/// let file = try deck.exportPptx()
/// ```
public final class PliDeck: PliEditorCore, @unchecked Sendable {
    /// Opens a deck from the JSON `documentJSON()` gave earlier, or a new one with a title slide.
    public init(json: String? = nil, title: String = "Untitled presentation", user: PliUser? = nil, host: PliHost = PliHost()) throws {
        let (engine, handle) = try PliEditorCore.start(.decks, format: "json", data: json, options: ["title": .string(title)], host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    /// Opens a .pptx file. What couldn't be carried over is in `warnings`.
    public init(pptx data: Data, user: PliUser? = nil, host: PliHost = PliHost()) throws {
        let (engine, handle) = try PliEditorCore.start(.decks, format: "pptx", data: data.base64EncodedString(), options: [:], host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    public func warnings() throws -> [String] { try stateJSON()["warnings"]?.decode([String].self) ?? [] }
}

/// A PDF: pages, annotations, form fields, text search and redaction. It writes back as the original file plus your changes, so what
/// you didn't touch stays byte for byte. Comments are kept in the PDF (as notes and replies other readers show) or in your store.
///
/// ```swift
/// let pdf = try PliPdf(data: file)
/// let page = try pdf.pages()[0].id
/// try pdf.addNote(page: page, x: 100, y: 100, text: "Check this")
/// let saved = try await pdf.exportPdf()
/// ```
public final class PliPdf: PliEditorCore, @unchecked Sendable {
    /// Opens a PDF file.
    /// - Parameters:
    ///   - data: The file's bytes.
    ///   - name: The file's name, kept with the document.
    ///   - password: For an encrypted file.
    ///   - user: Who is editing: stamped on annotations and comments.
    ///   - host: What your app provides. With a storage adapter, the PDF's own file is kept there as well.
    public init(data: Data, name: String? = nil, password: String? = nil, user: PliUser? = nil, host: PliHost = PliHost()) throws {
        var options: [String: PliJSON] = [:]
        if let name { options["name"] = .string(name) }
        if let password { options["password"] = .string(password) }
        let (engine, handle) = try PliEditorCore.start(.pdf, format: "pdf", data: data.base64EncodedString(), options: options, host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    /// A new PDF with one blank page (Letter size unless told).
    public init(width: Double = 612, height: Double = 792, user: PliUser? = nil, host: PliHost = PliHost()) throws {
        let (engine, handle) = try PliEditorCore.start(.pdf, format: "json", data: nil, options: ["width": .number(width), "height": .number(height)], host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    /// Whether there are changes the last `exportPdf` didn't write.
    public func isDirty() throws -> Bool { try stateJSON()["dirty"]?.boolValue ?? false }
}
