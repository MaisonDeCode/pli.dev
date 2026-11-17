---
title: Fonts and formatting
description: Fonts, sizes, colors, spacing, styles and lists.
---

Everything here is in the toolbar and the **Format** menu, and also available as session methods. To give a look a name and use it again, see [Styles](/documents/features/styles/).

## Text

| Control | Session method |
|---------|----------------|
| Bold, italic, underline, strikethrough, code | `toggleMark("bold" \| "italic" \| "underline" \| "strike" \| "code")` |
| Superscript, subscript | `toggleMark("superscript" \| "subscript")` (they exclude each other) |
| Font | `setMarks({ fontFamily: "Georgia" })` |
| Size, in points | `setMarks({ fontSize: 14 })` |
| Text color, highlight | `setMarks({ color: "#b91c1c", highlight: "#fef08a" })` |
| Link | `setLink("https://pli.dev")` |
| Clear formatting | `clearFormatting()` |

With only a caret, these set the formatting for the next characters you type. Pass `null` to remove a value: `setMarks({ fontSize: null })`.

Fonts are chosen by name, from the font picker in the toolbar. It offers the Office fonts and more than 2,000 open-licence Google families. Google fonts are downloaded when a document uses them, and a font that hasn't loaded (or can't) is drawn in a close stand-in until it does. The default is Arial, 11 pt. To restrict the list, serve the files yourself or add your own fonts, see [Fonts](/platform/fonts/).

## Paragraphs

**Styles:** Normal text, Title, Subtitle, Heading 1 to 6, Quote and Code block, from the style menu or `setBlockType()`. `Ctrl/Cmd+Alt+0` to `6` switches style from the keyboard.

**Alignment:** left, center, right and justified, with `setAlign()`.

**Spacing and indents**, in points, with `setParagraphFormat()`:

```ts
session.setParagraphFormat({
  lineHeight: 1.5,   // a multiple of the font size
  spaceBefore: 6,
  spaceAfter: 12,
  indentLeft: 36,
  indentRight: 36,
  indentFirst: 18,   // negative for a hanging indent
});

session.setParagraphFormat({ lineHeight: null }); // remove one value
```

The toolbar offers line spacing (single, 1.15, 1.5, double) and add or remove space before and after a paragraph. Indents are set with the [ruler](/documents/features/ruler-and-indents/), the indent buttons or the **Paragraph…** dialog.

## Lists

Bulleted and numbered lists nest up to nine levels. **Tab** and **Shift+Tab** change the level, and an empty item exits the list when you press Enter. Bullets and numbers change style by level (1. a. i.). You can choose letters, roman numerals or another bullet, and restart a list or start it at any number. See [Lists](/documents/features/lists/).
