import { createId, PliError } from "@pli.dev/core";
import type { Block, Doc, ParagraphBlock } from "./model";
import { docReducer, type DocOp } from "./ops";
import { blockLength, caret, flatOrder, type Point, type Selection } from "./selection";
import { collectIds, locate, type Located } from "./tree";

/** What a command returns: the operations to apply and where the selection should land. */
export interface CommandResult {
  ops: DocOp[];
  selection: Selection;
}
export type Command = (doc: Doc, selection: Selection) => CommandResult | null;

export function applyAll(doc: Doc, ops: readonly DocOp[]): Doc {
  let next = doc;
  for (const op of ops) next = docReducer.apply(next, op).state;
  return next;
}

export function where(doc: Doc, id: string): Located {
  const found = locate(doc, id);
  if (!found) throw new PliError("not_found", `No block with id "${id}"`);
  return found;
}

export function blockAt(doc: Doc, id: string): Block {
  return where(doc, id).block;
}

export function emptyParagraph(id: string = createId("b_")): ParagraphBlock {
  return { id, type: "paragraph", runs: [] };
}

/** Where the caret goes to land at the start of a block. A table has no text, so it is its first cell. */
export function startPointOf(block: Block): Point | null {
  if (block.type !== "table") return { block: block.id, offset: 0 };
  const first = block.rows[0]?.cells[0]?.blocks[0];
  return first ? { block: first.id, offset: 0 } : null;
}

/** Where the caret goes to land at the end of a block. */
export function endPointOf(block: Block): Point | null {
  if (block.type !== "table") return { block: block.id, offset: blockLength(block) };
  const cells = block.rows[block.rows.length - 1]?.cells;
  const last = cells?.[cells.length - 1]?.blocks.at(-1);
  return last ? { block: last.id, offset: blockLength(last) } : null;
}

/**
 * Makes a set of operations safe to apply: a table cell never loses its last block (the
 * last one is emptied instead), the document never ends up empty, and the selection never points
 * at a block that was deleted.
 */
export function finish(doc: Doc, ops: DocOp[], selection: Selection): CommandResult {
  const out = ops.slice();
  const deleted = new Set<string>();
  for (const op of out) if (op.type === "delete_block") deleted.add(op.id);
  const removedTables = doc.blocks.filter((b) => b.type === "table" && deleted.has(b.id));
  const insideRemovedTable = new Set<string>();
  for (const table of removedTables) collectIds([table], insideRemovedTable);

  const emptied = new Set<string>();
  for (const table of doc.blocks) {
    if (table.type !== "table" || deleted.has(table.id)) continue;
    for (const row of table.rows) {
      for (const cell of row.cells) {
        // A covered placeholder has no blocks, and needs none.
        if (cell.covered || !cell.blocks.every((b) => deleted.has(b.id))) continue;
        // Keep the last block, emptied, so the cell still has one.
        const keep = cell.blocks[cell.blocks.length - 1]!;
        const at = out.findIndex((op) => op.type === "delete_block" && op.id === keep.id);
        if (at >= 0) out.splice(at, 1);
        out.push({ type: "replace_block", id: keep.id, block: emptyParagraph(keep.id) });
        deleted.delete(keep.id);
        emptied.add(keep.id);
      }
    }
  }

  let target = selection;
  const gone = (id: string) => deleted.has(id) || insideRemovedTable.has(id);

  const topLevelDeleted = doc.blocks.filter((b) => deleted.has(b.id)).length;
  if (topLevelDeleted >= doc.blocks.length) {
    const fresh = emptyParagraph();
    out.push({ type: "insert_block", block: fresh, after: null });
    return { ops: out, selection: caret(fresh.id, 0) };
  }

  if (gone(target.anchor.block) || gone(target.focus.block)) {
    // Land on the nearest surviving text, looking forward first and then back.
    const { list, index } = flatOrder(doc);
    const from = index.get(target.focus.block) ?? 0;
    const survivor = (b: Block) => b.type !== "table" && !gone(b.id);
    const found = list.slice(from).find(survivor) ?? [...list.slice(0, from)].reverse().find(survivor);
    target = found ? caret(found.id, 0) : target;
  }
  return { ops: out, selection: target };
}

