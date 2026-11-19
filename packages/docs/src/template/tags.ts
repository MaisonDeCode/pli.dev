import { TemplateError, parseExpression, type Expr } from "./expression";

/**
 * Finding the `{{ … }}` in text, and nesting what is between them. A tag is one of:
 *
 * - `{{ expression }}`: shows a value.
 * - `{{#if expression}}`, `{{#elseif expression}}`, `{{else}}`, `{{/if}}`: text that is only there when something is true.
 * - `{{#unless expression}}` … `{{/unless}}`: the opposite.
 * - `{{#each list as name}}` … `{{/each}}`: text that is repeated for each item in a list.
 */

export type Tag =
  | { k: "out"; expr: Expr }
  | { k: "if"; expr: Expr }
  | { k: "elseif"; expr: Expr }
  | { k: "else" }
  | { k: "each"; expr: Expr; alias?: string }
  | { k: "end"; what: "if" | "each" };

/** A piece of a text: ordinary characters, a tag, or a tag that couldn't be read (which is left as written). */
export type Piece =
  | { type: "text"; from: number; to: number }
  | { type: "tag"; from: number; to: number; raw: string; tag: Tag }
  | { type: "bad"; from: number; to: number; raw: string; error: TemplateError };

/** Where `}}` ends the tag that started at `from`, not counting one inside a quoted text. Returns -1 if it never ends. */
function closeOf(text: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 2; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "}" && text[i + 1] === "}") return i;
  }
  return -1;
}

const cache = new Map<string, Tag | TemplateError>();

function readTag(inner: string): Tag {
  const text = inner.trim();
  let m: RegExpExecArray | null;
  if ((m = /^#if\s+([\s\S]+)$/.exec(text))) return { k: "if", expr: parseExpression(m[1]!) };
  if ((m = /^#unless\s+([\s\S]+)$/.exec(text))) return { k: "if", expr: { t: "un", op: "!", e: parseExpression(m[1]!) } };
  if ((m = /^(?:#elseif|elseif|#else\s+if|else\s+if)\s+([\s\S]+)$/.exec(text))) return { k: "elseif", expr: parseExpression(m[1]!) };
  if (/^#?else$/.test(text)) return { k: "else" };
  if ((m = /^#each\s+([\s\S]+?)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(text))) {
    return { k: "each", expr: parseExpression(m[1]!), ...(m[2] !== undefined && { alias: m[2] }) };
  }
  if ((m = /^\/(if|unless|each)$/.exec(text))) return { k: "end", what: m[1] === "each" ? "each" : "if" };
  if (/^[#/]/.test(text)) throw new TemplateError("syntax", `"${text.split(/\s/)[0]}" is not something a template can do. Use #if, #unless, #each, else and their closing /if, /unless, /each`);
  return { k: "out", expr: parseExpression(text) };
}

/** Cuts a text into pieces. Text with no `{{` in it is one piece. */
export function scan(text: string): Piece[] {
  // Word and some editors turn straight quotes into curly ones as you type. The same length, so places still line up.
  const straight = text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const pieces: Piece[] = [];
  let at = 0;
  const literal = (to: number) => {
    if (to > at) pieces.push({ type: "text", from: at, to });
  };
  while (at < text.length) {
    const open = straight.indexOf("{{", at);
    if (open < 0) break;
    const close = closeOf(straight, open);
    literal(open);
    if (close < 0) {
      // A `{{` that is never closed is left as it is, and reported; what comes after it is read as usual.
      pieces.push({ type: "bad", from: open, to: open + 2, raw: "{{", error: new TemplateError("syntax", "{{ is never closed with }}") });
      at = open + 2;
      continue;
    }
    const end = close + 2;
    const raw = text.slice(open, end);
    const inner = straight.slice(open + 2, close);
    let parsed = cache.get(inner);
    if (parsed === undefined) {
      try {
        parsed = readTag(inner);
      } catch (error) {
        parsed = error instanceof TemplateError ? error : new TemplateError("syntax", String(error));
      }
      if (cache.size > 2000) cache.clear();
      cache.set(inner, parsed);
    }
    pieces.push(parsed instanceof TemplateError ? { type: "bad", from: open, to: end, raw, error: parsed } : { type: "tag", from: open, to: end, raw, tag: parsed });
    at = end;
  }
  literal(text.length);
  return pieces;
}

/** Whether a text has anything in it that is a tag. */
export const hasTags = (text: string): boolean => text.includes("{{");

// ---- nesting ----

/** Where a tag was written: the text of the tag, and the block it is in (for telling people where a mistake is). */
export interface Where {
  raw: string;
  block?: string;
}

/** A list of things and tags, in the order they come: what `nest` reads. */
export type Flat<L> = ({ kind: "leaf"; leaf: L } | { kind: "tag"; tag: Tag; at: Where })[];

export type Node<L> =
  | { k: "leaf"; leaf: L }
  | { k: "if"; branches: { cond: Expr | null; body: Node<L>[]; at: Where }[] }
  | { k: "each"; expr: Expr; alias: string | undefined; body: Node<L>[]; at: Where };

type Open<L> = { node: Node<L> & ({ k: "if" } | { k: "each" }); body: Node<L>[]; at: Where };

/**
 * Nests a flat list: what comes between `{{#if}}` and `{{/if}}` goes inside the condition. Mistakes (a closing tag with nothing
 * to close, a condition never closed) are passed to `problem` and then dealt with so the rest still comes out: a closing tag with
 * nothing to close is dropped, and a condition left open runs to the end.
 */
export function nest<L>(flat: Flat<L>, problem: (message: string, at: Where) => void): Node<L>[] {
  const root: Node<L>[] = [];
  const stack: Open<L>[] = [];
  const here = () => (stack.length > 0 ? stack[stack.length - 1]!.body : root);
  for (const item of flat) {
    if (item.kind === "leaf") {
      here().push({ k: "leaf", leaf: item.leaf });
      continue;
    }
    const { tag } = item;
    switch (tag.k) {
      case "out":
        // Only the callers that deal with values make these: a value is a leaf for them.
        break;
      case "if": {
        const body: Node<L>[] = [];
        const node: Node<L> = { k: "if", branches: [{ cond: tag.expr, body, at: item.at }] };
        here().push(node);
        stack.push({ node, body, at: item.at });
        break;
      }
      case "each": {
        const body: Node<L>[] = [];
        const node: Node<L> = { k: "each", expr: tag.expr, alias: tag.alias, body, at: item.at };
        here().push(node);
        stack.push({ node, body, at: item.at });
        break;
      }
      case "elseif":
      case "else": {
        const top = stack[stack.length - 1];
        if (!top || top.node.k !== "if") {
          problem(`${item.at.raw} comes where no {{#if}} is open`, item.at);
          break;
        }
        const branches = top.node.branches;
        if (branches[branches.length - 1]!.cond === null) {
          problem(`${item.at.raw} comes after {{else}}, which has to be last`, item.at);
          break;
        }
        const body: Node<L>[] = [];
        branches.push({ cond: tag.k === "else" ? null : tag.expr, body, at: item.at });
        top.body = body;
        break;
      }
      case "end": {
        const top = stack[stack.length - 1];
        if (!top || top.node.k !== tag.what) {
          problem(`${item.at.raw} closes nothing${top ? `: the open ${top.at.raw} has to be closed first` : ""}`, item.at);
          break;
        }
        stack.pop();
        break;
      }
    }
  }
  for (const open of stack.reverse()) problem(`${open.at.raw} is never closed`, open.at);
  return root;
}
