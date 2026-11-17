import { attr, child, childrenNamed, createId, type XmlElement } from "@pli.dev/core";
import { MAX_CHART_SIZE, MIN_CHART_SIZE } from "./chart";
import type { Sheet, Timeline, TimelineLevel, Workbook } from "./model";
import { DEFAULT_TIMELINE_HEIGHT, DEFAULT_TIMELINE_WIDTH, TIMELINE_LEVELS } from "./timeline";

/*
 * Timelines on tables in an .xlsx file. Excel has timelines for pivot tables only, so a timeline over a table has no part of
 * Excel's own to live in. What the file keeps is the filter it makes (the table's filter on the date column, which is dates
 * picked from the tree) and, so that Pli finds the timeline again, an extension of the worksheet that Excel doesn't know and
 * passes by. It names the table and column and says where the timeline sits.
 */

const NS = "urn:pli:sheets:timelines";
/** The identifier of the worksheet extension. */
const URI = "{0C6B1D3E-5A52-4F0E-8E5B-7D9A3F61B2C4}";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** The `ext` of a worksheet's `extLst` that holds its timelines, or "" when it has none. */
export function timelinesExt(wb: Workbook, sheet: Sheet): string {
  const entries: string[] = [];
  for (const t of sheet.timelines ?? []) {
    const table = wb.sheets.flatMap((s) => s.tables ?? []).find((x) => x.id === t.table);
    if (!table) continue;
    entries.push(
      `<pli:timeline table="${esc(table.name)}" column="${esc(t.column)}"${t.caption ? ` caption="${esc(t.caption)}"` : ""} level="${t.level}" row="${t.from.row}" col="${t.from.col}"${t.from.dx ? ` dx="${t.from.dx}"` : ""}${t.from.dy ? ` dy="${t.from.dy}"` : ""} width="${t.width}" height="${t.height}"${t.style ? ` style="${esc(t.style)}"` : ""}/>`,
    );
  }
  return entries.length ? `<ext uri="${URI}" xmlns:pli="${NS}"><pli:timelines>${entries.join("")}</pli:timelines></ext>` : "";
}

export interface PendingTimeline {
  sheet: Sheet;
  table: string;
  timeline: Omit<Timeline, "id" | "table">;
}

/** The timelines a worksheet's `extLst` keeps, with the name of the table each filters. */
export function readTimelinesExt(sheet: Sheet, extLst: XmlElement | undefined): PendingTimeline[] {
  const out: PendingTimeline[] = [];
  for (const ext of childrenNamed(extLst, "ext")) {
    if (attr(ext, "uri") !== URI) continue;
    for (const el of childrenNamed(child(ext, "timelines"), "timeline")) {
      const table = attr(el, "table");
      const column = attr(el, "column");
      const level = attr(el, "level") as TimelineLevel | undefined;
      const row = Number(attr(el, "row"));
      const col = Number(attr(el, "col"));
      if (!table || !column || !Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) continue;
      const size = (name: string, fallback: number) => {
        const n = Number(attr(el, name));
        return Number.isFinite(n) && n > 0 ? Math.max(MIN_CHART_SIZE, Math.min(MAX_CHART_SIZE, Math.round(n))) : fallback;
      };
      const dx = Number(attr(el, "dx") ?? 0);
      const dy = Number(attr(el, "dy") ?? 0);
      out.push({
        sheet,
        table,
        timeline: {
          column,
          from: { row, col, ...(dx > 0 ? { dx } : {}), ...(dy > 0 ? { dy } : {}) },
          width: size("width", DEFAULT_TIMELINE_WIDTH),
          height: size("height", DEFAULT_TIMELINE_HEIGHT),
          level: level && TIMELINE_LEVELS.includes(level) ? level : "months",
          ...(attr(el, "caption") ? { caption: attr(el, "caption")! } : {}),
          ...(attr(el, "style") ? { style: attr(el, "style")! } : {}),
        },
      });
    }
  }
  return out;
}

/** A pending timeline as a timeline on the table it names. */
export const timelineOf = (p: PendingTimeline, tableId: string): Timeline => ({ id: createId("timeline_"), table: tableId, ...p.timeline });
