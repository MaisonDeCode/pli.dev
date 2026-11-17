import type { Chart, ChartData, ChartView3d } from "@pli.dev/sheets";

/*
 * Picking the marks of a chart. The drawing tags each mark with `data-mark="series:point"` and where it is (`data-hit`, in the
 * chart's own pixels: a rectangle `r:x,y,w,h`, a circle `c:cx,cy,r` or a ring slice `a:cx,cy,r0,r1,a0,a1` with the angles in radians
 * clockwise from twelve o'clock), so a click can be turned into a mark by position, as everything over the grid is, and without
 * asking the browser for the shapes. The same tags serve the arrow keys.
 */

export interface MarkRef {
  series: number;
  point: number;
}

/** The attributes the drawing puts on a mark. */
export function markAttrs(series: number, point: number, hit: string, picked: MarkRef | null | undefined): Record<string, string> {
  return { "data-mark": `${series}:${point}`, "data-hit": hit, ...(picked && picked.series === series && picked.point === point ? { "data-marksel": "" } : {}) };
}

export const rectHit = (x: number, y: number, w: number, h: number) => `r:${[x, y, w, h].map(round).join(",")}`;
export const circleHit = (cx: number, cy: number, r: number) => `c:${[cx, cy, r].map(round).join(",")}`;
export const arcHit = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) => `a:${[cx, cy, r0, r1].map(round).join(",")},${a0.toFixed(4)},${a1.toFixed(4)}`;
function round(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** Whether the point (x, y) is on the shape a `data-hit` describes. `slop` widens small shapes so that they can be hit. */
export function hits(hit: string, x: number, y: number, slop = 3): boolean {
  const [kind, rest] = [hit.slice(0, 1), hit.slice(2)];
  const n = rest.split(",").map(Number);
  if (n.some((v) => !Number.isFinite(v))) return false;
  if (kind === "r") {
    const [rx, ry, w, h] = n as [number, number, number, number];
    const gx = Math.max(0, slop - w / 2);
    const gy = Math.max(0, slop - h / 2);
    return x >= rx - gx && x <= rx + w + gx && y >= ry - gy && y <= ry + h + gy;
  }
  if (kind === "c") {
    const [cx, cy, r] = n as [number, number, number];
    return Math.hypot(x - cx, y - cy) <= Math.max(r, slop + 2);
  }
  if (kind === "a") {
    const [cx, cy, r0, r1, a0, a1] = n as [number, number, number, number, number, number];
    const d = Math.hypot(x - cx, y - cy);
    if (d < r0 || d > r1) return false;
    const full = a1 - a0 >= Math.PI * 2 - 1e-6;
    if (full) return true;
    let a = Math.atan2(x - cx, -(y - cy));
    while (a < a0) a += Math.PI * 2;
    while (a >= a0 + Math.PI * 2) a -= Math.PI * 2;
    return a <= a1;
  }
  return false;
}

/** The marks a chart's drawing holds, in the order series then point. */
export function listMarks(svg: Element): MarkRef[] {
  const seen = new Set<string>();
  const out: MarkRef[] = [];
  for (const el of Array.from(svg.querySelectorAll("[data-mark]"))) {
    const id = el.getAttribute("data-mark") ?? "";
    const m = /^(\d+):(\d+)$/.exec(id);
    if (!m || seen.has(id)) continue;
    seen.add(id);
    out.push({ series: Number(m[1]), point: Number(m[2]) });
  }
  return out.sort((a, b) => a.series - b.series || a.point - b.point);
}

/** The mark at (x, y) in the chart's own pixels: the one drawn last (on top) when several are there. */
export function markAt(svg: Element, x: number, y: number): MarkRef | null {
  const els = Array.from(svg.querySelectorAll("[data-mark]"));
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i]!;
    const hit = el.getAttribute("data-hit");
    const m = /^(\d+):(\d+)$/.exec(el.getAttribute("data-mark") ?? "");
    if (hit && m && hits(hit, x, y)) return { series: Number(m[1]), point: Number(m[2]) };
  }
  return null;
}

/** The label of a trendline at (x, y), by series and trendline number. */
export function labelAt(svg: Element, x: number, y: number): { series: number; trend: number } | null {
  for (const el of Array.from(svg.querySelectorAll("[data-tlabel]")).reverse()) {
    const hit = el.getAttribute("data-hit");
    const m = /^(\d+):(\d+)$/.exec(el.getAttribute("data-tlabel") ?? "");
    if (hit && m && hits(hit, x, y, 2)) return { series: Number(m[1]), trend: Number(m[2]) };
  }
  return null;
}

/** The plot area of a 3-D chart, in the chart's own pixels (what a drag turns), or null for a flat chart. */
export function plot3dOf(svg: Element): { x: number; y: number; w: number; h: number } | null {
  const n = (svg.getAttribute("data-plot3d") ?? "").split(",").map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? { x: n[0]!, y: n[1]!, w: n[2]!, h: n[3]! } : null;
}

/** The mark an arrow key moves to: left and right along the series, up and down between series (at the same point if there is one, else the nearest). Stays put at an end. */
export function stepMark(marks: readonly MarkRef[], from: MarkRef, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): MarkRef {
  if (!marks.length) return from;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const row = marks.filter((m) => m.series === from.series);
    const at = row.findIndex((m) => m.point === from.point);
    const next = row[Math.max(0, Math.min(row.length - 1, (at < 0 ? 0 : at) + (key === "ArrowRight" ? 1 : -1)))];
    return next ?? from;
  }
  const seriesIds = [...new Set(marks.map((m) => m.series))].sort((a, b) => a - b);
  const at = seriesIds.indexOf(from.series);
  const toSeries = seriesIds[Math.max(0, Math.min(seriesIds.length - 1, (at < 0 ? 0 : at) + (key === "ArrowDown" ? 1 : -1)))];
  if (toSeries === undefined) return from;
  const row = marks.filter((m) => m.series === toSeries);
  return row.reduce((best, m) => (Math.abs(m.point - from.point) < Math.abs(best.point - from.point) ? m : best), row[0]!);
}

/** What to tell a screen reader about a picked mark: the series, the category and the value. */
export function describeMark(chart: Chart, data: ChartData, mark: MarkRef): string {
  const circular = chart.type === "pie" || chart.type === "doughnut" || chart.type === "pieOfPie" || chart.type === "barOfPie";
  const s = data.series[circular ? 0 : mark.series];
  const category = data.categories[mark.point] ?? `Point ${mark.point + 1}`;
  const v = s?.values[mark.point];
  const xy = s?.x?.[mark.point];
  return `${s?.name ?? `Series ${mark.series + 1}`}, ${xy !== undefined && chart.type !== "column" ? `x ${xy}` : category}${v === null || v === undefined ? "" : `: ${v}`}`;
}

/** The view a 3-D chart has after the pointer is dragged `dx` pixels across and `dy` down: across turns it, down tilts it. */
export function turnedView(view: ChartView3d, dx: number, dy: number): ChartView3d {
  const rotY = (((view.rotY + dx * 0.6) % 360) + 360) % 360;
  const rotX = Math.max(0, Math.min(90, view.rotX + dy * 0.4));
  return { ...view, rotX: Math.round(rotX), rotY: Math.round(rotY) };
}
