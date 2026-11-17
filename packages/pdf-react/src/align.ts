import type { Rect } from "@pli.dev/pdf";

/**
 * Aligning and distributing boxes, for selected annotations and for form fields in Prepare form. Pure: it takes boxes and
 * says how far each must move; the callers move things (`moveBy` for annotations, `setRects` for fields), in one undo step.
 */

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Distribute = "horizontal" | "vertical";

export interface Box {
  id: string;
  box: Rect;
}

export interface Move {
  id: string;
  dx: number;
  dy: number;
}

export const ALIGNMENTS: readonly Align[] = ["left", "center", "right", "top", "middle", "bottom"];

export const ALIGN_LABEL: Record<Align, string> = {
  left: "Align left",
  center: "Align centre",
  right: "Align right",
  top: "Align top",
  middle: "Align middle",
  bottom: "Align bottom",
};

export const DISTRIBUTE_LABEL: Record<Distribute, string> = {
  horizontal: "Distribute horizontally",
  vertical: "Distribute vertically",
};

const round = (n: number): number => Math.round(n * 100) / 100;

/** The box around all the boxes. */
export function unionOf(boxes: readonly Box[]): Rect {
  const x = Math.min(...boxes.map((b) => b.box.x));
  const y = Math.min(...boxes.map((b) => b.box.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.box.x + b.box.w)) - x, h: Math.max(...boxes.map((b) => b.box.y + b.box.h)) - y };
}

/**
 * Moves that line the boxes up on one edge or centre line of the box around all of them. Boxes that are already there are
 * left out. Fewer than two boxes: nothing to do.
 */
export function alignMoves(boxes: readonly Box[], how: Align): Move[] {
  if (boxes.length < 2) return [];
  const u = unionOf(boxes);
  const moves: Move[] = [];
  for (const { id, box } of boxes) {
    let dx = 0;
    let dy = 0;
    if (how === "left") dx = u.x - box.x;
    else if (how === "right") dx = u.x + u.w - (box.x + box.w);
    else if (how === "center") dx = u.x + u.w / 2 - (box.x + box.w / 2);
    else if (how === "top") dy = u.y - box.y;
    else if (how === "bottom") dy = u.y + u.h - (box.y + box.h);
    else dy = u.y + u.h / 2 - (box.y + box.h / 2);
    dx = round(dx);
    dy = round(dy);
    if (dx !== 0 || dy !== 0) moves.push({ id, dx, dy });
  }
  return moves;
}

/**
 * Moves that make the gaps between the boxes equal, keeping the first and the last where they are (in order of position).
 * Needs three boxes: with two there is nothing between them to even out.
 */
export function distributeMoves(boxes: readonly Box[], how: Distribute): Move[] {
  if (boxes.length < 3) return [];
  const horizontal = how === "horizontal";
  const start = (b: Box) => (horizontal ? b.box.x : b.box.y);
  const size = (b: Box) => (horizontal ? b.box.w : b.box.h);
  // Order by the middle, so a long box does not jump over a short one that sits in the middle of it.
  const sorted = [...boxes].sort((a, b) => start(a) + size(a) / 2 - (start(b) + size(b) / 2) || start(a) - start(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = start(last) + size(last) - start(first);
  const gap = (span - sorted.reduce((sum, b) => sum + size(b), 0)) / (sorted.length - 1);
  const moves: Move[] = [];
  let at = start(first) + size(first) + gap;
  for (const b of sorted.slice(1, -1)) {
    const d = round(at - start(b));
    if (d !== 0) moves.push(horizontal ? { id: b.id, dx: d, dy: 0 } : { id: b.id, dx: 0, dy: d });
    at += size(b) + gap;
  }
  return moves;
}
