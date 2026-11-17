import { PliError } from "@pli.dev/core";
import { MAX_COLS, MAX_ROWS } from "./model";

/** Column number (1 for A) to its letters. */
const names: string[] = [];
export function colName(col: number): string {
  return (names[col] ??= nameOf(col));
}

function nameOf(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Column letters (any case) to its number, or 0 when they aren't a column. */
export function colNumber(letters: string): number {
  if (letters.length === 0 || letters.length > 3) return 0;
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    const c = letters.charCodeAt(i) & ~32;
    if (c < 65 || c > 90) return 0;
    n = n * 26 + (c - 64);
  }
  return n <= MAX_COLS ? n : 0;
}

export function cellAddress(row: number, col: number): string {
  return colName(col) + row;
}

export interface CellPos {
  row: number;
  col: number;
}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

/** `"B3"` (any case, with or without `$`) to its position, or null when it isn't a cell address. */
export function parseCell(text: string): CellPos | null {
  const m = CELL.exec(text);
  if (!m) return null;
  const col = colNumber(m[1]!);
  const row = Number(m[2]);
  if (col === 0 || row < 1 || row > MAX_ROWS) return null;
  return { row, col };
}

export function mustParseCell(text: string): CellPos {
  const pos = parseCell(text);
  if (!pos) throw new PliError("out_of_range", `"${text}" is not a cell address`);
  return pos;
}

export interface Bounds {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** `"A1:C5"` or one cell `"B3"`. Whole columns (`"A:C"`) and rows (`"2:4"`) take the whole sheet's extent. */
export function parseRange(text: string): Bounds | null {
  const [a, b, extra] = text.split(":");
  if (a === undefined || extra !== undefined) return null;
  if (b === undefined) {
    const p = parseCell(a);
    return p ? { r1: p.row, c1: p.col, r2: p.row, c2: p.col } : null;
  }
  const p = parseCell(a);
  const q = parseCell(b);
  if (p && q) return normalize({ r1: p.row, c1: p.col, r2: q.row, c2: q.col });
  const ca = /^\$?([A-Za-z]{1,3})$/.exec(a);
  const cb = /^\$?([A-Za-z]{1,3})$/.exec(b);
  if (ca && cb && colNumber(ca[1]!) && colNumber(cb[1]!)) {
    return normalize({ r1: 1, c1: colNumber(ca[1]!), r2: MAX_ROWS, c2: colNumber(cb[1]!) });
  }
  const ra = /^\$?(\d{1,7})$/.exec(a);
  const rb = /^\$?(\d{1,7})$/.exec(b);
  if (ra && rb && Number(ra[1]) >= 1 && Number(rb[1]) <= MAX_ROWS) {
    return normalize({ r1: Number(ra[1]), c1: 1, r2: Number(rb[1]), c2: MAX_COLS });
  }
  return null;
}

export function normalize(b: Bounds): Bounds {
  return { r1: Math.min(b.r1, b.r2), c1: Math.min(b.c1, b.c2), r2: Math.max(b.r1, b.r2), c2: Math.max(b.c1, b.c2) };
}

export function rangeAddress(b: Bounds): string {
  const a = cellAddress(b.r1, b.c1);
  return b.r1 === b.r2 && b.c1 === b.c2 ? a : `${a}:${cellAddress(b.r2, b.c2)}`;
}

export function inBounds(b: Bounds, row: number, col: number): boolean {
  return row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2;
}
