import { PliError } from "@pli.dev/core";
import { cellAddress, parseCell } from "./address";
import { chartRef } from "./chart";
import { MAX_COLS, MAX_ROWS, type Sheet, type SparklineColor, type SparklineGroup, type SparklineType } from "./model";
import { OFFICE_HYPERLINKS, OFFICE_THEME, tinted } from "./xlsx-format";

/** Excel's colours for a sparkline. */
export const SPARKLINE_COLORS = { series: "#376092", negative: "#d00000", marker: "#d00000", first: "#d00000", last: "#d00000", high: "#d00000", low: "#d00000", axis: "#000000" } as const;
export const SPARKLINE_TYPES: readonly SparklineType[] = ["line", "column", "winloss"];
const COLOR = /^#[0-9a-fA-F]{6}$/;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

const FLAGS = ["markers", "first", "last", "high", "low", "negative", "showHidden", "rightToLeft", "showAxis"] as const;
const COLORS = ["color", "negativeColor", "markerColor", "firstColor", "lastColor", "highColor", "lowColor", "axisColor"] as const;

/** The workbook's theme colours as `#rrggbb`, Office's own when it has none of its own. */
export const officeThemeColors = (): string[] => OFFICE_THEME.map((c) => `#${c.toLowerCase()}`);

/** A sparkline colour as `#rrggbb`: a theme colour is looked up in the workbook's palette (and made lighter or darker by its tint). */
export function sparkColor(c: SparklineColor | undefined, fallback: string, palette?: readonly string[]): string {
  if (c === undefined) return fallback;
  if (typeof c === "string") return c;
  // Theme 10 and 11 are the hyperlink and followed-hyperlink colours, which a palette of ten leaves to Office's.
  const office = [...officeThemeColors(), ...OFFICE_HYPERLINKS.map((h) => `#${h.toLowerCase()}`)];
  const base = (palette ?? office)[c.theme] ?? office[c.theme];
  if (!base) return fallback;
  return c.tint ? `#${tinted(base.slice(1), Math.max(-1, Math.min(1, c.tint)))}` : base;
}

/** Whether a colour is one of the workbook's theme colours. */
export const isThemeColor = (c: SparklineColor | undefined): c is { theme: number; tint?: number } => typeof c === "object" && c !== null;

/** A group of sparklines made ready to keep, or an error that says what is wrong. */
export function cleanSparklines(g: SparklineGroup): SparklineGroup {
  if (!g || typeof g.id !== "string" || g.id === "") bad("A group of sparklines needs an id");
  if (!SPARKLINE_TYPES.includes(g.type)) bad(`A sparkline is a ${SPARKLINE_TYPES.join(", ")}`);
  if (!Array.isArray(g.items) || g.items.length === 0) bad("A group of sparklines needs a cell to draw in");
  const seen = new Set<string>();
  const items = g.items.map((item) => {
    const pos = typeof item?.cell === "string" ? parseCell(item.cell.toUpperCase()) : null;
    if (!pos || pos.row > MAX_ROWS || pos.col > MAX_COLS) return bad(`"${String(item?.cell)}" isn't a cell`);
    const cell = cellAddress(pos.row, pos.col);
    if (seen.has(cell)) bad(`${cell} has two sparklines`);
    seen.add(cell);
    const r = chartRef(item.source, "");
    if (!r) bad(`"${String(item.source)}" isn't a row or column of cells such as Sheet1!$A$2:$E$2`);
    const b = r!.bounds;
    if (b.r1 !== b.r2 && b.c1 !== b.c2) bad("A sparkline draws one row or one column of cells");
    return { cell, source: item.source };
  });
  const out: SparklineGroup = { id: g.id, type: g.type, items };
  for (const k of COLORS) {
    const v = g[k];
    if (v === undefined) continue;
    if (typeof v === "string") {
      if (!COLOR.test(v)) bad(`The ${k} looks like #rrggbb, or is a colour of the theme`);
      out[k] = v.toLowerCase();
    } else if (v && typeof v === "object") {
      const t = (v as { theme?: unknown }).theme;
      const tint = (v as { tint?: unknown }).tint;
      if (!Number.isInteger(t) || (t as number) < 0 || (t as number) > 11) bad(`The theme colour of the ${k} is a number from 0 to 11`);
      if (tint !== undefined && !(typeof tint === "number" && tint >= -1 && tint <= 1)) bad(`The tint of the ${k} is a number from -1 to 1`);
      out[k] = { theme: t as number, ...(typeof tint === "number" && tint !== 0 ? { tint } : {}) };
    } else bad(`The ${k} looks like #rrggbb, or is a colour of the theme`);
  }
  if (g.dateAxis !== undefined) {
    if (typeof g.dateAxis !== "string") bad("The dates of the axis are a row or column of cells such as Sheet1!$A$2:$H$2");
    // Dates that have been deleted leave the axis out rather than the sparklines unreadable.
    else if (!g.dateAxis.includes("#REF!")) {
      const r = chartRef(g.dateAxis, "");
      if (!r) bad(`"${g.dateAxis}" isn't a row or column of dates such as Sheet1!$A$2:$H$2`);
      else if (r.bounds.r1 !== r.bounds.r2 && r.bounds.c1 !== r.bounds.c2) bad("The dates of the axis are one row or one column of cells");
      out.dateAxis = g.dateAxis;
    }
  }
  for (const k of FLAGS) {
    if (g[k] === undefined || g[k] === (false as never)) continue;
    if (g[k] !== true) bad(`${k} is true or false`);
    out[k] = true;
  }
  if (g.lineWeight !== undefined && g.lineWeight !== 0.75) {
    if (!(g.lineWeight >= 0.25 && g.lineWeight <= 6)) bad("A line is 0.25 to 6 points thick");
    out.lineWeight = g.lineWeight;
  }
  if (g.emptyAs !== undefined) {
    if (g.emptyAs !== "zero" && g.emptyAs !== "span") bad('Empty cells count as "zero", are joined across ("span") or leave a gap (leave it out)');
    out.emptyAs = g.emptyAs;
  }
  for (const k of ["min", "max"] as const) {
    const v = g[k];
    if (v === undefined) continue;
    if (v !== "group" && !(typeof v === "number" && Number.isFinite(v))) bad(`The ${k} of the axis is a number or "group"`);
    out[k] = v;
  }
  if (typeof out.min === "number" && typeof out.max === "number" && out.min >= out.max) bad("The least the axis shows is below the most");
  return out;
}

/** The sparkline at a cell of a sheet, with the group it belongs to. */
export function sparklineAt(sheet: Sheet, address: string): { group: SparklineGroup; item: SparklineGroup["items"][number] } | undefined {
  for (const group of sheet.sparklines ?? []) {
    const item = group.items.find((i) => i.cell === address);
    if (item) return { group, item };
  }
  return undefined;
}

// ---- drawing ----

export interface SparkPoint {
  x: number;
  y: number;
  color: string;
}

export type SparkShape =
  | { kind: "line"; width: number; height: number; /** Runs of points, apart where a gap is. */ lines: [number, number][][]; color: string; weight: number; dots: SparkPoint[]; axis?: number; axisColor?: string }
  | { kind: "bars"; width: number; height: number; bars: { x: number; y: number; w: number; h: number; color: string }[]; axis?: number; axisColor?: string };

/** What else drawing a sparkline needs to know besides its numbers. */
export interface SparkLayoutOptions {
  /** The least and most the axis must show, if the group fixes them to its own. */
  bounds?: { min?: number; max?: number };
  /** The date of each number (`null` for a cell with no date), when the group has a date axis. */
  dates?: readonly (number | null)[];
  /** The colours of the workbook's theme, for sparklines coloured from it. */
  palette?: readonly string[];
  /** Where each number sits along the x axis (`SPARKLINE` with two columns of data), in the order of the numbers; the axis runs from `xmin` to `xmax` if given, else from the least to the most. */
  xs?: readonly (number | null)[];
  xmin?: number;
  xmax?: number;
}

/**
 * Where the sparkline's points go: the numbers it draws (`null` for an empty cell) and the least and most the axis must show, if the
 * group fixes them. With a date axis the points sit where their dates put them, in date order, and a point with no date isn't drawn.
 */
export function layoutSparkline(values: readonly (number | null)[], g: SparklineGroup, width: number, height: number, options: SparkLayoutOptions | { min?: number; max?: number } = {}): SparkShape {
  const opts: SparkLayoutOptions = "bounds" in options || "dates" in options || "palette" in options || "xs" in options ? (options as SparkLayoutOptions) : { bounds: options as { min?: number; max?: number } };
  const bounds = opts.bounds;
  const pad = Math.max(1, Math.min(3, Math.min(width, height) / 8));
  const col = (c: SparklineColor | undefined, fallback: string) => sparkColor(c, fallback, opts.palette);
  const placed = opts.xs ?? (g.dateAxis !== undefined ? opts.dates : undefined);
  const dated = placed !== undefined;
  // The points in the order they are drawn, each with its date (or x) when there is a date axis.
  let points: { v: number | null; d: number }[];
  if (dated) {
    points = values.map((v, i) => ({ v, d: placed![i] ?? NaN })).filter((p) => Number.isFinite(p.d) && (opts.xmin === undefined || p.d >= opts.xmin) && (opts.xmax === undefined || p.d <= opts.xmax));
    points.sort((a, b) => a.d - b.d);
  } else points = (g.rightToLeft ? [...values].reverse() : [...values]).map((v, i) => ({ v, d: i }));
  const drawn = g.emptyAs === "zero" ? points.map((p) => p.v ?? 0) : points.map((p) => p.v);
  const real = drawn.filter((v): v is number => v !== null);
  const color = col(g.color, SPARKLINE_COLORS.series);
  const axisColor = col(g.axisColor, SPARKLINE_COLORS.axis);
  const empty = (kind: SparkShape["kind"]): SparkShape => (kind === "line" ? { kind, width, height, lines: [], color, weight: g.lineWeight ?? 0.75, dots: [] } : { kind, width, height, bars: [] });
  if (!real.length) return empty(g.type === "line" ? "line" : "bars");
  const lo0 = Math.min(...real);
  const hi0 = Math.max(...real);
  // Bars grow from zero, so the axis always takes it in; a line fills the room from its least to its most.
  let min = typeof g.min === "number" ? g.min : g.min === "group" && bounds?.min !== undefined ? bounds.min : g.type === "line" ? lo0 : Math.min(0, lo0);
  let max = typeof g.max === "number" ? g.max : g.max === "group" && bounds?.max !== undefined ? bounds.max : g.type === "line" ? hi0 : Math.max(0, hi0);
  if (max - min < 1e-12) {
    min -= 1;
    max += 1;
  }
  const top = pad;
  const bottom = height - pad;
  const y = (v: number) => bottom - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (bottom - top);
  const n = drawn.length;
  const highAt = real.indexOf(hi0) >= 0 ? drawn.indexOf(hi0) : -1;
  const lowAt = drawn.indexOf(lo0);
  const negativeColor = col(g.negativeColor, SPARKLINE_COLORS.negative);
  const markerColor = col(g.markerColor, SPARKLINE_COLORS.marker);
  const colorOf = (i: number, v: number): string => {
    if (g.first && i === 0) return col(g.firstColor, SPARKLINE_COLORS.first);
    if (g.last && i === n - 1) return col(g.lastColor, SPARKLINE_COLORS.last);
    if (g.high && i === highAt) return col(g.highColor, SPARKLINE_COLORS.high);
    if (g.low && i === lowAt) return col(g.lowColor, SPARKLINE_COLORS.low);
    if (g.negative && v < 0) return negativeColor;
    return g.type === "line" ? markerColor : v < 0 ? negativeColor : color;
  };
  const zero = y(0);
  const axis = g.showAxis && min <= 0 && max >= 0 ? zero : undefined;
  const left = pad;
  const span = width - 2 * pad;
  // Dates put a point at its share of the time from the first to the last; the bars' room is the smallest gap between two dates.
  const first = opts.xmin ?? points[0]!.d;
  const time = (opts.xmax ?? points[n - 1]!.d) - first;
  let step = 0;
  for (let i = 1; i < n; i++) {
    const gap = points[i]!.d - points[i - 1]!.d;
    if (gap > 1e-9 && (step === 0 || gap < step)) step = gap;
  }
  const units = dated && step > 0 ? Math.round(time / step) + 1 : n;
  const slot = span / Math.max(1, units);
  const mirror = (x: number, w = 0) => (dated && g.rightToLeft ? width - x - w : x);
  const lineX = (i: number) => mirror(dated ? (time > 0 ? left + ((points[i]!.d - first) / time) * span : width / 2) : n === 1 ? width / 2 : left + (i * span) / (n - 1));
  if (g.type === "line") {
    const lines: [number, number][][] = [];
    let run: [number, number][] = [];
    const dots: SparkPoint[] = [];
    drawn.forEach((v, i) => {
      if (v === null) {
        // A gap ends the line; joining across leaves the run as it is.
        if (g.emptyAs !== "span" && run.length) {
          lines.push(run);
          run = [];
        }
        return;
      }
      const x = lineX(i);
      run.push([x, y(v)]);
      const special = (g.first && i === 0) || (g.last && i === n - 1) || (g.high && i === highAt) || (g.low && i === lowAt) || (g.negative && v < 0);
      if (g.markers || special) dots.push({ x, y: y(v), color: colorOf(i, v) });
    });
    if (run.length) lines.push(run);
    return { kind: "line", width, height, lines, color, weight: g.lineWeight ?? 0.75, dots, ...(axis !== undefined ? { axis, axisColor } : {}) };
  }
  const gap = Math.min(slot * 0.2, 3);
  const bars: { x: number; y: number; w: number; h: number; color: string }[] = [];
  drawn.forEach((v, i) => {
    if (v === null || v === 0) return;
    const bw = Math.max(1, slot - gap);
    const at = dated ? (step > 0 ? Math.round((points[i]!.d - first) / step) : 0) : i;
    const bx = mirror(pad + at * slot + gap / 2, bw);
    if (g.type === "winloss") {
      const mid = height / 2;
      const half = (height - 2 * pad) / 2;
      bars.push({ x: bx, y: v > 0 ? mid - half : mid, w: bw, h: half, color: colorOf(i, v) });
    } else {
      const ty = Math.min(y(v), zero);
      bars.push({ x: bx, y: ty, w: bw, h: Math.max(1, Math.abs(y(v) - zero)), color: colorOf(i, v) });
    }
  });
  const mid = g.type === "winloss" ? height / 2 : axis;
  return { kind: "bars", width, height, bars, ...(g.showAxis && mid !== undefined ? { axis: mid, axisColor } : {}) };
}

/** The colours a `"bar"` chart's segments take when `color1`, `color2`… don't say. */
export const BAR_COLORS = ["#376092", "#d00000", "#7f9a2d", "#e0a030", "#6f5aa8", "#4bacc6", "#f79646"];

/**
 * Google's `"bar"` chart: one stacked bar across the cell, a segment for each number (negative and empty ones take no room), the
 * whole of the width standing for `max` (or for the numbers' total, when that is more or no `max` is given).
 */
export function layoutBarSparkline(values: readonly (number | null)[], bar: { colors: readonly string[]; max?: number }, width: number, height: number, rightToLeft = false): SparkShape {
  const pad = Math.max(1, Math.min(3, Math.min(width, height) / 8));
  const parts = values.map((v) => (v !== null && v > 0 ? v : 0));
  const total = parts.reduce((a, b) => a + b, 0);
  const scale = Math.max(total, bar.max !== undefined && bar.max > 0 ? bar.max : 0);
  const bars: { x: number; y: number; w: number; h: number; color: string }[] = [];
  if (scale > 0) {
    const span = width - 2 * pad;
    const h = Math.max(1, (height - 2 * pad) * 0.6);
    let x = 0;
    parts.forEach((v, i) => {
      if (v <= 0) return;
      const w = (v / scale) * span;
      const color = bar.colors[i] || BAR_COLORS[i % BAR_COLORS.length]!;
      bars.push({ x: rightToLeft ? width - pad - x - w : pad + x, y: (height - h) / 2, w, h, color });
      x += w;
    });
  }
  return { kind: "bars", width, height, bars };
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** The shape as an `<svg>`, to show in a cell or on paper. */
export function sparklineSvg(shape: SparkShape): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(shape.width)} ${num(shape.height)}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">`;
  const axis = shape.axis !== undefined ? `<line x1="0" x2="${num(shape.width)}" y1="${num(shape.axis)}" y2="${num(shape.axis)}" stroke="${shape.axisColor ?? SPARKLINE_COLORS.axis}" stroke-width="0.5"/>` : "";
  if (shape.kind === "bars") return `${open}${axis}${shape.bars.map((b) => `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" fill="${b.color}"/>`).join("")}</svg>`;
  const lines = shape.lines.map((run) => (run.length === 1 ? "" : `<polyline fill="none" stroke="${shape.color}" stroke-width="${shape.weight * (4 / 3)}" stroke-linejoin="round" stroke-linecap="round" points="${run.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}"/>`)).join("");
  const dots = shape.dots.map((d) => `<circle cx="${num(d.x)}" cy="${num(d.y)}" r="${num(Math.max(1.4, shape.weight * 2))}" fill="${d.color}"/>`).join("");
  // A single point has no line to draw, so it is a dot.
  const lone = shape.lines.filter((run) => run.length === 1).map(([[x, y]]) => `<circle cx="${num(x!)}" cy="${num(y!)}" r="${num(Math.max(1.4, shape.weight * 2))}" fill="${shape.color}"/>`).join("");
  return `${open}${axis}${lines}${lone}${dots}</svg>`;
}
