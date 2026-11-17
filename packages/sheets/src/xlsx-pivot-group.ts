import { attr, child, childrenNamed, elements, type XmlElement } from "@pli.dev/core";
import { formatValue } from "./format";
import type { PivotGroup, PivotGroupBy } from "./model";
import { itemMaker, type PivotSource } from "./pivot";
import { dateSerial, serialDate, serialTime } from "./values";

/*
 * Grouping in an .xlsx file. A grouped field is a cache field with a `fieldGroup`: dates and numbers by a `rangePr` (with
 * the list of groups, `groupItems`), items you pick by a `discretePr` (which group each of the field's items goes under).
 * Grouping a field by several parts at once (years and months) is one cache field for each part, tied to the date field by
 * `base` and to the next coarser part by `par`.
 */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** The parts of a date, from the coarsest to the finest, in the order Excel nests them. */
export const GROUP_ORDER: readonly PivotGroupBy[] = ["years", "quarters", "months", "days", "hours", "minutes", "seconds"];

/** The name Excel gives the field a part of a date is split into. */
export const GROUP_FIELD_NAME: Record<PivotGroupBy, string> = { years: "Years", quarters: "Quarters", months: "Months", days: "Days", hours: "Hours", minutes: "Minutes", seconds: "Seconds" };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A serial as Excel writes dates in a cache: `2024-03-01T09:05:30`. */
export function isoOf(serial: number): string {
  const d = serialDate(serial);
  const t = serialTime(serial);
  // A time of day on its own (serial 0) is 30 December 1899 in Excel's caches.
  if (serial >= 0 && serial < 1) return `1899-12-30T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

/** The serial of `2024-03-01T09:05:30`, or null. Excel writes a time of day on its own as `1899-12-30T09:05:30`. */
export function serialOfIso(text: string | undefined): number | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d):(\d\d)(?:\.\d+)?)?/.exec(text ?? "");
  if (!m) return null;
  const day = m[1] === "1899" && m[2] === "12" && m[3] === "30" ? 0 : dateSerial(Number(m[1]), Number(m[2]), Number(m[3]));
  if (day === null) return null;
  return day + (Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) / 86400;
}

/** The earliest and latest value of a field that is a number (a date, a time), or null. */
export function spanOf(src: PivotSource, field: string): { min: number; max: number } | null {
  const at = src.fields.indexOf(field);
  let min = Infinity;
  let max = -Infinity;
  for (const rec of src.records) {
    const v = rec[at];
    if (typeof v === "number" && Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  return min <= max ? { min, max } : null;
}

/**
 * Every group a range grouping can have, in order, as the file lists them (`groupItems`), and the attributes of its `rangePr`.
 * The labels are the ones the pivot table itself shows, so an item is found by its label.
 */
export function rangeGroup(group: Exclude<PivotGroup, { by: "items" }>, src: PivotSource, field: string): { labels: string[]; attrs: string } {
  const span = spanOf(src, field) ?? { min: 0, max: 0 };
  const sample = (values: number[]) => {
    const fake: PivotSource = { fields: [field], records: values.map((v) => [v]), formats: [src.formats[src.fields.indexOf(field)]] };
    const make = itemMaker(fake, field, group);
    return values.map((v) => make([v]).label);
  };
  const dateText = (n: number) => formatValue(Math.floor(n), "m/d/yyyy").text;
  const startDate = isoOf(Math.floor(span.min));
  const endDate = isoOf(Math.floor(span.max) + 1);
  const unique = (labels: string[]) => [...new Set(labels)];
  switch (group.by) {
    case "number": {
      const start = group.start ?? span.min;
      const end = group.end ?? span.max;
      const n = Math.max(0, Math.floor((end - start) / group.step + 1e-9));
      const values = [start - 1, ...Array.from({ length: n + 1 }, (_, i) => start + i * group.step), end + 1];
      return { labels: unique(sample(values)), attrs: `${group.start !== undefined ? ' autoStart="0"' : ""}${group.end !== undefined ? ' autoEnd="0"' : ""} startNum="${start}" endNum="${end}" groupInterval="${group.step}"` };
    }
    case "dayRange": {
      const start = Math.floor(group.start ?? span.min);
      const end = Math.floor(group.end ?? span.max);
      const n = Math.max(0, Math.floor((end - start) / group.days));
      const values = [start - 1, ...Array.from({ length: n + 1 }, (_, i) => start + i * group.days), end + 1];
      return { labels: unique(sample(values)), attrs: `${group.start !== undefined ? ' autoStart="0"' : ""}${group.end !== undefined ? ' autoEnd="0"' : ""} groupBy="days" startDate="${isoOf(start)}" endDate="${isoOf(end)}" groupInterval="${group.days}"` };
    }
    default: {
      const by = group.by;
      const low = `<${dateText(span.min)}`;
      const high = `>${dateText(span.max + 1)}`;
      let values: number[];
      if (by === "years") {
        const a = serialDate(span.min).year;
        const b = serialDate(span.max).year;
        values = Array.from({ length: Math.min(b - a + 1, 2000) }, (_, i) => dateSerial(a + i, 1, 1) ?? 0);
      } else if (by === "quarters") values = [1, 4, 7, 10].map((m) => dateSerial(2024, m, 1) ?? 0);
      else if (by === "months") values = Array.from({ length: 12 }, (_, i) => dateSerial(2024, i + 1, 1) ?? 0);
      else if (by === "days") values = Array.from({ length: 366 }, (_, i) => (dateSerial(2024, 1, 1) ?? 0) + i);
      else if (by === "hours") values = Array.from({ length: 24 }, (_, i) => (i * 3600 + 30) / 86400);
      else values = Array.from({ length: 60 }, (_, i) => (by === "minutes" ? i * 60 + 30 : i) / 86400);
      const time = by === "hours" || by === "minutes" || by === "seconds";
      return { labels: [low, ...sample(values), high], attrs: ` groupBy="${by}" startDate="${time ? isoOf(span.min) : startDate}" endDate="${time ? isoOf(span.max + 1 / 86400) : endDate}"` };
    }
  }
}

/** The `fieldGroup` of a field grouped by a range. */
export function rangeGroupXml(labels: readonly string[], attrs: string, base: number, par: number | undefined): string {
  return `<fieldGroup${par !== undefined ? ` par="${par}"` : ""} base="${base}"><rangePr${attrs}/><groupItems count="${labels.length}">${labels.map((l) => `<s v="${esc(l)}"/>`).join("")}</groupItems></fieldGroup>`;
}

/** The `fieldGroup` of a field whose items are gathered under names: `of` is the group item (in `labels`) each of the field's own items goes under; `par` is the group that groups this one again. */
export function itemsGroupXml(labels: readonly string[], of: readonly number[], base: number, par?: number): string {
  return `<fieldGroup${par !== undefined ? ` par="${par}"` : ""} base="${base}"><discretePr count="${of.length}">${of.map((x) => `<x v="${x}"/>`).join("")}</discretePr><groupItems count="${labels.length}">${labels.map((l) => `<s v="${esc(l)}"/>`).join("")}</groupItems></fieldGroup>`;
}

// ---- reading ----

/** What a `fieldGroup` says: the group it makes, and the group items it lists. A string says why it can't be read. */
export function readFieldGroup(fg: XmlElement, baseLabels: readonly string[] | null): { group: PivotGroup; labels: string[]; base: number; par: number | undefined; mapping?: (string | undefined)[] } | string {
  const base = Number(attr(fg, "base") ?? 0);
  const par = attr(fg, "par") === undefined ? undefined : Number(attr(fg, "par"));
  const items = childrenNamed(child(fg, "groupItems"), "s").map((s) => attr(s, "v") ?? "");
  const groupItems = child(fg, "groupItems");
  if (groupItems && elements(groupItems).some((e) => e.name !== "s")) return "a group has items that aren't text";
  const range = child(fg, "rangePr");
  const discrete = child(fg, "discretePr");
  if (discrete) {
    if (!baseLabels) return "a group of items names items it can't read";
    const map = childrenNamed(discrete, "x").map((x) => Number(attr(x, "v") ?? 0));
    const groups = new Map<number, string[]>();
    map.forEach((g, i) => {
      const label = baseLabels[i];
      if (label === undefined || items[g] === undefined) return;
      const list = groups.get(g) ?? [];
      list.push(label);
      groups.set(g, list);
    });
    // An item that is alone under its own name isn't grouped.
    const picked = [...groups].filter(([g, list]) => !(list.length === 1 && list[0] === items[g])).map(([g, list]) => ({ name: items[g]!, items: list }));
    if (!picked.length) return "a group of items groups nothing";
    return { group: { by: "items", groups: picked }, labels: items, base, par, mapping: baseLabels.map((_, i) => items[map[i]!]) };
  }
  if (!range) return "a group has no range";
  const by = attr(range, "groupBy") ?? "range";
  const auto = (name: string) => attr(range, name) !== "0" && attr(range, name) !== "false";
  const interval = Number(attr(range, "groupInterval") ?? 1);
  if (by === "range") {
    const start = Number(attr(range, "startNum"));
    const end = Number(attr(range, "endNum"));
    if (!(interval > 0)) return "a group of numbers has no step";
    return { group: { by: "number", step: interval, ...(auto("autoStart") || !Number.isFinite(start) ? {} : { start }), ...(auto("autoEnd") || !Number.isFinite(end) ? {} : { end }) }, labels: items, base, par };
  }
  if (by === "days" && interval > 1) {
    const start = serialOfIso(attr(range, "startDate"));
    const end = serialOfIso(attr(range, "endDate"));
    return { group: { by: "dayRange", days: Math.floor(interval), ...(auto("autoStart") || start === null ? {} : { start: Math.floor(start) }), ...(auto("autoEnd") || end === null ? {} : { end: Math.floor(end) }) }, labels: items, base, par };
  }
  if (!(GROUP_ORDER as readonly string[]).includes(by)) return `a group by "${by}" is one Pli doesn't have`;
  // Excel captions the hours "12 AM", "1 AM" … "11 PM"; Pli's items are the numbers 0 to 23.
  const labels = by === "hours" ? items.map((l) => hourOfCaption(l)) : items;
  return { group: { by: by as PivotGroupBy }, labels, base, par };
}

/** The hour (0 to 23) in Excel's caption of it (`8 AM`, `12 PM`), as the text Pli shows; any other text is left as it is. */
export function hourOfCaption(caption: string): string {
  const m = /^(\d{1,2})\s*(AM|PM)$/i.exec(caption.trim());
  if (!m) return caption;
  const h = Number(m[1]) % 12;
  return String(m[2]!.toUpperCase() === "PM" ? h + 12 : h);
}
