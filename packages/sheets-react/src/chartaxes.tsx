import type { CSSProperties, ReactNode } from "react";
import { axisDefaults, type AxisKey, type Chart, type ChartFont, type ChartTickMark } from "@pli.dev/sheets";
import { fracOf, type Ticks } from "./chartmath";

/*
 * The drawing of axes for the cartesian chart kinds: gridlines (major and minor), the axis line, tick marks, and labels at
 * the place the axis settings ask for. A value axis is placed with `fracOf` so that log scales and reversed axes work the
 * same as plain ones. Everything here is positions and SVG; what the numbers are comes from `scaleTicks`.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The inline style a font asks for: points become pixels. */
export function fontStyle(f: { family?: string | undefined; size?: number | undefined; bold?: boolean | undefined; italic?: boolean | undefined; color?: string | undefined } | undefined): CSSProperties {
  if (!f) return {};
  return {
    ...(f.family ? { fontFamily: f.family } : {}),
    ...(f.size ? { fontSize: Math.round((f.size * 4) / 3) } : {}),
    ...(f.bold !== undefined ? { fontWeight: f.bold ? 700 : 400 } : {}),
    ...(f.italic ? { fontStyle: "italic" } : {}),
    ...(f.color ? { fill: f.color } : {}),
  };
}

const CHAR = 6.2;
const clipText = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

/** What an axis looks like once the chart's settings and Excel's defaults are put together. */
export interface AxisLook {
  gridMajor: boolean;
  gridMinor: boolean;
  tickMajor: ChartTickMark;
  tickMinor: ChartTickMark;
  labels: "nextTo" | "low" | "high" | "none";
  hidden: boolean;
}

export function axisLook(chart: Pick<Chart, "type" | "axes">, key: AxisKey): AxisLook {
  const a = chart.axes?.[key];
  const d = axisDefaults(chart.type, key);
  return {
    gridMajor: a?.majorGridlines ?? d.majorGridlines,
    gridMinor: a?.minorGridlines ?? d.minorGridlines,
    tickMajor: a?.majorTick ?? d.majorTick,
    tickMinor: a?.minorTick ?? d.minorTick,
    labels: a?.labels ?? d.labels,
    hidden: a?.hidden ?? d.hidden,
  };
}

const MAJOR_LEN = 5;
const MINOR_LEN = 3;

/** A tick mark across a line: `out` points away from the plot (towards `outward`), `in` into it, `cross` both. */
function mark(vertical: boolean, at: number, line: number, kind: ChartTickMark, len: number, outward: 1 | -1): { x1: number; y1: number; x2: number; y2: number } | null {
  if (kind === "none") return null;
  const a = kind === "in" ? -len * outward : kind === "cross" ? -len * outward : 0;
  const b = kind === "in" ? 0 : len * outward;
  return vertical ? { x1: line + a, x2: line + b, y1: at, y2: at } : { x1: at, x2: at, y1: line + a, y2: line + b };
}

export interface ValueAxisOptions {
  key: string;
  plot: Rect;
  ticks: Ticks;
  fmt: (v: number) => string;
  /** The axis runs up and down (a column chart's value axis) rather than across. */
  vertical: boolean;
  look: AxisLook;
  /** Which edge of the plot the axis belongs to: left or bottom (`start`), right or top (`end`). */
  side: "start" | "end";
  /** Where the axis line stands across the plot, in pixels, if not at its edge. */
  at?: number;
  /** Draw the major gridlines (they are drawn for the first axis only unless the settings ask). */
  grid?: boolean;
  /** The font of the labels. */
  font?: ChartFont | undefined;
}

/** Gridlines, the axis line, tick marks and labels of a value axis. */
export function drawValueAxis(o: ValueAxisOptions): ReactNode[] {
  const { plot, ticks, look, vertical, side, key } = o;
  const out: ReactNode[] = [];
  const pos = (v: number) => {
    const f = fracOf(ticks, v);
    return vertical ? plot.y + plot.h - f * plot.h : plot.x + f * plot.w;
  };
  const edge = vertical ? (side === "start" ? plot.x : plot.x + plot.w) : side === "start" ? plot.y + plot.h : plot.y;
  const line = o.at ?? edge;
  const outward: 1 | -1 = vertical ? (side === "start" ? -1 : 1) : side === "start" ? 1 : -1;
  const draw = (v: number, minor: boolean) => {
    const p = pos(v);
    if (!Number.isFinite(p)) return;
    const gridOn = minor ? look.gridMinor : (o.grid ?? look.gridMajor);
    if (gridOn) {
      out.push(vertical ? <line key={`${key}${minor ? "n" : "g"}${v}`} x1={plot.x} x2={plot.x + plot.w} y1={p} y2={p} className={minor ? "pli-chart-grid pli-chart-grid-minor" : "pli-chart-grid"} /> : <line key={`${key}${minor ? "n" : "g"}${v}`} x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} className={minor ? "pli-chart-grid pli-chart-grid-minor" : "pli-chart-grid"} />);
    }
    if (look.hidden) return;
    const m = mark(vertical, p, line, minor ? look.tickMinor : look.tickMajor, minor ? MINOR_LEN : MAJOR_LEN, outward);
    if (m) out.push(<line key={`${key}${minor ? "m" : "k"}${v}`} {...m} className="pli-chart-tick" />);
  };
  for (const v of ticks.minor ?? []) draw(v, true);
  for (const v of ticks.ticks) draw(v, false);
  if (look.hidden) return out;
  if (look.tickMajor !== "none" || look.tickMinor !== "none") {
    out.push(vertical ? <line key={`${key}axis`} x1={line} x2={line} y1={plot.y} y2={plot.y + plot.h} className="pli-chart-axis" /> : <line key={`${key}axis`} x1={plot.x} x2={plot.x + plot.w} y1={line} y2={line} className="pli-chart-axis" />);
  }
  if (look.labels === "none") return out;
  // Labels: beside the axis line, or at the low (left, bottom) or high (right, top) end of the plot.
  const labelEdge = look.labels === "nextTo" ? line : look.labels === "low" ? (vertical ? plot.x : plot.y + plot.h) : vertical ? plot.x + plot.w : plot.y;
  const labelOutward: 1 | -1 = look.labels === "nextTo" ? outward : look.labels === "low" ? (vertical ? -1 : 1) : vertical ? 1 : -1;
  for (const t of ticks.ticks) {
    const p = pos(t);
    if (!Number.isFinite(p)) continue;
    out.push(
      vertical ? (
        <text key={`${key}t${t}`} x={labelEdge + 6 * labelOutward} y={p + 4} textAnchor={labelOutward < 0 ? "end" : "start"} className="pli-chart-label" style={fontStyle(o.font)}>
          {o.fmt(t)}
        </text>
      ) : (
        <text key={`${key}t${t}`} x={p} y={labelOutward > 0 ? labelEdge + 15 : labelEdge - 6} textAnchor="middle" className="pli-chart-label" style={fontStyle(o.font)}>
          {o.fmt(t)}
        </text>
      ),
    );
  }
  return out;
}

export interface CategoryAxisOptions {
  key: string;
  plot: Rect;
  labels: readonly string[];
  /** How many bands the axis has (the labels may be fewer, for the room left by a forecast). */
  count: number;
  band: number;
  /** The bands run across (a column chart's categories) rather than down. */
  horizontal: boolean;
  look: AxisLook;
  side: "start" | "end";
  at?: number;
  labelEvery?: number | undefined;
  tickEvery?: number | undefined;
  /** Longest label, in characters, for bands running down. */
  maxChars?: number;
  grid?: boolean;
  /** The font of the labels. */
  font?: ChartFont | undefined;
}

/** The axis line, tick marks between the bands, gridlines and labels of a category axis. */
export function drawCategoryAxis(o: CategoryAxisOptions): ReactNode[] {
  const { plot, look, horizontal, side, key, band } = o;
  const out: ReactNode[] = [];
  const edge = horizontal ? (side === "start" ? plot.y + plot.h : plot.y) : side === "start" ? plot.x : plot.x + plot.w;
  const line = o.at ?? edge;
  const outward: 1 | -1 = horizontal ? (side === "start" ? 1 : -1) : side === "start" ? -1 : 1;
  const along = (k: number) => (horizontal ? plot.x : plot.y) + band * k;
  const tickEvery = o.tickEvery ?? 1;
  for (let k = 0; k <= o.count; k += tickEvery) {
    const p = along(k);
    if (o.grid ?? look.gridMajor) out.push(horizontal ? <line key={`${key}g${k}`} x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} className="pli-chart-grid" /> : <line key={`${key}g${k}`} y1={p} y2={p} x1={plot.x} x2={plot.x + plot.w} className="pli-chart-grid" />);
    if (!look.hidden) {
      const m = mark(!horizontal, p, line, look.tickMajor, MAJOR_LEN, outward);
      if (m) out.push(<line key={`${key}k${k}`} {...m} className="pli-chart-tick" />);
    }
  }
  for (let k = 0; k < o.count; k++) {
    const p = along(k + 0.5);
    if (look.gridMinor) out.push(horizontal ? <line key={`${key}n${k}`} x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} className="pli-chart-grid pli-chart-grid-minor" /> : <line key={`${key}n${k}`} y1={p} y2={p} x1={plot.x} x2={plot.x + plot.w} className="pli-chart-grid pli-chart-grid-minor" />);
    if (!look.hidden) {
      const m = mark(!horizontal, p, line, look.tickMinor, MINOR_LEN, outward);
      if (m) out.push(<line key={`${key}m${k}`} {...m} className="pli-chart-tick" />);
    }
  }
  if (look.hidden) return out;
  out.push(horizontal ? <line key={`${key}axis`} x1={plot.x} x2={plot.x + plot.w} y1={line} y2={line} className="pli-chart-axis" /> : <line key={`${key}axis`} x1={line} x2={line} y1={plot.y} y2={plot.y + plot.h} className="pli-chart-axis" />);
  if (look.labels === "none") return out;
  const labelEdge = look.labels === "nextTo" ? line : look.labels === "low" ? (horizontal ? plot.y + plot.h : plot.x) : horizontal ? plot.y : plot.x + plot.w;
  const labelOutward: 1 | -1 = look.labels === "nextTo" ? outward : look.labels === "low" ? (horizontal ? 1 : -1) : horizontal ? -1 : 1;
  if (horizontal) {
    const longest = Math.min(12, Math.max(0, ...o.labels.map((c) => c.length)));
    const every = o.labelEvery ?? Math.max(1, Math.ceil((longest * CHAR + 6) / Math.max(band, 1)));
    o.labels.forEach((c, k) => {
      if (k % every || c === "") return;
      out.push(
        <text key={`${key}c${k}`} x={plot.x + band * (k + 0.5)} y={labelOutward > 0 ? labelEdge + 15 : labelEdge - 6} textAnchor="middle" className="pli-chart-label" style={fontStyle(o.font)}>
          {clipText(c, Math.max(3, Math.floor((band * every) / CHAR)))}
        </text>,
      );
    });
  } else {
    const every = o.labelEvery ?? Math.max(1, Math.ceil(16 / band));
    o.labels.forEach((c, k) => {
      if (k % every) return;
      out.push(
        <text key={`${key}c${k}`} x={labelEdge + 6 * labelOutward} y={plot.y + band * (k + 0.5) + 4} textAnchor={labelOutward < 0 ? "end" : "start"} className="pli-chart-label" style={fontStyle(o.font)}>
          {clipText(c, o.maxChars ?? 14)}
        </text>,
      );
    });
  }
  return out;
}
