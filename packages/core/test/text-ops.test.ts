import { describe, expect, it } from "vitest";
import { applyTextOp, applyTextOps, applyTextToString, mapPosition, mapRange, normalizeTextRuns, runsText, transformText, type TextOp, type TextRun } from "../src";

type A = { bold?: boolean; color?: string };

/** A small deterministic random source. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const base: TextRun<A>[] = [{ text: "hello " }, { text: "brave", attrs: { bold: true } }, { text: " new world" }];

function randomOp(rnd: () => number, length: number): TextOp<A> {
  const pick = (n: number) => Math.floor(rnd() * n);
  const kind = pick(3);
  if (kind === 0 || length === 0) return { type: "insert", at: pick(length + 1), text: "abc".slice(0, 1 + pick(3)), ...(rnd() < 0.3 ? { attrs: { color: "red" } } : {}) };
  const from = pick(length);
  const to = from + 1 + pick(Math.min(6, length - from));
  if (kind === 1) return { type: "delete", from, to };
  const attrs = rnd() < 0.5 ? { bold: rnd() < 0.5 ? true : null } : { color: rnd() < 0.5 ? "blue" : null };
  return { type: "format", from, to, attrs };
}

/** A list of edits where each is valid after the one before. */
function randomOps(rnd: () => number, runs: TextRun<A>[], count: number): TextOp<A>[] {
  const ops: TextOp<A>[] = [];
  let current = runs;
  for (let i = 0; i < count; i++) {
    const op = randomOp(rnd, runsText(current).length);
    ops.push(op);
    current = applyTextOp(current, op).runs;
  }
  return ops;
}

describe("applying text edits", () => {
  it("inserts, deletes and formats, keeping attributes with their text", () => {
    let runs = applyTextOps<A>(base, [{ type: "insert", at: 6, text: "very ", attrs: { color: "red" } }]);
    expect(runsText(runs)).toBe("hello very brave new world");
    expect(runs.find((r) => r.text === "very ")?.attrs).toEqual({ color: "red" });
    runs = applyTextOps(runs, [{ type: "delete", from: 0, to: 6 }, { type: "format", from: 0, to: 4, attrs: { bold: true } }]);
    expect(runsText(runs)).toBe("very brave new world");
    expect(runs[0]).toEqual({ text: "very", attrs: { color: "red", bold: true } });
  });

  it("joins neighbours with the same attributes", () => {
    expect(normalizeTextRuns([{ text: "a" }, { text: "", attrs: { bold: true } }, { text: "b", attrs: {} }])).toEqual([{ text: "ab" }]);
  });

  it("works on plain strings", () => {
    expect(applyTextToString("abcdef", [{ type: "delete", from: 1, to: 3 }, { type: "insert", at: 2, text: "XY" }])).toBe("adXYef");
  });

  it("refuses an edit outside the text", () => {
    expect(() => applyTextOp(base, { type: "insert", at: 99, text: "x" })).toThrow(RangeError);
    expect(() => applyTextOp(base, { type: "delete", from: 3, to: 99 })).toThrow(RangeError);
  });

  it("gives an inverse that undoes the edit, attributes included (fuzz)", () => {
    const rnd = random(7);
    for (let i = 0; i < 300; i++) {
      const op = randomOp(rnd, runsText(base).length);
      const { runs, inverse } = applyTextOp(base, op);
      expect(applyTextOps(runs, inverse), JSON.stringify(op)).toEqual(normalizeTextRuns(base));
    }
  });
});

describe("transforming text edits", () => {
  it("puts two inserts at the same place in the order they were accepted", () => {
    const earlier: TextOp[] = [{ type: "insert", at: 2, text: "E" }];
    const later: TextOp[] = [{ type: "insert", at: 2, text: "L" }];
    const [l, e] = transformText(later, earlier);
    expect(applyTextToString(applyTextToString("abcd", earlier), l)).toBe("abELcd");
    expect(applyTextToString(applyTextToString("abcd", later), e)).toBe("abELcd");
  });

  it("keeps text typed inside a range that someone deleted", () => {
    const earlier: TextOp[] = [{ type: "delete", from: 1, to: 5 }];
    const later: TextOp[] = [{ type: "insert", at: 3, text: "X" }];
    const [l, e] = transformText(later, earlier);
    const a = applyTextToString(applyTextToString("abcdefg", earlier), l);
    const b = applyTextToString(applyTextToString("abcdefg", later), e);
    expect(a).toBe(b);
    expect(a).toContain("X");
  });

  it("converges for any two lists of edits (fuzz)", () => {
    for (let seed = 1; seed <= 800; seed++) {
      const rnd = random(seed);
      const earlier = randomOps(rnd, base, 1 + Math.floor(rnd() * 4));
      const later = randomOps(rnd, base, 1 + Math.floor(rnd() * 4));
      const [l, e] = transformText(later, earlier);
      const a = applyTextOps(applyTextOps(base, earlier), l);
      const b = applyTextOps(applyTextOps(base, later), e);
      expect(b, `seed ${seed}`).toEqual(a);
    }
  });
});

describe("mapping positions through edits", () => {
  it("moves a position with the text, and leans the way it was told at an insert", () => {
    const ops: TextOp[] = [{ type: "insert", at: 3, text: "XX" }];
    expect(mapPosition(3, ops)).toBe(5);
    expect(mapPosition(3, ops, -1)).toBe(3);
    expect(mapPosition(2, ops)).toBe(2);
    expect(mapPosition(8, [{ type: "delete", from: 2, to: 6 }])).toBe(4);
    expect(mapPosition(4, [{ type: "delete", from: 2, to: 6 }])).toBe(2);
  });

  it("keeps a range around its text, outside what is typed at its edges, and drops it when its text is gone", () => {
    expect(mapRange({ from: 2, to: 5 }, [{ type: "insert", at: 2, text: "ab" }])).toEqual({ from: 4, to: 7 });
    expect(mapRange({ from: 2, to: 5 }, [{ type: "insert", at: 5, text: "ab" }])).toEqual({ from: 2, to: 5 });
    expect(mapRange({ from: 2, to: 5 }, [{ type: "insert", at: 3, text: "ab" }])).toEqual({ from: 2, to: 7 });
    expect(mapRange({ from: 2, to: 5 }, [{ type: "delete", from: 0, to: 9 }])).toBeNull();
    expect(mapRange({ from: 4, to: 4 }, [{ type: "insert", at: 4, text: "z" }])).toEqual({ from: 5, to: 5 });
  });
});
