import { PliError } from "@pli.dev/core";
import type { DataModel, ErrorCode, ModelMeasure, ModelRelationship, ModelTable } from "./model";
import { needsContext, parseContextMeasure, type ContextMeasure } from "./pivot-dax";
import { isError, type Value } from "./values";

/*
 * The data model: several tables with relationships between them, and measures over them. A pivot table whose source is
 * `ThisWorkbookDataModel` reads fields called `Table[Column]` from any of the tables.
 *
 * How it is worked out: every row of every table becomes one record of a single wide source. A row carries its own table's
 * columns and, by following the relationships from its many side to the one side (and on, through chains of them), the
 * columns of the tables it looks up. Pivot tables then sum that source as they sum any other: a record only has numbers in the
 * columns of its own table, so `SUM(Orders[Amount])` counts only order rows, while `Customers[Region]` on the rows is
 * known to every order row through the relationship. Only the tables a pivot table's values read give it records, so
 * customers without orders do not appear (Excel hides them too).
 *
 * Measures are DAX-style expressions over those columns: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, DISTINCTCOUNT, COUNTROWS,
 * DIVIDE, ABS, ROUND, SQRT, other measures in [brackets], numbers, + - * / ^ and brackets. They are worked out for the records
 * of each cell of the pivot table.
 *
 * A measure that uses CALCULATE, a filter function (ALL, FILTER, VALUES…), IF, an iterator (SUMX…) or a time function
 * (TOTALYTD, SAMEPERIODLASTYEAR…), or another measure that does, is worked out over the filters of the cell instead (see
 * pivot-dax.ts).
 */

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** The name of the hidden field that counts the rows of a table: `COUNTROWS(Orders)` sums it. */
export const rowsField = (table: string): string => `${table}[#Rows]`;

/** The field name of a column of a table. */
export const columnField = (table: string, column: string): string => `${table}[${column}]`;

// ---- measures ----

export type AggregateFn = "sum" | "count" | "countNums" | "average" | "max" | "min" | "distinctCount";

/** One thing a measure adds up: a function over a field of the wide source. */
export interface MeasureRef {
  fn: AggregateFn;
  field: string;
}

export interface CompiledMeasure {
  name: string;
  fmt?: string;
  refs: MeasureRef[];
  /** The tables its columns are in. */
  tables: string[];
  /** Works the measure out, given what each of its `refs` comes to (undefined: nothing to add up). */
  run(get: (ref: MeasureRef) => number | ErrorCode | undefined): number | ErrorCode | undefined;
  /** For a measure that works in the filters of a cell: it is worked out over the model's rows, not from `refs`. */
  ctx?: ContextMeasure;
}

type Tok = { t: "num"; s: string } | { t: "name"; s: string } | { t: "br"; s: string } | { t: "op"; s: string };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (/\s/.test(ch)) i++;
    else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
      if (!m) return bad(`"${text}" has a number that doesn't read`);
      out.push({ t: "num", s: m[0] });
      i += m[0].length;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return bad(`"${text}" has a table name that isn't closed with '`);
      out.push({ t: "name", s: text.slice(i + 1, end) });
      i = end + 1;
    } else if (ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end < 0) return bad(`"${text}" has a [ that isn't closed`);
      out.push({ t: "br", s: text.slice(i + 1, end) });
      i = end + 1;
    } else if (/[A-Za-z_À-￿]/.test(ch)) {
      const m = /^[A-Za-z0-9_.À-￿]+/.exec(text.slice(i))!;
      out.push({ t: "name", s: m[0] });
      i += m[0].length;
    } else if ("+-*/^(),".includes(ch)) {
      out.push({ t: "op", s: ch });
      i++;
    } else return bad(`"${text}" has "${ch}", which a measure can't use`);
  }
  return out;
}

const AGGREGATES: Record<string, AggregateFn> = { SUM: "sum", AVERAGE: "average", MIN: "min", MAX: "max", COUNT: "countNums", COUNTA: "count", DISTINCTCOUNT: "distinctCount" };
type Get = (ref: MeasureRef) => number | ErrorCode | undefined;
type Node = (get: Get) => number | ErrorCode | undefined;

const num = (v: number | ErrorCode | undefined): number | ErrorCode => (v === undefined ? 0 : v);
function arith(a: number | ErrorCode | undefined, b: number | ErrorCode | undefined, f: (x: number, y: number) => number): number | ErrorCode {
  const x = num(a);
  const y = num(b);
  if (typeof x === "string") return x;
  if (typeof y === "string") return y;
  const r = f(x, y);
  return Number.isFinite(r) ? r : "#NUM!";
}

/**
 * Reads a measure's expression. `table` finds a table by name (case does not matter) and `measure` finds the compiled form of
 * another measure it names in brackets. Throws if the expression is not one a measure can be.
 */
export function parseMeasure(m: Pick<ModelMeasure, "name" | "expression" | "fmt">, tableName: (name: string) => string | undefined, measure: (name: string) => CompiledMeasure | undefined, expressionOf?: (name: string) => string | undefined): CompiledMeasure {
  const text = m.expression.trim().replace(/^=/, "");
  if (expressionOf && needsContext(text, (name) => measure(name)?.ctx !== undefined)) {
    const ctx = parseContextMeasure(m, tableName, expressionOf);
    return { name: m.name, ...(m.fmt ? { fmt: m.fmt } : {}), refs: [], tables: ctx.tables, run: () => undefined, ctx };
  }
  const tokens = tokenize(text);
  if (!tokens.length) bad(`The measure "${m.name}" needs an expression`);
  const refs: MeasureRef[] = [];
  const tables = new Set<string>();
  let at = 0;
  const peek = () => tokens[at];
  const eat = (s: string) => (peek()?.t === "op" && peek()!.s === s ? (at++, true) : false);
  const addRef = (fn: AggregateFn, table: string, column: string): Node => {
    const real = tableName(table) ?? bad(`The measure "${m.name}" uses ${table}, which isn't a table of the model`);
    const ref: MeasureRef = { fn, field: fn === "sum" && column === "#Rows" ? rowsField(real) : `${real}[${column}]` };
    tables.add(real);
    if (!refs.some((r) => r.fn === ref.fn && r.field === ref.field)) refs.push(ref);
    return (get) => get(ref);
  };
  /** `Table[Column]` or `'Table name'[Column]`, the argument of an aggregate. */
  const column = (): { table: string; column: string } | null => {
    const t = tokens[at];
    const b = tokens[at + 1];
    if (t?.t === "name" && b?.t === "br") {
      at += 2;
      return { table: t.s, column: b.s };
    }
    return null;
  };
  const expr = (): Node => {
    let left = term();
    for (;;) {
      if (eat("+")) {
        const a = left;
        const b = term();
        left = (g) => arith(a(g), b(g), (x, y) => x + y);
      } else if (eat("-")) {
        const a = left;
        const b = term();
        left = (g) => arith(a(g), b(g), (x, y) => x - y);
      } else return left;
    }
  };
  const term = (): Node => {
    let left = unary();
    for (;;) {
      if (eat("*")) {
        const a = left;
        const b = unary();
        left = (g) => arith(a(g), b(g), (x, y) => x * y);
      } else if (eat("/")) {
        const a = left;
        const b = unary();
        left = (g) => {
          const y = num(b(g));
          return y === 0 ? "#DIV/0!" : arith(a(g), y, (p, q) => p / q);
        };
      } else return left;
    }
  };
  const unary = (): Node => {
    if (eat("-")) {
      const a = unary();
      return (g) => arith(a(g), 0, (x) => -x);
    }
    if (eat("+")) return unary();
    const base = atom();
    if (eat("^")) {
      const b = unary();
      return (g) => arith(base(g), b(g), (x, y) => x ** y);
    }
    return base;
  };
  const args = (): Node[] => {
    const list: Node[] = [];
    if (eat(")")) return list;
    do list.push(expr());
    while (eat(","));
    if (!eat(")")) bad(`The measure "${m.name}" has a ( that isn't closed`);
    return list;
  };
  const atom = (): Node => {
    const t = tokens[at++];
    if (!t) return bad(`The measure "${m.name}" stops where a value should be`);
    if (t.t === "num") {
      const n = Number(t.s);
      return () => n;
    }
    if (t.t === "br") {
      // Another measure.
      const other = measure(t.s) ?? bad(`The measure "${m.name}" uses [${t.s}], which isn't a measure of the model`);
      for (const r of other.refs) if (!refs.some((x) => x.fn === r.fn && x.field === r.field)) refs.push(r);
      other.tables.forEach((x) => tables.add(x));
      return (g) => other.run(g);
    }
    if (t.t === "op" && t.s === "(") {
      const e = expr();
      if (!eat(")")) return bad(`The measure "${m.name}" has a ( that isn't closed`);
      return e;
    }
    if (t.t === "name") {
      const fname = t.s.toUpperCase();
      if (!eat("(")) {
        // A bare `Table[Column]` outside an aggregate has no single value.
        return bad(`The measure "${m.name}" uses ${t.s} on its own: wrap a column in SUM, AVERAGE, MIN, MAX, COUNT or DISTINCTCOUNT`);
      }
      if (AGGREGATES[fname]) {
        const col = column();
        if (col) {
          if (!eat(")")) bad(`The measure "${m.name}" has a ( that isn't closed`);
          return addRef(AGGREGATES[fname]!, col.table, col.column);
        }
        if (fname === "MIN" || fname === "MAX") {
          const list = args();
          if (list.length < 2) return bad(`${fname} in "${m.name}" takes a column, or two values to compare`);
          return (g) => {
            const xs = list.map((n) => num(n(g)));
            const err = xs.find((x): x is ErrorCode => typeof x === "string");
            if (err) return err;
            return fname === "MIN" ? Math.min(...(xs as number[])) : Math.max(...(xs as number[]));
          };
        }
        return bad(`${fname} in "${m.name}" takes a column such as Orders[Amount]`);
      }
      if (fname === "COUNTROWS") {
        const tn = tokens[at];
        if (tn?.t !== "name") return bad(`COUNTROWS in "${m.name}" takes a table's name`);
        at++;
        if (!eat(")")) bad(`The measure "${m.name}" has a ( that isn't closed`);
        return addRef("sum", tn.s, "#Rows");
      }
      const list = args();
      const one = (name: string, f: (x: number) => number): Node => {
        if (list.length !== 1) return bad(`${name} in "${m.name}" takes one value`);
        return (g) => arith(list[0]!(g), 0, (x) => f(x));
      };
      switch (fname) {
        case "DIVIDE": {
          if (list.length < 2 || list.length > 3) return bad(`DIVIDE in "${m.name}" takes a numerator, a denominator and perhaps what to give for zero`);
          return (g) => {
            const d = num(list[1]!(g));
            if (typeof d === "string") return d;
            if (d === 0) return list[2] ? list[2](g) : undefined;
            return arith(list[0]!(g), d, (x, y) => x / y);
          };
        }
        case "ABS":
          return one("ABS", Math.abs);
        case "SQRT":
          return one("SQRT", Math.sqrt);
        case "ROUND": {
          if (list.length !== 2) return bad(`ROUND in "${m.name}" takes a value and a number of digits`);
          return (g) => arith(list[0]!(g), list[1]!(g), (x, d) => Math.round(x * 10 ** d) / 10 ** d);
        }
        default:
          return bad(`The measure "${m.name}" calls ${t.s}( ), which a measure doesn't have. It has SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, DISTINCTCOUNT, COUNTROWS, DIVIDE, ABS, ROUND and SQRT`);
      }
    }
    return bad(`The measure "${m.name}" has "${t.s}" where a value should be`);
  };
  const run = expr();
  if (at < tokens.length) bad(`The measure "${m.name}" has "${tokens[at]!.s}" in a place it can't be`);
  return { name: m.name, ...(m.fmt ? { fmt: m.fmt } : {}), refs, tables: [...tables], run };
}

/** Every measure of a model, compiled. A measure that names a missing table or measure, or loops back to itself, throws. */
export function compileMeasures(model: DataModel): Map<string, CompiledMeasure> {
  const tableOf = (name: string) => model.tables.find((t) => t.name.toLowerCase() === name.toLowerCase())?.name;
  const expressionOf = (name: string) => model.measures.find((x) => x.name.toLowerCase() === name.toLowerCase())?.expression.trim().replace(/^=/, "");
  const out = new Map<string, CompiledMeasure>();
  const busy = new Set<string>();
  const get = (name: string): CompiledMeasure | undefined => {
    const key = name.toLowerCase();
    const done = out.get(key);
    if (done) return done;
    const m = model.measures.find((x) => x.name.toLowerCase() === key);
    if (!m) return undefined;
    if (busy.has(key)) return bad(`The measure "${m.name}" uses itself`);
    busy.add(key);
    const c = parseMeasure(m, tableOf, get, expressionOf);
    busy.delete(key);
    out.set(key, c);
    return c;
  };
  for (const m of model.measures) get(m.name);
  return out;
}

// ---- checking ----

const NAME = /^[^\[\]'\u0000-\u001f]+$/;

/** A model made ready to keep, or an error that says what is wrong with it. */
export function cleanModel(m: DataModel): DataModel {
  if (!m || typeof m !== "object") return bad("A data model is an object with tables, relationships and measures");
  if (!Array.isArray(m.tables)) return bad("A data model lists its tables");
  const tables: ModelTable[] = [];
  const names = new Set<string>();
  for (const t of m.tables) {
    if (!t || typeof t.name !== "string" || !NAME.test(t.name.trim()) || t.name.trim().length > 100) return bad("A table of the data model needs a name (no brackets or quotes)");
    if (typeof t.source !== "string" || t.source.trim() === "") return bad(`The table "${t.name}" needs a source: a range, a table or a data block`);
    const name = t.name.trim();
    if (names.has(name.toLowerCase())) bad(`There are two tables called "${name}"`);
    names.add(name.toLowerCase());
    tables.push({ name, source: t.source.trim() });
  }
  if (!tables.length) bad("A data model needs a table");
  const relationships: ModelRelationship[] = [];
  const seen = new Set<string>();
  for (const r of m.relationships ?? []) {
    const side = (s: ModelRelationship["from"], what: string) => {
      if (!s || typeof s.table !== "string" || typeof s.column !== "string" || s.column === "") return bad(`A relationship names the table and column on its ${what} side`);
      const t = tables.find((x) => x.name.toLowerCase() === s.table.toLowerCase());
      if (!t) return bad(`A relationship names ${s.table}, which isn't a table of the model`);
      return { table: t.name, column: s.column };
    };
    const from = side(r.from, "many");
    const to = side(r.to, "one");
    if (from.table === to.table) bad(`A relationship joins two different tables, not ${from.table} to itself`);
    const key = `${from.table}\u0000${from.column}\u0000${to.table}\u0000${to.column}`.toLowerCase();
    if (seen.has(key)) bad(`The relationship ${from.table}[${from.column}] to ${to.table}[${to.column}] is there twice`);
    seen.add(key);
    relationships.push({ from, to });
  }
  const measures: ModelMeasure[] = [];
  const measureNames = new Set<string>();
  for (const x of m.measures ?? []) {
    if (!x || typeof x.name !== "string" || !NAME.test(x.name.trim()) || x.name.trim().length > 100) return bad("A measure needs a name (no brackets or quotes)");
    if (typeof x.expression !== "string") return bad(`The measure "${x.name}" needs an expression`);
    const name = x.name.trim();
    if (measureNames.has(name.toLowerCase())) bad(`There are two measures called "${name}"`);
    if (names.has(name.toLowerCase())) bad(`The measure "${name}" has the name of a table`);
    measureNames.add(name.toLowerCase());
    const table = tables.find((t) => t.name.toLowerCase() === String(x.table).toLowerCase());
    if (!table) return bad(`The measure "${name}" belongs to ${String(x.table)}, which isn't a table of the model`);
    if (x.fmt !== undefined && typeof x.fmt !== "string") bad("A number format is text");
    measures.push({ name, table: table.name, expression: x.expression.trim().replace(/^=/, ""), ...(x.fmt ? { fmt: x.fmt } : {}) });
  }
  const out: DataModel = { tables, relationships, measures };
  compileMeasures(out);
  return out;
}

// ---- the wide source ----

/** One table as its source reads it. */
export interface TableRows {
  fields: string[];
  records: Value[][];
  formats: (string | undefined)[];
}

export interface ModelSource {
  fields: string[];
  records: Value[][];
  formats: (string | undefined)[];
  /** The table each record is a row of (an index into `tables`). */
  tags: number[];
  tables: string[];
  /** Fields a field list does not show. */
  hidden: string[];
  measures: Map<string, CompiledMeasure>;
  /** What is wrong with the model's tables, relationships or measures (the first stops a pivot table drawing). */
  problems: string[];
}

const keyOf = (v: Value): string => (v === null || v === "" ? "" : isError(v) ? `e${v.error}` : typeof v === "number" ? `n${v}` : typeof v === "boolean" ? `t${v}` : `s${v.toLowerCase()}`);

/** Builds the wide source of a model from its tables. `read` gives a table's rows; null when its source is not there. */
export function buildModelSource(model: DataModel, read: (table: ModelTable) => TableRows | null): ModelSource {
  const problems: string[] = [];
  const data = model.tables.map((t) => {
    const rows = read(t);
    if (!rows) problems.push(`The table "${t.name}" reads ${t.source}, which isn't there: it is a range with column names in its first row, a table, or a data block`);
    return rows ?? { fields: [], records: [], formats: [] };
  });
  const tableIndex = (name: string) => model.tables.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  const columnIndex = (t: number, column: string) => data[t]!.fields.findIndex((f) => f.toLowerCase() === column.toLowerCase());
  const offset: number[] = [];
  const fields: string[] = [];
  const formats: (string | undefined)[] = [];
  model.tables.forEach((t, i) => {
    offset[i] = fields.length;
    data[i]!.fields.forEach((f, c) => {
      fields.push(columnField(t.name, f));
      formats.push(data[i]!.formats[c]);
    });
    fields.push(rowsField(t.name));
    formats.push(undefined);
  });
  const hidden = model.tables.map((t) => rowsField(t.name));

  // Relationships: the many side looks up the one side.
  interface Link {
    to: number;
    fromCol: number;
    lookup: Map<string, Value[]>;
  }
  const links: Link[][] = model.tables.map(() => []);
  for (const r of model.relationships) {
    const a = tableIndex(r.from.table);
    const b = tableIndex(r.to.table);
    if (a < 0 || b < 0) continue;
    const fc = columnIndex(a, r.from.column);
    const tc = columnIndex(b, r.to.column);
    if (fc < 0) {
      if (data[a]!.fields.length) problems.push(`The relationship from ${r.from.table}[${r.from.column}]: ${r.from.table} has no column ${r.from.column}`);
      continue;
    }
    if (tc < 0) {
      if (data[b]!.fields.length) problems.push(`The relationship to ${r.to.table}[${r.to.column}]: ${r.to.table} has no column ${r.to.column}`);
      continue;
    }
    const lookup = new Map<string, Value[]>();
    for (const rec of data[b]!.records) {
      const k = keyOf(rec[tc] ?? null);
      if (k === "") continue;
      if (lookup.has(k)) {
        problems.push(`${r.to.table}[${r.to.column}] has the value ${String(rec[tc])} twice, so it can't be the one side of a relationship`);
        break;
      }
      lookup.set(k, rec);
    }
    links[a]!.push({ to: b, fromCol: fc, lookup });
  }

  const records: Value[][] = [];
  const tags: number[] = [];
  const width = fields.length;
  model.tables.forEach((_, ti) => {
    for (const rec of data[ti]!.records) {
      const out: Value[] = new Array<Value>(width).fill(null);
      const put = (t: number, row: Value[]) => {
        for (let c = 0; c < data[t]!.fields.length; c++) out[offset[t]! + c] = row[c] ?? null;
      };
      put(ti, rec);
      out[offset[ti]! + data[ti]!.fields.length] = 1;
      // Follow the relationships from the many side outward, once to each table.
      const reached = new Set<number>([ti]);
      const queue: { t: number; row: Value[] }[] = [{ t: ti, row: rec }];
      while (queue.length) {
        const { t, row } = queue.shift()!;
        for (const link of links[t]!) {
          if (reached.has(link.to)) continue;
          reached.add(link.to);
          const hit = link.lookup.get(keyOf(row[link.fromCol] ?? null));
          if (!hit) continue;
          put(link.to, hit);
          queue.push({ t: link.to, row: hit });
        }
      }
      records.push(out);
      tags.push(ti);
    }
  });

  let measures = new Map<string, CompiledMeasure>();
  try {
    measures = compileMeasures(model);
  } catch (e) {
    problems.push((e as Error).message);
  }
  for (const c of measures.values()) {
    for (const r of c.refs) if (!fields.some((f) => f.toLowerCase() === r.field.toLowerCase())) problems.push(`The measure "${c.name}" uses ${r.field}, which isn't a column of the model`);
    for (const f of c.ctx?.columns ?? []) if (!fields.some((x) => x.toLowerCase() === f.toLowerCase())) problems.push(`The measure "${c.name}" uses ${f}, which isn't a column of the model`);
  }
  return { fields, records, formats, tags, tables: model.tables.map((t) => t.name), hidden, measures, problems };
}

/** The tables a pivot table's values read (the records of other tables would only add empty lines), by index; null if it reads none. */
export function involvedTables(valueFields: readonly string[], src: Pick<ModelSource, "fields" | "tables" | "measures">): Set<number> | null {
  const found = new Set<number>();
  const own = (field: string) => {
    const at = field.indexOf("[");
    if (at < 0) return;
    const t = src.tables.findIndex((n) => n.toLowerCase() === field.slice(0, at).toLowerCase());
    if (t >= 0) found.add(t);
  };
  for (const f of valueFields) {
    const measure = src.measures.get(f.toLowerCase());
    if (measure) {
      for (const r of measure.refs) own(r.field);
      // The tables a context measure adds up.
      for (const t of measure.ctx?.tables ?? []) own(`${t}[`);
    } else own(f);
  }
  return found.size ? found : null;
}
