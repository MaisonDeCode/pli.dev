import { describe, expect, it } from "vitest";
import { Axis, colPx, colChars, columnAxis, rowAxis, wrapLineCount } from "../src/layout";

describe("Axis", () => {
  it("is arithmetic when nothing is custom", () => {
    const a = new Axis(20, new Map(), 1000);
    expect(a.offset(1)).toBe(0);
    expect(a.offset(11)).toBe(200);
    expect(a.indexAt(0)).toBe(1);
    expect(a.indexAt(199)).toBe(10);
    expect(a.indexAt(200)).toBe(11);
    expect(a.indexAt(1e9)).toBe(1000);
    expect(a.total).toBe(20000);
  });

  it("accounts for items with their own size, including hidden ones", () => {
    const a = new Axis(20, new Map([[3, 50], [5, 0], [8, 30]]), 100);
    expect(a.size(3)).toBe(50);
    expect(a.size(4)).toBe(20);
    expect(a.offset(3)).toBe(40);
    expect(a.offset(4)).toBe(90);
    expect(a.offset(5)).toBe(110);
    expect(a.offset(6)).toBe(110); // 5 is hidden
    expect(a.offset(9)).toBe(110 + 20 + 20 + 30);
    expect(a.indexAt(45)).toBe(3);
    expect(a.indexAt(89)).toBe(3);
    expect(a.indexAt(90)).toBe(4);
    expect(a.indexAt(110)).toBe(6);
    expect(a.total).toBe(100 * 20 + 30 - 20 - 0 + 10);
    for (let i = 1; i <= 100; i++) expect(a.indexAt(a.offset(i) + (a.size(i) > 0 ? a.size(i) - 1 : 0))).toBe(a.size(i) > 0 ? i : a.indexAt(a.offset(i)));
  });

  it("reads sheet dimensions", () => {
    expect(columnAxis({ B: { size: 20 }, D: { hidden: true } }).offset(3)).toBe(64 + colPx(20));
    expect(columnAxis(undefined).offset(27)).toBe(26 * 64);
    expect(rowAxis({ "2": { size: 30 } }).offset(3)).toBe(20 + 40);
    expect(colChars(colPx(12.5))).toBeCloseTo(12.5, 0);
    expect(colPx(8.43)).toBe(64);
  });
});

describe("wrapLineCount", () => {
  const m = (s: string) => s.length * 10; // every character is 10 wide
  it("wraps at spaces, keeps line breaks, and breaks long words", () => {
    expect(wrapLineCount("hello", 100, m)).toBe(1);
    expect(wrapLineCount("hello world", 100, m)).toBe(2); // 110 > 100
    expect(wrapLineCount("hi there you", 100, m)).toBe(2); // "hi there" fits, "you" goes down
    expect(wrapLineCount("one\ntwo\nthree", 500, m)).toBe(3);
    expect(wrapLineCount("", 100, m)).toBe(1);
    expect(wrapLineCount("abcdefghijklmnopqrstuvwxyz", 100, m)).toBe(3);
    expect(wrapLineCount("a b c d e f g h i j k l", 100, m)).toBe(3);
  });

  it("rows can take heights of their own from content, with the sheet's setting winning", () => {
    const a = rowAxis({ "2": { size: 30 } }, new Map([[2, 60], [3, 45]]));
    expect(a.size(2)).toBe(40); // the 30 pt the sheet sets, not the content's
    expect(a.size(3)).toBe(45);
  });
});

import { expectsReference, referencesInText } from "../src/edit";
describe("references in a formula being typed", () => {
  it("finds them with positions and colours, skipping text and function names", () => {
    const refs = referencesInText('=SUM(A1:B2)+LOG10(C3)+"D4"+A1+Sheet2!E5');
    expect(refs.map((r) => [r.start, r.end, r.sheet])).toEqual([[5, 10, undefined], [18, 20, undefined], [27, 29, undefined], [30, 39, "Sheet2"]]);
    expect(refs[0]!.color).toBe(refs[0]!.color);
    expect(refs[0]!.bounds).toEqual({ r1: 1, c1: 1, r2: 2, c2: 2 });
    expect(new Set(refs.map((r) => r.color)).size).toBe(4); // A1:B2, C3, A1, Sheet2!E5 are four references
    expect(referencesInText("not a formula A1")).toEqual([]);
    expect(referencesInText("=$A$1+a1")[1]!.bounds).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(referencesInText("=A1+A1").map((r) => r.color)[0]).toBe(referencesInText("=A1+A1").map((r) => r.color)[1]);
  });

  it("knows when a reference may be typed next", () => {
    expect(expectsReference("=", 1)).toBe(true);
    expect(expectsReference("=SUM(", 5)).toBe(true);
    expect(expectsReference("=A1+", 4)).toBe(true);
    expect(expectsReference("=A1", 3)).toBe(false);
    expect(expectsReference("plain", 5)).toBe(false);
  });
});
