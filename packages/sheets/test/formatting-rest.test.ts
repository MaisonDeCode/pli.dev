import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

const make = () => new SheetSession(createWorkbook("Rest", ["Sheet1", "Limits"]), { now: () => 45_000.5 });
const sheetXml = (s: SheetSession, n = 1) => strFromU8(unzipSync(toXlsx(s.state))[`xl/worksheets/sheet${n}.xml`]!);
const back = (s: SheetSession) => fromXlsx(toXlsx(s.state));

describe("thresholds that point at other sheets", () => {
  it("put a data bar in Excel 2010's extension, with the ordinary form holding plain ends", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:A5"], min: { type: "formula", value: "Limits!$A$1" }, max: { type: "formula", value: "Limits!$A$2" }, color: "#638ec6" });
    const xml = sheetXml(s);
    expect(xml).toContain('<dataBar minLength="0" maxLength="100"><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar>');
    expect(xml).toContain('<x14:cfvo type="formula"><xm:f>Limits!$A$1</xm:f></x14:cfvo><x14:cfvo type="formula"><xm:f>Limits!$A$2</xm:f></x14:cfvo>');
    expect(xml).not.toContain('val="Limits!');
    const rule = back(s).workbook.sheets[0]!.conditional![0]!;
    expect(rule).toMatchObject({ kind: "dataBar", min: { type: "formula", value: "Limits!$A$1" }, max: { type: "formula", value: "Limits!$A$2" } });
  });

  it("put an icon set whole in the extension, and read it back with its steps", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "iconSet", ranges: ["B1:B5"], set: "4Arrows", thresholds: [{ type: "formula", value: "Limits!$A$1" }, { type: "percent", value: 50 }, { type: "num", value: 90, gte: false }], reverse: true });
    const xml = sheetXml(s);
    expect(xml).not.toContain("<iconSet ");
    expect(xml).toContain('<x14:iconSet iconSet="4Arrows" reverse="1">');
    expect(xml).toContain('<x14:cfvo type="formula"><xm:f>Limits!$A$1</xm:f></x14:cfvo>');
    expect(xml).toContain('<x14:cfvo type="num" gte="0"><xm:f>90</xm:f></x14:cfvo>');
    const rule = back(s).workbook.sheets[0]!.conditional![0]!;
    expect(rule).toMatchObject({ kind: "iconSet", set: "4Arrows", reverse: true, thresholds: [{ type: "formula", value: "Limits!$A$1" }, { type: "percent", value: 50 }, { type: "num", value: 90, gte: false }] });
  });

  it("leave a threshold on the same sheet in the ordinary form", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:A5"], min: { type: "num", value: 0 }, max: { type: "formula", value: "$D$1" }, color: "#638ec6" });
    const xml = sheetXml(s);
    expect(xml).toContain('<cfvo type="formula" val="$D$1"/>');
  });
});

describe("every kind of rule Excel keeps in the extension is read", () => {
  const SHEET = (rules: string, dxf = "") =>
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>` +
    `<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings>${rules}</x14:conditionalFormattings></ext></extLst></worksheet>${dxf}`;
  const block = (rule: string, sqref = "A1:A9") => `<x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">${rule}<xm:sqref>${sqref}</xm:sqref></x14:conditionalFormatting>`;
  const dxf = "<x14:dxf><font><b/></font></x14:dxf>";
  const read = (rules: string) => {
    const bytes = toXlsx(make().state);
    const parts = unzipSync(bytes);
    parts["xl/worksheets/sheet1.xml"] = strToU8(SHEET(rules).replace(/<\/worksheet>.*$/, "</worksheet>"));
    return fromXlsx(zipSync(parts));
  };

  it("reads comparisons, formulas, text, blanks, errors, duplicates, ranks, averages and periods", () => {
    const { workbook, warnings } = read(
      [
        block(`<x14:cfRule type="cellIs" priority="1" operator="notBetween" id="{1}"><xm:f>Limits!$A$1</xm:f><xm:f>9</xm:f>${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="expression" priority="2" id="{2}"><xm:f>A1&gt;Limits!$A$1</xm:f>${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="beginsWith" priority="3" operator="beginsWith" text="Ap" id="{3}"><xm:f>LEFT(A1,LEN("Ap"))="Ap"</xm:f>${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="containsText" priority="4" operator="containsText" id="{4}"><xm:f>NOT(ISERROR(SEARCH(Limits!$A$1,A1)))</xm:f><xm:f>Limits!$A$1</xm:f>${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="containsBlanks" priority="5" id="{5}"><xm:f>LEN(TRIM(A1))=0</xm:f>${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="notContainsErrors" priority="6" id="{6}"><xm:f>NOT(ISERROR(A1))</xm:f>${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="duplicateValues" priority="7" id="{7}">${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="top10" priority="8" rank="5" percent="1" bottom="1" id="{8}">${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="aboveAverage" priority="9" aboveAverage="0" stdDev="2" id="{9}">${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="timePeriod" priority="10" timePeriod="lastWeek" id="{10}"><xm:f>AND(TODAY()-ROUNDDOWN(A1,0)&gt;=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN(A1,0)&lt;(WEEKDAY(TODAY())+7))</xm:f>${dxf}</x14:cfRule>`),
      ].join(""),
    );
    expect(warnings).toEqual([]);
    const rules = workbook.sheets[0]!.conditional!;
    expect(rules.map((r) => r.kind)).toEqual(["cell", "formula", "text", "formula", "blanks", "noErrors", "duplicates", "top", "average", "dates"]);
    expect(rules[0]).toMatchObject({ op: "notBetween", values: ["Limits!$A$1", "9"], style: { bold: true } });
    expect(rules[1]).toMatchObject({ formula: "A1>Limits!$A$1" });
    expect(rules[2]).toMatchObject({ op: "beginsWith", text: "Ap" });
    // Text that comes from a cell has no text of its own: the test Excel wrote for it is kept as a formula.
    expect(rules[3]).toMatchObject({ formula: "NOT(ISERROR(SEARCH(Limits!$A$1,A1)))" });
    expect(rules[7]).toMatchObject({ rank: 5, percent: true, bottom: true });
    expect(rules[8]).toMatchObject({ above: false, stdDev: 2 });
    expect(rules[9]).toMatchObject({ period: "lastWeek" });
  });

  it("counts a rule it cannot keep, and keeps the others in order of their priority", () => {
    const { workbook, warnings } = read(
      [
        block(`<x14:cfRule type="expression" priority="2" id="{2}"><xm:f>A1&gt;1</xm:f>${dxf}</x14:cfRule>`),
        block(`<x14:cfRule type="timeline" priority="1" id="{1}"/>`),
        block(`<x14:cfRule type="beginsWith" priority="3" operator="beginsWith" id="{3}">${dxf}</x14:cfRule>`),
      ].join(""),
    );
    expect(workbook.sheets[0]!.conditional).toHaveLength(1);
    expect(warnings.join(" ")).toContain("rules are of a kind Pli doesn't have yet");
  });
});

describe("merged cells and tables", () => {
  it("can't be merged inside a table, as in Excel", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Name", "Qty"], ["Pens", 4], ["Ink", 7]]);
    s.createTable("Sheet1", "A1:B3");
    expect(() => s.mergeCells("Sheet1", "A2:B2")).toThrow(/can't be merged/);
    expect(() => s.mergeCells("Sheet1", "B3:D3")).toThrow(/can't be merged/);
    s.mergeCells("Sheet1", "D1:E1");
    expect(s.merges("Sheet1")).toEqual(["D1:E1"]);
  });

  it("are left out of the file when they touch a table, and a single cell is never written", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Name", "Qty"], ["Pens", 4], ["Ink", 7]]);
    s.mergeCells("Sheet1", "A2:B2");
    s.mergeCells("Sheet1", "D1:E1");
    s.createTable("Sheet1", "A1:B3");
    expect(s.merges("Sheet1")).toEqual(["A2:B2", "D1:E1"]);
    const xml = sheetXml(s);
    expect(xml).toContain('<mergeCells count="1"><mergeCell ref="D1:E1"/></mergeCells>');
    expect(xml).not.toContain("A2:B2");
  });
});
