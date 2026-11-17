import { createId } from "@pli.dev/core";
import { emptyParagraph, where, type Command, type CommandResult } from "./command-utils";
import { collapseSelection } from "./commands";
import { cellAt, checkGrid, insertColumnAt, insertRowAt, normalizeColumns } from "./grid";
import { htmlToFragment, type ImportOptions } from "./html/import";
import { rtfToBlocks } from "./rtf/import";
import { isTextBlock, type Block, type CellBlock, type Doc, type DocStyle, type Run, type TableBlock, type TableCell, type TextBlock } from "./model";
import type { DocOp } from "./ops";
import { normalizeRuns, plainText, sliceRuns, textLength } from "./runs";
import { caret, cellRect, type Point, type Selection } from "./selection";
import { parseDoc, serializeDoc } from "./serialize";
import { collectIds, locate, type Located } from "./tree";
import { stripComments } from "./comments";
import { stylesUsed } from "./styles";
import { stripSuggestions } from "./suggestions";
import { copyFootnotes, footnoteIds, type Footnotes } from "./footnotes";

/** The MIME type Pli puts on the clipboard so copying between Pli documents loses nothing. */
export const FRAGMENT_MIME = "application/x-pli-fragment";

const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLUMNS = 40;
const MAX_FRAGMENT_JSON = 32_000_000;
const MAX_TSV = 4_000_000;

// ---- fragments ----

function freshCell(cell: TableCell): TableCell {
  return { ...cell, id: createId("c_"), blocks: cell.blocks.map((b) => ({ ...b, id: createId("b_") }) as CellBlock) };
}

function freshBlock(block: Block): Block {
  if (block.type !== "table") return { ...block, id: createId("b_") };
  return {
    ...block,
    id: createId("b_"),
    rows: block.rows.map((row) => ({ ...row, id: createId("r_"), cells: row.cells.map(freshCell) })),
  };
}

/** Copies blocks with new ids throughout (rows and cells included), so they can be inserted next to the originals. */
export function cloneBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map(freshBlock);
}

/** The blocks to insert, with new ids if any of theirs are already in the document. */
function usable(doc: Doc, blocks: readonly Block[]): Block[] {
  const existing = collectIds(doc.blocks);
  const clash = [...collectIds(blocks)].some((id) => existing.has(id));
  return clash ? cloneBlocks(blocks) : blocks.slice();
}

/** Serializes blocks for `FRAGMENT_MIME`. */
export function fragmentToJson(blocks: readonly Block[], footnotes?: Footnotes, styles?: Record<string, DocStyle>): string {
  return serializeDoc({ id: "fragment", type: "document", title: "", blocks: blocks.slice(), ...(footnotes && { footnotes }), ...(styles && Object.keys(styles).length > 0 && { styles }) } as Doc);
}

/** Reads what `fragmentToJson` wrote. Returns null for anything that isn't a well-formed fragment. */
export function parseFragmentJson(json: string): Block[] | null {
  return parseFragment(json)?.blocks ?? null;
}

/** Like `parseFragmentJson`, and also returns the footnotes the blocks refer to. */
export function parseFragment(json: string): { blocks: Block[]; footnotes?: Footnotes; styles?: Record<string, DocStyle> } | null {
  if (json.length === 0 || json.length > MAX_FRAGMENT_JSON) return null;
  try {
    const { blocks, footnotes, styles } = parseDoc(json);
    return blocks.length > 0 ? { blocks, ...(footnotes && { footnotes }), ...(styles && { styles }) } : null;
  } catch {
    return null;
  }
}

// ---- spreadsheet text ----

/**
 * Reads tab-separated text, the way spreadsheets copy a range, as a table. Fields in double quotes
 * can hold tabs, line breaks and doubled quotes. It must be at least two rows and two columns, and
 * every row the same width, or it is just text that happens to hold a tab: null.
 */
export function parseTabSeparated(text: string): TableBlock | null {
  if (!text.includes("\t") || text.length > MAX_TSV) return null;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
    if (rows.length > MAX_TABLE_ROWS) return null;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const columns = rows[0]?.length ?? 0;
  if (rows.length < 2 || rows.length > MAX_TABLE_ROWS || columns < 2 || columns > MAX_TABLE_COLUMNS) return null;
  if (rows.some((r) => r.length !== columns)) return null;

  const cell = (value: string): TableCell => ({
    id: createId("c_"),
    blocks: value.replace(/\r\n?/g, "\n").split("\n").map((line): TextBlock => ({ id: createId("b_"), type: "paragraph", runs: line === "" ? [] : [{ text: line }] })),
  });
  return {
    id: createId("b_"),
    type: "table",
    rows: rows.map((r) => ({ id: createId("r_"), cells: r.map(cell) })),
    columns: normalizeColumns(Array.from({ length: columns }, () => 1)),
  };
}

// ---- reading the clipboard ----

/** What a paste can be made from. Pass what the clipboard offered; the richest usable one wins. */
export interface PasteInput {
  /** `FRAGMENT_MIME` content, or already-parsed blocks (with the footnotes they refer to, if any). */
  fragment?: string | readonly Block[];
  footnotes?: Footnotes;
  /** The styles the fragment's blocks use, by id. */
  styles?: Record<string, DocStyle>;
  html?: string;
  /** RTF, for applications that offer no HTML (Pages, TextEdit). Used only when there is no usable HTML. */
  rtf?: string;
  text?: string;
  /** Paste as plain text whatever else is offered (Ctrl+Shift+V). */
  plain?: boolean;
}

export type PasteContent =
  | { source: "fragment" | "html" | "table"; blocks: Block[]; unsizedImages: string[]; footnotes?: Footnotes; styles?: Record<string, DocStyle> }
  | { source: "text"; text: string };

/**
 * Chooses what to paste: a Pli fragment, else HTML (a web page, Word, Google Docs, Excel), else RTF (Pages, TextEdit), else
 * tab-separated text as a table, else the text itself. Null if there is nothing to paste.
 */
export function readPaste(input: PasteInput, options?: ImportOptions): PasteContent | null {
  const html = input.html && input.html.trim() !== "" ? htmlToFragment(input.html, options) : null;
  if (input.plain) {
    const text = input.text ?? (html ? html.blocks.map((b) => (isTextBlock(b) ? plainText(b.runs) : "")).join("\n") : "");
    return text === "" ? null : { source: "text", text };
  }
  if (input.fragment) {
    const parsed =
      typeof input.fragment === "string"
        ? parseFragment(input.fragment)
        : input.fragment.length > 0
          ? { blocks: input.fragment.slice(), footnotes: input.footnotes, styles: input.styles }
          : null;
    if (parsed) return { source: "fragment", blocks: parsed.blocks, unsizedImages: [], ...(parsed.footnotes && { footnotes: parsed.footnotes }), ...(parsed.styles && { styles: parsed.styles }) };
  }
  if (html && html.blocks.length > 0) return { source: "html", blocks: html.blocks, unsizedImages: html.unsizedImages };
  if (input.rtf) {
    const blocks = rtfToBlocks(input.rtf);
    if (blocks.some((b) => isTextBlock(b) && plainText(b.runs) !== "")) return { source: "html", blocks, unsizedImages: [] };
  }
  if (input.text) {
    const table = parseTabSeparated(input.text);
    if (table) return { source: "table", blocks: [table], unsizedImages: [] };
    return { source: "text", text: input.text };
  }
  return null;
}

// ---- inserting ----

/** A table as lines of text, for places a table can't go: one paragraph per row, cells separated by tabs. */
function flattenTable(table: TableBlock): TextBlock[] {
  return table.rows.map((row): TextBlock => {
    const runs: Run[] = [];
    row.cells
      .filter((cell) => !cell.covered)
      .forEach((cell, i) => {
        if (i > 0) runs.push({ text: "\t" });
        cell.blocks.forEach((b, j) => {
          if (j > 0) runs.push({ text: " " });
          if (isTextBlock(b)) runs.push(...b.runs);
        });
      });
    return { id: createId("b_"), type: "paragraph", runs: normalizeRuns(runs) };
  });
}

/** What a table cell can hold: text, images and dividers. Tables become lines of text. */
function forCell(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((b): Block[] => (b.type === "table" ? flattenTable(b) : b.type === "toc" || b.type === "page_break" || b.type === "section_break" ? [] : [b]));
}

function placeBefore(located: Located): { after: string | null; cell?: string } {
  const previous = located.list[located.index - 1];
  if (previous) return { after: previous.id };
  return located.cell ? { after: null, cell: located.cell.cell.id } : { after: null };
}

function insertAfterBlock(ops: DocOp[], here: Located, items: Block[]): CommandResult {
  let after = here.block.id;
  for (const block of items) {
    ops.push({ type: "insert_block", block, after });
    after = block.id;
  }
  const last = items[items.length - 1]!;
  if (isTextBlock(last)) return { ops, selection: caret(last.id, textLength(last.runs)) };
  const next = here.list[here.index + 1];
  if (next && isTextBlock(next)) return { ops, selection: caret(next.id, 0) };
  const fresh = emptyParagraph();
  ops.push({ type: "insert_block", block: fresh, after });
  return { ops, selection: caret(fresh.id, 0) };
}

/**
 * Puts blocks at the caret, replacing any selection.
 *
 * - One text block goes into the text at the caret and takes on its surroundings, the way pasted
 *   text does. (Into an empty paragraph, a heading, list item, quote or code block keeps its kind.)
 * - Several blocks split the paragraph at the caret: the first joins the text before it, the last
 *   joins the text after it, and the rest go between. At the very start, nothing joins before.
 * - Tables can't go in a table cell, so there they become lines of text.
 */
function splice(doc: Doc, selection: Selection, input: readonly Block[]): CommandResult | null {
  const step = collapseSelection(doc, selection);
  const ops: DocOp[] = [...step.ops];
  const here = where(step.doc, step.at.block);
  let items = usable(doc, input);
  if (here.cell) items = forCell(items);
  if (items.length === 0) return ops.length > 0 ? { ops, selection: caret(step.at.block, step.at.offset) } : null;

  const target = here.block;
  if (!isTextBlock(target)) return insertAfterBlock(ops, here, items);

  const length = textLength(target.runs);
  const offset = Math.min(step.at.offset, length);
  const first = items[0]!;

  if (items.length === 1 && isTextBlock(first)) {
    if (length === 0 && target.type === "paragraph" && first.type !== "paragraph" && first.runs.length > 0) {
      ops.push({ type: "replace_block", id: target.id, block: { ...first, id: target.id } });
      return { ops, selection: caret(target.id, textLength(first.runs)) };
    }
    if (first.runs.length === 0) return ops.length > 0 ? { ops, selection: caret(target.id, offset) } : null;
    ops.push({ type: "insert_text", block: target.id, offset, runs: first.runs });
    return { ops, selection: caret(target.id, offset + textLength(first.runs)) };
  }

  const tail = sliceRuns(target.runs, offset, length);
  let rest = items;
  if (offset > 0) {
    if (offset < length) ops.push({ type: "delete_text", block: target.id, from: offset, to: length });
    if (isTextBlock(first)) {
      if (first.runs.length > 0) ops.push({ type: "insert_text", block: target.id, offset, runs: first.runs });
      rest = items.slice(1);
    }
  }

  const placed = rest.slice();
  const last = placed[placed.length - 1]!;
  let landing: Point;
  let absorbed = false;
  if (isTextBlock(last)) {
    // The text after the caret continues in the last pasted block.
    landing = { block: last.id, offset: textLength(last.runs) };
    placed[placed.length - 1] = { ...last, runs: normalizeRuns([...last.runs, ...tail]) };
    absorbed = offset === 0;
  } else if (offset > 0) {
    const next = here.list[here.index + 1];
    if (tail.length === 0 && next && isTextBlock(next)) {
      // The paragraph that follows is already a place to keep typing.
      landing = { block: next.id, offset: 0 };
    } else {
      const after: Block = tail.length > 0 ? { ...target, id: createId("b_"), runs: tail } : emptyParagraph();
      placed.push(after);
      landing = { block: after.id, offset: 0 };
    }
  } else {
    landing = { block: target.id, offset: 0 };
  }

  let anchor = offset > 0 ? { after: target.id as string | null } : placeBefore(here);
  for (const block of placed) {
    ops.push({ type: "insert_block", block, after: anchor.after, ...("cell" in anchor && anchor.cell !== undefined && { cell: anchor.cell }) });
    anchor = { after: block.id };
  }
  if (absorbed) ops.push({ type: "delete_block", id: target.id });
  return { ops, selection: caret(landing.block, landing.offset) };
}

/**
 * Pastes a table over the cells of the table the caret is in, starting at the caret's cell (or the
 * top-left of the selected cells), like pasting a range into a spreadsheet. The table grows to fit.
 * Null when that isn't possible (the caret isn't in a table, the target has merged cells in the way,
 * or the result would be too large), and the caller pastes the table as text instead.
 */
function pasteOverCells(doc: Doc, selection: Selection, source: TableBlock): CommandResult | null {
  const dragged = cellRect(doc, selection);
  let table: TableBlock;
  let row0: number;
  let col0: number;
  if (dragged) {
    table = dragged.table;
    row0 = dragged.row1;
    col0 = dragged.col1;
  } else {
    if (selection.anchor.block !== selection.focus.block || selection.anchor.offset !== selection.focus.offset) return null;
    const located = locate(doc, selection.focus.block);
    if (!located?.cell) return null;
    ({ table, row: row0, col: col0 } = located.cell);
  }

  const height = source.rows.length;
  const width = source.columns.length;
  if (row0 + height > MAX_TABLE_ROWS || col0 + width > MAX_TABLE_COLUMNS) return null;

  // Cells that are merged can't be overwritten piecemeal.
  for (let r = row0; r < Math.min(table.rows.length, row0 + height); r++) {
    for (let c = col0; c < Math.min(table.columns.length, col0 + width); c++) {
      const cell = table.rows[r]!.cells[c]!;
      if (cell.covered || cell.rowSpan || cell.colSpan) return null;
    }
  }
  // Nor can a merged cell that reaches into the new area from outside; with no merged cells there, none does.

  let grown = table;
  while (grown.rows.length < row0 + height) grown = insertRowAt(grown, grown.rows.length);
  while (grown.columns.length < col0 + width) grown = insertColumnAt(grown, grown.columns.length);

  const clones = cloneBlocks([source])[0] as TableBlock;
  const rows = grown.rows.map((row, r) => {
    if (r < row0 || r >= row0 + height) return row;
    return {
      ...row,
      cells: row.cells.map((cell, c) => (c >= col0 && c < col0 + width ? clones.rows[r - row0]!.cells[c - col0]! : cell)),
    };
  });
  const next: TableBlock = { ...grown, rows };
  if (checkGrid(next)) return null;

  const op: DocOp = { type: "replace_block", id: table.id, block: next };
  const start = cellAt(next, row0, col0).cell.blocks[0]!;
  const end = cellAt(next, row0 + height - 1, col0 + width - 1);
  const endBlocks = end.cell.blocks;
  if (end.cell.id === cellAt(next, row0, col0).cell.id) {
    const lastBlock = endBlocks[endBlocks.length - 1]!;
    return { ops: [op], selection: caret(lastBlock.id, isTextBlock(lastBlock) ? textLength(lastBlock.runs) : 0) };
  }
  return { ops: [op], selection: { anchor: { block: start.id, offset: 0 }, focus: { block: endBlocks[0]!.id, offset: 0 } } };
}

/**
 * Inserts blocks (from a paste) at the caret in one step. A lone table pasted with the caret in a
 * table fills the cells from there, growing the table; anything else is spliced in as text and blocks.
 * The blocks keep their ids unless the document already uses them.
 */
export function insertFragment(input: readonly Block[], footnotes?: Footnotes, styles?: Record<string, DocStyle>): Command {
  return (doc, selection) => {
    if (input.length === 0) return null;
    // Footnote references arrive with copies of their notes, so the pasted text has notes of its own.
    const hasNotes = footnoteIds(input).length > 0;
    // A comment stays with the text it was made on: pasted copies don't belong to its thread.
    const plain = stripSuggestions(stripComments(input));
    const copied = hasNotes ? copyFootnotes(plain, footnotes) : null;
    const blocks = copied?.blocks ?? plain;
    const noteOps: DocOp[] = Object.entries(copied?.notes ?? {}).map(([id, body]) => ({ type: "set_footnote", id, blocks: body }));

    // Styles that came with the text, and the ones they are based on, are added where the document has none of that id; its own win.
    if (styles) {
      const wanted = new Set<string>();
      for (const id of stylesUsed(blocks)) for (let at: string | undefined = id; at !== undefined && styles[at] && !wanted.has(at); at = styles[at]!.basedOn) wanted.add(at);
      for (const id of wanted) if (!doc.styles?.[id]) noteOps.push({ type: "set_style", id, style: styles[id]! });
    }

    let result: CommandResult | null = null;
    if (blocks.length === 1 && blocks[0]!.type === "table") result = pasteOverCells(doc, selection, blocks[0]);
    result ??= splice(doc, selection, blocks);
    return result && noteOps.length > 0 ? { ...result, ops: [...noteOps, ...result.ops] } : result;
  };
}
