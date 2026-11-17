import { PliError } from "@pli.dev/core";
import { colName, colNumber } from "./address";
import { MAX_COLS, MAX_ROWS, type ErrorCode } from "./model";
import { ERROR_CODES } from "./values";

/** One corner of a reference. A whole column (`A:A`) has no row, a whole row (`3:3`) has no column. */
export interface Pt {
  col: number | null;
  row: number | null;
  colAbs: boolean;
  rowAbs: boolean;
}

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: ErrorCode }
  /** A cell (`b` missing) or a range, on `sheet` if one is written. */
  | { t: "ref"; sheet?: string; a: Pt; b?: Pt }
  | { t: "name"; name: string }
  /**
   * A reference to part of a table, such as `Sales[Amount]`. `table` is missing inside the table itself (`[@Amount]`). `area`
   * says which rows; `from` and `to` name the columns (a single one, or the first and last), none meaning them all. `sheet`
   * is set for a table of another workbook, `[Prices.xlsx]Orders[Total]` (`[Prices.xlsx]`) or `[Prices.xlsx]Sheet1!Orders[Total]`
   * (`[Prices.xlsx]Sheet1`); a sheet named in front of a table of this workbook is dropped.
   */
  | { t: "tref"; table?: string; area: "data" | "all" | "headers" | "totals" | "row"; from?: string; to?: string; sheet?: string }
  /** A call. With no name (`""`) it is a function called at once, `LAMBDA(x,x+1)(5)`: the first argument is the function, the rest are its arguments. */
  | { t: "call"; name: string; args: Node[] }
  | { t: "unary"; op: "-" | "+"; arg: Node }
  | { t: "percent"; arg: Node }
  | { t: "binary"; op: BinaryOp; left: Node; right: Node }
  | { t: "paren"; arg: Node }
  | { t: "array"; rows: Node[][] }
  /** An argument left out: `IF(A1,,2)`. */
  | { t: "empty" };

export type BinaryOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

/** A formula that can't be read. */
export class FormulaSyntaxError extends PliError {
  readonly position: number;
  constructor(message: string, position: number) {
    super("invalid_operation", `${message} (at ${position + 1})`);
    this.name = "FormulaSyntaxError";
    this.position = position;
  }
}

type Token =
  | { k: "num"; v: number; at: number }
  | { k: "str"; v: string; at: number }
  | { k: "ref"; node: Extract<Node, { t: "ref" }>; at: number }
  | { k: "err"; v: ErrorCode; at: number }
  | { k: "name"; v: string; at: number }
  | { k: "tref"; node: Extract<Node, { t: "tref" }>; at: number }
  | { k: "func"; v: string; at: number }
  | { k: "op"; v: string; at: number }
  | { k: "eof"; at: number };

const IDENT_START = /[A-Za-z_\\¡-￿]/;
const IDENT = /[A-Za-z0-9_.\\¡-￿]/;

function pt(colText: string | undefined, rowText: string | undefined, colAbs: boolean, rowAbs: boolean): Pt | null {
  let col: number | null = null;
  let row: number | null = null;
  if (colText !== undefined) {
    col = colNumber(colText);
    if (col === 0) return null;
  }
  if (rowText !== undefined) {
    row = Number(rowText);
    if (row < 1 || row > MAX_ROWS) return null;
  }
  return { col, row, colAbs, rowAbs };
}

const CELL_AT = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/;
const COL_AT = /^(\$?)([A-Za-z]{1,3})/;
const ROW_AT = /^(\$?)(\d{1,7})/;

/** Reads a reference (`A1`, `$A$1:B2`, `A:C`, `2:5`) at the start of `text`; returns it and how many characters it used. */
function scanRef(text: string): { a: Pt; b?: Pt; length: number } | null {
  const afterIsName = (n: number) => n < text.length && (IDENT.test(text[n]!) || text[n] === "(");
  const cell = CELL_AT.exec(text);
  if (cell) {
    const a = pt(cell[2], cell[4], cell[1] === "$", cell[3] === "$");
    if (!a) return null;
    let n = cell[0].length;
    if (text[n] === ":") {
      const second = CELL_AT.exec(text.slice(n + 1));
      if (second) {
        const b = pt(second[2], second[4], second[1] === "$", second[3] === "$");
        if (b && !afterIsName(n + 1 + second[0].length)) return { a, b, length: n + 1 + second[0].length };
      }
    }
    return afterIsName(n) ? null : { a, length: n };
  }
  const col = COL_AT.exec(text);
  if (col && text[col[0].length] === ":") {
    const second = COL_AT.exec(text.slice(col[0].length + 1));
    if (second && !CELL_AT.test(text.slice(col[0].length + 1))) {
      const a = pt(col[2], undefined, col[1] === "$", false);
      const b = pt(second[2], undefined, second[1] === "$", false);
      const end = col[0].length + 1 + second[0].length;
      if (a && b && !afterIsName(end)) return { a, b, length: end };
    }
  }
  const row = ROW_AT.exec(text);
  if (row && text[row[0].length] === ":") {
    const second = ROW_AT.exec(text.slice(row[0].length + 1));
    if (second) {
      const a = pt(undefined, row[2], false, row[1] === "$");
      const b = pt(undefined, second[2], false, second[1] === "$");
      const end = row[0].length + 1 + second[0].length;
      if (a && b && !afterIsName(end) && text[end] !== ".") return { a, b, length: end };
    }
  }
  return null;
}

// ---- structured references: Table1[Amount], Table1[[#Headers],[Amount]], [@Amount] ----

/** Where the bracket that opens at `start` closes, with `'` escaping the character after it. */
function closingBracket(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'") i++;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

const unescapeColumn = (s: string) => s.replace(/'(.)/g, "$1");

/** Splits at the commas that aren't inside brackets. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "'") i++;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim());
}

const SPECIALS: Record<string, "data" | "all" | "headers" | "totals" | "row"> = { "#all": "all", "#data": "data", "#headers": "headers", "#totals": "totals", "#this row": "row" };

/** The columns of `[A]`, `[A]:[B]` or a bare `A`: first, and last if it is a span. */
function columnSpec(s: string, at: number): { from?: string; to?: string } {
  const t = s.trim();
  if (t === "") return {};
  if (t.startsWith("[")) {
    const end = closingBracket(t, 0);
    if (end < 0) throw new FormulaSyntaxError("A column isn't closed", at);
    const from = unescapeColumn(t.slice(1, end));
    const rest = t.slice(end + 1).trim();
    if (rest === "") return { from };
    if (!rest.startsWith(":")) throw new FormulaSyntaxError("Expected : between two columns", at);
    const second = rest.slice(1).trim();
    const e2 = closingBracket(second, 0);
    if (!second.startsWith("[") || e2 !== second.length - 1) throw new FormulaSyntaxError("Expected a column after :", at);
    return { from, to: unescapeColumn(second.slice(1, e2)) };
  }
  return { from: unescapeColumn(t) };
}

/** What is between the outer brackets of a structured reference. */
function structured(inner: string, at: number): { area: "data" | "all" | "headers" | "totals" | "row"; from?: string; to?: string } {
  const s = inner.trim();
  if (s.startsWith("@")) return { area: "row", ...columnSpec(s.slice(1), at) };
  if (s.startsWith("[")) {
    let area: "data" | "all" | "headers" | "totals" | "row" = "data";
    let cols: { from?: string; to?: string } = {};
    for (const item of splitTop(s)) {
      const special = /^\[(#[^\]]*)\]$/.exec(item);
      if (special) {
        const a = SPECIALS[special[1]!.toLowerCase()];
        if (!a) throw new FormulaSyntaxError(`Unknown table part ${special[1]}`, at);
        area = a;
      } else cols = columnSpec(item, at);
    }
    return { area, ...cols };
  }
  if (s.startsWith("#")) {
    const a = SPECIALS[s.toLowerCase()];
    if (!a) throw new FormulaSyntaxError(`Unknown table part ${s}`, at);
    return { area: a };
  }
  return { area: "data", from: unescapeColumn(s) };
}

function trefText(n: Extract<Node, { t: "tref" }>, file = false): string {
  const name = (n.sheet === undefined ? "" : /^\[[^\]]+\]$/.test(n.sheet) ? n.sheet : sheetRef(n.sheet) + "!") + (n.table ?? "");
  const esc = (c: string) => c.replace(/(['[\]#@])/g, "'$1");
  const cols = n.from === undefined ? "" : n.to === undefined ? `[${esc(n.from)}]` : `[${esc(n.from)}]:[${esc(n.to)}]`;
  if (n.area === "row") {
    // A file spells it out: Table1[[#This Row],[Qty]].
    if (file) return n.from === undefined ? `${name}[#This Row]` : `${name}[[#This Row],${cols}]`;
    if (n.from === undefined) return `${name}[@]`;
    if (n.to === undefined && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(n.from)) return `${name}[@${n.from}]`;
    return `${name}[@${cols}]`;
  }
  if (n.area === "data") {
    if (n.from === undefined) return name === "" ? "[#Data]" : name;
    return n.to === undefined ? `${name}[${esc(n.from)}]` : `${name}[${cols}]`;
  }
  const special = n.area === "all" ? "#All" : n.area === "headers" ? "#Headers" : "#Totals";
  return n.from === undefined ? `${name}[${special}]` : `${name}[[${special}],${cols}]`;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const at = i;
    if (c === '"') {
      let s = "";
      i++;
      for (;;) {
        if (i >= n) throw new FormulaSyntaxError("Text isn't closed", at);
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ k: "str", v: s, at });
      continue;
    }
    if (c === "#") {
      const code = ERROR_CODES.find((e) => src.slice(i, i + e.length).toUpperCase() === e);
      if (!code) throw new FormulaSyntaxError("Unknown error value", at);
      i += code.length;
      out.push({ k: "err", v: code, at });
      continue;
    }
    // A sheet name: 'quoted name'! or Name!
    let sheet: string | undefined;
    if (c === "'") {
      let s = "";
      i++;
      for (;;) {
        if (i >= n) throw new FormulaSyntaxError("Sheet name isn't closed", at);
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      if (src[i] !== "!") throw new FormulaSyntaxError("Expected ! after a sheet name", i);
      i++;
      sheet = s;
    } else if (c === "[") {
      // A sheet of another workbook, as Excel's cell formulas write it: [Prices.xlsx]Sheet1!A1 (or [1]Sheet1!A1 inside a file).
      // (`[@Qty]` and the like are table references, and carry on below.)
      const close = src.indexOf("]", i);
      let j = close + 1;
      while (close > i && j < n && IDENT.test(src[j]!)) j++;
      const inner = src.slice(i + 1, close);
      const book = close > i && !inner.includes("[") && !inner.startsWith("@") && !inner.startsWith("#");
      if (book && src[j] === "!" && j > close + 1) {
        sheet = src.slice(i, j);
        i = j + 1;
      } else if (book && src[close + 1] === "!" && IDENT_START.test(src[close + 2] ?? "")) {
        // `[1]!Orders[Total]`: a table of another workbook, with no sheet named (Excel's way of naming a workbook's own names).
        sheet = src.slice(i, close + 1);
        i = close + 2;
      } else if (book && src[j] === "[" && j > close + 1 && IDENT_START.test(src[close + 1]!)) {
        // `[Prices.xlsx]Orders[Total]`
        const end = closingBracket(src, j);
        if (end < 0) throw new FormulaSyntaxError("A table reference isn't closed", j);
        out.push({ k: "tref", node: { t: "tref", sheet: src.slice(i, close + 1), table: src.slice(close + 1, j), ...structured(src.slice(j + 1, end), j) }, at });
        i = end + 1;
        continue;
      }
    } else if (IDENT_START.test(c)) {
      let j = i;
      while (j < n && IDENT.test(src[j]!)) j++;
      if (src[j] === "!") {
        sheet = src.slice(i, j);
        i = j + 1;
      }
    }
    if (sheet !== undefined) {
      if (src[i] === "#") {
        const code = ERROR_CODES.find((e) => src.slice(i, i + e.length).toUpperCase() === e);
        if (!code) throw new FormulaSyntaxError("Unknown error value", i);
        i += code.length;
        out.push({ k: "err", v: code, at });
        continue;
      }
      // A table of that workbook, `Sheet1!Orders[Total]` or `[1]!Orders[Total]`.
      const tm = /^([A-Za-z_\\¡-￿][A-Za-z0-9_.\\¡-￿]*)\[/.exec(src.slice(i));
      if (tm) {
        const open = i + tm[1]!.length;
        const end = closingBracket(src, open);
        if (end < 0) throw new FormulaSyntaxError("A table reference isn't closed", open);
        out.push({ k: "tref", node: { t: "tref", ...(sheet.startsWith("[") ? { sheet } : {}), table: tm[1]!, ...structured(src.slice(open + 1, end), open) }, at });
        i = end + 1;
        continue;
      }
      const ref = scanRef(src.slice(i));
      if (!ref) throw new FormulaSyntaxError(`Expected a cell or range after "${sheet}!"`, i);
      i += ref.length;
      out.push({ k: "ref", node: { t: "ref", sheet, a: ref.a, ...(ref.b ? { b: ref.b } : {}) }, at });
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const ref = /^\$?\d/.test(src.slice(i)) ? scanRef(src.slice(i)) : null;
      if (ref && ref.b && ref.a.col === null) {
        i += ref.length;
        out.push({ k: "ref", node: { t: "ref", a: ref.a, b: ref.b }, at });
        continue;
      }
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaSyntaxError(`Unexpected "${c}"`, i);
      i += m[0].length;
      out.push({ k: "num", v: Number(m[0]), at });
      continue;
    }
    if (c === "$" || IDENT_START.test(c)) {
      const rest = src.slice(i);
      let j = i;
      while (j < n && (IDENT.test(src[j]!) || src[j] === "$")) j++;
      const word = src.slice(i, j);
      if (src[j] === "[" && c !== "$" && /^[A-Za-z_\\¡-￿][A-Za-z0-9_.\\¡-￿]*$/.test(word)) {
        const end = closingBracket(src, j);
        if (end < 0) throw new FormulaSyntaxError("A table reference isn't closed", j);
        out.push({ k: "tref", node: { t: "tref", table: word, ...structured(src.slice(j + 1, end), j) }, at });
        i = end + 1;
        continue;
      }
      if (src[j] === "(" && /^[A-Za-z_\\¡-￿][A-Za-z0-9_.\\¡-￿]*$/.test(word)) {
        out.push({ k: "func", v: word, at });
        i = j + 1;
        out.push({ k: "op", v: "(", at: j });
        continue;
      }
      const ref = scanRef(rest);
      if (ref) {
        i += ref.length;
        out.push({ k: "ref", node: { t: "ref", a: ref.a, ...(ref.b ? { b: ref.b } : {}) }, at });
        continue;
      }
      if (c === "$") throw new FormulaSyntaxError(`Unexpected "$"`, i);
      i = j;
      out.push({ k: "name", v: word, at });
      continue;
    }
    if (c === "[") {
      const end = closingBracket(src, i);
      if (end < 0) throw new FormulaSyntaxError("A table reference isn't closed", i);
      out.push({ k: "tref", node: { t: "tref", ...structured(src.slice(i + 1, end), i) }, at });
      i = end + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ k: "op", v: two, at });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%(),;{}:".includes(c)) {
      out.push({ k: "op", v: c, at });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected "${c}"`, i);
  }
  out.push({ k: "eof", at: n });
  return out;
}

class Parser {
  #t: Token[];
  #i = 0;
  constructor(tokens: Token[]) {
    this.#t = tokens;
  }

  get #peek(): Token {
    return this.#t[this.#i]!;
  }

  #isOp(v: string): boolean {
    const t = this.#peek;
    return t.k === "op" && t.v === v;
  }

  #expect(v: string): void {
    if (!this.#isOp(v)) throw new FormulaSyntaxError(`Expected "${v}"`, this.#peek.at);
    this.#i++;
  }

  parse(): Node {
    const node = this.#comparison();
    if (this.#peek.k !== "eof") throw new FormulaSyntaxError("Unexpected " + describe(this.#peek), this.#peek.at);
    return node;
  }

  #comparison(): Node {
    let left = this.#concat();
    for (;;) {
      const t = this.#peek;
      if (t.k === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.v)) {
        this.#i++;
        left = { t: "binary", op: t.v as BinaryOp, left, right: this.#concat() };
      } else return left;
    }
  }

  #concat(): Node {
    let left = this.#additive();
    while (this.#isOp("&")) {
      this.#i++;
      left = { t: "binary", op: "&", left, right: this.#additive() };
    }
    return left;
  }

  #additive(): Node {
    let left = this.#multiplicative();
    for (;;) {
      const t = this.#peek;
      if (t.k === "op" && (t.v === "+" || t.v === "-")) {
        this.#i++;
        left = { t: "binary", op: t.v, left, right: this.#multiplicative() };
      } else return left;
    }
  }

  #multiplicative(): Node {
    let left = this.#power();
    for (;;) {
      const t = this.#peek;
      if (t.k === "op" && (t.v === "*" || t.v === "/")) {
        this.#i++;
        left = { t: "binary", op: t.v, left, right: this.#power() };
      } else return left;
    }
  }

  /** `^` binds left to right in Excel, and the sign and percent bind tighter than it: `-2^2` is 4. */
  #power(): Node {
    let left = this.#percent();
    while (this.#isOp("^")) {
      this.#i++;
      left = { t: "binary", op: "^", left, right: this.#percent() };
    }
    return left;
  }

  #percent(): Node {
    let node = this.#unary();
    while (this.#isOp("%")) {
      this.#i++;
      node = { t: "percent", arg: node };
    }
    return node;
  }

  #unary(): Node {
    const t = this.#peek;
    if (t.k === "op" && (t.v === "-" || t.v === "+")) {
      this.#i++;
      return { t: "unary", op: t.v, arg: this.#unary() };
    }
    return this.#primary();
  }

  /** A value, or a function result called at once: `LAMBDA(x,x+1)(5)`, kept as a call with no name whose first argument is the function. */
  #primary(): Node {
    let node = this.#atom();
    while ((node.t === "call" || node.t === "paren") && this.#isOp("(")) {
      this.#i++;
      node = { t: "call", name: "", args: [node, ...this.#arguments()] };
    }
    return node;
  }

  /** The arguments of a call, after its "(" and up to and including the ")". */
  #arguments(): Node[] {
    const args: Node[] = [];
    if (this.#isOp(")")) {
      this.#i++;
      return args;
    }
    for (;;) {
      if (this.#isOp(",") || this.#isOp(")")) args.push({ t: "empty" });
      else args.push(this.#comparison());
      if (this.#isOp(",")) {
        this.#i++;
        continue;
      }
      this.#expect(")");
      return args;
    }
  }

  #atom(): Node {
    const t = this.#peek;
    switch (t.k) {
      case "num":
        this.#i++;
        return { t: "num", v: t.v };
      case "str":
        this.#i++;
        return { t: "str", v: t.v };
      case "err":
        this.#i++;
        return { t: "err", v: t.v };
      case "ref":
      case "tref":
        this.#i++;
        return t.node;
      case "name": {
        this.#i++;
        const up = t.v.toUpperCase();
        if (up === "TRUE") return { t: "bool", v: true };
        if (up === "FALSE") return { t: "bool", v: false };
        return { t: "name", name: t.v };
      }
      case "func": {
        this.#i += 2; // the name and its "("
        return { t: "call", name: t.v, args: this.#arguments() };
      }
      case "op": {
        if (t.v === "(") {
          this.#i++;
          const arg = this.#comparison();
          this.#expect(")");
          return { t: "paren", arg };
        }
        if (t.v === "{") return this.#arrayConstant();
        break;
      }
    }
    throw new FormulaSyntaxError("Unexpected " + describe(t), t.at);
  }

  #arrayConstant(): Node {
    this.#expect("{");
    const rows: Node[][] = [[]];
    for (;;) {
      let sign = 1;
      if (this.#isOp("-") || this.#isOp("+")) sign = (this.#peek as { v: string }).v === "-" ? -1 : 1, this.#i++;
      const t = this.#peek;
      let item: Node;
      if (t.k === "num") item = { t: "num", v: sign * t.v };
      else if (t.k === "str" && sign === 1) item = { t: "str", v: t.v };
      else if (t.k === "err" && sign === 1) item = { t: "err", v: t.v };
      else if (t.k === "name" && sign === 1 && /^(true|false)$/i.test(t.v)) item = { t: "bool", v: t.v.toLowerCase() === "true" };
      else throw new FormulaSyntaxError("An array can hold only numbers, text, TRUE, FALSE and errors", t.at);
      this.#i++;
      rows[rows.length - 1]!.push(item);
      if (this.#isOp(",")) this.#i++;
      else if (this.#isOp(";")) {
        this.#i++;
        rows.push([]);
      } else {
        this.#expect("}");
        break;
      }
    }
    const width = rows[0]!.length;
    if (rows.some((r) => r.length !== width)) throw new FormulaSyntaxError("Every row of an array needs the same number of items", 0);
    return { t: "array", rows };
  }
}

function describe(t: Token): string {
  switch (t.k) {
    case "eof":
      return "end of the formula";
    case "op":
      return `"${t.v}"`;
    case "num":
      return `number ${t.v}`;
    case "str":
      return "text";
    default:
      return "token";
  }
}

const cache = new Map<string, Node | FormulaSyntaxError>();

/** Reads a formula (without the leading `=`). Results are kept, so the same text is read once. */
export function parseFormula(source: string): Node {
  let hit = cache.get(source);
  if (hit === undefined) {
    try {
      hit = new Parser(tokenize(source)).parse();
    } catch (e) {
      if (!(e instanceof FormulaSyntaxError)) throw e;
      hit = e;
    }
    if (cache.size > 20000) cache.clear();
    cache.set(source, hit);
  }
  if (hit instanceof FormulaSyntaxError) throw hit;
  return hit;
}

// ---- writing a formula back out ----

const SIMPLE_NAME = /^[A-Za-z_\\¡-￿][A-Za-z0-9_.\\¡-￿]*$/;

export function sheetRef(name: string): string {
  // Another workbook's sheet reads `[Prices.xlsx]Sheet1`, quoted only when a name needs it.
  if (/^\[[A-Za-z0-9_.]+\][A-Za-z_][A-Za-z0-9_.]*$/.test(name)) return name;
  if (SIMPLE_NAME.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^[Rr]\d*[Cc]\d*$/.test(name) && !/^(true|false)$/i.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

function ptText(p: Pt, kind: "cell" | "col" | "row"): string {
  if (kind === "col") return `${p.colAbs ? "$" : ""}${colName(p.col!)}`;
  if (kind === "row") return `${p.rowAbs ? "$" : ""}${p.row}`;
  return `${p.colAbs ? "$" : ""}${colName(p.col!)}${p.rowAbs ? "$" : ""}${p.row}`;
}

export function refText(node: Extract<Node, { t: "ref" }>): string {
  const prefix = node.sheet !== undefined ? sheetRef(node.sheet) + "!" : "";
  const { a, b } = node;
  if (!b) return prefix + ptText(a, "cell");
  if (a.row === null) return `${prefix}${ptText(a, "col")}:${ptText(b, "col")}`;
  if (a.col === null) return `${prefix}${ptText(a, "row")}:${ptText(b, "row")}`;
  return `${prefix}${ptText(a, "cell")}:${ptText(b, "cell")}`;
}

function numberLiteral(n: number): string {
  return String(n);
}

/** The formula as text. With `file`, structured references are written the way an .xlsx file keeps them. */
export function printFormula(node: Node, file = false): string {
  switch (node.t) {
    case "num":
      return numberLiteral(node.v);
    case "str":
      return `"${node.v.replace(/"/g, '""')}"`;
    case "bool":
      return node.v ? "TRUE" : "FALSE";
    case "err":
      return node.v;
    case "ref":
      return refText(node);
    case "name":
      return node.name;
    case "tref":
      return trefText(node, file);
    case "call":
      if (node.name === "" && node.args.length > 0) return `${printFormula(node.args[0]!, file)}(${node.args.slice(1).map((a) => printFormula(a, file)).join(",")})`;
      return `${node.name}(${node.args.map((a) => printFormula(a, file)).join(",")})`;
    case "unary":
      return node.op + printFormula(node.arg, file);
    case "percent":
      return printFormula(node.arg, file) + "%";
    case "binary":
      return printFormula(node.left, file) + node.op + printFormula(node.right, file);
    case "paren":
      return `(${printFormula(node.arg, file)})`;
    case "array":
      return `{${node.rows.map((r) => r.map((c) => printFormula(c, file)).join(",")).join(";")}}`;
    case "empty":
      return "";
  }
}

export { MAX_COLS, MAX_ROWS };
