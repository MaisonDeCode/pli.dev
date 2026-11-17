import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, cellChoices, choicesIn, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, type CellControl } from "../src";
import { lintPackage } from "./excel-check/lint";

const tags: CellControl = { type: "dropdown", options: [{ value: "red" }, { value: "green" }, { value: "blue" }], multiple: true, separator: "; " };
const make = () => new SheetSession(createWorkbook("S", ["Sheet1"]));

describe("a separator for dropdown cells that hold several choices", () => {
  it("joins the choices picked with it, and reads them apart again", () => {
    const s = make();
    s.setControl("Sheet1", "A1:A3", tags);
    s.pickChoice("Sheet1", "A1", "red");
    s.pickChoice("Sheet1", "A1", "blue");
    expect(s.cell("Sheet1", "A1")?.v).toBe("red; blue");
    expect(cellChoices(s.cell("Sheet1", "A1"))).toEqual(["red", "blue"]);
    s.pickChoice("Sheet1", "A1", "red");
    expect(s.cell("Sheet1", "A1")?.v).toBe("blue");
    // without a separator of its own a control keeps the comma and a space
    s.setControl("Sheet1", "B1", { ...tags, separator: undefined } as CellControl);
    s.pickChoice("Sheet1", "B1", "red");
    s.pickChoice("Sheet1", "B1", "green");
    expect(s.cell("Sheet1", "B1")?.v).toBe("red, green");
  });

  it("is used when a strict dropdown checks what is typed", () => {
    const s = make();
    s.setControl("Sheet1", "A1", { ...tags, strict: true } as CellControl);
    s.setCell("Sheet1", "A1", "red; green");
    s.setCell("Sheet1", "A1", "red;green"); // spaces around it don't matter
    expect(() => s.setCell("Sheet1", "A1", "red; pink")).toThrow('"pink" isn\'t one of the choices');
    expect(() => s.setCell("Sheet1", "A1", "red, green")).toThrow(); // the comma is not this dropdown's separator
  });

  it("works for other separators, including a single character, and keeps spaces that are the separator", () => {
    expect(choicesIn("a/b/c", true, "/")).toEqual(["a", "b", "c"]);
    expect(choicesIn("a / b", true, " / ")).toEqual(["a", "b"]);
    expect(choicesIn("one two", true, " ")).toEqual(["one", "two"]);
    expect(choicesIn("a, b", false)).toEqual(["a, b"]);
  });

  it("is checked when a workbook is loaded", () => {
    const s = make();
    s.setControl("Sheet1", "A1", tags);
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.cells["A1"]!.control).toEqual(tags);
    const bad = (control: unknown) => JSON.stringify({ format: "pli.sheet", version: 1, workbook: { ...s.state, sheets: [{ ...s.state.sheets[0], cells: { A1: { control } } }] } });
    expect(() => parseWorkbook(bad({ ...tags, separator: "" }))).toThrow("one to eight characters");
    expect(() => parseWorkbook(bad({ ...tags, separator: "123456789" }))).toThrow("one to eight characters");
    expect(() => parseWorkbook(bad({ ...tags, multiple: undefined }))).toThrow("only a control that allows several choices has a separator");
    expect(() => parseWorkbook(bad({ type: "badge", multiple: true, separator: 4 }))).toThrow("one to eight characters");
    expect(parseWorkbook(bad({ type: "badge", multiple: true, separator: "|" })).sheets[0]!.cells["A1"]!.control).toEqual({ type: "badge", multiple: true, separator: "|" });
  });

  it("goes to Excel as a list that never complains, and comes back with its separator and strictness", () => {
    const s = make();
    s.setControl("Sheet1", "A1:A2", { ...tags, strict: true } as CellControl);
    s.setControl("Sheet1", "B1", { ...tags, separator: undefined } as CellControl);
    s.setControl("Sheet1", "C1", { type: "dropdown", options: [{ value: "x" }, { value: "y" }] });
    const bytes = toXlsx(s.state);
    expect(lintPackage(bytes)).toEqual([]);
    const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!);
    // Excel's list would refuse "red; blue", so the file's list never complains; Pli's extension holds the rest
    expect(sheet).toContain('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" errorStyle="information" sqref="A1 A2"><formula1>"red,green,blue"</formula1></dataValidation>');
    expect(sheet).toContain('<pli:validation sqref="A1 A2" dropdown="1" multiple="1" separator="; " alert="stop"/>');
    expect(sheet).toContain('<pli:validation sqref="B1" dropdown="1" multiple="1" separator=", " alert="none"/>');
    const back = fromXlsx(bytes);
    expect(back.warnings).toEqual([]);
    const cells = back.workbook.sheets[0]!.cells;
    expect(cells["A2"]!.control).toEqual({ type: "dropdown", options: [{ value: "red" }, { value: "green" }, { value: "blue" }], multiple: true, separator: "; ", strict: true });
    expect(cells["B1"]!.control).toEqual({ type: "dropdown", options: [{ value: "red" }, { value: "green" }, { value: "blue" }], multiple: true });
    expect(cells["C1"]!.control).toEqual({ type: "dropdown", options: [{ value: "x" }, { value: "y" }] });
    // a file Excel saved has no such extension: the list is a plain dropdown again
    const plain = fromXlsx(new Uint8Array(toXlsxWithoutExtension(bytes)));
    expect(plain.workbook.sheets[0]!.cells["A1"]!.control).toEqual({ type: "dropdown", options: [{ value: "red" }, { value: "green" }, { value: "blue" }] });
  });
});

function toXlsxWithoutExtension(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const name = "xl/worksheets/sheet1.xml";
  files[name] = new TextEncoder().encode(strFromU8(files[name]!).replace(/<extLst>.*<\/extLst>/s, ""));
  return zipSync(files);
}
