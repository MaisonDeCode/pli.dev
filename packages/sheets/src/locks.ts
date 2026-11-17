import { PliError } from "@pli.dev/core";
import { cellAddress, colName, colNumber, parseCell, type Bounds } from "./address";
import { MAX_COLS, MAX_ROWS, emptyCell, type Cell, type CellStyle, type Dimension, type Sheet } from "./model";

/*
 * Locks that rows and columns carry. A cell's lock is `cell.s.locked`; a cell that says nothing takes the lock of its row
 * (`rows[n].locked`), then of its column (`columns[A].locked`), then of the sheet (`sheet.unlocked`), and is locked when none
 * of them say. Excel does the same through the style of a row or column, which new cells in it are made with.
 */

type Locking = Pick<Sheet, "rows" | "columns" | "unlocked">;

/** The lock cells take when they say nothing, in this row and column. */
export function defaultLock(sheet: Locking, row: number, col: number): boolean {
  const r = sheet.rows?.[String(row)]?.locked;
  if (r !== undefined) return r;
  const c = sheet.columns?.[colName(col)]?.locked;
  if (c !== undefined) return c;
  return !sheet.unlocked;
}

/** Whether the cell at this place is locked (the cell may be missing). */
export function lockAt(sheet: Locking, row: number, col: number, cell: Cell | undefined): boolean {
  return cell?.s?.locked ?? defaultLock(sheet, row, col);
}

/** The same, by the cell's address. */
export function lockOfKey(sheet: Locking, key: string, cell: Cell | undefined): boolean {
  const p = parseCell(key);
  return p ? lockAt(sheet, p.row, p.col, cell) : cell?.s?.locked !== false;
}

/** Whether a sheet has any lock that rows, columns or the sheet itself carry. */
export function hasLockDefaults(sheet: Locking): boolean {
  return !!sheet.unlocked || Object.values(sheet.columns ?? {}).some((d) => d.locked !== undefined) || Object.values(sheet.rows ?? {}).some((d) => d.locked !== undefined);
}

/** Whether any cell of the range is locked, empty ones included. Exact, and quick however large the range is. */
export function anyLocked(sheet: Sheet, b: Bounds): boolean {
  if (b.r1 === b.r2 && b.c1 === b.c2) return lockAt(sheet, b.r1, b.c1, sheet.cells[cellAddress(b.r1, b.c1)]);
  const width = b.c2 - b.c1 + 1;
  const height = b.r2 - b.r1 + 1;
  // Count the cells that are locked by what their row, column and sheet say...
  let explicitRows = 0;
  let lockedRows = 0;
  for (const [k, d] of Object.entries(sheet.rows ?? {})) {
    const n = Number(k);
    if (d.locked === undefined || n < b.r1 || n > b.r2) continue;
    explicitRows++;
    if (d.locked) lockedRows++;
  }
  let lockedCols = 0;
  let explicitCols = 0;
  for (const [k, d] of Object.entries(sheet.columns ?? {})) {
    const n = colNumber(k);
    if (d.locked === undefined || n < b.c1 || n > b.c2) continue;
    explicitCols++;
    if (d.locked) lockedCols++;
  }
  lockedCols += sheet.unlocked ? 0 : width - explicitCols;
  let count = lockedRows * width + (height - explicitRows) * lockedCols;
  // ...then let the cells that exist have their say.
  for (const [key, cell] of Object.entries(sheet.cells)) {
    if (cell.s?.locked === undefined) continue;
    const p = parseCell(key)!;
    if (p.row < b.r1 || p.row > b.r2 || p.col < b.c1 || p.col > b.c2) continue;
    if (cell.s.locked) return true;
    if (defaultLock(sheet, p.row, p.col)) count--;
  }
  return count > 0;
}

/** Whether a cell has anything to say but its lock. */
const bare = (cell: Cell) => emptyCell(cell);

export interface LockChange {
  /** The new lock of the sheet (`true` for unlocked), or undefined when it stays. */
  unlocked?: boolean;
  columns: Record<string, boolean | null>;
  rows: Record<string, boolean | null>;
  cells: Record<string, Cell | null>;
}

const tooMany = () => new PliError("out_of_range", "That would change too many cells at once; select fewer rows or columns");

/**
 * What it takes to lock or unlock the cells of a range, the way Excel does when whole rows, whole columns or the whole sheet are
 * selected: the rows, columns or sheet get the lock for the cells they will have, and the cells that exist take it too. A
 * range that isn't whole rows or columns changes the cells themselves. Returns null when nothing changes.
 */
export function lockChange(sheet: Sheet, b: Bounds, locked: boolean): LockChange | null {
  const allRows = b.r1 === 1 && b.r2 === MAX_ROWS;
  const allCols = b.c1 === 1 && b.c2 === MAX_COLS;
  const out: LockChange = { columns: {}, rows: {}, cells: {} };
  if (!allRows && !allCols) {
    const area = (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1);
    if (area > 1_000_000) throw tooMany();
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        const key = cellAddress(r, c);
        const next = withLock(sheet.cells[key], locked, defaultLock(sheet, r, c));
        if (next !== sheet.cells[key]) out.cells[key] = next ?? null;
      }
    return Object.keys(out.cells).length ? out : null;
  }
  // The locks that will be, ignoring redundant ones.
  let unlocked = !!sheet.unlocked;
  const columns: Record<string, boolean | undefined> = {};
  const rows: Record<string, boolean | undefined> = {};
  for (const [k, d] of Object.entries(sheet.columns ?? {})) if (d.locked !== undefined) columns[k] = d.locked;
  for (const [k, d] of Object.entries(sheet.rows ?? {})) if (d.locked !== undefined) rows[k] = d.locked;
  if (allRows && allCols) {
    unlocked = !locked;
    for (const k of Object.keys(columns)) delete columns[k];
    for (const k of Object.keys(rows)) delete rows[k];
  } else if (allRows) {
    for (let c = b.c1; c <= b.c2; c++) columns[colName(c)] = locked;
  } else {
    for (let r = b.r1; r <= b.r2; r++) rows[String(r)] = locked;
  }
  tidy(columns, rows, unlocked);
  const after: Locking = { unlocked: unlocked || undefined, columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, { locked: v }])), rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { locked: v }])) } as Locking;
  if (!!sheet.unlocked !== unlocked) out.unlocked = unlocked;
  for (const k of new Set([...Object.keys(sheet.columns ?? {}), ...Object.keys(columns)])) {
    const was = sheet.columns?.[k]?.locked;
    if (was !== columns[k]) out.columns[k] = columns[k] ?? null;
  }
  for (const k of new Set([...Object.keys(sheet.rows ?? {}), ...Object.keys(rows)])) {
    const was = sheet.rows?.[k]?.locked;
    if (was !== rows[k]) out.rows[k] = rows[k] ?? null;
  }
  // The cells in the region take the lock as well: the ones that exist, and where a row with a lock of its own crosses columns
  // that were just locked (or the other way round) the cell that would otherwise take the row's.
  const inRegion = (row: number, col: number) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2;
  const touched = new Set<string>();
  for (const key of Object.keys(sheet.cells)) {
    const p = parseCell(key)!;
    if (inRegion(p.row, p.col)) touched.add(key);
  }
  if (allRows && !allCols) {
    const crossing = Object.keys(rows).map(Number);
    if (crossing.length * (b.c2 - b.c1 + 1) > 200_000) throw tooMany();
    for (const r of crossing) if (rows[String(r)] !== locked) for (let c = b.c1; c <= b.c2; c++) touched.add(cellAddress(r, c));
  }
  for (const key of touched) {
    const p = parseCell(key)!;
    const next = withLock(sheet.cells[key], locked, defaultLock(after, p.row, p.col));
    if (next !== sheet.cells[key]) out.cells[key] = next ?? null;
  }
  const changed = out.unlocked !== undefined || Object.keys(out.columns).length || Object.keys(out.rows).length || Object.keys(out.cells).length;
  return changed ? out : null;
}

/** Drops the locks of rows and columns that say what the sheet or the columns would say anyway. */
function tidy(columns: Record<string, boolean | undefined>, rows: Record<string, boolean | undefined>, unlocked: boolean): void {
  const base = !unlocked;
  for (const k of Object.keys(columns)) if (columns[k] === base) delete columns[k];
  const differs = Object.values(columns).some((v) => v !== base);
  if (!differs) for (const k of Object.keys(rows)) if (rows[k] === base) delete rows[k];
}

/** The cell with its own lock set to `locked`, or left to its row, column and sheet when they give the same (`fallback`). Same object if it stays. */
export function withLock(cell: Cell | undefined, locked: boolean, fallback: boolean): Cell | null | undefined {
  const own = cell?.s?.locked;
  const wanted = locked === fallback ? undefined : locked;
  if (own === wanted) return cell;
  const style: CellStyle = { ...cell?.s };
  if (wanted === undefined) delete style.locked;
  else style.locked = wanted;
  const next: Cell = { ...cell };
  if (Object.keys(style).length) next.s = style;
  else delete next.s;
  return bare(next) ? null : next;
}

/** Applies a change of the locks that rows and columns carry to a sheet's dimensions. */
export function applyLocks(sheet: Sheet, change: { unlocked?: boolean | null; columns?: Record<string, boolean | null>; rows?: Record<string, boolean | null> }): Sheet {
  const next: Sheet = { ...sheet };
  if (change.unlocked !== undefined) {
    if (change.unlocked) next.unlocked = true;
    else delete next.unlocked;
  }
  const dims = (key: "columns" | "rows", wanted: Record<string, boolean | null> | undefined) => {
    if (!wanted || !Object.keys(wanted).length) return;
    const out: Record<string, Dimension> = { ...sheet[key] };
    for (const [k, v] of Object.entries(wanted)) {
      const d: Dimension = { ...out[k] };
      if (v === null) delete d.locked;
      else d.locked = v;
      if (Object.keys(d).length) out[k] = d;
      else delete out[k];
    }
    if (Object.keys(out).length) next[key] = out;
    else delete next[key];
  };
  dims("columns", change.columns);
  dims("rows", change.rows);
  return next;
}

/** The locks that these keys of a sheet's columns or rows hold now, so that applying them undoes a change. */
export function locksOf(dims: Record<string, Dimension> | undefined, keys: Iterable<string>): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  for (const k of keys) out[k] = dims?.[k]?.locked ?? null;
  return out;
}

/**
 * Rows or columns inserted next to one that carries a lock take the same lock, as Excel gives them the format of the one before.
 * `dims` are the dimensions after the move; the new ones are `at` to `at + count - 1`.
 */
export function inheritLock(dims: Record<string, Dimension> | undefined, axis: "row" | "col", at: number, count: number): Record<string, Dimension> | undefined {
  const name = (n: number) => (axis === "col" ? colName(n) : String(n));
  const before = at > 1 ? dims?.[name(at - 1)]?.locked : undefined;
  if (before === undefined) return dims;
  const out: Record<string, Dimension> = { ...dims };
  for (let i = 0; i < count; i++) out[name(at + i)] = { ...out[name(at + i)], locked: before };
  return out;
}
