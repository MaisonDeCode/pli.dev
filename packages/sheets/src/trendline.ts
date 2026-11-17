import { formatValue } from "./format";
import type { Trendline } from "./model";

/*
 * Trendlines as Excel defines them (and LINEST, LOGEST, SLOPE and RSQ agree):
 *  - linear        y = m x + b                     least squares on (x, y)
 *  - exponential   y = c e^(b x)                   least squares on (x, ln y), like LOGEST; every y must be positive
 *  - logarithmic   y = c ln(x) + b                 least squares on (ln x, y); every x must be positive
 *  - power         y = c x^b                       least squares on (ln x, ln y); every x and y must be positive
 *  - polynomial    y = c_n x^n + … + c_1 x + b     least squares on (x, x², …, x^n), like LINEST(y, x^{1,2,…})
 *  - moving average  the mean of the last `period` points, drawn at the last of them
 * R squared of the curved fits is the R squared of the straight fit they are reduced to (in ln y, or ln x), as Excel reports it.
 * When the line is forced through a point (`intercept`), R squared is worked out around that value instead of the mean (LINEST with const = FALSE on y minus the intercept; for an intercept of 0 this is exactly Excel's, for another value it is unverified against Excel).
 */

export interface TrendFit {
  /** The coefficients, lowest power first: for linear `[b, m]`, polynomial `[b, c1, c2, …]`, exponential `[c, b]`, logarithmic `[b, c]`, power `[c, b]`. */
  coef: number[];
  rSquared: number;
  /** The y of the trendline at x. */
  at(x: number): number;
  equation: string;
}

export interface TrendResult {
  /** The line to draw, in the units of x the chart uses. */
  points: [number, number][];
  fit?: TrendFit;
  /** Why there is no line, when there is none. */
  problem?: string;
}

/** Solves least squares `min |A c − y|` by Householder QR (columns are scaled first so powers of x stay well conditioned). Null when the columns are dependent. */
export function leastSquares(columns: readonly (readonly number[])[], y: readonly number[]): number[] | null {
  const n = y.length;
  const p = columns.length;
  if (n < p || p === 0) return null;
  const scale = columns.map((c) => Math.max(1e-300, ...c.map(Math.abs)));
  const A = Array.from({ length: n }, (_, i) => columns.map((c, j) => c[i]! / scale[j]!));
  const b = y.slice();
  for (let k = 0; k < p; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm += A[i]![k]! ** 2;
    norm = Math.sqrt(norm);
    if (norm < 1e-12) return null;
    const alpha = A[k]![k]! > 0 ? -norm : norm;
    const v = new Array<number>(n).fill(0);
    for (let i = k; i < n; i++) v[i] = A[i]![k]!;
    v[k] = v[k]! - alpha;
    let vv = 0;
    for (let i = k; i < n; i++) vv += v[i]! ** 2;
    if (vv < 1e-300) continue;
    for (let j = k; j < p; j++) {
      let dot = 0;
      for (let i = k; i < n; i++) dot += v[i]! * A[i]![j]!;
      const f = (2 * dot) / vv;
      for (let i = k; i < n; i++) A[i]![j] = A[i]![j]! - f * v[i]!;
    }
    let dot = 0;
    for (let i = k; i < n; i++) dot += v[i]! * b[i]!;
    const f = (2 * dot) / vv;
    for (let i = k; i < n; i++) b[i] = b[i]! - f * v[i]!;
  }
  const c = new Array<number>(p).fill(0);
  for (let k = p - 1; k >= 0; k--) {
    let s = b[k]!;
    for (let j = k + 1; j < p; j++) s -= A[k]![j]! * c[j]!;
    const d = A[k]![k]!;
    if (Math.abs(d) < 1e-10) return null;
    c[k] = s / d;
  }
  return c.map((v, j) => v / scale[j]!);
}

const sub = ["", "", "²", "³", "⁴", "⁵", "⁶"];

/** A number the way Excel's General format shows it in a trendline label: about five significant digits. */
export function trendNumber(n: number): string {
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e-4 && a < 1e10) return String(Number(n.toPrecision(5)));
  return n.toExponential(4).replace(/\.?0+e/, "e").replace("e+", "E+").replace("e-", "E-");
}

/** A number in a trendline's label: Excel's General (about five digits), or the label's own number format. */
export type TrendNumber = (n: number) => string;
export const labelNumber = (format?: string): TrendNumber => (format ? (n) => formatValue(n, format).text : trendNumber);

/** `+ 3x` or `− 2` joined onto an equation, the way Excel writes the signs. */
function term(n: number, rest: string, nf: TrendNumber): string {
  const sign = n < 0 ? "-" : "+";
  const a = nf(Math.abs(n));
  return ` ${sign} ${rest === "" ? a : a === "1" ? rest : a + rest}`;
}

function equationOf(t: Trendline, c: number[], nf: TrendNumber): string {
  const lead = (n: number, rest: string) => (n < 0 ? "-" : "") + (rest === "" ? nf(Math.abs(n)) : nf(Math.abs(n)) === "1" ? rest : nf(Math.abs(n)) + rest);
  switch (t.type) {
    case "linear":
      return `y = ${lead(c[1]!, "x")}${c[0] === 0 ? "" : term(c[0]!, "", nf)}`;
    case "polynomial": {
      const order = c.length - 1;
      let s = `y = ${lead(c[order]!, `x${sub[order]}`)}`;
      for (let k = order - 1; k >= 1; k--) if (c[k] !== 0) s += term(c[k]!, k === 1 ? "x" : `x${sub[k]}`, nf);
      if (c[0] !== 0) s += term(c[0]!, "", nf);
      return s;
    }
    case "exponential":
      return `y = ${nf(c[0]!)}e^${nf(c[1]!)}x`;
    case "logarithmic":
      return `y = ${lead(c[1]!, "ln(x)")}${c[0] === 0 ? "" : term(c[0]!, "", nf)}`;
    case "power":
      return `y = ${nf(c[0]!)}x^${nf(c[1]!)}`;
    default:
      return "";
  }
}

const mean = (a: readonly number[]) => a.reduce((s, v) => s + v, 0) / a.length;

/** R squared of predictions `fitted` against `actual`: against the mean, or against `through` (the forced intercept) when the line is forced through a point. */
function rSquaredOf(actual: readonly number[], fitted: readonly number[], through?: number): number {
  const base = through ?? mean(actual);
  let tot = 0;
  let res = 0;
  actual.forEach((a, i) => {
    tot += (a - base) ** 2;
    res += (a - fitted[i]!) ** 2;
  });
  if (tot === 0) return res === 0 ? 1 : 0;
  return 1 - res / tot;
}

/** The legend name of a trendline: its own name, or Excel's ("Linear (North)", "2 per. Mov. Avg. (North)"). */
export function trendlineName(t: Trendline, seriesName: string): string {
  if (t.name) return t.name;
  const kind = { linear: "Linear", exponential: "Expon.", logarithmic: "Log.", polynomial: "Poly.", power: "Power", movingAverage: `${t.period ?? 2} per. Mov. Avg.` }[t.type];
  return `${kind} (${seriesName})`;
}

export const MAX_TREND_ORDER = 6;

/** Fits the trendline `t` through the points (those with a missing x or y are skipped). Does not draw it: see `trendlineLine`. */
export function fitTrendline(t: Trendline, xsIn: readonly (number | null)[], ysIn: readonly (number | null)[]): { fit?: TrendFit; problem?: string } {
  const xs: number[] = [];
  const ys: number[] = [];
  ysIn.forEach((y, i) => {
    const x = xsIn[i];
    if (y === null || y === undefined || x === null || x === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
    xs.push(x);
    ys.push(y);
  });
  const forced = t.intercept !== undefined && (t.type === "linear" || t.type === "exponential" || t.type === "polynomial");
  const order = t.type === "polynomial" ? t.order ?? 2 : 1;
  const need = t.type === "polynomial" ? order + 1 - (forced ? 1 : 0) : forced ? 1 : 2;
  if (xs.length < Math.max(2, need)) return { problem: "There are too few points to fit the line" };
  if (t.type === "exponential" && ys.some((y) => y <= 0)) return { problem: "An exponential trendline needs every y to be positive" };
  if (t.type === "logarithmic" && xs.some((x) => x <= 0)) return { problem: "A logarithmic trendline needs every x to be positive" };
  if (t.type === "power" && (xs.some((x) => x <= 0) || ys.some((y) => y <= 0))) return { problem: "A power trendline needs every x and y to be positive" };
  if (t.type === "exponential" && forced && !(t.intercept! > 0)) return { problem: "The intercept of an exponential trendline must be positive" };

  let coef: number[] | null;
  let at: (x: number) => number;
  let rSquared: number;
  switch (t.type) {
    case "linear":
    case "polynomial": {
      const powers = Array.from({ length: order }, (_, k) => k + 1);
      const cols = powers.map((p) => xs.map((x) => x ** p));
      if (forced) {
        const c = leastSquares(cols, ys.map((y) => y - t.intercept!));
        coef = c && [t.intercept!, ...c];
      } else {
        const c = leastSquares([xs.map(() => 1), ...cols], ys);
        coef = c;
      }
      if (!coef) return { problem: "The points don't fit a line (they are all at one x)" };
      const k = coef;
      at = (x) => k.reduce((s, c, j) => s + c * x ** j, 0);
      rSquared = rSquaredOf(ys, xs.map(at), forced ? t.intercept : undefined);
      break;
    }
    case "exponential": {
      const ly = ys.map(Math.log);
      let c: number[] | null;
      if (forced) {
        const b = leastSquares([xs], ly.map((v) => v - Math.log(t.intercept!)));
        c = b && [Math.log(t.intercept!), b[0]!];
      } else c = leastSquares([xs.map(() => 1), xs], ly);
      if (!c) return { problem: "The points don't fit an exponential curve (they are all at one x)" };
      coef = [Math.exp(c[0]!), c[1]!];
      const k = coef;
      at = (x) => k[0]! * Math.exp(k[1]! * x);
      rSquared = rSquaredOf(ly, xs.map((x) => c![0]! + c![1]! * x), forced ? Math.log(t.intercept!) : undefined);
      break;
    }
    case "logarithmic": {
      const lx = xs.map(Math.log);
      const c = leastSquares([lx.map(() => 1), lx], ys);
      if (!c) return { problem: "The points don't fit a logarithmic curve (they are all at one x)" };
      coef = c;
      at = (x) => c[0]! + c[1]! * Math.log(x);
      rSquared = rSquaredOf(ys, lx.map((v) => c[0]! + c[1]! * v));
      break;
    }
    case "power": {
      const lx = xs.map(Math.log);
      const ly = ys.map(Math.log);
      const c = leastSquares([lx.map(() => 1), lx], ly);
      if (!c) return { problem: "The points don't fit a power curve (they are all at one x)" };
      coef = [Math.exp(c[0]!), c[1]!];
      const k = coef;
      at = (x) => k[0]! * x ** k[1]!;
      rSquared = rSquaredOf(ly, lx.map((v) => c[0]! + c[1]! * v));
      break;
    }
    default:
      return { problem: "A moving average has no equation" };
  }
  return { fit: { coef, rSquared, at, equation: equationOf(t, coef, labelNumber(t.label?.format)) } };
}

const SAMPLES = 60;

/**
 * The line to draw for a trendline through a series. `xs` and `ys` are the series' points (`xs` is 1, 2, 3… for a chart
 * of categories, and the x values for a scatter or bubble chart). The line runs `backward` before the first x and
 * `forward` past the last. A moving average has one point for each point from the `period`-th on.
 */
export function trendlineLine(t: Trendline, xs: readonly number[], ys: readonly (number | null)[]): TrendResult {
  if (t.type === "movingAverage") {
    const period = Math.max(2, Math.floor(t.period ?? 2));
    if (ys.length <= period - 1) return { points: [], problem: "There are too few points for this moving average" };
    const points: [number, number][] = [];
    for (let i = period - 1; i < ys.length; i++) {
      const window = ys.slice(i - period + 1, i + 1);
      if (window.some((v) => v === null)) continue;
      points.push([xs[i]!, mean(window as number[])]);
    }
    return { points };
  }
  const { fit, problem } = fitTrendline(t, xs, ys);
  if (!fit) return { points: [], ...(problem ? { problem } : {}) };
  const have = xs.filter((_, i) => ys[i] !== null && ys[i] !== undefined);
  let lo = Math.min(...have) - Math.max(0, t.backward ?? 0);
  const hi = Math.max(...have) + Math.max(0, t.forward ?? 0);
  // Curves with a logarithm can't go to zero or below.
  if ((t.type === "logarithmic" || t.type === "power") && lo <= 0) lo = Math.min(...have) / 100;
  const n = t.type === "linear" ? 2 : SAMPLES;
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = lo + ((hi - lo) * i) / (n - 1);
    const y = fit.at(x);
    if (Number.isFinite(y)) points.push([x, y]);
  }
  return { points, fit };
}
