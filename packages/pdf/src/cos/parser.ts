/**
 * Parser: tokens to objects, indirect objects (with streams) and content streams. Tolerant of missing `endobj`, wrong
 * `Length`, unclosed arrays and dictionaries, and stray keywords.
 */
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, type PdfObj } from "./objects";
import { EOF, KW_ARRAY_CLOSE, KW_ARRAY_OPEN, KW_DICT_CLOSE, KW_DICT_OPEN, KW_FALSE, KW_NULL, KW_TRUE, Keyword, Lexer, isRegular, isWhite } from "./lexer";

/** Thrown for input the parser can't make sense of (for instance, nesting that is far too deep). */
export class PdfSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfSyntaxError";
  }
}

const MAX_DEPTH = 100;
const TERMINATORS = new Set(["endobj", "endstream", "stream", "obj", "xref", "trailer", "startxref"]);

export class Parser {
  constructor(
    readonly lexer: Lexer,
    /** Recognise `12 0 R`. Off for content streams. */
    private readonly refs = true,
  ) {}

  /** The next object, or the `Keyword` that is not part of an object (an operator, `endobj`, `]`, `>>`, `EOF`...). */
  parse(depth = 0): PdfObj | Keyword {
    const lx = this.lexer;
    const t = lx.next();
    if (typeof t === "number") {
      if (!this.refs || !lx.isInt || t < 0) return t;
      const save = lx.pos;
      let q = save;
      const b = lx.bytes;
      const end = lx.end;
      while (q < end && isWhite(b[q]!)) q++;
      if (q < end && b[q]! >= 0x30 && b[q]! <= 0x39) {
        const t2 = lx.next();
        if (typeof t2 === "number" && lx.isInt && t2 >= 0) {
          q = lx.pos;
          while (q < end && isWhite(b[q]!)) q++;
          if (q < end && b[q] === 0x52 && (q + 1 >= end || !isRegular(b[q + 1]!))) {
            lx.pos = q + 1;
            return new PdfRef(t, t2);
          }
        }
        lx.pos = save;
      }
      return t;
    }
    if (t instanceof Keyword) {
      if (t === KW_ARRAY_OPEN) return this.array(depth + 1);
      if (t === KW_DICT_OPEN) return this.dict(depth + 1);
      if (t === KW_TRUE) return true;
      if (t === KW_FALSE) return false;
      if (t === KW_NULL) return null;
    }
    return t;
  }

  private array(depth: number): PdfObj[] {
    if (depth > MAX_DEPTH) throw new PdfSyntaxError("nesting too deep");
    const lx = this.lexer;
    const out: PdfObj[] = [];
    for (;;) {
      const before = lx.pos;
      const v = this.parse(depth);
      if (v instanceof Keyword) {
        if (v === KW_ARRAY_CLOSE || v === EOF) break;
        if (TERMINATORS.has(v.value)) {
          lx.pos = before;
          break;
        }
        continue; // stray keyword or punctuation: skip it
      }
      out.push(v);
    }
    return out;
  }

  private dict(depth: number): PdfDict {
    if (depth > MAX_DEPTH) throw new PdfSyntaxError("nesting too deep");
    const lx = this.lexer;
    const d = new PdfDict();
    for (;;) {
      const before = lx.pos;
      const k = lx.next();
      if (k === KW_DICT_CLOSE || k === EOF) break;
      if (k instanceof Keyword) {
        if (TERMINATORS.has(k.value)) {
          lx.pos = before;
          break;
        }
        continue;
      }
      if (!(k instanceof PdfName)) continue; // a key must be a name: skip the junk
      const beforeValue = lx.pos;
      const v = this.parse(depth);
      if (v instanceof Keyword) {
        if (v === KW_DICT_CLOSE) {
          d.map.set(k.value, null);
          break;
        }
        if (v === EOF) break;
        if (TERMINATORS.has(v.value)) {
          lx.pos = beforeValue;
          break;
        }
        continue;
      }
      d.map.set(k.value, v);
    }
    return d;
  }
}

/** Parses one object at `pos`. Returns null for a missing or unparsable object. */
export function parseObject(bytes: Uint8Array, pos = 0): PdfObj {
  try {
    const v = new Parser(new Lexer(bytes, pos)).parse();
    return v instanceof Keyword ? null : v;
  } catch (e) {
    if (e instanceof PdfSyntaxError) return null;
    throw e;
  }
}

export interface ParsedIndirect {
  num: number;
  gen: number;
  obj: PdfObj;
  /** Position after `endobj` (or after what was read when it is missing). */
  end: number;
}

export interface IndirectOptions {
  /** Resolves an indirect `Length`. Return undefined when it can't be resolved. */
  resolveLength?: (ref: PdfRef) => number | undefined;
}

function startsWith(b: Uint8Array, p: number, word: string): boolean {
  if (p < 0 || p + word.length > b.length) return false;
  for (let i = 0; i < word.length; i++) if (b[p + i] !== word.charCodeAt(i)) return false;
  return true;
}

/** Index of `word` in `b` from `from` (to `to`), or -1. */
export function indexOfWord(b: Uint8Array, word: string, from = 0, to = b.length): number {
  const first = word.charCodeAt(0);
  const last = Math.min(to, b.length) - word.length;
  outer: for (let i = from; i <= last; i++) {
    if (b[i] !== first) continue;
    for (let j = 1; j < word.length; j++) if (b[i + j] !== word.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/**
 * Reads `N G obj ... endobj` at `offset`. Returns null when there is no object header there (the caller then knows
 * the offset is wrong). Streams get their data from `Length` when it points at `endstream`, else by scanning.
 */
export function parseIndirectObject(bytes: Uint8Array, offset: number, options: IndirectOptions = {}): ParsedIndirect | null {
  if (offset < 0 || offset >= bytes.length) return null;
  const lx = new Lexer(bytes, offset);
  const num = lx.next();
  if (typeof num !== "number" || !lx.isInt || num < 0) return null;
  const gen = lx.next();
  if (typeof gen !== "number" || !lx.isInt || gen < 0) return null;
  const kw = lx.next();
  if (!(kw instanceof Keyword)) return null;
  let obj: PdfObj;
  if (kw.value !== "obj") return null;
  const parser = new Parser(lx);
  try {
    const v = parser.parse();
    obj = v instanceof Keyword ? null : v;
  } catch (e) {
    if (e instanceof PdfSyntaxError) obj = null;
    else throw e;
  }
  const after = lx.pos;
  const t = lx.next();
  if (t instanceof Keyword && t.value === "stream" && obj instanceof PdfDict) {
    let p = lx.pos;
    // `stream` is followed by CRLF or LF (CR alone is accepted); trailing blanks before the end of line are skipped.
    let q = p;
    while (q < bytes.length && (bytes[q] === 0x20 || bytes[q] === 0x09)) q++;
    if (bytes[q] === 0x0d) p = bytes[q + 1] === 0x0a ? q + 2 : q + 1;
    else if (bytes[q] === 0x0a) p = q + 1;
    const dataStart = p;
    let length: number | undefined;
    const l = obj.get("Length");
    if (typeof l === "number") length = l;
    else if (l instanceof PdfRef && options.resolveLength) length = options.resolveLength(l);
    let dataEnd = -1;
    let next = -1;
    if (length !== undefined && Number.isInteger(length) && length >= 0 && dataStart + length <= bytes.length) {
      const e = dataStart + length;
      let s = e;
      while (s < bytes.length && isWhite(bytes[s]!)) s++;
      if (startsWith(bytes, s, "endstream")) {
        dataEnd = e;
        next = s + 9;
      } else if (startsWith(bytes, s, "endobj")) {
        dataEnd = e;
        next = s;
      }
    }
    if (dataEnd < 0) {
      let es = indexOfWord(bytes, "endstream", dataStart);
      if (es >= 0) {
        next = es + 9;
        if (es > dataStart && bytes[es - 1] === 0x0a) es--;
        if (es > dataStart && bytes[es - 1] === 0x0d) es--;
        dataEnd = es;
      } else {
        const eo = indexOfWord(bytes, "endobj", dataStart);
        if (eo >= 0) {
          dataEnd = eo;
          next = eo;
        } else {
          dataEnd = bytes.length;
          next = bytes.length;
        }
      }
    }
    const stream = new PdfStream(obj, bytes.subarray(dataStart, dataEnd));
    // consume a trailing endobj
    const l2 = new Lexer(bytes, next);
    const t2 = l2.next();
    const end = t2 instanceof Keyword && t2.value === "endobj" ? l2.pos : next;
    return { num, gen, obj: stream, end };
  }
  if (t instanceof Keyword && t.value === "endobj") return { num, gen, obj, end: lx.pos };
  return { num, gen, obj, end: after };
}

// ---- content streams ------------------------------------------------------------------------------------------

export interface ContentOp {
  op: string;
  args: PdfObj[];
}

const CONTENT_OPS = new Set([
  "b", "B", "b*", "B*", "BDC", "BI", "BMC", "BT", "BX", "c", "cm", "CS", "cs", "d", "d0", "d1", "Do", "DP", "EI", "EMC", "ET", "EX", "f", "F", "f*",
  "G", "g", "gs", "h", "i", "ID", "j", "J", "K", "k", "l", "m", "M", "MP", "n", "q", "Q", "re", "RG", "rg", "ri", "s", "S", "SC", "sc", "SCN", "scn",
  "sh", "T*", "Tc", "Td", "TD", "Tf", "Tj", "TJ", "TL", "Tm", "Tr", "Ts", "Tw", "Tz", "v", "w", "W", "W*", "y", "'", '"',
]);

const PUNCT = new Set(["]", ">>", ">", ")", "{", "}"]);

function isTextByte(c: number): boolean {
  return c === 9 || c === 10 || c === 13 || c === 12 || c === 0 || (c >= 0x20 && c < 0x7f);
}

/** Does the data after an `EI` at `p` look like more content stream (and not like image bytes)? */
function looksLikeContentAfter(b: Uint8Array, p: number): boolean {
  const lim = Math.min(b.length, p + 24);
  for (let i = p; i < lim; i++) if (!isTextByte(b[i]!)) return false;
  const lx = new Lexer(b, p, Math.min(b.length, p + 64));
  for (let n = 0; n < 6; n++) {
    let t;
    try {
      t = lx.next();
    } catch {
      return false;
    }
    if (t === EOF) return true;
    if (t instanceof Keyword && !PUNCT.has(t.value) && t.value !== "true" && t.value !== "false" && t.value !== "null") {
      return CONTENT_OPS.has(t.value) || lx.pos >= Math.min(b.length, p + 64);
    }
  }
  return true;
}

const COMPONENTS: Record<string, number> = { G: 1, DeviceGray: 1, CalGray: 1, RGB: 3, DeviceRGB: 3, CalRGB: 3, CMYK: 4, DeviceCMYK: 4, I: 1, Indexed: 1 };

function inlineKey(d: PdfDict, short: string, long: string): PdfObj | undefined {
  return d.get(short) ?? d.get(long);
}

/** The byte length of raw (unfiltered) inline image data, or -1 if it can't be known. */
function rawInlineLength(d: PdfDict): number {
  if (inlineKey(d, "F", "Filter") != null) return -1;
  const w = inlineKey(d, "W", "Width");
  const h = inlineKey(d, "H", "Height");
  if (typeof w !== "number" || typeof h !== "number") return -1;
  let bpc = inlineKey(d, "BPC", "BitsPerComponent");
  let comps = 1;
  if (inlineKey(d, "IM", "ImageMask") === true) bpc = 1;
  else {
    const cs = inlineKey(d, "CS", "ColorSpace");
    if (cs instanceof PdfName) {
      const n = COMPONENTS[cs.value];
      if (n === undefined) return -1;
      comps = n;
    } else if (Array.isArray(cs) && cs[0] instanceof PdfName && COMPONENTS[cs[0].value] === 1) comps = 1;
    else return -1;
  }
  if (typeof bpc !== "number") return -1;
  return Math.ceil((w * comps * bpc) / 8) * h;
}

function inlineImage(lx: Lexer, parser: Parser): ContentOp {
  const d = new PdfDict();
  for (;;) {
    const k = lx.next();
    if (k === EOF) break;
    if (k instanceof Keyword) {
      if (k.value === "ID") break;
      continue;
    }
    if (!(k instanceof PdfName)) continue;
    const v = parser.parse(1);
    if (v instanceof Keyword) {
      if (v.value === "ID" || v === EOF) break;
      continue;
    }
    d.map.set(k.value, v);
  }
  const b = lx.bytes;
  let start = lx.pos;
  if (start < b.length && isWhite(b[start]!)) start += b[start] === 0x0d && b[start + 1] === 0x0a ? 2 : 1;
  const filter = inlineKey(d, "F", "Filter");
  const f0 = Array.isArray(filter) ? filter[0] : filter;
  const fname = f0 instanceof PdfName ? f0.value : "";
  let dataEnd = -1;
  let after = -1;
  const accept = (ei: number): boolean => {
    // `ei` is the index of "EI"; it must end a word and what follows must look like content
    const nx = ei + 2;
    if (nx < b.length && !isWhite(b[nx]!) && b[nx] !== 0x25) return false;
    return looksLikeContentAfter(b, nx);
  };
  const raw = rawInlineLength(d);
  if (raw >= 0 && start + raw <= b.length) {
    let s = start + raw;
    while (s < b.length && isWhite(b[s]!)) s++;
    if (b[s] === 0x45 && b[s + 1] === 0x49 && accept(s)) {
      dataEnd = start + raw;
      after = s + 2;
    }
  }
  if (dataEnd < 0 && (fname === "AHx" || fname === "ASCIIHexDecode" || fname === "A85" || fname === "ASCII85Decode")) {
    const mark = fname.startsWith("AHx") || fname === "ASCIIHexDecode" ? ">" : "~>";
    const m = indexOfWord(b, mark, start);
    if (m >= 0) {
      let s = m + mark.length;
      while (s < b.length && isWhite(b[s]!)) s++;
      if (b[s] === 0x45 && b[s + 1] === 0x49) {
        dataEnd = m + mark.length;
        after = s + 2;
      }
    }
  }
  if (dataEnd < 0) {
    for (let i = start; i + 1 < b.length; i++) {
      if (b[i] !== 0x45 || b[i + 1] !== 0x49) continue;
      if (i > start && !isWhite(b[i - 1]!)) continue;
      if (!accept(i)) continue;
      dataEnd = i > start ? i - 1 : i;
      if (dataEnd > start && b[dataEnd] === 0x0a && b[dataEnd - 1] === 0x0d) dataEnd--;
      after = i + 2;
      break;
    }
  }
  if (dataEnd < 0) {
    dataEnd = b.length;
    after = b.length;
  }
  lx.pos = after;
  return { op: "BI", args: [d, new PdfString(b.slice(start, dataEnd))] };
}

/**
 * Splits a content stream into operations: `{ op, args }`. An inline image (`BI ... ID data EI`) becomes a single
 * `"BI"` operation with `args = [dict, PdfString(data)]`. The dictionary keeps the abbreviated keys it was written
 * with (`W`, `H`, `BPC`, `CS`, `F`, `DP`...); `filters.ts` understands the abbreviated filter names. Operands left
 * over at the end of the stream are dropped.
 */
export function parseContentStream(bytes: Uint8Array): ContentOp[] {
  const lx = new Lexer(bytes);
  const parser = new Parser(lx, false);
  const ops: ContentOp[] = [];
  let args: PdfObj[] = [];
  for (;;) {
    let t: PdfObj | Keyword;
    try {
      t = parser.parse();
    } catch (e) {
      if (e instanceof PdfSyntaxError) {
        args = [];
        continue;
      }
      throw e;
    }
    if (t === EOF) break;
    if (t instanceof Keyword) {
      const v = t.value;
      if (PUNCT.has(v)) continue;
      if (v === "BI") {
        ops.push(inlineImage(lx, parser));
        args = [];
        continue;
      }
      ops.push({ op: v, args });
      args = [];
    } else args.push(t);
  }
  return ops;
}
