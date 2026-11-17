import { createId } from "@pli.dev/core";
import { rangeAddress, type Bounds } from "./address";
import { iconSvg } from "./cfhtml";
import type { HtmlCell, HtmlTable } from "./html";
import type { CfValue, ConditionalRule, IconSetName, Sheet } from "./model";
import type { SheetOp } from "./ops";
import { cleanRule, mapRuleFormulas, overlaps, ruleBounds } from "./rule";
import { cellFromInput } from "./input";
import { shiftFormula } from "./refs";

/*
 * Data bars and icon sets in the HTML a copy makes, and reading them back as conditional formats.
 *
 * What Excel and Google Sheets put on the clipboard has neither: Excel flattens a rule to the colours it gave each cell
 * (a data bar or icon becomes nothing) and Sheets has no such rules besides colour scales, so a bar or icon never arrives
 * from them. What Pli's own copy writes can come back:
 *   1. exactly, from `data-pli-cf` on the table: the rules that covered the copied cells, with where they began;
 *   2. when that mark is lost on the way (a mail program or editor in between that keeps only styles), from the pictures
 *      themselves: an icon is the icon set's own SVG in the cell's background, a bar a gradient as long as the bar. The
 *      rule is rebuilt to give the same icons and bars for the same numbers, which is the most the pixels can tell.
 */

const KINDS = new Set(["dataBar", "iconSet"]);

/** The part of a rule that is kept in the mark: everything but where it is and what it belongs to. */
type Kept = Record<string, unknown>;

export interface CfMark {
  /** Where the rule began on the source sheet (row and column of the top left of all its ranges), so that its formulas can follow the cells. */
  at: [number, number];
  /** The parts of the rule inside the copied cells, as `[row1, col1, row2, col2]` counted from the top left of the copy (zero-based). */
  pieces: [number, number, number, number][];
  rule: Kept;
}

/** ` data-pli-cf="…"` for the data bars and icon sets that cover the copied rows and columns (contiguous, in order), or "" for none. */
export function cfMarkAttribute(rules: readonly ConditionalRule[] | undefined, rowList: readonly number[], colList: readonly number[]): string {
  if (!rules?.length || !rowList.length || !colList.length) return "";
  const r0 = rowList[0]!;
  const c0 = colList[0]!;
  const r9 = rowList[rowList.length - 1]!;
  const c9 = colList[colList.length - 1]!;
  const marks: CfMark[] = [];
  for (const rule of rules) {
    if (!KINDS.has(rule.kind) || rule.pivot) continue;
    const pieces: CfMark["pieces"] = [];
    const all = ruleBounds(rule.ranges);
    for (const b of all) {
      const r1 = Math.max(b.r1, r0);
      const r2 = Math.min(b.r2, r9);
      const c1 = Math.max(b.c1, c0);
      const c2 = Math.min(b.c2, c9);
      if (r1 <= r2 && c1 <= c2) pieces.push([r1 - r0, c1 - c0, r2 - r0, c2 - c0]);
    }
    if (!pieces.length) continue;
    const { id: _id, ranges: _ranges, pivot: _pivot, ...rest } = rule as ConditionalRule & { pivot?: unknown };
    marks.push({ at: [Math.min(...all.map((b) => b.r1)), Math.min(...all.map((b) => b.c1))], pieces, rule: rest as Kept });
  }
  if (!marks.length) return "";
  return ` data-pli-cf="${JSON.stringify(marks).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`;
}

/** The marks a table's `data-pli-cf` holds, as far as they are well formed (a rule is checked again when it is made). */
export function readCfMarks(json: string | undefined): CfMark[] | undefined {
  if (!json) return undefined;
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  const int = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 2_000_000;
  const out: CfMark[] = [];
  for (const raw of list.slice(0, 100)) {
    const m = raw as Partial<CfMark> | null;
    if (!m || !Array.isArray(m.at) || m.at.length !== 2 || !m.at.every((n) => int(n) && n >= 1)) continue;
    if (!Array.isArray(m.pieces) || !m.pieces.length || m.pieces.length > 100) continue;
    const pieces = m.pieces.filter((p) => Array.isArray(p) && p.length === 4 && p.every(int) && p[0]! <= p[2]! && p[1]! <= p[3]!);
    if (pieces.length !== m.pieces.length) continue;
    if (!m.rule || typeof m.rule !== "object" || typeof (m.rule as Kept)["kind"] !== "string" || !KINDS.has((m.rule as Kept)["kind"] as string)) continue;
    out.push({ at: [m.at[0] as number, m.at[1] as number], pieces: pieces as CfMark["pieces"], rule: m.rule as Kept });
  }
  return out.length ? out : undefined;
}

/** What a paste of a table does about conditional formats: new rules for the cells it lands on, and the rules it covers cut back. */
export interface CfPaste {
  rules: ConditionalRule[];
  notes: string[];
}

// ---- rules from the mark ----

function fromMark(mark: CfMark, origin: { row: number; col: number }): ConditionalRule | null {
  const ranges = mark.pieces.map(([r1, c1, r2, c2]) => rangeAddress({ r1: origin.row + r1, c1: origin.col + c1, r2: origin.row + r2, c2: origin.col + c2 }));
  let rule: ConditionalRule;
  try {
    rule = cleanRule({ ...(mark.rule as object), id: createId("rule_"), ranges } as ConditionalRule);
  } catch {
    return null;
  }
  // The formulas of a rule are relative to its first cell: they move by the distance that cell moved.
  const first = { row: origin.row + Math.min(...mark.pieces.map((p) => p[0])), col: origin.col + Math.min(...mark.pieces.map((p) => p[1])) };
  return mapRuleFormulas(rule, (f) => {
    try {
      return shiftFormula(f, first.row - mark.at[0], first.col - mark.at[1]);
    } catch {
      return f;
    }
  });
}

// ---- rules from the pictures ----

const DEFAULT_STEPS: Record<number, number[]> = { 3: [33, 67], 4: [25, 50, 75], 5: [20, 40, 60, 80] };
const SETS: { set: IconSetName; count: number }[] = [
  { set: "3Arrows", count: 3 }, { set: "3ArrowsGray", count: 3 }, { set: "3Flags", count: 3 }, { set: "3TrafficLights1", count: 3 }, { set: "3TrafficLights2", count: 3 }, { set: "3Signs", count: 3 }, { set: "3Symbols", count: 3 }, { set: "3Symbols2", count: 3 }, { set: "3Stars", count: 3 }, { set: "3Triangles", count: 3 },
  { set: "4Arrows", count: 4 }, { set: "4ArrowsGray", count: 4 }, { set: "4RedToBlack", count: 4 }, { set: "4Rating", count: 4 }, { set: "4TrafficLights", count: 4 },
  { set: "5Arrows", count: 5 }, { set: "5ArrowsGray", count: 5 }, { set: "5Rating", count: 5 }, { set: "5Quarters", count: 5 }, { set: "5Boxes", count: 5 },
];

let glyphIndex: Map<string, { set: IconSetName; index: number; count: number }[]> | undefined;
/** Which icons of which sets draw as this picture (several sets share some of their icons). */
function glyphsOf(svg: string): { set: IconSetName; index: number; count: number }[] {
  if (!glyphIndex) {
    glyphIndex = new Map();
    for (const { set, count } of SETS)
      for (let index = 0; index < count; index++) {
        // The picture without its size, which is the cell's business.
        const key = iconSvg(set, index, count).replace(/ width="\d+" height="\d+"/, "");
        glyphIndex.set(key, [...(glyphIndex.get(key) ?? []), { set, index, count }]);
      }
  }
  return glyphIndex.get(svg.replace(/ width="\d+" height="\d+"/, "")) ?? [];
}

const iconOf = (background: string | undefined): { set: IconSetName; index: number; count: number }[] | null => {
  const m = background ? /url\("?data:image\/svg\+xml,([^")]*)"?\)/.exec(background) : null;
  if (!m) return null;
  let svg: string;
  try {
    svg = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  const hits = glyphsOf(svg);
  return hits.length ? hits : null;
};

interface Bar {
  from: number;
  to: number;
  color: string;
  solid: boolean;
  axis: boolean;
}

/** A bar drawn as the gradient `linear-gradient(90deg,transparent F%,C F%,E T%,transparent T%)`, and whether a zero line is drawn over it. */
function barOf(background: string | undefined): Bar | null {
  if (!background) return null;
  const layers = background.match(/linear-gradient\(90deg,[^;]*?\)(?=,(?:linear-gradient|url)|$)/g) ?? [];
  let bar: Bar | null = null;
  let axis = false;
  for (const layer of layers) {
    const m = /^linear-gradient\(90deg,transparent ([\d.]+)%,(#[0-9a-f]{6}) ([\d.]+)%,(#[0-9a-f]{6}) ([\d.]+)%,transparent ([\d.]+)%\)$/i.exec(layer);
    if (m && m[1] === m[3] && m[5] === m[6]) bar = { from: Number(m[1]) / 100, to: Number(m[5]) / 100, color: m[2]!.toLowerCase(), solid: m[2]!.toLowerCase() === m[4]!.toLowerCase(), axis: false };
    else if (/^linear-gradient\(90deg,transparent [\d.]+%,#[0-9a-f]{6} [\d.]+%,#[0-9a-f]{6} calc\(/i.test(layer)) axis = true;
  }
  return bar ? { ...bar, axis } : null;
}

type Placed = { row: number; col: number; cell: HtmlCell };

/** Rules rebuilt from the pictures of the cells: one icon set per column and set, one data bar per column. */
function fromLooks(placed: readonly Placed[], origin: { row: number; col: number }): ConditionalRule[] {
  const out: ConditionalRule[] = [];
  const byCol = new Map<number, Placed[]>();
  for (const p of placed) if (p.cell.background) byCol.set(p.col, [...(byCol.get(p.col) ?? []), p]);
  // The number a cell holds: the exact one the source gave, or what its text reads as when typed.
  const number = (p: Placed) => {
    if (typeof p.cell.value === "number") return p.cell.value;
    const typed = p.cell.text === "" ? null : cellFromInput(p.cell.text);
    return typed && typeof typed.v === "number" ? typed.v : null;
  };
  const at = new Map(placed.map((p) => [`${p.row}:${p.col}`, p]));
  for (const [col, cells] of [...byCol].sort((a, b) => a[0] - b[0])) {
    cells.sort((a, b) => a.row - b.row);
    // ---- icons: the smallest set that holds every icon seen ----
    const icons = cells.map((p) => ({ p, hits: iconOf(p.cell.background) })).filter((x): x is { p: Placed; hits: NonNullable<ReturnType<typeof iconOf>> } => x.hits !== null);
    if (icons.length) {
      const candidates = SETS.filter(({ set }) => icons.every((x) => x.hits.some((h) => h.set === set)));
      // The first of the smallest sets (the order above puts the usual ones first).
      const chosen = candidates.sort((a, b) => a.count - b.count)[0];
      if (chosen) {
        const levels = icons.map((x) => ({ p: x.p, index: x.hits.find((h) => h.set === chosen.set)!.index }));
        const thresholds = Array.from({ length: chosen.count - 1 }, (_, k) => {
          const below = levels.filter((l) => l.index <= k).map((l) => number(l.p));
          const above = levels.filter((l) => l.index > k).map((l) => number(l.p));
          const lo = below.filter((v): v is number => v !== null);
          const hi = above.filter((v): v is number => v !== null);
          // The number that separates the icons seen: the lowest value that earned the higher icon.
          if (lo.length && hi.length && Math.max(...lo) < Math.min(...hi)) return { type: "num" as const, value: Math.min(...hi) };
          return { type: "percent" as const, value: DEFAULT_STEPS[chosen.count]![k]! };
        });
        out.push({ id: createId("rule_"), kind: "iconSet", set: chosen.set, ranges: runs(icons.map((x) => x.p.row), col, origin), thresholds, ...(icons.every((x) => x.p.cell.text === "") ? { hideValue: true as const } : {}) });
      }
    }
    // ---- bars: from the left edge, so the length says where the value lies between the ends ----
    const bars = cells.map((p) => ({ p, bar: barOf(p.cell.background) })).filter((x): x is { p: Placed; bar: Bar } => x.bar !== null && !x.bar.axis && x.bar.from === 0);
    if (bars.length) {
      const first = bars[0]!.bar;
      if (bars.every((x) => x.bar.color === first.color && x.bar.solid === first.solid)) {
        // Two numbers with different lengths fix the line they lie on: length = (value - min) / (max - min).
        const pts = bars.flatMap((x) => (number(x.p) === null ? [] : [{ v: number(x.p)!, f: x.bar.to }])).sort((a, b) => a.f - b.f);
        let min: CfValue = { type: "min" };
        let max: CfValue = { type: "max" };
        const a = pts[0];
        const z = pts[pts.length - 1];
        if (a && z && z.f - a.f > 0.005 && z.v !== a.v) {
          const span = (z.v - a.v) / (z.f - a.f);
          const lo = a.v - a.f * span;
          if (pts.every((p) => Math.abs(lo + p.f * span - p.v) <= Math.abs(span) * 0.02)) {
            min = { type: "num", value: Math.round(lo * 1e6) / 1e6 };
            max = { type: "num", value: Math.round((lo + span) * 1e6) / 1e6 };
          }
        }
        // A cell at the end of the bars with no bar and a number is the lowest value (its bar is empty): it belongs to the rule.
        const rows = bars.map((x) => x.p.row);
        for (const step of [-1, 1]) {
          let r = step < 0 ? Math.min(...rows) - 1 : Math.max(...rows) + 1;
          for (let p = at.get(`${r}:${col}`); p && !p.cell.background && number(p) !== null; p = at.get(`${(r += step)}:${col}`)) rows.push(p.row);
        }
        out.push({ id: createId("rule_"), kind: "dataBar", ranges: runs(rows, col, origin), min, max, color: first.color, ...(first.solid ? { solid: true as const } : {}), axis: "none" as const });
      }
    }
  }
  return out;
}

/** Ranges for a column of a table pasted at `origin`: a run of neighbouring rows is one range. */
function runs(rows: number[], col: number, origin: { row: number; col: number }): string[] {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0]!;
  let last = start;
  for (const r of [...sorted.slice(1), Infinity]) {
    if (r === last + 1) {
      last = r;
      continue;
    }
    out.push(rangeAddress({ r1: origin.row + start, c1: origin.col + col, r2: origin.row + last, c2: origin.col + col }));
    start = r;
    last = r;
  }
  return out;
}

/**
 * The rules a pasted table brings and the operations that put them on the sheet: new rules over the cells it lands on, and
 * the rules that covered those cells (the ones Pli's copy made and any others) cut back, as a paste of formats does in Excel.
 */
export function cfPaste(table: HtmlTable, placed: readonly Placed[], origin: { row: number; col: number }, target: Bounds, sheet: Sheet, sheetId: string): { ops: SheetOp[]; added: number } {
  const marked = table.cf?.map((m) => fromMark(m, origin)).filter((r): r is ConditionalRule => r !== null);
  const rules = marked ?? (table.cf ? [] : fromLooks(placed, origin));
  if (!rules.length) return { ops: [], added: 0 };
  const ops: SheetOp[] = [];
  // What covered the cells pasted over loses them.
  for (const rule of sheet.conditional ?? []) {
    const rects = ruleBounds(rule.ranges);
    if (!rects.some((r) => overlaps(r, target))) continue;
    const kept = rects.flatMap((r) => subtract(r, target)).map(rangeAddress);
    ops.push(kept.length ? { type: "update_rule", sheet: sheetId, rule: { ...rule, ranges: kept } as ConditionalRule } : { type: "delete_rule", sheet: sheetId, id: rule.id });
  }
  for (const rule of rules) ops.push({ type: "add_rule", sheet: sheetId, rule });
  return { ops, added: rules.length };
}

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
