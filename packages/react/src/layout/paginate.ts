/**
 * Page layout for a continuous flow of blocks.
 *
 * The editor keeps all content in one editable surface and shows it on page sheets drawn behind
 * it. To make content respect page boundaries, `paginate` decides where spacers go: gaps that
 * push a block (or, for text, the lines after a certain line) down to the top of the next page.
 *
 * This file is pure: it works on measurements, not on the DOM, so it can be tested directly.
 * All coordinates are in CSS pixels, measured from the top of the first page's content area.
 * Page k's content area starts at `k * stride` and is `content` tall.
 */

/** One visual line of a text block, as its line box. */
export interface LineInfo {
  /** Character offset in the block where this line starts. */
  offset: number;
  top: number;
  bottom: number;
}

export interface BlockMetric {
  id: string;
  /** Natural top of the block (border box) when no spacers are applied. */
  top: number;
  height: number;
  /** A forced page break: the next block starts on a new page. */
  pageBreak?: boolean;
  /** Keep this block on the same page as the start of the next one (headings). */
  keepWithNext?: boolean;
  /**
   * Height of content repeated at the top of every page this block lands on after a break, such as
   * a table's header row. The block is placed below it.
   */
  repeat?: number;
  /** Height of the block's first line, used for `keepWithNext`. */
  firstLineHeight?: number;
  /**
   * The block's lines, computed on demand. Only text blocks that cross a page boundary need
   * this, so it can be expensive. Blocks without it are never split.
   */
  lines?: () => LineInfo[];
}

/**
 * A run of blocks laid out in columns, measured as if they were one narrow column the width of a column.
 * The paginator works out how much of it goes on each page, and how tall the columns on that page are.
 */
export interface ColumnGroupMetric {
  columns: number;
  /** The blocks, with natural tops in that narrow column. */
  blocks: BlockMetric[];
  /** Height of a line of ordinary text, kept as slack under the columns. */
  lineHeight: number;
}

/** The space a page gives to text, and the margins around it that the page's own parts (header, footer) use. */
export interface PageGeometry {
  /** Height of the text area. */
  content: number;
  /** Space above the text area, down from the top of the sheet. */
  before: number;
  /** Space below the text area, up from the bottom of the sheet. */
  after: number;
}

/**
 * Marks where a section starts, with the shape of its pages. A section that changes the shape of the page
 * (`newPage`) begins on a new page; one that doesn't carries on from the text above.
 */
export interface SectionMetric {
  section: number;
  geometry: PageGeometry;
  newPage: boolean;
}

export type FlowMetric = BlockMetric | ColumnGroupMetric | SectionMetric;

const isGroup = (m: FlowMetric): m is ColumnGroupMetric => "columns" in m;
const isSection = (m: FlowMetric): m is SectionMetric => "geometry" in m;

/** One page's worth of a column run: the columns' height. The browser flows the text into them. */
export interface Chunk {
  height: number;
  columns: number;
}

export interface Geometry {
  /** Distance from the top of one page's content area to the next: page height plus the gap. */
  stride: number;
  /** Height of the content area of a page. */
  content: number;
  /**
   * Space between the sheets, when sections give pages different shapes (see `SectionMetric`). Pages are then
   * placed by their own geometry, and `stride` only describes the first section.
   */
  gap?: number;
  /** Room taken from the bottom of a page's content area, such as for its footnotes. `page` counts from 0. */
  reserve?: (page: number) => number;
}

/** A gap inserted inside a text block, before the line that starts at `offset`. */
export interface Split {
  offset: number;
  height: number;
}

export interface Layout {
  /** Number of pages. */
  pages: number;
  /** Gap to insert before a block to move it to the top of the next page. */
  before: ReadonlyMap<string, number>;
  /** Gaps to insert inside text blocks that continue onto the next page. */
  splits: ReadonlyMap<string, readonly Split[]>;
  /** The page (starting at 1) on which each block starts. */
  pageOf: ReadonlyMap<string, number>;
  /**
   * For blocks in `before` that have a `repeat`: how much of that gap the repeated content fills at
   * its end. The rest is blank space.
   */
  repeats: ReadonlyMap<string, number>;
  /** Total height of the flow with all gaps applied. */
  height: number;
  /** For a run of blocks in columns: the pieces it is cut into, one per page, by the first block of each. */
  chunks: ReadonlyMap<string, Chunk>;
  /** Where each page's text area starts in the flow, and the section it belongs to, for pages 0 to `pages - 1`. */
  pageInfo: readonly { start: number; section: number }[];
  /** The footnotes whose references fall on each page (counting from 1), in order. */
  notes: ReadonlyMap<number, readonly string[]>;
  /**
   * Where each block that a floating object is placed against begins, down the flow with every gap applied. Only those blocks are
   * listed (see `anchorsOf`): it is how a position measured from a paragraph is found.
   */
  tops: ReadonlyMap<string, number>;
}

const EPSILON = 0.5;

/** Lines that must stay together at the start and end of a split paragraph. */
const MIN_LINES_BEFORE_BREAK = 2;
const MIN_LINES_AFTER_BREAK = 2;

/** The fewest points tall that `count` columns must be to hold these blocks, or Infinity if they don't fit in `most`. */
function columnHeight(blocks: readonly BlockMetric[], count: number, most: number, lines: (b: BlockMetric) => LineInfo[]): number {
  const base = blocks[0]!.top;
  const relative = blocks.map((b): BlockMetric => ({
    ...b,
    top: b.top - base,
    lines: b.lines ? () => lines(b).map((l) => ({ ...l, top: l.top - base, bottom: l.bottom - base })) : undefined,
  }));
  const fits = (h: number) => paginate(relative, { stride: h, content: h }).pages <= count;
  const total = blocks[blocks.length - 1]!.top + blocks[blocks.length - 1]!.height - base;
  let low = Math.max(1, Math.ceil(total / count));
  let high = Math.max(low, Math.floor(most));
  if (!fits(high)) return Number.POSITIVE_INFINITY;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

export function paginate(blocks: readonly FlowMetric[], g: Geometry): Layout {
  const before = new Map<string, number>();
  const splits = new Map<string, Split[]>();
  const pageOf = new Map<string, number>();
  const repeats = new Map<string, number>();
  const chunks = new Map<string, Chunk>();

  let shift = 0;
  /** After a page break: the next block must not start above this. */
  let forcedTop: number | null = null;
  let flowBottom = 0;

  // Pages are made as the flow reaches them. They are all the same shape unless a section changes it.
  const gap = g.gap ?? 0;
  const first: PageGeometry = { content: g.content, before: 0, after: g.stride - g.content - gap };
  const table: { start: number; geometry: PageGeometry; section: number }[] = [{ start: 0, geometry: first, section: 0 }];
  let current = { geometry: first, section: 0 };
  /** Whether any block has been placed, so the first section's marker sets up the first page. */
  let started = false;
  const stepFrom = (page: { geometry: PageGeometry }, next: PageGeometry) => page.geometry.content + page.geometry.after + gap + next.before;
  const addPage = () => {
    const last = table[table.length - 1]!;
    table.push({ start: last.start + stepFrom(last, current.geometry), geometry: current.geometry, section: current.section });
  };
  const startOf = (k: number) => {
    while (table.length <= k) addPage();
    return table[k]!.start;
  };
  const pageIndex = (y: number) => {
    // Make pages until the next one would start below `y`.
    for (;;) {
      const last = table[table.length - 1]!;
      if (last.start + stepFrom(last, current.geometry) <= y + EPSILON) addPage();
      else break;
    }
    let k = table.length - 1;
    while (k > 0 && table[k]!.start > y + EPSILON) k--;
    return Math.max(0, k);
  };
  const contentOf = (page: number) => {
    startOf(page);
    return table[page]!.geometry.content - (g.reserve?.(page) ?? 0);
  };

  /** Places a run of blocks in columns, a page at a time. */
  const placeColumns = (group: ColumnGroupMetric) => {
    const items = group.blocks;
    const n = group.columns;
    // Lines are measured once per block, since fitting tries many sizes.
    const cache = new Map<string, LineInfo[]>();
    const lines = (b: BlockMetric) => {
      let found = cache.get(b.id);
      if (!found) cache.set(b.id, (found = b.lines?.() ?? []));
      return found;
    };
    let start = 0;
    while (start < items.length) {
      const first = items[start]!;
      let top = first.top + shift;
      if (forcedTop !== null && top < forcedTop) {
        const gap = forcedTop - top;
        before.set(first.id, (before.get(first.id) ?? 0) + gap);
        shift += gap;
        top = forcedTop;
      }
      forcedTop = null;

      let page = pageIndex(top);
      let avail = startOf(page) + contentOf(page) - top;
      const fitsTo = (end: number) => columnHeight(items.slice(start, end + 1), n, avail, lines) <= avail;
      /** The last block that fits in the room, or -1 if not even the first does. */
      const lastFit = (): number => {
        if (!fitsTo(start)) return -1;
        let low = start;
        let high = items.length - 1;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (fitsTo(mid)) low = mid;
          else high = mid - 1;
        }
        // A heading stays with what follows it.
        while (low > start && items[low]!.keepWithNext && low < items.length - 1) low--;
        return low;
      };

      let end = lastFit();
      if (end < 0 && top > startOf(page) + EPSILON) {
        // Nothing fits in what is left of this page: start on the next one.
        const gap = startOf(page + 1) - top;
        before.set(first.id, (before.get(first.id) ?? 0) + gap);
        shift += gap;
        top += gap;
        page += 1;
        avail = startOf(page) + contentOf(page) - top;
        end = lastFit();
      }
      // A block taller than a page goes alone and overflows, as a tall block does outside columns.
      if (end < 0) end = start;

      const slice = items.slice(start, end + 1);
      const need = columnHeight(slice, n, Math.max(avail, slice[slice.length - 1]!.top + slice[slice.length - 1]!.height - first.top), lines);
      const height = Math.max(need, Math.min(need + group.lineHeight, avail));
      chunks.set(first.id, { height, columns: n });
      for (const item of slice) pageOf.set(item.id, page + 1);
      // The text after this takes less height than the single column it was measured in.
      shift += height - (slice[slice.length - 1]!.top + slice[slice.length - 1]!.height - first.top);
      flowBottom = Math.max(flowBottom, top + height);
      start = end + 1;
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const m = blocks[i]!;
    if (isSection(m)) {
      if (!started) {
        // The first section shapes the first page.
        table[0] = { start: 0, geometry: m.geometry, section: m.section };
        current = { geometry: m.geometry, section: m.section };
      } else if (m.newPage) {
        // The pages from here on have the new shape, and the next one starts the section.
        const last = pageIndex(Math.max(0, flowBottom - EPSILON * 2));
        table.length = last + 1;
        current = { geometry: m.geometry, section: m.section };
        forcedTop = startOf(last + 1);
      } else {
        current = { geometry: m.geometry, section: m.section };
      }
      continue;
    }
    started = true;
    if (isGroup(m)) {
      placeColumns(m);
      continue;
    }
    const b = m;
    const following = blocks.slice(i + 1).find((x): x is BlockMetric | ColumnGroupMetric => !isSection(x));
    const next = following ? (isGroup(following) ? following.blocks[0] : following) : undefined;
    let top = b.top + shift;

    if (forcedTop !== null && top < forcedTop) {
      const gap = forcedTop - top;
      before.set(b.id, gap);
      shift += gap;
      top = forcedTop;
    }
    forcedTop = null;

    let page = pageIndex(top);

    if (b.pageBreak) {
      pageOf.set(b.id, page + 1);
      forcedTop = startOf(page + 1);
      flowBottom = Math.max(flowBottom, top + b.height);
      continue;
    }

    /** Pushes the whole block to the top of the next page. */
    const pushToNextPage = () => {
      const extra = b.repeat ?? 0;
      const gap = startOf(page + 1) + extra - top;
      before.set(b.id, (before.get(b.id) ?? 0) + gap);
      if (extra > 0) repeats.set(b.id, extra);
      shift += gap;
      top += gap;
      page += 1;
    };

    let limit = startOf(page) + contentOf(page);
    // A block that starts below the content area (it landed in the bottom margin) moves on.
    if (top >= limit - EPSILON && top > startOf(page) + EPSILON) {
      pushToNextPage();
      limit = startOf(page) + contentOf(page);
    }

    pageOf.set(b.id, page + 1);
    const atPageTop = () => top <= startOf(page) + (b.repeat ?? 0) + EPSILON;
    let bottom = top + b.height;

    if (bottom <= limit + EPSILON) {
      // It fits. A heading shouldn't be left alone at the bottom of a page.
      if (b.keepWithNext && next && !atPageTop()) {
        const nextTop = next.top + shift;
        const need = Math.min(next.firstLineHeight ?? next.height, next.height);
        if (nextTop + need > limit + EPSILON) {
          pushToNextPage();
          pageOf.set(b.id, page + 1);
          bottom = top + b.height;
        }
      }
      flowBottom = Math.max(flowBottom, bottom);
      continue;
    }

    // It crosses the bottom of the page. Text can be split between lines; anything else moves.
    const lines = b.lines?.() ?? [];
    if (lines.length < 2) {
      if (!atPageTop()) pushToNextPage();
      pageOf.set(b.id, page + 1);
      flowBottom = Math.max(flowBottom, top + b.height);
      continue;
    }

    const overflowing = (from: number) => lines.findIndex((l, j) => j >= from && l.bottom + shift > limit + EPSILON);

    let idx = overflowing(0);
    if (idx < 0) {
      // Every line fits; only the block's padding hangs over the edge.
      flowBottom = Math.max(flowBottom, top + b.height);
      continue;
    }
    if (idx < MIN_LINES_BEFORE_BREAK && !atPageTop()) {
      // Too few lines would stay on this page (an orphan): move the whole block.
      pushToNextPage();
      pageOf.set(b.id, page + 1);
      limit = startOf(page) + contentOf(page);
      idx = overflowing(0);
    }

    const blockSplits: Split[] = [];
    while (idx >= 0) {
      let at = idx;
      if (blockSplits.length === 0) {
        // Don't strand a single line at the top of the next page (a widow).
        const remaining = lines.length - at;
        if (remaining < MIN_LINES_AFTER_BREAK) {
          at = Math.max(at - (MIN_LINES_AFTER_BREAK - remaining), Math.min(MIN_LINES_BEFORE_BREAK, at));
        }
      }
      const line = lines[at]!;
      const gap = startOf(page + 1) - (line.top + shift);
      if (at === 0 || gap <= EPSILON) break;
      blockSplits.push({ offset: line.offset, height: gap });
      shift += gap;
      page += 1;
      limit = startOf(page) + contentOf(page);
      idx = overflowing(at + 1);
    }
    if (blockSplits.length > 0) splits.set(b.id, blockSplits);
    flowBottom = Math.max(flowBottom, b.top + b.height + shift);
  }

  const pages = Math.max(1, pageIndex(Math.max(0, flowBottom - EPSILON * 2)) + 1);
  startOf(pages - 1);
  const pageInfo = table.slice(0, pages).map((p) => ({ start: p.start, section: p.section }));
  return { pages, before, splits, pageOf, repeats, height: flowBottom, notes: new Map(), chunks, pageInfo, tops: new Map() };
}

/** True when two layouts would render the same spacers. Used to stop re-measuring once stable. */
export function sameLayout(a: Layout, b: Layout): boolean {
  if (a.pages !== b.pages || a.before.size !== b.before.size || a.splits.size !== b.splits.size) return false;
  for (const [id, gap] of a.before) if (Math.abs((b.before.get(id) ?? -1) - gap) > 0.01) return false;
  for (const [id, list] of a.splits) {
    const other = b.splits.get(id);
    if (!other || other.length !== list.length) return false;
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.offset !== other[i]!.offset || Math.abs(list[i]!.height - other[i]!.height) > 0.01) return false;
    }
  }
  for (const [id, page] of a.pageOf) if (b.pageOf.get(id) !== page) return false;
  for (const [id, height] of a.repeats) if (Math.abs((b.repeats.get(id) ?? -1) - height) > 0.01) return false;
  if (a.repeats.size !== b.repeats.size || a.notes.size !== b.notes.size || a.chunks.size !== b.chunks.size) return false;
  for (let k = 0; k < a.pageInfo.length; k++) {
    const x = a.pageInfo[k]!;
    const y = b.pageInfo[k];
    if (!y || x.section !== y.section || Math.abs(x.start - y.start) > 0.01) return false;
  }
  for (const [id, chunk] of a.chunks) {
    const other = b.chunks.get(id);
    if (!other || other.columns !== chunk.columns || Math.abs(other.height - chunk.height) > 0.01) return false;
  }
  for (const [page, ids] of a.notes) {
    const other = b.notes.get(page);
    if (!other || other.length !== ids.length || ids.some((id, i) => id !== other[i])) return false;
  }
  if (a.tops.size !== b.tops.size) return false;
  for (const [id, top] of a.tops) if (Math.abs((b.tops.get(id) ?? -1e9) - top) > 0.5) return false;
  return true;
}

export const EMPTY_LAYOUT: Layout = {
  pages: 1,
  before: new Map(),
  splits: new Map(),
  pageOf: new Map(),
  repeats: new Map(),
  height: 0,
  notes: new Map(),
  chunks: new Map(),
  pageInfo: [{ start: 0, section: 0 }],
  tops: new Map(),
};
