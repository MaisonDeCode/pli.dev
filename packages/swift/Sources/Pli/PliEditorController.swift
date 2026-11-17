import Foundation
import WebKit
#if canImport(UIKit)
import UIKit
#endif

/// A file the editor made, such as the DOCX from File > Download.
public struct PliDownload: Sendable {
    public let name: String
    public let mimeType: String
    public let data: Data
}

/// The editor on screen, seen from your app.
///
/// `PliEditorView` shows the full Pli editor: menus, toolbar, pages, tables, comments and the rest. A controller is how your app
/// talks to it: open a document, hear about changes, ask for the document back or as a file.
///
/// ```swift
/// let editor = PliEditorController(json: savedJSON)
/// editor.onChange = { json in try? json.write(to: url, atomically: true, encoding: .utf8) }
///
/// PliEditorView(editor)                 // in a SwiftUI body
/// let docx = try await editor.exportDocx()
/// ```
///
/// The editor itself runs in a web view, from one HTML file inside this package, so it needs nothing from the network.
/// Everything here is for the main thread.
@MainActor
public final class PliEditorController: NSObject, ObservableObject {
    /// The web view that shows the editor. `PliEditorView` puts it on screen.
    public let webView: WKWebView

    /// True once the editor has loaded and the document is open in it.
    @Published public private(set) var isReady = false

    /// The document as of the last change you were told about: the JSON `PliDocument(json:)` opens. Nil until something changes.
    @Published public private(set) var latestJSON: String?

    /// Called a moment after each edit, with the whole document as JSON, so you can save it.
    public var onChange: ((String) -> Void)?

    /// Called with each file File > Download makes. Without it, the file is offered in the system share sheet (on iPhone and iPad) or a save panel (on a Mac).
    public var onDownload: ((PliDownload) -> Void)?

    /// Called when the editor can't do something, such as open a document that isn't one.
    public var onError: ((String) -> Void)?

    private var startJSON: String?
    private var startReadOnly: Bool
    private var waiting: [Int: CheckedContinuation<String, Error>] = [:]
    private var nextID = 1

    /// - Parameters:
    ///   - json: A saved document (what `onChange` gave, or `PliDocument.json()`). Without it, the editor starts empty.
    ///   - readOnly: Show the document without letting anyone change it.
    public init(json: String? = nil, readOnly: Bool = false) {
        self.startJSON = json
        self.startReadOnly = readOnly
        let configuration = WKWebViewConfiguration()
        let content = WKUserContentController()
        configuration.userContentController = content
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        content.add(MessageRelay(self), name: "pli")
        #if canImport(UIKit)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        setKeyboardAccessoryBar(hidden: true)
        #endif
        #if DEBUG
        if #available(iOS 16.4, macOS 13.3, *) { webView.isInspectable = true }
        #endif
        if let url = Bundle.module.url(forResource: "pli-editor", withExtension: "html"), let html = try? String(contentsOf: url, encoding: .utf8) {
            webView.loadHTMLString(html, baseURL: URL(string: "https://pli.invalid/"))
        } else {
            onError?("pli-editor.html is missing from the package")
        }
    }

    // MARK: The bar above the keyboard

    #if canImport(UIKit)
    private var contentViewClass: AnyClass?

    /// Whether the bar of arrows and Done that iOS shows above the keyboard for a web page is hidden. It is hidden by default: the editor
    /// has its own toolbar, which sits above the keyboard on a phone.
    ///
    /// iOS has no public setting for this. It is done by giving the web view's content view a subclass whose `inputAccessoryView` is nil,
    /// the technique most apps that show a web page use. Set this to `false` to leave the web view as it is.
    public var hidesKeyboardAccessoryBar: Bool {
        get { contentViewClass != nil }
        set { setKeyboardAccessoryBar(hidden: newValue) }
    }

    private func setKeyboardAccessoryBar(hidden: Bool) {
        guard let content = webView.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }) else { return }
        if hidden {
            guard contentViewClass == nil else { return }
            let original: AnyClass = type(of: content)
            let name = "\(original)_PliNoAccessory"
            var subclass: AnyClass? = NSClassFromString(name)
            if subclass == nil, let created = objc_allocateClassPair(original, name, 0) {
                let nothing: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
                if let method = class_getInstanceMethod(UIResponder.self, #selector(getter: UIResponder.inputAccessoryView)) {
                    class_addMethod(created, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(nothing), method_getTypeEncoding(method))
                }
                objc_registerClassPair(created)
                subclass = created
            }
            guard let subclass else { return }
            contentViewClass = original
            object_setClass(content, subclass)
        } else if let original = contentViewClass {
            object_setClass(content, original)
            contentViewClass = nil
        }
    }
    #endif

    // MARK: Opening and locking

    /// Replaces the document in the editor. Pass nil for an empty one.
    public func load(json: String?) {
        startJSON = json
        guard isReady else { return }
        run("pliHost.load(\(Self.literal(json)))")
    }

    /// Turns editing off or on.
    public func setReadOnly(_ readOnly: Bool) {
        startReadOnly = readOnly
        guard isReady else { return }
        run("pliHost.setReadOnly(\(readOnly))")
    }

    // MARK: Asking for the document

    /// The document as it is now, as JSON.
    public func currentJSON() async throws -> String { try await call("json") }

    /// The document as a .docx file.
    public func exportDocx() async throws -> Data {
        let base64 = try await call("exportDocx")
        guard let data = Data(base64Encoded: base64) else { throw PliError(code: "engine", message: "The editor's file wasn't valid") }
        return data
    }

    public func exportMarkdown() async throws -> String { try await call("exportMarkdown") }
    public func exportHtml() async throws -> String { try await call("exportHtml") }

    /// The document as it is now, opened in the engine, to read or change through `PliDocument`'s methods.
    public func document() async throws -> PliDocument { try PliDocument(json: try await currentJSON()) }

    // MARK: Plumbing

    private func call(_ name: String) async throws -> String {
        guard isReady else { throw PliError(code: "not_ready", message: "The editor hasn't loaded yet") }
        return try await withCheckedThrowingContinuation { continuation in
            let id = nextID
            nextID += 1
            waiting[id] = continuation
            run("pliHost.call(\(id), \(Self.literal(name)), \"\")")
        }
    }

    private func run(_ script: String) {
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error { self?.onError?(error.localizedDescription) }
        }
    }

    /// A string as JavaScript source: quoted, with what needs escaping escaped.
    private static func literal(_ value: String?) -> String {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: [value], options: []), let text = String(data: data, encoding: .utf8) else { return "null" }
        return String(text.dropFirst().dropLast())
    }

    fileprivate func receive(_ body: [String: Any]) {
        switch body["type"] as? String {
        case "ready":
            isReady = true
            run("pliHost.load(\(Self.literal(startJSON)))")
            if startReadOnly { run("pliHost.setReadOnly(true)") }
        case "change":
            if let json = body["json"] as? String {
                latestJSON = json
                onChange?(json)
            }
        case "download":
            if let name = body["name"] as? String, let mime = body["mime"] as? String, let base64 = body["base64"] as? String, let data = Data(base64Encoded: base64) {
                let file = PliDownload(name: name, mimeType: mime, data: data)
                if let onDownload { onDownload(file) } else { PliShare.offer(file, from: webView) }
            }
        case "response":
            guard let id = body["id"] as? Int, let continuation = waiting.removeValue(forKey: id) else { return }
            if body["ok"] as? Bool == true, let value = body["value"] as? String {
                continuation.resume(returning: value)
            } else {
                continuation.resume(throwing: PliError(code: "editor", message: body["error"] as? String ?? "The editor couldn't answer"))
            }
        case "error":
            onError?(body["message"] as? String ?? "The editor reported an error")
        default:
            break
        }
    }
}

/// Holds the controller weakly, so the web view's message handler doesn't keep it alive.
private final class MessageRelay: NSObject, WKScriptMessageHandler {
    weak var controller: PliEditorController?
    init(_ controller: PliEditorController) { self.controller = controller }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        Task { @MainActor in controller?.receive(body) }
    }
}
