import SwiftUI
import UniformTypeIdentifiers
import Pli

/// The whole screen: the document's blocks (or how it exports), a bar of commands, and a field to type in.
///
/// There is no ready-made editing view for Swift yet, so this app draws the blocks itself from `document.blocks()`. Each
/// button is one call on the document, such as `toggleBold()` or `setHeading(1)`.
struct EditorView: View {
    @EnvironmentObject private var editor: EditorModel
    @State private var mode: Mode = .blocks
    @State private var typed = ""
    @State private var importing = false
    @State private var askStart = false
    @State private var startText = "1"

    enum Mode: String, CaseIterable, Identifiable {
        case blocks = "Blocks", preview = "Preview"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("View", selection: $mode) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding([.horizontal, .top])

                switch mode {
                case .blocks: BlocksView()
                case .preview: PreviewView(html: editor.html)
                }

                if mode == .blocks { TypingBar(typed: $typed) }
            }
            .navigationTitle("Pli")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Footer()
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "docx") ?? .data]) { result in
                if case .success(let url) = result { editor.importDocx(from: url) }
            }
            .alert("Start numbering at", isPresented: $askStart) {
                TextField("Number", text: $startText).keyboardType(.numberPad)
                Button("Apply") { if let n = Int(startText) { editor.run { try editor.document.setListStart(n) } } }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Pli", isPresented: Binding(get: { editor.message != nil }, set: { if !$0 { editor.message = nil } })) {
                Button("OK") {}
            } message: {
                Text(editor.message ?? "")
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Button { editor.run { try editor.document.undo() } } label: { Image(systemName: "arrow.uturn.backward") }
                .disabled(!editor.canUndo)
            Button { editor.run { try editor.document.redo() } } label: { Image(systemName: "arrow.uturn.forward") }
                .disabled(!editor.canRedo)
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            formatMenu
            blockMenu
            listMenu
            insertMenu
            fileMenu
        }
    }

    private var formatMenu: some View {
        Menu {
            Button("Bold") { editor.run { try editor.document.toggleBold() } }
            Button("Italic") { editor.run { try editor.document.toggleItalic() } }
            Button("Underline") { editor.run { try editor.document.toggleUnderline() } }
            Button("Strikethrough") { editor.run { try editor.document.toggleStrikethrough() } }
            Button("Code") { editor.run { try editor.document.toggleCode() } }
            Divider()
            Button("Red text") { editor.run { try editor.document.setTextColor("#b91c1c") } }
            Button("Highlight") { editor.run { try editor.document.setHighlight("#fef08a") } }
            Button("Clear formatting") { editor.run { try editor.document.clearFormatting() } }
            Divider()
            Button("Align left") { editor.run { try editor.document.setAlignment(.left) } }
            Button("Align centre") { editor.run { try editor.document.setAlignment(.center) } }
            Button("Align right") { editor.run { try editor.document.setAlignment(.right) } }
        } label: { Image(systemName: "bold.italic.underline") }
    }

    private var blockMenu: some View {
        Menu {
            Button("Paragraph") { editor.run { try editor.document.setParagraph() } }
            Button("Title") { editor.run { try editor.document.setTitle() } }
            Button("Heading 1") { editor.run { try editor.document.setHeading(1) } }
            Button("Heading 2") { editor.run { try editor.document.setHeading(2) } }
            Button("Heading 3") { editor.run { try editor.document.setHeading(3) } }
            Button("Quote") { editor.run { try editor.document.setQuote() } }
        } label: { Image(systemName: "textformat.size") }
    }

    private var listMenu: some View {
        Menu {
            Button("Bulleted list") { editor.run { try editor.document.toggleBulletedList() } }
            Button("Numbered list") { editor.run { try editor.document.toggleNumberedList() } }
            Divider()
            Button("1. 2. 3.") { editor.run { try editor.document.setListMarker(.decimal) } }
            Button("a. b. c.") { editor.run { try editor.document.setListMarker(.lowerAlpha) } }
            Button("A. B. C.") { editor.run { try editor.document.setListMarker(.upperAlpha) } }
            Button("i. ii. iii.") { editor.run { try editor.document.setListMarker(.lowerRoman) } }
            Button("I. II. III.") { editor.run { try editor.document.setListMarker(.upperRoman) } }
            Divider()
            Button("Restart at 1") { editor.run { try editor.document.setListStart(1) } }
            Button("Start at…") { askStart = true }
            Button("Continue numbering") { editor.run { try editor.document.continueNumbering() } }
            Divider()
            Button("Indent") { editor.run { try editor.document.indent() } }
            Button("Outdent") { editor.run { try editor.document.outdent() } }
        } label: { Image(systemName: "list.number") }
    }

    private var insertMenu: some View {
        Menu {
            Button("Table (2 × 3)") { editor.run { try editor.document.insertTable(rows: 2, columns: 3) } }
            Button("Horizontal line") { editor.run { try editor.document.insertDivider() } }
            Button("Page break") { editor.run { try editor.document.insertPageBreak() } }
        } label: { Image(systemName: "plus.square") }
    }

    private var fileMenu: some View {
        Menu {
            ForEach(ExportFormat.allCases) { format in
                if let url = try? editor.exported(format) {
                    ShareLink(item: url) { Label("Share as \(format.title)", systemImage: "square.and.arrow.up") }
                }
            }
            Divider()
            Button("Open a DOCX file…") { importing = true }
            Button("Start over", role: .destructive) { editor.startOver() }
        } label: { Image(systemName: "ellipsis.circle") }
    }
}

/// Every block, as a row. Tapping one puts the caret at the end of it.
struct BlocksView: View {
    @EnvironmentObject private var editor: EditorModel

    var body: some View {
        List(editor.blocks) { block in
            BlockRow(block: block, isCurrent: block.id == editor.currentBlock?.id)
                .contentShape(Rectangle())
                .onTapGesture { editor.place(in: block) }
                .listRowBackground(block.id == editor.currentBlock?.id ? Color.accentColor.opacity(0.12) : nil)
        }
        .listStyle(.plain)
    }
}

struct BlockRow: View {
    let block: PliBlock
    let isCurrent: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let label = block.label {
                Text(label).foregroundStyle(.secondary).frame(minWidth: 24, alignment: .trailing)
            }
            content
            Spacer(minLength: 0)
        }
        .padding(.leading, CGFloat(block.depth ?? 0) * 20)
    }

    @ViewBuilder
    private var content: some View {
        switch block.type {
        case "title": Text(block.text).font(.largeTitle.bold())
        case "subtitle": Text(block.text).font(.title3).foregroundStyle(.secondary)
        case "heading": Text(block.text).font(headingFont(block.level ?? 1)).bold()
        case "quote": Text(block.text).italic().foregroundStyle(.secondary).padding(.leading, 8)
        case "code_block": Text(block.text).font(.system(.body, design: .monospaced))
        case "table": Label("Table, \(block.rows ?? 0) × \(block.columns ?? 0)", systemImage: "tablecells").foregroundStyle(.secondary)
        case "image": Label("Picture", systemImage: "photo").foregroundStyle(.secondary)
        case "divider": Divider()
        case "page_break": Label("Page break", systemImage: "scissors").foregroundStyle(.secondary)
        default: Text(block.text.isEmpty ? " " : block.text)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title.bold()
        case 2: .title2.bold()
        default: .title3.bold()
        }
    }
}

/// A field to type into the document at the caret, and the keys a keyboard would have.
struct TypingBar: View {
    @EnvironmentObject private var editor: EditorModel
    @Binding var typed: String

    var body: some View {
        HStack {
            TextField("Type at the caret…", text: $typed)
                .textFieldStyle(.roundedBorder)
                .onSubmit(send)
            Button("Add", action: send)
                .buttonStyle(.borderedProminent)
                .disabled(typed.isEmpty)
            Button { editor.run { try editor.document.splitBlock() } } label: { Image(systemName: "return") }
            Button { editor.run { try editor.document.backspace() } } label: { Image(systemName: "delete.left") }
        }
        .padding()
        .background(.bar)
    }

    private func send() {
        editor.type(typed)
        typed = ""
    }
}

/// How many words, and which block the caret is in.
struct Footer: View {
    @EnvironmentObject private var editor: EditorModel

    var body: some View {
        HStack {
            Text("\(editor.statistics?.words ?? 0) words")
            Spacer()
            Text(editor.currentBlock.map { "In: \($0.type.replacingOccurrences(of: "_", with: " "))" } ?? "")
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(.bar)
    }
}
