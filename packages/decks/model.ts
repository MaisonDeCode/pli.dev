/**
 * The deck model is a plain JSON: no classes, no DOM, no platform types.
 * That keeps the model serializable and identical across all platforms that
 * we currently support and any future platforms we might support.
 */

interface Position {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  parent: string;
  children: string[];
  tags: string[];
  metadata: Record<string, any>;
}

interface Size {
  width: number;
  height: number;
  depth: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
  hex: string;
  rgb: string;
  hsl: string;
  hsv: string;
  cmyk: string;
  lab: string;
  lch: string;
  oklab: string;
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
}

interface Animation {
  type:
    | "fade"
    | "slide"
    | "zoom"
    | "rotate"
    | "scale"
    | "jump"
    | "bounce"
    | "pulse"
    | "shake"
    | "wobble"
    | "flip"
    | "spin"
    | "twinkle"
    | "pulse"
    | "bounce"
    | "spin"
    | "twinkle"
    | "pulse"
    | "bounce"
    | "spin"
    | "twinkle";
  duration: number;
  delay: number;
  easing: string;
}

type Align = "left" | "center" | "right" | "justify";

interface FormattableBlock {
  id: string;
  position: Position;
  size: Size;
  animation: Animation;
  background: Color;
}

// blocks needed TextBlock, ImageBlock, VideoBlock, AudioBlock, ChartBlock, TableBlock, LinkBlock, DividerBlock, ShapeBlock

interface TextBlock extends FormattableBlock {
  type: "text";
  content: string;
  marks: Marks;
}

interface ImageBlock extends FormattableBlock {
  type: "image";
  src: "image";
  alt?: string;
  width: number;
  height: number;
  align?: Align;
}

interface VideoBlock extends FormattableBlock {
  type: "video";
  src: string;
  width: number;
  height: number;
  align?: Align;
}

interface AudioBlock extends FormattableBlock {
  type: "audio";
  src: string;
  width: number;
  height: number;
  align?: Align;
}

// TODO: Add chart block (need to add more fields)
interface ChartBlock extends FormattableBlock {
  type: "chart";
  style:
    | "bar"
    | "line"
    | "pie"
    | "doughnut"
    | "radar"
    | "polar"
    | "scatter"
    | "bubble"
    | "area"
    | "line"
    | "pie"
    | "doughnut"
    | "radar"
    | "polar"
    | "scatter"
    | "bubble"
    | "area";
  data: any[];
  labels: string[];
  colors: string[];
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  borderDash: number[];
}

export interface DividerBlock {
  type: "divider";
}

export type CellBlock = TextBlock | ImageBlock | DividerBlock;
/**
 * One cell of a table's grid. Every row has one cell per column, even where cells are merged:
 * a merged cell is the cell at its top-left, with `colSpan` and `rowSpan`, and the grid squares it
 * covers hold placeholder cells marked `covered`. Keeping the grid regular keeps row, column and
 * selection logic simple, and matches how Word stores merged cells.
 */
export interface TableCell {
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
  cells: TableCell[];
  /** Minimum height in points. The row grows to fit its content. Unset means fit the content. */
  height?: number;
}

/**
 * A table. Cells hold blocks of their own, which are edited like any other text, so typing,
 * lists and formatting work inside cells.
 */
export interface TableBlock {
  type: "table";
  rows: TableRow[];
  /** Width of each column as a fraction of the table; they add up to 1. One entry per column. */
  columns: number[];
  /** Style the first row as a header: bold, shaded, and repeated if the table is exported to Word. */
  headerRow?: boolean;
  /** Which cell borders to draw. Default `all`. */
  borders?: "all" | "horizontal" | "none";
}

export interface LinkBlock {
  type: "link";
  href: string;
  text: string;
}

export interface ShapeBlock {
  type: "shape";
  shape:
    | "circle"
    | "rectangle"
    | "triangle"
    | "square"
    | "polygon"
    | "star"
    | "heart"
    | "diamond"
    | "arrow"
    | "line"
    | "curve"
    | "path";
  size: Size;
  color: Color;
}

export type Block =
  | TextBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | ChartBlock
  | TableBlock
  | DividerBlock;

export interface MasterSlide {
  id: string;
  type: "master_slide";
  content: Block[];
}

export interface DeckSlide {
  id: string;
  type: "slide";
  content: Block[];
  notes: string;
  // the order of the slide in the deck
  order: number;
}

export interface Deck {
  id: string;
  type: "deck";
  title: string;
  slides: DeckSlide[];
  masterSlide: MasterSlide;
}
