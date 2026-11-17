---
title: Selection and commands
description: How user actions like typing, Enter and Backspace become operations.
---

[Operations](/documents/concepts/operations/) say *what changed*. **Commands** decide *what to change* for something a user did, such as pressing Enter with the caret in the middle of a paragraph. An editor UI translates input events into commands.

## Selection

A selection is two points. Each point is a block id and a UTF-16 offset into that block's text.

```ts
interface Point { block: string; offset: number }
interface Selection { anchor: Point; focus: Point }  // anchor = where it started
```

A collapsed selection (`anchor` equals `focus`) is a caret. A selection dragged backwards is fine: commands order the two ends themselves. `DocumentSession` keeps the current selection, clamps it whenever the document changes, and emits `onSelectionChange`.

```ts
import { DocumentSession, caret } from "@pli.dev/docs";

session.select(caret(block.id, 5));
session.onSelectionChange((sel) => updateToolbar(sel));
```

## Built-in commands

Each is a method on `DocumentSession` that acts on the current selection and returns `false` if there was nothing to do.

| Method | Behavior |
|--------|----------|
| `typeText(text)` | Types at the caret, replacing any selection. New text inherits the formatting before it. Typing inside a link extends it; typing at its edge does not. |
| `splitBlock()` | Enter. Splits the block. At the end of a heading it starts a paragraph. An empty list item or quote exits. In a code block it adds a line break. |
| `backspace()` | Deletes the previous character (an emoji counts as one). At the start of a list item it outdents, at the start of a heading or quote it becomes a paragraph, and at the start of a paragraph it merges into the block above. |
| `deleteForward()` | The mirror of `backspace`: pulls the next block up at the end of a block. |
| `deleteSelection()` | Deletes the range, merging the last block into the first. Dividers inside the range are removed. The document is never left empty. |
| `toggleMark(mark)` | Bold, italic, underline, strike or code across the selection. If all of it already has the mark, it is removed. With only a caret, it sets the formatting for the next typed text instead. |
| `pastePlainText(text)` | Inserts text, with line breaks becoming new blocks, as one undo step. |
| `paste({ fragment, html, text, plain })` | Pastes what a clipboard offered, keeping formatting and tables. See [Copy and paste](/documents/features/copy-and-paste/). |
| `setMarks(patch)` | Set values such as `{ color: "#d33", fontSize: 14 }`, or remove one with `null`. With a caret, applies to the next typed text. |
| `setLink(url, text?)` | Link the selection, or insert `text` as a link at a caret. `null` removes the link. |
| `clearFormatting()` | Remove character formatting (links stay) and paragraph alignment and spacing. |
| `setParagraphFormat(patch)` | Line height, space before and after, and indents of the selected paragraphs. |
| `insertBlockAtCaret(block)` | Insert an image, page break, divider or table of contents. A paragraph is added below if none follows. |
| `insertField("page" \| "pages")` | Insert a page-number field. |
| `updateBlock(id, patch)` | Change a block's properties, such as an image's size. |
| `setBlockType(spec)` / `toggleBlockType(spec)` | Convert selected blocks to a paragraph, heading, quote, code block or list item, keeping their text. |
| `indent()` / `outdent()` | Change list depth. An item can't go more than one level below the item above it. Outdenting a top-level item makes it a paragraph. |
| `setAlign(align)` | Align selected paragraphs and headings. |

## Undo restores the selection

Each command is one undo step, and the history remembers the selection from before and after it. Undo puts the caret back where it was, even if the user clicked elsewhere in between.

**Typing is grouped.** Consecutive `typeText`, `backspace` or `deleteForward` calls in the same place, less than a second apart, join one undo step, so a burst of typing undoes at once rather than one character at a time. Moving the caret, pausing, or running any other command starts a new step.

## Block-level commands and selection edges

A selection that ends at the very start of a block (what a triple-click or Shift+Down produces) does not include that block for block-level commands such as `setBlockType`, `setAlign` and `indent`. Nothing in it is selected, so it is left alone.

## Tables

Blocks inside table cells are part of the document like any other, and a selection can start or end in a cell. When it starts in one cell and ends in a different cell of the same table, it means a **rectangle of cells** (`cellRect(doc, selection)`), not the text between the two points. The rectangle grows to take in any merged cell it touches, whole. Formatting, alignment and shading apply to every cell in it, and deleting clears them.

| Method | Behavior |
|--------|----------|
| `insertTable(rows, columns, options?)` | Insert a table at the caret and put the caret in its first cell. |
| `addRow("above" \| "below")`, `addColumn("left" \| "right")` | Insert next to the selected row or column. |
| `deleteRow()`, `deleteColumn()`, `deleteTable()` | Delete the selected rows or columns, or the table. |
| `mergeCells()`, `splitCells()` | Merge the cells a drag covers, or split merged cells. |
| `setHeaderRow(on)`, `setTableBorders(mode)` | Table-wide properties. |
| `setRowHeight(points)`, `setCellVerticalAlign(align)` | Minimum row height, and where content sits in the cell. |
| `setCellShade(color \| null)` | Background of the selected cells. |
| `setColumnWidths(widths)` | Column widths as a ratio. |
| `moveToCell(1 \| -1)` | Tab and Shift+Tab. Past the last cell, adds a row. |

Commands treat each cell as its own list of blocks: Backspace and Delete never join across a cell's edge, and Enter stays in the cell.

## Find and replace

`findAll(doc, "text", { matchCase, wholeWord })` returns matches, and `replaceMatches(matches, "new")` is a command that replaces them as one undo step, keeping the formatting of the text it replaces.

```ts
import { findAll, replaceMatches } from "@pli.dev/docs";

session.exec(replaceMatches(findAll(session.state, "colour", { wholeWord: true }), "color"));
```

## Reading the selection

`selectionState(doc, selection, pending)` tells a UI which formatting applies, for example to show a toolbar button as pressed: active marks, the font, size, color and link (each with a `mixed` flag when the selection differs), the block type, alignment, paragraph spacing, and the selected image. In React, use the `useSelectionState` hook.

## Writing your own command

A command is a pure function from the document and selection to operations plus the new selection. Return `null` to do nothing.

```ts
import type { Command } from "@pli.dev/docs";
import { caret } from "@pli.dev/docs";

const insertDate: Command = (doc, sel) => {
  const date = new Date().toDateString();
  const { block, offset } = sel.focus;
  return {
    ops: [{ type: "insert_text", block, offset, runs: [{ text: date }] }],
    selection: caret(block, offset + date.length),
  };
};

session.exec(insertDate);
```

[Pli Scripts](/platform/scripting/) use the same path, so anything a script does is undoable and checked like any other edit.

## Limitations

- Deleting by character treats emoji as single characters, but not every multi-part grapheme (for example flag or family emoji built from several code points). A UI that needs exact grapheme movement should compute offsets itself and pass them in as a selection.
- The pending format for the next character is dropped when the selection moves. It isn't stored in the document.
