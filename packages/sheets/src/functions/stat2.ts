import { arrayOf, DIV0, isError, NA, NUM, toBool, toNumber, type ErrorValue, type Value } from "../values";
import { betaI, choose, gamma, gammaP, invert, lnGamma, normCdf, normInv, normPdf } from "./special";
import { eachValue, numbersIn, scalar, simple, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

type Table = Record<string, FunctionDef>;

/** A function of numbers (and, at the positions in `flags`, booleans given as 1 or 0), applied item by item. NaN is `#NUM!`. */
function numeric(min: number, max: number, fn: (x: number[]) => number | ErrorValue, flags: number[] = []): FunctionDef {
  return simple(min, max, (vs) => {
    const x: number[] = [];
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]!;
      if (flags.includes(i)) {
        const b = toBool(v);
        if (isError(b)) return b;
        x.push(b ? 1 : 0);
      } else {
        const n = toNumber(v);
        if (isError(n)) return n;
        x.push(n);
      }
    }
    const r = fn(x);
    return typeof r === "number" && !Number.isFinite(r) ? NUM : r;
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** The numbers in the arguments; the first error is returned. */
function over(args: Arg[], ctx: Ctx, fn: (xs: number[]) => Value | ArrayRows): Arg {
  const xs = numbersIn(args, ctx);
  if (isError(xs)) return xs;
  const r = fn(xs);
  return Array.isArray(r) ? arrayOf(r) : r;
}
type ArrayRows = Value[][];

const stats = (fn: (xs: number[]) => Value | ArrayRows, min = 1): FunctionDef => ({ min, max: 255, fn: (args, ctx) => over(args, ctx, fn) });

/** Two columns of numbers of the same length, pairs with a non-number dropped. */
function pairsOf(a: Arg, b: Arg, ctx: Ctx): [number[], number[]] | Value {
  const x = toGrid(a, ctx).flat();
  const y = toGrid(b, ctx).flat();
  if (x.length !== y.length) return NA;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (isError(x[i]!)) return x[i]!;
    if (isError(y[i]!)) return y[i]!;
    if (typeof x[i] === "number" && typeof y[i] === "number") {
      xs.push(x[i] as number);
      ys.push(y[i] as number);
    }
  }
  return [xs, ys];
}

function twoSets(fn: (xs: number[], ys: number[]) => number): FunctionDef {
  return {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const p = pairsOf(args[0] as Arg, args[1] as Arg, ctx);
      if (!Array.isArray(p)) return p as Value;
      if (p[0].length < 2) return DIV0;
      const r = fn(p[0], p[1]);
      return Number.isFinite(r) ? r : DIV0;
    },
  };
}

const sumSq = (xs: number[], m: number) => xs.reduce((s, x) => s + (x - m) ** 2, 0);

function percentileExc(xs: number[], k: number): Value {
  const n = xs.length;
  if (n === 0 || k <= 0 || k >= 1) return NUM;
  const pos = k * (n + 1);
  if (pos < 1 || pos > n) return NUM;
  const s = sorted(xs);
  const lo = Math.floor(pos);
  return s[lo - 1]! + (s[Math.min(lo, n - 1)]! - s[lo - 1]!) * (pos - lo);
}

function percentRank(xs: number[], x: number, sig: number, exclusive: boolean): Value {
  const s = sorted(xs);
  const n = s.length;
  if (n === 0 || x < s[0]! || x > s[n - 1]!) return NA;
  let i = 0;
  while (i < n - 1 && s[i + 1]! <= x) i++;
  let rank: number;
  if (s[i] === x) rank = i;
  else rank = i + (x - s[i]!) / (s[i + 1]! - s[i]!);
  const r = exclusive ? (rank + 1) / (n + 1) : n === 1 ? 1 : rank / (n - 1);
  const p = 10 ** sig;
  return Math.floor(r * p) / p;
}

// ---- distributions ----

const tCdf = (x: number, df: number) => {
  const p = 0.5 * betaI(df / (df + x * x), df / 2, 0.5);
  return x > 0 ? 1 - p : p;
};
const tPdf = (x: number, df: number) => Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2)) / Math.sqrt(df * Math.PI) * (1 + (x * x) / df) ** (-(df + 1) / 2);
const chiCdf = (x: number, df: number) => gammaP(df / 2, x / 2);
const chiPdf = (x: number, df: number) => (x < 0 ? 0 : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - lnGamma(df / 2)));
const fCdf = (x: number, d1: number, d2: number) => (x <= 0 ? 0 : betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2));
const fPdf = (x: number, d1: number, d2: number) => (x < 0 ? 0 : Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lnGamma(d1 / 2) + lnGamma(d2 / 2) - lnGamma((d1 + d2) / 2))));
const gammaCdf = (x: number, a: number, b: number) => gammaP(a, x / b);
const gammaPdf = (x: number, a: number, b: number) => (x < 0 ? 0 : Math.exp((a - 1) * Math.log(x) - x / b - a * Math.log(b) - lnGamma(a)));
const betaCdf = (x: number, a: number, b: number, lo: number, hi: number) => betaI((x - lo) / (hi - lo), a, b);
const betaPdf = (x: number, a: number, b: number, lo: number, hi: number) => Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + (a - 1) * Math.log((x - lo) / (hi - lo)) + (b - 1) * Math.log(1 - (x - lo) / (hi - lo))) / (hi - lo);
const binomPmf = (k: number, n: number, p: number) => choose(n, k) * p ** k * (1 - p) ** (n - k);
const binomCdf = (k: number, n: number, p: number) => {
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomPmf(i, n, p);
  return Math.min(1, s);
};
const poissonPmf = (k: number, m: number) => Math.exp(-m + k * Math.log(m) - lnGamma(k + 1));
const poissonCdf = (k: number, m: number) => {
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPmf(i, m);
  return Math.min(1, s);
};

export const stats2: Table = {
  AVEDEV: stats((xs) => (xs.length ? xs.reduce((s, x) => s + Math.abs(x - mean(xs)), 0) / xs.length : NUM)),
  DEVSQ: stats((xs) => (xs.length ? sumSq(xs, mean(xs)) : NUM)),
  HARMEAN: stats((xs) => (!xs.length || xs.some((x) => x <= 0) ? NUM : xs.length / xs.reduce((s, x) => s + 1 / x, 0))),
  TRIMMEAN: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const k = toNumber(scalar(args[1], ctx));
      if (isError(k)) return k;
      return over([args[0] as Arg], ctx, (xs) => {
        if (k < 0 || k >= 1 || xs.length === 0) return NUM;
        const cut = Math.floor((xs.length * k) / 2);
        const s = sorted(xs).slice(cut, xs.length - cut);
        return mean(s);
      });
    },
  },
  SKEW: stats((xs) => {
    const n = xs.length;
    if (n < 3) return DIV0;
    const m = mean(xs);
    const sd = Math.sqrt(sumSq(xs, m) / (n - 1));
    if (sd === 0) return DIV0;
    return (n / ((n - 1) * (n - 2))) * xs.reduce((s, x) => s + ((x - m) / sd) ** 3, 0);
  }),
  "SKEW.P": stats((xs) => {
    const n = xs.length;
    if (n < 3) return DIV0;
    const m = mean(xs);
    const sd = Math.sqrt(sumSq(xs, m) / n);
    if (sd === 0) return DIV0;
    return xs.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n;
  }),
  KURT: stats((xs) => {
    const n = xs.length;
    if (n < 4) return DIV0;
    const m = mean(xs);
    const sd = Math.sqrt(sumSq(xs, m) / (n - 1));
    if (sd === 0) return DIV0;
    const s4 = xs.reduce((s, x) => s + ((x - m) / sd) ** 4, 0);
    return (n * (n + 1) * s4) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  }),
  STANDARDIZE: numeric(3, 3, ([x, m, sd]) => (sd! <= 0 ? NUM : (x! - m!) / sd!)),
  FISHER: numeric(1, 1, ([x]) => (Math.abs(x!) >= 1 ? NUM : 0.5 * Math.log((1 + x!) / (1 - x!)))),
  FISHERINV: numeric(1, 1, ([y]) => (Math.exp(2 * y!) - 1) / (Math.exp(2 * y!) + 1)),
  "PERCENTILE.EXC": {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const k = toNumber(scalar(args[1], ctx));
      return isError(k) ? k : over([args[0] as Arg], ctx, (xs) => percentileExc(xs, k));
    },
  },
  "QUARTILE.EXC": {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const q = toNumber(scalar(args[1], ctx));
      if (isError(q)) return q;
      return over([args[0] as Arg], ctx, (xs) => (q < 1 || q > 3 || q !== Math.floor(q) ? NUM : percentileExc(xs, q / 4)));
    },
  },
  PERCENTRANK: percentRankFn(false),
  "PERCENTRANK.INC": percentRankFn(false),
  "PERCENTRANK.EXC": percentRankFn(true),
  RSQ: twoSets((ys, xs) => {
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => {
      sxy += (x - mx) * (ys[i]! - my);
      sxx += (x - mx) ** 2;
      syy += (ys[i]! - my) ** 2;
    });
    return (sxy * sxy) / (sxx * syy);
  }),
  PEARSON: twoSets((xs, ys) => {
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => {
      sxy += (x - mx) * (ys[i]! - my);
      sxx += (x - mx) ** 2;
      syy += (ys[i]! - my) ** 2;
    });
    return sxy / Math.sqrt(sxx * syy);
  }),
  STEYX: twoSets((ys, xs) => {
    const n = xs.length;
    if (n < 3) return NaN;
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => {
      sxy += (x - mx) * (ys[i]! - my);
      sxx += (x - mx) ** 2;
      syy += (ys[i]! - my) ** 2;
    });
    return Math.sqrt((syy - (sxy * sxy) / sxx) / (n - 2));
  }),
  COVAR: twoSets((xs, ys) => covariance(xs, ys, 0)),
  "COVARIANCE.P": twoSets((xs, ys) => covariance(xs, ys, 0)),
  "COVARIANCE.S": twoSets((xs, ys) => covariance(xs, ys, 1)),
  MODE: stats((xs) => {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    let best: number | undefined;
    let n = 1;
    for (const x of xs) if ((counts.get(x) ?? 0) > n) [best, n] = [x, counts.get(x)!];
    return best ?? NA;
  }),
  "MODE.MULT": stats((xs) => {
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const top = Math.max(0, ...counts.values());
    if (top < 2) return NA;
    const seen = new Set<number>();
    const out: Value[][] = [];
    for (const x of xs) if (counts.get(x) === top && !seen.has(x)) (seen.add(x), out.push([x]));
    return out;
  }),
  FREQUENCY: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const data = numbersIn([args[0] as Arg], ctx);
      const bins = numbersIn([args[1] as Arg], ctx);
      if (isError(data)) return data;
      if (isError(bins)) return bins;
      const sortedBins = sorted(bins);
      const counts = new Array<number>(bins.length + 1).fill(0);
      for (const x of data) {
        let i = 0;
        while (i < sortedBins.length && x > sortedBins[i]!) i++;
        counts[i]!++;
      }
      return arrayOf(counts.map((c) => [c]));
    },
  },
  MAXA: valuesA((xs) => (xs.length ? Math.max(...xs) : 0)),
  MINA: valuesA((xs) => (xs.length ? Math.min(...xs) : 0)),
  VARA: valuesA((xs) => (xs.length < 2 ? DIV0 : sumSq(xs, mean(xs)) / (xs.length - 1))),
  VARPA: valuesA((xs) => (xs.length < 1 ? DIV0 : sumSq(xs, mean(xs)) / xs.length)),
  STDEVA: valuesA((xs) => (xs.length < 2 ? DIV0 : Math.sqrt(sumSq(xs, mean(xs)) / (xs.length - 1)))),
  STDEVPA: valuesA((xs) => (xs.length < 1 ? DIV0 : Math.sqrt(sumSq(xs, mean(xs)) / xs.length))),

  // The normal distribution
  "NORM.S.DIST": numeric(2, 2, ([z, c]) => (c ? normCdf(z!) : normPdf(z!)), [1]),
  NORMSDIST: numeric(1, 1, ([z]) => normCdf(z!)),
  "NORM.S.INV": numeric(1, 1, ([p]) => normInv(p!)),
  NORMSINV: numeric(1, 1, ([p]) => normInv(p!)),
  "NORM.DIST": numeric(4, 4, ([x, m, sd, c]) => (sd! <= 0 ? NUM : c ? normCdf((x! - m!) / sd!) : normPdf((x! - m!) / sd!) / sd!), [3]),
  NORMDIST: numeric(4, 4, ([x, m, sd, c]) => (sd! <= 0 ? NUM : c ? normCdf((x! - m!) / sd!) : normPdf((x! - m!) / sd!) / sd!), [3]),
  "NORM.INV": numeric(3, 3, ([p, m, sd]) => (sd! <= 0 ? NUM : m! + sd! * normInv(p!))),
  NORMINV: numeric(3, 3, ([p, m, sd]) => (sd! <= 0 ? NUM : m! + sd! * normInv(p!))),
  GAUSS: numeric(1, 1, ([z]) => normCdf(z!) - 0.5),
  PHI: numeric(1, 1, ([x]) => normPdf(x!)),
  "LOGNORM.DIST": numeric(4, 4, ([x, m, sd, c]) => (x! <= 0 || sd! <= 0 ? NUM : c ? normCdf((Math.log(x!) - m!) / sd!) : normPdf((Math.log(x!) - m!) / sd!) / (x! * sd!)), [3]),
  LOGNORMDIST: numeric(3, 3, ([x, m, sd]) => (x! <= 0 || sd! <= 0 ? NUM : normCdf((Math.log(x!) - m!) / sd!))),
  "LOGNORM.INV": numeric(3, 3, ([p, m, sd]) => (sd! <= 0 ? NUM : Math.exp(m! + sd! * normInv(p!)))),
  LOGINV: numeric(3, 3, ([p, m, sd]) => (sd! <= 0 ? NUM : Math.exp(m! + sd! * normInv(p!)))),
  "CONFIDENCE.NORM": numeric(3, 3, ([a, sd, n]) => (a! <= 0 || a! >= 1 || sd! <= 0 || n! < 1 ? NUM : (-normInv(a! / 2) * sd!) / Math.sqrt(Math.floor(n!)))),
  CONFIDENCE: numeric(3, 3, ([a, sd, n]) => (a! <= 0 || a! >= 1 || sd! <= 0 || n! < 1 ? NUM : (-normInv(a! / 2) * sd!) / Math.sqrt(Math.floor(n!)))),
  "CONFIDENCE.T": numeric(3, 3, ([a, sd, n]) => {
    if (a! <= 0 || a! >= 1 || sd! <= 0 || n! < 1) return NUM;
    if (n! === 1) return DIV0;
    const df = Math.floor(n!) - 1;
    return (invert((x) => tCdf(x, df), 1 - a! / 2, 0, 10) * sd!) / Math.sqrt(Math.floor(n!));
  }),

  // Discrete distributions
  "BINOM.DIST": numeric(4, 4, ([k, n, p, c]) => (n! < 0 || p! < 0 || p! > 1 || k! < 0 || k! > n! ? NUM : c ? binomCdf(Math.floor(k!), Math.floor(n!), p!) : binomPmf(Math.floor(k!), Math.floor(n!), p!)), [3]),
  BINOMDIST: numeric(4, 4, ([k, n, p, c]) => (n! < 0 || p! < 0 || p! > 1 || k! < 0 || k! > n! ? NUM : c ? binomCdf(Math.floor(k!), Math.floor(n!), p!) : binomPmf(Math.floor(k!), Math.floor(n!), p!)), [3]),
  "BINOM.INV": numeric(3, 3, ([n, p, alpha]) => {
    if (n! < 0 || p! < 0 || p! > 1 || alpha! < 0 || alpha! > 1) return NUM;
    let s = 0;
    for (let k = 0; k <= n!; k++) {
      s += binomPmf(k, Math.floor(n!), p!);
      if (s >= alpha! - 1e-15) return k;
    }
    return NUM;
  }),
  CRITBINOM: numeric(3, 3, ([n, p, alpha]) => {
    let s = 0;
    for (let k = 0; k <= n!; k++) {
      s += binomPmf(k, Math.floor(n!), p!);
      if (s >= alpha! - 1e-15) return k;
    }
    return NUM;
  }),
  "POISSON.DIST": numeric(3, 3, ([k, m, c]) => (k! < 0 || m! < 0 ? NUM : c ? poissonCdf(Math.floor(k!), m!) : poissonPmf(Math.floor(k!), m!)), [2]),
  POISSON: numeric(3, 3, ([k, m, c]) => (k! < 0 || m! < 0 ? NUM : c ? poissonCdf(Math.floor(k!), m!) : poissonPmf(Math.floor(k!), m!)), [2]),
  "NEGBINOM.DIST": numeric(4, 4, ([f, s, p, c]) => {
    if (f! < 0 || s! < 1 || p! < 0 || p! > 1) return NUM;
    const pmf = (k: number) => choose(k + Math.floor(s!) - 1, k) * p! ** Math.floor(s!) * (1 - p!) ** k;
    if (!c) return pmf(Math.floor(f!));
    let sum = 0;
    for (let k = 0; k <= Math.floor(f!); k++) sum += pmf(k);
    return Math.min(1, sum);
  }, [3]),
  "HYPGEOM.DIST": numeric(5, 5, ([k, n, K, N, c]) => {
    if (n! < 0 || n! > N! || K! < 0 || K! > N! || k! < 0 || k! > n!) return NUM;
    const pmf = (x: number) => (choose(K!, x) * choose(N! - K!, n! - x)) / choose(N!, n!);
    if (!c) return pmf(Math.floor(k!));
    let sum = 0;
    for (let x = 0; x <= Math.floor(k!); x++) sum += pmf(x);
    return Math.min(1, sum);
  }, [4]),
  "EXPON.DIST": numeric(3, 3, ([x, l, c]) => (x! < 0 || l! <= 0 ? NUM : c ? 1 - Math.exp(-l! * x!) : l! * Math.exp(-l! * x!)), [2]),
  EXPONDIST: numeric(3, 3, ([x, l, c]) => (x! < 0 || l! <= 0 ? NUM : c ? 1 - Math.exp(-l! * x!) : l! * Math.exp(-l! * x!)), [2]),
  "WEIBULL.DIST": numeric(4, 4, ([x, a, b, c]) => (x! < 0 || a! <= 0 || b! <= 0 ? NUM : c ? 1 - Math.exp(-((x! / b!) ** a!)) : (a! / b! ** a!) * x! ** (a! - 1) * Math.exp(-((x! / b!) ** a!))), [3]),
  WEIBULL: numeric(4, 4, ([x, a, b, c]) => (x! < 0 || a! <= 0 || b! <= 0 ? NUM : c ? 1 - Math.exp(-((x! / b!) ** a!)) : (a! / b! ** a!) * x! ** (a! - 1) * Math.exp(-((x! / b!) ** a!))), [3]),
  GAMMA: numeric(1, 1, ([x]) => (x! <= 0 && Number.isInteger(x!) ? NUM : gamma(x!))),
  GAMMALN: numeric(1, 1, ([x]) => (x! <= 0 ? NUM : lnGamma(x!))),
  "GAMMALN.PRECISE": numeric(1, 1, ([x]) => (x! <= 0 ? NUM : lnGamma(x!))),
  "GAMMA.DIST": numeric(4, 4, ([x, a, b, c]) => (x! < 0 || a! <= 0 || b! <= 0 ? NUM : c ? gammaCdf(x!, a!, b!) : gammaPdf(x!, a!, b!)), [3]),
  GAMMADIST: numeric(4, 4, ([x, a, b, c]) => (x! < 0 || a! <= 0 || b! <= 0 ? NUM : c ? gammaCdf(x!, a!, b!) : gammaPdf(x!, a!, b!)), [3]),
  "GAMMA.INV": numeric(3, 3, ([p, a, b]) => (p! < 0 || p! >= 1 || a! <= 0 || b! <= 0 ? NUM : p! === 0 ? 0 : invert((x) => gammaCdf(x, a!, b!), p!, 0, a! * b! + 1))),
  GAMMAINV: numeric(3, 3, ([p, a, b]) => (p! < 0 || p! >= 1 || a! <= 0 || b! <= 0 ? NUM : p! === 0 ? 0 : invert((x) => gammaCdf(x, a!, b!), p!, 0, a! * b! + 1))),
  "BETA.DIST": numeric(4, 6, ([x, a, b, c, lo = 0, hi = 1]) => (a! <= 0 || b! <= 0 || x! < lo! || x! > hi! || lo! >= hi! ? NUM : c ? betaCdf(x!, a!, b!, lo!, hi!) : betaPdf(x!, a!, b!, lo!, hi!)), [3]),
  BETADIST: numeric(3, 5, ([x, a, b, lo = 0, hi = 1]) => (a! <= 0 || b! <= 0 || x! < lo! || x! > hi! || lo! >= hi! ? NUM : betaCdf(x!, a!, b!, lo!, hi!))),
  "BETA.INV": numeric(3, 5, ([p, a, b, lo = 0, hi = 1]) => (a! <= 0 || b! <= 0 || p! <= 0 || p! > 1 || lo! >= hi! ? NUM : lo! + (hi! - lo!) * invert((x) => betaI(x, a!, b!), p!, 0, 1))),
  BETAINV: numeric(3, 5, ([p, a, b, lo = 0, hi = 1]) => (a! <= 0 || b! <= 0 || p! <= 0 || p! > 1 || lo! >= hi! ? NUM : lo! + (hi! - lo!) * invert((x) => betaI(x, a!, b!), p!, 0, 1))),

  // t, chi-square and F
  "T.DIST": numeric(3, 3, ([x, df, c]) => (df! < 1 ? NUM : c ? tCdf(x!, Math.floor(df!)) : tPdf(x!, Math.floor(df!))), [2]),
  "T.DIST.RT": numeric(2, 2, ([x, df]) => (df! < 1 ? NUM : 1 - tCdf(x!, Math.floor(df!)))),
  "T.DIST.2T": numeric(2, 2, ([x, df]) => (df! < 1 || x! < 0 ? NUM : 2 * (1 - tCdf(x!, Math.floor(df!))))),
  TDIST: numeric(3, 3, ([x, df, tails]) => (df! < 1 || x! < 0 || (tails !== 1 && tails !== 2) ? NUM : tails! * (1 - tCdf(x!, Math.floor(df!))))),
  "T.INV": numeric(2, 2, ([p, df]) => (p! <= 0 || p! >= 1 || df! < 1 ? NUM : invert((x) => tCdf(x, Math.floor(df!)), p!, -10, 10))),
  "T.INV.2T": numeric(2, 2, ([p, df]) => (p! <= 0 || p! > 1 || df! < 1 ? NUM : invert((x) => tCdf(x, Math.floor(df!)), 1 - p! / 2, 0, 10))),
  TINV: numeric(2, 2, ([p, df]) => (p! <= 0 || p! > 1 || df! < 1 ? NUM : invert((x) => tCdf(x, Math.floor(df!)), 1 - p! / 2, 0, 10))),
  "CHISQ.DIST": numeric(3, 3, ([x, df, c]) => (x! < 0 || df! < 1 ? NUM : c ? chiCdf(x!, Math.floor(df!)) : chiPdf(x!, Math.floor(df!))), [2]),
  "CHISQ.DIST.RT": numeric(2, 2, ([x, df]) => (x! < 0 || df! < 1 ? NUM : 1 - chiCdf(x!, Math.floor(df!)))),
  CHIDIST: numeric(2, 2, ([x, df]) => (x! < 0 || df! < 1 ? NUM : 1 - chiCdf(x!, Math.floor(df!)))),
  "CHISQ.INV": numeric(2, 2, ([p, df]) => (p! < 0 || p! >= 1 || df! < 1 ? NUM : p! === 0 ? 0 : invert((x) => chiCdf(x, Math.floor(df!)), p!, 0, df! + 1))),
  "CHISQ.INV.RT": numeric(2, 2, ([p, df]) => (p! <= 0 || p! > 1 || df! < 1 ? NUM : invert((x) => chiCdf(x, Math.floor(df!)), 1 - p!, 0, df! + 1))),
  CHIINV: numeric(2, 2, ([p, df]) => (p! <= 0 || p! > 1 || df! < 1 ? NUM : invert((x) => chiCdf(x, Math.floor(df!)), 1 - p!, 0, df! + 1))),
  "F.DIST": numeric(4, 4, ([x, d1, d2, c]) => (x! < 0 || d1! < 1 || d2! < 1 ? NUM : c ? fCdf(x!, Math.floor(d1!), Math.floor(d2!)) : fPdf(x!, Math.floor(d1!), Math.floor(d2!))), [3]),
  "F.DIST.RT": numeric(3, 3, ([x, d1, d2]) => (x! < 0 || d1! < 1 || d2! < 1 ? NUM : 1 - fCdf(x!, Math.floor(d1!), Math.floor(d2!)))),
  FDIST: numeric(3, 3, ([x, d1, d2]) => (x! < 0 || d1! < 1 || d2! < 1 ? NUM : 1 - fCdf(x!, Math.floor(d1!), Math.floor(d2!)))),
  "F.INV": numeric(3, 3, ([p, d1, d2]) => (p! <= 0 || p! >= 1 || d1! < 1 || d2! < 1 ? NUM : invert((x) => fCdf(x, Math.floor(d1!), Math.floor(d2!)), p!, 0, 10))),
  "F.INV.RT": numeric(3, 3, ([p, d1, d2]) => (p! <= 0 || p! >= 1 || d1! < 1 || d2! < 1 ? NUM : invert((x) => fCdf(x, Math.floor(d1!), Math.floor(d2!)), 1 - p!, 0, 10))),
  FINV: numeric(3, 3, ([p, d1, d2]) => (p! <= 0 || p! >= 1 || d1! < 1 || d2! < 1 ? NUM : invert((x) => fCdf(x, Math.floor(d1!), Math.floor(d2!)), 1 - p!, 0, 10))),

  // Counting
  COMBIN: numeric(2, 2, ([n, k]) => (n! < 0 || k! < 0 || k! > n! ? NUM : choose(Math.floor(n!), Math.floor(k!)))),
  COMBINA: numeric(2, 2, ([n, k]) => (n! < 0 || k! < 0 || (n! === 0 && k! > 0) ? NUM : n! === 0 ? 1 : choose(Math.floor(n!) + Math.floor(k!) - 1, Math.floor(k!)))),
  PERMUT: numeric(2, 2, ([n, k]) => {
    if (n! < 0 || k! < 0 || k! > n!) return NUM;
    let r = 1;
    for (let i = 0; i < Math.floor(k!); i++) r *= Math.floor(n!) - i;
    return r;
  }),
  PERMUTATIONA: numeric(2, 2, ([n, k]) => (n! < 0 || k! < 0 ? NUM : Math.floor(n!) ** Math.floor(k!))),
};

function covariance(xs: number[], ys: number[], sample: number): number {
  const mx = mean(xs);
  const my = mean(ys);
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / (xs.length - sample);
}

function percentRankFn(exclusive: boolean): FunctionDef {
  return {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const x = toNumber(scalar(args[1], ctx));
      const sig = args[2] === undefined ? 3 : toNumber(scalar(args[2], ctx));
      if (isError(x)) return x;
      if (isError(sig)) return sig;
      if (sig < 1) return NUM;
      return over([args[0] as Arg], ctx, (xs) => percentRank(xs, x, Math.floor(sig), exclusive));
    },
  };
}

/** The `A` statistics read text in a range as 0 and TRUE as 1. */
function valuesA(fn: (xs: number[]) => Value): FunctionDef {
  return {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      const xs: number[] = [];
      let error: Value | undefined;
      for (const a of args as Arg[]) {
        eachValue(a, ctx, (v) => {
          if (isError(v)) error ??= v;
          else if (typeof v === "number") xs.push(v);
          else if (typeof v === "boolean") xs.push(v ? 1 : 0);
          else if (typeof v === "string") xs.push(0);
        });
      }
      return error ?? fn(xs);
    },
  };
}
