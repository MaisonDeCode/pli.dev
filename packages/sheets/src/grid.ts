import { MAX_COLS, MAX_ROWS } from "./model";
import type { Bounds, CellPos } from "./address";

/**
 * What is selected in a grid: a rectangle from `anchor` to `focus`. The anchor is the active cell, where typing
 * goes; extending the selection moves the focus. Whole columns and rows are selected by spanning the sheet.
 */
export interface GridSelection {
  anchor: CellPos;
  focus: CellPos;
  /** The cell typing goes into, when it is not the anchor: Enter and Tab move it around inside the selection. */
  active?: CellPos;
  /** Other rectangles that are selected too (Ctrl+click), beside the one from anchor to focus. */
  more?: Bounds[];
}

export function activeCell(sel: GridSelection): CellPos {
  return sel.active ?? sel.anchor;
}

export type Direction = "up" | "down" | "left" | "right";

export function caret(pos: CellPos): GridSelection {
  return { anchor: pos, focus: pos };
}

/** Every selected rectangle: the extra ones, then the main one (from the anchor to the focus). */
export function selectionRanges(sel: GridSelection): Bounds[] {
  return [...(sel.more ?? []), selectionBounds(sel)];
}

/** The selection with the one just made added to it, as when Ctrl+clicking: what was selected stays selected. */
export function addRange(sel: GridSelection, next: GridSelection): GridSelection {
  return { ...next, more: [...selectionRanges(sel), ...(next.more ?? [])] };
}

export function inSelection(sel: GridSelection, row: number, col: number): boolean {
  return selectionRanges(sel).some((b) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2);
}

export function selectionBounds(sel: GridSelection): Bounds {
  return {
    r1: Math.min(sel.anchor.row, sel.focus.row),
    c1: Math.min(sel.anchor.col, sel.focus.col),
    r2: Math.max(sel.anchor.row, sel.focus.row),
    c2: Math.max(sel.anchor.col, sel.focus.col),
  };
}

export function isSingleCell(sel: GridSelection): boolean {
  return sel.anchor.row === sel.focus.row && sel.anchor.col === sel.focus.col;
}

export function wholeColumns(from: number, to: number, activeRow = 1): GridSelection {
  return { anchor: { row: activeRow, col: from }, focus: { row: MAX_ROWS, col: to } };
}

export function wholeRows(from: number, to: number, activeCol = 1): GridSelection {
  return { anchor: { row: from, col: activeCol }, focus: { row: to, col: MAX_COLS } };
}

export function selectAll(): GridSelection {
  return { anchor: { row: 1, col: 1 }, focus: { row: MAX_ROWS, col: MAX_COLS } };
}

export const spansColumns = (b: Bounds) => b.r1 === 1 && b.r2 === MAX_ROWS;
export const spansRows = (b: Bounds) => b.c1 === 1 && b.c2 === MAX_COLS;

const STEP: Record<Direction, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

function clampPos(row: number, col: number): CellPos {
  return { row: Math.min(MAX_ROWS, Math.max(1, row)), col: Math.min(MAX_COLS, Math.max(1, col)) };
}

/** One cell in a direction, staying on the sheet. */
export function step(pos: CellPos, dir: Direction, amount = 1): CellPos {
  const [dr, dc] = STEP[dir];
  return clampPos(pos.row + dr * amount, pos.col + dc * amount);
}

/**
 * Where Ctrl+arrow goes, as in Excel: from a cell with something next to it in that direction, to the end of that
 * run of filled cells; otherwise to the next filled cell; otherwise to the edge of the sheet.
 */
export function jump(pos: CellPos, dir: Direction, filled: (row: number, col: number) => boolean): CellPos {
  const [dr, dc] = STEP[dir];
  const at = (p: CellPos) => filled(p.row, p.col);
  const edge = (p: CellPos) => (dir === "up" ? p.row === 1 : dir === "down" ? p.row === MAX_ROWS : dir === "left" ? p.col === 1 : p.col === MAX_COLS);
  let cur = pos;
  if (edge(cur)) return cur;
  let next = clampPos(cur.row + dr, cur.col + dc);
  // The search is bounded by the sheet; callers' `filled` is cheap for the empty stretches (sparse lookups).
  if (at(cur) && at(next)) {
    while (!edge(next) && at(clampPos(next.row + dr, next.col + dc))) next = clampPos(next.row + dr, next.col + dc);
    return next;
  }
  cur = next;
  while (!at(cur) && !edge(cur)) cur = clampPos(cur.row + dr, cur.col + dc);
  return cur;
}

/** The selection after an arrow key: moves the active cell, or with `extend` the focus. */
export function moveSelection(sel: GridSelection, dir: Direction, options: { extend?: boolean; filled?: (row: number, col: number) => boolean; amount?: number } = {}): GridSelection {
  const from = options.extend ? sel.focus : sel.anchor;
  const to = options.filled ? jump(from, dir, options.filled) : step(from, dir, options.amount ?? 1);
  return options.extend ? { anchor: sel.anchor, focus: to } : caret(to);
}

/** The selection after Enter (down) or Tab (right): the active cell moves, wrapping inside a multi-cell selection as in Excel. */
export function advance(sel: GridSelection, dir: Direction): GridSelection {
  const here = activeCell(sel);
  if (isSingleCell(sel) && !sel.more?.length) return caret(step(here, dir));
  const b = selectionBounds(sel);
  let { row, col } = here;
  if (dir === "down" || dir === "up") {
    row += dir === "down" ? 1 : -1;
    if (row > b.r2) [row, col] = [b.r1, col + 1 > b.c2 ? b.c1 : col + 1];
    else if (row < b.r1) [row, col] = [b.r2, col - 1 < b.c1 ? b.c2 : col - 1];
  } else {
    col += dir === "right" ? 1 : -1;
    if (col > b.c2) [col, row] = [b.c1, row + 1 > b.r2 ? b.r1 : row + 1];
    else if (col < b.c1) [col, row] = [b.c2, row - 1 < b.r1 ? b.r2 : row - 1];
  }
  return { ...sel, active: { row, col } };
}

const covers = (outer: Bounds, inner: Bounds) => inner.r1 >= outer.r1 && inner.r2 <= outer.r2 && inner.c1 >= outer.c1 && inner.c2 <= outer.c2;
const touches = (a: Bounds, b: Bounds) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

/** A rectangle grown until it holds every merged range it touches. */
function growToMerges(b: Bounds, merges: readonly Bounds[]): Bounds {
  let out = b;
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of merges) {
      if (touches(out, m) && !covers(out, m)) {
        out = { r1: Math.min(out.r1, m.r1), c1: Math.min(out.c1, m.c1), r2: Math.max(out.r2, m.r2), c2: Math.max(out.c2, m.c2) };
        changed = true;
      }
    }
  }
  return out;
}

/** The selection grown to take in every merged range it touches, as Excel selects a merged cell whole. The same selection comes back when nothing grows. */
export function expandToMerges(sel: GridSelection, merges: readonly Bounds[]): GridSelection {
  if (!merges.length) return sel;
  const b = selectionBounds(sel);
  const grown = growToMerges(b, merges);
  const more = sel.more?.map((m) => growToMerges(m, merges));
  const moreChanged = !!more && more.some((m, i) => m !== sel.more![i]);
  if (grown === b && !moreChanged) return sel;
  const { active: _active, ...rest } = sel;
  return grown === b
    ? { ...sel, ...(more ? { more } : {}) }
    : { ...rest, anchor: { row: grown.r1, col: grown.c1 }, focus: { row: grown.r2, col: grown.c2 }, ...(more ? { more } : {}) };
}

/**
 * Where the selection is for a move in `dir` when it is one merged range: at the cell just inside the edge it leaves by,
 * so the move steps out of the range instead of into it. Any other selection is returned as it is.
 */
export function leaveMerge(sel: GridSelection, dir: Direction, merges: readonly Bounds[]): GridSelection {
  if (sel.more?.length) return sel;
  const b = selectionBounds(sel);
  const m = merges.find((x) => x.r1 === b.r1 && x.r2 === b.r2 && x.c1 === b.c1 && x.c2 === b.c2);
  if (!m) return sel;
  return caret(dir === "down" ? { row: m.r2, col: m.c1 } : dir === "right" ? { row: m.r1, col: m.c2 } : { row: m.r1, col: m.c1 });
}
