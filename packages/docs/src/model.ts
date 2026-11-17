/**
 * The document model is plain JSON: no classes, no DOM, no platform types.
 * That keeps it serializable and identical across JS, Swift, Kotlin, and
 * any future platforms we might support in the future.
 */

import type { Thread } from "@pli.dev/core";

/**
 * Where a comment thread was attached when it was made. The marks in the text say where it is now; this is
 * what's left when the text has gone, and how to put the mark back for someone who doesn't have it.
 */
export interface DocAnchor {
  /** The block where the commented text began. */
  block: string;
  /** Offsets of the text in that block when the comment was made. */
  from: number;
  to: number;
  /** The text that was commented on. Short, so the thread still makes sense after the text is edited or gone. */
  quote: string;
}

export interface Marks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  /** Hyperlink target. */
  link?: string;
  /** Text color as a hex string, e.g. "#d33". */
  color?: string;
  /** Highlight color as a hex string. */
  highlight?: string;
  /** Font family name, e.g. "Georgia". Unset means the document default. */
  fontFamily?: string;
  /** Font size in points. Unset means the document default. */
  fontSize?: number;
  /**
   * Marks a run as a field that shows a computed value, such as the page number in a header.
   * The run's text is the field's cached value.
   */
  field?: "page" | "pages";
  /**
   * Marks a run as a footnote reference: the id of a note in `Doc.footnotes`. The run's text is a single
   * zero-width character (`FOOTNOTE_CHAR`); the number shown is worked out from the reference's place.
   */
  footnote?: string;
  /**
   * The ids of the comment threads attached to this text (see `Doc.comments` and `DocumentSession.comments`).
   * The thread itself lives wherever comments are stored; the document keeps only where it is attached.
   * Sorted, so equal sets are equal.
   */
  comment?: string[];
  /** The id of a character style in `Doc.styles`: the text looks as the style says, except for what its own marks change. */
  style?: string;
  /**
   * Marks the text as a suggestion that nobody has accepted or rejected yet: text someone added (`insert`) or text
   * someone proposes to remove (`delete`, which is still in the document until accepted). Runs of one suggestion share an `id`.
   */
  suggest?: Suggestion;
}

/** A change proposed to the text, waiting to be accepted or rejected. */
export interface Suggestion {
  id: string;
  kind: "insert" | "delete";
  /** The `PliUser.id` of the person who suggested it. */
  by: string;
  /** Milliseconds since 1970. */
  at: number;
}

/** Sets a mark to a value, or removes it with `null`. */
export type MarkPatch = { [K in keyof Marks]?: Marks[K] | null };

export interface Run {
  text: string;
  marks?: Marks;
}

export type Align = "left" | "center" | "right" | "justify";

/** Spacing and indentation for a paragraph-like block. All lengths are in points. */
export interface ParagraphFormat {
  /** Line height as a multiple of the font size, e.g. 1.15. */
  lineHeight?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  indentLeft?: number;
  /** Indent from the right margin. */
  indentRight?: number;
  /** Extra indent of the first line; negative for a hanging indent. */
  indentFirst?: number;
}

export type ParagraphFormatPatch = {
  [K in keyof ParagraphFormat]?: ParagraphFormat[K] | null;
};

interface Formattable {
  align?: Align;
  format?: ParagraphFormat;
  /** The id of a paragraph style in `Doc.styles`. What the block sets itself (`align`, `format`, marks on its text) wins over the style. */
  style?: string;
}

/** The text marks a named style can set. */
export type StyleMarks = Pick<Marks, "bold" | "italic" | "underline" | "strike" | "superscript" | "subscript" | "color" | "highlight" | "fontFamily" | "fontSize">;

/**
 * A named style: a look that can be applied to many paragraphs (a paragraph style) or to runs of text (a character
 * style), and changed in one place. A style can be based on another of the same kind and only says what differs.
 */
export interface DocStyle {
  name: string;
  kind: "paragraph" | "character";
  /** The id of the style this one starts from. Must be a style of the same kind. */
  basedOn?: string;
  /** The look of the text. */
  marks?: StyleMarks;
  /** Paragraph styles only. */
  align?: Align;
  /** Paragraph styles only: spacing and indents. */
  format?: ParagraphFormat;
}

export interface ParagraphBlock extends Formattable {
  id: string;
  type: "paragraph";
  runs: Run[];
}

export interface HeadingBlock extends Formattable {
  id: string;
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  runs: Run[];
}

/** The document title, larger than any heading. Not part of the table of contents. */
export interface TitleBlock extends Formattable {
  id: string;
  type: "title";
  runs: Run[];
}

export interface SubtitleBlock extends Formattable {
  id: string;
  type: "subtitle";
  runs: Run[];
}

/** What a list item's marker looks like: numbers, letters or roman numerals for an ordered list, a symbol for a bullet list. */
export type ListMarker = "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman" | "disc" | "circle" | "square";

export interface ListItemBlock extends Formattable {
  id: string;
  type: "list_item";
  list: "bullet" | "ordered";
  /** Nesting depth, starting at 0. */
  depth: number;
  /** The marker style. Without it, a list uses 1. a. i. (or • ◦ ▪) by depth. */
  marker?: ListMarker;
  /** For an ordered item: the number it takes, so numbering starts or restarts here and carries on after it. */
  start?: number;
  runs: Run[];
}

export interface QuoteBlock extends Formattable {
  id: string;
  type: "quote";
  runs: Run[];
}

export interface CodeBlock {
  id: string;
  type: "code_block";
  language?: string;
  /** Marks are ignored when rendering code blocks. */
  runs: Run[];
}

export interface DividerBlock {
  id: string;
  type: "divider";
}

/** Forces the following content onto a new page. */
export interface PageBreakBlock {
  id: string;
  type: "page_break";
}

/** How a section's text is arranged in columns. */
export interface Columns {
  /** 1 to 4. One column is ordinary text. */
  count: number;
  /** Space between columns, in points. Default 36 (half an inch). */
  gap?: number;
  /** Draw a thin line between columns. */
  rule?: boolean;
}

/**
 * Starts a new section. Everything after it, up to the next section break, is one section, which can
 * have its own columns. The text before the first break is the first section, whose columns are in
 * `PageSetup.columns`.
 */
/**
 * What a section changes about its pages. Anything left out is the previous section's. A section whose pages
 * differ from the section before it always starts on a new page.
 */
export interface SectionPage {
  size?: PageSize;
  orientation?: "portrait" | "landscape";
  /** Margins in inches. All four. */
  margins?: PageSetup["margins"];
}

export interface SectionBreakBlock {
  id: string;
  type: "section_break";
  /** `next_page` starts the section on a new page; `continuous` starts it right after the text above. */
  kind: "next_page" | "continuous";
  /** The columns of the section this break starts. Unset means one column. */
  columns?: Columns;
  /** This section's page size, orientation and margins, where they differ from the section before. */
  page?: SectionPage;
  /** Give the first page of this section its own header and footer (`headerFirst`, `footerFirst` below). */
  differentFirstPage?: boolean;
  /**
   * This section's own headers and footers, by `RegionName`. A header or footer that isn't listed is the
   * previous section's ("linked to previous"). A listed one that is empty is blank for this section.
   */
  regions?: Partial<Record<RegionName, Block[]>>;
}

/**
 * The part of a picture that is cut away, as a share of the whole picture from each edge (0 to 0.9). The picture's `width` and
 * `height` are the size of what is left, so cropping never changes how big the picture is on the page.
 */
export interface ImageCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ImageBlock {
  id: string;
  type: "image";
  /** A URL or a `data:` URI. */
  src: string;
  alt?: string;
  /** Display size in CSS pixels. */
  width: number;
  height: number;
  align?: Align;
  /**
   * Text wraps around the picture, which sits at the left or right edge: the text of the blocks after it runs beside it
   * and then under it. Without it the picture stands on a line of its own, aligned by `align`. It works in the body of a
   * document and in a table cell (the text of the cell's blocks wraps); in a header, footer or footnote the picture stays on its own line.
   */
  wrap?: "left" | "right";
  /** Cut away the edges of the picture. The file keeps all of it, so the crop can be changed later. */
  crop?: ImageCrop;
}

/** A table of contents built from the document's headings. It is generated, so it stays current. */
export interface TocBlock {
  id: string;
  type: "toc";
  /** Include headings up to this level (1 to 6). */
  levels: 1 | 2 | 3 | 4 | 5 | 6;
  title?: string;
}

/** What a table cell can hold. Tables don't nest, and page breaks and contents belong to the page, not a cell. */
export type CellBlock = TextBlock | ImageBlock | DividerBlock;

/**
 * One cell of a table's grid. Every row has one cell per column, even where cells are merged:
 * a merged cell is the cell at its top-left, with `colSpan` and `rowSpan`, and the grid squares it
 * covers hold placeholder cells marked `covered`. Keeping the grid regular keeps row, column and
 * selection logic simple, and matches how Word stores merged cells.
 */
export interface TableCell {
  id: string;
  /** At least one block, except for a `covered` cell, which has none. */
  blocks: CellBlock[];
  /** Background color as a hex string. */
  shade?: string;
  /** How many columns this cell spans, when more than 1. */
  colSpan?: number;
  /** How many rows this cell spans, when more than 1. */
  rowSpan?: number;
  /** Where the content sits in the cell's height. Default `top`. */
  vAlign?: "top" | "middle" | "bottom";
  /** A placeholder for a grid square that another cell's span covers. It has no content and isn't shown. */
  covered?: true;
}

export interface TableRow {
  id: string;
  cells: TableCell[];
  /** Minimum height in points. The row grows to fit its content. Unset means fit the content. */
  height?: number;
}

/**
 * A table. Cells hold blocks of their own, which are edited like any other text, so typing,
 * lists and formatting work inside cells.
 */
export interface TableBlock {
  id: string;
  type: "table";
  rows: TableRow[];
  /** Width of each column as a fraction of the table; they add up to 1. One entry per column. */
  columns: number[];
  /** Style the first row as a header: bold, shaded, and repeated if the table is exported to Word. */
  headerRow?: boolean;
  /** Which cell borders to draw. Default `all`. */
  borders?: "all" | "horizontal" | "none";
}

export type TextBlock =
  | ParagraphBlock
  | HeadingBlock
  | TitleBlock
  | SubtitleBlock
  | ListItemBlock
  | QuoteBlock
  | CodeBlock;
export type NonTextBlock =
  | DividerBlock
  | PageBreakBlock
  | SectionBreakBlock
  | ImageBlock
  | TocBlock
  | TableBlock;
export type Block = TextBlock | NonTextBlock;

/** Text blocks that can carry alignment and paragraph formatting (everything but code). */
export type FormattableBlock = Exclude<TextBlock, CodeBlock>;

export type PageSize = "letter" | "a4" | "legal" | "a5";

export interface PageSetup {
  size: PageSize;
  orientation: "portrait" | "landscape";
  /** Margins in inches. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** The columns of the first section. Sections after a section break set their own. Unset means one column. */
  columns?: Columns;
  /** Give the first page its own header and footer (`headerFirst`, `footerFirst`). */
  differentFirstPage?: boolean;
  /** Give even pages their own header and footer (`headerEven`, `footerEven`); `header` and `footer` then serve odd pages. */
  differentOddEven?: boolean;
}

/** The places a page's header and footer content can live. See `regionKeyFor`. */
export type RegionName = "header" | "footer" | "headerFirst" | "footerFirst" | "headerEven" | "footerEven";

export interface Doc {
  id: string;
  type: "document";
  title: string;
  blocks: Block[];
  /** Page size, orientation and margins. Unset means US Letter, portrait, one inch margins. */
  page?: PageSetup;
  /**
   * The text of each footnote, by id. A note is shown for each reference to it (a run with the `footnote`
   * mark) in the body. Notes nothing refers to are dropped when the document is saved.
   */
  footnotes?: Record<string, Block[]>;
  /**
   * Comment threads saved in the document itself, by id. This is one place to keep comments (the other is a
   * store of your own); either way the text a thread is attached to is marked with `Marks.comment`.
   */
  comments?: Record<string, Thread<DocAnchor>>;
  /** Named styles by id: see `DocStyle`. Blocks and runs refer to them with `style`. */
  styles?: Record<string, DocStyle>;
  /** Content repeated at the top of every page (or of odd pages, with `differentOddEven`). */
  header?: Block[];
  /** Content repeated at the bottom of every page (or of odd pages, with `differentOddEven`). */
  footer?: Block[];
  /** The first page's header, used with `page.differentFirstPage`. Empty means no header on the first page. */
  headerFirst?: Block[];
  footerFirst?: Block[];
  /** Even pages' header, used with `page.differentOddEven`. Empty means no header on even pages. */
  headerEven?: Block[];
  footerEven?: Block[];
}

const NON_TEXT = new Set<Block["type"]>([
  "divider",
  "page_break",
  "section_break",
  "image",
  "toc",
  "table",
]);

export function isTextBlock(block: Block): block is TextBlock {
  return !NON_TEXT.has(block.type);
}

export function isFormattable(block: Block): block is FormattableBlock {
  return isTextBlock(block) && block.type !== "code_block";
}
