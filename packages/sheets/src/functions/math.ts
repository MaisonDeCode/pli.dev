import { arrayOf, DIV0, isArray, isError, NUM, toBool, toNumber, VALUE, type ErrorValue, type Value } from "../values";
import { criterion, depend, eachValue, isRef, num, numbersIn, refCell, scalar, simple, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef, RangeRef } from "./types";

type Table = Record<string, FunctionDef>;

/** A function of one number. */
const unary = (fn: (n: number) => number | Value): FunctionDef =>
  simple(1, 1, ([v]) => {
    const n = toNumber(v!);
    if (isError(n)) return n;
    const r = fn(n);
    return typeof r === "number" && !Number.isFinite(r) ? NUM : r;
  });

/** A function of two numbers. */
const binary = (fn: (a: number, b: number) => number | Value, max = 2, min = 2): FunctionDef =>
  simple(min, max, (vs) => {
    const a = toNumber(vs[0]!);
    if (isError(a)) return a;
    const b = vs[1] === undefined ? 0 : toNumber(vs[1]);
    if (isError(b)) return b;
    const r = fn(a, b);
    return typeof r === "number" && !Number.isFinite(r) ? NUM : r;
  });

function round(x: number, d: number, mode: "half" | "up" | "down"): number {
  const k = Math.trunc(d);
  const scale = 10 ** Math.abs(k);
  const abs = Math.abs(x);
  const shifted = Number((k >= 0 ? abs * scale : abs / scale).toPrecision(15));
  const r = mode === "half" ? Math.round(shifted) : mode === "up" ? Math.ceil(shifted) : Math.floor(shifted);
  const back = k >= 0 ? r / scale : r * scale;
  return (x < 0 ? -back : back) || 0;
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** `SUMIF` and friends: for each criteria pair, which positions of the range pass. */
function matching(pairs: Arg[], ctx: Ctx): { rows: number; cols: number; pass: boolean[][] } | ErrorValue {
  let pass: boolean[][] | undefined;
  let rows = 0;
  let cols = 0;
  for (let p = 0; p < pairs.length; p += 2) {
    const grid = toGrid(pairs[p]!, ctx);
    const test = criterion(scalar(pairs[p + 1]!, ctx));
    if (!pass) {
      rows = grid.length;
      cols = grid[0]?.length ?? 0;
      pass = grid.map((r) => r.map((v) => test(v)));
    } else {
      if (grid.length !== rows || (grid[0]?.length ?? 0) !== cols) return VALUE;
      grid.forEach((r, i) => r.forEach((v, j) => (pass![i]![j] = pass![i]![j]! && test(v))));
    }
  }
  return { rows, cols, pass: pass ?? [] };
}

function sumRange(sumArg: Arg, ctx: Ctx, shape: { rows: number; cols: number }): Value[][] {
  if (isRef(sumArg)) {
    // The sum range is laid over the criteria range from its top-left corner.
    const r: RangeRef = { ...sumArg, r2: sumArg.r1 + shape.rows - 1, c2: sumArg.c1 + shape.cols - 1 };
    depend(r, ctx);
    const grid: Value[][] = [];
    for (let i = 0; i < shape.rows; i++) {
      const row: Value[] = [];
      for (let j = 0; j < shape.cols; j++) row.push(refCell(r, i, j, ctx));
      grid.push(row);
    }
    return grid;
  }
  return toGrid(sumArg, ctx);
}

function aggregate(values: Value[][], pass: boolean[][]): { numbers: number[]; error?: Value } {
  const numbers: number[] = [];
  for (let i = 0; i < pass.length; i++)
    for (let j = 0; j < pass[i]!.length; j++) {
      if (!pass[i]![j]) continue;
      const v = values[i]?.[j];
      if (isError(v)) return { numbers, error: v };
      if (typeof v === "number") numbers.push(v);
    }
  return { numbers };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function criteriaFunction(kind: "sum" | "avg" | "count" | "max" | "min"): FunctionDef {
  return {
    min: kind === "count" ? 2 : 3,
    max: 255,
    fn: (args, ctx) => {
      if (kind === "count") {
        const m = matching(args, ctx);
        if (isError(m)) return m;
        return m.pass.reduce((n, r) => n + r.filter(Boolean).length, 0);
      }
      const [target, ...pairs] = args as [Arg, ...Arg[]];
      if (pairs.length % 2) return VALUE;
      const m = matching(pairs, ctx);
      if (isError(m)) return m;
      const { numbers, error } = aggregate(sumRange(target, ctx, m), m.pass);
      if (error) return error;
      if (kind === "sum") return sum(numbers);
      if (kind === "max") return numbers.length ? Math.max(...numbers) : 0;
      if (kind === "min") return numbers.length ? Math.min(...numbers) : 0;
      return numbers.length ? sum(numbers) / numbers.length : DIV0;
    },
  };
}

export const math: Table = {
  SUM: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      const xs = numbersIn(args, ctx);
      return isError(xs) ? xs : sum(xs);
    },
  },
  PRODUCT: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      const xs = numbersIn(args, ctx);
      return isError(xs) ? xs : xs.reduce((a, b) => a * b, 1);
    },
  },
  SUMSQ: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      const xs = numbersIn(args, ctx);
      return isError(xs) ? xs : xs.reduce((a, b) => a + b * b, 0);
    },
  },
  SUMPRODUCT: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      const grids = (args as Arg[]).map((a) => toGrid(a, ctx));
      const rows = grids[0]!.length;
      const cols = grids[0]![0]?.length ?? 0;
      if (grids.some((g) => g.length !== rows || (g[0]?.length ?? 0) !== cols)) return VALUE;
      let total = 0;
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          let p = 1;
          for (const g of grids) {
            const v = g[i]![j]!;
            if (isError(v)) return v;
            p *= typeof v === "number" ? v : 0;
          }
          total += p;
        }
      return total;
    },
  },
  SUMIF: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const [range, crit, sumArg] = args as [Arg, Arg, Arg | undefined];
      const m = matching([range, crit], ctx);
      if (isError(m)) return m;
      const { numbers, error } = aggregate(sumRange(sumArg ?? range, ctx, m), m.pass);
      return error ?? sum(numbers);
    },
  },
  SUMIFS: criteriaFunction("sum"),
  COUNTIFS: criteriaFunction("count"),
  AVERAGEIFS: criteriaFunction("avg"),
  MAXIFS: criteriaFunction("max"),
  MINIFS: criteriaFunction("min"),
  COUNTIF: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const m = matching(args as Arg[], ctx);
      if (isError(m)) return m;
      return m.pass.reduce((n, r) => n + r.filter(Boolean).length, 0);
    },
  },
  AVERAGEIF: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const [range, crit, avgArg] = args as [Arg, Arg, Arg | undefined];
      const m = matching([range, crit], ctx);
      if (isError(m)) return m;
      const { numbers, error } = aggregate(sumRange(avgArg ?? range, ctx, m), m.pass);
      if (error) return error;
      return numbers.length ? sum(numbers) / numbers.length : DIV0;
    },
  },
  ABS: unary(Math.abs),
  SIGN: unary(Math.sign),
  SQRT: unary((n) => (n < 0 ? NUM : Math.sqrt(n))),
  EXP: unary(Math.exp),
  LN: unary((n) => (n <= 0 ? NUM : Math.log(n))),
  LOG10: unary((n) => (n <= 0 ? NUM : Math.log10(n))),
  LOG: binary((n, base) => (n <= 0 || base <= 0 || base === 1 ? NUM : Math.log(n) / Math.log(base)), 2, 1),
  PI: { min: 0, max: 0, fn: () => Math.PI },
  SIN: unary(Math.sin),
  COS: unary(Math.cos),
  TAN: unary(Math.tan),
  ASIN: unary((n) => (Math.abs(n) > 1 ? NUM : Math.asin(n))),
  ACOS: unary((n) => (Math.abs(n) > 1 ? NUM : Math.acos(n))),
  ATAN: unary(Math.atan),
  ATAN2: binary((x, y) => (x === 0 && y === 0 ? DIV0 : Math.atan2(y, x))),
  SINH: unary(Math.sinh),
  COSH: unary(Math.cosh),
  TANH: unary(Math.tanh),
  DEGREES: unary((n) => (n * 180) / Math.PI),
  RADIANS: unary((n) => (n * Math.PI) / 180),
  INT: unary(Math.floor),
  TRUNC: binary((n, d) => { const s = 10 ** Math.trunc(d); return Math.trunc(Number((n * s).toPrecision(15))) / s; }, 2, 1),
  ROUND: binary((n, d) => round(n, d, "half")),
  ROUNDUP: binary((n, d) => round(n, d, "up")),
  ROUNDDOWN: binary((n, d) => round(n, d, "down")),
  EVEN: unary((n) => { const r = Math.ceil(Math.abs(n) / 2) * 2; return n < 0 ? -r : r; }),
  ODD: unary((n) => { const a = Math.abs(n); const r = Math.ceil(a) % 2 === 1 ? Math.ceil(a) : Math.ceil(a) + 1; return n < 0 ? -r : r; }),
  FACT: unary((n) => (n < 0 || n > 170 ? NUM : factorial(Math.floor(n)))),
  MOD: binary((n, d) => (d === 0 ? DIV0 : n - d * Math.floor(n / d))),
  QUOTIENT: binary((n, d) => (d === 0 ? DIV0 : Math.trunc(n / d))),
  POWER: binary((n, p) => (n === 0 && p === 0 ? NUM : n === 0 && p < 0 ? DIV0 : n ** p)),
  GCD: { min: 1, max: 255, fn: (args, ctx) => { const xs = numbersIn(args, ctx); return isError(xs) ? xs : xs.some((x) => x < 0) ? NUM : xs.map(Math.trunc).reduce(gcd, 0); } },
  LCM: { min: 1, max: 255, fn: (args, ctx) => { const xs = numbersIn(args, ctx); return isError(xs) ? xs : xs.some((x) => x < 0) ? NUM : xs.map(Math.trunc).reduce((a, b) => (a === 0 || b === 0 ? 0 : (a * b) / gcd(a, b)), 1); } },
  CEILING: binary((n, s) => (s === 0 ? 0 : n > 0 && s < 0 ? NUM : Math.ceil(Number((n / s).toPrecision(15))) * s)),
  FLOOR: binary((n, s) => (s === 0 ? DIV0 : n > 0 && s < 0 ? NUM : Math.floor(Number((n / s).toPrecision(15))) * s)),
  "CEILING.MATH": binary((n, s) => { const k = Math.abs(s || 1); return Math.ceil(Number((n / k).toPrecision(15))) * k; }, 2, 1),
  "FLOOR.MATH": binary((n, s) => { const k = Math.abs(s || 1); return Math.floor(Number((n / k).toPrecision(15))) * k; }, 2, 1),
  MROUND: binary((n, m) => (m === 0 ? 0 : n * m < 0 ? NUM : round(n / m, 0, "half") * m)),
  RAND: { min: 0, max: 0, volatile: true, fn: (_a, ctx) => ctx.host.random() },
  RANDBETWEEN: {
    min: 2,
    max: 2,
    volatile: true,
    fn: (args, ctx) => {
      const lo = toNumber(scalar(args[0], ctx));
      const hi = toNumber(scalar(args[1], ctx));
      if (isError(lo)) return lo;
      if (isError(hi)) return hi;
      const a = Math.ceil(lo);
      const b = Math.floor(hi);
      return a > b ? NUM : a + Math.floor(ctx.host.random() * (b - a + 1));
    },
  },
  SEQUENCE: {
    min: 1,
    max: 4,
    fn: (args, ctx) => {
      const [r, c, start, step] = [1, 1, 1, 1].map((d, i) => (args[i] === undefined ? d : num(scalar(args[i], ctx), d)));
      for (const x of [r, c, start, step]) if (isError(x)) return x;
      const rows = r as number;
      const cols = c as number;
      if (rows < 1 || cols < 1 || rows * cols > 1_000_000) return NUM;
      return arrayOf(Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (start as number) + (i * cols + j) * (step as number))));
    },
  },
  MMULT: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const a = toGrid(args[0], ctx);
      const b = toGrid(args[1], ctx);
      if ((a[0]?.length ?? 0) !== b.length) return VALUE;
      const out = a.map((row) => (b[0] ?? []).map((_, j) => row.reduce<number>((s, x, k) => s + (typeof x === "number" && typeof b[k]![j] === "number" ? x * (b[k]![j] as number) : 0), 0)));
      return arrayOf(out);
    },
  },
  TRANSPOSE: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const g = toGrid(args[0], ctx);
      return arrayOf((g[0] ?? []).map((_, j) => g.map((row) => row[j]!)));
    },
  },
  ARABIC: simple(1, 1, ([v]) => {
    const s = String(v).trim().toUpperCase();
    if (!/^[IVXLCDM]+$/.test(s)) return s === "" ? 0 : VALUE;
    const vals: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let i = 0; i < s.length; i++) total += vals[s[i]!]! < (vals[s[i + 1]!] ?? 0) ? -vals[s[i]!]! : vals[s[i]!]!;
    return total;
  }),
  ROMAN: simple(1, 2, ([v]) => {
    let n = toNumber(v!);
    if (isError(n)) return n;
    n = Math.floor(n);
    if (n < 0 || n > 3999) return VALUE;
    const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [k, s] of table) while (n >= k) { out += s; n -= k; }
    return out;
  }),
  AND: boolLike("and"),
  OR: boolLike("or"),
  XOR: boolLike("xor"),
};

/** `AND`, `OR` and `XOR` read TRUE and FALSE, numbers, and the same in ranges (where text is skipped). */
function boolLike(kind: "and" | "or" | "xor"): FunctionDef {
  return {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      const flags: boolean[] = [];
      for (const a of args as Arg[]) {
        let error: Value | undefined;
        if (isRef(a) || isArray(a)) {
          eachValue(a, ctx, (v) => {
            if (error) return;
            if (isError(v)) error = v;
            else if (typeof v === "boolean") flags.push(v);
            else if (typeof v === "number") flags.push(v !== 0);
          });
        } else {
          const b = toBool(scalar(a, ctx));
          if (isError(b)) return b;
          flags.push(b);
        }
        if (error) return error;
      }
      if (flags.length === 0) return VALUE;
      if (kind === "and") return flags.every(Boolean);
      if (kind === "or") return flags.some(Boolean);
      return flags.filter(Boolean).length % 2 === 1;
    },
  };
}

export { aggregate, round };
