import { parseRange } from "./address";
import type { Sheet } from "./model";
import { groupsOf, levelsOf } from "./outline";
import { dataRows } from "./table";

/** The rows a collapsed group hides, for a sheet's rows (kept for as long as the rows are the same object, since a cell asks for every row it adds up). */
const foldedCache = new WeakMap<object, ReadonlySet<number>>();
function foldedRows(sheet: Sheet): ReadonlySet<number> {
  const dims = sheet.rows;
  if (!dims) return new Set();
  let hit = foldedCache.get(dims);
  if (!hit) {
    const levels = levelsOf(dims, "row");
    const rows = new Set<number>();
    for (const g of groupsOf(sheet, "row")) {
      if (!g.collapsed) continue;
      for (let r = g.from; r <= g.to; r++) if ((levels.get(r) ?? 0) >= g.level) rows.add(r);
    }
    hit = rows;
    foldedCache.set(dims, hit);
  }
  return hit;
}

/**
 * Whether a row is hidden, for `SUBTOTAL`: any hidden row, or (with `filteredOnly`) only a row a filter hid. A filter hides rows
 * the way anything else does, so a hidden row counts as filtered when it is a data row of the sheet's filter or of a table.
 * (Rows folded away in a group or hidden by hand are not filtered, so `SUBTOTAL(9, …)` still adds them and `SUBTOTAL(109, …)` does not.)
 * A row that a collapsed group hides is taken to be hidden by the group, not by the filter, even if it lies in the filter's range.
 */
export function rowIsHidden(sheet: Sheet | undefined, row: number, filteredOnly: boolean): boolean {
  if (!sheet?.rows?.[String(row)]?.hidden) return false;
  if (!filteredOnly) return true;
  if (foldedRows(sheet!).has(row)) return false;
  const f = sheet.filter && parseRange(sheet.filter.range);
  if (f && row > f.r1 && row <= f.r2 && Object.keys(sheet.filter!.columns ?? {}).length) return true;
  for (const t of sheet.tables ?? []) {
    if (!t.filters || !Object.keys(t.filters).length) continue;
    const b = parseRange(t.range);
    if (!b) continue;
    const [top, bottom] = dataRows(t, b);
    if (row >= top && row <= bottom) return true;
  }
  return false;
}
