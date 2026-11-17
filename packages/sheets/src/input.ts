import { FormulaSyntaxError, parseFormula } from "./formula";
import type { Cell } from "./model";
import { ERROR_CODES, parseDateTime } from "./values";

/**
 * What typing `text` into a cell means, as Excel reads it: `=…` is a formula, numbers, TRUE and FALSE and errors are
 * what they look like, `12%`, `$5`, `1,234` and dates come with the format they were typed in, and anything else is text.
 * A leading `'` makes the rest text. An empty string is no cell (null).
 */
export function cellFromInput(text: string): Cell | null {
  if (text === "") return null;
  if (text.startsWith("'")) return { v: text.slice(1) };
  if (text.startsWith("=") && text.trim().length > 1) return { f: closeBrackets(text.trim().slice(1)) };
  const t = text.trim();
  const upper = t.toUpperCase();
  if (upper === "TRUE") return { v: true };
  if (upper === "FALSE") return { v: false };
  const code = ERROR_CODES.find((e) => e === upper);
  if (code) return { e: code };

  let m: RegExpExecArray | null;
  if ((m = /^([+-]?)(\d+(?:\.\d+)?|\.\d+)%$/.exec(t))) {
    const places = m[2]!.includes(".") ? Math.min(m[2]!.split(".")[1]!.length, 10) : 0;
    const v = Number(m[1] + m[2]) / 100;
    return { v: Number(v.toPrecision(15)), fmt: places ? `0.${"0".repeat(places)}%` : "0%" };
  }
  if ((m = /^([+-]?)\$\s*(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?$/.exec(t))) {
    const v = Number(m[1] + m[2]!.replace(/,/g, "") + (m[3] ?? ""));
    return { v, fmt: "$#,##0.00" };
  }
  if ((m = /^([+-]?\d{1,3}(?:,\d{3})+)(\.\d+)?$/.exec(t))) {
    return { v: Number(m[1]!.replace(/,/g, "") + (m[2] ?? "")), ...(m[2] ? {} : { fmt: "#,##0" }) };
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    const v = Number(t);
    if (Number.isFinite(v)) return { v };
  }
  // Dates and times. A value like "2024-03-05" or "3/5/2024" takes a date format; "14:30" a time one.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})$/.test(t) || /^\d{1,2}[ -][A-Za-z]{3}[a-z]*[ -,]*\d{4}$/.test(t) || /^[A-Za-z]{3}[a-z]*\.? \d{1,2},? \d{4}$/.test(t)) {
    const serial = parseDateTime(t);
    if (serial !== null) return { v: serial, fmt: t.includes("/") ? "m/d/yyyy" : /^\d{4}-/.test(t) ? "yyyy-mm-dd" : "d-mmm-yyyy" };
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4} \d{1,2}:\d{2}/.test(t)) {
    const serial = parseDateTime(t);
    if (serial !== null) return { v: serial, fmt: t.includes("/") ? "m/d/yyyy h:mm" : "yyyy-mm-dd hh:mm" };
  }
  if (/^\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?$/.test(t)) {
    const serial = parseDateTime(t);
    if (serial !== null) return { v: serial, fmt: /[AaPp][Mm]$/.test(t) ? "h:mm AM/PM" : t.split(":").length === 3 ? "h:mm:ss" : "h:mm" };
  }
  return { v: text };
}

/** A formula typed without its closing brackets gets them, as Excel does: `SUM(A1` is `SUM(A1)`. Anything else is left as it is. */
export function closeBrackets(formula: string): string {
  try {
    parseFormula(formula);
    return formula;
  } catch (e) {
    if (!(e instanceof FormulaSyntaxError)) throw e;
  }
  let open = 0;
  let quoted = false;
  for (const c of formula) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") open++;
    else if (!quoted && c === ")") open--;
  }
  if (open <= 0 || quoted) return formula;
  const closed = formula + ")".repeat(open);
  try {
    parseFormula(closed);
    return closed;
  } catch {
    return formula;
  }
}
