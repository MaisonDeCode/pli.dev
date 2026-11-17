import { createId } from "@pli.dev/core";
import type { Block, CellBlock, Doc, ParagraphBlock, Run } from "./model";
import { isTextBlock } from "./model";

/**
 * The character a footnote reference takes up in its paragraph: a zero-width space, carrying the
 * `footnote` mark that names the note. The number you see is worked out from where the reference is, so
 * notes renumber themselves as text is added, moved or removed, and the paragraph's text stays plain.
 */
export const FOOTNOTE_CHAR = "​";

/** Footnotes of a document: their text, by id. See `Doc.footnotes`. */
export type Footnotes = Record<string, Block[]>;

const refOf = (run: Run) => run.marks?.footnote;

/** The notes referred to by some blocks, in reading order, each once. Table cells are read in order too. */
export function footnoteIds(blocks: readonly Block[]): string[] {
  const seen = new Set<string>();
  const visit = (block: Block | CellBlock) => {
    if (isTextBlock(block)) {
      for (const run of block.runs) {
        const id = refOf(run);
        if (id !== undefined) seen.add(id);
      }
    } else if (block.type === "table") {
      for (const row of block.rows) for (const cell of row.cells) cell.blocks.forEach(visit);
    }
  };
  blocks.forEach(visit);
  return [...seen];
}

/** Each note's number: its place among the references in the body, starting at 1. */
export function footnoteNumbers(doc: Pick<Doc, "blocks">): Map<string, number> {
  return new Map(footnoteIds(doc.blocks).map((id, i) => [id, i + 1]));
}

/** The document without notes nothing refers to. Deleting a reference leaves its note behind for undo; saving drops them. */
export function pruneFootnotes<T extends Pick<Doc, "blocks" | "footnotes">>(doc: T): T {
  if (!doc.footnotes) return doc;
  const used = new Set(footnoteIds(doc.blocks));
  const kept = Object.keys(doc.footnotes).filter((id) => used.has(id));
  if (kept.length === Object.keys(doc.footnotes).length) return doc;
  const { footnotes: _all, ...rest } = doc;
  return (kept.length > 0 ? { ...rest, footnotes: Object.fromEntries(kept.map((id) => [id, doc.footnotes![id]!])) } : rest) as T;
}

/**
 * What a footnote can hold: paragraphs, quotes, list items and code. Headings become paragraphs, and
 * images, tables, dividers and page breaks are dropped. A note always has at least one block.
 */
export function cleanNoteBlocks(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.type === "heading" || block.type === "title" || block.type === "subtitle") {
      out.push({ id: block.id, type: "paragraph", runs: block.runs.filter((r) => !refOf(r)), ...(block.align && { align: block.align }) });
    } else if (isTextBlock(block)) {
      // A note can't hold another note.
      out.push({ ...block, runs: block.runs.filter((r) => !refOf(r)) });
    }
  }
  return out.length > 0 ? out : [{ id: createId("b_"), type: "paragraph", runs: [] } satisfies ParagraphBlock];
}

/** True if a block is allowed inside a note. */
export function isNoteBlock(block: Block): boolean {
  return block.type === "paragraph" || block.type === "quote" || block.type === "list_item" || block.type === "code_block";
}

/**
 * Copies of some blocks whose footnote references point at fresh copies of their notes, for pasting.
 * Notes the blocks don't refer to are left out. Returns the blocks and the new notes.
 */
export function copyFootnotes(blocks: readonly Block[], notes: Footnotes | undefined): { blocks: Block[]; notes: Footnotes } {
  const ids = new Map<string, string>();
  const rename = (run: Run): Run => {
    const id = refOf(run);
    if (id === undefined) return run;
    if (!ids.has(id)) ids.set(id, createId("fn_"));
    return { ...run, marks: { ...run.marks, footnote: ids.get(id)! } };
  };
  const mapBlock = <T extends Block | CellBlock>(block: T): T => {
    if (isTextBlock(block as Block)) return { ...block, runs: (block as ParagraphBlock).runs.map(rename) } as T;
    if (block.type === "table") {
      return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map(mapBlock) })) })) } as T;
    }
    return block;
  };
  const out = blocks.map(mapBlock);
  const next: Footnotes = {};
  for (const [from, to] of ids) {
    const body = notes?.[from];
    // A reference whose note isn't known gets an empty one, so the document stays valid.
    next[to] = (body ?? [{ id: createId("b_"), type: "paragraph", runs: [] }]).map((b) => ({ ...b, id: createId("b_") }) as Block);
  }
  return { blocks: out, notes: next };
}

/** A reference's `footnote` mark value that stands for "this note's own number", used at the start of a note when exporting. */
export const FOOTNOTE_SELF = "\u0000self";

/**
 * The document with each reference's text set to its number ("1", "2"…), for exporters that print the
 * number. The notes themselves are unchanged.
 */
export function numberFootnotes(doc: Doc): Doc {
  const numbers = footnoteNumbers(doc);
  if (numbers.size === 0) return doc;
  const number = (run: Run): Run => {
    const id = refOf(run);
    return id !== undefined && numbers.has(id) ? { ...run, text: String(numbers.get(id)) } : run;
  };
  const visit = <T extends Block | CellBlock>(block: T): T => {
    if (isTextBlock(block as Block)) return { ...block, runs: (block as ParagraphBlock).runs.map(number) } as T;
    if (block.type === "table") {
      return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map(visit) })) })) } as T;
    }
    return block;
  };
  return { ...doc, blocks: doc.blocks.map(visit) };
}

/** The name a footnote being edited goes by, alongside the names of headers and footers: `note:` and its id. */
export type NoteName = `note:${string}`;
export const noteName = (id: string): NoteName => `note:${id}`;
export const isNoteName = (name: string): name is NoteName => name.startsWith("note:");
export const noteIdOf = (name: NoteName): string => name.slice("note:".length);

/** The blocks with every footnote reference taken out, for places that can't hold notes: headers, footers and the notes themselves. */
export function stripFootnoteRefs(blocks: readonly Block[]): Block[] {
  const visit = <T extends Block | CellBlock>(block: T): T => {
    if (isTextBlock(block as Block)) {
      const runs = (block as ParagraphBlock).runs;
      return runs.some((r) => refOf(r)) ? ({ ...block, runs: runs.filter((r) => !refOf(r)) } as T) : block;
    }
    if (block.type === "table") {
      return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, blocks: c.blocks.map(visit) })) })) } as T;
    }
    return block;
  };
  return blocks.map(visit);
}
