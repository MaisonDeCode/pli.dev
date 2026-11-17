import { attr, child, childrenNamed, type XmlElement } from "@pli.dev/core";
import type { ConditionalStyle, CellStyle, Pivot, PivotFormat, TableStylePart } from "./model";

/*
 * Looks given to cells of a pivot table, in an .xlsx file: the `formats` of the pivot table definition (Excel's "Preserve cell
 * formatting on update"). Each `format` pairs an area of the table (`pivotArea`: the cells that show some items, the labels
 * of an item, a grand total) with a look in the stylesheet's table of differential formats (`dxfId`).
 *
 * Only the looks a differential format can hold are written (bold, italic, underline, strike, colour, fill, font and lines,
 * a number format, and alignment, indent and wrapping). Taking a look off (`null`) and a look on the corner and filter cells
 * stay in the cells Pli drew.
 *
 * Excel writes the same formats in a shorter form when it saves a file: the area has no `type` (it is then "normal", whose
 * `dataOnly` is true unless the file says otherwise) and an `action` of "formatting" is left out. Both are read.
 */

/** The axis of a field of the table, with the position of its cache field and the items the cache lists for it. */
export interface FormatField {
  fld: number;
  side: "row" | "col";
  labels: readonly string[];
}

const DXF_KEYS = ["bold", "italic", "underline", "strike", "color", "fill", "fontFamily", "fontSize", "border", "align", "vAlign", "wrap", "indent"] as const;

/** The look of a format in the form a differential format holds, or null when it has nothing a differential format can hold. */
function dxfOf(f: PivotFormat): TableStylePart | null {
  const out: Record<string, unknown> = {};
  for (const k of DXF_KEYS) {
    const v = (f.style as Record<string, unknown> | undefined)?.[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  if (f.fmt !== undefined && f.fmt !== "General") out["fmt"] = f.fmt;
  return Object.keys(out).length ? (out as TableStylePart) : null;
}

const VALUE_FIELD = "4294967294";

/** The `formats` element of a pivot table definition, or "" when the table keeps no looks Excel can hold. */
export function formatReference(pivot: Pick<Pivot, "formats">, fieldOf: (heading: string) => FormatField | undefined, valueCount: number, hasColumns: boolean, dxf: (style: TableStylePart) => number): string {
  const out: string[] = [];
  for (const f of pivot.formats ?? []) {
    const look = dxfOf(f);
    if (!look) continue;
    const id = dxf(look);
    const refs: { fld: number; v: number }[] = [];
    let axis: "row" | "col" | undefined;
    let ok = true;
    for (const it of f.items ?? []) {
      const field = fieldOf(it.field);
      const at = field?.labels.indexOf(it.item) ?? -1;
      if (!field || at < 0) {
        ok = false;
        break;
      }
      if (f.part === "label") {
        if (axis && axis !== field.side) ok = false;
        axis = field.side;
      }
      refs.push({ fld: field.fld, v: at });
    }
    if (!ok) continue;
    refs.sort((a, b) => a.fld - b.fld);
    const reference = [
      ...(f.part === "data" && f.value !== undefined && valueCount > 1 ? [`<reference field="${VALUE_FIELD}" count="1" selected="0"><x v="${f.value}"/></reference>`] : []),
      ...refs.map((r) => `<reference field="${r.fld}" count="1" selected="0"><x v="${r.v}"/></reference>`),
    ];
    const refsXml = reference.length ? `<references count="${reference.length}">${reference.join("")}</references>` : "";
    const area = (extra: string) => out.push(`<format action="formatting" dxfId="${id}"><pivotArea${extra}>${refsXml}</pivotArea></format>`);
    if (f.part === "data") {
      const grand = f.items?.length === 0 ? ' grandRow="1" grandCol="1"' : f.grand === "row" ? ' grandRow="1"' : f.grand === "column" ? ' grandCol="1"' : "";
      area(` type="data" outline="0" fieldPosition="0"${grand}`);
    } else if (f.items === undefined) {
      area(' dataOnly="0" labelOnly="1" outline="0" fieldPosition="0"');
    } else if (f.items.length === 0) {
      // The words Grand Total: down the rows, and along the columns when there are some.
      out.push(`<format action="formatting" dxfId="${id}"><pivotArea dataOnly="0" labelOnly="1" grandRow="1" outline="0" axis="axisRow" fieldPosition="0"/></format>`);
      if (hasColumns) out.push(`<format action="formatting" dxfId="${id}"><pivotArea dataOnly="0" labelOnly="1" grandCol="1" outline="0" axis="axisCol" fieldPosition="0"/></format>`);
    } else {
      area(` dataOnly="0" labelOnly="1" outline="0" axis="${axis === "col" ? "axisCol" : "axisRow"}" fieldPosition="0"`);
    }
  }
  return out.length ? `<formats count="${out.length}">${out.join("")}</formats>` : "";
}

const on = (v: string | undefined, dflt = false) => (v === undefined ? dflt : v === "1" || v === "true");

/**
 * The looks a pivot table definition keeps (its `formats`), or why they can't be read. `headingOf` says which axis field a
 * cache field is (its heading and the items it lists), `dxfs` is the stylesheet's table of looks.
 */
export function readFormats(def: XmlElement, headingOf: (fld: number) => { heading: string; labelOf: (x: number) => string | undefined } | undefined, dxfs: readonly ConditionalStyle[], valueCount: number): PivotFormat[] | string {
  const list = childrenNamed(child(def, "formats"), "format");
  const out: PivotFormat[] = [];
  const same = (a: PivotFormat, b: PivotFormat) => JSON.stringify(a) === JSON.stringify(b);
  for (const fm of list) {
    const area = child(fm, "pivotArea");
    const look = dxfs[Number(attr(fm, "dxfId"))];
    if (!area || !look || (attr(fm, "action") ?? "formatting") !== "formatting") return "it has formats on parts of the table in a way Pli doesn't read";
    const type = attr(area, "type") ?? "normal";
    const labelOnly = on(attr(area, "labelOnly"));
    // A normal area is the data unless it says it is labels only (`dataOnly` is true unless the file says otherwise).
    const dataOnly = on(attr(area, "dataOnly"), !labelOnly);
    if (!(type === "data" || type === "normal") || dataOnly === labelOnly) return "it has formats on parts of the table in a way Pli doesn't read";
    const items: { field: string; item: string }[] = [];
    let value: number | undefined;
    for (const ref of childrenNamed(child(area, "references"), "reference")) {
      const fld = Number(attr(ref, "field"));
      const xs = childrenNamed(ref, "x");
      if (xs.length !== 1 || on(attr(ref, "defaultSubtotal"))) return "it has formats on parts of the table in a way Pli doesn't read";
      const x = Number(attr(xs[0], "v"));
      if (String(fld) === VALUE_FIELD) {
        if (!Number.isInteger(x) || x < 0 || x >= valueCount) return "it has formats on parts of the table in a way Pli doesn't read";
        value = x;
        continue;
      }
      const field = headingOf(fld);
      const label = field?.labelOf(x);
      if (!field || label === undefined) return "it has formats on parts of the table in a way Pli doesn't read";
      items.push({ field: field.heading, item: label });
    }
    const f: PivotFormat = { part: labelOnly ? "label" : "data" };
    const grandRow = on(attr(area, "grandRow"));
    const grandCol = on(attr(area, "grandCol"));
    if (labelOnly) {
      if (grandRow || grandCol) {
        if (items.length) return "it has formats on parts of the table in a way Pli doesn't read";
        f.items = [];
      } else if (items.length) f.items = items;
    } else {
      if (items.length) f.items = items;
      else if (grandRow && grandCol) f.items = [];
      else if (grandRow) f.grand = "row";
      else if (grandCol) f.grand = "column";
      if (value !== undefined) f.value = value;
    }
    const style: Record<string, unknown> = {};
    for (const k of DXF_KEYS) {
      const v = (look as unknown as Record<string, unknown>)[k];
      if (v !== undefined) style[k] = v;
    }
    if (Object.keys(style).length) f.style = style as CellStyle;
    if (look.fmt) f.fmt = look.fmt;
    if (!f.style && !f.fmt) continue;
    if (!out.some((o) => same(o, f))) out.push(f);
  }
  return out;
}
