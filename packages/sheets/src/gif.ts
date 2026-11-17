import type { Rgba } from "./png";

/*
 * A GIF reader in plain TypeScript, so that artistic effects can be computed (and written to an .xlsx file) for GIF pictures
 * where there is no canvas. It reads the first picture of a file (as a browser or Excel shows an animated GIF that isn't
 * playing), with its palette, interlacing and transparent colour.
 */

/** The pixels of a GIF's first picture, or null when the bytes aren't a GIF or are damaged beyond reading. */
export function decodeGif(b: Uint8Array): Rgba | null {
  try {
    return decode(b);
  } catch {
    return null;
  }
}

function decode(b: Uint8Array): Rgba | null {
  if (b.length < 14 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) return null;
  const u16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  let screenW = u16(6);
  let screenH = u16(8);
  const packed = b[10]!;
  let pos = 13;
  let global: Uint8Array | undefined;
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 7) + 1));
    global = b.subarray(pos, pos + size);
    pos += size;
  }
  let transparent = -1;
  while (pos < b.length) {
    const block = b[pos++]!;
    if (block === 0x3b) return null;
    if (block === 0x21) {
      const label = b[pos++]!;
      if (label === 0xf9 && b[pos] === 4) {
        transparent = b[pos + 1]! & 1 ? b[pos + 4]! : -1;
      }
      while (pos < b.length && b[pos] !== 0) pos += b[pos]! + 1;
      pos++;
      continue;
    }
    if (block !== 0x2c) return null;
    const left = u16(pos);
    const top = u16(pos + 2);
    const fw = u16(pos + 4);
    const fh = u16(pos + 6);
    const flags = b[pos + 8]!;
    pos += 9;
    let palette = global;
    if (flags & 0x80) {
      const size = 3 * (1 << ((flags & 7) + 1));
      palette = b.subarray(pos, pos + size);
      pos += size;
    }
    if (!palette || !fw || !fh || fw * fh > 64_000_000) return null;
    const minCode = b[pos++]!;
    if (minCode < 1 || minCode > 8) return null;
    const parts: Uint8Array[] = [];
    let total = 0;
    while (pos < b.length && b[pos] !== 0) {
      const n = b[pos]!;
      parts.push(b.subarray(pos + 1, pos + 1 + n));
      total += n;
      pos += n + 1;
    }
    const data = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      data.set(p, at);
      at += p.length;
    }
    const indices = lzw(data, minCode, fw * fh);
    if (!screenW || !screenH) {
      screenW = left + fw;
      screenH = top + fh;
    }
    const width = Math.max(screenW, left + fw);
    const height = Math.max(screenH, top + fh);
    const out = new Uint8ClampedArray(width * height * 4);
    // Interlaced rows come in four passes: every 8th row from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
    const rowOf = (i: number): number => {
      if (!(flags & 0x40)) return i;
      const passes = [[0, 8], [4, 8], [2, 4], [1, 2]] as const;
      let n = i;
      for (const [start, step] of passes) {
        const rows = Math.ceil((fh - start) / step);
        if (n < rows) return start + n * step;
        n -= rows;
      }
      return i;
    };
    for (let row = 0; row < fh; row++) {
      const y = top + rowOf(row);
      for (let x = 0; x < fw; x++) {
        const index = indices[row * fw + x]!;
        const o = (y * width + left + x) * 4;
        if (index === transparent) continue;
        out[o] = palette[index * 3] ?? 0;
        out[o + 1] = palette[index * 3 + 1] ?? 0;
        out[o + 2] = palette[index * 3 + 2] ?? 0;
        out[o + 3] = 255;
      }
    }
    return { width, height, data: out };
  }
  return null;
}

/** The colour numbers of a picture's LZW-packed data; `count` of them (any that the data lacks are 0). */
function lzw(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const end = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = minCode + 1;
  let next = end + 1;
  let previous = -1;
  let first = 0;
  let bits = 0;
  let bitCount = 0;
  let at = 0;
  let o = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (o < count) {
    while (bitCount < size) {
      if (at >= data.length) return out;
      bits |= data[at++]! << bitCount;
      bitCount += 8;
    }
    const code = bits & ((1 << size) - 1);
    bits >>>= size;
    bitCount -= size;
    if (code === clear) {
      size = minCode + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    if (previous === -1) {
      if (code >= clear) return out;
      out[o++] = suffix[code]!;
      previous = code;
      first = code;
      continue;
    }
    let c = code;
    let top = 0;
    if (code >= next) {
      // The code that is being made right now: the last string and its own first colour.
      if (code > next) return out;
      stack[top++] = first;
      c = previous;
    }
    while (c >= clear) {
      stack[top++] = suffix[c]!;
      c = prefix[c]!;
    }
    first = suffix[c]!;
    stack[top++] = first;
    while (top > 0 && o < count) out[o++] = stack[--top]!;
    if (next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    previous = code;
  }
  return out;
}
