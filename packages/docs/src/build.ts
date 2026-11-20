import { createId } from "@pli.dev/core";
import type {
  Align,
  Block,
  CodeBlock,
  Doc,
  DividerBlock,
  HeadingBlock,
  ImageBlock,
  ListItemBlock,
  Marks,
  PageBreakBlock,
  SectionBreakBlock,
  BoxStyle,
  Columns,
  FloatPlacement,
  ParagraphBlock,
  ParagraphFormat,
  QuoteBlock,
  Run,
  SubtitleBlock,
  TableBlock,
  TitleBlock,
  TocBlock,
} from "./model";
import { normalizeColumns } from "./tables";
import { PX_PER_INCH, pageDimensions, pageSetupOf } from "./page";
import { normalizeRuns } from "./runs";

/** Anything that can be turned into runs: a string, a run, or a list of either. */
export type Inline = string | Run | readonly Inline[];

export function toRuns(content: Inline): Run[] {
  if (typeof content === "string") return normalizeRuns([{ text: content }]);
  if (Array.isArray(content)) return normalizeRuns((content as readonly Inline[]).flatMap(toRuns));
  return normalizeRuns([content as Run]);
}

/** A run with marks: `text("hello", { bold: true })`. */
export function text(value: string, marks?: Marks): Run {
  return marks ? { text: value, marks } : { text: value };
}

export const bold = (value: string): Run => text(value, { bold: true });
export const italic = (value: string): Run => text(value, { italic: true });
export const code = (value: string): Run => text(value, { code: true });
export const link = (value: string, href: string): Run => text(value, { link: href });

export function paragraph(content: Inline = "", align?: Align): ParagraphBlock {
  return { id: createId("b_"), type: "paragraph", runs: toRuns(content), ...(align && { align }) };
}

export function heading(level: HeadingBlock["level"], content: Inline, align?: Align): HeadingBlock {
  return { id: createId("b_"), type: "heading", level, runs: toRuns(content), ...(align && { align }) };
}

export function listItem(list: "bullet" | "ordered", content: Inline, depth = 0): ListItemBlock {
  return { id: createId("b_"), type: "list_item", list, depth, runs: toRuns(content) };
}

export function quote(content: Inline): QuoteBlock {
  return { id: createId("b_"), type: "quote", runs: toRuns(content) };
}

export function codeBlock(source: string, language?: string): CodeBlock {
  return {
    id: createId("b_"),
    type: "code_block",
    runs: source === "" ? [] : [{ text: source }],
    ...(language && { language }),
  };
}

export function title(content: Inline, align?: Align): TitleBlock {
  return { id: createId("b_"), type: "title", runs: toRuns(content), ...(align && { align }) };
}

export function subtitle(content: Inline, align?: Align): SubtitleBlock {
  return { id: createId("b_"), type: "subtitle", runs: toRuns(content), ...(align && { align }) };
}

/** A paragraph with spacing or indentation: `spaced("text", { lineHeight: 1.5 })`. */
export function spaced(content: Inline, format: ParagraphFormat, align?: Align): ParagraphBlock {
  return { id: createId("b_"), type: "paragraph", runs: toRuns(content), format, ...(align && { align }) };
}

export function image(src: string, size: { width: number; height: number }, options: { alt?: string; align?: Align } = {}): ImageBlock {
  return { id: createId("b_"), type: "image", src, ...size, ...options };
}

/**
 * A picture at a position on the page, in front of the text or behind it. With `behind: true` and the size of the page it is a
 * page background: `floatingImage(src, { width: 816, height: 1056 }, { x: { from: "page" }, y: { from: "page" }, behind: true })`.
 */
export function floatingImage(src: string, size: { width: number; height: number }, float: FloatPlacement, options: { alt?: string } = {}): ImageBlock & { float: FloatPlacement } {
  return { id: createId("b_"), type: "image", src, ...size, ...options, float };
}

/**
 * A picture that covers a whole page, behind the text: a page background, a cover page's artwork. `natural` is the picture's own
 * size; if its shape isn't the page's, the edges that don't fit are cropped so it fills the page without being stretched. Put it
 * in front of a page's first paragraph with `session.insertFloat`.
 */
export function pageBackground(src: string, natural: { width: number; height: number }, page?: Doc["page"], options: { alt?: string } = {}): ImageBlock & { float: FloatPlacement } {
  const setup = pageSetupOf({ page });
  const size = pageDimensions(setup);
  const width = Math.round(size.width * PX_PER_INCH);
  const height = Math.round(size.height * PX_PER_INCH);
  const shape = natural.width / Math.max(1, natural.height);
  const wanted = width / height;
  let crop: ImageBlock["crop"];
  if (Number.isFinite(shape) && Math.abs(shape - wanted) > 0.005) {
    // Wider than the page: cut the sides. Taller: cut the top and bottom. Equal parts from each end.
    const cut = Math.round(((shape > wanted ? (1 - wanted / shape) / 2 : (1 - shape / wanted) / 2)) * 100000) / 100000;
    crop = shape > wanted ? { top: 0, bottom: 0, left: Math.min(cut, 0.45), right: Math.min(cut, 0.45) } : { left: 0, right: 0, top: Math.min(cut, 0.45), bottom: Math.min(cut, 0.45) };
  }
  return { id: createId("b_"), type: "image", src, width, height, ...options, ...(crop && { crop }), float: { x: { from: "page" }, y: { from: "page" }, behind: true } };
}

/**
 * A box of text at a position on the page (a text box), or with no text, a shape. The content is a paragraph for each string in
 * `paragraphs`. Fill, outline and size come in `float`, along with where it sits. Its text can hold `{{ … }}` like any other.
 */
export function textBox(paragraphs: readonly Inline[] | Inline, float: FloatPlacement & BoxStyle): TableBlock & { float: FloatPlacement & BoxStyle } {
  const lines: readonly Inline[] = typeof paragraphs === "string" || !Array.isArray(paragraphs) ? [paragraphs as Inline] : (paragraphs as readonly Inline[]);
  return {
    id: createId("b_"),
    type: "table",
    rows: [{ id: createId("r_"), cells: [{ id: createId("c_"), blocks: (lines.length ? lines : [""]).map((line) => ({ id: createId("b_"), type: "paragraph" as const, runs: toRuns(line) })) }] }],
    columns: [1],
    borders: "none",
    float,
  };
}

/** A section break. The section after it has `columns` (default: one column). */
export function sectionBreak(kind: SectionBreakBlock["kind"] = "continuous", columns?: Columns): SectionBreakBlock {
  return { id: createId("b_"), type: "section_break", kind, ...(columns && columns.count > 1 && { columns }) };
}

export function pageBreak(): PageBreakBlock {
  return { id: createId("b_"), type: "page_break" };
}

/** A table of contents of the document's headings, up to `levels` deep. */
export function toc(levels: TocBlock["levels"] = 3, title?: string): TocBlock {
  return { id: createId("b_"), type: "toc", levels, ...(title !== undefined && { title }) };
}

/**
 * A table from rows of cell content: `table([["Name", "Age"], ["Ana", "31"]], { headerRow: true })`.
 * Each cell is a string or inline content; every row must have the same number of cells.
 */
export function table(
  rows: readonly (readonly Inline[])[],
  options: { headerRow?: boolean; borders?: TableBlock["borders"]; columns?: readonly number[] } = {},
): TableBlock {
  const width = rows[0]?.length ?? 1;
  return {
    id: createId("b_"),
    type: "table",
    rows: rows.map((cells) => ({
      id: createId("r_"),
      cells: Array.from({ length: width }, (_, i) => ({
        id: createId("c_"),
        blocks: [{ id: createId("b_"), type: "paragraph" as const, runs: toRuns(cells[i] ?? "") }],
      })),
    })),
    columns: normalizeColumns(options.columns ?? Array.from({ length: width }, () => 1)),
    ...(options.headerRow && { headerRow: true }),
    ...(options.borders && { borders: options.borders }),
  };
}

export function divider(): DividerBlock {
  return { id: createId("b_"), type: "divider" };
}

export function createDoc(title: string, blocks: Block[] = []): Doc {
  return { id: createId("doc_"), type: "document", title, blocks };
}
