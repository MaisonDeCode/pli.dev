import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseHtmlTable } from "../src";

/*
 * Google Sheets' clipboard, from the format its copy documents in the markup itself (this repository can't copy from Google
 * Sheets): a `<google-sheets-html-origin>` wrapper, `data-sheets-value` (`1` is the kind: 2 text, 3 number, 4 boolean, 5
 * error), `data-sheets-numberformat`, `data-sheets-formula` (R1C1, relative to the cell), inline styles, links wrapped in
 * Google's redirect. The fixture is built to that description, not captured; what must be checked by hand against the real
 * thing is listed in grid.md.
 */

const SHEETS = readFileSync(new URL("./fixtures/clipboard/google-sheets-range.html", import.meta.url), "utf8");
const make = () => new SheetSession(createWorkbook("T", ["Sheet1", "Other"]), { now: () => 45_000.5 });

describe("Google Sheets' markup", () => {
  const t = parseHtmlTable(SHEETS)!;
  it("gives the shape: columns with widths, rows with heights, spans", () => {
    expect(t.rows.map((r) => r.length)).toEqual([7, 7, 7, 7, 5, 7]);
    expect(t.cols).toEqual([100, 60, 80, 90, 50, 100, 70]);
    expect(t.rows[4]![0]).toMatchObject({ colspan: 3, link: "https://pli.dev/" });
  });

  it("reads exact values of every kind: numbers, booleans (as 1/0 and true/false), text, errors", () => {
    expect(t.rows[1]![1]!.value).toBe(3);
    expect(t.rows[1]![2]!.value).toBe(2.5);
    expect(t.rows[1]![4]!.value).toBe(true);
    expect(t.rows[2]![4]!.value).toBe(false);
    expect(t.rows[1]![5]!.value).toBe(45000);
    expect(parseHtmlTable('<table><tr><td data-sheets-value="{&quot;1&quot;:4,&quot;4&quot;:true}">TRUE</td><td data-sheets-value="{&quot;1&quot;:4,&quot;4&quot;:false}">FALSE</td></tr></table>')!.rows[0]!.map((c) => c.value)).toEqual([true, false]);
  });

  it("reads the number formats Sheets names", () => {
    expect(t.rows[1]![2]!.format).toBe('"$"#,##0.00');
    expect(t.rows[1]![5]!.format).toBe('yyyy"-"mm"-"dd');
    expect(t.rows[1]![6]!.format).toBe("0.0%");
  });

  it("reads formulas in R1C1 and the others as they are", () => {
    expect(t.rows[1]![3]!.formula).toEqual({ text: "=R[0]C[-2]*R[0]C[-1]", r1c1: true });
    expect(t.rows[3]![1]!.formula).toEqual({ text: "=SUM(R[-2]C[0]:R[-1]C[0])", r1c1: true });
    expect(t.rows[5]![2]!.formula).toEqual({ text: "=R2C2", r1c1: true });
  });

  it("reads text in spans, bold, the colour of a span, and line breaks", () => {
    expect(t.rows[5]![0]).toMatchObject({ text: "Bold and red", style: { bold: true } });
    expect(t.rows[4]![1]).toMatchObject({ text: "two\nlines", style: { wrap: true } });
  });
});

describe("pasting it", () => {
  it("brings the values, formats, looks and the merged cells", () => {
    const s = make();
    const range = s.pasteHtml("Sheet1", "A1", SHEETS);
    expect(range).toBe("A1:G6");
    expect(s.cell("Sheet1", "A1")).toMatchObject({ v: "Item", s: { bold: true, fill: "#d9ead3" } });
    expect(s.cell("Sheet1", "C2")).toMatchObject({ v: 2.5, fmt: "$#,##0.00" }); // the format the text reads as when typed, which shows the same
    expect(s.cell("Sheet1", "E2")).toMatchObject({ v: true });
    expect(s.cell("Sheet1", "E3")).toMatchObject({ v: false });
    expect(s.cell("Sheet1", "F2")).toMatchObject({ v: 45000, fmt: "yyyy-mm-dd" });
    expect(s.cell("Sheet1", "G2")).toMatchObject({ v: 0.125, fmt: "0.0%" });
    expect(s.state.sheets[0]!.merges).toEqual(["A5:C5"]);
    expect(s.cell("Sheet1", "A5")).toMatchObject({ link: { to: "https://pli.dev/" } });
    expect(s.cell("Sheet1", "D5")).toMatchObject({ v: "two\nlines" });
    // Sizes come into empty space.
    expect(s.state.sheets[0]!.columns).toMatchObject({ A: { size: 13.57 } });
  });

  it("brings the formulas, read at the cell they land on, whatever the cell", () => {
    for (const at of ["A1", "H10", "C30"]) {
      const s = make();
      const notes: string[] = [];
      s.pasteHtml("Sheet1", at, SHEETS, { notes });
      expect(notes).toEqual([]);
      const row0 = Number(/\d+/.exec(at)![0]);
      const col0 = at.charCodeAt(0) - 64;
      const name = (dc: number) => String.fromCharCode(64 + col0 + dc);
      expect(s.cell("Sheet1", `${name(3)}${row0 + 1}`)?.f).toBe(`${name(1)}${row0 + 1}*${name(2)}${row0 + 1}`);
      expect(s.cell("Sheet1", `${name(1)}${row0 + 3}`)?.f).toBe(`SUM(${name(1)}${row0 + 1}:${name(1)}${row0 + 2})`);
      expect(s.cell("Sheet1", `${name(3)}${row0 + 3}`)?.f).toBe(`SUM(${name(3)}${row0 + 1}:${name(3)}${row0 + 2})`);
      // R2C2 is absolute: it is the same cell, B2, wherever the paste is.
      expect(s.cell("Sheet1", `${name(2)}${row0 + 5}`)?.f).toBe("$B$2");
    }
  });

  it("the formulas work out the same values Sheets showed", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", SHEETS);
    expect(s.value("Sheet1", "D2")).toBe(7.5);
    expect(s.value("Sheet1", "D3")).toBe(5);
    expect(s.value("Sheet1", "B4")).toBe(7);
    expect(s.value("Sheet1", "D4")).toBe(12.5);
    expect(s.value("Sheet1", "G4")).toBe(0.375);
    expect(s.value("Sheet1", "C6")).toBe(3); // R2C2 is B2
    expect(s.value("Sheet1", "D6")).toBe(22);
    expect(s.value("Sheet1", "B6")).toEqual({ error: "#DIV/0!" });
  });

  it("changing an input changes the totals: they are formulas, not the numbers Sheets showed", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", SHEETS);
    s.setCell("Sheet1", "B2", 10);
    expect(s.value("Sheet1", "B4")).toBe(14);
    expect(s.value("Sheet1", "D4")).toBe(30);
  });

  it("is one undo step", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", SHEETS);
    s.undo();
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.state.sheets[0]!.merges).toBeUndefined();
    expect(s.state.sheets[0]!.columns).toBeUndefined();
  });

  it("a Sheets function Pli does not have stays as its value, and the paste says so", () => {
    const html = '<table><tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:4}">4</td><td data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;ok&quot;}" data-sheets-formula="=QUERY(R[0]C[-1]:R[0]C[-1],&quot;select *&quot;)">ok</td></tr></table>';
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "A1", html, { notes });
    expect(s.cell("Sheet1", "B1")).toMatchObject({ v: "ok" });
    expect(s.cell("Sheet1", "B1")?.f).toBeUndefined();
    expect(notes[0]).toMatch(/1 formula/);
  });

  it("a formula that points at another sheet is brought when the sheet is there", () => {
    const html = '<table><tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:9}" data-sheets-formula="=Other!R[2]C[0]">9</td></tr></table>';
    const s = make();
    s.setCell("Other", "A3", 9);
    s.pasteHtml("Sheet1", "A1", html);
    expect(s.cell("Sheet1", "A1")?.f).toBe("Other!A3");
    const t = make();
    t.pasteHtml("Sheet1", "A1", html.replace("Other!", "Gone!"));
    expect(t.cell("Sheet1", "A1")).toMatchObject({ v: 9 });
    expect(t.cell("Sheet1", "A1")?.f).toBeUndefined();
  });

  it("an array formula Sheets wrapped in ARRAYFORMULA spills by itself", () => {
    const cell = (v: number, f = "") => `<td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:${v}}"${f ? ` data-sheets-formula="${f}"` : ""}>${v}</td>`;
    const html = `<table><tr>${cell(1)}${cell(2, "=ARRAYFORMULA(R[0]C[-1]:R[1]C[-1]*2)")}</tr><tr>${cell(2)}${cell(4)}</tr></table>`;
    const s = make();
    s.pasteHtml("Sheet1", "A1", html);
    expect(s.cell("Sheet1", "B1")?.f).toBe("A1:A2*2");
    expect(s.cell("Sheet1", "B2")?.f).toBeUndefined();
    expect(s.values("Sheet1", "B1:B2")).toEqual([[2], [4]]);
  });

  it("transposed: rows become columns, formulas follow", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", SHEETS, { transpose: true });
    // D2 = B2*C2 (two and one to the left) became B4 = B2*B3 (two and one above).
    expect(s.cell("Sheet1", "B4")?.f).toBe("B2*B3");
    expect(s.cell("Sheet1", "D2")?.f).toBe("SUM(B2:C2)");
    expect(s.value("Sheet1", "B4")).toBe(7.5);
    expect(s.value("Sheet1", "A2")).toBe("Qty");
  });
});
