import { rangeAddress, type Bounds } from "./address";
import type { Sheet } from "./model";
import { mergedRanges, overlaps } from "./rule";

const within = (inner: Bounds, outer: Bounds) => inner.r1 >= outer.r1 && inner.r2 <= outer.r2 && inner.c1 >= outer.c1 && inner.c2 <= outer.c2;
const same = (a: Bounds, b: Bounds) => a.r1 === b.r1 && a.r2 === b.r2 && a.c1 === b.c1 && a.c2 === b.c2;

/**
 * Why cells can't be copied or moved from `b` to `target`, as far as merged cells are concerned, or null when they can:
 * only part of a merged range is being taken (select the whole of it), or the place it goes to holds a merged range of
 * another shape (one the same size and in the same place as a merged range that arrives is simply replaced).
 */
export function mergeClash(src: Sheet, dst: Sheet, b: Bounds, target: Bounds, cut: boolean): string | null {
  const moving = mergedRanges(src).filter((m) => within(m, b));
  for (const m of mergedRanges(src))
    if (overlaps(m, b) && !within(m, b)) return `${rangeAddress(m)} is merged, and only part of it is in the cells. Take all of the merged cells, or unmerge them first.`;
  if (src.id === dst.id && b.r1 === target.r1 && b.c1 === target.c1) return null;
  const dRow = target.r1 - b.r1;
  const dCol = target.c1 - b.c1;
  const arriving = moving.map((m) => ({ r1: m.r1 + dRow, c1: m.c1 + dCol, r2: m.r2 + dRow, c2: m.c2 + dCol }));
  for (const m of mergedRanges(dst)) {
    if (!overlaps(m, target)) continue;
    // A merged range that is itself being moved away doesn't stand in the way.
    if (cut && src.id === dst.id && within(m, b)) continue;
    if (arriving.some((a) => same(a, m))) continue;
    return `The cells they would go to include merged cells (${rangeAddress(m)}). Choose other cells, or unmerge those first.`;
  }
  return null;
}

/** Why a fill from `source` to the filled-in area `filled` can't go ahead as far as merged cells are concerned, or null. */
export function fillClash(sheet: Sheet, source: Bounds, filled: Bounds): string | null {
  for (const m of mergedRanges(sheet)) {
    if (overlaps(m, source) && !within(m, source)) return `${rangeAddress(m)} is merged, and only part of it is being filled from. Fill from all of the merged cells, or unmerge them first.`;
    if (overlaps(m, filled) && !within(m, source)) return `The cells to fill include merged cells (${rangeAddress(m)}). Choose other cells, or unmerge those first.`;
  }
  return null;
}

/**
 * The merged ranges a fill makes: each merged range inside `source` is repeated every `period` rows (or columns, when not
 * `vertical`) over the filled area, the same way the cells are. A copy that would be cut off by the end of the fill is not merged.
 */
export function filledMerges(sheet: Sheet, source: Bounds, filled: Bounds, vertical: boolean, period: number): Bounds[] {
  const out: Bounds[] = [];
  for (const m of mergedRanges(sheet)) {
    if (!within(m, source)) continue;
    const reach = vertical ? filled.r2 - filled.r1 + 1 : filled.c2 - filled.c1 + 1;
    const turns = Math.ceil(reach / period) + 1;
    for (let n = -turns; n <= turns; n++) {
      if (n === 0) continue;
      const shift = n * period;
      const copy: Bounds = vertical ? { ...m, r1: m.r1 + shift, r2: m.r2 + shift } : { ...m, c1: m.c1 + shift, c2: m.c2 + shift };
      if (within(copy, filled) && !within(copy, source)) out.push(copy);
    }
  }
  return out;
}
