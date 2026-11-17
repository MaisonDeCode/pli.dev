import { PliError } from "@pli.dev/core";
import { parseRange, rangeAddress, type Bounds } from "./address";
import type { Calculator } from "./calc";
import { parseFormula, FormulaSyntaxError } from "./formula";
import { MAX_SNAPSHOT_ITEMS, offered, parseExternalRef } from "./external-list";
import { formulaReadsOtherWorkbook } from "./external-links";
import type { CellRuleOperator, ListSnapshot, Sheet, Validation } from "./model";
import { shiftFormula } from "./refs";
import { CELL_OPERATORS, ruleBounds } from "./rule";
import { isError, type Value } from "./values";

export const VALIDATION_KINDS = ["whole", "decimal", "date", "time", "textLength", "list", "custom"] as const;
export const VALIDATION_ALERTS = ["stop", "warning", "information", "none"] as const;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

function checkFormula(what: string, f: unknown): string {
  if (typeof f !== "string" || f.trim() === "") bad(`${what} can't be empty`);
  const text = (f as string).replace(/^\s*=\s*/, "");
  try {
    parseFormula(text);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) bad(`${what} isn't a formula Pli can read: ${e.message}`);
    throw e;
  }
  return text;
}

/** A validation made ready to keep: checks it, writes ranges the plain way, and drops what says nothing. */
export function cleanValidation(rule: Validation): Validation {
  if (!rule || typeof rule.id !== "string" || rule.id === "") bad("A validation needs an id");
  if (!Array.isArray(rule.ranges) || rule.ranges.length === 0) bad("A validation needs at least one range");
  const ranges = rule.ranges.map((r) => {
    const b = typeof r === "string" ? parseRange(r.replace(/\$/g, "")) : null;
    if (!b) bad(`"${String(r)}" is not a range`);
    return rangeAddress(b!);
  });
  if (rule.alert !== undefined && !VALIDATION_ALERTS.includes(rule.alert)) bad(`An alert is one of ${VALIDATION_ALERTS.join(", ")}`);
  const text = (k: "errorTitle" | "error" | "promptTitle" | "prompt") => {
    const v = rule[k];
    if (v !== undefined && typeof v !== "string") bad(`${k} is text`);
    return v ? { [k]: v } : {};
  };
  const base = {
    id: rule.id,
    ranges,
    ...(rule.noBlank ? { noBlank: true as const } : {}),
    ...(rule.alert && rule.alert !== "stop" ? { alert: rule.alert } : {}),
    ...text("errorTitle"),
    ...text("error"),
    ...text("promptTitle"),
    ...text("prompt"),
  };
  switch (rule.kind) {
    case "whole":
    case "decimal":
    case "date":
    case "time":
    case "textLength": {
      if (!CELL_OPERATORS.includes(rule.op)) bad(`A comparison is one of ${CELL_OPERATORS.join(", ")}`);
      const two = rule.op === "between" || rule.op === "notBetween";
      if (!Array.isArray(rule.values) || rule.values.length !== (two ? 2 : 1)) bad(two ? "A between rule needs two values" : "A comparison needs one value");
      return { ...base, kind: rule.kind, op: rule.op, values: rule.values.map((v) => checkFormula("A value", String(v))) };
    }
    case "list": {
      if (typeof rule.source !== "string" || rule.source.trim() === "") bad("The list can't be empty");
      // A range in another workbook is kept as written; the host reads it (or the snapshot stands in).
      const external = parseExternalRef(rule.source);
      const source = external ? rule.source.trim().replace(/^=/, "") : checkFormula("The list", rule.source);
      if (!external && parseFormula(source).t === "str") bad("A list is read from cells; typed choices belong in a dropdown cell");
      if (rule.multiple !== undefined && rule.multiple !== true) bad("multiple is true or missing");
      if (rule.separator !== undefined && (typeof rule.separator !== "string" || rule.separator === "" || rule.separator.length > 8)) bad("A separator is one to eight characters");
      if (rule.snapshot !== undefined && !external) bad("A snapshot belongs to a list read from another workbook");
      return {
        ...base,
        kind: "list",
        source,
        ...(rule.hideArrow ? { hideArrow: true as const } : {}),
        ...(rule.multiple ? { multiple: true as const, ...(rule.separator !== undefined && rule.separator !== DEFAULT_SEPARATOR ? { separator: rule.separator } : {}) } : {}),
        ...(rule.snapshot ? { snapshot: cleanSnapshot(rule.snapshot) } : {}),
      };
    }
    case "custom":
      return { ...base, kind: "custom", formula: checkFormula("The formula", rule.formula) };
    default:
      return bad(`Unknown kind of validation "${String((rule as { kind?: unknown }).kind)}"`);
  }
}

/** What joins several items in a cell when a list says nothing else. */
export const DEFAULT_SEPARATOR = ", ";

function cleanSnapshot(snapshot: ListSnapshot): ListSnapshot {
  if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length > MAX_SNAPSHOT_ITEMS || snapshot.items.some((i) => typeof i !== "string")) bad("A snapshot holds a list of text items");
  if (snapshot.read !== undefined && (typeof snapshot.read !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.read))) bad("A snapshot's date is written like 2026-11-09");
  if (snapshot.path !== undefined && (typeof snapshot.path !== "string" || snapshot.path.length > 2000)) bad("A snapshot's path is text");
  return { items: snapshot.items.slice(), ...(snapshot.read ? { read: snapshot.read } : {}), ...(snapshot.path ? { path: snapshot.path } : {}) };
}

/** The items in a cell of a list that allows several: split on the separator (ignoring spaces around it), empty ones left out. */
export function itemsInCell(text: string, separator: string = DEFAULT_SEPARATOR): string[] {
  const bare = separator.trim() === "" ? separator : separator.trim();
  return text.split(bare).map((t) => t.trim()).filter((t) => t !== "");
}

/** Applies `fn` to every formula of a validation. The same rule comes back when nothing changes. */
export function mapValidationFormulas(rule: Validation, fn: (f: string) => string): Validation {
  switch (rule.kind) {
    case "list": {
      if (parseExternalRef(rule.source)) return rule; // a range in another workbook doesn't move with this one
      const source = fn(rule.source);
      return source === rule.source ? rule : { ...rule, source };
    }
    case "custom": {
      const formula = fn(rule.formula);
      return formula === rule.formula ? rule : { ...rule, formula };
    }
    default: {
      const values = rule.values.map(fn);
      return values.every((v, i) => v === rule.values[i]) ? rule : { ...rule, values };
    }
  }
}

const OP_WORDS: Record<CellRuleOperator, (v: string[]) => string> = {
  between: (v) => `between ${v[0]} and ${v[1]}`,
  notBetween: (v) => `not between ${v[0]} and ${v[1]}`,
  equal: (v) => `equal to ${v[0]}`,
  notEqual: (v) => `not equal to ${v[0]}`,
  greaterThan: (v) => `greater than ${v[0]}`,
  greaterThanOrEqual: (v) => `greater than or equal to ${v[0]}`,
  lessThan: (v) => `less than ${v[0]}`,
  lessThanOrEqual: (v) => `less than or equal to ${v[0]}`,
};

/** What a rule asks for, in a sentence, as the message of a refused entry when the rule has none of its own. */
export function describeValidation(rule: Validation): string {
  switch (rule.kind) {
    case "whole":
      return `Enter a whole number ${OP_WORDS[rule.op](rule.values)}.`;
    case "decimal":
      return `Enter a number ${OP_WORDS[rule.op](rule.values)}.`;
    case "date":
      return `Enter a date ${OP_WORDS[rule.op](rule.values)}.`;
    case "time":
      return `Enter a time ${OP_WORDS[rule.op](rule.values)}.`;
    case "textLength":
      return `Enter text whose length is ${OP_WORDS[rule.op](rule.values)}.`;
    case "list":
      return rule.multiple ? "Choose one or more of the values in the list." : "Choose one of the values in the list.";
    case "custom":
      return "That entry doesn't meet the rule for this cell.";
  }
}

export interface EntryContext {
  /** Works out formulas as the workbook is now. */
  calc: Calculator;
  sheet: Sheet;
  row: number;
  col: number;
  /** For a custom formula: works out formulas as the workbook would be with the entry in. */
  candidate?: () => Calculator;
}

/** Where a rule's relative references start: its top-left cell. */
export function validationOrigin(rule: Validation): { row: number; col: number } {
  const all = ruleBounds(rule.ranges);
  return { row: Math.min(...all.map((b: Bounds) => b.r1)), col: Math.min(...all.map((b: Bounds) => b.c1)) };
}

function at(rule: Validation, f: string, ctx: EntryContext, calc: Calculator): Value {
  const o = validationOrigin(rule);
  let formula = f;
  try {
    formula = shiftFormula(f, ctx.row - o.row, ctx.col - o.col);
  } catch {
    // an unreadable formula is worked out as it is, and gives an error
  }
  return calc.evaluateAt(ctx.sheet.id, ctx.row, ctx.col, formula);
}

/** The values a list rule offers for a cell, as text, in order. */
export function listChoices(rule: Extract<Validation, { kind: "list" }>, ctx: EntryContext): string[] {
  // A range in another workbook offers the copy kept with the rule; without one, the cells kept of that workbook.
  if (parseExternalRef(rule.source) && rule.snapshot) return offered(rule.snapshot);
  const o = validationOrigin(rule);
  let formula = rule.source;
  try {
    formula = shiftFormula(rule.source, ctx.row - o.row, ctx.col - o.col);
  } catch {
    return [];
  }
  const grid = ctx.calc.evaluateGrid(ctx.sheet.id, ctx.row, ctx.col, formula);
  const out: string[] = [];
  for (const row of grid) for (const v of row) if (v !== null && !isError(v) && v !== "") out.push(String(v));
  return out;
}

/** Whether a rule's formula reads another workbook, directly or through a defined name that does. */
function readsElsewhere(f: string, ctx: EntryContext): boolean {
  if (formulaReadsOtherWorkbook(f)) return true;
  return Object.entries(ctx.calc.workbook.names ?? {}).some(([name, def]) => formulaReadsOtherWorkbook(def) && new RegExp(`(^|[^A-Za-z0-9_.])${name.replace(/[.\\]/g, "\\$&")}($|[^A-Za-z0-9_.(])`, "i").test(f));
}

const compare = (op: CellRuleOperator, v: number, a: number, b?: number): boolean => {
  switch (op) {
    case "between": return v >= a && v <= b!;
    case "notBetween": return v < a || v > b!;
    case "equal": return v === a;
    case "notEqual": return v !== a;
    case "greaterThan": return v > a;
    case "greaterThanOrEqual": return v >= a;
    case "lessThan": return v < a;
    case "lessThanOrEqual": return v <= a;
  }
};

/** Whether an entry (a typed value, or null for emptying the cell) is allowed by the rule. */
export function entryAllowed(rule: Validation, entry: number | string | boolean | null, ctx: EntryContext): boolean {
  if (entry === null || entry === "") return !rule.noBlank;
  switch (rule.kind) {
    case "whole":
    case "decimal":
    case "date":
    case "time": {
      if (typeof entry !== "number") return false;
      if (rule.kind === "whole" && !Number.isInteger(entry)) return false;
      if ((rule.kind === "date" || rule.kind === "time") && entry < 0) return false;
      const a = at(rule, rule.values[0]!, ctx, ctx.calc);
      const b = rule.values[1] === undefined ? undefined : at(rule, rule.values[1], ctx, ctx.calc);
      // A limit read from a workbook that was never read can't be checked: the entry goes in.
      if ((isError(a) && readsElsewhere(rule.values[0]!, ctx)) || (isError(b as Value) && readsElsewhere(rule.values[1]!, ctx))) return true;
      if (typeof a !== "number" || (rule.values[1] !== undefined && typeof b !== "number")) return false;
      return compare(rule.op, entry, a, b as number | undefined);
    }
    case "textLength": {
      const a = at(rule, rule.values[0]!, ctx, ctx.calc);
      const b = rule.values[1] === undefined ? undefined : at(rule, rule.values[1], ctx, ctx.calc);
      if ((isError(a) && readsElsewhere(rule.values[0]!, ctx)) || (isError(b as Value) && readsElsewhere(rule.values[1]!, ctx))) return true;
      if (typeof a !== "number" || (rule.values[1] !== undefined && typeof b !== "number")) return false;
      return compare(rule.op, String(entry).length, a, b as number | undefined);
    }
    case "list": {
      const choices = new Set(listChoices(rule, ctx).map((c) => c.toLowerCase()));
      const text = String(entry);
      if (choices.has(text.toLowerCase())) return true;
      if (!rule.multiple) return false;
      // Several items in one cell: every one of them must be in the list.
      const parts = itemsInCell(text, rule.separator);
      return parts.length > 0 && parts.every((p) => choices.has(p.toLowerCase()));
    }
    case "custom": {
      const v = at(rule, rule.formula, ctx, ctx.candidate ? ctx.candidate() : ctx.calc);
      if (isError(v) && readsElsewhere(rule.formula, ctx)) return true;
      return v === true || (typeof v === "number" && v !== 0);
    }
  }
}

/** What the person is told about a refused entry. */
export interface EntryProblem {
  alert: "stop" | "warning" | "information";
  title: string;
  message: string;
}

export function problemOf(rule: Validation): EntryProblem | null {
  if (rule.alert === "none") return null;
  return { alert: rule.alert ?? "stop", title: rule.errorTitle ?? "Invalid entry", message: rule.error ?? describeValidation(rule) };
}
