import { unzlibSync, zlibSync } from "fflate";

/*
 * A PNG reader and writer in plain TypeScript, so that artistic effects can be computed (and written to an .xlsx file) where
 * there is no canvas. It reads what the format most often holds: every bit depth and colour type, but not interlaced pictures.
 */

export interface Rgba {
  width: number;
  height: number;
  /** Four bytes for each pixel (red, green, blue, alpha), row by row. */
  data: Uint8ClampedArray;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** The pixels of a PNG, or null when it isn't one, is damaged, or is of a kind this doesn't read (interlaced). */
export function decodePng(bytes: Uint8Array): Rgba | null {
  try {
    if (bytes.length < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) return null;
    let width = 0;
    let height = 0;
    let depth = 0;
    let type = 0;
    let interlace = 0;
    let palette: Uint8Array | undefined;
    let alpha: Uint8Array | undefined;
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
      else if (name === "tRNS") alpha = body;
      else if (name === "IDAT") parts.push(body);
      else if (name === "IEND") break;
      i += 12 + length;
    }
    const channels = CHANNELS[type];
    if (!channels || interlace !== 0 || ![1, 2, 4, 8, 16].includes(depth) || width < 1 || height < 1 || width * height > 64_000_000) return null;
    if (type === 3 && !palette) return null;
    const idat = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      idat.set(p, at);
      at += p.length;
    }
    const raw = unzlibSync(idat);
    const bpp = Math.max(1, (channels * depth) >> 3); // bytes to the left that a filter looks at
    const stride = Math.ceil((width * channels * depth) / 8);
    if (raw.length < (stride + 1) * height) return null;
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!;
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const out = rows.subarray(y * stride, (y + 1) * stride);
      const prev = y ? rows.subarray((y - 1) * stride, y * stride) : undefined;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[x - bpp]! : 0;
        const b = prev ? prev[x]! : 0;
        const c = prev && x >= bpp ? prev[x - bpp]! : 0;
        let v = line[x]!;
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        } else if (filter > 4) return null;
        out[x] = v & 255;
      }
    }
    const data = new Uint8ClampedArray(width * height * 4);
    const sample = (y: number, n: number): number => {
      // The n-th sample of row y, scaled to 0..255 (palette indexes are left as they are).
      const base = y * stride;
      if (depth === 8) return rows[base + n]!;
      if (depth === 16) return rows[base + n * 2]!;
      const bit = n * depth;
      const v = (rows[base + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
    };
    const keyed = type === 0 || type === 2 ? alpha : undefined;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (type === 3) {
          const i = sample(y, x);
          data[o] = palette![i * 3]!;
          data[o + 1] = palette![i * 3 + 1]!;
          data[o + 2] = palette![i * 3 + 2]!;
          data[o + 3] = alpha && i < alpha.length ? alpha[i]! : 255;
        } else if (type === 0 || type === 4) {
          const g = sample(y, x * channels);
          data[o] = data[o + 1] = data[o + 2] = g;
          data[o + 3] = type === 4 ? sample(y, x * channels + 1) : 255;
          if (keyed && keyed.length >= 2 && depth === 8 && g === keyed[1]) data[o + 3] = 0;
        } else {
          const r = sample(y, x * channels);
          const g = sample(y, x * channels + 1);
          const b = sample(y, x * channels + 2);
          data[o] = r;
          data[o + 1] = g;
          data[o + 2] = b;
          data[o + 3] = type === 6 ? sample(y, x * channels + 3) : 255;
          if (keyed && keyed.length >= 6 && depth === 8 && r === keyed[1] && g === keyed[3] && b === keyed[5]) data[o + 3] = 0;
        }
      }
    }
    return { width, height, data };
  } catch {
    return null;
  }
}

let table: Uint32Array | undefined;
const crc32 = (bytes: Uint8Array): number => {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  out.set(be32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(be32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
};

/** A PNG (8 bits, with alpha) of the pixels. */
export function encodePng({ width, height, data }: Rgba): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Sub filter: each byte less the one a pixel to the left, which compresses smooth pictures well.
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = (data[y * stride + x]! - (x >= 4 ? data[y * stride + x - 4]! : 0)) & 255;
  }
  const head = new Uint8Array([...be32(width), ...be32(height), 8, 6, 0, 0, 0]);
  const parts = [new Uint8Array(SIGNATURE), chunk("IHDR", head), chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
