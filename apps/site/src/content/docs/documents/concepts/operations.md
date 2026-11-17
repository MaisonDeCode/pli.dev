---
title: Operations
description: The JSON operations that describe every change to a document.
---

A document is never edited in place. Every change is an operation, applied by `docReducer`, which returns a new document and the operation that undoes it.

## Document operations

| `type` | Fields | Effect |
|--------|--------|--------|
| `insert_block` | `block`, `after`, `cell?` | Insert after the block with id `after`, in the same list as that block (so inside a table cell if it is in one). With `after: null`, at the start of the document, or at the start of the cell `cell`. |
| `delete_block` | `id` | Remove a block. |
| `update_block` | `id`, `patch` | Change properties of a block and leave its text alone: `{ type: "heading", level: 2 }`, `{ align: null }` to remove one. `id` and `runs` can't be patched. |
| `replace_block` | `id`, `block` | Swap a block for another with the same id. A session tells this as finer operations first (below). |
| `insert_text` | `block`, `offset`, `runs` | Insert styled runs at a text offset. |
| `delete_text` | `block`, `from`, `to` | Delete a range of text. |
| `format_text` | `block`, `from`, `to`, `patch` | Set marks on a range. A `null` value removes a mark. |
| `restore_marks` | `block`, `from`, `to`, `segments` | Put the marks across a range back exactly as `segments` (`{ length, marks? }`) give them. The inverse of `format_text`. |
| `set_runs` | `block`, `runs` | Replace all runs of a block. For code that applies operations directly; sessions never produce it. |
| `comment_text` | `block`, `from`, `to`, `id`, `on` | Attach a comment thread to a range of text (`on: true`), or take it off. |
| `set_title` | `title` | Rename the document. |
| `set_page` | `page` | Set page size, orientation and margins. `null` restores the default. |
| `set_region` | `region`, `blocks` | Replace the header or footer. `null` removes it. |
| `set_footnote` | `id`, `blocks` | Set the text of a footnote. `null` removes it. |
| `set_thread` | `id`, `thread` | Set a comment thread saved in the document. `null` removes it. |
| `set_style` | `id`, `style` | Define or change a [named style](/documents/features/styles/). `null` removes it. |

Blocks are addressed by id rather than by index, so an operation stays valid when other blocks are inserted or removed around it. Ids are found wherever a block is, including inside table cells, so the same operations edit text in a cell as anywhere else.

A table's structure (adding a row, resizing columns, shading a cell) is changed by replacing the table's `rows` or `columns` as a whole, with `update_block`. Its inverse is the previous value, so each structural edit is one undo step. A table cell always has at least one block: removing the last one leaves an empty paragraph in its place (with an id made from the cell's, so people who do this at the same moment end with the same document). The commands never do it. The one exception is a *covered* cell: every row has one cell per column, and the squares hidden under a merged cell hold empty placeholders (`covered: true`), so the grid stays regular.

## Operations that leave other people's edits alone

Commands such as "turn into heading", "indent" or "bold" describe their result as a whole block, but a session applies them as the **smallest operations that make the change**: `update_block` for properties, `restore_marks` for formatting, and text operations for text. `canonicalOps(doc, ops)` does this translation, and `diffBlock(doc, id, block)` does it for one block. The same goes for the inverses that undo records: undoing bold on a word puts back that word's marks, not a copy of the whole paragraph.

`delete_block` and `update_block` can also carry **hints** (`after`, `cell`, `within`) that record where a block was and what was in it, so that the operation can be merged with someone else's edits without looking at the document. Sessions fill them in; applying an operation ignores them. See [Live co-editing](/platform/co-editing/).

This matters when more than one person edits. A snapshot would overwrite what someone else typed in the same block in the meantime.

## Why JSON operations

- History comes from recording each operation's inverse.
- `transact` applies several operations as one undo step, and rolls everything back if one fails.
- An operation is plain JSON, so it can be logged, sent to a server, or produced by a user script.
- A shared operation log is the usual base for real-time sync. [Live editing](/platform/live-editing/) is built on it. Changes that come from other people are applied with the `remote` origin, which keeps them out of your undo history.

## Text model

Text lives in **runs**: `{ text, marks? }`. Adjacent runs with identical marks are always merged, so the same content has one representation. Offsets are UTF-16 code units, the same as JavaScript string indices.

Marks: `bold`, `italic`, `underline`, `strike`, `code`, `superscript`, `subscript`, `link`, `color`, `highlight`, `fontFamily`, `fontSize` (points), and `field` (`"page"` or `"pages"`, for page numbers in headers and footers).

## Blocks

| Type | Holds | Notes |
|------|-------|-------|
| `paragraph`, `title`, `subtitle`, `quote` | text | |
| `heading` | text | `level` 1 to 6. Headings feed the table of contents |
| `list_item` | text | `list` is `bullet` or `ordered`, with a `depth` |
| `code_block` | plain text | Formatting is ignored |
| `image` | nothing | `src`, `width`, `height`, `alt`, `align` |
| `toc` | nothing | `levels`, optional `title`. Generated from the headings |
| `page_break`, `divider` | nothing | |
| `table` | cells | `rows` of `cells`, each holding `blocks` (and optionally `colSpan`, `rowSpan`, `vAlign`, `shade`), a row `height`, plus `columns` (width fractions), `headerRow` and `borders`. See [Tables](/documents/features/tables/) |

Paragraphs, headings, titles, quotes and list items can also carry `align` and a `format` of spacing and indents (`lineHeight`, `spaceBefore`, `spaceAfter`, `indentLeft`, `indentFirst`).
