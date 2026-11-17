import { categoryOf, isMonospace, lookupFont, widthFactor as coreWidthFactor } from "@pli.dev/core";
import { toPdf, type PdfClip, type PdfFont, type PdfImage, type PdfItem, type PdfLink, type PdfPage } from "@pli.dev/docs";
import { axisOffsetPx } from "./image";
import type { Chart, HeaderFooterPicture, IconSetName, Sheet, SheetImage } from "./model";
import type { HeaderFooterRun, PrintLayout, PrintPage } from "./print";
import { NOTE_LINE, NOTE_SIZE, noteLines, textWidthPt, type PrintedCell, type PrintedNote } from "./print-more";
import { pdfPicture } from "./print-pdf-image";
import { canDrawChart, chartPdfItems } from "./print-pdf-chart";
import { svgToPdfItems } from "./print-pdf-vector";
import { iconSvg } from "./cfhtml";
import type { PrintedPage, SheetSession } from "./session";

/*
 * Pages as a PDF file, drawn from the same pieces the print preview is made of (`printLayout` and `printPage`), without the
 * browser's print dialog. Text is set in the standard PDF fonts, stretched to the width Calibri would give it (as the
 * preview's text-running-on decisions are made with those widths), cut off at the edges of its cell. What a PDF writer can't draw
 * itself, charts and the icons of conditional formats, is drawn by the host's `rasterize`; without it a chart is a frame with its title.
 */

/** What the host is asked to draw as pixels, for the things a PDF can't hold as lines and text. */
export type PdfRasterRequest =
  | { kind: "chart"; sheet: string; chart: Chart; /** In pixels on the sheet. */ width: number; height: number }
  | { kind: "icon"; set: IconSetName; index: number; count: number; /** In pixels. */ size: number };

/** Draws a chart or an icon as pixels (a browser draws it in a canvas), or gives undefined when it can't. */
export type PdfRasterizer = (request: PdfRasterRequest) => Promise<PdfImage | undefined> | PdfImage | undefined;

export interface PrintPdfOptions {
  /** Draw the pictures that `IMAGE` formulas fetch from the web (they are not fetched by this, so they stay out of the file). */
  remoteImages?: boolean;
  /** Only these pages, by their place in the printout (1 is the first). Left out: all of them. */
  pages?: readonly number[];
  title?: string;
  author?: string;
  /** The date written in the file; the same pages always make the same bytes when this is given. */
  date?: Date;
  rasterize?: PdfRasterizer;
  /** TrueType fonts to embed (see `toPdf`), so that text in another script comes out. */
  fonts?: Record<string, Uint8Array>;
}

export interface PrintPdfResult {
  bytes: Uint8Array;
  /** How many pages the file has. */
  pages: number;
  /** What could not be drawn as it is on the screen, in words. */
  warnings: string[];
}

const DEFAULT_FONT = "Calibri";
const HEADING_FILL = "#f0f0f0";
const HEADING_LINE = "#999999";
const GRID_LINE = "#bfbfbf";
/** Excel's lines in points: a pixel is 0.75pt. */
const LINE_WIDTH = { thin: 0.75, medium: 1.5, thick: 2.25, dashed: 0.75, dotted: 0.75, double: 2.25, hair: 0.25 } as const;

/**
 * How wide a font's text is compared with Calibri's (the widths text is measured with). The names Pli has always told apart by
 * their spelling keep their numbers; a name that says nothing (`Lora`, `Inconsolata`, `Roboto Condensed`) is looked up in the
 * font catalogue, which knows its kind and whether it is a narrow or wide cut.
 */
export function widthFactor(family: string | undefined): number {
  if (!family || /calibri|aptos|carlito/i.test(family)) return 1;
  if (/courier|consolas|mono|menlo/i.test(family)) return 1.25;
  if (/times|georgia|cambria|garamond|palatino|serif/i.test(family) && !/sans/i.test(family)) return 1.02;
  const known = lookupFont(family);
  if (!known) return 1.13;
  // The catalogue's own number is against Helvetica and says 0.82 for a condensed cut and 1.18 for an extended one.
  const cut = coreWidthFactor(family);
  const stretch = cut === 0.82 || cut === 1.18 ? cut : 1;
  if (isMonospace(family)) return 1.25 * stretch;
  return (categoryOf(family) === "serif" ? 1.02 : 1.13) * stretch;
}

const measure = (text: string, size: number, bold: boolean, family?: string) => textWidthPt(text, size, bold) * widthFactor(family);

/** The lines a text breaks into at a width (points): at the line breaks it has, and, when wrapping, at spaces (or anywhere in a word too long to fit). */
function breakLines(text: string, width: number, size: number, bold: boolean, family: string | undefined, wrap: boolean): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!wrap) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(?<= )/)) {
      if (line !== "" && measure((line + word).trimEnd(), size, bold, family) > width) {
        out.push(line.trimEnd());
        line = "";
      }
      // A word wider than the line is broken wherever it fits.
      let rest = word;
      while (measure(rest.trimEnd(), size, bold, family) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n), size, bold, family) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line += rest;
    }
    out.push(line.trimEnd());
  }
  return out;
}

const intersect = (a: PdfClip, b: PdfClip): PdfClip => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};
const within = (a: PdfClip, b: PdfClip) => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.width <= b.x + b.width + 0.01 && a.y + a.height <= b.y + b.height + 0.01;

/** The grey a `#rrggbb` prints as on a black and white printout. */
function grayOf(hex: string): string {
  const v = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!v) return hex;
  const g = Math.round(0.3 * parseInt(v.slice(0, 2), 16) + 0.59 * parseInt(v.slice(2, 4), 16) + 0.11 * parseInt(v.slice(4, 6), 16)).toString(16).padStart(2, "0");
  return `#${g}${g}${g}`;
}

/** `#rrggbb` mixed with white by a fraction (0 is the colour, 1 is white). */
function lighter(color: string, t: number): string {
  const p = (i: number) => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(p(i) + (255 - p(i)) * t).toString(16).padStart(2, "0")).join("");
}

/** Pixels in shades of grey (black and white printing). */
function grayImage(image: PdfImage): PdfImage {
  if (!("rgba" in image)) return image;
  const data = new Uint8Array(image.rgba);
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
    data[i] = data[i + 1] = data[i + 2] = g;
  }
  return { rgba: data, width: image.width, height: image.height };
}

/** The sheet's pixels from its corner to a cell's top left, plus a little way in. */
const offsetOf = (sheet: Sheet, row: number, col: number, dx = 0, dy = 0) => ({ x: axisOffsetPx(sheet, "col", col) + dx, y: axisOffsetPx(sheet, "row", row) + dy });

/**
 * Makes the PDF for a sheet's printout: every page `printLayout` lays out (or the ones asked for), with their cells, gridlines and
 * headings, text running on over empty cells, pictures, charts, notes shown over the sheet or listed at the end, headers and footers
 * (with their pictures), at the sheet's paper size, margins and scale, in black and white or draft quality when the setup says so.
 */
export async function printToPdf(session: SheetSession, sheetId: string, options: PrintPdfOptions = {}): Promise<PrintPdfResult> {
  const sheet = session.state.sheets.find((s) => s.id === sheetId || s.name === sheetId);
  if (!sheet) throw new Error(`There is no sheet "${sheetId}"`);
  const layout = session.printLayout(sheet.id);
  const warnings: string[] = [];
  const warned = new Set<string>();
  const warn = (message: string) => {
    if (!warned.has(message)) {
      warned.add(message);
      warnings.push(message);
    }
  };
  const wanted = options.pages ? new Set(options.pages) : null;
  const pages: PdfPage[] = [];
  const icons = new Map<string, PdfImage | null>();
  const iconFor = async (set: IconSetName, index: number, count: number): Promise<PdfImage | null> => {
    const key = `${set}:${index}:${count}`;
    if (!icons.has(key)) {
      let image: PdfImage | undefined;
      try {
        image = options.rasterize ? await options.rasterize({ kind: "icon", set, index, count, size: 28 }) : undefined;
      } catch {
        image = undefined;
      }
      icons.set(key, image ?? null);
    }
    return icons.get(key) ?? null;
  };
  for (let i = 0; i < layout.pages.length; i++) {
    if (wanted && !wanted.has(i + 1)) continue;
    const page = layout.pages[i]!;
    const printed = session.printPage(sheet.id, page, { remoteImages: !!options.remoteImages, scene: true });
    pages.push(await drawPage({ session, sheet, layout, page, printed, options, warn, iconFor }));
  }
  const bytes = toPdf(pages, { ...(options.title !== undefined ? { title: options.title } : { title: session.state.title }), ...(options.author ? { author: options.author } : {}), ...(options.date ? { date: options.date } : {}), ...(options.fonts ? { fonts: options.fonts } : {}), warnings });
  return { bytes, pages: pages.length, warnings };
}

interface Context {
  session: SheetSession;
  sheet: Sheet;
  layout: PrintLayout;
  page: PrintPage;
  printed: PrintedPage;
  options: PrintPdfOptions;
  warn(message: string): void;
  iconFor(set: IconSetName, index: number, count: number): Promise<PdfImage | null>;
}

async function drawPage(cx: Context): Promise<PdfPage> {
  const { session, sheet, layout, page, printed, options, warn } = cx;
  const setup = sheet.page;
  const mono = !!setup?.blackAndWhite;
  const { paper, margins, scale } = layout;
  const k = scale / 100;
  const availW = paper.width - margins.left - margins.right;
  const availH = paper.height - margins.top - margins.bottom;
  const content: PdfClip = { x: margins.left, y: margins.top, width: availW, height: availH };
  const left = setup?.centerHorizontally ? Math.max(0, (availW - printed.width * k) / 2) : 0;
  const top = setup?.centerVertically ? Math.max(0, (availH - printed.height * k) / 2) : 0;
  /** Where the page's content (the table, in points) starts on the paper. */
  const ox = margins.left + left;
  const oy = margins.top + top;
  const X = (x: number) => ox + k * x;
  const Y = (y: number) => oy + k * y;
  const items: PdfItem[] = [];
  const links: PdfLink[] = [];
  /** `bounds` is where the item is: one that reaches past the page's content area is cut off there (headers and footers, which are in the margins, say `free`). */
  const add = (item: PdfItem, bounds?: PdfClip, clip?: PdfClip, free = false) => {
    if (free) {
      items.push(item);
      return;
    }
    if (item.type === "image") {
      items.push(item);
      return;
    }
    let final = clip ? intersect(clip, content) : bounds && !within(bounds, content) ? content : undefined;
    if (clip && !final) final = clip;
    items.push(final ? { ...item, clip: final } : item);
  };
  const text = (value: string, x: number, baseline: number, size: number, o: { bold?: boolean; italic?: boolean; font?: string; color?: string; clip?: PdfClip; width?: number; free?: boolean }) => {
    if (value === "") return;
    const font: PdfFont = { family: o.font ?? DEFAULT_FONT, ...(o.bold ? { bold: true } : {}), ...(o.italic ? { italic: true } : {}) };
    const width = o.width ?? measure(value, size, !!o.bold, o.font) * 1;
    add({ type: "text", x, y: baseline, text: value, font, size, ...(o.color ? { color: o.color } : {}), width: Math.max(0.5, width) }, { x, y: baseline - size, width, height: size * 1.3 }, o.clip, o.free);
  };

  // ---- the notes listed after the sheet ----
  if (page.notes) {
    let y = 0;
    for (const note of page.notes) {
      const full = `Cell ${note.cell}: ${note.text}`;
      const lines = breakLines(full, layout.fits.width, NOTE_SIZE, false, undefined, true);
      lines.forEach((line, n) => {
        const base = Y(y + n * NOTE_LINE + NOTE_SIZE * 0.95);
        if (n === 0) {
          const head = `Cell ${note.cell}:`;
          const split = line.startsWith(head) ? head : "";
          if (split) {
            text(split, X(0), base, NOTE_SIZE * k, { bold: true });
            const rest = line.slice(split.length);
            text(rest, X(0) + measure(split, NOTE_SIZE, true) * k, base, NOTE_SIZE * k, {});
            return;
          }
        }
        text(line, X(0), base, NOTE_SIZE * k, {});
      });
      y += noteLines(full, layout.fits.width) * NOTE_LINE + 6;
    }
    headersAndFooters();
    return { width: paper.width, height: paper.height, items, ...(links.length ? { links } : {}) };
  }

  const scene = printed.scene!;
  const hw = scene.headings?.width ?? 0;
  const hh = scene.headings?.height ?? 0;
  const cellRect = (c: PrintedCell): PdfClip => ({ x: X(hw + c.x), y: Y(hh + c.y), width: c.width * k, height: c.height * k });

  // Fills first, then bars and icons, so that gridlines, borders and text lie over them.
  for (const c of scene.cells) {
    const r = cellRect(c);
    if (c.fill) add({ type: "rect", ...r, fill: c.fill }, r);
  }
  for (const c of scene.cells) {
    const r = cellRect(c);
    if (c.bar) {
      const x0 = r.x + c.bar.from * r.width;
      const w = (c.bar.to - c.bar.from) * r.width;
      add({ type: "rect", x: x0, y: r.y + 1, width: w, height: Math.max(0, r.height - 2), fill: mono ? "#000000" : lighter(c.bar.color, 0.25) }, r);
      if (c.bar.axis !== undefined) add({ type: "line", x1: r.x + c.bar.axis * r.width, y1: r.y, x2: r.x + c.bar.axis * r.width, y2: r.y + r.height, color: c.bar.axisColor ?? "#808080", width: 0.5 }, r);
    }
    if (c.icon) {
      // Icons are drawn as lines and curves in the file itself (no canvas, sharp at any size).
      const size = 10.5 * k;
      const at = { x: r.x + 3 * k, y: r.y + (r.height - size) / 2, width: size, height: size };
      for (const part of svgToPdfItems(iconSvg(c.icon.set, c.icon.index, c.icon.count, 16), at, mono ? grayOf : undefined)) add(part, r, r);
    }
  }

  // Gridlines, once for each edge, except where the cell has a line of its own there.
  if (scene.gridlines) {
    const seen = new Set<string>();
    const edge = (key: string, x1: number, y1: number, x2: number, y2: number) => {
      if (seen.has(key)) return;
      seen.add(key);
      add({ type: "line", x1, y1, x2, y2, color: GRID_LINE, width: 0.5 * k }, { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
    };
    for (const c of scene.cells) {
      const r = cellRect(c);
      const f = (n: number) => Math.round(n * 100);
      if (!c.borders.top) edge(`h${f(r.y)}:${f(r.x)}:${f(r.width)}`, r.x, r.y, r.x + r.width, r.y);
      if (!c.borders.bottom) edge(`h${f(r.y + r.height)}:${f(r.x)}:${f(r.width)}`, r.x, r.y + r.height, r.x + r.width, r.y + r.height);
      if (!c.borders.left) edge(`v${f(r.x)}:${f(r.y)}:${f(r.height)}`, r.x, r.y, r.x, r.y + r.height);
      if (!c.borders.right) edge(`v${f(r.x + r.width)}:${f(r.y)}:${f(r.height)}`, r.x + r.width, r.y, r.x + r.width, r.y + r.height);
    }
  }

  // The lines of the cells.
  for (const c of scene.cells) {
    const r = cellRect(c);
    const side = (b: NonNullable<PrintedCell["borders"]["top"]>, x1: number, y1: number, x2: number, y2: number, dx: number, dy: number) => {
      const w = LINE_WIDTH[b.style] * k;
      const dash = b.style === "dashed" ? [3 * k, 2 * k] : b.style === "dotted" ? [0.75 * k, 1.25 * k] : b.style === "hair" ? [0.5 * k, 0.75 * k] : undefined;
      const color = mono ? "#000000" : b.color;
      const bounds = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      if (b.style === "double") {
        for (const s of [-1, 1]) add({ type: "line", x1: x1 + dx * s * 0.75 * k, y1: y1 + dy * s * 0.75 * k, x2: x2 + dx * s * 0.75 * k, y2: y2 + dy * s * 0.75 * k, color, width: 0.75 * k }, bounds);
      } else add({ type: "line", x1, y1, x2, y2, color, width: w, ...(dash ? { dash } : {}) }, bounds);
    };
    const b = c.borders;
    if (b.top) side(b.top, r.x, r.y, r.x + r.width, r.y, 0, 1);
    if (b.bottom) side(b.bottom, r.x, r.y + r.height, r.x + r.width, r.y + r.height, 0, 1);
    if (b.left) side(b.left, r.x, r.y, r.x, r.y + r.height, 1, 0);
    if (b.right) side(b.right, r.x + r.width, r.y, r.x + r.width, r.y + r.height, 1, 0);
    if (b.diagonalDown) side(b.diagonalDown, r.x, r.y, r.x + r.width, r.y + r.height, 0, 0);
    if (b.diagonalUp) side(b.diagonalUp, r.x, r.y + r.height, r.x + r.width, r.y, 0, 0);
  }

  // Pictures in cells and sparklines.
  for (const c of scene.cells) {
    if (c.picture) {
      if (!c.picture.src.startsWith("data:")) {
        warn("A picture fetched from the web is not put in the PDF file");
        continue;
      }
      const r = cellRect(c);
      const made = pdfPicture(c.picture.src, { grayscale: mono }, c.width / 0.75, c.height / 0.75);
      if (!made) {
        warn("A picture of a kind the PDF can't hold (a GIF) was left out");
        continue;
      }
      made.skipped.forEach(warn);
      // Fitted into the cell, as `object-fit: contain` does.
      const s = Math.min(r.width / made.image.width, r.height / made.image.height);
      const w = made.image.width * s;
      const h = made.image.height * s;
      add({ type: "image", x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, width: w, height: h, image: made.image, clip: intersect(r, content) });
    }
    const spark = scene.sparklines[`${c.row}:${c.col}`];
    if (spark) {
      const r = cellRect(c);
      const sx = (r.width / spark.width) || 1;
      const sy = (r.height / spark.height) || 1;
      const color = (v: string) => (mono ? "#000000" : v);
      if (spark.axis !== undefined) add({ type: "line", x1: r.x, y1: r.y + spark.axis * sy, x2: r.x + r.width, y2: r.y + spark.axis * sy, color: color(spark.axisColor ?? "#000000"), width: 0.5 * k }, r, r);
      if (spark.kind === "bars") for (const b of spark.bars) add({ type: "rect", x: r.x + b.x * sx, y: r.y + b.y * sy, width: Math.max(0.3, b.w * sx), height: Math.max(0.3, b.h * sy), fill: color(b.color) }, r, r);
      else {
        for (const run of spark.lines) {
          if (run.length === 1) add({ type: "rect", x: r.x + run[0]![0] * sx - 1, y: r.y + run[0]![1] * sy - 1, width: 2, height: 2, fill: color(spark.color) }, r, r);
          for (let i = 1; i < run.length; i++) add({ type: "line", x1: r.x + run[i - 1]![0] * sx, y1: r.y + run[i - 1]![1] * sy, x2: r.x + run[i]![0] * sx, y2: r.y + run[i]![1] * sy, color: color(spark.color), width: spark.weight * 0.75 * k }, r, r);
        }
        for (const d of spark.dots) add({ type: "rect", x: r.x + d.x * sx - 1.3, y: r.y + d.y * sy - 1.3, width: 2.6, height: 2.6, fill: color(d.color) }, r, r);
      }
    }
  }

  // The text of the cells.
  for (const c of scene.cells) {
    if (c.text === "") continue;
    const r = cellRect(c);
    const size = c.size * k;
    const pad = 2 * k;
    const indent = (c.indent * 6.75) * k;
    // The room the text has: the cell, and the empty cells it runs on into.
    const x0 = r.x - (c.room?.left ?? 0) * k;
    const x1 = r.x + r.width + (c.room?.right ?? 0) * k;
    const inner0 = x0 + pad + (c.align !== "right" ? indent : 0);
    const inner1 = x1 - pad - (c.align === "right" ? indent : 0);
    const ink = mono ? undefined : c.color;
    const lines = breakLines(c.text, (inner1 - inner0) / k, c.size, !!c.bold, c.font, c.wrap);
    const lineH = size * 1.15;
    const total = lines.length * lineH;
    const startY = c.vAlign === "top" ? r.y : c.vAlign === "middle" ? r.y + (r.height - total) / 2 : r.y + r.height - total;
    const box: PdfClip = { x: x0, y: r.y, width: x1 - x0, height: r.height };
    lines.forEach((line, n) => {
      const tw = measure(line, c.size, !!c.bold, c.font) * k;
      let x = c.align === "right" ? inner1 - tw : c.align === "center" ? (inner0 + inner1) / 2 - tw / 2 : inner0;
      x = Math.max(inner0, x);
      const base = startY + n * lineH + size * 0.825;
      const fits = tw <= inner1 - inner0 + 0.5 && total <= r.height + 0.5;
      text(line, x, base, size, { bold: !!c.bold, italic: !!c.italic, ...(c.font ? { font: c.font } : {}), ...(ink ? { color: ink } : {}), width: tw, ...(fits ? {} : { clip: box }) });
      if (c.underline) add({ type: "line", x1: x, y1: base + size * 0.12, x2: x + tw, y2: base + size * 0.12, color: ink ?? "#000000", width: Math.max(0.4, size * 0.06) }, box, fits ? undefined : box);
      if (c.strike) add({ type: "line", x1: x, y1: base - size * 0.28, x2: x + tw, y2: base - size * 0.28, color: ink ?? "#000000", width: Math.max(0.4, size * 0.06) }, box, fits ? undefined : box);
    });
    if (c.link && /^(https?:|mailto:|tel:)/i.test(c.link)) links.push({ x: r.x, y: r.y, width: r.width, height: r.height, url: c.link });
  }

  // Headings: the row numbers down the left and the column letters along the top.
  if (scene.headings) {
    const letters = (n: number) => {
      let out = "";
      for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
      return out;
    };
    const corner: PdfClip = { x: X(0), y: Y(0), width: hw * k, height: hh * k };
    add({ type: "rect", ...corner, fill: HEADING_FILL, stroke: HEADING_LINE, strokeWidth: 0.5 * k }, corner);
    for (const col of scene.cols) {
      const r: PdfClip = { x: X(hw + col.x), y: Y(0), width: col.width * k, height: hh * k };
      add({ type: "rect", ...r, fill: HEADING_FILL, stroke: HEADING_LINE, strokeWidth: 0.5 * k }, r);
      const label = letters(col.col);
      const tw = measure(label, 9, false) * k;
      text(label, r.x + (r.width - tw) / 2, r.y + r.height / 2 + 9 * k * 0.35, 9 * k, { width: tw, clip: r });
    }
    for (const row of scene.rows) {
      const r: PdfClip = { x: X(0), y: Y(hh + row.y), width: hw * k, height: row.height * k };
      add({ type: "rect", ...r, fill: HEADING_FILL, stroke: HEADING_LINE, strokeWidth: 0.5 * k }, r);
      const label = String(row.row);
      const tw = measure(label, 9, false) * k;
      text(label, r.x + (r.width - tw) / 2, r.y + r.height - 2 * k, 9 * k, { width: tw, clip: r });
    }
  }

  // Pictures and charts over the cells, cut off at the edge of the page's cells.
  const main: PdfClip = { x: X(printed.main.x), y: Y(printed.main.y), width: printed.main.width * k, height: printed.main.height * k };
  const mainPx = { w: printed.main.width / 0.75, h: printed.main.height / 0.75 };
  const box = (o: { from: SheetImage["from"]; width: number; height: number }) => {
    const at = offsetOf(sheet, o.from.row, o.from.col, o.from.dx, o.from.dy);
    return { x: at.x - printed.origin.x, y: at.y - printed.origin.y, w: o.width, h: o.height };
  };
  if (printed.graphics) {
    for (const image of sheet.images ?? []) {
      const b = box(image);
      if (b.x > mainPx.w || b.y > mainPx.h || b.x + b.w < 0 || b.y + b.h < 0) continue;
      drawImage(image, b);
    }
    for (const chart of sheet.charts ?? []) {
      const b = box(chart);
      if (b.x > mainPx.w || b.y > mainPx.h || b.x + b.w < 0 || b.y + b.h < 0) continue;
      const r: PdfClip = { x: main.x + b.x * 0.75 * k, y: main.y + b.y * 0.75 * k, width: b.w * 0.75 * k, height: b.h * 0.75 * k };
      // A chart of a common kind is drawn here, as lines, rectangles and text; others come from the host's `rasterize`.
      if (canDrawChart(chart)) {
        const drawn = chartPdfItems(chart, session.chartData(sheet.id, chart.id), r, mono ? (c) => grayOf(c) : undefined);
        if (drawn) {
          add({ type: "rect", ...r, fill: "#ffffff", stroke: mono ? "#000000" : "#d9d9d9", strokeWidth: 0.75 * k }, r, intersect(r, main));
          for (const part of drawn) add(part, r, intersect(r, main));
          continue;
        }
      }
      let image: PdfImage | undefined;
      try {
        image = options.rasterize ? await options.rasterize({ kind: "chart", sheet: sheet.id, chart, width: b.w, height: b.h }) : undefined;
      } catch {
        image = undefined;
      }
      if (image) add({ type: "image", x: r.x, y: r.y, width: r.width, height: r.height, image: mono ? grayImage(image) : image, clip: intersect(r, main) });
      else {
        warn(`A ${chart.type} chart is drawn by the host (the \`rasterize\` option); without it it is a frame with its title here`);
        add({ type: "rect", ...r, stroke: mono ? "#000000" : "#808080", strokeWidth: 0.75 * k }, r, main);
        const title = chart.title ?? "Chart";
        text(title, r.x + 6 * k, r.y + 16 * k, 11 * k, { bold: true, clip: intersect(r, main) });
      }
    }
  }

  function drawImage(image: SheetImage, b: { x: number; y: number; w: number; h: number }): void {
    const scalePx = 0.75 * k;
    const box0: PdfClip = { x: main.x + b.x * scalePx, y: main.y + b.y * scalePx, width: b.w * scalePx, height: b.h * scalePx };
    const care = {
      ...(image.crop ? { crop: image.crop } : {}),
      ...(image.flipH ? { flipH: true } : {}),
      ...(image.flipV ? { flipV: true } : {}),
      ...(image.rotation ? { rotation: image.rotation } : {}),
      ...(image.brightness ? { brightness: image.brightness } : {}),
      ...(image.contrast ? { contrast: image.contrast } : {}),
      ...(image.grayscale || mono ? { grayscale: true } : {}),
      ...(image.artistic ? { artistic: image.artistic } : {}),
    };
    const made = pdfPicture(image.src, care, b.w, b.h);
    if (!made) {
      warn("A picture of a kind the PDF can't hold (a GIF) was left out");
      return;
    }
    made.skipped.forEach(warn);
    if (image.glow || image.softEdge || image.reflection) warn("A picture's glow, soft edges and reflection are not in the PDF file");
    const turned = !!image.rotation && made.turned;
    if (image.shadow && !turned) {
      const a = ((image.shadow.angle ?? 45) * Math.PI) / 180;
      const d = (image.shadow.distance ?? 4) * scalePx;
      add({ type: "rect", x: box0.x + d * Math.cos(a), y: box0.y + d * Math.sin(a), width: box0.width, height: box0.height, fill: lighter(image.shadow.color ?? "#000000", 1 - (image.shadow.opacity ?? 0.4) * 0.8) }, box0, main);
    }
    if (turned) {
      const rad = ((image.rotation ?? 0) * Math.PI) / 180;
      const bw = (Math.abs(b.w * Math.cos(rad)) + Math.abs(b.h * Math.sin(rad))) * scalePx;
      const bh = (Math.abs(b.w * Math.sin(rad)) + Math.abs(b.h * Math.cos(rad))) * scalePx;
      const cxm = box0.x + box0.width / 2;
      const cym = box0.y + box0.height / 2;
      add({ type: "image", x: cxm - bw / 2, y: cym - bh / 2, width: bw, height: bh, image: made.image, clip: main });
    } else add({ type: "image", x: box0.x, y: box0.y, width: box0.width, height: box0.height, image: made.image, clip: intersect(box0, main) });
    if (image.border && !turned) {
      const w = ((image.border.width ?? 1) * 0.75) * k;
      add({ type: "rect", ...box0, stroke: mono ? "#000000" : image.border.color, strokeWidth: w }, box0, main);
    }
  }

  // Notes kept showing, as their boxes.
  for (const n of printed.notes) drawNote(n);
  function drawNote(n: PrintedNote): void {
    const r: PdfClip = { x: main.x + n.x * k, y: main.y + n.y * k, width: n.width * k, height: n.height * k };
    if (!mono) add({ type: "rect", x: r.x + 1.5 * k, y: r.y + 1.5 * k, width: r.width, height: r.height, fill: "#c8c8c8" }, r, main);
    add({ type: "rect", ...r, fill: mono ? "#ffffff" : "#ffffe1", stroke: "#000000", strokeWidth: 0.75 * k }, r, main);
    const size = 9 * k;
    const padX = 4 * k;
    const clip = intersect(r, main);
    // The author in bold in front, then the text with the look of its runs, broken into lines to fit the box.
    const runs = n.runs ?? [{ text: n.text }];
    let y = r.y + 3 * k + size * 0.95;
    const lineH = 11.5 * k;
    const width = (r.width - 2 * padX) / k;
    if (n.author) {
      text(`${n.author}:`, r.x + padX, y, size, { bold: true, font: "Tahoma", clip });
      y += lineH;
    }
    // Lay the runs out word by word into lines, then draw each stretch of one look on a line as one piece of text.
    type Piece = { run: (typeof runs)[number]; text: string; x: number; w: number };
    const rows: Piece[][] = [[]];
    let x = 0;
    const face = (run: (typeof runs)[number]) => ({ size: run.size ?? 9, bold: !!run.bold, font: run.font ?? "Tahoma" });
    const newLine = () => {
      rows.push([]);
      x = 0;
    };
    for (const run of runs)
      for (const [i, part] of run.text.split("\n").entries()) {
        if (i > 0) newLine();
        for (const word of part.split(/(?<= )/)) {
          if (word === "") continue;
          const f = face(run);
          const w = measure(word, f.size, f.bold, f.font);
          if (x > 0 && x + measure(word.trimEnd(), f.size, f.bold, f.font) > width) newLine();
          const line = rows[rows.length - 1]!;
          const last = line[line.length - 1];
          if (last && last.run === run) {
            last.text += word;
            last.w += w;
          } else line.push({ run, text: word, x, w });
          x += w;
        }
      }
    rows.forEach((line, n) => {
      for (const piece of line) {
        const f = face(piece.run);
        text(piece.text, r.x + padX + piece.x * k, y + n * lineH, f.size * k, { bold: !!piece.run.bold, italic: !!piece.run.italic, font: f.font, ...(piece.run.color && !mono ? { color: piece.run.color } : {}), width: piece.w * k, clip });
      }
    });
  }

  headersAndFooters();
  return { width: paper.width, height: paper.height, items, ...(links.length ? { links } : {}) };

  /** Headers and footers: three parts each, in the margins, not scaled. */
  function headersAndFooters(): void {
    const parts = (kind: "header" | "footer", runs: PrintedPage["header"]) => {
      const x0 = margins.left;
      const third = availW / 3;
      for (const [index, at] of (["left", "center", "right"] as const).entries()) {
        const list = runs[at];
        if (!list.length) continue;
        const sized = list.map((r) => ({ r, size: r.size ?? 9 }));
        const widths = sized.map(({ r, size }) => (r.picture ? r.picture.width : measure(r.text, size, !!r.bold, r.font)));
        const total = widths.reduce((a, b) => a + b, 0);
        const lineSize = Math.max(9, ...sized.filter(({ r }) => !r.picture).map(({ size }) => size));
        const height = Math.max(lineSize * 1.2, ...sized.map(({ r }) => r.picture?.height ?? 0));
        const regionX = x0 + index * third;
        let x = at === "left" ? regionX : at === "center" ? regionX + (third - total) / 2 : regionX + third - total;
        const topY = kind === "header" ? margins.header : paper.height - margins.footer - height;
        sized.forEach(({ r, size }, i) => {
          const w = widths[i]!;
          if (r.picture) drawHeaderPicture(r.picture, x, topY, kind === "footer" ? height - r.picture.height : 0);
          else if (r.text !== "") {
            const base = topY + (height - size * 1.2) / 2 + size * 0.95;
            text(r.text, x, base, size, { bold: !!r.bold, italic: !!r.italic, ...(r.font ? { font: r.font } : {}), ...(r.color && !mono ? { color: r.color } : {}), width: w, free: true });
            if (r.underline) add({ type: "line", x1: x, y1: base + size * 0.12, x2: x + w, y2: base + size * 0.12, color: r.color ?? "#000000", width: Math.max(0.4, size * 0.06) }, undefined, undefined, true);
            if (r.strike) add({ type: "line", x1: x, y1: base - size * 0.28, x2: x + w, y2: base - size * 0.28, color: r.color ?? "#000000", width: Math.max(0.4, size * 0.06) }, undefined, undefined, true);
          }
          x += w;
        });
      }
    };
    parts("header", printed.header);
    parts("footer", printed.footer);
  }

  function drawHeaderPicture(p: HeaderFooterPicture, x: number, y: number, dy: number): void {
    const made = pdfPicture(p.src, { ...(p.crop ? { crop: p.crop } : {}), ...(p.grayscale || mono ? { grayscale: true } : {}) }, p.width / 0.75, p.height / 0.75);
    if (!made) {
      warn("A picture of a kind the PDF can't hold (a GIF) was left out");
      return;
    }
    made.skipped.forEach(warn);
    add({ type: "image", x, y: y + dy, width: p.width, height: p.height, image: made.image }, undefined, undefined, true);
  }
}
