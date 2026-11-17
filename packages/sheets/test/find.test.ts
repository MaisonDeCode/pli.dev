import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Find", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [
    ["Name", "City", "Qty"],
    ["Ana Smith", "Boston", 10],
    ["Bo smith", "Austin", 4],
    ["Cy Jones", "boston", 7],
  ]);
  s.setValues("Other", "A1", [["Smithy"], ["nothing"]]);
  return s;
};
const at = (found: { sheet: string; address: string }[]) => found.map((f) => f.address);

describe("find", () => {
  it("finds text in any case by default, row by row, across the sheets that aren't hidden", () => {
    const s = make();
    const found = s.find({ text: "smith" });
    expect(found.map((f) => `${s.state.sheets.find((x) => x.id === f.sheet)!.name}!${f.address}`)).toEqual(["Sheet1!A2", "Sheet1!A3", "Other!A1"]);
    s.hideSheets(["Other"]);
    expect(at(s.find({ text: "smith" }))).toEqual(["A2", "A3"]);
  });

  it("can look in one sheet, in part of one, and in the order of columns", () => {
    const s = make();
    expect(at(s.find({ text: "o", scope: { sheet: "Sheet1" } }))).toEqual(["B2", "A3", "A4", "B4"]);
    expect(at(s.find({ text: "o", scope: { sheet: "Sheet1", range: "B1:B3" } }))).toEqual(["B2"]);
    expect(at(s.find({ text: "o", scope: { sheet: "Sheet1" }, by: "columns" }))).toEqual(["A3", "A4", "B2", "B4"]);
  });

  it("matches case, whole cells, wildcards and regular expressions", () => {
    const s = make();
    const here = { sheet: "Sheet1" };
    expect(at(s.find({ text: "boston", matchCase: true, scope: here }))).toEqual(["B4"]);
    expect(at(s.find({ text: "boston", wholeCell: true, scope: here }))).toEqual(["B2", "B4"]);
    expect(at(s.find({ text: "b*n", wholeCell: true, scope: here }))).toEqual(["B2", "B4"]);
    expect(at(s.find({ text: "?o", scope: here, wholeCell: true }))).toEqual([]);
    expect(at(s.find({ text: "A?a *h", scope: here, wholeCell: true }))).toEqual(["A2"]);
    expect(at(s.find({ text: "~*", scope: here }))).toEqual([]);
    expect(at(s.find({ text: "^\\w+ S", regex: true, matchCase: true, scope: here }))).toEqual(["A2"]);
    expect(() => s.find({ text: "(", regex: true })).toThrow(/not a pattern/);
    expect(s.find({ text: "" })).toEqual([]);
  });

  it("looks at what cells show, or at what was typed, formulas included", () => {
    const s = make();
    s.setCell("Sheet1", "D2", "=C2*2");
    s.setCell("Sheet1", "C2", "12%");
    const here = { sheet: "Sheet1" };
    expect(at(s.find({ text: "12%", scope: here }))).toEqual(["C2"]);
    expect(at(s.find({ text: "0.12", scope: here }))).toEqual([]);
    expect(at(s.find({ text: "0.12", scope: here, lookIn: "formulas" }))).toEqual(["C2"]);
    expect(at(s.find({ text: "C2*", scope: here, lookIn: "formulas" }))).toEqual(["D2"]);
    expect(at(s.find({ text: "C2*", scope: here }))).toEqual([]);
    expect(at(s.find({ text: "0.24", scope: here }))).toEqual(["D2"]);
  });

  it("finds values that a formula spilled", () => {
    const s = make();
    s.setCell("Other", "C1", '=SEQUENCE(3,1,100)');
    expect(at(s.find({ text: "102", scope: { sheet: "Other" } }))).toEqual(["C3"]);
    expect(at(s.find({ text: "102", scope: { sheet: "Other" }, lookIn: "formulas" }))).toEqual([]);
  });
});

describe("replace", () => {
  it("replaces every occurrence in every cell, in one undo step", () => {
    const s = make();
    const result = s.replace({ text: "smith", scope: { sheet: "Sheet1" } }, "Wright");
    expect(result).toEqual({ cells: 2, occurrences: 2, skipped: 0 });
    expect(s.value("Sheet1", "A2")).toBe("Ana Wright");
    expect(s.value("Sheet1", "A3")).toBe("Bo Wright");
    expect(s.value("Other", "A1")).toBe("Smithy");
    s.undo();
    expect(s.value("Sheet1", "A2")).toBe("Ana Smith");
    expect(s.value("Sheet1", "A3")).toBe("Bo smith");
    expect(s.canUndo).toBe(true);
    s.redo();
    expect(s.value("Sheet1", "A3")).toBe("Bo Wright");
  });

  it("counts every occurrence in a cell, and treats $ in a plain replacement as text", () => {
    const s = make();
    s.setCell("Sheet1", "A1", "a-a-a");
    expect(s.replace({ text: "a", scope: { sheet: "Sheet1", range: "A1" }, matchCase: true }, "$&$1")).toEqual({ cells: 1, occurrences: 3, skipped: 0 });
    expect(s.value("Sheet1", "A1")).toBe("$&$1-$&$1-$&$1");
  });

  it("uses groups in a regular expression replacement", () => {
    const s = make();
    expect(s.replace({ text: "^(\\w+) (\\w+)$", regex: true, scope: { sheet: "Sheet1", range: "A2:A4" } }, "$2, $1").cells).toBe(3);
    expect(s.value("Sheet1", "A2")).toBe("Smith, Ana");
    expect(s.value("Sheet1", "A4")).toBe("Jones, Cy");
    expect(s.replace({ text: "(?<first>\\w+), \\w+", regex: true, scope: { sheet: "Sheet1", range: "A2" } }, "<$<first>>").cells).toBe(1);
    expect(s.value("Sheet1", "A2")).toBe("<Smith>");
  });

  it("works on what was typed: formulas change, and the result is typed in again", () => {
    const s = make();
    s.setCell("Sheet1", "D2", "=C2*2");
    s.setCell("Sheet1", "D3", "=C3*2");
    expect(s.replace({ text: "~*2", scope: { sheet: "Sheet1" } }, "*3").cells).toBe(2);
    expect(s.cell("Sheet1", "D2")?.f).toBe("C2*3");
    expect(s.value("Sheet1", "D2")).toBe(30);
    // A number stays a number, and text that looks like one stays text.
    s.setCell("Sheet1", "C4", "'007");
    s.replace({ text: "7", scope: { sheet: "Sheet1", range: "C4" } }, "8");
    expect(s.value("Sheet1", "C4")).toBe("008");
    s.replace({ text: "1", scope: { sheet: "Sheet1", range: "C2" } }, "2");
    expect(s.value("Sheet1", "C2")).toBe(20);
    // Replacing with nothing removes the text; a cell left empty is cleared.
    s.replace({ text: "Cy Jones", wholeCell: true, scope: { sheet: "Sheet1" } }, "");
    expect(s.cell("Sheet1", "A4")).toBeUndefined();
  });

  it("changes only the cells it is given", () => {
    const s = make();
    const found = s.find({ text: "boston", scope: { sheet: "Sheet1" } });
    expect(found).toHaveLength(2);
    const r = s.replace({ text: "boston", scope: { sheet: "Sheet1" } }, "Salem", [found[1]!]);
    expect(r.cells).toBe(1);
    expect(s.value("Sheet1", "B2")).toBe("Boston");
    expect(s.value("Sheet1", "B4")).toBe("Salem");
  });

  it("keeps formatting, and leaves a cell alone when nothing changes", () => {
    const s = make();
    s.setStyle("Sheet1", "A2", { bold: true });
    s.replace({ text: "Ana", scope: { sheet: "Sheet1" } }, "Eve");
    expect(s.cell("Sheet1", "A2")?.s?.bold).toBe(true);
    expect(s.replace({ text: "Eve", matchCase: true, scope: { sheet: "Sheet1" } }, "Eve")).toEqual({ cells: 0, occurrences: 0, skipped: 0 });
  });

  it("skips what a checkbox, a strict dropdown or a table's column name would refuse", () => {
    const s = make();
    s.setCell("Other", "B1", true);
    s.setControl("Other", "B1", { type: "checkbox" });
    expect(s.replace({ text: "TRUE", lookIn: "formulas", scope: { sheet: "Other" } }, "maybe")).toEqual({ cells: 0, occurrences: 0, skipped: 1 });
    expect(s.value("Other", "B1")).toBe(true);

    s.createTable("Sheet1", "A1:C4", { name: "People" });
    // "Name" -> "City" would make two columns called City, and "Qty" -> "" would leave one without a name.
    expect(s.replace({ text: "Name", wholeCell: true, scope: { sheet: "Sheet1" } }, "City")).toEqual({ cells: 0, occurrences: 0, skipped: 1 });
    expect(s.replace({ text: "Qty", wholeCell: true, scope: { sheet: "Sheet1" } }, "")).toEqual({ cells: 0, occurrences: 0, skipped: 1 });
    expect(s.replace({ text: "Qty", wholeCell: true, scope: { sheet: "Sheet1" } }, "Count").cells).toBe(1);
    expect(s.value("Sheet1", "C1")).toBe("Count");
  });

  it("follows a renamed table column in formulas, as typing over it does", () => {
    const s = make();
    s.createTable("Sheet1", "A1:C4", { name: "People" });
    s.setCell("Other", "D1", "=SUM(People[Qty])");
    s.replace({ text: "Qty", wholeCell: true, scope: { sheet: "Sheet1" } }, "Count");
    expect(s.cell("Other", "D1")?.f).toBe("SUM(People[Count])");
    expect(s.value("Other", "D1")).toBe(21);
  });

  it("changes a calculated column's formula when every cell of it is replaced, and marks the cells when only some are", () => {
    const s = new SheetSession(createWorkbook("Calc", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Qty", "Total"], [1, null], [2, null], [3, null]]);
    s.createTable("Sheet1", "A1:B4", { name: "T" });
    s.setCell("Sheet1", "B2", "=[@Qty]*2");
    expect(s.replace({ text: "~*2" }, "*3").cells).toBe(3);
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Qty]*3" });
    expect(s.calculatedExceptions("Sheet1")).toEqual([]);
    expect([2, 3, 4].map((r) => s.value("Sheet1", `B${r}`))).toEqual([3, 6, 9]);
    s.undo();
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Qty]*2" });
    // Some of them: the column keeps its formula and the others are marked.
    s.replace({ text: "~*2", scope: { sheet: "Sheet1", range: "B2:B3" } }, "*3");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Qty]*2" });
    expect(s.calculatedExceptions("Sheet1").map((x) => x.address)).toEqual(["B2", "B3"]);
  });

  it("replaces across sheets as one undo step and saves", () => {
    const s = make();
    expect(s.replace({ text: "smith", matchCase: false }, "Brown").cells).toBe(3);
    expect(s.value("Other", "A1")).toBe("Browny");
    s.undo();
    expect(s.value("Other", "A1")).toBe("Smithy");
    expect(s.value("Sheet1", "A2")).toBe("Ana Smith");
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets).toHaveLength(2);
  });
});

describe("find by error, by look, and in hidden sheets", () => {
  const make = () => {
    const s = new SheetSession(createWorkbook("f", ["One", "Two", "Archive"]));
    s.setValues("One", "A1", [["Name", "Total", "Note"], ["Pens", 12, "ok"], ["Ink", "=1/0", "check"], ["Paper", "=NA()", "ok"], ["Tape", 5, "ok"]]);
    s.setStyle("One", "A2:B2", { bold: true });
    s.setStyle("One", "A3", { fill: "#ffff00" });
    s.setStyle("One", "C4", { color: "#ff0000", italic: true });
    s.setFormat("One", "B5", "0.00");
    s.setValues("Two", "A1", [["Pens", "=SQRT(-1)"]]);
    s.setValues("Archive", "A1", [["Pens in storage"]]);
    s.hideSheets(["Archive"]);
    return s;
  };
  const at = (s: SheetSession, o: Parameters<SheetSession["find"]>[0]) => s.find(o).map((h) => `${s.sheet(h.sheet).name}!${h.address}`);

  it("finds the cells that hold errors, all of them or the ones whose error matches", () => {
    const s = make();
    expect(at(s, { text: "", errors: true })).toEqual(["One!B3", "One!B4", "Two!B1"]);
    expect(at(s, { text: "#DIV", errors: true })).toEqual(["One!B3"]);
    expect(at(s, { text: "#N/A", errors: true, scope: { sheet: "One" } })).toEqual(["One!B4"]);
  });

  it("finds cells by their look, with or without text", () => {
    const s = make();
    expect(at(s, { text: "", format: { bold: true } })).toEqual(["One!A2", "One!B2"]);
    expect(at(s, { text: "p", format: { bold: true } })).toEqual(["One!A2"]);
    expect(at(s, { text: "", format: { fill: "#FFFF00" } })).toEqual(["One!A3"]);
    expect(at(s, { text: "", format: { color: "#ff0000", italic: true } })).toEqual(["One!C4"]);
    expect(at(s, { text: "", format: { fmt: "0.00" } })).toEqual(["One!B5"]);
  });

  it("finds cells that are not bold, and cells with no fill", () => {
    const s = make();
    expect(at(s, { text: "Pens", format: { bold: false } })).toEqual(["Two!A1"]);
    expect(at(s, { text: "ok", format: { fill: "none" } })).toEqual(["One!C2", "One!C4", "One!C5"]);
  });

  it("combines errors with a look", () => {
    const s = make();
    s.setStyle("One", "B3", { bold: true });
    expect(at(s, { text: "", errors: true, format: { bold: true } })).toEqual(["One!B3"]);
  });

  it("looks in hidden sheets only when asked", () => {
    const s = make();
    expect(at(s, { text: "pens" })).toEqual(["One!A2", "Two!A1"]);
    expect(at(s, { text: "pens", hidden: true })).toEqual(["One!A2", "Two!A1", "Archive!A1"]);
    // Asking for one sheet by name always works.
    expect(at(s, { text: "pens", scope: { sheet: "Archive" } })).toEqual(["Archive!A1"]);
  });

  it("replaces in hidden sheets too when they are included, and has nothing to replace with no text", () => {
    const s = make();
    expect(s.replace({ text: "storage", hidden: true }, "the shed").cells).toBe(1);
    expect(s.value("Archive", "A1")).toBe("Pens in the shed");
    expect(s.replace({ text: "", errors: true }, "x")).toEqual({ cells: 0, occurrences: 0, skipped: 0 });
  });
});
