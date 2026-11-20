import { columnRuns, isFloating, sectionsOf, type Block, type Columns } from "@pli.dev/docs";
import { BLOCK_ATTR } from "../render";
import { anchorKeyOf } from "../floats";
import { rowGroups } from "./groups";
import { paginate, type BlockMetric, type FlowMetric, type Geometry, type Layout, type LineInfo, type PageGeometry } from "./paginate";

/** Set on the editor while measuring, so every spacer collapses and blocks report their natural position. */
export const MEASURING_CLASS = "pli-measuring";

/** Attribute on spacer elements. */
export const SPACER_ATTR = "data-pli-spacer";

function lineHeightOf(el: HTMLElement): number {
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  const lh = parseFloat(style.lineHeight);
  if (Number.isFinite(lh)) return lh;
  return (parseFloat(style.fontSize) || 16) * 1.2;
}

/**
 * Lines of a text block, with the model offset at which each starts. Measured character by
 * character, which is slow, so the paginator only asks for blocks that cross a page boundary.
 */
function measureLines(el: HTMLElement, origin: DOMRect, scale: number): LineInfo[] {
  const lineHeight = lineHeightOf(el);
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = el.ownerDocument.createRange();
  const lines: LineInfo[] = [];
  let offset = 0;

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.data;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      // Skip characters with no box of their own (collapsed spaces, line-ending newlines).
      if (rect.height > 0 && (rect.width > 0 || text[i] !== "\n")) {
        const top = (rect.top + rect.height / 2 - lineHeight / 2 - origin.top) / scale;
        const last = lines[lines.length - 1];
        if (!last || top > last.top + lineHeight / (2 * scale)) {
          lines.push({ offset: offset + i, top, bottom: top + lineHeight / scale });
        }
      }
    }
    offset += text.length;
  }
  return lines;
}

function metricFor(el: HTMLElement, block: Block, origin: DOMRect, scale: number): BlockMetric {
  const rect = el.getBoundingClientRect();
  const metric: BlockMetric = {
    id: block.id,
    top: (rect.top - origin.top) / scale,
    height: rect.height / scale,
  };

  switch (block.type) {
    case "page_break":
      metric.pageBreak = true;
      break;
    case "section_break":
      // A section that starts on a new page forces what follows onto one, as a page break does.
      if (block.kind === "next_page") metric.pageBreak = true;
      break;
    case "heading":
    case "title":
    case "subtitle":
      metric.keepWithNext = true;
      metric.firstLineHeight = lineHeightOf(el) / scale;
      break;
    case "image":
    case "toc":
    case "divider":
    case "table":
      break;
    default:
      metric.firstLineHeight = lineHeightOf(el) / scale;
      metric.lines = () => measureLines(el, origin, scale);
  }
  return metric;
}

/**
 * The blocks that floating objects are placed against, by the id the paginator knows them by (a table is known by its first row).
 * An object belongs to the paragraph after it, or the one before when it is last. Only objects placed down from their paragraph need it.
 */
export function anchorsOf(blocks: readonly Block[]): Set<string> {
  const anchors = new Set<string>();
  blocks.forEach((block, i) => {
    if (!isFloating(block) || block.float.y.from !== "paragraph") return;
    const key = anchorKeyOf(blocks, i);
    if (key !== undefined) anchors.add(key);
  });
  return anchors;
}

/** The layout with where each anchor starts worked out from the blocks' natural places and the gaps the layout put in. */
function withTops(layout: Layout, metrics: readonly FlowMetric[], anchors: ReadonlySet<string>): Layout {
  if (anchors.size === 0) return layout;
  const tops = new Map<string, number>();
  let shift = 0;
  for (const m of metrics) {
    if (isSectionMetric(m)) continue;
    if ("columns" in m) {
      // Blocks in columns are placed close enough by where they would be in one column.
      for (const item of m.blocks) if (anchors.has(item.id)) tops.set(item.id, item.top + shift);
      continue;
    }
    shift += layout.before.get(m.id) ?? 0;
    if (anchors.has(m.id)) tops.set(m.id, m.top + shift);
    for (const split of layout.splits.get(m.id) ?? []) shift += split.height;
  }
  return { ...layout, tops };
}

const isSectionMetric = (m: FlowMetric): m is Extract<FlowMetric, { geometry: unknown }> => "geometry" in m;

/** What the paginator needs to leave room for footnotes at the bottom of the pages that cite them. */
export interface NotesGeometry {
  /** Height of each note as it is shown, by id. A note not listed is taken as 0 tall until it is measured. */
  heights: ReadonlyMap<string, number>;
  /** Space a page's notes need besides the notes themselves: the rule above them and the gap around it. */
  overhead: number;
}

/** The shape of one section's pages, and whether it begins on a new page. One for each section, in order. */
export interface SectionGeometry {
  geometry: PageGeometry;
  newPage: boolean;
}

/** A footnote reference, found in the editor: which block (or table row group) it is in, and where in its text. */
interface Reference {
  id: string;
  metric: string;
  offset: number;
}

/** How many characters of text come before `target` inside `container`, counted the way the model counts them. */
function offsetWithin(container: HTMLElement, target: Node): number {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (target.contains(node)) return offset;
    offset += node.data.length;
  }
  return offset;
}

/** The page (from 1) a reference lands on, given the layout so far: where its block starts, plus the splits before it. */
function pageOfReference(layout: Layout, ref: Reference): number {
  const start = layout.pageOf.get(ref.metric) ?? 1;
  return start + (layout.splits.get(ref.metric)?.filter((s) => s.offset <= ref.offset).length ?? 0);
}

/**
 * Measures the editor's blocks as if no spacers were present and paginates them.
 *
 * Measuring and paginating happen together inside one synchronous window in which every spacer
 * is collapsed by CSS, so line measurements (taken lazily by the paginator) see natural
 * positions, and the browser never paints the collapsed state. `scale` is the zoom applied to
 * the editor with a CSS transform, which browsers include in client rects.
 */
export function measureAndPaginate(
  root: HTMLElement,
  blocks: readonly Block[],
  scale: number,
  geometry: Geometry,
  extras: { notes?: NotesGeometry; columns?: Columns; sections?: readonly SectionGeometry[] } = {},
): Layout {
  const { notes } = extras;
  root.classList.add(MEASURING_CLASS);
  try {
    const origin = root.getBoundingClientRect();
    const elements = new Map<string, HTMLElement>();
    for (const el of root.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}], [data-row-id]`)) {
      elements.set(el.getAttribute(BLOCK_ATTR) ?? el.getAttribute("data-row-id")!, el);
    }
    const metrics: FlowMetric[] = [];
    const runStart = new Map(columnRuns({ blocks, page: { columns: extras.columns } }).map((run) => [run.from, run]));
    // Where each section starts, so the paginator can give its pages their shape.
    const sectionStart = new Map<number, number>();
    if (extras.sections) {
      sectionsOf({ blocks, page: { columns: extras.columns } }).forEach((section, s) => {
        if (section.from < section.to && extras.sections![s]) sectionStart.set(section.from, s);
      });
    }
    /** The metric each table row belongs to, so a reference in a cell can be placed. */
    const rowMetric = new Map<string, string>();
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]!;
      const section = sectionStart.get(index);
      if (section !== undefined) metrics.push({ section, ...extras.sections![section]! });
      const run = runStart.get(index);
      if (run) {
        // Text in columns is measured as one narrow column; the paginator decides how it goes into columns.
        const items: BlockMetric[] = [];
        let lineHeight = 0;
        for (const inner of blocks.slice(run.from, run.to)) {
          // A floating object takes no room, so it has no place in the flow to measure.
          if (isFloating(inner)) continue;
          const el = elements.get(inner.id);
          if (!el) continue;
          items.push(metricFor(el, inner, origin, scale));
          lineHeight ||= lineHeightOf(el) / scale;
        }
        if (items.length > 0) metrics.push({ columns: run.columns.count, blocks: items, lineHeight: lineHeight || 16 });
        index = run.to - 1;
        continue;
      }
      if (isFloating(block)) continue;
      if (block.type === "table") {
        // A table is paginated by rows: a row that doesn't fit moves whole to the next page.
        // Rows that a merged cell spans can't be separated by a page break, so they move together: each
        // "group" starts at a row that no earlier cell reaches into. A header row stays with the row
        // after it, and is repeated at the top of each later page (when it is a single plain row).
        const groups = rowGroups(block);
        let headerHeight = 0;
        groups.forEach((group, g) => {
          const first = elements.get(block.rows[group.first]!.id);
          const last = elements.get(block.rows[group.last]!.id);
          if (!first || !last) return;
          const top = first.getBoundingClientRect().top;
          const metric: BlockMetric = {
            id: block.rows[group.first]!.id,
            top: (top - origin.top) / scale,
            height: (last.getBoundingClientRect().bottom - top) / scale,
          };
          if (block.headerRow && g === 0) {
            if (group.first === group.last) headerHeight = metric.height;
            metric.keepWithNext = true;
          } else if (headerHeight > 0) {
            metric.repeat = headerHeight;
          }
          metrics.push(metric);
          for (let r = group.first; r <= group.last; r++) rowMetric.set(block.rows[r]!.id, metric.id);
        });
        continue;
      }
      const el = elements.get(block.id);
      if (el) metrics.push(metricFor(el, block, origin, scale));
    }
    const refs: Reference[] = [];
    if (notes) {
      for (const el of root.querySelectorAll<HTMLElement>("[data-footnote]")) {
        const row = el.closest<HTMLElement>("[data-row-id]");
        const owner = row ? (rowMetric.get(row.getAttribute("data-row-id")!) ?? null) : null;
        const blockEl = row ? null : el.closest<HTMLElement>(`[${BLOCK_ATTR}]`);
        const metric = owner ?? blockEl?.getAttribute(BLOCK_ATTR) ?? null;
        if (!metric) continue;
        refs.push({ id: el.getAttribute("data-footnote")!, metric, offset: blockEl ? offsetWithin(blockEl, el) : 0 });
      }
    }

    // Notes take room at the bottom of the page their reference is on, which can move the reference to
    // the next page. Settle that by paginating again with the room each page now needs, a few times at most.
    let reserve = new Map<number, number>();
    const anchors = anchorsOf(blocks);
    let layout = paginate(metrics, geometry);
    if (!notes || refs.length === 0) return withTops(layout, metrics, anchors);
    let byPage = new Map<number, string[]>();
    for (let pass = 0; pass < 5; pass++) {
      byPage = new Map();
      for (const ref of refs) {
        const page = pageOfReference(layout, ref);
        byPage.set(page, [...(byPage.get(page) ?? []), ref.id]);
      }
      const next = new Map<number, number>();
      for (const [page, ids] of byPage) next.set(page - 1, notes.overhead + ids.reduce((sum, id) => sum + (notes.heights.get(id) ?? 0), 0));
      const settled = next.size === reserve.size && [...next].every(([page, h]) => Math.abs((reserve.get(page) ?? -1) - h) < 0.5);
      if (settled) break;
      reserve = next;
      layout = paginate(metrics, { ...geometry, reserve: (page) => reserve.get(page) ?? 0 });
    }
    return withTops({ ...layout, notes: byPage }, metrics, anchors);
  } finally {
    root.classList.remove(MEASURING_CLASS);
  }
}
