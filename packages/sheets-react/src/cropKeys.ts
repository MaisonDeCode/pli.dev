import type { ImageCrop } from "@pli.dev/sheets";

/*
 * Cropping a picture from the keyboard: what a press of an arrow key does to the crop and the frame. The same arithmetic as
 * dragging a crop mark or sliding the picture under its frame with the mouse, for one step of a few pixels.
 */

export type CropSide = "left" | "top" | "right" | "bottom";
export interface CropBox {
  left: number;
  top: number;
  w: number;
  h: number;
}
export interface Mirrored {
  h?: boolean;
  v?: boolean;
}

/** At least this much of the picture stays when it is cropped (a twentieth of each way), as with the mouse. */
export const LEAST_SHOWN = 0.05;
/** The frame never gets smaller than this many pixels. */
const LEAST_PIXELS = 8;

const parts = (c: ImageCrop | undefined) => ({ left: c?.left ?? 0, top: c?.top ?? 0, right: c?.right ?? 0, bottom: c?.bottom ?? 0 });

/** The side of the picture that is on a side of the screen: a mirrored picture shows its right side on the left. */
export function cropSideOf(screen: CropSide, mirror: Mirrored): CropSide {
  if (screen === "left" || screen === "right") return mirror.h ? (screen === "left" ? "right" : "left") : screen;
  return mirror.v ? (screen === "top" ? "bottom" : "top") : screen;
}

export interface Nudged {
  box: CropBox;
  crop: ImageCrop;
  /** The side of the picture that was cut (as `crop` names it). */
  side: CropSide;
}

/**
 * Cuts `px` pixels off the side of the frame that is on the screen's `side` (a negative number gives back what was cut). The
 * picture keeps its scale, so the frame gets smaller and the opposite edge stays where it is. Null when nothing can change
 * (nothing is left to give back, or the picture can't be cut any more).
 */
export function nudgeCrop(box: CropBox, crop: ImageCrop | undefined, screen: CropSide, px: number, mirror: Mirrored = {}): Nudged | null {
  const c = parts(crop);
  const fullW = box.w / (1 - c.left - c.right);
  const fullH = box.h / (1 - c.top - c.bottom);
  const side = cropSideOf(screen, mirror);
  const horizontal = side === "left" || side === "right";
  const opposite: CropSide = side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top";
  const full = horizontal ? fullW : fullH;
  const room = 1 - LEAST_SHOWN - c[opposite];
  const wanted = Math.min(Math.max(0, c[side] + px / full), Math.max(0, room));
  if (Math.abs(wanted - c[side]) < 1e-9) return null;
  const next = { ...c, [side]: wanted };
  const w = fullW * (1 - next.left - next.right);
  const h = fullH * (1 - next.top - next.bottom);
  if (w < LEAST_PIXELS || h < LEAST_PIXELS) return null;
  // The edge on screen that isn't cut stays put: the frame's left (or top) moves by what the screen's left (top) side lost.
  const leftName = cropSideOf("left", mirror);
  const topName = cropSideOf("top", mirror);
  return {
    box: { left: box.left + (next[leftName] - c[leftName]) * fullW, top: box.top + (next[topName] - c[topName]) * fullH, w, h },
    crop: next,
    side,
  };
}

/** The crop after the picture slides `dx` and `dy` pixels (right and down) under its frame; null when it can't slide that way any more. The frame stays where it is. */
export function panCrop(box: CropBox, crop: ImageCrop | undefined, dx: number, dy: number, mirror: Mirrored = {}): ImageCrop | null {
  const c = parts(crop);
  const fullW = box.w / (1 - c.left - c.right);
  const fullH = box.h / (1 - c.top - c.bottom);
  const sx = Math.min(Math.max(-(mirror.h ? -dx : dx) / fullW, -c.left), c.right);
  const sy = Math.min(Math.max(-(mirror.v ? -dy : dy) / fullH, -c.top), c.bottom);
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return null;
  return { left: c.left + sx, right: c.right - sx, top: c.top + sy, bottom: c.bottom - sy };
}

/** The words a screen reader says about a crop: how much is cut off each side, and what the frame is now. */
export function cropWords(crop: ImageCrop | undefined, box: CropBox): string {
  const c = parts(crop);
  const pct = (v: number) => `${Math.round(v * 1000) / 10} percent`;
  return `Cut off: left ${pct(c.left)}, top ${pct(c.top)}, right ${pct(c.right)}, bottom ${pct(c.bottom)}. The picture is ${Math.round(box.w)} by ${Math.round(box.h)} pixels.`;
}
