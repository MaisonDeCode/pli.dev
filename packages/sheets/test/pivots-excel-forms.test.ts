import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type PivotAxisField, type PivotValue } from "../src";

/*
 * Pivot tables as Excel itself saves them. The kit's files 25 and 36 came back from Excel with these forms, and Pli read some
 * of those tables as plain cells: a group of items (the field it is made over says `<fieldGroup par="6"/>`), a column of times
 * (a time of day is 30 December 1899 in the cache, and Excel captions hours "8 AM"), and formats whose area has no type.
 */

const DATA = [
  ["Date", "Time", "Region", "Product", "Sales"],
  [45299, 0.34375, "East", "Apple", 100],
  [45336, 0.395833333333333, "East", "Pear", 40],
  [45354, 0.4375, "West", "Apple", 70],
  [45372, 0.5625, "West", "Pear", 33],
  [45654, 0.6875, "North", "Plum", 44],
];
const make = () => {
  const s = new SheetSession(createWorkbook("P", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", DATA);
  s.setFormat("Data", "A2:A6", "m/d/yyyy");
  s.setFormat("Data", "B2:B6", "h:mm");
  return s;
};
type Spec = { rows?: (string | PivotAxisField)[]; columns?: (string | PivotAxisField)[]; values?: (string | PivotValue)[] } & Record<string, unknown>;
const pivot = (s: SheetSession, spec: Spec) => s.createPivot("Pivot", { source: "Data!A1:E6", anchor: "A1", ...spec } as never);
const bytes = (s: SheetSession) => toXlsx(s.state, { now: () => 45_000.5 });
const parts = (s: SheetSession) => unzipSync(bytes(s));
const text = (f: Record<string, Uint8Array>, name: string) => strFromU8(f[name]!);
/** The file with one part rewritten. */
const edit = (s: SheetSession, name: string, f: (t: string) => string) => {
  const files = parts(s);
  files[name] = strToU8(f(strFromU8(files[name]!)));
  return fromXlsx(zipSync(files));
};

describe("a group of items, as Excel saves it", () => {
  const build = () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } }], values: ["Sales"] });
    return s;
  };
  it("writes the back link Excel writes on the field the group is made over, and lists that field's items", () => {
    const f = parts(build());
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<fieldGroup par="5"/>');
    const table = text(f, "xl/pivotTables/pivotTable1.xml");
    // The field the group is made over (Region, field 2) lists its items though it is on no axis.
    expect(table).toMatch(/<pivotField showAll="0"><items count="4"><item x="0"\/><item x="1"\/><item x="2"\/><item t="default"\/><\/items><\/pivotField>/);
  });
  it("reads the tables back, with the groups, when the file is saved as Excel did (items in another order, no shared items on the group)", () => {
    const s = build();
    const read = edit(s, "xl/pivotCache/pivotCacheDefinition1.xml", (t) =>
      t
        // Excel puts the items of the groups first: East, West, then North.
        .replace('<s v="East"/><s v="North"/><s v="West"/>', '<s v="East"/><s v="West"/><s v="North"/>')
        .replace('<discretePr count="3"><x v="0"/><x v="1"/><x v="0"/></discretePr>', '<discretePr count="3"><x v="0"/><x v="0"/><x v="1"/></discretePr>')
        .replace("<sharedItems/>", ""),
    );
    expect(read.warnings).toEqual([]);
    const p = read.workbook.sheets[1]!.pivots![0]!;
    expect(p.rows[0]!.group).toEqual({ by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] });
  });
  it("reads a base field that says only which field holds its group", () => {
    const read = fromXlsx(bytes(build()));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots).toHaveLength(1);
  });
});

describe("times and dates in the cache", () => {
  it("writes a column of times as 30 December 1899 and a column of dates as dates, as Excel keeps them", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Time", group: { by: "hours" } }], values: ["Sales"] });
    const cache = text(parts(s), "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('minDate="1899-12-30T08:15:00"');
    expect(cache).toContain('<rangePr groupBy="hours" startDate="1899-12-30T08:15:00"');
    expect(cache).toContain('<cacheField name="Date" numFmtId="14"><sharedItems containsSemiMixedTypes="0" containsNonDate="0" containsDate="1" containsString="0" minDate="2024-01-08T00:00:00" maxDate="2024-12-29T00:00:00"/>');
  });
  it("lists the dates of a date field on the rows as dates (so that Excel keeps a filter by date period)", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Date", filter: { kind: "date", period: "thisYear" } }], values: ["Sales"] });
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('count="5"><d v="2024-01-08T00:00:00"/>');
    expect(cache).not.toContain('<n v="45299"/>');
    expect(text(f, "xl/pivotTables/pivotTable1.xml")).toContain('<filter fld="0" type="thisYear"');
    const read = fromXlsx(bytes(s));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots![0]!.rows[0]!.filter).toEqual({ kind: "date", period: "thisYear" });
  });
  it("reads hours as Excel saves them: the times on 30 December 1899, the hours captioned 8 AM", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Time", group: { by: "hours" }, hidden: ["9"] }], values: ["Sales"] });
    const read = edit(s, "xl/pivotCache/pivotCacheDefinition1.xml", (t) =>
      t
        .replace(/<s v="(\d+)"\/>/g, (m, h: string) => {
          const n = Number(h);
          return `<s v="${n % 12 === 0 ? 12 : n % 12} ${n < 12 ? "AM" : "PM"}"/>`;
        }),
    );
    expect(read.warnings).toEqual([]);
    const row = read.workbook.sheets[1]!.pivots![0]!.rows[0]!;
    expect(row.group).toEqual({ by: "hours" });
    expect(row.hidden).toEqual(["9"]);
  });
  it("reads the times of a field of dates saved on 30 December 1899", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Time", group: { by: "hours" } }], values: ["Sales"] });
    const files = parts(s);
    expect(text(files, "xl/pivotCache/pivotCacheDefinition1.xml")).toContain("1899-12-30T");
    const read = fromXlsx(zipSync(files));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots).toHaveLength(1);
  });
});

describe("the order of groups of captions", () => {
  it("is manual for day ranges, number ranges and hours, which Excel would otherwise sort as text", () => {
    for (const group of [{ by: "dayRange", days: 14 }, { by: "hours" }] as const) {
      const s = make();
      pivot(s, { rows: [{ field: group.by === "hours" ? "Time" : "Date", group }], values: ["Sales"] });
      expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('sortType="manual"');
    }
    const s = make();
    pivot(s, { rows: [{ field: "Sales", group: { by: "number", step: 50 } }], values: [{ field: "Time", fn: "count" }] });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('sortType="manual"');
  });
  it("lists a descending group from the end and still reads back descending", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Date", group: { by: "dayRange", days: 100 }, descending: true }], values: ["Sales"] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    const items = [...table.matchAll(/<item x="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(items[0]).toBeGreaterThan(items[1]!);
  });
  it("keeps months and years sorted by Excel (they are dates to it)", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Date", group: { by: "years" } }, { field: "Date", group: { by: "months" } }], values: ["Sales"] });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('sortType="ascending"');
  });
});

describe("what Excel adds when it saves a pivot table", () => {
  it("marks the field of a filter by a value, and writes the header row and the one column item the way Excel does", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", filter: { kind: "value", by: 0, a: { op: "greaterThan", value: 50 } } }], values: ["Sales"] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('measureFilter="1"');
    expect(table).toContain('firstHeaderRow="1" firstDataRow="1" firstDataCol="1"');
    expect(table).toContain('<colItems count="1"><i/></colItems>');
  });
});

describe("kept formats, as Excel saves them", () => {
  const build = () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: ["Sales"] });
    s.formatPivot("Pivot", p.id, { part: "data", items: [{ field: "Region", item: "East" }, { field: "Product", item: "Apple" }] }, { style: { fill: "#ffff00", bold: true } });
    return s;
  };
  it("reads an area without a type or an action (Excel leaves out the defaults)", () => {
    const read = edit(build(), "xl/pivotTables/pivotTable1.xml", (t) => t.replace(' action="formatting"', "").replace('<pivotArea type="data" ', "<pivotArea "));
    expect(read.warnings).toEqual([]);
    const formats = read.workbook.sheets[1]!.pivots![0]!.formats!;
    expect(formats).toHaveLength(1);
    expect(formats[0]).toMatchObject({ part: "data", items: [{ field: "Region", item: "East" }, { field: "Product", item: "Apple" }], style: { fill: "#ffff00", bold: true } });
  });
  it("reads a label area that says labelOnly with no type", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    s.formatPivot("Pivot", p.id, { part: "label", items: [{ field: "Region", item: "West" }] }, { style: { italic: true } });
    const read = edit(s, "xl/pivotTables/pivotTable1.xml", (t) => t.replace(' action="formatting"', ""));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.pivots![0]!.formats![0]).toMatchObject({ part: "label", items: [{ field: "Region", item: "West" }], style: { italic: true } });
  });
});

describe("alignment, indent and wrapping in kept formats", () => {
  it("are written into the format's differential format and read back", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: ["Sales"] });
    s.formatPivot("Pivot", p.id, { part: "data", items: [{ field: "Region", item: "East" }, { field: "Product", item: "Apple" }] }, { style: { align: "center", vAlign: "top", wrap: true, bold: true } });
    s.formatPivot("Pivot", p.id, { part: "label", items: [{ field: "Region", item: "West" }] }, { style: { align: "right", indent: 2 } });
    s.formatPivot("Pivot", p.id, { part: "data", grand: "row" }, { style: { wrap: true } });
    const f = parts(s);
    const styles = text(f, "xl/styles.xml");
    expect(styles).toContain('<alignment horizontal="center" vertical="top" wrapText="1"/>');
    expect(styles).toContain('<alignment horizontal="right" indent="2"/>');
    // The alignment sits between the fill and the lines in a differential format.
    expect(styles).toMatch(/<dxf><font><b\/><\/font><alignment [^>]*\/><\/dxf>|<dxf><font><b\/><\/font><fill>.*?<\/fill><alignment /);
    const read = fromXlsx(bytes(s));
    expect(read.warnings).toEqual([]);
    const formats = read.workbook.sheets[1]!.pivots![0]!.formats!;
    expect(formats).toHaveLength(3);
    expect(formats.find((x) => x.part === "data" && x.items?.length === 2)?.style).toEqual({ align: "center", vAlign: "top", wrap: true, bold: true });
    expect(formats.find((x) => x.part === "label")?.style).toEqual({ align: "right", indent: 2 });
    expect(formats.find((x) => x.grand === "row")?.style).toEqual({ wrap: true });
  });
  it("reads an alignment Excel saved with a vertical centre", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    s.formatPivot("Pivot", p.id, { part: "label", items: [{ field: "Region", item: "East" }] }, { style: { align: "left", wrap: true } });
    const read = edit(s, "xl/styles.xml", (t) => t.replace(/<dxfs.*<\/dxfs>/, (d) => d.replace('<alignment horizontal="left" wrapText="1"/>', '<alignment horizontal="left" vertical="center" wrapText="1" indent="1"/>')));
    expect(read.workbook.sheets[1]!.pivots![0]!.formats![0]!.style).toEqual({ align: "left", vAlign: "middle", wrap: true, indent: 1 });
  });
});

describe("a pivot table over Excel's own data model", () => {
  it("is read as the cells Excel drew, and the warning names the tables and measures its cache lists", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    const read = edit(s, "xl/pivotCache/pivotCacheDefinition1.xml", (t) =>
      t
        .replace(/<cacheSource.*?<\/cacheSource>/, '<cacheSource type="external" connectionId="1"/>')
        .replace(
          "</cacheFields>",
          '</cacheFields><cacheHierarchies count="3"><cacheHierarchy uniqueName="[Orders].[Region]" caption="Region" attribute="1"/><cacheHierarchy uniqueName="[Customers].[Name]" caption="Name" attribute="1"/><cacheHierarchy uniqueName="[Measures].[Total sales]" caption="Total sales" measure="1"/></cacheHierarchies>',
        ),
    );
    expect(read.workbook.sheets[1]!.pivots ?? []).toHaveLength(0);
    expect(read.warnings.join("\n")).toMatch(/was read as plain cells: it reads Excel's data model \(tables Orders, Customers; measures Total sales\)/);
  });
});

describe("rules for the cells under some items", () => {
  const build = () => {
    const s = new SheetSession(createWorkbook("P", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", [["Region", "Product", "Sales"], ["East", "Apple", 1], ["East", "Pear", 2], ["West", "Apple", 3], ["West", "Pear", 4]]);
    const p = s.createPivot("Pivot", { source: "Data!A1:C5", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"] } as never);
    s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style: { bold: true }, pivot: { id: p.id, items: { Region: ["West"] } } });
    return s;
  };
  it("write an area for the inner levels too, because Excel counts only West's own level for the first", () => {
    const table = text(parts(build()), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<pivotAreas count="2">');
    expect(table).toContain('<reference field="1" count="0" selected="0"/>');
  });
  it("are read back as one rule", () => {
    const read = fromXlsx(bytes(build()));
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[1]!.conditional?.[0]?.pivot).toMatchObject({ items: { Region: ["West"] } });
  });
});
