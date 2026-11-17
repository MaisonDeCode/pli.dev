import { PliError } from "@pli.dev/core";
import { externalSourceText, parseExternalRef, type ExternalRef } from "./external-list";
import type { DataBlock, Scalar, Workbook } from "./model";

/*
 * Pivot data from outside the workbook. A pivot table's `source` can name
 *   - a range of another workbook, `[Prices.xlsx]Sheet1!$A$1:$D$20` (what Excel writes for a pivot table over a closed workbook),
 *   - a named block of rows, `data:Sales`, which the host supplies or a CSV file filled.
 * Either way the rows are kept in the workbook as a `DataBlock` (the cache Excel keeps in the pivot table), so the pivot
 * table works without the host; refreshing asks the host again, through the session's `pivotData` resolver.
 */

/** The source name a pivot table with the data model uses (Excel's own name for it). */
export const MODEL_SOURCE = "ThisWorkbookDataModel";

export const isModelSource = (source: string): boolean => source.trim().toLowerCase() === MODEL_SOURCE.toLowerCase();

const NAMED = /^data:\s*(.+)$/i;

/** The name of a `data:Name` source, or null. */
export function dataName(source: string): string | null {
  const m = NAMED.exec(source.trim());
  return m ? m[1]!.trim() : null;
}

/** A source that names data outside the workbook, taken apart; null for a range, a table or the data model. */
export function externalOf(source: string): { kind: "book"; ref: ExternalRef } | { kind: "data"; name: string } | null {
  const name = dataName(source);
  if (name !== null) return name === "" ? null : { kind: "data", name };
  const ref = parseExternalRef(source);
  return ref ? { kind: "book", ref } : null;
}

export const isExternalSource = (source: string): boolean => externalOf(source) !== null;

/** A source as it is kept: `[Prices.xlsx]Sheet1!$A$1:$D$20` or `data:Sales`; null if it isn't one of those. */
export function externalSourceName(source: string): string | null {
  const e = externalOf(source);
  if (!e) return null;
  return e.kind === "data" ? `data:${e.name}` : externalSourceText(e.ref);
}

/** The block that holds the rows of an external source. */
export function findBlock(wb: Pick<Workbook, "dataBlocks">, source: string): DataBlock | undefined {
  const key = externalSourceName(source)?.toLowerCase();
  return key === undefined ? undefined : wb.dataBlocks?.find((b) => externalSourceName(b.source)?.toLowerCase() === key);
}

export const MAX_BLOCK_ROWS = 1_048_576;
export const MAX_BLOCK_COLUMNS = 16_384;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A block made ready to keep, or an error that says what is wrong with it. */
export function cleanBlock(b: DataBlock): DataBlock {
  if (!b || typeof b !== "object") return bad("A data block is an object with a source and rows");
  if (typeof b.source !== "string") return bad("A data block needs a source: `data:Name`, or a range of another workbook such as `[Prices.xlsx]Sheet1!$A$1:$D$20`");
  const name = externalSourceName(b.source);
  if (name === null) return bad(`"${b.source}" isn't a data block's source: use data:Name, or a range of another workbook such as [Prices.xlsx]Sheet1!$A$1:$D$20`);
  if (!Array.isArray(b.rows)) return bad("A data block's rows are a list of rows");
  if (b.rows.length > MAX_BLOCK_ROWS) return bad("A data block has too many rows");
  let width = 0;
  const rows = b.rows.map((row) => {
    if (!Array.isArray(row)) return bad("Each row of a data block is a list of values");
    if (row.length > MAX_BLOCK_COLUMNS) return bad("A data block has too many columns");
    width = Math.max(width, row.length);
    return row.map((v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      if (typeof v === "string" || typeof v === "boolean") return v;
      return bad("A data block holds text, numbers, true or false, and empty cells");
    }) as (Scalar | null)[];
  });
  // Rows are as wide as the widest, so a header can be matched with its columns.
  for (const row of rows) while (row.length < width) row.push(null);
  const out: DataBlock = { source: name, rows };
  if (b.formats !== undefined) {
    if (!Array.isArray(b.formats) || !b.formats.every((f) => typeof f === "string")) bad("A data block's number formats are a list of text, one for each column");
    if (b.formats.some((f) => f !== "")) out.formats = [...b.formats];
  }
  if (b.from !== undefined) {
    if (b.from !== "csv" && b.from !== "host" && b.from !== "book") bad("A data block comes from csv, host or book");
    out.from = b.from;
  }
  if (b.path !== undefined && b.path !== "") {
    if (typeof b.path !== "string" || b.path.length > 2000) bad("A data block's path is text");
    out.path = b.path;
  }
  if (b.read !== undefined) {
    if (typeof b.read !== "string" || !/^\d{4}-\d\d-\d\d$/.test(b.read)) bad("A data block's day is written 2026-11-10");
    out.read = b.read;
  }
  return out;
}

/** The list of blocks with this one added or replacing the one with the same source (`null` removes it). */
export function withBlock(list: readonly DataBlock[] | undefined, source: string, block: DataBlock | null): DataBlock[] {
  const key = externalSourceName(source)?.toLowerCase();
  const rest = (list ?? []).filter((b) => externalSourceName(b.source)?.toLowerCase() !== key);
  if (block === null) return rest;
  const at = (list ?? []).findIndex((b) => externalSourceName(b.source)?.toLowerCase() === key);
  if (at < 0) return [...rest, block];
  rest.splice(at, 0, block);
  return rest;
}

// ---- what the host supplies ----

/** What a pivot table's source asks the host for. */
export interface PivotDataRequest {
  /** The source as the pivot table names it. */
  source: string;
  kind: "book" | "data";
  /** The file name of the workbook (`Prices.xlsx`), or the name of the block (`Sales`). */
  name: string;
  /** For `book`: the sheet and the cells (`A1:D20`, no `$`). */
  sheet?: string;
  range?: string;
  /** Where the workbook says the file is (a path or an address), when it does. */
  path?: string;
}

/** The rows a host answers with, the first holding the field names. */
export type PivotDataRows = readonly (readonly (Scalar | null | undefined)[])[];

/**
 * What a host answers a request with: the rows (the first holding the field names), perhaps with a number format for each
 * column, or CSV text. Null or undefined says it can't find it.
 */
export type PivotDataAnswer = PivotDataRows | { rows: PivotDataRows; formats?: readonly string[] } | { csv: string; delimiter?: string } | null | undefined;

/**
 * Lets a host supply the data of pivot tables that read outside the workbook. It is given the request, and may answer
 * later (a promise).
 *
 * ```ts
 * session.pivotData = async ({ kind, name, sheet, range }) => {
 *   if (kind === "data" && name === "Sales") return { csv: await (await fetch("/exports/sales.csv")).text() };
 *   if (kind === "book") return rowsFromYourFileStore(name, sheet, range);
 *   return null;
 * };
 * ```
 */
export type PivotDataResolver = (request: PivotDataRequest) => PivotDataAnswer | Promise<PivotDataAnswer>;

/** The request that reads an external source. */
export function requestOf(source: string, block?: Pick<DataBlock, "path">): PivotDataRequest | null {
  const e = externalOf(source);
  if (!e) return null;
  const path = block?.path;
  if (e.kind === "data") return { source: `data:${e.name}`, kind: "data", name: e.name, ...(path ? { path } : {}) };
  return { source: externalSourceText(e.ref), kind: "book", name: e.ref.book, sheet: e.ref.sheet, range: e.ref.range, ...(path ? { path } : {}) };
}

/** The sheet and the cells of an external workbook source, or null for the other kind. */
export function bookPart(source: string): { book: string; sheet: string; range: string } | null {
  const e = externalOf(source);
  return e?.kind === "book" ? { book: e.ref.book, sheet: e.ref.sheet, range: e.ref.range } : null;
}
