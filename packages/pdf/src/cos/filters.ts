/**
 * Stream filters: FlateDecode, LZWDecode, ASCII85Decode, ASCIIHexDecode, RunLengthDecode, Crypt (identity) and the PNG
 * and TIFF predictors. The image filters (DCTDecode, JPXDecode, JBIG2Decode, CCITTFaxDecode) are not decoded here:
 * they end the chain and are reported, so a caller knows the bytes it got are still an image.
 *
 * Decoding is forgiving: corrupt or truncated Flate/LZW data returns what could be decoded.
 */
import { Inflate, unzlibSync, zlibSync } from "fflate";
import { PliError } from "@pli.dev/core";
import { PdfDict, PdfName, PdfStream, type PdfObj } from "./objects";

export interface DecodeOptions {
  /** Largest decoded size in bytes of any single step. Default 256 MB. Bigger output throws `PliError("unsupported")`. */
  maxSize?: number;
}

export const DEFAULT_MAX_STREAM_SIZE = 256 * 1024 * 1024;

export const IMAGE_FILTERS: ReadonlySet<string> = new Set(["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"]);

const ABBREVIATIONS: Record<string, string> = {
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  LZW: "LZWDecode",
  Fl: "FlateDecode",
  RL: "RunLengthDecode",
  CCF: "CCITTFaxDecode",
  DCT: "DCTDecode",
};

/** The full name of a filter (inline images use abbreviations such as `Fl`). */
export const normalizeFilterName = (n: string): string => ABBREVIATIONS[n] ?? n;

export interface PartialDecode {
  /** The bytes after the filters that could be applied. */
  data: Uint8Array;
  /** Filters (full names) that were not applied, because they are image codecs. Empty when fully decoded. */
  remaining: string[];
  /** The `DecodeParms` of each remaining filter, in the same order. */
  remainingParams: (PdfDict | null)[];
}

type Resolve = (o: PdfObj | undefined) => PdfObj;
const identity: Resolve = (o) => (o === undefined ? null : o);

/** The filter names and parameter dictionaries of a stream dictionary (`Filter`/`F`, `DecodeParms`/`DP`). */
export function streamFilters(dict: PdfDict, resolve: Resolve = identity): { names: string[]; params: (PdfDict | null)[] } {
  const f = resolve(dict.get("Filter") ?? dict.get("F"));
  const p = resolve(dict.get("DecodeParms") ?? dict.get("DP") ?? dict.get("DecodeParams"));
  const names: string[] = [];
  const params: (PdfDict | null)[] = [];
  const asDict = (o: PdfObj | undefined): PdfDict | null => {
    const r = resolve(o);
    return r instanceof PdfDict ? r : null;
  };
  if (f instanceof PdfName) {
    names.push(normalizeFilterName(f.value));
    params.push(Array.isArray(p) ? asDict(p[0]) : asDict(p));
  } else if (Array.isArray(f)) {
    f.forEach((x, i) => {
      const n = resolve(x);
      if (n instanceof PdfName) {
        names.push(normalizeFilterName(n.value));
        params.push(Array.isArray(p) ? asDict(p[i]) : i === 0 ? asDict(p) : null);
      }
    });
  }
  return { names, params };
}

/** Decodes every filter that is not an image codec. */
export function decodeStreamPartial(stream: PdfStream, resolve: Resolve = identity, options: DecodeOptions = {}): PartialDecode {
  const max = options.maxSize ?? DEFAULT_MAX_STREAM_SIZE;
  const { names, params } = streamFilters(stream.dict, resolve);
  let data = stream.data;
  for (let i = 0; i < names.length; i++) {
    const n = names[i]!;
    if (IMAGE_FILTERS.has(n)) return { data, remaining: names.slice(i), remainingParams: params.slice(i) };
    data = applyFilter(n, data, params[i] ?? null, resolve, max);
  }
  return { data, remaining: [], remainingParams: [] };
}

/** Decodes a stream. When an image codec is in the chain, the data is returned still encoded by that codec. */
export function decodeStream(stream: PdfStream, resolve: Resolve = identity, options: DecodeOptions = {}): Uint8Array {
  return decodeStreamPartial(stream, resolve, options).data;
}

function applyFilter(name: string, data: Uint8Array, params: PdfDict | null, resolve: Resolve, max: number): Uint8Array {
  switch (name) {
    case "FlateDecode":
      return predictor(flateDecode(data, max), params, resolve, max);
    case "LZWDecode": {
      const early = params ? resolve(params.get("EarlyChange")) : 1;
      return predictor(lzwDecode(data, early === 0 ? 0 : 1, max), params, resolve, max);
    }
    case "ASCII85Decode":
      return ascii85Decode(data);
    case "ASCIIHexDecode":
      return asciiHexDecode(data);
    case "RunLengthDecode":
      return runLengthDecode(data, max);
    case "Crypt":
      return data;
    default:
      throw new PliError("unsupported", `unsupported stream filter /${name}`);
  }
}

const tooBig = (): never => {
  throw new PliError("unsupported", "decoded stream is larger than the allowed size");
};

// ---- Flate ---------------------------------------------------------------------------------------------------

export function encodeFlate(bytes: Uint8Array, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
  return zlibSync(bytes, { level });
}

export function flateDecode(data: Uint8Array, max = DEFAULT_MAX_STREAM_SIZE): Uint8Array {
  let start = 0;
  while (start < data.length && start < 8 && (data[start] === 0x0a || data[start] === 0x0d || data[start] === 0x20)) start++;
  const validHeader = (s: number): boolean => s + 1 < data.length && (data[s]! & 15) === 8 && ((data[s]! << 8) | data[s + 1]!) % 31 === 0;
  let body = 0;
  let zlib = false;
  if (validHeader(start)) {
    zlib = true;
    body = start + 2 + ((data[start + 1]! & 0x20) !== 0 ? 4 : 0);
  } else if (validHeader(0)) {
    zlib = true;
    start = 0;
    body = 2;
  }
  if (zlib) {
    try {
      if (data.length - start <= max / 1032) return unzlibSync(start ? data.subarray(start) : data);
      return inflateLimited(data.subarray(body), max);
    } catch (e) {
      if (e instanceof PliError) throw e;
      // fall through to the tolerant decoder
    }
  }
  const r = inflateTolerant(data, zlib ? body : 0, max);
  if (r.length === 0 && !zlib && data.length > 2) {
    // not raw deflate either: maybe a zlib stream with a damaged header
    const r2 = inflateTolerant(data, 2, max);
    if (r2.length > 0) return r2;
  }
  return r;
}

/** fflate's streaming inflate, fed in small pieces so a decompression bomb is noticed early. Throws on bad data. */
function inflateLimited(src: Uint8Array, max: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inf = new Inflate((c) => {
    chunks.push(c);
    total += c.length;
  });
  const step = 32768;
  for (let i = 0; i < src.length; i += step) {
    inf.push(src.subarray(i, Math.min(i + step, src.length)), i + step >= src.length);
    if (total > max) tooBig();
  }
  const out = new Uint8Array(total);
  let n = 0;
  for (const c of chunks) {
    out.set(c, n);
    n += c.length;
  }
  return out;
}

/** Slow, forgiving inflate (RFC 1951). Stops at the first error or at the end of the data and returns what it has. */
export function inflateTolerant(src: Uint8Array, start: number, max: number): Uint8Array {
  let out = new Uint8Array(Math.min(Math.max(src.length * 4, 1024), max));
  let on = 0;
  let pos = start;
  let bitBuf = 0;
  let bitCnt = 0;
  let eof = false;

  const grow = (need: number): void => {
    if (on + need <= out.length) return;
    if (on + need > max) tooBig();
    let n = out.length * 2;
    while (n < on + need) n *= 2;
    const o = new Uint8Array(Math.min(n, max));
    o.set(out.subarray(0, on));
    out = o;
  };
  const bits = (n: number): number => {
    while (bitCnt < n) {
      if (pos >= src.length) {
        eof = true;
        return 0;
      }
      bitBuf |= src[pos++]! << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };

  interface Huff {
    count: Uint16Array;
    symbol: Uint16Array;
  }
  const build = (lengths: ArrayLike<number>, n: number): Huff => {
    const count = new Uint16Array(16);
    const symbol = new Uint16Array(n);
    for (let i = 0; i < n; i++) count[lengths[i]!]!++;
    const offs = new Uint16Array(16);
    for (let i = 1; i < 15; i++) offs[i + 1] = offs[i]! + count[i]!;
    for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]!]!++] = i;
    return { count, symbol };
  };
  const decode = (h: Huff): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      if (eof) return -1;
      const c = h.count[len]!;
      if (code - c < first) return h.symbol[index + (code - first)]!;
      index += c;
      first += c;
      first <<= 1;
      code <<= 1;
    }
    return -1;
  };
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let fixedL: Huff | undefined;
  let fixedD: Huff | undefined;

  const codes = (hl: Huff, hd: Huff): boolean => {
    for (;;) {
      const sym = decode(hl);
      if (sym < 0) return false;
      if (sym < 256) {
        grow(1);
        out[on++] = sym;
      } else if (sym === 256) return true;
      else {
        const s = sym - 257;
        if (s >= 29) return false;
        const len = LBASE[s]! + bits(LEXT[s]!);
        const ds = decode(hd);
        if (ds < 0 || ds >= 30) return false;
        const dist = DBASE[ds]! + bits(DEXT[ds]!);
        if (eof || dist > on) return false;
        grow(len);
        for (let i = 0; i < len; i++, on++) out[on] = out[on - dist]!;
      }
    }
  };

  for (;;) {
    const last = bits(1);
    const type = bits(2);
    if (eof) break;
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      if (pos + 4 > src.length) break;
      const len = src[pos]! | (src[pos + 1]! << 8);
      pos += 4;
      const n = Math.min(len, src.length - pos);
      grow(n);
      out.set(src.subarray(pos, pos + n), on);
      on += n;
      pos += n;
      if (n < len) break;
    } else if (type === 1) {
      if (!fixedL) {
        const l = new Uint8Array(288);
        for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
        fixedL = build(l, 288);
        fixedD = build(new Uint8Array(30).fill(5), 30);
      }
      if (!codes(fixedL, fixedD!)) break;
    } else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      if (eof || nlen > 286 || ndist > 30) break;
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[order[i]!] = bits(3);
      const lencode = build(lengths.subarray(0, 19), 19);
      lengths.fill(0);
      let idx = 0;
      let bad = false;
      while (idx < nlen + ndist) {
        const sym = decode(lencode);
        if (sym < 0) {
          bad = true;
          break;
        }
        if (sym < 16) lengths[idx++] = sym;
        else {
          let prev = 0;
          let rep: number;
          if (sym === 16) {
            if (idx === 0) {
              bad = true;
              break;
            }
            prev = lengths[idx - 1]!;
            rep = 3 + bits(2);
          } else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (idx + rep > nlen + ndist) {
            bad = true;
            break;
          }
          while (rep--) lengths[idx++] = prev;
        }
      }
      if (bad || eof) break;
      const hl = build(lengths.subarray(0, nlen), nlen);
      const hd = build(lengths.subarray(nlen, nlen + ndist), ndist);
      if (!codes(hl, hd)) break;
    } else break;
    if (last) break;
  }
  return out.slice(0, on);
}

// ---- LZW -----------------------------------------------------------------------------------------------------

export function lzwDecode(data: Uint8Array, earlyChange: number, max = DEFAULT_MAX_STREAM_SIZE): Uint8Array {
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    suffix[i] = i;
    length[i] = 1;
  }
  let out = new Uint8Array(Math.min(Math.max(data.length * 4, 1024), max));
  let on = 0;
  let next = 258;
  let width = 9;
  let prev = -1;
  let buf = 0;
  let cnt = 0;
  let pos = 0;
  for (;;) {
    while (cnt < width && pos < data.length) {
      buf = ((buf << 8) | data[pos++]!) >>> 0;
      cnt += 8;
      if (cnt > 24) break;
    }
    if (cnt < width) break;
    const code = (buf >>> (cnt - width)) & ((1 << width) - 1);
    cnt -= width;
    buf &= (1 << cnt) - 1;
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    if (code === 257) break;
    let len: number;
    if (prev < 0) {
      if (code > 255) break;
      len = 1;
    } else if (code < next) len = length[code]!;
    else if (code === next && next < 4096) len = length[prev]! + 1;
    else break;
    if (on + len > out.length) {
      if (on + len > max) tooBig();
      const o = new Uint8Array(Math.min(Math.max(out.length * 2, on + len), max));
      o.set(out.subarray(0, on));
      out = o;
    }
    // write the string for `code` backwards
    if (code < next) {
      let c = code;
      for (let i = on + len - 1; i >= on; i--) {
        out[i] = suffix[c]!;
        c = prefix[c]!;
      }
    } else {
      // the KwKwK case: previous string + its first byte
      let c = prev;
      for (let i = on + len - 2; i >= on; i--) {
        out[i] = suffix[c]!;
        c = prefix[c]!;
      }
      out[on + len - 1] = out[on]!;
    }
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = out[on]!;
      length[next] = length[prev]! + 1;
      next++;
    }
    on += len;
    prev = code;
    const lim = next + earlyChange;
    width = lim >= 2048 ? 12 : lim >= 1024 ? 11 : lim >= 512 ? 10 : 9;
  }
  return out.slice(0, on);
}

// ---- ASCII filters, run length ---------------------------------------------------------------------------------

export function asciiHexDecode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array((data.length >> 1) + 1);
  let n = 0;
  let hi = -1;
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!;
    if (c === 0x3e) break;
    const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out[n++] = (hi << 4) | v;
      hi = -1;
    }
  }
  if (hi >= 0) out[n++] = hi << 4;
  return out.slice(0, n);
}

export function ascii85Decode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil((data.length * 4) / 5) + 8);
  let n = 0;
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  const group = [0, 0, 0, 0, 0];
  let g = 0;
  const flush = (count: number): void => {
    // count = number of characters in the (partial) group, 2..5
    for (let k = count; k < 5; k++) group[k] = 84;
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + group[k]!;
    const bytes = [(v / 16777216) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    for (let k = 0; k < count - 1; k++) out[n++] = bytes[k]!;
  };
  for (; i < data.length; i++) {
    const c = data[i]!;
    if (c === 0x7e) break;
    if (c === 0x7a && g === 0) {
      n += 4;
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    group[g++] = c - 33;
    if (g === 5) {
      flush(5);
      g = 0;
    }
  }
  if (g >= 2) flush(g);
  return out.slice(0, n);
}

export function runLengthDecode(data: Uint8Array, max = DEFAULT_MAX_STREAM_SIZE): Uint8Array {
  const parts: number[] = [];
  let total = 0;
  for (let i = 0; i < data.length; ) {
    const l = data[i++]!;
    if (l === 128) break;
    if (l < 128) {
      total += l + 1;
      i += l + 1;
    } else {
      total += 257 - l;
      i++;
    }
    if (total > max) tooBig();
  }
  parts.length = 0;
  const out = new Uint8Array(total);
  let n = 0;
  for (let i = 0; i < data.length; ) {
    const l = data[i++]!;
    if (l === 128) break;
    if (l < 128) {
      const c = Math.min(l + 1, data.length - i);
      out.set(data.subarray(i, i + c), n);
      n += l + 1;
      i += l + 1;
    } else {
      const b = i < data.length ? data[i++]! : 0;
      out.fill(b, n, n + 257 - l);
      n += 257 - l;
    }
  }
  return out;
}

// ---- Predictors ------------------------------------------------------------------------------------------------

function predictor(data: Uint8Array, params: PdfDict | null, resolve: Resolve, max: number): Uint8Array {
  if (!params) return data;
  const num = (key: string, def: number): number => {
    const v = resolve(params.get(key));
    return typeof v === "number" && Number.isFinite(v) ? v : def;
  };
  const pred = num("Predictor", 1);
  if (pred <= 1) return data;
  const colors = Math.max(1, Math.min(num("Colors", 1), 64));
  const bpc = num("BitsPerComponent", 8);
  const columns = Math.max(1, num("Columns", 1));
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowBytes = Math.ceil((colors * bpc * columns) / 8);
  if (rowBytes > max) tooBig();
  if (pred === 2) return tiffPredictor(data, colors, bpc, columns, rowBytes);
  if (pred < 10) return data;
  // PNG: each row starts with a filter-type byte
  const stride = rowBytes + 1;
  const rows = Math.ceil(data.length / stride);
  const out = new Uint8Array(rows * rowBytes);
  let prevOff = -1;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const src = r * stride;
    const type = data[src]!;
    const avail = Math.min(rowBytes, data.length - src - 1);
    const o = r * rowBytes;
    for (let i = 0; i < avail; i++) {
      const x = data[src + 1 + i]!;
      const a = i >= bpp ? out[o + i - bpp]! : 0;
      const b = prevOff >= 0 ? out[prevOff + i]! : 0;
      let v: number;
      switch (type) {
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const c = i >= bpp && prevOff >= 0 ? out[prevOff + i - bpp]! : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          v = x;
      }
      out[o + i] = v & 255;
    }
    prevOff = o;
    n = o + avail;
  }
  return n === out.length ? out : out.slice(0, n);
}

function tiffPredictor(data: Uint8Array, colors: number, bpc: number, columns: number, rowBytes: number): Uint8Array {
  const out = data.slice();
  const rows = Math.ceil(out.length / rowBytes);
  for (let r = 0; r < rows; r++) {
    const o = r * rowBytes;
    const end = Math.min(o + rowBytes, out.length);
    if (bpc === 8) {
      for (let i = o + colors; i < end; i++) out[i] = (out[i]! + out[i - colors]!) & 255;
    } else if (bpc === 16) {
      for (let i = o + colors * 2; i + 1 < end; i += 2) {
        const v = ((out[i]! << 8) | out[i + 1]!) + ((out[i - colors * 2]! << 8) | out[i - colors * 2 + 1]!);
        out[i] = (v >> 8) & 255;
        out[i + 1] = v & 255;
      }
    } else if (bpc === 1 || bpc === 2 || bpc === 4) {
      const mask = (1 << bpc) - 1;
      const total = columns * colors;
      const prev = new Array<number>(colors).fill(0);
      for (let s = 0; s < total; s++) {
        const bitPos = s * bpc;
        const byte = o + (bitPos >> 3);
        if (byte >= end) break;
        const shift = 8 - bpc - (bitPos & 7);
        const c = s % colors;
        const v = (((out[byte]! >> shift) & mask) + prev[c]!) & mask;
        prev[c] = v;
        out[byte] = (out[byte]! & ~(mask << shift)) | (v << shift);
      }
    }
  }
  return out;
}
