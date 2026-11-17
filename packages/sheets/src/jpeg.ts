import type { Rgba } from "./png";

/*
 * A JPEG reader in plain TypeScript, so that artistic effects can be computed (and written to an .xlsx file) for JPEG pictures
 * where there is no canvas. It reads what cameras, phones and editors write: baseline, extended-sequential and progressive
 * Huffman coding at 8 bits, one, three (YCbCr or RGB) or four (CMYK, YCCK) components, any sampling, restart intervals and
 * the EXIF orientation the browser applies when it draws the picture. Arithmetic coding, 12-bit and lossless JPEGs are not read.
 */

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39,
  46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

interface Huffman {
  /** The smallest code of each length, the largest (-1 when there is none) and where its symbols start. */
  minCode: Int32Array;
  maxCode: Int32Array;
  valPtr: Int32Array;
  symbols: Uint8Array;
}

function huffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(18).fill(-1);
  const valPtr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    valPtr[len] = k;
    minCode[len] = code;
    code += counts[len - 1]!;
    k += counts[len - 1]!;
    maxCode[len] = counts[len - 1]! ? code - 1 : -1;
    code <<= 1;
  }
  return { minCode, maxCode, valPtr, symbols };
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  blocksPerLine: number;
  blocksPerColumn: number;
  blocksPerLineForMcu: number;
  blocksPerColumnForMcu: number;
  coefs: Int16Array;
  pred: number;
  dc: Huffman | undefined;
  ac: Huffman | undefined;
}

/** A cosine table for the inverse transform: `COS[x * 8 + u]` is `c(u) / 2 * cos((2x + 1) u pi / 16)`. */
const COS = (() => {
  const t = new Float32Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();

const tmp = new Float32Array(64);
/** The inverse DCT of one block of dequantized coefficients (natural order) into `out` at `at`, `stride` samples to a row. */
function idct(block: Float32Array, out: Uint8Array, at: number, stride: number): void {
  const busy = new Uint8Array(8);
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      let any = false;
      for (let k = 0; k < 8; k++) {
        const f = block[v * 8 + k]!;
        if (f !== 0) {
          sum += COS[u * 8 + k]! * f;
          any = true;
        }
      }
      tmp[v * 8 + u] = sum;
      if (any) busy[v] = 1;
    }
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 128;
      for (let v = 0; v < 8; v++) if (busy[v]) sum += COS[y * 8 + v]! * tmp[v * 8 + x]!;
      out[at + y * stride + x] = sum < 0 ? 0 : sum > 255 ? 255 : Math.round(sum);
    }
  }
}

/** The EXIF orientation (1 to 8) in an APP1 segment's body, or 1. */
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  if (end - start < 14 || b[start] !== 0x45 || b[start + 1] !== 0x78 || b[start + 2] !== 0x69 || b[start + 3] !== 0x66) return 1;
  const t = start + 6;
  const little = b[t] === 0x49;
  const u16 = (i: number) => (little ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
  const u32 = (i: number) => (little ? (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0 : ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0);
  if (u16(t + 2) !== 42) return 1;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** The picture turned the way an EXIF orientation says to show it (2 mirrored, 3 upside down, 6 a quarter turn clockwise…). */
export function orient(r: Rgba, o: number): Rgba {
  if (o <= 1 || o > 8) return r;
  const { width: w, height: h } = r;
  const swap = o >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const data = new Uint8ClampedArray(r.data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Where in the stored picture the shown pixel (x, y) comes from.
      let sx: number;
      let sy: number;
      switch (o) {
        case 2: sx = w - 1 - x; sy = y; break;
        case 3: sx = w - 1 - x; sy = h - 1 - y; break;
        case 4: sx = x; sy = h - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = h - 1 - x; break;
        case 7: sx = w - 1 - y; sy = h - 1 - x; break;
        default: sx = w - 1 - y; sy = x; break;
      }
      const to = (y * W + x) * 4;
      const from = (sy * w + sx) * 4;
      data[to] = r.data[from]!; data[to + 1] = r.data[from + 1]!; data[to + 2] = r.data[from + 2]!; data[to + 3] = r.data[from + 3]!;
    }
  }
  return { width: W, height: H, data };
}

/** The pixels of a JPEG, or null when the bytes aren't one, are damaged beyond reading, or are of a kind this doesn't read. */
export function decodeJpeg(bytes: Uint8Array): Rgba | null {
  try {
    return decode(bytes);
  } catch {
    return null;
  }
}

function decode(b: Uint8Array): Rgba | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const quant: (Int32Array | undefined)[] = [];
  const dcTables: (Huffman | undefined)[] = [];
  const acTables: (Huffman | undefined)[] = [];
  let comps: Component[] = [];
  let width = 0;
  let height = 0;
  let progressive = false;
  let restart = 0;
  let adobe = -1;
  let orientation = 1;
  let hmax = 1;
  let vmax = 1;
  let scans = 0;
  let pos = 2;

  // The bit reader for the scan being read.
  let bitBuf = 0;
  let bitCnt = 0;
  let hitMarker = false;
  const readBit = (): number => {
    if (bitCnt === 0) {
      if (pos >= b.length) {
        hitMarker = true;
        return 0;
      }
      const byte = b[pos]!;
      if (byte === 0xff) {
        const next = b[pos + 1];
        if (next === 0) pos += 2;
        else {
          // A marker ends the data: zeros are read from here to the end of the scan (or until a restart is taken).
          hitMarker = true;
          return 0;
        }
      } else pos++;
      bitBuf = byte;
      bitCnt = 8;
    }
    bitCnt--;
    return (bitBuf >> bitCnt) & 1;
  };
  const receive = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | readBit();
    return v;
  };
  const extend = (v: number, n: number): number => (n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const decodeHuffman = (t: Huffman): number => {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | readBit();
      if (t.maxCode[len]! >= 0 && code <= t.maxCode[len]! && code >= t.minCode[len]!) return t.symbols[t.valPtr[len]! + code - t.minCode[len]!]!;
      if (hitMarker && bitCnt === 0) return 0;
    }
    return 0;
  };

  while (pos < b.length) {
    if (b[pos] !== 0xff) {
      pos++;
      continue;
    }
    while (b[pos] === 0xff && pos < b.length) pos++;
    const marker = b[pos++]!;
    if (marker === 0 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9) break;
    const length = (b[pos]! << 8) | b[pos + 1]!;
    const end = pos + length;
    const body = pos + 2;
    if (length < 2) break;
    switch (marker) {
      case 0xe1:
        orientation = exifOrientation(b, body, end);
        break;
      case 0xee:
        if (b[body] === 0x41 && b[body + 1] === 0x64 && b[body + 2] === 0x6f && b[body + 3] === 0x62 && b[body + 4] === 0x65) adobe = b[body + 11]!;
        break;
      case 0xdb:
        for (let p = body; p < end; ) {
          const pq = b[p]! >> 4;
          const id = b[p]! & 15;
          p++;
          const q = new Int32Array(64);
          for (let i = 0; i < 64; i++) {
            q[ZIGZAG[i]!] = pq ? (b[p]! << 8) | b[p + 1]! : b[p]!;
            p += pq ? 2 : 1;
          }
          if (id < 4) quant[id] = q;
        }
        break;
      case 0xc4:
        for (let p = body; p < end; ) {
          const tc = b[p]! >> 4;
          const id = b[p]! & 15;
          p++;
          const counts = b.subarray(p, p + 16);
          p += 16;
          const total = counts.reduce((a, c) => a + c, 0);
          const table = huffman(counts, b.slice(p, p + total));
          p += total;
          if (id < 4) (tc ? acTables : dcTables)[id] = table;
        }
        break;
      case 0xdd:
        restart = (b[body]! << 8) | b[body + 1]!;
        break;
      case 0xc0:
      case 0xc1:
      case 0xc2: {
        if (comps.length) return null;
        progressive = marker === 0xc2;
        if (b[body] !== 8) return null;
        height = (b[body + 1]! << 8) | b[body + 2]!;
        width = (b[body + 3]! << 8) | b[body + 4]!;
        const n = b[body + 5]!;
        if (!width || !height || width * height > 64_000_000 || ![1, 3, 4].includes(n)) return null;
        for (let i = 0; i < n; i++) {
          const o = body + 6 + i * 3;
          const h = b[o + 1]! >> 4;
          const v = b[o + 1]! & 15;
          if (h < 1 || h > 4 || v < 1 || v > 4) return null;
          comps.push({ id: b[o]!, h, v, tq: b[o + 2]! & 3, blocksPerLine: 0, blocksPerColumn: 0, blocksPerLineForMcu: 0, blocksPerColumnForMcu: 0, coefs: new Int16Array(0), pred: 0, dc: undefined, ac: undefined });
          hmax = Math.max(hmax, h);
          vmax = Math.max(vmax, v);
        }
        const mcusX = Math.ceil(width / (8 * hmax));
        const mcusY = Math.ceil(height / (8 * vmax));
        for (const c of comps) {
          c.blocksPerLine = Math.ceil(Math.ceil((width * c.h) / hmax) / 8);
          c.blocksPerColumn = Math.ceil(Math.ceil((height * c.v) / vmax) / 8);
          c.blocksPerLineForMcu = mcusX * c.h;
          c.blocksPerColumnForMcu = mcusY * c.v;
          c.coefs = new Int16Array(c.blocksPerLineForMcu * c.blocksPerColumnForMcu * 64);
        }
        break;
      }
      case 0xc3:
      case 0xc5:
      case 0xc6:
      case 0xc7:
      case 0xc9:
      case 0xca:
      case 0xcb:
      case 0xcd:
      case 0xce:
      case 0xcf:
        return null;
      case 0xda: {
        if (!comps.length) return null;
        const ns = b[body]!;
        const used: Component[] = [];
        for (let i = 0; i < ns; i++) {
          const id = b[body + 1 + i * 2]!;
          const sel = b[body + 2 + i * 2]!;
          const c = comps.find((x) => x.id === id) ?? comps[i];
          if (!c) return null;
          c.dc = dcTables[sel >> 4];
          c.ac = acTables[sel & 15];
          used.push(c);
        }
        const ss = b[body + 1 + ns * 2]!;
        const se = b[body + 2 + ns * 2]!;
        const ah = b[body + 3 + ns * 2]! >> 4;
        const al = b[body + 3 + ns * 2]! & 15;
        pos = end;
        bitCnt = 0;
        hitMarker = false;
        scans++;
        pos = scan(used, ss, se, ah, al);
        continue;
      }
      default:
        break;
    }
    pos = end;
  }

  function scan(used: Component[], ss: number, se: number, ah: number, al: number): number {
    let eobrun = 0;
    const block = (c: Component, off: number): void => {
      const co = c.coefs;
      if (!progressive) {
        const t = c.dc ? decodeHuffman(c.dc) : 0;
        c.pred += extend(receive(t), t);
        co[off] = c.pred;
        const ac = c.ac;
        if (!ac) return;
        for (let k = 1; k < 64; ) {
          const rs = decodeHuffman(ac);
          const s = rs & 15;
          const r = rs >> 4;
          if (s === 0) {
            if (r < 15) break;
            k += 16;
            continue;
          }
          k += r;
          if (k > 63) break;
          co[off + ZIGZAG[k]!] = extend(receive(s), s);
          k++;
        }
        return;
      }
      if (ss === 0) {
        if (ah === 0) {
          const t = c.dc ? decodeHuffman(c.dc) : 0;
          c.pred += extend(receive(t), t);
          co[off] = c.pred * (1 << al);
        } else if (readBit()) co[off] |= 1 << al;
        return;
      }
      const ac = c.ac;
      if (!ac) return;
      if (ah === 0) {
        if (eobrun > 0) {
          eobrun--;
          return;
        }
        for (let k = ss; k <= se; ) {
          const rs = decodeHuffman(ac);
          const s = rs & 15;
          const r = rs >> 4;
          if (s === 0) {
            if (r < 15) {
              eobrun = (1 << r) - 1 + (r ? receive(r) : 0);
              break;
            }
            k += 16;
            continue;
          }
          k += r;
          if (k > 63) break;
          co[off + ZIGZAG[k]!] = extend(receive(s), s) * (1 << al);
          k++;
        }
        return;
      }
      // Refining the bits of coefficients already seen.
      const p1 = 1 << al;
      const m1 = -1 << al;
      let k = ss;
      if (eobrun === 0) {
        for (; k <= se; k++) {
          const rs = decodeHuffman(ac);
          let s = rs & 15;
          let r = rs >> 4;
          if (s) s = readBit() ? p1 : m1;
          else if (r !== 15) {
            eobrun = 1 << r;
            if (r) eobrun += receive(r);
            break;
          }
          do {
            const at = off + ZIGZAG[k]!;
            if (co[at] !== 0) {
              if (readBit() && (co[at]! & p1) === 0) co[at] = co[at]! + (co[at]! >= 0 ? p1 : m1);
            } else if (--r < 0) break;
            k++;
          } while (k <= se);
          if (s && k <= 63) co[off + ZIGZAG[k]!] = s;
        }
      }
      if (eobrun > 0) {
        for (; k <= se; k++) {
          const at = off + ZIGZAG[k]!;
          if (co[at] !== 0 && readBit() && (co[at]! & p1) === 0) co[at] = co[at]! + (co[at]! >= 0 ? p1 : m1);
        }
        eobrun--;
      }
    };

    const single = used.length === 1;
    const first = used[0]!;
    const mcusX = Math.ceil(width / (8 * hmax));
    const mcusY = Math.ceil(height / (8 * vmax));
    const total = single ? first.blocksPerLine * first.blocksPerColumn : mcusX * mcusY;
    for (const c of used) c.pred = 0;
    for (let mcu = 0; mcu < total; mcu++) {
      if (restart && mcu > 0 && mcu % restart === 0) {
        // Back to byte boundary; take the RSTn marker; start the predictions again.
        bitCnt = 0;
        hitMarker = false;
        while (pos < b.length && !(b[pos] === 0xff && b[pos + 1]! >= 0xd0 && b[pos + 1]! <= 0xd7)) {
          if (b[pos] === 0xff && b[pos + 1] !== 0 && b[pos + 1] !== 0xff) break;
          pos++;
        }
        if (b[pos] === 0xff && b[pos + 1]! >= 0xd0 && b[pos + 1]! <= 0xd7) pos += 2;
        eobrun = 0;
        for (const c of used) c.pred = 0;
      }
      if (hitMarker && bitCnt === 0 && !restart) break;
      if (single) {
        const row = Math.floor(mcu / first.blocksPerLine);
        const col = mcu % first.blocksPerLine;
        block(first, (row * first.blocksPerLineForMcu + col) * 64);
      } else {
        const my = Math.floor(mcu / mcusX);
        const mx = mcu % mcusX;
        for (const c of used) {
          for (let v = 0; v < c.v; v++) for (let hh = 0; hh < c.h; hh++) block(c, ((my * c.v + v) * c.blocksPerLineForMcu + mx * c.h + hh) * 64);
        }
      }
    }
    // The scan's data ends at the next marker.
    bitCnt = 0;
    while (pos < b.length && !(b[pos] === 0xff && b[pos + 1] !== 0 && !(b[pos + 1]! >= 0xd0 && b[pos + 1]! <= 0xd7) && b[pos + 1] !== 0xff)) pos++;
    return pos;
  }

  if (!comps.length || !scans) return null;

  // Every component as a plane of samples.
  const planes = comps.map((c) => {
    const q = quant[c.tq] ?? new Int32Array(64).fill(1);
    const stride = c.blocksPerLineForMcu * 8;
    const plane = new Uint8Array(stride * c.blocksPerColumnForMcu * 8);
    const block = new Float32Array(64);
    for (let by = 0; by < c.blocksPerColumnForMcu; by++) {
      for (let bx = 0; bx < c.blocksPerLineForMcu; bx++) {
        const off = (by * c.blocksPerLineForMcu + bx) * 64;
        for (let i = 0; i < 64; i++) block[i] = c.coefs[off + i]! * q[i]!;
        idct(block, plane, by * 8 * stride + bx * 8, stride);
      }
    }
    return { plane, stride, c };
  });

  const out = new Uint8ClampedArray(width * height * 4);
  // A sample of a component at a pixel: the plane read at the pixel's place in it, between its neighbours when it is smaller than the picture.
  const sampleAt = (k: number, x: number, y: number): number => {
    const { plane, stride, c } = planes[k]!;
    if (c.h === hmax && c.v === vmax) return plane[y * stride + x]!;
    const maxX = Math.ceil((width * c.h) / hmax) - 1;
    const maxY = Math.ceil((height * c.v) / vmax) - 1;
    const fx = Math.min(maxX, Math.max(0, ((x + 0.5) * c.h) / hmax - 0.5));
    const fy = Math.min(maxY, Math.max(0, ((y + 0.5) * c.v) / vmax - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(maxX, x0 + 1);
    const y1 = Math.min(maxY, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = plane[y0 * stride + x0]! * (1 - tx) + plane[y0 * stride + x1]! * tx;
    const bottom = plane[y1 * stride + x0]! * (1 - tx) + plane[y1 * stride + x1]! * tx;
    return top * (1 - ty) + bottom * ty;
  };
  const n = comps.length;
  const rgbIds = n === 3 && comps[0]!.id === 0x52 && comps[1]!.id === 0x47 && comps[2]!.id === 0x42;
  const ycc = n === 3 ? (adobe >= 0 ? adobe !== 0 : !rgbIds) : n === 4 ? adobe === 2 : false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (n === 1) {
        const v = sampleAt(0, x, y);
        out[o] = out[o + 1] = out[o + 2] = v;
      } else {
        let a = sampleAt(0, x, y);
        let c1 = sampleAt(1, x, y);
        let c2 = sampleAt(2, x, y);
        if (ycc) {
          const cb = c1 - 128;
          const cr = c2 - 128;
          const r = a + 1.402 * cr;
          const g = a - 0.344136 * cb - 0.714136 * cr;
          const bl = a + 1.772 * cb;
          a = r; c1 = g; c2 = bl;
        }
        if (n === 4) {
          const k = sampleAt(3, x, y);
          if (adobe >= 0) {
            // Adobe's CMYK is stored upside down: 255 is no ink. (YCCK comes out of the transform as the CMY of that.)
            if (adobe === 2) { a = 255 - a; c1 = 255 - c1; c2 = 255 - c2; }
            out[o] = (a * k) / 255; out[o + 1] = (c1 * k) / 255; out[o + 2] = (c2 * k) / 255;
          } else {
            out[o] = ((255 - a) * (255 - k)) / 255; out[o + 1] = ((255 - c1) * (255 - k)) / 255; out[o + 2] = ((255 - c2) * (255 - k)) / 255;
          }
        } else {
          out[o] = a; out[o + 1] = c1; out[o + 2] = c2;
        }
      }
      out[o + 3] = 255;
    }
  }
  return orient({ width, height, data: out }, orientation);
}
