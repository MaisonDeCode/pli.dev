import { attr, child, childrenNamed, createId, elements, textOf, type XmlElement } from "@pli.dev/core";
import { cellAddress, parseRange, rangeAddress } from "./address";
import type { ConditionalStyle, FilterCriterion, Sheet, Table, TableStyleDef, TableStylePart } from "./model";
import { readTableStyleDxf } from "./xlsx-format";
import { filterColumnXml, readFilterColumn, type FilterDxf } from "./xlsx-filter";
import { cleanTableStyle, cleanTableStyleName } from "./tablestyle";
import { hasHeader, tableColumns } from "./table";
import { readSortState, sortStateXml } from "./xlsx-sort";

/*
 * Tables in an .xlsx file: a worksheet lists `tableParts`, each pointing at a part of its own that holds the name, the
 * range, the style and the totals row. The cells (header text, values, formulas) are in the sheet as usual.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** The function numbers `SUBTOTAL` takes, and the name a table's totals row gives them. */
const TOTALS: Record<number, string> = { 101: "average", 102: "countNums", 103: "count", 104: "max", 105: "min", 107: "stdDev", 109: "sum", 110: "var" };

/** One table as a `table` part. `n` is its number in the workbook; `file` writes a formula the way a file keeps it. */
export function tablePartXml(sheet: Sheet, table: Table, n: number, file: (f: string) => string, dxf: (look: FilterDxf) => number, uid?: string): string {
  const b = parseRange(table.range)!;
  const names = tableColumns(sheet, b, table);
  const headed = hasHeader(table);
  const columns = names.map((name, i) => {
    let extra = "";
    let body = "";
    if (table.totals) {
      const cell = sheet.cells[cellAddress(b.r2, b.c1 + i)];
      const f = cell?.f;
      const fn = f === undefined ? null : /^\s*SUBTOTAL\(\s*(\d+)\s*,/i.exec(f);
      if (f !== undefined && fn && TOTALS[Number(fn[1])] && new RegExp(`\\[${names[i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/(['#@\[\]])/g, "'?$1")}\\]\\)\\s*$`).test(f)) extra = ` totalsRowFunction="${TOTALS[Number(fn[1])]}"`;
      else if (f !== undefined) {
        extra = ' totalsRowFunction="custom"';
        body = `<totalsRowFormula>${esc(file(f))}</totalsRowFormula>`;
      } else if (typeof cell?.v === "string") extra = ` totalsRowLabel="${esc(cell.v)}"`;
    }
    const calc = table.calculated?.[name];
    if (calc !== undefined) body = `<calculatedColumnFormula>${esc(file(calc))}</calculatedColumnFormula>${body}`;
    return `<tableColumn id="${i + 1}" name="${esc(name)}"${extra}${body ? `>${body}</tableColumn>` : "/>"}`;
  });
  const filterRef = rangeAddress({ ...b, r2: table.totals ? b.r2 - 1 : b.r2 });
  const style =
    table.style === "none"
      ? ""
      : `<tableStyleInfo name="${esc(table.style ?? "TableStyleMedium2")}" showFirstColumn="${table.firstColumn ? 1 : 0}" showLastColumn="${table.lastColumn ? 1 : 0}" showRowStripes="${table.bandedRows === false ? 0 : 1}" showColumnStripes="${table.bandedColumns ? 1 : 0}"/>`;
  // Filter buttons are the table's `autoFilter` element, which holds what each filtered column lets through; a table with no header row has none.
  const buttons = headed && table.filterButtons !== false;
  const filtered = Object.entries(table.filters ?? {})
    .map(([name, criterion]) => [names.indexOf(name), criterion] as const)
    .filter(([at]) => at >= 0)
    .sort((a, c) => a[0] - c[0])
    .map(([at, criterion]) => filterColumnXml(at, criterion, dxf))
    .join("");
  const sort = sortStateXml(table.sort, names, { ...b, r1: b.r1 + (headed ? 1 : 0), r2: table.totals ? b.r2 - 1 : b.r2 }, dxf);
  // A filter view (Excel's named sheet view) finds the table's filter by this uid.
  const uidAttr = uid ? ` xr:uid="${uid}"` : "";
  const head = buttons ? (filtered || sort ? `<autoFilter ref="${filterRef}"${uidAttr}>${filtered}${sort}</autoFilter>` : `<autoFilter ref="${filterRef}"${uidAttr}/>`) : sort;
  const revision = uid ? ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"' : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${revision} id="${n}" name="${esc(table.name)}" displayName="${esc(table.name)}" ref="${table.range}"` +
    `${headed ? "" : ' headerRowCount="0"'}${table.totals ? ' totalsRowCount="1"' : ' totalsRowShown="0"'}>${head}<tableColumns count="${columns.length}">${columns.join("")}</tableColumns>${style}</table>`
  );
}

/** A `table` part as a table, or why it can't be one. */
export function readTablePart(root: XmlElement, warnings?: Set<string>, dxfs: readonly ConditionalStyle[] = []): { table: Table; columns: string[]; calculated: Record<string, string>; partId: number; columnIds: number[] } | string {
  const name = attr(root, "displayName") ?? attr(root, "name");
  const b = parseRange((attr(root, "ref") ?? "").replace(/\$/g, ""));
  if (!name || !b) return "its name or range is missing";
  const headed = attr(root, "headerRowCount") !== "0";
  const totals = Number(attr(root, "totalsRowCount") ?? 0) > 0;
  const table: Table = { id: createId("table_"), name, range: rangeAddress(b) };
  if (totals) table.totals = true;
  if (!headed) table.headerRow = false;
  const info = child(root, "tableStyleInfo");
  const style = attr(info, "name");
  table.style = info ? style ?? "TableStyleMedium2" : "none";
  if (table.style === "TableStyleMedium2") delete table.style;
  if (info) {
    const on = (a: string) => attr(info, a) === "1" || attr(info, a) === "true";
    if (attr(info, "showRowStripes") !== undefined && !on("showRowStripes")) table.bandedRows = false;
    if (on("showColumnStripes")) table.bandedColumns = true;
    if (on("showFirstColumn")) table.firstColumn = true;
    if (on("showLastColumn")) table.lastColumn = true;
  }
  const cols = childrenNamed(child(root, "tableColumns"), "tableColumn");
  const calculated: Record<string, string> = {};
  for (const c of cols) {
    const f = textOf(child(c, "calculatedColumnFormula")).trim().replace(/^=/, "");
    if (f && attr(c, "name")) calculated[attr(c, "name")!] = f;
  }
  const columns = cols.map((c) => attr(c, "name") ?? "");
  if (!headed) table.columns = columns.map((n, i) => n || `Column${i + 1}`);

  // Without an autoFilter element the table has no filter buttons.
  const filter = child(root, "autoFilter");
  if (headed && !filter) table.filterButtons = false;
  const names = columns;
  if (filter) {
    const filters: Record<string, FilterCriterion> = {};
    for (const fc of childrenNamed(filter, "filterColumn")) {
      const name = names[Number(attr(fc, "colId"))];
      if (name === undefined) continue;
      const read = readFilterColumn(fc, dxfs);
      if (typeof read === "string") warnings?.add(`A filter in the table "${table.name}" was left out because ${read}; its rows stay hidden or shown as saved`);
      else if (read !== null) filters[name] = read;
    }
    if (Object.keys(filters).length) table.filters = filters;
  }
  const sort = readSortState(child(filter, "sortState") ?? child(root, "sortState"), names, b, dxfs, (why) => warnings?.add(`A level of the sort of the table "${table.name}" was left out because ${why}`));
  if (sort) table.sort = sort;
  return { table, columns, calculated, partId: Number(attr(root, "id")), columnIds: cols.map((c) => Number(attr(c, "id"))) };
}

// ---- table styles of your own ----

const STYLE_PARTS = ["wholeTable", "headerRow", "totalRow", "firstColumn", "lastColumn", "firstRowStripe", "secondRowStripe", "firstColumnStripe", "secondColumnStripe", "firstHeaderCell", "lastHeaderCell", "firstTotalCell", "lastTotalCell"] as const;

/** The `tableStyles` element of a stylesheet. `dxf` gives the position of a part's look in the stylesheet's table of those. */
export function tableStylesXml(defs: Record<string, TableStyleDef> | undefined, dxf: (style: TableStylePart) => number, extra: readonly string[] = [], pivotStyles?: { count: number; xml: (dxf: (style: TableStylePart) => number) => string }): string {
  const entries = Object.entries(defs ?? {});
  const styles = entries
    .map(([name, def]) => {
      const parts = STYLE_PARTS.filter((p) => def[p]).map((p) => {
        const size = p === "firstRowStripe" || p === "secondRowStripe" ? def.rowStripeSize : p === "firstColumnStripe" || p === "secondColumnStripe" ? def.columnStripeSize : undefined;
        return `<tableStyleElement type="${p}"${size && size > 1 ? ` size="${size}"` : ""} dxfId="${dxf(def[p]!)}"/>`;
      });
      return `<tableStyle name="${esc(name)}" pivot="0" count="${parts.length}">${parts.join("")}</tableStyle>`;
    })
    .join("");
  return `<tableStyles count="${entries.length + extra.length + (pivotStyles?.count ?? 0)}" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16">${styles}${extra.join("")}${pivotStyles?.xml(dxf) ?? ""}</tableStyles>`;
}

/** The table styles of your own in a stylesheet; `dxfs` is its table of looks. Styles for pivot tables only, and those named like Excel's, are left out. */
export function readTableStyles(root: XmlElement | undefined, dxfs: readonly ConditionalStyle[], theme?: readonly string[]): Record<string, TableStyleDef> {
  const out: Record<string, TableStyleDef> = {};
  // With the theme, the looks are read again to keep the lines between cells, which a conditional format has no use for.
  const elements = theme ? childrenNamed(child(root, "dxfs"), "dxf") : [];
  const lookAt = (at: number): TableStylePart | undefined => (elements[at] ? readTableStyleDxf(elements[at]!, theme!) : dxfs[at]);
  for (const el of childrenNamed(child(root, "tableStyles"), "tableStyle")) {
    const name = attr(el, "name");
    if (!name || attr(el, "table") === "0" || attr(el, "table") === "false") continue;
    const def: TableStyleDef = {};
    for (const part of childrenNamed(el, "tableStyleElement")) {
      const type = attr(part, "type") as (typeof STYLE_PARTS)[number] | undefined;
      const look = lookAt(Number(attr(part, "dxfId")));
      if (!type || !look || !(STYLE_PARTS as readonly string[]).includes(type)) continue;
      def[type] = look;
      const size = Number(attr(part, "size") ?? 1);
      if (size > 1 && (type === "firstRowStripe" || type === "secondRowStripe")) def.rowStripeSize = Math.min(9, size);
      if (size > 1 && (type === "firstColumnStripe" || type === "secondColumnStripe")) def.columnStripeSize = Math.min(9, size);
    }
    try {
      out[cleanTableStyleName(name)] = cleanTableStyle(def);
    } catch {
      // a style that is Excel's own, or can't be read, is left out
    }
  }
  return out;
}
