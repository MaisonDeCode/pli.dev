import Foundation

// What every editor has in common: opening, operations, changes, people, comments, live editing and files. A document, a
// workbook, a deck and a PDF each subclass `PliEditorCore`; what is particular to each (its commands, anchors for comments) is
// in `Commands.generated.swift` and the files generated for the other editors.

// MARK: - Values

extension PliJSON: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(arrayLiteral elements: PliJSON...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, PliJSON)...) { self = .object(Dictionary(elements, uniquingKeysWith: { $1 })) }
    public init(nilLiteral: ()) { self = .null }

    public var stringValue: String? { if case .string(let v) = self { return v } else { return nil } }
    public var numberValue: Double? { if case .number(let v) = self { return v } else { return nil } }
    public var intValue: Int? { numberValue.flatMap { $0 == $0.rounded() ? Int($0) : nil } }
    public var boolValue: Bool? { if case .bool(let v) = self { return v } else { return nil } }
    public var arrayValue: [PliJSON]? { if case .array(let v) = self { return v } else { return nil } }
    public var objectValue: [String: PliJSON]? { if case .object(let v) = self { return v } else { return nil } }
    public var isNull: Bool { if case .null = self { return true } else { return false } }
    public subscript(key: String) -> PliJSON? { objectValue?[key] }
    public subscript(index: Int) -> PliJSON? { arrayValue.flatMap { $0.indices.contains(index) ? $0[index] : nil } }

    /// The JSON text.
    public var text: String { String(decoding: (try? JSONEncoder().encode(self)) ?? Data("null".utf8), as: UTF8.self) }

    /// Reads JSON text.
    public static func parse(_ text: String) throws -> PliJSON { try JSONDecoder().decode(PliJSON.self, from: Data(text.utf8)) }

    /// This value as a typed one.
    public func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }

    /// A typed value as JSON.
    public static func encode<T: Encodable>(_ value: T) throws -> PliJSON {
        try JSONDecoder().decode(PliJSON.self, from: JSONEncoder().encode(value))
    }
}

/// What can be an argument of an engine method.
public protocol PliArg {
    var pliJSON: PliJSON { get }
}
extension String: PliArg { public var pliJSON: PliJSON { .string(self) } }
extension Int: PliArg { public var pliJSON: PliJSON { .number(Double(self)) } }
extension Double: PliArg { public var pliJSON: PliJSON { .number(self) } }
extension Bool: PliArg { public var pliJSON: PliJSON { .bool(self) } }
extension PliJSON: PliArg { public var pliJSON: PliJSON { self } }
extension Optional: PliArg where Wrapped: PliArg { public var pliJSON: PliJSON { self?.pliJSON ?? .null } }
extension Array: PliArg where Element: PliArg { public var pliJSON: PliJSON { .array(map(\.pliJSON)) } }
extension Dictionary: PliArg where Key == String, Value: PliArg { public var pliJSON: PliJSON { .object(mapValues(\.pliJSON)) } }
extension PliArg where Self: RawRepresentable, Self.RawValue == String { public var pliJSON: PliJSON { .string(rawValue) } }

/// What a person may do, as `PliUsers` sets it.
public enum PliRole: String, Codable, CaseIterable, Sendable {
    /// Reads, and can't comment.
    case viewer
    /// Reads and comments.
    case commenter
    /// Edits, comments and moderates comments.
    case editor
}

// MARK: - Comments

public struct PliComment: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    /// The `PliUser.id` of the author.
    public let author: String
    public let body: String
    /// Milliseconds since 1970.
    public let createdAt: Double
    public let editedAt: Double?
    /// The ids of the people the body mentions with `@Name`.
    public let mentions: [String]?
    public var date: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}

/// A conversation about one place in a file. What the place is (a text range, a cell, a slide element, a point on a page) is the
/// `anchor`, which each editor documents.
public struct PliThread: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let anchor: PliJSON?
    /// Oldest first; the first starts the thread.
    public let comments: [PliComment]
    public let resolved: Resolution?
    public let createdAt: Double
    public var isResolved: Bool { resolved != nil }
    public struct Resolution: Codable, Equatable, Sendable { public let by: String; public let at: Double }
}

/// One change to a file's comments: the whole vocabulary a store saves and a room carries.
public enum PliCommentChange: Codable, Equatable, Sendable {
    case createThread(PliThread)
    case deleteThread(id: String)
    case resolveThread(id: String, by: String, at: Double)
    case reopenThread(id: String)
    case addComment(thread: String, comment: PliComment)
    case editComment(thread: String, comment: String, body: String, at: Double, mentions: [String]?)
    case deleteComment(thread: String, comment: String)

    private enum Keys: String, CodingKey { case type, thread, threadId, by, at, comment, commentId, body, mentions }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "thread.create": self = .createThread(try c.decode(PliThread.self, forKey: .thread))
        case "thread.delete": self = .deleteThread(id: try c.decode(String.self, forKey: .threadId))
        case "thread.resolve": self = .resolveThread(id: try c.decode(String.self, forKey: .threadId), by: try c.decode(String.self, forKey: .by), at: try c.decode(Double.self, forKey: .at))
        case "thread.reopen": self = .reopenThread(id: try c.decode(String.self, forKey: .threadId))
        case "comment.add": self = .addComment(thread: try c.decode(String.self, forKey: .threadId), comment: try c.decode(PliComment.self, forKey: .comment))
        case "comment.edit": self = .editComment(thread: try c.decode(String.self, forKey: .threadId), comment: try c.decode(String.self, forKey: .commentId), body: try c.decode(String.self, forKey: .body), at: try c.decode(Double.self, forKey: .at), mentions: try c.decodeIfPresent([String].self, forKey: .mentions))
        case "comment.delete": self = .deleteComment(thread: try c.decode(String.self, forKey: .threadId), comment: try c.decode(String.self, forKey: .commentId))
        case let other: throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown comment change \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .createThread(let thread): try c.encode("thread.create", forKey: .type); try c.encode(thread, forKey: .thread)
        case .deleteThread(let id): try c.encode("thread.delete", forKey: .type); try c.encode(id, forKey: .threadId)
        case .resolveThread(let id, let by, let at): try c.encode("thread.resolve", forKey: .type); try c.encode(id, forKey: .threadId); try c.encode(by, forKey: .by); try c.encode(at, forKey: .at)
        case .reopenThread(let id): try c.encode("thread.reopen", forKey: .type); try c.encode(id, forKey: .threadId)
        case .addComment(let thread, let comment): try c.encode("comment.add", forKey: .type); try c.encode(thread, forKey: .threadId); try c.encode(comment, forKey: .comment)
        case .editComment(let thread, let comment, let body, let at, let mentions):
            try c.encode("comment.edit", forKey: .type); try c.encode(thread, forKey: .threadId); try c.encode(comment, forKey: .commentId)
            try c.encode(body, forKey: .body); try c.encode(at, forKey: .at); try c.encodeIfPresent(mentions, forKey: .mentions)
        case .deleteComment(let thread, let comment): try c.encode("comment.delete", forKey: .type); try c.encode(thread, forKey: .threadId); try c.encode(comment, forKey: .commentId)
        }
    }

    /// The thread this change is about.
    public var threadID: String {
        switch self {
        case .createThread(let t): return t.id
        case .deleteThread(let id), .resolveThread(let id, _, _), .reopenThread(let id): return id
        case .addComment(let t, _), .editComment(let t, _, _, _, _), .deleteComment(let t, _): return t
        }
    }
}

/// What a comment's author or a moderator may do (the engine decides by role; `PliComments.can` asks).
public enum PliCommentAction: String, Sendable { case comment, reply, edit, delete, resolve, deleteThread }

// MARK: - Live editing

/// Someone else in the room.
public struct PliPeer: Codable, Equatable, Sendable {
    /// This connection's id (not a user id: one person may have several).
    public let client: String
    public let user: PliUser
    /// What they have said about themselves: a document puts its selection here.
    public let state: PliJSON
    public let seen: Double
}

public enum PliSyncStatus: String, Codable, Sendable {
    /// Waiting to join, or to hear back.
    case connecting
    /// Everything you did is in the shared document.
    case synced
    /// You have changes the server hasn't taken yet.
    case saving
    /// Not connected: your changes are kept and sent when you are.
    case offline
    /// Reloading the document from the server.
    case resyncing
}

public struct PliSyncState: Codable, Equatable, Sendable {
    /// `idle`, `connecting` or `connected`.
    public let room: String
    public let status: PliSyncStatus
    /// How many of your changes the server hasn't taken yet.
    public let unsynced: Int
    public let version: Int?
}

/// A change to the document, as the editor's operations (JSON) say it.
public struct PliChange: Sendable {
    /// `local` (yours), `undo`, `redo` or `remote` (someone else's, or a reload).
    public let origin: String
    /// True when the whole document was replaced (a reload from the server).
    public let reset: Bool
    public let operations: [PliJSON]
    public let canUndo: Bool
    public let canRedo: Bool
}

/// A pipe to the other people in a room: all Pli asks of your realtime stack. Carry this JSON text to everyone else who joined the
/// same room (a WebSocket, Socket.io, Multipeer, a Redis channel behind any of them).
public protocol PliTransport: Sendable {
    /// Joins `room` and calls `receive` with every message other people send to it. Return when connected.
    func connect(room: String, receive: @escaping @Sendable (String) -> Void) async throws
    /// Sends to everyone else in the room.
    func send(_ json: String)
    /// Leaves the room.
    func disconnect()
}

// MARK: - What the app provides

/// Who the people are. Comments store only user ids; names and pictures are asked for here.
public protocol PliUserDirectory: Sendable {
    func lookup(ids: [String]) async throws -> [PliUser]
    /// For @mentions.
    func search(query: String) async throws -> [PliUser]
}
public extension PliUserDirectory {
    func search(query: String) async throws -> [PliUser] { [] }
}

/// Where comments are kept: a table, an API, Core Data. `save` is called once per change, in order, and should throw if it couldn't keep it.
public protocol PliCommentStore: Sendable {
    func load(file: String) async throws -> [PliThread]
    func save(file: String, change: PliCommentChange) async throws
}

/// What a stored file gives back.
public struct PliUpload: Codable, Equatable, Sendable {
    /// What the document stores for the file: a key or path, not a link that expires.
    public var ref: String
    /// An address that can be shown right away, if there is one.
    public var url: String?
    public var width: Int?
    public var height: Int?
    public init(ref: String, url: String? = nil, width: Int? = nil, height: Int? = nil) { self.ref = ref; self.url = url; self.width = width; self.height = height }
}

/// Where files go (S3, Supabase, your own server). A document holds a short reference to each file.
public protocol PliStorageAdapter: Sendable {
    func upload(_ data: Data, name: String, type: String) async throws -> PliUpload
    /// Turns a reference into an address that can be shown, such as a signed URL. Return plain addresses unchanged.
    func resolve(ref: String) async throws -> String
    func read(ref: String) async throws -> (type: String, data: Data)
    func delete(ref: String) async throws
}
public extension PliStorageAdapter {
    func resolve(ref: String) async throws -> String { ref }
    func read(ref: String) async throws -> (type: String, data: Data) { throw PliError(code: "storage", message: "This storage can't read files back") }
    func delete(ref: String) async throws { throw PliError(code: "storage", message: "This storage can't delete files") }
}

/// What the app provides to a document, workbook, deck or PDF. Each is optional: without a comment store, comments live in the
/// file (or in memory); without storage, pictures are embedded; without a directory, people show as their ids.
public struct PliHost: Sendable {
    public var directory: PliUserDirectory?
    public var commentStore: PliCommentStore?
    public var storage: PliStorageAdapter?
    /// The most a file may be (in bytes), and what kinds (`["image/*"]`). Checked before the adapter is asked.
    public var storageMaxBytes: Int?
    public var storageAllowedTypes: [String]?

    public init(directory: PliUserDirectory? = nil, commentStore: PliCommentStore? = nil, storage: PliStorageAdapter? = nil, storageMaxBytes: Int? = nil, storageAllowedTypes: [String]? = nil) {
        self.directory = directory
        self.commentStore = commentStore
        self.storage = storage
        self.storageMaxBytes = storageMaxBytes
        self.storageAllowedTypes = storageAllowedTypes
    }

    var services: [String] { (directory != nil ? ["directory"] : []) + (storage != nil ? ["storage"] : []) + (commentStore != nil ? ["comments"] : []) }
}

// MARK: - Listeners

/// Cancels a listener.
public final class PliSubscription: @unchecked Sendable {
    private var action: (() -> Void)?
    private let lock = NSLock()
    init(_ action: @escaping () -> Void) { self.action = action }
    /// Stops calling the listener.
    public func cancel() {
        lock.lock()
        let run = action
        action = nil
        lock.unlock()
        run?()
    }
}

final class PliListeners<T>: @unchecked Sendable {
    private var next = 0
    private var all: [Int: (T) -> Void] = [:]
    private let lock = NSLock()
    /// Called with true when the first listener arrives and false when the last leaves.
    var onUsed: ((Bool) -> Void)?

    func add(_ listener: @escaping (T) -> Void) -> PliSubscription {
        lock.lock()
        let id = next
        next += 1
        all[id] = listener
        let first = all.count == 1
        lock.unlock()
        if first { onUsed?(true) }
        return PliSubscription { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.all[id] = nil
            let empty = self.all.isEmpty
            self.lock.unlock()
            if empty { self.onUsed?(false) }
        }
    }

    func send(_ value: T) {
        lock.lock()
        let listeners = Array(all.values)
        lock.unlock()
        for listener in listeners { listener(value) }
    }
}

// MARK: - The editor core

/// What a document, a workbook, a deck and a PDF have in common. Subclasses open the file; the commands for each are generated.
open class PliEditorCore: PliEventTarget, @unchecked Sendable {
    let engine: Engine
    /// The engine's number for this file.
    public let handle: Int
    var host = PliHost()
    var transport: PliTransport?
    private var tickTask: Task<Void, Never>?
    private let changes = PliListeners<PliChange>()
    private let commentChanges = PliListeners<(origin: String, change: PliCommentChange)>()
    private let peerChanges = PliListeners<[PliPeer]>()
    private let syncChanges = PliListeners<PliSyncState>()
    private let resyncs = PliListeners<(reason: String, lost: Int)>()
    private let failures = PliListeners<PliError>()

    init(engine: Engine, handle: Int, host: PliHost = PliHost()) {
        self.engine = engine
        self.handle = handle
        self.host = host
        changes.onUsed = { [weak self] on in self?.watch("change", on) }
        commentChanges.onUsed = { [weak self] on in self?.watch("comments", on) }
        peerChanges.onUsed = { [weak self] on in self?.watch("peers", on) }
        syncChanges.onUsed = { [weak self] on in self?.watch("sync", on) }
        engine.route(handle, to: self)
    }

    private func watch(_ what: String, _ on: Bool) {
        let _: PliJSON? = try? engine.call("watch", [handle, what, on])
    }

    deinit {
        tickTask?.cancel()
        engine.unroute(handle)
        let _: Bool? = try? engine.call("close", [handle])
    }

    /// Opens a file in the engine: returns it and the handle. `format` is `json` or a file format; `data` is text for text formats and base64 for the rest.
    static func start(_ kind: PliEditorKind, format: String, data: String?, options: [String: PliJSON], host: PliHost, user: PliUser?) throws -> (Engine, Int) {
        let engine = Engine.engine(kind)
        var options = options
        if let user { options["user"] = try PliJSON.encode(user) }
        options["host"] = .array(host.services.map { .string($0) })
        var storage: [String: PliJSON] = [:]
        if let max = host.storageMaxBytes { storage["maxBytes"] = .number(Double(max)) }
        if let types = host.storageAllowedTypes { storage["allowedTypes"] = .array(types.map { .string($0) }) }
        if !storage.isEmpty { options["storage"] = .object(storage) }
        let handle: Int = try engine.call("openEditor", [kind.editor, format, data, PliJSON.object(options).text])
        return (engine, handle)
    }

    // MARK: Operations

    /// Applies operations (the JSON each editor's operations are, the same live editing sends) as one undoable step.
    /// - Parameter merge: Fold this step into the one before, so one undo reverts both.
    public func apply(_ operations: [PliJSON], merge: Bool = false) throws {
        let options = PliJSON.object(merge ? ["merge": true] : [:]).text
        let _: Bool = try engine.call("apply", [handle, PliJSON.array(operations).text, options])
    }

    /// Calls a method of the editor's session by name, for what the typed API doesn't cover: `"setCell"`, `"annots.add"`.
    /// The arguments and the result are JSON.
    @discardableResult
    public func call(_ method: String, _ arguments: [PliJSON] = []) throws -> PliJSON {
        try engine.call("call", [handle, method, PliJSON.array(arguments).text])
    }

    /// The whole file as JSON text, which the editor's `init(json:)` opens again.
    public func documentJSON() throws -> String { try engine.call("read", [handle, "document"]) }

    /// What the engine says about the file now: whether there is something to undo or redo, and what each editor adds.
    public func stateJSON() throws -> PliJSON { try engine.call("read", [handle, "state"]) }

    /// The file in a format, as bytes.
    public func exportFile(_ format: String, options: [String: PliJSON] = [:]) throws -> Data {
        let base64: String = try engine.call("exportFile", [handle, format, PliJSON.object(options).text])
        return Data(base64Encoded: base64) ?? Data()
    }

    /// Like `exportFile`, for formats that take a moment or wait for the app's storage (a PDF).
    public func exportFileAsync(_ format: String, options: [String: PliJSON] = [:]) async throws -> Data {
        let base64: String = try await engine.callAsync("exportFile", [handle, format, PliJSON.object(options).text])
        return Data(base64Encoded: base64) ?? Data()
    }

    /// Replaces the file with one in a format. Returns what the editor says about it (warnings).
    public func importFile(_ format: String, data: Data, options: [String: PliJSON] = [:]) throws -> PliFileImport {
        try engine.call("importFile", [handle, format, data.base64EncodedString(), PliJSON.object(options).text])
    }

    public func importFile(_ format: String, text: String, options: [String: PliJSON] = [:]) throws -> PliFileImport {
        try engine.call("importFile", [handle, format, text, PliJSON.object(options).text])
    }

    // MARK: Plumbing for the generated methods

    func run<T: Decodable>(_ name: String, _ arguments: [PliJSON]) throws -> T {
        try engine.call("invoke", [handle, name, PliJSON.array(arguments).text])
    }

    func runVoid(_ name: String, _ arguments: [PliJSON]) throws {
        let _: PliJSON = try engine.call("invoke", [handle, name, PliJSON.array(arguments).text])
    }

    func runAsync<T: Decodable>(_ name: String, _ arguments: [PliJSON]) async throws -> T {
        try await engine.callAsync("invoke", [handle, name, PliJSON.array(arguments).text])
    }

    // MARK: Hearing about changes

    /// Calls `listener` after every change to the file: yours, undo and redo, and what other people did. The operations are the JSON live editing sends.
    @discardableResult
    public func onChange(_ listener: @escaping (PliChange) -> Void) -> PliSubscription { changes.add(listener) }

    /// Calls `listener` when something goes wrong in the background (a transport that couldn't connect, a sequencer's error).
    @discardableResult
    public func onError(_ listener: @escaping (PliError) -> Void) -> PliSubscription { failures.add(listener) }

    // MARK: Events

    func receive(event f: [String: PliJSON]) {
        switch f["type"]?.stringValue {
        case "change":
            changes.send(PliChange(origin: f["origin"]?.stringValue ?? "local", reset: f["reset"]?.boolValue ?? false, operations: f["ops"]?.arrayValue ?? [], canUndo: f["canUndo"]?.boolValue ?? false, canRedo: f["canRedo"]?.boolValue ?? false))
        case "comments":
            if let change = try? f["change"]?.decode(PliCommentChange.self) { commentChanges.send((f["origin"]?.stringValue ?? "local", change)) }
        case "peers":
            if let peers = try? f["peers"]?.decode([PliPeer].self) { peerChanges.send(peers) }
        case "sync":
            let state = PliSyncState(room: "connected", status: f["status"]?.stringValue.flatMap(PliSyncStatus.init(rawValue:)) ?? .connecting, unsynced: f["unsynced"]?.intValue ?? 0, version: f["version"]?.intValue)
            syncChanges.send(state)
        case "resync":
            resyncs.send((f["reason"]?.stringValue ?? "", f["lost"]?.intValue ?? 0))
        case "error":
            failures.send(PliError(code: f["code"]?.stringValue ?? "error", message: f["message"]?.stringValue ?? ""))
        case "transport.send":
            if let json = f["json"]?.stringValue { transport?.send(json) }
        case "transport.disconnect":
            transport?.disconnect()
        case "host":
            guard let id = f["id"]?.intValue, let kind = f["kind"]?.stringValue else { return }
            let payload = f["payload"] ?? .null
            Task.detached { [self] in
                do {
                    let result = try await self.serve(kind, payload)
                    self.answer(id, result: result, error: nil)
                } catch let error as PliError {
                    self.answer(id, result: nil, error: error)
                } catch {
                    self.answer(id, result: nil, error: PliError(code: "storage", message: "\(error)"))
                }
            }
        default:
            break
        }
    }

    private func answer(_ id: Int, result: String?, error: PliError?) {
        let failure = error.map { PliJSON.object(["code": .string($0.code), "message": .string($0.message)]).text }
        let _: Bool? = try? engine.call("hostResolve", [id, result ?? "null", failure])
        // What the answer set going (a comment saved, a lookup finished) leaves events behind: collect them.
        let _: PliJSON? = try? engine.call("pump", [])
    }

    private func serve(_ kind: String, _ payload: PliJSON) async throws -> String {
        func json<T: Encodable>(_ value: T) throws -> String { String(decoding: try JSONEncoder().encode(value), as: UTF8.self) }
        switch kind {
        case "users.lookup":
            guard let directory = host.directory else { throw PliError(code: "unsupported", message: "No user directory") }
            return try json(try await directory.lookup(ids: try payload["ids"]?.decode([String].self) ?? []))
        case "users.search":
            guard let directory = host.directory else { return "[]" }
            return try json(try await directory.search(query: payload["query"]?.stringValue ?? ""))
        case "comments.load":
            guard let store = host.commentStore else { return "[]" }
            return try json(try await store.load(file: payload["file"]?.stringValue ?? ""))
        case "comments.save":
            guard let store = host.commentStore, let change = try payload["change"]?.decode(PliCommentChange.self) else { throw PliError(code: "storage", message: "No comment store") }
            try await store.save(file: payload["file"]?.stringValue ?? "", change: change)
            return "null"
        case "storage.upload":
            guard let storage = host.storage, let data = Data(base64Encoded: payload["data"]?.stringValue ?? "") else { throw PliError(code: "storage", message: "No storage") }
            return try json(try await storage.upload(data, name: payload["name"]?.stringValue ?? "file", type: payload["type"]?.stringValue ?? "application/octet-stream"))
        case "storage.resolve":
            guard let storage = host.storage else { throw PliError(code: "storage", message: "No storage") }
            return try json(try await storage.resolve(ref: payload["ref"]?.stringValue ?? ""))
        case "storage.read":
            guard let storage = host.storage else { throw PliError(code: "storage", message: "No storage") }
            let file = try await storage.read(ref: payload["ref"]?.stringValue ?? "")
            return PliJSON.object(["type": .string(file.type), "data": .string(file.data.base64EncodedString())]).text
        case "storage.delete":
            guard let storage = host.storage else { throw PliError(code: "storage", message: "No storage") }
            try await storage.delete(ref: payload["ref"]?.stringValue ?? "")
            return "null"
        case "transport.connect":
            guard let transport else { throw PliError(code: "unsupported", message: "No transport: pass one to sync.start") }
            let engine = self.engine, handle = self.handle
            try await transport.connect(room: payload["room"]?.stringValue ?? "") { json in
                let _: Bool? = try? engine.call("transportReceive", [handle, json])
                let _: PliJSON? = try? engine.call("pump", [])
            }
            return "null"
        default:
            throw PliError(code: "unsupported", message: "The app can't do \(kind)")
        }
    }

    // MARK: Shared features

    /// Who is using the file, and the people it knows.
    public var users: PliUsers { PliUsers(self) }
    /// Comment threads.
    public var comments: PliComments { PliComments(self) }
    /// Presence and live editing.
    public var sync: PliSync { PliSync(self) }
    /// Files, through the storage adapter the file was opened with.
    public var storage: PliStorage { PliStorage(self) }
    /// Scripts that read and change the file, within the limits you give.
    public var scripts: PliScripts { PliScripts(self) }

    fileprivate func resyncListeners() -> PliListeners<(reason: String, lost: Int)> { resyncs }
    fileprivate func commentListeners() -> PliListeners<(origin: String, change: PliCommentChange)> { commentChanges }
    fileprivate func peerListeners() -> PliListeners<[PliPeer]> { peerChanges }
    fileprivate func syncListeners() -> PliListeners<PliSyncState> { syncChanges }
    fileprivate func startTicking() {
        tickTask?.cancel()
        tickTask = Task.detached { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self else { return }
                let _: Int? = try? self.engine.call("tick", [])
            }
        }
    }
    fileprivate func stopTicking() { tickTask?.cancel(); tickTask = nil }
}

/// What importing a file found.
public struct PliFileImport: Codable, Equatable, Sendable {
    /// What couldn't be carried over, in plain words.
    public let warnings: [String]
}

// MARK: - People

/// Who is using the file, for comments, suggestions and what the person may do. Pli has no accounts: your app says who the user is.
public struct PliUsers {
    private let core: PliEditorCore
    fileprivate init(_ core: PliEditorCore) { self.core = core }

    /// The person using the file, and what they may do.
    public func current() throws -> (user: PliUser?, role: PliRole) {
        let found: PliJSON = try core.engine.call("currentUser", [core.handle])
        return (try found["user"].flatMap { $0.isNull ? nil : try $0.decode(PliUser.self) }, found["role"]?.stringValue.flatMap(PliRole.init(rawValue:)) ?? .editor)
    }

    /// Says who is using the file now. A viewer can't comment; a commenter can comment and reply; an editor can also moderate.
    public func setCurrent(_ user: PliUser?, role: PliRole = .editor) throws {
        let _: Bool = try core.engine.call("setUser", [core.handle, try user.map { try PliJSON.encode($0).text }, role.rawValue])
    }

    /// Tells the engine about people you already have (the ones in the room, the authors of comments).
    public func add(_ users: [PliUser]) throws {
        let _: Bool = try core.engine.call("addUsers", [core.handle, try PliJSON.encode(users).text])
    }

    /// A person by id. One the engine doesn't know yet comes back named by their id, and the directory is asked.
    public func user(id: String) throws -> PliUser { try core.engine.call("getUser", [core.handle, id]) }

    /// Finds people by name, for @mentions, through the directory.
    public func search(_ query: String) async throws -> [PliUser] { try await core.engine.callAsync("searchUsers", [core.handle, query]) }
}

// MARK: - Comments

/// The comments of a file. Changes show at once and are then handed to the comment store; the same changes travel the room when
/// the file is shared.
public struct PliComments {
    private let core: PliEditorCore
    fileprivate init(_ core: PliEditorCore) { self.core = core }

    /// The threads now, oldest first.
    public func threads() throws -> [PliThread] { try core.engine.call("comments", [core.handle]) }

    /// Starts a thread with its first comment. `anchor` says where: use the editor's own methods (`commentOnRange`,
    /// `commentOnSlide`, `addComment`, `commentOnSelection`) when they fit.
    @discardableResult
    public func createThread(_ body: String, anchor: PliJSON? = nil, mentions: [String]? = nil) throws -> PliThread {
        try core.engine.call("commentsCreate", [core.handle, body, anchor.map { $0.text }, mentions.map { PliJSON.encodeOrNull($0).text }])
    }

    @discardableResult
    public func reply(to thread: String, _ body: String, mentions: [String]? = nil) throws -> PliComment {
        try core.engine.call("commentsReply", [core.handle, thread, body, mentions.map { PliJSON.encodeOrNull($0).text }])
    }

    public func edit(thread: String, comment: String, body: String, mentions: [String]? = nil) throws {
        let _: Bool = try core.engine.call("commentsEdit", [core.handle, thread, comment, body, mentions.map { PliJSON.encodeOrNull($0).text }])
    }

    /// Deletes a comment; deleting the only comment of a thread deletes the thread.
    public func delete(thread: String, comment: String) throws {
        let _: Bool = try core.engine.call("commentsDelete", [core.handle, thread, comment])
    }

    public func deleteThread(_ thread: String) throws {
        let _: Bool = try core.engine.call("commentsDelete", [core.handle, thread, nil])
    }

    public func resolve(_ thread: String) throws {
        let _: Bool = try core.engine.call("commentsResolve", [core.handle, thread, true])
    }

    public func reopen(_ thread: String) throws {
        let _: Bool = try core.engine.call("commentsResolve", [core.handle, thread, false])
    }

    /// Whether the current user may do this. Use it to hide buttons; the methods check it too.
    public func can(_ action: PliCommentAction, thread: String? = nil) throws -> Bool {
        try core.engine.call("commentsCan", [core.handle, action.rawValue, thread])
    }

    /// Takes in a change made by someone else, such as from your own store's feed. It isn't saved or sent on.
    public func receive(_ change: PliCommentChange) throws {
        let _: Bool = try core.engine.call("commentsReceive", [core.handle, try PliJSON.encode(change).text])
    }

    /// Loads the store's threads again, for after a lost connection.
    public func reload() async throws {
        let _: PliJSON = try await core.engine.callAsync("commentsReload", [core.handle])
    }

    /// Calls `listener` with every change as it shows: yours at once, other people's as they arrive.
    @discardableResult
    public func onChange(_ listener: @escaping (_ origin: String, _ change: PliCommentChange) -> Void) -> PliSubscription {
        core.commentListeners().add { listener($0.origin, $0.change) }
    }
}

extension PliJSON {
    static func encodeOrNull<T: Encodable>(_ value: T) -> PliJSON { (try? encode(value)) ?? .null }
}

// MARK: - Live editing

/// Presence and live editing: who else is here, and keeping the file in step with everyone's over your transport and a sequencer
/// (`createAuthority` on your server, or a `PliAuthority` in the app).
public struct PliSync {
    private let core: PliEditorCore
    fileprivate init(_ core: PliEditorCore) { self.core = core }

    /// Joins a room. Presence and comments always travel it; the file's own changes do too unless `live` is false.
    /// - Parameters:
    ///   - room: Everyone in the same room sees each other. By default the file's id.
    ///   - transport: Carries the JSON messages.
    ///   - version: The version of the shared document the file was loaded at, if you saved it with its version: the server then sends only what happened since.
    ///   - verifyEvery: How often to check the file against the server's, in seconds (0 for never).
    public func start(room: String? = nil, transport: PliTransport, version: Int? = nil, verifyEvery: TimeInterval = 30, heartbeat: TimeInterval? = nil, live: Bool = true) throws {
        core.transport = transport
        var options: [String: PliJSON] = ["verifyEvery": .number(verifyEvery * 1000), "live": .bool(live)]
        if let room { options["room"] = .string(room) }
        if let version { options["version"] = .number(Double(version)) }
        if let heartbeat { options["heartbeat"] = .number(heartbeat * 1000) }
        let _: Bool = try core.engine.call("syncStart", [core.handle, PliJSON.object(options).text])
        core.startTicking()
    }

    public func stop() throws {
        core.stopTicking()
        let _: Bool = try core.engine.call("syncStop", [core.handle])
    }

    /// Where the room and the file's sync stand now.
    public func state() throws -> PliSyncState { try core.engine.call("syncStatus", [core.handle]) }

    /// Tell it the connection was lost or came back. Changes made offline are kept and sent when it is back.
    public func setOnline(_ online: Bool) throws {
        let _: Bool = try core.engine.call("syncOnline", [core.handle, online])
    }

    /// Throws away this copy and loads the server's. Unsent changes are lost.
    public func resync() throws {
        let _: Bool = try core.engine.call("syncResync", [core.handle])
    }

    /// Tells everyone what you are doing now (for a document, the selection goes along; add what you like).
    public func setPresence(_ state: [String: PliJSON] = [:]) throws {
        let _: Bool = try core.engine.call("setPresence", [core.handle, PliJSON.object(state).text])
    }

    /// The other people here.
    public func peers() throws -> [PliPeer] { try core.engine.call("peers", [core.handle]) }

    @discardableResult
    public func onPeers(_ listener: @escaping ([PliPeer]) -> Void) -> PliSubscription { core.peerListeners().add(listener) }

    @discardableResult
    public func onState(_ listener: @escaping (PliSyncState) -> Void) -> PliSubscription { core.syncListeners().add(listener) }

    /// Called when this copy was replaced by the server's, and how many of your changes the server hadn't confirmed.
    @discardableResult
    public func onResync(_ listener: @escaping (_ reason: String, _ lost: Int) -> Void) -> PliSubscription { core.resyncListeners().add { listener($0.reason, $0.lost) } }
}

// MARK: - Files

/// Files, through the storage adapter the file was opened with (`PliHost.storage`). Limits are checked before the adapter is asked.
public struct PliStorage {
    private let core: PliEditorCore
    fileprivate init(_ core: PliEditorCore) { self.core = core }

    public func upload(_ data: Data, name: String, type: String) async throws -> PliUpload {
        try await core.engine.callAsync("storageUpload", [core.handle, name, type, data.base64EncodedString()])
    }

    /// An address that can be shown for a stored reference.
    public func resolve(_ ref: String) async throws -> String { try await core.engine.callAsync("storageResolve", [core.handle, ref]) }

    public func read(_ ref: String) async throws -> (type: String, data: Data) {
        let file: PliJSON = try await core.engine.callAsync("storageRead", [core.handle, ref])
        return (file["type"]?.stringValue ?? "application/octet-stream", Data(base64Encoded: file["data"]?.stringValue ?? "") ?? Data())
    }

    public func delete(_ ref: String) async throws { let _: PliJSON = try await core.engine.callAsync("storageDelete", [core.handle, ref]) }
}

// MARK: - Scripts

/// What a script may be given. Anything not granted doesn't exist in the script's context.
public enum PliScriptCapability: String, Sendable { case read, write, comments, create }

/// Scripts: a piece of JavaScript that reads the file and changes it through operations, so everything it does is undoable, synced to
/// other people and within the limits you set. One run is one undo step; a run that throws is taken back.
///
/// ```swift
/// let total = try book.scripts.run("""
///     const sheet = ctx.state.sheets[0];
///     return Object.keys(sheet.cells).length;
/// """)
/// ```
///
/// The script is the body of a function of `ctx`: `ctx.state` is the file as JSON, `ctx.apply(operations)` changes it, `ctx.can("write")`
/// asks what was granted. It runs in the engine's own JavaScript world, which has no network and no files, but that is not a barrier
/// against hostile code: run scripts your app wrote or has checked.
public struct PliScripts {
    private let core: PliEditorCore
    fileprivate init(_ core: PliEditorCore) { self.core = core }

    /// - Parameters:
    ///   - grants: What the script may do (read and write by default).
    ///   - maxOps: The most operations one run may apply (10 000 by default).
    ///   - maxMilliseconds: The longest a run may take, checked each time it applies something (5 000 by default).
    /// - Returns: What the script returned, as JSON.
    @discardableResult
    public func run(_ source: String, grants: [PliScriptCapability]? = nil, maxOps: Int? = nil, maxMilliseconds: Int? = nil) throws -> PliJSON {
        var options: [String: PliJSON] = [:]
        if let grants { options["grants"] = .array(grants.map { .string($0.rawValue) }) }
        if let maxOps { options["maxOps"] = .number(Double(maxOps)) }
        if let maxMilliseconds { options["maxMs"] = .number(Double(maxMilliseconds)) }
        return try core.engine.call("scriptRun", [core.handle, source, PliJSON.object(options).text])
    }
}

// MARK: - A sequencer in the app, and a hub for tests

/// The sequencer of live editing running in the app: it puts everyone's changes in one order and keeps the document in memory.
/// Use it for sessions between devices when no server is involved, and in tests. For real use, run `createAuthority` over your
/// own store on your server.
public final class PliAuthority: PliEventTarget, @unchecked Sendable {
    private let engine: Engine
    private let handle: Int
    /// Called with what the sequencer sends to everyone in the room.
    public var onSend: ((_ room: String, _ json: String) -> Void)?

    /// - Parameters:
    ///   - editor: Which editor's changes it orders.
    ///   - initial: The document a room starts from (`documentJSON()` of a file), or nil for an empty one where the editor has one.
    public init(editor: PliEditorKind, initial: String? = nil) throws {
        let engine = Engine.engine(editor)
        self.engine = engine
        self.handle = try engine.call("authorityOpen", [editor.editor, initial])
        engine.route(handle, to: self)
    }

    deinit {
        engine.unroute(handle)
        let _: Bool? = try? engine.call("authorityClose", [handle])
    }

    /// Hands it a message from a client in a room (the JSON a transport carried).
    public func receive(room: String, json: String) throws {
        let _: PliJSON = try engine.call("authorityReceive", [handle, room, json])
    }

    func receive(event f: [String: PliJSON]) {
        if f["type"]?.stringValue == "authority.send", let room = f["room"]?.stringValue, let json = f["json"]?.stringValue { onSend?(room, json) }
    }
}

/// Rooms in memory, for tests and demos: every transport made by one hub is in the same rooms, and an authority can serve them.
public final class PliMemoryHub: @unchecked Sendable {
    private let queue = DispatchQueue(label: "pli.hub")
    private let lock = NSLock()
    private var members: [String: [Int: @Sendable (String) -> Void]] = [:]
    private var nextMember = 0
    private var busy = 0
    private var authorities: [String: PliAuthority] = [:]

    public init() {}

    /// Lets an authority order the changes of a room.
    public func serve(_ authority: PliAuthority, room: String) {
        register(authority, room: room)
        authority.onSend = { [weak self] room, json in self?.deliver(room: room, json: json, except: nil) }
    }

    private func register(_ authority: PliAuthority, room: String) {
        lock.lock()
        authorities[room] = authority
        lock.unlock()
    }

    /// A transport that joins this hub's rooms.
    public func transport() -> PliTransport { Member(hub: self) }

    /// Waits until every message in flight has been delivered and answered.
    public func settle() async {
        var quiet = 0
        while quiet < 3 {
            try? await Task.sleep(nanoseconds: 3_000_000)
            queue.sync {}
            quiet = inFlight() == 0 ? quiet + 1 : 0
        }
    }

    private func inFlight() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return busy
    }

    fileprivate func enqueue(_ work: @escaping () -> Void) {
        lock.lock()
        busy += 1
        lock.unlock()
        queue.async { [self] in
            work()
            lock.lock()
            busy -= 1
            lock.unlock()
        }
    }

    fileprivate func join(room: String, receive: @escaping @Sendable (String) -> Void) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let id = nextMember
        nextMember += 1
        members[room, default: [:]][id] = receive
        return id
    }

    fileprivate func authority(for room: String) -> PliAuthority? {
        lock.lock()
        defer { lock.unlock() }
        return authorities[room]
    }

    fileprivate func leave(room: String, id: Int) {
        lock.lock()
        members[room]?[id] = nil
        lock.unlock()
    }

    fileprivate func deliver(room: String, json: String, except: Int?) {
        enqueue { [self] in
            lock.lock()
            let receivers = (members[room] ?? [:]).filter { $0.key != except }.map(\.value)
            lock.unlock()
            for receive in receivers { receive(json) }
        }
    }

    private final class Member: PliTransport, @unchecked Sendable {
        let hub: PliMemoryHub
        var id = -1
        var room: String?
        init(hub: PliMemoryHub) { self.hub = hub }

        func connect(room: String, receive: @escaping @Sendable (String) -> Void) async throws {
            id = hub.join(room: room, receive: receive)
            self.room = room
        }

        func send(_ json: String) {
            guard let room else { return }
            hub.deliver(room: room, json: json, except: id)
            if let authority = hub.authority(for: room) { hub.enqueue { try? authority.receive(room: room, json: json) } }
        }

        func disconnect() {
            guard let room else { return }
            hub.leave(room: room, id: id)
            self.room = nil
        }
    }
}
