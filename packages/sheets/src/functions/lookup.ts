import { colName } from "../address";
import { parseFormula, FormulaSyntaxError } from "../formula";
import { refFromNode } from "../refnode";
import { arrayOf, compareValues, isError, NA, REF, toNumber, toText, typeRank, VALUE, type Value } from "../values";
import { MAX_COLS, MAX_ROWS } from "../model";
import { depend, isRef, makeRef, refCell, scalar, toGrid, wildcardRegExp } from "./helpers";
import type { Arg, Ctx, FunctionDef, RangeRef } from "./types";

/** Rows of values with positions counted from the top-left, whether it came from cells or an array. */
interface Table {
  rows: number;
  cols: number;
  at(i: number, j: number): Value;
  /** The reference it came from, if it came from cells. */
  ref?: RangeRef;
}

function tableOf(a: Arg, ctx: Ctx): Table {
  if (isRef(a)) {
    const used = ctx.host.used(a.sheet);
    const r2 = Math.min(a.r2, used ? Math.max(used.r2, a.r1) : a.r1);
    const c2 = Math.min(a.c2, used ? Math.max(used.c2, a.c1) : a.c1);
    const r: RangeRef = makeRef(a.sheet, a.r1, a.c1, r2, c2);
    depend(a, ctx);
    return { rows: r2 - a.r1 + 1, cols: c2 - a.c1 + 1, at: (i, j) => refCell(r, i, j, ctx), ref: a };
  }
  const g = toGrid(a, ctx);
  return { rows: g.length, cols: g[0]?.length ?? 0, at: (i, j) => g[i]?.[j] ?? null };
}

const sameKind = (a: Value, b: Value) => !isError(a) && !isError(b) && a !== null && b !== null && typeRank(a) === typeRank(b);

function equalLookup(a: Value, b: Value): boolean {
  if (!sameKind(a, b)) return false;
  if (typeof a === "string") return a.toLowerCase() === (b as string).toLowerCase();
  return a === b;
}

/** Position of an exact match in a list, or -1. `from` 1 searches forwards, -1 backwards. */
function findExact(target: Value, size: number, at: (i: number) => Value, wildcard: boolean, dir = 1): number {
  const re = wildcard && typeof target === "string" && /[*?~]/.test(target) ? wildcardRegExp(target) : null;
  for (let k = 0; k < size; k++) {
    const i = dir === 1 ? k : size - 1 - k;
    const v = at(i);
    if (re ? typeof v === "string" && re.test(v) : equalLookup(target, v)) return i;
  }
  return -1;
}

/** Largest value not above the target (`mode` 1) or smallest not below it (`mode` -1), taking the last of equals; -1 if none. */
function findApprox(target: Value, size: number, at: (i: number) => Value, mode: 1 | -1): number {
  let best = -1;
  for (let i = 0; i < size; i++) {
    const v = at(i);
    if (!sameKind(target, v)) continue;
    const c = compareValues(v, target);
    if (mode === 1 ? c > 0 : c < 0) continue;
    if (best < 0 || (mode === 1 ? compareValues(v, at(best)) >= 0 : compareValues(v, at(best)) <= 0)) best = i;
  }
  return best;
}

function vlookup(horizontal: boolean): FunctionDef {
  return {
    min: 3,
    max: 4,
    fn: (args, ctx) => {
      const key = scalar(args[0], ctx);
      if (isError(key)) return key;
      const t = tableOf(args[1], ctx);
      const idx = toNumber(scalar(args[2], ctx));
      if (isError(idx)) return idx;
      const approx = args[3] === undefined ? true : (() => { const b = scalar(args[3], ctx); return b === null ? false : b === true || (typeof b === "number" && b !== 0); })();
      const k = Math.trunc(idx);
      const limit = horizontal ? t.rows : t.cols;
      if (k < 1) return VALUE;
      if (k > limit) return REF;
      const size = horizontal ? t.cols : t.rows;
      const at = (i: number) => (horizontal ? t.at(0, i) : t.at(i, 0));
      const found = approx ? findApprox(key, size, at, 1) : findExact(key, size, at, true);
      if (found < 0) return NA;
      return horizontal ? t.at(k - 1, found) : t.at(found, k - 1);
    },
  };
}

function matchPosition(args: Arg[], ctx: Ctx): number | Value {
  const key = scalar(args[0]!, ctx);
  if (isError(key)) return key;
  const t = tableOf(args[1]!, ctx);
  if (t.rows !== 1 && t.cols !== 1) return NA;
  const size = t.rows === 1 ? t.cols : t.rows;
  const at = (i: number) => (t.rows === 1 ? t.at(0, i) : t.at(i, 0));
  const type = args[2] === undefined ? 1 : toNumber(scalar(args[2], ctx));
  if (isError(type)) return type;
  const found = type === 0 ? findExact(key, size, at, true) : findApprox(key, size, at, type > 0 ? 1 : -1);
  return found < 0 ? NA : found + 1;
}

/** A sub-block of a reference or array as a reference or array. */
function slice(a: Arg, ctx: Ctx, r1: number, c1: number, r2: number, c2: number): Arg {
  if (isRef(a)) return makeRef(a.sheet, a.r1 + r1, a.c1 + c1, a.r1 + r2, a.c1 + c2);
  const g = toGrid(a, ctx);
  const out = g.slice(r1, r2 + 1).map((row) => row.slice(c1, c2 + 1));
  return out.length === 1 && out[0]!.length === 1 ? out[0]![0]! : arrayOf(out);
}

export const lookup: Record<string, FunctionDef> = {
  VLOOKUP: vlookup(false),
  HLOOKUP: vlookup(true),
  MATCH: { min: 2, max: 3, fn: (args, ctx) => matchPosition(args, ctx) as Value },
  XMATCH: {
    min: 2,
    max: 4,
    fn: (args, ctx) => {
      const key = scalar(args[0], ctx);
      if (isError(key)) return key;
      const t = tableOf(args[1], ctx);
      const mode = args[2] === undefined ? 0 : toNumber(scalar(args[2], ctx));
      const search = args[3] === undefined ? 1 : toNumber(scalar(args[3], ctx));
      if (isError(mode)) return mode;
      if (isError(search)) return search;
      const size = t.rows === 1 ? t.cols : t.rows;
      const at = (i: number) => (t.rows === 1 ? t.at(0, i) : t.at(i, 0));
      const found = xFind(key, size, at, mode, search < 0 ? -1 : 1);
      return found < 0 ? NA : found + 1;
    },
  },
  XLOOKUP: {
    min: 3,
    max: 6,
    fn: (args, ctx) => {
      const key = scalar(args[0], ctx);
      if (isError(key)) return key;
      const look = tableOf(args[1], ctx);
      if (look.rows !== 1 && look.cols !== 1) return VALUE;
      const size = look.rows === 1 ? look.cols : look.rows;
      const at = (i: number) => (look.rows === 1 ? look.at(0, i) : look.at(i, 0));
      const mode = args[4] === undefined ? 0 : toNumber(scalar(args[4], ctx));
      const search = args[5] === undefined ? 1 : toNumber(scalar(args[5], ctx));
      if (isError(mode)) return mode;
      if (isError(search)) return search;
      const found = xFind(key, size, at, mode, search < 0 ? -1 : 1);
      if (found < 0) return args[3] === undefined ? NA : (args[3] as Value);
      const ret = args[2] as Arg;
      const rows = isRef(ret) ? ret.r2 - ret.r1 + 1 : toGrid(ret, ctx).length;
      const cols = isRef(ret) ? ret.c2 - ret.c1 + 1 : toGrid(ret, ctx)[0]?.length ?? 0;
      const pick = look.rows === 1 ? slice(ret, ctx, 0, found, rows - 1, found) : slice(ret, ctx, found, 0, found, cols - 1);
      return pick;
    },
  },
  LOOKUP: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const key = scalar(args[0], ctx);
      if (isError(key)) return key;
      const t = tableOf(args[1], ctx);
      const vector = t.rows === 1 || t.cols === 1;
      const size = vector ? Math.max(t.rows, t.cols) : t.rows;
      const at = (i: number) => (t.rows === 1 ? t.at(0, i) : t.at(i, 0));
      const found = findApprox(key, size, at, 1);
      if (found < 0) return NA;
      if (args[2] !== undefined) {
        const r = tableOf(args[2], ctx);
        return r.rows === 1 ? r.at(0, found) : r.at(found, 0);
      }
      return vector ? at(found) : t.at(found, t.cols - 1);
    },
  },
  INDEX: {
    min: 2,
    max: 4,
    fn: (args, ctx) => {
      const a = args[0] as Arg;
      const rows = isRef(a) ? Math.min(a.r2 - a.r1 + 1, MAX_ROWS) : toGrid(a, ctx).length;
      const cols = isRef(a) ? Math.min(a.c2 - a.c1 + 1, MAX_COLS) : toGrid(a, ctx)[0]?.length ?? 0;
      const ri = toNumber(scalar(args[1], ctx));
      const ci = args[2] === undefined ? undefined : toNumber(scalar(args[2], ctx));
      if (isError(ri)) return ri;
      if (ci !== undefined && isError(ci)) return ci;
      let row = Math.trunc(ri);
      let col = ci === undefined ? 0 : Math.trunc(ci);
      if (ci === undefined && rows === 1 && cols > 1) [row, col] = [1, row]; // one row: the number counts columns
      else if (ci === undefined && cols === 1) col = 1;
      if (row < 0 || col < 0 || row > rows || col > cols) return REF;
      const r1 = row === 0 ? 0 : row - 1;
      const r2 = row === 0 ? rows - 1 : row - 1;
      const c1 = col === 0 ? 0 : col - 1;
      const c2 = col === 0 ? cols - 1 : col - 1;
      return slice(a, ctx, r1, c1, r2, c2);
    },
  },
  OFFSET: {
    min: 3,
    max: 5,
    volatile: true,
    fn: (args, ctx) => {
      const base = args[0];
      if (!isRef(base)) return VALUE;
      const dr = toNumber(scalar(args[1], ctx));
      const dc = toNumber(scalar(args[2], ctx));
      const h = args[3] === undefined || args[3] === null ? base.r2 - base.r1 + 1 : toNumber(scalar(args[3], ctx));
      const w = args[4] === undefined || args[4] === null ? base.c2 - base.c1 + 1 : toNumber(scalar(args[4], ctx));
      for (const x of [dr, dc, h, w]) if (isError(x)) return x;
      const r1 = base.r1 + Math.trunc(dr as number);
      const c1 = base.c1 + Math.trunc(dc as number);
      const height = Math.trunc(h as number);
      const width = Math.trunc(w as number);
      if (height < 1 || width < 1 || r1 < 1 || c1 < 1 || r1 + height - 1 > MAX_ROWS || c1 + width - 1 > MAX_COLS) return REF;
      return makeRef(base.sheet, r1, c1, r1 + height - 1, c1 + width - 1);
    },
  },
  INDIRECT: {
    min: 1,
    max: 2,
    volatile: true,
    fn: (args, ctx) => {
      const text = scalar(args[0], ctx);
      if (isError(text)) return text;
      try {
        const node = parseFormula(String(toText(text)).trim());
        if (node.t === "ref") return refFromNode(node, ctx) ?? REF;
        if (node.t === "name") {
          const source = ctx.host.nameFormula(node.name);
          if (source === undefined) return REF;
          const target = parseFormula(source);
          return target.t === "ref" ? refFromNode(target, ctx) ?? REF : REF;
        }
      } catch (e) {
        if (!(e instanceof FormulaSyntaxError)) throw e;
      }
      return REF;
    },
  },
  ROW: {
    min: 0,
    max: 1,
    fn: (args, ctx) => {
      const a = args[0];
      if (a === undefined) return ctx.row;
      if (!isRef(a)) return VALUE;
      return a.r1 === a.r2 ? a.r1 : arrayOf(Array.from({ length: a.r2 - a.r1 + 1 }, (_, i) => [a.r1 + i]));
    },
  },
  COLUMN: {
    min: 0,
    max: 1,
    fn: (args, ctx) => {
      const a = args[0];
      if (a === undefined) return ctx.col;
      if (!isRef(a)) return VALUE;
      return a.c1 === a.c2 ? a.c1 : arrayOf([Array.from({ length: a.c2 - a.c1 + 1 }, (_, i) => a.c1 + i)]);
    },
  },
  ROWS: { min: 1, max: 1, fn: (args, ctx) => (isRef(args[0]) ? args[0].r2 - args[0].r1 + 1 : toGrid(args[0], ctx).length) },
  COLUMNS: { min: 1, max: 1, fn: (args, ctx) => (isRef(args[0]) ? args[0].c2 - args[0].c1 + 1 : toGrid(args[0], ctx)[0]?.length ?? 0) },
  ADDRESS: {
    min: 2,
    max: 5,
    fn: (args, ctx) => {
      const r = toNumber(scalar(args[0], ctx));
      const c = toNumber(scalar(args[1], ctx));
      if (isError(r)) return r;
      if (isError(c)) return c;
      const abs = args[2] === undefined || args[2] === null ? 1 : toNumber(scalar(args[2], ctx));
      if (isError(abs)) return abs;
      const row = Math.trunc(r);
      const col = Math.trunc(c);
      if (row < 1 || col < 1 || row > MAX_ROWS || col > MAX_COLS || abs < 1 || abs > 4) return VALUE;
      const a1 = args[3] === undefined || args[3] === null ? true : scalar(args[3], ctx) !== false;
      const absRow = abs === 1 || abs === 2;
      const absCol = abs === 1 || abs === 3;
      let out = a1 ? `${absCol ? "$" : ""}${colName(col)}${absRow ? "$" : ""}${row}` : `R${absRow ? row : `[${row}]`}C${absCol ? col : `[${col}]`}`;
      if (args[4] !== undefined && args[4] !== null) out = `${String(toText(scalar(args[4], ctx)))}!${out}`;
      return out;
    },
  },
};

function xFind(key: Value, size: number, at: (i: number) => Value, mode: number, dir: 1 | -1): number {
  if (mode === 0) return findExact(key, size, at, false, dir);
  if (mode === 2) return findExact(key, size, at, true, dir);
  const exact = findExact(key, size, at, false, dir);
  if (exact >= 0) return exact;
  // The nearest value below (-1) or above (1) the key, wherever it is in the list.
  let best = -1;
  for (let i = 0; i < size; i++) {
    const v = at(i);
    if (!sameKind(key, v)) continue;
    const c = compareValues(v, key);
    if (mode === -1 ? c < 0 : c > 0) {
      if (best < 0 || (mode === -1 ? compareValues(v, at(best)) > 0 : compareValues(v, at(best)) < 0)) best = i;
    }
  }
  return best;
}

