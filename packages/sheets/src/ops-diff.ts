import { colName, colNumber } from "./address";
import type { Dimension, Sheet, Workbook } from "./model";
import { applyOp, type SheetOp, type SizeChange } from "./ops";

/**
 * What undoing an operation takes. Most operations undo with one operation of their own kind, but inserting and deleting rows,
 * adding, deleting and renaming sheets reach into many places (every formula that points at them), so their inverse is made
 * the other way round: the operation that is the obvious opposite, and then the operations that put right whatever the
 * opposite did not give back. They are plain operations, so another person's changes can be merged with them (see `sheetSyncModel`):
 * undoing the deletion of rows puts back the cells that were in them, not the whole workbook as it was.
 */

/** Deep equality of two plain JSON values; the same object is equal at once, which is what makes it cheap on workbooks. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], other[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter((k) => x[k] !== undefined);
  const others = Object.keys(y).filter((k) => y[k] !== undefined);
  if (keys.length !== others.length) return false;
  for (const k of keys) if (!deepEqual(x[k], y[k])) return false;
  return true;
}

class Unsupported extends Error {}

const keysOf = (a: object | undefined, b: object | undefined): string[] => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];

/** Lists whose items have an `id`: the operations that make `to` out of `from`, each saying where in the list it works. */
function diffList<T extends { id: string }>(from: readonly T[] | undefined, to: readonly T[] | undefined, make: { add(item: T, index: number): SheetOp; update(item: T, at: number): SheetOp; delete(id: string, at: number): SheetOp }): SheetOp[] {
  const ops: SheetOp[] = [];
  const a = from ?? [];
  const b = to ?? [];
  const ids = new Set(b.map((x) => x.id));
  // Taken out from the last, so each one's place is what it was.
  for (let i = a.length - 1; i >= 0; i--) if (!ids.has(a[i]!.id)) ops.push(make.delete(a[i]!.id, i));
  const kept = a.filter((x) => ids.has(x.id));
  kept.forEach((old, at) => {
    const item = b.find((x) => x.id === old.id)!;
    if (!deepEqual(old, item)) ops.push(make.update(item, at));
  });
  // New items go in at their place, in order, so the list ends up as `to` has it.
  const have = new Set(kept.map((x) => x.id));
  b.forEach((item, index) => {
    if (!have.has(item.id)) ops.push(make.add(item, index));
  });
  return ops;
}

function dimensionOps(sheet: string, axis: "col" | "row", from: Record<string, Dimension> | undefined, to: Record<string, Dimension> | undefined): SheetOp[] {
  const sizes: SizeChange[] = [];
  const locks: Record<string, boolean | null> = {};
  const hides: Record<string, boolean | null> = {};
  for (const key of keysOf(from, to)) {
    const a = from?.[key];
    const b = to?.[key];
    if (deepEqual(a, b)) continue;
    const index = axis === "col" ? colNumber(key) : Number(key);
    if (!deepEqual({ ...a, locked: undefined, hideFormula: undefined }, { ...b, locked: undefined, hideFormula: undefined })) {
      sizes.push({ index, size: b?.size ?? null, hidden: b?.hidden ?? null, level: b?.level ?? null, collapsed: b?.collapsed ?? null });
    }
    if (a?.locked !== b?.locked) locks[key] = b?.locked ?? null;
    if (a?.hideFormula !== b?.hideFormula) hides[key] = b?.hideFormula ?? null;
  }
  const ops: SheetOp[] = [];
  if (sizes.length) ops.push({ type: "set_sizes", sheet, axis, sizes });
  const field = axis === "col" ? "columns" : "rows";
  if (Object.keys(locks).length) ops.push({ type: "set_locks", sheet, [field]: locks });
  if (Object.keys(hides).length) ops.push({ type: "set_hides", sheet, [field]: hides });
  return ops;
}

/** The operations that turn the fields of one sheet (not its cells' own sheet-level fields such as its name) into those of `to`. */
function sheetOps(a: Sheet, b: Sheet): SheetOp[] {
  const id = a.id;
  const ops: SheetOp[] = [];
  if (!deepEqual(a.cells, b.cells)) {
    const cells: Record<string, import("./model").Cell | null> = {};
    for (const key of keysOf(a.cells, b.cells)) if (!deepEqual(a.cells[key], b.cells[key])) cells[key] = b.cells[key] ?? null;
    ops.push({ type: "set_cells", sheet: id, cells });
  }
  if (!deepEqual(a.columns, b.columns)) ops.push(...dimensionOps(id, "col", a.columns, b.columns));
  if (!deepEqual(a.rows, b.rows)) ops.push(...dimensionOps(id, "row", a.rows, b.rows));
  if (!deepEqual(a.frozen, b.frozen)) ops.push({ type: "set_frozen", sheet: id, rows: b.frozen?.rows ?? 0, cols: b.frozen?.cols ?? 0 });
  if (!deepEqual(a.filter, b.filter)) ops.push({ type: "set_filter", sheet: id, filter: b.filter ?? null });
  if (!deepEqual(a.filterViews, b.filterViews)) ops.push({ type: "set_filter_views", sheet: id, views: b.filterViews ?? null });
  if (a.tabColor !== b.tabColor) ops.push({ type: "set_tab_color", sheet: id, color: b.tabColor ?? null });
  if (!!a.hidden !== !!b.hidden) ops.push({ type: "set_sheet_hidden", sheet: id, hidden: !!b.hidden });
  if (!deepEqual(a.merges, b.merges)) {
    const have = new Set(b.merges ?? []);
    const had = new Set(a.merges ?? []);
    for (const m of a.merges ?? []) if (!have.has(m)) ops.push({ type: "remove_merge", sheet: id, range: m });
    for (const m of b.merges ?? []) if (!had.has(m)) ops.push({ type: "add_merge", sheet: id, range: m });
  }
  if (!deepEqual(a.tables, b.tables)) {
    ops.push(...diffList(a.tables, b.tables, { add: (table, index) => ({ type: "add_table", sheet: id, table, index }), update: (table, at) => ({ type: "update_table", sheet: id, table, at }), delete: (tid, at) => ({ type: "delete_table", sheet: id, id: tid, at }) }));
  }
  if (!deepEqual(a.charts, b.charts)) ops.push(...diffList(a.charts, b.charts, { add: (chart, index) => ({ type: "add_chart", sheet: id, chart, index }), update: (chart, at) => ({ type: "update_chart", sheet: id, chart, at }), delete: (cid, at) => ({ type: "delete_chart", sheet: id, id: cid, at }) }));
  if (!deepEqual(a.images, b.images)) ops.push(...diffList(a.images, b.images, { add: (image, index) => ({ type: "add_image", sheet: id, image, index }), update: (image, at) => ({ type: "update_image", sheet: id, image, at }), delete: (iid, at) => ({ type: "delete_image", sheet: id, id: iid, at }) }));
  if (!deepEqual(a.slicers, b.slicers)) ops.push(...diffList(a.slicers, b.slicers, { add: (slicer, index) => ({ type: "add_slicer", sheet: id, slicer, index }), update: (slicer, at) => ({ type: "update_slicer", sheet: id, slicer, at }), delete: (sid, at) => ({ type: "delete_slicer", sheet: id, id: sid, at }) }));
  if (!deepEqual(a.timelines, b.timelines)) ops.push(...diffList(a.timelines, b.timelines, { add: (timeline, index) => ({ type: "add_timeline", sheet: id, timeline, index }), update: (timeline, at) => ({ type: "update_timeline", sheet: id, timeline, at }), delete: (tid, at) => ({ type: "delete_timeline", sheet: id, id: tid, at }) }));
  if (!deepEqual(a.sparklines, b.sparklines)) ops.push(...diffList(a.sparklines, b.sparklines, { add: (group, index) => ({ type: "add_sparklines", sheet: id, group, index }), update: (group, at) => ({ type: "update_sparklines", sheet: id, group, at }), delete: (gid, at) => ({ type: "delete_sparklines", sheet: id, id: gid, at }) }));
  if (!deepEqual(a.pivots, b.pivots)) ops.push(...diffList(a.pivots, b.pivots, { add: (pivot, index) => ({ type: "add_pivot", sheet: id, pivot, index }), update: (pivot, at) => ({ type: "update_pivot", sheet: id, pivot, at }), delete: (pid, at) => ({ type: "delete_pivot", sheet: id, id: pid, at }) }));
  if (!deepEqual(a.conditional, b.conditional)) ops.push(...diffList(a.conditional, b.conditional, { add: (rule, index) => ({ type: "add_rule", sheet: id, rule, index }), update: (rule, at) => ({ type: "update_rule", sheet: id, rule, at }), delete: (rid, at) => ({ type: "delete_rule", sheet: id, id: rid, at }) }));
  if (!deepEqual(a.validations, b.validations)) ops.push(...diffList(a.validations, b.validations, { add: (validation, index) => ({ type: "add_validation", sheet: id, validation, index }), update: (validation, at) => ({ type: "update_validation", sheet: id, validation, at }), delete: (vid, at) => ({ type: "delete_validation", sheet: id, id: vid, at }) }));
  if (!deepEqual(a.protection, b.protection)) ops.push({ type: "set_protection", sheet: id, protection: b.protection ?? null });
  if (!deepEqual(a.editRanges, b.editRanges)) ops.push({ type: "set_edit_ranges", sheet: id, ranges: b.editRanges ?? null });
  if (!!a.unlocked !== !!b.unlocked) ops.push({ type: "set_locks", sheet: id, unlocked: b.unlocked ? true : null });
  if (!!a.hiddenFormulas !== !!b.hiddenFormulas) ops.push({ type: "set_hides", sheet: id, hidden: b.hiddenFormulas ? true : null });
  if (!deepEqual(a.page, b.page)) ops.push({ type: "set_page", sheet: id, page: b.page ?? null });
  if (!deepEqual(a.outline, b.outline)) ops.push({ type: "set_outline", sheet: id, summaryAbove: !!b.outline?.summaryAbove, summaryLeft: !!b.outline?.summaryLeft });
  // Every field this function doesn't know is left to the check at the end.
  return ops;
}

function workbookOps(a: Workbook, b: Workbook): SheetOp[] {
  const ops: SheetOp[] = [];
  if (a.title !== b.title) ops.push({ type: "set_title", title: b.title });
  if (!deepEqual(a.names, b.names)) {
    for (const key of keysOf(a.names, b.names)) if (a.names?.[key] !== b.names?.[key]) ops.push({ type: "set_name", name: key, formula: b.names?.[key] ?? null });
  }
  for (const key of keysOf(a.tableStyles, b.tableStyles)) if (!deepEqual(a.tableStyles?.[key], b.tableStyles?.[key])) ops.push({ type: "set_table_style", name: key, style: b.tableStyles?.[key] ?? null });
  for (const key of keysOf(a.slicerStyles, b.slicerStyles)) if (!deepEqual(a.slicerStyles?.[key], b.slicerStyles?.[key])) ops.push({ type: "set_slicer_style", name: key, style: b.slicerStyles?.[key] ?? null });
  const book: Record<string, unknown> = {};
  if (!deepEqual(a.pivotStyles, b.pivotStyles)) book.pivotStyles = b.pivotStyles ?? null;
  if (!deepEqual(a.dataBlocks, b.dataBlocks)) book.dataBlocks = b.dataBlocks ?? null;
  if (!deepEqual(a.model, b.model)) book.model = b.model ?? null;
  if (Object.keys(book).length) ops.push({ type: "set_pivot_book", ...book } as SheetOp);
  if (!deepEqual(a.protection, b.protection)) ops.push({ type: "set_workbook_protection", protection: b.protection ?? null });
  if (!deepEqual(a.iteration, b.iteration)) ops.push({ type: "set_iteration", iteration: b.iteration ?? null });
  for (const key of keysOf(a.comments, b.comments)) if (!deepEqual(a.comments?.[key], b.comments?.[key])) ops.push({ type: "set_thread", id: key, thread: b.comments?.[key] ?? null });
  if (!deepEqual(a.externalBooks, b.externalBooks) || !deepEqual(a.themeColors, b.themeColors)) throw new Unsupported();
  return ops;
}

/** Applies operations one after the other. */
function run(wb: Workbook, ops: readonly SheetOp[]): Workbook {
  return ops.reduce((state, op) => applyOp(state, op), wb);
}

/**
 * The operations that turn `from` into `to`, or null when they can't be told in operations (a field no operation sets). It is
 * checked: applying them to `from` gives `to` exactly, or the answer is null.
 */
export function diffWorkbooks(from: Workbook, to: Workbook): SheetOp[] | null {
  try {
    const ops: SheetOp[] = [];
    let cur = from;
    const push = (list: SheetOp[]) => {
      cur = run(cur, list);
      ops.push(...list);
    };
    // Sheets that are gone, then the ones that come in (with everything they hold), then names and order.
    const toIds = new Set(to.sheets.map((s) => s.id));
    for (const s of from.sheets) if (!toIds.has(s.id)) push([{ type: "delete_sheet", id: s.id, name: s.name }]);
    to.sheets.forEach((s, index) => {
      if (!cur.sheets.some((x) => x.id === s.id)) push([{ type: "add_sheet", sheet: s, index }]);
    });
    for (const s of to.sheets) {
      const have = cur.sheets.find((x) => x.id === s.id)!;
      // A name that another sheet holds for the moment is let go of first.
      if (have.name !== s.name) push([{ type: "rename_sheet", id: s.id, name: s.name, from: have.name }]);
    }
    to.sheets.forEach((s, index) => {
      if (cur.sheets[index]!.id !== s.id) push([{ type: "move_sheet", id: s.id, index }]);
    });
    for (const s of to.sheets) {
      const have = cur.sheets.find((x) => x.id === s.id)!;
      const list = sheetOps(have, s);
      if (list.length) push(list);
    }
    const wbOps = workbookOps(cur, to);
    if (wbOps.length) push(wbOps);
    return deepEqual(cur, to) ? ops : null;
  } catch (error) {
    if (error instanceof Unsupported) return null;
    // An operation that would not apply (a name taken for the moment, say) is not a way back.
    return null;
  }
}
