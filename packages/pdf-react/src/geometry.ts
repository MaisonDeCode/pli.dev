import type { Rect } from "@pli.dev/pdf";
import { runSlice, type TextRun } from "./renderer";

/**
 * Coordinates of the viewer.
 *
 * - Page space: points, origin at the top left of the page's visible box before the page is turned, y down (see `@pli.dev/pdf`).
 * - Screen space of a page: CSS pixels from the top left of the page as it is SHOWN (turned by `rotation`, scaled by `scale`).
 *
 * `scale` is CSS pixels per point: a zoom of 100% is `CSS_UNITS` (96 / 72), so a page is as big on the screen as on paper.
 */

export const CSS_UNITS = 96 / 72;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** The most pixels a canvas may hold (about 16 megapixels); more is drawn smaller and stretched by CSS. */
export const MAX_CANVAS_PIXELS = 16_000_000;

export type Rot = 0 | 90 | 180 | 270;

export const normRotation = (degrees: number): Rot => ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as Rot;

/** What a page looks like: its size in points (not turned), how it is turned, and the CSS pixels per point. */
export interface PageFrame {
  width: number;
  height: number;
  rotation: number;
  scale: number;
}

/** The size of the page as shown, in points. */
export function turnedSize(width: number, height: number, rotation: number): { width: number; height: number } {
  const r = normRotation(rotation);
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}

/** Page space to the shown page, in points (not yet scaled). */
export function pageToTurned(x: number, y: number, width: number, height: number, rotation: number): [number, number] {
  switch (normRotation(rotation)) {
    case 90:
      return [height - y, x];
    case 180:
      return [width - x, height - y];
    case 270:
      return [y, width - x];
    default:
      return [x, y];
  }
}

/** The shown page (points) back to page space. */
export function turnedToPage(tx: number, ty: number, width: number, height: number, rotation: number): [number, number] {
  switch (normRotation(rotation)) {
    case 90:
      return [ty, height - tx];
    case 180:
      return [width - tx, height - ty];
    case 270:
      return [width - ty, tx];
    default:
      return [tx, ty];
  }
}

/** A point of page space to CSS pixels from the top left of the page as shown. */
export function pageToScreen(frame: PageFrame, x: number, y: number): [number, number] {
  const [tx, ty] = pageToTurned(x, y, frame.width, frame.height, frame.rotation);
  return [tx * frame.scale, ty * frame.scale];
}

/** CSS pixels from the top left of the page as shown, to page space. */
export function screenToPage(frame: PageFrame, sx: number, sy: number): [number, number] {
  return turnedToPage(sx / frame.scale, sy / frame.scale, frame.width, frame.height, frame.rotation);
}

const boundsOf = (points: [number, number][]): Rect => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** A rectangle of page space on the screen (the box around it once turned). */
export function rectToScreen(frame: PageFrame, r: Rect): Rect {
  return boundsOf([pageToScreen(frame, r.x, r.y), pageToScreen(frame, r.x + r.w, r.y), pageToScreen(frame, r.x + r.w, r.y + r.h), pageToScreen(frame, r.x, r.y + r.h)]);
}

/** A rectangle on the screen (CSS pixels from the page's top left) as a rectangle of page space. */
export function screenToPageRect(frame: PageFrame, r: Rect): Rect {
  return boundsOf([screenToPage(frame, r.x, r.y), screenToPage(frame, r.x + r.w, r.y), screenToPage(frame, r.x + r.w, r.y + r.h), screenToPage(frame, r.x, r.y + r.h)]);
}

/**
 * The CSS `transform` that puts a layer laid out in page space (`width` by `height` pixels, `transform-origin: 0 0`) over
 * the page as shown: it scales and turns the layer, so text, tools and overlays all draw in page coordinates at any zoom.
 */
export function layerTransform(frame: PageFrame): string {
  const { width: w, height: h, scale: s } = frame;
  const r = normRotation(frame.rotation);
  const rotate = r === 0 ? "" : `rotate(${r}deg) `;
  const move = r === 90 ? `translate(${num(h * s)}px, 0) ` : r === 180 ? `translate(${num(w * s)}px, ${num(h * s)}px) ` : r === 270 ? `translate(0, ${num(w * s)}px) ` : "";
  return `${move}${rotate}scale(${num(s)})`;
}

/** Six decimals: the layer is scaled by the same number the page box was made with (rounding it to 0.001 moved the far edge of a big page by a pixel or more). */
const num = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The scale (CSS pixels per point) to draw a canvas at, and whether it had to be reduced to stay under `maxPixels`.
 * `css` is the scale on the screen, `dpr` the device pixel ratio.
 */
export function canvasScale(width: number, height: number, css: number, dpr: number, maxPixels = MAX_CANVAS_PIXELS): { scale: number; capped: boolean } {
  let scale = css * Math.max(1, dpr);
  const pixels = width * scale * (height * scale);
  if (pixels <= maxPixels) return { scale, capped: false };
  scale *= Math.sqrt(maxPixels / pixels);
  return { scale, capped: true };
}

// ---- Zoom ------------------------------------------------------------------------------------------------------

export type Zoom = number | "fit-width" | "fit-page";
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;
export const ZOOM_MENU = [0.5, 0.75, 1, 1.25, 1.5, 2, 4] as const;

export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** The next step up or down from `zoom` (a fraction, 1 is 100%). */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - eps) ?? MIN_ZOOM;
}

/**
 * The zoom (a fraction, 1 is 100%) that makes `content` (points, as shown) fit the viewport (CSS pixels) with `pad`
 * around it: `fit-width` fits its width, `fit-page` its width and height.
 */
export function fitZoom(mode: "fit-width" | "fit-page", content: { width: number; height: number }, viewport: { width: number; height: number }, pad: number): number {
  const byWidth = (viewport.width - 2 * pad) / (content.width * CSS_UNITS);
  if (mode === "fit-width") return clampZoom(byWidth);
  const byHeight = (viewport.height - 2 * pad) / (content.height * CSS_UNITS);
  return clampZoom(Math.min(byWidth, byHeight));
}

// ---- Selection -------------------------------------------------------------------------------------------------

export const TEXT_LAYER_CLASS = "pli-pdf-text-layer";

/** The runs shown by each text layer, so a selection can be measured in page space without asking the browser for pixels. */
export const textLayerRuns = new WeakMap<Element, readonly TextRun[]>();

export interface SelectedText {
  /** The page's id (the layer's `data-page`) and position in the document. */
  page: string;
  index: number;
  /** One rectangle per line of selected text, in page space. */
  rects: Rect[];
  /** The text selected on this page. */
  text: string;
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Joins rectangles that sit on the same line (they overlap in height by more than half) into one. */
export function mergeLines(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last) {
      const overlap = Math.min(last.y + last.h, r.y + r.h) - Math.max(last.y, r.y);
      const gap = r.x - (last.x + last.w);
      if (overlap > 0.5 * Math.min(last.h, r.h) && gap < Math.max(last.h, r.h) * 2 && gap > -Math.max(last.w, r.w)) {
        out[out.length - 1] = union(last, r);
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

/** Where, in a text node of a span, the range starts or ends (`edge`), or `fallback` if that edge lies outside the span. */
function offsetIn(span: Element, container: Node, offset: number, fallback: number): number {
  const text = span.firstChild;
  if (container === text) return offset;
  if (container === span) return offset <= 0 ? 0 : (span.textContent ?? "").length;
  return fallback;
}

/**
 * The text selected in the page's text layers as rectangles of page space, one per line per page: what a highlight,
 * underline or strike-out tool turns into an annotation. Measured from the runs the layers were made from, so it does not
 * depend on the browser's layout, zoom or the page's turn.
 */
export function selectionRects(range: Range, root: ParentNode = document): SelectedText[] {
  const out: SelectedText[] = [];
  const layers = [...root.querySelectorAll<HTMLElement>(`.${TEXT_LAYER_CLASS}`)];
  for (const layer of layers) {
    if (!range.intersectsNode(layer)) continue;
    const runs = textLayerRuns.get(layer);
    if (!runs) continue;
    const rects: Rect[] = [];
    let text = "";
    for (const span of Array.from(layer.children)) {
      const at = Number((span as HTMLElement).dataset.run);
      if (!Number.isInteger(at) || !range.intersectsNode(span)) continue;
      const run = runs[at];
      if (!run) continue;
      const len = run.str.length;
      const from = Math.max(0, Math.min(len, offsetIn(span, range.startContainer, range.startOffset, 0)));
      const to = Math.max(0, Math.min(len, offsetIn(span, range.endContainer, range.endOffset, len)));
      if (to <= from) continue;
      rects.push(runSlice(run, from, to));
      if (text && !/\s$/.test(text) && !/^\s/.test(run.str.slice(from, to))) text += " ";
      text += run.str.slice(from, to) + (run.eol ? "\n" : "");
    }
    if (rects.length) out.push({ page: layer.dataset.page ?? "", index: Number(layer.dataset.index ?? -1), rects: mergeLines(rects), text: text.replace(/\n$/, "") });
  }
  return out;
}
