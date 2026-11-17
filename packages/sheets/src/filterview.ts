import { PliError } from "@pli.dev/core";
import { colName, colNumber, parseRange, rangeAddress } from "./address";
import { cleanCriterion } from "./filter";
import type { FilterCriterion, FilterView, FilterViewTable, Workbook } from "./model";
import { tableColumns } from "./table";

/*
 * Filter views: named, saved sets of filter (and sort) state for a sheet. A person can switch between them to look at the
 * same data in different ways; applying one in the grid hides rows for that viewer only (see `SheetSession.filterViewRows`),
 * and "Apply for everyone" makes it the sheet's own filter.
 */

export const MAX_FILTER_VIEWS = 100;
export const MAX_VIEW_NAME = 80;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A view's name, trimmed, or an error that says what is wrong with it. */
export function cleanViewName(name: unknown): string {
  if (typeof name !== "string") return bad("A view needs a name");
  const trimmed = name.trim();
  if (!trimmed) return bad("A view needs a name");
  if (trimmed.length > MAX_VIEW_NAME) return bad(`A view's name is at most ${MAX_VIEW_NAME} characters`);
  return trimmed;
}

export const MAX_VIEW_TABLES = 200;

/** What a view holds for one table, made ready to keep. */
function cleanViewTable(id: string, t: FilterViewTable): FilterViewTable {
  if (!t || typeof t !== "object" || Array.isArray(t)) return bad(`The view's entry for table ${id} is an object`);
  for (const k of Object.keys(t)) if (k !== "filters" && k !== "sort") bad(`The view's entry for table ${id} has an unknown "${k}"`);
  const out: FilterViewTable = {};
  if (t.filters !== undefined) {
    if (!t.filters || typeof t.filters !== "object" || Array.isArray(t.filters)) bad(`The filters of table ${id} in a view are an object`);
    const filters: Record<string, FilterCriterion> = {};
    for (const [name, c] of Object.entries(t.filters)) {
      if (!name) bad("A table filter in a view needs a column name");
      filters[name] = cleanCriterion(c);
    }
    if (Object.keys(filters).length) out.filters = filters;
  }
  if (t.sort !== undefined) {
    if (!t.sort || typeof t.sort.column !== "string" || !t.sort.column) bad(`The sort of table ${id} in a view needs a column name`);
    out.sort = { column: t.sort.column, ...(t.sort.descending ? { descending: true as const } : {}) };
  }
  return out;
}

/** One view made ready to keep: its range, the criteria of its columns (inside the range), its sort and what it makes of the tables. */
export function cleanFilterView(view: FilterView): FilterView {
  if (!view || typeof view !== "object") return bad("A view is an object with an id, a name and a range");
  if (typeof view.id !== "string" || !view.id) bad("A view needs an id");
  const out: FilterView = { id: view.id, name: cleanViewName(view.name) };
  let r: ReturnType<typeof parseRange> = null;
  if (view.range !== undefined) {
    r = typeof view.range === "string" ? parseRange(view.range) : null;
    if (!r || r.r1 === r.r2 || rangeAddress(r) !== view.range) return bad("A view's range has at least two rows, such as A1:E20");
    out.range = view.range;
  } else if (view.columns !== undefined || view.sort !== undefined) bad("A view with columns or a sort needs a range");
  if (view.columns !== undefined && r) {
    const columns: Record<string, FilterCriterion> = {};
    for (const [k, v] of Object.entries(view.columns)) {
      const c = colNumber(k);
      if (!c || k !== k.toUpperCase() || c < r.c1 || c > r.c2) bad(`Column ${k} is outside the view's range`);
      columns[k] = cleanCriterion(v);
    }
    if (Object.keys(columns).length) out.columns = columns;
  }
  if (view.sort !== undefined && r) {
    const c = colNumber(view.sort.column);
    if (!c || view.sort.column !== view.sort.column.toUpperCase() || c < r.c1 || c > r.c2) bad("A view sorts by a column inside its range");
    out.sort = { column: view.sort.column, ...(view.sort.descending ? { descending: true as const } : {}) };
  }
  if (view.tables !== undefined) {
    if (!view.tables || typeof view.tables !== "object" || Array.isArray(view.tables)) return bad("A view's tables are an object");
    const ids = Object.keys(view.tables);
    if (ids.length > MAX_VIEW_TABLES) bad(`A view holds at most ${MAX_VIEW_TABLES} tables`);
    const tables: Record<string, FilterViewTable> = {};
    for (const id of ids) {
      const t = cleanViewTable(id, view.tables[id]!);
      if (t.filters || t.sort) tables[id] = t;
    }
    out.tables = tables;
  }
  return out;
}

/** A list of views made ready to keep: each checked, ids and names (without regard to capitals) unique. */
export function cleanFilterViews(views: readonly FilterView[]): FilterView[] {
  if (!Array.isArray(views)) return bad("Views are a list");
  if (views.length > MAX_FILTER_VIEWS) bad(`A sheet has at most ${MAX_FILTER_VIEWS} views`);
  const ids = new Set<string>();
  const names = new Set<string>();
  return views.map((v) => {
    const clean = cleanFilterView(v);
    if (ids.has(clean.id)) bad(`Two views share the id ${clean.id}`);
    if (names.has(clean.name.toLowerCase())) bad(`There is already a view called ${clean.name}`);
    ids.add(clean.id);
    names.add(clean.name.toLowerCase());
    return clean;
  });
}

/**
 * The views after rows or columns are inserted or deleted: each follows its range (`moveRange` gives the new range, or null
 * when it is gone) and its columns (`moveCol` gives the new column number, or null). A view whose range is gone, or has
 * shrunk below two rows, is dropped; criteria on columns that are gone are forgotten.
 */
export function moveFilterViews(views: readonly FilterView[], moveRange: (range: string) => string | null, moveCol: (n: number) => number | null): FilterView[] {
  const out: FilterView[] = [];
  for (const v of views) {
    const next: FilterView = { id: v.id, name: v.name };
    if (v.tables) next.tables = v.tables;
    if (v.range !== undefined) {
      const range = moveRange(v.range);
      const r = range ? parseRange(range) : null;
      // A view whose own filter is gone or has shrunk below two rows keeps only what it says about tables, if anything.
      if (r && r.r1 !== r.r2) {
        next.range = rangeAddress(r);
        const columns: Record<string, FilterCriterion> = {};
        for (const [k, c] of Object.entries(v.columns ?? {})) {
          const n = moveCol(colNumber(k));
          if (n !== null && n >= r.c1 && n <= r.c2) columns[colName(n)] = c;
        }
        if (Object.keys(columns).length) next.columns = columns;
        if (v.sort) {
          const n = moveCol(colNumber(v.sort.column));
          if (n !== null && n >= r.c1 && n <= r.c2) next.sort = { column: colName(n), ...(v.sort.descending ? { descending: true as const } : {}) };
        }
      }
    }
    // A view that held something and has lost all of it goes; one that held nothing (it shows everything) stays.
    const held = v.range !== undefined || (v.tables && Object.keys(v.tables).length);
    if (held && next.range === undefined && !(next.tables && Object.keys(next.tables).length)) continue;
    out.push(next);
  }
  return out;
}

/**
 * The workbook with what views hold for tables that are gone, or for columns a table no longer has, taken out; a view that
 * ends up holding nothing at all goes too.
 */
export function pruneViewTables(wb: Workbook): Workbook {
  if (!wb.sheets.some((s) => s.filterViews?.some((v) => v.tables))) return wb;
  let changed = false;
  const sheets = wb.sheets.map((sheet) => {
    if (!sheet.filterViews?.some((v) => v.tables)) return sheet;
    const names = new Map((sheet.tables ?? []).map((t) => [t.id, tableColumns(sheet, parseRange(t.range)!, t)] as const));
    const views: FilterView[] = [];
    for (const v of sheet.filterViews) {
      if (!v.tables) {
        views.push(v);
        continue;
      }
      const tables: Record<string, FilterViewTable> = {};
      for (const [id, t] of Object.entries(v.tables)) {
        const cols = names.get(id);
        if (!cols) continue;
        const kept: FilterViewTable = {};
        const filters = Object.fromEntries(Object.entries(t.filters ?? {}).filter(([n]) => cols.includes(n)));
        if (Object.keys(filters).length) kept.filters = filters;
        if (t.sort && cols.includes(t.sort.column)) kept.sort = t.sort;
        if (kept.filters || kept.sort) tables[id] = kept;
      }
      const same = Object.keys(tables).length === Object.keys(v.tables).length && JSON.stringify(tables) === JSON.stringify(v.tables);
      if (!same) changed = true;
      const next: FilterView = same ? v : { ...v, tables };
      if (next.range === undefined && Object.keys(tables).length === 0 && Object.keys(v.tables).length > 0) {
        changed = true;
        continue;
      }
      views.push(next);
    }
    if (views.length === sheet.filterViews.length && views.every((x, i) => x === sheet.filterViews![i])) return sheet;
    changed = true;
    const out = { ...sheet };
    if (views.length) out.filterViews = views;
    else delete out.filterViews;
    return out;
  });
  return changed ? { ...wb, sheets } : wb;
}
