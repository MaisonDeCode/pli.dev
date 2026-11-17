import { PliError } from "@pli.dev/core";
import { cellAddress, parseCell, parseRange, rangeAddress, type Bounds } from "./address";
import { chartRef, MAX_CHART_SIZE, MIN_CHART_SIZE } from "./chart";
import { formatValue } from "./format";
import { cleanFilterRule, criterionTest, FILTER_DATE_PERIODS, inFilterPeriod } from "./filter";
import { MAX_COLS, MAX_ROWS, type CellStyle, type DataBlock, type ErrorCode, type FilterTest, type CellBorders, type Pivot, type PivotAxisField, type PivotBase, type PivotCalculatedField, type PivotCalculatedItem, type PivotFieldFilter, type PivotFilter, type PivotFormat, type PivotFunction, type PivotGroup, type PivotGroupBy, type PivotItemsGroup, type PivotRange, type PivotShowAs, type PivotSlicer, type PivotStyleDef, type PivotValue, type Scalar, type Sheet, type Workbook } from "./model";
import { findBlock, isExternalSource, isModelSource } from "./pivot-external";
import { buildModelSource, involvedTables, type CompiledMeasure } from "./pivot-model";
import type { ContextPred, ModelData } from "./pivot-dax";
import { findTable, hasHeader } from "./table";
import { isPivotStyleName, pivotCellStyle, type PivotLook, type PivotStyleRole } from "./pivot-style";
import { blankLook, customLook } from "./pivot-style-custom";
import { applyFormats, cleanFormats, geometryOf } from "./pivot-keep";
import { isError, serialDate, serialTime, type Value } from "./values";

/*
 * Pivot tables: the records of a range summed up by the items of some of its fields. `readPivotSource` takes the records
 * from the workbook, `renderPivot` works out the cells (a plain grid, with no idea of sheets), and the session writes them.
 */

export const PIVOT_FUNCTIONS: readonly PivotFunction[] = ["sum", "count", "countNums", "average", "max", "min", "product", "stdDev", "stdDevp", "var", "varp", "distinctCount"];
export const PIVOT_SHOW_AS: readonly PivotShowAs[] = [
  "percentOfTotal",
  "percentOfRow",
  "percentOfColumn",
  "percentOfParentRow",
  "percentOfParentColumn",
  "differenceFromPrevious",
  "percentDifferenceFromPrevious",
  "runningTotal",
  "rankAscending",
  "rankDescending",
  "index",
  "differenceFrom",
  "percentDifferenceFrom",
  "percentOf",
  "percentRunningTotal",
];
/** The "show as" choices that compare with one chosen item. */
export const PIVOT_NEEDS_ITEM: readonly PivotShowAs[] = ["differenceFrom", "percentDifferenceFrom", "percentOf"];
/** The ones that work along a field (all of those that compare items). */
export const PIVOT_ALONG: readonly PivotShowAs[] = ["differenceFromPrevious", "percentDifferenceFromPrevious", "runningTotal", "rankAscending", "rankDescending", "percentRunningTotal", ...PIVOT_NEEDS_ITEM];
export const PIVOT_GROUP_BY: readonly PivotGroupBy[] = ["years", "quarters", "months", "days", "hours", "minutes", "seconds"];

/** The words in front of a field's name in a heading: `Sum of Sales`. */
export const PIVOT_FUNCTION_NAMES: Record<PivotFunction, string> = {
  sum: "Sum",
  count: "Count",
  countNums: "Count",
  average: "Average",
  max: "Max",
  min: "Min",
  product: "Product",
  stdDev: "StdDev",
  stdDevp: "StdDevp",
  var: "Var",
  varp: "Varp",
  distinctCount: "Distinct Count",
};

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

// ---- the records ----

/** The records of a pivot table's source. */
export interface PivotSource {
  /** The names of the fields: the text of the header cells, made unique. */
  fields: string[];
  /** What each record holds, field by field. */
  records: Value[][];
  /** The number format of each field's first cell, which its items are shown in. */
  formats: (string | undefined)[];
  /** The sheet row each record came from (records skip empty rows), and the sheet column of each field. */
  rowAt?: number[];
  colAt?: number[];
  /** The id of the sheet the records are on. */
  sheet?: string;
  /** Today as a date serial, for filters by date period (the clock's own day when left out). */
  today?: number;
  /** The fill and font colour of each record's cells, field by field (for filters by colour). */
  looks?: ({ fill?: string | undefined; font?: string | undefined } | undefined)[][];
  /** For the data model: the measures (by lower-case name), what the fields hold, and the problems found in reading the model. */
  measures?: Map<string, CompiledMeasure>;
  /** For the data model: every row of every table, which measures that work in the filters of a cell read. */
  model?: ModelData;
  /** Fields a field list leaves out. */
  hidden?: string[];
  problems?: string[];
  /** Pivot styles of your own, which a table's style may name. */
  styles?: Record<string, PivotStyleDef>;
}

/** The range a pivot table's source stands for: its sheet and cells (the header row included). Null if it isn't there. */
export function pivotSourceRange(wb: Workbook, source: string, home: string): { sheet: Sheet; bounds: Bounds } | null {
  const found = findTable(wb, source);
  if (found) {
    const { sheet, table, bounds } = found;
    if (!hasHeader(table)) return null;
    return { sheet, bounds: { ...bounds, r2: table.totals ? bounds.r2 - 1 : bounds.r2 } };
  }
  const ref = chartRef(source, home);
  if (!ref) return null;
  const sheet = wb.sheets.find((s) => s.name.toLowerCase() === ref.sheet.toLowerCase());
  return sheet ? { sheet, bounds: ref.bounds } : null;
}

/** Field names from the header cells: an empty one is `Column3`, and the second `Sales` is `Sales2`. */
export function fieldNames(header: readonly Value[]): string[] {
  const seen = new Set<string>();
  return header.map((h, i) => {
    let name = h === null || h === "" ? `Column${i + 1}` : isError(h) ? h.error : typeof h === "string" ? h : typeof h === "boolean" ? (h ? "TRUE" : "FALSE") : formatValue(h).text;
    if (seen.has(name.toLowerCase())) {
      let n = 2;
      while (seen.has(`${name}${n}`.toLowerCase())) n++;
      name = `${name}${n}`;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}

/** The fields a pivot table made from several ranges has: a row label, a column label, a number, and the name of the range. */
export const CONSOLIDATION_FIELDS = ["Row", "Column", "Value", "Page1"] as const;

/** The fields of a pivot table made from several ranges with this many page fields (1 unless the table says). */
export const consolidationFields = (pages: number | undefined): string[] => ["Row", "Column", "Value", ...Array.from({ length: pages ?? 1 }, (_, i) => `Page${i + 1}`)];

/** The ranges a pivot table made from several ranges reads (the sheet and cells of each, the header row and column included), with the name each has. */
export function pivotSourceRanges(wb: Workbook, p: Pick<Pivot, "ranges"> & Pick<Partial<Pivot>, "pageFields">, home: string): { sheet: Sheet; bounds: Bounds; name: string; names: string[] }[] | null {
  if (!p.ranges?.length) return null;
  const out: { sheet: Sheet; bounds: Bounds; name: string; names: string[] }[] = [];
  for (const [i, r] of p.ranges.entries()) {
    const ref = chartRef(r.source, home);
    const sheet = ref && wb.sheets.find((s) => s.name.toLowerCase() === ref.sheet.toLowerCase());
    if (!ref || !sheet) return null;
    const first = r.names?.[0] ?? r.name ?? `Item${i + 1}`;
    out.push({ sheet, bounds: ref.bounds, name: first, names: Array.from({ length: p.pageFields ?? 1 }, (_, k) => (k === 0 ? first : (r.names?.[k] ?? `Item${i + 1}`))) });
  }
  return out;
}

/**
 * The cells of the workbook a pivot table reads: one range for a range or a table, one for each range of a pivot table made of
 * several, one for each table of the data model that is on a sheet, none for data from outside the workbook. Null if one is missing.
 */
export function pivotAreas(wb: Workbook, p: Pick<Pivot, "source"> & Pick<Partial<Pivot>, "ranges">, home: string): { sheet: Sheet; bounds: Bounds }[] | null {
  if (isModelSource(p.source)) {
    if (!wb.model) return null;
    const out: { sheet: Sheet; bounds: Bounds }[] = [];
    for (const t of wb.model.tables) {
      if (isExternalSource(t.source)) continue;
      const at = pivotSourceRange(wb, t.source, home);
      if (!at) return null;
      out.push(at);
    }
    return out;
  }
  if (isExternalSource(p.source)) return [];
  const many = pivotSourceRanges(wb, p, home);
  if (many) return many;
  const one = pivotSourceRange(wb, p.source, home);
  return one ? [one] : null;
}

/** The records of a source, read through `valueAt` (which gives what a cell is worth). Null if the source isn't a range with a header row. */
export function readPivotSource(wb: Workbook, p: Pick<Pivot, "source"> & Pick<Partial<Pivot>, "ranges" | "values" | "pageFields">, home: string, valueAt: (sheet: Sheet, address: string) => Value): PivotSource | null {
  const found = readSource(wb, p, home, valueAt);
  return found && wb.pivotStyles && !found.styles ? { ...found, styles: wb.pivotStyles } : found;
}

/** The rows of a block of outside data as a source: the first row names the fields. */
export function blockSource(block: DataBlock): PivotSource {
  const [header = [], ...rest] = block.rows;
  const records = rest.filter((row) => row.some((v) => v !== null && v !== "")) as Value[][];
  return { fields: fieldNames(header as Value[]), records, formats: header.map((_, i) => block.formats?.[i] || undefined) };
}

function readSource(wb: Workbook, p: Pick<Pivot, "source"> & Pick<Partial<Pivot>, "ranges" | "values" | "pageFields">, home: string, valueAt: (sheet: Sheet, address: string) => Value): PivotSource | null {
  if (isModelSource(p.source)) {
    if (!wb.model) return null;
    const model = buildModelSource(wb.model, (t) => {
      const one = readSource(wb, { source: t.source }, home, valueAt);
      return one && { fields: one.fields, records: one.records, formats: one.formats };
    });
    // Only the tables a pivot table's values read give it records.
    const keep = p.values?.length ? involvedTables(p.values.map((v) => v.field), model) : null;
    const at = keep ? model.records.map((_, i) => i).filter((i) => keep.has(model.tags[i]!)) : null;
    return {
      fields: model.fields,
      records: at ? at.map((i) => model.records[i]!) : model.records,
      formats: model.formats,
      measures: model.measures,
      model: { fields: model.fields, records: model.records, tags: model.tags, tables: model.tables },
      hidden: model.hidden,
      problems: model.problems,
    };
  }
  if (isExternalSource(p.source)) {
    const block = findBlock(wb, p.source);
    return block ? blockSource(block) : null;
  }
  if (p.ranges?.length) {
    // Several ranges: each is a table with row labels down its first column and column labels along its first row.
    const many = pivotSourceRanges(wb, p, home);
    if (!many) return null;
    const records: Value[][] = [];
    for (const { sheet, bounds: b, names } of many) {
      if (b.r2 <= b.r1 || b.c2 <= b.c1) return null;
      for (let r = b.r1 + 1; r <= b.r2; r++) {
        const row = valueAt(sheet, cellAddress(r, b.c1));
        for (let c = b.c1 + 1; c <= b.c2; c++) {
          const v = valueAt(sheet, cellAddress(r, c));
          if (v === null || v === "") continue;
          records.push([row, valueAt(sheet, cellAddress(b.r1, c)), v, ...names]);
        }
      }
    }
    const first = many[0]!;
    const formats = [first.sheet.cells[cellAddress(first.bounds.r1 + 1, first.bounds.c1)]?.fmt, first.sheet.cells[cellAddress(first.bounds.r1, first.bounds.c1 + 1)]?.fmt, first.sheet.cells[cellAddress(first.bounds.r1 + 1, first.bounds.c1 + 1)]?.fmt, ...(consolidationFields(p.pageFields).slice(3).map(() => undefined))];
    return { fields: consolidationFields(p.pageFields), records, formats, sheet: first.sheet.id };
  }
  const at = pivotSourceRange(wb, p.source, home);
  if (!at || at.bounds.r2 < at.bounds.r1) return null;
  const { sheet, bounds: b } = at;
  const header: Value[] = [];
  for (let c = b.c1; c <= b.c2; c++) header.push(valueAt(sheet, cellAddress(b.r1, c)));
  const records: Value[][] = [];
  const rowAt: number[] = [];
  const looks: NonNullable<PivotSource["looks"]> = [];
  for (let r = b.r1 + 1; r <= b.r2; r++) {
    const row: Value[] = [];
    const look: ({ fill?: string | undefined; font?: string | undefined } | undefined)[] = [];
    let any = false;
    for (let c = b.c1; c <= b.c2; c++) {
      const v = valueAt(sheet, cellAddress(r, c));
      if (v !== null && v !== "") any = true;
      row.push(v);
      const st = sheet.cells[cellAddress(r, c)]?.s;
      look.push(st?.fill || st?.color ? { fill: st.fill, font: st.color } : undefined);
    }
    if (any) {
      records.push(row);
      rowAt.push(r);
      looks.push(look);
    }
  }
  const formats: (string | undefined)[] = [];
  for (let c = b.c1; c <= b.c2; c++) formats.push(sheet.cells[cellAddress(b.r1 + 1, c)]?.fmt);
  return { fields: fieldNames(header), records, formats, rowAt, colAt: header.map((_, i) => b.c1 + i), sheet: sheet.id, looks };
}

// ---- items ----

/** What makes two values the same item: text without regard to capitals, a number by its value. */
export function itemKey(v: Value): string {
  if (v === null || v === "") return "b";
  if (isError(v)) return `e${v.error}`;
  if (typeof v === "number") return `n${v}`;
  if (typeof v === "boolean") return `t${v}`;
  return `s${v.toLowerCase()}`;
}

/** How an item shows in a heading, and what a filter or a hidden item calls it. */
export function itemLabel(v: Value, fmt?: string): string {
  if (v === null || v === "") return "(blank)";
  if (isError(v)) return v.error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return typeof v === "number" ? formatValue(v, fmt).text : v;
}

const rank = (v: Value) => (v === null || v === "" ? 4 : isError(v) ? 3 : typeof v === "boolean" ? 2 : typeof v === "string" ? 1 : 0);

function compareItems(a: Value, b: Value, descending: boolean): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra === 4 || rb === 4) return ra === rb ? 0 : ra === 4 ? 1 : -1;
  let c: number;
  if (ra !== rb) c = ra - rb;
  else if (typeof a === "number") c = a - (b as number);
  else if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = (b as string).toLowerCase();
    c = x < y ? -1 : x > y ? 1 : 0;
  } else if (typeof a === "boolean") c = Number(a) - Number(b as boolean);
  else c = String((a as { error: string }).error).localeCompare(String((b as { error: string }).error));
  // Types keep their order (numbers, text, logical values, errors) whichever way the items run.
  return descending && ra === rb ? -c : c;
}

/** Every filter on an axis field: `filter` and the more it has in `filters`. */
export const fieldFilters = (f: Pick<PivotAxisField, "filter" | "filters">): PivotFieldFilter[] => [...(f.filter ? [f.filter] : []), ...(f.filters ?? [])];

export interface PivotItem {
  key: string;
  v: Value;
  label: string;
  /** An item worked out from others of the field. */
  calc?: true;
  /** For the items of a group: where it comes in the order of the field (January before February). */
  order?: number;
}

/** An order that puts the items an axis field names first, in the order it names them. */
function manual(order: readonly string[] | undefined, fallback: (a: PivotItem, b: PivotItem) => number): (a: PivotItem, b: PivotItem) => number {
  if (!order?.length) return fallback;
  const at = new Map(order.map((label, i) => [label, i]));
  return (a, b) => {
    const x = at.get(a.label) ?? Infinity;
    const y = at.get(b.label) ?? Infinity;
    return x === y ? fallback(a, b) : x < y ? -1 : 1;
  };
}

function compareItem(a: PivotItem, b: PivotItem, descending: boolean): number {
  if (a.order !== undefined && b.order !== undefined) return descending ? b.order - a.order : a.order - b.order;
  if (a.order !== undefined || b.order !== undefined) return a.order !== undefined ? -1 : 1;
  return compareItems(a.v, b.v, descending);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The numbers the ranges of a number group run between, when `start` or `end` aren't given. */
function numberSpan(src: PivotSource, at: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const rec of src.records) {
    const v = rec[at];
    if (typeof v === "number") {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max };
}

/** What a grouping by items shows for an item that shows as `label`: its group's name, or the label itself. */
export function itemsNamer(group: PivotItemsGroup): (label: string) => string {
  const home = new Map<string, string>();
  for (const g of group.groups) for (const label of g.items) if (!home.has(label.toLowerCase())) home.set(label.toLowerCase(), g.name);
  const inner = group.of ? itemsNamer(group.of) : (label: string) => label;
  return (label) => {
    const below = inner(label);
    return home.get(below.toLowerCase()) ?? below;
  };
}

/** The headings of a grouping by items, innermost first: the field's name and a number for each level (Region2, Region3). */
export function itemsHeadings(field: string, group: PivotItemsGroup): string[] {
  const chain: PivotItemsGroup[] = [];
  for (let g: PivotItemsGroup | undefined = group; g; g = g.of) chain.unshift(g);
  return chain.map((g, i) => g.name ?? `${field}${i + 2}`);
}

/** Works out the item a record has in a field: the value itself, or the group the value falls in. */
export type ItemMaker = (rec: readonly Value[]) => PivotItem;

export function itemMaker(src: PivotSource, field: string, group?: PivotGroup): ItemMaker {
  const at = src.fields.indexOf(field);
  const plain = (v: Value): PivotItem => ({ key: itemKey(v), v: v === "" ? null : v, label: itemLabel(v, src.formats[at]) });
  if (!group || at < 0) return (rec) => plain(rec[at] ?? null);
  if (group.by === "number") {
    const span = group.start === undefined || group.end === undefined ? numberSpan(src, at) : { min: 0, max: 0 };
    const start = group.start ?? span.min;
    const end = group.end ?? span.max;
    const step = group.step;
    const whole = Number.isInteger(start) && Number.isInteger(step);
    const show = (n: number) => formatValue(Math.round(n * 1e9) / 1e9, src.formats[at]).text;
    return (rec) => {
      const v = rec[at] ?? null;
      if (typeof v !== "number") return plain(v);
      if (v < start) return { key: "g<", v: `<${show(start)}`, label: `<${show(start)}`, order: -1 };
      if (v > end) return { key: "g>", v: `>${show(end)}`, label: `>${show(end)}`, order: Number.MAX_SAFE_INTEGER };
      const i = Math.floor((v - start) / step + 1e-9);
      const lo = start + i * step;
      const label = `${show(lo)}-${show(whole ? lo + step - 1 : lo + step)}`;
      return { key: `g${i}`, v: label, label, order: i };
    };
  }
  if (group.by === "items") {
    // Items you picked go under the name of their group; the others stay as they are. A group of groups takes what the groups
    // inside it show.
    const nameOf = itemsNamer(group);
    return (rec) => {
      const item = plain(rec[at] ?? null);
      const name = nameOf(item.label);
      return name === item.label ? item : { key: itemKey(name), v: name, label: name };
    };
  }
  if (group.by === "dayRange") {
    const days = Math.max(1, Math.floor(group.days));
    const dates = src.records.map((r) => r[at]).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 2958465).map(Math.floor);
    const start = group.start !== undefined ? Math.floor(group.start) : dates.length ? Math.min(...dates) : 0;
    const end = group.end !== undefined ? Math.floor(group.end) : dates.length ? Math.max(...dates) : 0;
    const show = (n: number) => formatValue(n, "m/d/yyyy").text;
    return (rec) => {
      const v = rec[at] ?? null;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 2958465) return plain(v);
      const day = Math.floor(v);
      if (day < start) return { key: "g<", v: `<${show(start)}`, label: `<${show(start)}`, order: -1 };
      if (day > end) return { key: "g>", v: `>${show(end)}`, label: `>${show(end)}`, order: Number.MAX_SAFE_INTEGER };
      const i = Math.floor((day - start) / days);
      const lo = start + i * days;
      const label = `${show(lo)} - ${show(Math.min(lo + days - 1, end))}`;
      return { key: `g${i}`, v: label, label, order: i };
    };
  }
  const by = group.by;
  return (rec) => {
    const v = rec[at] ?? null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 2958465) return plain(v);
    if (by === "hours" || by === "minutes" || by === "seconds") {
      const t = serialTime(v);
      const n = by === "hours" ? t.hour : by === "minutes" ? t.minute : t.second;
      return { key: `${by[0]}${n}`, v: n, label: String(n), order: n };
    }
    const d = serialDate(v);
    switch (by) {
      case "years":
        return { key: `y${d.year}`, v: d.year, label: String(d.year), order: d.year };
      case "quarters": {
        const q = Math.floor((d.month - 1) / 3) + 1;
        return { key: `q${q}`, v: `Qtr${q}`, label: `Qtr${q}`, order: q };
      }
      case "months":
        return { key: `m${d.month}`, v: MONTHS[d.month - 1]!, label: MONTHS[d.month - 1]!, order: d.month };
      case "days": {
        const label = `${d.day}-${MONTHS[d.month - 1]}`;
        return { key: `d${d.month}-${d.day}`, v: label, label, order: d.month * 100 + d.day };
      }
      default:
        return plain(v);
    }
  };
}

/** The different items of a field, in the order they are shown. */
export function fieldItems(src: PivotSource, field: string, descending = false, group?: PivotGroup, order?: readonly string[]): PivotItem[] {
  if (src.fields.indexOf(field) < 0) return [];
  const make = itemMaker(src, field, group);
  const seen = new Map<string, PivotItem>();
  for (const rec of src.records) {
    const item = make(rec);
    if (!seen.has(item.key)) seen.set(item.key, item);
  }
  return [...seen.values()].sort(manual(order, (a, b) => compareItem(a, b, descending)));
}

/** The heading of a field in a table with its items grouped: Excel calls the groups of years `Years` and of quarters `Quarters`. */
export function axisHeading(f: PivotAxisField): string {
  const g = f.group;
  if (g?.by === "items") return itemsHeadings(f.field, g).at(-1)!;
  return g?.by === "years" ? "Years" : g?.by === "quarters" ? "Quarters" : g?.by === "hours" ? "Hours" : g?.by === "minutes" ? "Minutes" : g?.by === "seconds" ? "Seconds" : f.field;
}

// ---- fields worked out from others ----

/** What a calculated field's formula does with the sums of the fields it names. */
export type CalcRun = (get: (field: string) => number | ErrorCode | undefined) => number | ErrorCode;

interface Compiled {
  refs: string[];
  run: CalcRun;
}

/** Reads a calculated field's formula (`Sales - Cost`, `'Unit price' * Qty / 2`): the fields it names, and how to work it out. */
export function parseCalculated(formula: string): Compiled {
  const text = formula.trim().replace(/^=/, "");
  const tokens: { t: "num" | "name" | "op"; s: string }[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (/\s/.test(ch)) i++;
    else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
      if (!m) return bad(`"${formula}" has a number that doesn't read`);
      tokens.push({ t: "num", s: m[0] });
      i += m[0].length;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return bad(`"${formula}" has a field name that isn't closed with '`);
      tokens.push({ t: "name", s: text.slice(i + 1, end) });
      i = end + 1;
    } else if (/[A-Za-z_À-￿]/.test(ch)) {
      const m = /^[A-Za-z0-9_.À-￿]+/.exec(text.slice(i))!;
      tokens.push({ t: "name", s: m[0] });
      i += m[0].length;
    } else if ("+-*/^()".includes(ch)) {
      tokens.push({ t: "op", s: ch });
      i++;
    } else return bad(`"${formula}" has "${ch}", which a calculated field can't use (only fields, numbers, + - * / ^ and brackets)`);
  }
  if (!tokens.length) return bad("A calculated field needs a formula");
  const refs: string[] = [];
  let at = 0;
  type Fn = (get: Parameters<CalcRun>[0]) => number | ErrorCode;
  const peek = () => tokens[at];
  const eat = (s: string) => (peek()?.t === "op" && peek()!.s === s ? (at++, true) : false);
  const expr = (): Fn => {
    let left = term();
    for (;;) {
      if (eat("+")) {
        const a = left;
        const b = term();
        left = (g) => arith(a(g), b(g), (x, y) => x + y);
      } else if (eat("-")) {
        const a = left;
        const b = term();
        left = (g) => arith(a(g), b(g), (x, y) => x - y);
      } else return left;
    }
  };
  const term = (): Fn => {
    let left = unary();
    for (;;) {
      if (eat("*")) {
        const a = left;
        const b = unary();
        left = (g) => arith(a(g), b(g), (x, y) => x * y);
      } else if (eat("/")) {
        const a = left;
        const b = unary();
        left = (g) => {
          const y = b(g);
          return y === 0 ? "#DIV/0!" : arith(a(g), y, (p, q) => p / q);
        };
      } else return left;
    }
  };
  const unary = (): Fn => {
    if (eat("-")) {
      const a = unary();
      return (g) => arith(a(g), 0, (x) => -x);
    }
    if (eat("+")) return unary();
    return power();
  };
  const power = (): Fn => {
    const base = atom();
    if (eat("^")) {
      const a = base;
      const b = unary();
      return (g) => arith(a(g), b(g), (x, y) => x ** y);
    }
    return base;
  };
  const atom = (): Fn => {
    const t = tokens[at++];
    if (!t) return bad(`"${formula}" stops where a field or number should be`);
    if (t.t === "num") {
      const n = Number(t.s);
      return () => n;
    }
    if (t.t === "name") {
      if (tokens[at]?.t === "op" && tokens[at]!.s === "(") return bad(`"${formula}" calls ${t.s}( ): a calculated field has no functions, only fields, numbers, + - * / ^ and brackets`);
      if (!refs.includes(t.s)) refs.push(t.s);
      const name = t.s;
      return (g) => g(name) ?? 0;
    }
    if (t.s === "(") {
      const e = expr();
      if (!eat(")")) return bad(`"${formula}" has a ( that isn't closed`);
      return e;
    }
    return bad(`"${formula}" has "${t.s}" where a field or number should be`);
  };
  const run = expr();
  if (at < tokens.length) bad(`"${formula}" has "${tokens[at]!.s}" in a place it can't be`);
  return { refs, run };
}

function arith(a: number | ErrorCode, b: number | ErrorCode, f: (x: number, y: number) => number): number | ErrorCode {
  if (typeof a === "string") return a;
  if (typeof b === "string") return b;
  const r = f(a, b);
  return Number.isFinite(r) ? r : "#NUM!";
}

/** The fields a calculated field's formula names. */
export const calculatedRefs = (c: PivotCalculatedField): string[] => parseCalculated(c.formula).refs;

// ---- checking ----

function cleanGroup(g: PivotGroup): PivotGroup {
  if (!g || typeof g !== "object") return bad("A group is an object with a `by`");
  if (g.by === "number") {
    if (typeof g.step !== "number" || !Number.isFinite(g.step) || g.step <= 0) bad("A group of numbers needs a step above zero");
    const out: PivotGroup = { by: "number", step: g.step };
    if (g.start !== undefined) {
      if (typeof g.start !== "number" || !Number.isFinite(g.start)) bad("The start of a group of numbers is a number");
      out.start = g.start;
    }
    if (g.end !== undefined) {
      if (typeof g.end !== "number" || !Number.isFinite(g.end)) bad("The end of a group of numbers is a number");
      out.end = g.end;
    }
    if (out.start !== undefined && out.end !== undefined && out.end < out.start) bad("A group of numbers ends after it starts");
    return out;
  }
  if (g.by === "dayRange") {
    if (!Number.isInteger(g.days) || g.days < 1 || g.days > 3650) bad("A group of days spans a whole number of days, from 1 to 3650");
    const out: PivotGroup = { by: "dayRange", days: g.days };
    for (const k of ["start", "end"] as const) {
      const x = g[k];
      if (x === undefined) continue;
      if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 2958465) bad(`The ${k} of a group of days is a date`);
      out[k] = x;
    }
    if (out.start !== undefined && out.end !== undefined && out.end < out.start) bad("A group of days ends after it starts");
    return out;
  }
  if (g.by === "items") {
    return cleanItemsGroup(g, 0);
  }
  if (!PIVOT_GROUP_BY.includes(g.by)) bad(`Dates are grouped by ${PIVOT_GROUP_BY.join(", ")}, or by a number of days; numbers by "number"; items you pick by "items"`);
  return { by: g.by };
}

const MAX_GROUP_DEPTH = 6;

function cleanItemsGroup(g: PivotItemsGroup, depth: number): PivotItemsGroup {
  {
    if (depth >= MAX_GROUP_DEPTH) bad(`Groups can be inside groups at most ${MAX_GROUP_DEPTH} deep`);
    if (!Array.isArray(g.groups) || !g.groups.length || g.groups.length > 1000) bad("Grouping by items needs a list of groups, each with a name and its items");
    const seen = new Set<string>();
    const taken = new Set<string>();
    const groups = g.groups.map((x) => {
      if (!x || typeof x.name !== "string" || x.name.trim() === "" || x.name.length > 255) return bad("A group of items needs a name");
      if (!Array.isArray(x.items) || !x.items.length || !x.items.every((i) => typeof i === "string")) return bad(`The group "${x.name}" needs a list of items, as text`);
      const name = x.name.trim();
      if (seen.has(name.toLowerCase())) bad(`There are two groups called "${name}"`);
      seen.add(name.toLowerCase());
      const items = x.items.filter((i) => {
        // An item can be in one group only: the first to take it keeps it.
        if (taken.has(i.toLowerCase())) return false;
        taken.add(i.toLowerCase());
        return true;
      });
      return { name, items };
    });
    const out: PivotItemsGroup = { by: "items", groups };
    if (g.name !== undefined && g.name !== "") {
      if (typeof g.name !== "string" || g.name.length > 255) bad("The heading of a grouped field is text");
      out.name = g.name;
    }
    if (g.of !== undefined) {
      if (!g.of || typeof g.of !== "object" || g.of.by !== "items") bad("A group inside a group groups the groups of another grouping by items");
      out.of = cleanItemsGroup(g.of, depth + 1);
      // A group of groups can only name what the groups under it show: their names, or items they left alone.
      const inner = new Set(out.of.groups.map((x) => x.name.toLowerCase()));
      const clash = out.groups.find((x) => inner.has(x.name.toLowerCase()));
      if (clash) bad(`The group "${clash.name}" has the name of a group inside it: give one of them another name`);
    }
    return out;
  }
}

function cleanFieldFilter(f: PivotFieldFilter, valueCount: number): PivotFieldFilter {
  if (!f || typeof f !== "object") return bad("A field filter is an object with a kind");
  const by = (): number => {
    const x = (f as { by?: number }).by;
    if (!Number.isInteger(x) || x! < 0 || x! >= valueCount) bad(`A filter by a value names one of the ${valueCount} values (counting from 0)`);
    return x!;
  };
  const tests = (): { a: FilterTest; b?: FilterTest; or?: true } => {
    const rule = cleanFilterRule({ kind: "custom", a: (f as { a: FilterTest }).a, ...((f as { b?: FilterTest }).b ? { b: (f as { b: FilterTest }).b } : {}), ...((f as { or?: true }).or ? { or: true as const } : {}) });
    if (rule.kind !== "custom") return bad("A filter compares");
    return { a: rule.a, ...(rule.b ? { b: rule.b } : {}), ...(rule.or ? { or: true as const } : {}) };
  };
  switch (f.kind) {
    case "label":
      return { kind: "label", ...tests() };
    case "value":
      return { kind: "value", by: by(), ...tests() };
    case "top": {
      const unit = f.unit ?? "items";
      if (unit !== "items" && unit !== "percent" && unit !== "sum") bad('A top or bottom filter counts "items", "percent" or "sum"');
      if (typeof f.n !== "number" || !Number.isFinite(f.n) || f.n <= 0) bad("A top or bottom filter needs a count above zero");
      if (unit === "items" && !Number.isInteger(f.n)) bad("A top or bottom count of items is a whole number");
      if (unit === "percent" && f.n > 100) bad("A top or bottom percent is from 1 to 100");
      return { kind: "top", by: by(), n: f.n, ...(f.bottom ? { bottom: true as const } : {}), ...(unit !== "items" ? { unit } : {}) };
    }
    case "date": {
      if (!FILTER_DATE_PERIODS.includes(f.period)) bad(`A date filter names one of the periods ${FILTER_DATE_PERIODS.join(", ")}`);
      return { kind: "date", period: f.period };
    }
    case "color": {
      const rule = cleanFilterRule({ kind: "color", ...(f.fill !== undefined ? { fill: f.fill } : {}), ...(f.font !== undefined ? { font: f.font } : {}) });
      if (rule.kind !== "color") return bad("A colour filter picks a fill or a font colour");
      return { kind: "color", ...(rule.fill !== undefined ? { fill: rule.fill } : { font: rule.font! }) };
    }
    default:
      return bad("A field filter is a label, value, date, colour or top filter");
  }
}

/** A pivot table made ready to keep, or an error that says what is wrong with it. */
export function cleanPivot(p: Pivot): Pivot {
  if (!p || typeof p.id !== "string" || p.id === "") bad("A pivot table needs an id");
  if (typeof p.name !== "string" || p.name.trim() === "" || p.name.length > 255) bad("A pivot table needs a name");
  if (typeof p.source !== "string" || p.source === "") bad("A pivot table needs a source: a range with the field names in its first row, or a table");
  const at = typeof p.anchor === "string" ? parseCell(p.anchor.toUpperCase()) : null;
  if (!at || at.row > MAX_ROWS || at.col > MAX_COLS) bad(`"${String(p.anchor)}" isn't a cell`);
  const range = typeof p.range === "string" ? parseRange(p.range.toUpperCase()) : null;
  if (!range) bad(`"${String(p.range)}" isn't a range of cells`);
  if (!Array.isArray(p.rows) || !Array.isArray(p.columns) || !Array.isArray(p.values)) bad("A pivot table lists its row fields, column fields and value fields");
  if (p.rows.length + p.columns.length + p.values.length === 0) bad("A pivot table needs at least one field");
  if (p.columns.length > 0 && p.values.length === 0) bad("A pivot table with column fields needs a value field");
  const used = new Set<string>();
  const groupKey = (g: PivotGroup | undefined): string => (g ? (g.by === "number" ? `number:${g.step}:${g.start ?? ""}:${g.end ?? ""}` : g.by === "dayRange" ? `dayRange:${g.days}:${g.start ?? ""}:${g.end ?? ""}` : g.by === "items" ? `items:${g.name ?? ""}:${g.of ? groupKey(g.of) : ""}` : g.by) : "");
  const axis = (list: PivotAxisField[], what: string): PivotAxisField[] =>
    list.map((f) => {
      if (!f || typeof f.field !== "string" || f.field === "") return bad(`A ${what} field needs the name of a field`);
      const group = f.group ? cleanGroup(f.group) : undefined;
      // A field can be placed twice only to group it in different ways.
      const slot = group ? `${f.field.toLowerCase()}\u0000${groupKey(group)}` : f.field.toLowerCase();
      if (used.has(slot)) bad(`${f.field} is in the pivot table twice`);
      used.add(slot);
      const out: PivotAxisField = { field: f.field };
      if (f.descending) out.descending = true;
      if (f.hidden?.length) {
        if (!f.hidden.every((h) => typeof h === "string")) bad("The items left out are text");
        out.hidden = [...f.hidden];
      }
      if (f.subtotal === false) out.subtotal = false;
      if (group) out.group = group;
      if (f.sortBy !== undefined) {
        if (!f.sortBy || !Number.isInteger(f.sortBy.value) || f.sortBy.value < 0 || f.sortBy.value >= p.values.length) bad(`${f.field} is sorted by a value that isn't there: name one of the ${p.values.length} values (counting from 0)`);
        out.sortBy = { value: f.sortBy.value, ...(f.sortBy.descending ? { descending: true as const } : {}) };
      }
      if (f.filter !== undefined || f.filters?.length) {
        if (f.filters !== undefined && (!Array.isArray(f.filters) || f.filters.length > 3)) bad(`${f.field} has at most three filters: by label, by value and by colour`);
        const cleaned = [...(f.filter ? [f.filter] : []), ...(f.filters ?? [])].map((x) => cleanFieldFilter(x, p.values.length));
        // Excel lets a field have a label (or date) filter, a value (or top) filter and a colour filter together, one of each.
        const kind = (x: PivotFieldFilter) => (x.kind === "label" || x.kind === "date" ? "label" : x.kind === "value" || x.kind === "top" ? "value" : "color");
        const kinds = cleaned.map(kind);
        if (new Set(kinds).size !== kinds.length) bad(`${f.field} has two filters of the same kind: a field has one filter by label, one by value and one by colour`);
        for (const x of cleaned) {
          if (x.kind === "date" && group) bad(`${f.field} is grouped, so its items aren't dates to filter`);
          if (x.kind === "color" && group) bad(`${f.field} is grouped, so a colour can't pick its items`);
        }
        out.filter = cleaned[0]!;
        if (cleaned.length > 1) out.filters = cleaned.slice(1);
      }
      if (f.order !== undefined) {
        if (!Array.isArray(f.order) || !f.order.every((i) => typeof i === "string") || f.order.length > 10000) bad(`The order of the items of ${f.field} is a list of their names`);
        if (f.sortBy) bad(`${f.field} is sorted by a value, so its items can't also be in an order you chose`);
        if (f.order.length) out.order = [...new Set(f.order)];
      }
      if (f.blankRow) out.blankRow = true;
      return out;
    });
  const rows = axis(p.rows, "row");
  const columns = axis(p.columns, "column");
  const filters: PivotFilter[] = (p.filters ?? []).map((f) => {
    if (!f || typeof f.field !== "string" || f.field === "") return bad("A filter needs the name of a field");
    if (used.has(f.field.toLowerCase())) bad(`${f.field} is in the pivot table twice`);
    used.add(f.field.toLowerCase());
    if (!Array.isArray(f.items) || !f.items.every((i) => typeof i === "string")) bad("A filter lists the items it lets through, as text");
    return { field: f.field, items: [...f.items], ...(f.hidden ? { hidden: true as const } : {}) };
  });
  const calculated: PivotCalculatedField[] = [];
  const calcNames = new Set<string>();
  for (const c of p.calculated ?? []) {
    if (!c || typeof c.name !== "string" || c.name.trim() === "" || c.name.length > 255) bad("A calculated field needs a name");
    if (typeof c.formula !== "string") bad("A calculated field needs a formula");
    if (calcNames.has(c.name.trim().toLowerCase())) bad(`There are two calculated fields called "${c.name}"`);
    calcNames.add(c.name.trim().toLowerCase());
    parseCalculated(c.formula);
    calculated.push({ name: c.name.trim(), formula: c.formula.trim().replace(/^=/, "") });
  }
  if (calculated.some((c) => used.has(c.name.toLowerCase()))) bad("A calculated field can only be summed up in the body: it can't go on the rows, columns or filters");
  const names = new Set<string>();
  const values = p.values.map((v) => {
    if (!v || typeof v.field !== "string" || v.field === "") return bad("A value needs the name of a field");
    const out: PivotValue = { field: v.field };
    if (v.fn !== undefined) {
      if (!PIVOT_FUNCTIONS.includes(v.fn)) bad(`A value is summed up by ${PIVOT_FUNCTIONS.join(", ")}`);
      out.fn = v.fn;
    }
    if (v.name !== undefined && v.name !== "") {
      if (typeof v.name !== "string" || v.name.length > 255) bad("A value's heading is text");
      out.name = v.name;
    }
    if (v.fmt !== undefined && v.fmt !== "") {
      if (typeof v.fmt !== "string") bad("A number format is text");
      out.fmt = v.fmt;
    }
    if (v.showAs !== undefined) {
      if (!PIVOT_SHOW_AS.includes(v.showAs)) bad(`A value shows as ${PIVOT_SHOW_AS.join(", ")}`);
      out.showAs = v.showAs;
    }
    if (v.base !== undefined) {
      const b = v.base as PivotBase | null;
      if (!b || typeof b.field !== "string" || b.field === "") bad("A comparison names the field it runs along");
      if (!out.showAs || !PIVOT_ALONG.includes(out.showAs)) bad("Only a value that compares items has a base");
      if (![...rows, ...columns].some((f) => f.field === b!.field)) bad(`"${b!.field}" isn't a row or column field, so a value can't run along it`);
      const item = b!.item;
      if (item !== undefined && typeof item !== "string" && !(item && (item.step === "previous" || item.step === "next"))) bad("The item to compare with is the text of an item, or its previous or next one");
      out.base = item === undefined ? { field: b!.field } : { field: b!.field, item };
    }
    if (out.showAs && PIVOT_NEEDS_ITEM.includes(out.showAs) && (!out.base || out.base.item === undefined)) bad(`A value shown as ${out.showAs} needs the item to compare with`);
    const name = (out.name ?? `${PIVOT_FUNCTION_NAMES[out.fn ?? "sum"]} of ${out.field}`).toLowerCase();
    if (names.has(name)) bad(`Two values are called "${out.name ?? name}": give one a name of its own`);
    names.add(name);
    return out;
  });
  if (p.tabular && p.outline) bad("A pivot table is tabular or outline, not both");
  const calculatedItems: PivotCalculatedItem[] = [];
  const itemNames = new Set<string>();
  for (const c of p.calculatedItems ?? []) {
    if (!c || typeof c.field !== "string" || c.field === "") bad("A calculated item needs the name of its field");
    if (typeof c.name !== "string" || c.name.trim() === "" || c.name.length > 255) bad("A calculated item needs a name");
    if (typeof c.formula !== "string") bad("A calculated item needs a formula");
    const key = `${c.field.toLowerCase()}\u0000${c.name.trim().toLowerCase()}`;
    if (itemNames.has(key)) bad(`There are two calculated items called "${c.name}" in ${c.field}`);
    itemNames.add(key);
    const home = [...rows, ...columns].find((f) => f.field.toLowerCase() === c.field.toLowerCase());
    if (!home) bad(`The calculated item "${c.name}" belongs to ${c.field}, which isn't a row or column field`);
    if (home!.group) bad(`${c.field} is grouped, so it can't have calculated items`);
    const refs = parseCalculated(c.formula).refs;
    if (refs.some((r) => r.toLowerCase() === c.name.trim().toLowerCase())) bad(`The calculated item "${c.name}" uses itself`);
    calculatedItems.push({ field: home!.field, name: c.name.trim(), formula: c.formula.trim().replace(/^=/, "") });
  }
  const out: Pivot = { id: p.id, name: p.name.trim(), source: p.source, anchor: cellAddress(at!.row, at!.col), rows, columns, values, range: rangeAddress(range!) };
  if (filters.length) out.filters = filters;
  if (calculated.length) out.calculated = calculated;
  if (p.tabular) out.tabular = true;
  if (p.outline) out.outline = true;
  if (p.repeatLabels) out.repeatLabels = true;
  if (p.valuesOnRows) out.valuesOnRows = true;
  if (p.autoRefresh) out.autoRefresh = true;
  if (p.grandTotalRows === false) out.grandTotalRows = false;
  if (p.grandTotalColumns === false) out.grandTotalColumns = false;
  if (calculatedItems.length) out.calculatedItems = calculatedItems;
  if (p.formats?.length) out.formats = cleanFormats(p.formats, values.length);
  if (p.ranges !== undefined) {
    if (!Array.isArray(p.ranges) || !p.ranges.length || p.ranges.length > 255) bad("A pivot table made from several ranges lists them (up to 255)");
    const seen = new Set<string>();
    out.ranges = p.ranges.map((r, i) => {
      if (!r || typeof r.source !== "string" || r.source === "") return bad("Each range needs a source, such as Data!A1:D10");
      const names = r.names === undefined ? undefined : r.names;
      if (names !== undefined && (!Array.isArray(names) || names.length > 4 || !names.every((x) => typeof x === "string" && x.length <= 255))) bad("The names of a range for the page fields are up to four pieces of text");
      const name = r.name === undefined || r.name === "" ? names?.[0] : r.name;
      if (name !== undefined && (typeof name !== "string" || name.length > 255)) bad("The name of a range is text");
      const shown = JSON.stringify([name ?? `Item${i + 1}`, ...(names ?? []).slice(1)]).toLowerCase();
      if (seen.has(shown)) bad(`Two ranges are called "${name ?? `Item${i + 1}`}"`);
      seen.add(shown);
      const own = names?.some((x, k) => k > 0 && x !== "" && x !== `Item${i + 1}`) ? names.map((x, k) => (k === 0 ? (name ?? x) : x)) : undefined;
      return { source: r.source, ...(name !== undefined ? { name } : {}), ...(own ? { names: own } : {}) };
    });
    out.source = out.ranges[0]!.source;
    if (p.pageFields !== undefined) {
      if (!Number.isInteger(p.pageFields) || p.pageFields < 0 || p.pageFields > 4) bad("A pivot table made from several ranges has 0 to 4 page fields");
      if (p.pageFields !== 1) out.pageFields = p.pageFields;
    }
  } else if (p.pageFields !== undefined && p.pageFields !== 1) bad("Page fields belong to a pivot table made from several ranges");
  if (p.style !== undefined) {
    const st = p.style;
    if (!st || typeof st.name !== "string" || st.name.trim() === "" || st.name.length > 255) bad(`A pivot table style is "none", one of PivotStyleLight1 to 28, PivotStyleMedium1 to 28, PivotStyleDark1 to 28, or a style of your own`);
    out.style = { name: st.name, ...(st.rowHeaders === false ? { rowHeaders: false as const } : {}), ...(st.colHeaders === false ? { colHeaders: false as const } : {}), ...(st.rowStripes ? { rowStripes: true as const } : {}), ...(st.colStripes ? { colStripes: true as const } : {}) };
  }
  const ids = new Set<string>();
  const place = (x: { id: string; field: string; from: PivotSlicer["from"]; width: number; height: number; style?: string; caption?: string }, what: string) => {
    if (!x || typeof x.id !== "string" || x.id === "") bad(`A ${what} needs an id`);
    if (ids.has(x.id)) bad(`Two ${what}s have the id "${x.id}"`);
    ids.add(x.id);
    if (typeof x.field !== "string" || x.field === "") bad(`A ${what} needs the name of a field`);
    const f = x.from;
    if (!f || !Number.isInteger(f.row) || !Number.isInteger(f.col) || f.row < 1 || f.col < 1) bad(`A ${what} needs a cell to sit in`);
    for (const n of [x.width, x.height]) if (!(n >= MIN_CHART_SIZE && n <= MAX_CHART_SIZE)) bad(`A ${what} is ${MIN_CHART_SIZE} to ${MAX_CHART_SIZE} pixels across and high`);
    for (const d of [f.dx, f.dy]) if (d !== undefined && !(d >= 0 && Number.isFinite(d))) bad(`A ${what}'s offset in its cell must be 0 or more`);
    return { id: x.id, field: x.field, from: { row: f.row, col: f.col, ...(f.dx !== undefined ? { dx: f.dx } : {}), ...(f.dy !== undefined ? { dy: f.dy } : {}) }, width: x.width, height: x.height, ...(x.caption ? { caption: x.caption } : {}), ...(x.style ? { style: x.style } : {}) };
  };
  if (p.slicers?.length) {
    out.slicers = p.slicers.map((x) => {
      if (x.columns !== undefined && !(Number.isInteger(x.columns) && x.columns >= 1 && x.columns <= 20)) bad("A slicer has 1 to 20 columns of buttons");
      return { ...place(x, "slicer"), ...(x.columns && x.columns > 1 ? { columns: x.columns } : {}) };
    });
  }
  if (p.timelines?.length) {
    out.timelines = p.timelines.map((x) => {
      if (x.level !== undefined && !["years", "quarters", "months", "days"].includes(x.level)) bad("A timeline counts in years, quarters, months or days");
      for (const k of ["start", "end"] as const) if (x[k] !== undefined && !(typeof x[k] === "number" && Number.isFinite(x[k]) && x[k]! >= 0 && x[k]! <= 2958465)) bad(`The ${k} of a timeline is a date`);
      if (x.start !== undefined && x.end !== undefined && x.end < x.start) bad("A timeline ends after it starts");
      return { ...place(x, "timeline"), ...(x.level && x.level !== "months" ? { level: x.level } : {}), ...(x.start !== undefined ? { start: x.start } : {}), ...(x.end !== undefined ? { end: x.end } : {}) };
    });
  }
  return out;
}

/** The fields a pivot table names that its source doesn't have (a calculated field stands in for a source field it names in `values`). */
export function missingFields(p: Pivot, src: PivotSource): string[] {
  const calc = new Set([...(p.calculated ?? []).map((c) => c.name.toLowerCase()), ...(src.measures?.keys() ?? [])]);
  const all = [...p.rows.map((f) => f.field), ...p.columns.map((f) => f.field), ...(p.timelines ?? []).map((t) => t.field), ...(p.slicers ?? []).map((t) => t.field), ...p.values.filter((v) => src.fields.includes(v.field) || !calc.has(v.field.toLowerCase())).map((v) => v.field), ...(p.filters ?? []).map((f) => f.field), ...(p.calculated ?? []).flatMap((c) => calculatedRefs(c))];
  return [...new Set(all)].filter((f) => !src.fields.includes(f));
}

/** What is wrong with a pivot table apart from fields its source lacks, or null. */
export function pivotProblem(p: Pivot, src: PivotSource): string | null {
  if (src.problems?.length) return src.problems[0]!;
  if (src.measures?.size) {
    // A measure is summed up in the body only.
    const onAxis = [...p.rows, ...p.columns].find((f) => src.measures!.has(f.field.toLowerCase()) && !src.fields.includes(f.field));
    if (onAxis) return `"${onAxis.field}" is a measure: it can only be summed up in the body, not go on the rows or columns`;
  }
  for (const c of p.calculated ?? []) {
    if (src.fields.some((f) => f.toLowerCase() === c.name.toLowerCase())) return `The calculated field "${c.name}" has the name of a field of the source: give it another`;
    const clash = calculatedRefs(c).find((r) => (p.calculated ?? []).some((o) => o.name.toLowerCase() === r.toLowerCase()) && !src.fields.includes(r));
    if (clash) return `The calculated field "${c.name}" uses the calculated field "${clash}": a calculated field can use only fields of the source`;
  }
  for (const c of p.calculatedItems ?? []) {
    if (!src.fields.includes(c.field)) return `The calculated item "${c.name}" belongs to ${c.field}, which isn't a field of the source`;
    if (fieldItems(src, c.field).some((i) => i.label.toLowerCase() === c.name.toLowerCase())) return `${c.field} already has an item called "${c.name}": give the calculated item another name`;
  }
  return null;
}

/** The function a value is summed up by: the one it names, or `sum`, or `count` for a field with text in it. */
export function valueFunction(v: PivotValue, src: PivotSource): PivotFunction {
  if (v.fn) return v.fn;
  const at = src.fields.indexOf(v.field);
  if (at >= 0 && src.records.some((r) => typeof r[at] === "string" && r[at] !== "")) return "count";
  return "sum";
}

/** A value's heading: its own name, or `Sum of Sales`. */
export function valueName(v: PivotValue, fn: PivotFunction): string {
  return v.name ?? `${PIVOT_FUNCTION_NAMES[fn]} of ${v.field}`;
}

// ---- summing up ----

interface Acc {
  count: number;
  nums: number;
  sum: number;
  min: number;
  max: number;
  product: number;
  mean: number;
  m2: number;
  error?: ErrorCode;
  /** The different values seen, for a distinct count. */
  seen?: Set<string>;
}

const fresh = (distinct?: boolean): Acc => ({ count: 0, nums: 0, sum: 0, min: Infinity, max: -Infinity, product: 1, mean: 0, m2: 0, ...(distinct ? { seen: new Set<string>() } : {}) });

function add(a: Acc, v: Value): void {
  if (v === null || v === "") return;
  a.count++;
  a.seen?.add(itemKey(v));
  if (isError(v)) {
    a.error ??= v.error;
    return;
  }
  if (typeof v !== "number") return;
  a.nums++;
  a.sum += v;
  if (v < a.min) a.min = v;
  if (v > a.max) a.max = v;
  a.product *= v;
  const d = v - a.mean;
  a.mean += d / a.nums;
  a.m2 += d * (v - a.mean);
}

function sumUp(a: Acc | undefined, fn: PivotFunction): number | ErrorCode | undefined {
  if (!a) return undefined;
  if (fn === "count") return a.count;
  if (fn === "distinctCount") return a.seen?.size ?? 0;
  if (a.error) return a.error;
  switch (fn) {
    case "countNums":
      return a.nums;
    case "sum":
      return a.sum;
    case "average":
      return a.nums ? a.sum / a.nums : "#DIV/0!";
    case "max":
      return a.nums ? a.max : 0;
    case "min":
      return a.nums ? a.min : 0;
    case "product":
      return a.nums ? a.product : 0;
    case "var":
      return a.nums > 1 ? a.m2 / (a.nums - 1) : "#DIV/0!";
    case "varp":
      return a.nums > 0 ? a.m2 / a.nums : "#DIV/0!";
    case "stdDev":
      return a.nums > 1 ? Math.sqrt(a.m2 / (a.nums - 1)) : "#DIV/0!";
    case "stdDevp":
      return a.nums > 0 ? Math.sqrt(a.m2 / a.nums) : "#DIV/0!";
  }
}

/** The text heading a value of a data model's measure. */
const measureHeading = (v: PivotValue): string => v.name ?? v.field;

// ---- drawing ----

/** One cell of a pivot table as it is drawn. */
export interface PivotCell {
  v?: Scalar;
  e?: ErrorCode;
  fmt?: string;
  bold?: true;
  indent?: number;
  fill?: string;
  align?: "left" | "center" | "right";
  /** A line along the top of the cell. */
  top?: true;
  /** From the table's style: the font colour and the lines around the cell. */
  color?: string;
  border?: CellBorders;
  /** Looks you gave the cell (`Pivot.formats`), drawn over the table's own. */
  given?: CellStyle;
  /** From a style of your own. */
  italic?: true;
  underline?: true;
  strike?: true;
  fontFamily?: string;
  fontSize?: number;
}

/** A row or a column of the body: an item, a subtotal of the items before it, the grand total, or an empty line between items. */
export interface PivotEntry {
  kind: "item" | "subtotal" | "grand" | "blank";
  /** The items down to this one, outermost first. */
  path: PivotItem[];
  /** For an item with others inside it: whether it carries their subtotal. */
  sums: boolean;
}

/** A line of the body: an entry (an index into `rowEntries`; null for an empty line), and the value it shows when the values run down the rows. */
export interface PivotLine {
  entry: number | null;
  value?: number;
}

export interface PivotRender {
  height: number;
  width: number;
  cells: (PivotCell | undefined)[][];
  /** The row (from the top of the pivot table) the body starts on: below the filters. */
  bodyTop: number;
  /** Rows of headings in the body, and columns of row labels. */
  headerRows: number;
  labelCols: number;
  rowEntries: PivotEntry[];
  colEntries: PivotEntry[];
  /** The lines of the body, top to bottom. */
  lines: PivotLine[];
  /** Whether the values run down the rows. */
  valuesOnRows: boolean;
  /** The records that count in the table, with the row and column items each falls under. */
  counted: { at: number; rows: PivotItem[]; cols: PivotItem[] }[];
  /** Headings of the values, in order. */
  valueNames: string[];
  functions: PivotFunction[];
}

const HEADER_FILL = "#dce6f1";

interface Node {
  item: PivotItem;
  children: Map<string, Node>;
}

function tree(paths: PivotItem[][]): Map<string, Node> {
  const root = new Map<string, Node>();
  for (const path of paths) {
    let level = root;
    for (const item of path) {
      let node = level.get(item.key);
      if (!node) level.set(item.key, (node = { item, children: new Map() }));
      level = node.children;
    }
  }
  return root;
}

type NodeValue = (path: PivotItem[], by: number) => number | ErrorCode | undefined;

function entriesOf(root: Map<string, Node>, fields: PivotAxisField[], subtotalBelow: boolean, grand: boolean, blanks: boolean, nodeValue: NodeValue): PivotEntry[] {
  const out: PivotEntry[] = [];
  const last = fields.length - 1;
  const walk = (level: Map<string, Node>, path: PivotItem[], depth: number) => {
    const field = fields[depth]!;
    const sorted = (a: Node, b: Node): number => {
      if (field.sortBy) {
        const va = nodeValue([...path, a.item], field.sortBy.value);
        const vb = nodeValue([...path, b.item], field.sortBy.value);
        const na = typeof va === "number";
        const nb = typeof vb === "number";
        if (na && nb && va !== vb) return field.sortBy.descending ? vb - va : va - vb;
        if (na !== nb) return na ? -1 : 1;
      }
      return manual(field.order, (x, y) => compareItem(x, y, !!field.descending))(a.item, b.item);
    };
    const nodes = [...level.values()].sort(sorted);
    for (const node of nodes) {
      const p = [...path, node.item];
      if (depth === last) out.push({ kind: "item", path: p, sums: true });
      else if (!subtotalBelow) {
        out.push({ kind: "item", path: p, sums: field.subtotal !== false });
        walk(node.children, p, depth + 1);
      } else {
        walk(node.children, p, depth + 1);
        if (field.subtotal !== false) out.push({ kind: "subtotal", path: p, sums: true });
      }
      if (blanks && field.blankRow) out.push({ kind: "blank", path: p, sums: false });
    }
  };
  if (fields.length) walk(root, [], 0);
  if (grand || !fields.length) out.push({ kind: "grand", path: [], sums: true });
  return out;
}

const SEP = "\u0000";
const pathKey = (path: readonly PivotItem[], depth = path.length) => path.slice(0, depth).map((i) => i.key).join(SEP);

/**
 * The siblings of each item of an axis, for a comparison along the field at `depth` (1 is the outermost): the items that
 * differ from it only in that field, in order. Items outside that field (outer items, subtotals, the grand total) have none.
 */
function siblingsOf(entries: PivotEntry[], depth: number): ({ group: number[]; at: number } | undefined)[] {
  const groups = new Map<string, number[]>();
  const out: ({ group: number[]; at: number } | undefined)[] = entries.map(() => undefined);
  entries.forEach((e, i) => {
    if (e.kind !== "item" || e.path.length < depth || depth === 0) return;
    const key = `${e.path.length}${SEP}${e.path.map((it, x) => (x === depth - 1 ? "*" : it.key)).join(SEP)}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = []));
    out[i] = { group, at: group.length };
    group.push(i);
  });
  return out;
}

interface Rec {
  /** Where the record is in the source's records. */
  at: number;
  rec: Value[];
  rp: PivotItem[];
  cp: PivotItem[];
  /** Keys of every prefix of the record's row path and column path (the first is the empty path). */
  rk: string[];
  ck: string[];
}

/** Works out the cells of a pivot table from its records. */
export function renderPivot(p: Pivot, src: PivotSource): PivotRender {
  const index = (name: string) => src.fields.indexOf(name);
  const calcs = new Map((p.calculated ?? []).map((c) => [c.name.toLowerCase(), parseCalculated(c.formula)]));
  const calcOf = (v: PivotValue): Compiled | undefined => (index(v.field) < 0 ? calcs.get(v.field.toLowerCase()) : undefined);
  const measureOf = (v: PivotValue): CompiledMeasure | undefined => (index(v.field) < 0 ? src.measures?.get(v.field.toLowerCase()) : undefined);
  const fn = p.values.map((v) => (calcOf(v) || measureOf(v) ? ("sum" as PivotFunction) : valueFunction(v, src)));
  const names = p.values.map((v, i) => (measureOf(v) ? measureHeading(v) : valueName(v, fn[i]!)));
  const n = p.rows.length;
  const m = p.columns.length;
  const k = p.values.length;
  const sideBySide = !!(p.tabular || p.outline);
  const onRows = !!p.valuesOnRows && k > 1;

  // One accumulator for each source field a value (or a calculated field) reads.
  const slotOf = new Map<number, number>();
  const slotFields: number[] = [];
  const slotDistinct: boolean[] = [];
  const slot = (at: number, distinct = false) => {
    if (at < 0) return;
    if (!slotOf.has(at)) {
      slotOf.set(at, slotFields.length);
      slotFields.push(at);
      slotDistinct.push(false);
    }
    if (distinct) slotDistinct[slotOf.get(at)!] = true;
  };
  p.values.forEach((v, i) => {
    const c = calcOf(v);
    const meas = measureOf(v);
    if (c) c.refs.forEach((r) => slot(index(r)));
    else if (meas) meas.refs.forEach((r) => slot(index(r.field), r.fn === "distinctCount"));
    else slot(index(v.field), fn[i] === "distinctCount");
  });
  /** The filters of a cell, for measures that work in them: set while a cell is worked out. */
  let cellPath: { rp: readonly PivotItem[]; cp: readonly PivotItem[] } | null = null;
  const raw = (accs: Acc[] | undefined, v: number): number | ErrorCode | undefined => {
    if (!accs) return undefined;
    const meas = measureOf(p.values[v]!);
    if (meas?.ctx) return cellPath && src.model ? meas.ctx.evaluate(contextOf(cellPath.rp, cellPath.cp)) : undefined;
    if (meas) {
      return meas.run((ref) => {
        const a = accs[slotOf.get(index(ref.field)) ?? -1];
        return a ? sumUp(a, ref.fn) : undefined;
      });
    }
    const c = calcOf(p.values[v]!);
    if (c) {
      return c.run((name) => {
        const a = accs[slotOf.get(index(name)) ?? -1];
        return a ? sumUp(a, "sum") : undefined;
      });
    }
    return sumUp(accs[slotOf.get(index(p.values[v]!.field))!], fn[v]!);
  };

  // The item each record has in each row and column field.
  const rowMake = p.rows.map((f) => itemMaker(src, f.field, f.group));
  const colMake = p.columns.map((f) => itemMaker(src, f.field, f.group));
  const filterAt = (p.filters ?? []).map((f) => ({ make: itemMaker(src, f.field), allow: new Set(f.items) }));
  /** What a cell filters, for measures that work in the filters of a cell: the table's own filters, and the items of the row and column. */
  const contextOf = (rp: readonly PivotItem[], cp: readonly PivotItem[]) => {
    const base: ContextPred[] = (p.filters ?? []).map((f) => {
      const make = itemMaker(src, f.field);
      const allow = new Set(f.items);
      return { field: f.field, test: (rec: Value[]) => allow.has(make(rec).label) };
    });
    for (const t of p.timelines ?? []) {
      if (t.start === undefined && t.end === undefined) continue;
      const at = index(t.field);
      if (at < 0) continue;
      const from = t.start ?? -Infinity;
      const to = t.end ?? Infinity;
      base.push({ field: t.field, test: (rec) => typeof rec[at] === "number" && Math.floor(rec[at] as number) >= from && Math.floor(rec[at] as number) <= to });
    }
    const axis = (fields: PivotAxisField[], path: readonly PivotItem[]): ContextPred[] => {
      const out: ContextPred[] = [];
      fields.forEach((f, d) => {
        const make = itemMaker(src, f.field, f.group);
        if (f.hidden?.length) {
          const gone = new Set(f.hidden);
          base.push({ field: f.field, test: (rec) => !gone.has(make(rec).label) });
        }
        const item = path[d];
        if (item && !item.calc) out.push({ field: f.field, test: (rec) => make(rec).key === item.key });
      });
      return out;
    };
    const cell = [...axis(p.rows, rp), ...axis(p.columns, cp)];
    return { data: src.model!, base, cell, today: src.today ?? 25569 + Date.now() / 86400000 };
  };
  // Items can be worked out from others of their field; the items such a field leaves out are still read by those formulas.
  const calcItems = p.calculatedItems ?? [];
  const calcOnAxis = (f: PivotAxisField) => calcItems.filter((c) => c.field.toLowerCase() === f.field.toLowerCase());
  const calcRows = p.rows.map((f) => calcOnAxis(f).map((c) => ({ ...c, run: parseCalculated(c.formula) })));
  const calcCols = p.columns.map((f) => calcOnAxis(f).map((c) => ({ ...c, run: parseCalculated(c.formula) })));
  const hiddenRow = p.rows.map((f, d) => new Set(calcRows[d]!.length ? [] : (f.hidden ?? [])));
  const hiddenCol = p.columns.map((f, d) => new Set(calcCols[d]!.length ? [] : (f.hidden ?? [])));
  const softRow = p.rows.map((f, d) => new Set(calcRows[d]!.length ? (f.hidden ?? []) : []));
  const softCol = p.columns.map((f, d) => new Set(calcCols[d]!.length ? (f.hidden ?? []) : []));
  const today = Math.floor(src.today ?? 25569 + Date.now() / 86400000);
  const timelines = (p.timelines ?? []).filter((t) => t.start !== undefined || t.end !== undefined).map((t) => ({ at: index(t.field), from: t.start ?? -Infinity, to: t.end ?? Infinity }));
  let live: Rec[] = [];
  let soft = false;
  const softOf = new Set<Rec>();
  for (const [at, rec] of src.records.entries()) {
    if (!filterAt.every((f) => f.allow.has(f.make(rec).label))) continue;
    if (!timelines.every((t) => typeof rec[t.at] === "number" && Math.floor(rec[t.at] as number) >= t.from && Math.floor(rec[t.at] as number) <= t.to)) continue;
    const rp = rowMake.map((make) => make(rec));
    const cp = colMake.map((make) => make(rec));
    if (rp.some((it, d) => hiddenRow[d]!.has(it.label)) || cp.some((it, d) => hiddenCol[d]!.has(it.label))) continue;
    const rk = [""];
    for (let i = 0; i < rp.length; i++) rk.push(pathKey(rp, i + 1));
    const ck = [""];
    for (let j = 0; j < cp.length; j++) ck.push(pathKey(cp, j + 1));
    const r: Rec = { at, rec, rp, cp, rk, ck };
    if (rp.some((it, d) => softRow[d]!.has(it.label)) || cp.some((it, d) => softCol[d]!.has(it.label))) {
      softOf.add(r);
      soft = true;
    }
    live.push(r);
  }
  // The records a calculated item reads: those the table's other settings let through, whether or not the items it uses are shown.
  let refLive: Rec[] = live;
  if (soft) live = live.filter((r) => !softOf.has(r));
  const narrow = (keep: (r: Rec) => boolean) => {
    live = live.filter(keep);
    if (soft) refLive = refLive.filter(keep);
    else refLive = live;
  };

  const cellKey = (rk: string, ck: string) => `${rk}\u0001${ck}`;
  const build = (list: readonly Rec[]): Map<string, Acc[]> => {
    const totals = new Map<string, Acc[]>();
    for (const r of list) {
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= m; j++) {
          const key = cellKey(r.rk[i]!, r.ck[j]!);
          let accs = totals.get(key);
          if (!accs) totals.set(key, (accs = slotFields.map((_, s) => fresh(slotDistinct[s]))));
          for (let s = 0; s < slotFields.length; s++) add(accs[s]!, r.rec[slotFields[s]!] ?? null);
        }
      }
    }
    return totals;
  };

  // Filters on the items: by their text first, then (as the records left decide) by what they come to.
  const testOf = (f: Extract<PivotFieldFilter, { kind: "label" | "value" }>) => criterionTest({ kind: "custom", a: f.a, ...(f.b ? { b: f.b } : {}), ...(f.or ? { or: true as const } : {}) }, [], 0);
  const axes = [...p.rows.map((f, d) => ({ f, d, row: true })), ...p.columns.map((f, d) => ({ f, d, row: false }))].flatMap((a) => fieldFilters(a.f).map((filter) => ({ ...a, filter })));
  for (const { d, row, filter } of axes) {
    if (filter.kind !== "date") continue;
    const period = filter.period;
    narrow((r) => {
      const v = (row ? r.rp : r.cp)[d]!.v;
      return typeof v === "number" && inFilterPeriod(period, Math.floor(v), today);
    });
  }
  for (const { d, row, filter } of axes) {
    if (filter.kind !== "label") continue;
    const test = testOf(filter);
    narrow((r) => {
      const item = (row ? r.rp : r.cp)[d]!;
      return test({ value: item.v, text: item.label });
    });
  }
  for (const { f, filter } of axes) {
    if (filter.kind !== "color") continue;
    const want = filter;
    const test = criterionTest({ kind: "color", ...(want.fill !== undefined ? { fill: want.fill } : { font: want.font! }) }, [], 0);
    const col = index(f.field);
    narrow((r) => {
      const look = src.looks?.[r.at]?.[col];
      return test({ value: r.rec[col] ?? null, text: "", fill: look?.fill, font: look?.font });
    });
  }
  for (const { d, row, filter } of axes) {
    if (filter.kind === "label" || filter.kind === "date" || filter.kind === "color") continue;
    const totals = build(live);
    const keyOf = (r: Rec) => (row ? r.rk[d + 1]! : r.ck[d + 1]!);
    const parentOf = (r: Rec) => (row ? r.rk[d]! : r.ck[d]!);
    const groups = new Map<string, Map<string, number | ErrorCode | undefined>>();
    for (const r of live) {
      const key = keyOf(r);
      const parent = parentOf(r);
      let group = groups.get(parent);
      if (!group) groups.set(parent, (group = new Map()));
      if (!group.has(key)) {
        cellPath = row ? { rp: r.rp.slice(0, d + 1), cp: [] } : { rp: [], cp: r.cp.slice(0, d + 1) };
        group.set(key, raw(totals.get(row ? cellKey(key, "") : cellKey("", key)), filter.by));
        cellPath = null;
      }
    }
    const allowed = new Set<string>();
    for (const group of groups.values()) {
      if (filter.kind === "value") {
        const test = testOf(filter);
        for (const [key, value] of group) if (test({ value: value ?? null, text: value === undefined ? "" : String(value) })) allowed.add(key);
      } else {
        const ranked = [...group].filter((e): e is [string, number] => typeof e[1] === "number").sort((a, b) => (filter.bottom ? a[1] - b[1] : b[1] - a[1]));
        if (filter.unit === "percent" || filter.unit === "sum") {
          const whole = ranked.reduce((a, e) => a + Math.max(e[1], 0), 0);
          const goal = filter.unit === "percent" ? (whole * filter.n) / 100 : filter.n;
          let sum = 0;
          for (const [key, value] of ranked) {
            if (sum >= goal && allowed.size >= 1 && sum > 0) break;
            allowed.add(key);
            sum += value;
          }
        } else for (const [key] of ranked.slice(0, filter.n)) allowed.add(key);
      }
    }
    live = live.filter((r) => allowed.has(keyOf(r)));
    if (!soft) refLive = live;
  }

  const totals = build(live);
  // Where each item's inner items are, by the items before it: what a total over a field with calculated items adds up.
  const kidsOf = (root: Map<string, Node>): Map<string, Map<string, Node>> => {
    const out = new Map<string, Map<string, Node>>();
    const walk = (level: Map<string, Node>, path: PivotItem[]) => {
      out.set(pathKey(path), level);
      for (const node of level.values()) walk(node.children, [...path, node.item]);
    };
    walk(root, []);
    return out;
  };
  const rowTree = tree(live.map((r) => r.rp));
  const colTree = tree(live.map((r) => r.cp));
  const refRowTree = soft ? tree(refLive.map((r) => r.rp)) : rowTree;
  const refColTree = soft ? tree(refLive.map((r) => r.cp)) : colTree;
  interface World {
    totals: Map<string, Acc[]>;
    rowKids: Map<string, Map<string, Node>>;
    colKids: Map<string, Map<string, Node>>;
    /** Reading what calculated items use: nothing is added up from inner items. */
    ref: boolean;
  }
  const world: World = { totals, rowKids: kidsOf(rowTree), colKids: kidsOf(colTree), ref: false };
  const refWorld: World = soft ? { totals: build(refLive), rowKids: kidsOf(refRowTree), colKids: kidsOf(refColTree), ref: true } : { ...world, ref: true };
  // The items of each row and column field as the records have them, for a formula to find the items it names.
  const fieldAll = (list: Rec[], rowSide: boolean, d: number): Map<string, PivotItem> => {
    const out = new Map<string, PivotItem>();
    for (const r of list) {
      const it = (rowSide ? r.rp : r.cp)[d]!;
      if (!out.has(it.label.toLowerCase())) out.set(it.label.toLowerCase(), it);
    }
    return out;
  };
  const refItems = { rows: p.rows.map((_, d) => (calcRows[d]!.length ? fieldAll(refLive, true, d) : new Map<string, PivotItem>())), cols: p.columns.map((_, d) => (calcCols[d]!.length ? fieldAll(refLive, false, d) : new Map<string, PivotItem>())) };
  const calcItemOf = (c: { name: string }): PivotItem => ({ key: `ci:${c.name.toLowerCase()}`, v: c.name, label: c.name, calc: true });
  const calcFrom = (list: typeof calcRows, from: number) => list.slice(from).some((l) => l.length > 0);
  const additive = (v: number) => fn[v] === "sum" || fn[v] === "count" || fn[v] === "countNums";
  const sumUpValues = (list: (number | ErrorCode | undefined)[]): number | ErrorCode | undefined => {
    let sum: number | undefined;
    for (const x of list) {
      if (typeof x === "string") return x;
      if (x !== undefined) sum = (sum ?? 0) + x;
    }
    return sum;
  };
  /** What a cell comes to: the path of items down the rows and along the columns, either of which may stop short (a total) or include calculated items. */
  const cellValue = (w: World, rp: PivotItem[], cp: PivotItem[], v: number): number | ErrorCode | undefined => {
    for (const rowSide of [true, false]) {
      const path = rowSide ? rp : cp;
      const d = path.findIndex((it) => it.calc);
      if (d < 0) continue;
      const list = (rowSide ? calcRows : calcCols)[d]!;
      const c = list.find((x) => `ci:${x.name.toLowerCase()}` === path[d]!.key);
      if (!c) return undefined;
      const names = (rowSide ? refItems.rows : refItems.cols)[d]!;
      let missing = false;
      const used: (number | ErrorCode | undefined)[] = [];
      const result = c.run.run((name) => {
        const target = names.get(name.toLowerCase());
        if (!target) {
          missing = true;
          return undefined;
        }
        const swapped = path.map((it, x) => (x === d ? target : it));
        const x = cellValue(refWorld, rowSide ? swapped : rp, rowSide ? cp : swapped, v);
        used.push(x);
        return x;
      });
      if (missing) return "#REF!";
      return used.every((x) => x === undefined) ? undefined : result;
    }
    if (!w.ref && additive(v)) {
      for (const rowSide of [true, false]) {
        const path = rowSide ? rp : cp;
        const lists = rowSide ? calcRows : calcCols;
        if (!calcFrom(lists, path.length)) continue;
        const kids = [...((rowSide ? w.rowKids : w.colKids).get(pathKey(path))?.values() ?? [])].map((nd) => nd.item);
        const mine = (lists[path.length] ?? []).filter((c) => !(rowSide ? p.rows : p.columns)[path.length]!.hidden?.includes(c.name)).map(calcItemOf);
        return sumUpValues([...kids, ...mine].map((it) => cellValue(w, rowSide ? [...rp, it] : rp, rowSide ? cp : [...cp, it], v)));
      }
    }
    cellPath = { rp, cp };
    const result = raw(w.totals.get(cellKey(pathKey(rp), pathKey(cp))), v);
    cellPath = null;
    return result;
  };
  const nodeValue = (axisRow: boolean): NodeValue => (path, by) => (axisRow ? cellValue(world, path, [], by) : cellValue(world, [], path, by));

  /** The tree of items with the calculated ones in it: they are inside every item of the field before theirs, with the inner items of the items they use. */
  const withCalc = (level: Map<string, Node>, lists: typeof calcRows, hidden: readonly (readonly string[] | undefined)[], d: number): Map<string, Node> => {
    if (!calcFrom(lists, d)) return level;
    const merge = (maps: Map<string, Node>[]): Map<string, Node> => {
      const out = new Map<string, Node>();
      for (const m of maps) {
        for (const [key, nd] of m) {
          const got = out.get(key);
          if (got) got.children = merge([got.children, nd.children]);
          else out.set(key, { item: nd.item, children: nd.children });
        }
      }
      return out;
    };
    const out = new Map<string, Node>();
    for (const [key, nd] of level) out.set(key, { item: nd.item, children: withCalc(nd.children, lists, hidden, d + 1) });
    for (const c of lists[d] ?? []) {
      if (hidden[d]?.includes(c.name)) continue;
      const used = new Set(c.run.refs.map((r) => r.toLowerCase()));
      const kids = [...level.values()].filter((nd) => used.has(nd.item.label.toLowerCase())).map((nd) => nd.children);
      const item = calcItemOf(c);
      out.set(item.key, { item, children: withCalc(merge(kids), lists, hidden, d + 1) });
    }
    return out;
  };
  const rowEntries = entriesOf(withCalc(rowTree, calcRows, p.rows.map((f) => f.hidden), 0), p.rows, !!p.tabular, p.grandTotalRows !== false, true, nodeValue(true));
  const colEntries = entriesOf(withCalc(colTree, calcCols, p.columns.map((f) => f.hidden), 0), p.columns, true, p.grandTotalColumns !== false, false, nodeValue(false));
  const all: PivotEntry = { kind: "grand", path: [], sums: true };

  const labelCols = sideBySide ? Math.max(n, 1) + (onRows ? 1 : 0) : 1;
  const sub = onRows ? 1 : Math.max(k, 1);
  const dataCols = k ? colEntries.length * sub : 0;
  // Several values and no column fields: Excel puts a "Values" caption over the value headings.
  const valuesCaption = m === 0 && k > 1 && !onRows;
  const headerRows = m === 0 ? (valuesCaption ? 2 : 1) : 1 + m + (k > 1 && !onRows ? 1 : 0);
  const filters = (p.filters ?? []).filter((f) => !f.hidden);
  const bodyTop = filters.length ? filters.length + 1 : 0;
  const width = Math.max(labelCols + dataCols, filters.length ? 2 : 0);

  // The lines of the body.
  const lines: PivotLine[] = [];
  rowEntries.forEach((entry, ri) => {
    if (entry.kind === "blank") {
      lines.push({ entry: null });
      return;
    }
    if (!onRows || (entry.kind === "item" && !entry.sums)) {
      lines.push({ entry: ri });
      return;
    }
    if (!sideBySide && entry.kind !== "grand") lines.push({ entry: ri });
    for (let v = 0; v < k; v++) lines.push({ entry: ri, value: v });
  });
  const height = bodyTop + headerRows + lines.length;
  const cells: (PivotCell | undefined)[][] = Array.from({ length: height }, () => new Array<PivotCell | undefined>(width).fill(undefined));
  const put = (r: number, c: number, cell: PivotCell) => {
    cells[r]![c] = cell;
  };

  filters.forEach((f, i) => {
    put(i, 0, { v: f.field, bold: true });
    const everything = fieldItems(src, f.field).map((x) => x.label);
    const shown = everything.filter((l) => f.items.includes(l));
    put(i, 1, { v: shown.length === everything.length ? "(All)" : shown.length === 1 ? shown[0]! : "(Multiple Items)" });
  });

  // Headings.
  const top = bodyTop;
  const head = (r: number, c: number, cell: PivotCell) => put(top + r, c, { bold: true, fill: HEADER_FILL, ...cell });
  const lastHead = headerRows - 1;
  for (let c = 0; c < width; c++) for (let r = 0; r < headerRows; r++) if (c < labelCols + dataCols) head(r, c, {});
  if (n > 0 || sideBySide) {
    if (sideBySide) {
      p.rows.forEach((f, i) => head(lastHead, i, { v: axisHeading(f) }));
      if (onRows) head(lastHead, Math.max(n, 1), { v: "Values" });
    } else head(lastHead, 0, { v: "Row Labels" });
  }
  if (valuesCaption) head(0, labelCols, { v: "Values" });
  if (m > 0 && k === 1) head(0, 0, { v: names[0]! });
  if (m > 0) head(0, labelCols, { v: sideBySide ? axisHeading(p.columns[0]!) : "Column Labels" });
  const colFormat = (f: number) => (p.columns[f]!.group ? undefined : src.formats[index(p.columns[f]!.field)]);
  colEntries.forEach((entry, ci) => {
    const prev = colEntries[ci - 1];
    const first = (f: number) => !prev || prev.kind !== "item" || prev.path.length <= f || pathKey(prev.path, f + 1) !== pathKey(entry.path, f + 1);
    for (let j = 0; j < sub; j++) {
      const c = labelCols + ci * sub + j;
      if (m === 0) {
        if (k) head(lastHead, c, { v: onRows ? "Total" : names[j]!, align: "right" });
        continue;
      }
      for (let f = 0; f < m; f++) {
        let text: string | undefined;
        if (entry.kind === "grand") text = f === 0 && j === 0 ? "Grand Total" : undefined;
        else if (entry.kind === "subtotal") text = f === entry.path.length - 1 && j === 0 ? `${entry.path[f]!.label} Total` : undefined;
        else if (f < entry.path.length && j === 0 && first(f)) {
          const item = entry.path[f]!;
          text = item.label;
          if (typeof item.v === "number" && !p.columns[f]!.group) {
            const fmt = colFormat(f);
            head(1 + f, c, { v: item.v, ...(fmt ? { fmt } : {}), align: "left" });
            continue;
          }
        }
        if (text !== undefined) head(1 + f, c, { v: text, align: "left" });
      }
      if (k > 1 && !onRows) head(1 + m, c, { v: names[j]!, align: "right" });
    }
  });

  // What a cell comes to, shown as the value says to.
  const baseCols = m > 0;
  // A comparison runs along the field its value names, or the innermost column field (the innermost row field with no columns).
  const siblingCache = new Map<string, ({ group: number[]; at: number } | undefined)[]>();
  const alongOf = (spec: PivotValue): { cols: boolean; depth: number } => {
    const named = spec.base?.field;
    if (named !== undefined) {
      const ci = p.columns.findIndex((f) => f.field === named);
      if (ci >= 0) return { cols: true, depth: ci + 1 };
      const ri = p.rows.findIndex((f) => f.field === named);
      if (ri >= 0) return { cols: false, depth: ri + 1 };
    }
    return baseCols ? { cols: true, depth: m } : { cols: false, depth: n };
  };
  const siblingsFor = (cols: boolean, depth: number) => {
    const key = `${cols}${depth}`;
    let found = siblingCache.get(key);
    if (!found) siblingCache.set(key, (found = siblingsOf(cols ? colEntries : rowEntries, depth)));
    return found;
  };
  const asNumber = (x: number | ErrorCode | undefined): number | ErrorCode | undefined => x;
  const rawAt = (row: PivotEntry, col: PivotEntry, v: number) => cellValue(world, row.path, col.path, v);
  const share = (d: number | ErrorCode | undefined, whole: number | ErrorCode | undefined) => {
    if (d === undefined) return undefined;
    if (typeof d === "string") return d;
    if (typeof whole === "string") return whole;
    return !whole ? ("#DIV/0!" as ErrorCode) : d / whole;
  };
  const parent = (e: PivotEntry): PivotEntry => (e.kind === "grand" || e.path.length <= 1 ? all : { kind: "item", path: e.path.slice(0, -1), sums: true });
  const shown = (row: PivotEntry, col: PivotEntry, ri: number, ci: number, v: number): { value: number | ErrorCode | undefined; fmt?: string } => {
    const spec = p.values[v]!;
    const result = rawAt(row, col, v);
    // Comparing and adding up along a field count an empty cell as zero, as Excel does; the other choices leave it empty.
    const fillsEmpty = spec.showAs === "differenceFromPrevious" || spec.showAs === "percentDifferenceFromPrevious" || spec.showAs === "differenceFrom" || spec.showAs === "percentDifferenceFrom" || spec.showAs === "percentOf" || spec.showAs === "runningTotal" || spec.showAs === "percentRunningTotal";
    if (!spec.showAs || (result === undefined && !fillsEmpty)) return { value: result };
    switch (spec.showAs) {
      case "percentOfTotal":
        return { value: share(result, rawAt(all, all, v)), fmt: "0.00%" };
      case "percentOfRow":
        return { value: share(result, rawAt(row, all, v)), fmt: "0.00%" };
      case "percentOfColumn":
        return { value: share(result, rawAt(all, col, v)), fmt: "0.00%" };
      case "percentOfParentRow":
        return { value: share(result, rawAt(parent(row), col, v)), fmt: "0.00%" };
      case "percentOfParentColumn":
        return { value: share(result, rawAt(row, parent(col), v)), fmt: "0.00%" };
      case "index": {
        if (result === undefined) return { value: undefined };
        const grand = rawAt(all, all, v);
        const r = rawAt(row, all, v);
        const c = rawAt(all, col, v);
        if (typeof result === "string") return { value: result };
        if (typeof grand === "string") return { value: grand, fmt: "0.00" };
        if (typeof r === "string") return { value: r, fmt: "0.00" };
        if (typeof c === "string") return { value: c, fmt: "0.00" };
        return { value: !r || !c ? "#DIV/0!" : (result * (grand ?? 0)) / (r * c), fmt: "0.00" };
      }
      default: {
        // These run along a field: the one the value names, or the innermost field of the columns (of the rows with no columns).
        const { cols, depth } = alongOf(spec);
        const info = siblingsFor(cols, depth)[cols ? ci : ri];
        if (!info) return { value: undefined };
        const at = (i: number) => (cols ? rawAt(row, colEntries[i]!, v) : rawAt(rowEntries[i]!, col, v));
        // `at` is the cell compared with; it is empty (counts as zero) when the item is there but has no records.
        const compare = (kind: PivotShowAs, other: number | ErrorCode | undefined): { value: number | ErrorCode | undefined; fmt?: string } => {
          if (result === undefined && other === undefined) return { value: undefined };
          const own = result ?? 0;
          const base = other ?? 0;
          if (typeof own === "string") return { value: own };
          if (typeof base === "string") return { value: base };
          if (kind === "differenceFrom" || kind === "differenceFromPrevious") return { value: own - base };
          if (kind === "percentOf") return { value: base === 0 ? "#DIV/0!" : own / base, fmt: "0.00%" };
          return { value: base === 0 ? "#DIV/0!" : (own - base) / base, fmt: "0.00%" };
        };
        switch (spec.showAs) {
          case "differenceFromPrevious":
          case "percentDifferenceFromPrevious":
            // The first item has nothing before it.
            return info.at > 0 ? compare(spec.showAs, at(info.group[info.at - 1]!)) : { value: undefined };
          case "differenceFrom":
          case "percentDifferenceFrom":
          case "percentOf": {
            const item = spec.base?.item;
            let other: number | undefined;
            if (typeof item === "object") other = info.group[info.at + (item.step === "previous" ? -1 : 1)];
            else if (item !== undefined) other = info.group.find((i) => (cols ? colEntries[i]! : rowEntries[i]!).path[depth - 1]?.label === item);
            // The item compared with is blank (except in a share of itself).
            if (other === undefined || (other === info.group[info.at] && spec.showAs !== "percentOf")) return { value: undefined };
            return compare(spec.showAs, at(other));
          }
          case "runningTotal":
          case "percentRunningTotal": {
            let sum = 0;
            let whole = 0;
            for (let i = 0; i < info.group.length; i++) {
              const x = at(info.group[i]!);
              if (typeof x === "string") return { value: x };
              whole += x ?? 0;
              if (i <= info.at) sum = whole;
            }
            if (spec.showAs === "runningTotal") return { value: sum };
            return { value: whole === 0 ? "#DIV/0!" : sum / whole, fmt: "0.00%" };
          }
          default: {
            // rankAscending, rankDescending
            if (result === undefined) return { value: undefined };
            if (typeof result === "string") return { value: result };
            let place = 1;
            for (const i of info.group) {
              const x = at(i);
              if (typeof x === "number" && (spec.showAs === "rankAscending" ? x < result : x > result)) place++;
            }
            return { value: place };
          }
        }
      }
    }
  };
  void asNumber;

  // Rows.
  const sideValueCol = Math.max(n, 1);
  lines.forEach((line, li) => {
    const r = top + headerRows + li;
    if (line.entry === null) return;
    const ri = line.entry;
    const entry = rowEntries[ri]!;
    const outer = entry.kind === "item" && entry.sums && entry.path.length < n;
    const bold = entry.kind !== "item" || outer;
    let pi = ri - 1;
    while (pi >= 0 && rowEntries[pi]!.kind === "blank") pi--;
    const prev = rowEntries[pi];
    const first = (f: number) => !!p.repeatLabels || !prev || prev.kind !== "item" || pathKey(prev.path, f + 1) !== pathKey(entry.path, f + 1);
    const hasLabel = line.value === undefined || (sideBySide && line.value === 0);
    const valueLine = onRows && line.value !== undefined;
    const lineTop: Partial<PivotCell> = entry.kind === "grand" && (n > 0 || sideBySide) && (line.value === undefined || line.value === 0) ? { top: true } : {};
    if (valueLine && !sideBySide) {
      // Under the item's own line, the value's heading, one step in.
      put(r, 0, { v: entry.kind === "grand" ? `Total ${names[line.value!]}` : names[line.value!]!, align: "left", ...(entry.kind === "grand" ? { bold: true, ...lineTop } : { indent: entry.path.length }) });
    } else if (entry.kind === "grand") {
      if (hasLabel) {
        put(r, 0, { v: n === 0 ? "Total" : "Grand Total", bold: true, ...lineTop });
        for (let c = 1; c < Math.max(n, 1); c++) put(r, c, { bold: true, ...lineTop });
      }
      if (valueLine) put(r, sideValueCol, { v: names[line.value!]!, bold: true, align: "left", ...lineTop });
    } else if (!sideBySide) {
      const item = entry.path[entry.path.length - 1]!;
      const fmt = !p.rows[entry.path.length - 1]!.group && typeof item.v === "number" ? src.formats[index(p.rows[entry.path.length - 1]!.field)] : undefined;
      put(r, 0, { v: typeof item.v === "number" || typeof item.v === "boolean" ? (item.v as Scalar) : item.label, ...(fmt ? { fmt } : {}), align: "left", ...(entry.path.length > 1 ? { indent: entry.path.length - 1 } : {}), ...(bold ? { bold: true } : {}) });
    } else {
      if (hasLabel) {
        for (let f = 0; f < Math.max(n, 1); f++) {
          if (entry.kind === "subtotal") {
            if (f === entry.path.length - 1) put(r, f, { v: `${entry.path[f]!.label} Total`, bold: true, align: "left" });
            continue;
          }
          if (f < entry.path.length && first(f)) {
            const item = entry.path[f]!;
            const fmt = !p.rows[f]!.group && typeof item.v === "number" ? src.formats[index(p.rows[f]!.field)] : undefined;
            put(r, f, { v: typeof item.v === "number" ? item.v : item.label, ...(fmt ? { fmt } : {}), align: "left", ...(bold && entry.kind === "item" && f === entry.path.length - 1 ? { bold: true } : {}) });
          }
        }
      }
      if (valueLine) put(r, sideValueCol, { v: names[line.value!]!, align: "left", ...(bold ? { bold: true } : {}) });
    }
    if (!k || (entry.kind === "item" && !entry.sums)) return;
    if (onRows && line.value === undefined) return;
    colEntries.forEach((col, ci) => {
      for (let v = 0; v < k; v++) {
        if (onRows && v !== line.value) continue;
        const spec = p.values[v]!;
        const result = shown(entry, col, ri, ci, v);
        if (result.value === undefined) continue;
        const cell: PivotCell = typeof result.value === "string" ? { e: result.value as ErrorCode } : { v: result.value };
        const fmt = spec.fmt ?? result.fmt;
        if (fmt) cell.fmt = fmt;
        if (bold || (m > 0 && col.kind !== "item")) cell.bold = true;
        if (lineTop.top) cell.top = true;
        put(r, labelCols + ci * sub + (onRows ? 0 : v), cell);
      }
    });
  });
  if (p.style) applyStyle(p, cells, { bodyTop, headerRows, labelCols, dataCols, sub, lines, rowEntries, colEntries, height, width }, src.styles);
  if (p.formats?.length) applyFormats(p.formats, cells, geometryOf(p, { bodyTop, headerRows, labelCols, lines, rowEntries, colEntries, valuesOnRows: onRows, valueNames: names }), width);
  return { height, width, cells, bodyTop, headerRows, labelCols, rowEntries, colEntries, lines, valuesOnRows: onRows, counted: live.map((r) => ({ at: r.at, rows: r.rp, cols: r.cp })), valueNames: names, functions: fn };
}

/** Draws the table's style over its cells: the look it gives each part replaces the plain heading fill and bold. */
function applyStyle(p: Pivot, cells: (PivotCell | undefined)[][], g: { bodyTop: number; headerRows: number; labelCols: number; dataCols: number; sub: number; lines: PivotLine[]; rowEntries: PivotEntry[]; colEntries: PivotEntry[]; height: number; width: number }, styles?: Record<string, PivotStyleDef>): void {
  const style = p.style!;
  const custom = Object.entries(styles ?? {}).find(([name]) => name.toLowerCase() === style.name.toLowerCase())?.[1];
  const last = g.labelCols + g.dataCols - 1;
  const paint = (r: number, c: number, look: PivotLook) => {
    const old = cells[r]![c];
    const next: PivotCell = { ...(old ?? {}) };
    // The plain look gives way to the style's.
    delete next.fill;
    delete next.bold;
    delete next.top;
    if (look.fill) next.fill = look.fill;
    if (look.color) next.color = look.color;
    if (look.bold) next.bold = true;
    if (look.italic) next.italic = true;
    if (look.underline) next.underline = true;
    if (look.strike) next.strike = true;
    if (look.fontFamily) next.fontFamily = look.fontFamily;
    if (look.fontSize) next.fontSize = look.fontSize;
    if (look.border) next.border = look.border;
    if (old || Object.keys(next).length) cells[r]![c] = next;
  };
  if (custom && g.bodyTop > 0) {
    // The filters above the table: their names and what they let through.
    for (let r = 0; r < g.bodyTop - 1; r++) {
      for (let c = 0; c < Math.min(2, g.width); c++) {
        const spot = { r, c, bodyTop: g.bodyTop, headerRows: g.headerRows, labelCols: g.labelCols, last, height: g.height, line: 0, column: 0, lines: g.lines.length };
        paint(r, c, customLook(custom, style, { zone: c === 0 ? "pageLabel" : "pageValue" }, spot));
      }
    }
  }
  let bodyLine = 0;
  for (let r = g.bodyTop; r < g.height; r++) {
    const header = r - g.bodyTop < g.headerRows;
    const line = header ? undefined : g.lines[r - g.bodyTop - g.headerRows];
    if (!header && line?.entry === null) {
      // An empty line between items has no look of its own (a style of your own can give it one).
      if (custom) for (let c = 0; c <= Math.min(last, g.width - 1); c++) paint(r, c, blankLook(custom, r, c, { last, bodyTop: g.bodyTop, height: g.height }));
      bodyLine++;
      continue;
    }
    const entry = line && line.entry !== null ? g.rowEntries[line.entry] : undefined;
    for (let c = 0; c <= Math.min(last, g.width - 1); c++) {
      const label = c < g.labelCols;
      const col = !header && !label ? g.colEntries[Math.floor((c - g.labelCols) / g.sub)] : undefined;
      const role: PivotStyleRole = {
        zone: header ? "header" : label ? "label" : "body",
        ...(entry ? { row: entry.kind === "grand" ? ("grand" as const) : entry.kind === "subtotal" || (entry.kind === "item" && entry.sums && entry.path.length < p.rows.length) ? ("subtotal" as const) : ("item" as const) } : {}),
        ...(col ? { col: col.kind === "grand" && p.columns.length ? ("grand" as const) : col.kind === "subtotal" ? ("subtotal" as const) : ("item" as const) } : {}),
        line: bodyLine,
        column: label ? 0 : Math.floor((c - g.labelCols) / g.sub),
        top: r === g.bodyTop,
        bottom: r === g.height - 1,
        left: c === 0,
        right: c === last,
      };
      if (custom) {
        if (entry) role.rowDepth = entry.kind === "grand" ? 0 : entry.path.length;
        if (col) role.colDepth = col.kind === "grand" ? 0 : col.path.length;
        if (entry && label && entry.kind === "item" && entry.sums && entry.path.length < p.rows.length) role.subheading = true;
        const hr = r - g.bodyTop;
        if (header && p.columns.length > 1 && hr >= 1 && hr < p.columns.length) role.colHeadLevel = hr;
        if (header && c === 0) role.corner = "first";
        else if (header && c === last) role.corner = "last";
        const spot = { r, c, bodyTop: g.bodyTop, headerRows: g.headerRows, labelCols: g.labelCols, last, height: g.height, line: bodyLine, column: role.column ?? 0, lines: g.lines.length };
        paint(r, c, customLook(custom, style, role, spot));
      } else paint(r, c, pivotCellStyle(style, role));
    }
    if (!header) bodyLine++;
  }
}

/** The range a render covers when its top-left cell is at `anchor`. */
export function renderRange(anchor: string, r: Pick<PivotRender, "height" | "width">): Bounds {
  const at = parseCell(anchor)!;
  return { r1: at.row, c1: at.col, r2: at.row + r.height - 1, c2: at.col + r.width - 1 };
}

/** The pivot table that has this cell in the cells it is drawn in. */
export function pivotAt(sheet: Sheet, address: string): Pivot | undefined {
  const at = parseCell(address);
  if (!at) return undefined;
  return sheet.pivots?.find((p) => {
    const b = parseRange(p.range);
    return b && at.row >= b.r1 && at.row <= b.r2 && at.col >= b.c1 && at.col <= b.c2;
  });
}

// ---- looking a result up ----

/**
 * What a pivot table shows for a value and some of its items, as `GETPIVOTDATA` finds it: `pairs` name fields of the rows or
 * columns and one item of each. A field left out means its total. Null when the pivot table has no such value, field or item.
 */
export function pivotLookup(p: Pivot, src: PivotSource, render: PivotRender, dataField: string, pairs: readonly (readonly [string, Value])[]): PivotCell | null {
  const want = dataField.toLowerCase();
  const byName = render.valueNames.findIndex((name) => name.toLowerCase() === want);
  const v = byName >= 0 ? byName : p.values.findIndex((x) => x.field.toLowerCase() === want);
  if (v < 0) return null;
  // A field of the filters can be named too, if the item is one the pivot table lets through.
  for (const [field, item] of pairs) {
    const onAxis = [...p.rows, ...p.columns].some((f) => f.field.toLowerCase() === field.toLowerCase());
    const filter = (p.filters ?? []).find((f) => f.field.toLowerCase() === field.toLowerCase());
    if (onAxis) continue;
    if (!filter || !filter.items.some((label) => label.toLowerCase() === String(item).toLowerCase())) return null;
  }
  const find = (fields: readonly PivotAxisField[], entries: readonly PivotEntry[]): number => {
    const path: PivotItem[] = [];
    const chosen = new Map<string, Value>();
    for (const [field, item] of pairs) if (fields.some((f) => f.field.toLowerCase() === field.toLowerCase())) chosen.set(field.toLowerCase(), item);
    for (const f of fields) {
      const item = chosen.get(f.field.toLowerCase());
      if (item === undefined) break;
      const make = itemMaker(src, f.field, f.group);
      // The item that shows as the one asked for: by its text, or by its number.
      const match = src.records.map((rec) => make(rec)).find((it) => (typeof item === "number" && typeof it.v === "number" ? it.v === item : it.label.toLowerCase() === String(item).toLowerCase() || it.key === itemKey(item)));
      if (!match) return -1;
      path.push(match);
    }
    // Every field asked for must come in order from the outermost.
    if (chosen.size !== path.length) return -1;
    const key = pathKey(path);
    return entries.findIndex((e) => e.kind !== "blank" && e.path.length === path.length && pathKey(e.path) === key && (path.length === 0 ? e.kind === "grand" : e.kind === "subtotal" || (e.kind === "item" && (path.length === fields.length || e.sums))));
  };
  const ri = find(p.rows, render.rowEntries);
  const ci = find(p.columns, render.colEntries);
  if (ri < 0 || ci < 0) return null;
  const onRows = render.valuesOnRows;
  const li = render.lines.findIndex((l) => l.entry === ri && (onRows ? l.value === v : l.value === undefined));
  if (li < 0) return null;
  const sub = onRows ? 1 : Math.max(p.values.length, 1);
  return render.cells[render.bodyTop + render.headerRows + li]?.[render.labelCols + ci * sub + (onRows ? 0 : v)] ?? null;
}


// ---- the records behind a cell ----

/** The source records a cell of a pivot table adds up: the cell's place within the table says which. Null for a heading, a label or an empty cell. */
export function pivotDetails(render: PivotRender, src: PivotSource, row: number, col: number): { fields: string[]; records: Value[][]; rows: number[] } | null {
  const li = row - render.bodyTop - render.headerRows;
  const line = render.lines[li];
  if (!line || line.entry === null || col < render.labelCols) return null;
  const sub = render.valuesOnRows ? 1 : Math.max(render.valueNames.length, 1);
  const ci = Math.floor((col - render.labelCols) / sub);
  const rowEntry = render.rowEntries[line.entry];
  const colEntry = render.colEntries[ci];
  if (!rowEntry || !colEntry || !render.cells[row]?.[col]) return null;
  const rk = pathKey(rowEntry.path);
  const ck = pathKey(colEntry.path);
  const under = (path: PivotItem[], key: string) => key === "" || pathKey(path, key.split(SEP).length) === key;
  const hits = render.counted.filter((r) => under(r.rows, rk) && under(r.cols, ck));
  return { fields: src.fields, records: hits.map((r) => src.records[r.at]!), rows: hits.map((r) => src.rowAt?.[r.at] ?? r.at + 2) };
}
