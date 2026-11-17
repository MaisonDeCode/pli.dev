import type { ChartAxis, ChartSeries } from "@pli.dev/sheets";

export interface Ticks {
  min: number;
  max: number;
  step: number;
  ticks: number[];
  /** The small ticks between the labelled ones (when the axis has minor ticks or gridlines). */
  minor?: number[];
  /** A logarithmic scale with this base. */
  log?: number;
  /** The axis runs from the high end to the low end. */
  reverse?: boolean;
}

/** A step of 1, 2 or 5 times a power of ten that is at least as big as `raw`. */
function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

const clean = (n: number) => Number(n.toPrecision(12));

/** Round numbers that cover `min` to `max` in about `count` steps, as an axis would be labelled. */
export function niceTicks(min: number, max: number, count = 5): Ticks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    if (min === 0) return niceTicks(0, 1, count);
    const pad = Math.abs(min) * 0.1;
    return niceTicks(min - pad, max + pad, count);
  }
  const step = niceStep((max - min) / count);
  const lo = clean(Math.floor(min / step + 1e-9) * step);
  const hi = clean(Math.ceil(max / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let i = 0; lo + i * step <= hi + step * 1e-9; i++) ticks.push(clean(lo + i * step));
  return { min: lo, max: hi, step, ticks };
}

/** A number as an axis label: `1,200`, `2.5M`, `0.25`. */
export function tickLabel(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${clean(n / 1e9)}B`;
  if (a >= 1e6) return `${clean(n / 1e6)}M`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * Where each series' mark starts and ends on each category when the series are piled up. Positive values pile above
 * zero and negative ones below it. `percent` scales every category to its total. Empty values count as nothing.
 */
export function stackSeries(values: readonly (readonly (number | null)[])[], percent: boolean): [number, number][][] {
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

/** A path through the points that curves smoothly (Catmull-Rom, drawn as Béziers). */
export function smoothPath(points: readonly { x: number; y: number }[]): string {
  if (!points.length) return "";
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    d += `C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  return d;
}

/** The path of a pie slice from angle `a0` to `a1` (radians, clockwise from twelve o'clock). */
export function slicePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-9) return `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx},${cy + r}A${r},${r} 0 1 1 ${cx},${cy - r}Z`;
  const pt = (a: number) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
  return `M${cx},${cy}L${pt(a0)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}Z`;
}

/** Points along the arc of radius `r` from angle `a0` to `a1` (radians, clockwise from twelve o'clock), as [x, z] seen from above with twelve o'clock at the back. */
export function slicePoints(r: number, a0: number, a1: number): [number, number][] {
  const steps = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 30)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [r * Math.sin(a), r * Math.cos(a)] as [number, number];
  });
}

/** The path of a ring segment (a doughnut slice) between radii `r0` and `r1` from angle `a0` to `a1` (radians, clockwise from twelve o'clock). */
export function ringPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    const ring = (r: number, sweep: 0 | 1) => `M${cx},${cy - r}A${r},${r} 0 1 ${sweep} ${cx},${cy + r}A${r},${r} 0 1 ${sweep} ${cx},${cy - r}Z`;
    return r0 > 0 ? ring(r1, 1) + ring(r0, 0) : ring(r1, 1);
  }
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(r1, a0)}A${r1},${r1} 0 ${big} 1 ${pt(r1, a1)}L${pt(r0, a1)}${r0 > 0 ? `A${r0},${r0} 0 ${big} 0 ${pt(r0, a0)}` : ""}Z`;
}

/** A colour made lighter (`f` above 0, towards white) or darker (below 0, towards black). */
export function tint(hex: string, f: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = c.map((v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)));
  return `#${out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}


const MAX_TICKS = 400;

/** How far along an axis (0 at the start of the plot, 1 at the end) a value lies. NaN where a logarithmic scale can't place it. */
export function fracOf(t: Ticks, v: number): number {
  let f: number;
  if (t.log) {
    if (!(v > 0)) return NaN;
    f = (Math.log(v) - Math.log(t.min)) / (Math.log(t.max) - Math.log(t.min));
  } else f = (v - t.min) / (t.max - t.min);
  return t.reverse ? 1 - f : f;
}

/** The value an axis is measured from for bars and areas: zero, or the low end of a scale that has no zero (logarithmic, or one that starts above it). */
export function axisBase(t: Ticks, crosses?: number): number {
  if (t.log) return t.min;
  const c = crosses ?? 0;
  return Math.min(t.max, Math.max(t.min, c));
}

const decades = (b: number, lo: number, hi: number): number[] => {
  const out: number[] = [];
  for (let k = Math.floor(Math.log(lo) / Math.log(b) + 1e-9); Math.pow(b, k) <= hi * (1 + 1e-9) && out.length < MAX_TICKS; k++) out.push(clean(Math.pow(b, k)));
  return out;
};

function logScale(a: ChartAxis, lo: number, hi: number): Ticks {
  const b = a.log!;
  const positive = Number.isFinite(lo) && lo > 0;
  const dLo = positive ? lo : 1;
  const dHi = Number.isFinite(hi) && hi > dLo ? hi : dLo * b;
  const min = a.min ?? clean(Math.pow(b, Math.floor(Math.log(dLo) / Math.log(b) + 1e-9)));
  let max = a.max ?? clean(Math.pow(b, Math.ceil(Math.log(dHi) / Math.log(b) - 1e-9)));
  if (!(max > min)) max = clean(min * b);
  const m = a.majorUnit && a.majorUnit > 1 ? a.majorUnit : b;
  const ticks: number[] = [];
  for (let v = min; v <= max * (1 + 1e-9) && ticks.length < MAX_TICKS; v = clean(v * m)) ticks.push(v);
  const minor: number[] = [];
  if (a.minorGridlines || (a.minorTick && a.minorTick !== "none")) {
    for (const d of decades(b, min / b, max)) {
      for (let j = 2; j < Math.min(b, 10); j++) {
        const v = clean(d * j);
        if (v > min * (1 + 1e-9) && v < max * (1 - 1e-9) && !ticks.some((t) => Math.abs(t - v) < v * 1e-9)) minor.push(v);
      }
    }
  }
  return { min, max, step: m, ticks, minor, log: b, ...(a.reverse ? { reverse: true } : {}) };
}

/**
 * The scale of a value axis for data from `lo` to `hi`: the ends and the labelled steps the axis settings ask for (a fixed
 * minimum or maximum, a major unit, a logarithmic base) and otherwise round numbers that cover the data. `minor` lists the
 * small ticks when the axis shows them.
 */
export function scaleTicks(axis: ChartAxis | undefined, lo: number, hi: number, count = 5): Ticks {
  const a = axis ?? {};
  if (a.log) return logScale(a, lo, hi);
  const base = niceTicks(lo, hi, count);
  let out: Ticks = base;
  if (a.min !== undefined || a.max !== undefined || a.majorUnit !== undefined) {
    const both = a.min !== undefined && a.max !== undefined;
    const spanGuess = both ? a.max! - a.min! : a.min !== undefined ? Math.max(hi, a.min + 1e-9) - a.min : a.max !== undefined ? a.max - Math.min(lo, a.max - 1e-9) : base.max - base.min;
    const step = a.majorUnit ?? (both || a.min !== undefined || a.max !== undefined ? niceStep(Math.max(spanGuess, 1e-12) / count) : base.step);
    let min: number;
    let max: number;
    if (both) {
      min = a.min!;
      max = a.max!;
    } else if (a.min !== undefined) {
      min = a.min;
      max = clean(min + Math.max(1, Math.ceil((hi - min) / step - 1e-9)) * step);
    } else if (a.max !== undefined) {
      max = a.max;
      min = clean(max - Math.max(1, Math.ceil((max - lo) / step - 1e-9)) * step);
    } else {
      min = clean(Math.floor(lo / step + 1e-9) * step);
      max = clean(Math.ceil(hi / step - 1e-9) * step);
      if (!(max > min)) max = clean(min + step);
    }
    if ((max - min) / step <= MAX_TICKS) {
      const ticks: number[] = [];
      for (let i = 0; min + i * step <= max + step * 1e-9 && ticks.length <= MAX_TICKS; i++) ticks.push(clean(min + i * step));
      out = { min, max, step, ticks };
    }
  }
  if (a.minorGridlines || (a.minorTick && a.minorTick !== "none")) {
    const minorStep = a.minorUnit ?? out.step / 5;
    const minor: number[] = [];
    if (minorStep > 0 && (out.max - out.min) / minorStep <= MAX_TICKS * 4) {
      for (let i = 1; out.min + i * minorStep < out.max - minorStep * 1e-9; i++) {
        const v = clean(out.min + i * minorStep);
        if (!out.ticks.some((t) => Math.abs(t - v) < minorStep * 1e-6)) minor.push(v);
      }
    }
    out = { ...out, minor };
  }
  return a.reverse ? { ...out, reverse: true } : out;
}

/** How far slice `k` of a series is pulled out, in percent of the radius: its own setting, or the series'. */
export function explosionOf(series: Pick<ChartSeries, "explosion" | "pointExplosion"> | undefined, k: number): number {
  return series?.pointExplosion?.[String(k)] ?? series?.explosion ?? 0;
}

/** The biggest explosion in a series (to make room for), among its first `n` points. */
export function maxExplosion(series: Pick<ChartSeries, "explosion" | "pointExplosion"> | undefined, n: number): number {
  let m = series?.explosion ?? 0;
  for (const [k, v] of Object.entries(series?.pointExplosion ?? {})) if (Number(k) < n) m = Math.max(m, v);
  return m;
}

/** The centre a slice is drawn from when it is pulled out `pct` percent of `r` in the direction `mid` (radians, clockwise from twelve). */
export function explodedCentre(cx: number, cy: number, r: number, mid: number, pct: number): { cx: number; cy: number } {
  const d = (r * pct) / 100;
  return { cx: cx + d * Math.sin(mid), cy: cy - d * Math.cos(mid) };
}

/** Where the other axis crosses a value axis: its zero if the scale has one, else its low end (or high end, below zero), unless the settings say. */
export function crossingValue(t: Ticks, c: ChartAxis["crosses"]): number {
  if (c === "min") return t.min;
  if (c === "max") return t.max;
  if (typeof c === "number") return Math.min(t.max, Math.max(t.min, c));
  return t.log ? t.min : t.min > 0 ? t.min : t.max < 0 ? t.max : 0;
}

/** What a data label says, given the parts the chart asks for. */
export function labelText(chart: { labelShow?: readonly string[] | undefined }, parts: { value?: string; category?: string; series?: string; percent?: string }, usual: readonly string[] = ["value"]): string {
  const show = chart.labelShow ?? usual;
  const out: string[] = [];
  if (show.includes("series") && parts.series) out.push(parts.series);
  if (show.includes("category") && parts.category) out.push(parts.category);
  if (show.includes("value") && parts.value) out.push(parts.value);
  if (show.includes("percent") && parts.percent) out.push(parts.percent);
  return out.join(", ");
}

