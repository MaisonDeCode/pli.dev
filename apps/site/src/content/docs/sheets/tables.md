---
title: Tables
description: Named tables with filter and sort buttons (sorting by several columns, by colour or by icon), formulas that name their columns (Sales[Amount]), calculated columns, removing duplicate rows, slicers and timelines, styles of your own for tables and slicers, tables with no header row, and tables in XLSX files.
---

A table is a block of cells with a header row (or without one) and a name. Formulas can use its name and its column names instead of cell addresses, so `=SUM(Orders[Total])` keeps working when rows are added, columns move or the table grows. Tables are part of the workbook, so they are saved in its JSON, undone with the cells, and written to and read from Excel files.

The playground's **Tables** sheet has an orders table with a calculated column, a total row, a slicer, a style of its own, a cell that doesn't follow its column's formula, and a second table with no header row, with formulas that name their columns.

## The model

`sheet.tables` is a list. A table has a `name` (letters, digits, `_` and `.`, starting with a letter, and not used by another table or a defined name), a `range` that includes the header row and the totals row, and its look:

```ts
{ id: "table_1", name: "Orders", range: "A1:E7", totals: true, style: "TableStyleMedium9", bandedRows: false, firstColumn: true }
```

The column names are the text of the header cells, which must be different from each other. `calculated` lists the columns whose cells share one formula (see below). `style` is an Excel table style name (`TableStyleMedium2`, the default, `TableStyleLight9`, `TableStyleDark2`…) or `none`. A table has a header row and at least one row of data, unless it has [no header row](#a-table-with-no-header-row).

```ts
const t = session.createTable("Sheet1", "A1:D20");      // the first row becomes the names; empty or repeated ones are named Column2, Name2…
session.createTable("Sheet1", "A1:D20", { header: false }); // a row for the names is put in above the data
session.renameTable("Table1", "Orders");                // formulas that name it follow
session.resizeTable("Orders", "A1:E30");
session.setTableOptions("Orders", { style: "TableStyleLight9", bandedRows: false, firstColumn: true });
session.setTableTotals("Orders", true);                 // a Total row: "Total", and SUBTOTAL(109, …) of the last column
session.setTableTotalsFunction("Orders", "Qty", "average");   // Excel's drop-down in the totals row: SUBTOTAL(101, Orders[Qty]), leaving out hidden and filtered rows
session.convertToRange("Orders");                       // keeps the cells; references become plain ranges
session.deleteTable("Orders");                          // and the cells
session.tables("Sheet1");  session.tableAt("Sheet1", "B3");
```

A table follows its rows and columns: inserting rows or columns inside it makes it larger (new columns are named `Column3` and so on), deleting rows makes it smaller, and deleting its header row deletes the table. Typing in the row right under it, or a name in the cell right beside its header row, makes it grow, as in Excel; that is part of the same undo step as the typing, and it stops short of another table. Typing over a header cell renames the column and formulas that name it are rewritten; an empty or repeated name is refused.

## Filtering and sorting from the header

Each header cell of a table has a button, as in Excel. It opens the same menu as a sheet filter: sort A to Z or Z to A, a search box and a list of the column's values, each with its count, to let through. The rows that don't match are hidden (they are hidden rows like any other, so the file keeps them hidden), more than one column can be filtered, and the button shows what is on it: a filled button for a filtered column, an arrow for the column the table was last sorted by.

```ts
session.tableFilterValues("Orders", "Region");                 // [{ value: "East", count: 2 }, …], as the cells show them
session.filterTable("Orders", "Region", ["North", "East"]);    // hides the other rows; null lets all through
session.clearTableFilters("Orders");
session.sortTable("Orders", "Qty", "descending");              // the data rows; the totals row stays where it is
session.sortTable("Orders", "Qty", null);                      // forgets the sort mark and leaves the rows
session.reapplyTableFilter("Orders");                          // after the cells changed under a filter
session.setTableFilterButtons("Orders", false);                // no buttons, and every row let through
```

Besides a list of values a column can be filtered [by a condition](/sheets/grid/#filters-by-condition) (a comparison, the top or bottom, above or below average, a period of dates, a colour): the header menu has **Filter by condition…**, and `filterTableRule` does it from code.

### Dates picked from the tree

For a column of dates the header menu shows Excel's tree instead of a flat list: years, and under each year its months, and under each month its days, each with a box that is ticked, empty, or half-ticked when only some of the dates under it are chosen. A year or month opens with its arrow; ticking it ticks everything under it; the search box finds dates by their names (`march`, `2023`). Dates with a time of day go on down to hours, minutes and seconds. Text, empty cells and numbers that aren't dates stay under the tree as a flat list.

```ts
const tree = session.tableFilterDateTree("Orders", "Day");   // null when the column holds no dates
// { nodes: [{ group: { by: "year", year: 2023 }, label: "2023", count: 5, selected: 5, children: [months → days] }],
//   others: [{ value: "n/a", count: 1, selected: true }] }
session.filterTableDates("Orders", "Day", ticked, ["n/a"]);  // `ticked`: groupKey(leaf.group) of the days to let through; the list is the other values
session.filterTableRule("Orders", "Day", { kind: "dateGroups", groups: [{ by: "month", year: 2023, month: 3 }, { by: "day", year: 2023, month: 5, day: 4 }], values: [""] });
```

What is chosen is kept as a list of `groups` (a whole year, a month of one, a day… as `by` says) in the filter: `{ kind: "dateGroups", groups, values? }`, where `values` are other values let through as in a list (`""` for empty cells). A year or month all of whose dates are ticked is stored as that year or month, as Excel does, so it covers dates added to the table later; ticking everything takes the filter off. The sheet's own filter has the same (`filterDateTree`, `filterColumnDates`). A rule works on the date itself, not on the text the cell shows, so changing a cell's format doesn't change what passes. Like other filters it is applied again with `reapplyTableFilter`.

The filter is kept in the table (`table.filters` by column name, `table.sort`), so it follows a renamed column and goes with a deleted one. Sorting moves whole rows, formulas included, and then hides again the rows that the filters hide. Each is one undo step. Cells that change under a filter are not filtered again until `reapplyTableFilter`, as in Excel. Two tables side by side share their rows: a row stays hidden while either table's filter hides it.

### Sorting by several columns, by colour and by icon

A sort is a list of *levels*, as in Excel's Sort dialog. A level is a column and what it orders by: its values (A to Z, or Z to A), or one fill colour, one font colour or one conditional-format icon to put on top (or at the bottom). Rows that a level can't tell apart go on to the next level, and rows no level tells apart keep the order they had. Empty cells and errors go last whichever way a level runs. The colours are the ones the cells show, so a conditional format's fill, font colour, colour-scale colour or icon counts, as in Excel.

```ts
session.sortTableBy("Orders", [
  { column: "Region" },                                              // A to Z
  { column: "Total", by: "icon", icon: { set: "3Arrows", index: 2 } }, // the green up arrow on top
  { column: "Qty", by: "cellColor", color: "#ffc7ce" },              // pink cells on top
  { column: "Item", by: "fontColor", color: "#9c0006", descending: true }, // dark red text at the bottom
]);
session.tableSort("Orders");                       // the levels, first level first
session.tableSortChoices("Orders", "Qty");         // { fills: ["none", "#ffc7ce"], fonts: ["auto"], icons: [null] }: what a column can be sorted by besides its values
session.sort("Sheet1", "A1:D20", { header: true, levels: [{ column: 1 }, { column: 3, by: "cellColor", color: "#ffc7ce" }] });   // the same for a range (columns count from the range's first)
```

`color: "none"` stands for cells with no fill, `"auto"` for the default font colour and `icon: null` for cells with no icon. The same column can be sorted more than once (by two colours, say), but not twice by the same thing. The first level is `table.sort` and the others are in `table.sort.then`; a renamed column is renamed in every level and a deleted column takes its levels with it. The arrow on the header button shows the first level. `sortTable` still sorts by one column and replaces a longer sort.

In the grid the filter menu of a column that has more than one fill colour, font colour or icon shows a swatch for each (**Sort by colour (on top)**; pressing one sorts by it), and **Custom sort…** opens the Sort dialog: a row for each level with the column, *Sort on* (cell values, cell colour, font colour or icon), the colour or icon, and the order (*A to Z* and *Z to A*, or *On top* and *On bottom*), with **Add level**, **Copy level**, **Move up**, **Move down** and **Delete level**. **Data > Custom sort…** opens it for the table the active cell is in, or for the block of data around the selection, with a *My data has headers* box (the sheet's own filter sorts its range the same way). A range sort is done and not remembered; a table keeps its levels.

### Removing duplicate rows

```ts
session.removeTableDuplicates("Orders");                       // rows that repeat an earlier row in every column; returns how many went
session.removeTableDuplicates("Orders", ["Region", "Item"]);   // compare only these columns (names or column numbers)
session.removeDuplicates("Sheet1", "A1:D20", { header: true, columns: [1, 2] });   // a plain range: the rows below move up and the end is left empty
```

The first of each set of equal rows stays. Cells are compared as they show, and capitals don't matter, as in Excel. In a table the repeated rows are deleted, so the table gets shorter and what is below moves up; a table with a totals row keeps it. It is refused, changing nothing, when a row to remove has other cells beside the table (they would be lost); move them first. One undo step. **Format > Table > Remove duplicates…** and **Data > Remove duplicates…** ask for the columns to compare (with *Select all* and *Unselect all*, and *My data has headers* for a range) and say how many rows went and how many are left.

## Slicers

A slicer is a panel of buttons, one for each value of a table's column, that filters the table. It is the table's own filter drawn another way, so the header button and the slicer always agree.

```ts
const slicer = session.addSlicer("Sheet1", { table: "Orders", column: "Region" });   // beside the table; caption, columns, style, from, width, height are options
session.slicerItems(slicer.id);          // [{ value, count, selected, available }]: `available` is false for a value no row of the other filters has
session.slicerSelect(slicer.id, ["East"]);   // null, or every value, lets all through
session.updateSlicer("Sheet1", { ...slicer, caption: "Where", columns: 2 });
session.deleteSlicer("Sheet1", slicer.id);
```

Clicking a button shows only that value; clicking the only button chosen shows everything again; Ctrl, Cmd or Shift adds or removes a value. The button in the heading clears the filter. The heading moves the slicer, its bottom right corner resizes it, the wheel scrolls a long list, and right-click opens its settings (heading, columns of buttons, style) and **Delete slicer**. A slicer sits on a cell like a chart and moves with it when rows or columns are inserted. It goes when its table or its column does, and when its table is converted to a range. A table with no header row has no slicers.

### Slicer styles of your own

A slicer's `style` is one of Excel's names (`SlicerStyleLight1` to `SlicerStyleDark6`, drawn from their colour) or the name of a style of your own, kept in the workbook (`workbook.slicerStyles`). A style is a look for each part of a slicer, named as Excel names them: `wholeTable` (the slicer) and `headerRow` (its heading), and the buttons by whether the value is chosen and has data under the table's other filters, and whether the pointer is over them: `selectedItemWithData`, `unselectedItemWithData`, `selectedItemWithNoData`, `unselectedItemWithNoData`, and the four `hovered…` ones. Each look sets text colour, fill, bold, italic and lines.

```ts
session.setSlicerStyle("Harbor", {
  wholeTable: { fill: "#f4f8fc", color: "#1f3a5f" },
  headerRow: { fill: "#1f3a5f", color: "#ffffff", bold: true },
  selectedItemWithData: { fill: "#6aa6e3", color: "#ffffff", bold: true },
  unselectedItemWithData: { fill: "#e6eef7", color: "#1f3a5f" },
  unselectedItemWithNoData: { color: "#9aa7b5", italic: true },
});
session.updateSlicer("Sheet1", { ...slicer, style: "Harbor" });
session.slicerStyleParts("SlicerStyleDark2");   // Excel's style as parts, to start one of your own from
session.setSlicerStyle("Harbor", null);         // removes it; slicers (and pivot table slicers) that used it go back to the default style
```

The name can't be one of Excel's or the name of a table style. In the grid, **Slicer settings…** has **New slicer style…** and **Edit this style…**, with a sample slicer that shows every part (the hovered ones too) and follows each change, and the style is given to the slicer you opened it from. Buttons are drawn by whether they are chosen: with nothing filtered all are *selected*. The pointer's hover is drawn in the grid.

## Timelines

A timeline is a strip of periods (years, quarters, months or days) over a table's column of dates, in which you drag out a range to show only the rows dated inside it. Like a slicer it is the table's own filter drawn another way: the range is the dates the column's filter lets through (as `dateGroups` picks, see above), so the header button, the date tree and the timeline always agree.

```ts
const t = session.addTimeline("Sheet1", { table: "Orders", column: "Day", level: "months" });   // beside the table; caption, style, from, width, height are options
session.timelineInfo(t.id);      // { level, bounds, periods: [{ start, end, label, parent, count, selected }], selection }
session.timelineSelect(t.id, { start: 44927, end: 45016 });   // whole periods of the level; null (or every date) lets all through
session.updateTimeline("Sheet1", { ...t, level: "quarters", caption: "When" });
session.deleteTimeline("Sheet1", t.id);
```

The strip lays out every period from the first date to the last, empty ones too (dimmed). Press a period to pick it, drag over several to pick a range, Shift+press to pull the range out to a period, and drag the handles at the ends of the range to move one end. The wheel and the bar under the strip scroll it. The word at the right of the heading (MONTHS) steps through the levels, the ✕ clears the range, the heading moves the timeline and its bottom right corner resizes it. Right-click opens **Timeline settings…** (heading, periods, style), **Periods**, **Clear range** and **Delete timeline**. **Insert > Timeline…** and **Format > Table > Insert timeline…** make one for a column the table holds dates in. A timeline sits on a cell like a slicer, moves with it when rows or columns are inserted, follows a renamed column, and goes when its table or column does or when the table is converted to a range. Picking a range is one undo step.

The range is read back from the filter, so a range that was not picked in the timeline (a few separate days ticked in the tree) is drawn as one range from the first to the last of them, and a filter that isn't a pick of dates shows every period as chosen.

## Calculated columns

Type a formula into one cell of a table's column while the rest of that column is empty, and it fills the whole column (`=[@Qty]*[@Price]` in the first Total cell gives every row its own Total). The column is then *calculated*: `table.calculated` holds its formula by column name, written as it reads in the first row of data.

- A row added to the table, by typing under it or by inserting a row inside it, gets the formula.
- Typing a different formula into any cell of a calculated column changes the whole column, as in Excel. A plain value typed into one cell stays there as an exception and doesn't change the column's formula.
- The filling is part of the same undo step as the typing. Several cells set at once (a paste, `setValues`) are put in as they are and don't fill or change a column.
- The formula follows renamed columns and tables, renamed sheets and moved rows, and is forgotten when its column is deleted.
- In XLSX files it is the column's `calculatedColumnFormula`.

### Cells that don't follow the formula

A cell in a calculated column that holds a constant, or a formula other than the column's, is an *exception*. The grid draws a green corner on it, and when it is the active cell a **!** button appears beside it, as in Excel, with the choices to restore the column's formula in that cell or in every cell of the column that departs from it, or to use this cell's formula for the whole column.

```ts
session.calculatedException("Sheet1", "E5");    // "value", "formula" or null
session.calculatedExceptions("Sheet1");         // [{ table, column, address, kind }]
session.restoreCalculated("Sheet1", "E2:E20");  // puts the formula back where it differs; returns how many cells
session.useAsCalculated("Sheet1", "E5");        // the same as typing that cell's formula into the column
```

The same choices are in the cell's right-click menu. Empty cells are not exceptions, and formulas that read the same apart from spacing and capitals are not either.

## A table with no header row

**Format > Table > Header row** turns the header off. The table is then all data: its range gives up the header row, the header cells are emptied, the filter buttons, filters and slicers go, and `[@Column]` and `Orders[Column]` still work because the names are kept in `table.columns`. Turning it on writes the names back into the row above (a new row is put in if that row isn't empty). Both are one undo step. A table with no header row has `headerRow: false`; `Orders[#Headers]` in a formula is `#REF!`, and typing in it never renames a column. Inserting and deleting columns keeps the names with their columns (a new one is called `Column3` and so on). In a file it is `headerRowCount="0"`.

```ts
session.setTableHeader("Orders", false);
session.tables("Sheet1")[0];   // { range: "A2:E7", headerRow: false, columns: ["Order", "Region", …], … }
```

## Table styles of your own

An Excel style name (`TableStyleMedium2`…) is drawn the way Excel draws it. A style of your own is a set of looks, one for each part of a table, kept by name in the workbook (`workbook.tableStyles`) and named by `table.style` like the built-in ones:

```ts
session.setTableStyle("Harbor", {
  wholeTable: { border: { horizontal: { style: "thin", color: "#9fb4cc" } } },   // lines between the rows
  headerRow: { bold: true, fill: "#1f3a5f", color: "#ffffff" },
  firstRowStripe: { fill: "#e6eef7" },
  secondRowStripe: { fill: "#ffffff" },
  rowStripeSize: 2,                       // stripes two rows wide (1 to 9)
  totalRow: { bold: true },
  firstHeaderCell: { italic: true },
});
session.setTableOptions("Orders", { style: "Harbor" });
session.tableStyleParts("TableStyleMedium2");   // Excel's style as parts, to start a style of your own from
session.setTableStyle("Harbor", null);          // removes it; tables that used it go back to the default style
```

The parts are `wholeTable`, `firstRowStripe`, `secondRowStripe`, `firstColumnStripe`, `secondColumnStripe`, `firstColumn`, `lastColumn`, `headerRow`, `totalRow`, `firstHeaderCell`, `lastHeaderCell`, `firstTotalCell` and `lastTotalCell`. Each can set bold, italic, underline, strikethrough, text colour, fill and lines, and is drawn over the parts before it in that order. The stripes are drawn on rows of data (and columns, with banded columns on), the first and last columns when the table asks for them. The name can't be one of Excel's. **Format > Table > Table style** lists them, and **New table style…**, **Duplicate this style…** and **Edit this style…** open an editor with a sample table that follows each change.

### Excel's built-in styles

The 60 built-in styles (Light 1 to 21, Medium 1 to 28, Dark 1 to 11) are drawn from Office's own definitions of them, part by part: the whole table, the header and totals rows, the first and last column, the stripes, with the lines, fills and fonts each has (Light 1 to 7 a line above and below the table, Light 8 to 14 a filled header in a frame, Light 15 to 21 a grid, Medium 1 a black line round and between the rows, Medium 2 to 14 pale lines in the colour, Medium 15 to 21 a heavy line under the header, Medium 22 to 28 a framed pale body, and the Dark styles a dark fill throughout with white lines at the header and the first and last columns). Where two parts draw the same line (the header's bottom and the first row's top) the part that names the edge wins on both sides. Colours follow the workbook's theme (`workbook.themeColors`) with Excel's own tint arithmetic, so Medium 2 is `#4472c4` with stripes of `#d9e1f2` in Office's theme. **Duplicate this style…** starts a style of your own from any of them, lines included. Excel draws its own styles itself when it opens the file, so the file only holds the name.

### Lines in a style

The lines of a part are, as in Excel, the lines at the edges of the block of cells the part covers, and between the cells inside it: `top`, `bottom`, `left` and `right` are the edges, `horizontal` runs between its rows and `vertical` between its columns. What a part covers is the whole table (`wholeTable`), the header row, the totals row, a column (`firstColumn`, `lastColumn`), one stripe (a stripe of `rowStripeSize` rows, or of `columnStripeSize` columns), or a single corner cell. So `wholeTable: { border: { top, bottom, left, right } }` draws a frame round the table and `{ horizontal, vertical }` draws a grid inside it, while `firstRowStripe: { border: { top, bottom } }` draws a line above and under each shaded stripe. A later part is drawn over an earlier one side by side, and a line between two cells is given to both, so they agree.

```ts
session.setTableStyle("Grid", {
  wholeTable: { border: { top: thick, bottom: thick, left: thick, right: thick, horizontal: thin, vertical: dashed } },
  headerRow: { bold: true, fill: "#1f3a5f", color: "#ffffff", border: { bottom: thick } },
});
```

Because of this, a line on `wholeTable.bottom` is one line under the table, not one under every row: use `horizontal` for a line under every row. The editor's **Line between rows** and **Line between columns** set the new lines, next to **Top line**, **Bottom line**, **Left line** and **Right line**, and the sample draws them. A cell's own border can't have `horizontal` or `vertical`.

## Structured references

| Write | Means |
|---|---|
| `Orders[Total]` | The data of one column |
| `Orders[[Qty]:[Total]]` | The data of several columns |
| `Orders` | All the data, without the header and totals rows |
| `Orders[#All]`, `Orders[#Headers]`, `Orders[#Totals]` | Everything, the header row, the totals row |
| `Orders[[#Headers],[Qty]]` | A part of a column: any of those with a column or columns |
| `Orders[@Qty]`, `[@Qty]`, `[@[Unit price]]` | The cell of a column in this row (`[@]` is the whole row), from a cell in the table's own rows |

Inside the table, the name can be left off (`[@Qty]*[@Price]`). Names with spaces or odd characters go in brackets, and `[`, `]`, `#`, `'` and `@` in a name are written with a `'` in front. A reference to a column that isn't there, or to the totals of a table without a totals row, is `#REF!`; `[@Qty]` outside the table's rows is `#VALUE!`. References are worked out from the table as it is now, so they follow it without being rewritten, and they are rewritten only when a table or a column is renamed.

Structured references work in formulas and defined names. The formula assist offers table names, and typing a table's name in the name box goes to its data.

## In the grid editor

**Insert > Table…** makes a table of the selected cells (or the block around the active one), with a name, a style and the choice of whether the first row holds headers. The table is drawn in its style: a header, shaded rows, and a totals row, with filter buttons on the header. **Insert > Slicer…** makes slicers for the columns you pick, and **Insert > Timeline…** a timeline for a column of dates. **Format > Table** (with a cell in the table active) renames it, changes its style or makes one, turns the header row, banded rows and columns, bold first and last columns, a total row and the filter buttons on or off, clears the filters, inserts a slicer, converts it to a range, or deletes it.

## In XLSX files

Each table is a `table` part, listed by its sheet's `tableParts`, with the name, range, columns, style and totals; formulas are written the way a file keeps them (`Orders[[#This Row],[Qty]]`). A totals cell that holds `SUBTOTAL(109, …)` is written as Excel's *Sum* function, text as a label, and anything else as a custom formula. A table has an `autoFilter` (which is what the filter buttons are: without one the buttons are off) that holds what each filtered column lets through and the sort: a `sortState` over the data rows with a `sortCondition` for each level (`descending`; for a sort by colour or icon `sortBy` of `cellColor`, `fontColor` or `icon` with the colour as a `dxfId` into the stylesheet, or `iconSet` and `iconId`; a colour sort's "descending" is "on bottom"). Excel for Mac drops a table's `sortState` when it opens a file, even a hand-made one that is valid and whose data is already in that order (and a sort made in Excel itself writes none when saved), so the sort levels shown in Pli's Sort dialog do not come back from Excel; that is Excel's behaviour, and Pli keeps them in its own round trip. The levels of a sort by an icon from Excel 2010's sets (`3Stars`, `3Triangles`, `5Boxes`) or by "no icon" have no place in the file's own list of icon sets, so those levels are left out when writing (the rows are in their sorted order all the same). A table with no header row has `headerRowCount="0"`.

Table styles of your own are in the stylesheet's `tableStyles`, their looks in its `dxfs`, with the lines between cells as the `horizontal` and `vertical` elements of a look's `border`. A filter that picks dates from the tree is `dateGroupItem` elements inside `filters` (`year`, `month`, `day`, `hour`, `minute`, `second` and `dateTimeGrouping`, next to any `filter` values and `blank`), for the sheet's own filter and for a table's. On reading, a table that isn't sound (a repeated column name, a name that clashes) stays plain cells and is named in `warnings`; a filter that isn't a list of values (by condition, colour or date) is left out and named in `warnings`, while the rows it hid stay hidden.

Slicers are the drawing in the sheet, a `slicers` part for the sheet, a `slicerCaches` part for each slicer that names the table and column, and a defined name for each cache, as Excel 2010 and later write them; slicers and timelines of pivot tables are written and read with the pivot table (see [Pivot tables](/sheets/pivot-tables/)). A slicer style of your own is, as [MS-XLSX](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-xlsx/c27949e2-eac5-4d88-9655-187392cab0aa) describes it, a table style (`pivot="0" table="0"`) with the looks of the whole slicer and its heading, plus a `slicerStyle` of the same name in the stylesheet's `slicerStyles` extension with the looks of the buttons.

Excel has timelines for pivot tables only (a timeline cache is defined by the pivot table it filters, [CT_TimelineCacheDefinition](https://msdn.microsoft.com/en-us/library/f45ff6ef-fb62-4e19-8e8c-822e3be9ef75) has no other source), so it has nowhere to keep a timeline over a table: what the file holds is the table's filter on the date column (the picks above, which Excel shows in its own date tree) and, so that Pli finds the timeline again, an extension of the worksheet (`pli:timelines`) that Excel doesn't know and passes by. Excel shows the filtered table, not the timeline, and drops the extension when it saves the file again.

LibreOffice reads the date picks and the lines between cells (it ignores table styles) and keeps the hidden rows; it writes a month pick back as the days of the month that the data has, which Pli reads as the same rows. LibreOffice opens Pli's tables, works their formulas out to the same numbers, applies the filters to the same rows, and writes them back as tables, which the test suite checks (it ignores the slicers, the slicer styles and all but the first level of a sort). Excel itself has not been checked, and slicers and slicer styles have had the least checking: they are written from the format's description and the files Excel makes, and nothing here has opened one in Excel. The check files `24-tables-more.xlsx` and `35-tables-sort.xlsx` are for that.

## Tables in other workbooks

A formula can name a table of a workbook that isn't open: `=SUM([Prices.xlsx]Orders[Total])`, or with the sheet, `=SUM([Prices.xlsx]Sheet1!Orders[Total])` (`'[Old prices.xlsx]Sheet 1'!Orders[Qty]` when a name needs quotes). Every part of a structured reference works (`[#Headers]`, `[#Totals]`, column spans); `[@Qty]` has no meaning outside its own table. Pli needs two things to work one out, both kept in the workbook (`externalBooks`): where the table is (its sheet, its range with the header and totals rows, its column names) and the cells of that range.

```ts
session.setExternalTable("Prices.xlsx", { name: "Orders", sheet: "Sheet1", range: "A1:C5", columns: ["Item", "Qty", "Total"], totals: true });
session.setExternalCells("Prices.xlsx", "Sheet1", { C2: 25, C3: 32, C4: 24.5 });
session.setCell("Sheet1", "A1", "=SUM([Prices.xlsx]Orders[Total])");   // 81.5
```

A host that can open the other workbook gives the session two resolvers: `externalTables(book, table)` answers with `{ sheet, range, columns, header?, totals? }` (or `null`), and `externalLists` (the one data validation uses, see [Data validation](/sheets/validation/#formulas-and-lists-that-read-other-workbooks)) answers for the cells. **Data > Refresh links to other workbooks** and `session.refreshExternalLists()` ask both; a table the host can't find is in `failed`, and the copy kept in the workbook stays in use. With no table kept, or a column that isn't in it, the reference is `#REF!`. A table of this workbook with the same name is never mixed up with it, and renaming the local one leaves the other's references alone.

In an XLSX file Excel has no place for another workbook's table definition, so a reference is written as the cells it stands for (`[1]Sheet1!$C$2:$C$4`, with the cells in the `externalLink` part) and the table's place is kept in an extension of that part that Excel ignores. Pli reads the file back with the cell reference (the same numbers); a table reference typed again afterwards uses the kept place.

## Not there yet

- A timeline over a table has no place in an Excel file (Excel has timelines for pivot tables only), so Excel shows the filter it makes and not the control.
- A sort by an icon from Excel 2010's icon sets, or by "no icon", is kept in the workbook but left out of the XLSX file's sort (the file format's list of icon sets does not have them). A range sort (not a table) is not remembered, and neither is the sheet's own filter's: Excel drops a sort it didn't make itself, so there is nothing for a file to carry.
- A reference to another workbook's table is written to an XLSX file as the cells it stands for, since Excel keeps no table definition for a workbook it isn't linked to; how Excel itself writes `=SUM([Prices.xlsx]Orders[Total])` has not been seen (kit file 54 says what to type).
