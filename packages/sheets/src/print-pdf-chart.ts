import type { PdfItem, PdfPathCommand } from "@pli.dev/docs";
import type { ChartData } from "./chart";
import type { Chart } from "./model";
import { textWidthPt } from "./print-more";

/*
 * Charts drawn into the PDF as lines, rectangles and text, so a file made in Node (or anywhere without a canvas) has them too:
 * columns and bars (grouped, stacked, 100%), lines, areas, scatter, pie and doughnut. The other kinds (3-D, radar, stock, the
 * newer statistical charts) need the host's `rasterize` and are a frame with a title without it. The look is plain on purpose:
 * the same data, colours, titles, legend and axes as the chart on the sheet, without its effects.
 */

/** The kinds this file draws itself. */
export const PDF_CHART_KINDS: ReadonlySet<string> = new Set(["column", "bar", "line", "area", "scatter", "pie", "doughnut"]);

export interface PdfChartBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const INK = "#404040";
const GRID = "#d9d9d9";
const FONT = { family: "Calibri" } as const;

/** Whether this chart can be drawn here: a drawn kind, in two dimensions, with nothing the simple look would get wrong. */
export function canDrawChart(chart: Chart): boolean {
  if (!PDF_CHART_KINDS.has(chart.type)) return false;
  if (chart.view3d) return false;
  // Logarithmic and reversed axes are drawn by the host.
  if (Object.values(chart.axes ?? {}).some((a) => a && (a.log || a.reverse))) return false;
  if (chart.series.some((s) => s.type && s.type !== (chart.type as string))) return false;
  return true;
}

/** A tidy step for an axis that runs `span` in about `count` steps. */
function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

const compact = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}K`;
  return String(+v.toFixed(4));
};

/** A wedge of a circle as path commands (from angle `a0` to `a1`, radians clockwise from twelve o'clock). */
function wedge(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): PdfPathCommand[] {
  const pt = (rad: number, a: number): [number, number] => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  const out: PdfPathCommand[] = [];
  const arcTo = (rad: number, from: number, to: number) => {
    const parts = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)));
    const step = (to - from) / parts;
    for (let i = 0; i < parts; i++) {
      const a = from + i * step;
      const b = a + step;
      const h = (4 / 3) * Math.tan((b - a) / 4) * rad;
      const p0 = pt(rad, a);
      const p3 = pt(rad, b);
      out.push(["C", p0[0] + h * Math.cos(a), p0[1] + h * Math.sin(a), p3[0] - h * Math.cos(b), p3[1] - h * Math.sin(b), p3[0], p3[1]]);
    }
  };
  const start = pt(r, a0);
  out.push(["M", start[0], start[1]]);
  arcTo(r, a0, a1);
  if (inner > 0) {
    const e = pt(inner, a1);
    out.push(["L", e[0], e[1]]);
    arcTo(inner, a1, a0);
  } else out.push(["L", cx, cy]);
  out.push(["Z"]);
  return out;
}

/**
 * The items that draw a chart in `box` (points). `ink` and `paint` let black and white printing change colours. Returns
 * null when the chart is of a kind drawn elsewhere.
 */
export function chartPdfItems(chart: Chart, data: ChartData, box: PdfChartBox, paint: (c: string) => string = (c) => c): PdfItem[] | null {
  if (!canDrawChart(chart)) return null;
  const items: PdfItem[] = [];
  const text = (value: string, x: number, baseline: number, size: number, o: { bold?: boolean; anchor?: "start" | "middle" | "end"; color?: string } = {}) => {
    if (!value) return;
    const width = textWidthPt(value, size, !!o.bold);
    const left = o.anchor === "middle" ? x - width / 2 : o.anchor === "end" ? x - width : x;
    items.push({ type: "text", x: left, y: baseline, text: value, font: { ...FONT, ...(o.bold ? { bold: true } : {}) }, size, color: paint(o.color ?? INK), width });
  };
  const textW = (value: string, size: number) => textWidthPt(value, size, false);
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, width = 0.75) => items.push({ type: "line", x1, y1, x2, y2, color: paint(color), width });
  const rect = (x: number, y: number, w: number, h: number, fill: string) => items.push({ type: "rect", x, y, width: Math.max(0, w), height: Math.max(0, h), fill: paint(fill) });

  const series = data.series;
  const colorOf = (si: number, pi: number) => series[si]?.pointColors?.[String(pi)] ?? series[si]?.color ?? "#4472c4";
  const pie = chart.type === "pie" || chart.type === "doughnut";
  const names = pie ? data.categories : series.map((s) => s.name);

  let top = box.y + 6;
  if (chart.title) {
    text(chart.title, box.x + box.width / 2, top + 11, 13, { bold: true, anchor: "middle" });
    top += 22;
  }
  let bottom = box.y + box.height - 6;
  let left = box.x + 8;
  let right = box.x + box.width - 8;

  // Legend: a row along the bottom or top, or a column at the side.
  const legend = chart.legend ?? "bottom";
  const showLegend = legend !== "none" && (pie || series.length > 1) && names.length > 0;
  if (showLegend) {
    const entries = names.map((n, i) => ({ n: n || `Series ${i + 1}`, c: pie ? colorOf(0, i) : colorOf(i, -1) }));
    if (legend === "left" || legend === "right") {
      const w = Math.min(box.width * 0.3, Math.max(...entries.map((e) => textW(e.n, 9))) + 20);
      const x0 = legend === "left" ? left : right - w;
      entries.forEach((e, i) => {
        const y = top + 14 + i * 14;
        if (y > bottom) return;
        rect(x0, y - 7, 8, 8, e.c);
        text(e.n, x0 + 12, y, 9);
      });
      if (legend === "left") left += w + 6;
      else right -= w + 6;
    } else {
      const total = entries.reduce((s, e) => s + textW(e.n, 9) + 24, 0);
      let x = box.x + Math.max(8, (box.width - total) / 2);
      const y = legend === "top" ? top + 8 : bottom - 2;
      for (const e of entries) {
        rect(x, y - 7, 8, 8, e.c);
        text(e.n, x + 12, y, 9);
        x += textW(e.n, 9) + 24;
      }
      if (legend === "top") top += 16;
      else bottom -= 16;
    }
  }

  if (pie) {
    const values = (series[0]?.values ?? []).map((v) => (v !== null && v > 0 ? v : 0));
    const sum = values.reduce((a, b) => a + b, 0);
    const r = Math.max(8, Math.min(right - left, bottom - top) / 2 - 4);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    if (sum > 0) {
      let a = ((chart.firstSliceAngle ?? 0) * Math.PI) / 180;
      values.forEach((v, i) => {
        if (v <= 0) return;
        const next = a + (v / sum) * Math.PI * 2;
        const d = wedge(cx, cy, r, chart.type === "doughnut" ? r * (chart.holeSize ?? 50) / 100 : 0, a, Math.min(next, a + Math.PI * 2 - 1e-6));
        items.push({ type: "path", d, fill: paint(colorOf(0, i)), stroke: paint("#ffffff"), strokeWidth: 0.75, lineJoin: "round" });
        if (v / sum >= 0.04) {
          const mid = (a + next) / 2;
          const rr = chart.type === "doughnut" ? r * (1 + (chart.holeSize ?? 50) / 100) / 2 : r * 0.62;
          text(`${Math.round((v / sum) * 100)}%`, cx + rr * Math.sin(mid), cy - rr * Math.cos(mid) + 3, 9, { anchor: "middle", color: "#ffffff", bold: true });
        }
        a = next;
      });
    }
    return items;
  }

  const horizontal = chart.type === "bar";
  const scatter = chart.type === "scatter";
  const count = Math.max(0, ...series.map((s) => s.values.length), data.categories.length);
  const stacked = chart.grouping === "stacked" || chart.grouping === "percent";
  const percent = chart.grouping === "percent";

  // The value range.
  let lo = 0;
  let hi = 0;
  let xLo = Infinity;
  let xHi = -Infinity;
  if (scatter) {
    lo = Infinity;
    hi = -Infinity;
    for (const s of series) {
      s.values.forEach((v, i) => {
        if (v === null) return;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        const x = s.x?.[i] ?? i + 1;
        xLo = Math.min(xLo, x);
        xHi = Math.max(xHi, x);
      });
    }
    if (!Number.isFinite(lo)) [lo, hi, xLo, xHi] = [0, 1, 0, 1];
  } else if (percent) {
    hi = 1;
  } else {
    for (let i = 0; i < count; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        if (stacked) {
          if (v >= 0) pos += v;
          else neg += v;
        } else {
          pos = Math.max(pos, v);
          neg = Math.min(neg, v);
        }
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    }
  }
  const axis = chart.axes?.y;
  if (axis?.min !== undefined) lo = axis.min;
  if (axis?.max !== undefined) hi = axis.max;
  if (hi === lo) hi = lo + 1;
  const step = percent ? 0.25 : axis?.majorUnit && axis.majorUnit > 0 ? axis.majorUnit : niceStep(hi - lo, 5);
  if (!percent && axis?.max === undefined) hi = Math.ceil(hi / step - 1e-9) * step;
  if (!percent && axis?.min === undefined && lo < 0) lo = Math.floor(lo / step + 1e-9) * step;
  if (scatter) {
    if (xHi === xLo) xHi = xLo + 1;
  }
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  const fmt = (v: number) => (percent ? `${Math.round(v * 100)}%` : compact(v));

  // Room for the labels.
  const labelSize = 9;
  const catLabels = scatter ? [] : Array.from({ length: count }, (_, i) => data.categories[i] ?? String(i + 1));
  const valueLabelW = Math.max(...ticks.map((t) => textW(fmt(t), labelSize)), 8);
  const catLabelW = horizontal ? Math.max(...catLabels.map((c) => textW(c, labelSize)), 8) : 0;
  const xTitle = chart.xTitle;
  const yTitle = chart.yTitle;
  const plot = {
    x: left + (horizontal ? catLabelW : valueLabelW) + 8 + (yTitle ? 12 : 0),
    y: top + 4,
    w: 0,
    h: 0,
  };
  const labelRows = horizontal ? 1 : 1;
  plot.w = right - plot.x - 6;
  plot.h = bottom - plot.y - (horizontal ? 0 : labelRows * 12) - (horizontal ? 12 : 0) - (xTitle ? 12 : 0) - 4;
  if (plot.w < 20 || plot.h < 20) return items;

  const valueToPos = (v: number) => (horizontal ? plot.x + ((v - lo) / (hi - lo)) * plot.w : plot.y + plot.h - ((v - lo) / (hi - lo)) * plot.h);
  // Gridlines and value labels.
  for (const t of ticks) {
    const p = valueToPos(t);
    if (horizontal) {
      line(p, plot.y, p, plot.y + plot.h, GRID);
      text(fmt(t), p, plot.y + plot.h + 11, labelSize, { anchor: "middle" });
    } else {
      line(plot.x, p, plot.x + plot.w, p, GRID);
      text(fmt(t), plot.x - 4, p + 3, labelSize, { anchor: "end" });
    }
  }
  const zero = valueToPos(Math.max(lo, Math.min(hi, 0)));
  if (horizontal) line(zero, plot.y, zero, plot.y + plot.h, "#808080");
  else line(plot.x, zero, plot.x + plot.w, zero, "#808080");

  if (scatter) {
    const px = (x: number) => plot.x + ((x - xLo) / (xHi - xLo)) * plot.w;
    const xs = niceStep(xHi - xLo, 5);
    for (let v = Math.ceil(xLo / xs - 1e-9) * xs; v <= xHi + xs * 1e-6; v += xs) {
      const p = px(v);
      line(p, plot.y + plot.h, p, plot.y + plot.h + 3, "#808080");
      text(compact(+v.toFixed(10)), p, plot.y + plot.h + 14, labelSize, { anchor: "middle" });
    }
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = px(s.x?.[i] ?? i + 1);
        const y = valueToPos(v);
        items.push({ type: "path", d: [["M", x + 2.5, y], ["C", x + 2.5, y + 1.4, x + 1.4, y + 2.5, x, y + 2.5], ["C", x - 1.4, y + 2.5, x - 2.5, y + 1.4, x - 2.5, y], ["C", x - 2.5, y - 1.4, x - 1.4, y - 2.5, x, y - 2.5], ["C", x + 1.4, y - 2.5, x + 2.5, y - 1.4, x + 2.5, y], ["Z"]], fill: paint(colorOf(si, i)) });
      });
    });
  } else {
    const slot = (horizontal ? plot.h : plot.w) / Math.max(1, count);
    const centre = (i: number) => (horizontal ? plot.y : plot.x) + slot * (i + 0.5);
    // Category labels (thinned out when they would run into each other).
    const every = Math.max(1, Math.ceil((Math.max(...catLabels.map((c) => textW(c, labelSize)), 1) + 4) / (horizontal ? 12 : slot)));
    catLabels.forEach((c, i) => {
      if (i % every) return;
      if (horizontal) text(c, plot.x - 4, centre(i) + 3, labelSize, { anchor: "end" });
      else text(c, centre(i), plot.y + plot.h + 12, labelSize, { anchor: "middle" });
    });
    const kind = chart.type;
    if (kind === "column" || kind === "bar") {
      const group = stacked ? 1 : Math.max(1, series.length);
      const gap = slot * 0.2;
      const w = (slot - gap) / group;
      for (let i = 0; i < count; i++) {
        let pos = 0;
        let neg = 0;
        const total = percent ? series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0) || 1 : 1;
        series.forEach((s, si) => {
          const raw = s.values[i];
          if (raw === null || raw === undefined) return;
          const v = percent ? raw / total : raw;
          const from = stacked ? (v >= 0 ? pos : neg) : 0;
          const to = from + v;
          if (stacked) v >= 0 ? (pos = to) : (neg = to);
          const a = valueToPos(from);
          const b = valueToPos(to);
          const offset = stacked ? 0 : si * w;
          const start = (horizontal ? plot.y : plot.x) + slot * i + gap / 2 + offset;
          if (horizontal) rect(Math.min(a, b), start, Math.abs(b - a), w, colorOf(si, i));
          else rect(start, Math.min(a, b), w, Math.abs(b - a), colorOf(si, i));
        });
      }
    } else {
      // Lines and areas.
      const cum = new Array<number>(count).fill(0);
      series.forEach((s, si) => {
        const pts: ([number, number] | null)[] = [];
        for (let i = 0; i < count; i++) {
          const raw = s.values[i];
          if (raw === null || raw === undefined) {
            pts.push(null);
            continue;
          }
          const total = percent ? series.reduce((a, t) => a + Math.abs(t.values[i] ?? 0), 0) || 1 : 1;
          const v = percent ? raw / total : raw;
          const level = stacked ? (cum[i] = cum[i]! + v) : v;
          pts.push([centre(i), valueToPos(level)]);
        }
        const color = paint(colorOf(si, -1));
        if (kind === "area") {
          const run = pts.filter((p): p is [number, number] => p !== null);
          if (run.length > 1) {
            const base = valueToPos(Math.max(lo, 0));
            const d: PdfPathCommand[] = [["M", run[0]![0], base], ...run.map((p): PdfPathCommand => ["L", p[0], p[1]]), ["L", run[run.length - 1]![0], base], ["Z"]];
            items.push({ type: "path", d, fill: color, stroke: color, strokeWidth: 0.75 });
          }
          return;
        }
        let prev: [number, number] | null = null;
        for (const p of pts) {
          if (p && prev) items.push({ type: "line", x1: prev[0], y1: prev[1], x2: p[0], y2: p[1], color, width: 2 });
          prev = p;
        }
        for (const p of pts) if (p) rect(p[0] - 2, p[1] - 2, 4, 4, colorOf(si, -1));
      });
    }
  }

  line(plot.x, plot.y, plot.x, plot.y + plot.h, "#808080");
  line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h, "#808080");
  if (xTitle) text(xTitle, plot.x + plot.w / 2, bottom - 2, 10, { anchor: "middle", bold: true });
  if (yTitle) text(yTitle, box.x + 6, plot.y + 8, 10, { bold: true });
  return items;
}
