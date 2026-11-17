import { cellAddress, inBounds, parseCell, type Bounds } from "./address";
import { evaluate, evaluateGrid } from "./eval";
import { externalSheets } from "./external-sheets";
import { resolveExternalTableRef } from "./external-tables";
import { formatValue, type Formatted } from "./format";
import { FormulaSyntaxError, parseFormula } from "./formula";
import type { FormulaImage, FormulaSparkline, Host, Ctx } from "./functions/types";
import { MAX_COLS, MAX_ROWS, type Cell, type Sheet, type Workbook } from "./model";
import { pivotAt, pivotLookup, pivotSourceRange, readPivotSource, renderPivot, type PivotRender, type PivotSource } from "./pivot";
import { refsIn } from "./refs";
import { rowIsHidden } from "./subtotal-rows";
import { hideAt } from "./hide";
import { resolveTableRef, findTable } from "./table";
import { err, isArray, nowSerial, type ArrayValue, type Value } from "./values";

/** What changed, so only what depends on it is worked out again. */
export type Change = "all" | { cells: readonly { sheet: string; address: string }[]; /** Rows or columns were hidden or shown (a filter, a collapsed group): `SUBTOTAL` reads them. */ hidden?: true };

interface Entry {
  row: number;
  col: number;
  cell: Cell;
}

/** A sheet seen from the side: its cells as a list, the formulas among them, the extent. Built when first needed. */
class SheetIndex {
  readonly sheet: Sheet;
  #entries?: Entry[];
  #formulas?: Entry[];
  #used?: Bounds | null;
  constructor(sheet: Sheet) {
    this.sheet = sheet;
  }
  get entries(): Entry[] {
    if (!this.#entries) {
      const out: Entry[] = [];
      for (const [address, cell] of Object.entries(this.sheet.cells)) {
        if (cell.v === undefined && cell.e === undefined && cell.f === undefined) continue;
        const pos = parseCell(address);
        if (pos) out.push({ row: pos.row, col: pos.col, cell });
      }
      this.#entries = out;
    }
    return this.#entries;
  }
  get formulas(): Entry[] {
    return (this.#formulas ??= this.entries.filter((e) => e.cell.f !== undefined));
  }
  get used(): Bounds | null {
    if (this.#used === undefined) {
      let b: Bounds | null = null;
      for (const e of this.entries) {
        b = b ? { r1: Math.min(b.r1, e.row), c1: Math.min(b.c1, e.col), r2: Math.max(b.r2, e.row), c2: Math.max(b.c2, e.col) } : { r1: e.row, c1: e.col, r2: e.row, c2: e.col };
      }
      this.#used = b;
    }
    return this.#used;
  }
}

interface Frame {
  cells: Set<string>;
  ranges: { sheet: string; bounds: Bounds }[];
  volatile: boolean;
  /** The formula looked at which rows are hidden (`SUBTOTAL`). */
  hidden?: boolean;
  /** The picture an `IMAGE` in the formula asked for. */
  image?: FormulaImage;
  /** The sparkline a `SPARKLINE` in the formula asked for. */
  sparkline?: FormulaSparkline;
}

interface RangeDep {
  owner: string;
  bounds: Bounds;
}

const key = (sheet: string, row: number, col: number) => `${sheet}|${row}|${col}`;

/** A formula's results that fill the cells beside it. */
interface Spill {
  owner: string;
  sheet: string;
  row: number;
  col: number;
  rows: number;
  cols: number;
  values: Value[][];
}

const pos = (row: number, col: number) => row * 16385 + col;

/** How far a cell's value moved between two passes of an iterative calculation: the difference of two numbers, infinite when anything else differs. */
function valueChange(a: Value | undefined, b: Value | undefined): number {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b);
  if (a === b) return 0;
  return Infinity;
}

export interface CalculatorOptions {
  /** The current date and time as a serial number. Defaults to the clock. */
  now?: () => number;
  /** Random numbers from 0 up to 1. Defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Works out the formulas of a workbook. Values are worked out when asked for and kept; when cells change, only the
 * formulas that depend on them (and the ones that depend on those) are thrown away to be worked out again.
 */
export class Calculator {
  #wb: Workbook;
  #opts: CalculatorOptions;
  #indexes = new WeakMap<Sheet, SheetIndex>();
  #byName = new Map<string, string>();
  #byId = new Map<string, Sheet>();
  #cache = new Map<string, Value>();
  #inProgress = new Set<string>();
  #circular = new Set<string>();
  /** With iterative calculation on: cells that something in their own chain read while they were being worked out. */
  #heads = new Set<string>();
  #iterating = new Set<string>();
  /** The last value of cells in a circular chain, which is what the chain reads of them (kept between recalculations, as Excel does). */
  #iterPrev = new Map<string, Value>();
  #volatile = new Set<string>();
  /** Formulas that read which rows are hidden, to be worked out again when rows are hidden or shown. */
  #hiddenReaders = new Set<string>();
  /** The pictures formulas show in their cells (`IMAGE`), by cell. */
  #images = new Map<string, FormulaImage>();
  /** The sparklines formulas draw in their cells (`SPARKLINE`), by cell. */
  #sparks = new Map<string, FormulaSparkline>();
  #sparkSheets = new WeakMap<Sheet, boolean>();
  /** Owner of the cells and ranges each formula read. */
  #owned = new Map<string, { cells: Set<string>; ranges: { sheet: string; dep: RangeDep }[] }>();
  #cellDependents = new Map<string, Set<string>>();
  #rangeDependents = new Map<string, Set<RangeDep>>();
  #frames: Frame[] = [];
  /** Formulas whose value is out of date and must be worked out again. */
  #dirty = new Set<string>();
  #spills = new Map<string, Spill>();
  #spillCells = new Map<string, Map<number, Spill>>();
  readonly #host: Host;
  /** The pivot tables `GETPIVOTDATA` has worked out from their sources, until the workbook changes. */
  #pivotRenders = new Map<string, { src: PivotSource; render: PivotRender }>();

  constructor(workbook: Workbook, options: CalculatorOptions = {}) {
    this.#wb = workbook;
    this.#opts = options;
    this.#reindex();
    this.#host = this.#makeHost();
    this.#markAll();
    this.#settleDirty();
  }

  get workbook(): Workbook {
    return this.#wb;
  }

  /** Points the calculator at a new version of the workbook; `change` says what is different. */
  update(workbook: Workbook, change: Change): void {
    const previous = this.#wb;
    this.#wb = workbook;
    this.#pivotRenders.clear();
    this.#reindex();
    if (change === "all" || previous.sheets.length !== workbook.sheets.length) {
      this.#reset();
      this.#settleDirty();
      return;
    }
    const positions: [string, number, number][] = [];
    for (const { sheet, address } of change.cells) {
      const p = parseCell(address);
      if (p) positions.push([sheet, p.row, p.col]);
    }
    this.#invalidate(positions, change.hidden === true);
    this.#settleDirty();
  }

  #reindex(): void {
    this.#byName.clear();
    this.#byId.clear();
    for (const sheet of this.#wb.sheets) {
      this.#byName.set(sheet.name.toLowerCase(), sheet.id);
      this.#byId.set(sheet.id, sheet);
    }
    // The cells last read from other workbooks are sheets of their own, for formulas like `[Prices.xlsx]Sheet1!B2`.
    for (const book of this.#wb.externalBooks ?? [])
      for (const sheet of externalSheets(book)) {
        this.#byName.set(sheet.name.toLowerCase(), sheet.id);
        this.#byId.set(sheet.id, sheet);
      }
  }

  #reset(): void {
    this.#cache.clear();
    this.#inProgress.clear();
    this.#circular.clear();
    this.#images.clear();
    this.#sparks.clear();
    this.#heads.clear();
    this.#iterPrev.clear();
    this.#volatile.clear();
    this.#hiddenReaders.clear();
    this.#owned.clear();
    this.#cellDependents.clear();
    this.#rangeDependents.clear();
    this.#spills.clear();
    this.#spillCells.clear();
    this.#dirty.clear();
    this.#markAll();
  }

  /** Every formula needs working out. */
  #markAll(): void {
    for (const sheet of this.#wb.sheets) {
      const ix = this.#index(sheet.id);
      for (const f of ix?.formulas ?? []) this.#dirty.add(key(sheet.id, f.row, f.col));
    }
  }

  /**
   * Works out every formula that is out of date, so values are always current (formulas can spill into cells that others
   * read, which only holds once everything has settled). Working one out can change what others read, so it goes round
   * again until nothing is left.
   */
  #settleDirty(): void {
    for (let pass = 0; pass < 30 && this.#dirty.size > 0; pass++) {
      const todo = [...this.#dirty];
      this.#dirty.clear();
      for (const k of todo) {
        if (this.#cache.has(k)) continue;
        const [sheet, r, c] = k.split("|") as [string, string, string];
        const cell = this.#byId.get(sheet)?.cells[cellAddress(Number(r), Number(c))];
        if (cell?.f !== undefined) this.#settle(sheet, Number(r), Number(c));
      }
    }
  }

  #index(sheetId: string): SheetIndex | undefined {
    const sheet = this.#byId.get(sheetId);
    if (!sheet) return undefined;
    let ix = this.#indexes.get(sheet);
    if (!ix) {
      ix = new SheetIndex(sheet);
      this.#indexes.set(sheet, ix);
    }
    return ix;
  }

  // ---- reading values ----

  /** The value of the cell at `address` (`"B3"`) of the sheet with this name or id. */
  value(sheet: string, address: string): Value {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const pos = parseCell(address);
    if (id === undefined || !pos) return err("#REF!");
    return this.#valueAt(id, pos.row, pos.col);
  }

  /** The cell as it shows: the value with the cell's number format applied. */
  display(sheet: string, address: string): Formatted {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const cell = id === undefined ? undefined : this.#byId.get(id)?.cells[address.replace(/\$/g, "").toUpperCase()];
    return formatValue(this.value(sheet, address), cell?.fmt);
  }

  /** The date and time the calculator is working with, as a serial number. */
  now(): number {
    return (this.#opts.now ?? nowSerial)();
  }

  /**
   * Works out a formula as if it were typed in the cell at `row`, `col` of a sheet, without being kept: what conditional
   * formats do. An array gives its first value.
   */
  evaluateAt(sheet: string, row: number, col: number, formula: string): Value {
    return this.evaluateGrid(sheet, row, col, formula)[0]?.[0] ?? null;
  }

  /** Like `evaluateAt`, but gives every value, row by row (a range, or the results of a formula that fills several cells). */
  evaluateGrid(sheet: string, row: number, col: number, formula: string): Value[][] {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    if (id === undefined) return [[err("#REF!")]];
    return evaluateGrid(formula, { host: this.#host, sheet: id, row, col, depth: 0 });
  }

  /** The picture a formula shows in its cell (`IMAGE`), if the cell shows one. */
  imageAt(sheet: string, address: string): FormulaImage | undefined {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const pos = parseCell(address);
    if (id === undefined || !pos) return undefined;
    this.#valueAt(id, pos.row, pos.col);
    return this.#images.get(key(id, pos.row, pos.col));
  }

  /** The sparkline a formula draws in its cell (`SPARKLINE`), if the cell draws one. */
  sparklineAt(sheet: string, address: string): FormulaSparkline | undefined {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const pos = parseCell(address);
    if (id === undefined || !pos) return undefined;
    if (this.#byId.get(id)?.cells[cellAddress(pos.row, pos.col)]?.f === undefined) return undefined;
    this.#valueAt(id, pos.row, pos.col);
    return this.#sparks.get(key(id, pos.row, pos.col));
  }

  /** Whether any formula of the sheet is a `SPARKLINE` (so that it is worth asking the cells). */
  hasSparklineFormulas(sheet: string): boolean {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const s = id === undefined ? undefined : this.#byId.get(id);
    if (!s) return false;
    let has = this.#sparkSheets.get(s);
    if (has === undefined) {
      has = (this.#index(s.id)?.formulas ?? []).some((e) => /SPARKLINE\s*\(/i.test(e.cell.f!));
      this.#sparkSheets.set(s, has);
    }
    return has;
  }

  /** Whether the cell is part of a circular reference (it then reads as 0, as in Excel). */
  isCircular(sheet: string, address: string): boolean {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const pos = parseCell(address);
    return id !== undefined && pos !== null && this.#circular.has(key(id, pos.row, pos.col));
  }

  /** Where the sheet has anything: stored cells and what formulas have spilled. */
  usedBounds(sheetId: string): Bounds | null {
    let b = this.#index(sheetId)?.used ?? null;
    for (const sp of this.#spills.values()) {
      if (sp.sheet !== sheetId) continue;
      const r2 = sp.row + sp.rows - 1;
      const c2 = sp.col + sp.cols - 1;
      b = b ? { r1: Math.min(b.r1, sp.row), c1: Math.min(b.c1, sp.col), r2: Math.max(b.r2, r2), c2: Math.max(b.c2, c2) } : { r1: sp.row, c1: sp.col, r2, c2 };
    }
    return b;
  }

  /** If the cell holds a value a formula spilled there, the value and where the formula is. */
  spillAt(sheet: string, row: number, col: number): { value: Value; owner: { row: number; col: number } } | undefined {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const sp = id === undefined ? undefined : this.#spillCells.get(id)?.get(pos(row, col));
    return sp ? { value: sp.values[row - sp.row]![col - sp.col]!, owner: { row: sp.row, col: sp.col } } : undefined;
  }

  /** If the cell holds a formula whose results fill other cells, the cells it fills (itself included). */
  spillRange(sheet: string, row: number, col: number): Bounds | undefined {
    const id = this.#byId.has(sheet) ? sheet : this.#byName.get(sheet.toLowerCase());
    const sp = id === undefined ? undefined : this.#spills.get(key(id, row, col));
    return sp ? { r1: sp.row, c1: sp.col, r2: sp.row + sp.rows - 1, c2: sp.col + sp.cols - 1 } : undefined;
  }

  #valueAt(sheet: string, row: number, col: number): Value {
    const s = this.#byId.get(sheet);
    if (!s) return err("#REF!");
    const cell = s.cells[cellAddress(row, col)];
    if (!cell || (cell.v === undefined && cell.e === undefined && cell.f === undefined)) {
      // Nothing is kept here, but a formula's results may have spilled in.
      const sp = this.#spillCells.get(sheet)?.get(pos(row, col));
      return sp ? sp.values[row - sp.row]![col - sp.col]! : null;
    }
    if (cell.f === undefined) return cell.e !== undefined ? err(cell.e) : cell.v ?? null;
    const k = key(sheet, row, col);
    const hit = this.#cache.get(k);
    if (hit !== undefined) return hit;
    if (this.#inProgress.has(k)) {
      // Something that this cell needs needs this cell.
      if (this.#wb.iteration) {
        this.#heads.add(k);
        return this.#iterPrev.get(k) ?? 0;
      }
      this.#circular.add(k);
      return 0;
    }
    this.#settle(sheet, row, col);
    return this.#cache.get(k) ?? null;
  }

  // ---- working formulas out ----

  /** Works out the cell, after the formula cells it reads, without nesting calls as deep as the chain of formulas is long. */
  #settle(sheet: string, row: number, col: number): void {
    type Job = { sheet: string; row: number; col: number; k: string; post: boolean };
    const stack: Job[] = [{ sheet, row, col, k: key(sheet, row, col), post: false }];
    while (stack.length) {
      const job = stack.pop()!;
      if (job.post) {
        this.#compute(job.sheet, job.row, job.col, job.k);
        if (this.#heads.has(job.k) && !this.#iterating.has(job.k)) this.#iterate(job.sheet, job.row, job.col, job.k);
        continue;
      }
      if (this.#cache.has(job.k) || this.#inProgress.has(job.k)) continue;
      const cell = this.#byId.get(job.sheet)?.cells[cellAddress(job.row, job.col)];
      if (!cell || cell.f === undefined) continue;
      this.#inProgress.add(job.k);
      stack.push({ ...job, post: true });
      for (const p of this.#precedents(job.sheet, cell.f, 0, { row: job.row, col: job.col })) {
        const pk = key(p.sheet, p.row, p.col);
        if (!this.#cache.has(pk) && !this.#inProgress.has(pk)) stack.push({ ...p, k: pk, post: false });
      }
    }
  }

  /**
   * A cell that its own chain reads has just been worked out once, with the chain reading its last value. Works the chain
   * out again, each time reading what the cell came to, until nothing changes by more than the limit or the count is up.
   */
  #iterate(sheet: string, row: number, col: number, k: string): void {
    const settings = this.#wb.iteration;
    this.#iterating.add(k);
    try {
      for (let n = 1; settings && n < settings.maxIterations; n++) {
        const before = new Map<string, Value | undefined>();
        this.#iterPrev.set(k, this.#cache.get(k) ?? 0);
        this.#invalidateKeys([k], undefined, before);
        this.#settle(sheet, row, col);
        let change = 0;
        for (const [at, old] of before) {
          const now = this.#cache.get(at);
          const d = valueChange(old, now);
          if (d > change) change = d;
        }
        if (change <= settings.maxChange) break;
      }
    } finally {
      this.#iterating.delete(k);
      this.#heads.delete(k);
      this.#iterPrev.set(k, this.#cache.get(k) ?? 0);
    }
  }

  #compute(sheet: string, row: number, col: number, k: string): void {
    const cell = this.#byId.get(sheet)!.cells[cellAddress(row, col)]!;
    const frame: Frame = { cells: new Set(), ranges: [], volatile: false };
    this.#frames.push(frame);
    let result: Value | ArrayValue;
    try {
      const ctx: Ctx = { host: this.#host, sheet, row, col, depth: 0 };
      result = evaluate(cell.f!, ctx);
    } finally {
      this.#frames.pop();
      this.#inProgress.delete(k);
    }
    this.#cache.set(k, isArray(result) ? this.#spill(k, sheet, row, col, result, frame) : result);
    // The picture shows only when the cell's value is the text that goes with it (not when `IMAGE` is read by something else).
    if (frame.image && result === frame.image.text) this.#images.set(k, frame.image);
    else this.#images.delete(k);
    if (frame.sparkline && result === "") this.#sparks.set(k, frame.sparkline);
    else this.#sparks.delete(k);
    this.#own(k, frame);
    if (frame.volatile) this.#volatile.add(k);
    else this.#volatile.delete(k);
    if (frame.hidden) this.#hiddenReaders.add(k);
    else this.#hiddenReaders.delete(k);
  }

  /**
   * Lets a formula's results fill the cells beside it, and returns what its own cell is worth: the first result, or
   * `#SPILL!` if something is in the way.
   */
  #spill(owner: string, sheet: string, row: number, col: number, result: ArrayValue, frame: Frame): Value {
    const grid = result.array;
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    this.#unspill(owner);
    const s = this.#byId.get(sheet)!;
    const cells = this.#spillCells.get(sheet) ?? new Map<number, Spill>();
    if (row + rows - 1 > MAX_ROWS || col + cols - 1 > MAX_COLS) return err("#SPILL!");
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue;
        const there = s.cells[cellAddress(row + r, col + c)];
        const blocked = (there && (there.v !== undefined || there.e !== undefined || there.f !== undefined)) || cells.has(pos(row + r, col + c));
        if (blocked) {
          // It reads again when what is in the way goes.
          frame.cells.add(key(sheet, row + r, col + c));
          return err("#SPILL!");
        }
      }
    const spill: Spill = { owner, sheet, row, col, rows, cols, values: grid.map((r) => r.slice()) };
    this.#spills.set(owner, spill);
    this.#spillCells.set(sheet, cells);
    const changed: string[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue;
        cells.set(pos(row + r, col + c), spill);
        changed.push(key(sheet, row + r, col + c));
      }
    // What read these cells before saw them empty (or something else).
    this.#invalidateKeys(changed, owner);
    return grid[0]![0]!;
  }

  /** Takes a formula's spilled results away, and tells what read them. */
  #unspill(owner: string): void {
    const old = this.#spills.get(owner);
    if (!old) return;
    this.#spills.delete(owner);
    const cells = this.#spillCells.get(old.sheet);
    const gone: string[] = [];
    for (let r = 0; r < old.rows; r++)
      for (let c = 0; c < old.cols; c++) {
        if (r === 0 && c === 0) continue;
        if (cells?.get(pos(old.row + r, old.col + c)) === old) cells.delete(pos(old.row + r, old.col + c));
        gone.push(key(old.sheet, old.row + r, old.col + c));
      }
    this.#invalidateKeys(gone, owner);
  }

  /** The formula cells (that aren't worked out yet) a formula reads by its references, so they can be done first. */
  #precedents(sheet: string, source: string, depth = 0, at?: { row: number; col: number }): { sheet: string; row: number; col: number }[] {
    let tree;
    try {
      tree = parseFormula(source);
    } catch (e) {
      if (e instanceof FormulaSyntaxError) return [];
      throw e;
    }
    const out: { sheet: string; row: number; col: number }[] = [];
    const nodes = refsIn(tree);
    // Defined names are followed to the references they hold.
    const visit = (n: ReturnType<typeof refsIn>[number]) => {
      let id = sheet;
      if (n.sheet !== undefined) {
        const found = this.#byName.get(n.sheet.toLowerCase());
        if (found === undefined) return;
        id = found;
      }
      const ix = this.#index(id);
      if (!ix) return;
      const b = n.b ?? n.a;
      const r1 = Math.min(n.a.row ?? 1, b.row ?? MAX_ROWS);
      const r2 = Math.max(n.a.row ?? 1, b.row ?? MAX_ROWS);
      const c1 = Math.min(n.a.col ?? 1, b.col ?? MAX_COLS);
      const c2 = Math.max(n.a.col ?? 1, b.col ?? MAX_COLS);
      const area = (r2 - r1 + 1) * (c2 - c1 + 1);
      const formulas = ix.formulas;
      if (area <= formulas.length) {
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (ix.sheet.cells[cellAddress(r, c)]?.f !== undefined) out.push({ sheet: id, row: r, col: c });
      } else {
        for (const f of formulas) if (f.row >= r1 && f.row <= r2 && f.col >= c1 && f.col <= c2) out.push({ sheet: id, row: f.row, col: f.col });
      }
    };
    nodes.forEach(visit);
    // References to parts of tables (and a table's name on its own) stand for ranges too.
    const tables: ReturnType<typeof parseFormula>[] = [];
    const walkTables = (n: ReturnType<typeof parseFormula>): void => {
      switch (n.t) {
        case "tref":
          tables.push(n);
          break;
        case "name":
          if (findTable(this.#wb, n.name) && this.#nameFormula(n.name) === undefined) tables.push({ t: "tref", table: n.name, area: "data" });
          break;
        case "call":
          n.args.forEach(walkTables);
          break;
        case "unary":
        case "percent":
        case "paren":
          walkTables(n.arg);
          break;
        case "binary":
          walkTables(n.left);
          walkTables(n.right);
          break;
        case "array":
          n.rows.forEach((r) => r.forEach(walkTables));
          break;
      }
    };
    walkTables(tree);
    for (const t of tables) {
      if (t.t !== "tref") continue;
      const r = resolveTableRef(t, this.#wb, { sheet, row: at?.row ?? 0, col: at?.col ?? 0 });
      const ix = r && this.#index(r.sheet);
      if (!r || !ix) continue;
      for (const f of ix.formulas) if (f.row >= r.bounds.r1 && f.row <= r.bounds.r2 && f.col >= r.bounds.c1 && f.col <= r.bounds.c2) out.push({ sheet: r.sheet, row: f.row, col: f.col });
    }
    if (depth < 5) this.#nameRefs(tree, sheet, depth, out);
    return out;
  }

  #nameRefs(tree: ReturnType<typeof parseFormula>, sheet: string, depth: number, out: { sheet: string; row: number; col: number }[]): void {
    const names = new Set<string>();
    const walk = (n: ReturnType<typeof parseFormula>): void => {
      switch (n.t) {
        case "name":
          names.add(n.name);
          break;
        case "call":
          n.args.forEach(walk);
          break;
        case "unary":
        case "percent":
        case "paren":
          walk(n.arg);
          break;
        case "binary":
          walk(n.left);
          walk(n.right);
          break;
      }
    };
    walk(tree);
    for (const name of names) {
      const source = this.#nameFormula(name);
      if (source !== undefined) out.push(...this.#precedents(sheet, source, depth + 1));
    }
  }

  #nameFormula(name: string): string | undefined {
    const names = this.#wb.names;
    if (!names) return undefined;
    const lower = name.toLowerCase();
    for (const [n, f] of Object.entries(names)) if (n.toLowerCase() === lower) return f;
    return undefined;
  }

  // ---- what depends on what ----

  #own(owner: string, frame: Frame): void {
    this.#disown(owner);
    const ranges = frame.ranges.map(({ sheet, bounds }) => ({ sheet, dep: { owner, bounds } }));
    this.#owned.set(owner, { cells: frame.cells, ranges });
    for (const c of frame.cells) {
      let set = this.#cellDependents.get(c);
      if (!set) this.#cellDependents.set(c, (set = new Set()));
      set.add(owner);
    }
    for (const { sheet, dep } of ranges) {
      let set = this.#rangeDependents.get(sheet);
      if (!set) this.#rangeDependents.set(sheet, (set = new Set()));
      set.add(dep);
    }
  }

  #disown(owner: string): void {
    const old = this.#owned.get(owner);
    if (!old) return;
    for (const c of old.cells) this.#cellDependents.get(c)?.delete(owner);
    for (const { sheet, dep } of old.ranges) this.#rangeDependents.get(sheet)?.delete(dep);
    this.#owned.delete(owner);
  }

  #invalidate(changed: [string, number, number][], hiddenChanged = false): void {
    // A change that touches more than a few cells is cheaper to handle by starting over than by looking up each one.
    const ranges = [...this.#rangeDependents.values()].reduce((n, s) => n + s.size, 0);
    if (changed.length > 200 && changed.length * ranges > 2_000_000) {
      this.#reset();
      return;
    }
    this.#invalidateKeys([...changed.map(([sheet, row, col]) => key(sheet, row, col)), ...this.#volatile, ...(hiddenChanged ? this.#hiddenReaders : [])]);
  }

  /**
   * Throws away the value of these cells (when they hold formulas) and of everything that reads them, so it is worked out
   * again. `except` is a formula that is being worked out right now and must be left alone.
   */
  #invalidateKeys(seeds: Iterable<string>, except?: string, dropped?: Map<string, Value | undefined>): void {
    const queue: string[] = [];
    const seen = new Set<string>();
    const push = (k: string) => {
      if (k !== except && !seen.has(k)) {
        seen.add(k);
        queue.push(k);
      }
    };
    for (const k of seeds) {
      push(k);
      const [sheet, r, c] = k.split("|") as [string, string, string];
      this.#touchRanges(sheet, Number(r), Number(c), push);
      // Something typed into a spilled cell is in the way of the formula that filled it.
      const inside = this.#spillCells.get(sheet)?.get(pos(Number(r), Number(c)));
      if (inside) push(inside.owner);
    }
    while (queue.length) {
      const k = queue.pop()!;
      dropped?.set(k, this.#cache.get(k));
      this.#cache.delete(k);
      this.#images.delete(k);
      this.#sparks.delete(k);
      this.#circular.delete(k);
      this.#volatile.delete(k);
      this.#hiddenReaders.delete(k);
      const [sheet, r, c] = k.split("|") as [string, string, string];
      // A formula that spilled no longer has what it put in the other cells; they are read again.
      if (this.#spills.has(k)) this.#unspill(k);
      if (this.#byId.get(sheet)?.cells[cellAddress(Number(r), Number(c))]?.f !== undefined) this.#dirty.add(k);
      for (const d of this.#cellDependents.get(k) ?? []) push(d);
      this.#touchRanges(sheet, Number(r), Number(c), push);
      this.#disown(k);
    }
  }

  #touchRanges(sheet: string, row: number, col: number, push: (k: string) => void): void {
    const set = this.#rangeDependents.get(sheet);
    if (!set) return;
    for (const dep of set) if (inBounds(dep.bounds, row, col)) push(dep.owner);
  }

  // ---- what formulas can ask of the workbook ----

  /** What `GETPIVOTDATA` finds: worked out from the pivot table's source, as a refreshed pivot table would show it. */
  #pivotData(sheet: string, row: number, col: number, dataField: string, pairs: readonly (readonly [string, Value])[]): Value {
    const s = this.#byId.get(sheet);
    const pivot = s ? pivotAt(s, cellAddress(row, col)) : undefined;
    if (!s || !pivot) return err("#REF!");
    const from = pivotSourceRange(this.#wb, pivot.source, s.name);
    if (!from) return err("#REF!");
    // The formula depends on the records, and on where the pivot table is drawn (which changes when it is changed).
    this.#host.dependOn(from.sheet.id, from.bounds);
    const drawn = pivot.range.split(":").map((a) => parseCell(a)!);
    this.#host.dependOn(s.id, { r1: drawn[0]!.row, c1: drawn[0]!.col, r2: drawn[drawn.length - 1]!.row, c2: drawn[drawn.length - 1]!.col });
    let made = this.#pivotRenders.get(pivot.id);
    if (!made) {
      const src = readPivotSource(this.#wb, pivot, s.name, (sh, address) => {
        const at = parseCell(address)!;
        return this.#valueAt(sh.id, at.row, at.col);
      });
      if (!src) return err("#REF!");
      try {
        made = { src, render: renderPivot(pivot, src) };
      } catch {
        return err("#REF!");
      }
      this.#pivotRenders.set(pivot.id, made);
    }
    const found = pivotLookup(pivot, made.src, made.render, dataField, pairs);
    if (!found) return err("#REF!");
    return found.e ? err(found.e) : (found.v ?? null);
  }

  #makeHost(): Host {
    const record = (fn: (f: Frame) => void) => {
      const f = this.#frames[this.#frames.length - 1];
      if (f) fn(f);
    };
    return {
      cellValue: (sheet, row, col) => {
        record((f) => f.cells.add(key(sheet, row, col)));
        return this.#valueAt(sheet, row, col);
      },
      peek: (sheet, row, col) => this.#valueAt(sheet, row, col),
      dependOn: (sheet, bounds) => record((f) => f.ranges.push({ sheet, bounds })),
      eachCell: (sheet, bounds, fn) => {
        record((f) => f.ranges.push({ sheet, bounds }));
        const ix = this.#index(sheet);
        if (!ix) return;
        const area = (bounds.r2 - bounds.r1 + 1) * (bounds.c2 - bounds.c1 + 1);
        if (area <= ix.entries.length) {
          for (let r = bounds.r1; r <= bounds.r2; r++)
            for (let c = bounds.c1; c <= bounds.c2; c++) {
              const cell = ix.sheet.cells[cellAddress(r, c)];
              if (cell && (cell.v !== undefined || cell.e !== undefined || cell.f !== undefined)) fn(r, c, this.#valueAt(sheet, r, c));
            }
        } else {
          for (const e of ix.entries) if (inBounds(bounds, e.row, e.col)) fn(e.row, e.col, this.#valueAt(sheet, e.row, e.col));
        }
        // And what formulas have spilled into the range.
        for (const sp of this.#spills.values()) {
          if (sp.sheet !== sheet) continue;
          for (let r = Math.max(sp.row, bounds.r1); r <= Math.min(sp.row + sp.rows - 1, bounds.r2); r++)
            for (let c = Math.max(sp.col, bounds.c1); c <= Math.min(sp.col + sp.cols - 1, bounds.c2); c++) {
              if (r === sp.row && c === sp.col) continue;
              const v = sp.values[r - sp.row]![c - sp.col]!;
              if (v !== null) fn(r, c, v);
            }
        }
      },
      sheetId: (name) => this.#byName.get(name.toLowerCase()),
      used: (sheet) => this.usedBounds(sheet),
      nameFormula: (name) => this.#nameFormula(name),
      tableRange: (ref, sheet, row, col) => {
        const r = ref.sheet?.startsWith("[") ? resolveExternalTableRef(ref, this.#wb) : resolveTableRef(ref, this.#wb, { sheet, row, col });
        return r ? { sheet: r.sheet, r1: r.bounds.r1, c1: r.bounds.c1, r2: r.bounds.r2, c2: r.bounds.c2 } : null;
      },
      sheetName: (id) => this.#byId.get(id)?.name ?? "",
      sheetIndex: (id) => this.#wb.sheets.findIndex((s) => s.id === id),
      formulaText: (sheet, row, col) => {
        record((f) => f.cells.add(key(sheet, row, col))); // the answer changes when the cell does
        return this.#byId.get(sheet)?.cells[cellAddress(row, col)]?.f;
      },
      formulaHidden: (sheet, row, col) => {
        const s = this.#byId.get(sheet);
        return !!s?.protection && hideAt(s, row, col, s.cells[cellAddress(row, col)]);
      },
      sheetCount: () => this.#wb.sheets.length,
      hasFormula: (sheet, row, col) => {
        record((f) => f.cells.add(key(sheet, row, col)));
        return this.#byId.get(sheet)?.cells[cellAddress(row, col)]?.f !== undefined;
      },
      pivotData: (sheet, row, col, dataField, pairs) => this.#pivotData(sheet, row, col, dataField, pairs),
      rowHidden: (sheet, row, filteredOnly) => {
        record((f) => (f.hidden = true));
        return rowIsHidden(this.#byId.get(sheet), row, filteredOnly);
      },
      now: () => (this.#opts.now ?? nowSerial)(),
      random: () => (this.#opts.random ?? Math.random)(),
      volatile: () => record((f) => (f.volatile = true)),
      image: (image) => record((f) => (f.image = image)),
      sparkline: (sparkline) => record((f) => (f.sparkline = sparkline)),
    };
  }
}
