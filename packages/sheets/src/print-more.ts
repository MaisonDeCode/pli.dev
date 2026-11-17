import { parseCell } from "./address";
import { axisOffsetPx, columnPixels, rowPixelsOf } from "./image";
import type { Border, IconSetName, NoteRun, Sheet } from "./model";
import { noteBoxPx, noteRunsOf } from "./note";
import type { PrintPage } from "./print";

/*
 * The rest of printing: how wide text is on paper (so it can run on into empty cells), how errors print, black and white,
 * and the notes that print after the sheet or over it.
 */

// ---- how wide text is ----

/** Calibri's advance widths in thousandths of an em for the characters whose width isn't the plain 0.48. */
const WIDTHS: Record<string, number> = {
  " ": 226, a: 479, b: 525, c: 423, d: 525, e: 498, f: 305, g: 471, h: 525, i: 229, j: 239, k: 455, l: 229, m: 799, n: 525, o: 527, p: 525, q: 525, r: 349, s: 391, t: 335, u: 525, v: 452, w: 715, x: 433, y: 453, z: 395,
  A: 579, B: 544, C: 533, D: 615, E: 488, F: 459, G: 631, H: 623, I: 252, J: 319, K: 519, L: 420, M: 855, N: 646, O: 662, P: 517, Q: 673, R: 543, S: 459, T: 487, U: 642, V: 567, W: 890, X: 519, Y: 487, Z: 468,
  "0": 507, "1": 507, "2": 507, "3": 507, "4": 507, "5": 507, "6": 507, "7": 507, "8": 507, "9": 507,
  ".": 252, ",": 250, ":": 268, ";": 268, "!": 283, "?": 463, "-": 306, "(": 303, ")": 303, "[": 325, "]": 325, "/": 386, "\\": 386, "@": 894, "#": 498, $: 507, "%": 715, "&": 682, "*": 498, "+": 498, "=": 498, _: 498, "'": 221, '"': 401, "|": 460, "<": 498, ">": 498, "~": 498, "^": 498,
};

/**
 * About how wide text is on paper, in points, at a size in points. This is Calibri's widths (the font a printed page asks
 * for first); another font is a little wider or narrower, so this is for deciding what may run on into empty cells, not for
 * fitting text exactly.
 */
export function textWidthPt(text: string, size = 11, bold = false): number {
  let em = 0;
  for (const ch of text) {
    const w = WIDTHS[ch];
    if (w !== undefined) em += w;
    else {
      const code = ch.codePointAt(0)!;
      // East Asian characters and emoji are a full em wide; accented letters are as wide as the plain ones.
      em += (code >= 0x2e80 && code <= 0xffef) || code >= 0x1f000 ? 1000 : code >= 0xc0 && code < 0x250 ? 500 : 520;
    }
  }
  return (em / 1000) * size * (bold ? 1.05 : 1);
}

// ---- errors ----

/** What an error prints as under a page setup's `errors`: its own text when the setup leaves it alone. */
export function printedError(mode: "blank" | "dash" | "na" | undefined, own: string): string {
  return mode === "blank" ? "" : mode === "dash" ? "--" : mode === "na" ? "#N/A" : own;
}

// ---- black and white ----

/** A cell's CSS with its colours taken out: no fill, black text, black lines. */
export function monoCss(css: string): string {
  return css
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d !== "" && !/^background/i.test(d))
    .map((d) => (/^color\s*:/i.test(d) ? "color:#000" : /^border/i.test(d) ? d.replace(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi, "#000") : d))
    .join(";");
}

/** An `<svg>` with every colour in it turned to black. */
export const monoSvg = (svg: string): string => svg.replace(/(fill|stroke)="(?!none)[^"]*"/gi, '$1="#000"');

// ---- text running on into empty cells ----

/** A cell whose text is wider than the cell and runs on over the empty cells beside it. */
export interface PrintOverflow {
  row: number;
  col: number;
  /** Which way it runs on, from its alignment: left-aligned text runs right, right-aligned runs left, centred runs both. */
  side: "right" | "left" | "both";
  /** The first and last column its text may reach (the cell's own and the empty ones next to it, up to the page edge or the next cell with something in it). */
  from: number;
  to: number;
  /** How many empty cells it actually reaches over. */
  over: number;
  /** The width in points the text has room in, its own cell and the empty ones. */
  room: number;
}

// ---- the cells of a page, as numbers (what a PDF is drawn from) ----

/** One cell of a printed page, worked out: where it is, what it shows and how it looks, for drawing it without HTML. */
export interface PrintedCell {
  row: number;
  col: number;
  /** Where the cell is, in points from the top left of the page's cells (a merged range is one cell as big as the range). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** What it shows; empty when a picture or a conditional format's bar or icon takes its place. */
  text: string;
  /** `#rrggbb`; left out for no fill, and for the default (black) ink. */
  fill?: string;
  color?: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  /** Points. */
  size: number;
  font?: string;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  wrap: boolean;
  /** Indent levels (three spaces' worth each). */
  indent: number;
  /** The lines round the cell, and its diagonals. */
  borders: Partial<Record<"top" | "right" | "bottom" | "left" | "diagonalUp" | "diagonalDown", Border & { color: string }>>;
  /** A conditional format's data bar, as fractions of the cell's width, and its icon. */
  bar?: { from: number; to: number; color: string; axis?: number; axisColor?: string };
  icon?: { set: IconSetName; index: number; count: number };
  /** A picture that is the cell's content (a `data:` address, or a web address when remote pictures are on). */
  picture?: { src: string; alt?: string };
  /** Text wider than the cell runs on into the empty cells beside it: the room in points on each side. */
  room?: { left: number; right: number };
  /** Where a link on the cell goes. */
  link?: string;
}

/** A page of cells as numbers: what the table of its HTML says, in a form a PDF (or anything else that draws) can use. */
export interface PrintScene {
  /** The cells with something to draw, in reading order. */
  cells: PrintedCell[];
  /** The rows and columns of the page (title rows and columns first), with their size in points; the headings sit beside them. */
  rows: { row: number; y: number; height: number }[];
  cols: { col: number; x: number; width: number }[];
  /** Whether gridlines are printed, and the size of the headings (row numbers and column letters) when they are. */
  gridlines: boolean;
  headings: { width: number; height: number } | null;
  /** Sparklines in cells, by "row:col": drawn in the cell's box. */
  sparklines: Record<string, import("./sparkline").SparkShape>;
}

// ---- notes ----

/** A note of a sheet, for printing. */
export interface PrintNote {
  address: string;
  row: number;
  col: number;
  text: string;
  /** Whether the note is kept showing on the sheet (its box has `show`). */
  shown: boolean;
}

/**
 * The notes that print. "At the end of the sheet" lists every note, showing or not, as Excel does; "as displayed on sheet"
 * (`shownOnly`) prints only the notes that are kept showing (right-click a cell > Show/Hide Note), each as its box over the sheet.
 */
export function printNotes(sheet: Sheet, shownOnly = false): PrintNote[] {
  const out: PrintNote[] = [];
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (cell.note === undefined || cell.note === "") continue;
    if (shownOnly && !cell.noteBox?.show) continue;
    const pos = parseCell(address);
    if (pos) out.push({ address, row: pos.row, col: pos.col, text: cell.note, shown: !!cell.noteBox?.show });
  }
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}

/** The font size of the notes list at the end, and the box of a note over the sheet, in points. */
export const NOTE_SIZE = 10;
export const NOTE_LINE = 12.5;
export const NOTE_BOX_WIDTH = 144;

/** How many lines a text takes in a box this wide (points), breaking at spaces. */
export function noteLines(text: string, width: number, size = NOTE_SIZE): number {
  let lines = 0;
  for (const para of text.split(/\r?\n/)) {
    let used = 0;
    let n = 1;
    for (const word of para.split(/(?<= )/)) {
      const w = textWidthPt(word, size);
      if (used > 0 && used + textWidthPt(word.trimEnd(), size) > width) {
        n++;
        used = 0;
      }
      used += w;
      if (w > width) n += Math.floor(w / width);
    }
    lines += n;
  }
  return lines;
}

/** One note as it prints in the list after the sheet. */
export interface NoteLine {
  cell: string;
  text: string;
}

/** The pages the list of notes takes (each holding the notes that fit), numbered from `first`. `fits` is what a page holds, in points. */
export function notesPages(sheet: Sheet, fits: { width: number; height: number }, first: number): PrintPage[] {
  const notes = printNotes(sheet);
  if (!notes.length) return [];
  const pages: PrintPage[] = [];
  let current: NoteLine[] = [];
  let used = 0;
  const flush = () => {
    if (!current.length) return;
    pages.push({ number: first + pages.length, area: -1, range: { r1: 1, c1: 1, r2: 1, c2: 1 }, notes: current });
    current = [];
    used = 0;
  };
  for (const n of notes) {
    const height = noteLines(`Cell ${n.address}: ${n.text}`, fits.width) * NOTE_LINE + 6;
    if (used > 0 && used + height > fits.height) flush();
    current.push({ cell: n.address, text: n.text });
    used += height;
  }
  flush();
  return pages;
}

/** The height of a notes page's list in points, and its HTML. */
export function notesHtml(lines: readonly NoteLine[], width: number, mono: boolean): { html: string; height: number } {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let height = 0;
  const items = lines.map((n) => {
    const h = noteLines(`Cell ${n.cell}: ${n.text}`, width) * NOTE_LINE;
    height += h + 6;
    return `<p data-note="${n.cell}" style="margin:0 0 6pt;font-size:${NOTE_SIZE}pt;line-height:${NOTE_LINE}pt;white-space:pre-wrap;${mono ? "color:#000" : ""}"><b>Cell ${n.cell}:</b> ${esc(n.text)}</p>`;
  });
  return { html: `<div style="width:${width}pt">${items.join("")}</div>`, height };
}

/** A note drawn over the sheet, in points from the top left of the page's own cells (it may reach past their edges, where it is cut off). */
export interface PrintedNote {
  cell: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The text's runs, when it has a look of its own, and who wrote it (printed in bold in front, as on the screen). */
  runs?: NoteRun[];
  author?: string;
}

/** Where a sheet pixel falls on a page, in points from the page's first cell: `axis` lists the page's visible columns or rows, in order. */
function onPage(sheet: Sheet, kind: "col" | "row", list: readonly number[], px: number): number {
  const size = (n: number) => (kind === "col" ? columnPixels(sheet, n) : rowPixelsOf(sheet, n));
  if (!list.length) return px * 0.75;
  let page = 0;
  const first = axisOffsetPx(sheet, kind, list[0]!);
  if (px <= first) return (px - first) * 0.75;
  for (const n of list) {
    const start = axisOffsetPx(sheet, kind, n);
    const len = size(n);
    // Hidden columns or rows between two on the page take no room: a point in them is where the next one begins.
    if (px < start) return page * 0.75;
    if (px < start + len) return (page + px - start) * 0.75;
    page += len;
  }
  const last = list[list.length - 1]!;
  return (page + px - (axisOffsetPx(sheet, kind, last) + size(last))) * 0.75;
}

/**
 * The notes kept showing, as Excel prints them with "as displayed on sheet": each note's box at the place and size it has on the
 * sheet, over the cells of this page, cut off where the page's cells end (the print area, or the page break). `cols` and `rows` are the
 * page's own visible columns and rows (not its repeated titles), and `page` the size they take in points. A note whose cell is hidden
 * isn't printed, nor is one whose box lies wholly outside the page.
 */
export function noteBoxes(sheet: Sheet, axes: { cols: readonly number[]; rows: readonly number[] }, page: { width: number; height: number }): PrintedNote[] {
  const out: PrintedNote[] = [];
  for (const n of printNotes(sheet, true)) {
    if (columnPixels(sheet, n.col) === 0 || rowPixelsOf(sheet, n.row) === 0) continue;
    const cell = sheet.cells[n.address]!;
    const px = noteBoxPx(axisOffsetPx(sheet, "col", n.col + 1), axisOffsetPx(sheet, "row", n.row), cell.noteBox);
    const x = onPage(sheet, "col", axes.cols, px.left);
    const y = onPage(sheet, "row", axes.rows, px.top);
    const width = onPage(sheet, "col", axes.cols, px.left + px.width) - x;
    const height = onPage(sheet, "row", axes.rows, px.top + px.height) - y;
    if (x >= page.width || y >= page.height || x + width <= 0 || y + height <= 0) continue;
    out.push({ cell: n.address, text: n.text, x, y, width, height, ...(cell.noteRuns ? { runs: noteRunsOf(cell) } : {}), ...(cell.noteAuthor ? { author: cell.noteAuthor } : {}) });
  }
  return out;
}

/** What `overflowFor` works out for one cell. */
export interface OverflowRun {
  side: "right" | "left" | "both";
  /** The room to the left and right of the cell, in points: the empty cells next to it as far as the page and the next cell with something in it allow. */
  left: number;
  right: number;
  /** Whether the text is wider than its cell (it may not be, when the estimate was close). */
  wider: boolean;
  /** The columns its text reaches into, nearest first on each side. */
  reached: { left: number[]; right: number[] };
}

/**
 * Whether the text of a cell may run on into the empty cells beside it, and how far there is room: the cell at `colList[index]`
 * has text `text`, and `empty` says whether another column's cell in the same row has nothing in it. Left-aligned text runs
 * right, right-aligned text runs left, centred text runs both ways; none of it goes past the columns on the page. Null when it
 * surely fits.
 */
export function overflowFor(o: { colList: readonly number[]; index: number; width(col: number): number; empty(col: number): boolean; text: string; size: number; bold: boolean; align: "left" | "right" | "center" }): OverflowRun | null {
  const c = o.colList[o.index]!;
  const own = o.width(c);
  const need = textWidthPt(o.text, o.size, o.bold) + 4;
  // The estimate can be a little short for another font, so a cell whose text is within 15% of fitting gets room as well.
  if (need * 1.15 <= own) return null;
  const run = (step: 1 | -1) => {
    const cols: number[] = [];
    let room = 0;
    let at = c;
    for (let i = o.index + step; i >= 0 && i < o.colList.length; i += step) {
      const next = o.colList[i]!;
      // Next to it, or with only hidden columns between.
      let touching = true;
      for (let x = at + step; x !== next; x += step) if (o.width(x) > 0) touching = false;
      if (!touching || !o.empty(next)) break;
      cols.push(next);
      room += o.width(next);
      at = next;
    }
    return { cols, room };
  };
  const right = o.align === "left" || o.align === "center" ? run(1) : { cols: [], room: 0 };
  const left = o.align === "right" || o.align === "center" ? run(-1) : { cols: [], room: 0 };
  const reach = (r: { cols: number[] }, extra: number) => {
    const out: number[] = [];
    let got = 0;
    for (const col of r.cols) {
      if (got >= extra) break;
      out.push(col);
      got += o.width(col);
    }
    return out;
  };
  const extra = need - own;
  const side = o.align === "left" ? "right" : o.align === "right" ? "left" : "both";
  return {
    side,
    left: left.room,
    right: right.room,
    wider: extra > 0,
    reached: { left: extra > 0 ? reach(left, side === "both" ? extra / 2 : extra) : [], right: extra > 0 ? reach(right, side === "both" ? extra / 2 : extra) : [] },
  };
}
