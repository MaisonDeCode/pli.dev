import type { DiffSummary, VersionSupport } from "@pli.dev/core";
import type { Block, Doc } from "./model";
import { isTextBlock } from "./model";
import type { DocOp } from "./ops";
import { plainText } from "./runs";

const json = (value: unknown) => JSON.stringify(value ?? null);

/** Blocks of the top level of a document by id. Tables and everything inside them are one block here. */
const byId = (blocks: readonly Block[]) => new Map(blocks.map((b) => [b.id, b]));

/**
 * The operations that turn `current` into `target`, for `VersionHistory.restore`. Blocks that are in both are replaced only
 * if they differ; blocks only in the old document are deleted; blocks only in the new one are inserted where they were. The
 * title and the page setup follow. They are ordinary operations, so a restore is one undoable step that is sent to everyone
 * like any other edit. Comments, styles, footnotes and headers are left as they are now: a restore brings back the text.
 */
export function restoreDocOps(current: Doc, target: Doc): DocOp[] {
  const ops: DocOp[] = [];
  if (current.title !== target.title) ops.push({ type: "set_title", title: target.title });
  if (json(current.page) !== json(target.page)) ops.push({ type: "set_page", page: target.page ?? null });

  const have = byId(current.blocks);
  const want = new Set(target.blocks.map((b) => b.id));
  const sameOrder = current.blocks.filter((b) => want.has(b.id)).map((b) => b.id).join() === target.blocks.filter((b) => have.has(b.id)).map((b) => b.id).join();
  // When the shared blocks changed order, the simplest correct thing is to put them all back one by one.
  for (const block of current.blocks) if (!want.has(block.id) || !sameOrder) ops.push({ type: "delete_block", id: block.id });
  let after: string | null = null;
  const kept = new Set(sameOrder ? current.blocks.filter((b) => want.has(b.id)).map((b) => b.id) : []);
  for (const block of target.blocks) {
    if (kept.has(block.id)) {
      const old = have.get(block.id)!;
      if (json(old) !== json(block)) ops.push({ type: "replace_block", id: block.id, block });
    } else {
      ops.push({ type: "insert_block", block, after });
    }
    after = block.id;
  }
  return ops;
}

const textOf = (block: Block): string => (isTextBlock(block) ? plainText(block.runs) : block.type);

/** Counts what differs between two documents: blocks added, removed and changed, and the title. */
export function summarizeDocDiff(from: Doc, to: Doc): DiffSummary {
  const before = byId(from.blocks);
  const after = byId(to.blocks);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, block] of after) {
    const old = before.get(id);
    if (!old) added++;
    else if (json(old) !== json(block)) changed++;
  }
  for (const id of before.keys()) if (!after.has(id)) removed++;
  const lines: string[] = [];
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (from.title !== to.title) lines.push(`The title changed from “${from.title}” to “${to.title}”`);
  if (changed > 0) lines.push(`${count(changed, "block was", "blocks were")} edited`);
  if (added > 0) lines.push(`${count(added, "block was", "blocks were")} added`);
  if (removed > 0) lines.push(`${count(removed, "block was", "blocks were")} removed`);
  if (lines.length === 0 && json(from) !== json(to)) lines.push("Other settings changed");
  const firstEdited = [...after].find(([id, b]) => before.has(id) && json(before.get(id)) !== json(b));
  if (firstEdited && lines.length < 4) lines.push(`First change: “${textOf(firstEdited[1]).slice(0, 40)}”`);
  return { added, removed, changed, lines };
}

/** What `VersionHistory` needs to know about documents: how to restore one, and how to say what changed. */
export const docVersionSupport: VersionSupport<Doc, DocOp> = { restoreOps: restoreDocOps, summarize: summarizeDocDiff };
