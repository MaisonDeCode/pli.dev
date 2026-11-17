---
title: Charts
description: Column, bar, line, area, pie, scatter, doughnut, radar, bubble, stock, surface, waterfall, histogram, box-and-whisker and the rest of Excel's chart kinds, combined or on second axes, with trendlines, error bars and axis scales, that sit over a sheet, follow their cells, and travel in XLSX files.
---

A chart is drawn from cells and sits over the grid. Change a number and the chart follows; insert a row above the data and the chart's references move with it, as formulas do. Charts are part of the workbook, so they are saved in its JSON, undone with the cells, and written to and read from Excel files.

The playground's spreadsheet has a **Charts** sheet with one of each of the first six kinds, drawn from a year of sales. Open it from a clone of the repository with `pnpm playground`, then Sheets.

## In the grid editor

**Insert > Chart** (or **Insert chart** in the right-click menu) charts the selected cells, or the block of data around the active cell. It reads them the way a person would pick the parts:

- A first column of text or dates gives the labels along the bottom.
- A first row of text gives each series its name.
- Every column with numbers is a series. A column of text that isn't the first (notes, say) is left out.
- Dates down the first column make a line chart; anything else makes columns. Pick another kind from the Chart submenu.

**Insert > Chart** lists every kind; the statistical ones (histogram, Pareto, box and whisker, waterfall, funnel, treemap, sunburst) are under **Statistical**. A pie, a doughnut and the statistical kinds take the first column of numbers; a bubble chart takes x, y and size (or, with labels in the first column, y and size); a stock chart takes three to five columns (high, low, close, with an open and a volume in front).

The chart appears to the right of the data and is selected:

| | |
|---|---|
| Move | Drag the chart |
| Resize | Drag a handle on a corner or an edge |
| Edit | Double-click, or right-click > **Edit chart…**: the kind, title (and its pieces), labels, each series (name, values, colour, its own kind, its axis, its trendlines, its error bars), stacking, legend, axis titles, the scale, gridlines, tick marks and labels of each axis, fonts, smooth lines, what the labels on the marks say and where they go, and the options of the kind (hole size, pie angle and explosion, bins, totals, quartiles, stock look…) |
| Delete | Delete or Backspace, or right-click > **Delete chart** |
| Switch rows and columns | Right-click > **Switch rows and columns**, or the button in the editor: every series becomes a category and every category a series ([series by rows](#series-by-rows)) |
| Pick a mark | Click a column, bar, slice, point, bubble or step of a chart that is selected (or press **M** to pick the first, and the arrow keys to move on: left and right along a series, up and down between series; Escape lets go). A panel under the chart sets that one mark's fill, and how far a slice is pulled out ([colours of single points](#colours-of-single-points)) |
| Turn a 3-D chart | Drag inside the plot of a selected 3-D chart (across turns it, down tilts it), or hold Alt and press the arrow keys ([3-D](#3-d)) |
| Move a trendline label | Drag the label of a selected chart |
| Order | Right-click > **Bring to front** or **Send to back**; **Duplicate** makes a copy |

Moving, resizing, editing and deleting are each one undo step. In a read-only sheet a chart can be selected but not changed. Rows and columns that are hidden (by a filter, say) are left out of the chart, as in Excel.

## The kinds

| `type` | Shows | Options |
|---|---|---|
| `column` | One bar per value, going up | `grouping`: `stacked`, `percent` (100% stacked) |
| `bar` | The same, going across | `grouping` |
| `line` | A line through each series | `grouping`, `smooth`, `markers: false` |
| `area` | A filled line | `grouping` |
| `pie` | The first series as slices, labelled from the categories | `firstSliceAngle` (0 to 360°, clockwise from twelve o'clock; also on `doughnut`), and on each series `explosion` (0 to 400, % of the radius the slices are pulled out) and `pointExplosion` (`{ "1": 40 }`, by point number from 0) |
| `doughnut` | Rings of slices, one ring for each series | `holeSize` (10 to 90, % of the width) |
| `pieOfPie`, `barOfPie` | A pie whose smaller points are moved to a second pie, or to a stacked bar, joined by lines | `split` (`{ by: "position" \| "value" \| "percent", at }`, or `{ by: "custom", at: 0, points: [0, 3] }` for the points you choose, counting from 0; the last 3 points if left out), `secondSize` (5 to 200, %) |
| `scatter` | Points at x and y (not at labels), from `x` and `values` | `smooth`, `lines` (straight lines between the points), `markers: false`: the five Excel subtypes |
| `bubble` | Points whose size is a third value: `x`, `values` and `size` for each series | `bubbleScale` (0 to 300, %) |
| `radar` | One spoke for each category, one polygon for each series | `filled`, `markers: false` |
| `stock` | High-low lines, with a body from open to close when there is an open, and optionally volume columns on the left axis with the prices on the right | `stock`: `hlc`, `ohlc`, `vhlc`, `vohlc` (the series are, in order, volume (v), open (o), high, low, close); `stockLook`: `{ hiLowLines, hiLowColor, upDownBars, upColor, downColor, gapWidth }` |
| `surface` | A mesh over the categories (along) and series (back), coloured in bands of the value axis that follow the lines of equal height (the mesh is cut where the value crosses a step of the axis, with a contour line there) and with the series named along the depth axis, seen in 3-D; from straight above (tilt 90°) it is Excel's contour chart | `view3d`, `wireframe` |
| `waterfall` | Floating bars that add up, with totals standing on the axis | `totals` (the points, counting from 0, that are totals), `waterfall: { connectors: false }` |
| `histogram` | How many values fall in each bin; with several series, side by side in shared bins | `bins`: `{ by: "auto" \| "width" \| "count", size, overflow, underflow, closed }` |
| `pareto` | Bars from the biggest down, and a line of the running share on a second axis in percent; with several series, each has its bars and its own line, in the order of the first | |
| `boxWhisker` | A box from the first to the third quartile with the median, whiskers, mean markers and outliers; one box for each series, or each category when there are labels | `box`: `quartile` (`exclusive` or `inclusive`), `meanMarker`, `meanLine`, `innerPoints`, `outliers` (Excel has no other whisker settings: the whiskers always reach the furthest value within 1.5 box lengths) |
| `funnel` | Centred bars that shrink with the values | |
| `treemap` | Tiles sized by value, grouped by the levels in the labels | `parentLabels`: `banner`, `overlapping`, `none` |
| `sunburst` | The same hierarchy as rings | |

The first six kinds and `doughnut`, `radar`, `bubble`, `stock`, `surface`, `pieOfPie` and `barOfPie` are Excel's classic kinds; the last seven (`waterfall` to `sunburst`) are the "chartex" kinds that Excel 2016 added. Stacked and 100% stacked columns, bars, lines and areas, and scatter charts with smooth lines or none, are options of the first four and of `scatter`, as above.

Only where Excel has them are there 3-D versions: `column`, `bar`, `line`, `area` and `pie` take `view3d` ([3-D](#3-d)), and `surface` always has one.

### Histogram bins and quartiles

The bins follow Excel's rules: `auto` cuts at Scott's width (3.5 s over the cube root of the count, s being the sample standard deviation) from the smallest value, with the last bin reaching past the largest; `width` and `count` are as asked; the first bin includes both its ends and each other bin includes its upper limit (`closed: "left"` swaps that, and then the last bin includes both ends); `underflow` and `overflow` add a bin for the values at or below, and above, the limits, and a `count` **includes** those two bins among the bins asked for, as Excel's pane says. A histogram of several series cuts all the values together and counts each series into the same bins. The quartiles of a box chart are QUARTILE.EXC (`exclusive`, the default) or QUARTILE.INC (`inclusive`), and the whiskers reach the furthest values within 1.5 box lengths of the box; `boxStats`, `histogramBins` and `quantile` are exported.

All of them take `title`, `titleRuns` (the title in pieces, each with its own `bold`, `italic`, `underline`, `color`, `size` and `family`; `title` is then their text), `font` and `titleFont` (`{ family, size, bold, italic, color }`; sizes in points), `legend` (`top`, `bottom`, `left`, `right`, `none`; the default is the bottom, and a single series has none unless asked), `labels` (the values on the marks) and, where they have axes, `xTitle` and `yTitle`. The axes are rounded to steps of 1, 2 or 5, and start at zero for columns, bars and areas, unless `axes` says otherwise. `labelShow` (`["value", "category", "series", "percent"]`) says what the labels on the marks say and `labelPosition` where they sit (`center`, `insideEnd`, `insideBase`, `outsideEnd` on columns, bars and the statistical bars; `above`, `below`, `left`, `right` on lines and scatter charts; `bestFit` on pies), as far as Excel offers each for the kind.

## Axes

`axes` holds the settings of the four axes a chart can have: `x` (the axis the categories run along, which on a bar chart is the vertical one, and the horizontal value axis of a scatter or bubble chart), `y` (the value axis), and `x2` and `y2` (the second axes of a combined chart). Every field is optional and left out means Excel's own choice:

```ts
s.updateChart("Sales", chart.id, {
  axes: {
    y: { min: 0, max: 1000, majorUnit: 250, minorUnit: 50, minorGridlines: true, majorTick: "cross", format: "$#,##0" },
    x: { reverse: true, labelEvery: 2, labels: "low" },
  },
});
```

| Field | Does |
|---|---|
| `min`, `max`, `majorUnit`, `minorUnit` | The ends and the steps of a value axis. The ticks start at `min`. |
| `log` | A logarithmic scale with this base (2 to 1000). The ends are powers of the base unless set (and must be above 0); a `majorUnit` is then a multiplier (100 shows every second decade); minor ticks fall at 2×, 3×… each decade. Columns and areas start from the low end; a value of 0 or less can't be placed and is left out. |
| `reverse` | The axis runs from the high end to the low end. On a column chart the categories then run right to left and the value axis stands on the right (it crosses at the first category, as in Excel); a bar chart's categories run from the bottom up. |
| `crosses` | Where the other axis crosses this one: `"min"`, `"max"`, or a number (a value; a category number on a category axis). The category axis stands at that value and the columns hang from it. Left out, it is zero (or the nearest end). |
| `majorGridlines`, `minorGridlines` | Value axes have major gridlines (and a scatter chart's x axis); nothing has minor ones unless asked. |
| `majorTick`, `minorTick` | `none`, `in`, `out`, `cross`: major ticks point out, minor ticks are off. |
| `labels` | `nextTo` the axis (the default), at the `low` or `high` end of the plot, or `none`. |
| `labelEvery`, `tickEvery` | Category axes: a label and a tick mark on every n-th category. |
| `format` | The number format of a value axis' labels. |
| `hidden` | No line, ticks or labels (the gridlines stay). |

The statistical kinds, radar and surface charts take the settings that make sense for them (a radar chart's value axis scale and gridlines; the newer Excel kinds have no log scale, reversing or crossing, which Excel's own axes lack, and say so when asked). 3-D charts take the scale of their value axis. `scaleTicks` (in `@pli.dev/sheets-react`) is the function that works the ticks out.

## Error bars

A series of a column, bar, line, area, scatter or bubble chart (not stacked 100%, not 3-D) can have `errorBars: { y, x }` (`x` only on scatter and bubble charts; `y` runs along the bars of a bar chart):

```ts
{ values: "Sales!$B$2:$B$7", errorBars: { y: { kind: "percent", value: 10, direction: "plus", endCap: false } } }
```

| `kind` | Amount |
|---|---|
| `fixed` | `value` (1 if left out) on every point |
| `percent` | `value` percent (5) of each point's value |
| `stdDev` | `value` (1) times the standard deviation of the series |
| `stdErr` | the standard error of the series |
| `custom` | `plus` and `minus`: a reference to cells with an amount for each point, or numbers typed in (a single number serves every point) |

`direction` is `both` (the default), `plus` or `minus`; `endCap: false` leaves off the cross-lines; `color` is `#rrggbb` (dark grey if left out). The axis is widened to hold the bars; on stacked columns they hang from the top of the piece. `chartData` gives the worked-out amounts (`errorBars.y.plus` and `.minus`) and `errorBarAmounts` is exported. The standard deviation bars use the population standard deviation (STDEV.P) and the standard error the sample standard error; that is how Excel is described to work and the kit file 31 asks Excel to confirm it.

The labels of a **treemap** or **sunburst** may span several columns (`Sheet1!$A$2:$B$9`): each column is a level, outermost first, and a blank under a name belongs to the name above it. A **box-and-whisker** chart with labels groups the values by label; a **histogram** and a **Pareto** chart count the values of their first series.

## Combined charts and second axes

In a chart of columns, lines or areas, each series can be drawn as a kind of its own and can sit on a second value axis, as in Excel's Combo charts:

```ts
s.addChart("Sales", {
  type: "column",
  title: "Sales and margin",
  categories: "Sales!$A$2:$A$7",
  y2Title: "Margin",
  series: [
    { nameRef: "Sales!$B$1", values: "Sales!$B$2:$B$7" },
    { nameRef: "Sales!$C$1", values: "Sales!$C$2:$C$7", type: "line", axis: "secondary" },
  ],
});
```

- A series takes `type: "column" | "line" | "area" | "scatter"` (the chart's own `type` if left out); a scatter series in a chart of categories stands on the category numbers (the first point over the first category, unless it has `x` values of its own) and is drawn as points; `axis: "secondary"` puts it on the second value axis (the first value axis if left out). Bar charts can't be combined, but their series can use a second axis, drawn along the top. Scatter charts take a second axis too. Pie, doughnut, radar, bubble and 3-D charts can't.
- The second value axis is drawn on the right (the top, for bars) with its own scale and `y2Title`. `secondaryCategoryAxis: true` adds a second category axis along the top, titled `x2Title`; it is hidden otherwise, as in Excel.
- Series on the first axis are drawn first and then those on the second, each set from areas to columns to lines, as Excel paints them.
- `grouping` (stacked, 100% stacked) piles up the series that are the chart's own kind, on each axis separately; a line on a stacked column chart stays a plain line unless `kindGrouping` says otherwise: `kindGrouping: { line: "stacked" }` piles up the line series on their own (Excel's Stacked Column and Stacked Line), and `{ area: "percent" }` the area series.

## Trendlines

Any series of a column, bar, line, area, scatter or bubble chart (not a stacked or 3-D one) can have trendlines:

```ts
s.updateChart("Sales", chart.id, {
  series: [{ ...chart.series[0], trendlines: [
    { type: "linear", equation: true, rSquared: true, forward: 2 },
    { type: "polynomial", order: 3, name: "Cubic" },
    { type: "movingAverage", period: 3 },
  ] }],
});
```

| `type` | Fits | Notes |
|---|---|---|
| `linear` | `y = m x + b` | `intercept` forces the line through `(0, intercept)` |
| `exponential` | `y = c e^(b x)` | every y must be positive; `intercept` forces `c` |
| `logarithmic` | `y = c ln(x) + b` | every x must be positive |
| `power` | `y = c x^b` | every x and y must be positive |
| `polynomial` | `y = c_n x^n + … + c_1 x + b` | `order` 2 to 6; `intercept` forces `b` |
| `movingAverage` | the mean of the last `period` points (2 to 255), drawn at the last of them | has no equation |

- Each has `forward` and `backward` (how far the line runs past the last x and before the first: in periods on a chart of categories, which gets that many extra category slots, and in x on a scatter or bubble chart), a `name` (Excel's own, such as "Linear (North)", if left out), `equation` and `rSquared` (shown on the chart), and a `color` (the series' if left out). Trendlines are drawn dashed, listed in the legend, and several can sit on one series.
- On a chart of categories x is 1, 2, 3… (the number of the category), as in Excel; on a scatter or bubble chart it is the x values. Points with a missing x or y are left out of the fit.
- The maths is Excel's: the fits are least squares done by QR (the same as LINEST), the curved ones are fitted to the logarithms and so are R squared (as Excel reports it, and LOGEST does). The tests compare the coefficients and R squared of every type, with and without an intercept, with LibreOffice's LINEST, and the equation texts and the moving average with values worked by hand. When a fit can't be made (a zero y under an exponential, too few points) the chart draws no line, and `chartData` says why in the trendline's `problem`.
- **The label.** `label: { format, text, x, y, font }` on a trendline sets how the equation and R squared are shown: `format` is the number format of their numbers (`0.000`; Excel's General if left out), `text` replaces them with words of your own, `x` and `y` move the label from where it sits by itself (as fractions of the chart's width and height, which is what dragging the label sets), and `font` is its font. In files these are `c:trendlineLbl` (`manualLayout`, `numFmt`, `tx`, `txPr`). The intercept (`intercept`, linear, exponential and polynomial) and the equation and R squared switches are in the editor beside each trendline.
- `chartData` gives each series' trendlines worked out: `{ name, color, type, points, equation?, rSquared?, labelLines?, labelOffset?, problem? }` (`labelLines` is what the label says, worked out with its format). The functions are exported too: `fitTrendline`, `trendlineLine`, `leastSquares`.

## 3-D

Column, bar, line, area and pie charts can be drawn in three dimensions: tick **3-D** in the chart editor, then set **Tilt** (0° to 90°, how far it leans towards you) and **Rotation** (0° to 360°, how far it is turned). Columns and bars are boxes standing in a room with a floor and walls, an area or a line is a slab or ribbon, and a pie is a thick disc. Faces are shaded by the way they point, so no lighting is needed, and hovering a mark shows its value as in a flat chart.

A 3-D chart is an ordinary chart with a view: `s.updateChart(sheet, id, { view3d: { rotX: 20, rotY: 30 } })`, and `undefined` takes it off. The view also takes `perspective` (the angle of view in degrees, 0 to 100, 15 if left out: the further a mark is, the smaller it is drawn; 0 is a flat projection), `rightAngle: true` (right-angle axes: the front of the chart is square on and the depth goes off up and to the side, with no perspective) and `depth` (how deep the chart is, as a percentage of its width, 20 to 2000, 100 if left out). In files these are `c:view3D` (`rotX`, `rotY`, `perspective`, `rAngAx`, `depthPercent`; the file holds twice the angle Excel's pane shows).

To turn a 3-D chart, pick it and drag inside its plot (across turns it about the vertical axis, down tilts it), or hold Alt and press the arrow keys; either is one undo step. The editor has sliders for the tilt, rotation, perspective and depth, and a tick for right-angle axes. `defaultView3d(type)` gives the angle the editor starts from (15° and 20°, or 40° and 0° for a pie, which is flat). Scatter charts can't be 3-D (Excel has no 3-D scatter chart, and Pli refuses one with a message that says so); a bubble chart can be drawn as shaded spheres instead (`bubble3d: true`, Excel's 3-D bubbles). Columns and bars stand side by side (Excel's "3-D clustered"); a line or area that isn't stacked puts each series in a row one behind the other, so the front series can hide the ones behind, as in Excel. Stack them or turn the chart to see them all.

It is drawn by Pli itself as SVG, with no 3-D library, so it works wherever the flat charts do and nothing extra is loaded.

## Colours of single points

A series has one colour, and any single point of it can have a colour of its own: `pointColors` on the series, by point number counting from 0.

```ts
{ values: "Sales!$B$2:$B$7", pointColors: { "2": "#c00000", "4": "#7030a0" } }
```

It works for the columns and bars, the markers of lines, scatter charts and radar charts, bubbles, the slices of pies, doughnuts and of-pie charts, and the steps of waterfall and funnel charts and the tiles of treemaps and sunbursts (counting the rows of the data); a kind that has no single points (an area, a histogram, a box, a stock chart, a surface) drops them. A waterfall also takes `waterfall: { increaseColor, decreaseColor, totalColor }` for all the bars of each sort, and a single bar's `pointColors` wins. Pick a mark in the grid and its panel sets the fill (and, for a slice, `pointExplosion`); the editor keeps the colours already set. In files they are `c:dPt` (a fill for a bar or slice, the fill of the marker for a line or a scatter point) and `cx:dataPt` for the newer kinds; a waterfall's three colours are written bar by bar, and read back as single point colours.

## Fonts and titles of single axes

The chart has one font (`font`) and the title another (`titleFont`); each axis can also have its own in `axes`: `font` for its labels, `titleFont` for its title, and `titleRuns` for the title in pieces, each with its own bold, italic, underline, colour, size and family (the text of `xTitle`, `yTitle`, `x2Title` or `y2Title` is then the pieces joined). The legend takes `legendFont` and the data labels `labelFont`:

```ts
s.updateChart("Sales", chart.id, {
  legendFont: { italic: true },
  axes: {
    y: { font: { family: "Courier New", size: 12 }, titleRuns: [{ text: "Sales", bold: true, color: "#c00000" }, { text: " in $", italic: true }] },
    x: { font: { size: 8, bold: true } },
  },
});
```

In files they are the axis' `c:txPr` and the runs of its `c:title`, the legend's and the data labels' `c:txPr`; the newer kinds keep them in `cx:axis`.

## Series by rows

A series is a reference to cells, so a table with the months across the top is just series whose values are rows. `insertChart(sheet, range, { seriesIn: "rows" })` picks them that way (a first row of text or dates gives the labels, a first column of text the names), and **Insert > Chart > Column, series in rows** does the same from the grid. `chartSeriesIn(sheet, id)` says which way a chart's series run (`"columns"`, `"rows"`, or null for series that are typed in or one cell), and `switchChartRowsColumns(sheet, id)` is Excel's Switch Row/Column: each series becomes a category and each category a series, one undo step. It needs series that run the same way, side by side, over the same cells; the colours, trendlines and error bars of the old series do not carry over. `switchRowsColumns` and `pickByRows` are exported.

## In code

```ts
import { SheetSession, createWorkbook } from "@pli.dev/sheets";

const s = new SheetSession(createWorkbook("Sales"));
s.setValues("Sheet1", "A1", [["Month", "North", "South"], ["Jan", 10, 20], ["Feb", 15, 25], ["Mar", 12, 30]]);

const chart = s.insertChart("Sheet1", "A1:C3", { type: "column" });   // picks the parts like the menu does
s.updateChart("Sheet1", chart.id, { title: "Sales by month", grouping: "stacked" });
s.chartData("Sheet1", chart.id);   // { categories: ["Jan", "Feb"], series: [{ name: "North", values: [10, 15], … }, …] }
s.deleteChart("Sheet1", chart.id);
```

Or say exactly what is drawn:

```ts
s.addChart("Sheet1", {
  type: "scatter",
  title: "Does advertising pay?",
  series: [{ name: "Sales", x: "Sheet1!$E$2:$E$11", values: "Sheet1!$F$2:$F$11" }],
  from: { row: 3, col: 8 },   // the top-left corner is in H3
  width: 420,
  height: 260,
});
```

A chart is `{ id, type, title?, categories?, series, grouping?, legend?, smooth?, labels?, xTitle?, yTitle?, view3d?, axes?, titleRuns?, font?, from, width, height }` and the options of its kind (`y2Title`, `holeSize`, `bins`…, listed above):

- A series is `{ name? | nameRef?, values, x?, size?, color?, pointColors?, type?, axis?, trendlines?, errorBars?, explosion?, pointExplosion? }`. `values`, `categories`, `nameRef` and `x` are references to cells with the sheet's name, such as `Sheet1!$B$2:$B$9`. They are kept as formula text, so renaming a sheet, inserting rows and moving cells all update them; a reference to a deleted sheet becomes `#REF!` and draws nothing.
- `from` is the cell the chart's top-left corner is in (1-based) and how far into it (`dx`, `dy`, in pixels); `width` and `height` are pixels. Inserting rows or columns above or to the left pushes the chart along.
- `updateChart(sheet, id, patch, { merge: true })` folds a change into the previous undo step, which is how a drag is one step. Setting a field to `undefined` removes it.
- `reorderChart(sheet, id, "front" | "back")` changes which chart is on top.
- `charts(sheet)` lists the charts of a sheet, and `chartData(sheet, id)` reads what a chart shows now.

A chart is checked when it is added and when a saved workbook is read: a bad reference, size, colour or kind is refused with a message that says which.

## Drawing it yourself

`ChartView` from `@pli.dev/sheets-react` draws a chart as SVG from a chart and its data, without the grid:

```tsx
import { ChartView } from "@pli.dev/sheets-react";

<ChartView chart={chart} data={session.chartData(sheetId, chart.id)} />
```

It has no state and uses the grid's colours (`--pli-fg`, `--pli-border`…), light or dark. Hovering a mark shows its value.

## In Excel files

Charts are written as Excel charts (a drawing on the sheet, and a chart part for each; 3-D ones as Excel's 3-D chart kinds with their view), with the values the chart shows saved beside each reference so viewers that don't recalculate can draw them. They read back the same: the tests write every kind, have LibreOffice open and re-save the file, and read that back.

- **Combined charts** are several chart elements in one plot area sharing axes (`barChart` and `lineChart`, say), the series of each in its own element, and a second set of axes (a `valAx` on the right with `crosses="max"`, and a hidden `catAx`) for the series on the second axis. A scatter series on a chart of categories is a `scatterChart` sharing the category and value axes of the columns or lines. Reading takes any order of elements, numbers the series as the file does, and puts a series on the second axis when its value axis stands on the far side and crosses at the far end and the chart has another pair of axes (Excel stands the value axis of a chart with backwards categories on the right too, which is not a second axis). A second kind that piles up (stacked columns with stacked lines) is read into `kindGrouping`.
- **Trendlines** are `c:trendline` elements (type, order, period, forward, backward, intercept, equation and R squared flags, name, colour). Excel works the line out itself when it opens the file.
- **Axes** are the axes' own elements: `c:scaling` (`logBase`, `orientation`, `max`, `min`), `majorUnit`/`minorUnit`, `majorGridlines`/`minorGridlines`, `majorTickMark`/`minorTickMark`, `tickLblPos`, `tickLblSkip`/`tickMarkSkip`, `numFmt`, `delete` and `crosses`/`crossesAt` (an axis' element says where it crosses the other, so the model's `y.crosses` is written on the category axis and `x.crosses` on the value axis). A bar chart is written with its category axis reversed (Pli lists categories from the top) and its value axis crossing at the far end to stay at the bottom; a chart that really lists them from the bottom has `reverse: true`.
- **Error bars** are `c:errBars` (`errDir`, `errBarType`, `errValType`, `noEndCap`, `plus`/`minus` as a reference with its values or typed values, `val`, a line colour), all five kinds, x and y, read back the same. The Excel 2016 kinds keep their axis settings in `cx:axis` (`valScaling` with its ends and units, gridlines, tick marks, `tickLabels`).
- **Pie angles and explosion** are `firstSliceAng` and `explosion` (on the series and on its points), a **custom split** is `splitType cust` with `custSplit`, the **look of a stock chart** is `hiLowLines` and `upDownBars`, **fonts** are the chart's `txPr` and the runs of the title, **label content and position** are `dLbls` (`showVal`, `showCatName`, `showSerName`, `showPercent`, `dLblPos`).
- **Doughnut, radar, bubble, stock** (with or without volume), **surface** (and contour) and **pie of pie / bar of pie** are Excel's own chart elements.
- **Waterfall, histogram, Pareto, funnel, box and whisker, treemap and sunburst** are written as Excel 2016's "chartex" parts (`xl/charts/chartExN.xml`, anchored in alternate content with a placeholder for older programs) and read back from them. Pli writes these from the published format and its own round trip (several series in a histogram or Pareto are several `cx:series`; a waterfall's connectors are `connectorLines`; label content and place are `cx:dataLabels`); no program here but Excel itself draws them, so file 21 of the Excel check kit asks for them to be opened in Excel and looked at.

Reading handles all of these kinds from files made elsewhere, including the ones held between two cells. Not read, and said so in `warnings`: other kinds (such as region maps), kinds that Pli can't combine (the first kind is kept), series typed in as numbers rather than taken from cells, a custom split in a pie of pie (the last three points are moved), and colours that come from an Excel theme (the palette is used instead).

## Not there yet

- The Excel 2016 kinds (waterfall, histogram, Pareto, funnel, box and whisker, treemap, sunburst) have been opened in Excel for Mac (kit file 21): it opens them and keeps them. Excel drops the whole drawing unless each of these charts also has a style part and a colours part beside it, so Pli writes both, and Excel's own files name the cells a chart reads in hidden names (`_xlchart.v1.0`), which Pli reads. Kit file 31 came back from Excel with every setting of the four newer charts it tests unchanged (bins, overflow and underflow, quartile method, connector lines, subtotals, label place, axis scale, fonts). Excel marks the second series of a histogram `hidden="1"`, so it may show only the first; the check kit's file 60 asks. How they look on the sheet has not been compared. LibreOffice does not draw most of them, so there is no second program to compare with.
- Excel does not write the length of standard deviation or standard error bars into the file, so the file Excel saved cannot say whether its standard deviation bars are the population (STDEV.P, what Pli draws) or the sample deviation; kit file 60 is built so that one look in Excel settles it (the same for the R squared of a trendline forced through a point other than zero, which Pli works out around that point). Whether Excel lets a bar series be combined with columns or lines in a Combo chart is asked there as well. Pli keeps bar charts apart from the other kinds until it is answered.
- Pli's surface chart is flat-shaded bands cut along the lines of equal height, drawn by its own 3-D code; Excel's lighting and its wall and floor options are not matched, LibreOffice has no surface chart (it re-saves one as columns), and neither drawing has been compared with Excel's.
- Per-kind settings Excel does not have are not there either: whisker settings beyond the ones above, and a limit on the number of levels a treemap or sunburst shows (choose fewer label columns).
- A trendline's R squared when the line is forced through a point other than zero is worked out around that point (LINEST with the constant off, on y minus the intercept); for an intercept of 0 that is Excel's, for others kit file 60 asks. A chart on a date axis counts its x as 1, 2, 3 like a chart of text labels.
- Excel's own drawing of 3-D line and area charts has not been checked against Pli's (LibreOffice opens and re-saves them as 3-D).
- Charts in the Swift and Kotlin packages, which wait for the native engine.
