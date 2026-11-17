import { PliError, createId } from "@pli.dev/core";
import { isTextBlock, type Block, type Doc, type Run } from "./model";
import { docReducer, type BlockPatch, type DocOp } from "./ops";
import { marksSegments, normalizeRuns, textLength } from "./runs";
import { collectIds, locate } from "./tree";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Which threads cover which stretches of text: `[length, threads]` pairs, with equal neighbours joined. */
function commentSpans(runs: readonly Run[]): [number, string[] | undefined][] {
  const out: [number, string[] | undefined][] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && same(last[1], run.marks?.comment)) last[0] += run.text.length;
    else out.push([run.text.length, run.marks?.comment]);
  }
  return out;
}

/**
 * What a `replace_block` comes to when it is applied to `doc`, in operations that touch only what changed:
 * a patch for the block's properties, and for its text, marks-only or text edits. Applying the result gives the
 * same document, but if someone else has typed in the block in the meantime their typing is not overwritten, and
 * undoing it restores properties and marks without replacing the text.
 *
 * A swap between a text block and one with no text can't be told as a patch and stays a `replace_block`.
 */
export function diffBlock(doc: Doc, id: string, block: Block): DocOp[] {
  const located = locate(doc, id);
  if (!located) throw new PliError("not_found", `No block with id "${id}"`);
  if (block.id !== id) throw new PliError("invalid_operation", "replace_block must keep the block id");
  const old = located.block;
  const ops: DocOp[] = [];

  if (isTextBlock(old) && isTextBlock(block)) {
    const before = normalizeRuns(old.runs);
    const after = normalizeRuns(block.runs);
    if (!same(before, after)) {
      const text = (runs: readonly { text: string }[]) => runs.map((r) => r.text).join("");
      if (text(before) === text(after)) {
        // Comments are changed by their own operation, which a swap of the block can't be told as.
        if (!same(commentSpans(before), commentSpans(after))) return [{ type: "replace_block", id, block }];
        ops.push({ type: "restore_marks", block: id, from: 0, to: textLength(after), segments: marksSegments(after, 0, textLength(after)) });
      } else {
        if (textLength(before) > 0) ops.push({ type: "delete_text", block: id, from: 0, to: textLength(before) });
        if (textLength(after) > 0) ops.push({ type: "insert_text", block: id, offset: 0, runs: after });
      }
    }
  } else if (isTextBlock(old) !== isTextBlock(block)) {
    return [{ type: "replace_block", id, block }];
  }

  const patch: BlockPatch = {};
  const was = old as unknown as Record<string, unknown>;
  const now = block as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (key === "id" || key === "runs") continue;
    if (!same(was[key], now[key])) patch[key] = now[key] === undefined ? null : now[key];
  }
  if (Object.keys(patch).length > 0) ops.push(withUpdateHints(doc, { type: "update_block", id, patch }));
  return ops;
}

/**
 * The operations to apply for what a command or caller asked for: every `replace_block` is told as finer
 * operations (see `diffBlock`), a `delete_block` gets its merge hints, and everything else passes through
 * untouched. A batch with neither is returned as it is, so typing does no extra work.
 */
export function canonicalOps(doc: Doc, ops: readonly DocOp[]): DocOp[] {
  const needsWork = (op: DocOp) => op.type === "replace_block" || (op.type === "delete_block" && op.after === undefined) || (op.type === "update_block" && Array.isArray(op.patch.rows) && op.within === undefined);
  if (!ops.some(needsWork)) return ops as DocOp[];
  const out: DocOp[] = [];
  let state = doc;
  for (const op of ops) {
    const expanded = op.type === "replace_block" ? diffBlock(state, op.id, op.block) : op.type === "delete_block" && op.after === undefined ? [withDeleteHints(state, op)] : op.type === "update_block" ? [withUpdateHints(state, op)] : [op];
    for (const e of expanded) state = docReducer.apply(state, e).state;
    out.push(...expanded);
  }
  return out;
}

/** A `delete_block` with the hints that let it be merged with other people's edits: where the block was, and what is inside it. */
function withDeleteHints(doc: Doc, op: Extract<DocOp, { type: "delete_block" }>): DocOp {
  const located = locate(doc, op.id);
  // Left alone, so applying it reports the missing block.
  if (!located) return op;
  const previous = located.list[located.index - 1];
  const within = [...collectIds([located.block])].filter((id) => id !== op.id);
  return {
    type: "delete_block",
    id: op.id,
    after: previous ? previous.id : null,
    ...(!previous && located.cell ? { cell: located.cell.cell.id } : {}),
    ...(within.length > 0 ? { within } : {}),
  };
}

/** An `update_block` that replaces a table's rows, with the ids of what was in the table. */
function withUpdateHints(doc: Doc, op: Extract<DocOp, { type: "update_block" }>): DocOp {
  if (!Array.isArray(op.patch.rows) || op.within !== undefined) return op;
  const located = locate(doc, op.id);
  if (!located) return op;
  const within = [...collectIds([located.block])].filter((id) => id !== op.id);
  return within.length > 0 ? { ...op, within } : op;
}

/** The id of the block an operation works on, if it works on one. */
function targetOf(op: DocOp): string | null {
  switch (op.type) {
    case "insert_text":
    case "delete_text":
    case "format_text":
    case "restore_marks":
    case "comment_text":
    case "set_runs":
      return op.block;
    case "update_block":
    case "replace_block":
      return op.id;
    default:
      return null;
  }
}

/** Renames the block an operation works on. */
function retarget(op: DocOp, id: string): DocOp {
  switch (op.type) {
    case "insert_text":
    case "delete_text":
    case "format_text":
    case "restore_marks":
    case "comment_text":
    case "set_runs":
      return { ...op, block: id };
    case "update_block":
      return { ...op, id };
    case "replace_block":
      return { ...op, id, block: { ...op.block, id } as Block };
    default:
      return op;
  }
}

/**
 * Before anything is written in the empty paragraph that stands in for a cell two people emptied at once (see
 * `delete_block`), put a real block there: that paragraph isn't the same on every machine's history, so nothing may
 * refer to it. The stand-in is replaced by inserting a block into the cell; the operations then work on that block.
 * Returns the operations, and which ids were renamed so a selection can follow.
 */
export function materializeStandIns(doc: Doc, ops: readonly DocOp[]): { ops: DocOp[]; renames: Map<string, string> } {
  const renames = new Map<string, string>();
  const out: DocOp[] = [];
  for (const op of ops) {
    const id = targetOf(op);
    if (id !== null && !renames.has(id) && id.endsWith("~empty")) {
      const found = locate(doc, id);
      if (found?.cell && found.list.length === 1 && isTextBlock(found.block) && textLength(found.block.runs) === 0) {
        const fresh = createId("b_");
        renames.set(id, fresh);
        out.push({ type: "insert_block", block: { id: fresh, type: "paragraph", runs: [] }, after: null, cell: found.cell.cell.id });
      }
    }
    out.push(id !== null && renames.has(id) ? retarget(op, renames.get(id)!) : op);
  }
  return { ops: out, renames };
}
