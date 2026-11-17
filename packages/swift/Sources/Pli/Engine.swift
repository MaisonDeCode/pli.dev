import Foundation
import JavaScriptCore

/// What went wrong, as the engine says it: a short `code` such as `invalid_document` or `not_found`, and a message for a person.
public struct PliError: Error, CustomStringConvertible, Sendable {
    public let code: String
    public let message: String
    public var description: String { "\(code): \(message)" }
}

/// Which engine script an editor runs: each has its own, so an app that only opens PDFs doesn't load a spreadsheet.
public enum PliEditorKind: String, Sendable {
    case documents = "pli-engine"
    case sheets = "pli-sheets"
    case decks = "pli-decks"
    case pdf = "pli-pdf"

    /// What the engine calls the editor.
    var editor: String {
        switch self {
        case .documents: return "docs"
        case .sheets: return "sheets"
        case .decks: return "decks"
        case .pdf: return "pdf"
        }
    }
}

/// Runs a Pli engine in JavaScriptCore. One engine can hold any number of documents.
///
/// Everything crosses to JavaScript as text, so nothing here can throw from the other side:
/// every answer is `{ok: true, value}` or `{ok: false, error}`. An answer may also carry `events` (changes, comments, requests for
/// the app to do something) and `pending`, a task that isn't finished: the engine never calls the app, it leaves events for it.
final class Engine: @unchecked Sendable {
    private let context: JSContext
    private let bridge: JSValue
    private let lock = NSLock()
    private let routesLock = NSLock()
    private var routes: [Int: WeakRoute] = [:]

    private final class WeakRoute { weak var target: PliEventTarget?; init(_ target: PliEventTarget) { self.target = target } }
    /// Events for a handle nobody listens to yet (the ones that come with the reply that opens it), kept until somebody does.
    private var orphans: [Int: [[String: PliJSON]]] = [:]

    private static let sharedLock = NSLock()
    private static var engines: [PliEditorKind: Engine] = [:]

    /// The engine for an editor. Creating one costs a few milliseconds, so documents share it unless asked not to.
    static func engine(_ kind: PliEditorKind = .documents) -> Engine {
        sharedLock.lock()
        defer { sharedLock.unlock() }
        if let found = engines[kind] { return found }
        do {
            let engine = try Engine(kind)
            engines[kind] = engine
            return engine
        } catch { fatalError("The Pli engine couldn't start: \(error)") }
    }

    /// The documents engine, which `PliDocument` uses.
    static var shared: Engine { engine(.documents) }

    init(_ kind: PliEditorKind = .documents) throws {
        guard let context = JSContext() else { throw PliError(code: "engine", message: "JavaScriptCore isn't available") }
        var failure: String?
        context.exceptionHandler = { _, exception in failure = exception?.toString() }
        guard let url = Bundle.module.url(forResource: kind.rawValue, withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8) else {
            throw PliError(code: "engine", message: "\(kind.rawValue).js is missing from the package")
        }
        context.evaluateScript(script, withSourceURL: url)
        if let failure { throw PliError(code: "engine", message: failure) }
        guard let bridge = context.objectForKeyedSubscript("Pli"), !bridge.isUndefined else {
            throw PliError(code: "engine", message: "The engine script didn't define Pli")
        }
        self.context = context
        self.bridge = bridge
    }

    // MARK: Events

    /// Who hears the events of a handle.
    func route(_ handle: Int, to target: PliEventTarget) {
        routesLock.lock()
        routes[handle] = WeakRoute(target)
        let waiting = orphans.removeValue(forKey: handle) ?? []
        routesLock.unlock()
        for event in waiting { target.receive(event: event) }
    }

    func unroute(_ handle: Int) {
        routesLock.lock()
        routes[handle] = nil
        orphans[handle] = nil
        routesLock.unlock()
    }

    private func deliver(_ events: [PliJSON]) {
        for event in events {
            guard case .object(let fields) = event, case .number(let h)? = fields["handle"] else { continue }
            routesLock.lock()
            let target = routes[Int(h)]?.target
            if target == nil { orphans[Int(h), default: []].append(fields) }
            routesLock.unlock()
            target?.receive(event: fields)
        }
    }

    // MARK: Calls

    /// Calls a function of the engine with text and numbers, and returns what it answered, decoded. Work the engine hasn't finished
    /// (a PDF being written, a request the app is answering) is waited for.
    func call<T: Decodable>(_ function: String, _ arguments: [Any?]) throws -> T {
        var reply: Reply<T> = try callOnce(function, arguments)
        let deadline = Date().addingTimeInterval(120)
        while let task = reply.pending {
            if Date() > deadline { throw PliError(code: "engine", message: "\(function) didn't finish") }
            Thread.sleep(forTimeInterval: 0.001)
            reply = try callOnce("taskResult", [task])
        }
        return try value(reply, function)
    }

    /// Like `call`, for work that waits for the app (storage, comment stores): the caller isn't blocked while it waits.
    func callAsync<T: Decodable>(_ function: String, _ arguments: [Any?]) async throws -> T {
        var reply: Reply<T> = try callOnce(function, arguments)
        let deadline = Date().addingTimeInterval(600)
        while let task = reply.pending {
            if Date() > deadline { throw PliError(code: "engine", message: "\(function) didn't finish") }
            try await Task.sleep(nanoseconds: 1_000_000)
            reply = try callOnce("taskResult", [task])
        }
        return try value(reply, function)
    }

    private func value<T>(_ reply: Reply<T>, _ function: String) throws -> T {
        if reply.ok, let value = reply.value { return value }
        if let error = reply.error { throw PliError(code: error.code, message: error.message) }
        throw PliError(code: "engine", message: "The engine's answer to \(function) had no value")
    }

    private func callOnce<T: Decodable>(_ function: String, _ arguments: [Any?]) throws -> Reply<T> {
        let reply: Reply<T> = try callRaw(function, arguments)
        // Promises settle after a call returns, and what they set going (a comment sent to the app's store) leaves events behind:
        // collect them now rather than at the next call.
        if function != "pump", let _: Reply<PliJSON> = try? callRaw("pump", []) {}
        return reply
    }

    private func callRaw<T: Decodable>(_ function: String, _ arguments: [Any?]) throws -> Reply<T> {
        lock.lock()
        let text: String?
        do {
            let values: [Any] = arguments.map { $0 ?? NSNull() }
            text = bridge.invokeMethod(function, withArguments: values)?.toString()
        }
        lock.unlock()
        guard let text, let data = text.data(using: .utf8) else {
            throw PliError(code: "engine", message: "The engine didn't answer \(function)")
        }
        let reply = try JSONDecoder().decode(Reply<T>.self, from: data)
        // Events are delivered with the lock released, so a listener may call the engine again.
        if let events = reply.events, !events.isEmpty { deliver(events) }
        return reply
    }

    /// The engine's answer. A `value` of null is a value when the caller expects an optional (`String?`): it decodes as nil.
    private struct Reply<T: Decodable>: Decodable {
        let ok: Bool
        let value: T?
        let error: Failure?
        let events: [PliJSON]?
        let pending: Int?
        struct Failure: Decodable { let code: String; let message: String }
        enum Keys: String, CodingKey { case ok, value, error, events, pending }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            ok = try c.decode(Bool.self, forKey: .ok)
            error = try c.decodeIfPresent(Failure.self, forKey: .error)
            events = try c.decodeIfPresent([PliJSON].self, forKey: .events)
            pending = try c.decodeIfPresent(Int.self, forKey: .pending)
            value = ok && pending == nil && c.contains(.value) ? try c.decode(T.self, forKey: .value) : nil
        }
    }
}

/// Something that hears the events the engine leaves for a handle.
protocol PliEventTarget: AnyObject {
    func receive(event: [String: PliJSON])
}

/// A JSON value of any shape, for the parts of a document that have no type here.
public enum PliJSON: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([PliJSON])
    case object([String: PliJSON])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([PliJSON].self) { self = .array(v) }
        else { self = .object(try c.decode([String: PliJSON].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}
