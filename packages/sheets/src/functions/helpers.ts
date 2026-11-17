import { inBounds } from "../address";
import { MAX_COLS, MAX_ROWS } from "../model";
import { arrayOf, compareValues, isArray, isError, NA, toNumber, VALUE, type ArrayValue, type ErrorValue, type Value } from "../values";
import type { Arg, Ctx, FunctionDef, Lambda, RangeRef } from "./types";

export function isLambda(a: unknown): a is Lambda {
  return typeof a === "object" && a !== null && "lambda" in a;
}

/** A function where a value was wanted is `#VALUE!`. */
const plain = (a: Exclude<Arg, RangeRef | ArrayValue>): Value => (isLambda(a) ? VALUE : a);

export function isRef(a: unknown): a is RangeRef {
  return typeof a === "object" && a !== null && "ref" in a && (a as { ref?: unknown }).ref === true;
}

export function makeRef(sheet: string, r1: number, c1: number, r2: number, c2: number): RangeRef {
  return { ref: true, sheet, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

export function isWholeColumns(r: RangeRef): boolean {
  return r.r1 === 1 && r.r2 === MAX_ROWS;
}
export function isWholeRows(r: RangeRef): boolean {
  return r.c1 === 1 && r.c2 === MAX_COLS;
}

/** The part of a reference that can hold anything: whole columns and rows are cut down to what the sheet uses. */
export function clip(r: RangeRef, ctx: Ctx): RangeRef | null {
  if (r.r2 - r.r1 < 5000 && r.c2 - r.c1 < 5000 && (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) < 2_000_000) return r;
  const used = ctx.host.used(r.sheet);
  if (!used) return null;
  const r1 = Math.max(r.r1, used.r1);
  const c1 = Math.max(r.c1, used.c1);
  const r2 = Math.min(r.r2, used.r2);
  const c2 = Math.min(r.c2, used.c2);
  return r1 > r2 || c1 > c2 ? null : makeRef(r.sheet, r1, c1, r2, c2);
}

export function refRows(r: RangeRef): number {
  return r.r2 - r.r1 + 1;
}
export function refCols(r: RangeRef): number {
  return r.c2 - r.c1 + 1;
}

/** The cell at row `i`, column `j` (0-based) of a reference. Call `depend` for the reference first. */
export function refCell(r: RangeRef, i: number, j: number, ctx: Ctx): Value {
  return ctx.host.peek(r.sheet, r.r1 + i, r.c1 + j);
}

/** Notes that the formula depends on every cell of the reference. */
export function depend(r: RangeRef, ctx: Ctx): void {
  ctx.host.dependOn(r.sheet, r);
}

/** A reference or array as rows of values. Whole columns and rows are cut to what the sheet uses. */
export function toGrid(a: Arg, ctx: Ctx): Value[][] {
  if (isRef(a)) {
    const r = clip(a, ctx);
    if (!r) return [[null]];
    depend(a, ctx);
    const rows: Value[][] = [];
    for (let i = 0; i < refRows(r); i++) {
      const row: Value[] = [];
      for (let j = 0; j < refCols(r); j++) row.push(refCell(r, i, j, ctx));
      rows.push(row);
    }
    return rows;
  }
  if (isArray(a)) return a.array;
  return [[plain(a)]];
}

/** A single value from anything: a one-cell reference, the cell of a longer one on the formula's own row or column, or an array's first item. */
export function scalar(a: Arg, ctx: Ctx): Value {
  if (isRef(a)) {
    if (a.r1 === a.r2 && a.c1 === a.c2) return ctx.host.cellValue(a.sheet, a.r1, a.c1);
    if (a.sheet === ctx.sheet) {
      if (a.c1 === a.c2 && inBounds(a, ctx.row, a.c1)) return ctx.host.cellValue(a.sheet, ctx.row, a.c1);
      if (a.r1 === a.r2 && inBounds(a, a.r1, ctx.col)) return ctx.host.cellValue(a.sheet, a.r1, ctx.col);
    }
    return VALUE;
  }
  if (isArray(a)) return a.array[0]?.[0] ?? null;
  return plain(a);
}

export function isMulti(a: Arg): boolean {
  if (isRef(a)) return a.r1 !== a.r2 || a.c1 !== a.c2;
  if (isArray(a)) return a.array.length > 1 || (a.array[0]?.length ?? 0) > 1;
  return false;
}

/** Calls `fn` with each value that is there: the cells of a reference that hold something, or all of an array. */
export function eachValue(a: Arg, ctx: Ctx, fn: (v: Value) => void): void {
  if (isRef(a)) {
    depend(a, ctx); // the whole reference, not just the part in use now: a cell filled in later changes the answer
    const r = clip(a, ctx);
    if (!r) return;
    ctx.host.eachCell(a.sheet, r, (_row, _col, v) => fn(v));
  } else if (isArray(a)) {
    for (const row of a.array) for (const v of row) fn(v);
  } else fn(plain(a));
}

/** The first error found among the values, if any. */
export function firstError(vs: readonly Value[]): ErrorValue | undefined {
  for (const v of vs) if (isError(v)) return v;
  return undefined;
}

// ---- functions on values that also work on arrays ----

/** Applies `fn` to every combination of items from arrays and ranges, repeating a single row or column along the other. */
export function broadcast(args: Arg[], ctx: Ctx, fn: (vs: Value[]) => Value): Arg {
  if (!args.some(isMulti)) return fn(args.map((a) => scalar(a, ctx)));
  const grids = args.map((a) => toGrid(a, ctx));
  const rows = Math.max(...grids.map((g) => g.length));
  const cols = Math.max(...grids.map((g) => g[0]?.length ?? 0));
  const out: Value[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: Value[] = [];
    for (let j = 0; j < cols; j++) {
      const vs: Value[] = [];
      let missing = false;
      for (const g of grids) {
        const ri = g.length === 1 ? 0 : i;
        const cj = (g[0]?.length ?? 0) === 1 ? 0 : j;
        if (ri >= g.length || cj >= (g[ri]?.length ?? 0)) missing = true;
        else vs.push(g[ri]![cj]!);
      }
      row.push(missing ? NA : fn(vs));
    }
    out.push(row);
  }
  return arrayOf(out);
}

/** A function of plain values that is applied item by item when given arrays or ranges. The first error among the arguments is returned. */
export function simple(min: number, max: number, fn: (vs: Value[]) => Value, options: { volatile?: boolean; passErrors?: boolean } = {}): FunctionDef {
  return {
    min,
    max,
    ...(options.volatile ? { volatile: true } : {}),
    fn: (args, ctx) =>
      broadcast(args, ctx, (vs) => {
        if (!options.passErrors) {
          const e = firstError(vs);
          if (e) return e;
        }
        return fn(vs);
      }),
  };
}

/** A number argument: the number, or the error to return. */
export function num(v: Value | undefined, fallback?: number): number | ErrorValue {
  if (v === undefined || v === null) return fallback ?? 0;
  return toNumber(v);
}

/**
 * The numbers in a function's arguments the way `SUM` reads them: in a range or array only the numbers count; typed
 * directly, a number, TRUE, FALSE or text that reads as a number counts. Returns the first error met.
 */
export function numbersIn(args: Arg[], ctx: Ctx, options: { texts?: boolean } = {}): number[] | ErrorValue {
  const out: number[] = [];
  let error: ErrorValue | undefined;
  for (const a of args) {
    if (isRef(a) || isArray(a)) {
      eachValue(a, ctx, (v) => {
        if (error) return;
        if (typeof v === "number") out.push(v);
        else if (isError(v)) error = v;
        else if (options.texts && typeof v === "string") out.push(0);
      });
    } else {
      const v = plain(a);
      if (isError(v)) return v;
      if (v === null) continue;
      const n = toNumber(v);
      if (isError(n)) return n;
      out.push(n);
    }
    if (error) return error;
  }
  return out;
}

// ---- criteria: COUNTIF, SUMIF and the others ----

export function wildcardRegExp(pattern: string): RegExp {
  return new RegExp("^" + wildcardSource(pattern) + "$", "i");
}

/** The regular expression source for a pattern with `*` (any text), `?` (any one character) and `~` (take the next one as it is). */
export function wildcardSource(pattern: string): string {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "~" && i + 1 < pattern.length) re += escapeRe(pattern[++i]!);
    else if (c === "*") re += "[\\s\\S]*?";
    else if (c === "?") re += "[\\s\\S]";
    else re += escapeRe(c);
  }
  return re;
}

function escapeRe(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A test for a criterion such as `">5"`, `"apple*"`, `5` or `"<>"`. */
export function criterion(crit: Value): (v: Value) => boolean {
  if (isError(crit)) return (v) => isError(v) && v.error === crit.error;
  if (crit === null) return (v) => v === null || v === "";
  if (typeof crit !== "string") {
    const target = crit;
    return (v) => (typeof target === "boolean" ? v === target : typeof v === "number" && v === target);
  }
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(crit)!;
  const op = m[1] ?? "=";
  const rest = m[2]!;
  const asNumber = rest.trim() === "" ? null : toNumber(rest);
  const numeric = asNumber !== null && !isError(asNumber) ? asNumber : null;
  const upper = rest.toUpperCase();
  const asBool = upper === "TRUE" ? true : upper === "FALSE" ? false : null;
  if (numeric !== null || asBool !== null) {
    const target: Value = numeric !== null ? numeric : asBool;
    return (v) => {
      if (isError(v)) return false;
      if (typeof target === "number") {
        if (typeof v === "number") return cmp(op, v - target, v === target);
        if (typeof v === "string" && op === "<>") return true;
        if (typeof v === "string" || v === null || typeof v === "boolean") return op === "<>";
        return false;
      }
      if (typeof v === "boolean") return cmp(op, Number(v) - Number(target), v === target);
      return op === "<>";
    };
  }
  if (op === "=" || op === "<>") {
    if (rest === "") return op === "=" ? (v) => v === null || v === "" : (v) => v !== null && v !== "";
    const wild = /[*?~]/.test(rest);
    const re = wild ? wildcardRegExp(rest) : null;
    const lower = rest.toLowerCase();
    return (v) => {
      const hit = typeof v === "string" && (re ? re.test(v) : v.toLowerCase() === lower);
      return op === "=" ? hit : !hit;
    };
  }
  return (v) => typeof v === "string" && cmp(op, compareValues(v, rest), v.toLowerCase() === rest.toLowerCase());
}

function cmp(op: string, diff: number, equal: boolean): boolean {
  switch (op) {
    case "=":
      return equal;
    case "<>":
      return !equal;
    case "<":
      return diff < 0 && !equal;
    case ">":
      return diff > 0 && !equal;
    case "<=":
      return diff <= 0 || equal;
    default:
      return diff >= 0 || equal;
  }
}

export type { ArrayValue };
