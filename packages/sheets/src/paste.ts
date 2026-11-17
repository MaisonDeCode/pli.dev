import { cellAddress, colName, type Bounds } from "./address";
import { Calculator } from "./calc";
import { formatValue } from "./format";
import { FormulaSyntaxError, parseFormula, printFormula, type Node } from "./formula";
import { getFunction } from "./functions";
import { MAX_COLS, MAX_ROWS, type Cell, type Table, type Workbook } from "./model";
import { mapNodes, refsIn, shiftFormula } from "./refs";
import { allTables } from "./table";
import { isError, type Value } from "./values";

/*
 * What pasting needs besides the cells themselves: the options a paste can take, formulas that other programs put on the
 * clipboard (Excel's A1 text, Google Sheets' R1C1 text) read back into formulas, and the sizes of columns and rows.
 */

/** What a paste brings: everything, only the contents (formulas and values), only the values, or only the formats. */
export type PasteContent = "all" | "formulas" | "values" | "formats";

export interface PasteOptions {
  /** What of the copied cells arrives. `all` when missing. */
  content?: PasteContent;
  /**
   * Whether the widths of the source's columns and the heights of its rows come with the cells. `true` brings them (Excel's
   * "Keep source column widths"), `false` leaves the sheet's own, and `"auto"` brings them only into empty space (no cells
   * where the paste lands, and no sizes of their own). A paste from another program is `"auto"`; one of our own `false`.
   */
  widths?: boolean | "auto";
  /** Pastes a copied table as the plain cells it is made of. */
  asRange?: boolean;
  /**
   * Where the copy began (the address of its top left cell in the source workbook). Excel's HTML writes formulas as they
   * read in its workbook and doesn't say where that was; without this, Pli works the position out from the values (and from
   * where an array formula says it filled, `x:fmla-range`). `"here"` takes the formulas as written, as if they had been copied
   * from where they land, which also brings the ones that point outside the copied cells.
   */
  source?: string;
  /**
   * Paste special > Transpose: the copied rows become columns and the columns rows (see `transpose.ts` for what turns with
   * them). Tables arrive as plain cells and column widths and row heights are not brought, as in Excel.
   */
  transpose?: boolean;
  /** Filled in with what the paste left out and why. */
  notes?: string[];
}

// ---- formulas in R1C1 notation ----

// Both a row and a column (`R[-1]C`, `RC[2]`, `R2C3`), a row alone (`R[1]`, `R2`) or a column alone (`C[1]`, `C3`).
const R1C1 = /(?<![A-Za-z0-9_.$])(?:(R(?:\[-?\d+\]|\d+)?)(C(?:\[-?\d+\]|\d+)?)|(R(?:\[-?\d+\]|\d+))|(C(?:\[-?\d+\]|\d+)))(?![A-Za-z0-9_(.!])/y;

/**
 * A formula written in R1C1 notation (`=R[-3]C[0]:R[-1]C[0]`, which is how Google Sheets keeps the formulas it copies,
 * relative to the cell that holds it) as it reads in A1 notation for the cell at `row`, `col`. A reference that falls off
 * the sheet becomes `#REF!`. Text in quotes is left alone.
 */
export function r1c1ToA1(formula: string, row: number, col: number): string {
  const part = (text: string, base: number): { value: number; abs: boolean } => {
    if (text === "") return { value: base, abs: false };
    if (text.startsWith("[")) return { value: base + Number(text.slice(1, -1)), abs: false };
    return { value: Number(text), abs: true };
  };
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const c = formula[i]!;
    if (c === '"' || c === "'") {
      // A string, or a sheet's name in quotes, up to its closing quote (a doubled quote stays inside).
      let j = i + 1;
      while (j < formula.length && !(formula[j] === c && formula[j + 1] !== c)) j += formula[j] === c ? 2 : 1;
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    R1C1.lastIndex = i;
    const m = R1C1.exec(formula);
    if (m && m.index === i) {
      const rowText = m[1] ?? m[3];
      const colText = m[2] ?? m[4];
      const r = rowText !== undefined ? part(rowText.slice(1), row) : null;
      const k = colText !== undefined ? part(colText.slice(1), col) : null;
      if ((r && (r.value < 1 || r.value > MAX_ROWS)) || (k && (k.value < 1 || k.value > MAX_COLS))) out += "#REF!";
      else out += `${k ? (k.abs ? "$" : "") + colName(k.value) : ""}${r ? (r.abs ? "$" : "") + r.value : ""}`;
      i += m[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ---- sizes ----

/** A column width in the sheet's units (characters of the default font) from pixels, as the grid draws it: `px = size * 7 + 5`. */
export const columnSizeOf = (px: number): number => Math.round(((px - 5) / 7) * 100) / 100;
/** A row height in points from pixels. */
export const rowSizeOf = (px: number): number => Math.round(px * 0.75 * 100) / 100;

// ---- reading formulas from other programs ----

/** One formula a paste came with: where it sits in the pasted block (zero-based), what it says, and the value the source showed for it. */
export interface PastedFormula {
  row: number;
  col: number;
  text: string;
  r1c1: boolean;
  /** The range an array formula fills in the source; `""` when it is an array of unknown size. */
  array?: string;
  cached: Value | undefined;
  /** Whether the cached value is exact (the source gave the number), rather than read from what the cell showed. */
  exact: boolean;
  /** The number format and text the cell showed, to compare with when `cached` was read from text. */
  fmt: string | undefined;
  shown: string;
}

export interface AdoptedFormula {
  /** The formula as Pli keeps it (no leading `=`). */
  f: string;
  /** When it fills other cells: how many rows and columns, itself included. */
  extent?: { rows: number; cols: number };
}

export interface AdoptContext {
  workbook: Workbook;
  /** Where the block lands (1-based row and column of its top left cell) and its size. */
  origin: { row: number; col: number };
  rows: number;
  cols: number;
  /** The plain cell at a block position (zero-based), as it will be written. */
  values(row: number, col: number): Cell | undefined;
  /** Where the source's top left cell was, if the caller knows. */
  source?: { row: number; col: number };
  /** Told how the source's position was found when it was a guess between several places. */
  note?(text: string): void;
}

const VOLATILE = new Set(["NOW", "TODAY", "RAND", "RANDBETWEEN", "RANDARRAY", "OFFSET", "INDIRECT"]);
const ARRAYS = new Set(["FILTER", "SORT", "SORTBY", "UNIQUE", "SEQUENCE", "TRANSPOSE", "MMULT", "TEXTSPLIT", "VSTACK", "HSTACK", "TOCOL", "TOROW", "WRAPROWS", "WRAPCOLS", "TAKE", "DROP", "CHOOSECOLS", "CHOOSEROWS", "EXPAND", "MUNIT", "MINVERSE"]);

/** The formula without Excel's marks (`_xlfn.`) or Google Sheets' `ARRAYFORMULA(…)` around all of it, which Pli does by itself. */
function plain(text: string): { f: string; array: boolean } {
  let f = text.trim().replace(/^=/, "").replace(/_xlfn\.|_xlws\./gi, "");
  let array = false;
  const wrapped = /^ARRAYFORMULA\s*\(([\s\S]*)\)$/i.exec(f);
  if (wrapped) {
    // Only when the bracket that closes the call is the last one.
    let depth = 0;
    let closesAtEnd = true;
    for (let i = f.indexOf("("); i < f.length; i++) {
      if (f[i] === '"') {
        i = f.indexOf('"', i + 1);
        if (i < 0) break;
      } else if (f[i] === "(") depth++;
      else if (f[i] === ")" && --depth === 0 && i !== f.length - 1) closesAtEnd = false;
    }
    if (closesAtEnd) {
      f = wrapped[1]!.trim();
      array = true;
    }
  }
  return { f, array };
}

/** Whether Pli can work this formula out as it stands in `wb`: it reads, and every function, name, table and sheet in it is there. */
function usable(wb: Workbook, f: string): Node | null {
  let tree: Node;
  try {
    tree = parseFormula(f);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return null;
    throw e;
  }
  const bound = new Set<string>();
  mapNodes(tree, (n) => {
    if (n.t === "call" && n.name.toUpperCase() === "LET") n.args.forEach((a, i) => i % 2 === 0 && i < n.args.length - 1 && a.t === "name" && bound.add(a.name.toUpperCase()));
    if (n.t === "call" && n.name.toUpperCase() === "LAMBDA") n.args.slice(0, -1).forEach((a) => a.t === "name" && bound.add(a.name.toUpperCase()));
    return n;
  });
  const names = new Set(Object.keys(wb.names ?? {}).map((n) => n.toUpperCase()));
  const tables = new Set(allTables(wb).map((t) => t.table.name.toLowerCase()));
  const sheets = new Set(wb.sheets.map((s) => s.name.toLowerCase()));
  let ok = true;
  mapNodes(tree, (n) => {
    if (n.t === "call" && n.name !== "" && !getFunction(n.name) && !bound.has(n.name.toUpperCase())) ok = false;
    else if (n.t === "name" && !bound.has(n.name.toUpperCase()) && !names.has(n.name.toUpperCase())) ok = false;
    else if (n.t === "tref" && !(n.table ? tables.has(n.table.toLowerCase()) : false)) ok = false;
    else if (n.t === "ref" && n.sheet !== undefined && !sheets.has(n.sheet.replace(/^'|'$/g, "").replace(/''/g, "'").toLowerCase())) ok = false;
    else if (n.t === "err" && n.v === "#REF!") ok = false;
    return n;
  });
  return ok ? tree : null;
}

/** Whether a formula reads the cell at `at` (alone or inside a range on its own sheet). */
const readsCell = (tree: Node, at: { row: number; col: number }): boolean =>
  refsIn(tree).some((r) => {
    if (r.sheet !== undefined) return false;
    const rows = [r.a.row, (r.b ?? r.a).row];
    const cols = [r.a.col, (r.b ?? r.a).col];
    const within = (v: number, p: (number | null)[]) => p[0] === null || p[1] === null || (v >= Math.min(p[0], p[1]) && v <= Math.max(p[0], p[1]));
    return within(at.row, rows) && within(at.col, cols);
  });

const callsAny = (tree: Node, names: ReadonlySet<string>): boolean => {
  let found = false;
  mapNodes(tree, (n) => {
    if (n.t === "call" && names.has(n.name.toUpperCase())) found = true;
    return n;
  });
  return found;
};

/** Whether a value worked out agrees with the one the source showed for the cell. */
const sameValue = (computed: Value, f: PastedFormula): boolean => {
  const c = f.cached;
  if (c === undefined) return true;
  if (isError(computed)) return isError(c) && c.error === computed.error;
  if (isError(c)) return false;
  if (c === null) return computed === null || computed === "" || computed === 0;
  if (typeof c === "number") {
    if (typeof computed !== "number") return false;
    if (Math.abs(computed - c) <= 1e-9 * Math.max(1, Math.abs(c))) return true;
    return !f.exact && formatValue(computed, f.fmt).text === f.shown;
  }
  return computed === c;
};

/**
 * The formulas that can come with a block of pasted cells, by block position (`row:col`, zero-based).
 *
 * Google Sheets writes its formulas relative to the cell (R1C1), so they read the same wherever they are pasted. Excel
 * writes them as they read in its workbook (A1), and doesn't say where the copied cells were: the position is `source`
 * when it is known, and otherwise worked out from the values it shows. Of the positions the formulas' references could
 * mean, the one that makes every formula that points only inside the block give the value Excel showed for it is taken
 * (when several do: the one that moves the references least). A formula that points outside the block, or at nothing that
 * agrees, isn't brought, and the cell keeps the value it showed; neither is one Pli can't work out (an unknown function, a
 * sheet or name it hasn't). `left` counts the formulas that weren't brought.
 */
export function adoptFormulas(list: readonly PastedFormula[], ctx: AdoptContext): { adopted: Map<string, AdoptedFormula>; left: number } {
  const adopted = new Map<string, AdoptedFormula>();
  const key = (f: PastedFormula) => `${f.row}:${f.col}`;
  const at = (f: PastedFormula) => ({ row: ctx.origin.row + f.row, col: ctx.origin.col + f.col });
  let left = 0;
  let calc: Calculator | null = null;
  const sandbox = () => (calc ??= scratch(ctx, list));

  const finish = (f: PastedFormula, formula: string, tree: Node) => {
    let extent: AdoptedFormula["extent"];
    if (f.array !== undefined && f.array !== "") {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(f.array);
      if (m) {
        const num = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        extent = { rows: Number(m[4]) - Number(m[2]) + 1, cols: num(m[3]!) - num(m[1]!) + 1 };
      }
    }
    if (!extent && (f.array !== undefined || callsAny(tree, ARRAYS))) {
      const home = at(f);
      const grid = sandbox().evaluateGrid("s", home.row, home.col, formula);
      if (grid.length > 1 || (grid[0]?.length ?? 0) > 1) extent = { rows: grid.length, cols: grid[0]!.length };
    }
    adopted.set(key(f), { f: formula, ...(extent && (extent.rows > 1 || extent.cols > 1) ? { extent } : {}) });
  };

  // Google Sheets: relative to the cell, so read at the cell.
  const excel: { f: PastedFormula; a1: string; tree: Node }[] = [];
  for (const f of list) {
    const home = at(f);
    if (home.row > MAX_ROWS || home.col > MAX_COLS) continue;
    const { f: a1, array } = plain(f.r1c1 ? r1c1ToA1(f.text, home.row, home.col) : f.text);
    const tree = usable(ctx.workbook, a1);
    const item = array && f.array === undefined ? { ...f, array: "" } : f;
    if (!tree) left++;
    else if (f.r1c1 || refsIn(tree).length === 0) finish(item, a1, tree);
    else excel.push({ f: item, a1, tree });
  }
  if (!excel.length) return { adopted, left };

  // Excel: references as they read in the source workbook.
  const block: Bounds = { r1: ctx.origin.row, c1: ctx.origin.col, r2: ctx.origin.row + ctx.rows - 1, c2: ctx.origin.col + ctx.cols - 1 };
  /** The formula moved by the distance from the source to the target, and whether every cell it reads is in the block. */
  const moved = (t: (typeof excel)[number], dRow: number, dCol: number): { formula: string; tree: Node; inside: boolean } | null => {
    let formula: string;
    try {
      formula = shiftFormula(t.a1, dRow, dCol);
    } catch {
      return null;
    }
    if (formula.includes("#REF!")) return null;
    const tree = parseFormula(formula);
    let inside = true;
    for (const r of refsIn(tree)) {
      const pts = [r.a, ...(r.b ? [r.b] : [])];
      if (r.sheet !== undefined || pts.some((p) => p.row === null || p.col === null || p.row < block.r1 || p.row > block.r2 || p.col < block.c1 || p.col > block.c2)) inside = false;
    }
    return { formula, tree, inside };
  };

  // Excel writes where an array formula fills in its own workbook (`x:fmla-range`): that is a place the cells really were.
  let source = ctx.source;
  if (!source) {
    const hints = new Set<string>();
    for (const t of excel) {
      const m = t.f.array ? /^([A-Z]+)(\d+)(?::[A-Z]+\d+)?$/.exec(t.f.array) : null;
      if (m) hints.add(`${Number(m[2]) - t.f.row}:${[...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - t.f.col}`);
    }
    if (hints.size === 1) {
      const [row, col] = [...hints][0]!.split(":").map(Number) as [number, number];
      if (row >= 1 && col >= 1) source = { row, col };
    }
  }

  let dRow: number;
  let dCol: number;
  if (source) {
    dRow = ctx.origin.row - source.row;
    dCol = ctx.origin.col - source.col;
  } else {
    // Work out where the cells came from. A reference that lands at block position (k, l) puts the source's top left at
    // that reference less (k, l); the formulas' own references give the places to try.
    const candidates: [number, number][] = [[ctx.origin.row, ctx.origin.col]];
    const seen = new Set([`${ctx.origin.row}:${ctx.origin.col}`]);
    // Every formula offers places (not only the first ones: those may point outside the block, which fits nothing).
    for (const t of excel) {
      if (candidates.length >= 20000) break;
      const first = refsIn(t.tree).find((r) => r.sheet === undefined && r.a.row !== null && r.a.col !== null && !r.a.rowAbs && !r.a.colAbs);
      if (!first) continue;
      for (let k = 0; k < ctx.rows; k++)
        for (let l = 0; l < ctx.cols; l++) {
          const sRow = first.a.row! - k;
          const sCol = first.a.col! - l;
          const id = `${sRow}:${sCol}`;
          if (sRow < 1 || sCol < 1 || seen.has(id) || candidates.length >= 20000) continue;
          seen.add(id);
          candidates.push([sRow, sCol]);
        }
    }
    let best: { dRow: number; dCol: number; count: number; distance: number } | null = null;
    /** Every place that fits the values. */
    const fits: { dRow: number; dCol: number; count: number; distance: number }[] = [];
    for (const [sRow, sCol] of candidates) {
      const r = ctx.origin.row - sRow;
      const c = ctx.origin.col - sCol;
      let count = 0;
      let good = true;
      for (const t of excel) {
        const m = moved(t, r, c);
        if (!m || !m.inside || callsAny(m.tree, VOLATILE)) continue;
        const home = at(t.f);
        // A formula that reads its own cell is never what was copied.
        if (readsCell(m.tree, home)) {
          good = false;
          break;
        }
        if (!sameValue(sandbox().evaluateAt("s", home.row, home.col, m.formula), t.f)) {
          good = false;
          break;
        }
        count += t.f.cached === undefined ? 0 : 1;
      }
      if (!good || count === 0) continue;
      const distance = Math.abs(r) + Math.abs(c);
      fits.push({ dRow: r, dCol: c, count, distance });
      if (!best || count > best.count || (count === best.count && distance < best.distance)) best = { dRow: r, dCol: c, count, distance };
    }
    if (!best) return { adopted, left: left + excel.length };
    dRow = best.dRow;
    dCol = best.dCol;
    // Several places gave the same values (formulas that read the same whichever way they are moved): say which was taken.
    const rivals = fits.filter((x) => x.count === best!.count && (x.dRow !== dRow || x.dCol !== dCol));
    if (rivals.length && ctx.note) ctx.note(`The formulas fit more than one place they could have been copied from in Excel; they were read as copied from ${cellAddress(ctx.origin.row - dRow, ctx.origin.col - dCol)}, which moves them least. Edit > Paste special > Formulas from Excel… can say where they were.`);
  }
  for (const t of excel) {
    const m = moved(t, dRow, dCol);
    // With the position known, a formula that points outside the block is still brought when `source` says where it came from.
    if (m && (m.inside || source) && usable(ctx.workbook, m.formula)) finish(t.f, m.formula, m.tree);
    else left++;
  }
  return { adopted, left };
}

/** A workbook of one sheet holding the values the block came with, at the place it lands, to try formulas on. */
function scratch(ctx: AdoptContext, list: readonly PastedFormula[]): Calculator {
  const cells: Record<string, Cell> = {};
  const formulas = new Map(list.map((f) => [`${f.row}:${f.col}`, f]));
  for (let r = 0; r < ctx.rows; r++)
    for (let c = 0; c < ctx.cols; c++) {
      const address = cellAddress(ctx.origin.row + r, ctx.origin.col + c);
      const f = formulas.get(`${r}:${c}`);
      if (f) {
        // The value the source showed for a formula stands in for it.
        if (f.cached !== undefined && f.cached !== null) cells[address] = isError(f.cached) ? { e: f.cached.error } : { v: f.cached };
        continue;
      }
      const cell = ctx.values(r, c);
      if (cell && (cell.v !== undefined || cell.e)) cells[address] = { ...(cell.v !== undefined ? { v: cell.v } : {}), ...(cell.e ? { e: cell.e } : {}) };
    }
  const wb: Workbook = { id: "scratch", type: "workbook", title: "", sheets: [{ id: "s", name: "Sheet1", cells }] };
  return new Calculator(wb);
}

// ---- tables ----

/** A name for a copy of a table that no table or defined name has: `Table1` gives `Table2`, `Sales` gives `Sales2`. */
export function copyTableName(wb: Workbook, from: string, taken: readonly string[] = []): string {
  const used = new Set([...allTables(wb).map((t) => t.table.name.toLowerCase()), ...Object.keys(wb.names ?? {}).map((n) => n.toLowerCase()), ...taken.map((n) => n.toLowerCase())]);
  const base = from.replace(/\d+$/, "") || "Table";
  const start = Number(/(\d+)$/.exec(from)?.[1] ?? 1);
  for (let n = start + 1; ; n++) if (!used.has(`${base}${n}`.toLowerCase())) return `${base}${n}`;
}

/** The formula with references to the table `from` pointing at `to` instead. */
export function renameTableIn(formula: string, from: string, to: string): string {
  let tree: Node;
  try {
    tree = parseFormula(formula);
  } catch {
    return formula;
  }
  let changed = false;
  const next = mapNodes(tree, (n) => {
    if (n.t === "tref" && n.sheet === undefined && n.table !== undefined && n.table.toLowerCase() === from.toLowerCase()) {
      changed = true;
      return { ...n, table: to };
    }
    return n;
  });
  return changed ? printFormula(next) : formula;
}

/** What a copy of a table keeps: everything but its filter and sort (the copy shows all its rows) and its identity. */
export function copiedTable(table: Table, id: string, name: string, range: string): Table {
  const { filters: _f, sort: _s, ...rest } = table;
  return { ...rest, id, name, range };
}
