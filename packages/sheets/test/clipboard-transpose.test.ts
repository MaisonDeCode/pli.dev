import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, transposeFormula } from "../src";

const make = () => new SheetSession(createWorkbook("T", ["Sheet1", "Sheet2"]), { now: () => 45_000.5 });
const at = (row: number, col: number) => ({ row, col });

describe("transposeFormula", () => {
  it("swaps the distance of relative references: the cell on the left becomes the cell above", () => {
    // B1 read A1 (one to the left); the transposed cell A2 reads the one above it, A1.
    expect(transposeFormula("A1", at(1, 2), at(2, 1))).toBe("A1");
    // C1 = A1+B1 (two and one to the left) -> A3 = A1+A2
    expect(transposeFormula("A1+B1", at(1, 3), at(3, 1))).toBe("A1+A2");
    // A3 = A1+A2 (above) -> C1 = A1+B1
    expect(transposeFormula("A1+A2", at(3, 1), at(1, 3))).toBe("A1+B1");
  });

  it("moves with the cell: the block lands somewhere else", () => {
    // Source C1 (=A1+B1), block A1:C1 pasted at F10: C1 -> F12, which reads F10+F11.
    expect(transposeFormula("A1+B1", at(1, 3), at(12, 6))).toBe("F10+F11");
  });

  it("keeps a fully absolute reference, turns a mixed one, and turns ranges and whole columns", () => {
    expect(transposeFormula("$A$1*B1", at(1, 3), at(3, 1))).toBe("$A$1*A2");
    // $A1 (column A always, same row) is "the row on top, same column": A$1
    expect(transposeFormula("$A1", at(2, 3), at(3, 2))).toBe("A$1");
    expect(transposeFormula("SUM(A1:B1)", at(1, 4), at(4, 1))).toBe("SUM(A1:A2)");
    expect(transposeFormula("SUM(A:A)", at(1, 3), at(3, 1))).toBe("SUM(1:1)"); // the column two to the left is the row two above
  });

  it("leaves names, tables, text and other sheets' cells alone except for turning the cells", () => {
    expect(transposeFormula('Rate*B1&"A1"', at(1, 3), at(3, 1))).toBe('Rate*A2&"A1"');
    expect(transposeFormula("Sheet2!B1", at(1, 3), at(3, 1))).toBe("Sheet2!A2");
    expect(transposeFormula("not a formula (", at(1, 1), at(1, 1))).toBe("not a formula (");
  });

  it("a reference pushed off the sheet becomes #REF!", () => {
    expect(transposeFormula("B1", at(5, 5), at(1, 1))).toBe("#REF!");
  });
});

describe("Paste special > Transpose of a copy made here", () => {
  it("turns rows into columns: values, number formats, styles", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2, 3], [4, 5, 6]]);
    s.setStyle("Sheet1", "B1", { bold: true });
    s.setFormat("Sheet1", "C2", "0.00");
    s.copy({ sheet: "Sheet1", range: "A1:C2" }, { sheet: "Sheet1", at: "E1" }, { transpose: true });
    expect(s.values("Sheet1", "E1:F3")).toEqual([[1, 4], [2, 5], [3, 6]]);
    expect(s.cell("Sheet1", "F3")).toMatchObject({ v: 6, fmt: "0.00" });
    expect(s.cell("Sheet1", "E2")).toMatchObject({ v: 2, s: { bold: true } });
  });

  it("is one undo step", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2, 3]]);
    s.copy({ sheet: "Sheet1", range: "A1:C1" }, { sheet: "Sheet1", at: "B3" }, { transpose: true });
    expect(s.values("Sheet1", "B3:B5")).toEqual([[1], [2], [3]]);
    s.undo();
    expect(s.cell("Sheet1", "B3")).toBeUndefined();
    expect(s.cell("Sheet1", "B5")).toBeUndefined();
    s.redo();
    expect(s.value("Sheet1", "B5")).toBe(3);
  });

  it("re-points formulas: the ones that read cells inside the block read their transposed copies", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2, "=A1+B1"], [10, 20, "=SUM(A2:B2)"]]);
    s.setCell("Sheet1", "H1", 7);
    s.setCell("Sheet1", "D1", "=C1*$H$1");
    s.copy({ sheet: "Sheet1", range: "A1:D2" }, { sheet: "Sheet1", at: "A5" }, { transpose: true });
    // Block A1:D2 -> A5:B8. C1 -> A7, D1 -> A8, C2 -> B7.
    expect(s.cell("Sheet1", "A7")?.f).toBe("A5+A6");
    expect(s.cell("Sheet1", "B7")?.f).toBe("SUM(B5:B6)");
    expect(s.cell("Sheet1", "A8")?.f).toBe("A7*$H$1"); // C1*$H$1: one to the left becomes one above; $H$1 stays
    expect(s.values("Sheet1", "A5:B8")).toEqual([[1, 10], [2, 20], [3, 30], [21, null]]);
    // They are formulas: a change shows.
    s.setCell("Sheet1", "A5", 100);
    expect(s.value("Sheet1", "A7")).toBe(102);
  });

  it("works on a block that overlaps itself", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    s.copy({ sheet: "Sheet1", range: "A1:C3" }, { sheet: "Sheet1", at: "A1" }, { transpose: true });
    expect(s.values("Sheet1", "A1:C3")).toEqual([[1, 4, 7], [2, 5, 8], [3, 6, 9]]);
  });

  it("leaves a gap where the source was empty (the cell it lands on is cleared)", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, null, 3]]);
    s.setCell("Sheet1", "A2", "old");
    s.copy({ sheet: "Sheet1", range: "A1:C1" }, { sheet: "Sheet1", at: "A1" }, { transpose: true });
    expect(s.values("Sheet1", "A1:A3")).toEqual([[1], [null], [3]]);
  });

  it("turns borders: a top line becomes a left one, bottom becomes right", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2]]);
    s.setBorders("Sheet1", "A1", "top", { style: "thick", color: "#ff0000" });
    s.setBorders("Sheet1", "B1", "bottom", { style: "thin" });
    s.setBorders("Sheet1", "B1", "diagonalUp", { style: "thin" });
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D1" }, { transpose: true });
    expect(s.cell("Sheet1", "D1")?.s?.border).toEqual({ left: { style: "thick", color: "#ff0000" } });
    expect(s.cell("Sheet1", "D2")?.s?.border).toEqual({ right: { style: "thin" }, diagonalUp: { style: "thin" } });
  });

  it("turns merged cells", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["wide", null, null, "x"], ["a", "b", "c", "d"]]);
    s.mergeCells("Sheet1", "A1:C1");
    s.copy({ sheet: "Sheet1", range: "A1:D2" }, { sheet: "Sheet1", at: "F1" }, { transpose: true });
    expect(s.state.sheets[0]!.merges).toEqual(["A1:C1", "F1:F3"]);
    expect(s.value("Sheet1", "F1")).toBe("wide");
    expect(s.value("Sheet1", "G4")).toBe("d");
  });

  it("refuses to cut a merged range in half or land on merged cells of another shape, saying why", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2], [3, 4]]);
    s.mergeCells("Sheet1", "A1:B1");
    expect(() => s.copy({ sheet: "Sheet1", range: "A1:A2" }, { sheet: "Sheet1", at: "D1" }, { transpose: true })).toThrow(/only part of it/);
    s.unmergeCells("Sheet1", "A1:B1");
    s.mergeCells("Sheet1", "D1:E1");
    expect(() => s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D1" }, { transpose: true })).toThrow(/merged cells/);
  });

  it("turns conditional formats (data bars and icons too) and data validation with the cells", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2, 3, 4]]);
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:D1"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" } as never);
    s.addRule("Sheet1", { kind: "formula", ranges: ["B1:C1"], formula: "A1>1", style: { fill: "#ffff00" } } as never);
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["C1:D1"] });
    s.copy({ sheet: "Sheet1", range: "A1:D1" }, { sheet: "Sheet2", at: "B2" }, { transpose: true });
    const rules = s.conditionalFormats("Sheet2");
    expect(rules.map((r) => [r.kind, r.ranges])).toEqual([["dataBar", ["B2:B5"]], ["formula", ["B3:B4"]]]);
    // "the cell to my left is above 1" turns into "the cell above me is above 1"; the rule's first cell is B3, which reads B2.
    expect(rules[1]).toMatchObject({ formula: "B2>1" });
    expect(s.validations("Sheet2")).toHaveLength(1);
    expect(s.validations("Sheet2")[0]).toMatchObject({ ranges: ["B4:B5"], values: ["1", "10"] });
    // The originals stay.
    expect(s.conditionalFormats("Sheet1")).toHaveLength(2);
  });

  it("replaces the rules that covered the cells pasted over, undone together with the cells", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2]]);
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["D1:D9"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" } as never);
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D2" }, { transpose: true });
    expect(s.conditionalFormats("Sheet1").map((r) => r.ranges)).toEqual([["D1", "D4:D9"]]);
    s.undo();
    expect(s.conditionalFormats("Sheet1").map((r) => r.ranges)).toEqual([["D1:D9"]]);
  });

  it("carries notes and links with the cells, as a copy does", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["site", "plain"]]);
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    s.setNote("Sheet1", "B1", "remember");
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D1" }, { transpose: true });
    expect(s.cell("Sheet1", "D1")?.link).toEqual({ to: "https://pli.dev" });
    expect(s.cell("Sheet1", "D2")?.note).toBe("remember");
  });

  it("transposed values and formulas only: the cells keep their own looks", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, "=A1+1"]]);
    s.setStyle("Sheet1", "D1", { italic: true });
    s.setStyle("Sheet1", "D2", { italic: true });
    s.setStyle("Sheet1", "A1", { bold: true });
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D1" }, { transpose: true, content: "values" });
    expect(s.cell("Sheet1", "D2")).toEqual({ v: 2, s: { italic: true } });
    expect(s.cell("Sheet1", "D1")).toEqual({ v: 1, s: { italic: true } });
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "F1" }, { transpose: true, content: "formulas" });
    expect(s.cell("Sheet1", "F2")?.f).toBe("F1+1");
    expect(s.cell("Sheet1", "F1")?.s).toBeUndefined(); // the bold stays behind
  });

  it("transposed formats only: looks arrive, contents stay", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2]]);
    s.setStyle("Sheet1", "B1", { fill: "#ff0000" });
    s.setValues("Sheet1", "D1", [["keep"], ["keep2"]]);
    s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D1" }, { transpose: true, content: "formats" });
    expect(s.cell("Sheet1", "D2")).toEqual({ v: "keep2", s: { fill: "#ff0000" } });
  });

  it("does not bring a table (it pastes as cells) nor column widths, as in Excel", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Item", "Qty"], ["pen", 2], ["ink", 3]]);
    s.createTable("Sheet1", "A1:B3", { name: "Stock" });
    s.setColumnWidth("Sheet1", 1, 30);
    s.copy({ sheet: "Sheet1", range: "A1:B3" }, { sheet: "Sheet1", at: "E1" }, { transpose: true, widths: true });
    expect(s.tables("Sheet1").map((t) => t.name)).toEqual(["Stock"]);
    expect(s.values("Sheet1", "E1:G2")).toEqual([["Item", "pen", "ink"], ["Qty", 2, 3]]);
    expect(s.state.sheets[0]!.columns).toEqual({ A: { size: 30 } });
  });

  it("a cut with Transpose moves the cells (formulas elsewhere are not rewritten)", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2, 3]]);
    s.copy({ sheet: "Sheet1", range: "A1:C1" }, { sheet: "Sheet1", at: "A3" }, { transpose: true, cut: true });
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.values("Sheet1", "A3:A5")).toEqual([[1], [2], [3]]);
    s.undo();
    expect(s.values("Sheet1", "A1:C1")).toEqual([[1, 2, 3]]);
    expect(s.cell("Sheet1", "A3")).toBeUndefined();
  });

  it("refuses what does not fit on the sheet", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2, 3]]);
    expect(() => s.copy({ sheet: "Sheet1", range: "A1:C1" }, { sheet: "Sheet1", at: "A1048575" }, { transpose: true })).toThrow(/fit/);
  });

  it("a protected sheet refuses a transposed paste onto locked cells", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2]]);
    s.protectSheet("Sheet1", {});
    expect(() => s.copy({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D1" }, { transpose: true })).toThrow();
  });
});

describe("Paste special > Transpose of another program's table or text", () => {
  const EXCEL = '<table><tr><td x:num="1">1</td><td x:num="2" style="border-top:1pt solid #ff0000">2</td><td colspan=2 style="background:#ffff00">wide</td></tr><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>';

  it("turns an HTML table, with its looks and merged cells", () => {
    const s = make();
    const range = s.pasteHtml("Sheet1", "B2", EXCEL, { transpose: true });
    expect(range).toBe("B2:C5");
    expect(s.values("Sheet1", "B2:C5")).toEqual([[1, "a"], [2, "b"], ["wide", "c"], [null, "d"]]);
    expect(s.cell("Sheet1", "B3")?.s?.border).toEqual({ left: { style: "thin", color: "#ff0000" } });
    expect(s.state.sheets[0]!.merges).toEqual(["B4:B5"]);
    expect(s.cell("Sheet1", "B4")?.s?.fill).toBe("#ffff00");
  });

  it("is one undo step and does not bring the source's widths", () => {
    const s = make();
    s.pasteHtml("Sheet1", "A1", '<table><col width=200><col width=300><tr height=40><td>x</td><td>y</td></tr></table>', { transpose: true });
    expect(s.values("Sheet1", "A1:A2")).toEqual([["x"], ["y"]]);
    expect(s.state.sheets[0]!.columns).toBeUndefined();
    expect(s.state.sheets[0]!.rows).toBeUndefined();
    s.undo();
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
  });

  it("re-points formulas brought from Excel, and Google Sheets' (relative to the cell)", () => {
    const s = make();
    // Excel: B2 = 1, C2 = 2, D2 = B2+C2 copied from B2.
    s.pasteHtml("Sheet1", "F10", '<table><tr><td x:num="1">1</td><td x:num="2">2</td><td x:num="3" x:fmla="=B2+C2">3</td></tr></table>', { transpose: true, source: "B2" });
    expect(s.cell("Sheet1", "F12")?.f).toBe("F10+F11");
    expect(s.values("Sheet1", "F10:F12")).toEqual([[1], [2], [3]]);
    s.pasteHtml("Sheet1", "H10", '<table><tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:1}">1</td><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:2}">2</td><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:3}" data-sheets-formula="=R[0]C[-2]+R[0]C[-1]">3</td></tr></table>', { transpose: true });
    expect(s.cell("Sheet1", "H12")?.f).toBe("H10+H11");
  });

  it("turns tab-separated text", () => {
    const s = make();
    expect(s.pasteText("Sheet1", "B2", "1\t2\t3\n4\t5", { transpose: true })).toBe("B2:C4");
    expect(s.values("Sheet1", "B2:C4")).toEqual([[1, 4], [2, 5], [3, null]]);
  });

  it("refuses what does not fit", () => {
    const s = make();
    expect(() => s.pasteHtml("Sheet1", "A1048575", "<table><tr><td>a</td><td>b</td><td>c</td></tr></table>", { transpose: true })).toThrow(/fit/);
  });
});
