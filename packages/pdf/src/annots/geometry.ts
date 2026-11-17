/**
 * Where annotations are and how to move them: conversion between PDF space (origin bottom left of the page, y up) and
 * page space (origin top left of the visible box, y down), and for the UI the bounds, hit test, move and resize of every
 * annotation type.
 */
import type { Annotation, LineEnd, Pt, Rect } from "../model";

/** The visible box of a page in PDF space: `[x0, y0, x1, y1]`, the CropBox (or MediaBox). */
export type Box = readonly [number, number, number, number];

/** Numbers read from a file without the noise of floating point subtraction (4 decimals, as written). */
const tidy = (v: number): number => Math.round(v * 1e4) / 1e4;

/** A rectangle in page space as PDF's `[llx, lly, urx, ury]`. */
export const rectToPdf = (box: Box, r: Rect): [number, number, number, number] => [box[0] + r.x, box[3] - r.y - r.h, box[0] + r.x + r.w, box[3] - r.y];
/** A PDF rectangle (any corner order) as a page space rectangle. */
export function rectFromPdf(box: Box, a: readonly number[]): Rect {
  const llx = Math.min(a[0]!, a[2]!);
  const urx = Math.max(a[0]!, a[2]!);
  const lly = Math.min(a[1]!, a[3]!);
  const ury = Math.max(a[1]!, a[3]!);
  return { x: tidy(llx - box[0]), y: tidy(box[3] - ury), w: tidy(urx - llx), h: tidy(ury - lly) };
}
export const ptToPdf = (box: Box, p: Pt): [number, number] => [box[0] + p[0], box[3] - p[1]];
export const ptFromPdf = (box: Box, x: number, y: number): Pt => [tidy(x - box[0]), tidy(box[3] - y)];

/** The size of a sticky note's icon. */
export const NOTE_SIZE = 24;

/** The length of an arrow head or end mark for a line of this width. */
export const endSize = (width: number): number => Math.max(8, width * 5);

const round = (v: number): number => Math.round(v * 1e4) / 1e4;

export const unionRects = (rects: readonly Rect[]): Rect => {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const pointsBounds = (pts: readonly Pt[], pad = 0): Rect => {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
};

const hasEnd = (e: LineEnd | undefined): boolean => !!e && e !== "none";

/** How far a stroke or line end reaches beyond the points of an annotation. */
function padOf(a: Annotation): number {
  switch (a.type) {
    case "ink":
    case "polygon":
    case "polyline":
      return a.stroke.width / 2;
    case "line":
      return a.stroke.width / 2 + (hasEnd(a.startEnd) || hasEnd(a.endEnd) ? endSize(a.stroke.width) / 2 : 0);
    default:
      return 0;
  }
}

/** The box an annotation covers in page space, stroke included. What the UI draws a selection around. */
export function bounds(a: Annotation): Rect {
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return unionRects(a.rects);
    case "ink":
      return pointsBounds(a.strokes.flat(), padOf(a));
    case "square":
    case "circle":
      return a.rect;
    case "line":
      return pointsBounds([a.from, a.to], padOf(a));
    case "polygon":
    case "polyline":
      return pointsBounds(a.points, padOf(a));
    case "note":
      return { x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE };
    case "freetext":
    case "stamp":
    case "signature":
    case "image":
    case "link":
      return a.rect;
  }
}

const inRect = (r: Rect, p: Pt, tol: number): boolean => p[0] >= r.x - tol && p[0] <= r.x + r.w + tol && p[1] >= r.y - tol && p[1] <= r.y + r.h + tol;

/** Distance from a point to a segment. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const nearPath = (pts: readonly Pt[], p: Pt, dist: number, closed: boolean): boolean => {
  if (pts.length === 1) return Math.hypot(p[0] - pts[0]![0], p[1] - pts[0]![1]) <= dist;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) if (distanceToSegment(p, pts[i]!, pts[(i + 1) % pts.length]!) <= dist) return true;
  return false;
};

const inPolygon = (pts: readonly Pt[], p: Pt): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Whether a point (page space) hits an annotation, within `tolerance` points: on the marked text, on a stroke, inside
 * a filled shape or a box, on the border of an unfilled shape.
 */
export function hitTest(a: Annotation, point: Pt, tolerance = 0): boolean {
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return a.rects.some((r) => inRect(r, point, tolerance));
    case "ink":
      return a.strokes.some((s) => nearPath(s, point, a.stroke.width / 2 + tolerance, false));
    case "square":
    case "circle": {
      const r = a.rect;
      const reach = a.stroke.width / 2 + tolerance;
      const outer = inRect(r, point, reach);
      if (!outer) return false;
      const inner: Rect = { x: r.x + reach, y: r.y + reach, w: Math.max(0, r.w - 2 * reach), h: Math.max(0, r.h - 2 * reach) };
      if (a.type === "square") return a.fill ? true : !(inner.w > 0 && inner.h > 0 && inRect(inner, point, 0));
      const rx = r.w / 2 + reach;
      const ry = r.h / 2 + reach;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const outside = ((point[0] - cx) / rx) ** 2 + ((point[1] - cy) / ry) ** 2 > 1;
      if (outside) return false;
      if (a.fill) return true;
      const irx = r.w / 2 - reach;
      const iry = r.h / 2 - reach;
      return irx <= 0 || iry <= 0 ? true : ((point[0] - cx) / irx) ** 2 + ((point[1] - cy) / iry) ** 2 >= 1;
    }
    case "line":
      return distanceToSegment(point, a.from, a.to) <= a.stroke.width / 2 + tolerance;
    case "polygon":
      return (a.fill ? inPolygon(a.points, point) : false) || nearPath(a.points, point, a.stroke.width / 2 + tolerance, true);
    case "polyline":
      return nearPath(a.points, point, a.stroke.width / 2 + tolerance, false);
    default:
      return inRect(bounds(a), point, tolerance);
  }
}

const shift = (p: Pt, dx: number, dy: number): Pt => [round(p[0] + dx), round(p[1] + dy)];
const shiftRect = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: round(r.x + dx), y: round(r.y + dy) });

/** The annotation moved by (dx, dy) in page space. */
export function translate<A extends Annotation>(a: A, dx: number, dy: number): A {
  const x = a as Annotation;
  switch (x.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return { ...x, rects: x.rects.map((r) => shiftRect(r, dx, dy)) } as A;
    case "ink":
      return { ...x, strokes: x.strokes.map((s) => s.map((p) => shift(p, dx, dy))) } as A;
    case "line":
      return { ...x, from: shift(x.from, dx, dy), to: shift(x.to, dx, dy) } as A;
    case "polygon":
    case "polyline":
      return { ...x, points: x.points.map((p) => shift(p, dx, dy)) } as A;
    case "note":
      return { ...x, x: round(x.x + dx), y: round(x.y + dy) } as A;
    default:
      // Shapes, text boxes, stamps, signatures (their strokes are relative to the box), pictures and links.
      return { ...x, rect: shiftRect(x.rect, dx, dy) } as A;
  }
}

/**
 * The annotation stretched so that what covered `bounds(a)` now covers `rect`: points, strokes and boxes are scaled
 * (stroke widths and sticky note icons keep their size; a note moves to the new top left).
 */
export function resizeTo<A extends Annotation>(a: A, rect: Rect): A {
  const x = a as Annotation;
  // Strokes keep their width, so it is the points that are fitted into the new box less the stroke's reach.
  const pad = padOf(x);
  const deflate = (r: Rect): Rect => {
    const px = Math.min(pad, r.w / 2);
    const py = Math.min(pad, r.h / 2);
    return { x: r.x + px, y: r.y + py, w: r.w - 2 * px, h: r.h - 2 * py };
  };
  const old = deflate(bounds(x));
  const to = deflate(rect);
  const sx = old.w > 0 ? to.w / old.w : 1;
  const sy = old.h > 0 ? to.h / old.h : 1;
  const px = (p: Pt): Pt => [round(to.x + (p[0] - old.x) * sx), round(to.y + (p[1] - old.y) * sy)];
  const pr = (r: Rect): Rect => ({ x: round(to.x + (r.x - old.x) * sx), y: round(to.y + (r.y - old.y) * sy), w: round(r.w * sx), h: round(r.h * sy) });
  switch (x.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return { ...x, rects: x.rects.map(pr) } as A;
    case "ink":
      return { ...x, strokes: x.strokes.map((s) => s.map(px)) } as A;
    case "line":
      return { ...x, from: px(x.from), to: px(x.to) } as A;
    case "polygon":
    case "polyline":
      return { ...x, points: x.points.map(px) } as A;
    case "note":
      return { ...x, x: round(rect.x), y: round(rect.y) } as A;
    case "signature": {
      const ow = x.rect.w;
      const oh = x.rect.h;
      const kx = ow > 0 ? rect.w / ow : 1;
      const ky = oh > 0 ? rect.h / oh : 1;
      return { ...x, rect: { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) }, ...(x.strokes ? { strokes: x.strokes.map((s) => s.map((p): Pt => [round(p[0] * kx), round(p[1] * ky)])) } : {}) } as A;
    }
    default:
      return { ...x, rect: { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) } } as A;
  }
}

/** A point to show a comment at, for an annotation: the note's corner, the start of the marked text, the start of a line. */
export function anchorOf(a: Annotation): { x: number; y: number; quote?: string } {
  switch (a.type) {
    case "note":
      return { x: a.x, y: a.y };
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly": {
      const r = a.rects[0];
      return { x: r ? r.x : 0, y: r ? r.y : 0, ...(a.quote ? { quote: a.quote } : {}) };
    }
    case "redact": {
      const r = a.rects[0];
      return { x: r?.x ?? 0, y: r?.y ?? 0 };
    }
    case "line":
      return { x: a.from[0], y: a.from[1] };
    case "ink":
      return { x: a.strokes[0]?.[0]?.[0] ?? 0, y: a.strokes[0]?.[0]?.[1] ?? 0 };
    case "polygon":
    case "polyline":
      return { x: a.points[0]?.[0] ?? 0, y: a.points[0]?.[1] ?? 0 };
    default:
      return { x: a.rect.x, y: a.rect.y };
  }
}
