import { PliError } from "@pli.dev/core";
import type { Chart, ChartAxes, ChartAxis, ChartFont, ChartLabelPart, ChartSeries, ChartStockLook, ChartTickMark, ChartType, ErrorBars, SeriesErrorBars } from "./model";

/*
 * Checking and defaults for the later chart options: axis scales and looks, error bars, pie angles and explosion, stock
 * look, label content and position, and fonts. `cleanChart` calls these; the drawing and the XLSX code use the same defaults.
 */

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};
const COLOR = /^#[0-9a-fA-F]{6}$/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type AxisKey = "x" | "y" | "x2" | "y2";
const AXIS_KEYS: readonly AxisKey[] = ["x", "y", "x2", "y2"];
const TICKS: readonly ChartTickMark[] = ["none", "in", "out", "cross"];
const LABEL_POS = ["nextTo", "low", "high", "none"] as const;

/** The kinds that draw on a category axis and a value axis (or two value axes, for scatter and bubble). */
const AXES_KINDS: readonly ChartType[] = ["column", "bar", "line", "area", "scatter", "bubble", "stock", "surface", "radar", "waterfall", "histogram", "pareto", "boxWhisker", "funnel"];
const CHARTEX: readonly ChartType[] = ["waterfall", "histogram", "pareto", "boxWhisker", "funnel"];
const SECOND_KINDS: readonly ChartType[] = ["column", "bar", "line", "area", "scatter", "stock"];
export const ERROR_BAR_KINDS: readonly ChartType[] = ["column", "bar", "line", "area", "scatter", "bubble"];

/** Whether the `x` axis of a chart is a value axis (a scatter or bubble chart's) rather than a category axis. */
export const xIsValueAxis = (type: ChartType): boolean => type === "scatter" || type === "bubble";

/** Whether the axis `key` of a chart takes the settings of a value axis (an end, a unit, a log scale). */
export const isValueAxis = (type: ChartType, key: AxisKey): boolean => key === "y" || key === "y2" || (xIsValueAxis(type) && (key === "x" || key === "x2"));

/**
 * What an axis is, drawn, when the chart doesn't say: value axes have major gridlines (the first one, and a scatter chart's
 * x axis), nothing has minor gridlines, major ticks point out and minor ticks are off, labels sit beside the axis.
 */
export function axisDefaults(type: ChartType, key: AxisKey): { majorGridlines: boolean; minorGridlines: boolean; majorTick: ChartTickMark; minorTick: ChartTickMark; labels: "nextTo" | "low" | "high" | "none"; reverse: boolean; hidden: boolean } {
  const grid = (key === "y" && type !== "funnel") || (key === "x" && (xIsValueAxis(type) || type === "radar"));
  return { majorGridlines: grid, minorGridlines: false, majorTick: "out", minorTick: "none", labels: "nextTo", reverse: false, hidden: false };
}

/** An axis made ready to keep: checked, and with the fields that say what the default says left out. */
function cleanAxis(chart: Chart, key: AxisKey, a: ChartAxis): ChartAxis {
  const at = `The ${key} axis`;
  if (typeof a !== "object" || a === null || Array.isArray(a)) bad(`${at} settings must be an object`);
  const out: ChartAxis = { ...a };
  for (const k of Object.keys(out) as (keyof ChartAxis)[]) if (out[k] === undefined) delete out[k];
  const known = ["min", "max", "majorUnit", "minorUnit", "log", "reverse", "crosses", "majorGridlines", "minorGridlines", "majorTick", "minorTick", "labels", "labelEvery", "tickEvery", "format", "hidden", "font", "titleFont", "titleRuns"];
  for (const k of Object.keys(out)) if (!known.includes(k)) bad(`${at} has no setting "${k}"`);
  const value = isValueAxis(chart.type, key);
  for (const k of ["min", "max", "majorUnit", "minorUnit", "log", "format"] as const) if (out[k] !== undefined && !value) bad(`${at} is a category axis and has no ${k}`);
  for (const k of ["labelEvery", "tickEvery"] as const) if (out[k] !== undefined && value) bad(`${at} is a value axis and has no ${k}`);
  for (const k of ["min", "max"] as const) if (out[k] !== undefined && !finite(out[k])) bad(`${at} ${k} must be a number`);
  if (out.min !== undefined && out.max !== undefined && out.min >= out.max) bad(`${at} minimum must be below its maximum`);
  for (const k of ["majorUnit", "minorUnit"] as const) if (out[k] !== undefined && !(finite(out[k]) && out[k]! > 0)) bad(`${at} ${k} must be a number above 0`);
  if (out.log !== undefined) {
    if (!(finite(out.log) && out.log >= 2 && out.log <= 1000)) bad(`${at} log base is a number from 2 to 1000`);
    for (const k of ["min", "max"] as const) if (out[k] !== undefined && !(out[k]! > 0)) bad(`${at} ${k} must be above 0 on a logarithmic scale`);
    if (out.majorUnit !== undefined && !(out.majorUnit > 1)) bad(`${at} major unit on a logarithmic scale is a multiplier above 1`);
  }
  if (out.crosses !== undefined && out.crosses !== "min" && out.crosses !== "max" && !finite(out.crosses)) bad(`${at} crossing is "min", "max" or a number`);
  for (const k of ["majorGridlines", "minorGridlines", "reverse", "hidden"] as const) if (out[k] !== undefined && typeof out[k] !== "boolean") bad(`${at} ${k} is true or false`);
  for (const k of ["majorTick", "minorTick"] as const) if (out[k] !== undefined && !TICKS.includes(out[k]!)) bad(`${at} ${k} is one of ${TICKS.join(", ")}`);
  if (out.labels !== undefined && !LABEL_POS.includes(out.labels)) bad(`${at} labels are one of ${LABEL_POS.join(", ")}`);
  for (const k of ["labelEvery", "tickEvery"] as const) if (out[k] !== undefined && !(Number.isInteger(out[k]) && out[k]! >= 1 && out[k]! <= 255)) bad(`${at} ${k} is a whole number from 1 to 255`);
  if (out.format !== undefined && (typeof out.format !== "string" || out.format === "")) delete out.format;
  if (CHARTEX.includes(chart.type)) {
    for (const k of ["log", "reverse", "crosses"] as const) if (out[k] !== undefined) bad(`${at} of a ${chart.type} chart has no ${k}: Excel's newer chart kinds don't have it`);
    if (out.labels === "low" || out.labels === "high") bad(`${at} of a ${chart.type} chart has its labels beside the axis, or none`);
  }
  if (chart.type === "radar") for (const k of ["log", "reverse", "crosses", "labelEvery", "tickEvery"] as const) if (out[k] !== undefined) bad(`${at} of a radar chart has no ${k}`);
  const d = axisDefaults(chart.type, key);
  for (const k of ["majorGridlines", "minorGridlines", "reverse", "hidden", "majorTick", "minorTick", "labels"] as const) if (out[k] === d[k]) delete out[k];
  return out;
}

/** The `axes` of a chart made ready to keep; undefined when nothing is set. */
export function cleanAxes(chart: Chart): ChartAxes | undefined {
  const axes = chart.axes;
  if (axes === undefined) return undefined;
  if (typeof axes !== "object" || axes === null || Array.isArray(axes)) bad("A chart's axes must be an object");
  const out: ChartAxes = {};
  for (const k of Object.keys(axes)) if (!AXIS_KEYS.includes(k as AxisKey)) bad(`A chart has axes x, y, x2 and y2, not "${k}"`);
  if (!AXES_KINDS.includes(chart.type)) return undefined;
  for (const key of AXIS_KEYS) {
    const a = axes[key];
    if (a === undefined) continue;
    if ((key === "x2" || key === "y2") && !SECOND_KINDS.includes(chart.type)) bad(`A ${chart.type} chart has no second axis`);
    if (chart.type === "surface" && (a.log !== undefined || a.reverse !== undefined)) bad("A surface chart's axes can't be logarithmic or reversed");
    const c = cleanAxis(chart, key, a);
    if (Object.keys(c).length) out[key] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- error bars

function cleanBars(chart: Chart, s: ChartSeries, n: number, dir: "x" | "y", e: ErrorBars, checkRef: (what: string, ref: string | undefined) => void): ErrorBars {
  const at = `The ${dir} error bars of series ${n}`;
  if (typeof e !== "object" || e === null) bad(`${at} must be an object`);
  const out: ErrorBars = { ...e };
  for (const k of Object.keys(out) as (keyof ErrorBars)[]) if (out[k] === undefined) delete out[k];
  for (const k of Object.keys(out)) if (!["kind", "value", "direction", "endCap", "plus", "minus", "color"].includes(k)) bad(`${at} have no setting "${k}"`);
  if (!["fixed", "percent", "stdDev", "stdErr", "custom"].includes(out.kind)) bad(`${at} are fixed, percent, stdDev, stdErr or custom`);
  if (out.value !== undefined && !(finite(out.value) && out.value >= 0)) bad(`${at}: the amount must be a number from 0`);
  if (out.kind === "stdErr" || out.kind === "custom") delete out.value;
  if (out.value === (out.kind === "percent" ? 5 : 1) && out.kind !== "stdErr" && out.kind !== "custom") delete out.value;
  if (out.kind !== "custom") {
    delete out.plus;
    delete out.minus;
  } else {
    if (out.plus === undefined && out.minus === undefined) bad(`${at} (custom) need amounts to add, or to take away`);
    for (const k of ["plus", "minus"] as const) {
      const v = out[k];
      if (v === undefined) continue;
      if (typeof v === "string") checkRef(`${at}: the ${k} amounts`, v);
      else if (!(Array.isArray(v) && v.length > 0 && v.every(finite))) bad(`${at}: the ${k} amounts are a reference to cells, or a list of numbers`);
      else out[k] = [...v];
    }
  }
  if (out.direction !== undefined && !["both", "plus", "minus"].includes(out.direction)) bad(`${at}: the direction is both, plus or minus`);
  if (out.direction === "both") delete out.direction;
  if (out.endCap === true) delete out.endCap;
  else if (out.endCap !== undefined && out.endCap !== false) bad(`${at}: endCap is true or false`);
  if (out.color !== undefined && !COLOR.test(out.color)) bad("An error bar colour looks like #rrggbb");
  void chart;
  void s;
  return out;
}

/** The error bars of a series made ready to keep (or removed, when the series can't have them). */
export function cleanSeriesErrorBars(chart: Chart, s: ChartSeries, n: number, kind: ChartType, checkRef: (what: string, ref: string | undefined) => void): SeriesErrorBars | undefined {
  const eb = s.errorBars;
  if (eb === undefined) return undefined;
  if (typeof eb !== "object" || eb === null) bad(`The error bars of series ${n} must be an object`);
  for (const k of Object.keys(eb)) if (k !== "x" && k !== "y") bad(`Error bars go along x or y, not "${k}"`);
  const out: SeriesErrorBars = {};
  if (eb.y === undefined && eb.x === undefined) return undefined;
  if (!ERROR_BAR_KINDS.includes(kind)) bad(`A ${kind} series can't have error bars`);
  if (chart.view3d) bad("A 3-D chart can't have error bars");
  if (chart.grouping === "percent" && kind === chart.type) bad("A 100% stacked series can't have error bars");
  if (eb.y) out.y = cleanBars(chart, s, n, "y", eb.y, checkRef);
  if (eb.x) {
    if (!xIsValueAxis(chart.type)) bad("Only scatter and bubble charts have error bars along x");
    out.x = cleanBars(chart, s, n, "x", eb.x, checkRef);
  }
  return out;
}

// ---------------------------------------------------------------- the rest

const PIE_KINDS: readonly ChartType[] = ["pie", "doughnut", "pieOfPie", "barOfPie"];

function cleanFont(what: string, f: ChartFont | undefined): ChartFont | undefined {
  if (f === undefined) return undefined;
  if (typeof f !== "object" || f === null) bad(`${what} must be an object`);
  const out: ChartFont = { ...f };
  for (const k of Object.keys(out) as (keyof ChartFont)[]) if (out[k] === undefined || out[k] === "") delete out[k];
  for (const k of Object.keys(out)) if (!["family", "size", "bold", "italic", "color"].includes(k)) bad(`${what} has no setting "${k}"`);
  if (out.size !== undefined && !(finite(out.size) && out.size >= 1 && out.size <= 400)) bad(`${what}: the size is from 1 to 400 points`);
  if (out.color !== undefined && !COLOR.test(out.color)) bad(`${what}: the colour looks like #rrggbb`);
  if (out.family !== undefined && typeof out.family !== "string") bad(`${what}: the family is a font name`);
  for (const k of ["bold", "italic"] as const) if (out[k] !== undefined && typeof out[k] !== "boolean") bad(`${what}: ${k} is true or false`);
  if (out.italic === false) delete out.italic;
  return Object.keys(out).length ? out : undefined;
}

/** Which positions a data label can take in a chart of this kind (and grouping), as Excel offers them. */
export function labelPositionsFor(chart: Pick<Chart, "type" | "grouping">): readonly NonNullable<Chart["labelPosition"]>[] {
  switch (chart.type) {
    case "column":
    case "bar":
      return chart.grouping ? ["center", "insideEnd", "insideBase"] : ["center", "insideEnd", "insideBase", "outsideEnd"];
    case "line":
    case "scatter":
    case "bubble":
    case "radar":
      return ["center", "above", "below", "left", "right"];
    case "pie":
    case "pieOfPie":
    case "barOfPie":
      return ["center", "insideEnd", "outsideEnd", "bestFit"];
    case "waterfall":
    case "histogram":
    case "pareto":
      return ["center", "insideEnd", "insideBase", "outsideEnd"];
    default:
      return [];
  }
}

/** Checks and tidies the later options of a chart in place (`out` is already a copy). */
export function cleanExtras(out: Chart): void {
  const pie = PIE_KINDS.includes(out.type);
  if (out.axes !== undefined) {
    const axes = cleanAxes(out);
    if (axes) out.axes = axes;
    else delete out.axes;
  }
  if (out.firstSliceAngle !== undefined) {
    if (out.type !== "pie" && out.type !== "doughnut") delete out.firstSliceAngle;
    else if (!(finite(out.firstSliceAngle) && out.firstSliceAngle >= 0 && out.firstSliceAngle <= 360)) bad("The first slice angle is from 0 to 360 degrees");
    else if (out.firstSliceAngle === 0 || out.firstSliceAngle === 360) delete out.firstSliceAngle;
  }
  out.series.forEach((s, i) => {
    if (!pie) {
      delete s.explosion;
      delete s.pointExplosion;
      return;
    }
    if (s.explosion !== undefined) {
      if (!(finite(s.explosion) && s.explosion >= 0 && s.explosion <= 400)) bad(`Series ${i + 1}: the explosion is from 0 to 400 percent`);
      if (s.explosion === 0) delete s.explosion;
    }
    if (s.pointExplosion !== undefined) {
      if (typeof s.pointExplosion !== "object" || s.pointExplosion === null) bad(`Series ${i + 1}: the point explosion is an object`);
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.pointExplosion)) {
        if (!/^\d+$/.test(k)) bad(`Series ${i + 1}: point explosions are by point number from 0`);
        if (!(finite(v) && v >= 0 && v <= 400)) bad(`Series ${i + 1}: the explosion is from 0 to 400 percent`);
        clean[k] = v;
      }
      if (Object.keys(clean).length) s.pointExplosion = clean;
      else delete s.pointExplosion;
    }
  });
  if (out.stockLook !== undefined) {
    if (out.type !== "stock") delete out.stockLook;
    else {
      const l: ChartStockLook = { ...out.stockLook };
      for (const k of Object.keys(l) as (keyof ChartStockLook)[]) if (l[k] === undefined) delete l[k];
      for (const k of Object.keys(l)) if (!["hiLowLines", "hiLowColor", "upDownBars", "upColor", "downColor", "gapWidth"].includes(k)) bad(`A stock chart's look has no setting "${k}"`);
      for (const k of ["hiLowColor", "upColor", "downColor"] as const) if (l[k] !== undefined && !COLOR.test(l[k]!)) bad(`The ${k} looks like #rrggbb`);
      if (l.gapWidth !== undefined && !(finite(l.gapWidth) && l.gapWidth >= 0 && l.gapWidth <= 500)) bad("The gap between stock bodies is from 0 to 500 percent");
      if (l.gapWidth === 150) delete l.gapWidth;
      for (const k of ["hiLowLines", "upDownBars"] as const) if (l[k] === true) delete l[k];
      if (Object.keys(l).length) out.stockLook = l;
      else delete out.stockLook;
    }
  }
  if (out.waterfall !== undefined) {
    if (out.type !== "waterfall") delete out.waterfall;
    else {
      const w = { ...out.waterfall };
      if (w.connectors === undefined || w.connectors === true) delete w.connectors;
      else if (w.connectors !== false) bad("A waterfall's connectors are true or false");
      for (const k of ["increaseColor", "decreaseColor", "totalColor"] as const) if (w[k] === undefined) delete w[k];
      if (Object.keys(w).length) out.waterfall = w;
      else delete out.waterfall;
    }
  }
  if (out.labelShow !== undefined) {
    const parts: ChartLabelPart[] = ["value", "category", "series", "percent"];
    if (!Array.isArray(out.labelShow) || out.labelShow.some((p) => !parts.includes(p))) bad(`Data labels show ${parts.join(", ")}`);
    out.labelShow = parts.filter((p) => out.labelShow!.includes(p));
    if (out.labelShow.includes("percent") && !pie) bad("Only pie, doughnut and of-pie charts show percentages");
    if (!out.labelShow.length || (out.labelShow.length === 1 && out.labelShow[0] === "value" && out.type !== "treemap" && out.type !== "sunburst")) delete out.labelShow;
  }
  if ((out.type === "treemap" || out.type === "sunburst") && out.labelShow) {
    // The labels of these kinds name the groups anyway; "labels" is whether they give the value, which labelShow then says.
    if (out.labelShow.includes("value")) out.labels = true;
    else delete out.labels;
  }
  if (out.labelPosition !== undefined) {
    const allowed = labelPositionsFor(out);
    if (!allowed.includes(out.labelPosition)) bad(allowed.length ? `A ${out.type} chart's labels can go ${allowed.join(", ")}` : `A ${out.type} chart's labels have no position to choose`);
  }
  if (out.titleRuns !== undefined) {
    if (!Array.isArray(out.titleRuns)) bad("The title runs must be a list");
    const runs = out.titleRuns.map((r, i) => {
      if (typeof r !== "object" || r === null || typeof r.text !== "string") bad(`Title piece ${i + 1} needs text`);
      const { text, underline, ...look } = r;
      const f = cleanFont(`Title piece ${i + 1}`, look);
      // A title is bold unless a piece says otherwise.
      if (f?.bold === true) delete f.bold;
      return { text, ...(underline === true ? { underline: true as const } : {}), ...(f ?? {}) };
    }).filter((r) => r.text !== "");
    if (!runs.length) delete out.titleRuns;
    else {
      out.titleRuns = runs;
      out.title = runs.map((r) => r.text).join("");
    }
  }
  const font = cleanFont("The chart font", out.font);
  if (font) out.font = font;
  else delete out.font;
  const tf = cleanFont("The title font", out.titleFont);
  if (tf) out.titleFont = tf;
  else delete out.titleFont;
}

/** The references an error-bar series holds (to follow renamed sheets and moved cells). */
export function errorBarRefs(s: ChartSeries): string[] {
  const out: string[] = [];
  for (const dir of ["x", "y"] as const) {
    const e = s.errorBars?.[dir];
    for (const k of ["plus", "minus"] as const) if (typeof e?.[k] === "string") out.push(e[k] as string);
  }
  return out;
}
