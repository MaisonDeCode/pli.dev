#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import Combine
import SwiftUI

// The blocks for a Mac: the same document as `PliBlocksScrollView` draws on iPhone, drawn with AppKit. Text blocks are NSTextViews that
// follow the document (what is typed is compared with the document's text and sent as one edit), and everything else (tables,
// pictures, wrapping, cropping, selecting across blocks) works as it does there.

// MARK: - Blocks on screen

@MainActor
final class PliMacContext {
    let model: PliDocumentModel
    var style: PliTextStyle
    var isEditable = true
    weak var scrollView: NSScrollView?
    let textViews = NSMapTable<NSString, PliMacTextView>(keyOptions: .strongMemory, valueOptions: .weakMemory)
    var isDragging = false

    enum Arrow { case left, right, up, down }

    init(model: PliDocumentModel, style: PliTextStyle) {
        self.model = model
        self.style = style
    }

    func scrollCaretIntoView(of textView: NSTextView) {
        guard textView.window != nil else { return }
        textView.scrollRangeToVisible(textView.selectedRange())
    }

    /// The place in the text block nearest to a point in the window.
    func hit(atWindow point: NSPoint) -> PliPoint? {
        var best: (view: PliMacTextView, distance: CGFloat)?
        let views = textViews.objectEnumerator()
        while let view = views?.nextObject() as? PliMacTextView {
            guard view.window != nil, !view.isHiddenOrHasHiddenAncestor else { continue }
            let frame = view.convert(view.bounds, to: nil)
            let dx = max(frame.minX - point.x, 0, point.x - frame.maxX)
            // Window coordinates grow upward.
            let dy = max(frame.minY - point.y, 0, point.y - frame.maxY)
            let distance = hypot(dx, dy)
            if best == nil || distance < best!.distance { best = (view, distance) }
        }
        guard let view = best?.view, let id = view.blockID else { return nil }
        let local = view.convert(point, from: nil)
        let length = (view.string as NSString).length
        if view.isFlipped ? local.y <= 0 : local.y >= view.bounds.height { return PliPoint(block: id, offset: 0) }
        if view.isFlipped ? local.y >= view.bounds.height : local.y <= 0 { return PliPoint(block: id, offset: length) }
        return PliPoint(block: id, offset: min(view.characterIndexForInsertion(at: local), length))
    }

    /// A place in another block, at the same distance from the left (for Up and Down).
    private func crossing(x: CGFloat, to id: String, atTop: Bool) -> PliPoint {
        guard let target = textViews.object(forKey: id as NSString) else { return PliPoint(block: id, offset: atTop ? 0 : model.length(of: id)) }
        let y = atTop ? target.textContainerInset.height + 2 : target.bounds.height - target.textContainerInset.height - 2
        return PliPoint(block: id, offset: min(target.characterIndexForInsertion(at: NSPoint(x: x, y: y)), (target.string as NSString).length))
    }

    private func lineBounds(of textView: NSTextView, at offset: Int) -> (first: Bool, last: Bool, x: CGFloat, rect: NSRect) {
        guard let layout = textView.layoutManager, let container = textView.textContainer else { return (true, true, 0, .zero) }
        let length = (textView.string as NSString).length
        let glyph = layout.glyphIndexForCharacter(at: min(offset, max(length - 1, 0)))
        let rect = length == 0 ? NSRect(x: 0, y: 0, width: 0, height: 16) : layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let used = layout.usedRect(for: container)
        let point = length == 0 ? NSPoint.zero : layout.location(forGlyphAt: glyph)
        let first = rect.minY <= used.minY + 1
        let last = rect.maxY >= used.maxY - 1 || offset >= length && length > 0 && layout.extraLineFragmentRect.isEmpty && rect.maxY >= used.maxY - 1
        return (first, last, rect.minX + point.x + textView.textContainerInset.width, rect)
    }

    /// Where a selection's focus goes when it moves one step: a character, or a line.
    private func moved(_ focus: PliPoint, _ arrow: Arrow) -> PliPoint? {
        let length = model.length(of: focus.block)
        switch arrow {
        case .left:
            if focus.offset > 0 { return PliPoint(block: focus.block, offset: focus.offset - 1) }
            return model.neighbor(of: focus.block, -1).map { PliPoint(block: $0.id, offset: $0.length) }
        case .right:
            if focus.offset < length { return PliPoint(block: focus.block, offset: focus.offset + 1) }
            return model.neighbor(of: focus.block, 1).map { PliPoint(block: $0.id, offset: 0) }
        case .up, .down:
            let up = arrow == .up
            guard let view = textViews.object(forKey: focus.block as NSString) else { return nil }
            let line = lineBounds(of: view, at: focus.offset)
            if up ? line.first : line.last {
                guard let next = model.neighbor(of: focus.block, up ? -1 : 1) else { return PliPoint(block: focus.block, offset: up ? 0 : length) }
                return crossing(x: line.x, to: next.id, atTop: !up)
            }
            let y = up ? line.rect.minY - 2 : line.rect.maxY + 2
            return PliPoint(block: focus.block, offset: min(view.characterIndexForInsertion(at: NSPoint(x: line.x, y: y + view.textContainerInset.height)), (view.string as NSString).length))
        }
    }

    private func isBefore(_ a: PliPoint, _ b: PliPoint) -> Bool {
        guard let i = model.indexOf(a.block), let j = model.indexOf(b.block) else { return true }
        return i != j ? i < j : a.offset <= b.offset
    }

    private func move(to point: PliPoint) {
        model.selectRange(anchor: point, focus: point)
        model.focusRequest = point.block
        model.didRefresh.send()
    }

    /// An arrow key in a text view. It is handled here when it takes the caret out of the block, or changes a selection that spans
    /// blocks; anything else is the text view's own business.
    func handle(_ arrow: Arrow, extend: Bool, in textView: PliMacTextView) -> Bool {
        guard let id = textView.blockID, !textView.hasMarkedText() else { return false }
        if let selection = model.selection, model.isMultiBlock {
            if extend {
                if let next = moved(selection.focus, arrow) { model.selectRange(anchor: selection.anchor, focus: next) }
            } else {
                let backward = arrow == .left || arrow == .up
                let first = isBefore(selection.anchor, selection.focus) ? selection.anchor : selection.focus
                let last = first == selection.anchor ? selection.focus : selection.anchor
                move(to: backward ? first : last)
            }
            return true
        }
        let range = textView.selectedRange()
        let length = (textView.string as NSString).length
        switch arrow {
        case .left:
            guard range.location == 0, extend || range.length == 0, let previous = model.neighbor(of: id, -1) else { return false }
            let end = PliPoint(block: previous.id, offset: previous.length)
            if extend { model.selectRange(anchor: PliPoint(block: id, offset: range.location + range.length), focus: end) } else { move(to: end) }
        case .right:
            guard range.location + range.length == length, extend || range.length == 0, let next = model.neighbor(of: id, 1) else { return false }
            let start = PliPoint(block: next.id, offset: 0)
            if extend { model.selectRange(anchor: PliPoint(block: id, offset: range.location), focus: start) } else { move(to: start) }
        case .up, .down:
            let up = arrow == .up
            let line = lineBounds(of: textView, at: up ? range.location : range.location + range.length)
            guard up ? line.first : line.last, extend || range.length == 0, let next = model.neighbor(of: id, up ? -1 : 1) else { return false }
            let target = crossing(x: line.x, to: next.id, atTop: !up)
            if extend {
                model.selectRange(anchor: PliPoint(block: id, offset: up ? range.location + range.length : range.location), focus: target)
            } else {
                move(to: target)
            }
        }
        return true
    }
}

@MainActor
protocol PliMacRow: NSView {
    var kind: String { get }
    func update(_ block: PliContentBlock, context: PliMacContext)
}

/// A column of blocks. The document is one; so is each cell of a table.
@MainActor
final class PliMacStack: NSStackView {
    private let context: PliMacContext
    private var rows: [String: PliMacRow] = [:]
    private let allowsWrap: Bool

    init(context: PliMacContext, allowsWrap: Bool = false) {
        self.context = context
        self.allowsWrap = allowsWrap
        super.init(frame: .zero)
        orientation = .vertical
        alignment = .leading
        // Blocks keep their own height and stay at the top when the cell is taller than they are (beside a taller cell, or room for a picture).
        distribution = .gravityAreas
        spacing = 4
        setHuggingPriority(.defaultLow, for: .horizontal)
        if #available(macOS 14, *) { clipsToBounds = false }
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private static func kind(of block: PliContentBlock) -> String {
        switch block.type {
        case "image": return "image"
        case "table": return "table"
        case "divider", "page_break", "section_break", "toc": return "marker"
        default: return "text"
        }
    }

    private func make(_ kind: String) -> PliMacRow {
        switch kind {
        case "image": return PliMacImageBlockView()
        case "table": return PliMacTableBlockView(context: context)
        case "marker": return PliMacMarkerBlockView()
        default: return PliMacTextBlockView()
        }
    }

    /// Text beside a picture that text wraps around runs along its side, and under it once the picture is passed.
    override func layout() {
        super.layout()
        guard allowsWrap else { return }
        var floats: [NSRect] = []
        var reach: CGFloat = 0
        var changed = false
        for row in arrangedSubviews {
            if let picture = row as? PliMacImageBlockView, let rect = picture.floatRect(in: self) {
                floats.append(rect.insetBy(dx: -PliMacImageBlockView.gap, dy: -6))
                reach = max(reach, rect.maxY + 6)
            } else if let text = row as? PliMacTextBlockView {
                changed = text.keepClear(of: floats.filter { $0.maxY > row.frame.minY }, in: self) || changed
            }
        }
        // A picture taller than the text beside it still has room below it: the last block that starts beside the picture is kept as tall
        // as the picture needs, so what follows starts under it.
        let last = arrangedSubviews.last(where: { $0 is PliMacTextBlockView && $0.frame.minY < reach })
        for row in arrangedSubviews {
            guard let text = row as? PliMacTextBlockView else { continue }
            changed = text.reserve(row === last ? reach - row.frame.minY : 0) || changed
        }
        // The text moves when its room changes, which moves the pictures after it: look again once this pass is done.
        if changed { DispatchQueue.main.async { [weak self] in self?.needsLayout = true } }
    }

    func update(_ blocks: [PliContentBlock]) {
        var next: [String: PliMacRow] = [:]
        var ordered: [PliMacRow] = []
        for block in blocks {
            let kind = Self.kind(of: block)
            let row: PliMacRow
            if let existing = rows[block.id], existing.kind == kind { row = existing } else { row = make(kind) }
            row.update(block, context: context)
            next[block.id] = row
            ordered.append(row)
        }
        for (id, row) in rows where next[id] !== row {
            removeArrangedSubview(row)
            row.removeFromSuperview()
        }
        rows = next
        for (index, row) in ordered.enumerated() where row.superview !== self {
            insertArrangedSubview(row, at: min(index, arrangedSubviews.count))
            row.translatesAutoresizingMaskIntoConstraints = false
            if !(row is PliMacImageBlockView && (row as! PliMacImageBlockView).isWrappedPicture) || true {
                row.widthAnchor.constraint(equalTo: widthAnchor, constant: -(edgeInsets.left + edgeInsets.right)).isActive = true
            }
        }
        if !arrangedSubviews.elementsEqual(ordered, by: { $0 === $1 }) {
            for view in arrangedSubviews { removeArrangedSubview(view) }
            for row in ordered { addArrangedSubview(row) }
        }
    }
}

// MARK: - Text

/// A text view that sizes itself to its text, and tells the context about arrow keys, Backspace at the start, and mouse drags that
/// leave the block.
final class PliMacTextView: NSTextView {
    var blockID: String?
    var programmatic = false
    var onArrow: ((PliMacContext.Arrow, Bool) -> Bool)?
    var onMouseDrag: ((NSEvent) -> Void)?
    var onMouseUp: (() -> Void)?
    var onMouseDown: ((NSEvent) -> Bool)?
    var onCopy: (() -> Void)?
    var onCut: (() -> Void)?
    var onPaste: (() -> Void)?

    override var intrinsicContentSize: NSSize {
        guard let layout = layoutManager, let container = textContainer else { return super.intrinsicContentSize }
        layout.ensureLayout(for: container)
        let used = layout.usedRect(for: container)
        return NSSize(width: NSView.noIntrinsicMetric, height: ceil(used.height + textContainerInset.height * 2))
    }

    override func layout() {
        super.layout()
        invalidateIntrinsicContentSize()
    }

    override func didChangeText() {
        super.didChangeText()
        invalidateIntrinsicContentSize()
    }

    /// The document has its own undo, and it is what the toolbar's Undo uses.
    override var undoManager: UndoManager? { nil }

    override func mouseDown(with event: NSEvent) {
        // A press and drag is followed here, so it can run on into other blocks, which a text view alone can't do.
        if event.clickCount == 1, let onMouseDown, onMouseDown(event) { return }
        super.mouseDown(with: event)
    }

    override func copy(_ sender: Any?) { if let onCopy { onCopy() } else { super.copy(sender) } }
    override func cut(_ sender: Any?) { if let onCut { onCut() } else { super.cut(sender) } }
    override func paste(_ sender: Any?) { if let onPaste { onPaste() } else { super.paste(sender) } }
}

@MainActor
final class PliMacTextBlockView: NSView, PliMacRow, NSTextViewDelegate {
    let kind = "text"
    private let textView = PliMacTextView(frame: .zero)
    private let marker = NSTextField(labelWithString: "")
    private let bar = NSView()
    private var indent: NSLayoutConstraint!
    private var markerWidth: NSLayoutConstraint!
    private var block: PliContentBlock?
    private var context: PliMacContext?
    private var clearAreas: [NSRect] = []
    private var reserved: NSLayoutConstraint?

    /// Keeps the block at least this tall (room for a picture that runs on past its text). Returns true when that changed.
    func reserve(_ height: CGFloat) -> Bool {
        let wanted = max(0, height.rounded())
        if wanted == (reserved?.constant ?? 0) { return false }
        reserved?.isActive = false
        reserved = nil
        if wanted > 0 {
            let constraint = heightAnchor.constraint(greaterThanOrEqualToConstant: wanted)
            constraint.priority = NSLayoutConstraint.Priority(900)
            constraint.isActive = true
            reserved = constraint
        }
        return true
    }

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        textView.delegate = self
        textView.drawsBackground = false
        textView.isRichText = true
        textView.allowsUndo = false
        textView.isVerticallyResizable = false
        textView.isHorizontallyResizable = false
        textView.textContainerInset = NSSize(width: 0, height: 3)
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.setContentHuggingPriority(.defaultLow, for: .horizontal)

        marker.alignment = .right
        marker.isSelectable = false
        bar.wantsLayer = true
        bar.layer?.backgroundColor = NSColor.secondaryLabelColor.withAlphaComponent(0.4).cgColor
        bar.isHidden = true

        for view in [bar, marker, textView] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
        indent = marker.leadingAnchor.constraint(equalTo: leadingAnchor)
        markerWidth = marker.widthAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: leadingAnchor),
            bar.topAnchor.constraint(equalTo: topAnchor, constant: 3),
            bar.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -3),
            bar.widthAnchor.constraint(equalToConstant: 3),
            indent, markerWidth,
            marker.topAnchor.constraint(equalTo: topAnchor, constant: 3),
            textView.leadingAnchor.constraint(equalTo: marker.trailingAnchor),
            textView.trailingAnchor.constraint(equalTo: trailingAnchor),
            textView.topAnchor.constraint(equalTo: topAnchor),
            textView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    /// Keeps the text away from the given areas (in the stack's coordinates): the text wraps around them. Returns true when that changed.
    func keepClear(of areas: [NSRect], in stack: NSView) -> Bool {
        let own = convert(bounds, to: stack)
        var local: [NSRect] = []
        for area in areas where area.intersects(own) {
            let inText = textView.convert(area, from: stack)
            local.append(inText.offsetBy(dx: -textView.textContainerInset.width, dy: -textView.textContainerInset.height).integral)
        }
        guard local != clearAreas else { return false }
        clearAreas = local
        textView.textContainer?.exclusionPaths = local.map { NSBezierPath(rect: $0) }
        textView.invalidateIntrinsicContentSize()
        return true
    }

    func update(_ block: PliContentBlock, context: PliMacContext) {
        self.block = block
        self.context = context
        context.textViews.setObject(textView, forKey: block.id as NSString)
        textView.blockID = block.id
        textView.onArrow = { [weak context, weak textView] arrow, extend in
            guard let context, let textView else { return false }
            return context.handle(arrow, extend: extend, in: textView)
        }
        textView.onCopy = { [weak context] in context?.model.copy() }
        textView.onCut = { [weak context] in context?.model.cut() }
        textView.onPaste = { [weak context] in context?.model.paste() }
        textView.onMouseDown = { [weak self] event in self?.track(event) ?? false }

        let isItem = block.type == "list_item"
        indent.constant = CGFloat(block.depth ?? 0) * 24 + (isItem ? CGFloat((block.format?.indentLeft ?? 0) * context.style.documentScale) : 0)
        markerWidth.constant = isItem ? 28 : 0
        marker.isHidden = !isItem
        if isItem {
            marker.font = PliRichText.font(for: nil, in: block, style: context.style)
            marker.textColor = context.style.secondaryColor
            marker.stringValue = (block.label ?? "") + " "
        }
        bar.isHidden = block.type != "quote"
        wantsLayer = true
        layer?.backgroundColor = block.type == "code_block" ? context.style.secondaryColor.withAlphaComponent(0.1).cgColor : nil
        textView.isEditable = context.isEditable
        textView.isSelectable = true

        let attributed = NSMutableAttributedString(attributedString: PliRichText.attributedString(for: block, style: context.style))
        // Text that a selection across blocks covers is tinted here; the one block that has the caret shows its own.
        if let covered = context.model.selectedRange(in: block.id), covered.length > 0, NSMaxRange(covered) <= attributed.length {
            attributed.addAttribute(.backgroundColor, value: NSColor.controlAccentColor.withAlphaComponent(0.3), range: covered)
        }
        textView.typingAttributes = PliRichText.typingAttributes(for: block, style: context.style)
        guard !textView.hasMarkedText() else { return }
        let same = textView.string == attributed.string
        if same && Self.sameLook(textView.attributedString(), attributed) { return }

        var range = textView.selectedRange()
        if !same, let selection = context.model.selection, selection.focus.block == block.id {
            let anchor = selection.anchor.block == block.id ? selection.anchor.offset : selection.focus.offset
            range = NSRange(location: min(anchor, selection.focus.offset), length: abs(selection.focus.offset - anchor))
        }
        textView.programmatic = true
        textView.textStorage?.setAttributedString(attributed)
        textView.typingAttributes = PliRichText.typingAttributes(for: block, style: context.style)
        let length = attributed.length
        let location = min(range.location, length)
        textView.setSelectedRange(NSRange(location: location, length: min(range.length, length - location)))
        textView.programmatic = false
        textView.invalidateIntrinsicContentSize()
    }

    /// Whether two attributed strings with the same text look the same, by the attributes Pli sets.
    static func sameLook(_ a: NSAttributedString, _ b: NSAttributedString) -> Bool {
        guard a.length == b.length else { return false }
        if b.length == 0 { return true }
        let keys: [NSAttributedString.Key] = [.font, .foregroundColor, .backgroundColor, .underlineStyle, .strikethroughStyle, .baselineOffset, .link, .paragraphStyle]
        var location = 0
        while location < b.length {
            // Both strings change their attributes in different places: compare at the start of every stretch of either.
            var rangeB = NSRange(location: 0, length: 0), rangeA = NSRange(location: 0, length: 0)
            let expected = b.attributes(at: location, effectiveRange: &rangeB)
            let actual = a.attributes(at: location, effectiveRange: &rangeA)
            for key in keys {
                let left = expected[key], right = actual[key]
                if left == nil && right == nil { continue }
                guard let left, let right else { return false }
                if key == .paragraphStyle {
                    guard let l = left as? NSParagraphStyle, let r = right as? NSParagraphStyle,
                          l.alignment == r.alignment, l.headIndent == r.headIndent, l.firstLineHeadIndent == r.firstLineHeadIndent,
                          l.tailIndent == r.tailIndent, l.lineHeightMultiple == r.lineHeightMultiple else { return false }
                } else if !(left as AnyObject).isEqual(right) { return false }
            }
            location = min(NSMaxRange(rangeA), NSMaxRange(rangeB))
        }
        return true
    }

    // MARK: Selecting by dragging

    /// A press in the text, followed until the mouse is let go, so a drag can run into other blocks. Returns false when the press
    /// should be left to the text view (a click on a link, a drag that starts a text drag).
    private func track(_ event: NSEvent) -> Bool {
        guard let context, context.isEditable, let window = textView.window, let start = context.hit(atWindow: event.locationInWindow) else { return false }
        context.isDragging = true
        window.makeFirstResponder(textView)
        context.model.selectRange(anchor: start, focus: start)
        let local = textView.convert(event.locationInWindow, from: nil)
        textView.setSelectedRange(NSRange(location: min(textView.characterIndexForInsertion(at: local), (textView.string as NSString).length), length: 0))
        let shift = event.modifierFlags.contains(.shift)
        let anchor = shift ? (context.model.selection?.anchor ?? start) : start
        if shift { context.model.selectRange(anchor: anchor, focus: start) }
        var last = start
        loop: while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            switch next.type {
            case .leftMouseDragged:
                // The scroll view follows the pointer past its edge.
                if let scroller = context.scrollView?.documentView { scroller.autoscroll(with: next) }
                if let focus = context.hit(atWindow: next.locationInWindow) {
                    last = focus
                    context.model.selectRange(anchor: anchor, focus: focus)
                    if anchor.block == focus.block, let view = context.textViews.object(forKey: anchor.block as NSString) {
                        view.programmatic = true
                        view.setSelectedRange(NSRange(location: min(anchor.offset, focus.offset), length: abs(focus.offset - anchor.offset)))
                        view.programmatic = false
                    }
                }
            default:
                break loop
            }
        }
        context.isDragging = false
        context.model.selectRange(anchor: anchor, focus: last)
        context.model.didRefresh.send()
        return true
    }

    // MARK: Typing

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        guard let block, let context, let view = textView as? PliMacTextView, !textView.hasMarkedText() else { return false }
        func arrow(_ direction: PliMacContext.Arrow, _ extend: Bool) -> Bool { context.handle(direction, extend: extend, in: view) }
        switch selector {
        case #selector(NSResponder.insertNewline(_:)):
            if context.model.isMultiBlock { context.model.replaceSelection(with: "\n"); return true }
            let range = textView.selectedRange()
            context.model.split(block: block.id, from: range.location, to: range.location + range.length)
            return true
        case #selector(NSResponder.deleteBackward(_:)):
            if context.model.isMultiBlock { context.model.replaceSelection(with: ""); return true }
            let range = textView.selectedRange()
            if range.location == 0 && range.length == 0 { context.model.backspaceAtStart(block: block.id); return true }
            return false
        case #selector(NSResponder.moveLeft(_:)): return arrow(.left, false)
        case #selector(NSResponder.moveRight(_:)): return arrow(.right, false)
        case #selector(NSResponder.moveUp(_:)): return arrow(.up, false)
        case #selector(NSResponder.moveDown(_:)): return arrow(.down, false)
        case #selector(NSResponder.moveLeftAndModifySelection(_:)): return arrow(.left, true)
        case #selector(NSResponder.moveRightAndModifySelection(_:)): return arrow(.right, true)
        case #selector(NSResponder.moveUpAndModifySelection(_:)): return arrow(.up, true)
        case #selector(NSResponder.moveDownAndModifySelection(_:)): return arrow(.down, true)
        default: return false
        }
    }

    func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString: String?) -> Bool {
        guard let context, !(textView as? PliMacTextView)!.programmatic else { return true }
        // With a selection across blocks, what is typed or deleted goes over all of it.
        if context.model.isMultiBlock, !textView.hasMarkedText() {
            context.model.replaceSelection(with: replacementString ?? "")
            return false
        }
        return true
    }

    func textDidChange(_ notification: Notification) {
        guard let textView = notification.object as? PliMacTextView, !textView.programmatic, !textView.hasMarkedText(), let block, let context else { return }
        // What changed is the stretch between the text the document has and the text on screen.
        let old = block.text as NSString
        let new = textView.string as NSString
        var prefix = 0
        let shortest = min(old.length, new.length)
        while prefix < shortest, old.character(at: prefix) == new.character(at: prefix) { prefix += 1 }
        if prefix > 0, prefix < new.length || prefix < old.length, (0xD800...0xDBFF).contains(new.character(at: prefix - 1)) { prefix -= 1 }
        var suffix = 0
        while suffix < shortest - prefix, old.character(at: old.length - 1 - suffix) == new.character(at: new.length - 1 - suffix) { suffix += 1 }
        if suffix > 0, (0xDC00...0xDFFF).contains(new.character(at: new.length - suffix)) { suffix -= 1 }
        guard old.length - suffix >= prefix, new.length - suffix >= prefix else { return }
        let inserted = new.substring(with: NSRange(location: prefix, length: new.length - suffix - prefix))
        if prefix == old.length - suffix && inserted.isEmpty { return }
        context.model.replace(block: block.id, from: prefix, to: old.length - suffix, with: inserted)
        context.scrollCaretIntoView(of: textView)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        guard let textView = notification.object as? PliMacTextView, !textView.programmatic, context?.isDragging != true,
              let block, let context, !textView.hasMarkedText(), textView.string == block.text else { return }
        let range = textView.selectedRange()
        context.model.place(block: block.id, from: range.location, to: range.location + range.length)
    }
}

// MARK: - Other blocks

@MainActor
final class PliMacMarkerBlockView: NSView, PliMacRow {
    let kind = "marker"
    private let line = NSBox()
    private let label = NSTextField(labelWithString: "")

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        line.boxType = .separator
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        label.alignment = .center
        label.drawsBackground = true
        label.backgroundColor = .textBackgroundColor
        for view in [line, label] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
        NSLayoutConstraint.activate([
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 24),
        ])
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func update(_ block: PliContentBlock, context: PliMacContext) {
        switch block.type {
        case "page_break": label.stringValue = "  Page break  "
        case "section_break": label.stringValue = "  Section break  "
        case "toc": label.stringValue = "  Table of contents  "
        default: label.stringValue = ""
        }
        label.isHidden = label.stringValue.isEmpty
    }
}

/// The picture inside its frame: bigger than the frame and shifted when it is cropped, so only what is kept shows.
final class PliMacCropClipView: NSView {
    let imageView = NSImageView()
    var crop = PliCrop.none { didSet { needsLayout = true } }

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = true
        imageView.imageScaling = .scaleAxesIndependently
        imageView.translatesAutoresizingMaskIntoConstraints = true
        addSubview(imageView)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        let across = max(1 - crop.left - crop.right, 0.05), down = max(1 - crop.top - crop.bottom, 0.05)
        let full = NSSize(width: bounds.width / across, height: bounds.height / down)
        imageView.frame = NSRect(x: -crop.left * full.width, y: -crop.top * full.height, width: full.width, height: full.height)
    }

    // The picture takes the click, not the image view inside it.
    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) && !isHidden ? self : nil }
}

/// A picture, with the same behaviour as on iPhone: click to select it, drag the dot on its corner to resize it; it can be cropped
/// (all of it shows, with a grip on each edge) and text can wrap around it.
@MainActor
final class PliMacImageBlockView: NSView, PliMacRow {
    static let gap: CGFloat = 14

    let kind = "image"
    private let clip = PliMacCropClipView()
    private let dim = CAShapeLayer()
    private let grip = NSView()
    private var edges: [NSView] = []
    private var source: String?
    private var block: PliContentBlock?
    private var context: PliMacContext?
    private var geometry: [NSLayoutConstraint] = []
    private var isCropping = false
    private(set) var isWrappedPicture = false
    private var lastBox = NSRect.zero
    private var startWidth: Double = 0
    private var startCrop = PliCrop.none
    private var resized = false

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        // A picture that text wraps around takes no height here, so it is drawn outside of this view.
        layer?.masksToBounds = false
        if #available(macOS 14, *) { clipsToBounds = false }
        clip.translatesAutoresizingMaskIntoConstraints = false
        clip.addGestureRecognizer(NSClickGestureRecognizer(target: self, action: #selector(clicked)))
        addSubview(clip)
        // Where the picture is decides where the text beside it stops. It is placed by constraints, after the stack has laid itself out,
        // so the stack is told when it has moved.
        clip.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: clip, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.isWrappedPicture, self.clip.frame != self.lastBox else { return }
                self.lastBox = self.clip.frame
                DispatchQueue.main.async { [weak self] in (self?.superview as? PliMacStack)?.needsLayout = true }
            }
        }

        dim.fillRule = .evenOdd
        dim.fillColor = NSColor.black.withAlphaComponent(0.5).cgColor
        clip.layer?.addSublayer(dim)

        grip.wantsLayer = true
        grip.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
        grip.layer?.cornerRadius = 7
        grip.layer?.borderWidth = 2
        grip.layer?.borderColor = NSColor.textBackgroundColor.cgColor
        grip.addGestureRecognizer(NSPanGestureRecognizer(target: self, action: #selector(dragged(_:))))
        grip.isHidden = true
        addSubview(grip)

        for index in 0..<4 {
            let edge = NSView()
            edge.wantsLayer = true
            edge.layer?.backgroundColor = NSColor.white.cgColor
            edge.layer?.cornerRadius = 2
            edge.layer?.borderWidth = 1
            edge.layer?.borderColor = NSColor.controlAccentColor.cgColor
            edge.identifier = NSUserInterfaceItemIdentifier("\(index)")
            edge.addGestureRecognizer(NSPanGestureRecognizer(target: self, action: #selector(edgeDragged(_:))))
            edge.isHidden = true
            addSubview(edge)
            edges.append(edge)
        }
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func floatRect(in stack: NSView) -> NSRect? {
        guard isWrappedPicture else { return nil }
        return clip.convert(clip.bounds, to: stack)
    }

    func update(_ block: PliContentBlock, context: PliMacContext) {
        self.block = block
        self.context = context
        let crop = block.crop ?? .none
        let across = max(1 - crop.left - crop.right, 0.05), down = max(1 - crop.top - crop.bottom, 0.05)
        let selected = context.isEditable && context.model.format.image?.id == block.id
        isCropping = selected && context.model.croppingPicture == block.id
        isWrappedPicture = block.wrap != nil && context.model.wrapsPictures
        let w = max((block.width ?? 200) / (isCropping ? across : 1), 1), h = max((block.height ?? 150) / (isCropping ? down : 1), 1)

        NSLayoutConstraint.deactivate(geometry)
        let right = isWrappedPicture && block.wrap == "right"
        let width = clip.widthAnchor.constraint(equalToConstant: CGFloat(w))
        width.priority = NSLayoutConstraint.Priority(999)
        var next = [
            width,
            clip.heightAnchor.constraint(equalTo: clip.widthAnchor, multiplier: CGFloat(h / w)),
            clip.topAnchor.constraint(equalTo: topAnchor, constant: 4),
        ]
        if isWrappedPicture {
            next.append(heightAnchor.constraint(equalToConstant: 0))
            next.append(right ? clip.trailingAnchor.constraint(equalTo: trailingAnchor) : clip.leadingAnchor.constraint(equalTo: leadingAnchor))
            next.append(right ? clip.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor) : clip.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor))
        } else {
            next.append(clip.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4))
            next.append(clip.leadingAnchor.constraint(equalTo: leadingAnchor))
            next.append(clip.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor))
        }
        NSLayoutConstraint.activate(next)
        geometry = next

        clip.crop = isCropping ? .none : crop
        clip.layer?.borderWidth = selected && !isCropping ? 2 : 0
        clip.layer?.borderColor = NSColor.controlAccentColor.cgColor
        grip.isHidden = !selected || isCropping
        for edge in edges { edge.isHidden = !isCropping }
        needsLayout = true

        guard block.src != source else { return }
        source = block.src
        clip.imageView.image = nil
        guard let src = block.src else { return }
        if src.hasPrefix("data:"), let comma = src.firstIndex(of: ","), let data = Data(base64Encoded: String(src[src.index(after: comma)...])) {
            clip.imageView.image = NSImage(data: data)
        } else if let url = URL(string: src), url.scheme == "http" || url.scheme == "https" {
            URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                guard let data, let image = NSImage(data: data) else { return }
                DispatchQueue.main.async { if self?.source == src { self?.clip.imageView.image = image } }
            }.resume()
        }
    }

    override func layout() {
        super.layout()
        let box = clip.frame
        if isWrappedPicture, box != lastBox {
            lastBox = box
            DispatchQueue.main.async { [weak self] in (self?.superview as? PliMacStack)?.needsLayout = true }
        }
        grip.frame = NSRect(x: box.maxX - 7, y: box.maxY - 7, width: 14, height: 14)
        guard isCropping, let block else {
            dim.path = nil
            return
        }
        let crop = block.crop ?? .none
        let kept = NSRect(x: crop.left * box.width, y: crop.top * box.height, width: (1 - crop.left - crop.right) * box.width, height: (1 - crop.top - crop.bottom) * box.height)
        // The dim layer is in a flipped view; its path is built with the same origin.
        let path = CGMutablePath()
        path.addRect(clip.bounds)
        path.addRect(kept)
        dim.frame = clip.bounds
        dim.path = path
        let k = kept.offsetBy(dx: box.minX, dy: box.minY)
        let centres = [CGPoint(x: k.minX, y: k.midY), CGPoint(x: k.midX, y: k.minY), CGPoint(x: k.maxX, y: k.midY), CGPoint(x: k.midX, y: k.maxY)]
        for (index, edge) in edges.enumerated() {
            let size = index % 2 == 0 ? CGSize(width: 8, height: 28) : CGSize(width: 28, height: 8)
            edge.frame = NSRect(x: centres[index].x - size.width / 2, y: centres[index].y - size.height / 2, width: size.width, height: size.height)
        }
    }

    @objc private func clicked() {
        guard let block, let context, context.isEditable else { return }
        context.model.selectPicture(block.id)
        window?.makeFirstResponder(nil)
    }

    @objc private func dragged(_ gesture: NSPanGestureRecognizer) {
        guard let block, let context else { return }
        switch gesture.state {
        case .began:
            startWidth = max(Double(clip.bounds.width), 1)
            resized = false
        case .changed:
            let next = max(32, startWidth + Double(gesture.translation(in: self).x) * (block.wrap == "right" ? -1 : 1))
            let ratio = max(block.height ?? 150, 1) / max(block.width ?? 200, 1)
            context.model.setImageSize(block.id, width: Int(next.rounded()), height: Int((next * ratio).rounded()), merge: resized)
            resized = true
        default:
            break
        }
    }

    @objc private func edgeDragged(_ gesture: NSPanGestureRecognizer) {
        guard let block, let context, let edge = gesture.view, let tag = Int(edge.identifier?.rawValue ?? "") else { return }
        switch gesture.state {
        case .began:
            startCrop = block.crop ?? .none
            resized = false
        case .changed:
            let t = gesture.translation(in: self)
            let dx = Double(t.x / max(clip.bounds.width, 1)), dy = Double(t.y / max(clip.bounds.height, 1))
            var next = startCrop
            switch tag {
            case 0: next.left = min(max(startCrop.left + dx, 0), 0.9 - startCrop.right)
            case 1: next.top = min(max(startCrop.top + dy, 0), 0.9 - startCrop.bottom)
            case 2: next.right = min(max(startCrop.right - dx, 0), 0.9 - startCrop.left)
            default: next.bottom = min(max(startCrop.bottom - dy, 0), 0.9 - startCrop.top)
            }
            context.model.setImageCrop(block.id, next, merge: resized)
            resized = true
        default:
            break
        }
    }
}

/// A table: a grid of cells, each with blocks of its own that can be edited. While the caret is in it, the edges between columns and
/// the bottom of each row have grips to drag.
@MainActor
final class PliMacTableBlockView: NSView, PliMacRow {
    let kind = "table"
    private let context: PliMacContext
    private let grid = NSStackView()
    private var signature = ""
    private var cells: [String: PliMacStack] = [:]
    private var containers: [String: NSView] = [:]
    private var placed: [(constraint: NSLayoutConstraint, line: NSStackView, container: NSView, column: Int, span: Int)] = []
    private var columns: [Double] = []
    private var heights: [Double?] = []
    private var rowHeights: [NSLayoutConstraint?] = []
    private var tableID = ""
    private var handles: [NSView] = []
    private var rowHandles: [NSView] = []
    private var draggedFirst = true

    override var isFlipped: Bool { true }

    init(context: PliMacContext) {
        self.context = context
        super.init(frame: .zero)
        grid.orientation = .vertical
        grid.alignment = .leading
        grid.spacing = 0
        grid.translatesAutoresizingMaskIntoConstraints = false
        addSubview(grid)
        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: trailingAnchor),
            grid.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            grid.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
        ])
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    private var total: Double { columns.isEmpty ? 1 : max(columns.reduce(0, +), 0.0001) }

    private func weight(_ column: Int, _ span: Int) -> Double {
        columns.isEmpty ? Double(span) : columns[min(column, columns.count - 1)..<min(column + span, columns.count)].reduce(0, +)
    }

    func update(_ block: PliContentBlock, context: PliMacContext) {
        let rows = block.rows ?? []
        tableID = block.id
        let next = rows.map { row in row.id + ":" + row.cells.map { "\($0.id)/\($0.colSpan ?? 1)/\($0.covered == true ? 1 : 0)" }.joined(separator: ",") }.joined(separator: ";") + "|\(block.columns?.count ?? 0)"
        let widthsChanged = (block.columns ?? []) != columns
        columns = block.columns ?? []
        heights = rows.map { $0.height }
        if next != signature {
            signature = next
            rebuild(rows: rows)
            rebuildHandles()
        } else if widthsChanged {
            applyWidths()
        }
        applyHeights()
        for (rowIndex, row) in rows.enumerated() {
            for cell in row.cells {
                cells[cell.id]?.update(cell.blocks)
                if let container = containers[cell.id] {
                    let shade = cell.shade.flatMap { PliPlatformColor.pli(hex: $0) } ?? (rowIndex == 0 && block.headerRow == true ? NSColor.controlBackgroundColor : nil)
                    container.layer?.backgroundColor = shade?.cgColor
                }
            }
        }
        let editing = context.model.format.table?.id == block.id && context.isEditable
        for handle in handles + rowHandles { handle.isHidden = !editing }
        needsLayout = true
    }

    private func applyWidths() {
        for index in placed.indices {
            let item = placed[index]
            item.constraint.isActive = false
            let next = item.container.widthAnchor.constraint(equalTo: item.line.widthAnchor, multiplier: CGFloat(max(weight(item.column, item.span) / total, 0.0001)))
            next.isActive = true
            placed[index].constraint = next
        }
    }

    private func applyHeights() {
        let scale = CGFloat(context.style.documentScale)
        for (index, constraint) in rowHeights.enumerated() {
            constraint?.isActive = false
            rowHeights[index] = nil
            guard index < grid.arrangedSubviews.count, index < heights.count, let points = heights[index] else { continue }
            let next = grid.arrangedSubviews[index].heightAnchor.constraint(greaterThanOrEqualToConstant: CGFloat(points) * scale)
            next.priority = NSLayoutConstraint.Priority(750)
            next.isActive = true
            rowHeights[index] = next
        }
    }

    private func rebuild(rows: [PliTableRow]) {
        for view in grid.arrangedSubviews { grid.removeArrangedSubview(view); view.removeFromSuperview() }
        cells = [:]
        containers = [:]
        placed = []
        rowHeights = Array(repeating: nil, count: rows.count)
        for row in rows {
            let line = NSStackView()
            line.orientation = .horizontal
            line.alignment = .top
            line.distribution = .fill
            line.spacing = 0
            line.translatesAutoresizingMaskIntoConstraints = false
            var column = 0
            var skip = 0
            var pending: [(NSView, Int, Int)] = []
            for cell in row.cells {
                defer { column += 1 }
                if skip > 0 { skip -= 1; continue }
                let span = max(cell.colSpan ?? 1, 1)
                skip = span - 1
                let container = NSView()
                container.wantsLayer = true
                container.translatesAutoresizingMaskIntoConstraints = false
                if cell.covered != true {
                    container.layer?.borderWidth = 0.5
                    container.layer?.borderColor = NSColor.separatorColor.cgColor
                    let stack = PliMacStack(context: context, allowsWrap: true)
                    stack.translatesAutoresizingMaskIntoConstraints = false
                    container.addSubview(stack)
                    NSLayoutConstraint.activate([
                        stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 6),
                        stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -6),
                        stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 4),
                        stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -4),
                    ])
                    cells[cell.id] = stack
                    containers[cell.id] = container
                }
                line.addArrangedSubview(container)
                container.heightAnchor.constraint(equalTo: line.heightAnchor).isActive = true
                pending.append((container, column, span))
            }
            grid.addArrangedSubview(line)
            line.widthAnchor.constraint(equalTo: grid.widthAnchor).isActive = true
            for (container, col, span) in pending {
                let constraint = container.widthAnchor.constraint(equalTo: line.widthAnchor, multiplier: CGFloat(max(weight(col, span) / total, 0.0001)))
                constraint.isActive = true
                placed.append((constraint, line, container, col, span))
            }
        }
    }

    // MARK: Dragging the edges between columns, and the bottoms of rows

    private func makeHandle(vertical: Bool, action: Selector, label: String) -> NSView {
        let handle = NSView()
        let grip = NSView(frame: vertical ? NSRect(x: 12, y: 0, width: 4, height: 28) : NSRect(x: 0, y: 12, width: 28, height: 4))
        grip.wantsLayer = true
        grip.layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.55).cgColor
        grip.layer?.cornerRadius = 2
        grip.autoresizingMask = vertical ? [.minYMargin, .maxYMargin] : [.minXMargin, .maxXMargin]
        handle.addSubview(grip)
        handle.addGestureRecognizer(NSPanGestureRecognizer(target: self, action: action))
        handle.setAccessibilityLabel(label)
        addSubview(handle)
        return handle
    }

    private func rebuildHandles() {
        handles.forEach { $0.removeFromSuperview() }
        rowHandles.forEach { $0.removeFromSuperview() }
        handles = (0..<max(columns.count - 1, 0)).map { _ in makeHandle(vertical: true, action: #selector(columnDragged(_:)), label: "Column edge") }
        rowHandles = (0..<rowHeights.count).map { _ in makeHandle(vertical: false, action: #selector(rowDragged(_:)), label: "Row edge") }
    }

    override func layout() {
        super.layout()
        var before = 0.0
        for (index, handle) in handles.enumerated() {
            before += columns[index]
            let x = grid.frame.minX + grid.frame.width * CGFloat(before / total)
            handle.frame = NSRect(x: x - 14, y: grid.frame.minY, width: 28, height: grid.frame.height)
            if let grip = handle.subviews.first { grip.frame.origin.y = (handle.bounds.height - 28) / 2 }
        }
        for (index, handle) in rowHandles.enumerated() where index < grid.arrangedSubviews.count {
            let line = grid.arrangedSubviews[index]
            handle.frame = NSRect(x: grid.frame.minX + 6, y: grid.frame.minY + line.frame.maxY - 14, width: 28, height: 28)
        }
    }

    @objc private func columnDragged(_ gesture: NSPanGestureRecognizer) {
        guard let handle = gesture.view, let index = handles.firstIndex(of: handle) else { return }
        switch gesture.state {
        case .began: draggedFirst = true
        case .changed:
            let x = gesture.location(in: grid).x
            context.model.moveColumnEdge(table: tableID, column: index, position: Double(x / max(grid.bounds.width, 1)), merge: !draggedFirst)
            draggedFirst = false
        default: break
        }
    }

    @objc private func rowDragged(_ gesture: NSPanGestureRecognizer) {
        guard let handle = gesture.view, let index = rowHandles.firstIndex(of: handle), index < grid.arrangedSubviews.count else { return }
        switch gesture.state {
        case .began: draggedFirst = true
        case .changed:
            let line = grid.arrangedSubviews[index]
            let y = gesture.location(in: grid).y
            let points = max(16, Double((y - line.frame.minY) / CGFloat(context.style.documentScale)))
            context.model.setRowHeight(table: tableID, row: index, points: points.rounded(), merge: !draggedFirst)
            draggedFirst = false
        default: break
        }
    }
}

// MARK: - The document

/// A flipped view that holds the blocks, so they start at the top.
private final class PliMacDocumentView: NSView {
    override var isFlipped: Bool { true }
}

/// The document as a scrolling column of editable blocks, in AppKit. Put it in your own view controller, or use `PliBlocksView` in SwiftUI.
///
/// Every block is drawn from the document, and every edit goes through the model, so the toolbar, your own buttons and the typing all
/// change the same document.
@MainActor
public final class PliBlocksScrollView: NSScrollView {
    public let model: PliDocumentModel
    private let context: PliMacContext
    private let stack: PliMacStack
    private var bag = Set<AnyCancellable>()

    /// Whether the text can be changed.
    public var isEditable: Bool {
        get { context.isEditable }
        set { context.isEditable = newValue; apply() }
    }

    public init(model: PliDocumentModel, style: PliTextStyle = PliTextStyle()) {
        self.model = model
        context = PliMacContext(model: model, style: style)
        stack = PliMacStack(context: context, allowsWrap: true)
        super.init(frame: .zero)
        context.scrollView = self
        hasVerticalScroller = true
        drawsBackground = true
        backgroundColor = .textBackgroundColor

        let document = PliMacDocumentView()
        document.translatesAutoresizingMaskIntoConstraints = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.spacing = 6
        document.addSubview(stack)
        documentView = document
        NSLayoutConstraint.activate([
            document.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            document.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            document.topAnchor.constraint(equalTo: contentView.topAnchor),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -96),
        ])

        model.didRefresh.sink { [weak self] in self?.apply() }.store(in: &bag)
        apply()
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    private func apply() {
        stack.update(model.blocks)
        if let id = model.focusRequest {
            model.focusRequest = nil
            layoutSubtreeIfNeeded()
            if let textView = context.textViews.object(forKey: id as NSString) {
                window?.makeFirstResponder(textView)
                if let selection = model.selection, selection.focus.block == id {
                    let length = (textView.string as NSString).length
                    let from = min(selection.anchor.block == id ? selection.anchor.offset : selection.focus.offset, length)
                    let to = min(selection.focus.offset, length)
                    textView.programmatic = true
                    textView.setSelectedRange(NSRange(location: min(from, to), length: abs(to - from)))
                    textView.programmatic = false
                }
                context.scrollCaretIntoView(of: textView)
            }
        }
        // With a selection across blocks, the keyboard stays at its end, so typing and Delete go over the whole selection.
        if model.isMultiBlock, !context.isDragging, let focus = model.selection?.focus, let view = context.textViews.object(forKey: focus.block as NSString) {
            view.programmatic = true
            if window?.firstResponder !== view { window?.makeFirstResponder(view) }
            let offset = min(focus.offset, (view.string as NSString).length)
            if view.selectedRange() != NSRange(location: offset, length: 0) { view.setSelectedRange(NSRange(location: offset, length: 0)) }
            view.programmatic = false
        }
    }

    public override func mouseDown(with event: NSEvent) {
        // A click below the last block puts the caret at the end of the document.
        if isEditable, let document = documentView {
            let point = document.convert(event.locationInWindow, from: nil)
            let bottom = stack.arrangedSubviews.map { document.convert($0.bounds, from: $0).maxY }.max() ?? 0
            if point.y > bottom, let last = model.blocks.last(where: \.isText) {
                model.focus(block: last.id)
                return
            }
        }
        super.mouseDown(with: event)
    }
}

/// The document as a scrolling column of editable blocks, in SwiftUI.
public struct PliBlocksView: NSViewRepresentable {
    private let model: PliDocumentModel
    private let style: PliTextStyle
    private let isEditable: Bool

    public init(_ model: PliDocumentModel, style: PliTextStyle = PliTextStyle(), isEditable: Bool = true) {
        self.model = model
        self.style = style
        self.isEditable = isEditable
    }

    public func makeNSView(context: Context) -> PliBlocksScrollView {
        let view = PliBlocksScrollView(model: model, style: style)
        view.isEditable = isEditable
        return view
    }

    public func updateNSView(_ view: PliBlocksScrollView, context: Context) {
        if view.isEditable != isEditable { view.isEditable = isEditable }
    }
}
#endif
