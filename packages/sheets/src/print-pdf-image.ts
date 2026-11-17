import type { PdfImage } from "@pli.dev/docs";
import { applyArtistic } from "./artistic";
import { readImage } from "./image";
import type { ImageArtistic } from "./model";
import { decodePng, type Rgba } from "./png";

/*
 * Pictures for a PDF: what a `data:` address holds as the pixels the PDF writer takes, with the corrections a sheet's pictures
 * have (cropped, mirrored, turned, brighter or darker, grey, an artistic effect) worked on the pixels. A JPEG is passed through as it
 * is when nothing needs doing to it, since there is no JPEG reader here; a GIF can't be read at all.
 */

/** How many colour channels a JPEG has (1 grey, 3 colour, 4 CMYK), from its frame header. */
export function jpegComponents(b: Uint8Array): 1 | 3 | 4 {
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
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const n = b[i + 9];
      return n === 1 ? 1 : n === 4 ? 4 : 3;
    }
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return 3;
}

/** What is done to a picture's pixels on the way to the page. */
export interface PictureCare {
  /** Cut off from each side, as fractions of the picture. */
  crop?: { left?: number; top?: number; right?: number; bottom?: number };
  flipH?: boolean;
  flipV?: boolean;
  /** Degrees clockwise, about the middle. */
  rotation?: number;
  brightness?: number;
  contrast?: number;
  grayscale?: boolean;
  artistic?: ImageArtistic;
}

/** Whether the pixels have to be worked on (a JPEG can't be). */
const needsPixels = (c: PictureCare): boolean =>
  !!(c.flipH || c.flipV || c.rotation || c.brightness || c.contrast || c.grayscale || c.artistic || c.crop?.left || c.crop?.top || c.crop?.right || c.crop?.bottom);

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** The picture with its pixels cropped, mirrored, corrected and turned. A turn gives a larger picture (the turned one's bounding box) with see-through corners. */
export function carePixels(src: Rgba, care: PictureCare, displayW: number, displayH: number): { rgba: Rgba; turned: boolean } {
  let r: Rgba = src;
  if (care.artistic) r = applyArtistic(r, care.artistic);
  const c = care.crop;
  if (c && (c.left || c.top || c.right || c.bottom)) {
    const x0 = Math.min(r.width - 1, Math.round((c.left ?? 0) * r.width));
    const y0 = Math.min(r.height - 1, Math.round((c.top ?? 0) * r.height));
    const x1 = Math.max(x0 + 1, r.width - Math.round((c.right ?? 0) * r.width));
    const y1 = Math.max(y0 + 1, r.height - Math.round((c.bottom ?? 0) * r.height));
    const w = x1 - x0;
    const h = y1 - y0;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) data.set(r.data.subarray(((y0 + y) * r.width + x0) * 4, ((y0 + y) * r.width + x1) * 4), y * w * 4);
    r = { width: w, height: h, data };
  }
  if (care.flipH || care.flipV) {
    const out = new Uint8ClampedArray(r.data.length);
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const sx = care.flipH ? r.width - 1 - x : x;
        const sy = care.flipV ? r.height - 1 - y : y;
        out.set(r.data.subarray((sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4), (y * r.width + x) * 4);
      }
    r = { width: r.width, height: r.height, data: out };
  }
  if (care.brightness || care.contrast || care.grayscale) {
    const bright = 1 + (care.brightness ?? 0);
    const contrast = 1 + (care.contrast ?? 0);
    const data = new Uint8ClampedArray(r.data);
    for (let i = 0; i < data.length; i += 4) {
      let red = data[i]!;
      let green = data[i + 1]!;
      let blue = data[i + 2]!;
      if (care.brightness) (red *= bright, (green *= bright), (blue *= bright));
      if (care.contrast) (red = (red - 128) * contrast + 128, (green = (green - 128) * contrast + 128), (blue = (blue - 128) * contrast + 128));
      if (care.grayscale) red = green = blue = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      data[i] = clamp(red);
      data[i + 1] = clamp(green);
      data[i + 2] = clamp(blue);
    }
    r = { width: r.width, height: r.height, data };
  }
  const turn = ((care.rotation ?? 0) % 360 + 360) % 360;
  if (turn === 0) return { rgba: r, turned: false };
  // Turn it as it is shown: scaled to the size it has on the page (up to twice that, if its own pixels allow), then rotated about the middle.
  const k = Math.min(2, Math.max(1, Math.min(r.width / displayW, r.height / displayH)));
  const w = Math.max(1, Math.round(displayW * k));
  const h = Math.max(1, Math.round(displayH * k));
  const rad = (turn * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const bw = Math.max(1, Math.ceil(Math.abs(w * cos) + Math.abs(h * sin)));
  const bh = Math.max(1, Math.ceil(Math.abs(w * sin) + Math.abs(h * cos)));
  const data = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      // Where this pixel was before the turn (inverse rotation), in the picture's own pixels.
      const dx = x + 0.5 - bw / 2;
      const dy = y + 0.5 - bh / 2;
      const ux = dx * cos + dy * sin + w / 2;
      const uy = -dx * sin + dy * cos + h / 2;
      if (ux < 0 || uy < 0 || ux >= w || uy >= h) continue;
      const sx = Math.min(r.width - 1, Math.floor((ux / w) * r.width));
      const sy = Math.min(r.height - 1, Math.floor((uy / h) * r.height));
      data.set(r.data.subarray((sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4), (y * bw + x) * 4);
    }
  return { rgba: { width: bw, height: bh, data }, turned: true };
}

export interface PdfPicture {
  image: PdfImage;
  /** Whether the pixels were turned: the image is then the bounding box of the picture's frame, centred on it. */
  turned: boolean;
  /** What had to be left out, in words. */
  skipped: string[];
}

/**
 * A picture for the PDF writer. Null when it can't be read (a GIF, or a damaged file). A JPEG that needs working on is passed
 * as it is, and `skipped` says what was left out.
 */
export function pdfPicture(src: string, care: PictureCare, displayW: number, displayH: number): PdfPicture | null {
  let read;
  try {
    read = readImage(src);
  } catch {
    return null;
  }
  if (read.type === "gif") return null;
  if (read.type === "jpeg") {
    const skipped = needsPixels(care) ? ["a JPEG picture is printed as it is, without its crop, turn or corrections"] : [];
    return { image: { jpeg: read.bytes, width: read.width, height: read.height, components: jpegComponents(read.bytes) }, turned: false, skipped };
  }
  const decoded = decodePng(read.bytes);
  if (!decoded) return null;
  const done = needsPixels(care) ? carePixels(decoded, care, displayW, displayH) : { rgba: decoded, turned: false };
  return { image: { rgba: new Uint8Array(done.rgba.data.buffer, done.rgba.data.byteOffset, done.rgba.data.byteLength), width: done.rgba.width, height: done.rgba.height }, turned: done.turned, skipped: [] };
}
