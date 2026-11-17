/**
 * Taking pixels out of a picture, for redaction. A picture whose samples can be decoded here (no filter, Flate, LZW,
 * run length, ASCII; any bit depth from 1 to 16; gray, RGB, CMYK, ICC based, Indexed, image masks, with soft masks
 * and stencil masks of their own) gets the covered pixels set to black (or, for masks, to "not painted"). The result
 * is a NEW picture object with Flate data, so the original samples are not in the file any more once the old object
 * is no longer referenced.
 *
 * Pictures that need a codec this repository does not have (DCT/JPEG, JPX, JBIG2, CCITT) cannot be cut: the caller
 * removes the whole picture instead. Colour spaces whose "black" is not known (Separation, DeviceN, Lab) likewise.
 */
import { decodeStreamPartial, encodeFlate } from "../cos/filters";
import { PdfDict, PdfName, PdfStream, PdfString, isArray, isName, isNum, isStream } from "../cos/objects";
import type { PdfObj, PdfRef } from "../cos/objects";
import type { Rect } from "../model";
import type { ContentSource } from "./fontinfo";
import { apply, invert, type Matrix } from "./interpreter";

interface Cs {
  comps: number;
  kind: "gray" | "rgb" | "cmyk" | "indexed";
  blackIndex?: number;
}

const csFromName = (n: string): Cs | null => {
  if (n === "DeviceGray" || n === "CalGray" || n === "G") return { comps: 1, kind: "gray" };
  if (n === "DeviceRGB" || n === "CalRGB" || n === "RGB") return { comps: 3, kind: "rgb" };
  if (n === "DeviceCMYK" || n === "CMYK") return { comps: 4, kind: "cmyk" };
  return null;
};

function analyseCs(src: ContentSource, cs: PdfObj | undefined, lookup: (name: string) => PdfObj | undefined, depth = 0): Cs | null {
  const o = src.get(cs);
  if (isName(o)) {
    const direct = csFromName(o.value);
    if (direct) return direct;
    if (depth < 3) {
      const found = lookup(o.value);
      if (found !== undefined) return analyseCs(src, found, lookup, depth + 1);
    }
    return null;
  }
  if (!isArray(o) || o.length === 0) return null;
  const fam = src.get(o[0]);
  if (!isName(fam)) return null;
  if (fam.value === "ICCBased") {
    const s = src.get(o[1]);
    const n = isStream(s) ? src.get(s.dict.get("N")) : null;
    return n === 1 ? { comps: 1, kind: "gray" } : n === 4 ? { comps: 4, kind: "cmyk" } : n === 3 ? { comps: 3, kind: "rgb" } : null;
  }
  const direct = csFromName(fam.value);
  if (direct) return direct;
  if (fam.value === "Indexed" || fam.value === "I") {
    const base = analyseCs(src, o[1], lookup, depth + 1);
    const hival = src.get(o[2]);
    const table = src.get(o[3]);
    if (!base || base.kind === "indexed" || !isNum(hival)) return null;
    let bytes: Uint8Array | null = null;
    if (table instanceof PdfString) bytes = table.bytes;
    else if (isStream(table)) {
      try {
        bytes = src.decode(table);
      } catch {
        bytes = null;
      }
    }
    if (!bytes) return null;
    let best = 0;
    let bestLum = Infinity;
    for (let k = 0; k <= hival && (k + 1) * base.comps <= bytes.length; k++) {
      const e = Array.from(bytes.subarray(k * base.comps, (k + 1) * base.comps), (v) => v / 255);
      const lum = base.kind === "gray" ? e[0]! : base.kind === "rgb" ? 0.3 * e[0]! + 0.59 * e[1]! + 0.11 * e[2]! : (1 - e[0]!) * (1 - e[3]!) * 0.3 + (1 - e[1]!) * (1 - e[3]!) * 0.59 + (1 - e[2]!) * (1 - e[3]!) * 0.11;
      if (lum < bestLum) {
        bestLum = lum;
        best = k;
      }
    }
    return { comps: 1, kind: "indexed", blackIndex: best };
  }
  return null;
}

/** The long names of the keys an inline image dictionary abbreviates. */
const INLINE_KEYS: Record<string, string> = { BPC: "BitsPerComponent", CS: "ColorSpace", D: "Decode", DP: "DecodeParms", F: "Filter", H: "Height", IM: "ImageMask", I: "Interpolate", W: "Width" };
const INLINE_CS: Record<string, string> = { G: "DeviceGray", RGB: "DeviceRGB", CMYK: "DeviceCMYK", I: "Indexed" };

/** An inline image's dictionary with full key names (and colour space names, resolved through the resources). */
export function expandInlineDict(src: ContentSource, d: PdfDict, lookup: (name: string) => PdfObj | undefined): PdfDict {
  const out = new PdfDict();
  for (const [k, v] of d.map) out.set(INLINE_KEYS[k] ?? k, v);
  const cs = out.get("ColorSpace");
  const fix = (o: PdfObj | undefined): PdfObj | undefined => {
    if (isName(o)) {
      const long = INLINE_CS[o.value];
      if (long) return PdfName.of(long);
      if (!csFromName(o.value)) {
        const found = lookup(o.value);
        if (found !== undefined) return fix(src.get(found));
      }
    } else if (isArray(o)) return o.map((e, i) => (i === 0 ? fix(e) : isArray(e) || isName(e) ? fix(e) : e)) as PdfObj;
    return o;
  };
  if (cs !== undefined) out.set("ColorSpace", fix(cs));
  return out;
}

export type BlankOutcome = { kind: "none" } | { kind: "unsupported"; reason: string } | { kind: "done"; stream: PdfStream };

function getNum(src: ContentSource, d: PdfDict, key: string, fallback: number): number {
  const v = src.get(d.get(key));
  return isNum(v) ? v : fallback;
}

/**
 * Sets the pixels of a picture that are under `rects` (page space) to black, given the picture's dictionary (full key
 * names), its raw (still filtered) data and where its unit square is on the page.
 */
export function blankPixels(src: ContentSource, dict: PdfDict, data: Uint8Array, pageMatrix: Matrix, rects: readonly Rect[], lookupCs: (name: string) => PdfObj | undefined, add: (s: PdfStream) => PdfRef): BlankOutcome {
  const width = Math.floor(getNum(src, dict, "Width", 0));
  const height = Math.floor(getNum(src, dict, "Height", 0));
  if (width <= 0 || height <= 0 || width * height > 400_000_000) return { kind: "unsupported", reason: "its size is not known" };
  const stencil = src.get(dict.get("ImageMask")) === true;
  const bpc = stencil ? 1 : getNum(src, dict, "BitsPerComponent", 8);
  if (![1, 2, 4, 8, 16].includes(bpc)) return { kind: "unsupported", reason: `it has ${bpc} bits per sample` };
  let cs: Cs | null;
  if (stencil) cs = { comps: 1, kind: "gray" };
  else {
    cs = analyseCs(src, dict.get("ColorSpace"), lookupCs);
    if (!cs) return { kind: "unsupported", reason: "its colour space has no known black" };
  }
  const decoded = decodeStreamPartial(new PdfStream(dict, data), (o) => src.get(o));
  if (decoded.remaining.length) return { kind: "unsupported", reason: `it is compressed with ${decoded.remaining[0]}` };
  const rowBytes = Math.ceil((width * cs.comps * bpc) / 8);
  const pixels = new Uint8Array(rowBytes * height);
  pixels.set(decoded.data.subarray(0, pixels.length));

  // Which pixels are covered: map each rectangle into the picture's unit square and walk the pixels it can touch.
  const inv = invert(pageMatrix);
  if (!inv) return { kind: "unsupported", reason: "its placement has no inverse" };
  const covered = (px: number, py: number, rect: Rect): boolean => {
    // the pixel's four corners in page space, tested for overlap with the rectangle (by their box: a little generous on turned pictures)
    const u0 = px / width;
    const u1 = (px + 1) / width;
    const v0 = 1 - (py + 1) / height;
    const v1 = 1 - py / height;
    const p = [apply(pageMatrix, u0, v0), apply(pageMatrix, u1, v0), apply(pageMatrix, u1, v1), apply(pageMatrix, u0, v1)];
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    return Math.max(...xs) > rect.x && Math.min(...xs) < rect.x + rect.w && Math.max(...ys) > rect.y && Math.min(...ys) < rect.y + rect.h;
  };

  // the value that is black (or "not painted")
  const dec = src.get(dict.get("Decode"));
  const decode: number[] = isArray(dec) ? dec.map((x) => (isNum(src.get(x)) ? (src.get(x) as number) : 0)) : [];
  const max = 2 ** bpc - 1;
  const sampleFor = (comp: number, colour: number): number => {
    if (cs!.kind === "indexed") return cs!.blackIndex ?? 0;
    const lo = decode[comp * 2] ?? 0;
    const hi = decode[comp * 2 + 1] ?? 1;
    if (hi === lo) return 0;
    return Math.max(0, Math.min(max, Math.round(((colour - lo) / (hi - lo)) * max)));
  };
  const black: number[] = [];
  for (let c = 0; c < cs.comps; c++) {
    // stencils and masks: "not painted" is 1 with the default Decode
    const colour = stencil ? 1 : cs.kind === "cmyk" ? (c === 3 ? 1 : 0) : 0;
    black.push(sampleFor(c, colour));
  }
  const put = (rowStart: number, i: number, v: number) => {
    if (bpc === 8) pixels[rowStart + i] = v;
    else if (bpc === 16) {
      pixels[rowStart + i * 2] = v >> 8;
      pixels[rowStart + i * 2 + 1] = v & 255;
    } else {
      const bit = i * bpc;
      const at = rowStart + (bit >> 3);
      const shift = 8 - bpc - (bit & 7);
      const mask = ((1 << bpc) - 1) << shift;
      pixels[at] = (pixels[at]! & ~mask) | ((v << shift) & mask);
    }
  };

  let count = 0;
  for (const rect of rects) {
    const corners = [apply(inv, rect.x, rect.y), apply(inv, rect.x + rect.w, rect.y), apply(inv, rect.x + rect.w, rect.y + rect.h), apply(inv, rect.x, rect.y + rect.h)];
    const us = corners.map((c) => c[0]);
    const vs = corners.map((c) => c[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...us) * width) - 1);
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...us) * width) + 1);
    const y0 = Math.max(0, Math.floor((1 - Math.max(...vs)) * height) - 1);
    const y1 = Math.min(height - 1, Math.ceil((1 - Math.min(...vs)) * height) + 1);
    for (let y = y0; y <= y1; y++) {
      const rowStart = y * rowBytes;
      for (let x = x0; x <= x1; x++) {
        if (!covered(x, y, rect)) continue;
        for (let c = 0; c < cs.comps; c++) put(rowStart, x * cs.comps + c, black[c]!);
        count++;
      }
    }
  }
  const smask = src.get(dict.get("SMask"));
  const mask = src.get(dict.get("Mask"));
  let newSMask: PdfObj | undefined;
  let newMask: PdfObj | undefined;
  let extra = 0;
  if (isStream(smask)) {
    const r = blankPixels(src, smask.dict, smask.data, pageMatrix, rects, lookupCs, add);
    if (r.kind === "unsupported") return r;
    if (r.kind === "done") {
      newSMask = add(r.stream);
      extra++;
    }
  }
  if (isStream(mask)) {
    const r = blankPixels(src, mask.dict, mask.data, pageMatrix, rects, lookupCs, add);
    if (r.kind === "unsupported") return r;
    if (r.kind === "done") {
      newMask = add(r.stream);
      extra++;
    }
  }
  if (count === 0 && extra === 0) return { kind: "none" };
  const nd = new PdfDict();
  for (const [k, v] of dict.map) {
    if (k === "Filter" || k === "DecodeParms" || k === "Length" || k === "DP" || k === "F") continue;
    nd.set(k, v);
  }
  nd.set("Filter", PdfName.of("FlateDecode"));
  if (newSMask) nd.set("SMask", newSMask);
  if (newMask) nd.set("Mask", newMask);
  return { kind: "done", stream: new PdfStream(nd, encodeFlate(pixels)) };
}
