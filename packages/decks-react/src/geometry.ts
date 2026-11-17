import type { Box, ResolvedElement, Scene } from "@pli.dev/decks";
import type { Crop } from "@pli.dev/decks";

export interface Frame extends Box {
  rotation: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Which way each handle pulls its edges: -1 left or up, 1 right or down. */
export const HANDLE_DIR: Record<Handle, [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotatePoint(x: number, y: number, cx: number, cy: number, deg: number): { x: number; y: number } {
  const a = rad(deg);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

export const centerOf = (f: Box) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 });

/** The four corners of a frame as drawn (rotated about its centre), clockwise from the top left. */
export function corners(f: Frame): { x: number; y: number }[] {
  const c = centerOf(f);
  return [
    [f.x, f.y],
    [f.x + f.w, f.y],
    [f.x + f.w, f.y + f.h],
    [f.x, f.y + f.h],
  ].map(([x, y]) => rotatePoint(x!, y!, c.x, c.y, f.rotation));
}

/** The smallest unrotated box that holds a frame as drawn. */
export function visualBounds(f: Frame): Box {
  if (!f.rotation) return { x: f.x, y: f.y, w: f.w, h: f.h };
  const cs = corners(f);
  const xs = cs.map((p) => p.x);
  const ys = cs.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Whether a point is inside a frame (as rotated), with `slop` extra points all round. */
export function inFrame(f: Frame, px: number, py: number, slop = 0): boolean {
  const c = centerOf(f);
  const p = f.rotation ? rotatePoint(px, py, c.x, c.y, -f.rotation) : { x: px, y: py };
  return p.x >= f.x - slop && p.x <= f.x + f.w + slop && p.y >= f.y - slop && p.y <= f.y + f.h + slop;
}

/** Distance from a point to the edge of a frame's box (for shapes that are only an outline). */
function edgeDistance(f: Frame, px: number, py: number): number {
  const c = centerOf(f);
  const p = f.rotation ? rotatePoint(px, py, c.x, c.y, -f.rotation) : { x: px, y: py };
  const dx = Math.max(f.x - p.x, 0, p.x - (f.x + f.w));
  const dy = Math.max(f.y - p.y, 0, p.y - (f.y + f.h));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - f.x, f.x + f.w - p.x, p.y - f.y, f.y + f.h - p.y);
}

function segmentDistance(f: Frame, px: number, py: number, flipH: boolean, flipV: boolean): number {
  // A line runs corner to corner of its box.
  const c = centerOf(f);
  const a = rotatePoint(flipH ? f.x + f.w : f.x, flipV ? f.y + f.h : f.y, c.x, c.y, f.rotation);
  const b = rotatePoint(flipH ? f.x : f.x + f.w, flipV ? f.y : f.y + f.h, c.x, c.y, f.rotation);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * abx + (py - a.y) * aby) / len2));
  return Math.hypot(px - (a.x + t * abx), py - (a.y + t * aby));
}

const isLineGeometry = (g: string) => /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(g);

export const frameOfElement = (el: ResolvedElement): Frame => ({ x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation });

/** Whether a click lands on an element: inside it, unless it is an empty outline (a line, or a shape with no fill and no text), which takes only its edge. */
export function hitsElement(el: ResolvedElement, x: number, y: number, tolerance: number): boolean {
  const f = frameOfElement(el);
  if (el.kind === "shape" && isLineGeometry(el.geometry)) return segmentDistance(f, x, y, el.flipH, el.flipV) <= tolerance;
  if (!inFrame(f, x, y, tolerance)) return false;
  if (el.kind === "shape" && el.fill.kind === "none" && !el.placeholder) {
    const hasText = !!el.text && el.text.paragraphs.some((p) => p.runs.some((r) => r.text !== ""));
    if (!hasText && edgeDistance(f, x, y) > tolerance) return false;
  }
  return true;
}

/** The topmost element a point lands on, among those drawn from `from` (a slide's own, or the layout being edited). */
export function hitTest(scene: Scene, from: ResolvedElement["from"], x: number, y: number, tolerance = 4): ResolvedElement | null {
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    const el = scene.elements[i]!;
    if (el.from !== from || el.hidden) continue;
    if (hitsElement(el, x, y, tolerance)) return el;
  }
  return null;
}

/** The elements a rectangle touches. */
export function inRect(scene: Scene, from: ResolvedElement["from"], r: Box): ResolvedElement[] {
  const out: ResolvedElement[] = [];
  for (const el of scene.elements) {
    if (el.from !== from || el.hidden) continue;
    const b = visualBounds(frameOfElement(el));
    if (b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y) out.push(el);
  }
  return out;
}

export interface ResizeOptions {
  /** Keep the width-to-height ratio. */
  keepAspect?: boolean;
  /** Resize about the centre (alt). */
  fromCenter?: boolean;
  min?: number;
}

/** The frame after dragging a handle to a point (in slide coordinates). Rotation is respected: the opposite edge stays put. */
export function resizeFrame(f: Frame, handle: Handle, px: number, py: number, options: ResizeOptions = {}): Frame {
  const min = options.min ?? 4;
  const [hx, hy] = HANDLE_DIR[handle];
  const c = centerOf(f);
  const p = rotatePoint(px, py, c.x, c.y, -f.rotation);
  // local, relative to the old centre
  const lx = p.x - c.x;
  const ly = p.y - c.y;
  let w = f.w;
  let h = f.h;
  if (options.fromCenter) {
    if (hx) w = Math.max(min, 2 * hx * lx);
    if (hy) h = Math.max(min, 2 * hy * ly);
  } else {
    if (hx) w = Math.max(min, hx * (lx + (hx * f.w) / 2));
    if (hy) h = Math.max(min, hy * (ly + (hy * f.h) / 2));
  }
  if (options.keepAspect && f.w > 0 && f.h > 0) {
    const ratio = f.w / f.h;
    if (hx && hy) {
      const k = Math.max(w / f.w, h / f.h);
      w = Math.max(min, f.w * k);
      h = w / ratio;
    } else if (hx) h = Math.max(min, w / ratio);
    else w = Math.max(min, h * ratio);
  }
  // the centre moves so that the opposite edge stays where it was
  let cx = 0;
  let cy = 0;
  if (!options.fromCenter) {
    if (hx) cx = (hx * (w - f.w)) / 2;
    if (hy) cy = (hy * (h - f.h)) / 2;
  }
  const nc = rotatePoint(c.x + cx, c.y + cy, c.x, c.y, f.rotation);
  return { x: nc.x - w / 2, y: nc.y - h / 2, w, h, rotation: f.rotation };
}

/** The angle (degrees clockwise from straight up) of a point seen from a frame's centre. */
export function angleTo(f: Box, px: number, py: number): number {
  const c = centerOf(f);
  return (Math.atan2(py - c.y, px - c.x) * 180) / Math.PI + 90;
}

export function normalizeAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return Math.round(a * 100) / 100;
}

/** Moves boxes with their selection's bounds when the bounds are resized from `from` to `to`. */
export function scaleWithin(b: Box, from: Box, to: Box): Box {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  return { x: to.x + (b.x - from.x) * sx, y: to.y + (b.y - from.y) * sy, w: b.w * sx, h: b.h * sy };
}

/** The bounds of a selection after dragging one of its handles (never rotated). */
export function resizeBounds(b: Box, handle: Handle, px: number, py: number, options: ResizeOptions = {}): Box {
  const r = resizeFrame({ ...b, rotation: 0 }, handle, px, py, options);
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/**
 * Cropping: dragging an edge handle of a picture moves that edge of the frame and changes the crop by the same amount of picture,
 * so the picture itself stays where it is on the slide. Returns the new frame and crop (the frame is not rotated here).
 */
export function cropByHandle(f: Frame, crop: Crop, handle: Handle, px: number, py: number): { frame: Frame; crop: Crop } {
  const [hx, hy] = HANDLE_DIR[handle];
  const c = centerOf(f);
  const p = rotatePoint(px, py, c.x, c.y, -f.rotation);
  const l = crop.l ?? 0;
  const t = crop.t ?? 0;
  const r = crop.r ?? 0;
  const b = crop.b ?? 0;
  const fullW = f.w / Math.max(0.01, 1 - l - r);
  const fullH = f.h / Math.max(0.01, 1 - t - b);
  const next: Crop = { l, t, r, b };
  let left = f.x;
  let top = f.y;
  let right = f.x + f.w;
  let bottom = f.y + f.h;
  const pictureLeft = f.x - l * fullW;
  const pictureTop = f.y - t * fullH;
  const pictureRight = pictureLeft + fullW;
  const pictureBottom = pictureTop + fullH;
  if (hx < 0) left = Math.min(Math.max(p.x, pictureLeft), right - 4);
  if (hx > 0) right = Math.max(Math.min(p.x, pictureRight), left + 4);
  if (hy < 0) top = Math.min(Math.max(p.y, pictureTop), bottom - 4);
  if (hy > 0) bottom = Math.max(Math.min(p.y, pictureBottom), top + 4);
  next.l = (left - pictureLeft) / fullW;
  next.r = (pictureRight - right) / fullW;
  next.t = (top - pictureTop) / fullH;
  next.b = (pictureBottom - bottom) / fullH;
  for (const k of ["l", "t", "r", "b"] as const) next[k] = Math.round(Math.max(0, next[k]!) * 10000) / 10000;
  return { frame: { x: left, y: top, w: right - left, h: bottom - top, rotation: f.rotation }, crop: next };
}
