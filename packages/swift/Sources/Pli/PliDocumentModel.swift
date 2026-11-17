import Foundation
import Combine
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// A document for your own screens: the engine's `PliDocument` plus what a view needs, kept up to date. Every change goes through
/// `perform`, which makes it and reads the document again, so views only draw what the document says.
///
/// ```swift
/// let model = PliDocumentModel(json: saved)
/// model.onChange = { json in save(json) }
///
/// PliBlocksView(model)                  // the document, with its formatting, editable
/// PliToolbarView(model)                 // buttons and menus for the selection
/// model.perform { try $0.toggleBold() } // or any command, from your own button
/// ```
@MainActor
public final class PliDocumentModel: ObservableObject {
    /// The engine's document. Use it to read, or to make changes through `perform`.
    public let document: PliDocument

    /// The blocks to draw, with their text in runs.
    @Published public private(set) var blocks: [PliContentBlock] = []
    /// What a toolbar shows: which formatting is on at the selection, and so on.
    @Published public private(set) var format: PliFormat = .empty
    /// Where the caret or selection is.
    @Published public private(set) var selection: PliSelection?
    /// Sent after every change has been read back, so views that aren't SwiftUI (`PliBlocksScrollView`) can bring themselves up to date.
    public let didRefresh = PassthroughSubject<Void, Never>()
    /// The picture whose crop is being set, if any: it shows all of the picture with a grip on each edge.
    @Published public private(set) var croppingPicture: String?
    /// Whether text wraps around pictures that are set to wrap. The blocks that can't do it (a table cell) don't ask.
    var wrapsPictures = true
    /// The block whose text view should take the keyboard, when the caret has moved there (after Enter, say).
    var focusRequest: String?

    /// The blocks that have text, in reading order, and how long each text is: what a selection across blocks is measured in.
    private var order: [(id: String, length: Int)] = []
    private var index: [String: Int] = [:]

    /// Called after each change, with the whole document as JSON, so you can save it.
    public var onChange: ((String) -> Void)?
    /// Called when a command can't be done, with the engine's message.
    public var onError: ((String) -> Void)?

    public init(json: String? = nil, title: String = "Untitled", user: PliUser? = nil) throws {
        document = try PliDocument(json: json, title: title, user: user)
        refresh()
    }

    /// Makes a change to the document, then reads it again. This is the one way to change what is on screen.
    @discardableResult
    public func perform(_ change: (PliDocument) throws -> Void) -> Bool {
        do {
            try change(document)
            // When a command moves the caret to another block (a table was inserted, an undo), the keyboard follows it.
            if let now = try? document.selection(), now.focus.block != selection?.focus.block { focusRequest = now.focus.block }
            refresh()
            if let onChange, let json = try? document.json() { onChange(json) }
            return true
        } catch {
            onError?("\(error)")
            refresh()
            return false
        }
    }

    /// Reads the blocks, the formatting and the selection again.
    public func refresh() {
        blocks = (try? document.content()) ?? blocks
        format = (try? document.format()) ?? format
        selection = (try? document.selection()) ?? nil
        if let cropping = croppingPicture, format.image?.id != cropping { croppingPicture = nil }
        order = []
        collect(blocks)
        index = Dictionary(order.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        didRefresh.send()
    }

    private func collect(_ list: [PliContentBlock]) {
        for block in list {
            if block.isText { order.append((block.id, block.text.utf16.count)) }
            for row in block.rows ?? [] { for cell in row.cells { collect(cell.blocks) } }
        }
    }

    // MARK: Selecting across blocks

    /// True when the selection runs from one block to another.
    public var isMultiBlock: Bool {
        guard let selection else { return false }
        return selection.anchor.block != selection.focus.block
    }

    /// The part of a block's text that a selection across blocks covers, or nil if it doesn't cover any of it (or the selection is in one block).
    func selectedRange(in block: String) -> NSRange? {
        guard let selection, isMultiBlock, let a = index[selection.anchor.block], let f = index[selection.focus.block], let b = index[block] else { return nil }
        let (first, last) = a <= f ? (selection.anchor, selection.focus) : (selection.focus, selection.anchor)
        let low = min(a, f), high = max(a, f)
        guard b >= low, b <= high else { return nil }
        let length = order[b].length
        let from = min(b == low ? first.offset : 0, length)
        let to = min(b == high ? last.offset : length, length)
        return NSRange(location: from, length: max(0, to - from))
    }

    /// The text block before or after another, with its text's length.
    func neighbor(of block: String, _ step: Int) -> (id: String, length: Int)? {
        guard let i = index[block], order.indices.contains(i + step) else { return nil }
        return order[i + step]
    }

    func indexOf(_ block: String) -> Int? { index[block] }

    func length(of block: String) -> Int { index[block].map { order[$0].length } ?? 0 }

    /// Selects from one place to another, which may be in different blocks. Doesn't count as a change to the document.
    public func selectRange(anchor: PliPoint, focus: PliPoint) {
        let wanted = PliSelection(anchor: anchor, focus: focus)
        guard selection != wanted else { return }
        do {
            try document.select(anchorBlock: anchor.block, anchorOffset: anchor.offset, focusBlock: focus.block, focusOffset: focus.offset)
        } catch {
            onError?("\(error)")
        }
        refresh()
    }

    /// Selects the whole document.
    public func selectAll() {
        try? document.selectAll()
        refresh()
    }

    /// The selected text, as plain text.
    public func selectedText() -> String { (try? document.selectedText()) ?? "" }

    /// Puts the selection on the pasteboard, as plain text and as HTML that keeps its formatting.
    public func copy() {
        guard let content = try? document.clipboard(), !content.text.isEmpty else { return }
        #if canImport(UIKit)
        UIPasteboard.general.setItems([["public.utf8-plain-text": content.text, "public.html": content.html]])
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(content.text, forType: .string)
        NSPasteboard.general.setString(content.html, forType: .html)
        #endif
    }

    /// Copies the selection and removes it.
    public func cut() {
        copy()
        perform { _ = try $0.deleteSelection() }
        focusRequest = selection?.focus.block
        didRefresh.send()
    }

    /// Puts what the pasteboard has in at the caret, over any selection, keeping formatting from HTML or RTF (a web page, Word, Pages,
    /// another Pli document), tables from a spreadsheet's rows, and a copied picture as a picture.
    public func paste() {
        #if canImport(UIKit)
        let board = UIPasteboard.general
        let html = board.data(forPasteboardType: "public.html").flatMap { String(data: $0, encoding: .utf8) }
        let rtf = board.data(forPasteboardType: "public.rtf").flatMap { String(data: $0, encoding: .utf8) ?? String(data: $0, encoding: .isoLatin1) }
        let text = board.string
        if (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, html == nil, let image = board.image {
            insertPicture(image)
            return
        }
        #elseif canImport(AppKit)
        let board = NSPasteboard.general
        let html = board.string(forType: .html)
        let rtf = board.string(forType: .rtf)
        let text = board.string(forType: .string)
        #endif
        guard html != nil || rtf != nil || !(text ?? "").isEmpty else { return }
        perform { _ = try $0.paste(html: html, rtf: rtf, text: text) }
        focusRequest = selection?.focus.block
        didRefresh.send()
    }

    /// Moves the edge between a table's column and the next, as it is dragged. `position` is from the table's left edge, 0 to 1.
    /// `merge` is false for the first move of a drag and true after, so the whole drag is one step to undo.
    func moveColumnEdge(table: String, column: Int, position: Double, merge: Bool) {
        perform { _ = try $0.setColumnEdge(table: table, column: column, position: position, merge: merge) }
    }

    /// Sets the least height of a table row, in the document's points, as its bottom edge is dragged.
    func setRowHeight(table: String, row: Int, points: Double?, merge: Bool) {
        perform { _ = try $0.setRowHeight(table: table, row: row, points: points, merge: merge) }
    }

    /// Sets the size a picture is shown at, in pixels, as its corner is dragged.
    public func setImageSize(_ image: String, width: Int, height: Int, merge: Bool) {
        perform { _ = try $0.setImageSize(image: image, width: width, height: height, merge: merge) }
    }

    /// Sets how much is cut away from each edge of a picture. Its scale stays, so it gets smaller on the page as an edge is cut.
    func setImageCrop(_ image: String, _ crop: PliCrop, merge: Bool) {
        perform { _ = try $0.setImageCrop(image: image, top: crop.top, right: crop.right, bottom: crop.bottom, left: crop.left, merge: merge) }
    }

    /// Starts or ends setting a picture's crop by dragging its edges.
    public func setCropping(_ image: String, _ on: Bool) {
        if on { selectPicture(image) }
        croppingPicture = on ? image : nil
        didRefresh.send()
    }

    /// Crops a picture to a shape (width over height), centred on what it shows now, or shows all of it with nil.
    public func cropPicture(_ image: String, toAspect aspect: Double?) {
        guard let block = Self.find(image, in: blocks), let width = block.width, let height = block.height else { return }
        let was = block.crop ?? .none
        guard let aspect else { setImageCrop(image, .none, merge: false); return }
        // The whole picture is the shape to cut from.
        let fullWidth = width / (1 - was.left - was.right), fullHeight = height / (1 - was.top - was.bottom)
        var next = PliCrop.none
        if aspect < fullWidth / fullHeight {
            let kept = aspect * fullHeight / fullWidth
            next.left = (1 - kept) / 2
            next.right = next.left
        } else {
            let kept = fullWidth / aspect / fullHeight
            next.top = (1 - kept) / 2
            next.bottom = next.top
        }
        setImageCrop(image, next, merge: false)
    }

    /// Makes text wrap around a picture, which then sits at the left or right edge, or puts it on a line of its own with nil.
    public func wrapPicture(_ image: String, _ side: String?) {
        perform { _ = try $0.setImageWrap(image: image, wrap: side) }
    }

    /// Selects a picture, so the picture menu works on it and its corner can be dragged.
    func selectPicture(_ image: String) {
        guard selection?.focus.block != image else { return }
        perform { try $0.select(anchorBlock: image, anchorOffset: 0, focusBlock: image, focusOffset: 0) }
    }

    /// Deletes a picture.
    public func deletePicture(_ image: String) {
        perform { _ = try $0.deleteImage(image) }
    }

    /// Types, splits or deletes over a selection that spans blocks.
    func replaceSelection(with text: String) {
        perform { doc in
            if text.isEmpty { _ = try doc.deleteSelection() }
            else if text == "\n" { _ = try doc.splitBlock() }
            else if text.contains("\n") { _ = try doc.pasteText(text) }
            else { _ = try doc.typeText(text) }
        }
        focusRequest = selection?.focus.block
        didRefresh.send()
    }

    /// Tells the document where the caret is, from a text view. Doesn't change the text.
    func place(block: String, from: Int, to: Int) {
        guard selection?.anchor != PliPoint(block: block, offset: from) || selection?.focus != PliPoint(block: block, offset: to) else { return }
        let wasMultiBlock = isMultiBlock
        let wasImage = format.image?.id, wasTable = format.table?.id
        do {
            try document.select(anchorBlock: block, anchorOffset: from, focusBlock: block, focusOffset: to)
            selection = try document.selection()
            format = try document.format()
        } catch {
            onError?("\(error)")
        }
        // The blocks that were tinted as selected, a picture that was selected, and a table's grips need drawing again.
        if wasMultiBlock || wasImage != format.image?.id || wasTable != format.table?.id { didRefresh.send() }
    }

    /// Replaces a range of a block's text (in UTF-16 units) with `text`.
    func replace(block: String, from: Int, to: Int, with text: String) {
        perform { doc in
            // Moving the selection to where it already is would drop formatting that was switched on for the next characters.
            if selection != PliSelection(anchor: PliPoint(block: block, offset: from), focus: PliPoint(block: block, offset: to)) {
                try doc.select(anchorBlock: block, anchorOffset: from, focusBlock: block, focusOffset: to)
            }
            if text.isEmpty { try doc.deleteSelection() }
            else if text.contains("\n") { try doc.pasteText(text) }
            else { try doc.typeText(text) }
        }
    }

    /// Enter at a place in a block.
    func split(block: String, from: Int, to: Int) {
        perform { doc in
            try doc.select(anchorBlock: block, anchorOffset: from, focusBlock: block, focusOffset: to)
            try doc.splitBlock()
        }
        focusRequest = selection?.focus.block
        didRefresh.send()
    }

    /// Backspace at the very start of a block.
    func backspaceAtStart(block: String) {
        if isMultiBlock { replaceSelection(with: ""); return }
        perform { doc in
            try doc.select(anchorBlock: block, anchorOffset: 0, focusBlock: block, focusOffset: 0)
            try doc.backspace()
        }
        focusRequest = selection?.focus.block
        didRefresh.send()
    }

    /// Puts the caret at the end of a block, and asks for the keyboard there.
    public func focus(block id: String) {
        guard let block = blocks.first(where: { $0.id == id }) ?? Self.find(id, in: blocks) else { return }
        let end = block.text.utf16.count
        perform { try $0.select(anchorBlock: id, anchorOffset: end, focusBlock: id, focusOffset: end) }
        focusRequest = id
        didRefresh.send()
    }

    static func find(_ id: String, in blocks: [PliContentBlock]) -> PliContentBlock? {
        for block in blocks {
            if block.id == id { return block }
            for row in block.rows ?? [] { for cell in row.cells { if let found = find(id, in: cell.blocks) { return found } } }
        }
        return nil
    }
}

#if canImport(UIKit)
extension PliDocumentModel {
    /// Puts a picture in at the caret. It is scaled down so the document stays a size that can be saved, and shown at most 480 wide.
    public func insertPicture(_ image: UIImage, description: String? = nil) {
        let longest: CGFloat = 1600
        let scale = min(1, longest / max(image.size.width * image.scale, image.size.height * image.scale))
        let pixels = CGSize(width: max(1, (image.size.width * image.scale * scale).rounded()), height: max(1, (image.size.height * image.scale * scale).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let drawn = UIGraphicsImageRenderer(size: pixels, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: pixels)) }
        let hasAlpha = image.cgImage.map { [.first, .last, .premultipliedFirst, .premultipliedLast].contains($0.alphaInfo) } ?? false
        let data: Data?, type: String
        if hasAlpha { data = drawn.pngData(); type = "png" } else { data = drawn.jpegData(compressionQuality: 0.85); type = "jpeg" }
        guard let data else { return }
        let shown = min(pixels.width, 480)
        let height = (pixels.height * shown / pixels.width).rounded()
        let source = "data:image/\(type);base64," + data.base64EncodedString()
        perform { _ = try $0.insertImage(source: source, width: Int(shown), height: Int(height), description: description) }
        focusRequest = selection?.focus.block
        didRefresh.send()
    }
}
#endif

#if canImport(AppKit)
extension PliDocumentModel {
    /// Puts a picture in at the caret. It is scaled down so the document stays a size that can be saved, and shown at most 480 wide.
    public func insertPicture(_ image: NSImage, description: String? = nil) {
        guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
        let longest: CGFloat = 1600
        let scale = min(1, longest / CGFloat(max(source.width, source.height)))
        let width = max(1, Int((CGFloat(source.width) * scale).rounded())), height = max(1, Int((CGFloat(source.height) * scale).rounded()))
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else { return }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = graphics
        graphics.cgContext.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.restoreGraphicsState()
        let hasAlpha = [CGImageAlphaInfo.first, .last, .premultipliedFirst, .premultipliedLast].contains(source.alphaInfo)
        guard let data = bitmap.representation(using: hasAlpha ? .png : .jpeg, properties: hasAlpha ? [:] : [.compressionFactor: 0.85]) else { return }
        let shown = min(width, 480)
        let shownHeight = Int((Double(height) * Double(shown) / Double(width)).rounded())
        let uri = "data:image/\(hasAlpha ? "png" : "jpeg");base64," + data.base64EncodedString()
        perform { _ = try $0.insertImage(source: uri, width: shown, height: shownHeight, description: description) }
        focusRequest = selection?.focus.block
        didRefresh.send()
    }

    /// Asks which picture to put in, with the system open panel.
    public func choosePicture() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url, let image = NSImage(contentsOf: url) else { return }
            Task { @MainActor in self?.insertPicture(image, description: url.deletingPathExtension().lastPathComponent) }
        }
    }
}
#endif
