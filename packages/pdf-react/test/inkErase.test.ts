import { describe, expect, it } from "vitest";
import type { Pt } from "@pli.dev/pdf";
import { distToSegment, eraseStroke, eraseStrokes, erasedRanges } from "../src/inkErase";

const line: Pt[] = [
  [0, 0],
  [100, 0],
];
const length = (s: readonly Pt[]) => s.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - s[i]![0], p[1] - s[i]![1]), 0);

describe("distance to a segment", () => {
  it("is the straight distance, or the distance to an end", () => {
    expect(distToSegment([50, 10], [0, 0], [100, 0])).toBe(10);
    expect(distToSegment([-3, 4], [0, 0], [100, 0])).toBe(5);
    expect(distToSegment([5, 5], [0, 0], [0, 0])).toBeCloseTo(Math.hypot(5, 5), 9);
  });
});

describe("the erased ranges of a segment", () => {
  it("finds where the eraser's reach crosses the line", () => {
    const [r] = erasedRanges([0, 0], [100, 0], [50, 5], [50, 5], 10);
    expect(r![0]).toBeCloseTo((50 - Math.sqrt(75)) / 100, 3);
    expect(r![1]).toBeCloseTo((50 + Math.sqrt(75)) / 100, 3);
  });

  it("finds nothing when the eraser stays away, and the whole line when it lies along it", () => {
    expect(erasedRanges([0, 0], [100, 0], [50, 30], [60, 30], 10)).toEqual([]);
    expect(erasedRanges([0, 0], [100, 0], [-20, 0], [120, 0], 5)).toEqual([[0, 1]]);
  });

  it("finds the stretch a crossing eraser covers", () => {
    expect(erasedRanges([0, 0], [100, 0], [30, -20], [30, 20], 4)).toHaveLength(1);
  });
});

describe("erasing a stroke", () => {
  it("cuts a stroke in two where the eraser crosses it, with the cut ends on the old line", () => {
    const pieces = eraseStroke(line, [50, -10], [50, 10], 5)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]![0]).toEqual([0, 0]);
    expect(pieces[0]![pieces[0]!.length - 1]![0]).toBeCloseTo(45, 1);
    expect(pieces[1]![0]![0]).toBeCloseTo(55, 1);
    expect(pieces[1]![pieces[1]!.length - 1]).toEqual([100, 0]);
    for (const p of pieces.flat()) expect(p[1]).toBe(0);
  });

  it("shortens a stroke at its end and keeps one piece", () => {
    const pieces = eraseStroke(line, [100, 0], [100, 0], 10)!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]![pieces[0]!.length - 1]![0]).toBeCloseTo(90, 1);
  });

  it("removes a stroke that is all within reach, and says it touched nothing when it did not", () => {
    expect(eraseStroke([[0, 0], [4, 0]], [2, 0], [2, 0], 10)).toEqual([]);
    expect(eraseStroke(line, [50, 50], [60, 50], 5)).toBeNull();
    expect(eraseStroke([[10, 10]], [10, 12], [10, 12], 5)).toEqual([]);
    expect(eraseStroke([[10, 10]], [50, 50], [50, 50], 5)).toBeNull();
  });

  it("follows bends: the vertices that are kept stay, and pieces keep the old shape", () => {
    const bent: Pt[] = [[0, 0], [50, 0], [50, 50], [100, 50]];
    const pieces = eraseStroke(bent, [50, 25], [50, 25], 5)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual([[0, 0], [50, 0], [50, 20]]);
    expect(pieces[1]).toEqual([[50, 30], [50, 50], [100, 50]]);
  });

  it("keeps what is left after the eraser took the start", () => {
    const pieces = eraseStroke([[0, 0], [10, 0]], [0, 0], [4, 0], 1)!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0]![0]![0]).toBeCloseTo(5, 1);
  });

  it("does not lose length it should not: what is left plus what the eraser covered is the stroke", () => {
    const pieces = eraseStroke(line, [30, 0], [60, 0], 5)!;
    const left = pieces.reduce((n, p) => n + length(p), 0);
    expect(left).toBeCloseTo(100 - (60 - 30 + 10), 1);
  });
});

describe("erasing a drawing", () => {
  it("works on every stroke, and returns null when nothing was touched", () => {
    const strokes: Pt[][] = [line, [[0, 40], [100, 40]], [[0, 80], [100, 80]]];
    expect(eraseStrokes(strokes, [50, 200], [60, 200], 5)).toBeNull();
    const out = eraseStrokes(strokes, [50, -10], [50, 50], 3)!;
    // the first two strokes are cut, the third is as it was
    expect(out).toHaveLength(5);
    expect(out[4]).toEqual([[0, 80], [100, 80]]);
  });

  it("is cumulative: erasing along a path, one stretch at a time, leaves what the whole path leaves", () => {
    let strokes: Pt[][] = [line];
    const path: Pt[] = [[20, 0], [30, 0], [40, 0], [50, 0]];
    for (let i = 1; i < path.length; i++) strokes = eraseStrokes(strokes, path[i - 1]!, path[i]!, 4) ?? strokes;
    const whole = eraseStrokes([line], path[0]!, path[0]!, 4); // not the same path: just the first point
    expect(whole).not.toBeNull();
    expect(strokes).toHaveLength(2);
    expect(strokes[0]![strokes[0]!.length - 1]![0]).toBeCloseTo(16, 1);
    expect(strokes[1]![0]![0]).toBeCloseTo(54, 1);
  });
});
