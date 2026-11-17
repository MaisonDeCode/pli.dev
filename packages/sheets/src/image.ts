import { PliError } from "@pli.dev/core";
import { MAX_CHART_SIZE } from "./chart";
import type { Bounds } from "./address";
import { colNumber } from "./address";
import { cleanArtistic, cleanGlow, cleanReflection, cleanSoftEdge } from "./image-effects";
import { cleanShape, cleanShapeAdjust } from "./image-shape";
import type { CellPicture, Dimension, ImageBorder, ImageCrop, ImageShadow, Sheet, SheetImage } from "./model";

/** The kinds of picture a sheet keeps: the ones Excel writes without conversion and every browser draws. */
export type ImageType = "png" | "jpeg" | "gif";

/** The most a picture may weigh, as the bytes of the file. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_IMAGE_WIDTH = 480;
export const DEFAULT_IMAGE_HEIGHT = 360;
export const MAX_ALT_LENGTH = 1000;
/** The least a picture may measure across or high, in pixels. */
export const MIN_IMAGE_SIZE = 4;

const MIME: Record<ImageType, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif" };
const URI = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** The bytes of a base64 string. */
export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A `data:` URI for a picture's bytes. */
export function toDataUri(bytes: Uint8Array, type: ImageType): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${MIME[type]};base64,${btoa(raw)}`;
}

/** What the first bytes say a file is, and how big the picture is in pixels; null when it isn't a picture of a kind kept here, or is cut short. */
export function sniffImage(b: Uint8Array): { type: ImageType; width: number; height: number } | null {
  const u16 = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && u32(12) === 0x49484452) {
    const width = u32(16);
    const height = u32(20);
    return width > 0 && height > 0 ? { type: "png", width, height } : null;
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    const width = b[6]! | (b[7]! << 8);
    const height = b[8]! | (b[9]! << 8);
    return width > 0 && height > 0 ? { type: "gif", width, height } : null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        const height = u16(i + 5);
        const width = u16(i + 7);
        return width > 0 && height > 0 ? { type: "jpeg", width, height } : null;
      }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

/** Checked data URIs, by their ends, so that moving a picture doesn't decode it again. */
const seen = new Set<string>();

/** What a `data:` URI holds: the kind of picture, its size in pixels, and its bytes. Throws when it isn't a picture of a kind kept here. */
export function readImage(src: string): { type: ImageType; width: number; height: number; bytes: Uint8Array } {
  const m = typeof src === "string" ? URI.exec(src) : null;
  if (!m) return bad("A picture is a data: URI of a PNG, JPEG or GIF (data:image/png;base64,…)");
  if ((m[2]!.length * 3) / 4 > MAX_IMAGE_BYTES * 1.01) return bad(`A picture can weigh at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(m[2]!);
  } catch {
    return bad("That picture's data isn't valid base64");
  }
  if (bytes.length > MAX_IMAGE_BYTES) bad(`A picture can weigh at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  const info = sniffImage(bytes);
  if (!info) return bad("That isn't a PNG, JPEG or GIF picture, or it is damaged");
  if (info.type !== m[1]) bad(`That picture says it is a ${m[1]!.toUpperCase()} but its data is a ${info.type.toUpperCase()}`);
  return { ...info, bytes };
}

/** A picture made ready to keep, or an error that says what is wrong. */
export function cleanImage(image: SheetImage): SheetImage {
  if (typeof image.id !== "string" || image.id === "") bad("A picture needs an id");
  const key = `${image.src.length}:${image.src.slice(0, 128)}:${image.src.slice(-96)}`;
  if (!seen.has(key)) {
    readImage(image.src);
    if (seen.size > 64) seen.clear();
    seen.add(key);
  }
  const f = image.from;
  if (!f || !Number.isInteger(f.row) || !Number.isInteger(f.col) || f.row < 1 || f.col < 1) bad("A picture needs a cell to sit in");
  for (const n of [image.width, image.height]) if (!(n >= MIN_IMAGE_SIZE && n <= MAX_CHART_SIZE)) bad(`A picture is ${MIN_IMAGE_SIZE} to ${MAX_CHART_SIZE} pixels across and high`);
  for (const d of [f.dx, f.dy]) if (d !== undefined && !(d >= 0 && Number.isFinite(d))) bad("A picture's offset in its cell must be 0 or more");
  if (image.alt !== undefined && (typeof image.alt !== "string" || image.alt.length > MAX_ALT_LENGTH)) bad(`A picture's description can be at most ${MAX_ALT_LENGTH} characters`);
  const out: SheetImage = { id: image.id, src: image.src, from: { row: f.row, col: f.col, ...(f.dx ? { dx: f.dx } : {}), ...(f.dy ? { dy: f.dy } : {}) }, width: image.width, height: image.height };
  if (image.alt) out.alt = image.alt;
  if (image.placement !== undefined && image.placement !== "move" && image.placement !== "size" && image.placement !== "free") bad('A picture moves "move", "size" or "free" with its cells');
  if (image.placement === "size" || image.placement === "free") out.placement = image.placement;
  if (image.placement === "size") {
    const t = image.to;
    if (!t) return bad("A picture that sizes with its cells needs the cell its bottom right corner is in");
    if (!Number.isInteger(t.row) || !Number.isInteger(t.col) || t.row < 1 || t.col < 1) bad("A picture that sizes with its cells needs the cell its bottom right corner is in");
    for (const d of [t.dx, t.dy]) if (d !== undefined && !(d >= 0 && Number.isFinite(d))) bad("A picture's offset in its cell must be 0 or more");
    out.to = { row: t.row, col: t.col, ...(t.dx ? { dx: t.dx } : {}), ...(t.dy ? { dy: t.dy } : {}) };
  } else if (image.to !== undefined) bad('Only a picture that sizes with its cells has a place for its bottom right corner ("to")');
  if (image.rotation !== undefined) {
    if (typeof image.rotation !== "number" || !Number.isFinite(image.rotation)) bad("A picture's rotation is a number of degrees");
    const r = ((image.rotation % 360) + 360) % 360;
    if (r !== 0) out.rotation = Math.round(r * 1000) / 1000;
  }
  for (const k of ["flipH", "flipV"] as const) {
    if (image[k] !== undefined && image[k] !== true) bad(`A picture's ${k} is true or left out`);
    if (image[k]) out[k] = true;
  }
  if (image.crop !== undefined) {
    const crop = cleanCrop(image.crop);
    if (crop) out.crop = crop;
  }
  if (image.border !== undefined) out.border = cleanBorder(image.border);
  if (image.shadow !== undefined) out.shadow = cleanShadow(image.shadow);
  for (const k of ["brightness", "contrast"] as const) {
    const v = image[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < -1 || v > 1) bad(`A picture's ${k} is a number from -1 to 1`);
    if (v !== 0) out[k] = Math.round(v * 1000) / 1000;
  }
  if (image.grayscale !== undefined && image.grayscale !== true) bad("A picture's grayscale is true or left out");
  if (image.grayscale) out.grayscale = true;
  if (image.glow !== undefined) out.glow = cleanGlow(image.glow);
  if (image.softEdge !== undefined) {
    const edge = cleanSoftEdge(image.softEdge);
    if (edge) out.softEdge = edge;
  }
  if (image.reflection !== undefined) out.reflection = cleanReflection(image.reflection);
  if (image.artistic !== undefined) out.artistic = cleanArtistic(image.artistic);
  if (image.shape !== undefined) out.shape = cleanShape(image.shape);
  if (image.shapeAdjust !== undefined) {
    if (!out.shape) bad("Shape adjustments need a shape");
    const adjust = cleanShapeAdjust(out.shape!, image.shapeAdjust, out.width, out.height);
    if (adjust) out.shapeAdjust = adjust;
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const MAX_BORDER_WIDTH = 20;
export const MAX_SHADOW_REACH = 100;

/** A picture's border made ready to keep. */
export function cleanBorder(border: ImageBorder): ImageBorder {
  if (!border || typeof border !== "object" || typeof border.color !== "string" || !HEX.test(border.color)) return bad("A picture's border needs a colour like #rrggbb");
  const out: ImageBorder = { color: border.color.toLowerCase() };
  if (border.width !== undefined) {
    if (typeof border.width !== "number" || !(border.width >= 0.25 && border.width <= MAX_BORDER_WIDTH)) bad(`A picture's border is 0.25 to ${MAX_BORDER_WIDTH} points wide`);
    if (border.width !== 1) out.width = border.width;
  }
  if (border.dash !== undefined) {
    if (border.dash !== "solid" && border.dash !== "dash" && border.dash !== "dot") bad('A picture\'s border is "solid", "dash" or "dot"');
    if (border.dash !== "solid") out.dash = border.dash;
  }
  return out;
}

/** A picture's shadow made ready to keep; each part that is the usual one is left out. */
export function cleanShadow(shadow: ImageShadow): ImageShadow {
  if (!shadow || typeof shadow !== "object") return bad("A picture's shadow says how it looks");
  const out: ImageShadow = {};
  if (shadow.color !== undefined) {
    if (typeof shadow.color !== "string" || !HEX.test(shadow.color)) bad("A picture's shadow colour is like #rrggbb");
    if (shadow.color.toLowerCase() !== "#000000") out.color = shadow.color.toLowerCase();
  }
  const num = (k: "blur" | "distance", lo: number, hi: number, usual: number) => {
    const v = shadow[k];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) bad(`A picture's shadow ${k} is ${lo} to ${hi}`);
    if (v !== usual) out[k] = v;
  };
  num("blur", 0, MAX_SHADOW_REACH, 6);
  num("distance", 0, MAX_SHADOW_REACH, 4);
  if (shadow.angle !== undefined) {
    if (typeof shadow.angle !== "number" || !Number.isFinite(shadow.angle)) bad("A picture's shadow angle is a number of degrees");
    const a = ((shadow.angle % 360) + 360) % 360;
    if (a !== 45) out.angle = a;
  }
  if (shadow.opacity !== undefined) {
    if (typeof shadow.opacity !== "number" || !(shadow.opacity >= 0 && shadow.opacity <= 1)) bad("A picture's shadow opacity is 0 to 1");
    if (shadow.opacity !== 0.4) out.opacity = shadow.opacity;
  }
  return out;
}

/** A picture for a cell made ready to keep, or an error that says what is wrong with it. */
export function cleanCellPicture(picture: CellPicture): CellPicture {
  if (!picture || typeof picture !== "object") bad("A picture in a cell is a src and a description");
  const key = `${picture.src?.length}:${String(picture.src).slice(0, 128)}:${String(picture.src).slice(-96)}`;
  if (!seen.has(key)) {
    readImage(picture.src);
    if (seen.size > 64) seen.clear();
    seen.add(key);
  }
  if (picture.alt !== undefined && (typeof picture.alt !== "string" || picture.alt.length > MAX_ALT_LENGTH)) bad(`A picture's description can be at most ${MAX_ALT_LENGTH} characters`);
  return { src: picture.src, ...(picture.alt ? { alt: picture.alt } : {}) };
}

/** A crop made ready to keep: only the sides that cut something. Null when nothing is cut. */
export function cleanCrop(crop: ImageCrop): ImageCrop | null {
  if (!crop || typeof crop !== "object") return bad("A crop says how much to cut off each side");
  const out: ImageCrop = {};
  for (const k of ["left", "top", "right", "bottom"] as const) {
    const v = crop[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v >= 1) bad("A crop cuts 0 up to less than the whole of a side");
    if (v > 0) out[k] = Math.round(v * 100000) / 100000;
  }
  if ((out.left ?? 0) + (out.right ?? 0) >= 1 || (out.top ?? 0) + (out.bottom ?? 0) >= 1) bad("A crop must leave some of the picture");
  return Object.keys(out).length ? out : null;
}

/** A picture's natural size, scaled down (never up) to fit the default size and kept in proportion. */
export function defaultImageSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, DEFAULT_IMAGE_WIDTH / width, DEFAULT_IMAGE_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The pixel size of a column or row, as the grid draws it. */
export const columnPixels = (sheet: Sheet, col: number): number => {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  const d = sheet.columns?.[s];
  return d?.hidden ? 0 : d?.size !== undefined ? Math.round(d.size * 7 + 5) : 64;
};
export const rowPixelsOf = (sheet: Sheet, row: number): number => {
  const d = sheet.rows?.[String(row)];
  return d?.hidden ? 0 : d?.size !== undefined ? Math.round((d.size * 4) / 3) : 20;
};

/** How many pixels wide and high a range of cells is on a sheet. */
export function rangePixels(sheet: Sheet, b: Bounds): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (let c = b.c1; c <= b.c2; c++) width += columnPixels(sheet, c);
  for (let r = b.r1; r <= b.r2; r++) height += rowPixelsOf(sheet, r);
  return { width, height };
}

// ---- where a picture is, in the layout the workbook itself holds (column widths and row heights as saved) ----

const sizeOf = (d: Dimension | undefined, axis: "col" | "row"): number => (d?.hidden ? 0 : d?.size !== undefined ? (axis === "col" ? Math.round(d.size * 7 + 5) : Math.round((d.size * 4) / 3)) : axis === "col" ? 64 : 20);
const DEFAULT_SIZE = { col: 64, row: 20 } as const;

/** The custom column widths or row heights of a sheet, in order: where each is, and how many pixels it is. */
function dimensions(sheet: Sheet, axis: "col" | "row"): { index: number; px: number }[] {
  const dims = axis === "col" ? sheet.columns : sheet.rows;
  if (!dims) return [];
  return Object.entries(dims)
    .map(([k, d]) => ({ index: axis === "col" ? colNumber(k) : Number(k), px: sizeOf(d, axis) }))
    .filter((d) => Number.isInteger(d.index) && d.index >= 1)
    .sort((a, b) => a.index - b.index);
}

/** How far the left edge of a column, or the top of a row (1-based), is from the sheet's corner, in pixels. */
export function axisOffsetPx(sheet: Sheet, axis: "col" | "row", n: number): number {
  const def = DEFAULT_SIZE[axis];
  let px = (n - 1) * def;
  for (const d of dimensions(sheet, axis)) {
    if (d.index >= n) break;
    px += d.px - def;
  }
  return px;
}

/** The column or row a distance from the sheet's corner falls in, and how far into it. */
export function axisAtPx(sheet: Sheet, axis: "col" | "row", px: number): { index: number; off: number } {
  const def = DEFAULT_SIZE[axis];
  const at = Math.max(0, px);
  let pos = 0;
  let idx = 1;
  for (const d of dimensions(sheet, axis)) {
    const gap = d.index - idx;
    if (gap > 0) {
      if (at < pos + gap * def) {
        const k = Math.floor((at - pos) / def);
        return { index: idx + k, off: at - pos - k * def };
      }
      pos += gap * def;
      idx = d.index;
    }
    if (at < pos + d.px) return { index: idx, off: at - pos };
    pos += d.px;
    idx++;
  }
  const k = Math.floor((at - pos) / def);
  return { index: idx + k, off: at - pos - k * def };
}

/** Where a picture is on a sheet laid out as the workbook says, in pixels from the sheet's corner. A picture that sizes with its cells is as big as the cells between its corners. */
export function imageBox(sheet: Sheet, image: SheetImage): { left: number; top: number; width: number; height: number } {
  const left = axisOffsetPx(sheet, "col", image.from.col) + (image.from.dx ?? 0);
  const top = axisOffsetPx(sheet, "row", image.from.row) + (image.from.dy ?? 0);
  if (image.placement === "size" && image.to) {
    const right = axisOffsetPx(sheet, "col", image.to.col) + (image.to.dx ?? 0);
    const bottom = axisOffsetPx(sheet, "row", image.to.row) + (image.to.dy ?? 0);
    return { left, top, width: Math.max(MIN_IMAGE_SIZE, right - left), height: Math.max(MIN_IMAGE_SIZE, bottom - top) };
  }
  return { left, top, width: image.width, height: image.height };
}

const cellAt = (sheet: Sheet, left: number, top: number): { row: number; col: number; dx?: number; dy?: number } => {
  const c = axisAtPx(sheet, "col", left);
  const r = axisAtPx(sheet, "row", top);
  const dx = Math.round(c.off);
  const dy = Math.round(r.off);
  return { row: r.index, col: c.index, ...(dx ? { dx } : {}), ...(dy ? { dy } : {}) };
};

/** The picture put where `box` is on `sheet`: its corner in whatever cell is there now. Pictures that size with their cells get their other corner too. */
export function placeImage(sheet: Sheet, image: SheetImage, box: { left: number; top: number; width: number; height: number }): SheetImage {
  const from = cellAt(sheet, box.left, box.top);
  const width = Math.max(MIN_IMAGE_SIZE, Math.round(box.width));
  const height = Math.max(MIN_IMAGE_SIZE, Math.round(box.height));
  const out: SheetImage = { ...image, from, width, height };
  if (image.placement === "size") out.to = cellAt(sheet, box.left + width, box.top + height);
  return out;
}

/** A picture that sizes with its cells, with its size read from its two corners in the layout of `sheet`. */
function sizeFromCorners(sheet: Sheet, image: SheetImage): SheetImage {
  if (image.placement !== "size" || !image.to) return image;
  const box = imageBox(sheet, image);
  return box.width === image.width && box.height === image.height ? image : { ...image, width: Math.round(box.width), height: Math.round(box.height) };
}

/** After rows or columns changed size or were hidden: pictures that size with their cells stretch, and those that don't follow their cells stay put on the sheet. */
export function refitImages(before: Sheet, after: Sheet): SheetImage[] | undefined {
  if (!after.images) return undefined;
  return after.images.map((image) => {
    if (image.placement === "free") return placeImage(after, image, imageBox(before, image));
    return sizeFromCorners(after, image);
  });
}

/** A picture after rows or columns were inserted or deleted (`move` says where a row or column goes, or null if it is gone; `gap` where the gap a deleted one leaves is). */
export function shiftImage(image: SheetImage, before: Sheet, after: Sheet, axis: "row" | "col", move: (n: number) => number | null, gap: (n: number) => number, max: number): SheetImage {
  if (image.placement === "free") return placeImage(after, image, imageBox(before, image));
  const key = axis;
  const offset = axis === "row" ? "dy" : "dx";
  const shifted = <T extends { row: number; col: number }>(c: T): T => {
    const n = c[key];
    const moved = move(n);
    const m = moved ?? gap(n);
    if (m === n) return c;
    // A corner whose cell was deleted is at the gap, at the start of the cell that is there now.
    return { ...c, [key]: Math.max(1, Math.min(m, max)), ...(moved === null ? { [offset]: undefined } : {}) };
  };
  const from = shifted(image.from);
  if (image.placement === "size" && image.to) return sizeFromCorners(after, { ...image, from, to: shifted(image.to) });
  return from === image.from ? image : { ...image, from };
}
