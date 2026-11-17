import { functionCatalog, functionInfo, type FunctionInfo } from "./catalog";
import { parseCell } from "./address";

export interface Suggestion {
  kind: "function" | "name";
  name: string;
  /** For a function, what is known about it. */
  info?: FunctionInfo;
}

/** What to offer someone typing a formula, given its text and where the caret is. */
export interface FormulaAssist {
  /** The name being typed at the caret, with what could complete it; absent when nothing is being typed or nothing matches. */
  completing?: {
    /** Where the text to be replaced starts and ends. */
    start: number;
    end: number;
    query: string;
    items: Suggestion[];
    /** Whether a `(` already follows, so accepting one shouldn't add another. */
    hasParen: boolean;
  };
  /** The function call the caret is inside of, and which argument it is in. */
  call?: {
    info: FunctionInfo;
    /** Which argument, counting from 0. */
    argIndex: number;
    /** Where the call's name starts. */
    start: number;
  };
}

/** The functions to show when someone has typed only `=`. */
const POPULAR = ["SUM", "AVERAGE", "IF", "COUNT", "MAX", "MIN", "VLOOKUP", "XLOOKUP", "SUMIF", "COUNTIF"];

const LIMIT = 10;

interface Open {
  name: string;
  start: number;
  arg: number;
}

/**
 * Works out what help a formula being typed can give: the functions and names that complete what is at the caret, and
 * the function the caret is inside, with the argument it is on. Text in quotes, cell references and sheet names are
 * left alone.
 */
export function assistFormula(text: string, caret: number, names: readonly string[] = []): FormulaAssist {
  if (!text.startsWith("=")) return {};
  const out: FormulaAssist = {};
  const stack: Open[] = [];
  let inString = false;
  let braces = 0;
  for (let i = 1; i < Math.min(caret, text.length); i++) {
    const c = text[i]!;
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "'") {
      // A quoted sheet name: skip to its end.
      const end = text.indexOf("'", i + 1);
      if (end < 0 || end >= caret) return out;
      i = end;
    } else if (c === "{") braces++;
    else if (c === "}") braces = Math.max(0, braces - 1);
    else if (c === "(") {
      const before = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(text.slice(1, i));
      stack.push({ name: before?.[0] ?? "", start: before ? i - before[0].length : i, arg: 0 });
    } else if (c === ")") stack.pop();
    else if ((c === "," || c === ";") && braces === 0 && stack.length) stack[stack.length - 1]!.arg++;
  }
  if (inString) return out;

  for (let k = stack.length - 1; k >= 0; k--) {
    const open = stack[k]!;
    const info = open.name ? functionInfo(open.name) : undefined;
    if (info) {
      out.call = { info, argIndex: open.arg, start: open.start };
      break;
    }
  }

  // The name being typed: letters, digits, dots and underscores run up to the caret, not part of a reference like Sheet1!A or A:B.
  const head = text.slice(0, caret);
  const word = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(head);
  if (!word) {
    if (head === "=") out.completing = { start: 1, end: 1, query: "", hasParen: false, items: POPULAR.map((n) => ({ kind: "function" as const, name: n, info: functionInfo(n)! })) };
    return out;
  }
  const start = caret - word[0].length;
  if (start > 1 && /[$!:'"0-9.]/.test(text[start - 1]!)) return out;
  if (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1]!)) return out;
  const tail = /^[A-Za-z0-9_.]*/.exec(text.slice(caret))![0];
  const end = caret + tail.length;
  const hasParen = text[end] === "(";
  const full = word[0] + tail;
  if (parseCell(full)) return out; // A1, $B$2 and the like are references
  const query = word[0].toUpperCase();
  if (hasParen && full.toUpperCase() === functionInfo(full)?.name) return out; // a whole name already
  const startsWith: Suggestion[] = [];
  const contains: Suggestion[] = [];
  for (const info of functionCatalog()) {
    if (info.name.startsWith(query)) startsWith.push({ kind: "function", name: info.name, info });
    else if (info.name.includes(query) && query.length >= 2) contains.push({ kind: "function", name: info.name, info });
  }
  const named = names.filter((n) => n.toUpperCase().startsWith(query) && !parseCell(n)).map((n): Suggestion => ({ kind: "name", name: n }));
  const items = [...startsWith, ...named, ...contains].slice(0, LIMIT);
  if (items.length === 0) return out;
  // Nothing left to complete: a defined name that is already typed in full.
  if (items.length === 1 && items[0]!.kind === "name" && items[0]!.name.toUpperCase() === full.toUpperCase()) return out;
  if (items.length === 1 && items[0]!.name.toUpperCase() === query && hasParen) return out;
  out.completing = { start, end, query, items, hasParen };
  return out;
}

/** The text and caret position after accepting a suggestion: the name replaces what was typed and gets its `(`. */
export function acceptSuggestion(text: string, completing: NonNullable<FormulaAssist["completing"]>, suggestion: Suggestion): { text: string; caret: number } {
  const insert = suggestion.kind === "function" && !completing.hasParen ? `${suggestion.name}(` : suggestion.name;
  const next = text.slice(0, completing.start) + insert + text.slice(completing.end);
  return { text: next, caret: completing.start + insert.length + (suggestion.kind === "function" && completing.hasParen ? 1 : 0) };
}

/** The syntax of a function in pieces, each tagged with the argument it belongs to, so the one being typed can be shown in bold. */
export function syntaxParts(info: FunctionInfo): { text: string; param?: number }[] {
  const parts: { text: string; param?: number }[] = [{ text: `${info.name}(` }];
  info.params.forEach((p, i) => {
    if (i > 0) parts.push({ text: ", " });
    parts.push({ text: p.optional ? `[${p.name}]` : p.name, param: i });
    if (p.repeats) parts.push({ text: ", …" });
  });
  parts.push({ text: ")" });
  return parts;
}

/** Which of a function's arguments (by position in `info.params`) the `argIndex`th typed argument is. */
export function currentParam(info: FunctionInfo, argIndex: number): number | undefined {
  if (info.params.length === 0) return undefined;
  if (argIndex < info.params.length) return argIndex;
  const last = info.params.length - 1;
  const lastParam = info.params[last]!;
  if (!lastParam.repeats) return undefined;
  // A repeated pair such as "[criteria_range2, criteria2]…" alternates between its two halves.
  return lastParam.name.includes(",") ? undefined : last;
}
