import { attr, child, childrenNamed, createId, type XmlElement } from "@pli.dev/core";
import { colName, colNumber, parseRange, rangeAddress } from "./address";
import { cleanFilterView } from "./filterview";
import type { ConditionalStyle, FilterCriterion, FilterView, FilterViewTable, Sheet, Table } from "./model";
import { dataRows, hasHeader, tableColumns } from "./table";
import { filterColumnXml, readFilterColumn } from "./xlsx-filter";
import { dxfXml, readDxfs } from "./xlsx-format";

/*
 * Filter views in an .xlsx file. Excel has no filter views in a desktop file, but its sheet views (View > Sheet View, on the
 * web and in Microsoft 365) are the same thing: a name and, for each AutoFilter of the sheet, the filters on its columns and
 * the sort rules, kept in a part of their own: `xl/namedSheetViews/namedSheetViewN.xml`, reached by an implicit relationship
 * from the sheet ([MS-XLSX] 2.3.8, namespace .../spreadsheetml/2019/namedsheetviews).
 *
 *   <namedSheetViews>
 *     <namedSheetView name="Reds" id="{GUID}">
 *       <nsvFilter filterId="{uid of the sheet's autoFilter}" ref="A1:C6" tableId="0">
 *         <columnFilter colId="1"><filter colId="1"><x:filters><x:filter val="red"/></x:filters></filter></columnFilter>
 *         <sortRules><sortRule colId="2"><sortCondition ref="C2:C6" descending="1"/></sortRule></sortRules>
 *       </nsvFilter>
 *       <nsvFilter filterId="{uid of the table's autoFilter}" ref="E1:G6" tableId="1">…</nsvFilter>
 *     </namedSheetView>
 *   </namedSheetViews>
 *
 * An `nsvFilter` belongs to the AutoFilter of the sheet (`tableId` 0) or of a table (the table's id). Its columns are numbered
 * from the left of that AutoFilter; the filters themselves are the main namespace's `filterColumn` contents (prefix `x`).
 */

export const NSV_NS = "http://schemas.microsoft.com/office/spreadsheetml/2019/namedsheetviews";
export const NSV_REL = "http://schemas.microsoft.com/office/2019/04/relationships/namedSheetView";
export const NSV_CONTENT_TYPE = "application/vnd.ms-excel.namedsheetviews+xml";
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** A GUID worked out from a string, so the same workbook always writes the same ones. */
export function guidOf(seed: string): string {
  const parts: number[] = [];
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1);
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    parts.push(h >>> 0);
  }
  const hex = parts.map((n) => n.toString(16).padStart(8, "0")).join("");
  // Version 4, variant 1, as a GUID made of random numbers has them.
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16]!, 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}}`.toUpperCase();
}

/** The uid of the sheet's own AutoFilter and of a table's, which a view's filters name. */
export const sheetFilterUid = (sheet: Sheet) => guidOf(`filter:${sheet.id}`);
export const tableFilterUid = (table: Table) => guidOf(`table:${table.id}`);

const MAIN_ELEMENTS = /<(\/?)(filters|filter|customFilters|customFilter|top10|dynamicFilter|colorFilter|dateGroupItem)(?=[\s/>])/g;
const DXF_ELEMENTS = /<(\/?)(font|fill|patternFill|fgColor|bgColor|color|b|i|strike|u|sz|name)(?=[\s/>])/g;

/** The body of a `filterColumn` written for `filter` in a view: its elements are the main namespace's. */
function filterBody(colId: number, criterion: FilterCriterion): { body: string; dxf: string } {
  let dxf = "";
  const xml = filterColumnXml(colId, criterion, () => 0);
  const body = xml.replace(/^<filterColumn[^>]*>|<\/filterColumn>$/g, "");
  if (!Array.isArray(criterion) && criterion.kind === "color") {
    const look: string =
      criterion.fill !== undefined
        ? criterion.fill === "none"
          ? '<dxf><fill><patternFill patternType="none"/></fill></dxf>'
          : dxfXml({ fill: criterion.fill })
        : criterion.font === "auto"
          ? '<dxf><font><color auto="1"/></font></dxf>'
          : dxfXml({ color: criterion.font! });
    dxf = look.replace(DXF_ELEMENTS, "<$1x:$2");
  }
  return { body: body.replace(/ dxfId="\d+"/, "").replace(MAIN_ELEMENTS, "<$1x:$2"), dxf };
}

interface Target {
  /** The AutoFilter's range, and where its columns' names come from. */
  ref: string;
  filterId: string;
  tableId: number;
  /** Which column of the AutoFilter (from 0) a column of the view is, or -1. */
  index: (key: string) => number;
  dataTop: number;
  dataBottom: number;
  firstCol: number;
}

function filterXml(t: Target, filters: Record<string, FilterCriterion> | undefined, sort: { column: string; descending?: true } | undefined): string {
  const columns = Object.entries(filters ?? {})
    .map(([key, c]) => [t.index(key), c] as const)
    .filter(([at]) => at >= 0)
    .sort((a, b) => a[0] - b[0])
    .map(([at, c]) => {
      const { body, dxf } = filterBody(at, c);
      return `<columnFilter colId="${at}">${dxf}<filter colId="${at}">${body}</filter></columnFilter>`;
    })
    .join("");
  const at = sort ? t.index(sort.column) : -1;
  // Excel writes the sort's column over the whole filter range, header row included (it rewrote a file's data-only ranges so).
  const whole = parseRange(t.ref);
  const sorts = sort && at >= 0 ? `<sortRules><sortRule colId="${at}"><sortCondition${sort.descending ? ' descending="1"' : ""} ref="${rangeAddress({ r1: whole?.r1 ?? t.dataTop, r2: whole?.r2 ?? t.dataBottom, c1: t.firstCol + at, c2: t.firstCol + at })}"/></sortRule></sortRules>` : "";
  return `<nsvFilter filterId="${t.filterId}" ref="${t.ref}" tableId="${t.tableId}">${columns}${sorts}</nsvFilter>`;
}

/**
 * The part that holds a sheet's filter views, or null when it has none. `tableNumber` gives the number each table is written
 * with (its `id` in the file).
 */
export function namedSheetViewsXml(sheet: Sheet, tableNumber: ReadonlyMap<string, number>): string | null {
  if (!sheet.filterViews?.length) return null;
  const own = sheet.filter ? parseRange(sheet.filter.range)! : null;
  const views = sheet.filterViews.map((v) => {
    const targets: string[] = [];
    if (v.range) {
      // Columns are numbered from the left of the sheet's AutoFilter, which is what the file's reader measures from.
      const base = own ?? parseRange(v.range)!;
      const t: Target = {
        ref: rangeAddress(base),
        filterId: sheetFilterUid(sheet),
        tableId: 0,
        index: (key) => {
          const at = colNumber(key) - base.c1;
          return at >= 0 && at <= base.c2 - base.c1 ? at : -1;
        },
        dataTop: base.r1 + 1,
        dataBottom: base.r2,
        firstCol: base.c1,
      };
      targets.push(filterXml(t, v.columns, v.sort));
    }
    for (const table of sheet.tables ?? []) {
      const entry = v.tables?.[table.id];
      const n = tableNumber.get(table.id);
      if (!entry || n === undefined || !hasHeader(table) || table.filterButtons === false) continue;
      const b = parseRange(table.range)!;
      const names = tableColumns(sheet, b, table);
      const [top, bottom] = dataRows(table, b);
      const t: Target = {
        ref: rangeAddress({ ...b, r2: table.totals ? b.r2 - 1 : b.r2 }),
        filterId: tableFilterUid(table),
        tableId: n,
        index: (key) => names.indexOf(key),
        dataTop: top,
        dataBottom: bottom,
        firstCol: b.c1,
      };
      targets.push(filterXml(t, entry.filters, entry.sort));
    }
    return `<namedSheetView name="${esc(v.name)}" id="${guidOf(`view:${v.id}`)}">${targets.join("")}</namedSheetView>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<namedSheetViews xmlns="${NSV_NS}" xmlns:x="${MAIN}">${views.join("")}</namedSheetViews>`;
}

// ---- reading ----

export interface ViewReadContext {
  sheet: Sheet;
  /** The table a table part's `id` stands for, and its column names. */
  tableOf(id: number): Table | undefined;
  theme: readonly string[];
  warnings: Set<string>;
}

/** The `filter` element with its `columnFilter`'s own style in the place a colour filter looks for it. */
function withDxf(filter: XmlElement, column: XmlElement, theme: readonly string[]): { element: XmlElement; dxfs: ConditionalStyle[] } {
  const dxf = child(column, "dxf");
  if (!dxf) return { element: filter, dxfs: [] };
  const sheet: XmlElement = { name: "styleSheet", attrs: {}, children: [{ name: "dxfs", attrs: {}, children: [dxf] }] };
  const element: XmlElement = { ...filter, children: filter.children.map((c) => (typeof c !== "string" && c.name === "colorFilter" ? { ...c, attrs: { ...c.attrs, dxfId: "0" } } : c)) };
  return { element, dxfs: readDxfs(sheet, theme) };
}

/** The filter views a `namedSheetViews` part holds. What Pli can't keep is left out and named in `warnings`. */
export function readNamedSheetViews(root: XmlElement, ctx: ViewReadContext): FilterView[] {
  const { sheet, warnings } = ctx;
  const headed = (sheet.tables ?? []).filter(hasHeader);
  const out: FilterView[] = [];
  const names = new Set<string>();
  for (const nv of childrenNamed(root, "namedSheetView")) {
    if (out.length >= 100) {
      warnings.add("Only the first 100 sheet views of a sheet were kept");
      break;
    }
    let name = (attr(nv, "name") ?? "").trim().slice(0, 80);
    if (!name) continue;
    if (names.has(name.toLowerCase())) {
      let n = 2;
      while (names.has(`${name.slice(0, 76)} (${n})`.toLowerCase())) n++;
      name = `${name.slice(0, 76)} (${n})`;
    }
    const view: FilterView = { id: createId("view_"), name };
    const tables: Record<string, FilterViewTable> = {};
    for (const nf of childrenNamed(nv, "nsvFilter")) {
      const tableId = Number(attr(nf, "tableId") ?? 0);
      const filters: Record<string, FilterCriterion> = {};
      let sort: { column: string; descending?: true } | undefined;
      let keyOf: (colId: number) => string | undefined;
      let table: Table | undefined;
      if (tableId) {
        table = ctx.tableOf(tableId);
        if (!table || !hasHeader(table)) {
          warnings.add(`A sheet view named "${name}" has filters for a table Pli doesn't have, and they were left out`);
          continue;
        }
        const columns = tableColumns(sheet, parseRange(table.range)!, table);
        keyOf = (colId) => columns[colId];
      } else {
        let base = sheet.filter ? parseRange(sheet.filter.range) : null;
        if (!base) {
          // Excel drops a view's filter when the sheet has no AutoFilter for it; Pli's own files say where it was.
          const ref = parseRange((attr(nf, "ref") ?? "").replace(/\$/g, ""));
          if (ref && ref.r1 !== ref.r2) base = ref;
        }
        if (!base) {
          warnings.add(`A sheet view named "${name}" has filters for an AutoFilter Pli doesn't have, and they were left out`);
          continue;
        }
        view.range = rangeAddress(base);
        const b = base;
        keyOf = (colId) => (colId >= 0 && b.c1 + colId <= b.c2 ? colName(b.c1 + colId) : undefined);
      }
      for (const cf of childrenNamed(nf, "columnFilter")) {
        const colId = Number(attr(cf, "colId"));
        const filter = child(cf, "filter");
        const key = keyOf(colId);
        if (!filter || key === undefined) continue;
        const { element, dxfs } = withDxf(filter, cf, ctx.theme);
        const read = readFilterColumn(element, dxfs);
        if (typeof read === "string") warnings.add(`A filter in the sheet view "${name}" was left out because ${read}`);
        else if (read !== null) filters[key] = read;
      }
      const rules = childrenNamed(child(nf, "sortRules"), "sortRule");
      if (rules.length > 1) warnings.add(`The sheet view "${name}" sorts by several columns; only the first was kept`);
      const rule = rules[0];
      if (rule) {
        const condition = child(rule, "sortCondition");
        const key = keyOf(Number(attr(rule, "colId")));
        const by = attr(condition, "sortBy");
        if (!condition || key === undefined) warnings.add(`A sort in the sheet view "${name}" was left out because it isn't a sort by a column Pli knows`);
        else if ((by && by !== "value") || attr(condition, "customList")) warnings.add(`A sort in the sheet view "${name}" was left out because it sorts by colour, icon or a custom list`);
        else sort = { column: key, ...(attr(condition, "descending") === "1" || attr(condition, "descending") === "true" ? { descending: true as const } : {}) };
      }
      if (table) {
        const entry: FilterViewTable = {};
        if (Object.keys(filters).length) entry.filters = filters;
        if (sort) entry.sort = sort;
        if (entry.filters || entry.sort) tables[table.id] = { ...tables[table.id], ...entry };
      } else {
        if (Object.keys(filters).length) view.columns = filters;
        if (sort) view.sort = sort;
      }
    }
    // A view that names the AutoFilters it filters says the others are not filtered in it.
    if (headed.length) view.tables = tables;
    else if (Object.keys(tables).length) view.tables = tables;
    try {
      out.push(cleanFilterView(view));
      names.add(name.toLowerCase());
    } catch (e) {
      warnings.add(`The sheet view "${name}" was left out: ${(e as Error).message}`);
    }
  }
  return out;
}
