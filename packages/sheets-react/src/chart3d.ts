import { CHART_COLORS, DEFAULT_DEPTH, DEFAULT_PERSPECTIVE, defaultView3d, type Chart, type ChartData, type ChartView3d } from "@pli.dev/sheets";
import { fracOf, slicePoints, stackSeries, tickLabel, type Ticks } from "./chartmath";

/*
 * 3-D charts are drawn without a 3-D library: every mark is a prism (a flat shape pushed through some depth), turned
 * and tilted by the chart's view, projected onto the page, and painted far to near. Faces that look away from the viewer are
 * left out and each face is shaded by the way it points, so a column reads as a box without any lighting model.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}
type Pt = [number, number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What to paint, in order. */
export type Item =
  | { kind: "poly"; pts: Pt[]; fill: string; cls: string; title?: string; stroke?: string }
  | { kind: "line"; a: Pt; b: Pt; cls: string }
  | { kind: "text"; at: Pt; text: string; anchor: "start" | "middle" | "end"; cls: string };

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Turns a point about the vertical axis through `center` by `rotY` degrees, then tilts it towards the viewer by `rotX`.
 * `x` and `y` are where it lands (y up) and `d` is how far it is from the viewer: smaller is nearer. The scene starts
 * seen from the front, with larger `z` further back.
 */
export function projector(rotX: number, rotY: number, center: P3 = { x: 0, y: 0, z: 0 }, view?: Pick<ChartView3d, "perspective" | "rightAngle">) {
  const ca = Math.cos(rad(rotY));
  const sa = Math.sin(rad(rotY));
  const cb = Math.cos(rad(rotX));
  const sb = Math.sin(rad(rotX));
  // Perspective: the further a point is, the nearer the middle it lands. The camera stands back far enough for the angle of view to take in a scene about 300 across.
  const fov = view ? (view.perspective ?? DEFAULT_PERSPECTIVE) : 0;
  const camera = fov > 0 ? 150 / Math.tan(rad(Math.min(fov, 100)) / 2) : Infinity;
  // Right-angle axes: the front stays square on, and the depth goes off up and to the side.
  const sx = 0.6 * Math.sin(rad(rotY));
  const sy = 0.6 * Math.sin(rad(rotX));
  const turn = (x: number, y: number, z: number) => {
    if (view?.rightAngle) return { x: x + z * sx, y: y + z * sy, d: z };
    const z1 = -x * sa + z * ca;
    const d = z1 * cb - y * sb;
    const k = Number.isFinite(camera) ? camera / Math.max(camera * 0.2, camera + d) : 1;
    return { x: (x * ca + z * sa) * k, y: (y * cb + z1 * sb) * k, d };
  };
  return {
    point: (p: P3) => turn(p.x - center.x, p.y - center.y, p.z - center.z),
    /** A direction (a face's normal), which doesn't move with the centre; with perspective only its depth matters here, so it is turned without it. */
    direction: (v: P3) => {
      if (view?.rightAngle) return { x: 0, y: 0, d: -sx * v.x - sy * v.y + v.z };
      const z1 = -v.x * sa + v.z * ca;
      return { x: v.x * ca + v.z * sa, y: v.y * cb + z1 * sb, d: z1 * cb - v.y * sb };
    },
  };
}
export type Projector = ReturnType<typeof projector>;

export interface Face {
  pts: P3[];
  normal: P3;
}
export interface Solid {
  faces: Face[];
  /** The middle of the solid, to order solids by distance. */
  center: P3;
}

const signedArea = (poly: readonly Pt[]) => poly.reduce((s, p, i) => s + (p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1]), 0) / 2;

/**
 * A flat shape pushed through depth. `plane` says which plane the shape lies in: `xy` is pushed along z (a column seen
 * from the front), `xz` is pushed along y (a pie slice seen from above). The shape may wind either way.
 */
export function prism(poly: readonly Pt[], plane: "xy" | "xz", lo: number, hi: number): Solid {
  const at = (p: Pt, w: number): P3 => (plane === "xy" ? { x: p[0], y: p[1], z: w } : { x: p[0], y: w, z: p[1] });
  const dir = (u: number, v: number): P3 => (plane === "xy" ? { x: u, y: v, z: 0 } : { x: u, y: 0, z: v });
  const axis = (s: number): P3 => (plane === "xy" ? { x: 0, y: 0, z: s } : { x: 0, y: s, z: 0 });
  // Walk the shape the same way round whatever way it was given, so the sides' normals point out.
  const pts = signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
  const faces: Face[] = [
    { pts: pts.map((p) => at(p, lo)), normal: axis(-1) },
    { pts: pts.map((p) => at(p, hi)), normal: axis(1) },
  ];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const du = q[0] - p[0];
    const dv = q[1] - p[1];
    const len = Math.hypot(du, dv);
    if (len < 1e-9) return;
    faces.push({ pts: [at(p, lo), at(q, lo), at(q, hi), at(p, hi)], normal: dir(dv / len, -du / len) });
  });
  let cu = 0;
  let cv = 0;
  for (const p of pts) {
    cu += p[0] / pts.length;
    cv += p[1] / pts.length;
  }
  return { faces, center: at([cu, cv], (lo + hi) / 2) };
}

/** `#rrggbb` made lighter (`f` above 1) or darker (below 1). */
export function shade(hex: string, f: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = c.map((v) => Math.round(f >= 1 ? v + (255 - v) * Math.min(1, (f - 1) * 1.6) : v * f));
  return `#${out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/** How bright a face is, from the way it points before the view is applied: tops catch the light, right sides are in shadow. */
const light = (n: P3): number => (n.y > 0.5 ? 1.12 : n.y < -0.5 ? 0.7 : 0.95 - 0.17 * n.x - 0.06 * n.z);

interface Fit {
  /** A point of the scene, as a place on the page. */
  at(p: P3): Pt;
  d(p: P3): number;
  scale: number;
  proj: Projector;
}

/** Fits the scene's bounding box into `plot`, centred and keeping its shape. */
function fit(proj: Projector, corners: readonly P3[], plot: Box): Fit {
  const ps = corners.map((c) => proj.point(c));
  const minX = Math.min(...ps.map((p) => p.x));
  const maxX = Math.max(...ps.map((p) => p.x));
  const minY = Math.min(...ps.map((p) => -p.y));
  const maxY = Math.max(...ps.map((p) => -p.y));
  const scale = Math.min(plot.w / Math.max(1e-6, maxX - minX), plot.h / Math.max(1e-6, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    at: (p) => {
      const r = proj.point(p);
      return [plot.x + plot.w / 2 + (r.x - cx) * scale, plot.y + plot.h / 2 + (-r.y - cy) * scale];
    },
    d: (p) => proj.point(p).d,
    scale,
    proj,
  };
}

/** Paints a solid: the faces turned towards the viewer, each shaded by the way it points. */
function paint(out: Item[], s: Solid, f: Fit, color: string, title?: string): void {
  for (const face of s.faces) {
    if (f.proj.direction(face.normal).d >= -1e-6) continue; // turned away
    out.push({ kind: "poly", pts: face.pts.map(f.at), fill: shade(color, light(face.normal)), cls: "pli-chart-solid", ...(title ? { title } : {}) });
  }
}

const farToNear = <T extends { center: P3 }>(solids: T[], f: Fit): T[] => solids.slice().sort((a, b) => f.d(b.center) - f.d(a.center));

/** What a 3-D column, bar, line or area chart paints, inside `plot`. */
export function buildScene3d(chart: Chart, data: ChartData, plot: Box, ticks: Ticks, valueLabel: (v: number) => string): Item[] {
  const { rotX, rotY } = chart.view3d!;
  const horizontal = chart.type === "bar";
  const grouping = chart.grouping;
  // The box takes the shape of the room it is drawn in, a little less tall since depth and tilt add height.
  const SX = 300;
  const SY = Math.max(120, Math.min(260, (SX * plot.h) / Math.max(1, plot.w) * 0.85));
  const SZ = Math.min(SX, SY) * 0.5 * ((chart.view3d?.depth ?? DEFAULT_DEPTH) / 100);
  const n = Math.max(1, data.categories.length);
  const series = data.series;
  const valLen = horizontal ? SX : SY;
  const catLen = horizontal ? SY : SX;
  const vpos = (v: number) => {
    const f = fracOf(ticks, v);
    return (Number.isFinite(f) ? f : 0) * valLen;
  };
  const band = catLen / n;
  const center: P3 = { x: SX / 2, y: SY / 2, z: SZ / 2 };
  const corners: P3[] = [0, SX].flatMap((x) => [0, SY].flatMap((y) => [0, SZ].map((z) => ({ x, y, z }))));
  const f = fit(projector(rotX, rotY, center, chart.view3d), corners, plot);
  const items: Item[] = [];

  // ---- the box the chart stands in: floor and the walls seen from inside ----
  const walls: { id: string; pts: P3[]; normal: P3; floor?: boolean }[] = [
    { id: "floor", floor: true, normal: { x: 0, y: -1, z: 0 }, pts: [{ x: 0, y: 0, z: 0 }, { x: SX, y: 0, z: 0 }, { x: SX, y: 0, z: SZ }, { x: 0, y: 0, z: SZ }] },
    { id: "back", normal: { x: 0, y: 0, z: 1 }, pts: [{ x: 0, y: 0, z: SZ }, { x: SX, y: 0, z: SZ }, { x: SX, y: SY, z: SZ }, { x: 0, y: SY, z: SZ }] },
    { id: "front", normal: { x: 0, y: 0, z: -1 }, pts: [{ x: 0, y: 0, z: 0 }, { x: SX, y: 0, z: 0 }, { x: SX, y: SY, z: 0 }, { x: 0, y: SY, z: 0 }] },
    { id: "left", normal: { x: -1, y: 0, z: 0 }, pts: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: SZ }, { x: 0, y: SY, z: SZ }, { x: 0, y: SY, z: 0 }] },
    { id: "right", normal: { x: 1, y: 0, z: 0 }, pts: [{ x: SX, y: 0, z: 0 }, { x: SX, y: 0, z: SZ }, { x: SX, y: SY, z: SZ }, { x: SX, y: SY, z: 0 }] },
  ];
  for (const w of walls) {
    if (f.proj.direction(w.normal).d <= 1e-6) continue; // its outside faces us: it would hide the chart
    items.push({ kind: "poly", pts: w.pts.map(f.at), fill: "", cls: w.floor ? "pli-chart3d-floor" : "pli-chart3d-wall" });
    for (const t of ticks.ticks) {
      const p = vpos(t);
      let a: P3 | null = null;
      let b: P3 | null = null;
      if (!horizontal && w.id !== "floor") {
        [a, b] = w.id === "back" || w.id === "front" ? [{ x: 0, y: p, z: w.pts[0]!.z }, { x: SX, y: p, z: w.pts[0]!.z }] : [{ x: w.pts[0]!.x, y: p, z: 0 }, { x: w.pts[0]!.x, y: p, z: SZ }];
      } else if (horizontal && (w.id === "back" || w.id === "front")) {
        [a, b] = [{ x: p, y: 0, z: w.pts[0]!.z }, { x: p, y: SY, z: w.pts[0]!.z }];
      } else if (horizontal && w.floor) {
        [a, b] = [{ x: p, y: 0, z: 0 }, { x: p, y: 0, z: SZ }];
      }
      if (a && b) items.push({ kind: "line", a: f.at(a), b: f.at(b), cls: t === 0 ? "pli-chart-axis" : "pli-chart-grid" });
    }
  }

  // ---- the marks ----
  const solids: { solid: Solid; color: string; title: string }[] = [];
  const stacks = grouping ? stackSeries(series.map((s) => s.values), grouping === "percent") : null;
  const row = (i: number): [number, number] => {
    // Series that aren't piled up stand in rows one behind the other, as in Excel's 3-D line and area charts.
    if (grouping || chart.type === "column" || chart.type === "bar") return [SZ * 0.2, SZ * 0.8];
    const h = SZ / series.length;
    return [h * i + h * 0.15, h * (i + 1) - h * 0.15];
  };
  const catPos = (k: number) => (horizontal ? catLen - band * (k + 0.5) : band * (k + 0.5));
  const valueAt = (i: number, k: number): [number, number] | null => {
    const v = series[i]!.values[k];
    if (v === null || v === undefined) return null;
    return stacks ? stacks[i]![k]! : [0, v];
  };

  if (chart.type === "column" || chart.type === "bar") {
    const groupW = band * (grouping ? 0.6 : 0.7);
    const barW = grouping ? groupW : groupW / series.length;
    series.forEach((s, i) => {
      s.values.forEach((v, k) => {
        const span = valueAt(i, k);
        if (!span || v === null) return;
        const [lo, hi] = [vpos(Math.min(span[0], span[1])), vpos(Math.max(span[0], span[1]))];
        const along = band * k + (band - groupW) / 2 + (grouping ? 0 : barW * i);
        const rect: Pt[] = horizontal
          ? [[lo, catLen - along - barW], [hi, catLen - along - barW], [hi, catLen - along], [lo, catLen - along]]
          : [[along, lo], [along + barW, lo], [along + barW, hi], [along, hi]];
        const [z0, z1] = row(i);
        solids.push({ solid: prism(rect, "xy", z0, z1), color: s.pointColors?.[String(k)] ?? s.color, title: `${s.name}, ${data.categories[k]}: ${tickLabel(v)}` });
      });
    });
  } else {
    series.forEach((s, i) => {
      const [z0, z1] = row(i);
      const zRibbon: [number, number] = chart.type === "line" ? [z0 + (z1 - z0) * 0.3, z1 - (z1 - z0) * 0.3] : [z0, z1];
      const thick = SY * 0.035;
      for (let k = 0; k + 1 < n; k++) {
        const a = valueAt(i, k) ?? (chart.type === "area" ? [0, 0] : null);
        const b = valueAt(i, k + 1) ?? (chart.type === "area" ? [0, 0] : null);
        if (!a || !b) continue;
        const x0 = band * (k + 0.5);
        const x1 = band * (k + 1.5);
        const poly: Pt[] =
          chart.type === "area"
            ? [[x0, vpos(a[0])], [x1, vpos(b[0])], [x1, vpos(b[1])], [x0, vpos(a[1])]]
            : [[x0, vpos(a[1])], [x1, vpos(b[1])], [x1, vpos(b[1]) - thick], [x0, vpos(a[1]) - thick]];
        solids.push({ solid: prism(poly, "xy", zRibbon[0], zRibbon[1]), color: s.color, title: `${s.name}` });
      }
    });
  }
  // Each solid has its own centre; the ones further away are painted first.
  for (const m of farToNear(solids.map((s) => ({ ...s, center: s.solid.center })), f)) paint(items, m.solid, f, m.color, m.title);

  // ---- labels on the edges that face us ----
  const verticalEdges: [number, number][] = [[0, 0], [SX, 0], [0, SZ], [SX, SZ]];
  const [ex, ez] = verticalEdges.reduce((best, c) => (f.at({ x: c[0], y: 0, z: c[1] })[0] < f.at({ x: best[0], y: 0, z: best[1] })[0] ? c : best));
  const frontZ = f.at({ x: SX / 2, y: 0, z: 0 })[1] > f.at({ x: SX / 2, y: 0, z: SZ })[1] ? 0 : SZ;
  const everyOf = (spacing: number, longest: number) => Math.max(1, Math.ceil((Math.min(12, longest) * 6.2 + 6) / Math.max(1, spacing)));
  const labelEvery = everyOf(band * f.scale * (horizontal ? 0.12 : 1), Math.max(...data.categories.map((c) => c.length)));
  if (horizontal) {
    // Categories up the left edge, values along the front edge.
    data.categories.forEach((c, k) => {
      if (k % Math.max(1, Math.ceil(16 / (band * f.scale))) === 0) {
        const [x, y] = f.at({ x: ex, y: catPos(k), z: ez });
        items.push({ kind: "text", at: [x - 6, y + 4], text: c.length > 14 ? `${c.slice(0, 13)}…` : c, anchor: "end", cls: "pli-chart-label" });
      }
    });
    for (const t of ticks.ticks) {
      const [x, y] = f.at({ x: vpos(t), y: 0, z: frontZ });
      items.push({ kind: "text", at: [x, y + 15], text: valueLabel(t), anchor: "middle", cls: "pli-chart-label" });
    }
  } else {
    for (const t of ticks.ticks) {
      const [x, y] = f.at({ x: ex, y: vpos(t), z: ez });
      items.push({ kind: "text", at: [x - 6, y + 4], text: valueLabel(t), anchor: "end", cls: "pli-chart-label" });
    }
    data.categories.forEach((c, k) => {
      if (k % labelEvery) return;
      const [x, y] = f.at({ x: catPos(k), y: 0, z: frontZ });
      items.push({ kind: "text", at: [x, y + 15], text: c.length > 12 ? `${c.slice(0, 11)}…` : c, anchor: "middle", cls: "pli-chart-label" });
    });
  }
  return items;
}

/** What a 3-D pie paints: slices with thickness, seen from above at the chart's tilt, their outer walls first and then their tops. */
export function buildPie3d(chart: Chart, data: ChartData, frame: Box): Item[] {
  const { rotX, rotY } = chart.view3d!;
  const values = data.series[0]!.values.map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((a, b) => a + b, 0);
  const R = 100;
  const T = 24;
  const f = fit(projector(rotX, rotY, { x: 0, y: T / 2, z: 0 }, chart.view3d), [-R, R].flatMap((x) => [0, T].flatMap((y) => [-R, R].map((z) => ({ x, y, z })))), frame);
  const items: Item[] = [];
  if (!total) return items;
  const slices: { solid: Solid; color: string; title: string; center: P3; label: P3; share: number }[] = [];
  let a = 0;
  values.forEach((v, k) => {
    if (!v) return;
    const a1 = a + (v / total) * Math.PI * 2;
    const arc = slicePoints(R, a, a1);
    // A pie's top is flat and its centre is a corner of every slice, so the shape is the centre and the arc.
    const poly: Pt[] = a1 - a >= Math.PI * 2 - 1e-9 ? arc.slice(0, -1) : [[0, 0], ...arc];
    const mid = (a + a1) / 2;
    const solid = prism(poly, "xz", 0, T);
    slices.push({
      solid,
      color: data.series[0]?.pointColors?.[String(k)] ?? CHART_COLORS[k % CHART_COLORS.length]!,
      title: `${data.categories[k]}: ${tickLabel(v)} (${Math.round((v / total) * 1000) / 10}%)`,
      center: { x: (Math.sin(mid) * R) / 2, y: T / 2, z: (Math.cos(mid) * R) / 2 },
      label: { x: Math.sin(mid) * R * 0.65, y: T, z: Math.cos(mid) * R * 0.65 },
      share: v / total,
    });
    a = a1;
  });
  for (const s of farToNear(slices, f)) paint(items, s.solid, f, s.color, s.title);
  if (chart.labels) {
    for (const s of slices) {
      if (s.share <= 0.04) continue;
      const [x, y] = f.at(s.label);
      items.push({ kind: "text", at: [x, y + 4], text: `${Math.round(s.share * 1000) / 10}%`, anchor: "middle", cls: "pli-chart-onmark" });
    }
  }
  return items;
}

/** The colour bands of a surface chart: one for each step of the value axis, as Excel's surface charts colour them and list them in the legend. */
export function surfaceBands(ticks: Ticks): { name: string; color: string; from: number; to: number }[] {
  const out: { name: string; color: string; from: number; to: number }[] = [];
  for (let i = 0; i + 1 < ticks.ticks.length; i++) {
    const from = ticks.ticks[i]!;
    const to = ticks.ticks[i + 1]!;
    out.push({ name: `${tickLabel(from)}–${tickLabel(to)}`, color: CHART_COLORS[i % CHART_COLORS.length]!, from, to });
  }
  return out;
}

/**
 * What a surface chart paints: a mesh of quadrilaterals, one for each pair of neighbouring categories and neighbouring
 * series, coloured by the band its height falls in (or only outlined for a wireframe), seen from the chart's view. The
 * categories run along the front, the series back into the picture and the values upwards. Seen from straight above
 * (a tilt of 90°) it is Excel's contour chart.
 */
export function buildSurface3d(chart: Chart, data: ChartData, plot: Box, ticks: Ticks, valueLabel: (v: number) => string): Item[] {
  const { rotX, rotY } = chart.view3d ?? defaultView3d("surface");
  const SX = 300;
  const SY = Math.max(110, Math.min(220, (SX * plot.h) / Math.max(1, plot.w) * 0.8));
  const SZ = SX * 0.6;
  const n = data.categories.length;
  const rows = data.series.length;
  const xAt = (k: number) => (n > 1 ? (k / (n - 1)) * SX : SX / 2);
  const zAt = (i: number) => (rows > 1 ? (i / (rows - 1)) * SZ : SZ / 2);
  const yAt = (v: number) => ((v - ticks.min) / (ticks.max - ticks.min)) * SY;
  const center: P3 = { x: SX / 2, y: SY / 2, z: SZ / 2 };
  const corners: P3[] = [0, SX].flatMap((x) => [0, SY].flatMap((y) => [0, SZ].map((z) => ({ x, y, z }))));
  const f = fit(projector(rotX, rotY, center, chart.view3d), corners, plot);
  const items: Item[] = [];

  // The room: floor and the walls seen from inside, with gridlines at the value ticks.
  const walls: { id: string; pts: P3[]; normal: P3 }[] = [
    { id: "floor", normal: { x: 0, y: -1, z: 0 }, pts: [{ x: 0, y: 0, z: 0 }, { x: SX, y: 0, z: 0 }, { x: SX, y: 0, z: SZ }, { x: 0, y: 0, z: SZ }] },
    { id: "back", normal: { x: 0, y: 0, z: 1 }, pts: [{ x: 0, y: 0, z: SZ }, { x: SX, y: 0, z: SZ }, { x: SX, y: SY, z: SZ }, { x: 0, y: SY, z: SZ }] },
    { id: "front", normal: { x: 0, y: 0, z: -1 }, pts: [{ x: 0, y: 0, z: 0 }, { x: SX, y: 0, z: 0 }, { x: SX, y: SY, z: 0 }, { x: 0, y: SY, z: 0 }] },
    { id: "left", normal: { x: -1, y: 0, z: 0 }, pts: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: SZ }, { x: 0, y: SY, z: SZ }, { x: 0, y: SY, z: 0 }] },
    { id: "right", normal: { x: 1, y: 0, z: 0 }, pts: [{ x: SX, y: 0, z: 0 }, { x: SX, y: 0, z: SZ }, { x: SX, y: SY, z: SZ }, { x: SX, y: SY, z: 0 }] },
  ];
  for (const w of walls) {
    if (f.proj.direction(w.normal).d <= 1e-6) continue;
    items.push({ kind: "poly", pts: w.pts.map(f.at), fill: "", cls: w.id === "floor" ? "pli-chart3d-floor" : "pli-chart3d-wall" });
    if (w.id === "floor") continue;
    for (const t of ticks.ticks) {
      const y = yAt(t);
      const z = w.pts[0]!.z;
      const x = w.pts[0]!.x;
      const [a, b]: [P3, P3] = w.id === "back" || w.id === "front" ? [{ x: 0, y, z }, { x: SX, y, z }] : [{ x, y, z: 0 }, { x, y, z: SZ }];
      items.push({ kind: "line", a: f.at(a), b: f.at(b), cls: t === 0 ? "pli-chart-axis" : "pli-chart-grid" });
    }
  }

  const bands = surfaceBands(ticks);
  const at = (i: number, k: number): (P3 & { v: number }) | null => {
    const v = data.series[i]?.values[k];
    return v === null || v === undefined ? null : { x: xAt(k), y: yAt(v), z: zAt(i), v };
  };
  // Each pair of neighbouring categories and series is two triangles. A triangle is cut where the value crosses a step of the
  // axis, so that every piece lies in one band and the bands follow the lines of equal value, as in Excel's surface and contour charts.
  const pieces: { items: Item[]; center: P3 }[] = [];
  for (let i = 0; i + 1 < rows; i++) {
    for (let k = 0; k + 1 < n; k++) {
      const q = [at(i, k), at(i, k + 1), at(i + 1, k + 1), at(i + 1, k)];
      if (q.some((p) => p === null)) continue;
      const c = q as (P3 & { v: number })[];
      const quadTitle = (v: number) => `${data.categories[k]} to ${data.categories[k + 1]}, ${data.series[i]!.name} to ${data.series[i + 1]!.name}: ${tickLabel(v)}`;
      if (chart.wireframe) {
        const avg = c.reduce((sum, p) => sum + p.v, 0) / 4;
        pieces.push({ items: [{ kind: "poly", pts: c.map(f.at), fill: "none", cls: "pli-chart-wire", title: quadTitle(avg) }], center: { x: (c[0]!.x + c[2]!.x) / 2, y: (c[0]!.y + c[2]!.y) / 2, z: (c[0]!.z + c[2]!.z) / 2 } });
        continue;
      }
      for (const tri of [[c[0]!, c[1]!, c[2]!], [c[0]!, c[2]!, c[3]!]]) {
        const items: Item[] = [];
        const avg = tri.reduce((sum, p) => sum + p.v, 0) / 3;
        bands.forEach((band, bi) => {
          // Keep the part of the triangle with band.from <= value <= band.to (the first and last bands reach the ends of the axis).
          const lo = bi === 0 ? -Infinity : band.from;
          const hi = bi === bands.length - 1 ? Infinity : band.to;
          const poly = clipByValue(clipByValue(tri, lo, true), hi, false);
          if (poly.length < 3) return;
          items.push({ kind: "poly", pts: poly.map(f.at), fill: band.color, stroke: band.color, cls: "pli-chart-solid", title: quadTitle(avg) });
          // The edge where this piece meets the band below it is a contour line.
          if (bi > 0) {
            const edge = poly.filter((p) => Math.abs(p.v - band.from) < 1e-9 * Math.max(1, Math.abs(band.from)));
            if (edge.length === 2) items.push({ kind: "line", a: f.at(edge[0]!), b: f.at(edge[1]!), cls: "pli-chart-contour" });
          }
        });
        pieces.push({ items, center: { x: (tri[0].x + tri[1].x + tri[2].x) / 3, y: (tri[0].y + tri[1].y + tri[2].y) / 3, z: (tri[0].z + tri[1].z + tri[2].z) / 3 } });
      }
    }
  }
  for (const piece of farToNear(pieces, f)) items.push(...piece.items);

  // Value labels up the nearest left edge, categories along the front.
  const verticalEdges: [number, number][] = [[0, 0], [SX, 0], [0, SZ], [SX, SZ]];
  const [ex, ez] = verticalEdges.reduce((best, c) => (f.at({ x: c[0], y: 0, z: c[1] })[0] < f.at({ x: best[0], y: 0, z: best[1] })[0] ? c : best));
  for (const t of ticks.ticks) {
    const [x, y] = f.at({ x: ex, y: yAt(t), z: ez });
    items.push({ kind: "text", at: [x - 6, y + 4], text: valueLabel(t), anchor: "end", cls: "pli-chart-label" });
  }
  const frontZ = f.at({ x: SX / 2, y: 0, z: 0 })[1] > f.at({ x: SX / 2, y: 0, z: SZ })[1] ? 0 : SZ;
  const every = Math.max(1, Math.ceil((Math.min(12, Math.max(0, ...data.categories.map((c) => c.length))) * 6.2 + 6) / Math.max(1, (SX / Math.max(1, n)) * f.scale)));
  data.categories.forEach((c, k) => {
    if (k % every) return;
    const [x, y] = f.at({ x: xAt(k), y: 0, z: frontZ });
    items.push({ kind: "text", at: [x, y + 15], text: c.length > 12 ? `${c.slice(0, 11)}…` : c, anchor: "middle", cls: "pli-chart-label" });
  });
  // The series run back into the picture: their names stand along the bottom edge on the side opposite the value labels.
  const farX = ex === 0 ? SX : 0;
  const rightSide = f.at({ x: farX, y: 0, z: 0 })[0] >= f.at({ x: ex, y: 0, z: 0 })[0];
  const everySeries = Math.max(1, Math.ceil(14 / Math.max(1, (SZ / Math.max(1, rows)) * f.scale * 0.5)));
  data.series.forEach((sr, i) => {
    if (i % everySeries) return;
    const [x, y] = f.at({ x: farX, y: 0, z: zAt(i) });
    items.push({ kind: "text", at: [x + (rightSide ? 8 : -8), y + 4], text: sr.name.length > 12 ? `${sr.name.slice(0, 11)}…` : sr.name, anchor: rightSide ? "start" : "end", cls: "pli-chart-label" });
  });
  return items;
}

/** The part of a polygon (points with a value each) on one side of `limit`: values at or above it (`keepAbove`) or at or below it. Cut edges get a point at exactly the limit. */
function clipByValue<T extends P3 & { v: number }>(poly: readonly T[], limit: number, keepAbove: boolean): (P3 & { v: number })[] {
  if (!Number.isFinite(limit)) return poly.slice();
  const inside = (p: { v: number }) => (keepAbove ? p.v >= limit : p.v <= limit);
  const out: (P3 & { v: number })[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (limit - a.v) / (b.v - a.v);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, v: limit });
    }
  }
  return out;
}
