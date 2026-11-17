import { PliError } from "@pli.dev/core";
import { dateSerial, serialDate } from "./values";
import type { Pivot, PivotAxisField, PivotFilter, PivotSlicer, PivotTimeline, Slicer } from "./model";
import { fieldItems, itemMaker, type PivotSource } from "./pivot";

/*
 * Slicers and timelines on a pivot table. They have no filter of their own: a slicer picks the items of a field the way the
 * field's own filter does (the axis field's left-out items, or the page filter's items, or, for a field the table doesn't use,
 * a filter that isn't shown above the table), and a timeline keeps a stretch of dates. Both are changed with the pivot table
 * in one step, so undo takes the filter and the panel back together.
 */

export const DEFAULT_PIVOT_SLICER_WIDTH = 180;
export const DEFAULT_PIVOT_SLICER_HEIGHT = 220;
export const DEFAULT_PIVOT_TIMELINE_WIDTH = 360;
export const DEFAULT_PIVOT_TIMELINE_HEIGHT = 110;

/** A button of a pivot slicer. A timeline's buttons are its periods: `label` is the text on the button, `start` and `end` the days it covers and `group` what it is under (the year of a month). */
export interface PivotSlicerItem {
  value: string;
  label?: string;
  start?: number;
  end?: number;
  group?: string;
  /** How many records of the source have it. */
  count: number;
  /** Whether the pivot table lets the item through. */
  selected: boolean;
  /** Whether any record with it passes the pivot table's other filters (a slicer draws the others dimmed). */
  available: boolean;
}

const axisFor = (p: Pivot, field: string): PivotAxisField | undefined => [...p.rows, ...p.columns].find((f) => f.field === field);

/** The buttons of a slicer, in the order the pivot table lists the items. */
export function pivotSlicerItems(p: Pivot, src: PivotSource, slicer: PivotSlicer): PivotSlicerItem[] {
  const axis = axisFor(p, slicer.field);
  const items = fieldItems(src, slicer.field, !!axis?.descending, axis?.group, axis?.order);
  const make = itemMaker(src, slicer.field, axis?.group);
  const at = src.fields.indexOf(slicer.field);
  const counts = new Map<string, number>();
  const live = new Map<string, boolean>();
  // The other fields' filters decide which items still have records.
  const others = (p.filters ?? []).filter((f) => f.field !== slicer.field).map((f) => ({ make: itemMaker(src, f.field), allow: new Set(f.items) }));
  const hiddenOthers = [...p.rows, ...p.columns].filter((f) => f.field !== slicer.field && f.hidden?.length).map((f) => ({ make: itemMaker(src, f.field, f.group), hide: new Set(f.hidden) }));
  for (const rec of src.records) {
    if (at < 0) break;
    const label = make(rec).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (others.every((o) => o.allow.has(o.make(rec).label)) && hiddenOthers.every((o) => !o.hide.has(o.make(rec).label))) live.set(label, true);
  }
  const filter = (p.filters ?? []).find((f) => f.field === slicer.field);
  return items.map((it) => ({
    value: it.label,
    count: counts.get(it.label) ?? 0,
    selected: axis ? !(axis.hidden ?? []).includes(it.label) : filter ? filter.items.includes(it.label) : true,
    available: live.get(it.label) ?? false,
  }));
}

/** The pivot table with only these items of the slicer's field let through (all of them with `null`). */
export function pivotSlicerSelect(p: Pivot, src: PivotSource, slicer: PivotSlicer, values: readonly string[] | null): Pivot {
  const axis = axisFor(p, slicer.field);
  const all = fieldItems(src, slicer.field, false, axis?.group).map((i) => i.label);
  if (values && values.some((v) => !all.includes(v))) throw new PliError("invalid_operation", `"${values.find((v) => !all.includes(v))}" isn't an item of ${slicer.field}`);
  const chosen = values === null || all.every((v) => values.includes(v)) ? null : all.filter((v) => values.includes(v));
  const next: Pivot = { ...p };
  if (axis) {
    const set = (list: PivotAxisField[]) => list.map((f) => (f === axis ? withHidden(f, chosen ? all.filter((v) => !chosen.includes(v)) : []) : f));
    next.rows = set(p.rows);
    next.columns = set(p.columns);
    return next;
  }
  const filters = [...(p.filters ?? [])];
  const at = filters.findIndex((f) => f.field === slicer.field);
  if (at >= 0) {
    const old = filters[at]!;
    if (chosen === null && old.hidden) filters.splice(at, 1);
    else filters[at] = { ...old, items: chosen ?? all };
  } else if (chosen) filters.push({ field: slicer.field, items: chosen, hidden: true } as PivotFilter);
  if (filters.length) next.filters = filters;
  else delete next.filters;
  return next;
}

function withHidden(f: PivotAxisField, hidden: string[]): PivotAxisField {
  const { hidden: _gone, ...rest } = f;
  return hidden.length ? { ...rest, hidden } : rest;
}

/** The earliest and latest date a timeline's field has in the source, as whole day numbers; null when it has none. */
export function timelineBounds(src: PivotSource, field: string): { min: number; max: number } | null {
  const at = src.fields.indexOf(field);
  if (at < 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const rec of src.records) {
    const v = rec[at];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    min = Math.min(min, Math.floor(v));
    max = Math.max(max, Math.floor(v));
  }
  return min <= max ? { min, max } : null;
}

/** The pivot table with this timeline letting only the dates from `start` to `end` through (every date with both left out). */
export function pivotTimelineSelect(p: Pivot, id: string, start: number | null, end: number | null): Pivot {
  const list = p.timelines ?? [];
  if (!list.some((t) => t.id === id)) throw new PliError("not_found", `No timeline with id "${id}"`);
  return {
    ...p,
    timelines: list.map((t) => {
      if (t.id !== id) return t;
      const { start: _s, end: _e, ...rest } = t;
      const next: PivotTimeline = { ...rest };
      if (start !== null) next.start = Math.floor(start);
      if (end !== null) next.end = Math.floor(end);
      return next;
    }),
  };
}

/** The periods a timeline shows, from its first to its last date: each with the day it starts on and the last day it covers. */
export function timelinePeriods(level: NonNullable<PivotTimeline["level"]>, min: number, max: number, serialToParts: (n: number) => { year: number; month: number; day: number }, partsToSerial: (y: number, m: number, d: number) => number): { label: string; start: number; end: number; group?: string }[] {
  const out: { label: string; start: number; end: number; group?: string }[] = [];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (level === "days") {
    for (let d = min; d <= max && out.length < 2000; d++) {
      const p = serialToParts(d);
      out.push({ label: String(p.day), start: d, end: d, group: `${MONTHS[p.month - 1]} ${p.year}` });
    }
    return out;
  }
  const first = serialToParts(min);
  const last = serialToParts(max);
  const step = level === "years" ? 12 : level === "quarters" ? 3 : 1;
  let y = first.year;
  let m = level === "years" ? 1 : level === "quarters" ? Math.floor((first.month - 1) / 3) * 3 + 1 : first.month;
  while ((y < last.year || (y === last.year && m <= last.month)) && out.length < 2000) {
    const nextM = m + step;
    const ny = y + Math.floor((nextM - 1) / 12);
    const nm = ((nextM - 1) % 12) + 1;
    out.push({ label: level === "years" ? String(y) : level === "quarters" ? `Q${Math.floor((m - 1) / 3) + 1}` : MONTHS[m - 1]!, start: partsToSerial(y, m, 1), end: partsToSerial(ny, nm, 1) - 1, ...(level === "years" ? {} : { group: String(y) }) });
    y = ny;
    m = nm;
  }
  return out;
}

/** A pivot table slicer as a plain slicer (what the grid draws): it has no table, and `pivot` names the pivot table it belongs to. */
export function pivotSlicerAsSlicer(x: PivotSlicer, pivot: string): Slicer {
  return { id: x.id, table: "", pivot, column: x.field, from: { ...x.from }, width: x.width, height: x.height, ...(x.caption ? { caption: x.caption } : {}), ...(x.style ? { style: x.style } : {}), ...(x.columns ? { columns: x.columns } : {}) };
}

/** The other way: a plain slicer the grid moved or resized, as the pivot table's slicer it came from. */
export function pivotPanelOfSlicer(x: Slicer): PivotSlicer {
  return { id: x.id, field: x.column, from: { ...x.from }, width: x.width, height: x.height, ...(x.caption ? { caption: x.caption } : {}), ...(x.style ? { style: x.style } : {}), ...(x.columns && x.columns > 1 ? { columns: x.columns } : {}) };
}

/** Whether the pivot table lets an item of a field through, as a slicer on that field shows it. */
export function pivotItemSelected(p: Pivot, field: string, label: string): boolean {
  const axis = axisFor(p, field);
  if (axis) return !(axis.hidden ?? []).includes(label);
  const filter = (p.filters ?? []).find((f) => f.field === field);
  return filter ? filter.items.includes(label) : true;
}

/** A pivot table's timeline as a plain slicer, which is what the grid moves, resizes and draws the buttons of. */
export function pivotTimelineAsSlicer(x: PivotTimeline, pivot: string): Slicer {
  return {
    id: x.id,
    table: "",
    pivot,
    column: x.field,
    timeline: { level: x.level ?? "months", ...(x.start !== undefined ? { start: x.start } : {}), ...(x.end !== undefined ? { end: x.end } : {}) },
    from: { ...x.from },
    width: x.width,
    height: x.height,
    ...(x.caption ? { caption: x.caption } : {}),
    ...(x.style ? { style: x.style } : {}),
  };
}

/** The periods of a timeline as buttons, the ones inside the dates it keeps marked. */
export function pivotTimelineItems(t: PivotTimeline, src: PivotSource): PivotSlicerItem[] {
  const span = timelineBounds(src, t.field);
  if (!span) return [];
  const parts = (n: number) => {
    const d = serialDate(n);
    return { year: d.year, month: d.month, day: d.day };
  };
  const whole = (y: number, m: number, d: number) => dateSerial(y, m, d) ?? 0;
  const lo = t.start ?? -Infinity;
  const hi = t.end ?? Infinity;
  return timelinePeriods(t.level ?? "months", span.min, span.max, parts, whole).map((p) => ({
    value: String(p.start),
    label: p.label,
    start: p.start,
    end: p.end,
    ...(p.group ? { group: p.group } : {}),
    count: 0,
    selected: p.start >= lo && p.end <= hi,
    available: true,
  }));
}
