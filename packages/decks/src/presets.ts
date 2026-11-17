import type { PdfPathCommand } from "@pli.dev/docs";

/*
 * Preset geometries, by the names PowerPoint's file format gives them (`rect`, `roundRect`, `rightArrow`…), so that a
 * shape survives a round trip through PPTX. Each is drawn from the same guide formulas the OOXML preset definitions use
 * (adjustment values on a 0..100000 scale, angles in 60000ths of a degree), written as plain functions. Everything
 * here is pure: paths in points, origin top left, y down.
 *
 * Shading: a few presets (`cube`, `bevel`, `can`) draw faces lighter or darker than the fill. That is the `shade` of
 * a path; a renderer that doesn't know shading paints the plain fill and still gets the right outline.
 */

// ---- Public types ------------------------------------------------------------------------------------------------

export type PresetShade = "lighten" | "lightenLess" | "darken" | "darkenLess";

export interface PresetPath {
  /** SVG path data in points, origin top left (`M`, `L`, `C` and `Z` only). */
  d: string;
  /** Painted with the shape's fill. False for the open parts that are only stroked. */
  fill: boolean;
  /** Painted with the shape's line. */
  stroke: boolean;
  /** Fill by the even-odd rule (a donut's hole); nonzero otherwise. */
  evenOdd?: boolean;
  /** This face is lighter or darker than the fill. */
  shade?: PresetShade;
}

export interface PresetPdfPath {
  commands: PdfPathCommand[];
  fill: boolean;
  stroke: boolean;
  evenOdd: boolean;
  shade?: PresetShade;
}

export interface PresetGroup {
  label: string;
  shapes: { geometry: string; label: string }[];
}

// ---- Path building -----------------------------------------------------------------------------------------------

export type Cmd = readonly ["M", number, number] | readonly ["L", number, number] | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];

const RAD = Math.PI / 180;
const finite = (v: number): number => (Number.isFinite(v) ? v : 0);
const dv = (a: number, b: number): number => (b === 0 || !Number.isFinite(b) ? 0 : a / b);
const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

/** The parametric angle of an ellipse point that lies on the ray at a visual angle (degrees) from the centre. */
const visualToParam = (deg: number, rx: number, ry: number): number => Math.atan2(rx * Math.sin(deg * RAD), ry * Math.cos(deg * RAD));

/** The point on an ellipse at a visual angle (degrees). */
function ellipsePoint(cx: number, cy: number, rx: number, ry: number, deg: number): [number, number] {
  const t = visualToParam(deg, rx, ry);
  return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
}

export type Mapper = (x: number, y: number) => [number, number];

/** A path made of lines and cubic curves; arcs are turned into cubics as they are added. */
export class Path {
  cmds: Cmd[] = [];
  private x = 0;
  private y = 0;
  private sx = 0;
  private sy = 0;

  constructor(private readonly map?: Mapper) {}

  private pt(x: number, y: number): [number, number] {
    const p = this.map ? this.map(x, y) : [x, y];
    return [finite(p[0]), finite(p[1])];
  }

  M(x: number, y: number): this {
    const [a, b] = this.pt(x, y);
    this.cmds.push(["M", a, b]);
    this.x = this.sx = x;
    this.y = this.sy = y;
    return this;
  }

  L(x: number, y: number): this {
    const [a, b] = this.pt(x, y);
    this.cmds.push(["L", a, b]);
    this.x = x;
    this.y = y;
    return this;
  }

  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    const p1 = this.pt(x1, y1);
    const p2 = this.pt(x2, y2);
    const p = this.pt(x, y);
    this.cmds.push(["C", p1[0], p1[1], p2[0], p2[1], p[0], p[1]]);
    this.x = x;
    this.y = y;
    return this;
  }

  /** A quadratic curve, as the cubic that draws the same curve. */
  Q(cx: number, cy: number, x: number, y: number): this {
    const x0 = this.x;
    const y0 = this.y;
    return this.C(x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
  }

  Z(): this {
    this.cmds.push(["Z"]);
    this.x = this.sx;
    this.y = this.sy;
    return this;
  }

  /** An arc around a centre by parametric angle (radians, signed sweep), starting from the current point. */
  arc(cx: number, cy: number, rx: number, ry: number, t0: number, sweep: number): this {
    if (!(Math.abs(sweep) > 1e-9) || !(rx > 1e-9) || !(ry > 1e-9)) return this;
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const dt = sweep / n;
    const k = (4 / 3) * Math.tan(dt / 4);
    for (let i = 0; i < n; i++) {
      const a = t0 + i * dt;
      const b = a + dt;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      this.C(cx + rx * (ca - k * sa), cy + ry * (sa + k * ca), cx + rx * (cb + k * sb), cy + ry * (sb - k * cb), cx + rx * cb, cy + ry * sb);
    }
    return this;
  }

  /**
   * OOXML's `arcTo`: the current point lies on an ellipse of radii `wR` and `hR` at the (visual) angle `st` degrees,
   * and the arc sweeps `sw` degrees clockwise (negative: counterclockwise).
   */
  arcTo(wR: number, hR: number, st: number, sw: number): this {
    if (!(wR > 1e-9) || !(hR > 1e-9) || !Number.isFinite(st) || !Number.isFinite(sw) || sw === 0) return this;
    const t0 = visualToParam(st, wR, hR);
    let sweep: number;
    if (Math.abs(sw) >= 360) sweep = Math.sign(sw) * 2 * Math.PI;
    else {
      sweep = visualToParam(st + sw, wR, hR) - t0;
      if (sw > 0) while (sweep < 0) sweep += 2 * Math.PI;
      else while (sweep > 0) sweep -= 2 * Math.PI;
    }
    return this.arc(this.x - wR * Math.cos(t0), this.y - hR * Math.sin(t0), wR, hR, t0, sweep);
  }

  /** A closed ellipse, from its left point; `ccw` runs it the other way (for holes). */
  ellipse(cx: number, cy: number, rx: number, ry: number, ccw = false): this {
    if (!(rx > 1e-9) || !(ry > 1e-9)) return this;
    this.M(cx - rx, cy);
    this.arc(cx, cy, rx, ry, Math.PI, ccw ? -2 * Math.PI : 2 * Math.PI);
    return this.Z();
  }

  /** A closed polygon. */
  poly(points: readonly (readonly [number, number])[]): this {
    points.forEach(([x, y], i) => (i === 0 ? this.M(x, y) : this.L(x, y)));
    return this.Z();
  }

  /** A circular arc to (x, y) that bulges to the left of the way of travel by `k` times the chord (k below 0.5). */
  bulgeTo(x: number, y: number, k: number): this {
    const x0 = this.x;
    const y0 = this.y;
    const cx = x - x0;
    const cy = y - y0;
    const c = Math.hypot(cx, cy);
    const s = k * c;
    if (c < 1e-9 || s < 1e-9) return this.L(x, y);
    const R = (c * c / 4 + s * s) / (2 * s);
    const nx = cy / c;
    const ny = -cx / c;
    const mx = (x0 + x) / 2;
    const my = (y0 + y) / 2;
    const ox = mx + nx * (s - R);
    const oy = my + ny * (s - R);
    const t0 = Math.atan2(y0 - oy, x0 - ox);
    let sweep = Math.atan2(y - oy, x - ox) - t0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    return this.arc(ox, oy, R, R, t0, sweep);
  }
}

/** Points along a cubic, for finding where a curve really reaches. */
function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** The tight bounds of a path's drawing (curves sampled). */
function boundsOfCmds(cmds: readonly Cmd[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  let cx = 0;
  let cy = 0;
  for (const c of cmds) {
    if (c[0] === "M" || c[0] === "L") {
      add(c[1], c[2]);
      cx = c[1];
      cy = c[2];
    } else if (c[0] === "C") {
      for (let i = 1; i <= 24; i++) add(cubicAt(cx, c[1], c[3], c[5], i / 24), cubicAt(cy, c[2], c[4], c[6], i / 24));
      cx = c[5];
      cy = c[6];
    }
  }
  return x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0, y0, x1, y1 };
}

/** Stretches a path drawn in any coordinates so that its drawing exactly fills 0..w by 0..h. */
function fitTo(cmds: readonly Cmd[], w: number, h: number): Cmd[] {
  const b = boundsOfCmds(cmds);
  const sx = dv(w, b.x1 - b.x0);
  const sy = dv(h, b.y1 - b.y0);
  const fx = (x: number) => (x - b.x0) * sx;
  const fy = (y: number) => (y - b.y0) * sy;
  return cmds.map((c): Cmd => {
    if (c[0] === "M" || c[0] === "L") return [c[0], fx(c[1]), fy(c[2])];
    if (c[0] === "C") return ["C", fx(c[1]), fy(c[2]), fx(c[3]), fy(c[4]), fx(c[5]), fy(c[6])];
    return c;
  });
}

// ---- The definition format ---------------------------------------------------------------------------------------

/** What a shape's formulas get: the size and the (clamped) adjustment values. */
interface G {
  w: number;
  h: number;
  /** The shorter and the longer side. */
  ss: number;
  ls: number;
  hc: number;
  vc: number;
  wd2: number;
  hd2: number;
  /** An adjustment value, pinned between `lo` and `hi` (the OOXML `pin`). Default range 0..100000. */
  a(name: string, lo?: number, hi?: number): number;
}

interface Sub {
  path: Path | Cmd[];
  fill?: boolean;
  stroke?: boolean;
  evenOdd?: boolean;
  shade?: PresetShade;
}

type Rect4 = readonly [number, number, number, number];

interface Def {
  adj?: Record<string, number>;
  paths(g: G): Sub[];
  /** Text rectangle as left, top, right, bottom. Default: the whole box. */
  text?(g: G): Rect4;
}

const DEFS: Record<string, Def> = {};

/** The inset of the text rectangle for ellipse-like shapes (cos 45 degrees). */
const IDX = Math.cos(Math.PI / 4);

function makeG(w: number, h: number, defaults: Record<string, number>, adjust: Record<string, number> | undefined): G {
  w = Math.max(0, finite(w));
  h = Math.max(0, finite(h));
  return {
    w,
    h,
    ss: Math.min(w, h),
    ls: Math.max(w, h),
    hc: w / 2,
    vc: h / 2,
    wd2: w / 2,
    hd2: h / 2,
    a(name, lo = 0, hi = 100000) {
      const given = adjust?.[name];
      const v = typeof given === "number" && Number.isFinite(given) ? given : (defaults[name] ?? 0);
      return clamp(v, lo, Number.isFinite(hi) ? hi : 100000);
    },
  };
}

const rectPath = (x0: number, y0: number, x1: number, y1: number): Path => new Path().poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const full = (g: G): Rect4 => [0, 0, g.w, g.h];
const ellipseText = (g: G): Rect4 => [g.hc - g.wd2 * IDX, g.vc - g.hd2 * IDX, g.hc + g.wd2 * IDX, g.vc + g.hd2 * IDX];
const NO_LIMIT = 1e6;

// ---- Rectangles --------------------------------------------------------------------------------------------------

DEFS.rect = { paths: (g) => [{ path: rectPath(0, 0, g.w, g.h) }] };

DEFS.roundRect = {
  adj: { adj: 16667 },
  paths(g) {
    const r = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const { w, h } = g;
    const p = new Path().M(0, r).arcTo(r, r, 180, 90).L(w - r, 0).arcTo(r, r, 270, 90).L(w, h - r).arcTo(r, r, 0, 90).L(r, h).arcTo(r, r, 90, 90).Z();
    return [{ path: p }];
  },
  text(g) {
    const il = ((g.ss * g.a("adj", 0, 50000)) / 100000) * 0.29289;
    return [il, il, g.w - il, g.h - il];
  },
};

DEFS.round1Rect = {
  adj: { adj: 16667 },
  paths(g) {
    const r = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const { w, h } = g;
    return [{ path: new Path().M(0, 0).L(w - r, 0).arcTo(r, r, 270, 90).L(w, h).L(0, h).Z() }];
  },
  text(g) {
    const il = ((g.ss * g.a("adj", 0, 50000)) / 100000) * 0.29289;
    return [0, 0, g.w - il, g.h];
  },
};

DEFS.round2SameRect = {
  adj: { adj1: 16667, adj2: 0 },
  paths(g) {
    const r1 = (g.ss * g.a("adj1", 0, 50000)) / 100000;
    const r2 = (g.ss * g.a("adj2", 0, 50000)) / 100000;
    const { w, h } = g;
    return [{ path: new Path().M(r1, 0).L(w - r1, 0).arcTo(r1, r1, 270, 90).L(w, h - r2).arcTo(r2, r2, 0, 90).L(r2, h).arcTo(r2, r2, 90, 90).L(0, r1).arcTo(r1, r1, 180, 90).Z() }];
  },
  text(g) {
    const il = ((g.ss * Math.max(g.a("adj1", 0, 50000), g.a("adj2", 0, 50000))) / 100000) * 0.29289;
    return [il, il, g.w - il, g.h - il];
  },
};

DEFS.snip1Rect = {
  adj: { adj: 16667 },
  paths(g) {
    const d = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const { w, h } = g;
    return [{ path: new Path().poly([[0, 0], [w - d, 0], [w, d], [w, h], [0, h]]) }];
  },
  text(g) {
    const d = (g.ss * g.a("adj", 0, 50000)) / 100000;
    return [0, 0, g.w - d / 2, g.h];
  },
};

DEFS.snip2SameRect = {
  adj: { adj1: 16667, adj2: 0 },
  paths(g) {
    const d1 = (g.ss * g.a("adj1", 0, 50000)) / 100000;
    const d2 = (g.ss * g.a("adj2", 0, 50000)) / 100000;
    const { w, h } = g;
    return [{ path: new Path().poly([[d1, 0], [w - d1, 0], [w, d1], [w, h - d2], [w - d2, h], [d2, h], [0, h - d2], [0, d1]]) }];
  },
  text(g) {
    const i = (g.ss * Math.max(g.a("adj1", 0, 50000), g.a("adj2", 0, 50000))) / 200000;
    return [i, i, g.w - i, g.h - i];
  },
};

// ---- Basic shapes ------------------------------------------------------------------------------------------------

DEFS.ellipse = {
  paths: (g) => [{ path: new Path().ellipse(g.hc, g.vc, g.wd2, g.hd2) }],
  text: ellipseText,
};

DEFS.triangle = {
  adj: { adj: 50000 },
  paths(g) {
    const x2 = (g.w * g.a("adj")) / 100000;
    return [{ path: new Path().poly([[0, g.h], [x2, 0], [g.w, g.h]]) }];
  },
  text(g) {
    const x2 = (g.w * g.a("adj")) / 100000;
    return [x2 / 2, g.vc, x2 / 2 + g.hc, g.h];
  },
};

DEFS.rtTriangle = {
  paths: (g) => [{ path: new Path().poly([[0, g.h], [0, 0], [g.w, g.h]]) }],
  text: (g) => [g.w / 12, g.h / 2, (g.w * 5) / 12 + g.w / 12, g.h],
};

DEFS.diamond = {
  paths: (g) => [{ path: new Path().poly([[0, g.vc], [g.hc, 0], [g.w, g.vc], [g.hc, g.h]]) }],
  text: (g) => [g.w / 4, g.h / 4, (g.w * 3) / 4, (g.h * 3) / 4],
};

DEFS.parallelogram = {
  adj: { adj: 25000 },
  paths(g) {
    const x2 = (g.ss * g.a("adj", 0, dv(100000 * g.w, g.ss))) / 100000;
    return [{ path: new Path().poly([[0, g.h], [x2, 0], [g.w, 0], [g.w - x2, g.h]]) }];
  },
  text(g) {
    const x2 = (g.ss * g.a("adj", 0, dv(100000 * g.w, g.ss))) / 100000;
    return [x2 / 2, 0, g.w - x2 / 2, g.h];
  },
};

DEFS.trapezoid = {
  adj: { adj: 25000 },
  paths(g) {
    const x = (g.ss * g.a("adj", 0, dv(50000 * g.w, g.ss))) / 100000;
    return [{ path: new Path().poly([[0, g.h], [x, 0], [g.w - x, 0], [g.w, g.h]]) }];
  },
  text(g) {
    const m = dv(50000 * g.w, g.ss);
    const f = dv(g.a("adj", 0, m), m);
    const il = (g.w / 3) * f;
    const it = (g.h / 3) * f;
    return [il, it, g.w - il, g.h];
  },
};

/** The vertices of a regular polygon, normalised to fill the box (the OOXML hf/vf factors do the same). */
function regularPolygon(n: number, w: number, h: number): [number, number][] {
  const raw: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const t = (-90 + (360 * k) / n) * RAD;
    raw.push([Math.cos(t), Math.sin(t)]);
  }
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = dv(w, Math.max(...xs) - x0);
  const sy = dv(h, Math.max(...ys) - y0);
  return raw.map(([x, y]) => [(x - x0) * sx, (y - y0) * sy]);
}

DEFS.pentagon = {
  paths: (g) => [{ path: new Path().poly(regularPolygon(5, g.w, g.h)) }],
  text: (g) => [g.w * 0.2, g.h * 0.2, g.w * 0.8, g.h * 0.8],
};

DEFS.hexagon = {
  adj: { adj: 25000 },
  paths(g) {
    const x1 = (g.ss * g.a("adj", 0, dv(50000 * g.w, g.ss))) / 100000;
    return [{ path: new Path().poly([[0, g.vc], [x1, 0], [g.w - x1, 0], [g.w, g.vc], [g.w - x1, g.h], [x1, g.h]]) }];
  },
  text(g) {
    const x1 = (g.ss * g.a("adj", 0, dv(50000 * g.w, g.ss))) / 100000;
    return [x1 * 0.5, g.h * 0.1, g.w - x1 * 0.5, g.h * 0.9];
  },
};

DEFS.octagon = {
  adj: { adj: 29289 },
  paths(g) {
    const x1 = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const { w, h } = g;
    return [{ path: new Path().poly([[0, x1], [x1, 0], [w - x1, 0], [w, x1], [w, h - x1], [w - x1, h], [x1, h], [0, h - x1]]) }];
  },
  text(g) {
    const x1 = ((g.ss * g.a("adj", 0, 50000)) / 100000) / 2;
    return [x1, x1, g.w - x1, g.h - x1];
  },
};

DEFS.plus = {
  adj: { adj: 25000 },
  paths(g) {
    const x1 = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const { w, h } = g;
    return [{ path: new Path().poly([[0, x1], [x1, x1], [x1, 0], [w - x1, 0], [w - x1, x1], [w, x1], [w, h - x1], [w - x1, h - x1], [w - x1, h], [x1, h], [x1, h - x1], [0, h - x1]]) }];
  },
  text(g) {
    const x1 = (g.ss * g.a("adj", 0, 50000)) / 100000;
    return [x1, x1, g.w - x1, g.h - x1];
  },
};

// ---- Stars -------------------------------------------------------------------------------------------------------

/** A star with `n` points. `ratio` is the inner radius as a fraction of the outer one. */
function starPaths(g: G, n: number, ratio: number): { path: Path; text: Rect4 } {
  const outer: [number, number][] = [];
  const all: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const t = (-90 + (360 * k) / n) * RAD;
    const t2 = (-90 + (360 * (k + 0.5)) / n) * RAD;
    outer.push([Math.cos(t), Math.sin(t)]);
    all.push([Math.cos(t), Math.sin(t)], [ratio * Math.cos(t2), ratio * Math.sin(t2)]);
  }
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = dv(g.w, Math.max(...xs) - x0);
  const sy = dv(g.h, Math.max(...ys) - y0);
  const map = ([x, y]: readonly [number, number]): [number, number] => [(x - x0) * sx, (y - y0) * sy];
  const [l, t] = map([-ratio * IDX, -ratio * IDX]);
  const [r, b] = map([ratio * IDX, ratio * IDX]);
  return { path: new Path().poly(all.map(map)), text: [Math.min(l, r), Math.min(t, b), Math.max(l, r), Math.max(t, b)] };
}

const STARS: [string, number, number][] = [
  ["star4", 4, 12500],
  ["star5", 5, 19098],
  ["star6", 6, 28868],
  ["star7", 7, 34601],
  ["star8", 8, 37500],
  ["star10", 10, 42533],
  ["star12", 12, 37500],
  ["star16", 16, 37500],
  ["star24", 24, 37500],
];
for (const [name, n, adj] of STARS) {
  DEFS[name] = {
    adj: { adj },
    paths: (g) => [{ path: starPaths(g, n, g.a("adj", 0, 50000) / 50000).path }],
    text: (g) => starPaths(g, n, g.a("adj", 0, 50000) / 50000).text,
  };
}

// ---- Curvy shapes ------------------------------------------------------------------------------------------------

DEFS.heart = {
  paths(g) {
    const p = new Path()
      .M(50, 92)
      .C(20, 68, 2, 50, 2, 30)
      .C(2, 14, 14, 3, 28, 3)
      .C(38, 3, 46, 8, 50, 18)
      .C(54, 8, 62, 3, 72, 3)
      .C(86, 3, 98, 14, 98, 30)
      .C(98, 50, 80, 68, 50, 92)
      .Z();
    return [{ path: fitTo(p.cmds, g.w, g.h) }];
  },
  text: (g) => [g.w * 0.17, g.h * 0.12, g.w * 0.83, g.h * 0.62],
};

/** The cloud's outline: bumps between points that go around a squashed circle. */
function cloudCmds(): Cmd[] {
  const cusps = [100, 150, 200, 250, 298, 340, 20, 60];
  const pts = cusps.map((deg): [number, number] => [50 + 36 * Math.cos(deg * RAD), 52 + 30 * Math.sin(deg * RAD)]);
  const p = new Path().M(pts[0]![0], pts[0]![1]);
  for (let i = 1; i <= pts.length; i++) {
    const q = pts[i % pts.length]!;
    p.bulgeTo(q[0], q[1], 0.46);
  }
  p.Z();
  return p.cmds;
}

DEFS.cloud = {
  paths: (g) => [{ path: fitTo(cloudCmds(), g.w, g.h) }],
  text: (g) => [g.w * 0.14, g.h * 0.25, g.w * 0.86, g.h * 0.78],
};

DEFS.moon = {
  adj: { adj: 50000 },
  paths(g) {
    const rx = g.w * (1 - g.a("adj", 0, 87500) / 100000);
    const p = new Path().M(g.w, 0).arcTo(g.w, g.hd2, 270, -180);
    p.arcTo(Math.max(rx, 0), g.hd2, 90, 180).Z();
    return [{ path: p }];
  },
  text(g) {
    const rx = g.w * (1 - g.a("adj", 0, 87500) / 100000);
    return [g.w - rx + (rx * (1 - IDX)) / 2, g.h * 0.15, g.w * 0.95, g.h * 0.85];
  },
};

DEFS.sun = {
  adj: { adj: 25000 },
  paths(g) {
    const f = g.a("adj", 12500, 46875) / 100000;
    const rx = g.w * f;
    const ry = g.h * f;
    const rays = new Path();
    for (let k = 0; k < 8; k++) {
      const t = k * 45 * RAD;
      const tip: [number, number] = [g.hc + g.wd2 * Math.cos(t), g.vc + g.hd2 * Math.sin(t)];
      const b1: [number, number] = [g.hc + rx * Math.cos(t - 0.2), g.vc + ry * Math.sin(t - 0.2)];
      const b2: [number, number] = [g.hc + rx * Math.cos(t + 0.2), g.vc + ry * Math.sin(t + 0.2)];
      rays.poly([b1, tip, b2]);
    }
    return [{ path: rays }, { path: new Path().ellipse(g.hc, g.vc, rx, ry) }];
  },
  text(g) {
    const f = g.a("adj", 12500, 46875) / 100000;
    return [g.hc - g.w * f * IDX, g.vc - g.h * f * IDX, g.hc + g.w * f * IDX, g.vc + g.h * f * IDX];
  },
};

DEFS.smileyFace = {
  adj: { adj: 4653 },
  paths(g) {
    const a = g.a("adj", -4653, 4653);
    const { w, h } = g;
    const eye = (cx: number) => new Path().ellipse(cx, h * 0.37, w * 0.065, h * 0.075);
    const sag = (a / 4653) * h * 0.34;
    const mouth = new Path().M(w * 0.22, h * 0.64).Q(g.hc, h * 0.64 + sag, w * 0.78, h * 0.64);
    return [
      { path: new Path().ellipse(g.hc, g.vc, g.wd2, g.hd2) },
      { path: eye(w * 0.34), stroke: false, shade: "darkenLess" },
      { path: eye(w * 0.66), stroke: false, shade: "darkenLess" },
      { path: mouth, fill: false },
    ];
  },
  text: ellipseText,
};

DEFS.lightningBolt = {
  paths(g) {
    const pts: [number, number][] = [[8472, 0], [12860, 6080], [11050, 6797], [16577, 12007], [14767, 12877], [21600, 21600], [10012, 14915], [12222, 13987], [5022, 9705], [7602, 8382], [0, 3890]];
    return [{ path: new Path().poly(pts.map(([x, y]) => [(x * g.w) / 21600, (y * g.h) / 21600])) }];
  },
  text: (g) => [(g.w * 8200) / 21600, (g.h * 7500) / 21600, (g.w * 15200) / 21600, (g.h * 14000) / 21600],
};

DEFS.donut = {
  adj: { adj: 25000 },
  paths(g) {
    const dr = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const p = new Path().ellipse(g.hc, g.vc, g.wd2, g.hd2).ellipse(g.hc, g.vc, g.wd2 - dr, g.hd2 - dr, true);
    return [{ path: p, evenOdd: true }];
  },
  text: ellipseText,
};

DEFS.noSmoking = {
  adj: { adj: 18750 },
  paths(g) {
    const dr = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const irx = Math.max(0, g.wd2 - dr);
    const iry = Math.max(0, g.hd2 - dr);
    const ring = new Path().ellipse(g.hc, g.vc, g.wd2, g.hd2).ellipse(g.hc, g.vc, irx, iry, true);
    // The slash: a strip as wide as the ring, from upper left to lower right, cut off by the inner circle (drawn on the unit circle, then stretched).
    const rho = clamp(dv(dr, Math.min(g.wd2, g.hd2) - dr || 1), 0, 0.99);
    const s = Math.sqrt(1 - rho * rho);
    const d = Math.SQRT1_2;
    // corners in the strip's own axes: n = (1,-1)/sqrt2 across, d = (1,1)/sqrt2 along
    const corner = (across: number, along: number): [number, number] => [g.hc + irx * (across * d + along * d), g.vc + iry * (-across * d + along * d)];
    const c1 = corner(rho, -s);
    const c2 = corner(rho, s);
    const c3 = corner(-rho, s);
    const c4 = corner(-rho, -s);
    const ang = (c: [number, number]) => Math.atan2((c[1] - g.vc) / (iry || 1), (c[0] - g.hc) / (irx || 1));
    const arcBetween = (p: Path, from: [number, number], to: [number, number]) => {
      const t0 = ang(from);
      let sweep = ang(to) - t0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      p.arc(g.hc, g.vc, irx, iry, t0, sweep);
    };
    const bar = new Path().M(c1[0], c1[1]).L(c2[0], c2[1]);
    arcBetween(bar, c2, c3);
    bar.L(c4[0], c4[1]);
    arcBetween(bar, c4, c1);
    bar.Z();
    return [{ path: ring, evenOdd: true }, { path: bar }];
  },
  text: ellipseText,
};

// ---- Arcs and wedges ---------------------------------------------------------------------------------------------

function sweepOf(st: number, en: number): number {
  const sw = en - st;
  return sw > 0 ? sw : sw + 360;
}

DEFS.blockArc = {
  adj: { adj1: 10800000, adj2: 0, adj3: 25000 },
  paths(g) {
    const st = g.a("adj1", 0, 21599999) / 60000;
    const en = g.a("adj2", 0, 21599999) / 60000;
    const sw = sweepOf(st, en);
    const dr = (g.ss * g.a("adj3", 0, 50000)) / 100000;
    const iw = Math.max(0, g.wd2 - dr);
    const ih = Math.max(0, g.hd2 - dr);
    const [sx, sy] = ellipsePoint(g.hc, g.vc, g.wd2, g.hd2, st);
    const [ex, ey] = ellipsePoint(g.hc, g.vc, iw, ih, en);
    const p = new Path().M(sx, sy).arcTo(g.wd2, g.hd2, st, sw).L(ex, ey).arcTo(iw, ih, en, -sw).Z();
    return [{ path: p }];
  },
};

DEFS.arc = {
  adj: { adj1: 16200000, adj2: 0 },
  paths(g) {
    const st = g.a("adj1", 0, 21599999) / 60000;
    const en = g.a("adj2", 0, 21599999) / 60000;
    const sw = sweepOf(st, en);
    const [sx, sy] = ellipsePoint(g.hc, g.vc, g.wd2, g.hd2, st);
    const wedge = new Path().M(sx, sy).arcTo(g.wd2, g.hd2, st, sw).L(g.hc, g.vc).Z();
    const line = new Path().M(sx, sy).arcTo(g.wd2, g.hd2, st, sw);
    return [{ path: wedge, stroke: false }, { path: line, fill: false }];
  },
};

DEFS.chord = {
  adj: { adj1: 2700000, adj2: 16200000 },
  paths(g) {
    const st = g.a("adj1", 0, 21599999) / 60000;
    const en = g.a("adj2", 0, 21599999) / 60000;
    const [sx, sy] = ellipsePoint(g.hc, g.vc, g.wd2, g.hd2, st);
    return [{ path: new Path().M(sx, sy).arcTo(g.wd2, g.hd2, st, sweepOf(st, en)).Z() }];
  },
  text: ellipseText,
};

DEFS.pie = {
  adj: { adj1: 0, adj2: 16200000 },
  paths(g) {
    const st = g.a("adj1", 0, 21599999) / 60000;
    const en = g.a("adj2", 0, 21599999) / 60000;
    const [sx, sy] = ellipsePoint(g.hc, g.vc, g.wd2, g.hd2, st);
    return [{ path: new Path().M(sx, sy).arcTo(g.wd2, g.hd2, st, sweepOf(st, en)).L(g.hc, g.vc).Z() }];
  },
  text: ellipseText,
};

DEFS.can = {
  adj: { adj: 25000 },
  paths(g) {
    const y1 = (g.ss * g.a("adj", 0, dv(50000 * g.h, g.ss))) / 200000;
    const y3 = g.h - y1;
    const body = new Path().M(0, y1).arcTo(g.wd2, y1, 180, 180).L(g.w, y3).arcTo(g.wd2, y1, 0, 180).Z();
    const lid = new Path().ellipse(g.hc, y1, g.wd2, y1);
    const outline = new Path().M(0, y1).arcTo(g.wd2, y1, 180, 180).L(g.w, y3).arcTo(g.wd2, y1, 0, 180).Z().M(0, y1).arcTo(g.wd2, y1, 180, -180);
    return [{ path: body, stroke: false }, { path: lid, stroke: false, shade: "lighten" }, { path: outline, fill: false }];
  },
  text(g) {
    const y1 = (g.ss * g.a("adj", 0, dv(50000 * g.h, g.ss))) / 200000;
    return [0, 2 * y1, g.w, g.h - y1];
  },
};

DEFS.cube = {
  adj: { adj: 25000 },
  paths(g) {
    const y1 = (g.ss * g.a("adj")) / 100000;
    const { w, h } = g;
    const x4 = w - y1;
    const y4 = h - y1;
    return [
      { path: rectPath(0, y1, x4, h), stroke: false },
      { path: new Path().poly([[y1, 0], [w, 0], [x4, y1], [0, y1]]), stroke: false, shade: "lightenLess" },
      { path: new Path().poly([[x4, y1], [w, 0], [w, y4], [x4, h]]), stroke: false, shade: "darkenLess" },
      { path: new Path().M(0, y1).L(y1, 0).L(w, 0).L(w, y4).L(x4, h).L(0, h).Z().M(0, y1).L(x4, y1).L(w, 0).M(x4, y1).L(x4, h), fill: false },
    ];
  },
  text(g) {
    const y1 = (g.ss * g.a("adj")) / 100000;
    return [0, y1, g.w - y1, g.h];
  },
};

DEFS.bevel = {
  adj: { adj: 12500 },
  paths(g) {
    const x1 = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const { w, h } = g;
    const x2 = w - x1;
    const y2 = h - x1;
    return [
      { path: rectPath(x1, x1, x2, y2), stroke: false },
      { path: new Path().poly([[0, 0], [w, 0], [x2, x1], [x1, x1]]), stroke: false, shade: "lightenLess" },
      { path: new Path().poly([[0, 0], [x1, x1], [x1, y2], [0, h]]), stroke: false, shade: "lighten" },
      { path: new Path().poly([[w, 0], [w, h], [x2, y2], [x2, x1]]), stroke: false, shade: "darkenLess" },
      { path: new Path().poly([[0, h], [x1, y2], [x2, y2], [w, h]]), stroke: false, shade: "darken" },
      { path: new Path().poly([[0, 0], [w, 0], [w, h], [0, h]]).poly([[x1, x1], [x2, x1], [x2, y2], [x1, y2]]).M(0, 0).L(x1, x1).M(w, 0).L(x2, x1).M(w, h).L(x2, y2).M(0, h).L(x1, y2), fill: false },
    ];
  },
  text(g) {
    const x1 = (g.ss * g.a("adj", 0, 50000)) / 100000;
    return [x1, x1, g.w - x1, g.h - x1];
  },
};

DEFS.frame = {
  adj: { adj1: 12500 },
  paths(g) {
    const x1 = (g.ss * g.a("adj1", 0, 50000)) / 100000;
    const p = new Path().poly([[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]]).poly([[x1, x1], [x1, g.h - x1], [g.w - x1, g.h - x1], [g.w - x1, x1]]);
    return [{ path: p, evenOdd: true }];
  },
  text(g) {
    const x1 = (g.ss * g.a("adj1", 0, 50000)) / 100000;
    return [x1, x1, g.w - x1, g.h - x1];
  },
};

DEFS.halfFrame = {
  adj: { adj1: 33333, adj2: 33333 },
  paths(g) {
    const y1 = (g.ss * g.a("adj1", 0, dv(100000 * g.h, g.ss))) / 100000;
    const x1 = (g.ss * g.a("adj2", 0, dv(100000 * g.w, g.ss))) / 100000;
    const { w, h } = g;
    const dx = Math.min(Math.max(0, w - x1), dv(y1 * w, h));
    const dy = Math.min(Math.max(0, h - y1), dv(x1 * h, w));
    return [{ path: new Path().poly([[0, 0], [w, 0], [w - dx, y1], [x1, y1], [x1, h - dy], [0, h]]) }];
  },
  text(g) {
    const y1 = (g.ss * g.a("adj1", 0, dv(100000 * g.h, g.ss))) / 100000;
    const x1 = (g.ss * g.a("adj2", 0, dv(100000 * g.w, g.ss))) / 100000;
    return [x1, y1, g.w, g.h];
  },
};

DEFS.corner = {
  adj: { adj1: 50000, adj2: 50000 },
  paths(g) {
    const t = (g.ss * g.a("adj1", 0, dv(100000 * g.h, g.ss))) / 100000;
    const x1 = (g.ss * g.a("adj2", 0, dv(100000 * g.w, g.ss))) / 100000;
    return [{ path: new Path().poly([[0, 0], [x1, 0], [x1, g.h - t], [g.w, g.h - t], [g.w, g.h], [0, g.h]]) }];
  },
  text(g) {
    const t = (g.ss * g.a("adj1", 0, dv(100000 * g.h, g.ss))) / 100000;
    return [0, g.h - t, g.w, g.h];
  },
};

// ---- Arrows ------------------------------------------------------------------------------------------------------

type Dir = "right" | "left" | "up" | "down";

/** Maps a shape drawn pointing right, in a frame of length `lw` along the arrow and `lh` across, into the box. */
function orient(dir: Dir, w: number, h: number): { lw: number; lh: number; map: Mapper } {
  switch (dir) {
    case "right": return { lw: w, lh: h, map: (x, y) => [x, y] };
    case "left": return { lw: w, lh: h, map: (x, y) => [w - x, y] };
    case "up": return { lw: h, lh: w, map: (x, y) => [y, h - x] };
    case "down": return { lw: h, lh: w, map: (x, y) => [y, x] };
  }
}

/** A text rectangle given in the arrow's own frame, as a box rectangle. */
function mapRect(map: Mapper, l: number, t: number, r: number, b: number): Rect4 {
  const p = map(l, t);
  const q = map(r, b);
  return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
}

function arrowGeometry(g: G, dir: Dir) {
  const { lw, lh, map } = orient(dir, g.w, g.h);
  const ss = g.ss;
  const a1 = g.a("adj1");
  const a2 = g.a("adj2", 0, dv(100000 * lw, ss));
  const dx1 = (ss * a2) / 100000;
  const x1 = lw - dx1;
  const dy1 = (lh * a1) / 200000;
  const y1 = lh / 2 - dy1;
  const y2 = lh / 2 + dy1;
  const dx2 = dv(y1 * dx1, lh / 2);
  const x2 = x1 + dx2;
  const p = new Path(map).poly([[0, y1], [x1, y1], [x1, 0], [lw, lh / 2], [x1, lh], [x1, y2], [0, y2]]);
  return { path: p, text: mapRect(map, 0, y1, x2, y2) };
}

const ARROWS: [string, Dir][] = [["rightArrow", "right"], ["leftArrow", "left"], ["upArrow", "up"], ["downArrow", "down"]];
for (const [name, dir] of ARROWS) {
  DEFS[name] = {
    adj: { adj1: 50000, adj2: 50000 },
    paths: (g) => [{ path: arrowGeometry(g, dir).path }],
    text: (g) => arrowGeometry(g, dir).text,
  };
}

function doubleArrow(g: G, horizontal: boolean) {
  const { lw, lh, map } = horizontal ? orient("right", g.w, g.h) : { lw: g.h, lh: g.w, map: ((x, y) => [y, x]) as Mapper };
  const x2 = (g.ss * g.a("adj2", 0, dv(50000 * lw, g.ss))) / 100000;
  const x3 = lw - x2;
  const dy1 = (lh * g.a("adj1")) / 200000;
  const y1 = lh / 2 - dy1;
  const y2 = lh / 2 + dy1;
  const dx1 = dv(y1 * x2, lh / 2);
  const p = new Path(map).poly([[0, lh / 2], [x2, 0], [x2, y1], [x3, y1], [x3, 0], [lw, lh / 2], [x3, lh], [x3, y2], [x2, lh], [x2, y2]]);
  return { path: p, text: mapRect(map, x2 - dx1, y1, x3 + dx1, y2) };
}

DEFS.leftRightArrow = { adj: { adj1: 50000, adj2: 50000 }, paths: (g) => [{ path: doubleArrow(g, true).path }], text: (g) => doubleArrow(g, true).text };
DEFS.upDownArrow = { adj: { adj1: 50000, adj2: 50000 }, paths: (g) => [{ path: doubleArrow(g, false).path }], text: (g) => doubleArrow(g, false).text };

DEFS.bentArrow = {
  adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 43750 },
  paths(g) {
    const { w, h, ss } = g;
    const a2 = g.a("adj2", 0, 50000);
    const a1 = g.a("adj1", 0, a2 * 2);
    const a3 = g.a("adj3", 0, 50000);
    const th = (ss * a1) / 100000;
    const aw2 = (ss * a2) / 100000;
    const th2 = th / 2;
    const dh2 = aw2 - th2;
    const ah = (ss * a3) / 100000;
    const bw = w - ah;
    const bh = h - dh2;
    const bs = Math.min(bw, bh);
    const a4 = g.a("adj4", 0, dv(100000 * bs, ss));
    const bd = (ss * a4) / 100000;
    const bd2 = Math.max(bd - th, 0);
    const x3 = th + bd2;
    const x4 = w - ah;
    const y3 = dh2 + th;
    const y4 = y3 + dh2;
    const y5 = dh2 + bd;
    const p = new Path().M(0, h).L(0, y5).arcTo(bd, bd, 180, 90).L(x4, dh2).L(x4, 0).L(w, aw2).L(x4, y4).L(x4, y3).L(x3, y3).arcTo(bd2, bd2, 270, -90).L(th, h).Z();
    return [{ path: p }];
  },
};

DEFS.uturnArrow = {
  adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 43750, adj5: 75000 },
  paths(g) {
    const { w, h, ss } = g;
    const a2 = g.a("adj2", 0, 25000);
    const a1 = g.a("adj1", 0, a2 * 2);
    const q2 = dv(a1 * ss, h);
    const q3 = 100000 - q2;
    const a3 = g.a("adj3", 0, dv(q3 * h, ss));
    const q1 = a3 + a1;
    const minA5 = dv(q1 * ss, h);
    const a5 = g.a("adj5", minA5, 100000);
    const th = (ss * a1) / 100000;
    const aw2 = (ss * a2) / 100000;
    const th2 = th / 2;
    const dh2 = aw2 - th2;
    const y5 = (h * a5) / 100000;
    const ah = (ss * a3) / 100000;
    const y4 = y5 - ah;
    const x9 = w - dh2;
    const bw = x9 / 2;
    const bs = Math.min(bw, y4);
    const a4 = g.a("adj4", 0, dv(100000 * bs, ss));
    const bd = (ss * a4) / 100000;
    const bd2 = Math.max(bd - th, 0);
    const x3 = th + bd2;
    const x8 = w - aw2;
    const x6 = x8 - aw2;
    const x7 = x6 + dh2;
    const x4 = x9 - bd;
    const p = new Path()
      .M(0, h)
      .L(0, bd)
      .arcTo(bd, bd, 180, 90)
      .L(x4, 0)
      .arcTo(bd, bd, 270, 90)
      .L(x9, y4)
      .L(w, y4)
      .L(x8, y5)
      .L(x6, y4)
      .L(x7, y4)
      .L(x7, x3)
      .arcTo(bd2, bd2, 0, -90)
      .L(x3, th)
      .arcTo(bd2, bd2, 270, -90)
      .L(th, h)
      .Z();
    return [{ path: p }];
  },
};

DEFS.chevron = {
  adj: { adj: 50000 },
  paths(g) {
    const x1 = (g.ss * g.a("adj", 0, dv(100000 * g.w, g.ss))) / 100000;
    const x2 = g.w - x1;
    return [{ path: new Path().poly([[0, 0], [x2, 0], [g.w, g.vc], [x2, g.h], [0, g.h], [x1, g.vc]]) }];
  },
  text(g) {
    const x1 = (g.ss * g.a("adj", 0, dv(100000 * g.w, g.ss))) / 100000;
    const x2 = g.w - x1;
    return x2 > x1 ? [x1, 0, x2, g.h] : [0, 0, g.w, g.h];
  },
};

DEFS.homePlate = {
  adj: { adj: 50000 },
  paths(g) {
    const x1 = g.w - (g.ss * g.a("adj", 0, dv(100000 * g.w, g.ss))) / 100000;
    return [{ path: new Path().poly([[0, 0], [x1, 0], [g.w, g.vc], [x1, g.h], [0, g.h]]) }];
  },
  text(g) {
    const x1 = g.w - (g.ss * g.a("adj", 0, dv(100000 * g.w, g.ss))) / 100000;
    return [0, 0, (x1 + g.w) / 2, g.h];
  },
};

DEFS.notchedRightArrow = {
  adj: { adj1: 50000, adj2: 50000 },
  paths(g) {
    const dx2 = (g.ss * g.a("adj2", 0, dv(100000 * g.w, g.ss))) / 100000;
    const x2 = g.w - dx2;
    const dy1 = (g.h * g.a("adj1")) / 200000;
    const y1 = g.vc - dy1;
    const y2 = g.vc + dy1;
    const nx = Math.min(dy1, x2);
    return [{ path: new Path().poly([[0, y1], [x2, y1], [x2, 0], [g.w, g.vc], [x2, g.h], [x2, y2], [0, y2], [nx, g.vc]]) }];
  },
  text(g) {
    const dx2 = (g.ss * g.a("adj2", 0, dv(100000 * g.w, g.ss))) / 100000;
    const dy1 = (g.h * g.a("adj1")) / 200000;
    const x2 = g.w - dx2;
    return [Math.min(dy1, x2), g.vc - dy1, x2 + dv((g.vc - dy1) * dx2, g.hd2), g.vc + dy1];
  },
};

DEFS.stripedRightArrow = {
  adj: { adj1: 50000, adj2: 50000 },
  paths(g) {
    const a2 = g.a("adj2", 0, dv(84375 * g.w, g.ss));
    const dx2 = (g.ss * a2) / 100000;
    const x2 = g.w - dx2;
    const dy1 = (g.h * g.a("adj1")) / 200000;
    const y1 = g.vc - dy1;
    const y2 = g.vc + dy1;
    const u = g.ss / 32;
    const head = new Path().poly([[5 * u, y1], [x2, y1], [x2, 0], [g.w, g.vc], [x2, g.h], [x2, y2], [5 * u, y2]]);
    return [{ path: rectPath(0, y1, u, y2) }, { path: rectPath(2 * u, y1, 3 * u, y2) }, { path: head }];
  },
  text(g) {
    const dx2 = (g.ss * g.a("adj2", 0, dv(84375 * g.w, g.ss))) / 100000;
    const dy1 = (g.h * g.a("adj1")) / 200000;
    const x2 = g.w - dx2;
    return [(g.ss * 5) / 32, g.vc - dy1, x2 + dv((g.vc - dy1) * dx2, g.hd2), g.vc + dy1];
  },
};

DEFS.rightArrowCallout = {
  adj: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
  paths(g) {
    const { w, h, ss, vc } = g;
    const a2 = g.a("adj2", 0, dv(50000 * h, ss));
    const a1 = g.a("adj1", 0, a2 * 2);
    const a3 = g.a("adj3", 0, dv(100000 * w, ss));
    const q2 = dv(a3 * ss, w);
    const a4 = g.a("adj4", 0, 100000 - q2);
    const dy1 = (ss * a2) / 100000;
    const dy2 = (ss * a1) / 200000;
    const x3 = w - (ss * a3) / 100000;
    const x2 = (w * a4) / 100000;
    const y1 = vc - dy1;
    const y2 = vc - dy2;
    const y3 = vc + dy2;
    const y4 = vc + dy1;
    return [{ path: new Path().poly([[0, 0], [x2, 0], [x2, y2], [x3, y2], [x3, y1], [w, vc], [x3, y4], [x3, y3], [x2, y3], [x2, h], [0, h]]) }];
  },
  text(g) {
    const q2 = dv(g.a("adj3", 0, dv(100000 * g.w, g.ss)) * g.ss, g.w);
    return [0, 0, (g.w * g.a("adj4", 0, 100000 - q2)) / 100000, g.h];
  },
};

// ---- Callouts ----------------------------------------------------------------------------------------------------

function wedgeInfo(g: G) {
  const dxPos = (g.w * g.a("adj1", -NO_LIMIT, NO_LIMIT)) / 100000;
  const dyPos = (g.h * g.a("adj2", -NO_LIMIT, NO_LIMIT)) / 100000;
  const xPos = g.hc + dxPos;
  const yPos = g.vc + dyPos;
  const dq = dv(dxPos * g.h, g.w);
  const dz = Math.abs(dyPos) - Math.abs(dq);
  const [xg1, xg2] = dxPos > 0 ? [7, 10] : [2, 5];
  const [yg1, yg2] = dyPos > 0 ? [7, 10] : [2, 5];
  const vertical = dz > 0;
  return {
    xPos,
    yPos,
    x1: (g.w * xg1) / 12,
    x2: (g.w * xg2) / 12,
    y1: (g.h * yg1) / 12,
    y2: (g.h * yg2) / 12,
    top: vertical && dyPos < 0,
    bottom: vertical && dyPos > 0,
    left: !vertical && dxPos < 0,
    right: !vertical && dxPos > 0,
  };
}

DEFS.wedgeRectCallout = {
  adj: { adj1: -20833, adj2: 62500 },
  paths(g) {
    const i = wedgeInfo(g);
    const { w, h } = g;
    const p = new Path().M(0, 0).L(i.x1, 0);
    if (i.top) p.L(i.xPos, i.yPos);
    p.L(i.x2, 0).L(w, 0).L(w, i.y1);
    if (i.right) p.L(i.xPos, i.yPos);
    p.L(w, i.y2).L(w, h).L(i.x2, h);
    if (i.bottom) p.L(i.xPos, i.yPos);
    p.L(i.x1, h).L(0, h).L(0, i.y2);
    if (i.left) p.L(i.xPos, i.yPos);
    p.L(0, i.y1).Z();
    return [{ path: p }];
  },
};

DEFS.wedgeRoundRectCallout = {
  adj: { adj1: -20833, adj2: 62500, adj3: 16667 },
  paths(g) {
    const i = wedgeInfo(g);
    const { w, h } = g;
    const u = (g.ss * g.a("adj3", 0, 50000)) / 100000;
    const p = new Path().M(0, u).arcTo(u, u, 180, 90).L(i.x1, 0);
    if (i.top) p.L(i.xPos, i.yPos);
    p.L(i.x2, 0).L(w - u, 0).arcTo(u, u, 270, 90).L(w, i.y1);
    if (i.right) p.L(i.xPos, i.yPos);
    p.L(w, i.y2).L(w, h - u).arcTo(u, u, 0, 90).L(i.x2, h);
    if (i.bottom) p.L(i.xPos, i.yPos);
    p.L(i.x1, h).L(u, h).arcTo(u, u, 90, 90).L(0, i.y2);
    if (i.left) p.L(i.xPos, i.yPos);
    p.L(0, i.y1).Z();
    return [{ path: p }];
  },
  text(g) {
    const il = ((g.ss * g.a("adj3", 0, 50000)) / 100000) * 0.29289;
    return [il, il, g.w - il, g.h - il];
  },
};

DEFS.wedgeEllipseCallout = {
  adj: { adj1: -20833, adj2: 62500 },
  paths(g) {
    const dxPos = (g.w * g.a("adj1", -NO_LIMIT, NO_LIMIT)) / 100000;
    const dyPos = (g.h * g.a("adj2", -NO_LIMIT, NO_LIMIT)) / 100000;
    const xPos = g.hc + dxPos;
    const yPos = g.vc + dyPos;
    // The wedge leaves the ellipse at the point (in the ellipse's own angle) that faces the tip.
    const pang = Math.atan2(dyPos * g.w, dxPos * g.h);
    const half = 11 * RAD;
    const at = (t: number): [number, number] => [g.hc + g.wd2 * Math.cos(t), g.vc + g.hd2 * Math.sin(t)];
    const start = at(pang + half);
    const p = new Path().M(xPos, yPos).L(start[0], start[1]);
    p.arc(g.hc, g.vc, g.wd2, g.hd2, pang + half, 2 * Math.PI - 2 * half).Z();
    return [{ path: p }];
  },
  text: ellipseText,
};

DEFS.cloudCallout = {
  adj: { adj1: -20833, adj2: 62500 },
  paths(g) {
    const dx = (g.w * g.a("adj1", -NO_LIMIT, NO_LIMIT)) / 100000;
    const dy = (g.h * g.a("adj2", -NO_LIMIT, NO_LIMIT)) / 100000;
    const xPos = g.hc + dx;
    const yPos = g.vc + dy;
    const out: Sub[] = [{ path: fitTo(cloudCmds(), g.w, g.h) }];
    const f = Math.hypot(dx / (g.wd2 || 1), dy / (g.hd2 || 1));
    if (f > 1) {
      const ex = g.hc + dx / f;
      const ey = g.vc + dy / f;
      const c1 = [ex + (xPos - ex) * 0.42, ey + (yPos - ey) * 0.42] as const;
      out.push({ path: new Path().ellipse(c1[0], c1[1], g.ss * 0.065, g.ss * 0.055) });
      out.push({ path: new Path().ellipse(xPos, yPos, g.ss * 0.04, g.ss * 0.035) });
    }
    return out;
  },
  text: (g) => [g.w * 0.14, g.h * 0.25, g.w * 0.86, g.h * 0.78],
};

// ---- Flowchart ---------------------------------------------------------------------------------------------------

DEFS.flowChartProcess = { paths: (g) => [{ path: rectPath(0, 0, g.w, g.h) }] };

DEFS.flowChartAlternateProcess = {
  paths(g) {
    const r = Math.min(g.ss / 6, g.ss / 2);
    const { w, h } = g;
    return [{ path: new Path().M(0, r).arcTo(r, r, 180, 90).L(w - r, 0).arcTo(r, r, 270, 90).L(w, h - r).arcTo(r, r, 0, 90).L(r, h).arcTo(r, r, 90, 90).Z() }];
  },
  text: (g) => [g.ss / 6 * 0.29289, g.ss / 6 * 0.29289, g.w - g.ss / 6 * 0.29289, g.h - g.ss / 6 * 0.29289],
};

DEFS.flowChartPredefinedProcess = {
  paths: (g) => [{ path: rectPath(0, 0, g.w, g.h) }, { path: new Path().M(g.w / 8, 0).L(g.w / 8, g.h).M((g.w * 7) / 8, 0).L((g.w * 7) / 8, g.h), fill: false }],
  text: (g) => [g.w / 8, 0, (g.w * 7) / 8, g.h],
};

DEFS.flowChartDecision = DEFS.diamond!;

DEFS.flowChartTerminator = {
  paths(g) {
    const r = Math.min(g.hd2, g.wd2);
    const { w, h } = g;
    return [{ path: new Path().M(r, 0).L(w - r, 0).arcTo(r, g.hd2, 270, 180).L(r, h).arcTo(r, g.hd2, 90, 180).Z() }];
  },
  text: (g) => [(g.w * 1018) / 21600, (g.h * 3475) / 21600, (g.w * 20582) / 21600, (g.h * 18125) / 21600],
};

DEFS.flowChartDocument = {
  paths(g) {
    const y1 = g.h * 0.8;
    const p = new Path().M(0, 0).L(g.w, 0).L(g.w, y1).C(g.w * 0.67, y1 - g.h * 0.12, g.w * 0.33, y1 + g.h * 0.16, 0, y1 + g.h * 0.02).Z();
    return [{ path: p }];
  },
  text: (g) => [0, 0, g.w, g.h * 0.78],
};

DEFS.flowChartData = {
  paths: (g) => [{ path: new Path().poly([[g.w * 0.2, 0], [g.w, 0], [g.w * 0.8, g.h], [0, g.h]]) }],
  text: (g) => [g.w * 0.2, 0, g.w * 0.8, g.h],
};

DEFS.flowChartConnector = { paths: (g) => [{ path: new Path().ellipse(g.hc, g.vc, g.wd2, g.hd2) }], text: ellipseText };

DEFS.flowChartPreparation = {
  paths: (g) => [{ path: new Path().poly([[0, g.vc], [g.w / 5, 0], [(g.w * 4) / 5, 0], [g.w, g.vc], [(g.w * 4) / 5, g.h], [g.w / 5, g.h]]) }],
  text: (g) => [g.w / 5, 0, (g.w * 4) / 5, g.h],
};

DEFS.flowChartDelay = {
  paths(g) {
    const r = Math.min(g.wd2, g.hd2);
    return [{ path: new Path().M(0, 0).L(g.w - r, 0).arcTo(r, g.hd2, 270, 180).L(0, g.h).Z() }];
  },
  text: (g) => [0, 0, g.w - Math.min(g.wd2, g.hd2) * 0.3, g.h],
};

DEFS.flowChartMerge = {
  paths: (g) => [{ path: new Path().poly([[0, 0], [g.w, 0], [g.hc, g.h]]) }],
  text: (g) => [g.w / 4, 0, (g.w * 3) / 4, g.h / 2],
};

DEFS.flowChartExtract = {
  paths: (g) => [{ path: new Path().poly([[g.hc, 0], [g.w, g.h], [0, g.h]]) }],
  text: (g) => [g.w / 4, g.h / 2, (g.w * 3) / 4, g.h],
};

// ---- Braces and brackets -----------------------------------------------------------------------------------------

const flipX = (w: number): Mapper => (x, y) => [w - x, y];

function leftBracketPaths(g: G, map?: Mapper): Sub[] {
  const y1 = (g.ss * g.a("adj", 0, dv(50000 * g.h, g.ss))) / 100000;
  const open = () => new Path(map).M(g.w, g.h).arcTo(g.w, y1, 90, 90).L(0, y1).arcTo(g.w, y1, 180, 90);
  return [{ path: open().Z(), stroke: false }, { path: open(), fill: false }];
}

DEFS.leftBracket = {
  adj: { adj: 8333 },
  paths: (g) => leftBracketPaths(g),
  text: (g) => [g.w * 0.3, (g.ss * g.a("adj", 0, dv(50000 * g.h, g.ss))) / 100000 * 0.29289, g.w, g.h - (g.ss * g.a("adj", 0, dv(50000 * g.h, g.ss))) / 100000 * 0.29289],
};
DEFS.rightBracket = {
  adj: { adj: 8333 },
  paths: (g) => leftBracketPaths(g, flipX(g.w)),
  text: (g) => [0, (g.ss * g.a("adj", 0, dv(50000 * g.h, g.ss))) / 100000 * 0.29289, g.w * 0.7, g.h - (g.ss * g.a("adj", 0, dv(50000 * g.h, g.ss))) / 100000 * 0.29289],
};

function leftBracePaths(g: G, map?: Mapper): Sub[] {
  const a2 = g.a("adj2");
  const q = Math.min(100000 - a2, a2) / 2;
  const y1 = (g.ss * g.a("adj1", 0, dv(q * g.h, g.ss))) / 100000;
  const y3 = (g.h * a2) / 100000;
  const y4 = y3 + y1;
  const open = () =>
    new Path(map)
      .M(g.w, g.h)
      .arcTo(g.wd2, y1, 90, 90)
      .L(g.hc, y4)
      .arcTo(g.wd2, y1, 0, -90)
      .arcTo(g.wd2, y1, 90, -90)
      .L(g.hc, y1)
      .arcTo(g.wd2, y1, 180, 90);
  return [{ path: open().Z(), stroke: false }, { path: open(), fill: false }];
}

const braceText = (g: G, left: boolean): Rect4 => {
  const q = Math.min(100000 - g.a("adj2"), g.a("adj2")) / 2;
  const y1 = (g.ss * g.a("adj1", 0, dv(q * g.h, g.ss))) / 100000;
  const i = y1 * 0.29289;
  return left ? [g.hc, i, g.w, g.h - i] : [0, i, g.hc, g.h - i];
};

DEFS.leftBrace = { adj: { adj1: 8333, adj2: 50000 }, paths: (g) => leftBracePaths(g), text: (g) => braceText(g, true) };
DEFS.rightBrace = { adj: { adj1: 8333, adj2: 50000 }, paths: (g) => leftBracePaths(g, flipX(g.w)), text: (g) => braceText(g, false) };

DEFS.bracketPair = {
  adj: { adj: 16667 },
  paths(g) {
    const r = (g.ss * g.a("adj", 0, 50000)) / 100000;
    const { w, h } = g;
    const fillPath = new Path().M(0, r).arcTo(r, r, 180, 90).L(w - r, 0).arcTo(r, r, 270, 90).L(w, h - r).arcTo(r, r, 0, 90).L(r, h).arcTo(r, r, 90, 90).Z();
    const side = (map?: Mapper) => new Path(map).M(r, h).arcTo(r, r, 90, 90).L(0, r).arcTo(r, r, 180, 90);
    return [{ path: fillPath, stroke: false }, { path: side(), fill: false }, { path: side(flipX(w)), fill: false }];
  },
  text(g) {
    const i = ((g.ss * g.a("adj", 0, 50000)) / 100000) * 0.29289;
    return [i, i, g.w - i, g.h - i];
  },
};

DEFS.bracePair = {
  adj: { adj: 8333 },
  paths(g) {
    const { w, h } = g;
    const r = Math.min((g.ss * g.a("adj", 0, 25000)) / 100000, w / 4, h / 4);
    const fillPath = new Path().M(2 * r, 0).L(w - 2 * r, 0).arcTo(r, r, 270, 90).L(w - r, h - r).arcTo(r, r, 0, 90).L(2 * r, h).arcTo(r, r, 90, 90).L(r, r).arcTo(r, r, 180, 90).Z();
    const vc = g.vc;
    const side = (map?: Mapper) =>
      new Path(map).M(2 * r, h).arcTo(r, r, 90, 90).L(r, vc + r).arcTo(r, r, 0, -90).arcTo(r, r, 90, -90).L(r, r).arcTo(r, r, 180, 90);
    return [{ path: fillPath, stroke: false }, { path: side(), fill: false }, { path: side(flipX(w)), fill: false }];
  },
  text(g) {
    const r = ((g.ss * g.a("adj", 0, 25000)) / 100000) * 0.29289;
    return [r, r, g.w - r, g.h - r];
  },
};

// ---- Lines and connectors ----------------------------------------------------------------------------------------

DEFS.line = { paths: (g) => [{ path: new Path().M(0, 0).L(g.w, g.h), fill: false }] };
DEFS.straightConnector1 = DEFS.line!;

DEFS.curvedConnector3 = {
  adj: { adj1: 50000 },
  paths(g) {
    const x2 = (g.w * g.a("adj1", -NO_LIMIT, NO_LIMIT)) / 100000;
    const x1 = x2 / 2;
    const x3 = (g.w + x2) / 2;
    const p = new Path().M(0, 0).C(x1, 0, x2, g.h / 4, x2, g.vc).C(x2, (g.h * 3) / 4, x3, g.h, g.w, g.h);
    return [{ path: p, fill: false }];
  },
};

DEFS.bentConnector3 = {
  adj: { adj1: 50000 },
  paths(g) {
    const x1 = (g.w * g.a("adj1", -NO_LIMIT, NO_LIMIT)) / 100000;
    return [{ path: new Path().M(0, 0).L(x1, 0).L(x1, g.h).L(g.w, g.h), fill: false }];
  },
};

// ---- Evaluating --------------------------------------------------------------------------------------------------

const FALLBACK = DEFS.rect!;

/** Whether the name is one of the presets drawn here (anything else is drawn as a rectangle). */
export function hasPreset(geometry: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFS, geometry);
}

/** Every preset name that is drawn. */
export const PRESET_GEOMETRIES: readonly string[] = Object.keys(DEFS);

function defOf(geometry: string): Def {
  return hasPreset(geometry) ? DEFS[geometry]! : FALLBACK;
}

function evaluate(geometry: string, w: number, h: number, adjust: Record<string, number> | undefined): { subs: { cmds: Cmd[]; fill: boolean; stroke: boolean; evenOdd: boolean; shade?: PresetShade }[]; g: G; def: Def } {
  const def = defOf(geometry);
  const g = makeG(w, h, def.adj ?? {}, adjust);
  const subs = def
    .paths(g)
    .map((s) => ({
      cmds: (s.path instanceof Path ? s.path.cmds : s.path).slice(),
      fill: s.fill !== false,
      stroke: s.stroke !== false,
      evenOdd: !!s.evenOdd,
      shade: s.shade,
    }))
    .filter((s) => s.cmds.length > 1);
  // A shape squeezed to nothing (a zero-height ellipse) still leaves its flat outline.
  if (subs.length === 0) subs.push({ cmds: rectPath(0, 0, g.w, g.h).cmds, fill: true, stroke: true, evenOdd: false, shade: undefined });
  return { subs, g, def };
}

export const num = (v: number): string => String(Math.round(v * 1000) / 1000 + 0);

/** SVG path data for commands. */
export function toSvg(cmds: readonly Cmd[]): string {
  return cmds.map((c) => (c[0] === "Z" ? "Z" : `${c[0]} ${c.slice(1).map((v) => num(v as number)).join(" ")}`)).join(" ");
}

/**
 * The outline of a preset in a box of `w` by `h` points. A shape can be several paths (a smiley's face, eyes and mouth);
 * `fill` and `stroke` say what each is painted with. `adjust` holds the shape's adjustment values by name, on the
 * scale PowerPoint stores them (0..100000 for lengths, 60000ths of a degree for angles); out of range values are pinned.
 */
export function presetPath(geometry: string, w: number, h: number, adjust?: Record<string, number>): PresetPath[] {
  return evaluate(geometry, w, h, adjust).subs.map((s) => {
    const out: PresetPath = { d: toSvg(s.cmds), fill: s.fill, stroke: s.stroke };
    if (s.evenOdd) out.evenOdd = true;
    if (s.shade) out.shade = s.shade;
    return out;
  });
}

/** The same outline as PDF path commands (curves are cubic Béziers, as in `@pli.dev/docs`' `path` item). */
export function presetPdfPath(geometry: string, w: number, h: number, adjust?: Record<string, number>): PresetPdfPath[] {
  return evaluate(geometry, w, h, adjust).subs.map((s) => {
    const out: PresetPdfPath = { commands: s.cmds.map((c) => [...c] as unknown as PdfPathCommand), fill: s.fill, stroke: s.stroke, evenOdd: s.evenOdd };
    if (s.shade) out.shade = s.shade;
    return out;
  });
}

/** The rectangle text goes in: inside the corners of a triangle, an ellipse or a rounded rectangle, say. */
export function presetTextRect(geometry: string, w: number, h: number, adjust?: Record<string, number>): { x: number; y: number; w: number; h: number } {
  const { g, def } = evaluate(geometry, w, h, adjust);
  const [l, t, r, b] = (def.text ?? full)(g);
  const x = clamp(finite(l), 0, g.w);
  const y = clamp(finite(t), 0, g.h);
  return { x, y, w: Math.max(0, clamp(finite(r), 0, g.w) - x), h: Math.max(0, clamp(finite(b), 0, g.h) - y) };
}

/** The adjustment values a preset starts with (PowerPoint's defaults), by name. Empty for a shape with no handles. */
export function presetAdjustDefaults(geometry: string): Record<string, number> {
  return { ...defOf(geometry).adj };
}

// ---- The catalogue the editor's insert menu shows ----------------------------------------------------------------

export const PRESET_GROUPS: PresetGroup[] = [
  {
    label: "Shapes",
    shapes: [
      { geometry: "rect", label: "Rectangle" },
      { geometry: "roundRect", label: "Rounded rectangle" },
      { geometry: "snip1Rect", label: "Snip corner rectangle" },
      { geometry: "round2SameRect", label: "Round same-side corner rectangle" },
      { geometry: "ellipse", label: "Oval" },
      { geometry: "triangle", label: "Triangle" },
      { geometry: "rtTriangle", label: "Right triangle" },
      { geometry: "diamond", label: "Diamond" },
      { geometry: "parallelogram", label: "Parallelogram" },
      { geometry: "trapezoid", label: "Trapezoid" },
      { geometry: "pentagon", label: "Regular pentagon" },
      { geometry: "hexagon", label: "Hexagon" },
      { geometry: "octagon", label: "Octagon" },
      { geometry: "plus", label: "Cross" },
      { geometry: "heart", label: "Heart" },
      { geometry: "cloud", label: "Cloud" },
      { geometry: "moon", label: "Moon" },
      { geometry: "sun", label: "Sun" },
      { geometry: "smileyFace", label: "Smiley face" },
      { geometry: "lightningBolt", label: "Lightning bolt" },
      { geometry: "donut", label: "Donut" },
      { geometry: "noSmoking", label: "No symbol" },
      { geometry: "blockArc", label: "Block arc" },
      { geometry: "arc", label: "Arc" },
      { geometry: "chord", label: "Chord" },
      { geometry: "pie", label: "Pie" },
      { geometry: "can", label: "Can" },
      { geometry: "cube", label: "Cube" },
      { geometry: "bevel", label: "Bevel" },
      { geometry: "frame", label: "Frame" },
      { geometry: "halfFrame", label: "Half frame" },
      { geometry: "corner", label: "L-shape" },
      { geometry: "leftBracket", label: "Left bracket" },
      { geometry: "rightBracket", label: "Right bracket" },
      { geometry: "leftBrace", label: "Left brace" },
      { geometry: "rightBrace", label: "Right brace" },
      { geometry: "bracketPair", label: "Double bracket" },
      { geometry: "bracePair", label: "Double brace" },
    ],
  },
  {
    label: "Arrows",
    shapes: [
      { geometry: "rightArrow", label: "Right arrow" },
      { geometry: "leftArrow", label: "Left arrow" },
      { geometry: "upArrow", label: "Up arrow" },
      { geometry: "downArrow", label: "Down arrow" },
      { geometry: "leftRightArrow", label: "Left-right arrow" },
      { geometry: "upDownArrow", label: "Up-down arrow" },
      { geometry: "bentArrow", label: "Bent arrow" },
      { geometry: "uturnArrow", label: "U-turn arrow" },
      { geometry: "chevron", label: "Chevron" },
      { geometry: "homePlate", label: "Pentagon arrow" },
      { geometry: "notchedRightArrow", label: "Notched right arrow" },
      { geometry: "stripedRightArrow", label: "Striped right arrow" },
      { geometry: "rightArrowCallout", label: "Right arrow callout" },
    ],
  },
  {
    label: "Callouts",
    shapes: [
      { geometry: "wedgeRectCallout", label: "Rectangular callout" },
      { geometry: "wedgeRoundRectCallout", label: "Rounded rectangular callout" },
      { geometry: "wedgeEllipseCallout", label: "Oval callout" },
      { geometry: "cloudCallout", label: "Cloud callout" },
    ],
  },
  {
    label: "Flowchart",
    shapes: [
      { geometry: "flowChartProcess", label: "Process" },
      { geometry: "flowChartAlternateProcess", label: "Alternate process" },
      { geometry: "flowChartPredefinedProcess", label: "Predefined process" },
      { geometry: "flowChartDecision", label: "Decision" },
      { geometry: "flowChartTerminator", label: "Terminator" },
      { geometry: "flowChartDocument", label: "Document" },
      { geometry: "flowChartData", label: "Data" },
      { geometry: "flowChartConnector", label: "Connector" },
      { geometry: "flowChartPreparation", label: "Preparation" },
      { geometry: "flowChartDelay", label: "Delay" },
      { geometry: "flowChartMerge", label: "Merge" },
      { geometry: "flowChartExtract", label: "Extract" },
    ],
  },
  {
    label: "Stars",
    shapes: [
      { geometry: "star4", label: "4-point star" },
      { geometry: "star5", label: "5-point star" },
      { geometry: "star6", label: "6-point star" },
      { geometry: "star7", label: "7-point star" },
      { geometry: "star8", label: "8-point star" },
      { geometry: "star10", label: "10-point star" },
      { geometry: "star12", label: "12-point star" },
      { geometry: "star16", label: "16-point star" },
      { geometry: "star24", label: "24-point star" },
    ],
  },
  {
    label: "Lines",
    shapes: [
      { geometry: "line", label: "Line" },
      { geometry: "straightConnector1", label: "Straight connector" },
      { geometry: "curvedConnector3", label: "Curved connector" },
      { geometry: "bentConnector3", label: "Elbow connector" },
    ],
  },
];
