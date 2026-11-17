---
title: Styles
description: Named paragraph and character styles that give many paragraphs or pieces of text one look, change in one place, and export as real DOCX styles.
---

A style is a name for a look. Make a style called **Note** once, apply it to a dozen paragraphs, then change the style, and all dozen change. The text itself holds only the name.

There are two kinds:

| | What it sets | Applies to |
|---|---|---|
| **Paragraph style** | Alignment, line spacing, space before and after, indents, and the text's font, size, color, bold, italic, underline, strikethrough and highlight | Whole paragraphs, headings, quotes and list items |
| **Character style** | The text's font, size, color, bold, italic, underline, strikethrough and highlight | A run of text inside a paragraph |

## Using them

- The **style box** in the toolbar lists the built-in styles (Normal text, Title, Headings, Quote, Code block) and, under **Your styles**, the document's own. Picking one applies it to the selected paragraphs.
- **Format > Your styles** lists the paragraph styles and, marked "(text)", the character styles. A character style is applied to the selected text, or to the next characters typed if only the caret is set, and chosen again to take it off.
- **Format > Your styles > New paragraph style from selection…** (or **New character style…**) asks for a name and makes a style that looks like what you selected, then applies it. The formatting it took is removed from the text itself, so the style is what holds it and changing the style changes every use.
- **Update “Note” to match** makes the style look like the current selection, for everything that uses it.
- **Manage styles…** renames styles, chooses what each is **based on**, and deletes them.

Applying a paragraph style clears that paragraph's own alignment and spacing so the style shows. The formatting of the text inside it (a bold word) stays. **Clear formatting** takes the style off as well. Enter in a styled paragraph continues the style, and picking a built-in style from the style box takes the custom one off. Making a paragraph a list item keeps its style.

## What wins

From weakest to strongest: the block's own type (a heading is large), its paragraph style, a character style on the text, and what is set on the text itself. A style based on another starts from it and only says what differs. To undo a style's bold on some text, set that text to not bold.

## What a style looks like

```ts
const doc = {
  // …
  styles: {
    note: {
      name: "Note",
      kind: "paragraph",
      marks: { italic: true, color: "#1d4ed8" },
      format: { spaceBefore: 6, spaceAfter: 12, indentLeft: 18 },
    },
    key: { name: "Key term", kind: "character", marks: { bold: true, color: "#be185d" } },
    warning: { name: "Warning", kind: "paragraph", basedOn: "note", marks: { color: "#b91c1c" }, align: "center" },
  },
  blocks: [
    { id: "b1", type: "paragraph", style: "note", runs: [{ text: "See the " }, { text: "docs", marks: { style: "key" } }] },
  ],
};
```

Paragraph blocks, headings, titles, subtitles, quotes and list items have a `style`. A run's `marks.style` names a character style. A name with no style behind it just looks plain, and deleting a style takes it off everything that used it.

## From code

```ts
session.createStyle("Note", "paragraph");        // from the selection; returns the new id, or null
session.applyParagraphStyle("note");              // null takes it off
session.applyCharacterStyle("key");               // for the next characters at a caret
session.updateStyleFromSelection("note");
session.changeStyle("note", { name: "Aside" });   // rename, rebase or change the look
session.setStyle("callout", { name: "Callout", kind: "paragraph", marks: { bold: true } });
session.deleteStyle("note");                      // also removes it from the text

import { resolveStyle, effectiveMarks, styleList } from "@pli.dev/docs";
resolveStyle(session.state, "warning");           // the look once the base is taken in
```

Each of these is one undo step, and `set_style` is one of the [operations](/documents/concepts/operations/), so styles sync live like the rest of the document. If two people change the same style at once, the later change wins. If one changes a style's look and another applies it, both happen.

## Copy and paste

Copying text puts the styles it uses (and the ones they are based on) on the clipboard with it. Pasting into another document adds the ones it doesn't have. Where the destination already has a style with the same id, its own wins.

## In exports

| Format | What is written |
|--------|-----------------|
| HTML | The look as inline CSS, so the output is right anywhere, and a `data-style` attribute on each styled block for your own CSS |
| DOCX | Real styles in the file: paragraph styles and character styles that can be edited there, with their bases. A paragraph in a style uses it. A heading, title, quote or list item keeps its own DOCX style and takes the custom look as direct formatting |
| Markdown | Not included, since the format has no styles |

## Limits

- The toolbar's bold, italic and color buttons show what is set on the text itself, not what a style gives it.
- Styles can't set a font for a whole heading level yet. Headings use the built-in look, plus any custom style you apply to them.
- Styles in headers, footers and footnotes are used but can't be made or managed while editing them.
- There is no "next style" setting. Enter continues the style of the paragraph.
