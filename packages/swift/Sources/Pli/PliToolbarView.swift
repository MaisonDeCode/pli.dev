import SwiftUI

// Buttons and menus for a `PliDocumentModel`. Each one reads what is on at the selection from `model.format` and does its work with a
// command, so you can use them one by one in your own layout, or use `PliToolbarView` for all of them in a row.

/// A button that shows whether something is on at the selection (bold, a list) and toggles it.
public struct PliToggleButton: View {
    private let title: String
    private let systemImage: String
    private let isOn: Bool
    private let isEnabled: Bool
    private let action: () -> Void

    public init(_ title: String, systemImage: String, isOn: Bool, isEnabled: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.isOn = isOn
        self.isEnabled = isEnabled
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 8).fill(isOn ? Color.accentColor.opacity(0.18) : Color.clear))
                .foregroundColor(isOn ? .accentColor : .primary)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.35)
        .accessibilityLabel(title)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// A menu button with an icon, in the same size as the toggles.
struct PliMenuButton<Content: View>: View {
    let title: String
    let systemImage: String
    var tint: Color?
    let content: Content

    init(_ title: String, systemImage: String, tint: Color? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
        self.content = content()
    }

    var body: some View {
        Menu {
            content
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 36, height: 36)
                .foregroundColor(tint ?? .primary)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(title)
    }
}

/// Undo and Redo.
public struct PliUndoRedoButtons: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    public var body: some View {
        HStack(spacing: 0) {
            PliToggleButton("Undo", systemImage: "arrow.uturn.backward", isOn: false, isEnabled: model.format.canUndo) { model.perform { try $0.undo() } }
            PliToggleButton("Redo", systemImage: "arrow.uturn.forward", isOn: false, isEnabled: model.format.canRedo) { model.perform { try $0.redo() } }
        }
    }
}

/// Paragraph, Title, Subtitle, headings, Quote and Code, with the current one checked.
public struct PliStyleMenu: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    private var current: String {
        guard let block = model.format.block else { return "Mixed" }
        switch block.type {
        case "heading": return "Heading \(block.level ?? 1)"
        case "title": return "Title"
        case "subtitle": return "Subtitle"
        case "quote": return "Quote"
        case "code_block": return "Code"
        case "list_item": return block.list == "ordered" ? "Numbered" : "Bulleted"
        default: return "Text"
        }
    }

    private func isCurrent(_ type: String, level: Int? = nil) -> Bool {
        guard let block = model.format.block else { return false }
        return block.type == type && (level == nil || block.level == level)
    }

    private func item(_ title: String, _ type: String, level: Int? = nil, action: @escaping (PliDocument) throws -> Bool) -> some View {
        Button {
            model.perform { _ = try action($0) }
        } label: {
            if isCurrent(type, level: level) { Label(title, systemImage: "checkmark") } else { Text(title) }
        }
    }

    public var body: some View {
        Menu {
            item("Text", "paragraph") { try $0.setParagraph() }
            item("Title", "title") { try $0.setTitle() }
            item("Subtitle", "subtitle") { try $0.setSubtitle() }
            item("Heading 1", "heading", level: 1) { try $0.setHeading(1) }
            item("Heading 2", "heading", level: 2) { try $0.setHeading(2) }
            item("Heading 3", "heading", level: 3) { try $0.setHeading(3) }
            item("Quote", "quote") { try $0.setQuote() }
            item("Code", "code_block") { try $0.setCodeBlock() }
        } label: {
            HStack(spacing: 4) {
                Text(current).font(.system(size: 14, weight: .medium)).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .foregroundColor(.primary)
            .padding(.horizontal, 10)
            .frame(minWidth: 84, minHeight: 36)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.07)))
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Text style")
    }
}

/// Bold, italic, underline and strikethrough.
public struct PliMarkButtons: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    public var body: some View {
        HStack(spacing: 0) {
            PliToggleButton("Bold", systemImage: "bold", isOn: model.format.marks.bold) { model.perform { _ = try $0.toggleBold() } }
            PliToggleButton("Italic", systemImage: "italic", isOn: model.format.marks.italic) { model.perform { _ = try $0.toggleItalic() } }
            PliToggleButton("Underline", systemImage: "underline", isOn: model.format.marks.underline) { model.perform { _ = try $0.toggleUnderline() } }
            PliToggleButton("Strikethrough", systemImage: "strikethrough", isOn: model.format.marks.strike) { model.perform { _ = try $0.toggleStrikethrough() } }
        }
    }
}

/// Bulleted and numbered lists, and indent and outdent.
public struct PliListButtons: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    public var body: some View {
        HStack(spacing: 0) {
            PliToggleButton("Bulleted list", systemImage: "list.bullet", isOn: model.format.block?.list == "bullet") { model.perform { _ = try $0.toggleBulletedList() } }
            PliToggleButton("Numbered list", systemImage: "list.number", isOn: model.format.block?.list == "ordered") { model.perform { _ = try $0.toggleNumberedList() } }
            PliToggleButton("Outdent", systemImage: "decrease.indent", isOn: false, isEnabled: model.format.canOutdent) { model.perform { _ = try $0.outdent() } }
            PliToggleButton("Indent", systemImage: "increase.indent", isOn: false, isEnabled: model.format.canIndent) { model.perform { _ = try $0.indent() } }
        }
    }
}

/// How a list is marked (1. 2. 3., a. b. c., i. ii. iii., bullets), where numbering starts, and whether it carries on from the list above.
public struct PliListMenu: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    private static let markers: [(PliListMarker, String)] = [
        (.decimal, "1. 2. 3."), (.lowerAlpha, "a. b. c."), (.upperAlpha, "A. B. C."), (.lowerRoman, "i. ii. iii."), (.upperRoman, "I. II. III."),
        (.disc, "• Disc"), (.circle, "◦ Circle"), (.square, "▪ Square"),
    ]

    public var body: some View {
        PliMenuButton("List options", systemImage: "list.number.rtl") {
            if let list = model.format.list {
                ForEach(Self.markers, id: \.0) { marker, title in
                    Button {
                        model.perform { _ = try $0.setListMarker(marker) }
                    } label: {
                        if list.marker == marker.rawValue { Label(title, systemImage: "checkmark") } else { Text(title) }
                    }
                }
                if list.kind == "ordered" {
                    Divider()
                    Button("Restart at 1") { model.perform { _ = try $0.setListStart(1) } }
                    Button("Continue numbering") { model.perform { _ = try $0.continueNumbering() } }
                }
            } else {
                Text("Put the caret in a list")
            }
        }
        .disabled(model.format.list == nil)
    }
}

/// Left, centre, right and justified.
public struct PliAlignmentMenu: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    private static let choices: [(PliAlignment, String, String)] = [
        (.left, "Align left", "text.alignleft"), (.center, "Align centre", "text.aligncenter"),
        (.right, "Align right", "text.alignright"), (.justify, "Justify", "text.justify"),
    ]

    public var body: some View {
        let current = model.format.align ?? "left"
        PliMenuButton("Alignment", systemImage: Self.choices.first { $0.0.rawValue == current }?.2 ?? "text.alignleft") {
            ForEach(Self.choices, id: \.0) { alignment, title, icon in
                Button {
                    model.perform { _ = try $0.setAlignment(alignment) }
                } label: {
                    if current == alignment.rawValue { Label(title, systemImage: "checkmark") } else { Label(title, systemImage: icon) }
                }
            }
        }
    }
}

/// A few colours for text or its highlight, and a way to take the colour off.
public struct PliColorMenu: View {
    public enum Target { case text, highlight }

    @ObservedObject private var model: PliDocumentModel
    private let target: Target
    public init(_ model: PliDocumentModel, target: Target) {
        self.model = model
        self.target = target
    }

    private static let text: [(String, String)] = [
        ("Black", "#111827"), ("Red", "#b91c1c"), ("Orange", "#c2410c"), ("Green", "#15803d"), ("Blue", "#1d4ed8"), ("Purple", "#7e22ce"), ("Gray", "#6b7280"),
    ]
    private static let highlight: [(String, String)] = [
        ("Yellow", "#fef08a"), ("Green", "#bbf7d0"), ("Blue", "#bfdbfe"), ("Pink", "#fbcfe8"), ("Orange", "#fed7aa"), ("Gray", "#e5e7eb"),
    ]

    public var body: some View {
        let current = target == .text ? model.format.color.value : model.format.highlight.value
        PliMenuButton(target == .text ? "Text colour" : "Highlight", systemImage: target == .text ? "textformat" : "highlighter",
                      tint: current.flatMap { PliColorMenu.color(hex: $0) }) {
            ForEach(target == .text ? Self.text : Self.highlight, id: \.1) { name, hex in
                Button {
                    model.perform { doc in _ = target == .text ? try doc.setTextColor(hex) : try doc.setHighlight(hex) }
                } label: {
                    if current?.lowercased() == hex { Label(name, systemImage: "checkmark") } else { Text(name) }
                }
            }
            Divider()
            Button(target == .text ? "Automatic" : "No highlight") {
                model.perform { doc in _ = target == .text ? try doc.setTextColor(nil) : try doc.setHighlight(nil) }
            }
        }
    }

    static func color(hex: String) -> Color? {
        var text = hex.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        return Color(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }
}

/// More character formatting: code, superscript, subscript, and clearing formatting.
public struct PliFormatMenu: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    private func toggle(_ title: String, _ on: Bool, _ action: @escaping (PliDocument) throws -> Bool) -> some View {
        Button {
            model.perform { _ = try action($0) }
        } label: {
            if on { Label(title, systemImage: "checkmark") } else { Text(title) }
        }
    }

    public var body: some View {
        PliMenuButton("More formatting", systemImage: "textformat.alt") {
            toggle("Code", model.format.marks.code) { try $0.toggleCode() }
            toggle("Superscript", model.format.marks.superscript) { try $0.toggleSuperscript() }
            toggle("Subscript", model.format.marks.subscript) { try $0.toggleSubscript() }
            Divider()
            Menu("Line spacing") {
                ForEach([1.0, 1.15, 1.5, 2.0], id: \.self) { value in
                    Button(value == 1 ? "Single" : String(format: "%g", value)) { model.perform { _ = try $0.setLineSpacing(value) } }
                }
            }
            Divider()
            Button("Clear formatting") { model.perform { _ = try $0.clearFormatting() } }
        }
    }
}

/// Things to put in the document: a picture from the photo library, a table, a divider, a page break.
public struct PliInsertMenu: View {
    @ObservedObject private var model: PliDocumentModel
    private let extra: AnyView?
    #if canImport(UIKit)
    @State private var choosingPicture = false
    #endif

    public init(_ model: PliDocumentModel) {
        self.model = model
        extra = nil
    }

    /// Adds your own items after the built-in ones.
    public init<Extra: View>(_ model: PliDocumentModel, @ViewBuilder extra: () -> Extra) {
        self.model = model
        self.extra = AnyView(extra())
    }

    public var body: some View {
        let menu = PliMenuButton("Insert", systemImage: "plus.circle") {
            #if canImport(UIKit)
            Button { choosingPicture = true } label: { Label("Picture", systemImage: "photo") }
            #elseif canImport(AppKit)
            Button { model.choosePicture() } label: { Label("Picture…", systemImage: "photo") }
            #endif
            Button { model.perform { _ = try $0.insertTable(rows: 3, columns: 3) } } label: { Label("Table", systemImage: "tablecells") }
            Button { model.perform { _ = try $0.insertDivider() } } label: { Label("Divider", systemImage: "minus") }
            Button { model.perform { _ = try $0.insertPageBreak() } } label: { Label("Page break", systemImage: "doc.on.doc") }
            if let extra { extra }
        }
        #if canImport(UIKit)
        menu.sheet(isPresented: $choosingPicture) {
            PliPhotoPicker { image in model.insertPicture(image) }
                .ignoresSafeArea()
        }
        #else
        menu
        #endif
    }
}

#if canImport(UIKit)
import PhotosUI

/// The system photo picker, for one picture. It needs no permission: the app sees only what is chosen.
struct PliPhotoPicker: UIViewControllerRepresentable {
    let onPick: (UIImage) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onPick) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPick: (UIImage) -> Void
        init(_ onPick: @escaping (UIImage) -> Void) { self.onPick = onPick }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else { return }
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                guard let image = object as? UIImage else { return }
                DispatchQueue.main.async { self.onPick(image) }
            }
        }
    }
}
#endif

/// What to do with the selected picture: crop it, wrap text around it, set its size, or delete it. Tap a picture to select it; drag the dot
/// on its corner to resize it freely.
/// It does nothing when no picture is selected, so show it only when `model.format.image` is set.
public struct PliPictureMenu: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    private var picture: PliContentBlock? {
        guard let id = model.format.image?.id else { return nil }
        return PliDocumentModel.find(id, in: model.blocks)
    }

    public var body: some View {
        let current = picture
        PliMenuButton("Picture", systemImage: "photo") {
            if let id = current?.id {
                Button { model.setCropping(id, model.croppingPicture != id) } label: {
                    if model.croppingPicture == id { Label("Done cropping", systemImage: "checkmark") } else { Label("Crop", systemImage: "crop") }
                }
                Menu("Crop to a shape") {
                    Button("Square") { model.cropPicture(id, toAspect: 1) }
                    Button("4 : 3") { model.cropPicture(id, toAspect: 4.0 / 3) }
                    Button("16 : 9") { model.cropPicture(id, toAspect: 16.0 / 9) }
                    Button("3 : 4") { model.cropPicture(id, toAspect: 3.0 / 4) }
                    Divider()
                    Button("Show all of it") { model.cropPicture(id, toAspect: nil) }.disabled(current?.crop == nil)
                }
                Menu("Text wrapping") {
                    ForEach([("On its own line", nil), ("Text on the right", "left"), ("Text on the left", "right")], id: \.0) { name, side in
                        Button {
                            model.wrapPicture(id, side)
                        } label: {
                            if current?.wrap == side { Label(name, systemImage: "checkmark") } else { Text(name) }
                        }
                    }
                }
                Divider()
            }
            ForEach([("Small", 160.0), ("Medium", 320.0), ("Large", 480.0)], id: \.0) { name, width in
                Button(name) {
                    guard let picture, let w = picture.width, let h = picture.height, w > 0 else { return }
                    model.setImageSize(picture.id, width: Int(width), height: Int((h * width / w).rounded()), merge: false)
                }
            }
            Divider()
            Button(role: .destructive) {
                if let id = model.format.image?.id { model.deletePicture(id) }
            } label: { Label("Delete picture", systemImage: "trash") }
        }
    }
}

/// Rows and columns of the table the caret is in: add and delete them, merge and split cells, a header row, a colour for cells.
/// Select from one cell to another (press and drag) to merge them. It does nothing outside a table, so show it only when `model.format.table` is set.
public struct PliTableMenu: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    private static let shades: [(String, String)] = [("Yellow", "#fef08a"), ("Green", "#bbf7d0"), ("Blue", "#bfdbfe"), ("Pink", "#fbcfe8"), ("Gray", "#e5e7eb")]

    public var body: some View {
        let table = model.format.table
        PliMenuButton("Table", systemImage: "tablecells.badge.ellipsis") {
            Button { model.perform { _ = try $0.addRowAbove() } } label: { Label("Insert row above", systemImage: "arrow.up.to.line") }
            Button { model.perform { _ = try $0.addRowBelow() } } label: { Label("Insert row below", systemImage: "arrow.down.to.line") }
            Button { model.perform { _ = try $0.addColumnLeft() } } label: { Label("Insert column left", systemImage: "arrow.left.to.line") }
            Button { model.perform { _ = try $0.addColumnRight() } } label: { Label("Insert column right", systemImage: "arrow.right.to.line") }
            Divider()
            Button { model.perform { _ = try $0.mergeCells() } } label: { Label("Merge cells", systemImage: "rectangle.compress.vertical") }
                .disabled(table?.canMerge != true)
            Button { model.perform { _ = try $0.splitCells() } } label: { Label("Split cells", systemImage: "rectangle.expand.vertical") }
                .disabled(table?.canSplit != true)
            Button { model.perform { _ = try $0.setHeaderRow(!(table?.headerRow ?? false)) } } label: {
                if table?.headerRow == true { Label("Header row", systemImage: "checkmark") } else { Text("Header row") }
            }
            Menu("Cell colour") {
                ForEach(Self.shades, id: \.1) { name, hex in
                    Button(name) { model.perform { _ = try $0.setCellShade(hex) } }
                }
                Divider()
                Button("No colour") { model.perform { _ = try $0.setCellShade(nil) } }
            }
            Divider()
            Button(role: .destructive) { model.perform { _ = try $0.deleteRow() } } label: { Label("Delete row", systemImage: "trash") }
            Button(role: .destructive) { model.perform { _ = try $0.deleteColumn() } } label: { Label("Delete column", systemImage: "trash") }
            Button(role: .destructive) { model.perform { _ = try $0.deleteTable() } } label: { Label("Delete table", systemImage: "trash") }
        }
    }
}

/// Select all, cut, copy and paste. To select across blocks by hand, press and hold on text and drag.
public struct PliEditMenu: View {
    @ObservedObject private var model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    public var body: some View {
        PliMenuButton("Edit", systemImage: "doc.on.clipboard") {
            Button { model.selectAll() } label: { Label("Select all", systemImage: "selection.pin.in.out") }
            Divider()
            Button { model.cut() } label: { Label("Cut", systemImage: "scissors") }
            Button { model.copy() } label: { Label("Copy", systemImage: "doc.on.doc") }
            Button { model.paste() } label: { Label("Paste", systemImage: "doc.on.clipboard") }
        }
    }
}

/// All of the buttons and menus in a row that scrolls sideways: undo and redo, the text style, bold and the other marks, colours,
/// lists, alignment, insert, the table's menu while the caret is in a table, and more formatting. Use the pieces on their own for a toolbar of your own.
public struct PliToolbarView: View {
    @ObservedObject private var model: PliDocumentModel
    private let edge: VerticalEdge

    /// - Parameter edge: Which edge of the editor the toolbar sits on, which decides where its dividing line is. By default it is the top on a Mac,
    ///   like a document window's toolbar, and the bottom on iPhone and iPad, where it rides above the keyboard.
    public init(_ model: PliDocumentModel, edge: VerticalEdge = PliToolbarView.defaultEdge) {
        self.model = model
        self.edge = edge
    }

    /// Where the toolbar goes on this kind of device.
    public static var defaultEdge: VerticalEdge {
        #if canImport(UIKit)
        .bottom
        #else
        .top
        #endif
    }

    public var body: some View {
        VStack(spacing: 0) {
            if edge == .bottom { Divider() }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    PliUndoRedoButtons(model)
                    divider
                    PliStyleMenu(model)
                    divider
                    PliMarkButtons(model)
                    PliColorMenu(model, target: .text)
                    PliColorMenu(model, target: .highlight)
                    divider
                    PliListButtons(model)
                    PliListMenu(model)
                    PliAlignmentMenu(model)
                    divider
                    PliInsertMenu(model)
                    if model.format.table != nil { PliTableMenu(model) }
                    if model.format.image != nil { PliPictureMenu(model) }
                    PliFormatMenu(model)
                    PliEditMenu(model)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            }
            if edge == .top { Divider() }
        }
        .background(Color(.pliToolbarBackground))
    }

    private var divider: some View {
        Rectangle().fill(Color.primary.opacity(0.15)).frame(width: 1, height: 22).padding(.horizontal, 4)
    }
}

extension PliPlatformColor {
    static var pliToolbarBackground: PliPlatformColor {
        #if canImport(UIKit)
        .secondarySystemBackground
        #else
        .windowBackgroundColor
        #endif
    }
}

/// The whole native editor in one view: the blocks, with the toolbar above them on a Mac (like a document window) and under them on
/// iPhone and iPad (above the keyboard).
///
/// ```swift
/// PliNativeEditor(model)
/// ```
///
/// To lay it out yourself, use `PliBlocksView` and `PliToolbarView` (or the pieces of it) on their own.
public struct PliNativeEditor: View {
    private let model: PliDocumentModel
    public init(_ model: PliDocumentModel) { self.model = model }

    public var body: some View {
        VStack(spacing: 0) {
            if PliToolbarView.defaultEdge == .top { PliToolbarView(model, edge: .top) }
            PliBlocksView(model)
            if PliToolbarView.defaultEdge == .bottom { PliToolbarView(model, edge: .bottom) }
        }
    }
}
