/**
 * Embeds a TrueType font (`.ttf`, or the first font of a `.ttc`) in a PDF as a Type0 font with an Identity-H encoding:
 * text is written as 2-byte glyph numbers, so any character the font has can be used, not only Western European ones.
 * The font file is cut down to the glyphs that were used (glyph numbers stay the same, unused outlines are emptied), and
 * a `ToUnicode` map is written so the text can be selected, copied and searched.
 *
 * ```ts
 * const font = embedTrueType(overlay, bytes, { family: "Lora" });
 * const codes = font.encode("Hello");          // use with ContentBuilder.showGlyphs
 * font.finish();                               // after the last encode(), before saving
 * ```
 *
 * Not supported: OpenType fonts with PostScript (CFF) outlines, and fonts whose licence bits forbid embedding.
 * No kerning or ligatures are applied: text is laid out glyph by glyph with the advance widths.
 */
import { PliError } from "@pli.dev/core";
import { zlibSync } from "fflate";
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, latin1Bytes } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import type { Overlay } from "../cos/overlay";

export interface EmbedOptions {
  /** The family name, used for the font's name when the file has none. */
  family: string;
  bold?: boolean;
  italic?: boolean;
  /** Whether the font has serifs, for readers that must substitute it (default: from the font's own classification, else sans). */
  serif?: boolean;
  /** Keep only the glyphs that were used (default true). */
  subset?: boolean;
}

export interface EmbeddedFont {
  /** The Type0 font dictionary: put it in a page's `/Font` resources. */
  ref: PdfRef;
  readonly family: string;
  readonly unitsPerEm: number;
  /** Ascent and descent (descent is negative) as fractions of the font size. */
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  /** 2-byte big-endian glyph numbers for the text (characters the font lacks give glyph 0). */
  encode(text: string): Uint8Array;
  /** The width of the text in points at the size. */
  width(text: string, size: number): number;
  hasGlyph(char: string): boolean;
  /** Writes the widths, the `ToUnicode` map and the font file for the characters used so far. Call it again after more `encode`s. */
  finish(): void;
}

interface Table {
  offset: number;
  length: number;
}

const u16 = (v: DataView, at: number) => v.getUint16(at);
const i16 = (v: DataView, at: number) => v.getInt16(at);
const u32 = (v: DataView, at: number) => v.getUint32(at);

/** The sum of 32-bit words, as TrueType checksums are. */
function checksum(bytes: Uint8Array): number {
  let sum = 0;
  const n = bytes.length & ~3;
  for (let i = 0; i < n; i += 4) sum = (sum + ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!)) >>> 0;
  let tail = 0;
  for (let i = n; i < bytes.length; i++) tail |= bytes[i]! << (24 - 8 * (i - n));
  return (sum + (tail >>> 0)) >>> 0;
}

interface Parsed {
  view: DataView;
  bytes: Uint8Array;
  tables: Map<string, Table>;
  unitsPerEm: number;
  numGlyphs: number;
  numHMetrics: number;
  glyphFor(cp: number): number;
  advance(gid: number): number;
}

function parse(bytes: Uint8Array): Parsed {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string): never => {
    throw new PliError("unsupported", `This font cannot be embedded: ${why}.`);
  };
  if (bytes.length < 12) fail("the file is too short");
  let base = 0;
  if (u32(view, 0) === 0x74746366) base = u32(view, 12);
  const tag = u32(view, base);
  if (tag === 0x4f54544f) fail("it has PostScript outlines (OpenType CFF), and only TrueType outlines are supported");
  if (tag !== 0x00010000 && tag !== 0x74727565) fail("it is not a TrueType font");
  const count = u16(view, base + 4);
  const tables = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const at = base + 12 + 16 * i;
    if (at + 16 > bytes.length) fail("the table directory is cut off");
    const t = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    tables.set(t, { offset: u32(view, at + 8), length: u32(view, at + 12) });
  }
  const need = (t: string): Table => tables.get(t) ?? fail(`it has no '${t}' table`);
  const head = need("head");
  const hhea = need("hhea");
  const hmtx = need("hmtx");
  const maxp = need("maxp");
  const cmap = need("cmap");
  need("glyf");
  need("loca");
  const unitsPerEm = u16(view, head.offset + 18) || 1000;
  const numGlyphs = u16(view, maxp.offset + 4);
  const numHMetrics = Math.max(1, u16(view, hhea.offset + 34));
  // The best Unicode character map: full repertoire (format 12), else the basic plane (format 4).
  let chosen: { offset: number; format: number } | null = null;
  const sub = u16(view, cmap.offset + 2);
  for (let i = 0; i < sub; i++) {
    const platform = u16(view, cmap.offset + 4 + 8 * i);
    const encoding = u16(view, cmap.offset + 6 + 8 * i);
    const offset = cmap.offset + u32(view, cmap.offset + 8 + 8 * i);
    const format = u16(view, offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    if (!chosen || format === 12) chosen = { offset, format };
  }
  if (!chosen) fail("it has no Unicode character map");
  const map = chosen!;
  const cache = new Map<number, number>();
  const lookup = (code: number): number => {
    if (map.format === 12) {
      let lo = 0;
      let hi = u32(view, map.offset + 12) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = map.offset + 16 + 12 * mid;
        if (code < u32(view, at)) hi = mid - 1;
        else if (code > u32(view, at + 4)) lo = mid + 1;
        else return u32(view, at + 8) + (code - u32(view, at));
      }
      return 0;
    }
    if (code > 0xffff) return 0;
    const segs = u16(view, map.offset + 6) / 2;
    const ends = map.offset + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      if (code > u16(view, ends + 2 * s)) continue;
      if (code < u16(view, starts + 2 * s)) return 0;
      const range = u16(view, ranges + 2 * s);
      if (range === 0) return (code + i16(view, deltas + 2 * s)) & 0xffff;
      const g = u16(view, ranges + 2 * s + range + 2 * (code - u16(view, starts + 2 * s)));
      return g === 0 ? 0 : (g + i16(view, deltas + 2 * s)) & 0xffff;
    }
    return 0;
  };
  const glyphFor = (cp: number): number => {
    let g = cache.get(cp);
    if (g === undefined) cache.set(cp, (g = lookup(cp)));
    return g < numGlyphs ? g : 0;
  };
  const advance = (gid: number): number => u16(view, hmtx.offset + 4 * Math.min(Math.max(gid, 0), numHMetrics - 1));
  return { view, bytes, tables, unitsPerEm, numGlyphs, numHMetrics, glyphFor, advance };
}

/** The PostScript name from the `name` table (id 6), or "". */
function postScriptName(p: Parsed): string {
  const t = p.tables.get("name");
  if (!t) return "";
  const v = p.view;
  const stringsAt = t.offset + u16(v, t.offset + 4);
  for (let i = 0; i < u16(v, t.offset + 2); i++) {
    const at = t.offset + 6 + 12 * i;
    if (u16(v, at + 6) !== 6) continue;
    const platform = u16(v, at);
    const length = u16(v, at + 8);
    const start = stringsAt + u16(v, at + 10);
    let text = "";
    if (platform === 1) for (let k = 0; k < length; k++) text += String.fromCharCode(p.bytes[start + k]!);
    else for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(u16(v, start + k));
    if (text) return text;
  }
  return "";
}

/** The glyphs a glyph is built from (composite glyphs), added to `into`. */
function addComponents(p: Parsed, locaOf: (g: number) => [number, number], gid: number, into: Set<number>): void {
  const stack = [gid];
  while (stack.length) {
    const g = stack.pop()!;
    if (into.has(g)) continue;
    into.add(g);
    const [start, end] = locaOf(g);
    if (end - start < 10) continue;
    const glyf = p.tables.get("glyf")!;
    let at = glyf.offset + start;
    if (i16(p.view, at) >= 0) continue;
    at += 10;
    for (let guard = 0; guard < 256; guard++) {
      const flags = u16(p.view, at);
      stack.push(u16(p.view, at + 2));
      at += 4 + (flags & 1 ? 4 : 2);
      if (flags & 0x8) at += 2;
      else if (flags & 0x40) at += 4;
      else if (flags & 0x80) at += 8;
      if (!(flags & 0x20)) break;
    }
  }
}

/** A font file with only the glyphs in `keep` (plus glyph 0) having outlines. Glyph numbers and widths stay. */
function subsetFont(p: Parsed, keepGlyphs: Iterable<number>): Uint8Array {
  const head = p.tables.get("head")!;
  const loca = p.tables.get("loca")!;
  const glyf = p.tables.get("glyf")!;
  const long = i16(p.view, head.offset + 50) === 1;
  const locaOf = (g: number): [number, number] => {
    if (g >= p.numGlyphs) return [0, 0];
    return long ? [u32(p.view, loca.offset + 4 * g), u32(p.view, loca.offset + 4 * g + 4)] : [u16(p.view, loca.offset + 2 * g) * 2, u16(p.view, loca.offset + 2 * g + 2) * 2];
  };
  const keep = new Set<number>([0]);
  for (const g of keepGlyphs) addComponents(p, locaOf, g, keep);
  const chunks: Uint8Array[] = [];
  const newLoca = new Uint8Array(4 * (p.numGlyphs + 1));
  const lv = new DataView(newLoca.buffer);
  let size = 0;
  for (let g = 0; g < p.numGlyphs; g++) {
    lv.setUint32(4 * g, size);
    if (!keep.has(g)) continue;
    const [s, e] = locaOf(g);
    if (e <= s) continue;
    const slice = p.bytes.subarray(glyf.offset + s, glyf.offset + e);
    const padded = new Uint8Array((slice.length + 3) & ~3);
    padded.set(slice);
    chunks.push(padded);
    size += padded.length;
  }
  lv.setUint32(4 * p.numGlyphs, size);
  const newGlyf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) (newGlyf.set(c, at), (at += c.length));
  const out = new Map<string, Uint8Array>();
  for (const tag of ["cvt ", "fpgm", "head", "hhea", "hmtx", "maxp", "prep"]) {
    const t = p.tables.get(tag);
    if (t) out.set(tag, p.bytes.slice(t.offset, t.offset + t.length));
  }
  const h = out.get("head")!;
  const hv = new DataView(h.buffer);
  hv.setUint32(8, 0);
  hv.setInt16(50, 1);
  out.set("loca", newLoca);
  out.set("glyf", newGlyf);
  const tags = [...out.keys()].sort();
  const dirLen = 12 + 16 * tags.length;
  let total = dirLen;
  for (const t of tags) total += (out.get(t)!.length + 3) & ~3;
  const file = new Uint8Array(total);
  const fv = new DataView(file.buffer);
  fv.setUint32(0, 0x00010000);
  fv.setUint16(4, tags.length);
  let sr = 1;
  let es = 0;
  while (sr * 2 <= tags.length) (sr *= 2, es++);
  fv.setUint16(6, sr * 16);
  fv.setUint16(8, es);
  fv.setUint16(10, tags.length * 16 - sr * 16);
  let pos = dirLen;
  let headAt = 0;
  tags.forEach((t, i) => {
    const data = out.get(t)!;
    const e = 12 + 16 * i;
    for (let k = 0; k < 4; k++) file[e + k] = t.charCodeAt(k);
    fv.setUint32(e + 4, checksum(data));
    fv.setUint32(e + 8, pos);
    fv.setUint32(e + 12, data.length);
    file.set(data, pos);
    if (t === "head") headAt = pos;
    pos += (data.length + 3) & ~3;
  });
  fv.setUint32(headAt + 8, (0xb1b0afba - checksum(file)) >>> 0);
  return file;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

function toUnicodeCMap(map: Map<number, number>): string {
  const lines: string[] = [];
  const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < entries.length; i += 100) {
    const group = entries.slice(i, i + 100);
    lines.push(`${group.length} beginbfchar`);
    for (const [gid, cp] of group) {
      const dst = cp > 0xffff ? hex4(0xd800 + ((cp - 0x10000) >> 10)) + hex4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : hex4(cp);
      lines.push(`<${hex4(gid)}> <${dst}>`);
    }
    lines.push("endbfchar");
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    ...lines,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
    "",
  ].join("\n");
}

function flate(data: Uint8Array, extra: Record<string, PdfObj> = {}): PdfStream {
  const d = new PdfDict();
  for (const [k, v] of Object.entries(extra)) d.set(k, v);
  d.set("Filter", PdfName.of("FlateDecode"));
  return new PdfStream(d, zlibSync(data, { level: 6 }));
}

/** Six capital letters from a number, for the subset tag. */
function subsetTag(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let tag = "";
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.imul(h, 1103515245) + 12345 >>> 0;
  }
  return tag;
}

export function embedTrueType(overlay: Overlay, ttf: Uint8Array, options: EmbedOptions): EmbeddedFont {
  const p = parse(ttf);
  const v = p.view;
  const os2 = p.tables.get("OS/2");
  const post = p.tables.get("post");
  const head = p.tables.get("head")!;
  const hhea = p.tables.get("hhea")!;
  const upem = p.unitsPerEm;
  const scale = (n: number) => Math.round((n * 1000) / upem);
  if (os2 && os2.length >= 10) {
    const fsType = u16(v, os2.offset + 8);
    if (fsType & 0x0002) throw new PliError("unsupported", "This font's licence does not allow it to be embedded in documents.");
  }
  const weight = os2 ? u16(v, os2.offset + 4) : 400;
  const italicAngle = post ? v.getInt32(post.offset + 4) / 65536 : 0;
  const fsSelection = os2 && os2.length >= 64 ? u16(v, os2.offset + 62) : 0;
  const bold = options.bold ?? (weight >= 600 || !!(fsSelection & 0x20));
  const italic = options.italic ?? (italicAngle !== 0 || !!(fsSelection & 1));
  const ascender = i16(v, hhea.offset + 4);
  const descender = i16(v, hhea.offset + 6);
  let capHeight = Math.round(ascender * 0.7);
  let xHeight = 0;
  if (os2 && u16(v, os2.offset) >= 2 && os2.length >= 90) {
    capHeight = i16(v, os2.offset + 88) || capHeight;
    xHeight = i16(v, os2.offset + 86);
  }
  const familyClass = os2 && os2.length >= 32 ? u16(v, os2.offset + 30) >> 8 : 0;
  const fixed = post ? u32(v, post.offset + 12) !== 0 : false;
  let flags = 32;
  if (fixed) flags |= 1;
  const panose = os2 && os2.length >= 42 ? p.bytes[os2.offset + 33]! : 0;
  if (options.serif ?? ((familyClass >= 1 && familyClass <= 5) || familyClass === 7 || (panose >= 2 && panose <= 10))) flags |= 2;
  if (italic) flags |= 64;
  if (bold && weight >= 700) flags |= 1 << 18;
  const psName = (postScriptName(p) || options.family).replace(/[^A-Za-z0-9-]/g, "") || "Font";
  const doSubset = options.subset !== false;

  const type0Ref = overlay.add(null);
  const cidRef = overlay.add(null);
  const descRef = overlay.add(null);
  const fileRef = overlay.add(null);
  const uniRef = overlay.add(null);

  const used = new Map<number, number>(); // glyph -> first code point
  const widthUnits = (gid: number) => p.advance(gid);

  const encode = (text: string): Uint8Array => {
    const out: number[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x200b || cp === 0xfeff || cp === 0xad) continue;
      const gid = cp === 9 || cp === 10 || cp === 13 ? p.glyphFor(32) : p.glyphFor(cp);
      if (gid && !used.has(gid)) used.set(gid, cp === 9 || cp === 10 || cp === 13 ? 32 : cp);
      out.push(gid >> 8, gid & 255);
    }
    return Uint8Array.from(out);
  };

  const font: EmbeddedFont = {
    ref: type0Ref,
    family: options.family,
    unitsPerEm: upem,
    ascent: ascender / upem,
    descent: descender / upem,
    capHeight: capHeight / upem,
    encode,
    width(text, size) {
      let total = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp === 0x200b || cp === 0xfeff || cp === 0xad) continue;
        total += widthUnits(p.glyphFor(cp === 9 || cp === 10 || cp === 13 ? 32 : cp));
      }
      return (total / upem) * size;
    },
    hasGlyph(char) {
      const cp = char.codePointAt(0);
      return cp !== undefined && p.glyphFor(cp) !== 0;
    },
    finish() {
      const gids = [...used.keys()].sort((a, b) => a - b);
      const tag = doSubset ? subsetTag(psName + gids.join(",")) : "";
      const baseFont = doSubset ? `${tag}+${psName}` : psName;
      // Widths: runs of consecutive glyphs.
      const w: PdfObj[] = [];
      let i = 0;
      while (i < gids.length) {
        let j = i;
        const run: number[] = [scale(widthUnits(gids[i]!))];
        while (j + 1 < gids.length && gids[j + 1] === gids[j]! + 1) run.push(scale(widthUnits(gids[++j]!)));
        w.push(gids[i]!, run);
        i = j + 1;
      }
      const file = doSubset ? subsetFont(p, [0, ...gids]) : p.bytes;
      overlay.set(fileRef, flate(file, { Length1: file.length }));
      overlay.set(
        descRef,
        new PdfDict({
          Type: PdfName.of("FontDescriptor"),
          FontName: PdfName.of(baseFont),
          Flags: flags,
          FontBBox: [scale(i16(v, head.offset + 36)), scale(i16(v, head.offset + 38)), scale(i16(v, head.offset + 40)), scale(i16(v, head.offset + 42))],
          ItalicAngle: Math.round(italicAngle * 100) / 100,
          Ascent: scale(ascender),
          Descent: scale(descender),
          CapHeight: scale(capHeight),
          ...(xHeight ? { XHeight: scale(xHeight) } : {}),
          StemV: Math.round(50 + (weight / 65) ** 2),
          FontFile2: fileRef,
        }),
      );
      overlay.set(
        cidRef,
        new PdfDict({
          Type: PdfName.of("Font"),
          Subtype: PdfName.of("CIDFontType2"),
          BaseFont: PdfName.of(baseFont),
          CIDSystemInfo: new PdfDict({ Registry: new PdfString(latin1Bytes("Adobe")), Ordering: new PdfString(latin1Bytes("Identity")), Supplement: 0 }),
          FontDescriptor: descRef,
          DW: scale(widthUnits(0)) || 1000,
          W: w,
          CIDToGIDMap: PdfName.of("Identity"),
        }),
      );
      overlay.set(uniRef, flate(latin1Bytes(toUnicodeCMap(used))));
      overlay.set(
        type0Ref,
        new PdfDict({
          Type: PdfName.of("Font"),
          Subtype: PdfName.of("Type0"),
          BaseFont: PdfName.of(baseFont),
          Encoding: PdfName.of("Identity-H"),
          DescendantFonts: [cidRef],
          ToUnicode: uniRef,
        }),
      );
    },
  };
  font.finish();
  return font;
}
