import { rangeAddress, type Bounds } from "./address";
import type { SheetOp } from "./ops";
import type { Sheet, Validation } from "./model";
import { shiftFormula } from "./refs";
import { ruleBounds } from "./rule";
import { mapValidationFormulas, validationOrigin } from "./validation";

/*
 * Filling carries the data validation of the cell it copies from, as Excel's fill handle and Fill Down do: each cell filled
 * gets the rule that covers the cell it was copied from (or none, when that cell has no rule), in place of whatever rule it
 * had. A rule's relative references keep meaning the same thing, because the rule simply grows to cover the new cells; when a
 * fill upward or to the left moves the rule's top-left corner, its formulas are written again from the new corner.
 */

/** A cell filled and the cell it copies. */
export type FillPair = readonly [row: number, col: number, fromRow: number, fromCol: number];

const covers = (b: readonly Bounds[], r: number, c: number) => b.some((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);

/** Cells as the fewest rectangles: runs along each row, joined when the same run sits in the next row. */
function rectangles(cells: readonly (readonly [number, number])[]): Bounds[] {
  const byRow = new Map<number, number[]>();
  for (const [r, c] of cells) (byRow.get(r) ?? byRow.set(r, []).get(r)!).push(c);
  const runs: { r: number; c1: number; c2: number }[] = [];
  for (const [r, cols] of byRow) {
    cols.sort((a, b) => a - b);
    let start = cols[0]!;
    let last = start;
    for (const c of cols.slice(1)) {
      if (c === last + 1) last = c;
      else {
        runs.push({ r, c1: start, c2: last });
        start = last = c;
      }
    }
    runs.push({ r, c1: start, c2: last });
  }
  runs.sort((a, b) => a.c1 - b.c1 || a.c2 - b.c2 || a.r - b.r);
  const out: Bounds[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (prev && prev.c1 === run.c1 && prev.c2 === run.c2 && prev.r2 === run.r - 1) prev.r2 = run.r;
    else out.push({ r1: run.r, r2: run.r, c1: run.c1, c2: run.c2 });
  }
  return out;
}

/** Joins rectangles that sit edge to edge into one (`B1`, `B2:B4` into `B1:B4`), until no two can be. */
function joined(rects: readonly Bounds[]): Bounds[] {
  const out = rects.map((r) => ({ ...r }));
  for (let again = true; again; ) {
    again = false;
    for (let i = 0; i < out.length && !again; i++)
      for (let j = i + 1; j < out.length && !again; j++) {
        const a = out[i]!;
        const b = out[j]!;
        if (a.c1 === b.c1 && a.c2 === b.c2 && (a.r2 + 1 === b.r1 || b.r2 + 1 === a.r1)) out[i] = { r1: Math.min(a.r1, b.r1), r2: Math.max(a.r2, b.r2), c1: a.c1, c2: a.c2 };
        else if (a.r1 === b.r1 && a.r2 === b.r2 && (a.c2 + 1 === b.c1 || b.c2 + 1 === a.c1)) out[i] = { r1: a.r1, r2: a.r2, c1: Math.min(a.c1, b.c1), c2: Math.max(a.c2, b.c2) };
        else continue;
        out.splice(j, 1);
        again = true;
      }
  }
  return out;
}

/** What is left of `r` when `cut` is taken out of it. */
function without(r: Bounds, cut: Bounds): Bounds[] {
  if (r.r1 > cut.r2 || cut.r1 > r.r2 || r.c1 > cut.c2 || cut.c1 > r.c2) return [r];
  const out: Bounds[] = [];
  if (r.r1 < cut.r1) out.push({ ...r, r2: cut.r1 - 1 });
  if (r.r2 > cut.r2) out.push({ ...r, r1: cut.r2 + 1 });
  const r1 = Math.max(r.r1, cut.r1);
  const r2 = Math.min(r.r2, cut.r2);
  if (r.c1 < cut.c1) out.push({ r1, r2, c1: r.c1, c2: cut.c1 - 1 });
  if (r.c2 > cut.c2) out.push({ r1, r2, c1: cut.c2 + 1, c2: r.c2 });
  return out;
}

/** The operations that give the cells a fill writes the validation of the cells they copy. Empty when no rule is involved. */
export function fillValidationOps(sheet: Sheet, filled: Bounds, pairs: readonly FillPair[]): SheetOp[] {
  const rules = sheet.validations;
  if (!rules?.length || !pairs.length) return [];
  const rects = new Map<string, Bounds[]>(rules.map((r) => [r.id, ruleBounds(r.ranges)]));
  const first = (r: number, c: number): Validation | undefined => rules.find((rule) => covers(rects.get(rule.id)!, r, c));
  const inherits = new Map<string, [number, number][]>();
  for (const [r, c, fr, fc] of pairs) {
    const rule = first(fr, fc);
    if (rule) (inherits.get(rule.id) ?? inherits.set(rule.id, []).get(rule.id)!).push([r, c]);
  }
  const ops: SheetOp[] = [];
  for (const rule of rules) {
    const mine = rects.get(rule.id)!;
    const gets = inherits.get(rule.id) ?? [];
    const getsKeys = new Set(gets.map(([r, c]) => `${r}:${c}`));
    // Changed when a filled cell is covered now and won't be, or the other way round.
    const loses = pairs.some(([r, c]) => covers(mine, r, c) && !getsKeys.has(`${r}:${c}`));
    const gains = gets.some(([r, c]) => !covers(mine, r, c));
    if (!loses && !gains) continue;
    const kept = mine.flatMap((b) => without(b, filled));
    const all = joined([...kept, ...rectangles(gets)]);
    if (!all.length) {
      ops.push({ type: "delete_validation", sheet: sheet.id, id: rule.id });
      continue;
    }
    const ranges = all.map(rangeAddress);
    let next: Validation = { ...rule, ranges } as Validation;
    // A fill up or to the left moves the corner the rule's relative references count from.
    const was = validationOrigin(rule);
    const now = validationOrigin(next);
    if (now.row !== was.row || now.col !== was.col) {
      next = mapValidationFormulas(next, (f) => {
        try {
          return shiftFormula(f, now.row - was.row, now.col - was.col);
        } catch {
          return f;
        }
      });
    }
    ops.push({ type: "update_validation", sheet: sheet.id, validation: next });
  }
  return ops;
}
