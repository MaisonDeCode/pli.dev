import { PliError } from "@pli.dev/core";
import type { IconRef, SortLevel, TableSort } from "./model";
import { ICON_SETS } from "./rule";
import { compareValues, isError, type Value } from "./values";

/*
 * Sorting by more than one column, and by colour or icon, as Excel's Sort dialog does. A sort is a list of levels. A level
 * orders by the cells' values, or puts the cells of one colour (a fill, a font colour) or one icon first or last; rows a
 * level can't tell apart go on to the next level, and rows that no level tells apart keep the order they had.
 */

const COLOR = /^#[0-9a-f]{6}$/i;
const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

export const SORT_BYS = ["cellColor", "fontColor", "icon"] as const;

/** The most levels a sort has (Excel's is 64). */
export const MAX_SORT_LEVELS = 64;

/** What the sort of one cell looks at: its value, the fill and font colours it shows, and the icon a conditional format puts in it. */
export interface SortCell {
  value: Value;
  /** `#rrggbb`, or `none` when the cell shows no fill. */
  fill: string;
  /** `#rrggbb`, or `auto` for the default font colour. */
  font: string;
  icon: IconRef | null;
}

/** A level of a sort on a range given to `session.sort`: `column` is the column of the range (1 is its first). */
export type RangeSortLevel = Omit<SortLevel, "column" | "descending"> & { column: number; descending?: boolean };

/** A level of a sort on a range inside the sorter: `col` is the sheet column (1 is A). */
export interface SortKey {
  col: number;
  descending?: boolean | undefined;
  by?: (typeof SORT_BYS)[number] | undefined;
  color?: string | undefined;
  icon?: IconRef | null | undefined;
}

/** A level of a table's sort made ready to keep (the column's name is checked by the caller against the table). */
export function cleanSortLevel(level: SortLevel): SortLevel {
  if (!level || typeof level !== "object") return bad("A sort level is an object with a column");
  if (typeof level.column !== "string" || level.column === "") bad("A sort level needs the name of a column");
  const out: SortLevel = { column: level.column };
  if (level.descending) out.descending = true;
  if (level.by === undefined) {
    if (level.color !== undefined || level.icon !== undefined) bad("A sort level that orders by value has no colour or icon");
    return out;
  }
  if (!SORT_BYS.includes(level.by)) bad(`A sort level orders by value, ${SORT_BYS.join(", ")}`);
  out.by = level.by;
  if (level.by === "icon") {
    const icon = level.icon;
    if (level.color !== undefined) bad("A sort by icon has no colour");
    if (icon === undefined) return bad("A sort by icon needs the icon to put first, or null for cells with no icon");
    if (icon === null) out.icon = null;
    else {
      const count = ICON_SETS[icon.set];
      if (!count) return bad(`An icon set is one of ${Object.keys(ICON_SETS).join(", ")}`);
      if (!Number.isInteger(icon.index) || icon.index < 0 || icon.index >= count) bad(`The icon is number 0 to ${count - 1} of its set`);
      out.icon = { set: icon.set, index: icon.index };
    }
    return out;
  }
  if (level.icon !== undefined) bad("A sort by colour has no icon");
  const none = level.by === "cellColor" ? "none" : "auto";
  const color = level.color;
  if (typeof color !== "string" || (color !== none && !COLOR.test(color))) return bad(`A sort by colour needs a colour like #rrggbb, or "${none}"`);
  out.color = color === none ? none : color.toLowerCase();
  return out;
}

/** The levels of a table's sort, first level first. */
export function sortLevels(sort: TableSort | undefined): SortLevel[] {
  if (!sort) return [];
  const { then, ...first } = sort;
  return [first, ...(then ?? [])];
}

/** A list of levels as the table keeps them: the first, with the others in `then`. */
export function tableSortOf(levels: readonly SortLevel[]): TableSort | undefined {
  if (!levels.length) return undefined;
  const [first, ...rest] = levels;
  return rest.length ? { ...first!, then: rest } : { ...first! };
}

/** The levels of a table's sort made ready to keep: at least one, each checked, no column twice with the same order by. */
export function cleanSortLevels(levels: readonly SortLevel[]): SortLevel[] {
  if (!Array.isArray(levels) || levels.length === 0) bad("A sort needs at least one level");
  if (levels.length > MAX_SORT_LEVELS) bad(`A sort has at most ${MAX_SORT_LEVELS} levels`);
  const out = levels.map(cleanSortLevel);
  const seen = new Set<string>();
  for (const l of out) {
    // Excel refuses the same column sorted twice by the same thing (the same colour or icon counts as the same thing).
    const key = `${l.column.toLowerCase()}|${l.by ?? "value"}|${l.color ?? ""}|${l.icon === undefined ? "" : l.icon === null ? "none" : `${l.icon.set}${l.icon.index}`}`;
    if (seen.has(key)) bad(`The column "${l.column}" is sorted by the same thing twice`);
    seen.add(key);
  }
  return out;
}

/** The sort with each column name run through `map` (a renamed column), or without the levels `map` returns `null` for. */
export function mapSortColumns(sort: TableSort | undefined, map: (column: string) => string | null): TableSort | undefined {
  if (!sort) return undefined;
  const levels: SortLevel[] = [];
  for (const l of sortLevels(sort)) {
    const column = map(l.column);
    if (column !== null) levels.push({ ...l, column });
  }
  return tableSortOf(levels);
}

export const sameIcon = (a: IconRef | null | undefined, b: IconRef | null | undefined): boolean => (a ?? null) === (b ?? null) || (!!a && !!b && a.set === b.set && a.index === b.index);

/** How two rows compare, given the levels: negative when `a` goes first. 0 when no level tells them apart. */
export function compareRows(keys: readonly SortKey[], a: (key: SortKey) => SortCell, b: (key: SortKey) => SortCell): number {
  for (const key of keys) {
    const x = a(key);
    const y = b(key);
    let order = 0;
    if (key.by === undefined) {
      const kx = x.value;
      const ky = y.value;
      // Empty cells and errors go last whichever way the order runs.
      if (kx === null || ky === null) order = kx === ky ? 0 : kx === null ? 1 : -1;
      else if (isError(kx) || isError(ky)) order = isError(kx) === isError(ky) ? 0 : isError(kx) ? 1 : -1;
      else order = compareValues(kx, ky) * (key.descending ? -1 : 1);
    } else {
      const hit = (c: SortCell) => (key.by === "cellColor" ? c.fill === key.color : key.by === "fontColor" ? c.font === key.color : sameIcon(c.icon, key.icon));
      const hx = hit(x);
      const hy = hit(y);
      // The cells with the colour or icon go on top, or at the bottom when the level is descending.
      if (hx !== hy) order = (hx ? -1 : 1) * (key.descending ? -1 : 1);
    }
    if (order !== 0) return order;
  }
  return 0;
}
