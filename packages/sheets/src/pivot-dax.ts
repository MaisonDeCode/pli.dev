import { PliError } from "@pli.dev/core";
import type { ErrorCode } from "./model";
import { dateSerial, serialDate, type Value } from "./values";

/*
 * Measures that work in the filters of a cell: CALCULATE and the functions around it (ALL, ALLEXCEPT, ALLSELECTED, KEEPFILTERS,
 * FILTER, VALUES, SUMX…), and time intelligence (TOTALYTD, DATESYTD, SAMEPERIODLASTYEAR, DATEADD, PARALLELPERIOD…).
 *
 * A pivot table cell stands for a set of filters: the items of its row and column, the filters above the table, the slicers.
 * A measure of this kind is worked out over the rows of the data model's wide source that pass those filters, and CALCULATE
 * works its expression out again over the rows that pass the filters changed as it says. A filter on a column replaces the
 * filters the cell has on that column (KEEPFILTERS adds to them instead); ALL takes them off.
 *
 * Time intelligence reads the dates of the table the date column is in: the dates that pass the cell's filters on that table
 * are the dates in view. The functions give a set of dates, and the filters that table has are replaced by that set, as they
 * are when a table is marked as a date table in Excel. A table with a row for every day (a calendar) makes them exact; with
 * only the days that have records, a period without records has no days to move.
 */

export type { ErrorCode };

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** The rows of the model's wide source, and the table each is a row of. */
export interface ModelData {
  fields: string[];
  records: Value[][];
  /** The table (an index into `tables`) each record is a row of. */
  tags: number[];
  tables: string[];
}

/** One filter of a cell: the field it is on (`Table[Column]`) and whether a row passes it. */
export interface ContextPred {
  field: string;
  test: (rec: Value[]) => boolean;
}

export interface ContextInput {
  data: ModelData;
  /** Filters the pivot table has apart from its rows and columns: filters above the table, slicers, timelines, hidden items. */
  base: readonly ContextPred[];
  /** The items of the cell's row and column. */
  cell: readonly ContextPred[];
  /** Today as a serial number. */
  today: number;
}

export interface ContextMeasure {
  evaluate(input: ContextInput): number | ErrorCode | undefined;
  /** Every `Table[Column]` it names (apart from `#Rows`), for checking they are there. */
  columns: string[];
  /** The tables its columns are in. */
  tables: string[];
}

// ---- reading ----

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string; quoted?: boolean }
  | { t: "br"; v: string }
  | { t: "op"; v: string };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    const rest = text.slice(i);
    if (/\s/.test(ch)) i++;
    else if (rest.startsWith("//") || rest.startsWith("--")) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl + 1;
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest)!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '"') {
      let s = "";
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            s += '"';
            j++;
          } else break;
        } else s += text[j];
      }
      if (j >= text.length) bad(`"${text}" has a " that isn't closed`);
      out.push({ t: "str", v: s });
      i = j + 1;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return bad(`"${text}" has a table name that isn't closed with '`);
      out.push({ t: "id", v: text.slice(i + 1, end), quoted: true });
      i = end + 1;
    } else if (ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end < 0) return bad(`"${text}" has a [ that isn't closed`);
      out.push({ t: "br", v: text.slice(i + 1, end) });
      i = end + 1;
    } else if (/[A-Za-z_À-￿]/.test(ch)) {
      const m = /^[A-Za-z0-9_.À-￿]+/.exec(rest)!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else {
      const two = rest.slice(0, 2);
      if (["<>", "<=", ">=", "&&", "||", "=="].includes(two)) {
        out.push({ t: "op", v: two });
        i += 2;
      } else if ("+-*/^(),=<>&{}".includes(ch)) {
        out.push({ t: "op", v: ch });
        i++;
      } else bad(`"${text}" has "${ch}", which a measure can't use`);
    }
  }
  return out;
}

type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "col"; table: string; column: string; key: string }
  | { t: "meas"; name: string; node: Node }
  | { t: "id"; name: string }
  | { t: "call"; name: string; args: (Node | null)[] }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "neg"; a: Node }
  | { t: "set"; items: Node[] };

/** The functions that make a measure one of this kind. */
const CONTEXT_FUNCTIONS = [
  "CALCULATE", "CALCULATETABLE", "FILTER", "ALL", "ALLEXCEPT", "ALLSELECTED", "REMOVEFILTERS", "KEEPFILTERS", "VALUES", "DISTINCT", "SELECTEDVALUE", "HASONEVALUE", "ISFILTERED",
  "IF", "SWITCH", "AND", "OR", "NOT", "TRUE", "FALSE", "BLANK", "ISBLANK", "COALESCE", "INT", "SUMX", "AVERAGEX", "COUNTX", "MINX", "MAXX", "DATE", "YEAR", "MONTH", "DAY", "TODAY",
  "TOTALYTD", "TOTALQTD", "TOTALMTD", "DATESYTD", "DATESQTD", "DATESMTD", "SAMEPERIODLASTYEAR", "PREVIOUSDAY", "PREVIOUSMONTH", "PREVIOUSQUARTER", "PREVIOUSYEAR", "NEXTDAY", "NEXTMONTH", "NEXTQUARTER", "NEXTYEAR",
  "DATEADD", "PARALLELPERIOD", "DATESBETWEEN", "DATESINPERIOD", "FIRSTDATE", "LASTDATE", "STARTOFMONTH", "STARTOFQUARTER", "STARTOFYEAR", "ENDOFMONTH", "ENDOFQUARTER", "ENDOFYEAR",
  "CLOSINGBALANCEMONTH", "CLOSINGBALANCEQUARTER", "CLOSINGBALANCEYEAR", "OPENINGBALANCEMONTH", "OPENINGBALANCEQUARTER", "OPENINGBALANCEYEAR",
];
const CONTEXT_RE = new RegExp(`\\b(${CONTEXT_FUNCTIONS.join("|")})\\s*\\(`, "i");

/** Whether an expression needs the filters of a cell: it calls one of the functions above, compares, or names a measure that does. */
export function needsContext(expression: string, isContextMeasure: (name: string) => boolean): boolean {
  if (CONTEXT_RE.test(expression) || /["{}]|&&|\|\||[=<>]/.test(expression)) return true;
  for (const m of expression.matchAll(/\[([^\]]+)\]/g)) {
    const before = expression[m.index! - 1] ?? "";
    if (/[A-Za-z0-9_.'À-￿]/.test(before)) continue;
    if (isContextMeasure(m[1]!)) return true;
  }
  return false;
}

interface ParseEnv {
  /** A table's name as the model has it. */
  tableName(name: string): string | undefined;
  /** A measure's expression, by name. */
  expressionOf(name: string): string | undefined;
}

function parseExpression(label: string, text: string, env: ParseEnv, stack: readonly string[], columns: Set<string>, tables: Set<string>): Node {
  const tokens = tokenize(text.trim().replace(/^=/, ""));
  if (!tokens.length) bad(`The measure "${label}" needs an expression`);
  let at = 0;
  const peek = () => tokens[at];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const eat = (v: string) => (isOp(v) ? (at++, true) : false);
  const isWord = (v: string) => peek()?.t === "id" && !(peek() as { quoted?: boolean }).quoted && (peek() as { v: string }).v.toUpperCase() === v;

  const or = (): Node => {
    let a = and();
    while (eat("||")) a = { t: "bin", op: "||", a, b: and() };
    return a;
  };
  const and = (): Node => {
    let a = within();
    while (eat("&&")) a = { t: "bin", op: "&&", a, b: within() };
    return a;
  };
  const within = (): Node => {
    const a = compare();
    if (isWord("IN")) {
      at++;
      return { t: "bin", op: "IN", a, b: compare() };
    }
    return a;
  };
  const compare = (): Node => {
    let a = concat();
    for (;;) {
      const op = ["=", "==", "<>", "<=", ">=", "<", ">"].find((o) => isOp(o));
      if (!op) return a;
      at++;
      a = { t: "bin", op: op === "==" ? "=" : op, a, b: concat() };
    }
  };
  const concat = (): Node => {
    let a = sum();
    while (eat("&")) a = { t: "bin", op: "&", a, b: sum() };
    return a;
  };
  const sum = (): Node => {
    let a = product();
    for (;;) {
      if (eat("+")) a = { t: "bin", op: "+", a, b: product() };
      else if (eat("-")) a = { t: "bin", op: "-", a, b: product() };
      else return a;
    }
  };
  const product = (): Node => {
    let a = power();
    for (;;) {
      if (eat("*")) a = { t: "bin", op: "*", a, b: power() };
      else if (eat("/")) a = { t: "bin", op: "/", a, b: power() };
      else return a;
    }
  };
  const power = (): Node => {
    const a = unary();
    return eat("^") ? { t: "bin", op: "^", a, b: power() } : a;
  };
  const unary = (): Node => {
    if (eat("-")) return { t: "neg", a: unary() };
    if (eat("+")) return unary();
    return primary();
  };
  const column = (table: string, column: string): Node => {
    const real = env.tableName(table) ?? bad(`The measure "${label}" uses ${table}, which isn't a table of the model`);
    if (column !== "#Rows") columns.add(`${real}[${column}]`);
    return { t: "col", table: real, column, key: `${real}[${column}]`.toLowerCase() };
  };
  const args = (): (Node | null)[] => {
    const list: (Node | null)[] = [];
    if (eat(")")) return list;
    for (;;) {
      if (isOp(",") || isOp(")")) list.push(null);
      else list.push(or());
      if (eat(",")) continue;
      if (!eat(")")) bad(`The measure "${label}" has a ( that isn't closed`);
      return list;
    }
  };
  const primary = (): Node => {
    const t = tokens[at++];
    if (!t) return bad(`The measure "${label}" stops where a value should be`);
    if (t.t === "num") return { t: "num", v: t.v };
    if (t.t === "str") return { t: "str", v: t.v };
    if (t.t === "br") {
      const expr = env.expressionOf(t.v);
      if (expr === undefined) return bad(`The measure "${label}" uses [${t.v}], which isn't a measure of the model`);
      if (stack.some((s) => s.toLowerCase() === t.v.toLowerCase())) return bad(`The measure "${t.v}" uses itself`);
      return { t: "meas", name: t.v, node: parseExpression(t.v, expr, env, [...stack, t.v], columns, tables) };
    }
    if (t.t === "op") {
      if (t.v === "(") {
        const e = or();
        if (!eat(")")) bad(`The measure "${label}" has a ( that isn't closed`);
        return e;
      }
      if (t.v === "{") {
        const items: Node[] = [];
        if (!eat("}")) {
          do items.push(or());
          while (eat(","));
          if (!eat("}")) bad(`The measure "${label}" has a { that isn't closed`);
        }
        return { t: "set", items };
      }
      return bad(`The measure "${label}" has "${t.v}" where a value should be`);
    }
    if (t.t === "id") {
      if (isOp("(") && !t.quoted) {
        at++;
        const name = t.v.toUpperCase();
        if (!KNOWN.has(name)) bad(`The measure "${label}" calls ${t.v}( ), which a measure doesn't have. ${HELP}`);
        const list = args();
        // The tables whose rows it adds up give the pivot table its records.
        const first = list[0];
        if (AGGREGATE_FUNCTIONS[name] && first?.t === "col") tables.add(first.table);
        if (ROW_FUNCTIONS.has(name) && first) {
          const named = rowsOf(first);
          const real = named === undefined ? undefined : env.tableName(named);
          if (real) tables.add(real);
        }
        return { t: "call", name, args: list };
      }
      const next = peek();
      if (next?.t === "br") {
        at++;
        return column(t.v, next.v);
      }
      return { t: "id", name: t.v };
    }
    return bad(`The measure "${label}" has a value where one can't be`);
  };
  const node = or();
  if (at < tokens.length) bad(`The measure "${label}" has "${(tokens[at] as { v?: unknown }).v}" in a place it can't be`);
  return node;
}

const AGGREGATE_FUNCTIONS: Record<string, AggregateFn> = { SUM: "sum", AVERAGE: "average", MIN: "min", MAX: "max", COUNT: "countNums", COUNTA: "count", DISTINCTCOUNT: "distinctCount" };
type AggregateFn = "sum" | "count" | "countNums" | "average" | "max" | "min" | "distinctCount";

const ROW_FUNCTIONS = new Set(["COUNTROWS", "SUMX", "AVERAGEX", "COUNTX", "MINX", "MAXX"]);

/** The table whose rows an expression like `Orders` or `FILTER(Orders, …)` goes through. */
function rowsOf(n: Node): string | undefined {
  if (n.t === "id") return n.name;
  if (n.t === "call" && ["FILTER", "ALL", "ALLSELECTED", "VALUES", "CALCULATETABLE", "KEEPFILTERS"].includes(n.name) && n.args[0]) return rowsOf(n.args[0]);
  return undefined;
}

const KNOWN = new Set([...CONTEXT_FUNCTIONS, ...Object.keys(AGGREGATE_FUNCTIONS), "COUNTROWS", "DIVIDE", "ABS", "ROUND", "SQRT"]);
const HELP =
  "It has SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, DISTINCTCOUNT, COUNTROWS, DIVIDE, ABS, ROUND, SQRT, INT, IF, SWITCH, CALCULATE, FILTER, ALL, ALLEXCEPT, ALLSELECTED, REMOVEFILTERS, KEEPFILTERS, VALUES, SUMX and the time functions (TOTALYTD, DATESYTD, SAMEPERIODLASTYEAR, DATEADD, PARALLELPERIOD…)";

/**
 * Reads a measure that works in the filters of a cell. `tableName` finds a table by name, `expressionOf` finds the expression of
 * another measure it names in brackets. Throws if the expression is not one a measure can be.
 */
export function parseContextMeasure(m: { name: string; expression: string }, tableName: (name: string) => string | undefined, expressionOf: (name: string) => string | undefined): ContextMeasure {
  const columns = new Set<string>();
  const tables = new Set<string>();
  const root = parseExpression(m.name, m.expression, { tableName, expressionOf }, [m.name], columns, tables);
  return {
    columns: [...columns],
    tables: [...tables],
    evaluate(input) {
      const run = new Run(input);
      const v = run.scalar(root, { ctx: run.start() });
      return finish(v);
    },
  };
}

// ---- working out ----

type Val = number | string | boolean | null | { err: ErrorCode };
const err = (c: ErrorCode): { err: ErrorCode } => ({ err: c });
const isErr = (v: unknown): v is { err: ErrorCode } => typeof v === "object" && v !== null && "err" in v;

function finish(v: Val): number | ErrorCode | undefined {
  if (isErr(v)) return v.err;
  if (v === null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : "#NUM!";
  if (typeof v === "boolean") return v ? 1 : 0;
  return "#VALUE!";
}

interface Pred {
  id: number;
  test: (rec: Value[]) => boolean;
  layer: "base" | "cell" | "calc";
}

let nextPredId = 1;

class Ctx {
  constructor(readonly map: ReadonlyMap<string, readonly Pred[]> = new Map()) {}
  with(field: string, pred: Pred, keep = false): Ctx {
    const m = new Map(this.map);
    m.set(field, keep ? [...(m.get(field) ?? []), pred] : [pred]);
    return new Ctx(m);
  }
  without(match: (field: string, preds: readonly Pred[]) => readonly Pred[] | null): Ctx {
    const m = new Map<string, readonly Pred[]>();
    for (const [f, preds] of this.map) {
      const kept = match(f, preds);
      if (kept === null) m.set(f, preds);
      else if (kept.length) m.set(f, kept);
    }
    return new Ctx(m);
  }
  has(field: string): boolean {
    return (this.map.get(field)?.length ?? 0) > 0;
  }
  sig(): string {
    return [...this.map].map(([f, ps]) => `${f}:${ps.map((p) => p.id).join(".")}`).sort().join("|");
  }
  tests(): ((rec: Value[]) => boolean)[] {
    return [...this.map.values()].flatMap((ps) => ps.map((p) => p.test));
  }
}

interface State {
  ctx: Ctx;
  /** The row an iterator is on. */
  row?: Value[];
  /** Values a column has while FILTER goes through them. */
  bound?: ReadonlyMap<string, Value>;
}

const tableOfKey = (key: string): string => key.slice(0, key.indexOf("["));

const keyOfValue = (v: Value): string => (v === null || v === "" ? "" : typeof v === "object" ? `e${v.error}` : typeof v === "number" ? `n${v}` : typeof v === "boolean" ? `t${v}` : `s${v.toLowerCase()}`);

/** A date table: the set of days, and the column they are in. */
interface Dates {
  kind: "dates";
  field: string;
  days: number[];
}
interface Rows {
  kind: "rows";
  table: string;
  recs: Value[][];
}
interface ColumnValues {
  kind: "col";
  field: string;
  values: Value[];
}
type Tab = Dates | Rows | ColumnValues;

function addMonths(serial: number, n: number): number {
  const d = serialDate(serial);
  const total = d.year * 12 + (d.month - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  for (let day = d.day; day >= 1; day--) {
    const s = dateSerial(year, month, day);
    if (s !== null && serialDate(s).month === month) return s;
  }
  return serial;
}

const monthStart = (serial: number): number => {
  const d = serialDate(serial);
  return dateSerial(d.year, d.month, 1) ?? serial;
};
const quarterStart = (serial: number): number => {
  const d = serialDate(serial);
  return dateSerial(d.year, Math.floor((d.month - 1) / 3) * 3 + 1, 1) ?? serial;
};
const yearStart = (serial: number): number => dateSerial(serialDate(serial).year, 1, 1) ?? serial;
const range = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let d = a; d <= b && out.length < 200_000; d++) out.push(d);
  return out;
};

class Run {
  private readonly index = new Map<string, number>();
  private readonly cache = new Map<string, number[]>();
  private readonly visibleCache = new Map<string, number[]>();
  private tagOf?: Map<Value[], number>;
  private readonly baseCtx: Ctx;
  private readonly cellCtx: Ctx;
  constructor(private readonly input: ContextInput) {
    input.data.fields.forEach((f, i) => this.index.set(f.toLowerCase(), i));
    let ctx = new Ctx();
    for (const p of input.base) ctx = ctx.with(p.field.toLowerCase(), { id: nextPredId++, test: p.test, layer: "base" }, true);
    this.baseCtx = ctx;
    for (const p of input.cell) ctx = ctx.with(p.field.toLowerCase(), { id: nextPredId++, test: p.test, layer: "cell" }, true);
    this.cellCtx = ctx;
  }
  start(): Ctx {
    return this.cellCtx;
  }

  // -- rows that pass a context --
  private matching(ctx: Ctx): number[] {
    const sig = ctx.sig();
    const hit = this.cache.get(sig);
    if (hit) return hit;
    const tests = ctx.tests();
    const out: number[] = [];
    const { records } = this.input.data;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      if (tests.every((t) => t(rec))) out.push(i);
    }
    this.cache.set(sig, out);
    return out;
  }
  private fieldAt(key: string, what = "a column"): number {
    const at = this.index.get(key.toLowerCase());
    if (at === undefined) return bad(`${what} ${key} isn't a column of the model`);
    return at;
  }
  private tableIndex(name: string): number {
    return this.input.data.tables.findIndex((t) => t.toLowerCase() === name.toLowerCase());
  }
  private tag(rec: Value[]): number {
    if (!this.tagOf) {
      this.tagOf = new Map();
      this.input.data.records.forEach((r, i) => this.tagOf!.set(r, this.input.data.tags[i]!));
    }
    return this.tagOf.get(rec) ?? -1;
  }

  // -- values --
  private num(v: Val): number | { err: ErrorCode } {
    if (isErr(v)) return v;
    if (v === null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : err("#VALUE!");
  }
  private colValue(node: Extract<Node, { t: "col" }>, st: State): Val {
    const at = this.fieldAt(node.key);
    if (st.row) return this.plain(st.row[at] ?? null);
    const bound = st.bound?.get(node.key);
    if (bound !== undefined) return this.plain(bound);
    // Outside an iterator a column has a value when the cell's filters leave one.
    const seen = new Map<string, Value>();
    for (const i of this.matching(st.ctx)) {
      const v = this.input.data.records[i]![at] ?? null;
      if (v !== null && v !== "") seen.set(keyOfValue(v), v);
      if (seen.size > 1) return err("#VALUE!");
    }
    return seen.size === 1 ? this.plain([...seen.values()][0]!) : null;
  }
  private plain(v: Value): Val {
    if (typeof v === "object" && v !== null) return err(v.error as ErrorCode);
    return v === "" ? null : v;
  }

  scalar(node: Node | null, st: State): Val {
    if (node === null) return null;
    switch (node.t) {
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "meas":
        return this.scalar(node.node, st);
      case "col":
        return this.colValue(node, st);
      case "neg": {
        const v = this.num(this.scalar(node.a, st));
        return isErr(v) ? v : -v;
      }
      case "id": {
        const n = node.name.toUpperCase();
        if (n === "TRUE") return true;
        if (n === "FALSE") return false;
        return bad(`"${node.name}" isn't a column or a measure: write a column as Table[Column] and a measure in [brackets]`);
      }
      case "set":
        return bad("A list in { } can only follow IN");
      case "bin":
        return this.binary(node, st);
      case "call":
        return this.call(node, st);
    }
  }

  private compare(a: Val, op: string, b: Val): Val {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    const x = a === null ? (typeof b === "string" ? "" : typeof b === "boolean" ? false : 0) : a;
    const y = b === null ? (typeof a === "string" ? "" : typeof a === "boolean" ? false : 0) : b;
    let c: number;
    if (typeof x === "number" && typeof y === "number") c = x - y;
    else if (typeof x === "string" && typeof y === "string") {
      const p = x.toLowerCase();
      const q = y.toLowerCase();
      c = p < q ? -1 : p > q ? 1 : 0;
    } else if (typeof x === typeof y) c = Number(x) - Number(y);
    else return op === "<>" ? true : op === "=" ? false : err("#VALUE!");
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case ">":
        return c > 0;
      case "<=":
        return c <= 0;
      default:
        return c >= 0;
    }
  }

  private binary(node: Extract<Node, { t: "bin" }>, st: State): Val {
    const { op } = node;
    if (op === "&&" || op === "||") {
      const a = this.truth(this.scalar(node.a, st));
      if (isErr(a)) return a;
      if (op === "&&" && !a) return false;
      if (op === "||" && a) return true;
      return this.truth(this.scalar(node.b, st));
    }
    if (op === "IN") {
      const a = this.scalar(node.a, st);
      if (isErr(a)) return a;
      const list = this.listOf(node.b, st);
      if (isErr(list)) return list;
      return list.some((x) => this.compare(a, "=", x) === true);
    }
    const a = this.scalar(node.a, st);
    const b = this.scalar(node.b, st);
    if (["=", "<>", "<", ">", "<=", ">="].includes(op)) return this.compare(a, op, b);
    if (op === "&") return isErr(a) ? a : isErr(b) ? b : `${a ?? ""}${b ?? ""}`;
    const x = this.num(a);
    const y = this.num(b);
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    switch (op) {
      case "+":
        return x + y;
      case "-":
        return x - y;
      case "*":
        return x * y;
      case "/":
        return y === 0 ? err("#DIV/0!") : x / y;
      default:
        return x ** y;
    }
  }
  private truth(v: Val): boolean | { err: ErrorCode } {
    if (isErr(v)) return v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (v === null) return false;
    return err("#VALUE!");
  }
  /** The values of `{ … }`, or of a column's values. */
  private listOf(node: Node, st: State): Val[] | { err: ErrorCode } {
    if (node.t === "set") return node.items.map((i) => this.scalar(i, st));
    const t = this.table(node, st);
    if (t.kind === "col") return t.values.map((v) => this.plain(v));
    if (t.kind === "dates") return t.days;
    return bad("IN needs a list in { } or a column's values");
  }

  // -- tables --
  /** The rows (or values) a table expression stands for. */
  table(node: Node, st: State): Tab {
    if (node.t === "id") {
      const at = this.tableIndex(node.name);
      if (at < 0) return bad(`"${node.name}" isn't a table of the model`);
      const name = this.input.data.tables[at]!;
      return { kind: "rows", table: name, recs: this.matching(st.ctx).filter((i) => this.input.data.tags[i] === at).map((i) => this.input.data.records[i]!) };
    }
    if (node.t === "col") {
      const at = this.fieldAt(node.key);
      const seen = new Map<string, Value>();
      for (const i of this.matching(st.ctx)) {
        const v = this.input.data.records[i]![at] ?? null;
        if (v !== null && v !== "" && !seen.has(keyOfValue(v))) seen.set(keyOfValue(v), v);
      }
      return { kind: "col", field: node.key, values: [...seen.values()] };
    }
    if (node.t === "meas") return this.table(node.node, st);
    if (node.t !== "call") return bad("A table is expected here");
    const a = node.args;
    switch (node.name) {
      case "ALL":
      case "ALLSELECTED":
      case "REMOVEFILTERS": {
        const ctx = this.removing(node, st.ctx);
        const arg = a[0];
        if (!arg) return bad(`${node.name} needs a table or a column`);
        return this.table(arg, { ...st, ctx });
      }
      case "VALUES":
      case "DISTINCT":
        return this.table(a[0] ?? bad(`${node.name} needs a column or a table`), st);
      case "FILTER":
      case "CALCULATETABLE": {
        if (node.name === "CALCULATETABLE") {
          const ctx = this.filtered(a.slice(1), st);
          return this.table(a[0] ?? bad("CALCULATETABLE needs a table"), { ...st, ctx });
        }
        const src = this.table(a[0] ?? bad("FILTER needs a table"), st);
        const cond = a[1] ?? bad("FILTER needs a condition");
        if (src.kind === "rows") return { ...src, recs: src.recs.filter((rec) => this.truth(this.scalar(cond, { ...st, row: rec })) === true) };
        if (src.kind === "col") {
          const keep = src.values.filter((v) => {
            const bound = new Map(st.bound ?? []).set(src.field, v);
            const ctx = st.ctx.with(src.field, this.equalsPred(src.field, v, "calc"));
            return this.truth(this.scalar(cond, { ctx, bound })) === true;
          });
          return { kind: "col", field: src.field, values: keep };
        }
        return bad("FILTER over dates isn't supported: give it a table or a column");
      }
      default: {
        const dates = this.dateSet(node, st);
        return dates;
      }
    }
  }

  private equalsPred(field: string, v: Value, layer: Pred["layer"]): Pred {
    const at = this.fieldAt(field);
    const k = keyOfValue(v);
    return { id: nextPredId++, layer, test: (rec) => keyOfValue(rec[at] ?? null) === k };
  }

  // -- filters --
  /** The context after the table, column or nothing a function like ALL names is taken off. */
  private removing(node: Extract<Node, { t: "call" }>, ctx: Ctx): Ctx {
    const targets = node.args.filter((x): x is Node => x !== null);
    const selected = node.name === "ALLSELECTED";
    const drop = (layers: readonly Pred[]): readonly Pred[] => (selected ? layers.filter((p) => p.layer === "base") : []);
    if (!targets.length) return ctx.without((_f, ps) => drop(ps));
    const fields = new Set<string>();
    const whole = new Set<string>();
    for (const t of targets) {
      const x = t.t === "meas" ? t.node : t;
      if (x.t === "col") fields.add(x.key);
      else if (x.t === "id") {
        const at = this.tableIndex(x.name);
        if (at < 0) bad(`"${x.name}" isn't a table of the model`);
        whole.add(this.input.data.tables[at]!.toLowerCase());
      } else if (x.t === "call" && (x.name === "VALUES" || x.name === "DISTINCT" || x.name === "ALL")) {
        const inner = x.args[0];
        if (inner?.t === "col") fields.add(inner.key);
      } else bad(`${node.name} takes tables and columns`);
    }
    return ctx.without((f, ps) => (fields.has(f) || whole.has(tableOfKey(f)) ? drop(ps) : null));
  }

  /** The context after CALCULATE's filter arguments. */
  private filtered(filters: readonly (Node | null)[], st: State): Ctx {
    let ctx = st.ctx;
    for (const f of filters) if (f) ctx = this.applyFilter(f, { ...st, ctx }, false);
    return ctx;
  }

  private applyFilter(node: Node, st: State, keep: boolean): Ctx {
    const ctx = st.ctx;
    if (node.t === "meas") return this.applyFilter(node.node, st, keep);
    if (node.t === "call") {
      const a = node.args;
      switch (node.name) {
        case "ALL":
        case "ALLSELECTED":
        case "REMOVEFILTERS":
          return this.removing(node, ctx);
        case "ALLEXCEPT": {
          const target = a[0];
          if (!target || target.t !== "id") return bad("ALLEXCEPT takes a table and then the columns to keep filtered");
          const at = this.tableIndex(target.name);
          if (at < 0) bad(`"${target.name}" isn't a table of the model`);
          const table = this.input.data.tables[at]!.toLowerCase();
          const kept = new Set(a.slice(1).flatMap((x) => (x && x.t === "col" ? [x.key] : [])));
          return ctx.without((f) => (tableOfKey(f) === table && !kept.has(f) ? [] : null));
        }
        case "KEEPFILTERS":
          return this.applyFilter(a[0] ?? bad("KEEPFILTERS needs a filter"), st, true);
        case "VALUES":
        case "DISTINCT":
          return ctx;
        case "FILTER": {
          const src = a[0] ?? bad("FILTER needs a table");
          const result = this.table(node, st);
          if (result.kind === "col") {
            const field = result.field;
            const at = this.fieldAt(field);
            const allowed = new Set(result.values.map(keyOfValue));
            return ctx.with(field.toLowerCase(), { id: nextPredId++, layer: "calc", test: (rec) => allowed.has(keyOfValue(rec[at] ?? null)) }, keep);
          }
          if (result.kind === "rows") {
            const set = new Set(result.recs);
            const at = this.tableIndex(result.table);
            const key = `${result.table}[#filter]`.toLowerCase();
            void src;
            return ctx.with(key, { id: nextPredId++, layer: "calc", test: (rec) => this.tag(rec) !== at || set.has(rec) }, keep);
          }
          return bad("FILTER takes a table or a column");
        }
        default: {
          if (DATE_FUNCTIONS.has(node.name)) {
            const dates = this.dateSet(node, st);
            return this.withDates(ctx, dates);
          }
          return bad(`${node.name}( ) can't be used as a filter: use a comparison such as Table[Column] = value, ALL, FILTER or a date function`);
        }
      }
    }
    // A comparison on one column.
    const test = this.columnTest(node, st);
    if (!test) return bad("A filter in CALCULATE is a comparison on one column (Table[Column] = value), ALL, FILTER or a date function");
    const at = this.fieldAt(test.field);
    return ctx.with(test.field.toLowerCase(), { id: nextPredId++, layer: "calc", test: (rec) => test.test(rec[at] ?? null) }, keep);
  }

  private withDates(ctx: Ctx, dates: Dates): Ctx {
    const table = tableOfKey(dates.field.toLowerCase());
    const at = this.fieldAt(dates.field);
    const days = new Set(dates.days);
    // The filters of the date table are replaced by the dates, as for a table marked as a date table.
    return ctx
      .without((f) => (tableOfKey(f) === table ? [] : null))
      .with(dates.field.toLowerCase(), { id: nextPredId++, layer: "calc", test: (rec) => typeof rec[at] === "number" && days.has(Math.floor(rec[at] as number)) });
  }

  /** `Table[Column] = 5`, `… IN { … }`, and `and`/`or` of those on the same column: the column and whether a value passes. */
  private columnTest(node: Node, st: State): { field: string; test: (v: Value) => boolean } | null {
    if (node.t !== "bin") return null;
    if (node.op === "&&" || node.op === "||") {
      const x = this.columnTest(node.a, st);
      const y = this.columnTest(node.b, st);
      if (!x || !y) return null;
      if (x.field.toLowerCase() !== y.field.toLowerCase()) return bad("A filter that joins comparisons with && or || has to compare one column");
      return node.op === "&&" ? { field: x.field, test: (v) => x.test(v) && y.test(v) } : { field: x.field, test: (v) => x.test(v) || y.test(v) };
    }
    const noRow: State = { ctx: st.ctx };
    if (node.op === "IN") {
      if (node.a.t !== "col") return null;
      const list = this.listOf(node.b, noRow);
      if (isErr(list)) return bad("A list in IN has an error");
      return { field: node.a.key, test: (v) => list.some((x) => this.compare(this.plain(v), "=", x) === true) };
    }
    if (!["=", "<>", "<", ">", "<=", ">="].includes(node.op)) return null;
    const flip: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "=": "=", "<>": "<>" };
    let col: Extract<Node, { t: "col" }>;
    let other: Node;
    let op = node.op;
    if (node.a.t === "col") {
      col = node.a;
      other = node.b;
    } else if (node.b.t === "col") {
      col = node.b;
      other = node.a;
      op = flip[op]!;
    } else return null;
    const value = this.scalar(other, noRow);
    if (isErr(value)) return bad("A filter compares a column with a value that is an error");
    return { field: col.key, test: (v) => this.compare(this.plain(v), op, value) === true };
  }

  // -- dates --
  /** The days in view for a date column: those of the table it is in that pass the cell's filters on that table. */
  private visible(field: string, ctx: Ctx): number[] {
    const key = `${field.toLowerCase()}@${ctx.sig()}`;
    const hit = this.visibleCache.get(key);
    if (hit) return hit;
    const table = this.tableIndex(tableOfKey(field));
    const at = this.fieldAt(field);
    const { records, tags } = this.input.data;
    // A filter on a field that no row of this table has a value for (another table's) leaves its dates alone.
    const own = new Map<string, boolean>();
    const applies = (f: string): boolean => {
      let r = own.get(f);
      if (r === undefined) {
        if (f.endsWith("[#filter]")) r = tableOfKey(f) === tableOfKey(field).toLowerCase();
        else {
          const fi = this.fieldAt(f);
          r = records.some((rec, i) => tags[i] === table && rec[fi] !== null && rec[fi] !== undefined);
        }
        own.set(f, r);
      }
      return r;
    };
    const tests = [...ctx.map].filter(([f]) => applies(f)).flatMap(([, ps]) => ps.map((p) => p.test));
    const days = new Set<number>();
    for (let i = 0; i < records.length; i++) {
      if (tags[i] !== table) continue;
      const v = records[i]![at];
      if (typeof v !== "number") continue;
      const rec = records[i]!;
      if (tests.every((t) => t(rec))) days.add(Math.floor(v));
    }
    const out = [...days].sort((x, y) => x - y);
    this.visibleCache.set(key, out);
    return out;
  }

  /** The days a date function gives, for the days in view. */
  private dateSet(node: Node, st: State): Dates {
    if (node.t === "col") {
      const field = node.key;
      return { kind: "dates", field: node.table + "[" + node.column + "]", days: this.visible(field, st.ctx) };
    }
    if (node.t === "meas") return this.dateSet(node.node, st);
    if (node.t !== "call") return bad("A column of dates or a date function is expected here");
    const a = node.args;
    const fn = node.name;
    const sourceOf = (n: Node | null): Dates => {
      if (!n) return bad(`${fn} takes dates`);
      const x = n.t === "meas" ? n.node : n;
      if (x.t === "col") return this.dateSet(x, st);
      if (x.t === "call" && DATE_FUNCTIONS.has(x.name)) return this.dateSet(x, st);
      return bad(`${fn} takes a column of dates such as Calendar[Date], or another date function`);
    };
    const fieldOf = (d: Dates) => d.field;
    const make = (d: Dates, days: number[]): Dates => ({ kind: "dates", field: fieldOf(d), days });
    const yearEnd = (n: Node | null | undefined): { month: number; day: number } => {
      const s = n ? this.scalar(n, { ctx: st.ctx }) : null;
      if (s === null) return { month: 12, day: 31 };
      const m = typeof s === "string" ? /^\s*(\d{1,2})\s*[/-]\s*(\d{1,2})\s*$/.exec(s) : null;
      if (!m) return bad("The last day of the year is written as text such as \"6-30\" (month, then day)");
      return { month: Number(m[1]), day: Number(m[2]) };
    };
    const last = (d: Dates): number | undefined => d.days[d.days.length - 1];
    const first = (d: Dates): number | undefined => d.days[0];
    const start = (kind: "year" | "quarter" | "month", to: number, end: { month: number; day: number }): number => {
      if (kind === "month") return monthStart(to);
      if (kind === "quarter") return quarterStart(to);
      const y = serialDate(to).year;
      const closing = (yr: number) => dateSerial(yr, end.month, end.day) ?? 0;
      return to <= closing(y) ? closing(y - 1) + 1 : closing(y) + 1;
    };
    const interval = (n: Node | null | undefined): "day" | "month" | "quarter" | "year" => {
      const x = n?.t === "id" ? n.name.toUpperCase() : n?.t === "call" && n.args.length === 0 ? n.name : "";
      if (x === "DAY" || x === "MONTH" || x === "QUARTER" || x === "YEAR") return x.toLowerCase() as "day";
      return bad(`${fn} needs DAY, MONTH, QUARTER or YEAR`);
    };
    const shift = (day: number, n: number, unit: "day" | "month" | "quarter" | "year") => (unit === "day" ? day + n : addMonths(day, n * (unit === "month" ? 1 : unit === "quarter" ? 3 : 12)));
    const whole = (day: number, unit: "day" | "month" | "quarter" | "year"): number[] => {
      if (unit === "day") return [day];
      const lo = unit === "month" ? monthStart(day) : unit === "quarter" ? quarterStart(day) : yearStart(day);
      return range(lo, shift(lo, 1, unit) - 1);
    };
    switch (fn) {
      case "DATESYTD":
      case "DATESQTD":
      case "DATESMTD": {
        const d = sourceOf(a[0]);
        const to = last(d);
        if (to === undefined) return make(d, []);
        const kind = fn === "DATESYTD" ? "year" : fn === "DATESQTD" ? "quarter" : "month";
        return make(d, range(start(kind, to, yearEnd(a[1])), to));
      }
      case "SAMEPERIODLASTYEAR": {
        const d = sourceOf(a[0]);
        return make(d, d.days.map((x) => shift(x, -1, "year")));
      }
      case "DATEADD": {
        const d = sourceOf(a[0]);
        const n = this.num(this.scalar(a[1] ?? null, { ctx: st.ctx }));
        if (isErr(n)) return bad("DATEADD needs a number of intervals");
        const unit = interval(a[2]);
        return make(d, d.days.map((x) => shift(x, Math.trunc(n), unit)));
      }
      case "PARALLELPERIOD": {
        const d = sourceOf(a[0]);
        const n = this.num(this.scalar(a[1] ?? null, { ctx: st.ctx }));
        if (isErr(n)) return bad("PARALLELPERIOD needs a number of intervals");
        const unit = interval(a[2]);
        const days = new Set<number>();
        for (const x of d.days) for (const y of whole(shift(x, Math.trunc(n), unit), unit)) days.add(y);
        return make(d, [...days].sort((p, q) => p - q));
      }
      case "PREVIOUSDAY":
      case "NEXTDAY": {
        const d = sourceOf(a[0]);
        const x = fn === "PREVIOUSDAY" ? first(d) : last(d);
        return make(d, x === undefined ? [] : [x + (fn === "PREVIOUSDAY" ? -1 : 1)]);
      }
      case "PREVIOUSMONTH":
      case "PREVIOUSQUARTER":
      case "PREVIOUSYEAR":
      case "NEXTMONTH":
      case "NEXTQUARTER":
      case "NEXTYEAR": {
        const d = sourceOf(a[0]);
        const unit = fn.endsWith("MONTH") ? "month" : fn.endsWith("QUARTER") ? "quarter" : "year";
        const prev = fn.startsWith("PREVIOUS");
        const x = prev ? first(d) : last(d);
        if (x === undefined) return make(d, []);
        return make(d, whole(shift(x, prev ? -1 : 1, unit), unit));
      }
      case "DATESBETWEEN":
      case "DATESINPERIOD": {
        const d = sourceOf(a[0]);
        const all = this.visible(d.field, this.baseOnly(st.ctx, d.field));
        const lo0 = this.scalar(a[1] ?? null, { ctx: st.ctx });
        if (fn === "DATESBETWEEN") {
          const hi0 = this.scalar(a[2] ?? null, { ctx: st.ctx });
          const lo = typeof lo0 === "number" ? Math.floor(lo0) : (all[0] ?? 0);
          const hi = typeof hi0 === "number" ? Math.floor(hi0) : (all[all.length - 1] ?? -1);
          return make(d, range(lo, hi));
        }
        const n = this.num(this.scalar(a[2] ?? null, { ctx: st.ctx }));
        if (typeof lo0 !== "number" || isErr(n)) return bad("DATESINPERIOD takes dates, a start date, a number and DAY, MONTH, QUARTER or YEAR");
        const unit = interval(a[3]);
        const from = Math.floor(lo0);
        const k = Math.trunc(n);
        return make(d, k >= 0 ? range(from, shift(from, k, unit) - 1) : range(shift(from, k, unit) + 1, from));
      }
      case "FIRSTDATE":
      case "LASTDATE": {
        const d = sourceOf(a[0]);
        const x = fn === "FIRSTDATE" ? first(d) : last(d);
        return make(d, x === undefined ? [] : [x]);
      }
      case "STARTOFMONTH":
      case "STARTOFQUARTER":
      case "STARTOFYEAR":
      case "ENDOFMONTH":
      case "ENDOFQUARTER":
      case "ENDOFYEAR": {
        const d = sourceOf(a[0]);
        const unit = fn.endsWith("MONTH") ? "month" : fn.endsWith("QUARTER") ? "quarter" : "year";
        const begin = fn.startsWith("START");
        const x = begin ? first(d) : last(d);
        if (x === undefined) return make(d, []);
        const lo = unit === "month" ? monthStart(x) : unit === "quarter" ? quarterStart(x) : yearStart(x);
        return make(d, [begin ? lo : shift(lo, 1, unit) - 1]);
      }
      default:
        return bad(`${fn}( ) isn't a table of dates`);
    }
  }

  /** The context with every filter on the date column's table taken off but the pivot table's own (for the first and last day there are). */
  private baseOnly(_ctx: Ctx, _field: string): Ctx {
    return this.baseCtx;
  }

  // -- functions --
  private aggregate(fn: AggregateFn, key: string, st: State): Val {
    const at = this.fieldAt(key);
    const { records } = this.input.data;
    let sum = 0;
    let count = 0;
    let nums = 0;
    let min = Infinity;
    let max = -Infinity;
    const seen = new Set<string>();
    for (const i of this.matching(st.ctx)) {
      const v = records[i]![at];
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "object") return err(v.error as ErrorCode);
      count++;
      seen.add(keyOfValue(v));
      if (typeof v === "number") {
        nums++;
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    switch (fn) {
      case "sum":
        return nums ? sum : null;
      case "average":
        return nums ? sum / nums : err("#DIV/0!");
      case "min":
        return nums ? min : null;
      case "max":
        return nums ? max : null;
      case "count":
        return count;
      case "countNums":
        return nums;
      default:
        return seen.size;
    }
  }

  private call(node: Extract<Node, { t: "call" }>, st: State): Val {
    const a = node.args;
    const name = node.name;
    const arg = (i: number) => this.scalar(a[i] ?? null, st);
    const agg = AGGREGATE_FUNCTIONS[name];
    if (agg) {
      const col = a[0] && (a[0].t === "meas" ? a[0].node : a[0]);
      if (col && col.t === "col") return this.aggregate(agg, col.key, st);
      if (name === "MIN" || name === "MAX") {
        const x = this.num(arg(0));
        const y = this.num(arg(1));
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        return name === "MIN" ? Math.min(x, y) : Math.max(x, y);
      }
      return bad(`${name} in a measure takes a column such as Orders[Amount]`);
    }
    switch (name) {
      case "COUNTROWS": {
        const t = this.table(a[0] ?? bad("COUNTROWS takes a table"), st);
        return t.kind === "rows" ? t.recs.length : t.kind === "col" ? t.values.length : t.days.length;
      }
      case "CALCULATE": {
        const ctx = this.filtered(a.slice(1), st);
        return this.scalar(a[0] ?? null, { ...st, ctx });
      }
      case "TOTALYTD":
      case "TOTALQTD":
      case "TOTALMTD": {
        // TOTALYTD(expression, dates, [filter], [year end]): the year end may stand where the filter does.
        const text = a[2]?.t === "str" ? a[2] : (a[3] ?? null);
        const filter = a[2] && a[2].t !== "str" ? [a[2]] : [];
        const dates: Node = { t: "call", name: name === "TOTALYTD" ? "DATESYTD" : name === "TOTALQTD" ? "DATESQTD" : "DATESMTD", args: [a[1] ?? null, ...(name === "TOTALYTD" && text ? [text] : [])] };
        const ctx = this.filtered([dates, ...filter], st);
        return this.scalar(a[0] ?? null, { ...st, ctx });
      }
      case "CLOSINGBALANCEMONTH":
      case "CLOSINGBALANCEQUARTER":
      case "CLOSINGBALANCEYEAR": {
        const ctx = this.filtered([{ t: "call", name: "LASTDATE", args: [a[1] ?? null] }, ...a.slice(2)], st);
        return this.scalar(a[0] ?? null, { ...st, ctx });
      }
      case "OPENINGBALANCEMONTH":
      case "OPENINGBALANCEQUARTER":
      case "OPENINGBALANCEYEAR": {
        const ctx = this.filtered([{ t: "call", name: "PREVIOUSDAY", args: [a[1] ?? null] }, ...a.slice(2)], st);
        return this.scalar(a[0] ?? null, { ...st, ctx });
      }
      case "IF": {
        const c = this.truth(arg(0));
        if (isErr(c)) return c;
        return c ? arg(1) : arg(2);
      }
      case "SWITCH": {
        const subject = arg(0);
        for (let i = 1; i + 1 < a.length; i += 2) {
          if (this.compare(subject, "=", arg(i)) === true) return arg(i + 1);
        }
        return a.length % 2 === 0 ? arg(a.length - 1) : null;
      }
      case "AND":
      case "OR": {
        const x = this.truth(arg(0));
        const y = this.truth(arg(1));
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        return name === "AND" ? x && y : x || y;
      }
      case "NOT": {
        const x = this.truth(arg(0));
        return isErr(x) ? x : !x;
      }
      case "TRUE":
        return true;
      case "FALSE":
        return false;
      case "BLANK":
        return null;
      case "ISBLANK": {
        const v = arg(0);
        return isErr(v) ? v : v === null;
      }
      case "COALESCE": {
        for (let i = 0; i < a.length; i++) {
          const v = arg(i);
          if (v !== null) return v;
        }
        return null;
      }
      case "DIVIDE": {
        const x = this.num(arg(0));
        const y = this.num(arg(1));
        if (isErr(x)) return x;
        if (isErr(y)) return y;
        return y === 0 ? arg(2) : x / y;
      }
      case "ABS":
      case "SQRT":
      case "INT": {
        const x = this.num(arg(0));
        if (isErr(x)) return x;
        return name === "ABS" ? Math.abs(x) : name === "INT" ? Math.floor(x) : x < 0 ? err("#NUM!") : Math.sqrt(x);
      }
      case "ROUND": {
        const x = this.num(arg(0));
        const d = this.num(arg(1));
        if (isErr(x)) return x;
        if (isErr(d)) return d;
        return Math.round(x * 10 ** d) / 10 ** d;
      }
      case "SUMX":
      case "AVERAGEX":
      case "COUNTX":
      case "MINX":
      case "MAXX": {
        const t = this.table(a[0] ?? bad(`${name} takes a table`), st);
        if (t.kind !== "rows") return bad(`${name} goes through the rows of a table such as Orders or FILTER(Orders, …)`);
        const xs: number[] = [];
        for (const rec of t.recs) {
          const v = this.scalar(a[1] ?? null, { ...st, row: rec });
          if (isErr(v)) return v;
          if (typeof v === "number") xs.push(v);
        }
        if (name === "COUNTX") return xs.length;
        if (!xs.length) return name === "AVERAGEX" ? err("#DIV/0!") : null;
        if (name === "SUMX") return xs.reduce((p, q) => p + q, 0);
        if (name === "AVERAGEX") return xs.reduce((p, q) => p + q, 0) / xs.length;
        return name === "MINX" ? Math.min(...xs) : Math.max(...xs);
      }
      case "SELECTEDVALUE": {
        const t = this.table(a[0] ?? bad("SELECTEDVALUE takes a column"), st);
        if (t.kind === "col" && t.values.length === 1) return this.plain(t.values[0]!);
        return arg(1);
      }
      case "HASONEVALUE": {
        const t = this.table(a[0] ?? bad("HASONEVALUE takes a column"), st);
        return t.kind === "col" && t.values.length === 1;
      }
      case "ISFILTERED": {
        const x = a[0] && (a[0].t === "meas" ? a[0].node : a[0]);
        if (!x || x.t !== "col") return bad("ISFILTERED takes a column");
        return st.ctx.has(x.key);
      }
      case "DATE": {
        const y = this.num(arg(0));
        const m = this.num(arg(1));
        const d = this.num(arg(2));
        if (isErr(y)) return y;
        if (isErr(m)) return m;
        if (isErr(d)) return d;
        const total = y * 12 + (m - 1);
        const s = dateSerial(Math.floor(total / 12), (((total % 12) + 12) % 12) + 1, 1);
        return s === null ? err("#NUM!") : s + d - 1;
      }
      case "YEAR":
      case "MONTH":
      case "DAY": {
        const x = this.num(arg(0));
        if (isErr(x)) return x;
        const dt = serialDate(Math.floor(x));
        return name === "YEAR" ? dt.year : name === "MONTH" ? dt.month : dt.day;
      }
      case "TODAY":
        return Math.floor(this.input.today);
      case "ALL":
      case "ALLEXCEPT":
      case "ALLSELECTED":
      case "REMOVEFILTERS":
      case "KEEPFILTERS":
      case "VALUES":
      case "DISTINCT":
      case "FILTER":
      case "CALCULATETABLE": {
        // A table where a value is wanted: one value if that is what it holds.
        const t = this.table(node, st);
        if (t.kind === "col" && t.values.length === 1) return this.plain(t.values[0]!);
        return err("#VALUE!");
      }
      default: {
        if (DATE_FUNCTIONS.has(name)) {
          const d = this.dateSet(node, st);
          return d.days.length === 1 ? d.days[0]! : err("#VALUE!");
        }
        return bad(`${name}( ) isn't a function a measure has`);
      }
    }
  }
}

const DATE_FUNCTIONS = new Set([
  "DATESYTD", "DATESQTD", "DATESMTD", "SAMEPERIODLASTYEAR", "DATEADD", "PARALLELPERIOD", "PREVIOUSDAY", "NEXTDAY", "PREVIOUSMONTH", "PREVIOUSQUARTER", "PREVIOUSYEAR", "NEXTMONTH", "NEXTQUARTER", "NEXTYEAR",
  "DATESBETWEEN", "DATESINPERIOD", "FIRSTDATE", "LASTDATE", "STARTOFMONTH", "STARTOFQUARTER", "STARTOFYEAR", "ENDOFMONTH", "ENDOFQUARTER", "ENDOFYEAR",
]);

