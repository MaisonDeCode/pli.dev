import { attr, child, childrenNamed, textOf, type XmlElement } from "@pli.dev/core";
import type { ConditionalStyle, DataBlock, DataModel, Pivot, PivotStyleDef, TableStylePart, Workbook } from "./model";
import { cleanPivot } from "./pivot";
import { cleanBlock, externalSourceName, isExternalSource, isModelSource } from "./pivot-external";
import { cleanModel } from "./pivot-model";
import { PIVOT_STYLE_PARTS, cleanPivotStyle, cleanPivotStyleName } from "./pivot-style-custom";
import { readTableStyleDxf } from "./xlsx-format";

/*
 * What a pivot table needs in an .xlsx file beyond the pivot table parts.
 *
 * Pivot styles of your own are `tableStyle` elements of the stylesheet with `pivot="1" table="0"`, each part a
 * `tableStyleElement` that points at a differential format.
 *
 * Pivot tables over the data model, over a named block of data the host supplies, or with a distinct count have no place in a
 * file Excel opens (Excel keeps its data model in a binary part, `xl/model/item.data`, that only Excel writes). They are
 * written as the cells they drew, and Pli's own extension of the workbook part keeps what Excel can't: the data model, the
 * blocks of data, and the definition of each such pivot table, so Pli opens the file with them again. Excel ignores it.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// ---- pivot styles of your own ----

/** The `tableStyle` elements for pivot styles of your own. `dxf` gives the position of a part's look in the stylesheet's table of those. */
export function pivotStyleElements(defs: Record<string, PivotStyleDef> | undefined, dxf: (style: TableStylePart) => number): string {
  return Object.entries(defs ?? {})
    .map(([name, def]) => {
      const parts = PIVOT_STYLE_PARTS.filter((p) => def[p]).map((p) => {
        const size = p === "firstRowStripe" || p === "secondRowStripe" ? def.rowStripeSize : p === "firstColumnStripe" || p === "secondColumnStripe" ? def.columnStripeSize : undefined;
        return `<tableStyleElement type="${p}"${size && size > 1 ? ` size="${size}"` : ""} dxfId="${dxf(def[p]!)}"/>`;
      });
      return `<tableStyle name="${esc(name)}" table="0" count="${parts.length}">${parts.join("")}</tableStyle>`;
    })
    .join("");
}

/** The pivot styles of your own in a stylesheet: the styles for pivot tables only that aren't named like Excel's. */
export function readPivotStyles(root: XmlElement | undefined, dxfs: readonly ConditionalStyle[], theme?: readonly string[]): Record<string, PivotStyleDef> {
  const out: Record<string, PivotStyleDef> = {};
  const elements = theme ? childrenNamed(child(root, "dxfs"), "dxf") : [];
  const lookAt = (at: number): TableStylePart | undefined => (elements[at] ? readTableStyleDxf(elements[at]!, theme!) : dxfs[at]);
  for (const el of childrenNamed(child(root, "tableStyles"), "tableStyle")) {
    const name = attr(el, "name");
    if (!name || (attr(el, "table") !== "0" && attr(el, "table") !== "false") || attr(el, "pivot") === "0" || attr(el, "pivot") === "false") continue;
    const def: PivotStyleDef = {};
    for (const part of childrenNamed(el, "tableStyleElement")) {
      const type = attr(part, "type") as (typeof PIVOT_STYLE_PARTS)[number] | undefined;
      const look = lookAt(Number(attr(part, "dxfId")));
      if (!type || !look || !(PIVOT_STYLE_PARTS as readonly string[]).includes(type)) continue;
      def[type] = look;
      const size = Number(attr(part, "size") ?? 1);
      if (size > 1 && (type === "firstRowStripe" || type === "secondRowStripe")) def.rowStripeSize = Math.min(9, size);
      if (size > 1 && (type === "firstColumnStripe" || type === "secondColumnStripe")) def.columnStripeSize = Math.min(9, size);
    }
    try {
      out[cleanPivotStyleName(name)] = cleanPivotStyle(def);
    } catch {
      // a style that is Excel's own, or can't be read, is left out
    }
  }
  return out;
}

// ---- what Excel has no place for ----

export const PLI_PIVOT_URI = "{4C7A1D2E-8B3F-4F60-A9D5-2E6B0C9F1A73}";
const PLI_NS = "https://pli.dev/spreadsheetml/2026";

/** Whether a pivot table that was not written as one needs its definition kept in the extension. */
const needsExtension = (p: Pivot): boolean => isModelSource(p.source) || isExternalSource(p.source) || p.values.some((v) => v.fn === "distinctCount");

/** The workbook extension that keeps the data model, the blocks of outside data and the pivot tables Excel can't hold; "" when there is nothing to keep. */
export function pliPivotExt(wb: Workbook, written: ReadonlySet<string>): string {
  const plain = wb.sheets.flatMap((sheet) => (sheet.pivots ?? []).filter((p) => !written.has(p.id) && needsExtension(p)).map((pivot) => ({ sheet: sheet.name, pivot })));
  // A block that a pivot table written as one holds in its cache is not kept twice.
  const cached = new Set(wb.sheets.flatMap((sheet) => (sheet.pivots ?? []).filter((p) => written.has(p.id) && isExternalSource(p.source)).map((p) => externalSourceName(p.source)!.toLowerCase())));
  const blocks = (wb.dataBlocks ?? []).filter((b) => !cached.has(b.source.toLowerCase()));
  if (!plain.length && !blocks.length && !wb.model) return "";
  const data = { ...(blocks.length ? { dataBlocks: blocks } : {}), ...(wb.model ? { model: wb.model } : {}), ...(plain.length ? { pivots: plain } : {}) };
  return `<ext uri="${PLI_PIVOT_URI}" xmlns:pli="${PLI_NS}"><pli:pivots>${esc(JSON.stringify(data))}</pli:pivots></ext>`;
}

export interface PliPivotExt {
  dataBlocks: DataBlock[];
  model?: DataModel;
  pivots: { sheet: string; pivot: Pivot }[];
}

/** What the extension keeps; nothing that can't be read. */
export function readPliPivotExt(book: XmlElement | undefined, warn: (message: string) => void): PliPivotExt {
  const out: PliPivotExt = { dataBlocks: [], pivots: [] };
  for (const ext of childrenNamed(child(book, "extLst"), "ext")) {
    if (attr(ext, "uri") !== PLI_PIVOT_URI) continue;
    const el = child(ext, "pivots");
    if (!el) continue;
    let data: { dataBlocks?: DataBlock[]; model?: DataModel; pivots?: { sheet: string; pivot: Pivot }[] };
    try {
      data = JSON.parse(textOf(el));
    } catch {
      warn("The data model and outside data Pli kept in this file could not be read");
      continue;
    }
    for (const b of data.dataBlocks ?? []) {
      try {
        out.dataBlocks.push(cleanBlock(b));
      } catch (e) {
        warn(`A block of outside data Pli kept in this file was left out: ${(e as Error).message}`);
      }
    }
    if (data.model) {
      try {
        out.model = cleanModel(data.model);
      } catch (e) {
        warn(`The data model Pli kept in this file was left out: ${(e as Error).message}`);
      }
    }
    for (const x of data.pivots ?? []) {
      try {
        out.pivots.push({ sheet: String(x.sheet), pivot: cleanPivot(x.pivot) });
      } catch (e) {
        warn(`A pivot table Pli kept in this file was read as plain cells: ${(e as Error).message}`);
      }
    }
  }
  return out;
}

/** Puts on a workbook just read what its pivot tables read from outside (the rows their caches held, and what the extension keeps). */
export function applyPliPivots(wb: Workbook, book: XmlElement | undefined, cached: readonly DataBlock[], warn: (message: string) => void): void {
  const ext = readPliPivotExt(book, warn);
  const blocks = [...cached];
  for (const b of ext.dataBlocks) if (!blocks.some((x) => x.source.toLowerCase() === b.source.toLowerCase())) blocks.push(b);
  if (blocks.length) wb.dataBlocks = blocks;
  if (ext.model) wb.model = ext.model;
  const names = new Set(wb.sheets.flatMap((s) => (s.pivots ?? []).map((p) => p.name.toLowerCase())));
  for (const { sheet, pivot } of ext.pivots) {
    const home = wb.sheets.find((s) => s.name.toLowerCase() === sheet.toLowerCase());
    if (!home) warn(`A pivot table Pli kept in this file was left out: there is no sheet "${sheet}"`);
    else if (names.has(pivot.name.toLowerCase())) warn(`A pivot table Pli kept in this file was left out: another has the name "${pivot.name}"`);
    else {
      names.add(pivot.name.toLowerCase());
      (home.pivots ??= []).push(pivot);
    }
  }
}
