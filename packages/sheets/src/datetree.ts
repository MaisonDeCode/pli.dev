import { PliError } from "@pli.dev/core";
import type { DateGroup, DateGroupLevel, FilterRule } from "./model";
import { dateSerial, serialDate, serialTime } from "./values";

/*
 * Filters that pick dates from Excel's tree: years, and under each year its months, under each month its days (and, for
 * dates with a time, hours, minutes and seconds). What is picked is a list of `DateGroup`s, each a whole year, month, day…;
 * a cell passes when its date is inside one of them.
 */

export const DATE_LEVELS: readonly DateGroupLevel[] = ["year", "month", "day", "hour", "minute", "second"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PART_KEYS = ["year", "month", "day", "hour", "minute", "second"] as const;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

const RANGES: Record<Exclude<DateGroupLevel, "year">, [number, number]> = { month: [1, 12], day: [1, 31], hour: [0, 23], minute: [0, 59], second: [0, 59] };

/** A pick made ready to keep: it needs the parts down to its level, and drops the ones below. */
export function cleanDateGroup(g: DateGroup): DateGroup {
  if (!g || typeof g !== "object" || !DATE_LEVELS.includes(g.by)) return bad(`A date pick is by one of ${DATE_LEVELS.join(", ")}`);
  const out: DateGroup = { by: g.by, year: g.year };
  if (!Number.isInteger(g.year) || g.year < 1900 || g.year > 9999) bad("A year is a whole number from 1900 to 9999");
  const depth = DATE_LEVELS.indexOf(g.by);
  for (let i = 1; i <= depth; i++) {
    const key = PART_KEYS[i]! as Exclude<DateGroupLevel, "year">;
    const v = g[key];
    const [lo, hi] = RANGES[key];
    if (!Number.isInteger(v) || v! < lo || v! > hi) bad(`A pick by ${g.by} needs a ${key} from ${lo} to ${hi}`);
    out[key] = v!;
  }
  if (out.day !== undefined && dateSerial(out.year, out.month!, out.day) === null) bad("That day isn't a date");
  if (out.day !== undefined) {
    const real = serialDate(dateSerial(out.year, out.month!, out.day)!);
    if (real.month !== out.month) bad(`There is no day ${out.day} in month ${out.month}`);
  }
  return out;
}

/** A group of dates made ready to keep, with its other values. */
export function cleanDateGroupsRule(rule: Extract<FilterRule, { kind: "dateGroups" }>): FilterRule {
  if (!Array.isArray(rule.groups)) bad("The dates picked are a list");
  const values = rule.values;
  if (values !== undefined && (!Array.isArray(values) || values.some((v) => typeof v !== "string"))) bad("The other values let through are a list of text");
  const seen = new Set<string>();
  const groups: DateGroup[] = [];
  for (const g of rule.groups) {
    const c = cleanDateGroup(g);
    const k = groupKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    groups.push(c);
  }
  return { kind: "dateGroups", groups, ...(values?.length ? { values: [...values] } : {}) };
}

/** The parts of a date serial, to the second. */
interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function datePartsOf(serial: number): Parts {
  const d = serialDate(Math.floor(serial));
  const t = serialTime(serial);
  return { year: d.year, month: d.month, day: d.day, hour: t.hour, minute: t.minute, second: t.second };
}

/** Whether a date (a serial number) is inside a pick. */
export function dateGroupContains(g: DateGroup, serial: number): boolean {
  const p = datePartsOf(serial);
  for (let i = 0; i <= DATE_LEVELS.indexOf(g.by); i++) {
    const key = PART_KEYS[i]!;
    if (g[key] !== p[key]) return false;
  }
  return true;
}

/** A pick as one string, to compare and to tick. */
export function groupKey(g: DateGroup): string {
  const parts: number[] = [];
  for (let i = 0; i <= DATE_LEVELS.indexOf(g.by); i++) parts.push(g[PART_KEYS[i]!] ?? 0);
  return parts.join("-");
}

/** The pick for a date at one level. */
export function dateGroupAt(serial: number, by: DateGroupLevel): DateGroup {
  const p = datePartsOf(serial);
  const g: DateGroup = { by, year: p.year };
  for (let i = 1; i <= DATE_LEVELS.indexOf(by); i++) g[PART_KEYS[i]! as "month"] = p[PART_KEYS[i]!];
  return g;
}

/** What a pick is called in the tree (`2021`, `March`, `5`, `14`) and, with `full`, in words (`March 2021`, `5 March 2021, 14:00`). */
export function dateGroupLabel(g: DateGroup, full = false): string {
  const two = (n: number) => String(n).padStart(2, "0");
  if (!full) return g.by === "year" ? String(g.year) : g.by === "month" ? MONTH_NAMES[g.month! - 1]! : g.by === "day" ? String(g.day) : two(g[g.by]!);
  const date = g.by === "year" ? `${g.year}` : g.by === "month" ? `${MONTH_NAMES[g.month! - 1]} ${g.year}` : `${g.day} ${MONTH_NAMES[g.month! - 1]} ${g.year}`;
  if (g.by === "hour") return `${date}, ${two(g.hour!)}:00`;
  if (g.by === "minute") return `${date}, ${two(g.hour!)}:${two(g.minute!)}`;
  if (g.by === "second") return `${date}, ${two(g.hour!)}:${two(g.minute!)}:${two(g.second!)}`;
  return date;
}

/** One node of the tree a filter menu shows: a year, a month in it, a day in that… */
export interface DateNode {
  group: DateGroup;
  /** `2021`, `March`, `5`… */
  label: string;
  /** The same in full: `March 2021`. */
  title: string;
  /** How many cells are in it. */
  count: number;
  /** How many of those cells the filter lets through now. */
  selected: number;
  children: DateNode[];
}

/** The state of a node's checkbox. */
export function nodeState(n: DateNode): "all" | "some" | "none" {
  return n.selected === 0 ? "none" : n.selected === n.count ? "all" : "some";
}

/** A cell the tree is built from: its date and what it shows. */
export interface DateCell {
  value: number;
  text: string;
}

/**
 * The tree of the dates in a column, years first, with how many cells each holds and how many of them pass (`passes`).
 * It goes down to days; dates that have a time of day go on to hours, minutes and seconds.
 */
export function buildDateTree<T extends DateCell>(cells: readonly T[], passes: (c: T) => boolean): DateNode[] {
  const withTime = cells.some((c) => c.value !== Math.floor(c.value) && serialTime(c.value).hour + serialTime(c.value).minute + serialTime(c.value).second > 0);
  const depth = withTime ? 6 : 3;
  const roots: DateNode[] = [];
  const index = new Map<string, DateNode>();
  const sorted = [...cells].sort((a, b) => a.value - b.value);
  for (const cell of sorted) {
    const ok = passes(cell);
    let list = roots;
    for (let level = 0; level < depth; level++) {
      const group = dateGroupAt(cell.value, DATE_LEVELS[level]!);
      const key = groupKey(group);
      let node = index.get(key);
      if (!node) {
        node = { group, label: dateGroupLabel(group), title: dateGroupLabel(group, true), count: 0, selected: 0, children: [] };
        index.set(key, node);
        list.push(node);
      }
      node.count++;
      if (ok) node.selected++;
      list = node.children;
    }
  }
  return roots;
}

/** The leaves under a node (the node itself, when it has no children). */
export function leavesOf(n: DateNode): DateNode[] {
  return n.children.length ? n.children.flatMap(leavesOf) : [n];
}

/**
 * The picks that stand for the leaves ticked (`ticked` holds `groupKey`s of leaves). A year, month… all of whose leaves are
 * ticked is picked whole, so what Excel stores is a year when you tick a year.
 */
export function picksOf(nodes: readonly DateNode[], ticked: ReadonlySet<string>): DateGroup[] {
  const out: DateGroup[] = [];
  const walk = (n: DateNode) => {
    const leaves = leavesOf(n);
    const on = leaves.filter((l) => ticked.has(groupKey(l.group))).length;
    if (on === 0) return;
    if (on === leaves.length) out.push(n.group);
    else n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/** The tree of the dates in a column, and the other values (text, empty cells, numbers that aren't dates) as a flat list. */
export interface DateTree {
  nodes: DateNode[];
  others: { value: string; count: number; selected: boolean }[];
}

/**
 * What a column lets through when the leaves in `ticked` (by `groupKey`) and the other values in `values` are ticked: `null`
 * for everything, a list of values when no date is picked, else a rule with the dates picked.
 */
export function dateFilterOf(tree: DateTree, ticked: ReadonlySet<string>, values: ReadonlySet<string>): FilterRule | string[] | null {
  const leaves = tree.nodes.flatMap(leavesOf);
  if (leaves.every((l) => ticked.has(groupKey(l.group))) && tree.others.every((o) => values.has(o.value))) return null;
  const others = tree.others.filter((o) => values.has(o.value)).map((o) => o.value);
  const groups = picksOf(tree.nodes, ticked);
  if (!groups.length) return others;
  return { kind: "dateGroups", groups, ...(others.length ? { values: others } : {}) };
}
