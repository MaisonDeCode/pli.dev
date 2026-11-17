import { DIV0, NUM, VALUE, isError, toText, type ErrorValue, type Value } from "../values";
import { criterion, scalar, toGrid } from "./helpers";
import type { Arg, Ctx, FunctionDef } from "./types";

/*
 * The database functions (`DSUM`, `DAVERAGE`, `DGET`…): a table with its headings in the first row, a field to work on, and a
 * block of criteria. The criteria block has headings too; every row under them is a way to pass (they are joined by or), and
 * the cells in a row all have to pass (and). A cell with plain text matches the cells that begin with it, `=text` the ones
 * that are exactly it, and `>5`, `<>x` and the other comparisons work as in `COUNTIF`. An empty cell asks nothing.
 */

/** A test for one cell of the criteria block. Plain text asks for cells that begin with it, as the database functions do. */
function cellTest(crit: Value): ((v: Value) => boolean) | null {
  if (crit === null || crit === "") return null;
  if (typeof crit === "string" && !/^(<=|>=|<>|<|>|=)/.test(crit) && Number.isNaN(Number(crit)) && !/^(true|false)$/i.test(crit)) return criterion(crit + "*");
  return criterion(crit);
}

const headingOf = (v: Value): string => String(toText(v) ?? "").trim().toLowerCase();

/** The column of the database a field names: its heading, or its number (the first column is 1). */
function fieldColumn(field: Value, headings: readonly string[]): number | ErrorValue {
  if (isError(field)) return field;
  if (typeof field === "number") return Number.isInteger(field) && field >= 1 && field <= headings.length ? field - 1 : VALUE;
  const at = headings.indexOf(headingOf(field));
  return at < 0 ? VALUE : at;
}

/** The records of the database that pass the criteria, as rows of values. */
function records(db: Value[][], criteria: Value[][]): Value[][] {
  const headings = (db[0] ?? []).map(headingOf);
  const rows = db.slice(1);
  const heads = (criteria[0] ?? []).map(headingOf);
  const groups = criteria.slice(1).map((row) =>
    row.flatMap((crit, i) => {
      const test = cellTest(crit);
      if (!test) return [];
      // A heading that isn't a column asks for something that nothing has (a blank one stands for a formula, which isn't read).
      if (heads[i] === "") return [];
      const at = headings.indexOf(heads[i]!);
      return [{ at, test }];
    }),
  );
  if (!groups.length) return rows;
  return rows.filter((rec) => groups.some((g) => g.every((c) => c.at >= 0 && c.test(rec[c.at] ?? null))));
}

interface Selection {
  records: Value[][];
  column: number;
}

function select(args: Arg[], ctx: Ctx, optionalField = false): Selection | ErrorValue {
  const db = toGrid(args[0]!, ctx);
  const criteria = toGrid(args[2]!, ctx);
  if (db.length < 1 || !criteria.length) return VALUE;
  const headings = (db[0] ?? []).map(headingOf);
  const field = args[1] === undefined ? null : scalar(args[1] as Arg, ctx);
  let column = -1;
  if (!(optionalField && (field === null || field === ""))) {
    const c = fieldColumn(field as Value, headings);
    if (typeof c !== "number") return c;
    column = c;
  }
  return { records: records(db, criteria), column };
}

/** The numbers in the field of the selected records, or the first error there. */
function numbers(sel: Selection): number[] | ErrorValue {
  const out: number[] = [];
  for (const rec of sel.records) {
    const v = rec[sel.column] ?? null;
    if (isError(v)) return v;
    if (typeof v === "number") out.push(v);
  }
  return out;
}

function variance(xs: number[], sample: boolean): number {
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
  return xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (sample ? xs.length - 1 : xs.length);
}

function database(fn: (xs: number[]) => Value): FunctionDef {
  return {
    min: 3,
    max: 3,
    fn: (args, ctx) => {
      const sel = select(args as Arg[], ctx);
      if (isError(sel) && !("records" in sel)) return sel;
      const xs = numbers(sel as Selection);
      return isError(xs) ? xs : fn(xs);
    },
  };
}

export const databaseFunctions: Record<string, FunctionDef> = {
  DSUM: database((xs) => xs.reduce((a, x) => a + x, 0)),
  DAVERAGE: database((xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : DIV0)),
  DMAX: database((xs) => (xs.length ? Math.max(...xs) : 0)),
  DMIN: database((xs) => (xs.length ? Math.min(...xs) : 0)),
  DPRODUCT: database((xs) => (xs.length ? xs.reduce((a, x) => a * x, 1) : 0)),
  DSTDEV: database((xs) => (xs.length < 2 ? DIV0 : Math.sqrt(variance(xs, true)))),
  DSTDEVP: database((xs) => (xs.length < 1 ? DIV0 : Math.sqrt(variance(xs, false)))),
  DVAR: database((xs) => (xs.length < 2 ? DIV0 : variance(xs, true))),
  DVARP: database((xs) => (xs.length < 1 ? DIV0 : variance(xs, false))),
  DCOUNT: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      // `DCOUNT(database, criteria)` counts the records; with a field, the numbers in it.
      const a = args.length === 2 ? [args[0], undefined, args[1]] : args;
      const sel = select(a as Arg[], ctx, true);
      if ("records" in sel === false) return sel as ErrorValue;
      const s = sel as Selection;
      if (s.column < 0) return s.records.length;
      return s.records.filter((r) => typeof r[s.column] === "number").length;
    },
  },
  DCOUNTA: {
    min: 2,
    max: 3,
    fn: (args, ctx) => {
      const a = args.length === 2 ? [args[0], undefined, args[1]] : args;
      const sel = select(a as Arg[], ctx, true);
      if ("records" in sel === false) return sel as ErrorValue;
      const s = sel as Selection;
      if (s.column < 0) return s.records.length;
      return s.records.filter((r) => r[s.column] !== null && r[s.column] !== undefined && r[s.column] !== "").length;
    },
  },
  DGET: {
    min: 3,
    max: 3,
    fn: (args, ctx) => {
      const sel = select(args as Arg[], ctx);
      if ("records" in sel === false) return sel as ErrorValue;
      const s = sel as Selection;
      if (s.records.length === 0) return VALUE;
      if (s.records.length > 1) return NUM;
      return s.records[0]![s.column] ?? null;
    },
  },
};
