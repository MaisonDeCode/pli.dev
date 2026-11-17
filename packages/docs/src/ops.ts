import { PliError, type Reducer, type Thread } from "@pli.dev/core";
import { isTextBlock, type Block, type DocAnchor, type DocStyle, type CellBlock, type Doc, type MarkPatch, type PageSetup, type RegionName, type Run, type TextBlock } from "./model";
import { addCommentToRuns, removeCommentFromRuns } from "./comments";
import { checkRange, deleteRange, textLength, formatRange, insertRuns, marksSegments, normalizeRuns, restoreMarks, sliceRuns, type MarkSegment } from "./runs";
import { collectIds, locate, locateCell, updateCell, updateList } from "./tree";

/**
 * Every change to a document is one of these JSON operations. They are
 * invertible, so history works, and serializable, so they can be synced,
 * logged, or issued by user scripts.
 *
 * Blocks are found by id wherever they are, including inside table cells.
 */
export type DocOp =
  /**
   * Inserts after the block `after`, in the same list as that block (so inside a cell if it is in
   * one). With `after: null` it goes at the start of the document, or at the start of the cell
   * `cell` if given.
   */
  | { type: "insert_block"; block: Block; after: string | null; cell?: string }
  /**
   * Removes a block. `after`, `cell` and `within` are hints for merging with other people's edits, filled in by
   * sessions: where the block was (the block before it, or the start of the list or of `cell`), and the ids of
   * everything inside it, for a table. Applying the operation ignores them.
   */
  | { type: "delete_block"; id: string; after?: string | null; cell?: string; within?: string[] }
  /**
   * Swaps a whole block for another. A session turns this into the finer operations below before applying it
   * (see `canonicalOps`), so edits to the same block by other people are not overwritten. It stays valid for
   * code that applies operations directly.
   */
  | { type: "replace_block"; id: string; block: Block }
  /**
   * Changes properties of a block and leaves its text alone: `{ type: "heading", level: 2 }` turns a paragraph into
   * a heading, `{ align: null }` removes a property. The text (`runs`) and `id` can't be patched.
   *
   * `within` is a hint for merging with other people's edits, filled in by sessions: when the patch replaces a
   * table's `rows`, the ids of everything that was in the table before. Applying the operation ignores it.
   */
  | { type: "update_block"; id: string; patch: BlockPatch; within?: string[] }
  | { type: "insert_text"; block: string; offset: number; runs: Run[] }
  | { type: "delete_text"; block: string; from: number; to: number }
  | { type: "format_text"; block: string; from: number; to: number; patch: MarkPatch }
  /** Puts the marks across a range back exactly as `segments` give them, without touching the text. The inverse of `format_text`. */
  | { type: "restore_marks"; block: string; from: number; to: number; segments: MarkSegment[] }
  | { type: "set_runs"; block: string; runs: Run[] }
  | { type: "set_title"; title: string }
  /** Sets the page size, orientation and margins. `null` restores the default. */
  | { type: "set_page"; page: PageSetup | null }
  /** Replaces the content of a header or footer (see `RegionName`). `null` removes it. */
  | { type: "set_region"; region: RegionName; blocks: Block[] | null }
  /** Sets the text of a footnote. `null` removes it. */
  | { type: "set_footnote"; id: string; blocks: Block[] | null }
  /**
   * Attaches a comment thread to a range of text (`on: true`), or takes it off (`on: false`). The range must be
   * all without the thread, or all with it, so the op's inverse puts things back exactly.
   */
  | { type: "comment_text"; block: string; from: number; to: number; id: string; on: boolean }
  /** Sets a comment thread saved in the document. `null` removes it. */
  | { type: "set_thread"; id: string; thread: Thread<DocAnchor> | null }
  /** Defines or changes a named style (see `DocStyle`). `null` removes it, and blocks that used it fall back to the plain look. */
  | { type: "set_style"; id: string; style: DocStyle | null };

/** Properties to set on a block; `null` removes one. */
export type BlockPatch = { [key: string]: unknown };

function find(doc: Doc, id: string) {
  const found = locate(doc, id);
  if (!found) throw new PliError("not_found", `No block with id "${id}"`);
  return found;
}

function textBlockAt(doc: Doc, id: string): TextBlock {
  const { block } = find(doc, id);
  if (!isTextBlock(block)) {
    throw new PliError("invalid_operation", `Block "${id}" (${block.type}) has no text`);
  }
  return block;
}

/** Replaces a text block with an edited copy, wherever it lives. */
function withTextBlock(doc: Doc, block: TextBlock): Doc {
  const blocks = updateList(doc.blocks, block.id, (list, index) => {
    list[index] = block;
    return list;
  });
  return { ...doc, blocks: blocks! };
}

/** Where to put the inverse of a deletion: after the previous sibling, or at the start of its cell. */
function insertionPointFor(located: ReturnType<typeof find>): { after: string | null; cell?: string } {
  const previous = located.list[located.index - 1];
  if (previous) return { after: previous.id };
  return located.cell ? { after: null, cell: located.cell.cell.id } : { after: null };
}

export const docReducer: Reducer<Doc, DocOp> = {
  apply(doc, op) {
    switch (op.type) {
      case "insert_block": {
        const taken = collectIds([op.block]);
        const existing = collectIds(doc.blocks);
        for (const id of taken) {
          if (existing.has(id)) throw new PliError("invalid_operation", `Block id "${id}" already exists`);
        }
        let blocks: Block[] | null;
        // A cell emptied by two people at once holds a stand-in paragraph (see `delete_block`). Putting something in the cell replaces it.
        const standIn = (list: Block[]) => list.length === 1 && list[0]!.id.endsWith("~empty") && isTextBlock(list[0]!) && textLength((list[0] as TextBlock).runs) === 0;
        if (op.after !== null) {
          find(doc, op.after);
          blocks = updateList(doc.blocks, op.after, (list, index) => {
            if (standIn(list)) list.splice(0, 1, op.block);
            else list.splice(index + 1, 0, op.block);
            return list;
          });
        } else if (op.cell !== undefined) {
          if (!locateCell(doc, op.cell)) throw new PliError("not_found", `No table cell with id "${op.cell}"`);
          blocks = updateCell(doc.blocks, op.cell, (list) => {
            if (standIn(list)) list.splice(0, 1, op.block as CellBlock);
            else list.unshift(op.block as CellBlock);
            return list;
          });
        } else {
          blocks = [op.block, ...doc.blocks];
        }
        const within = [...collectIds([op.block])].filter((id) => id !== op.block.id);
        return {
          state: { ...doc, blocks: blocks! },
          inverse: { type: "delete_block", id: op.block.id, after: op.after, ...(op.cell !== undefined && { cell: op.cell }), ...(within.length > 0 && { within }) },
        };
      }
      case "delete_block": {
        const located = find(doc, op.id);
        // A table cell always has a block. Removing its last one leaves an empty paragraph, with an id made from
        // the cell's, so that two people removing the last two blocks at once end with the same document.
        const emptied = !!located.cell && located.list.length === 1;
        const blocks = updateList(doc.blocks, op.id, (list, index) => {
          if (emptied) list[index] = { id: `${located.cell!.cell.id}~empty`, type: "paragraph", runs: [] };
          else list.splice(index, 1);
          return list;
        });
        return {
          state: { ...doc, blocks: blocks! },
          inverse: { type: "insert_block", block: located.block, ...insertionPointFor(located) },
        };
      }
      case "replace_block": {
        const located = find(doc, op.id);
        if (op.block.id !== op.id) {
          throw new PliError("invalid_operation", "replace_block must keep the block id");
        }
        const blocks = updateList(doc.blocks, op.id, (list, index) => {
          list[index] = op.block;
          return list;
        });
        return {
          state: { ...doc, blocks: blocks! },
          inverse: { type: "replace_block", id: op.id, block: located.block },
        };
      }
      case "update_block": {
        const located = find(doc, op.id);
        const old = located.block as unknown as Record<string, unknown>;
        const next: Record<string, unknown> = { ...old };
        const inverse: BlockPatch = {};
        for (const [key, value] of Object.entries(op.patch)) {
          if (key === "id" || key === "runs") throw new PliError("invalid_operation", `update_block can't change "${key}"`);
          inverse[key] = old[key] === undefined ? null : old[key];
          if (value === null || value === undefined) delete next[key];
          else next[key] = value;
        }
        const blocks = updateList(doc.blocks, op.id, (list, index) => {
          list[index] = next as unknown as Block;
          return list;
        });
        // Undoing a change to the rows covers what the change put there.
        const within = Array.isArray(op.patch.rows) ? [...collectIds([next as unknown as Block])].filter((id) => id !== op.id) : [];
        return { state: { ...doc, blocks: blocks! }, inverse: { type: "update_block", id: op.id, patch: inverse, ...(within.length > 0 ? { within } : {}) } };
      }
      case "insert_text": {
        const block = textBlockAt(doc, op.block);
        const runs = insertRuns(block.runs, op.offset, op.runs);
        return {
          state: withTextBlock(doc, { ...block, runs }),
          inverse: {
            type: "delete_text",
            block: op.block,
            from: op.offset,
            to: op.offset + op.runs.reduce((n, r) => n + r.text.length, 0),
          },
        };
      }
      case "delete_text": {
        const block = textBlockAt(doc, op.block);
        const removed = sliceRuns(block.runs, op.from, op.to);
        const runs = deleteRange(block.runs, op.from, op.to);
        return {
          state: withTextBlock(doc, { ...block, runs }),
          inverse: { type: "insert_text", block: op.block, offset: op.from, runs: removed },
        };
      }
      case "format_text": {
        const block = textBlockAt(doc, op.block);
        const runs = formatRange(block.runs, op.from, op.to, op.patch);
        return {
          state: withTextBlock(doc, { ...block, runs }),
          // The marks of the range, not the whole paragraph: undoing must not undo what others typed beside it.
          inverse: { type: "restore_marks", block: op.block, from: op.from, to: op.to, segments: marksSegments(block.runs, op.from, op.to) },
        };
      }
      case "restore_marks": {
        const block = textBlockAt(doc, op.block);
        const runs = restoreMarks(block.runs, op.from, op.to, op.segments);
        return {
          state: withTextBlock(doc, { ...block, runs }),
          inverse: { type: "restore_marks", block: op.block, from: op.from, to: op.to, segments: marksSegments(block.runs, op.from, op.to) },
        };
      }
      case "set_runs": {
        const block = textBlockAt(doc, op.block);
        return {
          state: withTextBlock(doc, { ...block, runs: normalizeRuns(op.runs) }),
          inverse: { type: "set_runs", block: op.block, runs: block.runs },
        };
      }
      case "set_title":
        return {
          state: { ...doc, title: op.title },
          inverse: { type: "set_title", title: doc.title },
        };
      case "set_page": {
        const { page: previous, ...rest } = doc;
        return {
          state: op.page ? { ...rest, page: op.page } : rest,
          inverse: { type: "set_page", page: previous ?? null },
        };
      }
      case "set_footnote": {
        const previous = doc.footnotes?.[op.id] ?? null;
        const { [op.id]: _removed, ...others } = doc.footnotes ?? {};
        const footnotes = op.blocks ? { ...others, [op.id]: op.blocks } : others;
        const { footnotes: _old, ...rest } = doc;
        return {
          state: Object.keys(footnotes).length > 0 ? { ...rest, footnotes } : rest,
          inverse: { type: "set_footnote", id: op.id, blocks: previous },
        };
      }
      case "comment_text": {
        const block = textBlockAt(doc, op.block);
        checkRange(block.runs, op.from, op.to);
        const runs = op.on ? addCommentToRuns(block.runs, op.from, op.to, op.id) : (removeCommentFromRuns(block.runs, op.id, op.from, op.to) as Run[]);
        return { state: withTextBlock(doc, { ...block, runs }), inverse: { ...op, on: !op.on } };
      }
      case "set_thread": {
        const previous = doc.comments?.[op.id] ?? null;
        const { [op.id]: _removed, ...others } = doc.comments ?? {};
        const comments = op.thread ? { ...others, [op.id]: op.thread } : others;
        const { comments: _old, ...rest } = doc;
        return {
          state: Object.keys(comments).length > 0 ? { ...rest, comments } : rest,
          inverse: { type: "set_thread", id: op.id, thread: previous },
        };
      }
      case "set_style": {
        const previous = doc.styles?.[op.id] ?? null;
        const { [op.id]: _removed, ...others } = doc.styles ?? {};
        const styles = op.style ? { ...others, [op.id]: op.style } : others;
        const { styles: _old, ...rest } = doc;
        return {
          state: Object.keys(styles).length > 0 ? { ...rest, styles } : rest,
          inverse: { type: "set_style", id: op.id, style: previous },
        };
      }
      case "set_region": {
        const previous = doc[op.region] ?? null;
        const { [op.region]: _removed, ...rest } = doc;
        return {
          state: op.blocks ? { ...rest, [op.region]: op.blocks } : rest,
          inverse: { type: "set_region", region: op.region, blocks: previous },
        };
      }
    }
  },
};
