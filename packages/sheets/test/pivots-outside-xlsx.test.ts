import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type PivotAxisField, type PivotValue } from "../src";

const DATA = [
  ["Region", "Product", "Qty", "Sales"],
  ["East", "Apple", 10, 100],
  ["East", "Pear", 5, 40],
  ["West", "Apple", 7, 70],
  ["West", "Pear", 3, 33],
  ["North", "Plum", 4, 44],
];
const make = () => {
  const s = new SheetSession(createWorkbook("P", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", DATA);
  return s;
};
type Spec = { rows?: (string | PivotAxisField)[]; columns?: (string | PivotAxisField)[]; values?: (string | PivotValue)[] } & Record<string, unknown>;
const pivot = (s: SheetSession, spec: Spec, source = "Data!A1:D6") => s.createPivot("Pivot", { source, anchor: "A1", ...spec } as never);
const parts = (s: SheetSession) => unzipSync(toXlsx(s.state, { now: () => 45_000.5 }));
const text = (f: Record<string, Uint8Array>, name: string) => strFromU8(f[name]!);
const back = (s: SheetSession) => fromXlsx(toXlsx(s.state, { now: () => 45_000.5 }));

describe("pivot tables over another workbook in XLSX files", () => {
  const source = "[Prices.xlsx]Sheet1!$A$1:$C$5";
  const rows = [["Item", "Price", "Day"], ["Pen", 2, 45000], ["Ink", 9, 45001], ["Pen", 3, 45002], ["Cap", 1, null]];
  const build = () => {
    const s = make();
    s.setDataBlock(source, { rows, formats: ["", "$0.00", "m/d/yyyy"], path: "file:///data/Prices.xlsx" });
    pivot(s, { rows: ["Item"], values: [{ field: "Price", fmt: "$#,##0.00" }] }, source);
    return s;
  };
  it("names the file in the cache's relationships, keeps the rows read, and does not ask Excel to refresh", () => {
    const f = parts(build());
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('r:id="rId2"');
    expect(cache).toContain('<worksheetSource ref="A1:C5" sheet="Sheet1" r:id="rId1"/>');
    expect(cache).not.toContain("refreshOnLoad");
    expect(cache).not.toContain('saveData="0"');
    const rels = text(f, "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels");
    expect(rels).toContain('Target="file:///data/Prices.xlsx" TargetMode="External"');
    expect(rels).toContain('Target="pivotCacheRecords1.xml"');
    const recs = text(f, "xl/pivotCache/pivotCacheRecords1.xml");
    expect(recs).toContain('count="4"');
    expect(recs.match(/<r>/g)).toHaveLength(4);
    expect(text(f, "[Content_Types].xml")).toContain("pivotCacheRecords+xml");
  });
  it("reads the file, the range and the rows back", () => {
    const read = back(build());
    expect(read.warnings).toEqual([]);
    const wb = read.workbook;
    const p = wb.sheets[1]!.pivots![0]!;
    expect(p.source).toBe(source);
    expect(p.rows).toEqual([{ field: "Item" }]);
    const block = wb.dataBlocks![0]!;
    expect(block.source).toBe(source);
    expect(block.path).toBe("file:///data/Prices.xlsx");
    expect(block.from).toBe("book");
    expect(block.rows).toEqual(rows);
    expect(block.formats?.[1]).toBe("$0.00");
    // The cells are what the pivot table drew, and it draws them again from the rows it holds.
    const t = new SheetSession(wb, { now: () => 45_000.5 });
    t.refreshPivot("Pivot", p.id);
    expect(t.values("Pivot", p.range).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Price", "Cap|1", "Ink|9", "Pen|5", "Grand Total|15"]);
  });
  it("is read as plain cells when the file holds no copy of the rows", () => {
    const f = parts(build());
    delete f["xl/pivotCache/pivotCacheRecords1.xml"];
    f["xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels"] = new TextEncoder().encode(text(f, "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels").replace(/<Relationship Id="rId2"[^>]*\/>/, ""));
    const read = fromXlsx(zip(f));
    expect(read.warnings.join("\n")).toMatch(/holds no copy of its rows/);
    expect(read.workbook.sheets[1]!.pivots).toBeUndefined();
  });
});

import { zipSync } from "fflate";
const zip = (f: Record<string, Uint8Array>) => zipSync(f);

describe("what Excel has no place for stays in an extension of Pli's", () => {
  const MODEL = {
    tables: [{ name: "Sales", source: "Data!A1:D6" }],
    relationships: [],
    measures: [{ name: "Total", table: "Sales", expression: "SUM(Sales[Sales])" }, { name: "Regions", table: "Sales", expression: "DISTINCTCOUNT(Sales[Region])" }],
  };
  it("writes a pivot table over the data model as the cells it drew, and brings it back", () => {
    const s = make();
    s.setDataModel(MODEL);
    pivot(s, { rows: ["Sales[Product]"], values: [{ field: "Total" }, { field: "Regions" }] }, "ThisWorkbookDataModel");
    const f = parts(s);
    expect(Object.keys(f).filter((n) => /pivotTable|pivotCache/.test(n))).toEqual([]);
    expect(text(f, "xl/workbook.xml")).toContain("pli:pivots");
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const wb = read.workbook;
    expect(wb.model).toEqual(MODEL);
    const p = wb.sheets[1]!.pivots![0]!;
    expect(p.source).toBe("ThisWorkbookDataModel");
    expect(p.values.map((v) => v.field)).toEqual(["Total", "Regions"]);
    // The cells were written as they were drawn.
    expect(wb.sheets[1]!.cells["A2"]?.v).toBe("Row Labels");
    const t = new SheetSession(wb, { now: () => 45_000.5 });
    t.refreshPivot("Pivot", p.id);
    expect(t.values("Pivot", p.range)[3]).toEqual(["Pear", 73, 2]);
  });
  it("keeps a named block of data and a pivot table with a distinct count", () => {
    const s = make();
    s.setDataBlock("data:Feed", DATA);
    pivot(s, { rows: ["Region"], values: [{ field: "Product", fn: "distinctCount" }] }, "data:Feed");
    pivot(s, { anchor: "G1", rows: ["Region"], values: [{ field: "Product", fn: "distinctCount" }], name: "Distinct" });
    expect(Object.keys(parts(s)).filter((n) => /pivotTable/.test(n))).toEqual([]);
    const wb = back(s).workbook;
    expect(wb.dataBlocks![0]!.source).toBe("data:Feed");
    expect(wb.dataBlocks![0]!.rows).toHaveLength(6);
    expect(wb.sheets[1]!.pivots!.map((p) => p.name)).toEqual(["PivotTable1", "Distinct"]);
    expect(wb.sheets[1]!.pivots![1]!.values[0]!.fn).toBe("distinctCount");
  });
});

describe("several filters on one field in XLSX files", () => {
  const spec = (): Spec => ({
    rows: [{ field: "Region", filter: { kind: "label", a: { op: "notEquals", value: "North" } }, filters: [{ kind: "value", by: 0, a: { op: "greaterThan", value: 50 } }], hidden: ["West"] }],
    values: ["Sales"],
  });
  it("writes each filter with an order, asks for multiple filters per field, and reads them back", () => {
    const s = make();
    pivot(s, spec());
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('multipleFieldFilters="1"');
    expect(table).toMatch(/<filter fld="0" type="captionNotEqual" evalOrder="0" id="1">/);
    expect(table).toMatch(/<filter fld="0" type="valueGreaterThan" evalOrder="1" id="2" iMeasureFld="0">/);
    expect(table).toContain('<item h="1" x="2"/>');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const f = read.workbook.sheets[1]!.pivots![0]!.rows[0]!;
    expect(f.filter).toEqual({ kind: "label", a: { op: "notEquals", value: "North" } });
    expect(f.filters).toEqual([{ kind: "value", by: 0, a: { op: "greaterThan", value: 50 } }]);
    expect(f.hidden).toEqual(["West"]);
  });
  it("leaves multiple filters off when no field has more than one", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", filter: { kind: "top", by: 0, n: 2 } }], values: ["Sales"] });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('multipleFieldFilters="0"');
  });
});

describe("groups inside groups in XLSX files", () => {
  const inner = { by: "items" as const, groups: [{ name: "Coasts", items: ["East", "West"] }] };
  const outer = { by: "items" as const, groups: [{ name: "Anywhere", items: ["Coasts", "North"] }], of: inner };
  it("writes a cache field for each level, tied by par, and reads the nesting back", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: outer }, { field: "Region", group: inner }, "Region"], values: ["Sales"], tabular: true });
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<cacheField name="Region2" numFmtId="0" databaseField="0">');
    expect(cache).toContain('<cacheField name="Region3" numFmtId="0" databaseField="0">');
    // Region2 (field 4) is grouped again by Region3 (field 5); both are made over Region (field 0).
    expect(cache).toMatch(/<fieldGroup par="5" base="0"><discretePr count="3">/);
    expect(cache).toMatch(/<fieldGroup base="0"><discretePr count="3"><x v="0"\/><x v="0"\/><x v="0"\/>/);
    const table = text(f, "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<rowFields count="3"><field x="5"/><field x="4"/><field x="0"/></rowFields>');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const got = read.workbook.sheets[1]!.pivots![0]!.rows;
    expect(got[0]!.group).toEqual({ by: "items", groups: [{ name: "Anywhere", items: ["Coasts", "North"] }], of: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } });
    expect(got[1]!.group).toEqual({ by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] });
    expect(got[2]!.group).toBeUndefined();
  });
  it("reads the level that is not on the rows too, and keeps your names for the headings", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: { ...outer, name: "Where", of: { ...inner, name: "Pair" } } }], values: ["Sales"] });
    const got = back(s).workbook.sheets[1]!.pivots![0]!.rows[0]!.group as { name?: string; of?: { name?: string } };
    expect(got.name).toBe("Where");
    expect(got.of?.name).toBe("Pair");
  });
  it("writes dates grouped by years, quarters and months at once", () => {
    const s = make();
    s.setValues("Data", "F1", [["When"], [45000], [45100], [45400], [45500], [45600]]);
    pivot(s, { source: "Data!A1:F6", rows: [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "quarters" } }, { field: "When", group: { by: "months" } }], values: ["Sales"] });
    const cache = text(parts(s), "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('groupBy="years"');
    expect(cache).toContain('groupBy="quarters"');
    expect(cache).toContain('groupBy="months"');
    const rows = back(s).workbook.sheets[1]!.pivots![0]!.rows;
    expect(rows.map((r) => (r.group as { by: string }).by)).toEqual(["years", "quarters", "months"]);
  });
});

describe("pivot styles of your own in XLSX files", () => {
  const style = { headerRow: { fill: "#003366", color: "#ffffff", bold: true }, firstRowStripe: { fill: "#eeeeee" }, rowStripeSize: 2, firstSubtotalRow: { italic: true }, wholeTable: { border: { horizontal: { style: "hair" as const } } } };
  it("writes the style as a pivot table style with its parts, and reads it and the pivot table's choice back", () => {
    const s = make();
    s.setPivotStyle("Mine", style);
    pivot(s, { rows: ["Region", "Product"], values: ["Sales"], style: { name: "Mine", rowStripes: true } });
    s.setTableStyle("TableOnly", { headerRow: { bold: true } });
    const f = parts(s);
    const styles = text(f, "xl/styles.xml");
    expect(styles).toContain('<tableStyles count="2"');
    expect(styles).toMatch(/<tableStyle name="Mine" table="0" count="4">/);
    expect(styles).toContain('<tableStyleElement type="headerRow" dxfId=');
    expect(styles).toContain('<tableStyleElement type="firstRowStripe" size="2" dxfId=');
    expect(styles).toContain('<tableStyleElement type="firstSubtotalRow" dxfId=');
    expect(text(f, "xl/pivotTables/pivotTable1.xml")).toContain('<pivotTableStyleInfo name="Mine"');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const wb = read.workbook;
    expect(wb.pivotStyles?.["Mine"]).toMatchObject({ headerRow: { fill: "#003366", color: "#ffffff", bold: true }, firstRowStripe: { fill: "#eeeeee" }, rowStripeSize: 2, firstSubtotalRow: { italic: true } });
    expect(wb.pivotStyles?.["Mine"]?.wholeTable?.border?.horizontal?.style).toBe("hair");
    expect(Object.keys(wb.tableStyles ?? {})).toEqual(["TableOnly"]);
    expect(wb.sheets[1]!.pivots![0]!.style).toEqual({ name: "Mine", rowStripes: true });
  });
});

describe("looks kept on pivot table cells in XLSX files", () => {
  it("writes them as formats of the pivot table and reads them back", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: ["Sales", "Qty"] });
    s.formatPivot("Pivot", p.id, { part: "data", items: [{ field: "Region", item: "East" }, { field: "Product", item: "Apple" }], value: 0 }, { style: { fill: "#ffff00", bold: true }, fmt: "$#,##0" });
    s.formatPivot("Pivot", p.id, { part: "label", items: [{ field: "Region", item: "West" }] }, { style: { color: "#ff0000" } });
    s.formatPivot("Pivot", p.id, { part: "label", items: [] }, { style: { italic: true } });
    s.formatPivot("Pivot", p.id, { part: "data", grand: "row" }, { style: { bold: true } });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain("<formats count=");
    expect(table).toMatch(/<pivotArea type="data" outline="0" fieldPosition="0"><references count="3"><reference field="4294967294" count="1" selected="0"><x v="0"\/><\/reference><reference field="0" count="1" selected="0"><x v="0"\/><\/reference><reference field="1" count="1" selected="0"><x v="0"\/><\/reference>/);
    expect(table).toContain('grandRow="1" outline="0" axis="axisRow"');
    expect(table).toContain('grandCol="1" outline="0" axis="axisCol"');
    expect(table.indexOf("<formats")).toBeLessThan(table.indexOf("<pivotTableStyleInfo"));
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const formats = read.workbook.sheets[1]!.pivots![0]!.formats!;
    expect(formats).toHaveLength(4);
    expect(formats[0]).toMatchObject({ part: "data", items: [{ field: "Region", item: "East" }, { field: "Product", item: "Apple" }], value: 0, style: { fill: "#ffff00", bold: true }, fmt: "$#,##0" });
    expect(formats.find((f) => f.part === "label" && f.items?.[0]?.item === "West")?.style).toEqual({ color: "#ff0000" });
    expect(formats.find((f) => f.part === "label" && f.items?.length === 0)?.style).toEqual({ italic: true });
    expect(formats.find((f) => f.grand === "row")?.style).toEqual({ bold: true });
  });
});

describe("pivot tables of several ranges with page fields in XLSX files", () => {
  const build = (pages: number, ranges: { source: string; name?: string; names?: string[] }[]) => {
    const s = make();
    s.setValues("Data", "H1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
    s.setValues("Data", "H6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
    s.setValues("Data", "H11", [["", "Q1", "Q2"], ["East", 100, 200], ["West", 300, 400]]);
    pivot(s, { source: ranges[0]!.source, ranges, pageFields: pages, rows: ["Row"], columns: ["Column"], values: ["Value"] });
    return s;
  };
  const three = [{ source: "Data!H1:J3", names: ["Now", "2024"] }, { source: "Data!H6:J8", names: ["Then", "2024"] }, { source: "Data!H11:J13", names: ["Then", "2023"] }];
  it("writes a page for each page field and the page item each range points at", () => {
    const s = build(2, three);
    const cache = text(parts(s), "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<consolidation autoPage="0"><pages count="2"><page count="2"><pageItem name="Now"/><pageItem name="Then"/></page><page count="2"><pageItem name="2024"/><pageItem name="2023"/></page></pages>');
    expect(cache).toContain('<rangeSet i1="0" i2="0" ref="H1:J3" sheet="Data"/>');
    expect(cache).toContain('<rangeSet i1="1" i2="1" ref="H11:J13" sheet="Data"/>');
    expect(cache).toContain('<cacheField name="Page2"');
    expect(cache).not.toContain('name="Page3"');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const p = read.workbook.sheets[1]!.pivots![0]!;
    expect(p.pageFields).toBe(2);
    expect(p.ranges).toEqual([{ source: "Data!$H$1:$J$3", name: "Now", names: ["Now", "2024"] }, { source: "Data!$H$6:$J$8", name: "Then", names: ["Then", "2024"] }, { source: "Data!$H$11:$J$13", name: "Then", names: ["Then", "2023"] }].map((r) => ({ ...r, source: p.ranges!.find((x) => x.names?.join() === r.names.join())!.source })));
  });
  it("can have no page field", () => {
    const s = build(0, [{ source: "Data!H1:J3" }, { source: "Data!H6:J8" }]);
    const cache = text(parts(s), "xl/pivotCache/pivotCacheDefinition1.xml");
    // Excel repairs a file with an empty `<pages>`, so with no page field the element is left out.
    expect(cache).not.toContain("<pages");
    expect(cache).not.toContain('name="Page1"');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots![0]!.pageFields).toBe(0);
  });
});
