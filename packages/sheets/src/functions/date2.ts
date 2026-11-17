import { isError, NUM, serialDate, toNumber, VALUE, type Value } from "../values";
import { eachValue, scalar, simple } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

const dayOf = (serial: number) => serialDate(Math.floor(serial)).weekday; // 0 is Sunday

/** Which days are weekend, as seven flags from Monday: a code from the list Excel gives, or a text such as "0000011". */
function weekendFlags(w: Value): boolean[] | null {
  if (typeof w === "string") {
    return /^[01]{7}$/.test(w) && w !== "1111111" ? [...w].map((c) => c === "1") : null;
  }
  const n = typeof w === "number" ? w : w === null ? 1 : NaN;
  const flags = Array(7).fill(false) as boolean[];
  if (n >= 1 && n <= 7) {
    // 1 is Saturday and Sunday, 2 Sunday and Monday, and so on.
    const first = (5 + (n - 1)) % 7; // Monday = 0
    flags[first] = true;
    flags[(first + 1) % 7] = true;
    return flags;
  }
  if (n >= 11 && n <= 17) {
    flags[(n - 11 + 6) % 7] = true; // 11 is Sunday only, 12 Monday only…
    return flags;
  }
  return null;
}

const isWork = (serial: number, flags: boolean[], off: Set<number>) => !flags[(dayOf(serial) + 6) % 7] && !off.has(serial);

function holidays(a: Arg | undefined, ctx: Ctx): Set<number> {
  const out = new Set<number>();
  if (a !== undefined) eachValue(a, ctx, (v) => { if (typeof v === "number") out.add(Math.floor(v)); });
  return out;
}

export const dates2: Record<string, FunctionDef> = {
  ISOWEEKNUM: simple(1, 1, ([v]) => {
    const n = toNumber(v!);
    if (isError(n)) return n;
    if (n < 0) return NUM;
    const serial = Math.floor(n);
    const wd = (dayOf(serial) + 6) % 7; // Monday = 0
    // The week belongs to the year that has its Thursday.
    const thursday = serial - wd + 3;
    const year = serialDate(thursday).year;
    const jan1 = Date.UTC(year, 0, 1);
    const day = Date.UTC(year, serialDate(thursday).month - 1, serialDate(thursday).day);
    return Math.floor((day - jan1) / 86400000 / 7) + 1;
  }),
  "NETWORKDAYS.INTL": {
    min: 2,
    max: 4,
    fn: (args, ctx) => {
      const a = toNumber(scalar(args[0], ctx));
      const b = toNumber(scalar(args[1], ctx));
      if (isError(a)) return a;
      if (isError(b)) return b;
      const flags = weekendFlags(args[2] === undefined ? 1 : scalar(args[2], ctx));
      if (!flags) return VALUE;
      const off = holidays(args[3] as Arg | undefined, ctx);
      const [lo, hi] = a <= b ? [Math.floor(a), Math.floor(b)] : [Math.floor(b), Math.floor(a)];
      let count = 0;
      for (let d = lo; d <= hi; d++) if (isWork(d, flags, off)) count++;
      return a <= b ? count : -count;
    },
  },
  "WORKDAY.INTL": {
    min: 2,
    max: 4,
    fn: (args, ctx) => {
      const a = toNumber(scalar(args[0], ctx));
      const k = toNumber(scalar(args[1], ctx));
      if (isError(a)) return a;
      if (isError(k)) return k;
      const flags = weekendFlags(args[2] === undefined ? 1 : scalar(args[2], ctx));
      if (!flags) return VALUE;
      const off = holidays(args[3] as Arg | undefined, ctx);
      let d = Math.floor(a);
      let left = Math.abs(Math.trunc(k));
      const step = k < 0 ? -1 : 1;
      while (left > 0) {
        d += step;
        if (d < 0) return NUM;
        if (isWork(d, flags, off)) left--;
      }
      return d;
    },
  },
};

