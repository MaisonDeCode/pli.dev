import type { ErrorCode } from "./model";

/** A formula error as a value. Compare with `isError`; the objects are shared. */
export interface ErrorValue {
  readonly error: ErrorCode;
}

const errors = new Map<ErrorCode, ErrorValue>();
export function err(code: ErrorCode): ErrorValue {
  let e = errors.get(code);
  if (!e) {
    e = Object.freeze({ error: code });
    errors.set(code, e);
  }
  return e;
}

export const DIV0 = err("#DIV/0!");
export const VALUE = err("#VALUE!");
export const REF = err("#REF!");
export const NAME = err("#NAME?");
export const NUM = err("#NUM!");
export const NA = err("#N/A");
export const NULLERR = err("#NULL!");

export const ERROR_CODES: readonly ErrorCode[] = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!"];

/** What a cell or an expression is worth. `null` is an empty cell. */
export type Value = number | string | boolean | null | ErrorValue;

/** A block of values, row by row. Formulas on ranges and array constants give these. */
export interface ArrayValue {
  readonly array: Value[][];
}

export function isError(v: unknown): v is ErrorValue {
  return typeof v === "object" && v !== null && "error" in v;
}

export function isArray(v: unknown): v is ArrayValue {
  return typeof v === "object" && v !== null && "array" in v;
}

export function arrayOf(rows: Value[][]): ArrayValue {
  return { array: rows };
}

// ---- numbers and text ----

/** Reads text the way Excel does when a number is expected: spaces, thousands commas, a trailing %, dates and times. */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const m = /^([+-]?)\s*(?:\$|€|£)?\s*(\d{1,3}(?:,\d{3})+|\d*)(\.\d*)?(?:[eE]([+-]?\d+))?\s*(%?)$/.exec(t);
  if (m && (m[2] !== "" || (m[3] !== undefined && m[3].length > 1))) {
    const whole = (m[2] ?? "").replace(/,/g, "");
    let n = Number(`${whole || "0"}${m[3] ?? ""}${m[4] ? "e" + m[4] : ""}`);
    if (!Number.isFinite(n)) return null;
    if (m[5]) n /= 100;
    return m[1] === "-" ? -n : n;
  }
  const paren = /^\((.+)\)$/.exec(t);
  if (paren) {
    const n = parseNumber(paren[1]!);
    return n === null ? null : -n;
  }
  return parseDateTime(t);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date and/or time in text, as a serial number: `2024-03-05`, `3/5/2024`, `5 Mar 2024`, `14:30`, `2024-03-05 14:30:15`. */
export function parseDateTime(text: string): number | null {
  const t = text.trim();
  const time = /(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM|am|pm)?$/.exec(t);
  let fraction: number | null = null;
  let datePart = t;
  if (time) {
    let h = Number(time[1]);
    const mi = Number(time[2]);
    const s = Number(time[3] ?? 0);
    const ap = time[4]?.toUpperCase();
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "PM" && h < 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
    }
    if (h > 23 || mi > 59 || s > 59) return null;
    fraction = (h * 3600 + mi * 60 + s) / 86400;
    datePart = t.slice(0, time.index).trim();
    if (datePart === "") return fraction;
  }
  let y: number, mo: number, d: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(datePart))) {
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3]!.length === 2) y += y < 30 ? 2000 : 1900;
  } else if ((m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})$/.exec(datePart))) {
    [d, mo, y] = [Number(m[1]), MONTHS.indexOf(m[2]!.toLowerCase()) + 1, Number(m[3])];
  } else if ((m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(datePart))) {
    [mo, d, y] = [MONTHS.indexOf(m[1]!.toLowerCase()) + 1, Number(m[2]), Number(m[3])];
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const serial = dateSerial(y, mo, d);
  if (serial === null) return null;
  const back = serialDate(serial);
  if (back.month !== mo || back.day !== d) return null;
  return serial + (fraction ?? 0);
}

// ---- dates: the 1900 system, including its fictional 29 February 1900 ----

const MS_DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

/** Year, month and day to a serial number (1 is 1 Jan 1900), or null outside Excel's range. */
export function dateSerial(year: number, month: number, day: number): number | null {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  let serial = Math.round((d.getTime() - EPOCH) / MS_DAY);
  if (serial < 60) serial -= 1; // Excel counts a 29 February 1900 that never was
  if (serial < 0 || serial > 2_958_465) return null;
  return serial;
}

export interface DateParts {
  year: number;
  month: number;
  day: number;
  /** 0 is Sunday */
  weekday: number;
}

export function serialDate(serial: number): DateParts {
  const whole = Math.floor(serial);
  if (whole === 60) return { year: 1900, month: 2, day: 29, weekday: 3 };
  const days = whole < 60 ? whole + 1 : whole;
  const d = new Date(EPOCH + days * MS_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

export function serialTime(serial: number): { hour: number; minute: number; second: number } {
  let secs = Math.round((serial - Math.floor(serial)) * 86400);
  if (secs >= 86400) secs = 86399;
  return { hour: Math.floor(secs / 3600), minute: Math.floor((secs % 3600) / 60), second: secs % 60 };
}

export function nowSerial(date = new Date()): number {
  const local = date.getTime() - date.getTimezoneOffset() * 60_000;
  const days = Math.floor(local / MS_DAY);
  const d = new Date(days * MS_DAY);
  const serial = dateSerial(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ?? 0;
  return serial + (local - days * MS_DAY) / MS_DAY;
}

// ---- coercion ----

/** The value as a number, or an error: text that reads as a number counts, TRUE is 1, an empty cell is 0. */
export function toNumber(v: Value): number | ErrorValue {
  if (typeof v === "number") return v;
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = parseNumber(v);
    return n === null ? VALUE : n;
  }
  return v;
}

export function toBool(v: Value): boolean | ErrorValue {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v === null) return false;
  if (typeof v === "string") {
    const u = v.trim().toUpperCase();
    if (u === "TRUE") return true;
    if (u === "FALSE") return false;
    return VALUE;
  }
  return v;
}

/** The value as text, the way `&` writes it. */
export function toText(v: Value): string | ErrorValue {
  if (typeof v === "string") return v;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return numberText(v);
  return v;
}

/** A number as General format writes it: up to 15 significant digits, no trailing zeros, E notation when long. */
export function numberText(n: number): string {
  if (Object.is(n, -0)) return "0";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) {
    const [m, e] = n.toExponential(14).split("e");
    const mant = m!.replace(/\.?0+$/, "");
    const exp = Number(e);
    return `${mant}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return String(Number(n.toPrecision(15)));
}

export function typeRank(v: Value): number {
  if (typeof v === "number" || v === null) return 0;
  if (typeof v === "string") return 1;
  return 2; // booleans sort after text
}

/** Orders two values the way Excel's comparison operators and sorting do. Blank compares as 0 or "" next to the other side. */
export function compareValues(a: Value, b: Value): number {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = typeof a === "boolean" ? Number(a) : (a as number);
  const y = typeof b === "boolean" ? Number(b) : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}
