import { createId, PliError, Session, type ChangeEvent } from "@pli.dev/core";
import { cellAddress, colName, colNumber, parseCell, parseRange, rangeAddress, type Bounds } from "./address";
import { Calculator, type Change, type CalculatorOptions } from "./calc";
import { isDateFormat, type Formatted } from "./format";
import { cellsToTable, parseTsv, rangeToHtml, rangeToTsv } from "./clipboard";
import { FormulaSyntaxError, parseFormula, printFormula } from "./formula";
import { cellFromInput } from "./input";
import { cleanLink, cleanNote, isOpenable, isPlace, linkInText, placeOf } from "./link";
import { MAX_NOTE_LENGTH } from "./link";
import { cleanAuthor, cleanNoteBox, cleanNoteRuns, editNoteRuns, noteExtras, styleNoteRuns, type NoteInfo, type NoteLookPatch, type NoteRunStyle, type SetNoteOptions } from "./note";
import { parsePrintTitles, withPictureCode } from "./page";
import { layoutBarSparkline, layoutSparkline, sparklineAt, sparklineSvg, type SparkShape } from "./sparkline";
import { SUBTOTAL_CODES, SUBTOTAL_FUNCTIONS, findSubtotals, listPivots, listTables, removeSubtotalOps, subtotalColumn, subtotalOps, type SubtotalFunction, type SubtotalOptions, type SubtotalResult } from "./subtotal";
import { cleanPivot, fieldItems, pivotDetails as pivotDetailsOf, missingFields, pivotAreas, pivotAt as pivotAtCell, pivotProblem, pivotSourceRange, readPivotSource, renderPivot, renderRange, type PivotRender, type PivotSource, pivotSourceRanges } from "./pivot";
import { MODEL_SOURCE, cleanBlock, externalSourceName, findBlock, isExternalSource, isModelSource, requestOf, withBlock, type PivotDataAnswer, type PivotDataResolver, type PivotDataRows } from "./pivot-external";
import type { PivotBookPatch } from "./pivot-book";
import { areaAt, geometryOf, lookChange, withLook } from "./pivot-keep";
import { isPivotStyleName } from "./pivot-style";
import { parseCsv } from "./csv";
import { MAX_LEVEL, deepestLevel, groupOps, groupsOf, setCollapsedOps, showLevelOps, ungroupOps, type Group } from "./outline";
import { axisOffsetPx, cleanCrop, columnPixels, defaultImageSize, MIN_IMAGE_SIZE, placeImage, rangePixels, readImage, rowPixelsOf, cleanCellPicture } from "./image";
import { HEADINGS_HEIGHT, HEADINGS_WIDTH, headerFooterFor, headerFooterRuns, layoutPages, type HeaderFooterRun, type PrintLayout, type PrintPage, headerFooterSectionFor } from "./print";
import { noteBoxes, notesHtml, type PrintOverflow, type PrintScene, type PrintedCell, type PrintedNote } from "./print-more";
import { cleanIteration } from "./iteration";
import { DEFAULT_ALLOW, ProtectionError, checkPassword, cleanEditRanges, hashPassword, protectionRefusal, PERMISSION_LABELS } from "./protect";
import { hasAnyRole, mayDo, mayEditLocked, openAt, rangeBounds, rangeKey, rangeStatus, type Access, type SheetUser } from "./access";
import { anyLocked, defaultLock, lockAt, lockChange, lockOfKey } from "./locks";
import { anyFormulaHidden, defaultHide, hideAt, hideChange, hideOfKey } from "./hide";
import type { EditRange } from "./model";
import { MATCH_ANY, hasFormat, matcherOf, typedText, type FindOptions, type FoundCell, type ReplaceResult } from "./find";
import { cleanCriterion, cleanFilterRule, criterionTest, type FilterCell } from "./filter";
import { cleanViewName } from "./filterview";
import { buildDateTree, dateFilterOf, type DateTree } from "./datetree";
import { cellChoices, checkAgainstControl, checkboxValues, choicesIn, joinChoices } from "./control";
import { applyOp, cleanCell, fillCalculated, mapFormulas, sharedReducer, sheetReducer, type SheetOp } from "./ops";
import { stampOps } from "./ops-stamp";
import { CommentCommands, withoutDuplicateThreads } from "./comments";
import { moveReferences, shiftFormula } from "./refs";
import { CHART_COLORS, DEFAULT_CHART_HEIGHT, DEFAULT_CHART_WIDTH, chartRef, chartRefText, defaultView3d, readChart, seriesForType, type ChartData } from "./chart";
import { chartOrientation, pickByRows, switchRowsColumns } from "./chart-rows";
import { ConditionalFormats, type CellEffect } from "./conditional";
import { resolveTableStyle, tableLook } from "./tablestyle";
import { DEFAULT_SLICER_HEIGHT, DEFAULT_SLICER_WIDTH, isOrphanPanel } from "./slicer";
import { DEFAULT_TIMELINE_HEIGHT, DEFAULT_TIMELINE_WIDTH, periodEnd, periodStart, periodsBetween, rangeGroups, selectionOfFilter, type TimelinePeriod } from "./timeline";
import { DEFAULT_PIVOT_SLICER_HEIGHT, DEFAULT_PIVOT_SLICER_WIDTH, DEFAULT_PIVOT_TIMELINE_HEIGHT, DEFAULT_PIVOT_TIMELINE_WIDTH, pivotPanelOfSlicer, pivotSlicerAsSlicer, pivotTimelineAsSlicer, pivotTimelineItems, pivotSlicerItems as pivotSlicerItemsOf, pivotSlicerSelect as pivotSlicerSelectOf, pivotTimelineSelect as pivotTimelineSelectOf, timelineBounds, type PivotSlicerItem } from "./pivot-slicer";
import { parseHtmlTable } from "./html";
import { blendCell, planHtmlPaste } from "./pastehtml";
import { copiedTable, copyTableName, renameTableIn, type PasteContent, type PasteOptions } from "./paste";
import { fillClash, filledMerges, mergeClash } from "./merge-move";
import { planTransposedCopy } from "./transpose-copy";
import { pivotRuleFallback, pivotScopeProblem, pivotScopeRanges, pivotSelectionScope } from "./pivot-format";
import { formatValue } from "./format";
import { mapRuleFormulas } from "./rule";
import { mapValidationFormulas } from "./validation";
import { cleanBorder, mergeAt, mergedRanges, overlaps, ruleBounds } from "./rule";
import { builtinSlicerStyle } from "./slicerstyle";
import { cleanSortLevel, cleanSortLevels, compareRows, sortLevels, tableSortOf, type RangeSortLevel, type SortCell, type SortKey } from "./sortlevels";
import { allTables, dataRows, findTable, freshColumnName, hasHeader, renameColumnInFormulas, renameTableInFormulas, tableAt as tableAtCell, tableColumns, tableRefsToRanges, checkTable } from "./table";
import { entryAllowed, listChoices, problemOf, itemsInCell, DEFAULT_SEPARATOR, type EntryContext, type EntryProblem } from "./validation";
import { describePasteReport, pasteProblems, type PasteContext, type PasteReport, type ValidatePaste } from "./validation-paste";
import { MAX_ASK, askPart, collectExternalRefs, collectExternalTables, keptCells, type ExternalReference } from "./external-links";
import { applyExternalCells } from "./external-sheets";
import { cleanExternalTable } from "./external-tables";
import { fillValidationOps, type FillPair } from "./validation-fill";
import { MAX_SNAPSHOT_ITEMS, externalPart, parseExternalRef, readDay, snapshotItems, type ExternalListResolver, type ExternalListStatus, type ExternalRefresh, type ExternalTableResolver } from "./external-list";
import { MAX_COLS, MAX_ROWS, emptyCell, type Border, type Cell, type CellLink, type CellPicture, type CellBorders, type CellControl, type Chart, type ChartSeries, type ChartType, type CellStyle, type ConditionalRule, type FilterCriterion, type FilterRule, type ImageBorder, type ImageCrop, type ImagePlacement, type ImageShadow, type IterationSettings, type PageSetup, type Permission, type Pivot, type PivotAxisField, type PivotCalculatedField, type PivotGroup, type PivotValue, type Sheet, type SheetFilter, type SheetImage, type SheetProtection, type Slicer, type SparklineGroup, type Table, type TableStyleDef, type Validation, type Workbook, type ImageArtistic, type ImageShape, type ImageGlow, type ImageReflection, type NoteBox, type FilterView, type Timeline, type TimelineLevel, type HeaderFooterPicture, type HeaderFooterPictures, type HeaderFooterSection, type PivotCalculatedItem, type PivotRange, type PivotSlicer, type PivotStyle, type PivotTimeline, type SortLevel, type IconRef, type SlicerStyleDef, type FilterViewTable, type ExternalBook, type ExternalTable, type PivotFormat, type PivotStyleDef, type DataBlock, type DataModel } from "./model";
import { compareValues, isError, type Value } from "./values";

const MAX_CELLS_AT_ONCE = 2_000_000;

export interface SheetSessionOptions extends CalculatorOptions {
  /** What to do about pasted, moved, filled or sorted cells that break a data validation rule: `off` (like Excel, the default), `warn` or `refuse`. */
  validatePaste?: ValidatePaste;
  /** Reads lists that data validation takes from another workbook (`[Prices.xlsx]Sheet1!$A$1:$A$10`); without it the snapshot kept in the workbook is used. */
  externalLists?: ExternalListResolver;
  /** Finds tables of other workbooks that formulas name (`[Prices.xlsx]Orders[Total]`): where each is and what its columns are called; the cells come from `externalLists`. */
  externalTables?: ExternalTableResolver;
  /** Supplies the data of pivot tables that read outside the workbook (another workbook's range, a `data:Name` block); without it the rows kept in the workbook are used. */
  pivotData?: PivotDataResolver;
  /** Who writes the notes made in this session (the name of the person using the editor). A note without it has no author. */
  author?: string;
  /** Who is using the sheet, for the roles that protected sheets and ranges that may be edited name (see `setUser`). */
  user?: SheetUser | null;
}

export type SheetChangeEvent = ChangeEvent<Workbook, SheetOp>;

/** What `refreshPivotData` found. */
export interface PivotDataRefresh {
  /** Sources whose rows changed, and sources that were the same. */
  updated: number;
  unchanged: number;
  /** Sources the host could not read (or that could not be drawn again), with why; the rows kept in the workbook stay in use. */
  failed: { source: string; reason: string }[];
  /** There was no resolver to ask. */
  offline: boolean;
  /** How many pivot tables were drawn again. */
  pivots: number;
}

/** Which lines `setBorders` draws: around the range (`outer`), between its cells (`inner`, or just `horizontal` or `vertical` ones), on one side, everywhere (`all`), or none at all. */
export type BorderWhere = "all" | "outer" | "inner" | "horizontal" | "vertical" | "top" | "bottom" | "left" | "right" | "diagonalUp" | "diagonalDown" | "none";

type Side = keyof CellBorders;

/** A rule as `addRule` takes it: the id is made if missing. */
export type ValidationSpec = Validation extends infer R ? (R extends Validation ? Omit<R, "id"> & { id?: string } : never) : never;

export type RuleSpec = ConditionalRule extends infer R ? (R extends ConditionalRule ? Omit<R, "id"> & { id?: string } : never) : never;

/** A new workbook with one empty sheet called Sheet1. */
/** A page as it prints (see `printPage`). */
export interface PrintedPage {
  html: string;
  /** The size of the page's content in points, before it is scaled. */
  width: number;
  height: number;
  /** Where the page's own cells (not the repeated titles) sit in it, in points. */
  main: { x: number; y: number; width: number; height: number };
  /** Where those cells start on the sheet, in pixels. */
  origin: { x: number; y: number };
  header: Record<"left" | "center" | "right", HeaderFooterRun[]>;
  footer: Record<"left" | "center" | "right", HeaderFooterRun[]>;
  /** The cells whose text runs on over the empty cells beside them (the HTML already has them laid out so). */
  overflow: PrintOverflow[];
  /** The notes that print over the sheet on this page (`comments: "sheet"`), in points from the top left of `main`. */
  notes: PrintedNote[];
  /** Whether charts, pictures and sparklines print (not in draft quality); `html` already leaves out the ones in cells. */
  graphics: boolean;
  /** Black and white: the HTML has no colours, and what is drawn over it (charts, pictures, notes) should have none either. */
  mono: boolean;
  /** The page's cells as numbers (only when `printPage` is asked for the `scene`): what a PDF is drawn from. */
  scene?: PrintScene;
}

/** Throws a refusal that says what is wrong. */
const bad = (message: string): never => {
  throw new PliError("invalid_operation", message);
};

export function createWorkbook(title = "Untitled", sheetNames: readonly string[] = ["Sheet1"]): Workbook {
  return {
    id: createId("wb_"),
    type: "workbook",
    title,
    sheets: sheetNames.map((name) => ({ id: createId("sheet_"), name, cells: {} })),
  };
}

/** A slicer or timeline to put with a pivot table: its field, and the rest left to be filled in. */
export type PivotPanelSpec<T extends PivotSlicer | PivotTimeline> = Partial<T> & { field: string };

/**
 * A workbook being edited: every change is an operation on the session (so it can be undone, logged and sent), and
 * formulas are kept up to date as cells change.
 */
export class SheetSession {
  readonly session: Session<Workbook, SheetOp>;
  readonly calculator: Calculator;
  readonly #formats: ConditionalFormats;
  readonly #options: SheetSessionOptions;
  /** Comment threads: `session.comments.enable({ users })` turns them on. */
  readonly comments = new CommentCommands(this);
  /** True while a `SyncClient` keeps this workbook in step with a shared one (set by whatever starts it): comments then travel with the changes. */
  syncing = false;
  /** Who writes the notes made from now on: new notes record it as their author. Never set unless the host sets it. */
  author: string | undefined;

  constructor(workbook: Workbook = createWorkbook(), options: SheetSessionOptions = {}) {
    this.#options = options;
    this.author = options.author;
    this.#user = options.user ?? null;
    this.session = new Session<Workbook, SheetOp>(workbook, sharedReducer(() => this.syncing));
    this.calculator = new Calculator(workbook, options);
    this.#formats = new ConditionalFormats(this.calculator);
    this.session.subscribe((event) => {
      this.calculator.update(event.state, changeOf(event));
      this.#formats.invalidate();
    });
  }

  get state(): Workbook {
    return this.session.state;
  }
  /** The core session that holds the workbook and its history: what `SyncClient` and `attachSync` work on. */
  get core(): Session<Workbook, SheetOp> {
    return this.session;
  }
  get canUndo(): boolean {
    return this.session.canUndo;
  }
  get canRedo(): boolean {
    return this.session.canRedo;
  }
  undo(): boolean {
    return this.session.undo();
  }
  redo(): boolean {
    return this.session.redo();
  }
  subscribe(listener: (event: SheetChangeEvent) => void): () => void {
    return this.session.subscribe(listener);
  }
  /** Replaces the whole workbook and forgets the history, as when a file is opened. */
  load(workbook: Workbook): void {
    this.#opened.clear();
    this.session.reset(workbook);
  }
  /** Applies operations as one undoable step (`merge` folds them into the previous step; `history: false` makes them no step at all). */
  transact(ops: readonly SheetOp[], options: { merge?: boolean; history?: false } = {}): void {
    this.commit(ops, options);
  }

  #pending: SheetOp[] | null = null;

  #bypass = 0;

  #user: SheetUser | null = null;

  /** The edit ranges whose password was given, by `rangeKey`: remembered while the session lives. */
  readonly #opened = new Set<string>();

  #drawing = 0;

  private commit(ops: readonly SheetOp[], options: { merge?: boolean; history?: false; vet?: PasteContext } = {}): void {
    let report: PasteReport | undefined;
    if (options.vet) {
      ({ ops, report } = this.#vet(ops, options.vet));
      options = { ...options, vet: undefined };
    }
    let looks: (() => void) | undefined;
    if (!this.#drawing && !this.#bypass) ({ ops, apply: looks } = this.#keepPivotLooks(ops));
    if (!this.#drawing) this.#refusePivotEdits(ops);
    if (!this.#bypass && (this.state.protection || this.state.sheets.some((s) => s.protection))) {
      ops = this.#keepLocks(ops);
      const detail: { editRange?: { sheet: string; name: string } } = {};
      const why = protectionRefusal(this.state, ops, this.#access(), detail);
      if (why) throw new ProtectionError(why, detail.editRange);
    }
    if (this.#pending) this.#pending.push(...ops);
    else if (ops.length) {
      ops = this.#ready(ops);
      this.session.transact(ops, this.#joining ? { ...options, merge: true } : options);
      if (!this.#drawing && !this.#joining) this.#autoRefresh(ops);
    }
    if (looks) {
      // The looks given to cells of a pivot table are kept in the table and drawn with it, in the same undo step as the edit.
      this.#joining += ops.length && !this.#pending ? 1 : 0;
      try {
        looks();
      } finally {
        this.#joining -= ops.length && !this.#pending ? 1 : 0;
      }
    }
    if (report) this.#announce(report);
  }

  /**
   * Colours, fonts and number formats given to the cells of a pivot table are not changes to its cells: they are kept in the
   * table (`Pivot.formats`) by what each cell stands for, and drawn again with it. Returns the edit without them, and what
   * keeps them.
   */
  #keepPivotLooks(ops: readonly SheetOp[]): { ops: readonly SheetOp[]; apply?: () => void } {
    if (!ops.some((op) => op.type === "set_cells" && this.state.sheets.find((x) => x.id === op.sheet)?.pivots?.length)) return { ops };
    const out: SheetOp[] = [];
    const kept = new Map<string, { sheet: Sheet; pivot: Pivot; formats: PivotFormat[] }>();
    const geometry = new Map<string, ReturnType<typeof geometryOf> | null>();
    for (const op of ops) {
      const sheet = op.type === "set_cells" ? this.state.sheets.find((x) => x.id === op.sheet) : undefined;
      if (op.type !== "set_cells" || !sheet?.pivots?.length) {
        out.push(op);
        continue;
      }
      const rest: Record<string, Cell | null> = {};
      for (const [address, cell] of Object.entries(op.cells)) {
        const at = parseCell(address);
        const pivot = at && sheet.pivots.find((p) => {
          const b = parseRange(p.range)!;
          return at.row >= b.r1 && at.row <= b.r2 && at.col >= b.c1 && at.col <= b.c2;
        });
        const look = pivot && lookChange(sheet.cells[address], cell);
        if (!at || !pivot || !look) {
          rest[address] = cell;
          continue;
        }
        let geo = geometry.get(pivot.id);
        if (geo === undefined) {
          const src = this.#pivotSource(pivot, sheet.name);
          geo = src ? geometryOf(pivot, renderPivot(pivot, src)) : null;
          geometry.set(pivot.id, geo);
        }
        const origin = parseCell(pivot.anchor)!;
        const area = geo && areaAt(geo, at.row - origin.row, at.col - origin.col);
        // The cells that stand for nothing in particular (the corner, the filters) don't keep a look.
        if (!area) continue;
        const entry = kept.get(pivot.id) ?? { sheet, pivot, formats: [...(pivot.formats ?? [])] };
        entry.formats = withLook(entry.formats, area, look);
        kept.set(pivot.id, entry);
      }
      if (Object.keys(rest).length) out.push({ ...op, cells: rest });
    }
    if (!kept.size) return { ops: out };
    return {
      ops: out,
      apply: () => {
        for (const { sheet, pivot, formats } of kept.values()) {
          const now = this.state.sheets.find((x) => x.id === sheet.id)?.pivots?.find((p) => p.id === pivot.id) ?? pivot;
          this.#drawPivot(this.sheet(sheet.id), { ...now, formats }, now, false);
        }
      },
    };
  }

  #joining = 0;

  /** The operations made ready to apply and to share: a copied cell goes without the comment thread of the one it was copied from, and each says what its sheet is called and where it sits (see `stampOps`). */
  #ready(ops: readonly SheetOp[]): SheetOp[] {
    return stampOps(this.state, withoutDuplicateThreads(this.state, ops));
  }

  /** Draws again the pivot tables that read what these changes touched and ask to follow it, in the same undo step. */
  #autoRefresh(ops: readonly SheetOp[]): void {
    const todo = this.state.sheets.flatMap((s) => (s.pivots ?? []).filter((p) => p.autoRefresh).map((p) => ({ s, p })));
    if (!todo.length) return;
    for (const { s, p } of todo) {
      const froms = pivotAreas(this.state, p, s.name);
      if (!froms) continue;
      const touched = ops.some((op) => {
        if (op.type === "set_cells") {
          return froms.some((from) => {
            if (op.sheet !== from.sheet.id) return false;
            return Object.keys(op.cells).some((address) => {
              const at = parseCell(address);
              return !!at && at.row >= from.bounds.r1 && at.row <= from.bounds.r2 && at.col >= from.bounds.c1 && at.col <= from.bounds.c2;
            });
          });
        }
        if (op.type === "insert_rows" || op.type === "delete_rows" || op.type === "insert_cols" || op.type === "delete_cols") return froms.some((from) => op.sheet === from.sheet.id);
        if (op.type === "add_table" || op.type === "update_table" || op.type === "delete_table") return froms.some((from) => op.sheet === from.sheet.id);
        if (op.type === "set_pivot_book") return isModelSource(p.source) || isExternalSource(p.source);
        return op.type === "restore" || op.type === "rename_sheet";
      });
      if (!touched) continue;
      this.#joining++;
      try {
        this.#drawPivot(this.sheet(s.id), this.sheet(s.id).pivots!.find((x) => x.id === p.id)!, p, false);
      } catch {
        // A source that has gone, or a table that no longer fits, leaves the pivot table as it was.
      } finally {
        this.#joining--;
      }
    }
  }

  /**
   * Runs several edits as one undo step. Inside, each edit reads the workbook as it was before the batch, so use it for
   * edits to different cells, such as the same format on several ranges.
   */
  batch(fn: () => void): void {
    if (this.#pending) return fn();
    this.#pending = [];
    try {
      fn();
      const ops = this.#ready(this.#pending);
      this.#pending = null;
      this.session.transact(ops);
      if (!this.#drawing && !this.#joining) this.#autoRefresh(ops);
    } finally {
      this.#pending = null;
    }
  }

  // ---- finding sheets ----

  /** A sheet from its name (any case) or id. */
  sheet(ref: string): Sheet {
    const s = this.state.sheets.find((x) => x.id === ref) ?? this.state.sheets.find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!s) throw new PliError("not_found", `No sheet "${ref}"`);
    return s;
  }

  // ---- reading ----

  /** What is in the cell, as typed: the formula with its `=`, or the value. */
  cell(sheet: string, address: string): Cell | undefined {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    return this.sheet(sheet).cells[cellAddress(pos.row, pos.col)];
  }

  /** What the cell is worth: its value, or what its formula works out to. */
  value(sheet: string, address: string): Value {
    return this.calculator.value(this.sheet(sheet).id, address);
  }

  /** The cell as it shows, with its number format applied. */
  display(sheet: string, address: string): Formatted {
    return this.calculator.display(this.sheet(sheet).id, address);
  }

  /** The values of a range, row by row. */
  values(sheet: string, range: string): Value[][] {
    const b = this.bounds(range);
    const id = this.sheet(sheet).id;
    const out: Value[][] = [];
    for (let r = b.r1; r <= b.r2; r++) {
      const row: Value[] = [];
      for (let c = b.c1; c <= b.c2; c++) row.push(this.calculator.value(id, cellAddress(r, c)));
      out.push(row);
    }
    return out;
  }

  /** Where the sheet has anything, as a range such as `A1:D20`, or null if it is empty. */
  usedRange(sheet: string): string | null {
    let b: Bounds | null = null;
    for (const address of Object.keys(this.sheet(sheet).cells)) {
      const p = parseCell(address)!;
      b = b ? { r1: Math.min(b.r1, p.row), c1: Math.min(b.c1, p.col), r2: Math.max(b.r2, p.row), c2: Math.max(b.c2, p.col) } : { r1: p.row, c1: p.col, r2: p.row, c2: p.col };
    }
    return b ? rangeAddress(b) : null;
  }

  // ---- sparklines ----

  /** The groups of sparklines on a sheet. */
  sparklines(sheet: string): readonly SparklineGroup[] {
    return this.sheet(sheet).sparklines ?? [];
  }

  /** The sparkline drawn in a cell, with its group. */
  sparklineAt(sheet: string, address: string): { group: SparklineGroup; item: SparklineGroup["items"][number] } | undefined {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    return sparklineAt(this.sheet(sheet), cellAddress(pos.row, pos.col));
  }

  /**
   * The cells and the data of the sparklines for a place and a range of data: a column of cells takes a row of the data
   * for each, a row of cells takes a column of the data for each, and a single cell takes one row or column.
   */
  #sparklineItems(s: Sheet, location: string, data: string): SparklineGroup["items"] {
    const loc = this.bounds(location);
    const d = chartRef(data, s.name) ?? bad(`"${data}" isn't a range of cells`);
    const home = this.state.sheets.find((x) => x.name.toLowerCase() === d.sheet.toLowerCase())?.name ?? bad(`There is no sheet "${d.sheet}"`);
    const b = d.bounds;
    const items: SparklineGroup["items"] = [];
    const single = loc.r1 === loc.r2 && loc.c1 === loc.c2;
    if (single) {
      if (b.r1 !== b.r2 && b.c1 !== b.c2) bad("A single cell draws one row or one column of data");
      items.push({ cell: cellAddress(loc.r1, loc.c1), source: chartRefText(home, b) });
    } else if (loc.c1 === loc.c2) {
      if (b.r2 - b.r1 !== loc.r2 - loc.r1) bad(`${loc.r2 - loc.r1 + 1} cells need ${loc.r2 - loc.r1 + 1} rows of data, not ${b.r2 - b.r1 + 1}`);
      for (let i = 0; i <= loc.r2 - loc.r1; i++) items.push({ cell: cellAddress(loc.r1 + i, loc.c1), source: chartRefText(home, { r1: b.r1 + i, r2: b.r1 + i, c1: b.c1, c2: b.c2 }) });
    } else if (loc.r1 === loc.r2) {
      if (b.c2 - b.c1 !== loc.c2 - loc.c1) bad(`${loc.c2 - loc.c1 + 1} cells need ${loc.c2 - loc.c1 + 1} columns of data, not ${b.c2 - b.c1 + 1}`);
      for (let i = 0; i <= loc.c2 - loc.c1; i++) items.push({ cell: cellAddress(loc.r1, loc.c1 + i), source: chartRefText(home, { r1: b.r1, r2: b.r2, c1: b.c1 + i, c2: b.c1 + i }) });
    } else bad("The cells for sparklines are one row or one column");
    return items;
  }

  /**
   * Puts sparklines in cells. Say where (`location`, such as `F2:F6`) and what they draw (`data`, such as `A2:E6`), or give the
   * `items` (cell and source) yourself. They are line sparklines unless `type` says column or winloss.
   */
  addSparklines(sheet: string, spec: Omit<Partial<SparklineGroup>, "items"> & { location?: string; data?: string; items?: SparklineGroup["items"] }): SparklineGroup {
    const s = this.sheet(sheet);
    const { location, data, items: given, ...style } = spec;
    const items = given ?? (location && data ? this.#sparklineItems(s, location, data) : bad("Say where the sparklines go and what they draw"));
    const group: SparklineGroup = { type: "line", ...style, id: spec.id ?? createId("spark_"), items };
    if (group.dateAxis !== undefined) group.dateAxis = this.#dateAxisText(s, group.dateAxis);
    this.commit([{ type: "add_sparklines", sheet: s.id, group }]);
    return this.sparklines(sheet).find((g) => g.id === group.id)!;
  }

  /** The dates of a date axis written the way sparklines keep them (`Sheet1!$A$2:$H$2`), whether given as that or as `A2:H2`. */
  #dateAxisText(s: Sheet, text: string): string {
    const ref = chartRef(text, s.name);
    if (!ref) return bad(`"${text}" isn't a row or column of dates such as A2:H2`);
    const home = this.state.sheets.find((x) => x.name.toLowerCase() === ref.sheet.toLowerCase()) ?? bad(`There is no sheet "${ref.sheet}"`);
    return chartRefText(home.name, ref.bounds);
  }

  /** Changes a group of sparklines: their look, or the cells they draw. A field set to `undefined` goes back to Excel's. */
  updateSparklines(sheet: string, id: string, patch: Omit<Partial<SparklineGroup>, "id">): void {
    const s = this.sheet(sheet);
    const old = s.sparklines?.find((g) => g.id === id);
    if (!old) throw new PliError("not_found", `No sparklines with id "${id}"`);
    const group: SparklineGroup = { ...old, ...patch, id };
    for (const [k, v] of Object.entries(patch) as [keyof SparklineGroup, unknown][]) if (v === undefined || v === false) delete group[k];
    if (group.dateAxis !== undefined) group.dateAxis = this.#dateAxisText(s, group.dateAxis);
    this.commit([{ type: "update_sparklines", sheet: s.id, group }]);
  }

  deleteSparklines(sheet: string, id: string): void {
    this.commit([{ type: "delete_sparklines", sheet: this.sheet(sheet).id, id }]);
  }

  /** Takes the sparklines out of the cells of a range (a group left with none goes). */
  clearSparklines(sheet: string, range: string): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const ops: SheetOp[] = [];
    for (const g of s.sparklines ?? []) {
      const items = g.items.filter((i) => {
        const p = parseCell(i.cell)!;
        return !(p.row >= b.r1 && p.row <= b.r2 && p.col >= b.c1 && p.col <= b.c2);
      });
      if (items.length === g.items.length) continue;
      ops.push(items.length ? { type: "update_sparklines", sheet: s.id, group: { ...g, items } } : { type: "delete_sparklines", sheet: s.id, id: g.id });
    }
    if (ops.length) this.commit(ops);
  }

  /** The numbers a sparkline draws, in order: `null` for a cell with no number in it, and nothing for hidden rows and columns (unless the group shows them). */
  sparklineValues(sheet: string, address: string): (number | null)[] {
    const s = this.sheet(sheet);
    const hit = this.sparklineAt(sheet, address);
    return hit ? this.#sparkValues(s, hit.group, hit.item) : [];
  }

  #sparkValues(s: Sheet, group: SparklineGroup, item: SparklineGroup["items"][number]): (number | null)[] {
    return this.#sparkSeries(s, group, item).values;
  }

  /** The numbers a sparkline draws and, with a date axis, the date of each (`null` where the axis has no date). */
  #sparkSeries(s: Sheet, group: SparklineGroup, item: SparklineGroup["items"][number]): { values: (number | null)[]; dates?: (number | null)[] } {
    const r = chartRef(item.source, s.name);
    const src = r && this.state.sheets.find((x) => x.name.toLowerCase() === r.sheet.toLowerCase());
    if (!r || !src) return { values: [] };
    const axis = group.dateAxis && !group.dateAxis.includes("#REF!") ? chartRef(group.dateAxis, s.name) : null;
    const axisSheet = axis && this.state.sheets.find((x) => x.name.toLowerCase() === axis.sheet.toLowerCase());
    const dateCells: Value[] = [];
    if (axis && axisSheet) {
      for (let row = axis.bounds.r1; row <= axis.bounds.r2; row++)
        for (let col = axis.bounds.c1; col <= axis.bounds.c2; col++) dateCells.push(this.calculator.value(axisSheet.id, cellAddress(row, col)));
    }
    const values: (number | null)[] = [];
    const dates: (number | null)[] = [];
    const { r1, c1, r2, c2 } = r.bounds;
    let k = 0;
    for (let row = r1; row <= r2; row++)
      for (let col = c1; col <= c2; col++, k++) {
        if (!group.showHidden && (src.rows?.[String(row)]?.hidden || src.columns?.[colName(col)]?.hidden)) continue;
        const v = this.calculator.value(src.id, cellAddress(row, col));
        values.push(typeof v === "number" ? v : null);
        const d = dateCells[k];
        dates.push(typeof d === "number" ? d : null);
      }
    return axis && axisSheet ? { values, dates } : { values };
  }

  /** How a sparkline is drawn in a box of this many pixels (null when the cell has none), for the grid and for paper. */
  sparklineShape(sheet: string, address: string, width: number, height: number): SparkShape | null {
    const s = this.sheet(sheet);
    // A formula (`SPARKLINE`) draws its own.
    const drawn = this.calculator.hasSparklineFormulas(s.id) ? this.calculator.sparklineAt(s.id, address) : undefined;
    if (drawn?.bar) return layoutBarSparkline(drawn.values, drawn.bar, width, height, !!drawn.group.rightToLeft);
    if (drawn) return layoutSparkline(drawn.values, { id: "", items: [], ...drawn.group }, width, height, { ...(this.state.themeColors ? { palette: this.state.themeColors } : {}), ...(drawn.xs ? { xs: drawn.xs } : {}), ...(drawn.xmin !== undefined ? { xmin: drawn.xmin } : {}), ...(drawn.xmax !== undefined ? { xmax: drawn.xmax } : {}) });
    const hit = this.sparklineAt(sheet, address);
    if (!hit) return null;
    const { group, item } = hit;
    let bounds: { min?: number; max?: number } | undefined;
    if (group.min === "group" || group.max === "group") {
      const all = group.items.flatMap((i) => this.#sparkValues(s, group, i)).filter((v): v is number => v !== null);
      if (all.length) bounds = { min: group.type === "line" ? Math.min(...all) : Math.min(0, ...all), max: group.type === "line" ? Math.max(...all) : Math.max(0, ...all) };
    }
    const { values, dates } = this.#sparkSeries(s, group, item);
    return layoutSparkline(values, group, width, height, { ...(bounds ? { bounds } : {}), ...(dates ? { dates } : {}), ...(this.state.themeColors ? { palette: this.state.themeColors } : {}) });
  }

  // ---- pivot tables ----

  /** The pivot tables on a sheet. */
  pivots(sheet: string): readonly Pivot[] {
    return this.sheet(sheet).pivots ?? [];
  }

  /** The pivot table that is drawn in this cell. */
  pivotAt(sheet: string, address: string): Pivot | undefined {
    return pivotAtCell(this.sheet(sheet), address);
  }

  #refusePivotEdits(ops: readonly SheetOp[]): void {
    for (const op of ops) {
      if (op.type !== "set_cells") continue;
      const s = this.state.sheets.find((x) => x.id === op.sheet);
      if (!s?.pivots?.length) continue;
      const ranges = s.pivots.map((p) => parseRange(p.range)!);
      for (const address of Object.keys(op.cells)) {
        const at = parseCell(address);
        if (at && ranges.some((b) => at.row >= b.r1 && at.row <= b.r2 && at.col >= b.c1 && at.col <= b.c2)) {
          throw new PliError("invalid_operation", `Can't change part of a pivot table. Change its fields, or refresh it, or turn it into values (delete it and keep the cells).`);
        }
      }
    }
  }

  #pivotSource(p: Pick<Pivot, "source"> & Pick<Partial<Pivot>, "ranges">, home: string): PivotSource | null {
    const src = readPivotSource(this.state, p, home, (sheet, address) => this.calculator.value(sheet.id, address));
    const now = this.#options.now?.();
    return src && now !== undefined ? { ...src, today: Math.floor(now) } : src;
  }

  /** Why a pivot table's source can't be read. */
  #noSource(pivot: Pick<Pivot, "source" | "name">): string {
    if (isModelSource(pivot.source)) return "The data model isn't there: set it with setDataModel first";
    if (isExternalSource(pivot.source)) return `${pivot.source} has not been read: give it rows with setDataBlock or importCsv, or ask the host with refreshPivotData`;
    return `The source of ${pivot.name} isn't there: it is a range with field names in its first row, or a table`;
  }

  /** The field names of a source (a range with the names in its first row, or a table), or null if it isn't there. */
  pivotFields(source: string, home: string): string[] | null {
    const src = this.#pivotSource({ source }, home);
    if (!src) return null;
    return [...src.fields.filter((f) => !src.hidden?.includes(f)), ...[...(src.measures?.values() ?? [])].map((m) => m.name)];
  }

  /** The items of a source's field as they show, in the order a pivot table lists them. */
  pivotFieldItems(source: string, home: string, field: string, group?: PivotGroup, ranges?: readonly PivotRange[]): string[] {
    const src = this.#pivotSource({ source, ...(ranges?.length ? { ranges: [...ranges] } : {}) }, home);
    return src ? fieldItems(src, field, false, group).map((i) => i.label) : [];
  }

  /** Where a source stands, written the way pivot tables keep it (`Data!$A$1:$F$20`, or a table's name). */
  #pivotSourceText(source: string, home: string): string {
    if (isModelSource(source)) return MODEL_SOURCE;
    const outside = externalSourceName(source);
    if (outside !== null) return outside;
    if (findTable(this.state, source)) return source;
    const ref = chartRef(source, home);
    if (!ref) return bad(`"${source}" isn't a range of cells or a table`);
    const sheet = this.state.sheets.find((x) => x.name.toLowerCase() === ref.sheet.toLowerCase()) ?? bad(`There is no sheet "${ref.sheet}"`);
    return chartRefText(sheet.name, ref.bounds);
  }

  /** Slicers or timelines given by field (and what else you chose), with the id, place and size they were not given. New ones are set side by side. */
  #panelsOf<T extends PivotSlicer | PivotTimeline>(list: readonly PivotPanelSpec<T>[], prefix: string, width: number, height: number, row: number, col: number, _gap: number): T[] {
    let fresh = 0;
    return list.map((x) => {
      const placed = x.from !== undefined;
      const out = { ...x, id: x.id ?? createId(prefix), from: x.from ?? { row, col, dx: fresh * (width + 12) }, width: x.width ?? width, height: x.height ?? height } as T;
      if (!placed) fresh++;
      return out;
    });
  }

  #axisFields(list: readonly (string | PivotAxisField)[] | undefined): PivotAxisField[] {
    return (list ?? []).map((f) => (typeof f === "string" ? { field: f } : { ...f }));
  }

  #valueFields(list: readonly (string | PivotValue)[] | undefined): PivotValue[] {
    return (list ?? []).map((v) => (typeof v === "string" ? { field: v } : { ...v }));
  }

  /**
   * Makes a pivot table at `anchor` on this sheet, summing up the records of `source` (a range with the field names in its
   * first row, such as `Data!A1:F200`, or a table's name). A field is named by its header text; a plain name works where an
   * object does. It is drawn at once, and again whenever it is refreshed or changed.
   */
  createPivot(
    sheet: string,
    spec: {
      id?: string;
      name?: string;
      source: string;
      anchor: string;
      rows?: readonly (string | PivotAxisField)[];
      columns?: readonly (string | PivotAxisField)[];
      values?: readonly (string | PivotValue)[];
      filters?: Pivot["filters"];
      calculated?: readonly PivotCalculatedField[];
      calculatedItems?: readonly PivotCalculatedItem[];
      /** Several ranges, each a table of row labels, column labels and numbers: the fields are then Row, Column, Value and Page1. `source` is ignored. */
      ranges?: readonly PivotRange[];
      style?: PivotStyle;
      /** Slicers and timelines to put with the table: the field, and anything else you want; where and how big they are is filled in. */
      slicers?: readonly PivotPanelSpec<PivotSlicer>[];
      timelines?: readonly PivotPanelSpec<PivotTimeline>[];
      tabular?: boolean;
      outline?: boolean;
      repeatLabels?: boolean;
      valuesOnRows?: boolean;
      autoRefresh?: boolean;
      grandTotalRows?: boolean;
      grandTotalColumns?: boolean;
      /** For a pivot table made from several ranges: how many page fields (0 to 4; 1 is Page1, which names the range). */
      pageFields?: number;
      /** Looks to keep for cells of the table. */
      formats?: readonly PivotFormat[];
    },
  ): Pivot {
    const s = this.sheet(sheet);
    const at = parseCell(spec.anchor.toUpperCase()) ?? bad(`"${spec.anchor}" isn't a cell`);
    const taken = new Set(this.state.sheets.flatMap((x) => (x.pivots ?? []).map((p) => p.name.toLowerCase())));
    let n = 1;
    while (taken.has(`pivottable${n}`)) n++;
    const pivot: Pivot = {
      id: spec.id ?? createId("pivot_"),
      name: spec.name ?? `PivotTable${n}`,
      source: this.#pivotSourceText(spec.source, s.name),
      anchor: cellAddress(at.row, at.col),
      rows: this.#axisFields(spec.rows),
      columns: this.#axisFields(spec.columns),
      values: this.#valueFields(spec.values),
      range: cellAddress(at.row, at.col),
    };
    if (spec.filters?.length) pivot.filters = spec.filters.map((f) => ({ ...f, items: [...f.items] }));
    if (spec.calculated?.length) pivot.calculated = spec.calculated.map((c) => ({ ...c }));
    if (spec.calculatedItems?.length) pivot.calculatedItems = spec.calculatedItems.map((c) => ({ ...c }));
    if (spec.ranges?.length) {
      pivot.ranges = spec.ranges.map((r) => ({ ...r, source: this.#pivotSourceText(r.source, s.name) }));
      pivot.source = pivot.ranges[0]!.source;
    }
    if (spec.style) pivot.style = { ...spec.style };
    if (spec.slicers?.length) pivot.slicers = this.#panelsOf(spec.slicers, "pslicer_", DEFAULT_PIVOT_SLICER_WIDTH, DEFAULT_PIVOT_SLICER_HEIGHT, at.row, at.col + 7, 0);
    if (spec.timelines?.length) pivot.timelines = this.#panelsOf(spec.timelines, "ptimeline_", DEFAULT_PIVOT_TIMELINE_WIDTH, DEFAULT_PIVOT_TIMELINE_HEIGHT, at.row + 20, at.col, 0);
    if (spec.tabular) pivot.tabular = true;
    if (spec.outline) pivot.outline = true;
    if (spec.repeatLabels) pivot.repeatLabels = true;
    if (spec.valuesOnRows) pivot.valuesOnRows = true;
    if (spec.autoRefresh) pivot.autoRefresh = true;
    if (spec.pageFields !== undefined) pivot.pageFields = spec.pageFields;
    if (spec.formats?.length) pivot.formats = spec.formats.map((f) => ({ ...f }));
    if (spec.grandTotalRows === false) pivot.grandTotalRows = false;
    if (spec.grandTotalColumns === false) pivot.grandTotalColumns = false;
    // Fields not given a function keep what they will get, so a refresh doesn't change it when the data does.
    const src = this.#pivotSource(pivot, s.name) ?? bad(this.#noSource(pivot));
    pivot.values = pivot.values.map((v) => (v.fn || src.measures?.has(v.field.toLowerCase()) ? v : { ...v, fn: renderPivot({ ...pivot, values: [v], rows: [], columns: [] }, src).functions[0]! }));
    // A filter that names no items lets everything through.
    pivot.filters = pivot.filters?.map((f) => (f.items.length ? f : { ...f, items: fieldItems(src, f.field).map((i) => i.label) }));
    this.#drawPivot(s, pivot, null, true);
    return this.pivots(sheet).find((p) => p.id === pivot.id)!;
  }

  /**
   * Changes a pivot table and draws it again. A field set to `undefined` goes back to its default. Giving a new `anchor`
   * moves it (the cells it was drawn in are emptied).
   */
  updatePivot(
    sheet: string,
    id: string,
    patch: {
      name?: string;
      source?: string;
      anchor?: string;
      rows?: readonly (string | PivotAxisField)[];
      columns?: readonly (string | PivotAxisField)[];
      values?: readonly (string | PivotValue)[];
      filters?: Pivot["filters"];
      calculated?: readonly PivotCalculatedField[] | undefined;
      calculatedItems?: readonly PivotCalculatedItem[] | undefined;
      ranges?: readonly PivotRange[] | undefined;
      style?: PivotStyle | undefined;
      slicers?: readonly PivotPanelSpec<PivotSlicer>[] | undefined;
      timelines?: readonly PivotPanelSpec<PivotTimeline>[] | undefined;
      tabular?: boolean | undefined;
      outline?: boolean | undefined;
      repeatLabels?: boolean | undefined;
      valuesOnRows?: boolean | undefined;
      autoRefresh?: boolean | undefined;
      grandTotalRows?: boolean | undefined;
      grandTotalColumns?: boolean | undefined;
      pageFields?: number | undefined;
      formats?: readonly PivotFormat[] | undefined;
    },
  ): void {
    const s = this.sheet(sheet);
    const old = s.pivots?.find((p) => p.id === id);
    if (!old) throw new PliError("not_found", `No pivot table with id "${id}"`);
    const next: Pivot = { ...old };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.source !== undefined) next.source = this.#pivotSourceText(patch.source, s.name);
    if (patch.anchor !== undefined) {
      const at = parseCell(patch.anchor.toUpperCase()) ?? bad(`"${patch.anchor}" isn't a cell`);
      next.anchor = cellAddress(at.row, at.col);
    }
    if (patch.rows !== undefined) next.rows = this.#axisFields(patch.rows);
    if (patch.columns !== undefined) next.columns = this.#axisFields(patch.columns);
    if (patch.values !== undefined) next.values = this.#valueFields(patch.values);
    if ("filters" in patch) {
      if (patch.filters?.length) next.filters = patch.filters.map((f) => ({ ...f, items: [...f.items] }));
      else delete next.filters;
    }
    if ("calculated" in patch) {
      if (patch.calculated?.length) next.calculated = patch.calculated.map((c) => ({ ...c }));
      else delete next.calculated;
    }
    if ("calculatedItems" in patch) {
      if (patch.calculatedItems?.length) next.calculatedItems = patch.calculatedItems.map((c) => ({ ...c }));
      else delete next.calculatedItems;
    }
    if ("ranges" in patch) {
      if (patch.ranges?.length) {
        next.ranges = patch.ranges.map((r) => ({ ...r, source: this.#pivotSourceText(r.source, s.name) }));
        next.source = next.ranges[0]!.source;
      } else delete next.ranges;
    }
    if ("style" in patch) {
      if (patch.style) next.style = { ...patch.style };
      else delete next.style;
    }
    const where = parseRange(old.range)!;
    if ("slicers" in patch) {
      if (patch.slicers?.length) next.slicers = this.#panelsOf(patch.slicers, "pslicer_", DEFAULT_PIVOT_SLICER_WIDTH, DEFAULT_PIVOT_SLICER_HEIGHT, where.r1, where.c2 + 2, 0);
      else delete next.slicers;
    }
    if ("timelines" in patch) {
      if (patch.timelines?.length) next.timelines = this.#panelsOf(patch.timelines, "ptimeline_", DEFAULT_PIVOT_TIMELINE_WIDTH, DEFAULT_PIVOT_TIMELINE_HEIGHT, where.r2 + 2, where.c1, 0);
      else delete next.timelines;
    }
    for (const k of ["tabular", "outline", "repeatLabels", "valuesOnRows", "autoRefresh", "grandTotalRows", "grandTotalColumns"] as const) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (k === "grandTotalRows" || k === "grandTotalColumns") {
        if (v === false) next[k] = false;
        else delete next[k];
      } else if (v) next[k] = true;
      else delete next[k];
    }
    if ("pageFields" in patch) {
      if (patch.pageFields === undefined || patch.pageFields === 1) delete next.pageFields;
      else next.pageFields = patch.pageFields;
    }
    if ("formats" in patch) {
      if (patch.formats?.length) next.formats = patch.formats.map((f) => ({ ...f }));
      else delete next.formats;
    }
    // The three layouts exclude each other: choosing one lets go of the others.
    if (patch.tabular) delete next.outline;
    else if (patch.outline) delete next.tabular;
    const src = this.#pivotSource(next, s.name);
    if (src) {
      next.values = next.values.map((v) => (v.fn || src.measures?.has(v.field.toLowerCase()) ? v : { ...v, fn: renderPivot({ ...next, values: [v], rows: [], columns: [] }, src).functions[0]! }));
      next.filters = next.filters?.map((f) => (f.items.length ? f : { ...f, items: fieldItems(src, f.field).map((i) => i.label) }));
    }
    this.#drawPivot(s, next, old, true);
  }

  /**
   * The records of the source that a cell of a pivot table adds up (Excel's Show Details): the field names, the records, and
   * the sheet row each came from. Null when the cell isn't in the body of a pivot table. It works from the source as it is now.
   */
  pivotDetails(sheet: string, address: string): { pivot: Pivot; fields: string[]; records: Value[][]; rows: number[] } | null {
    const s = this.sheet(sheet);
    const pivot = pivotAtCell(s, address);
    const at = parseCell(address);
    if (!pivot || !at) return null;
    const src = this.#pivotSource(pivot, s.name);
    if (!src) return null;
    const origin = parseCell(pivot.anchor)!;
    const found = pivotDetailsOf(renderPivot(pivot, src), src, at.row - origin.row, at.col - origin.col);
    return found && { pivot, ...found };
  }

  /** Lists the records behind a pivot table cell on a new sheet, with the source's headings and number formats, as one undo step. */
  showPivotDetails(sheet: string, address: string): Sheet {
    const found = this.pivotDetails(sheet, address) ?? bad("Show details works on a number or a total in the body of a pivot table");
    const src = this.#pivotSource(found.pivot, this.sheet(sheet).name)!;
    let made!: Sheet;
    this.batch(() => {
      const taken = new Set(this.state.sheets.map((x) => x.name.toLowerCase()));
      let n = 1;
      let name = "Details";
      while (taken.has(name.toLowerCase())) name = `Details ${++n}`;
      made = this.addSheet(name);
      const cells: Record<string, Cell> = {};
      found.fields.forEach((f, j) => (cells[cellAddress(1, j + 1)] = { v: f, s: { bold: true, fill: "#dce6f1" } }));
      found.records.forEach((rec, i) =>
        rec.forEach((v, j) => {
          if (v === null || v === "") return;
          const cell: Cell = isError(v) ? { e: v.error } : { v };
          if (typeof v === "number" && src.formats[j]) cell.fmt = src.formats[j]!;
          cells[cellAddress(i + 2, j + 1)] = cell;
        }),
      );
      this.commit([{ type: "set_cells", sheet: made.id, cells }]);
    });
    return this.sheet(made.id);
  }

  /** Draws a pivot table again from its source as it is now. */
  refreshPivot(sheet: string, id: string): void {
    const s = this.sheet(sheet);
    const old = s.pivots?.find((p) => p.id === id);
    if (!old) throw new PliError("not_found", `No pivot table with id "${id}"`);
    this.#drawPivot(s, old, old, false);
  }

  // ---- data from outside the workbook ----

  #pivotData: PivotDataResolver | undefined;
  #pivotDataSet = false;

  /** The way pivot tables that read outside the workbook get their rows: what the host supplied, or nothing (then the rows kept in the workbook are used). */
  get pivotData(): PivotDataResolver | undefined {
    return this.#pivotDataSet ? this.#pivotData : this.#options.pivotData;
  }

  set pivotData(resolver: PivotDataResolver | undefined) {
    this.#pivotData = resolver;
    this.#pivotDataSet = true;
  }

  /** The blocks of outside data the workbook keeps: ranges of other workbooks and named blocks, as last read. */
  dataBlocks(): readonly DataBlock[] {
    return this.state.dataBlocks ?? [];
  }

  /** The block a source (`data:Sales`, `[Prices.xlsx]Sheet1!$A$1:$D$20`) reads, or undefined. */
  dataBlock(source: string): DataBlock | undefined {
    return findBlock(this.state, source);
  }

  #commitBook(patch: PivotBookPatch, options: { history?: false } = {}): void {
    this.#bypass++;
    try {
      this.commit([{ type: "set_pivot_book", ...patch }], options);
    } finally {
      this.#bypass--;
    }
  }

  /**
   * Keeps the rows of a block of outside data: `source` is `data:Name` or a range of another workbook, the rows are given
   * with the field names first. `null` takes the block away (pivot tables that read it can no longer be drawn again). Pivot
   * tables that follow their source (`autoRefresh`) are drawn again.
   */
  setDataBlock(source: string, data: DataBlock["rows"] | Omit<DataBlock, "source"> | null): DataBlock | undefined {
    const name = externalSourceName(source) ?? bad(`"${source}" isn't a data block's source: use data:Name, or a range of another workbook such as [Prices.xlsx]Sheet1!$A$1:$D$20`);
    if (data === null) {
      this.#commitBook({ dataBlocks: withBlock(this.state.dataBlocks, name, null) });
      return undefined;
    }
    const given = Array.isArray(data) ? { rows: data as DataBlock["rows"] } : (data as Omit<DataBlock, "source">);
    const old = findBlock(this.state, name);
    const block: DataBlock = { ...given, source: name, from: given.from ?? (name.startsWith("data:") ? "host" : "book"), read: given.read ?? readDay(this.#options.now?.()), ...(given.path === undefined && old?.path ? { path: old.path } : {}) };
    this.#commitBook({ dataBlocks: withBlock(this.state.dataBlocks, name, block) });
    return findBlock(this.state, name);
  }

  /** Reads CSV text into a named block (`data:Sales`), numbers, dates and so on as such unless `typed` is false. The first line holds the field names. */
  importCsv(source: string, text: string, options: { delimiter?: string; typed?: boolean; path?: string } = {}): DataBlock {
    const name = externalSourceName(source) ?? bad(`"${source}" isn't a data block's source: use data:Name, or a range of another workbook such as [Prices.xlsx]Sheet1!$A$1:$D$20`);
    const block = this.#csvBlock(name, text, options);
    this.#commitBook({ dataBlocks: withBlock(this.state.dataBlocks, name, block) });
    return findBlock(this.state, name)!;
  }

  #csvBlock(source: string, text: string, options: { delimiter?: string; typed?: boolean; path?: string; from?: "csv" | "host" }): DataBlock {
    const lines = parseCsv(text, options.delimiter);
    if (!lines.length) bad("The CSV has no rows: the first holds the field names");
    const formats: string[] = [];
    const rows = lines.map((line, i) =>
      line.map((field, j) => {
        if (field === "") return null;
        // A field that starts like a formula stays text: a CSV isn't a place to run formulas from. The first row is the field names.
        if (i === 0 || options.typed === false || (/^[=+@-]/.test(field) && !/^[+-]?[\d.]/.test(field))) return field;
        const cell = cellFromInput(field);
        if (!cell || cell.v === undefined) return field;
        if (cell.fmt && !formats[j]) formats[j] = cell.fmt;
        return cell.v;
      }),
    );
    const width = Math.max(...rows.map((r) => r.length));
    for (const r of rows) while (r.length < width) r.push(null);
    return { source, rows, ...(formats.some((f) => f) ? { formats: Array.from({ length: width }, (_, j) => formats[j] ?? "") } : {}), from: options.from ?? "csv", ...(options.path ? { path: options.path } : {}), read: readDay(this.#options.now?.()) };
  }

  /** The sources of outside data that pivot tables read, directly or as tables of the data model. */
  #externalSources(): string[] {
    const out = new Map<string, string>();
    for (const sh of this.state.sheets) {
      for (const p of sh.pivots ?? []) {
        const direct = externalSourceName(p.source);
        if (direct) out.set(direct.toLowerCase(), direct);
        if (isModelSource(p.source)) {
          for (const t of this.state.model?.tables ?? []) {
            const named = externalSourceName(t.source);
            if (named) out.set(named.toLowerCase(), named);
          }
        }
      }
    }
    return [...out.values()];
  }

  /** Whether a pivot table reads this source of outside data (directly or through the data model). */
  #readsSource(p: Pivot, source: string): boolean {
    const key = source.toLowerCase();
    if (externalSourceName(p.source)?.toLowerCase() === key) return true;
    return isModelSource(p.source) && !!this.state.model?.tables.some((t) => externalSourceName(t.source)?.toLowerCase() === key);
  }

  /**
   * Asks the host (`pivotData`) for the rows of every source of outside data a pivot table reads, keeps what it answers in the
   * workbook (with today's date, without a step of their own in the undo history), and draws the pivot tables that read what
   * changed again. A source the host can't read keeps the rows it had. Without a host, nothing is read.
   */
  async refreshPivotData(): Promise<PivotDataRefresh> {
    const resolver = this.pivotData;
    const result: PivotDataRefresh = { updated: 0, unchanged: 0, failed: [], offline: !resolver, pivots: 0 };
    if (!resolver) return result;
    const changed: DataBlock[] = [];
    for (const source of this.#externalSources()) {
      const old = findBlock(this.state, source);
      const request = requestOf(source, old)!;
      let answer: PivotDataAnswer;
      try {
        answer = await resolver(request);
      } catch (e) {
        result.failed.push({ source, reason: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (!answer) {
        result.failed.push({ source, reason: `${request.name} couldn't be found` });
        continue;
      }
      let block: DataBlock;
      try {
        block = this.#answerBlock(source, answer, old);
      } catch (e) {
        result.failed.push({ source, reason: (e as Error).message });
        continue;
      }
      if (old && JSON.stringify(old.rows) === JSON.stringify(block.rows) && JSON.stringify(old.formats) === JSON.stringify(block.formats)) {
        result.unchanged++;
        continue;
      }
      result.updated++;
      changed.push(block);
    }
    if (changed.length) {
      let blocks = this.state.dataBlocks;
      for (const b of changed) blocks = withBlock(blocks, b.source, b);
      this.#commitBook({ dataBlocks: blocks }, { history: false });
      const todo = this.state.sheets.flatMap((sh) => (sh.pivots ?? []).filter((p) => changed.some((b) => this.#readsSource(p, b.source))).map((p) => ({ sh, p })));
      this.batch(() => {
        for (const { sh, p } of todo) {
          try {
            this.#drawPivot(this.sheet(sh.id), p, p, false);
            result.pivots++;
          } catch (e) {
            result.failed.push({ source: p.source, reason: (e as Error).message });
          }
        }
      });
    }
    return result;
  }

  #answerBlock(source: string, answer: NonNullable<PivotDataAnswer>, old: DataBlock | undefined): DataBlock {
    const from = source.startsWith("data:") ? "host" : "book";
    if (!Array.isArray(answer) && "csv" in answer) return this.#csvBlock(source, answer.csv, { ...(answer.delimiter ? { delimiter: answer.delimiter } : {}), ...(old?.path ? { path: old.path } : {}), from: "host" });
    const given = Array.isArray(answer) ? { rows: answer as PivotDataRows, formats: undefined } : (answer as { rows: PivotDataRows; formats?: readonly string[] });
    const rows = given.rows.map((row) => row.map((v) => (v === undefined ? null : v)));
    return cleanBlock({ source, rows: rows as DataBlock["rows"], ...(given.formats ? { formats: [...given.formats] } : {}), from, ...(old?.path ? { path: old.path } : {}), read: readDay(this.#options.now?.()) });
  }

  // ---- the data model ----

  /** The data model: tables, relationships and measures that pivot tables with the source `ThisWorkbookDataModel` read. */
  dataModel(): DataModel | undefined {
    return this.state.model;
  }

  /**
   * Sets the data model (`null` takes it away). The tables are ranges, tables or data blocks; a relationship joins a column of
   * the many side to a column of the one side; a measure is a DAX-style expression such as `SUM(Orders[Amount])` or
   * `DISTINCTCOUNT(Orders[CustomerId])`. Pivot tables that read the model are drawn again.
   */
  setDataModel(model: DataModel | null): void {
    if (model === null && this.state.sheets.some((sh) => sh.pivots?.some((p) => isModelSource(p.source)))) bad("Pivot tables read the data model: delete them first, or give the model other tables");
    const todo = this.state.sheets.flatMap((sh) => (sh.pivots ?? []).filter((p) => isModelSource(p.source)).map((p) => ({ sh, p })));
    this.#commitBook({ model });
    this.#redrawJoined(todo.map(({ sh, p }) => ({ sheet: sh.id, id: p.id })));
  }

  /** Draws pivot tables again as they stand now, in the same undo step as the change before. */
  #redrawJoined(list: { sheet: string; id: string; change?: (p: Pivot) => Pivot }[]): void {
    this.#joining++;
    try {
      for (const { sheet, id, change } of list) {
        const sh = this.sheet(sheet);
        const p = sh.pivots?.find((x) => x.id === id);
        if (p) this.#drawPivot(sh, change ? change(p) : p, p, false);
      }
    } finally {
      this.#joining--;
    }
  }

  // ---- pivot styles of your own ----

  /** The pivot styles of your own, by name. */
  pivotStyles(): Readonly<Record<string, PivotStyleDef>> {
    return this.state.pivotStyles ?? {};
  }

  /**
   * Defines a pivot style of your own, or replaces the one with this name (pivot tables that use it are drawn again); `null`
   * removes it, and pivot tables that used it go back to the default style.
   */
  setPivotStyle(name: string, style: PivotStyleDef | null): void {
    const key = Object.keys(this.pivotStyles()).find((n) => n.toLowerCase() === name.toLowerCase());
    const using = this.state.sheets.flatMap((sh) => (sh.pivots ?? []).filter((p) => p.style && p.style.name.toLowerCase() === (key ?? name).toLowerCase()).map((p) => ({ sh, p })));
    const styles = { ...this.pivotStyles() };
    if (key !== undefined) delete styles[key];
    if (style !== null) styles[name] = style;
    this.#commitBook({ pivotStyles: Object.keys(styles).length ? styles : null });
    this.#redrawJoined(
      using.map(({ sh, p }) => ({
        sheet: sh.id,
        id: p.id,
        change: (x: Pivot) => {
          const next = { ...x };
          if (style === null) delete next.style;
          return next;
        },
      })),
    );
  }

  // ---- looks kept on the cells of a pivot table ----

  /** Keeps a look for the cells of a pivot table an area names (the way `Pivot.formats` does), and draws the table again. */
  formatPivot(sheet: string, id: string, area: Omit<PivotFormat, "style" | "fmt">, look: { style?: PivotFormat["style"]; fmt?: string }): void {
    const { s, pivot } = this.#pivotNamed(sheet, id);
    const formats = [...(pivot.formats ?? []), { ...area, ...(look.style ? { style: look.style } : {}), ...(look.fmt !== undefined ? { fmt: look.fmt } : {}) }];
    this.#drawPivot(s, { ...pivot, formats }, pivot, false);
  }

  /** Forgets the looks kept for the cells of a pivot table. */
  clearPivotFormats(sheet: string, id: string): void {
    const { s, pivot } = this.#pivotNamed(sheet, id);
    const next = { ...pivot };
    delete next.formats;
    this.#drawPivot(s, next, pivot, false);
  }

  /** Draws every pivot table of the workbook again, as one undo step. */
  refreshAllPivots(): number {
    const todo = this.state.sheets.flatMap((s) => (s.pivots ?? []).map((p) => ({ s, p })));
    if (!todo.length) return 0;
    this.batch(() => {
      for (const { s, p } of todo) this.#drawPivot(s, p, p, false);
    });
    return todo.length;
  }

  /**
   * Takes a pivot table away. Its cells are emptied unless `keepCells` is set, which leaves them as the plain numbers and
   * text they are (that is how to turn a pivot table into values).
   */
  deletePivot(sheet: string, id: string, options: { keepCells?: boolean } = {}): void {
    const s = this.sheet(sheet);
    const old = s.pivots?.find((p) => p.id === id);
    if (!old) throw new PliError("not_found", `No pivot table with id "${id}"`);
    const ops: SheetOp[] = [{ type: "delete_pivot", sheet: s.id, id }];
    // The rules that followed its cells go with it.
    for (const rule of s.conditional ?? []) if (rule.pivot?.id === id) ops.push({ type: "delete_rule", sheet: s.id, id: rule.id });
    if (!options.keepCells) {
      const cells: Record<string, null> = {};
      const b = parseRange(old.range)!;
      for (const address of Object.keys(s.cells)) {
        const at = parseCell(address)!;
        if (at.row >= b.r1 && at.row <= b.r2 && at.col >= b.c1 && at.col <= b.c2) cells[address] = null;
      }
      if (Object.keys(cells).length) ops.unshift({ type: "set_cells", sheet: s.id, cells });
    }
    this.#write(s, ops);
  }

  /** Runs these changes to a pivot table's cells: they are refused to anyone else, and a sheet that allows pivot tables lets them through. */
  #write(s: Sheet, ops: SheetOp[]): void {
    const change = ops.find((o) => o.type === "add_pivot" || o.type === "update_pivot" || o.type === "delete_pivot");
    if (change && !this.#bypass && (this.state.protection || this.state.sheets.some((x) => x.protection))) {
      const why = protectionRefusal(this.state, [change], this.#access());
      if (why) throw new ProtectionError(why);
    }
    this.#drawing++;
    this.#bypass++;
    try {
      this.commit(ops);
    } finally {
      this.#bypass--;
      this.#drawing--;
    }
  }

  #drawPivot(s: Sheet, definition: Pivot, old: Pivot | null, fit: boolean): void {
    const pivot = cleanPivot(definition);
    if (pivot.style && !isPivotStyleName(pivot.style.name) && !Object.keys(this.state.pivotStyles ?? {}).some((n) => n.toLowerCase() === pivot.style!.name.toLowerCase())) bad(`There is no pivot table style called "${pivot.style.name}": Excel's are PivotStyleLight1 to 28, PivotStyleMedium1 to 28 and PivotStyleDark1 to 28, and your own are made with setPivotStyle`);
    const src = this.#pivotSource(pivot, s.name) ?? bad(this.#noSource(pivot));
    const missing = missingFields(pivot, src);
    if (missing.length) bad(`The source has no field called "${missing[0]}"`);
    const problem = pivotProblem(pivot, src);
    if (problem) bad(problem);
    const render = renderPivot(pivot, src);
    const b = renderRange(pivot.anchor, render);
    if (b.r2 > MAX_ROWS || b.c2 > MAX_COLS) bad("The pivot table would run off the end of the sheet");
    const was = old ? parseRange(old.range)! : null;
    const inside = (bb: Bounds | null, row: number, col: number) => !!bb && row >= bb.r1 && row <= bb.r2 && col >= bb.c1 && col <= bb.c2;
    // It may only be drawn over empty cells, and over the cells it was in before.
    for (const [address, cell] of Object.entries(s.cells)) {
      const at = parseCell(address)!;
      if (!inside(b, at.row, at.col) || inside(was, at.row, at.col) || emptyCell(cell)) continue;
      bad(`The pivot table would cover ${address}, which isn't empty. Choose a place with room, such as a new sheet.`);
    }
    for (const other of s.pivots ?? []) {
      if (other.id === pivot.id) continue;
      const o = parseRange(other.range)!;
      if (b.r1 <= o.r2 && b.r2 >= o.r1 && b.c1 <= o.c2 && b.c2 >= o.c1) bad(`The pivot table would overlap ${other.name}`);
    }
    for (const from of pivotAreas(this.state, pivot, s.name) ?? []) {
      if (from.sheet.id === s.id && b.r1 <= from.bounds.r2 && b.r2 >= from.bounds.r1 && b.c1 <= from.bounds.c2 && b.c2 >= from.bounds.c1) bad("The pivot table would cover its own source");
    }

    const cells: Record<string, Cell | null> = {};
    if (was) for (let r = was.r1; r <= was.r2; r++) for (let c = was.c1; c <= was.c2; c++) if (s.cells[cellAddress(r, c)] && !inside(b, r, c)) cells[cellAddress(r, c)] = null;
    render.cells.forEach((line, i) =>
      line.forEach((pc, j) => {
        const address = cellAddress(b.r1 + i, b.c1 + j);
        if (!pc) {
          if (s.cells[address]) cells[address] = null;
          return;
        }
        const cell: Cell = {};
        if (pc.v !== undefined) cell.v = pc.v;
        if (pc.e) cell.e = pc.e;
        if (pc.fmt) cell.fmt = pc.fmt;
        const style: CellStyle = {};
        if (pc.bold) style.bold = true;
        if (pc.fill) style.fill = pc.fill;
        if (pc.align) style.align = pc.align;
        if (pc.indent) style.indent = pc.indent;
        if (pc.color) style.color = pc.color;
        if (pc.border) style.border = { ...pc.border };
        if (pc.top) style.border = { ...style.border, top: { style: "thin" } };
        if (pc.italic) style.italic = true;
        if (pc.underline) style.underline = true;
        if (pc.strike) style.strike = true;
        if (pc.fontFamily) style.fontFamily = pc.fontFamily;
        if (pc.fontSize) style.fontSize = pc.fontSize;
        if (pc.given) Object.assign(style, pc.given);
        if (Object.keys(style).length) cell.s = style;
        cells[address] = cell;
      }),
    );
    const next: Pivot = { ...pivot, range: rangeAddress(b) };
    const ops: SheetOp[] = [{ type: "set_cells", sheet: s.id, cells }, old ? { type: "update_pivot", sheet: s.id, pivot: next } : { type: "add_pivot", sheet: s.id, pivot: next }];
    if (old) ops.push(...this.#scopedRuleOps(s, next, render));
    if (fit) ops.push(...this.#fitPivotColumns(s, b, render));
    this.#write(s, ops);
  }

  /** Widens the columns of a new or changed pivot table to hold its labels and headings (never narrows one). */
  #fitPivotColumns(s: Sheet, b: Bounds, render: PivotRender): SheetOp[] {
    const ops: SheetOp[] = [];
    for (let j = 0; j < render.width; j++) {
      let chars = 0;
      for (let i = render.bodyTop; i < render.height; i++) {
        const pc = render.cells[i]![j];
        if (!pc) continue;
        const text = pc.e ?? (pc.v === undefined ? "" : typeof pc.v === "number" ? formatValue(pc.v, pc.fmt).text : String(pc.v));
        chars = Math.max(chars, text.length + (pc.indent ?? 0) * 2 + (pc.bold ? 1 : 0));
      }
      const want = Math.min(320, Math.max(64, Math.ceil(chars * 7.5 + 16)));
      const col = colName(b.c1 + j);
      if (want > (s.columns?.[col]?.size ?? 64)) ops.push({ type: "set_size", sheet: s.id, axis: "col", index: b.c1 + j, size: want });
    }
    return ops;
  }

  // ---- slicers and timelines on pivot tables ----

  #pivotHolding(id: string): { sheet: Sheet; pivot: Pivot } | null {
    for (const sheet of this.state.sheets) for (const pivot of sheet.pivots ?? []) if (pivot.slicers?.some((x) => x.id === id) || pivot.timelines?.some((x) => x.id === id)) return { sheet, pivot };
    return null;
  }

  /** Changes a pivot table's slicers or timelines and draws it again (when `redraw`), as one undo step. */
  #changePivot(sheet: Sheet, pivot: Pivot, next: Pivot, redraw: boolean): void {
    if (redraw) return this.#drawPivot(sheet, next, pivot, false);
    this.#write(sheet, [{ type: "update_pivot", sheet: sheet.id, pivot: cleanPivot(next) }]);
  }

  #pivotNamed(sheet: string, id: string): { s: Sheet; pivot: Pivot } {
    const s = this.sheet(sheet);
    const pivot = s.pivots?.find((p) => p.id === id);
    if (!pivot) throw new PliError("not_found", `No pivot table with id "${id}"`);
    return { s, pivot };
  }

  /** Puts a slicer for a field of a pivot table on its sheet (just right of the table unless `from` says where). */
  addPivotSlicer(sheet: string, pivotId: string, spec: { field: string; caption?: string; from?: PivotSlicer["from"]; width?: number; height?: number; style?: string; columns?: number; id?: string }): PivotSlicer {
    const { s, pivot } = this.#pivotNamed(sheet, pivotId);
    const src = this.#pivotSource(pivot, s.name) ?? bad("The pivot table's source isn't there");
    if (!src.fields.includes(spec.field)) bad(`The source has no field called "${spec.field}"`);
    const b = parseRange(pivot.range)!;
    const slicer: PivotSlicer = {
      id: spec.id ?? createId("pslicer_"),
      field: spec.field,
      from: spec.from ?? { row: b.r1, col: b.c2 + 2 },
      width: spec.width ?? DEFAULT_PIVOT_SLICER_WIDTH,
      height: spec.height ?? DEFAULT_PIVOT_SLICER_HEIGHT,
      ...(spec.caption ? { caption: spec.caption } : {}),
      ...(spec.style ? { style: spec.style } : {}),
      ...(spec.columns ? { columns: spec.columns } : {}),
    };
    this.#changePivot(s, pivot, { ...pivot, slicers: [...(pivot.slicers ?? []), slicer] }, false);
    return this.pivots(sheet).find((p) => p.id === pivotId)!.slicers!.find((x) => x.id === slicer.id)!;
  }

  /** Puts a timeline for a date field of a pivot table on its sheet. */
  addPivotTimeline(sheet: string, pivotId: string, spec: { field: string; caption?: string; from?: PivotTimeline["from"]; width?: number; height?: number; style?: string; level?: PivotTimeline["level"]; id?: string }): PivotTimeline {
    const { s, pivot } = this.#pivotNamed(sheet, pivotId);
    const src = this.#pivotSource(pivot, s.name) ?? bad("The pivot table's source isn't there");
    if (!src.fields.includes(spec.field)) bad(`The source has no field called "${spec.field}"`);
    if (!timelineBounds(src, spec.field)) bad(`${spec.field} has no dates to put on a timeline`);
    const b = parseRange(pivot.range)!;
    const timeline: PivotTimeline = {
      id: spec.id ?? createId("ptimeline_"),
      field: spec.field,
      from: spec.from ?? { row: b.r2 + 2, col: b.c1 },
      width: spec.width ?? DEFAULT_PIVOT_TIMELINE_WIDTH,
      height: spec.height ?? DEFAULT_PIVOT_TIMELINE_HEIGHT,
      ...(spec.caption ? { caption: spec.caption } : {}),
      ...(spec.style ? { style: spec.style } : {}),
      ...(spec.level && spec.level !== "months" ? { level: spec.level } : {}),
    };
    this.#changePivot(s, pivot, { ...pivot, timelines: [...(pivot.timelines ?? []), timeline] }, false);
    return this.pivots(sheet).find((p) => p.id === pivotId)!.timelines!.find((x) => x.id === timeline.id)!;
  }

  /** The slicers and timelines of the pivot tables on a sheet. */
  pivotSlicers(sheet: string): PivotSlicer[] {
    return (this.sheet(sheet).pivots ?? []).flatMap((p) => p.slicers ?? []);
  }

  pivotTimelines(sheet: string): PivotTimeline[] {
    return (this.sheet(sheet).pivots ?? []).flatMap((p) => p.timelines ?? []);
  }

  /** Replaces the slicer or timeline with this id (to move it, resize it or change its heading, style or level); a timeline's dates are changed with `pivotTimelineSelect`. */
  updatePivotPanel(id: string, panel: PivotSlicer | PivotTimeline): void {
    const held = this.#pivotHolding(id) ?? bad(`No slicer or timeline with id "${id}"`);
    const { sheet, pivot } = held;
    const isSlicer = !!pivot.slicers?.some((x) => x.id === id);
    const next: Pivot = isSlicer ? { ...pivot, slicers: pivot.slicers!.map((x) => (x.id === id ? (panel as PivotSlicer) : x)) } : { ...pivot, timelines: pivot.timelines!.map((x) => (x.id === id ? (panel as PivotTimeline) : x)) };
    this.#changePivot(sheet, pivot, next, false);
  }

  deletePivotPanel(id: string): void {
    const { sheet, pivot } = this.#pivotHolding(id) ?? bad(`No slicer or timeline with id "${id}"`);
    const next: Pivot = { ...pivot };
    if (pivot.slicers?.some((x) => x.id === id)) {
      next.slicers = pivot.slicers.filter((x) => x.id !== id);
      if (!next.slicers.length) delete next.slicers;
    } else {
      next.timelines = pivot.timelines!.filter((x) => x.id !== id);
      if (!next.timelines.length) delete next.timelines;
    }
    this.#changePivot(sheet, pivot, next, false);
  }

  /** The buttons of a pivot table slicer: each item of the field, with how many records have it and whether the pivot table shows it. */
  pivotSlicerItems(id: string): PivotSlicerItem[] {
    const { sheet, pivot } = this.#pivotHolding(id) ?? bad(`No slicer with id "${id}"`);
    const src = this.#pivotSource(pivot, sheet.name);
    // A timeline's buttons are its periods.
    const timeline = pivot.timelines?.find((x) => x.id === id);
    if (timeline) return src ? pivotTimelineItems(timeline, src) : [];
    const slicer = pivot.slicers?.find((x) => x.id === id) ?? bad(`No slicer with id "${id}"`);
    return src ? pivotSlicerItemsOf(pivot, src, slicer) : [];
  }

  /** The slicers and timelines of the pivot tables on a sheet, as the plain slicers the grid draws. */
  pivotPanelsAsSlicers(sheet: string): Slicer[] {
    return (this.sheet(sheet).pivots ?? []).flatMap((p) => [...(p.slicers ?? []).map((x) => pivotSlicerAsSlicer(x, p.id)), ...(p.timelines ?? []).map((x) => pivotTimelineAsSlicer(x, p.id))]);
  }

  /** Lets only these items of a slicer's field through, or all of them with `null`; the pivot table is drawn again, in the same undo step. */
  pivotSlicerSelect(id: string, values: readonly string[] | null): void {
    const { sheet, pivot } = this.#pivotHolding(id) ?? bad(`No slicer with id "${id}"`);
    const slicer = pivot.slicers?.find((x) => x.id === id) ?? bad(`No slicer with id "${id}"`);
    const src = this.#pivotSource(pivot, sheet.name) ?? bad("The pivot table's source isn't there");
    this.#changePivot(sheet, pivot, pivotSlicerSelectOf(pivot, src, slicer, values), true);
  }

  /** The earliest and latest day a timeline's field has (whole day numbers), or null. */
  pivotTimelineBounds(id: string): { min: number; max: number } | null {
    const { sheet, pivot } = this.#pivotHolding(id) ?? bad(`No timeline with id "${id}"`);
    const t = pivot.timelines?.find((x) => x.id === id) ?? bad(`No timeline with id "${id}"`);
    const src = this.#pivotSource(pivot, sheet.name);
    return src ? timelineBounds(src, t.field) : null;
  }

  /** Lets only the dates from `start` to `end` through a timeline (day numbers; both `null` for every date); the pivot table is drawn again, in the same undo step. */
  pivotTimelineSelect(id: string, start: number | null, end: number | null): void {
    const { sheet, pivot } = this.#pivotHolding(id) ?? bad(`No timeline with id "${id}"`);
    this.#changePivot(sheet, pivot, pivotTimelineSelectOf(pivot, id, start, end), true);
  }

  // ---- groups (outlines) ----

  /** The groups of rows or of columns, shallow ones first. */
  outlineGroups(sheet: string, axis: "row" | "col"): Group[] {
    return groupsOf(this.sheet(sheet), axis);
  }

  /** The deepest level the rows or columns have (0 when nothing is grouped). */
  outlineDepth(sheet: string, axis: "row" | "col"): number {
    return deepestLevel(this.sheet(sheet), axis);
  }

  /** Groups rows `from` to `to` (one level deeper than they are). The row below (or above, if the sheet says so) gets the button that collapses them. */
  groupRows(sheet: string, from: number, to: number): void {
    const s = this.sheet(sheet);
    this.commit(groupOps(s, "row", from, to));
  }

  groupColumns(sheet: string, from: number, to: number): void {
    const s = this.sheet(sheet);
    this.commit(groupOps(s, "col", from, to));
  }

  /** Takes rows out of the deepest group they are in, showing them if the group was collapsed. */
  ungroupRows(sheet: string, from: number, to: number): void {
    this.commit(ungroupOps(this.sheet(sheet), "row", from, to));
  }

  ungroupColumns(sheet: string, from: number, to: number): void {
    this.commit(ungroupOps(this.sheet(sheet), "col", from, to));
  }

  /**
   * Collapses or expands the group that `index` is the summary of (or, if it isn't a summary, the deepest group it is in);
   * `collapsed` says which way, and it is the opposite of how the group is when missing. Returns whether the group is
   * collapsed after, or null when there is no group there.
   */
  toggleGroup(sheet: string, axis: "row" | "col", index: number, collapsed?: boolean): boolean | null {
    const s = this.sheet(sheet);
    const groups = groupsOf(s, axis);
    const group = [...groups].reverse().find((g) => g.summary === index) ?? [...groups].reverse().find((g) => index >= g.from && index <= g.to);
    if (!group) return null;
    const to = collapsed ?? !group.collapsed;
    this.commit(setCollapsedOps(s, group, to));
    return to;
  }

  /** Shows rows or columns down to a level and hides the detail below it: level 1 is the top, one more than `outlineDepth` shows everything. */
  showLevel(sheet: string, axis: "row" | "col", level: number): void {
    this.commit(showLevelOps(this.sheet(sheet), axis, level));
  }

  /** Whether summary rows are above their groups and summary columns left of them (Excel's two outline settings); expands every group first. */
  setOutlineSummary(sheet: string, where: { above?: boolean; left?: boolean }): void {
    const s = this.sheet(sheet);
    this.commit([...showLevelOps(s, "row", MAX_LEVEL + 1), ...showLevelOps(s, "col", MAX_LEVEL + 1), { type: "set_outline", sheet: s.id, ...(where.above !== undefined ? { summaryAbove: where.above } : {}), ...(where.left !== undefined ? { summaryLeft: where.left } : {}) }]);
  }

  // ---- subtotals ----

  /** The list a Subtotal command works on: the range, or the block of data around a single cell. */
  #subtotalList(sheet: string, range: string): { s: Sheet; b: Bounds } {
    const s = this.sheet(sheet);
    let b = this.bounds(range);
    if (b.r1 === b.r2 && b.c1 === b.c2) b = this.bounds(this.currentRegion(sheet, cellAddress(b.r1, b.c1)));
    return { s, b };
  }

  /**
   * Excel's Data > Subtotal: in a list (a range whose first row holds the headings) sorted by the column `by`, puts a row of
   * `SUBTOTAL` formulas under every run of equal values in it, for the `columns` given, and one for the whole list. Each run
   * becomes a group (an outline level). The old subtotals are taken out first unless `replace: false`, which adds a level inside
   * the groups there are. One undo step.
   */
  subtotal(sheet: string, range: string, options: SubtotalOptions): SubtotalResult {
    const first = this.#subtotalList(sheet, range);
    let s = first.s;
    let b = first.b;
    let state = this.state;
    const textOf = (sh: Sheet) => (r: number, c: number) => this.calculator.display(sh.id, cellAddress(r, c)).text;
    // Excel's Subtotal can't work on a table. Asked to, the table is made a range first, in the same undo step.
    const prelude: SheetOp[] = [];
    const tables = listTables(s, b);
    if (tables.length && options.convertTable && !listPivots(s, b).length) {
      for (const t of tables) {
        const table = s.tables!.find((x) => x.name === t.name)!;
        state = sheetReducer.apply(tableRefsToRanges(state, t.name), { type: "delete_table", sheet: s.id, id: table.id }).state;
        prelude.push(...this.#releaseTable(s, table, t.bounds));
        // A totals row stays under the list, outside the subtotals.
        if (t.totals && b.r2 >= t.bounds.r2 && t.bounds.r2 - 1 > b.r1) b = { ...b, r2: t.bounds.r2 - 1 };
      }
      s = state.sheets.find((x) => x.id === s.id)!;
      prelude.unshift({ type: "restore", workbook: state });
    }
    if (!options.sort) {
      const { ops, result } = subtotalOps(state, s, b, options, textOf(s));
      this.commit([...prelude, ...ops]);
      return result;
    }
    // Sorted first: checked beforehand (so a refusal leaves the list as it was), sorted, then subtotalled in the same undo step.
    subtotalOps(state, s, b, options, textOf(s));
    this.#permit(s, "sort");
    const by = subtotalColumn(b, options.by, (c) => textOf(s)(b.r1, c)) - b.c1 + 1;
    const cells = this.#sorted(s, b, { by, header: true, descending: options.sort === "descending" });
    this.commit([...prelude, { type: "set_cells", sheet: s.id, cells }], { vet: { action: "sort", whole: true, samePlace: true, sheet: s.id, bounds: b } });
    this.#joining++;
    let ops: SheetOp[];
    let result: SubtotalResult;
    try {
      const now = this.sheet(s.id);
      ({ ops, result } = subtotalOps(this.state, now, b, options, textOf(now)));
      this.commit(ops);
    } catch (e) {
      this.#joining--;
      this.undo();
      throw e;
    }
    this.#joining--;
    this.#autoRefresh(ops);
    return result;
  }

  /** Takes every subtotal row out of a list and the groups with them (Excel's Remove All); returns how many rows went. */
  removeSubtotals(sheet: string, range: string): number {
    const { s, b } = this.#subtotalList(sheet, range);
    const { ops, removed } = removeSubtotalOps(this.state, s, b);
    if (ops.length) this.commit(ops);
    return removed;
  }

  /** The rows of a list that hold subtotals (a `SUBTOTAL` formula), and the one that sums up the whole list, if there is one. */
  subtotalRows(sheet: string, range: string): { rows: number[]; grand?: number } {
    const { s, b } = this.#subtotalList(sheet, range);
    return findSubtotals(s, b);
  }

  // ---- page setup ----

  /** How the sheet prints (an empty object when it prints as the defaults). */
  pageSetup(sheet: string): PageSetup {
    return this.sheet(sheet).page ?? {};
  }

  /**
   * Changes how a sheet prints. Each field in `patch` replaces that field; `null` puts it back to its default. A field that
   * is a default is not kept (portrait, letter paper, 100%, Excel's margins).
   */
  setPageSetup(sheet: string, patch: { [K in keyof PageSetup]?: PageSetup[K] | null }): void {
    const s = this.sheet(sheet);
    const next: Record<string, unknown> = { ...s.page };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    // Fitting to pages and scaling are two ways to say how big: the last one said wins.
    if (patch.fit && !("scale" in patch)) delete next["scale"];
    if (patch.scale !== undefined && patch.scale !== null && !("fit" in patch)) delete next["fit"];
    // A picture in a header or footer shows only where the text has the `&G` code, so setting the text again keeps the code of each picture.
    for (const [section, places] of Object.entries((next["pictures"] ?? {}) as Record<string, Record<string, unknown>>)) {
      const parts = { ...((next[section] ?? {}) as Record<string, string | undefined>) };
      for (const place of Object.keys(places)) parts[place] = withPictureCode(parts[place], true);
      next[section] = parts;
    }
    this.commit([{ type: "set_page", sheet: s.id, page: Object.keys(next).length ? (next as PageSetup) : null }]);
  }

  /** Prints only these ranges (each from a new page), or everything with `null`. */
  setPrintArea(sheet: string, ranges: readonly string[] | null): void {
    this.setPageSetup(sheet, { printArea: ranges === null || ranges.length === 0 ? null : [...ranges] });
  }

  /** Repeats rows (such as `"1:2"`) and columns (such as `"A:B"`) on every page; `null` stops repeating them, and a field left out is kept. */
  setPrintTitles(sheet: string, titles: { rows?: string | null; cols?: string | null }): void {
    this.setPageSetup(sheet, parsePrintTitles(titles));
  }

  /** The rows and columns repeated on every page, as `1:2` and `A:B`. */
  printTitles(sheet: string): { rows?: string; cols?: string } {
    const p = this.sheet(sheet).page;
    return { ...(p?.titleRows ? { rows: `${p.titleRows[0]}:${p.titleRows[1]}` } : {}), ...(p?.titleCols ? { cols: `${colName(p.titleCols[0])}:${colName(p.titleCols[1])}` } : {}) };
  }

  /** Puts a page break after a row or column (or takes it away with `on: false`). */
  setPageBreak(sheet: string, axis: "row" | "col", after: number, on = true): void {
    const key = axis === "row" ? "rowBreaks" : "colBreaks";
    const list = new Set(this.sheet(sheet).page?.[key] ?? []);
    if (on) list.add(after);
    else list.delete(after);
    this.setPageSetup(sheet, { [key]: list.size ? [...list].sort((a, b) => a - b) : null });
  }

  /** Takes away the page breaks you made. */
  clearPageBreaks(sheet: string): void {
    this.setPageSetup(sheet, { rowBreaks: null, colBreaks: null });
  }

  /**
   * Moves a page break to after another row or column, as dragging it in a page break preview does: `from` is where it is now
   * (a break made by hand or one that comes where a page is full) and `to` where it is to be. Either way a break you made is
   * left at `to`. If the sheet is set to fit on pages, which ignores breaks, it is scaled at the size it fits at instead.
   */
  movePageBreak(sheet: string, axis: "row" | "col", from: number, to: number): void {
    const key = axis === "row" ? "rowBreaks" : "colBreaks";
    const s = this.sheet(sheet);
    if (!Number.isInteger(to) || to < 1 || to >= (axis === "row" ? MAX_ROWS : MAX_COLS)) bad(`A page break goes after ${axis === "row" ? "row" : "column"} 1 to ${(axis === "row" ? MAX_ROWS : MAX_COLS) - 1}`);
    if (from === to) return;
    const list = new Set(s.page?.[key] ?? []);
    list.delete(from);
    list.add(to);
    this.setPageSetup(sheet, { [key]: [...list].sort((a, b) => a - b), ...this.#unfit(s) });
  }

  /** Puts a page break after a row or column and, if the sheet is set to fit on pages (which ignores breaks), keeps the size it fits at instead. */
  insertPageBreak(sheet: string, axis: "row" | "col", after: number): void {
    const s = this.sheet(sheet);
    const key = axis === "row" ? "rowBreaks" : "colBreaks";
    const list = new Set(s.page?.[key] ?? []);
    list.add(after);
    this.setPageSetup(sheet, { [key]: [...list].sort((a, b) => a - b), ...this.#unfit(s) });
  }

  /** Puts page breaks above a cell's row and to the left of its column, as Insert Page Break does in Excel (row 1 and column A have nothing before them to break from). */
  insertPageBreakAt(sheet: string, cell: { row: number; col: number }): void {
    const s = this.sheet(sheet);
    const patch: { [K in keyof PageSetup]?: PageSetup[K] | null } = { ...this.#unfit(s) };
    if (cell.row > 1) patch.rowBreaks = [...new Set([...(s.page?.rowBreaks ?? []), cell.row - 1])].sort((x, y) => x - y);
    if (cell.col > 1) patch.colBreaks = [...new Set([...(s.page?.colBreaks ?? []), cell.col - 1])].sort((x, y) => x - y);
    if (patch.rowBreaks || patch.colBreaks) this.setPageSetup(sheet, patch);
  }

  #unfit(s: Sheet): { scale?: number } {
    return s.page?.fit ? { scale: layoutPages(s, this.calculator.usedBounds(s.id)).scale } : {};
  }

  /** Moves one edge of a print range (`index` is its place in `printLayout(sheet).areas`; a sheet without a print area has its used cells as the one) to a row or column. */
  movePrintAreaEdge(sheet: string, index: number, edge: "top" | "bottom" | "left" | "right", to: number): void {
    const areas = this.printLayout(sheet).areas;
    const area = areas[index];
    if (!area) bad("There is no such print range");
    const next = { ...area! };
    if (edge === "top") next.r1 = to;
    else if (edge === "bottom") next.r2 = to;
    else if (edge === "left") next.c1 = to;
    else next.c2 = to;
    if (!Number.isInteger(to) || next.r1 < 1 || next.c1 < 1 || next.r2 > MAX_ROWS || next.c2 > MAX_COLS || next.r1 > next.r2 || next.c1 > next.c2) bad("A print range has to keep at least one cell");
    this.setPrintArea(sheet, areas.map((a, i) => rangeAddress(i === index ? next : a)));
  }

  /**
   * Puts a picture in a header or footer, in the left, middle or right of the first page's, the even pages' or the usual one
   * (or takes it away with `null`). The text of that part gets the `&G` code that says where the picture goes (at the end,
   * unless it has one already), and loses it again when the picture goes.
   */
  setHeaderFooterPicture(sheet: string, section: HeaderFooterSection, at: "left" | "center" | "right", picture: HeaderFooterPicture | null): void {
    const s = this.sheet(sheet);
    if (!["header", "footer", "firstHeader", "firstFooter", "evenHeader", "evenFooter"].includes(section)) bad(`"${section}" isn't a header or footer`);
    if (at !== "left" && at !== "center" && at !== "right") bad(`"${at}" isn't left, center or right`);
    const pictures: HeaderFooterPictures = { ...s.page?.pictures };
    const here = { ...pictures[section] };
    if (picture === null) delete here[at];
    else here[at] = picture;
    if (Object.keys(here).length) pictures[section] = here;
    else delete pictures[section];
    const parts = { ...s.page?.[section] };
    const text = withPictureCode(parts[at], picture !== null);
    if (text === "") delete parts[at];
    else parts[at] = text;
    this.setPageSetup(sheet, { pictures: Object.keys(pictures).length ? pictures : null, [section]: Object.keys(parts).length ? parts : null, ...(picture !== null && /^(first)/.test(section) ? { differentFirstPage: true as const } : {}), ...(picture !== null && /^even/.test(section) ? { differentOddEven: true as const } : {}) });
  }

  // ---- printing ----

  /** The pages the sheet prints on, with the paper, margins and scale they are printed at. */
  printLayout(sheet: string): PrintLayout {
    const s = this.sheet(sheet);
    return layoutPages(s, this.calculator.usedBounds(s.id));
  }

  /**
   * One page as it prints: its cells as an HTML table (with the title rows and columns, gridlines and headings it has), its
   * header and footer worked out, and where things are, in points: the size of the page's content, where the cells without
   * the titles sit in it (`main`), and the place on the sheet, in pixels, that those cells start at (`origin`), so that a chart or
   * picture can be put over them.
   */
  printPage(sheet: string, page: PrintPage, options: { remoteImages?: boolean; scene?: boolean } = {}): PrintedPage {
    const s = this.sheet(sheet);
    const setup = s.page;
    const draft = !!setup?.draft;
    const mono = !!setup?.blackAndWhite;
    const visible = (a: number, z: number, size: (n: number) => number) => Array.from({ length: z - a + 1 }, (_, i) => a + i).filter((n) => size(n) > 0);
    const rowSize = (r: number) => rowPixelsOf(s, r);
    const colSize = (c: number) => columnPixels(s, c);
    const titleRows = page.titleRows ? visible(page.titleRows[0], page.titleRows[1], rowSize) : [];
    const titleCols = page.titleCols ? visible(page.titleCols[0], page.titleCols[1], colSize) : [];
    const rows = [...titleRows, ...visible(page.range.r1, page.range.r2, rowSize)];
    const cols = [...titleCols, ...visible(page.range.c1, page.range.c2, colSize)];
    const headings = setup?.headings ? { width: HEADINGS_WIDTH, height: HEADINGS_HEIGHT } : null;
    const overflow: PrintOverflow[] = [];
    const sceneCells: PrintedCell[] = [];
    const sparks: PrintScene["sparklines"] = {};
    const html = cellsToTable(this.calculator, s.id, rows, cols, {
      remoteImages: !!options.remoteImages,
      effect: (r, c) => this.#formats.effect(s, r, c),
      table: (r, c) => tableLook(s, r, c, this.state.tableStyles, this.state.themeColors),
      sparkline: (r, c) => {
        if (draft || !s.sparklines?.length) return undefined;
        if (!s.sparklines?.length && !this.calculator.hasSparklineFormulas(s.id)) return undefined;
        const shape = this.sparklineShape(s.id, cellAddress(r, c), colSize(c), rowSize(r));
        if (shape && options.scene) sparks[`${r}:${c}`] = shape;
        return shape ? sparklineSvg(shape) : undefined;
      },
    }, {
      width: (c) => colSize(c) * 0.75,
      height: (r) => rowSize(r) * 0.75,
      gridlines: !!setup?.gridlines && !draft,
      headings,
      ...(setup?.errors ? { errors: setup.errors } : {}),
      mono,
      noGraphics: draft,
      overflow: (o) => overflow.push(o),
      ...(options.scene ? { cell: (cell: PrintedCell) => void sceneCells.push(cell) } : {}),
    });
    const sum = (list: number[], size: (n: number) => number) => list.reduce((n, i) => n + size(i) * 0.75, 0);
    const titleW = sum(titleCols, colSize);
    const titleH = sum(titleRows, rowSize);
    const mainCols = cols.slice(titleCols.length);
    const mainRows = rows.slice(titleRows.length);
    const main = { x: (headings?.width ?? 0) + titleW, y: (headings?.height ?? 0) + titleH, width: sum(mainCols, colSize), height: sum(mainRows, rowSize) };
    let ox = 0;
    for (let c = 1; c < page.range.c1; c++) ox += colSize(c);
    let oy = 0;
    for (let r = 1; r < page.range.r1; r++) oy += rowSize(r);
    const layout = this.printLayout(sheet);
    const first = setup?.firstPageNumber ?? 1;
    const serial = this.#options.now?.();
    const ctx = { page: page.number, pages: layout.pages.length + first - 1, file: `${this.state.title}.xlsx`, sheet: s.name, now: serial === undefined ? new Date() : new Date(Math.round((serial - 25569) * 86400000)) };
    const parts = (kind: "header" | "footer") => {
      const p = headerFooterFor(setup, kind, page.number, first);
      const section = headerFooterSectionFor(setup, kind, page.number, first);
      const runs = (at: "left" | "center" | "right") => {
        const out = headerFooterRuns(p?.[at] ?? "", { ...ctx, ...(draft ? {} : setup?.pictures?.[section]?.[at] ? { picture: setup.pictures[section]![at]! } : {}) });
        // Black and white leaves colour out of the text too.
        return mono ? out.map(({ color: _color, ...run }) => run) : out;
      };
      return { left: runs("left"), center: runs("center"), right: runs("right") };
    };
    if (page.notes) {
      // A page of the list of notes that comes after the sheet.
      const list = notesHtml(page.notes, layout.fits.width, mono);
      return { html: list.html, width: layout.fits.width, height: list.height, main: { x: 0, y: 0, width: layout.fits.width, height: list.height }, origin: { x: 0, y: 0 }, header: parts("header"), footer: parts("footer"), overflow: [], notes: [], graphics: false, mono };
    }
    // Notes kept showing print as their boxes, where they are on the sheet, cut off at the edge of the page's cells.
    const placed = setup?.comments === "sheet" ? noteBoxes(s, { cols: mainCols, rows: mainRows }, { width: main.width, height: main.height }) : [];
    const scene: PrintScene | undefined = options.scene
      ? {
          cells: sceneCells,
          rows: rows.map((row, i) => ({ row, y: sum(rows.slice(0, i), rowSize), height: rowSize(row) * 0.75 })),
          cols: cols.map((col, i) => ({ col, x: sum(cols.slice(0, i), colSize), width: colSize(col) * 0.75 })),
          gridlines: !!setup?.gridlines && !draft,
          headings,
          sparklines: sparks,
        }
      : undefined;
    return { html, width: main.x + main.width, height: main.y + main.height, main, origin: { x: ox, y: oy }, header: parts("header"), footer: parts("footer"), overflow, notes: placed, graphics: !draft, mono, ...(scene ? { scene } : {}) };
  }

  // ---- protection ----

  /** Runs `fn` with protection set aside, for the application's own changes to cells a person can't touch. */
  bypassProtection<T>(fn: () => T): T {
    this.#bypass++;
    try {
      return fn();
    } finally {
      this.#bypass--;
    }
  }

  #permit(s: Sheet, permission: Permission): void {
    if (!this.#bypass && s.protection && !mayDo(s.protection, permission, this.#user)) throw new ProtectionError(`This sheet is protected, and it doesn't allow this (${PERMISSION_LABELS[permission].toLowerCase()}). To do it, unprotect the sheet (you may be asked for a password).`);
  }

  /** Throws unless every cell of the range can be changed: the sheet isn't protected, or the cells are unlocked. */
  #requireEditable(s: Sheet, b: Bounds): void {
    if (this.#bypass || !s.protection) return;
    const why = this.#blocked(s, b);
    if (why) throw new ProtectionError(why.message, why.editRange);
  }

  /** Why some cell of the range can't be changed by this person, or null: every locked cell is in a range they may edit, or they may edit locked cells. */
  #blocked(s: Sheet, b: Bounds): { message: string; editRange?: { sheet: string; name: string } } | null {
    if (!s.protection || mayEditLocked(s.protection, this.#user) || !anyLocked(s, b)) return null;
    const access = this.#access();
    // Look at the cells one by one, unless the range is large (a whole column, say): then it has to lie inside one range that is open.
    if ((b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1) > 10_000) {
      const inside = (s.editRanges ?? []).some((r) => rangeStatus(s.id, r, access) === "open" && rangeBounds(r).some((x) => b.r1 >= x.r1 && b.r2 <= x.r2 && b.c1 >= x.c1 && b.c2 <= x.c2));
      return inside ? null : this.#whyLocked(s, { open: false });
    }
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        if (!lockAt(s, r, c, s.cells[cellAddress(r, c)])) continue;
        const hit = openAt(s, r, c, access);
        if (!hit.open) return this.#whyLocked(s, hit);
      }
    return null;
  }

  #whyLocked(s: Sheet, hit: ReturnType<typeof openAt>): { message: string; editRange?: { sheet: string; name: string } } {
    if (!hit.open && hit.password) return { message: `That cell is in "${hit.password.name}", a range that people may edit with a password. Enter the password to edit it.`, editRange: { sheet: s.id, name: hit.password.name } };
    if (!hit.open && hit.closed) return { message: `That cell is locked, because the sheet is protected. It is in "${hit.closed.name}", a range that only some people may edit, and you aren't one of them.` };
    return { message: "That cell is locked, because the sheet is protected. To change it, unprotect the sheet (you may be asked for a password)." };
  }

  /**
   * On a protected sheet, cells that can be changed keep being locked or unlocked, and keep showing or hiding their formulas,
   * whatever is pasted, filled or cleared over them: only a person who unprotects the sheet decides that.
   */
  #keepLocks(ops: readonly SheetOp[]): readonly SheetOp[] {
    return ops.map((op) => {
      if (op.type !== "set_cells") return op;
      const sheet = this.state.sheets.find((x) => x.id === op.sheet);
      if (!sheet?.protection) return op;
      let cells: Record<string, Cell | null> | undefined;
      for (const [key, next] of Object.entries(op.cells)) {
        const old = sheet.cells[key];
        const at = parseCell(key)!;
        if (lockAt(sheet, at.row, at.col, old)) continue;
        const hide = hideAt(sheet, at.row, at.col, old);
        if (!lockAt(sheet, at.row, at.col, next ?? undefined) && hideAt(sheet, at.row, at.col, next ?? undefined) === hide) continue;
        const style: CellStyle = { ...next?.s };
        if (defaultLock(sheet, at.row, at.col) === false) delete style.locked;
        else style.locked = false;
        if (hide !== defaultHide(sheet, at.row, at.col)) style.hideFormula = hide;
        else delete style.hideFormula;
        const kept: Cell = { ...(next ?? {}) };
        if (Object.keys(style).length) kept.s = style;
        else delete kept.s;
        (cells ??= { ...op.cells })[key] = emptyCell(kept) ? null : kept;
      }
      return cells ? { ...op, cells } : op;
    });
  }

  /** Whether the sheet is protected. */
  isProtected(sheet: string): boolean {
    return this.sheet(sheet).protection !== undefined;
  }

  /** The sheet's protection (what it allows, whether it has a password), or undefined. */
  protection(sheet: string): SheetProtection | undefined {
    return this.sheet(sheet).protection;
  }

  /** Whether a cell is locked (every cell is, unless it was unlocked). Locking only matters on a protected sheet. */
  isLocked(sheet: string, address: string): boolean {
    return lockOfKey(this.sheet(sheet), address, this.cell(sheet, address));
  }

  /**
   * Whether the cell can be changed now: the sheet isn't protected, or the cell is unlocked, or it is in a range that this
   * person may edit (they have its password, or one of the roles it names), or they may edit locked cells.
   */
  canEdit(sheet: string, address: string): boolean {
    return this.editBlock(sheet, address) === null;
  }

  /** Why the cell can't be changed now, or null when it can. `editRange` names the range to ask a password for, when one would open it. */
  editBlock(sheet: string, address: string): { message: string; editRange?: { sheet: string; name: string } } | null {
    const s = this.sheet(sheet);
    if (this.#bypass > 0 || !s.protection) return null;
    const p = parseCell(address);
    if (!p) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    return this.#blocked(s, { r1: p.row, c1: p.col, r2: p.row, c2: p.col });
  }

  /** Whether the sheet allows this to the person using it (everything, when it isn't protected). */
  can(sheet: string, permission: Permission): boolean {
    const p = this.sheet(sheet).protection;
    return this.#bypass > 0 || !p || mayDo(p, permission, this.#user);
  }

  /** Whether the cell's formula is hidden: the sheet is protected, and the cell has a formula and says to hide it. */
  formulaHidden(sheet: string, address: string): boolean {
    const c = this.cell(sheet, address);
    return this.isProtected(sheet) && c?.f !== undefined && hideOfKey(this.sheet(sheet), address, c);
  }

  /**
   * Whether any cell of the range has a formula that is hidden (the sheet is protected). Exact, and quick for a whole column
   * or row, because only the cells that exist can have a formula.
   */
  anyFormulaHidden(sheet: string, range: string): boolean {
    const s = this.sheet(sheet);
    return !!s.protection && anyFormulaHidden(s, this.bounds(range));
  }

  /** Whether the cell, empty or not, would hide a formula typed into it (its own setting, or its row's, column's or the sheet's). */
  hidesFormula(sheet: string, address: string): boolean {
    return hideOfKey(this.sheet(sheet), address, this.cell(sheet, address));
  }

  // ---- who is using the sheet, and ranges that may be edited ----

  /** What the session knows when it decides about an edit. */
  #access(): Access {
    return { user: this.#user, opened: this.#opened };
  }

  /** Who is using the sheet, as the application said, or null. */
  get user(): SheetUser | null {
    return this.#user;
  }

  /**
   * Says who is using the sheet, so that the roles protected sheets and ranges that may be edited name can be checked. Pli keeps
   * no accounts: the application knows who the person is and gives their id and roles. Changing it while any sheet is
   * protected forgets the undo history, so that undo can't change what the new person may not.
   */
  setUser(user: SheetUser | null): void {
    const same = JSON.stringify(user && { id: user.id, roles: [...(user.roles ?? [])].sort(), role: user.role, accounts: [...(user.accounts ?? [])].sort() }) === JSON.stringify(this.#user && { id: this.#user.id, roles: [...(this.#user.roles ?? [])].sort(), role: this.#user.role, accounts: [...(this.#user.accounts ?? [])].sort() });
    this.#user = user ? { ...user, ...(user.roles ? { roles: [...user.roles] } : {}), ...(user.accounts ? { accounts: [...user.accounts] } : {}) } : null;
    if (!same) this.#forgetAccess();
  }

  /** Forgets the undo history when sheets are protected and what the person may do has changed. */
  #forgetAccess(): void {
    if (this.#pending) return;
    if (this.state.protection || this.state.sheets.some((s) => s.protection)) this.session.reset(this.state);
  }

  /** The ranges that may be edited on the sheet (Excel's Allow Edit Ranges). */
  editRanges(sheet: string): readonly EditRange[] {
    return this.sheet(sheet).editRanges ?? [];
  }

  #changeEditRanges(s: Sheet, list: EditRange[]): void {
    if (!this.#bypass && s.protection) throw new ProtectionError("The ranges that people may edit can't be changed while the sheet is protected. Unprotect the sheet first (you may be asked for a password).");
    this.commit([{ type: "set_edit_ranges", sheet: s.id, ranges: list.length ? list : null }]);
  }

  /** Adds a range that may be edited. A password (or `permissions`, roles that need none) makes it so that only some people can. */
  addEditRange(sheet: string, spec: { name: string; ranges: readonly string[]; password?: string; permissions?: readonly string[]; denied?: readonly string[] }): EditRange {
    const s = this.sheet(sheet);
    const range: EditRange = { name: spec.name, ranges: [...spec.ranges], ...(spec.password ? { password: hashPassword(spec.password) } : {}), ...(spec.permissions ? { permissions: [...spec.permissions] } : {}), ...(spec.denied?.length ? { denied: [...spec.denied] } : {}) };
    this.#changeEditRanges(s, [...(s.editRanges ?? []), range]);
    return this.editRanges(sheet).find((r) => r.name.toLowerCase() === spec.name.trim().toLowerCase())!;
  }

  /**
   * Changes a range that may be edited. `password` is the new password, or `null` to take it off; `permissions` the roles (or
   * accounts, as `sid:S-1-5-21-…`) that may edit it without one (`null` takes them off); `denied` those who may not even then.
   */
  updateEditRange(sheet: string, name: string, patch: { name?: string; ranges?: readonly string[]; password?: string | null; permissions?: readonly string[] | null; denied?: readonly string[] | null }): EditRange {
    const s = this.sheet(sheet);
    const old = (s.editRanges ?? []).find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
    if (!old) throw new PliError("not_found", `There is no range called "${name}" that people may edit`);
    const next: EditRange = { ...old };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.ranges !== undefined) next.ranges = [...patch.ranges];
    if (patch.password !== undefined) {
      if (patch.password === null || patch.password === "") delete next.password;
      else next.password = hashPassword(patch.password);
    }
    if (patch.permissions !== undefined) {
      if (patch.permissions === null) delete next.permissions;
      else next.permissions = [...patch.permissions];
    }
    if (patch.denied !== undefined) {
      if (patch.denied === null || !patch.denied.length) delete next.denied;
      else next.denied = [...patch.denied];
    }
    this.#changeEditRanges(s, (s.editRanges ?? []).map((r) => (r === old ? next : r)));
    return this.editRanges(sheet).find((r) => r.name.toLowerCase() === next.name.trim().toLowerCase())!;
  }

  /** Takes a range that may be edited away (its cells go back to being locked, when the sheet is protected). */
  deleteEditRange(sheet: string, name: string): void {
    const s = this.sheet(sheet);
    const list = (s.editRanges ?? []).filter((r) => r.name.toLowerCase() !== name.trim().toLowerCase());
    if (list.length === (s.editRanges ?? []).length) throw new PliError("not_found", `There is no range called "${name}" that people may edit`);
    this.#changeEditRanges(s, list);
  }

  /**
   * Opens a range that may be edited with its password, for as long as the session lives (the password is not kept). Throws
   * `ProtectionError` when it is wrong. A range with no password is open already to whoever may edit it.
   */
  unlockEditRange(sheet: string, name: string, password: string): void {
    const s = this.sheet(sheet);
    const range = (s.editRanges ?? []).find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
    if (!range) throw new PliError("not_found", `There is no range called "${name}" that people may edit`);
    if (!range.password) return;
    if (!checkPassword(range.password, password)) throw new ProtectionError("That password isn't right");
    this.#opened.add(rangeKey(s.id, range));
  }

  /** Closes the ranges that were opened with a password (the history is forgotten if sheets are protected, so that undo can't edit them). */
  lockEditRanges(): void {
    if (!this.#opened.size) return;
    this.#opened.clear();
    this.#forgetAccess();
  }

  /** Whether the person can edit in this range now: it needs no password or they gave it, or they have a role it names. */
  editRangeOpen(sheet: string, name: string): boolean {
    const s = this.sheet(sheet);
    const range = (s.editRanges ?? []).find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
    return !!range && rangeStatus(s.id, range, this.#access()) === "open";
  }

  /**
   * Protects a sheet: its locked cells can't be changed, and only what `allow` lists can be done (by default only selecting
   * cells). With a password, that is needed to take the protection off. Protecting forgets the undo history, as Excel does,
   * so that undo can't change what is locked now.
   */
  protectSheet(sheet: string, options: { password?: string; allow?: readonly Permission[]; roles?: Partial<Record<Permission, readonly string[]>>; editLocked?: readonly string[] } = {}): void {
    const s = this.sheet(sheet);
    if (s.protection) throw new PliError("invalid_operation", "That sheet is protected already");
    const roles = options.roles ? (Object.fromEntries(Object.entries(options.roles).map(([k, v]) => [k, [...(v ?? [])]])) as SheetProtection["roles"]) : undefined;
    const protection: SheetProtection = { ...(options.password ? { password: hashPassword(options.password) } : {}), allow: [...(options.allow ?? DEFAULT_ALLOW)], ...(roles ? { roles } : {}), ...(options.editLocked ? { editLocked: [...options.editLocked] } : {}) };
    this.#setProtection({ type: "set_protection", sheet: s.id, protection });
  }

  /** Takes the protection off a sheet. With a password set, it must be given. */
  unprotectSheet(sheet: string, password?: string): void {
    const s = this.sheet(sheet);
    if (!s.protection) return;
    if (s.protection.password && !checkPassword(s.protection.password, password ?? "")) throw new ProtectionError("That password isn't right");
    this.#opened.clear();
    this.#setProtection({ type: "set_protection", sheet: s.id, protection: null });
  }

  /** Protects the workbook's structure: sheets can't be added, deleted, renamed, moved or hidden. */
  protectWorkbook(options: { password?: string; roles?: readonly string[] } = {}): void {
    if (this.state.protection) throw new PliError("invalid_operation", "The workbook is protected already");
    this.#setProtection({ type: "set_workbook_protection", protection: { structure: true, ...(options.password ? { password: hashPassword(options.password) } : {}), ...(options.roles ? { roles: [...options.roles] } : {}) } });
  }

  unprotectWorkbook(password?: string): void {
    const p = this.state.protection;
    if (!p) return;
    if (p.password && !checkPassword(p.password, password ?? "")) throw new ProtectionError("That password isn't right");
    this.#setProtection({ type: "set_workbook_protection", protection: null });
  }

  /** Iterative calculation: the settings when it is on, otherwise null. */
  get iteration(): IterationSettings | null {
    return this.state.iteration ?? null;
  }

  /**
   * Turns iterative calculation on or off. On, a formula that refers to itself (directly or through others) is worked
   * out again and again, each time reading what it came to last, until nothing changes by more than `maxChange` or it
   * has been worked out `maxIterations` times; off (`null`), such a formula reads as 0. Anything left out takes Excel's
   * default (100 times, 0.001).
   */
  setIteration(settings: Partial<IterationSettings> | null): void {
    this.commit([{ type: "set_iteration", iteration: settings === null ? null : cleanIteration(settings) }]);
  }

  get workbookProtected(): boolean {
    return this.state.protection !== undefined;
  }

  /** Applies a protection change, and forgets the history so that undo can't get round it. */
  #setProtection(op: SheetOp): void {
    if (this.#pending) throw new PliError("invalid_operation", "Protection can't change inside a batch");
    this.session.transact([op], { history: false });
    this.session.reset(this.state);
  }

  // ---- links and notes ----

  /**
   * Where the cell leads: the link it has, or the address a `HYPERLINK` formula in it works out to. `formula` says it is
   * the second kind, which changes with the formula and is not a link to take off. Null when the cell isn't a link.
   */
  link(sheet: string, address: string): (CellLink & { formula?: true }) | null {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const s = this.sheet(sheet);
    const cell = s.cells[cellAddress(pos.row, pos.col)];
    if (cell?.link) return cell.link;
    if (cell?.f === undefined || !/^\s*HYPERLINK\s*\(/i.test(cell.f)) return null;
    try {
      const tree = parseFormula(cell.f);
      if (tree.t !== "call" || tree.name.toUpperCase() !== "HYPERLINK" || !tree.args[0]) return null;
      const to = this.calculator.evaluateAt(s.id, pos.row, pos.col, printFormula(tree.args[0]));
      return typeof to === "string" && to.trim() !== "" ? { ...cleanLink({ to }), formula: true } : null;
    } catch {
      return null;
    }
  }

  /**
   * Makes the cells of a range links, or takes the links off (`null`). `text` is what the cell shows, for a single cell;
   * an empty cell with none shows the address. A cell that is a link keeps its number format and style, and typing new
   * content into it takes the link off.
   */
  setLink(sheet: string, range: string, link: CellLink | null, options: { text?: string } = {}): void {
    const clean = link === null ? null : cleanLink(link);
    const b = this.bounds(range);
    const single = b.r1 === b.r2 && b.c1 === b.c2;
    if (options.text !== undefined && !single) throw new PliError("invalid_operation", "The text of a link goes in one cell");
    this.patch(sheet, range, (c) => {
      const next = { ...c };
      if (clean === null) delete next.link;
      else next.link = clean;
      if (clean !== null && single && (options.text !== undefined || (c.v === undefined && c.f === undefined && c.e === undefined && !c.control))) {
        const text = options.text ?? clean.to.replace(/^#/, "");
        delete next.f;
        delete next.e;
        if (text === "") delete next.v;
        else next.v = text;
      }
      return next;
    });
  }

  /**
   * Notes that a link was followed, so that the cell takes the theme's followed-hyperlink colour (Excel's "Followed Hyperlink" style).
   * Returns whether the cell changed. A link that can't be followed (a place that isn't there, an address a browser may not open) is
   * not marked, and nor is one a `HYPERLINK` formula makes. Not an undo step (it is not an edit), and allowed on a protected sheet.
   */
  followLink(sheet: string, address: string): boolean {
    const s = this.sheet(sheet);
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const key = cellAddress(pos.row, pos.col);
    const cell = s.cells[key];
    if (!cell?.link || cell.link.followed) return false;
    if (isPlace(cell.link.to) ? this.linkPlace(s.id, cell.link.to) === null : !isOpenable(cell.link.to)) return false;
    this.#bypass++;
    try {
      this.commit([{ type: "set_cells", sheet: s.id, cells: { [key]: { ...cell, link: { ...cell.link, followed: true } } } }], { history: false });
    } finally {
      this.#bypass--;
    }
    return true;
  }

  /** The inside of the workbook a link such as `#Sheet2!B4` leads to, as the sheet's id and the range; null when there is no such place. */
  linkPlace(from: string, to: string): { sheet: string; range: string } | null {
    const hit = placeOf(this.state, to, this.sheet(from).id);
    return hit ? { sheet: hit.sheet, range: rangeAddress(hit.range) } : null;
  }

  /** The note on a cell, or null. */
  note(sheet: string, address: string): string | null {
    return this.cell(sheet, address)?.note ?? null;
  }

  /** Everything a cell's note has: its text, the runs that give parts of it a look, who wrote it and its box. Null when there is no note. */
  noteInfo(sheet: string, address: string): NoteInfo | null {
    const c = this.cell(sheet, address);
    return c?.note === undefined ? null : infoOf(c);
  }

  /**
   * Puts a note on a cell, or takes it off (`null`, or empty text). `options.runs` gives parts of the text a look (they have
   * to add up to the text; without them the note is plain when its text changes), `options.author` says who wrote it (new
   * notes get the session's `author`; editing one keeps the author it has, and `null` takes it off) and `options.box`
   * its size, place and whether it stays showing (`null` for the usual box).
   */
  setNote(sheet: string, address: string, text: string | null, options: SetNoteOptions = {}): void {
    const clean = text === null ? null : cleanNote(text);
    const runs = clean !== null && options.runs ? cleanNoteRuns(clean, options.runs) : undefined;
    const author = options.author == null ? options.author : cleanAuthor(options.author) ?? null;
    const box = options.box == null ? options.box : cleanNoteBox(options.box) ?? null;
    this.patch(sheet, address, (c) => {
      const next = { ...c };
      if (clean === null) {
        delete next.note;
        return next; // the rest of the note goes with it
      }
      const had = c.note !== undefined;
      next.note = clean;
      if (options.runs !== undefined) {
        if (runs) next.noteRuns = runs;
        else delete next.noteRuns;
      } else if (c.note !== clean) delete next.noteRuns;
      if (author !== undefined) {
        if (author) next.noteAuthor = author;
        else delete next.noteAuthor;
      } else if (!had) {
        const own = cleanAuthor(this.author);
        if (own) next.noteAuthor = own;
      }
      if (box !== undefined) {
        if (box) next.noteBox = box;
        else delete next.noteBox;
      }
      return next;
    });
  }

  /** Every note on the sheet, row by row. */
  notes(sheet: string): (NoteInfo & { address: string })[] {
    const s = this.sheet(sheet);
    return Object.entries(s.cells)
      .filter(([, c]) => c.note !== undefined)
      .map(([address, c]) => ({ address, pos: parseCell(address)!, info: infoOf(c) }))
      .sort((a, b) => a.pos.row - b.pos.row || a.pos.col - b.pos.col)
      .map(({ address, info }) => ({ address, ...info }));
  }

  /** Sets the box of a note: its size, where it sits and whether it stays showing. `null` gives it the usual box, hidden until the pointer rests on its cell. */
  setNoteBox(sheet: string, address: string, box: NoteBox | null): void {
    const clean = box === null ? null : cleanNoteBox(box) ?? null;
    this.#noteOnly(sheet, address);
    this.patch(sheet, address, (c) => {
      const next = { ...c };
      if (clean) next.noteBox = clean;
      else delete next.noteBox;
      return next;
    });
  }

  /**
   * Changes how a note's box looks without touching its size, place or visibility: `fill` (`#rrggbb`), `transparency`
   * (percent), `picture` (a `data:` URI of a PNG, JPEG or GIF that fills the box), `line` (`#rrggbb` or `"none"`),
   * `lineWeight` (points), `dash` and `shadow` (`false` for none). A property set to `null` goes back to Excel's usual.
   * One undo step.
   */
  setNoteLook(sheet: string, address: string, look: NoteLookPatch): void {
    const c = this.#noteOnly(sheet, address);
    const next: Record<string, unknown> = { ...(c.noteBox ?? {}) };
    for (const [k, v] of Object.entries(look)) {
      if (v === null) delete next[k];
      else if (v !== undefined) next[k] = v;
    }
    this.setNoteBox(sheet, address, Object.keys(next).length ? (next as NoteBox) : null);
  }

  /** Keeps a note showing on the sheet (`true`), or only when the pointer rests on its cell (`false`); without an argument it flips. Returns whether it shows now. */
  showNote(sheet: string, address: string, show?: boolean): boolean {
    const c = this.#noteOnly(sheet, address);
    const on = show ?? !c.noteBox?.show;
    const { show: _was, ...rest } = c.noteBox ?? {};
    this.setNoteBox(sheet, address, on ? { ...rest, show: true } : rest);
    return on;
  }

  /** Shows every note on the sheet (or hides them, with `false`), as one undo step. Returns how many changed. */
  showAllNotes(sheet: string, show = true): number {
    const s = this.sheet(sheet);
    const cells: Record<string, Cell | null> = {};
    for (const [address, c] of Object.entries(s.cells)) {
      if (c.note === undefined || !!c.noteBox?.show === show) continue;
      const { show: _was, ...rest } = c.noteBox ?? {};
      cells[address] = cleanCell({ ...c, noteBox: show ? { ...rest, show: true } : rest });
    }
    const count = Object.keys(cells).length;
    if (count) this.commit([{ type: "set_cells", sheet: s.id, cells }]);
    return count;
  }

  /** Gives the characters of a note from `from` to `to` (offsets in its text) a look: bold, a colour, a size and so on (`null` takes one off). */
  formatNote(sheet: string, address: string, from: number, to: number, style: NoteRunStyle): void {
    this.#noteOnly(sheet, address);
    this.patch(sheet, address, (c) => {
      const next = { ...c };
      const runs = styleNoteRuns(c.note!, c.noteRuns, from, to, style);
      if (runs) next.noteRuns = runs;
      else delete next.noteRuns;
      return next;
    });
  }

  /** The cell, which has to have a note. */
  #noteOnly(sheet: string, address: string): Cell {
    const c = this.cell(sheet, address);
    if (c?.note === undefined) throw new PliError("invalid_operation", `There is no note on ${address}`);
    return c;
  }

  // ---- find and replace ----

  /**
   * The cells that have the text, sheet by sheet (the sheets that aren't hidden) and in the order of `by`. A cell a
   * formula spilled into counts when looking at values.
   */
  find(options: FindOptions): FoundCell[] {
    const wanted = options.errors || options.format !== undefined;
    const match = matcherOf(options) ?? (wanted ? MATCH_ANY : null);
    if (!match) return [];
    const scope = options.scope ?? "workbook";
    const sheets = scope === "workbook" ? this.state.sheets.filter((s) => options.hidden || !s.hidden) : [this.sheet(scope.sheet)];
    const limit = scope !== "workbook" && scope.range ? this.bounds(scope.range) : null;
    const shown = (options.lookIn ?? "values") === "values";
    const inNotes = options.lookIn === "notes";
    const out: FoundCell[] = [];
    for (const s of sheets) {
      const hits: { row: number; col: number; text: string }[] = [];
      const look = (row: number, col: number) => {
        if (limit && (row < limit.r1 || row > limit.r2 || col < limit.c1 || col > limit.c2)) return;
        const address = cellAddress(row, col);
        const cell = s.cells[address];
        if (options.format && !hasFormat(cell, options.format)) return;
        if (options.errors && !isError(this.calculator.value(s.id, address))) return;
        let text: string;
        if (shown) {
          if (!cell && !this.calculator.spillAt(s.id, row, col)) return;
          text = this.calculator.display(s.id, address).text;
        } else {
          if (!cell) return;
          // A formula that a protected sheet hides isn't there to be found.
          if (!inNotes && cell.f !== undefined && s.protection && hideAt(s, row, col, cell)) return;
          text = inNotes ? cell.note ?? "" : typedText(cell);
        }
        // With a look to find, empty cells count too; otherwise there is nothing in them to find.
        if ((text !== "" || (options.format && options.text === "" && !options.errors)) && match.test(text)) hits.push({ row, col, text });
      };
      const extent = shown ? this.calculator.usedBounds(s.id) : null;
      if (extent && (extent.r2 - extent.r1 + 1) * (extent.c2 - extent.c1 + 1) <= 50_000) {
        for (let r = extent.r1; r <= extent.r2; r++) for (let c = extent.c1; c <= extent.c2; c++) look(r, c);
      } else {
        for (const address of Object.keys(s.cells)) {
          const p = parseCell(address)!;
          look(p.row, p.col);
        }
      }
      hits.sort(options.by === "columns" ? (a, b) => a.col - b.col || a.row - b.row : (a, b) => a.row - b.row || a.col - b.col);
      for (const h of hits) out.push({ sheet: s.id, address: cellAddress(h.row, h.col), text: h.text, ...(inNotes ? { in: "note" as const } : {}) });
    }
    return out;
  }

  /**
   * Replaces the text in every cell that has it, as one undo step, or only in `only`. It works on what was typed in the
   * cells, formulas included, whatever `lookIn` says; a cell is typed into again as Excel reads typing, so replacing
   * `1` with `2` in `10` makes the number `20`, and in a text cell holding `007` it stays text.
   */
  replace(options: FindOptions, replacement: string, only?: readonly { sheet: string; address: string }[]): ReplaceResult {
    const result: ReplaceResult = { cells: 0, occurrences: 0, skipped: 0 };
    const match = matcherOf(options);
    if (!match) return result;
    const wanted = only && new Set(only.map((c) => `${this.sheet(c.sheet).id}!${c.address}`));
    if (options.lookIn === "notes") return this.#replaceInNotes(options, match, replacement, wanted);
    const inputs = new Map<string, Record<string, string>>();
    for (const hit of this.find({ ...options, lookIn: "formulas" })) {
      if (wanted && !wanted.has(`${hit.sheet}!${hit.address}`)) continue;
      const s = this.sheet(hit.sheet);
      const old = s.cells[hit.address]!;
      const { text, count } = match.replace(hit.text, replacement);
      if (text === hit.text) continue;
      const parsed = cellFromInput(text);
      // A text cell stays text, even when what is left looks like a number or a formula.
      const input = old.f === undefined && typeof old.v === "string" && parsed && (parsed.f !== undefined || parsed.v !== text) ? "'" + text : text;
      if (!this.#takes(s, hit.address, old, input)) {
        result.skipped++;
        continue;
      }
      result.cells++;
      result.occurrences += count;
      let sheetInputs = inputs.get(s.id);
      if (!sheetInputs) inputs.set(s.id, (sheetInputs = {}));
      sheetInputs[hit.address] = input;
    }
    if (inputs.size) {
      this.batch(() => {
        for (const [id, cells] of inputs) this.setCells(id, cells, { validate: false });
      });
    }
    return result;
  }

  /**
   * Replaces the text in notes. A word swapped inside one run of a note keeps that run's look, and the rest of the note keeps
   * its own. A note left with no text is taken off, as an empty note is none.
   */
  #replaceInNotes(options: FindOptions, match: NonNullable<ReturnType<typeof matcherOf>>, replacement: string, wanted: Set<string> | undefined): ReplaceResult {
    const result: ReplaceResult = { cells: 0, occurrences: 0, skipped: 0 };
    const changes = new Map<string, Record<string, Cell | null>>();
    for (const hit of this.find(options)) {
      if (wanted && !wanted.has(`${hit.sheet}!${hit.address}`)) continue;
      const old = this.sheet(hit.sheet).cells[hit.address]!;
      const edits = match.edits(old.note!, replacement);
      if (!edits.length) continue;
      const done = editNoteRuns(old.note!, old.noteRuns, edits);
      if (done.note === old.note && JSON.stringify(done.runs) === JSON.stringify(old.noteRuns)) continue;
      if (done.note.length > MAX_NOTE_LENGTH) {
        result.skipped++;
        continue;
      }
      const next: Cell = { ...old, note: done.note };
      if (done.runs) next.noteRuns = done.runs;
      else delete next.noteRuns;
      let cells = changes.get(hit.sheet);
      if (!cells) changes.set(hit.sheet, (cells = {}));
      cells[hit.address] = cleanCell(next);
      result.cells++;
      result.occurrences += edits.length;
    }
    if (changes.size) this.commit([...changes].map(([id, cells]) => ({ type: "set_cells" as const, sheet: id, cells })));
    return result;
  }

  /** Whether typing `input` into the cell would be accepted by what sits on it: a checkbox, a strict dropdown, a table's column name. */
  #takes(s: Sheet, address: string, old: Cell, input: string): boolean {
    const parsed = cellFromInput(input);
    try {
      checkAgainstControl(old.control, parsed);
      if (s.tables?.length) this.#withTables(s, { [address]: merge(old, parsed) });
    } catch (e) {
      if (e instanceof PliError) return false;
      throw e;
    }
    return true;
  }

  // ---- editing cells ----

  /**
   * Types into a cell. Text is read as Excel reads it: `=SUM(A1:A3)` is a formula, `12%` a percentage, `3/5/2024` a
   * date. Anything that isn't text (a number, boolean, null) is stored as it is. A cell keeps its number format and
   * style when only its content changes.
   */
  setCell(sheet: string, address: string, input: string | number | boolean | null, options: { validate?: boolean; links?: boolean } = {}): void {
    this.setCells(sheet, { [address]: input }, options);
  }

  /**
   * Types into several cells at once, as one undo step. An entry that a data validation with the `stop` alert refuses
   * throws, as a strict dropdown does; pass `validate: false` to put it in anyway (as pasting does). With `links: true`, a
   * web address typed in becomes a link, as when typing in a grid.
   */
  setCells(sheet: string, inputs: Record<string, string | number | boolean | null>, options: { validate?: boolean; links?: boolean; vet?: PasteContext } = {}): void {
    const s = this.sheet(sheet);
    const cells: Record<string, Cell | null> = {};
    for (const [address, input] of Object.entries(inputs)) {
      const pos = parseCell(address);
      if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
      const key = cellAddress(pos.row, pos.col);
      const old = s.cells[key];
      const parsed = typeof input === "string" ? cellFromInput(input) : input === null ? null : { v: input };
      // Typing a web address makes a link, as in Excel; text forced with a leading ' stays text.
      if (options.links && typeof input === "string" && !input.startsWith("'") && typeof parsed?.v === "string" && parsed.f === undefined) {
        const to = linkInText(parsed.v);
        if (to) parsed.link = { to };
      }
      checkAgainstControl(old?.control, parsed);
      cells[key] = merge(old, parsed);
      if (options.validate !== false && s.validations?.length) {
        const problem = this.#refusal(s, pos.row, pos.col, parsed, cells[key]);
        if (problem?.alert === "stop") throw new PliError("invalid_operation", problem.message);
      }
    }
    this.commit(this.#withTables(s, cells), options.vet ? { vet: options.vet } : {});
  }

  /**
   * The operations for writing `cells`, with what a table needs besides: a header cell that is typed over renames its
   * column (formulas that name it follow), and entries right under a table or beside it make it grow.
   */
  #withTables(s: Sheet, cells: Record<string, Cell | null>): SheetOp[] {
    const write: SheetOp = { type: "set_cells", sheet: s.id, cells };
    if (!s.tables?.length) return [write];
    const renames: { table: string; from: string; to: string }[] = [];
    for (const [key, next] of Object.entries(cells)) {
      const pos = parseCell(key)!;
      const entry = tableAtCell(s, pos.row, pos.col);
      if (!entry || !hasHeader(entry.table) || pos.row !== entry.bounds.r1) continue;
      const names = tableColumns(s, entry.bounds, entry.table);
      const old = names[pos.col - entry.bounds.c1]!;
      const text = next === null ? "" : typeof next.v === "string" ? next.v : typeof next.v === "number" ? String(next.v) : "";
      if (next?.f !== undefined) throw new PliError("invalid_operation", "A column name in a table can't be a formula");
      if (text === "") throw new PliError("invalid_operation", "A column in a table needs a name");
      if (names.some((n, i) => i !== pos.col - entry.bounds.c1 && n.toLowerCase() === text.toLowerCase())) throw new PliError("invalid_operation", `Two columns would be called "${text}"; column names must be different`);
      cells[key] = { ...next!, v: text };
      if (text !== old) renames.push({ table: entry.table.name, from: old, to: text });
    }
    // A formula typed into one cell of a table's column fills the column when the rest of it is empty, and changes it when
    // the column is calculated already (as in Excel).
    const calculated = new Map<string, { table: Table; name: string; formula: string }>();
    const perColumn = new Map<string, number>();
    const columnOf = (key: string) => {
      const pos = parseCell(key)!;
      const entry = tableAtCell(s, pos.row, pos.col);
      return entry && pos.row >= dataRows(entry.table, entry.bounds)[0] && !(entry.table.totals && pos.row === entry.bounds.r2) ? { entry, pos } : null;
    };
    const columnsHit = new Map<string, { entry: { table: Table; bounds: Bounds }; col: number }>();
    for (const key of Object.keys(cells)) {
      const hit = columnOf(key);
      if (!hit) continue;
      const id = `${hit.entry.table.id}|${hit.pos.col}`;
      perColumn.set(id, (perColumn.get(id) ?? 0) + 1);
      columnsHit.set(id, { entry: hit.entry, col: hit.pos.col });
    }
    for (const [key, next] of Object.entries(cells)) {
      const hit = columnOf(key);
      if (!hit || next?.f === undefined || perColumn.get(`${hit.entry.table.id}|${hit.pos.col}`) !== 1) continue;
      const { entry, pos } = hit;
      const [top, bottom] = dataRows(entry.table, entry.bounds);
      const name = tableColumns(s, entry.bounds, entry.table)[pos.col - entry.bounds.c1]!;
      let formula: string;
      try {
        formula = shiftFormula(next.f, top - pos.row, 0);
      } catch {
        continue;
      }
      const stored = entry.table.calculated?.[name];
      if (stored === formula) continue;
      if (stored === undefined) {
        let others = false;
        for (let r = top; r <= bottom && !others; r++) {
          const x = r === pos.row ? undefined : s.cells[cellAddress(r, pos.col)];
          if (x && (x.v !== undefined || x.f !== undefined || x.e !== undefined)) others = true;
        }
        if (others) continue;
      }
      for (let r = top; r <= bottom; r++) {
        if (r === pos.row) continue;
        const at = cellAddress(r, pos.col);
        const { v: _v, e: _e, f: _f, ...rest } = s.cells[at] ?? {};
        cells[at] = { ...rest, f: shiftFormula(formula, r - top, 0) };
      }
      calculated.set(`${entry.table.id}|${name}`, { table: entry.table, name, formula });
    }
    // Every cell of a calculated column given the same formula at once (replacing text in all of them, say) changes the column.
    for (const [id, n] of perColumn) {
      if (n < 2) continue;
      const { entry, col } = columnsHit.get(id)!;
      const name = tableColumns(s, entry.bounds, entry.table)[col - entry.bounds.c1]!;
      const stored = entry.table.calculated?.[name];
      if (stored === undefined) continue;
      const [top, bottom] = dataRows(entry.table, entry.bounds);
      let formula: string | undefined;
      let same = "";
      for (let r = top; r <= bottom; r++) {
        const next = cells[cellAddress(r, col)];
        if (next?.f === undefined) {
          formula = undefined;
          break;
        }
        let shifted: string;
        let normal: string;
        try {
          shifted = shiftFormula(next.f, top - r, 0);
          normal = printFormula(parseFormula(shifted));
        } catch {
          formula = undefined;
          break;
        }
        if (formula === undefined) {
          formula = shifted;
          same = normal;
        } else if (normal !== same) {
          formula = undefined;
          break;
        }
      }
      if (formula !== undefined && formula !== stored) calculated.set(`${entry.table.id}|${name}`, { table: entry.table, name, formula });
    }
    let wb = this.state;
    const ops: SheetOp[] = [];
    const push = (op: SheetOp) => {
      wb = sheetReducer.apply(wb, op).state; // refused before it is kept
      ops.push(op);
    };
    push(write);
    for (const { table, name, formula } of calculated.values()) {
      const current = wb.sheets.find((x) => x.id === s.id)!.tables!.find((t) => t.id === table.id)!;
      push({ type: "update_table", sheet: s.id, table: { ...current, calculated: { ...current.calculated, [name]: formula } } });
    }
    // A table grows over what is typed in the row under it or the column beside it.
    for (const entry of allTables(wb).filter((t) => t.sheet.id === s.id)) {
      const { table } = entry;
      if (table.totals) continue;
      let b = entry.bounds;
      const has = (r: number, c1: number, c2: number) => {
        for (let c = c1; c <= c2; c++) {
          const x = cells[cellAddress(r, c)];
          if (x && (x.v !== undefined || x.f !== undefined || x.e !== undefined)) return true;
        }
        return false;
      };
      let grown = b;
      while (has(grown.r2 + 1, grown.c1, grown.c2) && grown.r2 < MAX_ROWS) grown = { ...grown, r2: grown.r2 + 1 };
      const headed = (col: number) => typeof cells[cellAddress(grown.r1, col)]?.v === "string" && cells[cellAddress(grown.r1, col)]!.v !== "";
      while (grown.c2 < MAX_COLS && headed(grown.c2 + 1) && !s.cells[cellAddress(grown.r1, grown.c2 + 1)]) grown = { ...grown, c2: grown.c2 + 1 };
      if (grown.r2 === b.r2 && grown.c2 === b.c2) continue;
      b = grown;
      try {
        const current = wb.sheets.find((x) => x.id === s.id)!.tables!.find((t) => t.id === table.id)!;
        push({ type: "update_table", sheet: s.id, table: { ...current, range: rangeAddress(b) } });
        // The new rows get the formulas of the calculated columns.
        const filled = fillCalculated(wb, s.id, entry.bounds.r2 + 1, b.r2);
        if (filled !== wb) {
          const before = wb.sheets.find((x) => x.id === s.id)!.cells;
          const after = filled.sheets.find((x) => x.id === s.id)!.cells;
          const added: Record<string, Cell | null> = {};
          for (const [k, v] of Object.entries(after)) if (before[k] !== v) added[k] = v;
          push({ type: "set_cells", sheet: s.id, cells: added });
        }
      } catch {
        // growing would overlap something or name a column twice: the entry stays outside the table
      }
    }
    let renamed = wb;
    for (const r of renames) renamed = renameColumnInFormulas(renamed, r.table, r.from, r.to);
    if (renamed !== wb) ops.push({ type: "restore", workbook: renamed });
    return ops;
  }

  /** Puts rows of values (or formulas, written as text starting with `=`) with the top left at `at`. */
  setValues(sheet: string, at: string, rows: readonly (readonly (string | number | boolean | null)[])[]): void {
    const origin = parseCell(at);
    if (!origin) throw new PliError("out_of_range", `"${at}" is not a cell address`);
    const inputs: Record<string, string | number | boolean | null> = {};
    rows.forEach((row, i) =>
      row.forEach((v, j) => {
        if (origin.row + i > MAX_ROWS || origin.col + j > MAX_COLS) throw new PliError("out_of_range", "That doesn't fit on the sheet");
        inputs[cellAddress(origin.row + i, origin.col + j)] = v;
      }),
    );
    this.setCells(sheet, inputs, { validate: false });
  }

  /** Empties cells: `contents` keeps formats and styles, `formats` keeps what is in the cells, `all` empties them. */
  clear(sheet: string, range: string, what: "all" | "contents" | "formats" = "all"): void {
    const s = this.sheet(sheet);
    const cells: Record<string, Cell | null> = {};
    for (const key of this.existing(s, this.bounds(range))) {
      const c = s.cells[key]!;
      if (what === "all") cells[key] = null;
      else if (what === "contents") {
        const kept: Cell = { ...(c.fmt ? { fmt: c.fmt } : {}), ...(c.s ? { s: c.s } : {}), ...(c.control ? { control: c.control } : {}), ...(c.note !== undefined ? { note: c.note, ...noteExtras(c) } : {}), ...(c.thread !== undefined ? { thread: c.thread } : {}) };
        if (c.control?.type === "checkbox") kept.v = checkboxValues(c.control).unchecked;
        cells[key] = cleanCell(kept);
      }
      else {
        const rest: Cell = {};
        if (c.v !== undefined) rest.v = c.v;
        if (c.e !== undefined) rest.e = c.e;
        if (c.f !== undefined) rest.f = c.f;
        if (c.link) rest.link = c.link;
        if (c.picture) rest.picture = c.picture;
        if (c.note !== undefined) Object.assign(rest, { note: c.note }, noteExtras(c));
        if (c.thread !== undefined) rest.thread = c.thread;
        cells[key] = cleanCell(rest);
      }
    }
    if (Object.keys(cells).length) this.commit([{ type: "set_cells", sheet: s.id, cells }]);
  }

  /** Sets the number format of every cell in a range (`null` for General). */
  setFormat(sheet: string, range: string, format: string | null): void {
    this.patch(sheet, range, (c) => {
      const next = { ...c };
      if (format === null || format === "General") delete next.fmt;
      else next.fmt = format;
      return next;
    });
  }

  /** Changes the style of every cell in a range; a field set to `null` is taken off. */
  setStyle(sheet: string, range: string, style: { [K in keyof CellStyle]?: CellStyle[K] | null }): void {
    if (!this.#bypass && this.sheet(sheet).protection && ("locked" in style || "hideFormula" in style)) throw new ProtectionError("Whether cells are locked, or their formulas hidden, can't be changed while the sheet is protected. Unprotect the sheet first (you may be asked for a password).");
    const s0 = this.sheet(sheet);
    // Hiding formulas on whole columns, whole rows or the whole sheet is the same.
    if (typeof style.hideFormula === "boolean") {
      const b = this.bounds(range);
      if ((b.r1 === 1 && b.r2 === MAX_ROWS) || (b.c1 === 1 && b.c2 === MAX_COLS)) {
        const { hideFormula, ...others } = style;
        this.setFormulaHidden(sheet, range, hideFormula);
        if (Object.keys(others).length) this.setStyle(sheet, range, others);
        return;
      }
    }
    // Locking whole columns, whole rows or the whole sheet locks what they will have, not just the cells there are.
    if (typeof style.locked === "boolean") {
      const b = this.bounds(range);
      if ((b.r1 === 1 && b.r2 === MAX_ROWS) || (b.c1 === 1 && b.c2 === MAX_COLS)) {
        const { locked, ...others } = style;
        this.setLocked(sheet, range, locked);
        if (Object.keys(others).length) this.setStyle(sheet, range, others);
        return;
      }
    }
    this.patch(sheet, range, (c, key) => {
      const s: Record<string, unknown> = { ...c.s };
      for (const [k, v] of Object.entries(style)) {
        if (v === null) delete s[k];
        else if (v !== undefined) s[k] = v;
      }
      // Locked and showing the formula are what a cell is without saying, so they aren't kept. A cell in an unlocked row, column
      // or sheet does say when it is locked.
      const at = parseCell(key)!;
      if (s["locked"] === (defaultLock(s0, at.row, at.col) ? true : false)) delete s["locked"];
      if (s["hideFormula"] === defaultHide(s0, at.row, at.col)) delete s["hideFormula"];
      const next = { ...c };
      if (Object.keys(s).length) next.s = s as CellStyle;
      else delete next.s;
      return next;
    });
  }

  /**
   * Locks or unlocks the cells of a range. Whole columns, whole rows and the whole sheet (`A:C`, `2:4`, `A1:XFD1048576`) lock what
   * they will have, as Excel does: cells that are made later in them take the lock too. Locking does nothing until the sheet is
   * protected, and can't be changed after.
   */
  setLocked(sheet: string, range: string, locked: boolean): void {
    const s = this.sheet(sheet);
    if (!this.#bypass && s.protection) throw new ProtectionError("Whether cells are locked, or their formulas hidden, can't be changed while the sheet is protected. Unprotect the sheet first (you may be asked for a password).");
    const change = lockChange(s, this.bounds(range), locked);
    if (!change) return;
    const ops: SheetOp[] = [];
    if (change.unlocked !== undefined || Object.keys(change.columns).length || Object.keys(change.rows).length) {
      ops.push({ type: "set_locks", sheet: s.id, ...(change.unlocked !== undefined ? { unlocked: change.unlocked ? true : null } : {}), ...(Object.keys(change.columns).length ? { columns: change.columns } : {}), ...(Object.keys(change.rows).length ? { rows: change.rows } : {}) });
    }
    if (Object.keys(change.cells).length) ops.push({ type: "set_cells", sheet: s.id, cells: change.cells });
    this.commit(ops);
  }

  /**
   * Hides or shows the formulas of the cells of a range once the sheet is protected (Excel's Format Cells > Protection > Hidden).
   * Whole columns, whole rows and the whole sheet (`A:C`, `2:4`, `A1:XFD1048576`) set what they will have, as Excel does: cells
   * that are made later in them hide their formulas too. Can't be changed after the sheet is protected.
   */
  setFormulaHidden(sheet: string, range: string, hidden: boolean): void {
    const s = this.sheet(sheet);
    if (!this.#bypass && s.protection) throw new ProtectionError("Whether cells are locked, or their formulas hidden, can't be changed while the sheet is protected. Unprotect the sheet first (you may be asked for a password).");
    const change = hideChange(s, this.bounds(range), hidden);
    if (!change) return;
    const ops: SheetOp[] = [];
    if (change.hidden !== undefined || Object.keys(change.columns).length || Object.keys(change.rows).length) {
      ops.push({ type: "set_hides", sheet: s.id, ...(change.hidden !== undefined ? { hidden: change.hidden ? true : null } : {}), ...(Object.keys(change.columns).length ? { columns: change.columns } : {}), ...(Object.keys(change.rows).length ? { rows: change.rows } : {}) });
    }
    if (Object.keys(change.cells).length) ops.push({ type: "set_cells", sheet: s.id, cells: change.cells });
    this.commit(ops);
  }

  /**
   * Copies cells to where `to` (the top left) says. Formulas move as when pasted in Excel: relative references shift
   * by the distance, `$` ones stay. With `cut`, the source is emptied after.
   */
  copy(from: { sheet: string; range: string }, to: { sheet: string; at: string }, options: { cut?: boolean } & PasteOptions = {}): void {
    const src = this.sheet(from.sheet);
    const dst = this.sheet(to.sheet);
    const b = this.bounds(from.range);
    const origin = parseCell(to.at);
    if (!origin) throw new PliError("out_of_range", `"${to.at}" is not a cell address`);
    if (options.transpose) {
      // Paste special > Transpose: rows become columns, so nothing is a plain shift.
      if (origin.row + (b.c2 - b.c1) > MAX_ROWS || origin.col + (b.r2 - b.r1) > MAX_COLS) throw new PliError("out_of_range", "That doesn't fit on the sheet");
      const plan = planTransposedCopy({ src, dst, b, origin, cut: !!options.cut, content: options.content ?? "all", contentOf: (key, cell) => this.#contentOf(src, key, cell, options.content ?? "all") });
      this.commit(plan.ops, { vet: { action: options.cut ? "move" : "copy", sheet: dst.id, bounds: plan.target, ...(options.cut ? { whole: true } : {}) } });
      return;
    }
    const dRow = origin.row - b.r1;
    const dCol = origin.col - b.c1;
    if (b.r2 + dRow > MAX_ROWS || b.c2 + dCol > MAX_COLS) throw new PliError("out_of_range", "That doesn't fit on the sheet");
    const content = options.cut ? "all" : options.content ?? "all";
    const writes: Record<string, Cell | null> = {};
    const clears: Record<string, Cell | null> = {};
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        const key = cellAddress(r, c);
        const cell = src.cells[key];
        const target = cellAddress(r + dRow, c + dCol);
        if (cell) writes[target] = cell.f !== undefined && !options.cut ? { ...cell, f: shiftFormula(cell.f, dRow, dCol) } : cell;
        else writes[target] = null;
        if (options.cut && cell) clears[key] = null;
        if (content !== "all" && !options.cut) writes[target] = blendCell(content, dst.cells[target], this.#contentOf(src, key, writes[target] ?? null, content));
      }
    const ops: SheetOp[] = [];
    if (options.cut && src.id === dst.id) ops.push({ type: "set_cells", sheet: src.id, cells: { ...clears, ...writes } });
    else {
      if (options.cut) ops.push({ type: "set_cells", sheet: src.id, cells: clears });
      ops.push({ type: "set_cells", sheet: dst.id, cells: writes });
    }
    if (content === "all" || content === "formats") ops.push(...this.relocateMerges(src, dst, b, dRow, dCol, !!options.cut), ...this.relocateFormats(src, dst, b, dRow, dCol, !!options.cut));
    if (options.widths === true) ops.push(...this.#sizeOps(src, dst, b, dRow, dCol));
    if (content === "all" && !options.cut && !options.asRange) ops.push(...this.#copyTables(src, dst, b, dRow, dCol, writes));
    this.commit(ops, { vet: { action: options.cut ? "move" : "copy", sheet: dst.id, bounds: { r1: b.r1 + dRow, c1: b.c1 + dCol, r2: b.r2 + dRow, c2: b.c2 + dCol }, from: { sheet: src.id, dRow, dCol }, ...(options.cut ? { whole: true } : {}) } });
  }

  /** What a copied cell brings to a paste of its values or its formulas: the cell, or the value its formula gives. */
  #contentOf(src: Sheet, key: string, shifted: Cell | null, content: PasteContent): Cell | null {
    if (!shifted || content === "formats") return shifted;
    if (content === "formulas" || shifted.f === undefined) return shifted;
    const v = this.calculator.value(src.id, key);
    const { f: _f, e: _e, v: _v, ...rest } = shifted;
    if (isError(v)) return { ...rest, e: v.error };
    return v === null ? (Object.keys(rest).length ? rest : null) : { ...rest, v };
  }

  /** The widths of the columns and the heights of the rows of `b` on the cells' new sheet. */
  #sizeOps(src: Sheet, dst: Sheet, b: Bounds, dRow: number, dCol: number): SheetOp[] {
    const ops: SheetOp[] = [];
    for (let c = b.c1; c <= b.c2; c++) ops.push({ type: "set_size", sheet: dst.id, axis: "col", index: c + dCol, size: src.columns?.[colName(c)]?.size ?? null });
    for (let r = b.r1; r <= b.r2; r++) ops.push({ type: "set_size", sheet: dst.id, axis: "row", index: r + dRow, size: src.rows?.[String(r)]?.size ?? null });
    return ops;
  }

  /**
   * The tables that lie wholly inside the copied cells are copied as tables, as in Excel: each copy gets a name of its own
   * (`Table1` gives `Table2`), keeps the style, calculated columns, totals row and header, and shows all its rows. Formulas
   * inside it that named the original now name the copy. A copy that would land on another table is left as cells.
   */
  #copyTables(src: Sheet, dst: Sheet, b: Bounds, dRow: number, dCol: number, writes: Record<string, Cell | null>): SheetOp[] {
    const ops: SheetOp[] = [];
    const taken: string[] = [];
    const made: Table[] = [];
    const probe: Sheet = { ...dst, cells: { ...dst.cells } };
    for (const [k, v] of Object.entries(writes)) {
      if (v) probe.cells[k] = v;
      else delete probe.cells[k];
    }
    for (const t of src.tables ?? []) {
      const tb = this.bounds(t.range);
      if (tb.r1 < b.r1 || tb.r2 > b.r2 || tb.c1 < b.c1 || tb.c2 > b.c2) continue;
      const range = rangeAddress({ r1: tb.r1 + dRow, c1: tb.c1 + dCol, r2: tb.r2 + dRow, c2: tb.c2 + dCol });
      const name = copyTableName(this.state, t.name, taken);
      const copy = copiedTable(t, createId("table_"), name, range);
      if (copy.calculated) copy.calculated = Object.fromEntries(Object.entries(copy.calculated).map(([k, f]) => [k, renameTableIn(f, t.name, name)]));
      const withCopies: Sheet = { ...probe, tables: [...(dst.tables ?? []), ...made] };
      try {
        checkTable(this.state, withCopies, copy);
      } catch (e) {
        if (e instanceof PliError) continue;
        throw e;
      }
      // Formulas in the copy that named the original name the copy.
      for (let r = tb.r1; r <= tb.r2; r++)
        for (let c = tb.c1; c <= tb.c2; c++) {
          const key = cellAddress(r + dRow, c + dCol);
          const w = writes[key];
          if (w?.f !== undefined) {
            const f = renameTableIn(w.f, t.name, name);
            if (f !== w.f) writes[key] = { ...w, f };
          }
        }
      taken.push(name);
      made.push(copy);
      ops.push({ type: "add_table", sheet: dst.id, table: copy });
    }
    return ops;
  }

  /** The workbook with the tables that lie wholly inside `b` moved along with the cells (to another sheet too). One that would land on another table stays. */
  #moveTables(wb: Workbook, srcId: string, dstId: string, b: Bounds, dRow: number, dCol: number): Workbook {
    const src = wb.sheets.find((x) => x.id === srcId)!;
    const moving: Table[] = [];
    for (const t of src.tables ?? []) {
      const tb = this.bounds(t.range);
      if (tb.r1 < b.r1 || tb.r2 > b.r2 || tb.c1 < b.c1 || tb.c2 > b.c2) continue;
      const target = { r1: tb.r1 + dRow, c1: tb.c1 + dCol, r2: tb.r2 + dRow, c2: tb.c2 + dCol };
      const dst = wb.sheets.find((x) => x.id === dstId)!;
      if ((dst.tables ?? []).some((o) => o.id !== t.id && !moving.some((m) => m.id === o.id) && overlaps(this.bounds(o.range), target))) continue;
      moving.push({ ...t, range: rangeAddress(target) });
    }
    if (!moving.length) return wb;
    const ids = new Set(moving.map((t) => t.id));
    return {
      ...wb,
      sheets: wb.sheets.map((x) => {
        let tables = x.tables;
        if (x.id === srcId) tables = (tables ?? []).filter((t) => !ids.has(t.id));
        if (x.id === dstId) tables = [...(tables ?? []), ...moving];
        if (tables === x.tables) return x;
        const next: Sheet = { ...x, tables };
        if (!tables?.length) delete next.tables;
        return next;
      }),
    };
  }

  /**
   * Conditional formats and data validation go with the cells they cover, as formats do in Excel: what covered the cells
   * copied (or moved, with `cut`) covers where they land, replacing what was there. A rule's formula is shifted so it reads
   * for the new cells as it did for the old.
   */
  private relocateFormats(src: Sheet, dst: Sheet, b: Bounds, dRow: number, dCol: number, cut: boolean): SheetOp[] {
    if (!src.conditional?.length && !src.validations?.length && !dst.conditional?.length && !dst.validations?.length) return [];
    if (dRow === 0 && dCol === 0 && src.id === dst.id) return [];
    const target: Bounds = { r1: b.r1 + dRow, c1: b.c1 + dCol, r2: b.r2 + dRow, c2: b.c2 + dCol };
    const ops: SheetOp[] = [];
    type Kind = "rule" | "validation";
    const handle = (kind: Kind) => {
      const list = (sheet: Sheet) => (kind === "rule" ? sheet.conditional : sheet.validations) as { id: string; ranges: string[] }[] | undefined;
      // What each rule loses: the part under the cells pasted over, and (for a move) the part the cells left.
      const trims = new Map<string, { sheet: Sheet; cutters: Bounds[] }>();
      const trim = (sheet: Sheet, id: string, cutter: Bounds) => {
        const key = `${sheet.id}|${id}`;
        const t = trims.get(key) ?? { sheet, cutters: [] };
        t.cutters.push(cutter);
        trims.set(key, t);
      };
      const copies: { rule: { id: string; ranges: string[] }; ranges: string[]; origin: { row: number; col: number }; first: { row: number; col: number } }[] = [];
      for (const rule of list(src) ?? []) {
        const pieces: Bounds[] = [];
        for (const r of rule.ranges) {
          const x = this.bounds(r);
          const i: Bounds = { r1: Math.max(x.r1, b.r1), c1: Math.max(x.c1, b.c1), r2: Math.min(x.r2, b.r2), c2: Math.min(x.c2, b.c2) };
          if (i.r1 <= i.r2 && i.c1 <= i.c2) pieces.push(i);
        }
        if (!pieces.length) continue;
        const all = this.boundsOf(rule.ranges);
        copies.push({
          rule,
          ranges: pieces.map((p) => rangeAddress({ r1: p.r1 + dRow, c1: p.c1 + dCol, r2: p.r2 + dRow, c2: p.c2 + dCol })),
          origin: { row: Math.min(...all.map((x) => x.r1)), col: Math.min(...all.map((x) => x.c1)) },
          first: { row: Math.min(...pieces.map((p) => p.r1)) + dRow, col: Math.min(...pieces.map((p) => p.c1)) + dCol },
        });
        if (cut) trim(src, rule.id, b);
      }
      for (const rule of list(dst) ?? []) if (this.boundsOf(rule.ranges).some((x) => x.r1 <= target.r2 && target.r1 <= x.r2 && x.c1 <= target.c2 && target.c1 <= x.c2)) trim(dst, rule.id, target);
      for (const [key, { sheet, cutters }] of trims) {
        const id = key.slice(key.indexOf("|") + 1);
        const rule = list(sheet)!.find((r) => r.id === id)!;
        let rects = this.boundsOf(rule.ranges);
        for (const c of cutters) rects = rects.flatMap((r) => subtractBounds(r, c));
        const kept = rects.map(rangeAddress);
        if (kept.length === rule.ranges.length && kept.every((k, i) => k === rule.ranges[i])) continue;
        if (kind === "rule") ops.push(kept.length ? { type: "update_rule", sheet: sheet.id, rule: { ...rule, ranges: kept } as ConditionalRule } : { type: "delete_rule", sheet: sheet.id, id });
        else ops.push(kept.length ? { type: "update_validation", sheet: sheet.id, validation: { ...rule, ranges: kept } as Validation } : { type: "delete_validation", sheet: sheet.id, id });
      }
      for (const c of copies) {
        const n = c.first;
        const shift = (f: string) => {
          try {
            return shiftFormula(f, n.row - c.origin.row, n.col - c.origin.col);
          } catch {
            return f;
          }
        };
        if (kind === "rule") {
          // A copy of a pivot table's rule is an ordinary rule: it doesn't follow the pivot table.
          const { pivot: _pivot, ...plain } = c.rule as ConditionalRule;
          const copy = mapRuleFormulas({ ...plain, id: createId("rule_"), ranges: c.ranges } as ConditionalRule, shift);
          ops.push({ type: "add_rule", sheet: dst.id, rule: copy });
        } else {
          const copy = mapValidationFormulas({ ...(c.rule as Validation), id: createId("valid_"), ranges: c.ranges } as Validation, shift);
          ops.push({ type: "add_validation", sheet: dst.id, validation: copy });
        }
      }
    };
    handle("rule");
    handle("validation");
    return ops;
  }

  private boundsOf(ranges: readonly string[]): Bounds[] {
    return ranges.map((r) => this.bounds(r));
  }

  /** The merged ranges inside `b` follow the cells to where they are copied (or moved, with `cut`), and the ones in the way are unmerged. */
  private relocateMerges(src: Sheet, dst: Sheet, b: Bounds, dRow: number, dCol: number, cut: boolean): SheetOp[] {
    const moving = mergedRanges(src).filter((m) => within(m, b));
    const target: Bounds = { r1: b.r1 + dRow, c1: b.c1 + dCol, r2: b.r2 + dRow, c2: b.c2 + dCol };
    const refusal = mergeClash(src, dst, b, target, cut);
    if (refusal) throw new PliError("invalid_operation", refusal);
    const ops: SheetOp[] = [];
    const dropped = new Set<string>();
    const drop = (sheet: Sheet, m: Bounds) => {
      const key = `${sheet.id}|${rangeAddress(m)}`;
      if (dropped.has(key)) return;
      dropped.add(key);
      ops.push({ type: "remove_merge", sheet: sheet.id, range: rangeAddress(m) });
    };
    if (cut) for (const m of moving) drop(src, m);
    for (const m of mergedRanges(dst)) if (overlaps(m, target)) drop(dst, m);
    for (const m of moving) ops.push({ type: "add_merge", sheet: dst.id, range: rangeAddress({ r1: m.r1 + dRow, c1: m.c1 + dCol, r2: m.r2 + dRow, c2: m.c2 + dCol }) });
    return ops;
  }

  /**
   * Moves cells (cut and paste, or dragging them) to where `to` (the top left) says, replacing what is there. Unlike a
   * copy, formulas keep pointing at what they pointed at, and formulas anywhere that pointed at the moved cells follow
   * them. One undo step.
   */
  move(from: { sheet: string; range: string }, to: { sheet: string; at: string }): void {
    const src = this.sheet(from.sheet);
    const dst = this.sheet(to.sheet);
    const b = this.bounds(from.range);
    const origin = parseCell(to.at);
    if (!origin) throw new PliError("out_of_range", `"${to.at}" is not a cell address`);
    const dRow = origin.row - b.r1;
    this.#requireEditable(src, b);
    this.#requireEditable(dst, { r1: origin.row, c1: origin.col, r2: origin.row + (b.r2 - b.r1), c2: origin.col + (b.c2 - b.c1) });
    const dCol = origin.col - b.c1;
    if (b.r2 + dRow > MAX_ROWS || b.c2 + dCol > MAX_COLS || b.r1 + dRow < 1 || b.c1 + dCol < 1) throw new PliError("out_of_range", "That doesn't fit on the sheet");
    if (dRow === 0 && dCol === 0 && src.id === dst.id) return;
    const moving: [string, Cell][] = [];
    const srcCells = { ...src.cells };
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        const k = cellAddress(r, c);
        const cell = srcCells[k];
        if (cell) {
          let arrives = cell;
          if (dst.protection) {
            // On a protected sheet a cell that is moved in takes on the lock of the cell it lands on, and one that leaves keeps its own.
            const { locked: _l, hideFormula: _h, ...rest } = cell.s ?? {};
            const landing = lockAt(dst, r + dRow, c + dCol, dst.cells[cellAddress(r + dRow, c + dCol)]);
            const hides = hideAt(dst, r + dRow, c + dCol, dst.cells[cellAddress(r + dRow, c + dCol)]);
            const style: CellStyle = { ...rest, ...(landing !== defaultLock(dst, r + dRow, c + dCol) ? { locked: landing } : {}), ...(hides !== defaultHide(dst, r + dRow, c + dCol) ? { hideFormula: hides } : {}) };
            const { s: _s, ...others } = cell;
            arrives = Object.keys(style).length ? { ...others, s: style } : others;
          }
          moving.push([cellAddress(r + dRow, c + dCol), arrives]);
          delete srcCells[k];
          if (src.protection && !lockAt(src, r, c, cell)) srcCells[k] = { s: { ...(defaultLock(src, r, c) ? { locked: false } : {}), ...(hideAt(src, r, c, cell) !== defaultHide(src, r, c) ? { hideFormula: hideAt(src, r, c, cell) } : {}) } };
        }
      }
    const dstCells = src.id === dst.id ? srcCells : { ...dst.cells };
    for (let r = b.r1 + dRow; r <= b.r2 + dRow; r++) for (let c = b.c1 + dCol; c <= b.c2 + dCol; c++) delete dstCells[cellAddress(r, c)];
    for (const [k, cell] of moving) dstCells[k] = cell;
    let wb: Workbook = { ...this.state, sheets: this.state.sheets.map((s) => (s.id === src.id && s.id === dst.id ? { ...s, cells: dstCells } : s.id === src.id ? { ...s, cells: srcCells } : s.id === dst.id ? { ...s, cells: dstCells } : s)) };
    const move = { sheet: src.name, bounds: b, toSheet: dst.name, dRow, dCol };
    wb = mapFormulas(wb, (f, home) => {
      try {
        return moveReferences(f, home, move);
      } catch (e) {
        if (e instanceof FormulaSyntaxError) return f;
        throw e;
      }
    });
    wb = this.#moveTables(wb, src.id, dst.id, b, dRow, dCol);
    this.commit([{ type: "restore", workbook: wb }, ...this.relocateMerges(src, dst, b, dRow, dCol, true), ...this.relocateFormats(src, dst, b, dRow, dCol, true)], { vet: { action: "move", whole: true, sheet: dst.id, bounds: { r1: b.r1 + dRow, c1: b.c1 + dCol, r2: b.r2 + dRow, c2: b.c2 + dCol }, from: { sheet: src.id, dRow, dCol } } });
  }

  /**
   * Why dragging cells from `from` to `to` (the top left) would be refused, in words, or null when it can go ahead: the
   * place is off the sheet or locked, only part of a merged range is being taken, or the place holds merged cells of another
   * shape. `copy` is for a copy (the cells stay where they are); without it they are moved. The grid asks before it draws a
   * drop target, and `move` and `copy` refuse for the same reasons.
   */
  relocateProblem(from: { sheet: string; range: string }, to: { sheet: string; at: string }, options: { copy?: boolean } = {}): string | null {
    const src = this.sheet(from.sheet);
    const dst = this.sheet(to.sheet);
    const b = this.bounds(from.range);
    const origin = parseCell(to.at);
    if (!origin) return `"${to.at}" is not a cell address`;
    const target: Bounds = { r1: origin.row, c1: origin.col, r2: origin.row + (b.r2 - b.r1), c2: origin.col + (b.c2 - b.c1) };
    if (target.r2 > MAX_ROWS || target.c2 > MAX_COLS || target.r1 < 1 || target.c1 < 1) return "That doesn't fit on the sheet";
    try {
      if (!options.copy) this.#requireEditable(src, b);
      this.#requireEditable(dst, target);
    } catch (e) {
      return (e as Error).message;
    }
    return mergeClash(src, dst, b, target, !options.copy);
  }

  /** Why dragging the fill handle from `source` to `target` (a range that contains it) would be refused, or null: see `relocateProblem`. */
  fillProblem(sheet: string, source: string, target: string): string | null {
    const s = this.sheet(sheet);
    const a = this.bounds(source);
    const t = this.bounds(target);
    const down = t.r2 - a.r2;
    const up = a.r1 - t.r1;
    const right = t.c2 - a.c2;
    const left = a.c1 - t.c1;
    const vertical = Math.max(down, up) >= Math.max(right, left);
    const filled: Bounds = vertical ? (down >= up ? { ...a, r1: a.r2 + 1, r2: t.r2 } : { ...a, r1: t.r1, r2: a.r1 - 1 }) : right >= left ? { ...a, c1: a.c2 + 1, c2: t.c2 } : { ...a, c1: t.c1, c2: a.c1 - 1 };
    try {
      this.#requireEditable(s, filled);
    } catch (e) {
      return (e as Error).message;
    }
    return fillClash(s, a, filled);
  }

  /** Fills a range by repeating the cells at its top (`down`) or left (`right`) edge, with formulas shifted. */
  fill(sheet: string, range: string, direction: "down" | "right"): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const cells: Record<string, Cell | null> = {};
    const pairs: FillPair[] = [];
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        if ((direction === "down" && r === b.r1) || (direction === "right" && c === b.c1)) continue;
        const sr = direction === "down" ? b.r1 : r;
        const sc = direction === "right" ? b.c1 : c;
        const cell = s.cells[cellAddress(sr, sc)];
        cells[cellAddress(r, c)] = cell ? (cell.f !== undefined ? { ...cell, f: shiftFormula(cell.f, r - sr, c - sc) } : cell) : null;
        pairs.push([r, c, sr, sc]);
      }
    // The cells filled get the validation of the cells they copy, as in Excel.
    const filled: Bounds = direction === "down" ? { ...b, r1: b.r1 + 1 } : { ...b, c1: b.c1 + 1 };
    if (Object.keys(cells).length) this.commit([{ type: "set_cells", sheet: s.id, cells }, ...fillValidationOps(s, filled, pairs)], { vet: { action: "fill", sheet: s.id, bounds: filled } });
  }

  /** A range as tab-separated text, as it shows, for the clipboard. */
  toText(sheet: string, range: string): string {
    return rangeToTsv(this.calculator, this.sheet(sheet).id, this.bounds(range));
  }

  /** A range as an HTML table, for the clipboard. */
  toHtml(sheet: string, range: string): string {
    const s = this.sheet(sheet);
    return rangeToHtml(this.calculator, s.id, this.bounds(range), { effect: (r, c) => this.#formats.effect(s, r, c), table: (r, c) => tableLook(s, r, c, this.state.tableStyles, this.state.themeColors), ...(s.conditional?.length ? { rules: s.conditional } : {}) });
  }

  /**
   * Pastes an HTML table (what Excel, Google Sheets and web pages put on the clipboard) with its top left at `at`: the text
   * is read as if typed (`12%`, `$5`, dates), and each cell comes with the look it had (fill, font, alignment, borders), and
   * merged cells stay merged. The cells it covers are replaced. Returns the range filled, or null if the HTML had no table.
   */
  pasteHtml(sheet: string, at: string, html: string, options: PasteOptions = {}): string | null {
    const origin = parseCell(at);
    if (!origin) throw new PliError("out_of_range", `"${at}" is not a cell address`);
    const table = parseHtmlTable(html);
    if (!table) return null;
    const s = this.sheet(sheet);
    const plan = planHtmlPaste(this.state, s, origin, table, options);
    if (!plan) return null;
    const ops: SheetOp[] = [];
    for (const m of plan.unmerge) ops.push({ type: "remove_merge", sheet: s.id, range: rangeAddress(m) });
    ops.unshift(...this.#withTables(s, plan.cells));
    for (const m of plan.merges) ops.push({ type: "add_merge", sheet: s.id, range: rangeAddress(m) });
    ops.push(...plan.after);
    this.commit(ops, { vet: { action: "paste", sheet: s.id, bounds: plan.target } });
    return rangeAddress(plan.target);
  }

  /**
   * Pastes tab-separated text (what spreadsheets copy) with its top left at `at`. Each field is read as if typed, so
   * `=A1+1` is a formula and `12%` a percentage. Returns the range filled, or null if the text was empty.
   */
  pasteText(sheet: string, at: string, text: string, options: { transpose?: boolean } = {}): string | null {
    const origin = parseCell(at);
    if (!origin) throw new PliError("out_of_range", `"${at}" is not a cell address`);
    let rows = parseTsv(text.replace(/\r?\n$/, ""));
    if (rows.length === 0 || (rows.length === 1 && rows[0]!.length === 1 && rows[0]![0] === "")) return null;
    if (options.transpose) {
      const wide = Math.max(...rows.map((r) => r.length));
      rows = Array.from({ length: wide }, (_, j) => rows.map((r) => r[j] ?? ""));
    }
    const width = Math.max(...rows.map((r) => r.length));
    if (origin.row + rows.length - 1 > MAX_ROWS || origin.col + width - 1 > MAX_COLS) throw new PliError("out_of_range", "That doesn't fit on the sheet");
    const area: Bounds = { r1: origin.row, c1: origin.col, r2: origin.row + rows.length - 1, c2: origin.col + width - 1 };
    const inputs: Record<string, string> = {};
    rows.forEach((row, i) => {
      for (let j = 0; j < width; j++) inputs[cellAddress(origin.row + i, origin.col + j)] = row[j] ?? "";
    });
    this.setCells(sheet, inputs, { validate: false, vet: { action: "paste", sheet: this.sheet(sheet).id, bounds: area } });
    return rangeAddress(area);
  }

  /**
   * Drags the fill handle: extends `source` (a range) to `target` (a range that contains it) in one direction. A column
   * of two or more numbers continues its steps (1, 2 gives 3, 4…), a lone text ending in a number counts up (Item 1,
   * Item 2…), and anything else repeats, with formulas shifted as in a paste.
   */
  autofill(sheet: string, source: string, target: string): void {
    const s = this.sheet(sheet);
    const a = this.bounds(source);
    const t = this.bounds(target);
    const down = t.r2 - a.r2;
    const up = a.r1 - t.r1;
    const right = t.c2 - a.c2;
    const left = a.c1 - t.c1;
    const vertical = Math.max(down, up) >= Math.max(right, left);
    const writes: Record<string, Cell | null> = {};
    const pairs: FillPair[] = [];
    const lines = vertical ? a.c2 - a.c1 + 1 : a.r2 - a.r1 + 1;
    const length = vertical ? a.r2 - a.r1 + 1 : a.c2 - a.c1 + 1;
    const from = vertical ? (down >= up ? length : -(up)) : right >= left ? length : -left;
    const to = vertical ? (down >= up ? length + down - 1 : -1) : right >= left ? length + right - 1 : -1;
    if ((vertical ? Math.max(down, up) : Math.max(right, left)) <= 0) return;
    // Merged cells in the source are repeated with it (and fill as a copy, not a series); a clash with other merged cells is refused.
    const filled: Bounds = vertical ? (down >= up ? { ...a, r1: a.r2 + 1, r2: t.r2 } : { ...a, r1: t.r1, r2: a.r1 - 1 }) : right >= left ? { ...a, c1: a.c2 + 1, c2: t.c2 } : { ...a, c1: t.c1, c2: a.c1 - 1 };
    const clash = fillClash(s, a, filled);
    if (clash) throw new PliError("invalid_operation", clash);
    const merged = mergedRanges(s).some((m) => within(m, a));
    for (let line = 0; line < lines; line++) {
      const seq: (Cell | undefined)[] = [];
      for (let i = 0; i < length; i++) seq.push(s.cells[vertical ? cellAddress(a.r1 + i, a.c1 + line) : cellAddress(a.r1 + line, a.c1 + i)]);
      const numbers = seq.every((c) => c && c.f === undefined && typeof c.v === "number") ? (seq.map((c) => c!.v) as number[]) : null;
      const step = !merged && numbers && numbers.length >= 2 ? (numbers[numbers.length - 1]! - numbers[0]!) / (numbers.length - 1) : null;
      const text = !merged && length === 1 && typeof seq[0]?.v === "string" ? /^(.*?)(\d+)$/.exec(seq[0].v) : null;
      for (let k = from; k <= to; k++) {
        const idx = ((k % length) + length) % length;
        const src = seq[idx];
        const at = vertical ? cellAddress(a.r1 + k, a.c1 + line) : cellAddress(a.r1 + line, a.c1 + k);
        pairs.push(vertical ? [a.r1 + k, a.c1 + line, a.r1 + idx, a.c1 + line] : [a.r1 + line, a.c1 + k, a.r1 + line, a.c1 + idx]);
        if (!src) writes[at] = null;
        else if (step !== null && numbers) writes[at] = { ...src, v: Number((numbers[0]! + step * k).toPrecision(15)) };
        else if (text) writes[at] = { ...src, v: text[1]! + String(Number(text[2]) + k).padStart(text[2]!.length, "0") };
        else if (src.f !== undefined) writes[at] = { ...src, f: shiftFormula(src.f, vertical ? k - idx : 0, vertical ? 0 : k - idx) };
        else writes[at] = src;
      }
    }
    const copies = filledMerges(s, a, filled, vertical, length).map((m): SheetOp => ({ type: "add_merge", sheet: s.id, range: rangeAddress(m) }));
    this.commit([{ type: "set_cells", sheet: s.id, cells: writes }, ...copies, ...fillValidationOps(s, filled, pairs)], { vet: { action: "fill", sheet: s.id, bounds: filled } });
  }

  /**
   * Sorts the rows of a range by one column (1 is the range's first column). Empty cells go last. With `levels` the sort
   * has several: each names a column of the range (1 is the first) and orders by value, or puts a colour or an icon first
   * (see `SortLevel`; `descending` puts it last), and a row a level can't tell apart goes on to the next one.
   */
  sort(sheet: string, range: string, options: { by?: number; descending?: boolean; header?: boolean; levels?: RangeSortLevel[] } = {}): void {
    const s = this.sheet(sheet);
    this.#permit(s, "sort");
    const b = this.bounds(range);
    this.commit([{ type: "set_cells", sheet: s.id, cells: this.#sorted(s, b, options) }], { vet: { action: "sort", whole: true, samePlace: true, sheet: s.id, bounds: b } });
  }

  /** What the sort of one cell looks at: its value and the colours and icon it shows (conditional formats count). */
  #sortCell(s: Sheet, row: number, col: number): SortCell {
    const address = cellAddress(row, col);
    const own = s.cells[address]?.s;
    const effect = this.#formats.effect(s, row, col);
    return {
      value: this.calculator.value(s.id, address),
      fill: (effect?.style?.fill ?? effect?.scale ?? own?.fill ?? "none").toLowerCase(),
      font: (effect?.style?.color ?? own?.color ?? "auto").toLowerCase(),
      icon: effect?.icon ? { set: effect.icon.set, index: effect.icon.index } : null,
    };
  }

  /** The cells of a range with its rows in sorted order. */
  #sorted(s: Sheet, b: Bounds, options: { by?: number; descending?: boolean; header?: boolean; levels?: RangeSortLevel[] }): Record<string, Cell | null> {
    const levels = options.levels ?? [{ column: options.by ?? 1, ...(options.descending ? { descending: true as const } : {}) }];
    if (!levels.length) throw new PliError("invalid_operation", "A sort needs at least one level");
    const keys: SortKey[] = levels.map((l) => {
      const by = l.column - 1;
      if (!Number.isInteger(by) || by < 0 || b.c1 + by > b.c2) throw new PliError("out_of_range", "That column is outside the range");
      cleanSortLevel({ column: "x", ...(l.descending ? { descending: true as const } : {}), ...(l.by ? { by: l.by } : {}), ...(l.color !== undefined ? { color: l.color } : {}), ...(l.icon !== undefined ? { icon: l.icon } : {}) });
      return { col: b.c1 + by, descending: !!l.descending, by: l.by, color: l.by === "fontColor" || l.by === "cellColor" ? l.color!.toLowerCase() : undefined, icon: l.icon };
    });
    if (mergedRanges(s).some((m) => overlaps(m, b))) throw new PliError("invalid_operation", "Cells that are merged can't be sorted; unmerge them first");
    const first = options.header ? b.r1 + 1 : b.r1;
    const rows: { r: number; cells: Map<number, SortCell> }[] = [];
    for (let r = first; r <= b.r2; r++) {
      const cells = new Map<number, SortCell>();
      for (const k of keys) if (!cells.has(k.col)) cells.set(k.col, this.#sortCell(s, r, k.col));
      rows.push({ r, cells });
    }
    const sorted = [...rows].sort((x, y) => compareRows(keys, (k) => x.cells.get(k.col)!, (k) => y.cells.get(k.col)!) || x.r - y.r);
    const cells: Record<string, Cell | null> = {};
    sorted.forEach((row, i) => {
      const to = first + i;
      for (let c = b.c1; c <= b.c2; c++) {
        const cell = s.cells[cellAddress(row.r, c)];
        cells[cellAddress(to, c)] = cell ? (cell.f !== undefined ? { ...cell, f: shiftFormula(cell.f, to - row.r, 0) } : cell) : null;
      }
    });
    return cells;
  }

  // ---- checkboxes, dropdowns and badges ----

  /**
   * Makes the cells in a range a checkbox, dropdown or badge, or plain cells again with `null`. A checkbox starts
   * unticked unless the cell already holds what stands for ticked. Other values stay as they are.
   */
  setControl(sheet: string, range: string, control: CellControl | null): void {
    this.patch(sheet, range, (c) => {
      const next: Cell = { ...c };
      if (control === null) {
        const was = next.control;
        delete next.control;
        // A checkbox that is taken away leaves TRUE or FALSE behind.
        if (was?.type === "checkbox") next.v = next.v === checkboxValues(was).checked;
        return next;
      }
      next.control = control;
      if (control.type === "checkbox") {
        const { checked, unchecked } = checkboxValues(control);
        if (next.f === undefined && next.v !== checked) next.v = unchecked;
      }
      return next;
    });
  }

  /** Ticks or unticks a checkbox. */
  toggleCheckbox(sheet: string, address: string, to?: boolean): void {
    const cell = this.cell(sheet, address);
    if (cell?.control?.type !== "checkbox") throw new PliError("invalid_operation", "That cell isn't a checkbox");
    if (cell.f !== undefined) throw new PliError("invalid_operation", "A checkbox with a formula is ticked by its formula");
    const { checked, unchecked } = checkboxValues(cell.control);
    const ticked = cell.v === checked;
    this.setCells(sheet, { [address]: (to ?? !ticked) ? checked : unchecked });
  }

  /**
   * Chooses a value in a dropdown or badge cell. In a cell that allows several, the value is added or, if it is already
   * there, taken away; in any other it replaces what was there. `null` empties the cell.
   */
  pickChoice(sheet: string, address: string, value: string | null): void {
    const cell = this.cell(sheet, address);
    const control = cell?.control;
    if (!control) {
      // A cell under a list rule takes its choices from the rule: several of them when the rule allows it.
      const rule = this.validationAt(sheet, address);
      if (rule?.kind === "list") {
        if (value === null) return this.setCell(sheet, address, null);
        let next: string;
        if (rule.multiple) {
          const now = this.validationSelection(sheet, address);
          const at = now.findIndex((v) => v.toLowerCase() === value.toLowerCase());
          next = (at >= 0 ? now.filter((_, i) => i !== at) : [...now, value]).join(rule.separator ?? DEFAULT_SEPARATOR);
        } else next = value;
        return this.setCells(sheet, { [address]: next === "" ? null : rule.multiple ? "'" + next : next });
      }
    }
    if (!control || control.type === "checkbox") throw new PliError("invalid_operation", "That cell isn't a dropdown or badge");
    if (value === null) return this.setCell(sheet, address, null);
    let next: string;
    if (control.multiple) {
      const now = cellChoices(cell);
      next = joinChoices(now.includes(value) ? now.filter((v) => v !== value) : [...now, value], control.separator);
    } else next = value;
    // Typed as text, a number such as "2024" would become a number: choices are text.
    this.setCells(sheet, { [address]: next === "" ? null : "'" + next });
  }

  // ---- filters ----

  /** The block of data around a cell, as Ctrl+A would select: it grows over every neighbouring row and column that has something in it. */
  currentRegion(sheet: string, address: string): string {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const s = this.sheet(sheet);
    const has = (r: number, c: number) => {
      const cell = s.cells[cellAddress(r, c)];
      return !!cell && (cell.v !== undefined || cell.e !== undefined || cell.f !== undefined);
    };
    let b: Bounds = { r1: pos.row, c1: pos.col, r2: pos.row, c2: pos.col };
    for (let grown = true; grown; ) {
      grown = false;
      const test = (r1: number, c1: number, r2: number, c2: number) => {
        for (let r = Math.max(1, r1); r <= Math.min(MAX_ROWS, r2); r++) for (let c = Math.max(1, c1); c <= Math.min(MAX_COLS, c2); c++) if (has(r, c)) return true;
        return false;
      };
      if (b.r1 > 1 && test(b.r1 - 1, b.c1 - 1, b.r1 - 1, b.c2 + 1)) (b = { ...b, r1: b.r1 - 1 }), (grown = true);
      if (b.r2 < MAX_ROWS && test(b.r2 + 1, b.c1 - 1, b.r2 + 1, b.c2 + 1)) (b = { ...b, r2: b.r2 + 1 }), (grown = true);
      if (b.c1 > 1 && test(b.r1 - 1, b.c1 - 1, b.r2 + 1, b.c1 - 1)) (b = { ...b, c1: b.c1 - 1 }), (grown = true);
      if (b.c2 < MAX_COLS && test(b.r1 - 1, b.c2 + 1, b.r2 + 1, b.c2 + 1)) (b = { ...b, c2: b.c2 + 1 }), (grown = true);
    }
    return rangeAddress(b);
  }

  /** The text a cell shows, as a filter sees it: an empty cell is `""`. */
  private shownText(sheetId: string, row: number, col: number): string {
    return this.calculator.display(sheetId, cellAddress(row, col)).text;
  }

  /**
   * Puts a filter on a range (the first row is the headings), or takes it off with `null` and shows every row again.
   * Use `currentRegion` to find the table around a cell.
   */
  setFilter(sheet: string, range: string | null): void {
    const s = this.sheet(sheet);
    if (range === null) {
      if (!s.filter) return;
      const old = parseRange(s.filter.range)!;
      const ops: SheetOp[] = [{ type: "set_filter", sheet: s.id, filter: null }, ...this.unhide(s, old.r1 + 1, old.r2)];
      this.commit(ops);
      return;
    }
    const r = this.bounds(range);
    this.commit([{ type: "set_filter", sheet: s.id, filter: { range: rangeAddress(r) } }, ...(s.filter ? this.unhide(s, parseRange(s.filter.range)!.r1 + 1, parseRange(s.filter.range)!.r2) : [])]);
  }

  private unhide(s: Sheet, from: number, to: number): SheetOp[] {
    const ops: SheetOp[] = [];
    for (const k of Object.keys(s.rows ?? {})) {
      const n = Number(k);
      if (n >= from && n <= to && s.rows![k]!.hidden) ops.push({ type: "set_size", sheet: s.id, axis: "row", index: n, hidden: null });
    }
    return ops;
  }

  /**
   * Lets only these values through in a column of the sheet's filter (as the cells show them), or all of them with
   * `null`, and hides the rows that no longer match. One undo step.
   */
  filterColumn(sheet: string, column: number, allowed: readonly string[] | null): void {
    this.#setColumnFilter(sheet, column, allowed === null ? null : [...allowed]);
  }

  /**
   * Filters a column of the sheet's filter by a rule (a comparison or two, the top or bottom, above or below the average,
   * a period of dates, or a colour) instead of a list of values, or lets everything through again with `null`.
   */
  filterColumnRule(sheet: string, column: number, rule: FilterRule | null): void {
    this.#setColumnFilter(sheet, column, rule === null ? null : cleanFilterRule(rule));
  }

  #setColumnFilter(sheet: string, column: number, criterion: FilterCriterion | null): void {
    const s = this.sheet(sheet);
    if (!s.filter) throw new PliError("invalid_operation", "That sheet has no filter");
    const r = parseRange(s.filter.range)!;
    if (column < r.c1 || column > r.c2) throw new PliError("out_of_range", "That column is outside the filter's range");
    const columns = { ...s.filter.columns };
    if (criterion === null) delete columns[colName(column)];
    else columns[colName(column)] = criterion;
    this.commit(this.filterOps(s, { range: s.filter.range, ...(Object.keys(columns).length ? { columns } : {}) }));
  }

  /** Hides and shows the filter's rows again as its criteria say, for after the cells under it have changed. */
  reapplyFilter(sheet: string): void {
    const s = this.sheet(sheet);
    if (s.filter) this.commit(this.filterOps(s, s.filter));
  }

  // ---- filter views ----

  /** The saved filter views of a sheet (see `FilterView`), in the order they were made. */
  filterViews(sheet: string): readonly FilterView[] {
    return this.sheet(sheet).filterViews ?? [];
  }

  #viewOf(s: Sheet, id: string): FilterView {
    const v = s.filterViews?.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
    if (!v) throw new PliError("not_found", `There is no view "${id}" on ${s.name}`);
    return v;
  }

  #sortOf(s: Sheet, range: string, sort: { column: number; descending?: boolean } | null | undefined): FilterView["sort"] | undefined {
    if (!sort) return undefined;
    const r = parseRange(range)!;
    if (!Number.isInteger(sort.column) || sort.column < r.c1 || sort.column > r.c2) throw new PliError("out_of_range", "That column is outside the filter's range");
    return { column: colName(sort.column), ...(sort.descending ? { descending: true as const } : {}) };
  }

  /** What the filters and sorts of the sheet's tables are now, as a view keeps them (by table id); `undefined` when the sheet has no table with a header. */
  #viewTablesOf(s: Sheet): Record<string, FilterViewTable> | undefined {
    const headed = (s.tables ?? []).filter(hasHeader);
    if (!headed.length) return undefined;
    const out: Record<string, FilterViewTable> = {};
    for (const t of headed) {
      const names = tableColumns(s, parseRange(t.range)!, t);
      const filters = Object.fromEntries(Object.entries(t.filters ?? {}).filter(([n]) => names.includes(n)));
      const entry: FilterViewTable = {};
      if (Object.keys(filters).length) entry.filters = structuredClone(filters);
      if (t.sort && names.includes(t.sort.column)) entry.sort = { column: t.sort.column, ...(t.sort.descending ? { descending: true as const } : {}) };
      if (entry.filters || entry.sort) out[t.id] = entry;
    }
    return out;
  }

  /** Whether the sheet has a filter, or a table with a filter or sort, for a view to hold. */
  canSaveFilterView(sheet: string): boolean {
    const s = this.sheet(sheet);
    return !!s.filter || Object.keys(this.#viewTablesOf(s) ?? {}).length > 0;
  }

  /** The view as the sheet is now: its filter, and what its tables filter and are sorted by. */
  #viewNow(s: Sheet, base: FilterView, sort: FilterView["sort"] | undefined): FilterView {
    const tables = this.#viewTablesOf(s);
    if (!s.filter && !Object.keys(tables ?? {}).length) throw new PliError("invalid_operation", "That sheet has no filter or filtered table to save as a view");
    const next: FilterView = { ...base };
    delete next.range;
    delete next.columns;
    delete next.sort;
    delete next.tables;
    if (s.filter) {
      next.range = s.filter.range;
      if (s.filter.columns && Object.keys(s.filter.columns).length) next.columns = structuredClone(s.filter.columns);
      if (sort) next.sort = sort;
    }
    if (tables) next.tables = tables;
    return next;
  }

  /**
   * Saves the sheet's filter, and the filters and sorts of its tables, as a view called `name` and returns it. The view holds
   * the filter's range and what each column lets through, what each filtered table's columns let through and the column each
   * sorted table was sorted by (the cells themselves are never part of it), and, with `sort`, the column (as a number) the
   * data is sorted by when the view is made the sheet's own. Names are unique on a sheet, without regard to capitals. Undoable.
   */
  saveFilterView(sheet: string, name: string, options: { sort?: { column: number; descending?: boolean } } = {}): FilterView {
    const s = this.sheet(sheet);
    const clean = cleanViewName(name);
    if (options.sort && !s.filter) throw new PliError("invalid_operation", "A sort needs a filter on the sheet to say which columns it sorts");
    const sort = s.filter ? this.#sortOf(s, s.filter.range, options.sort) : undefined;
    const view = this.#viewNow(s, { id: createId("view_"), name: clean }, sort);
    this.commit([{ type: "set_filter_views", sheet: s.id, views: [...(s.filterViews ?? []), view] }]);
    return this.#viewOf(this.sheet(sheet), view.id);
  }

  /** Makes a view hold the sheet's filter and its tables' filters and sorts as they are now (and, if `options.sort` is given, a new sort, or none with `null`; otherwise its sort stays). */
  updateFilterView(sheet: string, view: string, options: { sort?: { column: number; descending?: boolean } | null } = {}): FilterView {
    const s = this.sheet(sheet);
    const old = this.#viewOf(s, view);
    let sort = "sort" in options && s.filter ? this.#sortOf(s, s.filter.range, options.sort) : old.sort;
    if (sort && s.filter) {
      const r = parseRange(s.filter.range)!;
      const c = colNumber(sort.column);
      if (c < r.c1 || c > r.c2) sort = undefined;
    }
    const next = this.#viewNow(s, old, sort);
    this.commit([{ type: "set_filter_views", sheet: s.id, views: s.filterViews!.map((v) => (v.id === old.id ? next : v)) }]);
    return this.#viewOf(this.sheet(sheet), old.id);
  }

  /** Gives a view another name. */
  renameFilterView(sheet: string, view: string, name: string): void {
    const s = this.sheet(sheet);
    const old = this.#viewOf(s, view);
    this.commit([{ type: "set_filter_views", sheet: s.id, views: s.filterViews!.map((v) => (v.id === old.id ? { ...v, name: cleanViewName(name) } : v)) }]);
  }

  /** Deletes a view. The sheet's own filter is left as it is. */
  deleteFilterView(sheet: string, view: string): void {
    const s = this.sheet(sheet);
    const old = this.#viewOf(s, view);
    this.commit([{ type: "set_filter_views", sheet: s.id, views: s.filterViews!.filter((v) => v.id !== old.id) }]);
  }

  /** The sheet's tables as a view filters them: with the view's filters when it has any say about tables, with their own otherwise. */
  #tablesIn(s: Sheet, v: FilterView): Table[] {
    return (s.tables ?? []).map((t) => {
      if (!v.tables) return t;
      const { filters: _own, ...rest } = t;
      const filters = v.tables[t.id]?.filters;
      return filters && Object.keys(filters).length && hasHeader(t) ? { ...rest, filters } : rest;
    });
  }

  /**
   * The rows to hide and to show so a sheet looks as the view says, compared with what the sheet shows now (its own filter
   * and the filters of its tables). This changes nothing: a grid draws the sheet this way for the person who picked the
   * view, and everyone else keeps seeing the sheet's own filter. The tables are filtered as the view says, not as they are
   * (a view with no word about tables leaves them as they are). A view's sort is not part of this (sorting moves cells).
   */
  filterViewRows(sheet: string, view: string): { hide: number[]; show: number[] } {
    const s = this.sheet(sheet);
    const v = this.#viewOf(s, view);
    const tables = s.tables ?? [];
    const viewHides = this.#filterPlan(s, v.range ? { range: v.range, ...(v.columns ? { columns: v.columns } : {}) } : undefined, this.#tablesIn(s, v));
    const sheetHides = this.#filterPlan(s, s.filter, tables);
    const spans: [number, number][] = [];
    if (v.range) {
      const vr = parseRange(v.range)!;
      spans.push([vr.r1 + 1, vr.r2]);
    }
    if (s.filter) {
      const r = parseRange(s.filter.range)!;
      spans.push([r.r1 + 1, r.r2]);
    }
    for (const t of tables) if (hasHeader(t)) spans.push(dataRows(t, parseRange(t.range)!));
    const hide: number[] = [];
    const show: number[] = [];
    const seen = new Set<number>();
    for (const [from, to] of spans)
      for (let row = from; row <= to; row++) {
        if (seen.has(row)) continue;
        seen.add(row);
        const hidden = !!s.rows?.[String(row)]?.hidden;
        const wants = viewHides(row);
        if (wants && !hidden) hide.push(row);
        else if (!wants && hidden && sheetHides(row)) show.push(row);
      }
    return { hide: hide.sort((a, b) => a - b), show: show.sort((a, b) => a - b) };
  }

  /** Whether a view sorts anything: the sheet's filter range, or a table in it. */
  filterViewSorts(sheet: string, view: string): boolean {
    const v = this.#viewOf(this.sheet(sheet), view);
    return !!v.sort || Object.values(v.tables ?? {}).some((t) => !!t.sort);
  }

  /**
   * A copy of this workbook, apart from it, with the view applied (its filters, its hidden rows and its sorts), to draw while
   * a person looks at a sorted view: a sort moves cells, which the grid has no other way to show. Nothing here changes; null
   * when the view sorts nothing or its sort can't be done (a protected sheet).
   */
  previewFilterView(sheet: string, view: string): SheetSession | null {
    if (!this.filterViewSorts(sheet, view)) return null;
    const copy = new SheetSession(structuredClone(this.state), { ...(this.#options.now ? { now: this.#options.now } : {}) });
    try {
      copy.applyFilterView(sheet, view);
    } catch {
      return null;
    }
    return copy;
  }

  /**
   * Makes a view the sheet's own, for everyone: its filter replaces the sheet's, each table gets the filters the view holds for it,
   * the rows are hidden and shown to match, and where the view has a sort the sheet's data and the tables' rows are sorted
   * (which moves cells). A view with no word about tables leaves them as they are. One undo step.
   */
  applyFilterView(sheet: string, view: string): void {
    const s = this.sheet(sheet);
    const v = this.#viewOf(s, view);
    const filter: SheetFilter | null = v.range ? { range: v.range, ...(v.columns ? { columns: structuredClone(v.columns) } : {}) } : null;
    // Every sort is worked out before anything is changed, so one that can't be done leaves the sheet as it was.
    const sorts: { cells: Record<string, Cell | null>; bounds?: Bounds }[] = [];
    if (v.range && v.sort) {
      const r = parseRange(v.range)!;
      this.#permit(s, "sort");
      sorts.push({ cells: this.#sorted(s, r, { by: colNumber(v.sort.column) - r.c1 + 1, descending: !!v.sort.descending, header: true }), bounds: r });
    }
    const taken: Bounds[] = sorts.flatMap((x) => (x.bounds ? [x.bounds] : []));
    const tableNext = new Map<string, Table>();
    if (v.tables) {
      for (const t of s.tables ?? []) {
        if (!hasHeader(t)) continue;
        const entry = v.tables[t.id];
        const b = parseRange(t.range)!;
        const names = tableColumns(s, b, t);
        const next: Table = { ...t };
        const filters = Object.fromEntries(Object.entries(entry?.filters ?? {}).filter(([n]) => names.includes(n)));
        if (Object.keys(filters).length) next.filters = structuredClone(filters);
        else delete next.filters;
        if (entry?.sort && names.includes(entry.sort.column)) {
          const [top, bottom] = dataRows(t, b);
          const area = { ...b, r1: top, r2: bottom };
          if (taken.some((x) => overlaps(x, area))) throw new PliError("invalid_operation", `Can't apply the view: the sort of ${t.name} overlaps another sort in it`);
          this.#permit(s, "sort");
          taken.push(area);
          const descending = !!entry.sort.descending;
          sorts.push({ cells: this.#sorted(s, area, { by: names.indexOf(entry.sort.column) + 1, descending }), bounds: area });
          next.sort = { column: entry.sort.column, ...(descending ? { descending: true as const } : {}) };
        }
        if (JSON.stringify(next) !== JSON.stringify(t)) tableNext.set(t.id, next);
      }
    }
    let merge = false;
    for (const sort of sorts) {
      this.commit([{ type: "set_cells", sheet: s.id, cells: sort.cells }], { ...(merge ? { merge: true } : {}), vet: { action: "sort", whole: true, samePlace: true, sheet: s.id, bounds: sort.bounds! } });
      merge = true;
    }
    // After a sort the rows have moved: what is hidden is worked out from the cells as they are now.
    const now = this.sheet(sheet);
    const old = now.filter ? parseRange(now.filter.range)! : null;
    const r = filter ? parseRange(filter.range)! : null;
    const ops: SheetOp[] = [];
    if (filter || now.filter) ops.push({ type: "set_filter", sheet: now.id, filter });
    const tables = (now.tables ?? []).map((t) => tableNext.get(t.id) ?? t);
    for (const t of tableNext.values()) ops.push({ type: "update_table", sheet: now.id, table: t });
    const hides = this.#filterPlan(now, filter ?? undefined, tables);
    const rows = new Set<number>();
    const span = (a: number, b: number) => {
      for (let row = a; row <= b; row++) rows.add(row);
    };
    if (r) span(r.r1 + 1, r.r2);
    if (old) span(old.r1 + 1, old.r2);
    for (const id of tableNext.keys()) {
      const t = tables.find((x) => x.id === id)!;
      span(...dataRows(t, parseRange(t.range)!));
    }
    for (const row of [...rows].sort((x, y) => x - y)) {
      const hide = hides(row);
      const hidden = !!now.rows?.[String(row)]?.hidden;
      if (hide && !hidden) ops.push({ type: "set_size", sheet: now.id, axis: "row", index: row, hidden: true });
      else if (!hide && hidden) ops.push({ type: "set_size", sheet: now.id, axis: "row", index: row, hidden: null });
    }
    if (ops.length) this.commit(ops, merge ? { merge: true } : {});
  }

  private filterOps(s: Sheet, filter: SheetFilter): SheetOp[] {
    const r = parseRange(filter.range)!;
    const ops: SheetOp[] = [{ type: "set_filter", sheet: s.id, filter }];
    const hides = this.#filterPlan(s, filter, []);
    for (let row = r.r1 + 1; row <= r.r2; row++) {
      const keep = !hides(row);
      const hidden = !!s.rows?.[String(row)]?.hidden;
      if (!keep && !hidden) ops.push({ type: "set_size", sheet: s.id, axis: "row", index: row, hidden: true });
      else if (keep && hidden) ops.push({ type: "set_size", sheet: s.id, axis: "row", index: row, hidden: null });
    }
    return ops;
  }

  /** A cell as a filter sees it. */
  #filterCell(s: Sheet, row: number, col: number): FilterCell {
    const address = cellAddress(row, col);
    const style = s.cells[address]?.s;
    const value = this.calculator.value(s.id, address);
    return { value, text: this.shownText(s.id, row, col), fill: style?.fill, font: style?.color, date: typeof value === "number" && isDateFormat(s.cells[address]?.fmt ?? "") };
  }

  /**
   * Works out, once, which of the filters in force (the sheet's own, and those of the tables) pass which rows: a function that
   * says whether a row is hidden by them.
   */
  #filterPlan(s: Sheet, sheetFilter: SheetFilter | undefined, tables: readonly Table[]): (row: number) => boolean {
    const today = Math.floor(this.calculator.now());
    const checks: { top: number; bottom: number; col: number; test: (c: FilterCell) => boolean }[] = [];
    const add = (top: number, bottom: number, col: number, criterion: FilterCriterion) => {
      const population: FilterCell[] = [];
      if (!Array.isArray(criterion) && (criterion.kind === "top" || criterion.kind === "average")) for (let row = top; row <= bottom; row++) population.push(this.#filterCell(s, row, col));
      checks.push({ top, bottom, col, test: criterionTest(criterion, population, today) });
    };
    if (sheetFilter) {
      const r = parseRange(sheetFilter.range)!;
      for (const [letters, criterion] of Object.entries(sheetFilter.columns ?? {})) add(r.r1 + 1, r.r2, colNumber(letters), criterion);
    }
    for (const table of tables) {
      if (!table.filters || !hasHeader(table)) continue;
      const b = parseRange(table.range)!;
      const [top, bottom] = dataRows(table, b);
      const names = tableColumns(s, b, table);
      for (const [name, criterion] of Object.entries(table.filters)) {
        const at = names.indexOf(name);
        if (at >= 0) add(top, bottom, b.c1 + at, criterion);
      }
    }
    return (row) => checks.some((c) => row >= c.top && row <= c.bottom && !c.test(this.#filterCell(s, row, c.col)));
  }

  /** The different values in a filtered column below the heading, as the cells show them, with how many rows have each. */
  filterValues(sheet: string, column: number): { value: string; count: number }[] {
    const s = this.sheet(sheet);
    if (!s.filter) return [];
    const r = parseRange(s.filter.range)!;
    const counts = new Map<string, number>();
    for (let row = r.r1 + 1; row <= r.r2; row++) {
      const t = this.shownText(s.id, row, column);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => compareValues(a.value, b.value));
  }

  /**
   * The dates in a column of the sheet's filter as the tree Excel's filter menu shows (years, months in them, days in those,
   * and hours, minutes and seconds for dates with a time), each node with how many cells it holds and how many the filter
   * lets through now, and the other values as a flat list. `null` when the column holds no dates.
   */
  filterDateTree(sheet: string, column: number): DateTree | null {
    const s = this.sheet(sheet);
    if (!s.filter) return null;
    const r = parseRange(s.filter.range)!;
    return this.#dateTreeIn(s, column, r.r1 + 1, r.r2, s.filter.columns?.[colName(column)]);
  }

  /** The same for a column of a table. */
  tableFilterDateTree(table: string, column: string | number): DateTree | null {
    const entry = this.tableOf(table);
    this.filterable(entry);
    const name = this.columnOf(entry, column);
    const at = tableColumns(entry.sheet, entry.bounds, entry.table).indexOf(name);
    const [top, bottom] = dataRows(entry.table, entry.bounds);
    return this.#dateTreeIn(entry.sheet, entry.bounds.c1 + at, top, bottom, entry.table.filters?.[name]);
  }

  #dateTreeIn(s: Sheet, col: number, top: number, bottom: number, criterion: FilterCriterion | undefined): DateTree | null {
    const cells: FilterCell[] = [];
    for (let row = top; row <= bottom; row++) cells.push(this.#filterCell(s, row, col));
    if (!cells.some((c) => c.date)) return null;
    const passes = criterion === undefined ? () => true : criterionTest(criterion, cells, Math.floor(this.calculator.now()));
    const nodes = buildDateTree(cells.filter((c) => c.date).map((cell) => ({ value: cell.value as number, text: cell.text, cell })), (d) => passes(d.cell));
    const others = new Map<string, { count: number; selected: boolean }>();
    for (const c of cells) {
      if (c.date) continue;
      const o = others.get(c.text) ?? { count: 0, selected: passes(c) };
      o.count++;
      others.set(c.text, o);
    }
    return { nodes, others: [...others].map(([value, o]) => ({ value, ...o })).sort((a, b) => compareValues(a.value, b.value)) };
  }

  /**
   * Filters a column of the sheet's filter by dates picked in the tree: `ticked` are the leaves of `filterDateTree` to let
   * through (their `groupKey`s) and `values` the other values to let through. A year, month or day all of whose dates are
   * ticked is picked whole, as Excel does. Ticking everything takes the filter off.
   */
  filterColumnDates(sheet: string, column: number, ticked: readonly string[], values: readonly string[]): void {
    const tree = this.filterDateTree(sheet, column);
    if (!tree) throw new PliError("invalid_operation", "That column holds no dates");
    this.#setColumnFilter(sheet, column, dateFilterOf(tree, new Set(ticked), new Set(values)));
  }

  /** The same for a column of a table. */
  filterTableDates(table: string, column: string | number, ticked: readonly string[], values: readonly string[]): void {
    const tree = this.tableFilterDateTree(table, column);
    if (!tree) throw new PliError("invalid_operation", "That column holds no dates");
    this.#setTableFilter(table, column, dateFilterOf(tree, new Set(ticked), new Set(values)));
  }

  /** The fill and font colours the cells of a filtered column have, for a filter by colour (`"none"` and `"auto"` stand for no fill and the default font colour). */
  filterColors(sheet: string, column: number): { fills: string[]; fonts: string[] } {
    const s = this.sheet(sheet);
    if (!s.filter) return { fills: [], fonts: [] };
    const r = parseRange(s.filter.range)!;
    return this.#colorsIn(s, column, r.r1 + 1, r.r2);
  }

  /** The same for a column of a table. */
  tableFilterColors(table: string, column: string | number): { fills: string[]; fonts: string[] } {
    const entry = this.tableOf(table);
    this.filterable(entry);
    const at = tableColumns(entry.sheet, entry.bounds, entry.table).indexOf(this.columnOf(entry, column));
    const [top, bottom] = dataRows(entry.table, entry.bounds);
    return this.#colorsIn(entry.sheet, entry.bounds.c1 + at, top, bottom);
  }

  #colorsIn(s: Sheet, col: number, top: number, bottom: number): { fills: string[]; fonts: string[] } {
    const fills = new Set<string>();
    const fonts = new Set<string>();
    for (let row = top; row <= bottom; row++) {
      const style = s.cells[cellAddress(row, col)]?.s;
      fills.add(style?.fill ?? "none");
      fonts.add(style?.color ?? "auto");
    }
    const order = (set: Set<string>, plain: string) => [...set].sort((a, b) => (a === plain ? -1 : b === plain ? 1 : a < b ? -1 : 1));
    return { fills: order(fills, "none"), fonts: order(fonts, "auto") };
  }

  // ---- rows, columns, sheets ----

  insertRows(sheet: string, at: number, count = 1): void {
    this.commit([{ type: "insert_rows", sheet: this.sheet(sheet).id, at, count }]);
  }
  deleteRows(sheet: string, at: number, count = 1): void {
    this.commit([{ type: "delete_rows", sheet: this.sheet(sheet).id, at, count }]);
  }
  insertColumns(sheet: string, at: number, count = 1): void {
    this.commit([{ type: "insert_cols", sheet: this.sheet(sheet).id, at, count }]);
  }
  deleteColumns(sheet: string, at: number, count = 1): void {
    this.commit([{ type: "delete_cols", sheet: this.sheet(sheet).id, at, count }]);
  }
  setColumnWidth(sheet: string, column: number, width: number | null): void {
    this.commit([{ type: "set_size", sheet: this.sheet(sheet).id, axis: "col", index: column, size: width }]);
  }
  setRowHeight(sheet: string, row: number, height: number | null): void {
    this.commit([{ type: "set_size", sheet: this.sheet(sheet).id, axis: "row", index: row, size: height }]);
  }
  setFrozen(sheet: string, rows: number, cols: number): void {
    this.commit([{ type: "set_frozen", sheet: this.sheet(sheet).id, rows, cols }]);
  }
  /** Adds an empty sheet and returns it. */
  addSheet(name?: string, index?: number): Sheet {
    let n = this.state.sheets.length + 1;
    let chosen = name;
    if (chosen === undefined) {
      while (this.state.sheets.some((s) => s.name.toLowerCase() === `sheet${n}`)) n++;
      chosen = `Sheet${n}`;
    }
    const sheet: Sheet = { id: createId("sheet_"), name: chosen, cells: {} };
    this.commit([{ type: "add_sheet", sheet, ...(index !== undefined ? { index } : {}) }]);
    return sheet;
  }
  /** A shared workbook lets the last sheet go (two people can delete the last two between them), so what one person asks for is checked here. */
  #oneStays(ops: SheetOp[]): void {
    if (!this.syncing) return;
    ops.reduce((wb, op) => applyOp(wb, op), this.state);
  }
  deleteSheet(sheet: string): void {
    const op: SheetOp = { type: "delete_sheet", id: this.sheet(sheet).id };
    this.#oneStays([op]);
    this.commit([op]);
  }
  renameSheet(sheet: string, name: string): void {
    this.commit([{ type: "rename_sheet", id: this.sheet(sheet).id, name }]);
  }
  moveSheet(sheet: string, index: number): void {
    this.commit([{ type: "move_sheet", id: this.sheet(sheet).id, index }]);
  }
  /** Colours a sheet's tab (`#rrggbb`), or takes the colour off with `null`. */
  setTabColor(sheet: string, color: string | null): void {
    this.commit([{ type: "set_tab_color", sheet: this.sheet(sheet).id, color }]);
  }
  /** Hides the tabs of these sheets (or shows them again with `hidden` false), as one undo step. At least one sheet stays shown. */
  hideSheets(sheets: readonly string[], hidden = true): void {
    const ops = sheets.map((s): SheetOp => ({ type: "set_sheet_hidden", sheet: this.sheet(s).id, hidden }));
    this.#oneStays(ops);
    this.commit(ops);
  }
  /** Deletes these sheets as one undo step. At least one sheet that isn't hidden stays. */
  deleteSheets(sheets: readonly string[]): void {
    const ops = sheets.map((s): SheetOp => ({ type: "delete_sheet", id: this.sheet(s).id }));
    this.#oneStays(ops);
    this.commit(ops);
  }
  /** Renames the workbook. Typing a name isn't an undo step, so Undo takes back the last edit to the cells instead. */
  setTitle(title: string): void {
    this.commit([{ type: "set_title", title }], { history: false });
  }
  /** Names a range or formula so formulas can use the name: `defineName("Tax", "Sheet1!$B$1")`. `null` removes it. */
  defineName(name: string, formula: string | null): void {
    this.commit([{ type: "set_name", name, formula }]);
  }

  // ---- charts ----

  /** The charts on a sheet, bottom to top. */
  charts(sheet: string): readonly Chart[] {
    return this.sheet(sheet).charts ?? [];
  }

  /** Puts a chart over the sheet and returns it. Without a place it goes in the top-left cell of the view; without a size it is 480 by 288. */
  addChart(sheet: string, spec: Partial<Chart> & { series: ChartSeries[] }): Chart {
    const chart: Chart = {
      type: "column",
      from: { row: 1, col: 1 },
      width: DEFAULT_CHART_WIDTH,
      height: DEFAULT_CHART_HEIGHT,
      ...spec,
      id: spec.id ?? createId("chart_"),
    };
    this.commit([{ type: "add_chart", sheet: this.sheet(sheet).id, chart }]);
    return this.charts(sheet).find((c) => c.id === chart.id) ?? chart;
  }

  /**
   * Charts the cells in `range` the way a person would pick the parts: a first column of text or dates gives the labels,
   * a first row of text gives the series names, and every column of numbers is a series. A single cell stands for the
   * block of data around it. The chart is placed to the right of the data.
   */
  insertChart(sheet: string, range: string, options: { type?: ChartType; id?: string; /** `rows` takes each row of numbers as a series (a table with the months across); `columns`, the default, each column. */ seriesIn?: "columns" | "rows" } = {}): Chart {
    const s = this.sheet(sheet);
    let b = this.bounds(range);
    if (b.r1 === b.r2 && b.c1 === b.c2) b = this.bounds(this.currentRegion(sheet, cellAddress(b.r1, b.c1)));
    const val = (r: number, c: number) => this.calculator.value(s.id, cellAddress(r, c));
    if (options.seriesIn === "rows") {
      const picked = pickByRows(b, s.name, val, (r, c) => isDateFormat(s.cells[cellAddress(r, c)]?.fmt ?? ""));
      if (!picked.series.length) throw new PliError("invalid_operation", "There are no numbers to chart in these cells");
      const kind = options.type ?? (picked.categories && picked.dates ? "line" : "column");
      const rowShaped = seriesForType(kind, picked.series, picked.categories);
      const rowNamed = picked.series[0]!.nameRef ? this.display(sheet, picked.series[0]!.nameRef.replace(/^.*!/, "").replace(/\$/g, "")).text : undefined;
      return this.addChart(sheet, {
        ...(options.id ? { id: options.id } : {}),
        type: kind,
        series: rowShaped.series,
        ...(rowShaped.categories ? { categories: rowShaped.categories } : {}),
        ...(rowShaped.stock ? { stock: rowShaped.stock } : {}),
        ...(kind === "surface" ? { view3d: defaultView3d("surface") } : {}),
        ...(picked.series.length === 1 && rowNamed ? { title: rowNamed } : {}),
        from: { row: b.r1, col: Math.min(MAX_COLS, b.c2 + 2) },
      });
    }
    const isText = (v: Value) => typeof v === "string" && v !== "";
    const multiCol = b.c2 > b.c1;
    const first = cellAddress(b.r1 + (b.r2 > b.r1 ? 1 : 0), b.c1);
    const dateFirst = isDateFormat(s.cells[first]?.fmt ?? "");
    const catCol = multiCol && b.r2 > b.r1 && (isText(val(b.r1 + 1, b.c1)) || dateFirst || val(b.r1, b.c1) === null) ? b.c1 : 0;
    const hasHeader = b.r2 > b.r1 && Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => b.c1 + i).some((c) => c !== catCol && isText(val(b.r1, c)));
    const top = hasHeader ? b.r1 + 1 : b.r1;
    const series: ChartSeries[] = [];
    for (let c = b.c1; c <= b.c2; c++) {
      if (c === catCol) continue;
      let numbers = 0;
      for (let r = top; r <= b.r2; r++) if (typeof val(r, c) === "number") numbers++;
      if (!numbers) continue;
      series.push({
        ...(hasHeader && isText(val(b.r1, c)) ? { nameRef: chartRefText(s.name, { r1: b.r1, c1: c, r2: b.r1, c2: c }) } : {}),
        values: chartRefText(s.name, { r1: top, c1: c, r2: b.r2, c2: c }),
        color: CHART_COLORS[series.length % CHART_COLORS.length]!,
      });
    }
    if (!series.length) throw new PliError("invalid_operation", "There are no numbers to chart in these cells");
    const type = options.type ?? (catCol && dateFirst ? "line" : "column");
    const named = series[0]!.nameRef ? this.display(sheet, series[0]!.nameRef.replace(/^.*!/, "").replace(/\$/g, "")).text : undefined;
    const shaped = seriesForType(type, series, catCol ? chartRefText(s.name, { r1: top, c1: catCol, r2: b.r2, c2: catCol }) : undefined);
    return this.addChart(sheet, {
      ...(options.id ? { id: options.id } : {}),
      type,
      // The slices of a pie take their colours from the palette, not from the series.
      series: shaped.series,
      ...(shaped.categories ? { categories: shaped.categories } : {}),
      ...(shaped.stock ? { stock: shaped.stock } : {}),
      ...(type === "surface" ? { view3d: defaultView3d("surface") } : {}),
      ...(series.length === 1 && named ? { title: named } : {}),
      from: { row: b.r1, col: Math.min(MAX_COLS, b.c2 + 2) },
    });
  }

  /** Changes a chart. Several changes in a row (dragging it about) can be one undo step with `merge`. */
  updateChart(sheet: string, id: string, patch: Partial<Omit<Chart, "id">>, options: { merge?: boolean } = {}): void {
    const s = this.sheet(sheet);
    const old = s.charts?.find((c) => c.id === id);
    if (!old) throw new PliError("not_found", `No chart with id "${id}"`);
    const chart: Chart = { ...old, ...patch, id };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete chart[k as keyof Chart];
    this.commit([{ type: "update_chart", sheet: s.id, chart }], options);
  }

  /** Which way a chart's series run: down `columns` or across `rows` of cells; null when that can't be said. */
  chartSeriesIn(sheet: string, id: string): "columns" | "rows" | null {
    const home = this.sheet(sheet);
    const chart = home.charts?.find((c) => c.id === id);
    if (!chart) throw new PliError("not_found", `No chart with id "${id}"`);
    return chartOrientation(chart, home.name);
  }

  /**
   * Switches the rows and columns of a chart's data (Excel's Switch Row/Column): the series become the categories and the
   * categories the series. The series must run the same way over the same cells. One undo step.
   */
  switchChartRowsColumns(sheet: string, id: string): Chart {
    const home = this.sheet(sheet);
    const chart = home.charts?.find((c) => c.id === id);
    if (!chart) throw new PliError("not_found", `No chart with id "${id}"`);
    const next = switchRowsColumns(chart, home.name);
    this.updateChart(sheet, id, { categories: next.categories, series: next.series });
    return this.charts(sheet).find((c) => c.id === id)!;
  }

  /** Moves a chart over or under the others. */
  reorderChart(sheet: string, id: string, to: "front" | "back"): void {
    const s = this.sheet(sheet);
    const chart = s.charts?.find((c) => c.id === id);
    if (!chart) throw new PliError("not_found", `No chart with id "${id}"`);
    this.commit([
      { type: "delete_chart", sheet: s.id, id },
      { type: "add_chart", sheet: s.id, chart, index: to === "front" ? s.charts!.length : 0 },
    ]);
  }

  deleteChart(sheet: string, id: string): void {
    this.commit([{ type: "delete_chart", sheet: this.sheet(sheet).id, id }]);
  }

  /** What the chart shows now, read from its cells. Rows and columns that are hidden (by a filter, say) are left out, as in Excel. */
  chartData(sheet: string, id: string): ChartData {
    const home = this.sheet(sheet);
    const chart = home.charts?.find((c) => c.id === id);
    if (!chart) throw new PliError("not_found", `No chart with id "${id}"`);
    return readChart(chart, home, this.state.sheets, (sheetId, address) => ({ value: this.calculator.value(sheetId, address), text: this.calculator.display(sheetId, address).text }));
  }

  // ---- pictures ----

  /** The pictures on a sheet, bottom to top. */
  images(sheet: string): readonly SheetImage[] {
    return this.sheet(sheet).images ?? [];
  }

  /**
   * Puts a picture over the sheet and returns it. `src` is a `data:` URI of a PNG, JPEG or GIF (see `toDataUri`). Without a
   * size it is the picture's own, scaled down to fit 480 by 360; without a place it is in A1.
   */
  addImage(sheet: string, spec: { src: string; from?: SheetImage["from"]; width?: number; height?: number; alt?: string; id?: string } & Pick<SheetImage, "placement" | "rotation" | "flipH" | "flipV" | "crop" | "border" | "shadow" | "brightness" | "contrast" | "grayscale" | "glow" | "softEdge" | "reflection" | "artistic" | "shape" | "shapeAdjust">): SheetImage {
    const natural = readImage(spec.src);
    const cropped = spec.crop ? cleanCrop(spec.crop) : null;
    // What shows is what is left after the crop, so the default size is that part's.
    const showW = natural.width * (1 - (cropped?.left ?? 0) - (cropped?.right ?? 0));
    const showH = natural.height * (1 - (cropped?.top ?? 0) - (cropped?.bottom ?? 0));
    const size = defaultImageSize(showW, showH);
    const s = this.sheet(sheet);
    let image: SheetImage = {
      id: spec.id ?? createId("image_"),
      src: spec.src,
      from: spec.from ?? { row: 1, col: 1 },
      width: spec.width ?? (spec.height !== undefined ? Math.max(1, Math.round((spec.height * showW) / showH)) : size.width),
      height: spec.height ?? (spec.width !== undefined ? Math.max(1, Math.round((spec.width * showH) / showW)) : size.height),
      ...(spec.alt ? { alt: spec.alt } : {}),
      ...(spec.placement ? { placement: spec.placement } : {}),
      ...(spec.rotation !== undefined ? { rotation: spec.rotation } : {}),
      ...(spec.flipH ? { flipH: true as const } : {}),
      ...(spec.flipV ? { flipV: true as const } : {}),
      ...(cropped ? { crop: cropped } : {}),
      ...(spec.border ? { border: spec.border } : {}),
      ...(spec.shadow ? { shadow: spec.shadow } : {}),
      ...(spec.brightness ? { brightness: spec.brightness } : {}),
      ...(spec.contrast ? { contrast: spec.contrast } : {}),
      ...(spec.grayscale ? { grayscale: true as const } : {}),
      ...(spec.glow ? { glow: spec.glow } : {}),
      ...(spec.softEdge ? { softEdge: spec.softEdge } : {}),
      ...(spec.reflection ? { reflection: spec.reflection } : {}),
      ...(spec.artistic ? { artistic: spec.artistic } : {}),
      ...(spec.shape ? { shape: spec.shape } : {}),
      ...(spec.shape && spec.shapeAdjust ? { shapeAdjust: spec.shapeAdjust } : {}),
    };
    image = this.#settleImage(s, image);
    this.commit([{ type: "add_image", sheet: s.id, image }]);
    return this.images(sheet).find((x) => x.id === image.id) ?? image;
  }

  /** A picture's corners agree with its size: one that sizes with its cells has the cell its bottom right corner is in, and no other does. */
  #settleImage(sheet: Sheet, image: SheetImage): SheetImage {
    if (image.placement === "size") {
      const left = axisOffsetPx(sheet, "col", image.from.col) + (image.from.dx ?? 0);
      const top = axisOffsetPx(sheet, "row", image.from.row) + (image.from.dy ?? 0);
      return placeImage(sheet, { ...image, to: undefined } as SheetImage, { left, top, width: image.width, height: image.height });
    }
    if (image.to === undefined) return image;
    const { to: _to, ...rest } = image;
    return rest;
  }

  /**
   * Changes a picture: moves or resizes it, rotates, flips or crops it, changes how it follows its cells, or changes its
   * description. Several changes in a row (dragging) can be one undo step with `merge`.
   */
  updateImage(sheet: string, id: string, patch: Partial<Omit<SheetImage, "id" | "src">>, options: { merge?: boolean } = {}): void {
    const s = this.sheet(sheet);
    const old = s.images?.find((x) => x.id === id);
    if (!old) throw new PliError("not_found", `No picture with id "${id}"`);
    let image: SheetImage = { ...old, ...patch, id };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete image[k as keyof SheetImage];
    image = this.#settleImage(s, image);
    this.commit([{ type: "update_image", sheet: s.id, image }], options);
  }

  /**
   * Changes how a picture looks in one step: its description, rotation, flips, crop, border, shadow, brightness, contrast, grey shades, glow, soft edges, reflection, artistic effect and how it follows its cells. A crop
   * keeps the picture's scale, so what is left is smaller (or larger when the crop is made less). `null` (or `false` for a
   * flip) takes a setting away.
   */
  formatImage(sheet: string, id: string, look: { alt?: string | null; rotation?: number | null; flipH?: boolean; flipV?: boolean; crop?: ImageCrop | null; placement?: ImagePlacement; border?: ImageBorder | null; shadow?: ImageShadow | null; brightness?: number | null; contrast?: number | null; grayscale?: boolean; glow?: ImageGlow | null; softEdge?: number | null; reflection?: ImageReflection | null; artistic?: ImageArtistic | null; shape?: ImageShape | null; shapeAdjust?: Record<string, number> | null }): void {
    const old = this.images(sheet).find((x) => x.id === id);
    if (!old) throw new PliError("not_found", `No picture with id "${id}"`);
    const patch: Partial<Omit<SheetImage, "id" | "src">> = {};
    if (look.alt !== undefined) patch.alt = look.alt === null || look.alt === "" ? undefined : look.alt;
    if (look.rotation !== undefined) {
      if (look.rotation !== null && (typeof look.rotation !== "number" || !Number.isFinite(look.rotation))) throw new PliError("invalid_operation", "A rotation is a number of degrees");
      patch.rotation = look.rotation === null ? undefined : look.rotation;
    }
    if (look.flipH !== undefined) patch.flipH = look.flipH ? true : undefined;
    if (look.flipV !== undefined) patch.flipV = look.flipV ? true : undefined;
    if (look.placement !== undefined) patch.placement = look.placement === "move" ? undefined : look.placement;
    if (look.border !== undefined) patch.border = look.border ?? undefined;
    if (look.shadow !== undefined) patch.shadow = look.shadow ?? undefined;
    if (look.brightness !== undefined) patch.brightness = look.brightness ?? undefined;
    if (look.contrast !== undefined) patch.contrast = look.contrast ?? undefined;
    if (look.grayscale !== undefined) patch.grayscale = look.grayscale ? true : undefined;
    if (look.glow !== undefined) patch.glow = look.glow ?? undefined;
    if (look.softEdge !== undefined) patch.softEdge = look.softEdge || undefined;
    if (look.reflection !== undefined) patch.reflection = look.reflection ?? undefined;
    if (look.artistic !== undefined) patch.artistic = look.artistic ?? undefined;
    if (look.shape !== undefined) {
      patch.shape = look.shape ?? undefined;
      // Another shape has other adjustments: they start again from the usual ones.
      if (look.shape !== old.shape && look.shapeAdjust === undefined) patch.shapeAdjust = undefined;
    }
    if (look.shapeAdjust !== undefined) patch.shapeAdjust = look.shapeAdjust ?? undefined;
    if (look.crop !== undefined) {
      const next = look.crop ? cleanCrop(look.crop) : null;
      const keep = (c: ImageCrop | undefined) => ({ w: 1 - (c?.left ?? 0) - (c?.right ?? 0), h: 1 - (c?.top ?? 0) - (c?.bottom ?? 0) });
      const was = keep(old.crop);
      const now = keep(next ?? undefined);
      patch.crop = next ?? undefined;
      patch.width = Math.max(MIN_IMAGE_SIZE, Math.round((old.width * now.w) / was.w));
      patch.height = Math.max(MIN_IMAGE_SIZE, Math.round((old.height * now.h) / was.h));
    }
    this.updateImage(sheet, id, patch);
  }

  /**
   * Crops a picture: `crop` says how much of the picture's own size to cut off each side (0 up to less than 1), `null`
   * puts it back whole. The picture keeps its scale, so it gets smaller as it is cropped and larger as it is uncropped.
   */
  cropImage(sheet: string, id: string, crop: ImageCrop | null): void {
    this.formatImage(sheet, id, { crop });
  }

  /** Crops a picture to a shape (an oval, a rounded rectangle, a star…, see `IMAGE_SHAPES`); `null` makes it a rectangle again. The picture shows only inside the shape, which fills the picture's frame. */
  cropImageToShape(sheet: string, id: string, shape: ImageShape | null): void {
    this.formatImage(sheet, id, { shape });
  }

  /**
   * Crops a picture to a shape, from its middle, in one step. `ratio` is a width over height (`1` is a square), a string like
   * `"16:9"`, `"fill"` (the picture fills the frame it is in now, cutting what does not fit) or `"fit"` (the whole picture,
   * as big as fits in the frame it is in now). The ratios keep the picture's scale, as `cropImage` does, so what is left is smaller.
   */
  cropImageToRatio(sheet: string, id: string, ratio: number | string): void {
    const old = this.images(sheet).find((x) => x.id === id);
    if (!old) throw new PliError("not_found", `No picture with id "${id}"`);
    const natural = readImage(old.src);
    if (ratio === "fit") {
      const k = Math.min(old.width / natural.width, old.height / natural.height);
      this.updateImage(sheet, id, { crop: undefined, width: Math.max(MIN_IMAGE_SIZE, Math.round(natural.width * k)), height: Math.max(MIN_IMAGE_SIZE, Math.round(natural.height * k)) });
      return;
    }
    let r: number;
    if (ratio === "fill") r = old.width / old.height;
    else if (typeof ratio === "number") r = ratio;
    else {
      const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(ratio));
      r = m ? Number(m[1]) / Number(m[2]) : NaN;
    }
    if (!Number.isFinite(r) || r <= 0 || r > 100 || r < 0.01) throw new PliError("invalid_operation", 'A crop shape is a width over height, "w:h", "fill" or "fit"');
    // The biggest window of the whole picture with that shape, in the middle of it.
    const wide = natural.width / natural.height > r;
    const cw = wide ? natural.height * r : natural.width;
    const ch = wide ? natural.height : natural.width / r;
    const crop = cleanCrop({ left: (natural.width - cw) / 2 / natural.width, right: (natural.width - cw) / 2 / natural.width, top: (natural.height - ch) / 2 / natural.height, bottom: (natural.height - ch) / 2 / natural.height });
    if (ratio === "fill") {
      this.updateImage(sheet, id, { crop: crop ?? undefined });
      return;
    }
    // The scale the picture has now: the size of the whole picture on the sheet over its own size.
    const k = old.width / (1 - (old.crop?.left ?? 0) - (old.crop?.right ?? 0)) / natural.width;
    this.updateImage(sheet, id, { crop: crop ?? undefined, width: Math.max(MIN_IMAGE_SIZE, Math.round(cw * k)), height: Math.max(MIN_IMAGE_SIZE, Math.round(ch * k)) });
  }

  /** Turns a picture a quarter turn (or any number of degrees) clockwise; negative turns it back. */
  rotateImage(sheet: string, id: string, degrees: number): void {
    const old = this.images(sheet).find((x) => x.id === id);
    if (!old) throw new PliError("not_found", `No picture with id "${id}"`);
    if (typeof degrees !== "number" || !Number.isFinite(degrees)) throw new PliError("invalid_operation", "A rotation is a number of degrees");
    this.updateImage(sheet, id, { rotation: ((((old.rotation ?? 0) + degrees) % 360) + 360) % 360 || undefined });
  }

  /** Mirrors a picture left to right (`"h"`) or top to bottom (`"v"`); doing it again puts it back. */
  flipImage(sheet: string, id: string, direction: "h" | "v"): void {
    const old = this.images(sheet).find((x) => x.id === id);
    if (!old) throw new PliError("not_found", `No picture with id "${id}"`);
    const key = direction === "h" ? "flipH" : "flipV";
    this.updateImage(sheet, id, { [key]: old[key] ? undefined : true });
  }

  /**
   * Makes a copy of a picture, on the same sheet a little way off or on another sheet (`to.sheet`) where `to.from` says
   * (the same cell by default). Gives the copy.
   */
  copyImage(sheet: string, id: string, to: { sheet?: string; from?: SheetImage["from"] } = {}): SheetImage {
    const old = this.images(sheet).find((x) => x.id === id);
    if (!old) throw new PliError("not_found", `No picture with id "${id}"`);
    const target = to.sheet ?? sheet;
    const same = this.sheet(target).id === this.sheet(sheet).id;
    const { id: _id, to: _to, from, ...rest } = old;
    return this.addImage(target, {
      ...rest,
      from: to.from ?? (same ? { ...from, dx: (from.dx ?? 0) + 24, dy: (from.dy ?? 0) + 24 } : from),
    });
  }

  /** Makes a picture fill a range of cells: its corner goes to the range's, and it takes the range's size. */
  fitImage(sheet: string, id: string, range: string): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const { width, height } = rangePixels(s, b);
    if (width <= 0 || height <= 0) throw new PliError("invalid_operation", "Those cells are hidden, so there is nothing to fit the picture to");
    this.updateImage(sheet, id, { from: { row: b.r1, col: b.c1 }, width, height });
  }

  /** Moves a picture over or under the others. */
  reorderImage(sheet: string, id: string, to: "front" | "back"): void {
    const s = this.sheet(sheet);
    const image = s.images?.find((x) => x.id === id);
    if (!image) throw new PliError("not_found", `No picture with id "${id}"`);
    this.commit([
      { type: "delete_image", sheet: s.id, id },
      { type: "add_image", sheet: s.id, image, index: to === "front" ? s.images!.length : 0 },
    ]);
  }

  deleteImage(sheet: string, id: string): void {
    this.commit([{ type: "delete_image", sheet: this.sheet(sheet).id, id }]);
  }

  // ---- pictures in cells ----

  /**
   * The picture a cell shows: one placed in it (`picture` on the cell) or one an `IMAGE` formula in it asks for. `formula`
   * says which. `sizing` is how it fills the cell: 0 fitted (kept in proportion), 1 stretched to fill, 2 its own size, 3 at the
   * `width` and `height` given.
   */
  cellPicture(sheet: string, address: string): { src: string; alt?: string; sizing: 0 | 1 | 2 | 3; width?: number; height?: number; formula: boolean } | null {
    const s = this.sheet(sheet);
    const key = address.replace(/\$/g, "").toUpperCase();
    const cell = s.cells[key];
    if (cell?.picture) return { src: cell.picture.src, ...(cell.picture.alt ? { alt: cell.picture.alt } : {}), sizing: 0, formula: false };
    if (cell?.f !== undefined) {
      const img = this.calculator.imageAt(s.id, key);
      if (img) return { src: img.src, ...(img.alt ? { alt: img.alt } : {}), sizing: img.sizing, ...(img.width !== undefined ? { width: img.width, height: img.height } : {}), formula: true };
    }
    return null;
  }

  /**
   * Puts a picture in a cell as its content ("Place in Cell"), in place of what was there (its number format and look stay),
   * or takes the picture out with `null` (the cell is then empty if its value was only the description). `src` is a
   * `data:` URI of a PNG, JPEG or GIF.
   */
  setCellPicture(sheet: string, address: string, picture: CellPicture | null): void {
    const s = this.sheet(sheet);
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const key = cellAddress(pos.row, pos.col);
    const old = s.cells[key];
    const { v: _v, e: _e, f: _f, control: _control, link: _link, picture: was, ...keep } = old ?? {};
    let next: Cell | null;
    if (picture === null) {
      if (!was) return;
      // The value the picture gave the cell goes with it, unless something else was typed over that.
      next = _v !== undefined && _v !== (was.alt ?? "") ? { ...keep, v: _v } : keep;
    } else next = { ...keep, picture };
    this.commit([{ type: "set_cells", sheet: s.id, cells: { [key]: next && cleanCell(next) } }]);
  }

  /**
   * Turns a floating picture into the content of a cell ("Place in Cell"): the cell the picture's corner is in, or `address`.
   * It is fitted to the cell and moves and sizes with it; cropping, turning and flipping are not kept. One undo step.
   */
  placeInCell(sheet: string, id: string, address?: string): void {
    const s = this.sheet(sheet);
    const image = s.images?.find((x) => x.id === id);
    if (!image) throw new PliError("not_found", `No picture with id "${id}"`);
    const key = address ? address.replace(/\$/g, "").toUpperCase() : cellAddress(image.from.row, image.from.col);
    if (!parseCell(key)) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const { v: _v, e: _e, f: _f, control: _control, link: _link, picture: _picture, ...keep } = s.cells[key] ?? {};
    const cell = cleanCell({ ...keep, picture: { src: image.src, ...(image.alt ? { alt: image.alt } : {}) } });
    this.commit([
      { type: "delete_image", sheet: s.id, id },
      { type: "set_cells", sheet: s.id, cells: { [key]: cell } },
    ]);
  }

  /** Turns the picture in a cell into a floating one the size of the cell ("Place over Cells") and empties the cell. Gives the picture. */
  placeOverCells(sheet: string, address: string): SheetImage {
    const s = this.sheet(sheet);
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const key = cellAddress(pos.row, pos.col);
    const picture = s.cells[key]?.picture;
    if (!picture) throw new PliError("invalid_operation", `${key} has no picture in it`);
    const merged = mergeAt(s, pos.row, pos.col);
    const box = merged ?? { r1: pos.row, c1: pos.col, r2: pos.row, c2: pos.col };
    const { width, height } = rangePixels(s, box);
    if (width <= 0 || height <= 0) throw new PliError("invalid_operation", "That cell is hidden, so there is nothing to place the picture over");
    const image: SheetImage = { id: createId("image_"), src: picture.src, from: { row: box.r1, col: box.c1 }, width, height, placement: "size", ...(picture.alt ? { alt: picture.alt } : {}) };
    const placed = this.#settleImage(s, image);
    const { picture: _p, v, ...keep } = s.cells[key]!;
    const cell = v !== undefined && v !== (picture.alt ?? "") ? cleanCell({ ...keep, v }) : cleanCell(keep);
    this.commit([
      { type: "set_cells", sheet: s.id, cells: { [key]: cell } },
      { type: "add_image", sheet: s.id, image: placed },
    ]);
    return placed;
  }

  // ---- borders ----

  /**
   * Draws lines on a range: `where` says which (around it, between its cells, one side…) and `border` how; `null` takes
   * those lines away, and `"none"` takes away every line in the range. Like Excel, where a line is the edge of a cell
   * next to the range, that cell's side is set too, so the line reads the same from both cells.
   */
  setBorders(sheet: string, range: string, where: BorderWhere, border: Border | null = { style: "thin" }): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const line = where === "none" || border === null ? null : cleanBorder(border);
    const width = b.c2 - b.c1 + 1;
    const height = b.r2 - b.r1 + 1;
    const wide = where === "all" || where === "inner" || where === "horizontal" || where === "vertical" || where === "none" || where === "diagonalUp" || where === "diagonalDown";
    if ((wide ? width * height : 2 * (width + height)) > MAX_CELLS_AT_ONCE / 10) throw new PliError("out_of_range", "That range is too large to change at once; select the cells you want");
    if (wide && width * height > 10_000 && width * height > Object.keys(s.cells).length * 4 && line !== null) throw new PliError("out_of_range", "That range is too large to change at once; select the cells you want");
    const edits = new Map<string, Partial<Record<Side, Border | null>>>();
    const put = (row: number, col: number, side: Side) => {
      if (row < 1 || col < 1 || row > MAX_ROWS || col > MAX_COLS) return;
      const key = cellAddress(row, col);
      // Taking a line away from a cell that isn't there changes nothing.
      if (line === null && !s.cells[key]?.s?.border) return;
      edits.set(key, { ...edits.get(key), [side]: line });
    };
    const top = () => { for (let c = b.c1; c <= b.c2; c++) (put(b.r1, c, "top"), put(b.r1 - 1, c, "bottom")); };
    const bottom = () => { for (let c = b.c1; c <= b.c2; c++) (put(b.r2, c, "bottom"), put(b.r2 + 1, c, "top")); };
    const left = () => { for (let r = b.r1; r <= b.r2; r++) (put(r, b.c1, "left"), put(r, b.c1 - 1, "right")); };
    const right = () => { for (let r = b.r1; r <= b.r2; r++) (put(r, b.c2, "right"), put(r, b.c2 + 1, "left")); };
    const horizontal = () => { for (let r = b.r1; r < b.r2; r++) for (let c = b.c1; c <= b.c2; c++) (put(r, c, "bottom"), put(r + 1, c, "top")); };
    const vertical = () => { for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c < b.c2; c++) (put(r, c, "right"), put(r, c + 1, "left")); };
    // A diagonal belongs to the cell alone: it crosses every cell of the range.
    const diagonal = (side: "diagonalUp" | "diagonalDown") => () => {
      for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) {
        const key = cellAddress(r, c);
        if (line === null && !s.cells[key]?.s?.border) continue;
        edits.set(key, { ...edits.get(key), [side]: line });
      }
    };
    const sides: Record<BorderWhere, (() => void)[]> = {
      all: [top, bottom, left, right, horizontal, vertical],
      none: [top, bottom, left, right, horizontal, vertical, diagonal("diagonalUp"), diagonal("diagonalDown")],
      diagonalUp: [diagonal("diagonalUp")],
      diagonalDown: [diagonal("diagonalDown")],
      outer: [top, bottom, left, right],
      inner: [horizontal, vertical],
      horizontal: [horizontal],
      vertical: [vertical],
      top: [top],
      bottom: [bottom],
      left: [left],
      right: [right],
    };
    for (const draw of sides[where]) draw();
    const cells: Record<string, Cell | null> = {};
    for (const [key, change] of edits) {
      const old = s.cells[key] ?? {};
      const borders: CellBorders = { ...old.s?.border };
      for (const [side, v] of Object.entries(change) as [Side, Border | null][]) {
        if (v === null) delete borders[side];
        else borders[side] = v;
      }
      const style: CellStyle = { ...old.s };
      if (Object.keys(borders).length) style.border = borders;
      else delete style.border;
      const next: Cell = { ...old };
      if (Object.keys(style).length) next.s = style;
      else delete next.s;
      cells[key] = cleanCell(next);
    }
    if (Object.keys(cells).length) this.commit([{ type: "set_cells", sheet: s.id, cells }]);
  }

  /**
   * What the lines on the cells of a range look like: their style and colour when every line is alike, `"mixed"` when they
   * differ (black stands for a line with no colour), or null when the cells have no lines.
   */
  borderLook(sheet: string, range: string): { style: Border["style"] | "mixed"; color: string | "mixed" } | null {
    const s = this.sheet(sheet);
    const lines: Border[] = [];
    for (const key of this.existing(s, this.bounds(range))) for (const line of Object.values(s.cells[key]?.s?.border ?? {})) if (line) lines.push(line);
    if (!lines.length) return null;
    const color = (l: Border) => l.color ?? "#000000";
    return { style: lines.every((l) => l.style === lines[0]!.style) ? lines[0]!.style : "mixed", color: lines.every((l) => color(l) === color(lines[0]!)) ? color(lines[0]!) : "mixed" };
  }

  /**
   * Draws every line already on the cells of a range in one colour (`null` for black), whatever colours and styles they had;
   * the styles stay. The cell next to the range that shares a line with it follows. One undo step.
   */
  colorBorders(sheet: string, range: string, color: string | null): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const next = color === null ? undefined : cleanBorder({ style: "thin", color }).color;
    const sides = ["top", "right", "bottom", "left"] as const;
    const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
    const step = { top: [-1, 0], bottom: [1, 0], left: [0, -1], right: [0, 1] } as const;
    const cells: Record<string, Cell | null> = {};
    const same = (a: Border | undefined, b2: Border) => !!a && a.style === b2.style && (a.color ?? "#000000") === (b2.color ?? "#000000");
    const paint = (key: string, side: keyof CellBorders, line: Border) => {
      const base = cells[key] ?? s.cells[key];
      if (!base) return;
      const border: CellBorders = { ...base.s?.border };
      border[side] = { style: line.style, ...(next ? { color: next } : {}) };
      cells[key] = cleanCell({ ...base, s: { ...base.s, border } });
    };
    for (const key of this.existing(s, b)) {
      const pos = parseCell(key)!;
      const border = s.cells[key]?.s?.border;
      if (!border) continue;
      for (const side of [...sides, "diagonalDown", "diagonalUp"] as const) {
        const line = border[side];
        if (!line) continue;
        paint(key, side, line);
        if (side === "diagonalDown" || side === "diagonalUp") continue;
        const [dr, dc] = step[side];
        const there = cellAddress(pos.row + dr, pos.col + dc);
        if (pos.row + dr >= 1 && pos.col + dc >= 1 && same(s.cells[there]?.s?.border?.[opposite[side]], line)) paint(there, opposite[side], line);
      }
    }
    if (Object.keys(cells).length) this.commit([{ type: "set_cells", sheet: s.id, cells }]);
  }

  // ---- merged cells ----

  /** The merged ranges of a sheet, such as `["B2:D3"]`. */
  merges(sheet: string): readonly string[] {
    return this.sheet(sheet).merges ?? [];
  }

  /** The merged range that has this cell in it (as a range such as `B2:D3`), or null. */
  mergeAt(sheet: string, address: string): string | null {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const m = mergeAt(this.sheet(sheet), pos.row, pos.col);
    return m ? rangeAddress(m) : null;
  }

  /**
   * Merges the cells of a range into one that shows what the top-left cell holds; what the other cells held is emptied.
   * With `across` each row of the range is merged on its own, and with `center` the merged cell is centred (Excel's "Merge
   * and centre"). Merged ranges the new one touches are unmerged first.
   */
  mergeCells(sheet: string, range: string, options: { across?: boolean; center?: boolean } = {}): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const parts: Bounds[] = [];
    if (options.across) for (let r = b.r1; r <= b.r2; r++) parts.push({ r1: r, c1: b.c1, r2: r, c2: b.c2 });
    else parts.push(b);
    const wanted = parts.filter((p) => p.r2 > p.r1 || p.c2 > p.c1);
    if (!wanted.length) return;
    if ((s.tables ?? []).some((t) => wanted.some((p) => overlaps(this.bounds(t.range), p)))) throw new PliError("invalid_operation", "Cells in a table can't be merged, as in Excel");
    const ops: SheetOp[] = [];
    for (const m of mergedRanges(s)) if (wanted.some((p) => overlaps(m, p))) ops.push({ type: "remove_merge", sheet: s.id, range: rangeAddress(m) });
    const emptied: Record<string, Cell | null> = {};
    for (const p of wanted)
      for (const key of this.existing(s, p)) {
        const pos = parseCell(key)!;
        if (pos.row === p.r1 && pos.col === p.c1) continue;
        const cell = s.cells[key]!;
        const { v: _v, e: _e, f: _f, control: _control, link: _link, note: _note, noteRuns: _noteRuns, noteAuthor: _noteAuthor, noteBox: _noteBox, picture: _picture, ...keep } = cell;
        emptied[key] = cleanCell(keep);
      }
    if (options.center) {
      for (const p of wanted) {
        const key = cellAddress(p.r1, p.c1);
        const base = s.cells[key];
        emptied[key] = cleanCell({ ...base, s: { ...base?.s, align: "center" } });
      }
    }
    if (Object.keys(emptied).length) ops.push({ type: "set_cells", sheet: s.id, cells: emptied });
    for (const p of wanted) ops.push({ type: "add_merge", sheet: s.id, range: rangeAddress(p) });
    this.commit(ops);
  }

  /** Unmerges every merged range that has a cell in `range`. */
  unmergeCells(sheet: string, range: string): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const ops: SheetOp[] = mergedRanges(s).filter((m) => overlaps(m, b)).map((m): SheetOp => ({ type: "remove_merge", sheet: s.id, range: rangeAddress(m) }));
    if (ops.length) this.commit(ops);
  }

  // ---- conditional formatting ----

  /** The conditional formats of a sheet, the first having the most say. */
  conditionalFormats(sheet: string): readonly ConditionalRule[] {
    return (this.sheet(sheet).conditional ?? []).filter((r) => r.ranges.length > 0);
  }

  /** Adds a rule and returns it. A new rule has the least say, unless `index` puts it earlier. */
  addRule(sheet: string, spec: RuleSpec, index?: number): ConditionalRule {
    const rule = { ...spec, id: spec.id ?? createId("rule_") } as ConditionalRule;
    if (rule.pivot) rule.ranges = this.#pivotRuleRanges(this.sheet(sheet), rule.pivot);
    this.commit([{ type: "add_rule", sheet: this.sheet(sheet).id, rule, ...(index !== undefined ? { index } : {}) }]);
    return this.conditionalFormats(sheet).find((r) => r.id === rule.id) ?? rule;
  }

  /** Replaces the rule that has this id (the rule must carry the same id). */
  updateRule(sheet: string, rule: ConditionalRule): void {
    if (rule.pivot) rule = { ...rule, ranges: this.#pivotRuleRanges(this.sheet(sheet), rule.pivot) };
    this.commit([{ type: "update_rule", sheet: this.sheet(sheet).id, rule }]);
  }

  deleteRule(sheet: string, id: string): void {
    this.commit([{ type: "delete_rule", sheet: this.sheet(sheet).id, id }]);
  }

  /** The ranges a pivot rule covers now: the cells of its pivot table that its scope picks out. */
  #pivotRuleRanges(s: Sheet, scope: NonNullable<ConditionalRule["pivot"]>): string[] {
    const pivot = s.pivots?.find((p) => p.id === scope.id);
    if (!pivot) throw new PliError("not_found", `No pivot table with id "${scope.id}" on this sheet`);
    const problem = pivotScopeProblem(pivot, scope);
    if (problem) throw new PliError("invalid_operation", problem);
    const src = this.#pivotSource(pivot, s.name) ?? bad(`The source of ${pivot.name} isn't there`);
    return this.#scopedRanges(pivot, renderPivot(pivot, src), scope);
  }

  /**
   * What a rule for the selected cells of a pivot table would follow (Excel's rule for selected cells, as opposed to all cells
   * showing a value): the value they show, the level they are on and the items they are under. Null when the range isn't only
   * value cells of one pivot table. Pass it as `pivot` to `addRule`.
   */
  pivotSelectionScope(sheet: string, range: string): NonNullable<ConditionalRule["pivot"]> | null {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const pivot = pivotAtCell(s, cellAddress(b.r1, b.c1));
    if (!pivot) return null;
    const src = this.#pivotSource(pivot, s.name);
    if (!src) return null;
    const anchor = parseCell(pivot.anchor)!;
    return pivotSelectionScope(pivot, renderPivot(pivot, src), { row: anchor.row, col: anchor.col }, b);
  }

  #scopedRanges(pivot: Pivot, render: PivotRender, scope: NonNullable<ConditionalRule["pivot"]>): string[] {
    const anchor = parseCell(pivot.anchor)!;
    const ranges = pivotScopeProblem(pivot, scope) === null ? pivotScopeRanges(pivot, render, { row: anchor.row, col: anchor.col }, scope) : [];
    return ranges.length ? ranges : [pivotRuleFallback({ row: anchor.row, col: anchor.col })];
  }

  /** The changes that keep the rules of a pivot table on its cells after it is drawn again. */
  #scopedRuleOps(s: Sheet, pivot: Pivot, render: PivotRender): SheetOp[] {
    const ops: SheetOp[] = [];
    for (const rule of s.conditional ?? []) {
      if (rule.pivot?.id !== pivot.id) continue;
      const ranges = this.#scopedRanges(pivot, render, rule.pivot);
      if (ranges.length !== rule.ranges.length || ranges.some((r, i) => r !== rule.ranges[i])) ops.push({ type: "update_rule", sheet: s.id, rule: { ...rule, ranges } as ConditionalRule });
    }
    return ops;
  }

  /** Puts a rule at a place in the order (0 is the first, with the most say). */
  moveRule(sheet: string, id: string, index: number): void {
    const s = this.sheet(sheet);
    const rule = s.conditional?.find((r) => r.id === id);
    if (!rule) throw new PliError("not_found", `No rule with id "${id}"`);
    this.commit([
      { type: "delete_rule", sheet: s.id, id },
      { type: "add_rule", sheet: s.id, rule, index },
    ]);
  }

  /** Takes away the rules on a range: rules that only apply there go, and a rule that applies elsewhere too keeps the rest of its ranges. */
  clearRules(sheet: string, range: string): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const ops: SheetOp[] = [];
    for (const rule of s.conditional ?? []) {
      const kept = rule.ranges.filter((r) => !within(this.bounds(r), b));
      if (kept.length === rule.ranges.length) continue;
      ops.push(kept.length ? { type: "update_rule", sheet: s.id, rule: { ...rule, ranges: kept } as ConditionalRule } : { type: "delete_rule", sheet: s.id, id: rule.id });
    }
    if (ops.length) this.commit(ops);
  }

  /** What the conditional formats do to a cell, or undefined if none applies: the style over its own, a colour from a scale, a bar, an icon. */
  conditionalEffect(sheet: string, address: string): CellEffect | undefined {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    return this.#formats.effect(this.sheet(sheet), pos.row, pos.col);
  }

  // ---- tables ----

  /** The tables on a sheet. */
  tables(sheet: string): readonly Table[] {
    return this.sheet(sheet).tables ?? [];
  }

  /** The table that has this cell in it, if any. */
  tableAt(sheet: string, address: string): Table | undefined {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    return tableAtCell(this.sheet(sheet), pos.row, pos.col)?.table;
  }

  /** The header cells of a table range made into names: text, not empty, all different (`Column1`, and `Name2` for a second `Name`). */
  #headerNames(s: Sheet, b: Bounds): Record<string, Cell> {
    const fixes: Record<string, Cell> = {};
    const taken: string[] = [];
    for (let c = b.c1; c <= b.c2; c++) {
      const key = cellAddress(b.r1, c);
      const cell = s.cells[key];
      const v = this.calculator.value(s.id, key);
      let name = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
      if (name === "") name = freshColumnName(taken, c - b.c1 + 1);
      for (let k = 2; taken.some((t) => t.toLowerCase() === name.toLowerCase()); k++) name = `${typeof v === "string" ? v : name.replace(/\d+$/, "")}${k}`;
      taken.push(name);
      if (cell?.v !== name || cell.f !== undefined) {
        const { f: _f, e: _e, ...rest } = cell ?? {};
        fixes[key] = { ...rest, v: name };
      }
    }
    return fixes;
  }

  /**
   * Makes a table of the cells in `range`, whose first row becomes the column names (empty or repeated ones are given
   * names such as `Column2`). A single cell stands for the block of data around it. With `header: false` the cells are all
   * data: a row is put in above them for the names.
   */
  createTable(sheet: string, range: string, options: { name?: string; style?: string; id?: string; header?: boolean } = {}): Table {
    const s = this.sheet(sheet);
    let b = this.bounds(range);
    if (b.r1 === b.r2 && b.c1 === b.c2) b = this.bounds(this.currentRegion(sheet, cellAddress(b.r1, b.c1)));
    if (b.r2 === b.r1) b = { ...b, r2: b.r1 + 1 };
    let name = options.name;
    if (name === undefined) {
      const used = new Set(allTables(this.state).map((t) => t.table.name.toLowerCase()));
      let n = 1;
      while (used.has(`table${n}`) || Object.keys(this.state.names ?? {}).some((x) => x.toLowerCase() === `table${n}`)) n++;
      name = `Table${n}`;
    }
    if (options.header === false) {
      const headers: Record<string, Cell> = {};
      for (let c = b.c1; c <= b.c2; c++) headers[cellAddress(b.r1, c)] = { v: `Column${c - b.c1 + 1}` };
      const table: Table = { id: options.id ?? createId("table_"), name, range: rangeAddress({ ...b, r2: b.r2 + 1 }), ...(options.style ? { style: options.style } : {}) };
      this.commit([{ type: "insert_rows", sheet: s.id, at: b.r1, count: 1 }, { type: "set_cells", sheet: s.id, cells: headers }, { type: "add_table", sheet: s.id, table }]);
      return this.tables(sheet).find((t) => t.id === table.id)!;
    }
    const table: Table = { id: options.id ?? createId("table_"), name, range: rangeAddress(b), ...(options.style ? { style: options.style } : {}) };
    const fixes = this.#headerNames(s, b);
    this.commit([...(Object.keys(fixes).length ? [{ type: "set_cells" as const, sheet: s.id, cells: fixes }] : []), { type: "add_table", sheet: s.id, table }]);
    return this.tables(sheet).find((t) => t.id === table.id)!;
  }

  private tableNamed(name: string): { sheet: Sheet; table: Table; bounds: Bounds } {
    const found = findTable(this.state, name);
    if (!found) throw new PliError("not_found", `No table called "${name}"`);
    return found;
  }

  /** Gives a table another range (a new column's header is named `ColumnN`). */
  resizeTable(name: string, range: string): void {
    const { sheet: s, table } = this.tableNamed(name);
    const b = this.bounds(range);
    const fixes = hasHeader(table) ? this.#headerNames(s, b) : {};
    this.commit([...(Object.keys(fixes).length ? [{ type: "set_cells" as const, sheet: s.id, cells: fixes }] : []), { type: "update_table", sheet: s.id, table: { ...table, range: rangeAddress(b) } }]);
  }

  /** Renames a table; formulas that name it follow. */
  renameTable(name: string, to: string): void {
    const { sheet: s, table } = this.tableNamed(name);
    if (table.name === to) return;
    if (s.protection) throw new ProtectionError("A table can't be changed while the sheet is protected. Unprotect the sheet first (you may be asked for a password).");
    const { state } = sheetReducer.apply(this.state, { type: "update_table", sheet: s.id, table: { ...table, name: to } });
    this.commit([{ type: "restore", workbook: renameTableInFormulas(state, name, to) }]);
  }

  /** Changes how a table looks: its style (`TableStyleMedium2`, `none`…), banded rows and columns, bold first and last columns. */
  setTableOptions(name: string, options: { style?: string | null; bandedRows?: boolean; bandedColumns?: boolean; firstColumn?: boolean; lastColumn?: boolean }): void {
    const { sheet: s, table } = this.tableNamed(name);
    const next: Table = { ...table };
    if (options.style !== undefined) {
      if (options.style === null) delete next.style;
      else next.style = options.style;
    }
    if (options.bandedRows !== undefined) {
      if (options.bandedRows) delete next.bandedRows;
      else next.bandedRows = false;
    }
    for (const k of ["bandedColumns", "firstColumn", "lastColumn"] as const) {
      if (options[k] === undefined) continue;
      if (options[k]) next[k] = true;
      else delete next[k];
    }
    this.commit([{ type: "update_table", sheet: s.id, table: next }]);
  }

  /** Adds a row of totals under the table (`Total`, and the sum of the last column when it holds numbers), or takes it away. */
  setTableTotals(name: string, on: boolean): void {
    const { sheet: s, table, bounds: b } = this.tableNamed(name);
    if (!!table.totals === on) return;
    if (on) {
      const names = tableColumns(s, b, table);
      const last = names[names.length - 1]!;
      const [top, bottom] = dataRows(table, b);
      let numbers = 0;
      for (let r = top; r <= bottom; r++) if (typeof this.calculator.value(s.id, cellAddress(r, b.c2)) === "number") numbers++;
      const cells: Record<string, Cell | null> = { [cellAddress(b.r2 + 1, b.c1)]: { v: "Total" } };
      if (names.length > 1 && numbers > 0) cells[cellAddress(b.r2 + 1, b.c2)] = { f: `SUBTOTAL(109,${table.name}[${last.replace(/(['[\]#@])/g, "'$1")}])` };
      this.commit([
        { type: "insert_rows", sheet: s.id, at: b.r2 + 1, count: 1 },
        { type: "update_table", sheet: s.id, table: { ...table, range: rangeAddress({ ...b, r2: b.r2 + 1 }), totals: true } },
        { type: "set_cells", sheet: s.id, cells },
      ]);
    } else {
      this.commit([
        { type: "update_table", sheet: s.id, table: (({ totals: _t, ...rest }) => ({ ...rest, range: rangeAddress({ ...b, r2: b.r2 - 1 }) }))(table) },
        { type: "delete_rows", sheet: s.id, at: b.r2, count: 1 },
      ]);
    }
  }

  /** What has to go when a table stops being one: the slicers on it, and the hiding its filters did. */
  #releaseTable(s: Sheet, table: Table, bounds: Bounds): SheetOp[] {
    const ops: SheetOp[] = [];
    for (const sheet of this.state.sheets) for (const slicer of sheet.slicers ?? []) if (slicer.table === table.id) ops.push({ type: "delete_slicer", sheet: sheet.id, id: slicer.id });
    for (const sheet of this.state.sheets) for (const timeline of sheet.timelines ?? []) if (timeline.table === table.id) ops.push({ type: "delete_timeline", sheet: sheet.id, id: timeline.id });
    if (table.filters) {
      const [top, bottom] = dataRows(table, bounds);
      ops.push(...this.#rowsOps(s, top, bottom, s.filter, (s.tables ?? []).filter((t) => t.id !== table.id)));
    }
    return ops;
  }

  /** Stops a table being one and leaves its cells as they are; formulas that named it get plain ranges. */
  convertToRange(name: string): void {
    const { sheet: s, table, bounds } = this.tableNamed(name);
    const converted = tableRefsToRanges(this.state, name);
    const { state } = sheetReducer.apply(converted, { type: "delete_table", sheet: s.id, id: table.id });
    this.commit([{ type: "restore", workbook: state }, ...this.#releaseTable(s, table, bounds)]);
  }

  /**
   * Sets what a column of a table's totals row works out, as Excel's dropdown in that row does: `"sum"`, `"average"`, `"count"`,
   * `"countNums"`, `"max"`, `"min"`, `"stdDev"`, `"var"` (also `"product"`, `"stdDevp"` and `"varp"`) as `SUBTOTAL(101…111, Table[Column])`,
   * which leaves out the rows the table's filter or you hid, `"none"` for an empty cell, or a formula (`"=SUM(Orders[Qty])/2"`) for anything else.
   */
  setTableTotalsFunction(name: string, column: string | number, fn: SubtotalFunction | "none" | `=${string}`): void {
    const { sheet: s, table, bounds: b } = this.tableNamed(name);
    if (!table.totals) throw new PliError("invalid_operation", `The table "${table.name}" has no totals row`);
    const col = this.columnOf({ sheet: s, table, bounds: b }, column);
    const at = tableColumns(s, b, table).indexOf(col) + b.c1;
    const address = cellAddress(b.r2, at);
    const old = s.cells[address];
    let cell: Cell | null;
    if (fn === "none") cell = old?.s || old?.fmt ? { ...(old.s ? { s: old.s } : {}), ...(old.fmt ? { fmt: old.fmt } : {}) } : null;
    else if (typeof fn === "string" && fn.startsWith("=")) cell = { ...(old?.s ? { s: old.s } : {}), ...(old?.fmt ? { fmt: old.fmt } : {}), f: fn.slice(1) };
    else {
      if (!SUBTOTAL_FUNCTIONS.includes(fn as SubtotalFunction)) throw new PliError("invalid_operation", `A totals row works out one of ${SUBTOTAL_FUNCTIONS.join(", ")} or none, or takes a formula`);
      cell = { ...(old?.s ? { s: old.s } : {}), ...(old?.fmt ? { fmt: old.fmt } : {}), f: `SUBTOTAL(${100 + SUBTOTAL_CODES[fn as SubtotalFunction]},${table.name}[${col.replace(/(['[\]#@])/g, "'$1")}])` };
    }
    this.commit([{ type: "set_cells", sheet: s.id, cells: { [address]: cell } }]);
  }

  /** What each column of a table's totals row works out: a function name, `"custom"` for another formula, `"label"` for text, or null for an empty cell. */
  tableTotals(name: string): Record<string, SubtotalFunction | "custom" | "label" | null> {
    const { sheet: s, table, bounds: b } = this.tableNamed(name);
    if (!table.totals) throw new PliError("invalid_operation", `The table "${table.name}" has no totals row`);
    const out: Record<string, SubtotalFunction | "custom" | "label" | null> = {};
    tableColumns(s, b, table).forEach((col, i) => {
      const cell = s.cells[cellAddress(b.r2, b.c1 + i)];
      const m = cell?.f === undefined ? null : /^\s*SUBTOTAL\(\s*(\d+)\s*,/i.exec(cell.f);
      const fn = m ? (Object.entries(SUBTOTAL_CODES).find(([, code]) => code === Number(m[1]) % 100)?.[0] as SubtotalFunction | undefined) : undefined;
      out[col] = cell?.f !== undefined ? (fn && Number(m![1]) > 100 ? fn : "custom") : typeof cell?.v === "string" ? "label" : null;
    });
    return out;
  }

  /** Deletes a table with the cells it covers. */
  deleteTable(name: string): void {
    const { sheet: s, table, bounds: b } = this.tableNamed(name);
    const cells: Record<string, Cell | null> = {};
    for (const key of this.existing(s, b)) cells[key] = null;
    this.commit([...this.#releaseTable(s, table, b), { type: "delete_table", sheet: s.id, id: table.id }, ...(Object.keys(cells).length ? [{ type: "set_cells" as const, sheet: s.id, cells }] : [])]);
  }

  // ---- table filters, sorting, and the parts around them ----

  private tableOf(table: string | Table): { sheet: Sheet; table: Table; bounds: Bounds } {
    if (typeof table !== "string") {
      const found = allTables(this.state).find((t) => t.table.id === table.id);
      if (found) return found;
    } else {
      const found = findTable(this.state, table) ?? allTables(this.state).find((t) => t.table.id === table);
      if (found) return found;
    }
    throw new PliError("not_found", `No table called "${typeof table === "string" ? table : table.name}"`);
  }

  /** The column names of a table (the text of its header cells, or the names kept for one with no header row). */
  tableColumnNames(table: string | Table): string[] {
    const entry = this.tableOf(table);
    return tableColumns(entry.sheet, entry.bounds, entry.table);
  }

  private columnOf(entry: { sheet: Sheet; table: Table; bounds: Bounds }, column: string | number): string {
    const names = tableColumns(entry.sheet, entry.bounds, entry.table);
    const name = typeof column === "number" ? names[column - entry.bounds.c1] : names.find((n) => n.toLowerCase() === column.toLowerCase());
    if (name === undefined) throw new PliError("out_of_range", `"${column}" isn't a column of the table "${entry.table.name}"`);
    return name;
  }

  private filterable(entry: { table: Table }): void {
    if (!hasHeader(entry.table)) throw new PliError("invalid_operation", "A table with no header row can't be filtered or sorted");
  }

  /** Hides and shows the rows from `from` to `to` as the filters in force say. */
  #rowsOps(s: Sheet, from: number, to: number, sheetFilter: SheetFilter | undefined, tables: readonly Table[]): SheetOp[] {
    const ops: SheetOp[] = [];
    const hides = this.#filterPlan(s, sheetFilter, tables);
    for (let row = from; row <= to; row++) {
      const hide = hides(row);
      const hidden = !!s.rows?.[String(row)]?.hidden;
      if (hide && !hidden) ops.push({ type: "set_size", sheet: s.id, axis: "row", index: row, hidden: true });
      else if (!hide && hidden) ops.push({ type: "set_size", sheet: s.id, axis: "row", index: row, hidden: null });
    }
    return ops;
  }

  /** The operations that put a table in place of the one with its id, and hide and show its rows as its filters say. */
  #tableFilterOps(s: Sheet, next: Table): SheetOp[] {
    const tables = (s.tables ?? []).map((t) => (t.id === next.id ? next : t));
    const [top, bottom] = dataRows(next, parseRange(next.range)!);
    return [{ type: "update_table", sheet: s.id, table: next }, ...this.#rowsOps(s, top, bottom, s.filter, tables)];
  }

  /** The different values in a column of a table below the heading, as the cells show them, with how many rows have each. */
  tableFilterValues(table: string, column: string | number): { value: string; count: number }[] {
    const entry = this.tableOf(table);
    this.filterable(entry);
    const at = tableColumns(entry.sheet, entry.bounds, entry.table).indexOf(this.columnOf(entry, column));
    const [top, bottom] = dataRows(entry.table, entry.bounds);
    const counts = new Map<string, number>();
    for (let row = top; row <= bottom; row++) {
      const t = this.shownText(entry.sheet.id, row, entry.bounds.c1 + at);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => compareValues(a.value, b.value));
  }

  /**
   * Lets only these values through in a column of a table (as the cells show them), or all of them with `null`, and hides
   * the rows that no longer match. One undo step.
   */
  filterTable(table: string, column: string | number, allowed: readonly string[] | null): void {
    this.#setTableFilter(table, column, allowed === null ? null : [...allowed]);
  }

  /** Filters a column of a table by a rule (see `filterColumnRule`) instead of a list of values, or lets everything through again with `null`. */
  filterTableRule(table: string, column: string | number, rule: FilterRule | null): void {
    this.#setTableFilter(table, column, rule === null ? null : cleanFilterRule(rule));
  }

  #setTableFilter(table: string, column: string | number, criterion: FilterCriterion | null): void {
    const entry = this.tableOf(table);
    this.filterable(entry);
    const name = this.columnOf(entry, column);
    const filters = { ...entry.table.filters };
    if (criterion === null) delete filters[name];
    else filters[name] = criterion;
    const next: Table = { ...entry.table };
    if (Object.keys(filters).length) next.filters = filters;
    else delete next.filters;
    this.commit(this.#tableFilterOps(entry.sheet, next));
  }

  /** Lets every row of a table through again. */
  clearTableFilters(table: string): void {
    const entry = this.tableOf(table);
    if (!entry.table.filters) return;
    const { filters: _gone, ...rest } = entry.table;
    this.commit(this.#tableFilterOps(entry.sheet, rest));
  }

  /** Hides and shows a table's rows again as its filters say, for after the cells in it have changed. */
  reapplyTableFilter(table: string): void {
    const entry = this.tableOf(table);
    const ops = this.#tableFilterOps(entry.sheet, entry.table).slice(1);
    if (ops.length) this.commit(ops);
  }

  /** Shows or hides the filter buttons in a table's header row. Hiding them lets every row through. */
  setTableFilterButtons(table: string, on: boolean): void {
    const entry = this.tableOf(table);
    this.filterable(entry);
    if ((entry.table.filterButtons !== false) === on) return;
    const next: Table = { ...entry.table };
    if (on) delete next.filterButtons;
    else {
      next.filterButtons = false;
      delete next.filters;
    }
    this.commit(this.#tableFilterOps(entry.sheet, next));
  }

  /**
   * Sorts the data rows of a table by a column (the totals row stays where it is) and remembers the sort, which the
   * column's filter button shows. `null` takes the mark off and leaves the rows as they are. The rows that the table's
   * filters hide are hidden again after the sort. One undo step.
   */
  sortTable(table: string, column: string | number, direction: "ascending" | "descending" | null = "ascending"): void {
    const entry = this.tableOf(table);
    this.filterable(entry);
    const name = this.columnOf(entry, column);
    if (direction === null) {
      if (!entry.table.sort) return;
      const { sort: _gone, ...rest } = entry.table;
      this.commit([{ type: "update_table", sheet: entry.sheet.id, table: rest }]);
      return;
    }
    this.sortTableBy(table, [{ column: name, ...(direction === "descending" ? { descending: true as const } : {}) }]);
  }

  /**
   * Sorts the data rows of a table by several levels, as Excel's Sort dialog does, and remembers them (`table.sort`: the
   * first level, and the rest in `then`). Each level is a column of the table and what it orders by: its values (`descending`
   * is Z to A), or a colour or an icon to put on top (`descending` puts it at the bottom): `{ column, by: "cellColor", color:
   * "#ffc7ce" }`, `{ column, by: "fontColor", color: "#9c0006" }` or `{ column, by: "icon", icon: { set: "3Arrows", index: 2 } }`
   * (`color: "none"` and `"auto"`, and `icon: null`, are the cells with no fill, the default font colour and no icon). Rows
   * no level tells apart keep their order. The totals row stays where it is and the rows the filters hide are hidden again.
   * One undo step.
   */
  sortTableBy(table: string, levels: readonly SortLevel[]): void {
    const entry = this.tableOf(table);
    this.filterable(entry);
    const { sheet: s, bounds: b } = entry;
    const names = tableColumns(s, b, entry.table);
    const clean = cleanSortLevels(levels.map((l) => ({ ...l, column: this.columnOf(entry, l.column) })));
    const [top, bottom] = dataRows(entry.table, b);
    const cells = this.#sorted(s, { ...b, r1: top, r2: bottom }, { levels: clean.map((l): RangeSortLevel => ({ column: names.indexOf(l.column) + 1, ...(l.descending ? { descending: true as const } : {}), ...(l.by ? { by: l.by } : {}), ...(l.color !== undefined ? { color: l.color } : {}), ...(l.icon !== undefined ? { icon: l.icon } : {}) })) });
    this.commit([
      { type: "set_cells", sheet: s.id, cells },
      { type: "update_table", sheet: s.id, table: { ...entry.table, sort: tableSortOf(clean)! } },
    ], { vet: { action: "sort", whole: true, samePlace: true, sheet: s.id, bounds: { ...b, r1: top, r2: bottom } } });
    const again = this.#rowsOps(this.sheet(s.id), top, bottom, this.sheet(s.id).filter, this.sheet(s.id).tables ?? []);
    if (again.length) this.commit(again, { merge: true });
  }

  /** The text of a row's cells in some columns, as a key that equal rows share (capitals don't count, as in Excel's Remove Duplicates). */
  #rowKey(sheetId: string, row: number, cols: readonly number[]): string {
    return JSON.stringify(cols.map((c) => this.shownText(sheetId, row, c).toLowerCase()));
  }

  /** The rows (first to last) of which an earlier row has the same text in the columns. */
  #duplicateRows(sheetId: string, first: number, last: number, cols: readonly number[]): number[] {
    const seen = new Set<string>();
    const out: number[] = [];
    for (let row = first; row <= last; row++) {
      const key = this.#rowKey(sheetId, row, cols);
      if (seen.has(key)) out.push(row);
      else seen.add(key);
    }
    return out;
  }

  /**
   * Removes the rows of a table that repeat an earlier row in the columns given (all the columns by default; names or
   * numbers as `tableFilterValues` takes them), keeping the first of each, as Excel's Remove Duplicates does. Capitals don't
   * matter; the cells are compared as they show. The rows are deleted, so the table gets shorter and what is below moves up;
   * it is refused when a row to remove has cells beside the table, which would be lost. Returns how many rows went. One undo step.
   */
  removeTableDuplicates(table: string, columns?: readonly (string | number)[]): number {
    const entry = this.tableOf(table);
    const { sheet: s, bounds: b } = entry;
    const names = tableColumns(s, b, entry.table);
    const cols = (columns ?? names).map((c) => b.c1 + names.indexOf(this.columnOf(entry, c)));
    if (!cols.length) throw new PliError("invalid_operation", "Remove duplicates needs at least one column to compare");
    const [top, bottom] = dataRows(entry.table, b);
    const dup = this.#duplicateRows(s.id, top, bottom, cols);
    if (!dup.length) return 0;
    const gone = new Set(dup);
    for (const [address, cell] of Object.entries(s.cells)) {
      const pos = parseCell(address);
      if (pos && gone.has(pos.row) && (pos.col < b.c1 || pos.col > b.c2) && (cell.v !== undefined || cell.f !== undefined || cell.e !== undefined)) throw new PliError("invalid_operation", "Rows with other data beside the table can't be removed; move that data first");
    }
    // Runs of rows go together, from the bottom so the numbers above stay right.
    const runs: [number, number][] = [];
    for (const row of dup) {
      const last = runs[runs.length - 1];
      if (last && last[1] === row - 1) last[1] = row;
      else runs.push([row, row]);
    }
    this.commit(runs.reverse().map(([from, to]): SheetOp => ({ type: "delete_rows", sheet: s.id, at: from, count: to - from + 1 })));
    return dup.length;
  }

  /**
   * Removes the rows of a range that repeat an earlier row in the columns given (numbers within the range, 1 is its first;
   * all by default), keeping the first of each. The rows below move up inside the range and the last rows are left empty, as
   * Excel's Remove Duplicates does on a range that isn't a table. Returns how many rows were removed. One undo step.
   */
  removeDuplicates(sheet: string, range: string, options: { columns?: readonly number[]; header?: boolean } = {}): number {
    const s = this.sheet(sheet);
    this.#permit(s, "sort");
    const b = this.bounds(range);
    if (mergedRanges(s).some((m) => overlaps(m, b))) throw new PliError("invalid_operation", "Cells that are merged can't be compared; unmerge them first");
    const first = options.header ? b.r1 + 1 : b.r1;
    const cols = (options.columns ?? Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => i + 1)).map((c) => {
      if (!Number.isInteger(c) || c < 1 || b.c1 + c - 1 > b.c2) throw new PliError("out_of_range", "That column is outside the range");
      return b.c1 + c - 1;
    });
    if (!cols.length) throw new PliError("invalid_operation", "Remove duplicates needs at least one column to compare");
    const dup = new Set(this.#duplicateRows(s.id, first, b.r2, cols));
    if (!dup.size) return 0;
    const cells: Record<string, Cell | null> = {};
    let to = first;
    for (let row = first; row <= b.r2; row++) {
      if (dup.has(row)) continue;
      for (let c = b.c1; c <= b.c2; c++) {
        const cell = s.cells[cellAddress(row, c)];
        cells[cellAddress(to, c)] = cell ? (cell.f !== undefined && to !== row ? { ...cell, f: shiftFormula(cell.f, to - row, 0) } : cell) : null;
      }
      to++;
    }
    for (; to <= b.r2; to++) for (let c = b.c1; c <= b.c2; c++) cells[cellAddress(to, c)] = null;
    this.commit([{ type: "set_cells", sheet: s.id, cells }]);
    return dup.size;
  }

  /** The levels of a table's sort, first level first (empty when it hasn't been sorted from the header). */
  tableSort(table: string): SortLevel[] {
    return sortLevels(this.tableOf(table).table.sort);
  }

  /**
   * What a column can be sorted by besides its values: the fill and font colours the cells show and the icons conditional
   * formats put in them (`"none"` and `"auto"` stand for no fill and the default font colour; the icon is `null` for cells with
   * no icon). Conditional formats count, as in Excel.
   */
  sortChoices(sheet: string, range: string, column: number, options: { header?: boolean } = {}): { fills: string[]; fonts: string[]; icons: (IconRef | null)[] } {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    if (column < 1 || b.c1 + column - 1 > b.c2) throw new PliError("out_of_range", "That column is outside the range");
    return this.#sortChoicesIn(s, b.c1 + column - 1, options.header ? b.r1 + 1 : b.r1, b.r2);
  }

  /** The same for a column of a table. */
  tableSortChoices(table: string, column: string | number): { fills: string[]; fonts: string[]; icons: (IconRef | null)[] } {
    const entry = this.tableOf(table);
    this.filterable(entry);
    const at = tableColumns(entry.sheet, entry.bounds, entry.table).indexOf(this.columnOf(entry, column));
    const [top, bottom] = dataRows(entry.table, entry.bounds);
    return this.#sortChoicesIn(entry.sheet, entry.bounds.c1 + at, top, bottom);
  }

  #sortChoicesIn(s: Sheet, col: number, top: number, bottom: number): { fills: string[]; fonts: string[]; icons: (IconRef | null)[] } {
    const fills = new Set<string>();
    const fonts = new Set<string>();
    const icons = new Map<string, IconRef | null>();
    for (let row = top; row <= bottom; row++) {
      const c = this.#sortCell(s, row, col);
      fills.add(c.fill);
      fonts.add(c.font);
      icons.set(c.icon ? `${c.icon.set}:${c.icon.index}` : "", c.icon);
    }
    const order = (set: Set<string>, plain: string) => [...set].sort((a, b) => (a === plain ? -1 : b === plain ? 1 : a < b ? -1 : 1));
    return { fills: order(fills, "none"), fonts: order(fonts, "auto"), icons: [...icons.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0] < b[0] ? -1 : 1)).map(([, v]) => v) };
  }

  // ---- calculated columns that don't follow the formula ----

  /** The formula the column of a calculated column has in this row, as it should read; null when the cell isn't in a calculated column. */
  #columnFormula(s: Sheet, row: number, col: number): { entry: { table: Table; bounds: Bounds }; name: string; expected: string } | null {
    const entry = tableAtCell(s, row, col);
    if (!entry?.table.calculated) return null;
    const [top, bottom] = dataRows(entry.table, entry.bounds);
    if (row < top || row > bottom) return null;
    const name = tableColumns(s, entry.bounds, entry.table)[col - entry.bounds.c1]!;
    const stored = entry.table.calculated[name];
    if (stored === undefined) return null;
    let expected = stored;
    try {
      expected = shiftFormula(stored, row - top, 0);
    } catch {
      // an unreadable formula is compared as it is
    }
    return { entry, name, expected };
  }

  /** Whether this cell in a calculated column holds something other than the column's formula (a constant, or another formula). */
  calculatedException(sheet: string, address: string): "formula" | "value" | null {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const s = this.sheet(sheet);
    const cell = s.cells[cellAddress(pos.row, pos.col)];
    if (!cell || (cell.v === undefined && cell.e === undefined && cell.f === undefined)) return null;
    const hit = this.#columnFormula(s, pos.row, pos.col);
    if (!hit) return null;
    if (cell.f === undefined) return "value";
    if (cell.f === hit.expected) return null;
    try {
      return printFormula(parseFormula(cell.f)) === printFormula(parseFormula(hit.expected)) ? null : "formula";
    } catch {
      return "formula";
    }
  }

  /** The cells of the calculated columns of a sheet that don't hold their column's formula. */
  calculatedExceptions(sheet: string): { table: string; column: string; address: string; kind: "formula" | "value" }[] {
    const s = this.sheet(sheet);
    const out: { table: string; column: string; address: string; kind: "formula" | "value" }[] = [];
    for (const table of s.tables ?? []) {
      if (!table.calculated) continue;
      const b = parseRange(table.range)!;
      const [top, bottom] = dataRows(table, b);
      const names = tableColumns(s, b, table);
      names.forEach((column, i) => {
        if (table.calculated![column] === undefined) return;
        for (let r = top; r <= bottom; r++) {
          const address = cellAddress(r, b.c1 + i);
          const kind = this.calculatedException(sheet, address);
          if (kind) out.push({ table: table.name, column, address, kind });
        }
      });
    }
    return out;
  }

  /** Puts the column's formula back in the cells of a range that hold something else. Returns how many cells it changed. */
  restoreCalculated(sheet: string, range: string): number {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const cells: Record<string, Cell | null> = {};
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        const address = cellAddress(r, c);
        if (!this.calculatedException(sheet, address)) continue;
        const hit = this.#columnFormula(s, r, c)!;
        const { v: _v, e: _e, f: _f, ...rest } = s.cells[address] ?? {};
        cells[address] = { ...rest, f: hit.expected };
      }
    if (Object.keys(cells).length) this.commit([{ type: "set_cells", sheet: s.id, cells }]);
    return Object.keys(cells).length;
  }

  /** Makes the formula in this cell the formula of its whole column, as typing it into the cell does. */
  useAsCalculated(sheet: string, address: string): void {
    const cell = this.cell(sheet, address);
    if (cell?.f === undefined) throw new PliError("invalid_operation", "That cell has no formula to use for the column");
    const pos = parseCell(address)!;
    const s = this.sheet(sheet);
    const entry = tableAtCell(s, pos.row, pos.col);
    if (!entry || !dataRows(entry.table, entry.bounds).every((r, i) => (i === 0 ? pos.row >= r : pos.row <= r))) throw new PliError("invalid_operation", "That cell isn't in the data of a table");
    this.setCells(sheet, { [address]: "=" + cell.f });
  }

  // ---- a table's header row ----

  /**
   * Shows or hides a table's header row. Without one the column names are kept, the filter buttons and slicers go, and the
   * header cells are emptied; with one again the names are written back into a row above the table (a new row is put in
   * when the one above isn't empty).
   */
  setTableHeader(name: string, on: boolean): void {
    const entry = this.tableNamed(name);
    const { sheet: s, table, bounds: b } = entry;
    if (hasHeader(table) === on) return;
    if (!on) {
      const names = tableColumns(s, b, table);
      const next: Table = { ...table, headerRow: false, columns: names, range: rangeAddress({ ...b, r1: b.r1 + 1 }) };
      delete next.filters;
      delete next.sort;
      delete next.filterButtons;
      const cells: Record<string, Cell | null> = {};
      for (let c = b.c1; c <= b.c2; c++) cells[cellAddress(b.r1, c)] = null;
      const [top, bottom] = dataRows(table, b);
      const ops: SheetOp[] = [];
      if (table.filters) ops.push(...this.#rowsOps(s, top, bottom, s.filter, (s.tables ?? []).map((t) => (t.id === table.id ? { ...t, filters: undefined } as Table : t))));
      for (const sheet of this.state.sheets) for (const slicer of sheet.slicers ?? []) if (slicer.table === table.id) ops.push({ type: "delete_slicer", sheet: sheet.id, id: slicer.id });
      for (const sheet of this.state.sheets) for (const timeline of sheet.timelines ?? []) if (timeline.table === table.id) ops.push({ type: "delete_timeline", sheet: sheet.id, id: timeline.id });
      ops.push({ type: "update_table", sheet: s.id, table: next }, { type: "set_cells", sheet: s.id, cells });
      this.commit(ops);
      return;
    }
    const names = tableColumns(s, b, table);
    let free = b.r1 > 1;
    for (let c = b.c1; c <= b.c2 && free; c++) {
      const above = s.cells[cellAddress(b.r1 - 1, c)];
      if (above && (above.v !== undefined || above.f !== undefined || above.e !== undefined)) free = false;
    }
    const headerAt = free ? b.r1 - 1 : b.r1;
    const range = rangeAddress({ ...b, r1: headerAt, r2: free ? b.r2 : b.r2 + 1 });
    const next: Table = { ...table, range };
    delete next.headerRow;
    delete next.columns;
    const cells: Record<string, Cell | null> = {};
    names.forEach((n, i) => (cells[cellAddress(headerAt, b.c1 + i)] = { ...(free ? s.cells[cellAddress(headerAt, b.c1 + i)] : undefined), v: n }));
    const ops: SheetOp[] = free ? [] : [{ type: "insert_rows", sheet: s.id, at: b.r1, count: 1 }];
    // An inserted row pushes the table down, so it has to be told its range after that; the names go in first, as a table needs them.
    ops.push({ type: "set_cells", sheet: s.id, cells }, { type: "update_table", sheet: s.id, table: next });
    this.commit(ops);
  }

  // ---- slicers ----

  /** The slicers on a sheet, bottom to top. */
  slicers(sheet: string): readonly Slicer[] {
    return (this.sheet(sheet).slicers ?? []).filter((x) => !isOrphanPanel(this.state, x));
  }

  /** Puts a slicer on a sheet and returns it. `table` is a table's name or id; it sits just right of the table unless `from` says where. */
  addSlicer(sheet: string, spec: { table: string; column: string; caption?: string; from?: Slicer["from"]; width?: number; height?: number; style?: string; columns?: number; id?: string }): Slicer {
    const s = this.sheet(sheet);
    const entry = this.tableOf(spec.table);
    this.filterable(entry);
    const column = this.columnOf(entry, spec.column);
    const slicer: Slicer = {
      id: spec.id ?? createId("slicer_"),
      table: entry.table.id,
      column,
      from: spec.from ?? { row: entry.bounds.r1, col: entry.sheet.id === s.id ? entry.bounds.c2 + 2 : 1 },
      width: spec.width ?? DEFAULT_SLICER_WIDTH,
      height: spec.height ?? DEFAULT_SLICER_HEIGHT,
      ...(spec.caption ? { caption: spec.caption } : {}),
      ...(spec.style ? { style: spec.style } : {}),
      ...(spec.columns ? { columns: spec.columns } : {}),
    };
    this.commit([{ type: "add_slicer", sheet: s.id, slicer }]);
    return this.slicers(sheet).find((x) => x.id === slicer.id)!;
  }

  /** Replaces the slicer that has this id (to move or resize it, or to change its heading or style). */
  updateSlicer(sheet: string, slicer: Slicer): void {
    const held = this.#pivotHolding(slicer.id);
    if (held) {
      // A timeline keeps its level and dates; the grid only moves and resizes it.
      const was = held.pivot.timelines?.find((x) => x.id === slicer.id);
      return this.updatePivotPanel(slicer.id, was ? { ...was, from: { ...slicer.from }, width: slicer.width, height: slicer.height, ...(slicer.caption ? { caption: slicer.caption } : {}) } : pivotPanelOfSlicer(slicer));
    }
    this.commit([{ type: "update_slicer", sheet: this.sheet(sheet).id, slicer }]);
  }

  deleteSlicer(sheet: string, id: string): void {
    if (this.#pivotHolding(id)) return this.deletePivotPanel(id);
    this.commit([{ type: "delete_slicer", sheet: this.sheet(sheet).id, id }]);
  }

  private slicerNamed(id: string): { sheet: Sheet; slicer: Slicer; entry: { sheet: Sheet; table: Table; bounds: Bounds } } {
    for (const sheet of this.state.sheets) {
      const slicer = sheet.slicers?.find((x) => x.id === id);
      if (slicer) return { sheet, slicer, entry: this.tableOf(slicer.table) };
    }
    throw new PliError("not_found", `No slicer with id "${id}"`);
  }

  /**
   * The buttons of a slicer: each value in the column as the cells show it, whether the table lets it through
   * (`selected`), how many rows have it, and whether any of those rows pass the table's other filters (`available`; a
   * slicer draws the others dimmed).
   */
  slicerItems(id: string): PivotSlicerItem[] {
    if (this.#pivotHolding(id)) return this.pivotSlicerItems(id);
    const { slicer, entry } = this.slicerNamed(id);
    const names = tableColumns(entry.sheet, entry.bounds, entry.table);
    const at = names.indexOf(slicer.column);
    if (at < 0) return [];
    const [top, bottom] = dataRows(entry.table, entry.bounds);
    const filters = entry.table.filters ?? {};
    // A slicer shows a list of values; a column filtered by a rule counts as letting everything through.
    const chosen = filters[slicer.column];
    const allowed = Array.isArray(chosen) ? chosen : undefined;
    const today = Math.floor(this.calculator.now());
    const others = Object.entries(filters)
      .filter(([name]) => name !== slicer.column && names.includes(name))
      .map(([name, criterion]) => {
        const col = entry.bounds.c1 + names.indexOf(name);
        const population: FilterCell[] = [];
        if (!Array.isArray(criterion) && (criterion.kind === "top" || criterion.kind === "average")) for (let row = top; row <= bottom; row++) population.push(this.#filterCell(entry.sheet, row, col));
        return { col, test: criterionTest(criterion, population, today) };
      });
    const items = new Map<string, { count: number; available: boolean }>();
    for (let row = top; row <= bottom; row++) {
      const text = this.shownText(entry.sheet.id, row, entry.bounds.c1 + at);
      const item = items.get(text) ?? { count: 0, available: false };
      item.count++;
      if (others.every((o) => o.test(this.#filterCell(entry.sheet, row, o.col)))) item.available = true;
      items.set(text, item);
    }
    return [...items].map(([value, i]) => ({ value, count: i.count, selected: !allowed || allowed.includes(value), available: i.available })).sort((a, b) => compareValues(a.value, b.value));
  }

  /** Lets only these values of a slicer's column through (as the cells show them), or all of them with `null`. */
  slicerSelect(id: string, values: readonly string[] | null): void {
    const held = this.#pivotHolding(id);
    if (held?.pivot.timelines?.some((x) => x.id === id)) return this.pivotTimelineSelect(id, null, null);
    if (held) return this.pivotSlicerSelect(id, values);
    const { slicer, entry } = this.slicerNamed(id);
    const all = this.slicerItems(id).map((i) => i.value);
    this.filterTable(entry.table.id, slicer.column, values === null || all.every((v) => values.includes(v)) ? null : values);
  }

  // ---- timelines ----

  /** The timelines on a sheet, bottom to top. */
  timelines(sheet: string): readonly Timeline[] {
    return (this.sheet(sheet).timelines ?? []).filter((x) => !isOrphanPanel(this.state, x));
  }

  /** Puts a timeline on a sheet and returns it. `table` is a table's name or id and `column` one of its columns of dates; it sits just right of the table unless `from` says where. */
  addTimeline(sheet: string, spec: { table: string; column: string; caption?: string; from?: Timeline["from"]; width?: number; height?: number; level?: TimelineLevel; style?: string; id?: string }): Timeline {
    const s = this.sheet(sheet);
    const entry = this.tableOf(spec.table);
    this.filterable(entry);
    const column = this.columnOf(entry, spec.column);
    const timeline: Timeline = {
      id: spec.id ?? createId("timeline_"),
      table: entry.table.id,
      column,
      from: spec.from ?? { row: entry.bounds.r1, col: entry.sheet.id === s.id ? entry.bounds.c2 + 2 : 1 },
      width: spec.width ?? DEFAULT_TIMELINE_WIDTH,
      height: spec.height ?? DEFAULT_TIMELINE_HEIGHT,
      level: spec.level ?? "months",
      ...(spec.caption ? { caption: spec.caption } : {}),
      ...(spec.style ? { style: spec.style } : {}),
    };
    this.commit([{ type: "add_timeline", sheet: s.id, timeline }]);
    return this.timelines(sheet).find((x) => x.id === timeline.id)!;
  }

  /** Replaces the timeline that has this id (to move or resize it, or to change its heading, periods or style). */
  updateTimeline(sheet: string, timeline: Timeline): void {
    this.commit([{ type: "update_timeline", sheet: this.sheet(sheet).id, timeline }]);
  }

  deleteTimeline(sheet: string, id: string): void {
    this.commit([{ type: "delete_timeline", sheet: this.sheet(sheet).id, id }]);
  }

  private timelineNamed(id: string): { sheet: Sheet; timeline: Timeline; entry: { sheet: Sheet; table: Table; bounds: Bounds } } {
    for (const sheet of this.state.sheets) {
      const timeline = sheet.timelines?.find((x) => x.id === id);
      if (timeline) return { sheet, timeline, entry: this.tableOf(timeline.table) };
    }
    throw new PliError("not_found", `No timeline with id "${id}"`);
  }

  /**
   * What a timeline draws: the periods from the earliest date in its column to the latest at its level (empty ones too), each
   * with how many rows are dated in it and whether it is inside the range picked, and that range (`null` when every date is
   * let through). The range is read from the table's filter on the column, so it follows the header button and a slicer.
   */
  timelineInfo(id: string): { level: TimelineLevel; bounds: { start: number; end: number } | null; periods: (TimelinePeriod & { count: number; selected: boolean })[]; selection: { start: number; end: number } | null } {
    const { timeline, entry } = this.timelineNamed(id);
    const names = tableColumns(entry.sheet, entry.bounds, entry.table);
    const at = names.indexOf(timeline.column);
    const [top, bottom] = dataRows(entry.table, entry.bounds);
    const days: number[] = [];
    if (at >= 0)
      for (let row = top; row <= bottom; row++) {
        const cell = this.#filterCell(entry.sheet, row, entry.bounds.c1 + at);
        if (cell.date) days.push(Math.floor(cell.value as number));
      }
    if (!days.length) return { level: timeline.level, bounds: null, periods: [], selection: null };
    const bounds = { start: Math.min(...days), end: Math.max(...days) };
    const selection = selectionOfFilter(entry.table.filters?.[timeline.column]);
    const periods = periodsBetween(timeline.level, bounds.start, bounds.end).map((p) => ({
      ...p,
      count: days.filter((d) => d >= p.start && d <= p.end).length,
      selected: !selection || (p.end >= selection.start && p.start <= selection.end),
    }));
    return { level: timeline.level, bounds, periods, selection };
  }

  /**
   * Picks the range of days from `range.start` to `range.end` (serial numbers) in a timeline, widened to whole periods of its
   * level, or every date with `null`. It sets the table's filter on the column to those dates, so the rows outside it are
   * hidden, in one undo step.
   */
  timelineSelect(id: string, range: { start: number; end: number } | null): void {
    const { timeline, entry } = this.timelineNamed(id);
    const info = this.timelineInfo(id);
    if (range === null || !info.bounds) return this.filterTable(entry.table.id, timeline.column, null);
    if (!(Number.isFinite(range.start) && Number.isFinite(range.end))) throw new PliError("invalid_operation", "A timeline range is two days");
    const a = Math.floor(Math.min(range.start, range.end));
    const b = Math.floor(Math.max(range.start, range.end));
    const start = periodStart(timeline.level, a);
    const end = periodEnd(timeline.level, b);
    if (start <= periodStart(timeline.level, info.bounds.start) && end >= periodEnd(timeline.level, info.bounds.end)) return this.filterTable(entry.table.id, timeline.column, null);
    this.filterTableRule(entry.table.id, timeline.column, { kind: "dateGroups", groups: rangeGroups(timeline.level, start, end) });
  }

  // ---- table styles of your own ----

  /** The table styles of your own, by name. */
  tableStyles(): Readonly<Record<string, TableStyleDef>> {
    return this.state.tableStyles ?? {};
  }

  /** Defines a table style of your own, or replaces the one with this name; `null` removes it, and tables that used it go back to the default style. */
  setTableStyle(name: string, style: TableStyleDef | null): void {
    if (style !== null) return this.commit([{ type: "set_table_style", name, style }]);
    const key = Object.keys(this.tableStyles()).find((n) => n.toLowerCase() === name.toLowerCase());
    if (key === undefined) return;
    const ops: SheetOp[] = [];
    for (const { sheet, table } of allTables(this.state)) {
      if (table.style?.toLowerCase() !== key.toLowerCase()) continue;
      const { style: _gone, ...rest } = table;
      ops.push({ type: "update_table", sheet: sheet.id, table: rest });
    }
    this.commit([...ops, { type: "set_table_style", name: key, style: null }]);
  }

  /** The slicer styles of your own, by name. */
  slicerStyles(): Readonly<Record<string, SlicerStyleDef>> {
    return this.state.slicerStyles ?? {};
  }

  /**
   * Defines a slicer style of your own, or replaces the one with this name; `null` removes it, and slicers that used it go back
   * to the default style. A slicer names it with its `style`. The parts are the slicer (`wholeTable`), its heading
   * (`headerRow`) and the buttons (`selectedItemWithData`, `unselectedItemWithNoData`, `hoveredSelectedItemWithData`…); each
   * can set text colour, fill, bold, italic and lines.
   */
  setSlicerStyle(name: string, style: SlicerStyleDef | null): void {
    if (style !== null) return this.commit([{ type: "set_slicer_style", name, style }]);
    const key = Object.keys(this.slicerStyles()).find((n) => n.toLowerCase() === name.toLowerCase());
    if (key === undefined) return;
    const ops: SheetOp[] = [];
    for (const sheet of this.state.sheets) {
      for (const slicer of sheet.slicers ?? []) {
        if (slicer.style?.toLowerCase() !== key.toLowerCase()) continue;
        const { style: _gone, ...rest } = slicer;
        ops.push({ type: "update_slicer", sheet: sheet.id, slicer: rest });
      }
      for (const pivot of sheet.pivots ?? []) {
        if (!pivot.slicers?.some((x) => x.style?.toLowerCase() === key.toLowerCase())) continue;
        ops.push({ type: "update_pivot", sheet: sheet.id, pivot: { ...pivot, slicers: pivot.slicers.map((x) => (x.style?.toLowerCase() === key.toLowerCase() ? (({ style: _s, ...rest }) => rest)(x) : x)) } });
      }
    }
    this.commit([...ops, { type: "set_slicer_style", name: key, style: null }]);
  }

  /** The parts of a slicer style, of your own or Excel's, to start a new one from. */
  slicerStyleParts(name: string): SlicerStyleDef | null {
    const own = Object.entries(this.state.slicerStyles ?? {}).find(([n]) => n.toLowerCase() === name.toLowerCase());
    return own ? structuredClone(own[1]) : builtinSlicerStyle(name);
  }

  /** The parts of a table style, of your own or Excel's, to start a new one from. */
  tableStyleParts(name: string): TableStyleDef | null {
    return resolveTableStyle(name, this.state.tableStyles);
  }


  // ---- data validation ----

  /** The data validations of a sheet; for a cell, the first one that covers it counts. */
  validations(sheet: string): readonly Validation[] {
    return this.sheet(sheet).validations ?? [];
  }

  /** Adds a validation and returns it. */
  addValidation(sheet: string, spec: ValidationSpec, index?: number): Validation {
    const validation = { ...spec, id: spec.id ?? createId("valid_") } as Validation;
    this.commit([{ type: "add_validation", sheet: this.sheet(sheet).id, validation, ...(index !== undefined ? { index } : {}) }]);
    return this.validations(sheet).find((r) => r.id === validation.id) ?? validation;
  }

  /** Replaces the validation that has this id (the rule must carry the same id). */
  updateValidation(sheet: string, validation: Validation): void {
    this.commit([{ type: "update_validation", sheet: this.sheet(sheet).id, validation }]);
  }

  deleteValidation(sheet: string, id: string): void {
    this.commit([{ type: "delete_validation", sheet: this.sheet(sheet).id, id }]);
  }

  /** Takes validation off a range: rules that only cover it go, and a rule that covers more keeps the rest of its ranges. */
  clearValidation(sheet: string, range: string): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    const ops: SheetOp[] = [];
    for (const rule of s.validations ?? []) {
      const kept = rule.ranges.filter((r) => !within(this.bounds(r), b));
      if (kept.length === rule.ranges.length) continue;
      ops.push(kept.length ? { type: "update_validation", sheet: s.id, validation: { ...rule, ranges: kept } as Validation } : { type: "delete_validation", sheet: s.id, id: rule.id });
    }
    if (ops.length) this.commit(ops);
  }

  /** The validation that covers a cell, if any. */
  validationAt(sheet: string, address: string): Validation | undefined {
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    return coveringValidation(this.sheet(sheet), pos.row, pos.col);
  }

  /** The choices a list validation offers for a cell, as text; empty when the cell has no list. */
  validationChoices(sheet: string, address: string): string[] {
    const s = this.sheet(sheet);
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    const rule = coveringValidation(s, pos.row, pos.col);
    return rule?.kind === "list" ? listChoices(rule, { calc: this.calculator, sheet: s, row: pos.row, col: pos.col }) : [];
  }

  /**
   * What would be said about typing `input` into a cell, or null if the entry is fine. A formula is checked by what it
   * works out to (an error result, or an empty one, is let through). A `stop` problem refuses the entry; `warning` and
   * `information` ask first, which is for the caller to do.
   */
  checkEntry(sheet: string, address: string, input: string | number | boolean | null): EntryProblem | null {
    const s = this.sheet(sheet);
    const pos = parseCell(address);
    if (!pos) throw new PliError("out_of_range", `"${address}" is not a cell address`);
    if (!s.validations?.length) return null;
    const parsed = typeof input === "string" ? cellFromInput(input) : input === null ? null : { v: input };
    return this.#refusal(s, pos.row, pos.col, parsed, merge(s.cells[cellAddress(pos.row, pos.col)], parsed));
  }

  #refusal(s: Sheet, row: number, col: number, parsed: Cell | null, kept: Cell | null): EntryProblem | null {
    const rule = coveringValidation(s, row, col);
    if (!rule) return null;
    if (parsed?.e !== undefined) return null;
    const candidate = () => {
      const { state } = sheetReducer.apply(this.state, { type: "set_cells", sheet: s.id, cells: { [cellAddress(row, col)]: kept } });
      return new Calculator(state, this.#options);
    };
    if (parsed?.f !== undefined) {
      // A formula is checked by what it works out to in the workbook as it would be with the formula in.
      const calc = candidate();
      const v = calc.value(s.id, cellAddress(row, col));
      if (v === null || v === "" || isError(v)) return null;
      return entryAllowed(rule, v as number | string | boolean, { calc, sheet: s, row, col, candidate: () => calc }) ? null : problemOf(rule);
    }
    const entry = parsed?.v ?? null;
    const ctx: EntryContext = { calc: this.calculator, sheet: s, row, col, candidate };
    return entryAllowed(rule, entry, ctx) ? null : problemOf(rule);
  }

  /** The cells whose values break the validation that covers them (as Excel's "Circle invalid data" finds them). Empty cells are left out. */
  invalidCells(sheet: string): string[] {
    const s = this.sheet(sheet);
    if (!s.validations?.length) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const used = [...Object.keys(s.cells)];
    // Cells a formula spilled into are checked too.
    const extent = this.calculator.usedBounds(s.id);
    if (extent && (extent.r2 - extent.r1 + 1) * (extent.c2 - extent.c1 + 1) <= 50_000) {
      for (let r = extent.r1; r <= extent.r2; r++) for (let c = extent.c1; c <= extent.c2; c++) used.push(cellAddress(r, c));
    }
    for (const address of used) {
      if (seen.has(address)) continue;
      seen.add(address);
      const pos = parseCell(address)!;
      const rule = coveringValidation(s, pos.row, pos.col);
      if (!rule) continue;
      const v = this.calculator.value(s.id, address);
      if (v === null || v === "" || isError(v)) continue;
      if (!entryAllowed(rule, v as number | string | boolean, { calc: this.calculator, sheet: s, row: pos.row, col: pos.col })) out.push(address);
    }
    return out;
  }


  // ---- checking pastes ----

  #validatePaste: ValidatePaste | undefined;
  #lastPaste: PasteReport | null = null;
  readonly #pasteListeners = new Set<(report: PasteReport) => void>();

  /**
   * What to do about cells a paste, move, fill or sort puts in that break the data validation rule covering them: `off`
   * leaves them (as Excel does, and "Circle invalid data" finds them), `warn` puts them in and reports them, `refuse` also
   * keeps what a cell had when the new content breaks a `stop` rule (a move or a sort, which can't be done in part, is
   * refused as a whole and throws).
   */
  get validatePaste(): ValidatePaste {
    return this.#validatePaste ?? this.#options.validatePaste ?? "off";
  }

  set validatePaste(mode: ValidatePaste) {
    if (mode !== "off" && mode !== "warn" && mode !== "refuse") throw new PliError("invalid_operation", 'validatePaste is "off", "warn" or "refuse"');
    this.#validatePaste = mode;
  }

  /** What the last checked paste, move, fill or sort found; null when it found nothing (or none was checked). */
  get lastPasteReport(): PasteReport | null {
    return this.#lastPaste;
  }

  /** Calls `listener` when a checked paste, move, fill or sort finds cells that break their rule. Returns a function that stops listening. */
  onPasteReport(listener: (report: PasteReport) => void): () => void {
    this.#pasteListeners.add(listener);
    return () => void this.#pasteListeners.delete(listener);
  }

  #announce(report: PasteReport): void {
    this.#lastPaste = report;
    for (const listener of [...this.#pasteListeners]) listener(report);
  }

  /** The value (as text) a cell holds that its rule refuses, as the workbook has it now; null when it is fine. */
  #invalidAt(s: Sheet, row: number, col: number): string | null {
    const rule = coveringValidation(s, row, col);
    if (!rule) return null;
    const v = this.calculator.value(s.id, cellAddress(row, col));
    if (v === null || v === "" || isError(v) || entryAllowed(rule, v as number | string | boolean, { calc: this.calculator, sheet: s, row, col })) return null;
    return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
  }

  /** Checks what an operation is about to write (see `validatePaste`). Returns the operations to run, with the cells that were refused left as they were. */
  #vet(ops: readonly SheetOp[], ctx: PasteContext): { ops: readonly SheetOp[]; report?: PasteReport } {
    const mode = this.validatePaste;
    if (mode === "off") return { ops };
    const before = this.sheet(ctx.sheet);
    const touchesRules = ops.some((op) => (op.type === "add_validation" || op.type === "update_validation" || op.type === "delete_validation") && op.sheet === before.id);
    if (!before.validations?.length && !touchesRules) return { ops };
    let state: Workbook;
    try {
      state = ops.reduce((st, op) => sheetReducer.apply(st, op).state, this.state);
    } catch {
      return { ops }; // the operation itself is refused, which commit says
    }
    // A big area with few cells written: look at those only.
    const written = new Set<string>();
    for (const op of ops) if (op.type === "set_cells" && op.sheet === before.id) for (const a of Object.keys(op.cells)) written.add(a);
    const area = (ctx.bounds.r2 - ctx.bounds.r1 + 1) * (ctx.bounds.c2 - ctx.bounds.c1 + 1);
    const from = ctx.from ? this.state.sheets.find((x) => x.id === ctx.from!.sheet) : undefined;
    let wasInvalid: Map<string, number> | undefined;
    const skip = (row: number, col: number, value: string): boolean => {
      if (ctx.samePlace) {
        // A sort moves values about: each value that was wrong in the range before may be wrong again after.
        if (!wasInvalid) {
          wasInvalid = new Map();
          for (let r = ctx.bounds.r1; r <= ctx.bounds.r2; r++)
            for (let c = ctx.bounds.c1; c <= ctx.bounds.c2; c++) {
              const v = this.#invalidAt(before, r, c);
              if (v !== null) wasInvalid.set(v, (wasInvalid.get(v) ?? 0) + 1);
            }
        }
        const left = wasInvalid.get(value) ?? 0;
        if (left > 0) wasInvalid.set(value, left - 1);
        return left > 0;
      }
      if (ctx.from && from) return this.#invalidAt(from, row - ctx.from.dRow, col - ctx.from.dCol) !== null;
      return false;
    };
    const problems = pasteProblems(state, this.#options, before.id, ctx.bounds, area > 20_000 ? written : null, skip);
    if (!problems.length) {
      this.#lastPaste = null;
      return { ops };
    }
    const stops = problems.filter((p) => p.alert === "stop").map((p) => p.address);
    const report: PasteReport = { action: ctx.action, mode, sheet: before.name, range: rangeAddress(ctx.bounds), invalid: problems, refused: [], cancelled: false };
    if (mode === "refuse" && stops.length) {
      report.refused = stops;
      if (ctx.whole || ops.some((op) => op.type === "restore")) {
        report.cancelled = true;
        this.#announce(report);
        throw new PliError("invalid_operation", describePasteReport(report));
      }
      const refused = new Set(stops);
      ops = ops.map((op) => (op.type === "set_cells" && op.sheet === before.id ? { ...op, cells: Object.fromEntries(Object.entries(op.cells).map(([a, c]) => [a, refused.has(a) ? before.cells[a] ?? null : c])) } : op));
    }
    return { ops, report };
  }

  /**
   * Pastes the values of cells (Paste special > Values): formulas arrive as what they work out to, and the cells they
   * land on keep their formats, their dropdowns and their data validation. This is where `validatePaste` matters most:
   * a plain copy brings its own rules, but values meet the rules already there.
   */
  pasteValues(from: { sheet: string; range: string }, to: { sheet: string; at: string }): void {
    const src = this.sheet(from.sheet);
    const dst = this.sheet(to.sheet);
    const b = this.bounds(from.range);
    const origin = parseCell(to.at);
    if (!origin) throw new PliError("out_of_range", `"${to.at}" is not a cell address`);
    const dRow = origin.row - b.r1;
    const dCol = origin.col - b.c1;
    if (b.r2 + dRow > MAX_ROWS || b.c2 + dCol > MAX_COLS) throw new PliError("out_of_range", "That doesn't fit on the sheet");
    const cells: Record<string, Cell | null> = {};
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        const cell = src.cells[cellAddress(r, c)];
        const target = cellAddress(r + dRow, c + dCol);
        const old = dst.cells[target];
        const v = cell && (cell.v !== undefined || cell.f !== undefined || cell.e !== undefined) ? this.calculator.value(src.id, cellAddress(r, c)) : null;
        let next: Cell | null = null;
        if (isError(v)) next = { e: v.error };
        else if (v !== null) next = { v: v as number | string | boolean, ...(cell?.fmt && !old?.fmt ? { fmt: cell.fmt } : {}) };
        checkAgainstControl(old?.control, next);
        cells[target] = merge(old, next);
      }
    this.commit(this.#withTables(dst, cells), { vet: { action: "paste", sheet: dst.id, bounds: { r1: b.r1 + dRow, c1: b.c1 + dCol, r2: b.r2 + dRow, c2: b.c2 + dCol } } });
  }

  // ---- lists with several choices in a cell ----

  /** The items a cell holds that sit under a list rule (one, or several when the rule allows them). */
  validationSelection(sheet: string, address: string): string[] {
    const cell = this.cell(sheet, address);
    const rule = this.validationAt(sheet, address);
    if (rule?.kind !== "list" || cell?.v === undefined) return [];
    return rule.multiple ? itemsInCell(String(cell.v), rule.separator) : [String(cell.v)];
  }

  // ---- lists read from another workbook ----

  #externalLists: ExternalListResolver | undefined;
  #externalSet = false;
  readonly #fresh = new Set<string>();
  readonly #failed = new Map<string, string>();

  /** The way lists are read from other workbooks: what the host supplied, or nothing (then the snapshots kept in the workbook are used). */
  get externalLists(): ExternalListResolver | undefined {
    return this.#externalSet ? this.#externalLists : this.#options.externalLists;
  }

  set externalLists(resolver: ExternalListResolver | undefined) {
    this.#externalLists = resolver;
    this.#externalSet = true;
    this.#fresh.clear();
    this.#failed.clear();
  }

  #externalTables: ExternalTableResolver | undefined;
  #externalTablesSet = false;

  /** The way tables of other workbooks are found: what the host supplied, or nothing (then the places kept in the workbook are used). */
  get externalTables(): ExternalTableResolver | undefined {
    return this.#externalTablesSet ? this.#externalTables : this.#options.externalTables;
  }

  set externalTables(resolver: ExternalTableResolver | undefined) {
    this.#externalTables = resolver;
    this.#externalTablesSet = true;
  }

  /** How the list of the cell stands when it is read from another workbook; null when the cell has no such list. */
  externalListStatus(sheet: string, address: string): ExternalListStatus | null {
    const rule = this.validationAt(sheet, address);
    if (rule?.kind !== "list") return null;
    const ref = parseExternalRef(rule.source);
    if (!ref) return null;
    const key = `${rule.id}|${rule.source}`;
    const items = (rule.snapshot?.items ?? []).filter((i) => i !== "");
    const part = externalPart(ref);
    const status: ExternalListStatus = { book: ref.book, ref: part, items, state: this.#fresh.has(key) ? "fresh" : rule.snapshot ? "stale" : "missing", ...(rule.snapshot?.read ? { read: rule.snapshot.read } : {}) };
    if (status.state !== "fresh") {
      const when = rule.snapshot?.read ? ` the copy saved on ${rule.snapshot.read}` : " the copy saved in the workbook";
      status.reason = !this.externalLists
        ? `This workbook can't read ${ref.book}, so the list is${rule.snapshot ? when : " empty"}.`
        : this.#failed.get(key) ?? `${ref.book} hasn't been read yet, so the list is${rule.snapshot ? when : " empty"}.`;
    }
    return status;
  }

  /**
   * Asks the host (`externalLists`) to read every list that comes from another workbook, and keeps what it reads in the
   * rules as a snapshot with today's date, so the lists work without the host. A list the host can't read keeps its
   * snapshot, flagged stale. The snapshots are stored without a step of their own in the undo history.
   */
  async refreshExternalLists(): Promise<ExternalRefresh> {
    const resolver = this.externalLists;
    const result: ExternalRefresh = { updated: 0, unchanged: 0, failed: [], offline: !resolver };
    if (!resolver) return result;
    const todo: { sheet: Sheet; rule: Extract<Validation, { kind: "list" }> }[] = [];
    for (const sheet of this.state.sheets) for (const rule of sheet.validations ?? []) if (rule.kind === "list" && parseExternalRef(rule.source)) todo.push({ sheet, rule });
    const answers = new Map<string, Promise<(string | number | boolean | null)[] | string>>();
    const ask = (book: string, part: string): Promise<(string | number | boolean | null)[] | string> => {
      const key = `${book.toLowerCase()}|${part}`;
      let p = answers.get(key);
      if (!p) {
        p = Promise.resolve()
          .then(() => resolver(book, part))
          .then(
            (answer) => (answer ? answer.slice(0, MAX_SNAPSHOT_ITEMS) : `${book} couldn't be found`),
            (e: unknown) => (e instanceof Error ? e.message : String(e)),
          );
        answers.set(key, p);
      }
      return p;
    };
    const ops: SheetOp[] = [];
    for (const { sheet, rule } of todo) {
      const ref = parseExternalRef(rule.source)!;
      const key = `${rule.id}|${rule.source}`;
      const answer = await ask(ref.book, externalPart(ref));
      if (typeof answer === "string") {
        this.#fresh.delete(key);
        this.#failed.set(key, `${ref.book} could not be read (${answer}), so the list is ${rule.snapshot?.read ? `the copy saved on ${rule.snapshot.read}` : "the copy saved in the workbook"}.`);
        result.failed.push({ sheet: sheet.name, id: rule.id, book: ref.book, reason: answer });
        continue;
      }
      this.#failed.delete(key);
      this.#fresh.add(key);
      const items = snapshotItems(answer);
      const old = rule.snapshot?.items ?? [];
      if (old.length === items.length && old.every((x, i) => x === items[i])) {
        result.unchanged++;
        continue;
      }
      result.updated++;
      // The rule may have been edited while the host was answering: store only on the rule as it is now.
      const now = this.state.sheets.find((x) => x.id === sheet.id)?.validations?.find((x) => x.id === rule.id);
      if (now?.kind !== "list" || now.source !== rule.source) continue;
      ops.push({ type: "update_validation", sheet: sheet.id, validation: { ...now, snapshot: { items: items.slice(0, MAX_SNAPSHOT_ITEMS), read: readDay(this.#options.now?.()), ...(now.snapshot?.path ? { path: now.snapshot.path } : {}) } } });
    }
    // Where the tables of other workbooks that formulas name are (the cells of each are asked for below).
    const tableResolver = this.externalTables;
    if (tableResolver) {
      const kept = new Map<string, ExternalTable[]>();
      for (const want of collectExternalTables(this.state)) {
        const key = `table|${want.book.toLowerCase()}|${want.table.toLowerCase()}`;
        let answer: Awaited<ReturnType<ExternalTableResolver>>;
        try {
          answer = await tableResolver(want.book, want.table);
        } catch (e) {
          answer = undefined;
          this.#failed.set(key, e instanceof Error ? e.message : String(e));
        }
        if (!answer) {
          this.#fresh.delete(key);
          result.failed.push({ sheet: "", id: "", book: want.book, ref: `${want.table}[]`, reason: this.#failed.get(key) ?? `the table ${want.table} couldn't be found in ${want.book}` });
          continue;
        }
        let table: ExternalTable;
        try {
          table = cleanExternalTable({ name: want.table, ...answer });
        } catch (e) {
          result.failed.push({ sheet: "", id: "", book: want.book, ref: `${want.table}[]`, reason: (e as Error).message });
          continue;
        }
        this.#failed.delete(key);
        this.#fresh.add(key);
        const name = this.#bookName(want.book);
        const list = kept.get(name.toLowerCase()) ?? [...(this.state.externalBooks?.find((b) => b.name.toLowerCase() === name.toLowerCase())?.tables ?? [])];
        const at = list.findIndex((t) => t.name.toLowerCase() === table.name.toLowerCase());
        if (at >= 0 && JSON.stringify(list[at]) === JSON.stringify(table)) {
          kept.set(name.toLowerCase(), list);
          continue;
        }
        if (at >= 0) list[at] = table;
        else list.push(table);
        kept.set(name.toLowerCase(), list);
        result.updated++;
        ops.push({ type: "set_external_cells", book: name, sheet: table.sheet, cells: {}, tables: list });
      }
      if (ops.length) {
        this.#bypass++;
        try {
          this.commit(ops.splice(0, ops.length), { history: false });
        } finally {
          this.#bypass--;
        }
      }
    }
    // The cells that formulas, defined names and rules read from other workbooks.
    const today = readDay(this.#options.now?.());
    for (const want of collectExternalRefs(this.state)) {
      const key = `cells|${want.book.toLowerCase()}|${askPart(want)}`;
      if (want.count > MAX_ASK) {
        result.failed.push({ sheet: "", id: "", book: want.book, ref: askPart(want), reason: `${want.count} cells are more than can be asked for at once` });
        continue;
      }
      const answer = await ask(want.book, askPart(want));
      if (typeof answer === "string") {
        this.#fresh.delete(key);
        this.#failed.set(key, `${want.book} could not be read (${answer}), so ${askPart(want)} is the copy kept in the workbook.`);
        result.failed.push({ sheet: "", id: "", book: want.book, ref: askPart(want), reason: answer });
        continue;
      }
      this.#failed.delete(key);
      this.#fresh.add(key);
      const [a, z = a] = want.range.split(":");
      const from = parseCell(a!)!;
      const to = parseCell(z!)!;
      const kept = keptCells(this.state, want);
      const cells: Record<string, string | number | boolean | null> = {};
      let k = 0;
      for (let r = from.row; r <= to.row; r++) for (let c = from.col; c <= to.col; c++, k++) cells[cellAddress(r, c)] = answer[k] === undefined || answer[k] === null || answer[k] === "" ? null : answer[k]!;
      if (kept && Object.values(cells).every((v, i) => v === kept[i])) {
        result.unchanged++;
        continue;
      }
      result.updated++;
      ops.push({ type: "set_external_cells", book: this.#bookName(want.book), sheet: want.sheet, cells, read: today });
    }
    if (ops.length) {
      this.#bypass++;
      try {
        this.commit(ops, { history: false });
      } finally {
        this.#bypass--;
      }
    }
    return result;
  }

  /** The name a workbook is kept under (the spelling already in use wins over the one a formula uses). */
  #bookName(name: string): string {
    return this.state.externalBooks?.find((b) => b.name.toLowerCase() === name.toLowerCase())?.name ?? name;
  }

  // ---- cells read from other workbooks ----

  /** What the workbook keeps of other workbooks: the cells formulas, defined names and validation rules read from them. */
  get externalBooks(): readonly ExternalBook[] {
    return this.state.externalBooks ?? [];
  }

  /**
   * Gives the workbook cells of another workbook to read: formulas such as `=[Prices.xlsx]Sheet1!B2` take their values from
   * here. `cells` maps addresses to values (`null` for a blank). With `history: false` the change is not an undo step (what
   * reading the file again does). `path` and `read` (the day, `2026-11-09`) are kept with the workbook.
   */
  setExternalCells(book: string, sheet: string, cells: Record<string, string | number | boolean | null>, options: { path?: string; read?: string; history?: boolean } = {}): void {
    const op = { type: "set_external_cells" as const, book: this.#bookName(book), sheet, cells, ...(options.path !== undefined ? { path: options.path } : {}), ...(options.read !== undefined ? { read: options.read } : {}) };
    applyExternalCells(this.state.externalBooks, op); // refuses mistakes before anything is committed
    this.commit([op], options.history === false ? { history: false } : {});
  }

  /**
   * Tells the workbook where a table of another workbook is, so that formulas such as `=SUM([Prices.xlsx]Orders[Total])` can
   * be worked out from the cells kept of it (see `setExternalCells`). `range` covers the header and totals rows too.
   */
  setExternalTable(book: string, table: ExternalTable, options: { history?: boolean } = {}): void {
    const name = this.#bookName(book);
    const old = this.state.externalBooks?.find((b) => b.name.toLowerCase() === name.toLowerCase())?.tables ?? [];
    const clean = cleanExternalTable(table);
    const list = [...old.filter((t) => t.name.toLowerCase() !== clean.name.toLowerCase()), clean];
    const op = { type: "set_external_cells" as const, book: name, sheet: clean.sheet, cells: {}, tables: list };
    applyExternalCells(this.state.externalBooks, op);
    this.commit([op], options.history === false ? { history: false } : {});
  }

  /** Every range of another workbook that formulas, names or validation rules read, and how the copy kept of it stands. */
  externalReferences(): ExternalReference[] {
    return collectExternalRefs(this.state).map((want) => {
      const key = `cells|${want.book.toLowerCase()}|${askPart(want)}`;
      const kept = keptCells(this.state, want);
      const book = this.state.externalBooks?.find((b) => b.name.toLowerCase() === want.book.toLowerCase());
      const state: ExternalReference["state"] = this.#fresh.has(key) ? "fresh" : kept ? "stale" : "missing";
      const out: ExternalReference = { book: want.book, sheet: want.sheet, range: want.range, by: want.by, state };
      if (book?.read) out.read = book.read;
      if (state !== "fresh") out.reason = !this.externalLists ? `This workbook can't read ${want.book}, so ${state === "stale" ? "the copy kept in the workbook is used" : "the cells are not there"}.` : this.#failed.get(key) ?? `${want.book} hasn't been read yet.`;
      return out;
    });
  }

  // ---- helpers ----

  private bounds(range: string): Bounds {
    const b = parseRange(range);
    if (!b) throw new PliError("out_of_range", `"${range}" is not a range`);
    return b;
  }

  private existing(sheet: Sheet, b: Bounds): string[] {
    const area = (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1);
    const keys = Object.keys(sheet.cells);
    if (area <= keys.length) {
      const out: string[] = [];
      for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) if (sheet.cells[cellAddress(r, c)]) out.push(cellAddress(r, c));
      return out;
    }
    return keys.filter((k) => {
      const p = parseCell(k)!;
      return p.row >= b.r1 && p.row <= b.r2 && p.col >= b.c1 && p.col <= b.c2;
    });
  }

  private patch(sheet: string, range: string, fn: (c: Cell, key: string) => Cell): void {
    const s = this.sheet(sheet);
    const b = this.bounds(range);
    if ((b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1) > MAX_CELLS_AT_ONCE) throw new PliError("out_of_range", "That range is too large to change at once");
    const cells: Record<string, Cell | null> = {};
    // Whole columns and rows are applied to the cells that exist, where the area is far larger than the sheet's content.
    const area = (b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1);
    if (area > Object.keys(s.cells).length * 4 && area > 10_000) throw new PliError("out_of_range", "That range is too large to change at once; select the cells you want");
    for (let r = b.r1; r <= b.r2; r++)
      for (let c = b.c1; c <= b.c2; c++) {
        const key = cellAddress(r, c);
        cells[key] = cleanCell(fn(s.cells[key] ?? {}, key));
      }
    this.commit([{ type: "set_cells", sheet: s.id, cells }]);
  }
}

/** The cell after new content is typed over the old: format and style are kept unless the input brings its own. */
function merge(old: Cell | undefined, input: Cell | null): Cell | null {
  if (input === null) {
    if (!old) return null;
    const keep: Cell = {};
    if (old.fmt) keep.fmt = old.fmt;
    if (old.s) keep.s = old.s;
    if (old.control) {
      keep.control = old.control;
      if (old.control.type === "checkbox") keep.v = checkboxValues(old.control).unchecked; // an emptied checkbox is unticked
    }
    if (old.note !== undefined) Object.assign(keep, { note: old.note }, noteExtras(old));
    if (old.thread !== undefined) keep.thread = old.thread;
    return cleanCell(keep);
  }
  const out: Cell = { ...input };
  if (old?.fmt && out.fmt === undefined) out.fmt = old.fmt;
  if (old?.s) out.s = old.s;
  if (old?.control) out.control = old.control;
  if (old?.note !== undefined) Object.assign(out, { note: old.note }, noteExtras(old));
  if (old?.thread !== undefined) out.thread = old.thread;
  return cleanCell(out);
}

function coveringValidation(sheet: Sheet, row: number, col: number): Validation | undefined {
  return sheet.validations?.find((r) => ruleBounds(r.ranges).some((b) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2));
}

/** What is left of `r` when `cut` is taken out of it: up to four rectangles. */
function subtractBounds(r: Bounds, cut: Bounds): Bounds[] {
  if (r.r1 > cut.r2 || cut.r1 > r.r2 || r.c1 > cut.c2 || cut.c1 > r.c2) return [r];
  const out: Bounds[] = [];
  if (r.r1 < cut.r1) out.push({ ...r, r2: cut.r1 - 1 });
  if (r.r2 > cut.r2) out.push({ ...r, r1: cut.r2 + 1 });
  const r1 = Math.max(r.r1, cut.r1);
  const r2 = Math.min(r.r2, cut.r2);
  if (r.c1 < cut.c1) out.push({ r1, r2, c1: r.c1, c2: cut.c1 - 1 });
  if (r.c2 > cut.c2) out.push({ r1, r2, c1: cut.c2 + 1, c2: r.c2 });
  return out;
}

const within = (inner: Bounds, outer: Bounds) => inner.r1 >= outer.r1 && inner.r2 <= outer.r2 && inner.c1 >= outer.c1 && inner.c2 <= outer.c2;

function changeOf(event: SheetChangeEvent): Change {
  if (event.reset) return "all";
  const cells: { sheet: string; address: string }[] = [];
  let hidden = false;
  for (const op of event.ops) {
    switch (op.type) {
      case "set_cells":
        for (const address of Object.keys(op.cells)) cells.push({ sheet: op.sheet, address });
        break;
      case "set_size":
        if (op.hidden !== undefined) hidden = true;
        break;
      case "set_frozen":
      case "set_tab_color":
      case "set_title":
        break;
      default:
        return "all";
    }
  }
  return hidden ? { cells, hidden: true } : { cells };
}

/** What a cell's note has, with only the parts that are there. */
function infoOf(c: Cell): NoteInfo {
  return { text: c.note!, ...(c.noteRuns ? { runs: c.noteRuns } : {}), ...(c.noteAuthor ? { author: c.noteAuthor } : {}), ...(c.noteBox ? { box: c.noteBox } : {}) };
}
