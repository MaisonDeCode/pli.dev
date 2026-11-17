import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseHtmlTable } from "../src";

/*
 * Excel formulas on the clipboard. Excel's HTML carries each formula as the A1 text it has in the source workbook
 * (`x:fmla`) and nothing about where the copied cells were, so Pli has to find that out. These tests document how.
 * The rules, in the order they are tried:
 *   1. `source` in the paste options says where (Paste special > Formulas from Excel…); "here" means "as written".
 *   2. An array formula's `x:fmla-range` is an address in the source workbook, which fixes the position.
 *   3. Otherwise the position that makes every formula that points inside the copied block give the value Excel showed.
 *   Formulas that point outside the block, or that no position fits, are left as the values Excel showed.
 */

const read = (name: string) => readFileSync(new URL(`./fixtures/clipboard/${name}`, import.meta.url), "utf8");
const OFFSET = read("excel-formulas-offset.html"); // copied from D5:F8 of a workbook
const OUTSIDE = read("excel-formulas-outside.html");
const ARRAY_HINT = read("excel-array-hint.html");

const make = () => new SheetSession(createWorkbook("T", ["Sheet1", "Other"]), { now: () => 45_000.5 });

describe("Excel's HTML, a copy of D5:F8 (formulas read as in the source workbook)", () => {
  it("is read with its formulas and number formats", () => {
    const t = parseHtmlTable(OFFSET)!;
    expect(t.rows).toHaveLength(4);
    expect(t.rows[1]![2]!.formula).toEqual({ text: "=D6*E6", r1c1: false });
    expect(t.rows[3]![1]!.formula).toEqual({ text: "=SUM(E6:E7)", r1c1: false });
    expect(t.rows[1]![1]).toMatchObject({ text: "2.50", value: 2.5 });
  });

  it("pasted far from where it was copied, the formulas are shifted by the distance the values show", () => {
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "H20", OFFSET, { notes });
    expect(notes).toEqual([]);
    expect(s.cell("Sheet1", "J21")?.f).toBe("H21*I21");
    expect(s.cell("Sheet1", "J22")?.f).toBe("H22*I22");
    expect(s.cell("Sheet1", "H23")?.f).toBe("SUM(H21:H22)");
    expect(s.cell("Sheet1", "J23")?.f).toBe("SUM(J21:J22)");
    expect(s.values("Sheet1", "H20:J23")).toEqual([["Qty", "Price", "Total"], [3, 2.5, 7.5], [4, 1.25, 5], [7, 3.75, 12.5]]);
    // The sums are live.
    s.setCell("Sheet1", "H21", 10);
    expect(s.value("Sheet1", "J23")).toBe(30);
  });

  it("pasted above and to the left of where it was copied", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", OFFSET);
    expect(s.cell("Sheet1", "C2")?.f).toBe("A2*B2");
    expect(s.cell("Sheet1", "C4")?.f).toBe("SUM(C2:C3)");
  });

  it("pasted where it was copied from, nothing moves", () => {
    const s = make();
    s.pasteHtml("Sheet1", "D5", OFFSET);
    expect(s.cell("Sheet1", "F6")?.f).toBe("D6*E6");
  });

  it("Pasting onto another sheet works the same, and it is one undo step", () => {
    const s = make();
    s.pasteHtml("Other", "C3", OFFSET);
    expect(s.cell("Other", "E4")?.f).toBe("C4*D4");
    s.undo();
    expect(s.cell("Other", "E4")).toBeUndefined();
  });

  it("the formula is worked out by Pli, not taken from the HTML", () => {
    const s = make();
    s.pasteHtml("Sheet1", "H20", OFFSET);
    expect(s.cell("Sheet1", "I21")).toMatchObject({ v: 2.5 });
    expect(s.cell("Sheet1", "J21")).toMatchObject({ f: "H21*I21" });
  });

  it("an ambiguous guess says where the formulas were taken to come from", () => {
    // Every number is 5, so a formula that reads one of them fits several places.
    const html = '<table><tr><td x:num="5">5</td><td x:num="5">5</td><td x:num="5" x:fmla="=C3">5</td></tr></table>';
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "A1", html, { notes });
    expect(notes.join(" ")).toMatch(/more than one place/);
    // The place that moves the references least is taken, but never one that makes a formula read itself.
    expect(s.cell("Sheet1", "C1")?.f).toBe("B1");
  });
});

describe("Excel formulas that point outside what was copied", () => {
  it("are left as the values Excel showed, with a note, when nothing says where they were", () => {
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "H20", OUTSIDE, { notes });
    expect(s.values("Sheet1", "H20:I21")).toEqual([[20, 30], [21, 31]]);
    expect(s.cell("Sheet1", "H20")?.f).toBeUndefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/4 formulas/);
    expect(notes[0]).toMatch(/Paste special/);
  });

  it("are brought when the position is given: copied from A2 means B2 sat one to the right of the copy", () => {
    const s = make();
    s.setValues("Sheet1", "H20", [[1, 2], [3, 4]]);
    s.pasteHtml("Sheet1", "H20", OUTSIDE, { source: "A2" });
    // From A2 to H20 is 18 rows down and 7 columns across: =B2*10 becomes =I20*10.
    expect(s.cell("Sheet1", "H20")?.f).toBe("I20*10");
    expect(s.cell("Sheet1", "I21")?.f).toBe("I21*10+1");
  });

  it('"here" takes them as written (relative to the paste target), as if copied from where they land', () => {
    const s = make();
    s.pasteHtml("Sheet1", "H20", OUTSIDE, { source: "here" });
    expect(s.cell("Sheet1", "H20")?.f).toBe("B2*10");
    expect(s.cell("Sheet1", "I21")?.f).toBe("B3*10+1");
  });

  it("an array formula says where it was in Excel (x:fmla-range), so its references can be moved without being told", () => {
    const t = parseHtmlTable(ARRAY_HINT)!;
    expect(t.rows[0]![0]!.formula).toEqual({ text: "=C4:C5*10", r1c1: false, array: "E4:E5" });
    const s = make();
    s.setValues("Sheet1", "F20", [[1], [2]]);
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "H20", ARRAY_HINT, { notes });
    // E4 -> H20 is 16 rows down and 3 columns across.
    expect(s.cell("Sheet1", "H20")?.f).toBe("F20:F21*10");
    expect(s.cell("Sheet1", "H21")?.f).toBeUndefined();
    expect(s.values("Sheet1", "H20:H21")).toEqual([[10], [20]]);
    expect(notes).toEqual([]);
  });
});

describe("Excel formulas that Pli cannot work out", () => {
  it("keeps the value of a formula with a function, name or sheet it does not have", () => {
    const html = '<table><tr><td x:num="1">1</td><td x:num="3" x:fmla="=A1+_xlfn.UNKNOWNFUNC(A1)">3</td><td x:num="4" x:fmla="=A1+NoSuchName">4</td><td x:num="5" x:fmla="=A1+Missing!A1">5</td></tr></table>';
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "A1", html, { notes });
    expect(s.values("Sheet1", "A1:D1")).toEqual([[1, 3, 4, 5]]);
    expect(notes[0]).toMatch(/3 formulas/);
  });

  it("brings a formula with the _xlfn. marks Excel puts on newer functions", () => {
    const html = '<table><tr><td x:num="2">2</td><td x:num="21" x:fmla="=_xlfn.CONCAT(A1,1)+0">21</td></tr></table>';
    const s = make();
    s.pasteHtml("Sheet1", "A1", html);
    expect(s.cell("Sheet1", "B1")?.f).toBe("CONCAT(A1,1)+0");
  });
});
