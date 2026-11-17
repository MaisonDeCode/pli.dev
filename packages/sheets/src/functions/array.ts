import { applyLambda } from "../eval";
import { arrayOf, compareValues, err, isError, NA, NUM, toBool, toNumber, VALUE, type Value } from "../values";
import { isLambda, scalar, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef, Lambda } from "./types";

type Grid = Value[][];

const num = (a: Arg | undefined, ctx: Ctx, fallback: number): number | null => {
  if (a === undefined) return fallback;
  const v = scalar(a, ctx);
  if (v === null) return fallback;
  const n = toNumber(v);
  return isError(n) ? null : n;
};

const truthy = (v: Value): boolean => (typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : false);
const width = (g: Grid) => g[0]?.length ?? 0;
const transpose = (g: Grid): Grid => (g[0] ?? []).map((_, j) => g.map((row) => row[j]!));

/** The value of a lambda's result as one value. */
function one(r: Arg, ctx: Ctx): Value {
  return scalar(r, ctx);
}

export const arrays: Record<string, FunctionDef> = {
  FILTER: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const data = toGrid(args[0] as Arg, ctx);
      const test = toGrid(args[1] as Arg, ctx);
      const byRows = test.length === data.length && width(test) === 1;
      const byCols = test.length === 1 && width(test) === width(data);
      if (!byRows && !byCols) return VALUE;
      const flag = (v: Value) => (isError(v) ? v : truthy(v));
      let out: Grid;
      if (byRows) {
        for (const [r] of test) if (isError(r!)) return r!;
        out = data.filter((_, i) => flag(test[i]![0]!) === true);
      } else {
        for (const v of test[0]!) if (isError(v)) return v;
        const keep = test[0]!.map((v) => flag(v) === true);
        out = data.map((row) => row.filter((_, j) => keep[j]));
      }
      if (out.length === 0 || width(out) === 0) return args[2] === undefined ? err("#CALC!") : (args[2] as Arg);
      return arrayOf(out);
    },
  },
  SORT: {
    min: 1,
    max: 4,
    fn: (args, ctx) => {
      let data = toGrid(args[0] as Arg, ctx);
      const index = num(args[1], ctx, 1);
      const order = num(args[2], ctx, 1);
      if (index === null || order === null || (order !== 1 && order !== -1)) return VALUE;
      const byCol = args[3] !== undefined && toBool(scalar(args[3], ctx)) === true;
      if (byCol) data = transpose(data);
      if (index < 1 || index > width(data)) return VALUE;
      const col = Math.trunc(index) - 1;
      const rows = data.map((row, i) => ({ row, i }));
      rows.sort((a, b) => compareForSort(a.row[col]!, b.row[col]!) * order || a.i - b.i);
      const sortedRows = rows.map((r) => r.row);
      return arrayOf(byCol ? transpose(sortedRows) : sortedRows);
    },
  },
  SORTBY: {
    min: 2,
    max: 255,
    fn: (args, ctx) => {
      const data = toGrid(args[0] as Arg, ctx);
      const keys: { values: Value[]; order: number }[] = [];
      for (let i = 1; i < args.length; i += 2) {
        const g = toGrid(args[i] as Arg, ctx);
        const order = num(args[i + 1], ctx, 1);
        if (order === null || (order !== 1 && order !== -1)) return VALUE;
        const vertical = g.length === data.length && width(g) === 1;
        if (!vertical) return VALUE;
        keys.push({ values: g.map((r) => r[0]!), order });
      }
      const rows = data.map((row, i) => ({ row, i }));
      rows.sort((a, b) => {
        for (const k of keys) {
          const c = compareForSort(k.values[a.i]!, k.values[b.i]!) * k.order;
          if (c) return c;
        }
        return a.i - b.i;
      });
      return arrayOf(rows.map((r) => r.row));
    },
  },
  UNIQUE: {
    min: 1,
    max: 3,
    fn: (args, ctx) => {
      let data = toGrid(args[0] as Arg, ctx);
      const byCol = args[1] !== undefined && toBool(scalar(args[1], ctx)) === true;
      const once = args[2] !== undefined && toBool(scalar(args[2], ctx)) === true;
      if (byCol) data = transpose(data);
      const key = (row: Value[]) => JSON.stringify(row.map((v) => (typeof v === "string" ? v.toLowerCase() : isError(v) ? v.error : v)));
      const counts = new Map<string, number>();
      for (const row of data) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
      const seen = new Set<string>();
      const out: Grid = [];
      for (const row of data) {
        const k = key(row);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!once || counts.get(k) === 1) out.push(row);
      }
      if (out.length === 0) return err("#CALC!");
      return arrayOf(byCol ? transpose(out) : out);
    },
  },
  TAKE: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const g = toGrid(args[0] as Arg, ctx);
      const r = num(args[1], ctx, g.length);
      const c = num(args[2], ctx, width(g));
      if (r === null || c === null) return VALUE;
      const rows = r >= 0 ? g.slice(0, Math.trunc(r)) : g.slice(Math.trunc(r));
      const out = rows.map((row) => (c >= 0 ? row.slice(0, Math.trunc(c)) : row.slice(Math.trunc(c))));
      return out.length === 0 || width(out) === 0 ? err("#CALC!") : arrayOf(out);
    },
  },
  DROP: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const g = toGrid(args[0] as Arg, ctx);
      const r = num(args[1], ctx, 0);
      const c = num(args[2], ctx, 0);
      if (r === null || c === null) return VALUE;
      const rows = r >= 0 ? g.slice(Math.trunc(r)) : g.slice(0, g.length + Math.trunc(r));
      const out = rows.map((row) => (c >= 0 ? row.slice(Math.trunc(c)) : row.slice(0, row.length + Math.trunc(c))));
      return out.length === 0 || width(out) === 0 ? err("#CALC!") : arrayOf(out);
    },
  },
  CHOOSECOLS: {
    min: 2,
    max: 255,
    fn: (args, ctx) => {
      const g = toGrid(args[0] as Arg, ctx);
      const picks: number[] = [];
      for (const a of args.slice(1) as Arg[]) for (const row of toGrid(a, ctx)) for (const v of row) {
        const n = toNumber(v);
        if (isError(n) || n === 0 || Math.abs(n) > width(g)) return VALUE;
        picks.push(n > 0 ? n - 1 : width(g) + n);
      }
      return arrayOf(g.map((row) => picks.map((j) => row[j]!)));
    },
  },
  CHOOSEROWS: {
    min: 2,
    max: 255,
    fn: (args, ctx) => {
      const g = toGrid(args[0] as Arg, ctx);
      const out: Grid = [];
      for (const a of args.slice(1) as Arg[]) for (const row of toGrid(a, ctx)) for (const v of row) {
        const n = toNumber(v);
        if (isError(n) || n === 0 || Math.abs(n) > g.length) return VALUE;
        out.push(g[n > 0 ? n - 1 : g.length + n]!);
      }
      return arrayOf(out);
    },
  },
  VSTACK: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      // Functions with a row of labels under them (`VSTACK(HSTACK(COUNT, SUM), {"Count","Total"})`) are what `GROUPBY` and `PIVOTBY` take to name their columns.
      if (isLambda((args as Arg[])[0])) {
        // Functions stacked downwards (`VSTACK(SUM, COUNT)`) are a list of functions like the ones side by side.
        if ((args as Arg[]).slice(1).some(isLambda)) {
          if (!(args as Arg[]).every(isLambda)) return VALUE;
          const flat = (args as Lambda[]).flatMap((l) => (l.many ? [...l.many] : [l]));
          return { lambda: true, params: [], body: { t: "empty" }, many: flat };
        }
        const fns = args[0] as Lambda;
        const labels = args.length === 2 ? toGrid(args[1] as Arg, ctx) : [];
        const count = fns.many ? fns.many.length : 1;
        if (labels.length !== 1 || labels[0]!.length !== count) return VALUE;
        return { ...fns, labels: labels[0]! };
      }
      const parts = (args as Arg[]).map((a) => toGrid(a, ctx));
      const w = Math.max(...parts.map(width));
      return arrayOf(parts.flatMap((g) => g.map((row) => Array.from({ length: w }, (_, j) => (j < row.length ? row[j]! : NA)))));
    },
  },
  HSTACK: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      // Functions side by side (`HSTACK(SUM, COUNT)`) are what `GROUPBY` and `PIVOTBY` take to give several columns.
      if ((args as Arg[]).every(isLambda)) return { lambda: true, params: [], body: { t: "empty" }, many: args as unknown as Lambda[] };
      const parts = (args as Arg[]).map((a) => toGrid(a, ctx));
      const h = Math.max(...parts.map((g) => g.length));
      return arrayOf(Array.from({ length: h }, (_, i) => parts.flatMap((g) => (i < g.length ? g[i]! : Array.from({ length: width(g) }, () => NA)))));
    },
  },
  TOCOL: reshape(true),
  TOROW: reshape(false),
  WRAPROWS: wrap(true),
  WRAPCOLS: wrap(false),
  EXPAND: {
    min: 2,
    max: 4,
    fn: (args, ctx) => {
      const g = toGrid(args[0] as Arg, ctx);
      const r = num(args[1], ctx, g.length);
      const c = num(args[2], ctx, width(g));
      if (r === null || c === null || r < g.length || c < width(g)) return VALUE;
      const pad = args[3] === undefined ? NA : scalar(args[3], ctx);
      return arrayOf(Array.from({ length: Math.trunc(r) }, (_, i) => Array.from({ length: Math.trunc(c) }, (_, j) => g[i]?.[j] ?? pad)));
    },
  },
  RANDARRAY: {
    min: 0,
    max: 5,
    volatile: true,
    fn: (args, ctx) => {
      const rows = num(args[0], ctx, 1);
      const cols = num(args[1], ctx, 1);
      const lo = num(args[2], ctx, 0);
      const hi = num(args[3], ctx, 1);
      if (rows === null || cols === null || lo === null || hi === null || rows < 1 || cols < 1 || lo > hi || rows * cols > 1_000_000) return VALUE;
      const whole = args[4] !== undefined && toBool(scalar(args[4], ctx)) === true;
      return arrayOf(Array.from({ length: Math.trunc(rows) }, () => Array.from({ length: Math.trunc(cols) }, () => (whole ? Math.ceil(lo) + Math.floor(ctx.host.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) : lo + ctx.host.random() * (hi - lo)))));
    },
  },

  // Functions that take a function made with LAMBDA
  LET: { min: 3, max: 253, fn: () => VALUE },
  LAMBDA: { min: 1, max: 254, fn: () => VALUE },
  // `ISOMITTED(x)` is worked out where it is called, which knows the LAMBDA's parameters.
  ISOMITTED: { min: 1, max: 1, fn: () => VALUE },
  MAP: {
    min: 2,
    max: 255,
    fn: (args, ctx) => {
      const l = args[args.length - 1];
      if (!isLambda(l)) return VALUE;
      const grids = (args.slice(0, -1) as Arg[]).map((a) => toGrid(a, ctx));
      const h = grids[0]!.length;
      const w = width(grids[0]!);
      if (grids.some((g) => g.length !== h || width(g) !== w)) return NA;
      return arrayOf(Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => one(applyLambda(l, grids.map((g) => g[i]![j]!), ctx), ctx))));
    },
  },
  REDUCE: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const l = args[args.length - 1];
      if (!isLambda(l)) return VALUE;
      const hasInit = args.length === 3;
      const items = toGrid((hasInit ? args[1] : args[0]) as Arg, ctx).flat();
      let acc: Arg = hasInit ? (args[0] as Arg) : items.shift() ?? NA;
      for (const v of items) {
        acc = applyLambda(l, [acc, v], ctx);
        if (isLambda(acc)) return VALUE;
      }
      return acc;
    },
  },
  SCAN: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const l = args[args.length - 1];
      if (!isLambda(l)) return VALUE;
      const hasInit = args.length === 3;
      const g = toGrid((hasInit ? args[1] : args[0]) as Arg, ctx);
      let acc: Arg | undefined = hasInit ? (args[0] as Arg) : undefined;
      return arrayOf(
        g.map((row) =>
          row.map((v) => {
            acc = acc === undefined ? v : applyLambda(l, [acc, v], ctx);
            return one(acc, ctx);
          }),
        ),
      );
    },
  },
  BYROW: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const l = args[1];
      if (!isLambda(l)) return VALUE;
      return arrayOf(toGrid(args[0] as Arg, ctx).map((row) => [one(applyLambda(l, [arrayOf([row])], ctx), ctx)]));
    },
  },
  BYCOL: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const l = args[1];
      if (!isLambda(l)) return VALUE;
      const cols = transpose(toGrid(args[0] as Arg, ctx));
      return arrayOf([cols.map((col) => one(applyLambda(l, [arrayOf(col.map((v) => [v]))], ctx), ctx))]);
    },
  },
  MAKEARRAY: {
    min: 3,
    max: 3,
    fn: (args, ctx) => {
      const r = num(args[0], ctx, 1);
      const c = num(args[1], ctx, 1);
      const l = args[2];
      if (r === null || c === null || r < 1 || c < 1 || r * c > 1_000_000 || !isLambda(l)) return VALUE;
      return arrayOf(Array.from({ length: Math.trunc(r) }, (_, i) => Array.from({ length: Math.trunc(c) }, (_, j) => one(applyLambda(l, [i + 1, j + 1], ctx), ctx))));
    },
  },
};

/** Orders values for sorting: numbers, then text, then booleans; empty cells and errors last. */
function compareForSort(a: Value, b: Value): number {
  const rank = (v: Value) => (v === null ? 4 : isError(v) ? 3 : 0);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra > 0) return 0;
  return compareValues(a, b);
}

/** `TOCOL` and `TOROW`: all the values in one column or row, skipping blanks or errors as asked. */
function reshape(column: boolean): FunctionDef {
  return {
    min: 1,
    max: 3,
    fn: (args, ctx) => {
      const g = toGrid(args[0] as Arg, ctx);
      const ignore = num(args[1], ctx, 0);
      const byCol = args[2] !== undefined && toBool(scalar(args[2], ctx)) === true;
      if (ignore === null || ignore < 0 || ignore > 3) return VALUE;
      const flat = (byCol ? transpose(g) : g).flat();
      const out = flat.filter((v) => !((ignore === 1 || ignore === 3) && v === null) && !((ignore === 2 || ignore === 3) && isError(v)));
      if (out.length === 0) return err("#CALC!");
      return arrayOf(column ? out.map((v) => [v]) : [out]);
    },
  };
}

/** `WRAPROWS` and `WRAPCOLS`: a row or column cut into pieces of a size and laid side by side. */
function wrap(rowsFirst: boolean): FunctionDef {
  return {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const g = toGrid(args[0] as Arg, ctx);
      if (g.length !== 1 && width(g) !== 1) return VALUE;
      const items = g.flat();
      const n = num(args[1], ctx, 1);
      if (n === null || n < 1) return NUM;
      const size = Math.trunc(n);
      const pad = args[2] === undefined ? NA : scalar(args[2], ctx);
      const pieces: Value[][] = [];
      for (let i = 0; i < items.length; i += size) {
        const piece = items.slice(i, i + size);
        while (piece.length < size) piece.push(pad);
        pieces.push(piece);
      }
      return arrayOf(rowsFirst ? pieces : transpose(pieces));
    },
  };
}

