import {
  canonicalOps,
  commentIdsIn,
  commentRanges,
  createDoc,
  docReducer,
  heading,
  paragraph,
  table,
  textLength,
  type Block,
  type Doc,
  type DocOp,
  type MarkPatch,
  type Marks,
  type TableBlock,
} from "../src";
import { flatOrder } from "../src/selection";
import { isTextBlock } from "../src/model";

/** Shared by the fuzzers: random documents, random operations, and ways to compare documents. */

// ---- Random numbers, so a failure can be replayed from its seed ------------------------------------------------

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)]!;
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
export type Rng = ReturnType<typeof rng>;

// ---- Documents and operations ----------------------------------------------------------------------------------

export function startDoc(): Doc {
  const grid = table([
    ["a1", "a2"],
    ["b1", "b2"],
  ]);
  return createDoc("Fuzz", [heading(1, "Head"), paragraph("one two three"), paragraph("four five"), grid, paragraph("six"), paragraph("")]);
}

export const WORDS = ["a", "bc", "def", "ghij", "kl mno", " ", "xy z"];
export const MARKS: (Marks | undefined)[] = [undefined, undefined, { bold: true }, { italic: true }, { bold: true, color: "#f00" }, { style: "s2" }, { suggest: { id: "g1", kind: "insert", by: "a", at: 1 } }];
export const PATCHES: MarkPatch[] = [{ bold: true }, { bold: null }, { italic: true }, { italic: null }, { color: "#00f" }, { color: null }, { bold: true, italic: true }, { style: "s2" }, { style: null }, { suggest: { id: "g2", kind: "delete", by: "b", at: 2 } }, { suggest: null }];

/** The stand-in paragraph in a cell that two people emptied at once. Editors replace it with a real block before anyone writes in it, so no operation targets it. */
export const realBlock = (b: { id: string }) => !b.id.endsWith("~empty");
export const texts = (doc: Doc) => flatOrder(doc).list.filter(isTextBlock).filter(realBlock);
export const tables = (doc: Doc) => doc.blocks.filter((b): b is TableBlock => b.type === "table");

export function range(r: Rng, len: number): [number, number] | null {
  if (len === 0) return null;
  const from = r.int(len);
  return [from, from + 1 + r.int(len - from)];
}

export let counter = 0;
export const fresh = (who: string, kind = "n") => `${kind}_${who}_${counter++}`;

export function newParagraph(r: Rng, who: string): Block {
  return { id: fresh(who, "b"), type: "paragraph", runs: [{ text: r.pick(WORDS) }] };
}

/** One valid operation on `doc`, made by `who`, or null if the dice found nothing to do. */
export function randomOp(r: Rng, doc: Doc, who: string): DocOp | null {
  const kinds = ["insert_text", "insert_text", "insert_text", "delete_text", "format_text", "restore_marks", "comment_text", "insert_block", "delete_block", "update_block", "table", "doc"];
  // Everyone may have deleted everything at once; then the only thing to do is write something.
  if (doc.blocks.length === 0) return { type: "insert_block", block: newParagraph(r, who), after: null };
  const kind = r.pick(kinds);
  if (["insert_text", "delete_text", "format_text", "restore_marks", "comment_text"].includes(kind) && texts(doc).length === 0) return null;
  switch (kind) {
    case "insert_text": {
      const block = r.pick(texts(doc));
      const marks = r.pick(MARKS);
      return { type: "insert_text", block: block.id, offset: r.int(textLength(block.runs) + 1), runs: [{ text: r.pick(WORDS), marks }] };
    }
    case "delete_text": {
      const block = r.pick(texts(doc));
      const span = range(r, textLength(block.runs));
      return span && { type: "delete_text", block: block.id, from: span[0], to: span[1] };
    }
    case "format_text": {
      const block = r.pick(texts(doc));
      const span = range(r, textLength(block.runs));
      return span && { type: "format_text", block: block.id, from: span[0], to: span[1], patch: r.pick(PATCHES) };
    }
    case "restore_marks": {
      const block = r.pick(texts(doc));
      const span = range(r, textLength(block.runs));
      if (!span) return null;
      const segments: { length: number; marks?: Marks }[] = [];
      let left = span[1] - span[0];
      while (left > 0) {
        const length = Math.min(left, 1 + r.int(4));
        const marks = r.pick(MARKS);
        segments.push(marks ? { length, marks } : { length });
        left -= length;
      }
      return { type: "restore_marks", block: block.id, from: span[0], to: span[1], segments };
    }
    case "comment_text": {
      const block = r.pick(texts(doc));
      const ids = [...commentIdsIn(doc.blocks)];
      if (ids.length > 0 && r.chance(0.4)) {
        const id = r.pick(ids);
        const ranges = commentRanges(doc, id);
        const at = r.pick(ranges);
        return { type: "comment_text", block: at.block, from: at.from, to: at.to, id, on: false };
      }
      const span = range(r, textLength(block.runs));
      if (!span) return null;
      // A thread that is already on part of the range would break the rule that a range is all on or all off.
      const id = fresh(who, "th");
      return { type: "comment_text", block: block.id, from: span[0], to: span[1], id, on: true };
    }
    case "insert_block": {
      const block = newParagraph(r, who);
      const grids = tables(doc);
      if (grids.length > 0 && r.chance(0.3)) {
        const grid = r.pick(grids);
        const cell = r.pick(grid.rows).cells.filter((c) => !c.covered);
        const target = r.pick(cell);
        const real = target.blocks.filter(realBlock);
        return r.chance(0.5) || real.length === 0 ? { type: "insert_block", block, after: null, cell: target.id } : { type: "insert_block", block, after: r.pick(real).id };
      }
      return { type: "insert_block", block, after: r.chance(0.15) ? null : r.pick(doc.blocks).id };
    }
    case "delete_block": {
      if (doc.blocks.length > 2 && r.chance(0.7)) return canonicalOps(doc, [{ type: "delete_block", id: r.pick(doc.blocks).id }])[0]!;
      for (const grid of tables(doc)) {
        for (const row of grid.rows) {
          for (const cell of row.cells) if (cell.blocks.length > 1 && r.chance(0.5)) return canonicalOps(doc, [{ type: "delete_block", id: r.pick(cell.blocks.filter(realBlock)).id }])[0]!;
        }
      }
      return null;
    }
    case "update_block": {
      const candidates = doc.blocks.filter((b) => b.type === "paragraph" || b.type === "heading");
      if (candidates.length === 0) return null;
      const block = r.pick(candidates);
      const patches: Record<string, unknown>[] = [{ align: "center" }, { align: null }, { align: "right" }, { style: "s1" }, { style: null }];
      patches.push(block.type === "heading" ? { type: "paragraph", level: null } : { type: "heading", level: 2 });
      return { type: "update_block", id: block.id, patch: r.pick(patches) };
    }
    case "table": {
      const grids = tables(doc);
      if (grids.length === 0) return null;
      const grid = r.pick(grids);
      if (r.chance(0.3)) return { type: "update_block", id: grid.id, patch: { borders: r.pick(["all", "none", "horizontal"]) } };
      const rows = structuredClone(grid.rows);
      const how = r.int(3);
      if (how === 0) {
        r.pick(rows).height = 20 + r.int(40);
      } else if (how === 1 || rows.length === 1) {
        rows.splice(r.int(rows.length + 1), 0, {
          id: fresh(who, "r"),
          cells: grid.columns.map(() => ({ id: fresh(who, "c"), blocks: [{ id: fresh(who, "b"), type: "paragraph" as const, runs: [{ text: r.pick(WORDS) }] }] })),
        });
      } else {
        rows.splice(r.int(rows.length), 1);
      }
      return canonicalOps(doc, [{ type: "update_block", id: grid.id, patch: { rows } }])[0]!;
    }
    default: {
      const which = r.int(4);
      if (which === 3) return r.chance(0.25) ? { type: "set_style", id: r.pick(["s1", "s2"]), style: null } : { type: "set_style", id: r.pick(["s1", "s2"]), style: { name: r.pick(WORDS), kind: r.pick(["paragraph", "character"] as const), marks: r.chance(0.5) ? { bold: true } : { color: "#00f" } } };
      if (which === 0) return { type: "set_title", title: r.pick(WORDS) };
      if (which === 1) return { type: "set_region", region: r.pick(["header", "footer"] as const), blocks: r.chance(0.3) ? null : [newParagraph(r, who)] };
      return { type: "set_footnote", id: r.pick(["n1", "n2"]), blocks: r.chance(0.3) ? null : [newParagraph(r, who)] };
    }
  }
}

/** Some operations that follow one another: each made on what the one before left. */
export function randomBatch(r: Rng, doc: Doc, who: string, max = 3): DocOp[] {
  const ops: DocOp[] = [];
  let state = doc;
  const count = 1 + r.int(max);
  for (let i = 0; i < count; i++) {
    const op = randomOp(r, state, who);
    if (!op) continue;
    try {
      state = docReducer.apply(state, op).state;
      ops.push(op);
    } catch {
      // The generator is allowed to guess wrong; the guess is simply not used.
    }
  }
  return ops;
}

// ---- Comparing documents ---------------------------------------------------------------------------------------

export function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canon(v)]),
    );
  }
  return value;
}
/** Where two documents first differ, as a path and the two values. */
export function firstDiff(a: unknown, b: unknown, path = "doc"): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) {
      const inner = firstDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      if (inner) return inner;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 200)}  vs  ${JSON.stringify(b)?.slice(0, 200)}`;
}
export const same = (a: Doc, b: Doc) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
export const apply = (doc: Doc, ops: readonly DocOp[]) =>
  ops.reduce((d, op) => {
    try {
      return docReducer.apply(d, op).state;
    } catch (error) {
      throw new Error(`${(error as Error).message} while applying ${JSON.stringify(op).slice(0, 300)}`);
    }
  }, doc);
export const show = (ops: readonly DocOp[]) => JSON.stringify(ops);

/** A document that has had a few edits, so cases start from varied text and marks. */
export function warmedUp(r: Rng): Doc {
  let doc = startDoc();
  for (const op of randomBatch(r, doc, "warm", 6)) doc = docReducer.apply(doc, op).state;
  return doc;
}

