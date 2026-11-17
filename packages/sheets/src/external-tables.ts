import { PliError } from "@pli.dev/core";
import { parseRange, rangeAddress, type Bounds } from "./address";
import { parseFormula, FormulaSyntaxError, type Node } from "./formula";
import type { ExternalBook, ExternalTable, Workbook } from "./model";
import { mapNodes } from "./refs";

/*
 * Tables of other workbooks. A formula such as `=SUM([Prices.xlsx]Orders[Total])` (or `[Prices.xlsx]Sheet1!Orders[Total]`)
 * names a table of a workbook Pli has not opened. What Pli needs to read it is where the table is (the sheet, the range, the
 * names of its columns, whether it has a header and a totals row), kept in `ExternalBook.tables`, and the cells of that range,
 * kept in `ExternalBook.sheets` like any other cells read from the workbook. The host gives the first through the session's
 * `externalTables` resolver (or `session.setExternalTable`), the second through `externalLists`.
 *
 * Excel keeps no table definitions in an `externalLink` part, so in an .xlsx file such a reference is written as the range it
 * stands for (`[1]Sheet1!$B$2:$B$9`); see xlsx-external.ts.
 */

type TableRef = Extract<Node, { t: "tref" }>;

/** The workbook (and sheet, if one is named) a table reference's `sheet` stands for: `[Prices.xlsx]` or `[Prices.xlsx]Sheet1`. */
export function splitTableSheet(sheet: string | undefined): { book: string; sheet?: string } | null {
  const m = sheet === undefined ? null : /^\[([^\]]+)\](.*)$/.exec(sheet);
  return m ? { book: m[1]!, ...(m[2] ? { sheet: m[2] } : {}) } : null;
}

const lower = (s: string) => s.toLowerCase();

/** The kept definition of the table a reference names, with the workbook it is in. */
export function findExternalTable(wb: Workbook, ref: Pick<TableRef, "sheet" | "table">): { book: ExternalBook; table: ExternalTable } | undefined {
  const split = splitTableSheet(ref.sheet);
  if (!split || ref.table === undefined) return undefined;
  const book = wb.externalBooks?.find((b) => lower(b.name) === lower(split.book));
  const table = book?.tables?.find((t) => lower(t.name) === lower(ref.table!) && (split.sheet === undefined || lower(t.sheet) === lower(split.sheet)));
  return book && table ? { book, table } : undefined;
}

/** Where the rows of a table's data are: past the header, before the totals. */
const dataSpan = (table: ExternalTable, b: Bounds): [number, number] => [table.header === false ? b.r1 : b.r1 + 1, table.totals ? b.r2 - 1 : b.r2];

/** The cells a reference to part of a table of another workbook stands for, on the sheet (as `book`'s kept sheet is named), or null when they can't be told. */
export function externalTableBounds(ref: TableRef, table: ExternalTable): Bounds | null {
  const b = parseRange(table.range);
  if (!b || ref.area === "row") return null;
  const names = table.columns.map(lower);
  const index = (name: string | undefined, fallback: number) => (name === undefined ? fallback : names.indexOf(lower(name)));
  const first = index(ref.from, 0);
  const last = ref.to === undefined ? (ref.from === undefined ? names.length - 1 : first) : index(ref.to, -1);
  if (first < 0 || last < 0) return null;
  const c1 = b.c1 + Math.min(first, last);
  const c2 = b.c1 + Math.max(first, last);
  const [top, bottom] = dataSpan(table, b);
  let r1: number;
  let r2: number;
  switch (ref.area) {
    case "data":
      [r1, r2] = [top, bottom];
      break;
    case "all":
      [r1, r2] = [b.r1, b.r2];
      break;
    case "headers":
      if (table.header === false) return null;
      [r1, r2] = [b.r1, b.r1];
      break;
    default:
      if (!table.totals) return null;
      [r1, r2] = [b.r2, b.r2];
  }
  return r2 < r1 ? null : { r1, c1, r2, c2 };
}

/** The id of the read-only sheet that holds the kept cells of one sheet of a workbook (see external-sheets.ts). */
export const externalSheetId = (book: ExternalBook, sheet: string): string => {
  const key = Object.keys(book.sheets).find((s) => lower(s) === lower(sheet)) ?? sheet;
  return `ext:${lower(book.name)}|${lower(key)}`;
};

/** What a reference to a table of another workbook stands for: a sheet (by id) and cells, or null when the table or column is not known. */
export function resolveExternalTableRef(ref: TableRef, wb: Workbook): { sheet: string; bounds: Bounds } | null {
  const found = findExternalTable(wb, ref);
  if (!found) return null;
  const bounds = externalTableBounds(ref, found.table);
  return bounds ? { sheet: externalSheetId(found.book, found.table.sheet), bounds } : null;
}

/** Every table of another workbook that a formula names, as the reference writes it. */
export function tableRefsIn(formula: string): TableRef[] {
  let tree: Node;
  try {
    tree = parseFormula(formula);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return [];
    throw e;
  }
  const out: TableRef[] = [];
  mapNodes(tree, (n) => {
    if (n.t === "tref" && splitTableSheet(n.sheet) && n.table !== undefined) out.push(n);
    return n;
  });
  return out;
}

/** The range (`A1:B9`) of a table's cells that a reference reads, when the table is known. */
export function tableRefRange(ref: TableRef, wb: Workbook): { book: string; sheet: string; range: string } | null {
  const found = findExternalTable(wb, ref);
  const bounds = found ? externalTableBounds(ref, found.table) : null;
  return found && bounds ? { book: found.book.name, sheet: found.table.sheet, range: rangeAddress(bounds) } : null;
}

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A table of another workbook made ready to keep. */
export function cleanExternalTable(t: ExternalTable): ExternalTable {
  if (!t || typeof t !== "object") bad("A table of another workbook has a name, a sheet, a range and columns");
  if (typeof t.name !== "string" || !/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(t.name)) bad(`"${String(t.name)}" can't be the name of a table`);
  if (typeof t.sheet !== "string" || t.sheet === "" || t.sheet.length > 31 || /[[\]\\/:*?]/.test(t.sheet)) bad(`"${String(t.sheet)}" can't be the name of a sheet`);
  const b = typeof t.range === "string" ? parseRange(t.range) : null;
  if (!b || rangeAddress(b) !== t.range.toUpperCase()) bad(`"${String(t.range)}" is not a range such as A1:D10`);
  if (!Array.isArray(t.columns) || t.columns.some((c) => typeof c !== "string" || c === "")) bad("The columns of a table are a list of names");
  if (t.columns.length !== b!.c2 - b!.c1 + 1) bad(`The table ${t.name} covers ${b!.c2 - b!.c1 + 1} columns but names ${t.columns.length}`);
  if (new Set(t.columns.map(lower)).size !== t.columns.length) bad(`The columns of ${t.name} are not all different`);
  return { name: t.name, sheet: t.sheet, range: rangeAddress(b!), columns: [...t.columns], ...(t.header === false ? { header: false as const } : {}), ...(t.totals ? { totals: true as const } : {}) };
}

/** The tables of a book made ready to keep: all different by name, in order. */
export function cleanExternalTables(tables: readonly ExternalTable[] | undefined): ExternalTable[] | undefined {
  if (!tables || !tables.length) return undefined;
  const seen = new Set<string>();
  return tables.map((raw) => {
    const t = cleanExternalTable(raw);
    if (seen.has(lower(t.name))) bad(`There are two tables called "${t.name}" in one workbook`);
    seen.add(lower(t.name));
    return t;
  });
}
