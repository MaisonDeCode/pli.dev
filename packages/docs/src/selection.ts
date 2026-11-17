import { PliError } from "@pli.dev/core";
import type { DocOp } from "./ops";
import { isTextBlock, type Block, type Doc, type TableBlock } from "./model";
import { textLength } from "./runs";
import { expandRect, originsIn, rectOfCell } from "./grid";
import { flattenBlocks, locate, locateCell } from "./tree";

/** A position in the document: a block and a UTF-16 offset into its text. */
export interface Point {
  block: string;
  offset: number;
}

/** `anchor` is where the selection started, `focus` is the end the user is moving. */
export interface Selection {
  anchor: Point;
  focus: Point;
}

export function caret(block: string, offset: number): Selection {
  return { anchor: { block, offset }, focus: { block, offset } };
}

export function isCollapsed(selection: Selection): boolean {
  return selection.anchor.block === selection.focus.block && selection.anchor.offset === selection.focus.offset;
}

/** Length of a block's text; blocks without text (dividers, images, tables) have length 0. */
export function blockLength(block: Block): number {
  return isTextBlock(block) ? textLength(block.runs) : 0;
}

const flatCache = new WeakMap<readonly Block[], { list: Block[]; index: Map<string, number> }>();

/** The document in reading order, with each table's cell blocks following the table. Cached per document state. */
export function flatOrder(doc: Pick<Doc, "blocks">): { list: Block[]; index: Map<string, number> } {
  let cached = flatCache.get(doc.blocks);
  if (!cached) {
    const list = flattenBlocks(doc.blocks);
    cached = { list, index: new Map(list.map((b, i) => [b.id, i])) };
    flatCache.set(doc.blocks, cached);
  }
  return cached;
}

/** The position of a block in reading order. */
export function flatIndexOf(doc: Pick<Doc, "blocks">, id: string): number {
  const index = flatOrder(doc).index.get(id);
  if (index === undefined) throw new PliError("not_found", `No block with id "${id}"`);
  return index;
}

/** The index in `doc.blocks` of a block, or of the table that holds it. */
export function topIndexOf(doc: Pick<Doc, "blocks">, id: string): number {
  const found = locate(doc, id);
  if (!found) throw new PliError("not_found", `No block with id "${id}"`);
  return found.topIndex;
}

export function comparePoints(doc: Doc, a: Point, b: Point): number {
  if (a.block === b.block) return a.offset - b.offset;
  return flatIndexOf(doc, a.block) - flatIndexOf(doc, b.block);
}

/** The selection's two ends in document order, whichever way it was dragged. */
export function selectionRange(doc: Doc, selection: Selection): { start: Point; end: Point } {
  return comparePoints(doc, selection.anchor, selection.focus) <= 0
    ? { start: selection.anchor, end: selection.focus }
    : { start: selection.focus, end: selection.anchor };
}

/** A rectangle of table cells, inclusive. */
export interface CellRect {
  table: TableBlock;
  topIndex: number;
  row1: number;
  row2: number;
  col1: number;
  col2: number;
}

/**
 * When the selection starts in one cell and ends in a different cell of the same table, it
 * covers a rectangle of cells (like dragging across a table in a word processor), not the
 * text between the two points. The rectangle grows to take in any merged cell it touches, whole.
 */
export function cellRect(doc: Doc, selection: Selection): CellRect | null {
  const a = locate(doc, selection.anchor.block);
  const f = locate(doc, selection.focus.block);
  if (!a?.cell || !f?.cell || a.cell.table.id !== f.cell.table.id) return null;
  if (a.cell.cell.id === f.cell.cell.id) return null;
  const from = rectOfCell(a.cell.cell, a.cell.row, a.cell.col);
  const to = rectOfCell(f.cell.cell, f.cell.row, f.cell.col);
  const rect = expandRect(a.cell.table, {
    row1: Math.min(from.row1, to.row1),
    row2: Math.max(from.row2, to.row2),
    col1: Math.min(from.col1, to.col1),
    col2: Math.max(from.col2, to.col2),
  });
  return { table: a.cell.table, topIndex: a.topIndex, ...rect };
}

/** The cells of a rectangle, row by row. Squares covered by a merged cell belong to it and aren't listed again. */
export function cellsInRect(rect: CellRect) {
  return originsIn(rect.table, rect);
}

/** A block and the part of its text the selection covers. */
export interface Covered {
  block: Block;
  from: number;
  to: number;
}

/**
 * The blocks a selection covers, in reading order, with the covered range of each. For a rectangle
 * of table cells, that is all the content of those cells. A selection that ends at the very start
 * of a block (as a triple-click or Shift+Down does) leaves that block out: nothing in it is selected.
 * Pass `raw` to keep it, for deleting.
 */
export function coveredBlocks(doc: Doc, selection: Selection, options: { raw?: boolean } = {}): Covered[] {
  const rect = options.raw ? null : cellRect(doc, selection);
  if (rect) {
    return cellsInRect(rect).flatMap(({ cell }) =>
      cell.blocks.map((block) => ({ block: block as Block, from: 0, to: blockLength(block) })),
    );
  }
  const { start, end } = selectionRange(doc, selection);
  const { list } = flatOrder(doc);
  const first = flatIndexOf(doc, start.block);
  let last = flatIndexOf(doc, end.block);
  // `raw` keeps the final block even when the selection stops at its start, so deleting can join it.
  if (!options.raw && last > first && end.offset === 0) last--;
  const out: Covered[] = [];
  for (let i = first; i <= last; i++) {
    const block = list[i]!;
    const length = blockLength(block);
    out.push({
      block,
      from: i === first && block.id === start.block ? start.offset : 0,
      to: i === last && block.id === end.block ? end.offset : length,
    });
  }
  return out;
}

/** The blocks the selection covers, in reading order. See `coveredBlocks`. */
export function selectedBlocks(doc: Doc, selection: Selection): Block[] {
  return coveredBlocks(doc, selection).map((c) => c.block);
}

export function selectAll(doc: Doc): Selection | null {
  const content = flatOrder(doc).list.filter((b) => b.type !== "table");
  const first = content[0];
  const last = content[content.length - 1];
  if (!first || !last) return null;
  return { anchor: { block: first.id, offset: 0 }, focus: { block: last.id, offset: blockLength(last) } };
}

function clampPoint(doc: Doc, point: Point): Point | null {
  const found = locate(doc, point.block);
  if (!found) return null;
  const offset = Math.min(Math.max(Math.trunc(point.offset) || 0, 0), blockLength(found.block));
  return { block: found.block.id, offset };
}

/**
 * Makes a selection valid for `doc`: offsets are clamped into range, and if a block
 * it pointed at is gone, it falls back to the start of the document.
 */
export function clampSelection(doc: Doc, selection: Selection | null): Selection | null {
  const first = flatOrder(doc).list.find((b) => b.type !== "table");
  if (!first) return null;
  const anchor = selection && clampPoint(doc, selection.anchor);
  const focus = selection && clampPoint(doc, selection.focus);
  if (anchor && focus) return { anchor, focus };
  return caret(first.id, 0);
}

/**
 * Where a selection is after other people's operations, so that a caret stays with its text when someone types
 * above it. A point is moved by inserts and deletes before it in its block, and a point inside deleted text goes
 * to the start of the gap. Text typed exactly at a point lands after it, so a caret stays in front of it.
 *
 * With the document as it is now, a caret in a block that was deleted goes to the end of the block before it
 * (where the block was), and one in an empty stand-in cell paragraph that was replaced goes to the cell's first
 * block, rather than both jumping to the start of the document.
 */
export function mapSelection(selection: Selection, ops: readonly DocOp[], doc?: Doc): Selection {
  const through = (point: Point): Point => {
    let current = point;
    for (const op of ops) {
      if (op.type === "insert_text" && op.block === current.block && op.offset < current.offset) {
        current = { block: current.block, offset: current.offset + op.runs.reduce((n, r) => n + r.text.length, 0) };
      } else if (op.type === "delete_text" && op.block === current.block) {
        const offset = current.offset <= op.from ? current.offset : current.offset >= op.to ? current.offset - (op.to - op.from) : op.from;
        if (offset !== current.offset) current = { block: current.block, offset };
      } else if (op.type === "delete_block" && doc && (op.id === current.block || op.within?.includes(current.block))) {
        current = whereItWas(doc, op) ?? current;
      }
    }
    if (doc && !locate(doc, current.block) && current.block.endsWith("~empty")) {
      const cell = locateCell(doc, current.block.slice(0, -"~empty".length));
      const first = cell?.cell.blocks[0];
      if (first) current = { block: first.id, offset: 0 };
    }
    return current;
  };
  const anchor = through(selection.anchor);
  const focus = through(selection.focus);
  return anchor === selection.anchor && focus === selection.focus ? selection : { anchor, focus };
}

/** Where a removed block was: the end of the block it followed, or the start of the list (or cell) it was first in. */
function whereItWas(doc: Doc, op: Extract<DocOp, { type: "delete_block" }>): Point | null {
  if (typeof op.after === "string") {
    const before = locate(doc, op.after)?.block;
    if (before) {
      if (before.type !== "table") return { block: before.id, offset: blockLength(before) };
      const last = before.rows.at(-1)?.cells.at(-1)?.blocks.at(-1);
      if (last) return { block: last.id, offset: blockLength(last) };
    }
  }
  const first = op.cell !== undefined ? locateCell(doc, op.cell)?.cell.blocks[0] : flatOrder(doc).list.find((b) => b.type !== "table");
  return first ? { block: first.id, offset: 0 } : null;
}
