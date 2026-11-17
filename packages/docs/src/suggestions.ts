import { isTextBlock, type Block, type CellBlock, type Doc, type Marks, type Run, type Suggestion, type TextBlock } from "./model";
import type { DocOp } from "./ops";
import { marksAt, plainText, sliceRuns, textLength } from "./runs";
import { caret, coveredBlocks, flatOrder, isCollapsed, selectionRange, type Point, type Selection } from "./selection";
import { applyAll, blockAt, where, type Command } from "./command-utils";
import { backspace, deleteForward, insertText, marksAtCaret } from "./commands";

/** A suggestion as a list shows it: who, what kind, where it starts and what text it covers. */
export interface SuggestionInfo extends Suggestion {
  /** The text it adds or would remove, up to 200 characters. */
  text: string;
  /** The block where it starts and the offset in it. */
  block: string;
  from: number;
}

/** The text blocks of the body, in reading order, wherever they are (table cells included). Code blocks can't show a suggestion and aren't included. */
function textBlocks(doc: Pick<Doc, "blocks">): TextBlock[] {
  return flatOrder(doc).list.filter((b): b is TextBlock => isTextBlock(b) && b.type !== "code_block" && !b.id.endsWith("~empty"));
}

/** Every suggestion in the document, in the order its text appears. */
export function suggestionsIn(doc: Pick<Doc, "blocks">): SuggestionInfo[] {
  const found = new Map<string, SuggestionInfo>();
  for (const block of textBlocks(doc)) {
    let at = 0;
    for (const run of block.runs) {
      const s = run.marks?.suggest;
      if (s) {
        const known = found.get(s.id);
        if (known) known.text = (known.text + run.text).slice(0, 200);
        else found.set(s.id, { ...s, text: run.text.slice(0, 200), block: block.id, from: at });
      }
      at += run.text.length;
    }
  }
  return [...found.values()];
}

/** The ids of the suggestions the blocks contain. */
export function suggestionIds(blocks: readonly Block[]): Set<string> {
  const ids = new Set<string>();
  for (const block of textBlocks({ blocks: blocks as Block[] })) for (const run of block.runs) if (run.marks?.suggest) ids.add(run.marks.suggest.id);
  return ids;
}

interface Span {
  block: string;
  from: number;
  to: number;
  suggest: Suggestion;
}

function spans(doc: Pick<Doc, "blocks">, wanted: (s: Suggestion) => boolean): Span[] {
  const out: Span[] = [];
  for (const block of textBlocks(doc)) {
    let at = 0;
    let open: Span | null = null;
    for (const run of block.runs) {
      const end = at + run.text.length;
      const s = run.marks?.suggest;
      if (s && wanted(s)) {
        if (open && open.suggest.id === s.id && open.to === at) open.to = end;
        else out.push((open = { block: block.id, from: at, to: end, suggest: s }));
      } else open = null;
      at = end;
    }
  }
  return out;
}

/**
 * The operations that accept or reject suggestions: `which` is one id, or a test, or every suggestion by default.
 * Accepting makes an addition plain text and removes the text proposed for deletion; rejecting is the other way round.
 * They are all in one list, so applying it is one undo step.
 */
export function resolveSuggestionOps(doc: Pick<Doc, "blocks">, action: "accept" | "reject", which: string | ((s: Suggestion) => boolean) = () => true): DocOp[] {
  const wanted = typeof which === "string" ? (s: Suggestion) => s.id === which : which;
  const all = spans(doc, wanted);
  // Later text first, so the positions of what is still to do hold.
  all.sort((a, b) => (a.block === b.block ? b.from - a.from : 0));
  const byBlock = new Map<string, Span[]>();
  for (const s of all) byBlock.set(s.block, [...(byBlock.get(s.block) ?? []), s]);
  const ops: DocOp[] = [];
  for (const list of byBlock.values()) {
    for (const s of list) {
      const remove = action === "accept" ? s.suggest.kind === "delete" : s.suggest.kind === "insert";
      ops.push(remove ? { type: "delete_text", block: s.block, from: s.from, to: s.to } : { type: "format_text", block: s.block, from: s.from, to: s.to, patch: { suggest: null } });
    }
  }
  return ops;
}

/** The blocks with the suggestion marks taken off and the text left as it is, for text that is copied to somewhere else. */
export function stripSuggestions<T extends Block | CellBlock>(blocks: readonly T[]): T[] {
  const fix = (runs: readonly Run[]): Run[] =>
    runs.map((run) => {
      if (!run.marks?.suggest) return run;
      const { suggest: _gone, ...rest } = run.marks;
      return Object.keys(rest).length > 0 ? { ...run, marks: rest } : { text: run.text };
    });
  return blocks.map((block) => {
    if (block.type === "table") return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: stripSuggestions(c.blocks) })) })) } as T;
    return "runs" in block && block.runs.some((r) => r.marks?.suggest) ? ({ ...block, runs: fix(block.runs) } as T) : block;
  });
}

// ---- Typing and deleting as a suggestion -----------------------------------------------------------------------

/** Who is suggesting, and how new suggestions are named. */
export interface Suggester {
  by: string;
  at: number;
  newId: () => string;
}

const markOf = (marks: Marks | undefined): Suggestion | undefined => marks?.suggest;

/** What deleting a range as a suggestion does: operations, and where the end of the range is afterwards. */
function markDeletion(doc: Doc, selection: Selection, who: Suggester, continuing?: Suggestion): { ops: DocOp[]; end: Point } | null {
  const { end } = selectionRange(doc, selection);
  const suggest: Suggestion = continuing ?? { id: who.newId(), kind: "delete", by: who.by, at: who.at };
  const marking: DocOp[] = [];
  const removing: DocOp[] = [];
  let removedFromEnd = 0;
  for (const { block, from, to } of coveredBlocks(doc, selection, { raw: true })) {
    if (!isTextBlock(block) || to <= from) continue;
    // A code block can't show a suggestion, so what is deleted there is deleted.
    if (block.type === "code_block") {
      removing.push({ type: "delete_text", block: block.id, from, to });
      if (block.id === end.block) removedFromEnd += to - from;
      continue;
    }
    let at = from;
    const gone: [number, number][] = [];
    for (const run of sliceRuns(block.runs, from, to)) {
      const stop = at + run.text.length;
      const s = markOf(run.marks);
      if (s?.kind === "delete") {
        // Already proposed for deletion.
      } else if (s?.kind === "insert" && s.by === who.by) {
        gone.push([at, stop]);
      } else {
        const last = marking[marking.length - 1];
        if (last && last.type === "format_text" && last.block === block.id && last.to === at) last.to = stop;
        else marking.push({ type: "format_text", block: block.id, from: at, to: stop, patch: { suggest } });
      }
      at = stop;
    }
    // Your own pending additions are taken back for real, later text first.
    for (const [a, b] of gone.reverse()) {
      removing.push({ type: "delete_text", block: block.id, from: a, to: b });
      if (block.id === end.block) removedFromEnd += b - a;
    }
  }
  if (marking.length === 0 && removing.length === 0) return null;
  return { ops: [...marking, ...removing], end: { block: end.block, offset: end.offset - removedFromEnd } };
}

/**
 * Types as a suggestion: the text is added with a mark saying who suggested it and when, and anything selected is
 * proposed for deletion instead of removed. Typing straight after your own suggestion continues it.
 */
export function suggestInsert(text: string, who: Suggester, marks?: Marks): Command {
  return (doc, selection) => {
    if (text === "") return suggestDelete("selection", who)(doc, selection);
    let ops: DocOp[] = [];
    let work = doc;
    let point: Point = selectionRange(doc, selection).end;
    if (!isCollapsed(selection)) {
      const deletion = markDeletion(doc, selection, who);
      if (deletion) {
        ops = deletion.ops;
        work = applyAll(doc, ops);
        point = deletion.end;
      }
    }
    const block = blockAt(work, point.block);
    if (!isTextBlock(block)) return null;
    // Code blocks can't show a suggestion: typing there is typing.
    if (block.type === "code_block") return insertText(text, marks)(doc, selection);
    const before = point.offset > 0 ? markOf(marksAt(block.runs, point.offset - 1)) : undefined;
    const continuing = before?.kind === "insert" && before.by === who.by ? before : undefined;
    const base: Marks = { ...(marks ?? marksAtCaret(block, point.offset)) };
    delete base.suggest;
    const suggest: Suggestion = continuing ?? { id: who.newId(), kind: "insert", by: who.by, at: who.at };
    return {
      ops: [...ops, { type: "insert_text", block: block.id, offset: point.offset, runs: [{ text, marks: { ...base, suggest } }] }],
      selection: caret(block.id, point.offset + text.length),
    };
  };
}

/** Where a character's text is a deletion that was already suggested. */
const proposed = (block: TextBlock, index: number): boolean => markOf(marksAt(block.runs, index))?.kind === "delete";

/**
 * Deletes as a suggestion: text is struck through and stays until someone accepts. Backspace and Delete walk past what is
 * already struck, and your own additions are removed for real. At the start or end of a paragraph, where Backspace and
 * Delete would join paragraphs, they do what they always do: joining is not tracked.
 */
export function suggestDelete(kind: "backspace" | "delete" | "selection", who: Suggester): Command {
  return (doc, selection) => {
    if (!isCollapsed(selection)) {
      const deletion = markDeletion(doc, selection, who);
      return deletion ? { ops: deletion.ops, selection: caret(deletion.end.block, deletion.end.offset) } : null;
    }
    if (kind === "selection") return null;
    const at = selection.focus;
    const block = where(doc, at.block).block;
    if (!isTextBlock(block) || block.type === "code_block") return kind === "backspace" ? backspace()(doc, selection) : deleteForward()(doc, selection);
    const text = plainText(block.runs);
    const length = textLength(block.runs);
    if (kind === "backspace") {
      let end = at.offset;
      while (end > 0 && proposed(block, end - 1)) end--;
      if (end === 0) return at.offset > 0 ? { ops: [], selection: caret(block.id, 0) } : backspace()(doc, selection);
      const low = text.charCodeAt(end - 1);
      const high = end >= 2 ? text.charCodeAt(end - 2) : 0;
      const n = low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? 2 : 1;
      const range: Selection = { anchor: { block: block.id, offset: end - n }, focus: { block: block.id, offset: end } };
      // Backspacing along a row of struck text is one suggestion.
      const next = end < length ? markOf(marksAt(block.runs, end)) : undefined;
      const deletion = markDeletion(doc, range, who, next?.kind === "delete" && next.by === who.by ? next : undefined);
      return { ops: deletion?.ops ?? [], selection: caret(block.id, end - n) };
    }
    let start = at.offset;
    while (start < length && proposed(block, start)) start++;
    if (start >= length) return at.offset < length ? { ops: [], selection: caret(block.id, length) } : deleteForward()(doc, selection);
    const high = text.charCodeAt(start);
    const low = text.charCodeAt(start + 1);
    const n = high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
    const range: Selection = { anchor: { block: block.id, offset: start }, focus: { block: block.id, offset: start + n } };
    const last = start > 0 ? markOf(marksAt(block.runs, start - 1)) : undefined;
    const deletion = markDeletion(doc, range, who, last?.kind === "delete" && last.by === who.by ? last : undefined);
    // Deleting your own addition removes it, so the caret stays; otherwise it moves past what is now struck.
    return { ops: deletion?.ops ?? [], selection: caret(block.id, deletion?.end.offset ?? start + n) };
  };
}
