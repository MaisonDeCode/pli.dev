---
title: Charts
description: The chart data model, the chart kinds, the chart dialog, drawing, and how charts are read from and written to PowerPoint files.
---

A chart is an element of a slide, like a shape or a table. Its data is plain JSON inside the element, so it is saved with the deck, copied and undone with it. Every renderer (the editor, thumbnails, presenting and PDF export) draws it from the same description.

## The data model

```ts
import type { ChartElement } from "@pli.dev/decks";

const chart: ChartElement = {
  type: "chart",
  id: "e_1",
  x: 80, y: 90, w: 480, h: 300,          // points, like every element
  chartType: "column",                    // column | bar | line | area | pie | doughnut | scatter
  grouping: "stacked",                    // clustered (default) | stacked | percentStacked
  categories: ["North", "South", "East"],
  series: [
    { name: "2024", values: [4, 6, 3] },                          // colour: the theme's accent1, accent2… in turn
    { name: "2025", values: [5, null, 7], color: "#ff8800" },     // a blank is null
    { name: "Trend", values: [4, 5, 5], type: "line", smooth: true },   // a combination: columns and a line
  ],
  title: "Sales",
  legend: "bottom",                       // top | bottom | left | right | none (default: bottom, none for one series)
  valueAxis: { min: 0, max: 10, format: "0.0", title: "Units", gridlines: true },
  categoryAxis: { hidden: false },
  dataLabels: { value: true },            // value, percent, category, series; format; position
  gapWidth: 150, overlap: 0,
  textColor: { theme: "dk1" }, textSize: 12,
};
```

Colours are the same `Color` the rest of the model uses, so a series can follow the theme (`{ theme: "accent3", lumMod: 0.75 }`) and changes when the theme does. A series with no colour takes the theme's accents in order, then darker and lighter versions of them. A pie or doughnut chart uses its first series, with a colour for each slice in `pointColors`. A scatter chart gives each series its own `x` values and has no categories; its horizontal axis is `categoryAxis`.

Numbers are shown through `format`: `General`, `0.00`, `#,##0`, `0%`, `$#,##0.00`, `0.0"x"` and a second section for negative numbers.

## In the editor

**Insert > Chart** adds a sample chart (three categories and two series) in the middle of the slide, coloured from the theme. To open the **chart data dialog**, double-click a chart, choose **Chart options…** in the Format options panel, or use the chart's context menu. The dialog has a table of categories and series, with buttons to add and remove rows and series. It also sets each series' name, colour and drawing type (for combinations), and the chart type, stacking, legend position, title, data labels and smooth lines. Apply makes one undoable change; Cancel leaves the chart alone.

In code:

```ts
const chart = session.addChart(slideId, "column");             // sample data, centred
session.updateChart(slideId, chart.id, { title: "Sales" });    // fields to set (undefined removes one)
session.updateChart(slideId, chart.id, (c) => ({ ...c, series: [...c.series, { name: "More", values: [1, 2, 3] }] }));
```

## Drawing

`chartScene(chart, width, height, theme)` turns a chart into a list of drawing items in the chart's own space: filled rectangles, paths (arcs are already converted to Béziers), lines, and text with an anchor and rotation. It has no side effects and gives the same output for the same input, so the editor draws it as SVG, the PDF export draws it as page items, and tests read it as data. Axis scales use round steps (1, 2 or 5 times a power of ten) with a little headroom above the data, as Excel does. Category labels turn to 45 degrees and are shortened or skipped when they would collide, and the legend wraps.

## PowerPoint files

**Import** reads a chart from its cached data (`c:numCache` and `c:strCache`), not from the embedded workbook: clustered, stacked and 100% stacked columns and bars, horizontal bars, lines (markers, smoothing), areas, pie, doughnut and scatter, and combinations of columns, lines and areas. It keeps series fills and lines (theme colours stay theme colours), gap width and overlap, axis limits, number formats, gridlines, deleted axes, axis and chart titles, the legend position, data labels, and the chart's text size, colour and font. A title with no text of its own reads as PowerPoint shows it (the series name for one series, "Chart Title" otherwise).

A chart kind Pli can't draw (radar, surface, stock, bubble, pie-of-pie, and the newer waterfall, funnel and treemap kinds) is reported in `warnings`. The classic kinds become an empty dashed box with the chart's title, so the slide keeps its layout; the newer kinds keep the fallback picture PowerPoint stores with them.

**Export** writes a `p:graphicFrame` and a `ppt/charts/chartN.xml` part in the element order of the chart schema, with unique axis ids, the chart's colours as theme or RGB colours, and its data cached in the chart. It also embeds a small workbook (`ppt/embeddings/Microsoft_Excel_SheetN.xlsx`, with the data in `Sheet1`) that the chart refers to with `c:externalData`, so **Edit Data** in PowerPoint opens the numbers. The bytes depend only on the deck.

## Limits

- Chart kinds: column, bar, line, area, pie, doughnut and scatter, and combinations of columns, lines and areas on one set of axes. No secondary axis (an imported one is drawn on the shared axes, with a warning), no 3-D, radar, stock, bubble or surface charts, trendlines, error bars or per-point data label formatting.
- A chart can't be rotated or flipped in a PowerPoint file (PowerPoint doesn't either).
- The editor and the PDF measure text with the same font-metric estimate, so labels can sit a pixel or two differently from PowerPoint's.
- At most 256 series and 200,000 data points per chart.
