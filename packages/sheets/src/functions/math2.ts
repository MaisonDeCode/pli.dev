import { arrayOf, DIV0, isError, NA, NUM, toNumber, toText, VALUE, type ErrorValue, type Value } from "../values";
import { erf, erfc, lnGamma } from "./special";
import { eachValue, isRef, numbersIn, scalar, simple, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

type Table = Record<string, FunctionDef>;

/** A function of numbers, applied item by item; NaN and infinity are `#NUM!`, `ErrorValue`s are returned. */
function numeric(min: number, max: number, fn: (x: number[]) => number | ErrorValue): FunctionDef {
  return simple(min, max, (vs) => {
    const x: number[] = [];
    for (const v of vs) {
      const n = toNumber(v);
      if (isError(n)) return n;
      x.push(n);
    }
    const r = fn(x);
    return typeof r === "number" && !Number.isFinite(r) ? NUM : r;
  });
}

const sumOver = (a: Arg, b: Arg, ctx: Ctx, f: (x: number, y: number) => number): Value => {
  const x = toGrid(a, ctx).flat();
  const y = toGrid(b, ctx).flat();
  if (x.length !== y.length) return NA;
  let total = 0;
  for (let i = 0; i < x.length; i++) {
    if (isError(x[i]!)) return x[i]!;
    if (isError(y[i]!)) return y[i]!;
    if (typeof x[i] === "number" && typeof y[i] === "number") total += f(x[i] as number, y[i] as number);
  }
  return total;
};

function matrixOf(a: Arg, ctx: Ctx): number[][] | Value {
  const g = toGrid(a, ctx);
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

function determinant(m: number[][]): number {
  const n = m.length;
  const a = m.map((r) => r.slice());
  let det = 1;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[p]![i]!)) p = r;
    if (Math.abs(a[p]![i]!) < 1e-300) return 0;
    if (p !== i) {
      [a[p], a[i]] = [a[i]!, a[p]!];
      det = -det;
    }
    det *= a[i]![i]!;
    for (let r = i + 1; r < n; r++) {
      const f = a[r]![i]! / a[i]![i]!;
      for (let c = i; c < n; c++) a[r]![c]! -= f * a[i]![c]!;
    }
  }
  return det;
}

function inverse(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[p]![i]!)) p = r;
    if (Math.abs(a[p]![i]!) < 1e-14) return null;
    [a[p], a[i]] = [a[i]!, a[p]!];
    const d = a[i]![i]!;
    for (let c = 0; c < 2 * n; c++) a[i]![c]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = a[r]![i]!;
      for (let c = 0; c < 2 * n; c++) a[r]![c]! -= f * a[i]![c]!;
    }
  }
  return a.map((r) => r.slice(n));
}

// ---- number bases ----

const DIGITS = "0123456789ABCDEF";

function parseBase(text: Value, base: number, bits: number): number | ErrorValue {
  const t = String(toText(text) as string).toUpperCase();
  if (t === "") return 0;
  if (t.length > 10) return NUM;
  let n = 0;
  for (const ch of t) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) return NUM;
    n = n * base + d;
  }
  // Ten digits is a two's complement number whose top bit says it is negative.
  const limit = 2 ** bits;
  return t.length === 10 && n >= limit / 2 ? n - limit : n;
}

function formatBase(n: number, base: number, bits: number, places?: number): Value {
  const limit = 2 ** bits;
  const t = Math.trunc(n);
  if (t < -limit / 2 || t >= limit / 2) return NUM;
  let s = (t < 0 ? t + limit : t).toString(base).toUpperCase();
  if (places !== undefined) {
    if (t < 0) return s;
    if (places < s.length || places > 10) return NUM;
    s = s.padStart(places, "0");
  }
  return s;
}

function baseConversion(from: number, to: number): FunctionDef {
  const bits = (b: number) => (b === 2 ? 10 : b === 8 ? 30 : 40);
  return simple(1, to === 10 ? 1 : 2, ([v, places]) => {
    const n = parseBase(v!, from, bits(from));
    if (isError(n)) return n;
    if (to === 10) return n;
    const p = places === undefined || places === null ? undefined : toNumber(places);
    if (p !== undefined && isError(p)) return p;
    return formatBase(n, to, bits(to), p === undefined ? undefined : Math.trunc(p));
  });
}

function decTo(base: number): FunctionDef {
  const bits = base === 2 ? 10 : base === 8 ? 30 : 40;
  return numeric(1, 2, ([n, places]) => {
    const r = formatBase(n!, base, bits, places === undefined ? undefined : Math.trunc(places));
    return r as never;
  });
}

const bitwise = (op: (a: number, b: number) => number): FunctionDef =>
  numeric(2, 2, ([a, b]) => {
    if (a! < 0 || b! < 0 || a! !== Math.floor(a!) || b! !== Math.floor(b!) || a! >= 2 ** 48 || b! >= 2 ** 48) return NUM;
    // Done in two halves, since the bit operators work on 32 bits.
    const hi = (n: number) => Math.floor(n / 2 ** 24);
    const lo = (n: number) => n % 2 ** 24;
    return op(hi(a!), hi(b!)) * 2 ** 24 + op(lo(a!), lo(b!));
  }) as FunctionDef;

// ---- units ----

interface Unit {
  /** Size in the base unit of its kind. */
  f: number;
  kind: string;
  /** Takes the metric prefixes (k, m, c…). */
  metric?: boolean;
}

const UNITS: Record<string, Unit> = {
  m: { f: 1, kind: "length", metric: true }, in: { f: 0.0254, kind: "length" }, ft: { f: 0.3048, kind: "length" }, yd: { f: 0.9144, kind: "length" },
  mi: { f: 1609.344, kind: "length" }, Nmi: { f: 1852, kind: "length" }, ang: { f: 1e-10, kind: "length", metric: true }, ell: { f: 1.143, kind: "length" },
  pica: { f: 0.0254 / 6, kind: "length" }, survey_mi: { f: 1609.3472186944373, kind: "length" },
  g: { f: 1, kind: "mass", metric: true }, lbm: { f: 453.59237, kind: "mass" }, ozm: { f: 28.349523125, kind: "mass" }, stone: { f: 6350.29318, kind: "mass" },
  ton: { f: 907184.74, kind: "mass" }, sg: { f: 14593.90294, kind: "mass" }, u: { f: 1.66053906660e-24, kind: "mass", metric: true },
  yr: { f: 31557600, kind: "time" }, day: { f: 86400, kind: "time" }, d: { f: 86400, kind: "time" }, hr: { f: 3600, kind: "time" }, mn: { f: 60, kind: "time" }, min: { f: 60, kind: "time" }, sec: { f: 1, kind: "time", metric: true }, s: { f: 1, kind: "time", metric: true },
  Pa: { f: 1, kind: "pressure", metric: true }, atm: { f: 101325, kind: "pressure", metric: true }, mmHg: { f: 133.322387415, kind: "pressure" }, Torr: { f: 133.322368421, kind: "pressure" }, psi: { f: 6894.757293168, kind: "pressure" },
  N: { f: 1, kind: "force", metric: true }, dyn: { f: 1e-5, kind: "force", metric: true }, lbf: { f: 4.4482216152605, kind: "force" }, pond: { f: 0.00980665, kind: "force", metric: true },
  J: { f: 1, kind: "energy", metric: true }, e: { f: 1e-7, kind: "energy", metric: true }, cal: { f: 4.1868, kind: "energy", metric: true }, c: { f: 4.184, kind: "energy", metric: true }, eV: { f: 1.602176634e-19, kind: "energy", metric: true },
  Wh: { f: 3600, kind: "energy", metric: true }, BTU: { f: 1055.05585262, kind: "energy" }, flb: { f: 1.3558179483314004, kind: "energy" },
  W: { f: 1, kind: "power", metric: true }, HP: { f: 745.69987158227022, kind: "power" }, PS: { f: 735.49875, kind: "power" },
  T: { f: 1, kind: "magnetism", metric: true }, ga: { f: 0.0001, kind: "magnetism", metric: true },
  l: { f: 0.001, kind: "volume", metric: true }, L: { f: 0.001, kind: "volume", metric: true }, lt: { f: 0.001, kind: "volume", metric: true }, tsp: { f: 4.92892159375e-6, kind: "volume" }, tbs: { f: 1.478676478125e-5, kind: "volume" },
  oz: { f: 2.95735295625e-5, kind: "volume" }, cup: { f: 2.365882365e-4, kind: "volume" }, pt: { f: 4.73176473e-4, kind: "volume" }, qt: { f: 9.46352946e-4, kind: "volume" }, gal: { f: 3.785411784e-3, kind: "volume" },
  "m3": { f: 1, kind: "volume", metric: true }, "ft3": { f: 0.028316846592, kind: "volume" }, "in3": { f: 1.6387064e-5, kind: "volume" },
  "m2": { f: 1, kind: "area", metric: true }, "ft2": { f: 0.09290304, kind: "area" }, "in2": { f: 6.4516e-4, kind: "area" }, "yd2": { f: 0.83612736, kind: "area" }, "mi2": { f: 2589988.110336, kind: "area" },
  ha: { f: 10000, kind: "area" }, ar: { f: 100, kind: "area" }, uk_acre: { f: 4046.8564224, kind: "area" }, us_acre: { f: 4046.8726098742514, kind: "area" },
  "m/s": { f: 1, kind: "speed", metric: true }, "m/sec": { f: 1, kind: "speed", metric: true }, "m/h": { f: 1 / 3600, kind: "speed", metric: true }, "m/hr": { f: 1 / 3600, kind: "speed", metric: true }, mph: { f: 0.44704, kind: "speed" }, kn: { f: 1852 / 3600, kind: "speed" }, admkn: { f: 1853.184 / 3600, kind: "speed" },
  bit: { f: 1, kind: "information", metric: true }, byte: { f: 8, kind: "information", metric: true },
};
const PREFIXES: Record<string, number> = { Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1, e: 1e1, d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24 };

function findUnit(name: string): { unit: Unit; prefix: number } | undefined {
  if (UNITS[name]) return { unit: UNITS[name]!, prefix: 1 };
  for (const p of ["da", ...Object.keys(PREFIXES).filter((k) => k !== "da")]) {
    if (name.startsWith(p) && name.length > p.length) {
      const u = UNITS[name.slice(p.length)];
      if (u?.metric) return { unit: u, prefix: PREFIXES[p]! };
    }
  }
  return undefined;
}

const TEMPS = ["C", "cel", "F", "fah", "K", "kel", "Rank", "Reau"];
const toKelvin = (v: number, u: string) => (u === "C" || u === "cel" ? v + 273.15 : u === "F" || u === "fah" ? ((v - 32) * 5) / 9 + 273.15 : u === "K" || u === "kel" ? v : u === "Rank" ? (v * 5) / 9 : (v * 5) / 4 + 273.15);
const fromKelvin = (k: number, u: string) => (u === "C" || u === "cel" ? k - 273.15 : u === "F" || u === "fah" ? ((k - 273.15) * 9) / 5 + 32 : u === "K" || u === "kel" ? k : u === "Rank" ? (k * 9) / 5 : ((k - 273.15) * 4) / 5);

// ---- complex numbers, written as "3+4i" ----

export interface Complex {
  re: number;
  im: number;
  suffix: string;
  /** True when the number was written without an `i` or `j` (a plain number), so it takes whichever suffix the others use. */
  bare?: boolean;
}

export function parseComplex(v: Value): Complex | null {
  if (typeof v === "number") return { re: v, im: 0, suffix: "i", bare: true };
  let t = String(toText(v) as string);
  if (t === "") return { re: 0, im: 0, suffix: "i", bare: true };
  if (/\s/.test(t)) {
    // Excel accepts spaces around the sign between the parts ("3 + 4i") but not inside a part.
    const spaced = /^\s*(\S+?)\s*([+-])\s*(\S+?)\s*$/.exec(t);
    if (!spaced) return null;
    t = `${spaced[1]}${spaced[2]}${spaced[3]}`;
  }
  // A number that ends in `i` or `j` on its own is imaginary ("4i" is 0+4i, not 4+i).
  const pure = /^([+-]?(?:\d+\.?\d*|\.\d+)?(?:[eE][+-]?\d+)?)([ij])$/.exec(t);
  if (pure && !/^[+-]?[eE]/.test(pure[1]!)) {
    const im = pure[1] === "" || pure[1] === "+" ? 1 : pure[1] === "-" ? -1 : Number(pure[1]);
    return { re: 0, im, suffix: pure[2]! };
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?(?:([+-]?(?:\d+\.?\d*|\.\d+)?(?:[eE][+-]?\d+)?)([ij]))?$/.exec(t);
  if (!m || (m[1] === undefined && m[3] === undefined)) return null;
  const imText = m[2];
  const im = m[3] === undefined ? 0 : imText === "" || imText === "+" ? 1 : imText === "-" ? -1 : Number(imText);
  return { re: m[1] === undefined ? 0 : Number(m[1]), im, suffix: m[3] ?? "i", ...(m[3] === undefined ? { bare: true } : {}) };
}

/** A number the way Excel writes it into the text of a complex number: 15 digits, `E+21` and `E-07` for the very large and very small. */
function complexPart(x: number): string {
  const r = Number(x.toPrecision(15));
  const t = String(r);
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(t);
  return m ? `${m[1]}E${m[2]}${m[3]!.padStart(2, "0")}` : t;
}

export function complexText(re: number, im: number, suffix = "i"): string {
  const r = Number(re.toPrecision(15));
  const i = Number(im.toPrecision(15));
  if (i === 0) return complexPart(r);
  const part = i === 1 ? "" : i === -1 ? "-" : complexPart(i);
  return `${r === 0 ? "" : complexPart(r)}${i > 0 && r !== 0 ? "+" : ""}${part}${suffix}`;
}

/** The complex numbers in the arguments, or the error: `#NUM!` for text that isn't one, `#VALUE!` when some end in `i` and some in `j`. */
export function complexArgs(vs: Value[]): Complex[] | ErrorValue {
  const z: Complex[] = [];
  for (const v of vs) {
    const c = parseComplex(v);
    if (!c) return NUM;
    z.push(c);
  }
  const suffixes = new Set(z.filter((c) => !c.bare).map((c) => c.suffix));
  if (suffixes.size > 1) return VALUE;
  const suffix = [...suffixes][0] ?? "i";
  return z.map((c) => ({ ...c, suffix }));
}

export function complexFn(min: number, max: number, fn: (z: Complex[]) => Value): FunctionDef {
  return simple(min, max, (vs) => {
    const z = complexArgs(vs);
    return isError(z) ? z : fn(z);
  });
}

export const math2: Table = {
  ACOSH: numeric(1, 1, ([x]) => (x! < 1 ? NUM : Math.acosh(x!))),
  ASINH: numeric(1, 1, ([x]) => Math.asinh(x!)),
  ATANH: numeric(1, 1, ([x]) => (Math.abs(x!) >= 1 ? NUM : Math.atanh(x!))),
  ACOT: numeric(1, 1, ([x]) => Math.PI / 2 - Math.atan(x!)),
  ACOTH: numeric(1, 1, ([x]) => (Math.abs(x!) <= 1 ? NUM : Math.atanh(1 / x!))),
  COT: numeric(1, 1, ([x]) => (x! === 0 ? DIV0 : 1 / Math.tan(x!))),
  COTH: numeric(1, 1, ([x]) => (x! === 0 ? DIV0 : 1 / Math.tanh(x!))),
  CSC: numeric(1, 1, ([x]) => (x! === 0 ? DIV0 : 1 / Math.sin(x!))),
  CSCH: numeric(1, 1, ([x]) => (x! === 0 ? DIV0 : 1 / Math.sinh(x!))),
  SEC: numeric(1, 1, ([x]) => 1 / Math.cos(x!)),
  SECH: numeric(1, 1, ([x]) => 1 / Math.cosh(x!)),
  FACTDOUBLE: numeric(1, 1, ([n]) => {
    if (n! < -1 || n! > 300) return NUM;
    let r = 1;
    for (let i = Math.floor(n!); i > 1; i -= 2) r *= i;
    return r;
  }),
  MULTINOMIAL: {
    min: 1,
    max: 255,
    fn: (args, ctx) => {
      const xs = numbersIn(args, ctx);
      if (isError(xs)) return xs;
      if (xs.some((x) => x < 0)) return NUM;
      const ints = xs.map(Math.floor);
      const total = ints.reduce((a, b) => a + b, 0);
      return Math.exp(lnGamma(total + 1) - ints.reduce((s, n) => s + lnGamma(n + 1), 0));
    },
  },
  SQRTPI: numeric(1, 1, ([x]) => (x! < 0 ? NUM : Math.sqrt(x! * Math.PI))),
  SUMX2MY2: { min: 2, max: 2, fn: (a, ctx) => sumOver(a[0] as Arg, a[1] as Arg, ctx, (x, y) => x * x - y * y) },
  SUMX2PY2: { min: 2, max: 2, fn: (a, ctx) => sumOver(a[0] as Arg, a[1] as Arg, ctx, (x, y) => x * x + y * y) },
  SUMXMY2: { min: 2, max: 2, fn: (a, ctx) => sumOver(a[0] as Arg, a[1] as Arg, ctx, (x, y) => (x - y) ** 2) },
  "CEILING.PRECISE": numeric(1, 2, ([n, s = 1]) => (s === 0 ? 0 : Math.ceil(Number((n! / Math.abs(s)).toPrecision(15))) * Math.abs(s))),
  "ISO.CEILING": numeric(1, 2, ([n, s = 1]) => (s === 0 ? 0 : Math.ceil(Number((n! / Math.abs(s)).toPrecision(15))) * Math.abs(s))),
  "FLOOR.PRECISE": numeric(1, 2, ([n, s = 1]) => (s === 0 ? 0 : Math.floor(Number((n! / Math.abs(s)).toPrecision(15))) * Math.abs(s))),
  BASE: simple(2, 3, ([n, radix, minLen]) => {
    const x = toNumber(n!);
    const r = toNumber(radix!);
    const m = minLen === undefined || minLen === null ? 0 : toNumber(minLen);
    if (isError(x)) return x;
    if (isError(r)) return r;
    if (isError(m)) return m;
    if (x < 0 || x >= 2 ** 53 || r < 2 || r > 36 || m < 0 || m > 255) return NUM;
    return Math.floor(x).toString(Math.floor(r)).toUpperCase().padStart(Math.floor(m), "0");
  }),
  DECIMAL: simple(2, 2, ([t, radix]) => {
    const r = toNumber(radix!);
    if (isError(r)) return r;
    if (r < 2 || r > 36) return NUM;
    const s = String(toText(t!) as string).trim().toUpperCase();
    if (s === "") return 0;
    let n = 0;
    for (const ch of s) {
      const d = parseInt(ch, 36);
      if (Number.isNaN(d) || d >= r) return NUM;
      n = n * r + d;
    }
    return n;
  }),
  MDETERM: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const m = matrixOf(args[0] as Arg, ctx);
      if (!Array.isArray(m)) return m as Value;
      if (m.length === 0 || m.some((r) => r.length !== m.length)) return VALUE;
      return determinant(m);
    },
  },
  MINVERSE: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const m = matrixOf(args[0] as Arg, ctx);
      if (!Array.isArray(m)) return m as Value;
      if (m.length === 0 || m.some((r) => r.length !== m.length)) return VALUE;
      const inv = inverse(m);
      return inv ? arrayOf(inv) : NUM;
    },
  },
  MUNIT: {
    min: 1,
    max: 1,
    fn: (args, ctx) => {
      const n = toNumber(scalar(args[0], ctx));
      if (isError(n)) return n;
      if (n < 1 || n > 200) return VALUE;
      const k = Math.floor(n);
      return arrayOf(Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))));
    },
  },
  SERIESSUM: {
    min: 4,
    max: 4,
    fn: (args, ctx) => {
      const x = toNumber(scalar(args[0], ctx));
      const n = toNumber(scalar(args[1], ctx));
      const m = toNumber(scalar(args[2], ctx));
      const cs = numbersIn([args[3] as Arg], ctx);
      if (isError(x)) return x;
      if (isError(n)) return n;
      if (isError(m)) return m;
      if (isError(cs)) return cs;
      return cs.reduce((s, c, i) => s + c * x ** (n + i * m), 0);
    },
  },
  AGGREGATE: {
    min: 3,
    max: 255,
    fn: (args, ctx) => {
      const f = toNumber(scalar(args[0], ctx));
      const opt = toNumber(scalar(args[1], ctx));
      if (isError(f)) return f;
      if (isError(opt)) return opt;
      if (f < 1 || f > 19 || opt < 0 || opt > 7) return VALUE;
      const skipErrors = opt === 2 || opt === 3 || opt === 6 || opt === 7;
      const rest = args.slice(2) as Arg[];
      const needsK = f >= 14;
      const kArg = needsK ? rest[rest.length - 1] : undefined;
      const data = needsK ? rest.slice(0, -1) : rest;
      const xs: number[] = [];
      let count = 0;
      for (const a of data) {
        let bad: ErrorValue | undefined;
        const take = (v: Value) => {
          if (isError(v)) {
            if (!skipErrors) bad ??= v;
          } else if (typeof v === "number") xs.push(v);
        };
        if (isRef(a) || (typeof a === "object" && a !== null && "array" in a)) eachValue(a, ctx, (v) => { take(v); if (v !== null && !(isError(v) && skipErrors)) count++; });
        else {
          const v = scalar(a, ctx);
          take(v);
          count++;
        }
        if (bad) return bad;
      }
      const sorted = [...xs].sort((p, q) => p - q);
      const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
      const ss = xs.reduce((p, q) => p + (q - mean) ** 2, 0);
      switch (f) {
        case 1: return xs.length ? mean : DIV0;
        case 2: return xs.length;
        case 3: return count;
        case 4: return xs.length ? Math.max(...xs) : 0;
        case 5: return xs.length ? Math.min(...xs) : 0;
        case 6: return xs.reduce((p, q) => p * q, 1);
        case 7: return xs.length > 1 ? Math.sqrt(ss / (xs.length - 1)) : DIV0;
        case 8: return xs.length ? Math.sqrt(ss / xs.length) : DIV0;
        case 9: return xs.reduce((p, q) => p + q, 0);
        case 10: return xs.length > 1 ? ss / (xs.length - 1) : DIV0;
        case 11: return xs.length ? ss / xs.length : DIV0;
        case 12: return xs.length ? (xs.length % 2 ? sorted[(xs.length - 1) / 2]! : (sorted[xs.length / 2 - 1]! + sorted[xs.length / 2]!) / 2) : NUM;
        case 13: {
          const counts = new Map<number, number>();
          for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
          let best: number | undefined;
          for (const x of xs) if ((counts.get(x) ?? 0) > 1 && (best === undefined || counts.get(x)! > counts.get(best)!)) best = x;
          return best ?? NA;
        }
      }
      const k = toNumber(scalar(kArg!, ctx));
      if (isError(k)) return k;
      if (f === 14) return k < 1 || k > xs.length ? NUM : sorted[xs.length - Math.ceil(k)]!;
      if (f === 15) return k < 1 || k > xs.length ? NUM : sorted[Math.ceil(k) - 1]!;
      const q = f === 16 || f === 18 ? k : k / 4;
      if (xs.length === 0 || q < 0 || q > 1) return NUM;
      if (f === 16 || f === 17) {
        const pos = q * (xs.length - 1);
        const lo = Math.floor(pos);
        return sorted[lo]! + (sorted[Math.ceil(pos)]! - sorted[lo]!) * (pos - lo);
      }
      const pos = q * (xs.length + 1);
      if (pos < 1 || pos > xs.length) return NUM;
      const lo = Math.floor(pos);
      return sorted[lo - 1]! + (sorted[Math.min(lo, xs.length - 1)]! - sorted[lo - 1]!) * (pos - lo);
    },
  },

  // Engineering
  BIN2DEC: baseConversion(2, 10),
  BIN2OCT: baseConversion(2, 8),
  BIN2HEX: baseConversion(2, 16),
  OCT2DEC: baseConversion(8, 10),
  OCT2BIN: baseConversion(8, 2),
  OCT2HEX: baseConversion(8, 16),
  HEX2DEC: baseConversion(16, 10),
  HEX2BIN: baseConversion(16, 2),
  HEX2OCT: baseConversion(16, 8),
  DEC2BIN: decTo(2),
  DEC2OCT: decTo(8),
  DEC2HEX: decTo(16),
  BITAND: bitwise((a, b) => a & b),
  BITOR: bitwise((a, b) => a | b),
  BITXOR: bitwise((a, b) => a ^ b),
  BITLSHIFT: numeric(2, 2, ([n, s]) => (n! < 0 || n! >= 2 ** 48 || Math.abs(s!) > 53 ? NUM : (r => (r >= 2 ** 48 ? NUM : r))(s! >= 0 ? Math.floor(n!) * 2 ** Math.floor(s!) : Math.floor(Math.floor(n!) / 2 ** -Math.floor(s!))))),
  BITRSHIFT: numeric(2, 2, ([n, s]) => (n! < 0 || n! >= 2 ** 48 || Math.abs(s!) > 53 ? NUM : (r => (r >= 2 ** 48 ? NUM : r))(s! >= 0 ? Math.floor(Math.floor(n!) / 2 ** Math.floor(s!)) : Math.floor(n!) * 2 ** -Math.floor(s!)))),
  DELTA: numeric(1, 2, ([a, b = 0]) => (a === b ? 1 : 0)),
  GESTEP: numeric(1, 2, ([a, b = 0]) => (a! >= b! ? 1 : 0)),
  ERF: numeric(1, 2, ([a, b]) => (b === undefined ? erf(a!) : erf(b) - erf(a!))),
  "ERF.PRECISE": numeric(1, 1, ([a]) => erf(a!)),
  ERFC: numeric(1, 1, ([a]) => erfc(a!)),
  "ERFC.PRECISE": numeric(1, 1, ([a]) => erfc(a!)),
  CONVERT: simple(3, 3, ([n, from, to]) => {
    const x = toNumber(n!);
    if (isError(x)) return x;
    const a = String(toText(from!) as string);
    const b = String(toText(to!) as string);
    if (TEMPS.includes(a) || TEMPS.includes(b)) return TEMPS.includes(a) && TEMPS.includes(b) ? fromKelvin(toKelvin(x, a), b) : NA;
    const ua = findUnit(a);
    const ub = findUnit(b);
    if (!ua || !ub || ua.unit.kind !== ub.unit.kind) return NA;
    return (x * ua.unit.f * ua.prefix) / (ub.unit.f * ub.prefix);
  }),
  COMPLEX: simple(2, 3, ([re, im, suffix]) => {
    const a = toNumber(re!);
    const b = toNumber(im!);
    if (isError(a)) return a;
    if (isError(b)) return b;
    const s = suffix === undefined || suffix === null ? "i" : String(toText(suffix) as string);
    return s !== "i" && s !== "j" ? VALUE : complexText(a, b, s);
  }),
  IMREAL: complexFn(1, 1, ([z]) => z!.re),
  IMAGINARY: complexFn(1, 1, ([z]) => z!.im),
  IMABS: complexFn(1, 1, ([z]) => Math.hypot(z!.re, z!.im)),
  IMARGUMENT: complexFn(1, 1, ([z]) => (z!.re === 0 && z!.im === 0 ? DIV0 : Math.atan2(z!.im, z!.re))),
  IMCONJUGATE: complexFn(1, 1, ([z]) => complexText(z!.re, -z!.im, z!.suffix)),
  IMSUM: complexFn(1, 255, (zs) => complexText(zs.reduce((s, z) => s + z.re, 0), zs.reduce((s, z) => s + z.im, 0), zs[0]!.suffix)),
  IMSUB: complexFn(2, 2, ([a, b]) => complexText(a!.re - b!.re, a!.im - b!.im, a!.suffix)),
  IMPRODUCT: complexFn(1, 255, (zs) => {
    let re = 1;
    let im = 0;
    for (const z of zs) [re, im] = [re * z.re - im * z.im, re * z.im + im * z.re];
    return complexText(re, im, zs[0]!.suffix);
  }),
  IMDIV: complexFn(2, 2, ([a, b]) => {
    const d = b!.re * b!.re + b!.im * b!.im;
    return d === 0 ? NUM : complexText((a!.re * b!.re + a!.im * b!.im) / d, (a!.im * b!.re - a!.re * b!.im) / d, a!.suffix);
  }),
};
