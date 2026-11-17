import { PliError } from "@pli.dev/core";
import { cellAddress, colName, colNumber, parseRange, rangeAddress, type Bounds } from "./address";
import { MAX_LEVEL, showLevelOps, summaryBefore } from "./outline";
import { MAX_COLS, MAX_ROWS, type Cell, type PageSetup, type PivotFunction, type Sheet, type Workbook } from "./model";
import { sheetReducer, type SheetOp } from "./ops";
import { mergedRanges, overlaps } from "./rule";

/*
 * The Subtotal command (Excel's Data > Subtotal): in a list sorted by one column, a row of `SUBTOTAL` formulas is put under
 * (or over) every run of equal values in that column, and one for the whole list. The rows are ordinary rows with formulas,
 * so the file keeps them as such; each run is a group (an outline level) that folds away under its subtotal. Running it again
 * without replacing the subtotals puts subtotals inside the groups of the last run, which is how nested subtotals are made.
 */

/** What a subtotal can do: the summaries of a pivot table's values. */
export type SubtotalFunction = Exclude<PivotFunction, "distinctCount">;
export const SUBTOTAL_FUNCTIONS: readonly SubtotalFunction[] = ["sum", "count", "countNums", "average", "max", "min", "product", "stdDev", "stdDevp", "var", "varp"];
/** The first argument of `SUBTOTAL` for each (Excel's numbering). */
export const SUBTOTAL_CODES: Record<SubtotalFunction, number> = { average: 1, countNums: 2, count: 3, max: 4, min: 5, product: 6, stdDev: 7, stdDevp: 8, sum: 9, var: 10, varp: 11 };
/** What Excel adds to the group's name in a subtotal row ("North Total", "North Average") and to "Grand" in the last. */
export const SUBTOTAL_LABELS: Record<SubtotalFunction, string> = { sum: "Total", count: "Count", countNums: "Count", average: "Average", max: "Max", min: "Min", product: "Product", stdDev: "StdDev", stdDevp: "StdDevp", var: "Var", varp: "Varp" };

export interface SubtotalOptions {
  /** The column whose changes start a new group, by letter (`"B"`) or by the text of its heading. */
  by: string;
  /** What to work out (the sum by default). */
  fn?: SubtotalFunction;
  /** The columns to work it out for, by letter or heading. */
  columns: readonly string[];
  /** Take the subtotals that are there out first (the default). `false` adds a level inside the groups that are there. */
  replace?: boolean;
  /** Start every group on a new printed page. */
  pageBreaks?: boolean;
  /** The subtotal under its group (the default); `false` puts it above. This is a setting of the sheet's outline, so it applies to the groups already on the sheet too. */
  summaryBelow?: boolean;
  /** A subtotal of the whole list (the default). */
  grandTotal?: boolean;
  /**
   * Excel can't subtotal a table (its Subtotal button is greyed out over one); turn it into a range first. With this set the
   * command does that for you, in the same undo step: the table becomes a plain range (a totals row stays under the list,
   * outside the subtotals) and the list is subtotalled. Without it a list over a table is refused.
   */
  convertTable?: boolean;
  /** Sort the list by the `by` column first (`true` is ascending), so that equal values are together; one undo step with the subtotals. */
  sort?: boolean | "ascending" | "descending";
}

export interface SubtotalResult {
  /** How many groups got a subtotal row. */
  groups: number;
  /** How many rows were put in (the grand total included) and how many taken out. */
  added: number;
  removed: number;
  /** The list now, as a range. */
  range: string;
}

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

const NESTED = /(^|[^A-Za-z0-9_.])SUBTOTAL\s*\(/i;
const FIRST = /SUBTOTAL\(\s*\d+\s*,\s*\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/i;

interface Subtotals {
  /** The rows that hold subtotals, and the one of them that sums up the whole list (if any). */
  rows: number[];
  grand?: number;
}

/** The rows of a list that hold `SUBTOTAL` formulas (its first row is the heading and is never one). */
export function findSubtotals(sheet: Sheet, b: Bounds): Subtotals {
  const rows: number[] = [];
  let grand: number | undefined;
  for (let r = b.r1 + 1; r <= b.r2; r++) {
    let hit: string | undefined;
    for (let c = b.c1; c <= b.c2 && !hit; c++) {
      const f = sheet.cells[cellAddress(r, c)]?.f;
      if (f !== undefined && NESTED.test(f)) hit = f;
    }
    if (!hit) continue;
    rows.push(r);
    const m = FIRST.exec(hit);
    if (!m) continue;
    const from = Number(m[2]);
    const to = m[4] ? Number(m[4]) : from;
    if ((r === b.r2 && from <= b.r1 + 1 && to >= b.r2 - 1) || (r === b.r1 + 1 && to >= b.r2 && from <= b.r1 + 2)) grand = r;
  }
  return { rows, ...(grand !== undefined ? { grand } : {}) };
}

/** A column named by letter or by its heading, as a column number inside `b`. */
export function subtotalColumn(b: Bounds, name: string, heading: (col: number) => string): number {
  const wanted = String(name).trim();
  if (!wanted) return bad("Name a column");
  for (let c = b.c1; c <= b.c2; c++) if (heading(c).trim().toLowerCase() === wanted.toLowerCase() && heading(c).trim() !== "") return c;
  const n = colNumber(wanted);
  if (n >= b.c1 && n <= b.c2) return n;
  if (n) return bad(`Column ${wanted.toUpperCase()} is outside the list (${colName(b.c1)} to ${colName(b.c2)})`);
  return bad(`The list has no column "${wanted}"`);
}

/** The tables that have cells in the list (Excel greys the Subtotal button out over one). */
export function listTables(sheet: Sheet, b: Bounds): { name: string; bounds: Bounds; totals: boolean }[] {
  const out: { name: string; bounds: Bounds; totals: boolean }[] = [];
  for (const t of sheet.tables ?? []) {
    const tb = parseRange(t.range);
    if (tb && overlaps(tb, b)) out.push({ name: t.name, bounds: tb, totals: !!t.totals });
  }
  return out;
}

/** The pivot tables that have cells in the list (Excel greys the Subtotal button out over one). */
export function listPivots(sheet: Sheet, b: Bounds): string[] {
  return (sheet.pivots ?? []).filter((p) => {
    const pb = parseRange(p.range);
    return !!pb && overlaps(pb, b);
  }).map((p) => p.name);
}

/** The rule every command shares: what a list can't be for subtotals. */
export function checkList(sheet: Sheet, b: Bounds): void {
  if (b.r2 - b.r1 < 1) bad("A list to subtotal has a heading row and at least one row under it");
  const tables = listTables(sheet, b);
  if (tables.length) bad(`${tables.length === 1 ? `"${tables[0]!.name}" is a table, and a table` : "Tables"} can't be subtotalled; turn ${tables.length === 1 ? "it" : "them"} into a range first (or ask the command to convert it)`);
  const pivots = listPivots(sheet, b);
  if (pivots.length) bad(`A pivot table can't be subtotalled (${pivots[0]} is in the way); a pivot table has subtotals of its own`);
}

/**
 * Rows go into the sheet whole, so nothing that spans several rows may be cut by one: a merged cell, a pivot table, or another table
 * beside the list. `cuts` are the places rows go in (before this row of the sheet as it is now) and `gone` the rows taken out.
 */
function checkNotCut(sheet: Sheet, b: Bounds, cuts: readonly number[], gone: Iterable<number>): void {
  const dead = [...gone];
  const hit = (r1: number, r2: number) => cuts.some((q) => r1 < q && q <= r2) || dead.some((x) => r1 <= x && x <= r2);
  for (const m of mergedRanges(sheet)) {
    if (m.r2 > m.r1 && hit(m.r1, m.r2)) bad(`The merged cells ${rangeAddress(m)} run across a place where a subtotal goes; unmerge them first`);
  }
  for (const p of sheet.pivots ?? []) {
    const pb = parseRange(p.range);
    if (pb && !overlaps(pb, b) && hit(pb.r1, pb.r2)) bad(`The pivot table ${p.name} lies across rows where subtotals go (rows go into the sheet whole); move it clear of the list first`);
  }
  for (const t of sheet.tables ?? []) {
    const tb = parseRange(t.range);
    if (tb && !overlaps(tb, b) && hit(tb.r1, tb.r2)) bad(`The table ${t.name} lies across rows where subtotals go (rows go into the sheet whole); move it clear of the list first`);
  }
}

interface Item {
  kind: "row" | "sub" | "grand";
  /** The row it was at before (for a row that was already there). */
  orig?: number;
  /** For a subtotal row: the items of the group it sums up, its label, and the level the group's rows had before. */
  from?: number;
  to?: number;
  label?: string;
  base?: number;
}

/** A page's row breaks without the ones at subtotal rows (after one, or just before one when the summaries are above). */
const withoutBreaks = (page: PageSetup | undefined, gone: ReadonlySet<number>, header: number): PageSetup | undefined => {
  const drop = (r: number) => gone.has(r) || (r > header && gone.has(r + 1));
  const list = page?.rowBreaks;
  if (!list?.some(drop)) return undefined;
  const next: PageSetup = { ...page };
  const kept = list.filter((r) => !drop(r));
  if (kept.length) next.rowBreaks = kept;
  else delete next.rowBreaks;
  return next;
};

const setPage = (sheet: string, page: PageSetup): SheetOp => ({ type: "set_page", sheet, page: Object.keys(page).length ? page : null });

/** Joins neighbouring `set_size` operations of one axis into one `set_sizes`, so that thousands of group levels are one pass over the sheet. */
function coalesceSizes(ops: readonly SheetOp[]): SheetOp[] {
  const out: SheetOp[] = [];
  for (const op of ops) {
    if (op.type !== "set_size") {
      out.push(op);
      continue;
    }
    const { type: _t, sheet, axis, ...change } = op;
    const last = out[out.length - 1];
    if (last?.type === "set_sizes" && last.sheet === sheet && last.axis === axis) last.sizes.push(change);
    else out.push({ type: "set_sizes", sheet, axis, sizes: [change] });
  }
  return out;
}

/** Collects operations, and works out where they leave the workbook only when asked (a long list is applied by the session, in one transaction). */
class Plan {
  ops: SheetOp[] = [];
  #state: Workbook;
  #done = 0;
  constructor(wb: Workbook, readonly sheetId: string) {
    this.#state = wb;
  }
  apply(op: SheetOp): void {
    this.ops.push(op);
  }
  /** The sheet as the operations so far leave it. */
  get sheet(): Sheet {
    for (; this.#done < this.ops.length; this.#done++) this.#state = sheetReducer.apply(this.#state, this.ops[this.#done]!).state;
    return this.#state.sheets.find((s) => s.id === this.sheetId)!;
  }
  /** Takes rows out, all in one operation (every run is in the rows as they are now). */
  deleteRows(rows: Iterable<number>): void {
    const list = [...rows].sort((x, y) => x - y);
    const runs: [number, number][] = [];
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j + 1 < list.length && list[j + 1] === list[j]! + 1) j++;
      runs.push([list[i]!, j - i + 1]);
      i = j + 1;
    }
    if (runs.length) this.apply({ type: "delete_row_runs", sheet: this.sheetId, runs });
  }
}

/**
 * Subtotals the list `b` (its first row holds the headings) and says what to do to the workbook, as operations that can be undone
 * together. `text` is what a cell shows, which names the groups and tells where one ends.
 */
export function subtotalOps(wb: Workbook, sheet: Sheet, b: Bounds, opts: SubtotalOptions, text: (row: number, col: number) => string): { ops: SheetOp[]; result: SubtotalResult } {
  checkList(sheet, b);
  const heading = (c: number) => text(b.r1, c);
  const by = subtotalColumn(b, opts.by, heading);
  const fn = opts.fn ?? "sum";
  if (!SUBTOTAL_FUNCTIONS.includes(fn)) bad(`A subtotal is one of ${SUBTOTAL_FUNCTIONS.join(", ")}`);
  if (!opts.columns?.length) bad("Pick at least one column to add subtotals to");
  const columns = [...new Set(opts.columns.map((n) => subtotalColumn(b, n, heading)))].sort((x, y) => x - y);
  const replace = opts.replace !== false;
  const existing = findSubtotals(sheet, b);
  const old = new Set(existing.rows);
  // Subtotals that stay set which way the summaries face.
  const below = old.size && !replace ? !summaryBefore(sheet, "row") : opts.summaryBelow !== false;
  const levelOf = (r: number) => sheet.rows?.[String(r)]?.level ?? 0;
  // A merged cell down the `by` column names every row it covers (only its first cell holds the text).
  const mergedTop = new Map<number, number>();
  for (const m of mergedRanges(sheet)) {
    if (m.r2 <= m.r1 || !overlaps(m, b)) continue;
    if (m.r1 <= b.r1 || m.r2 > b.r2) bad(`The merged cells ${rangeAddress(m)} run past the edge of the list; unmerge them first`);
    if (by >= m.c1 && by <= m.c2) for (let r = m.r1; r <= m.r2; r++) mergedTop.set(r, m.r1);
  }
  const key = (r: number) => text(mergedTop.get(r) ?? r, by);

  // The list as it will be: the heading, then the rows that stay with a subtotal row for every run of equal values in `by`.
  const items: Item[] = [{ kind: "row", orig: b.r1 }];
  const wantGrand = opts.grandTotal !== false && (replace || existing.grand === undefined);
  if (wantGrand && !below) items.push({ kind: "grand" });
  const groupEnds: number[] = [];
  let groups = 0;
  const pushBlock = (rows: number[]) => {
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j + 1 < rows.length && key(rows[j + 1]!) === key(rows[i]!)) j++;
      const base = replace ? 0 : Math.min(...rows.slice(i, j + 1).map(levelOf));
      if (base + 1 > MAX_LEVEL) bad(`Groups can be ${MAX_LEVEL} deep`);
      const name = key(rows[i]!);
      const sub: Item = { kind: "sub", label: `${name === "" ? "(blank)" : name} ${SUBTOTAL_LABELS[fn]}`, base };
      if (!below) items.push(sub);
      sub.from = items.length;
      for (let k = i; k <= j; k++) items.push({ kind: "row", orig: rows[k]! });
      sub.to = items.length - 1;
      if (below) items.push(sub);
      groupEnds.push(items.length - 1);
      groups++;
      i = j + 1;
    }
  };
  for (let r = b.r1 + 1; r <= b.r2; ) {
    if (old.has(r) && !replace) {
      items.push({ kind: "row", orig: r });
      r++;
      continue;
    }
    // A run of rows with no subtotal that stays in it. With the old subtotals going, it carries on across them.
    const block: number[] = [];
    for (; r <= b.r2 && !(old.has(r) && !replace); r++) if (!old.has(r) || !replace) block.push(r);
    pushBlock(block);
  }
  if (!groups) bad("There is nothing in the list to subtotal");
  if (wantGrand && below) items.push({ kind: "grand" });

  // Rows go in whole: where they go in (and where old subtotals come out) nothing may be cut through.
  const cuts: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.kind === "row") continue;
    let j = i;
    while (j + 1 < items.length && items[j + 1]!.kind !== "row") j++;
    cuts.push(items[j + 1]?.orig ?? b.r2 + 1);
    i = j;
  }
  checkNotCut(sheet, b, cuts, replace ? old : []);

  // ---- the operations ----
  const plan = new Plan(wb, sheet.id);
  // Where the summaries sit is a setting of the whole sheet's outline; changing it opens the groups there are, first.
  if (summaryBefore(sheet, "row") === below) {
    for (const op of showLevelOps(sheet, "row", MAX_LEVEL + 1)) plan.apply(op);
    plan.apply({ type: "set_outline", sheet: sheet.id, summaryAbove: !below });
  }
  if (replace && old.size) {
    const page = withoutBreaks(sheet.page, old, b.r1);
    if (page) plan.apply(setPage(sheet.id, page));
    plan.deleteRows(old);
  }
  // Every row goes in at once: the places are given as the rows are before any goes in (the rows of the list that stay come first, in order).
  const at = (i: number) => b.r1 + i;
  const runs: [number, number][] = [];
  for (let i = 0, kept = 0; i < items.length; ) {
    if (items[i]!.kind === "row") {
      kept++;
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < items.length && items[j + 1]!.kind !== "row") j++;
    runs.push([b.r1 + kept, j - i + 1]);
    i = j + 1;
  }
  if (runs.length) plan.apply({ type: "insert_row_runs", sheet: sheet.id, runs });

  // What the new rows hold: bold, with the label in the `by` column and a SUBTOTAL under (or over) each column asked for.
  const cells: Record<string, Cell | null> = {};
  const code = SUBTOTAL_CODES[fn];
  const fillRow = (row: number, label: string, from: number, to: number) => {
    for (let c = b.c1; c <= b.c2; c++) {
      const cell: Cell = { s: { bold: true } };
      if (columns.includes(c)) {
        cell.f = `SUBTOTAL(${code},${cellAddress(from, c)}:${cellAddress(to, c)})`;
        // A sum, an average and the like look like the numbers they come from.
        const fmt = sheet.cells[cellAddress(b.r1 + 1, c)]?.fmt;
        if (fmt && ["sum", "average", "max", "min", "product"].includes(fn)) cell.fmt = fmt;
      } else if (c === by) cell.v = label;
      cells[cellAddress(row, c)] = cell;
    }
  };
  items.forEach((it, i) => {
    if (it.kind === "sub") fillRow(at(i), it.label!, at(it.from!), at(it.to!));
    else if (it.kind === "grand") fillRow(at(i), `Grand ${SUBTOTAL_LABELS[fn]}`, below ? at(1) : at(2), below ? at(items.length - 2) : at(items.length - 1));
  });
  plan.apply({ type: "set_cells", sheet: sheet.id, cells });

  // Levels: a group's rows are one level deeper than they were, and its subtotal row is where they were.
  // (Read from the sheet as it was, row by row; putting the rows in has moved them, but not changed them.)
  const dimsOf = (finalRow: number) => {
    const it = items[finalRow - b.r1];
    return it?.kind === "row" && it.orig !== undefined ? sheet.rows?.[String(it.orig)] : undefined;
  };
  const levels = new Map<number, number>();
  for (const it of items) {
    if (it.kind !== "sub") continue;
    for (let k = it.from!; k <= it.to!; k++) levels.set(at(k), it.base! + 1);
  }
  items.forEach((it, i) => {
    if (it.kind === "sub") levels.set(at(i), it.base!);
  });
  for (const [row, level] of levels) {
    const d = dimsOf(row);
    const wasGrouped = replace && (d?.level !== undefined || d?.collapsed);
    if ((d?.level ?? 0) === level && !wasGrouped) continue;
    plan.apply({ type: "set_size", sheet: sheet.id, axis: "row", index: row, level: level || null, ...(wasGrouped ? { collapsed: null, hidden: null } : {}) });
  }
  // A subtotal row inside a group that is folded away is folded away with it.
  items.forEach((it, i) => {
    if (it.kind === "sub" && !replace && dimsOf(at(it.from!))?.hidden) plan.apply({ type: "set_size", sheet: sheet.id, axis: "row", index: at(i), hidden: true });
  });

  // A page for every group.
  if (opts.pageBreaks) {
    const page = plan.sheet.page;
    const next: PageSetup = { ...page, rowBreaks: [...new Set([...(page?.rowBreaks ?? []), ...groupEnds.slice(0, -1).map(at)])].sort((x, y) => x - y) };
    plan.apply(setPage(sheet.id, next));
  }

  const added = items.filter((i) => i.kind !== "row").length;
  const last = Math.min(MAX_ROWS, b.r2 - (replace ? old.size : 0) + added);
  return { ops: coalesceSizes(plan.ops), result: { groups, added, removed: replace ? old.size : 0, range: rangeAddress({ r1: b.r1, c1: b.c1, r2: last, c2: Math.min(MAX_COLS, b.c2) }) } };
}

/** Takes every subtotal out of a list: the rows go, and so does the outline of the rows that were in groups. */
export function removeSubtotalOps(wb: Workbook, sheet: Sheet, b: Bounds): { ops: SheetOp[]; removed: number } {
  checkList(sheet, b);
  const found = findSubtotals(sheet, b);
  if (!found.rows.length) return { ops: [], removed: 0 };
  const plan = new Plan(wb, sheet.id);
  const gone = new Set(found.rows);
  checkNotCut(sheet, b, [], gone);
  const page = withoutBreaks(sheet.page, gone, b.r1);
  if (page) plan.apply(setPage(sheet.id, page));
  plan.deleteRows(gone);
  const dims = plan.sheet.rows ?? {};
  for (let r = b.r1 + 1; r <= b.r2 - gone.size; r++) {
    const d = dims[String(r)];
    if (d?.level || d?.collapsed) plan.apply({ type: "set_size", sheet: sheet.id, axis: "row", index: r, level: null, collapsed: null, hidden: null });
  }
  return { ops: coalesceSizes(plan.ops), removed: gone.size };
}
