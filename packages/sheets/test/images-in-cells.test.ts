import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, fromCsv, isError, parseWorkbook, serializeWorkbook, toCsv, toXlsx } from "../src";
import { png, pngUri } from "./images-helpers";

const make = (sheets = ["Data"]) => new SheetSession(createWorkbook("cells", sheets));
const SRC = pngUri(40, 20);

describe("a picture placed in a cell", () => {
  it("is the cell's content: its value is the description, and it is saved with the workbook", () => {
    const s = make();
    s.setCell("Data", "B2", "old");
    s.setCellPicture("Data", "B2", { src: SRC, alt: "A red box" });
    expect(s.cell("Data", "B2")).toMatchObject({ v: "A red box", picture: { src: SRC, alt: "A red box" } });
    expect(s.value("Data", "B2")).toBe("A red box");
    expect(s.cellPicture("Data", "B2")).toEqual({ src: SRC, alt: "A red box", sizing: 0, formula: false });
    s.setCell("Data", "C2", '=LEN(B2)');
    expect(s.value("Data", "C2")).toBe(9);
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.cells["B2"]!.picture).toEqual({ src: SRC, alt: "A red box" });
    s.undo();
    s.undo();
    expect(s.cellPicture("Data", "B2")).toBeNull();
  });

  it("without a description has an empty value, and still counts as something being there", () => {
    const s = make();
    s.setCellPicture("Data", "A1", { src: SRC });
    expect(s.cell("Data", "A1")).toMatchObject({ v: "", picture: { src: SRC } });
    expect(s.calculator.usedBounds(s.sheet("Data").id)).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
  });

  it("keeps the cell's number format and look, and is replaced by typing, and not by clearing the format", () => {
    const s = make();
    s.setCell("Data", "A1", 5);
    s.setStyle("Data", "A1", { fill: "#ffff00" });
    s.setCellPicture("Data", "A1", { src: SRC, alt: "x" });
    expect(s.cell("Data", "A1")!.s).toEqual({ fill: "#ffff00" });
    s.clear("Data", "A1", "formats");
    expect(s.cell("Data", "A1")!.picture).toBeDefined();
    s.setCell("Data", "A1", "text");
    expect(s.cell("Data", "A1")!.picture).toBeUndefined();
    expect(s.cell("Data", "A1")!.v).toBe("text");
    s.setCellPicture("Data", "A1", { src: SRC });
    s.clear("Data", "A1", "contents");
    expect(s.cell("Data", "A1")?.picture).toBeUndefined();
  });

  it("is taken out with null, and the value it gave goes with it", () => {
    const s = make();
    s.setCellPicture("Data", "A1", { src: SRC, alt: "x" });
    s.setCellPicture("Data", "A1", null);
    expect(s.cell("Data", "A1")).toBeUndefined();
    expect(s.cellPicture("Data", "A1")).toBeNull();
  });

  it("refuses what isn't a picture, and a cell that has a formula as well", () => {
    const s = make();
    expect(() => s.setCellPicture("Data", "A1", { src: "https://pli.dev/x.png" })).toThrow(/data: URI/);
    expect(() => s.transact([{ type: "set_cells", sheet: s.sheet("Data").id, cells: { A1: { f: "1+1", picture: { src: SRC } } } }])).toThrow(/not both/);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].cells = { A1: { v: "", picture: { src: "nope" } } };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/picture/);
    bad.workbook.sheets[0].cells = { A1: { v: "", picture: { src: SRC, extra: 1 } } };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/extra/);
  });

  it("travels with the cell when it is copied, moved, sorted and its rows are inserted", () => {
    const s = make();
    s.setValues("Data", "A1", [["b"], ["a"]]);
    s.setCellPicture("Data", "A1", { src: SRC, alt: "b" });
    s.setCellPicture("Data", "A2", { src: pngUri(8, 8), alt: "a" });
    s.copy({ sheet: "Data", range: "A1" }, { sheet: "Data", at: "C1" });
    expect(s.cell("Data", "C1")!.picture!.src).toBe(SRC);
    s.insertRows("Data", 1, 2);
    expect(s.cell("Data", "A3")!.picture!.alt).toBe("b");
    s.move({ sheet: "Data", range: "A3" }, { sheet: "Data", at: "E3" });
    expect(s.cell("Data", "E3")!.picture!.alt).toBe("b");
    expect(s.cell("Data", "A3")?.picture).toBeUndefined();
    s.sort("Data", "A3:A4", { by: 1, header: false });
    expect(s.cell("Data", "A3")!.picture?.alt).toBe("a");
  });

  it("shows in a CSV as its description", () => {
    const s = make();
    s.setCellPicture("Data", "A1", { src: SRC, alt: "A red box" });
    expect(toCsv(s.calculator, "Data").trim()).toBe("A red box");
    expect(fromCsv("a").sheets).toHaveLength(1);
  });

  it("is turned into a floating picture the size of its cell, and back, in one undo step each", () => {
    const s = make();
    s.setColumnWidth("Data", 2, 20);
    s.setRowHeight("Data", 3, 30);
    s.setCellPicture("Data", "B3", { src: SRC, alt: "box" });
    const image = s.placeOverCells("Data", "B3");
    expect(image).toMatchObject({ from: { row: 3, col: 2 }, width: 145, height: 40, placement: "size", alt: "box" });
    expect(s.cell("Data", "B3")).toBeUndefined();
    s.setRowHeight("Data", 3, 60); // it sizes with its cell
    expect(s.images("Data")[0]!.height).toBe(80);
    s.placeInCell("Data", image.id);
    expect(s.images("Data")).toHaveLength(0);
    expect(s.cell("Data", "B3")!.picture).toEqual({ src: SRC, alt: "box" });
    s.undo();
    expect(s.images("Data")).toHaveLength(1);
    expect(s.cell("Data", "B3")).toBeUndefined();
    expect(() => s.placeOverCells("Data", "A1")).toThrow(/no picture/);
  });

  it("is placed from a picture at the cell given, which loses its crop and turn", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, from: { row: 5, col: 5 }, rotation: 30, crop: { left: 0.2 } });
    s.placeInCell("Data", p.id, "D4");
    expect(s.cell("Data", "D4")!.picture!.src).toBe(SRC);
    expect(s.cell("Data", "E5")).toBeUndefined();
  });

  it("is refused where the sheet is protected and the cell locked", () => {
    const s = make();
    s.protectSheet("Data");
    expect(() => s.setCellPicture("Data", "A1", { src: SRC })).toThrow(/locked/);
  });
});

describe("the IMAGE function", () => {
  const url = "https://example.com/logo.png";

  it("works out to the description, or the address when there is none, and the cell shows the picture", () => {
    const s = make();
    s.setCell("Data", "A1", `=IMAGE("${url}","Our logo")`);
    s.setCell("Data", "A2", `=IMAGE("${url}")`);
    expect(s.value("Data", "A1")).toBe("Our logo");
    expect(s.value("Data", "A2")).toBe(url);
    expect(s.cellPicture("Data", "A1")).toEqual({ src: url, alt: "Our logo", sizing: 0, formula: true });
    expect(s.cellPicture("Data", "A2")).toEqual({ src: url, sizing: 0, formula: true });
  });

  it("takes the address from another cell, and follows it when it changes", () => {
    const s = make();
    s.setCell("Data", "B1", url);
    s.setCell("Data", "A1", '=IMAGE(B1,"x",2)');
    expect(s.cellPicture("Data", "A1")).toMatchObject({ src: url, sizing: 2 });
    s.setCell("Data", "B1", "https://example.com/other.png");
    expect(s.cellPicture("Data", "A1")!.src).toBe("https://example.com/other.png");
    s.setCell("Data", "B1", "http://example.com/plain.png");
    expect(isError(s.value("Data", "A1"))).toBe(true);
    expect(s.cellPicture("Data", "A1")).toBeNull();
  });

  it("has sizes 0 to 3, and 3 needs a height and width", () => {
    const s = make();
    s.setCell("Data", "A1", `=IMAGE("${url}","a",3,40,80)`);
    expect(s.cellPicture("Data", "A1")).toMatchObject({ sizing: 3, height: 40, width: 80 });
    s.setCell("Data", "A2", `=IMAGE("${url}","a",3)`);
    expect(isError(s.value("Data", "A2"))).toBe(true);
    s.setCell("Data", "A3", `=IMAGE("${url}","a",5)`);
    expect(isError(s.value("Data", "A3"))).toBe(true);
    s.setCell("Data", "A4", `=IMAGE("${url}","a",3,0,10)`);
    expect(isError(s.value("Data", "A4"))).toBe(true);
    s.setCell("Data", "A5", `=IMAGE("${url}","a",1,40,80)`); // the size is for 3 only
    expect(s.cellPicture("Data", "A5")).toMatchObject({ sizing: 1 });
  });

  it("refuses an address that isn't https or a picture, so a formula can't point elsewhere", () => {
    const s = make();
    for (const bad of ["javascript:alert(1)", "http://example.com/a.png", "ftp://example.com/a.png", "file:///etc/passwd", "data:text/html;base64,PGI+", "example.com/a.png", "https://", "https:// spaced.png"]) {
      s.setCell("Data", "A1", `=IMAGE("${bad}")`);
      expect(isError(s.value("Data", "A1")), bad).toBe(true);
      expect(s.cellPicture("Data", "A1"), bad).toBeNull();
    }
  });

  it("takes a data: URI of a picture too", () => {
    const s = make();
    s.setCell("Data", "A1", `=IMAGE("${SRC}","tiny")`);
    expect(s.value("Data", "A1")).toBe("tiny");
    expect(s.cellPicture("Data", "A1")!.src).toBe(SRC);
    s.setCell("Data", "A2", `=IMAGE("${SRC}")`);
    expect(s.value("Data", "A2")).toBe("");
  });

  it("shows a picture only when the cell's value is what IMAGE gave", () => {
    const s = make();
    s.setCell("Data", "A1", `=LEN(IMAGE("${url}","abc"))`);
    expect(s.value("Data", "A1")).toBe(3);
    expect(s.cellPicture("Data", "A1")).toBeNull();
    s.setCell("Data", "A2", `=IF(TRUE,IMAGE("${url}","yes"),"no")`);
    expect(s.cellPicture("Data", "A2")).toMatchObject({ alt: "yes" });
    s.setCell("Data", "A3", `=IF(FALSE,IMAGE("${url}","yes"),"no")`);
    expect(s.cellPicture("Data", "A3")).toBeNull();
  });

  it("is written to an XLSX file as the formula, and read back as one", () => {
    const s = make();
    s.setCell("Data", "A1", `=IMAGE("${url}","Our logo",3,30,60)`);
    const files = unzipSync(toXlsx(s.state));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("_xlfn.IMAGE(");
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.cells["A1"]!.f).toBe(`IMAGE("${url}","Our logo",3,30,60)`);
  });
});

describe("pictures in cells in XLSX files", () => {
  it("are written as Excel's rich values, the cell holding #VALUE! and a vm number, and read back as the cell's content", () => {
    const s = make();
    s.setCellPicture("Data", "B2", { src: SRC, alt: "box" });
    s.setCellPicture("Data", "D4", { src: pngUri(10, 10) });
    s.setCellPicture("Data", "D5", { src: SRC }); // the same picture as B2: its file is kept once
    s.addImage("Data", { src: pngUri(30, 30), from: { row: 8, col: 1 }, width: 50, height: 50 }); // a floating one is not a cell's
    const files = unzipSync(toXlsx(s.state));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toMatch(/<c r="B2"[^>]* t="e" vm="1"><v>#VALUE!<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="D4"[^>]* t="e" vm="2">/);
    expect(sheet).toMatch(/<c r="D5"[^>]* t="e" vm="3">/);
    expect(strFromU8(files["xl/richData/rdrichvalue.xml"]!)).toContain('count="3"');
    expect(strFromU8(files["xl/richData/rdrichvalue.xml"]!)).toContain("<v>box</v>");
    expect(strFromU8(files["xl/richData/rdrichvaluestructure.xml"]!)).toContain('<k n="Text" t="s"/>');
    expect(strFromU8(files["xl/metadata.xml"]!)).toContain('<xlrd:rvb i="2"/>');
    expect(Object.keys(files).filter((k) => k.startsWith("xl/media/") && /image\d+\.png/.test(k)).length).toBe(3); // two pictures in cells and the floating one
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain("/xl/richData/rdrichvalue.xml");
    expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).toContain("rdRichValueStructure");
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const cells = workbook.sheets[0]!.cells;
    expect(cells["B2"]).toMatchObject({ v: "box", picture: { alt: "box" } });
    expect(cells["B2"]!.e).toBeUndefined();
    expect(cells["D4"]).toMatchObject({ v: "", picture: {} });
    expect(cells["D5"]!.picture!.src).toBe(SRC);
    expect(workbook.sheets[0]!.images).toHaveLength(1);
  });

  it("writes no rich value parts when no cell has a picture", () => {
    const s = make();
    s.setCell("Data", "A1", 1);
    const files = unzipSync(toXlsx(s.state));
    expect(Object.keys(files).some((k) => k.includes("richData") || k === "xl/metadata.xml")).toBe(false);
  });

  it("reads Excel's own pictures in cells (rich values) as the content of the cell", () => {
    const s = make();
    s.setValues("Data", "A1", [["x"], ["y"]]);
    const files = unzipSync(toXlsx(s.state));
    const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const bytes = png(12, 6, [10, 120, 10]);
    files["xl/media/image9.png"] = new Uint8Array(bytes);
    files["xl/metadata.xml"] = strToU8(
      `<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes>` +
        `<futureMetadata name="XLRICHVALUE" count="2"><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="0"/></ext></extLst></bk><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="1"/></ext></extLst></bk></futureMetadata>` +
        `<valueMetadata count="2"><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk></valueMetadata></metadata>`,
    );
    files["xl/richData/rdrichvalue.xml"] = strToU8(`<rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="2"><rv s="0"><v>0</v><v>5</v></rv><rv s="1"><v>0</v><v>5</v><v>A green box</v></rv></rvData>`);
    files["xl/richData/rdrichvaluestructure.xml"] = strToU8(
      `<rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="2"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/><k n="Text" t="s"/></s></rvStructures>`,
    );
    files["xl/richData/richValueRel.xml"] = strToU8(`<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="${R}"><rel r:id="rId1"/></richValueRels>`);
    files["xl/richData/_rels/richValueRel.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/image" Target="../media/image9.png"/></Relationships>`);
    const path = "xl/worksheets/sheet1.xml";
    files[path] = strToU8(
      strFromU8(files[path]!)
        .replace(/<c r="A1"[^>]*>.*?<\/c>/, '<c r="A1" t="e" vm="1"><v>#VALUE!</v></c>')
        .replace(/<c r="A2"[^>]*>.*?<\/c>/, '<c r="A2" t="e" vm="2"><v>#VALUE!</v></c>'),
    );
    const { workbook, warnings } = fromXlsx(zipSync(files));
    expect(warnings).toEqual([]);
    const cells = workbook.sheets[0]!.cells;
    expect(cells["A1"]).toMatchObject({ v: "", picture: {} });
    expect(cells["A1"]!.e).toBeUndefined();
    expect(cells["A2"]).toMatchObject({ v: "A green box", picture: { alt: "A green box" } });
    expect(cells["A2"]!.picture!.src.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("says when a picture in a cell couldn't be read, and keeps the rest", () => {
    const s = make();
    s.setValues("Data", "A1", [["x"]]);
    const files = unzipSync(toXlsx(s.state));
    files["xl/richData/rdrichvalue.xml"] = strToU8("<rvData/>");
    const path = "xl/worksheets/sheet1.xml";
    files[path] = strToU8(strFromU8(files[path]!).replace(/<c r="A1"[^>]*>.*?<\/c>/, '<c r="A1" t="e" vm="1"><v>#VALUE!</v></c>'));
    const { workbook, warnings } = fromXlsx(zipSync(files));
    expect(warnings.some((w) => /placed in cells/.test(w))).toBe(true);
    expect(workbook.sheets[0]!.cells["A1"]!.picture).toBeUndefined();
  });
});
