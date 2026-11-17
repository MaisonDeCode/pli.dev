import { isError, NUM, toNumber, VALUE, type Value } from "../values";
import { eachValue, numbersIn, scalar, simple } from "./helpers";
import type { Arg, FunctionDef } from "./types";

const nums = (vs: Value[], fallbacks: number[]): number[] | null => {
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
};

function pmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return -(pv + fv) / nper;
  const f = (1 + rate) ** nper;
  return -(rate * (fv + pv * f)) / ((1 + rate * type) * (f - 1));
}

function fv(rate: number, nper: number, payment: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + payment * nper);
  const f = (1 + rate) ** nper;
  return -(pv * f + payment * (1 + rate * type) * ((f - 1) / rate));
}

/** Newton's method on `fn`, from `guess`; null if it doesn't settle. */
function solve(fn: (x: number) => number, guess: number): number | null {
  let x = guess;
  for (let i = 0; i < 100; i++) {
    const y = fn(x);
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const slope = (fn(x + h) - y) / h;
    if (!Number.isFinite(slope) || slope === 0) return null;
    const next = x - y / slope;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - x) < 1e-10) return next;
    x = next;
  }
  return null;
}

export const financial: Record<string, FunctionDef> = {
  PMT: simple(3, 5, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 0]);
    return p === null ? VALUE : p[1]! === 0 ? NUM : pmt(p[0]!, p[1]!, p[2]!, p[3]!, p[4]! ? 1 : 0);
  }),
  FV: simple(3, 5, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 0]);
    return p === null ? VALUE : fv(p[0]!, p[1]!, p[2]!, p[3]!, p[4]! ? 1 : 0);
  }),
  PV: simple(3, 5, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 0]);
    if (p === null) return VALUE;
    const [rate, nper, pay, future, type] = p as [number, number, number, number, number];
    if (rate === 0) return -(future + pay * nper);
    const f = (1 + rate) ** nper;
    return -(future + pay * (1 + rate * (type ? 1 : 0)) * ((f - 1) / rate)) / f;
  }),
  NPER: simple(3, 5, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 0]);
    if (p === null) return VALUE;
    const [rate, pay, pv, future, type] = p as [number, number, number, number, number];
    const t = type ? 1 : 0;
    if (rate === 0) return pay === 0 ? NUM : -(pv + future) / pay;
    const a = pay * (1 + rate * t) - future * rate;
    const b = pv * rate + pay * (1 + rate * t);
    if (a <= 0 !== b <= 0 || b === 0) return NUM;
    const r = Math.log(a / b) / Math.log(1 + rate);
    return Number.isFinite(r) ? r : NUM;
  }),
  RATE: simple(3, 6, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 0, 0.1]);
    if (p === null) return VALUE;
    const [nper, pay, pv, future, type, guess] = p as [number, number, number, number, number, number];
    const r = solve((rate) => pv * (1 + rate) ** nper + pay * (1 + rate * (type ? 1 : 0)) * (((1 + rate) ** nper - 1) / rate) + future, guess);
    return r === null ? NUM : r;
  }),
  IPMT: simple(4, 6, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 0, 0]);
    if (p === null) return VALUE;
    const [rate, per, nper, pv, future, type] = p as [number, number, number, number, number, number];
    if (per < 1 || per > nper) return NUM;
    const pay = pmt(rate, nper, pv, future, type ? 1 : 0);
    if (type && per === 1) return 0;
    const bal = fv(rate, per - 1 - (type ? 1 : 0), pay, pv, 0);
    return bal * rate;
  }),
  PPMT: simple(4, 6, (vs) => {
    const p = nums(vs, [0, 0, 0, 0, 0, 0]);
    if (p === null) return VALUE;
    const [rate, per, nper, pv, future, type] = p as [number, number, number, number, number, number];
    if (per < 1 || per > nper) return NUM;
    const pay = pmt(rate, nper, pv, future, type ? 1 : 0);
    if (type && per === 1) return pay;
    return pay - fv(rate, per - 1 - (type ? 1 : 0), pay, pv, 0) * rate;
  }),
  NPV: {
    min: 2,
    max: 255,
    fn: (args, ctx) => {
      const rate = toNumber(scalar(args[0], ctx));
      if (isError(rate)) return rate;
      const flows = numbersIn(args.slice(1), ctx);
      if (isError(flows)) return flows;
      return flows.reduce((s, c, i) => s + c / (1 + rate) ** (i + 1), 0);
    },
  },
  IRR: {
    min: 1,
    max: 2,
    fn: (args, ctx) => {
      const flows: number[] = [];
      eachValue(args[0] as Arg, ctx, (v) => { if (typeof v === "number") flows.push(v); });
      if (!flows.some((x) => x > 0) || !flows.some((x) => x < 0)) return NUM;
      const guess = args[1] === undefined ? 0.1 : toNumber(scalar(args[1], ctx));
      if (isError(guess)) return guess;
      const r = solve((rate) => flows.reduce((s, c, i) => s + c / (1 + rate) ** i, 0), guess);
      return r === null ? NUM : r;
    },
  },
  SLN: simple(3, 3, (vs) => {
    const p = nums(vs, [0, 0, 0]);
    return p === null ? VALUE : p[2] === 0 ? NUM : (p[0]! - p[1]!) / p[2]!;
  }),
};
