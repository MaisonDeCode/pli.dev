import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { htmlToFragment } from "../../docs/src/html/import";
import { SheetSession, createWorkbook, iconSvg, parseHtmlTable, r1c1ToA1 } from "../src";

const read = (url: string) => readFileSync(new URL(url, import.meta.url), "utf8");
const EXCEL_RANGE = read("../../docs/test/fixtures/clipboard/excel-range/text.html");
const EXCEL_FORMULAS = read("./fixtures/clipboard/excel-formulas.html");
const SHEETS_FORMULAS = read("./fixtures/clipboard/sheets-formulas.html");

const make = () => new SheetSession(createWorkbook("T", ["Sheet1", "Sheet2"]), { now: () => 45_000.5 });
const sheetOf = (s: SheetSession, i = 0) => s.state.sheets[i]!;

describe("column widths and row heights from the source", () => {
  it("reads <col> widths and row heights from Excel's HTML, in pixels", () => {
    const t = parseHtmlTable(EXCEL_RANGE)!;
    expect(t.cols).toEqual([143, 184, 236, 21, 71, 71]);
    expect(t.heights?.slice(0, 3)).toEqual([35, 32, 29]);
    expect(t.rows[0]![0]).toMatchObject({ width: 143, height: 35 });
  });

  it("reads Google Sheets' <col> widths and row heights from style", () => {
    const t = parseHtmlTable(SHEETS_FORMULAS)!;
    expect(t.cols).toEqual([120, 100, 100]);
    expect(t.heights).toEqual([21, 35, 21]);
  });

  it("brings them into empty space by default, in one undo step", () => {
    const s = make();
    s.pasteHtml("Sheet1", "B2", EXCEL_RANGE);
    // 143px is (143 - 5) / 7 characters wide; 35px is 26.25pt high.
    expect(sheetOf(s).columns).toMatchObject({ B: { size: 19.71 }, C: { size: 25.57 }, D: { size: 33 }, E: { size: 2.29 }, F: { size: 9.43 }, G: { size: 9.43 } });
    expect(sheetOf(s).columns!["A"]).toBeUndefined();
    expect(sheetOf(s).rows).toMatchObject({ "2": { size: 26.25 }, "3": { size: 24 }, "4": { size: 21.75 }, "5": { size: 30 } });
    s.undo();
    expect(sheetOf(s).columns).toBeUndefined();
    expect(sheetOf(s).rows).toBeUndefined();
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
  });

  it("leaves a paste onto cells, and a column with a width of its own, alone unless asked", () => {
    const s = make();
    s.setCell("Sheet1", "C3", "x");
    s.pasteHtml("Sheet1", "B2", EXCEL_RANGE);
    expect(sheetOf(s).columns).toBeUndefined();
    const t = make();
    t.setColumnWidth("Sheet1", 2, 30);
    t.pasteHtml("Sheet1", "B2", EXCEL_RANGE);
    expect(sheetOf(t).columns!["B"]).toEqual({ size: 30 });
    expect(sheetOf(t).columns!["C"]).toEqual({ size: 25.57 });
    // Keep source column widths overrides both.
    s.pasteHtml("Sheet1", "B2", EXCEL_RANGE, { widths: true });
    expect(sheetOf(s).columns).toMatchObject({ B: { size: 19.71 }, C: { size: 25.57 } });
    const u = make();
    u.pasteHtml("Sheet1", "B2", EXCEL_RANGE, { widths: false });
    expect(sheetOf(u).columns).toBeUndefined();
  });

  it("does not take the sizes along with a paste of values or formulas only", () => {
    const s = make();
    s.pasteHtml("Sheet1", "B2", EXCEL_RANGE, { content: "values" });
    expect(sheetOf(s).columns).toBeUndefined();
    expect(s.value("Sheet1", "B3")).toBe("MAKE A LIST");
  });

  it("copying out writes the sizes, and pasting that brings them back", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", "b"], ["c", "d"]]);
    s.setColumnWidth("Sheet1", 1, 20);
    s.setRowHeight("Sheet1", 2, 30);
    const html = s.toHtml("Sheet1", "A1:B2");
    expect(html).toContain('<col width="145" style="width:145px">');
    expect(html).toContain('<tr height="40" style="height:40px">');
    s.pasteHtml("Sheet2", "C3", html);
    expect(sheetOf(s, 1).columns).toEqual({ C: { size: 20 } }); // B is the default width
    expect(sheetOf(s, 1).rows).toEqual({ "4": { size: 30 } });
  });

  it("a copy made here brings sizes only when asked", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", "b"]]);
    s.setColumnWidth("Sheet1", 1, 20);
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet2", at: "C1" });
    expect(sheetOf(s, 1).columns).toBeUndefined();
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet2", at: "C1" }, { widths: true });
    expect(sheetOf(s, 1).columns).toEqual({ C: { size: 20 } });
    s.undo();
    expect(sheetOf(s, 1).columns).toBeUndefined();
    expect(s.value("Sheet2", "C1")).toBe("a"); // the first copy is still there
  });
});

describe("r1c1ToA1", () => {
  it("turns relative, absolute and mixed references into A1 at a cell", () => {
    expect(r1c1ToA1("=R[-3]C[0]:R[-1]C[0]", 4, 3)).toBe("=C1:C3");
    expect(r1c1ToA1("=RC[-2]+RC[-1]", 2, 5)).toBe("=C2+D2");
    expect(r1c1ToA1("=R1C1+R[1]C2+R2C[1]", 5, 5)).toBe("=$A$1+$B6+F$2");
    expect(r1c1ToA1("=SUM(R[-1]C:R[-4]C)*ROW()+COUNT(R2:R5)+SUM(C3:C4)", 6, 2)).toBe("=SUM(B5:B2)*ROW()+COUNT($2:$5)+SUM($C:$D)");
  });
  it("leaves text, sheet names and function names alone, and flags a reference off the sheet", () => {
    expect(r1c1ToA1('="R1C1"&\'R2C2 sheet\'!R[0]C[1]&LOG10(R[0]C)', 3, 3)).toBe('="R1C1"&\'R2C2 sheet\'!D3&LOG10(C3)');
    expect(r1c1ToA1("=R[-5]C", 3, 3)).toBe("=#REF!");
  });
});

describe("formulas from Excel and Google Sheets", () => {
  it("reads x:fmla and data-sheets-formula", () => {
    const e = parseHtmlTable(EXCEL_FORMULAS)!;
    expect(e.rows[0]![2]!.formula).toEqual({ text: "=B2+C2", r1c1: false });
    expect(e.rows[0]![0]!.formula).toBeUndefined();
    const g = parseHtmlTable(SHEETS_FORMULAS)!;
    expect(g.rows[2]![0]!.formula).toEqual({ text: "=SUM(R[-2]C[0]:R[-1]C[0])", r1c1: true });
  });

  it("brings Excel's formulas, shifted to where they land (the source's position is worked out from the values)", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["keep"]]);
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "F10", EXCEL_FORMULAS, { notes });
    expect(notes).toEqual([]);
    expect(s.cell("Sheet1", "H10")).toMatchObject({ f: "F10+G10" });
    expect(s.cell("Sheet1", "H11")?.f).toBe("F11+G11");
    expect(s.cell("Sheet1", "F12")?.f).toBe("SUM(F10:F11)");
    expect(s.cell("Sheet1", "H12")?.f).toBe("SUM(H10:H11)");
    expect(s.cell("Sheet1", "F10")).toMatchObject({ v: 1 });
    expect(s.values("Sheet1", "F10:H12")).toEqual([[1, 2, 3], [4, 5, 9], [5, 7, 12]]);
    // Changing an input changes the sums: they are formulas now.
    s.setCell("Sheet1", "F10", 100);
    expect(s.value("Sheet1", "H12")).toBe(111);
  });

  it("is one undo step, and works at the source's own place too", () => {
    const s = make();
    s.pasteHtml("Sheet1", "B2", EXCEL_FORMULAS);
    expect(s.cell("Sheet1", "D2")?.f).toBe("B2+C2");
    s.undo();
    expect(s.cell("Sheet1", "D2")).toBeUndefined();
  });

  it("uses the source's position when it is given, and then brings formulas that point outside the copy too", () => {
    const html = '<table><tr><td x:num="5">5</td><td x:num="10" x:fmla="=A1*Rate">10</td><td x:num="8" x:fmla="=$A$1+A2">8</td></tr></table>';
    const s = make();
    s.defineName("Rate", "2");
    s.pasteHtml("Sheet1", "B5", html, { source: "A1" });
    expect(s.cell("Sheet1", "C5")?.f).toBe("B5*Rate");
    expect(s.cell("Sheet1", "D5")?.f).toBe("$A$1+B6"); // absolute stays, relative moves
  });

  it("leaves a formula as its value when it points outside what was copied, and says so", () => {
    const html = '<table><tr><td x:num="5">5</td><td x:num="10" x:fmla="=A1*Z99">10</td><td x:num="7" x:fmla="=SUM(1,2,4)">7</td></tr></table>';
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "B5", html, { notes });
    expect(s.cell("Sheet1", "C5")).toMatchObject({ v: 10 });
    expect(s.cell("Sheet1", "D5")).toMatchObject({ f: "SUM(1,2,4)" }); // nothing to point outside of
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/1 formula/);
  });

  it("leaves a formula whose values don't agree with what the source showed", () => {
    // B1 says 99 where its formula says 3.
    const html = '<table><tr><td x:num="1">1</td><td x:num="2">2</td><td x:num="99" x:fmla="=A1+B1">99</td></tr></table>';
    const s = make();
    s.pasteHtml("Sheet1", "A1", html);
    expect(s.cell("Sheet1", "C1")).toMatchObject({ v: 99 });
  });

  it("brings Google Sheets' formulas, which are relative to the cell, and leaves the ones Pli can't work out", () => {
    const s = make();
    const notes: string[] = [];
    s.pasteHtml("Sheet1", "C5", SHEETS_FORMULAS, { notes });
    expect(s.cell("Sheet1", "E5")?.f).toBe("C5+D5");
    expect(s.cell("Sheet1", "E6")?.f).toBe("C6+D6");
    expect(s.cell("Sheet1", "C7")?.f).toBe("SUM(C5:C6)");
    expect(s.cell("Sheet1", "D7")?.f).toBe("SUM(D5:D6)");
    expect(s.cell("Sheet1", "E7")).toMatchObject({ v: "n/a" }); // IMPORTRANGE
    expect(notes).toHaveLength(1);
    expect(s.values("Sheet1", "C5:E7")).toEqual([[10, 20, 30], [1, 2, 3], [11, 22, "n/a"]]);
  });

  it("takes Google Sheets' ARRAYFORMULA as the formula, and the cells it fills as its results", () => {
    const html =
      '<table><tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:2}" data-sheets-formula="=ARRAYFORMULA(R[0]C[-1]:R[2]C[-1]*2)">2</td></tr><tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:4}">4</td></tr><tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:6}">6</td></tr></table>';
    const s = make();
    s.setValues("Sheet1", "A1", [[1], [2], [3]]);
    s.pasteHtml("Sheet1", "B1", html);
    expect(s.cell("Sheet1", "B1")).toMatchObject({ f: "A1:A3*2" });
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(s.values("Sheet1", "B1:B3")).toEqual([[2], [4], [6]]);
  });

  it("an Excel array formula (x:fmla-range) fills its range", () => {
    const html = '<table><tr><td x:num="2">2</td><td x:num="2" x:fmla="{=TRANSPOSE(A1:A2)}" x:fmla-range="B1:C1">2</td><td x:num="4">4</td></tr><tr><td x:num="4">4</td><td>x</td><td>y</td></tr></table>';
    const s = make();
    s.pasteHtml("Sheet1", "A1", html);
    expect(s.cell("Sheet1", "B1")?.f).toBe("TRANSPOSE(A1:A2)");
    expect(s.cell("Sheet1", "C1")).toBeUndefined();
  });

  it("Paste values only ignores formulas (and looks, and merged cells)", () => {
    const s = make();
    s.setStyle("Sheet1", "H10", { fill: "#ff0000" });
    s.pasteHtml("Sheet1", "F10", EXCEL_FORMULAS, { content: "values" });
    expect(s.cell("Sheet1", "H10")).toMatchObject({ v: 3, s: { fill: "#ff0000" } });
    expect(s.cell("Sheet1", "H10")?.s?.align).toBeUndefined();
    expect(s.cell("Sheet1", "F12")).toEqual({ v: 5 });
  });

  it("Paste formulas keeps the cells' own looks; Paste formats keeps their contents", () => {
    const s = make();
    s.setCell("Sheet1", "H10", "keep me");
    s.setStyle("Sheet1", "H10", { bold: true });
    s.pasteHtml("Sheet1", "F10", EXCEL_FORMULAS, { content: "formulas" });
    expect(s.cell("Sheet1", "H10")).toEqual({ f: "F10+G10", s: { bold: true } });
    expect(s.cell("Sheet1", "H10")?.s?.align).toBeUndefined();
    const t = make();
    t.setCell("Sheet1", "A1", "mine");
    t.pasteHtml("Sheet1", "A1", '<table><tr><td style="font-weight:bold;background-color:#ffee00">theirs</td></tr></table>', { content: "formats" });
    expect(t.cell("Sheet1", "A1")).toEqual({ v: "mine", s: { bold: true, fill: "#ffee00" } });
  });
});

/** A workbook with a table at A1:C4 (header, two rows, totals) and a calculated column. */
function withTable() {
  const s = make();
  s.setValues("Sheet1", "A1", [["Item", "Qty", "Cost"], ["pen", 2, null], ["ink", 3, null], ["Total", null, null]]);
  s.createTable("Sheet1", "A1:C4", { name: "Sales", style: "TableStyleMedium9" });
  const t = s.tables("Sheet1")[0]!;
  s.session.transact([{ type: "update_table", sheet: s.state.sheets[0]!.id, table: { ...t, totals: true, bandedColumns: true } }]);
  s.setCell("Sheet1", "C2", "=[@Qty]*10");
  s.setCell("Sheet1", "C4", "=SUM(Sales[Cost])");
  s.setCell("Sheet1", "B4", "=SUM(Sales[Qty])");
  return s;
}

describe("copying a table as a table", () => {
  it("a copy made here creates a new table: its own name, the style, calculated columns, totals and header", () => {
    const s = withTable();
    expect(s.values("Sheet1", "C2:C4")).toEqual([[20], [30], [50]]);
    s.copy({ sheet: "Sheet1", range: "A1:C4" }, { sheet: "Sheet1", at: "E1" });
    const tables = s.tables("Sheet1");
    expect(tables.map((t) => t.name)).toEqual(["Sales", "Sales2"]);
    expect(tables[1]).toMatchObject({ range: "E1:G4", style: "TableStyleMedium9", totals: true, bandedColumns: true, calculated: { Cost: expect.any(String) } });
    expect(tables[1]!.id).not.toBe(tables[0]!.id);
    // Its own totals add up its own column.
    expect(s.cell("Sheet1", "G4")?.f).toBe("SUM(Sales2[Cost])");
    expect(s.cell("Sheet1", "F4")?.f).toBe("SUM(Sales2[Qty])");
    s.setCell("Sheet1", "F2", 5);
    expect(s.value("Sheet1", "G2")).toBe(50);
    expect(s.value("Sheet1", "G4")).toBe(80);
    expect(s.value("Sheet1", "C4")).toBe(50); // the original is untouched
    s.undo();
    s.undo();
    expect(s.tables("Sheet1")).toHaveLength(1);
    expect(s.cell("Sheet1", "E1")).toBeUndefined();
  });

  it("is one undo step: the cells and the table go together", () => {
    const s = withTable();
    s.copy({ sheet: "Sheet1", range: "A1:C4" }, { sheet: "Sheet1", at: "E1" });
    s.undo();
    expect(s.tables("Sheet1")).toHaveLength(1);
    expect(s.cell("Sheet1", "E1")).toBeUndefined();
  });

  it("leaves out the filter and the sort, and works on another sheet", () => {
    const s = withTable();
    s.filterTable("Sales", "Item", ["pen"]);
    s.copy({ sheet: "Sheet1", range: "A1:C4" }, { sheet: "Sheet2", at: "B2" });
    const t = s.tables("Sheet2")[0]!;
    expect(t.name).toBe("Sales2");
    expect(t.range).toBe("B2:D5");
    expect(t.filters).toBeUndefined();
    expect(t.sort).toBeUndefined();
  });

  it("copies a table with a range around it, but not part of one, and not onto another table", () => {
    const s = withTable();
    s.setCell("Sheet1", "A8", "note");
    s.copy({ sheet: "Sheet1", range: "A1:C8" }, { sheet: "Sheet2", at: "A1" });
    expect(s.tables("Sheet2")[0]?.range).toBe("A1:C4");
    expect(s.value("Sheet2", "A8")).toBe("note");
    s.copy({ sheet: "Sheet1", range: "A1:B4" }, { sheet: "Sheet2", at: "A10" });
    expect(s.tables("Sheet2")).toHaveLength(1); // two of three columns is no table
    s.copy({ sheet: "Sheet1", range: "A1:C4" }, { sheet: "Sheet2", at: "B2" });
    expect(s.tables("Sheet2")).toHaveLength(1); // that would overlap the table that is there
    expect(s.value("Sheet2", "B2")).toBe("Item"); // but the cells came
  });

  it("can be pasted as the cells it is made of", () => {
    const s = withTable();
    s.copy({ sheet: "Sheet1", range: "A1:C4" }, { sheet: "Sheet2", at: "A1" }, { asRange: true });
    expect(s.tables("Sheet2")).toEqual([]);
    expect(s.value("Sheet2", "C4")).toBe(50);
  });

  it("paste values only brings no table", () => {
    const s = withTable();
    s.copy({ sheet: "Sheet1", range: "A1:C4" }, { sheet: "Sheet2", at: "A1" }, { content: "values" });
    expect(s.tables("Sheet2")).toEqual([]);
    expect(s.cell("Sheet2", "C2")).toEqual({ v: 20 });
  });

  it("cutting a whole table moves it (to another sheet too), keeping its name", () => {
    const s = withTable();
    s.move({ sheet: "Sheet1", range: "A1:C4" }, { sheet: "Sheet1", at: "E5" });
    expect(s.tables("Sheet1").map((t) => [t.name, t.range])).toEqual([["Sales", "E5:G8"]]);
    expect(s.value("Sheet1", "G8")).toBe(50);
    s.move({ sheet: "Sheet1", range: "E5:G8" }, { sheet: "Sheet2", at: "A1" });
    expect(s.tables("Sheet1")).toEqual([]);
    expect(s.tables("Sheet2").map((t) => [t.name, t.range])).toEqual([["Sales", "A1:C4"]]);
    expect(s.value("Sheet2", "C4")).toBe(50);
    s.undo();
    expect(s.tables("Sheet1").map((t) => t.range)).toEqual(["E5:G8"]);
  });

  it("the HTML a copy writes marks the table, with <th> for its header", () => {
    const s = withTable();
    const html = s.toHtml("Sheet1", "A1:C4");
    expect(html).toMatch(/<table data-pli-tables="/);
    expect((html.match(/<th/g) ?? []).length).toBe(3);
    const t = parseHtmlTable(html)!;
    expect(t.tables).toEqual([expect.objectContaining({ name: "Sales", row: 0, col: 0, rows: 4, cols: 3, columns: ["Item", "Qty", "Cost"], style: "TableStyleMedium9", totals: true, bandedColumns: true })]);
    // A range with no table is a plain table, and a part of one isn't marked.
    expect(s.toHtml("Sheet1", "E1:F2")).toMatch(/^<meta charset="utf-8"><table>/);
    expect(s.toHtml("Sheet1", "A1:B4")).not.toContain("data-pli-tables");
    expect(s.toHtml("Sheet1", "A1:B4")).not.toContain("<th");
  });

  it("pasting that HTML recreates the table: the same name when it is free, a new one when not", () => {
    const s = withTable();
    const html = s.toHtml("Sheet1", "A1:C4");
    const other = make();
    other.pasteHtml("Sheet1", "B2", html);
    const t = other.tables("Sheet1")[0]!;
    expect(t).toMatchObject({ name: "Sales", range: "B2:D5", style: "TableStyleMedium9", totals: true, bandedColumns: true });
    expect(other.value("Sheet1", "B2")).toBe("Item");
    // The look the style gives was in the HTML as colours; the table gives it, so it isn't kept on the cells too.
    expect(other.cell("Sheet1", "B2")?.s?.fill).toBeUndefined();
    s.pasteHtml("Sheet2", "A1", html);
    expect(s.tables("Sheet2")[0]!.name).toBe("Sales2");
    other.undo();
    expect(other.tables("Sheet1")).toEqual([]);
  });

  it("pasting as a range, or a plain table with <th>, makes no table", () => {
    const s = withTable();
    const html = s.toHtml("Sheet1", "A1:C4");
    const other = make();
    other.pasteHtml("Sheet1", "A1", html, { asRange: true });
    expect(other.tables("Sheet1")).toEqual([]);
    expect(other.cell("Sheet1", "A1")?.s?.fill).toBeDefined(); // the table style's colours stay on the cells
    const plain = make();
    plain.pasteHtml("Sheet1", "A1", "<table><tr><th>Name</th><th>Qty</th></tr><tr><td>a</td><td>1</td></tr></table>");
    expect(plain.tables("Sheet1")).toEqual([]);
  });

  it("header cells say how they look, so a <th> reader does not change them", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Name", "Qty"], ["a", 1]]);
    s.createTable("Sheet1", "A1:B2", { name: "Plain", style: "none" });
    const t = parseHtmlTable(s.toHtml("Sheet1", "A1:B2"))!;
    expect(t.rows[0]![0]!.style).toEqual({ align: "left" }); // not bold, not centred
    const other = make();
    other.pasteHtml("Sheet1", "A1", s.toHtml("Sheet1", "A1:B2"));
    expect(other.cell("Sheet1", "A1")?.s?.bold).toBeUndefined();
    expect(other.tables("Sheet1")[0]?.name).toBe("Plain");
  });
});

describe("data bars, icons and diagonal borders in copied HTML", () => {
  const withBars = () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[0], [50], [100]]);
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:A3"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" } as never);
    return s;
  };

  it("writes a data bar as a gradient the width of the bar", () => {
    const html = withBars().toHtml("Sheet1", "A1:A3");
    expect(html.split("</td>")[0]).not.toContain("linear-gradient"); // the lowest bar is empty
    expect(html).toContain("linear-gradient(90deg,transparent 0%,#638ec6 0%,");
    expect(html).toMatch(/transparent 50%\)/); // the middle one stops at half
    expect(html).toMatch(/transparent 100%\)/);
    expect(html).toContain("background-repeat:no-repeat");
  });

  it("a solid bar is one colour, a bar with a zero line draws the line", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[-10], [10]]);
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:A2"], min: { type: "min" }, max: { type: "max" }, color: "#00aa00", negativeColor: "#aa0000", solid: true, axisColor: "#444444" } as never);
    const html = s.toHtml("Sheet1", "A1:A2");
    expect(html).toContain("#00aa00 50%,#00aa00 100%,transparent 100%");
    expect(html).toContain("#aa0000 0%,#aa0000 50%,transparent 50%");
    expect(html).toContain("#444444 50%,#444444 calc(50% + 1px)");
  });

  it("writes an icon as a picture in the cell's background, with room for it", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[5], [50], [500]]);
    s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["A1:A3"], thresholds: [{ type: "num", value: 10 }, { type: "num", value: 100 }] } as never);
    const html = s.toHtml("Sheet1", "A1:A3");
    expect((html.match(/data:image\/svg\+xml,/g) ?? []).length).toBe(3);
    expect(html).toContain("padding-left:22px");
    expect(html).toContain("background-position:4px center");
    const svgs = [...html.matchAll(/data:image\/svg\+xml,([^")]*)/g)].map((m) => decodeURIComponent(m[1]!));
    expect(svgs[0]).toContain("#e5484d"); // red, the lowest
    expect(svgs[2]).toContain("#2f9e44"); // green, the highest
    // Pasting that back does not turn the picture into a cell picture or a fill.
    const t = make();
    t.pasteHtml("Sheet1", "A1", html);
    expect(t.cell("Sheet1", "A1")).toEqual({ v: 5, s: { align: "right" } });
  });

  it("hides the value when the rule says so", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[5]]);
    s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["A1"], thresholds: [{ type: "num", value: 10 }, { type: "num", value: 100 }], hideValue: true } as never);
    expect(s.toHtml("Sheet1", "A1")).toContain("></td>");
  });

  it("every icon of every set draws", () => {
    for (const [set, count] of [["3Arrows", 3], ["4Arrows", 4], ["5Arrows", 5], ["3ArrowsGray", 3], ["4ArrowsGray", 4], ["5ArrowsGray", 5], ["3Flags", 3], ["3TrafficLights1", 3], ["3TrafficLights2", 3], ["3Signs", 3], ["3Symbols", 3], ["3Symbols2", 3], ["4RedToBlack", 4], ["4Rating", 4], ["4TrafficLights", 4], ["5Rating", 5], ["5Quarters", 5], ["3Stars", 3], ["3Triangles", 3], ["5Boxes", 5]] as const)
      for (let i = 0; i < count; i++) expect(iconSvg(set, i, count)).toMatch(/^<svg [^>]*><(g|circle|path|rect)/);
  });

  it("writes diagonal borders as gradient lines (and Excel's mso-diagonal), and reads them back", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["x", "y"]]);
    s.setBorders("Sheet1", "A1", "diagonalDown", { style: "thin", color: "#ff0000" });
    s.setBorders("Sheet1", "A1", "diagonalUp", { style: "thick" });
    s.setBorders("Sheet1", "B1", "diagonalUp", { style: "dashed", color: "#0000ff" });
    const html = s.toHtml("Sheet1", "A1:B1");
    expect(html).toContain("linear-gradient(to top right,transparent calc(50% - 0.5px),#ff0000 calc(50% - 0.5px)");
    expect(html).toContain("linear-gradient(to bottom right,transparent calc(50% - 1.5px),#000000");
    expect(html).toContain("mso-diagonal-down:0.75pt solid #ff0000");
    expect(html).toContain("mso-diagonal-up:2.25pt solid windowtext");
    s.pasteHtml("Sheet2", "C3", html);
    expect(s.cell("Sheet2", "C3")?.s?.border).toEqual({ diagonalDown: { style: "thin", color: "#ff0000" }, diagonalUp: { style: "thick" } });
    expect(s.cell("Sheet2", "D3")?.s?.border).toEqual({ diagonalUp: { style: "dashed", color: "#0000ff" } });
  });

  it("reads Excel's own diagonal borders, and the gradient when the mso lines are gone", () => {
    const t = parseHtmlTable('<table><tr><td style="mso-diagonal-down:.5pt solid windowtext;mso-diagonal-up:1.5pt dotted #00ff00">a</td><td style="background-image:linear-gradient(to top right,transparent calc(50% - 1px),#336699 calc(50% - 1px),#336699 calc(50% + 1px),transparent calc(50% + 1px))">b</td></tr></table>')!;
    expect(t.rows[0]![0]!.style.border).toEqual({ diagonalDown: { style: "thin" }, diagonalUp: { style: "dotted", color: "#00ff00" } });
    expect(t.rows[0]![1]!.style.border).toEqual({ diagonalDown: { style: "medium", color: "#336699" } });
    expect(t.rows[0]![1]!.style.fill).toBeUndefined();
  });

  it("draws diagonals and bars on merged cells and in print too", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["m", null]]);
    s.mergeCells("Sheet1", "A1:B1");
    s.setBorders("Sheet1", "A1", "diagonalDown", { style: "thin" });
    expect(s.toHtml("Sheet1", "A1:B1")).toContain("linear-gradient(to top right");
  });
});

describe("a copied table in Pli.Documents", () => {
  it("arrives as a table with a header row and the widths of its columns", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Name", "Qty"], ["a", 1]]);
    s.createTable("Sheet1", "A1:B2", { name: "Tbl" });
    s.setColumnWidth("Sheet1", 1, 20);
    const fragment = htmlToFragment(s.toHtml("Sheet1", "A1:B2")) as { blocks: { type: string; headerRow?: boolean; columns?: number[] }[] };
    expect(fragment.blocks[0]).toMatchObject({ type: "table", headerRow: true });
    expect(fragment.blocks[0]!.columns![0]).toBeGreaterThan(0.6);
  });
});
