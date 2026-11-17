import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, validateWorkbook, type Validation, type ValidationSpec } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Validation", ["Sheet1", "Lists"]), { now: () => 45_000.5 });
  s.setValues("Lists", "A1", [["red"], ["green"], ["Blue"]]);
  s.setValues("Sheet1", "A1", [["Qty", "Name"], [5, "ok"]]);
  return s;
};

describe("data validation", () => {
  it("refuses numbers outside the limits, and says what is wanted", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A2:A9"] });
    expect(() => s.setCell("Sheet1", "A3", 11)).toThrow("Enter a whole number between 1 and 10.");
    expect(() => s.setCell("Sheet1", "A3", "2.5")).toThrow(/whole number/);
    expect(() => s.setCell("Sheet1", "A3", "text")).toThrow(/whole number/);
    s.setCell("Sheet1", "A3", "7");
    expect(s.cell("Sheet1", "A3")?.v).toBe(7);
    s.setCell("Sheet1", "B3", "anything"); // outside the range
    s.setCell("Sheet1", "A4", null); // blanks are let through
  });

  it("can refuse blanks, and lets bulk loads through (a formula is checked by its result)", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "decimal", op: "greaterThan", values: ["0"], ranges: ["A2:A9"], noBlank: true });
    expect(() => s.setCell("Sheet1", "A3", null)).toThrow();
    expect(() => s.setCell("Sheet1", "A3", "=-5")).toThrow(/greater than 0/); // a formula is checked by what it works out to
    s.setCell("Sheet1", "A3", "=5");
    s.setValues("Sheet1", "A4", [[-1]]); // setValues puts things in as a paste does
    expect(s.cell("Sheet1", "A4")?.v).toBe(-1);
    s.setCell("Sheet1", "A5", -3, { validate: false });
    expect(s.cell("Sheet1", "A5")?.v).toBe(-3);
  });

  it("checks decimals, dates, times and text length", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "decimal", op: "lessThanOrEqual", values: ["1.5"], ranges: ["C1"] });
    s.addValidation("Sheet1", { kind: "date", op: "greaterThan", values: ["DATE(2024,1,1)"], ranges: ["C2"] });
    s.addValidation("Sheet1", { kind: "time", op: "between", values: ["0.25", "0.75"], ranges: ["C3"] });
    s.addValidation("Sheet1", { kind: "textLength", op: "lessThan", values: ["4"], ranges: ["C4"] });
    expect(() => s.setCell("Sheet1", "C1", 2)).toThrow();
    s.setCell("Sheet1", "C1", "1.5");
    expect(() => s.setCell("Sheet1", "C2", "3/5/2023")).toThrow(/date greater than DATE\(2024,1,1\)/);
    s.setCell("Sheet1", "C2", "3/5/2024");
    expect(() => s.setCell("Sheet1", "C3", "20:00")).toThrow(/time/);
    s.setCell("Sheet1", "C3", "12:00");
    expect(() => s.setCell("Sheet1", "C4", "abcd")).toThrow(/length/);
    s.setCell("Sheet1", "C4", "abc");
    s.setCell("Sheet1", "C4", 123);
    expect(() => s.setCell("Sheet1", "C4", 12345)).toThrow();
  });

  it("compares with a cell, relative to the top-left of the range", () => {
    const s = make();
    s.setValues("Sheet1", "E1", [[10], [20], [30]]);
    s.addValidation("Sheet1", { kind: "decimal", op: "lessThanOrEqual", values: ["E1"], ranges: ["D1:D3"] });
    expect(() => s.setCell("Sheet1", "D2", 21)).toThrow();
    s.setCell("Sheet1", "D2", 20);
    expect(() => s.setCell("Sheet1", "D3", 31)).toThrow();
  });

  it("takes a list from a range, without regard to capitals", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B9"] });
    expect(s.validationChoices("Sheet1", "B3")).toEqual(["red", "green", "Blue"]);
    expect(s.validationChoices("Sheet1", "A3")).toEqual([]);
    s.setCell("Sheet1", "B3", "BLUE");
    expect(() => s.setCell("Sheet1", "B3", "pink")).toThrow("Choose one of the values in the list.");
    s.setCell("Lists", "A3", "pink");
    s.setCell("Sheet1", "B3", "pink"); // the list follows its cells
  });

  it("takes custom formulas that see the entry", () => {
    const s = make();
    s.setValues("Sheet1", "F1", [["a"], ["b"]]);
    s.addValidation("Sheet1", { kind: "custom", formula: "COUNTIF($F$1:$F$9,F1)=1", ranges: ["F1:F9"] });
    expect(() => s.setCell("Sheet1", "F3", "a")).toThrow();
    s.setCell("Sheet1", "F3", "c");
    expect(() => s.setCell("Sheet1", "F4", "c")).toThrow();
  });

  it("warns, informs or says nothing, as asked, and uses its own words", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "equal", values: ["1"], ranges: ["A1"], alert: "warning", errorTitle: "Careful", error: "That isn't 1." });
    s.addValidation("Sheet1", { kind: "whole", op: "equal", values: ["1"], ranges: ["A2"], alert: "information" });
    s.addValidation("Sheet1", { kind: "whole", op: "equal", values: ["1"], ranges: ["A3"], alert: "none" });
    expect(s.checkEntry("Sheet1", "A1", 5)).toEqual({ alert: "warning", title: "Careful", message: "That isn't 1." });
    expect(s.checkEntry("Sheet1", "A2", 5)?.alert).toBe("information");
    expect(s.checkEntry("Sheet1", "A3", 5)).toBeNull();
    expect(s.checkEntry("Sheet1", "A1", 1)).toBeNull();
    s.setCell("Sheet1", "A1", 5); // only `stop` refuses
    expect(s.cell("Sheet1", "A1")?.v).toBe(5);
  });

  it("the first rule that covers a cell counts", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "equal", values: ["1"], ranges: ["A2"], error: "first" });
    s.addValidation("Sheet1", { kind: "whole", op: "equal", values: ["2"], ranges: ["A1:A9"], error: "second" });
    expect(s.checkEntry("Sheet1", "A2", 2)?.message).toBe("first");
    expect(s.checkEntry("Sheet1", "A3", 2)).toBeNull();
    expect(s.validationAt("Sheet1", "A2")).toMatchObject({ error: "first" });
  });

  it("finds the cells that break the rules", () => {
    const s = make();
    s.setValues("Sheet1", "A3", [[50], [7], ["x"]]);
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A2:A6"] });
    expect(s.invalidCells("Sheet1").sort()).toEqual(["A3", "A5"]);
  });

  it("follows inserted rows, renamed sheets, and can be changed and cleared, with undo", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B9", "D1"] });
    s.insertRows("Sheet1", 1);
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["B3:B10", "D2"]);
    s.insertRows("Lists", 1);
    expect(s.validations("Sheet1")[0]).toMatchObject({ source: "Lists!$A$2:$A$4" });
    s.renameSheet("Lists", "Colours");
    expect(s.validations("Sheet1")[0]).toMatchObject({ source: "Colours!$A$2:$A$4" });
    const rule = s.validations("Sheet1")[0]!;
    s.clearValidation("Sheet1", "D2");
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["B3:B10"]);
    s.updateValidation("Sheet1", { ...rule, hideArrow: true } as never);
    expect(s.validations("Sheet1")[0]).toMatchObject({ hideArrow: true });
    s.deleteValidation("Sheet1", rule.id);
    expect(s.validations("Sheet1")).toEqual([]);
    s.undo();
    s.undo();
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["B3:B10"]);
    s.deleteRows("Sheet1", 3, 8);
    expect(s.validations("Sheet1")).toEqual([]); // every cell it covered is gone
  });

  it("refuses rules that make no sense", () => {
    const s = make();
    const add = (v: object) => () => s.addValidation("Sheet1", { ranges: ["A1"], ...v } as never);
    expect(add({ kind: "whole", op: "between", values: ["1"] })).toThrow(/two values/);
    expect(add({ kind: "whole", op: "equal", values: ["1+"] })).toThrow(/formula/);
    expect(add({ kind: "list", source: '"a,b,c"' })).toThrow(/dropdown/);
    expect(add({ kind: "custom", formula: "" })).toThrow();
    expect(add({ kind: "whole", op: "equal", values: ["1"], alert: "loud" })).toThrow(/alert/);
    expect(add({ kind: "whole", op: "equal", values: ["1"], ranges: ["nope"] })).toThrow(/range/);
    expect(add({ kind: "other" })).toThrow(/Unknown/);
  });

  it("is kept in a saved workbook and checked when read", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "$H$1"], ranges: ["A2:A9"], noBlank: true, alert: "warning", errorTitle: "T", error: "E", promptTitle: "P", prompt: "Pick 1 to 10" });
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B9"], hideArrow: true });
    s.addValidation("Sheet1", { kind: "custom", formula: "LEN(C1)<5", ranges: ["C1:C9"] });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const wb = JSON.parse(serializeWorkbook(s.state)).workbook;
    wb.sheets[0].validations[0].colour = "red";
    expect(() => validateWorkbook(wb)).toThrow(/unknown field/);
  });
});

describe("data validation in XLSX files", () => {
  it("writes what Excel looks for", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A2:A9"], alert: "warning", errorTitle: "Hmm", error: "1 to 10, please", promptTitle: "Qty", prompt: "Whole numbers" });
    s.addValidation("Sheet1", { kind: "decimal", op: "greaterThan", values: ["0"], ranges: ["C1"], noBlank: true });
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B9"], hideArrow: true, alert: "none" });
    const sheet = strFromU8(unzipSync(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('<dataValidations count="3">');
    expect(sheet).toContain('<dataValidation type="whole" errorStyle="warning" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Hmm" error="1 to 10, please" promptTitle="Qty" prompt="Whole numbers" sqref="A2:A9"><formula1>1</formula1><formula2>10</formula2></dataValidation>');
    expect(sheet).toContain('<dataValidation type="decimal" operator="greaterThan" showErrorMessage="1" sqref="C1"><formula1>0</formula1></dataValidation>');
    expect(sheet).toContain('<dataValidation type="list" allowBlank="1" showDropDown="1" sqref="B2:B9"><formula1>Lists!$A$1:$A$3</formula1></dataValidation>');
  });

  it("reads back what it wrote", () => {
    const s = make();
    const specs: ValidationSpec[] = [
      { kind: "whole", op: "between", values: ["1", "$H$1"], ranges: ["A2:A9", "C2"], alert: "warning", errorTitle: "Hmm", error: "1 to 10", promptTitle: "Qty", prompt: "Whole numbers", noBlank: true } as never,
      { kind: "decimal", op: "notEqual", values: ["0"], ranges: ["C1"] },
      { kind: "date", op: "greaterThanOrEqual", values: ["DATE(2024,1,1)"], ranges: ["D1:D5"], alert: "information" },
      { kind: "time", op: "lessThan", values: ["0.5"], ranges: ["E1"] },
      { kind: "textLength", op: "lessThanOrEqual", values: ["20"], ranges: ["F1:F9"], alert: "none" },
      { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B9"], hideArrow: true },
      { kind: "custom", formula: "COUNTIF($G$1:$G$9,G1)=1", ranges: ["G1:G9"] },
    ];
    const rules = specs.map((x) => s.addValidation("Sheet1", x as never));
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const strip = (r: Validation) => ({ ...r, id: "" });
    expect(workbook.sheets[0]!.validations!.map(strip)).toEqual(rules.map(strip));
  });

  it("reads a file made by Excel, and keeps typed lists as dropdowns", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>
      <dataValidations count="6">
        <dataValidation type="whole" operator="between" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Out" error="Too big" promptTitle="Qty" prompt="1 to 10" sqref="A1:A5"><formula1>1</formula1><formula2>10</formula2></dataValidation>
        <dataValidation type="date" operator="greaterThan" showErrorMessage="1" sqref="B1"><formula1>_xlfn.DAYS(DATE(2025,1,1),0)</formula1></dataValidation>
        <dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="C1:C3"><formula1>$E$1:$E$3</formula1></dataValidation>
        <dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="D1"><formula1>"a,b,c"</formula1></dataValidation>
        <dataValidation type="custom" showErrorMessage="1" sqref="F1"><formula1>ISNUMBER(F1)</formula1></dataValidation>
        <dataValidation type="textLength" operator="between" showErrorMessage="1" sqref="G1"><formula1>1</formula1></dataValidation>
      </dataValidations></worksheet>`;
    const book = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`;
    const { workbook, warnings } = fromXlsx(zipSync({ "xl/workbook.xml": strToU8(book), "xl/_rels/workbook.xml.rels": strToU8(rels), "xl/worksheets/sheet1.xml": strToU8(sheet) }));
    const rules = workbook.sheets[0]!.validations!;
    expect(rules.map((r) => r.kind)).toEqual(["whole", "date", "list", "custom"]); // the one missing a limit is left out
    expect(rules[0]).toMatchObject({ op: "between", values: ["1", "10"], ranges: ["A1:A5"], errorTitle: "Out", error: "Too big", promptTitle: "Qty", prompt: "1 to 10" });
    expect(rules[0]!.noBlank).toBeUndefined(); // allowBlank="1"
    expect(rules[1]).toMatchObject({ op: "greaterThan", noBlank: true, values: ["DAYS(DATE(2025,1,1),0)"] });
    expect(rules[2]).toMatchObject({ source: "$E$1:$E$3" });
    expect(workbook.sheets[0]!.cells["D1"]!.control).toMatchObject({ type: "dropdown", options: [{ value: "a" }, { value: "b" }, { value: "c" }] });
    expect(warnings.join("\n")).toMatch(/data validation rules are of a kind/);
  });
  it("reads the lists Excel keeps in the sheet's extensions (a list that reads another sheet)", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>
      <extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1"><x14:dataValidation type="list" allowBlank="1" showErrorMessage="1"><x14:formula1><xm:f>Lists!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>B8 B10</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst></worksheet>`;
    const book = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`;
    const { workbook } = fromXlsx(zipSync({ "xl/workbook.xml": strToU8(book), "xl/_rels/workbook.xml.rels": strToU8(rels), "xl/worksheets/sheet1.xml": strToU8(sheet) }));
    expect(workbook.sheets[0]!.validations).toMatchObject([{ kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B8", "B10"] }]);
  });
});
