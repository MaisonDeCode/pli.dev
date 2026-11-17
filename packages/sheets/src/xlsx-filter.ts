import { attr, child, childrenNamed, elements, type XmlElement } from "@pli.dev/core";
import type { ConditionalStyle, DateGroup, DateGroupLevel, FilterCriterion, FilterDatePeriod, FilterRule, FilterTest, FilterTestOp } from "./model";
import { DATE_LEVELS, cleanDateGroup } from "./datetree";
import { FILTER_DATE_PERIODS } from "./filter";
import { parseNumber } from "./values";

/*
 * Filters in an .xlsx file. A filtered column is a `filterColumn` that holds one of: the values let through (`filters`), up to two
 * comparisons (`customFilters`), a top or bottom (`top10`), an average or a period of dates (`dynamicFilter`), or a colour
 * (`colorFilter`, which points at a style in the stylesheet).
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** What a style in the stylesheet is asked for: a look, "no fill", or the automatic font colour. */
export type FilterDxf = ConditionalStyle | "nofill" | "autofont";

const OPERATORS: Partial<Record<FilterTestOp, string>> = { equals: "equal", notEquals: "notEqual", greaterThan: "greaterThan", greaterThanOrEqual: "greaterThanOrEqual", lessThan: "lessThan", lessThanOrEqual: "lessThanOrEqual" };
const FROM_OPERATOR: Record<string, FilterTestOp> = { equal: "equals", notEqual: "notEquals", greaterThan: "greaterThan", greaterThanOrEqual: "greaterThanOrEqual", lessThan: "lessThan", lessThanOrEqual: "lessThanOrEqual" };

/** Text with the characters that mean something in a pattern taken away from them. */
const literal = (s: string) => s.replace(/[~*?]/g, "~$&");

function customFilterXml(t: FilterTest): string {
  if (t.op === "blank") return '<customFilter operator="equal" val=""/>';
  if (t.op === "notBlank") return '<customFilter operator="notEqual" val=" "/>';
  const direct = OPERATORS[t.op];
  if (direct) {
    const n = typeof t.value === "string" ? parseNumber(t.value) : t.value;
    return `<customFilter operator="${direct}" val="${esc(n !== null && n !== undefined ? String(n) : String(t.value))}"/>`;
  }
  const text = literal(String(t.value));
  const not = t.op.startsWith("not");
  const kind = t.op.replace(/^not/, "").replace(/^./, (c) => c.toLowerCase());
  const pattern = kind === "contains" ? `*${text}*` : kind === "beginsWith" ? `${text}*` : `*${text}`;
  return `<customFilter operator="${not ? "notEqual" : "equal"}" val="${esc(pattern)}"/>`;
}

/** One filtered column. `dxf` gives the position of a style in the stylesheet. */
export function filterColumnXml(colId: number, criterion: FilterCriterion, dxf: (look: FilterDxf) => number): string {
  const body = (() => {
    if (Array.isArray(criterion)) {
      const blank = criterion.includes("");
      return `<filters${blank ? ' blank="1"' : ""}>${criterion.filter((v) => v !== "").map((v) => `<filter val="${esc(v)}"/>`).join("")}</filters>`;
    }
    switch (criterion.kind) {
      case "custom": {
        if (!criterion.b && criterion.a.op === "blank") return '<filters blank="1"/>';
        const tests = [criterion.a, ...(criterion.b ? [criterion.b] : [])];
        return `<customFilters${criterion.b && !criterion.or ? ' and="1"' : ""}>${tests.map(customFilterXml).join("")}</customFilters>`;
      }
      case "dateGroups": {
        const values = criterion.values ?? [];
        const items = criterion.groups.map((g) => `<dateGroupItem${DATE_LEVELS.slice(0, DATE_LEVELS.indexOf(g.by) + 1).map((k) => ` ${k}="${g[k]}"`).join("")} dateTimeGrouping="${g.by}"/>`);
        return `<filters${values.includes("") ? ' blank="1"' : ""}>${values.filter((v) => v !== "").map((v) => `<filter val="${esc(v)}"/>`).join("")}${items.join("")}</filters>`;
      }
      case "top":
        return `<top10${criterion.bottom ? ' top="0"' : ""}${criterion.percent ? ' percent="1"' : ""} val="${criterion.n}"/>`;
      case "average":
        return `<dynamicFilter type="${criterion.below ? "belowAverage" : "aboveAverage"}"/>`;
      case "date":
        return `<dynamicFilter type="${/^[qm]\d/.test(criterion.period) ? criterion.period.toUpperCase() : criterion.period}"/>`;
      case "color": {
        if (criterion.fill !== undefined) return `<colorFilter dxfId="${dxf(criterion.fill === "none" ? "nofill" : { fill: criterion.fill })}"/>`;
        return `<colorFilter dxfId="${dxf(criterion.font === "auto" ? "autofont" : { color: criterion.font! })}" cellColor="0"/>`;
      }
    }
  })();
  return `<filterColumn colId="${colId}">${body}</filterColumn>`;
}

// ---- reading ----

const asValue = (v: string): string | number => {
  const n = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : v;
};

/** A comparison with a pattern as the test it is: `*x*` is "contains x". Wildcards anywhere else stay in an `equals`. */
function readTest(operator: string, raw: string): FilterTest | null {
  const op = FROM_OPERATOR[operator ?? "equal"] ?? (operator === undefined ? "equals" : undefined);
  if (!op) return null;
  if (op === "equals" && raw === "") return { op: "blank" };
  if (op === "notEquals" && raw === " ") return { op: "notBlank" };
  if (op === "equals" || op === "notEquals") {
    const not = op === "notEquals";
    const unescape = (s: string) => s.replace(/~([*?~])/g, "$1");
    // An unescaped wildcard in what's left means the pattern is not one of the simple shapes.
    const plain = (s: string) => !/(^|[^~])(~~)*[*?]/.test(s) && !/~$/.test(s.replace(/~~/g, ""));
    const starts = raw.startsWith("*");
    const ends = raw.endsWith("*") && !raw.endsWith("~*");
    const core = raw.slice(starts ? 1 : 0, ends ? -1 : undefined);
    if ((starts || ends) && core !== "" && plain(core)) {
      const word = starts && ends ? "contains" : ends ? "beginsWith" : "endsWith";
      const full = (not ? "not" + word[0]!.toUpperCase() + word.slice(1) : word) as FilterTestOp;
      return { op: full, value: unescape(core) };
    }
  }
  return { op, value: asValue(raw) };
}

/**
 * The criterion a `filterColumn` stands for, `null` when it lets everything through, or a string that says what Pli can't keep.
 * `dxfs` are the styles of the stylesheet.
 */
export function readFilterColumn(fc: XmlElement, dxfs: readonly ConditionalStyle[]): FilterCriterion | null | string {
  const kids = elements(fc);
  const list = child(fc, "filters");
  if (list) {
    const calendar = attr(list, "calendarType");
    if (calendar && calendar !== "none" && calendar !== "gregorian") return `it picks dates in the ${calendar} calendar`;
    const values = childrenNamed(list, "filter").map((f) => attr(f, "val") ?? "");
    const blank = attr(list, "blank") === "1" || attr(list, "blank") === "true";
    const items = childrenNamed(list, "dateGroupItem");
    if (items.length) {
      const groups: DateGroup[] = [];
      for (const item of items) {
        const by = attr(item, "dateTimeGrouping") as DateGroupLevel | undefined;
        if (!by || !DATE_LEVELS.includes(by)) return `it picks dates by "${by ?? ""}"`;
        const raw: DateGroup = { by, year: Number(attr(item, "year")) };
        for (const k of DATE_LEVELS.slice(1, DATE_LEVELS.indexOf(by) + 1) as ("month" | "day" | "hour" | "minute" | "second")[]) raw[k] = Number(attr(item, k));
        try {
          groups.push(cleanDateGroup(raw));
        } catch {
          return "one of the dates it picks isn't a date";
        }
      }
      if (blank) values.push("");
      return { kind: "dateGroups", groups, ...(values.length ? { values } : {}) };
    }
    if (blank && values.length === 0) return { kind: "custom", a: { op: "blank" } };
    if (blank) values.push("");
    return values;
  }
  const custom = child(fc, "customFilters");
  if (custom) {
    const tests = childrenNamed(custom, "customFilter").map((c) => readTest(attr(c, "operator") ?? "equal", attr(c, "val") ?? ""));
    if (tests.length === 0 || tests.length > 2 || tests.some((t) => t === null)) return "it compares in a way Pli doesn't";
    const [a, b] = tests as FilterTest[];
    const and = attr(custom, "and") === "1" || attr(custom, "and") === "true";
    return { kind: "custom", a: a!, ...(b ? { b, ...(and ? {} : { or: true as const }) } : {}) };
  }
  const top = child(fc, "top10");
  if (top) {
    const n = Number(attr(top, "val"));
    const percent = attr(top, "percent") === "1" || attr(top, "percent") === "true";
    const isTop = attr(top, "top") !== "0" && attr(top, "top") !== "false";
    if (!Number.isInteger(n) || n < 1 || n > (percent ? 100 : 1000)) return "its top or bottom count is out of range";
    return { kind: "top", n, ...(isTop ? {} : { bottom: true as const }), ...(percent ? { percent: true as const } : {}) };
  }
  const dynamic = child(fc, "dynamicFilter");
  if (dynamic) {
    const type = attr(dynamic, "type") ?? "";
    if (type === "aboveAverage") return { kind: "average" };
    if (type === "belowAverage") return { kind: "average", below: true };
    const period = (/^[QM]\d/.test(type) ? type.toLowerCase() : type) as FilterDatePeriod;
    return FILTER_DATE_PERIODS.includes(period) ? { kind: "date", period } : `it picks dates by "${type}"`;
  }
  const color = child(fc, "colorFilter");
  if (color) {
    const style = dxfs[Number(attr(color, "dxfId"))];
    if (!style) return "its colour isn't in the file's styles";
    const byFont = attr(color, "cellColor") === "0" || attr(color, "cellColor") === "false";
    const rule: FilterRule = byFont ? { kind: "color", font: style.color ?? "auto" } : { kind: "color", fill: style.fill ?? "none" };
    return rule;
  }
  return kids.length ? "it is of a kind Pli doesn't have" : null;
}
