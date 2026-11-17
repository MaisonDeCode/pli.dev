import { clampZoom } from "./geometry";

/**
 * Pinch to zoom with two fingers: the maths, and `PinchTracker`, which follows touch pointers and says what the pages should
 * do. No DOM: the viewer feeds it pointer events of the page scroller.
 *
 * - Zoom follows the distance between the two fingers: twice as far apart, twice the zoom.
 * - The point of the pages under the middle of the fingers stays under it, and moving the middle scrolls the pages (a
 *   two-finger pan), so a pinch can be done anywhere on the screen.
 * - One finger is never touched: it scrolls, or draws, or selects, as it did before.
 */

export interface Point {
  x: number;
  y: number;
}

/** How far apart the fingers must be at the start, in pixels: closer than this and the gesture is too jittery to follow. */
export const MIN_PINCH_DISTANCE = 12;

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The zoom after the fingers went from `startDistance` apart to `now` apart, kept between the least and the most the viewer allows. */
export function pinchZoom(startZoom: number, startDistance: number, now: number): number {
  if (!(startDistance > 0) || !(now > 0)) return clampZoom(startZoom);
  return clampZoom(startZoom * (now / startDistance));
}

/**
 * Where to scroll so the point of the content that is under `anchor` (pixels from the top left of the scrolling area) stays
 * there when the pages get `ratio` times as big.
 */
export function anchoredScroll(scroll: { top: number; left: number }, anchor: Point, ratio: number): { top: number; left: number } {
  return { top: Math.max(0, (scroll.top + anchor.y) * ratio - anchor.y), left: Math.max(0, (scroll.left + anchor.x) * ratio - anchor.x) };
}

export interface PinchUpdate {
  /** The zoom to show now. */
  zoom: number;
  /** The middle of the fingers, in the same coordinates as the pointers fed in. */
  anchor: Point;
  /** How far the middle moved since the last update: scroll the opposite way. */
  pan: Point;
}

/** Follows the touch pointers of one scrolling area. */
export class PinchTracker {
  #points = new Map<number, Point>();
  #pair: [number, number] | null = null;
  #startDistance = 0;
  #startZoom = 1;
  #last: Point = { x: 0, y: 0 };
  #ignored = new Set<number>();

  /** Two fingers are down and being followed. */
  get active(): boolean {
    return this.#pair !== null;
  }

  /** Pointers whose events the tools must not see: the two of a pinch, and a finger left over after one lifts. */
  owns(pointerId: number): boolean {
    return this.#ignored.has(pointerId) || (this.#pair?.includes(pointerId) ?? false);
  }

  /**
   * A finger went down. Returns true when this is the second one, i.e. a pinch begins: the caller drops what the first finger
   * was doing (a stroke, a drag).
   */
  down(id: number, at: Point, zoom: number): boolean {
    this.#points.set(id, at);
    if (this.#pair || this.#points.size < 2) return false;
    const [a, b] = [...this.#points.keys()] as [number, number];
    const d = distance(this.#points.get(a)!, this.#points.get(b)!);
    if (d < MIN_PINCH_DISTANCE) {
      // Too close to measure: only the first finger counts, the second is left alone.
      this.#points.delete(id);
      return false;
    }
    this.#pair = [a, b];
    this.#ignored.add(a).add(b);
    this.#startDistance = d;
    this.#startZoom = zoom;
    this.#last = midpoint(this.#points.get(a)!, this.#points.get(b)!);
    return true;
  }

  /** A finger moved. Returns what the pages should do, or null when this is not part of a pinch. */
  move(id: number, at: Point): PinchUpdate | null {
    if (!this.#points.has(id)) return null;
    this.#points.set(id, at);
    if (!this.#pair || !this.#pair.includes(id)) return null;
    const a = this.#points.get(this.#pair[0])!;
    const b = this.#points.get(this.#pair[1])!;
    const mid = midpoint(a, b);
    const update: PinchUpdate = { zoom: pinchZoom(this.#startZoom, this.#startDistance, distance(a, b)), anchor: mid, pan: { x: mid.x - this.#last.x, y: mid.y - this.#last.y } };
    this.#last = mid;
    return update;
  }

  /** A finger lifted (or the browser took it). Ends the pinch; a finger still down is ignored until it lifts too. */
  up(id: number): void {
    this.#points.delete(id);
    if (this.#pair?.includes(id)) this.#pair = null;
    this.#ignored.delete(id);
    if (!this.#pair && this.#points.size === 0) this.#ignored.clear();
  }

  reset(): void {
    this.#points.clear();
    this.#pair = null;
    this.#ignored.clear();
  }
}
