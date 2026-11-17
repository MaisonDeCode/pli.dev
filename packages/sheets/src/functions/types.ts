import type { Bounds } from "../address";
import type { SparklineGroup } from "../model";
import type { Node } from "../formula";
import type { ArrayValue, Value } from "../values";

/** A reference to cells, kept as a reference (not read) until a function needs the values. */
export interface RangeRef {
  readonly ref: true;
  /** The sheet's id. */
  readonly sheet: string;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}

/** A function made with `LAMBDA`, which `LET` can name and `MAP`, `REDUCE` and the others can call. */
export interface Lambda {
  readonly lambda: true;
  readonly params: readonly string[];
  readonly body: Node;
  /** How many of the parameters must be given, when the rest are optional (`LAMBDA(x, [y], …)`); all of them when missing. */
  readonly required?: number;
  /** Names in scope where it was made. */
  readonly vars?: ReadonlyMap<string, Arg>;
  /** For a function named without brackets (`SUM` in `BYROW(A1:C3, SUM)`): its name. It takes whatever arguments it is given. */
  readonly fn?: string;
  /** For several functions side by side (`HSTACK(SUM, COUNT)` given to `GROUPBY`): the functions. */
  readonly many?: readonly Lambda[];
  /** For functions given with labels (`VSTACK(HSTACK(COUNT, SUM), {"Count","Total"})` given to `GROUPBY`): a name for each. */
  readonly labels?: readonly Value[];
}

export type Arg = Value | ArrayValue | RangeRef | Lambda;

/** A picture that a formula (`IMAGE`) puts in its cell. */
export interface FormulaImage {
  /** An `https://` address, or a `data:` URI. */
  src: string;
  /** The cell's value: the description, else the address. */
  text: string;
  alt?: string;
  /** 0 fit the cell, 1 fill it, 2 the picture's own size, 3 the `height` and `width` given. */
  sizing: 0 | 1 | 2 | 3;
  height?: number;
  width?: number;
}

/** A sparkline a formula (`SPARKLINE`) draws in its cell: the numbers, and the look. */
export interface FormulaSparkline {
  values: (number | null)[];
  group: Omit<SparklineGroup, "id" | "items">;
  /** Where each value sits along the x axis, when the data is two columns (x, y); with `xmin` and `xmax` the axis runs between them. */
  xs?: (number | null)[];
  xmin?: number;
  xmax?: number;
  /** A `"bar"` chart: one stacked bar, a segment for each value, in these colours (`color1`, `color2`…), to a total of `max` if given. */
  bar?: { colors: string[]; max?: number };
}

/** What the evaluator needs from the workbook. */
export interface Host {
  /** The value of a cell, worked out first if it holds a formula. */
  cellValue(sheet: string, row: number, col: number): Value;
  /** The value of a cell without noting that the formula depends on it; use with `dependOn`. */
  peek(sheet: string, row: number, col: number): Value;
  /** Notes that the formula being worked out depends on everything in `bounds`. */
  dependOn(sheet: string, bounds: Bounds): void;
  /** Calls `fn` for every cell in `bounds` that holds something, in no particular order, and records the dependency. */
  eachCell(sheet: string, bounds: Bounds, fn: (row: number, col: number, value: Value) => void): void;
  /** The sheet's id from its name, ignoring capitals. */
  sheetId(name: string): string | undefined;
  /** The extent of what is in the sheet, or null if it is empty. */
  used(sheet: string): Bounds | null;
  /** The formula a defined name stands for. */
  nameFormula(name: string): string | undefined;
  /** The cells that part of a table stands for, as seen from the cell at `row`, `col` of `sheet` (a sheet id); null when they aren't there. */
  tableRange(ref: Extract<Node, { t: "tref" }>, sheet: string, row: number, col: number): { sheet: string; r1: number; c1: number; r2: number; c2: number } | null;
  sheetName(id: string): string;
  sheetIndex(id: string): number;
  /** The formula in a cell, without its `=`, if it holds one. */
  formulaText(sheet: string, row: number, col: number): string | undefined;
  /** Whether the cell's formula is hidden: its sheet is protected and the cell (or its row, column or sheet) hides formulas. */
  formulaHidden?(sheet: string, row: number, col: number): boolean;
  /** How many sheets there are. */
  sheetCount(): number;
  /** Whether the row is hidden; with `filteredOnly`, whether a filter hid it (rows folded away in a group or hidden by hand don't count). Notes that the formula must be worked out again when rows are hidden or shown. */
  rowHidden(sheet: string, row: number, filteredOnly: boolean): boolean;
  /** Whether the cell holds a formula. */
  hasFormula(sheet: string, row: number, col: number): boolean;
  /** What the pivot table with this cell in it shows for a value and some items (`GETPIVOTDATA`): a number, text or an error. */
  pivotData(sheet: string, row: number, col: number, dataField: string, pairs: readonly (readonly [string, Value])[]): Value;
  /** Says that the cell being worked out shows this picture (when its value is `image.text`). */
  image(image: FormulaImage): void;
  /** Says that the cell being worked out draws this sparkline (when its value is empty text). */
  sparkline(sparkline: FormulaSparkline): void;
  now(): number;
  random(): number;
  /** Marks the cell being worked out as one that must be worked out again on every change (`NOW`, `RAND`, `OFFSET`…). */
  volatile(): void;
}

export interface Ctx {
  host: Host;
  /** Where the formula sits. */
  sheet: string;
  row: number;
  col: number;
  /** Nesting depth, to stop runaway defined names. */
  depth: number;
  /** Names made by `LET` and by the parameters of a `LAMBDA`, in lower case. */
  vars?: ReadonlyMap<string, Arg>;
}

export interface FunctionDef {
  min: number;
  max: number;
  /** Arguments arrive as functions that work them out when called, so `IF` need not evaluate the branch it skips. */
  lazy?: boolean;
  volatile?: boolean;
  fn(args: any[], ctx: Ctx): Arg;
}
