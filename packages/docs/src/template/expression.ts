/**
 * The small language inside `{{ … }}`: values from the answers, comparisons, `and` / `or` / `not`, a little arithmetic and
 * filters (`{{ total | currency }}`). It is parsed and run here, never handed to `eval`, so a template can't do anything but read
 * the answers it was given.
 */

export class TemplateError extends Error {
  readonly kind: "syntax" | "filter" | "type";
  constructor(kind: "syntax" | "filter" | "type", message: string) {
    super(message);
    this.name = "TemplateError";
    this.kind = kind;
  }
}

export type Literal = string | number | boolean | null;

export type Segment = { k: "key"; name: string } | { k: "index"; expr: Expr };

export type Expr =
  | { t: "lit"; v: Literal }
  | { t: "path"; head: string; rest: Segment[] }
  | { t: "un"; op: "!" | "-"; e: Expr }
  | { t: "bin"; op: BinaryOp; l: Expr; r: Expr }
  | { t: "pipe"; e: Expr; filter: string; args: Expr[] };

export type BinaryOp = "||" | "&&" | "??" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "+" | "-" | "*" | "/" | "%";

// ---- reading the text ----

type Token =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "end" };

const OPERATORS = ["||", "&&", "??", "==", "!=", "<=", ">=", "<", ">", "!", "+", "-", "*", "/", "%", "(", ")", "[", "]", ".", ",", ":", "|"];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let value = "";
      i++;
      let closed = false;
      while (i < source.length) {
        const c = source[i]!;
        if (c === "\\" && i + 1 < source.length) {
          const next = source[i + 1]!;
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      if (!closed) throw new TemplateError("syntax", "A quoted text is not closed");
      tokens.push({ k: "str", v: value });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const match = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i))!;
      tokens.push({ k: "num", v: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_$@]/.test(ch)) {
      const match = /^[A-Za-z_$@][\w$]*/.exec(source.slice(i))!;
      tokens.push({ k: "id", v: match[0] });
      i += match[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new TemplateError("syntax", `Unexpected "${ch}"`);
    tokens.push({ k: "op", v: op });
    i += op.length;
  }
  tokens.push({ k: "end" });
  return tokens;
}

// ---- turning it into a tree ----

const WORD_OPS: Record<string, BinaryOp | "not"> = { and: "&&", or: "||", in: "in", not: "not" };

class Parser {
  #tokens: Token[];
  #i = 0;
  constructor(tokens: Token[]) {
    this.#tokens = tokens;
  }

  get #peek(): Token {
    return this.#tokens[this.#i]!;
  }

  #isOp(value: string): boolean {
    const t = this.#peek;
    return t.k === "op" && t.v === value;
  }

  #isWord(value: string): boolean {
    const t = this.#peek;
    return t.k === "id" && t.v === value;
  }

  #expectOp(value: string): void {
    if (!this.#isOp(value)) throw new TemplateError("syntax", `Expected "${value}"${this.#describeNext()}`);
    this.#i++;
  }

  #describeNext(): string {
    const t = this.#peek;
    return t.k === "end" ? " but the expression ended" : ` but found "${t.k === "str" ? JSON.stringify(t.v) : t.v}"`;
  }

  parse(): Expr {
    const e = this.#pipeline();
    if (this.#peek.k !== "end") throw new TemplateError("syntax", `Unexpected ${this.#describeNext().replace(/^ but found /, "")}`);
    return e;
  }

  #pipeline(): Expr {
    let e = this.#nullish();
    while (this.#isOp("|")) {
      this.#i++;
      const name = this.#peek;
      if (name.k !== "id") throw new TemplateError("syntax", `Expected the name of a filter after "|"`);
      this.#i++;
      const args: Expr[] = [];
      if (this.#isOp(":")) {
        this.#i++;
        args.push(this.#nullish());
        while (this.#isOp(",")) {
          this.#i++;
          args.push(this.#nullish());
        }
      }
      e = { t: "pipe", e, filter: name.v, args };
    }
    return e;
  }

  #nullish(): Expr {
    let l = this.#or();
    while (this.#isOp("??")) {
      this.#i++;
      l = { t: "bin", op: "??", l, r: this.#or() };
    }
    return l;
  }

  #or(): Expr {
    let l = this.#and();
    while (this.#isOp("||") || this.#isWord("or")) {
      this.#i++;
      l = { t: "bin", op: "||", l, r: this.#and() };
    }
    return l;
  }

  #and(): Expr {
    let l = this.#not();
    while (this.#isOp("&&") || this.#isWord("and")) {
      this.#i++;
      l = { t: "bin", op: "&&", l, r: this.#not() };
    }
    return l;
  }

  #not(): Expr {
    if (this.#isOp("!") || this.#isWord("not")) {
      this.#i++;
      return { t: "un", op: "!", e: this.#not() };
    }
    return this.#compare();
  }

  #compare(): Expr {
    const l = this.#sum();
    const t = this.#peek;
    if (t.k === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      this.#i++;
      return { t: "bin", op: t.v as BinaryOp, l, r: this.#sum() };
    }
    if (this.#isWord("in")) {
      this.#i++;
      return { t: "bin", op: "in", l, r: this.#sum() };
    }
    // `x not in list`
    if (this.#isWord("not") && this.#tokens[this.#i + 1]?.k === "id" && (this.#tokens[this.#i + 1] as { v: string }).v === "in") {
      this.#i += 2;
      return { t: "un", op: "!", e: { t: "bin", op: "in", l, r: this.#sum() } };
    }
    return l;
  }

  #sum(): Expr {
    let l = this.#product();
    while (this.#isOp("+") || this.#isOp("-")) {
      const op = (this.#peek as { v: string }).v as BinaryOp;
      this.#i++;
      l = { t: "bin", op, l, r: this.#product() };
    }
    return l;
  }

  #product(): Expr {
    let l = this.#unary();
    while (this.#isOp("*") || this.#isOp("/") || this.#isOp("%")) {
      const op = (this.#peek as { v: string }).v as BinaryOp;
      this.#i++;
      l = { t: "bin", op, l, r: this.#unary() };
    }
    return l;
  }

  #unary(): Expr {
    if (this.#isOp("-")) {
      this.#i++;
      return { t: "un", op: "-", e: this.#unary() };
    }
    return this.#primary();
  }

  #primary(): Expr {
    const t = this.#peek;
    if (t.k === "num") {
      this.#i++;
      return { t: "lit", v: t.v };
    }
    if (t.k === "str") {
      this.#i++;
      return { t: "lit", v: t.v };
    }
    if (t.k === "op" && t.v === "(") {
      this.#i++;
      const e = this.#pipeline();
      this.#expectOp(")");
      return e;
    }
    if (t.k === "id") {
      if (t.v === "true" || t.v === "false") {
        this.#i++;
        return { t: "lit", v: t.v === "true" };
      }
      if (t.v === "null") {
        this.#i++;
        return { t: "lit", v: null };
      }
      if (t.v in WORD_OPS || t.v === "as") throw new TemplateError("syntax", `"${t.v}" is a keyword and can't be used as a name here`);
      this.#i++;
      const rest: Segment[] = [];
      for (;;) {
        if (this.#isOp(".")) {
          this.#i++;
          const name = this.#peek;
          if (name.k !== "id" && name.k !== "num") throw new TemplateError("syntax", `Expected a name after "."`);
          this.#i++;
          rest.push({ k: "key", name: String(name.v) });
        } else if (this.#isOp("[")) {
          this.#i++;
          const expr = this.#pipeline();
          this.#expectOp("]");
          rest.push({ k: "index", expr });
        } else break;
      }
      return { t: "path", head: t.v, rest };
    }
    throw new TemplateError("syntax", t.k === "end" ? "The expression ended too soon" : `Unexpected ${this.#describeNext().replace(/^ but found /, "")}`);
  }
}

/** Reads an expression. Throws a `TemplateError` that says what is wrong with it. */
export function parseExpression(source: string): Expr {
  if (source.trim() === "") throw new TemplateError("syntax", "There is nothing between the braces");
  return new Parser(tokenize(source)).parse();
}

// ---- running it ----

/** What a filter needs to know about how the document should read. */
export interface FilterContext {
  locale: string | undefined;
  currency: string;
  timeZone: string | undefined;
  now: Date;
}

/**
 * A filter changes a value: `{{ name | upper }}`, `{{ price | currency:"EUR" }}`. It gets the value (`undefined` when there is
 * none), the arguments written after the colon, and how the document should read. Throw an `Error` to say the value is not
 * one it can work with; the placeholder is then left in the document and reported.
 */
export type TemplateFilter = (value: unknown, args: unknown[], context: FilterContext) => unknown;

/** A place to look names up: the loop the text is in, and then the answers. */
export interface Scope {
  frame: Record<string, unknown>;
  parent: Scope | null;
}

export interface Environment {
  filters: Record<string, TemplateFilter>;
  context: FilterContext;
}

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export function lookup(scope: Scope | null, name: string): unknown {
  for (let s = scope; s; s = s.parent) {
    if (own(s.frame, name) && s.frame[name] !== undefined) return s.frame[name];
  }
  return undefined;
}

function member(value: unknown, key: string | number): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (key === "length") return value.length;
    const n = typeof key === "number" ? key : /^\d+$/.test(key) ? Number(key) : NaN;
    return Number.isInteger(n) && n >= 0 ? value[n] : undefined;
  }
  if (typeof value === "string") {
    if (key === "length") return value.length;
    return undefined;
  }
  if (typeof value === "object") {
    if (value instanceof Date) return undefined;
    const k = String(key);
    return own(value, k) ? (value as Record<string, unknown>)[k] : undefined;
  }
  return undefined;
}

/** Whether a value counts as "yes" in a condition. Nothing, `false`, `0`, `""` and an empty list are no. */
export function truthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const numeric = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
};

/** The date a value stands for: a `Date`, milliseconds, or a date written `2026-11-18` (taken as that day where the reader is). */
export function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (day) {
      const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
      return d.getMonth() === Number(day[2]) - 1 ? d : null;
    }
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value.trim())) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

/** Whether two values are the same answer. A number and the same number written as text are. */
export function same(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null) return b === undefined || b === null;
  if (b === undefined || b === null) return false;
  if (typeof a === typeof b) {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return a === b;
  }
  if ((typeof a === "number" && typeof b === "string") || (typeof a === "string" && typeof b === "number")) return String(a) === String(b);
  return false;
}

function order(a: unknown, b: unknown): number | null {
  const x = numeric(a);
  const y = numeric(b);
  if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0;
  const da = asDate(a);
  const db = asDate(b);
  if (da && db) return Math.sign(da.getTime() - db.getTime());
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

/** Runs an expression. A name with no answer gives `undefined`. A filter that can't work with its value throws a `TemplateError`. */
export function evaluate(expr: Expr, scope: Scope | null, env: Environment): unknown {
  switch (expr.t) {
    case "lit":
      return expr.v;
    case "path": {
      let value = lookup(scope, expr.head);
      for (const seg of expr.rest) {
        const key = seg.k === "key" ? seg.name : evaluate(seg.expr, scope, env);
        if (typeof key !== "string" && typeof key !== "number") return undefined;
        value = member(value, key);
        if (value === undefined) return undefined;
      }
      return value;
    }
    case "un": {
      const v = evaluate(expr.e, scope, env);
      if (expr.op === "!") return !truthy(v);
      const n = numeric(v);
      if (n === null) {
        if (v === undefined || v === null) return undefined;
        throw new TemplateError("type", "Only a number can be made negative");
      }
      return -n;
    }
    case "pipe": {
      const value = evaluate(expr.e, scope, env);
      const filter = env.filters[expr.filter];
      if (!filter) throw new TemplateError("filter", `There is no filter called "${expr.filter}"`);
      const args = expr.args.map((a) => evaluate(a, scope, env));
      try {
        return filter(value, args, env.context);
      } catch (error) {
        if (error instanceof TemplateError) throw error;
        throw new TemplateError("filter", `${expr.filter}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    case "bin": {
      if (expr.op === "||") {
        const l = evaluate(expr.l, scope, env);
        return truthy(l) ? l : evaluate(expr.r, scope, env);
      }
      if (expr.op === "&&") {
        const l = evaluate(expr.l, scope, env);
        return truthy(l) ? evaluate(expr.r, scope, env) : l;
      }
      if (expr.op === "??") {
        const l = evaluate(expr.l, scope, env);
        return l === undefined || l === null ? evaluate(expr.r, scope, env) : l;
      }
      const l = evaluate(expr.l, scope, env);
      const r = evaluate(expr.r, scope, env);
      switch (expr.op) {
        case "==":
          return same(l, r);
        case "!=":
          return !same(l, r);
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const c = order(l, r);
          if (c === null) return false;
          return expr.op === "<" ? c < 0 : expr.op === "<=" ? c <= 0 : expr.op === ">" ? c > 0 : c >= 0;
        }
        case "in":
          if (Array.isArray(r)) return r.some((item) => same(l, item));
          if (typeof r === "string") return typeof l === "string" || typeof l === "number" ? r.includes(String(l)) : false;
          return false;
        case "+": {
          const a = numeric(l);
          const b = numeric(r);
          if (a !== null && b !== null && typeof l !== "string" && typeof r !== "string") return a + b;
          if (l === undefined || l === null) return r;
          if (r === undefined || r === null) return l;
          if (a !== null && b !== null) return a + b;
          return String(l) + String(r);
        }
        case "-":
        case "*":
        case "/":
        case "%": {
          const a = numeric(l);
          const b = numeric(r);
          if (a === null || b === null) {
            if (l === undefined || l === null || r === undefined || r === null) return undefined;
            throw new TemplateError("type", `"${expr.op}" works on numbers`);
          }
          if (expr.op === "-") return a - b;
          if (expr.op === "*") return a * b;
          if (b === 0) throw new TemplateError("type", "Can't divide by zero");
          return expr.op === "/" ? a / b : a % b;
        }
      }
      return undefined;
    }
  }
}
