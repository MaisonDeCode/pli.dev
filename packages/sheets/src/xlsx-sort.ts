import { attr, childrenNamed, type XmlElement } from "@pli.dev/core";
import { parseRange, rangeAddress, type Bounds } from "./address";
import type { ConditionalStyle, IconSetName, SortLevel, TableSort } from "./model";
import { ICON_SETS } from "./rule";
import { tableSortOf } from "./sortlevels";
import type { FilterDxf } from "./xlsx-filter";

/*
 * A table's sort in an .xlsx file: a `sortState` over the data rows with a `sortCondition` for each level. A condition names
 * the column's cells (`ref`), whether it is `descending`, and, for a sort by colour or icon, `sortBy` with the style that holds
 * the colour (`dxfId`) or the icon set and the icon in it (`iconSet`, `iconId`). By colour or icon, Excel's "descending" is
 * "on bottom".
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The icon sets the file format's own list holds; the sets Excel 2010 added (and "no icon") are written in an extension that Pli doesn't write. */
const BASE_ICON_SETS = new Set<string>(["3Arrows", "3ArrowsGray", "3Flags", "3TrafficLights1", "3TrafficLights2", "3Signs", "3Symbols", "3Symbols2", "4Arrows", "4ArrowsGray", "4RedToBlack", "4Rating", "4TrafficLights", "5Arrows", "5ArrowsGray", "5Rating", "5Quarters"]);

/**
 * The `sortState` of a sort. `rows` are the data rows (`r1` to `r2`, the columns of the table). Levels that the file can't
 * hold (an icon from Excel 2010's sets, or "no icon") are left out; the rows are in their sorted order all the same.
 */
export function sortStateXml(sort: TableSort | undefined, names: readonly string[], rows: Bounds, dxf: (look: FilterDxf) => number): string {
  if (!sort) return "";
  const conditions: string[] = [];
  const levels = [sort, ...(sort.then ?? [])];
  for (const level of levels) {
    const at = names.indexOf(level.column);
    if (at < 0) continue;
    const ref = rangeAddress({ r1: rows.r1, r2: rows.r2, c1: rows.c1 + at, c2: rows.c1 + at });
    const down = level.descending ? ' descending="1"' : "";
    if (level.by === undefined) conditions.push(`<sortCondition${down} ref="${ref}"/>`);
    else if (level.by === "icon") {
      if (!level.icon || !BASE_ICON_SETS.has(level.icon.set)) continue;
      conditions.push(`<sortCondition${down} ref="${ref}" sortBy="icon" iconSet="${esc(level.icon.set)}" iconId="${level.icon.index}"/>`);
    } else {
      const look: FilterDxf = level.by === "cellColor" ? (level.color === "none" ? "nofill" : { fill: level.color! }) : level.color === "auto" ? "autofont" : { color: level.color! };
      conditions.push(`<sortCondition${down} ref="${ref}" sortBy="${level.by}" dxfId="${dxf(look)}"/>`);
    }
  }
  if (!conditions.length) return "";
  return `<sortState ref="${rangeAddress(rows)}">${conditions.join("")}</sortState>`;
}

/** The sort a `sortState` stands for. Levels that can't be read are left out and named in `skipped`. */
export function readSortState(state: XmlElement | undefined, names: readonly string[], table: Bounds, dxfs: readonly ConditionalStyle[], skipped?: (why: string) => void): TableSort | undefined {
  const levels: SortLevel[] = [];
  for (const c of childrenNamed(state, "sortCondition")) {
    const ref = parseRange((attr(c, "ref") ?? "").replace(/\$/g, ""));
    if (!ref || ref.c1 !== ref.c2) {
      skipped?.("it sorts a range that isn't one column");
      continue;
    }
    const column = names[ref.c1 - table.c1];
    if (!column) continue;
    const down = attr(c, "descending") === "1" || attr(c, "descending") === "true" ? { descending: true as const } : {};
    const by = attr(c, "sortBy") ?? "value";
    if (by === "value") levels.push({ column, ...down });
    else if (by === "cellColor" || by === "fontColor") {
      const style = dxfs[Number(attr(c, "dxfId"))];
      if (!style) {
        skipped?.("its colour isn't in the file's styles");
        continue;
      }
      levels.push({ column, ...down, by, color: by === "cellColor" ? style.fill ?? "none" : style.color ?? "auto" });
    } else if (by === "icon") {
      const set = (attr(c, "iconSet") ?? "3Arrows") as IconSetName;
      const index = Number(attr(c, "iconId") ?? 0);
      if (!ICON_SETS[set] || !Number.isInteger(index) || index < 0 || index >= ICON_SETS[set]) {
        skipped?.("it sorts by an icon Pli doesn't have");
        continue;
      }
      levels.push({ column, ...down, by: "icon", icon: { set, index } });
    } else skipped?.(`it sorts by "${by}"`);
  }
  return tableSortOf(levels);
}
