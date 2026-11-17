import { PliError } from "@pli.dev/core";
import { sharing } from "./ghosts";
import { cellAddress, parseCell, parseRange, rangeAddress, type Bounds } from "./address";
import { cleanCriterion } from "./filter";
import { parseFormula, printFormula, type Node } from "./formula";
import { MAX_COLS, MAX_ROWS, type Cell, type Sheet, type Table, type Workbook } from "./model";
import { mapNodes } from "./refs";
import { overlaps } from "./rule";
import { cleanSortLevel, mapSortColumns, sortLevels } from "./sortlevels";

export type TableRef = Extract<Node, { t: "tref" }>;

export interface TableEntry {
  sheet: Sheet;
  table: Table;
  bounds: Bounds;
}

/** The tables of a workbook with their cells worked out. */
export function allTables(wb: Workbook): TableEntry[] {
  const out: TableEntry[] = [];
  for (const sheet of wb.sheets) for (const table of sheet.tables ?? []) out.push({ sheet, table, bounds: parseRange(table.range)! });
  return out;
}

export function findTable(wb: Workbook, name: string): TableEntry | undefined {
  const lower = name.toLowerCase();
  return allTables(wb).find((t) => t.table.name.toLowerCase() === lower);
}

/** The table that has this cell in it. */
export function tableAt(sheet: Sheet, row: number, col: number): TableEntry | undefined {
  for (const table of sheet.tables ?? []) {
    const bounds = parseRange(table.range)!;
    if (row >= bounds.r1 && row <= bounds.r2 && col >= bounds.c1 && col <= bounds.c2) return { sheet, table, bounds };
  }
  return undefined;
}

/** Whether a table has a header row (it has unless it was made without one). */
export function hasHeader(table: Table): boolean {
  return table.headerRow !== false;
}

/**
 * The column names of a table: the text of its header cells (`ColumnN` where one holds nothing readable). A table with
 * no header row, which has no cells to read them from, keeps them in `columns`: pass the table for it.
 */
export function tableColumns(sheet: Sheet, bounds: Bounds, table?: Table): string[] {
  const out: string[] = [];
  if (table && !hasHeader(table)) {
    for (let c = bounds.c1; c <= bounds.c2; c++) {
      const kept = table.columns?.[c - bounds.c1];
      out.push(kept && !out.some((n) => n.toLowerCase() === kept.toLowerCase()) ? kept : freshColumnName(out, c - bounds.c1 + 1));
    }
    return out;
  }
  for (let c = bounds.c1; c <= bounds.c2; c++) {
    const v = sheet.cells[cellAddress(bounds.r1, c)]?.v;
    out.push(typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : `Column${c - bounds.c1 + 1}`);
  }
  return out;
}

/** The first and last row of a table's data (without the header and totals rows); the first is past the last for an empty table. */
export function dataRows(table: Table, b: Bounds): [number, number] {
  return [hasHeader(table) ? b.r1 + 1 : b.r1, table.totals ? b.r2 - 1 : b.r2];
}

/** The cells a reference to part of a table stands for, or null when they aren't there (an unknown column, no totals row, a row outside the table). */
export function resolveTableRef(ref: TableRef, wb: Workbook, at: { sheet: string; row: number; col: number }): { sheet: string; bounds: Bounds } | null {
  let entry: TableEntry | undefined;
  if (ref.sheet?.startsWith("[")) return null; // a table of another workbook: see external-tables.ts
  if (ref.table !== undefined) entry = findTable(wb, ref.table);
  else {
    const home = wb.sheets.find((s) => s.id === at.sheet);
    entry = home && tableAt(home, at.row, at.col);
  }
  if (!entry) return null;
  const { sheet, table, bounds: b } = entry;
  const names = tableColumns(sheet, b, table).map((n) => n.toLowerCase());
  const index = (name: string | undefined, fallback: number) => (name === undefined ? fallback : names.indexOf(name.toLowerCase()));
  const first = index(ref.from, 0);
  const last = ref.to === undefined ? (ref.from === undefined ? names.length - 1 : first) : index(ref.to, -1);
  if (first < 0 || last < 0) return null;
  const c1 = b.c1 + Math.min(first, last);
  const c2 = b.c1 + Math.max(first, last);
  const [top, bottom] = dataRows(table, b);
  let r1: number;
  let r2: number;
  switch (ref.area) {
    case "data":
      [r1, r2] = [top, bottom];
      break;
    case "all":
      [r1, r2] = [b.r1, b.r2];
      break;
    case "headers":
      if (!hasHeader(table)) return null;
      [r1, r2] = [b.r1, b.r1];
      break;
    case "totals":
      if (!table.totals) return null;
      [r1, r2] = [b.r2, b.r2];
      break;
    case "row":
      if (at.sheet !== sheet.id || at.row < top || at.row > bottom) return null;
      [r1, r2] = [at.row, at.row];
      break;
  }
  // A table with no rows under its header has nothing to refer to in its data.
  if (r2 < r1) return null;
  return { sheet: sheet.id, bounds: { r1, c1, r2, c2 } };
}

const NAME = /^[A-Za-z_\\][A-Za-z0-9_.\\]*$/;

/** Checks a table's name and range against the workbook, throwing a `PliError` that says what is wrong. */
export function checkTable(wb: Workbook, sheet: Sheet, table: Table): void {
  const bad = (m: string): never => {
    throw new PliError("invalid_operation", m);
  };
  if (typeof table.id !== "string" || table.id === "") bad("A table needs an id");
  if (!NAME.test(table.name) || /^[Rr]\d*[Cc]\d*$/.test(table.name) || /^[A-Za-z]{1,3}\d{1,7}$/.test(table.name)) bad(`"${table.name}" can't be used as a table name: use letters, digits, _ and ., starting with a letter`);
  const lower = table.name.toLowerCase();
  // In a shared workbook another person's change can make a name taken, two tables overlap or a header cell something else at the
  // same moment: the table is kept as it is (see `ghosts.ts`).
  const shared = sharing();
  if (!shared && allTables(wb).some((t) => t.table.id !== table.id && t.table.name.toLowerCase() === lower)) bad(`There is already a table called "${table.name}"`);
  if (!shared && Object.keys(wb.names ?? {}).some((n) => n.toLowerCase() === lower)) bad(`"${table.name}" is already a defined name`);
  const b = parseRange(table.range);
  if (!b || typeof table.range !== "string" || rangeAddress(b) !== table.range) bad(`"${String(table.range)}" is not a range such as A1:D10`);
  const r = b!;
  if (r.r2 > MAX_ROWS || r.c2 > MAX_COLS) bad("That range is outside the sheet");
  const headed = hasHeader(table);
  if (r.r2 - r.r1 < (headed ? 1 : 0) + (table.totals ? 1 : 0)) {
    bad(headed ? (table.totals ? "A table with totals needs a header row, a row of data and the totals" : "A table needs a header row and at least one row of data") : table.totals ? "A table with totals needs a row of data and the totals" : "A table needs at least one row of data");
  }
  if (!shared) for (const other of sheet.tables ?? []) if (other.id !== table.id && overlaps(parseRange(other.range)!, r)) bad(`That overlaps the table "${other.name}"`);
  const names = tableColumns(sheet, r, table);
  const seen = new Set<string>();
  if (shared) return;
  names.forEach((n, i) => {
    if (headed) {
      const v = sheet.cells[cellAddress(r.r1, r.c1 + i)]?.v;
      if (typeof v !== "string" || v === "") bad("Every column in a table needs a name in its header cell");
    }
    if (seen.has(n.toLowerCase())) bad(`Two columns are called "${n}"; column names must be different`);
    seen.add(n.toLowerCase());
  });
  for (const [name, values] of Object.entries(table.filters ?? {})) {
    if (!names.includes(name)) bad(`"${name}" isn't a column of the table, so it can't be filtered`);
    try {
      cleanCriterion(values);
    } catch (e) {
      bad(`The filter on "${name}": ${(e as Error).message}`);
    }
  }
  for (const level of sortLevels(table.sort)) {
    if (!names.includes(level.column)) bad(`"${level.column}" isn't a column of the table, so the table can't be sorted by it`);
    try {
      cleanSortLevel(level);
    } catch (e) {
      bad(`The sort by "${level.column}": ${(e as Error).message}`);
    }
  }
  for (const [name, f] of Object.entries(table.calculated ?? {})) {
    if (!names.includes(name)) bad(`"${name}" isn't a column of the table, so it can't be a calculated column`);
    try {
      parseFormula(f);
    } catch {
      bad(`The formula of the calculated column "${name}" can't be read`);
    }
  }
}

/** The name for a new header cell: `Column3`, or the next free one if that is taken. */
export function freshColumnName(taken: readonly string[], n: number): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  let name = `Column${n}`;
  for (let k = n; used.has(name.toLowerCase()); k++) name = `Column${k + 1}`;
  return name;
}

// ---- rewriting formulas when a table changes ----

/**
 * Rewrites the structured references in every formula of the workbook (cells and defined names). `fn` gets each one with
 * the table it refers to (the table the cell sits in when the reference doesn't say) and returns what it becomes.
 */
function mapTableRefs(wb: Workbook, fn: (node: TableRef | { t: "name"; name: string }, table: string | undefined, at: { sheet: Sheet; row: number; col: number } | null) => Node): Workbook {
  const rewrite = (f: string, at: { sheet: Sheet; row: number; col: number } | null): string => {
    let tree: Node;
    try {
      tree = parseFormula(f);
    } catch {
      return f;
    }
    let changed = false;
    const next = mapNodes(tree, (n) => {
      if (n.t !== "tref" && n.t !== "name") return n;
      if (n.t === "tref" && n.sheet?.startsWith("[")) return n; // a table of another workbook is not one of this workbook's
      const table = n.t === "name" ? n.name : n.table ?? (at ? tableAt(at.sheet, at.row, at.col)?.table.name : undefined);
      const out = fn(n, table, at);
      if (out !== n) changed = true;
      return out;
    });
    return changed ? printFormula(next) : f;
  };
  let any = false;
  const sheets = wb.sheets.map((sheet) => {
    let cells: Record<string, Cell> | undefined;
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.f === undefined) continue;
      const pos = parseCell(address)!;
      const f = rewrite(cell.f, { sheet, row: pos.row, col: pos.col });
      if (f !== cell.f) (cells ??= { ...sheet.cells })[address] = { ...cell, f };
    }
    // The formulas of calculated columns are read from the first row of data.
    let tables: Table[] | undefined;
    sheet.tables?.forEach((table, i) => {
      if (!table.calculated) return;
      const b = parseRange(table.range)!;
      const names = tableColumns(sheet, b, table);
      let moved: Record<string, string> | undefined;
      for (const [name, f] of Object.entries(table.calculated)) {
        const g = rewrite(f, { sheet, row: dataRows(table, b)[0], col: b.c1 + Math.max(0, names.indexOf(name)) });
        if (g !== f) (moved ??= { ...table.calculated })[name] = g;
      }
      if (moved) (tables ??= sheet.tables!.slice())[i] = { ...table, calculated: moved };
    });
    if (!cells && !tables) return sheet;
    any = true;
    return { ...sheet, ...(cells ? { cells } : {}), ...(tables ? { tables } : {}) };
  });
  let names = wb.names;
  if (names) {
    let next: Record<string, string> | undefined;
    for (const [name, f] of Object.entries(names)) {
      const g = rewrite(f, null);
      if (g !== f) (next ??= { ...names })[name] = g;
    }
    if (next) {
      names = next;
      any = true;
    }
  }
  return any ? { ...wb, sheets, ...(names ? { names } : {}) } : wb;
}

const same = (a: string | undefined, b: string) => a !== undefined && a.toLowerCase() === b.toLowerCase();

/** The workbook with a column of a table called something else in every formula that names it (and as a calculated column). */
export function renameColumnInFormulas(wb: Workbook, table: string, from: string, to: string): Workbook {
  const renamed = mapTableRefs(wb, (n, t) => {
    if (n.t !== "tref" || !same(t, table)) return n;
    const swap = (c: string | undefined) => (c !== undefined && same(c, from) ? to : c);
    const out = { ...n };
    const f = swap(n.from);
    const e = swap(n.to);
    if (f !== n.from && f !== undefined) out.from = f;
    if (e !== n.to && e !== undefined) out.to = e;
    return f === n.from && e === n.to ? n : out;
  });
  // What is kept about a column by its name follows it: its calculated formula, its filter, the sort, a slicer on it.
  const swap = (c: string) => (same(c, from) ? to : c);
  const rekey = <T,>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [swap(k), v]));
  let changed = false;
  const ids = new Set<string>();
  const sheets = renamed.sheets.map((sheet) => {
    const tables = sheet.tables?.map((t) => {
      if (!same(t.name, table)) return t;
      ids.add(t.id);
      const next: Table = { ...t };
      if (t.calculated && from in t.calculated) next.calculated = rekey(t.calculated);
      if (t.filters && from in t.filters) next.filters = rekey(t.filters);
      if (t.sort && sortLevels(t.sort).some((l) => same(l.column, from))) next.sort = mapSortColumns(t.sort, swap)!;
      if (t.columns?.some((c) => same(c, from))) next.columns = t.columns.map(swap);
      if (next.calculated === t.calculated && next.filters === t.filters && next.sort === t.sort && next.columns === t.columns) return t;
      changed = true;
      return next;
    });
    return tables ? { ...sheet, tables } : sheet;
  });
  const result = changed ? { ...renamed, sheets } : renamed;
  if (!ids.size) return result;
  let slicerChanged = false;
  const withSlicers = result.sheets.map((sheet) => {
    if (!sheet.slicers?.some((x) => ids.has(x.table) && same(x.column, from))) return sheet;
    slicerChanged = true;
    return { ...sheet, slicers: sheet.slicers.map((x) => (ids.has(x.table) && same(x.column, from) ? { ...x, column: to } : x)) };
  });
  let timelineChanged = false;
  const withTimelines = withSlicers.map((sheet) => {
    if (!sheet.timelines?.some((x) => ids.has(x.table) && same(x.column, from))) return sheet;
    timelineChanged = true;
    return { ...sheet, timelines: sheet.timelines.map((x) => (ids.has(x.table) && same(x.column, from) ? { ...x, column: to } : x)) };
  });
  return slicerChanged || timelineChanged ? { ...result, sheets: withTimelines } : result;
}

/** The workbook with a table called something else in every formula that names it. */
export function renameTableInFormulas(wb: Workbook, from: string, to: string): Workbook {
  return mapTableRefs(wb, (n) => {
    if (n.t === "name") return same(n.name, from) ? { ...n, name: to } : n;
    return n.table !== undefined && same(n.table, from) ? { ...n, table: to } : n;
  });
}

/** The workbook with references to a table turned into plain ranges (for when it stops being a table). */
export function tableRefsToRanges(wb: Workbook, table: string): Workbook {
  return mapTableRefs(wb, (n, t, at) => {
    if (!same(t, table)) return n;
    const ref: TableRef = n.t === "name" ? { t: "tref", table: n.name, area: "data" } : n;
    const hit = resolveTableRef(ref, wb, { sheet: at?.sheet.id ?? "", row: at?.row ?? 0, col: at?.col ?? 0 });
    if (!hit) return { t: "err", v: "#REF!" };
    const home = at?.sheet.id;
    const target = wb.sheets.find((s) => s.id === hit.sheet)!;
    const b = hit.bounds;
    const rowAbs = ref.area !== "row";
    const a = { row: b.r1, col: b.c1, rowAbs, colAbs: true };
    const z = { row: b.r2, col: b.c2, rowAbs, colAbs: true };
    const single = b.r1 === b.r2 && b.c1 === b.c2;
    return { t: "ref", ...(hit.sheet !== home ? { sheet: target.name } : {}), a, ...(single ? {} : { b: z }) };
  });
}
