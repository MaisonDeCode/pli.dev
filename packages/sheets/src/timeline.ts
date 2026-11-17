import { PliError } from "@pli.dev/core";
import { MAX_CHART_SIZE, MIN_CHART_SIZE } from "./chart";
import type { DateGroup, FilterCriterion, Timeline, TimelineLevel, Workbook } from "./model";
import { sharing } from "./ghosts";
import { allTables, tableColumns } from "./table";
import { dateSerial, serialDate } from "./values";

export const DEFAULT_TIMELINE_WIDTH = 420;
export const DEFAULT_TIMELINE_HEIGHT = 130;
export const TIMELINE_LEVELS: readonly TimelineLevel[] = ["years", "quarters", "months", "days"];
/** The most periods one timeline lays out (days over many decades would otherwise be a very long strip). */
export const MAX_TIMELINE_PERIODS = 5000;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A timeline made ready to keep, or an error that says what is wrong: it needs a table with that column, and room on the sheet. */
export function checkTimeline(wb: Workbook, t: Timeline): Timeline {
  if (typeof t.id !== "string" || t.id === "") bad("A timeline needs an id");
  if (!sharing()) {
    const entry = allTables(wb).find((e) => e.table.id === t.table);
    if (!entry) return bad("A timeline needs a table to filter");
    if (!tableColumns(entry.sheet, entry.bounds, entry.table).includes(t.column)) bad(`"${String(t.column)}" isn't a column of the table "${entry.table.name}"`);
    if (entry.table.headerRow === false) bad("A table with no header row can't be filtered");
  }
  if (!TIMELINE_LEVELS.includes(t.level)) bad(`A timeline shows ${TIMELINE_LEVELS.join(", ")}`);
  const f = t.from;
  if (!f || !Number.isInteger(f.row) || !Number.isInteger(f.col) || f.row < 1 || f.col < 1) bad("A timeline needs a cell to sit in");
  for (const n of [t.width, t.height]) if (!(n >= MIN_CHART_SIZE && n <= MAX_CHART_SIZE)) bad(`A timeline is ${MIN_CHART_SIZE} to ${MAX_CHART_SIZE} pixels across and high`);
  for (const d of [f.dx, f.dy]) if (d !== undefined && !(d >= 0 && Number.isFinite(d))) bad("A timeline's offset in its cell must be 0 or more");
  const out: Timeline = { id: t.id, table: t.table, column: t.column, from: { ...f }, width: t.width, height: t.height, level: t.level };
  if (t.caption) out.caption = t.caption;
  if (t.style && t.style !== "TimeSlicerStyleLight1") out.style = t.style;
  return out;
}

// ---- periods ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthStart = (y: number, m: number) => dateSerial(y, m, 1) ?? 0;
const monthEnd = (y: number, m: number) => monthStart(y, m + 1) - 1;

/** The first day (a serial number) of the period at `level` that holds `day`. */
export function periodStart(level: TimelineLevel, day: number): number {
  const d = serialDate(Math.floor(day));
  switch (level) {
    case "years": return monthStart(d.year, 1);
    case "quarters": return monthStart(d.year, Math.floor((d.month - 1) / 3) * 3 + 1);
    case "months": return monthStart(d.year, d.month);
    case "days": return Math.floor(day);
  }
}

/** The last day of the period at `level` that holds `day`. */
export function periodEnd(level: TimelineLevel, day: number): number {
  const d = serialDate(Math.floor(day));
  switch (level) {
    case "years": return monthEnd(d.year, 12);
    case "quarters": return monthEnd(d.year, Math.floor((d.month - 1) / 3) * 3 + 3);
    case "months": return monthEnd(d.year, d.month);
    case "days": return Math.floor(day);
  }
}

export interface TimelinePeriod {
  /** The first and last day. */
  start: number;
  end: number;
  /** `2023`, `Q1`, `Mar`, `15`. */
  label: string;
  /** What groups the periods under it: `2023` for quarters and months, `Mar 2023` for days; empty for years. */
  parent: string;
}

/** Every period at `level` from the one holding `first` to the one holding `last`, empty ones included. */
export function periodsBetween(level: TimelineLevel, first: number, last: number): TimelinePeriod[] {
  const out: TimelinePeriod[] = [];
  let at = periodStart(level, first);
  const stop = periodEnd(level, last);
  while (at <= stop && out.length < MAX_TIMELINE_PERIODS) {
    const end = periodEnd(level, at);
    const d = serialDate(at);
    out.push({
      start: at,
      end,
      label: level === "years" ? String(d.year) : level === "quarters" ? `Q${Math.floor((d.month - 1) / 3) + 1}` : level === "months" ? MONTHS[d.month - 1]! : String(d.day),
      parent: level === "years" ? "" : level === "days" ? `${MONTHS[d.month - 1]} ${d.year}` : String(d.year),
    });
    at = end + 1;
  }
  return out;
}

/** The first and last whole day a pick of dates covers. */
export function groupSpan(g: DateGroup): [number, number] {
  switch (g.by) {
    case "year": return [monthStart(g.year, 1), monthEnd(g.year, 12)];
    case "month": return [monthStart(g.year, g.month!), monthEnd(g.year, g.month!)];
    default: {
      const day = dateSerial(g.year, g.month!, g.day!) ?? 0;
      return [day, day];
    }
  }
}

/**
 * The picks of dates that make up the days from `start` to `end`, widened to whole periods of `level`: months (or days) of the
 * range, joined into a whole year or month where the range holds all of it, the way Excel's filter menu keeps them.
 */
export function rangeGroups(level: TimelineLevel, start: number, end: number): DateGroup[] {
  const first = periodStart(level, start);
  const last = periodEnd(level, end);
  if (last < first) return [];
  const days = level === "days";
  // Leaves: one pick for each month (or day) in the range.
  const leaves: DateGroup[] = [];
  for (let at = first; at <= last; ) {
    const d = serialDate(at);
    if (days) {
      leaves.push({ by: "day", year: d.year, month: d.month, day: d.day });
      at++;
    } else {
      leaves.push({ by: "month", year: d.year, month: d.month });
      at = monthEnd(d.year, d.month) + 1;
    }
  }
  const out: DateGroup[] = [];
  const byYear = new Map<number, DateGroup[]>();
  for (const g of leaves) byYear.set(g.year, [...(byYear.get(g.year) ?? []), g]);
  for (const [year, list] of byYear) {
    const yearDays = monthEnd(year, 12) - monthStart(year, 1) + 1;
    const covered = list.reduce((n, g) => n + (groupSpan(g)[1] - groupSpan(g)[0] + 1), 0);
    if (covered === yearDays) {
      out.push({ by: "year", year });
      continue;
    }
    if (!days) {
      out.push(...list);
      continue;
    }
    const byMonth = new Map<number, DateGroup[]>();
    for (const g of list) byMonth.set(g.month!, [...(byMonth.get(g.month!) ?? []), g]);
    for (const [month, ds] of byMonth) {
      if (ds.length === monthEnd(year, month) - monthStart(year, month) + 1) out.push({ by: "month", year, month });
      else out.push(...ds);
    }
  }
  return out;
}

/** The days a column's filter lets through, as one range from the first pick to the last, or null when it lets everything through or isn't a pick of dates. */
export function selectionOfFilter(criterion: FilterCriterion | undefined): { start: number; end: number } | null {
  if (!criterion || Array.isArray(criterion)) return null;
  if (criterion.kind === "dateGroups") {
    if (!criterion.groups.length) return null;
    const spans = criterion.groups.map(groupSpan);
    return { start: Math.min(...spans.map((s) => s[0])), end: Math.max(...spans.map((s) => s[1])) };
  }
  return null;
}
