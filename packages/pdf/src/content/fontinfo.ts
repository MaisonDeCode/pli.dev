/**
 * What the content interpreter needs to know about a font: how the bytes of a string split into characters (codes),
 * which Unicode text each stands for, how far each one advances, and, for text replacement, which codes can show
 * a given character. Read from the PDF font dictionary only: the font program is never parsed (so whether an
 * embedded subset has the outline for a code is judged by the codes the page already uses, see `usedCodes`).
 *
 * Supported: Type1, MMType1, TrueType and Type3 simple fonts (`/Encoding` names, `/Differences`, `/Widths`, the
 * standard 14 without widths), Type0 fonts with Identity-H/V or an embedded CMap stream (codespace ranges, `cidchar`,
 * `cidrange`), CIDFont `/W` `/DW`, `/ToUnicode`. Not supported (honestly): predefined CJK CMaps (`UniJIS-UCS2-H`,
 * `90ms-RKSJ-H`...): their codes are read as 2 bytes and their text only comes out when the font has a `/ToUnicode`
 * (or the CMap name says the code is Unicode, as `Uni*-UCS2-*` and `Uni*-UTF16-*` do).
 */
import { PdfDict, PdfStream, isArray, isDict, isName, isNum, isRef, isStream } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import { standardFamilyFor, standardWidth, winAnsiCode } from "../fonts/standard";
import { baseEncoding, glyphNameToUnicode, latin1Table } from "./glyphs";

/** Reads objects through references and decodes streams: a `PdfFile` or an `Overlay` with `decodeStream`. */
export interface ContentSource {
  get(o: PdfObj | undefined): PdfObj;
  decode(stream: PdfStream): Uint8Array;
}

export interface DecodedChar {
  code: number;
  /** Byte range in the string this character was read from. */
  start: number;
  end: number;
  /** The text it stands for ("" if unknown, U+FFFD when the font gives no way to tell). */
  unicode: string;
  /** Advance in em (1 is the font size), before character and word spacing. */
  width: number;
  /** A single-byte code 32: word spacing applies. */
  space: boolean;
}

// ---- CMaps ---------------------------------------------------------------------------------------------------------

interface CodespaceRange {
  lo: number;
  hi: number;
  bytes: number;
}

interface CMap {
  codespaces: CodespaceRange[];
  /** code to text (bfchar and small bfranges). */
  bf: Map<number, string>;
  /** Large bfranges that were not expanded. */
  bfRanges: { lo: number; hi: number; dst: string }[];
  /** code to CID: ranges. */
  cid: { lo: number; hi: number; cid: number }[];
  /** Length in bytes of the codes in bf (for the reverse map). */
  bfBytes: number;
  vertical: boolean;
}

const hexToCode = (h: string): number => (h.length === 0 ? 0 : parseInt(h, 16));

function utf16Hex(h: string): string {
  let s = "";
  for (let i = 0; i + 3 < h.length + 1; i += 4) {
    const unit = parseInt(h.slice(i, i + 4), 16);
    if (!Number.isNaN(unit)) s += String.fromCharCode(unit);
  }
  // A one-byte destination is a code point below 256.
  if (h.length === 2) s = String.fromCharCode(parseInt(h, 16));
  return s;
}

function bumpLast(s: string, by: number): string {
  if (!s) return s;
  const last = s.charCodeAt(s.length - 1) + by;
  return s.slice(0, -1) + String.fromCharCode(last & 0xffff);
}

/** Parses a ToUnicode or encoding CMap. Tolerant: anything it doesn't understand is skipped. */
export function parseCMap(bytes: Uint8Array): CMap {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const cm: CMap = { codespaces: [], bf: new Map(), bfRanges: [], cid: [], bfBytes: 2, vertical: /\/WMode\s+1/.test(text) };
  const section = /begin(codespacerange|bfchar|bfrange|cidchar|cidrange)([\s\S]*?)end\1/g;
  let m: RegExpExecArray | null;
  while ((m = section.exec(text))) {
    const kind = m[1]!;
    const body = m[2]!;
    const tokens = body.match(/<[0-9A-Fa-f\s]*>|\[|\]|\d+/g) ?? [];
    const hexOf = (t: string | undefined): string => (t ?? "").replace(/[<>\s]/g, "");
    if (kind === "codespacerange") {
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        const lo = hexOf(tokens[i]);
        const hi = hexOf(tokens[i + 1]);
        cm.codespaces.push({ lo: hexToCode(lo), hi: hexToCode(hi), bytes: Math.max(1, Math.ceil(lo.length / 2)) });
      }
    } else if (kind === "bfchar") {
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        const src = hexOf(tokens[i]);
        cm.bfBytes = Math.max(1, Math.ceil(src.length / 2));
        cm.bf.set(hexToCode(src), utf16Hex(hexOf(tokens[i + 1])));
      }
    } else if (kind === "bfrange") {
      let i = 0;
      while (i + 2 < tokens.length) {
        const lo = hexToCode(hexOf(tokens[i]));
        const hi = hexToCode(hexOf(tokens[i + 1]));
        cm.bfBytes = Math.max(1, Math.ceil(hexOf(tokens[i]).length / 2));
        const third = tokens[i + 2]!;
        if (third === "[") {
          let j = i + 3;
          let code = lo;
          while (j < tokens.length && tokens[j] !== "]") {
            if (code <= hi) cm.bf.set(code++, utf16Hex(hexOf(tokens[j])));
            j++;
          }
          i = j + 1;
        } else {
          const dst = utf16Hex(hexOf(third));
          if (hi - lo <= 512) for (let c = lo; c <= hi; c++) cm.bf.set(c, bumpLast(dst, c - lo));
          else cm.bfRanges.push({ lo, hi, dst });
          i += 3;
        }
      }
    } else if (kind === "cidchar") {
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        const c = hexToCode(hexOf(tokens[i]));
        cm.cid.push({ lo: c, hi: c, cid: Number(tokens[i + 1]) });
      }
    } else if (kind === "cidrange") {
      for (let i = 0; i + 2 < tokens.length; i += 3) cm.cid.push({ lo: hexToCode(hexOf(tokens[i])), hi: hexToCode(hexOf(tokens[i + 1])), cid: Number(tokens[i + 2]) });
    }
  }
  cm.cid.sort((a, b) => a.lo - b.lo);
  return cm;
}

function cmapText(cm: CMap, code: number): string | undefined {
  const t = cm.bf.get(code);
  if (t !== undefined) return t;
  for (const r of cm.bfRanges) if (code >= r.lo && code <= r.hi) return bumpLast(r.dst, code - r.lo);
  return undefined;
}

function cmapCid(cm: CMap, code: number): number {
  let lo = 0;
  let hi = cm.cid.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = cm.cid[mid]!;
    if (code < r.lo) hi = mid - 1;
    else if (code > r.hi) lo = mid + 1;
    else return r.cid + (code - r.lo);
  }
  return 0;
}

// ---- font names ----------------------------------------------------------------------------------------------------

export interface FontName {
  /** `ABCDEF+Arial-BoldMT` gives `Arial`, bold. */
  family: string;
  bold: boolean;
  italic: boolean;
  subset: boolean;
  postscript: string;
}

export function parseFontName(baseFont: string): FontName {
  const subset = /^[A-Z]{6}\+/.test(baseFont);
  const ps = baseFont.replace(/^[A-Z]{6}\+/, "");
  const lower = ps.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(lower) && !/^(?:bold)$/.test(lower);
  const italic = /italic|oblique|(?:^|[-,])it(?:mt)?$|ital/.test(lower);
  let family = ps.split(/[-,]/)[0]!.replace(/(PSMT|MT|PS)$/, "");
  family = family.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (/^(Bold|Italic|Oblique)$/i.test(family)) family = "";
  return { family: family || ps, bold, italic, subset, postscript: ps };
}

// ---- the font ------------------------------------------------------------------------------------------------------

export interface FontInfo {
  /** The font dictionary's object (`12 0`), when it has one. */
  key: string;
  subtype: string;
  baseFont: string;
  name: FontName;
  composite: boolean;
  vertical: boolean;
  type3: boolean;
  /** A font file is embedded. */
  embedded: boolean;
  /** Ascent and descent in em (descent is negative). */
  ascent: number;
  descent: number;
  /** Type3: glyph space to text space scale (`FontMatrix` a, normally 0.001). */
  glyphScale: number;
  /** Type3: the box of its glyphs in em, if the font says. */
  bbox?: [number, number, number, number];
  decode(bytes: Uint8Array): DecodedChar[];
  /** Whether this font can write `text` using only codes that are known to work, and the bytes if so. */
  encode(text: string, used?: ReadonlySet<number>): { bytes: Uint8Array; missing: string[]; width: number };
  /** The advance of a character in em, if the font knows it (for fitting new text). */
  charWidth(code: number): number;
}

const SYMBOLIC_FONTS = /^(symbol|zapfdingbats)/i;

function numberAt(src: ContentSource, a: PdfObj | undefined, i: number): number | undefined {
  const arr = src.get(a);
  if (!isArray(arr)) return undefined;
  const v = src.get(arr[i]);
  return isNum(v) ? v : undefined;
}

function nameOf(src: ContentSource, o: PdfObj | undefined): string {
  const v = src.get(o);
  return isName(v) ? v.value : "";
}

/** Reads a font dictionary. Never throws: a broken font gives a plain one-byte, 500-wide font. */
export function loadFont(src: ContentSource, fontObj: PdfObj | undefined): FontInfo {
  try {
    return load(src, fontObj);
  } catch {
    return fallbackFont(isRef(fontObj) ? fontObj.key : "");
  }
}

function fallbackFont(key: string): FontInfo {
  const table = latin1Table();
  return makeSimple({ key, subtype: "Type1", baseFont: "Unknown", table, widths: () => 0.5, embedded: false, ascent: 0.8, descent: -0.2, type3: false, glyphScale: 0.001, restrictToWidths: false });
}

interface SimpleParts {
  key: string;
  subtype: string;
  baseFont: string;
  table: string[];
  widths: (code: number) => number;
  embedded: boolean;
  ascent: number;
  descent: number;
  type3: boolean;
  glyphScale: number;
  bbox?: [number, number, number, number];
  /** Codes with a width entry (so the font is known to draw them). */
  hasWidth?: (code: number) => boolean;
  restrictToWidths: boolean;
}

function makeSimple(p: SimpleParts): FontInfo {
  const name = parseFontName(p.baseFont);
  const reverse = new Map<string, number>();
  for (let c = 0; c < 256; c++) {
    const u = p.table[c];
    if (u && !reverse.has(u)) reverse.set(u, c);
  }
  return {
    key: p.key,
    subtype: p.subtype,
    baseFont: p.baseFont,
    name,
    composite: false,
    vertical: false,
    type3: p.type3,
    embedded: p.embedded,
    ascent: p.ascent,
    descent: p.descent,
    glyphScale: p.glyphScale,
    bbox: p.bbox,
    decode(bytes) {
      const out: DecodedChar[] = [];
      for (let i = 0; i < bytes.length; i++) {
        const code = bytes[i]!;
        out.push({ code, start: i, end: i + 1, unicode: p.table[code] ?? "", width: p.widths(code), space: code === 32 });
      }
      return out;
    },
    encode(text, used) {
      const bytes: number[] = [];
      const missing: string[] = [];
      let width = 0;
      for (const ch of text) {
        const code = ch === " " ? (reverse.get(" ") ?? reverse.get(ch)) : reverse.get(ch);
        const subsetOnly = p.embedded && name.subset;
        const ok = code !== undefined && (!subsetOnly || (used?.has(code) ?? false)) && (!p.restrictToWidths || (p.hasWidth?.(code) ?? true));
        if (ok) {
          bytes.push(code!);
          width += p.widths(code!);
        } else missing.push(ch);
      }
      return { bytes: Uint8Array.from(bytes), missing, width };
    },
    charWidth: (code) => p.widths(code),
  };
}

function descriptorMetrics(src: ContentSource, desc: PdfDict | null, fm: number): { ascent: number; descent: number; flags: number; missing: number; embedded: boolean; italicAngle: number; weight: number } {
  const ascent = desc ? src.get(desc.get("Ascent")) : null;
  const descent = desc ? src.get(desc.get("Descent")) : null;
  const flags = desc ? src.get(desc.get("Flags")) : null;
  const missing = desc ? src.get(desc.get("MissingWidth")) : null;
  const ia = desc ? src.get(desc.get("ItalicAngle")) : null;
  const fw = desc ? src.get(desc.get("FontWeight")) : null;
  const embedded = !!desc && (desc.has("FontFile") || desc.has("FontFile2") || desc.has("FontFile3"));
  return {
    ascent: isNum(ascent) && ascent !== 0 ? ascent * fm : 0,
    descent: isNum(descent) && descent !== 0 ? -Math.abs(descent) * fm : 0,
    flags: isNum(flags) ? flags : 0,
    missing: isNum(missing) ? missing : 0,
    embedded,
    italicAngle: isNum(ia) ? ia : 0,
    weight: isNum(fw) ? fw : 0,
  };
}

const STANDARD_ASCENT: Record<string, [number, number]> = { Helvetica: [0.718, -0.207], Times: [0.683, -0.217], Courier: [0.629, -0.157] };

function load(src: ContentSource, fontObj: PdfObj | undefined): FontInfo {
  const key = isRef(fontObj) ? fontObj.key : "";
  const font = src.get(fontObj);
  if (!isDict(font)) return fallbackFont(key);
  const subtype = nameOf(src, font.get("Subtype")) || "Type1";
  const baseFont = nameOf(src, font.get("BaseFont")) || "Unknown";
  const toUni = readToUnicode(src, font);
  if (subtype === "Type0") return loadComposite(src, font, key, baseFont, toUni);

  const type3 = subtype === "Type3";
  const descObj = src.get(font.get("FontDescriptor"));
  const desc = isDict(descObj) ? descObj : null;
  let fm = 0.001;
  let bbox: [number, number, number, number] | undefined;
  if (type3) {
    const a = numberAt(src, font.get("FontMatrix"), 0);
    if (a) fm = a;
    const bb = [0, 1, 2, 3].map((i) => numberAt(src, font.get("FontBBox"), i));
    if (bb.every((v) => v !== undefined)) {
      const f = a ? Math.abs(a) : 0.001;
      bbox = [bb[0]! * f, bb[1]! * f, bb[2]! * f, bb[3]! * f];
    }
  }
  const dm = descriptorMetrics(src, desc, 0.001);
  const nm = parseFontName(baseFont);
  const std = standardFamilyFor(nm.family || baseFont);
  const isStd14 = !dm.embedded && /^(helvetica|arial|times|courier|symbol|zapfdingbats)/i.test(nm.postscript);

  // Encoding: a base table plus differences.
  const enc = src.get(font.get("Encoding"));
  let baseName = "";
  let differences: PdfObj[] | null = null;
  if (isName(enc)) baseName = enc.value;
  else if (isDict(enc)) {
    baseName = nameOf(src, enc.get("BaseEncoding"));
    const d = src.get(enc.get("Differences"));
    if (isArray(d)) differences = d;
  }
  const symbolic = SYMBOLIC_FONTS.test(nm.postscript) || (dm.flags & 4) !== 0;
  let base = baseEncoding(baseName);
  if (!base) {
    if (type3 || (symbolic && !isName(enc) && !differences)) base = latin1Table();
    else if (subtype === "TrueType" || (dm.flags & 32 && dm.embedded)) base = baseEncoding("WinAnsiEncoding")!;
    else base = baseEncoding("StandardEncoding")!;
  }
  const table = [...base];
  if (differences) {
    let code = 0;
    for (const e of differences) {
      const v = src.get(e);
      if (isNum(v)) code = v;
      else if (isName(v)) {
        if (code >= 0 && code < 256) table[code] = glyphNameToUnicode(v.value) || (/^(?:g|cid|glyph|index|G)\d+$/.test(v.value) ? "" : table[code] ?? "");
        code++;
      }
    }
  }
  if (toUni) for (let c = 0; c < 256; c++) {
    const t = cmapText(toUni, c);
    if (t !== undefined && t !== "") table[c] = t;
  }

  // Widths.
  const first = isNum(src.get(font.get("FirstChar"))) ? (src.get(font.get("FirstChar")) as number) : 0;
  const wArr = src.get(font.get("Widths"));
  const widths = isArray(wArr) ? wArr.map((w) => {
    const v = src.get(w);
    return isNum(v) ? v : 0;
  }) : null;
  const style = { bold: nm.bold, italic: nm.italic };
  const widthOf = (code: number): number => {
    if (widths && code >= first && code < first + widths.length) return widths[code - first]! * (type3 ? fm : 0.001);
    if (widths && dm.missing) return dm.missing * (type3 ? fm : 0.001);
    if (!type3) {
      const ch = table[code] ?? "";
      if (ch) {
        const wa = winAnsiCode(ch[0]!);
        if (!(wa === 63 && ch !== "?")) return standardWidth(wa, std, style) / 1000;
      }
      if (std === "Courier") return 0.6;
    }
    if (widths) return 0;
    return dm.missing ? dm.missing * 0.001 : 0.5;
  };
  const sa = STANDARD_ASCENT[std]!;
  let ascent = dm.ascent || (isStd14 ? sa[0] : 0.8);
  let descent = dm.descent || (isStd14 ? sa[1] : -0.2);
  if (type3 && bbox) {
    ascent = Math.max(bbox[3], 0.1);
    descent = Math.min(bbox[1], 0);
  }
  const info = makeSimple({
    key,
    subtype,
    baseFont,
    table,
    widths: widthOf,
    embedded: dm.embedded || type3,
    ascent,
    descent,
    type3,
    glyphScale: fm,
    bbox,
    hasWidth: (code) => !widths || (code >= first && code < first + widths.length && widths[code - first]! > 0) || code === 32,
    restrictToWidths: !!widths,
  });
  // Style from the descriptor when the name says nothing.
  if (!info.name.bold && (dm.weight >= 700 || dm.flags & (1 << 18))) info.name.bold = true;
  if (!info.name.italic && (dm.italicAngle !== 0 || dm.flags & 64)) info.name.italic = true;
  return info;
}

function readToUnicode(src: ContentSource, font: PdfDict): CMap | null {
  const t = src.get(font.get("ToUnicode"));
  if (!isStream(t)) return null;
  try {
    return parseCMap(src.decode(t));
  } catch {
    return null;
  }
}

function loadComposite(src: ContentSource, font: PdfDict, key: string, baseFont: string, toUni: CMap | null): FontInfo {
  const dfs = src.get(font.get("DescendantFonts"));
  const dfObj = isArray(dfs) ? src.get(dfs[0]) : src.get(dfs);
  const cidFont = isDict(dfObj) ? dfObj : new PdfDict();
  const descObj = src.get(cidFont.get("FontDescriptor"));
  const desc = isDict(descObj) ? descObj : null;
  const dm = descriptorMetrics(src, desc, 0.001);
  const nm = parseFontName(baseFont);
  const enc = src.get(font.get("Encoding"));
  let encName = "";
  let cmap: CMap | null = null;
  if (isName(enc)) encName = enc.value;
  else if (isStream(enc)) {
    try {
      cmap = parseCMap(src.decode(enc));
    } catch {
      cmap = null;
    }
    const w = src.get(enc.dict.get("WMode"));
    if (cmap && w === 1) cmap.vertical = true;
  }
  const vertical = /-V$/.test(encName) || !!cmap?.vertical;
  const unicodeCMap = /^Uni.*-(UCS2|UTF16)-/.test(encName);

  const dw = isNum(src.get(cidFont.get("DW"))) ? (src.get(cidFont.get("DW")) as number) : 1000;
  const w = new Map<number, number>();
  const wArr = src.get(cidFont.get("W"));
  if (isArray(wArr)) {
    let i = 0;
    while (i < wArr.length) {
      const c = src.get(wArr[i]);
      const next = src.get(wArr[i + 1]);
      if (!isNum(c)) {
        i++;
        continue;
      }
      if (isArray(next)) {
        next.forEach((x, j) => {
          const v = src.get(x);
          if (isNum(v)) w.set(c + j, v);
        });
        i += 2;
      } else {
        const last = next;
        const width = src.get(wArr[i + 2]);
        if (isNum(last) && isNum(width)) {
          if (last - c <= 70000) for (let k = c; k <= last; k++) w.set(k, width);
        }
        i += 3;
      }
    }
  }
  const dw2 = src.get(cidFont.get("DW2"));
  const verticalAdvance = isArray(dw2) && isNum(src.get(dw2[1])) ? (src.get(dw2[1]) as number) : -1000;

  const cidOf = (code: number): number => (cmap && cmap.cid.length ? cmapCid(cmap, code) : code);
  const widthOfCode = (code: number): number => {
    const cid = cidOf(code);
    return vertical ? Math.abs(verticalAdvance) / 1000 : (w.get(cid) ?? dw) / 1000;
  };

  // Reverse map for encoding: Unicode text to code (first code wins), from the ToUnicode map.
  const reverse = new Map<string, number>();
  if (toUni) {
    for (const [code, text] of toUni.bf) if (text && !reverse.has(text)) reverse.set(text, code);
  }
  const codeBytes = toUni?.bfBytes ?? 2;
  const ascent = dm.ascent || 0.88;
  const descent = dm.descent || -0.12;
  const subsetOnly = nm.subset;

  return {
    key,
    subtype: "Type0",
    baseFont,
    name: nm,
    composite: true,
    vertical,
    type3: false,
    embedded: dm.embedded,
    ascent,
    descent,
    glyphScale: 0.001,
    decode(bytes) {
      const out: DecodedChar[] = [];
      let i = 0;
      while (i < bytes.length) {
        let n = 2;
        let code = 0;
        if (cmap && cmap.codespaces.length) {
          let found = false;
          for (let len = 1; len <= 4 && i + len <= bytes.length && !found; len++) {
            code = 0;
            for (let k = 0; k < len; k++) code = code * 256 + bytes[i + k]!;
            if (cmap.codespaces.some((r) => r.bytes === len && code >= r.lo && code <= r.hi)) {
              n = len;
              found = true;
            }
          }
          if (!found) n = Math.min(cmap.codespaces[0]!.bytes, bytes.length - i);
        }
        n = Math.max(1, Math.min(n, bytes.length - i));
        code = 0;
        for (let k = 0; k < n; k++) code = code * 256 + bytes[i + k]!;
        let unicode = toUni ? cmapText(toUni, code) : undefined;
        if (unicode === undefined) unicode = unicodeCMap ? String.fromCodePoint(code <= 0x10ffff ? code : 0xfffd) : "�";
        out.push({ code, start: i, end: i + n, unicode, width: widthOfCode(code), space: n === 1 && code === 32 });
        i += n;
      }
      return out;
    },
    encode(text, used) {
      const bytes: number[] = [];
      const missing: string[] = [];
      let width = 0;
      for (const ch of text) {
        const code = reverse.get(ch);
        const ok = code !== undefined && (!subsetOnly || (used?.has(code) ?? false));
        if (ok) {
          for (let k = codeBytes - 1; k >= 0; k--) bytes.push(Math.floor(code! / 256 ** k) & 255);
          width += widthOfCode(code!);
        } else missing.push(ch);
      }
      return { bytes: Uint8Array.from(bytes), missing, width };
    },
    charWidth: widthOfCode,
  };
}
