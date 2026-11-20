import type { Expr } from "./expression";
import { scan } from "./tags";

/**
 * What a `{{ … }}` does: shows an answer (`value`), starts, continues or ends a condition or a list (`block`), or can't be read
 * (`error`).
 */
export type PlaceholderKind = "value" | "block" | "error";

/** One `{{ … }}` found in a text. */
export interface Placeholder {
  /** Where it starts and ends in the text. `text.slice(from, to)` is the tag as written, braces included. */
  from: number;
  to: number;
  kind: PlaceholderKind;
  /** For an `error`: what is wrong with it. */
  message?: string;
}

/**
 * Finds the tags in a text, so an editor can draw them as chips. It reads them the same way `generateDocument` does, so what is
 * drawn as a tag is a tag, and a tag that can't be read is an `error`. A text with no `{{` in it costs nothing.
 */
export function placeholdersIn(text: string): Placeholder[] {
  if (!text.includes("{{")) return [];
  const found: Placeholder[] = [];
  for (const piece of scan(text)) {
    if (piece.type === "tag") found.push({ from: piece.from, to: piece.to, kind: piece.tag.k === "out" ? "value" : "block" });
    else if (piece.type === "bad") found.push({ from: piece.from, to: piece.to, kind: "error", message: piece.error.message });
  }
  return found;
}

/** What to put in a document for the parts of a template that aren't a plain answer. */
export type PlaceholderSnippet = "if" | "each";

/**
 * The text of a condition or a list to put in a document: the opening and closing tag, each on a line of its own, with a line
 * between them for what goes inside. Returns the lines, and the number of the one to put the caret on.
 */
export function placeholderSnippet(kind: PlaceholderSnippet, subject = ""): { lines: string[]; caret: number } {
  const name = subject.trim();
  if (kind === "if") return { lines: [`{{#if ${name || "condition"}}}`, "", "{{/if}}"], caret: 1 };
  return { lines: [`{{#each ${name || "list"} as item}}`, "", "{{/each}}"], caret: 1 };
}

// ---- where an answer is ----

/**
 * The parts of an answer's path, whichever way it is written: `client.name` and `client["name"]` are both `["client", "name"]`, and
 * `answer["q-id"]` is `["answer", "q-id"]`.
 */
export function placeholderPathParts(path: string): string[] {
  const text = path.trim();
  const parts: string[] = [];
  let word = "";
  const flush = () => {
    if (word !== "") parts.push(word);
    word = "";
  };
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (ch === ".") {
      flush();
      i++;
      continue;
    }
    if (ch === "[") {
      const quoted = /^\[\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\]/.exec(text.slice(i));
      if (quoted) {
        flush();
        parts.push((quoted[1] ?? quoted[2]!).replace(/\\(.)/g, "$1"));
        i += quoted[0].length;
        continue;
      }
    }
    word += ch;
    i++;
  }
  flush();
  return parts;
}

const plainKey = /^(?:[A-Za-z_$][\w$]*|\d+)$/;

/**
 * An answer's path as it has to be written inside a tag to be read back: a dot for each level when the name allows it, and brackets
 * when it doesn't. `answer.q-id` becomes `answer["q-id"]`, since `answer.q-id` would be read as `answer.q` minus `id`. The editor
 * uses this for every tag it inserts, and to find the name of a tag it draws, so both agree whichever way a path was given.
 */
export function placeholderPath(path: string): string {
  const parts = placeholderPathParts(path);
  return parts.length === 0 ? path.trim() : writePath(parts);
}

const writePath = ([head, ...keys]: string[]): string =>
  head + keys.map((key) => (plainKey.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`)).join("");

// ---- saying a tag in plain words ----

/** Names for answers: a map from where an answer is (`client.name`) to what to call it, or a function that gives the name. */
export type PlaceholderNames = Readonly<Record<string, string>> | ((path: string) => string | undefined);

/** `clientName` and `client_name` become "Client name". */
function humanize(word: string): string {
  const spaced = word.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced === "" ? word : spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** A name that stands for the item of a list, not an answer: `item.name`, `this.name`, `s.name`. */
const isItem = (head: string): boolean => head === "item" || head === "this" || head.length <= 1;

const normalised = new WeakMap<object, Map<string, string>>();

/** The names of a record, found by the path as {@link placeholderPath} writes it. */
function namesFor(names: Readonly<Record<string, string>> | undefined): Map<string, string> {
  if (!names) return new Map();
  let found = normalised.get(names);
  if (!found) {
    found = new Map();
    for (const [path, name] of Object.entries(names)) found.set(placeholderPath(path), name);
    normalised.set(names, found);
  }
  return found;
}

function pathText(expr: Expr & { t: "path" }, names: PlaceholderNames | undefined): string {
  const keys: string[] = [];
  for (const segment of expr.rest) {
    if (segment.k === "key") keys.push(segment.name);
    else if (segment.expr.t === "lit" && typeof segment.expr.v === "string") keys.push(segment.expr.v);
    else break;
  }
  const full = [expr.head, ...keys];
  const named = (path: string[]) => {
    // A name can be given for `answer.q-id` or for `answer["q-id"]`; either finds it.
    if (typeof names === "function") return names(path.join(".")) ?? names(writePath(path));
    return namesFor(names).get(writePath(path));
  };
  // `@today` and `@number` are things the document knows, not answers.
  if (expr.head === "@today") return "today's date";
  if (expr.head === "@number") return "the item's number";
  if (expr.head === "@index") return "the item's place";
  if (expr.head === "@count") return "the number of items";
  const direct = named(full);
  if (direct !== undefined) return direct;
  // Inside a list, `s.name` is the item's `name`.
  const inItem = full.length > 1 && isItem(full[0]!);
  const own = inItem ? full.slice(1) : full;
  const item = inItem ? named(own) : undefined;
  if (item !== undefined) return item;
  return humanize(own.join(" "));
}

/** Whether a smaller part of a condition needs brackets to be read the way it was written. */
function needsBrackets(parent: Expr & { t: "bin" }, child: Expr): boolean {
  if (child.t !== "bin") return false;
  // `a and b or c` is read as `(a and b) or c`; the other way round needs the brackets said.
  if (parent.op === "&&") return child.op === "||" || child.op === "??";
  if (parent.op === "||" || parent.op === "??") return false;
  return true;
}

function say(expr: Expr, names: PlaceholderNames | undefined): string {
  switch (expr.t) {
    case "path":
      return pathText(expr, names);
    case "lit":
      return expr.v === null ? "empty" : String(expr.v);
    case "pipe": {
      // `plural:"seat","seats"` is a word that depends on a count, not the count itself.
      const [one, many] = expr.args;
      if (expr.filter === "plural" && one?.t === "lit" && many?.t === "lit") return `${one.v}/${many.v}`;
      // Any other filter changes how an answer is written, not which one it is.
      return say(expr.e, names);
    }
    case "un":
      return expr.op === "!" ? `not ${say(expr.e, names)}` : `-${say(expr.e, names)}`;
    case "bin": {
      const part = (child: Expr) => (needsBrackets(expr, child) ? `(${say(child, names)})` : say(child, names));
      const words: Partial<Record<typeof expr.op, string>> = {
        "==": "is",
        "!=": "is not",
        ">": "is more than",
        "<": "is less than",
        ">=": "is at least",
        "<=": "is at most",
        "&&": "and",
        "||": "or",
        "??": "or",
      };
      if (expr.op === "in") return `${part(expr.r)} includes ${part(expr.l)}`;
      return `${part(expr.l)} ${words[expr.op] ?? expr.op} ${part(expr.r)}`;
    }
  }
}

/**
 * Says what a tag does in plain words, for an editor that shows the words and not the code. `{{ client.name }}` is "Client name",
 * `{{#if plan == "team"}}` is "Only if Plan is team", `{{else}}` is "Otherwise" and `{{/if}}` is "End". `names` gives the words for
 * your own answers; the rest are made from their names (`clientName` is "Client name"). Returns `undefined` for a tag that can't
 * be read, which an editor should show as written.
 */
export function describePlaceholder(tag: string, names?: PlaceholderNames): string | undefined {
  const [piece] = scan(tag.trim());
  if (!piece || piece.type !== "tag") return undefined;
  const t = piece.tag;
  const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  switch (t.k) {
    case "out":
      return upper(say(t.expr, names));
    case "if":
      return `Only if ${say(t.expr, names)}`;
    case "elseif":
      return `Otherwise, if ${say(t.expr, names)}`;
    case "else":
      return "Otherwise";
    case "each":
      return `For each item in ${say(t.expr, names)}`;
    case "end":
      return t.what === "each" ? "End of list" : "End";
  }
}
