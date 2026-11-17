import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Lines", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  return s;
};

describe("the look of the lines on a range", () => {
  it("says when there are none, when they are alike and when they differ", () => {
    const s = make();
    expect(s.borderLook("Sheet1", "A1:C3")).toBeNull();
    s.setBorders("Sheet1", "A1:C3", "all", { style: "thin", color: "#ff0000" });
    expect(s.borderLook("Sheet1", "A1:C3")).toEqual({ style: "thin", color: "#ff0000" });
    s.setBorders("Sheet1", "B2", "outer", { style: "thick", color: "#0000ff" });
    expect(s.borderLook("Sheet1", "A1:C3")).toEqual({ style: "mixed", color: "mixed" });
    expect(s.borderLook("Sheet1", "A1")).toEqual({ style: "thin", color: "#ff0000" });
  });

  it("counts a line with no colour as black", () => {
    const s = make();
    s.setBorders("Sheet1", "A1", "bottom", { style: "thin" });
    s.setBorders("Sheet1", "B1", "bottom", { style: "thin", color: "#000000" });
    expect(s.borderLook("Sheet1", "A1:B1")).toEqual({ style: "thin", color: "#000000" });
  });
});

describe("one colour for the lines of a selection", () => {
  it("recolours every line, keeping each one's style, and the diagonals", () => {
    const s = make();
    s.setBorders("Sheet1", "A1:B2", "all", { style: "thin", color: "#ff0000" });
    s.setBorders("Sheet1", "B2", "bottom", { style: "double", color: "#00ff00" });
    s.setBorders("Sheet1", "A1", "diagonalDown", { style: "dashed" });
    s.colorBorders("Sheet1", "A1:B2", "#336699");
    expect(s.borderLook("Sheet1", "A1:B2")).toMatchObject({ color: "#336699", style: "mixed" });
    expect(s.cell("Sheet1", "B2")?.s?.border?.bottom).toEqual({ style: "double", color: "#336699" });
    expect(s.cell("Sheet1", "A1")?.s?.border?.top).toEqual({ style: "thin", color: "#336699" });
    expect(s.cell("Sheet1", "A1")?.s?.border?.diagonalDown).toEqual({ style: "dashed", color: "#336699" });
  });

  it("takes along the neighbour that shares a line, and leaves the rest alone", () => {
    const s = make();
    s.setBorders("Sheet1", "B2", "outer", { style: "thin", color: "#ff0000" });
    s.setBorders("Sheet1", "C3", "all", { style: "thin", color: "#00aa00" });
    s.colorBorders("Sheet1", "B2", "#111111");
    expect(s.cell("Sheet1", "B3")?.s?.border?.top).toEqual({ style: "thin", color: "#111111" });
    expect(s.cell("Sheet1", "C2")?.s?.border?.left).toEqual({ style: "thin", color: "#111111" });
    expect(s.cell("Sheet1", "C3")?.s?.border?.top).toEqual({ style: "thin", color: "#00aa00" });
  });

  it("null makes them black (no colour), is one undo step, and does nothing without lines", () => {
    const s = make();
    s.colorBorders("Sheet1", "A1:C3", "#123456");
    expect(s.canUndo).toBe(true); // only the values
    s.setBorders("Sheet1", "A1:B1", "all", { style: "thin", color: "#ff0000" });
    s.colorBorders("Sheet1", "A1:B1", null);
    expect(s.cell("Sheet1", "A1")?.s?.border?.top).toEqual({ style: "thin" });
    s.undo();
    expect(s.cell("Sheet1", "A1")?.s?.border?.top).toEqual({ style: "thin", color: "#ff0000" });
  });

  it("refuses a colour that isn't one", () => {
    const s = make();
    s.setBorders("Sheet1", "A1", "all", { style: "thin" });
    expect(() => s.colorBorders("Sheet1", "A1", "red")).toThrow();
  });
});
