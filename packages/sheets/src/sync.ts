import { changeThreadId, type SyncModel } from "@pli.dev/core";
import { parseCell, parseRange, cellAddress } from "./address";
import type { Cell, Workbook } from "./model";
import { transformListOp, type ListOp } from "./listot";
import { ghostApply, type SheetOp, type SizeChange } from "./ops";
import { normalizeRuns } from "./runs";
import { MAX_ROWS } from "./model";
import { dropSheetInOp, renameInOp, shiftOp, shiftSelectionRange, sheetOf, structOf, structOp, transformUnits, type Struct } from "./sync-shift";

/**
 * How operations on a workbook combine, for `SyncClient` and `createAuthority`:
 *
 *     const sync = new SyncClient({ session: sheets.session, room, model: sheetSyncModel });
 *     const authority = createAuthority({ store, model: sheetSyncModel });
 *
 * Sheets are named by id, so changes to different things never meet; the rules for the ones that do are in the Sheets
 * collaboration page. In short, and in the order the sequencer accepted the changes:
 *
 * - the same cell, size, object or setting: the later change wins, and the earlier one's value stays in its author's undo history;
 * - rows and columns put in or taken out shift every address, range, merge, table, rule, chart, picture, filter, print area,
 *   name and formula in the changes that were made at the same moment;
 * - a sheet that is deleted takes the changes made to it with it, and formulas that point at a sheet that is renamed or
 *   deleted follow;
 * - values of formulas are never sent: each side works them out from the merged cells.
 */

// ---- the fingerprint ----

/** The workbook as JSON with every object's keys in order, so two workbooks that are equal have the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      // The order of merged ranges means nothing, and two people merging at once can't be told which came first.
      .map(([k, v]): [string, unknown] => [k, k === "merges" && Array.isArray(v) ? [...v].sort() : v])
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short fingerprint of a workbook (FNV-1a over its canonical JSON, with its length). Equal workbooks have equal fingerprints. */
export function hashWorkbook(wb: Workbook): string {
  const text = canonical(wb);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}.${text.length.toString(36)}`;
}

// ---- flattening ----

/** The operations as a plain list: batches opened, and operations on many places of rows told one place at a time (the last one first, so each keeps its place). */
export function flattenOps(ops: readonly SheetOp[]): SheetOp[] {
  const out: SheetOp[] = [];
  for (const op of ops) {
    if (op.type === "batch") out.push(...flattenOps(op.ops));
    else if (op.type === "insert_row_runs" || op.type === "delete_row_runs") {
      const kind = op.type === "insert_row_runs" ? "insert" : "delete";
      const runs = normalizeRuns(kind, op.runs, MAX_ROWS);
      for (let i = runs.length - 1; i >= 0; i--) {
        const [at, count] = runs[i]!;
        out.push({ type: kind === "insert" ? "insert_rows" : "delete_rows", sheet: op.sheet, at, count, ...(op.name !== undefined ? { name: op.name } : {}) });
      }
    } else out.push(op);
  }
  return out;
}

// ---- how two operations meet ----

type Pair = [SheetOp[], SheetOp[]];

const lower = (s: string) => s.toLowerCase();
const SENT = "\u0000x";

/** The change of a list that an operation makes. */
interface ListSlot {
  key: string;
  kind: "add" | "delete";
  id: string;
  /** For an addition: the item it goes after (null for first). For a deletion: the item that was before it. */
  after?: string | null;
}

function listSlot(op: SheetOp): ListSlot | null {
  switch (op.type) {
    case "add_sheet": return { key: "sheets", kind: "add", id: op.sheet.id, after: op.after };
    case "delete_sheet": return { key: "sheets", kind: "delete", id: op.id, after: op.prev };
    case "add_chart": return { key: `${op.sheet}|charts`, kind: "add", id: op.chart.id, after: op.after };
    case "delete_chart": return { key: `${op.sheet}|charts`, kind: "delete", id: op.id, after: op.prev };
    case "add_rule": return { key: `${op.sheet}|conditional`, kind: "add", id: op.rule.id, after: op.after };
    case "delete_rule": return { key: `${op.sheet}|conditional`, kind: "delete", id: op.id, after: op.prev };
    case "add_table": return { key: `${op.sheet}|tables`, kind: "add", id: op.table.id, after: op.after };
    case "delete_table": return { key: `${op.sheet}|tables`, kind: "delete", id: op.id, after: op.prev };
    case "add_slicer": return { key: `${op.sheet}|slicers`, kind: "add", id: op.slicer.id, after: op.after };
    case "delete_slicer": return { key: `${op.sheet}|slicers`, kind: "delete", id: op.id, after: op.prev };
    case "add_timeline": return { key: `${op.sheet}|timelines`, kind: "add", id: op.timeline.id, after: op.after };
    case "delete_timeline": return { key: `${op.sheet}|timelines`, kind: "delete", id: op.id, after: op.prev };
    case "add_image": return { key: `${op.sheet}|images`, kind: "add", id: op.image.id, after: op.after };
    case "delete_image": return { key: `${op.sheet}|images`, kind: "delete", id: op.id, after: op.prev };
    case "add_validation": return { key: `${op.sheet}|validations`, kind: "add", id: op.validation.id, after: op.after };
    case "delete_validation": return { key: `${op.sheet}|validations`, kind: "delete", id: op.id, after: op.prev };
    case "add_sparklines": return { key: `${op.sheet}|sparklines`, kind: "add", id: op.group.id, after: op.after };
    case "delete_sparklines": return { key: `${op.sheet}|sparklines`, kind: "delete", id: op.id, after: op.prev };
    case "add_pivot": return { key: `${op.sheet}|pivots`, kind: "add", id: op.pivot.id, after: op.after };
    case "delete_pivot": return { key: `${op.sheet}|pivots`, kind: "delete", id: op.id, after: op.prev };
    default: return null;
  }
}

const withAfter = (op: SheetOp, after: string | null | undefined): SheetOp => ({ ...(op as object), after }) as SheetOp;

/** A change to a list of things, told in positions of the list as it was when the change was made. */
interface Ref {
  /** Which list: `sheets`, or `<sheet id>|charts` and so on. */
  key: string;
  /** The thing's id. */
  id: string;
  /** Put in at `i`, taken out of `i`, changed at `i` (the list stays as it is), or moved from `i` to `j`. */
  k: "ins" | "del" | "upd" | "mov";
  i: number;
  j?: number;
}

function refOf(op: SheetOp): Ref | null {
  const r = (key: string, id: string, k: Ref["k"], i: number | undefined, j?: number): Ref | null => (i === undefined ? null : { key, id, k, i, ...(j !== undefined ? { j } : {}) });
  switch (op.type) {
    case "add_sheet": return r("sheets", op.sheet.id, "ins", op.index);
    case "delete_sheet": return r("sheets", op.id, "del", op.at);
    case "move_sheet": return op.from === undefined ? null : r("sheets", op.id, "mov", op.from, op.index);
    case "add_chart": return r(`${op.sheet}|charts`, op.chart.id, "ins", op.index);
    case "delete_chart": return r(`${op.sheet}|charts`, op.id, "del", op.at);
    case "update_chart": return r(`${op.sheet}|charts`, op.chart.id, "upd", op.at);
    case "add_rule": return r(`${op.sheet}|conditional`, op.rule.id, "ins", op.index);
    case "delete_rule": return r(`${op.sheet}|conditional`, op.id, "del", op.at);
    case "update_rule": return r(`${op.sheet}|conditional`, op.rule.id, "upd", op.at);
    case "add_table": return r(`${op.sheet}|tables`, op.table.id, "ins", op.index);
    case "delete_table": return r(`${op.sheet}|tables`, op.id, "del", op.at);
    case "update_table": return r(`${op.sheet}|tables`, op.table.id, "upd", op.at);
    case "add_slicer": return r(`${op.sheet}|slicers`, op.slicer.id, "ins", op.index);
    case "delete_slicer": return r(`${op.sheet}|slicers`, op.id, "del", op.at);
    case "update_slicer": return r(`${op.sheet}|slicers`, op.slicer.id, "upd", op.at);
    case "add_timeline": return r(`${op.sheet}|timelines`, op.timeline.id, "ins", op.index);
    case "delete_timeline": return r(`${op.sheet}|timelines`, op.id, "del", op.at);
    case "update_timeline": return r(`${op.sheet}|timelines`, op.timeline.id, "upd", op.at);
    case "add_image": return r(`${op.sheet}|images`, op.image.id, "ins", op.index);
    case "delete_image": return r(`${op.sheet}|images`, op.id, "del", op.at);
    case "update_image": return r(`${op.sheet}|images`, op.image.id, "upd", op.at);
    case "add_validation": return r(`${op.sheet}|validations`, op.validation.id, "ins", op.index);
    case "delete_validation": return r(`${op.sheet}|validations`, op.id, "del", op.at);
    case "update_validation": return r(`${op.sheet}|validations`, op.validation.id, "upd", op.at);
    case "add_sparklines": return r(`${op.sheet}|sparklines`, op.group.id, "ins", op.index);
    case "delete_sparklines": return r(`${op.sheet}|sparklines`, op.id, "del", op.at);
    case "update_sparklines": return r(`${op.sheet}|sparklines`, op.group.id, "upd", op.at);
    case "add_pivot": return r(`${op.sheet}|pivots`, op.pivot.id, "ins", op.index);
    case "delete_pivot": return r(`${op.sheet}|pivots`, op.id, "del", op.at);
    case "update_pivot": return r(`${op.sheet}|pivots`, op.pivot.id, "upd", op.at);
    default: return null;
  }
}

/** The operation with its place in the list changed. */
function withRef(op: SheetOp, ref: Ref): SheetOp {
  const o = { ...(op as object) } as Record<string, unknown>;
  if (ref.k === "ins") o.index = ref.i;
  else if (ref.k === "mov") {
    o.from = ref.i;
    o.index = ref.j;
  } else o.at = ref.i;
  delete o.after;
  return o as unknown as SheetOp;
}

const toListOp = (r: Ref): ListOp => (r.k === "ins" ? { k: "ins", i: r.i, x: r.id } : r.k === "del" ? { k: "del", i: r.i, x: r.id } : { k: "mov", i: r.i, j: r.j!, x: r.id });
const fromListOp = (o: ListOp, key: string): Ref => (o.k === "mov" ? { key, id: o.x, k: "mov", i: o.i, j: o.j } : { key, id: o.x, k: o.k, i: o.i });

/** Two changes to the same list of things (see `listot.ts`): each is moved past the other so that both orders give the same list. */
function listPair(l: SheetOp, e: SheetOp): Pair | null {
  const a = refOf(l);
  const b = refOf(e);
  if (!a || !b || a.key !== b.key) return null;
  if (a.k !== "upd" && b.k !== "upd") {
    const [l2, e2] = transformListOp(toListOp(a), toListOp(b));
    return [l2.map((o) => withRef(l, fromListOp(o, a.key))), e2.map((o) => withRef(e, fromListOp(o, a.key)))];
  }
  if (a.k === "upd" && b.k === "upd") return a.id === b.id ? [[l], []] : null;
  if (a.k === "upd") {
    // `l` changes one thing in the list while `e` puts one in or takes one out.
    if (b.k === "ins") return [[withRef(l, { ...a, i: b.i <= a.i ? a.i + 1 : a.i })], [e]];
    if (b.id === a.id) return [[], [e]];
    return [[withRef(l, { ...a, i: b.i < a.i ? a.i - 1 : a.i })], [e]];
  }
  if (a.k === "ins") return [[l], [withRef(e, { ...b, i: a.i <= b.i ? b.i + 1 : b.i })]];
  if (a.id === b.id) return [[l], []];
  return [[l], [withRef(e, { ...b, i: a.i < b.i ? b.i - 1 : b.i })]];
}

/** An object (chart, rule, picture…) that an operation adds, changes or removes, by id, and what it does to it. */
function objectOf(op: SheetOp): { key: string; act: "add" | "update" | "delete" } | null {
  const l = listSlot(op);
  if (l) return { key: `${l.key}|${l.id}`, act: l.kind };
  switch (op.type) {
    case "update_chart": return { key: `${op.sheet}|charts|${op.chart.id}`, act: "update" };
    case "update_rule": return { key: `${op.sheet}|conditional|${op.rule.id}`, act: "update" };
    case "update_table": return { key: `${op.sheet}|tables|${op.table.id}`, act: "update" };
    case "update_slicer": return { key: `${op.sheet}|slicers|${op.slicer.id}`, act: "update" };
    case "update_timeline": return { key: `${op.sheet}|timelines|${op.timeline.id}`, act: "update" };
    case "update_image": return { key: `${op.sheet}|images|${op.image.id}`, act: "update" };
    case "update_validation": return { key: `${op.sheet}|validations|${op.validation.id}`, act: "update" };
    case "update_sparklines": return { key: `${op.sheet}|sparklines|${op.group.id}`, act: "update" };
    case "update_pivot": return { key: `${op.sheet}|pivots|${op.pivot.id}`, act: "update" };
    default: return null;
  }
}

/** Settings that an operation replaces whole, named by what they are. */
function settingOf(op: SheetOp): string | null {
  switch (op.type) {
    case "set_frozen": return `${op.sheet}|frozen`;
    case "set_filter": return `${op.sheet}|filter`;
    case "set_filter_views": return `${op.sheet}|filterViews`;
    case "set_tab_color": return `${op.sheet}|tabColor`;
    case "set_sheet_hidden": return `${op.sheet}|hidden`;
    case "set_page": return `${op.sheet}|page`;
    case "set_protection": return `${op.sheet}|protection`;
    case "set_edit_ranges": return `${op.sheet}|editRanges`;
    case "set_title": return "title";
    case "set_name": return `name|${lower(op.name)}`;
    case "set_table_style": return `tableStyle|${lower(op.name)}`;
    case "set_slicer_style": return `slicerStyle|${lower(op.name)}`;
    case "set_workbook_protection": return "workbookProtection";
    case "set_iteration": return "iteration";
    case "set_thread": return `thread|${op.id}`;
    default: return null;
  }
}

const cleared = <T extends object>(o: T, keys: (keyof T)[]): T => {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
};

/** What is left of `e` when `l`, made after it, has written what it writes (the same address, field or setting). */
function leftOf(e: SheetOp, l: SheetOp): SheetOp[] {
  switch (e.type) {
    case "set_cells": {
      if (l.type !== "set_cells" || l.sheet !== e.sheet) return [e];
      const mine = new Set(Object.keys(l.cells).map((a) => (parseCell(a) ? cellAddress(parseCell(a)!.row, parseCell(a)!.col) : a)));
      const cells: Record<string, Cell | null> = {};
      for (const [a, c] of Object.entries(e.cells)) {
        const p = parseCell(a);
        if (!mine.has(p ? cellAddress(p.row, p.col) : a)) cells[a] = c;
      }
      return Object.keys(cells).length ? [{ ...e, cells }] : [];
    }
    case "set_size":
    case "set_sizes": {
      if ((l.type !== "set_size" && l.type !== "set_sizes") || l.sheet !== e.sheet || l.axis !== e.axis) return [e];
      const theirs = new Map<number, SizeChange>();
      for (const c of l.type === "set_size" ? [l as unknown as SizeChange] : l.sizes) theirs.set(c.index, { ...theirs.get(c.index), ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) } as SizeChange);
      const rest = (e.type === "set_size" ? [e as unknown as SizeChange] : e.sizes).flatMap((c) => {
        const w = theirs.get(c.index);
        if (!w) return [c];
        const next: SizeChange = { index: c.index };
        for (const k of ["size", "hidden", "level", "collapsed"] as const) if (c[k] !== undefined && w[k] === undefined) (next as unknown as Record<string, unknown>)[k] = c[k];
        return Object.keys(next).length > 1 ? [next] : [];
      });
      if (!rest.length) return [];
      return e.type === "set_size" ? [{ type: "set_size", sheet: e.sheet, axis: e.axis, ...rest[0]! } as SheetOp] : [{ ...e, sizes: rest }];
    }
    case "set_locks":
    case "set_hides": {
      if (l.type !== e.type || l.sheet !== e.sheet) return [e];
      const out = { ...e } as Record<string, unknown>;
      for (const field of e.type === "set_locks" ? (["unlocked", "columns", "rows"] as const) : (["hidden", "columns", "rows"] as const)) {
        const theirs = (l as unknown as Record<string, unknown>)[field];
        if (theirs === undefined) continue;
        if (field === "columns" || field === "rows") {
          const mine = (e as unknown as Record<string, Record<string, unknown> | undefined>)[field];
          if (!mine) continue;
          const kept = Object.fromEntries(Object.entries(mine).filter(([k]) => !(k in (theirs as object))));
          if (Object.keys(kept).length) out[field] = kept;
          else delete out[field];
        } else delete out[field];
      }
      return Object.keys(out).some((k) => k !== "type" && k !== "sheet") ? [out as unknown as SheetOp] : [];
    }
    case "set_outline": {
      if (l.type !== "set_outline" || l.sheet !== e.sheet) return [e];
      const out = cleared(e, [...(l.summaryAbove !== undefined ? (["summaryAbove"] as const) : []), ...(l.summaryLeft !== undefined ? (["summaryLeft"] as const) : [])]);
      return out.summaryAbove !== undefined || out.summaryLeft !== undefined ? [out] : [];
    }
    case "set_pivot_book": {
      if (l.type !== "set_pivot_book") return [e];
      const out = { ...e } as Record<string, unknown>;
      for (const k of ["pivotStyles", "dataBlocks", "model"]) if (k in l) delete out[k];
      return Object.keys(out).length > 1 ? [out as unknown as SheetOp] : [];
    }
    case "set_external_cells": {
      if (l.type !== "set_external_cells" || lower(l.book) !== lower(e.book) || lower(l.sheet) !== lower(e.sheet)) return [e];
      const mine = new Set(Object.keys(l.cells).map((a) => a.toUpperCase()));
      const cells = Object.fromEntries(Object.entries(e.cells).filter(([a]) => !mine.has(a.toUpperCase())));
      const out = { ...e, cells } as SheetOp & { path?: unknown; read?: unknown; tables?: unknown };
      for (const k of ["path", "read", "tables"] as const) if (k in l && (l as unknown as Record<string, unknown>)[k] !== undefined) delete out[k];
      return Object.keys(cells).length || out.path !== undefined || out.read !== undefined || out.tables !== undefined ? [out] : [];
    }
    default:
      return [e];
  }
}

const afterDelete = (o: SheetOp, del: Extract<SheetOp, { type: "delete_sheet" }>): SheetOp[] => {
  if (sheetOf(o) === del.id) return [];
  return [del.name === undefined ? o : dropSheetInOp(o, SENT, del.name)];
};

const afterRename = (o: SheetOp, ren: Extract<SheetOp, { type: "rename_sheet" }>): SheetOp[] => [ren.from === undefined ? o : renameInOp(o, SENT, ren.from, ren.name)];

const nameOfOp = (op: SheetOp): string | undefined => (op.type === "add_sheet" ? op.sheet.name : op.type === "rename_sheet" ? op.name : undefined);
const sheetOfOp = (op: SheetOp): string | undefined => (op.type === "add_sheet" ? op.sheet.id : op.type === "rename_sheet" ? op.id : undefined);

/**
 * Two sheets given the same name at the same moment (a rename or a new sheet, either way round): the later one in the order the
 * server accepted them keeps its name with ` (2)` added, on every client, and everything that points at it follows (formulas in
 * the later change and the changes after it; on the other side, the rename that is added to this change does the same).
 */
function sameNamePair(l: SheetOp, e: SheetOp): Pair | null {
  const nl = nameOfOp(l);
  const ne = nameOfOp(e);
  const id = sheetOfOp(l);
  if (nl === undefined || ne === undefined || id === undefined || id === sheetOfOp(e) || lower(nl) !== lower(ne)) return null;
  const unique = `${nl} (2)`;
  // Two new sheets also want the same place among the tabs: that is settled first.
  const [mine, theirs] = listPair(l, e) ?? [[l], [e]];
  const named = mine.map((op): SheetOp => {
    const renamed = renameInOp(op, SENT, nl, unique);
    return renamed.type === "add_sheet" ? { ...renamed, sheet: { ...renamed.sheet, name: unique } } : renamed.type === "rename_sheet" ? { ...renamed, name: unique } : renamed;
  });
  return [named, [{ type: "rename_sheet", id, name: unique, from: nl }, ...theirs]];
}

/** Sheets that are added, deleted and renamed, and the changes that were made to them. */
function sheetPair(l: SheetOp, e: SheetOp): Pair | null {
  if (e.type === "delete_sheet") {
    if (l.type === "delete_sheet" && l.id === e.id) return [[], []];
    // Tabs added or deleted at the same moment: the places in the row of tabs shift (see `listPair`).
    const placed = l.type === "add_sheet" || l.type === "delete_sheet" || l.type === "move_sheet" ? listPair(l, e) : null;
    // The sheet may have been renamed by `l` (which then goes): what is left of the deletion says what it is called now.
    const kept = l.type === "rename_sheet" && l.id === e.id ? { ...e, name: l.name } : e;
    return [(placed ? placed[0] : [l]).flatMap((o) => afterDelete(o, e)), placed ? placed[1] : [kept]];
  }
  if (l.type === "delete_sheet") {
    const placed = e.type === "add_sheet" || e.type === "move_sheet" ? listPair(l, e) : null;
    const mine: SheetOp[] = placed ? placed[0] : [e.type === "rename_sheet" && e.id === l.id ? { ...l, name: e.name } : l];
    return [mine, (placed ? placed[1] : [e]).flatMap((o) => afterDelete(o, l))];
  }
  const same = sameNamePair(l, e);
  if (same) return same;
  if (e.type === "rename_sheet") {
    if (l.type === "rename_sheet" && l.id === e.id) return [[{ ...l, from: e.name }], []];
    return [afterRename(l, e), [e]];
  }
  if (l.type === "rename_sheet") return [[l], afterRename(e, l)];
  return null;
}

/** An operation on rows or columns meeting another on the same sheet and axis. */
function structPair(a: Struct, b: Struct): Pair {
  const [lu, eu] = transformUnits({ kind: a.kind, at: a.at, count: a.count }, { kind: b.kind, at: b.at, count: b.count });
  const wrap = (units: typeof lu, s: Struct) => units.map((u) => structOp({ ...s, ...u }));
  return [wrap(lu, a), wrap(eu, b)];
}

/** An operation on rows or columns meeting any other. */
function shiftPair(l: SheetOp, e: SheetOp): Pair | null {
  const sl = structOf(l);
  const se = structOf(e);
  if (sl && se) {
    if (sl.sheet !== se.sheet || sl.axis !== se.axis) {
      // Different sheets or the other axis: the changes don't move each other, but the formulas that point across do.
      if (sl.sheet !== se.sheet) return null;
      return [[l], [e]];
    }
    return structPair(sl, se);
  }
  if (se) {
    const shifted = shiftOp(l, se);
    return [shifted.ops, [...(shifted.before ?? []), e]];
  }
  if (sl) {
    const shifted = shiftOp(e, sl);
    return [[...(shifted.before ?? []), l], shifted.ops];
  }
  return null;
}

/** Comment changes meet like thread changes do: nearly all of them commute; the same thread's resolution or the same comment's text goes to the later one. */
function commentKey(op: SheetOp): string | null {
  if (op.type !== "comment") return null;
  const c = op.change;
  switch (c.type) {
    case "thread.resolve":
    case "thread.reopen": return `${c.threadId}|resolved`;
    case "comment.edit": return `${c.threadId}|edit|${c.commentId}`;
    default: return null;
  }
}

function commentPair(l: SheetOp, e: SheetOp): Pair | null {
  if (l.type === "set_thread" && e.type === "comment") return l.id === changeThreadId(e.change) ? [[l], []] : null;
  if (l.type === "comment" && e.type === "set_thread") {
    return changeThreadId(l.change) === e.id ? [[l], [e, l]] : null;
  }
  const kl = commentKey(l);
  const ke = commentKey(e);
  if (kl && ke && kl === ke) return [[l], []];
  return null;
}

/** Two merges made at the same moment that overlap: the later one is left out, and the earlier one takes the place on the other side. */
function mergePair(l: SheetOp, e: SheetOp): Pair | null {
  // The same merge taken apart by both: it is gone on either side.
  if (l.type === "remove_merge" && e.type === "remove_merge" && l.sheet === e.sheet && l.range === e.range) return [[], []];
  if (l.type !== "add_merge" || e.type !== "add_merge" || l.sheet !== e.sheet) return null;
  const a = parseRange(l.range);
  const b = parseRange(e.range);
  if (!a || !b || a.r1 > b.r2 || b.r1 > a.r2 || a.c1 > b.c2 || b.c1 > a.c2) return null;
  return [[], [{ type: "remove_merge", sheet: l.sheet, range: l.range, soft: true }, e]];
}

/** Objects and lists of objects. */
function objectPair(l: SheetOp, e: SheetOp): Pair | null {
  const ol = objectOf(l);
  const oe = objectOf(e);
  if (ol && oe && ol.key === oe.key) {
    if (oe.act === "delete") return ol.act === "delete" ? [[], []] : [[], [e]];
    if (ol.act === "delete") return [[l], []];
    // The same object added by both (each took back the deletion of it, say): the later one's version stands, in the place the earlier one put it.
    if (ol.act === "add" && oe.act === "add" && l.type.startsWith("add_") && l.type !== "add_sheet") {
      const here = refOf(l);
      const there = refOf(e);
      const { index: _i, after: _a, ...rest } = l as unknown as Record<string, unknown>;
      const update = { ...rest, type: l.type.replace("add_", "update_"), ...(there ? { at: there.i } : {}) } as unknown as SheetOp;
      // The copy that already has the later one's version (its own) moves to the place the earlier one put it: taken out where it is, and put in there.
      if (!here || !there) return [[update], []];
      const out = { type: l.type.replace("add_", "delete_"), sheet: (l as { sheet: string }).sheet, id: here.id, at: here.i, soft: true } as unknown as SheetOp;
      return [[update], [out, { ...l, index: there.i, ...("after" in l ? { after: undefined } : {}) } as SheetOp]];
    }
    // An object changed at the same moment: the later one stands.
    return [[l], []];
  }
  return listPair(l, e);
}

/** Two operations made from the same workbook, `l` after `e` in the history: `l` as it applies after `e`, and `e` as it applies after `l`. */
function pair(l: SheetOp, e: SheetOp): Pair {
  if (e.type === "restore") return [[], [e]];
  if (l.type === "restore") return [[l], []];
  const sheets = sheetPair(l, e);
  if (sheets) return sheets;
  const shifted = shiftPair(l, e);
  if (shifted) return shifted;
  const comments = commentPair(l, e);
  if (comments) return comments;
  const merges = mergePair(l, e);
  if (merges) return merges;
  const objects = objectPair(l, e);
  if (objects) return objects;
  const sl = settingOf(l);
  if (sl && sl === settingOf(e)) return [[l], []];
  // A name's formula can point at a sheet that another change renames or removes: handled with the sheets above.
  return [[l], leftOf(e, l)];
}

/** Changes up to the first restore of an earlier version, which puts back every sheet there was: what follows it is not about the workbook the change was made on. */
function beforeRestore(ops: SheetOp[], fn: (o: SheetOp) => SheetOp): SheetOp[] {
  const at = ops.findIndex((o) => o.type === "restore");
  return at < 0 ? ops.map(fn) : [...ops.slice(0, at).map(fn), ...ops.slice(at)];
}

/** Two lists of operations that follow each other, each as it must be applied after the other. */
function cross(l: SheetOp[], e: SheetOp[]): Pair {
  if (l.length === 0 || e.length === 0) return [l, e];
  if (l.length === 1 && e.length === 1) return pair(l[0]!, e[0]!);
  if (l.length > 1) {
    const [first, afterFirst] = cross([l[0]!], e);
    let tail = l.slice(1);
    // A sheet renamed and then deleted by someone else: what follows in the same change that names it by its new name names a sheet that is gone.
    const head = l[0]!;
    if (head.type === "rename_sheet" && first.length === 0 && e.some((x) => x.type === "delete_sheet" && x.id === head.id)) tail = beforeRestore(tail, (o) => dropSheetInOp(o, SENT, head.name));
    const [rest, after] = cross(tail, afterFirst);
    return [[...first, ...rest], after];
  }
  const [mine, first] = cross(l, [e[0]!]);
  let tail = e.slice(1);
  const head = e[0]!;
  if (head.type === "rename_sheet" && first.length === 0 && l.some((x) => x.type === "delete_sheet" && x.id === head.id)) tail = beforeRestore(tail, (o) => dropSheetInOp(o, SENT, head.name));
  const [mine2, rest] = cross(mine, tail);
  return [mine2, [...first, ...rest]];
}

/** Transforms two lists of operations made from the same workbook: `earlier` was accepted first. */
export function transformSheetOps(later: readonly SheetOp[], earlier: readonly SheetOp[]): [SheetOp[], SheetOp[]] {
  const l = flattenOps(later);
  const e = flattenOps(earlier);
  const [l2, e2] = cross(l, e);
  return [l2, e2];
}

export const sheetSyncModel: SyncModel<Workbook, SheetOp> = {
  apply: ghostApply,
  transform: transformSheetOps,
  hash: hashWorkbook,
  mapPresence: (state, ops) => mapSheetPresence(state, ops),
};

/** What a person has shared about themselves: the sheet they are on, their selection, the cell they are typing in. */
export interface SheetPresence {
  /** The id of the sheet shown. */
  sheet: string | null;
  selection: { active: string; ranges: string[] } | null;
  /** The cell being typed in, if any. */
  editing: string | null;
}

/** Moves a person's shared selection and editing cell through changes made to the sheet, so they stay on their cells. */
export function mapSheetPresence(state: Record<string, unknown>, ops: readonly SheetOp[]): Record<string, unknown> {
  const sheet = typeof state.sheet === "string" ? state.sheet : null;
  if (!sheet) return state;
  let next = state;
  for (const op of flattenOps(ops)) {
    if (op.type === "delete_sheet" && op.id === sheet) return { ...next, sheet: null, selection: null, editing: null };
    const s = structOf(op);
    if (!s || s.sheet !== sheet) continue;
    const move = (address: string): string => {
      const range = shiftSelectionRange(address, s);
      return range ? range.split(":")[0]! : address;
    };
    const sel = next.selection as { active: string; ranges: string[] } | null | undefined;
    const selection = sel ? { active: move(sel.active), ranges: sel.ranges.map((r) => shiftSelectionRange(r, s) ?? r) } : sel;
    const editing = typeof next.editing === "string" ? move(next.editing) : next.editing;
    next = { ...next, selection, editing };
  }
  return next;
}
