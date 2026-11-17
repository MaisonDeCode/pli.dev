import type { Pt } from "@pli.dev/pdf";

/**
 * Partial erase of pen strokes. The eraser's path is a series of short segments; each stroke loses the parts that are
 * within `radius` of them, and what is left is the same stroke cut into pieces (the cut ends are exact points of the old
 * line, not the old vertices nearest to them). Pure geometry, so the eraser tool and the tests share it.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The distance from a point to a segment. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * The parts of the segment `a`-`b`, as ranges of `t` from 0 (at `a`) to 1 (at `b`), that lie within `radius` of the
 * segment `from`-`to`. Found by looking at points along it, then narrowing each edge to a hair; a chord of the eraser's
 * edge shorter than a third of the radius can be missed, which no one can see.
 */
export function erasedRanges(a: Pt, b: Pt, from: Pt, to: Pt, radius: number): [number, number][] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(length / (radius / 3)));
  const inside = (t: number) => distToSegment(lerp(a, b, t), from, to) <= radius;
  // Where inside and outside meet between two samples: found by halving.
  const edge = (lo: number, hi: number): number => {
    const wasInside = inside(lo);
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid) === wasInside) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const out: [number, number][] = [];
  let start: number | null = inside(0) ? 0 : null;
  for (let i = 1; i <= n; i++) {
    const t0 = (i - 1) / n;
    const t1 = i / n;
    const now = inside(t1);
    if (start === null && now) start = edge(t0, t1);
    else if (start !== null && !now) {
      out.push([start, edge(t0, t1)]);
      start = null;
    }
  }
  if (start !== null) out.push([start, 1]);
  return out;
}

/**
 * One stroke without the parts within `radius` of the segment `from`-`to`: the pieces left (none if it is all gone), or
 * null when the eraser did not touch it.
 */
export function eraseStroke(stroke: readonly Pt[], from: Pt, to: Pt, radius: number): Pt[][] | null {
  if (stroke.length === 0) return null;
  if (stroke.length === 1) return distToSegment(stroke[0]!, from, to) <= radius ? [] : null;
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  let touched = false;
  const add = (p: Pt) => {
    const last = cur[cur.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) cur.push(p);
  };
  const end = () => {
    if (cur.length >= 2) pieces.push(cur);
    cur = [];
  };
  for (let i = 0; i < stroke.length - 1; i++) {
    const a = stroke[i]!;
    const b = stroke[i + 1]!;
    const ranges = erasedRanges(a, b, from, to, radius);
    if (ranges.length > 0) touched = true;
    let at = 0;
    for (const [s, e] of ranges) {
      if (s > at) {
        add(lerp(a, b, at));
        add(lerp(a, b, s));
      }
      end();
      at = e;
    }
    if (at < 1) {
      add(lerp(a, b, at));
      add(b);
    }
  }
  end();
  return touched ? pieces.map((p) => p.map((q): Pt => [round2(q[0]), round2(q[1])])) : null;
}

/**
 * The strokes of a drawing after the eraser went from `from` to `to`, or null when it touched none of them. Pass the
 * result back in for the next stretch of the path: erasing is cumulative.
 */
export function eraseStrokes(strokes: readonly (readonly Pt[])[], from: Pt, to: Pt, radius: number): Pt[][] | null {
  let changed = false;
  const out: Pt[][] = [];
  for (const stroke of strokes) {
    const pieces = eraseStroke(stroke, from, to, radius);
    if (pieces === null) out.push(stroke.map((p): Pt => [p[0], p[1]]));
    else {
      changed = true;
      out.push(...pieces);
    }
  }
  return changed ? out : null;
}
