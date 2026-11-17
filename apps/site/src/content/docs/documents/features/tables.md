---
title: Tables
description: Insert tables, edit in cells, select, resize, and how long tables break across pages.
---

## Adding a table

- **Insert > Table** or the table button in the toolbar. Hover the grid to pick a size, or choose **Custom size…** for a bigger one.
- From code: `session.insertTable(rows, columns, { headerRow: true })`.

The caret lands in the first cell. A paragraph is kept below the table so there is always somewhere to keep typing.

```ts
import { table, bold } from "@pli.dev/docs";

const prices = table(
  [
    ["Plan", "Price"],
    [[bold("Team")], "$12 / seat"],
  ],
  { headerRow: true, columns: [3, 1] }, // column widths, as a ratio
);
session.insertBlockAtCaret(prices);
```

## Editing in cells

A cell is a small document. It holds paragraphs, headings, lists, quotes, code and images, and everything in the toolbar works inside it.

| Key | In a table |
|-----|------------|
| `Tab`, `Shift+Tab` | Next and previous cell. `Tab` in the last cell adds a row |
| `Enter` | A new paragraph in the same cell |
| `Backspace`, `Delete` | Never join across the edge of a cell, and never reach into a table from outside |

Tables don't nest, and page breaks and tables of contents don't go in a cell.

## Selecting

- **Drag from one cell to another** to select a rectangle of cells. They are highlighted. Formatting, alignment and shading apply to all of them, **Delete** clears them, and typing replaces the first cell's contents.
- **Copy** from a rectangle gives tab-separated text, so it pastes into a spreadsheet, and a table of just those cells, so it pastes into another table or document. See [Copy and paste](/documents/features/copy-and-paste/).
- **The grip** at the top-left corner of a table (it appears when you hover) selects the whole table. Then **Backspace** or **Delete** removes it, or use **Format > Table > Delete table**.
- A selection that runs from text outside a table into it deletes the selected text and clears the cells it covers, but keeps the table. A selection that covers a table completely removes it.

## Merging and splitting cells

Drag across two or more cells, then use **Merge cells** in the table menu or the toolbar. The contents are joined, in reading order, in the merged cell (empty cells add nothing). **Split cell** puts it back into single cells, with the text left in the first one.

- A drag that touches part of a merged cell takes in the whole cell, so you can't cut one in half by accident.
- **Tab** treats a merged cell as one cell and skips the squares under it.
- Add a row inside a vertical merge and the merge grows to cover it. Delete a row or column a merge covers and the merge shrinks. If you delete the row a merged cell starts in, the cell moves down into the next row, with its content.
- With the caret in a merged cell, row and column commands (add, delete) act on every row or column the cell covers.

```ts
session.select({ anchor: { block: a, offset: 0 }, focus: { block: b, offset: 0 } }); // inside two cells
session.mergeCells();
session.splitCells();
```

## Row height and vertical alignment

- **Row height:** drag the bottom edge of a row, or choose **Table > Row height** (preset sizes, or **Custom…** for an exact value in points). It is a minimum: a row is always tall enough for its content, and **Fit content** removes it. `session.setRowHeight(36)`.
- **Vertical alignment:** **Table > Vertical alignment** puts the content at the top, middle or bottom of the cell. `session.setCellVerticalAlign("middle")`.

## Rows, columns and the table menu

When the caret is in a table the toolbar shows a **Table** menu and a cell shading button. The same commands are under **Format > Table**.

| | Session method |
|---|---|
| Insert row above, below | `addRow("above" \| "below")` |
| Insert column left, right | `addColumn("left" \| "right")` |
| Delete row, column, table | `deleteRow()`, `deleteColumn()`, `deleteTable()` |
| Merge, split | `mergeCells()`, `splitCells()` |
| Row height, vertical alignment | `setRowHeight(points \| null)`, `setCellVerticalAlign("top" \| "middle" \| "bottom")` |
| Header row | `setHeaderRow(true)` |
| Borders: all, horizontal lines only, none | `setTableBorders("all" \| "horizontal" \| "none")` |
| Shade the selected cells | `setCellShade("#fef3c7")`, or `null` to clear |
| Column widths | `setColumnWidths([2, 1, 1])` |

With several rows or columns selected, delete removes all of them. Deleting every row or every column removes the table. Each of these is one undo step.

**Column widths** are stored as fractions of the table width, so a table keeps its proportions if you change the page size or margins. Drag a column border to resize it. A column can't be dragged below 5% of the table.

## Long tables across pages

Tables are laid out one **row at a time**. A row that doesn't fit at the bottom of a page moves to the next one, together with a copy of the header row if the table has one, so each page of a long table is labelled. The header row also stays with the row after it, and is never left alone at the bottom of a page.

Rows joined by a merged cell move **together**, because a page break would cut the merged cell in two. A single row (or a group of merged rows) taller than a page overflows rather than being cut. The header row is only repeated when it is a single row.

See [Pages and layout](/documents/features/pages-and-layout/).

## In exports

| Format | Result |
|--------|--------|
| DOCX | A native table: fixed column grid sized to the page's text width, merged cells (`gridSpan` and `vMerge`), row heights, vertical alignment, shading, borders, a header row that repeats on each page, and lists and images in cells |
| HTML | A `<table>` with a `<colgroup>`, `colspan` and `rowspan`, `<th>` header cells, row heights, vertical alignment, shading and borders |
| Markdown | A GitHub-flavoured table. That format has no merged cells, so a merged cell's text sits in its first square and the squares it covers are left empty. It also has no way to mark a header, so the first row is always the header. Several blocks in one cell are joined with line breaks, pipes are escaped, and shading, widths, heights and borders are dropped |

## Not supported yet

- Nested tables.
- Splitting a tall row, or a group of merged rows, across two pages.
- Repeating a header that is more than one row tall.
- Sorting, formulas and filters. Those belong to Pli Sheets.
