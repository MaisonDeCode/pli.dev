import { PliError } from "@pli.dev/core";
import type { ImageShape } from "./model";

/*
 * The shapes a picture can be cropped to (Excel's Crop to Shape): the picture shows only inside the shape, which fills the
 * picture's frame. Each is one of Office's preset geometries (`a:prstGeom prst`), drawn here with the preset's usual
 * adjustments, so the picture looks the same in Pli and in Excel. `shapePath` is the outline as an SVG path for a frame of
 * a given size, used to clip the picture when it is drawn.
 */

export type ShapeGroup = "Rectangles" | "Basic shapes" | "Block arrows" | "Stars" | "Callouts";

/** The shapes, with what Excel calls them and the group its gallery puts them in. The key is the preset geometry's name. */
export const IMAGE_SHAPES: Record<ImageShape, { label: string; group: ShapeGroup }> = {
  roundRect: { label: "Rounded rectangle", group: "Rectangles" },
  round1Rect: { label: "Round single corner rectangle", group: "Rectangles" },
  round2SameRect: { label: "Round same side corner rectangle", group: "Rectangles" },
  round2DiagRect: { label: "Round diagonal corner rectangle", group: "Rectangles" },
  snip1Rect: { label: "Snip single corner rectangle", group: "Rectangles" },
  snip2SameRect: { label: "Snip same side corner rectangle", group: "Rectangles" },
  snip2DiagRect: { label: "Snip diagonal corner rectangle", group: "Rectangles" },
  snipRoundRect: { label: "Snip and round single corner rectangle", group: "Rectangles" },
  ellipse: { label: "Oval", group: "Basic shapes" },
  triangle: { label: "Isosceles triangle", group: "Basic shapes" },
  rtTriangle: { label: "Right triangle", group: "Basic shapes" },
  diamond: { label: "Diamond", group: "Basic shapes" },
  parallelogram: { label: "Parallelogram", group: "Basic shapes" },
  trapezoid: { label: "Trapezoid", group: "Basic shapes" },
  pentagon: { label: "Regular pentagon", group: "Basic shapes" },
  hexagon: { label: "Hexagon", group: "Basic shapes" },
  octagon: { label: "Octagon", group: "Basic shapes" },
  plus: { label: "Cross", group: "Basic shapes" },
  teardrop: { label: "Teardrop", group: "Basic shapes" },
  heart: { label: "Heart", group: "Basic shapes" },
  rightArrow: { label: "Arrow: right", group: "Block arrows" },
  leftArrow: { label: "Arrow: left", group: "Block arrows" },
  upArrow: { label: "Arrow: up", group: "Block arrows" },
  downArrow: { label: "Arrow: down", group: "Block arrows" },
  leftRightArrow: { label: "Arrow: left and right", group: "Block arrows" },
  chevron: { label: "Arrow: chevron", group: "Block arrows" },
  homePlate: { label: "Arrow: pentagon", group: "Block arrows" },
  star4: { label: "Star: 4 points", group: "Stars" },
  star5: { label: "Star: 5 points", group: "Stars" },
  star6: { label: "Star: 6 points", group: "Stars" },
  star8: { label: "Star: 8 points", group: "Stars" },
  star10: { label: "Star: 10 points", group: "Stars" },
  star12: { label: "Star: 12 points", group: "Stars" },
  wedgeRectCallout: { label: "Speech bubble: rectangle", group: "Callouts" },
  wedgeRoundRectCallout: { label: "Speech bubble: rectangle with corners rounded", group: "Callouts" },
  wedgeEllipseCallout: { label: "Speech bubble: oval", group: "Callouts" },
};
export const IMAGE_SHAPE_NAMES = Object.keys(IMAGE_SHAPES) as ImageShape[];
export const SHAPE_GROUPS: ShapeGroup[] = ["Rectangles", "Basic shapes", "Block arrows", "Stars", "Callouts"];

/** A shape made ready to keep: one of `IMAGE_SHAPE_NAMES`. */
export function cleanShape(shape: ImageShape): ImageShape {
  if (typeof shape !== "string" || !Object.prototype.hasOwnProperty.call(IMAGE_SHAPES, shape)) throw new PliError("invalid_operation", `A picture's shape is one of ${IMAGE_SHAPE_NAMES.join(", ")}`);
  return shape;
}

/** The shape (if Pli has it) of an Office preset geometry's name. */
export const shapeOfPreset = (prst: string | undefined): ImageShape | undefined => (prst && Object.prototype.hasOwnProperty.call(IMAGE_SHAPES, prst) ? (prst as ImageShape) : undefined);

const n = (v: number) => String(Math.round(v * 100) / 100);
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`;

/** A star or regular polygon of `points` outer points, the inner ones at `inner` times the outer radius (1 for a polygon), point up and stretched to fill `w` by `h`. */
function round(points: number, inner: number, w: number, h: number): [number, number][] {
  const raw: [number, number][] = [];
  const count = inner === 1 ? points : points * 2;
  for (let i = 0; i < count; i++) {
    const r = inner === 1 || i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    raw.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = w / (Math.max(...xs) - x0);
  const sy = h / (Math.max(...ys) - y0);
  return raw.map(([x, y]) => [(x - x0) * sx, (y - y0) * sy]);
}

type Corner = readonly ["round" | "snip", number] | null;
/** A rectangle with each corner (top left, top right, bottom right, bottom left) rounded or cut off by a size, or left square. */
function corners(w: number, h: number, [tl, tr, br, bl]: [Corner, Corner, Corner, Corner]): string {
  const s = (c: Corner) => c?.[1] ?? 0;
  /** The way round a corner to the point `to`: an arc for a rounded one, a straight cut for a snipped one. */
  const at = (c: NonNullable<Corner>, to: [number, number]) => (c[0] === "round" ? `A${n(c[1])} ${n(c[1])} 0 0 1 ${n(to[0])} ${n(to[1])}` : `L${n(to[0])} ${n(to[1])}`);
  return [
    `M${n(s(tl))} 0`,
    `L${n(w - s(tr))} 0`,
    tr ? at(tr, [w, tr[1]]) : `L${n(w)} 0`,
    `L${n(w)} ${n(h - s(br))}`,
    br ? at(br, [w - br[1], h]) : `L${n(w)} ${n(h)}`,
    `L${n(s(bl))} ${n(h)}`,
    bl ? at(bl, [0, h - bl[1]]) : `L0 ${n(h)}`,
    `L0 ${n(s(tl))}`,
    tl ? at(tl, [tl[1], 0]) : "L0 0",
    "Z",
  ].join("");
}

// ---- adjustments: the yellow handles ----

/** One of a preset shape's adjustments: Office's guide (`adj`, `adj1`…), its default and its range. Values are in Office's own units, as `a:avLst` holds them. */
export interface ShapeAdjustment {
  name: string;
  default: number;
  min: number;
  max(w: number, h: number): number;
}

/** A yellow handle: where it sits (given all the shape's values) and the values a drag to a point gives. One handle can set more than one adjustment. */
export interface ShapeHandle {
  names: string[];
  at(v: Record<string, number>, w: number, h: number): [number, number];
  move(x: number, y: number, w: number, h: number, v: Record<string, number>): Record<string, number>;
}

const SS = (w: number, h: number) => Math.min(w, h);
const fixed = (n: number) => () => n;
const spec = (name: string, def: number, max: (w: number, h: number) => number = fixed(50000), min = 0): ShapeAdjustment => ({ name, default: def, min, max });
const wide = (k: number) => (w: number, h: number) => (k * w) / SS(w, h);
const tall = (k: number) => (w: number, h: number) => (k * h) / SS(w, h);

/** A handle on the top edge (or the bottom) that sets a length, a share of the shorter side, from the left corner or the right. */
const edge = (name: string, o: { right?: boolean; bottom?: boolean } = {}): ShapeHandle => ({
  names: [name],
  at: (v, w, h) => [o.right ? w - (SS(w, h) * v[name]!) / 100000 : (SS(w, h) * v[name]!) / 100000, o.bottom ? h : 0],
  move: (x, _y, w, h) => ({ [name]: ((o.right ? w - x : x) * 100000) / SS(w, h) }),
});
/** The handle of a block arrow's shaft: it moves up and down to set how thick the shaft is. */
const shaft = (name: string, headName: string, side: "right" | "left" | "up" | "down"): ShapeHandle => ({
  names: [name],
  at: (v, w, h) => {
    const head = (SS(w, h) * v[headName]!) / 100000;
    const half = side === "right" || side === "left" ? (h * v[name]!) / 200000 : (w * v[name]!) / 200000;
    if (side === "right") return [w - head, h / 2 - half];
    if (side === "left") return [head, h / 2 - half];
    return side === "up" ? [w / 2 - half, head] : [w / 2 - half, h - head];
  },
  move: (x, y, w, h) => ({ [name]: side === "right" || side === "left" ? ((h / 2 - y) * 200000) / h : ((w / 2 - x) * 200000) / w }),
});

/** The first inner vertex of a star with `points` points and an inner radius of `ratio`, in a frame `w` by `h`; and the frame's scale. */
function starFrame(points: number, w: number, h: number) {
  const outer: [number, number][] = Array.from({ length: points }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / points;
    return [Math.cos(a), Math.sin(a)];
  });
  const x0 = Math.min(...outer.map((p) => p[0]));
  const y0 = Math.min(...outer.map((p) => p[1]));
  return { x0, y0, sx: w / (Math.max(...outer.map((p) => p[0])) - x0), sy: h / (Math.max(...outer.map((p) => p[1])) - y0) };
}
const starHandle = (points: number): ShapeHandle => ({
  names: ["adj"],
  at: (v, w, h) => {
    const f = starFrame(points, w, h);
    const a = -Math.PI / 2 + Math.PI / points;
    const r = v["adj"]! / 50000;
    return [(r * Math.cos(a) - f.x0) * f.sx, (r * Math.sin(a) - f.y0) * f.sy];
  },
  move: (x, y, w, h) => {
    const f = starFrame(points, w, h);
    return { adj: Math.hypot(x / f.sx + f.x0, y / f.sy + f.y0) * 50000 };
  },
});
const tip = (): ShapeHandle => ({
  names: ["adj1", "adj2"],
  at: (v, w, h) => [w / 2 + (w * v["adj1"]!) / 100000, h / 2 + (h * v["adj2"]!) / 100000],
  move: (x, y, w, h) => ({ adj1: ((x - w / 2) * 100000) / w, adj2: ((y - h / 2) * 100000) / h }),
});
const TIP_SPECS = [spec("adj1", -20833, fixed(500000), -500000), spec("adj2", 62500, fixed(500000), -500000)];

/** Every shape that has yellow handles: its adjustments (with Office's defaults and ranges) and its handles. */
export const SHAPE_ADJUSTMENTS: Partial<Record<ImageShape, { specs: ShapeAdjustment[]; handles: ShapeHandle[] }>> = {
  roundRect: { specs: [spec("adj", 16667)], handles: [edge("adj")] },
  round1Rect: { specs: [spec("adj", 16667)], handles: [edge("adj", { right: true })] },
  round2SameRect: { specs: [spec("adj1", 16667), spec("adj2", 0)], handles: [edge("adj1"), edge("adj2", { bottom: true })] },
  round2DiagRect: { specs: [spec("adj1", 16667), spec("adj2", 0)], handles: [edge("adj1"), edge("adj2", { right: true })] },
  snip1Rect: { specs: [spec("adj", 16667)], handles: [edge("adj", { right: true })] },
  snip2SameRect: { specs: [spec("adj1", 16667), spec("adj2", 0)], handles: [edge("adj1"), edge("adj2", { bottom: true })] },
  snip2DiagRect: { specs: [spec("adj1", 0), spec("adj2", 16667)], handles: [edge("adj1"), edge("adj2", { right: true })] },
  snipRoundRect: { specs: [spec("adj1", 16667), spec("adj2", 16667)], handles: [edge("adj1"), edge("adj2", { right: true })] },
  triangle: { specs: [spec("adj", 50000, fixed(100000))], handles: [{ names: ["adj"], at: (v, w) => [(w * v["adj"]!) / 100000, 0], move: (x, _y, w) => ({ adj: (x * 100000) / w }) }] },
  parallelogram: { specs: [spec("adj", 25000, wide(100000))], handles: [edge("adj")] },
  trapezoid: { specs: [spec("adj", 25000, wide(50000))], handles: [edge("adj")] },
  hexagon: { specs: [spec("adj", 25000, wide(50000))], handles: [edge("adj")] },
  octagon: { specs: [spec("adj", 29289)], handles: [edge("adj")] },
  plus: { specs: [spec("adj", 25000)], handles: [edge("adj")] },
  chevron: { specs: [spec("adj", 50000, wide(100000))], handles: [edge("adj", { right: true })] },
  homePlate: { specs: [spec("adj", 50000, wide(100000))], handles: [edge("adj", { right: true })] },
  rightArrow: { specs: [spec("adj1", 50000, fixed(100000)), spec("adj2", 50000, wide(100000))], handles: [shaft("adj1", "adj2", "right"), edge("adj2", { right: true })] },
  leftArrow: { specs: [spec("adj1", 50000, fixed(100000)), spec("adj2", 50000, wide(100000))], handles: [shaft("adj1", "adj2", "left"), edge("adj2")] },
  upArrow: {
    specs: [spec("adj1", 50000, fixed(100000)), spec("adj2", 50000, tall(100000))],
    handles: [shaft("adj1", "adj2", "up"), { names: ["adj2"], at: (v, w, h) => [0, (SS(w, h) * v["adj2"]!) / 100000], move: (_x, y, w, h) => ({ adj2: (y * 100000) / SS(w, h) }) }],
  },
  downArrow: {
    specs: [spec("adj1", 50000, fixed(100000)), spec("adj2", 50000, tall(100000))],
    handles: [shaft("adj1", "adj2", "down"), { names: ["adj2"], at: (v, w, h) => [0, h - (SS(w, h) * v["adj2"]!) / 100000], move: (_x, y, w, h) => ({ adj2: ((h - y) * 100000) / SS(w, h) }) }],
  },
  leftRightArrow: { specs: [spec("adj1", 50000, fixed(100000)), spec("adj2", 50000, wide(50000))], handles: [shaft("adj1", "adj2", "left"), edge("adj2")] },
  star4: { specs: [spec("adj", 12500)], handles: [starHandle(4)] },
  star5: { specs: [spec("adj", 19098)], handles: [starHandle(5)] },
  star6: { specs: [spec("adj", 28868)], handles: [starHandle(6)] },
  star8: { specs: [spec("adj", 37500)], handles: [starHandle(8)] },
  star10: { specs: [spec("adj", 42533)], handles: [starHandle(10)] },
  star12: { specs: [spec("adj", 37500)], handles: [starHandle(12)] },
  wedgeRectCallout: { specs: TIP_SPECS, handles: [tip()] },
  wedgeRoundRectCallout: { specs: [...TIP_SPECS, spec("adj3", 16667)], handles: [tip(), edge("adj3")] },
  wedgeEllipseCallout: { specs: TIP_SPECS, handles: [tip()] },
};

/** The values of all of a shape's adjustments for a frame: what was set, kept within the range, and Office's defaults for the rest. */
export function shapeValues(shape: ImageShape, w: number, h: number, adjust?: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of SHAPE_ADJUSTMENTS[shape]?.specs ?? []) {
    const v = adjust?.[a.name];
    out[a.name] = typeof v === "number" && Number.isFinite(v) ? Math.max(a.min, Math.min(a.max(w, h), v)) : a.default;
  }
  return out;
}

/** The yellow handles of a shape in a frame `w` by `h`: where each is, and what it sets. */
export function shapeHandles(shape: ImageShape, w: number, h: number, adjust?: Readonly<Record<string, number>>): { index: number; x: number; y: number; names: string[] }[] {
  const v = shapeValues(shape, w, h, adjust);
  return (SHAPE_ADJUSTMENTS[shape]?.handles ?? []).map((handle, index) => {
    const [x, y] = handle.at(v, w, h);
    return { index, x, y, names: handle.names };
  });
}

/**
 * The adjustments after handle number `index` is dragged to a point of the frame: all of the shape's values, within their ranges,
 * with those equal to Office's default left out (so the result is what the picture keeps).
 */
export function dragShapeHandle(shape: ImageShape, index: number, x: number, y: number, w: number, h: number, adjust?: Readonly<Record<string, number>>): Record<string, number> | undefined {
  const entry = SHAPE_ADJUSTMENTS[shape];
  const handle = entry?.handles[index];
  if (!entry || !handle) return adjust ? { ...adjust } : undefined;
  const before = shapeValues(shape, w, h, adjust);
  const moved = { ...before, ...handle.move(x, y, w, h, before) };
  return cleanShapeAdjust(shape, moved, w, h);
}

/**
 * Adjustments made ready to keep: only the names the shape has, whole numbers within the range, and none equal to the default.
 * `undefined` when nothing is left. A frame (`w` by `h`) makes the ranges that depend on its shape exact; without one the widest range is allowed.
 */
export function cleanShapeAdjust(shape: ImageShape, adjust: Readonly<Record<string, number>> | undefined, w?: number, h?: number): Record<string, number> | undefined {
  if (adjust === undefined) return undefined;
  if (!adjust || typeof adjust !== "object" || Array.isArray(adjust)) throw new PliError("invalid_operation", "A shape's adjustments are an object of numbers");
  const specs = SHAPE_ADJUSTMENTS[shape]?.specs ?? [];
  const out: Record<string, number> = {};
  for (const [name, raw] of Object.entries(adjust)) {
    const a = specs.find((x) => x.name === name);
    if (!a) throw new PliError("invalid_operation", `The shape "${shape}" has no adjustment "${name}"${specs.length ? ` (it has ${specs.map((x) => x.name).join(", ")})` : ""}`);
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new PliError("invalid_operation", `The adjustment "${name}" is a number`);
    const top = w && h ? a.max(w, h) : a.max(1_000_000, 1);
    const v = Math.round(Math.max(a.min, Math.min(top, raw)));
    if (v !== a.default) out[name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A speech bubble: a rectangle (corners rounded by `radius`) with a tail to the point (`adj1`, `adj2`) given as shares of the frame
 * from its middle. The tail leaves the side the point lies towards, between the 2nd and 5th or the 7th and 10th twelfth of it (Office's rule).
 */
function callout(w: number, h: number, adj1: number, adj2: number, radius: number): string {
  const px = w / 2 + (w * adj1) / 100000;
  const py = h / 2 + (h * adj2) / 100000;
  const dx = px - w / 2;
  const dy = py - h / 2;
  const dz = Math.abs(dy) - Math.abs((dx * h) / w);
  const x1 = (w * (dx > 0 ? 7 : 2)) / 12;
  const x2 = (w * (dx > 0 ? 10 : 5)) / 12;
  const y1 = (h * (dy > 0 ? 7 : 2)) / 12;
  const y2 = (h * (dy > 0 ? 10 : 5)) / 12;
  const r = Math.min(radius, w / 2, h / 2);
  const P = (x: number, y: number) => `L${n(x)} ${n(y)}`;
  const arc = (x: number, y: number) => (r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y)}` : P(x, y));
  const top = dz > 0 && dy < 0 ? P(x1, 0) + P(px, py) + P(x2, 0) : "";
  const bottom = dz > 0 && dy > 0 ? P(x2, h) + P(px, py) + P(x1, h) : "";
  const right = dz <= 0 && dx > 0 ? P(w, y1) + P(px, py) + P(w, y2) : "";
  const left = dz <= 0 && dx < 0 ? P(0, y2) + P(px, py) + P(0, y1) : "";
  return `M${n(r)} 0${top}${P(w - r, 0)}${arc(w, r)}${right}${P(w, h - r)}${arc(w - r, h)}${bottom}${P(r, h)}${arc(0, h - r)}${left}${P(0, r)}${arc(r, 0)}Z`;
}

/** An oval speech bubble: the oval with a wedge to the tail's point, its base spanning about a seventh of the way round. */
function ellipseCallout(w: number, h: number, adj1: number, adj2: number): string {
  const px = w / 2 + (w * adj1) / 100000;
  const py = h / 2 + (h * adj2) / 100000;
  const rx = w / 2;
  const ry = h / 2;
  const t = Math.atan2((py - ry) / ry, (px - rx) / rx);
  const half = Math.PI / 14;
  const at = (a: number): [number, number] => [rx + rx * Math.cos(a), ry + ry * Math.sin(a)];
  const [ax, ay] = at(t - half);
  const [bx, by] = at(t + half);
  const inside = Math.hypot((px - rx) / rx, (py - ry) / ry) <= 1;
  if (inside) return `M0 ${n(ry)}A${n(rx)} ${n(ry)} 0 1 1 ${n(w)} ${n(ry)}A${n(rx)} ${n(ry)} 0 1 1 0 ${n(ry)}Z`;
  return `M${n(bx)} ${n(by)}A${n(rx)} ${n(ry)} 0 1 1 ${n(ax)} ${n(ay)}L${n(px)} ${n(py)}Z`;
}

/** The outline of a shape that fills a frame `w` by `h` pixels, as an SVG path (the frame's top left is 0 0). Office's own adjustments for each shape, as `<a:avLst/>` leaves them. */
export function shapePath(shape: ImageShape, w: number, h: number, adjust?: Readonly<Record<string, number>>): string {
  const ss = Math.min(w, h);
  const hc = w / 2;
  const vc = h / 2;
  const a = shapeValues(shape, w, h, adjust);
  /** An adjustment as a length: a share of the shorter side. */
  const len = (name: string) => (ss * (a[name] ?? 0)) / 100000;
  switch (shape) {
    case "roundRect": return corners(w, h, [["round", len("adj")], ["round", len("adj")], ["round", len("adj")], ["round", len("adj")]]);
    case "round1Rect": return corners(w, h, [null, ["round", len("adj")], null, null]);
    case "round2SameRect": return corners(w, h, [["round", len("adj1")], ["round", len("adj1")], ["round", len("adj2")], ["round", len("adj2")]].map((c, i) => (c[1] === 0 ? null : c)) as [Corner, Corner, Corner, Corner]);
    case "round2DiagRect": return corners(w, h, [["round", len("adj1")], ["round", len("adj2")], ["round", len("adj1")], ["round", len("adj2")]].map((c) => (c[1] === 0 ? null : c)) as [Corner, Corner, Corner, Corner]);
    case "snip1Rect": return corners(w, h, [null, ["snip", len("adj")], null, null]);
    case "snip2SameRect": return corners(w, h, [["snip", len("adj1")], ["snip", len("adj1")], ["snip", len("adj2")], ["snip", len("adj2")]].map((c) => (c[1] === 0 ? null : c)) as [Corner, Corner, Corner, Corner]);
    case "snip2DiagRect": return corners(w, h, [["snip", len("adj1")], ["snip", len("adj2")], ["snip", len("adj1")], ["snip", len("adj2")]].map((c) => (c[1] === 0 ? null : c)) as [Corner, Corner, Corner, Corner]);
    case "snipRoundRect": return corners(w, h, [["round", len("adj1")], ["snip", len("adj2")], null, null]);
    case "ellipse": return `M0 ${n(vc)}A${n(hc)} ${n(vc)} 0 1 1 ${n(w)} ${n(vc)}A${n(hc)} ${n(vc)} 0 1 1 0 ${n(vc)}Z`;
    case "triangle": return poly([[0, h], [(w * a["adj"]!) / 100000, 0], [w, h]]);
    case "rtTriangle": return poly([[0, h], [0, 0], [w, h]]);
    case "diamond": return poly([[0, vc], [hc, 0], [w, vc], [hc, h]]);
    case "parallelogram": {
      const x = Math.min(w, len("adj"));
      return poly([[0, h], [x, 0], [w, 0], [w - x, h]]);
    }
    case "trapezoid": {
      const x = Math.min(w / 2, len("adj"));
      return poly([[0, h], [x, 0], [w - x, 0], [w, h]]);
    }
    case "pentagon": return poly(round(5, 1, w, h));
    case "hexagon": {
      const x = Math.min(w / 2, len("adj"));
      return poly([[0, vc], [x, 0], [w - x, 0], [w, vc], [w - x, h], [x, h]]);
    }
    case "octagon": {
      const x = Math.min(w / 2, h / 2, len("adj"));
      return poly([[0, x], [x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x]]);
    }
    case "plus": {
      const x = len("adj");
      return poly([[0, x], [x, x], [x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x]]);
    }
    case "teardrop": return `M0 ${n(vc)}A${n(hc)} ${n(vc)} 0 0 1 ${n(hc)} 0L${n(w)} 0L${n(w)} ${n(vc)}A${n(hc)} ${n(vc)} 0 0 1 ${n(hc)} ${n(h)}A${n(hc)} ${n(vc)} 0 0 1 0 ${n(vc)}Z`;
    case "heart": {
      const dx1 = (w * 49) / 48;
      const dx2 = (w * 10) / 48;
      const top = -(h * 12) / 48;
      return `M${n(hc)} ${n(h / 4)}C${n(hc + dx2)} ${n(top)} ${n(hc + dx1)} ${n(h / 4)} ${n(hc)} ${n(h)}C${n(hc - dx1)} ${n(h / 4)} ${n(hc - dx2)} ${n(top)} ${n(hc)} ${n(h / 4)}Z`;
    }
    case "rightArrow": {
      const x = w - Math.min(w, len("adj2"));
      const t = (h * a["adj1"]!) / 200000;
      return poly([[0, vc - t], [x, vc - t], [x, 0], [w, vc], [x, h], [x, vc + t], [0, vc + t]]);
    }
    case "leftArrow": {
      const x = Math.min(w, len("adj2"));
      const t = (h * a["adj1"]!) / 200000;
      return poly([[w, vc - t], [x, vc - t], [x, 0], [0, vc], [x, h], [x, vc + t], [w, vc + t]]);
    }
    case "upArrow": {
      const y = Math.min(h, len("adj2"));
      const t = (w * a["adj1"]!) / 200000;
      return poly([[hc - t, h], [hc - t, y], [0, y], [hc, 0], [w, y], [hc + t, y], [hc + t, h]]);
    }
    case "downArrow": {
      const y = h - Math.min(h, len("adj2"));
      const t = (w * a["adj1"]!) / 200000;
      return poly([[hc - t, 0], [hc - t, y], [0, y], [hc, h], [w, y], [hc + t, y], [hc + t, 0]]);
    }
    case "leftRightArrow": {
      const x = Math.min(w / 2, len("adj2"));
      const t = (h * a["adj1"]!) / 200000;
      return poly([[0, vc], [x, 0], [x, vc - t], [w - x, vc - t], [w - x, 0], [w, vc], [w - x, h], [w - x, vc + t], [x, vc + t], [x, h]]);
    }
    case "chevron": {
      const x = Math.min(w, len("adj"));
      return poly([[0, 0], [w - x, 0], [w, vc], [w - x, h], [0, h], [x, vc]]);
    }
    case "homePlate": {
      const x = w - Math.min(w, len("adj"));
      return poly([[0, 0], [x, 0], [w, vc], [x, h], [0, h]]);
    }
    case "star4": return poly(round(4, a["adj"]! / 50000, w, h));
    case "star5": return poly(round(5, a["adj"]! / 50000, w, h));
    case "star6": return poly(round(6, a["adj"]! / 50000, w, h));
    case "star8": return poly(round(8, a["adj"]! / 50000, w, h));
    case "star10": return poly(round(10, a["adj"]! / 50000, w, h));
    case "star12": return poly(round(12, a["adj"]! / 50000, w, h));
    case "wedgeRectCallout": return callout(w, h, a["adj1"]!, a["adj2"]!, 0);
    case "wedgeRoundRectCallout": return callout(w, h, a["adj1"]!, a["adj2"]!, len("adj3"));
    case "wedgeEllipseCallout": return ellipseCallout(w, h, a["adj1"]!, a["adj2"]!);
  }
}
