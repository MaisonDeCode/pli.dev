import { attr, child, childrenNamed, createId, elements, type XmlElement } from "@pli.dev/core";
import { cellAddress, parseRange, rangeAddress, type Bounds } from "./address";
import { chartRefText } from "./chart";
import { isDateFormat } from "./format";
import { FILTER_DATE_PERIODS } from "./filter";
import { isPivotStyleName } from "./pivot-style";
import type { ConditionalStyle, DataBlock, PivotFormat, FilterTest, FilterTestOp, Pivot, PivotAxisField, PivotCalculatedField, PivotCalculatedItem, PivotRange, PivotFieldFilter, PivotFilter, PivotFunction, PivotGroup, PivotGroupBy, PivotItemsGroup, PivotShowAs, PivotValue, RulePivot, Sheet, TableStylePart, Workbook } from "./model";
import { axisHeading, cleanPivot, consolidationFields, fieldFilters, fieldItems, itemKey, itemLabel, itemMaker, itemsHeadings, pivotSourceRange, pivotSourceRanges, readPivotSource, renderPivot, renderRange, valueName, type PivotItem } from "./pivot";
import { externalSourceText } from "./external-list";
import { bookPart, externalOf, findBlock, isModelSource } from "./pivot-external";
import { formatReference, readFormats } from "./xlsx-pivot-format";
import { GROUP_FIELD_NAME, GROUP_ORDER, isoOf, itemsGroupXml, rangeGroup, rangeGroupXml, readFieldGroup, serialOfIso, spanOf } from "./xlsx-pivot-group";
import type { Value } from "./values";

/*
 * Pivot tables in an .xlsx file. The table's cells are in the sheet like any others. Beside them a pivot table part says
 * which fields sit where, and a cache definition says where the records come from. Pli writes the cache without the
 * records and asks Excel to refresh on opening (`refreshOnLoad`), so Excel draws the table again from the source.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const SUBTOTAL: Record<PivotFunction, string> = { sum: "", count: "count", countNums: "countNums", average: "average", max: "max", min: "min", product: "product", stdDev: "stdDev", stdDevp: "stdDevp", var: "var", varp: "varp", distinctCount: "" };
/** The "show as" choices Excel's file format has; the others (rank, share of the parent) live in extensions Pli doesn't write. */
const SHOW_AS: Partial<Record<PivotShowAs, string>> = {
  percentOfTotal: "percentOfTotal",
  percentOfRow: "percentOfRow",
  percentOfColumn: "percentOfCol",
  differenceFromPrevious: "difference",
  percentDifferenceFromPrevious: "percentDiff",
  runningTotal: "runTotal",
  index: "index",
  differenceFrom: "difference",
  percentDifferenceFrom: "percentDiff",
  percentOf: "percent",
};
/** Excel's number for "(previous)" as the item a difference is taken from. */
const PREVIOUS_ITEM = 1048828;
/** Excel's number for "(next)". */
const NEXT_ITEM = 1048829;
/** The number format a "show as" gets when the value names none. */
const SHOW_FORMAT: Partial<Record<PivotShowAs, string>> = { percentOfTotal: "0.00%", percentOfRow: "0.00%", percentOfColumn: "0.00%", percentDifferenceFromPrevious: "0.00%", percentDifferenceFrom: "0.00%", percentOf: "0.00%", index: "0.00" };
const TOP_TYPE = { items: "count", percent: "percent", sum: "sum" } as const;

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * Why a pivot table whose cache reads a connection (`cacheSource type="external"`) is read as plain cells. When the connection is
 * Excel's data model, the cache still names the tables, columns and measures it uses (`cacheHierarchies`: `[Orders].[Region]`,
 * `[Measures].[Total]`); the rows, the relationships' columns and the measures' formulas are in the binary part `xl/model/item.data`
 * that only Excel reads, so they can't be rebuilt.
 */
export function excelModelReason(cache: XmlElement): string {
  const tables = new Set<string>();
  const measures = new Set<string>();
  for (const h of childrenNamed(child(cache, "cacheHierarchies"), "cacheHierarchy")) {
    const unique = attr(h, "uniqueName") ?? "";
    const m = /^\[([^\]]+)\]\.\[([^\]]+)\]/.exec(unique);
    if (!m) continue;
    if (m[1] === "Measures" || on(attr(h, "measure"), false)) measures.add(attr(h, "caption") ?? m[2]!);
    else tables.add(m[1]!);
  }
  const list = (what: string, set: Set<string>) => (set.size ? [`${what} ${[...set].slice(0, 8).join(", ")}${set.size > 8 ? "…" : ""}`] : []);
  const named = [...list("tables", tables), ...list("measures", measures)];
  return `it reads ${named.length ? `Excel's data model (${named.join("; ")})` : "a connection"}, whose rows and measures Excel keeps in a part only it reads, so the cells Excel drew stay as they are`;
}

/** An item's element in a cache's list of shared items. */
function sharedItem(v: Value): string {
  if (v === null || v === "") return "<m/>";
  if (typeof v === "number") return `<n v="${v}"/>`;
  if (typeof v === "boolean") return `<b v="${v ? 1 : 0}"/>`;
  if (typeof v === "object") return `<e v="${esc(v.error)}"/>`;
  return `<s v="${esc(v)}"/>`;
}

/** What a field's shared items say about its values. */
function sharedItemsXml(items: readonly PivotItem[], list: boolean, calculated: readonly string[] = []): string {
  const nums = items.filter((i) => typeof i.v === "number").map((i) => i.v as number);
  const strings = items.some((i) => typeof i.v === "string" && i.v !== "");
  const blank = items.some((i) => i.v === null || i.v === "");
  const other = items.some((i) => typeof i.v === "boolean" || (typeof i.v === "object" && i.v !== null));
  const attrs: string[] = [];
  if (!strings && !other) attrs.push('containsSemiMixedTypes="0"');
  if (!strings) attrs.push('containsString="0"');
  if (blank) attrs.push('containsBlank="1"');
  if (nums.length) {
    if (strings || other) attrs.push('containsMixedTypes="1"');
    attrs.push('containsNumber="1"');
    if (nums.every(Number.isInteger)) attrs.push('containsInteger="1"');
    attrs.push(`minValue="${Math.min(...nums)}"`, `maxValue="${Math.max(...nums)}"`);
  } else if (other && strings) attrs.push('containsMixedTypes="1"');
  if (!list) return `<sharedItems ${attrs.join(" ")}/>`;
  return `<sharedItems${attrs.length ? " " + attrs.join(" ") : ""} count="${items.length + calculated.length}">${items.map((i) => sharedItem(i.v)).join("")}${calculated.map((c) => `<s v="${esc(c)}"/>`).join("")}</sharedItems>`;
}

/** The shared items of a field of dates: Excel keeps them as dates (`d`), with the earliest and latest. */
function datedItemsXml(items: readonly PivotItem[], list: boolean): string {
  const nums = items.map((i) => i.v as number);
  // Excel's latest date is the day after the last one when the dates have no time.
  const last = Math.max(...nums) + (nums.every(Number.isInteger) ? 1 : 0);
  const attrs = `containsSemiMixedTypes="0" containsNonDate="0" containsDate="1" containsString="0" minDate="${isoOf(Math.min(...nums))}" maxDate="${isoOf(last)}"`;
  return list ? `<sharedItems ${attrs} count="${items.length}">${items.map((i) => `<d v="${isoOf(i.v as number)}"/>`).join("")}</sharedItems>` : `<sharedItems ${attrs}/>`;
}

/** The groups Excel sorts by their captions as text when a field says "ascending". */
const CAPTIONED: ReadonlySet<string> = new Set(["number", "dayRange", "days", "hours", "minutes", "seconds"]);

const X14_NS = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

/** The extra "show as" choices Excel keeps in the data field's extension list (`x14:dataField pivotShowAs`). */
const SHOW_AS_X14: Partial<Record<PivotShowAs, string>> = {
  percentOfParentRow: "percentOfParentRow",
  percentOfParentColumn: "percentOfParentCol",
  percentRunningTotal: "percentOfRunningTotal",
  rankAscending: "rankAscending",
  rankDescending: "rankDescending",
};

const TEST_NAMES: Partial<Record<FilterTestOp, string>> = { equals: "Equal", notEquals: "NotEqual", greaterThan: "GreaterThan", greaterThanOrEqual: "GreaterThanOrEqual", lessThan: "LessThan", lessThanOrEqual: "LessThanOrEqual", contains: "Contains", notContains: "NotContains", beginsWith: "BeginsWith", notBeginsWith: "NotBeginsWith", endsWith: "EndsWith", notEndsWith: "NotEndsWith" };
const DATE_NAMES: Partial<Record<FilterTestOp, string>> = { equals: "Equal", notEquals: "NotEqual", greaterThan: "NewerThan", greaterThanOrEqual: "NewerThanOrEqual", lessThan: "OlderThan", lessThanOrEqual: "OlderThanOrEqual" };
const OPERATORS: Partial<Record<FilterTestOp, string>> = { notEquals: "notEqual", greaterThan: "greaterThan", greaterThanOrEqual: "greaterThanOrEqual", lessThan: "lessThan", lessThanOrEqual: "lessThanOrEqual", notContains: "notEqual", notBeginsWith: "notEqual", notEndsWith: "notEqual" };
const PERIOD_X: Record<string, string> = { q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4" };
const periodType = (p: string) => PERIOD_X[p] ?? (/^m\d+$/.test(p) ? p.toUpperCase() : p);

/** A test's value the way a custom filter holds it: with the wildcards that make "contains" and the like. */
function testValue(t: FilterTest): string {
  const v = String(t.value ?? "");
  switch (t.op) {
    case "contains":
    case "notContains":
      return `*${v}*`;
    case "beginsWith":
    case "notBeginsWith":
      return `${v}*`;
    case "endsWith":
    case "notEndsWith":
      return `*${v}`;
    default:
      return v;
  }
}

/** A filter on the items' labels or on a value, as the `filter` element of a pivot table (without its id); null when the file format has nothing like it. */
function testFilterXml(f: Extract<PivotFieldFilter, { kind: "label" | "value" }>, dates: boolean): { type: string; xml: string } | null {
  const { a, b } = f;
  const one = (t: FilterTest) => `<customFilter${OPERATORS[t.op] ? ` operator="${OPERATORS[t.op]}"` : ""} val="${esc(testValue(t))}"/>`;
  const prefix = f.kind === "value" ? "value" : dates ? "date" : "caption";
  const names = dates && f.kind === "label" ? DATE_NAMES : TEST_NAMES;
  const name = (t: FilterTest) => (f.kind === "value" && /Contains|BeginsWith|EndsWith/.test(TEST_NAMES[t.op] ?? "") ? undefined : names[t.op]);
  if (!b) {
    const n = name(a);
    if (!n || a.op === "blank" || a.op === "notBlank") return null;
    return { type: `${prefix}${n}`, xml: `<customFilters>${one(a)}</customFilters>` };
  }
  if (a.op === "greaterThanOrEqual" && b.op === "lessThanOrEqual" && !f.or) return { type: `${prefix}Between`, xml: `<customFilters and="1">${one(a)}${one(b)}</customFilters>` };
  if (a.op === "lessThan" && b.op === "greaterThan" && f.or) return { type: `${prefix}NotBetween`, xml: `<customFilters>${one(a)}${one(b)}</customFilters>` };
  return null;
}

/** The parts of one cache field the table needs to point at items. */
interface CacheField {
  name: string;
  /** The field of the source it reads (or groups). */
  base: number;
  kind: "source" | "extra" | "calc";
  group?: PivotGroup;
  /** The part of the table's rows or columns that uses it. */
  entry?: PivotAxisField;
  side?: "row" | "col";
  /** The items the table lists for it, in order (the shared items of a plain field, the group items of a grouped one). */
  labels: string[];
  /** Where an item stands in `labels`. */
  pos: (item: PivotItem) => number;
  par?: number;
  /** The `fieldGroup` and `sharedItems` it holds. */
  fieldGroup?: string;
  shared?: string;
  /** How many of the items are the table's own calculated items (the last ones). */
  calc: number;
  /** Whether the cache lists the field's shared items (a record then points at one by position instead of holding the value). */
  listed?: boolean;
  /** Groups of items are made over this field: its items are listed although it is on no axis. */
  groupedOver?: boolean;
  /** A field of dates or times. */
  dated?: boolean;
  /** For a source field: where each value's item is among the shared items. */
  keyPos?: Map<string, number>;
}

/** What a pivot table's part says about its fields, for the slicers and timelines that point into it. */
export interface PivotPartsInfo {
  /** The cache fields: their names and items. */
  fields: { name: string; labels: string[] }[];
  /** The cache field a slicer of this source field reads. */
  fieldFor(name: string): number;
  /** The earliest and latest day of a field of numbers (dates), or null. */
  span(name: string): { min: number; max: number } | null;
}

/** The two parts of one pivot table, or null when its source isn't there. `n` numbers them across the workbook. */
export function pivotParts(wb: Workbook, sheet: Sheet, pivot: Pivot, n: number, valueAt: (sheet: Sheet, address: string) => Value, numFmtId: (fmt: string | undefined) => number, now: number, dxf?: (style: TableStylePart) => number): { cache: string; table: string; rels: string; info: PivotPartsInfo; records?: string; cacheRels?: string } | null {
  // The data model and data blocks the host supplies have no place in a file Excel opens; pivot tables over them are written as the cells they drew.
  if (isModelSource(pivot.source) || (externalOf(pivot.source)?.kind === "data")) return null;
  if (pivot.values.some((v) => v.fn === "distinctCount")) return null;
  const src = readPivotSource(wb, pivot, sheet.name, valueAt);
  const many = pivotSourceRanges(wb, pivot, sheet.name);
  const outside = bookPart(pivot.source);
  const block = outside ? findBlock(wb, pivot.source) : undefined;
  const at = many || outside ? null : pivotSourceRange(wb, pivot.source, sheet.name);
  if (!src || (!at && !many && !outside)) return null;
  const nSrc = src.fields.length;
  const calcs = pivot.calculated ?? [];
  const calcItems = pivot.calculatedItems ?? [];
  const filters = pivot.filters ?? [];
  const k = pivot.values.length;
  const m = pivot.columns.length;
  const render = renderPivot(pivot, src);
  const onRows = render.valuesOnRows;
  const axes = [...pivot.rows.map((entry) => ({ entry, side: "row" as const })), ...pivot.columns.map((entry) => ({ entry, side: "col" as const }))];
  // What the file format can't hold the way Pli means it is left as the cells it drew.
  if (axes.some(({ entry }) => fieldFilters(entry).some((f) => f.kind === "color"))) return null;
  const sourceIndex = (name: string) => src.fields.indexOf(name);
  if (axes.some(({ entry }) => sourceIndex(entry.field) < 0) || filters.some((f) => sourceIndex(f.field) < 0)) return null;
  if (pivot.values.some((v) => sourceIndex(v.field) < 0 && !calcs.some((c) => c.name.toLowerCase() === v.field.toLowerCase()))) return null;
  const dateField = (i: number) => (src.formats[i] ? isDateFormat(src.formats[i]!) : false);

  // ---- the cache fields: the source's own, the ones a grouping adds, and the calculated ones ----
  const fieldItemsOf = new Map<number, PivotItem[]>();
  const plainEntry = new Map<number, PivotAxisField>();
  const extras: CacheField[] = [];
  const cfOf = new Map<PivotAxisField, number>();
  const mainGroup = new Map<number, { group: PivotGroup; entry: PivotAxisField; side: "row" | "col"; par?: number }>();
  /** For a field that groups of items are made over: the cache field that holds the (innermost) group. Excel writes `<fieldGroup par="…"/>` on the field. */
  const groupedBy = new Map<number, number>();
  const extraStart = nSrc;
  for (let fi = 0; fi < nSrc; fi++) {
    const list = axes.filter(({ entry }) => entry.field === src.fields[fi]);
    if (!list.length) continue;
    const grouped = list.filter(({ entry }) => entry.group);
    const plain = list.filter(({ entry }) => !entry.group);
    const itemGroups = grouped.filter(({ entry }) => entry.group!.by === "items");
    const rangeGroups = grouped.filter(({ entry }) => entry.group!.by !== "items");
    if (plain.length > 1) return null;
    if (plain[0]) plainEntry.set(fi, plain[0].entry);
    if (rangeGroups.length) {
      const sole = rangeGroups.some(({ entry }) => entry.group!.by === "number" || entry.group!.by === "dayRange");
      if (plain.length || itemGroups.length || (sole && rangeGroups.length > 1)) return null;
      if (pivot.values.some((v) => v.field === src.fields[fi]) || filters.some((f) => f.field === src.fields[fi])) return null;
      if (calcItems.some((c) => c.field === src.fields[fi])) return null;
      // The finest part is the field itself; each coarser one is a field of its own, and each part's parent is the next coarser.
      const sorted = [...rangeGroups].sort((x, y) => GROUP_ORDER.indexOf(x.entry.group!.by as never) - GROUP_ORDER.indexOf(y.entry.group!.by as never));
      if (new Set(sorted.map(({ entry }) => entry.group!.by)).size !== sorted.length) return null;
      const at = sorted.map((_, i) => (i === sorted.length - 1 ? fi : extraStart + extras.length + i));
      sorted.forEach(({ entry, side }, i) => {
        cfOf.set(entry, at[i]!);
        const parent = i > 0 ? at[i - 1] : undefined;
        if (i === sorted.length - 1) {
          mainGroup.set(fi, { group: entry.group!, entry, side, par: parent });
          return;
        }
        const g = rangeGroup(entry.group as never, src, src.fields[fi]!);
        const labelPos = new Map(g.labels.map((l, x) => [l, x]));
        extras.push({ name: GROUP_FIELD_NAME[entry.group!.by as PivotGroupBy], base: fi, kind: "extra", group: entry.group, entry, side, labels: g.labels, pos: (it) => labelPos.get(it.label) ?? 0, ...(parent !== undefined ? { par: parent } : {}), fieldGroup: rangeGroupXml(g.labels, g.attrs, fi, parent), shared: "<sharedItems/>", calc: 0 });
      });
    }
    // Groups of items: each level of a group inside a group is a cache field of its own, tied to the field it is made over by
    // `base` and to the group that groups it again by `par`.
    const levelAt = new Map<string, number>();
    const baseItems = fieldItems(src, src.fields[fi]!, !!plain[0]?.entry.descending, undefined, plain[0]?.entry.order);
    for (const { entry, side } of itemGroups) {
      const top = entry.group as PivotItemsGroup;
      const chain: PivotItemsGroup[] = [];
      for (let g: PivotItemsGroup | undefined = top; g; g = g.of) chain.push(g);
      // From the innermost level out: the next level's field comes right after.
      const inner = [...chain].reverse();
      const keys = inner.map((g, k) => JSON.stringify({ ...g, of: undefined, below: inner.slice(0, k).map((x) => x.groups) }));
      const headings = itemsHeadings(src.fields[fi]!, top);
      inner.forEach((group, k) => {
        if (levelAt.has(keys[k]!)) return;
        const idx = extraStart + extras.length;
        levelAt.set(keys[k]!, idx);
        const shownItems = fieldItems(src, src.fields[fi]!, false, group);
        const labels = shownItems.map((i) => i.label);
        const make = itemMaker(src, src.fields[fi]!, group);
        const of = baseItems.map((it) => {
          const rec: Value[] = [];
          rec[fi] = it.v;
          return Math.max(0, labels.indexOf(make(rec).label));
        });
        const labelPos = new Map(labels.map((l, i) => [l, i]));
        // The group that groups this one again is made right after it.
        const par = k < inner.length - 1 ? idx + 1 : undefined;
        extras.push({ name: headings[k]!, base: fi, kind: "extra", group, entry, side, labels, pos: (it) => labelPos.get(it.label) ?? 0, ...(par !== undefined ? { par } : {}), fieldGroup: itemsGroupXml(labels, of, fi, par), shared: "<sharedItems/>", calc: 0 });
      });
      cfOf.set(entry, levelAt.get(keys[keys.length - 1]!)!);
      if (!groupedBy.has(fi)) groupedBy.set(fi, levelAt.get(keys[0]!)!);
    }
    if (plain[0]) cfOf.set(plain[0].entry, fi);
  }
  // Names are unique across the cache's fields.
  const taken = new Set([...src.fields, ...calcs.map((c) => c.name)].map((x) => x.toLowerCase()));
  for (const x of extras) {
    let name = x.name;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${x.name}${i}`;
    taken.add(name.toLowerCase());
    x.name = name;
  }
  const calcStart = extraStart + extras.length;
  const total = calcStart + calcs.length;
  const cfs: CacheField[] = [];
  for (let fi = 0; fi < nSrc; fi++) {
    const name = src.fields[fi]!;
    const entry = plainEntry.get(fi);
    const grouped = mainGroup.get(fi);
    const items = fieldItems(src, name, !!entry?.descending, undefined, entry?.order);
    fieldItemsOf.set(fi, items);
    const mine = calcItems.filter((c) => c.field.toLowerCase() === name.toLowerCase());
    const labels = items.map((i) => i.label);
    const keyPos = new Map(items.map((it, i) => [it.key, i]));
    const calcPos = new Map(mine.map((c, i) => [c.name, items.length + i]));
    const placed = axes.some((a) => cfOf.get(a.entry) === fi) || filters.some((f) => f.field === name);
    const numeric = items.length > 0 && items.every((it) => typeof it.v === "number");
    // A column of dates (or times) is a field of dates in the cache, as Excel keeps it: the date filters work on those only.
    const dated = numeric && dateField(fi) && !mine.length && !grouped;
    if (grouped) {
      const g = rangeGroup(grouped.group as never, src, name);
      const labelPos = new Map(g.labels.map((l, i) => [l, i]));
      const dates = GROUP_ORDER.includes(grouped.group.by as never) || grouped.group.by === "dayRange";
      const shared = dates
        ? `<sharedItems containsSemiMixedTypes="0" containsNonDate="0" containsDate="1" containsString="0"${items.length ? ` minDate="${isoOf(Math.min(...items.map((i) => i.v as number)))}" maxDate="${isoOf(Math.max(...items.map((i) => i.v as number)) + 1 / 86400)}"` : ""} count="${items.length}">${items.map((i) => (typeof i.v === "number" ? `<d v="${isoOf(i.v)}"/>` : sharedItem(i.v))).join("")}</sharedItems>`
        : sharedItemsXml(items, true);
      const reversed = CAPTIONED.has(grouped.group.by) && !grouped.entry.sortBy && !!grouped.entry.descending;
      cfs.push({ name, base: fi, kind: "source", group: grouped.group, entry: grouped.entry, side: grouped.side, labels: g.labels, pos: (it) => (reversed ? g.labels.length - 1 - (labelPos.get(it.label) ?? 0) : labelPos.get(it.label) ?? 0), par: grouped.par, fieldGroup: rangeGroupXml(g.labels, g.attrs, fi, grouped.par), shared, calc: 0, listed: true, keyPos });
      continue;
    }
    cfs.push({
      name,
      base: fi,
      kind: "source",
      ...(entry ? { entry, side: axes.find((a) => a.entry === entry)!.side } : {}),
      labels: [...labels, ...mine.map((c) => c.name)],
      pos: (it) => (it.calc ? (calcPos.get(it.label) ?? 0) : (keyPos.get(it.key) ?? 0)),
      shared: dated ? datedItemsXml(items, placed) : sharedItemsXml(items, placed || !numeric, mine.map((c) => c.name)),
      ...(groupedBy.has(fi) ? { fieldGroup: `<fieldGroup par="${groupedBy.get(fi)}"/>`, groupedOver: true } : {}),
      ...(dated ? { dated: true } : {}),
      calc: mine.length,
      listed: placed || !numeric,
      keyPos,
    });
  }
  cfs.push(...extras);
  calcs.forEach((c) => cfs.push({ name: c.name, base: -1, kind: "calc", labels: [], pos: () => 0, calc: 0 }));
  const index = (name: string): number => {
    const exact = src.fields.indexOf(name);
    if (exact >= 0) return exact;
    const c = calcs.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
    return c >= 0 ? calcStart + c : -1;
  };
  void total;

  // ---- the cache ----
  const cacheFields = cfs.map((cf, i) => {
    if (cf.kind === "calc") {
      const c = calcs[i - calcStart]!;
      return `<cacheField name="${esc(cf.name)}" numFmtId="0" formula="${esc(c.formula)}" databaseField="0"/>`;
    }
    const numFmt = cf.fieldGroup && cf.group && cf.kind === "source" && (GROUP_ORDER.includes(cf.group.by as never) || cf.group.by === "dayRange") ? numFmtId(src.formats[cf.base]) || 14 : outside && cf.kind === "source" ? numFmtId(src.formats[cf.base]) : cf.dated ? numFmtId(src.formats[cf.base]) : 0;
    if (cf.kind === "extra") return `<cacheField name="${esc(cf.name)}" numFmtId="0" databaseField="0">${cf.shared}${cf.fieldGroup}</cacheField>`;
    return `<cacheField name="${esc(cf.name)}" numFmtId="${numFmt}">${cf.shared}${cf.fieldGroup ?? ""}</cacheField>`;
  });
  // A pivot table made from several ranges has page fields: by default one, which names the range; 0 to 4 you fill in yourself.
  const pages = pivot.pageFields ?? 1;
  const source = (() => {
    if (many) {
      const custom = pages !== 1 || (pivot.ranges ?? []).some((r, i) => r.name !== undefined && r.name !== `Item${i + 1}`);
      const items = Array.from({ length: pages }, (_, k) => [...new Set(many.map((r) => r.names[k]!))]);
      return (
        `<cacheSource type="consolidation"><consolidation autoPage="${custom ? 0 : 1}">${pages === 0 ? "" : `<pages count="${pages}">${items.map((list) => `<page count="${list.length}">${list.map((x) => `<pageItem name="${esc(x)}"/>`).join("")}</page>`).join("")}</pages>`}` +
        `<rangeSets count="${many.length}">${many.map((r) => `<rangeSet${items.map((list, k) => ` i${k + 1}="${list.indexOf(r.names[k]!)}"`).join("")} ref="${rangeAddress(r.bounds)}" sheet="${esc(r.sheet.name)}"/>`).join("")}</rangeSets></consolidation></cacheSource>`
      );
    }
    if (outside) {
      // A range of another workbook: the cache names the file through a relationship and holds the rows that were read.
      return `<cacheSource type="worksheet"><worksheetSource ref="${outside.range}" sheet="${esc(outside.sheet)}" r:id="rId1"/></cacheSource>`;
    }
    const found = pivot.source;
    return `<cacheSource type="worksheet">${!found.includes("!") ? `<worksheetSource name="${esc(found)}"/>` : `<worksheetSource ref="${rangeAddress(at!.bounds)}" sheet="${esc(at!.sheet.name)}"/>`}</cacheSource>`;
  })();
  const calcItemsXml = calcItems.length
    ? `<calculatedItems count="${calcItems.length}">${calcItems
        .map((c) => {
          const cf = cfs.find((x) => x.kind === "source" && x.name.toLowerCase() === c.field.toLowerCase())!;
          const at = cf.labels.indexOf(c.name);
          return `<calculatedItem field="${cf.base}" formula="${esc(c.formula)}"><pivotArea type="data" outline="0" fieldPosition="0"><references count="1"><reference field="${cf.base}" count="1" selected="0"><x v="${at}"/></reference></references></pivotArea></calculatedItem>`;
        })
        .join("")}</calculatedItems>`
    : "";
  const sliced = (pivot.slicers?.length ?? 0) + (pivot.timelines?.length ?? 0) > 0;
  const cache =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="${NS}" xmlns:r="${R}"${outside ? ' r:id="rId2"' : ' saveData="0" refreshOnLoad="1"'} refreshedBy="Pli" refreshedDate="${now}" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${src.records.length}">` +
    `${source}<cacheFields count="${cacheFields.length}">${cacheFields.join("")}</cacheFields>${calcItemsXml}` +
    `${sliced ? `<extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="${X14_NS}"><x14:pivotCacheDefinition pivotCacheId="${n}"/></ext></extLst>` : ""}</pivotCacheDefinition>`;

  // ---- the fields of the table ----
  const hiddenAt = (cf: CacheField, label: string): boolean => {
    if (cf.entry?.hidden?.includes(label)) return true;
    const filter = filters.find((f) => src.fields[cf.base] === f.field && cf.kind === "source" && !cf.group);
    return !!filter && !filter.items.includes(label);
  };
  const pivotFields = cfs.map((cf, i) => {
    if (cf.kind === "calc") return '<pivotField dataField="1" dragToRow="0" dragToCol="0" dragToPage="0" showAll="0" defaultSubtotal="0"/>';
    const name = cf.name;
    const entry = cf.entry;
    const row = cf.side === "row";
    const col = cf.side === "col";
    const page = cf.kind === "source" && !cf.group ? filters.find((f) => f.field === src.fields[cf.base] && !f.hidden) : undefined;
    const quiet = cf.kind === "source" && !cf.group ? filters.find((f) => f.field === src.fields[cf.base] && f.hidden) : undefined;
    const a: string[] = [];
    if (row || col || page) a.push(`axis="${row ? "axisRow" : col ? "axisCol" : "axisPage"}"`);
    if (cf.kind === "source" && pivot.values.some((v) => v.field === name)) a.push('dataField="1"');
    if (pivot.tabular && (row || col)) a.push('compact="0"', 'outline="0"');
    else if (pivot.outline && (row || col)) a.push('compact="0"');
    a.push('showAll="0"');
    // A filter by a value (a comparison, or the top and bottom items) is marked on its field, as Excel marks it.
    if (entry && fieldFilters(entry).some((f) => f.kind === "value" || f.kind === "top")) a.push('measureFilter="1"');
    // Excel sorts the captions of day ranges, number ranges and hours as text (1 PM before 8 AM), so those groups, which are listed in
    // their own order already, are written as manual (a descending one is listed from the end).
    const captioned = !!cf.group && cf.kind !== "extra" && CAPTIONED.has(cf.group.by);
    const reverse = captioned && !entry?.sortBy && !!entry?.descending;
    if (entry) a.push(`sortType="${entry.order || (captioned && !entry.sortBy) ? "manual" : (entry.sortBy ? entry.sortBy.descending : entry.descending) ? "descending" : "ascending"}"`);
    if (entry?.subtotal === false) a.push('defaultSubtotal="0"');
    // Blank lines only show in the outline and tabular forms, as in Pli.
    if (entry?.blankRow && (pivot.tabular || pivot.outline)) a.push('insertBlankRow="1"');
    const chosen = page ?? quiet;
    if (chosen && cf.labels.filter((l) => chosen.items.includes(l)).length > 1) a.push('multipleItemSelectionAllowed="1"');
    if (!(row || col || page || quiet)) {
      // Excel lists the items of a field that groups of items are made over, though it is on no axis.
      if (!cf.groupedOver) return `<pivotField ${a.join(" ")}/>`;
      return `<pivotField ${a.join(" ")}><items count="${cf.labels.length + 1}">${cf.labels.map((_, x) => `<item x="${x}"/>`).join("")}<item t="default"/></items></pivotField>`;
    }
    const firstCalc = cf.labels.length - cf.calc;
    const items = cf.labels.map((label, x) => `<item${hiddenAt(cf, label) ? ' h="1"' : ""} x="${x}"/>`);
    if (reverse) items.reverse();
    if (entry?.subtotal !== false) items.push('<item t="default"/>');
    // Sorted by a value: the items are listed in their own order and Excel orders them by the value.
    const scope = entry?.sortBy ? `<autoSortScope><pivotArea dataOnly="0" outline="0" fieldPosition="0"><references count="1"><reference field="4294967294" count="1" selected="0"><x v="${entry.sortBy.value}"/></reference></references></pivotArea></autoSortScope>` : "";
    // Writing the outer labels again on every row is one of the settings Excel keeps in the field's extensions.
    const fill = pivot.repeatLabels && row && (pivot.tabular || pivot.outline) ? `<extLst><ext uri="{2946ED86-A175-432a-8AC1-64E0C546D7DE}" xmlns:x14="${X14_NS}"><x14:pivotField fillDownLabels="1"/></ext></extLst>` : "";
    void i;
    return `<pivotField ${a.join(" ")}><items count="${items.length}">${items.join("")}</items>${scope}${fill}</pivotField>`;
  });

  // ---- where the table is, and which rows and columns it lists ----
  const whole = renderRange(pivot.anchor, render);
  const sub = onRows ? 1 : Math.max(k, 1);
  const dataCols = k ? render.colEntries.length * sub : 0;
  const body: Bounds = { r1: whole.r1 + render.bodyTop, c1: whole.c1, r2: whole.r2, c2: whole.c1 + Math.max(render.labelCols + dataCols, 1) - 1 };
  const shownFilters = filters.filter((f) => !f.hidden);
  const locate = `<location ref="${rangeAddress(body)}" firstHeaderRow="1" firstDataRow="${render.headerRows}" firstDataCol="${render.labelCols}"${shownFilters.length ? ` rowPageCount="${shownFilters.length}" colPageCount="1"` : ""}/>`;

  type Line = { x: number[]; t?: "default" | "grand" | "blank"; i?: number; r?: number };
  const items = (lines: Line[]) => {
    let prev: number[] = [];
    return lines
      .map((line) => {
        let r = 0;
        if (!line.t) while (r < prev.length && r < line.x.length - 1 && prev[r] === line.x[r]) r++;
        prev = line.x;
        const xs = line.x.slice(r).map((v) => (v ? `<x v="${v}"/>` : "<x/>")).join("");
        return `<i${r ? ` r="${r}"` : ""}${line.t ? ` t="${line.t}"` : ""}${line.i ? ` i="${line.i}"` : ""}${xs ? `>${xs}</i>` : "/>"}`;
      })
      .join("");
  };
  const at1 = (fields: PivotAxisField[], path: readonly PivotItem[]) => path.map((it, d) => cfs[cfOf.get(fields[d]!)!]!.pos(it));
  const rowLines: Line[] = [];
  if (onRows) {
    // The values are a field of the rows (-2) after the row fields: each value line carries the number of its value.
    for (const line of render.lines) {
      if (line.entry === null) {
        rowLines.push({ x: [], t: "blank" });
        continue;
      }
      const e = render.rowEntries[line.entry]!;
      const path = e.kind === "grand" ? [] : at1(pivot.rows, e.path);
      const t = e.kind === "grand" ? ("grand" as const) : e.kind === "subtotal" ? ("default" as const) : undefined;
      rowLines.push({ x: line.value === undefined ? path : [...path, line.value], ...(t ? { t } : {}), ...(line.value ? { i: line.value } : {}) });
    }
  } else {
    for (const e of render.rowEntries) rowLines.push(e.kind === "grand" ? { x: [0], t: "grand" } : { x: at1(pivot.rows, e.path), ...(e.kind === "subtotal" ? { t: "default" as const } : e.kind === "blank" ? { t: "blank" as const } : {}) });
  }
  const colLines: Line[] = [];
  const withData = k > 1 && !onRows;
  for (const e of render.colEntries) {
    for (let j = 0; j < sub; j++) {
      const path = e.kind === "grand" ? [] : at1(pivot.columns, e.path);
      // With no column fields Excel writes the one column item as `<i/>`.
      const x = withData ? [...path, j] : e.kind === "grand" ? (m > 0 ? [0] : []) : path;
      colLines.push({ x, ...(m > 0 && e.kind === "grand" ? { t: "grand" as const } : m > 0 && e.kind === "subtotal" ? { t: "default" as const } : {}), ...(withData && j > 0 ? { i: j } : {}) });
    }
  }
  const rowList = [...pivot.rows.map((f) => cfOf.get(f)!), ...(onRows ? [-2] : [])];
  const rowFields = rowList.length ? `<rowFields count="${rowList.length}">${rowList.map((x) => `<field x="${x}"/>`).join("")}</rowFields><rowItems count="${rowLines.length}">${items(rowLines)}</rowItems>` : `<rowItems count="${rowLines.length}">${items(rowLines)}</rowItems>`;
  const colList = [...pivot.columns.map((f) => cfOf.get(f)!), ...(withData ? [-2] : [])];
  const colFields = colList.length ? `<colFields count="${colList.length}">${colList.map((x) => `<field x="${x}"/>`).join("")}</colFields>` : "";
  const colItems = `<colItems count="${colLines.length}">${items(colLines)}</colItems>`;
  const pageFields = shownFilters.length
    ? `<pageFields count="${shownFilters.length}">${shownFilters
        .map((f) => {
          const cf = cfs[index(f.field)]!;
          const chosen = cf.labels.map((l, x) => [l, x] as const).filter(([l]) => f.items.includes(l));
          return `<pageField fld="${index(f.field)}"${chosen.length === 1 && cf.labels.length > 1 ? ` item="${chosen[0]![1]}"` : ""} hier="-1"/>`;
        })
        .join("")}</pageFields>`
    : "";
  const dataFields = k
    ? `<dataFields count="${k}">${pivot.values
        .map((v, i) => {
          const fn = render.functions[i]!;
          const fmt = v.fmt ?? (v.showAs ? SHOW_FORMAT[v.showAs] : undefined);
          const id = numFmtId(fmt);
          const baseAxis = (m > 0 ? pivot.columns : pivot.rows).at(-1);
          const along = v.showAs === "differenceFromPrevious" || v.showAs === "percentDifferenceFromPrevious" || v.showAs === "runningTotal" || v.showAs === "differenceFrom" || v.showAs === "percentDifferenceFrom" || v.showAs === "percentOf" || v.showAs === "percentRunningTotal" || v.showAs === "rankAscending" || v.showAs === "rankDescending";
          const baseName = v.base?.field ?? baseAxis?.field;
          const baseEntry = [...pivot.rows, ...pivot.columns].find((f) => f.field === baseName);
          const baseCf = baseEntry ? cfOf.get(baseEntry)! : -1;
          const baseField = along && baseCf >= 0 ? baseCf : 0;
          const wanted = v.base?.item;
          const baseItem =
            v.showAs === "differenceFromPrevious" || v.showAs === "percentDifferenceFromPrevious"
              ? PREVIOUS_ITEM
              : typeof wanted === "object"
                ? wanted.step === "previous"
                  ? PREVIOUS_ITEM
                  : NEXT_ITEM
                : wanted !== undefined && baseCf >= 0
                  ? Math.max(0, cfs[baseCf]!.labels.findIndex((l) => l === wanted))
                  : 0;
          const x14 = v.showAs && SHOW_AS_X14[v.showAs] ? `<extLst><ext uri="{E15A36E0-9728-4e99-A89B-3F7291B0FE68}" xmlns:x14="${X14_NS}"><x14:dataField pivotShowAs="${SHOW_AS_X14[v.showAs]}"/></ext></extLst>` : "";
          const open = `<dataField name="${esc(render.valueNames[i]!)}" fld="${index(v.field)}"${SUBTOTAL[fn] ? ` subtotal="${SUBTOTAL[fn]}"` : ""}${v.showAs && SHOW_AS[v.showAs] ? ` showDataAs="${SHOW_AS[v.showAs]}"` : ""} baseField="${baseField}" baseItem="${baseItem}"${id ? ` numFmtId="${id}"` : ""}`;
          return x14 ? `${open}>${x14}</dataField>` : `${open}/>`;
        })
        .join("")}</dataFields>`
    : "";
  // Looks given to cells of the table, found by the items they stand for.
  const formatsXml = dxf
    ? formatReference(
        pivot,
        (heading) => {
          const hit = axes.find(({ entry }) => axisHeading(entry) === heading);
          const cf = hit && cfs[cfOf.get(hit.entry)!];
          return hit && cf ? { fld: cfOf.get(hit.entry)!, side: hit.side, labels: cf.labels } : undefined;
        },
        k,
        m > 0,
        dxf,
      )
    : "";
  // Rules that follow the pivot table: Excel keeps the area each covers here, tied to the rule in the sheet by its priority.
  const ruled = (sheet.conditional ?? []).flatMap((r, i) => (r.pivot?.id === pivot.id ? [{ rule: r, priority: i + 1 }] : []));
  const conditionalFormats = ruled.length
    ? `<conditionalFormats count="${ruled.length}">${ruled
        .map(({ rule, priority }) => {
          const p = rule.pivot!;
          // Items a rule is limited to are references to those items (their place in the field's list); a field level has none.
          const byField = new Map<number, number[]>();
          if (p.rows !== undefined) byField.set(index(p.rows), []);
          if (p.columns !== undefined) byField.set(index(p.columns), []);
          for (const [field, labels] of Object.entries(p.items ?? {})) {
            const at = cfs[index(field)]?.labels ?? [];
            const xs = labels.map((l) => at.indexOf(l)).filter((x) => x >= 0);
            if (xs.length) byField.set(index(field), xs);
          }
          const picked = [...byField.values()].some((xs) => xs.length > 0);
          const refs = [
            ...(p.value !== undefined ? [`<reference field="4294967294" count="1" selected="0"><x v="${p.value}"/></reference>`] : []),
            ...[...byField.entries()].sort((x, y) => x[0] - y[0]).map(([field, xs]) => `<reference field="${field}" count="${xs.length}" selected="0"${xs.length ? `>${xs.map((x) => `<x v="${x}"/>`).join("")}</reference>` : "/>"}`),
          ];
          // Rules for all cells showing a value are "data" or "field" scope; with items they are for selected cells, which is the default.
          const scope = picked ? "selection" : refs.length ? "field" : "data";
          const area = (list: string[]) => `<pivotArea type="data" collapsedLevelsAreSubtotals="1" fieldPosition="0">${list.length ? `<references count="${list.length}">${list.join("")}</references>` : ""}</pivotArea>`;
          const areas = [area(refs)];
          // Excel counts only the cells at the level of the last field named (West's own total); the cells of the inner levels under the items are
          // areas of their own, with every item of each inner field.
          if (scope === "selection" && p.rows === undefined && p.columns === undefined) {
            const inner = (fields: PivotAxisField[]) => {
              const named = fields.map((f, d) => (p.items?.[f.field] ? d : -1)).filter((d) => d >= 0);
              if (!named.length) return [];
              return fields.slice(Math.max(...named) + 1).map((f) => cfOf.get(f)!);
            };
            const rowInner = inner(pivot.rows);
            const colInner = inner(pivot.columns);
            const all = (field: number) => `<reference field="${field}" count="0" selected="0"/>`;
            for (let i = 0; i <= rowInner.length; i++) {
              for (let j = 0; j <= colInner.length; j++) {
                if (i === 0 && j === 0) continue;
                const extra = [...rowInner.slice(0, i), ...colInner.slice(0, j)].sort((x, y) => x - y).map(all);
                const list = [...refs, ...extra].sort((x, y) => Number(/field="(\d+)"/.exec(x)![1]) - Number(/field="(\d+)"/.exec(y)![1]));
                areas.push(area(list));
              }
            }
          }
          return `<conditionalFormat${scope === "selection" ? "" : scope === "data" ? ' scope="data"' : ' scope="field"'} priority="${priority}"><pivotAreas count="${areas.length}">${areas.join("")}</pivotAreas></conditionalFormat>`;
        })
        .join("")}</conditionalFormats>`
    : "";
  // Filters on the items: the greatest or least, their labels, dates or what a value comes to.
  const list: string[] = [];
  let ok = true;
  // A field with more than one filter (and items picked as well) is Excel's "Allow multiple filters per field".
  let multiple = false;
  for (const { entry } of axes) {
    const all = fieldFilters(entry);
    if (all.length + (entry.hidden?.length ? 1 : 0) > 1) multiple = true;
    for (const [at, f] of all.entries()) {
      const fld = cfOf.get(entry)!;
      const id = list.length + 1;
      const order = all.length > 1 ? at : -1;
      if (f.kind === "top") list.push(`<filter fld="${fld}" type="${TOP_TYPE[f.unit ?? "items"]}" evalOrder="${order}" id="${id}" iMeasureFld="${f.by}"><autoFilter ref="A1"><filterColumn colId="0"><top10${f.bottom ? ' top="0"' : ""} val="${f.n}" filterVal="${f.n}"/></filterColumn></autoFilter></filter>`);
      else if (f.kind === "date") list.push(`<filter fld="${fld}" type="${periodType(f.period)}" evalOrder="${order}" id="${id}"><autoFilter ref="A1"><filterColumn colId="0"><dynamicFilter type="${periodType(f.period)}"/></filterColumn></autoFilter></filter>`);
      else if (f.kind === "label" || f.kind === "value") {
        const dates = f.kind === "label" && dateField(cfs[fld]!.base) && typeof f.a.value === "number";
        const x = testFilterXml(f, dates);
        if (!x) ok = false;
        else list.push(`<filter fld="${fld}" type="${x.type}" evalOrder="${order}" id="${id}"${f.kind === "value" ? ` iMeasureFld="${f.by}"` : ""}><autoFilter ref="A1"><filterColumn colId="0">${x.xml}</filterColumn></autoFilter></filter>`);
      }
    }
  }
  if (!ok) return null;
  const topFilters = list.length ? `<filters count="${list.length}">${list.join("")}</filters>` : "";
  const st = pivot.style;
  const styleInfo = st
    ? `<pivotTableStyleInfo${st.name !== "none" ? ` name="${st.name}"` : ""} showRowHeaders="${st.rowHeaders === false ? 0 : 1}" showColHeaders="${st.colHeaders === false ? 0 : 1}" showRowStripes="${st.rowStripes ? 1 : 0}" showColStripes="${st.colStripes ? 1 : 0}" showLastColumn="1"/>`
    : `<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/>`;
  const table =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="${NS}" name="${esc(pivot.name)}" cacheId="${n}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0"${onRows ? ' dataOnRows="1"' : ""}` +
    `${pivot.tabular ? ' compact="0" compactData="0"' : pivot.outline ? ' compact="0" compactData="0" outline="1" outlineData="1"' : ' outline="1" outlineData="1"'}${pivot.grandTotalRows === false ? ' rowGrandTotals="0"' : ""}${pivot.grandTotalColumns === false ? ' colGrandTotals="0"' : ""} multipleFieldFilters="${multiple ? 1 : 0}">` +
    `${locate}<pivotFields count="${pivotFields.length}">${pivotFields.join("")}</pivotFields>${rowFields}${colFields}${colItems}${pageFields}${dataFields}${formatsXml}${conditionalFormats}` +
    `${styleInfo}${topFilters}</pivotTableDefinition>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${R}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition${n}.xml"/></Relationships>`;
  const info: PivotPartsInfo = {
    fields: cfs.map((cf) => ({ name: cf.name, labels: cf.labels })),
    fieldFor: (name) => {
      const entry = axes.find((a) => a.entry.field === name)?.entry;
      return entry && cfOf.has(entry) ? cfOf.get(entry)! : index(name);
    },
    span: (name) => {
      const sp = spanOf(src, name);
      return sp && { min: Math.floor(sp.min), max: Math.floor(sp.max) };
    },
  };
  if (!outside) return { cache, table, rels, info };
  // The rows of the other workbook that were read are kept in the cache's records, so the file works with the other workbook closed.
  const sourceFields = cfs.filter((cf) => cf.kind === "source");
  const recordCell = (cf: CacheField, v: Value): string => (cf.listed ? `<x v="${cf.keyPos?.get(itemKey(v)) ?? 0}"/>` : sharedItem(v));
  const records =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="${NS}" xmlns:r="${R}" count="${src.records.length}">` +
    src.records.map((rec) => `<r>${sourceFields.map((cf) => recordCell(cf, rec[cf.base] ?? null)).join("")}</r>`).join("") +
    `</pivotCacheRecords>`;
  const where = block?.path ?? outside.book;
  const cacheRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${R}/externalLinkPath" Target="${esc(where)}" TargetMode="External"/>` +
    `<Relationship Id="rId2" Type="${R}/pivotCacheRecords" Target="pivotCacheRecords${n}.xml"/></Relationships>`;
  return { cache, table, rels, info, records, cacheRels };
}

// ---- reading ----

/** The labels of a cache field's shared items, as a pivot table shows them. */
function sharedLabels(field: XmlElement | undefined, fmt: string | undefined): { label: string; value: Value }[] | null {
  const shared = child(field, "sharedItems");
  if (!shared) return [];
  const out: { label: string; value: Value }[] = [];
  for (const el of elements(shared)) {
    const v = attr(el, "v");
    let value: Value;
    switch (el.name) {
      case "s":
        value = v ?? "";
        break;
      case "n":
        value = Number(v);
        break;
      case "d": {
        const serial = serialOfIso(v);
        if (serial === null) return null;
        value = serial;
        break;
      }
      case "b":
        value = v === "1" || v === "true";
        break;
      case "m":
        value = null;
        break;
      case "e":
        value = { error: (v ?? "#N/A") as never };
        break;
      default:
        return null;
    }
    out.push({ label: itemLabel(value, fmt), value });
  }
  return out;
}

const SUBTOTAL_BACK: Record<string, PivotFunction> = { sum: "sum", count: "count", countNums: "countNums", average: "average", max: "max", min: "min", product: "product", stdDev: "stdDev", stdDevp: "stdDevp", var: "var", varp: "varp" };
const SHOW_AS_BACK: Record<string, PivotShowAs> = { percentOfTotal: "percentOfTotal", percentOfRow: "percentOfRow", percentOfCol: "percentOfColumn", difference: "differenceFromPrevious", percentDiff: "percentDifferenceFromPrevious", runTotal: "runningTotal", index: "index", percent: "percentOf" };
const SHOW_AS_X14_BACK: Record<string, PivotShowAs> = { percentOfParentRow: "percentOfParentRow", percentOfParentCol: "percentOfParentColumn", percentOfRunningTotal: "percentRunningTotal", rankAscending: "rankAscending", rankDescending: "rankDescending" };
const TOP_BACK: Record<string, "items" | "percent" | "sum"> = { count: "items", percent: "percent", sum: "sum" };
const TEST_BACK: Record<string, FilterTestOp> = { Equal: "equals", NotEqual: "notEquals", GreaterThan: "greaterThan", GreaterThanOrEqual: "greaterThanOrEqual", LessThan: "lessThan", LessThanOrEqual: "lessThanOrEqual", Contains: "contains", NotContains: "notContains", BeginsWith: "beginsWith", NotBeginsWith: "notBeginsWith", EndsWith: "endsWith", NotEndsWith: "notEndsWith" };
const DATE_BACK: Record<string, FilterTestOp> = { Equal: "equals", NotEqual: "notEquals", NewerThan: "greaterThan", NewerThanOrEqual: "greaterThanOrEqual", OlderThan: "lessThan", OlderThanOrEqual: "lessThanOrEqual" };
const PERIOD_BACK = new Set<string>(FILTER_DATE_PERIODS.map((p) => periodType(p)));

/** What a custom filter's value means as a test: the wildcards that stood for "contains" and the like are taken off. */
function testOfValue(op: FilterTestOp, val: string, numeric: boolean): FilterTest {
  let text = val;
  if (op === "contains" || op === "notContains") text = text.replace(/^\*/, "").replace(/\*$/, "");
  else if (op === "beginsWith" || op === "notBeginsWith") text = text.replace(/\*$/, "");
  else if (op === "endsWith" || op === "notEndsWith") text = text.replace(/^\*/, "");
  const iso = serialOfIso(text);
  const num = text.trim() !== "" && !Number.isNaN(Number(text)) ? Number(text) : iso !== null && /^\d{4}-/.test(text) ? iso : null;
  return { op, value: numeric && num !== null ? num : text };
}

/** The filter on labels or values a `filter` element holds, or null when it isn't one Pli reads. */
function readTestFilter(flt: XmlElement, kind: "caption" | "value" | "date", suffix: string): { a: FilterTest; b?: FilterTest; or?: true } | null {
  const custom = child(child(child(flt, "autoFilter"), "filterColumn"), "customFilters");
  const list = childrenNamed(custom, "customFilter");
  const numeric = kind !== "caption";
  const names = kind === "date" ? DATE_BACK : TEST_BACK;
  if (suffix === "Between" || suffix === "NotBetween") {
    if (list.length !== 2) return null;
    const lo = attr(list[0], "val") ?? "";
    const hi = attr(list[1], "val") ?? "";
    return suffix === "Between"
      ? { a: testOfValue("greaterThanOrEqual", lo, numeric), b: testOfValue("lessThanOrEqual", hi, numeric) }
      : { a: testOfValue("lessThan", lo, numeric), b: testOfValue("greaterThan", hi, numeric), or: true };
  }
  const op = names[suffix];
  if (!op || list.length !== 1) return null;
  if (kind === "value" && /Contains|BeginsWith|EndsWith/.test(suffix)) return null;
  return { a: testOfValue(op, attr(list[0], "val") ?? "", numeric) };
}

/** Whether an element's extension list holds a setting Pli doesn't read. */
const extension = (el: XmlElement | undefined, name: string): XmlElement | undefined => {
  for (const ext of childrenNamed(child(el, "extLst"), "ext")) {
    const found = child(ext, name);
    if (found) return found;
  }
  return undefined;
};
/** Whether a field says to write its outer labels on every row (kept in the field's extensions). */
const fillsDown = (el: XmlElement | undefined): boolean => /fillDownLabels":"(1|true)"/.test(JSON.stringify(child(el, "extLst") ?? ""));

const on = (v: string | undefined, dflt: boolean) => (v === undefined ? dflt : v === "1" || v === "true");

/**
 * A pivot table from its parts, or the reason it can't be kept as one (its cells are then plain cells). `wb` holds the
 * sheets and tables as read so far.
 */
/** The rows a cache holds for a range of another workbook, as a data block: the field names, then a row for each record. */
function outsideBlock(source: string, path: string, cache: XmlElement, records: XmlElement, formats: Record<number, string>): DataBlock | string {
  const fields = childrenNamed(child(cache, "cacheFields"), "cacheField");
  const real = fields.map((f, i) => ({ f, i })).filter(({ f }) => attr(f, "databaseField") !== "0" && attr(f, "databaseField") !== "false" && attr(f, "formula") === undefined);
  const shared = real.map(({ f }) => sharedLabels(f, undefined));
  if (shared.some((x) => x === null)) return "the rows it read from another workbook have values Pli doesn't read";
  const rows: (string | number | boolean | null)[][] = [real.map(({ f }) => attr(f, "name") ?? "")];
  for (const r of childrenNamed(records, "r")) {
    const cells = elements(r);
    if (cells.length !== real.length) return "the rows it read from another workbook don't match its fields";
    const row: (string | number | boolean | null)[] = [];
    for (const [k, el] of cells.entries()) {
      const v = attr(el, "v");
      switch (el.name) {
        case "x": {
          const item = shared[k]![Number(v)];
          if (!item) return "the rows it read from another workbook point at an item that isn't there";
          row.push(typeof item.value === "object" && item.value !== null ? null : item.value);
          break;
        }
        case "n":
          row.push(Number(v));
          break;
        case "s":
          row.push(v ?? "");
          break;
        case "b":
          row.push(v === "1" || v === "true");
          break;
        case "d": {
          const serial = serialOfIso(v);
          if (serial === null) return "the rows it read from another workbook have a date Pli doesn't read";
          row.push(serial);
          break;
        }
        default:
          row.push(null);
      }
    }
    rows.push(row);
  }
  const fmts = real.map(({ f }) => formats[Number(attr(f, "numFmtId") ?? 0)] ?? "").map((x) => (/^general$/i.test(x) ? "" : x));
  return { source, rows, ...(fmts.some((x) => x) ? { formats: fmts } : {}), from: "book", path };
}

/** What reading a pivot table needs besides its own parts, and gives back besides the pivot table. */
export interface PivotReadExtra {
  /** The stylesheet's table of looks (for formats kept on cells). */
  dxfs?: readonly ConditionalStyle[];
  /** The cache's records, and the address the cache's relationships give for a source in another workbook. */
  records?: XmlElement;
  externalPath?: string;
  /** Set when the pivot table reads a range of another workbook: the rows its cache holds. */
  block?: DataBlock;
}

/** The file name at the end of a path or address. */
const fileName = (path: string): string => {
  const last = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

export function readPivotTable(def: XmlElement, cache: XmlElement | undefined, sheet: Sheet, wb: Workbook, formats: Record<number, string>, extra: PivotReadExtra = {}): Pivot | string {
  if (!cache) return "its source part is missing";
  const sourceEl = child(cache, "cacheSource");
  const sourceType = attr(sourceEl, "type");
  let source: string;
  let ranges: PivotRange[] | undefined;
  let pageFields: number | undefined;
  let at: { sheet: Sheet; bounds: Bounds } | null = null;
  if (sourceType === "consolidation") {
    const cons = child(sourceEl, "consolidation");
    const sets = childrenNamed(child(cons, "rangeSets"), "rangeSet");
    const pageEls = childrenNamed(child(cons, "pages"), "page");
    if (!sets.length) return "it has no ranges to sum up";
    if (pageEls.length > 4) return "it has more than four page fields";
    pageFields = pageEls.length;
    ranges = [];
    for (const [i, rs] of sets.entries()) {
      const ref = parseRange(attr(rs, "ref") ?? "");
      const home = wb.sheets.find((s) => s.name.toLowerCase() === (attr(rs, "sheet") ?? "").toLowerCase());
      if (!ref || !home) return "one of its ranges isn't in this workbook";
      // What each page field calls this range: the page item the range points at.
      const names = pageEls.map((page, k) => {
        const items = childrenNamed(page, "pageItem");
        return attr(items[Number(attr(rs, `i${k + 1}`) ?? i)], "name") ?? `Item${i + 1}`;
      });
      const own = names.length > 1 && names.some((n, k) => k > 0 && n !== `Item${i + 1}`);
      const first = names[0];
      ranges.push({ source: chartRefText(home.name, ref), ...(first && first !== `Item${i + 1}` ? { name: first } : {}), ...(own ? { names } : {}) });
    }
    source = ranges[0]!.source;
  } else if (sourceType === "worksheet" && attr(child(sourceEl, "worksheetSource"), "id", "r") !== undefined) {
    // A range of another workbook: the file names it through a relationship, and the cache holds the rows that were read.
    const ws = child(sourceEl, "worksheetSource");
    const where = extra.externalPath;
    const ref = parseRange(attr(ws, "ref") ?? "");
    if (!where || !ref || !attr(ws, "sheet")) return "it reads another workbook in a way Pli doesn't read";
    if (!extra.records) return "it reads another workbook and the file holds no copy of its rows";
    source = externalSourceText({ book: fileName(where), sheet: attr(ws, "sheet")!, range: rangeAddress(ref) });
    const block = outsideBlock(source, where, cache, extra.records, formats);
    if (typeof block === "string") return block;
    extra.block = block;
  } else if (sourceType === "worksheet") {
    const ws = child(sourceEl, "worksheetSource");
    if (!ws) return "it has no source range";
    const nm = attr(ws, "name");
    if (nm) source = nm;
    else {
      const ref = parseRange(attr(ws, "ref") ?? "");
      const home = wb.sheets.find((s) => s.name.toLowerCase() === (attr(ws, "sheet") ?? "").toLowerCase());
      if (!ref || !home) return "its source range isn't in this workbook";
      source = chartRefText(home.name, ref);
    }
    at = pivotSourceRange(wb, source, sheet.name);
    if (!at) return "its source isn't a range with field names in its first row";
  } else if (sourceType === "external") return excelModelReason(cache);
  else return "it sums up data that isn't in a sheet of this workbook";
  const outside = extra.block !== undefined;

  const cacheFields = childrenNamed(child(cache, "cacheFields"), "cacheField");
  const names = cacheFields.map((f) => attr(f, "name") ?? "");
  const databaseField = (i: number) => attr(cacheFields[i], "databaseField") !== "0" && attr(cacheFields[i], "databaseField") !== "false";
  const isCalc = (x: number) => attr(cacheFields[x], "formula") !== undefined;
  const nSrc = cacheFields.filter((_, i) => databaseField(i)).length;
  if (cacheFields.slice(0, nSrc).some((_, i) => !databaseField(i))) return "its fields that aren't in its source come before the ones that are";
  if (cacheFields.some((f, i) => i >= nSrc && !isCalc(i) && !child(f, "fieldGroup"))) return "it has fields that aren't in its source";
  // Fields worked out from others stand after the source's own.
  const calculated: PivotCalculatedField[] = cacheFields.flatMap((f) => (attr(f, "formula") !== undefined ? [{ name: attr(f, "name") ?? "", formula: attr(f, "formula")! }] : []));
  if (child(cache, "calculatedMembers")) return "it has calculated members";
  if (sourceType === "consolidation" && names.slice(0, 3 + (pageFields ?? 1)).join("|") !== consolidationFields(pageFields).join("|")) return "its fields aren't the ones a consolidation has";

  const pfs = childrenNamed(child(def, "pivotFields"), "pivotField");
  const fieldAt = (x: string | undefined): number => (x === undefined ? -1 : Number(x));
  const labels = (i: number): { label: string; value: Value }[] | null => {
    const first = at ? at.sheet.cells[cellAddress(at.bounds.r1 + 1, at.bounds.c1 + i)] : undefined;
    return sharedLabels(cacheFields[i], first?.fmt ?? (sourceType === "consolidation" && i < 3 ? undefined : undefined));
  };
  if (pfs.length !== names.length) return "its fields don't match its source";

  // Groups: each grouped cache field says which field it groups and what the groups are.
  const grouped = new Map<number, { group: PivotGroup; labels: string[]; base: number; par?: number; mapping?: (string | undefined)[] }>();
  for (const [i, f] of cacheFields.entries()) {
    const fg = child(f, "fieldGroup");
    if (!fg) continue;
    // A field that something is grouped over says only which field holds the group (`<fieldGroup par="6"/>`): Excel writes that on the grouped field itself.
    if (attr(fg, "base") === undefined && !child(fg, "rangePr") && !child(fg, "discretePr") && attr(fg, "par") !== undefined) continue;
    const base = Number(attr(fg, "base") ?? i);
    const baseLabels = labels(base)?.map((l) => l.label) ?? null;
    const read = readFieldGroup(fg, baseLabels);
    if (typeof read === "string") return read;
    let group = read.group;
    if (!databaseField(base) || isCalc(base)) return "a group is made over a field that isn't in the source";
    grouped.set(i, { group, labels: read.labels, base, ...(read.par !== undefined ? { par: read.par } : {}), ...(read.mapping ? { mapping: read.mapping } : {}) });
  }
  // A group that groups another again (`par`) is a group inside a group: its items are the other's groups.
  const innerOf = new Map<number, number>();
  for (const [i, g] of grouped) {
    const outer = g.par === undefined ? undefined : grouped.get(g.par);
    if (outer && outer.group.by === "items" && g.group.by === "items" && outer.base === g.base && outer.mapping && g.mapping) innerOf.set(g.par!, i);
  }
  const nested = (j: number): { group: PivotItemsGroup; depth: number } => {
    const own = grouped.get(j)!;
    const inner = innerOf.get(j);
    const name = (depth: number) => (names[own.base] !== undefined && names[j] === `${names[own.base]}${depth + 2}` ? undefined : names[j]);
    if (inner === undefined) {
      const { name: _n, ...rest } = own.group as PivotItemsGroup;
      const n = name(0);
      return { group: { ...rest, ...(n !== undefined ? { name: n } : {}) }, depth: 0 };
    }
    const below = nested(inner);
    const under = grouped.get(inner)!;
    const groups: PivotItemsGroup["groups"] = [];
    for (const label of new Set(own.mapping!.filter((x): x is string => x !== undefined))) {
      const seen: string[] = [];
      own.mapping!.forEach((m, bi) => {
        const lower = under.mapping![bi];
        if (m === label && lower !== undefined && !seen.includes(lower)) seen.push(lower);
      });
      // A name that stands alone under its own name isn't a group.
      if (!(seen.length === 1 && seen[0] === label)) groups.push({ name: label, items: seen });
    }
    const depth = below.depth + 1;
    const n = name(depth);
    return { group: { by: "items", groups: groups.length ? groups : [{ name: "Group", items: [] }], ...(n !== undefined ? { name: n } : {}), of: below.group }, depth };
  };
  for (const [j, g] of grouped) {
    if (g.group.by !== "items") continue;
    if (innerOf.has(j)) {
      const built = nested(j);
      if (built.group.groups.some((x) => x.items.length === 0)) return "a group of groups groups nothing";
      grouped.set(j, { ...g, group: built.group });
    } else {
      grouped.set(j, { ...g, group: nested(j).group });
    }
  }
  // The label of an item of a field, by the number the table's field lists it under.
  const itemsOf = (x: number): XmlElement[] => childrenNamed(child(pfs[x], "items"), "item");
  const labelOf = (x: number, item: XmlElement): string => {
    const g = grouped.get(x);
    const idx = Number(attr(item, "x"));
    return g ? (g.labels[idx] ?? "") : (labels(x)?.[idx]?.label ?? "");
  };
  // Excel marks a calculated item with `m="1"` when it saves one (an `f` it does not accept).
  const calcFlag = (item: XmlElement) => on(attr(item, "f"), false) || on(attr(item, "m"), false);

  const entryOf = new Map<number, PivotAxisField>();
  const axisField = (x: number): PivotAxisField | string => {
    const pf = pfs[x];
    const g = grouped.get(x);
    const shared = labels(x);
    if (!pf || !shared || isCalc(x)) return "an item of a field isn't one it can read";
    const f: PivotAxisField = { field: names[g ? g.base : x]! };
    if (g) f.group = g.group;
    if (on(attr(pf, "insertBlankRow"), false)) f.blankRow = true;
    const scope = child(pf, "autoSortScope");
    if (scope) {
      // Sorted by a value: the reference to the data field says which.
      const ref = childrenNamed(child(child(scope, "pivotArea"), "references"), "reference");
      const byData = ref.length === 1 && attr(ref[0], "field") === "4294967294" ? Number(attr(child(ref[0], "x"), "v")) : NaN;
      if (!Number.isInteger(byData)) return "it is sorted by a value in a way Pli doesn't read";
      f.sortBy = { value: byData, ...(attr(pf, "sortType") === "descending" ? { descending: true as const } : {}) };
    } else if (attr(pf, "sortType") === "descending") f.descending = true;
    else if (attr(pf, "sortType") !== "ascending" && !g) {
      // Manual (the default): the items are in the order the file lists them; that is an order of its own when it isn't the usual one.
      const listed = itemsOf(x).filter((it) => attr(it, "t") === undefined && !calcFlag(it)).map((it) => shared[Number(attr(it, "x"))]?.label ?? "");
      const usual = [...listed].sort((a, b) => {
        const va = shared.find((s) => s.label === a)?.value ?? null;
        const vb = shared.find((s) => s.label === b)?.value ?? null;
        return typeof va === "number" && typeof vb === "number" ? va - vb : a.localeCompare(b);
      });
      if (listed.some((l, i) => l !== usual[i])) f.order = listed;
    }
    if (attr(pf, "defaultSubtotal") === "0" || attr(pf, "defaultSubtotal") === "false") f.subtotal = false;
    const hidden: string[] = [];
    for (const item of itemsOf(x)) {
      if (attr(item, "t") !== undefined || !on(attr(item, "h"), false)) continue;
      const label = labelOf(x, item);
      if (label !== "") hidden.push(label);
    }
    if (hidden.length) f.hidden = hidden;
    entryOf.set(x, f);
    return f;
  };
  const rows: PivotAxisField[] = [];
  let valuesOnRows = false;
  const rowList = childrenNamed(child(def, "rowFields"), "field").map((f) => fieldAt(attr(f, "x")));
  for (let i = 0; i < rowList.length; i++) {
    const x = rowList[i]!;
    if (x === -2) {
      if (i !== rowList.length - 1) return "its values are not the last of its row fields";
      valuesOnRows = true;
      continue;
    }
    const field = axisField(x);
    if (typeof field === "string") return field;
    rows.push(field);
  }
  const columns: PivotAxisField[] = [];
  const colList = childrenNamed(child(def, "colFields"), "field").map((f) => fieldAt(attr(f, "x")));
  for (let i = 0; i < colList.length; i++) {
    const x = colList[i]!;
    if (x === -2) {
      if (i !== colList.length - 1) return "its values are not the last of its column fields";
      continue;
    }
    const field = axisField(x);
    if (typeof field === "string") return field;
    columns.push(field);
  }
  const filters: PivotFilter[] = [];
  const paged = new Set<number>();
  for (const pg of childrenNamed(child(def, "pageFields"), "pageField")) {
    const x = fieldAt(attr(pg, "fld"));
    const pf = pfs[x];
    const shared = labels(x);
    if (!pf || !shared || grouped.has(x) || isCalc(x)) return "a filter field isn't one it can read";
    const listed = itemsOf(x).filter((it) => attr(it, "t") === undefined);
    const chosen = attr(pg, "item") !== undefined ? [shared[Number(attr(listed[Number(attr(pg, "item"))], "x"))]?.label ?? ""] : listed.filter((it) => !on(attr(it, "h"), false)).map((it) => shared[Number(attr(it, "x"))]?.label ?? "");
    filters.push({ field: names[x]!, items: chosen });
    paged.add(x);
  }
  // Items left out of a field the table doesn't use (a slicer does that) are a filter that isn't shown.
  const used = new Set([...rowList, ...colList, ...paged]);
  for (const [x, pf] of pfs.entries()) {
    if (used.has(x) || x >= nSrc || grouped.has(x)) continue;
    const listed = itemsOf(x).filter((it) => attr(it, "t") === undefined);
    if (!listed.some((it) => on(attr(it, "h"), false))) continue;
    const shared = labels(x);
    if (!shared) return "a filter field isn't one it can read";
    filters.push({ field: names[x]!, items: listed.filter((it) => !on(attr(it, "h"), false)).map((it) => shared[Number(attr(it, "x"))]?.label ?? ""), hidden: true });
    void pf;
  }
  // Items worked out from others of their field.
  const calculatedItems: PivotCalculatedItem[] = [];
  const calcRefs = childrenNamed(child(cache, "calculatedItems"), "calculatedItem");
  for (const ci of calcRefs) {
    const ref = child(child(child(ci, "pivotArea"), "references"), "reference");
    const x = fieldAt(attr(ref, "field"));
    const at0 = Number(attr(child(ref, "x"), "v"));
    const label = labels(x)?.[at0]?.label;
    if (!names[x] || label === undefined || attr(ci, "formula") === undefined) return "a calculated item isn't one it can read";
    // Excel writes the items a formula names as `Region[East]`; Pli's formula names the item alone (in quotes when it has odd characters).
    const formula = attr(ci, "formula")!.replace(/(?:'[^']+'|[A-Za-z_][\w.]*)\[([^\]]+)\]/g, (_m, item: string) => (/^[A-Za-z_][\w.]*$/.test(item) ? item : `'${item.replace(/'/g, "''")}'`));
    calculatedItems.push({ field: names[x]!, name: label, formula });
  }
  const values: PivotValue[] = [];
  const valueFilters = childrenNamed(child(def, "filters"), "filter");
  /** The text of the item a value is compared with: `baseItem` counts the items the field lists. */
  const shared = (field: number, at1: number): string => {
    const listed = itemsOf(field).filter((it) => attr(it, "t") === undefined);
    return listed[at1] ? labelOf(field, listed[at1]!) : "";
  };
  const innermost = colList.filter((c) => c !== -2).at(-1) ?? rowList.filter((c) => c !== -2).at(-1);
  for (const d of childrenNamed(child(def, "dataFields"), "dataField")) {
    const x = fieldAt(attr(d, "fld"));
    if (!names[x] || grouped.has(x)) return "a value isn't a field it can read";
    // A calculated field is always summed.
    const fn = SUBTOTAL_BACK[attr(d, "subtotal") ?? "sum"];
    if (!fn) return `a value is summed up by "${attr(d, "subtotal")}", which Pli doesn't do yet`;
    const x14 = attr(extension(d, "dataField"), "pivotShowAs");
    const show = x14 ?? attr(d, "showDataAs") ?? "normal";
    if (x14 && !SHOW_AS_X14_BACK[x14]) return `a value is shown as "${x14}", which Pli doesn't do yet`;
    if (!x14 && show !== "normal" && !SHOW_AS_BACK[show]) return `a value is shown as "${show}", which Pli doesn't do yet`;
    let base: PivotValue["base"];
    let shownAs: PivotShowAs | undefined = x14 ? SHOW_AS_X14_BACK[x14] : show === "normal" ? undefined : SHOW_AS_BACK[show];
    const baseAt = fieldAt(attr(d, "baseField"));
    const axisCf = (cf: number) => colList.includes(cf) || rowList.includes(cf);
    if (x14 === "rankAscending" || x14 === "rankDescending" || x14 === "percentOfRunningTotal") {
      if (baseAt !== innermost && axisCf(baseAt) && entryOf.get(baseAt)) base = { field: entryOf.get(baseAt)!.field };
      else if (!axisCf(baseAt) && innermost !== undefined && baseAt !== 0) return `a value is shown as "${x14}" along a field that isn't on the rows or columns`;
    } else if (!x14 && (show === "difference" || show === "percentDiff" || show === "runTotal" || show === "percent")) {
      // Against the previous item of the innermost field (Pli's own default), or a field and item the value names.
      const itemAt = Number(attr(d, "baseItem") ?? 0);
      const step = itemAt === 1048828 ? "previous" : itemAt === 1048829 ? "next" : undefined;
      if (!names[baseAt] || !axisCf(baseAt)) return `a value is shown as "${show}" along a field that isn't on the rows or columns`;
      const along = entryOf.get(baseAt)!.field;
      if (show === "runTotal") {
        if (baseAt !== innermost) base = { field: along };
      } else if (show === "percent") {
        shownAs = "percentOf";
        base = { field: along, item: step ? { step } : shared(baseAt, itemAt) };
      } else if (step === "previous" && baseAt === innermost) {
        // Pli's "previous item" along the innermost field.
      } else {
        shownAs = show === "difference" ? "differenceFrom" : "percentDifferenceFrom";
        base = { field: along, item: step ? { step } : shared(baseAt, itemAt) };
      }
      if (base && typeof base.item === "string" && base.item === "") return `a value is compared with an item that isn't there`;
    }
    const v: PivotValue = { field: names[x]!, fn: isCalc(x) ? undefined : fn };
    if (v.fn === undefined) delete v.fn;
    const name = attr(d, "name");
    if (name && name !== valueName({ field: v.field }, fn)) v.name = name;
    if (shownAs) v.showAs = shownAs;
    if (base) v.base = base;
    const fmt = formats[Number(attr(d, "numFmtId") ?? 0)];
    if (fmt && !/^general$/i.test(fmt) && !(v.showAs && fmt === "0.00%")) v.fmt = fmt;
    values.push(v);
  }
  /** A field's first filter is `filter`; the others (Excel's "multiple filters per field") are `filters`, in the order Excel evaluates them. */
  const addFilter = (field: PivotAxisField, f: PivotFieldFilter) => {
    if (!field.filter) field.filter = f;
    else (field.filters ??= []).push(f);
  };
  const evalOrderOf = (flt: XmlElement) => Number(attr(flt, "evalOrder") ?? -1);
  for (const flt of [...valueFilters].sort((a, b) => (evalOrderOf(a) >= 0 && evalOrderOf(b) >= 0 ? evalOrderOf(a) - evalOrderOf(b) : 0))) {
    const type = attr(flt, "type") ?? "";
    const fld = fieldAt(attr(flt, "fld"));
    const field = entryOf.get(fld);
    const by = Number(attr(flt, "iMeasureFld") ?? 0);
    if (!field) return "it filters items in a way Pli doesn't read";
    const top = child(child(child(flt, "autoFilter"), "filterColumn"), "top10");
    const m = /^(caption|value|date)(.+)$/.exec(type);
    if (TOP_BACK[type]) {
      const n = Number(attr(top, "val"));
      if (!top || !(n > 0) || by >= values.length) return "it filters items in a way Pli doesn't read";
      addFilter(field, { kind: "top", by, n, ...(on(attr(top, "top"), true) ? {} : { bottom: true as const }), ...(TOP_BACK[type] !== "items" ? { unit: TOP_BACK[type]! } : {}) });
    } else if (PERIOD_BACK.has(type) && !m) {
      const period = FILTER_DATE_PERIODS.find((p) => periodType(p) === type)!;
      addFilter(field, { kind: "date", period });
    } else if (m) {
      const test = readTestFilter(flt, m[1] as "caption" | "value" | "date", m[2]!);
      if (!test || (m[1] === "value" && by >= values.length)) return "it filters items in a way Pli doesn't read";
      addFilter(field, m[1] === "value" ? { kind: "value", by, ...test } : { kind: "label", ...test });
    } else return "it filters items in a way Pli doesn't read";
  }
  let kept: PivotFormat[] = [];
  if (child(def, "formats")) {
    const read = readFormats(
      def,
      (fld) => {
        const entry = entryOf.get(fld);
        return entry ? { heading: axisHeading(entry), labelOf: (idx) => (grouped.get(fld) ? grouped.get(fld)!.labels[idx] : labels(fld)?.[idx]?.label) } : undefined;
      },
      extra.dxfs ?? [],
      values.length,
    );
    if (typeof read === "string") return read;
    kept = read;
  }
  const loc = child(def, "location");
  const ref = parseRange(attr(loc, "ref") ?? "");
  if (!ref) return "it has no place on the sheet";
  const pages = filters.filter((f) => !f.hidden).length;
  const top = ref.r1 - (pages ? pages + 1 : 0);
  if (top < 1) return "its filters would run off the top of the sheet";
  const pivot: Pivot = {
    id: createId("pivot_"),
    name: attr(def, "name") ?? "PivotTable",
    source,
    anchor: cellAddress(top, ref.c1),
    rows,
    columns,
    values,
    range: rangeAddress({ r1: top, c1: ref.c1, r2: ref.r2, c2: Math.max(ref.c2, pages ? ref.c1 + 1 : ref.c2) }),
  };
  if (ranges) pivot.ranges = ranges;
  if (pageFields !== undefined && pageFields !== 1) pivot.pageFields = pageFields;
  if (kept.length) pivot.formats = kept;
  if (filters.length) pivot.filters = filters;
  if (calculated.length) pivot.calculated = calculated;
  if (calculatedItems.length) pivot.calculatedItems = calculatedItems;
  if (valuesOnRows && values.length > 1) pivot.valuesOnRows = true;
  if (rowList.length && rowList.some((x) => x !== -2 && fillsDown(pfs[x]))) pivot.repeatLabels = true;
  if (attr(def, "compact") === "0" || attr(def, "compact") === "false") {
    if (on(attr(def, "outline"), false)) pivot.outline = true;
    else pivot.tabular = true;
  }
  if (!on(attr(def, "rowGrandTotals"), true)) pivot.grandTotalRows = false;
  if (!on(attr(def, "colGrandTotals"), true)) pivot.grandTotalColumns = false;
  const st = child(def, "pivotTableStyleInfo");
  if (st) {
    const name = attr(st, "name") ?? "none";
    const plain = on(attr(st, "showRowHeaders"), true) && on(attr(st, "showColHeaders"), true) && !on(attr(st, "showRowStripes"), false) && !on(attr(st, "showColStripes"), false);
    if ((isPivotStyleName(name) || Object.keys(wb.pivotStyles ?? {}).some((n) => n.toLowerCase() === name.toLowerCase())) && !(name === "PivotStyleLight16" && plain)) {
      pivot.style = { name, ...(on(attr(st, "showRowHeaders"), true) ? {} : { rowHeaders: false as const }), ...(on(attr(st, "showColHeaders"), true) ? {} : { colHeaders: false as const }), ...(on(attr(st, "showRowStripes"), false) ? { rowStripes: true as const } : {}), ...(on(attr(st, "showColStripes"), false) ? { colStripes: true as const } : {}) };
    }
  }
  try {
    const clean = cleanPivot(pivot);
    // What an item number in the table's definition stands for, for the rules that name items (an ungrouped field's own items).
    itemLookup.set(clean, (x, pos) => {
      const item = itemsOf(x)[pos];
      return !item || attr(item, "t") !== undefined || grouped.has(x) || isCalc(x) || calcFlag(item) ? undefined : labels(x)?.[Number(attr(item, "x"))]?.label;
    });
    return clean;
  } catch (e) {
    return (e as Error).message;
  }
}

/** For a pivot table read from a file: the label of the item at a position in a field's list of items. */
const itemLookup = new WeakMap<Pivot, (field: number, position: number) => string | undefined>();

/**
 * The conditional formats of a pivot table definition that follow its cells (those for "all cells showing" a value, perhaps
 * for some fields, and those for selected cells that name a value or items of the fields), as the pivot scope of each, by the
 * priority of the rule they belong to in the sheet. Formats for other selections (headings, or items Pli can't name) are not
 * here: those are ordinary rules.
 */
export function readPivotRuleScopes(def: XmlElement, names: readonly string[], pivot: Pivot): Map<number, RulePivot> {
  const out = new Map<number, RulePivot>();
  for (const cf of childrenNamed(child(def, "conditionalFormats"), "conditionalFormat")) {
    // Without a scope the format is for the selected cells: it follows the table when it names a value and items.
    const scope = attr(cf, "scope") ?? "selection";
    if (scope !== "data" && scope !== "field" && scope !== "selection") continue;
    const priority = Number(attr(cf, "priority"));
    const areas = childrenNamed(child(cf, "pivotAreas"), "pivotArea");
    const area = areas[0];
    if (!Number.isInteger(priority) || !area) continue;
    // More areas than one are the cells at the inner levels under the same items: every reference of the first, and every item of other fields.
    const refKey = (r: XmlElement) => `${attr(r, "field")}:${childrenNamed(r, "x").map((x) => attr(x, "v")).join(",")}`;
    const first = new Set(childrenNamed(child(area, "references"), "reference").map(refKey));
    if (areas.slice(1).some((a) => !(first.size <= childrenNamed(child(a, "references"), "reference").length && [...first].every((k) => childrenNamed(child(a, "references"), "reference").some((r) => refKey(r) === k)) && childrenNamed(child(a, "references"), "reference").every((r) => first.has(refKey(r)) || childrenNamed(r, "x").length === 0)))) continue;
    // Headings, labels and axes are not value cells.
    if (scope === "selection" && (attr(area, "type") !== "data" || on(attr(area, "labelOnly"), false) || !on(attr(area, "dataOnly"), true) || attr(area, "axis") !== undefined || attr(area, "field") !== undefined)) continue;
    const found: RulePivot = { id: pivot.id };
    let readable = true;
    for (const ref of childrenNamed(child(area, "references"), "reference")) {
      const field = Number(attr(ref, "field"));
      if (field === 4294967294) {
        const v = Number(attr(child(ref, "x"), "v"));
        if (Number.isInteger(v) && v >= 0 && v < pivot.values.length) found.value = v;
        continue;
      }
      const name = names[field];
      if (name === undefined) continue;
      const onRows = pivot.rows.some((f) => f.field === name);
      if (!onRows && !pivot.columns.some((f) => f.field === name)) continue;
      const xs = childrenNamed(ref, "x");
      if (scope === "selection" && !xs.length) {
        if (onRows) found.rows = name;
        else found.columns = name;
      } else if (xs.length) {
        const lookup = itemLookup.get(pivot);
        const picked = xs.map((x) => lookup?.(field, Number(attr(x, "v"))));
        if (picked.some((l) => l === undefined)) readable = false;
        else (found.items ??= {})[name] = picked as string[];
      } else if (onRows) found.rows = name;
      else found.columns = name;
    }
    // A selection that names neither items nor a value is an ordinary rule on the cells it covered.
    if (scope === "selection" && (!readable || (!found.items && found.value === undefined))) continue;
    if (!readable) continue;
    out.set(priority, found);
  }
  return out;
}
