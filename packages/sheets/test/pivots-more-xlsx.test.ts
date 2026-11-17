import { strFromU8, unzipSync, zipSync } from "fflate";
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
const pivot = (s: SheetSession, spec: Spec) => s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", ...spec } as never);
const parts = (s: SheetSession) => unzipSync(toXlsx(s.state, { now: () => 45_000.5 }));
const text = (f: Record<string, Uint8Array>, name: string) => strFromU8(f[name]!);
const back = (s: SheetSession) => fromXlsx(toXlsx(s.state, { now: () => 45_000.5 }));

describe("sorting and filtering pivot tables in XLSX files", () => {
  it("writes a sort by a value as an automatic sort scope that names the data field, and reads it back", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", sortBy: { value: 1, descending: true } }], values: ["Qty", "Sales"] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('sortType="descending"');
    expect(table).toContain('<autoSortScope><pivotArea dataOnly="0" outline="0" fieldPosition="0"><references count="1"><reference field="4294967294" count="1" selected="0"><x v="1"/></reference></references></pivotArea></autoSortScope></pivotField>');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots![0]!.rows).toEqual([{ field: "Region", sortBy: { value: 1, descending: true } }]);
    void p;
  });

  it("writes top and bottom filters and reads them back", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", filter: { kind: "top", by: 0, n: 2 } }, { field: "Product", filter: { kind: "top", by: 0, n: 30, bottom: true, unit: "percent" } }], values: ["Sales"] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<filters count="2"><filter fld="0" type="count" evalOrder="-1" id="1" iMeasureFld="0"><autoFilter ref="A1"><filterColumn colId="0"><top10 val="2" filterVal="2"/></filterColumn></autoFilter></filter>');
    expect(table).toContain('<filter fld="1" type="percent" evalOrder="-1" id="2" iMeasureFld="0"><autoFilter ref="A1"><filterColumn colId="0"><top10 top="0" val="30" filterVal="30"/>');
    expect(table.indexOf("<filters")).toBeGreaterThan(table.indexOf("<pivotTableStyleInfo"));
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const got = read.workbook.sheets[1]!.pivots![0]!;
    expect(got.rows[0]!.filter).toEqual({ kind: "top", by: 0, n: 2 });
    expect(got.rows[1]!.filter).toEqual({ kind: "top", by: 0, n: 30, bottom: true, unit: "percent" });
  });

});

describe("layouts and ways to show a value in XLSX files", () => {
  it("writes outline form and reads it back, apart from tabular", () => {
    const s = make();
    pivot(s, { rows: ["Region", "Product"], values: ["Sales"], outline: true });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain(' compact="0" compactData="0" outline="1" outlineData="1"');
    expect(table).toContain('<pivotField axis="axisRow" compact="0" showAll="0" sortType="ascending">');
    const got = back(s).workbook.sheets[1]!.pivots![0]!;
    expect(got.outline).toBe(true);
    expect(got.tabular).toBeUndefined();
  });

  it.each([
    ["differenceFromPrevious", "difference", 'baseField="1" baseItem="1048828"'],
    ["percentDifferenceFromPrevious", "percentDiff", 'baseField="1" baseItem="1048828"'],
    ["runningTotal", "runTotal", 'baseField="1" baseItem="0"'],
    ["index", "index", 'baseField="0" baseItem="0"'],
  ] as const)("writes %s as %s and reads it back", (showAs, name, base) => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs }] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain(`showDataAs="${name}" ${base}`);
    const read = back(s);
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots![0]!.values[0]!.showAs).toBe(showAs);
  });

  it("compares with the innermost row field when there are no columns", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: [{ field: "Sales", showAs: "differenceFromPrevious" }] });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('baseField="0" baseItem="1048828"');
    expect(back(s).workbook.sheets[1]!.pivots![0]!.values[0]!.showAs).toBe("differenceFromPrevious");
  });

  it("writes a comparison with a chosen item and field, and reads it back", () => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs: "differenceFrom", base: { field: "Product", item: "Pear" } }] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    // Pear is the second item of Product (Apple, Pear, Plum).
    expect(table).toContain('showDataAs="difference" baseField="1" baseItem="1"');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots![0]!.values[0]).toMatchObject({ showAs: "differenceFrom", base: { field: "Product", item: "Pear" } });
  });

  it.each([
    ["percentOf", "percent", { field: "Region", item: "West" }, 'baseField="0" baseItem="2"'],
    ["percentDifferenceFrom", "percentDiff", { field: "Product", item: { step: "next" as const } }, 'baseField="1" baseItem="1048829"'],
    ["differenceFrom", "difference", { field: "Region", item: { step: "previous" as const } }, 'baseField="0" baseItem="1048828"'],
  ] as const)("writes %s with a base as %s", (showAs, name, base, attrs) => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs, base }] });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain(`showDataAs="${name}" ${attrs}`);
    expect(back(s).workbook.sheets[1]!.pivots![0]!.values[0]).toMatchObject({ showAs, base });
  });

  it("a running total along a field other than the innermost keeps its field", () => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs: "runningTotal", base: { field: "Region" } }] });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('showDataAs="runTotal" baseField="0" baseItem="0"');
    expect(back(s).workbook.sheets[1]!.pivots![0]!.values[0]).toMatchObject({ showAs: "runningTotal", base: { field: "Region" } });
  });

  it("writes calculated fields into the cache and reads them back", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Net", "Sales"], calculated: [{ name: "Net", formula: "Sales - Qty" }] });
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<cacheField name="Net" numFmtId="0" formula="Sales - Qty" databaseField="0"/>');
    expect(cache).toContain('<cacheFields count="5">');
    const table = text(f, "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<pivotFields count="5">');
    expect(table).toContain('<dataField name="Sum of Net" fld="4" baseField="0" baseItem="0"/>');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots![0]).toMatchObject({ calculated: [{ name: "Net", formula: "Sales - Qty" }], values: [{ field: "Net" }, { field: "Sales" }] });
  });

  it("writes blank lines and repeated labels, and reads them back", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", blankRow: true }, "Product"], values: ["Sales"], tabular: true, repeatLabels: true });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('insertBlankRow="1"');
    expect(table).toContain('fillDownLabels="1"');
    const read = back(s);
    expect(read.warnings).toEqual([]);
    const got = read.workbook.sheets[1]!.pivots![0]!;
    expect(got.rows[0]!.blankRow).toBe(true);
    expect(got.repeatLabels).toBe(true);
  });

  it("leaves blank lines out of the file when the layout is compact (Excel would draw them, Pli doesn't)", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", blankRow: true }], values: ["Sales"] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).not.toContain("insertBlankRow");
  });

  it("writes an order you chose as a manual sort, and reads the order back", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", order: ["West", "East"] }], values: ["Sales"] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('sortType="manual"');
    const got = back(s);
    expect(got.warnings).toEqual([]);
    expect(got.workbook.sheets[1]!.pivots![0]!.rows[0]).toMatchObject({ field: "Region", order: ["West", "East", "North"] });
  });

  it("reads items in the usual order from a file with no sort type as having no order of their own", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    const f = parts(s);
    const original = text(f, "xl/pivotTables/pivotTable1.xml");
    const bare = zipSync({ ...f, "xl/pivotTables/pivotTable1.xml": new TextEncoder().encode(original.replace(' sortType="ascending"', "")) });
    expect(fromXlsx(bare).workbook.sheets[1]!.pivots![0]!.rows[0]!.order).toBeUndefined();
  });

  it("reads a pivot table with settings in an extension it doesn't read as plain cells with a warning", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    const f = parts(s);
    const original = text(f, "xl/pivotTables/pivotTable1.xml");
    const ext = zipSync({ ...f, "xl/pivotTables/pivotTable1.xml": new TextEncoder().encode(original.replace('baseField="0" baseItem="0"/>', 'baseField="0" baseItem="0"><extLst><ext uri="{E15A36E0-9728-4e99-A89B-3F7291B0FE68}"><x14:dataField xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" pivotShowAs="percentOfParent"/></ext></extLst></dataField>')) });
    expect(fromXlsx(ext).warnings.join(" ")).toMatch(/percentOfParent/);
  });
});
