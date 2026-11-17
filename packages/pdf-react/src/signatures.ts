import { decodeBase64, encodeBase64, createId } from "@pli.dev/core";
import type { PdfPicture, Pt } from "@pli.dev/pdf";
import { readStored, writeStored } from "./annotStyles";
import { round2 } from "./annotGeometry";

/** A signature as the dialog makes it, before it has a place on a page. */
export type SignatureValue =
  | {
      mode: "draw";
      /** Strokes in a box of `width` by `height` points that starts at 0, 0. */
      strokes: Pt[][];
      width: number;
      height: number;
      color: string;
      /** Line width, points. */
      lineWidth: number;
    }
  | { mode: "type"; text: string; font: string; color: string }
  | { mode: "image"; picture: PdfPicture };

export interface SavedSignature {
  id: string;
  kind: "signature" | "initials";
  value: SignatureValue;
  created: number;
}

const MAX_SAVED = 8;
const keyFor = (namespace: string, user: string | undefined) => `${namespace}:signatures:${user ?? "anonymous"}`;

/** The signatures and initials this person saved in this browser. */
export function loadSignatures(namespace: string, user?: string): SavedSignature[] {
  const list = readStored<SavedSignature[]>(keyFor(namespace, user), []);
  return Array.isArray(list) ? list.filter((s) => s && typeof s.id === "string" && s.value && (s.kind === "signature" || s.kind === "initials")) : [];
}

export function saveSignature(namespace: string, user: string | undefined, kind: SavedSignature["kind"], value: SignatureValue, now = Date.now()): SavedSignature[] {
  const next: SavedSignature = { id: createId("sg_"), kind, value, created: now };
  const list = [next, ...loadSignatures(namespace, user)];
  // Keep the newest few of each kind.
  const kept = [...list.filter((s) => s.kind === "signature").slice(0, MAX_SAVED), ...list.filter((s) => s.kind === "initials").slice(0, MAX_SAVED)].sort((a, b) => b.created - a.created);
  writeStored(keyFor(namespace, user), kept);
  return kept;
}

export function removeSignature(namespace: string, user: string | undefined, id: string): SavedSignature[] {
  const list = loadSignatures(namespace, user).filter((s) => s.id !== id);
  writeStored(keyFor(namespace, user), list);
  return list;
}

/**
 * Moves strokes so their ink starts at 0, 0 (padded by the line width), and reports the box. A drawn signature is
 * trimmed this way: whatever whitespace the pad had around it does not become part of the stamp.
 */
export function normaliseStrokes(strokes: readonly (readonly Pt[])[], lineWidth: number): { strokes: Pt[][]; width: number; height: number } {
  const pts = strokes.flat();
  if (pts.length === 0) return { strokes: [], width: 0, height: 0 };
  const x1 = Math.min(...pts.map((p) => p[0]));
  const y1 = Math.min(...pts.map((p) => p[1]));
  const x2 = Math.max(...pts.map((p) => p[0]));
  const y2 = Math.max(...pts.map((p) => p[1]));
  const pad = lineWidth / 2;
  return {
    strokes: strokes.map((s) => s.map((p): Pt => [round2(p[0] - x1 + pad), round2(p[1] - y1 + pad)])),
    width: round2(x2 - x1 + lineWidth),
    height: round2(y2 - y1 + lineWidth),
  };
}

/** The strokes of a drawn signature, scaled from their own box to one of `w` by `h`. */
export function scaleStrokes(value: Extract<SignatureValue, { mode: "draw" }>, w: number, h: number): Pt[][] {
  const fx = value.width > 0 ? w / value.width : 1;
  const fy = value.height > 0 ? h / value.height : 1;
  return value.strokes.map((s) => s.map((p): Pt => [round2(p[0] * fx), round2(p[1] * fy)]));
}

// ---- pictures ---------------------------------------------------------------------------------------------------

type Pixels = { data: ArrayLike<number> & { [i: number]: number }; width: number; height: number };

/**
 * The box (in pixels) that holds everything that is not transparent or white, or null when there is nothing. Used to
 * trim the empty margin off an uploaded signature.
 */
export function trimBounds(image: Pixels, options: { alpha?: number; white?: number } = {}): { x: number; y: number; w: number; h: number } | null {
  const alpha = options.alpha ?? 8;
  const white = options.white ?? 245;
  let x1 = image.width;
  let y1 = image.height;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const a = image.data[i + 3]!;
      const blank = a <= alpha || (image.data[i]! >= white && image.data[i + 1]! >= white && image.data[i + 2]! >= white);
      if (blank) continue;
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
  }
  return x2 < 0 ? null : { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

/**
 * Makes near-white pixels transparent, in place, fading the edge so a scanned signature does not keep a white halo.
 * `threshold` is the lowest channel value that counts as white.
 */
export function whiteToTransparent(image: { data: { [i: number]: number }; width: number; height: number }, threshold = 235): void {
  const n = image.width * image.height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const low = Math.min(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!);
    if (low >= threshold) image.data[i + 3] = 0;
    else if (low > threshold - 40) image.data[i + 3] = Math.round((image.data[i + 3]! * (threshold - low)) / 40);
  }
}

/** The pixel size of a PNG, JPEG or GIF from its first bytes, or null when it is none of them. */
export function imageSizeOf(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
      i += 2 + length;
    }
  }
  return null;
}

/** The bytes of a `data:` URI, or null. */
export function dataUriBytes(src: string): { bytes: Uint8Array; type: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
  if (!m || !m[2]) return null;
  try {
    const bytes = decodeBase64(m[3]!);
    return bytes ? { bytes, type: m[1] ?? "application/octet-stream" } : null;
  } catch {
    return null;
  }
}

/** A file as a `data:` URI (PNG, JPEG), with its pixel size when the header says. */
export async function fileToPicture(file: { type: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<PdfPicture> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = /^image\/(png|jpe?g|gif|webp)$/i.test(file.type) ? file.type : imageSizeOf(bytes) && bytes[0] === 0x89 ? "image/png" : "image/jpeg";
  const size = imageSizeOf(bytes);
  return { src: `data:${type};base64,${encodeBase64(bytes)}`, ...(size ?? {}) };
}

/**
 * Trims the empty margin off a picture and, if asked, makes white transparent, using a canvas (so only where there is
 * one: a browser). Returns the picture unchanged when it cannot.
 */
export async function cleanPicture(picture: PdfPicture, options: { removeWhite?: boolean; trim?: boolean } = {}): Promise<PdfPicture> {
  try {
    if (typeof document === "undefined" || typeof Image === "undefined") return picture;
    // Without a canvas (a server, a test) there is nothing to clean with: the picture is used as it is.
    if (!document.createElement("canvas").getContext?.("2d")) return picture;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timer = setTimeout(() => reject(new Error("The picture took too long to load")), 10_000);
      el.onload = () => (clearTimeout(timer), resolve(el));
      el.onerror = () => (clearTimeout(timer), reject(new Error("The picture could not be read")));
      el.src = picture.src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || canvas.width === 0 || canvas.height === 0) return picture;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (options.removeWhite) whiteToTransparent(pixels);
    ctx.putImageData(pixels, 0, 0);
    const box = options.trim === false ? null : trimBounds(pixels);
    const out = document.createElement("canvas");
    const w = box?.w ?? canvas.width;
    const h = box?.h ?? canvas.height;
    out.width = w;
    out.height = h;
    out.getContext("2d")?.drawImage(canvas, box?.x ?? 0, box?.y ?? 0, w, h, 0, 0, w, h);
    return { src: out.toDataURL("image/png"), width: w, height: h };
  } catch {
    return picture;
  }
}
