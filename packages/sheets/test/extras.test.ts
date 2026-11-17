import { describe, expect, it } from "vitest";
import { SheetSession, addRange, caret, createWorkbook, fromXlsx, inSelection, parseWorkbook, selectionRanges, serializeWorkbook, toXlsx } from "../src";

const at = (row: number, col: number) => ({ row, col });
const make = (cells: Record<string, string | number | boolean> = {}) => {
  const s = new SheetSession(createWorkbook());
  s.setCells("Sheet1", cells);
  return s;
};

describe("several selected ranges", () => {
  it("keeps what was selected when another is added", () => {
    const a = { anchor: at(1, 1), focus: at(2, 2) };
    const b = addRange(a, { anchor: at(5, 5), focus: at(6, 6) });
    expect(selectionRanges(b)).toEqual([{ r1: 1, c1: 1, r2: 2, c2: 2 }, { r1: 5, c1: 5, r2: 6, c2: 6 }]);
    expect(inSelection(b, 2, 2)).toBe(true);
    expect(inSelection(b, 3, 3)).toBe(false);
    expect(selectionRanges(addRange(b, caret(at(9, 9))))).toHaveLength(3);
  });
});

describe("moving cells", () => {
  it("moves values and formulas, and formulas that pointed at them follow", () => {
    const s = make({ A1: 1, A2: 2, B1: "=A1+A2", C1: "=A1*10", C2: "=SUM(A1:A2)", C3: "=SUM(A1:A3)" });
    s.move({ sheet: "Sheet1", range: "A1:A2" }, { sheet: "Sheet1", at: "E4" });
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.cell("Sheet1", "E4")).toEqual({ v: 1 });
    expect(s.cell("Sheet1", "B1")?.f).toBe("E4+E5"); // follows
    expect(s.cell("Sheet1", "C2")?.f).toBe("SUM(E4:E5)"); // a whole range inside the block follows too
    expect(s.cell("Sheet1", "C3")?.f).toBe("SUM(A1:A3)"); // one that takes in only part of it stays
    expect(s.value("Sheet1", "B1")).toBe(3);
    s.undo();
    expect(s.cell("Sheet1", "B1")?.f).toBe("A1+A2");
    expect(s.cell("Sheet1", "A1")).toEqual({ v: 1 });
    expect(s.cell("Sheet1", "E4")).toBeUndefined();
  });

  it("a moved formula keeps pointing at what it did, unless that moved with it", () => {
    const s = make({ A1: 5, B1: 6, C1: "=A1+B1" });
    s.move({ sheet: "Sheet1", range: "B1:C1" }, { sheet: "Sheet1", at: "B3" });
    expect(s.cell("Sheet1", "C3")?.f).toBe("A1+B3");
    expect(s.value("Sheet1", "C3")).toBe(11);
  });

  it("moves between sheets, qualifying references, and overwrites the target", () => {
    const s = make({ A1: 7, B1: "=A1+1" });
    s.addSheet("Other");
    s.setCells("Other", { C3: "old", D4: "=1" });
    s.move({ sheet: "Sheet1", range: "A1" }, { sheet: "Other", at: "C3" });
    expect(s.cell("Other", "C3")).toEqual({ v: 7 });
    expect(s.cell("Sheet1", "B1")?.f).toBe("Other!C3+1");
    expect(s.value("Sheet1", "B1")).toBe(8);
    expect(s.cell("Other", "D4")?.f).toBe("1"); // outside the block, untouched
  });

  it("moving onto itself overlapping works", () => {
    const s = make({ A1: 1, A2: 2, A3: 3 });
    s.move({ sheet: "Sheet1", range: "A1:A3" }, { sheet: "Sheet1", at: "A2" });
    expect(s.values("Sheet1", "A1:A4")).toEqual([[null], [1], [2], [3]]);
    expect(() => s.move({ sheet: "Sheet1", range: "A2:A4" }, { sheet: "Sheet1", at: "A1048575" })).toThrow(/fit/);
  });
});

describe("filters", () => {
  const table = { A1: "Name", B1: "Dept", C1: "Pay", A2: "Ann", B2: "Ops", C2: 10, A3: "Bo", B3: "Dev", C3: 20, A4: "Cy", B4: "Ops", C4: 30, A5: "Di", B5: "", C5: 40, E1: "elsewhere" };

  it("finds the block of data around a cell", () => {
    const s = make(table);
    expect(s.currentRegion("Sheet1", "B3")).toBe("A1:C5");
    expect(s.currentRegion("Sheet1", "E1")).toBe("E1");
    expect(s.currentRegion("Sheet1", "H9")).toBe("H9");
  });

  it("hides the rows that don't match, and shows them again", () => {
    const s = make(table);
    s.setFilter("Sheet1", "A1:C5");
    expect(s.filterValues("Sheet1", 2)).toEqual([{ value: "", count: 1 }, { value: "Dev", count: 1 }, { value: "Ops", count: 2 }]);
    s.filterColumn("Sheet1", 2, ["Ops"]);
    expect(Object.entries(s.state.sheets[0]!.rows!).filter(([, d]) => d.hidden).map(([r]) => r)).toEqual(["3", "5"]);
    expect(s.state.sheets[0]!.filter).toEqual({ range: "A1:C5", columns: { B: ["Ops"] } });
    s.filterColumn("Sheet1", 3, ["10", "40"]);
    expect(Object.keys(s.state.sheets[0]!.rows!).filter((r) => s.state.sheets[0]!.rows![r]!.hidden)).toEqual(["3", "4", "5"]);
    s.filterColumn("Sheet1", 2, null);
    expect(Object.keys(s.state.sheets[0]!.rows!).filter((r) => s.state.sheets[0]!.rows![r]!.hidden)).toEqual(["3", "4"]);
    s.undo();
    expect(Object.keys(s.state.sheets[0]!.rows!).filter((r) => s.state.sheets[0]!.rows![r]!.hidden)).toEqual(["3", "4", "5"]);
    s.setFilter("Sheet1", null);
    expect(s.state.sheets[0]!.filter).toBeUndefined();
    expect(s.state.sheets[0]!.rows).toBeUndefined();
    s.undo();
    expect(s.state.sheets[0]!.filter?.range).toBe("A1:C5");
  });

  it("follows inserted and deleted rows and columns", () => {
    const s = make(table);
    s.setFilter("Sheet1", "A1:C5");
    s.filterColumn("Sheet1", 3, ["10"]);
    s.insertColumns("Sheet1", 1);
    expect(s.state.sheets[0]!.filter).toEqual({ range: "B1:D5", columns: { D: ["10"] } });
    s.insertRows("Sheet1", 3);
    expect(s.state.sheets[0]!.filter?.range).toBe("B1:D6");
    s.deleteColumns("Sheet1", 4);
    expect(s.state.sheets[0]!.filter).toEqual({ range: "B1:C6" });
    s.deleteRows("Sheet1", 1, 6);
    expect(s.state.sheets[0]!.filter).toBeUndefined();
  });

  it("is saved, checked, and written to and read from XLSX", () => {
    const s = make(table);
    s.setFilter("Sheet1", "A1:C5");
    s.filterColumn("Sheet1", 2, ["Ops", ""]);
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.filter).toEqual(s.state.sheets[0]!.filter);
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.filter).toEqual({ range: "A1:C5", columns: { B: ["Ops", ""] } });
    expect(workbook.sheets[0]!.rows).toEqual(s.state.sheets[0]!.rows);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].filter.columns.Z = ["x"];
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/filter\.columns\.Z/);
    expect(() => s.filterColumn("Sheet1", 9, [])).toThrow(/outside/);
  });
});

describe("batches", () => {
  it("several edits are one undo step", () => {
    const s = make({ A1: 1, B1: 2 });
    s.batch(() => {
      s.setStyle("Sheet1", "A1", { bold: true });
      s.setStyle("Sheet1", "B1", { bold: true });
      s.clear("Sheet1", "A1", "contents");
    });
    expect(s.cell("Sheet1", "B1")?.s?.bold).toBe(true);
    expect(s.cell("Sheet1", "A1")?.v).toBeUndefined();
    s.undo();
    expect(s.cell("Sheet1", "A1")).toEqual({ v: 1 });
    expect(s.cell("Sheet1", "B1")).toEqual({ v: 2 });
    expect(s.canUndo).toBe(true); // the setup is still there to undo, but the batch was one step
  });
});
