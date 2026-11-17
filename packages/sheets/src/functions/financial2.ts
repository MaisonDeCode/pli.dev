import { isError, NUM, toNumber, VALUE, DIV0, type ErrorValue } from "../values";
import { numbersIn, scalar, simple, toGrid } from "./helpers";
import type { Arg, FunctionDef } from "./types";

type Table = Record<string, FunctionDef>;

function nums(vs: (import("../values").Value | undefined)[], fallbacks: number[]): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < fallbacks.length; i++) {
    const v = vs[i];
    if (v === undefined || v === null) out.push(fallbacks[i]!);
    else {
      const n = toNumber(v);
      if (isError(n)) return null;
      out.push(n);
    }
  }
  return out;
}

function solve(fn: (x: number) => number, guess: number): number | null {
  let x = guess;
  for (let i = 0; i < 200; i++) {
    const y = fn(x);
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const slope = (fn(x + h) - y) / h;
    if (!Number.isFinite(slope) || slope === 0) return null;
    const next = x - y / slope;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - x) < 1e-12) return next;
    x = next;
  }
  return null;
}

const pmt = (rate: number, nper: number, pv: number, fv: number, type: number) => {
  if (rate === 0) return -(pv + fv) / nper;
  const f = (1 + rate) ** nper;
  return -(rate * (fv + pv * f)) / ((1 + rate * type) * (f - 1));
};

/** Dated cash flows: values, dates, and the first date as the start. */
function dated(valuesArg: Arg, datesArg: Arg, ctx: import("./types").Ctx): { v: number[]; d: number[] } | ErrorValue {
  const v = toGrid(valuesArg, ctx).flat();
  const d = toGrid(datesArg, ctx).flat();
  if (v.length !== d.length) return NUM;
  const vs: number[] = [];
  const ds: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = toNumber(v[i]!);
    const b = toNumber(d[i]!);
    if (isError(a)) return a;
    if (isError(b)) return b;
    vs.push(a);
    ds.push(Math.floor(b));
  }
  if (ds.some((x) => x < ds[0]!)) return NUM;
  return { v: vs, d: ds };
}

const xnpv = (rate: number, v: number[], d: number[]) => v.reduce((s, c, i) => s + c / (1 + rate) ** ((d[i]! - d[0]!) / 365), 0);

export const financial2: Table = {
  XNPV: {
    min: 3,
    max: 3,
    fn: (args, ctx) => {
      const rate = toNumber(scalar(args[0], ctx));
      if (isError(rate)) return rate;
      const cf = dated(args[1] as Arg, args[2] as Arg, ctx);
      if (isError(cf)) return cf;
      return rate <= -1 ? NUM : xnpv(rate, cf.v, cf.d);
    },
  },
  XIRR: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const cf = dated(args[0] as Arg, args[1] as Arg, ctx);
      if (isError(cf)) return cf;
      const guess = args[2] === undefined ? 0.1 : toNumber(scalar(args[2], ctx));
      if (isError(guess)) return guess;
      if (!cf.v.some((x) => x > 0) || !cf.v.some((x) => x < 0)) return NUM;
      const r = solve((rate) => xnpv(rate, cf.v, cf.d), guess);
      return r === null || r <= -1 ? NUM : r;
    },
  },
  MIRR: {
    min: 3,
    max: 3,
    fn: (args, ctx) => {
      const vs = numbersIn([args[0] as Arg], ctx);
      const fr = toNumber(scalar(args[1], ctx));
      const rr = toNumber(scalar(args[2], ctx));
      if (isError(vs)) return vs;
      if (isError(fr)) return fr;
      if (isError(rr)) return rr;
      const n = vs.length;
      const neg = vs.reduce((s, c, i) => s + (c < 0 ? c / (1 + fr) ** i : 0), 0);
      const pos = vs.reduce((s, c, i) => s + (c > 0 ? c * (1 + rr) ** (n - 1 - i) : 0), 0);
      if (neg === 0 || pos === 0) return DIV0;
      return (pos / -neg) ** (1 / (n - 1)) - 1;
    },
  },
  CUMIPMT: simple(6, 6, (vs) => cumulative(vs, true)),
  CUMPRINC: simple(6, 6, (vs) => cumulative(vs, false)),
  DB: simple(4, 5, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 12]);
    if (!p) return VALUE;
    const [cost, salvage, life, period, months] = p as [number, number, number, number, number];
    if (cost < 0 || salvage < 0 || life <= 0 || period <= 0 || months < 1 || months > 12 || period > life + 1) return NUM;
    const rate = Math.round((1 - (salvage / cost) ** (1 / life)) * 1000) / 1000;
    let total = 0;
    let dep = 0;
    for (let i = 1; i <= period; i++) {
      dep = i === 1 ? (cost * rate * months) / 12 : i === Math.floor(life) + 1 ? ((cost - total) * rate * (12 - months)) / 12 : (cost - total) * rate;
      total += dep;
    }
    return dep;
  }),
  DDB: simple(4, 5, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 2]);
    if (!p) return VALUE;
    const [cost, salvage, life, period, factor] = p as [number, number, number, number, number];
    if (cost < 0 || salvage < 0 || life <= 0 || period <= 0 || factor <= 0 || period > life) return NUM;
    let book = cost;
    let dep = 0;
    for (let i = 1; i <= Math.ceil(period); i++) {
      dep = Math.min(book * (factor / life), Math.max(0, book - salvage));
      if (i < period || Number.isInteger(period)) book -= dep;
    }
    return dep;
  }),
  SYD: simple(4, 4, (vs) => {
    const p = nums(vs, [0, 0, 0, 0]);
    if (!p) return VALUE;
    const [cost, salvage, life, per] = p as [number, number, number, number];
    if (life <= 0 || per <= 0 || per > life) return NUM;
    return ((cost - salvage) * (life - per + 1) * 2) / (life * (life + 1));
  }),
  EFFECT: simple(2, 2, (vs) => {
    const p = nums(vs, [0, 0]);
    if (!p) return VALUE;
    const [nominal, n] = p as [number, number];
    return nominal <= 0 || n < 1 ? NUM : (1 + nominal / Math.floor(n)) ** Math.floor(n) - 1;
  }),
  NOMINAL: simple(2, 2, (vs) => {
    const p = nums(vs, [0, 0]);
    if (!p) return VALUE;
    const [effect, n] = p as [number, number];
    return effect <= 0 || n < 1 ? NUM : Math.floor(n) * ((1 + effect) ** (1 / Math.floor(n)) - 1);
  }),
  FVSCHEDULE: {
    min: 2,
    max: 2,
    fn: (args, ctx) => {
      const principal = toNumber(scalar(args[0], ctx));
      const rates = numbersIn([args[1] as Arg], ctx);
      if (isError(principal)) return principal;
      if (isError(rates)) return rates;
      return rates.reduce((s, r) => s * (1 + r), principal);
    },
  },
  PDURATION: simple(3, 3, (vs) => {
    const p = nums(vs, [0, 0, 0]);
    if (!p) return VALUE;
    const [rate, pv, fv] = p as [number, number, number];
    return rate <= 0 || pv <= 0 || fv <= 0 ? NUM : (Math.log(fv) - Math.log(pv)) / Math.log(1 + rate);
  }),
  RRI: simple(3, 3, (vs) => {
    const p = nums(vs, [0, 0, 0]);
    if (!p) return VALUE;
    const [n, pv, fv] = p as [number, number, number];
    return n <= 0 || pv === 0 ? NUM : (fv / pv) ** (1 / n) - 1;
  }),
  ISPMT: simple(4, 4, (vs) => {
    const p = nums(vs, [0, 0, 0, 0]);
    if (!p) return VALUE;
    const [rate, per, nper, pv] = p as [number, number, number, number];
    return nper === 0 ? DIV0 : pv * rate * (per / nper - 1);
  }),
  DOLLARDE: simple(2, 2, (vs) => {
    const p = nums(vs, [0, 0]);
    if (!p) return VALUE;
    const [price, f] = p as [number, number];
    const frac = Math.floor(f);
    if (frac < 0) return NUM;
    if (frac === 0) return DIV0;
    const whole = Math.trunc(price);
    const digits = Math.ceil(Math.log10(frac));
    return whole + ((price - whole) * 10 ** digits) / frac;
  }),
  DOLLARFR: simple(2, 2, (vs) => {
    const p = nums(vs, [0, 0]);
    if (!p) return VALUE;
    const [price, f] = p as [number, number];
    const frac = Math.floor(f);
    if (frac < 0) return NUM;
    if (frac === 0) return DIV0;
    const whole = Math.trunc(price);
    const digits = Math.ceil(Math.log10(frac));
    return whole + ((price - whole) * frac) / 10 ** digits;
  }),
};

/** `CUMIPMT` and `CUMPRINC`: the interest or principal paid between two periods of a loan. */
function cumulative(vs: (import("../values").Value | undefined)[], interest: boolean): import("../values").Value {
  const p = nums(vs, [0, 0, 0, 0, 0, 0]);
  if (!p) return VALUE;
  const [rate, nper, pv, start, end, type] = p as [number, number, number, number, number, number];
  if (rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < start || end > nper || (type !== 0 && type !== 1)) return NUM;
  const pay = pmt(rate, nper, pv, 0, type);
  let total = 0;
  for (let per = Math.floor(start); per <= Math.floor(end); per++) {
    let bal = pv;
    // Balance before the period, then the interest on it.
    const periods = per - 1 - (type ? 1 : 0);
    bal = periods <= 0 ? pv : -(pv * (1 + rate) ** periods + pay * (((1 + rate) ** periods - 1) / rate) * (type ? 1 + rate : 1));
    const int = type && per === 1 ? 0 : -bal * rate;
    total += interest ? int : pay - int;
  }
  return total;
}

