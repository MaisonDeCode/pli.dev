import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, formatValue } from "../src";

const show = (v: number | string, fmt: string) => formatValue(v, fmt).text;

describe("fractions in number formats", () => {
  it.each([
    [3.5, "# ?/?", "3 1/2"],
    [0.5, "# ?/?", " 1/2"],
    [3, "# ?/?", "3    "],
    [2.75, "# ?/4", "2 3/4"],
    [0.125, "?/8", "1/8"],
    [2.5, "?/?", "5/2"],
    [1.2, "# ??/??", "1  1/5 "],
    [-2.5, "# ?/?", "-2 1/2"],
    [0.999, "# ?/?", "1    "],
    [Math.PI, "# ?/?", "3 1/7"],
    [Math.PI, "# ??/??", "3 14/99"],
    [Math.PI, "# ???/???", "3  16/113"],
    [0.3333, "# ??/??", "  1/3 "],
    [4.5, "0 ?/?", "4 1/2"],
    [0.25, "0 ?/?", "0 1/4"],
    [1234.5, "#,##0 ?/?", "1,234 1/2"],
    [0.75, "# ?/16", " 12/16"],
    [3.04, "# ?/8", "3    "],
    [7, "?/?", "7/1"],
  ])("%s as %s is %j", (value, fmt, want) => {
    expect(show(value, fmt)).toBe(want);
  });

  it("takes text around the fraction, and sections for negatives", () => {
    expect(show(1.5, '# ?/? "in"')).toBe("1 1/2 in");
    expect(show(-1.5, "# ?/?;(# ?/?)")).toBe("(1 1/2)");
  });

  it("is left alone in formats where the slash isn't a fraction", () => {
    expect(show(1234, '0"/"0')).toBe("123/4");
    expect(show(45000, "m/d/yyyy")).toBe("3/15/2023");
  });

  it("works through TEXT and in a cell", () => {
    const s = new SheetSession(createWorkbook("f"));
    s.setCell("Sheet1", "A1", 2.75);
    s.setFormat("Sheet1", "A1", "# ?/?");
    s.setCell("Sheet1", "B1", '=TEXT(A1,"# ??/??")');
    expect(s.display("Sheet1", "A1").text).toBe("2 3/4");
    expect(s.value("Sheet1", "B1")).toBe("2  3/4 ");
  });
});

describe("padding with * in number formats", () => {
  it("says where the fill goes, with one copy of the character in the text", () => {
    const r = formatValue(1234.5, "_($* #,##0.00_)");
    expect(r.text).toBe(" $ 1,234.50 ");
    expect(r.fill).toEqual({ at: 2, char: " " });
  });

  it("repeats any character", () => {
    expect(formatValue(5, "0*-")).toEqual({ text: "5-", fill: { at: 1, char: "-" } });
    expect(formatValue(5, "*.0")).toEqual({ text: ".5", fill: { at: 0, char: "." } });
  });

  it("works in text and negative sections, and with colours", () => {
    expect(formatValue("ab", "@*_")).toEqual({ text: "ab_", fill: { at: 2, char: "_" } });
    expect(formatValue(-3, "0;[Red]-*x0")).toEqual({ text: "-x3", color: "Red", fill: { at: 1, char: "x" } });
  });

  it("is not there for formats without one", () => {
    expect(formatValue(5, "0.00").fill).toBeUndefined();
  });
});
