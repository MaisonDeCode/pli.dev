---
title: Get started
description: Make a workbook, put values and formulas in cells, read the results, and undo changes, with the headless engine.
---

Install the engine and the React grid editor:

```sh
npm install @pli.dev/sheets @pli.dev/sheets-react
```

With pnpm, Yarn or Bun, use `pnpm add`, `yarn add` or `bun add` and the same names. The editor needs `react` and `react-dom` 18 or 19 in your app. Its stylesheet already includes the shared toolbar and menu styles from `@pli.dev/react`. The engine has no peer dependencies. Both packages are ESM and ship their own TypeScript types; [Releases and versioning](/platform/contributing/releases/) has the rest.

This page uses the headless engine: the workbook, formulas, history, and CSV and XLSX files, with no screen. The React grid editor is covered in [The grid editor](/sheets/grid/).

```ts
import { SheetSession, createWorkbook } from "@pli.dev/sheets";

const s = new SheetSession(createWorkbook("Budget"));          // one empty sheet, Sheet1

s.setValues("Sheet1", "A1", [
  ["Item", "Cost"],
  ["Pens", 12.5],
  ["Paper", 8],
  ["Total", "=SUM(B2:B3)"],                                     // text starting with = is a formula
]);
s.setFormat("Sheet1", "B2:B4", "$#,##0.00");
s.setStyle("Sheet1", "A1:B1", { bold: true });

s.value("Sheet1", "B4");                                        // 20.5
s.display("Sheet1", "B4");                                      // { text: "$20.50" }
s.setCell("Sheet1", "B2", 15);
s.value("Sheet1", "B4");                                        // 23
s.undo();                                                       // back to 12.5
```

## Typing into cells

`setCell` and `setCells` read what you give them the way Excel reads what someone types: `=SUM(A1:A3)` is a formula, `12%` a percentage, `3/5/2024` a date, `'123` the text 123. Numbers, booleans and `null` (empty the cell) are stored as they are. A cell keeps its format and style when its content changes.

## Editing

Every change is an operation on the session, so it can be undone, logged and sent. Each method below is one undo step:

| | |
|---|---|
| `setCell`, `setCells`, `setValues` | Put values or formulas in cells |
| `clear(sheet, range, "all" / "contents" / "formats")` | Empty cells |
| `setFormat`, `setStyle` | Number format and style of a range |
| `copy(from, to)`, `fill(sheet, range, "down" / "right")`, `autofill(sheet, source, target)` | Copy cells; formulas shift like Excel's paste and fill. `autofill` is the fill handle: number series continue and "Item 1" counts up |
| `move(from, to)` | Move cells (cut and paste, or dragging): formulas anywhere that pointed at them follow. `copy` and `move` take merged cells, conditional formats and data validation along |
| `toHtml(sheet, range)`, `pasteHtml(sheet, at, html, options)`, `parseHtmlTable(html)` | A range as a styled HTML table (with bars, icons, diagonal borders, sizes and whole tables marked), and an HTML table from Excel, Google Sheets or a web page pasted with its look, formulas, sizes and tables. `options`: `content` (`all`, `values`, `formulas`, `formats`), `widths`, `asRange`, `source`, `notes`. `copy` takes the same options |
| `sort(sheet, range, { by, descending, header })` | Sort rows, with formulas going along |
| `insertRows`, `deleteRows`, `insertColumns`, `deleteColumns` | Formulas that point at them follow; ones that pointed at deleted cells become `#REF!` |
| `setColumnWidth`, `setRowHeight`, `setFrozen` | Sizes and frozen panes |
| `addSheet`, `renameSheet`, `deleteSheet`, `moveSheet` | Sheets; formulas follow a rename and break on a delete |
| `defineName("Rate", "Sheet1!$B$1")` | A name to use in formulas |
| `currentRegion(sheet, "B3")`, `setFilter(sheet, range \| null)`, `filterColumn(sheet, col, values \| null)`, `filterValues`, `reapplyFilter`; `filterColumnRule(sheet, col, rule \| null)`, `filterTableRule`, `filterColors` for [filters by condition](/sheets/grid/#filters-by-condition) | Find the table around a cell, filter it by a list of values (the other rows are hidden), and read the values a column has |
| `find({ text, matchCase, wholeCell, regex, lookIn, scope, by })`, `replace(options, replacement, only?)` | Cells that have some text (as shown, as typed, or in their notes), and replacing it in all of them or some, as one undo step. See [Find and replace](/sheets/grid/#find-and-replace) |
| `saveFilterView(sheet, name, { sort }?)`, `filterViews`, `updateFilterView`, `renameFilterView`, `deleteFilterView`, `filterViewRows`, `applyFilterView`, `canSaveFilterView` ([filter views](/sheets/grid/#filter-views)) | Save the sheet's filter, and the filters and sorts of its tables, under a name (kept in XLSX files as Excel's named sheet views), see which rows a view hides without changing the sheet, and make a view the sheet's filter for everyone |
| `setLink(sheet, range, { to, tip? } \| null, { text? })`, `link(sheet, "A1")`, `linkPlace(sheet, "#Other!B4")` | Make cells links to a web address or a place in the workbook, and read where a cell leads (`HYPERLINK` formulas count). See [Links and notes](/sheets/grid/#links-and-notes) |
| `setNote(sheet, "A1", text \| null, { runs, author, box })`, `note`, `noteInfo`, `notes(sheet)`, `formatNote`, `setNoteBox`, `setNoteLook`, `showNote`, `showAllNotes` | Notes on cells, with a look, links in the text, an author and a box with a fill, picture and line |
| `addImage(sheet, { src, from?, width?, height?, alt? })`, `updateImage`, `fitImage(sheet, id, range)`, `reorderImage`, `deleteImage`, `images(sheet)` | Pictures over the grid: PNG, JPEG or GIF as a `data:` URI (`toDataUri(bytes, "png")`). See [Pictures](/sheets/grid/#pictures) |
| `protectSheet(sheet, { password?, allow? })`, `unprotectSheet(sheet, password?)`, `protectWorkbook`, `unprotectWorkbook`, `isProtected`, `isLocked`, `canEdit`, `can`, `formulaHidden`, `bypassProtection(fn)` | Lock cells (`setStyle(range, { locked: false })` unlocks them) and protect a sheet or the workbook's structure; every change is checked, and a refused one throws `ProtectionError`. See [Protection](/sheets/grid/#protection) |
| `setPageSetup(sheet, patch)`, `pageSetup`, `setPrintArea`, `setPrintTitles`, `printTitles`, `setPageBreak`, `clearPageBreaks`, `printLayout(sheet)`, `printPage(sheet, page)` | How a sheet prints, and the pages it comes out on, with each page as an HTML table. See [Printing](/sheets/grid/#printing) |
| `subtotal(sheet, range, { by, fn, columns, replace, pageBreaks, summaryBelow, grandTotal, sort, convertTable })`, `removeSubtotals`, `subtotalRows` | Excel's Data > Subtotal: rows of `SUBTOTAL` formulas with groups; it can sort the list first and turn a table into a range. See [Subtotals](/sheets/grid/#subtotals) |
| `setTableTotalsFunction(table, column, fn)`, `tableTotals(table)`, `followLink(sheet, address)` | A table's totals row function per column (`SUBTOTAL(101…111, …)`), and noting that a link was followed (it takes the theme's followed-hyperlink colour). See [Subtotals](/sheets/grid/#subtotals) and [Links and notes](/sheets/grid/#links-and-notes) |
| `groupRows`, `groupColumns`, `ungroupRows`, `ungroupColumns`, `toggleGroup(sheet, axis, index)`, `showLevel`, `outlineGroups`, `outlineDepth`, `setOutlineSummary` | Groups of rows and columns, which fold away under their summary. See [Groups](/sheets/grid/#groups) |
| `createPivot(sheet, { source, anchor, rows, columns, values, filters, calculated, tabular, outline, valuesOnRows })`, `updatePivot`, `refreshPivot`, `refreshAllPivots`, `deletePivot`, `pivots`, `pivotAt`, `pivotFields`, `pivotFieldItems` | Pivot tables over a range or table, with sorting by value, top items, grouping, calculated fields and `GETPIVOTDATA`. See [Pivot tables](/sheets/pivot-tables/) |
| `addSparklines(sheet, { type, location, data, … })`, `updateSparklines`, `deleteSparklines`, `clearSparklines`, `sparklines`, `sparklineAt`, `sparklineValues`, `sparklineShape` | Line, column and win/loss charts in cells. See [Sparklines](/sheets/grid/#sparklines) |
| `batch(() => { … })` | Several edits as one undo step |
| `setControl(sheet, range, control \| null)`, `toggleCheckbox`, `pickChoice(sheet, "D2", value)` | Make cells checkboxes, dropdowns or badges; tick a box; choose a value (several can be kept in one cell). Values a checkbox or strict dropdown doesn't allow are refused when typed |

For anything else, `session.transact([...ops])` takes the JSON operations directly (`SheetOp`).

## Reading

`value(sheet, "B4")` is what a cell is worth, `values(sheet, "A1:B4")` a block of them, `display` the text with the number format applied, `cell` the cell as stored (the formula, not the result), and `usedRange` where the sheet has anything. Sheets are named by their name (any capitals) or id. Values are numbers, text, booleans, `null` for an empty cell, or an error `{ error: "#DIV/0!" }` (check with `isError`).

```ts
s.subscribe((event) => { /* event.ops, event.origin: "local" | "undo" | "redo" | "remote" */ });
```

[Formulas](/sheets/formulas/) lists the functions. [Files and formats](/sheets/files/) covers saving and CSV and Excel files.
