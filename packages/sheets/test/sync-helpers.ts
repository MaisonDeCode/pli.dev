import { SheetSession, ghostApply, stampOps, hashWorkbook, type SheetOp, type Workbook, type Cell } from "../src";

/** A small seeded random source. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const self = {
    next,
    int: (n: number) => Math.floor(next() * n),
    range: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)),
    chance: (p: number) => next() < p,
    pick: <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
  };
  return self;
}
export type Rng = ReturnType<typeof rng>;

/** Applies operations, in order. */
export function apply(wb: Workbook, ops: readonly SheetOp[]): Workbook {
  return ops.reduce((state, op) => ghostApply(state, op), wb);
}

export const same = (a: Workbook, b: Workbook) => hashWorkbook(a) === hashWorkbook(b);

export const show = (ops: readonly SheetOp[]) => JSON.stringify(ops, (k, v) => (k === "sheet" && v && typeof v === "object" ? { id: v.id, name: v.name, cells: Object.keys(v.cells).length } : v));

/**
 * A workbook with two sheets, some cells and a few objects, the same for everyone. With `tables`: also a sheet of orders holding a
 * table, a slicer and a timeline over it, and a pivot table on a sheet of its own that reads the table's range.
 */
export function startBook(tables = false): Workbook {
  const cells = (rows: number, cols: number): Record<string, Cell> => {
    const out: Record<string, Cell> = {};
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) out[`${String.fromCharCode(64 + c)}${r}`] = { v: r * 10 + c };
    return out;
  };
  const plain: Workbook = {
    id: "wb",
    type: "workbook",
    title: "Book",
    sheets: [
      { id: "s1", name: "Data", cells: { ...cells(8, 5), E2: { f: "SUM(A1:A8)" }, E3: { f: "Notes!B2*2" } } },
      { id: "s2", name: "Notes", cells: { ...cells(6, 4), D1: { f: "Data!C3+1" } } },
    ],
  };
  if (!tables) return plain;
  const regions = ["East", "West", "North"];
  const orders: Record<string, Cell> = { A1: { v: "Region" }, B1: { v: "Product" }, C1: { v: "Qty" }, D1: { v: "Day" } };
  for (let r = 2; r <= 9; r++) {
    orders[`A${r}`] = { v: regions[r % 3]! };
    orders[`B${r}`] = { v: r % 2 ? "Pen" : "Ink" };
    orders[`C${r}`] = { v: r * 3 };
    orders[`D${r}`] = { v: 45000 + r * 20 };
  }
  const book: Workbook = { ...plain, sheets: [...plain.sheets, { id: "s3", name: "Orders", cells: orders }, { id: "s4", name: "Summary", cells: {} }] };
  const session = new SheetSession(book);
  session.createTable("Orders", "A1:D9", { name: "OrderTable", id: "t1" });
  session.addSlicer("Orders", { table: "OrderTable", column: "Region", id: "sl1", from: { row: 2, col: 7 } });
  session.addTimeline("Orders", { table: "OrderTable", column: "Day", id: "tl1", from: { row: 12, col: 1 } });
  session.createPivot("Summary", { id: "pv1", name: "ByRegion", source: "Orders!A1:D9", anchor: "A1", rows: ["Region"], values: ["Qty"] });
  return session.state;
}

/** The operations a call on a session makes, as the editor would write them (stamped), or null if it is refused or does nothing. */
function recorded(wb: Workbook, fn: (s: SheetSession) => void): SheetOp | null {
  const s = new SheetSession(wb);
  const ops: SheetOp[] = [];
  s.subscribe((e) => {
    if (!e.reset) ops.push(...e.ops);
  });
  try {
    fn(s);
  } catch {
    return null;
  }
  return ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { type: "batch", ops };
}

const TABLE_KINDS = ["table_create", "table_resize", "table_rename", "table_totals", "table_header", "table_style", "table_delete", "table_sort", "table_filter", "table_cols", "table_rows", "table_head_edit", "slicer_add", "slicer_delete", "timeline_add", "timeline_delete", "pivot_create", "pivot_delete", "pivot_slicer"] as const;

function tableOp(r: Rng, wb: Workbook, tag: string, kind: (typeof TABLE_KINDS)[number]): SheetOp | null {
  const all = wb.sheets.flatMap((sh) => (sh.tables ?? []).map((table) => ({ sheet: sh, table })));
  const one = all.length ? r.pick(all) : null;
  const cols = (t: { sheet: Workbook["sheets"][number]; table: { range: string } }) => {
    const [a, b] = t.table.range.split(":") as [string, string];
    return { c1: a.charCodeAt(0) - 64, r1: Number(a.slice(1)), c2: b.charCodeAt(0) - 64, r2: Number(b.slice(1)) };
  };
  switch (kind) {
    case "table_create": {
      const sh = r.pick(wb.sheets);
      const r1 = r.range(1, 8);
      const c1 = r.range(1, 4);
      return recorded(wb, (s) => void s.createTable(sh.id, RANGE(r1, c1, r1 + r.range(1, 4), c1 + r.range(1, 3)), { name: `T${tag}${++counter}` }));
    }
    case "table_resize":
      return one ? recorded(wb, (s) => s.resizeTable(one.table.name, RANGE(cols(one).r1, cols(one).c1, cols(one).r2 + r.range(-2, 3), cols(one).c2 + r.range(-1, 2)))) : null;
    case "table_rename":
      return one ? recorded(wb, (s) => s.renameTable(one.table.name, `R${tag}${++counter}`)) : null;
    case "table_totals":
      return one ? recorded(wb, (s) => s.setTableTotals(one.table.name, !one.table.totals)) : null;
    case "table_header":
      return one ? recorded(wb, (s) => s.setTableHeader(one.table.name, one.table.headerRow === false)) : null;
    case "table_style":
      return one ? recorded(wb, (s) => s.setTableOptions(one.table.name, { style: r.pick(["TableStyleLight1", "TableStyleMedium9", null]), bandedRows: r.chance(0.5) })) : null;
    case "table_delete":
      return one ? recorded(wb, (s) => s.deleteTable(one.table.name)) : null;
    case "table_sort":
      return one ? recorded(wb, (s) => s.sortTable(one.table.name, r.range(1, Math.max(1, cols(one).c2 - cols(one).c1 + 1)), r.pick(["ascending", "descending"] as const))) : null;
    case "table_filter":
      return one ? recorded(wb, (s) => s.filterTable(one.table.name, 1, r.chance(0.3) ? null : [String(r.int(5)), "East", "Pen"])) : null;
    case "table_cols":
      return one ? recorded(wb, (s) => (r.chance(0.5) ? s.insertColumns(one.sheet.id, cols(one).c1 + r.int(cols(one).c2 - cols(one).c1 + 1), 1) : s.deleteColumns(one.sheet.id, cols(one).c1 + r.int(cols(one).c2 - cols(one).c1 + 1), 1))) : null;
    case "table_rows":
      return one ? recorded(wb, (s) => (r.chance(0.5) ? s.insertRows(one.sheet.id, cols(one).r1 + r.int(cols(one).r2 - cols(one).r1 + 1), 1) : s.deleteRows(one.sheet.id, cols(one).r1 + r.int(cols(one).r2 - cols(one).r1 + 2), 1))) : null;
    case "table_head_edit":
      return one && one.table.headerRow !== false ? recorded(wb, (s) => s.setCell(one.sheet.id, ADDR(cols(one).r1, cols(one).c1 + r.int(cols(one).c2 - cols(one).c1 + 1)), `H${tag}${++counter}`)) : null;
    case "slicer_add": {
      if (!one) return null;
      return recorded(wb, (s) => void s.addSlicer(one.sheet.id, { table: one.table.name, column: s.tableColumnNames(one.table)[r.int(Math.max(1, s.tableColumnNames(one.table).length))]!, from: { row: r.range(1, 12), col: r.range(6, 9) }, id: `sl_${tag}_${++counter}` }));
    }
    case "slicer_delete": {
      const list = wb.sheets.flatMap((sh) => (sh.slicers ?? []).map((x) => ({ sh, x })));
      const pick = list.length ? r.pick(list) : null;
      return pick ? recorded(wb, (s) => s.deleteSlicer(pick.sh.id, pick.x.id)) : null;
    }
    case "timeline_add": {
      if (!one) return null;
      return recorded(wb, (s) => void s.addTimeline(one.sheet.id, { table: one.table.name, column: s.tableColumnNames(one.table)[r.int(Math.max(1, s.tableColumnNames(one.table).length))]!, from: { row: r.range(10, 20), col: r.range(1, 4) }, id: `tl_${tag}_${++counter}` }));
    }
    case "timeline_delete": {
      const list = wb.sheets.flatMap((sh) => (sh.timelines ?? []).map((x) => ({ sh, x })));
      const pick = list.length ? r.pick(list) : null;
      return pick ? recorded(wb, (s) => s.deleteTimeline(pick.sh.id, pick.x.id)) : null;
    }
    case "pivot_create": {
      const target = r.pick(wb.sheets);
      const src = one ? `${one.sheet.name}!${one.table.range}` : "Orders!A1:D9";
      return recorded(wb, (s) => void s.createPivot(target.id, { id: `pv_${tag}_${++counter}`, source: src, anchor: ADDR(r.range(12, 20), r.range(1, 3)), rows: [one ? s.tableColumnNames(one.table)[0] ?? "Region" : "Region"], values: [] }));
    }
    case "pivot_delete": {
      const list = wb.sheets.flatMap((sh) => (sh.pivots ?? []).map((x) => ({ sh, x })));
      const pick = list.length ? r.pick(list) : null;
      return pick ? recorded(wb, (s) => s.deletePivot(pick.sh.id, pick.x.id)) : null;
    }
    case "pivot_slicer": {
      const list = wb.sheets.flatMap((sh) => (sh.pivots ?? []).map((x) => ({ sh, x })));
      const pick = list.length ? r.pick(list) : null;
      return pick ? recorded(wb, (s) => void s.addPivotSlicer(pick.sh.id, pick.x.id, { field: pick.x.rows[0]?.field ?? "Region" })) : null;
    }
  }
}

const ADDR = (r: number, c: number) => `${String.fromCharCode(64 + c)}${r}`;
const RANGE = (r1: number, c1: number, r2: number, c2: number) => `${ADDR(r1, c1)}:${ADDR(r2, c2)}`;

let counter = 0;
const fresh = (prefix: string, tag: string) => `${prefix}_${tag}_${++counter}`;

/**
 * An operation that is valid on `wb`, made by `tag` (so ids and names differ between people). Returns null when the dice give
 * nothing to do. The workbook is only read.
 */
export function randomOp(r: Rng, wb: Workbook, tag: string, options: { only?: readonly string[] } = {}): SheetOp | null {
  const sheet = r.pick(wb.sheets);
  const row = () => r.range(1, 12);
  const col = () => r.range(1, 7);
  const kinds = [
    "cells", "cells", "cells", "cells", "formula", "formula", "insert_rows", "delete_rows", "insert_cols", "delete_cols", "insert_row_runs", "set_size", "merge", "unmerge", "rule", "update_rule", "delete_rule",
    "chart", "update_chart", "delete_chart", "validation", "delete_validation", "frozen", "title", "name", "add_sheet", "rename_sheet", "delete_sheet", "move_sheet", "tab_color", "thread", "reply", "resolve", "filter", "image", "hidden_size", "clear",
  ];
  const kind = r.pick(options.only ?? (wb.sheets.some((sh) => sh.tables?.length || sh.pivots?.length) ? [...kinds, ...TABLE_KINDS, ...TABLE_KINDS] : kinds));
  if ((TABLE_KINDS as readonly string[]).includes(kind)) return tableOp(r, wb, tag, kind as (typeof TABLE_KINDS)[number]);
  switch (kind) {
    case "cells": {
      const cells: Record<string, Cell | null> = {};
      for (let i = r.range(1, 3); i > 0; i--) cells[ADDR(row(), col())] = r.chance(0.15) ? null : r.chance(0.2) ? { v: `${tag}${r.int(100)}` } : { v: r.int(1000) };
      return { type: "set_cells", sheet: sheet.id, cells };
    }
    case "formula": {
      const other = r.pick(wb.sheets);
      const ref = r.chance(0.5) ? `${ADDR(row(), col())}` : `${other.name}!${ADDR(row(), col())}`;
      const f = r.pick([`${ref}+1`, `SUM(${RANGE(1, 1, row(), col())})`, `${ref}*2`]);
      return { type: "set_cells", sheet: sheet.id, cells: { [ADDR(row(), col())]: { f } } };
    }
    case "insert_rows":
      return { type: "insert_rows", sheet: sheet.id, at: row(), count: r.range(1, 3) };
    case "delete_rows":
      return { type: "delete_rows", sheet: sheet.id, at: row(), count: r.range(1, 3) };
    case "insert_cols":
      return { type: "insert_cols", sheet: sheet.id, at: col(), count: r.range(1, 2) };
    case "delete_cols":
      return { type: "delete_cols", sheet: sheet.id, at: col(), count: r.range(1, 2) };
    case "insert_row_runs": {
      const a = row();
      return { type: "insert_row_runs", sheet: sheet.id, runs: [[a, r.range(1, 2)], [a + r.range(1, 4), r.range(1, 2)]] };
    }
    case "set_size":
      return r.chance(0.5) ? { type: "set_size", sheet: sheet.id, axis: "row", index: row(), size: r.range(10, 40) } : { type: "set_size", sheet: sheet.id, axis: "col", index: col(), ...(r.chance(0.7) ? { size: r.range(5, 30) } : { hidden: r.chance(0.5) }) };
    case "hidden_size":
      return { type: "set_sizes", sheet: sheet.id, axis: "row", sizes: [{ index: row(), hidden: true }, { index: row(), size: 22 }] };
    case "merge": {
      const r1 = row();
      const c1 = col();
      const range = RANGE(r1, c1, r1 + r.range(0, 2), c1 + r.range(1, 2));
      return { type: "add_merge", sheet: sheet.id, range };
    }
    case "unmerge":
      return sheet.merges?.length ? { type: "remove_merge", sheet: sheet.id, range: r.pick(sheet.merges) } : null;
    case "rule": {
      const r1 = row();
      const c1 = col();
      return { type: "add_rule", sheet: sheet.id, rule: { id: fresh("rule", tag), kind: "formula", formula: `${ADDR(r1, c1)}>5`, ranges: [RANGE(r1, c1, r1 + r.range(0, 3), c1 + r.range(0, 2))], style: { bold: true } }, ...(r.chance(0.3) && (sheet.conditional?.length ?? 0) > 0 ? { index: r.int(sheet.conditional!.length) } : {}) } as SheetOp;
    }
    case "update_rule": {
      const rule = sheet.conditional?.length ? r.pick(sheet.conditional) : null;
      if (!rule || rule.kind !== "formula") return null;
      const r1 = row();
      return { type: "update_rule", sheet: sheet.id, rule: { ...rule, ranges: [RANGE(r1, 1, r1 + 1, 2)] } };
    }
    case "delete_rule":
      return sheet.conditional?.length ? { type: "delete_rule", sheet: sheet.id, id: r.pick(sheet.conditional).id } : null;
    case "chart":
      return { type: "add_chart", sheet: sheet.id, chart: { id: fresh("chart", tag), type: "column", series: [{ values: `${sheet.name}!$B$1:$B$${r.range(2, 6)}` }], from: { row: row(), col: col() }, width: 300, height: 200 }, ...(r.chance(0.3) && (sheet.charts?.length ?? 0) > 0 ? { index: r.int(sheet.charts!.length) } : {}) } as SheetOp;
    case "update_chart": {
      const chart = sheet.charts?.length ? r.pick(sheet.charts) : null;
      return chart ? { type: "update_chart", sheet: sheet.id, chart: { ...chart, title: `${tag}${r.int(50)}`, from: { row: row(), col: col() } } } : null;
    }
    case "delete_chart":
      return sheet.charts?.length ? { type: "delete_chart", sheet: sheet.id, id: r.pick(sheet.charts).id } : null;
    case "image":
      return { type: "add_image", sheet: sheet.id, image: { id: fresh("img", tag), src: "data:image/png;base64,iVBORw0KGgo=", from: { row: row(), col: col() }, width: 40, height: 30 } } as SheetOp;
    case "validation": {
      const r1 = row();
      return { type: "add_validation", sheet: sheet.id, validation: { id: fresh("val", tag), kind: "whole", op: "between", values: ["1", "10"], ranges: [RANGE(r1, 2, r1 + r.range(0, 2), 3)] } } as SheetOp;
    }
    case "delete_validation":
      return sheet.validations?.length ? { type: "delete_validation", sheet: sheet.id, id: r.pick(sheet.validations).id } : null;
    case "frozen":
      return { type: "set_frozen", sheet: sheet.id, rows: r.int(3), cols: r.int(3) };
    case "title":
      return { type: "set_title", title: `${tag} ${r.int(100)}` };
    case "name":
      return { type: "set_name", name: r.pick(["Alpha", "Beta", "Gamma"]), formula: r.chance(0.2) ? null : `${r.pick(wb.sheets).name}!$A$${row()}` };
    case "add_sheet":
      return { type: "add_sheet", sheet: { id: fresh("sh", tag), name: r.pick(["Extra", "More", "Other", "Plus"]) + r.int(4), cells: { A1: { v: 1 } } }, ...(r.chance(0.4) ? { index: r.int(wb.sheets.length) } : {}) };
    case "rename_sheet":
      return { type: "rename_sheet", id: sheet.id, name: r.pick(["Alpha", "Beta", "Gamma", "Delta"]) + r.int(3) };
    case "delete_sheet":
      return wb.sheets.length > 3 ? { type: "delete_sheet", id: sheet.id } : null;
    case "move_sheet":
      return { type: "move_sheet", id: sheet.id, index: r.int(wb.sheets.length) };
    case "tab_color":
      return { type: "set_tab_color", sheet: sheet.id, color: r.pick(["#ff0000", "#00ff00", null]) };
    case "filter":
      return { type: "set_filter", sheet: sheet.id, filter: r.chance(0.2) ? null : { range: RANGE(r.range(1, 3), 1, r.range(5, 8), 3) } };
    case "clear":
      return { type: "set_cells", sheet: sheet.id, cells: { [ADDR(row(), col())]: { thread: r.pick(Object.keys(wb.comments ?? {}).concat(["th_none"])) } } };
    case "thread": {
      const id = fresh("th", tag);
      const cell = ADDR(row(), col());
      const thread = { id, anchor: { sheet: sheet.id, cell }, comments: [{ id: fresh("cm", tag), author: tag, body: "hi", createdAt: 1 }], createdAt: 1 };
      return { type: "batch", ops: [{ type: "set_thread", id, thread }, { type: "set_cells", sheet: sheet.id, cells: { [cell]: { thread: id } } }] };
    }
    case "reply": {
      const ids = Object.keys(wb.comments ?? {});
      if (!ids.length) return null;
      return { type: "comment", change: { type: "comment.add", threadId: r.pick(ids), comment: { id: fresh("cm", tag), author: tag, body: `re ${r.int(9)}`, createdAt: 2 } } };
    }
    case "resolve": {
      const ids = Object.keys(wb.comments ?? {});
      if (!ids.length) return null;
      const id = r.pick(ids);
      return { type: "comment", change: r.chance(0.5) ? { type: "thread.resolve", threadId: id, by: tag, at: 3 } : { type: "thread.reopen", threadId: id } };
    }
  }
  return null;
}

/** One to a few valid operations made one after the other (each valid after the ones before it), stamped. */
export function randomBatch(r: Rng, wb: Workbook, tag: string, max = 3, options: { only?: readonly string[] } = {}): SheetOp[] {
  const ops: SheetOp[] = [];
  let state = wb;
  for (let i = r.range(1, max); i > 0; i--) {
    const op = randomOp(r, state, tag, options);
    if (!op) continue;
    try {
      const [stamped] = stampOps(state, [op]);
      state = apply(state, [stamped!]);
      ops.push(stamped!);
    } catch {
      // not valid here: leave it out
    }
  }
  return ops;
}
