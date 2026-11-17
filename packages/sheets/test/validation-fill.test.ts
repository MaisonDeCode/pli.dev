import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, type Validation } from "../src";

const make = (mode?: "off" | "warn" | "refuse") => {
  const s = new SheetSession(createWorkbook("F", ["Sheet1", "Lists"]), { now: () => 46_000.5, ...(mode ? { validatePaste: mode } : {}) });
  s.setValues("Lists", "A1", [["red"], ["green"], ["blue"]]);
  return s;
};
const rules = (s: SheetSession): Pick<Validation, "ranges">[] => s.validations("Sheet1").map((r) => ({ ranges: r.ranges }));

describe("filling carries the validation of the cell it copies", () => {
  it("Fill Down and Fill Right extend the rule over the cells filled", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B1"] });
    s.setCell("Sheet1", "B1", 5);
    s.fill("Sheet1", "B1:B4", "down");
    expect(rules(s)).toEqual([{ ranges: ["B1:B4"] }]);
    expect(() => s.setCell("Sheet1", "B3", 50)).toThrow("Enter a whole number between 1 and 10.");
    s.fill("Sheet1", "B1:D1", "right");
    expect(rules(s)).toEqual([{ ranges: ["B1:B4", "C1:D1"] }]);
    expect(s.checkEntry("Sheet1", "D1", 99)).not.toBeNull();
    expect(s.checkEntry("Sheet1", "D2", 99)).toBeNull();
  });

  it("is one undo step with the cells, and redo brings both back", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "decimal", op: "greaterThan", values: ["0"], ranges: ["A1"] });
    s.setCell("Sheet1", "A1", 3);
    s.fill("Sheet1", "A1:A3", "down");
    expect(s.cell("Sheet1", "A3")?.v).toBe(3);
    expect(rules(s)).toEqual([{ ranges: ["A1:A3"] }]);
    s.undo();
    expect(s.cell("Sheet1", "A3")).toBeUndefined();
    expect(rules(s)).toEqual([{ ranges: ["A1"] }]);
    s.redo();
    expect(rules(s)).toEqual([{ ranges: ["A1:A3"] }]);
    expect(s.cell("Sheet1", "A3")?.v).toBe(3);
  });

  it("takes away the rule the cells had when the cell copied has none, as a paste does", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B2:B5"] });
    s.setCell("Sheet1", "B1", 99);
    s.fill("Sheet1", "B1:B4", "down");
    expect(rules(s)).toEqual([{ ranges: ["B5"] }]);
    expect(s.cell("Sheet1", "B3")?.v).toBe(99);
  });

  it("replaces another rule on the cells with the one that is copied, and drops a rule that has nothing left", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1"] });
    s.addValidation("Sheet1", { kind: "textLength", op: "lessThan", values: ["3"], ranges: ["A2:A3"] });
    s.setCell("Sheet1", "A1", 4);
    s.fill("Sheet1", "A1:A3", "down");
    expect(s.validations("Sheet1").map((r) => [r.kind, r.ranges])).toEqual([["whole", ["A1:A3"]]]);
  });

  it("keeps relative references meaning the same: the rule grows, and moves its corner when the fill goes up", () => {
    const s = make();
    s.setValues("Sheet1", "D1", [[1], [2], [3], [4]]);
    s.addValidation("Sheet1", { kind: "custom", formula: "A3<D3", ranges: ["A3"] });
    s.setCell("Sheet1", "A3", 0);
    s.autofill("Sheet1", "A3", "A1:A3"); // upward: A1 and A2 take A3's rule
    const rule = s.validations("Sheet1")[0] as Extract<Validation, { kind: "custom" }>;
    expect(rule.ranges).toEqual(["A1:A3"]);
    expect(rule.formula).toBe("A1<D1");
    expect(s.checkEntry("Sheet1", "A1", 1)).not.toBeNull(); // 1 < D1 (1) is false
    expect(s.checkEntry("Sheet1", "A2", 1)).toBeNull(); // 1 < D2 (2)
    expect(s.checkEntry("Sheet1", "A3", 3)).not.toBeNull();
    s.autofill("Sheet1", "A1:A3", "A1:A4"); // and down again
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["A1:A4"]);
    expect(s.checkEntry("Sheet1", "A4", 5)).not.toBeNull(); // 5 < D4 (4) is false
    expect(s.checkEntry("Sheet1", "A4", 3)).toBeNull();
  });

  it("the fill handle repeats a source of several cells, each cell passing on its own rule", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "greaterThan", values: ["0"], ranges: ["A1"] });
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["A2"] });
    s.setCell("Sheet1", "A1", 1);
    s.setCell("Sheet1", "A2", "red");
    s.autofill("Sheet1", "A1:A2", "A1:A6");
    expect(s.validations("Sheet1").map((r) => [r.kind, r.ranges])).toEqual([
      ["whole", ["A1", "A3", "A5"]],
      ["list", ["A2", "A4", "A6"]],
    ]);
    expect(s.validationChoices("Sheet1", "A6")).toEqual(["red", "green", "blue"]);
    expect(() => s.setCell("Sheet1", "A5", -2)).toThrow();
  });

  it("copies lists with several choices, and drops down for a whole filled block", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2"], multiple: true, separator: "; " });
    s.setCell("Sheet1", "B2", "red; green");
    s.autofill("Sheet1", "B2", "B2:D5");
    const rule = s.validations("Sheet1")[0] as Extract<Validation, { kind: "list" }>;
    expect(rule.ranges).toEqual(["B2:B5"]);
    s.autofill("Sheet1", "B2:B5", "B2:D5");
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["B2:D5"]);
    expect(s.validationSelection("Sheet1", "D5")).toEqual(["red", "green"]); // the value went along, and so did the separator
    s.pickChoice("Sheet1", "D5", "blue");
    expect(s.cell("Sheet1", "D5")?.v).toBe("red; green; blue");
  });

  it("is checked against the carried rule when validatePaste asks for it", () => {
    const s = make("refuse");
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B1"], alert: "stop" });
    s.setCell("Sheet1", "B1", 50, { validate: false });
    s.fill("Sheet1", "B1:B3", "down");
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["B1:B3"]);
    expect(s.lastPasteReport).toMatchObject({ action: "fill", refused: ["B2", "B3"] });
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
  });

  it("leaves rules alone when nothing about them changes", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B1:B6"] });
    s.setCell("Sheet1", "B1", 5);
    const before = s.state.sheets[0]!.validations;
    s.fill("Sheet1", "B1:B4", "down");
    expect(s.state.sheets[0]!.validations).toBe(before);
  });
});
