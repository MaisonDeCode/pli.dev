import { PliError } from "@pli.dev/core";
import { wildcardSource } from "./functions/helpers";
import type { Cell, CellStyle } from "./model";

/** Where and how to look for text. */
export interface FindOptions {
  /** What to look for. `*` stands for any text and `?` for any one character (`~*` is a star), unless `regex` is set. */
  text: string;
  matchCase?: boolean;
  /** The whole cell must be the text, not just contain it. */
  wholeCell?: boolean;
  /** Read `text` as a regular expression. A replacement can then use `$1` for a group and `$&` for the match. */
  regex?: boolean;
  /**
   * `values` looks at what the cells show, `formulas` at what was typed in them (`=SUM(A1:A3)`), `notes` at the text of
   * the cells' notes (Excel's "Notes"/"Comments"). Default `values`. Replacing works on what was typed, or on the notes.
   */
  lookIn?: "values" | "formulas" | "notes";
  /** One sheet (or part of it), or every sheet that isn't hidden (default). */
  scope?: "workbook" | { sheet: string; range?: string };
  /** The order the cells come in. Default `rows`. */
  by?: "rows" | "columns";
  /** Also look in hidden sheets (only when `scope` is the workbook). */
  hidden?: boolean;
  /** Only cells that hold an error (`#DIV/0!`, `#N/A`…). With empty `text` every one of them is found; with text, the ones whose error text matches. */
  errors?: boolean;
  /** Only cells with this look. Every property given must match; with empty `text` every cell with that look is found, empty or not. */
  format?: FindFormat;
}

/** A look to find: each property that is given must be what the cell has. A colour is `#rrggbb`, and `fill: "none"` means no fill. */
export interface FindFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fill?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  align?: "left" | "center" | "right";
  /** The number format code. */
  fmt?: string;
}

/** Whether a cell has the look. */
export function hasFormat(cell: Cell | undefined, want: FindFormat): boolean {
  const s: CellStyle = cell?.s ?? {};
  const flag = (k: "bold" | "italic" | "underline" | "strike") => want[k] === undefined || !!s[k] === want[k];
  const same = (a: string | undefined, b: string | undefined) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
  return (
    flag("bold") &&
    flag("italic") &&
    flag("underline") &&
    flag("strike") &&
    (want.fill === undefined || same(s.fill ?? "none", want.fill)) &&
    (want.color === undefined || same(s.color ?? "auto", want.color)) &&
    (want.fontFamily === undefined || same(s.fontFamily, want.fontFamily)) &&
    (want.fontSize === undefined || s.fontSize === want.fontSize) &&
    (want.align === undefined || (s.align ?? "") === want.align) &&
    (want.fmt === undefined || (cell?.fmt ?? "General").toLowerCase() === want.fmt.toLowerCase())
  );
}

/** A matcher that accepts any text, for searches by error or by look with nothing to look for. */
export const MATCH_ANY: Matcher = { test: () => true, replace: (text) => ({ text, count: 0 }), edits: () => [] };

/** A cell that has the text. `sheet` is the sheet's id. */
export interface FoundCell {
  sheet: string;
  address: string;
  /** What was looked at: the shown text, the typed one, or the note. */
  text: string;
  /** `"note"` when the text found is a note's (`lookIn: "notes"`). */
  in?: "note";
}

export interface ReplaceResult {
  /** Cells that changed. */
  cells: number;
  /** Places in them where the text was replaced. */
  occurrences: number;
  /** Cells that have the text but could not take the change: a checkbox or a strict dropdown that would refuse it, or a column name in a table that would be empty or a copy of another. */
  skipped: number;
}

export interface Matcher {
  test(text: string): boolean;
  /** `text` with every match replaced, and how many there were. */
  replace(text: string, replacement: string): { text: string; count: number };
  /** Where each match is in `text` and what it would be replaced with (the replacement with `$1` and the like worked out). */
  edits(text: string, replacement: string): { start: number; end: number; text: string }[];
}

/** The replacement for one match of a regular expression: `$1` for a group, `$<name>`, `$&` for the match, `` $` `` and `$'` for the text around it, `$$` for a dollar. */
function withGroups(m: RegExpExecArray, text: string, replacement: string): string {
  const groups = m.slice(1) as (string | undefined)[];
  const named = (m.groups ?? {}) as Record<string, string | undefined>;
  return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (whole, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return m[0];
    if (token === "`") return text.slice(0, m.index);
    if (token === "'") return text.slice(m.index + m[0].length);
    if (token.startsWith("<")) return named[token.slice(1, -1)] ?? "";
    const n = Number(token);
    return n >= 1 && n <= groups.length ? (groups[n - 1] ?? "") : whole;
  });
}

/** A matcher for the options, or null when there is nothing to look for. Throws on a regular expression that doesn't parse. */
export function matcherOf(o: FindOptions): Matcher | null {
  if (o.text === "") return null;
  const source = o.regex ? o.text : wildcardSource(o.text);
  const body = o.wholeCell ? `^(?:${source})$` : source;
  const flags = o.matchCase ? "" : "i";
  let all: RegExp;
  let one: RegExp;
  try {
    all = new RegExp(body, flags + "g");
    one = new RegExp(body, flags);
  } catch {
    throw new PliError("invalid_operation", `"${o.text}" is not a pattern that can be searched for`);
  }
  const expand = (text: string, replacement: string): { start: number; end: number; text: string }[] => {
    const edits: { start: number; end: number; text: string }[] = [];
    all.lastIndex = 0;
    for (let m = all.exec(text); m; m = all.exec(text)) {
      if (m[0] === "") {
        // An empty match (a pattern such as `x*`) is replaced too, once, and the search moves on a character.
        all.lastIndex++;
      }
      edits.push({ start: m.index, end: m.index + m[0].length, text: o.regex ? withGroups(m, text, replacement) : replacement });
    }
    return edits;
  };
  return {
    test: (text) => one.test(text),
    replace(text, replacement) {
      const edits = expand(text, replacement);
      let out = "";
      let at = 0;
      for (const e of edits) {
        out += text.slice(at, e.start) + e.text;
        at = e.end;
      }
      return { text: out + text.slice(at), count: edits.length };
    },
    edits: expand,
  };
}

/** What was typed into the cell: the formula with its `=`, or the value as it would be typed. */
export function typedText(cell: Cell): string {
  if (cell.f !== undefined) return "=" + cell.f;
  if (cell.v === undefined) return cell.e ?? "";
  if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
  return String(cell.v);
}
