import { cellAddress, colName, colNumber, parseCell, parseRange, rangeAddress } from "./address";
import { moveFilterViews } from "./filterview";
import { FormulaSyntaxError } from "./formula";
import { renameLinkPlace, isPlace } from "./link";
import { MAX_COLS, MAX_ROWS, type Cell, type Dimension, type FilterCriterion, type PageSetup, type Pivot, type Sheet, type SparklineGroup, type Table, type Workbook } from "./model";
import { mapFormulas, type SheetOp } from "./ops";
import { adjustFormula, dropSheetFromFormula, renameSheetInFormula, type Structure } from "./refs";
import { runMap } from "./runs";
import { hasHeader } from "./table";

/**
 * How one operation looks after another has changed the rows or columns it was written for, and after a sheet was renamed or
 * deleted: the addresses, ranges and anchors in it follow, as the cells and objects they would have been applied to do (see
 * `structural` in `ops.ts`, which this has to agree with, cell for cell). Used by `sheetSyncModel`.
 */

/** One insertion or deletion of rows or columns on a sheet. */
export interface Struct {
  sheet: string;
  /** The sheet's name when it was made: what formulas elsewhere call it. */
  name?: string;
  axis: "row" | "col";
  kind: "insert" | "delete";
  at: number;
  count: number;
}

export function structOf(op: SheetOp): Struct | null {
  switch (op.type) {
    case "insert_rows": return { sheet: op.sheet, name: op.name, axis: "row", kind: "insert", at: op.at, count: op.count };
    case "delete_rows": return { sheet: op.sheet, name: op.name, axis: "row", kind: "delete", at: op.at, count: op.count };
    case "insert_cols": return { sheet: op.sheet, name: op.name, axis: "col", kind: "insert", at: op.at, count: op.count };
    case "delete_cols": return { sheet: op.sheet, name: op.name, axis: "col", kind: "delete", at: op.at, count: op.count };
    default: return null;
  }
}

export function structOp(s: Struct): SheetOp {
  const type = `${s.kind}_${s.axis === "row" ? "rows" : "cols"}` as "insert_rows";
  return { type, sheet: s.sheet, at: s.at, count: s.count, ...(s.name !== undefined ? { name: s.name } : {}) };
}

/** The sheet an operation works on, by id. */
export function sheetOf(op: SheetOp): string | undefined {
  switch (op.type) {
    case "delete_sheet":
    case "rename_sheet":
    case "move_sheet":
      return op.id;
    case "add_sheet":
      return op.sheet.id;
    case "set_cells": case "insert_rows": case "delete_rows": case "insert_cols": case "delete_cols": case "insert_row_runs": case "delete_row_runs":
    case "set_size": case "set_sizes": case "set_frozen": case "set_filter": case "set_filter_views": case "set_tab_color": case "set_sheet_hidden":
    case "add_chart": case "update_chart": case "delete_chart": case "add_merge": case "remove_merge": case "add_rule": case "update_rule": case "delete_rule":
    case "add_table": case "update_table": case "delete_table": case "add_slicer": case "update_slicer": case "delete_slicer":
    case "add_timeline": case "update_timeline": case "delete_timeline": case "add_image": case "update_image": case "delete_image":
    case "add_validation": case "update_validation": case "delete_validation": case "set_outline": case "add_sparklines": case "update_sparklines": case "delete_sparklines":
    case "add_pivot": case "update_pivot": case "delete_pivot": case "set_page": case "set_protection": case "set_locks": case "set_hides": case "set_edit_ranges":
      return op.sheet;
    default:
      return undefined;
  }
}

const SENTINEL = "\u0000";

const structureOf = (s: Struct): Structure => ({ sheet: s.name ?? `${SENTINEL}s`, axis: s.axis, kind: s.kind, at: s.at, count: s.count });

/** A formula after the change, left alone if it can't be read. */
function guarded(fn: (f: string, home: string) => string): (f: string, home: string) => string {
  return (f, home) => {
    try {
      return fn(f, home);
    } catch (e) {
      if (e instanceof FormulaSyntaxError) return f;
      throw e;
    }
  };
}

// ---- formulas inside an operation ----

/**
 * The operation with every formula in it passed through `fn` (given the formula and the name of the sheet it sits on, which is
 * `home`). The formulas of cells, charts, sparklines, pivot sources, conditional formats, validation rules, calculated table
 * columns and defined names are the ones `ops.ts` follows when rows move, and so the ones followed here.
 */
export function mapOpFormulas(op: SheetOp, home: string, fn: (f: string, home: string) => string): SheetOp {
  const frame = (patch: Partial<Sheet>): Workbook => ({ id: "", type: "workbook", title: "", sheets: [{ id: "", name: home, cells: {}, ...patch }] });
  const out = (wb: Workbook): Sheet => wb.sheets[0]!;
  const f = fn;
  switch (op.type) {
    case "set_cells": {
      const present = Object.fromEntries(Object.entries(op.cells).filter(([, c]) => c && c.f !== undefined)) as Record<string, Cell>;
      if (!Object.keys(present).length) return op;
      const mapped = out(mapFormulas(frame({ cells: present }), f)).cells;
      return mapped === present ? op : { ...op, cells: { ...op.cells, ...mapped } };
    }
    case "add_chart":
    case "update_chart": {
      const s = out(mapFormulas(frame({ charts: [op.chart] }), f)).charts![0]!;
      return s === op.chart ? op : { ...op, chart: s };
    }
    case "add_sparklines":
    case "update_sparklines": {
      const s = out(mapFormulas(frame({ sparklines: [op.group] }), f)).sparklines![0]!;
      return s === op.group ? op : { ...op, group: s };
    }
    case "add_pivot":
    case "update_pivot": {
      const s = out(mapFormulas(frame({ pivots: [op.pivot] }), f)).pivots![0]!;
      return s === op.pivot ? op : { ...op, pivot: s };
    }
    case "add_rule":
    case "update_rule": {
      const s = out(mapFormulas(frame({ conditional: [op.rule] }), f)).conditional![0]!;
      return s === op.rule ? op : { ...op, rule: s };
    }
    case "add_validation":
    case "update_validation": {
      const s = out(mapFormulas(frame({ validations: [op.validation] }), f)).validations![0]!;
      return s === op.validation ? op : { ...op, validation: s };
    }
    case "add_table":
    case "update_table": {
      const s = out(mapFormulas(frame({ tables: [op.table] }), f)).tables![0]!;
      return s === op.table ? op : { ...op, table: s };
    }
    case "set_name": {
      if (op.formula === null) return op;
      const wb: Workbook = { id: "", type: "workbook", title: "", sheets: [], names: { [op.name]: op.formula } };
      const next = mapFormulas(wb, f).names![op.name]!;
      return next === op.formula ? op : { ...op, formula: next };
    }
    case "add_sheet": {
      const wb: Workbook = { id: "", type: "workbook", title: "", sheets: [op.sheet] };
      const next = mapFormulas(wb, f).sheets[0]!;
      return next === op.sheet ? op : { ...op, sheet: next };
    }
    default:
      return op;
  }
}

/** The operation as it must read once the sheet called `from` is named `to`. */
export function renameInOp(op: SheetOp, home: string, from: string, to: string): SheetOp {
  // The name an operation was stamped with (the sheet it changes the rows of, or deletes) is the sheet's name no longer.
  if ((op.type === "delete_sheet" || structOf(op) || op.type === "insert_row_runs" || op.type === "delete_row_runs") && (op as { name?: string }).name !== undefined && (op as { name?: string }).name!.toLowerCase() === from.toLowerCase()) op = { ...op, name: to } as SheetOp;
  let next = mapOpFormulas(op, home, guarded((f) => renameSheetInFormula(f, from, to)));
  // Links to places on the sheet follow it as well.
  if (next.type === "set_cells" || next.type === "add_sheet") {
    const fix = (cell: Cell): Cell => (cell.link && isPlace(cell.link.to) && renameLinkPlace(cell.link.to, from, to) !== cell.link.to ? { ...cell, link: { ...cell.link, to: renameLinkPlace(cell.link.to, from, to) } } : cell);
    if (next.type === "set_cells") next = { ...next, cells: Object.fromEntries(Object.entries(next.cells).map(([a, c]) => [a, c ? fix(c) : c])) };
    else next = { ...next, sheet: { ...next.sheet, cells: Object.fromEntries(Object.entries(next.sheet.cells).map(([a, c]) => [a, fix(c)])) } };
  }
  return next;
}

/** The operation as it must read once the sheet called `name` is gone. */
export function dropSheetInOp(op: SheetOp, home: string, name: string): SheetOp {
  return mapOpFormulas(op, home, guarded((f) => dropSheetFromFormula(f, name)));
}

// ---- positions inside an operation ----

/** What the change does to one row or column number, and to a range. */
function mover(s: Struct) {
  const runs: [number, number][] = [[s.at, s.count]];
  const map = runMap(s.kind, runs);
  const max = s.axis === "row" ? MAX_ROWS : MAX_COLS;
  const move = (n: number): number | null => map.move(n);
  const clamp = (n: number) => Math.max(1, Math.min(n, max));
  const moveRange = (range: string): string | null => {
    const b = parseRange(range);
    if (!b) return null;
    const [from, to] = s.axis === "row" ? [b.r1, b.r2] : [b.c1, b.c2];
    const span: [number, number] = [map.lo(from), map.hi(to)];
    if (span[0] > span[1]) return null;
    const lo = Math.min(span[0], max);
    const hi = Math.min(span[1], max);
    return rangeAddress(s.axis === "row" ? { ...b, r1: lo, r2: hi } : { ...b, c1: lo, c2: hi });
  };
  /** An anchor (`from` of a chart or a picture): stays on its cell, or at the gap. */
  const anchor = <T extends { row: number; col: number }>(a: T): T => {
    const n = s.axis === "row" ? a.row : a.col;
    const m = move(n) ?? map.gap(n);
    return m === n ? a : { ...a, [s.axis]: clamp(m) };
  };
  return { map, max, move, moveRange, anchor, clamp };
}

const adjustRange = (range: string, s: Struct): string => {
  try {
    return adjustFormula(range, "", { sheet: "", axis: s.axis, kind: s.kind, at: s.at, count: s.count });
  } catch {
    return range;
  }
};

/**
 * An object whose every range went: an added one is never there (so, on the other side, it is taken out before the rows or
 * columns go); a changed one is taken out.
 */
function vanished(kind: "rule" | "validation" | "table" | "sparklines", op: SheetOp, id: string): Shifted {
  const isUpdate = op.type.startsWith("update_");
  const at = (op as { at?: number; index?: number })[isUpdate ? "at" : "index"];
  const gone = { type: `delete_${kind}`, sheet: sheetOf(op)!, id, ...(at !== undefined ? { at } : {}), soft: true } as SheetOp;
  // A changed one is taken out on both sides (the other side takes it out before the change that would have taken it out on its own).
  return isUpdate ? { ops: [gone], before: [gone] } : { ops: [], before: [gone] };
}

/** The result of shifting an operation: what is left of it (nothing when what it is about has gone), and operations to add to the other side. */
export interface Shifted {
  ops: SheetOp[];
  /** Operations that must run before the structural change on the other side (to take away what could not stand in its way). */
  before?: SheetOp[];
}

/**
 * The operation after `s` has happened: its addresses, ranges and anchors move with the rows and columns. When `s` is on another
 * sheet, only the formulas that point at that sheet change.
 */
export function shiftOp(op: SheetOp, s: Struct): Shifted {
  const out = shiftOpPlain(op, s);
  // Rows or columns of another person can take a rule or a validation away in this copy of the workbook only (what is left of its ranges here is nothing), so a delete of one may find it gone: it then has nothing to do.
  if (sheetOf(op) === s.sheet && (op.type === "remove_merge" || (op.type.startsWith("delete_") && op.type !== "delete_sheet"))) return { ...out, ops: out.ops.map((o) => (o.soft ? o : { ...o, soft: true as const })) };
  // A table of the other copy may have been taken away by rows or columns that, in this copy, left some of it (the update gave it more room): the update then puts it back as it has it.
  if (op.type === "update_table" && sheetOf(op) === s.sheet && s.kind === "delete") return { ...out, ops: out.ops.map((o) => (o.type === "update_table" && !o.soft ? { ...o, soft: "upsert" as const } : o)) };
  return out;
}

function shiftOpPlain(op: SheetOp, s: Struct): Shifted {
  const sameSheet = sheetOf(op) === s.sheet;
  // The sheet the operation is about is `home` to its unprefixed references.
  const home = sameSheet ? s.name ?? `${SENTINEL}s` : `${SENTINEL}o`;
  const st = structureOf(s);
  const fixFormulas = (o: SheetOp): SheetOp => {
    if (!sameSheet && s.name === undefined) return o;
    return mapOpFormulas(o, home, guarded((f, h) => adjustFormula(f, h, st)));
  };
  if (!sameSheet) {
    // A name's formula, which has no home sheet, still points at the sheet.
    return { ops: [fixFormulas(op)] };
  }
  const m = mover(s);
  const one = (o: SheetOp | null): Shifted => ({ ops: o ? [o] : [] });
  switch (op.type) {
    case "set_cells": {
      const cells: Record<string, Cell | null> = {};
      for (const [address, cell] of Object.entries(op.cells)) {
        const p = parseCell(address);
        if (!p) {
          cells[address] = cell;
          continue;
        }
        const moved = m.move(s.axis === "row" ? p.row : p.col);
        if (moved === null) continue;
        cells[s.axis === "row" ? cellAddress(moved, p.col) : cellAddress(p.row, moved)] = cell;
      }
      return Object.keys(cells).length ? one(fixFormulas({ ...op, cells })) : { ops: [] };
    }
    case "set_size": {
      if ((op.axis === "row") !== (s.axis === "row")) return one(op);
      const n = m.move(op.index);
      return n === null ? { ops: [] } : one(n === op.index ? op : { ...op, index: n });
    }
    case "set_sizes": {
      if ((op.axis === "row") !== (s.axis === "row")) return one(op);
      const sizes = op.sizes.flatMap((e) => {
        const n = m.move(e.index);
        return n === null ? [] : [n === e.index ? e : { ...e, index: n }];
      });
      return sizes.length ? one({ ...op, sizes }) : { ops: [] };
    }
    case "set_locks":
    case "set_hides": {
      const field = s.axis === "col" ? "columns" : "rows";
      const dims = op[field] as Record<string, boolean | null> | undefined;
      if (!dims) return one(op);
      const next: Record<string, boolean | null> = {};
      for (const [k, v] of Object.entries(dims)) {
        const n = m.move(s.axis === "col" ? colNumber(k) : Number(k));
        if (n !== null) next[s.axis === "col" ? colName(n) : String(n)] = v;
      }
      const rest = { ...op, [field]: next };
      if (!Object.keys(next).length) delete (rest as Record<string, unknown>)[field];
      const hasOther = Object.keys(rest).some((k) => k !== "type" && k !== "sheet");
      return hasOther ? one(rest as SheetOp) : { ops: [] };
    }
    case "add_merge":
    case "remove_merge": {
      const range = m.moveRange(op.range);
      return range && range.includes(":") ? one({ ...op, range }) : { ops: [] };
    }
    case "set_filter": {
      if (!op.filter) return one(op);
      const moved = adjustRange(op.filter.range, s);
      const r = moved === "#REF!" ? null : parseRange(moved);
      if (!r || r.r1 === r.r2) return one({ ...op, filter: null });
      const columns: Record<string, FilterCriterion> = {};
      for (const [k, v] of Object.entries(op.filter.columns ?? {})) {
        const n = s.axis === "col" ? m.move(colNumber(k)) : colNumber(k);
        if (n !== null && n >= r.c1 && n <= r.c2) columns[colName(n)] = v;
      }
      return one({ ...op, filter: { range: rangeAddress(r), ...(Object.keys(columns).length ? { columns } : {}) } });
    }
    case "set_filter_views": {
      if (!op.views) return one(op);
      const views = moveFilterViews(op.views, (range) => {
        const r = adjustRange(range, s);
        return r === "#REF!" ? null : r;
      }, (n) => (s.axis === "col" ? m.move(n) : n));
      return one({ ...op, views });
    }
    case "add_rule":
    case "update_rule": {
      const ranges = op.rule.ranges.map(m.moveRange).filter((r): r is string => r !== null);
      // A format with no range left is gone; one that was there before this change is taken away by it.
      if (!ranges.length) return vanished("rule", op, op.rule.id);
      return one(fixFormulas({ ...op, rule: { ...op.rule, ranges } as typeof op.rule }));
    }
    case "add_validation":
    case "update_validation": {
      const ranges = op.validation.ranges.map(m.moveRange).filter((r): r is string => r !== null);
      if (!ranges.length) return vanished("validation", op, op.validation.id);
      return one(fixFormulas({ ...op, validation: { ...op.validation, ranges } as typeof op.validation }));
    }
    case "add_table":
    case "update_table": {
      const next = shiftTable(op.table, s, m);
      if (!next) return vanished("table", op, op.table.id);
      return one(fixFormulas({ ...op, table: next }));
    }
    case "add_chart":
    case "update_chart":
      return one(fixFormulas({ ...op, chart: { ...op.chart, from: m.anchor(op.chart.from) } }));
    case "add_image":
    case "update_image": {
      const image = op.image;
      const from = m.anchor(image.from);
      const to = image.to ? m.anchor(image.to) : undefined;
      return one({ ...op, image: { ...image, from, ...(to ? { to } : {}) } });
    }
    case "add_slicer":
    case "update_slicer":
      return one({ ...op, slicer: { ...op.slicer, from: m.anchor(op.slicer.from) } });
    case "add_timeline":
    case "update_timeline":
      return one({ ...op, timeline: { ...op.timeline, from: m.anchor(op.timeline.from) } });
    case "add_sparklines":
    case "update_sparklines": {
      const group: SparklineGroup = op.group;
      const items = group.items.flatMap((item) => {
        const p = parseCell(item.cell);
        if (!p) return [item];
        const n = m.move(s.axis === "row" ? p.row : p.col);
        return n === null ? [] : [{ ...item, cell: s.axis === "row" ? cellAddress(n, p.col) : cellAddress(p.row, n) }];
      });
      if (!items.length) return vanished("sparklines", op, group.id);
      return one(fixFormulas({ ...op, group: { ...group, items } }));
    }
    case "add_pivot":
    case "update_pivot": {
      const pivot: Pivot = op.pivot;
      const b = parseRange(pivot.range);
      const a = parseCell(pivot.anchor);
      if (!b || !a) return one(fixFormulas(op));
      const [from, to] = s.axis === "row" ? [b.r1, b.r2] : [b.c1, b.c2];
      const cut = s.kind === "insert" ? s.at > from && s.at <= to : s.at <= to && s.at + s.count - 1 >= from;
      // A change that cuts through a pivot table can't be applied to it: the table is taken out of the way (see `shiftThrough`).
      if (cut) return { ops: [], before: [{ type: "delete_pivot", sheet: op.sheet, id: pivot.id, soft: true }] };
      const d = m.move(from)! - from;
      const moved = d ? { ...pivot, anchor: s.axis === "row" ? cellAddress(a.row + d, a.col) : cellAddress(a.row, a.col + d), range: rangeAddress(s.axis === "row" ? { ...b, r1: b.r1 + d, r2: b.r2 + d } : { ...b, c1: b.c1 + d, c2: b.c2 + d }) } : pivot;
      // The slicers and timelines of the pivot table stay on their cells, as they do when the rows or columns change under it.
      const withPanels: Pivot = moved.slicers?.length || moved.timelines?.length ? { ...moved, ...(moved.slicers ? { slicers: moved.slicers.map((x) => ({ ...x, from: m.anchor(x.from) })) } : {}), ...(moved.timelines ? { timelines: moved.timelines.map((x) => ({ ...x, from: m.anchor(x.from) })) } : {}) } : moved;
      return one(fixFormulas({ ...op, pivot: withPanels }));
    }
    case "set_page": {
      if (!op.page) return one(op);
      const page = shiftPage(op.page, s, m);
      return one({ ...op, page });
    }
    case "set_edit_ranges": {
      if (!op.ranges) return one(op);
      const ranges = op.ranges.map((r) => ({ ...r, ranges: r.ranges.map(m.moveRange).filter((x): x is string => x !== null) })).filter((r) => r.ranges.length);
      return one({ ...op, ranges: ranges.length ? ranges : null });
    }
    case "set_name":
      return one(fixFormulas(op));
    default:
      return one(fixFormulas(op));
  }
}

function shiftTable(table: Table, s: Struct, m: ReturnType<typeof mover>): Table | null {
  const b = parseRange(table.range);
  if (!b) return table;
  const headed = hasHeader(table);
  // A table whose header row is deleted is gone with it.
  if (headed && s.axis === "row" && s.kind === "delete" && m.map.gone(b.r1)) return null;
  const moved = m.moveRange(table.range);
  if (moved === null) return null;
  const r = parseRange(moved)!;
  let range = r;
  let totals = table.totals;
  if (s.axis === "row" && s.kind === "delete" && table.totals && m.map.gone(b.r2)) totals = undefined;
  const least = (headed ? 1 : 0) + (totals ? 1 : 0);
  if (r.r2 < r.r1 + least) range = { ...r, r2: r.r1 + least };
  const next: Table = { ...table, range: rangeAddress(range) };
  if (totals) next.totals = true;
  else delete next.totals;
  if (!headed && s.axis === "col" && table.columns) {
    const width = range.c2 - range.c1 + 1;
    // The names as they are kept (a blank stays blank), as the rows and columns themselves do in a shared workbook.
    const names = Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => table.columns![i] ?? "");
    if (s.kind === "delete") next.columns = names.filter((_, i) => !m.map.gone(b.c1 + i)).slice(0, width);
    else if (width > names.length) {
      const kept = names.slice();
      kept.splice(Math.max(0, Math.min(s.at - b.c1, kept.length)), 0, ...Array.from({ length: width - names.length }, () => ""));
      next.columns = kept;
    }
  }
  return next;
}

function shiftPage(page: PageSetup, s: Struct, m: ReturnType<typeof mover>): PageSetup {
  const out: PageSetup = { ...page };
  if (out.printArea) {
    const areas = out.printArea.map(m.moveRange).filter((r): r is string => r !== null);
    if (areas.length) out.printArea = areas;
    else delete out.printArea;
  }
  const titles = s.axis === "row" ? out.titleRows : out.titleCols;
  if (titles) {
    const lo = m.map.lo(titles[0]);
    const hi = m.map.hi(titles[1]);
    const next: [number, number] | undefined = hi >= lo && lo <= m.max ? [Math.max(1, lo), Math.min(m.max, hi)] : undefined;
    if (s.axis === "row") {
      if (next) out.titleRows = next;
      else delete out.titleRows;
    } else if (next) out.titleCols = next;
    else delete out.titleCols;
  }
  const list = s.axis === "row" ? out.rowBreaks : out.colBreaks;
  if (list) {
    const moved = [...new Set(list.map(m.move).filter((n): n is number => n !== null && n >= 1 && n < m.max))].sort((x, y) => x - y);
    if (s.axis === "row") {
      if (moved.length) out.rowBreaks = moved;
      else delete out.rowBreaks;
    } else if (moved.length) out.colBreaks = moved;
    else delete out.colBreaks;
  }
  return out;
}

/** The two unit changes of rows or columns on the same sheet and axis, each as it must be applied after the other. */
export interface Unit {
  kind: "insert" | "delete";
  at: number;
  count: number;
}

export function transformUnits(l: Unit, e: Unit): [Unit[], Unit[]] {
  if (l.kind === "insert" && e.kind === "insert") {
    if (l.at < e.at) return [[l], [{ ...e, at: e.at + l.count }]];
    // At the same place the earlier change goes first.
    return [[{ ...l, at: l.at + e.count }], [e]];
  }
  if (l.kind === "insert" && e.kind === "delete") {
    const a = l.at;
    const b = e.at;
    const m = e.count;
    if (a < b) return [[l], [{ ...e, at: b + l.count }]];
    if (a > b + m) return [[{ ...l, at: a - m }], [e]];
    // Rows put in among rows that someone else deletes, or right after them, go with them (so that every formula that spans them reads the same on both sides).
    return [[], [{ ...e, count: m + l.count }]];
  }
  if (l.kind === "delete" && e.kind === "insert") {
    const a = l.at;
    const n = l.count;
    const b = e.at;
    const m = e.count;
    if (b < a) return [[{ ...l, at: a + m }], [e]];
    if (b > a + n) return [[l], [{ ...e, at: b - n }]];
    return [[{ ...l, count: n + m }], []];
  }
  const overlap = Math.max(0, Math.min(l.at + l.count, e.at + e.count) - Math.max(l.at, e.at));
  const lCount = l.count - overlap;
  const eCount = e.count - overlap;
  const lAt = l.at - Math.min(Math.max(l.at - e.at, 0), e.count);
  const eAt = e.at - Math.min(Math.max(e.at - l.at, 0), l.count);
  return [lCount > 0 ? [{ ...l, at: lAt, count: lCount }] : [], eCount > 0 ? [{ ...e, at: eAt, count: eCount }] : []];
}

/** Where a range ends up after a change of rows or columns, for the ranges that people have selected. */
export function shiftSelectionRange(range: string, s: Struct): string | null {
  const b = parseRange(range);
  if (!b) return null;
  const m = mover(s);
  const moved = m.moveRange(range);
  if (moved) return moved;
  // All of it went: the selection takes the cell where the gap is.
  const [from] = s.axis === "row" ? [b.r1] : [b.c1];
  const at = m.clamp(m.map.gap(from));
  return rangeAddress(s.axis === "row" ? { ...b, r1: at, r2: at } : { ...b, c1: at, c2: at });
}

export type { Dimension };
