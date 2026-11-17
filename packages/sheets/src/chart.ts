import { PliError } from "@pli.dev/core";
import { cellAddress, colName, type Bounds } from "./address";
import { parseFormula, printFormula, type Node } from "./formula";
import type { Chart, ChartFont, ChartSeries, ChartSeriesKind, ChartType, ChartView3d, Sheet, Trendline, TrendlineType } from "./model";
import { MAX_TREND_ORDER, labelNumber, trendlineLine, trendlineName } from "./trendline";
import { cleanExtras, cleanSeriesErrorBars, errorBarRefs } from "./chart-extras";
import { cleanDetail, cleanTrendlineLabel, cleanView3d } from "./chart-detail";
import { errorBarAmounts, type ErrorBarData } from "./errorbars";
import type { Value } from "./values";

export const CHART_TYPES: readonly ChartType[] = [
  "column", "bar", "line", "area", "pie", "scatter",
  "doughnut", "radar", "bubble", "stock", "surface", "pieOfPie", "barOfPie",
  "waterfall", "histogram", "pareto", "funnel", "boxWhisker", "treemap", "sunburst",
];

/** The kinds Excel 2016 added, which it keeps in "chartex" parts of their own. */
export const CHARTEX_TYPES: readonly ChartType[] = ["waterfall", "histogram", "pareto", "funnel", "boxWhisker", "treemap", "sunburst"];
export const isChartex = (type: ChartType): boolean => CHARTEX_TYPES.includes(type);

/** The kinds drawn on a category axis and a value axis with columns, lines or areas: these can be combined and put on a second axis. */
const COMBINABLE: readonly ChartType[] = ["column", "line", "area"];
/** The kinds one series of a combined chart may be drawn as: the three above, and scatter points placed on the category numbers. */
const SERIES_KINDS: readonly ChartType[] = ["column", "line", "area", "scatter"];
const SECONDARY_OK: readonly ChartType[] = ["column", "bar", "line", "area", "scatter"];
const THREE_D_OK: readonly ChartType[] = ["column", "bar", "line", "area", "pie", "surface"];
const TREND_OK: readonly ChartType[] = ["column", "bar", "line", "area", "scatter", "bubble"];
const TREND_TYPES: readonly TrendlineType[] = ["linear", "exponential", "logarithmic", "polynomial", "power", "movingAverage"];
export const STOCK_SERIES = { hlc: 3, ohlc: 4, vhlc: 4, vohlc: 5 } as const;

/** What kind of mark a series is drawn with: its own `type` in a chart of columns, lines and areas, otherwise the chart's. */
export function seriesKind(chart: Pick<Chart, "type">, s: Pick<ChartSeries, "type">): ChartType {
  return s.type && COMBINABLE.includes(chart.type) ? s.type : chart.type;
}

/** Whether a chart draws more than one kind of mark, or uses a second value axis. */
export const isCombined = (chart: Pick<Chart, "type" | "series">): boolean => chart.series.some((s) => (s.type !== undefined && s.type !== chart.type) || s.axis === "secondary");

/** Which of a stock chart's four layouts it has: the one it says, or the one its number of series fits. */
export function stockKind(chart: Pick<Chart, "stock" | "series">): keyof typeof STOCK_SERIES {
  if (chart.stock) return chart.stock;
  const n = chart.series.length;
  return n >= 5 ? "vohlc" : n === 4 ? "ohlc" : "hlc";
}

/** The colours series are given in turn when a chart doesn't choose its own. */
export const CHART_COLORS: readonly string[] = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"];

/** The angle a chart is first seen from when it is made 3-D: a pie is tilted further, since it is flat. */
export function defaultView3d(type: ChartType): ChartView3d {
  return type === "pie" ? { rotX: 40, rotY: 0 } : { rotX: 15, rotY: 20 };
}

export const MIN_CHART_SIZE = 80;
export const MAX_CHART_SIZE = 4000;
export const DEFAULT_CHART_WIDTH = 480;
export const DEFAULT_CHART_HEIGHT = 288;

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** A reference to cells as a chart keeps it: the sheet it is on, and the cells. */
export interface ChartRef {
  sheet: string;
  bounds: Bounds;
}

/** Reads `Sheet1!$A$2:$A$9`. A reference without a sheet is on `home`. Null when it isn't one plain range of cells. */
export function chartRef(text: string | undefined, home: string): ChartRef | null {
  if (!text) return null;
  let tree: Node;
  try {
    tree = parseFormula(text);
  } catch {
    return null;
  }
  if (tree.t !== "ref") return null;
  const a = tree.a;
  const b = tree.b ?? tree.a;
  if (a.row === null || a.col === null || b.row === null || b.col === null) return null;
  return {
    sheet: tree.sheet ?? home,
    bounds: { r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) },
  };
}

/** Writes a reference the way charts keep them: absolute, with the sheet's name. */
export function chartRefText(sheet: string, b: Bounds): string {
  const tree: Node = {
    t: "ref",
    sheet,
    a: { row: b.r1, col: b.c1, rowAbs: true, colAbs: true },
    ...(b.r1 === b.r2 && b.c1 === b.c2 ? {} : { b: { row: b.r2, col: b.c2, rowAbs: true, colAbs: true } }),
  };
  return printFormula(tree);
}

function checkRef(what: string, ref: string | undefined): void {
  if (ref === undefined) return;
  if (ref === "#REF!") return;
  if (chartRef(ref, "") === null) throw new PliError("invalid_operation", `${what} must be a reference to cells, such as Sheet1!$B$2:$B$9`);
}

/** A chart made ready to keep: checks it, and drops fields that say nothing. */
export function cleanChart(chart: Chart): Chart {
  const bad = (m: string): never => {
    throw new PliError("invalid_operation", m);
  };
  if (typeof chart.id !== "string" || chart.id === "") bad("A chart needs an id");
  if (!CHART_TYPES.includes(chart.type)) bad(`A chart type is one of ${CHART_TYPES.join(", ")}`);
  if (!Array.isArray(chart.series)) bad("A chart needs a list of series");
  const f = chart.from;
  if (!f || !Number.isInteger(f.row) || !Number.isInteger(f.col) || f.row < 1 || f.col < 1) bad("A chart needs a cell to sit in");
  for (const n of [chart.width, chart.height]) if (!(n >= MIN_CHART_SIZE && n <= MAX_CHART_SIZE)) bad(`A chart is ${MIN_CHART_SIZE} to ${MAX_CHART_SIZE} pixels across and high`);
  for (const d of [f.dx, f.dy]) if (d !== undefined && !(d >= 0 && Number.isFinite(d))) bad("A chart's offset in its cell must be 0 or more");
  const out: Chart = { ...chart, from: { ...f }, series: chart.series.map((s) => ({ ...s })) };
  checkRef("The categories", out.categories);
  if (out.categories === "" || out.categories === undefined) delete out.categories;
  out.series.forEach((s, i) => {
    if (typeof s.values !== "string" || s.values === "") bad(`Series ${i + 1} needs values`);
    checkRef(`The values of series ${i + 1}`, s.values);
    checkRef(`The name of series ${i + 1}`, s.nameRef);
    checkRef(`The x values of series ${i + 1}`, s.x);
    checkRef(`The sizes of series ${i + 1}`, s.size);
    if (s.color !== undefined && !COLOR.test(s.color)) bad("A series colour looks like #rrggbb");
    for (const k of ["name", "nameRef", "x", "color", "size"] as const) if (s[k] === "") delete s[k];
    if (s.size !== undefined && out.type !== "bubble") delete s.size;
    if (s.type !== undefined) {
      if (!COMBINABLE.includes(out.type)) bad("Series can only have kinds of their own in a column, line or area chart");
      if (!SERIES_KINDS.includes(s.type)) bad(`A series in a combined chart is a column, line or area (or scatter points), not "${s.type}"`);
    }
    if (s.axis !== undefined) {
      if (s.axis !== "secondary") bad('A series axis is "secondary"');
      if (!SECONDARY_OK.includes(out.type)) bad(`A ${out.type} chart has no second axis`);
    }
    if (s.trendlines !== undefined) {
      if (!Array.isArray(s.trendlines)) bad(`The trendlines of series ${i + 1} must be a list`);
      s.trendlines = s.trendlines.map((t) => cleanTrendline(t, i + 1));
      if (!s.trendlines.length) delete s.trendlines;
      else {
        if (!TREND_OK.includes(out.type)) bad(`A ${out.type} chart can't have trendlines`);
        const kind = seriesKind(out, s);
        if (!TREND_OK.includes(kind)) bad(`A ${kind} series can't have trendlines`);
        if (out.grouping && kind === out.type && (out.type === "column" || out.type === "bar" || out.type === "line" || out.type === "area")) bad("A stacked series can't have trendlines");
        if (out.view3d) bad("A 3-D chart can't have trendlines");
      }
    }
    if (s.errorBars !== undefined) {
      const eb = cleanSeriesErrorBars(out, s, i + 1, seriesKind(out, s), checkRef);
      if (eb) s.errorBars = eb;
      else delete s.errorBars;
    }
  });
  if (out.view3d !== undefined && out.series.some((s) => s.axis === "secondary" || (s.type !== undefined && s.type !== out.type))) bad("A 3-D chart can't combine kinds or have a second axis");
  if (out.grouping !== undefined && out.grouping !== "stacked" && out.grouping !== "percent") bad('Grouping is "stacked" or "percent"');
  if (out.legend !== undefined && !["top", "bottom", "left", "right", "none"].includes(out.legend)) bad("A legend goes top, bottom, left, right or none");
  for (const k of ["title", "xTitle", "yTitle"] as const) if (out[k] === "") delete out[k];
  if (out.view3d !== undefined) {
    const v = out.view3d;
    if (out.type === "scatter" || out.type === "bubble") bad(`A ${out.type} chart can't be 3-D: Excel has none (a bubble chart can be drawn as spheres with bubble3d, and a surface chart is 3-D)`);
    if (!THREE_D_OK.includes(out.type)) bad(`A ${out.type} chart can't be 3-D`);
    out.view3d = cleanView3d(v);
  }
  if (out.from.dx === 0) delete out.from.dx;
  if (out.from.dy === 0) delete out.from.dy;
  for (const k of ["smooth", "labels", "lines", "filled", "wireframe", "secondaryCategoryAxis"] as const) if (out[k] === false) delete out[k];
  if (out.markers === true) delete out.markers;
  if (out.grouping === undefined) delete out.grouping;
  cleanKindOptions(out, bad);
  cleanExtras(out);
  cleanDetail(out);
  return out;
}

function cleanTrendline(t: Trendline, n: number): Trendline {
  const bad = (m: string): never => {
    throw new PliError("invalid_operation", m);
  };
  if (typeof t !== "object" || t === null || !TREND_TYPES.includes(t.type)) bad(`A trendline is one of ${TREND_TYPES.join(", ")} (series ${n})`);
  const out: Trendline = { ...t };
  const num = (k: "order" | "period" | "forward" | "backward" | "intercept") => {
    if (out[k] !== undefined && !(typeof out[k] === "number" && Number.isFinite(out[k]))) bad(`A trendline's ${k} must be a number`);
  };
  for (const k of ["order", "period", "forward", "backward", "intercept"] as const) num(k);
  if (out.type === "polynomial") {
    if (out.order !== undefined && !(Number.isInteger(out.order) && out.order >= 2 && out.order <= MAX_TREND_ORDER)) bad(`A polynomial trendline's order is a whole number from 2 to ${MAX_TREND_ORDER}`);
  } else delete out.order;
  if (out.type === "movingAverage") {
    if (out.period !== undefined && !(Number.isInteger(out.period) && out.period >= 2 && out.period <= 255)) bad("A moving average's period is a whole number from 2 to 255");
  } else delete out.period;
  for (const k of ["forward", "backward"] as const) if (out[k] !== undefined && !(out[k]! >= 0)) bad(`A trendline's ${k} forecast must be 0 or more`);
  if (out.intercept !== undefined && !["linear", "exponential", "polynomial"].includes(out.type)) bad("Only linear, exponential and polynomial trendlines can have an intercept");
  if (out.type === "movingAverage") {
    delete out.equation;
    delete out.rSquared;
    delete out.intercept;
  }
  if (out.color !== undefined && !COLOR.test(out.color)) bad("A trendline colour looks like #rrggbb");
  for (const k of ["name", "color"] as const) if (out[k] === "") delete out[k];
  for (const k of ["equation", "rSquared"] as const) if (out[k] === false) delete out[k];
  for (const k of ["forward", "backward"] as const) if (out[k] === 0) delete out[k];
  const label = cleanTrendlineLabel(out.label, n);
  if (label && (out.equation || out.rSquared)) out.label = label;
  else delete out.label;
  return out;
}

/** Checks the options that belong to one kind of chart, and drops the ones that belong to another. */
function cleanKindOptions(out: Chart, bad: (m: string) => never): void {
  const only = (types: readonly ChartType[], ...keys: (keyof Chart)[]) => {
    if (!types.includes(out.type)) for (const k of keys) delete out[k];
  };
  only(["doughnut"], "holeSize");
  only(["radar"], "filled");
  only(["bubble"], "bubbleScale");
  only(["stock"], "stock");
  only(["surface"], "wireframe");
  only(["pieOfPie", "barOfPie"], "split", "secondSize");
  only(["waterfall"], "totals");
  only(["histogram"], "bins");
  only(["boxWhisker"], "box");
  only(["treemap"], "parentLabels");
  only(["line", "radar", "scatter", "stock"], "markers");
  if (out.type === "radar" && out.filled) delete out.markers;
  only(["scatter"], "lines");
  if (!SECONDARY_OK.includes(out.type)) for (const k of ["y2Title", "x2Title", "secondaryCategoryAxis"] as const) delete out[k];
  const range = (what: string, v: number | undefined, lo: number, hi: number) => {
    if (v !== undefined && !(typeof v === "number" && v >= lo && v <= hi)) bad(`${what} is a number from ${lo} to ${hi}`);
  };
  range("The hole of a doughnut", out.holeSize, 10, 90);
  range("The bubble scale", out.bubbleScale, 0, 300);
  range("The size of the second plot", out.secondSize, 5, 200);
  if (out.stock !== undefined) {
    if (!(out.stock in STOCK_SERIES)) bad("A stock chart is hlc, ohlc, vhlc or vohlc");
    if (out.series.length < STOCK_SERIES[out.stock]) bad(`A ${out.stock} stock chart needs ${STOCK_SERIES[out.stock]} series`);
  }
  if (out.split !== undefined) {
    const sp = out.split;
    if (sp && sp.by === "custom") {
      if (!Array.isArray(sp.points) || sp.points.some((i) => !Number.isInteger(i) || i < 0)) bad("A custom split lists the points (counting from 0) that move to the second plot");
      out.split = { by: "custom", at: 0, points: [...new Set(sp.points)].sort((a, b) => a - b) };
    } else {
      if (!sp || !["position", "value", "percent"].includes(sp.by) || !(typeof sp.at === "number" && sp.at > 0)) bad("A split is by position, value, percent or custom, at a number above 0");
      if (sp.by === "position" && !Number.isInteger(sp.at)) bad("A split by position is a whole number of points");
      out.split = { by: sp.by, at: sp.at };
    }
  }
  if (out.totals !== undefined) {
    if (!Array.isArray(out.totals) || out.totals.some((i) => !Number.isInteger(i) || i < 0)) bad("The totals of a waterfall are point numbers from 0");
    out.totals = [...new Set(out.totals)].sort((a, b) => a - b);
    if (!out.totals.length) delete out.totals;
  }
  if (out.bins !== undefined) {
    const b = out.bins;
    if (b.by !== undefined && !["auto", "width", "count"].includes(b.by)) bad("Histogram bins are cut by auto, width or count");
    if (b.closed !== undefined && !["left", "right"].includes(b.closed)) bad('A histogram bin closes on the "left" or "right"');
    for (const k of ["size", "overflow", "underflow"] as const) if (b[k] !== undefined && !(typeof b[k] === "number" && Number.isFinite(b[k]))) bad(`A histogram's ${k} must be a number`);
    if (b.by === "width" && !(b.size! > 0)) bad("A histogram bin width must be above 0");
    if (b.by === "count" && !(b.size! >= 1)) bad("A histogram needs at least one bin");
    if (b.underflow !== undefined && b.overflow !== undefined && b.underflow >= b.overflow) bad("A histogram's underflow must be below its overflow");
    out.bins = Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && !(k === "by" && v === "auto") && !(k === "closed" && v === "right"))) as Chart["bins"];
    if (!Object.keys(out.bins!).length) delete out.bins;
  }
  if (out.box !== undefined) {
    const b = out.box;
    if (b.quartile !== undefined && b.quartile !== "inclusive" && b.quartile !== "exclusive") bad('A box chart\'s quartile is "inclusive" or "exclusive"');
    out.box = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as Chart["box"];
    if (!Object.keys(out.box!).length) delete out.box;
  }
  if (out.parentLabels !== undefined && !["banner", "overlapping", "none"].includes(out.parentLabels)) bad("Parent labels are banner, overlapping or none");
  for (const k of ["y2Title", "x2Title"] as const) if (out[k] === "") delete out[k];
}

/** Applies `fn` to every reference of a chart (to follow inserted rows, renamed sheets…). */
export function mapChartRefs(chart: Chart, fn: (ref: string) => string): Chart {
  let changed = false;
  const one = (r: string | undefined): string | undefined => {
    if (r === undefined) return r;
    const g = fn(r);
    if (g !== r) changed = true;
    return g;
  };
  const categories = one(chart.categories);
  const series = chart.series.map((s): ChartSeries => {
    const out: ChartSeries = { ...s, values: one(s.values)! };
    if (s.nameRef !== undefined) out.nameRef = one(s.nameRef)!;
    if (s.x !== undefined) out.x = one(s.x)!;
    if (s.size !== undefined) out.size = one(s.size)!;
    if (s.errorBars && errorBarRefs(s).length) {
      const eb: NonNullable<ChartSeries["errorBars"]> = {};
      for (const dir of ["x", "y"] as const) {
        const e = s.errorBars[dir];
        if (!e) continue;
        eb[dir] = { ...e, ...(typeof e.plus === "string" ? { plus: one(e.plus)! } : {}), ...(typeof e.minus === "string" ? { minus: one(e.minus)! } : {}) };
      }
      out.errorBars = eb;
    }
    return out;
  });
  if (!changed) return chart;
  return { ...chart, ...(categories !== undefined ? { categories } : {}), series };
}

/** The kinds that draw only the first series of what they are given. */
const FIRST_SERIES_ONLY: readonly ChartType[] = ["pie", "pieOfPie", "barOfPie", "waterfall", "funnel", "treemap", "sunburst", "histogram", "pareto"];

/**
 * Shapes the series that "Insert chart" picked from cells for the kind asked for: a pie takes the first column, a bubble
 * chart the first three as x, y and size, a stock chart up to five (volume, open, high, low, close), and the slices of a pie take
 * their colours from the palette.
 */
export function seriesForType(type: ChartType, picked: ChartSeries[], categories: string | undefined): { series: ChartSeries[]; categories?: string | undefined; stock?: Chart["stock"] } {
  if (FIRST_SERIES_ONLY.includes(type)) return { series: picked.slice(0, 1).map(({ color, ...rest }) => (type === "pie" || type === "pieOfPie" || type === "barOfPie" ? rest : { ...rest, ...(color ? { color } : {}) })), categories };
  if (type === "bubble") {
    // x, y, size; with labels in the first column the points are numbered instead.
    const cols = categories ? picked : picked.slice(1);
    const x = categories ? undefined : picked[0]?.values;
    const y = cols[0];
    if (!y) throw new PliError("invalid_operation", "A bubble chart needs a column of y values, and a column of sizes beside it");
    return { series: [{ ...y, ...(x ? { x } : {}), ...(cols[1] ? { size: cols[1].values } : {}) }], categories: undefined };
  }
  if (type === "stock") {
    if (picked.length < 3) throw new PliError("invalid_operation", "A stock chart needs at least three columns: high, low and close");
    const series = picked.slice(0, 5);
    return { series, categories, stock: series.length >= 5 ? "vohlc" : series.length === 4 ? "ohlc" : "hlc" };
  }
  return { series: picked, categories };
}

/** A trendline worked out: the line to draw and what to say about it. */
export interface ChartTrendData {
  name: string;
  color: string;
  type: TrendlineType;
  /** Where the line runs: x is the number of the category (1, 2, 3…), or the x value in a scatter or bubble chart. */
  points: [number, number][];
  equation?: string;
  rSquared?: number;
  /** What the label says, a line each (the equation and the R squared, or the text given), worked out with the label's number format. Missing when no label is shown. */
  labelLines?: string[];
  /** How far the label has been moved from where it sits by itself, as a fraction of the chart's width and height. */
  labelOffset?: { x: number; y: number };
  labelFont?: ChartFont;
  /** Why there is no line, when there is none. */
  problem?: string;
}

export interface ChartSeriesData {
  name: string;
  color: string;
  /** One number per category; null where the cell is empty or isn't a number. */
  values: (number | null)[];
  /** For a scatter or bubble chart, the x of each value. */
  x?: number[];
  /** For a bubble chart, the size of each bubble. */
  size?: (number | null)[];
  trendlines?: ChartTrendData[];
  /** The colours of single points (the series' `pointColors`). */
  pointColors?: Record<string, string>;
  /** The error bars worked out for each point, along y (the values) and, in scatter and bubble charts, along x. */
  errorBars?: { y?: ErrorBarData; x?: ErrorBarData };
}

/** What a chart draws right now: the cells it refers to, read. */
export interface ChartData {
  categories: string[];
  series: ChartSeriesData[];
  /** For a treemap or sunburst whose labels span several columns: the names at each level (outermost first), one per row. */
  levels?: string[][];
}

const MAX_CHART_POINTS = 10_000;

/**
 * Reads what a chart shows from its cells. `read` gives the value and the shown text of a cell (by sheet id and address).
 * Hidden rows and columns are left out, as Excel does by default.
 */
export function readChart(chart: Chart, home: Sheet, sheets: readonly Sheet[], read: (sheet: string, address: string) => { value: Value; text: string }): ChartData {
  const cells = (ref: string | undefined): { value: Value; text: string }[] => {
    const r = chartRef(ref, home.name);
    const target = r && sheets.find((x) => x.name.toLowerCase() === r.sheet.toLowerCase());
    if (!r || !target) return [];
    const out: { value: Value; text: string }[] = [];
    for (let row = r.bounds.r1; row <= r.bounds.r2 && out.length < MAX_CHART_POINTS; row++) {
      if (target.rows?.[String(row)]?.hidden === true) continue;
      for (let col = r.bounds.c1; col <= r.bounds.c2 && out.length < MAX_CHART_POINTS; col++) {
        if (target.columns?.[colName(col)]?.hidden === true) continue;
        out.push(read(target.id, cellAddress(row, col)));
      }
    }
    return out;
  };
  const num = (c: { value: Value }) => (typeof c.value === "number" && Number.isFinite(c.value) ? c.value : null);
  const labels = cells(chart.categories).map((c) => c.text);
  const xy = chart.type === "scatter" || chart.type === "bubble";
  const series = chart.series.map((s, i) => {
    const values = cells(s.values).map(num);
    const name = s.name ?? (s.nameRef ? cells(s.nameRef)[0]?.text : undefined) ?? `Series ${i + 1}`;
    const data: ChartSeriesData = { name: name === "" ? `Series ${i + 1}` : name, color: s.color ?? CHART_COLORS[i % CHART_COLORS.length]!, values };
    if (xy || seriesKind(chart, s) === "scatter") {
      // A scatter series in a chart of categories stands at the category numbers unless it has x values of its own.
      const given = s.x ? cells(s.x).map(num) : null;
      const fromLabels = !given && xy && chart.categories ? cells(chart.categories).map(num) : null;
      const xs = given ?? fromLabels;
      data.x = values.map((_, k) => xs?.[k] ?? k + 1);
    }
    if (s.pointColors) data.pointColors = { ...s.pointColors };
    if (chart.type === "bubble") {
      const sizes = s.size ? cells(s.size).map(num) : [];
      data.size = values.map((_, k) => sizes[k] ?? 1);
    }
    if (s.trendlines?.length) {
      const xs = data.x ?? values.map((_, k) => k + 1);
      data.trendlines = s.trendlines.map((t): ChartTrendData => {
        const line = trendlineLine(t, xs, values);
        const out: ChartTrendData = { name: trendlineName(t, data.name), color: t.color ?? data.color, type: t.type, points: line.points };
        if (line.fit && t.equation) out.equation = line.fit.equation;
        if (line.fit && t.rSquared) out.rSquared = line.fit.rSquared;
        if (line.problem) out.problem = line.problem;
        if (line.fit && (t.equation || t.rSquared)) {
          const nf = labelNumber(t.label?.format);
          out.labelLines = t.label?.text ? [t.label.text] : [...(t.equation ? [line.fit.equation] : []), ...(t.rSquared ? [`R² = ${t.label?.format ? nf(line.fit.rSquared) : String(Math.round(line.fit.rSquared * 10000) / 10000)}`] : [])];
          if (t.label?.x || t.label?.y) out.labelOffset = { x: t.label.x ?? 0, y: t.label.y ?? 0 };
          if (t.label?.font) out.labelFont = t.label.font;
        }
        return out;
      });
    }
    if (s.errorBars) {
      const eb: NonNullable<ChartSeriesData["errorBars"]> = {};
      const amounts = (ref: string | undefined) => (ref === undefined ? undefined : cells(ref).map(num));
      if (s.errorBars.y) eb.y = errorBarAmounts(s.errorBars.y, values, amounts);
      if (s.errorBars.x && data.x) eb.x = errorBarAmounts(s.errorBars.x, data.x, amounts);
      if (eb.y || eb.x) data.errorBars = eb;
    }
    return data;
  });
  const n = Math.max(labels.length, ...series.map((s) => s.values.length), 0);
  const out: ChartData = { categories: Array.from({ length: n }, (_, k) => labels[k] ?? String(k + 1)), series };
  if ((chart.type === "treemap" || chart.type === "sunburst") && chart.categories) {
    const r = chartRef(chart.categories, home.name);
    const target = r && sheets.find((x) => x.name.toLowerCase() === r.sheet.toLowerCase());
    if (r && target && r.bounds.c2 > r.bounds.c1) {
      const levels: string[][] = [];
      for (let col = r.bounds.c1; col <= r.bounds.c2; col++) {
        if (target.columns?.[colName(col)]?.hidden === true) continue;
        const names: string[] = [];
        for (let row = r.bounds.r1; row <= r.bounds.r2 && names.length < MAX_CHART_POINTS; row++) {
          if (target.rows?.[String(row)]?.hidden === true) continue;
          names.push(read(target.id, cellAddress(row, col)).text);
        }
        levels.push(names);
      }
      out.levels = levels;
      out.categories = (levels[levels.length - 1] ?? []).map((leaf, k) => (leaf !== "" ? leaf : levels.map((l) => l[k] ?? "").filter(Boolean).pop() ?? String(k + 1)));
    }
  }
  return out;
}
