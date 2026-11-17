import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseExternalRef, parseWorkbook, serializeWorkbook, toXlsx, type PasteReport, type Validation } from "../src";
import { lintPackage } from "./excel-check/lint";

const make = (mode?: "off" | "warn" | "refuse") => {
  const s = new SheetSession(createWorkbook("V", ["Sheet1", "Lists"]), { now: () => 46_000.5, ...(mode ? { validatePaste: mode } : {}) });
  s.setValues("Lists", "A1", [["red"], ["green"], ["Blue"]]);
  return s;
};
const list = (s: SheetSession, sheet = "Sheet1"): Extract<Validation, { kind: "list" }> => s.validations(sheet)[0] as never;

describe("lists with several choices in a cell", () => {
  it("checks every item against the list", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B5"], multiple: true });
    s.setCell("Sheet1", "B2", "red");
    s.setCell("Sheet1", "B3", "red, green");
    s.setCell("Sheet1", "B4", "BLUE, Red, green"); // without regard to capitals
    s.setCell("Sheet1", "B5", "red,green"); // spaces around the separator don't matter
    expect(() => s.setCell("Sheet1", "B2", "red, pink")).toThrow("Choose one or more of the values in the list.");
    expect(() => s.setCell("Sheet1", "B2", "pink")).toThrow();
    expect(s.invalidCells("Sheet1")).toEqual([]);
    s.setCell("Sheet1", "B2", "red, pink", { validate: false });
    expect(s.invalidCells("Sheet1")).toEqual(["B2"]);
  });

  it("is a plain list without the flag: a cell with two items is refused", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2"] });
    expect(() => s.setCell("Sheet1", "B2", "red, green")).toThrow();
  });

  it("uses another separator, and keeps items that hold the default one", () => {
    const s = make();
    s.setValues("Lists", "A5", [["Smith, Jo"], ["Lee"]]);
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$5:$A$6", ranges: ["C1:C3"], multiple: true, separator: "; " });
    s.setCell("Sheet1", "C1", "Smith, Jo; Lee");
    s.setCell("Sheet1", "C2", "Smith, Jo");
    expect(() => s.setCell("Sheet1", "C3", "Smith, Lee")).toThrow();
    expect(s.validationSelection("Sheet1", "C1")).toEqual(["Smith, Jo", "Lee"]);
  });

  it("picks and unpicks items through pickChoice, as a dropdown cell with several choices does", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2"], multiple: true, separator: " | " });
    s.pickChoice("Sheet1", "B2", "red");
    s.pickChoice("Sheet1", "B2", "green");
    expect(s.cell("Sheet1", "B2")?.v).toBe("red | green");
    s.pickChoice("Sheet1", "B2", "RED");
    expect(s.cell("Sheet1", "B2")?.v).toBe("green");
    s.pickChoice("Sheet1", "B2", "green");
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    s.pickChoice("Sheet1", "B2", "red");
    s.pickChoice("Sheet1", "B2", null);
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    // a single list replaces
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B4"] });
    s.pickChoice("Sheet1", "B4", "red");
    s.pickChoice("Sheet1", "B4", "green");
    expect(s.cell("Sheet1", "B4")?.v).toBe("green");
  });

  it("is kept in the saved JSON, and refused when badly made", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2"], multiple: true, separator: ";" });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.validations![0]).toMatchObject({ multiple: true, separator: ";" });
    expect(() => s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["C2"], multiple: true, separator: "" })).toThrow(/separator/);
    expect(() => s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["C2"], snapshot: { items: [] } })).toThrow(/another workbook/);
  });

  it("is written to XLSX as a plain list that only informs, with Pli's extension keeping the rest", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B5"], multiple: true, separator: "; " });
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["D2"], multiple: true, alert: "warning" });
    const bytes = toXlsx(s.state);
    expect(lintPackage(bytes)).toEqual([]);
    const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('<dataValidation type="list" errorStyle="information" allowBlank="1" showErrorMessage="1" sqref="B2:B5"><formula1>Lists!$A$1:$A$3</formula1>');
    expect(sheet).toContain('<dataValidation type="list" errorStyle="warning"');
    expect(sheet).toContain('<pli:validation sqref="B2:B5" multiple="1" separator="; " alert="stop"/>');
    const back = fromXlsx(bytes);
    expect(back.warnings).toEqual([]);
    const rules = back.workbook.sheets[0]!.validations as Validation[];
    expect(rules[0]).toMatchObject({ kind: "list", source: "Lists!$A$1:$A$3", multiple: true, separator: "; " });
    expect(rules[0]!.alert).toBeUndefined();
    expect(rules[1]).toMatchObject({ multiple: true, alert: "warning" });
    // a file from Excel, which has no extension, reads as the plain list it is
    const plain = zipSync({ ...unzipSync(bytes), "xl/worksheets/sheet1.xml": strToU8(sheet.replace(/<ext uri="\{7D0F[^]*?<\/ext>/, "")) });
    expect((fromXlsx(plain).workbook.sheets[0]!.validations![0] as { multiple?: boolean }).multiple).toBeUndefined();
  });
});

describe("lists read from another workbook", () => {
  const prices = [["Pens"], ["Paper"], [""], ["Ink"]];
  const make2 = (options: { resolver?: (book: string, ref: string) => unknown } = {}) => {
    const s = new SheetSession(createWorkbook("E", ["Sheet1"]), { now: () => 46_000.5, ...(options.resolver ? { externalLists: options.resolver as never } : {}) });
    s.addValidation("Sheet1", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$4", ranges: ["B2:B5"] });
    return s;
  };

  it("takes a source apart in Excel's two spellings", () => {
    expect(parseExternalRef("[Prices.xlsx]Sheet1!$A$1:$A$10")).toEqual({ book: "Prices.xlsx", sheet: "Sheet1", range: "A1:A10" });
    expect(parseExternalRef("'[Price list.xlsx]My sheet'!b2")).toEqual({ book: "Price list.xlsx", sheet: "My sheet", range: "B2" });
    expect(parseExternalRef("Lists!$A$1:$A$3")).toBeNull();
    expect(parseExternalRef("OFFSET(A1,0,0)")).toBeNull();
  });

  it("without a resolver or a snapshot the list is empty and says why", () => {
    const s = make2();
    expect(s.validationChoices("Sheet1", "B2")).toEqual([]);
    expect(s.externalListStatus("Sheet1", "B2")).toMatchObject({ state: "missing", book: "Prices.xlsx", ref: "Sheet1!$A$1:$A$4" });
    expect(s.externalListStatus("Sheet1", "B2")!.reason).toContain("can't read Prices.xlsx");
    expect(s.externalListStatus("Sheet1", "Z9")).toBeNull();
  });

  it("is read through the host's resolver and kept as a snapshot with the day, with no undo step of its own", async () => {
    const asked: string[][] = [];
    const s = make2({ resolver: (book, ref) => (asked.push([book, ref]), prices.map((r) => r[0])) });
    const result = await s.refreshExternalLists();
    expect(asked).toEqual([["Prices.xlsx", "Sheet1!$A$1:$A$4"]]);
    expect(result).toMatchObject({ updated: 1, unchanged: 0, failed: [], offline: false });
    expect(s.validationChoices("Sheet1", "B2")).toEqual(["Pens", "Paper", "Ink"]);
    expect(list(s).snapshot).toEqual({ items: ["Pens", "Paper", "", "Ink"], read: "2025-12-09" });
    expect(s.externalListStatus("Sheet1", "B3")).toMatchObject({ state: "fresh", read: "2025-12-09", items: ["Pens", "Paper", "Ink"] });
    s.setCell("Sheet1", "B2", "ink");
    expect(() => s.setCell("Sheet1", "B3", "Pencils")).toThrow("Choose one of the values in the list.");
    // the cell typed above is one undo step and the rule another: the snapshot made no step of its own
    s.undo();
    s.undo();
    expect(s.validations("Sheet1")).toEqual([]);
    // reading again with the same items changes nothing
    const t = make2({ resolver: async () => ["Pens", "Paper", "", "Ink"] });
    await t.refreshExternalLists();
    expect(await t.refreshExternalLists()).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it("keeps the snapshot, flagged stale, when the host can't read the workbook, or isn't there", async () => {
    let fail = false;
    const s = make2({ resolver: () => (fail ? null : ["Pens", "Ink"]) });
    await s.refreshExternalLists();
    fail = true;
    const r = await s.refreshExternalLists();
    expect(r.failed).toMatchObject([{ book: "Prices.xlsx", reason: "Prices.xlsx couldn't be found" }]);
    expect(s.externalListStatus("Sheet1", "B2")).toMatchObject({ state: "stale", items: ["Pens", "Ink"] });
    expect(s.externalListStatus("Sheet1", "B2")!.reason).toContain("copy saved on 2025-12-09");
    expect(s.validationChoices("Sheet1", "B2")).toEqual(["Pens", "Ink"]);
    // a resolver that throws is a failure too
    s.externalLists = () => {
      throw new Error("offline");
    };
    expect((await s.refreshExternalLists()).failed[0]!.reason).toBe("offline");
    // and with no resolver at all, a reopened workbook still works from its snapshot
    const reopened = new SheetSession(parseWorkbook(serializeWorkbook(s.state)));
    expect(reopened.validationChoices("Sheet1", "B2")).toEqual(["Pens", "Ink"]);
    expect(reopened.externalListStatus("Sheet1", "B2")).toMatchObject({ state: "stale" });
    expect(await reopened.refreshExternalLists()).toMatchObject({ offline: true });
  });

  it("asks once for a range that several rules read", async () => {
    let calls = 0;
    const s = make2({ resolver: () => (calls++, ["a", "b"]) });
    s.addValidation("Sheet1", { kind: "list", source: "[prices.XLSX]Sheet1!$A$1:$A$4", ranges: ["D2"] });
    await s.refreshExternalLists();
    expect(calls).toBe(1);
  });

  it("goes into the file as an external link with the cells that were read, and comes back", async () => {
    const s = make2({ resolver: () => ["Pens", "Paper", "", "Ink"] });
    s.addValidation("Sheet1", { kind: "list", source: "'[Old prices.xlsx]Summer 25'!$C$2:$D$3", ranges: ["F2"], multiple: true });
    await s.refreshExternalLists();
    const bytes = toXlsx(s.state);
    expect(lintPackage(bytes)).toEqual([]);
    const files = unzipSync(bytes);
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('<externalReferences><externalReference r:id="rIdExtLink1"/><externalReference r:id="rIdExtLink2"/></externalReferences>');
    expect(strFromU8(files["xl/externalLinks/_rels/externalLink1.xml.rels"]!)).toContain('Target="Prices.xlsx" TargetMode="External"');
    expect(strFromU8(files["xl/externalLinks/externalLink1.xml"]!)).toContain('<cell r="A1" t="str"><v>Pens</v></cell>');
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    // Excel resolved no source outside the workbook in the validation extension (#REF! for every form), so the file has the items kept as a plain list; the rule itself is in Pli's extension
    expect(sheet).not.toContain("<x14:dataValidation");
    expect(sheet).toContain('<formula1>"Pens,Paper,Ink"</formula1>');
    expect(sheet).toContain("<pli:external rule=");
    const back = fromXlsx(bytes);
    expect(back.warnings).toEqual([]);
    const rules = back.workbook.sheets[0]!.validations as Extract<Validation, { kind: "list" }>[];
    expect(rules[0]).toMatchObject({ source: "[Prices.xlsx]Sheet1!$A$1:$A$4", snapshot: { items: ["Pens", "Paper", "", "Ink"], read: "2025-12-09", path: "Prices.xlsx" } });
    expect(rules[1]).toMatchObject({ source: "'[Old prices.xlsx]Summer 25'!$C$2:$D$3", multiple: true });
    const reopened = new SheetSession(back.workbook);
    expect(reopened.validationChoices("Sheet1", "B2")).toEqual(["Pens", "Paper", "Ink"]);
  });

  it("reads a list that Excel wrote with a link to a file, and keeps the path", () => {
    const s = make2({ resolver: () => ["x"] });
    const files = unzipSync(toXlsx(new SheetSession(createWorkbook("E", ["Sheet1"])).state));
    files["xl/worksheets/sheet1.xml"] = strToU8(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:dataValidations xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1"><x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"><x14:formula1><xm:f>[1]Sheet1!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>B2</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst></worksheet>',
    );
    files["xl/workbook.xml"] = strToU8(strFromU8(files["xl/workbook.xml"]!).replace("</sheets>", '</sheets><externalReferences><externalReference r:id="rId99"/></externalReferences>'));
    files["xl/_rels/workbook.xml.rels"] = strToU8(strFromU8(files["xl/_rels/workbook.xml.rels"]!).replace("</Relationships>", '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>'));
    files["xl/externalLinks/externalLink1.xml"] = strToU8('<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><externalBook r:id="rId1"><sheetNames><sheetName val="Sheet1"/></sheetNames><sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1" t="str"><v>North</v></cell></row><row r="3"><cell r="A3"><v>7</v></cell></cell></row></sheetData></sheetDataSet></externalBook></externalLink>'.replace("</cell></cell>", "</cell>"));
    files["xl/externalLinks/_rels/externalLink1.xml.rels"] = strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="file:///Users/someone/My%20Prices.xlsx" TargetMode="External"/></Relationships>');
    const back = fromXlsx(zipSync(files));
    const rule = back.workbook.sheets[0]!.validations![0] as Extract<Validation, { kind: "list" }>;
    expect(rule.source).toBe("'[My Prices.xlsx]Sheet1'!$A$1:$A$3");
    expect(rule.snapshot).toEqual({ items: ["North", "", "7"], path: "file:///Users/someone/My%20Prices.xlsx" });
    expect(s).toBeTruthy();
    // and writing it again keeps the path Excel gave
    const again = unzipSync(toXlsx(back.workbook));
    expect(strFromU8(again["xl/externalLinks/_rels/externalLink1.xml.rels"]!)).toContain('Target="file:///Users/someone/My%20Prices.xlsx"');
  });
});

describe("checking what a paste brings in", () => {
  const rules = (s: SheetSession) => {
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B2:B6"] });
    s.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["C2:C6"], alert: "warning" });
  };

  it("lets everything in by default, as Excel does", () => {
    const s = make();
    rules(s);
    expect(s.validatePaste).toBe("off");
    s.pasteText("Sheet1", "B2", "5\t7\n50\tpink");
    expect(s.cell("Sheet1", "B3")?.v).toBe(50);
    expect(s.lastPasteReport).toBeNull();
    expect(s.invalidCells("Sheet1")).toEqual(["C2", "B3", "C3"]);
  });

  it("warn: puts it all in and says which cells break their rules", () => {
    const s = make("warn");
    rules(s);
    const heard: PasteReport[] = [];
    s.onPasteReport((r) => heard.push(r));
    s.pasteText("Sheet1", "B2", "5\tred\n50\tpink\n0\tgreen");
    expect(s.cell("Sheet1", "B3")?.v).toBe(50);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ action: "paste", mode: "warn", sheet: "Sheet1", range: "B2:C4", refused: [], cancelled: false });
    expect(heard[0]!.invalid.map((p) => [p.address, p.alert, p.value])).toEqual([["B3", "stop", "50"], ["C3", "warning", "pink"], ["B4", "stop", "0"]]);
    expect(s.lastPasteReport).toBe(heard[0]);
    s.undo(); // one step
    expect(s.cell("Sheet1", "B3")).toBeUndefined();
    s.pasteText("Sheet1", "B2", "5\tred");
    expect(s.lastPasteReport).toBeNull();
  });

  it("refuse: cells that break a stop rule keep what they had, the rest arrive, in one undo step", () => {
    const s = make("refuse");
    rules(s);
    s.setValues("Sheet1", "B2", [[1], [2], [3]]);
    s.pasteText("Sheet1", "B2", "5\tred\n50\tpink\n0\tgreen");
    expect(s.cell("Sheet1", "B2")?.v).toBe(5);
    expect(s.cell("Sheet1", "B3")?.v).toBe(2); // refused: kept
    expect(s.cell("Sheet1", "B4")?.v).toBe(3);
    expect(s.cell("Sheet1", "C3")?.v).toBe("pink"); // a warning rule only reports
    const r = s.lastPasteReport!;
    expect(r.refused).toEqual(["B3", "B4"]);
    expect(r.invalid.map((p) => p.address).sort()).toEqual(["B3", "B4", "C3"]);
    s.undo();
    expect(s.cell("Sheet1", "B2")?.v).toBe(1);
    expect(s.cell("Sheet1", "C3")).toBeUndefined();
  });

  it("checks pasted HTML tables and formulas by their results", () => {
    const s = make("refuse");
    rules(s);
    s.pasteHtml("Sheet1", "B2", "<table><tr><td>99</td><td>red</td></tr><tr><td>4</td><td>x</td></tr></table>");
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(s.cell("Sheet1", "B3")?.v).toBe(4);
    expect(s.lastPasteReport!.refused).toEqual(["B2"]);
    s.pasteText("Sheet1", "B5", "=3*5");
    expect(s.cell("Sheet1", "B5")).toBeUndefined();
    s.pasteText("Sheet1", "B5", "=3+5");
    expect(s.cell("Sheet1", "B5")?.f).toBe("3+5");
  });

  it("paste values meets the rules already there, while a plain copy brings its own", () => {
    const s = make("refuse");
    s.setValues("Sheet1", "A1", [[99, 5]]);
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B2:B3"] });
    s.pasteValues({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "B2" });
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(s.lastPasteReport!.refused).toEqual(["B2"]);
    s.pasteValues({ sheet: "Sheet1", range: "B1" }, { sheet: "Sheet1", at: "B2" });
    expect(s.cell("Sheet1", "B2")?.v).toBe(5);
    expect(s.validations("Sheet1")).toHaveLength(1);
    // a plain copy of an unvalidated cell onto B3 replaces the rule there, as Excel does, so nothing is refused
    s.copy({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "B3" });
    expect(s.cell("Sheet1", "B3")?.v).toBe(99);
    expect(s.invalidCells("Sheet1")).toEqual([]);
  });

  it("paste values keeps the dropdown, format and style of the cell it lands on, and turns formulas into values", () => {
    const s = make("warn");
    s.setValues("Sheet1", "A1", [["=1+2"]]);
    s.setStyle("Sheet1", "B1", { bold: true });
    s.setFormat("Sheet1", "B1", "0.00");
    s.pasteValues({ sheet: "Sheet1", range: "A1" }, { sheet: "Sheet1", at: "B1" });
    expect(s.cell("Sheet1", "B1")).toEqual({ v: 3, fmt: "0.00", s: { bold: true } });
  });

  it("a move or a cut copy is refused as a whole when a cell would break the rule that travels with it", () => {
    const s = make("refuse");
    s.setValues("Sheet1", "A1", [[5]]);
    s.setValues("Sheet1", "B1", [[3]]);
    s.addValidation("Sheet1", { kind: "custom", formula: "A1>0", ranges: ["B1"] });
    // the rule's reference moves with it (as a copied rule's does), so at D5 it reads C5, which is empty
    expect(() => s.move({ sheet: "Sheet1", range: "B1" }, { sheet: "Sheet1", at: "D5" })).toThrow(/Nothing was moved: 1 cell would break a data validation rule \(D5\)/);
    expect(s.cell("Sheet1", "B1")?.v).toBe(3);
    expect(s.lastPasteReport).toMatchObject({ action: "move", cancelled: true, refused: ["D5"] });
    expect(() => s.copy({ sheet: "Sheet1", range: "B1" }, { sheet: "Sheet1", at: "D5" }, { cut: true })).toThrow(/Nothing was moved/);
    s.copy({ sheet: "Sheet1", range: "B1" }, { sheet: "Sheet1", at: "B2" }); // a plain copy: B2 reads A2, empty, so the copy is refused cell by cell
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(s.lastPasteReport).toMatchObject({ action: "copy", refused: ["B2"] });
  });

  it("a sort that would put a bad value where a rule forbids it is refused; one that only shuffles is not", () => {
    const s = make("refuse");
    s.setValues("Sheet1", "B1", [[3], [1], [2], [30]]);
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B1:B3"] });
    expect(() => s.sort("Sheet1", "B1:B4", { descending: true })).toThrow(/Nothing was sorted/);
    s.sort("Sheet1", "B1:B3");
    expect([1, 2, 3].map((r) => s.cell("Sheet1", `B${r}`)?.v)).toEqual([1, 2, 3]);
  });

  it("fill and the fill handle are checked against the rules of the cells they fill", () => {
    const s = make("refuse");
    s.setValues("Sheet1", "B1", [[50]]);
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B1"] });
    s.fill("Sheet1", "B1:B4", "down");
    expect(s.validationAt("Sheet1", "B3")?.kind).toBe("whole"); // the rule goes along with the fill
    expect(s.cell("Sheet1", "B2")).toBeUndefined();
    expect(s.lastPasteReport).toMatchObject({ action: "fill", refused: ["B2", "B3", "B4"] });
    s.setValues("Sheet1", "B1", [[4]]);
    s.autofill("Sheet1", "B1", "B1:B4");
    expect(s.cell("Sheet1", "B4")?.v).toBe(4);
  });

  it("does not blame cells that were already wrong before a copy or sort, and ignores alerts of none", () => {
    const s = make("refuse");
    s.setValues("Sheet1", "A1", [[50], [5]]);
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1:A2", "D1:D2"] });
    s.copy({ sheet: "Sheet1", range: "A1:A2" }, { sheet: "Sheet1", at: "D1" }); // the rule travels; 50 was invalid already
    expect(s.cell("Sheet1", "D1")?.v).toBe(50);
    expect(s.lastPasteReport).toBeNull();
    s.sort("Sheet1", "A1:A2");
    expect(s.cell("Sheet1", "A1")?.v).toBe(5);
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["F1"], alert: "none" });
    s.pasteText("Sheet1", "F1", "999");
    expect(s.cell("Sheet1", "F1")?.v).toBe(999);
  });

  it("can be switched on a session at any time, and refuses a mode it doesn't know", () => {
    const s = make();
    s.validatePaste = "refuse";
    expect(s.validatePaste).toBe("refuse");
    expect(() => {
      s.validatePaste = "sometimes" as never;
    }).toThrow();
  });
});

describe("checking the result of a typed formula", () => {
  it("refuses a formula whose result breaks a stop rule, and lets errors and blanks through", () => {
    const s = make();
    s.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["B2:B4"] });
    expect(() => s.setCell("Sheet1", "B2", "=5*5")).toThrow();
    s.setCell("Sheet1", "B2", "=2*3");
    s.setCell("Sheet1", "B3", "=1/0");
    expect(s.checkEntry("Sheet1", "B4", "=A1&\"\"")).toBeNull();
    s.addValidation("Sheet1", { kind: "custom", formula: "B7<>5", ranges: ["B7"] });
    expect(() => s.setCell("Sheet1", "B7", "=2+3")).toThrow();
  });
});
