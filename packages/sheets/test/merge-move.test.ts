import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Moves", ["Sheet1", "Sheet2"]));
  s.setValues("Sheet1", "A1", [["Title", "", "x"], ["a", "b", "c"], [1, 2, 3]]);
  s.mergeCells("Sheet1", "A1:B1", { center: true });
  return s;
};
const f = (range: string, sheet = "Sheet1") => ({ sheet, range });
const at = (a: string, sheet = "Sheet1") => ({ sheet, at: a });

describe("moving and copying merged cells", () => {
  it("a merged range moves with its value, and its old place is plain again", () => {
    const s = make();
    s.move(f("A1:B1"), at("D5"));
    expect(s.merges("Sheet1")).toEqual(["D5:E5"]);
    expect(s.cell("Sheet1", "D5")).toMatchObject({ v: "Title", s: { align: "center" } });
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.mergeAt("Sheet1", "E5")).toBe("D5:E5");
  });

  it("is one undo step", () => {
    const s = make();
    s.move(f("A1:B1"), at("D5"));
    s.undo();
    expect(s.merges("Sheet1")).toEqual(["A1:B1"]);
    expect(s.cell("Sheet1", "A1")?.v).toBe("Title");
    expect(s.cell("Sheet1", "D5")).toBeUndefined();
    s.redo();
    expect(s.merges("Sheet1")).toEqual(["D5:E5"]);
  });

  it("a copy leaves the original merged and merges the copy too", () => {
    const s = make();
    s.copy(f("A1:B1"), at("D5"));
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "D5:E5"]);
    expect(s.cell("Sheet1", "D5")?.v).toBe("Title");
  });

  it("carries merges inside a larger range, and formulas that pointed at the moved cells follow", () => {
    const s = make();
    s.setCells("Sheet1", { G1: "=A1&A3" });
    s.move(f("A1:C3"), at("B6"));
    expect(s.merges("Sheet1")).toEqual(["B6:C6"]);
    expect(s.cell("Sheet1", "G1")?.f).toBe("B6&B8");
    expect(s.cell("Sheet1", "D6")?.v).toBe("x");
  });

  it("goes to another sheet", () => {
    const s = make();
    s.copy(f("A1:B1"), at("B2", "Sheet2"));
    expect(s.merges("Sheet2")).toEqual(["B2:C2"]);
    s.move(f("A1:B1"), at("A9", "Sheet2"));
    expect(s.merges("Sheet1")).toEqual([]);
    expect(s.merges("Sheet2")).toEqual(["B2:C2", "A9:B9"]);
  });

  it("refuses to take only part of a merged range", () => {
    const s = make();
    expect(() => s.move(f("B1:C2"), at("E5"))).toThrow(/only part of it/);
    expect(() => s.copy(f("A1:A3"), at("E5"))).toThrow(/A1:B1 is merged, and only part/);
    expect(s.merges("Sheet1")).toEqual(["A1:B1"]);
    expect(s.cell("Sheet1", "B2")?.v).toBe("b");
  });

  it("refuses to land on merged cells of another shape, and says which", () => {
    const s = make();
    s.mergeCells("Sheet1", "E5:F6");
    expect(() => s.move(f("A1:B1"), at("F5"))).toThrow(/E5:F6/);
    expect(() => s.copy(f("A2:B2"), at("D6"))).toThrow(/merged cells \(E5:F6\)/);
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "E5:F6"]);
    expect(s.cell("Sheet1", "A1")?.v).toBe("Title");
    expect(s.canUndo).toBe(true);
  });

  it("lets a merge of the same shape replace one in the same place", () => {
    const s = make();
    s.mergeCells("Sheet1", "E5:F5");
    s.setCells("Sheet1", { E5: "old" });
    s.copy(f("A1:B1"), at("E5"));
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "E5:F5"]);
    expect(s.cell("Sheet1", "E5")?.v).toBe("Title");
  });

  it("a move may overlap its own old place, but a copy may not overlap the original", () => {
    const s = make();
    s.move(f("A1:B1"), at("B1"));
    expect(s.merges("Sheet1")).toEqual(["B1:C1"]);
    const t = make();
    expect(() => t.copy(f("A1:B1"), at("B1"))).toThrow(/A1:B1/);
  });

  it("a protected place is refused", () => {
    const s = make();
    s.setCells("Sheet1", { D5: 1 });
    s.protectSheet("Sheet1");
    expect(() => s.move(f("A1:B1"), at("D5"))).toThrow(/locked|protected/);
    expect(s.merges("Sheet1")).toEqual(["A1:B1"]);
  });

  it("relocateProblem says why before anything is tried", () => {
    const s = make();
    s.mergeCells("Sheet1", "E5:F6");
    expect(s.relocateProblem(f("A1:B1"), at("H5"))).toBeNull();
    expect(s.relocateProblem(f("A1:B1"), at("E5"))).toMatch(/E5:F6/); // E5:F5 is not the same shape as E5:F6
    expect(s.relocateProblem(f("A1:A3"), at("D1"))).toMatch(/only part/);
    expect(s.relocateProblem(f("A1:B1"), at("XFD1"))).toMatch(/fit/);
  });
});

describe("filling merged cells", () => {
  it("repeats a merged range down", () => {
    const s = make();
    s.autofill("Sheet1", "A1:B1", "A1:B4");
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "A2:B2", "A3:B3", "A4:B4"]);
    expect(s.cell("Sheet1", "A3")?.v).toBe("Title");
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
  });

  it("repeats a block of merged and plain cells with its period, and copies instead of counting", () => {
    const s = new SheetSession(createWorkbook("F", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Item 1", ""], ["", ""], [5, 6]]);
    s.mergeCells("Sheet1", "A1:A2");
    s.autofill("Sheet1", "A1:B3", "A1:B9");
    expect(s.merges("Sheet1")).toEqual(["A1:A2", "A4:A5", "A7:A8"]);
    expect(s.cell("Sheet1", "A4")?.v).toBe("Item 1");
    expect(s.cell("Sheet1", "A9")?.v).toBe(5);
    expect(s.cell("Sheet1", "A6")?.v).toBe(5);
    expect(s.cell("Sheet1", "A5")?.v).toBeUndefined();
  });

  it("goes right, and one step undoes it all", () => {
    const s = new SheetSession(createWorkbook("F", ["Sheet1"]));
    s.setCells("Sheet1", { A1: "x" });
    s.mergeCells("Sheet1", "A1:A2");
    s.autofill("Sheet1", "A1:A2", "A1:D2");
    expect(s.merges("Sheet1")).toEqual(["A1:A2", "B1:B2", "C1:C2", "D1:D2"]);
    s.undo();
    expect(s.merges("Sheet1")).toEqual(["A1:A2"]);
    expect(s.cell("Sheet1", "C1")).toBeUndefined();
  });

  it("goes up, and does not merge a copy the fill cuts off", () => {
    const s = new SheetSession(createWorkbook("F", ["Sheet1"]));
    s.setCells("Sheet1", { A10: "x" });
    s.mergeCells("Sheet1", "A10:A11");
    s.autofill("Sheet1", "A10:A11", "A5:A11");
    expect([...s.merges("Sheet1")].sort()).toEqual(["A10:A11", "A6:A7", "A8:A9"]);
  });

  it("refuses to fill over other merged cells, or from part of a merge", () => {
    const s = make();
    s.mergeCells("Sheet1", "A3:B4");
    expect(() => s.autofill("Sheet1", "A1:B1", "A1:B4")).toThrow(/A3:B4/);
    expect(() => s.autofill("Sheet1", "B1:B1", "B1:B3")).toThrow(/only part of it/);
    expect(s.fillProblem("Sheet1", "A1:B1", "A1:B4")).toMatch(/A3:B4/);
    expect(s.fillProblem("Sheet1", "A1:B1", "A1:B2")).toBeNull();
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "A3:B4"]);
  });

  it("a plain series still counts", () => {
    const s = new SheetSession(createWorkbook("F", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [[1], [2]]);
    s.autofill("Sheet1", "A1:A2", "A1:A5");
    expect(s.cell("Sheet1", "A5")?.v).toBe(5);
  });
});
