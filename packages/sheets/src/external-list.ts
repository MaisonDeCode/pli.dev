import { parseRange, rangeAddress } from "./address";
import type { ListSnapshot } from "./model";

/*
 * Lists read from another workbook. A list rule whose source names a workbook, `[Prices.xlsx]Sheet1!$A$1:$A$10` (or
 * `'[Price list.xlsx]My sheet'!A1:A10`), gets its items from the host: it hands the session a resolver, which is asked for
 * the workbook's name and the part after it. What the resolver gives is kept in the rule as a snapshot (the items and the
 * day they were read), so that the list works again without the host, flagged as possibly out of date.
 */

/** A range in another workbook, taken apart. */
export interface ExternalRef {
  /** The workbook as the source names it: `Prices.xlsx`. */
  book: string;
  sheet: string;
  /** The cells, such as `A1:A10` (no `$`, upper case). */
  range: string;
}

/**
 * What a host supplies to read a list from another workbook: given the workbook's name and `Sheet1!$A$1:$A$10`, the cells'
 * values row by row, or null/undefined when it can't find them. It may answer later (a promise).
 */
export type ExternalListResolver = (book: string, ref: string) => ExternalListAnswer | Promise<ExternalListAnswer>;
export type ExternalListAnswer = readonly (string | number | boolean | null)[] | null | undefined;

/**
 * What a host supplies to find a table of another workbook (`[Prices.xlsx]Orders[Total]`): given the workbook's name and the
 * table's, where the table is (the sheet, the range with its header and totals rows, the names of its columns), or null/undefined
 * when it can't find it. The cells themselves are read through `ExternalListResolver`.
 */
export type ExternalTableResolver = (book: string, table: string) => ExternalTableAnswer | Promise<ExternalTableAnswer>;
export type ExternalTableAnswer = { sheet: string; range: string; columns: string[]; header?: false; totals?: true } | null | undefined;

const CELLS = String.raw`(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)`;
const PLAIN = new RegExp(String.raw`^\[([^\[\]]+)\]([^'!\[\]]+)!${CELLS}$`);
const QUOTED = new RegExp(String.raw`^'\[([^\[\]]+)\]((?:[^']|'')+)'!${CELLS}$`);

/** The workbook, sheet and cells a list source points at, or null when it doesn't name another workbook. */
export function parseExternalRef(source: string): ExternalRef | null {
  const text = source.trim().replace(/^=/, "");
  const m = QUOTED.exec(text) ?? PLAIN.exec(text);
  if (!m) return null;
  const quoted = text.startsWith("'");
  const sheet = quoted ? m[2]!.replace(/''/g, "'") : m[2]!;
  const bounds = parseRange(m[3]!.replace(/\$/g, "").toUpperCase());
  if (!bounds) return null;
  return { book: m[1]!, sheet, range: rangeAddress(bounds) };
}

/** A source written the way Excel writes it: `[Prices.xlsx]Sheet1!$A$1:$A$10`, quoted when a name has a space or other odd character. */
export function externalSourceText(ref: ExternalRef): string {
  const absolute = ref.range
    .split(":")
    .map((a) => a.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2"))
    .join(":");
  const plain = /^[A-Za-z0-9_.]+$/.test(ref.book) && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(ref.sheet);
  return plain ? `[${ref.book}]${ref.sheet}!${absolute}` : `'[${ref.book}]${ref.sheet.replace(/'/g, "''")}'!${absolute}`;
}

/** The part of a source after the workbook, as the resolver is given it: `Sheet1!$A$1:$A$10`. */
export function externalPart(ref: ExternalRef): string {
  const text = externalSourceText(ref);
  const at = text.indexOf("]");
  return (text.startsWith("'") ? "'" : "") + text.slice(at + 1);
}

/** What the resolver's answer is kept as: text for every cell, blanks as `""`. */
export function snapshotItems(answer: NonNullable<ExternalListAnswer>): string[] {
  return answer.slice(0, MAX_SNAPSHOT_ITEMS).map((v) => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v)));
}

export const MAX_SNAPSHOT_ITEMS = 10_000;

/** The items of a snapshot a list offers: the cells that weren't blank, in order. */
export function offered(snapshot: ListSnapshot | undefined): string[] {
  return (snapshot?.items ?? []).filter((s) => s !== "");
}

/** How a list read from another workbook stands. */
export interface ExternalListStatus {
  /** The workbook, and the sheet and cells in it. */
  book: string;
  ref: string;
  /** The items the list offers now. */
  items: string[];
  /**
   * `fresh`: the host read them in this session. `stale`: the snapshot kept in the workbook is used, because the host
   * has no way to read the workbook, couldn't find it, or hasn't been asked yet. `missing`: there is no snapshot either, so the list is empty.
   */
  state: "fresh" | "stale" | "missing";
  /** The day the items were read (the snapshot's), when known. */
  read?: string;
  /** Why a list is stale, in a sentence. */
  reason?: string;
}

/** The result of asking the host to read the external lists again. */
export interface ExternalRefresh {
  /** Lists whose items changed (and were stored). */
  updated: number;
  /** Lists read, with the same items as before. */
  unchanged: number;
  /** Lists, and cells that formulas read, that the host could not read, with why; the copy kept in the workbook stays in use. */
  failed: { sheet: string; id: string; book: string; reason: string; /** For cells that formulas, names and rules read: the sheet and cells asked for (`Sheet1!A1:B3`); `sheet` and `id` are empty then. */ ref?: string }[];
  /** There was no resolver to ask. */
  offline: boolean;
}

/** The day, `2026-11-09`, for a serial number of the workbook's clock (or now). */
export function readDay(serial: number | undefined): string {
  const date = serial === undefined ? new Date() : new Date(Math.round((serial - 25569) * 86400000));
  return date.toISOString().slice(0, 10);
}
