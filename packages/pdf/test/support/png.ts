/** Test helper: writes PNG files by hand (any colour type, depth, filters, interlace) so the decoder is tested against known pixels. */
import { zlibSync } from "fflate";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const out = new Uint8Array(12 + body.length);
  out.set(be32(body.length), 0);
  out.set(typeBytes, 4);
  out.set(body, 8);
  out.set(be32(crc(out.subarray(4, 8 + body.length))), 8 + body.length);
  return out;
};

export interface PngSpec {
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  depth: 1 | 2 | 4 | 8 | 16;
  /** Packed scanlines (without the filter byte) for the whole image, or for the interlaced passes, in order. */
  sample: (x: number, y: number) => number[]; // channel values, 0..2^depth-1
  palette?: number[][];
  trns?: number[];
  interlace?: boolean;
}

function pack(values: number[], depth: number): Uint8Array {
  if (depth === 16) {
    const out = new Uint8Array(values.length * 2);
    values.forEach((v, i) => ((out[i * 2] = v >> 8), (out[i * 2 + 1] = v & 255)));
    return out;
  }
  if (depth === 8) return Uint8Array.from(values);
  const out = new Uint8Array(Math.ceil((values.length * depth) / 8));
  values.forEach((v, i) => {
    const bit = i * depth;
    out[bit >> 3]! |= v << (8 - depth - (bit & 7));
  });
  return out;
}

function filterRows(rows: Uint8Array[], bpp: number): Uint8Array {
  const out: number[] = [];
  let prev: Uint8Array = new Uint8Array(rows[0]?.length ?? 0);
  rows.forEach((row, y) => {
    const f = y % 5; // every filter type gets used
    out.push(f);
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out.push((row[x]! - pred) & 255);
    }
    prev = row;
  });
  return Uint8Array.from(out);
}

export function makePng(spec: PngSpec): Uint8Array {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[spec.colorType];
  const bpp = Math.max(1, (channels * spec.depth) >> 3);
  const parts: Uint8Array[] = [];
  const pass = (x0: number, y0: number, dx: number, dy: number) => {
    const rows: Uint8Array[] = [];
    for (let y = y0; y < spec.height; y += dy) {
      const vals: number[] = [];
      for (let x = x0; x < spec.width; x += dx) vals.push(...spec.sample(x, y));
      if (vals.length) rows.push(pack(vals, spec.depth));
    }
    if (rows.length) parts.push(filterRows(rows, bpp));
  };
  if (spec.interlace)
    for (const [x0, y0, dx, dy] of [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ] as const)
      pass(x0, y0, dx, dy);
  else pass(0, 0, 1, 1);
  const raw = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (raw.set(p, at), (at += p.length));
  const ihdr = new Uint8Array(13);
  ihdr.set(be32(spec.width), 0);
  ihdr.set(be32(spec.height), 4);
  ihdr[8] = spec.depth;
  ihdr[9] = spec.colorType;
  ihdr[12] = spec.interlace ? 1 : 0;
  const chunks = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr)];
  if (spec.palette) chunks.push(chunk("PLTE", Uint8Array.from(spec.palette.flat())));
  if (spec.trns) chunks.push(chunk("tRNS", Uint8Array.from(spec.trns)));
  chunks.push(chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.length));
  return out;
}
