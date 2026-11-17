import type { Annotation, Pt, Rect } from "@pli.dev/pdf";

/**
 * Geometry of annotations in page space (points, y down): the box around one, whether a point hits it, and how it is moved,
 * resized and reshaped. Pure functions on the annotation JSON, used by the select tool, the marquee, the eraser and the
 * keyboard. Every annotation type is covered.
 *
 * Two boxes are used. `geometryBounds` is the shape itself (what resizing maps onto a new box); `annotBounds` also takes in
 * half the stroke width (what is drawn, what a marquee has to touch).
 */

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const EPS = 1e-6;
/** The size of a note icon, in points. */
export const NOTE_SIZE = 24;
/** The smallest width or height a resize leaves. */
export const MIN_SIZE = 4;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---- rectangles -------------------------------------------------------------------------------------------------

export const rectFromPoints = (a: Pt, b: Pt): Rect => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });

export function unionRects(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const rectContains = (r: Rect, x: number, y: number, tol = 0): boolean => x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol;

export const rectsIntersect = (a: Rect, b: Rect): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/** Keeps a rectangle inside the page, moving it rather than shrinking it where it fits. */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const w = Math.min(r.w, width);
  const h = Math.min(r.h, height);
  return { x: Math.max(0, Math.min(width - w, r.x)), y: Math.max(0, Math.min(height - h, r.y)), w, h };
}

/** A copy with positive width and height. */
export const normRect = (r: Rect): Rect => ({ x: r.w < 0 ? r.x + r.w : r.x, y: r.h < 0 ? r.y + r.h : r.y, w: Math.abs(r.w), h: Math.abs(r.h) });

// ---- bounds -----------------------------------------------------------------------------------------------------

function pointsBounds(points: readonly Pt[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of points) {
    x1 = Math.min(x1, p[0]);
    y1 = Math.min(y1, p[1]);
    x2 = Math.max(x2, p[0]);
    y2 = Math.max(y2, p[1]);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** The shape itself, without the width of its line. */
export function geometryBounds(a: Annotation): Rect {
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return unionRects(a.rects);
    case "ink":
      return pointsBounds(a.strokes.flat());
    case "line":
      return pointsBounds([a.from, a.to]);
    case "polygon":
    case "polyline":
      return pointsBounds(a.points);
    case "note":
      return { x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE };
    default:
      return { ...a.rect };
  }
}

const halfStroke = (a: Annotation): number => ("stroke" in a && a.stroke ? a.stroke.width / 2 : 0);

/** What is drawn: the shape and half its line width on each side. */
export function annotBounds(a: Annotation): Rect {
  return inflate(geometryBounds(a), halfStroke(a));
}

/** The box handles are drawn around: the drawn box, and never thinner than `min` (a horizontal line has no height). */
export function selectionBox(a: Annotation, min = 6): Rect {
  const r = annotBounds(a);
  const w = Math.max(r.w, min);
  const h = Math.max(r.h, min);
  return { x: r.x - (w - r.w) / 2, y: r.y - (h - r.h) / 2, w, h };
}

/** The box around several annotations. */
export const boundsOfAll = (list: readonly Annotation[]): Rect => unionRects(list.map(selectionBox));

// ---- hit testing ------------------------------------------------------------------------------------------------

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 < EPS ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

const nearPolyline = (points: readonly Pt[], x: number, y: number, reach: number, closed = false): boolean => {
  if (points.length === 1) return Math.hypot(x - points[0]![0], y - points[0]![1]) <= reach;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) if (distToSegment(x, y, points[i]!, points[(i + 1) % points.length]!) <= reach) return true;
  return false;
};

function insidePolygon(points: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Whether the point is on the annotation. `tol` (points) makes thin things easy to hit: pass about 6 screen pixels divided
 * by the scale. Unfilled shapes are hit on their outline only, so what is inside them can still be picked.
 */
export function hitTest(a: Annotation, x: number, y: number, tol = 2): boolean {
  if (a.hidden) return false;
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return a.rects.some((r) => rectContains(r, x, y, tol));
    case "ink":
      return a.strokes.some((s) => nearPolyline(s, x, y, a.stroke.width / 2 + tol));
    case "line":
      return distToSegment(x, y, a.from, a.to) <= a.stroke.width / 2 + tol;
    case "polyline":
      return nearPolyline(a.points, x, y, a.stroke.width / 2 + tol);
    case "polygon":
      return (a.fill && insidePolygon(a.points, x, y)) || nearPolyline(a.points, x, y, a.stroke.width / 2 + tol, true);
    case "square": {
      const reach = a.stroke.width / 2 + tol;
      if (a.fill && rectContains(a.rect, x, y, reach)) return true;
      return rectContains(a.rect, x, y, reach) && !rectContains(inflate(a.rect, -reach), x, y);
    }
    case "circle": {
      const rx = a.rect.w / 2;
      const ry = a.rect.h / 2;
      if (rx < EPS || ry < EPS) return rectContains(a.rect, x, y, a.stroke.width / 2 + tol);
      const r = Math.hypot((x - (a.rect.x + rx)) / rx, (y - (a.rect.y + ry)) / ry);
      if (a.fill) return r <= 1 + (a.stroke.width / 2 + tol) / Math.min(rx, ry);
      return Math.abs(r - 1) * ((rx + ry) / 2) <= a.stroke.width / 2 + tol;
    }
    case "note":
      return rectContains({ x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE }, x, y, tol);
    default:
      return rectContains(a.rect, x, y, tol);
  }
}

/** The topmost annotation at a point (the list is bottom to top, as on the page). */
export function topAnnotAt(annots: readonly Annotation[], x: number, y: number, tol = 2): Annotation | undefined {
  for (let i = annots.length - 1; i >= 0; i--) if (hitTest(annots[i]!, x, y, tol)) return annots[i];
  return undefined;
}

/** The annotations a marquee touches. */
export const annotsInRect = (annots: readonly Annotation[], rect: Rect): Annotation[] => annots.filter((a) => !a.hidden && rectsIntersect(annotBounds(a), rect));

// ---- moving -----------------------------------------------------------------------------------------------------

const shift = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
const shiftPt = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy];

/** A copy of the annotation moved by (dx, dy). */
export function moveBy<A extends Annotation>(a: A, dx: number, dy: number): A {
  if (dx === 0 && dy === 0) return a;
  const x = a as Annotation;
  switch (x.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return { ...x, rects: x.rects.map((r) => shift(r, dx, dy)) } as A;
    case "ink":
      return { ...x, strokes: x.strokes.map((s) => s.map((p) => shiftPt(p, dx, dy))) } as A;
    case "line":
      return { ...x, from: shiftPt(x.from, dx, dy), to: shiftPt(x.to, dx, dy) } as A;
    case "polygon":
    case "polyline":
      return { ...x, points: x.points.map((p) => shiftPt(p, dx, dy)) } as A;
    case "note":
      return { ...x, x: x.x + dx, y: x.y + dy } as A;
    default:
      return { ...x, rect: shift(x.rect, dx, dy) } as A;
  }
}

/** Markup is tied to the text it covers: it is selected, restyled and deleted, not dragged around. */
export const isMarkup = (a: Annotation): boolean => a.type === "highlight" || a.type === "underline" || a.type === "strikeout" || a.type === "squiggly";

export const canMove = (a: Annotation): boolean => !a.locked && !isMarkup(a);
/** Boxes that can be stretched: not locked, not notes (a fixed icon), not markup or redaction marks (text-shaped). */
export const canResize = (a: Annotation): boolean => !a.locked && a.type !== "note" && !isMarkup(a) && a.type !== "redact";

// ---- resizing ---------------------------------------------------------------------------------------------------

export interface ResizeOptions {
  /** Keep the width to height ratio (shift held, pictures and signatures). */
  keepAspect?: boolean;
  min?: number;
}

/** The rectangle after dragging `handle` by (dx, dy). The opposite edge or corner stays where it is. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, options: ResizeOptions = {}): Rect {
  const min = options.min ?? MIN_SIZE;
  let x1 = rect.x;
  let y1 = rect.y;
  let x2 = rect.x + rect.w;
  let y2 = rect.y + rect.h;
  if (handle.includes("w")) x1 += dx;
  if (handle.includes("e")) x2 += dx;
  if (handle.includes("n")) y1 += dy;
  if (handle.includes("s")) y2 += dy;
  const moveW = handle.includes("w");
  const moveN = handle.includes("n");
  if (x2 - x1 < min) moveW ? (x1 = x2 - min) : (x2 = x1 + min);
  if (y2 - y1 < min) moveN ? (y1 = y2 - min) : (y2 = y1 + min);
  if (options.keepAspect && rect.w > EPS && rect.h > EPS) {
    const ratio = rect.w / rect.h;
    const side = handle.length === 1;
    let w = x2 - x1;
    let h = y2 - y1;
    if (side && (handle === "n" || handle === "s")) w = h * ratio;
    else if (side) h = w / ratio;
    else if (w / rect.w > h / rect.h) h = w / ratio;
    else w = h * ratio;
    if (w < min) {
      w = min;
      h = w / ratio;
    }
    if (h < min) {
      h = min;
      w = h * ratio;
    }
    // Pin the edge or corner opposite the handle; a side handle grows the other dimension around the middle.
    const cx = (rect.x + rect.x + rect.w) / 2;
    const cy = (rect.y + rect.y + rect.h) / 2;
    const fixedX = handle.includes("w") ? rect.x + rect.w : handle.includes("e") ? rect.x : cx;
    const fixedY = handle.includes("n") ? rect.y + rect.h : handle.includes("s") ? rect.y : cy;
    x1 = handle.includes("w") ? fixedX - w : handle.includes("e") ? fixedX : fixedX - w / 2;
    y1 = handle.includes("n") ? fixedY - h : handle.includes("s") ? fixedY : fixedY - h / 2;
    x2 = x1 + w;
    y2 = y1 + h;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const scaleFactor = (to: number, from: number): number => (from > EPS ? to / from : 1);

/**
 * The annotation stretched so that its shape (`geometryBounds`) fills `to`. A line or a drawing keeps the width of its line.
 * A signature's strokes live in a box of the rectangle's size, so they are scaled with it. A note only moves.
 */
export function fitTo<A extends Annotation>(a: A, to: Rect): A {
  const x = a as Annotation;
  const from = geometryBounds(x);
  const sx = scaleFactor(to.w, from.w);
  const sy = scaleFactor(to.h, from.h);
  const mx = (v: number) => to.x + (v - from.x) * sx;
  const my = (v: number) => to.y + (v - from.y) * sy;
  const mp = (p: Pt): Pt => [round2(mx(p[0])), round2(my(p[1]))];
  const mr = (r: Rect): Rect => ({ x: round2(mx(r.x)), y: round2(my(r.y)), w: round2(r.w * sx), h: round2(r.h * sy) });
  switch (x.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return { ...x, rects: x.rects.map(mr) } as A;
    case "ink":
      return { ...x, strokes: x.strokes.map((s) => s.map(mp)) } as A;
    case "line":
      return { ...x, from: mp(x.from), to: mp(x.to) } as A;
    case "polygon":
    case "polyline":
      return { ...x, points: x.points.map(mp) } as A;
    case "note":
      return { ...x, x: round2(to.x), y: round2(to.y) } as A;
    case "signature": {
      const rect = { x: round2(to.x), y: round2(to.y), w: round2(to.w), h: round2(to.h) };
      const fx = scaleFactor(rect.w, x.rect.w);
      const fy = scaleFactor(rect.h, x.rect.h);
      return { ...x, rect, ...(x.strokes ? { strokes: x.strokes.map((s) => s.map((p): Pt => [round2(p[0] * fx), round2(p[1] * fy)])) } : {}) } as A;
    }
    default:
      return { ...x, rect: { x: round2(to.x), y: round2(to.y), w: round2(to.w), h: round2(to.h) } } as A;
  }
}

/** The annotation after dragging a handle of its box by (dx, dy). Boxes that cannot be stretched come back unchanged. */
export function resizeBy<A extends Annotation>(a: A, handle: Handle, dx: number, dy: number, options: ResizeOptions = {}): A {
  if (!canResize(a)) return a;
  const keep = options.keepAspect ?? (a.type === "image" || a.type === "signature" || (a.type === "stamp" && "picture" in a.stamp));
  return fitTo(a, resizeRect(geometryBounds(a), handle, dx, dy, { ...options, keepAspect: keep }));
}

/** Where a handle of a box is. */
export function handlePoint(box: Rect, handle: Handle): Pt {
  const x = handle.includes("w") ? box.x : handle.includes("e") ? box.x + box.w : box.x + box.w / 2;
  const y = handle.includes("n") ? box.y : handle.includes("s") ? box.y + box.h : box.y + box.h / 2;
  return [x, y];
}

// ---- vertices (lines and polygons are reshaped by their points) ------------------------------------------------

export function vertices(a: Annotation): readonly Pt[] | null {
  if (a.locked) return null;
  if (a.type === "line") return [a.from, a.to];
  if (a.type === "polygon" || a.type === "polyline") return a.points;
  return null;
}

export function moveVertex<A extends Annotation>(a: A, index: number, x: number, y: number): A {
  const p: Pt = [round2(x), round2(y)];
  const t = a as Annotation;
  if (t.type === "line") return (index === 0 ? { ...t, from: p } : { ...t, to: p }) as A;
  if (t.type === "polygon" || t.type === "polyline") return { ...t, points: t.points.map((q, i) => (i === index ? p : q)) } as A;
  return a;
}

// ---- constraining -----------------------------------------------------------------------------------------------

/** `to` moved onto the nearest multiple of 45 degrees from `from` (shift held while drawing a line). */
export function constrainAngle(from: Pt, to: Pt): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < EPS) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len];
}

/** The corner of a square (or circle) dragged from `from` to `to`: equal sides, in the direction of the drag. */
export function constrainSquare(from: Pt, to: Pt): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [from[0] + (dx < 0 ? -side : side), from[1] + (dy < 0 ? -side : side)];
}

// ---- strokes ----------------------------------------------------------------------------------------------------

/** Drops points closer than `minDist` to the last kept one (always keeps the last point of a stroke). */
export function thinPoints(points: readonly Pt[], minDist: number): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) out.push(p);
  }
  const end = points[points.length - 1];
  if (end && out.length > 0 && out[out.length - 1] !== end) out.push(end);
  return out;
}

/** Ramer-Douglas-Peucker: the fewest points that stay within `tolerance` of the stroke. */
export function simplifyStroke(points: readonly Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let max = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i]![0], points[i]![1], points[a]!, points[b]!);
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** One pass of a weighted moving average over the inside of a stroke, ends untouched: takes the shake out of a hand-drawn line. */
export function smoothStroke(points: readonly Pt[], passes = 1): Pt[] {
  let out = [...points];
  for (let k = 0; k < passes && out.length > 2; k++) {
    const prev = out;
    out = prev.map((p, i): Pt => (i === 0 || i === prev.length - 1 ? p : [(prev[i - 1]![0] + 2 * p[0] + prev[i + 1]![0]) / 4, (prev[i - 1]![1] + 2 * p[1] + prev[i + 1]![1]) / 4]));
  }
  return out;
}

/** What a finished pen stroke is stored as: smoothed, simplified, rounded to hundredths of a point. */
export function finishStroke(points: readonly Pt[]): Pt[] {
  const thinned = thinPoints(points, 0.3);
  const smooth = simplifyStroke(smoothStroke(thinned), 0.2);
  return smooth.map((p): Pt => [round2(p[0]), round2(p[1])]);
}

/** SVG path data for a stroke drawn as a smooth curve through the midpoints between points. A single point is a dot. */
export function smoothPathData(points: readonly Pt[]): string {
  const f = (n: number) => String(round2(n));
  if (points.length === 0) return "";
  const first = points[0]!;
  if (points.length === 1) return `M${f(first[0])} ${f(first[1])}h0.01`;
  if (points.length === 2) return `M${f(first[0])} ${f(first[1])}L${f(points[1]![0])} ${f(points[1]![1])}`;
  let d = `M${f(first[0])} ${f(first[1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const n = points[i + 1]!;
    d += `Q${f(p[0])} ${f(p[1])} ${f((p[0] + n[0]) / 2)} ${f((p[1] + n[1]) / 2)}`;
  }
  const last = points[points.length - 1]!;
  return `${d}L${f(last[0])} ${f(last[1])}`;
}

/** The squiggle under (or through) a run of text: a zigzag of the given amplitude along `y` from `x1` to `x2`. */
export function squigglyPathData(x1: number, x2: number, y: number, amplitude = 1.2, step = 2.4): string {
  const f = (n: number) => String(round2(n));
  let d = `M${f(x1)} ${f(y)}`;
  let up = true;
  for (let x = x1 + step; x < x2 + step - 1e-9; x += step) {
    d += `L${f(Math.min(x, x2))} ${f(y + (up ? -amplitude : amplitude))}`;
    up = !up;
  }
  return d;
}

/** The size, in points, to draw line ends at: they grow with the line but never vanish. */
export const lineEndSize = (width: number): number => Math.max(6, width * 4);

/** Equal-sized boxes the stamp tool and the image tool place: a rectangle of `w` by `h` centred on a point, kept on the page. */
export function centredRect(x: number, y: number, w: number, h: number, pageW: number, pageH: number): Rect {
  return clampRect({ x: x - w / 2, y: y - h / 2, w, h }, pageW, pageH);
}

/** A size that keeps the ratio of `w` by `h` and fits inside `maxW` by `maxH` (never enlarges). */
export function fitInside(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  const k = Math.min(1, maxW / Math.max(w, EPS), maxH / Math.max(h, EPS));
  return { w: round2(w * k), h: round2(h * k) };
}
