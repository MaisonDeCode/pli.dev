import { resolveColor, toHex } from "./color";
import type { ChartAxis, ChartElement, ChartSeries, Color, Theme, ThemeSlot } from "./model";
import { defaultMeasure, type TextMeasurer } from "./textlayout";

/*
 * Chart geometry without a renderer: `chartScene` turns a chart (data and options) into drawing primitives (filled
 * rectangles, paths, lines and text) in the chart's own point space, `0..w` by `0..h` from its top left corner. The
 * editor draws them as SVG, the PDF exporter as page items and tests read them as data, so a chart looks the same
 * everywhere. Pure and deterministic: the same chart, size, theme and measurer always give the same scene.
 *
 * Layout is the usual one: title on top, a legend at one edge, then the axes with their labels around the plot. Axis
 * scales use round numbers (1, 2, 5 times a power of ten) with a little headroom above the data, as Excel's do.
 */

// ---- Output ------------------------------------------------------------------------------------------------------

/** A path drawing command. Arcs are already Béziers, so any renderer can draw them. */
export type PathCmd = readonly ["M", number, number] | readonly ["L", number, number] | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];

export interface ChartPaint {
  /** `#rrggbb` */
  color: string;
  alpha: number;
}

export interface ChartStroke extends ChartPaint {
  width: number;
  dash?: number[];
  cap?: "butt" | "round";
  join?: "round" | "miter";
}

interface ItemBase {
  /** What it is, for tests and accessibility: `bar`, `slice`, `gridline`, `axis`, `tick-label`, `legend-label`, `title`, `data-label`... */
  part: string;
  /** The series it belongs to, and its point, when it belongs to one. */
  series?: number;
  point?: number;
}

export type ChartItem =
  | (ItemBase & { kind: "rect"; x: number; y: number; w: number; h: number; fill?: ChartPaint; stroke?: ChartStroke })
  | (ItemBase & { kind: "path"; d: PathCmd[]; fill?: ChartPaint; stroke?: ChartStroke })
  | (ItemBase & { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: ChartStroke })
  | (ItemBase & {
      kind: "text";
      text: string;
      /** The anchor point: its x, and the baseline's y. */
      x: number;
      y: number;
      size: number;
      color: string;
      alpha: number;
      bold: boolean;
      anchor: "start" | "middle" | "end";
      /** Degrees clockwise about (x, y). */
      rotate?: number;
    });

export interface ChartScene {
  width: number;
  height: number;
  /** The font family every text item uses. */
  fontFamily: string;
  items: ChartItem[];
  /** The plot area (where bars and lines are drawn), for cartesian charts; the pie's bounding square for pie charts. */
  plot: { x: number; y: number; w: number; h: number };
  /** What the legend lists, in order (empty when there is no legend). */
  legend: { text: string; color: string }[];
}

// ---- Colours -----------------------------------------------------------------------------------------------------

const ACCENTS: ThemeSlot[] = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

/** The colour a series (or pie slice) has when it sets none: the theme's accents in turn, then darker and lighter versions of them. */
export function defaultSeriesColor(index: number): Color {
  const slot = ACCENTS[((index % 6) + 6) % 6]!;
  const round = Math.floor(index / 6) % 4;
  if (round === 0) return { theme: slot };
  if (round === 1) return { theme: slot, lumMod: 0.6 };
  if (round === 2) return { theme: slot, lumMod: 0.8, lumOff: 0.2 };
  return { theme: slot, lumMod: 0.4, lumOff: 0.6 };
}

const TEXT_DEFAULT: Color = { theme: "dk1", lumMod: 0.75, lumOff: 0.25 };

// ---- Numbers -----------------------------------------------------------------------------------------------------

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A number the way a spreadsheet shows it when it has no format: up to ten significant digits. */
export function generalNumber(v: number): string {
  if (!Number.isFinite(v)) return "";
  const n = Number(v.toPrecision(10));
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e11 || a < 1e-5)) return n.toExponential().replace("e+", "E+").replace("e-", "E-");
  return String(n);
}

/**
 * Formats a number with a spreadsheet number format: `General`, `0`, `0.00`, `#,##0`, `0%`, `$#,##0.00`, `0.0"x"`,
 * with an optional second section for negative numbers. Anything else in the format is kept as literal text.
 */
export function formatNumber(value: number, format?: string): string {
  if (!Number.isFinite(value)) return "";
  if (!format || /^general$/i.test(format.trim())) return generalNumber(value);
  const sections = format.split(";");
  const negative = value < 0 && sections.length > 1;
  const section = negative ? sections[1]! : sections[0]!;
  const m = /[#0?][#0?,]*(?:\.[#0?]*)?|\.[0#?]+/.exec(section.replace(/"[^"]*"/g, (q) => " ".repeat(q.length)));
  if (!m) return section.replace(/["\\_*]/g, "");
  const pattern = m[0];
  const literal = (s: string) => s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ").replace(/\*./g, "").replace(/\[[^\]]*\]/g, "");
  const prefix = literal(section.slice(0, m.index));
  let suffix = literal(section.slice(m.index + pattern.length));
  let x = negative ? Math.abs(value) : value;
  if (/%/.test(section)) x *= 100;
  const dot = pattern.indexOf(".");
  const frac = dot < 0 ? "" : pattern.slice(dot + 1);
  const minDecimals = (frac.match(/0/g) ?? []).length;
  const maxDecimals = frac.length;
  let text = Math.abs(x).toFixed(Math.min(maxDecimals, 20));
  if (maxDecimals > minDecimals && text.includes(".")) {
    text = text.replace(/0+$/, "");
    const have = text.length - text.indexOf(".") - 1;
    if (have < minDecimals) text += "0".repeat(minDecimals - have);
    text = text.replace(/\.$/, "");
  }
  const [intPart, decPart] = text.split(".");
  const minInt = ((dot < 0 ? pattern : pattern.slice(0, dot)).match(/0/g) ?? []).length;
  let int = intPart!.length < minInt ? intPart!.padStart(minInt, "0") : intPart!;
  if (/^0+$/.test(int) && minInt === 0 && decPart) int = "";
  if (pattern.includes(",")) int = groupThousands(int);
  // a comma after the digits scales by a thousand each: not supported, dropped
  suffix = suffix.replace(/^,+/, "");
  const sign = x < 0 && !negative ? "-" : "";
  const body = (int === "" && !decPart ? "0" : int) + (decPart ? `.${decPart}` : "");
  return `${sign}${prefix}${body}${suffix}`;
}

// ---- Scales ------------------------------------------------------------------------------------------------------

const clean = (n: number) => Number(n.toPrecision(12));

function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/**
 * Round-number axis limits for data from `lo` to `hi`: a step of 1, 2 or 5 times a power of ten giving about `target`
 * labelled steps, with the data's end plus 5% of its range kept inside, as Excel does. A fixed `min`, `max` or `majorUnit` wins.
 */
export function niceScale(lo: number, hi: number, target: number, fixed: { min?: number; max?: number; majorUnit?: number } = {}, headroom = true): Scale {
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = lo + 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else {
      const pad = Math.abs(lo) * 0.5;
      lo -= pad;
      hi += pad;
    }
  }
  const range = hi - lo;
  const count = Math.max(2, target);
  let step = fixed.majorUnit && fixed.majorUnit > 0 ? fixed.majorUnit : niceStep(range / count);
  let min: number;
  let max: number;
  const pad = headroom ? range * 0.05 : 0;
  if (fixed.min !== undefined && fixed.max !== undefined && fixed.max > fixed.min) {
    min = fixed.min;
    max = fixed.max;
    if (!(fixed.majorUnit && fixed.majorUnit > 0)) step = niceStep((max - min) / count);
  } else {
    min = fixed.min ?? (lo >= 0 && lo === 0 ? 0 : clean(Math.floor((lo - (lo < 0 ? pad : 0)) / step + 1e-9) * step));
    max = fixed.max ?? clean(Math.ceil((hi + (hi > 0 ? pad : 0)) / step - 1e-9) * step);
    if (fixed.min !== undefined && fixed.max === undefined) max = clean(min + Math.max(1, Math.ceil((hi + pad - min) / step - 1e-9)) * step);
    if (fixed.max !== undefined && fixed.min === undefined) min = clean(max - Math.max(1, Math.ceil((max - lo + (lo < 0 ? pad : 0)) / step - 1e-9)) * step);
    if (!(max > min)) max = clean(min + step);
  }
  const ticks: number[] = [];
  const first = clean(Math.ceil(min / step - 1e-9) * step);
  for (let i = 0; ticks.length < 500; i++) {
    const t = clean(first + i * step);
    if (t > max + step * 1e-9) break;
    ticks.push(t);
  }
  return { min, max, step, ticks };
}

/** Where each series' bar or band starts and ends on each category when the series are piled up (`percent`: scaled to the category's total). */
export function stackValues(values: readonly (readonly (number | null)[])[], percent: boolean): [number, number][][] {
  const n = Math.max(0, ...values.map((v) => v.length));
  const out: [number, number][][] = values.map(() => []);
  for (let k = 0; k < n; k++) {
    let total = 0;
    if (percent) for (const v of values) total += Math.abs(v[k] ?? 0);
    let up = 0;
    let down = 0;
    values.forEach((v, i) => {
      const raw = v[k] ?? 0;
      const x = percent ? (total ? raw / total : 0) : raw;
      if (x >= 0) {
        out[i]![k] = [up, up + x];
        up += x;
      } else {
        out[i]![k] = [down, down + x];
        down += x;
      }
    });
  }
  return out;
}

// ---- Path helpers ------------------------------------------------------------------------------------------------

const P = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

/** Bézier segments of the arc of radius `r` about (cx, cy) from angle `a0` to `a1` (radians clockwise from twelve o'clock; `a1 < a0` goes back). */
function arcTo(cx: number, cy: number, r: number, a0: number, a1: number): PathCmd[] {
  const out: PathCmd[] = [];
  const total = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2) - 1e-9));
  const d = total / n;
  const k = (4 / 3) * Math.tan(d / 4);
  for (let i = 0; i < n; i++) {
    const s = a0 + i * d;
    const e = s + d;
    const [sx, sy] = P(cx, cy, r, s);
    const [ex, ey] = P(cx, cy, r, e);
    out.push(["C", sx + k * r * Math.cos(s), sy + k * r * Math.sin(s), ex - k * r * Math.cos(e), ey - k * r * Math.sin(e), ex, ey]);
  }
  return out;
}

/** A pie slice (or, with `r0 > 0`, a ring segment) from angle `a0` to `a1`. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): PathCmd[] {
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  const end = full ? a0 + Math.PI * 2 : a1;
  const s1 = P(cx, cy, r1, a0);
  if (r0 <= 0) {
    return full ? [["M", s1[0], s1[1]], ...arcTo(cx, cy, r1, a0, end), ["Z"]] : [["M", cx, cy], ["L", s1[0], s1[1]], ...arcTo(cx, cy, r1, a0, end), ["Z"]];
  }
  const e0 = P(cx, cy, r0, end);
  if (full) {
    // the inner circle runs the other way round, so a fill leaves it empty
    return [["M", s1[0], s1[1]], ...arcTo(cx, cy, r1, a0, end), ["Z"], ["M", e0[0], e0[1]], ...arcTo(cx, cy, r0, end, a0), ["Z"]];
  }
  return [["M", s1[0], s1[1]], ...arcTo(cx, cy, r1, a0, end), ["L", e0[0], e0[1]], ...arcTo(cx, cy, r0, end, a0), ["Z"]];
}

/** A circle as a closed path. */
export function circlePath(cx: number, cy: number, r: number): PathCmd[] {
  const s = P(cx, cy, r, 0);
  return [["M", s[0], s[1]], ...arcTo(cx, cy, r, 0, Math.PI * 2), ["Z"]];
}

type Pt = { x: number; y: number };

/** A curve through the points (Catmull-Rom, as Béziers), starting with its own `M`. */
export function smoothPathCmds(points: readonly Pt[]): PathCmd[] {
  if (points.length === 0) return [];
  const out: PathCmd[] = [["M", points[0]!.x, points[0]!.y]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    out.push(["C", p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y]);
  }
  return out;
}

const polyCmds = (points: readonly Pt[]): PathCmd[] => points.map((p, i): PathCmd => (i === 0 ? ["M", p.x, p.y] : ["L", p.x, p.y]));

/** An SVG path string for commands (numbers rounded to 1/100 point). */
export function pathData(cmds: readonly PathCmd[]): string {
  const f = (n: number) => String(Math.round(n * 100) / 100);
  return cmds.map((c) => (c[0] === "Z" ? "Z" : `${c[0]}${c.slice(1).map((n) => f(n as number)).join(" ")}`)).join("");
}

// ---- The scene ---------------------------------------------------------------------------------------------------

type Kind = "column" | "line" | "area";

interface Ctx {
  chart: ChartElement;
  theme: Theme;
  measure: TextMeasurer;
  font: string;
  S: number;
  textColor: ChartPaint;
  items: ChartItem[];
}

function paintOf(color: Color | undefined, theme: Theme, fallback: Color, alpha = 1): ChartPaint {
  const c = resolveColor(color ?? fallback, theme);
  return { color: toHex(c), alpha: c.a * alpha };
}

const fontOf = (family: string | undefined, theme: Theme): string => {
  if (!family || /^\+mn-/.test(family)) return theme.fonts.minor;
  if (/^\+mj-/.test(family)) return theme.fonts.major;
  return family;
};

function textWidth(ctx: Ctx, text: string, size: number, bold = false): number {
  return ctx.measure(text, { fontFamily: ctx.font, fontSize: size, bold, italic: false, letterSpacing: 0, allCaps: false, smallCaps: false });
}

function text(ctx: Ctx, part: string, s: string, x: number, y: number, o: { size?: number; anchor?: "start" | "middle" | "end"; rotate?: number; bold?: boolean; paint?: ChartPaint; series?: number; point?: number } = {}): void {
  if (s === "") return;
  const paint = o.paint ?? ctx.textColor;
  ctx.items.push({ kind: "text", part, text: s, x, y, size: o.size ?? ctx.S, color: paint.color, alpha: paint.alpha, bold: !!o.bold, anchor: o.anchor ?? "start", ...(o.rotate ? { rotate: o.rotate } : {}), ...(o.series !== undefined ? { series: o.series } : {}), ...(o.point !== undefined ? { point: o.point } : {}) });
}

const hairline = (paint: ChartPaint, width = 0.75): ChartStroke => ({ ...paint, width });

/** The kind each series is drawn as. */
function kindsOf(chart: ChartElement): Kind[] {
  const base: Kind = chart.chartType === "line" ? "line" : chart.chartType === "area" ? "area" : "column";
  return chart.series.map((s) => (s.type && chart.chartType !== "scatter" ? s.type : base));
}

/** The chart's own kind among bars, lines and areas: the one `grouping` applies to. */
const baseKindOf = (chart: ChartElement): Kind => (chart.chartType === "line" ? "line" : chart.chartType === "area" ? "area" : "column");

function seriesPaint(ctx: Ctx, i: number): ChartPaint {
  return paintOf(ctx.chart.series[i]?.color, ctx.theme, defaultSeriesColor(i));
}

interface LegendEntry {
  text: string;
  paint: ChartPaint;
  shape: "box" | "line";
}

function legendEntries(ctx: Ctx): LegendEntry[] {
  const c = ctx.chart;
  if (c.chartType === "pie" || c.chartType === "doughnut") {
    const first = c.series[0];
    const n = Math.max(c.categories.length, first?.values.length ?? 0);
    return Array.from({ length: n }, (_, k) => ({ text: c.categories[k] ?? String(k + 1), paint: paintOf(first?.pointColors?.[k], ctx.theme, defaultSeriesColor(k)), shape: "box" as const }));
  }
  const kinds = kindsOf(c);
  return c.series.map((s, i) => ({ text: s.name, paint: seriesPaint(ctx, i), shape: kinds[i] === "line" || (c.chartType === "scatter" && !s.line && false) ? ("line" as const) : ("box" as const) }));
}

export function chartScene(chart: ChartElement, width: number, height: number, theme: Theme, measure: TextMeasurer = defaultMeasure): ChartScene {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const S = Math.max(4, chart.textSize ?? 12);
  const font = fontOf(chart.fontFamily, theme);
  const ctx: Ctx = { chart, theme, measure, font, S, textColor: paintOf(chart.textColor, theme, TEXT_DEFAULT), items: [], };
  const pad = Math.max(6, S * 0.7);
  const items = ctx.items;
  const scene: ChartScene = { width: w, height: h, fontFamily: font, items, plot: { x: 0, y: 0, w, h }, legend: [] };

  if (chart.fill !== undefined && chart.fill !== null) items.push({ kind: "rect", part: "chart-area", x: 0, y: 0, w, h, fill: paintOf(chart.fill, theme, "#ffffff") });

  let top = pad;
  let bottom = h - pad;
  let left = pad;
  let right = w - pad;

  // title
  const title = chart.title ?? "";
  if (title.trim() !== "") {
    const size = chart.titleSize ?? Math.round(S * 1.2 * 10) / 10;
    const lines = title.split(/\r?\n/);
    lines.forEach((line, i) => text(ctx, "title", line, w / 2, top + size * (0.95 + i * 1.2), { size, anchor: "middle" }));
    top += size * 1.2 * lines.length + pad * 0.6;
  }

  // legend
  const pie = chart.chartType === "pie" || chart.chartType === "doughnut";
  const position = chart.legend ?? (pie || chart.series.length > 1 ? "bottom" : "none");
  const entries = position === "none" ? [] : legendEntries(ctx);
  if (entries.length > 0) {
    const sw = S * 0.75;
    const gap = S * 0.4;
    const rowH = S * 1.5;
    const itemW = (e: LegendEntry) => (e.shape === "line" ? sw * 1.8 : sw) + gap + textWidth(ctx, e.text, S);
    const drawSwatch = (e: LegendEntry, x: number, cy: number, index: number) => {
      if (e.shape === "line") items.push({ kind: "line", part: "legend-key", x1: x, y1: cy, x2: x + sw * 1.8, y2: cy, stroke: { ...e.paint, width: 2 }, series: index });
      else items.push({ kind: "rect", part: "legend-key", x, y: cy - sw / 2, w: sw, h: sw, fill: e.paint, series: index });
    };
    const keyW = (e: LegendEntry) => (e.shape === "line" ? sw * 1.8 : sw);
    scene.legend = entries.map((e) => ({ text: e.text, color: e.paint.color }));
    if (position === "top" || position === "bottom") {
      const maxW = Math.max(10, right - left);
      const spacing = S * 1.4;
      const rows: { index: number; e: LegendEntry }[][] = [[]];
      let used = 0;
      entries.forEach((e, index) => {
        const wi = itemW(e);
        const row = rows[rows.length - 1]!;
        if (row.length > 0 && used + spacing + wi > maxW) {
          rows.push([]);
          used = 0;
        }
        const r = rows[rows.length - 1]!;
        used += (r.length ? spacing : 0) + wi;
        r.push({ index, e });
      });
      const total = rows.length * rowH;
      const y0 = position === "top" ? top : bottom - total;
      rows.forEach((row, ri) => {
        const rowW = row.reduce((a, it, i) => a + itemW(it.e) + (i ? spacing : 0), 0);
        let x = (left + right) / 2 - rowW / 2;
        const cy = y0 + ri * rowH + rowH / 2;
        for (const it of row) {
          drawSwatch(it.e, x, cy, it.index);
          text(ctx, "legend-label", it.e.text, x + keyW(it.e) + gap, cy + S * 0.35, { series: it.index });
          x += itemW(it.e) + spacing;
        }
      });
      if (position === "top") top += total + pad * 0.4;
      else bottom -= total + pad * 0.4;
    } else {
      const maxW = Math.min(Math.max(...entries.map(itemW)), (right - left) * 0.4);
      const total = entries.length * rowH;
      const y0 = (top + bottom) / 2 - total / 2;
      const x0 = position === "left" ? left : right - maxW;
      entries.forEach((e, i) => {
        const cy = y0 + i * rowH + rowH / 2;
        drawSwatch(e, x0, cy, i);
        text(ctx, "legend-label", e.text, x0 + keyW(e) + gap, cy + S * 0.35, { series: i });
      });
      if (position === "left") left += maxW + pad;
      else right -= maxW + pad;
    }
  }

  const region = { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
  if (pie) drawPie(ctx, region, scene);
  else if (chart.chartType === "scatter") drawScatter(ctx, region, scene);
  else drawCartesian(ctx, region, scene);
  return scene;
}

// ---- Pie and doughnut --------------------------------------------------------------------------------------------

type Region = { x: number; y: number; w: number; h: number };

function labelParts(ctx: Ctx, o: { value?: number; percent?: number; category?: string; series?: string }, fmtFallback?: string): string {
  const dl = ctx.chart.dataLabels;
  if (!dl) return "";
  const parts: string[] = [];
  if (dl.series && o.series) parts.push(o.series);
  if (dl.category && o.category) parts.push(o.category);
  if (dl.value && o.value !== undefined) parts.push(formatNumber(o.value, dl.format ?? fmtFallback));
  if (dl.percent && o.percent !== undefined) parts.push(formatNumber(o.percent, "0%"));
  return parts.join(", ");
}

function drawPie(ctx: Ctx, region: Region, scene: ChartScene): void {
  const c = ctx.chart;
  const s = c.series[0];
  const values = (s?.values ?? []).map((v) => (v !== null && Number.isFinite(v) && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  const labels = !!c.dataLabels && (c.dataLabels.value || c.dataLabels.percent || c.dataLabels.category || c.dataLabels.series);
  const margin = labels ? ctx.S * 2.2 : ctx.S * 0.4;
  const size = Math.max(4, Math.min(region.w, region.h) - margin * 2);
  const r1 = size / 2;
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  scene.plot = { x: cx - r1, y: cy - r1, w: size, h: size };
  if (!s || total <= 0) return;
  const doughnut = c.chartType === "doughnut";
  const r0 = doughnut ? r1 * Math.min(0.9, Math.max(0.1, (c.holeSize ?? 60) / 100)) : 0;
  const start = ((c.firstSliceAngle ?? 0) * Math.PI) / 180;
  const sep = paintOf({ theme: "lt1" }, ctx.theme, "#ffffff");
  let a = start;
  values.forEach((v, k) => {
    if (v <= 0) return;
    const a1 = a + (v / total) * Math.PI * 2;
    ctx.items.push({ kind: "path", part: "slice", series: 0, point: k, d: sectorPath(cx, cy, r0, r1, a, Math.min(a1, a + Math.PI * 2)), fill: paintOf(s.pointColors?.[k], ctx.theme, defaultSeriesColor(k)), stroke: { ...sep, width: Math.max(0.75, ctx.S * 0.08) } });
    a = a1;
  });
  if (labels) {
    a = start;
    values.forEach((v, k) => {
      if (v <= 0) return;
      const span = (v / total) * Math.PI * 2;
      const mid = a + span / 2;
      a += span;
      const label = labelParts(ctx, { value: v, percent: v / total, category: c.categories[k] ?? String(k + 1), series: s.name });
      if (!label) return;
      const inside = span > 0.45;
      const rr = inside ? (doughnut ? (r0 + r1) / 2 : r1 * 0.68) : r1 + ctx.S * 0.9;
      const [x, y] = P(cx, cy, rr, mid);
      const fill = paintOf(s.pointColors?.[k], ctx.theme, defaultSeriesColor(k));
      const light = luminance(fill.color) > 0.45;
      const paint = inside ? { color: light ? "#262626" : "#ffffff", alpha: 1 } : ctx.textColor;
      text(ctx, "data-label", label, x, y + ctx.S * 0.35, { anchor: "middle", paint, series: 0, point: k });
    });
  }
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// ---- Axes helpers ------------------------------------------------------------------------------------------------

const axisOf = (chart: ChartElement, which: "category" | "value"): ChartAxis => (which === "category" ? chart.categoryAxis : chart.valueAxis) ?? {};

function axisLine(ctx: Ctx, a: ChartAxis, x1: number, y1: number, x2: number, y2: number): void {
  if (a.hidden || a.line === null) return;
  const paint = a.line !== undefined ? paintOf(a.line, ctx.theme, TEXT_DEFAULT) : { ...ctx.textColor, alpha: ctx.textColor.alpha * 0.4 };
  ctx.items.push({ kind: "line", part: "axis", x1, y1, x2, y2, stroke: hairline(paint) });
}

function gridPaint(ctx: Ctx, a?: ChartAxis): ChartPaint {
  return a?.gridColor !== undefined ? paintOf(a.gridColor, ctx.theme, TEXT_DEFAULT) : { ...ctx.textColor, alpha: ctx.textColor.alpha * 0.14 };
}

// ---- Cartesian charts (columns, bars, lines, areas) --------------------------------------------------------------

function drawCartesian(ctx: Ctx, region: Region, scene: ChartScene): void {
  const c = ctx.chart;
  const { S, items } = ctx;
  const horizontal = c.chartType === "bar";
  const kinds = kindsOf(c);
  const baseKind = baseKindOf(c);
  const grouping = c.grouping ?? "clustered";
  const stacked = grouping !== "clustered";
  const percent = grouping === "percentStacked";
  const nCat = Math.max(c.categories.length, ...c.series.map((s) => s.values.length), 0);
  const vAxis = axisOf(c, "value");
  const cAxis = axisOf(c, "category");

  // series piled up: the ones of the chart's own kind
  const stackIdx = stacked ? c.series.map((_, i) => i).filter((i) => kinds[i] === baseKind) : [];
  const stackRanges = new Map<number, [number, number][]>();
  if (stackIdx.length) stackValues(stackIdx.map((i) => c.series[i]!.values), percent).forEach((r, k) => stackRanges.set(stackIdx[k]!, r));
  const range = (i: number, k: number): [number, number] | undefined => {
    const st = stackRanges.get(i);
    if (st) return st[k];
    const v = c.series[i]!.values[k];
    return v === null || v === undefined || !Number.isFinite(v) ? undefined : [0, v];
  };

  // the data's extent
  let lo = Infinity;
  let hi = -Infinity;
  let anyBase = false;
  c.series.forEach((s, i) => {
    for (let k = 0; k < nCat; k++) {
      const r = range(i, k);
      if (!r) continue;
      lo = Math.min(lo, r[1], stackRanges.has(i) ? r[0] : r[1]);
      hi = Math.max(hi, r[1], stackRanges.has(i) ? r[0] : r[1]);
    }
    if (kinds[i] !== "line" || stackRanges.has(i)) anyBase = true;
  });
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (anyBase) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  } else if (lo > 0 && (hi - lo) / hi > 1 / 6) lo = 0;
  const dataLo = lo;
  const dataHi = hi;

  const valFormat = vAxis.format ?? (percent ? "0%" : undefined);
  const catLabels = Array.from({ length: nCat }, (_, k) => c.categories[k] ?? String(k + 1));
  const hasTitleV = !!vAxis.title;
  const hasTitleC = !!cAxis.title;
  const labelPad = S * 0.5;

  // Two passes: the plot's size depends on the labels, the labels' count on the plot's size.
  let plot: Region = { ...region };
  let scale: Scale = niceScale(dataLo, dataHi, 5, percent ? { min: 0, max: 1, ...pick(vAxis, ["majorUnit"]) } : pick(vAxis, ["min", "max", "majorUnit"]), !percent);
  let rotate = false;
  let stride = 1;
  let catText = catLabels;
  const midCatAxis = c.chartType === "area" && kinds.every((k) => k === "area") && nCat > 1;
  for (let pass = 0; pass < 2; pass++) {
    const valLen = horizontal ? plot.w : plot.h;
    const target = Math.max(3, Math.min(10, Math.floor(valLen / (horizontal ? S * 5.5 : S * 3.2))));
    scale = niceScale(dataLo, dataHi, target, percent ? { min: 0, max: 1, ...pick(vAxis, ["majorUnit"]) } : pick(vAxis, ["min", "max", "majorUnit"]), !percent);
    const tickText = scale.ticks.map((t) => formatNumber(t, valFormat));
    const tickW = Math.max(0, ...tickText.map((t) => textWidth(ctx, t, S)));
    const catLen = horizontal ? plot.h : plot.w;
    const band = catLen / Math.max(1, nCat);
    const catW = catLabels.map((t) => textWidth(ctx, t, S));
    const maxCatW = Math.max(0, ...catW);
    let leftM = 0;
    let bottomM = 0;
    let rightM = 0;
    let topM = S * 0.5;
    if (horizontal) {
      // value axis along the bottom, categories down the left
      stride = Math.max(1, Math.ceil((S * 1.3) / band));
      rotate = false;
      if (!cAxis.hidden) leftM += maxCatW + labelPad * 1.5;
      if (!vAxis.hidden) bottomM += S * 1.2 + labelPad;
      rightM = tickW / 2 + 2;
    } else {
      if (!vAxis.hidden) leftM += tickW + labelPad * 1.5;
      if (!cAxis.hidden) {
        rotate = maxCatW > band * 0.94 && nCat > 1;
        if (rotate) {
          // long names are cut with an ellipsis so that they stay inside the chart
          const room = Math.max(S * 3, region.h * 0.4);
          const limit = Math.max(S * 3, (room - S) / Math.SQRT1_2);
          catText = catLabels.map((t) => {
            if (textWidth(ctx, t, S) <= limit) return t;
            let cut = t;
            while (cut.length > 1 && textWidth(ctx, cut + "…", S) > limit) cut = cut.slice(0, -1);
            return cut + "…";
          });
          const shownW = Math.max(0, ...catText.map((t) => textWidth(ctx, t, S)));
          bottomM += Math.sin(Math.PI / 4) * shownW + S + labelPad;
          leftM = Math.max(leftM, shownW * Math.SQRT1_2 - band / 2 + S * 0.3);
          stride = Math.max(1, Math.ceil((S * 1.4) / (band * Math.SQRT1_2)));
        } else {
          catText = catLabels;
          bottomM += S * 1.2 + labelPad;
          stride = 1;
        }
        if (midCatAxis && !rotate) {
          leftM = Math.max(leftM, maxCatW / 2 + 2);
          rightM = Math.max(rightM, maxCatW / 2 + 2);
        }
      }
      topM = S * 0.5;
    }
    if (hasTitleV) (horizontal ? (bottomM += S * 1.5) : (leftM += S * 1.5));
    if (hasTitleC) (horizontal ? (leftM += S * 1.5) : (bottomM += S * 1.5));
    plot = { x: region.x + leftM, y: region.y + topM, w: Math.max(10, region.w - leftM - rightM), h: Math.max(10, region.h - topM - bottomM) };
  }
  scene.plot = plot;

  // positions
  const nBand = Math.max(1, nCat);
  const midCat = c.chartType === "area" && kinds.every((k) => k === "area");
  const vFrac = (v: number) => (v - scale.min) / (scale.max - scale.min);
  /** A position along the value axis. */
  const vp = (v: number) => (horizontal ? plot.x + vFrac(v) * plot.w : plot.y + plot.h - vFrac(v) * plot.h);
  /** A position along the category axis for a category coordinate t (0 at the first edge, `nCat` at the last, categories centred at k + 0.5). */
  const cStep = midCat && nCat > 1 ? (horizontal ? plot.h : plot.w) / (nCat - 1) : (horizontal ? plot.h : plot.w) / nBand;
  const cp = (t: number) => {
    const along = midCat ? (t - 0.0) * cStep : t * cStep;
    return horizontal ? plot.y + plot.h - along : plot.x + along;
  };
  const centre = (k: number) => (midCat ? k : k + 0.5);
  const pt = (t: number, v: number): Pt => (horizontal ? { x: vp(v), y: cp(t) } : { x: cp(t), y: vp(v) });
  const baseV = Math.min(scale.max, Math.max(scale.min, 0));

  // plot background and gridlines
  if (c.plotFill !== undefined && c.plotFill !== null) items.push({ kind: "rect", part: "plot-area", x: plot.x, y: plot.y, w: plot.w, h: plot.h, fill: paintOf(c.plotFill, ctx.theme, "#ffffff") });
  const grid = gridPaint(ctx, vAxis);
  const cgrid = gridPaint(ctx, cAxis);
  if (vAxis.gridlines ?? true) {
    for (const t of scale.ticks) {
      const p = vp(t);
      items.push(horizontal ? { kind: "line", part: "gridline", x1: p, y1: plot.y, x2: p, y2: plot.y + plot.h, stroke: hairline(grid) } : { kind: "line", part: "gridline", x1: plot.x, y1: p, x2: plot.x + plot.w, y2: p, stroke: hairline(grid) });
    }
  }
  if (cAxis.gridlines) {
    for (let k = 0; k <= nCat; k++) {
      const p = cp(k);
      items.push(horizontal ? { kind: "line", part: "gridline", x1: plot.x, y1: p, x2: plot.x + plot.w, y2: p, stroke: hairline(cgrid) } : { kind: "line", part: "gridline", x1: p, y1: plot.y, x2: p, y2: plot.y + plot.h, stroke: hairline(cgrid) });
    }
  }

  // areas, then bars, then lines
  const order: Kind[] = ["area", "column", "line"];
  const barSeries = c.series.map((_, i) => i).filter((i) => kinds[i] === "column");
  const dlabels: (() => void)[] = [];
  for (const kind of order) {
    c.series.forEach((s, i) => {
      if (kinds[i] !== kind) return;
      const paint = seriesPaint(ctx, i);
      if (kind === "area") {
        const segs = areaPoints(i);
        for (const seg of segs) {
          const top = seg.map((p) => pt(centre(p.k), p.hi));
          const bot = [...seg].reverse().map((p) => pt(centre(p.k), p.lo));
          const d: PathCmd[] = [...polyCmds(top), ...bot.map((p): PathCmd => ["L", p.x, p.y]), ["Z"]];
          items.push({ kind: "path", part: "area", series: i, d, fill: { ...paint, alpha: stacked ? paint.alpha : paint.alpha * 0.85 } });
          items.push({ kind: "path", part: "area-line", series: i, d: polyCmds(top), stroke: { ...paint, width: 1.5, join: "round" } });
        }
      } else if (kind === "column") {
        const n = stacked ? 1 : Math.max(1, barSeries.length);
        const idx = stacked ? 0 : barSeries.indexOf(i);
        const overlap = Math.max(-1, Math.min(1, (c.overlap ?? (stacked ? 100 : 0)) / 100));
        const gap = Math.max(0, Math.min(5, (c.gapWidth ?? 150) / 100));
        const bw = 1 / (n - (n - 1) * overlap + gap);
        const groupW = bw * (n - (n - 1) * overlap);
        for (let k = 0; k < nCat; k++) {
          const r = range(i, k);
          if (!r) continue;
          const t0 = k + (1 - groupW) / 2 + idx * bw * (1 - overlap);
          const [a, b] = stackRanges.has(i) ? r : [baseV, r[1]];
          const va = vp(Math.min(Math.max(a, scale.min), scale.max));
          const vb = vp(Math.min(Math.max(b, scale.min), scale.max));
          const ca = cp(t0);
          const cb = cp(t0 + bw);
          const rect = horizontal ? { x: Math.min(va, vb), y: Math.min(ca, cb), w: Math.abs(vb - va), h: Math.abs(cb - ca) } : { x: Math.min(ca, cb), y: Math.min(va, vb), w: Math.abs(cb - ca), h: Math.abs(vb - va) };
          items.push({ kind: "rect", part: "bar", series: i, point: k, ...rect, fill: paint });
          if (c.dataLabels) {
            const v = c.series[i]!.values[k]!;
            const label = labelParts(ctx, { value: v, category: catLabels[k], series: s.name, percent: percent ? r[1] - r[0] : undefined }, valFormat);
            if (label) {
              const pos = c.dataLabels.position ?? (stacked ? "center" : "outside");
              dlabels.push(() => barLabel(label, rect, v >= 0, pos, i, k, paint));
            }
          }
        }
      } else {
        const segs = linePoints(i);
        const smooth = s.smooth ?? c.smooth ?? false;
        const width = s.lineWidth ?? 2.25;
        for (const seg of segs) {
          const pts = seg.map((p) => pt(centre(p.k), p.hi));
          if (pts.length > 1) items.push({ kind: "path", part: "line", series: i, d: smooth ? smoothPathCmds(pts) : polyCmds(pts), stroke: { ...paint, width, cap: "round", join: "round" } });
        }
        const marker = s.marker ?? c.markers ?? false;
        for (const seg of segs)
          for (const p of seg) {
            const q = pt(centre(p.k), p.hi);
            if (marker) items.push({ kind: "path", part: "marker", series: i, point: p.k, d: circlePath(q.x, q.y, Math.max(2.2, S * 0.28)), fill: paint, stroke: { color: "#ffffff", alpha: 1, width: 0.75 } });
            if (c.dataLabels) {
              const label = labelParts(ctx, { value: c.series[i]!.values[p.k]!, category: catLabels[p.k], series: s.name }, valFormat);
              if (label) dlabels.push(() => text(ctx, "data-label", label, q.x, q.y - S * (marker ? 0.9 : 0.7), { anchor: "middle", series: i, point: p.k }));
            }
          }
      }
    });
  }

  function areaPoints(i: number): { k: number; lo: number; hi: number }[][] {
    const out: { k: number; lo: number; hi: number }[][] = [[]];
    for (let k = 0; k < nCat; k++) {
      const r = range(i, k);
      if (!r) {
        if (out[out.length - 1]!.length) out.push([]);
        continue;
      }
      out[out.length - 1]!.push({ k, lo: stackRanges.has(i) ? r[0] : baseV, hi: r[1] });
    }
    return out.filter((s) => s.length > 0);
  }
  function linePoints(i: number): { k: number; lo: number; hi: number }[][] {
    return areaPoints(i);
  }
  function barLabel(label: string, r: Region, positive: boolean, pos: "outside" | "inside" | "center", i: number, k: number, fill: ChartPaint): void {
    const light = luminance(fill.color) > 0.45;
    const inner: ChartPaint = { color: light ? "#262626" : "#ffffff", alpha: 1 };
    const place = pos === "outside" && stacked ? "center" : pos;
    if (horizontal) {
      const cy = r.y + r.h / 2 + S * 0.35;
      if (place === "center") text(ctx, "data-label", label, r.x + r.w / 2, cy, { anchor: "middle", paint: inner, series: i, point: k });
      else if (place === "inside") text(ctx, "data-label", label, positive ? r.x + r.w - 4 : r.x + 4, cy, { anchor: positive ? "end" : "start", paint: inner, series: i, point: k });
      else text(ctx, "data-label", label, positive ? r.x + r.w + 4 : r.x - 4, cy, { anchor: positive ? "start" : "end", series: i, point: k });
    } else {
      const cx = r.x + r.w / 2;
      if (place === "center") text(ctx, "data-label", label, cx, r.y + r.h / 2 + S * 0.35, { anchor: "middle", paint: inner, series: i, point: k });
      else if (place === "inside") text(ctx, "data-label", label, cx, positive ? r.y + S * 1.1 : r.y + r.h - 4, { anchor: "middle", paint: inner, series: i, point: k });
      else text(ctx, "data-label", label, cx, positive ? r.y - 4 : r.y + r.h + S * 1.0, { anchor: "middle", series: i, point: k });
    }
  }

  // axes
  const crossC = horizontal ? plot.x + vFrac(baseV) * plot.w : plot.y + plot.h - vFrac(baseV) * plot.h;
  if (horizontal) {
    axisLine(ctx, cAxis, crossC, plot.y, crossC, plot.y + plot.h);
    axisLine(ctx, vAxis, plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h);
  } else {
    axisLine(ctx, cAxis, plot.x, crossC, plot.x + plot.w, crossC);
    axisLine(ctx, vAxis, plot.x, plot.y, plot.x, plot.y + plot.h);
  }
  if (!vAxis.hidden)
    for (const t of scale.ticks) {
      const label = formatNumber(t, valFormat);
      if (horizontal) text(ctx, "tick-label", label, vp(t), plot.y + plot.h + S * 1.2, { anchor: "middle" });
      else text(ctx, "tick-label", label, plot.x - S * 0.5, vp(t) + S * 0.35, { anchor: "end" });
    }
  if (!cAxis.hidden)
    catText.forEach((label, k) => {
      if (k % stride !== 0) return;
      const t = centre(k);
      if (horizontal) text(ctx, "category-label", label, plot.x - S * 0.5, cp(t) + S * 0.35, { anchor: "end", point: k });
      else if (rotate) text(ctx, "category-label", label, cp(t) + S * 0.3, plot.y + plot.h + S * 1.0, { anchor: "end", rotate: -45, point: k });
      else text(ctx, "category-label", label, cp(t), plot.y + plot.h + S * 1.2, { anchor: "middle", point: k });
    });
  if (vAxis.title) {
    if (horizontal) text(ctx, "axis-title", vAxis.title, plot.x + plot.w / 2, region.y + region.h - S * 0.3, { anchor: "middle", bold: false });
    else text(ctx, "axis-title", vAxis.title, region.x + S * 0.9, plot.y + plot.h / 2, { anchor: "middle", rotate: -90 });
  }
  if (cAxis.title) {
    if (horizontal) text(ctx, "axis-title", cAxis.title, region.x + S * 0.9, plot.y + plot.h / 2, { anchor: "middle", rotate: -90 });
    else text(ctx, "axis-title", cAxis.title, plot.x + plot.w / 2, region.y + region.h - S * 0.3, { anchor: "middle" });
  }
  for (const f of dlabels) f();
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

// ---- Scatter -----------------------------------------------------------------------------------------------------

function drawScatter(ctx: Ctx, region: Region, scene: ChartScene): void {
  const c = ctx.chart;
  const { S, items } = ctx;
  const xAxis = axisOf(c, "category");
  const yAxis = axisOf(c, "value");
  const xs = (s: ChartSeries, k: number) => s.x?.[k] ?? k + 1;
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (const s of c.series)
    s.values.forEach((v, k) => {
      const x = xs(s, k);
      if (v === null || !Number.isFinite(v) || !Number.isFinite(x)) return;
      xlo = Math.min(xlo, x);
      xhi = Math.max(xhi, x);
      ylo = Math.min(ylo, v);
      yhi = Math.max(yhi, v);
    });
  if (!Number.isFinite(xlo)) [xlo, xhi, ylo, yhi] = [0, 1, 0, 1];
  if (ylo > 0 && (yhi - ylo) / yhi > 1 / 6) ylo = 0;
  if (xlo > 0 && (xhi - xlo) / xhi > 1 / 6) xlo = 0;
  let plot: Region = { ...region };
  let sx = niceScale(xlo, xhi, 5, pick(xAxis, ["min", "max", "majorUnit"]));
  let sy = niceScale(ylo, yhi, 5, pick(yAxis, ["min", "max", "majorUnit"]));
  for (let pass = 0; pass < 2; pass++) {
    sy = niceScale(ylo, yhi, Math.max(3, Math.min(10, Math.floor(plot.h / (S * 3.2)))), pick(yAxis, ["min", "max", "majorUnit"]));
    sx = niceScale(xlo, xhi, Math.max(3, Math.min(10, Math.floor(plot.w / (S * 5)))), pick(xAxis, ["min", "max", "majorUnit"]));
    const tickW = Math.max(0, ...sy.ticks.map((t) => textWidth(ctx, formatNumber(t, yAxis.format), S)));
    let leftM = yAxis.hidden ? 0 : tickW + S * 0.75;
    let bottomM = xAxis.hidden ? 0 : S * 1.2 + S * 0.5;
    if (yAxis.title) leftM += S * 1.5;
    if (xAxis.title) bottomM += S * 1.5;
    const rightM = Math.max(S * 0.5, textWidth(ctx, formatNumber(sx.max, xAxis.format), S) / 2);
    plot = { x: region.x + leftM, y: region.y + S * 0.5, w: Math.max(10, region.w - leftM - rightM), h: Math.max(10, region.h - S * 0.5 - bottomM) };
  }
  scene.plot = plot;
  const px = (v: number) => plot.x + ((v - sx.min) / (sx.max - sx.min)) * plot.w;
  const py = (v: number) => plot.y + plot.h - ((v - sy.min) / (sy.max - sy.min)) * plot.h;
  if (c.plotFill !== undefined && c.plotFill !== null) items.push({ kind: "rect", part: "plot-area", x: plot.x, y: plot.y, w: plot.w, h: plot.h, fill: paintOf(c.plotFill, ctx.theme, "#ffffff") });
  if (yAxis.gridlines ?? true) for (const t of sy.ticks) items.push({ kind: "line", part: "gridline", x1: plot.x, y1: py(t), x2: plot.x + plot.w, y2: py(t), stroke: hairline(gridPaint(ctx, yAxis)) });
  if (xAxis.gridlines) for (const t of sx.ticks) items.push({ kind: "line", part: "gridline", x1: px(t), y1: plot.y, x2: px(t), y2: plot.y + plot.h, stroke: hairline(gridPaint(ctx, xAxis)) });
  const yAtX = py(Math.min(sy.max, Math.max(sy.min, 0)));
  const xAtY = px(Math.min(sx.max, Math.max(sx.min, 0)));
  axisLine(ctx, xAxis, plot.x, yAtX, plot.x + plot.w, yAtX);
  axisLine(ctx, yAxis, xAtY, plot.y, xAtY, plot.y + plot.h);
  c.series.forEach((s, i) => {
    const paint = seriesPaint(ctx, i);
    const pts: { p: Pt; k: number }[] = [];
    s.values.forEach((v, k) => {
      const x = xs(s, k);
      if (v === null || !Number.isFinite(v) || !Number.isFinite(x)) return;
      pts.push({ p: { x: px(x), y: py(v) }, k });
    });
    if (s.line && pts.length > 1) items.push({ kind: "path", part: "line", series: i, d: (s.smooth ?? c.smooth) ? smoothPathCmds(pts.map((q) => q.p)) : polyCmds(pts.map((q) => q.p)), stroke: { ...paint, width: s.lineWidth ?? 2.25, cap: "round", join: "round" } });
    if (s.marker ?? c.markers ?? true)
      for (const { p, k } of pts) items.push({ kind: "path", part: "marker", series: i, point: k, d: circlePath(p.x, p.y, Math.max(2.5, S * 0.32)), fill: paint, stroke: { color: "#ffffff", alpha: 1, width: 0.5 } });
    if (c.dataLabels)
      for (const { p, k } of pts) {
        const label = labelParts(ctx, { value: s.values[k]!, series: s.name, category: formatNumber(xs(s, k), xAxis.format) }, yAxis.format);
        if (label) text(ctx, "data-label", label, p.x, p.y - S * 0.8, { anchor: "middle", series: i, point: k });
      }
  });
  if (!yAxis.hidden) for (const t of sy.ticks) text(ctx, "tick-label", formatNumber(t, yAxis.format), plot.x - S * 0.5, py(t) + S * 0.35, { anchor: "end" });
  if (!xAxis.hidden) for (const t of sx.ticks) text(ctx, "tick-label", formatNumber(t, xAxis.format), px(t), plot.y + plot.h + S * 1.2, { anchor: "middle" });
  if (yAxis.title) text(ctx, "axis-title", yAxis.title, region.x + S * 0.9, plot.y + plot.h / 2, { anchor: "middle", rotate: -90 });
  if (xAxis.title) text(ctx, "axis-title", xAxis.title, plot.x + plot.w / 2, region.y + region.h - S * 0.3, { anchor: "middle" });
}
