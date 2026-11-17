import { attr, child, childrenNamed, createId, elements, type XmlElement } from "@pli.dev/core";
import { MAX_CHART_SIZE, MIN_CHART_SIZE } from "./chart";
import type { Pivot, PivotSlicer, PivotTimeline, Sheet } from "./model";
import { pivotItemSelected } from "./pivot-slicer";
import { DEFAULT_PIVOT_SLICER_HEIGHT, DEFAULT_PIVOT_SLICER_WIDTH, DEFAULT_PIVOT_TIMELINE_HEIGHT, DEFAULT_PIVOT_TIMELINE_WIDTH } from "./pivot-slicer";
import { anchorBox } from "./xlsx-chart";
import { esc, isoOf, serialOfIso } from "./xlsx-pivot-group";
import type { PivotPartsInfo } from "./xlsx-pivot";
import { serialDate } from "./values";

/*
 * Slicers and timelines on pivot tables in an .xlsx file. They are drawn the way a table's slicers are (an anchor in the
 * sheet's drawing, an entry in the sheet's slicers part, a cache part the workbook lists); the cache names the pivot table
 * and the field, and which items are picked. Timelines have a part and a cache of their own. The filter itself is the pivot
 * table's (items it leaves out, and the dates the timeline keeps), so nothing else is kept.
 */

const EMU = 9525;
const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const X15 = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const SLE = "http://schemas.microsoft.com/office/drawing/2010/slicer";
const SLE15 = "http://schemas.microsoft.com/office/drawing/2012/slicer";
const TSLE = "http://schemas.microsoft.com/office/drawing/2012/timeslicer";
const LEVELS = ["years", "quarters", "months", "days"] as const;

/** What was written for one pivot table: its number in the file and the parts that say where its items are. */
export interface WrittenPivot {
  k: number;
  info: PivotPartsInfo;
}

export interface PivotPanelFiles {
  /** Anchors for the sheet's drawing, slicers first. */
  anchors: string;
  /** `slicer` entries for the sheet's slicers part, and the caches they read. */
  slicerEntries: string;
  slicerCaches: { name: string; xml: string }[];
  /** `timeline` entries for the sheet's timelines part, and the caches they read. */
  timelineEntries: string;
  timelineCaches: { name: string; xml: string }[];
}

const unique = (base: string, seen: Set<string>) => {
  let name = base;
  for (let k = 1; seen.has(name.toLowerCase()); k++) name = `${base}${k}`;
  seen.add(name.toLowerCase());
  return name;
};

const frame = (id: number, name: string, p: { from: PivotSlicer["from"]; width: number; height: number }, kind: "slicer" | "timeline") => {
  const dx = Math.round((p.from.dx ?? 0) * EMU);
  const dy = Math.round((p.from.dy ?? 0) * EMU);
  const cx = Math.round(p.width * EMU);
  const cy = Math.round(p.height * EMU);
  const ns = kind === "slicer" ? SLE : TSLE;
  const requires = kind === "slicer" ? `xmlns:sle15="${SLE15}" Requires="sle15"` : `xmlns:tsle="${TSLE}" Requires="tsle"`;
  const tag = kind === "slicer" ? `<sle:slicer xmlns:sle="${SLE}" name="${esc(name)}"/>` : `<tsle:timeslicer xmlns:tsle="${TSLE}" name="${esc(name)}"/>`;
  const what = kind === "slicer" ? "a slicer. Slicers are supported in Excel 2010 or later." : "a timeline. Timelines are supported in Excel 2013 or later.";
  return (
    `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice ${requires}>` +
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${p.from.col - 1}</xdr:col><xdr:colOff>${dx}</xdr:colOff><xdr:row>${p.from.row - 1}</xdr:row><xdr:rowOff>${dy}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${ns}">${tag}</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>` +
    `</mc:Choice><mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>` +
    `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>This shape represents ${what}</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>`
  );
};

/**
 * What a sheet's pivot tables' slicers and timelines need written. `written` says which pivot tables got parts; `tabId` is
 * the sheet's id in the workbook; `taken` the names already used for caches and shapes (it is added to).
 */
export function pivotPanelFiles(sheet: Sheet, tabId: number, firstShape: number, written: ReadonlyMap<string, WrittenPivot>, taken: Set<string>): PivotPanelFiles | null {
  const out: PivotPanelFiles = { anchors: "", slicerEntries: "", slicerCaches: [], timelineEntries: "", timelineCaches: [] };
  let shape = firstShape;
  for (const pivot of sheet.pivots ?? []) {
    const done = written.get(pivot.id);
    if (!done) continue;
    const pivotXml = `<pivotTables><pivotTable tabId="${tabId}" name="${esc(pivot.name)}"/></pivotTables>`;
    for (const x of pivot.slicers ?? []) {
      const cf = done.info.fieldFor(x.field);
      const labels = done.info.fields[cf]?.labels ?? [];
      const caption = x.caption ?? x.field;
      const cache = unique(`Slicer_${x.field.replace(/[^A-Za-z0-9_]/g, "_")}`, taken);
      const name = unique(caption.replace(/["<>&]/g, ""), taken);
      out.slicerCaches.push({
        name: cache,
        xml:
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${esc(cache)}" sourceName="${esc(x.field)}">` +
          `${pivotXml}<data><tabular pivotCacheId="${done.k}"><items count="${labels.length}">${labels.map((l, i) => `<i x="${i}"${pivotItemSelected(pivot, x.field, l) ? ' s="1"' : ""}/>`).join("")}</items></tabular></data></slicerCacheDefinition>`,
      });
      out.slicerEntries += `<slicer name="${esc(name)}" cache="${esc(cache)}" caption="${esc(caption)}"${x.columns && x.columns > 1 ? ` columnCount="${x.columns}"` : ""}${x.style ? ` style="${esc(x.style)}"` : ""} rowHeight="241300"/>`;
      out.anchors += frame(shape++, name, x, "slicer");
    }
    for (const x of pivot.timelines ?? []) {
      const caption = x.caption ?? x.field;
      const cache = unique(`NativeTimeline_${x.field.replace(/[^A-Za-z0-9_]/g, "_")}`, taken);
      const name = unique(caption.replace(/["<>&]/g, ""), taken);
      const level = LEVELS.indexOf(x.level ?? "months");
      const span = done.info.span(x.field) ?? { min: x.start ?? 0, max: x.end ?? 0 };
      const lo = isoOf(span.min);
      const hi = isoOf(span.max);
      const start = x.start !== undefined || x.end !== undefined ? isoOf(x.start ?? span.min) : undefined;
      const end = x.start !== undefined || x.end !== undefined ? isoOf(x.end ?? span.max) : undefined;
      out.timelineCaches.push({
        name: cache,
        xml:
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<timelineCacheDefinition xmlns="${X15}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${esc(cache)}" sourceName="${esc(x.field)}">` +
          `${pivotXml}<state name="${esc(cache)}" pivotCacheId="${done.k}"${start ? ' filterType="dateBetween"' : ' filterType="unknown"'} lastRefreshVersion="6" minimalRefreshVersion="0" singleRangeFilterState="1">` +
          `<selection startDate="${start ?? lo}" endDate="${end ?? hi}"/><bounds startDate="${yearStart(span.min)}" endDate="${yearStart(span.max, 1)}"/></state></timelineCacheDefinition>`,
      });
      out.timelineEntries += `<timeline name="${esc(name)}" cache="${esc(cache)}" caption="${esc(caption)}" level="${level}" selectionLevel="${level}" scrollPosition="${lo}"${x.style ? ` style="${esc(x.style)}"` : ` style="TimeSlicerStyleLight1"`}/>`;
      out.anchors += frame(shape++, name, x, "timeline");
    }
  }
  return out.anchors ? out : null;
}

/** The first day of the year a date is in (or of the year after, with `plus`), as Excel's timelines bound their bar. */
const yearStart = (serial: number, plus = 0): string => `${String(serialDate(serial).year + plus).padStart(4, "0")}-01-01T00:00:00`;

/** The sheet's slicers part, when it holds only pivot table slicers. */
export const slicersPartXml = (entries: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicers xmlns="${X14}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${entries}</slicers>`;

export const timelinesPartXml = (entries: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<timelines xmlns="${X15}" xmlns:mc="${MC}" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${entries}</timelines>`;

/** The `ext` of a worksheet's `extLst` that points at its timelines part. */
export const timelineListExt = (rid: string) => `<ext uri="{7E03D99C-DC04-49d9-9315-930204A7B6E9}" xmlns:x15="${X15}"><x15:timelineRefs><x15:timelineRef r:id="${rid}"/></x15:timelineRefs></ext>`;

/** The `ext` of the workbook's `extLst` that points at its timeline caches. */
export const timelineCachesExt = (rids: readonly string[]) => `<ext uri="{D0CA8CA8-9F24-4464-BF8E-62219DCF47F9}" xmlns:x15="${X15}"><x15:timelineCacheRefs>${rids.map((r) => `<x15:timelineCacheRef r:id="${r}"/>`).join("")}</x15:timelineCacheRefs></ext>`;

// ================= reading =================

export interface PivotCacheLink {
  name: string;
  kind: "slicer" | "timeline";
  /** The pivot tables it filters, by name, and the field. */
  pivots: string[];
  field: string;
}

/** A slicer cache or a timeline cache that filters a pivot table, or null when it is a table's. */
export function readPivotCache(root: XmlElement | undefined): PivotCacheLink | null {
  const name = attr(root, "name");
  const field = attr(root, "sourceName");
  if (!root || !name || !field) return null;
  const pivots = childrenNamed(child(root, "pivotTables"), "pivotTable").map((p) => attr(p, "name") ?? "");
  if (!pivots.length) return null;
  if (root.name === "timelineCacheDefinition") return { name, kind: "timeline", pivots, field };
  if (root.name === "slicerCacheDefinition" && child(child(root, "data"), "tabular")) return { name, kind: "slicer", pivots, field };
  return null;
}

/** The state of a timeline cache: the dates it keeps, when it keeps some. */
export function readTimelineState(root: XmlElement | undefined): { start?: number; end?: number } {
  const state = child(root, "state");
  if (!state || attr(state, "filterType") === "unknown" || attr(state, "filterType") === undefined) return {};
  const sel = child(state, "selection");
  const start = serialOfIso(attr(sel, "startDate"));
  const end = serialOfIso(attr(sel, "endDate"));
  return { ...(start !== null ? { start: Math.floor(start) } : {}), ...(end !== null ? { end: Math.floor(end) } : {}) };
}

export interface PendingPivotPanel {
  sheet: Sheet;
  cache: PivotCacheLink;
  caption?: string;
  style?: string;
  columns?: number;
  level?: PivotTimeline["level"];
  state: { start?: number; end?: number };
  from: PivotSlicer["from"];
  width: number;
  height: number;
}

/** The name and anchor of the slicer or timeline a drawing's top-level element holds. */
function panelIn(el: XmlElement, tag: "slicer" | "timeslicer"): { name: string; anchor: XmlElement } | undefined {
  const wrappers = el.name === "AlternateContent" ? [el] : childrenNamed(el, "AlternateContent");
  for (const wrapper of wrappers) {
    for (const choice of childrenNamed(wrapper, "Choice")) {
      const inner = el.name === "AlternateContent" ? elements(choice) : [choice];
      for (const owner of inner) {
        const frameEl = el.name === "AlternateContent" ? child(owner, "graphicFrame") : child(choice, "graphicFrame");
        const found = child(child(child(frameEl, "graphic"), "graphicData"), tag);
        if (found) return { name: attr(found, "name") ?? "", anchor: el.name === "AlternateContent" ? owner : el };
      }
    }
  }
  return undefined;
}

/**
 * The slicers and timelines of a sheet that filter pivot tables. `caches` maps a cache name to the pivot tables and field it
 * reads, `timelineStates` a timeline cache's name to the dates it keeps.
 */
export function readSheetPivotPanels(
  sheet: Sheet,
  drawing: XmlElement | undefined,
  slicersPart: XmlElement | undefined,
  timelinesPart: XmlElement | undefined,
  caches: ReadonlyMap<string, PivotCacheLink>,
  timelineStates: ReadonlyMap<string, { start?: number; end?: number }>,
): PendingPivotPanel[] {
  if (!drawing) return [];
  const slicers = new Map(childrenNamed(slicersPart, "slicer").map((s) => [attr(s, "name") ?? "", s]));
  const timelines = new Map(childrenNamed(timelinesPart, "timeline").map((s) => [attr(s, "name") ?? "", s]));
  const out: PendingPivotPanel[] = [];
  const clamp = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? Math.max(MIN_CHART_SIZE, Math.min(MAX_CHART_SIZE, Math.round(n))) : fallback);
  for (const wrapper of elements(drawing)) {
    for (const tag of ["slicer", "timeslicer"] as const) {
      const found = panelIn(wrapper, tag);
      if (!found) continue;
      const entry = (tag === "slicer" ? slicers : timelines).get(found.name);
      const cache = entry ? caches.get(attr(entry, "cache") ?? "") : undefined;
      if (!entry || !cache || cache.kind !== (tag === "slicer" ? "slicer" : "timeline")) continue;
      const box = anchorBox(found.anchor, sheet);
      const columns = Number(attr(entry, "columnCount") ?? 1);
      const level = LEVELS[Number(attr(entry, "level") ?? 2)];
      const style = attr(entry, "style");
      out.push({
        sheet,
        cache,
        ...(attr(entry, "caption") ? { caption: attr(entry, "caption")! } : {}),
        ...(style && style !== "SlicerStyleLight1" && style !== "TimeSlicerStyleLight1" ? { style } : {}),
        ...(tag === "slicer" && columns > 1 ? { columns: Math.min(20, Math.floor(columns)) } : {}),
        ...(tag === "timeslicer" && level && level !== "months" ? { level } : {}),
        state: tag === "timeslicer" ? (timelineStates.get(cache.name) ?? {}) : {},
        from: { row: Math.max(1, box.row), col: Math.max(1, box.col), ...(box.dx > 0.5 ? { dx: Math.round(box.dx) } : {}), ...(box.dy > 0.5 ? { dy: Math.round(box.dy) } : {}) },
        width: clamp(box.width, tag === "slicer" ? DEFAULT_PIVOT_SLICER_WIDTH : DEFAULT_PIVOT_TIMELINE_WIDTH),
        height: clamp(box.height, tag === "slicer" ? DEFAULT_PIVOT_SLICER_HEIGHT : DEFAULT_PIVOT_TIMELINE_HEIGHT),
      });
    }
  }
  return out;
}

/** Puts a pending slicer or timeline on the pivot table it filters; false when that pivot table isn't a pivot table Pli kept. */
export function attachPivotPanel(p: PendingPivotPanel, pivot: Pivot): boolean {
  const base = { id: createId(p.cache.kind === "slicer" ? "pslicer_" : "ptimeline_"), field: p.cache.field, from: p.from, width: p.width, height: p.height, ...(p.caption && p.caption !== p.cache.field ? { caption: p.caption } : {}), ...(p.style ? { style: p.style } : {}) };
  if (p.cache.kind === "slicer") (pivot.slicers ??= []).push({ ...base, ...(p.columns ? { columns: p.columns } : {}) });
  else (pivot.timelines ??= []).push({ ...base, ...(p.level ? { level: p.level } : {}), ...(p.state.start !== undefined ? { start: p.state.start } : {}), ...(p.state.end !== undefined ? { end: p.state.end } : {}) });
  return true;
}
