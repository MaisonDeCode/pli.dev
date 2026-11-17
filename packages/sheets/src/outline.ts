import { PliError } from "@pli.dev/core";
import { colName, colNumber } from "./address";
import { MAX_COLS, MAX_ROWS, type Dimension, type Sheet } from "./model";
import type { SheetOp } from "./ops";

/*
 * Groups (an outline): rows or columns with a level, 1 to 7. Neighbours at one level or deeper make a group at that level,
 * which has a summary row or column next to it (below or to the right unless the sheet says otherwise) with the button that
 * collapses it. A collapsed group's rows and columns are hidden, and the summary says so (`collapsed`), as Excel keeps it.
 */

export const MAX_LEVEL = 7;
export type Axis = "row" | "col";

export interface Group {
  axis: Axis;
  /** How deep it is, 1 to 7. */
  level: number;
  from: number;
  to: number;
  /** The row or column that sums it up, or 0 when it would be off the edge of the sheet. */
  summary: number;
  collapsed: boolean;
}

const maxIndex = (axis: Axis) => (axis === "row" ? MAX_ROWS : MAX_COLS);
const key = (axis: Axis, i: number) => (axis === "row" ? String(i) : colName(i));
const indexOf = (axis: Axis, k: string) => (axis === "row" ? Number(k) : colNumber(k));

/** A copy of a sheet's rows or columns, to change and then compare. */
export const dimsOf = (sheet: Sheet, axis: Axis): Record<string, Dimension> => structuredClone(axis === "row" ? sheet.rows ?? {} : sheet.columns ?? {});

export const levelsOf = (dims: Record<string, Dimension>, axis: Axis): Map<number, number> => {
  const out = new Map<number, number>();
  for (const [k, d] of Object.entries(dims)) if (d.level) out.set(indexOf(axis, k), d.level);
  return out;
};

/** Whether summaries are above (rows) or left (columns) of their groups. */
export const summaryBefore = (sheet: Sheet, axis: Axis): boolean => (axis === "row" ? !!sheet.outline?.summaryAbove : !!sheet.outline?.summaryLeft);

/** The groups in a set of dimensions, shallow ones first. */
export function groupsIn(dims: Record<string, Dimension>, axis: Axis, before: boolean): Group[] {
  const levels = levelsOf(dims, axis);
  if (!levels.size) return [];
  const sorted = [...levels.keys()].sort((a, b) => a - b);
  const deepest = Math.max(...levels.values());
  const out: Group[] = [];
  for (let level = 1; level <= deepest; level++) {
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      const from = run[0]!;
      const to = run[run.length - 1]!;
      const summary = before ? from - 1 : to + 1;
      const valid = summary >= 1 && summary <= maxIndex(axis);
      out.push({ axis, level, from, to, summary: valid ? summary : 0, collapsed: valid && !!dims[key(axis, summary)]?.collapsed });
      run = [];
    };
    for (const i of sorted) {
      if ((levels.get(i) ?? 0) < level) {
        flush();
        continue;
      }
      if (run.length && i !== run[run.length - 1]! + 1) flush();
      run.push(i);
    }
    flush();
  }
  return out;
}

/** The groups of a sheet's rows or of its columns. */
export const groupsOf = (sheet: Sheet, axis: Axis): Group[] => groupsIn(axis === "row" ? sheet.rows ?? {} : sheet.columns ?? {}, axis, summaryBefore(sheet, axis));

/** The deepest level any row or column has. */
export const deepestLevel = (sheet: Sheet, axis: Axis): number => Math.max(0, ...Object.values(axis === "row" ? sheet.rows ?? {} : sheet.columns ?? {}).map((d) => d.level ?? 0));

/**
 * Makes the hidden and collapsed marks agree with the groups: a row or column is hidden when a group around it is collapsed
 * and shown when it isn't (and when it has left every group); a `collapsed` mark that belongs to no group goes.
 * `touched` are the indexes that had a level before this change as well as those that have one now.
 */
function settle(dims: Record<string, Dimension>, axis: Axis, before: boolean, touched: Iterable<number>): void {
  const groups = groupsIn(dims, axis, before);
  const summaries = new Set(groups.filter((g) => g.summary).map((g) => g.summary));
  for (const [k, d] of Object.entries(dims)) if (d.collapsed && !summaries.has(indexOf(axis, k))) delete d.collapsed;
  const levels = levelsOf(dims, axis);
  const collapsed = groups.filter((g) => g.collapsed);
  for (const i of touched) {
    const hide = collapsed.some((g) => i >= g.from && i <= g.to && (levels.get(i) ?? 0) >= g.level);
    const k = key(axis, i);
    const d = dims[k] ?? (dims[k] = {});
    if (hide) d.hidden = true;
    else delete d.hidden;
  }
  for (const [k, d] of Object.entries(dims)) if (!Object.keys(d).length) delete dims[k];
}

/** The operations that turn one set of dimensions into another, for the fields groups use (level, collapsed, hidden). */
export function outlineOps(sheet: Sheet, axis: Axis, next: Record<string, Dimension>): SheetOp[] {
  const old = axis === "row" ? sheet.rows ?? {} : sheet.columns ?? {};
  const ops: SheetOp[] = [];
  for (const k of new Set([...Object.keys(old), ...Object.keys(next)])) {
    const a = old[k];
    const b = next[k];
    if ((a?.level ?? 0) === (b?.level ?? 0) && !!a?.collapsed === !!b?.collapsed && !!a?.hidden === !!b?.hidden) continue;
    ops.push({ type: "set_size", sheet: sheet.id, axis, index: indexOf(axis, k), level: b?.level ?? null, collapsed: b?.collapsed ?? null, hidden: b?.hidden ?? null });
  }
  return ops;
}

/** The most rows or columns one change groups or ungroups. */
export const MAX_GROUP_SPAN = 10_000;

const check = (axis: Axis, from: number, to: number) => {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > maxIndex(axis)) throw new PliError("out_of_range", `Those aren't ${axis === "row" ? "rows" : "columns"} of the sheet`);
  if (to - from + 1 > MAX_GROUP_SPAN) throw new PliError("out_of_range", `Group up to ${MAX_GROUP_SPAN.toLocaleString("en-US")} ${axis === "row" ? "rows" : "columns"} at a time`);
};

/** Puts the rows or columns one level deeper. */
export function groupOps(sheet: Sheet, axis: Axis, from: number, to: number): SheetOp[] {
  check(axis, from, to);
  const dims = dimsOf(sheet, axis);
  const touched: number[] = [];
  for (let i = from; i <= to; i++) {
    const d = dims[key(axis, i)] ?? (dims[key(axis, i)] = {});
    if ((d.level ?? 0) >= MAX_LEVEL) throw new PliError("invalid_operation", `Groups can be ${MAX_LEVEL} deep`);
    d.level = (d.level ?? 0) + 1;
    touched.push(i);
  }
  settle(dims, axis, summaryBefore(sheet, axis), touched);
  return outlineOps(sheet, axis, dims);
}

/** Takes the rows or columns out of the deepest group they are in. */
export function ungroupOps(sheet: Sheet, axis: Axis, from: number, to: number): SheetOp[] {
  check(axis, from, to);
  const dims = dimsOf(sheet, axis);
  const touched: number[] = [];
  for (let i = from; i <= to; i++) {
    const d = dims[key(axis, i)];
    if (!d?.level) continue;
    touched.push(i);
    if (d.level > 1) d.level -= 1;
    else delete d.level;
  }
  settle(dims, axis, summaryBefore(sheet, axis), touched);
  return outlineOps(sheet, axis, dims);
}

/** Collapses or expands the group, hiding or showing its rows or columns. */
export function setCollapsedOps(sheet: Sheet, group: Group, collapsed: boolean): SheetOp[] {
  if (!group.summary) throw new PliError("invalid_operation", "That group has no row or column beside it to hold its button");
  const dims = dimsOf(sheet, group.axis);
  const k = key(group.axis, group.summary);
  const d = dims[k] ?? (dims[k] = {});
  if (collapsed) d.collapsed = true;
  else delete d.collapsed;
  const touched: number[] = [];
  for (let i = group.from; i <= group.to; i++) touched.push(i);
  settle(dims, group.axis, summaryBefore(sheet, group.axis), touched);
  return outlineOps(sheet, group.axis, dims);
}

/** Shows rows or columns down to a level and hides the detail below it (level 1 is the least; one more than the deepest shows everything). */
export function showLevelOps(sheet: Sheet, axis: Axis, level: number): SheetOp[] {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL + 1) throw new PliError("invalid_operation", `A level is 1 to ${MAX_LEVEL + 1}`);
  const dims = dimsOf(sheet, axis);
  const before = summaryBefore(sheet, axis);
  const groups = groupsIn(dims, axis, before);
  for (const g of groups) {
    if (!g.summary) continue;
    const k = key(axis, g.summary);
    const d = dims[k] ?? (dims[k] = {});
    if (g.level >= level) d.collapsed = true;
    else delete d.collapsed;
  }
  const touched = [...levelsOf(dims, axis).keys()];
  settle(dims, axis, before, touched);
  return outlineOps(sheet, axis, dims);
}
