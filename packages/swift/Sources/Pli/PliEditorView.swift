import SwiftUI
import WebKit

/// The full Pli editor, in SwiftUI: menus, toolbar, pages or pageless, tables, lists, comments, find and replace, and DOCX, PDF,
/// Markdown and HTML files out. It is the same editor as the JavaScript package's `PliDocument`, running in a web view.
///
/// The shortest way to use it keeps the document in a string you own:
///
/// ```swift
/// struct NotesScreen: View {
///     @State private var document = ""            // a saved document, or empty for a new one
///
///     var body: some View {
///         PliEditor(json: $document)
///     }
/// }
/// ```
///
/// For more (saving to a file, exporting, reading the document with `PliDocument`), make a `PliEditorController` and show it
/// with `PliEditorView`.
public struct PliEditor: View {
    @Binding private var json: String
    @StateObject private var controller: PliEditorController
    private let readOnly: Bool

    /// - Parameters:
    ///   - json: The document, as JSON. It starts as whatever it holds (empty means a new document), and each edit writes the document back into it.
    ///   - readOnly: Show the document without letting anyone change it.
    public init(json: Binding<String>, readOnly: Bool = false) {
        _json = json
        self.readOnly = readOnly
        _controller = StateObject(wrappedValue: PliEditorController(json: json.wrappedValue.isEmpty ? nil : json.wrappedValue, readOnly: readOnly))
    }

    public var body: some View {
        PliEditorView(controller)
            .onAppear {
                controller.onChange = { newJSON in
                    if newJSON != json { json = newJSON }
                }
            }
            .onChange(of: json) { newValue in
                // Something other than the editor changed the string: open it.
                if newValue != controller.latestJSON { controller.load(json: newValue.isEmpty ? nil : newValue) }
            }
            .onChange(of: readOnly) { controller.setReadOnly($0) }
    }
}

#if canImport(UIKit)
import UIKit

/// The editor for a `PliEditorController`, as a view.
public struct PliEditorView: UIViewRepresentable {
    private let controller: PliEditorController

    public init(_ controller: PliEditorController) { self.controller = controller }

    public func makeUIView(context: Context) -> WKWebView { controller.webView }
    public func updateUIView(_ view: WKWebView, context: Context) {}
}

/// Offers a file the editor made in the system share sheet: Save to Files, AirDrop, Mail.
enum PliShare {
    @MainActor
    static func offer(_ file: PliDownload, from view: UIView) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(file.name)
        guard (try? file.data.write(to: url)) != nil else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 1, width: 1, height: 1)
        var top = view.window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        top?.present(sheet, animated: true)
    }
}
#elseif canImport(AppKit)
import AppKit

/// The editor for a `PliEditorController`, as a view.
public struct PliEditorView: NSViewRepresentable {
    private let controller: PliEditorController

    public init(_ controller: PliEditorController) { self.controller = controller }

    public func makeNSView(context: Context) -> WKWebView { controller.webView }
    public func updateNSView(_ view: WKWebView, context: Context) {}
}

/// Offers a file the editor made in a save panel.
enum PliShare {
    @MainActor
    static func offer(_ file: PliDownload, from view: NSView) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = file.name
        panel.begin { response in
            if response == .OK, let url = panel.url { try? file.data.write(to: url) }
        }
    }
}
#endif
