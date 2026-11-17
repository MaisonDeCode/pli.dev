import { attr, child, childrenNamed, createId, elements, type XmlElement } from "@pli.dev/core";
import { parseRange } from "./address";
import { MAX_CHART_SIZE, MIN_CHART_SIZE } from "./chart";
import { DEFAULT_SLICER_HEIGHT, DEFAULT_SLICER_WIDTH, MAX_SLICER_COLUMNS } from "./slicer";
import type { Sheet, Slicer, Workbook } from "./model";
import { anchorBox, slicerAnchor, slicerNameIn } from "./xlsx-chart";
import { tableColumns } from "./table";

/*
 * Slicers in an .xlsx file. A slicer is a drawing in the sheet (an alternate-content anchor, so that Excel 2007 sees a
 * placeholder), a `slicer` part per sheet that names it and says which cache it reads, and a `slicerCache` part per
 * slicer that says which column of which table it filters. The filter itself is the table's own, so nothing else is kept.
 */

const EMU = 9525;
const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const X15 = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const SLE = "http://schemas.microsoft.com/office/drawing/2010/slicer";
const SLE15 = "http://schemas.microsoft.com/office/drawing/2012/slicer";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export interface SlicerFiles {
  /** The anchors to add to the sheet's drawing; `first` is the shape id the first gets. */
  anchors: string;
  /** The sheet's `slicers` part. */
  part: string;
  /** One `slicerCache` part each, with the name the workbook defines for it. */
  caches: { name: string; xml: string }[];
}

/**
 * What a sheet's slicers need written. `tableNumber` is the number a table's part has in the file, `taken` the cache and slicer
 * names already used in the workbook (it is added to).
 */
export function sheetSlicerFiles(wb: Workbook, sheet: Sheet, firstShape: number, tableNumber: (tableId: string) => number | undefined, taken: Set<string>): SlicerFiles | null {
  const slicers = (sheet.slicers ?? []).filter((x) => tableNumber(x.table) !== undefined);
  if (!slicers.length) return null;
  const unique = (base: string, seen: Set<string>) => {
    let name = base;
    for (let k = 1; seen.has(name.toLowerCase()); k++) name = `${base}${k}`;
    seen.add(name.toLowerCase());
    return name;
  };
  const caches: SlicerFiles["caches"] = [];
  const entries: string[] = [];
  const anchors: string[] = [];
  slicers.forEach((x, i) => {
    const table = wb.sheets.flatMap((s) => (s.tables ?? []).map((t) => ({ s, t }))).find((e) => e.t.id === x.table)!;
    const names = tableColumns(table.s, parseRange(table.t.range)!, table.t);
    const columnId = names.indexOf(x.column) + 1;
    const caption = x.caption ?? x.column;
    const cache = unique(`Slicer_${x.column.replace(/[^A-Za-z0-9_]/g, "_")}`, taken);
    const name = unique(caption.replace(/["<>&]/g, ""), taken);
    caches.push({
      name: cache,
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${esc(cache)}" sourceName="${esc(x.column)}">` +
        `<extLst><x:ext uri="{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}" xmlns:x15="${X15}"><x15:tableSlicerCache tableId="${tableNumber(x.table)}" column="${columnId}"/></x:ext></extLst></slicerCacheDefinition>`,
    });
    entries.push(`<slicer name="${esc(name)}" cache="${esc(cache)}" caption="${esc(caption)}"${x.columns && x.columns > 1 ? ` columnCount="${x.columns}"` : ""}${x.style ? ` style="${esc(x.style)}"` : ""} rowHeight="241300"/>`);
    const dx = Math.round((x.from.dx ?? 0) * EMU);
    const dy = Math.round((x.from.dy ?? 0) * EMU);
    const cx = Math.round(x.width * EMU);
    const cy = Math.round(x.height * EMU);
    anchors.push(
      `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:sle15="${SLE15}" Requires="sle15">` +
        `<xdr:oneCellAnchor><xdr:from><xdr:col>${x.from.col - 1}</xdr:col><xdr:colOff>${dx}</xdr:colOff><xdr:row>${x.from.row - 1}</xdr:row><xdr:rowOff>${dy}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${firstShape + i}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${SLE}"><sle:slicer xmlns:sle="${SLE}" name="${esc(name)}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>` +
        `</mc:Choice><mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>` +
        `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>This shape represents a slicer. Slicers are supported in Excel 2010 or later.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>`,
    );
  });
  return {
    anchors: anchors.join(""),
    part: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicers xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${entries.join("")}</slicers>`,
    caches,
  };
}

/** The `ext` of a worksheet's `extLst` that points at its slicers part. */
export const slicerListExt = (rid: string) => `<ext uri="{A8765BA9-456A-4dab-B4F3-ACF838C121DE}" xmlns:x14="${X14}"><x14:slicerList><x14:slicer r:id="${rid}"/></x14:slicerList></ext>`;

/** The `ext` of the workbook's `extLst` that points at its slicer caches. */
export const slicerCachesExt = (rids: readonly string[]) => `<ext uri="{BBE1A952-AA13-448e-AADC-164F8A28A991}" xmlns:x14="${X14}"><x14:slicerCaches>${rids.map((r) => `<x14:slicerCache r:id="${r}"/>`).join("")}</x14:slicerCaches></ext>`;

// ================= reading =================

export interface PendingSlicer {
  sheet: Sheet;
  /** The id of the table part (as the file numbers them) and the id of the column in it. */
  tablePart: number;
  columnId: number;
  caption?: string;
  style?: string;
  columns?: number;
  from: Slicer["from"];
  width: number;
  height: number;
}

/**
 * The slicers of a worksheet that filter a table: the drawing says where each is, the sheet's slicers part names it and the
 * workbook's cache says which table column it reads. `caches` maps a cache name to its table part and column.
 */
export function readSheetSlicers(
  sheet: Sheet,
  drawing: XmlElement | undefined,
  slicersPart: XmlElement | undefined,
  caches: ReadonlyMap<string, { tablePart: number; columnId: number }>,
  warnings: Set<string>,
  /** Caches of slicers on pivot tables, which are read elsewhere. */
  elsewhere: ReadonlyMap<string, unknown> = new Map(),
): PendingSlicer[] {
  if (!drawing) return [];
  const byName = new Map<string, XmlElement>();
  for (const s of childrenNamed(slicersPart, "slicer")) byName.set(attr(s, "name") ?? "", s);
  const out: PendingSlicer[] = [];
  for (const wrapper of elements(drawing)) {
    const name = slicerNameIn(wrapper);
    if (name === undefined) continue;
    const entry = byName.get(name);
    const cache = entry ? caches.get(attr(entry, "cache") ?? "") : undefined;
    const anchor = slicerAnchor(wrapper);
    if (entry && elsewhere.has(attr(entry, "cache") ?? "")) continue;
    if (!entry || !cache || !anchor) {
      warnings.add("A slicer of a kind Pli doesn't have (on a pivot table, or one that could not be read) was left out");
      continue;
    }
    const box = anchorBox(anchor, sheet);
    const clamp = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? Math.max(MIN_CHART_SIZE, Math.min(MAX_CHART_SIZE, Math.round(n))) : fallback);
    const columns = Number(attr(entry, "columnCount") ?? 1);
    out.push({
      sheet,
      tablePart: cache.tablePart,
      columnId: cache.columnId,
      ...(attr(entry, "caption") ? { caption: attr(entry, "caption")! } : {}),
      ...(attr(entry, "style") && attr(entry, "style") !== "SlicerStyleLight1" ? { style: attr(entry, "style")! } : {}),
      ...(columns > 1 ? { columns: Math.min(MAX_SLICER_COLUMNS, Math.floor(columns)) } : {}),
      from: { row: Math.max(1, box.row), col: Math.max(1, box.col), ...(box.dx > 0.5 ? { dx: Math.round(box.dx) } : {}), ...(box.dy > 0.5 ? { dy: Math.round(box.dy) } : {}) },
      width: clamp(box.width, DEFAULT_SLICER_WIDTH),
      height: clamp(box.height, DEFAULT_SLICER_HEIGHT),
    });
  }
  return out;
}

/** A slicer cache part as the table and column it filters, or null when it isn't one on a table. */
export function readSlicerCache(root: XmlElement | undefined): { name: string; tablePart: number; columnId: number } | null {
  const name = attr(root, "name");
  if (!root || !name) return null;
  for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
    const t = child(ext, "tableSlicerCache");
    if (t) return { name, tablePart: Number(attr(t, "tableId")), columnId: Number(attr(t, "column")) };
  }
  return null;
}

/** A pending slicer as a slicer on its table (resolved by the caller to a table id and column name). */
export function slicerOf(p: PendingSlicer, table: string, column: string): Slicer {
  return { id: createId("slicer_"), table, column, from: p.from, width: p.width, height: p.height, ...(p.caption && p.caption !== column ? { caption: p.caption } : {}), ...(p.style ? { style: p.style } : {}), ...(p.columns ? { columns: p.columns } : {}) };
}

