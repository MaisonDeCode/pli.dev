import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";
import { lintPackage } from "./excel-check/lint";

const make = () => {
  const s = new SheetSession(createWorkbook("Views", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [
    ["Name", "Team", "Amount"],
    ["Ann", "red", 30],
    ["Bo", "blue", 10],
    ["Cy", "red", 20],
    ["Di", "blue", 40],
    ["Ed", "green", 5],
  ]);
  s.setValues("Sheet1", "E1", [
    ["Item", "Region", "Qty"],
    ["pen", "east", 3],
    ["ink", "west", 9],
    ["pad", "east", 1],
    ["cap", "west", 7],
    ["tin", "north", 4],
  ]);
  s.setFilter("Sheet1", "A1:C6");
  s.createTable("Sheet1", "E1:G6", { name: "Sales" });
  return s;
};

describe("filter views in XLSX files", () => {
  it("are written as Excel's named sheet view part, reached by an implicit relationship, and pass the package check", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.filterTable("Sales", "Region", ["east"]);
    s.sortTable("Sales", "Qty", "descending");
    s.saveFilterView("Sheet1", "Reds", { sort: { column: 3, descending: true } });
    const bytes = toXlsx(s.state);
    expect(lintPackage(bytes)).toEqual([]);
    const files = unzipSync(bytes);
    const text = (n: string) => strFromU8(files[n]!);
    const part = text("xl/namedSheetViews/namedSheetView1.xml");
    expect(part).toContain('xmlns="http://schemas.microsoft.com/office/spreadsheetml/2019/namedsheetviews"');
    expect(part).toContain('<namedSheetView name="Reds" id="{');
    expect(part).toContain('tableId="0"');
    expect(part).toContain('<columnFilter colId="1"><filter colId="1"><x:filters><x:filter val="red"/></x:filters></filter></columnFilter>');
    expect(part).toContain('<sortRules><sortRule colId="2"><sortCondition descending="1" ref="C1:C6"/></sortRule></sortRules>'); // Excel writes the column over the whole filter range, header row included
    expect(part).toContain('tableId="1"');
    expect(part).toContain('<x:filter val="east"/>');
    expect(part).toContain('<sortCondition descending="1" ref="G1:G6"/>');
    expect(text("[Content_Types].xml")).toContain('PartName="/xl/namedSheetViews/namedSheetView1.xml" ContentType="application/vnd.ms-excel.namedsheetviews+xml"');
    expect(text("xl/worksheets/_rels/sheet1.xml.rels")).toContain('Type="http://schemas.microsoft.com/office/2019/04/relationships/namedSheetView" Target="../namedSheetViews/namedSheetView1.xml"');
    // The views name the AutoFilters by the uid they carry.
    const sheet = text("xl/worksheets/sheet1.xml");
    const uid = /<autoFilter ref="A1:C6" xr:uid="(\{[0-9A-F-]+\})"/.exec(sheet)![1]!;
    expect(part).toContain(`filterId="${uid}"`);
    const table = text("xl/tables/table1.xml");
    const tuid = /<autoFilter ref="E1:G6" xr:uid="(\{[0-9A-F-]+\})"/.exec(table)![1]!;
    expect(part).toContain(`filterId="${tuid}"`);
    expect(uid).not.toBe(tuid);
  });

  it("a sheet with no views writes no part and no revision attributes", () => {
    const s = make();
    const files = unzipSync(toXlsx(s.state));
    expect(Object.keys(files).some((n) => n.includes("namedSheetView"))).toBe(false);
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).not.toContain("xr:uid");
  });

  it("are read back with their filters, sorts and tables", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.filterColumnRule("Sheet1", 3, { kind: "custom", a: { op: "greaterThan", value: 15 } });
    s.filterTable("Sales", "Region", ["east", "north"]);
    s.filterTableRule("Sales", "Qty", { kind: "top", n: 2 });
    s.sortTable("Sales", "Item", "ascending");
    s.saveFilterView("Sheet1", "Reds", { sort: { column: 3 } });
    s.filterColumn("Sheet1", 2, null);
    s.filterTable("Sales", "Region", null);
    s.saveFilterView("Sheet1", "Other");
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const sheet = back.workbook.sheets[0]!;
    const table = sheet.tables![0]!;
    const [reds, other] = sheet.filterViews!;
    expect(reds).toMatchObject({
      name: "Reds",
      range: "A1:C6",
      columns: { B: ["red"], C: { kind: "custom", a: { op: "greaterThan", value: 15 } } },
      sort: { column: "C" },
      tables: { [table.id]: { filters: { Region: ["east", "north"], Qty: { kind: "top", n: 2 } }, sort: { column: "Item" } } },
    });
    expect(other).toMatchObject({ name: "Other", range: "A1:C6", tables: { [table.id]: { sort: { column: "Item" } } } });
    expect(Object.keys(other!.columns ?? {})).toEqual(["C"]); // the amount rule stayed; the team filter was cleared
  });

  it("round-trips a view that holds only a table filter, and one that holds nothing", () => {
    const s = make();
    s.setFilter("Sheet1", null);
    s.filterTable("Sales", "Region", ["west"]);
    s.saveFilterView("Sheet1", "West");
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    const table = back.tables![0]!;
    expect(back.filterViews).toHaveLength(1);
    expect(back.filterViews![0]).toEqual({ id: expect.any(String), name: "West", tables: { [table.id]: { filters: { Region: ["west"] } } } });
    expect(back.filterViews![0]!.range).toBeUndefined();
  });

  it("colour filters in a view carry their own style", () => {
    const s = make();
    s.filterColumnRule("Sheet1", 2, { kind: "color", fill: "#ff0000" });
    s.filterColumnRule("Sheet1", 3, { kind: "color", font: "#00ff00" });
    s.saveFilterView("Sheet1", "Colours");
    const files = unzipSync(toXlsx(s.state));
    const part = strFromU8(files["xl/namedSheetViews/namedSheetView1.xml"]!);
    expect(part).toContain("<dxf>");
    expect(part).toContain("<x:fill>");
    expect(lintPackage(toXlsx(s.state))).toEqual([]);
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.filterViews![0]!;
    expect(back.columns).toEqual({ B: { kind: "color", fill: "#ff0000" }, C: { kind: "color", font: "#00ff00" } });
  });

  it("a view on a sheet without a filter in the file keeps its range through Pli's own round trip", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.saveFilterView("Sheet1", "Reds");
    s.setFilter("Sheet1", null);
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    expect(back.filter).toBeUndefined();
    expect(back.filterViews![0]).toMatchObject({ name: "Reds", range: "A1:C6", columns: { B: ["red"] } });
  });

  it("reads what Excel wrote: matches the sheet's AutoFilter and a table by id, ignores what Pli can't keep, and says so", () => {
    const s = make();
    s.saveFilterView("Sheet1", "Placeholder");
    const files = unzipSync(toXlsx(s.state));
    const x = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    files["xl/namedSheetViews/namedSheetView1.xml"] = new TextEncoder().encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<namedSheetViews xmlns="http://schemas.microsoft.com/office/spreadsheetml/2019/namedsheetviews" xmlns:x="${x}">` +
        `<namedSheetView name="Excel view" id="{11111111-1111-4111-8111-111111111111}">` +
        `<nsvFilter filterId="{22222222-2222-4222-8222-222222222222}" ref="A1:C6" tableId="0">` +
        `<columnFilter colId="1" id="{33333333-3333-4333-8333-333333333333}"><filter colId="1"><x:filters><x:filter val="blue"/></x:filters></filter></columnFilter>` +
        `<columnFilter colId="2"><filter colId="2"><x:iconFilter iconSet="3Arrows" iconId="1"/></filter></columnFilter>` +
        `<sortRules sortMethod="none"><sortRule colId="0"><sortCondition ref="A2:A6"/></sortRule><sortRule colId="2"><sortCondition ref="C2:C6" descending="1"/></sortRule></sortRules>` +
        `</nsvFilter>` +
        `<nsvFilter filterId="{44444444-4444-4444-8444-444444444444}" ref="E1:G6" tableId="1"><columnFilter colId="2"><filter colId="2"><x:customFilters><x:customFilter operator="greaterThan" val="3"/></x:customFilters></filter></columnFilter></nsvFilter>` +
        `<nsvFilter filterId="{55555555-5555-4555-8555-555555555555}" ref="A1:A2" tableId="9"/>` +
        `</namedSheetView></namedSheetViews>`,
    );
    const back = fromXlsx(zipSync(files));
    const sheet = back.workbook.sheets[0]!;
    const table = sheet.tables![0]!;
    expect(sheet.filterViews).toHaveLength(1);
    expect(sheet.filterViews![0]).toMatchObject({
      name: "Excel view",
      range: "A1:C6",
      columns: { B: ["blue"] },
      sort: { column: "A" },
      tables: { [table.id]: { filters: { Qty: { kind: "custom", a: { op: "greaterThan", value: 3 } } } } },
    });
    expect(back.warnings.join("\n")).toMatch(/sorts by several columns/);
    expect(back.warnings.join("\n")).toMatch(/table Pli doesn't have/);
    expect(back.warnings.join("\n")).toMatch(/Pli doesn't have/);
  });

  it("long or repeated names from a file are made to fit", () => {
    const s = make();
    s.saveFilterView("Sheet1", "A");
    const files = unzipSync(toXlsx(s.state));
    const view = (n: string) => `<namedSheetView name="${n}" id="{11111111-1111-4111-8111-11111111111${n.length % 10}}"><nsvFilter filterId="{22222222-2222-4222-8222-222222222222}" tableId="0"/></namedSheetView>`;
    files["xl/namedSheetViews/namedSheetView1.xml"] = new TextEncoder().encode(
      `<?xml version="1.0"?><namedSheetViews xmlns="http://schemas.microsoft.com/office/spreadsheetml/2019/namedsheetviews">${view("Same")}${view("same")}${view("x".repeat(100))}</namedSheetViews>`,
    );
    const views = fromXlsx(zipSync(files)).workbook.sheets[0]!.filterViews!;
    expect(views.map((v) => v.name)).toEqual(["Same", "same (2)", "x".repeat(80)]);
  });
});
