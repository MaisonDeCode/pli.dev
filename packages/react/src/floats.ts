import { isFloating, type Block, type FloatingBlock } from "@pli.dev/docs";
import type { Layout } from "./layout/paginate";

/** Where a floating picture or text box is drawn, in pixels from the top left of the body of the document. */
export interface FloatFrame {
  left: number;
  top: number;
  /** How much of each side lies off the page and is cut away, or null when all of it is on the page. */
  clip: { top: number; right: number; bottom: number; left: number } | null;
  /** What its position is counted from, on each side: where a distance of 0 would put its edge. */
  origin: { x: number; y: number };
}

/** One sheet of paper, placed against the body of the document: its corner, its size and its margins. */
export interface SheetBox {
  left: number;
  top: number;
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

/** How big a floating block is. */
export function floatSize(block: FloatingBlock): { width: number; height: number } {
  return block.type === "image" ? { width: block.width, height: block.height } : { width: block.float.width, height: block.float.height };
}

/** What the paginator calls the block a floating object is placed against: the one after it, or before it when it is last. */
export function anchorKeyOf(blocks: readonly Block[], index: number): string | undefined {
  const target = blocks.slice(index + 1).find((b) => !isFloating(b)) ?? blocks.slice(0, index).reverse().find((b) => !isFloating(b));
  if (!target) return undefined;
  return target.type === "table" ? target.rows[0]!.id : target.id;
}

/** A place on one side of the page: the edge a distance is counted from, and how far it is to the other edge. */
interface Span {
  start: number;
  size: number;
}

/** Where a size lands along a span: from its start by `offset`, or lined up with its start, middle or end (with `offset` as the gap left). */
function along(span: Span, size: number, position: { offset?: number; align?: string }): number {
  const offset = position.offset ?? 0;
  if (position.align === "left" || position.align === "top") return span.start + offset;
  if (position.align === "center") return span.start + (span.size - size) / 2 + offset;
  if (position.align === "right" || position.align === "bottom") return span.start + span.size - size - offset;
  return span.start + offset;
}

/**
 * Where each floating object goes. An object is placed on the page its paragraph is on: against the page's edge or margins, or
 * down from the top of the paragraph. `sheets` are the pages as drawn, measured from the body's top left corner; `layout` says which
 * page each block is on and where those that objects hang from start. Objects whose page isn't known yet are left out, and are
 * drawn where they sit in the text until it is.
 */
export function floatFrames(blocks: readonly Block[], layout: Layout, sheets: readonly SheetBox[]): Map<string, FloatFrame> {
  const frames = new Map<string, FloatFrame>();
  if (sheets.length === 0) return frames;
  blocks.forEach((block, index) => {
    if (!isFloating(block)) return;
    const key = anchorKeyOf(blocks, index);
    const page = Math.min(Math.max(((key !== undefined ? layout.pageOf.get(key) : undefined) ?? 1) - 1, 0), sheets.length - 1);
    const sheet = sheets[page]!;
    const { width, height } = floatSize(block);
    const { x, y } = block.float;

    const across: Span =
      x.from === "page"
        ? { start: sheet.left, size: sheet.width }
        : { start: sheet.left + sheet.margin.left, size: sheet.width - sheet.margin.left - sheet.margin.right };
    let down: Span;
    if (y.from === "page") down = { start: sheet.top, size: sheet.height };
    else if (y.from === "margin") down = { start: sheet.top + sheet.margin.top, size: sheet.height - sheet.margin.top - sheet.margin.bottom };
    else {
      const top = key !== undefined ? layout.tops.get(key) : undefined;
      // Down from a paragraph that hasn't been placed yet: from the top of its page's text.
      down = { start: top ?? sheet.top + sheet.margin.top, size: 0 };
    }
    const left = along(across, width, x);
    const topEdge = y.from === "paragraph" ? down.start + (y.offset ?? 0) : along(down, height, y);

    // Whatever is outside the sheet isn't on the page. Word cuts it off at the edge, so it is cut here.
    const cut = {
      top: Math.max(0, sheet.top - topEdge),
      right: Math.max(0, left + width - (sheet.left + sheet.width)),
      bottom: Math.max(0, topEdge + height - (sheet.top + sheet.height)),
      left: Math.max(0, sheet.left - left),
    };
    const clipped = cut.top > 0 || cut.right > 0 || cut.bottom > 0 || cut.left > 0;
    frames.set(block.id, { left, top: topEdge, clip: clipped ? cut : null, origin: { x: across.start, y: down.start } });
  });
  return frames;
}

/** The part of a floating object that shows, as a CSS clip. */
export function clipPath(clip: FloatFrame["clip"]): string | undefined {
  return clip ? `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)` : undefined;
}
