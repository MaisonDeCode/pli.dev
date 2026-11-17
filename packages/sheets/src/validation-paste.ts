import { cellAddress, type Bounds } from "./address";
import { Calculator, type CalculatorOptions } from "./calc";
import type { Sheet, Validation, Workbook } from "./model";
import { ruleBounds } from "./rule";
import { isError } from "./values";
import { entryAllowed, problemOf } from "./validation";

/*
 * Checking what a paste (or a move, a fill, a sort) puts in cells that have a data validation.
 *
 * Excel doesn't: only typing is checked, and "Circle invalid data" finds the rest. Pli keeps that as the default (`off`)
 * and can check on request: `warn` puts everything in and reports the cells that break their rule; `refuse` also keeps
 * what a cell had when the new content breaks a rule whose alert is `stop`.
 */

/** What to do about cells a paste brings in that break the rule that covers them. */
export type ValidatePaste = "off" | "warn" | "refuse";

export type PasteAction = "paste" | "copy" | "move" | "fill" | "sort";

/** One cell that broke its rule. */
export interface PasteProblem {
  address: string;
  /** How the rule treats a bad entry: `stop` is the one that can be refused. */
  alert: "stop" | "warning" | "information";
  title: string;
  message: string;
  /** What the cell holds (worked out, if it is a formula), as text. */
  value: string;
}

/** What a checked paste, move, fill or sort found. */
export interface PasteReport {
  action: PasteAction;
  mode: "warn" | "refuse";
  sheet: string;
  /** The cells the operation wrote, such as `B2:B9`. */
  range: string;
  /** Every cell that breaks its rule (in `refuse` mode, the refused ones included). */
  invalid: PasteProblem[];
  /** Cells that kept what they had because the new content was refused (`refuse` mode, cells at a time). */
  refused: string[];
  /** Nothing was done: the operation can't be done in part (a move, a sort), and some cell would break a rule. */
  cancelled: boolean;
}

/** What an operation tells the check about itself. */
export interface PasteContext {
  action: PasteAction;
  /** The id of the sheet that is written. */
  sheet: string;
  /** The cells written. */
  bounds: Bounds;
  /** The operation can't be done in part: it is refused as a whole if a cell breaks a stop rule. */
  whole?: boolean;
  /** A copy or move: where the cells came from, so a cell that was already invalid there isn't blamed again. */
  from?: { sheet: string; dRow: number; dCol: number };
  /** A sort: values that were invalid in the range before are only moved about, so they aren't blamed again. */
  samePlace?: boolean;
}

const coveringRule = (sheet: Sheet, row: number, col: number): Validation | undefined => sheet.validations?.find((r) => ruleBounds(r.ranges).some((b) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2));

const textOfValue = (v: unknown): string => (typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));

/** Whether a cell, as the workbook has it, holds something its rule refuses (blank and error cells are left alone, as "Circle invalid data" does). */
export function breaksRule(calc: Calculator, sheet: Sheet, row: number, col: number): Validation | null {
  const rule = coveringRule(sheet, row, col);
  if (!rule) return null;
  const v = calc.value(sheet.id, cellAddress(row, col));
  if (v === null || v === "" || isError(v)) return null;
  return entryAllowed(rule, v as number | string | boolean, { calc, sheet, row, col }) ? null : rule;
}

/**
 * The cells of `bounds` in `state` that break the rule that covers them. `only` limits the check to some addresses (when the
 * area is large and few cells were written); `skip` leaves cells out.
 */
export function pasteProblems(state: Workbook, options: CalculatorOptions, sheetId: string, bounds: Bounds, only: Iterable<string> | null, skip: (row: number, col: number, value: string) => boolean): PasteProblem[] {
  const sheet = state.sheets.find((s) => s.id === sheetId);
  if (!sheet?.validations?.length) return [];
  const calc = new Calculator(state, options);
  const out: PasteProblem[] = [];
  const consider = (row: number, col: number) => {
    if (row < bounds.r1 || row > bounds.r2 || col < bounds.c1 || col > bounds.c2) return;
    const rule = breaksRule(calc, sheet, row, col);
    if (!rule) return;
    const value = textOfValue(calc.value(sheet.id, cellAddress(row, col)));
    if (skip(row, col, value)) return;
    const problem = problemOf(rule);
    if (!problem) return; // an alert of "none" lets anything in
    out.push({ address: cellAddress(row, col), alert: problem.alert, title: problem.title, message: problem.message, value });
  };
  if (only) {
    for (const address of only) {
      const m = /^([A-Z]+)(\d+)$/.exec(address);
      if (m) consider(Number(m[2]), [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0));
    }
  } else {
    for (let r = bounds.r1; r <= bounds.r2; r++) for (let c = bounds.c1; c <= bounds.c2; c++) consider(r, c);
  }
  return out;
}

/** A sentence about a report, for the notice a grid shows. */
export function describePasteReport(report: PasteReport): string {
  const n = report.invalid.length;
  const cells = (list: string[]) => (list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`);
  const things = (k: number) => (k === 1 ? "1 cell" : `${k} cells`);
  const verb = { paste: "pasted", copy: "copied", move: "moved", fill: "filled", sort: "sorted" }[report.action];
  if (report.cancelled) return `Nothing was ${verb}: ${things(report.refused.length)} would break a data validation rule (${cells(report.refused)}).`;
  if (report.refused.length) {
    const kept = report.invalid.length - report.refused.length;
    return `${things(report.refused.length)} kept what ${report.refused.length === 1 ? "it" : "they"} had, because the ${verb} content broke a data validation rule (${cells(report.refused)}).${kept > 0 ? ` ${things(kept)} more break a rule that only warns.` : ""}`;
  }
  return `${things(n)} ${verb} break${n === 1 ? "s" : ""} a data validation rule (${cells(report.invalid.map((p) => p.address))}). Data > Circle invalid data shows ${n === 1 ? "it" : "them"}.`;
}
