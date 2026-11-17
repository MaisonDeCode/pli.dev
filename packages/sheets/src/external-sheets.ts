import { PliError } from "@pli.dev/core";
import { parseCell } from "./address";
import { cleanExternalTables } from "./external-tables";
import type { ExternalBook, ExternalTable, Sheet } from "./model";

/*
 * Other workbooks as formulas see them. A reference such as `[Prices.xlsx]Sheet1!B2` reads a sheet called
 * `[Prices.xlsx]Sheet1`, which the calculator finds among these: one read-only sheet for every sheet of every
 * `Workbook.externalBooks` entry, holding the cells that were last read. They are never part of `Workbook.sheets`.
 */

const cache = new WeakMap<ExternalBook, Sheet[]>();

/** The name formulas use for a sheet of another workbook: `[Prices.xlsx]Sheet1`. */
export const externalSheetName = (book: string, sheet: string): string => `[${book}]${sheet}`;

/** The read-only sheets for the cells kept of a workbook. */
export function externalSheets(book: ExternalBook): Sheet[] {
  let sheets = cache.get(book);
  if (!sheets) {
    // A sheet with nothing kept of it is as good as unknown: formulas reading it give #REF!.
    sheets = Object.entries(book.sheets).filter(([, cells]) => Object.keys(cells).length > 0).map(([name, cells]) => ({
      id: `ext:${book.name.toLowerCase()}|${name.toLowerCase()}`,
      name: externalSheetName(book.name, name),
      cells: Object.fromEntries(Object.entries(cells).map(([address, v]) => [address, { v }])),
    }));
    cache.set(book, sheets);
  }
  return sheets;
}

/** Whether a sheet name (as a formula writes it) is one of another workbook. */
export const isExternalSheet = (name: string): boolean => name.startsWith("[");

const BOOK_NAME = /^[^\[\]\\/:*?"<>|]{1,200}$/;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** Most cells kept of all other workbooks together. */
export const MAX_EXTERNAL_CELLS = 200_000;

/** A workbook's cells made ready to keep: checks them and writes addresses in upper case. */
export function cleanExternalBook(book: ExternalBook): ExternalBook {
  if (!book || typeof book.name !== "string" || !BOOK_NAME.test(book.name)) bad("A workbook is named like Prices.xlsx");
  if (book.path !== undefined && (typeof book.path !== "string" || book.path.length > 2000)) bad("A workbook's path is text");
  if (book.read !== undefined && (typeof book.read !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(book.read))) bad("The day a workbook was read is written like 2026-11-09");
  if (!book.sheets || typeof book.sheets !== "object") bad("A workbook has sheets");
  const sheets: ExternalBook["sheets"] = {};
  for (const [name, cells] of Object.entries(book.sheets)) {
    if (!name || name.length > 31 || /[\[\]\\/:*?]/.test(name)) bad(`"${name}" can't be the name of a sheet`);
    const out: Record<string, string | number | boolean> = {};
    for (const [address, v] of Object.entries(cells ?? {})) {
      if (!parseCell(address)) bad(`"${address}" is not a cell address`);
      if (typeof v !== "string" && typeof v !== "boolean" && !(typeof v === "number" && Number.isFinite(v))) bad(`The cell ${address} of ${book.name} holds text, a number or true/false`);
      out[address.toUpperCase()] = v;
    }
    sheets[name] = out;
  }
  const tables = cleanExternalTables(book.tables);
  return { name: book.name, ...(book.path ? { path: book.path } : {}), ...(book.read ? { read: book.read } : {}), sheets, ...(tables ? { tables } : {}) };
}

/**
 * Puts cells into a workbook's kept copy of another workbook. `cells` maps addresses to values, or to null for a blank; the
 * book is made when it is new and dropped when nothing is left of it. Returns the new list and the operation that undoes this one.
 */
export function applyExternalCells(books: readonly ExternalBook[] | undefined, op: ExternalCellsOp): { books: ExternalBook[] | undefined; inverse: ExternalCellsOp } {
  const list = [...(books ?? [])];
  const at = list.findIndex((b) => b.name.toLowerCase() === op.book.toLowerCase());
  const old = at >= 0 ? list[at]! : undefined;
  const sheetKey = old ? Object.keys(old.sheets).find((s) => s.toLowerCase() === op.sheet.toLowerCase()) ?? op.sheet : op.sheet;
  const before = old?.sheets[sheetKey] ?? {};
  const cells: Record<string, string | number | boolean> = { ...before };
  const undo: Record<string, string | number | boolean | null> = {};
  for (const [raw, v] of Object.entries(op.cells)) {
    const address = raw.toUpperCase();
    if (!parseCell(address)) bad(`"${raw}" is not a cell address`);
    if (v !== null && typeof v !== "string" && typeof v !== "boolean" && !(typeof v === "number" && Number.isFinite(v))) bad(`The cell ${raw} holds text, a number or true/false`);
    undo[address] = before[address] ?? null;
    if (v === null || v === "") delete cells[address];
    else cells[address] = v;
  }
  const base: ExternalBook = old ?? { name: op.book, sheets: {} };
  const next = cleanExternalBook({
    ...base,
    ...(op.path !== undefined ? (op.path === null ? { path: undefined } : { path: op.path }) : {}),
    ...(op.read !== undefined ? (op.read === null ? { read: undefined } : { read: op.read }) : {}),
    sheets: { ...base.sheets, [sheetKey]: cells },
    ...(op.tables !== undefined ? { tables: op.tables === null ? undefined : op.tables } : {}),
  });
  if (at >= 0) list[at] = next;
  else list.push(next);
  const total = list.reduce((n, b) => n + Object.values(b.sheets).reduce((m, c) => m + Object.keys(c).length, 0), 0);
  if (total > MAX_EXTERNAL_CELLS) bad("That is more cells from other workbooks than a workbook keeps");
  return {
    books: list.length ? list : undefined,
    inverse: { type: "set_external_cells", book: op.book, sheet: sheetKey, cells: undo, path: old ? old.path ?? null : null, read: old ? old.read ?? null : null, ...(op.tables !== undefined ? { tables: old?.tables ?? null } : {}) },
  };
}

/** The operation that changes the kept cells of a sheet of another workbook; see `applyExternalCells`. */
export interface ExternalCellsOp {
  type: "set_external_cells";
  book: string;
  sheet: string;
  cells: Record<string, string | number | boolean | null>;
  /** The file's path; `null` takes it away. */
  path?: string | null;
  /** The day the cells were read; `null` takes it away. */
  read?: string | null;
  /** The tables of the workbook that formulas name (replacing the ones kept); `null` takes them away. */
  tables?: ExternalTable[] | null;
}
