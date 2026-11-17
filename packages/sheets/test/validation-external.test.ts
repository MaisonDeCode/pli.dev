import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { Calculator, SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, type Validation } from "../src";
import { lintPackage } from "./excel-check/lint";

const prices = { Sheet1: { A1: "Item", A2: "Pens", A3: "Paper", A4: "Ink", B1: "Price", B2: 2.5, B3: 4, B4: 12, C1: true, D1: "n/a" } };
const make = () => {
  const s = new SheetSession(createWorkbook("E", ["Sheet1", "Lists"]), { now: () => 46_000.5 });
  s.setExternalCells("Prices.xlsx", "Sheet1", prices.Sheet1, { path: "../data/Prices.xlsx", read: "2025-12-09" });
  return s;
};
const entries = (s: SheetSession) => Object.fromEntries(s.state.sheets[0]!.validations?.map((v) => [v.id, v]) ?? []);

describe("cell formulas that read other workbooks", () => {
  it("read the cells kept of that workbook, in Excel's spellings", () => {
    const s = make();
    s.setCell("Sheet1", "A1", "=[Prices.xlsx]Sheet1!B2*2");
    s.setCell("Sheet1", "A2", "='[Prices.xlsx]Sheet1'!A3&\"!\"");
    s.setCell("Sheet1", "A3", "=SUM([Prices.xlsx]Sheet1!B2:B4)");
    s.setCell("Sheet1", "A4", "=VLOOKUP(\"Paper\",[Prices.xlsx]Sheet1!A2:B4,2,FALSE)");
    s.setCell("Sheet1", "A5", "=COUNTIF([prices.xlsx]sheet1!A2:A4,\"Ink\")");
    s.setCell("Sheet1", "A6", "=[Prices.xlsx]Sheet1!C1");
    s.setCell("Sheet1", "A7", "=[Prices.xlsx]Sheet1!Z9");
    expect([1, 2, 3, 4, 5, 6, 7].map((r) => s.value("Sheet1", `A${r}`))).toEqual([5, "Paper!", 18.5, 4, 1, true, null]);
    // printed the way Excel shows it
    expect(s.cell("Sheet1", "A1")!.f).toBe("[Prices.xlsx]Sheet1!B2*2");
    // a name with a space is quoted, as Excel does
    s.setCell("Sheet1", "A8", "='[Price list.xlsx]My sheet'!A1");
    expect(s.cell("Sheet1", "A8")!.f).toBe("'[Price list.xlsx]My sheet'!A1");
  });

  it("are errors for a workbook that was never read, and recalculate when its cells arrive", () => {
    const s = new SheetSession(createWorkbook("E", ["Sheet1"]));
    s.setCell("Sheet1", "A1", "=[Prices.xlsx]Sheet1!B2");
    expect(s.value("Sheet1", "A1")).toEqual({ error: "#REF!" });
    s.setExternalCells("Prices.xlsx", "Sheet1", { B2: 7 });
    expect(s.value("Sheet1", "A1")).toBe(7);
    s.setExternalCells("Prices.xlsx", "Sheet1", { B2: 9 });
    expect(s.value("Sheet1", "A1")).toBe(9);
    s.undo();
    expect(s.value("Sheet1", "A1")).toBe(7);
    s.undo();
    expect(s.value("Sheet1", "A1")).toEqual({ error: "#REF!" });
    expect(s.externalBooks.find((b) => b.name === "Prices.xlsx")?.sheets["Sheet1"]).toEqual({}); // nothing is kept of it any more
  });

  it("follow a copy like any reference, and defined names can point into the other workbook", () => {
    const s = make();
    s.setCell("Sheet1", "A1", "=[Prices.xlsx]Sheet1!B2");
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "A2" });
    expect(s.cell("Sheet1", "A2")!.f).toBe("[Prices.xlsx]Sheet1!B3");
    expect(s.value("Sheet1", "A2")).toBe(4);
    s.defineName("Cost", "[Prices.xlsx]Sheet1!$B$2:$B$4");
    s.setCell("Sheet1", "C1", "=SUM(Cost)");
    expect(s.value("Sheet1", "C1")).toBe(18.5);
  });

  it("keep the kept cells in the saved workbook, and refuse mistakes", () => {
    const s = make();
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.externalBooks).toEqual(s.state.externalBooks);
    expect(() => s.setExternalCells("Prices.xlsx", "Sheet1", { "2B": 1 })).toThrow("not a cell address");
    expect(() => s.setExternalCells("Bad[1].xlsx", "Sheet1", {})).toThrow("is named like");
    const withBooks = (externalBooks: unknown) => JSON.stringify({ format: "pli.sheet", version: 1, workbook: { ...s.state, externalBooks } });
    expect(() => parseWorkbook(withBooks([{ name: "P.xlsx", sheets: { S: { b2: 1 } } }]))).toThrow(/capitals/);
    expect(() => parseWorkbook(withBooks([{ name: "P.xlsx", sheets: {} }, { name: "p.xlsx", sheets: {} }]))).toThrow(/twice/);
  });
});

describe("validation formulas that read other workbooks", () => {
  it("limits, custom formulas and relative references read the kept cells", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "decimal", op: "lessThanOrEqual", values: ["[Prices.xlsx]Sheet1!B2"], ranges: ["B2:B4"] });
    expect(() => s.setCell("Sheet1", "B2", 3)).toThrow("Enter a number less than or equal to [Prices.xlsx]Sheet1!B2.");
    s.setCell("Sheet1", "B2", 2.5);
    // relative: B3 compares with B3 of the other workbook (4)
    s.setCell("Sheet1", "B3", 4);
    expect(() => s.setCell("Sheet1", "B3", 4.5)).toThrow();
    s.addValidation("Sheet1", { kind: "custom", formula: "COUNTIF([Prices.xlsx]Sheet1!$A$2:$A$4,C2)>0", ranges: ["C2:C4"] });
    s.setCell("Sheet1", "C2", "Ink");
    expect(() => s.setCell("Sheet1", "C3", "Pencils")).toThrow();
    expect(s.invalidCells("Sheet1")).toEqual([]);
  });

  it("let an entry in when the workbook was never read, and check it once it has been", () => {
    const s = new SheetSession(createWorkbook("E", ["Sheet1"]));
    s.addValidation("Sheet1", { kind: "whole", op: "lessThan", values: ["[Limits.xlsx]Sheet1!$A$1"], ranges: ["B1"] });
    s.setCell("Sheet1", "B1", 500);
    s.defineName("Cap", "[Limits.xlsx]Sheet1!$A$1");
    s.addValidation("Sheet1", { kind: "whole", op: "lessThan", values: ["Cap"], ranges: ["B2"] });
    s.setCell("Sheet1", "B2", 500); // also through a defined name
    s.setExternalCells("Limits.xlsx", "Sheet1", { A1: 10 });
    expect(() => s.setCell("Sheet1", "B2", 500)).toThrow();
    expect(() => s.setCell("Sheet1", "B1", 500)).toThrow();
    expect(s.invalidCells("Sheet1")).toEqual(["B1", "B2"]);
  });

  it("lists can be read from a defined name that points into the other workbook", () => {
    const s = make();
    s.defineName("Items", "[Prices.xlsx]Sheet1!$A$2:$A$4");
    s.addValidation("Sheet1", { kind: "list", source: "Items", ranges: ["B2"] });
    expect(s.validationChoices("Sheet1", "B2")).toEqual(["Pens", "Paper", "Ink"]);
    s.setCell("Sheet1", "B2", "paper");
    expect(() => s.setCell("Sheet1", "B2", "Glue")).toThrow();
    // and a list whose own source is in the other workbook uses the kept cells when it has no copy of its own
    s.addValidation("Sheet1", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$2:$A$3", ranges: ["B3"] });
    expect(s.validationChoices("Sheet1", "B3")).toEqual(["Pens", "Paper"]);
  });

  it("are saved, and a rule that reads another workbook can be written to the JSON and back", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "custom", formula: "A1<[Prices.xlsx]Sheet1!$B$2", ranges: ["A1"] });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect((back.sheets[0]!.validations![0] as Extract<Validation, { kind: "custom" }>).formula).toBe("A1<[Prices.xlsx]Sheet1!$B$2");
  });
});

describe("reading other workbooks through the host", () => {
  it("asks for the cells formulas, names and rules read, keeps them, and says how they stand", async () => {
    const asked: string[] = [];
    const s = new SheetSession(createWorkbook("E", ["Sheet1"]), {
      now: () => 46_000.5,
      externalLists: (book, ref) => {
        asked.push(`${book}|${ref}`);
        if (book === "Gone.xlsx") return null;
        return ref === "Sheet1!$B$2" ? [7.5] : ref === "Sheet1!$C$2:$C$4" ? [4, null, "x"] : [3];
      },
    });
    s.setCell("Sheet1", "A1", "=[Prices.xlsx]Sheet1!B2+1");
    s.setCell("Sheet1", "A2", "=SUM([Prices.xlsx]Sheet1!C2:C4)");
    s.setCell("Sheet1", "A3", "=[Gone.xlsx]Sheet1!A1");
    s.addValidation("Sheet1", { kind: "whole", op: "equal", values: ["[Prices.xlsx]Sheet1!$B$2"], ranges: ["D1"] });
    expect(s.externalReferences().map((r) => [r.book, r.range, r.state, r.by])).toEqual([
      ["Prices.xlsx", "B2", "missing", ["cell", "validation"]],
      ["Prices.xlsx", "C2:C4", "missing", ["cell"]],
      ["Gone.xlsx", "A1", "missing", ["cell"]],
    ]);
    const result = await s.refreshExternalLists();
    expect(result).toMatchObject({ updated: 2, unchanged: 0, offline: false });
    expect(result.failed).toEqual([{ sheet: "", id: "", book: "Gone.xlsx", ref: "Sheet1!$A$1", reason: "Gone.xlsx couldn't be found" }]);
    expect(s.value("Sheet1", "A1")).toBe(8.5);
    expect(s.value("Sheet1", "A2")).toBe(4); // the text isn't a number to SUM
    expect(s.externalBooks[0]).toMatchObject({ name: "Prices.xlsx", read: "2025-12-09", sheets: { Sheet1: { B2: 7.5, C2: 4, C4: "x" } } });
    // reading again changes nothing, and the refresh is not an undo step
    expect(await s.refreshExternalLists()).toMatchObject({ updated: 0, unchanged: 2 });
    expect(asked.filter((a) => a.startsWith("Prices.xlsx|Sheet1!$C$2:$C$4")).length).toBe(2);
    // the refresh was not an undo step: undo takes back the rule typed last
    s.undo();
    expect(s.validations("Sheet1")).toEqual([]);
    expect(s.value("Sheet1", "A1")).toBe(8.5);
  });
});

describe("XLSX files", () => {
  const filled = () => {
    const s = make();
    s.setCell("Sheet1", "A1", "=[Prices.xlsx]Sheet1!B2*2");
    s.setCell("Sheet1", "A2", "=SUM(Cost)");
    s.defineName("Cost", "[Prices.xlsx]Sheet1!$B$2:$B$4");
    s.addValidation("Sheet1", { kind: "decimal", op: "between", values: ["[Prices.xlsx]Sheet1!$B$2", "[Prices.xlsx]Sheet1!$B$4"], ranges: ["B2:B4"], error: "Within the price list" });
    s.addValidation("Sheet1", { kind: "custom", formula: "COUNTIF([Prices.xlsx]Sheet1!$A$2:$A$4,C2)>0", ranges: ["C2:C4"], alert: "warning" });
    s.addValidation("Sheet1", { kind: "list", source: "Cost", ranges: ["D2"] });
    s.addValidation("Sheet1", { kind: "whole", op: "greaterThan", values: ["1"], ranges: ["E2"] });
    return s;
  };

  it("are written as Excel writes them: [1] in cell formulas and names, x14 validations, an externalLink part with the cells", () => {
    const bytes = toXlsx(filled().state);
    const files = unzipSync(bytes);
    const text = (name: string) => strFromU8(files[name]!);
    expect(text("xl/worksheets/sheet1.xml")).toContain("<f>[1]Sheet1!B2*2</f>");
    expect(text("xl/worksheets/sheet1.xml")).toContain("<v>5</v>");
    expect(text("xl/workbook.xml")).toContain('<definedName name="Cost">[1]Sheet1!$B$2:$B$4</definedName>');
    expect(text("xl/workbook.xml")).toContain("<externalReferences>");
    const sheet = text("xl/worksheets/sheet1.xml");
    // Excel resolved no way of writing a source outside the workbook in the validation extension (every form came back as #REF!,
    // kit files 23 and 34), so the older part has the values kept: a limit is the value of the cell it reads. The whole rule is Pli's.
    expect(sheet).not.toContain("<x14:dataValidation");
    expect(sheet).toMatch(/<dataValidation type="decimal" [^>]*sqref="B2:B4"><formula1>2\.5<\/formula1><formula2>12<\/formula2><\/dataValidation>/);
    expect(sheet).not.toContain('sqref="C2:C4"><formula1>'); // a formula over a range can't be kept as values
    expect(sheet).toContain("<pli:external rule=");
    expect(sheet).toContain('<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="D2">');
    expect(sheet).toContain("<formula1>Cost</formula1>");
    expect(text("xl/externalLinks/externalLink1.xml")).toContain('<cell r="B2"><v>2.5</v></cell>');
    expect(text("xl/externalLinks/externalLink1.xml")).toContain('<cell r="C1" t="b"><v>1</v></cell>');
    expect(text("xl/externalLinks/_rels/externalLink1.xml.rels")).toContain('Target="../data/Prices.xlsx" TargetMode="External"');
    expect(lintPackage(bytes)).toEqual([]);
  });

  it("read back to the same formulas, names, rules and cells", () => {
    const original = filled();
    const { workbook, warnings } = fromXlsx(toXlsx(original.state));
    expect(warnings).toEqual([]);
    const back = new SheetSession(workbook);
    expect(back.cell("Sheet1", "A1")!.f).toBe("[Prices.xlsx]Sheet1!B2*2");
    expect(back.value("Sheet1", "A1")).toBe(5);
    expect(back.value("Sheet1", "A2")).toBe(18.5);
    expect(workbook.names).toEqual({ Cost: "[Prices.xlsx]Sheet1!$B$2:$B$4" });
    expect(back.externalBooks).toEqual([{ name: "Prices.xlsx", path: "../data/Prices.xlsx", read: "2025-12-09", sheets: { Sheet1: { A1: "Item", A2: "Pens", A3: "Paper", A4: "Ink", B1: "Price", B2: 2.5, B3: 4, B4: 12, C1: true, D1: "n/a" } } }]);
    const rules = back.validations("Sheet1");
    expect(rules.map((r) => r.kind)).toEqual(expect.arrayContaining(["decimal", "custom", "list", "whole"]));
    const decimal = rules.find((r) => r.kind === "decimal") as Extract<Validation, { values: string[] }>;
    expect(decimal.values).toEqual(["[Prices.xlsx]Sheet1!$B$2", "[Prices.xlsx]Sheet1!$B$4"]);
    expect(decimal.error).toBe("Within the price list");
    expect(() => back.setCell("Sheet1", "B2", 13)).toThrow();
    back.setCell("Sheet1", "B2", 3);
    const custom = rules.find((r) => r.kind === "custom")!;
    expect(custom.alert).toBe("warning");
    expect(back.checkEntry("Sheet1", "C2", "Glue")).toMatchObject({ alert: "warning" });
    expect(back.checkEntry("Sheet1", "C2", "Ink")).toBeNull();
    expect(back.validationChoices("Sheet1", "D2")).toEqual(["2.5", "4", "12"]);
    // and writing that again gives the same parts
    const again = unzipSync(toXlsx(workbook));
    expect(strFromU8(again["xl/worksheets/sheet1.xml"]!)).toContain("<f>[1]Sheet1!B2*2</f>");
  });

  it("number the workbooks in the order they are met, whichever kind of reader meets them first", () => {
    const s = new SheetSession(createWorkbook("E", ["Sheet1"]));
    s.setCell("Sheet1", "A1", "=[B.xlsx]S!A1+[A.xlsx]S!A1");
    s.setCell("Sheet1", "A2", "='[My Book.xlsx]My sheet'!A1");
    const files = unzipSync(toXlsx(s.state));
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain("<f>[1]S!A1+[2]S!A1</f>");
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain("<f>'[3]My sheet'!A1</f>");
    const back = fromXlsx(toXlsx(s.state)).workbook;
    expect(back.sheets[0]!.cells["A1"]!.f).toBe("[B.xlsx]S!A1+[A.xlsx]S!A1");
    expect(back.sheets[0]!.cells["A2"]!.f).toBe("'[My Book.xlsx]My sheet'!A1");
  });
});

describe("calculator", () => {
  it("lists nothing for a formula that names a workbook with a typo", () => {
    const calc = new Calculator({ id: "w", type: "workbook", title: "", sheets: [{ id: "s", name: "Sheet1", cells: { A1: { f: "[X.xlsx]Sheet1!A1" } } }] });
    expect(calc.value("Sheet1", "A1")).toEqual({ error: "#REF!" });
  });
});
