import { isTextBlock, type Block, type CellBlock, type Doc, type Run } from "../model";
import { REGION_NAMES } from "../regions";
import { plainText } from "../runs";
import type { Expr } from "./expression";
import type { TemplateIssue } from "./generate";
import { nest, scan, type Flat, type Node, type Tag } from "./tags";

/** What a template does with an answer. */
export type FieldUse =
  /** It is shown in the text: `{{ client.name }}`. */
  | "value"
  /** It decides whether some text is there: `{{#if plan == "pro"}}`. */
  | "condition"
  /** It is a list the text repeats for: `{{#each services as service}}`. */
  | "list";

/** The kind of answer a field most likely wants, worked out from how the template uses it. */
export type FieldType = "text" | "number" | "date" | "boolean" | "list";

/** One answer a template asks for. */
export interface TemplateField {
  /** Where it is in the answers, with a dot for each level: `client.name`. Inside a list's `fields` it is relative to an item: `name`. */
  path: string;
  uses: FieldUse[];
  /**
   * The kind of answer it wants. Taken from the filters (`| date` is a date, `| currency` a number), from comparisons with numbers,
   * and from being used only in conditions (a yes or no). Text when nothing says otherwise.
   */
  type: FieldType;
  /** The values the template compares it with (`plan == "pro"`, `plan == "team"` gives `["pro", "team"]`): the choices it knows what to do with. */
  options?: (string | number | boolean)[];
  /** For a list: what each item needs. */
  fields?: TemplateField[];
}

export interface TemplateAnalysis {
  /** The answers the template uses, in the order it first uses them. */
  fields: TemplateField[];
  /** Mistakes found without needing any answers: tags that can't be read, and conditions or lists that aren't closed. */
  issues: TemplateIssue[];
}

const NUMBER_FILTERS = new Set(["number", "currency", "percent", "round", "ordinal", "plural", "sum"]);
const DATE_FILTERS = new Set(["date"]);

/** Every text in a document that can hold a tag, in reading order. */
function* texts(doc: Pick<Doc, "title" | "blocks" | "footnotes"> & Partial<Record<(typeof REGION_NAMES)[number], Block[]>>): Generator<{ text: string; block?: string }> {
  yield { text: doc.title };
  const runs = (list: readonly Run[], block: string) => {
    const text = plainText(list);
    return { text, block };
  };
  function* walk(blocks: readonly (Block | CellBlock)[]): Generator<{ text: string; block?: string }> {
    for (const block of blocks) {
      if (block.type === "code_block") continue;
      if (isTextBlock(block as Block)) {
        const list = (block as { runs: Run[] }).runs;
        yield runs(list, block.id);
        for (const run of list) if (run.marks?.link) yield { text: run.marks.link, block: block.id };
      } else if (block.type === "image") {
        yield { text: block.src, block: block.id };
        if (block.alt) yield { text: block.alt, block: block.id };
      } else if (block.type === "table") {
        for (const row of block.rows) for (const cell of row.cells) if (!cell.covered) yield* walk(cell.blocks);
      } else if (block.type === "section_break" && block.regions) {
        for (const region of Object.values(block.regions)) yield* walk(region ?? []);
      }
    }
  }
  yield* walk(doc.blocks);
  for (const name of REGION_NAMES) yield* walk(doc[name] ?? []);
  for (const note of Object.values(doc.footnotes ?? {})) yield* walk(note);
}

interface Entry {
  path: string;
  uses: FieldUse[];
  kinds: Set<FieldType>;
  options?: (string | number | boolean)[];
  /** For a list: the fields of its items. */
  children?: Map<string, Entry>;
}

/** Where names are looked up while reading: the answers, and each list the text is inside. */
interface Frame {
  alias: string | undefined;
  fields: Map<string, Entry>;
}

const VALUE_OPERATORS = new Set(["+", "-", "*", "/", "%", "??", "||", "&&"]);

/**
 * Finds the answers a template asks for, without any answers: which names it uses, how, and which choices its conditions know
 * about. Use it to build a questionnaire from a template, to check that a questionnaire you already have covers one, or to see
 * what a template has wrong before anyone fills it in.
 */
export function templateFields(template: Pick<Doc, "title" | "blocks" | "footnotes"> & Partial<Record<(typeof REGION_NAMES)[number], Block[]>>): TemplateAnalysis {
  const issues: TemplateIssue[] = [];
  const flat: Flat<Expr> = [];
  for (const { text, block } of texts(template)) {
    if (!text.includes("{{")) continue;
    for (const piece of scan(text)) {
      if (piece.type === "bad") issues.push({ type: piece.error.kind, message: piece.error.message, tag: piece.raw, ...(block !== undefined && { block }) });
      else if (piece.type === "tag") {
        if (piece.tag.k === "out") flat.push({ kind: "leaf", leaf: piece.tag.expr });
        else flat.push({ kind: "tag", tag: piece.tag as Tag, at: { raw: piece.raw, block } });
      }
    }
  }
  const tree = nest(flat, (message, at) => issues.push({ type: "syntax", message, tag: at.raw, ...(at.block !== undefined && { block: at.block }) }));

  const root: Frame = { alias: undefined, fields: new Map() };

  /** The entry for a name. Inside a list, a name that starts with the list's alias (or `this`) is one of its items' fields. */
  const entryFor = (frames: readonly Frame[], head: string, rest: string[]): Entry | null => {
    if (head.startsWith("@")) return null;
    let frame = root;
    let path = [head, ...rest];
    for (let i = frames.length - 1; i >= 1; i--) {
      const f = frames[i]!;
      const self = head === "this" || head === f.alias;
      // Without an alias, any name is taken as a field of the item.
      if (self || f.alias === undefined) {
        frame = f;
        path = self ? rest : path;
        break;
      }
    }
    // The length of a list is not an answer of its own.
    if (path.length > 1 && path[path.length - 1] === "length") path = path.slice(0, -1);
    if (path.length === 0) return null;
    const key = path.join(".");
    let entry = frame.fields.get(key);
    if (!entry) {
      entry = { path: key, uses: [], kinds: new Set() };
      frame.fields.set(key, entry);
    }
    return entry;
  };

  const keys = (expr: Expr & { t: "path" }): string[] => {
    const out: string[] = [];
    for (const s of expr.rest) {
      if (s.k === "key") out.push(s.name);
      else if (s.expr.t === "lit" && typeof s.expr.v === "number") out.push("[]");
      else if (s.expr.t === "lit" && typeof s.expr.v === "string") out.push(s.expr.v);
      else break;
    }
    return out;
  };

  const find = (frames: readonly Frame[], expr: Expr): Entry | null => (expr.t === "path" ? entryFor(frames, expr.head, keys(expr)) : null);

  /** Notes every name an expression reads, and how it is used. */
  const visit = (expr: Expr, frames: readonly Frame[], as: FieldUse, hint?: FieldType): void => {
    switch (expr.t) {
      case "lit":
        return;
      case "path": {
        const entry = entryFor(frames, expr.head, keys(expr));
        if (entry) {
          if (!entry.uses.includes(as)) entry.uses.push(as);
          if (hint) entry.kinds.add(hint);
        }
        for (const seg of expr.rest) if (seg.k === "index") visit(seg.expr, frames, "value");
        return;
      }
      case "un":
        visit(expr.e, frames, as === "value" && expr.op === "-" ? "value" : as, expr.op === "-" ? "number" : hint);
        return;
      case "pipe": {
        const kind: FieldType | undefined = NUMBER_FILTERS.has(expr.filter) ? "number" : DATE_FILTERS.has(expr.filter) ? "date" : hint;
        visit(expr.e, frames, as, kind);
        for (const arg of expr.args) visit(arg, frames, "value");
        return;
      }
      case "bin": {
        // `plan == "pro"` says "pro" is a choice for plan.
        if (expr.op === "==" || expr.op === "!=" || expr.op === "in") {
          const choice = (path: Expr, literal: Expr) => {
            const entry = path.t === "path" && literal.t === "lit" && literal.v !== null ? find(frames, path) : null;
            if (entry && literal.t === "lit" && literal.v !== null) {
              const options = (entry.options ??= []);
              if (!options.includes(literal.v)) options.push(literal.v);
            }
          };
          choice(expr.l, expr.r);
          choice(expr.r, expr.l);
        }
        const arithmetic = ["-", "*", "/", "%"].includes(expr.op);
        const compare = ["<", "<=", ">", ">="].includes(expr.op);
        const hintFor = (other: Expr): FieldType | undefined => (arithmetic || (compare && other.t === "lit" && typeof other.v === "number") ? "number" : undefined);
        const use: FieldUse = as === "value" && VALUE_OPERATORS.has(expr.op) ? "value" : "condition";
        visit(expr.l, frames, use, hintFor(expr.r));
        visit(expr.r, frames, use, hintFor(expr.l));
        return;
      }
    }
  };

  const walk = (nodes: readonly Node<Expr>[], frames: readonly Frame[]): void => {
    for (const node of nodes) {
      if (node.k === "leaf") visit(node.leaf, frames, "value");
      else if (node.k === "if") {
        for (const branch of node.branches) {
          if (branch.cond) visit(branch.cond, frames, "condition");
          walk(branch.body, frames);
        }
      } else {
        // The list itself, then its items: the names inside are the items' own.
        const list = find(frames, node.expr);
        if (list) {
          if (!list.uses.includes("list")) list.uses.push("list");
          list.kinds.add("list");
          list.children ??= new Map();
        } else visit(node.expr, frames, "list");
        walk(node.body, [...frames, { alias: node.alias, fields: list?.children ?? new Map() }]);
      }
    }
  };
  walk(tree, [root]);

  const finish = (e: Entry): TemplateField => {
    const onlyConditions = e.uses.length > 0 && e.uses.every((u) => u === "condition");
    const type: FieldType = e.kinds.has("list") ? "list" : e.kinds.has("date") ? "date" : e.kinds.has("number") ? "number" : onlyConditions && !e.options ? "boolean" : "text";
    return {
      path: e.path,
      uses: e.uses,
      type,
      ...(e.options && { options: e.options }),
      ...(e.children && { fields: [...e.children.values()].map(finish) }),
    };
  };
  return { fields: [...root.fields.values()].map(finish), issues };
}
