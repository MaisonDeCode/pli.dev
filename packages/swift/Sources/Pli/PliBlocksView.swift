#if canImport(UIKit)
import Combine
import SwiftUI
import UIKit

// MARK: - Blocks on screen

/// What every block on screen shares: the model that changes the document, how text looks, and where the text views are.
@MainActor
final class PliBlockContext {
    let model: PliDocumentModel
    var style: PliTextStyle
    var isEditable = true
    weak var scrollView: UIScrollView?
    /// The text views by block id, so the one that should take the keyboard can be found.
    let textViews = NSMapTable<NSString, PliTextView>(keyOptions: .strongMemory, valueOptions: .weakMemory)

    /// True while a finger is dragging out a selection that may cross blocks.
    var isDragging = false

    enum Arrow { case left, right, up, down }

    init(model: PliDocumentModel, style: PliTextStyle) {
        self.model = model
        self.style = style
    }

    /// Scrolls so the caret of a text view isn't under the keyboard or the edge.
    func scrollCaretIntoView(of textView: UITextView) {
        guard let scrollView, let range = textView.selectedTextRange else { return }
        let caret = textView.convert(textView.caretRect(for: range.end), to: scrollView)
        scrollView.scrollRectToVisible(caret.insetBy(dx: 0, dy: -28), animated: false)
    }

    // MARK: Moving and selecting across blocks

    /// The place in a block's text nearest to a point in the scroll view.
    func point(in textView: PliTextView, at location: CGPoint) -> PliPoint? {
        guard let id = textView.blockID, let scrollView else { return nil }
        let local = textView.convert(location, from: scrollView)
        let frame = textView.bounds
        let length = (textView.text as NSString).length
        if local.y <= frame.minY { return PliPoint(block: id, offset: 0) }
        if local.y >= frame.maxY { return PliPoint(block: id, offset: length) }
        guard let position = textView.closestPosition(to: local) else { return nil }
        return PliPoint(block: id, offset: textView.offset(from: textView.beginningOfDocument, to: position))
    }

    /// The text block under (or nearest to) a point in the scroll view, and the place in it.
    func hit(at location: CGPoint) -> PliPoint? {
        guard let scrollView else { return nil }
        var best: (view: PliTextView, distance: CGFloat)?
        let views = textViews.objectEnumerator()
        while let view = views?.nextObject() as? PliTextView {
            guard view.window != nil else { continue }
            let frame = view.convert(view.bounds, to: scrollView)
            // Cells side by side share a row: the nearest one is the one to take, across as well as down.
            let dx = max(frame.minX - location.x, 0, location.x - frame.maxX)
            let dy = max(frame.minY - location.y, 0, location.y - frame.maxY)
            let distance = hypot(dx, dy)
            if best == nil || distance < best!.distance { best = (view, distance) }
        }
        return best.flatMap { point(in: $0.view, at: location) }
    }

    /// A place in another block, at the same distance from the left (for Up and Down).
    private func crossing(from source: PliTextView, caret: CGRect, to id: String, atTop: Bool) -> PliPoint? {
        guard let target = textViews.object(forKey: id as NSString), let scrollView else { return PliPoint(block: id, offset: atTop ? 0 : model.length(of: id)) }
        let x = source.convert(CGPoint(x: caret.midX, y: 0), to: scrollView).x
        let local = target.convert(CGPoint(x: x, y: 0), from: scrollView).x
        let y = atTop ? target.textContainerInset.top + 2 : target.bounds.height - target.textContainerInset.bottom - 2
        guard let position = target.closestPosition(to: CGPoint(x: local, y: y)) else { return nil }
        return PliPoint(block: id, offset: target.offset(from: target.beginningOfDocument, to: position))
    }

    private func isFirstLine(_ textView: UITextView, _ position: UITextPosition) -> Bool {
        abs(textView.caretRect(for: position).minY - textView.caretRect(for: textView.beginningOfDocument).minY) < 2
    }

    private func isLastLine(_ textView: UITextView, _ position: UITextPosition) -> Bool {
        abs(textView.caretRect(for: position).minY - textView.caretRect(for: textView.endOfDocument).minY) < 2
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
            guard let view = textViews.object(forKey: focus.block as NSString),
                  let position = view.position(from: view.beginningOfDocument, offset: min(focus.offset, (view.text as NSString).length)) else { return nil }
            let caret = view.caretRect(for: position)
            if up ? isFirstLine(view, position) : isLastLine(view, position) {
                guard let next = model.neighbor(of: focus.block, up ? -1 : 1) else { return PliPoint(block: focus.block, offset: up ? 0 : length) }
                return crossing(from: view, caret: caret, to: next.id, atTop: !up)
            }
            let target = CGPoint(x: caret.midX, y: up ? caret.minY - caret.height / 2 : caret.maxY + caret.height / 2)
            guard let found = view.closestPosition(to: target) else { return nil }
            return PliPoint(block: focus.block, offset: view.offset(from: view.beginningOfDocument, to: found))
        }
    }

    /// An arrow key in a text view. It is handled here when it takes the caret out of the block, or changes a selection that spans blocks;
    /// anything else is the text view's own business.
    func handle(_ arrow: Arrow, extend: Bool, in textView: PliTextView) -> Bool {
        guard let id = textView.blockID, textView.markedTextRange == nil else { return false }
        if let selection = model.selection, model.isMultiBlock {
            if extend {
                if let next = moved(selection.focus, arrow) { model.selectRange(anchor: selection.anchor, focus: next) }
            } else {
                // A plain arrow ends the selection at its near or far edge, as it does in one block.
                let backward = arrow == .left || arrow == .up
                let first = isBefore(selection.anchor, selection.focus) ? selection.anchor : selection.focus
                let last = first == selection.anchor ? selection.focus : selection.anchor
                let edge = backward ? first : last
                model.selectRange(anchor: edge, focus: edge)
                model.focusRequest = edge.block
                model.didRefresh.send()
            }
            return true
        }
        let range = textView.selectedRange
        let length = (textView.text as NSString).length
        let caretPosition: UITextPosition? = textView.position(from: textView.beginningOfDocument, offset: arrow == .left || arrow == .up ? range.location : range.location + range.length)
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
            guard let position = caretPosition, up ? isFirstLine(textView, position) : isLastLine(textView, position),
                  extend || range.length == 0, let next = model.neighbor(of: id, up ? -1 : 1),
                  let target = crossing(from: textView, caret: textView.caretRect(for: position), to: next.id, atTop: !up) else { return false }
            if extend {
                model.selectRange(anchor: PliPoint(block: id, offset: up ? range.location + range.length : range.location), focus: target)
            } else {
                move(to: target)
            }
        }
        return true
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
}

@MainActor
protocol PliBlockRow: UIView {
    /// What kind of view this is, so a block that changes type gets a new one.
    var kind: String { get }
    func update(_ block: PliContentBlock, context: PliBlockContext)
}

/// A column of blocks. The document is one; so is each cell of a table.
@MainActor
final class PliBlockStack: UIStackView {
    private let context: PliBlockContext
    private var rows: [String: PliBlockRow] = [:]
    /// Whether text can wrap around a picture here. In a table cell a picture stays on a line of its own.
    private let allowsWrap: Bool

    init(context: PliBlockContext, allowsWrap: Bool = false) {
        self.context = context
        self.allowsWrap = allowsWrap
        super.init(frame: .zero)
        axis = .vertical
        alignment = .fill
        spacing = 4
        // When the column is taller than its blocks (a table cell beside a taller cell, or room left for a picture), the space goes here,
        // not into the last block, so the blocks stay at the top.
        spacer.setContentHuggingPriority(UILayoutPriority(1), for: .vertical)
        spacer.setContentCompressionResistancePriority(UILayoutPriority(1), for: .vertical)
        spacer.isUserInteractionEnabled = false
        addArrangedSubview(spacer)
    }

    private let spacer = UIView()

    @available(*, unavailable) required init(coder: NSCoder) { fatalError() }

    private static func kind(of block: PliContentBlock) -> String {
        switch block.type {
        case "image": return "image"
        case "table": return "table"
        case "divider", "page_break", "section_break", "toc": return "marker"
        default: return "text"
        }
    }

    private func make(_ kind: String) -> PliBlockRow {
        switch kind {
        case "image": return PliImageBlockView()
        case "table": return PliTableBlockView(context: context)
        case "marker": return PliMarkerBlockView()
        default: return PliTextBlockView()
        }
    }

    /// Text beside a picture that text wraps around runs along its side, and under it once the picture is passed: each text view the
    /// picture overlaps gets the picture's place as an area to keep clear of.
    override func layoutSubviews() {
        super.layoutSubviews()
        guard allowsWrap else { return }
        var floats: [CGRect] = []
        var reach: CGFloat = 0
        var changed = false
        for row in arrangedSubviews where row !== spacer {
            if let picture = row as? PliImageBlockView, let rect = picture.floatRect(in: self) {
                floats.append(rect.insetBy(dx: -PliImageBlockView.gap, dy: -6))
                reach = max(reach, rect.maxY + 6)
                bringSubviewToFront(picture)
            } else if let text = row as? PliTextBlockView {
                changed = text.keepClear(of: floats.filter { $0.maxY > row.frame.minY }, in: self) || changed
            }
        }
        // A picture taller than the text beside it still has room below it: the last block that starts beside the picture is kept as tall
        // as the picture needs, so what follows starts under it.
        let last = arrangedSubviews.last(where: { $0 is PliTextBlockView && $0.frame.minY < reach })
        for row in arrangedSubviews {
            guard let text = row as? PliTextBlockView else { continue }
            changed = text.reserve(row === last ? reach - row.frame.minY : 0) || changed
        }
        if changed { setNeedsLayout() }
    }

    func update(_ blocks: [PliContentBlock]) {
        var next: [String: PliBlockRow] = [:]
        var ordered: [PliBlockRow] = []
        for block in blocks {
            let kind = Self.kind(of: block)
            let row: PliBlockRow
            if let existing = rows[block.id], existing.kind == kind { row = existing } else { row = make(kind) }
            row.update(block, context: context)
            next[block.id] = row
            ordered.append(row)
        }
        for (id, row) in rows where next[id] !== row { row.removeFromSuperview() }
        rows = next
        // Blocks only come and go; they don't swap places, so new views go in at their index and the ones that stay keep the keyboard.
        for (index, row) in ordered.enumerated() where row.superview !== self {
            insertArrangedSubview(row, at: min(index, arrangedSubviews.count - 1))
        }
        if !arrangedSubviews.dropLast().elementsEqual(ordered, by: { $0 === $1 }) {
            for view in arrangedSubviews { removeArrangedSubview(view) }
            for row in ordered { addArrangedSubview(row) }
            addArrangedSubview(spacer)
        }
        for row in ordered { setCustomSpacing(UIStackView.spacingUseDefault, after: row) }
        if let last = ordered.last { setCustomSpacing(0, after: last) }
    }
}

// MARK: - Text

/// A text view that tells the model about Backspace at the very start of a block, which UIKit doesn't report.
final class PliTextView: UITextView {
    var onBackspaceAtStart: (() -> Void)?
    /// The block this shows.
    var blockID: String?
    /// Set while the app, not the person, is changing the text or the caret, so the change isn't taken for an edit.
    var programmatic = false
    /// Arrow keys on a hardware keyboard; returns true when it dealt with the key.
    var onArrow: ((PliBlockContext.Arrow, Bool) -> Bool)?

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        for press in presses {
            guard let key = press.key else { continue }
            let extend = key.modifierFlags.contains(.shift)
            let arrow: PliBlockContext.Arrow?
            switch key.keyCode {
            case .keyboardLeftArrow: arrow = .left
            case .keyboardRightArrow: arrow = .right
            case .keyboardUpArrow: arrow = .up
            case .keyboardDownArrow: arrow = .down
            default: arrow = nil
            }
            if let arrow, let onArrow, onArrow(arrow, extend) { return }
        }
        super.pressesBegan(presses, with: event)
    }

    override func deleteBackward() {
        if selectedRange.location == 0, selectedRange.length == 0, markedTextRange == nil, let onBackspaceAtStart {
            onBackspaceAtStart()
            return
        }
        super.deleteBackward()
    }

    /// The document has its own undo, and it is what the toolbar's Undo uses.
    override var undoManager: UndoManager? { nil }

    /// Copy, Cut and Paste in the text view's own menu go through the document, so they keep formatting.
    var onCopy: (() -> Void)?
    var onCut: (() -> Void)?
    var onPaste: (() -> Void)?

    override func copy(_ sender: Any?) { if let onCopy { onCopy() } else { super.copy(sender) } }
    override func cut(_ sender: Any?) { if let onCut { onCut() } else { super.cut(sender) } }
    override func paste(_ sender: Any?) { if let onPaste { onPaste() } else { super.paste(sender) } }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        // A copied picture can be pasted, which a text view doesn't know.
        if action == #selector(UIResponderStandardEditActions.paste(_:)), onPaste != nil {
            return UIPasteboard.general.hasStrings || UIPasteboard.general.hasImages
        }
        return super.canPerformAction(action, withSender: sender)
    }
}

/// A paragraph, heading, quote, code block or list item: editable text with its formatting.
@MainActor
final class PliTextBlockView: UIView, PliBlockRow, UITextViewDelegate {
    let kind = "text"
    private let textView = PliTextView()
    private let marker = UILabel()
    private let bar = UIView()
    private var indent: NSLayoutConstraint!
    private var markerWidth: NSLayoutConstraint!
    private var block: PliContentBlock?
    private var context: PliBlockContext?
    private var applying: Bool {
        get { textView.programmatic }
        set { textView.programmatic = newValue }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        textView.delegate = self
        textView.isScrollEnabled = false
        textView.backgroundColor = .clear
        textView.textContainerInset = UIEdgeInsets(top: 3, left: 0, bottom: 3, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.adjustsFontForContentSizeCategory = false
        // The bar of undo, redo and paste on an iPad's keyboard: the document has its own, in the toolbar.
        textView.inputAssistantItem.leadingBarButtonGroups = []
        textView.inputAssistantItem.trailingBarButtonGroups = []
        textView.onBackspaceAtStart = { [weak self] in
            guard let self, let block = self.block else { return }
            self.context?.model.backspaceAtStart(block: block.id)
        }

        marker.textAlignment = .right
        marker.isUserInteractionEnabled = false
        bar.backgroundColor = UIColor.secondaryLabel.withAlphaComponent(0.4)
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

    private var clearAreas: [CGRect] = []
    private var reserved: NSLayoutConstraint?

    /// Keeps the block at least this tall (room for a picture that runs on past its text). Returns true when that changed.
    func reserve(_ height: CGFloat) -> Bool {
        let wanted = max(0, height.rounded())
        if wanted == (reserved?.constant ?? 0) { return false }
        reserved?.isActive = false
        reserved = nil
        if wanted > 0 {
            let constraint = heightAnchor.constraint(greaterThanOrEqualToConstant: wanted)
            constraint.priority = UILayoutPriority(900)
            constraint.isActive = true
            reserved = constraint
        }
        return true
    }

    /// Keeps the text away from the given areas (in the stack's coordinates): the text wraps around them. Returns true when that changed.
    func keepClear(of areas: [CGRect], in stack: UIView) -> Bool {
        let own = convert(bounds, to: stack)
        var local: [CGRect] = []
        for area in areas where area.intersects(own) {
            let inText = textView.convert(area, from: stack)
            local.append(inText.offsetBy(dx: -textView.textContainerInset.left, dy: -textView.textContainerInset.top).integral)
        }
        guard local != clearAreas else { return false }
        clearAreas = local
        textView.textContainer.exclusionPaths = local.map { UIBezierPath(rect: $0) }
        textView.invalidateIntrinsicContentSize()
        return true
    }

    func update(_ block: PliContentBlock, context: PliBlockContext) {
        self.block = block
        self.context = context
        context.textViews.setObject(textView, forKey: block.id as NSString)
        textView.blockID = block.id
        textView.onCopy = { [weak context] in context?.model.copy() }
        textView.onCut = { [weak context] in context?.model.cut() }
        textView.onPaste = { [weak context] in context?.model.paste() }
        textView.onArrow = { [weak context, weak textView] arrow, extend in
            guard let context, let textView else { return false }
            return context.handle(arrow, extend: extend, in: textView)
        }

        let isItem = block.type == "list_item"
        let gutter: CGFloat = isItem ? 28 : 0
        indent.constant = CGFloat(block.depth ?? 0) * 24 + (isItem ? CGFloat((block.format?.indentLeft ?? 0) * context.style.documentScale) : 0)
        markerWidth.constant = isItem ? gutter : 0
        marker.isHidden = !isItem
        if isItem {
            let font = PliRichText.font(for: nil, in: block, style: context.style)
            marker.font = font
            marker.textColor = context.style.secondaryColor
            marker.text = (block.label ?? "") + " "
        }
        bar.isHidden = block.type != "quote"
        backgroundColor = block.type == "code_block" ? context.style.secondaryColor.withAlphaComponent(0.1) : .clear
        textView.isEditable = context.isEditable

        let attributed = NSMutableAttributedString(attributedString: PliRichText.attributedString(for: block, style: context.style))
        // Text that a selection across blocks covers is tinted here; the one block that has the caret shows its own.
        if let covered = context.model.selectedRange(in: block.id), covered.length > 0, NSMaxRange(covered) <= attributed.length {
            attributed.addAttribute(.backgroundColor, value: UIColor.tintColor.withAlphaComponent(0.3), range: covered)
        }
        textView.typingAttributes = PliRichText.typingAttributes(for: block, style: context.style)
        guard textView.markedTextRange == nil else { return }
        let same = textView.text == attributed.string
        if same && PliRichText.sameLook(textView.attributedText, attributed) { return }

        // The document's text is what's on screen. Keep the caret where it was, or put it where the document says it is.
        var range = textView.selectedRange
        if !same, let selection = context.model.selection, selection.focus.block == block.id {
            let low = min(selection.anchor.block == block.id ? selection.anchor.offset : selection.focus.offset, selection.focus.offset)
            range = NSRange(location: low, length: abs(selection.focus.offset - (selection.anchor.block == block.id ? selection.anchor.offset : selection.focus.offset)))
        }
        applying = true
        textView.attributedText = attributed
        textView.typingAttributes = PliRichText.typingAttributes(for: block, style: context.style)
        let length = attributed.length
        let location = min(range.location, length)
        textView.selectedRange = NSRange(location: location, length: min(range.length, length - location))
        applying = false
    }

    // MARK: Typing

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        guard let block, let context else { return true }
        // With a selection across blocks, what is typed or deleted goes over all of it.
        if context.model.isMultiBlock, textView.markedTextRange == nil {
            context.model.replaceSelection(with: text)
            return false
        }
        if text == "\n", textView.markedTextRange == nil {
            context.model.split(block: block.id, from: range.location, to: range.location + range.length)
            return false
        }
        return true
    }

    func textViewDidChange(_ textView: UITextView) {
        guard !applying, textView.markedTextRange == nil, let block, let context else { return }
        // What changed is the stretch between the text the document has and the text on screen.
        let old = block.text as NSString
        let new = textView.text as NSString
        var prefix = 0
        let shortest = min(old.length, new.length)
        while prefix < shortest, old.character(at: prefix) == new.character(at: prefix) { prefix += 1 }
        if prefix > 0, prefix < new.length || prefix < old.length, Self.isHighSurrogate(new.character(at: prefix - 1)) { prefix -= 1 }
        var suffix = 0
        while suffix < shortest - prefix, old.character(at: old.length - 1 - suffix) == new.character(at: new.length - 1 - suffix) { suffix += 1 }
        if suffix > 0, Self.isLowSurrogate(new.character(at: new.length - suffix)) { suffix -= 1 }
        guard old.length - suffix >= prefix, new.length - suffix >= prefix else { return }
        let inserted = new.substring(with: NSRange(location: prefix, length: new.length - suffix - prefix))
        if prefix == old.length - suffix && inserted.isEmpty { return }
        context.model.replace(block: block.id, from: prefix, to: old.length - suffix, with: inserted)
        context.scrollCaretIntoView(of: textView)
    }

    private static func isHighSurrogate(_ unit: unichar) -> Bool { (0xD800...0xDBFF).contains(unit) }
    private static func isLowSurrogate(_ unit: unichar) -> Bool { (0xDC00...0xDFFF).contains(unit) }

    // MARK: Selection

    func textViewDidBeginEditing(_ textView: UITextView) {
        guard !applying else { return }
        reportSelection()
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard !applying, context?.isDragging != true else { return }
        reportSelection()
        context?.scrollCaretIntoView(of: textView)
    }

    private func reportSelection() {
        // While the text on screen is ahead of the document (just typed), the document learns where the caret is from the edit.
        guard let block, let context, textView.markedTextRange == nil, textView.text == block.text else { return }
        let range = textView.selectedRange
        context.model.place(block: block.id, from: range.location, to: range.location + range.length)
    }
}

extension PliRichText {
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
}

// MARK: - Other blocks

/// A divider, page break, section break or table of contents.
@MainActor
final class PliMarkerBlockView: UIView, PliBlockRow {
    let kind = "marker"
    private let line = UIView()
    private let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        line.backgroundColor = .separator
        label.font = .preferredFont(forTextStyle: .caption1)
        label.textColor = .secondaryLabel
        label.textAlignment = .center
        for view in [line, label] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
        NSLayoutConstraint.activate([
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.heightAnchor.constraint(equalToConstant: 1),
            line.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 24),
        ])
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    func update(_ block: PliContentBlock, context: PliBlockContext) {
        switch block.type {
        case "page_break": label.text = "  Page break  "
        case "section_break": label.text = "  Section break  "
        case "toc": label.text = "  Table of contents  "
        default: label.text = nil
        }
        label.backgroundColor = label.text == nil ? .clear : .systemBackground
    }
}

/// The picture inside its frame: all of it, bigger than the frame and shifted when it is cropped, so only what is kept shows.
final class PliCropClipView: UIView {
    let imageView = UIImageView()
    var crop = PliCrop.none { didSet { setNeedsLayout() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        imageView.contentMode = .scaleToFill
        imageView.isUserInteractionEnabled = false
        addSubview(imageView)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let across = max(1 - crop.left - crop.right, 0.05), down = max(1 - crop.top - crop.bottom, 0.05)
        let full = CGSize(width: bounds.width / across, height: bounds.height / down)
        imageView.frame = CGRect(x: -crop.left * full.width, y: -crop.top * full.height, width: full.width, height: full.height)
    }
}

/// A picture. A `data:` source is decoded here; a web address is fetched. Tap it to select it; a dot on its corner then resizes it.
/// A picture that text wraps around sits at the left or right edge, and the text after it runs beside it. While a picture is being
/// cropped, all of it is shown, with what is cut away dimmed, and a grip on each edge.
@MainActor
final class PliImageBlockView: UIView, PliBlockRow {
    /// The space between a picture that text wraps around and the text.
    static let gap: CGFloat = 14

    let kind = "image"
    private let clip = PliCropClipView()
    private let dim = CAShapeLayer()
    private let grip = UIView()
    private var edges: [UIView] = []
    private var source: String?
    private var block: PliContentBlock?
    private var context: PliBlockContext?
    private var geometry: [NSLayoutConstraint] = []
    private var isCropping = false
    private var isWrapped = false
    private var lastBox = CGRect.zero
    private var startWidth: Double = 0
    private var startCrop = PliCrop.none
    private var resized = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        clip.imageView.contentMode = .scaleToFill
        clip.translatesAutoresizingMaskIntoConstraints = false
        clip.isUserInteractionEnabled = true
        clip.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
        addSubview(clip)

        dim.fillRule = .evenOdd
        dim.fillColor = UIColor.black.withAlphaComponent(0.5).cgColor
        clip.layer.addSublayer(dim)

        grip.translatesAutoresizingMaskIntoConstraints = false
        grip.backgroundColor = .clear
        let dot = UIView(frame: CGRect(x: 7, y: 7, width: 14, height: 14))
        dot.backgroundColor = .tintColor
        dot.layer.cornerRadius = 7
        dot.layer.borderWidth = 2
        dot.layer.borderColor = UIColor.systemBackground.cgColor
        dot.isUserInteractionEnabled = false
        grip.addSubview(dot)
        grip.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(dragged(_:))))
        grip.isAccessibilityElement = true
        grip.accessibilityLabel = "Resize picture"
        grip.isHidden = true
        addSubview(grip)

        // A grip on each edge of the part that is kept: left, top, right, bottom.
        for index in 0..<4 {
            let edge = UIView()
            edge.backgroundColor = .clear
            let bar = UIView()
            bar.backgroundColor = .white
            bar.layer.cornerRadius = 2
            bar.layer.borderWidth = 1
            bar.layer.borderColor = UIColor.tintColor.cgColor
            bar.isUserInteractionEnabled = false
            bar.tag = 100
            edge.addSubview(bar)
            edge.tag = index
            edge.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(edgeDragged(_:))))
            edge.isAccessibilityElement = true
            edge.accessibilityLabel = ["Crop left edge", "Crop top edge", "Crop right edge", "Crop bottom edge"][index]
            edge.isHidden = true
            addSubview(edge)
            edges.append(edge)
        }
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    /// Where a picture that text wraps around is, in the stack's coordinates, or nil when it isn't one.
    func floatRect(in stack: UIView) -> CGRect? {
        guard isWrapped else { return nil }
        return clip.convert(clip.bounds, to: stack)
    }

    // A wrapped picture takes no height in the stack, so the stack asks it where a touch is by its picture.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard isWrapped else { return super.point(inside: point, with: event) }
        return subviews.contains { !$0.isHidden && $0.frame.insetBy(dx: -14, dy: -14).contains(point) }
    }

    func update(_ block: PliContentBlock, context: PliBlockContext) {
        self.block = block
        self.context = context
        let crop = block.crop ?? .none
        let across = max(1 - crop.left - crop.right, 0.05), down = max(1 - crop.top - crop.bottom, 0.05)
        let selected = context.isEditable && context.model.format.image?.id == block.id
        isCropping = selected && context.model.croppingPicture == block.id
        isWrapped = block.wrap != nil && context.model.wrapsPictures
        // The box is what is kept, or all of the picture while it is cropped.
        let w = max((block.width ?? 200) / (isCropping ? across : 1), 1), h = max((block.height ?? 150) / (isCropping ? down : 1), 1)

        NSLayoutConstraint.deactivate(geometry)
        let right = isWrapped && block.wrap == "right"
        let width = clip.widthAnchor.constraint(equalToConstant: CGFloat(w))
        // The width wanted yields to the room there is, and the shape stays.
        width.priority = UILayoutPriority(999)
        var next = [
            width,
            clip.heightAnchor.constraint(equalTo: clip.widthAnchor, multiplier: CGFloat(h / w)),
            clip.topAnchor.constraint(equalTo: topAnchor, constant: 4),
        ]
        if isWrapped {
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
        clipsToBounds = false

        clip.crop = isCropping ? .none : crop
        clip.imageView.isAccessibilityElement = true
        clip.imageView.accessibilityLabel = block.alt
        clip.layer.borderWidth = selected && !isCropping ? 2 : 0
        clip.layer.borderColor = UIColor.tintColor.cgColor
        grip.isHidden = !selected || isCropping
        for edge in edges { edge.isHidden = !isCropping }
        setNeedsLayout()

        guard block.src != source else { return }
        source = block.src
        clip.imageView.image = nil
        guard let src = block.src else { return }
        if src.hasPrefix("data:"), let comma = src.firstIndex(of: ","), let data = Data(base64Encoded: String(src[src.index(after: comma)...])) {
            clip.imageView.image = UIImage(data: data)
        } else if let url = URL(string: src), url.scheme == "http" || url.scheme == "https" {
            URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
                guard let data, let image = UIImage(data: data) else { return }
                DispatchQueue.main.async { if self?.source == src { self?.clip.imageView.image = image } }
            }.resume()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let box = clip.frame
        // Where a picture that text wraps around is decides where the text beside it stops: the stack works that out again.
        if isWrapped, box != lastBox { (superview as? PliBlockStack)?.setNeedsLayout() }
        lastBox = box
        grip.frame = CGRect(x: box.maxX - 16, y: box.maxY - 16, width: 28, height: 28)
        guard isCropping, let block else {
            dim.path = nil
            return
        }
        // What is kept, in the box that shows all of the picture.
        let crop = block.crop ?? .none
        let kept = CGRect(x: crop.left * box.width, y: crop.top * box.height, width: (1 - crop.left - crop.right) * box.width, height: (1 - crop.top - crop.bottom) * box.height)
        let path = UIBezierPath(rect: clip.bounds)
        path.append(UIBezierPath(rect: kept))
        dim.frame = clip.bounds
        dim.path = path.cgPath
        let k = kept.offsetBy(dx: box.minX, dy: box.minY)
        let centres = [CGPoint(x: k.minX, y: k.midY), CGPoint(x: k.midX, y: k.minY), CGPoint(x: k.maxX, y: k.midY), CGPoint(x: k.midX, y: k.maxY)]
        for (index, edge) in edges.enumerated() {
            edge.frame = CGRect(x: centres[index].x - 22, y: centres[index].y - 22, width: 44, height: 44)
            if let bar = edge.viewWithTag(100) {
                bar.frame = index % 2 == 0 ? CGRect(x: 18, y: 8, width: 8, height: 28) : CGRect(x: 8, y: 18, width: 28, height: 8)
            }
        }
    }

    @objc private func tapped() {
        guard let block, let context, context.isEditable else { return }
        context.model.selectPicture(block.id)
        // The picture isn't text: the keyboard goes away, and the toolbar's picture menu works on it.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func enclosingScroller() -> UIScrollView? {
        var view = superview
        while let current = view, !(current is UIScrollView) { view = current.superview }
        return view as? UIScrollView
    }

    @objc private func dragged(_ gesture: UIPanGestureRecognizer) {
        guard let block, let context else { return }
        switch gesture.state {
        case .began:
            // From the width it is shown at, which is less than the one it has when the screen is narrower than the picture.
            startWidth = max(Double(clip.bounds.width), 1)
            resized = false
            enclosingScroller()?.isScrollEnabled = false
        case .changed:
            let next = max(32, startWidth + Double(gesture.translation(in: self).x) * (block.wrap == "right" ? -1 : 1))
            let ratio = max(block.height ?? 150, 1) / max(block.width ?? 200, 1)
            context.model.setImageSize(block.id, width: Int(next.rounded()), height: Int((next * ratio).rounded()), merge: resized)
            resized = true
        case .ended, .cancelled, .failed:
            enclosingScroller()?.isScrollEnabled = true
        default:
            break
        }
    }

    @objc private func edgeDragged(_ gesture: UIPanGestureRecognizer) {
        guard let block, let context, let edge = gesture.view else { return }
        switch gesture.state {
        case .began:
            startCrop = block.crop ?? .none
            resized = false
            enclosingScroller()?.isScrollEnabled = false
        case .changed:
            let t = gesture.translation(in: self)
            let dx = Double(t.x / max(clip.bounds.width, 1)), dy = Double(t.y / max(clip.bounds.height, 1))
            var next = startCrop
            // An edge can go no further than 10% of the picture from the one across.
            switch edge.tag {
            case 0: next.left = min(max(startCrop.left + dx, 0), 0.9 - startCrop.right)
            case 1: next.top = min(max(startCrop.top + dy, 0), 0.9 - startCrop.bottom)
            case 2: next.right = min(max(startCrop.right - dx, 0), 0.9 - startCrop.left)
            default: next.bottom = min(max(startCrop.bottom - dy, 0), 0.9 - startCrop.top)
            }
            context.model.setImageCrop(block.id, next, merge: resized)
            resized = true
        case .ended, .cancelled, .failed:
            enclosingScroller()?.isScrollEnabled = true
        default:
            break
        }
    }
}

/// A table: a grid of cells, each with blocks of its own that can be edited. While the caret is in it, the edges between columns
/// have handles to drag.
@MainActor
final class PliTableBlockView: UIView, PliBlockRow {
    let kind = "table"
    private let context: PliBlockContext
    private let grid = UIStackView()
    private var signature = ""
    private var cells: [String: PliBlockStack] = [:]
    /// Each cell's width, as a share of its row, so a drag can change it without making the cells again.
    private var placed: [(constraint: NSLayoutConstraint, line: UIStackView, container: UIView, column: Int, span: Int)] = []
    private var columns: [Double] = []
    private var tableID = ""
    private var handles: [UIView] = []
    private var rowHandles: [UIView] = []
    private var rowHeights: [NSLayoutConstraint?] = []
    private var heights: [Double?] = []
    private var draggedFirst = true

    init(context: PliBlockContext) {
        self.context = context
        super.init(frame: .zero)
        grid.axis = .vertical
        grid.alignment = .fill
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

    func update(_ block: PliContentBlock, context: PliBlockContext) {
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
                if let container = cells[cell.id]?.superview {
                    container.backgroundColor = cell.shade.flatMap { PliPlatformColor.pli(hex: $0) } ?? (rowIndex == 0 && block.headerRow == true ? UIColor.secondarySystemBackground : .clear)
                }
            }
        }
        let editing = context.model.format.table?.id == block.id && context.isEditable
        for handle in handles + rowHandles { handle.isHidden = !editing }
        setNeedsLayout()
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

    /// A row is at least as tall as it was set to (in the document's points, drawn bigger).
    private func applyHeights() {
        let scale = CGFloat(context.style.documentScale)
        for (index, constraint) in rowHeights.enumerated() {
            constraint?.isActive = false
            rowHeights[index] = nil
            guard index < grid.arrangedSubviews.count, index < heights.count, let points = heights[index] else { continue }
            let next = grid.arrangedSubviews[index].heightAnchor.constraint(greaterThanOrEqualToConstant: CGFloat(points) * scale)
            next.priority = .defaultHigh
            next.isActive = true
            rowHeights[index] = next
        }
    }

    private func rebuild(rows: [PliTableRow]) {
        for view in grid.arrangedSubviews { grid.removeArrangedSubview(view); view.removeFromSuperview() }
        cells = [:]
        placed = []
        rowHeights = Array(repeating: nil, count: rows.count)
        for row in rows {
            let line = UIStackView()
            line.axis = .horizontal
            line.alignment = .fill
            line.distribution = .fill
            var column = 0
            var skip = 0
            for cell in row.cells {
                defer { column += 1 }
                // A cell that another cell reaches over, to its left, has no place of its own.
                if skip > 0 {
                    skip -= 1
                    continue
                }
                let span = max(cell.colSpan ?? 1, 1)
                skip = span - 1
                let container = UIView()
                container.translatesAutoresizingMaskIntoConstraints = false
                // A cell that a merged cell above it reaches over is a gap in the row.
                if cell.covered != true {
                    container.layer.borderWidth = 0.5
                    container.layer.borderColor = UIColor.separator.cgColor
                    let stack = PliBlockStack(context: context, allowsWrap: true)
                    stack.translatesAutoresizingMaskIntoConstraints = false
                    container.addSubview(stack)
                    NSLayoutConstraint.activate([
                        stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 6),
                        stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -6),
                        stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 4),
                        stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -4),
                    ])
                    cells[cell.id] = stack
                }
                line.addArrangedSubview(container)
                let constraint = container.widthAnchor.constraint(equalTo: line.widthAnchor, multiplier: CGFloat(max(weight(column, span) / total, 0.0001)))
                constraint.isActive = true
                placed.append((constraint, line, container, column, span))
            }
            grid.addArrangedSubview(line)
        }
    }

    // MARK: Dragging the edges between columns

    private func rebuildHandles() {
        handles.forEach { $0.removeFromSuperview() }
        rowHandles.forEach { $0.removeFromSuperview() }
        rowHandles = (0..<rowHeights.count).map { _ in
            let handle = UIView()
            handle.backgroundColor = .clear
            let grip = UIView()
            grip.backgroundColor = UIColor.tintColor.withAlphaComponent(0.55)
            grip.layer.cornerRadius = 2
            grip.frame = CGRect(x: 0, y: 12, width: 28, height: 4)
            grip.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin]
            grip.isUserInteractionEnabled = false
            handle.addSubview(grip)
            handle.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(rowDragged(_:))))
            handle.isAccessibilityElement = true
            handle.accessibilityLabel = "Row edge"
            addSubview(handle)
            return handle
        }
        handles = (0..<max(columns.count - 1, 0)).map { _ in
            let handle = UIView()
            handle.backgroundColor = .clear
            let grip = UIView()
            grip.backgroundColor = UIColor.tintColor.withAlphaComponent(0.55)
            grip.layer.cornerRadius = 2
            grip.frame = CGRect(x: 12, y: 0, width: 4, height: 28)
            grip.autoresizingMask = [.flexibleTopMargin, .flexibleBottomMargin]
            grip.isUserInteractionEnabled = false
            handle.addSubview(grip)
            handle.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(dragged(_:))))
            handle.isAccessibilityElement = true
            handle.accessibilityLabel = "Column edge"
            addSubview(handle)
            return handle
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        var before = 0.0
        for (index, handle) in handles.enumerated() {
            before += columns[index]
            let x = grid.frame.minX + grid.frame.width * CGFloat(before / total)
            handle.frame = CGRect(x: x - 14, y: grid.frame.minY, width: 28, height: grid.frame.height)
            if let grip = handle.subviews.first { grip.frame.origin.y = (handle.bounds.height - 28) / 2 }
        }
        for (index, handle) in rowHandles.enumerated() where index < grid.arrangedSubviews.count {
            let line = grid.arrangedSubviews[index]
            // On the row's bottom edge, at the left, where it doesn't sit on a column's handle.
            handle.frame = CGRect(x: grid.frame.minX + 6, y: grid.frame.minY + line.frame.maxY - 14, width: 28, height: 28)
            if let grip = handle.subviews.first { grip.frame.origin.x = (handle.bounds.width - 28) / 2 }
        }
    }

    @objc private func rowDragged(_ gesture: UIPanGestureRecognizer) {
        guard let handle = gesture.view, let index = rowHandles.firstIndex(of: handle), index < grid.arrangedSubviews.count else { return }
        var scroller = superview
        while let view = scroller, !(view is UIScrollView) { scroller = view.superview }
        switch gesture.state {
        case .began:
            draggedFirst = true
            (scroller as? UIScrollView)?.isScrollEnabled = false
        case .changed:
            let line = grid.arrangedSubviews[index]
            let y = gesture.location(in: grid).y
            let points = max(16, Double((y - line.frame.minY) / CGFloat(context.style.documentScale)))
            context.model.setRowHeight(table: tableID, row: index, points: points.rounded(), merge: !draggedFirst)
            draggedFirst = false
        case .ended, .cancelled, .failed:
            (scroller as? UIScrollView)?.isScrollEnabled = true
        default:
            break
        }
    }

    @objc private func dragged(_ gesture: UIPanGestureRecognizer) {
        guard let handle = gesture.view, let index = handles.firstIndex(of: handle) else { return }
        var scroller = superview
        while let view = scroller, !(view is UIScrollView) { scroller = view.superview }
        switch gesture.state {
        case .began:
            draggedFirst = true
            (scroller as? UIScrollView)?.isScrollEnabled = false
        case .changed:
            let x = gesture.location(in: grid).x
            context.model.moveColumnEdge(table: tableID, column: index, position: Double(x / max(grid.bounds.width, 1)), merge: !draggedFirst)
            draggedFirst = false
        case .ended, .cancelled, .failed:
            (scroller as? UIScrollView)?.isScrollEnabled = true
        default:
            break
        }
    }
}

// MARK: - The document

/// The document as a scrolling column of editable blocks, in UIKit. Put it in your own view controller, or use `PliBlocksView` in SwiftUI.
///
/// Every block is drawn from the document, and every edit goes through the model, so the toolbar, your own buttons and the typing
/// all change the same document.
@MainActor
public final class PliBlocksScrollView: UIScrollView, UIGestureRecognizerDelegate {
    public let model: PliDocumentModel
    private let context: PliBlockContext
    private let stack: PliBlockStack
    private var bag = Set<AnyCancellable>()
    private var selecting: UILongPressGestureRecognizer?
    private var dragAnchor: PliPoint?
    private var dragPoint = CGPoint.zero
    private var autoscroll: Timer?

    /// Whether the text can be changed.
    public var isEditable: Bool {
        get { context.isEditable }
        set { context.isEditable = newValue; apply() }
    }

    public init(model: PliDocumentModel, style: PliTextStyle = PliTextStyle()) {
        self.model = model
        context = PliBlockContext(model: model, style: style)
        stack = PliBlockStack(context: context, allowsWrap: true)
        super.init(frame: .zero)
        context.scrollView = self
        keyboardDismissMode = .interactive
        alwaysBounceVertical = true
        backgroundColor = .systemBackground

        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.spacing = 6
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: frameLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: frameLayoutGuide.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: contentLayoutGuide.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(equalTo: contentLayoutGuide.bottomAnchor, constant: -96),
        ])

        // Press and drag to select, from one block into another. The scroll view's own drag waits to see that this isn't one.
        let press = UILongPressGestureRecognizer(target: self, action: #selector(pressed(_:)))
        press.minimumPressDuration = 0.35
        press.allowableMovement = 10
        press.delegate = self
        addGestureRecognizer(press)
        panGestureRecognizer.require(toFail: press)
        selecting = press

        // A tap below the last block puts the caret at the end of the document.
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        addGestureRecognizer(tap)

        model.didRefresh.sink { [weak self] in self?.apply() }.store(in: &bag)
        NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)
            .sink { [weak self] in self?.keyboardChanged($0) }.store(in: &bag)
        NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)
            .sink { [weak self] _ in self?.setBottomInset(0) }.store(in: &bag)
        apply()
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    private func apply() {
        stack.update(model.blocks)
        if let id = model.focusRequest {
            model.focusRequest = nil
            layoutIfNeeded()
            if let textView = context.textViews.object(forKey: id as NSString) {
                textView.becomeFirstResponder()
                if let selection = model.selection, selection.focus.block == id {
                    let length = (textView.text as NSString).length
                    let from = min(selection.anchor.block == id ? selection.anchor.offset : selection.focus.offset, length)
                    let to = min(selection.focus.offset, length)
                    textView.selectedRange = NSRange(location: min(from, to), length: abs(to - from))
                }
                context.scrollCaretIntoView(of: textView)
            }
        }
        // With a selection across blocks, the keyboard stays at its end, so typing and Delete go over the whole selection.
        if model.isMultiBlock, !context.isDragging, let focus = model.selection?.focus, let view = context.textViews.object(forKey: focus.block as NSString) {
            view.programmatic = true
            if !view.isFirstResponder { view.becomeFirstResponder() }
            let offset = min(focus.offset, (view.text as NSString).length)
            if view.selectedRange != NSRange(location: offset, length: 0) { view.selectedRange = NSRange(location: offset, length: 0) }
            view.programmatic = false
        }
    }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        guard isEditable, gesture.state == .ended else { return }
        let point = gesture.location(in: self)
        guard point.y > stack.frame.maxY - 4, let last = model.blocks.last(where: \.isText) else { return }
        model.focus(block: last.id)
    }

    public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        // The text views' own press (the magnifier) and the tap are fine alongside; the scroll view's drag is not.
        other !== panGestureRecognizer
    }

    // MARK: Selecting by dragging

    @objc private func pressed(_ gesture: UILongPressGestureRecognizer) {
        guard isEditable else { return }
        let point = gesture.location(in: self)
        switch gesture.state {
        case .began:
            guard let start = context.hit(at: point) else { return }
            dragAnchor = start
            dragPoint = point
            context.isDragging = true
            // A press without moving selects the word under the finger, as in one block.
            if let view = context.textViews.object(forKey: start.block as NSString), let word = wordRange(in: view, at: start.offset) {
                model.selectRange(anchor: PliPoint(block: start.block, offset: word.location), focus: PliPoint(block: start.block, offset: NSMaxRange(word)))
                view.programmatic = true
                view.selectedRange = word
                view.programmatic = false
                dragAnchor = PliPoint(block: start.block, offset: word.location)
            }
            startAutoscroll(gesture)
        case .changed:
            dragPoint = point
            extendSelection(to: point)
        case .ended, .cancelled, .failed:
            stopAutoscroll()
            if gesture.state == .ended { dragPoint = point; extendSelection(to: point) }
            let final = dragAnchor.flatMap { anchor in context.hit(at: dragPoint).map { (anchor, $0) } }
            let keep = gesture.state == .ended
            dragAnchor = nil
            // The text view's own press ends around now and moves its caret; the selection that was dragged out is the one that stays.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                guard let self else { return }
                self.context.isDragging = false
                if keep, let (anchor, focus) = final { self.model.selectRange(anchor: anchor, focus: focus) }
                self.apply()
            }
        default:
            break
        }
    }

    private func wordRange(in view: PliTextView, at offset: Int) -> NSRange? {
        guard let position = view.position(from: view.beginningOfDocument, offset: offset),
              let range = view.tokenizer.rangeEnclosingPosition(position, with: .word, inDirection: UITextDirection(rawValue: UITextStorageDirection.forward.rawValue)) else { return nil }
        let start = view.offset(from: view.beginningOfDocument, to: range.start)
        return NSRange(location: start, length: view.offset(from: range.start, to: range.end))
    }

    private func extendSelection(to point: CGPoint) {
        guard let anchor = dragAnchor, let focus = context.hit(at: point) else { return }
        model.selectRange(anchor: anchor, focus: focus)
        if anchor.block == focus.block, let view = context.textViews.object(forKey: anchor.block as NSString) {
            view.programmatic = true
            view.selectedRange = NSRange(location: min(anchor.offset, focus.offset), length: abs(focus.offset - anchor.offset))
            view.programmatic = false
        }
    }

    /// Scrolls while a finger holds a drag near the top or bottom edge.
    private func startAutoscroll(_ gesture: UILongPressGestureRecognizer) {
        autoscroll?.invalidate()
        autoscroll = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self, weak gesture] _ in
            guard let self, let gesture else { return }
            let visible = gesture.location(in: self.superview ?? self)
            let top = self.frame.minY + 60, bottom = self.frame.maxY - 60 - self.contentInset.bottom
            var step: CGFloat = 0
            if visible.y < top { step = -min(14, (top - visible.y) / 4 + 2) } else if visible.y > bottom { step = min(14, (visible.y - bottom) / 4 + 2) }
            guard step != 0 else { return }
            let limit = max(-self.adjustedContentInset.top, self.contentSize.height - self.bounds.height + self.adjustedContentInset.bottom)
            let next = min(max(self.contentOffset.y + step, -self.adjustedContentInset.top), limit)
            guard next != self.contentOffset.y else { return }
            self.dragPoint.y += next - self.contentOffset.y
            self.contentOffset.y = next
            self.extendSelection(to: self.dragPoint)
        }
    }

    private func stopAutoscroll() {
        autoscroll?.invalidate()
        autoscroll = nil
    }

    private func keyboardChanged(_ note: Notification) {
        guard let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue, let window else { return }
        let mine = convert(bounds, to: window)
        setBottomInset(max(0, mine.maxY - frame.minY))
    }

    private func setBottomInset(_ value: CGFloat) {
        contentInset.bottom = value
        verticalScrollIndicatorInsets.bottom = value
    }
}

/// The document as a scrolling column of editable blocks, in SwiftUI.
///
/// ```swift
/// VStack(spacing: 0) {
///     PliBlocksView(model)
///     PliToolbarView(model)
/// }
/// ```
public struct PliBlocksView: UIViewRepresentable {
    private let model: PliDocumentModel
    private let style: PliTextStyle
    private let isEditable: Bool

    public init(_ model: PliDocumentModel, style: PliTextStyle = PliTextStyle(), isEditable: Bool = true) {
        self.model = model
        self.style = style
        self.isEditable = isEditable
    }

    public func makeUIView(context: Context) -> PliBlocksScrollView {
        let view = PliBlocksScrollView(model: model, style: style)
        view.isEditable = isEditable
        return view
    }

    public func updateUIView(_ view: PliBlocksScrollView, context: Context) {
        if view.isEditable != isEditable { view.isEditable = isEditable }
    }
}
#endif
