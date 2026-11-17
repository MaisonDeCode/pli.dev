import Foundation
import Pli

/// Holds a `PliDocument` and what the screen needs from it. Every change goes through `run`, which does it, then reads the
/// document again: the document is the one source of truth, and the views only draw what it says.
@MainActor
final class EditorModel: ObservableObject {
    let document: PliDocument

    @Published private(set) var blocks: [PliBlock] = []
    @Published private(set) var state: PliState?
    @Published private(set) var statistics: PliStatistics?
    @Published private(set) var html = ""
    @Published var message: String?

    private let fileURL: URL = URL.documentsDirectory.appending(path: "Example.pli.json")

    init() {
        // Open what was saved last time, or start with a short sample.
        if let saved = try? String(contentsOf: fileURL, encoding: .utf8), let opened = try? PliDocument(json: saved) {
            document = opened
        } else {
            document = try! PliDocument(title: "My document")
            try? Self.writeSample(into: document)
        }
        refresh()
    }

    // MARK: Reading

    /// The block the caret is in.
    var currentBlock: PliBlock? {
        guard let id = state?.selection?.focus.block else { return nil }
        return blocks.first { $0.id == id }
    }

    var canUndo: Bool { state?.canUndo ?? false }
    var canRedo: Bool { state?.canRedo ?? false }

    func refresh() {
        do {
            blocks = try document.blocks()
            state = try document.state()
            statistics = try document.statistics()
            html = try document.html()
        } catch {
            message = "\(error)"
        }
    }

    // MARK: Changing

    /// Runs a change to the document, reads it again, and keeps it for next time.
    func run(_ change: () throws -> Void) {
        do {
            try change()
            try save()
        } catch {
            message = "\(error)"
        }
        refresh()
    }

    /// Puts the caret at the end of a block, as tapping on it does.
    func place(in block: PliBlock) {
        run { try document.select(anchorBlock: block.id, anchorOffset: block.text.utf16.count, focusBlock: block.id, focusOffset: block.text.utf16.count) }
    }

    func type(_ text: String) {
        guard !text.isEmpty else { return }
        run { try document.typeText(text) }
    }

    // MARK: Files

    private func save() throws {
        try document.json().write(to: fileURL, atomically: true, encoding: .utf8)
    }

    /// A file in the temporary folder for the share sheet to offer.
    func exported(_ format: ExportFormat) throws -> URL {
        let url = URL.temporaryDirectory.appending(path: "\(try document.title()).\(format.fileExtension)")
        switch format {
        case .docx: try document.exportDocx().write(to: url)
        case .markdown: try document.markdown().write(to: url, atomically: true, encoding: .utf8)
        case .html: try document.html().write(to: url, atomically: true, encoding: .utf8)
        }
        return url
    }

    func importDocx(from url: URL) {
        run {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let result = try document.importDocx(Data(contentsOf: url))
            if !result.warnings.isEmpty { message = "Opened, with notes: " + result.warnings.joined(separator: " ") }
        }
    }

    func startOver() {
        run {
            try document.selectAll()
            try document.deleteSelection()
            try Self.writeSample(into: document)
        }
    }

    private static func writeSample(into document: PliDocument) throws {
        try document.setParagraph()
        try document.typeText("Welcome to Pli")
        try document.setHeading(1)
        try document.splitBlock()
        try document.typeText("This is an ordinary document made through the Swift API. Tap a block to move the caret, use the buttons above to format it, and type below.")
        try document.splitBlock()
        try document.typeText("It has lists")
        try document.splitBlock()
        try document.typeText("Numbered, lettered or in roman numerals")
        try document.toggleNumberedList()
        try document.splitBlock()
        try document.typeText("Restarted or started at any number")
        try document.splitBlock()
        try document.typeText("Saved as a DOCX file")
    }
}

enum ExportFormat: String, CaseIterable, Identifiable {
    case docx, markdown, html
    var id: String { rawValue }
    var title: String {
        switch self {
        case .docx: "DOCX file (.docx)"
        case .markdown: "Markdown (.md)"
        case .html: "Web page (.html)"
        }
    }
    var fileExtension: String { self == .markdown ? "md" : rawValue }
}
