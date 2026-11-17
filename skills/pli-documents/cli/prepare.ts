import { createId } from "@pli.dev/core";
import { inlineMarkdown, normalizeRuns, parseDoc, serializeDoc, type Block, type Doc, type Run } from "@pli.dev/docs";

/**
 * Makes a document from what an agent finds easy to write: a document without ids, text as a string, a table as rows of strings, a header as
 * a line of text. Anything the full model has can still be written out in full; this only fills in what is missing.
 */

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const PREFIX: Record<string, string> = { table: "b_", row: "r_", cell: "c_" };
const id = (kind: string) => createId(PREFIX[kind] ?? "b_");

/** Runs from a string with {page} and {pages} where the page number and the count of pages go. */
function fieldRuns(text: string): Run[] {
  const runs: Run[] = [];
  for (const part of text.split(/(\{pages?\})/)) {
    if (part === "{page}") runs.push({ text: "1", marks: { field: "page" } });
    else if (part === "{pages}") runs.push({ text: "1", marks: { field: "pages" } });
    else if (part !== "") runs.push(...inlineMarkdown(part));
  }
  return normalizeRuns(runs);
}

function runsOf(block: Json): void {
  // `md` is Markdown for the text (bold, italic, code, links); `text` is exactly what is written.
  if (typeof block.md === "string") {
    block.runs = normalizeRuns(inlineMarkdown(block.md));
    delete block.md;
  } else if (typeof block.text === "string") {
    block.runs = block.text === "" ? [] : [{ text: block.text }];
    delete block.text;
  } else if (Array.isArray(block.runs)) {
    block.runs = (block.runs as unknown[]).map((r) => (typeof r === "string" ? { text: r } : r));
  } else if (block.runs === undefined && ["paragraph", "heading", "title", "subtitle", "list_item", "quote", "code_block"].includes(String(block.type))) {
    block.runs = [];
  }
}

function fixBlock(block: unknown): Json {
  if (typeof block === "string") return { id: id("paragraph"), type: "paragraph", runs: normalizeRuns(inlineMarkdown(block)) };
  if (!isObject(block)) throw new Error("A block should be an object such as {\"type\":\"paragraph\",\"text\":\"…\"}");
  const out: Json = { ...block };
  if (typeof out.id !== "string") out.id = id(String(out.type));
  runsOf(out);
  if (out.type === "table") {
    const rows = Array.isArray(out.rows) ? (out.rows as unknown[]) : [];
    const width = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : isObject(r) && Array.isArray(r.cells) ? r.cells.length : 0)));
    out.rows = rows.map((row) => {
      const source = Array.isArray(row) ? { cells: row } : isObject(row) ? { ...row } : { cells: [] };
      const cellsIn = (Array.isArray(source.cells) ? source.cells : []) as unknown[];
      return {
        ...source,
        id: typeof source.id === "string" ? source.id : id("row"),
        cells: Array.from({ length: width }, (_, i) => {
          const cell = cellsIn[i];
          // A cell can be a string (Markdown for its text), a block, a list of blocks, or a full cell.
          if (cell === undefined) return { id: id("cell"), blocks: [{ id: id("paragraph"), type: "paragraph", runs: [] }] };
          if (typeof cell === "string") return { id: id("cell"), blocks: [{ id: id("paragraph"), type: "paragraph", runs: normalizeRuns(inlineMarkdown(cell)) }] };
          if (Array.isArray(cell)) return { id: id("cell"), blocks: cell.map(fixBlock) };
          if (isObject(cell) && Array.isArray(cell.blocks)) return { ...cell, id: typeof cell.id === "string" ? cell.id : id("cell"), blocks: (cell.blocks as unknown[]).map(fixBlock) };
          return { id: id("cell"), blocks: [fixBlock(cell)] };
        }),
      };
    });
    if (!Array.isArray(out.columns)) out.columns = Array.from({ length: width }, () => 1 / width);
  }
  return out;
}

function fixBlocks(value: unknown): Json[] | undefined {
  return Array.isArray(value) ? value.map(fixBlock) : undefined;
}

/** A header or footer written as a line of text becomes one centred paragraph. */
function region(value: unknown, align: "left" | "center" | "right" = "center"): Json[] | undefined {
  if (typeof value === "string") return [{ id: id("paragraph"), type: "paragraph", align, runs: fieldRuns(value) }];
  return fixBlocks(value);
}

export interface Setup {
  title?: string;
  titleBlock?: boolean;
  page?: string;
  landscape?: boolean;
  acceptChanges?: boolean;
  margins?: number;
  header?: string;
  footer?: string;
}

/** Applies the options a person gives on the command line (page size, header and footer text) to a document. */
export function applySetup(doc: Doc, setup: Setup): Doc {
  const out: Doc = { ...doc };
  if (setup.title !== undefined) out.title = setup.title;
  if (setup.page || setup.landscape || setup.margins !== undefined) {
    const size = (setup.page ?? out.page?.size ?? "letter").toLowerCase();
    if (!["letter", "a4", "legal", "a5"].includes(size)) throw new Error(`The page size should be letter, a4, legal or a5, not "${size}"`);
    const margin = setup.margins ?? out.page?.margins?.top ?? 1;
    out.page = {
      ...(out.page ?? { margins: { top: 1, right: 1, bottom: 1, left: 1 } }),
      size: size as "letter",
      orientation: setup.landscape ? "landscape" : (out.page?.orientation ?? "portrait"),
      margins: setup.margins !== undefined ? { top: margin, right: margin, bottom: margin, left: margin } : (out.page?.margins ?? { top: 1, right: 1, bottom: 1, left: 1 }),
    };
  }
  if (setup.header !== undefined) out.header = region(setup.header, "right") as unknown as Block[];
  if (setup.footer !== undefined) out.footer = region(setup.footer) as unknown as Block[];
  return out;
}

/** Reads JSON an agent wrote (a saved document, or just a document's content) into a checked document. */
export function prepare(input: unknown): Doc {
  let raw: unknown = input;
  if (isObject(raw) && raw.format === "pli.doc" && isObject(raw.doc)) raw = raw.doc;
  if (Array.isArray(raw)) raw = { blocks: raw };
  if (!isObject(raw)) throw new Error('The file should hold a document: {"title":"…","blocks":[…]}');

  const doc: Json = { ...raw };
  doc.type = "document";
  if (typeof doc.id !== "string") doc.id = createId("doc_");
  if (typeof doc.title !== "string") doc.title = "Untitled";
  doc.blocks = fixBlocks(doc.blocks) ?? [];
  for (const key of ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"]) {
    if (doc[key] !== undefined) doc[key] = region(doc[key], key.startsWith("header") ? "right" : "center");
  }
  if (isObject(doc.footnotes)) {
    doc.footnotes = Object.fromEntries(Object.entries(doc.footnotes).map(([key, value]) => [key, typeof value === "string" ? [fixBlock(value)] : fixBlocks(value) ?? []]));
  }
  // Checking it in the same way a saved file is checked gives errors that say where the mistake is.
  return parseDoc(JSON.stringify({ format: "pli.doc", version: 1, doc }));
}

export { serializeDoc };
