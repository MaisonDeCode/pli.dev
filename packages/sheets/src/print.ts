import type { Bounds } from "./address";
import { columnPixels, rowPixelsOf } from "./image";
import { MAX_COLS, MAX_ROWS, type HeaderFooterParts, type HeaderFooterPicture, type HeaderFooterSection, type PageSetup, type Sheet } from "./model";
import { MAX_SCALE, MIN_SCALE, marginsOf, paperPoints } from "./page";
import { notesPages, textWidthPt, type NoteLine } from "./print-more";

/*
 * Printing: which cells fall on which page. Sizes are in points (72 to the inch); a pixel on screen is three quarters of
 * a point. Pages are made as Excel makes them: the print area (or everything the sheet holds, charts and pictures
 * included), cut where a page is full or where a page break was made, with the title rows and columns repeated.
 */

/** Space the row numbers and column letters take when they are printed, in points. */
export const HEADINGS_WIDTH = 28;
export const HEADINGS_HEIGHT = 15;

export interface PrintPage {
  /** The page's number in the printout, counting from the first page number. */
  number: number;
  /** Which print range it belongs to. */
  area: number;
  /** The cells it holds. */
  range: Bounds;
  /** Rows and columns repeated at the top and left of this page (not part of `range`). */
  titleRows?: [number, number];
  titleCols?: [number, number];
  /** A page of the notes listed after the sheet (`comments: "end"`): the notes on it. It has no cells (`area` is -1). */
  notes?: NoteLine[];
}

export interface PrintLayout {
  /** The paper, in points, turned round for landscape. */
  paper: { width: number; height: number };
  /** The margins in points. */
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
  /** The percent the pages are printed at (worked out when fitting to pages). */
  scale: number;
  /** The ranges printed, in order. */
  areas: Bounds[];
  pages: PrintPage[];
  /** What fits on a page before scaling, in points: the paper less margins, divided by the scale. */
  fits: { width: number; height: number };
}

const col = (sheet: Sheet, c: number) => columnPixels(sheet, c) * 0.75;
const row = (sheet: Sheet, r: number) => rowPixelsOf(sheet, r) * 0.75;

/** The last row and column that a sheet's charts, pictures, slicers and sparklines reach. */
function objectsReach(sheet: Sheet): { r: number; c: number } {
  let r = 0;
  let c = 0;
  for (const o of [...(sheet.charts ?? []), ...(sheet.images ?? []), ...(sheet.slicers ?? []), ...(sheet.timelines ?? [])]) {
    let x = -(o.from.dx ?? 0);
    let col2 = o.from.col;
    while (col2 < MAX_COLS && x + columnPixels(sheet, col2) < o.width) x += columnPixels(sheet, col2++);
    let y = -(o.from.dy ?? 0);
    let row2 = o.from.row;
    while (row2 < MAX_ROWS && y + rowPixelsOf(sheet, row2) < o.height) y += rowPixelsOf(sheet, row2++);
    r = Math.max(r, row2);
    c = Math.max(c, col2);
  }
  // A cell with a sparkline in it is printed even if it holds nothing else.
  for (const g of sheet.sparklines ?? [])
    for (const item of g.items) {
      const m = /^([A-Z]+)(\d+)$/.exec(item.cell);
      if (!m) continue;
      r = Math.max(r, Number(m[2]));
      c = Math.max(c, [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0));
    }
  return { r, c };
}

/** What a sheet prints without a print area: every cell with something in it, and the charts and pictures. `cells` is where the cells are (spilled values included). */
export function printableRange(sheet: Sheet, cells: Bounds | null, graphics = true): Bounds | null {
  const reach = graphics ? objectsReach(sheet) : { r: 0, c: 0 };
  if (!cells && !reach.r) return null;
  return { r1: cells?.r1 ?? 1, c1: cells?.c1 ?? 1, r2: Math.max(cells?.r2 ?? 0, reach.r), c2: Math.max(cells?.c2 ?? 0, reach.c) };
}

/** Cuts a run of rows or columns into pages: where the next one wouldn't fit, and after each manual break. */
function segments(sizeOf: (i: number) => number, first: number, last: number, availFirst: number, availRest: number, manual: ReadonlySet<number>): [number, number][] {
  const out: [number, number][] = [];
  let start = first;
  let used = 0;
  for (let i = first; i <= last; i++) {
    const size = sizeOf(i);
    const avail = out.length === 0 ? availFirst : availRest;
    if (used + size > avail + 1e-6 && used > 0) {
      out.push([start, i - 1]);
      start = i;
      used = 0;
    }
    used += size;
    if (manual.has(i) && i < last) {
      out.push([start, i]);
      start = i + 1;
      used = 0;
    }
  }
  out.push([start, last]);
  return out;
}

const extent = (sizeOf: (i: number) => number, a: number, z: number) => {
  let n = 0;
  for (let i = a; i <= z; i++) n += sizeOf(i);
  return n;
};

/**
 * The last column that text running on past the cells reaches. A left-aligned (or centred) text that is wider than its cell,
 * with empty cells after it up to the last column that has anything, runs on into the columns after that, and is printed in
 * full when there is no print area.
 */
function textReach(sheet: Sheet, cells: Bounds): number {
  let reach = cells.c2;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (typeof cell.v !== "string" || cell.f !== undefined || cell.s?.wrap || cell.v.includes("\n") || cell.s?.align === "right") continue;
    const m = /^([A-Z]+)(\d+)$/.exec(address);
    if (!m) continue;
    const c = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const r = Number(m[2]);
    if (c > cells.c2 || r < cells.r1 || r > cells.r2 || cell.v.length * 2 < 40) continue;
    const need = textWidthPt(cell.v, cell.s?.fontSize ?? 11, !!cell.s?.bold) + 4;
    const own = col(sheet, c);
    if (need <= own) continue;
    // Empty cells after it, up to the last column with anything.
    let between = 0;
    let blocked = false;
    for (let x = c + 1; x <= cells.c2 && !blocked; x++) {
      const other = sheet.cells[`${columnLetters(x)}${r}`];
      if (other && (other.v !== undefined || other.f !== undefined || other.e !== undefined)) blocked = true;
      else between += col(sheet, x);
    }
    if (blocked) continue;
    // How far past the last column it reaches: all of what is wider than the cell (half of it when centred).
    const wanted = (cell.s?.align === "center" ? (need - own) / 2 : need - own) - between;
    let x = cells.c2;
    for (let got = 0; got < wanted && x < MAX_COLS; ) got += col(sheet, ++x);
    reach = Math.max(reach, x);
  }
  return reach;
}

const columnLetters = (n: number): string => {
  let out = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};

/** The pages a sheet prints on, given where its cells are. */
export function layoutPages(sheet: Sheet, cells: Bounds | null): PrintLayout {
  const page = sheet.page;
  const paper = paperPoints(page);
  const m = marginsOf(page);
  const margins = { top: m.top * 72, bottom: m.bottom * 72, left: m.left * 72, right: m.right * 72, header: m.header * 72, footer: m.footer * 72 };
  // Draft quality leaves the charts, pictures and sparklines out, so they don't make the sheet any bigger either.
  const base = printableRange(sheet, cells, !page?.draft);
  // Without a print area, text that runs on past the last cell is part of what prints.
  const whole = base && cells && !page?.printArea?.length ? { ...base, c2: Math.max(base.c2, textReach(sheet, cells)) } : base;
  const areas = page?.printArea?.length ? page.printArea.map((a) => parseBounds(a)) : whole ? [whole] : [];
  const rowSet = new Set(page?.rowBreaks ?? []);
  const colSet = new Set(page?.colBreaks ?? []);
  const none = new Set<number>();
  const fit = page?.fit;
  const headings = !!page?.headings;
  const tr = page?.titleRows;
  const tc = page?.titleCols;

  const build = (scale: number): { pages: PrintPage[]; wide: number; tall: number; fits: { width: number; height: number } } => {
    const fits = { width: (paper.width - margins.left - margins.right) / (scale / 100), height: (paper.height - margins.top - margins.bottom) / (scale / 100) };
    const availW = fits.width - (headings ? HEADINGS_WIDTH : 0);
    const availH = fits.height - (headings ? HEADINGS_HEIGHT : 0);
    const pages: PrintPage[] = [];
    let wide = 0;
    let tall = 0;
    let number = page?.firstPageNumber ?? 1;
    areas.forEach((area, index) => {
      const titleH = tr ? extent((r) => row(sheet, r), tr[0], tr[1]) : 0;
      const titleW = tc ? extent((c) => col(sheet, c), tc[0], tc[1]) : 0;
      // Title rows above the area print on its first page too; ones inside it are just part of the flow.
      const rowsBefore = !!tr && tr[1] < area.r1;
      const colsBefore = !!tc && tc[1] < area.c1;
      const rs = segments((r) => row(sheet, r), area.r1, area.r2, availH - (rowsBefore ? titleH : 0), availH - titleH, fit ? none : rowSet);
      const cs = segments((c) => col(sheet, c), area.c1, area.c2, availW - (colsBefore ? titleW : 0), availW - titleW, fit ? none : colSet);
      wide = Math.max(wide, cs.length);
      tall = Math.max(tall, rs.length);
      const make = (ri: number, ci: number): PrintPage => ({
        number: number++,
        area: index,
        range: { r1: rs[ri]![0], r2: rs[ri]![1], c1: cs[ci]![0], c2: cs[ci]![1] },
        ...(tr && (ri > 0 || rowsBefore) ? { titleRows: tr } : {}),
        ...(tc && (ci > 0 || colsBefore) ? { titleCols: tc } : {}),
      });
      if (page?.order === "over") for (let ri = 0; ri < rs.length; ri++) for (let ci = 0; ci < cs.length; ci++) pages.push(make(ri, ci));
      else for (let ci = 0; ci < cs.length; ci++) for (let ri = 0; ri < rs.length; ri++) pages.push(make(ri, ci));
    });
    return { pages, wide, tall, fits };
  };

  let scale = page?.scale ?? 100;
  if (fit) {
    // The largest size, up to 100%, at which it fits in as many pages as were asked for.
    scale = MIN_SCALE;
    for (let s = 100; s >= MIN_SCALE; s--) {
      const r = build(s);
      if ((fit.wide === 0 || r.wide <= fit.wide) && (fit.tall === 0 || r.tall <= fit.tall)) {
        scale = s;
        break;
      }
    }
  }
  scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  const done = build(scale);
  // Notes printed "at the end of the sheet" take pages of their own after the cells.
  const pages = page?.comments === "end" ? [...done.pages, ...notesPages(sheet, done.fits, (page.firstPageNumber ?? 1) + done.pages.length)] : done.pages;
  return { paper, margins, scale, areas, pages, fits: done.fits };
}

function parseBounds(range: string): Bounds {
  const [a, b = a] = range.split(":");
  const cell = (ref: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    return { col: [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), row: Number(m[2]) };
  };
  const p = cell(a!);
  const q = cell(b!);
  return { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) };
}

// ---- headers and footers ----

/** A piece of a header or footer text, with how it is to look. */
export interface HeaderFooterRun {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  /** Points. */
  size?: number;
  font?: string;
  /** `#rrggbb`. */
  color?: string;
  /** A picture, where the `&G` code was (the run has no text). */
  picture?: HeaderFooterPicture;
}

export interface HeaderFooterContext {
  page: number;
  pages: number;
  /** The workbook's title, for `&F`. */
  file: string;
  /** The sheet's name, for `&A`. */
  sheet: string;
  now: Date;
  /** The picture the `&G` code in this text stands for. */
  picture?: HeaderFooterPicture;
}

const two = (n: number) => String(n).padStart(2, "0");

/** The runs a header or footer text makes: its codes (`&P`, `&B`, `&14`…) worked out and its styles applied. */
export function headerFooterRuns(text: string, ctx: HeaderFooterContext): HeaderFooterRun[] {
  const out: HeaderFooterRun[] = [];
  const style: { bold: boolean; italic: boolean; underline: boolean; strike: boolean; size?: number; font?: string; color?: string } = { bold: false, italic: false, underline: false, strike: false };
  let buf = "";
  const flush = () => {
    if (buf === "") return;
    out.push({ text: buf, ...(style.bold ? { bold: true as const } : {}), ...(style.italic ? { italic: true as const } : {}), ...(style.underline ? { underline: true as const } : {}), ...(style.strike ? { strike: true as const } : {}), ...(style.size ? { size: style.size } : {}), ...(style.font ? { font: style.font } : {}), ...(style.color ? { color: style.color } : {}) });
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== "&") {
      buf += ch;
      continue;
    }
    const next = text[++i];
    if (next === undefined) break;
    const code = next.toUpperCase();
    if (next === "&") buf += "&";
    else if (code === "P") buf += String(ctx.page);
    else if (code === "N") buf += String(ctx.pages);
    else if (code === "D") buf += `${ctx.now.getMonth() + 1}/${ctx.now.getDate()}/${ctx.now.getFullYear()}`;
    else if (code === "T") buf += `${ctx.now.getHours() % 12 || 12}:${two(ctx.now.getMinutes())} ${ctx.now.getHours() < 12 ? "AM" : "PM"}`;
    else if (code === "F") buf += ctx.file;
    else if (code === "A") buf += ctx.sheet;
    else if (code === "G") {
      if (ctx.picture) {
        flush();
        out.push({ text: "", picture: ctx.picture });
      }
    } else if (code === "B") (flush(), (style.bold = !style.bold));
    else if (code === "I") (flush(), (style.italic = !style.italic));
    else if (code === "U") (flush(), (style.underline = !style.underline));
    else if (code === "S") (flush(), (style.strike = !style.strike));
    else if (next === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) break;
      flush();
      const font = text.slice(i + 1, end).split(",")[0]!.trim();
      if (font) style.font = font;
      else delete style.font;
      i = end;
    } else if (/\d/.test(next)) {
      let j = i;
      while (j + 1 < text.length && /\d/.test(text[j + 1]!)) j++;
      flush();
      const size = Number(text.slice(i, j + 1));
      if (size >= 1 && size <= 409) style.size = size;
      i = j;
    } else if (code === "K") {
      const hex = /^[0-9a-fA-F]{6}/.exec(text.slice(i + 1, i + 7))?.[0];
      if (hex) {
        flush();
        style.color = `#${hex.toLowerCase()}`;
        i += 6;
      }
    }
    // &X, &Y and anything else are left out.
  }
  flush();
  return out;
}

/** Which header (or footer) a page gets: the first page's, an even page's, or the usual. */
export function headerFooterFor(page: PageSetup | undefined, kind: "header" | "footer", pageNumber: number, firstNumber: number): HeaderFooterParts | undefined {
  if (!page) return undefined;
  const first = kind === "header" ? page.firstHeader : page.firstFooter;
  const even = kind === "header" ? page.evenHeader : page.evenFooter;
  const usual = kind === "header" ? page.header : page.footer;
  if (page.differentFirstPage && pageNumber === firstNumber) return first;
  if (page.differentOddEven && pageNumber % 2 === 0) return even;
  return usual;
}

/** Which of the six headers and footers a page gets, by name (see `headerFooterFor`). */
export function headerFooterSectionFor(page: PageSetup | undefined, kind: "header" | "footer", pageNumber: number, firstNumber: number): HeaderFooterSection {
  if (page?.differentFirstPage && pageNumber === firstNumber) return kind === "header" ? "firstHeader" : "firstFooter";
  if (page?.differentOddEven && pageNumber % 2 === 0) return kind === "header" ? "evenHeader" : "evenFooter";
  return kind;
}
