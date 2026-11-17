import type { Block, MarkPatch } from "./model";
import type { DocOp } from "./ops";
import { applyMarkPatch, marksEqual, type MarkSegment } from "./runs";
import { collectIds } from "./tree";

/**
 * Operational transformation for document operations.
 *
 * Two people edit the same document from the same starting point, `a` and `b`. `b` reached the server first, so
 * it comes first in the shared history and `a` comes after it. For the document to come out the same for
 * everyone, each side applies the other's operation as it has to be after its own:
 *
 *     start + b + a'  ==  start + a + b'      where  [a', b'] = transformPair(a, b)
 *
 * `a` is the later operation: where the two can't both have their way (both set the same property, say) `a` wins,
 * and where both insert at the same place, `b`'s text comes first. A transformed operation may become several
 * (a delete that someone typed inside is split in two) or none (the text it changed is gone).
 *
 * Blocks are found by id, so operations on different blocks never need changing. What does need care:
 *
 * - text operations in the same block, which are positions;
 * - operations on a block that another operation removes or replaces;
 * - two operations that set the same thing.
 */
export function transformPair(a: DocOp, b: DocOp): [DocOp[], DocOp[]] {
  // A block that is removed or rewritten takes the operations on it with it.
  const killed = resolveKills(a, b);
  if (killed) return killed;

  if (a.type === "insert_text" || a.type === "delete_text" || isRange(a)) {
    if (b.type === "insert_text" || b.type === "delete_text" || isRange(b)) {
      if (blockOf(a) === blockOf(b)) return transformText(a as TextLike, b as TextLike);
    }
    return [[a], [b]];
  }

  if (a.type === "insert_block" && b.type === "insert_block" && a.block.id === b.block.id) {
    // Two people put back the same block (each undid their own deletion of it): the later copy replaces the earlier.
    const within = [...collectIds([b.block])].filter((id) => id !== b.block.id);
    const removal: DocOp = { type: "delete_block", id: b.block.id, after: b.after, ...(b.cell !== undefined ? { cell: b.cell } : {}), ...(within.length > 0 ? { within } : {}) };
    return [[removal, a], []];
  }

  if (a.type === "insert_block" && b.type === "insert_block") {
    const sameSpot = a.after === b.after && (a.after !== null || a.cell === b.cell);
    // Both go after the same block: the earlier one stays next to it, the later one follows it.
    if (sameSpot) {
      const { cell: _cell, ...rest } = a;
      return [[{ ...rest, after: b.block.id }], [b]];
    }
    return [[a], [b]];
  }

  if (a.type === "update_block" && b.type === "update_block" && a.id === b.id) {
    // The later change to a property wins.
    const patch = Object.fromEntries(Object.entries(b.patch).filter(([key]) => !(key in a.patch)));
    const kept: DocOp[] = Object.keys(patch).length > 0 ? [{ ...b, patch }] : [];
    // When both replace the table's rows, `a`'s win, and cover what `b`'s rows would have brought.
    return [["rows" in a.patch && "rows" in b.patch ? covering(a, b) : a].flat() as DocOp[], kept];
  }

  // A removal remembers the block before it. If that block is removed too, the removal remembers the one before that.
  if (a.type === "delete_block" && b.type === "delete_block" && a.id !== b.id) {
    return [[a.after === b.id ? forgetting(a, b) : a], [b.after === a.id ? forgetting(b, a) : b]];
  }

  // Something inserted right where a removed block sat becomes the block before it.
  if (a.type === "delete_block" && b.type === "insert_block" && sameSpot(b, a)) return [[after(a, b.block.id)], [b]];
  if (a.type === "insert_block" && b.type === "delete_block" && sameSpot(a, b)) return [[a], [after(b, a.block.id)]];

  const sameThing = sameDocSetting(a, b);
  if (sameThing) return [[a], []];

  return [[a], [b]];
}

/** Transforms two lists of operations that both start from the same document. `b` came first. */
export function transformOps(a: readonly DocOp[], b: readonly DocOp[]): [DocOp[], DocOp[]] {
  if (a.length === 0 || b.length === 0) return [[...a], [...b]];
  if (a.length === 1 && b.length === 1) return transformPair(a[0]!, b[0]!);
  if (a.length > 1) {
    const [first, ...rest] = a;
    const [firstOut, bAfter] = transformOps([first!], b);
    const orphans = withoutOrphans(first!, firstOut, rest, bAfter);
    const [restOut, bFinal] = transformOps(orphans.kept, bAfter);
    // Whoever survived the other side's loss also covers what was lost with it.
    return [[...firstOut, ...restOut], coveringAll(bFinal, orphans.dropped)];
  }
  const [first, ...rest] = b;
  const [aAfter, firstOut] = transformOps(a, [first!]);
  const orphans = withoutOrphans(first!, firstOut, rest, aAfter);
  const [aFinal, restOut] = transformOps(aAfter, orphans.kept);
  return [coveringAll(aFinal, orphans.dropped), [...firstOut, ...restOut]];
}

/**
 * Operations that remove or rewrite a table, noting the ids of operations that were dropped because they built on
 * something it overrode: whoever dropped them is gone with the table, and so are the blocks they made.
 */
function coveringAll(ops: DocOp[], dropped: readonly DocOp[]): DocOp[] {
  if (dropped.length === 0) return ops;
  return ops.map((op) => {
    const killer = killerOf(op);
    if (!killer || (op.type !== "delete_block" && op.type !== "update_block")) return op;
    const within = new Set<string>(op.within ?? []);
    const owns = (id: string) => id === killer.self || killer.covered.has(id) || within.has(id);
    for (const lost of dropped) {
      // Only what was built on this table's blocks is its doing.
      if (targetsOf(lost).some(owns)) for (const id of introducedBy(lost)) within.add(id);
    }
    return within.size === (op.within?.length ?? 0) ? op : { ...op, within: [...within] };
  });
}

/** Whether an insertion went in right after the block (or at the start of the list) that a removal remembers as its neighbour. */
function sameSpot(insert: Extract<DocOp, { type: "insert_block" }>, removal: Extract<DocOp, { type: "delete_block" }>): boolean {
  if (removal.after === undefined) return false;
  return insert.after === removal.after && (insert.after !== null || insert.cell === removal.cell);
}

function after(removal: Extract<DocOp, { type: "delete_block" }>, id: string): DocOp {
  const { cell: _cell, ...rest } = removal;
  return { ...rest, after: id };
}

/** A removal whose remembered neighbour `gone` has been removed, pointing at where `gone` was instead. */
function forgetting(op: Extract<DocOp, { type: "delete_block" }>, gone: Extract<DocOp, { type: "delete_block" }>): DocOp {
  const { cell: _cell, ...rest } = op;
  const after = gone.after ?? null;
  return after === null && gone.cell !== undefined ? { ...rest, after: null, cell: gone.cell } : { ...rest, after };
}

/** `winner` that removes or rewrites a table, noting the ids that `loser`, which it overrides, would have put in it. */
function covering(winner: DocOp, loser: DocOp): DocOp {
  // Everything the loser knows to be in the table: someone else may be editing any of it, unaware that it is gone.
  const added = knownBy(loser);
  if (added.size === 0) return winner;
  if (winner.type === "delete_block" || (winner.type === "update_block" && Array.isArray(winner.patch.rows))) {
    return { ...winner, within: [...new Set([...(winner.within ?? []), ...added])] };
  }
  return winner;
}

/**
 * What a client does when an operation arrives from the server while it has changes the server hasn't taken yet:
 * those in flight (sent, not yet accepted) and those waiting to be sent, written on top of the first.
 * Returns the operations as they now stand, and the incoming ones to apply to the document as it is now.
 */
export function rebase(inflight: readonly DocOp[], pending: readonly DocOp[], incoming: readonly DocOp[]): { inflight: DocOp[]; pending: DocOp[]; incoming: DocOp[] } {
  const [inflightOut, afterInflight] = transformOps(inflight, incoming);
  // Waiting changes that build on something in flight that lost out can't stand either.
  const orphans = withoutOrphans(inflight, inflightOut, [...pending], afterInflight);
  const [pendingOut, applied] = transformOps(orphans.kept, afterInflight);
  // What was dropped from the waiting changes was made on top of what lost out, so what removed it covers it too.
  return { inflight: inflightOut, pending: pendingOut, incoming: coveringAll(applied, orphans.dropped) };
}

/** The ids of every block, row and cell in what an operation puts in the document, new or not. */
function contentOf(op: DocOp): Set<string> {
  if (op.type === "insert_block" || op.type === "replace_block") return collectIds([op.block]);
  if (op.type === "update_block" && Array.isArray(op.patch.rows)) {
    const ids = collectIds([{ id: op.id, type: "table", rows: op.patch.rows, columns: [] } as Block]);
    ids.delete(op.id);
    return ids;
  }
  return new Set();
}

/** The ids of everything an operation says is in a table it rewrites: what it puts there and what it replaced. */
function knownBy(op: DocOp): Set<string> {
  const ids = introducedBy(op);
  if (op.type === "update_block" || op.type === "delete_block") for (const id of op.within ?? []) ids.add(id);
  return ids;
}

/** The ids of the blocks, rows and cells an operation brings into the document. */
function introducedBy(op: DocOp): Set<string> {
  switch (op.type) {
    case "insert_block":
      return collectIds([op.block]);
    case "replace_block":
      return collectIds([op.block]);
    case "update_block": {
      if (!Array.isArray(op.patch.rows)) return new Set();
      // What was in the table already isn't new.
      const ids = collectIds([{ id: op.id, type: "table", rows: op.patch.rows, columns: [] } as Block]);
      ids.delete(op.id);
      for (const id of op.within ?? []) ids.delete(id);
      return ids;
    }
    default:
      return new Set();
  }
}

/**
 * The operations that follow one that lost out, without those that work on what it would have created: if a
 * table's new rows were thrown away, so is the typing someone did in them.
 */
function withoutOrphans(original: DocOp | readonly DocOp[], result: readonly DocOp[], following: DocOp[], other: readonly DocOp[] = []): { kept: DocOp[]; lost: Set<string>; dropped: DocOp[] } {
  const dead = new Set<string>();
  for (const op of Array.isArray(original) ? original : [original as DocOp]) for (const id of introducedBy(op)) dead.add(id);
  if (dead.size === 0) return { kept: following, lost: dead, dropped: [] };
  // What the surviving operations bring back isn't lost (a table's rows put back blocks an earlier insert lost).
  // The other side's surviving operations count too: it may put the same block back (an undo of a delete).
  for (const op of [...result, ...other]) for (const id of contentOf(op)) dead.delete(id);
  if (dead.size === 0) return { kept: following, lost: dead, dropped: [] };
  const kept: DocOp[] = [];
  const dropped: DocOp[] = [];
  for (const op of following) {
    if (targetsOf(op).some((id) => dead.has(id))) {
      dropped.push(op);
      for (const id of introducedBy(op)) dead.add(id);
    } else {
      kept.push(op);
      // A later operation that puts the blocks back (rewriting the table's rows) makes them real again.
      for (const id of contentOf(op)) dead.delete(id);
    }
  }
  return { kept, lost: dead, dropped };
}

// ---- Blocks that are removed or rewritten --------------------------------------------------------------------

/** An operation that makes others on the same blocks pointless. A higher rank wins over a lower. */
interface Killer {
  rank: number;
  /** The block it removes or rewrites, if any. */
  self: string | null;
  /** Blocks inside it (cells of a table) that it also removes or rewrites. */
  covered: Set<string>;
}

function killerOf(op: DocOp): Killer | null {
  switch (op.type) {
    case "delete_block":
      return { rank: 3, self: op.id, covered: new Set(op.within ?? []) };
    case "replace_block": {
      const covered = collectIds([op.block]);
      covered.delete(op.id);
      return { rank: 2, self: op.id, covered };
    }
    case "set_runs":
      return { rank: 2, self: op.block, covered: new Set() };
    case "update_block":
      // A table's rows are replaced as a whole, which overwrites anything done to what is in them.
      if (Array.isArray(op.patch.rows)) {
        // What it puts there, and what it takes away (the hint).
        const covered = collectIds([{ id: op.id, type: "table", rows: op.patch.rows, columns: [] } as Block]);
        covered.delete(op.id);
        for (const id of op.within ?? []) covered.add(id);
        return { rank: 1, self: null, covered };
      }
      return null;
    default:
      return null;
  }
}

/** The blocks an operation works on. */
function targetsOf(op: DocOp): string[] {
  switch (op.type) {
    case "insert_text":
    case "delete_text":
    case "format_text":
    case "restore_marks":
    case "comment_text":
    case "set_runs":
      return [op.block];
    case "update_block":
    case "replace_block":
    case "delete_block":
      return [op.id];
    case "insert_block":
      return [op.after, op.cell].filter((id): id is string => typeof id === "string");
    default:
      return [];
  }
}

function hitBy(killer: Killer, op: DocOp): boolean {
  // Something inserted right after the block itself isn't lost with it: it stays, or moves to where the block was.
  if (op.type === "insert_block") {
    return (typeof op.after === "string" && op.after !== killer.self && killer.covered.has(op.after)) || (op.cell !== undefined && killer.covered.has(op.cell));
  }
  return targetsOf(op).some((id) => id === killer.self || killer.covered.has(id));
}

function resolveKills(a: DocOp, b: DocOp): [DocOp[], DocOp[]] | null {
  const ka = killerOf(a);
  const kb = killerOf(b);
  let dropA = !!kb && hitBy(kb, a);
  let dropB = !!ka && hitBy(ka, b);

  if (dropA && dropB) {
    // Each overwrites the other. The higher rank wins; equal ranks, the later one (a), but two removals of the same block both just remove it.
    if (ka!.rank > kb!.rank) dropA = false;
    else if (kb!.rank > ka!.rank) dropB = false;
    else if (ka!.rank !== 3) dropA = false;
  }
  if (dropA || dropB) {
    // What survives now also covers what the other would have put there, so edits to that are lost along with it.
    return [dropA ? [] : [dropB ? covering(a, b) : a], dropB ? [] : [dropA ? covering(b, a) : b]];
  }

  // Something was inserted after a block that has been removed: it goes where the block was.
  if (a.type === "insert_block" && b.type === "delete_block" && a.after === b.id) return [[reanchor(a, b)], [b]];
  if (b.type === "insert_block" && a.type === "delete_block" && b.after === a.id) return [[a], [reanchor(b, a)]];
  return null;
}

function reanchor(insert: Extract<DocOp, { type: "insert_block" }>, removed: Extract<DocOp, { type: "delete_block" }>): DocOp {
  const { cell: _cell, ...rest } = insert;
  const after = removed.after ?? null;
  return after === null && removed.cell !== undefined ? { ...rest, after: null, cell: removed.cell } : { ...rest, after };
}

/** Two operations that set the same single thing on the document: the later one wins. */
function sameDocSetting(a: DocOp, b: DocOp): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "set_title":
    case "set_page":
      return true;
    case "set_region":
      return a.region === (b as typeof a).region;
    case "set_footnote":
    case "set_thread":
    case "set_style":
      return a.id === (b as typeof a).id;
    default:
      return false;
  }
}

// ---- Text in one block ---------------------------------------------------------------------------------------

type Insert = Extract<DocOp, { type: "insert_text" }>;
type Delete = Extract<DocOp, { type: "delete_text" }>;
type Range = Extract<DocOp, { type: "format_text" | "restore_marks" | "comment_text" }>;
type TextLike = Insert | Delete | Range;

function isRange(op: DocOp): op is Range {
  return op.type === "format_text" || op.type === "restore_marks" || op.type === "comment_text";
}

function blockOf(op: TextLike | DocOp): string | null {
  return "block" in op && typeof op.block === "string" ? op.block : null;
}

const lengthOf = (op: Insert) => op.runs.reduce((n, r) => n + r.text.length, 0);

/** Where a position goes once [from, to) is removed. A position inside it goes to the start of the gap. */
const mapThrough = (x: number, from: number, to: number) => (x <= from ? x : x >= to ? x - (to - from) : from);

function transformText(a: TextLike, b: TextLike): [DocOp[], DocOp[]] {
  if (a.type === "insert_text" && b.type === "insert_text") {
    // Same place: the earlier insert (b) comes first.
    const aOffset = b.offset <= a.offset ? a.offset + lengthOf(b) : a.offset;
    const bOffset = a.offset < b.offset ? b.offset + lengthOf(a) : b.offset;
    return [[{ ...a, offset: aOffset }], [{ ...b, offset: bOffset }]];
  }
  if (a.type === "insert_text" && b.type === "delete_text") return [[{ ...a, offset: mapThrough(a.offset, b.from, b.to) }], splitAround(b, a)];
  if (a.type === "delete_text" && b.type === "insert_text") return [splitAround(a, b), [{ ...b, offset: mapThrough(b.offset, a.from, a.to) }]];
  if (a.type === "delete_text" && b.type === "delete_text") return [removeOverlap(a, b), removeOverlap(b, a)];

  if (isRange(a) && b.type === "insert_text") return [aroundInsert(a, b), [b]];
  if (a.type === "insert_text" && isRange(b)) return [[a], aroundInsert(b, a)];
  if (isRange(a) && b.type === "delete_text") return [afterDelete(a, b), [b]];
  if (a.type === "delete_text" && isRange(b)) return [[a], afterDelete(b, a)];

  // Two changes to marks. Neither moves any text; the later one (a) wins where they overlap.
  return [[a], loseTo(b as Range, a as Range)];
}

/** A delete after an insert in the same block: split around the inserted text if it landed inside. */
function splitAround(del: Delete, ins: Insert): DocOp[] {
  const n = lengthOf(ins);
  if (ins.offset <= del.from) return [{ ...del, from: del.from + n, to: del.to + n }];
  if (ins.offset >= del.to) return [del];
  // The later part goes first, so the earlier part's positions are still right when its turn comes.
  return [
    { ...del, from: ins.offset + n, to: del.to + n },
    { ...del, from: del.from, to: ins.offset },
  ];
}

/** `del` once `other`, which removed text from the same block, has happened. */
function removeOverlap(del: Delete, other: Delete): DocOp[] {
  const from = mapThrough(del.from, other.from, other.to);
  const to = mapThrough(del.to, other.from, other.to);
  return to > from ? [{ ...del, from, to }] : [];
}

// ---- Marks ---------------------------------------------------------------------------------------------------

/** The part of a range operation over [from, to) of the text. */
function slice(op: Range, from: number, to: number, shift = 0): Range {
  if (op.type === "restore_marks") return { ...op, from: from + shift, to: to + shift, segments: sliceSegments(op.segments, from - op.from, to - op.from) };
  return { ...op, from: from + shift, to: to + shift };
}

function sliceSegments(segments: readonly MarkSegment[], from: number, to: number): MarkSegment[] {
  const out: MarkSegment[] = [];
  let pos = 0;
  for (const segment of segments) {
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + segment.length);
    if (a < b) out.push(segment.marks ? { length: b - a, marks: segment.marks } : { length: b - a });
    pos += segment.length;
  }
  return out;
}

/** A range operation once text was inserted in the same block: shifted if it came before, split around it if inside. */
function aroundInsert(op: Range, ins: Insert): DocOp[] {
  const n = lengthOf(ins);
  if (ins.offset <= op.from) return [slice(op, op.from, op.to, n)];
  if (ins.offset >= op.to) return [op];
  return [slice(op, op.from, ins.offset), slice(op, ins.offset, op.to, n)];
}

/** A range operation once text was removed from the same block. What it covered that is gone drops out. */
function afterDelete(op: Range, del: Delete): DocOp[] {
  const from = mapThrough(op.from, del.from, del.to);
  const to = mapThrough(op.to, del.from, del.to);
  if (to <= from) return [];
  if (op.type !== "restore_marks") return [{ ...op, from, to }];
  const lo = Math.max(op.from, del.from) - op.from;
  const hi = Math.min(op.to, del.to) - op.from;
  const segments = hi > lo ? [...sliceSegments(op.segments, 0, lo), ...sliceSegments(op.segments, hi, op.to - op.from)] : op.segments;
  return [{ ...op, from, to, segments }];
}

/** `b`, an earlier change to marks, once `a`, a later one over some of the same text, has happened on top. */
function loseTo(b: Range, a: Range): DocOp[] {
  const lo = Math.max(a.from, b.from);
  const hi = Math.min(a.to, b.to);
  if (lo >= hi) return [b];
  const pieces: Range[] = [];
  if (b.from < lo) pieces.push(slice(b, b.from, lo));
  const middle = overlapAfter(b, a, lo, hi);
  if (middle) pieces.push(middle);
  if (hi < b.to) pieces.push(slice(b, hi, b.to));
  return pieces;
}

/** What is left of `b` over the text `a` also changes, or null if `a` overrides it. */
function overlapAfter(b: Range, a: Range, lo: number, hi: number): Range | null {
  const part = slice(b, lo, hi);
  if (b.type === "comment_text" || a.type === "comment_text") {
    // Comments are separate from formatting. Two on the same thread that disagree: the later one wins.
    return b.type === "comment_text" && a.type === "comment_text" && b.id === a.id && b.on !== a.on ? null : part;
  }
  if (a.type === "restore_marks") return null;
  if (a.type === "format_text" && b.type === "format_text") {
    const patch: MarkPatch = Object.fromEntries(Object.entries(b.patch).filter(([key]) => !(key in a.patch)));
    return Object.keys(patch).length > 0 ? { ...(part as typeof b), patch } : null;
  }
  if (a.type === "format_text" && b.type === "restore_marks") {
    // The restore happened first and the formatting went on top of it: its marks are the restored ones, formatted.
    const patched = (part as typeof b).segments.map((segment) => {
      const marks = applyMarkPatch(segment.marks, a.patch);
      return marks && Object.keys(marks).length > 0 ? { length: segment.length, marks } : { length: segment.length };
    });
    return { ...(part as typeof b), segments: mergeSegments(patched) };
  }
  return part;
}

function mergeSegments(segments: MarkSegment[]): MarkSegment[] {
  const out: MarkSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && marksEqual(last.marks, segment.marks)) last.length += segment.length;
    else out.push({ ...segment });
  }
  return out;
}
