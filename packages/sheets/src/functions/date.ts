import { dateSerial, isError, nowSerial, NUM, parseDateTime, serialDate, serialTime, toNumber, toText, VALUE, type Value } from "../values";
import { eachValue, scalar, simple } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

const n = (v: Value | undefined, fallback = 0): number | null => {
  if (v === undefined || v === null) return fallback;
  const x = toNumber(v);
  return isError(x) ? null : x;
};

function addMonths(serial: number, months: number): number | null {
  const d = serialDate(serial);
  const total = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12 + 1;
  const last = daysInMonth(year, month);
  return dateSerial(year, month, Math.min(d.day, last));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function holidays(arg: Arg | undefined, ctx: Ctx): Set<number> {
  const out = new Set<number>();
  if (arg === undefined) return out;
  eachValue(arg, ctx, (v) => { if (typeof v === "number") out.add(Math.floor(v)); });
  return out;
}

const isWorkday = (serial: number, off: Set<number>) => {
  const wd = serialDate(serial).weekday;
  return wd !== 0 && wd !== 6 && !off.has(serial);
};

export const dates: Record<string, FunctionDef> = {
  TODAY: { min: 0, max: 0, volatile: true, fn: (_a, ctx) => Math.floor(ctx.host.now()) },
  NOW: { min: 0, max: 0, volatile: true, fn: (_a, ctx) => ctx.host.now() },
  DATE: simple(3, 3, ([y, m, d]) => {
    const year = n(y), month = n(m), day = n(d);
    if (year === null || month === null || day === null) return VALUE;
    let yr = Math.trunc(year);
    if (yr >= 0 && yr < 1900) yr += 1900;
    const base = dateSerial(yr, 1, 1);
    if (base === null) return NUM;
    // Months and days outside their range roll over.
    const total = yr * 12 + Math.trunc(month) - 1;
    const first = dateSerial(Math.floor(total / 12), ((total % 12) + 12) % 12 + 1, 1);
    if (first === null) return NUM;
    const serial = first + Math.trunc(day) - 1;
    return serial < 0 || serial > 2958465 ? NUM : serial;
  }),
  TIME: simple(3, 3, ([h, m, s]) => {
    const a = n(h), b = n(m), c = n(s);
    if (a === null || b === null || c === null) return VALUE;
    const secs = Math.trunc(a) * 3600 + Math.trunc(b) * 60 + Math.trunc(c);
    return secs < 0 ? NUM : (secs % 86400) / 86400;
  }),
  YEAR: simple(1, 1, ([v]) => { const x = n(v); return x === null ? VALUE : x < 0 ? NUM : serialDate(x).year; }),
  MONTH: simple(1, 1, ([v]) => { const x = n(v); return x === null ? VALUE : x < 0 ? NUM : serialDate(x).month; }),
  DAY: simple(1, 1, ([v]) => { const x = n(v); return x === null ? VALUE : x < 0 ? NUM : serialDate(x).day; }),
  HOUR: simple(1, 1, ([v]) => { const x = n(v); return x === null ? VALUE : x < 0 ? NUM : serialTime(x).hour; }),
  MINUTE: simple(1, 1, ([v]) => { const x = n(v); return x === null ? VALUE : x < 0 ? NUM : serialTime(x).minute; }),
  SECOND: simple(1, 1, ([v]) => { const x = n(v); return x === null ? VALUE : x < 0 ? NUM : serialTime(x).second; }),
  WEEKDAY: simple(1, 2, ([v, t]) => {
    const x = n(v), type = n(t, 1);
    if (x === null || type === null || x < 0) return VALUE;
    const wd = serialDate(x).weekday;
    if (type === 1) return wd + 1;
    if (type === 2) return ((wd + 6) % 7) + 1;
    if (type === 3) return (wd + 6) % 7;
    if (type >= 11 && type <= 17) return ((wd - (type - 11 + 1)) % 7 + 7) % 7 + 1;
    return NUM;
  }),
  WEEKNUM: simple(1, 2, ([v, t]) => {
    const x = n(v), type = n(t, 1);
    if (x === null || type === null) return VALUE;
    const d = serialDate(x);
    const jan1 = dateSerial(d.year, 1, 1)!;
    const startDay = type === 2 || type === 11 ? 1 : 0;
    const jan1Wd = (serialDate(jan1).weekday - startDay + 7) % 7;
    return Math.floor((Math.floor(x) - jan1 + jan1Wd) / 7) + 1;
  }),
  DATEVALUE: simple(1, 1, ([v]) => {
    const x = parseDateTime(toText(v!) as string);
    return x === null ? VALUE : Math.floor(x);
  }),
  TIMEVALUE: simple(1, 1, ([v]) => {
    const x = parseDateTime(toText(v!) as string);
    return x === null ? VALUE : x - Math.floor(x);
  }),
  EDATE: simple(2, 2, ([s, m]) => {
    const x = n(s), k = n(m);
    if (x === null || k === null) return VALUE;
    return addMonths(Math.floor(x), Math.trunc(k)) ?? NUM;
  }),
  EOMONTH: simple(2, 2, ([s, m]) => {
    const x = n(s), k = n(m);
    if (x === null || k === null) return VALUE;
    const d = addMonths(Math.floor(x), Math.trunc(k));
    if (d === null) return NUM;
    const p = serialDate(d);
    return dateSerial(p.year, p.month, daysInMonth(p.year, p.month)) ?? NUM;
  }),
  DAYS: simple(2, 2, ([e, s]) => {
    const a = n(e), b = n(s);
    return a === null || b === null ? VALUE : Math.floor(a) - Math.floor(b);
  }),
  DAYS360: simple(2, 3, ([s, e, method]) => {
    const a = n(s), b = n(e);
    if (a === null || b === null) return VALUE;
    const x = serialDate(a), y = serialDate(b);
    let d1 = x.day, d2 = y.day;
    if (method === true) {
      d1 = Math.min(d1, 30);
      d2 = Math.min(d2, 30);
    } else {
      if (d1 === 31 || (x.month === 2 && d1 === daysInMonth(x.year, 2))) d1 = 30;
      if (d2 === 31 && d1 >= 30) d2 = 30;
    }
    return (y.year - x.year) * 360 + (y.month - x.month) * 30 + (d2 - d1);
  }),
  DATEDIF: simple(3, 3, ([s, e, unit]) => {
    const a = n(s), b = n(e);
    if (a === null || b === null) return VALUE;
    if (a > b) return NUM;
    const x = serialDate(a), y = serialDate(b);
    let months = (y.year - x.year) * 12 + (y.month - x.month);
    if (y.day < x.day) months--;
    switch ((toText(unit!) as string).toUpperCase()) {
      case "Y": return Math.floor(months / 12);
      case "M": return months;
      case "D": return Math.floor(b) - Math.floor(a);
      case "MD": { let d = y.day - x.day; if (d < 0) { const pm = y.month === 1 ? 12 : y.month - 1; d += daysInMonth(pm === 12 ? y.year - 1 : y.year, pm); } return d; }
      case "YM": return ((months % 12) + 12) % 12;
      case "YD": { const sameYear = dateSerial(y.year, x.month, x.day) ?? 0; const from = sameYear > Math.floor(b) ? dateSerial(y.year - 1, x.month, x.day) ?? 0 : sameYear; return Math.floor(b) - from; }
      default: return NUM;
    }
  }),
  NETWORKDAYS: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const a = n(scalar(args[0], ctx)), b = n(scalar(args[1], ctx));
      if (a === null || b === null) return VALUE;
      const off = holidays(args[2], ctx);
      const [lo, hi] = a <= b ? [Math.floor(a), Math.floor(b)] : [Math.floor(b), Math.floor(a)];
      let count = 0;
      for (let d = lo; d <= hi; d++) if (isWorkday(d, off)) count++;
      return a <= b ? count : -count;
    },
  },
  WORKDAY: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const a = n(scalar(args[0], ctx)), k = n(scalar(args[1], ctx));
      if (a === null || k === null) return VALUE;
      const off = holidays(args[2], ctx);
      let d = Math.floor(a);
      let left = Math.abs(Math.trunc(k));
      const step = k < 0 ? -1 : 1;
      while (left > 0) {
        d += step;
        if (d < 0) return NUM;
        if (isWorkday(d, off)) left--;
      }
      return d;
    },
  },
  YEARFRAC: simple(2, 3, ([s, e, basis]) => {
    const a = n(s), b = n(e), bs = n(basis, 0);
    if (a === null || b === null || bs === null) return VALUE;
    const [lo, hi] = a <= b ? [Math.floor(a), Math.floor(b)] : [Math.floor(b), Math.floor(a)];
    if (bs === 0 || bs === 4) {
      const x = serialDate(lo), y = serialDate(hi);
      let d1 = x.day, d2 = y.day;
      if (bs === 0) {
        if (d1 === 31 || (x.month === 2 && d1 === daysInMonth(x.year, 2))) d1 = 30;
        if (d2 === 31 && d1 >= 30) d2 = 30;
      } else { d1 = Math.min(d1, 30); d2 = Math.min(d2, 30); }
      return ((y.year - x.year) * 360 + (y.month - x.month) * 30 + (d2 - d1)) / 360;
    }
    if (bs === 2) return (hi - lo) / 360;
    if (bs === 3) return (hi - lo) / 365;
    if (bs === 1) {
      const x = serialDate(lo), y = serialDate(hi);
      const years = y.year - x.year + 1;
      const leap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
      let total = 0;
      for (let yr = x.year; yr <= y.year; yr++) total += leap(yr) ? 366 : 365;
      return (hi - lo) / (total / years);
    }
    return NUM;
  }),
};

