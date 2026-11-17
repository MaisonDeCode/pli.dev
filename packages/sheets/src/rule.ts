import { PliError } from "@pli.dev/core";
import { parseRange, rangeAddress, type Bounds } from "./address";
import { parseFormula, FormulaSyntaxError } from "./formula";
import { MAX_COLS, MAX_ROWS, type Border, type BorderStyle, type CellBorders, type CellRuleOperator, type CfValue, type ConditionalRule, type ConditionalStyle, type DatePeriod, type IconRef, type IconSetName, type RulePivot, type Sheet, type TextRuleOperator } from "./model";

export const BORDER_STYLES: readonly BorderStyle[] = ["thin", "medium", "thick", "dashed", "dotted", "double", "hair"];
export const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;
/** The four sides and the two diagonals: every line a cell can have. */
export const BORDER_LINES = ["top", "right", "bottom", "left", "diagonalUp", "diagonalDown"] as const;

/** How many icons each icon set has. */
export const ICON_SETS: Readonly<Record<IconSetName, number>> = {
  "3Arrows": 3, "3ArrowsGray": 3, "3Flags": 3, "3TrafficLights1": 3, "3TrafficLights2": 3, "3Signs": 3, "3Symbols": 3, "3Symbols2": 3,
  "4Arrows": 4, "4ArrowsGray": 4, "4RedToBlack": 4, "4Rating": 4, "4TrafficLights": 4,
  "5Arrows": 5, "5ArrowsGray": 5, "5Rating": 5, "5Quarters": 5, "3Stars": 3, "3Triangles": 3, "5Boxes": 5,
};

export const CELL_OPERATORS: readonly CellRuleOperator[] = ["greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "equal", "notEqual", "between", "notBetween"];
export const TEXT_OPERATORS: readonly TextRuleOperator[] = ["contains", "notContains", "beginsWith", "endsWith"];
export const DATE_PERIODS: readonly DatePeriod[] = ["yesterday", "today", "tomorrow", "last7Days", "lastWeek", "thisWeek", "nextWeek", "lastMonth", "thisMonth", "nextMonth"];

const COLOR = /^#[0-9a-fA-F]{6}$/;
const STYLE_KEYS = ["bold", "italic", "underline", "strike", "color", "fill", "border", "fmt", "fontFamily", "fontSize"] as const;
const VALUE_TYPES = ["min", "max", "num", "percent", "percentile", "formula"];

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A border made ready to keep: checks it, and leaves out a black colour that the default says anyway. */
export function cleanBorder(b: Border): Border {
  if (!b || !BORDER_STYLES.includes(b.style)) bad(`A border style is one of ${BORDER_STYLES.join(", ")}`);
  if (b.color !== undefined && !COLOR.test(b.color)) bad("A border colour looks like #rrggbb");
  return { style: b.style, ...(b.color && b.color.toLowerCase() !== "#000000" ? { color: b.color.toLowerCase() } : {}) };
}

/** The four sides of a cell made ready to keep; null when none is left. */
export function cleanBorders(borders: CellBorders): CellBorders | null {
  const out: CellBorders = {};
  for (const k of Object.keys(borders)) if (!(BORDER_LINES as readonly string[]).includes(k)) bad(`A border is on the top, right, bottom or left, or a diagonal, not "${k}"`);
  for (const side of BORDER_LINES) if (borders[side]) out[side] = cleanBorder(borders[side]!);
  return Object.keys(out).length ? out : null;
}

export function cleanStyle(style: ConditionalStyle): ConditionalStyle {
  if (!style || typeof style !== "object") bad("A conditional format needs a style");
  const out: ConditionalStyle = {};
  for (const [k, v] of Object.entries(style)) {
    if (!(STYLE_KEYS as readonly string[]).includes(k)) bad(`A conditional format can change ${STYLE_KEYS.join(", ")}, not "${k}"`);
    if (v === undefined) continue;
    if (k === "color" || k === "fill") {
      if (typeof v !== "string" || !COLOR.test(v)) bad(`A ${k} looks like #rrggbb`);
      (out as Record<string, unknown>)[k] = (v as string).toLowerCase();
    } else if (k === "border") {
      const b = cleanBorders(v as CellBorders);
      if (b) out.border = b;
    } else if (k === "fmt" || k === "fontFamily") {
      if (typeof v !== "string") bad(`${k} is text`);
      if (v !== "") (out as Record<string, unknown>)[k] = v;
    } else if (k === "fontSize") {
      if (typeof v !== "number" || !(v >= 1 && v <= 400)) bad("A font size is a number from 1 to 400");
      out.fontSize = v as number;
    } else {
      if (typeof v !== "boolean") bad(`${k} is true or false`);
      if (v) (out as Record<string, unknown>)[k] = true;
    }
  }
  return out;
}

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

function cleanValue(what: string, v: CfValue, auto = false): CfValue {
  if (!v || !(VALUE_TYPES.includes(v.type) || (auto && v.type === "auto"))) bad(`${what}: a point is one of ${VALUE_TYPES.join(", ")}${auto ? ", auto" : ""}`);
  if (v.type === "min" || v.type === "max" || v.type === "auto") return { type: v.type };
  if (v.type === "formula") return { type: "formula", value: checkFormula(what, v.value) };
  if (typeof v.value !== "number" || !Number.isFinite(v.value)) bad(`${what}: a ${v.type} point needs a number`);
  if ((v.type === "percent" || v.type === "percentile") && ((v.value as number) < 0 || (v.value as number) > 100)) bad(`${what}: a ${v.type} is from 0 to 100`);
  return { type: v.type, value: v.value as number };
}

function cleanRulePivot(p: RulePivot): RulePivot {
  if (!p || typeof p.id !== "string" || p.id === "") bad("A rule for a pivot table names the pivot table by its id");
  if (p.value !== undefined && !(Number.isInteger(p.value) && p.value >= 0)) bad("A pivot rule's value is the number of a value field, counting from 0");
  for (const k of ["rows", "columns"] as const) if (p[k] !== undefined && (typeof p[k] !== "string" || p[k] === "")) bad(`A pivot rule's ${k} is the name of a field`);
  let items: Record<string, string[]> | undefined;
  if (p.items !== undefined) {
    if (!p.items || typeof p.items !== "object" || Array.isArray(p.items)) bad("A pivot rule's items are the labels of the items to cover, for each field");
    items = {};
    for (const [field, labels] of Object.entries(p.items)) {
      if (field === "" || !Array.isArray(labels) || labels.length === 0 || labels.some((l) => typeof l !== "string")) bad(`A pivot rule's items for "${field}" are a list of labels`);
      items[field] = [...new Set(labels)];
    }
    if (!Object.keys(items).length) items = undefined;
  }
  return { id: p.id, ...(p.value !== undefined ? { value: p.value } : {}), ...(p.rows !== undefined ? { rows: p.rows } : {}), ...(p.columns !== undefined ? { columns: p.columns } : {}), ...(items ? { items } : {}) };
}

/** The ranges of a rule, read. */
export function ruleBounds(ranges: readonly string[]): Bounds[] {
  return ranges.map((r) => parseRange(r)!);
}

/** A conditional rule made ready to keep: checks it, writes ranges the plain way, and drops what says nothing. */
export function cleanRule(rule: ConditionalRule): ConditionalRule {
  if (!rule || typeof rule.id !== "string" || rule.id === "") bad("A rule needs an id");
  if (!Array.isArray(rule.ranges) || rule.ranges.length === 0) bad("A rule needs at least one range");
  const ranges = rule.ranges.map((r) => {
    const b = typeof r === "string" ? parseRange(r.replace(/\$/g, "")) : null;
    if (!b) bad(`"${String(r)}" is not a range`);
    return rangeAddress(b!);
  });
  const base = { id: rule.id, ranges, ...(rule.stop ? { stop: true as const } : {}), ...(rule.pivot ? { pivot: cleanRulePivot(rule.pivot) } : {}) };
  switch (rule.kind) {
    case "cell": {
      if (!CELL_OPERATORS.includes(rule.op)) bad(`A comparison is one of ${CELL_OPERATORS.join(", ")}`);
      const two = rule.op === "between" || rule.op === "notBetween";
      if (!Array.isArray(rule.values) || rule.values.length !== (two ? 2 : 1)) bad(two ? "A between rule needs two values" : "A comparison needs one value");
      return { ...base, kind: "cell", op: rule.op, values: rule.values.map((v) => checkFormula("A value", String(v))), style: cleanStyle(rule.style) };
    }
    case "text":
      if (!TEXT_OPERATORS.includes(rule.op)) bad(`A text rule is one of ${TEXT_OPERATORS.join(", ")}`);
      if (typeof rule.text !== "string" || rule.text === "") bad("A text rule needs the text to look for");
      return { ...base, kind: "text", op: rule.op, text: rule.text, style: cleanStyle(rule.style) };
    case "formula":
      return { ...base, kind: "formula", formula: checkFormula("The formula", rule.formula), style: cleanStyle(rule.style) };
    case "blanks":
    case "noBlanks":
    case "errors":
    case "noErrors":
    case "duplicates":
    case "uniques":
      return { ...base, kind: rule.kind, style: cleanStyle(rule.style) };
    case "top": {
      if (!Number.isInteger(rule.rank) || rule.rank < 1 || rule.rank > (rule.percent ? 100 : 1000)) bad(rule.percent ? "A top percentage is a whole number from 1 to 100" : "A top rule counts from 1 to 1000");
      return { ...base, kind: "top", rank: rule.rank, ...(rule.percent ? { percent: true as const } : {}), ...(rule.bottom ? { bottom: true as const } : {}), style: cleanStyle(rule.style) };
    }
    case "average":
      if (typeof rule.above !== "boolean") bad("An average rule says above or below");
      if (rule.stdDev !== undefined && ![1, 2, 3].includes(rule.stdDev)) bad("Standard deviations are 1, 2 or 3");
      return { ...base, kind: "average", above: rule.above, ...(rule.equal ? { equal: true as const } : {}), ...(rule.stdDev ? { stdDev: rule.stdDev } : {}), style: cleanStyle(rule.style) };
    case "dates":
      if (!DATE_PERIODS.includes(rule.period)) bad(`A date period is one of ${DATE_PERIODS.join(", ")}`);
      return { ...base, kind: "dates", period: rule.period, style: cleanStyle(rule.style) };
    case "colorScale": {
      if (!Array.isArray(rule.stops) || (rule.stops.length !== 2 && rule.stops.length !== 3)) bad("A colour scale has two or three points");
      const stops = rule.stops.map((s, i) => {
        if (typeof s.color !== "string" || !COLOR.test(s.color)) bad("A colour looks like #rrggbb");
        return { ...cleanValue(`Point ${i + 1}`, s), color: s.color.toLowerCase() };
      });
      return { ...base, kind: "colorScale", stops };
    }
    case "dataBar": {
      if (typeof rule.color !== "string" || !COLOR.test(rule.color)) bad("A data bar colour looks like #rrggbb");
      for (const k of ["negativeColor", "axisColor", "borderColor", "negativeBorderColor"] as const) if (rule[k] !== undefined && (typeof rule[k] !== "string" || !COLOR.test(rule[k]!))) bad(`A data bar's ${{ axisColor: "axis colour", negativeColor: "negative colour", borderColor: "border colour", negativeBorderColor: "negative border colour" }[k]} looks like #rrggbb`);
      if (rule.axis !== undefined && rule.axis !== "middle" && rule.axis !== "none") bad('A data bar axis is "middle" or "none" (the default places it by the numbers)');
      for (const k of ["minLength", "maxLength"] as const) if (rule[k] !== undefined && !(typeof rule[k] === "number" && rule[k]! >= 0 && rule[k]! <= 100)) bad("A data bar's length is a percent from 0 to 100");
      if ((rule.minLength ?? 0) > (rule.maxLength ?? 100)) bad("The shortest data bar can't be longer than the longest");
      return {
        ...base,
        kind: "dataBar",
        min: cleanValue("The lowest point", rule.min, true),
        max: cleanValue("The highest point", rule.max, true),
        color: rule.color.toLowerCase(),
        ...(rule.negativeColor ? { negativeColor: rule.negativeColor.toLowerCase() } : {}),
        ...(rule.solid ? { solid: true as const } : {}),
        ...(rule.border ? { border: true as const } : {}),
        ...(rule.borderColor ? { borderColor: rule.borderColor.toLowerCase() } : {}),
        ...(rule.negativeBorderColor ? { negativeBorderColor: rule.negativeBorderColor.toLowerCase() } : {}),
        ...(rule.rtl ? { rtl: true as const } : {}),
        ...(rule.axis ? { axis: rule.axis } : {}),
        ...(rule.axisColor ? { axisColor: rule.axisColor.toLowerCase() } : {}),
        ...(rule.minLength !== undefined && rule.minLength !== 0 ? { minLength: rule.minLength } : {}),
        ...(rule.maxLength !== undefined && rule.maxLength !== 100 ? { maxLength: rule.maxLength } : {}),
        ...(rule.hideValue ? { hideValue: true as const } : {}),
      };
    }
    case "iconSet": {
      const count = ICON_SETS[rule.set];
      if (!count) bad(`An icon set is one of ${Object.keys(ICON_SETS).join(", ")}`);
      if (!Array.isArray(rule.thresholds) || rule.thresholds.length !== count - 1) bad(`${rule.set} needs ${count - 1} steps after the first icon`);
      const thresholds = rule.thresholds.map((t, i) => {
        const v = cleanValue(`Step ${i + 1}`, t);
        if (v.type === "min" || v.type === "max") bad("A step is a number, percent, percentile or formula");
        return { ...v, ...(t.gte === false ? { gte: false as const } : {}) };
      });
      let custom: (IconRef | null)[] | undefined;
      if (rule.custom !== undefined) {
        if (!Array.isArray(rule.custom) || rule.custom.length !== count) bad(`Custom icons need one choice for each of the ${count} icons`);
        custom = rule.custom.map((c, i) => {
          if (c === null) return null;
          if (!c || !ICON_SETS[c.set] || !Number.isInteger(c.index) || c.index < 0 || c.index >= ICON_SETS[c.set]) bad(`Custom icon ${i + 1} is an icon of one of the sets, or none`);
          return { set: c.set, index: c.index };
        });
      }
      return { ...base, kind: "iconSet", set: rule.set, thresholds, ...(rule.reverse ? { reverse: true as const } : {}), ...(rule.hideValue ? { hideValue: true as const } : {}), ...(custom ? { custom } : {}) };
    }
    default:
      return bad(`Unknown kind of rule "${String((rule as { kind?: unknown }).kind)}"`);
  }
}

/** A point whose formula is rewritten; the same point comes back when it doesn't change. */
function mapPoint<T extends CfValue>(v: T, fn: (f: string) => string): T {
  if (v.type !== "formula") return v;
  const value = fn(String(v.value));
  return value === v.value ? v : { ...v, value };
}

/** Applies `fn` to every formula of a rule (to follow inserted rows, renamed sheets…). The same rule comes back when nothing changes. */
export function mapRuleFormulas(rule: ConditionalRule, fn: (f: string) => string): ConditionalRule {
  const same = <T>(a: readonly T[], b: readonly T[]) => a.every((x, i) => x === b[i]);
  switch (rule.kind) {
    case "cell": {
      const values = rule.values.map(fn);
      return same(values, rule.values) ? rule : { ...rule, values };
    }
    case "formula": {
      const formula = fn(rule.formula);
      return formula === rule.formula ? rule : { ...rule, formula };
    }
    case "colorScale": {
      const stops = rule.stops.map((s) => mapPoint(s, fn));
      return same(stops, rule.stops) ? rule : { ...rule, stops };
    }
    case "dataBar": {
      const min = mapPoint(rule.min, fn);
      const max = mapPoint(rule.max, fn);
      return min === rule.min && max === rule.max ? rule : { ...rule, min, max };
    }
    case "iconSet": {
      const thresholds = rule.thresholds.map((t) => mapPoint(t, fn));
      return same(thresholds, rule.thresholds) ? rule : { ...rule, thresholds };
    }
    default:
      return rule;
  }
}

// ---- merged cells ----

const parsedMerges = new WeakMap<readonly string[], Bounds[]>();

/** The merged ranges of a sheet, read (kept until the sheet's list changes). */
export function mergedRanges(sheet: Pick<Sheet, "merges">): readonly Bounds[] {
  const list = sheet.merges;
  if (!list) return [];
  let hit = parsedMerges.get(list);
  if (!hit) {
    hit = list.map((r) => parseRange(r)!);
    parsedMerges.set(list, hit);
  }
  return hit;
}

/** The merged range that has this cell in it, if any. */
export function mergeAt(sheet: Pick<Sheet, "merges">, row: number, col: number): Bounds | undefined {
  for (const b of mergedRanges(sheet)) if (row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2) return b;
  return undefined;
}

/** A merged range made ready to keep: written the plain way, at least two cells, inside the sheet. */
export function cleanMerge(range: string): string {
  const b = parseRange(range.replace(/\$/g, ""));
  if (!b || (b.r1 === b.r2 && b.c1 === b.c2)) return bad(`"${range}" is not a range of two or more cells`);
  if (b.r2 > MAX_ROWS || b.c2 > MAX_COLS) return bad("That range is outside the sheet");
  return rangeAddress(b);
}

export const overlaps = (a: Bounds, b: Bounds) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
