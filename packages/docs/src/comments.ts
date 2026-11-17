import { commentStoreInFile, type CommentStore, type Thread } from "@pli.dev/core";
import { isTextBlock, type Block, type CellBlock, type Doc, type DocAnchor, type Run } from "./model";
import type { DocOp } from "./ops";
import { normalizeRuns, plainText, textLength } from "./runs";
import { coveredBlocks, flatOrder, isCollapsed, type Selection } from "./selection";

/** The longest quote kept with a thread. It's there to give the thread context, not to copy the text. */
const MAX_QUOTE = 200;

/** `ids` plus `id`, sorted so two sets of the same threads are equal. */
const withId = (ids: readonly string[] | undefined, id: string): string[] => (ids?.includes(id) ? [...ids] : [...(ids ?? []), id].sort());

/** Marks `from` to `to` of some runs as part of a thread. */
export function addCommentToRuns(runs: readonly Run[], from: number, to: number, id: string): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    const a = Math.max(from, pos);
    const b = Math.min(to, end);
    if (a >= b) {
      out.push(run);
    } else {
      if (a > pos) out.push({ ...run, text: run.text.slice(0, a - pos) });
      out.push({ text: run.text.slice(a - pos, b - pos), marks: { ...run.marks, comment: withId(run.marks?.comment, id) } });
      if (b < end) out.push({ ...run, text: run.text.slice(b - pos) });
    }
    pos = end;
  }
  return normalizeRuns(out);
}

/** Takes a thread off `from` to `to` of some runs (all of them by default). Returns the same array when it wasn't there. */
export function removeCommentFromRuns(runs: readonly Run[], id: string, from = 0, to = Infinity): readonly Run[] {
  if (!runs.some((r) => r.marks?.comment?.includes(id))) return runs;
  const out: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    const a = Math.max(from, pos);
    const b = Math.min(to, end);
    if (a >= b || !run.marks?.comment?.includes(id)) {
      out.push(run);
    } else {
      const { comment, ...marks } = run.marks;
      const left = comment.filter((c) => c !== id);
      if (a > pos) out.push({ ...run, text: run.text.slice(0, a - pos) });
      out.push({ text: run.text.slice(a - pos, b - pos), marks: left.length > 0 ? { ...marks, comment: left } : marks });
      if (b < end) out.push({ ...run, text: run.text.slice(b - pos) });
    }
    pos = end;
  }
  return normalizeRuns(out);
}

/** The ids of every thread that has text attached to it, in these blocks. */
export function commentIdsIn(blocks: readonly Block[], into: Set<string> = new Set()): Set<string> {
  const visit = (block: Block | CellBlock): void => {
    if (isTextBlock(block as Block)) {
      for (const run of (block as { runs: Run[] }).runs) for (const id of run.marks?.comment ?? []) into.add(id);
    } else if (block.type === "table") {
      for (const row of block.rows) for (const cell of row.cells) cell.blocks.forEach(visit);
    }
  };
  blocks.forEach(visit);
  return into;
}

/** Where a thread's text is now: one range per block it covers, in reading order. Empty if the text is gone. */
export function commentRanges(doc: Pick<Doc, "blocks">, id: string): { block: string; from: number; to: number }[] {
  const out: { block: string; from: number; to: number }[] = [];
  for (const block of flatOrder(doc).list) {
    if (!isTextBlock(block)) continue;
    let pos = 0;
    let open: { block: string; from: number; to: number } | null = null;
    for (const run of block.runs) {
      const end = pos + run.text.length;
      if (run.marks?.comment?.includes(id)) {
        if (open) open.to = end;
        else open = { block: block.id, from: pos, to: end };
      } else if (open) {
        out.push(open);
        open = null;
      }
      pos = end;
    }
    if (open) out.push(open);
  }
  return out;
}

/** The threads attached to the text at a point, or at any text of a selection, in the order they were started. */
export function commentsAt(doc: Doc, selection: Selection | null): string[] {
  if (!selection) return [];
  const found = new Set<string>();
  const collapsed = isCollapsed(selection);
  for (const { block, from, to } of coveredBlocks(doc, selection)) {
    if (!isTextBlock(block)) continue;
    let pos = 0;
    for (const run of block.runs) {
      const end = pos + run.text.length;
      // A caret is inside text when it's within it, and at its far edge too, so it can reach the last character.
      const touches = collapsed ? from > pos && from <= end : from < end && to > pos;
      if (touches) for (const id of run.marks?.comment ?? []) found.add(id);
      pos = end;
    }
  }
  return [...found];
}

/** What a selection should be recorded as in a new thread, or null where there's no text to comment on. */
export function anchorFor(doc: Doc, selection: Selection): DocAnchor | null {
  const first = coveredBlocks(doc, selection).find((c) => isTextBlock(c.block) && c.to > c.from);
  if (!first) return null;
  const text = plainText((first.block as { runs: Run[] }).runs).slice(first.from, first.to);
  return { block: first.block.id, from: first.from, to: first.to, quote: text.slice(0, MAX_QUOTE) };
}

/** The ops that attach a thread to the selected text, or an empty list where there's none. */
export function attachOps(doc: Doc, selection: Selection, id: string): DocOp[] {
  const ops: DocOp[] = [];
  for (const { block, from, to } of coveredBlocks(doc, selection)) {
    if (!isTextBlock(block) || to <= from) continue;
    ops.push({ type: "comment_text", block: block.id, from, to, id, on: true });
  }
  return ops;
}

/** The ops that take a thread off the text it is attached to. */
export function detachOps(doc: Doc, id: string): DocOp[] {
  return commentRanges(doc, id).map(({ block, from, to }) => ({ type: "comment_text", block, from, to, id, on: false }));
}

/**
 * The ops that put a thread's mark back on the text it was made on, for someone whose copy of the document
 * doesn't have it. It looks where the anchor says, then anywhere in that block; if the text isn't found, there
 * is nothing to do and the thread simply has no text. Only the first block of a thread's text is restored.
 */
export function reanchorOps(doc: Doc, thread: Thread<DocAnchor>): DocOp[] {
  const anchor = thread.anchor;
  if (!anchor || anchor.quote === "") return [];
  const block = flatOrder(doc).list.find((b) => b.id === anchor.block);
  if (!block || !isTextBlock(block)) return [];
  const text = plainText(block.runs);
  let from = anchor.from;
  if (text.slice(from, from + anchor.quote.length) !== anchor.quote) {
    from = text.indexOf(anchor.quote);
    if (from < 0) return [];
  }
  return [{ type: "comment_text", block: block.id, from, to: from + anchor.quote.length, id: thread.id, on: true }];
}

/** Blocks with all comment marks taken off, as for a paste: the thread stays with the text it was made on. */
export function stripComments<T extends Block>(blocks: readonly T[]): T[] {
  const strip = (runs: Run[]): Run[] =>
    normalizeRuns(
      runs.map((run) => {
        if (!run.marks?.comment) return run;
        const { comment: _comment, ...marks } = run.marks;
        return { text: run.text, marks };
      }),
    );
  const visit = <B extends Block | CellBlock>(block: B): B => {
    if (isTextBlock(block as Block) && textLength((block as { runs: Run[] }).runs) > 0) {
      const runs = (block as { runs: Run[] }).runs;
      return runs.some((r) => r.marks?.comment) ? ({ ...block, runs: strip(runs) } as B) : block;
    }
    if (block.type === "table") {
      return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map(visit) })) })) } as B;
    }
    return block;
  };
  return blocks.map(visit);
}

/**
 * Keeps a document's comment threads inside the document (`Doc.comments`), so they travel with the file. The
 * session this is made for supplies the document; `write` applies the ops without making an undo step.
 */
export function documentCommentStore(source: { state: Doc; write(ops: DocOp[]): void }): CommentStore<DocAnchor> {
  return commentStoreInFile<DocAnchor>({
    threads: () => Object.values(source.state.comments ?? {}),
    write: (id, thread) => source.write([{ type: "set_thread", id, thread }]),
  });
}

/** Each thread that has text, numbered by where its text first appears: 0 for the first. Threads with no text aren't in it. */
export function commentOrder(doc: Pick<Doc, "blocks">): Map<string, number> {
  const order = new Map<string, number>();
  for (const block of flatOrder(doc).list) {
    if (!isTextBlock(block)) continue;
    for (const run of block.runs) for (const id of run.marks?.comment ?? []) if (!order.has(id)) order.set(id, order.size);
  }
  return order;
}
