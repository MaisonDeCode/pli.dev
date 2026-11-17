import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

const NOW = 45000.5;

describe("XLSX", () => {
  it("writes a file that reads back the same", () => {
    const s = new SheetSession(createWorkbook("Budget"), { now: () => NOW });
    s.setCells("Sheet1", { A1: "Item", B1: "Cost", A2: "Pens", B2: 12.5, A3: "Paper", B3: 8, A4: "Total", B4: "=SUM(B2:B3)", C1: "'  padded", D1: "=XLOOKUP(\"Pens\",A2:A3,B2:B3)", E1: true, F1: "#N/A", G1: "3/5/2024" });
    s.setFormat("Sheet1", "B2:B4", "$#,##0.00");
    s.setStyle("Sheet1", "A1:B1", { bold: true, fill: "#ddeeff", color: "#aa0000", align: "center" });
    s.setColumnWidth("Sheet1", 1, 18);
    s.setRowHeight("Sheet1", 1, 24);
    s.setFrozen("Sheet1", 1, 0);
    s.addSheet("Notes");
    s.setCell("Notes", "A1", "='Sheet1'!B4*2");
    s.defineName("Total", "Sheet1!$B$4");

    const { workbook, warnings } = fromXlsx(toXlsx(s.state, { now: () => NOW }));
    expect(warnings).toEqual([]);
    const t = new SheetSession(workbook, { now: () => NOW });
    expect(t.state.sheets.map((x) => x.name)).toEqual(["Sheet1", "Notes"]);
    for (const a of ["A1", "B2", "B4", "C1", "D1", "E1", "F1", "G1"]) {
      expect(t.cell("Sheet1", a), a).toEqual(s.cell("Sheet1", a));
    }
    expect(t.value("Sheet1", "B4")).toBe(20.5);
    expect(t.value("Sheet1", "D1")).toBe(12.5);
    expect(t.value("Notes", "A1")).toBe(41);
    expect(t.display("Sheet1", "B4").text).toBe("$20.50");
    expect(t.state.sheets[0]).toMatchObject({ columns: { A: { size: 18 } }, rows: { "1": { size: 24 } }, frozen: { rows: 1, cols: 0 } });
    expect(t.state.names).toEqual({ Total: "Sheet1!$B$4" });
  });

  it("writes cached values so viewers that don't recalculate show them", () => {
    const s = new SheetSession(createWorkbook(), { now: () => NOW });
    s.setCells("Sheet1", { A1: 2, B1: "=A1*A1", C1: '="x"&A1', D1: "=1>0", E1: "=1/0" });
    const files = (zipSyncRead(toXlsx(s.state)));
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain("<f>A1*A1</f><v>4</v>");
    expect(sheet).toContain('t="str"><f>"x"&amp;A1</f><v>x2</v>');
    expect(sheet).toContain('t="b"><f>1&gt;0</f><v>1</v>');
    expect(sheet).toContain('t="e"><f>1/0</f><v>#DIV/0!</v>');
    expect(files["xl/workbook.xml"]).toContain('fullCalcOnLoad="1"');
  });

  it("prefixes newer functions the way Excel wants", () => {
    const s = new SheetSession(createWorkbook());
    s.setCells("Sheet1", { A1: 1, B1: "=IFS(A1=1,\"a\")", C1: "=STDEV.S(A1:A2)", D1: "=SUM(A1)" });
    const sheet = zipSyncRead(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain("_xlfn.IFS(");
    expect(sheet).toContain("_xlfn.STDEV.S(");
    expect(sheet).toContain("<f>SUM(A1)</f>");
    const back = fromXlsx(toXlsx(s.state)).workbook;
    expect(back.sheets[0]!.cells["B1"]!.f).toBe('IFS(A1=1,"a")');
  });

  it("reads a file made by Excel: shared strings, shared formulas, styles, 1904 dates, hidden columns", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetViews><sheetView><pane xSplit="1" ySplit="2" state="frozen"/></sheetView></sheetViews>
      <cols><col min="2" max="3" width="14.5" customWidth="1"/><col min="5" max="5" width="9" hidden="1"/></cols>
      <sheetData>
        <row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1" s="2"><v>0.256</v></c><c r="C1" t="b"><v>1</v></c><c r="D1" t="e"><v>#DIV/0!</v></c></row>
        <row r="2" ht="30" customHeight="1"><c r="A2" t="inlineStr"><is><t>inline</t></is></c><c r="B2"><f t="shared" ref="B2:B4" si="0">A1+1</f><v>1</v></c></row>
        <row r="3"><c r="B3"><f t="shared" si="0"/><v>1</v></c><c r="C3"><f>FUTUREFN(A1)</f><v>1</v></c></row>
        <row r="4"><c r="B4"><f t="shared" si="0"/><v>1</v></c><c r="E4"><v>100</v></c><c r="F4" s="3"><v>0</v></c></row>
      </sheetData>
      <mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
      <drawing r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
    </worksheet>`;
    const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
      <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFFF0000"/><name val="Calibri"/></font></fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>
      <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="2"><alignment horizontal="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0"/><xf numFmtId="14" fontId="0" fillId="0"/></cellXfs>
    </styleSheet>`;
    const book = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <workbookPr date1904="1"/><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
      <definedNames><definedName name="Rate">Data!$B$1</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">Data!$A$1:$B$4</definedName></definedNames></workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`;
    const sst = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>Hello </t></r><r><t>world</t></r></si></sst>`;
    const file = zipSync({
      "xl/workbook.xml": strToU8(book), "xl/_rels/workbook.xml.rels": strToU8(rels), "xl/worksheets/sheet1.xml": strToU8(sheet),
      "xl/styles.xml": strToU8(styles), "xl/sharedStrings.xml": strToU8(sst),
    });
    const { workbook, warnings } = fromXlsx(file);
    const s = new SheetSession(workbook);
    expect(s.cell("Data", "A1")).toEqual({ v: "Hello world", s: { bold: true, fontSize: 14, color: "#ff0000", fill: "#ffff00", align: "center", wrap: true } });
    expect(s.cell("Data", "B1")).toEqual({ v: 0.256, fmt: "0.0%" });
    expect(s.cell("Data", "C1")).toEqual({ v: true });
    expect(s.cell("Data", "D1")).toEqual({ e: "#DIV/0!" });
    expect(s.cell("Data", "A2")).toEqual({ v: "inline" });
    expect(s.cell("Data", "B3")?.f).toBe("A2+1"); // shared formula shifted from B2
    expect(s.cell("Data", "B4")?.f).toBe("A3+1");
    expect(s.cell("Data", "E4")).toEqual({ v: 100 });
    expect(s.cell("Data", "F4")).toEqual({ v: 1462, fmt: "m/d/yyyy" }); // 1904 date system: only dates are moved
    expect(s.state.sheets[0]).toMatchObject({ frozen: { rows: 2, cols: 1 }, columns: { B: { size: 14.5 }, C: { size: 14.5 }, E: { size: 9, hidden: true } }, rows: { "2": { size: 30 } } });
    expect(s.state.names).toEqual({ Rate: "Data!$B$1" });
    expect(s.state.sheets[0]!.merges).toEqual(["A1:B1"]);
    expect(warnings.join("\n")).not.toMatch(/Merged/);
    expect(warnings.join("\n")).toMatch(/Shapes and text boxes/);
    expect(warnings.join("\n")).toMatch(/FUTUREFN/);
  });

  it("refuses what isn't an XLSX file", () => {
    expect(() => fromXlsx(new Uint8Array([1, 2, 3]))).toThrow(/Not an XLSX/);
    expect(() => fromXlsx(zipSync({ "a.txt": strToU8("x") }))).toThrow(/no workbook/);
  });
});

import { unzipSync, strFromU8 } from "fflate";
function zipSyncRead(data: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(data)).map(([k, v]) => [k, strFromU8(v)]));
}
