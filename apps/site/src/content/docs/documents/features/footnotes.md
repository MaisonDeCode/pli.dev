---
title: Footnotes
description: Numbered notes that sit at the bottom of the page that cites them, edited in place, with DOCX, Markdown and HTML export.
---

A footnote is a small number in the text and a note at the bottom of the same page. Numbers are worked out from where the references are, so they stay right as you add, move and delete text.

## Adding one

- **Insert > Footnote**, or **Ctrl+Alt+F** (**Cmd+Option+F** on a Mac).
- A reference appears at the caret (a selection is replaced), and the note opens at the bottom of the page, ready to type in.
- Click **Done**, press **Esc**, or click back into the text to finish.

To change a note later, **double-click it** at the bottom of the page, or double-click its number in the text. Notes are plain text with character formatting, links, lists and several paragraphs. They can't hold images, tables, headings or other notes, and a footnote can't be added in a header, footer or code block.

## How they lay out

- The notes for the references on a page sit at the bottom of that page, above the footer, under a short rule.
- Room is taken from the page's text for them, so text and notes never overlap. A longer note leaves less room for text, and the text above reflows as you type it.
- If a reference moves to the next page, its note goes with it.
- In the **pageless** view, the notes follow the text, in order.
- **Header and footer** text can't carry footnotes. A note is kept on one page, and one taller than a page is cut off.

## Copying, deleting and undo

- **Copy and paste** take the notes along. The pasted text gets copies of its notes, so editing one never changes the other.
- Deleting a reference removes its note from view. Undo brings both back. Notes nothing refers to are dropped when the document is saved.
- Adding a footnote is one undo step; editing a note is one more, when you finish.

## In exports

| Format | Footnotes |
|--------|-----------|
| DOCX | Native footnotes: numbered references, notes at the bottom of the page, with separators and the *Footnote Text* and *Footnote Reference* styles. Links in a note are kept |
| HTML | Numbered references that link to a list of notes at the end, each with a link back |
| Markdown | GitHub-style: `[^1]` in the text and `[^1]: …` definitions at the end. Further paragraphs of a note are indented under it |
| Plain text copy | The reference is left out |

HTML and print can't place notes at the bottom of each page, because browsers don't support it, so they come at the end.

## From code

```ts
const id = session.insertFootnote([paragraph("See the 2025 field study.")]); // at the caret; returns the note's id
session.setFootnote(id, [paragraph("Updated text.")]);
session.setFootnote(id, null); // remove the note (its reference stays, so remove that too)
```

In the document, a reference is a run holding one zero-width character with the `footnote` mark set to the note's id, and the text of each note is in `doc.footnotes[id]`. `footnoteIds(doc.blocks)` lists the notes in reading order and `footnoteNumbers(doc)` gives each its number. `validateDoc` rejects a reference whose note is missing, and a note that holds something other than paragraphs, quotes, list items or code.

## Not supported yet

- Endnotes, and choosing the number style (roman numerals, symbols).
- Restarting the numbering on each page or section.
- A note that continues onto the next page when it is too long for one.
- Footnotes pasted from other editors. A pasted `<sup>` stays text.
- Editing a note in the pageless view. Switch to pages to change one.
