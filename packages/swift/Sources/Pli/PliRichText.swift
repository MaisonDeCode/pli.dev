import Foundation

#if canImport(UIKit)
import UIKit
public typealias PliPlatformFont = UIFont
public typealias PliPlatformColor = UIColor
#elseif canImport(AppKit)
import AppKit
public typealias PliPlatformFont = NSFont
public typealias PliPlatformColor = NSColor
#endif

/// How a block's text looks on screen: the sizes, fonts and colours that go with each kind of block, and how runs with their formatting
/// become an attributed string.
public struct PliTextStyle: Sendable {
    /// The size of body text, in points.
    public var bodySize: Double = 17
    /// How much a document's own font sizes (in points) are scaled, so that 11 pt text sits comfortably next to `bodySize`.
    public var documentScale: Double = 17.0 / 11.0
    public var textColor: PliPlatformColor = PliPlatformColor.pliLabel
    public var secondaryColor: PliPlatformColor = PliPlatformColor.pliSecondaryLabel
    public var linkColor: PliPlatformColor = PliPlatformColor.pliLink
    public init() {}
}

extension PliPlatformColor {
    static var pliLabel: PliPlatformColor {
        #if canImport(UIKit)
        .label
        #else
        .labelColor
        #endif
    }
    static var pliSecondaryLabel: PliPlatformColor {
        #if canImport(UIKit)
        .secondaryLabel
        #else
        .secondaryLabelColor
        #endif
    }
    static var pliLink: PliPlatformColor {
        #if canImport(UIKit)
        .link
        #else
        .linkColor
        #endif
    }

    /// A colour from a hex string such as `#b91c1c`, `#d33` or `b91c1c`.
    public static func pli(hex: String) -> PliPlatformColor? {
        var text = hex.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        return PliPlatformColor(red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255, blue: CGFloat(value & 0xff) / 255, alpha: 1)
    }
}

public enum PliRichText {
    /// The size and weight a block of this kind is drawn with.
    static func base(for block: PliContentBlock, style: PliTextStyle) -> (size: Double, bold: Bool, italic: Bool, mono: Bool, secondary: Bool) {
        switch block.type {
        case "title": return (style.bodySize * 2.0, true, false, false, false)
        case "subtitle": return (style.bodySize * 1.25, false, false, false, true)
        case "heading":
            let scale: [Double] = [1.7, 1.45, 1.25, 1.1, 1.0, 1.0]
            return (style.bodySize * scale[min(max((block.level ?? 1) - 1, 0), 5)], true, false, false, false)
        case "quote": return (style.bodySize, false, true, false, true)
        case "code_block": return (style.bodySize * 0.9, false, false, true, false)
        default: return (style.bodySize, false, false, false, false)
        }
    }

    /// The font for a stretch of text: the block's own look, changed by the run's formatting.
    static func font(for marks: PliMarks?, in block: PliContentBlock, style: PliTextStyle) -> PliPlatformFont {
        let base = base(for: block, style: style)
        var size = marks?.fontSize.map { $0 * style.documentScale } ?? base.size
        let bold = (marks?.bold ?? false) || base.bold
        let italic = (marks?.italic ?? false) || base.italic
        let mono = (marks?.code ?? false) || base.mono
        if marks?.superscript == true || marks?.subscript == true { size *= 0.75 }
        return makeFont(family: mono ? nil : marks?.fontFamily, size: size, bold: bold, italic: italic, mono: mono)
    }

    static func makeFont(family: String?, size: Double, bold: Bool, italic: Bool, mono: Bool) -> PliPlatformFont {
        #if canImport(UIKit)
        var traits: UIFontDescriptor.SymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        let plain: UIFont
        if mono { plain = UIFont.monospacedSystemFont(ofSize: size, weight: bold ? .bold : .regular) }
        else if let family, let named = UIFont(name: family, size: size) { plain = named }
        else { plain = UIFont.systemFont(ofSize: size) }
        if mono && !italic { return plain }
        guard let descriptor = plain.fontDescriptor.withSymbolicTraits(traits.union(plain.fontDescriptor.symbolicTraits)) else { return plain }
        return UIFont(descriptor: descriptor, size: size)
        #else
        var plain: NSFont
        if mono { plain = NSFont.monospacedSystemFont(ofSize: size, weight: bold ? .bold : .regular) }
        else if let family, let named = NSFont(name: family, size: size) { plain = named }
        else { plain = NSFont.systemFont(ofSize: size) }
        var traits: NSFontTraitMask = []
        if bold && !mono { traits.insert(.boldFontMask) }
        if italic { traits.insert(.italicFontMask) }
        if !traits.isEmpty { plain = NSFontManager.shared.convert(plain, toHaveTrait: traits) }
        return plain
        #endif
    }

    /// The paragraph look of a block: alignment, indent of a list item, spacing.
    static func paragraphStyle(for block: PliContentBlock, style: PliTextStyle) -> NSParagraphStyle {
        let paragraph = NSMutableParagraphStyle()
        switch block.align {
        case "center": paragraph.alignment = .center
        case "right": paragraph.alignment = .right
        case "justify": paragraph.alignment = .justified
        default: paragraph.alignment = .natural
        }
        // A list item's own indent moves its marker too, so the row takes it (see `PliTextBlockView`), not the text.
        var left = block.type == "list_item" ? 0 : (block.format?.indentLeft ?? 0) * style.documentScale
        if block.type == "quote" { left += 12 }
        paragraph.firstLineHeadIndent = left + (block.format?.indentFirst ?? 0) * style.documentScale
        paragraph.headIndent = left
        paragraph.tailIndent = -((block.format?.indentRight ?? 0) * style.documentScale)
        if let lineHeight = block.format?.lineHeight, lineHeight > 1 { paragraph.lineHeightMultiple = lineHeight }
        return paragraph
    }

    /// The text of a block with its formatting, as an attributed string.
    public static func attributedString(for block: PliContentBlock, style: PliTextStyle = PliTextStyle()) -> NSAttributedString {
        let base = base(for: block, style: style)
        let paragraph = paragraphStyle(for: block, style: style)
        let result = NSMutableAttributedString()
        for run in block.runs ?? [] {
            let marks = run.marks
            var attributes: [NSAttributedString.Key: Any] = [
                .font: font(for: marks, in: block, style: style),
                .foregroundColor: base.secondary ? style.secondaryColor : style.textColor,
                .paragraphStyle: paragraph,
            ]
            if marks?.underline == true { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
            if marks?.strike == true { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if marks?.superscript == true { attributes[.baselineOffset] = base.size * 0.35 }
            if marks?.subscript == true { attributes[.baselineOffset] = -base.size * 0.15 }
            if let color = marks?.color, let value = PliPlatformColor.pli(hex: color) { attributes[.foregroundColor] = value }
            if let highlight = marks?.highlight, let value = PliPlatformColor.pli(hex: highlight) { attributes[.backgroundColor] = value }
            if marks?.code == true && marks?.highlight == nil { attributes[.backgroundColor] = style.secondaryColor.withAlphaComponent(0.12) }
            if let link = marks?.link, let url = URL(string: link) {
                attributes[.link] = url
                attributes[.foregroundColor] = style.linkColor
                attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            result.append(NSAttributedString(string: run.text, attributes: attributes))
        }
        // An empty paragraph still has a look, for the caret and what is typed in it.
        if result.length == 0 {
            result.append(NSAttributedString(string: "", attributes: [.font: font(for: nil, in: block, style: style), .paragraphStyle: paragraph]))
        }
        return result
    }

    /// What typed text looks like in a block: its base look.
    public static func typingAttributes(for block: PliContentBlock, style: PliTextStyle = PliTextStyle()) -> [NSAttributedString.Key: Any] {
        let base = base(for: block, style: style)
        return [
            .font: font(for: nil, in: block, style: style),
            .foregroundColor: base.secondary ? style.secondaryColor : style.textColor,
            .paragraphStyle: paragraphStyle(for: block, style: style),
        ]
    }
}
