---
title: Borders, merged cells and conditional formats
description: Lines around cells, merged ranges, and rules that style cells by what they hold, in the model, the grid editor and XLSX files.
---

Borders, merged cells and conditional formats are kept in the workbook as plain JSON, undone with the cells, and written to and read from Excel files. The playground's spreadsheet has a **Formatting** sheet that uses all of them. Open it with `pnpm playground`, then Sheets.

## Borders

A border belongs to the cell it is on: `style.border` has a line for any of `top`, `right`, `bottom` and `left`, and for the two diagonals (`diagonalDown`, from the top-left corner to the bottom-right, and `diagonalUp`), and a line has a `style` (`thin`, `medium`, `thick`, `dashed`, `dotted`, `double` or `hair`) and a `color` (black when missing).

```ts
session.setBorders("Sheet1", "A3:G9", "all", { style: "thin", color: "#c7c7d2" });
session.setBorders("Sheet1", "A3:G9", "outer", { style: "medium" });
session.setBorders("Sheet1", "A3:G3", "bottom", { style: "double" });
session.setBorders("Sheet1", "B3", "diagonalDown", { style: "thin", color: "#6b7280" }); // crosses a cell out
session.setBorders("Sheet1", "A3:G9", "none", null); // takes every line away, diagonals too
```

`where` is `all`, `outer`, `inner`, `horizontal`, `vertical`, `top`, `bottom`, `left`, `right`, `diagonalDown`, `diagonalUp` or `none`. A diagonal crosses every cell of the range (a merged range takes its first cell's). As in Excel, a line on the edge of a range is also set on the neighbouring cell's side that touches it, so it reads the same from both cells. Taking lines away leaves no empty cells behind. One call is one undo step.

```ts
session.borderLook("Sheet1", "A3:G9");              // { style: "mixed", color: "mixed" }: what the lines there look like (null if none)
session.colorBorders("Sheet1", "A3:G9", "#336699"); // one colour for every line already there; each keeps its style
```

`colorBorders` also recolours the neighbouring cell's side of a shared line, so the line reads the same from both cells, and is one undo step.

In the grid editor the **Borders** button in the toolbar (and **Format > Borders**) draws them, with a line style and colour to pick. The **Border color** button next to it sets the colour for new lines and recolours the lines already on the selected cells, keeping each line's style. Its swatch is empty when the selection's lines differ.

## Merged cells

`sheet.merges` is a list of ranges such as `"A1:G1"`. The top-left cell shows over the whole range and holds the value; the other cells are covered.

```ts
session.mergeCells("Sheet1", "A1:G1");            // empties the covered cells, keeps their formats
session.mergeCells("Sheet1", "A3:C6", { across: true }); // one merge per row
session.mergeCells("Sheet1", "A1:G1", { center: true });  // Merge and centre: the cell is centred too
session.unmergeCells("Sheet1", "A1:G1");
session.merges("Sheet1");                         // ["A1:G1"]
session.mergeAt("Sheet1", "C1");                  // "A1:G1"
```

Merged ranges never overlap: merging over one unmerges it first. As in Excel, cells of a table can't be merged (`mergeCells` refuses), and an XLSX file leaves out a merge that touches a table or is one cell, since Excel repairs a file that has either. They follow inserted and deleted rows and columns (a merge grows when rows are inserted inside it, shrinks when some are deleted, and goes when only one cell is left), and travel with cells that are copied or moved. A range with merged cells can't be sorted, as in Excel. Excel has no way to resize a merged range by dragging its edge (it merges and unmerges, or fills), so here dragging the edge moves it, as for any range.

### Moving, copying and filling merged cells

`move`, `copy` and `autofill` carry merged ranges with the cells they take, and refuse (with a message that says why, and nothing changed) in these cases:

- only part of a merged range is in the cells being moved, copied or filled from: take all of it, or unmerge it first;
- the place the cells go to has merged cells of another shape (a merged range of the same size in the same place as one that arrives is simply replaced);
- the place is locked on a protected sheet.

```ts
session.move({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D5" }); // D5:E5 is now the merged range, formulas that pointed at A1 follow
session.copy({ sheet: "Sheet1", range: "A1:C3" }, { sheet: "Sheet2", at: "B2" }); // merges inside the range are copied with their cells
session.autofill("Sheet1", "A1:B1", "A1:B4");                                     // the merge is repeated: A2:B2, A3:B3, A4:B4
session.relocateProblem(from, to, { copy: true });  // the reason a drag would be refused, or null (the grid asks before it draws a drop)
session.fillProblem("Sheet1", "A1:B1", "A1:B4");    // the same for the fill handle
```

Filling repeats a block of merged and plain cells with its period (a two-row merge repeats every two rows); a copy that the end of the fill would cut off is not merged. A source with merged cells fills as a copy, not as a series (1, 2 does not count on through a merge). Everything is one undo step.

In the grid editor, drag the edge of the selection (a merged range, a range that holds merges, or any other range) to move it, with Ctrl (Option) to copy, and drag the **fill handle** to repeat it. A drop that would be refused is drawn in red, and letting go says why. Pasting a copy made here (`copy` and `move`) follows the same rules.

Clicking a merged cell selects the whole range, arrow keys step out of it, and typing edits it over its full size. The **Merge cells** button in the toolbar offers Merge and center, Merge all, Merge across and Unmerge, and says when merging dropped a value.

## Conditional formats

`sheet.conditional` is a list of rules, the first having the most say. A rule applies to one or more `ranges`, and is one of:

| `kind` | Applies to cells that… | Also has |
|---|---|---|
| `cell` | compare with a value or cell: `op` (`greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `equal`, `notEqual`, `between`, `notBetween`) | `values`: one formula, or two for `between` |
| `text` | contain, don't contain, begin or end with `text` | `op` |
| `formula` | make a formula true | `formula`, relative to the top-left cell of the first range |
| `blanks`, `noBlanks`, `errors`, `noErrors` | are empty, aren't, are errors, aren't | |
| `duplicates`, `uniques` | have a value that appears more than once, or once | |
| `top` | are among the highest (or `bottom`) `rank` values, or `percent` of them | |
| `average` | are `above` or below the average (`equal` includes it, `stdDev` moves the line) | |
| `dates` | fall in a `period`: yesterday, today, tomorrow, last 7 days, this, last or next week or month | |

These rules carry a `style` that is put over the cell's own: `bold`, `italic`, `underline`, `strike`, `color`, `fill`, `border` (with diagonals), `fmt` (a number format such as `0.0%` or `[Red](#,##0)`, which changes how a number shows without changing it), and `fontFamily` and `fontSize`. Excel changes the number format of a rule, and the font's style and colour, but not the font's name or size, so those two are drawn here and written to the file, where Excel leaves them out. Where several rules apply, the first one to say something about a property wins; `stop: true` ends the search when a rule applies.

Three kinds draw instead of styling the cell:

- `colorScale`: two or three `stops` (`min`, `max`, a `num`, a `percent`, a `percentile` or a `formula`), each with a colour, and every number is coloured by where it falls between them.
- `dataBar`: a bar as long as the value is between `min` and `max`, growing from zero when the scale takes in negative numbers. `min` and `max` may be `{ type: "auto" }` (Excel's Automatic, the default Excel gives a new bar): the start is zero unless some number is lower, and the end is zero unless every number is lower, so the shortest bar of a column of positive numbers is not empty. `negativeColor` colours the bars of negative numbers, `solid` fills them with one colour instead of fading, `border` outlines them (`borderColor` is the outline's colour, the bar's own when missing, and `negativeBorderColor` that of negative bars, the positive outline's when missing), `rtl` makes the bars grow from the right, `axis` places the zero line (`middle` of the cell, or `none` so every bar grows from the left; by default it falls where zero does), `axisColor` colours it, and `minLength` and `maxLength` are how much of the cell's width the shortest and longest bars take, in percent (0 and 100 unless said; Excel's older form uses 10 and 90). `hideValue` shows the bar alone.
- `iconSet`: one of 20 sets (`3Arrows`, `3TrafficLights1`, `4Rating`, `5Quarters`, and Excel 2010's `3Stars`, `3Triangles` and `5Boxes`), with a `thresholds` entry for each icon after the first. `reverse` flips the order, `hideValue` shows the icon alone, and `custom` picks the icon of each step yourself from any set (lowest first, `null` for none): `custom: [{ set: "3Flags", index: 0 }, null, { set: "5Rating", index: 4 }]`.

```ts
session.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B20"], style: { fill: "#ffc7ce", color: "#9c0006" } });
session.addRule("Sheet1", { kind: "colorScale", ranges: ["C2:C20"], stops: [{ type: "min", color: "#ffffff" }, { type: "max", color: "#63be7b" }] });
session.conditionalEffect("Sheet1", "B3"); // { style: { fill: "#ffc7ce", … } }: what the rules do to one cell
session.moveRule("Sheet1", rule.id, 0);    // gives it the most say
session.clearRules("Sheet1", "B2:B20");
```

Rules are worked out from the cells as they are, so they follow edits at once. Their ranges and formulas follow inserted rows and renamed sheets like any formula; a rule whose cells are all deleted goes. `conditionalEffect` is what the grid draws from, so another front end gets the same results.

In the grid editor, **Conditional formatting** (toolbar and Format menu) has the quick ones (highlight cells, top and bottom, data bars, colour scales, icon sets), **New rule…** for any kind, and **Manage rules…** to reorder, edit and delete them. The rule editor has the number format and font, every data bar setting (automatic ends, border colours, direction) and a *Choose each icon* choice for icon sets. When the selection is in a pivot table, *Apply the rule to* picks the cells of the pivot table or only the selected cells of it (which follows the items they are under).

### Rules that follow a pivot table

A pivot table is drawn in ordinary cells that move when it is refreshed or its fields change, so a rule on fixed cells would soon cover the wrong ones. A rule with a `pivot` scope covers the cells of the pivot table instead, as Excel's *All cells showing "Sum of Sales" values* does, and its `ranges` are worked out again every time the table is drawn (in the same undo step):

```ts
const pivot = session.createPivot("Pivot", { source: "Data!A1:D100", anchor: "A1", rows: ["Region", "Product"], values: ["Qty", "Sales"] });
session.addRule("Pivot", { kind: "dataBar", ranges: [], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6",
  pivot: { id: pivot.id, value: 1, rows: "Product" } });  // the Sales cells at the Product level, not the subtotals or the grand total
```

`value` is the number of a value field (all of them when missing); `rows` and `columns` name a row or column field and limit the rule to the cells at that field's level (any level, totals included, when missing). Labels and headings are never covered.

`items` is Excel's rule for **selected cells**: for each row or column field it names, the labels of the items the rule is limited to, so it keeps covering them when the table moves or grows. `{ items: { Region: ["West"] } }` covers every cell under West, its subtotal included; with `rows: "Product"` as well, only the product lines under West. `session.pivotSelectionScope(sheet, range)` works out the scope for cells picked in a drawn pivot table (the value they show, their level, the items they are under; null when the range takes in labels or lies outside a table), ready to pass as `pivot`:

```ts
const scope = session.pivotSelectionScope("Pivot", "C9:C10"); // { id, value: 1, rows: "Product", items: { Region: ["West"] } }
session.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style: { bold: true }, pivot: scope! });
``` The `ranges` you pass are replaced; a scope that matches no cell leaves the rule on the table's first cell. Deleting the pivot table deletes its rules, and copying cells out of a pivot table copies a rule that no longer follows it. The pivot table must be on the same sheet, and its fields must exist.

## Fonts

A cell's font is `style.fontFamily` (and `fontSize`). The grid editor's toolbar offers the Office fonts and more than 2,000 open-licence Google families, loaded when a cell uses them, and measures text again once a font has arrived (a column that fits its text follows). A font that hasn't loaded is drawn in a close stand-in, so nothing disappears.

```ts
session.setStyle("Sheet1", "A1:G1", { fontFamily: "Lora", fontSize: 14, bold: true });
```

Restricting the list, serving the files yourself and adding your own fonts are in [Fonts](/platform/fonts/).

## In XLSX files

| | Written as |
|---|---|
| Borders | The style sheet's `borders`, each cell style pointing at one. Excel's other dash styles are read as `dashed` or `dotted`. A file keeps one diagonal line, drawn up, down or both, so if a cell has both with different styles, the up one's style is used for both |
| Merged cells | `mergeCells`, without a merge that touches a table or is a single cell |
| Conditional formats | One `conditionalFormatting` per rule, in priority order, with the style (number format and font too) in the style sheet's `dxfs`. Text, blank, error and date rules also get the formula Excel writes for them |
| Data bars and icon sets | The older form, plus Excel 2010's extension for what it can't hold: a data bar's negative colour, solid fill, border and axis (the extension is always written: without it Excel reads the bar as having no axis and saves it back as `axisPosition="none"`), your own icons, and the sets that are new to 2010 (those are in the extension only; icons of your own are not also written as a plain rule, since Excel kept the two as two rules) |
| Rules that point at other sheets | Excel 2010's extension: the older form can't hold them. That is a cell value or formula rule with a reference to another sheet, a data bar whose start or end is a formula that does (the older form keeps plain lowest and highest), and an icon set with a step that does (the extension then holds the whole rule). Any other kind of rule Excel keeps there (text rules whose text comes from a cell, blanks, errors, duplicates, ranks, averages, periods) is read too; a text rule that has no text of its own comes in as the formula rule Excel wrote for it |
| Automatic ends, direction and border colours of a data bar | The extension: `autoMin` and `autoMax`, `direction="rightToLeft"`, `x14:borderColor` and `x14:negativeBorderColor` (the older form says lowest and highest) |
| Rules that follow a pivot table | The sheet's `conditionalFormatting` has `pivot="1"`, and the pivot table's own `conditionalFormats` holds the area of each rule (`scope="data"` or `"field"`, with the value and field `reference`s; no scope, Excel's selected cells, when the rule names items, each item by its place in the field's list), tied to the rule by its priority. A selection of headings, or of items Pli can't name (a grouped field's), comes in as an ordinary rule. A pivot table that has to be written as plain cells leaves the rules as ordinary ones |
| Fonts | The font name as written, with Excel's `<family>` hint beside it so that a computer without the font picks a similar one (see [Fonts](/platform/fonts/#fonts-in-files)) |
| Colours | Read from fixed colours, from the workbook's theme with its tint, and from the indexed palette |

The extension is read the same way, so a file from Excel 2010 or later keeps its data bar settings (a data bar from the older form runs from 10% to 90% of the cell, as Excel draws it) and its rules that point at other sheets. A rule of a kind Pli doesn't have is listed in the import's `warnings` and left out. The check kit (`pnpm excel-check:make`, sample 33) has a file with every kind of rule, rules that point at other sheets, merges and pivot rules, and the package check (`test/excel-check/lint.ts`, `lint-format.ts`) tests the order of the elements, the values and the links of these parts against the schema.

Excel opened kit files 22 and 33 with no repair message and kept every rule: data bars with their settings, the rules that point at other sheets, the pivot table's rules (it adds `pivot="1"` to the extension block of a rule on a pivot table, which Pli now writes too), the merges and the icon sets; it joins identical rules on neighbouring columns into one over both, rewrites the numbers of its styles, and leaves out settings that equal the default.

LibreOffice opens Pli's formatting, including the extension, and writes it back as the same formatting, and the test suite checks that. LibreOffice has no bar borders or direction, so it drops those two on the way back (it keeps the automatic ends and both colours), and it has no conditional formats on pivot table cells: it opens a file with them, keeps the pivot table, and leaves the rules out when it saves. LibreOffice 26.8 closes with an error on a data bar whose start or end is a formula in the extension (the form Excel writes for one that points at another sheet), so open such a file in Excel; every other rule, and icon sets with thresholds that point at other sheets, it opens.

## Not there yet

- A colour scale whose point is a formula that points at another sheet is written in the ordinary form, because the extension Pli writes holds only data bars, icon sets and the rules above. Excel 2010 and later are expected to read it (Excel 2007 doesn't); the kit has no such file yet, so how Excel keeps it has not been seen (type a colour scale with a lowest value of `=Limits!$A$1` in Excel, save, and send the sheet's XML).
- A rule for selected cells of a pivot table that names a grouped or calculated field's items, or labels and headings, comes in as an ordinary rule on those cells, and does not follow the table.
