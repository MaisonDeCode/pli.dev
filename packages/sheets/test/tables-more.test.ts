import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, hasHeader, parseWorkbook, resolveTableStyle, serializeWorkbook, tableLook, toXlsx } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Tables", ["Sheet1", "Other"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [
    ["Region", "Item", "Qty", "Total"],
    ["West", "Pens", 10, null],
    ["East", "Paper", 4, null],
    ["West", "Ink", 2, null],
    ["North", "Pens", 7, null],
  ]);
  s.createTable("Sheet1", "A1:D5", { name: "Sales" });
  return s;
};

const hiddenRows = (s: SheetSession) => Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r)).sort((a, b) => a - b);
const column = (s: SheetSession, col: string, rows = [2, 3, 4, 5]) => rows.map((r) => s.value("Sheet1", `${col}${r}`));

describe("filtering a table from its header", () => {
  it("lists the values of a column, lets some through and hides the other rows in one undo step", () => {
    const s = make();
    expect(s.tableFilterValues("Sales", "Region")).toEqual([
      { value: "East", count: 1 },
      { value: "North", count: 1 },
      { value: "West", count: 2 },
    ]);
    s.filterTable("Sales", "Region", ["West"]);
    expect(hiddenRows(s)).toEqual([3, 5]);
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: ["West"] });
    s.filterTable("Sales", "Item", ["Pens"]);
    expect(hiddenRows(s)).toEqual([3, 4, 5]);
    s.undo();
    expect(hiddenRows(s)).toEqual([3, 5]);
    s.filterTable("Sales", "Region", null);
    expect(hiddenRows(s)).toEqual([]);
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
  });

  it("follows a column that is renamed, and forgets one that is deleted", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["West"]);
    s.sortTable("Sales", "Region", "descending");
    s.setCell("Sheet1", "A1", "Area");
    expect(s.tables("Sheet1")[0]).toMatchObject({ filters: { Area: ["West"] }, sort: { column: "Area", descending: true } });
    s.deleteColumns("Sheet1", 1, 1);
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
    expect(s.tables("Sheet1")[0]!.sort).toBeUndefined();
  });

  it("leaves the rows of two tables on one row alone when one lets them through", () => {
    const s = make();
    s.setValues("Sheet1", "G1", [["K"], ["a"], ["b"], ["c"], ["d"]]);
    s.createTable("Sheet1", "G1:G5", { name: "Side" });
    s.filterTable("Sides".replace("s", ""), "K", ["a", "d"]); // hides rows 3 and 4
    s.filterTable("Sales", "Region", ["West"]); // hides 3 and 5
    expect(hiddenRows(s)).toEqual([3, 4, 5]);
    s.filterTable("Sales", "Region", null);
    expect(hiddenRows(s)).toEqual([3, 4]); // the other table still hides its rows
  });

  it("hides no rows without filter buttons, and a table with no header row can't be filtered", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["West"]);
    s.setTableFilterButtons("Sales", false);
    expect(hiddenRows(s)).toEqual([]);
    expect(s.tables("Sheet1")[0]).toMatchObject({ filterButtons: false });
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
    s.setTableHeader("Sales", false);
    expect(() => s.filterTable("Sales", "Region", ["West"])).toThrow(/no header row/);
  });
});

describe("sorting a table from its header", () => {
  it("sorts the data rows, keeps the totals where they are and remembers the sort", () => {
    const s = make();
    s.setCell("Sheet1", "D2", "=[@Qty]*2");
    s.setTableTotals("Sales", true);
    s.sortTable("Sales", "Qty", "descending");
    expect(column(s, "C")).toEqual([10, 7, 4, 2]);
    expect(column(s, "D")).toEqual([20, 14, 8, 4]); // formulas went with their rows
    expect(s.cell("Sheet1", "A6")?.v).toBe("Total");
    expect(s.tables("Sheet1")[0]!.sort).toEqual({ column: "Qty", descending: true });
    s.sortTable("Sales", "Region", "ascending");
    expect(column(s, "A")).toEqual(["East", "North", "West", "West"]);
    s.undo();
    expect(column(s, "C")).toEqual([10, 7, 4, 2]);
    expect(s.tables("Sheet1")[0]!.sort).toEqual({ column: "Qty", descending: true });
    s.sortTable("Sales", "Qty", null);
    expect(s.tables("Sheet1")[0]!.sort).toBeUndefined();
  });

  it("hides again the rows that the filters hide, after sorting", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["West"]);
    s.sortTable("Sales", "Qty", "ascending");
    expect(column(s, "C")).toEqual([2, 4, 7, 10]);
    expect(hiddenRows(s)).toEqual([3, 4]); // the rows of East (4) and North (7)
    s.undo(); // one step
    expect(column(s, "C")).toEqual([10, 4, 2, 7]);
    expect(hiddenRows(s)).toEqual([3, 5]);
  });
});

describe("filters and sorts in XLSX files", () => {
  const files = (s: SheetSession) => Object.fromEntries(Object.entries(unzipSync(toXlsx(s.state))).map(([k, v]) => [k, strFromU8(v)]));

  it("writes what each column lets through and the sort, and reads them back", () => {
    const s = make();
    s.setCell("Sheet1", "B3", null);
    s.filterTable("Sales", "Item", ["Pens", ""]);
    s.sortTable("Sales", "Qty", "descending");
    const part = files(s)["xl/tables/table1.xml"]!;
    expect(part).toContain('<filterColumn colId="1"><filters blank="1"><filter val="Pens"/></filters></filterColumn>');
    expect(part).toContain('<sortState ref="A2:D5"><sortCondition descending="1" ref="C2:C5"/></sortState>');
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.tables("Sheet1")[0]).toMatchObject({ filters: { Item: ["Pens", ""] }, sort: { column: "Qty", descending: true } });
    expect(Object.values(back.sheet("Sheet1").rows ?? {}).filter((d) => d.hidden).length).toBe(1);
  });

  it("writes a table without filter buttons with no autoFilter, and reads that back", () => {
    const s = make();
    s.setTableFilterButtons("Sales", false);
    expect(files(s)["xl/tables/table1.xml"]).not.toContain("autoFilter");
    expect(new SheetSession(fromXlsx(toXlsx(s.state)).workbook).tables("Sheet1")[0]!.filterButtons).toBe(false);
  });

  it("says when a filter is of a kind it can't keep", () => {
    const s = make();
    const zip = unzipSync(toXlsx(s.state));
    const part = strFromU8(zip["xl/tables/table1.xml"]!).replace("<autoFilter ref=\"A1:D5\"/>", '<autoFilter ref="A1:D5"><filterColumn colId="2"><filters calendarType="hijri"><dateGroupItem year="1444" month="3" dateTimeGrouping="month"/></filters></filterColumn></autoFilter>');
    const { strToU8, zipSync } = require("fflate") as typeof import("fflate");
    const { warnings, workbook } = fromXlsx(zipSync({ ...zip, "xl/tables/table1.xml": strToU8(part) }));
    expect(warnings.join("\n")).toMatch(/filter in the table "Sales" was left out because it picks dates in the hijri calendar/);
    expect(workbook.sheets[0]!.tables![0]!.filters).toBeUndefined();
  });
});

describe("exceptions in a calculated column", () => {
  const calc = () => {
    const s = make();
    s.setCell("Sheet1", "D2", "=[@Qty]*2");
    return s;
  };

  it("finds the cells that hold something other than the column's formula", () => {
    const s = calc();
    expect(s.calculatedExceptions("Sheet1")).toEqual([]);
    s.setCell("Sheet1", "D3", 99);
    s.setValues("Sheet1", "D4", [["=[@Qty]+1"], ["=[@Qty]*2"]]); // pasted: more than one cell, so the column keeps its formula
    expect(s.calculatedException("Sheet1", "D3")).toBe("value");
    expect(s.calculatedException("Sheet1", "D4")).toBe("formula");
    expect(s.calculatedException("Sheet1", "D5")).toBeNull();
    expect(s.calculatedException("Sheet1", "D2")).toBeNull();
    expect(s.calculatedException("Sheet1", "C3")).toBeNull();
    expect(s.calculatedExceptions("Sheet1").map((e) => [e.address, e.kind, e.column])).toEqual([["D3", "value", "Total"], ["D4", "formula", "Total"]]);
  });

  it("restores the column's formula in a range, and can make an exception the formula of the column", () => {
    const s = calc();
    s.setCell("Sheet1", "D3", 99);
    s.setValues("Sheet1", "D4", [["=[@Qty]+1"], ["=[@Qty]+1"]]);
    expect(s.restoreCalculated("Sheet1", "D2:D4")).toBe(2);
    expect(column(s, "D")).toEqual([20, 8, 4, 8]); // D5 is outside the range, so it keeps its own formula
    s.undo();
    expect(s.calculatedExceptions("Sheet1").length).toBe(3);
    s.useAsCalculated("Sheet1", "D4");
    expect(s.tables("Sheet1")[0]!.calculated).toEqual({ Total: "[@Qty]+1" });
    expect(s.calculatedExceptions("Sheet1")).toEqual([]);
    expect(() => s.useAsCalculated("Sheet1", "C2")).toThrow(/no formula/);
  });
});

describe("tables with no header row", () => {
  it("turns the header row off and on, and keeps the names", () => {
    const s = make();
    s.setCell("Sheet1", "D2", "=[@Qty]*2");
    s.setTableHeader("Sales", false);
    const t = s.tables("Sheet1")[0]!;
    expect(hasHeader(t)).toBe(false);
    expect(t).toMatchObject({ range: "A2:D5", columns: ["Region", "Item", "Qty", "Total"] });
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.value("Sheet1", "D3")).toBe(8); // [@Qty] still finds its column
    expect(s.value("Sheet1", "F1")).toBeNull();
    s.setCell("Sheet1", "F1", "=SUM(Sales[Qty])");
    expect(s.value("Sheet1", "F1")).toBe(23);
    s.setCell("Sheet1", "F2", "=Sales[[#Headers],[Qty]]");
    expect(s.display("Sheet1", "F2").text).toBe("#REF!");
    s.setTableHeader("Sales", true);
    expect(s.tables("Sheet1")[0]).toMatchObject({ range: "A1:D5" });
    expect(s.tables("Sheet1")[0]!.columns).toBeUndefined();
    expect(["A1", "B1", "C1", "D1"].map((a) => s.value("Sheet1", a))).toEqual(["Region", "Item", "Qty", "Total"]);
    s.undo();
    expect(hasHeader(s.tables("Sheet1")[0]!)).toBe(false);
  });

  it("puts the header row in a new row when the one above isn't empty", () => {
    const s = make();
    s.setTableHeader("Sales", false);
    s.setCell("Sheet1", "A1", "Report");
    s.setTableHeader("Sales", true);
    expect(s.cell("Sheet1", "A1")?.v).toBe("Report");
    expect(s.tables("Sheet1")[0]!.range).toBe("A2:D6");
    expect(s.value("Sheet1", "A2")).toBe("Region");
    expect(s.value("Sheet1", "A3")).toBe("West");
  });

  it("drops filters and slicers when the header goes, and moves the names with columns", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["West"]);
    const slicer = s.addSlicer("Sheet1", { table: "Sales", column: "Region" });
    s.setTableHeader("Sales", false);
    expect(hiddenRows(s)).toEqual([]);
    expect(s.slicers("Sheet1")).toEqual([]);
    s.undo();
    expect(s.slicers("Sheet1")[0]!.id).toBe(slicer.id);
    s.setTableHeader("Sales", false);
    s.insertColumns("Sheet1", 2, 1);
    expect(s.tables("Sheet1")[0]!.columns?.length).toBe(5);
    expect(s.tables("Sheet1")[0]!.columns?.[0]).toBe("Region");
    expect(s.tables("Sheet1")[0]!.columns?.[2]).toBe("Item");
    s.deleteColumns("Sheet1", 1, 1);
    expect(s.tables("Sheet1")[0]!.columns?.[0]).not.toBe("Region");
  });

  it("is written with headerRowCount 0 and read back", () => {
    const s = make();
    s.setTableHeader("Sales", false);
    const part = strFromU8(unzipSync(toXlsx(s.state))["xl/tables/table1.xml"]!);
    expect(part).toContain('headerRowCount="0"');
    expect(part).not.toContain("autoFilter");
    expect(part).toContain('name="Region"');
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.tables("Sheet1")[0]).toMatchObject({ headerRow: false, range: "A2:D5", columns: ["Region", "Item", "Qty", "Total"] });
  });

  it("keeps a row of data when rows are deleted", () => {
    const s = make();
    s.setTableHeader("Sales", false);
    s.deleteRows("Sheet1", 2, 2);
    expect(s.tables("Sheet1")[0]!.range).toBe("A2:D3");
    s.deleteRows("Sheet1", 2, 1);
    expect(s.tables("Sheet1")[0]!.range).toBe("A2:D2");
    s.deleteRows("Sheet1", 2, 1);
    expect(s.tables("Sheet1")).toEqual([]);
  });
});

describe("slicers", () => {
  it("offers the values of a column, and filters the table the way its header does", () => {
    const s = make();
    const slicer = s.addSlicer("Sheet1", { table: "Sales", column: "Region" });
    expect(slicer.from).toEqual({ row: 1, col: 6 });
    expect(s.slicerItems(slicer.id)).toEqual([
      { value: "East", count: 1, selected: true, available: true },
      { value: "North", count: 1, selected: true, available: true },
      { value: "West", count: 2, selected: true, available: true },
    ]);
    s.slicerSelect(slicer.id, ["West"]);
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: ["West"] });
    expect(hiddenRows(s)).toEqual([3, 5]);
    s.filterTable("Sales", "Item", ["Paper"]);
    expect(s.slicerItems(slicer.id).map((i) => [i.value, i.selected, i.available])).toEqual([["East", false, true], ["North", false, false], ["West", true, false]]);
    s.slicerSelect(slicer.id, ["East", "North", "West"]);
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Item: ["Paper"] });
  });

  it("stays on its cell, follows a renamed column, and goes with its table or column", () => {
    const s = make();
    const slicer = s.addSlicer("Sheet1", { table: "Sales", column: "Item", caption: "Pick one", from: { row: 3, col: 7 } });
    s.insertRows("Sheet1", 1, 2);
    expect(s.slicers("Sheet1")[0]!.from.row).toBe(5);
    s.setCell("Sheet1", "B3", "Product");
    expect(s.slicers("Sheet1")[0]).toMatchObject({ column: "Product", caption: "Pick one" });
    s.deleteColumns("Sheet1", 2, 1);
    expect(s.slicers("Sheet1")).toEqual([]);
    s.undo();
    expect(s.slicers("Sheet1")[0]!.id).toBe(slicer.id);
    expect(() => s.addSlicer("Sheet1", { table: "Sales", column: "Nope" })).toThrow(/isn't a column/);
    expect(() => s.addSlicer("Sheet1", { table: "Missing", column: "Region" })).toThrow(/No table/);
  });

  it("is written as the parts Excel keeps and read back", () => {
    const s = make();
    s.addSlicer("Sheet1", { table: "Sales", column: "Region", caption: "Area", columns: 2, from: { row: 2, col: 7, dx: 5 }, width: 200, height: 160 });
    s.slicerSelect(s.slicers("Sheet1")[0]!.id, ["West"]);
    const f = Object.fromEntries(Object.entries(unzipSync(toXlsx(s.state))).map(([k, v]) => [k, strFromU8(v)]));
    expect(f["xl/slicers/slicer1.xml"]).toContain('<slicer name="Area" cache="Slicer_Region" caption="Area" columnCount="2" rowHeight="241300"/>');
    expect(f["xl/slicerCaches/slicerCache1.xml"]).toContain('name="Slicer_Region" sourceName="Region"');
    expect(f["xl/slicerCaches/slicerCache1.xml"]).toContain('<x15:tableSlicerCache tableId="1" column="1"/>');
    expect(f["xl/drawings/drawing1.xml"]).toContain('<sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="Area"/>');
    expect(f["xl/workbook.xml"]).toContain('<x14:slicerCache r:id="rId5"/>');
    expect(f["xl/workbook.xml"]).toContain('<definedName name="Slicer_Region">#N/A</definedName>');
    expect(f["xl/worksheets/sheet1.xml"]).toContain("<x14:slicerList>");
    expect(f["[Content_Types].xml"]).toContain('application/vnd.ms-excel.slicerCache+xml');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const t = new SheetSession(back.workbook);
    expect(t.state.names).toBeUndefined();
    const slicer = t.slicers("Sheet1")[0]!;
    expect(slicer).toMatchObject({ column: "Region", caption: "Area", columns: 2, from: { row: 2, col: 7, dx: 5 }, width: 200, height: 160 });
    expect(slicer.table).toBe(t.tables("Sheet1")[0]!.id);
    expect(t.slicerItems(slicer.id).map((i) => [i.value, i.selected])).toEqual([["East", false], ["North", false], ["West", true]]);
  });

  it("works for a table on another sheet and shares the drawing with charts", () => {
    const s = make();
    s.addChart("Other", { type: "column", series: [{ values: "Sheet1!$C$2:$C$5" }], from: { row: 1, col: 1 }, width: 300, height: 200 });
    s.addSlicer("Other", { table: "Sales", column: "Item" });
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.sheet("Other").charts?.length).toBe(1);
    expect(back.slicers("Other").length).toBe(1);
    expect(back.slicers("Other")[0]!.table).toBe(back.tables("Sheet1")[0]!.id);
  });
});

describe("table styles of your own", () => {
  const mine = {
    wholeTable: { border: { horizontal: { style: "thin" as const, color: "#336699" } } },
    headerRow: { bold: true, fill: "#336699", color: "#ffffff" },
    firstRowStripe: { fill: "#e0ecf8" },
    secondRowStripe: { fill: "#f4f8fc" },
    rowStripeSize: 2,
    totalRow: { bold: true },
    firstHeaderCell: { italic: true },
  };

  it("draws a table in a style of your own", () => {
    const s = make();
    s.setTableStyle("Mine", mine);
    s.setTableOptions("Sales", { style: "Mine" });
    const sheet = s.sheet("Sheet1");
    expect(tableLook(sheet, 1, 2, s.state.tableStyles)).toMatchObject({ bold: true, fill: "#336699", color: "#ffffff", border: { bottom: { style: "thin" } } }); // the line between rows runs under the header
    expect(tableLook(sheet, 1, 1, s.state.tableStyles)).toMatchObject({ italic: true, bold: true }); // the corner cell adds to the header
    expect([2, 3, 4, 5].map((r) => tableLook(sheet, r, 2, s.state.tableStyles)?.fill)).toEqual(["#e0ecf8", "#e0ecf8", "#f4f8fc", "#f4f8fc"]);
    expect(tableLook(sheet, 2, 2)).toBeUndefined(); // without the workbook's styles it's no known style
  });

  it("takes Excel's styles apart to start a new one from", () => {
    const s = make();
    const parts = s.tableStyleParts("TableStyleMedium2")!;
    expect(parts.headerRow).toMatchObject({ bold: true, fill: "#4472c4" });
    s.setTableStyle("Copy", { ...parts, headerRow: { ...parts.headerRow, fill: "#aa0000" } });
    expect(resolveTableStyle("copy", s.state.tableStyles)?.headerRow?.fill).toBe("#aa0000");
    expect(() => s.setTableStyle("TableStyleMedium3", parts)).toThrow(/built-in/);
    expect(() => s.setTableStyle("Bad", { headerRow: { fill: "red" } })).toThrow(/#rrggbb/);
    expect(() => s.setTableStyle("Bad", { rowStripeSize: 12 })).toThrow(/1 to 9/);
  });

  it("sends tables that used a style back to the default when it is removed, in one undo step", () => {
    const s = make();
    s.setTableStyle("Mine", mine);
    s.setTableOptions("Sales", { style: "Mine" });
    s.setTableStyle("Mine", null);
    expect(s.state.tableStyles).toBeUndefined();
    expect(s.tables("Sheet1")[0]!.style).toBeUndefined();
    s.undo();
    expect(s.tables("Sheet1")[0]!.style).toBe("Mine");
    expect(s.state.tableStyles?.Mine).toBeDefined();
  });

  it("is written into the stylesheet and read back", () => {
    const s = make();
    s.setTableStyle("Mine", mine);
    s.setTableOptions("Sales", { style: "Mine" });
    const f = Object.fromEntries(Object.entries(unzipSync(toXlsx(s.state))).map(([k, v]) => [k, strFromU8(v)]));
    expect(f["xl/styles.xml"]).toMatch(/<tableStyles count="1"[^>]*><tableStyle name="Mine" pivot="0" count="6">/);
    expect(f["xl/styles.xml"]).toContain('<tableStyleElement type="firstRowStripe" size="2" dxfId=');
    expect(f["xl/tables/table1.xml"]).toContain('<tableStyleInfo name="Mine"');
    const back = fromXlsx(toXlsx(s.state)).workbook;
    expect(back.tableStyles).toEqual(s.state.tableStyles);
    expect(back.sheets[0]!.tables![0]!.style).toBe("Mine");
  });
});

describe("saving", () => {
  it("keeps filters, sorts, slicers, styles and a table with no header row in the workbook file", () => {
    const s = make();
    s.setTableStyle("Mine", { headerRow: { bold: true }, rowStripeSize: 2, firstRowStripe: { fill: "#e0ecf8" } });
    s.setTableOptions("Sales", { style: "Mine" });
    s.filterTable("Sales", "Region", ["West"]);
    s.sortTable("Sales", "Qty", "descending");
    s.addSlicer("Sheet1", { table: "Sales", column: "Item", columns: 2 });
    s.setValues("Other", "A1", [["x"], [1], [2]]);
    s.createTable("Other", "A1:A3", { name: "Plain" });
    s.setTableHeader("Plain", false);
    s.setTableFilterButtons("Sales", false);
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back).toEqual(s.state);
  });

  it("refuses a file whose slicer, filter or style is wrong", () => {
    const s = make();
    s.addSlicer("Sheet1", { table: "Sales", column: "Item" });
    const wb = JSON.parse(serializeWorkbook(s.state));
    const bad = (edit: (w: any) => void) => {
      const copy = JSON.parse(JSON.stringify(wb));
      edit(copy.workbook);
      return () => parseWorkbook(JSON.stringify(copy));
    };
    expect(bad((w) => (w.sheets[0].slicers[0].column = "Nope"))).toThrow(/isn't a column/);
    expect(bad((w) => (w.sheets[0].slicers[0].table = "gone"))).toThrow(/needs a table/);
    expect(bad((w) => (w.sheets[0].tables[0].filters = { Nope: ["a"] }))).toThrow(/can't be filtered/);
    expect(bad((w) => (w.sheets[0].tables[0].filters = { Region: [1] }))).toThrow(/list of text/);
    expect(bad((w) => (w.tableStyles = { TableStyleMedium2: {} }))).toThrow(/built-in/);
    expect(bad((w) => (w.tableStyles = { Mine: { headerRow: { fill: "red" } } }))).toThrow(/#rrggbb/);
  });
  it("reads a slicer the way Excel saves it, with the alternate content inside the anchor", () => {
    const s = make();
    s.addSlicer("Sheet1", { table: "Sales", column: "Region", caption: "Area", from: { row: 2, col: 6 } });
    const files = unzipSync(toXlsx(s.state));
    const name = Object.keys(files).find((n) => /xl\/drawings\/drawing\d+\.xml$/.test(n))!;
    const drawing = strFromU8(files[name]!);
    // Pli: <mc:AlternateContent><mc:Choice><xdr:oneCellAnchor>FROM EXT <frame/></xdr:oneCellAnchor></mc:Choice><mc:Fallback/></mc:AlternateContent>
    const m = /<mc:AlternateContent[^>]*><mc:Choice([^>]*)>(<xdr:oneCellAnchor>)(<xdr:from>.*?<\/xdr:from>)(<xdr:ext [^>]*\/>)(<xdr:graphicFrame.*?<\/xdr:graphicFrame>)<xdr:clientData\/><\/xdr:oneCellAnchor><\/mc:Choice>(<mc:Fallback>.*?<\/mc:Fallback>)<\/mc:AlternateContent>/s.exec(drawing);
    expect(m).not.toBeNull();
    const excel = `<xdr:oneCellAnchor>${m![3]}${m![4]}<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice${m![1]}>${m![5]}</mc:Choice>${m![6]}</mc:AlternateContent><xdr:clientData/></xdr:oneCellAnchor>`;
    files[name] = strToU8(drawing.replace(m![0], excel).replace(/<\/xdr:oneCellAnchor>(?=<\/xdr:wsDr>)/, "</xdr:oneCellAnchor>"));
    const back = new SheetSession(fromXlsx(zipSync(files)).workbook);
    expect(back.slicers("Sheet1")).toHaveLength(1);
    expect(back.slicers("Sheet1")[0]).toMatchObject({ column: "Region", caption: "Area", from: { row: 2, col: 6 } });
    expect(back.images("Sheet1")).toEqual([]);
    expect(back.charts("Sheet1")).toEqual([]);
  });
});
