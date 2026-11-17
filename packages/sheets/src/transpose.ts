import { cellAddress, colNumber, parseRange, rangeAddress, type Bounds } from "./address";
import { parseFormula, printFormula, type Node, type Pt } from "./formula";
import { MAX_COLS, MAX_ROWS, type Cell, type CellBorders } from "./model";
import { mapNodes } from "./refs";

/*
 * Paste special > Transpose: rows become columns and columns rows. The cell at row i, column j of the copied block lands at
 * row j, column i of the pasted one. Everything that has a direction is turned with it: the lines around a cell (a top
 * border becomes a left one), the spans of merged cells, the ranges conditional formats and data validation cover, and the
 * references in formulas.
 *
 * References follow Excel's rule: a relative reference keeps its distance from the cell but with rows and columns
 * exchanged (a cell that read the one to its left now reads the one above it), so a formula that read cells inside the copied
 * block reads their transposed copies; a reference with `$` on both its row and its column keeps pointing where it did; a
 * mixed reference (`$A1`) is turned as a whole, so that a reference to "the column on the left" becomes one to "the row on top".
 */

/** The cell at `row`, `col` of the source lands at this place when the block's top left goes to `origin`. */
export const transposedAt = (source: Bounds, origin: { row: number; col: number }, row: number, col: number): { row: number; col: number } => ({ row: origin.row + (col - source.c1), col: origin.col + (row - source.r1) });

/** A range of the source as it lies after the transpose. */
export const transposedBounds = (source: Bounds, origin: { row: number; col: number }, b: Bounds): Bounds => {
  const a = transposedAt(source, origin, b.r1, b.c1);
  const z = transposedAt(source, origin, b.r2, b.c2);
  return { r1: Math.min(a.row, z.row), c1: Math.min(a.col, z.col), r2: Math.max(a.row, z.row), c2: Math.max(a.col, z.col) };
};

const fullyAbsolute = (p: Pt) => (p.row === null || p.rowAbs) && (p.col === null || p.colAbs);

function turnPt(p: Pt, from: { row: number; col: number }, to: { row: number; col: number }): Pt | null {
  if (fullyAbsolute(p)) return p;
  // The new row is what the column was, and the new column what the row was; a relative part keeps its distance from the cell.
  const row = p.col === null ? null : p.colAbs ? p.col : to.row + (p.col - from.col);
  const col = p.row === null ? null : p.rowAbs ? p.row : to.col + (p.row - from.row);
  if ((col !== null && (col < 1 || col > MAX_COLS)) || (row !== null && (row < 1 || row > MAX_ROWS))) return null;
  return { row, col, rowAbs: p.colAbs, colAbs: p.rowAbs };
}

const REF_ERROR: Node = { t: "err", v: "#REF!" };

/**
 * A formula that sat at `from` as it must read at `to` when the block it is in is transposed. A reference pushed off the
 * sheet becomes `#REF!`; a formula that doesn't read is returned as it was.
 */
export function transposeFormula(source: string, from: { row: number; col: number }, to: { row: number; col: number }): string {
  let tree: Node;
  try {
    tree = parseFormula(source);
  } catch {
    return source;
  }
  let changed = false;
  const next = mapNodes(tree, (n) => {
    if (n.t !== "ref") return n;
    const a = turnPt(n.a, from, to);
    const b = n.b ? turnPt(n.b, from, to) : undefined;
    if (!a || (n.b && !b)) {
      changed = true;
      return REF_ERROR;
    }
    if (a === n.a && (!n.b || b === n.b)) return n;
    changed = true;
    return { ...n, a, ...(b ? { b } : {}) };
  });
  return changed ? printFormula(next) : source;
}

/** The lines of a cell with the sides exchanged: top and left, bottom and right. The diagonals run across either way. */
export function transposeBorders(b: CellBorders): CellBorders {
  const out: CellBorders = {};
  if (b.top) out.left = b.top;
  if (b.left) out.top = b.left;
  if (b.bottom) out.right = b.bottom;
  if (b.right) out.bottom = b.right;
  if (b.diagonalUp) out.diagonalUp = b.diagonalUp;
  if (b.diagonalDown) out.diagonalDown = b.diagonalDown;
  return out;
}

/** A cell as it is when turned: its lines exchanged and its formula (if `from` and `to` are given) re-pointed. */
export function transposeCell(cell: Cell, places?: { from: { row: number; col: number }; to: { row: number; col: number } }): Cell {
  let next = cell;
  if (cell.s?.border) next = { ...next, s: { ...cell.s, border: transposeBorders(cell.s.border) } };
  if (cell.f !== undefined && places) next = { ...next, f: transposeFormula(cell.f, places.from, places.to) };
  return next;
}

/** The address of a range turned about `origin` (a range outside the source isn't moved by it, so this is for ranges inside). */
export function transposeRange(source: Bounds, origin: { row: number; col: number }, range: string): string {
  const b = parseRange(range)!;
  return rangeAddress(transposedBounds(source, origin, b));
}

const split = (key: string): { row: number; col: number } => {
  const m = /^([A-Z]+)(\d+)$/.exec(key)!;
  return { row: Number(m[2]), col: colNumber(m[1]!) };
};

/**
 * The cells of a paste plan (by address, laid out as they would land at `origin` on a sheet) turned about that top left
 * corner. Returns the new cells; a `null` (a cell to clear) stays one.
 */
export function transposeCells(origin: { row: number; col: number }, cells: Record<string, Cell | null>): Record<string, Cell | null> {
  const out: Record<string, Cell | null> = {};
  const source: Bounds = { r1: origin.row, c1: origin.col, r2: MAX_ROWS, c2: MAX_COLS };
  for (const [key, cell] of Object.entries(cells)) {
    const from = split(key);
    const to = transposedAt(source, origin, from.row, from.col);
    if (to.row > MAX_ROWS || to.col > MAX_COLS) continue;
    out[cellAddress(to.row, to.col)] = cell ? transposeCell(cell, { from, to }) : null;
  }
  return out;
}
