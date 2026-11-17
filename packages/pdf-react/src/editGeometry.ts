import type { EditableRun, PageImage, Rect, TextRun } from "@pli.dev/pdf";

/**
 * The geometry of editing text and pictures on the page, all in page space (points, y down, not turned): finding what is
 * under the pointer, and where the in-place editor and the preview sit. No DOM here, so it can be tested on its own.
 */

/** A run of the page with what the editor needs: the text run (font, colour, where it starts) and what the engine says about editing it. */
export interface EditRun {
  id: string;
  text: string;
  box: Rect;
  editable: boolean;
  /** Why not, in plain words. */
  reason?: string;
  /** The font the page uses for it: `simple`, `composite` or `type3`. */
  kind: EditableRun["font"];
  embedded: boolean;
  font: TextRun["font"];
  /** `#rrggbb`, when the text has a plain colour. */
  color?: string;
  /** Where the first glyph starts, on its baseline. */
  origin: [number, number];
  /** Degrees clockwise (0: left to right). */
  angle: number;
  /** How far the run goes along its baseline, in points. */
  length: number;
}

export interface EditImage {
  id: string;
  box: Rect;
  width: number;
  height: number;
  name: string;
  inline: boolean;
}

export interface PageContent {
  runs: EditRun[];
  images: EditImage[];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** How far the box reaches along the direction of the text, from where the text starts. */
export function runLength(box: Rect, origin: readonly [number, number], angle: number): number {
  const dx = Math.cos(rad(angle));
  const dy = Math.sin(rad(angle));
  let best = 0;
  for (const [x, y] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ] as const)
    best = Math.max(best, (x - origin[0]) * dx + (y - origin[1]) * dy);
  return Math.round(best * 100) / 100;
}

/** Puts what `content.runs`, `editableRuns` and `images` say about a page together. */
export function pageContent(runs: readonly TextRun[], editable: readonly EditableRun[], images: readonly PageImage[]): PageContent {
  const by = new Map(editable.map((e) => [e.id, e]));
  return {
    runs: runs.map((r) => {
      const e = by.get(r.id);
      return {
        id: r.id,
        text: r.text,
        box: r.box,
        editable: e ? e.editable : r.editable,
        ...((e?.reason ?? r.reason) ? { reason: e?.reason ?? r.reason } : {}),
        kind: e?.font ?? "simple",
        embedded: e?.embedded ?? false,
        font: r.font,
        ...(r.color ? { color: r.color } : {}),
        origin: r.origin,
        angle: r.angle,
        length: runLength(r.box, r.origin, r.angle),
      };
    }),
    images: images.map((i) => ({ id: i.id, box: i.box, width: i.width, height: i.height, name: i.name, inline: i.inline })),
  };
}

const area = (r: Rect): number => r.w * r.h;
const inside = (r: Rect, x: number, y: number, pad: number): boolean => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

/**
 * The run under a point. `pad` (points) widens each box so thin text is easy to hit. When boxes overlap, the smallest wins:
 * it is the one that was meant.
 */
export function hitRun(runs: readonly EditRun[], x: number, y: number, pad = 2): EditRun | null {
  let best: EditRun | null = null;
  for (const r of runs) if (inside(r.box, x, y, pad) && (!best || area(r.box) < area(best.box))) best = r;
  return best;
}

/** The picture under a point (the topmost is the one listed last). */
export function hitImage(images: readonly EditImage[], x: number, y: number): EditImage | null {
  for (let i = images.length - 1; i >= 0; i--) if (inside(images[i]!.box, x, y, 0)) return images[i]!;
  return null;
}

/** What a click at a point picks: text first (it sits on top of pictures), then a picture. */
export function hitContent(content: PageContent, x: number, y: number, pad = 2): { kind: "run"; run: EditRun } | { kind: "image"; image: EditImage } | null {
  const run = hitRun(content.runs, x, y, pad);
  if (run) return { kind: "run", run };
  const image = hitImage(content.images, x, y);
  return image ? { kind: "image", image } : null;
}

/** The part of the line height above the baseline, as a fraction of the font size. */
export const BASELINE = 0.95;
/** The height of the editor's line, as a fraction of the font size. */
export const LINE = 1.25;

export interface EditorFrame {
  /** Page space: where the element's top left is before it is turned. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Degrees, around the top left of the element, then moved up by `lift` (in the element's own frame). */
  rotate: number;
  /** The baseline sits `lift` points below the top of the element. */
  lift: number;
  /** The CSS `transform`. */
  transform: string;
}

/**
 * Where the in-place editor for a run goes: an element as long as the run (or as wide as the text typed if that is longer),
 * one line high, whose baseline lies on the run's baseline and which is turned with the text. `size` is the font size in
 * points (the new one, when it was changed); `width` the length of the text now, when it is longer than the old.
 */
export function editorFrame(run: Pick<EditRun, "origin" | "angle" | "length">, size: number, width = 0): EditorFrame {
  const lift = Math.round(size * BASELINE * 100) / 100;
  const turn = Math.round(run.angle * 100) / 100;
  return {
    left: run.origin[0],
    top: run.origin[1],
    width: Math.max(run.length, width, size),
    height: Math.round(size * LINE * 100) / 100,
    rotate: turn,
    lift,
    transform: `rotate(${turn}deg) translate(0px, ${-lift}px)`,
  };
}

/** Maps a point of the editor's element (its own frame, x along the text, y down) to page space. */
export function editorPoint(frame: EditorFrame, x: number, y: number): [number, number] {
  const a = rad(frame.rotate);
  const ey = y - frame.lift;
  return [frame.left + x * Math.cos(a) - ey * Math.sin(a), frame.top + x * Math.sin(a) + ey * Math.cos(a)];
}

/** A rectangle a little larger on every side. */
export function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/** The scale across the text that makes new text of `width` points fit in `oldWidth`, when "shrink to fit" is on (at most 30% narrower). */
export function shrinkScale(width: number, oldWidth: number): number {
  if (width <= oldWidth * 1.01 + 0.5 || width <= 0) return 1;
  return Math.max(0.7, oldWidth / width);
}
