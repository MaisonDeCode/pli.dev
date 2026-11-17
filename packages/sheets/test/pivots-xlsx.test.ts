import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

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
const parts = (s: SheetSession) => unzipSync(toXlsx(s.state, { now: () => 45_000.5 }));
const text = (f: Record<string, Uint8Array>, name: string) => strFromU8(f[name]!);

describe("pivot tables in XLSX files", () => {
  it("writes a pivot table part and a cache that Excel refreshes on opening, and lists them in the package", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], columns: ["Product"], values: ["Sales"] });
    const f = parts(s);
    const table = text(f, "xl/pivotTables/pivotTable1.xml");
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('refreshOnLoad="1"');
    expect(cache).toContain('<worksheetSource ref="A1:D6" sheet="Data"/>');
    expect(cache).toContain('<sharedItems count="3"><s v="East"/><s v="North"/><s v="West"/></sharedItems>');
    expect(cache).toContain('<sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="33" maxValue="100"/>');
    expect(table).toContain('<location ref="A1:E6" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>');
    expect(table).toContain('<rowItems count="4"><i><x/></i><i><x v="1"/></i><i><x v="2"/></i><i t="grand"><x/></i></rowItems>');
    expect(table).toContain('<colFields count="1"><field x="1"/></colFields>');
    expect(table).toContain('<dataField name="Sum of Sales" fld="3" baseField="0" baseItem="0"/>');
    expect(text(f, "xl/pivotTables/_rels/pivotTable1.xml.rels")).toContain('Target="../pivotCache/pivotCacheDefinition1.xml"');
    expect(text(f, "xl/worksheets/_rels/sheet2.xml.rels")).toContain('Target="../pivotTables/pivotTable1.xml"');
    expect(text(f, "xl/workbook.xml")).toMatch(/<calcPr[^>]*\/><pivotCaches><pivotCache cacheId="1" r:id="rIdPivotCache1"\/><\/pivotCaches>/);
    expect(text(f, "xl/_rels/workbook.xml.rels")).toContain('Id="rIdPivotCache1"');
    const types = text(f, "[Content_Types].xml");
    expect(types).toContain("spreadsheetml.pivotTable+xml");
    expect(types).toContain("spreadsheetml.pivotCacheDefinition+xml");
  });

  it("describes nested row fields with repeated items, subtotals, and several values on the columns", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Sales", { field: "Qty", fn: "average", name: "Mean qty" }] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    // East, East/Apple, East/Pear, North, North/Plum, West, West/Apple, West/Pear, grand.
    expect(table).toContain('<rowItems count="9"><i><x/></i><i r="1"><x/></i><i r="1"><x v="1"/></i><i><x v="1"/></i><i r="1"><x v="2"/></i><i><x v="2"/></i><i r="1"><x/></i><i r="1"><x v="1"/></i><i t="grand"><x/></i></rowItems>');
    expect(table).toContain('<colFields count="1"><field x="-2"/></colFields><colItems count="2"><i><x/></i><i i="1"><x v="1"/></i></colItems>');
    expect(table).toContain('<dataField name="Mean qty" fld="2" subtotal="average" baseField="0" baseItem="0"/>');
  });

  it("describes the tabular layout, hidden items, filters, sort and share of total", () => {
    const s = make();
    s.createPivot("Pivot", {
      source: "Data!A1:D6",
      anchor: "A1",
      rows: [{ field: "Region", descending: true, hidden: ["North"], subtotal: false }, "Product"],
      values: [{ field: "Sales", showAs: "percentOfTotal" }],
      filters: [{ field: "Qty", items: ["10", "5", "7"] }],
      tabular: true,
      grandTotalRows: false,
    });
    const f = parts(s);
    const table = text(f, "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain(' compact="0" compactData="0"');
    expect(table).toContain('rowGrandTotals="0"');
    expect(table).toContain('<pivotField axis="axisRow" compact="0" outline="0" showAll="0" sortType="descending" defaultSubtotal="0"><items count="3"><item x="0"/><item h="1" x="1"/><item x="2"/></items></pivotField>');
    expect(table).toContain('multipleItemSelectionAllowed="1"');
    expect(table).toContain('<pageField fld="2" hier="-1"/>');
    expect(table).toContain('showDataAs="percentOfTotal"');
    expect(table).toContain('numFmtId="10"');
    // West, then East, as the sort says; the region North is hidden.
    expect(text(f, "xl/pivotCache/pivotCacheDefinition1.xml")).toContain('<sharedItems count="3"><s v="West"/><s v="North"/><s v="East"/></sharedItems>');
  });

  it("reads back what it wrote", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A3", rows: [{ field: "Region", hidden: ["North"], descending: true }, "Product"], columns: [], values: [{ field: "Sales", name: "Total sales", fmt: "#,##0.00" }, { field: "Qty", fn: "max", showAs: "percentOfColumn" }], filters: [{ field: "Qty", items: ["10"] }], tabular: true, grandTotalColumns: false });
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "K1", rows: ["Product"], columns: ["Region"], values: ["Sales"] });
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const strip = (list: typeof s.state.sheets[1]["pivots"]) => list!.map(({ id: _id, ...rest }) => rest);
    expect(strip(back.workbook.sheets[1]!.pivots)).toEqual(strip(s.state.sheets[1]!.pivots));
    // The cells come back too, and a second round trip changes nothing.
    const t = new SheetSession(back.workbook);
    expect(t.value("Pivot", "A5")).toBe(s.value("Pivot", "A5"));
    expect(strip(fromXlsx(toXlsx(back.workbook)).workbook.sheets[1]!.pivots)).toEqual(strip(back.workbook.sheets[1]!.pivots));
  });

  it("reads a pivot table whose source is a table by its name", () => {
    const s = make();
    s.createTable("Data", "A1:D6", { name: "Orders" });
    s.createPivot("Pivot", { source: "Orders", anchor: "A1", rows: ["Product"], values: ["Qty"] });
    const f = parts(s);
    expect(text(f, "xl/pivotCache/pivotCacheDefinition1.xml")).toContain('<worksheetSource name="Orders"/>');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[1]!.pivots![0]!.source).toBe("Orders");
  });

  it("reads a pivot table as plain cells when it does something Pli can't, and says so", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    const bytes = toXlsx(s.state);
    const f = unzipSync(bytes);
    const edit = (name: string, from: string | RegExp, to: string) => {
      const copy = { ...f };
      copy[name] = new TextEncoder().encode(strFromU8(f[name]!).replace(from, to));
      return copy;
    };
    const zip = (files: Record<string, Uint8Array>) => zipSync(files);
    const grouped = fromXlsx(zip(edit("xl/pivotCache/pivotCacheDefinition1.xml", '<cacheField name="Region" numFmtId="0">', '<cacheField name="Region" numFmtId="0"><fieldGroup base="0"/>')));
    expect(grouped.warnings.join("\n")).toMatch(/pivot table "PivotTable1" was read as plain cells: a group has no range/);
    expect(grouped.workbook.sheets[1]!.pivots).toBeUndefined();
    expect(grouped.workbook.sheets[1]!.cells["A2"]?.v).toBe("East");
    const external = fromXlsx(zip(edit("xl/pivotCache/pivotCacheDefinition1.xml", 'type="worksheet"', 'type="external"')));
    expect(external.warnings.join("\n")).toMatch(/reads a connection/);
    const values = fromXlsx(zip(edit("xl/pivotTables/pivotTable1.xml", 'fld="3"', 'fld="3" subtotal="distinct"')));
    expect(values.warnings.join("\n")).toMatch(/summed up by "distinct"/);
    const rowsValues = fromXlsx(zip(edit("xl/pivotTables/pivotTable1.xml", '<rowFields count="1"><field x="0"/>', '<rowFields count="2"><field x="0"/><field x="-2"/>')));
    // Values down the rows are read now (with one value there is nothing to list down the rows).
    expect(rowsValues.warnings).toEqual([]);
    const oddShow = fromXlsx(zip(edit("xl/pivotTables/pivotTable1.xml", 'fld="3"', 'fld="3" showDataAs="distinct"')));
    expect(oddShow.warnings.join("\n")).toMatch(/shown as "distinct"/);
  });

  it("writes nothing for a pivot table whose source is gone, leaving its cells", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.transact([{ type: "delete_sheet", id: s.sheet("Data").id }]);
    const f = parts(s);
    expect(Object.keys(f).some((k) => k.includes("pivot"))).toBe(false);
    expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.cells["A2"]?.v).toBe("East");
  });

  it("keeps the indent of the items inside another, as a cell style of the file", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"] });
    expect(s.cell("Pivot", "A3")?.s?.indent).toBe(1);
    const f = parts(s);
    expect(text(f, "xl/styles.xml")).toContain('<alignment horizontal="left" indent="1"/>');
    const back = new SheetSession(fromXlsx(toXlsx(s.state)).workbook);
    expect(back.cell("Pivot", "A3")?.s?.indent).toBe(1);
    expect(back.cell("Pivot", "A2")?.s?.indent).toBeUndefined();
    expect(JSON.parse(JSON.stringify(back.state)).sheets[1].cells.A3.s.indent).toBe(1);
  });
});

describe("pivot tables in XLSX files: every arrangement", () => {
  const FIELDS = ["Region", "Product", "Qty", "Sales"];
  it("writes parts that are consistent with the cells for every mix of fields, and reads each back as it was", async () => {
    const { lintPackage } = await import("./excel-check/lint");
    let tried = 0;
    const pick = <T,>(list: readonly T[], size: number): T[][] => (size === 0 ? [[]] : list.flatMap((x, i) => pick(list.slice(i + 1), size - 1).map((rest) => [x, ...rest])));
    for (const rows of [[], ["Region"], ["Region", "Product"], ["Product", "Region"]]) {
      for (const columns of [[], ["Product"], ["Region", "Product"].filter((f) => !rows.includes(f)).slice(0, 2)]) {
        if (columns.some((c) => rows.includes(c))) continue;
        for (const values of [[], ["Sales"], ["Sales", "Qty"]]) {
          if (rows.length + columns.length + values.length === 0 || (columns.length && !values.length)) continue;
          for (const tabular of [false, true]) {
            for (const grand of [true, false]) {
              const s = make();
              const spec = { source: "Data!A1:D6", anchor: "B3", rows, columns, values: values.map((v, i) => ({ field: v, fn: (i ? "average" : "sum") as "sum" | "average" })), tabular, grandTotalRows: grand, grandTotalColumns: grand };
              const p = s.createPivot("Pivot", spec);
              const bytes = toXlsx(s.state);
              const problems = lintPackage(bytes);
              expect(problems, JSON.stringify({ rows, columns, values, tabular, grand })).toEqual([]);
              const back = fromXlsx(bytes);
              expect(back.warnings, JSON.stringify({ rows, columns, values, tabular, grand })).toEqual([]);
              const got = back.workbook.sheets[1]!.pivots![0]!;
              expect({ ...got, id: "" }, JSON.stringify({ rows, columns, values, tabular, grand })).toEqual({ ...p, id: "" });
              tried++;
            }
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(60);
    void FIELDS;
  });
});
