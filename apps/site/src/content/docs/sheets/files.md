---
title: Files and formats
description: Save a workbook as JSON, read and write CSV and Excel (XLSX) files, and the number formats cells use.
---

## Saving

A workbook is plain JSON, like a Pli document:

```ts
import { parseWorkbook, serializeWorkbook } from "@pli.dev/sheets";

const text = serializeWorkbook(session.state);        // { "format": "pli.sheet", "version": 1, … }
const workbook = parseWorkbook(text);                // checks it and names the place of a mistake
```

Cells are stored by address and only when they hold something, so an empty sheet costs nothing:

```json
{ "id": "sheet_1", "name": "Budget", "cells": {
    "A1": { "v": "Item", "s": { "bold": true } },
    "B2": { "v": 12.5, "fmt": "$#,##0.00" },
    "B4": { "f": "SUM(B2:B3)", "fmt": "$#,##0.00" } },
  "columns": { "A": { "size": 18 } }, "frozen": { "rows": 1, "cols": 0 },
  "filter": { "range": "A1:B20", "columns": { "B": ["Furniture"] } } }
```

A sheet can have a `filter`: the range (first row the headings) and, for filtered columns, the values let through as the cells show them, or a rule (see [Filters by condition](/sheets/grid/#filters-by-condition)); the rows it hides are hidden rows in `rows`. A sheet can also have `filterViews`: filters saved under a name, with the filters and sorts of its tables (see [Filter views](/sheets/grid/#filter-views)); XLSX files keep them as Excel's named sheet views. A cell can also have a `control`: `{ "type": "checkbox" }`, `{ "type": "dropdown", "options": [{ "value": "Todo", "color": "#e5e7eb" }] }` or `{ "type": "badge", "kind": "person" }`; see [The grid editor](/sheets/grid/#checkboxes-dropdowns-and-badges). A cell has one of `v` (a number, text or boolean), `e` (an error typed in as a value) or `f` (a formula), plus an optional number format `fmt` and style `s`. What a formula works out to is not saved; it is worked out when the workbook is opened. `parseWorkbook` refuses unknown fields, so a misspelled one is an error.

## CSV

```ts
import { fromCsv, toCsv } from "@pli.dev/sheets";

const workbook = fromCsv(text);                         // numbers, booleans, percentages and dates are read as such
const session = new SheetSession(workbook);
const csv = toCsv(session.calculator, "Sheet1");        // formulas are written as what they work out to
```

The delimiter (comma, semicolon, tab or bar) is found from the first line, quotes and line breaks inside quoted fields are understood, and a byte-order mark is skipped. **A field that starts with `=`, `+`, `-` or `@` and isn't a number is kept as text and never becomes a formula**, so opening a CSV from someone else can't run anything. Pass `typed: false` to keep every field as text. `toCsv` takes `range`, `delimiter`, `formatted` (write the values as they show, with formats) and `newline`.

## Excel (XLSX)

```ts
import { fromXlsx, toXlsx } from "@pli.dev/sheets";

const { workbook, warnings } = fromXlsx(bytes);         // bytes: a Uint8Array
const file: Uint8Array = toXlsx(session.state);
```

Reading keeps sheets and their names, values, formulas (including shared formulas), number formats, bold, italic, underline, strikethrough, text and fill colours, font and size, alignment and wrapping, column widths, row heights, hidden rows and columns, frozen panes, defined names, filters on a list of values and [charts](/sheets/charts/#in-excel-files). Both date systems are understood. Writing makes a file that opens in Excel and LibreOffice: formulas come with their current values (so viewers that don't recalculate show them) and Excel recalculates on opening, and newer functions get the `_xlfn.` prefix Excel needs.

Fonts are written by name (`Lora` stays `Lora`), with the `<family>` hint Excel keeps beside a font's name so that a computer without the font picks a similar one. Excel has no Google fonts: pass `{ fonts: "office" }` to `toXlsx` to write the nearest Office font instead. Font files are not embedded in the workbook. See [Fonts](/platform/fonts/#fonts-in-files).

Comment **threads** are written as Excel 365's threaded comments (with a classic note for older versions of Excel, replies, resolved state, @mentions and the people who wrote them) and read back; see [Collaboration](/sheets/collaboration/#in-xlsx-files). A workbook, its pictures and the data of its pivot tables can be kept in your own file storage: [File storage](/sheets/collaboration/#file-storage).

Dropdowns that allow one choice are written as Excel data validation lists and read back as dropdowns (the choices come back without their colours, and a list that refuses other entries stays strict); a dropdown that allows several choices is written as a list that never complains, with its separator in an extension Excel ignores (see [Data validation](/sheets/validation/#a-separator-for-dropdown-cells)); checkboxes and badges have no counterpart in the file and keep only their value. Cell formulas, defined names and validation rules that read another workbook are written as Excel's `[1]Sheet1!B2` with an `externalLink` part that holds the cells (see [Data validation](/sheets/validation/#formulas-and-lists-that-read-other-workbooks)). A filter is written as Excel's AutoFilter, with the rows it hides hidden. What Pli does not have yet is listed in `warnings` rather than dropped without a word: data validation of a kind Pli doesn't have, shapes and text boxes, pictures placed in cells (Excel's `IMAGE` function), pictures in formats other than PNG, JPEG and GIF, threaded comments, kinds of chart and conditional format Pli doesn't have, and formulas that use functions Pli doesn't have yet.

Borders, merged cells, conditional formats, data validation (see [Data validation](/sheets/validation/)), tables (see [Tables](/sheets/tables/)), hidden sheets and tab colours are written and read (see [Borders, merged cells and conditional formats](/sheets/formatting/)), and colours that come from an Excel theme are read with their tint. [Links and notes](/sheets/grid/#links-and-notes) are hyperlinks and comments in the file: a web address is a relationship of the sheet, a place in the workbook is the hyperlink's location, and a note is a comment with the drawing Excel keeps for its box; a link cell is written in blue and underlined unless it has a look of its own.

[Groups](/sheets/grid/#groups) are `outlineLevel` and `collapsed` on rows and columns (with the depth in `sheetFormatPr` and where summaries sit in `outlinePr`), and [sparklines](/sheets/grid/#sparklines) are `x14:sparklineGroup` elements in the sheet's extension list; both are read and written, and a sparkline colour that comes from a theme is read as Excel's own.

[Pivot tables](/sheets/pivot-tables/#in-xlsx-files) are a pivot table part and a cache definition beside the cells (written without the records, to refresh when opened), with sorting by a value, your own order, top, bottom, label, date and value filters, grouping (dates, times, days in ranges, numbers, items you pick, several parts at once), values down the rows, outline form, the "show as" choices including rank, percent running total and share of the parent, calculated fields and items, a pivot table of several ranges, styles, slicers and timelines, blank lines and repeated labels; one with a feature the file can't hold (a filter by colour) is written as plain cells, and one read that way stays as plain cells, with a warning.

[Iterative calculation](/sheets/formulas/#iterative-calculation) is `iterate`, `iterateCount` and `iterateDelta` on the workbook's `calcPr`, read and written.

[Printing](/sheets/grid/#printing) is read and written: `pageSetup`, `pageMargins`, `printOptions`, `headerFooter`, row and column breaks, the fit-to-pages flag, and the print areas and titles Excel keeps as the defined names `_xlnm.Print_Area` and `_xlnm.Print_Titles` (which are not names of the workbook's own in Pli); a paper size Pli doesn't have prints on letter, with a warning.

[Protection](/sheets/grid/#protection) is read and written: each cell's lock and hidden formula, a sheet's `sheetProtection` (what is allowed, and the password hash as Excel keeps it) and the workbook's `workbookProtection`; ranges people may edit are not read.

[Pictures](/sheets/grid/#pictures) are pictures in the sheet's drawing with their files in `xl/media`, read and written beside the charts (with their crop, turn, flips and whether they move and size with their cells; effects are not kept; pictures placed in cells are written as pictures over the cell and read back as cell content, and Excel's own are read; `IMAGE` is a formula, see [Pictures in cells](/sheets/grid/#pictures-in-cells)). A note is read without the author Excel puts in front of it, and a threaded comment, which is another thing, is left out with a warning.

The tests write a workbook, have LibreOffice open and re-save it, read it back, and compare formulas, values and formats.

## Checking against Excel

Pli's files have been read back by LibreOffice and by Pli, and are checked for the mistakes that make Excel say "We found a problem with some content": a part that isn't listed or isn't there, a relationship that leads nowhere, elements in an order the schema doesn't allow, counts that don't add up, a table whose columns disagree with its header cells. Many of the kit's files, from 01 on, have also been opened in Excel for Mac with no repair message; what is still unchecked is listed on the [roadmap](/sheets/roadmap/).

To check, from the repository:

```bash
pnpm excel-check:make   # writes the sample workbooks and START-HERE.md to excel-check/
```

Open each file in Excel (and upload it to Google Sheets). Each starts with a **Read me** sheet that lists what to look for, and the first one compares Excel's result for about 170 formulas with Pli's on every row and turns a difference red. Save each file back (File > Save As, the same name) into `excel-check/back/`, then:

```bash
pnpm excel-check:read   # writes excel-check/REPORT.md
```

The report says what Pli wrote that is no longer in the file, which cells hold an error Excel worked out, which of the formulas gave a different answer (Excel's own verdicts are cached in the file it saves), and which formulas came back written differently. If Excel offers to repair a file, the repair log says which part it removed, and that is the most useful thing to report.

The tests run the same package check on every sample as it is written, and break files on purpose to make sure the check notices.

## Number formats

A cell's `fmt` is an Excel number format code, and `TEXT` uses the same codes:

| Code | Shows |
|---|---|
| `0`, `0.00`, `#,##0`, `#,##0.00` | Fixed decimals, thousands separators |
| `0%`, `0.0%` | Percentages |
| `$#,##0.00`, `"€"0.00` | Currency, or any text in quotes |
| `0.00E+00`, `##0.0E+0` | Scientific |
| `#,##0,` and `0.0,,` | Thousands and millions (a comma after the digits divides by 1,000) |
| `0;(0);"zero"` | Separate formats for positive, negative and zero, then text (`@`) |
| `[Red]0;[Blue]-0`, `[>100]"big";"small"` | A colour or a condition on a section |
| `yyyy-mm-dd`, `m/d/yyyy`, `dddd, mmmm d, yyyy` | Dates |
| `h:mm AM/PM`, `hh:mm:ss`, `[h]:mm` | Times and elapsed time |
| `# ?/?`, `# ??/??`, `?/8`, `# ?/16` | Fractions: the closest one whose denominator fits the placeholders (up to 9, 99 or 999), or a fixed denominator; `?/?` alone gives an improper fraction (`5/2`) |
| `_($* #,##0.00_)` | `*` followed by a character repeats it to fill the cell: here the `$` stays at the left edge and the number goes to the right (accounting) |

Rounding is half away from zero on the number's 15 significant digits, so 1.005 shows as `1.01` with `0.00`. `session.display(sheet, "B2")` gives `{ text, color? }` for a cell as it should be drawn. A fraction shows the whole number and a fraction of it (`2.75` as `# ?/4` is `2 3/4`); the numerator is padded on the left and the denominator on the right as its placeholders say (`?` with spaces, `0` with zeros), and a number with no fraction part shows spaces where the fraction would be. `session.display` and `formatValue` give a `fill: { at, char }` when the format has a `*`: the `text` has one copy of the character at `at` (as Excel's `TEXT` gives), and the grid draws the repeats to fill the cell's width. Printing, copied HTML and CSV show the one copy.

When someone types into a cell, `cellFromInput` reads what they typed as Excel does: `12%` is 0.12 with a percent format, `$5` a currency, `3/5/2024` a date, `'123` the text 123, `=A1+1` a formula.
