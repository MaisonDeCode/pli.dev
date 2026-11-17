import { arrayOf, isArray, isError, NA, NUM, serialDate, toNumber, VALUE, type ErrorValue, type Value } from "../values";
import { isRef, scalar, toGrid } from "./helpers";
import { normInv } from "./special";
import type { Arg, Ctx, FunctionDef } from "./types";

/*
 * `FORECAST.ETS`, `FORECAST.ETS.CONFINT`, `FORECAST.ETS.SEASONALITY` and `FORECAST.ETS.STAT`: forecasts with the AAA
 * version of exponential triple smoothing (additive error, additive trend, additive seasonality), as Excel describes it.
 *
 * The timeline is put in order, points that share a time are combined (`aggregation`), the steps between points must all
 * be a whole number of the smallest step (or whole months, for dates on the same day of each month), and gaps are filled
 * in (`data_completion`). The smoothing constants are searched for between 0.001 and 1 in steps of 0.001, each with the
 * starting states that give the smallest squared errors.
 *
 * Excel's own search is not published. What is known of it from Excel's results for the sample in the excel-check kit
 * (file 42): the constants it reports are multiples of 0.001 (alpha 0.126, beta and gamma 0.001), it finds a pattern of 4
 * in a series made from a pattern of 4 (and not 8), and it does not minimise the squared errors (its starting states are not
 * the best ones), so its forecasts differ a little from the ones here. The numbers are close, not equal.
 */

const RESOLUTION = 0.001;

/** The points of a series, in time order, one for each step. */
interface Series {
  y: number[];
  /** Where the time `t` falls, counted in steps from the first point (a fraction if it is between steps), or NaN. */
  position(t: number): number;
  step: number;
  /** The step as `FORECAST.ETS.STAT` reports it: in the time's own units, so for dates a month is the number of days that most months have (31 for a series of the 1st of each month in Excel). */
  reportedStep: number;
  /** The share of the steps that had no data. */
  missing: number;
}

const AGGREGATORS = [
  (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length, // 1 AVERAGE
  (v: number[]) => v.length, // 2 COUNT
  (v: number[]) => v.length, // 3 COUNTA
  (v: number[]) => Math.max(...v), // 4 MAX
  (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  }, // 5 MEDIAN
  (v: number[]) => Math.min(...v), // 6 MIN
  (v: number[]) => v.reduce((a, b) => a + b, 0), // 7 SUM
];

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** The values and times as a series with one point per step, or the error. */
function buildSeries(values: Value[][], times: Value[][], completion: number, aggregation: number): Series | ErrorValue {
  const ys = values.flat();
  const ts = times.flat();
  if (ys.length !== ts.length) return NA;
  const pairs: { t: number; y: number }[] = [];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i]!;
    const t = ts[i]!;
    if (isError(y)) return y;
    if (isError(t)) return t;
    if (typeof y !== "number" || typeof t !== "number") return VALUE;
    pairs.push({ t, y });
  }
  if (pairs.length < 2) return VALUE;
  pairs.sort((a, b) => a.t - b.t);
  // Points that share a time are combined.
  const times1: number[] = [];
  const ys1: number[] = [];
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j]!.t === pairs[i]!.t) j++;
    const group = pairs.slice(i, j).map((p) => p.y);
    times1.push(pairs[i]!.t);
    ys1.push(group.length === 1 ? group[0]! : AGGREGATORS[aggregation - 1]!(group));
    i = j;
  }
  if (times1.length < 2) return NUM;

  // The step: the smallest gap, if every gap is a whole number of them; otherwise whole months.
  let step = Infinity;
  for (let i = 1; i < times1.length; i++) step = Math.min(step, times1[i]! - times1[i - 1]!);
  let index: number[];
  let position: (t: number) => number;
  let reportedStep = step;
  const regular = times1.every((t) => near((t - times1[0]!) / step, Math.round((t - times1[0]!) / step)));
  if (regular) {
    index = times1.map((t) => Math.round((t - times1[0]!) / step));
    position = (t) => (t - times1[0]!) / step;
  } else {
    const months = times1.map((t) => {
      const d = serialDate(Math.floor(t));
      return { m: d.year * 12 + d.month - 1, day: d.day, last: new Date(Date.UTC(d.year, d.month, 0)).getUTCDate() };
    });
    const whole = times1.every((t) => t === Math.floor(t));
    const sameDay = months.every((m) => m.day === months[0]!.day) || months.every((m) => m.day === m.last);
    if (!whole || !sameDay) return NUM;
    let ms = Infinity;
    for (let i = 1; i < months.length; i++) ms = Math.min(ms, months[i]!.m - months[i - 1]!.m);
    if (ms <= 0 || !months.every((m) => (m.m - months[0]!.m) % ms === 0)) return NUM;
    index = months.map((m) => (m.m - months[0]!.m) / ms);
    step = ms;
    // Excel reports the gap most often found, in days (31 for months, as it shows).
    const counts = new Map<number, number>();
    for (let i = 1; i < times1.length; i++) counts.set(times1[i]! - times1[i - 1]!, (counts.get(times1[i]! - times1[i - 1]!) ?? 0) + 1);
    let top = 0;
    for (const [gap, count] of counts) if (count > top || (count === top && gap > reportedStep)) ((top = count), (reportedStep = gap));
    const first = months[0]!;
    position = (t) => {
      const d = serialDate(Math.floor(t));
      return (d.year * 12 + d.month - 1 - first.m) / ms;
    };
  }
  const n = index[index.length - 1]! + 1;
  const y = new Array<number>(n).fill(NaN);
  index.forEach((k, i) => (y[k] = ys1[i]!));
  let gaps = 0;
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(y[k]!)) continue;
    gaps++;
    if (completion === 0) {
      y[k] = 0;
      continue;
    }
    let a = k - 1;
    while (Number.isNaN(y[a]!) && a > 0) a--;
    let b = k + 1;
    while (b < n && Number.isNaN(y[b]!)) b++;
    // `y[a]` may itself be a gap just filled in: it is not, because gaps are filled from the left.
    y[k] = y[a]! + ((y[b]! - y[a]!) * (k - a)) / (b - a);
  }
  return { y, step, reportedStep, position, missing: gaps / n };
}

/**
 * The length of the pattern that repeats, or 1 for none: the lag (from 2 to half the series) at which the series, once its
 * straight-line trend is taken out, correlates best with itself, if that is clearly more than chance. This is what finds the 4
 * Excel finds in a series that repeats every 4 steps (and not the 8 of its double).
 */
function detectPeriod(y: number[]): number {
  const n = y.length;
  if (n < 6) return 1;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += y[i]!;
    sxy += i * y[i]!;
    sxx += i * i;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const level = (sy - slope * sx) / n;
  const d = y.map((v, i) => v - level - slope * i);
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const c0 = d.reduce((a, v) => a + (v - mean) ** 2, 0);
  if (c0 <= 1e-12 * Math.max(1, ...y.map((v) => v * v)) * n) return 1;
  const acf = (lag: number): number => {
    let c = 0;
    for (let i = lag; i < n; i++) c += (d[i]! - mean) * (d[i - lag]! - mean);
    return c / c0;
  };
  const threshold = Math.max(0.3, 2 / Math.sqrt(n));
  let best = 1;
  let bestValue = threshold;
  for (let lag = 2; lag <= Math.floor(n / 2); lag++) {
    const v = acf(lag);
    // A peak: higher than its neighbours (the lag before is always there; the one after only if the series has it).
    if (v > bestValue && v >= acf(lag - 1) && (lag + 1 >= n || v >= acf(lag + 1))) {
      best = lag;
      bestValue = v;
    }
  }
  return best;
}

/** The share of the work (points times states) above which the starting states are found by a rule of thumb instead of by least squares. */
const LEAST_SQUARES_LIMIT = 400_000;

/** Solves the normal equations of a least-squares problem (columns of `a`, target `b`), or null when they are singular. */
function leastSquares(a: number[][], b: number[]): number[] | null {
  const k = a.length;
  const n = b.length;
  const m: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let t = 0;
      for (let r = 0; r < n; r++) t += a[i]![r]! * a[j]![r]!;
      m[i]![j] = t;
      m[j]![i] = t;
    }
    let t = 0;
    for (let r = 0; r < n; r++) t += a[i]![r]! * b[r]!;
    m[i]![k] = t;
  }
  let scale = 0;
  for (let i = 0; i < k; i++) scale = Math.max(scale, m[i]![i]!);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) <= 1e-12 * scale) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      if (f !== 0) for (let q = c; q <= k; q++) m[r]![q]! -= f * m[c]![q]!;
    }
  }
  return m.map((row, i) => row[k]! / row[i]!);
}

/**
 * An additive-error, additive-trend, additive-seasonality model (just trend when `m` is 1 or less) with its states: the level,
 * the trend and the seasonal figures are those before the first point, and are found, for each choice of the three smoothing
 * constants, as the ones that leave the smallest squared one-step errors; the constants are searched for between 0.001 and 1
 * in steps of 0.001 (Excel reports them to three places, never 0).
 */
class Model {
  readonly n: number;
  alpha = 0.001;
  beta = 0.001;
  gamma = 0.001;
  base: number[];
  trend: number[];
  /** The latest seasonal figure for each place in the pattern. */
  idx: number[];
  fc: number[];
  mae = 0;
  mase = 0;
  mse = 0;
  rmse = 0;
  smape = 0;

  constructor(
    readonly y: number[],
    readonly m: number,
  ) {
    const n = (this.n = y.length);
    this.base = new Array(n).fill(0);
    this.trend = new Array(n).fill(0);
    this.idx = new Array(Math.max(m, 1)).fill(0);
    this.fc = new Array(n).fill(0);
  }

  get seasonal(): boolean {
    return this.m > 1;
  }

  /** Runs the smoothing from the states `start` (level, trend, then the figures of the pattern); returns the one-step errors. */
  #run(start: number[], record: boolean): number[] {
    const { n, y, m } = this;
    const seasonal = this.seasonal;
    const [alpha, beta, gamma] = [this.alpha, this.beta, this.gamma];
    let level = start[0]!;
    let trend = start[1]!;
    const figures = seasonal ? start.slice(2, 2 + m) : [];
    const errors = new Array<number>(n);
    for (let t = 0; t < n; t++) {
      const slot = seasonal ? t % m : 0;
      const season = seasonal ? figures[slot]! : 0;
      const forecast = level + trend + season;
      errors[t] = y[t]! - forecast;
      const next = alpha * (y[t]! - season) + (1 - alpha) * (level + trend);
      if (seasonal) figures[slot] = gamma * (y[t]! - next) + (1 - gamma) * season;
      trend = beta * (next - level) + (1 - beta) * trend;
      level = next;
      if (record) {
        this.fc[t] = forecast;
        this.base[t] = level;
        this.trend[t] = trend;
      }
    }
    if (record && seasonal) this.idx = figures;
    return errors;
  }

  /** The states before the first point that suit the current constants: by least squares, or by a rule of thumb for very long series. */
  #start(): number[] {
    const { n, y, m } = this;
    const free = this.seasonal ? m + 1 : 2; // level, trend and all but the last figure (the figures add up to 0)
    const expand = (p: number[]): number[] => (this.seasonal ? [p[0]!, p[1]!, ...p.slice(2), -p.slice(2).reduce((a, b) => a + b, 0)] : p);
    if (n * (free + 1) <= LEAST_SQUARES_LIMIT) {
      const zero = new Array<number>(free).fill(0);
      const base = this.#run(expand(zero), false);
      const columns = Array.from({ length: free }, (_, k) => {
        const p = zero.slice();
        p[k] = 1;
        const e = this.#run(expand(p), false);
        return e.map((v, i) => v - base[i]!);
      });
      // errors = base + sum(p_k * column_k) should be as small as can be.
      const p = leastSquares(columns, base.map((v) => -v));
      if (p && p.every(Number.isFinite)) return expand(p);
    }
    return this.#roughStart();
  }

  #roughStart(): number[] {
    const { n, y, m } = this;
    if (!this.seasonal) {
      const b0 = (y[n - 1]! - y[0]!) / (n - 1);
      return [y[0]! - b0, b0];
    }
    const periods = Math.floor(n / m);
    const averages = Array.from({ length: periods }, (_, i) => y.slice(i * m, i * m + m).reduce((a, b) => a + b, 0) / m);
    const trend = periods > 1 ? (averages[periods - 1]! - averages[0]!) / ((periods - 1) * m) : 0;
    const figures = Array.from({ length: m }, (_, j) => {
      let t = 0;
      for (let i = 0; i < periods; i++) t += y[i * m + j]! - averages[i]!;
      return t / periods;
    });
    const mean = figures.reduce((a, b) => a + b, 0) / m;
    return [averages[0]! - trend * ((m - 1) / 2 + 1), trend, ...figures.map((v) => v - mean)];
  }

  /** The sum of squared errors for the constants, with the best states for them; also records the fit. */
  #fitWith(alpha: number, beta: number, gamma: number, record: boolean): number {
    this.alpha = alpha;
    this.beta = beta;
    this.gamma = this.seasonal ? gamma : 0;
    const start = this.#start();
    const errors = this.#run(start, record);
    let sse = 0;
    for (const e of errors) sse += e * e;
    if (record) this.#statistics(errors);
    return Number.isFinite(sse) ? sse : Infinity;
  }

  #statistics(errors: number[]): void {
    const { n, y, fc } = this;
    let abs = 0;
    let sq = 0;
    let perc = 0;
    for (let i = 0; i < n; i++) {
      const e = errors[i]!;
      abs += Math.abs(e);
      sq += e * e;
      const d = Math.abs(fc[i]!) + Math.abs(y[i]!);
      perc += d === 0 ? 0 : Math.abs(e) / d;
    }
    let naive = 0;
    for (let i = 1; i < n; i++) naive += Math.abs(y[i]! - y[i - 1]!);
    this.mae = abs / n;
    this.mse = sq / n;
    this.rmse = Math.sqrt(this.mse);
    this.smape = (perc * 2) / n;
    this.mase = naive === 0 ? (abs === 0 ? 0 : Infinity) : abs / ((n * naive) / (n - 1));
  }

  fit(): void {
    const seasonal = this.seasonal;
    const cost = (p: number[]) => this.#fitWith(p[0]! / 1000, p[1]! / 1000, seasonal ? p[2]! / 1000 : 0, false);
    const dims = seasonal ? 3 : 2;
    const starts = this.n * (this.m + 2) > 20_000 ? [[100, 10, 10]] : [[100, 10, 10], [300, 100, 100], [600, 50, 300], [50, 300, 600]];
    let best: number[] | null = null;
    let bestCost = Infinity;
    const clamp = (v: number) => Math.min(1000, Math.max(1, v));
    for (const start of starts) {
      const p = start.slice(0, dims);
      let c = cost(p);
      for (let step = 256; step >= 1; ) {
        let moved = false;
        for (let k = 0; k < dims; k++) {
          for (const dir of [1, -1]) {
            const q = p.slice();
            q[k] = clamp(q[k]! + dir * step);
            if (q[k] === p[k]) continue;
            const w = cost(q);
            if (w < c - 1e-12 * Math.max(1, c)) {
              p[k] = q[k]!;
              c = w;
              moved = true;
            }
          }
        }
        if (!moved) step = Math.floor(step / 2);
      }
      if (c < bestCost - 1e-12 * Math.max(1, bestCost)) {
        bestCost = c;
        best = p;
      }
    }
    const p = best ?? [100, 10, 10];
    this.#fitWith(p[0]! / 1000, p[1]! / 1000, seasonal ? p[2]! / 1000 : 0, true);
  }

  /** The forecast `h` steps after the last point (h > 0, a fraction is possible), or inside the data for a position. */
  at(position: number): number {
    const { n, m } = this;
    const last = n - 1;
    if (position <= last) {
      const i = Math.floor(position);
      const frac = position - i;
      if (frac < RESOLUTION) return this.fc[i]!;
      return this.fc[i]! + frac * (this.fc[i + 1]! - this.fc[i]!);
    }
    const h = position - last;
    const whole = Math.floor(h);
    const frac = h - whole;
    const point = (k: number): number => {
      const seasonal = m <= 1 ? 0 : this.idx[(last + k) % m]!;
      return this.base[last]! + k * this.trend[last]! + seasonal;
    };
    if (frac < RESOLUTION) return point(whole);
    return point(whole) + frac * (point(whole + 1) - point(whole));
  }

  /** The width of the interval holding the forecast `h` steps on, at a confidence level. */
  interval(position: number, level: number): number {
    const { n, m } = this;
    const h = Math.max(1, Math.ceil(position - (n - 1)));
    let sum = 1;
    for (let j = 1; j < h; j++) {
      let c = this.alpha * (1 + j * this.beta);
      if (m > 1 && j % m === 0) c += this.gamma * (1 - this.alpha);
      sum += c * c;
    }
    const z = normInv(1 - (1 - level) / 2);
    return z * this.rmse * Math.sqrt(sum);
  }
}

// ---- arguments ----

interface Options {
  series: Series;
  model: Model;
  period: number;
}

const whole = (v: Value | undefined, fallback: number): number | ErrorValue => {
  if (v === undefined || v === null) return fallback;
  const n = toNumber(v);
  return isError(n) ? n : Math.trunc(n);
};

/** Reads and fits: `rest` is `[seasonality, data_completion, aggregation]`. */
function setup(values: Arg, timeline: Arg, rest: (Arg | undefined)[], ctx: Ctx): Options | ErrorValue {
  const given = rest.map((a) => (a === undefined ? undefined : scalar(a, ctx)));
  for (const g of given) if (g !== undefined && isError(g)) return g;
  const seasonality = whole(given[0], 1);
  const completion = whole(given[1], 1);
  const aggregation = whole(given[2], 1);
  if (typeof seasonality !== "number") return seasonality;
  if (typeof completion !== "number") return completion;
  if (typeof aggregation !== "number") return aggregation;
  if (seasonality < 0 || seasonality > 8760 || (completion !== 0 && completion !== 1) || aggregation < 1 || aggregation > 7) return NUM;
  const series = buildSeries(toGrid(values, ctx), toGrid(timeline, ctx), completion, aggregation);
  if (isError(series)) return series;
  const s = series;
  if (s.y.length < 3 || s.missing > 0.3) return NUM;
  let period = seasonality === 1 ? detectPeriod(s.y) : seasonality;
  // A pattern needs two whole repeats to be told from the trend.
  if (period > 1 && 2 * period > s.y.length) {
    if (seasonality !== 1) return NUM;
    period = 1;
  }
  const model = new Model(s.y, period);
  model.fit();
  return { series: s, model, period };
}

const isOptions = (o: Options | ErrorValue): o is Options => "model" in o;

/** A target date (or an array of them) is worked out one at a time. */
function overTargets(target: Arg, ctx: Ctx, one: (t: number) => Value): Arg {
  const grid = isRef(target) || isArray(target) ? toGrid(target, ctx) : [[scalar(target, ctx)]];
  const out = grid.map((row) =>
    row.map((v) => {
      if (isError(v)) return v;
      const t = toNumber(v as Value);
      return isError(t) ? t : one(t);
    }),
  );
  return out.length === 1 && out[0]!.length === 1 ? out[0]![0]! : (arrayOf(out));
}

function targetPosition(o: Options, t: number): number | ErrorValue {
  const p = o.series.position(t);
  if (!Number.isFinite(p) || p < 0) return NUM;
  return p;
}

const clean = (x: number): Value => (Number.isFinite(x) ? x : NUM);

export const forecastFunctions: Record<string, FunctionDef> = {
  "FORECAST.ETS": {
    min: 3,
    max: 6,
    fn: (args, ctx) => {
      const o = setup(args[1], args[2], [args[3], args[4], args[5]], ctx);
      if (!isOptions(o)) return o;
      return overTargets(args[0], ctx, (t) => {
        const p = targetPosition(o, t);
        return typeof p === "number" ? clean(o.model.at(p)) : p;
      });
    },
  },
  "FORECAST.ETS.CONFINT": {
    min: 3,
    max: 7,
    fn: (args, ctx) => {
      const level = args[3] === undefined ? 0.95 : scalar(args[3], ctx);
      const l = level === null ? 0.95 : toNumber(level);
      if (isError(l)) return l;
      if (l <= 0 || l >= 1) return NUM;
      const o = setup(args[1], args[2], [args[4], args[5], args[6]], ctx);
      if (!isOptions(o)) return o;
      return overTargets(args[0], ctx, (t) => {
        const p = targetPosition(o, t);
        return typeof p === "number" ? clean(o.model.interval(p, l)) : p;
      });
    },
  },
  "FORECAST.ETS.SEASONALITY": {
    min: 2,
    max: 4,
    fn: (args, ctx) => {
      // No seasonality argument: this is what finds it.
      const o = setup(args[0], args[1], [undefined, args[2], args[3]], ctx);
      return isOptions(o) ? o.period : o;
    },
  },
  "FORECAST.ETS.STAT": {
    min: 3,
    max: 6,
    fn: (args, ctx) => {
      const kind = scalar(args[2], ctx);
      const k = toNumber(kind);
      if (isError(k)) return k;
      const type = Math.trunc(k);
      if (type < 1 || type > 8) return NUM;
      const o = setup(args[0], args[1], [args[3], args[4], args[5]], ctx);
      if (!isOptions(o)) return o;
      const m = o.model;
      switch (type) {
        case 1: return m.alpha;
        case 2: return m.m <= 1 ? m.gamma : m.beta;
        case 3: return m.m <= 1 ? 0 : m.gamma;
        case 4: return clean(m.mase);
        case 5: return clean(m.smape);
        case 6: return clean(m.mae);
        case 7: return clean(m.rmse);
        default: return o.series.reportedStep;
      }
    },
  },
};
