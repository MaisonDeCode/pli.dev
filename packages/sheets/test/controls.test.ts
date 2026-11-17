import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, cellChoices, isTicked, type CellControl } from "../src";

const make = (cells: Record<string, string | number | boolean> = {}) => {
  const s = new SheetSession(createWorkbook());
  s.setCells("Sheet1", cells);
  return s;
};
const status: CellControl = { type: "dropdown", options: [{ value: "Todo", color: "#e5e7eb" }, { value: "Doing", color: "#fde68a" }, { value: "Done", color: "#bbf7d0" }] };

describe("checkboxes", () => {
  it("start unticked, toggle, and hold only their two values", () => {
    const s = make({ A1: "x", B1: true });
    s.setControl("Sheet1", "A1:B2", { type: "checkbox" });
    expect(s.values("Sheet1", "A1:B2")).toEqual([[false, true], [false, false]]); // a value that isn't ticked becomes unticked
    expect(isTicked(s.cell("Sheet1", "B1"))).toBe(true);
    s.toggleCheckbox("Sheet1", "A1");
    expect(s.value("Sheet1", "A1")).toBe(true);
    s.toggleCheckbox("Sheet1", "A1");
    expect(s.value("Sheet1", "A1")).toBe(false);
    s.toggleCheckbox("Sheet1", "A1", true);
    expect(s.value("Sheet1", "A1")).toBe(true);
    expect(() => s.setCell("Sheet1", "A1", "maybe")).toThrow(/checkbox holds/);
    s.setCell("Sheet1", "A1", "false");
    expect(s.value("Sheet1", "A1")).toBe(false);
    s.setCell("Sheet1", "B1", null);
    expect(s.value("Sheet1", "B1")).toBe(false); // emptying unticks
    s.clear("Sheet1", "A1:B1", "contents");
    expect(s.cell("Sheet1", "A1")?.control).toEqual({ type: "checkbox" }); // the box stays
  });

  it("formulas can use them, and any two values can stand for ticked and not", () => {
    const s = make({ A1: "x" });
    s.setControl("Sheet1", "B1", { type: "checkbox", checked: "Yes", unchecked: "No" });
    expect(s.value("Sheet1", "B1")).toBe("No");
    s.toggleCheckbox("Sheet1", "B1");
    expect(s.value("Sheet1", "B1")).toBe("Yes");
    s.setCell("Sheet1", "C1", '=IF(B1="Yes",1,0)');
    expect(s.value("Sheet1", "C1")).toBe(1);
    expect(() => s.setControl("Sheet1", "D1", { type: "checkbox", checked: 1, unchecked: 1 })).toThrow(/two different/);
    s.setControl("Sheet1", "B1", null);
    expect(s.cell("Sheet1", "B1")).toEqual({ v: true }); // what was left is TRUE or FALSE (it was ticked)
  });

  it("copy, fill and undo carry the control", () => {
    const s = make();
    s.setControl("Sheet1", "A1", { type: "checkbox" });
    s.fill("Sheet1", "A1:A3", "down");
    expect(s.cell("Sheet1", "A3")?.control).toEqual({ type: "checkbox" });
    s.undo();
    expect(s.cell("Sheet1", "A3")).toBeUndefined();
  });
});

describe("dropdowns", () => {
  it("pick a choice, keep what was set, and refuse others when strict", () => {
    const s = make();
    s.setControl("Sheet1", "A1:A3", status);
    s.pickChoice("Sheet1", "A1", "Doing");
    expect(s.value("Sheet1", "A1")).toBe("Doing");
    s.pickChoice("Sheet1", "A1", "Done");
    expect(s.value("Sheet1", "A1")).toBe("Done");
    s.pickChoice("Sheet1", "A1", null);
    expect(s.cell("Sheet1", "A1")).toEqual({ control: status });
    s.setCell("Sheet1", "A2", "Anything"); // not strict
    expect(s.value("Sheet1", "A2")).toBe("Anything");
    s.setControl("Sheet1", "A3", { ...status, strict: true } as CellControl);
    expect(() => s.setCell("Sheet1", "A3", "Nope")).toThrow(/isn't one of the choices/);
    s.setCell("Sheet1", "A3", "Todo");
    expect(s.value("Sheet1", "A3")).toBe("Todo");
    s.setCell("Sheet1", "A3", null);
    expect(s.cell("Sheet1", "A3")?.control).toBeDefined();
  });

  it("allow several choices, kept as text", () => {
    const s = make();
    s.setControl("Sheet1", "A1", { ...status, multiple: true } as CellControl);
    s.pickChoice("Sheet1", "A1", "Todo");
    s.pickChoice("Sheet1", "A1", "Done");
    expect(s.value("Sheet1", "A1")).toBe("Todo, Done");
    expect(cellChoices(s.cell("Sheet1", "A1"))).toEqual(["Todo", "Done"]);
    s.pickChoice("Sheet1", "A1", "Todo");
    expect(s.value("Sheet1", "A1")).toBe("Done");
    expect(() => s.setControl("Sheet1", "B1", { type: "dropdown", options: [{ value: "a" }, { value: "a" }] })).toThrow(/twice/);
    expect(() => s.pickChoice("Sheet1", "B1", "x")).toThrow(/isn't a dropdown/);
  });

  it("choices that look like numbers stay text", () => {
    const s = make();
    s.setControl("Sheet1", "A1", { type: "dropdown", options: [{ value: "2024" }, { value: "2025" }] });
    s.pickChoice("Sheet1", "A1", "2024");
    expect(s.value("Sheet1", "A1")).toBe("2024");
  });
});

describe("badges", () => {
  it("hold text and may name a kind of thing an app knows", () => {
    const s = make();
    s.setControl("Sheet1", "A1:A2", { type: "badge", kind: "person", multiple: true });
    s.pickChoice("Sheet1", "A1", "u_ann");
    s.pickChoice("Sheet1", "A1", "u_bo");
    expect(s.value("Sheet1", "A1")).toBe("u_ann, u_bo");
    s.setControl("Sheet1", "B1", { type: "badge", color: "#ff0000" });
    s.setCell("Sheet1", "B1", "New");
    expect(s.cell("Sheet1", "B1")).toEqual({ v: "New", control: { type: "badge", color: "#ff0000" } });
  });
});

describe("saving controls", () => {
  it("round-trips in JSON and refuses a bad control", () => {
    const s = make();
    s.setControl("Sheet1", "A1", status);
    s.setControl("Sheet1", "B1", { type: "checkbox", checked: "Y", unchecked: "N" });
    s.setControl("Sheet1", "C1", { type: "badge", kind: "person" });
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.cells["A1"]!.control).toEqual(status);
    const bad = (mutate: (c: any) => void) => {
      const doc = JSON.parse(serializeWorkbook(s.state));
      mutate(doc.workbook.sheets[0].cells);
      return () => parseWorkbook(JSON.stringify(doc));
    };
    expect(bad((c) => (c.A1.control.options[0].color = "red"))).toThrow(/options\[0\]\.color/);
    expect(bad((c) => (c.A1.control.options[1].value = "Todo"))).toThrow(/twice/);
    expect(bad((c) => (c.A1.control.type = "slider"))).toThrow(/control\.type/);
    expect(bad((c) => (c.B1.control.unchecked = "Y"))).toThrow(/two different/);
    expect(bad((c) => (c.C1.control.extra = 1))).toThrow(/unknown field "extra"/);
  });

  it("dropdowns go to Excel as data validation lists and come back", () => {
    const s = make();
    s.setControl("Sheet1", "A1:A3", status);
    s.setControl("Sheet1", "B1", { ...status, strict: true } as CellControl);
    s.setControl("Sheet1", "C1", { ...status, multiple: true } as CellControl); // Excel's list has no setting for this; Pli's extension keeps it
    s.setControl("Sheet1", "D1", { type: "checkbox" });
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const cells = workbook.sheets[0]!.cells;
    expect(cells["A2"]!.control).toEqual({ type: "dropdown", options: [{ value: "Todo" }, { value: "Doing" }, { value: "Done" }] }); // colours aren't in the file
    expect(cells["B1"]!.control).toEqual({ type: "dropdown", options: [{ value: "Todo" }, { value: "Doing" }, { value: "Done" }], strict: true });
    expect(cells["C1"]!.control).toEqual({ type: "dropdown", options: [{ value: "Todo" }, { value: "Doing" }, { value: "Done" }], multiple: true });
    expect(cells["D1"]).toEqual({ v: false }); // the checkbox keeps its value
  });
});
