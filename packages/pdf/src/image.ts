/**
 * Pictures as PDF image XObjects: JPEG goes in as it is (DCTDecode), PNG is decoded here (every colour type and bit depth,
 * interlaced or not) and stored as Flate-compressed samples with its transparency as a soft mask, and raw RGBA pixels
 * are stored the same way. Colour management (gamma, embedded ICC profiles) is not applied: samples are taken as sRGB.
 */
import { PliError } from "@pli.dev/core";
import { unzlibSync, zlibSync } from "fflate";
import { PdfDict, PdfName, PdfRef, PdfStream } from "./cos/objects";
import type { PdfObj } from "./cos/objects";
import type { Overlay } from "./cos/overlay";

export type ImageSource = { jpeg: Uint8Array } | { png: Uint8Array } | { rgba: Uint8Array; width: number; height: number };

export interface ImageXObject {
  ref: PdfRef;
  width: number;
  height: number;
  /** Whether the picture has transparency (it has a soft mask). */
  alpha: boolean;
}

export interface Raster {
  width: number;
  height: number;
  /** Four bytes a pixel, row by row (not premultiplied). */
  data: Uint8Array;
}

export interface JpegInfo {
  width: number;
  height: number;
  components: 1 | 3 | 4;
  bits: number;
  /** An Adobe marker says the samples are stored inverted (CMYK from Photoshop). */
  adobe: boolean;
  /** Adobe's colour transform flag (0: none, 1: YCbCr, 2: YCCK), when there is a marker. */
  transform?: number;
}

/** Size, channels and the Adobe marker of a JPEG; undefined when it isn't one. */
export function jpegInfo(b: Uint8Array): JpegInfo | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  let adobe = false;
  let transform: number | undefined;
  while (i + 4 <= b.length) {
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
    const length = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker === 0xee && length >= 14 && String.fromCharCode(...b.subarray(i + 4, i + 9)) === "Adobe") {
      adobe = true;
      transform = b[i + 15];
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (marker > 0xc2) return undefined; // lossless or arithmetic coding: not widely readable
      const bits = b[i + 4]!;
      const height = (b[i + 5]! << 8) | b[i + 6]!;
      const width = (b[i + 7]! << 8) | b[i + 8]!;
      const n = b[i + 9];
      if (!width || !height || (n !== 1 && n !== 3 && n !== 4)) return undefined;
      return { width, height, components: n, bits, adobe, transform };
    }
    i += 2 + length;
  }
  return undefined;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Undoes the PNG row filters of an image (or one interlace pass) in place; returns the byte offset after it. */
function unfilter(data: Uint8Array, at: number, rows: number, stride: number, bpp: number, out: Uint8Array): number {
  let prev: Uint8Array = new Uint8Array(stride);
  for (let y = 0; y < rows; y++) {
    const filter = data[at]!;
    const line = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v = data[at + 1 + x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    prev = line;
    at += stride + 1;
  }
  return at;
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** The pixels of a PNG (all colour types and bit depths, interlaced or not). Throws `PliError("invalid_document")` when it can't be read. */
export function decodePng(bytes: Uint8Array): Raster {
  const bad = (why: string): never => {
    throw new PliError("invalid_document", `This PNG cannot be read: ${why}.`);
  };
  if (bytes.length < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) bad("it is not a PNG file");
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const parts: Uint8Array[] = [];
  for (let i = 8; i + 8 <= bytes.length; ) {
    const length = u32(bytes, i);
    const tag = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
    const body = bytes.subarray(i + 8, i + 8 + length);
    if (tag === "IHDR") {
      width = u32(body, 0);
      height = u32(body, 4);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (tag === "PLTE") palette = body;
    else if (tag === "tRNS") trns = body;
    else if (tag === "IDAT") parts.push(body);
    else if (tag === "IEND") break;
    i += 12 + length;
  }
  const channels = CHANNELS[type];
  if (!channels || !width || !height || ![1, 2, 4, 8, 16].includes(depth)) bad("its header is not valid");
  if (width * height > 100_000_000) bad("it is too large");
  const raw = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) (raw.set(p, off), (off += p.length));
  let data: Uint8Array;
  try {
    data = unzlibSync(raw);
  } catch {
    return bad("its pixel data is damaged");
  }
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const maxv = (1 << depth) - 1;
  const out = new Uint8Array(width * height * 4);

  const paint = (line: Uint8Array, x: number, y: number, ix: number): void => {
    const sample = (idx: number): number => {
      if (depth === 8) return line[idx]!;
      if (depth === 16) return (line[idx * 2]! << 8) | line[idx * 2 + 1]!;
      const per = 8 / depth;
      return (line[Math.floor(idx / per)]! >> (8 - depth * ((idx % per) + 1))) & maxv;
    };
    const to8 = (v: number) => (depth === 8 ? v : depth === 16 ? v >> 8 : Math.round((v * 255) / maxv));
    const o = (y * width + x) * 4;
    if (type === 0) {
      const v = sample(ix);
      out[o] = out[o + 1] = out[o + 2] = to8(v);
      out[o + 3] = trns && trns.length >= 2 && v === ((trns[0]! << 8) | trns[1]!) ? 0 : 255;
    } else if (type === 2) {
      const r = sample(ix * 3);
      const g = sample(ix * 3 + 1);
      const b = sample(ix * 3 + 2);
      out[o] = to8(r);
      out[o + 1] = to8(g);
      out[o + 2] = to8(b);
      out[o + 3] = trns && trns.length >= 6 && r === ((trns[0]! << 8) | trns[1]!) && g === ((trns[2]! << 8) | trns[3]!) && b === ((trns[4]! << 8) | trns[5]!) ? 0 : 255;
    } else if (type === 3) {
      const i = sample(ix);
      out[o] = palette?.[i * 3] ?? 0;
      out[o + 1] = palette?.[i * 3 + 1] ?? 0;
      out[o + 2] = palette?.[i * 3 + 2] ?? 0;
      out[o + 3] = trns?.[i] ?? 255;
    } else if (type === 4) {
      out[o] = out[o + 1] = out[o + 2] = to8(sample(ix * 2));
      out[o + 3] = to8(sample(ix * 2 + 1));
    } else {
      out[o] = to8(sample(ix * 4));
      out[o + 1] = to8(sample(ix * 4 + 1));
      out[o + 2] = to8(sample(ix * 4 + 2));
      out[o + 3] = to8(sample(ix * 4 + 3));
    }
  };

  if (interlace === 0) {
    const stride = Math.ceil((width * bitsPerPixel) / 8);
    if (data.length < (stride + 1) * height) bad("its pixel data is cut short");
    const rows = new Uint8Array(stride * height);
    unfilter(data, 0, height, stride, bpp, rows);
    for (let y = 0; y < height; y++) {
      const line = rows.subarray(y * stride, (y + 1) * stride);
      for (let x = 0; x < width; x++) paint(line, x, y, x);
    }
  } else if (interlace === 1) {
    let at = 0;
    for (const [x0, y0, dx, dy] of ADAM7) {
      const pw = Math.ceil((width - x0) / dx);
      const ph = Math.ceil((height - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const stride = Math.ceil((pw * bitsPerPixel) / 8);
      if (data.length < at + (stride + 1) * ph) bad("its pixel data is cut short");
      const rows = new Uint8Array(stride * ph);
      at = unfilter(data, at, ph, stride, bpp, rows);
      for (let py = 0; py < ph; py++) {
        const line = rows.subarray(py * stride, (py + 1) * stride);
        for (let px = 0; px < pw; px++) paint(line, x0 + px * dx, y0 + py * dy, px);
      }
    }
  } else bad("its interlace method is unknown");
  return { width, height, data: out };
}

function flate(data: Uint8Array, entries: Record<string, PdfObj>): PdfStream {
  const d = new PdfDict();
  for (const [k, v] of Object.entries(entries)) d.set(k, v);
  d.set("Filter", PdfName.of("FlateDecode"));
  return new PdfStream(d, zlibSync(data, { level: 6 }));
}

const N = PdfName.of;

/** Adds the pixels as an image (grey when no pixel has colour; with a soft mask when any pixel is not opaque). */
function addRaster(overlay: Overlay, r: Raster): ImageXObject {
  const { width, height, data } = r;
  const count = width * height;
  let gray = true;
  let alpha = false;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (gray && (data[o] !== data[o + 1] || data[o] !== data[o + 2])) gray = false;
    if (data[o + 3] !== 255) alpha = true;
    if (!gray && alpha) break;
  }
  const channels = gray ? 1 : 3;
  const samples = new Uint8Array(count * channels);
  for (let i = 0; i < count; i++) {
    if (gray) samples[i] = data[i * 4]!;
    else {
      samples[i * 3] = data[i * 4]!;
      samples[i * 3 + 1] = data[i * 4 + 1]!;
      samples[i * 3 + 2] = data[i * 4 + 2]!;
    }
  }
  let mask: PdfRef | undefined;
  if (alpha) {
    const a = new Uint8Array(count);
    for (let i = 0; i < count; i++) a[i] = data[i * 4 + 3]!;
    mask = overlay.add(flate(a, { Type: N("XObject"), Subtype: N("Image"), Width: width, Height: height, ColorSpace: N("DeviceGray"), BitsPerComponent: 8 }));
  }
  const entries: Record<string, PdfObj> = { Type: N("XObject"), Subtype: N("Image"), Width: width, Height: height, ColorSpace: N(gray ? "DeviceGray" : "DeviceRGB"), BitsPerComponent: 8 };
  if (mask) entries.SMask = mask;
  return { ref: overlay.add(flate(samples, entries)), width, height, alpha };
}

/**
 * Adds a picture to the file as an image XObject and returns its reference and size in pixels. Draw it with
 * `ContentBuilder.drawXObject` after naming it with `ResourceNames.xobject`.
 */
export function makeImageXObject(overlay: Overlay, source: ImageSource): ImageXObject {
  if ("jpeg" in source) {
    const info = jpegInfo(source.jpeg);
    if (!info) throw new PliError("invalid_document", "This is not a JPEG picture that can be embedded (baseline or progressive, 8 bits).");
    if (info.bits !== 8) throw new PliError("unsupported", `JPEG pictures with ${info.bits} bits per sample cannot be embedded.`);
    const entries: Record<string, PdfObj> = {
      Type: N("XObject"),
      Subtype: N("Image"),
      Width: info.width,
      Height: info.height,
      ColorSpace: N(info.components === 1 ? "DeviceGray" : info.components === 3 ? "DeviceRGB" : "DeviceCMYK"),
      BitsPerComponent: 8,
      Filter: N("DCTDecode"),
    };
    // CMYK from Adobe software is stored inverted: a decode array turns it back.
    if (info.components === 4 && info.adobe) entries.Decode = [1, 0, 1, 0, 1, 0, 1, 0];
    const d = new PdfDict();
    for (const [k, v] of Object.entries(entries)) d.set(k, v);
    return { ref: overlay.add(new PdfStream(d, source.jpeg)), width: info.width, height: info.height, alpha: false };
  }
  if ("png" in source) return addRaster(overlay, decodePng(source.png));
  if (source.rgba.length < source.width * source.height * 4) throw new PliError("invalid_operation", "The pixel data is shorter than width x height x 4.");
  return addRaster(overlay, { width: source.width, height: source.height, data: source.rgba });
}
