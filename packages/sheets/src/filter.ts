import { PliError } from "@pli.dev/core";
import { periodDays } from "./conditional";
import { cleanDateGroupsRule, dateGroupContains, dateGroupLabel } from "./datetree";
import type { FilterCriterion, FilterDatePeriod, FilterRule, FilterTest, FilterTestOp } from "./model";
import { dateSerial, isError, parseNumber, serialDate, type Value } from "./values";

/*
 * Filters that are rules: a column lets through the cells that pass a comparison (or two), the greatest or least numbers,
 * the numbers above or below the average, the dates in a period, or the cells with a colour. `criterionTest` works out, for
 * the cells of a column, a function that says which pass.
 */

/** A cell as a filter sees it. */
export interface FilterCell {
  value: Value;
  /** What the cell shows (an empty cell is `""`). */
  text: string;
  /** The cell's own fill and font colour (`#rrggbb`), when its style sets them. */
  fill?: string | undefined;
  font?: string | undefined;
  /** Whether the cell holds a date: a number the cell's format shows as one. */
  date?: boolean | undefined;
}

export const FILTER_TEST_OPS: readonly FilterTestOp[] = ["equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "contains", "notContains", "beginsWith", "notBeginsWith", "endsWith", "notEndsWith", "blank", "notBlank"];

export const FILTER_DATE_PERIODS: readonly FilterDatePeriod[] = [
  "today", "yesterday", "tomorrow", "thisWeek", "lastWeek", "nextWeek", "thisMonth", "lastMonth", "nextMonth", "thisQuarter", "lastQuarter", "nextQuarter", "thisYear", "lastYear", "nextYear", "yearToDate",
  "q1", "q2", "q3", "q4", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12",
];

const COLOR = /^#[0-9a-fA-F]{6}$/;
const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

// ---- checking ----

function cleanTest(t: FilterTest, what: string): FilterTest {
  if (!t || !FILTER_TEST_OPS.includes(t.op)) return bad(`${what} compares with one of ${FILTER_TEST_OPS.join(", ")}`);
  if (t.op === "blank" || t.op === "notBlank") return { op: t.op };
  if (typeof t.value !== "string" && !(typeof t.value === "number" && Number.isFinite(t.value))) bad(`${what} needs a value to compare with: text or a number`);
  return { op: t.op, value: t.value as string | number };
}

/** A rule made ready to keep, or an error that says what is wrong with it. */
export function cleanFilterRule(rule: FilterRule): FilterRule {
  if (!rule || typeof rule !== "object") return bad("A filter rule is an object with a kind");
  switch (rule.kind) {
    case "custom": {
      const out: FilterRule = { kind: "custom", a: cleanTest(rule.a, "A filter") };
      if (rule.b !== undefined) {
        out.b = cleanTest(rule.b, "The second comparison");
        if (rule.or) out.or = true;
      }
      return out;
    }
    case "top": {
      if (!Number.isInteger(rule.n) || rule.n < 1 || rule.n > (rule.percent ? 100 : 1000)) bad(rule.percent ? "A top or bottom percent is a whole number from 1 to 100" : "A top or bottom count is a whole number from 1 to 1000");
      return { kind: "top", n: rule.n, ...(rule.bottom ? { bottom: true as const } : {}), ...(rule.percent ? { percent: true as const } : {}) };
    }
    case "average":
      return { kind: "average", ...(rule.below ? { below: true as const } : {}) };
    case "dateGroups":
      return cleanDateGroupsRule(rule);
    case "date":
      if (!FILTER_DATE_PERIODS.includes(rule.period)) bad(`A date filter names one of ${FILTER_DATE_PERIODS.join(", ")}`);
      return { kind: "date", period: rule.period };
    case "color": {
      if ((rule.fill === undefined) === (rule.font === undefined)) bad("A colour filter picks a fill colour or a font colour");
      if (rule.fill !== undefined) {
        if (rule.fill !== "none" && !COLOR.test(rule.fill)) bad('A fill colour looks like #rrggbb, or is "none"');
        return { kind: "color", fill: rule.fill === "none" ? "none" : rule.fill.toLowerCase() };
      }
      if (rule.font !== "auto" && !COLOR.test(rule.font!)) bad('A font colour looks like #rrggbb, or is "auto"');
      return { kind: "color", font: rule.font === "auto" ? "auto" : rule.font!.toLowerCase() };
    }
    default:
      return bad("A filter rule's kind is custom, top, average, date, dateGroups or color");
  }
}

/** What a column lets through, made ready to keep. */
export function cleanCriterion(c: FilterCriterion): FilterCriterion {
  if (Array.isArray(c)) {
    if (c.some((v) => typeof v !== "string")) bad("The values let through are a list of text");
    return [...c];
  }
  return cleanFilterRule(c);
}

// ---- matching ----

/** A pattern as Excel reads one: `*` is any text, `?` is one character, `~` takes the special meaning from the next one. */
function wildcard(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "~" && i + 1 < pattern.length && "*?~".includes(pattern[i + 1]!)) source += "\\" + pattern[++i];
    else if (ch === "*") source += "[\\s\\S]*";
    else if (ch === "?") source += "[\\s\\S]";
    else source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

const numberOf = (v: string | number | undefined): number | null => (typeof v === "number" ? v : v === undefined ? null : parseNumber(v));

function passesTest(t: FilterTest, c: FilterCell): boolean {
  const empty = c.value === null || c.value === "";
  const target = t.value === undefined ? "" : String(t.value);
  const lower = c.text.toLowerCase();
  const needle = target.toLowerCase();
  switch (t.op) {
    case "blank":
      return empty;
    case "notBlank":
      return !empty;
    case "equals":
    case "notEquals": {
      const n = numberOf(t.value);
      const same = typeof c.value === "number" && n !== null ? c.value === n : wildcard(target).test(c.text);
      return t.op === "equals" ? same : !same;
    }
    case "greaterThan":
    case "greaterThanOrEqual":
    case "lessThan":
    case "lessThanOrEqual": {
      if (empty || isError(c.value)) return false;
      const n = numberOf(t.value);
      let order: number;
      if (typeof c.value === "number" && n !== null) order = c.value - n;
      else if (typeof c.value === "string" && n === null) order = lower < needle ? -1 : lower > needle ? 1 : 0;
      else return false;
      return t.op === "greaterThan" ? order > 0 : t.op === "greaterThanOrEqual" ? order >= 0 : t.op === "lessThan" ? order < 0 : order <= 0;
    }
    case "contains":
      return lower.includes(needle);
    case "notContains":
      return !lower.includes(needle);
    case "beginsWith":
      return lower.startsWith(needle);
    case "notBeginsWith":
      return !lower.startsWith(needle);
    case "endsWith":
      return lower.endsWith(needle);
    case "notEndsWith":
      return !lower.endsWith(needle);
  }
}

/** Whether the day number (a whole serial) is in a period, counted from `today`. */
export function inFilterPeriod(period: FilterDatePeriod, day: number, today: number): boolean {
  const d = serialDate(day);
  const t = serialDate(today);
  const quarterStart = (offset: number): [number, number] => {
    const first = Math.floor((t.month - 1) / 3) * 3 + 1 + offset * 3;
    return [dateSerial(t.year, first, 1) ?? today, (dateSerial(t.year, first + 3, 1) ?? today + 91) - 1];
  };
  const yearRange = (offset: number): [number, number] => [dateSerial(t.year + offset, 1, 1) ?? today, (dateSerial(t.year + offset + 1, 1, 1) ?? today + 366) - 1];
  let range: [number, number];
  switch (period) {
    case "today": case "yesterday": case "tomorrow": case "thisWeek": case "lastWeek": case "nextWeek": case "thisMonth": case "lastMonth": case "nextMonth":
      range = periodDays(period, today);
      break;
    case "thisQuarter": range = quarterStart(0); break;
    case "lastQuarter": range = quarterStart(-1); break;
    case "nextQuarter": range = quarterStart(1); break;
    case "thisYear": range = yearRange(0); break;
    case "lastYear": range = yearRange(-1); break;
    case "nextYear": range = yearRange(1); break;
    case "yearToDate": range = [yearRange(0)[0], today]; break;
    default:
      // A quarter or a month of any year.
      return period[0] === "q" ? Math.floor((d.month - 1) / 3) + 1 === Number(period.slice(1)) : d.month === Number(period.slice(1));
  }
  return day >= range[0] && day <= range[1];
}

/**
 * A function that says whether a cell passes what a column lets through. `population` is the column's cells below the
 * heading (what a top ten or an average is counted among), and `today` the day number of today.
 */
export function criterionTest(criterion: FilterCriterion, population: readonly FilterCell[], today: number): (cell: FilterCell) => boolean {
  if (Array.isArray(criterion)) {
    const allowed = new Set(criterion);
    return (c) => allowed.has(c.text);
  }
  switch (criterion.kind) {
    case "custom": {
      const { a, b } = criterion;
      return (c) => (b === undefined ? passesTest(a, c) : criterion.or ? passesTest(a, c) || passesTest(b, c) : passesTest(a, c) && passesTest(b, c));
    }
    case "top": {
      const numbers = population.map((c) => c.value).filter((v): v is number => typeof v === "number").sort((x, y) => (criterion.bottom ? x - y : y - x));
      if (!numbers.length) return () => false;
      const count = criterion.percent ? Math.max(1, Math.floor((numbers.length * criterion.n) / 100)) : criterion.n;
      const edge = numbers[Math.min(count, numbers.length) - 1]!;
      return (c) => typeof c.value === "number" && (criterion.bottom ? c.value <= edge : c.value >= edge);
    }
    case "average": {
      const numbers = population.map((c) => c.value).filter((v): v is number => typeof v === "number");
      const mean = numbers.reduce((a, v) => a + v, 0) / (numbers.length || 1);
      return (c) => typeof c.value === "number" && numbers.length > 0 && (criterion.below ? c.value < mean : c.value > mean);
    }
    case "date":
      return (c) => typeof c.value === "number" && inFilterPeriod(criterion.period, Math.floor(c.value), today);
    case "dateGroups": {
      const { groups } = criterion;
      const others = new Set(criterion.values ?? []);
      return (c) => (typeof c.value === "number" && groups.some((g) => dateGroupContains(g, c.value as number))) || others.has(c.text);
    }
    case "color": {
      if (criterion.fill !== undefined) {
        const want = criterion.fill;
        return (c) => (c.fill ?? "none") === want;
      }
      const want = criterion.font!;
      return (c) => (c.font ?? "auto") === want;
    }
  }
}

// ---- saying what a filter does ----

const OP_WORDS: Record<FilterTestOp, string> = {
  equals: "equals",
  notEquals: "does not equal",
  greaterThan: "is greater than",
  greaterThanOrEqual: "is greater than or equal to",
  lessThan: "is less than",
  lessThanOrEqual: "is less than or equal to",
  contains: "contains",
  notContains: "does not contain",
  beginsWith: "begins with",
  notBeginsWith: "does not begin with",
  endsWith: "ends with",
  notEndsWith: "does not end with",
  blank: "is empty",
  notBlank: "is not empty",
};

export const FILTER_PERIOD_WORDS: Record<FilterDatePeriod, string> = {
  today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow", thisWeek: "This week", lastWeek: "Last week", nextWeek: "Next week",
  thisMonth: "This month", lastMonth: "Last month", nextMonth: "Next month", thisQuarter: "This quarter", lastQuarter: "Last quarter", nextQuarter: "Next quarter",
  thisYear: "This year", lastYear: "Last year", nextYear: "Next year", yearToDate: "Year to date",
  q1: "Quarter 1", q2: "Quarter 2", q3: "Quarter 3", q4: "Quarter 4",
  m1: "January", m2: "February", m3: "March", m4: "April", m5: "May", m6: "June", m7: "July", m8: "August", m9: "September", m10: "October", m11: "November", m12: "December",
};

/** A rule in words, such as `is greater than 5 and is less than 10`. */
export function describeRule(rule: FilterRule): string {
  const test = (t: FilterTest) => (t.op === "blank" || t.op === "notBlank" ? OP_WORDS[t.op] : `${OP_WORDS[t.op]} ${t.value}`);
  switch (rule.kind) {
    case "custom":
      return rule.b ? `${test(rule.a)} ${rule.or ? "or" : "and"} ${test(rule.b)}` : test(rule.a);
    case "top":
      return `${rule.bottom ? "Bottom" : "Top"} ${rule.n}${rule.percent ? " percent" : ""}`;
    case "average":
      return rule.below ? "Below average" : "Above average";
    case "date":
      return FILTER_PERIOD_WORDS[rule.period];
    case "dateGroups":
      return `Dates: ${[...rule.groups.map((g) => dateGroupLabel(g, true)), ...(rule.values ?? []).map((v) => (v === "" ? "(Blanks)" : v))].join(", ") || "none"}`;
    case "color":
      return rule.fill !== undefined ? (rule.fill === "none" ? "No fill" : `Fill ${rule.fill}`) : rule.font === "auto" ? "Automatic font colour" : `Font ${rule.font}`;
  }
}
