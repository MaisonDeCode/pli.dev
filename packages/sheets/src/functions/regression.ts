import { arrayOf, isError, NA, NUM, REF, toBool, VALUE, type ErrorValue, type Value } from "../values";
import { scalar, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

/*
 * Least-squares fits: `LINEST` and `LOGEST` give the coefficients (and, if asked, the statistics) of a line or an
 * exponential curve through several variables; `TREND` and `GROWTH` give the values on them. The variables are the columns
 * of `known_x's` when `known_y's` is a column, the rows when it is a row. A variable that is a combination of the ones before
 * it (or constant, when there is an intercept) gets a coefficient of 0 and a standard error of 0, as in Excel.
 */

interface Fit {
  /** Coefficients of the variables, in the order given (0 for dropped ones). */
  m: number[];
  b: number;
  /** Standard errors of the same, `null` when not defined. */
  seM: number[];
  seB: number | null;
  r2: number;
  sey: number | null;
  f: number | null;
  df: number;
  ssreg: number;
  ssresid: number;
}

interface Data {
  y: number[];
  /** x[j][i] is variable j of observation i. */
  x: number[][];
  /** The shape of `known_y's`: true when it is a row. */
  byRow: boolean;
}

/** The numbers of a grid, or the error to give if there is something else in it. */
function numbersOf(g: Value[][]): number[][] | ErrorValue {
  const out: number[][] = [];
  for (const row of g) {
    const r: number[] = [];
    for (const v of row) {
      if (isError(v)) return v;
      if (typeof v !== "number") return VALUE;
      r.push(v);
    }
    out.push(r);
  }
  return out;
}

/** Reads `known_y's` and `known_x's` (the latter 1, 2, 3… when missing). */
function readData(yArg: Arg, xArg: Arg | undefined, ctx: Ctx): Data | ErrorValue {
  const yg = numbersOf(toGrid(yArg, ctx));
  if (isError(yg)) return yg;
  const rows = yg.length;
  const cols = yg[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return VALUE;
  if (rows > 1 && cols > 1) return REF;
  const byRow = rows === 1 && cols > 1;
  const y = byRow ? yg[0]! : yg.map((r) => r[0]!);
  const n = y.length;
  if (xArg === undefined || (xArg as Value) === null) return { y, x: [y.map((_, i) => i + 1)], byRow };
  const xg = numbersOf(toGrid(xArg, ctx));
  if (isError(xg)) return xg;
  const xr = xg.length;
  const xc = xg[0]?.length ?? 0;
  let x: number[][];
  if (!byRow && xr === n) x = Array.from({ length: xc }, (_, j) => xg.map((r) => r[j]!));
  else if (byRow && xc === n) x = xg.map((r) => r.slice());
  else if (!byRow && xc === n && xr === 1) x = [xg[0]!.slice()]; // a row of x for a column of y
  else if (byRow && xr === n && xc === 1) x = [xg.map((r) => r[0]!)];
  else return REF;
  return { y, x, byRow };
}

/** Least squares by Gram-Schmidt with a second pass, which keeps its accuracy when the variables are nearly dependent. */
function fit(data: Data, constant: boolean): Fit | ErrorValue {
  const { y, x } = data;
  const n = y.length;
  const k = x.length;
  const meanY = constant ? y.reduce((a, v) => a + v, 0) / n : 0;
  const meanX = x.map((col) => (constant ? col.reduce((a, v) => a + v, 0) / n : 0));
  const yc = y.map((v) => v - meanY);
  const cols = x.map((col, j) => col.map((v) => v - meanX[j]!));

  // Orthogonalise the variables in turn, leaving out any that is (almost) a combination of the ones kept.
  const q: number[][] = [];
  const kept: number[] = [];
  const r: number[][] = []; // r[a][b]: the part of kept variable b along orthonormal vector a
  for (let j = 0; j < k; j++) {
    const v = cols[j]!.slice();
    const original = Math.hypot(...v);
    const coef: number[] = new Array(q.length).fill(0);
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < q.length; a++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += q[a]![i]! * v[i]!;
        coef[a]! += dot;
        for (let i = 0; i < n; i++) v[i]! -= dot * q[a]![i]!;
      }
    }
    const norm = Math.hypot(...v);
    if (!(norm > 1e-10 * original) || original === 0) continue;
    q.push(v.map((e) => e / norm));
    kept.push(j);
    for (let a = 0; a < coef.length; a++) (r[a] ??= [])[kept.length - 1] = coef[a]!;
    (r[kept.length - 1] ??= [])[kept.length - 1] = norm;
  }
  const p = kept.length;
  // Solve R c = Q'y for the coefficients of the kept variables.
  const qty = q.map((col) => col.reduce((a, e, i) => a + e * yc[i]!, 0));
  const c: number[] = new Array(p).fill(0);
  for (let a = p - 1; a >= 0; a--) {
    let s = qty[a]!;
    for (let b = a + 1; b < p; b++) s -= (r[a]![b] ?? 0) * c[b]!;
    c[a] = s / r[a]![a]!;
  }
  // The inverse of R, for the covariance of the coefficients.
  const rinv: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let col = 0; col < p; col++) {
    for (let a = p - 1; a >= 0; a--) {
      let s = a === col ? 1 : 0;
      for (let b = a + 1; b < p; b++) s -= (r[a]![b] ?? 0) * rinv[b]![col]!;
      rinv[a]![col] = s / r[a]![a]!;
    }
  }
  const cov = (a: number, b: number) => {
    let s = 0;
    for (let t = 0; t < p; t++) s += rinv[a]![t]! * rinv[b]![t]!;
    return s;
  };

  const m: number[] = new Array(k).fill(0);
  kept.forEach((j, a) => (m[j] = c[a]!));
  const b = constant ? meanY - m.reduce((s, mj, j) => s + mj * meanX[j]!, 0) : 0;

  let ssresid = 0;
  for (let i = 0; i < n; i++) {
    let yhat = b;
    for (let j = 0; j < k; j++) yhat += m[j]! * x[j]![i]!;
    ssresid += (y[i]! - yhat) ** 2;
  }
  const sstot = constant ? yc.reduce((a, v) => a + v * v, 0) : y.reduce((a, v) => a + v * v, 0);
  // Rounding can leave a perfect fit with a residual of a few ulps.
  if (ssresid < 1e-26 * Math.max(sstot, 1e-300)) ssresid = 0;
  const ssreg = sstot - ssresid;
  const df = n - p - (constant ? 1 : 0);
  const r2 = sstot === 0 ? 1 : ssreg / sstot;
  // With no degrees of freedom the line passes through every point: no error, but nothing to estimate it with either.
  const sey = df > 0 ? Math.sqrt(ssresid / df) : df === 0 ? 0 : null;
  const f = df > 0 && ssresid > 0 && p > 0 ? ssreg / p / (ssresid / df) : null;

  const seM: number[] = new Array(k).fill(0);
  let seB: number | null = null;
  if (sey !== null) {
    kept.forEach((j, a) => (seM[j] = sey * Math.sqrt(cov(a, a))));
    if (constant) {
      // var(b) = sey² (1/n + x̄' cov x̄) over the kept variables.
      let s = 1 / n;
      for (let a = 0; a < p; a++) for (let d = 0; d < p; d++) s += meanX[kept[a]!]! * meanX[kept[d]!]! * cov(a, d);
      seB = sey * Math.sqrt(s);
    }
  }
  return { m, b, seM, seB, r2, sey, f, df, ssreg, ssresid };
}

const constantArg = (a: Arg | undefined, ctx: Ctx): boolean | ErrorValue => {
  if (a === undefined) return true;
  const v = scalar(a, ctx);
  if (v === null) return true;
  return toBool(v);
};

const hasValue = (a: Arg | undefined) => a !== undefined && (a as Value) !== null;

function fitted(args: Arg[], ctx: Ctx, log: boolean): { data: Data; fit: Fit; constant: boolean; stats: boolean } | ErrorValue {
  const data = readData(args[0]!, args[1], ctx);
  if (isError(data)) return data;
  if (data.y.length < 1) return VALUE;
  if (data.x.some((col) => col.length !== data.y.length)) return REF;
  const constant = constantArg(args[2], ctx);
  if (isError(constant)) return constant;
  const stats = hasValue(args[3]) ? toBool(scalar(args[3]!, ctx)) : false;
  if (isError(stats)) return stats;
  if (log) {
    if (data.y.some((v) => v <= 0)) return NUM;
    data.y = data.y.map(Math.log);
  }
  const f = fit(data, constant);
  return isError(f) ? f : { data, fit: f, constant, stats };
}

/** `LINEST` and `LOGEST`: the coefficients last variable first and the intercept (or constant) last, and with `stats` four rows more. */
function coefficients(log: boolean): FunctionDef {
  return {
    min: 1,
    max: 4,
    fn: (args, ctx) => {
      const r = fitted(args as Arg[], ctx, log);
      if (isError(r)) return r;
      const { fit: f, stats } = r;
      const k = f.m.length;
      const curve = (v: number) => (log ? Math.exp(v) : v);
      const first: Value[] = [...f.m].reverse().map(curve);
      first.push(curve(f.b));
      if (!stats) return arrayOf([first]);
      const na = (v: number | null): Value => (v === null ? NUM : v);
      const se: Value[] = [...f.seM].reverse().map(na);
      se.push(r.constant ? na(f.seB) : NA);
      const pad = (cells: Value[]): Value[] => [...cells, ...new Array(k + 1 - cells.length).fill(NA)];
      return arrayOf([first, se, pad([f.r2, na(f.sey)]), pad([na(f.f), f.df]), pad([f.ssreg, f.ssresid])]);
    },
  };
}

/** `TREND` and `GROWTH`: the values on the fitted line or curve at `new_x's` (at `known_x's` when left out). */
function predictions(log: boolean): FunctionDef {
  return {
    min: 1,
    max: 4,
    fn: (args, ctx) => {
      const r = fitted([args[0]!, args[1]!, args[3]!], ctx, log);
      if (isError(r)) return r;
      const { data, fit: f } = r;
      const k = data.x.length;
      // The points to give values for, as one array per variable.
      let points: number[][];
      let rows: number;
      let cols: number;
      if (!hasValue(args[2])) {
        points = data.x;
        rows = data.byRow ? 1 : data.y.length;
        cols = data.byRow ? data.y.length : 1;
      } else {
        const ng = numbersOf(toGrid(args[2]!, ctx));
        if (isError(ng)) return ng;
        rows = ng.length;
        cols = ng[0]?.length ?? 0;
        if (k === 1) points = [ng.flat()];
        else if (!data.byRow && cols === k) points = Array.from({ length: k }, (_, j) => ng.map((row) => row[j]!));
        else if (data.byRow && rows === k) points = ng.map((row) => row.slice());
        else return REF;
        if (k > 1) {
          // The result has a value for each row (columns of variables) or each column (rows of variables).
          if (!data.byRow) cols = 1;
          else rows = 1;
        }
      }
      const count = points[0]?.length ?? 0;
      const values: Value[] = [];
      for (let i = 0; i < count; i++) {
        let v = f.b;
        for (let j = 0; j < k; j++) v += f.m[j]! * points[j]![i]!;
        values.push(log ? Math.exp(v) : v);
      }
      const out: Value[][] = [];
      for (let i = 0; i < rows; i++) out.push(values.slice(i * cols, (i + 1) * cols));
      return arrayOf(out);
    },
  };
}

export const regression: Record<string, FunctionDef> = {
  LINEST: coefficients(false),
  LOGEST: coefficients(true),
  TREND: predictions(false),
  GROWTH: predictions(true),
};
