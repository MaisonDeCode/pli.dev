import { createId, PliError } from "@pli.dev/core";
import { cellAddress, parseRange, rangeAddress, type Bounds } from "./address";
import type { Cell, ConditionalRule, Sheet, Validation } from "./model";
import type { SheetOp } from "./ops";
import type { PasteContent } from "./paste";
import { blendCell } from "./pastehtml";
import { mapRuleFormulas, mergedRanges, overlaps, ruleBounds } from "./rule";
import { shiftFormula } from "./refs";
import { transposeCell, transposedAt, transposedBounds, transposeFormula } from "./transpose";
import { mapValidationFormulas } from "./validation";

/*
 * A copy of cells of the workbook to another place with Paste special > Transpose: the operations that make it. Kept apart
 * from `SheetSession.copy` (which is the straight copy) because nothing about where a cell lands is a plain shift.
 */

export interface TransposePlan {
  ops: SheetOp[];
  /** The cells written, for the check data validation makes. */
  target: Bounds;
}

const within = (inner: Bounds, outer: Bounds) => inner.r1 >= outer.r1 && inner.r2 <= outer.r2 && inner.c1 >= outer.c1 && inner.c2 <= outer.c2;
const same = (a: Bounds, b: Bounds) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;

/** What is left of `r` when `cut` is taken out of it: up to four rectangles. */
function subtract(r: Bounds, cut: Bounds): Bounds[] {
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

export interface TransposeInput {
  src: Sheet;
  dst: Sheet;
  /** The cells copied. */
  b: Bounds;
  /** Where the top left of the result goes. */
  origin: { row: number; col: number };
  cut: boolean;
  content: PasteContent;
  /** What a copied cell brings to a paste of values or formulas (the cell, or the value its formula gives). */
  contentOf(key: string, cell: Cell | null): Cell | null;
}

/**
 * The operations that copy `b` of `src` to `dst` with its rows and columns exchanged. Merged cells, conditional formats and
 * data validation turn with the cells, the ones in the way are replaced, and a `cut` empties the cells it took from.
 * Throws when part of a merged range is in the copy, or the place it goes to has merged cells of another shape.
 */
export function planTransposedCopy(i: TransposeInput): TransposePlan {
  const { src, dst, b, origin, cut } = i;
  const content = cut ? "all" : i.content;
  const target = transposedBounds(b, origin, b);
  const writes: Record<string, Cell | null> = {};
  const clears: Record<string, Cell | null> = {};
  for (let r = b.r1; r <= b.r2; r++)
    for (let c = b.c1; c <= b.c2; c++) {
      const key = cellAddress(r, c);
      const cell = src.cells[key];
      const to = transposedAt(b, origin, r, c);
      const targetKey = cellAddress(to.row, to.col);
      writes[targetKey] = cell ? transposeCell(cell, { from: { row: r, col: c }, to }) : null;
      if (cut && cell) clears[key] = null;
      if (content !== "all") writes[targetKey] = blendCell(content, dst.cells[targetKey], i.contentOf(key, writes[targetKey] ?? null));
    }
  const ops: SheetOp[] = [];
  if (cut && src.id === dst.id) ops.push({ type: "set_cells", sheet: src.id, cells: { ...clears, ...writes } });
  else {
    if (cut) ops.push({ type: "set_cells", sheet: src.id, cells: clears });
    ops.push({ type: "set_cells", sheet: dst.id, cells: writes });
  }
  if (content === "all" || content === "formats") ops.push(...mergeOps(src, dst, b, origin, target, cut), ...formatOps(src, dst, b, origin, target, cut));
  return { ops, target };
}

function mergeOps(src: Sheet, dst: Sheet, b: Bounds, origin: { row: number; col: number }, target: Bounds, cut: boolean): SheetOp[] {
  const moving = mergedRanges(src).filter((m) => within(m, b));
  for (const m of mergedRanges(src)) if (overlaps(m, b) && !within(m, b)) throw new PliError("invalid_operation", `${rangeAddress(m)} is merged, and only part of it is in the cells. Take all of the merged cells, or unmerge them first.`);
  const arriving = moving.map((m) => transposedBounds(b, origin, m));
  for (const m of mergedRanges(dst)) {
    if (!overlaps(m, target)) continue;
    if (cut && src.id === dst.id && within(m, b)) continue;
    if (arriving.some((a) => same(a, m))) continue;
    throw new PliError("invalid_operation", `The cells they would go to include merged cells (${rangeAddress(m)}). Choose other cells, or unmerge those first.`);
  }
  const ops: SheetOp[] = [];
  const dropped = new Set<string>();
  const drop = (sheet: Sheet, m: Bounds) => {
    const key = `${sheet.id}|${rangeAddress(m)}`;
    if (dropped.has(key)) return;
    dropped.add(key);
    ops.push({ type: "remove_merge", sheet: sheet.id, range: rangeAddress(m) });
  };
  if (cut) for (const m of moving) drop(src, m);
  for (const m of mergedRanges(dst)) if (overlaps(m, target)) drop(dst, m);
  for (const a of arriving) ops.push({ type: "add_merge", sheet: dst.id, range: rangeAddress(a) });
  return ops;
}

/** Conditional formats and data validation follow the cells: the part of a rule over the copied cells covers where they land. */
function formatOps(src: Sheet, dst: Sheet, b: Bounds, origin: { row: number; col: number }, target: Bounds, cut: boolean): SheetOp[] {
  if (!src.conditional?.length && !src.validations?.length && !dst.conditional?.length && !dst.validations?.length) return [];
  const ops: SheetOp[] = [];
  type Rule = { id: string; ranges: string[] };
  const handle = (kind: "rule" | "validation") => {
    const list = (sheet: Sheet) => (kind === "rule" ? sheet.conditional : sheet.validations) as Rule[] | undefined;
    const trims = new Map<string, { sheet: Sheet; cutters: Bounds[] }>();
    const trim = (sheet: Sheet, id: string, cutter: Bounds) => {
      const key = `${sheet.id}|${id}`;
      const t = trims.get(key) ?? { sheet, cutters: [] };
      t.cutters.push(cutter);
      trims.set(key, t);
    };
    const copies: { rule: Rule; ranges: string[]; origin: { row: number; col: number }; first: { row: number; col: number } }[] = [];
    for (const rule of list(src) ?? []) {
      const pieces: Bounds[] = [];
      for (const r of rule.ranges) {
        const x = parseRange(r)!;
        const p: Bounds = { r1: Math.max(x.r1, b.r1), c1: Math.max(x.c1, b.c1), r2: Math.min(x.r2, b.r2), c2: Math.min(x.c2, b.c2) };
        if (p.r1 <= p.r2 && p.c1 <= p.c2) pieces.push(p);
      }
      if (!pieces.length) continue;
      const all = ruleBounds(rule.ranges);
      const turned = pieces.map((p) => transposedBounds(b, origin, p));
      copies.push({
        rule,
        ranges: turned.map(rangeAddress),
        origin: { row: Math.min(...all.map((x) => x.r1)), col: Math.min(...all.map((x) => x.c1)) },
        first: { row: Math.min(...turned.map((p) => p.r1)), col: Math.min(...turned.map((p) => p.c1)) },
      });
      if (cut) trim(src, rule.id, b);
    }
    for (const rule of list(dst) ?? []) if (ruleBounds(rule.ranges).some((x) => overlaps(x, target))) trim(dst, rule.id, target);
    for (const [key, { sheet, cutters }] of trims) {
      const id = key.slice(key.indexOf("|") + 1);
      const rule = list(sheet)!.find((r) => r.id === id)!;
      let rects = ruleBounds(rule.ranges);
      for (const c of cutters) rects = rects.flatMap((r) => subtract(r, c));
      const kept = rects.map(rangeAddress);
      if (kept.length === rule.ranges.length && kept.every((k, n) => k === rule.ranges[n])) continue;
      if (kind === "rule") ops.push(kept.length ? { type: "update_rule", sheet: sheet.id, rule: { ...rule, ranges: kept } as ConditionalRule } : { type: "delete_rule", sheet: sheet.id, id });
      else ops.push(kept.length ? { type: "update_validation", sheet: sheet.id, validation: { ...rule, ranges: kept } as Validation } : { type: "delete_validation", sheet: sheet.id, id });
    }
    for (const c of copies) {
      // The formulas of a rule read from the top left cell of its first range: turned there, then moved to where the copy's own top left is.
      const anchorFrom = { row: c.origin.row, col: c.origin.col };
      const home = transposedAt(b, origin, anchorFrom.row, anchorFrom.col);
      const shift = (f: string) => {
        try {
          const turned = transposeFormula(f, anchorFrom, home);
          return shiftFormula(turned, c.first.row - home.row, c.first.col - home.col);
        } catch {
          return f;
        }
      };
      if (kind === "rule") {
        const { pivot: _pivot, ...plain } = c.rule as ConditionalRule;
        ops.push({ type: "add_rule", sheet: dst.id, rule: mapRuleFormulas({ ...plain, id: createId("rule_"), ranges: c.ranges } as ConditionalRule, shift) });
      } else ops.push({ type: "add_validation", sheet: dst.id, validation: mapValidationFormulas({ ...(c.rule as Validation), id: createId("valid_"), ranges: c.ranges } as Validation, shift) });
    }
  };
  handle("rule");
  handle("validation");
  return ops;
}
