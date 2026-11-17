import { DIV0, isArray, isError, NA, NUM, toNumber, type Value } from "../values";
import { eachValue, isRef, numbersIn, scalar, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[], sample: boolean) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - (sample ? 1 : 0));
};

function over(args: Arg[], ctx: Ctx, fn: (xs: number[]) => Value): Value {
  const xs = numbersIn(args, ctx);
  return isError(xs) ? xs : fn(xs);
}

const stat = (fn: (xs: number[]) => Value, min = 1): FunctionDef => ({
  min,
  max: 255,
  fn: (args, ctx) => over(args, ctx, fn),
});

function sorted(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

function percentile(xs: number[], k: number): Value {
  if (xs.length === 0 || k < 0 || k > 1) return NUM;
  const s = sorted(xs);
  const pos = k * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

function pairs(args: Arg[], ctx: Ctx): [number[], number[]] | Value {
  const a = toGrid(args[0]!, ctx).flat();
  const b = toGrid(args[1]!, ctx).flat();
  if (a.length !== b.length) return NA;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (isError(a[i]!)) return a[i]!;
    if (isError(b[i]!)) return b[i]!;
    if (typeof a[i] === "number" && typeof b[i] === "number") {
      xs.push(a[i] as number);
      ys.push(b[i] as number);
    }
  }
  return [xs, ys];
}

function regression(args: Arg[], ctx: Ctx, pick: (slope: number, intercept: number, r: number) => number): Value {
  const p = pairs(args, ctx);
  if (!Array.isArray(p)) return p as Value;
  const [ys, xs] = p; // arguments are (known_y's, known_x's)
  if (xs.length < 2) return DIV0;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i]! - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  });
  if (sxx === 0) return DIV0;
  const slope = sxy / sxx;
  const out = pick(slope, my - slope * mx, sxy / Math.sqrt(sxx * syy));
  return Number.isFinite(out) ? out : DIV0;
}

export const stats: Record<string, FunctionDef> = {
  AVERAGE: stat((xs) => (xs.length ? mean(xs) : DIV0)),
  AVERAGEA: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      let total = 0, n = 0;
      let error: Value | undefined;
      for (const a of args as Arg[]) {
        eachValue(a, ctx, (v) => {
          if (isError(v)) error ??= v;
          else if (v !== null) { total += typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : 0; n++; }
        });
      }
      return error ?? (n ? total / n : DIV0);
    },
  },
  MAX: stat((xs) => (xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : 0)),
  MIN: stat((xs) => (xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : 0)),
  MEDIAN: stat((xs) => {
    if (!xs.length) return NUM;
    const s = sorted(xs);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  }),
  "MODE.SNGL": stat((xs) => {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    let best: number | undefined;
    let n = 1;
    for (const x of xs) if ((counts.get(x) ?? 0) > n) { best = x; n = counts.get(x)!; }
    return best ?? NA;
  }),
  STDEV: stat((xs) => (xs.length < 2 ? DIV0 : Math.sqrt(variance(xs, true)))),
  "STDEV.S": stat((xs) => (xs.length < 2 ? DIV0 : Math.sqrt(variance(xs, true)))),
  "STDEV.P": stat((xs) => (xs.length < 1 ? DIV0 : Math.sqrt(variance(xs, false)))),
  STDEVP: stat((xs) => (xs.length < 1 ? DIV0 : Math.sqrt(variance(xs, false)))),
  VAR: stat((xs) => (xs.length < 2 ? DIV0 : variance(xs, true))),
  "VAR.S": stat((xs) => (xs.length < 2 ? DIV0 : variance(xs, true))),
  "VAR.P": stat((xs) => (xs.length < 1 ? DIV0 : variance(xs, false))),
  VARP: stat((xs) => (xs.length < 1 ? DIV0 : variance(xs, false))),
  GEOMEAN: stat((xs) => (!xs.length || xs.some((x) => x <= 0) ? NUM : Math.exp(mean(xs.map(Math.log))))),
  COUNT: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      let n = 0;
      for (const a of args as Arg[]) {
        if (isRef(a) || isArray(a)) eachValue(a, ctx, (v) => { if (typeof v === "number") n++; });
        else { const v = scalar(a, ctx); if (!isError(v) && v !== null && !isError(toNumber(v))) n++; }
      }
      return n;
    },
  },
  COUNTA: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      let n = 0;
      for (const a of args as Arg[]) {
        if (isRef(a) || isArray(a)) eachValue(a, ctx, (v) => { if (v !== null) n++; });
        else n++;
      }
      return n;
    },
  },
  COUNTBLANK: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const a = args[0] as Arg;
      let filled = 0;
      eachValue(a, ctx, (v) => { if (v !== null && v !== "") filled++; });
      const total = isRef(a) ? (a.r2 - a.r1 + 1) * (a.c2 - a.c1 + 1) : toGrid(a, ctx).flat().length;
      return total - filled;
    },
  },
  LARGE: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const k = toNumber(scalar(args[1], ctx));
      if (isError(k)) return k;
      return over([args[0]], ctx, (xs) => { const s = sorted(xs).reverse(); return k < 1 || k > s.length ? NUM : s[Math.ceil(k) - 1]!; });
    },
  },
  SMALL: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const k = toNumber(scalar(args[1], ctx));
      if (isError(k)) return k;
      return over([args[0]], ctx, (xs) => { const s = sorted(xs); return k < 1 || k > s.length ? NUM : s[Math.ceil(k) - 1]!; });
    },
  },
  RANK: rank(),
  "RANK.EQ": rank(),
  "RANK.AVG": rank(true),
  PERCENTILE: percentileFn((xs, k) => percentile(xs, k)),
  "PERCENTILE.INC": percentileFn((xs, k) => percentile(xs, k)),
  QUARTILE: percentileFn((xs, q) => (q < 0 || q > 4 || q !== Math.floor(q) ? NUM : percentile(xs, q / 4))),
  "QUARTILE.INC": percentileFn((xs, q) => (q < 0 || q > 4 || q !== Math.floor(q) ? NUM : percentile(xs, q / 4))),
  CORREL: { min: 2, max: 2, fn: (args, ctx) => regression(args, ctx, (_s, _i, r) => r) },
  SLOPE: { min: 2, max: 2, fn: (args, ctx) => regression(args, ctx, (s) => s) },
  INTERCEPT: { min: 2, max: 2, fn: (args, ctx) => regression(args, ctx, (_s, i) => i) },
  FORECAST: {
    min: 3,
    max: 3,
    fn: (args, ctx) => {
      const x = toNumber(scalar(args[0], ctx));
      if (isError(x)) return x;
      return regression([args[1]!, args[2]!], ctx, (s, i) => s * x + i);
    },
  },
};

function rank(avg = false): FunctionDef {
  return {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const x = toNumber(scalar(args[0], ctx));
      if (isError(x)) return x;
      const order = args[2] === undefined ? 0 : toNumber(scalar(args[2], ctx));
      if (isError(order)) return order;
      return over([args[1]], ctx, (xs) => {
        if (!xs.includes(x)) return NA;
        const ahead = xs.filter((y) => (order ? y < x : y > x)).length;
        const ties = xs.filter((y) => y === x).length;
        return avg ? ahead + (ties + 1) / 2 : ahead + 1;
      });
    },
  };
}

function percentileFn(fn: (xs: number[], k: number) => Value): FunctionDef {
  return {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const k = toNumber(scalar(args[1], ctx));
      if (isError(k)) return k;
      return over([args[0]], ctx, (xs) => fn(xs, k));
    },
  };
}

