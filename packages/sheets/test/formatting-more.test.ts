import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, validateWorkbook, type ConditionalRule } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("More", ["Sheet1", "Limits"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [["Item", "Qty"], ["a", 5], ["b", -3], ["c", 12], ["d", 0]]);
  return s;
};
const parts = (data: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(data)).map(([k, v]) => [k, strFromU8(v)]));
const effect = (s: SheetSession, a: string) => s.conditionalEffect("Sheet1", a);
const strip = (r: ConditionalRule) => ({ ...r, id: "" });
const workbookOf = (sheet: string, extra: Record<string, string> = {}, styles = "") =>
  zipSync({
    "xl/workbook.xml": strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Limits" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="x"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/worksheets/sheet2.xml": strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>10</v></c></row></sheetData></worksheet>`),
    ...(styles ? { "xl/styles.xml": strToU8(styles) } : {}),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
  });

describe("diagonal borders", () => {
  it("crosses every cell of the range and touches nothing around it", () => {
    const s = make();
    s.setBorders("Sheet1", "A2:B3", "diagonalDown", { style: "thin", color: "#ff0000" });
    s.setBorders("Sheet1", "B3", "diagonalUp", { style: "dashed" });
    expect(s.cell("Sheet1", "A2")?.s?.border).toEqual({ diagonalDown: { style: "thin", color: "#ff0000" } });
    expect(s.cell("Sheet1", "B3")?.s?.border).toEqual({ diagonalDown: { style: "thin", color: "#ff0000" }, diagonalUp: { style: "dashed" } });
    expect(s.cell("Sheet1", "A4")?.s).toBeUndefined();
    s.setBorders("Sheet1", "A2:B3", "none", null);
    expect(s.cell("Sheet1", "B3")?.s).toBeUndefined();
    s.undo();
    expect(s.cell("Sheet1", "A2")?.s?.border?.diagonalDown).toBeDefined();
  });

  it("is kept in a saved workbook, and in a rule's style", () => {
    const s = make();
    s.setBorders("Sheet1", "A2", "diagonalUp");
    s.addRule("Sheet1", { kind: "cell", op: "lessThan", values: ["0"], ranges: ["B2:B5"], style: { border: { diagonalDown: { style: "medium", color: "#cc0000" } } } });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    expect(effect(s, "B3")?.style?.border).toEqual({ diagonalDown: { style: "medium", color: "#cc0000" } });
    const wb = JSON.parse(serializeWorkbook(s.state)).workbook;
    wb.sheets[0].cells.A2.s.border.diagonalUp.style = "wavy";
    expect(() => validateWorkbook(wb)).toThrow(/style/);
  });

  it("is written with the flags Excel reads, and read back", () => {
    const s = make();
    s.setBorders("Sheet1", "A2", "diagonalUp", { style: "thin", color: "#336699" });
    s.setBorders("Sheet1", "B2", "diagonalDown");
    s.setBorders("Sheet1", "A3", "diagonalUp");
    s.setBorders("Sheet1", "A3", "diagonalDown");
    const styles = parts(toXlsx(s.state))["xl/styles.xml"]!;
    expect(styles).toContain('<border diagonalUp="1"><left/><right/><top/><bottom/><diagonal style="thin"><color rgb="FF336699"/></diagonal></border>');
    expect(styles).toContain('<border diagonalDown="1">');
    expect(styles).toContain('<border diagonalUp="1" diagonalDown="1">');
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    expect(back.cells["A2"]!.s!.border).toEqual({ diagonalUp: { style: "thin", color: "#336699" } });
    expect(back.cells["B2"]!.s!.border).toEqual({ diagonalDown: { style: "thin" } });
    expect(back.cells["A3"]!.s!.border).toEqual({ diagonalUp: { style: "thin" }, diagonalDown: { style: "thin" } });
  });
});

describe("merge and centre", () => {
  it("merges and centres the top-left cell", () => {
    const s = make();
    s.mergeCells("Sheet1", "A1:B1", { center: true });
    expect(s.merges("Sheet1")).toEqual(["A1:B1"]);
    expect(s.cell("Sheet1", "A1")).toEqual({ v: "Item", s: { align: "center" } });
    s.undo();
    expect(s.cell("Sheet1", "A1")?.s).toBeUndefined();
  });

  it("centres each row's cell across a range, and a cell that is empty", () => {
    const s = make();
    s.mergeCells("Sheet1", "D1:E2", { across: true, center: true });
    expect(s.merges("Sheet1")).toEqual(["D1:E1", "D2:E2"]);
    expect(s.cell("Sheet1", "D2")).toEqual({ s: { align: "center" } });
  });
});

describe("number format and font in a rule's style", () => {
  it("styles the cell with a number format and font, and keeps the first rule's say", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "lessThan", values: ["0"], ranges: ["B2:B5"], style: { fmt: "[Red](0.0)", fontFamily: "Courier New", fontSize: 14, bold: true } });
    s.addRule("Sheet1", { kind: "cell", op: "lessThan", values: ["100"], ranges: ["B2:B5"], style: { fmt: "0.00", italic: true } });
    expect(effect(s, "B3")?.style).toEqual({ fmt: "[Red](0.0)", fontFamily: "Courier New", fontSize: 14, bold: true, italic: true });
    expect(effect(s, "B2")?.style).toEqual({ fmt: "0.00", italic: true });
  });

  it("refuses a font size or format that makes no sense", () => {
    const s = make();
    const add = (style: object) => () => s.addRule("Sheet1", { kind: "blanks", ranges: ["A1"], style } as never);
    expect(add({ fontSize: 0 })).toThrow(/font size/);
    expect(add({ fmt: 5 })).toThrow(/text/);
    expect(add({ fontFamily: 5 })).toThrow(/text/);
  });

  it("is written in the rule's dxf and read back, with Excel's own numbers for its own formats", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "lessThan", values: ["0"], ranges: ["B2:B5"], style: { fmt: "0.00%", fontFamily: "Courier New", fontSize: 12, color: "#cc0000" } });
    s.addRule("Sheet1", { kind: "cell", op: "equal", values: ["0"], ranges: ["B2:B5"], style: { fmt: "yy\"-\"mm", bold: true } });
    const styles = parts(toXlsx(s.state))["xl/styles.xml"]!;
    expect(styles).toContain('<dxf><font><sz val="12"/><color rgb="FFCC0000"/><name val="Courier New"/></font><numFmt numFmtId="10" formatCode="0.00%"/></dxf>');
    expect(styles).toContain('<numFmt numFmtId="201" formatCode="yy&quot;-&quot;mm"/>');
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.conditional!.map(strip)).toEqual(s.conditionalFormats("Sheet1").map(strip));
  });

  it("reads a number format that names only an id", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>0.5</v></c></row></sheetData><conditionalFormatting sqref="A1"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting></worksheet>`;
    const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dxfs count="1"><dxf><numFmt numFmtId="9"/></dxf></dxfs></styleSheet>`;
    const { workbook } = fromXlsx(workbookOf(sheet, {}, styles));
    expect((workbook.sheets[0]!.conditional![0] as { style: object }).style).toEqual({ fmt: "0%" });
  });

  it("shows the number the rule's way when copied", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["B2:B5"], style: { fmt: "0.00", fontSize: 16 } });
    const html = s.toHtml("Sheet1", "B2:B5");
    expect(html).toContain("12.00");
    expect(html).toContain("font-size:16pt");
  });
});

describe("data bars", () => {
  const bar = (s: SheetSession, extra: object = {}) => s.addRule("Sheet1", { kind: "dataBar", ranges: ["B2:B5"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6", ...extra } as never);

  it("colours negative bars, fills them solid, and draws a zero line", () => {
    const s = make();
    bar(s, { negativeColor: "#ff0000", solid: true, border: true, axisColor: "#333333" });
    expect(effect(s, "B4")?.bar).toEqual({ from: 0.2, to: 1, color: "#638ec6", axis: 0.2, axisColor: "#333333", solid: true, border: true });
    expect(effect(s, "B3")?.bar).toEqual({ from: 0, to: 0.2, color: "#ff0000", axis: 0.2, axisColor: "#333333", solid: true, border: true });
  });

  it("puts the zero line in the middle of the cell, or leaves it out", () => {
    const s = make();
    const r = bar(s, { axis: "middle" });
    expect(effect(s, "B4")?.bar).toEqual({ from: 0.5, to: 1, color: "#638ec6", axis: 0.5 });
    expect(effect(s, "B3")?.bar).toMatchObject({ from: 0.375, to: 0.5 }); // -3 on a scale of 12 either way
    s.updateRule("Sheet1", { ...r, axis: "none", negativeColor: "#ff0000" } as never);
    expect(effect(s, "B3")?.bar).toEqual({ from: 0, to: 0, color: "#ff0000" }); // the lowest value, on a scale from the lowest to the highest
    expect(effect(s, "B4")?.bar).toEqual({ from: 0, to: 1, color: "#638ec6" });
    expect(effect(s, "B5")?.bar).toEqual({ from: 0, to: 0.2, color: "#638ec6" });
  });

  it("makes the shortest and longest bars as long as asked", () => {
    const s = make();
    s.setValues("Sheet1", "D1", [[1], [3], [5]]);
    s.addRule("Sheet1", { kind: "dataBar", ranges: ["D1:D3"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6", minLength: 10, maxLength: 90 });
    expect(effect(s, "D1")?.bar).toEqual({ from: 0, to: 0.1, color: "#638ec6" });
    expect(effect(s, "D2")?.bar).toMatchObject({ to: 0.5 });
    expect(effect(s, "D3")?.bar).toEqual({ from: 0, to: 0.9, color: "#638ec6" });
  });

  it("refuses colours, axes and lengths that make no sense", () => {
    const s = make();
    expect(() => bar(s, { negativeColor: "red" })).toThrow(/negative colour/);
    expect(() => bar(s, { axis: "left" })).toThrow(/axis/);
    expect(() => bar(s, { minLength: 50, maxLength: 20 })).toThrow(/longest/);
    expect(() => bar(s, { maxLength: 120 })).toThrow(/percent/);
  });

  it("is written as the older form and the extension, and read back whole", () => {
    const s = make();
    bar(s, { negativeColor: "#ff0000", solid: true, border: true, axis: "middle", axisColor: "#333333", minLength: 5, maxLength: 95, hideValue: true });
    bar(s, { ranges: ["D1:D3"] }); // a plain one has no extension
    const sheet = parts(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<dataBar minLength="5" maxLength="95" showValue="0">');
    expect(sheet).toContain("<x14:id>{B0000000-0000-4000-8000-000000000001}</x14:id>");
    expect(sheet).toContain('<x14:dataBar minLength="5" maxLength="95" gradient="0" border="1" negativeBarColorSameAsPositive="0" axisPosition="middle">');
    expect(sheet).toContain('<x14:negativeFillColor rgb="FFFF0000"/>');
    expect(sheet).toContain('<x14:axisColor rgb="FF333333"/>');
    expect(sheet.match(/<x14:cfRule/g)).toHaveLength(2); // (the plain bar of the test has the extension too)
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.conditional!.map(strip)).toEqual(s.conditionalFormats("Sheet1").map(strip));
  });

  it("reads a data bar as Excel 2010 writes it", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><sheetData><row r="1"><c r="A1"><v>-2</v></c></row></sheetData>
      <conditionalFormatting sqref="A1:A9"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}"><x14:id>{AAAA}</x14:id></ext></extLst></cfRule></conditionalFormatting>
      <extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{AAAA}"><x14:dataBar minLength="0" maxLength="100" gradient="0" negativeBarColorSameAsPositive="0" axisPosition="middle"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:negativeFillColor rgb="FFFF0000"/><x14:axisColor rgb="FF000000"/></x14:dataBar></x14:cfRule><xm:sqref>A1:A9</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst></worksheet>`;
    const { workbook, warnings } = fromXlsx(workbookOf(sheet));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.conditional).toHaveLength(1);
    expect(workbook.sheets[0]!.conditional![0]).toMatchObject({ kind: "dataBar", color: "#638ec6", solid: true, axis: "middle", negativeColor: "#ff0000", axisColor: "#000000", min: { type: "auto" }, max: { type: "auto" } });
    expect((workbook.sheets[0]!.conditional![0] as { minLength?: number }).minLength).toBeUndefined(); // 0 and 100 are the defaults
  });
});

describe("icon sets", () => {
  const icons = (s: SheetSession, extra: object = {}) => s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["B2:B5"], thresholds: [{ type: "num", value: 0 }, { type: "num", value: 10 }], ...extra } as never);

  it("shows the icons you choose for each step, from any set, or none", () => {
    const s = make();
    icons(s, { custom: [{ set: "3Flags", index: 0 }, null, { set: "5Rating", index: 4 }] });
    expect(effect(s, "B3")?.icon).toEqual({ set: "3Flags", index: 0, count: 3 }); // -3
    expect(effect(s, "B2")?.icon).toBeUndefined(); // 5: the middle step has no icon
    expect(effect(s, "B4")?.icon).toEqual({ set: "5Rating", index: 4, count: 5 });
  });

  it("takes the custom icons in the order reversed, too", () => {
    const s = make();
    icons(s, { reverse: true, custom: [{ set: "3Flags", index: 0 }, { set: "3Flags", index: 1 }, { set: "3Flags", index: 2 }] });
    expect(effect(s, "B3")?.icon).toEqual({ set: "3Flags", index: 2, count: 3 });
  });

  it("has Excel 2010's stars, triangles and boxes", () => {
    const s = make();
    icons(s, { set: "3Stars" });
    icons(s, { set: "5Boxes", ranges: ["D1:D5"], thresholds: [{ type: "num", value: 1 }, { type: "num", value: 2 }, { type: "num", value: 3 }, { type: "num", value: 4 }] });
    expect(effect(s, "B4")?.icon).toEqual({ set: "3Stars", index: 2, count: 3 });
    s.setCell("Sheet1", "D2", 3);
    expect(effect(s, "D2")?.icon).toEqual({ set: "5Boxes", index: 3, count: 5 });
  });

  it("refuses custom icons that don't fit", () => {
    const s = make();
    expect(() => icons(s, { custom: [null] })).toThrow(/one choice for each/);
    expect(() => icons(s, { custom: [null, null, { set: "3Arrows", index: 5 }] })).toThrow(/icon 3/i);
    expect(() => icons(s, { custom: [null, null, { set: "nope", index: 0 }] })).toThrow(/icon 3/i);
  });

  it("goes through XLSX: the new sets and your own icons in the extension", () => {
    const s = make();
    icons(s, { set: "3Triangles" });
    icons(s, { custom: [{ set: "3Flags", index: 0 }, null, { set: "5Rating", index: 4 }], reverse: true, hideValue: true });
    const sheet = parts(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<x14:iconSet iconSet="3Triangles">');
    expect(sheet).toContain('<x14:iconSet iconSet="3Arrows" custom="1" showValue="0" reverse="1">');
    expect(sheet).toContain('<x14:cfIcon iconSet="3Flags" iconId="0"/><x14:cfIcon iconSet="NoIcons" iconId="0"/><x14:cfIcon iconSet="5Rating" iconId="4"/>');
    // Both are in the extension only: Excel kept a plain rule and an extension rule for icons of your own as two rules (kit file 33).
    expect(sheet.match(/<conditionalFormatting /g)).toBeNull();
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.conditional!.map(strip)).toEqual(s.conditionalFormats("Sheet1").map(strip));
  });
});

describe("rules kept in Excel 2010's extension", () => {
  it("writes a rule that points at another sheet there, and reads it back", () => {
    const s = make();
    s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["Limits!$A$1"], ranges: ["B2:B5"], style: { fill: "#ffc7ce", bold: true } });
    s.addRule("Sheet1", { kind: "formula", formula: "B2>Limits!$A$1*2", ranges: ["B2:B5"], style: { color: "#cc0000" }, stop: true });
    s.addRule("Sheet1", { kind: "blanks", ranges: ["C1:C5"], style: { fill: "#eeeeee" } });
    const sheet = parts(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!;
    expect(sheet.match(/<conditionalFormatting /g)).toHaveLength(1); // only the plain one is in the older form
    expect(sheet).toContain('priority="3"');
    expect(sheet).toContain('<x14:cfRule type="cellIs" priority="1" operator="greaterThan" id="{B0000000-0000-4000-8000-000000000001}"><xm:f>Limits!$A$1</xm:f><x14:dxf><font><b/></font><fill>');
    expect(sheet).toContain('<x14:cfRule type="expression" priority="2" stopIfTrue="1"');
    expect(sheet).toContain("<xm:sqref>B2:B5</xm:sqref>");
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.conditional!.map(strip)).toEqual(s.conditionalFormats("Sheet1").map(strip)); // the order by priority is kept
    const t = new SheetSession(workbook);
    t.setCell("Limits", "A1", 10);
    t.setCell("Sheet1", "B4", 50);
    expect(t.conditionalEffect("Sheet1", "B4")?.style?.fill).toBe("#ffc7ce");
    expect(t.conditionalEffect("Sheet1", "B2")).toBeUndefined();
  });

  it("reads a file made by Excel 2010 that has only the extension", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><sheetData><row r="1"><c r="A1"><v>20</v></c></row></sheetData>
      <extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings>
        <x14:conditionalFormatting><x14:cfRule type="expression" priority="2" id="{1}"><xm:f>A1&gt;Limits!$A$1</xm:f><x14:dxf><font><i/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></x14:dxf></x14:cfRule><xm:sqref>A1:A9</xm:sqref></x14:conditionalFormatting>
        <x14:conditionalFormatting><x14:cfRule type="cellIs" priority="1" operator="between" id="{2}"><xm:f>Limits!$A$1</xm:f><xm:f>100</xm:f><x14:dxf><font><b/></font></x14:dxf></x14:cfRule><xm:sqref>B1:B9</xm:sqref></x14:conditionalFormatting>
        <x14:conditionalFormatting><x14:cfRule type="iconSet" priority="3" id="{3}"><x14:iconSet iconSet="3Stars" custom="1" reverse="1"><x14:cfvo type="percent"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>33</xm:f></x14:cfvo><x14:cfvo type="formula"><xm:f>Limits!$A$1</xm:f></x14:cfvo><x14:cfIcon iconSet="3Arrows" iconId="2"/><x14:cfIcon iconSet="NoIcons" iconId="0"/><x14:cfIcon iconSet="3Stars" iconId="2"/></x14:iconSet></x14:cfRule><xm:sqref>C1:C9</xm:sqref></x14:conditionalFormatting>
        <x14:conditionalFormatting><x14:cfRule type="timeline" priority="4" id="{4}"/><xm:sqref>D1</xm:sqref></x14:conditionalFormatting>
      </x14:conditionalFormattings></ext></extLst></worksheet>`;
    const { workbook, warnings } = fromXlsx(workbookOf(sheet));
    const rules = workbook.sheets[0]!.conditional!;
    expect(rules.map((r) => r.kind)).toEqual(["cell", "formula", "iconSet"]); // by priority
    expect(rules[0]).toMatchObject({ op: "between", values: ["Limits!$A$1", "100"], ranges: ["B1:B9"], style: { bold: true } });
    expect(rules[1]).toMatchObject({ formula: "A1>Limits!$A$1", ranges: ["A1:A9"], style: { italic: true, color: "#9c0006", fill: "#ffc7ce" } });
    expect(rules[2]).toMatchObject({ set: "3Stars", reverse: true, thresholds: [{ type: "percent", value: 33 }, { type: "formula", value: "Limits!$A$1" }], custom: [{ set: "3Arrows", index: 2 }, null, { set: "3Stars", index: 2 }] });
    expect(warnings.join("\n")).toMatch(/conditional formatting rules are of a kind/); // the one it can't read is named
    const s = new SheetSession(workbook);
    expect(s.conditionalEffect("Data", "A1")?.style?.fill).toBe("#ffc7ce"); // 20 is over the 10 in Limits
  });
});
