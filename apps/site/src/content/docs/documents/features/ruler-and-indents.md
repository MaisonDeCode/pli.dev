---
title: Ruler and indents
description: Set page margins and paragraph indents by dragging the ruler, or exactly in the Paragraph dialog.
---

## The ruler

The ruler runs across the top of the page in **inches from the left margin**, with the margins shaded at both ends. It stays in view as you scroll, lines up with the page at any zoom, and shows in the pages view. Turn it off in **View > Show ruler**, or pass `ruler={false}` to `PliDocument`.

### Margins

Drag the bar at the edge of a shaded area to change the **left** or **right margin**. A dashed line shows where it will land and the page reflows as you drag. Margins snap to sixteenths of an inch, can't pass 5 inches, and always leave the text at least 2 inches wide. One drag is one undo step.

### Paragraph indents

Click in a paragraph, and three markers show where its indents are:

| Marker | Moves |
|--------|-------|
| Top, pointing down | The **first line** only. Drag it right for a first-line indent, or left of the left marker for a hanging indent |
| Bottom left, pointing up | The **left indent** of the whole paragraph. The first line moves with it |
| Bottom right, pointing up | The **right indent**, in from the right margin |

Indents apply to every paragraph in the selection and snap to sixteenths of an inch. The first line can't go past the left margin.

The markers are hidden for a list item (use the indent buttons, which change its level), the title and subtitle, code blocks, and while the caret is in a table cell. In a header or footer, the ruler works on the header or footer you are editing.

### With the keyboard

Each marker can be focused with Tab. **Left** and **Right** arrows move it by a sixteenth of an inch, and **Shift** with an arrow by half an inch. Screen readers announce it as a slider with its position in inches.

## Indent buttons

- **Increase indent** and **Decrease indent** in the toolbar, **Format > Align and indent**, or **Ctrl+]** and **Ctrl+[** (**Cmd** on a Mac).
- On a list item they change its level, as before.
- On a paragraph, heading or quote they move it **half an inch** in or back, up to 10 inches. Decrease does nothing at the margin.

`Tab` and `Shift+Tab` still change list levels only, so they never trap keyboard focus in an ordinary paragraph.

## The Paragraph dialog

**Format > Align and indent > Paragraph options…** sets exact values for the selected paragraphs:

- **Indentation** (inches): left, right, and a special indent of **First line** or **Hanging** by an amount. A hanging indent pushes the left indent out far enough that the first line stays inside the margin.
- **Spacing**: points before and after the paragraph, and line spacing as a multiple.

Leave a spacing box empty to use the default. **Reset** clears the dialog.

## From code

```ts
session.setParagraphFormat({ indentLeft: 36, indentFirst: -18 }); // points; a hanging indent
session.setParagraphFormat({ indentRight: 24 });
session.setParagraphFormat({ indentLeft: null }); // remove
session.indent();   // half an inch for paragraphs, one level for list items
session.outdent();
session.setPage({ ...page, margins: { ...page.margins, left: 1.5 } });
```

All lengths in a paragraph's `format` are in points, and page margins are in inches. A right indent is saved as `format.indentRight`.

## In exports

| Format | Left, right and first-line indents |
|--------|-------------------------------------|
| DOCX | Real paragraph indents: `w:left`, `w:right`, `w:firstLine` and `w:hanging` |
| HTML | `margin-left`, `margin-right` and `text-indent` |
| Markdown | Not included, since the format has no indents |

In a document with sections, the ruler shows the margins of the section at the caret and changes only that section's (see [Columns and sections](/documents/features/columns-and-sections/)).

## Not supported yet

- A **vertical ruler** for the top and bottom margins. Use **File > Page setup** for those.
- **Tab stops** on the ruler.
- Indent markers inside table cells.
- Pasting keeps the look of the destination, so indents from other editors are not imported.
