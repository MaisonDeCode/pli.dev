import { CSS_UNITS, normRotation, turnedSize } from "./geometry";

export type ViewMode = "continuous" | "single" | "spread";

/** What the layout needs to know about a page. */
export interface LayoutPage {
  width: number;
  height: number;
  rotate: number;
}

export interface PageBox {
  index: number;
  /** CSS pixels from the top left of the scrolling content. */
  left: number;
  top: number;
  /** The page as shown. */
  width: number;
  height: number;
  /** Degrees the page is turned, its own plus the view's. */
  rotation: number;
}

export interface Row {
  first: number;
  last: number;
  top: number;
  height: number;
  /** Position of the row's first page in `boxes`. */
  at: number;
}

export interface PdfLayout {
  boxes: PageBox[];
  rows: Row[];
  /** Size of the scrolling content. */
  width: number;
  height: number;
  /** The box of a page that is laid out. */
  box(index: number): PageBox | undefined;
}

export interface LayoutOptions {
  mode: ViewMode;
  /** CSS pixels per point. */
  scale: number;
  /** Degrees the view is turned, on top of each page's own turn. */
  viewRotation: number;
  viewport: { width: number; height: number };
  /** The page shown (decides which row the paged modes show). */
  current: number;
  /** Two-page view: the first page stands alone, as a cover. */
  cover?: boolean;
  pad?: number;
  gap?: number;
}

export const PAGE_PAD = 16;
export const PAGE_GAP = 12;

/** The pages that share a row: one each, or in pairs for the two-page view. */
export function rowRanges(count: number, mode: ViewMode, cover = false): [number, number][] {
  const rows: [number, number][] = [];
  if (mode !== "spread") {
    for (let i = 0; i < count; i++) rows.push([i, i]);
    return rows;
  }
  let i = 0;
  if (cover && count > 0) rows.push([0, 0]), (i = 1);
  for (; i < count; i += 2) rows.push([i, Math.min(count - 1, i + 1)]);
  return rows;
}

/** The index in `rows` of the one that holds page `index`. */
export function rowOf(rows: readonly [number, number][], index: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]![1] < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Places the pages. Continuous: every page, one below the other, centred. Single page and two-page view: only the row that
 * holds `current`, at the top. Pages are placed with numbers, not by the browser, so which ones to draw is plain arithmetic.
 */
export function layoutPages(pages: readonly LayoutPage[], o: LayoutOptions): PdfLayout {
  const pad = o.pad ?? PAGE_PAD;
  const gap = o.gap ?? PAGE_GAP;
  const ranges = rowRanges(pages.length, o.mode, o.cover);
  const shown = o.mode === "continuous" ? ranges : ranges.length ? [ranges[rowOf(ranges, Math.max(0, Math.min(pages.length - 1, o.current)))]!] : [];
  const sizes = (i: number) => {
    const p = pages[i]!;
    const rotation = normRotation(p.rotate + o.viewRotation);
    const t = turnedSize(p.width, p.height, rotation);
    return { width: t.width * o.scale, height: t.height * o.scale, rotation };
  };
  // Row sizes first, to find the width everything is centred in.
  const measured = shown.map(([first, last]) => {
    let width = 0;
    let height = 0;
    for (let i = first; i <= last; i++) {
      const s = sizes(i);
      width += s.width + (i > first ? gap : 0);
      height = Math.max(height, s.height);
    }
    return { first, last, width, height };
  });
  const contentWidth = Math.max(o.viewport.width, measured.reduce((m, r) => Math.max(m, r.width), 0) + 2 * pad);
  const boxes: PageBox[] = [];
  const rows: Row[] = [];
  let top = pad;
  for (const r of measured) {
    let left = (contentWidth - r.width) / 2;
    for (let i = r.first; i <= r.last; i++) {
      const s = sizes(i);
      boxes.push({ index: i, left, top, width: s.width, height: s.height, rotation: s.rotation });
      left += s.width + gap;
    }
    rows.push({ first: r.first, last: r.last, top, height: r.height, at: boxes.length - (r.last - r.first + 1) });
    top += r.height + (o.mode === "continuous" ? gap : pad);
  }
  const contentHeight = o.mode === "continuous" ? top - gap + pad : top;
  const byIndex = new Map(boxes.map((b) => [b.index, b] as const));
  return { boxes, rows, width: contentWidth, height: Math.max(contentHeight, o.mode === "continuous" ? 0 : o.viewport.height), box: (i) => byIndex.get(i) };
}

/** The boxes that touch the band from `top` to `bottom` of the content (binary search over the rows). */
export function boxesBetween(layout: PdfLayout, top: number, bottom: number): PageBox[] {
  const { rows, boxes } = layout;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.top + rows[mid]!.height < top) lo = mid + 1;
    else hi = mid;
  }
  const out: PageBox[] = [];
  for (let r = lo; r < rows.length && rows[r]!.top <= bottom; r++) {
    for (let k = 0; k <= rows[r]!.last - rows[r]!.first; k++) out.push(boxes[rows[r]!.at + k]!);
  }
  return out;
}

/**
 * The page the reader is on while scrolling: the one with the most of itself in the viewport; at the very bottom, the
 * last page, so End shows "12 / 12" even if the last page is short.
 */
export function currentFromScroll(layout: PdfLayout, scrollTop: number, viewportHeight: number): number {
  if (layout.boxes.length === 0) return 0;
  const bottom = scrollTop + viewportHeight;
  if (scrollTop > 0 && bottom >= layout.height - 1) return layout.boxes[layout.boxes.length - 1]!.index;
  let best = layout.boxes[0]!.index;
  let bestArea = -1;
  for (const b of boxesBetween(layout, scrollTop, bottom)) {
    const visible = Math.min(b.top + b.height, bottom) - Math.max(b.top, scrollTop);
    if (visible > bestArea + 0.5) {
      bestArea = visible;
      best = b.index;
    }
  }
  return best;
}

/** Zoom 1 is CSS_UNITS pixels per point. */
export const zoomToScale = (zoom: number) => zoom * CSS_UNITS;
