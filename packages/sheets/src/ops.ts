import { PliError, applyCommentChange, changeThreadId, type CommentChange, type Reducer, type Thread } from "@pli.dev/core";
import { cellAddress, colName, colNumber, parseCell, parseRange, rangeAddress } from "./address";
import { parseFormula, FormulaSyntaxError } from "./formula";
import { cleanLink, cleanNote, isPlace, renameLinkPlace } from "./link";
import { cleanNoteExtras } from "./note";
import { MAX_COLS, MAX_ROWS, emptyCell, type Cell, type Chart, type ConditionalRule, type Dimension, type FilterCriterion, type PageSetup, type Pivot, type Sheet, type SheetFilter, type SheetImage, type SheetProtection, type Slicer, type SparklineGroup, type Table, type TableStyleDef, type Validation, type Workbook, type CellAnchor, type WorkbookProtection, type IterationSettings, type FilterView, type Timeline, type SlicerStyleDef } from "./model";
import { cleanChart, mapChartRefs } from "./chart";
import { checkTable, dataRows, findTable, freshColumnName, hasHeader, tableColumns } from "./table";
import { checkSlicer, isOrphanPanel } from "./slicer";
import { checkTimeline } from "./timeline";
import { cleanCellPicture, cleanImage, refitImages, shiftImage } from "./image";
import { cleanIteration } from "./iteration";
import { applyExternalCells, type ExternalCellsOp } from "./external-sheets";
import { cleanEditRanges, cleanSheetProtection, cleanWorkbookProtection } from "./protect";
import { applyLocks, inheritLock, locksOf } from "./locks";
import { applyHides, hidesOf, inheritHide, validColumn } from "./hide";
import type { EditRange } from "./model";
import { cleanPageSetup } from "./page";
import { cleanSparklines } from "./sparkline";
import { cleanPivot } from "./pivot";
import { cleanCriterion } from "./filter";
import { cleanFilterViews, moveFilterViews, pruneViewTables } from "./filterview";
import { cleanTableStyle, cleanTableStyleName } from "./tablestyle";
import { cleanSlicerStyle, cleanSlicerStyleName } from "./slicerstyle";
import { cleanSortLevel, mapSortColumns, sortLevels, tableSortOf } from "./sortlevels";
import { applyPivotBook, type PivotBookPatch } from "./pivot-book";
import { cleanValidation, mapValidationFormulas } from "./validation";
import { cleanBorders, cleanMerge, cleanRule, mapRuleFormulas, mergedRanges, overlaps } from "./rule";
import { checkAgainstControl } from "./control";
import { adjustFormula, dropSheetFromFormula, renameSheetInFormula, shiftFormula, type Structure } from "./refs";
import { normalizeRuns, runMap, type Run } from "./runs";
import { diffWorkbooks } from "./ops-diff";
import { sharing, whileSharing } from "./ghosts";
import { stampOps } from "./ops-stamp";

/** One row's or column's change in a `set_sizes`, with the fields of `set_size`. */
export interface SizeChange {
  index: number;
  size?: number | null;
  hidden?: boolean | null;
  level?: number | null;
  collapsed?: boolean | null;
}

/** A dimension with a size change applied. */
function mergeSize(old: Dimension | undefined, op: SizeChange): Dimension {
  if (op.size != null && !(op.size >= 0 && Number.isFinite(op.size))) throw new PliError("invalid_operation", "A size must be 0 or more");
  const merged: Dimension = { ...old };
  if (op.size !== undefined) (op.size === null ? delete merged.size : (merged.size = op.size));
  if (op.hidden !== undefined) (op.hidden === null || op.hidden === false ? delete merged.hidden : (merged.hidden = true));
  if (op.level != null && !(Number.isInteger(op.level) && op.level >= 0 && op.level <= 7)) throw new PliError("invalid_operation", "A group level is 0 to 7");
  if (op.level !== undefined) (op.level === null || op.level === 0 ? delete merged.level : (merged.level = op.level));
  if (op.collapsed !== undefined) (op.collapsed === null || op.collapsed === false ? delete merged.collapsed : (merged.collapsed = true));
  return merged;
}

/**
 * Every change to a workbook is one of these JSON operations. They are invertible, so history works, and
 * serializable, so they can be logged or sent.
 */
export type SheetOp = SheetOpKind & {
  /** Set by merged changes: when what the operation names is gone, do nothing (`true`), or, for an update, put the thing back as the update has it (`"upsert"`). */
  soft?: true | "upsert";
};

type SheetOpKind =
  /** Puts these cells in place of whatever is at their addresses; `null` empties a cell. Sheets are named by id. */
  | { type: "set_cells"; sheet: string; cells: Record<string, Cell | null> }
  | { type: "add_sheet"; sheet: Sheet; index?: number; /** The sheet it goes after (null for first), as for the other lists. */ after?: string | null }
  /** `name` is the sheet's name when the operation was made: it says what formulas elsewhere pointed at (filled in by `SheetSession`, and by inverses). */
  | { type: "delete_sheet"; id: string; name?: string; /** The sheet before it (null for none). */ prev?: string | null; /** Its place among the tabs (filled in like `name`). */ at?: number }
  /** `from` is the name the sheet had, so merged changes can follow a sheet that was renamed (filled in by `SheetSession`). */
  | { type: "rename_sheet"; id: string; name: string; from?: string }
  | { type: "move_sheet"; id: string; index: number; /** The place it moved from (filled in like `order`). */ from?: number; /** The ids of the sheets in order before the move (filled in like `name`): merged changes work out where everything ends up from it. */ order?: string[] }
  /** Puts the sheets in this order (ids not listed follow, in the order they have). What merged changes use when two people move tabs at the same moment. */
  | { type: "set_sheet_order"; order: string[] }
  /** Rows or columns from `at` (1-based). Formulas that point at them follow. Deleted cells go, and references to them become `#REF!`. */
  | { type: "insert_rows" | "delete_rows" | "insert_cols" | "delete_cols"; sheet: string; at: number; count: number; /** The sheet's name (see `delete_sheet`). */ name?: string }
  /**
   * Many places at once, as one operation (rows are shifted once, not once per place). Each run is `[at, count]` in the rows as they
   * are before the operation. Inserted rows take the lock and hiding of the row before them, as `insert_rows` does.
   */
  | { type: "insert_row_runs" | "delete_row_runs"; sheet: string; runs: [number, number][]; name?: string }
  /** Sets a column width or row height, or hides it. A field set to `null` is removed. */
  | { type: "set_size"; sheet: string; axis: "col" | "row"; index: number; size?: number | null; hidden?: boolean | null; level?: number | null; collapsed?: boolean | null }
  /** Several `set_size` at once on one axis (one pass over the sheet, applied in order). */
  | { type: "set_sizes"; sheet: string; axis: "col" | "row"; sizes: SizeChange[] }
  | { type: "set_frozen"; sheet: string; rows: number; cols: number }
  /** Sets the filter on a sheet, or removes it with `null`. Hiding and showing the rows is a separate `set_size`. */
  | { type: "set_filter"; sheet: string; filter: SheetFilter | null }
  /** Replaces the sheet's saved filter views (see `FilterView`), or removes them all with `null`. */
  | { type: "set_filter_views"; sheet: string; views: FilterView[] | null }
  | { type: "set_tab_color"; sheet: string; color: string | null }
  /** Hides a sheet's tab, or shows it again. At least one sheet stays shown. */
  | { type: "set_sheet_hidden"; sheet: string; hidden: boolean }
  /** Puts a chart on a sheet (at `index` among the charts, the top by default). */
  | { type: "add_chart"; sheet: string; chart: Chart; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the chart that has the same id. */
  | { type: "update_chart"; sheet: string; chart: Chart; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_chart"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Merges a range of two or more cells, which may not overlap another merged range. */
  | { type: "add_merge"; sheet: string; range: string }
  /** Unmerges the range that was merged as exactly this. */
  | { type: "remove_merge"; sheet: string; range: string }
  /** Adds a conditional format (at `index` among the rules; the last, with the least say, by default). */
  | { type: "add_rule"; sheet: string; rule: ConditionalRule; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the conditional format that has the same id. */
  | { type: "update_rule"; sheet: string; rule: ConditionalRule; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_rule"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Adds a table over a range whose header cells hold its column names. */
  | { type: "add_table"; sheet: string; table: Table; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the table that has the same id. */
  | { type: "update_table"; sheet: string; table: Table; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_table"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Puts a slicer on a sheet (at `index` among the slicers, the top by default). */
  | { type: "add_slicer"; sheet: string; slicer: Slicer; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the slicer that has the same id. */
  | { type: "update_slicer"; sheet: string; slicer: Slicer; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_slicer"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Puts a timeline on a sheet (at `index` among the timelines, the top by default). */
  | { type: "add_timeline"; sheet: string; timeline: Timeline; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the timeline that has the same id. */
  | { type: "update_timeline"; sheet: string; timeline: Timeline; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_timeline"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Puts a picture on a sheet (at `index` among the pictures, the top by default). */
  | { type: "add_image"; sheet: string; image: SheetImage; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the picture that has the same id. */
  | { type: "update_image"; sheet: string; image: SheetImage; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_image"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Defines a table style of your own (or replaces the one with this name); `null` removes it. */
  | { type: "set_table_style"; name: string; style: TableStyleDef | null }
  | { type: "set_slicer_style"; name: string; style: SlicerStyleDef | null }
  /** Sets what a workbook keeps for its pivot tables: styles of your own, data from outside the workbook, the data model (`null` takes one away). */
  | ({ type: "set_pivot_book" } & PivotBookPatch)
  /** Adds a data validation (at `index` among the rules; the last by default). */
  | { type: "add_validation"; sheet: string; validation: Validation; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the validation that has the same id. */
  | { type: "update_validation"; sheet: string; validation: Validation; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_validation"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Says where the summary rows and columns of a sheet's groups sit; a field left out is kept. */
  | { type: "set_outline"; sheet: string; summaryAbove?: boolean; summaryLeft?: boolean }
  /** Puts a group of sparklines on a sheet. */
  | { type: "add_sparklines"; sheet: string; group: SparklineGroup; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the group that has the same id. */
  | { type: "update_sparklines"; sheet: string; group: SparklineGroup; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_sparklines"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Puts a pivot table on a sheet. Its cells are written by separate `set_cells`. */
  | { type: "add_pivot"; sheet: string; pivot: Pivot; index?: number; /** The id of the item it goes after (null for first): when given and present it decides the place, and `index` is the fallback. */ after?: string | null }
  /** Replaces the pivot table that has the same id. */
  | { type: "update_pivot"; sheet: string; pivot: Pivot; /** Its place in the list when it was made (filled in by `SheetSession`): merged changes keep it right while others add and delete beside it. */ at?: number }
  | { type: "delete_pivot"; sheet: string; id: string; /** The id of the one before it in the list (null for none), filled in like `at`: merged changes keep things where they were put by naming the neighbour. */ prev?: string | null; /** Its place in the list when it was made (filled in by `SheetSession` and inverses): merged changes shift positions with it. */ at?: number }
  /** Sets how a sheet prints (replacing what it had), or puts it back to the defaults with `null`. */
  | { type: "set_page"; sheet: string; page: PageSetup | null }
  /** Protects a sheet, or takes the protection off with `null`. */
  | { type: "set_protection"; sheet: string; protection: SheetProtection | null }
  /** Protects the workbook's structure (its list of sheets), or takes the protection off with `null`. */
  | { type: "set_workbook_protection"; protection: WorkbookProtection | null }
  /**
   * Changes the locks that columns, rows and the sheet carry (the lock cells take when they say nothing): a column letter or row
   * number maps to `true` or `false`, or to `null` to take its lock off; `unlocked` says the sheet's cells start unlocked.
   */
  | { type: "set_locks"; sheet: string; unlocked?: boolean | null; columns?: Record<string, boolean | null>; rows?: Record<string, boolean | null> }
  /** Hides or shows the formulas that rows, columns and the sheet carry (`hidden` is true or null for the sheet). */
  | { type: "set_hides"; sheet: string; hidden?: boolean | null; columns?: Record<string, boolean | null>; rows?: Record<string, boolean | null> }
  /** Replaces the ranges that may be edited on a sheet (Excel's Allow Edit Ranges), or takes them all away with `null`. */
  | { type: "set_edit_ranges"; sheet: string; ranges: EditRange[] | null }
  /** Turns iterative calculation on (with these settings) or off with `null`. */
  | { type: "set_iteration"; iteration: IterationSettings | null }
  | ExternalCellsOp
  | { type: "set_title"; title: string }
  /** Defines a name for a formula such as a range; `null` removes it. */
  | { type: "set_name"; name: string; formula: string | null }
  /** Sets (or with `null` removes) a comment thread kept in the workbook (`Workbook.comments`). The cell it is on carries its id (`Cell.thread`). */
  | { type: "set_thread"; id: string; thread: Thread<CellAnchor> | null }
  /** One change to a comment thread kept in the workbook (a reply, a resolve, an edit): safe to apply twice, and merged change by change, so two replies made at once both stay. */
  | { type: "comment"; change: CommentChange<CellAnchor> }
  /** Several operations as one, in order. The inverse of the operations that reach into many places (see `ops-diff.ts`). */
  | { type: "batch"; ops: SheetOp[] }
  /** Puts the whole workbook back as it was. The last resort when the inverse of an operation can't be told in smaller ones. */
  | { type: "restore"; workbook: Workbook };

/** A table made ready to keep: leaves out fields that say nothing. */
function cleanTable(t: Table): Table {
  const out: Table = { id: t.id, name: t.name, range: t.range };
  if (t.totals) out.totals = true;
  if (t.calculated && Object.keys(t.calculated).length) out.calculated = { ...t.calculated };
  if (t.style !== undefined && t.style !== "TableStyleMedium2") out.style = t.style;
  if (t.bandedRows === false) out.bandedRows = false;
  if (t.bandedColumns) out.bandedColumns = true;
  if (t.firstColumn) out.firstColumn = true;
  if (t.lastColumn) out.lastColumn = true;
  if (t.headerRow === false) {
    out.headerRow = false;
    if (t.columns?.length) out.columns = [...t.columns];
  }
  if (t.filterButtons === false) out.filterButtons = false;
  if (t.filters && Object.keys(t.filters).length) out.filters = Object.fromEntries(Object.entries(t.filters).map(([k, v]) => [k, cleanCriterion(v)]));
  if (t.sort) out.sort = tableSortOf(sortLevels(t.sort).map(cleanSortLevel));
  return out;
}

/**
 * Where an item goes in a list of `length`: at the end when `index` is missing, at `index` (cut to the list), or, when it is
 * negative, counted from the end (-1 the end, -2 just before the last one). Merged changes use the negative form to put an item
 * before one that was added at the same moment.
 */
export function listIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  if (index < 0) return Math.max(0, length + 1 + index);
  return Math.min(index, length);
}

/** Where a new item goes: after the one named (null for first), when that one is in the list; else by `index`. */
export function placeAt(list: readonly { id: string }[], after: string | null | undefined, index: number | undefined): number {
  // A place by number is what merged changes keep right; the neighbour is for operations that only name one.
  if (index !== undefined) return listIndex(index, list.length);
  if (after === null) return 0;
  if (after !== undefined) {
    const at = list.findIndex((x) => x.id === after);
    if (at >= 0) return at + 1;
  }
  return listIndex(index, list.length);
}

const BAD_SHEET_NAME = /[:\\/?*[\]]/;

export function checkSheetName(name: string, others: readonly string[]): void {
  if (name.length < 1 || name.length > 31) throw new PliError("invalid_operation", "A sheet name is 1 to 31 characters");
  if (BAD_SHEET_NAME.test(name)) throw new PliError("invalid_operation", `A sheet name can't contain : \\ / ? * [ ]`);
  if (name.startsWith("'") || name.endsWith("'")) throw new PliError("invalid_operation", "A sheet name can't start or end with '");
  if (others.some((o) => o.toLowerCase() === name.toLowerCase())) throw new PliError("invalid_operation", `There is already a sheet called "${name}"`);
}

function findSheet(wb: Workbook, id: string): { sheet: Sheet; index: number } {
  const index = wb.sheets.findIndex((s) => s.id === id);
  if (index < 0) throw new PliError("not_found", `No sheet with id "${id}"`);
  return { sheet: wb.sheets[index]!, index };
}

function replaceSheet(wb: Workbook, index: number, sheet: Sheet): Workbook {
  const sheets = wb.sheets.slice();
  sheets[index] = sheet;
  return { ...wb, sheets };
}

/** A cell made ready to keep: a leading = on a formula is dropped; a cell with nothing in it is no cell. */
export function cleanCell(cell: Cell): Cell | null {
  const out: Cell = { ...cell };
  const set = [out.v !== undefined, out.e !== undefined, out.f !== undefined].filter(Boolean).length;
  if (set > 1) throw new PliError("invalid_operation", "A cell holds a value, an error or a formula, not more than one");
  if (out.f !== undefined) out.f = out.f.replace(/^\s*=\s*/, "");
  if (out.f === "") throw new PliError("invalid_operation", "A formula can't be empty");
  if (typeof out.v === "number" && !Number.isFinite(out.v)) throw new PliError("invalid_operation", "A number must be finite");
  if (out.s?.border) {
    const border = cleanBorders(out.s.border);
    out.s = { ...out.s };
    if (border) out.s.border = border;
    else delete out.s.border;
  }
  if (out.s && Object.keys(out.s).length === 0) delete out.s;
  if (out.control?.type === "dropdown") {
    const seen = new Set<string>();
    for (const o of out.control.options) {
      if (typeof o.value !== "string" || o.value === "") throw new PliError("invalid_operation", "A choice needs a value");
      if (seen.has(o.value)) throw new PliError("invalid_operation", `"${o.value}" is in the list twice`);
      seen.add(o.value);
    }
  }
  if (out.control?.type === "checkbox" && out.control.checked !== undefined && out.control.checked === out.control.unchecked) throw new PliError("invalid_operation", "A checkbox needs two different values");
  if (out.fmt === "" || out.fmt === "General") delete out.fmt;
  if (out.link !== undefined) out.link = cleanLink(out.link);
  if (out.picture !== undefined) {
    out.picture = cleanCellPicture(out.picture);
    if (out.f !== undefined || out.e !== undefined) throw new PliError("invalid_operation", "A cell holds a picture or a formula or an error, not both");
    // The cell's value is what the picture shows, so a cell with a picture is never empty.
    if (out.v === undefined) out.v = out.picture.alt ?? "";
  }
  if (out.note !== undefined) {
    const note = cleanNote(out.note);
    if (note === null) delete out.note;
    else out.note = note;
  }
  if (out.note !== undefined || out.noteRuns !== undefined || out.noteAuthor !== undefined || out.noteBox !== undefined) cleanNoteExtras(out);
  return emptyCell(out) ? null : out;
}

function setCells(wb: Workbook, op: Extract<SheetOp, { type: "set_cells" }>): { state: Workbook; inverse: SheetOp } {
  const { sheet, index } = findSheet(wb, op.sheet);
  const cells = { ...sheet.cells };
  const before: Record<string, Cell | null> = {};
  for (const [address, input] of Object.entries(op.cells)) {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const key = cellAddress(pos.row, pos.col);
    before[key] = cells[key] ?? null;
    const next = input === null ? null : cleanCell(input);
    if (next) cells[key] = next;
    else delete cells[key];
  }
  return { state: replaceSheet(wb, index, { ...sheet, cells }), inverse: { type: "set_cells", sheet: op.sheet, cells: before } };
}

/** Reads the formula, adjusts it, and leaves it alone if it can't be read. */
function adjusted(f: string, home: string, s: Structure): string {
  try {
    return adjustFormula(f, home, s);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return f;
    throw e;
  }
}

export function mapFormulas(wb: Workbook, fn: (f: string, home: string) => string): Workbook {
  let changed = false;
  const sheets = wb.sheets.map((sheet) => {
    let cells: Record<string, Cell> | undefined;
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (cell.f === undefined) continue;
      const f = fn(cell.f, sheet.name);
      if (f !== cell.f) (cells ??= { ...sheet.cells })[address] = { ...cell, f };
    }
    // The cells a chart draws from follow the sheet the same way formulas do.
    let charts: Chart[] | undefined;
    sheet.charts?.forEach((chart, i) => {
      const moved = mapChartRefs(chart, (ref) => fn(ref, sheet.name));
      if (moved !== chart) (charts ??= sheet.charts!.slice())[i] = moved;
    });
    // And so do the cells a sparkline draws.
    let sparklines: SparklineGroup[] | undefined;
    sheet.sparklines?.forEach((group, i) => {
      let changed = false;
      const items = group.items.map((item) => {
        const source = fn(item.source, sheet.name);
        if (source !== item.source) changed = true;
        return source === item.source ? item : { ...item, source };
      });
      const dateAxis = group.dateAxis === undefined ? undefined : fn(group.dateAxis, sheet.name);
      if (dateAxis !== group.dateAxis) changed = true;
      if (changed) (sparklines ??= sheet.sparklines!.slice())[i] = { ...group, items, ...(dateAxis !== undefined ? { dateAxis } : {}) };
    });
    // And the range a pivot table sums up.
    let pivots: Pivot[] | undefined;
    sheet.pivots?.forEach((pivot, i) => {
      const source = fn(pivot.source, sheet.name);
      if (source !== pivot.source) (pivots ??= sheet.pivots!.slice())[i] = { ...pivot, source };
    });
    // So do the formulas of conditional formats.
    let conditional: ConditionalRule[] | undefined;
    sheet.conditional?.forEach((rule, i) => {
      const moved = mapRuleFormulas(rule, (f) => fn(f, sheet.name));
      if (moved !== rule) (conditional ??= sheet.conditional!.slice())[i] = moved;
    });
    let validations: Validation[] | undefined;
    sheet.validations?.forEach((rule, i) => {
      const moved = mapValidationFormulas(rule, (f) => fn(f, sheet.name));
      if (moved !== rule) (validations ??= sheet.validations!.slice())[i] = moved;
    });
    // And the formulas of calculated table columns.
    let tables: Table[] | undefined;
    sheet.tables?.forEach((table, i) => {
      if (!table.calculated) return;
      let moved: Record<string, string> | undefined;
      for (const [name, f] of Object.entries(table.calculated)) {
        const g = fn(f, sheet.name);
        if (g !== f) (moved ??= { ...table.calculated })[name] = g;
      }
      if (moved) (tables ??= sheet.tables!.slice())[i] = { ...table, calculated: moved };
    });
    if (!cells && !charts && !sparklines && !pivots && !conditional && !validations && !tables) return sheet;
    changed = true;
    return { ...sheet, ...(cells ? { cells } : {}), ...(charts ? { charts } : {}), ...(sparklines ? { sparklines } : {}), ...(pivots ? { pivots } : {}), ...(conditional ? { conditional } : {}), ...(validations ? { validations } : {}), ...(tables ? { tables } : {}) };
  });
  let names = wb.names;
  if (names) {
    let next: Record<string, string> | undefined;
    for (const [name, f] of Object.entries(names)) {
      const g = fn(f, "");
      if (g !== f) (next ??= { ...names })[name] = g;
    }
    if (next) {
      names = next;
      changed = true;
    }
  }
  return changed ? { ...wb, sheets, ...(names ? { names } : {}) } : wb;
}

function structural(wb: Workbook, op: Extract<SheetOp, { type: "insert_rows" | "delete_rows" | "insert_cols" | "delete_cols" | "insert_row_runs" | "delete_row_runs" }>): Workbook {
  const axis = op.type.endsWith("cols") ? "col" : "row";
  const kind = op.type.startsWith("insert") ? "insert" : "delete";
  const max = axis === "row" ? MAX_ROWS : MAX_COLS;
  if ("runs" in op) return structureRuns(wb, op.sheet, axis, kind, normalizeRuns(kind, op.runs, max));
  if (!Number.isInteger(op.at) || !Number.isInteger(op.count) || op.at < 1 || op.count < 1 || op.at > max) {
    throw new PliError("out_of_range", `Can't ${kind} ${op.count} ${axis === "row" ? "rows" : "columns"} at ${op.at}`);
  }
  return structureRuns(wb, op.sheet, axis, kind, [[op.at, op.count]]);
}

/** Rows (or columns) put in or taken out at one place or many; everything that points at them follows. */
function structureRuns(wb: Workbook, sheetId: string, axis: "row" | "col", kind: "insert" | "delete", runs: readonly Run[]): Workbook {
  const { sheet, index } = findSheet(wb, sheetId);
  const max = axis === "row" ? MAX_ROWS : MAX_COLS;
  const map = runMap(kind, runs);
  const op = { at: runs[0]![0], count: runs[0]![1] };
  if (kind === "insert") {
    // Nothing may be pushed off the end of the sheet.
    for (const address of Object.keys(sheet.cells)) {
      const p = parseCell(address)!;
      const n = axis === "row" ? p.row : p.col;
      if (n >= op.at && map.move(n)! > max) throw new PliError("out_of_range", "That would push cells off the end of the sheet");
    }
  }
  const move = (n: number): number | null => map.move(n);
  const cells: Record<string, Cell> = {};
  for (const [address, cell] of Object.entries(sheet.cells)) {
    const p = parseCell(address)!;
    const moved = move(axis === "row" ? p.row : p.col);
    if (moved === null) continue;
    cells[axis === "row" ? cellAddress(moved, p.col) : cellAddress(p.row, moved)] = cell;
  }
  const shiftDims = (dims: Record<string, Dimension> | undefined, asName: boolean) => {
    if (!dims) return undefined;
    const out: Record<string, Dimension> = {};
    for (const [k, d] of Object.entries(dims)) {
      const n = asName ? colNumber(k) : Number(k);
      const moved = move(n);
      if (moved !== null) out[asName ? colName(moved) : String(moved)] = d;
    }
    return Object.keys(out).length ? out : undefined;
  };
  const next: Sheet = { ...sheet, cells };
  if (axis === "col") {
    const columns = shiftDims(sheet.columns, true);
    if (columns) next.columns = columns;
    else delete next.columns;
  } else {
    const rows = shiftDims(sheet.rows, false);
    if (rows) next.rows = rows;
    else delete next.rows;
  }
  const s: Structure = { sheet: sheet.name, axis, kind, at: op.at, count: op.count, ...(runs.length > 1 ? { runs } : {}) };
  if (sheet.charts) {
    // A chart stays on its cell: inserting above or left of it pushes it along, and deleting its cell leaves it at the gap.
    next.charts = sheet.charts.map((chart) => {
      const n = axis === "row" ? chart.from.row : chart.from.col;
      const m = move(n) ?? map.gap(n);
      return m === n ? chart : { ...chart, from: { ...chart.from, [axis === "row" ? "row" : "col"]: Math.max(1, Math.min(m, max)) } };
    });
  }
  // A range follows the rows and columns it covers: it grows when some are inserted inside it and shrinks when some are deleted.
  const moveRange = (range: string): string | null => {
    const b = parseRange(range);
    if (!b) return null;
    const [from, to] = axis === "row" ? [b.r1, b.r2] : [b.c1, b.c2];
    const span: [number, number] = [map.lo(from), map.hi(to)];
    if (span[0] > span[1]) return null;
    const lo = Math.min(span[0], max);
    const hi = Math.min(span[1], max);
    return rangeAddress(axis === "row" ? { ...b, r1: lo, r2: hi } : { ...b, c1: lo, c2: hi });
  };
  if (kind === "insert") {
    // New rows and columns take the lock of the one before them, as they take its format in Excel.
    const key = axis === "col" ? "columns" : "rows";
    let dims = next[key];
    for (const [at, count] of map.placed()) dims = inheritHide(inheritLock(dims, axis, at, count), axis, at, count);
    if (dims) next[key] = dims;
  }
  if (sheet.editRanges) {
    // Ranges that may be edited follow their rows and columns like other ranges, and go when all of them do.
    const list = sheet.editRanges.map((r) => ({ ...r, ranges: r.ranges.map(moveRange).filter((x): x is string => x !== null) })).filter((r) => r.ranges.length);
    if (list.length) next.editRanges = list;
    else delete next.editRanges;
  }
  if (sheet.pivots) {
    // A pivot table moves with the rows and columns above or left of it, and can't be cut through.
    next.pivots = sheet.pivots.map((pivot) => {
      const b = parseRange(pivot.range)!;
      const [from, to] = axis === "row" ? [b.r1, b.r2] : [b.c1, b.c2];
      const cut = kind === "insert" ? runs.some((r) => r[0] > from && r[0] <= to) : runs.some((r) => r[0] <= to && r[0] + r[1] - 1 >= from);
      if (cut) throw new PliError("invalid_operation", `Can't change part of the pivot table ${pivot.name}`);
      const d = map.move(from)! - from;
      if (!d) return pivot;
      const a = parseCell(pivot.anchor)!;
      const shift = (row: number, col: number) => (axis === "row" ? cellAddress(row + d, col) : cellAddress(row, col + d));
      return { ...pivot, anchor: shift(a.row, a.col), range: rangeAddress(axis === "row" ? { ...b, r1: b.r1 + d, r2: b.r2 + d } : { ...b, c1: b.c1 + d, c2: b.c2 + d }) };
    });
  }
  if (sheet.sparklines) {
    // A sparkline stays in its cell as the cell moves, and goes when the cell is deleted.
    const groups: SparklineGroup[] = [];
    for (const g of sheet.sparklines) {
      const items = g.items.flatMap((item) => {
        const p = parseCell(item.cell)!;
        const m = move(axis === "row" ? p.row : p.col);
        return m === null ? [] : [{ ...item, cell: axis === "row" ? cellAddress(m, p.col) : cellAddress(p.row, m) }];
      });
      if (items.length || sharing()) groups.push(items.length === g.items.length && items.every((i, k) => i.cell === g.items[k]!.cell) ? g : { ...g, items });
    }
    if (groups.length) next.sparklines = groups;
    else delete next.sparklines;
  }
  if (sheet.page) {
    // Print areas follow their rows and columns like other ranges; a page break goes with the row or column it comes after.
    const page: PageSetup = { ...sheet.page };
    if (page.printArea) {
      const areas = page.printArea.map(moveRange).filter((r): r is string => r !== null);
      if (areas.length) page.printArea = areas;
      else delete page.printArea;
    }
    const titles = axis === "row" ? page.titleRows : page.titleCols;
    if (titles) {
      // Titles shrink when some of their rows go, and disappear when all do.
      const lo = map.lo(titles[0]);
      const hi = map.hi(titles[1]);
      const next2: [number, number] | undefined = hi >= lo && lo <= max ? [Math.max(1, lo), Math.min(max, hi)] : undefined;
      if (axis === "row") {
        if (next2) page.titleRows = next2;
        else delete page.titleRows;
      } else if (next2) page.titleCols = next2;
      else delete page.titleCols;
    }
    const list = axis === "row" ? page.rowBreaks : page.colBreaks;
    if (list) {
      const moved = [...new Set(list.map(move).filter((n): n is number => n !== null && n >= 1 && n < max))].sort((x, y) => x - y);
      if (axis === "row") {
        if (moved.length) page.rowBreaks = moved;
        else delete page.rowBreaks;
      } else if (moved.length) page.colBreaks = moved;
      else delete page.colBreaks;
    }
    if (Object.keys(page).length) next.page = page;
    else delete next.page;
  }
  if (sheet.merges) {
    const merges = sheet.merges.map(moveRange).filter((r): r is string => r !== null && r.includes(":"));
    if (merges.length) next.merges = merges;
    else delete next.merges;
  }
  if (sheet.conditional) {
    const conditional: ConditionalRule[] = [];
    for (const rule of sheet.conditional) {
      const ranges = rule.ranges.map(moveRange).filter((r): r is string => r !== null);
      if (ranges.length || sharing()) conditional.push(ranges.every((r, i) => r === rule.ranges[i]) && ranges.length === rule.ranges.length ? rule : ({ ...rule, ranges } as ConditionalRule));
    }
    if (conditional.length) next.conditional = conditional;
    else delete next.conditional;
  }
  if (sheet.tables) {
    const tables: Table[] = [];
    for (const table of sheet.tables) {
      const b = parseRange(table.range)!;
      const headed = hasHeader(table);
      // A table whose header row is deleted is gone with it.
      if (headed && axis === "row" && kind === "delete" && map.gone(b.r1)) continue;
      const moved = moveRange(table.range);
      if (moved === null) continue;
      const m = parseRange(moved)!;
      let range = m;
      // A table keeps a row of data under its header, and loses its totals when that row is deleted.
      let totals = table.totals;
      if (axis === "row" && kind === "delete" && table.totals && map.gone(b.r2)) totals = undefined;
      const least = (headed ? 1 : 0) + (totals ? 1 : 0);
      if (m.r2 < m.r1 + least) range = { ...m, r2: m.r1 + least };
      const next: Table = { ...table, range: rangeAddress(range) };
      if (totals) next.totals = true;
      else delete next.totals;
      // Without a header row the names are kept apart from the cells, so they move with the columns.
      if (!headed && axis === "col" && table.columns) {
        // A shared workbook keeps the names as they are (a blank stays blank), so the result doesn't depend on which change came first.
        const names = sharing() ? Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => table.columns![i] ?? "") : tableColumns(sheet, b, table);
        const width = range.c2 - range.c1 + 1;
        if (kind === "delete") {
          const gone = (c: number) => map.gone(c);
          next.columns = names.filter((_, i) => !gone(b.c1 + i)).slice(0, width);
        } else if (width > names.length) {
          const kept = names.slice();
          kept.splice(Math.max(0, Math.min(op.at - b.c1, kept.length)), 0, ...Array.from({ length: width - names.length }, () => ""));
          next.columns = kept;
        }
      }
      tables.push(next);
    }
    if (tables.length) next.tables = tables;
    else delete next.tables;
  }
  if (sheet.images) {
    // A picture stays on its cell like a chart does.
    next.images = sheet.images.map((image) => shiftImage(image, sheet, next, axis, move, map.gap, max));
  }
  if (sheet.slicers) {
    // A slicer stays on its cell like a chart does.
    next.slicers = sheet.slicers.map((slicer) => {
      const n = axis === "row" ? slicer.from.row : slicer.from.col;
      const m = move(n) ?? map.gap(n);
      return m === n ? slicer : { ...slicer, from: { ...slicer.from, [axis === "row" ? "row" : "col"]: Math.max(1, Math.min(m, max)) } };
    });
  }
  if (sheet.timelines) {
    // A timeline stays on its cell like a slicer does.
    next.timelines = sheet.timelines.map((timeline) => {
      const n = axis === "row" ? timeline.from.row : timeline.from.col;
      const m = move(n) ?? map.gap(n);
      return m === n ? timeline : { ...timeline, from: { ...timeline.from, [axis === "row" ? "row" : "col"]: Math.max(1, Math.min(m, max)) } };
    });
  }
  if (next.pivots?.some((p) => p.slicers?.length || p.timelines?.length)) {
    // The slicers and timelines of a pivot table stay on their cells like a table's slicers do.
    const stay = <T extends { from: { row: number; col: number; dx?: number; dy?: number } }>(panel: T): T => {
      const n = axis === "row" ? panel.from.row : panel.from.col;
      const m = move(n) ?? map.gap(n);
      return m === n ? panel : { ...panel, from: { ...panel.from, [axis === "row" ? "row" : "col"]: Math.max(1, Math.min(m, max)) } };
    };
    next.pivots = next.pivots.map((p) => ({ ...p, ...(p.slicers ? { slicers: p.slicers.map(stay) } : {}), ...(p.timelines ? { timelines: p.timelines.map(stay) } : {}) }));
  }
  if (sheet.validations) {
    const validations: Validation[] = [];
    for (const rule of sheet.validations) {
      const ranges = rule.ranges.map(moveRange).filter((r): r is string => r !== null);
      if (ranges.length || sharing()) validations.push(ranges.length === rule.ranges.length && ranges.every((r, i) => r === rule.ranges[i]) ? rule : ({ ...rule, ranges } as Validation));
    }
    if (validations.length) next.validations = validations;
    else delete next.validations;
  }
  if (sheet.filter) {
    const moved = adjusted(sheet.filter.range, "", { ...s, sheet: "" });
    const r = moved === "#REF!" ? null : parseRange(moved);
    if (r && r.r1 !== r.r2) {
      const columns: Record<string, FilterCriterion> = {};
      for (const [k, v] of Object.entries(sheet.filter.columns ?? {})) {
        const n = axis === "col" ? move(colNumber(k)) : colNumber(k);
        if (n !== null && n >= r.c1 && n <= r.c2) columns[colName(n)] = v;
      }
      next.filter = { range: rangeAddress(r), ...(Object.keys(columns).length ? { columns } : {}) };
    } else delete next.filter;
  }
  if (sheet.filterViews) {
    const views = moveFilterViews(sheet.filterViews, (range) => {
      const m = adjusted(range, "", { ...s, sheet: "" });
      return m === "#REF!" ? null : m;
    }, (n) => (axis === "col" ? move(n) : n));
    if (views.length) next.filterViews = views;
    else delete next.filterViews;
  }
  // The cells that inserted columns and rows give a table (header names, calculated columns) are not made here in a shared workbook:
  // whoever makes the change writes them as cells of their own (`stampOps`), so they are not a surprise to another person's change.
  const shifted = mapFormulas(replaceSheet(wb, index, next), (f, home) => adjusted(f, home, s));
  const moved = sharing() ? shifted : fillHeaders(shifted, sheet.id);
  const placed = !sharing() && kind === "insert" && axis === "row" && sheet.tables?.some((t) => t.calculated) ? map.placed() : [];
  let filled = moved;
  for (const [at, count] of placed) filled = fillCalculated(filled, sheet.id, at, at + count - 1);
  return pruneViewTables(dropOrphanSlicers(kind === "insert" && axis === "row" ? filled : dropGoneColumns(moved, sheet.id)));
}

/** Slicers and timelines whose table or column is gone go with it. */
function dropOrphanSlicers(wb: Workbook): Workbook {
  if (sharing()) return wb;
  if (!wb.sheets.some((s) => s.slicers?.length || s.timelines?.length)) return wb;
  const columns = new Map<string, string[]>();
  for (const sheet of wb.sheets) for (const table of sheet.tables ?? []) columns.set(table.id, tableColumns(sheet, parseRange(table.range)!, table));
  let changed = false;
  const sheets = wb.sheets.map((sheet) => {
    if (!sheet.slicers && !sheet.timelines) return sheet;
    let next: Sheet = sheet;
    for (const key of ["slicers", "timelines"] as const) {
      const list: { table: string; column: string }[] | undefined = sheet[key];
      if (!list) continue;
      const kept = list.filter((x) => columns.get(x.table)?.includes(x.column));
      if (kept.length === list.length) continue;
      changed = true;
      next = { ...next, [key]: kept };
      if (!kept.length) delete next[key];
    }
    return next;
  });
  return changed ? { ...wb, sheets } : wb;
}

/**
 * A table with only what refers to columns that are there: what a shared workbook leaves behind when a column goes (a filter, a
 * sort, a calculated column of nothing) is dropped when the workbook is saved.
 */
export function keepColumns(sheet: Sheet, table: Table): Table {
  if (!(table.calculated || table.filters || table.sort)) return table;
  const b = parseRange(table.range);
  if (!b) return table;
  const names = tableColumns(sheet, b, table);
  const next: Table = { ...table };
  const keep = <V,>(o: Record<string, V>) => Object.fromEntries(Object.entries(o).filter(([n]) => names.includes(n)));
  for (const key of ["calculated", "filters"] as const) {
    const value = table[key] as Record<string, unknown> | undefined;
    if (!value) continue;
    const kept = keep(value);
    if (Object.keys(kept).length) (next as unknown as Record<string, unknown>)[key] = kept;
    else delete next[key];
  }
  if (table.sort) {
    const kept = mapSortColumns(table.sort, (c) => (names.includes(c) ? c : null));
    if (kept) next.sort = kept;
    else delete next.sort;
  }
  return next;
}

/** Calculated columns, filters and sorts of columns that are gone are forgotten. */
function dropGoneColumns(wb: Workbook, sheetId: string): Workbook {
  // A shared workbook leaves them be (they point at nothing, and readers and saving leave them out): whichever order two people's changes arrive in, the table is the same.
  if (sharing()) return wb;
  const { sheet, index } = findSheet(wb, sheetId);
  if (!sheet.tables?.some((t) => t.calculated || t.filters || t.sort)) return wb;
  const tables = sheet.tables.map((t) => {
    if (!t.calculated && !t.filters && !t.sort) return t;
    const names = tableColumns(sheet, parseRange(t.range)!, t);
    const next: Table = { ...t };
    const keep = <V,>(o: Record<string, V>) => Object.fromEntries(Object.entries(o).filter(([n]) => names.includes(n)));
    if (t.calculated) {
      const kept = keep(t.calculated);
      if (Object.keys(kept).length) next.calculated = kept;
      else delete next.calculated;
    }
    if (t.filters) {
      const kept = keep(t.filters);
      if (Object.keys(kept).length) next.filters = kept;
      else delete next.filters;
    }
    if (t.sort) {
      const kept = mapSortColumns(t.sort, (c) => (names.includes(c) ? c : null));
      if (kept) next.sort = kept;
      else delete next.sort;
    }
    return next;
  });
  return replaceSheet(wb, index, { ...sheet, tables });
}

/** Rows inserted into a table get the formulas of its calculated columns, where the new cells are empty. */
export function fillCalculated(wb: Workbook, sheetId: string, from: number, to: number): Workbook {
  const { sheet, index } = findSheet(wb, sheetId);
  let cells: Record<string, Cell> | undefined;
  for (const table of sheet.tables ?? []) {
    if (!table.calculated) continue;
    const b = parseRange(table.range)!;
    const [top, bottom] = dataRows(table, b);
    const names = tableColumns(sheet, b, table);
    names.forEach((name, i) => {
      const f = table.calculated![name];
      if (f === undefined) return;
      for (let r = Math.max(from, top); r <= Math.min(to, bottom); r++) {
        const key = cellAddress(r, b.c1 + i);
        const here = (cells ?? sheet.cells)[key];
        if (here && (here.v !== undefined || here.f !== undefined || here.e !== undefined)) continue;
        let shifted = f;
        try {
          shifted = shiftFormula(f, r - top, 0);
        } catch {
          // an unreadable formula is copied as it is
        }
        (cells ??= { ...sheet.cells })[key] = { ...here, f: shifted };
      }
    });
  }
  return cells ? replaceSheet(wb, index, { ...sheet, cells }) : wb;
}

/** After columns are inserted into a table, their header cells are named `Column3` and so on. */
function fillHeaders(wb: Workbook, sheetId: string): Workbook {
  const { sheet, index } = findSheet(wb, sheetId);
  if (!sheet.tables) return wb;
  let cells: Record<string, Cell> | undefined;
  for (const table of sheet.tables) {
    if (!hasHeader(table)) continue;
    const b = parseRange(table.range)!;
    const names = tableColumns({ ...sheet, cells: cells ?? sheet.cells }, b);
    for (let c = b.c1; c <= b.c2; c++) {
      const v = (cells ?? sheet.cells)[cellAddress(b.r1, c)]?.v;
      if (typeof v === "string" && v !== "") continue;
      const name = freshColumnName(names.filter((_, i) => i !== c - b.c1), c - b.c1 + 1);
      names[c - b.c1] = name;
      // A header is text: a formula or an error there gives way to the name.
      const { f: _f, e: _e, ...here } = (cells ?? sheet.cells)[cellAddress(b.r1, c)] ?? {};
      (cells ??= { ...sheet.cells })[cellAddress(b.r1, c)] = { ...here, v: name };
    }
  }
  return cells ? replaceSheet(wb, index, { ...sheet, cells }) : wb;
}

function mapSheetNames(wb: Workbook, fn: (f: string) => string): Workbook {
  return mapFormulas(wb, (f) => {
    try {
      return fn(f);
    } catch (e) {
      if (e instanceof FormulaSyntaxError) return f;
      throw e;
    }
  });
}

/** The operation that is the opposite of a rows or columns operation, in the coordinates of the sheet after it. */
function structuralUndo(wb: Workbook, op: Extract<SheetOp, { type: "insert_rows" | "delete_rows" | "insert_cols" | "delete_cols" | "insert_row_runs" | "delete_row_runs" }>): SheetOp[] {
  const sheet = findSheet(wb, op.sheet).sheet;
  const name = sheet.name;
  switch (op.type) {
    case "insert_rows": return [{ type: "delete_rows", sheet: op.sheet, at: op.at, count: op.count, name }];
    case "insert_cols": return [{ type: "delete_cols", sheet: op.sheet, at: op.at, count: op.count, name }];
    case "delete_rows": return [{ type: "insert_rows", sheet: op.sheet, at: op.at, count: op.count, name }];
    case "delete_cols": return [{ type: "insert_cols", sheet: op.sheet, at: op.at, count: op.count, name }];
    case "insert_row_runs": {
      const runs = normalizeRuns("insert", op.runs, MAX_ROWS);
      return [{ type: "delete_row_runs", sheet: op.sheet, runs: runMap("insert", runs).placed(), name }];
    }
    case "delete_row_runs": {
      const runs = normalizeRuns("delete", op.runs, MAX_ROWS);
      let before = 0;
      const back = runs.map(([at, count]): [number, number] => {
        const place: [number, number] = [at - before, count];
        before += count;
        return place;
      });
      return [{ type: "insert_row_runs", sheet: op.sheet, runs: back, name }];
    }
  }
}

/**
 * The operation that undoes a change that reached into many places: the `opposite` operations, then whatever else it takes to
 * give back exactly the workbook as it was (the cells that were in deleted rows, formulas that had turned into `#REF!`). If that
 * can't be told in operations, the whole workbook is put back.
 */
function undoWith(before: Workbook, after: Workbook, opposite: SheetOp[]): SheetOp {
  // The caller only wants the new workbook (a server replaying changes): the way back is not worked out.
  if (noUndo) return { type: "restore", workbook: before };
  try {
    let cur = after;
    // What the opposite operations take away on their own is written down too, so merged changes see every removal.
    const written: SheetOp[] = [];
    for (const op of opposite) {
      for (const stamped of stampOps(cur, [op])) {
        written.push(stamped);
        cur = applyOp(cur, stamped);
      }
    }
    const rest = diffWorkbooks(cur, before);
    if (rest) {
      const all = [...written, ...rest];
      return all.length === 1 ? all[0]! : { type: "batch", ops: all };
    }
  } catch {
    // Fall through to putting the workbook back.
  }
  return { type: "restore", workbook: before };
}

let noUndo = 0;
/** Applies an operation as a shared workbook does (see `ghosts.ts`), without working out how to undo it: for servers, and sessions that sync. */
export function ghostApply(wb: Workbook, op: SheetOp): Workbook {
  return whileSharing(() => applyOp(wb, op));
}

/** A reducer that keeps what rows and columns leave with nothing to cover while `shared()` is true: what a session that syncs uses. */
export function sharedReducer(shared: () => boolean): Reducer<Workbook, SheetOp> {
  return {
    apply(wb, op) {
      return shared() ? whileSharing(() => sheetReducer.apply(wb, op)) : sheetReducer.apply(wb, op);
    },
  };
}

/** The workbook without the conditional formats, validations and sparklines that cover nothing (what a shared workbook leaves behind when rows and columns go). */
export function withoutGhosts(wb: Workbook): Workbook {
  // Two people can delete or hide the last sheets between them: a workbook keeps one sheet that is shown.
  if (!wb.sheets.length) return withoutGhosts({ ...wb, sheets: [{ id: "sheet_1", name: "Sheet1", cells: {} }] });
  if (wb.sheets.every((s) => s.hidden)) return withoutGhosts({ ...wb, sheets: wb.sheets.map((s, i) => (i === 0 ? (({ hidden: _h, ...rest }) => rest)(s) : s)) });
  let changed = false;
  const sheets = wb.sheets.map((sheet) => {
    let next = sheet;
    const clean = <K extends "conditional" | "validations">(key: K) => {
      const list = next[key] as { ranges: string[] }[] | undefined;
      if (!list?.some((r) => r.ranges.length === 0)) return;
      const kept = list.filter((r) => r.ranges.length > 0);
      next = { ...next };
      if (kept.length) (next as unknown as Record<string, unknown>)[key] = kept;
      else delete next[key];
    };
    clean("conditional");
    clean("validations");
    if (next.sparklines?.some((g) => g.items.length === 0)) {
      const kept = next.sparklines.filter((g) => g.items.length > 0);
      next = { ...next };
      if (kept.length) next.sparklines = kept;
      else delete next.sparklines;
    }
    if (next.tables?.some((t) => keepColumns(next, t) !== t)) next = { ...next, tables: next.tables.map((t) => keepColumns(next, t)) };
    return next;
  });
  // Slicers and timelines whose table or column is gone cover nothing.
  const cleaned = sheets.map((sheet, i) => {
    let next = sheet;
    for (const key of ["slicers", "timelines"] as const) {
      const list = next[key] as { table: string; column: string }[] | undefined;
      if (!list?.some((x) => isOrphanPanel(wb, x))) continue;
      const kept = list.filter((x) => !isOrphanPanel(wb, x));
      next = { ...next };
      if (kept.length) (next as unknown as Record<string, unknown>)[key] = kept;
      else delete next[key];
    }
    if (next !== wb.sheets[i]) changed = true;
    return next;
  });
  return changed ? { ...wb, sheets: cleaned } : wb;
}

/** Applies an operation and returns only the new workbook: nothing is worked out for undoing it, which makes rows and sheets much cheaper. For servers and replays. */
export function applyOp(wb: Workbook, op: SheetOp): Workbook {
  noUndo++;
  try {
    return sheetReducer.apply(wb, op).state;
  } finally {
    noUndo--;
  }
}

const UPSERT: Record<string, string> = { update_chart: "add_chart", update_rule: "add_rule", update_table: "add_table", update_slicer: "add_slicer", update_timeline: "add_timeline", update_image: "add_image", update_validation: "add_validation", update_sparklines: "add_sparklines", update_pivot: "add_pivot" };

export const sheetReducer: Reducer<Workbook, SheetOp> = {
  apply(wb, op) {
    if (op.soft) {
      const { soft, ...plain } = op;
      try {
        return core.apply(wb, plain as SheetOp);
      } catch (error) {
        if (!(error instanceof PliError) || error.code !== "not_found") throw error;
        const add = soft === "upsert" ? UPSERT[op.type] : undefined;
        // Put back where the update had it in its list.
        if (add) return core.apply(wb, { ...plain, type: add, ...("at" in plain && typeof plain.at === "number" ? { index: plain.at } : {}) } as unknown as SheetOp);
        return { state: wb, inverse: { type: "batch", ops: [] } };
      }
    }
    return core.apply(wb, op);
  },
};

const core: Reducer<Workbook, SheetOp> = {
  apply(wb, op) {
    switch (op.type) {
      case "set_cells":
        return setCells(wb, op);
      case "add_sheet": {
        checkSheetName(op.sheet.name, wb.sheets.map((s) => s.name));
        if (wb.sheets.some((s) => s.id === op.sheet.id)) throw new PliError("invalid_operation", `A sheet with id "${op.sheet.id}" already exists`);
        const at = placeAt(wb.sheets, op.after, op.index);
        const sheets = wb.sheets.slice();
        sheets.splice(at, 0, op.sheet);
        const state = { ...wb, sheets };
        return { state, inverse: undoWith(wb, state, [{ type: "delete_sheet", id: op.sheet.id, name: op.sheet.name, at, prev: sheets[at - 1]?.id ?? null }]) };
      }
      case "delete_sheet": {
        const { sheet, index } = findSheet(wb, op.id);
        // In a shared workbook two people can each delete a different one of the last two sheets, so the rule is kept at the editor and, when saving, by `withoutGhosts`.
        if (wb.sheets.length === 1 && !sharing()) throw new PliError("invalid_operation", "A workbook needs at least one sheet");
        const sheets = wb.sheets.slice();
        sheets.splice(index, 1);
        if (!sharing() && sheets.every((x) => x.hidden)) throw new PliError("invalid_operation", "A workbook needs at least one sheet that isn't hidden");
        const state = dropOrphanSlicers(mapSheetNames({ ...wb, sheets }, (f) => dropSheetFromFormula(f, sheet.name)));
        return { state, inverse: undoWith(wb, state, [{ type: "add_sheet", sheet, index, after: sheets[index - 1]?.id ?? null }]) };
      }
      case "rename_sheet": {
        const { sheet, index } = findSheet(wb, op.id);
        if (sheet.name === op.name) return { state: wb, inverse: op };
        checkSheetName(op.name, wb.sheets.filter((s) => s.id !== op.id).map((s) => s.name));
        const renamed = mapSheetNames(replaceSheet(wb, index, { ...sheet, name: op.name }), (f) => renameSheetInFormula(f, sheet.name, op.name));
        // Links to places on the sheet follow its new name.
        const state: Workbook = {
          ...renamed,
          sheets: renamed.sheets.map((s) => {
            let cells: Record<string, Cell> | undefined;
            for (const [address, cell] of Object.entries(s.cells)) {
              if (!cell.link || !isPlace(cell.link.to)) continue;
              const to = renameLinkPlace(cell.link.to, sheet.name, op.name);
              if (to !== cell.link.to) (cells ??= { ...s.cells })[address] = { ...cell, link: { ...cell.link, to } };
            }
            return cells ? { ...s, cells } : s;
          }),
        };
        return { state, inverse: undoWith(wb, state, [{ type: "rename_sheet", id: op.id, name: sheet.name, from: op.name }]) };
      }
      case "move_sheet": {
        const { sheet, index } = findSheet(wb, op.id);
        const to = Math.max(0, Math.min(op.index, wb.sheets.length - 1));
        const sheets = wb.sheets.slice();
        sheets.splice(index, 1);
        sheets.splice(to, 0, sheet);
        return { state: { ...wb, sheets }, inverse: { type: "move_sheet", id: op.id, index, from: to, order: sheets.map((x) => x.id) } };
      }
      case "set_sheet_order": {
        const listed: Sheet[] = [];
        for (const id of op.order) {
          const found = wb.sheets.find((x) => x.id === id);
          if (found && !listed.includes(found)) listed.push(found);
        }
        const sheets = [...listed, ...wb.sheets.filter((x) => !listed.includes(x))];
        const same = sheets.every((x, i) => x === wb.sheets[i]);
        return { state: same ? wb : { ...wb, sheets }, inverse: { type: "set_sheet_order", order: wb.sheets.map((x) => x.id) } };
      }
      case "insert_rows":
      case "delete_rows":
      case "insert_cols":
      case "delete_cols":
      case "insert_row_runs":
      case "delete_row_runs": {
        const state = structural(wb, op);
        return { state, inverse: undoWith(wb, state, structuralUndo(wb, op)) };
      }
      case "set_thread": {
        const old = wb.comments?.[op.id] ?? null;
        const comments = { ...wb.comments };
        if (op.thread) comments[op.id] = op.thread;
        else delete comments[op.id];
        const state: Workbook = { ...wb };
        if (Object.keys(comments).length) state.comments = comments;
        else delete state.comments;
        return { state, inverse: { type: "set_thread", id: op.id, thread: old } };
      }
      case "comment": {
        const id = changeThreadId(op.change);
        const old = wb.comments?.[id] ?? null;
        let now = applyCommentChange<CellAnchor>(old ? [old] : [], op.change).find((t) => t.id === id) ?? null;
        // Replies made at the same moment are in the order they were written, whichever arrived first, so everyone's thread reads the same.
        if (now && op.change.type === "comment.add") now = { ...now, comments: [...now.comments].sort((a, b) => a.createdAt - b.createdAt || (a.author < b.author ? -1 : a.author > b.author ? 1 : 0)) };
        const comments = { ...wb.comments };
        if (now) comments[id] = now;
        else delete comments[id];
        const state: Workbook = { ...wb };
        if (Object.keys(comments).length) state.comments = comments;
        else delete state.comments;
        return { state, inverse: { type: "set_thread", id, thread: old } };
      }
      case "batch": {
        let state = wb;
        const inverse: SheetOp[] = [];
        for (const member of op.ops) {
          const done = sheetReducer.apply(state, member);
          state = done.state;
          inverse.unshift(done.inverse);
        }
        return { state, inverse: { type: "batch", ops: inverse } };
      }
      case "set_size": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const key = op.axis === "col" ? "columns" : "rows";
        const id = op.axis === "col" ? colName(op.index) : String(op.index);
        if (op.index < 1 || op.index > (op.axis === "col" ? MAX_COLS : MAX_ROWS)) throw new PliError("out_of_range", `No ${op.axis} ${op.index}`);
        const old = sheet[key]?.[id];
        const merged = mergeSize(old, op);
        const dims = { ...sheet[key] };
        if (Object.keys(merged).length) dims[id] = merged;
        else delete dims[id];
        const next: Sheet = { ...sheet };
        if (Object.keys(dims).length) next[key] = dims;
        else delete next[key];
        const refit = refitImages(sheet, next);
        if (refit) next.images = refit;
        // The inverse restores both fields as they were.
        const inverse: SheetOp = { type: "set_size", sheet: op.sheet, axis: op.axis, index: op.index, size: old?.size ?? null, hidden: old?.hidden ?? null, level: old?.level ?? null, collapsed: old?.collapsed ?? null };
        return { state: replaceSheet(wb, index, next), inverse };
      }
      case "set_sizes": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const key = op.axis === "col" ? "columns" : "rows";
        const dims = { ...sheet[key] };
        const undo: SizeChange[] = [];
        for (const e of op.sizes) {
          if (e.index < 1 || e.index > (op.axis === "col" ? MAX_COLS : MAX_ROWS)) throw new PliError("out_of_range", `No ${op.axis} ${e.index}`);
          const id = op.axis === "col" ? colName(e.index) : String(e.index);
          const old = dims[id];
          const merged = mergeSize(old, e);
          if (Object.keys(merged).length) dims[id] = merged;
          else delete dims[id];
          undo.push({ index: e.index, size: old?.size ?? null, hidden: old?.hidden ?? null, level: old?.level ?? null, collapsed: old?.collapsed ?? null });
        }
        const next: Sheet = { ...sheet };
        if (Object.keys(dims).length) next[key] = dims;
        else delete next[key];
        const refit = refitImages(sheet, next);
        if (refit) next.images = refit;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_sizes", sheet: op.sheet, axis: op.axis, sizes: undo.reverse() } };
      }
      case "set_frozen": {
        const { sheet, index } = findSheet(wb, op.sheet);
        if (!Number.isInteger(op.rows) || !Number.isInteger(op.cols) || op.rows < 0 || op.cols < 0) throw new PliError("invalid_operation", "Frozen rows and columns are whole numbers from 0");
        const next: Sheet = { ...sheet };
        if (op.rows || op.cols) next.frozen = { rows: op.rows, cols: op.cols };
        else delete next.frozen;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_frozen", sheet: op.sheet, rows: sheet.frozen?.rows ?? 0, cols: sheet.frozen?.cols ?? 0 } };
      }
      case "set_filter": {
        const { sheet, index } = findSheet(wb, op.sheet);
        if (op.filter !== null) {
          const r = parseRange(op.filter.range);
          if (!r || r.r1 === r.r2) throw new PliError("invalid_operation", "A filter needs a range of at least two rows");
          for (const [k, criterion] of Object.entries(op.filter.columns ?? {})) {
            cleanCriterion(criterion);
            const c = colNumber(k);
            if (!c || c < r.c1 || c > r.c2) throw new PliError("invalid_operation", `Column ${k} is outside the filter's range`);
          }
        }
        const next: Sheet = { ...sheet };
        if (op.filter) next.filter = op.filter;
        else delete next.filter;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_filter", sheet: op.sheet, filter: sheet.filter ?? null } };
      }
      case "set_filter_views": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const next: Sheet = { ...sheet };
        const views = op.views === null ? [] : cleanFilterViews(op.views);
        if (views.length) next.filterViews = views;
        else delete next.filterViews;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_filter_views", sheet: op.sheet, views: sheet.filterViews ?? null } };
      }
      case "set_tab_color": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const next: Sheet = { ...sheet };
        if (op.color) next.tabColor = op.color;
        else delete next.tabColor;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_tab_color", sheet: op.sheet, color: sheet.tabColor ?? null } };
      }
      case "set_sheet_hidden": {
        const { sheet, index } = findSheet(wb, op.sheet);
        if (!!sheet.hidden === op.hidden) return { state: wb, inverse: op };
        if (op.hidden && !sharing() && wb.sheets.every((x) => x.id === sheet.id || x.hidden)) throw new PliError("invalid_operation", "A workbook needs at least one sheet that isn't hidden");
        const next: Sheet = { ...sheet };
        if (op.hidden) next.hidden = true;
        else delete next.hidden;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_sheet_hidden", sheet: op.sheet, hidden: !op.hidden } };
      }
      case "add_chart": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const chart = cleanChart(op.chart);
        if (sheet.charts?.some((c) => c.id === chart.id)) throw new PliError("invalid_operation", `There is already a chart with id "${chart.id}"`);
        const charts = (sheet.charts ?? []).slice();
        const at = placeAt(charts, op.after, op.index);
        charts.splice(at, 0, chart);
        return { state: replaceSheet(wb, index, { ...sheet, charts }), inverse: { type: "delete_chart", sheet: op.sheet, id: chart.id, at, prev: charts[at - 1]?.id ?? null } };
      }
      case "update_chart": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.charts?.findIndex((c) => c.id === op.chart.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No chart with id "${op.chart.id}"`);
        const charts = sheet.charts!.slice();
        const old = charts[at]!;
        charts[at] = cleanChart(op.chart);
        return { state: replaceSheet(wb, index, { ...sheet, charts }), inverse: { type: "update_chart", sheet: op.sheet, chart: old } };
      }
      case "delete_chart": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.charts?.findIndex((c) => c.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No chart with id "${op.id}"`);
        const charts = sheet.charts!.slice();
        const [old] = charts.splice(at, 1);
        const next: Sheet = { ...sheet, charts };
        if (!charts.length) delete next.charts;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_chart", sheet: op.sheet, chart: old!, index: at, after: charts[at - 1]?.id ?? null } };
      }
      case "add_merge": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const range = cleanMerge(op.range);
        const b = parseRange(range)!;
        if (mergedRanges(sheet).some((m) => overlaps(m, b))) throw new PliError("invalid_operation", `${range} overlaps cells that are already merged`);
        return { state: replaceSheet(wb, index, { ...sheet, merges: [...(sheet.merges ?? []), range] }), inverse: { type: "remove_merge", sheet: op.sheet, range } };
      }
      case "remove_merge": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const range = cleanMerge(op.range);
        const at = sheet.merges?.indexOf(range) ?? -1;
        if (at < 0) throw new PliError("not_found", `${range} isn't merged`);
        const merges = sheet.merges!.filter((_, i) => i !== at);
        const next: Sheet = { ...sheet, merges };
        if (!merges.length) delete next.merges;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_merge", sheet: op.sheet, range } };
      }
      case "add_rule": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const rule = cleanRule(op.rule);
        if (sheet.conditional?.some((r) => r.id === rule.id)) throw new PliError("invalid_operation", `There is already a rule with id "${rule.id}"`);
        const conditional = (sheet.conditional ?? []).slice();
        const at = placeAt(conditional, op.after, op.index);
        conditional.splice(at, 0, rule);
        return { state: replaceSheet(wb, index, { ...sheet, conditional }), inverse: { type: "delete_rule", sheet: op.sheet, id: rule.id, at, prev: conditional[at - 1]?.id ?? null } };
      }
      case "update_rule": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.conditional?.findIndex((r) => r.id === op.rule.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No rule with id "${op.rule.id}"`);
        const conditional = sheet.conditional!.slice();
        const old = conditional[at]!;
        conditional[at] = cleanRule(op.rule);
        return { state: replaceSheet(wb, index, { ...sheet, conditional }), inverse: { type: "update_rule", sheet: op.sheet, rule: old } };
      }
      case "delete_rule": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.conditional?.findIndex((r) => r.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No rule with id "${op.id}"`);
        const conditional = sheet.conditional!.slice();
        const [old] = conditional.splice(at, 1);
        const next: Sheet = { ...sheet, conditional };
        if (!conditional.length) delete next.conditional;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_rule", sheet: op.sheet, rule: old!, index: at, after: conditional[at - 1]?.id ?? null } };
      }
      case "add_table": {
        const { sheet, index } = findSheet(wb, op.sheet);
        checkTable(wb, sheet, op.table);
        const table = cleanTable(op.table);
        const tables = (sheet.tables ?? []).slice();
        const at = placeAt(tables, op.after, op.index);
        tables.splice(at, 0, table);
        return { state: replaceSheet(wb, index, { ...sheet, tables }), inverse: { type: "delete_table", sheet: op.sheet, id: table.id, at, prev: tables[at - 1]?.id ?? null } };
      }
      case "update_table": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.tables?.findIndex((t) => t.id === op.table.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No table with id "${op.table.id}"`);
        const tables = sheet.tables!.slice();
        const old = tables[at]!;
        checkTable(wb, sheet, op.table);
        tables[at] = cleanTable(op.table);
        return { state: replaceSheet(wb, index, { ...sheet, tables }), inverse: { type: "update_table", sheet: op.sheet, table: old } };
      }
      case "delete_table": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.tables?.findIndex((t) => t.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No table with id "${op.id}"`);
        const tables = sheet.tables!.slice();
        const [old] = tables.splice(at, 1);
        const next: Sheet = { ...sheet, tables };
        if (!tables.length) delete next.tables;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_table", sheet: op.sheet, table: old!, index: at, after: tables[at - 1]?.id ?? null } };
      }
      case "add_image": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const image = cleanImage(op.image);
        if (wb.sheets.some((s) => s.images?.some((x) => x.id === image.id))) throw new PliError("invalid_operation", `There is already a picture with id "${image.id}"`);
        const images = (sheet.images ?? []).slice();
        const at = placeAt(images, op.after, op.index);
        images.splice(at, 0, image);
        return { state: replaceSheet(wb, index, { ...sheet, images }), inverse: { type: "delete_image", sheet: op.sheet, id: image.id, at, prev: images[at - 1]?.id ?? null } };
      }
      case "update_image": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.images?.findIndex((x) => x.id === op.image.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No picture with id "${op.image.id}"`);
        const images = sheet.images!.slice();
        const old = images[at]!;
        images[at] = cleanImage(op.image);
        return { state: replaceSheet(wb, index, { ...sheet, images }), inverse: { type: "update_image", sheet: op.sheet, image: old } };
      }
      case "delete_image": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.images?.findIndex((x) => x.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No picture with id "${op.id}"`);
        const images = sheet.images!.slice();
        const [old] = images.splice(at, 1);
        const next: Sheet = { ...sheet, images };
        if (!images.length) delete next.images;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_image", sheet: op.sheet, image: old!, index: at, after: images[at - 1]?.id ?? null } };
      }
      case "add_slicer": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const slicer = checkSlicer(wb, op.slicer);
        if (wb.sheets.some((s) => s.slicers?.some((x) => x.id === slicer.id))) throw new PliError("invalid_operation", `There is already a slicer with id "${slicer.id}"`);
        const slicers = (sheet.slicers ?? []).slice();
        const at = placeAt(slicers, op.after, op.index);
        slicers.splice(at, 0, slicer);
        return { state: replaceSheet(wb, index, { ...sheet, slicers }), inverse: { type: "delete_slicer", sheet: op.sheet, id: slicer.id, at, prev: slicers[at - 1]?.id ?? null } };
      }
      case "update_slicer": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.slicers?.findIndex((x) => x.id === op.slicer.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No slicer with id "${op.slicer.id}"`);
        const slicers = sheet.slicers!.slice();
        const old = slicers[at]!;
        slicers[at] = checkSlicer(wb, op.slicer);
        return { state: replaceSheet(wb, index, { ...sheet, slicers }), inverse: { type: "update_slicer", sheet: op.sheet, slicer: old } };
      }
      case "delete_slicer": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.slicers?.findIndex((x) => x.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No slicer with id "${op.id}"`);
        const slicers = sheet.slicers!.slice();
        const [old] = slicers.splice(at, 1);
        const next: Sheet = { ...sheet, slicers };
        if (!slicers.length) delete next.slicers;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_slicer", sheet: op.sheet, slicer: old!, index: at, after: slicers[at - 1]?.id ?? null } };
      }
      case "add_timeline": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const timeline = checkTimeline(wb, op.timeline);
        if (wb.sheets.some((s) => s.timelines?.some((x) => x.id === timeline.id))) throw new PliError("invalid_operation", `There is already a timeline with id "${timeline.id}"`);
        const timelines = (sheet.timelines ?? []).slice();
        const at = placeAt(timelines, op.after, op.index);
        timelines.splice(at, 0, timeline);
        return { state: replaceSheet(wb, index, { ...sheet, timelines }), inverse: { type: "delete_timeline", sheet: op.sheet, id: timeline.id, at, prev: timelines[at - 1]?.id ?? null } };
      }
      case "update_timeline": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.timelines?.findIndex((x) => x.id === op.timeline.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No timeline with id "${op.timeline.id}"`);
        const timelines = sheet.timelines!.slice();
        const old = timelines[at]!;
        timelines[at] = checkTimeline(wb, op.timeline);
        return { state: replaceSheet(wb, index, { ...sheet, timelines }), inverse: { type: "update_timeline", sheet: op.sheet, timeline: old } };
      }
      case "delete_timeline": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.timelines?.findIndex((x) => x.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No timeline with id "${op.id}"`);
        const timelines = sheet.timelines!.slice();
        const [old] = timelines.splice(at, 1);
        const next: Sheet = { ...sheet, timelines };
        if (!timelines.length) delete next.timelines;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_timeline", sheet: op.sheet, timeline: old!, index: at, after: timelines[at - 1]?.id ?? null } };
      }
      case "set_slicer_style": {
        const existing = Object.keys(wb.slicerStyles ?? {}).find((n) => n.toLowerCase() === op.name.toLowerCase());
        const slicerStyles = { ...wb.slicerStyles };
        if (existing) delete slicerStyles[existing];
        if (op.style !== null) {
          const name = cleanSlicerStyleName(op.name);
          // Excel keeps a slicer style next to a table style of the same name, so the two can't share one.
          if (Object.keys(wb.tableStyles ?? {}).some((n) => n.toLowerCase() === name.toLowerCase())) throw new PliError("invalid_operation", `There is a table style called "${name}"; a slicer style needs another name`);
          slicerStyles[name] = cleanSlicerStyle(op.style);
        }
        const state: Workbook = { ...wb };
        if (Object.keys(slicerStyles).length) state.slicerStyles = slicerStyles;
        else delete state.slicerStyles;
        return { state, inverse: { type: "set_slicer_style", name: existing ?? op.name, style: existing ? wb.slicerStyles![existing]! : null } };
      }
      case "set_pivot_book": {
        const { type: _t, ...patch } = op;
        const { state, inverse } = applyPivotBook(wb, patch);
        return { state, inverse: { type: "set_pivot_book", ...inverse } };
      }
      case "set_table_style": {
        const existing = Object.keys(wb.tableStyles ?? {}).find((n) => n.toLowerCase() === op.name.toLowerCase());
        const tableStyles = { ...wb.tableStyles };
        if (existing) delete tableStyles[existing];
        if (op.style !== null) {
          const name = cleanTableStyleName(op.name);
          if (Object.keys(wb.slicerStyles ?? {}).some((n) => n.toLowerCase() === name.toLowerCase())) throw new PliError("invalid_operation", `There is a slicer style called "${name}"; a table style needs another name`);
          tableStyles[name] = cleanTableStyle(op.style);
        }
        const state: Workbook = { ...wb };
        if (Object.keys(tableStyles).length) state.tableStyles = tableStyles;
        else delete state.tableStyles;
        return { state, inverse: { type: "set_table_style", name: existing ?? op.name, style: existing ? wb.tableStyles![existing]! : null } };
      }
      case "add_validation": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const rule = cleanValidation(op.validation);
        if (sheet.validations?.some((r) => r.id === rule.id)) throw new PliError("invalid_operation", `There is already a validation with id "${rule.id}"`);
        const validations = (sheet.validations ?? []).slice();
        const at = placeAt(validations, op.after, op.index);
        validations.splice(at, 0, rule);
        return { state: replaceSheet(wb, index, { ...sheet, validations }), inverse: { type: "delete_validation", sheet: op.sheet, id: rule.id, at, prev: validations[at - 1]?.id ?? null } };
      }
      case "update_validation": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.validations?.findIndex((r) => r.id === op.validation.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No validation with id "${op.validation.id}"`);
        const validations = sheet.validations!.slice();
        const old = validations[at]!;
        validations[at] = cleanValidation(op.validation);
        return { state: replaceSheet(wb, index, { ...sheet, validations }), inverse: { type: "update_validation", sheet: op.sheet, validation: old } };
      }
      case "delete_validation": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.validations?.findIndex((r) => r.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No validation with id "${op.id}"`);
        const validations = sheet.validations!.slice();
        const [old] = validations.splice(at, 1);
        const next: Sheet = { ...sheet, validations };
        if (!validations.length) delete next.validations;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_validation", sheet: op.sheet, validation: old!, index: at, after: validations[at - 1]?.id ?? null } };
      }
      case "add_sparklines": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const group = cleanSparklines(op.group);
        if (wb.sheets.some((s) => s.sparklines?.some((x) => x.id === group.id))) throw new PliError("invalid_operation", `There are sparklines with id "${group.id}" already`);
        const taken = new Set((sheet.sparklines ?? []).flatMap((x) => x.items.map((i) => i.cell)));
        for (const item of group.items) if (taken.has(item.cell)) throw new PliError("invalid_operation", `${item.cell} has a sparkline already`);
        const list = (sheet.sparklines ?? []).slice();
        const at = placeAt(list, op.after, op.index);
        list.splice(at, 0, group);
        return { state: replaceSheet(wb, index, { ...sheet, sparklines: list }), inverse: { type: "delete_sparklines", sheet: op.sheet, id: group.id, at, prev: list[at - 1]?.id ?? null } };
      }
      case "update_sparklines": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.sparklines?.findIndex((x) => x.id === op.group.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No sparklines with id "${op.group.id}"`);
        const group = cleanSparklines(op.group);
        const taken = new Set(sheet.sparklines!.filter((_, i) => i !== at).flatMap((x) => x.items.map((i) => i.cell)));
        for (const item of group.items) if (taken.has(item.cell)) throw new PliError("invalid_operation", `${item.cell} has a sparkline already`);
        const list = sheet.sparklines!.slice();
        const old = list[at]!;
        list[at] = group;
        return { state: replaceSheet(wb, index, { ...sheet, sparklines: list }), inverse: { type: "update_sparklines", sheet: op.sheet, group: old } };
      }
      case "delete_sparklines": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.sparklines?.findIndex((x) => x.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No sparklines with id "${op.id}"`);
        const list = sheet.sparklines!.slice();
        const [old] = list.splice(at, 1);
        const next: Sheet = { ...sheet, sparklines: list };
        if (!list.length) delete next.sparklines;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_sparklines", sheet: op.sheet, group: old!, index: at, after: list[at - 1]?.id ?? null } };
      }
      case "add_pivot": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const pivot = cleanPivot(op.pivot);
        const others = wb.sheets.flatMap((x) => x.pivots ?? []);
        if (others.some((x) => x.id === pivot.id)) throw new PliError("invalid_operation", `There is a pivot table with id "${pivot.id}" already`);
        if (!sharing() && others.some((x) => x.name.toLowerCase() === pivot.name.toLowerCase())) throw new PliError("invalid_operation", `There is a pivot table called "${pivot.name}" already`);
        const list = (sheet.pivots ?? []).slice();
        const at = placeAt(list, op.after, op.index);
        list.splice(at, 0, pivot);
        return { state: replaceSheet(wb, index, { ...sheet, pivots: list }), inverse: { type: "delete_pivot", sheet: op.sheet, id: pivot.id, at, prev: list[at - 1]?.id ?? null } };
      }
      case "update_pivot": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.pivots?.findIndex((x) => x.id === op.pivot.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No pivot table with id "${op.pivot.id}"`);
        const pivot = cleanPivot(op.pivot);
        if (!sharing() && wb.sheets.flatMap((x) => x.pivots ?? []).some((x) => x.id !== pivot.id && x.name.toLowerCase() === pivot.name.toLowerCase())) throw new PliError("invalid_operation", `There is a pivot table called "${pivot.name}" already`);
        const list = sheet.pivots!.slice();
        const old = list[at]!;
        list[at] = pivot;
        return { state: replaceSheet(wb, index, { ...sheet, pivots: list }), inverse: { type: "update_pivot", sheet: op.sheet, pivot: old } };
      }
      case "delete_pivot": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const at = sheet.pivots?.findIndex((x) => x.id === op.id) ?? -1;
        if (at < 0) throw new PliError("not_found", `No pivot table with id "${op.id}"`);
        const list = sheet.pivots!.slice();
        const [old] = list.splice(at, 1);
        const next: Sheet = { ...sheet, pivots: list };
        if (!list.length) delete next.pivots;
        return { state: replaceSheet(wb, index, next), inverse: { type: "add_pivot", sheet: op.sheet, pivot: old!, index: at, after: list[at - 1]?.id ?? null } };
      }
      case "set_outline": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const next: Sheet = { ...sheet };
        const o = { ...sheet.outline };
        if (op.summaryAbove !== undefined) (op.summaryAbove ? (o.summaryAbove = true) : delete o.summaryAbove);
        if (op.summaryLeft !== undefined) (op.summaryLeft ? (o.summaryLeft = true) : delete o.summaryLeft);
        if (Object.keys(o).length) next.outline = o;
        else delete next.outline;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_outline", sheet: op.sheet, summaryAbove: !!sheet.outline?.summaryAbove, summaryLeft: !!sheet.outline?.summaryLeft } };
      }
      case "set_page": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const next: Sheet = { ...sheet };
        const page = op.page ? cleanPageSetup(op.page) : null;
        if (page) next.page = page;
        else delete next.page;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_page", sheet: op.sheet, page: sheet.page ?? null } };
      }
      case "set_protection": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const next: Sheet = { ...sheet };
        if (op.protection) next.protection = cleanSheetProtection(op.protection);
        else delete next.protection;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_protection", sheet: op.sheet, protection: sheet.protection ?? null } };
      }
      case "set_locks": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const inverse: SheetOp = { type: "set_locks", sheet: op.sheet, ...(op.unlocked !== undefined ? { unlocked: sheet.unlocked ? true : null } : {}), ...(op.columns ? { columns: locksOf(sheet.columns, Object.keys(op.columns)) } : {}), ...(op.rows ? { rows: locksOf(sheet.rows, Object.keys(op.rows)) } : {}) };
        for (const k of Object.keys(op.columns ?? {})) if (!(colNumber(k) >= 1 && colNumber(k) <= MAX_COLS) || colName(colNumber(k)) !== k) throw new PliError("out_of_range", `No column ${k}`);
        for (const k of Object.keys(op.rows ?? {})) if (!(Number.isInteger(Number(k)) && Number(k) >= 1 && Number(k) <= MAX_ROWS)) throw new PliError("out_of_range", `No row ${k}`);
        return { state: replaceSheet(wb, index, applyLocks(sheet, op)), inverse };
      }
      case "set_hides": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const inverse: SheetOp = { type: "set_hides", sheet: op.sheet, ...(op.hidden !== undefined ? { hidden: sheet.hiddenFormulas ? true : null } : {}), ...(op.columns ? { columns: hidesOf(sheet.columns, Object.keys(op.columns)) } : {}), ...(op.rows ? { rows: hidesOf(sheet.rows, Object.keys(op.rows)) } : {}) };
        for (const k of Object.keys(op.columns ?? {})) if (!validColumn(k)) throw new PliError("out_of_range", `No column ${k}`);
        for (const k of Object.keys(op.rows ?? {})) if (!(Number.isInteger(Number(k)) && Number(k) >= 1 && Number(k) <= MAX_ROWS)) throw new PliError("out_of_range", `No row ${k}`);
        return { state: replaceSheet(wb, index, applyHides(sheet, op)), inverse };
      }
      case "set_edit_ranges": {
        const { sheet, index } = findSheet(wb, op.sheet);
        const next: Sheet = { ...sheet };
        const list = op.ranges ? cleanEditRanges(op.ranges) : [];
        if (list.length) next.editRanges = list;
        else delete next.editRanges;
        return { state: replaceSheet(wb, index, next), inverse: { type: "set_edit_ranges", sheet: op.sheet, ranges: sheet.editRanges ?? null } };
      }
      case "set_workbook_protection": {
        const next: Workbook = { ...wb };
        if (op.protection) next.protection = cleanWorkbookProtection(op.protection);
        else delete next.protection;
        return { state: next, inverse: { type: "set_workbook_protection", protection: wb.protection ?? null } };
      }
      case "set_iteration": {
        const next: Workbook = { ...wb };
        if (op.iteration) next.iteration = cleanIteration(op.iteration);
        else delete next.iteration;
        return { state: next, inverse: { type: "set_iteration", iteration: wb.iteration ?? null } };
      }
      case "set_external_cells": {
        const { books, inverse } = applyExternalCells(wb.externalBooks, op);
        const next: Workbook = { ...wb };
        if (books) next.externalBooks = books;
        else delete next.externalBooks;
        return { state: next, inverse };
      }
      case "set_title":
        return { state: { ...wb, title: op.title }, inverse: { type: "set_title", title: wb.title } };
      case "set_name": {
        if (!/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(op.name) || parseCell(op.name) || /^[Rr]\d*[Cc]\d*$/.test(op.name)) {
          throw new PliError("invalid_operation", `"${op.name}" can't be used as a name`);
        }
        if (findTable(wb, op.name)) throw new PliError("invalid_operation", `"${op.name}" is already a table`);
        const existing = Object.keys(wb.names ?? {}).find((n) => n.toLowerCase() === op.name.toLowerCase());
        const names = { ...wb.names };
        if (existing) delete names[existing];
        if (op.formula !== null) {
          const f = op.formula.replace(/^\s*=\s*/, "");
          parseFormula(f);
          names[op.name] = f;
        }
        const state: Workbook = { ...wb };
        if (Object.keys(names).length) state.names = names;
        else delete state.names;
        return { state, inverse: { type: "set_name", name: existing ?? op.name, formula: existing ? wb.names![existing]! : null } };
      }
      case "restore":
        return { state: op.workbook, inverse: { type: "restore", workbook: wb } };
    }
  },
};
