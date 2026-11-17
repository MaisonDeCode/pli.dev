import { createId } from "@pli.dev/core";
import {
  isFormattable,
  isTextBlock,
  type Align,
  type Block,
  type Columns,
  type Doc,
  type DocStyle,
  type ListItemBlock,
  type ListMarker,
  type MarkPatch,
  type Marks,
  type ParagraphBlock,
  type ParagraphFormatPatch,
  type Run,
  type SectionBreakBlock,
  type StyleMarks,
  type TextBlock,
} from "./model";
import { STYLE_MARK_KEYS, resolveStyle, withParagraphStyle } from "./styles";
import { docReducer, type DocOp } from "./ops";
import { marksAt, plainText, rangeHasMark, sliceRuns, textLength } from "./runs";
import {
  blockLength,
  caret,
  cellRect,
  cellsInRect,
  coveredBlocks,
  flatIndexOf,
  flatOrder,
  isCollapsed,
  selectedBlocks,
  selectionRange,
  type CellRect,
  type Point,
  type Selection,
} from "./selection";
import { applyAll, blockAt, emptyParagraph, endPointOf, finish, startPointOf, where, type Command, type CommandResult } from "./command-utils";
import { createTable } from "./tables";
import { FOOTNOTE_CHAR } from "./footnotes";
import { columnSetup, columnsAt, columnsValue, sectionAt } from "./sections";
import { pageSetupOf } from "./page";
import { sectionBreak } from "./build";
import { MAX_LIST_START, BULLET_MARKERS, NUMBER_MARKERS, defaultMarker, listRun } from "./lists";
import { locate, type Located } from "./tree";

export { endPointOf, startPointOf } from "./command-utils";
export * from "./tables";
export * from "./paste";

export type { Command, CommandResult } from "./command-utils";

const MAX_LIST_DEPTH = 8;

/** Clears every cell of a rectangle, leaving one empty paragraph in each. */
function clearCells(doc: Doc, rect: CellRect): CommandResult {
  const table = rect.table;
  const rows = table.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((cell, c) => {
      if (cell.covered || r < rect.row1 || r > rect.row2 || c < rect.col1 || c > rect.col2) return cell;
      const keep = cell.blocks[0]!;
      const blank: ParagraphBlock = isFormattable(keep)
        ? { ...emptyParagraph(keep.id), ...(keep.align && { align: keep.align }), ...(keep.format && { format: keep.format }) }
        : emptyParagraph(keep.id);
      return { ...cell, blocks: [blank] };
    }),
  }));
  const first = cellsInRect(rect)[0]!.cell.blocks[0]!;
  return {
    ops: [{ type: "replace_block", id: table.id, block: { ...table, rows } }],
    selection: caret(first.id, 0),
  };
}

/**
 * Ops that delete the selection. The end of the range joins the start when both are text in the
 * same list of blocks; across cell boundaries nothing is joined, and a table is only removed
 * when the range covers it completely. Dragging across several cells clears them.
 */
function deleteRangeStep(doc: Doc, selection: Selection): CommandResult {
  const rect = cellRect(doc, selection);
  if (rect) return clearCells(doc, rect);

  const range = selectionRange(doc, selection);
  const { start } = range;
  let { end } = range;
  // A range that stops at the very start of a table (a triple-click on the line above it does) selects nothing in the table, so it ends where the block before it does.
  if (end.offset === 0 && start.block !== end.block && blockAt(doc, end.block).type === "table") {
    const { list } = flatOrder(doc);
    const before = list[flatIndexOf(doc, end.block) - 1];
    if (before && flatIndexOf(doc, before.id) >= flatIndexOf(doc, start.block)) {
      end = { block: before.id, offset: blockLength(before) };
      selection = { anchor: start, focus: end };
    }
  }
  const ops: DocOp[] = [];

  if (start.block === end.block) {
    const block = blockAt(doc, start.block);
    if (isTextBlock(block) && end.offset > start.offset) {
      ops.push({ type: "delete_text", block: block.id, from: start.offset, to: end.offset });
    }
    return { ops, selection: caret(block.id, start.offset) };
  }

  const covered = coveredBlocks(doc, selection, { raw: true });
  const first = covered[0]!.block;
  const last = covered[covered.length - 1]!.block;
  const startAt = where(doc, start.block);
  const endAt = where(doc, end.block);
  const merge = startAt.list === endAt.list && isTextBlock(first) && isTextBlock(last);

  // A table is removed whole only if neither end of the range is inside it.
  const removedTables = new Set<string>();
  for (const { block } of covered) {
    if (block.type === "table" && startAt.cell?.table.id !== block.id && endAt.cell?.table.id !== block.id) {
      removedTables.add(block.id);
    }
  }

  for (const { block, from, to } of covered) {
    if (block.type === "table") {
      if (removedTables.has(block.id)) ops.push({ type: "delete_block", id: block.id });
      continue;
    }
    const container = where(doc, block.id).cell;
    if (container && removedTables.has(container.table.id)) continue;

    if (!isTextBlock(block)) {
      ops.push({ type: "delete_block", id: block.id });
    } else if (block.id === first.id) {
      const length = textLength(block.runs);
      if (length > from) ops.push({ type: "delete_text", block: block.id, from, to: length });
    } else if (block.id === last.id) {
      if (!merge && to > 0) ops.push({ type: "delete_text", block: block.id, from: 0, to });
    } else {
      ops.push({ type: "delete_block", id: block.id });
    }
  }

  if (merge && isTextBlock(first) && isTextBlock(last)) {
    const tail = sliceRuns(last.runs, end.offset, textLength(last.runs));
    ops.push({ type: "delete_block", id: last.id });
    if (tail.length > 0) ops.push({ type: "insert_text", block: first.id, offset: start.offset, runs: tail });
  }

  return finish(doc, ops, caret(start.block, start.offset));
}

/**
 * Starts a command that first replaces any selected range: returns the ops so far, the
 * document after them, and the caret where the command continues.
 */
export function collapseSelection(
  doc: Doc,
  selection: Selection,
): { ops: DocOp[]; doc: Doc; at: Point } {
  const { start } = selectionRange(doc, selection);
  if (isCollapsed(selection)) return { ops: [], doc, at: start };
  const deletion = deleteRangeStep(doc, selection);
  return { ops: deletion.ops, doc: applyAll(doc, deletion.ops), at: deletion.selection.focus };
}

/** Marks that newly typed text should carry: the formatting of the text just before the caret. */
export function marksAtCaret(block: TextBlock, offset: number): Marks | undefined {
  if (offset === 0) {
    const marks = marksAt(block.runs, 0);
    if (!marks) return undefined;
    const { link: _link, field: _field, footnote: _footnote, ...rest } = marks;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }
  const before = marksAt(block.runs, offset - 1);
  if (!before) return undefined;
  const marks = { ...before };
  delete marks.field;
  delete marks.footnote;
  // Typing inside a link extends it; typing at either edge does not.
  if (marks.link && marksAt(block.runs, offset)?.link !== marks.link) delete marks.link;
  return Object.keys(marks).length > 0 ? marks : undefined;
}

/** Number of UTF-16 units in the character ending at `offset`, so emoji aren't cut in half. */
function charUnitsBefore(text: string, offset: number): number {
  const low = text.charCodeAt(offset - 1);
  const high = offset >= 2 ? text.charCodeAt(offset - 2) : 0;
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? 2 : 1;
}

function charUnitsAfter(text: string, offset: number): number {
  const high = text.charCodeAt(offset);
  const low = text.charCodeAt(offset + 1);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
}

/** Deletes the selected range, if any. */
export function deleteSelection(): Command {
  return (doc, selection) => {
    if (isCollapsed(selection)) return null;
    return deleteRangeStep(doc, selection);
  };
}

/**
 * Types text at the caret, replacing any selected range. New text inherits the formatting of
 * the text before it, unless `marks` is given. Newlines are not special here; use `splitBlock`
 * for Enter.
 */
export function insertText(text: string, marks?: Marks): Command {
  return (doc, selection) => {
    if (text === "") return deleteSelection()(doc, selection);
    const step = collapseSelection(doc, selection);
    const block = blockAt(step.doc, step.at.block);
    if (!isTextBlock(block)) return null;
    const runMarks = marks ?? marksAtCaret(block, step.at.offset);
    const run: Run = runMarks ? { text, marks: runMarks } : { text };
    return {
      ops: [...step.ops, { type: "insert_text", block: block.id, offset: step.at.offset, runs: [run] }],
      selection: caret(block.id, step.at.offset + text.length),
    };
  };
}

/** Enter: split the block at the caret. Empty list items and quotes exit; code blocks add a line. */
export function splitBlock(): Command {
  return (doc, selection) => {
    const step = collapseSelection(doc, selection);
    const block = blockAt(step.doc, step.at.block);
    const ops = step.ops;

    if (!isTextBlock(block)) {
      const fresh: ParagraphBlock = { id: createId("b_"), type: "paragraph", runs: [] };
      return {
        ops: [...ops, { type: "insert_block", block: fresh, after: block.id }],
        selection: caret(fresh.id, 0),
      };
    }

    const len = textLength(block.runs);
    const offset = step.at.offset;

    if (block.type === "code_block") {
      return {
        ops: [...ops, { type: "insert_text", block: block.id, offset, runs: [{ text: "\n" }] }],
        selection: caret(block.id, offset + 1),
      };
    }

    if (len === 0 && block.type === "list_item") {
      const exited: Block =
        block.depth > 0
          ? { ...block, depth: block.depth - 1 }
          : { id: block.id, type: "paragraph", runs: [] };
      return {
        ops: [...ops, { type: "replace_block", id: block.id, block: exited }],
        selection: caret(block.id, 0),
      };
    }
    if (len === 0 && block.type === "quote") {
      return {
        ops: [...ops, { type: "replace_block", id: block.id, block: { id: block.id, type: "paragraph", runs: [] } }],
        selection: caret(block.id, 0),
      };
    }

    const tail = sliceRuns(block.runs, offset, len);
    const id = createId("b_");
    let created: TextBlock;
    switch (block.type) {
      case "heading":
      case "title":
      case "subtitle":
        // Pressing Enter at the end of a heading or title starts a normal paragraph.
        created =
          offset === len
            ? { id, type: "paragraph", runs: tail, ...(block.align && { align: block.align }) }
            : { ...block, id, runs: tail };
        break;
      case "list_item": {
        // A new item carries on the numbering; only the one that starts it holds the start number.
        const { start: _start, ...rest } = block;
        created = { ...rest, id, runs: tail };
        break;
      }
      case "paragraph":
        created = { ...block, id, runs: tail };
        break;
      case "quote":
        created = { ...block, id, runs: tail };
        break;
    }

    if (offset < len) ops.push({ type: "delete_text", block: block.id, from: offset, to: len });
    ops.push({ type: "insert_block", block: created, after: block.id });
    return { ops, selection: caret(id, 0) };
  };
}

/** Joins `next` onto the end of `block`, then removes `next`. */
function mergeOps(block: TextBlock, next: TextBlock): DocOp[] {
  const ops: DocOp[] = [];
  if (next.runs.length > 0) {
    ops.push({ type: "insert_text", block: block.id, offset: textLength(block.runs), runs: next.runs });
  }
  ops.push({ type: "delete_block", id: next.id });
  return ops;
}

/** Removes a block that holds no text. A table cell that would be left with nothing keeps an empty paragraph. */
function removeNonTextBlock(doc: Doc, located: Located): CommandResult {
  const { block } = located;
  if (located.cell && located.list.length === 1) {
    return { ops: [{ type: "replace_block", id: block.id, block: emptyParagraph(block.id) }], selection: caret(block.id, 0) };
  }
  const before = located.list[located.index - 1];
  const after = located.list[located.index + 1];
  const point = before ? endPointOf(before) : after ? startPointOf(after) : null;
  return finish(doc, [{ type: "delete_block", id: block.id }], point ? caret(point.block, point.offset) : caret(block.id, 0));
}

/** Delete the selection, or the character before the caret, or merge/convert at a block start. */
export function backspace(): Command {
  return (doc, selection) => {
    if (!isCollapsed(selection)) return deleteSelection()(doc, selection);
    const at = selection.focus;
    const located = where(doc, at.block);
    const block = located.block;
    const previous = located.list[located.index - 1];

    if (!isTextBlock(block)) return removeNonTextBlock(doc, located);

    if (at.offset > 0) {
      const n = charUnitsBefore(plainText(block.runs), at.offset);
      return {
        ops: [{ type: "delete_text", block: block.id, from: at.offset - n, to: at.offset }],
        selection: caret(block.id, at.offset - n),
      };
    }

    if (block.type === "list_item") {
      const converted: Block =
        block.depth > 0
          ? { ...block, depth: block.depth - 1 }
          : { id: block.id, type: "paragraph", runs: block.runs };
      return { ops: [{ type: "replace_block", id: block.id, block: converted }], selection: caret(block.id, 0) };
    }
    if (block.type !== "paragraph") {
      const converted: Block = { id: block.id, type: "paragraph", runs: block.runs };
      return { ops: [{ type: "replace_block", id: block.id, block: converted }], selection: caret(block.id, 0) };
    }

    // Nothing joins across the edge of a table cell, and nothing reaches into a table from below.
    if (!previous || previous.type === "table") return null;
    if (!isTextBlock(previous)) {
      return { ops: [{ type: "delete_block", id: previous.id }], selection: caret(block.id, 0) };
    }
    return { ops: mergeOps(previous, block), selection: caret(previous.id, textLength(previous.runs)) };
  };
}

/** Delete the selection, or the character after the caret, or pull the next block up. */
export function deleteForward(): Command {
  return (doc, selection) => {
    if (!isCollapsed(selection)) return deleteSelection()(doc, selection);
    const at = selection.focus;
    const located = where(doc, at.block);
    const block = located.block;
    const next = located.list[located.index + 1];

    if (!isTextBlock(block)) return backspace()(doc, selection);

    const len = textLength(block.runs);
    if (at.offset < len) {
      const n = charUnitsAfter(plainText(block.runs), at.offset);
      return {
        ops: [{ type: "delete_text", block: block.id, from: at.offset, to: at.offset + n }],
        selection: caret(block.id, at.offset),
      };
    }
    // An empty line above a table can't join it, so Delete removes the line and the caret goes into the table.
    if (next?.type === "table" && len === 0 && block.type === "paragraph") {
      const start = startPointOf(next);
      return start ? { ops: [{ type: "delete_block", id: block.id }], selection: caret(start.block, start.offset) } : null;
    }
    if (!next || next.type === "table") return null;
    if (!isTextBlock(next)) {
      return { ops: [{ type: "delete_block", id: next.id }], selection: caret(block.id, at.offset) };
    }
    return { ops: mergeOps(block, next), selection: caret(block.id, at.offset) };
  };
}

export interface Segment {
  block: TextBlock;
  from: number;
  to: number;
}

/** The text ranges the selection covers, one per block. Code blocks hold plain text and are skipped. */
export function segmentsOf(doc: Doc, selection: Selection): Segment[] {
  const out: Segment[] = [];
  for (const { block, from, to } of coveredBlocks(doc, selection)) {
    if (isTextBlock(block) && block.type !== "code_block" && to > from) out.push({ block, from, to });
  }
  return out;
}

/** Applies a mark patch to the selected text. Does nothing for a collapsed selection. */
export function setMarks(patch: MarkPatch): Command {
  return (doc, selection) => {
    const segments = segmentsOf(doc, selection);
    if (segments.length === 0) return null;
    return {
      ops: segments.map((s) => ({
        type: "format_text" as const,
        block: s.block.id,
        from: s.from,
        to: s.to,
        patch,
      })),
      selection,
    };
  };
}

export type ToggleMarkKey = "bold" | "italic" | "underline" | "strike" | "code" | "superscript" | "subscript";

/** Marks that can't be combined: turning one on turns the other off. */
const EXCLUSIVE: Partial<Record<ToggleMarkKey, ToggleMarkKey>> = {
  superscript: "subscript",
  subscript: "superscript",
};

/** The patch that turns a boolean mark on or off, clearing any mark it excludes. */
export function markPatchFor(key: ToggleMarkKey, on: boolean): MarkPatch {
  const patch: MarkPatch = { [key]: on ? true : null };
  const other = EXCLUSIVE[key];
  if (on && other) patch[other] = null;
  return patch;
}

/** Turns a boolean mark on, or off if all selected text already has it. */
export function toggleMark(key: ToggleMarkKey): Command {
  return (doc, selection) => {
    const segments = segmentsOf(doc, selection);
    if (segments.length === 0) return null;
    const allHave = segments.every((s) => rangeHasMark(s.block.runs, s.from, s.to, key));
    return setMarks(markPatchFor(key, !allHave))(doc, selection);
  };
}

export type BlockSpec =
  | { type: "paragraph" }
  | { type: "title" }
  | { type: "subtitle" }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "quote" }
  | { type: "code_block"; language?: string }
  | { type: "list_item"; list: "bullet" | "ordered" };

function matchesSpec(block: TextBlock, spec: BlockSpec): boolean {
  if (block.type !== spec.type) return false;
  if (block.type === "heading" && spec.type === "heading") return block.level === spec.level;
  if (block.type === "list_item" && spec.type === "list_item") return block.list === spec.list;
  return true;
}

function convert(block: TextBlock, spec: BlockSpec): Block {
  const id = block.id;
  // Alignment and spacing carry over between every type that supports them.
  // A paragraph style stays with a paragraph that becomes a list item, and goes when a type is picked as the paragraph's style.
  const keep = isFormattable(block)
    ? { ...(block.align && { align: block.align }), ...(block.format && { format: block.format }), ...(spec.type === "list_item" && block.style && { style: block.style }) }
    : {};
  switch (spec.type) {
    case "paragraph":
      return { id, type: "paragraph", runs: block.runs, ...keep };
    case "title":
      return { id, type: "title", runs: block.runs, ...keep };
    case "subtitle":
      return { id, type: "subtitle", runs: block.runs, ...keep };
    case "heading":
      return { id, type: "heading", level: spec.level, runs: block.runs, ...keep };
    case "quote":
      return { id, type: "quote", runs: block.runs, ...keep };
    case "code_block": {
      const source = plainText(block.runs);
      return {
        id,
        type: "code_block",
        runs: source === "" ? [] : [{ text: source }],
        ...(spec.language && { language: spec.language }),
      };
    }
    case "list_item": {
      // The marker style and start number stay when the list stays the same kind, and go when it changes.
      const same = block.type === "list_item" && block.list === spec.list;
      return {
        id,
        type: "list_item",
        list: spec.list,
        depth: block.type === "list_item" ? block.depth : 0,
        ...(same && block.type === "list_item" && block.marker && { marker: block.marker }),
        ...(same && block.type === "list_item" && block.start !== undefined && { start: block.start }),
        runs: block.runs,
        ...keep,
      };
    }
  }
}

function selectedTextBlocks(doc: Doc, selection: Selection): TextBlock[] {
  return selectedBlocks(doc, selection).filter(isTextBlock);
}

/** Converts every selected block to the given type, keeping its text. */
export function setBlockType(spec: BlockSpec): Command {
  return (doc, selection) => {
    const ops: DocOp[] = selectedTextBlocks(doc, selection)
      .filter((b) => !matchesSpec(b, spec) || (spec.type !== "list_item" && isFormattable(b) && b.style))
      .map((b) => ({ type: "replace_block", id: b.id, block: convert(b, spec) }));
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/** Like `setBlockType`, but if every selected block already has that type, turns them back into paragraphs. */
export function toggleBlockType(spec: BlockSpec): Command {
  return (doc, selection) => {
    const blocks = selectedTextBlocks(doc, selection);
    if (blocks.length > 0 && blocks.every((b) => matchesSpec(b, spec))) {
      return setBlockType({ type: "paragraph" })(doc, selection);
    }
    return setBlockType(spec)(doc, selection);
  };
}

/** How far each press of Increase indent moves a paragraph, in points: half an inch. */
export const INDENT_STEP = 36;
const MAX_INDENT = 720;

/**
 * Moves selected list items one level deeper, never more than one level below the item above. Other
 * paragraphs and headings move half an inch in from the left margin.
 */
export function indent(): Command {
  return (doc, selection) => {
    const firstCovered = coveredBlocks(doc, selection)[0];
    if (!firstCovered) return null;
    const located = where(doc, firstCovered.block.id);
    const previous = located.list[located.index - 1];
    let above = previous?.type === "list_item" ? previous.depth : -1;

    const ops: DocOp[] = [];
    for (const block of selectedBlocks(doc, selection)) {
      if (block.type !== "list_item") {
        above = -1;
        const moved = shiftIndent(block, INDENT_STEP);
        if (moved) ops.push({ type: "replace_block", id: block.id, block: moved });
        continue;
      }
      const depth = Math.min(block.depth + 1, above + 1, MAX_LIST_DEPTH);
      if (depth > block.depth) ops.push({ type: "replace_block", id: block.id, block: { ...block, depth } });
      above = Math.max(depth, block.depth);
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/**
 * Moves selected list items one level out (items already at the top level become paragraphs). Other
 * paragraphs and headings move half an inch back toward the left margin.
 */
export function outdent(): Command {
  return (doc, selection) => {
    const ops: DocOp[] = [];
    for (const block of selectedBlocks(doc, selection)) {
      if (block.type !== "list_item") {
        const moved = shiftIndent(block, -INDENT_STEP);
        if (moved) ops.push({ type: "replace_block", id: block.id, block: moved });
        continue;
      }
      const next: Block =
        block.depth > 0
          ? { ...block, depth: block.depth - 1 }
          : { id: block.id, type: "paragraph", runs: block.runs, ...(block.align && { align: block.align }), ...(block.format && { format: block.format }) };
      ops.push({ type: "replace_block", id: block.id, block: next });
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/** The selected list items, each with the siblings around it. */
function selectedItems(doc: Doc, selection: Selection): { item: ListItemBlock; list: readonly Block[]; index: number }[] {
  const out: { item: ListItemBlock; list: readonly Block[]; index: number }[] = [];
  for (const block of selectedBlocks(doc, selection)) {
    if (block.type !== "list_item") continue;
    const located = where(doc, block.id);
    out.push({ item: block, list: located.list, index: located.index });
  }
  return out;
}

/**
 * Changes how the selected lists are marked: 1. a. A. i. I. for a numbered list, • ◦ ▪ for a bullet list. The whole
 * list at that level changes, not only the selected items. `null` goes back to the default for the depth.
 */
export function setListMarker(marker: ListMarker | null): Command {
  return (doc, selection) => {
    const ops: DocOp[] = [];
    const done = new Set<string>();
    for (const { item, list, index } of selectedItems(doc, selection)) {
      if (marker && !(item.list === "bullet" ? BULLET_MARKERS : NUMBER_MARKERS).includes(marker as never)) continue;
      for (const i of listRun(list, index)) {
        const target = list[i] as ListItemBlock;
        if (done.has(target.id)) continue;
        done.add(target.id);
        const wanted = marker && marker !== defaultMarker(target.list, target.depth) ? marker : undefined;
        if (target.marker === wanted) continue;
        const { marker: _old, ...rest } = target;
        ops.push({ type: "replace_block", id: target.id, block: (wanted ? { ...rest, marker: wanted } : rest) as Block });
      }
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/**
 * Makes the first selected numbered item take the number `start`, with the numbering carrying on from it. This is both
 * "restart at 1" and "start at 5". `null` takes it back into the count of the list above it, so the numbering continues.
 */
export function setListStart(start: number | null): Command {
  return (doc, selection) => {
    if (start !== null && (!Number.isInteger(start) || start < 0 || start > MAX_LIST_START)) return null;
    const items = selectedItems(doc, selection).filter(({ item }) => item.list === "ordered");
    const ops: DocOp[] = [];
    for (const { item, list, index } of start === null ? items : items.slice(0, 1)) {
      if (item.start === (start ?? undefined)) continue;
      // A first item that starts at 1 says nothing a list doesn't already.
      const first = listRun(list, index)[0] === index;
      const { start: _old, ...rest } = item;
      const explicit = start !== null && !(start === 1 && first);
      if (!explicit && item.start === undefined) continue;
      ops.push({ type: "replace_block", id: item.id, block: (explicit ? { ...rest, start } : rest) as Block });
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/** A paragraph moved in or out by `delta` points of left indent, or null if that changes nothing or it can't be indented. */
function shiftIndent(block: Block, delta: number): Block | null {
  if (!isFormattable(block) || block.type === "title" || block.type === "subtitle") return null;
  const current = block.format?.indentLeft ?? 0;
  const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
  if (next === current) return null;
  const { indentLeft: _old, ...rest } = block.format ?? {};
  const format = next === 0 ? rest : { ...rest, indentLeft: next };
  const { format: _format, ...without } = block;
  return (Object.keys(format).length > 0 ? { ...without, format } : without) as Block;
}

/** Aligns the selected paragraphs, headings, list items and images. */
export function setAlign(align: Align): Command {
  return (doc, selection) => {
    const ops: DocOp[] = [];
    for (const block of selectedBlocks(doc, selection)) {
      if (!isFormattable(block) && block.type !== "image") continue;
      if ((block.align ?? "left") === align) continue;
      const { align: _old, ...rest } = block;
      ops.push({
        type: "replace_block",
        id: block.id,
        block: (align === "left" ? rest : { ...rest, align }) as Block,
      });
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/** Changes line spacing, paragraph spacing or indents of the selected paragraphs. `null` removes a value. */
export function setParagraphFormat(patch: ParagraphFormatPatch): Command {
  return (doc, selection) => {
    const ops: DocOp[] = [];
    for (const block of selectedBlocks(doc, selection)) {
      if (!isFormattable(block)) continue;
      const next: Record<string, number> = { ...block.format };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete next[key];
        else next[key] = value;
      }
      const { format: _old, ...rest } = block;
      const changed = JSON.stringify(next) !== JSON.stringify(block.format ?? {});
      if (!changed) continue;
      ops.push({
        type: "replace_block",
        id: block.id,
        block: (Object.keys(next).length > 0 ? { ...rest, format: next } : rest) as Block,
      });
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

const CLEAR_MARKS: MarkPatch = {
  bold: null,
  italic: null,
  underline: null,
  strike: null,
  code: null,
  superscript: null,
  subscript: null,
  color: null,
  highlight: null,
  fontFamily: null,
  fontSize: null,
  style: null,
};

/** Removes character formatting (not links), styles, and paragraph alignment and spacing from the selection. */
export function clearFormatting(): Command {
  return (doc, selection) => {
    const ops: DocOp[] = [];
    for (const s of segmentsOf(doc, selection)) {
      ops.push({ type: "format_text", block: s.block.id, from: s.from, to: s.to, patch: CLEAR_MARKS });
    }
    for (const block of selectedBlocks(doc, selection)) {
      if (!isFormattable(block) || (!block.align && !block.format && !block.style)) continue;
      // Properties only: the text was just cleared above, and a whole-block replacement would put its old marks back.
      ops.push({ type: "update_block", id: block.id, patch: { align: null, format: null, style: null } });
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/**
 * Inserts a block (an image, page break, divider or table of contents) at the caret. At the
 * start of a block it goes before it; in the middle it splits the block; otherwise it goes
 * after. Typing can always continue below, because a paragraph is added if none follows.
 */
export function insertBlock(block: Block, options: { replaceEmpty?: boolean; trailingParagraph?: boolean } = {}): Command {
  return (doc, selection) => {
    const step = collapseSelection(doc, selection);
    const here = where(step.doc, step.at.block);
    const at = here.block;
    // Page-level things don't go in a table cell, and tables don't nest.
    if (here.cell && block.type !== "image" && block.type !== "divider") return null;
    const ops = [...step.ops];
    let working = step.doc;
    let after: string | null;
    let cell: string | undefined;
    // In an empty paragraph, a picture in a table cell (or whatever the caller says) takes its place, rather than leaving a blank line.
    const replacing = isTextBlock(at) && at.type === "paragraph" && textLength(at.runs) === 0 && (options.replaceEmpty ?? (!!here.cell && block.type === "image"));
    // Typing can continue below because a paragraph is added if none follows, except where nothing is meant to follow.
    const wantsTrailing = options.trailingParagraph ?? !(replacing && !!here.cell);

    if (!isTextBlock(at)) {
      after = at.id;
    } else {
      const length = textLength(at.runs);
      const offset = step.at.offset;
      if (offset === 0) {
        const previous = here.list[here.index - 1];
        after = previous ? previous.id : null;
        if (!previous && here.cell) cell = here.cell.cell.id;
      } else if (offset >= length) {
        after = at.id;
      } else {
        const split = splitBlock()(working, caret(at.id, offset))!;
        ops.push(...split.ops);
        working = applyAll(working, split.ops);
        after = at.id;
      }
    }

    const insert: DocOp = { type: "insert_block", block, after, ...(cell !== undefined && { cell }) };
    ops.push(insert);
    working = applyAll(working, [insert]);
    if (replacing) {
      const remove: DocOp = { type: "delete_block", id: at.id };
      ops.push(remove);
      working = applyAll(working, [remove]);
    }

    const placed = where(working, block.id);
    const next = placed.list[placed.index + 1];
    if (next && isTextBlock(next)) return { ops, selection: caret(next.id, 0) };
    // The caret stays on the block itself when nothing is meant to follow it.
    if (!wantsTrailing) return { ops, selection: caret(block.id, 0) };
    const fresh = emptyParagraph();
    ops.push({ type: "insert_block", block: fresh, after: block.id });
    return { ops, selection: caret(fresh.id, 0) };
  };
}

export function insertTable(rows: number, columns: number, options?: Parameters<typeof createTable>[2]): Command {
  return (doc, selection) => {
    const table = createTable(rows, columns, options);
    const result = insertBlock(table)(doc, selection);
    if (!result) return null;
    const start = startPointOf(table);
    return start ? { ops: result.ops, selection: caret(start.block, 0) } : result;
  };
}

/**
 * Inserts a borderless table of two or three columns at the caret, for laying out a header or footer:
 * a logo on the left and a page number on the right, say. Two columns align left and right; three align
 * left, centre and right. The caret goes in the first cell.
 */
export function insertColumns(count: 2 | 3): Command {
  return (doc, selection) => {
    const table = createTable(1, count, { borders: "none" });
    const aligns: Align[] = count === 2 ? ["left", "right"] : ["left", "center", "right"];
    table.rows[0]!.cells.forEach((cell, i) => {
      const block = cell.blocks[0]!;
      if (block.type === "paragraph" && aligns[i] !== "left") block.align = aligns[i];
    });
    // A header or footer is just its layout: the table replaces an empty paragraph, and no blank line is added under it.
    const result = insertBlock(table, { replaceEmpty: true, trailingParagraph: false })(doc, selection);
    if (!result) return null;
    const start = startPointOf(table);
    return start ? { ops: result.ops, selection: caret(start.block, 0) } : result;
  };
}

/**
 * Inserts a footnote reference at the caret, replacing any selection, and creates its note: empty unless
 * `blocks` are given. One step. The caret goes just after the reference. Not available in code blocks.
 */
export function insertFootnote(id: string, blocks?: Block[]): Command {
  return (doc, selection) => {
    const step = collapseSelection(doc, selection);
    const block = blockAt(step.doc, step.at.block);
    if (!isTextBlock(block) || block.type === "code_block") return null;
    const note = blocks && blocks.length > 0 ? blocks : [emptyParagraph()];
    const run: Run = { text: FOOTNOTE_CHAR, marks: { footnote: id } };
    return {
      ops: [
        ...step.ops,
        { type: "insert_text", block: block.id, offset: step.at.offset, runs: [run] },
        { type: "set_footnote", id, blocks: note },
      ],
      selection: caret(block.id, step.at.offset + 1),
    };
  };
}

/**
 * Starts a new section at the caret: on the next page, or (`continuous`) right after the text above. The new
 * section keeps the columns of the one it was split from. Not available in a table cell.
 */
export function insertSectionBreak(kind: "next_page" | "continuous"): Command {
  return (doc, selection) => {
    const columns = columnsValue(columnsAt(doc, where(doc, selection.focus.block).topIndex));
    return insertBlock(sectionBreak(kind, columns))(doc, selection);
  };
}

/**
 * Sets the columns of the text. With a caret, that is the section the caret is in (the whole document if it has no
 * section breaks). With a selection, it is just the selected blocks: continuous section breaks are added around
 * them where needed, so the text above and below keeps its columns. `null` goes back to one column.
 */
export function setColumns(columns: Columns | null): Command {
  return (doc, selection) => {
    const value = columns && columns.count > 1 ? columnsValue(columnSetup(columns)) : undefined;
    const same = (a: Columns | undefined, b: Columns | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const withColumns = (b: SectionBreakBlock): SectionBreakBlock => {
      const { columns: _old, ...rest } = b;
      return value ? { ...rest, columns: value } : rest;
    };
    const setFirstSection = (): DocOp | null => {
      const page = pageSetupOf(doc);
      if (same(page.columns, value)) return null;
      const { columns: _old, ...rest } = page;
      return { type: "set_page", page: value ? { ...rest, columns: value } : rest };
    };

    const tops = coveredBlocks(doc, selection).map((c) => where(doc, c.block.id).topIndex);
    let i = Math.min(...tops);
    let j = Math.max(...tops);
    // Section breaks at the ends of a selection aren't text to put in columns.
    while (i < j && doc.blocks[i]!.type === "section_break") i++;
    while (j > i && doc.blocks[j]!.type === "section_break") j--;

    if (isCollapsed(selection) || (i === j && doc.blocks[i]!.type === "section_break")) {
      const section = sectionAt(doc, i);
      if (section.start) {
        if (same(section.start.columns, value)) return null;
        return { ops: [{ type: "replace_block", id: section.start.id, block: withColumns(section.start) }], selection };
      }
      const op = setFirstSection();
      return op ? { ops: [op], selection } : null;
    }

    const ops: DocOp[] = [];
    // After the selection the text keeps the columns it had.
    const restore = columnsValue(columnsAt(doc, j));
    const last = doc.blocks[j]!;
    const next = doc.blocks[j + 1];
    if (next && next.type !== "section_break" && !same(restore, value)) {
      ops.push({ type: "insert_block", block: sectionBreak("continuous", restore), after: last.id });
    }
    // Breaks inside the selection take the new columns too.
    for (let k = i + 1; k <= j; k++) {
      const b = doc.blocks[k]!;
      if (b.type === "section_break" && !same(b.columns, value)) ops.push({ type: "replace_block", id: b.id, block: withColumns(b) });
    }
    // Before it, the section starts at the selection.
    const first = doc.blocks[i]!;
    const before = doc.blocks[i - 1];
    if (first.type === "section_break") {
      if (!same(first.columns, value)) ops.push({ type: "replace_block", id: first.id, block: withColumns(first) });
    } else if (before?.type === "section_break") {
      if (!same(before.columns, value)) ops.push({ type: "replace_block", id: before.id, block: withColumns(before) });
    } else if (i === 0) {
      const op = setFirstSection();
      if (op) ops.push(op);
    } else if (!same(columnsValue(columnsAt(doc, i)), value)) {
      ops.push({ type: "insert_block", block: sectionBreak("continuous", value), after: before!.id });
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/** Inserts a field, such as the current page number, at the caret. Mainly for headers and footers. */
export function insertField(field: "page" | "pages"): Command {
  return (doc, selection) => {
    const step = collapseSelection(doc, selection);
    const block = blockAt(step.doc, step.at.block);
    if (!isTextBlock(block)) return null;
    const { link: _link, ...inherited } = marksAtCaret(block, step.at.offset) ?? {};
    const run: Run = { text: "1", marks: { ...inherited, field } };
    return {
      ops: [...step.ops, { type: "insert_text", block: block.id, offset: step.at.offset, runs: [run] }],
      selection: caret(block.id, step.at.offset + 1),
    };
  };
}

/**
 * Links the selected text to `url`, or removes the link with `null`. With only a caret, inserts
 * `text` (default: the URL) as a link.
 */
export function setLink(url: string | null, text?: string): Command {
  return (doc, selection) => {
    if (!isCollapsed(selection)) return setMarks({ link: url })(doc, selection);
    if (!url) return null;
    return insertText(text || url, { link: url })(doc, selection);
  };
}

/**
 * Pastes plain text at the caret as one undoable step. Line breaks start new blocks, so a
 * pasted paragraph of lines becomes several paragraphs (or several list items inside a list).
 */
export function insertPlainText(text: string): Command {
  return (doc, selection) => {
    if (text === "") return deleteSelection()(doc, selection);
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const first = collapseSelection(doc, selection);
    const ops = [...first.ops];
    let current = first.doc;
    let at = first.at;

    const run = (command: Command): void => {
      const result = command(current, caret(at.block, at.offset));
      if (!result) return;
      ops.push(...result.ops);
      current = applyAll(current, result.ops);
      at = result.selection.focus;
    };

    lines.forEach((line, i) => {
      if (i > 0) run(splitBlock());
      if (line !== "") run(insertText(line));
    });
    return { ops, selection: caret(at.block, at.offset) };
  };
}

/**
 * Makes a block's text equal `text` with the smallest edit, keeping formatting on the text
 * that didn't change. Used to reconcile after the browser edited the DOM directly (for
 * example during IME composition). The selection ends at `caretOffset`.
 */
export function syncBlockText(blockId: string, text: string, caretOffset: number): Command {
  return (doc) => {
    const block = locate(doc, blockId)?.block;
    if (!block || !isTextBlock(block)) return null;
    const old = plainText(block.runs);
    if (old === text) return null;

    const limit = Math.min(old.length, text.length);
    let prefix = 0;
    while (prefix < limit && old[prefix] === text[prefix]) prefix++;
    let suffix = 0;
    while (suffix < limit - prefix && old[old.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;

    // Never split a surrogate pair between the unchanged and changed parts.
    if (prefix > 0 && isHighSurrogate(old.charCodeAt(prefix - 1))) prefix--;
    if (suffix > 0 && isLowSurrogate(old.charCodeAt(old.length - suffix))) suffix--;

    const removedEnd = old.length - suffix;
    const added = text.slice(prefix, text.length - suffix);
    const ops: DocOp[] = [];
    if (removedEnd > prefix) ops.push({ type: "delete_text", block: blockId, from: prefix, to: removedEnd });
    if (added !== "") {
      // Replacing text keeps the replaced text's formatting; plain insertion follows the caret rules.
      const marks = removedEnd > prefix ? marksAt(block.runs, prefix) : marksAtCaret(block, prefix);
      const run: Run = marks ? { text: added, marks } : { text: added };
      ops.push({ type: "insert_text", block: blockId, offset: prefix, runs: [run] });
    }
    return { ops, selection: caret(blockId, Math.min(Math.max(caretOffset, 0), text.length)) };
  };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// ---- Named styles ------------------------------------------------------------------------------------------

/**
 * Sets the paragraph style of the selected paragraphs, or takes it off with `null`. The paragraphs' own alignment and
 * spacing are cleared so the style's shows; the formatting of the text itself stays.
 */
export function setParagraphStyle(id: string | null): Command {
  return (doc, selection) => {
    if (id !== null && doc.styles?.[id]?.kind !== "paragraph") return null;
    const ops: DocOp[] = [];
    for (const block of selectedBlocks(doc, selection)) {
      if (!isFormattable(block)) continue;
      const unchanged = (block.style ?? null) === id && (id === null || (!block.align && !block.format));
      if (unchanged) continue;
      const patch: Record<string, unknown> = { style: id };
      if (id !== null) Object.assign(patch, { align: null, format: null });
      ops.push({ type: "update_block", id: block.id, patch });
    }
    return ops.length > 0 ? { ops, selection } : null;
  };
}

/** Sets the character style of the selected text, or takes it off with `null`. */
export function setCharacterStyle(id: string | null): Command {
  return (doc, selection) => {
    if (id !== null && doc.styles?.[id]?.kind !== "character") return null;
    return setMarks({ style: id })(doc, selection);
  };
}

/**
 * The marks, for the keys a style can set, that are the same on all of the text of `runs` from `from` to `to`.
 * `false` is kept: it means the text turns off what a style would give it.
 */
function uniformStyleMarks(runs: readonly Run[], from: number, to: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pieces = sliceRuns(runs, from, to).filter((r) => r.text !== "");
  if (pieces.length === 0) return out;
  for (const key of STYLE_MARK_KEYS) {
    const first = pieces[0]!.marks?.[key];
    if (first === undefined) continue;
    if (pieces.every((p) => p.marks?.[key] === first)) out[key] = first;
  }
  return out;
}

/** What a style gets from `own` over `inherited`: marks turned off are dropped rather than kept as `false`. */
function mergedStyleMarks(inherited: StyleMarks | undefined, own: Record<string, unknown>): StyleMarks | undefined {
  const merged: Record<string, unknown> = { ...inherited, ...own };
  for (const key of Object.keys(merged)) if (merged[key] === false) delete merged[key];
  return Object.keys(merged).length > 0 ? (merged as StyleMarks) : undefined;
}

export interface StyleSpec {
  /** The id the style gets, or the id of the style to redefine. */
  id: string;
  name: string;
  kind: "paragraph" | "character";
  basedOn?: string;
}

/**
 * Makes a style from what the selection looks like, and applies it. For a paragraph style that is the alignment and
 * spacing of the first paragraph and the marks all its text has in common (on top of its current style, if it has
 * one); for a character style, the marks all the selected text has in common. Those are taken off the text itself,
 * so the style is what holds them and changing it changes every use. With the id of a style that exists, it is
 * redefined and everything using it follows.
 */
export function defineStyle(spec: StyleSpec): Command {
  return (doc, selection) => {
    const ops: DocOp[] = [];
    if (spec.kind === "paragraph") {
      const blocks = selectedBlocks(doc, selection).filter(isFormattable);
      const first = blocks[0];
      if (!first) return null;
      const own = uniformStyleMarks(first.runs, 0, textLength(first.runs));
      const look = resolveStyle(doc, first.style);
      const shown = withParagraphStyle(doc, first);
      const marks = mergedStyleMarks(look?.marks, own);
      const style: DocStyle = {
        name: spec.name,
        kind: "paragraph",
        ...(spec.basedOn && { basedOn: spec.basedOn }),
        ...(marks && { marks }),
        ...(shown.align && { align: shown.align }),
        ...(shown.format && { format: shown.format }),
      };
      ops.push({ type: "set_style", id: spec.id, style });
      for (const block of blocks) {
        ops.push({ type: "update_block", id: block.id, patch: { style: spec.id, align: null, format: null } });
        const length = textLength(block.runs);
        const keys = Object.keys(uniformStyleMarks(block.runs, 0, length)).filter((k) => k in own);
        if (keys.length > 0 && length > 0) {
          ops.push({ type: "format_text", block: block.id, from: 0, to: length, patch: Object.fromEntries(keys.map((k) => [k, null])) as MarkPatch });
        }
      }
    } else {
      const segments = segmentsOf(doc, selection);
      if (segments.length === 0) return null;
      const each = segments.map((s) => uniformStyleMarks(s.block.runs, s.from, s.to));
      const common = Object.fromEntries(Object.entries(each[0]!).filter(([k, v]) => each.every((m) => m[k] === v)));
      const existing = new Set(segments.flatMap((s) => sliceRuns(s.block.runs, s.from, s.to).map((r) => r.marks?.style)));
      const inherited = existing.size === 1 ? resolveStyle(doc, [...existing][0])?.marks : undefined;
      const marks = mergedStyleMarks(inherited, common);
      const style: DocStyle = { name: spec.name, kind: "character", ...(spec.basedOn && { basedOn: spec.basedOn }), ...(marks && { marks }) };
      ops.push({ type: "set_style", id: spec.id, style });
      const strip = Object.fromEntries(Object.keys(common).map((k) => [k, null]));
      for (const s of segments) ops.push({ type: "format_text", block: s.block.id, from: s.from, to: s.to, patch: { ...strip, style: spec.id } as MarkPatch });
    }
    return { ops, selection };
  };
}

/**
 * Removes a style and everything that refers to it: paragraphs and text that used it go back to plain, and styles
 * based on it are based on whatever it was based on.
 */
export function deleteStyle(id: string): Command {
  return (doc, selection) => {
    const style = doc.styles?.[id];
    if (!style) return null;
    const ops: DocOp[] = [];
    for (const [other, def] of Object.entries(doc.styles ?? {})) {
      if (def.basedOn !== id) continue;
      const { basedOn: _gone, ...rest } = def;
      ops.push({ type: "set_style", id: other, style: style.basedOn ? { ...rest, basedOn: style.basedOn } : rest });
    }
    const visit = (blocks: readonly Block[]) => {
      for (const block of blocks) {
        if (block.type === "table") block.rows.forEach((row) => row.cells.forEach((cell) => visit(cell.blocks)));
        if (!("runs" in block)) continue;
        if (isFormattable(block) && block.style === id) ops.push({ type: "update_block", id: block.id, patch: { style: null } });
        let at = 0;
        for (const run of block.runs) {
          const length = run.text.length;
          if (run.marks?.style === id && length > 0) ops.push({ type: "format_text", block: block.id, from: at, to: at + length, patch: { style: null } });
          at += length;
        }
      }
    };
    visit(doc.blocks);
    ops.push({ type: "set_style", id, style: null });
    return { ops, selection };
  };
}
