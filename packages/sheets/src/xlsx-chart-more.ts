import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import { fileFont, pitchFamilyHint } from "./xlsx-fonts";
import { chartRef, chartRefText } from "./chart";
import { axisDefaults, isValueAxis, type AxisKey } from "./chart-extras";
import type { Chart, ChartAxis, ChartFont, ChartSeries, ChartStockLook, ChartTickMark, ChartType, ErrorBars, SeriesErrorBars } from "./model";
import type { ErrorBarData } from "./errorbars";

/*
 * The later chart options in an .xlsx chart part: axis scaling, gridlines, tick marks and crossing; error bars; fonts; data
 * label content and position; pie angles and explosion; the look of a stock chart. Writing builds the XML for the pieces
 * `chartPartXml` puts together; reading turns the same elements back into the chart's fields.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const solid = (color: string) => `<a:solidFill><a:srgbClr val="${color.slice(1).toUpperCase()}"/></a:solidFill>`;
const on = (e: XmlElement | undefined): boolean => e !== undefined && attr(e, "val") !== "0" && attr(e, "val") !== "false";

// ================= writing =================

/** `a:latin` for a family: the name, and the pitch and family hint (what Excel writes) for computers without the font. */
function latinXml(family: string): string {
  const name = fileFont(family);
  return `<a:latin typeface="${esc(name)}" pitchFamily="${pitchFamilyHint(name)}" charset="0"/>`;
}

/** The `a:defRPr` / `a:rPr` attributes and children for a font; `size` and `bold` are the defaults when the font doesn't say. */
export function fontParts(font: ChartFont | undefined, size: number, bold: boolean): { attrs: string; inner: string } {
  const sz = font?.size !== undefined ? Math.round(font.size * 100) : size;
  const b = font?.bold !== undefined ? font.bold : bold;
  return {
    attrs: `sz="${sz}" b="${b ? 1 : 0}"${font?.italic ? ' i="1"' : ""}`,
    inner: `${font?.color ? solid(font.color) : ""}${font?.family ? latinXml(font.family) : ""}`,
  };
}

/** The chart's default text properties (`c:txPr`), written after the chart when it has a font. */
export function chartTxPr(font: ChartFont | undefined, ns: "c" | "cx" = "c"): string {
  if (!font || !Object.keys(font).length) return "";
  const p = fontParts(font, 1000, false);
  return `<${ns}:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr ${p.attrs}>${p.inner}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></${ns}:txPr>`;
}

const DLBL_POS: Record<NonNullable<Chart["labelPosition"]>, string> = { center: "ctr", insideEnd: "inEnd", insideBase: "inBase", outsideEnd: "outEnd", above: "t", below: "b", left: "l", right: "r", bestFit: "bestFit" };
export const dLblPosOf = (p: Chart["labelPosition"]): string | undefined => (p ? DLBL_POS[p] : undefined);

/** The data labels of a series or chart group: the parts shown and their place. */
export function dLblsXml(chart: Chart, kind: ChartType): string {
  if (!chart.labels) return "";
  const pie = kind === "pie" || kind === "doughnut" || kind === "pieOfPie" || kind === "barOfPie";
  const show = chart.labelShow;
  const flag = (part: "value" | "category" | "series" | "percent", dflt: boolean) => (show ? show.includes(part) : dflt) ? 1 : 0;
  const pos = dLblPosOf(chart.labelPosition);
  return (
    `<c:dLbls>${chartTxPr(chart.labelFont)}${pos ? `<c:dLblPos val="${pos}"/>` : ""}<c:showLegendKey val="0"/><c:showVal val="${flag("value", true)}"/><c:showCatName val="${flag("category", false)}"/>` +
    `<c:showSerName val="${flag("series", false)}"/><c:showPercent val="${flag("percent", pie)}"/><c:showBubbleSize val="0"/></c:dLbls>`
  );
}

const pt = (n: number | null, i: number) => (n === null ? "" : `<c:pt idx="${i}"><c:v>${n}</c:v></c:pt>`);

/** The `c:errBars` of a series in one direction. `data` is the amounts worked out (written as the cache beside a reference). */
export function errBarsXml(spec: ErrorBars, dir: "x" | "y", data: ErrorBarData | undefined, home: string, omitDir = false): string {
  const type = spec.direction === "plus" ? "plus" : spec.direction === "minus" ? "minus" : "both";
  const valType = { fixed: "fixedVal", percent: "percentage", stdDev: "stdDev", stdErr: "stdErr", custom: "cust" }[spec.kind];
  const side = (which: "plus" | "minus") => {
    const given = spec[which];
    const cache = (data?.[which] ?? []).map((v) => (v === null ? 0 : v));
    if (typeof given === "string") {
      const r = chartRef(given, home);
      if (r) return `<c:${which}><c:numRef><c:f>${esc(chartRefText(r.sheet, r.bounds))}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${cache.length}"/>${cache.map(pt).join("")}</c:numCache></c:numRef></c:${which}>`;
    }
    const list = Array.isArray(given) ? given : [0];
    return `<c:${which}><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${list.length}"/>${list.map(pt).join("")}</c:numLit></c:${which}>`;
  };
  const amount = spec.kind === "fixed" || spec.kind === "percent" || spec.kind === "stdDev" ? `<c:val val="${spec.value ?? (spec.kind === "percent" ? 5 : 1)}"/>` : "";
  const line = spec.color ? `<c:spPr><a:ln w="9525">${solid(spec.color)}</a:ln></c:spPr>` : "";
  return `<c:errBars>${omitDir ? "" : `<c:errDir val="${dir}"/>`}<c:errBarType val="${type}"/><c:errValType val="${valType}"/><c:noEndCap val="${spec.endCap === false ? 1 : 0}"/>${spec.kind === "custom" ? side("plus") + side("minus") : ""}${amount}${line}</c:errBars>`;
}

/** Both directions' `c:errBars` for a series (x first, as the schema orders them). */
export function seriesErrBarsXml(s: ChartSeries, data: { y?: ErrorBarData; x?: ErrorBarData } | undefined, home: string, omitDir = false): string {
  const eb = s.errorBars;
  if (!eb) return "";
  return (eb.x ? errBarsXml(eb.x, "x", data?.x, home) : "") + (eb.y ? errBarsXml(eb.y, "y", data?.y, home, omitDir) : "");
}

/** The `c:scaling` element of an axis. `flip` is the orientation the chart itself needs (a bar chart's category axis), reversed by `reverse`. */
export function scalingXml(ax: ChartAxis | undefined, flip: boolean): string {
  const reversed = flip !== !!ax?.reverse;
  return `<c:scaling>${ax?.log ? `<c:logBase val="${ax.log}"/>` : ""}<c:orientation val="${reversed ? "maxMin" : "minMax"}"/>${ax?.max !== undefined ? `<c:max val="${ax.max}"/>` : ""}${ax?.min !== undefined ? `<c:min val="${ax.min}"/>` : ""}</c:scaling>`;
}

/** The gridline elements of an axis. */
export function gridXml(chart: Chart, key: AxisKey, ax: ChartAxis | undefined, forceMajor?: boolean): string {
  const d = axisDefaults(chart.type, key);
  return `${(ax?.majorGridlines ?? forceMajor ?? d.majorGridlines) ? "<c:majorGridlines/>" : ""}${ax?.minorGridlines ? "<c:minorGridlines/>" : ""}`;
}

/** Tick marks and label position. */
export function ticksXml(chart: Chart, key: AxisKey, ax: ChartAxis | undefined): string {
  const d = axisDefaults(chart.type, key);
  return `<c:majorTickMark val="${ax?.majorTick ?? d.majorTick}"/><c:minorTickMark val="${ax?.minorTick ?? d.minorTick}"/><c:tickLblPos val="${ax?.labels ?? d.labels}"/>${chartTxPr(ax?.font)}`;
}

/** `c:crosses` / `c:crossesAt` for the axis element that crosses `other` as `other.crosses` says (`dflt` when it doesn't say). */
export function crossesXml(other: ChartAxis | undefined, dflt: string): string {
  const c = other?.crosses;
  if (c === undefined) return `<c:crosses val="${dflt}"/>`;
  return typeof c === "number" ? `<c:crossesAt val="${c}"/>` : `<c:crosses val="${c}"/>`;
}

/** Category-axis intervals, after `lblOffset`. */
export const skipXml = (ax: ChartAxis | undefined): string => `${ax?.labelEvery && ax.labelEvery > 1 ? `<c:tickLblSkip val="${ax.labelEvery}"/>` : ""}${ax?.tickEvery && ax.tickEvery > 1 ? `<c:tickMarkSkip val="${ax.tickEvery}"/>` : ""}`;

/** Major and minor units, after `crossBetween`. */
export const unitsXml = (ax: ChartAxis | undefined): string => `${ax?.majorUnit !== undefined ? `<c:majorUnit val="${ax.majorUnit}"/>` : ""}${ax?.minorUnit !== undefined ? `<c:minorUnit val="${ax.minorUnit}"/>` : ""}`;

export const isHidden = (ax: ChartAxis | undefined): boolean => !!ax?.hidden;

/** The look of a stock chart's high-low lines and up/down bars. */
export function stockLookXml(look: ChartStockLook | undefined, open: boolean): { hiLow: string; bars: string } {
  const hiLow = look?.hiLowLines === false ? "" : look?.hiLowColor ? `<c:hiLowLines><c:spPr><a:ln w="9525">${solid(look.hiLowColor)}</a:ln></c:spPr></c:hiLowLines>` : "<c:hiLowLines/>";
  if (!open || look?.upDownBars === false) return { hiLow, bars: "" };
  const up = look?.upColor ?? "#FFFFFF";
  const down = look?.downColor ?? "#000000";
  return {
    hiLow,
    bars: `<c:upDownBars><c:gapWidth val="${look?.gapWidth ?? 150}"/><c:upBars><c:spPr>${solid(up)}<a:ln w="9525">${solid("#000000")}</a:ln></c:spPr></c:upBars><c:downBars><c:spPr>${solid(down)}<a:ln w="9525">${solid("#000000")}</a:ln></c:spPr></c:downBars></c:upDownBars>`,
  };
}

// ================= reading =================

const num = (e: XmlElement | undefined): number | undefined => {
  const v = attr(e, "val");
  return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
};

/**
 * Reads an axis element into the chart's axis settings. `flip` is the orientation that is this chart's own for the axis (a bar
 * chart's category axis is drawn the other way round), so `reverse` is true only when the file differs from it.
 */
export function readAxis(type: ChartType, key: AxisKey, el: XmlElement | undefined, flip: boolean): ChartAxis {
  const out: ChartAxis = {};
  if (!el) return out;
  const d = axisDefaults(type, key);
  const scaling = child(el, "scaling");
  const value = isValueAxis(type, key);
  if (value) {
    const log = num(child(scaling, "logBase"));
    if (log !== undefined && log >= 2 && log <= 1000) out.log = log;
    const max = num(child(scaling, "max"));
    const min = num(child(scaling, "min"));
    if (max !== undefined) out.max = max;
    if (min !== undefined) out.min = min;
    if (out.min !== undefined && out.max !== undefined && out.min >= out.max) {
      delete out.min;
      delete out.max;
    }
    if (out.log !== undefined) {
      if (out.min !== undefined && !(out.min > 0)) delete out.min;
      if (out.max !== undefined && !(out.max > 0)) delete out.max;
    }
    const major = num(child(el, "majorUnit"));
    const minor = num(child(el, "minorUnit"));
    if (major !== undefined && major > 0 && (out.log === undefined || major > 1)) out.majorUnit = major;
    if (minor !== undefined && minor > 0) out.minorUnit = minor;
    const fmt = child(el, "numFmt");
    if (fmt && attr(fmt, "sourceLinked") !== "1" && attr(fmt, "formatCode") && attr(fmt, "formatCode") !== "General" && !/^0%$/.test(attr(fmt, "formatCode")!)) out.format = attr(fmt, "formatCode")!;
  } else {
    const every = num(child(el, "tickLblSkip"));
    const tick = num(child(el, "tickMarkSkip"));
    if (every !== undefined && Number.isInteger(every) && every > 1 && every <= 255) out.labelEvery = every;
    if (tick !== undefined && Number.isInteger(tick) && tick > 1 && tick <= 255) out.tickEvery = tick;
  }
  if ((attr(child(scaling, "orientation"), "val") === "maxMin") !== flip) out.reverse = true;
  const hasMajor = child(el, "majorGridlines") !== undefined;
  if (hasMajor !== d.majorGridlines) out.majorGridlines = hasMajor;
  if (child(el, "minorGridlines") !== undefined) out.minorGridlines = true;
  const tick = (name: string): ChartTickMark | undefined => {
    const v = attr(child(el, name), "val");
    return v === "none" || v === "in" || v === "out" || v === "cross" ? v : undefined;
  };
  const major = tick("majorTickMark");
  const minor = tick("minorTickMark");
  if (major && major !== d.majorTick) out.majorTick = major;
  if (minor && minor !== d.minorTick) out.minorTick = minor;
  const lbl = attr(child(el, "tickLblPos"), "val");
  if ((lbl === "low" || lbl === "high" || lbl === "none") && lbl !== d.labels) out.labels = lbl;
  if (on(child(el, "delete"))) out.hidden = true;
  return out;
}

/**
 * Where the perpendicular axis crosses `el`, as the model says it: the `crosses` of the axis `el` stands on is read from the
 * OTHER axis element (`crossEl`), whose `crosses`/`crossesAt` names the place on `el`.
 */
export function readCrossing(crossEl: XmlElement | undefined): "min" | "max" | number | undefined {
  if (!crossEl) return undefined;
  const at = num(child(crossEl, "crossesAt"));
  if (at !== undefined) return at;
  const v = attr(child(crossEl, "crosses"), "val");
  return v === "max" ? "max" : v === "min" ? "min" : undefined;
}

/** Reads one `c:errBars` into the error bars it describes. */
export function readErrBars(el: XmlElement, home: string): { dir: "x" | "y"; bars: ErrorBars } | null {
  const valType = attr(child(el, "errValType"), "val");
  const kind = ({ fixedVal: "fixed", percentage: "percent", stdDev: "stdDev", stdErr: "stdErr", cust: "custom" } as Record<string, ErrorBars["kind"]>)[valType ?? ""];
  if (!kind) return null;
  const bars: ErrorBars = { kind };
  const type = attr(child(el, "errBarType"), "val");
  if (type === "plus" || type === "minus") bars.direction = type;
  if (on(child(el, "noEndCap"))) bars.endCap = false;
  const val = num(child(el, "val"));
  if (val !== undefined && val >= 0 && kind !== "custom" && kind !== "stdErr" && val !== (kind === "percent" ? 5 : 1)) bars.value = val;
  if (kind === "custom") {
    for (const which of ["plus", "minus"] as const) {
      const holder = child(el, which);
      const ref = textOf(child(child(holder, "numRef"), "f")).trim();
      const parsed = ref ? chartRef(ref, home) : null;
      const cache = child(child(holder, "numRef"), "numCache") ?? child(holder, "numLit");
      const list = childrenNamed(cache, "pt").map((p) => ({ i: Number(attr(p, "idx")), v: Number(textOf(child(p, "v"))) })).filter((p) => Number.isFinite(p.v));
      if (parsed) bars[which] = chartRefText(parsed.sheet, parsed.bounds);
      else if (list.length) {
        const count = Number(attr(child(cache, "ptCount"), "val")) || Math.max(...list.map((p) => p.i)) + 1;
        const arr = Array.from({ length: count }, () => 0);
        for (const p of list) arr[p.i] = p.v;
        // A single typed number stays one number: it is the amount for every point.
        bars[which] = arr;
      }
    }
    if (bars.plus === undefined && bars.minus === undefined) return null;
    // A side that is only zeros is the side not drawn.
    const zeros = (v: string | number[] | undefined) => Array.isArray(v) && v.every((x) => x === 0);
    if (zeros(bars.plus) && !zeros(bars.minus)) {
      delete bars.plus;
      if (!bars.direction) bars.direction = "minus";
    } else if (zeros(bars.minus) && !zeros(bars.plus)) {
      delete bars.minus;
      if (!bars.direction) bars.direction = "plus";
    }
  }
  const color = attr(child(child(child(child(el, "spPr"), "ln"), "solidFill"), "srgbClr"), "val");
  if (color && /^[0-9a-fA-F]{6}$/.test(color)) bars.color = `#${color.toLowerCase()}`;
  const dirAttr = attr(child(el, "errDir"), "val");
  return { dir: dirAttr === "x" ? "x" : "y", bars };
}

/** The error bars of a `c:ser`. */
export function readSeriesErrBars(ser: XmlElement, home: string): SeriesErrorBars | undefined {
  const out: SeriesErrorBars = {};
  for (const el of childrenNamed(ser, "errBars")) {
    const r = readErrBars(el, home);
    if (r) out[r.dir] = r.bars;
  }
  return out.x || out.y ? out : undefined;
}

/** Fonts: the default text properties of a part, read back into a chart font. */
export function readFont(defRPr: XmlElement | undefined): ChartFont | undefined {
  if (!defRPr) return undefined;
  const out: ChartFont = {};
  const sz = Number(attr(defRPr, "sz"));
  if (Number.isFinite(sz) && sz >= 100 && sz <= 40000) out.size = Math.round(sz) / 100;
  if (attr(defRPr, "b") === "1" || attr(defRPr, "b") === "true") out.bold = true;
  if (attr(defRPr, "i") === "1" || attr(defRPr, "i") === "true") out.italic = true;
  const color = attr(child(child(defRPr, "solidFill"), "srgbClr"), "val");
  if (color && /^[0-9a-fA-F]{6}$/.test(color)) out.color = `#${color.toLowerCase()}`;
  const face = attr(child(defRPr, "latin"), "typeface");
  if (face && !face.startsWith("+")) out.family = face;
  return Object.keys(out).length ? out : undefined;
}

/** Which parts of a data label a `c:dLbls` shows, and where it puts them. */
export function readDLbls(d: XmlElement | undefined, pie: boolean): { show?: NonNullable<Chart["labelShow"]>; pos?: NonNullable<Chart["labelPosition"]> } {
  if (!d) return {};
  const show: NonNullable<Chart["labelShow"]> = [];
  if (on(child(d, "showVal"))) show.push("value");
  if (on(child(d, "showCatName"))) show.push("category");
  if (on(child(d, "showSerName"))) show.push("series");
  if (on(child(d, "showPercent"))) show.push("percent");
  const order = ["value", "category", "series", "percent"] as const;
  show.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const out: { show?: NonNullable<Chart["labelShow"]>; pos?: NonNullable<Chart["labelPosition"]> } = {};
  // The usual labels (the value, plus the percent on a pie) are the default and need no mention.
  const plain = pie ? show.every((p) => p === "value" || p === "percent") && show.includes("percent") : show.length === 1 && show[0] === "value";
  if (show.length && !plain) out.show = show;
  const pos = ({ ctr: "center", inEnd: "insideEnd", inBase: "insideBase", outEnd: "outsideEnd", t: "above", b: "below", l: "left", r: "right", bestFit: "bestFit" } as const)[attr(child(d, "dLblPos"), "val") as "ctr"];
  if (pos) out.pos = pos;
  return out;
}

/**
 * The look of a title read from its element: its font (what its first run says, apart from what the chart's own font already
 * says) and, when its runs differ in look, the runs. `size` and `bold` are what a title is by default, so a title that has only
 * those says nothing.
 */
export function readTitleStyle(title: XmlElement | undefined, chartFont: ChartFont | undefined, dflt: { size: number; bold: boolean }): { font?: ChartFont; runs?: NonNullable<Chart["titleRuns"]> } {
  const p = child(child(child(title, "tx"), "rich"), "p");
  const runEls = childrenNamed(p, "r");
  if (!runEls.length) return {};
  const clean = (rPr: XmlElement | undefined): ChartFont => {
    const look = readFont(rPr) ?? {};
    if (look.size === dflt.size) delete look.size;
    if (dflt.bold && look.bold === true) delete look.bold;
    else if (!dflt.bold && look.bold === false) delete look.bold;
    else if (dflt.bold && attr(rPr, "b") === "0") look.bold = false;
    for (const k of Object.keys(look) as (keyof ChartFont)[]) if (chartFont && chartFont[k] === look[k] && k !== "bold") delete look[k];
    return look;
  };
  const out: { font?: ChartFont; runs?: NonNullable<Chart["titleRuns"]> } = {};
  const first = clean(child(runEls[0], "rPr"));
  if (Object.keys(first).length) out.font = first;
  if (runEls.length > 1) {
    const runs = runEls.map((r) => {
      const rPr = child(r, "rPr");
      return { text: textOf(child(r, "t")), ...(attr(rPr, "u") && attr(rPr, "u") !== "none" ? { underline: true as const } : {}), ...clean(rPr) };
    });
    if (runs.some((r) => JSON.stringify({ ...r, text: "" }) !== JSON.stringify({ ...runs[0], text: "" }))) {
      out.runs = runs;
      delete out.font;
    }
  }
  return out;
}

/** The font a part's `txPr` sets (an axis' labels, the legend, data labels), apart from what the chart's own font says. */
export function readTxPrFont(el: XmlElement | undefined, chartFont: ChartFont | undefined): ChartFont | undefined {
  const f = readFont(child(child(child(el, "txPr"), "p"), "pPr") ? child(child(child(child(el, "txPr"), "p"), "pPr"), "defRPr") : undefined);
  if (!f) return undefined;
  if (f.size === 10) delete f.size;
  for (const k of Object.keys(f) as (keyof ChartFont)[]) if (chartFont && chartFont[k] === f[k]) delete f[k];
  return Object.keys(f).length ? f : undefined;
}

export type { AxisKey };
