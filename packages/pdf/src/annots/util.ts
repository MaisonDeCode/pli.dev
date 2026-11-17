/** Small helpers shared by the annotation reader and writer: colours, dates, base64, PNG encoding, object access. */
import { zlibSync } from "fflate";
import { PdfDict, PdfName, PdfRef, isArray, isDict, isName, isString, textOf, type PdfObj } from "../cos/objects";

/** Anything that resolves references: a `PdfFile` or an `Overlay`. */
export interface Resolver {
  get(o: PdfObj | undefined): PdfObj;
}

export const num = (o: unknown): number | undefined => (typeof o === "number" && Number.isFinite(o) ? o : undefined);

/** The numbers of an array (references followed), or undefined when it isn't an array of numbers. */
export function numbers(src: Resolver, o: PdfObj | undefined): number[] | undefined {
  const a = src.get(o);
  if (!isArray(a)) return undefined;
  const out: number[] = [];
  for (const e of a) {
    const v = src.get(e);
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    out.push(v);
  }
  return out;
}

export const nameOf = (src: Resolver, o: PdfObj | undefined): string | undefined => {
  const v = src.get(o);
  return isName(v) ? v.value : undefined;
};

export const stringOf = (src: Resolver, o: PdfObj | undefined): string | undefined => {
  const v = src.get(o);
  return isString(v) ? textOf(v) : undefined;
};

export const dictOf = (src: Resolver, o: PdfObj | undefined): PdfDict | undefined => {
  const v = src.get(o);
  return isDict(v) ? v : undefined;
};

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");

/** A PDF colour array (1, 3 or 4 components) as `#rrggbb`; undefined for an empty array (transparent) or anything else. */
export function colorFromArray(src: Resolver, o: PdfObj | undefined): string | undefined {
  const c = numbers(src, o);
  if (!c) return undefined;
  if (c.length === 1) return `#${hex2(c[0]!).repeat(3)}`;
  if (c.length === 3) return `#${hex2(c[0]!)}${hex2(c[1]!)}${hex2(c[2]!)}`;
  if (c.length === 4) {
    const [cc, m, y, k] = c as [number, number, number, number];
    return `#${hex2((1 - cc) * (1 - k))}${hex2((1 - m) * (1 - k))}${hex2((1 - y) * (1 - k))}`;
  }
  return undefined;
}

/** `#rrggbb` as the three numbers of a PDF colour array, rounded to 4 places. */
export function colorArray(hex: string): number[] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  return [0, 2, 4].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1e4) / 1e4);
}

/** A PDF date (`D:20260102030405+01'00'`, also with parts missing) as milliseconds since 1970. */
export function parseDate(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^D?:?\s*(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:([Zz+-])\s*(\d{2})?\s*'?\s*(\d{2})?'?)?/.exec(s.trim());
  if (!m) return undefined;
  const t = Date.UTC(+m[1]!, (+(m[2] ?? 1) || 1) - 1, +(m[3] ?? 1) || 1, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  if (!Number.isFinite(t)) return undefined;
  let offset = 0;
  if (m[7] === "+" || m[7] === "-") offset = (m[7] === "+" ? 1 : -1) * ((+(m[8] ?? 0)) * 60 + +(m[9] ?? 0)) * 60000;
  return t - offset;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? "=" : B64[c & 63]!);
  }
  return out;
}

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/_-]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i]!);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

/** The bytes and type of a `data:` URI picture, or undefined for anything else. */
export function parseDataUri(src: string): { mime: string; bytes: Uint8Array } | undefined {
  const m = /^data:([^;,]+)((?:;[^;,]+)*?)(;base64)?,(.*)$/s.exec(src);
  if (!m) return undefined;
  const mime = m[1]!.toLowerCase();
  if (m[3]) return { mime, bytes: base64Decode(m[4]!) };
  const raw = decodeURIComponent(m[4]!);
  return { mime, bytes: Uint8Array.from(raw, (c) => c.charCodeAt(0) & 255) };
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG file (8 bit grey, grey with alpha, RGB or RGBA) from raw samples. */
export function encodePng(width: number, height: number, channels: 1 | 2 | 3 | 4, samples: Uint8Array): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(samples.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const chunk = (tag: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = tag.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6;
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

export const name = (v: string): PdfName => PdfName.of(v);

export const isRefTo = (o: PdfObj | undefined): o is PdfRef => o instanceof PdfRef;

/** Equal JSON, whatever the order of keys. */
export function canonical(v: unknown): string {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

