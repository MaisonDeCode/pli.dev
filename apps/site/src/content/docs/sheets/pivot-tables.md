---
title: Pivot tables
description: Sum up the records of a range or table by the items of some of its fields, with filters (several on one field), sorting by value, top and bottom items, grouping (groups inside groups), calculated fields and items, several ranges, data from other workbooks and the host, a data model with relationships and measures, slicers and timelines, styles of your own, kept formatting, ways to show a value, three layouts, GETPIVOTDATA, and pivot tables in XLSX files.
---

A pivot table sums up the records of a range or a table. Each record is a row of the source, and each column of the source is a field. Say which fields go down the side (rows), across the top (columns) and above the table (filters), and which fields are summed up in the body (values). The pivot table lists the different items of each field and fills its body with the sum, count, average or other summary of the records that have them.

The playground's **Pivot** sheet has a pivot table over its **Orders** sheet: region and item down the side, month across the top and the amount summed up in the body. **Insert > Pivot table…** (or **Data > Pivot table > Create pivot table…**) makes one from the selected cells, or from the block of data around the active cell.

## What a pivot table is in the workbook

A pivot table is a definition and some cells. The definition is `sheet.pivots`; the cells are ordinary cells of the sheet, so formulas can read them, they print, they are copied as values and Excel files carry them. The pivot table draws its cells again whenever it is changed or refreshed.

```ts
{
  id: "pivot_1", name: "SalesByRegion",
  source: "Orders!$A$1:$E$13",          // a range with the field names in its first row, or a table's name
  anchor: "A1",                          // the top-left cell, the filters included
  rows: [{ field: "Region" }, { field: "Item" }],
  columns: [{ field: "Month" }],
  values: [{ field: "Amount", fn: "sum", fmt: "$#,##0" }],
  range: "A1:E14",                       // the cells it was last drawn in
}
```

- **Fields** are named by the text of their header cells. An empty header is `Column3` and a repeated `Sales` is `Sales2`, as in Excel.
- **Items** are the different values of a field (or of a group of its values, see [Grouping](#grouping)). Text matches without regard to capitals. Numbers come first, then text, then logical values, then errors, and empty cells last as `(blank)`. `descending: true` runs each kind the other way. Items are shown in the number format of the first cell of their field in the source (dates stay dates).
- **The source follows the sheet**: inserted rows and columns, a renamed sheet and a table that grows (when the source is a table's name) all keep it pointing at the same records. If its cells are deleted the pivot table keeps what it drew and refuses to refresh.

## Making and changing them

```ts
const p = session.createPivot("Pivot", {
  source: "Orders!A1:E13",              // or a table's name: "Orders"
  anchor: "A1",
  rows: ["Region", { field: "Item", descending: true }],
  columns: ["Month"],
  values: [{ field: "Amount", fmt: "$#,##0" }, { field: "Qty", fn: "average", name: "Average qty" }],
  filters: [{ field: "Year", items: ["2025"] }],
});
session.updatePivot("Pivot", p.id, { columns: [], tabular: true });   // a field set to undefined goes back to its default
session.refreshPivot("Pivot", p.id);                                  // draws it again from the source as it is now
session.refreshAllPivots();                                           // every pivot table in the workbook, one undo step
session.deletePivot("Pivot", p.id);                                   // and its cells
session.deletePivot("Pivot", p.id, { keepCells: true });              // turns it into plain values
session.updatePivot("Pivot", p.id, { outline: true, valuesOnRows: true, calculated: [{ name: "Net", formula: "Sales - Cost" }] });
session.pivots("Pivot"); session.pivotAt("Pivot", "B4");              // the pivot tables on a sheet; the one a cell is in
session.pivotFields("Orders!A1:E13", "Pivot");                        // the field names of a source
session.pivotFieldItems("Orders!A1:E13", "Pivot", "Region");         // the items of one field, as they show
```

A pivot table is drawn only over empty cells (and the cells it was in before), never over another pivot table or over its own source. Making or changing one that wouldn't fit says which cell is in the way, and nothing changes. Like any change it is one undo step.

**A pivot table is not refreshed when its source changes**, as in Excel: change the data, then refresh it (**Data > Pivot table > Refresh**, or **Refresh all**). Its cells can't be typed over, cleared, pasted over, sorted, formatted or filled. They are refused with "Can't change part of a pivot table", and inserting or deleting rows or columns through one is refused. Inserting above or to the left of one moves it along. To change what it shows, change its fields; to keep what it shows as numbers, **Convert to values**.

## Fields in the areas

- **Rows and columns.** Each takes any number of fields, outermost first. Every field can sort its items (`descending`), leave out items (`hidden`, by the text they show: their records are left out of the sums and the totals), and turn off its subtotal (`subtotal: false`). A field may be in only one of rows, columns and filters, except that it may be placed again to group it another way ([below](#grouping)).
- **Values.** A value is a field and a function: `sum`, `count` (of anything not empty), `countNums`, `average`, `max`, `min`, `product`, `stdDev`, `stdDevp`, `var` or `varp`. With no `fn` it is `sum`, or `count` when the field holds text. The same field may be summed up in more than one way (give the later ones a `name`). The heading is `Sum of Amount` unless `name` says otherwise, and `fmt` is a number format for the results. An error in the data is an error in every sum that includes it, as in Excel.
- **Filters.** `filters: [{ field, items }]` lets only the records with those items through. They are drawn above the table: the field's name and `(All)`, the one item chosen, or `(Multiple Items)`.

### Sorting by a value

`sortBy: { value: 0, descending: true }` on a row or column field orders its items by what they come to for the value (counting from 0 in `values`) instead of by their own order, inside the item they sit in. Items with nothing to compare come last, and ties keep the field's own order.

```ts
rows: [{ field: "Region", sortBy: { value: 0, descending: true } }, { field: "Item", sortBy: { value: 0, descending: true } }]
```

### Top, bottom, label and value filters

`filter` on a row or column field leaves out items, and their records, from the sums and the totals:

| | |
|---|---|
| `{ kind: "top", by: 0, n: 5 }` | The 5 items with the greatest total of value 0 (`bottom: true` for the least) inside the item they sit in |
| `{ kind: "top", by: 0, n: 80, unit: "percent" }` | The greatest items that together make up the first 80 percent of the whole |
| `{ kind: "top", by: 0, n: 1000, unit: "sum" }` | The greatest items until their total reaches 1000 |
| `{ kind: "value", by: 0, a: { op: "greaterThan", value: 100 }, b: { op: "lessThan", value: 500 }, or?: true }` | Items whose total of the value passes one test, or two joined by and (or or) |
| `{ kind: "label", a: { op: "beginsWith", value: "W" } }` | Items whose text passes a test |
| `{ kind: "color", fill: "#ffff00" }` | Records whose cell in the source has that fill (`"none"` for no fill), or `{ kind: "color", font: "#ff0000" }` for a font colour (`"auto"` for the default one): the colours of the source cells as they are now, the way [filters by colour](/sheets/grid/#filters-by-condition) read a column. Records, not items: an item stays if any of its records has the colour, and its sums count only those. Refresh after recolouring the source. A grouped field can't have one |
| `{ kind: "date", period: "thisMonth" }` | Items that are dates in a period counted from today: `today`, `yesterday`, `tomorrow`, `thisWeek`, `lastWeek`, `nextWeek`, `thisMonth`, `lastMonth`, `nextMonth`, `thisQuarter`, `lastQuarter`, `nextQuarter`, `thisYear`, `lastYear`, `nextYear`, `yearToDate`, `q1` to `q4` and `m1` to `m12` of any year (the same periods as [filters by condition](/sheets/grid/#filters-by-condition)). Items that aren't dates are left out, and a grouped field can't have one |

The tests are the ones [filters by condition](/sheets/grid/#filters-by-condition) use: `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `contains`, `notContains`, `beginsWith`, `endsWith`, with `*` and `?` in the text. Text matches without regard to capitals. Several fields may have filters; they apply one after another, outer fields first and rows before columns, each on the records the earlier ones left.

### Grouping

`group` on a row or column field gathers its items:

| | |
|---|---|
| `{ by: "years" }` | Dates by year (2024, 2025) |
| `{ by: "quarters" }` | Dates by quarter (`Qtr1` for January to March of every year together) |
| `{ by: "months" }` | Dates by month (`Jan` of every year together, in calendar order) |
| `{ by: "days" }` | Dates by day of the year (`15-Jan`) |
| `{ by: "hours" }`, `{ by: "minutes" }`, `{ by: "seconds" }` | Times by the hour of the day (`9`), the minute (`0` to `59`) or the second, the same hour of every day together. The headings are `Hours`, `Minutes` and `Seconds` |
| `{ by: "dayRange", days: 14, start?, end? }` | Dates in ranges of 14 days, from `start` (a day number; the earliest date by default) to `end` (the latest): `1/1/2025 - 1/14/2025`, with `<1/1/2025` and `>…` for dates outside |
| `{ by: "number", step: 10, start: 0, end: 100 }` | Numbers in ranges `0-9`, `10-19`, …; `start` and `end` are the least and greatest by default, and the numbers outside get `<0` and `>100` |
| `{ by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }], name?: "Area" }` | Items you pick gathered under a name: the items no group takes stay as they are, the groups come in with the other items in their order (`Coasts`, `North`, `South`), and an item can be in one group only (the first to name it keeps it). The heading in the tabular and outline layouts is `name`, or the field's name and a 2 (`Region2`) |

A value that isn't a date (or a number) is an item of its own, after the groups. **Several parts at once** (years and months, or years, quarters and months) are the same field placed once for each part: `rows: [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "months" } }]`, and each shows as its own level (in the dialog, *Also group by* on a grouped date field adds the next one). Items you pick are grouped the same way: place the field with the group, and again as it is to keep its own items under the groups. In the tabular and outline layouts the headings are `Years`, `Quarters` and the field's name. `hidden` and `GETPIVOTDATA` name a group by what it shows.

### Your own order

`order: ["West", "East"]` on a row or column field puts those items first, in that order (by the text they show), and the items it doesn't name after them in their usual order, so an item that turns up later goes at the end. It replaces sorting: a field is sorted by a value, or in your order, not both (`descending` is ignored). In the dialog choose **Your own order** under *Sort by* and move the items with the arrows.

### Calculated fields

`calculated: [{ name: "Net", formula: "Sales - Cost" }]` makes a field out of others that `values` can name (`values: ["Net"]`). The formula works on the **sums** of the fields it names, in each cell of the table (as in Excel, so `Sales / Qty` is the total of Sales divided by the total of Qty, not an average of ratios). It has fields (`Sales`, or `'Unit price'` in quotes when the name has a space), numbers, `+ - * / ^`, unary minus and brackets, and no functions. Dividing by zero gives `#DIV/0!`. A calculated field can't be placed on the rows, columns or filters, can't use another calculated field, and can't have the name of a field of the source. It is always summed, whatever `fn` says, and can be shown as a share like any value.

### Calculated items

`calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }]` adds an item to a row or column field that is worked out from others of the same field. The formula has the items of the field by the text they show (`'North East'` in quotes when it has a space), numbers, `+ - * / ^`, unary minus and brackets. In each cell the item comes to the formula applied to what those items come to in that cell, with the value's own summary (so with `average` it is the average of East plus the average of West). It is listed with the field's other items, inside every item of the field outside it (with the inner items of the ones it uses), and an item it names that the field doesn't have makes `#REF!`. The records have no such item, so Show details finds nothing behind it. **Totals count the calculated item too**, as Excel's do, when the value is summed or counted: `Coasts` adds East and West again to the grand total. Items used by a calculated item may be left out (`hidden`) and the calculated item still adds them up. A calculated item can't have the name of an item already in the field, can't use itself, and a grouped field can't have one. In the dialog it is under *Calculated items*.

### Show as

`showAs` on a value shows each result in relation to others:

| `showAs` | Shows |
|---|---|
| `percentOfTotal`, `percentOfRow`, `percentOfColumn` | The share of the grand total, or of the total of its row or column |
| `percentOfParentRow`, `percentOfParentColumn` | The share of the item outside it on the rows (or on the columns), or of the grand total for an outermost item |
| `differenceFromPrevious`, `percentDifferenceFromPrevious` | The difference from the previous item of the innermost column field (the innermost row field when there are no columns), in the value's own format or as a percent of that item. The first item has nothing to compare with and is empty |
| `differenceFrom`, `percentDifferenceFrom`, `percentOf` | The difference from a chosen item (or its percent), or the share of it, set by `base` below |
| `runningTotal`, `percentRunningTotal` | Adds up along the same field (as a share of what the whole field comes to, 100% at its last item, for the percent) |
| `rankAscending`, `rankDescending` | The place among the items of the same field, 1 for the least (or the greatest) |
| `index` | Excel's index: `(value × grand total) / (row total × column total)` |

Totals and subtotals have no previous item, so differences, running totals and ranks leave them empty.

**What a comparison runs along** is `base: { field, item? }` on the value: `field` is the row or column field the items are compared in (without it, the innermost column field, or the innermost row field when there are no columns), and for `differenceFrom`, `percentDifferenceFrom` and `percentOf` the `item` is the text of the item to compare with, or `{ step: "previous" }` or `{ step: "next" }`. It works for running totals and ranks too (`base: { field: "Region" }` runs them down the regions even with columns). The item compared with is empty in a difference (and 100% in a share). **An item with no records counts as zero** beside the one it is compared with, as in Excel: a cell that is empty in a difference from February is minus February, and where neither has records it stays empty.

## A pivot table made of several ranges

`ranges: [{ source: "Data!A1:C3" }, { source: "Data!A6:C8", name: "Last year" }]` (Excel's *multiple consolidation ranges*) sums up several small tables of the same shape: each has row labels down its first column, column labels along its first row and numbers where they cross (the corner cell is ignored, and empty cells make no record). The records have four fields, `Row`, `Column`, `Value` and a page field `Page1` that holds the name of the range the record came from (`Item1`, `Item2`… unless `name` says otherwise). Put them in the areas like any others: `rows: ["Row"], columns: ["Column"], values: ["Value"], filters: [{ field: "Page1", items: ["Last year"] }]`. `source` is the first range. Ranges are written as ranges (not table names). In the dialog, list the other ranges under the source (one to a line, with a name after a comma).

**Page fields.** By default there is one, `Page1`, which names the range. `pageFields: 0` to `4` is Excel's *I will create the page fields*: the fields are `Page1` to `PageN`, and each range says what each calls it with `names: ["Now", "2024"]` (the first is `name`); two ranges may share a name in one page field as long as the whole list differs. A range without a name for a page field is `Item1`, `Item2`… in it. In the dialog it is *Page fields* under the source.

## Style

`style: { name: "PivotStyleMedium9", rowStripes: true }` draws the table's cells in one of Excel's 84 built-in styles: `PivotStyleLight1` to `28`, `PivotStyleMedium1` to `28` and `PivotStyleDark1` to `28` (laid out as in Excel's gallery: each row of seven is a dark one and the six accent colours), or `"none"` for plain cells. `rowHeaders: false` and `colHeaders: false` leave the labels and the headings without their look, and `rowStripes` and `colStripes` colour every other row or column of the body. Without a `style` the pivot table has a light blue heading. The look is the cells' own fills, fonts and borders (so it prints, copies and goes into other formats), built from the Office accent colours and the way the gallery is organised: the families and rows of the gallery differ in the headings (a line under them, a fill, a fill and a box), the lines between cells, the subtotals and the grand total. It follows Excel's styles without copying each of the 84 exactly. In the dialog it is *Style*.

### Styles of your own

`session.setPivotStyle("Pli blue", { headerRow: { fill: "#1f3864", color: "#ffffff", bold: true }, firstRowStripe: { fill: "#e7e6e6" }, totalRow: { fill: "#ffd966", bold: true }, firstSubtotalRow: { italic: true } })` defines a style of your own (`workbook.pivotStyles`, undoable); `style: { name: "Pli blue", rowStripes: true }` uses it, and `setPivotStyle(name, null)` removes it (tables that used it go back to the default look). Every part Excel's pivot styles have can be given a look (colours, bold, italic, underline, strike, font, size and lines, with `horizontal` and `vertical` lines between the cells of the part): `wholeTable`, `headerRow` (the column headings), `firstColumn` (the row labels), `totalRow` (the grand total row), `lastColumn` (the grand total column), `firstRowStripe` and `secondRowStripe` (with `rowStripeSize`, shown when `rowStripes` is on), `firstColumnStripe` and `secondColumnStripe` (with `columnStripeSize`, for `colStripes`), `firstHeaderCell` and `lastHeaderCell`, `firstSubtotalRow` to `thirdSubtotalRow` and `firstSubtotalColumn` to `thirdSubtotalColumn` (by level), `firstRowSubheading` to `thirdRowSubheading` and `firstColumnSubheading` to `thirdColumnSubheading` (the lines and headings of outer items, by level), `blankRow`, `pageFieldLabels` and `pageFieldValues` (the filters above the table). Parts are drawn over the ones before them in that order; the lines at the edge of a part are those of the block of cells it covers. A name can't be one of Excel's 84. The dialog lists them under *Your own*. In XLSX they are `tableStyle` elements with `table="0"` in the stylesheet.

## Data from outside the workbook

A pivot table's `source` can name data that isn't on a sheet of the workbook:

- **A range of another workbook**, written as Excel writes it, `[Prices.xlsx]Sheet1!$A$1:$D$20` (`'[Price list.xlsx]My sheet'!$A$1:$D$20` when a name has a space).
- **A named block** the host supplies or a CSV file fills, `data:Sales`.

Either way the rows are kept in the workbook as a *data block* (`workbook.dataBlocks`: the source, the rows with the field names first, the number format of each column, where it came from, its path and the day it was read), which is what Excel keeps in a pivot cache. The pivot table works from the block, so it works without the host or the other workbook, and it is drawn again from it on refresh. A block is part of the undo history when you set it with the session, and part of the saved JSON.

```ts
session.setDataBlock("data:Sales", [["Region", "Sales"], ["East", 10], ["West", 20]]);          // or { rows, formats, path }
session.importCsv("data:Targets", csvText);                                                    // numbers and dates typed; { typed: false } keeps text
session.setDataBlock("[Prices.xlsx]Sheet1!$A$1:$D$20", { rows, path: "file:///data/Prices.xlsx" });
session.createPivot("Pivot", { source: "data:Sales", anchor: "A1", rows: ["Region"], values: ["Sales"] });
session.dataBlocks(); session.dataBlock("data:Sales"); session.setDataBlock("data:Sales", null);
```

**The host's hook.** `pivotData` is how a host supplies and refreshes the rows. It is a function given `{ source, kind: "book" | "data", name, sheet?, range?, path? }` and answering the rows (the first holding the field names), `{ rows, formats }`, or `{ csv, delimiter? }`, or `null` when it can't find it (it may answer later):

```ts
const pivotData: PivotDataResolver = async ({ kind, name, sheet, range }) => {
  if (kind === "data" && name === "Sales") return { csv: await (await fetch("/exports/sales.csv")).text() };
  if (kind === "book") return rowsFromYourFileStore(name, sheet, range);
  return null;
};
<PliSheet session={session} pivotData={pivotData} />      // or new SheetSession(wb, { pivotData }) or session.pivotData = …
const result = await session.refreshPivotData();             // { updated, unchanged, failed: [{ source, reason }], offline, pivots }
```

`refreshPivotData` asks for each source a pivot table reads (also through the data model), keeps what it is told (with today's date, without a step of its own in the undo history), and draws the pivot tables that read what changed again in one undo step. A source the host fails to find keeps its rows and is listed in `failed`. `PliSheet` asks once when it gets the prop, and **Data > Pivot table > Refresh** and **Refresh all** ask before drawing. The playground's **Pivot** sheet has a pivot table over `data:Targets` with a `pivotData` that answers with CSV text.

A pivot table with `autoRefresh` also follows `setDataBlock`. Without a block (never read, or taken away) the pivot table can't be drawn and says which source has not been read.

## The data model

A **data model** is several tables with relationships between them and measures over them, so one pivot table can use the fields of related tables (`workbook.model`, `session.setDataModel(model | null)`, undoable, drawn again for the pivot tables that read it):

```ts
session.setDataModel({
  tables: [{ name: "Orders", source: "Data!A1:E40" }, { name: "Customers", source: "Customers!A1:C20" }, { name: "Targets", source: "data:Targets" }],
  relationships: [{ from: { table: "Orders", column: "CustomerId" }, to: { table: "Customers", column: "Id" } }],   // many side → one side
  measures: [
    { name: "Total sales", table: "Orders", expression: "SUM(Orders[Amount])", fmt: "$#,##0" },
    { name: "Customers served", table: "Orders", expression: "DISTINCTCOUNT(Orders[CustomerId])" },
    { name: "Per customer", table: "Orders", expression: "[Total sales] / [Customers served]" },
  ],
});
session.createPivot("Pivot", { source: "ThisWorkbookDataModel", anchor: "A1", rows: ["Customers[Region]"], values: [{ field: "Total sales" }, { field: "Orders[Qty]", fn: "sum" }] });
```

A table's `source` is a range with the column names in its first row, a table's name, or a data block. The pivot table's source is `ThisWorkbookDataModel` (Excel's own name), and its fields are called `Table[Column]`. A relationship follows its many side to the one side (`Orders[CustomerId]` to `Customers[Id]`, whose values must be unique), through chains of them; a table reached two ways is read through the first. Each value (a column with a function, or a measure) counts the rows of its own table, filtered by the items on the rows and columns that it can reach through the relationships; items from a table it cannot reach show as `(blank)`, as in Excel. Only the tables the values read give the table its lines, so customers with no orders are not listed (a measure over the customer table lists them).

**Measures** are DAX-style: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT` (numbers), `COUNTA`, `DISTINCTCOUNT` over a column (`Orders[Amount]` or `'Order lines'[Amount]`), `COUNTROWS(Table)`, `DIVIDE(a, b, [if zero])`, `ABS`, `ROUND`, `SQRT`, `MIN`/`MAX` of two values, other measures in brackets (`[Total sales]`), numbers, `+ - * / ^` and brackets. A measure is worked out for the records of each cell, so a ratio of two measures is the ratio of their totals. A measure is a value only (not a row, column or filter), and can be shown as a share, ranked and so on like any value. `DISTINCTCOUNT` is also a function of an ordinary value (`fn: "distinctCount"`, *Distinct count* in the dialog), in any pivot table. Setting a model checks the tables, the relationships and the expressions (a bad one is refused with what is wrong); a table or column that isn't there when the pivot table is drawn is named in the message.

**Measures that work in the filters of a cell.** A measure that uses `CALCULATE`, a filter function, `IF`/`SWITCH`, an iterator or a time function (or names another measure that does) is worked out over the model's rows that pass the cell's filters: the items of its row and column, the filters above the table, slicers and timelines. `CALCULATE(expression, filter, …)` works the expression out again with its filters changed. A filter on a column (`Orders[Region] = "West"`, `<>`, `<`, `>`, `<=`, `>=`, `IN { "East", "North" }`, joined with `&&` or `||` on the same column) **replaces** the cell's filters on that column; `KEEPFILTERS(…)` adds to them instead. `ALL(Table)`, `ALL(Table[Column])`, `REMOVEFILTERS(…)`, `ALLEXCEPT(Table, Table[Column], …)` take filters off, and `ALLSELECTED(…)` takes off the items of the rows and columns but keeps the filters above the table and the slicers. `FILTER(table or column, condition)` keeps the rows of a table (`FILTER(Orders, Orders[Amount] > 25)`) or the values of a column whose condition holds (`FILTER(ALL(Calendar[Month]), [Total] > 100)`, where the measure is worked out for each month in the cell's filters). Also `VALUES`, `DISTINCT`, `SELECTEDVALUE`, `HASONEVALUE`, `ISFILTERED`, `COUNTROWS(FILTER(…))`, the iterators `SUMX`, `AVERAGEX`, `COUNTX`, `MINX` and `MAXX` over the rows of a table, `IF`, `SWITCH`, `AND`, `OR`, `NOT`, `ISBLANK`, `BLANK`, `COALESCE`, `INT`, comparisons, `&&`, `||`, text in quotes, and `DATE`, `YEAR`, `MONTH`, `DAY` and `TODAY`.

**Time intelligence** reads the dates of the table the date column is in (`Calendar[Date]`): the dates that pass the cell's filters on that table are the dates in view, and a time function gives a set of dates that **replaces every filter on that table**, as it does for a table marked as a date table in Excel. `TOTALYTD`, `TOTALQTD`, `TOTALMTD` (`TOTALYTD([Total], Calendar[Date])`, with a year end as text for a fiscal year: `"6-30"`), `DATESYTD`, `DATESQTD`, `DATESMTD`, `SAMEPERIODLASTYEAR`, `DATEADD(dates, n, DAY | MONTH | QUARTER | YEAR)`, `PARALLELPERIOD`, `PREVIOUSDAY`/`MONTH`/`QUARTER`/`YEAR`, `NEXTDAY`/`MONTH`/`QUARTER`/`YEAR`, `DATESBETWEEN`, `DATESINPERIOD`, `FIRSTDATE`, `LASTDATE`, `STARTOFMONTH`/`QUARTER`/`YEAR`, `ENDOFMONTH`/`QUARTER`/`YEAR`, and `CLOSINGBALANCEMONTH`/`QUARTER`/`YEAR` and `OPENINGBALANCE…` (the value on the last day in view, and on the day before the first). They nest (`SAMEPERIODLASTYEAR(DATESYTD(Calendar[Date]))`). Give the model a table with a row for every day, as Excel wants, and relate the orders' date to it: with only the days that have records, a period without records has no days to move to, so `PREVIOUSMONTH` of a month with no orders is empty. Where a time function is used in a filter above the dates (a year on the rows), a year's own row is its last month's year to date. Filters from a table the date table can't see (a region) are kept.

## Several filters on one field

`filter` and `filters` on a row or column field are filters that all have to pass: `{ field: "Region", filter: { kind: "label", a: { op: "notEquals", value: "South" } }, filters: [{ kind: "value", by: 0, a: { op: "greaterThan", value: 50 } }], hidden: ["West"] }` keeps the regions that are not South, whose total is above 50, and are not unticked in the item list (Excel's *Allow multiple filters per field*). A field has at most one filter of each kind: by label (or date), by value (or top/bottom), and by colour. Filters by label and date are applied first, then by value or top in the order given, each on the items the earlier ones left. In the dialog a *second filter* of the other kind is under the field's filter. Excel files carry them as several `filter` elements of one field (each with its own `evalOrder`) with `multipleFieldFilters="1"`.

## Groups inside groups

A grouping by items can group groups again: `group: { by: "items", name: "Everything", groups: [{ name: "Anywhere", items: ["Coasts", "North"] }], of: { by: "items", name: "Pair", groups: [{ name: "Coasts", items: ["East", "West"] }] } }`. The inner grouping (`of`) is the one the field already had, and the items of the outer groups name what the inner one shows (its groups, and items it left alone). Place the field once for each level you want to see, as with dates (`rows: [outer, inner, plain]`); the headings default to the field's name and a number (`Region2` for the first grouping, `Region3` for the one over it). Groups can be nested up to six deep, and a group can't have the name of one inside it. Dates grouped by years, quarters and months at once are the nested date groups. In Excel files each level is a cache field of its own made over the plain field (`discretePr`), tied to the group above it by `par`.

## Looks kept on cells

Colours, fonts, lines and number formats you give the cells of a pivot table (`setStyle`, `setFormat`, or the toolbar) are kept in the pivot table (`pivot.formats`, Excel's *Preserve cell formatting on update*) instead of being refused. A look is kept for what the cell stands for: the items of its row and its column (each a field's heading and the item it shows), and which value, so it follows the cell when the table is refreshed, when items are added, when a field moves from the rows to the columns, and returns when an item comes back after being hidden. A look given to a row label or a column heading is kept for that label; to the corner or the filter cells it is not kept. Giving a look back to what the table draws (or taking one off with `null`) changes the format; changing a value in the table is still refused. `session.formatPivot(sheet, id, area, { style, fmt })` and `clearPivotFormats` do it from code (`area` is `{ part: "data" | "label", items?, value?, grand? }`: without `items` every cell of the part, `grand: "row"` or `"column"` for the grand total's cells). Excel files carry them as the pivot table's `formats` (alignment, indent and wrapping stay in the cells and are kept only by Pli).

## Slicers and timelines

A **slicer** is a panel of buttons, one for each item of a field, drawn over the grid beside the pivot table; a **timeline** is a strip of months (or years, quarters or days) to pick a stretch of dates from. They have no filter of their own: a slicer picks the items of the field the way the field's own filter does (the row or column field's left-out items, or the page filter's items, or, for a field the table doesn't use, a filter that is not shown above the table: `filters: [{ field, items, hidden: true }]`), and a timeline keeps the dates from `start` to `end` of its date field. Choosing in either redraws the pivot table in the same undo step. They live on the pivot table (`pivot.slicers`, `pivot.timelines`) and stay on its sheet.

```ts
const slicer = session.addPivotSlicer("Pivot", p.id, { field: "Region", caption: "Where", columns: 2, style: "SlicerStyleDark2" });
session.pivotSlicerItems(slicer.id);                         // [{ value: "East", count: 3, selected: true, available: true }, …]
session.pivotSlicerSelect(slicer.id, ["East", "West"]);     // null lets everything through
const line = session.addPivotTimeline("Pivot", p.id, { field: "When", level: "quarters" });
session.pivotTimelineBounds(line.id);                        // { min, max } as whole day numbers
session.pivotTimelineSelect(line.id, start, end);            // both null lets every date through
session.updatePivotPanel(slicer.id, { ...slicer, width: 240 }); session.deletePivotPanel(line.id);
session.pivotSlicers("Pivot"); session.pivotTimelines("Pivot");
```

In the grid a click on a button picks that item (Ctrl or Shift+click adds or removes one, clicking the only one picked lets all through, and the ✕ in the heading clears); a click on a period of a timeline picks its dates, Shift+click stretches the dates already picked to it, and clicking the only period picked or the ✕ clears. Drag the heading to move one, the corner to resize it, scroll over it for more buttons, and right-click for settings and delete. The *available* flag dims an item that no record passes the table's other filters for. They move with the rows and columns inserted above or left of them. In the dialog they are under *Slicers and timelines* once the pivot table exists.

## Refreshing by itself

`autoRefresh: true` makes the pivot table draw itself again whenever the cells it reads change: a cell typed in its source range, rows or columns inserted or deleted there, a table it reads from growing or shrinking. It happens as part of the same undo step as the change, so undoing the edit takes the numbers back too, and a source that has gone leaves the table as it was. Without it a pivot table stays as drawn until it is refreshed. In the dialog it is *Refresh when the source changes*. Excel files don't carry the setting (Pli marks every pivot table to refresh when the file is opened).

## Layouts

**Compact** (the default) puts all the row fields in one column headed `Row Labels`, each one step in from the one outside it. An outer item carries the subtotal of the items inside it. Column fields run across under a `Column Labels` heading, with a subtotal column (`East Total`) after each group when a field has another inside it. With several values they sit side by side under each column item.

**Outline** (`outline: true`) gives each row field a column of its own, named after the field, and keeps each outer item's subtotal on the item's own line, above the items inside it.

**Tabular** (`tabular: true`) is outline with each subtotal on a row of its own below its group (`East Total`).

A pivot table is in one of the three: choosing one lets go of the others. `repeatLabels: true` writes an outer item again on every line instead of once for its group (outline and tabular). `blankRow: true` on a row field leaves an empty line after each of its items. `grandTotalRows: false` and `grandTotalColumns: false` leave out the `Grand Total` row and column.

`valuesOnRows: true` (with more than one value) lists the values down the rows instead of across the columns. In the compact layout each item is followed by one line for each value, one step in; in outline and tabular a `Values` column names them. The grand total has a line for each value (`Total Sum of Sales`), and the column headings show `Total` when there are no column fields.

## Reading a pivot table from formulas

`GETPIVOTDATA(data_field, pivot_table, [field1, item1], …)` gives what a pivot table shows for a value and some of its items. `data_field` is the value's heading (`Sum of Sales`) or its field (`Sales`), `pivot_table` is any cell in the pivot table, and each pair names a field of the rows or columns and one of its items. Fields you leave out stand for their total, so `GETPIVOTDATA("Sales",A3)` is the grand total and `GETPIVOTDATA("Sales",A3,"Region","East")` is East's subtotal. Items are matched by the text they show without regard to capitals, or by number; a field of the filters may be named if the item is the one let through. Anything the pivot table doesn't have gives `#REF!`.

Pli works the result out from the pivot table's source and definition, as a refreshed pivot table would show it, so it follows the data without waiting for a refresh (Excel reads what is drawn). It is shown the way the value is shown (a share, a rank).

## Show details

`session.pivotDetails(sheet, "H5")` gives the records of the source that a number in the body of a pivot table adds up: `{ pivot, fields, records, rows }`, where `rows` are the sheet rows the records came from. It works for a cell, a subtotal and a grand total, follows the columns, the filters, the items left out and the filters on items, and with values down the rows it takes the line of the value. A heading, a label or an empty cell gives `null`. `session.showPivotDetails(sheet, "H5")` lists them on a new sheet called `Details` (`Details 2`…), with the source's headings in bold and its number formats, as one undo step; in the grid it is **Data > Pivot table > Show details**. Both work from the source as it is now, so they find records added since the last refresh even though the cell hasn't changed.

## In the grid

The dialog (**Insert > Pivot table…**) takes the source, where to put it (a new sheet, or a cell of an existing one) and, for each field, which area it goes in. Under it each area lists its fields in order, with buttons to move and remove them. A row or column field has its sort (item order, your own order or by a value, and the direction), grouping (dates, times, days in ranges, numbers, items you pick, and *Also group by* for several parts at once), filter (top, bottom, by label, by date period, by value or by a colour of the source cells), subtotal, blank line, and the items to leave out; a value has its function, how to show it (with the field and the item a comparison runs along), heading and number format. Further down are the calculated fields and items, the style, the slicers and timelines and the layout (compact, outline or tabular, repeating labels, values down the rows, refreshing by itself, grand totals). Under the source, *Other ranges to combine* makes a pivot table of several ranges (with *Page fields*); the source box also takes a range of another workbook, `data:Name` or `ThisWorkbookDataModel`. Click a cell in a pivot table and use **Data > Pivot table** to edit, refresh, convert to values or delete it.

## In XLSX files

A pivot table is a pivot table part, a pivot cache definition and the cells. Pli writes the cache **without a copy of the records** and marks it to refresh when the file is opened, so Excel draws the pivot table again from the source. Pli reads the fields, layout (compact, outline or tabular), filters, sort, sort by a value, your own order (a manual sort), top and bottom filters, hidden items, blank lines, repeated labels, calculated fields, subtotals, grand totals, functions, "show as" settings it has counterparts for (with the field and item they run along) and headings of the pivot tables in a file.

Grouping is written the way Excel does it. A date or number field that is grouped becomes a cache field with a `fieldGroup` (`rangePr` with `groupBy` years, quarters, months, days, hours, minutes or seconds, a `groupInterval` for ranges of days or numbers, and the list of groups in `groupItems`, with `<` and `>` items for what lies outside); grouping by several parts at once is one cache field for each part, the finest being the date field itself and each coarser one a field of its own (`Years`, `Quarters`) tied by `par`. Items you pick are a field of their own (`Region2`) with a `discretePr` that says which group each item of the field goes under. Values down the rows are `dataOnRows` with `-2` among the row fields and a row item for each value of each item. Filters by label, date and value are `filter` elements with `captionBeginsWith`, `valueGreaterThan`, `dateBetween`, `thisMonth` and the like, and "rank", "percent running total" and "share of the parent" are in the data field's `x14:dataField pivotShowAs` extension. Calculated items are in the cache's `calculatedItems` (and the field's shared items), a pivot table of several ranges is a `consolidation` cache source, the style is `pivotTableStyleInfo`, a slicer or timeline is a slicer cache (`pivotTables`, `tabular` with the items picked) or timeline cache (`state` with the dates) beside the sheet's drawing, and the items a slicer leaves out of a field the table doesn't use are `h="1"` items on that field.

All of it is written and read back to the same definition (the tests write each kind, read it back and compare), and the package check passes; **how Excel draws it has been checked only for what files 15, 17 and 20 cover**, so file 25 asks Excel about each of the rest (see below).

**The rest, written for file 36.** A pivot table over a range of another workbook has `<worksheetSource ref sheet r:id>` in its cache, where the relationship (`externalLinkPath`, external) names the file and the cache's `pivotCacheRecords` part holds the rows (so the cache is saved and Excel is not asked to refresh on opening); reading it back makes the data block again. Several filters on a field are several `filter` elements with the same `fld` and an `evalOrder` each, with `multipleFieldFilters="1"`; groups inside groups are a cache field for each level (`fieldGroup` with `discretePr`, `par` pointing at the group above, `base` at the plain field); a style of your own is `<tableStyle name table="0">` with a `tableStyleElement` for each part, pointing at `dxfs`; looks kept on cells are `formats` (`format dxfId` with a `pivotArea` of `references` to the items, `labelOnly` for labels, `grandRow` and `grandCol` for the totals), written before `conditionalFormats`; a consolidation with page fields of its own is `consolidation autoPage="0"` with a `page` of `pageItem`s for each page field and `i1` to `i4` on each `rangeSet`. The data model, `data:` blocks and distinct counts are written as the cells the pivot table drew, with the model, the blocks and each such pivot table's definition in Pli's extension of the workbook part (`pli:pivots`).

What the file format can't hold the way Pli means it is **written as the plain cells it drew** (the file has no pivot table, and nothing is lost from the numbers): a filter by colour of the source cells, a filter by label with an empty-text test or two tests joined in a way Excel's filters aren't (only *between* and *not between* have two), a field grouped by ranges (dates, times or numbers) that is also placed plainly, summed or used as a filter, a calculated item on a grouped field, and more than one number or day-range grouping of a field. Blank lines and repeated labels are written for the outline and tabular layouts only (the compact layout draws no blank lines in Pli). The same goes for reading: a pivot table that sums up data that isn't in a sheet of the workbook, has blank lines or settings kept in Excel's extensions that Pli doesn't read (a "% of parent" that names a field), filters in a way Pli doesn't read, groups in a way Pli doesn't have, or shows a value against something other than the previous item or the same field it runs along, stays as plain cells, with a warning that says why. Excel's slicers and timelines read onto the pivot table they filter when it is on the same sheet; one that filters several pivot tables is kept on the first, and one on another sheet is left out with a warning.

LibreOffice reads Pli's pivot tables and its sums agree with Pli's for all the functions above, for sorting by a value, outline form, top items, values down the rows, dates grouped by month, quarter and ranges of days, numbers in ranges, and a style (it ignores the filters by label, the value filter *between*, and the items a slicer leaves out of a field the table doesn't use, and shows the years as text); the checks run in the tests when LibreOffice is installed. LibreOffice ignores the "show as" settings, so differences and running totals are only checked against Pli's own sums; it agrees with Pli on your own order, blank lines, repeated labels and calculated fields too. The files made by `pnpm excel-check:make` (see [Checking against Excel](/sheets/files/#checking-against-excel)) include pivot tables (files 15, 17, 20 and 25).

**Files 15, 17, 20 and 25 have been opened in Excel for Mac:** Excel found a calculated item written the wrong way (the item must not be marked `f`, and its `calculatedItem` names the field) and dropped every pivot table in file 25 until that was fixed; now all twelve of file 25 open, refresh, and agree with Pli's numbers (calculated items, picked groups, years and months, day ranges, hours, values down the rows, label, value and date filters, show as, styles, and a consolidation).

Files 15, 17 and 20: it opened them without a repair message, refreshed every one from the source, and its numbers and layout agree with Pli's for all of them, including calculated fields, blank lines and repeated labels, your own order, differences from a chosen item, percent of an item and a running total down the rows. Two things were found that way and are done as Excel does them: several values with no column field get a `Values` caption row over the headings, and an item with no records counts as zero in a difference or running total. The one difference left is cosmetic: when Excel draws an outline or tabular pivot table again it writes `Row Labels` over the first column where Pli writes the field's name.

**Files 25 and 36 have been opened in Excel and saved back** (11 Nov 2026): every pivot table opened without a repair message, and `pnpm excel-check:read` now reads all of them back as pivot tables. Reading Excel's own saved forms found and fixed: a group of items (Excel writes `<fieldGroup par="6"/>` on the field it is made over, lists that field's items although it is on no axis, and may reorder its shared items), a column of times (Excel's cache dates a time of day 30 December 1899, and captions hours `8 AM`, `12 PM`), formats without a `type` or an `action` (Excel leaves out the defaults), and a different order of the format elements.

Writing changed to match what Excel rewrote: a column of dates is a field of dates in the cache (Excel dropped the date filter of a field whose cache held numbers), day ranges, number ranges and hours are sorted **manually** (Excel sorts their captions as text, putting `1 PM` before `8 AM`, when the field says ascending), the field of a value filter is marked `measureFilter`, `firstHeaderRow` is always 1 and the one column item of a table without column fields is `<i/>`, a timeline's bounds are whole years, and the cells under some items (a rule for selected cells) get an area for each inner level, because Excel counts only the level of the last item named for the first.

Open: Excel hid a calculated item (`Coasts`) after refreshing file 25: file 43 writes the item six ways side by side to find the one Excel keeps.

## Not there yet

- **The data model is Pli's own in Excel files.** Excel keeps its data model (the tables' rows, the relationships and the DAX measures) in a binary part, `xl/model/item.data`: a compressed Analysis Services backup that only Excel writes, so it cannot be produced from outside. A pivot table over `ThisWorkbookDataModel`, over a `data:` block or with a distinct count is therefore written as the cells it drew, and Pli's extension of the workbook part (which Excel ignores) keeps the model, the blocks and each such pivot table's definition, so Pli opens the file with them again. Excel opens such a file without a message and shows the cells, with no PivotTable Analyze tab; writing a connection to a model whose part isn't there would make Excel repair the file, so none is written. A pivot table made over Excel's own data model is read as the cells Excel drew, and the warning names the tables and measures its cache lists (the rows, the columns of the relationships and the measures' formulas are only in the binary part). There is no many-to-many relationship or choice of filter direction, and no hierarchies; filters flow from the one side to the many side only.
- **A range of another workbook is a copy.** The file holds the rows Pli last read (the cache's records) and the path of the other file; Excel's **Refresh** on it needs that file where the path says (Pli never asks Excel to refresh it on opening). Connections Excel makes itself (ODBC, OLE DB, text files and Power Query) are read as plain cells; a `data:` block has no counterpart in Excel files.
- **Nesting groups is limited to groups of items.** A group of dates or numbers can't be grouped again by items, and a group of groups is written over the plain field (every level made over it). LibreOffice reads the field but not the groups made over it.
- **Kept looks** hold colours, fonts, lines, number formats, alignment, indent and wrapping in Excel files (the differential format Excel keeps for a format holds all of them). A look on the corner and filter cells isn't kept, taking a look off (`null`) isn't written to Excel, and formats Excel itself makes in other shapes (every cell of a level, subtotals only) read the pivot table as plain cells.
- **Not checked in Excel:** a calculated item after Excel refreshes (file 43), the date filter on a field whose cache now holds dates (file 25's `DateFilter`), `Hours` and day ranges in manual order (file 25), and the rule for the cells under some items with its areas for the inner levels (file 33). They pass the package check and Pli's own reading; what Excel does with them is the open question, and the files say what to look for.
- The 84 styles follow Excel's gallery (families, rows of seven, accent colours, headings, stripes, subtotals, grand total) but are not a copy of each. A style of your own draws the lines of a part around the block of cells it covers (a row, a column, the table) without Excel's finer rules for corners and where two parts meet.
- Hours, minutes and seconds are written as the numbers 0 to 23 and 0 to 59, where Excel captions the hours `8 AM` (in the US setting; Pli reads those captions, and the file's captions are Excel's to redraw on refresh). Excel's captions for minutes and seconds were not seen.
