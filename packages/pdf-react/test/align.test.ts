import { describe, expect, it } from "vitest";
import { alignMoves, distributeMoves, unionOf, type Box } from "../src/align";

const b = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, box: { x, y, w, h } });
const apply = (boxes: Box[], moves: { id: string; dx: number; dy: number }[]): Box[] =>
  boxes.map((o) => {
    const m = moves.find((x) => x.id === o.id);
    return m ? { id: o.id, box: { ...o.box, x: o.box.x + m.dx, y: o.box.y + m.dy } } : o;
  });

const set = [b("a", 10, 10, 30, 20), b("b", 50, 40, 50, 10), b("c", 120, 70, 20, 40)];

describe("align", () => {
  it("lines the boxes up on the edge or the middle of the box around all of them", () => {
    expect(unionOf(set)).toEqual({ x: 10, y: 10, w: 130, h: 100 });
    const edges = (how: Parameters<typeof alignMoves>[1]) => apply(set, alignMoves(set, how)).map((o) => o.box);
    expect(edges("left").map((r) => r.x)).toEqual([10, 10, 10]);
    expect(edges("right").map((r) => r.x + r.w)).toEqual([140, 140, 140]);
    expect(edges("center").map((r) => r.x + r.w / 2)).toEqual([75, 75, 75]);
    expect(edges("top").map((r) => r.y)).toEqual([10, 10, 10]);
    expect(edges("bottom").map((r) => r.y + r.h)).toEqual([110, 110, 110]);
    expect(edges("middle").map((r) => r.y + r.h / 2)).toEqual([60, 60, 60]);
  });

  it("moves only along one axis, and leaves out what is already in place", () => {
    const moves = alignMoves(set, "left");
    expect(moves.every((m) => m.dy === 0)).toBe(true);
    expect(moves.map((m) => m.id)).toEqual(["b", "c"]);
    expect(alignMoves(apply(set, moves), "left")).toEqual([]);
  });

  it("does nothing with fewer than two boxes", () => {
    expect(alignMoves([], "left")).toEqual([]);
    expect(alignMoves([set[0]!], "top")).toEqual([]);
  });
});

describe("distribute", () => {
  it("makes the gaps equal and keeps the two outer boxes where they are", () => {
    const out = apply(set, distributeMoves(set, "horizontal"));
    const [a, mid, c] = out.map((o) => o.box);
    expect(a!.x).toBe(10);
    expect(c!.x).toBe(120);
    expect(mid!.x - (a!.x + a!.w)).toBeCloseTo(c!.x - (mid!.x + mid!.w), 5);
    const down = apply(set, distributeMoves(set, "vertical")).map((o) => o.box);
    expect(down[1]!.y - (down[0]!.y + down[0]!.h)).toBeCloseTo(down[2]!.y - (down[1]!.y + down[1]!.h), 5);
    expect(down[0]!.y).toBe(10);
    expect(down[2]!.y).toBe(70);
  });

  it("goes by position, not by the order of the list", () => {
    const shuffled = [set[2]!, set[0]!, set[1]!];
    const out = apply(shuffled, distributeMoves(shuffled, "horizontal"));
    expect(out.find((o) => o.id === "b")!.box.x).toBeCloseTo(apply(set, distributeMoves(set, "horizontal")).find((o) => o.id === "b")!.box.x, 5);
  });

  it("spreads many boxes evenly, and handles overlapping ones", () => {
    const row = [b("1", 0, 0, 10, 10), b("2", 5, 0, 10, 10), b("3", 7, 0, 10, 10), b("4", 100, 0, 10, 10)];
    const out = apply(row, distributeMoves(row, "horizontal")).map((o) => o.box);
    const gaps = out.slice(1).map((r, i) => r.x - (out[i]!.x + out[i]!.w));
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 1);
    expect(out[0]!.x).toBe(0);
    expect(out[3]!.x).toBe(100);
  });

  it("needs three boxes", () => {
    expect(distributeMoves(set.slice(0, 2), "horizontal")).toEqual([]);
  });
});
