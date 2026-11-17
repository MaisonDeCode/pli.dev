/**
 * The PDF tokenizer. It reads numbers, strings, names and keywords from bytes and is forgiving about the mess real
 * files contain: comments anywhere, odd whitespace, `#xx` in names, octal and escaped strings, hex strings with an
 * odd number of digits, numbers such as `+.5`, `4.` and `--3`.
 *
 * Names are decoded to strings one character per byte (Latin-1), so they round-trip through the writer exactly.
 */
import { PdfName, PdfString } from "./objects";

/** A bare word (`obj`, `endobj`, `R`, `BT`, ...) or punctuation (`[`, `]`, `<<`, `>>`, `{`, `}`, `)`, `>`). */
export class Keyword {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const kwCache = new Map<string, Keyword>();
/** The one `Keyword` for a word, so keywords compare with `===`. */
export function keyword(value: string): Keyword {
  let k = kwCache.get(value);
  if (!k) kwCache.set(value, (k = new Keyword(value)));
  return k;
}

/** Returned at the end of input. */
export const EOF = new Keyword("<eof>");
export const KW_ARRAY_OPEN = keyword("[");
export const KW_ARRAY_CLOSE = keyword("]");
export const KW_DICT_OPEN = keyword("<<");
export const KW_DICT_CLOSE = keyword(">>");
export const KW_TRUE = keyword("true");
export const KW_FALSE = keyword("false");
export const KW_NULL = keyword("null");

export type Token = number | PdfString | PdfName | Keyword;

/** 0 = regular, 1 = white space, 2 = delimiter. */
const CLS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) CLS[c] = 1;
for (const ch of "()<>[]{}/%") CLS[ch.charCodeAt(0)] = 2;

export const isWhite = (c: number): boolean => CLS[c] === 1;
export const isDelimiter = (c: number): boolean => CLS[c] === 2;
/** True for a byte that can be part of a keyword or name. */
export const isRegular = (c: number): boolean => CLS[c] === 0;

const HEX = new Int8Array(256).fill(-1);
for (let i = 0; i < 10; i++) HEX[0x30 + i] = i;
for (let i = 0; i < 6; i++) {
  HEX[0x41 + i] = 10 + i;
  HEX[0x61 + i] = 10 + i;
}
export const hexValue = (c: number): number => HEX[c]!;

/** Short keywords are looked up by their bytes, so no string is built for the common operators. */
const shortKw = new Map<number, Keyword>();

export class Lexer {
  pos: number;
  readonly end: number;
  /** After `next()` returned a number: whether it was written as an integer (no `.`). */
  isInt = true;

  constructor(
    readonly bytes: Uint8Array,
    pos = 0,
    end = bytes.length,
  ) {
    this.pos = pos;
    this.end = Math.min(end, bytes.length);
  }

  /** Skips white space and comments. Returns the new position. */
  skipSpace(): number {
    const b = this.bytes;
    const end = this.end;
    let p = this.pos;
    for (;;) {
      if (p >= end) break;
      const c = b[p]!;
      if (CLS[c] === 1) p++;
      else if (c === 0x25) {
        p++;
        while (p < end && b[p] !== 10 && b[p] !== 13) p++;
      } else break;
    }
    this.pos = p;
    return p;
  }

  /** The next byte after white space and comments, or -1. Does not consume it. */
  peekByte(): number {
    const p = this.skipSpace();
    return p < this.end ? this.bytes[p]! : -1;
  }

  next(): Token {
    const b = this.bytes;
    const end = this.end;
    const p = this.skipSpace();
    if (p >= end) return EOF;
    const c = b[p]!;
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const n = this.number(p);
      if (n !== undefined) return n;
      return this.word(p);
    }
    switch (c) {
      case 0x2f:
        return this.name(p);
      case 0x28:
        return this.literalString(p);
      case 0x3c:
        if (p + 1 < end && b[p + 1] === 0x3c) {
          this.pos = p + 2;
          return KW_DICT_OPEN;
        }
        return this.hexString(p);
      case 0x3e:
        if (p + 1 < end && b[p + 1] === 0x3e) {
          this.pos = p + 2;
          return KW_DICT_CLOSE;
        }
        this.pos = p + 1;
        return keyword(">");
      case 0x5b:
        this.pos = p + 1;
        return KW_ARRAY_OPEN;
      case 0x5d:
        this.pos = p + 1;
        return KW_ARRAY_CLOSE;
      case 0x7b:
      case 0x7d:
      case 0x29:
        this.pos = p + 1;
        return keyword(String.fromCharCode(c));
      default:
        return this.word(p);
    }
  }

  private number(p: number): number | undefined {
    const b = this.bytes;
    const end = this.end;
    let q = p;
    let neg = false;
    while (q < end && (b[q] === 0x2d || b[q] === 0x2b)) {
      if (b[q] === 0x2d) neg = true;
      q++;
    }
    let int = 0;
    let c: number;
    while (q < end && (c = b[q]!) >= 0x30 && c <= 0x39) {
      int = int * 10 + (c - 0x30);
      q++;
    }
    let value = int;
    let isInt = true;
    if (q < end && b[q] === 0x2e) {
      isInt = false;
      q++;
      let frac = 0;
      let scale = 1;
      while (q < end && (c = b[q]!) >= 0x30 && c <= 0x39) {
        if (scale < 1e15) {
          frac = frac * 10 + (c - 0x30);
          scale *= 10;
        }
        q++;
        }
      value = int + frac / scale;
    }
    if (q < end && CLS[b[q]!] === 0) {
      // Characters left over: junk inside a number (`1.2.3`, `12-3`) or a word such as `1e5` / `0.5g`.
      let r = q;
      while (r < end && ((c = b[r]!) === 0x2d || c === 0x2b || c === 0x2e || (c >= 0x30 && c <= 0x39))) r++;
      if (r < end && CLS[b[r]!] === 0) return undefined;
      q = r;
    }
    this.pos = q;
    this.isInt = isInt;
    return neg ? -value : value;
  }

  private name(p: number): PdfName {
    const b = this.bytes;
    const end = this.end;
    let q = p + 1;
    let hasHash = false;
    while (q < end && CLS[b[q]!] === 0) {
      if (b[q] === 0x23) hasHash = true;
      q++;
    }
    this.pos = q;
    let s = "";
    if (!hasHash) {
      for (let i = p + 1; i < q; i++) s += String.fromCharCode(b[i]!);
    } else {
      for (let i = p + 1; i < q; i++) {
        const ch = b[i]!;
        if (ch === 0x23 && i + 2 < q && HEX[b[i + 1]!]! >= 0 && HEX[b[i + 2]!]! >= 0) {
          s += String.fromCharCode((HEX[b[i + 1]!]! << 4) | HEX[b[i + 2]!]!);
          i += 2;
        } else s += String.fromCharCode(ch);
      }
    }
    return PdfName.of(s);
  }

  private literalString(p: number): PdfString {
    const b = this.bytes;
    const end = this.end;
    // Pass 1: find the closing parenthesis.
    let depth = 1;
    let q = p + 1;
    let plain = true;
    while (q < end) {
      const c = b[q]!;
      if (c === 0x5c) {
        plain = false;
        q += 2;
        continue;
      }
      if (c === 0x0d) plain = false;
      else if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) break;
      q++;
    }
    const close = Math.min(q, end);
    this.pos = Math.min(close + 1, end);
    if (plain) return new PdfString(b.slice(p + 1, close));
    const out: number[] = [];
    for (let i = p + 1; i < close; i++) {
      const c = b[i]!;
      if (c === 0x5c) {
        i++;
        if (i >= close) break;
        const e = b[i]!;
        switch (e) {
          case 0x6e:
            out.push(10);
            break;
          case 0x72:
            out.push(13);
            break;
          case 0x74:
            out.push(9);
            break;
          case 0x62:
            out.push(8);
            break;
          case 0x66:
            out.push(12);
            break;
          case 0x0d:
            if (b[i + 1] === 0x0a) i++;
            break;
          case 0x0a:
            break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let v = e - 0x30;
              if (i + 1 < close && b[i + 1]! >= 0x30 && b[i + 1]! <= 0x37) {
                v = v * 8 + (b[++i]! - 0x30);
                if (i + 1 < close && b[i + 1]! >= 0x30 && b[i + 1]! <= 0x37) v = v * 8 + (b[++i]! - 0x30);
              }
              out.push(v & 255);
            } else out.push(e);
        }
      } else if (c === 0x0d) {
        out.push(10);
        if (b[i + 1] === 0x0a) i++;
      } else out.push(c);
    }
    return new PdfString(Uint8Array.from(out));
  }

  private hexString(p: number): PdfString {
    const b = this.bytes;
    const end = this.end;
    let q = p + 1;
    const out: number[] = [];
    let hi = -1;
    while (q < end) {
      const c = b[q]!;
      q++;
      if (c === 0x3e) break;
      const v = HEX[c]!;
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        out.push((hi << 4) | v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi << 4);
    this.pos = q;
    return new PdfString(Uint8Array.from(out), true);
  }

  private word(p: number): Keyword {
    const b = this.bytes;
    const end = this.end;
    let q = p + 1;
    while (q < end && CLS[b[q]!] === 0) q++;
    this.pos = q;
    const n = q - p;
    if (n <= 3) {
      const key = b[p]! | ((n > 1 ? b[p + 1]! : 0) << 8) | ((n > 2 ? b[p + 2]! : 0) << 16) | (n << 24);
      let k = shortKw.get(key);
      if (!k) {
        let s = "";
        for (let i = p; i < q; i++) s += String.fromCharCode(b[i]!);
        shortKw.set(key, (k = keyword(s)));
      }
      return k;
    }
    let s = "";
    for (let i = p; i < q; i++) s += String.fromCharCode(b[i]!);
    return keyword(s);
  }
}
