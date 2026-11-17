import { cellAddress, colName, parseCell } from "./address";
import { splitTableSheet, tableRefRange, tableRefsIn } from "./external-tables";
import { parseFormula, FormulaSyntaxError, type Node } from "./formula";
import { MAX_SNAPSHOT_ITEMS, parseExternalRef } from "./external-list";
import type { ExternalBook, Validation, Workbook } from "./model";
import { refsIn } from "./refs";

/*
 * The references a workbook makes to cells of other workbooks (`[Prices.xlsx]Sheet1!B2`): in cell formulas, defined names and
 * validation rules. The host reads them (the session's `externalLists` resolver), and the values are kept in
 * `Workbook.externalBooks`.
 */

/** A range of another workbook that something in the workbook reads. */
export interface ExternalWant {
  /** The workbook (`Prices.xlsx`), the sheet, and the cells as `A1:B3` (no `$`). */
  book: string;
  sheet: string;
  range: string;
  /** Where it is read: a cell formula, a defined name, or a validation rule. */
  by: ("cell" | "name" | "validation")[];
  /** The cells there are in the range. */
  count: number;
}

/** A range of another workbook that the workbook reads, and how the copy it keeps of it stands. */
export interface ExternalReference {
  book: string;
  sheet: string;
  /** The cells, as `A1` or `A1:B3`. */
  range: string;
  by: ExternalWant["by"];
  /** `fresh`: the host read it in this session. `stale`: the copy kept in the workbook is used. `missing`: there is no copy, so the cells read as an error. */
  state: "fresh" | "stale" | "missing";
  /** The day the copy was read, when known. */
  read?: string;
  reason?: string;
}

/** `[Prices.xlsx]Sheet1` taken apart. */
export function splitExternalSheet(name: string): { book: string; sheet: string } | null {
  const m = /^\[([^\]]+)\](.+)$/.exec(name);
  return m ? { book: m[1]!, sheet: m[2]! } : null;
}

/** What a formula that reads another workbook has in it (`[Prices.xlsx]Sheet1!`, `'[Prices.xlsx]Sheet1'!`, `[1]Sheet1!`, `[Prices.xlsx]Orders[`), as a cheap first look. */
const HINT = /\[[^\]\[@#]+\]'?[A-Za-z_][A-Za-z0-9_. ]*'?!|'\[[^\]]+\]|\[[^\]\[@#]+\][A-Za-z_][A-Za-z0-9_.]*\[/;

/** Every formula of a workbook that can read another workbook, with what it is. */
function* formulas(wb: Workbook): Generator<{ f: string; by: ExternalWant["by"][number] }> {
  for (const sheet of wb.sheets) {
    for (const cell of Object.values(sheet.cells)) if (cell.f !== undefined && HINT.test(cell.f)) yield { f: cell.f, by: "cell" };
    for (const rule of sheet.validations ?? []) for (const f of validationFormulas(rule)) if (HINT.test(f)) yield { f, by: "validation" };
  }
  for (const f of Object.values(wb.names ?? {})) if (HINT.test(f)) yield { f, by: "name" };
}

/** The formulas of a validation rule (a list read from another workbook directly is read by the list's own snapshot, so it isn't one). */
export function validationFormulas(rule: Validation): string[] {
  switch (rule.kind) {
    case "list":
      return parseExternalRef(rule.source) ? [] : [rule.source];
    case "custom":
      return [rule.formula];
    default:
      return rule.values;
  }
}

/** The ranges of other workbooks that cell formulas, defined names and validation rules read, merged into the fewest requests that cover them. */
export function collectExternalRefs(wb: Workbook): ExternalWant[] {
  const found = new Map<string, ExternalWant>();
  for (const { f, by } of formulas(wb)) {
    let tree: Node;
    try {
      tree = parseFormula(f);
    } catch (e) {
      if (e instanceof FormulaSyntaxError) continue;
      throw e;
    }
    // A table of another workbook is asked for as the cells it stands for, once its place is known (externalTables).
    for (const t of tableRefsIn(f)) {
      const at = tableRefRange(t, wb);
      if (!at) continue;
      const key = `${at.book.toLowerCase()}|${at.sheet.toLowerCase()}|${at.range}`;
      const [a, z = a] = at.range.split(":");
      const p1 = parseCell(a!)!;
      const p2 = parseCell(z!)!;
      const want = found.get(key) ?? { book: at.book, sheet: at.sheet, range: at.range, by: [], count: (p2.row - p1.row + 1) * (p2.col - p1.col + 1) };
      if (!want.by.includes(by)) want.by.push(by);
      found.set(key, want);
    }
    for (const node of refsIn(tree)) {
      const split = node.sheet === undefined ? null : splitExternalSheet(node.sheet);
      if (!split) continue;
      const b = node.b ?? node.a;
      // A whole column or row is as large as the sheet: it can't be asked for.
      const r1 = Math.min(node.a.row ?? 1, b.row ?? 1048576);
      const r2 = Math.max(node.a.row ?? 1, b.row ?? 1048576);
      const c1 = Math.min(node.a.col ?? 1, b.col ?? 16384);
      const c2 = Math.max(node.a.col ?? 1, b.col ?? 16384);
      const range = r1 === r2 && c1 === c2 ? cellAddress(r1, c1) : `${cellAddress(r1, c1)}:${cellAddress(r2, c2)}`;
      const key = `${split.book.toLowerCase()}|${split.sheet.toLowerCase()}|${range}`;
      const want = found.get(key) ?? { book: split.book, sheet: split.sheet, range, by: [], count: (r2 - r1 + 1) * (c2 - c1 + 1) };
      if (!want.by.includes(by)) want.by.push(by);
      found.set(key, want);
    }
  }
  return [...found.values()];
}

/** The tables of other workbooks that formulas name (`[Prices.xlsx]Orders[Total]`): the workbook, the table, and the sheet when the formula names one. */
export function collectExternalTables(wb: Workbook): { book: string; table: string; sheet?: string }[] {
  const found = new Map<string, { book: string; table: string; sheet?: string }>();
  for (const { f } of formulas(wb))
    for (const t of tableRefsIn(f)) {
      const split = splitTableSheet(t.sheet)!;
      found.set(`${split.book.toLowerCase()}|${t.table!.toLowerCase()}`, { book: split.book, table: t.table!, ...(split.sheet ? { sheet: split.sheet } : {}) });
    }
  return [...found.values()];
}

/** The most cells a single request to the host may ask for. */
export const MAX_ASK = MAX_SNAPSHOT_ITEMS;

/** The part of a request after the workbook, as the host's resolver is given it: `Sheet1!A1:B3`, with the sheet quoted when it has to be. */
export function askPart(want: ExternalWant): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(want.sheet);
  const abs = want.range.split(":").map((a) => a.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2")).join(":");
  return `${plain ? want.sheet : `'${want.sheet.replace(/'/g, "''")}'`}!${abs}`;
}

/** The kept copy of a workbook, by name (without regard to capitals). */
export function findExternalBook(wb: Workbook, name: string): ExternalBook | undefined {
  return wb.externalBooks?.find((b) => b.name.toLowerCase() === name.toLowerCase());
}

/** The cells of `range` that the kept copy has, row by row (`null` for blank); undefined when the workbook or sheet was never read. */
export function keptCells(wb: Workbook, want: Pick<ExternalWant, "book" | "sheet" | "range">): (string | number | boolean | null)[] | undefined {
  const book = findExternalBook(wb, want.book);
  const key = book ? Object.keys(book.sheets).find((s) => s.toLowerCase() === want.sheet.toLowerCase()) : undefined;
  if (!book || key === undefined) return undefined;
  const cells = book.sheets[key]!;
  const [a, z = a] = want.range.split(":");
  const m1 = /^([A-Z]+)(\d+)$/.exec(a!)!;
  const m2 = /^([A-Z]+)(\d+)$/.exec(z!)!;
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const out: (string | number | boolean | null)[] = [];
  for (let r = Number(m1[2]); r <= Number(m2[2]); r++) for (let c = col(m1[1]!); c <= col(m2[1]!); c++) out.push(cells[`${colName(c)}${r}`] ?? null);
  return out;
}

/** Whether a formula reads a sheet of another workbook. */
export function formulaReadsOtherWorkbook(formula: string): boolean {
  if (!HINT.test(formula)) return false;
  try {
    return refsIn(parseFormula(formula)).some((n) => n.sheet !== undefined && splitExternalSheet(n.sheet) !== null) || tableRefsIn(formula).length > 0;
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return false;
    throw e;
  }
}
