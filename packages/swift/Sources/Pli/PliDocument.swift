import Foundation

/// A document you can edit and read, backed by the Pli engine.
///
/// It edits the way an editor does: there is a selection, `typeText` types at it, `toggleBold` formats it, `undo` undoes the
/// last step. Everything that changes the document is in `Commands.generated.swift`; this file is how it is opened,
/// read and saved.
///
/// ```swift
/// let doc = try PliDocument(title: "Notes")
/// try doc.typeText("Hello")
/// try doc.setHeading(1)
/// print(try doc.markdown())   // "# Hello\n"
/// let file = try doc.exportDocx()
/// ```
///
/// A document may be used from any thread, one call at a time.
public final class PliDocument: PliEditorCore, @unchecked Sendable {
    /// Opens a document from the JSON `json()` gave earlier, or a new empty one.
    /// - Parameters:
    ///   - json: A saved document. Without it, a new one is made.
    ///   - title: The title of a new document.
    ///   - user: Who is editing: needed for suggestions (tracked changes), and decides who may accept them.
    ///   - host: What your app provides: a comment store, a storage adapter for pictures, a directory of people.
    ///   - live: Say so when the document will be shared with `sync.start`: highlights of comments are then ordinary changes that go to everyone.
    public init(json: String? = nil, title: String = "Untitled", user: PliUser? = nil, host: PliHost = PliHost(), live: Bool = false) throws {
        let (engine, handle) = try PliEditorCore.start(.documents, format: "json", data: json, options: ["title": .string(title), "live": .bool(live)], host: host, user: user)
        super.init(engine: engine, handle: handle, host: host)
    }

    // MARK: Reading

    /// The document as JSON text, to save and open again with `init(json:)`.
    public func json() throws -> String { try read("document") }
    public func title() throws -> String { try read("title") }
    public func plainText() throws -> String { try read("plainText") }
    public func markdown() throws -> String { try read("markdown") }
    public func html() throws -> String { try read("html") }
    /// The blocks in reading order, table cells included.
    public func blocks() throws -> [PliBlock] { try read("blocks") }
    public func outline() throws -> [PliOutlineEntry] { try read("outline") }
    public func statistics() throws -> PliStatistics { try read("statistics") }
    public func selection() throws -> PliSelection? { try read("selection") }
    public func suggestions() throws -> [PliSuggestion] { try read("suggestions") }
    public func styles() throws -> [String: PliStyle] { try read("styles") }
    public func state() throws -> PliState { try read("state") }

    // MARK: Files

    /// The document as a .docx file.
    public func exportDocx() throws -> Data {
        let base64: String = try engine.call("exportDocx", [handle])
        guard let data = Data(base64Encoded: base64) else { throw PliError(code: "engine", message: "The engine's file wasn't valid") }
        return data
    }

    /// Replaces the document with a .docx file, as one undo step.
    @discardableResult
    public func importDocx(_ data: Data, trackedChanges: PliTrackedChanges? = nil) throws -> PliImportResult {
        struct Options: Encodable { var trackedChanges: String? }
        let options = String(decoding: try JSONEncoder().encode(Options(trackedChanges: trackedChanges?.rawValue)), as: UTF8.self)
        return try engine.call("importDocx", [handle, data.base64EncodedString(), options])
    }

    // MARK: Plumbing for the generated commands

    func read<T: Decodable>(_ what: String) throws -> T { try engine.call("read", [handle, what]) }

    func invoke<T: Decodable>(_ name: String, _ arguments: [Any?]) throws -> T {
        try engine.call("invoke", [handle, name, try Self.json(arguments)])
    }

    func invokeVoid(_ name: String, _ arguments: [Any?]) throws {
        let _: PliJSON = try engine.call("invoke", [handle, name, try Self.json(arguments)])
    }

    private static func json(_ arguments: [Any?]) throws -> String {
        let values = arguments.map { $0 ?? NSNull() }
        let data = try JSONSerialization.data(withJSONObject: values)
        return String(decoding: data, as: UTF8.self)
    }
}
