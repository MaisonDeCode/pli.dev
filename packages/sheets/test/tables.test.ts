import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseFormula, parseWorkbook, parseTableStyle, printFormula, serializeWorkbook, tableLook, validateWorkbook } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Tables", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [
    ["Item", "Qty", "Price", "Total"],
    ["Pens", 10, 1.5, "=[@Qty]*[@Price]"],
    ["Paper", 4, 8, "=[@Qty]*[@Price]"],
    ["Ink", 2, 20, "=[@Qty]*[@Price]"],
  ]);
  return s;
};

describe("structured references", () => {
  const round = (f: string) => printFormula(parseFormula(f));

  it("reads and writes every form", () => {
    for (const f of [
      "Sales[Amount]",
      "Sales[Unit Price]",
      "Sales[[Qty]:[Price]]",
      "Sales[#All]",
      "Sales[#Headers]",
      "Sales[#Totals]",
      "Sales[[#Headers],[Qty]]",
      "Sales[[#All],[Qty]:[Price]]",
      "[@Qty]",
      "[@[Unit Price]]",
      "Sales[@Qty]",
      "Sales[@[Qty]:[Price]]",
      "Sales",
      "SUM(Sales[Qty])*2",
      "Sales['[Odd']'#]",
    ]) expect(round(f), f).toBe(f);
    expect(round("Sales[[#This Row],[Qty]]")).toBe("Sales[@Qty]");
    expect(round("Sales[#Data]")).toBe("Sales");
    expect(round("Sales[[#Data],[Qty]]")).toBe("Sales[Qty]");
    expect(round("[Qty]")).toBe("[Qty]");
    expect(parseFormula("Sales[[#Headers],[Unit Price]]")).toEqual({ t: "tref", table: "Sales", area: "headers", from: "Unit Price" });
    expect(() => parseFormula("Sales[[#Bogus],[Qty]]")).toThrow(/Unknown table part/);
    expect(() => parseFormula("Sales[Qty")).toThrow(/isn't closed/);
  });
});

describe("tables", () => {
  it("makes a table whose column names are the header cells", () => {
    const s = make();
    const t = s.createTable("Sheet1", "A1:D4");
    expect(t).toMatchObject({ name: "Table1", range: "A1:D4" });
    expect(s.tableAt("Sheet1", "B3")?.id).toBe(t.id);
    expect(s.tableAt("Sheet1", "F9")).toBeUndefined();
    s.setCell("Sheet1", "F1", "=SUM(Table1[Qty])");
    s.setCell("Sheet1", "F2", "=SUM(Table1[[Qty]:[Price]])");
    s.setCell("Sheet1", "F3", "=Table1[[#Headers],[Item]]");
    s.setCell("Sheet1", "F4", "=ROWS(Table1)");
    s.setCell("Sheet1", "F5", "=COLUMNS(Table1[#All])");
    expect(s.value("Sheet1", "F1")).toBe(16);
    expect(s.value("Sheet1", "F2")).toBe(16 + 29.5);
    expect(s.value("Sheet1", "F3")).toBe("Item");
    expect(s.value("Sheet1", "F4")).toBe(3);
    expect(s.value("Sheet1", "F5")).toBe(4);
  });

  it("can put a header row above data that has none", () => {
    const s = new SheetSession(createWorkbook());
    s.setValues("Sheet1", "A1", [[1, 2], [3, 4]]);
    s.setCell("Sheet1", "D1", "keep");
    s.createTable("Sheet1", "A1:B2", { header: false });
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:B3");
    expect([s.value("Sheet1", "A1"), s.value("Sheet1", "B1"), s.value("Sheet1", "A2"), s.value("Sheet1", "B3")]).toEqual(["Column1", "Column2", 1, 4]);
    s.setCell("Sheet1", "F1", "=SUM(Table1[Column2])");
    expect(s.value("Sheet1", "F1")).toBe(6);
    s.undo(); // the formula
    s.undo(); // the whole table, with its header row, in one step
    expect(s.tables("Sheet1")).toEqual([]);
    expect(s.value("Sheet1", "A1")).toBe(1);
  });

  it("evaluates this-row references inside the table, and refuses them outside", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    expect(s.value("Sheet1", "D2")).toBe(15);
    expect(s.value("Sheet1", "D4")).toBe(40);
    s.setCell("Sheet1", "B2", 20);
    expect(s.value("Sheet1", "D2")).toBe(30);
    s.setCell("Sheet1", "F1", "=Table1[@Qty]");
    expect(s.display("Sheet1", "F1").text).toBe("#VALUE!");
    s.setCell("Sheet1", "F2", "=Table1[Nope]");
    expect(s.display("Sheet1", "F2").text).toBe("#REF!");
    s.setCell("Sheet1", "F3", "=Table1[#Totals]");
    expect(s.display("Sheet1", "F3").text).toBe("#REF!");
  });

  it("works across sheets and follows moved cells", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4", { name: "Orders" });
    s.setCell("Other", "A1", "=SUMIF(Orders[Item],\"Ink\",Orders[Total])");
    expect(s.value("Other", "A1")).toBe(40);
    s.insertRows("Sheet1", 1, 2);
    expect(s.tables("Sheet1")[0]!.range).toBe("A3:D6");
    expect(s.value("Other", "A1")).toBe(40);
    s.insertColumns("Sheet1", 2);
    expect(s.tables("Sheet1")[0]!.range).toBe("A3:E6");
    expect(s.value("Sheet1", "B3")).toBe("Column2"); // the new column is named
    expect(s.value("Other", "A1")).toBe(40);
    s.deleteColumns("Sheet1", 2);
    expect(s.tables("Sheet1")[0]!.range).toBe("A3:D6");
  });

  it("grows over the row typed under it and the column typed beside it", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.setCell("Sheet1", "F1", "=SUM(Table1[Qty])");
    s.setCell("Sheet1", "A5", "Pencils");
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D5");
    s.setCell("Sheet1", "B5", 100);
    expect(s.value("Sheet1", "F1")).toBe(116);
    s.setCell("Sheet1", "E1", "Notes");
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:E5");
    s.setCell("Sheet1", "A7", "far below");
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:E5");
    s.undo();
    s.undo();
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D5"); // growing is part of the edit that made it
  });

  it("grows over several pasted rows, and not into another table", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.setValues("Sheet1", "A8", [["x", 1, 1, 1]]);
    s.createTable("Sheet1", "A8:D9", { name: "Second" });
    s.setValues("Sheet1", "A5", [["a", 1, 1, 1], ["b", 2, 2, 2]]);
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D6");
    s.setCell("Sheet1", "A7", "c");
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D7"); // up to the next table, which it stops at
    s.setCell("Sheet1", "A8", "d");
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D7");
  });

  it("renames a column with its header cell, and formulas follow", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.setCell("Sheet1", "F1", "=SUM(Table1[Qty])");
    s.setCell("Sheet1", "B1", "Units");
    expect(s.cell("Sheet1", "F1")?.f).toBe("SUM(Table1[Units])");
    expect(s.cell("Sheet1", "D2")?.f).toBe("[@Units]*[@Price]");
    expect(s.value("Sheet1", "D2")).toBe(15);
    s.undo();
    expect(s.cell("Sheet1", "F1")?.f).toBe("SUM(Table1[Qty])");
    expect(() => s.setCell("Sheet1", "B1", "price")).toThrow(/different/);
    expect(() => s.setCell("Sheet1", "B1", null)).toThrow(/needs a name/);
    expect(() => s.setCell("Sheet1", "B1", "=1+1")).toThrow(/formula/);
    s.setCell("Sheet1", "B1", 2024);
    expect(s.cell("Sheet1", "B1")?.v).toBe("2024");
  });

  it("renames a table, and formulas follow", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.defineName("Everything", "Table1[#All]");
    s.setCell("Other", "A1", "=SUM(Table1[Qty])+ROWS(Table1)");
    s.renameTable("Table1", "Orders");
    expect(s.cell("Other", "A1")?.f).toBe("SUM(Orders[Qty])+ROWS(Orders)");
    expect(s.state.names!["Everything"]).toBe("Orders[#All]");
    expect(s.value("Other", "A1")).toBe(19);
    expect(() => s.renameTable("Orders", "A1")).toThrow(/can't be used/);
    expect(() => s.renameTable("Orders", "Everything")).toThrow(/defined name/);
    s.undo();
    expect(s.tables("Sheet1")[0]!.name).toBe("Table1");
  });

  it("names columns that are empty or repeated", () => {
    const s = new SheetSession(createWorkbook());
    s.setValues("Sheet1", "A1", [["Name", "", "Name", 5], ["a", "b", "c", "d"]]);
    s.createTable("Sheet1", "A1:D2");
    expect([1, 2, 3, 4].map((c) => s.value("Sheet1", ["A1", "B1", "C1", "D1"][c - 1]!))).toEqual(["Name", "Column2", "Name2", "5"]);
  });

  it("adds and removes a totals row", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.setCell("Sheet1", "A8", "below");
    s.setTableTotals("Table1", true);
    expect(s.tables("Sheet1")[0]).toMatchObject({ range: "A1:D5", totals: true });
    expect(s.value("Sheet1", "A5")).toBe("Total");
    expect(s.value("Sheet1", "D5")).toBe(15 + 32 + 40);
    expect(s.cell("Sheet1", "D5")?.f).toBe("SUBTOTAL(109,Table1[Total])");
    expect(s.value("Sheet1", "A9")).toBe("below"); // the cells under moved down
    s.setCell("Sheet1", "F1", "=SUM(Table1[Qty])");
    expect(s.value("Sheet1", "F1")).toBe(16); // the totals row isn't data
    s.setCell("Sheet1", "F2", "=Table1[[#Totals],[Total]]");
    expect(s.value("Sheet1", "F2")).toBe(87);
    s.setTableTotals("Table1", false);
    expect(s.tables("Sheet1")[0]!.totals).toBeUndefined();
    expect(s.value("Sheet1", "A8")).toBe("below");
    s.undo();
    expect(s.tables("Sheet1")[0]!.totals).toBe(true);
  });

  it("can stop being a table, keeping the cells and turning references into ranges", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.setCell("Other", "A1", "=SUM(Table1[Qty])");
    s.convertToRange("Table1");
    expect(s.tables("Sheet1")).toEqual([]);
    expect(s.cell("Other", "A1")?.f).toBe("SUM(Sheet1!$B$2:$B$4)");
    expect(s.cell("Sheet1", "D2")?.f).toBe("$B2*$C2");
    expect(s.value("Other", "A1")).toBe(16);
    s.undo();
    expect(s.tables("Sheet1")).toHaveLength(1);
  });

  it("can be deleted with its cells", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.setCell("Other", "A1", "=SUM(Table1[Qty])");
    s.deleteTable("Table1");
    expect(s.tables("Sheet1")).toEqual([]);
    expect(s.usedRange("Sheet1")).toBeNull();
    expect(s.display("Other", "A1").text).toBe("#REF!");
  });

  it("loses its header with a deleted row, and keeps a row of data", () => {
    const s = make();
    s.createTable("Sheet1", "A2:D4");
    s.deleteRows("Sheet1", 3, 2);
    expect(s.tables("Sheet1")[0]!.range).toBe("A2:D3");
    s.deleteRows("Sheet1", 2);
    expect(s.tables("Sheet1")).toEqual([]);
  });

  it("refuses names, ranges and headers that make no sense", () => {
    const s = make();
    const add = (table: object) => () => s.transact([{ type: "add_table", sheet: s.sheet("Sheet1").id, table: { id: "t", name: "T", range: "A1:D4", ...table } as never }]);
    expect(add({ name: "has space" })).toThrow(/can't be used/);
    expect(add({ name: "A1" })).toThrow(/can't be used/);
    expect(add({ range: "A1:D1" })).toThrow(/header row and at least one row/);
    expect(add({ range: "A1:D4", totals: true, id: "u" })).not.toThrow();
    s.undo();
    s.createTable("Sheet1", "A1:D4");
    expect(add({ name: "table1", range: "F1:G3", id: "x" })).toThrow(/already a table/);
    expect(add({ range: "C2:E4", id: "y" })).toThrow(/overlaps/);
    expect(add({ range: "F1:G3", id: "z" })).toThrow(/needs a name/); // empty header cells
    s.defineName("Rate", "1");
    expect(() => s.defineName("Table1", "1")).toThrow(/already a table/);
    expect(add({ name: "Rate", range: "A1:D4", id: "r" })).toThrow();
  });

  it("is kept in a saved workbook and checked when read", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4", { style: "TableStyleLight9" });
    s.setTableOptions("Table1", { bandedRows: false, firstColumn: true });
    expect(s.tables("Sheet1")[0]).toMatchObject({ style: "TableStyleLight9", bandedRows: false, firstColumn: true });
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const wb = JSON.parse(serializeWorkbook(s.state)).workbook;
    wb.sheets[0].tables[0].range = "A1:D1";
    expect(() => validateWorkbook(wb)).toThrow(/header row/);
    wb.sheets[0].tables[0].range = "A1:D4";
    wb.sheets[0].tables[0].colour = "red";
    expect(() => validateWorkbook(wb)).toThrow(/unknown field/);
  });
});

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fromXlsx, toXlsx } from "../src";

describe("tables in XLSX files", () => {
  it("writes the table part where Excel looks for it, with formulas as a file spells them", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4", { name: "Orders" });
    s.setTableTotals("Orders", true);
    s.setCell("Other", "A1", "=SUM(Orders[Qty])");
    const files = Object.fromEntries(Object.entries(unzipSync(toXlsx(s.state))).map(([k, v]) => [k, strFromU8(v)]));
    const part = files["xl/tables/table1.xml"]!;
    expect(part).toContain('name="Orders" displayName="Orders" ref="A1:D5" totalsRowCount="1"');
    expect(part).toContain('<autoFilter ref="A1:D4"/>');
    expect(part).toContain('<tableColumn id="1" name="Item" totalsRowLabel="Total"/>');
    expect(part).toContain('<tableColumn id="4" name="Total" totalsRowFunction="sum"/>');
    expect(part).toContain('<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>');
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain("<f>Orders[[#This Row],[Qty]]*Orders[[#This Row],[Price]]</f>");
    expect(sheet).toContain("<f>SUBTOTAL(109,Orders[Total])</f>");
    expect(sheet).toContain('<tableParts count="1"><tablePart r:id="rId1"/></tableParts>');
    expect(files["xl/worksheets/_rels/sheet1.xml.rels"]).toContain('Target="../tables/table1.xml"');
    expect(files["[Content_Types].xml"]).toContain("/xl/tables/table1.xml");
    expect(files["xl/worksheets/sheet2.xml"]).toContain("<f>SUM(Orders[Qty])</f>");
  });

  it("reads back what it wrote", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4", { name: "Orders", style: "TableStyleLight9" });
    s.setTableOptions("Orders", { bandedRows: false, bandedColumns: true, firstColumn: true, lastColumn: true });
    s.setTableTotals("Orders", true);
    s.addSheet("Third");
    s.setValues("Third", "A1", [["A", "B"], [1, 2]]);
    s.createTable("Third", "A1:B2", { style: "none" });
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const strip = (t: object) => ({ ...t, id: "" });
    expect(workbook.sheets[0]!.tables!.map(strip)).toEqual(s.tables("Sheet1").map(strip));
    expect(workbook.sheets[2]!.tables!.map(strip)).toEqual(s.tables("Third").map(strip));
    const t = new SheetSession(workbook);
    expect(t.value("Sheet1", "D2")).toBe(15);
    expect(t.cell("Sheet1", "D2")?.f).toBe("Orders[@Qty]*Orders[@Price]");
    expect(t.value("Sheet1", "D5")).toBe(87);
  });

  it("reads a table made by Excel, and leaves one that isn't sound as plain cells", () => {
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Unit Price</t></is></c><c r="D1" t="inlineStr"><is><t>X</t></is></c><c r="E1" t="inlineStr"><is><t>X</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>a</t></is></c><c r="B2"><v>3</v></c><c r="C2"><f>Table1[[#This Row],[Unit Price]]*2</f><v>6</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>b</t></is></c><c r="B3"><v>4</v></c></row>
      </sheetData><tableParts count="3"><tablePart r:id="rId1"/><tablePart r:id="rId2"/><tablePart r:id="rId3"/></tableParts></worksheet>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="../tables/table1.xml" Type="x"/><Relationship Id="rId2" Target="../tables/table2.xml" Type="x"/><Relationship Id="rId3" Target="../tables/table3.xml" Type="x"/></Relationships>`;
    const table = (attrs: string, cols: string[]) => `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" ${attrs}><tableColumns count="${cols.length}">${cols.map((c, i) => `<tableColumn id="${i + 1}" name="${c}"/>`).join("")}</tableColumns><tableStyleInfo name="TableStyleLight1" showRowStripes="0"/></table>`;
    const book = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const wrels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`;
    const { workbook, warnings } = fromXlsx(
      zipSync({
        "xl/workbook.xml": strToU8(book),
        "xl/_rels/workbook.xml.rels": strToU8(wrels),
        "xl/worksheets/sheet1.xml": strToU8(sheet),
        "xl/worksheets/_rels/sheet1.xml.rels": strToU8(rels),
        "xl/tables/table1.xml": strToU8(table('name="Table1" displayName="Table1" ref="A1:C3"', ["Name", "Unit Price", "Column3"])),
        "xl/tables/table2.xml": strToU8(table('name="Dup" displayName="Dup" ref="D1:E3"', ["X", "X"])),
        "xl/tables/table3.xml": strToU8(table('name="NoHeader" displayName="NoHeader" ref="G1:H3" headerRowCount="0"', ["a", "b"])),
      }),
    );
    const s = new SheetSession(workbook);
    expect(s.tables("Data").map((t) => [t.name, t.range, t.style, t.bandedRows])).toEqual([
      ["Table1", "A1:C3", "TableStyleLight1", false],
      ["NoHeader", "G1:H3", "TableStyleLight1", false],
    ]);
    expect(s.tables("Data")[1]).toMatchObject({ headerRow: false, columns: ["a", "b"] });
    expect(s.value("Data", "C2")).toBe(6);
    expect(warnings.join("\n")).toMatch(/"Dup" was read as plain cells: Two columns are called "X"/);
  });
});

describe("table styles", () => {
  it("reads Excel's style names", () => {
    expect(parseTableStyle("TableStyleMedium2")).toEqual({ family: "medium", accent: "#4472c4" });
    expect(parseTableStyle("TableStyleLight10")).toEqual({ family: "light", accent: "#ed7d31" });
    expect(parseTableStyle(undefined)?.family).toBe("medium");
    expect(parseTableStyle("none")).toBeNull();
    expect(parseTableStyle("MyOwnStyle")).toBeNull();
  });

  it("styles the header, the bands and the totals, and nothing outside", () => {
    const s = make();
    s.createTable("Sheet1", "A1:D4");
    s.setTableTotals("Table1", true);
    const sheet = () => s.sheet("Sheet1");
    expect(tableLook(sheet(), 1, 2)).toMatchObject({ bold: true, fill: "#4472c4", color: "#ffffff" });
    expect(tableLook(sheet(), 2, 1)?.fill).toBeDefined(); // the first row of data is shaded
    expect(tableLook(sheet(), 3, 1)?.fill).toBeUndefined(); // the next is not (it has only the thin white lines between cells)
    expect(tableLook(sheet(), 5, 1)).toMatchObject({ bold: true, border: { top: { style: "double" } } });
    expect(tableLook(sheet(), 9, 9)).toBeUndefined();
    s.setTableOptions("Table1", { bandedRows: false, firstColumn: true });
    expect(tableLook(sheet(), 2, 1)).toMatchObject({ bold: true });
    expect(tableLook(sheet(), 2, 2)?.fill).toBeUndefined();
    s.setTableOptions("Table1", { style: "none" });
    expect(tableLook(sheet(), 1, 2)).toBeUndefined();
    s.setTableOptions("Table1", { style: "TableStyleLight9", firstColumn: false });
    expect(tableLook(sheet(), 1, 2)).toMatchObject({ bold: true, fill: "#4472c4", color: "#ffffff", border: { top: { style: "thin" } } }); // Light 9: a filled header in a frame
  });
});

describe("calculated columns", () => {
  const blank = () => {
    const s = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]));
    s.setValues("Sheet1", "A1", [["Item", "Qty", "Price", "Total"], ["Pens", 10, 1.5, null], ["Paper", 4, 8, null], ["Ink", 2, 20, null]]);
    s.createTable("Sheet1", "A1:D4", { name: "Orders" });
    return s;
  };

  it("a formula typed into an empty column fills it", () => {
    const s = blank();
    s.setCell("Sheet1", "D3", "=[@Qty]*[@Price]");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Qty]*[@Price]" });
    expect([2, 3, 4].map((r) => s.value("Sheet1", `D${r}`))).toEqual([15, 32, 40]);
    s.undo(); // the fill is part of the entry
    expect(s.cell("Sheet1", "D2")).toBeUndefined();
    expect(s.tables("Sheet1")[0]!.calculated).toBeUndefined();
  });

  it("relative references move with each row, and the stored formula reads in the first row", () => {
    const s = blank();
    s.setCell("Sheet1", "E1", "Doubled");
    s.setCell("Sheet1", "E4", "=B4*2");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Doubled: "B2*2" });
    expect([2, 3, 4].map((r) => s.cell("Sheet1", `E${r}`)?.f)).toEqual(["B2*2", "B3*2", "B4*2"]);
  });

  it("leaves a column that has something in it alone", () => {
    const s = blank();
    s.setCell("Sheet1", "D2", 5);
    s.setCell("Sheet1", "D3", "=[@Qty]*[@Price]");
    expect(s.tables("Sheet1")[0]!.calculated).toBeUndefined();
    expect(s.cell("Sheet1", "D4")).toBeUndefined();
  });

  it("changing the formula in one cell changes the column, but a constant is an exception", () => {
    const s = blank();
    s.setCell("Sheet1", "D2", "=[@Qty]*[@Price]");
    s.setCell("Sheet1", "D3", 99);
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Qty]*[@Price]" });
    expect(s.cell("Sheet1", "D3")?.v).toBe(99);
    s.setCell("Sheet1", "D4", "=[@Qty]+[@Price]");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Qty]+[@Price]" });
    expect(s.value("Sheet1", "D2")).toBe(11.5);
    expect(s.value("Sheet1", "D3")).toBe(12); // every cell took the new formula (the typed 99 too)
  });

  it("gives new rows the formula: typed under the table, or inserted inside it", () => {
    const s = blank();
    s.setCell("Sheet1", "D2", "=[@Qty]*[@Price]");
    s.setCell("Sheet1", "A5", "Tape");
    s.setCell("Sheet1", "B5", 3);
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D5");
    expect(s.cell("Sheet1", "D5")?.f).toBe("[@Qty]*[@Price]");
    s.setCell("Sheet1", "C5", 2);
    expect(s.value("Sheet1", "D5")).toBe(6);
    s.insertRows("Sheet1", 3);
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D6");
    expect(s.cell("Sheet1", "D3")?.f).toBe("[@Qty]*[@Price]");
    expect(s.cell("Sheet1", "A3")).toBeUndefined();
  });

  it("follows renamed columns and tables, and is forgotten with its column", () => {
    const s = blank();
    s.setCell("Sheet1", "D2", "=[@Qty]*[@Price]");
    s.setCell("Sheet1", "B1", "Units");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Units]*[@Price]" });
    s.setCell("Sheet1", "D1", "Amount");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Amount: "[@Units]*[@Price]" });
    s.renameTable("Orders", "Sales");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Amount: "[@Units]*[@Price]" });
    s.deleteColumns("Sheet1", 4);
    expect(s.tables("Sheet1")[0]!.calculated).toBeUndefined();
  });

  it("is kept in a saved workbook and in XLSX files", () => {
    const s = blank();
    s.setCell("Sheet1", "D2", "=[@Qty]*[@Price]+SUM(Orders[Qty])");
    expect(parseWorkbook(serializeWorkbook(s.state))).toEqual(s.state);
    const part = strFromU8(unzipSync(toXlsx(s.state))["xl/tables/table1.xml"]!);
    expect(part).toContain("<tableColumn id=\"4\" name=\"Total\"><calculatedColumnFormula>Orders[[#This Row],[Qty]]*Orders[[#This Row],[Price]]+SUM(Orders[Qty])</calculatedColumnFormula></tableColumn>");
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.tables![0]!.calculated).toEqual({ Total: "Orders[@Qty]*Orders[@Price]+SUM(Orders[Qty])" });
    const wb = JSON.parse(serializeWorkbook(s.state)).workbook;
    wb.sheets[0].tables[0].calculated = { Nope: "1" };
    expect(() => validateWorkbook(wb)).toThrow(/isn't a column/);
  });
});
