import type { PdfImage } from "@pli.dev/docs";
import { unzlibSync } from "fflate";

/*
 * Pictures for the PDF writer: reads what a `data:` address holds (JPEG as it is, PNG decoded here), and makes the pixels
 * of soft shadows.
 */

export interface Raster {
  width: number;
  height: number;
  /** Four bytes a pixel, row by row. */
  data: Uint8Array;
}

/** The bytes and type of a `data:` address (base64 or percent-encoded); undefined for anything else. */
export function readDataUri(src: string): { mime: string; bytes: Uint8Array } | undefined {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (!m) return undefined;
  const mime = (m[1] || "text/plain").toLowerCase();
  const body = m[3]!;
  try {
    if (/;base64/i.test(m[2]!)) {
      const bin = atob(body.replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime, bytes };
    }
    const text = decodeURIComponent(body);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
    return { mime, bytes };
  } catch {
    return undefined;
  }
}

/** Size and channel count of a JPEG from its frame header; undefined when it isn't one. */
export function jpegInfo(b: Uint8Array): { width: number; height: number; components: 1 | 3 | 4 } | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
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
      const height = (b[i + 5]! << 8) | b[i + 6]!;
      const width = (b[i + 7]! << 8) | b[i + 8]!;
      const n = b[i + 9];
      if (!width || !height) return undefined;
      return { width, height, components: n === 1 ? 1 : n === 4 ? 4 : 3 };
    }
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return undefined;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** The pixels of a PNG (every bit depth and colour type, not interlaced); undefined when it can't be read. */
export function decodePng(bytes: Uint8Array): Raster | undefined {
  try {
    if (bytes.length < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) return undefined;
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
      const name = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
      const body = bytes.subarray(i + 8, i + 8 + length);
      if (name === "IHDR") {
        width = u32(body, 0);
        height = u32(body, 4);
        depth = body[8]!;
        type = body[9]!;
        interlace = body[12]!;
      } else if (name === "PLTE") palette = body;
      else if (name === "tRNS") trns = body;
      else if (name === "IDAT") parts.push(body);
      else if (name === "IEND") break;
      i += 12 + length;
    }
    const channels = CHANNELS[type];
    if (!channels || !width || !height || interlace !== 0 || ![1, 2, 4, 8, 16].includes(depth) || width * height > 64_000_000) return undefined;
    const raw = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) (raw.set(p, at), (at += p.length));
    const data = unzlibSync(raw);
    const bpp = Math.max(1, (channels * depth) >> 3);
    const stride = Math.ceil((width * channels * depth) / 8);
    if (data.length < (stride + 1) * height) return undefined;
    const out = new Uint8Array(width * height * 4);
    let prev = new Uint8Array(stride);
    let line = new Uint8Array(stride);
    const maxv = (1 << depth) - 1;
    for (let y = 0; y < height; y++) {
      const filter = data[y * (stride + 1)]!;
      const src = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? line[x - bpp]! : 0;
        const b = prev[x]!;
        const c = x >= bpp ? prev[x - bpp]! : 0;
        let v = src[x]!;
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
      // read samples
      const sample = (idx: number): number => {
        if (depth === 8) return line[idx]!;
        if (depth === 16) return (line[idx * 2]! << 8) | line[idx * 2 + 1]!;
        const per = 8 / depth;
        const byte = line[Math.floor(idx / per)]!;
        return (byte >> (8 - depth * ((idx % per) + 1))) & maxv;
      };
      const to8 = (v: number) => (depth === 8 ? v : depth === 16 ? v >> 8 : Math.round((v * 255) / maxv));
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (type === 0) {
          const v = sample(x);
          const g = to8(v);
          out[o] = out[o + 1] = out[o + 2] = g;
          out[o + 3] = trns && trns.length >= 2 && v === ((trns[0]! << 8) | trns[1]!) ? 0 : 255;
        } else if (type === 2) {
          const r = sample(x * 3);
          const g = sample(x * 3 + 1);
          const b = sample(x * 3 + 2);
          out[o] = to8(r);
          out[o + 1] = to8(g);
          out[o + 2] = to8(b);
          out[o + 3] = trns && trns.length >= 6 && r === ((trns[0]! << 8) | trns[1]!) && g === ((trns[2]! << 8) | trns[3]!) && b === ((trns[4]! << 8) | trns[5]!) ? 0 : 255;
        } else if (type === 3) {
          const i = sample(x);
          out[o] = palette?.[i * 3] ?? 0;
          out[o + 1] = palette?.[i * 3 + 1] ?? 0;
          out[o + 2] = palette?.[i * 3 + 2] ?? 0;
          out[o + 3] = trns?.[i] ?? 255;
        } else if (type === 4) {
          out[o] = out[o + 1] = out[o + 2] = to8(sample(x * 2));
          out[o + 3] = to8(sample(x * 2 + 1));
        } else {
          out[o] = to8(sample(x * 4));
          out[o + 1] = to8(sample(x * 4 + 1));
          out[o + 2] = to8(sample(x * 4 + 2));
          out[o + 3] = to8(sample(x * 4 + 3));
        }
      }
      [prev, line] = [line, prev];
    }
    return { width, height, data: out };
  } catch {
    return undefined;
  }
}

export const toPdfImage = (r: Raster): PdfImage => ({ rgba: r.data, width: r.width, height: r.height });

/**
 * A soft shadow as pixels: the polygons (in points, each set painted by the even-odd rule and the sets laid over each
 * other) blurred with a Gaussian of `sigma` points and coloured `color` at up to `alpha` opacity. The picture covers the
 * shape's bounds plus three deviations on every side; `x`, `y`, `w` and `h` say where it goes, in the polygons' units.
 * Undefined when nothing is covered.
 */
export function shadowRaster(sets: readonly (readonly (readonly [number, number][])[])[], sigma: number, color: string, alpha: number): { raster: Raster; x: number; y: number; w: number; h: number } | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const polys of sets) for (const poly of polys) for (const [x, y] of poly) (x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y));
  if (!(x1 >= x0) || !(y1 >= y0) || !(alpha > 0)) return undefined;
  const pad = 3 * sigma;
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  // One pixel is a fraction of a deviation (the blur hides what is finer), and the picture stays within a pixel budget.
  let px = Math.max(0.5, sigma / 5);
  while (((x1 - x0) / px) * ((y1 - y0) / px) > 2_000_000) px *= 1.25;
  const W = Math.max(1, Math.ceil((x1 - x0) / px));
  const H = Math.max(1, Math.ceil((y1 - y0) / px));
  let cover: Float32Array = new Float32Array(W * H);
  const SUB = 3;
  for (const polys of sets) {
    const rows = polygonRows(polys.map((p) => p.map(([x, y]): [number, number] => [x, y])));
    const own = new Float32Array(W * H);
    for (let row = 0; row < H; row++) {
      for (let k = 0; k < SUB; k++) {
        for (const [a, b] of rows(y0 + (row + (k + 0.5) / SUB) * px)) {
          const from = Math.max(0, Math.floor((a - x0) / px));
          const to = Math.min(W - 1, Math.floor((b - x0) / px));
          for (let col = from; col <= to; col++) {
            const left = Math.max(a, x0 + col * px);
            const right = Math.min(b, x0 + (col + 1) * px);
            if (right > left) own[row * W + col]! += ((right - left) / px) / SUB;
          }
        }
      }
    }
    for (let i = 0; i < cover.length; i++) cover[i] = Math.max(cover[i]!, Math.min(1, own[i]!));
  }
  // Gaussian blur, a row pass and a column pass.
  const s = sigma / px;
  const radius = Math.max(1, Math.ceil(3 * s));
  const kernel = new Float32Array(2 * radius + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) total += kernel[i + radius] = Math.exp(-(i * i) / (2 * s * s));
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= total;
  const pass = (from: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(W * H);
    for (let row = 0; row < H; row++)
      for (let col = 0; col < W; col++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++) {
          const c = horizontal ? col + i : col;
          const r = horizontal ? row : row + i;
          if (c >= 0 && c < W && r >= 0 && r < H) sum += from[r * W + c]! * kernel[i + radius]!;
        }
        out[row * W + col] = sum;
      }
    return out;
  };
  cover = pass(pass(cover, true), false);
  const n = parseInt(color.slice(1, 7), 16);
  const data = new Uint8Array(W * H * 4);
  let any = false;
  for (let i = 0; i < W * H; i++) {
    const a = Math.round(Math.min(1, cover[i]!) * Math.min(1, alpha) * 255);
    data[i * 4] = (n >> 16) & 255;
    data[i * 4 + 1] = (n >> 8) & 255;
    data[i * 4 + 2] = n & 255;
    data[i * 4 + 3] = a;
    if (a > 0) any = true;
  }
  return any ? { raster: { width: W, height: H, data }, x: x0, y: y0, w: W * px, h: H * px } : undefined;
}

/** For a polygon set (even-odd), a function that gives the covered intervals of the horizontal line at height y. */
export function polygonRows(polys: readonly (readonly [number, number][])[]): (y: number) => [number, number][] {
  const edges: [number, number, number, number][] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return (y) => {
    const xs: number[] = [];
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((p, q) => p - q);
    const spans: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i]!, xs[i + 1]!]);
    return spans;
  };
}
