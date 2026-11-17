import { dateSerial, isError, NUM, serialDate, toBool, toNumber, type ErrorValue, type Value } from "../values";
import { simple } from "./helpers";
import type { FunctionDef } from "./types";

/*
 * Bonds and other securities: coupon dates and day counts (`COUPDAYBS`…), prices and yields (`PRICE`, `YIELD`, the
 * odd-period `ODDF…` and `ODDL…`), discounted and at-maturity securities (`DISC`, `PRICEMAT`…), treasury bills,
 * accrued interest, duration, the French depreciation functions and `VDB`.
 *
 * Dates are whole serial numbers (the time of day is dropped). The five day-count bases are Excel's: 0 US (NASD) 30/360,
 * 1 actual/actual, 2 actual/360, 3 actual/365, 4 European 30/360. Coupon dates are counted back from the maturity date, and
 * when that is the last day of a month so are the others.
 */

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => (m === 2 ? (isLeap(y) ? 29 : 28) : m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31);

/** Days between two dates counted as 30 to a month: the US (NASD) way, or the European way. */
export function days360(a: number, b: number, european: boolean): number {
  const x = serialDate(a);
  const y = serialDate(b);
  let d1 = x.day;
  let d2 = y.day;
  if (european) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    const feb1 = x.month === 2 && d1 === daysIn(x.year, 2);
    const feb2 = y.month === 2 && d2 === daysIn(y.year, 2);
    if (feb1 && feb2) d2 = 30;
    if (feb1 || d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
  }
  return (y.year - x.year) * 360 + (y.month - x.month) * 30 + (d2 - d1);
}

/** Days between two dates under a basis: 30/360 for 0 and 4, the actual days otherwise. */
const daysUnder = (a: number, b: number, basis: number) => (basis === 0 ? days360(a, b, false) : basis === 4 ? days360(a, b, true) : b - a);

/** The length of the year, in days, that a span from `a` to `b` is measured against under actual/actual. */
function yearLength(a: number, b: number): number {
  const x = serialDate(a);
  const y = serialDate(b);
  const longer = y.year !== x.year && (y.year !== x.year + 1 || x.month < y.month || (x.month === y.month && x.day < y.day));
  if (longer) {
    let total = 0;
    for (let yr = x.year; yr <= y.year; yr++) total += isLeap(yr) ? 366 : 365;
    return total / (y.year - x.year + 1);
  }
  if (x.year === y.year) return isLeap(x.year) ? 366 : 365;
  // Across one New Year, less than a year: 366 when the 29th of February is inside.
  if (isLeap(x.year)) return a <= (dateSerial(x.year, 2, 29) ?? 0) ? 366 : 365;
  if (isLeap(y.year)) return b >= (dateSerial(y.year, 2, 29) ?? 0) ? 366 : 365;
  return 365;
}

/** The part of a year between two dates under a basis (the dates in either order). */
export function yearFrac(a: number, b: number, basis: number): number {
  if (a > b) [a, b] = [b, a];
  switch (basis) {
    case 0:
      return days360(a, b, false) / 360;
    case 1:
      return (b - a) / yearLength(a, b);
    case 2:
      return (b - a) / 360;
    case 3:
      return (b - a) / 365;
    default:
      return days360(a, b, true) / 360;
  }
}

/** A date some months away; with `eom` it lands on the last day of its month, else on the same day, or the last if there is no such day. */
function addMonths(base: number, months: number, eom: boolean): number {
  const p = serialDate(base);
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const last = daysIn(year, month);
  return dateSerial(year, month, eom ? last : Math.min(p.day, last)) ?? NaN;
}

const isLastDay = (serial: number) => {
  const p = serialDate(serial);
  return p.day === daysIn(p.year, p.month);
};

/** The coupon dates around a settlement date: the one before it (or on it), the one after, and how many are still to be paid. */
export function coupons(settle: number, maturity: number, freq: number): { pcd: number; ncd: number; n: number } {
  const step = 12 / freq;
  const eom = isLastDay(maturity);
  let ncd = maturity;
  for (let k = 1; k < 5000; k++) {
    const d = addMonths(maturity, -k * step, eom);
    if (d <= settle) return { pcd: d, ncd, n: k };
    ncd = d;
  }
  return { pcd: settle, ncd, n: 1 };
}

/** The day counts of the coupon period that holds the settlement date. */
function period(settle: number, maturity: number, freq: number, basis: number) {
  const { pcd, ncd, n } = coupons(settle, maturity, freq);
  const A = daysUnder(pcd, settle, basis);
  const E = basis === 1 ? ncd - pcd : basis === 3 ? 365 / freq : 360 / freq;
  const DSC = basis === 0 || basis === 4 ? E - A : ncd - settle;
  return { pcd, ncd, n, A, E, DSC };
}

/**
 * How many coupon periods a span covers, counting each period it touches as the part of it that it covers (days over the
 * period's length). The periods are those of a schedule that has `anchor` on it and steps of 12/freq months in both directions.
 */
function periods(from: number, to: number, anchor: number, freq: number, basis: number): number {
  if (to <= from) return 0;
  const step = 12 / freq;
  const eom = isLastDay(anchor);
  const grid = (k: number) => addMonths(anchor, k * step, eom);
  const a = serialDate(anchor);
  const f = serialDate(from);
  let k = Math.floor(((f.year - a.year) * 12 + (f.month - a.month)) / step);
  while (grid(k) > from) k--;
  while (grid(k + 1) <= from) k++;
  let sum = 0;
  let at = from;
  while (at < to) {
    const start = grid(k);
    const end = grid(k + 1);
    const stop = Math.min(end, to);
    const length = basis === 1 ? end - start : basis === 3 ? 365 / freq : 360 / freq;
    sum += daysUnder(at, stop, basis) / length;
    at = stop;
    k++;
  }
  return sum;
}

// ---- reading arguments ----

/**
 * Reads arguments by a string of kinds: `d` a date (made whole, not negative), `n` a number, `f` a frequency (1, 2 or 4),
 * `b` a basis (0 to 4, 0 when left out). Gives the numbers, or the error to return.
 */
function read(vs: Value[], kinds: string): number[] | ErrorValue {
  const out: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const v = vs[i];
    const n = v === undefined ? 0 : toNumber(v);
    if (isError(n)) return n;
    switch (kinds[i]) {
      case "d":
        if (n < 0) return NUM;
        out.push(Math.floor(n));
        break;
      case "f": {
        const f = Math.trunc(n);
        if (f !== 1 && f !== 2 && f !== 4) return NUM;
        out.push(f);
        break;
      }
      case "b": {
        const b = Math.trunc(n);
        if (b < 0 || b > 4) return NUM;
        out.push(b);
        break;
      }
      default:
        out.push(n);
    }
  }
  return out;
}

/** A function of arguments read by `read`; the result is a number, or an error. */
function security(min: number, max: number, kinds: string, fn: (p: number[], vs: Value[]) => number | ErrorValue): FunctionDef {
  return simple(min, max, (vs) => {
    const p = read(vs, kinds);
    if (isError(p)) return p;
    const r = fn(p, vs);
    return typeof r === "number" && !Number.isFinite(r) ? NUM : r;
  });
}

/** Solves `f(x) = 0` for a function that falls as x rises, between `lo` and a `hi` that is found by doubling. */
function solveFalling(f: (x: number) => number, lo: number, start: number): number | null {
  let hi = start;
  for (let i = 0; i < 200 && f(hi) > 0; i++) hi = hi * 2 + 1;
  if (!(f(hi) <= 0) || !(f(lo) >= 0)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-16 * Math.max(1, Math.abs(mid))) break;
  }
  return (lo + hi) / 2;
}

// ---- prices and yields of coupon bonds ----

function price(settle: number, maturity: number, rate: number, yld: number, redemption: number, freq: number, basis: number): number {
  const { n, A, E, DSC } = period(settle, maturity, freq, basis);
  const c = (100 * rate) / freq;
  const y = 1 + yld / freq;
  if (n === 1) return (c + redemption) / (1 + ((yld / freq) * DSC) / E) - (c * A) / E;
  const t = DSC / E;
  let pv = redemption / y ** (n - 1 + t);
  for (let k = 1; k <= n; k++) pv += c / y ** (k - 1 + t);
  return pv - (c * A) / E;
}

function yieldOf(settle: number, maturity: number, rate: number, pr: number, redemption: number, freq: number, basis: number): number | ErrorValue {
  const { n, A, E, DSC } = period(settle, maturity, freq, basis);
  const c = (100 * rate) / freq;
  if (n === 1) return (((redemption + c) / (pr + (c * A) / E) - 1) * freq * E) / DSC;
  const r = solveFalling((x) => price(settle, maturity, rate, x, redemption, freq, basis) - pr, -freq + 1e-9, 1);
  return r === null ? NUM : r;
}

/** The price of a bond whose first coupon period is odd: `issue` to `first` is shorter or longer than the others. */
function oddFirstPrice(settle: number, maturity: number, issue: number, first: number, rate: number, yld: number, redemption: number, freq: number, basis: number): number {
  const c = (100 * rate) / freq;
  const y = 1 + yld / freq;
  const q = periods(issue, first, maturity, freq, basis); // how much of a coupon the first one pays
  const tau = periods(settle, first, maturity, freq, basis); // periods from settlement to the first coupon
  const accrued = periods(issue, settle, maturity, freq, basis);
  const n = coupons(first, maturity, freq).n + 1;
  let pv = (c * q) / y ** tau;
  for (let k = 2; k <= n; k++) pv += c / y ** (tau + k - 1);
  pv += redemption / y ** (tau + n - 1);
  return pv - c * accrued;
}

/** The price of a bond whose last coupon period is odd: `last` to the maturity is shorter or longer than the others. */
function oddLastParts(settle: number, maturity: number, last: number, rate: number, freq: number, basis: number) {
  const c = (100 * rate) / freq;
  return { c, whole: periods(last, maturity, last, freq, basis), left: periods(settle, maturity, last, freq, basis), accrued: periods(last, settle, last, freq, basis) };
}

// ---- depreciation ----

const roundHalfUp = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));

/** Depreciation up to a time (periods may be part of a period), with the switch to straight line when it gives more. */
function declining(cost: number, salvage: number, life: number, factor: number, noSwitch: boolean, t: number): number {
  let total = 0;
  let book = cost - salvage; // what can still be written off
  let straight = false;
  let line = 0;
  const whole = Math.ceil(t - 1e-12);
  const rate = factor / life;
  for (let i = 1; i <= whole; i++) {
    let term: number;
    if (straight) term = line;
    else {
      const open = rate >= 1 ? (i === 1 ? cost : 0) : cost * (1 - rate) ** (i - 1);
      const close = rate >= 1 ? 0 : cost * (1 - rate) ** i;
      let ddb = close < salvage ? open - salvage : open - close;
      if (ddb < 0) ddb = 0;
      line = book / (life - (i - 1));
      if (!noSwitch && line > ddb) {
        term = line;
        straight = true;
      } else {
        term = ddb;
        book -= ddb;
      }
    }
    if (i === whole) term *= t + 1 - whole;
    total += term;
  }
  return total;
}

export const bonds: Record<string, FunctionDef> = {
  COUPNCD: security(3, 4, "ddfb", (p) => (p[0]! >= p[1]! ? NUM : coupons(p[0]!, p[1]!, p[2]!).ncd)),
  COUPPCD: security(3, 4, "ddfb", (p) => (p[0]! >= p[1]! ? NUM : coupons(p[0]!, p[1]!, p[2]!).pcd)),
  COUPNUM: security(3, 4, "ddfb", (p) => (p[0]! >= p[1]! ? NUM : coupons(p[0]!, p[1]!, p[2]!).n)),
  COUPDAYBS: security(3, 4, "ddfb", (p) => (p[0]! >= p[1]! ? NUM : period(p[0]!, p[1]!, p[2]!, p[3]!).A)),
  COUPDAYS: security(3, 4, "ddfb", (p) => (p[0]! >= p[1]! ? NUM : period(p[0]!, p[1]!, p[2]!, p[3]!).E)),
  COUPDAYSNC: security(3, 4, "ddfb", (p) => (p[0]! >= p[1]! ? NUM : period(p[0]!, p[1]!, p[2]!, p[3]!).DSC)),

  PRICE: security(6, 7, "ddnnnfb", ([s, m, rate, yld, red, f, b]) => (s! >= m! || rate! < 0 || yld! < 0 || red! <= 0 ? NUM : price(s!, m!, rate!, yld!, red!, f!, b!))),
  YIELD: security(6, 7, "ddnnnfb", ([s, m, rate, pr, red, f, b]) => (s! >= m! || rate! < 0 || pr! <= 0 || red! <= 0 ? NUM : yieldOf(s!, m!, rate!, pr!, red!, f!, b!))),

  DURATION: security(5, 6, "ddnnfb", ([s, m, coupon, yld, f, b]) => duration(s!, m!, coupon!, yld!, f!, b!)),
  MDURATION: security(5, 6, "ddnnfb", ([s, m, coupon, yld, f, b]) => {
    const d = duration(s!, m!, coupon!, yld!, f!, b!);
    return typeof d === "number" ? d / (1 + yld! / f!) : d;
  }),

  ACCRINT: security(6, 8, "dddnnfb", ([issue, first, settle, rate, par, f, b], vs) => {
    const value = vs[4] === null || vs[4] === undefined ? 1000 : par!;
    if (rate! <= 0 || value <= 0 || settle! <= issue!) return NUM;
    // `calc_method` FALSE counts only from the first interest date.
    const method = vs[7] === undefined || vs[7] === null ? true : toBool(vs[7]);
    if (isError(method)) return method;
    const from = method ? issue! : first!;
    if (from >= settle!) return from === issue! ? NUM : 0;
    return (value * rate! * periods(from, settle!, first!, f!, b!)) / f!;
  }),
  ACCRINTM: security(4, 5, "ddnnb", ([issue, settle, rate, par, b], vs) => {
    const value = vs[3] === null || vs[3] === undefined ? 1000 : par!;
    if (rate! <= 0 || value <= 0 || settle! < issue!) return NUM;
    return value * rate! * yearFrac(issue!, settle!, b!);
  }),

  DISC: security(4, 5, "ddnnb", ([s, m, pr, red, b]) => (s! >= m! || pr! <= 0 || red! <= 0 ? NUM : (red! - pr!) / red! / yearFrac(s!, m!, b!))),
  PRICEDISC: security(4, 5, "ddnnb", ([s, m, disc, red, b]) => (s! >= m! || disc! <= 0 || red! <= 0 ? NUM : red! - disc! * red! * yearFrac(s!, m!, b!))),
  YIELDDISC: security(4, 5, "ddnnb", ([s, m, pr, red, b]) => (s! >= m! || pr! <= 0 || red! <= 0 ? NUM : (red! - pr!) / pr! / yearFrac(s!, m!, b!))),
  INTRATE: security(4, 5, "ddnnb", ([s, m, inv, red, b]) => (s! >= m! || inv! <= 0 || red! <= 0 ? NUM : (red! - inv!) / inv! / yearFrac(s!, m!, b!))),
  RECEIVED: security(4, 5, "ddnnb", ([s, m, inv, disc, b]) => {
    if (s! >= m! || inv! <= 0 || disc! <= 0) return NUM;
    const d = 1 - disc! * yearFrac(s!, m!, b!);
    return d <= 0 ? NUM : inv! / d;
  }),
  PRICEMAT: security(5, 6, "dddnnb", ([s, m, issue, rate, yld, b]) => {
    if (s! >= m! || rate! < 0 || yld! < 0 || issue! > s!) return NUM;
    const im = yearFrac(issue!, m!, b!);
    const is = yearFrac(issue!, s!, b!);
    const sm = yearFrac(s!, m!, b!);
    return ((1 + im * rate!) / (1 + sm * yld!) - is * rate!) * 100;
  }),
  YIELDMAT: security(5, 6, "dddnnb", ([s, m, issue, rate, pr, b]) => {
    if (s! >= m! || rate! < 0 || pr! <= 0 || issue! > s!) return NUM;
    const im = yearFrac(issue!, m!, b!);
    const is = yearFrac(issue!, s!, b!);
    const sm = yearFrac(s!, m!, b!);
    return ((1 + im * rate!) / (pr! / 100 + is * rate!) - 1) / sm;
  }),

  ODDFPRICE: security(8, 9, "dddnnnnfb", ([s, m, issue, first, rate, yld, red, f, b]) => {
    if (!(m! > first! && first! > s! && s! > issue!) || rate! < 0 || yld! < 0 || red! <= 0) return NUM;
    return oddFirstPrice(s!, m!, issue!, first!, rate!, yld!, red!, f!, b!);
  }),
  ODDFYIELD: security(8, 9, "dddnnnnfb", ([s, m, issue, first, rate, pr, red, f, b]) => {
    if (!(m! > first! && first! > s! && s! > issue!) || rate! < 0 || pr! <= 0 || red! <= 0) return NUM;
    const r = solveFalling((x) => oddFirstPrice(s!, m!, issue!, first!, rate!, x, red!, f!, b!) - pr!, -f! + 1e-9, 1);
    return r === null ? NUM : r;
  }),
  ODDLPRICE: security(7, 8, "dddnnnfb", ([s, m, last, rate, yld, red, f, b]) => {
    if (!(m! > s! && s! > last!) || rate! < 0 || yld! < 0 || red! <= 0) return NUM;
    const { c, whole, left, accrued } = oddLastParts(s!, m!, last!, rate!, f!, b!);
    return (red! + c * whole) / (1 + (left * yld!) / f!) - c * accrued;
  }),
  ODDLYIELD: security(7, 8, "dddnnnfb", ([s, m, last, rate, pr, red, f, b]) => {
    if (!(m! > s! && s! > last!) || rate! < 0 || pr! <= 0 || red! <= 0) return NUM;
    const { c, whole, left, accrued } = oddLastParts(s!, m!, last!, rate!, f!, b!);
    return (((red! + c * whole) / (pr! + c * accrued) - 1) * f!) / left;
  }),

  TBILLPRICE: security(3, 3, "ddn", ([s, m, disc]) => {
    if (s! >= m! || disc! <= 0 || m! > addMonths(s!, 12, false)) return NUM;
    const p = 100 * (1 - (disc! * (m! - s!)) / 360);
    return p <= 0 ? NUM : p;
  }),
  TBILLYIELD: security(3, 3, "ddn", ([s, m, pr]) => (s! >= m! || pr! <= 0 || m! > addMonths(s!, 12, false) ? NUM : ((100 - pr!) / pr!) * (360 / (m! - s!)))),
  TBILLEQ: security(3, 3, "ddn", ([s, m, disc]) => {
    if (s! >= m! || disc! <= 0 || m! > addMonths(s!, 12, false)) return NUM;
    const days = m! - s!;
    if (disc! * days >= 360) return NUM;
    if (days <= 182) return (365 * disc!) / (360 - disc! * days);
    // More than half a year: the bond-equivalent yield has to allow for a coupon, which makes the equation quadratic.
    const year = isLeap(serialDate(s!).year) ? 366 : 365;
    const p = 1 - (disc! * days) / 360;
    const a = days / (2 * year) - 0.25;
    const b = days / year;
    const c = (p - 1) / p;
    // Exactly at half a year the equation is linear.
    if (Math.abs(a) < 1e-12) return -c / b;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }),

  AMORLINC: security(6, 7, "ndddnnb", ([cost, bought, first, salvage, per, rate, b]) => {
    if (cost! <= 0 || bought! > first! || salvage! < 0 || salvage! > cost! || per! < 0 || rate! <= 0) return NUM;
    const p = Math.trunc(per!);
    const one = cost! * rate!;
    const rest = cost! - salvage!;
    const zero = yearFrac(bought!, first!, b!) * rate! * cost!;
    const full = Math.trunc((rest - zero) / one);
    if (p === 0) return zero;
    if (p <= full) return one;
    if (p === full + 1) return rest - one * full - zero;
    return 0;
  }),
  AMORDEGRC: security(6, 7, "ndddnnb", ([cost, bought, first, salvage, per, rate, b]) => {
    if (cost! <= 0 || bought! > first! || salvage! < 0 || salvage! > cost! || per! < 0 || rate! <= 0) return NUM;
    const p = Math.trunc(per!);
    const life = 1 / rate!;
    return degressive(cost!, bought!, first!, salvage!, p, rate!, b!, life < 3 ? 1 : life < 5 ? 1.5 : life <= 6 ? 2 : 2.5);
  }),

  VDB: security(5, 7, "nnnnnnn", ([cost, salvage, life, start, end, factorGiven], vs) => {
    const factor = vs[5] === undefined || vs[5] === null ? 2 : factorGiven!;
    const noSwitch = vs[6] !== undefined && vs[6] !== null && toNumber(vs[6]) !== 0;
    if (start! < 0 || end! < start! || end! > life! || cost! < 0 || salvage! < 0 || life! <= 0 || factor <= 0) return NUM;
    if (start! === end!) return 0;
    return declining(cost!, salvage!, life!, factor, noSwitch, end!) - declining(cost!, salvage!, life!, factor, noSwitch, start!);
  }),
};

/** Macaulay duration of a bond, in years. */
function duration(settle: number, maturity: number, coupon: number, yld: number, freq: number, basis: number): number | ErrorValue {
  if (settle >= maturity || coupon < 0 || yld < 0) return NUM;
  const { n, E, DSC } = period(settle, maturity, freq, basis);
  const c = (100 * coupon) / freq;
  const y = 1 + yld / freq;
  const t0 = DSC / E - 1; // where the first coupon falls, in periods, less one
  let weighted = 0;
  let pv = 0;
  for (let k = 1; k <= n; k++) {
    const cash = k === n ? c + 100 : c;
    const t = k + t0;
    const v = cash / y ** t;
    weighted += t * v;
    pv += v;
  }
  return weighted / pv / freq;
}

/** French straight depreciation with the coefficient that `AMORDEGRC` picks from the life of the asset. */
function degressive(cost: number, bought: number, first: number, salvage: number, per: number, rate: number, basis: number, coefficient: number): number {
  const r = rate * coefficient;
  let nRate = roundHalfUp(yearFrac(bought, first, basis) * r * cost);
  let book = cost - nRate;
  let rest = book - salvage;
  for (let n = 0; n < per; n++) {
    nRate = roundHalfUp(r * book);
    rest -= nRate;
    if (rest < 0) return per - n <= 1 ? roundHalfUp(book * 0.5) : 0;
    book -= nRate;
  }
  return roundHalfUp(nRate);
}
