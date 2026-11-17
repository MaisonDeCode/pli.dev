import { PliError } from "@pli.dev/core";
import { cellAddress, colName, colNumber, parseCell, type Bounds } from "./address";
import { MAX_COLS, MAX_ROWS, emptyCell, type Cell, type CellStyle, type Dimension, type Sheet } from "./model";

/*
 * Hidden formulas that rows and columns carry. A cell's own setting is `cell.s.hideFormula`; a cell that says nothing takes the
 * setting of its row (`rows[n].hideFormula`), then of its column (`columns[A].hideFormula`), then of the sheet (`hiddenFormulas`),
 * and shows its formula when none of them says. Excel keeps the same through the style of a row or column (the `hidden` flag of
 * its `<protection>`), the way it keeps whether cells are locked (see `locks.ts`, which this follows).
 */

type Hiding = Pick<Sheet, "rows" | "columns" | "hiddenFormulas">;

/** The setting cells take when they say nothing, in this row and column. */
export function defaultHide(sheet: Hiding, row: number, col: number): boolean {
  const r = sheet.rows?.[String(row)]?.hideFormula;
  if (r !== undefined) return r;
  const c = sheet.columns?.[colName(col)]?.hideFormula;
  if (c !== undefined) return c;
  return !!sheet.hiddenFormulas;
}

/** Whether the cell at this place hides its formula (the cell may be missing). */
export function hideAt(sheet: Hiding, row: number, col: number, cell: Cell | undefined): boolean {
  return cell?.s?.hideFormula ?? defaultHide(sheet, row, col);
}

/** The same, by the cell's address. */
export function hideOfKey(sheet: Hiding, key: string, cell: Cell | undefined): boolean {
  const p = parseCell(key);
  return p ? hideAt(sheet, p.row, p.col, cell) : cell?.s?.hideFormula === true;
}

/** Whether a sheet has any hidden formulas that rows, columns or the sheet itself carry. */
export function hasHideDefaults(sheet: Hiding): boolean {
  return !!sheet.hiddenFormulas || Object.values(sheet.columns ?? {}).some((d) => d.hideFormula !== undefined) || Object.values(sheet.rows ?? {}).some((d) => d.hideFormula !== undefined);
}

/**
 * Whether a cell of the range has a formula that is hidden (once the sheet is protected). Exact however large the range is:
 * only the cells that exist can hold a formula, so it goes through whichever is fewer, the cells of the range or the cells of
 * the sheet, and never the empty ones.
 */
export function anyFormulaHidden(sheet: Sheet, b: Bounds): boolean {
  const area = (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1);
  const keys = Object.keys(sheet.cells);
  const look = (key: string): boolean => {
    const cell = sheet.cells[key];
    return cell?.f !== undefined && hideOfKey(sheet, key, cell);
  };
  if (area <= keys.length) {
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) if (look(cellAddress(r, c))) return true;
    return false;
  }
  for (const key of keys) {
    const p = parseCell(key)!;
    if (p.row >= b.r1 && p.row <= b.r2 && p.col >= b.c1 && p.col <= b.c2 && look(key)) return true;
  }
  return false;
}

export interface HideChange {
  /** The new setting of the sheet, or undefined when it stays. */
  hidden?: boolean;
  columns: Record<string, boolean | null>;
  rows: Record<string, boolean | null>;
  cells: Record<string, Cell | null>;
}

const tooMany = () => new PliError("out_of_range", "That would change too many cells at once; select fewer rows or columns");

/**
 * What it takes to hide or show the formulas of the cells of a range, the way Excel does when whole rows, whole columns or the
 * whole sheet are selected: the rows, columns or sheet get the setting for the cells they will have, and the cells that exist
 * take it too. A range that isn't whole rows or columns changes the cells themselves. Returns null when nothing changes.
 */
export function hideChange(sheet: Sheet, b: Bounds, hidden: boolean): HideChange | null {
  const allRows = b.r1 === 1 && b.r2 === MAX_ROWS;
  const allCols = b.c1 === 1 && b.c2 === MAX_COLS;
  const out: HideChange = { columns: {}, rows: {}, cells: {} };
  if (!allRows && !allCols) {
    const area = (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1);
    // Cells that don't exist only matter when what they would say is different from what they say now.
    if (area > 1_000_000) throw tooMany();
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        const key = cellAddress(r, c);
        const next = withHide(sheet.cells[key], hidden, defaultHide(sheet, r, c));
        if (next !== sheet.cells[key]) out.cells[key] = next ?? null;
      }
    return Object.keys(out.cells).length ? out : null;
  }
  let sheetHides = !!sheet.hiddenFormulas;
  const columns: Record<string, boolean | undefined> = {};
  const rows: Record<string, boolean | undefined> = {};
  for (const [k, d] of Object.entries(sheet.columns ?? {})) if (d.hideFormula !== undefined) columns[k] = d.hideFormula;
  for (const [k, d] of Object.entries(sheet.rows ?? {})) if (d.hideFormula !== undefined) rows[k] = d.hideFormula;
  if (allRows && allCols) {
    sheetHides = hidden;
    for (const k of Object.keys(columns)) delete columns[k];
    for (const k of Object.keys(rows)) delete rows[k];
  } else if (allRows) {
    for (let c = b.c1; c <= b.c2; c++) columns[colName(c)] = hidden;
  } else {
    for (let r = b.r1; r <= b.r2; r++) rows[String(r)] = hidden;
  }
  tidy(columns, rows, sheetHides);
  const after: Hiding = { hiddenFormulas: sheetHides || undefined, columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, { hideFormula: v }])), rows: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { hideFormula: v }])) } as Hiding;
  if (!!sheet.hiddenFormulas !== sheetHides) out.hidden = sheetHides;
  for (const k of new Set([...Object.keys(sheet.columns ?? {}), ...Object.keys(columns)])) {
    const was = sheet.columns?.[k]?.hideFormula;
    if (was !== columns[k]) out.columns[k] = columns[k] ?? null;
  }
  for (const k of new Set([...Object.keys(sheet.rows ?? {}), ...Object.keys(rows)])) {
    const was = sheet.rows?.[k]?.hideFormula;
    if (was !== rows[k]) out.rows[k] = rows[k] ?? null;
  }
  // The cells in the region take the setting as well: the ones that exist, and where a row with a setting of its own crosses columns
  // that were just set (or the other way round) the cell that would otherwise take the row's.
  const inRegion = (row: number, col: number) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2;
  const touched = new Set<string>();
  for (const key of Object.keys(sheet.cells)) {
    const p = parseCell(key)!;
    if (inRegion(p.row, p.col)) touched.add(key);
  }
  if (allRows && !allCols) {
    const crossing = Object.keys(rows).map(Number);
    if (crossing.length * (b.c2 - b.c1 + 1) > 200_000) throw tooMany();
    for (const r of crossing) if (rows[String(r)] !== hidden) for (let c = b.c1; c <= b.c2; c++) touched.add(cellAddress(r, c));
  }
  for (const key of touched) {
    const p = parseCell(key)!;
    const next = withHide(sheet.cells[key], hidden, defaultHide(after, p.row, p.col));
    if (next !== sheet.cells[key]) out.cells[key] = next ?? null;
  }
  const changed = out.hidden !== undefined || Object.keys(out.columns).length || Object.keys(out.rows).length || Object.keys(out.cells).length;
  return changed ? out : null;
}

/** Drops the settings of rows and columns that say what the sheet or the columns would say anyway. */
function tidy(columns: Record<string, boolean | undefined>, rows: Record<string, boolean | undefined>, sheetHides: boolean): void {
  for (const k of Object.keys(columns)) if (columns[k] === sheetHides) delete columns[k];
  const differs = Object.values(columns).some((v) => v !== sheetHides);
  if (!differs) for (const k of Object.keys(rows)) if (rows[k] === sheetHides) delete rows[k];
}

/** The cell with its own setting set to `hidden`, or left to its row, column and sheet when they give the same (`fallback`). Same object if it stays. */
export function withHide(cell: Cell | undefined, hidden: boolean, fallback: boolean): Cell | null | undefined {
  const own = cell?.s?.hideFormula;
  const wanted = hidden === fallback ? undefined : hidden;
  if (own === wanted) return cell;
  const style: CellStyle = { ...cell?.s };
  if (wanted === undefined) delete style.hideFormula;
  else style.hideFormula = wanted;
  const next: Cell = { ...cell };
  if (Object.keys(style).length) next.s = style;
  else delete next.s;
  return emptyCell(next) ? null : next;
}

/** Applies a change of the hidden formulas that rows and columns carry to a sheet's dimensions. */
export function applyHides(sheet: Sheet, change: { hidden?: boolean | null; columns?: Record<string, boolean | null>; rows?: Record<string, boolean | null> }): Sheet {
  const next: Sheet = { ...sheet };
  if (change.hidden !== undefined) {
    if (change.hidden) next.hiddenFormulas = true;
    else delete next.hiddenFormulas;
  }
  const dims = (key: "columns" | "rows", wanted: Record<string, boolean | null> | undefined) => {
    if (!wanted || !Object.keys(wanted).length) return;
    const out: Record<string, Dimension> = { ...sheet[key] };
    for (const [k, v] of Object.entries(wanted)) {
      const d: Dimension = { ...out[k] };
      if (v === null) delete d.hideFormula;
      else d.hideFormula = v;
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

/** The settings that these keys of a sheet's columns or rows hold now, so that applying them undoes a change. */
export function hidesOf(dims: Record<string, Dimension> | undefined, keys: Iterable<string>): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  for (const k of keys) out[k] = dims?.[k]?.hideFormula ?? null;
  return out;
}

/** Rows or columns inserted next to one that hides formulas hide them too, as Excel gives them the format of the one before. */
export function inheritHide(dims: Record<string, Dimension> | undefined, axis: "row" | "col", at: number, count: number): Record<string, Dimension> | undefined {
  const name = (n: number) => (axis === "col" ? colName(n) : String(n));
  const before = at > 1 ? dims?.[name(at - 1)]?.hideFormula : undefined;
  if (before === undefined) return dims;
  const out: Record<string, Dimension> = { ...dims };
  for (let i = 0; i < count; i++) out[name(at + i)] = { ...out[name(at + i)], hideFormula: before };
  return out;
}

/** Whether a column letter is a valid one (for checks on the way in). */
export const validColumn = (k: string) => colNumber(k) >= 1 && colNumber(k) <= MAX_COLS && colName(colNumber(k)) === k;
