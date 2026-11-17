import { PliError } from "@pli.dev/core";
import { cellAddress, parseRange } from "./address";
import { cellFromInput } from "./input";
import { MAX_COLS, MAX_ROWS, type Cell, type Sheet } from "./model";
import { createWorkbook } from "./session";
import { formatValue } from "./format";
import type { Workbook } from "./model";
import type { Calculator } from "./calc";
import { isError } from "./values";

export interface CsvReadOptions {
  /** The character between fields. Detected from the first line (comma, semicolon, tab) if not given. */
  delimiter?: string;
  /** Read numbers, booleans, percentages and dates as such. On by default; off keeps every field as text. */
  typed?: boolean;
  /** The name of the sheet. */
  sheet?: string;
}

/** Splits CSV text into rows of fields: quotes, doubled quotes, and line breaks inside quoted fields are understood. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      any = true;
    } else if (c === d) {
      row.push(field);
      field = "";
      any = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      if (any || field !== "" || row.length) {
        row.push(field);
        rows.push(row);
      } else rows.push([]);
      row = [];
      field = "";
      any = false;
    } else {
      field += c;
      any = true;
    }
  }
  if (any || field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1]!.length === 0) rows.pop();
  return rows;
}

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t", "|"]) {
    let count = 0;
    let quoted = false;
    for (const c of line) {
      if (c === '"') quoted = !quoted;
      else if (c === d && !quoted) count++;
    }
    if (count > bestCount) [best, bestCount] = [d, count];
  }
  return best;
}

/** A workbook with one sheet holding the CSV. Fields that look like numbers, dates and so on become them. */
export function fromCsv(text: string, options: CsvReadOptions = {}): Workbook {
  const rows = parseCsv(text, options.delimiter);
  if (rows.length > MAX_ROWS) throw new PliError("out_of_range", "Too many rows for a sheet");
  const wb = createWorkbook("Untitled", [options.sheet ?? "Sheet1"]);
  const cells: Record<string, Cell> = {};
  rows.forEach((row, i) => {
    if (row.length > MAX_COLS) throw new PliError("out_of_range", "Too many columns for a sheet");
    row.forEach((field, j) => {
      if (field === "") return;
      // A field that starts like a formula is kept as text: a CSV isn't a place to run formulas from.
      const cell = options.typed === false || /^[=+@-]/.test(field) && !/^[+-]?[\d.]/.test(field) ? { v: field } : cellFromInput(field);
      if (cell) cells[cellAddress(i + 1, j + 1)] = cell;
    });
  });
  const sheet: Sheet = { ...wb.sheets[0]!, cells };
  return { ...wb, sheets: [sheet] };
}

export interface CsvWriteOptions {
  delimiter?: string;
  /** A range such as `A1:D20`. Without it, everything the sheet uses. */
  range?: string;
  /** Write the numbers as they show (with their formats) rather than their values. Off by default. */
  formatted?: boolean;
  /** The line ending. Defaults to `\n`. */
  newline?: string;
}

/** The sheet as CSV text, with formulas written as what they work out to. */
export function toCsv(calc: Calculator, sheetId: string, options: CsvWriteOptions = {}): string {
  const sheet = calc.workbook.sheets.find((s) => s.id === sheetId || s.name === sheetId);
  if (!sheet) throw new PliError("not_found", `No sheet "${sheetId}"`);
  let b = options.range ? parseRange(options.range) : null;
  if (options.range && !b) throw new PliError("out_of_range", `"${options.range}" is not a range`);
  if (!b) {
    const used = calc.usedBounds(sheet.id);
    if (!used) return "";
    b = { r1: 1, c1: 1, r2: used.r2, c2: used.c2 };
  }
  const d = options.delimiter ?? ",";
  const nl = options.newline ?? "\n";
  const out: string[] = [];
  for (let r = b.r1; r <= b.r2; r++) {
    const fields: string[] = [];
    for (let c = b.c1; c <= b.c2; c++) {
      const address = cellAddress(r, c);
      const v = calc.value(sheet.id, address);
      let t: string;
      if (v === null) t = "";
      else if (isError(v)) t = v.error;
      else if (options.formatted) t = formatValue(v, sheet.cells[address]?.fmt).text;
      else t = typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
      fields.push(quote(t, d));
    }
    out.push(fields.join(d));
  }
  return out.join(nl) + nl;
}

function quote(t: string, d: string): string {
  return t.includes(d) || /["\r\n]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
