import { isError, NUM, toNumber, type Value } from "../values";
import { simple } from "./helpers";
import { complexArgs, complexText, type Complex } from "./math2";
import type { FunctionDef } from "./types";

/*
 * The complex-number functions that work on one number (`IMEXP`, `IMSIN`…) and `IMPOWER`. Numbers are text such as
 * "3+4i" (or "3+4j": the suffix of the answer is the one of the arguments). Text that is not a complex number is
 * `#NUM!`, a mix of `i` and `j` is `#VALUE!`; a result that is not finite (`IMLN(0)`, `IMCSC(0)`) is `#NUM!`.
 */

interface C {
  re: number;
  im: number;
}

const abs = (a: C) => Math.hypot(a.re, a.im);

/** The quotient, or null when the divisor is 0. */
function div(a: C, b: C): C | null {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return null;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

const exp = (a: C): C => ({ re: Math.exp(a.re) * Math.cos(a.im), im: Math.exp(a.re) * Math.sin(a.im) });
const sin = (a: C): C => ({ re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) });
const cos = (a: C): C => ({ re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) });
const sinh = (a: C): C => ({ re: Math.sinh(a.re) * Math.cos(a.im), im: Math.cosh(a.re) * Math.sin(a.im) });
const cosh = (a: C): C => ({ re: Math.cosh(a.re) * Math.cos(a.im), im: Math.sinh(a.re) * Math.sin(a.im) });
const ONE: C = { re: 1, im: 0 };

/** The principal square root. */
function sqrt(a: C): C {
  const r = abs(a);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt((r - a.re) / 2);
  return { re, im: a.im < 0 ? -im : im };
}

/** A function of one complex number; a result that isn't finite (a division by 0, or the log of 0) is `#NUM!`. */
function one(fn: (a: C) => C | null): FunctionDef {
  return simple(1, 1, (vs) => {
    const z = complexArgs(vs);
    if (isError(z)) return z;
    const r = fn(z[0]!);
    if (!r || !Number.isFinite(r.re) || !Number.isFinite(r.im)) return NUM;
    return complexText(r.re, r.im, z[0]!.suffix);
  });
}

/** Natural log: only the principal value, and not for 0. */
function ln(a: C): C | null {
  const r = abs(a);
  return r === 0 ? null : { re: Math.log(r), im: Math.atan2(a.im, a.re) };
}

const scaled = (k: number) => (a: C): C | null => {
  const l = ln(a);
  return l ? { re: l.re / k, im: l.im / k } : null;
};

/** `IMPOWER(z, n)`: z to the power n (any real number), with the principal argument, worked out in polar form the way Excel does (so (2+3i)^3 is -46+9.00000000000001i there). */
function power(args: Value[]): Value {
  const z = complexArgs([args[0]!]);
  if (isError(z)) return z;
  const n = toNumber(args[1]!);
  if (isError(n)) return n;
  const a: Complex = z[0]!;
  const r = abs(a);
  if (r === 0) return n > 0 ? "0" : NUM;
  const theta = Math.atan2(a.im, a.re);
  const rn = r ** n;
  const re = rn * Math.cos(theta * n);
  const im = rn * Math.sin(theta * n);
  if (!Number.isFinite(re) || !Number.isFinite(im)) return NUM;
  return complexText(re, im, a.suffix);
}

export const complexFunctions: Record<string, FunctionDef> = {
  IMEXP: one(exp),
  IMLN: one(ln),
  IMLOG10: one(scaled(Math.LN10)),
  IMLOG2: one(scaled(Math.LN2)),
  IMSQRT: one(sqrt),
  IMPOWER: simple(2, 2, power),
  IMSIN: one(sin),
  IMCOS: one(cos),
  IMTAN: one((a) => div(sin(a), cos(a))),
  IMSEC: one((a) => div(ONE, cos(a))),
  IMCSC: one((a) => div(ONE, sin(a))),
  IMCOT: one((a) => div(cos(a), sin(a))),
  IMSINH: one(sinh),
  IMCOSH: one(cosh),
  IMSECH: one((a) => div(ONE, cosh(a))),
  IMCSCH: one((a) => div(ONE, sinh(a))),
};
