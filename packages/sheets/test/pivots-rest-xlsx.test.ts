import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type Pivot, type PivotAxisField, type PivotValue } from "../src";
import { dateSerial } from "../src/values";
import { lintPackage } from "./excel-check/lint";

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
const strip = (p: Pivot) => {
  const { id: _i, range: _r, ...rest } = p;
  const out = JSON.parse(JSON.stringify(rest));
  for (const k of ["slicers", "timelines"]) for (const x of out[k] ?? []) delete x.id;
  return out;
};
/** The pivot table as it is after being written and read, which must be the one that was written. */
const roundTrip = (s: SheetSession) => {
  const wrote = s.pivots("Pivot")[0]!;
  const read = back(s);
  expect(read.warnings).toEqual([]);
  const got = read.workbook.sheets[1]!.pivots?.[0];
  expect(got).toBeDefined();
  expect(strip(got!)).toEqual(strip(wrote));
  return got!;
};

const dated = () => {
  const s = new SheetSession(createWorkbook("D", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", [
    ["When", "N", "Qty"],
    [(dateSerial(2023, 1, 5) ?? 0) + 0.375, 1, 3],
    [(dateSerial(2023, 2, 20) ?? 0) + 0.5, 2, 12],
    [(dateSerial(2023, 5, 9) ?? 0) + 0.7, 4, 25],
    [(dateSerial(2024, 1, 9) ?? 0) + 0.2, 8, 41],
    [(dateSerial(2024, 3, 30) ?? 0) + 0.9, 16, 7],
  ]);
  s.setFormat("Data", "A2:A6", "m/d/yyyy h:mm");
  return s;
};
const dpivot = (s: SheetSession, spec: Spec) => s.createPivot("Pivot", { source: "Data!A1:C6", anchor: "A1", values: ["N"], ...spec } as never);

describe("grouping in XLSX files", () => {
  it.each([
    ["years", [{ field: "When", group: { by: "years" } }]],
    ["quarters", [{ field: "When", group: { by: "quarters" } }]],
    ["months", [{ field: "When", group: { by: "months" } }]],
    ["days", [{ field: "When", group: { by: "days" } }]],
    ["hours", [{ field: "When", group: { by: "hours" } }]],
    ["minutes", [{ field: "When", group: { by: "minutes" } }]],
    ["seconds", [{ field: "When", group: { by: "seconds" } }]],
    ["a number of days", [{ field: "When", group: { by: "dayRange", days: 30 } }]],
    ["a number of days from a chosen date", [{ field: "When", group: { by: "dayRange", days: 100, start: dateSerial(2023, 1, 1), end: dateSerial(2024, 6, 30) } }]],
    ["years and months", [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "months" } }]],
    ["years, quarters and months", [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "quarters" } }, { field: "When", group: { by: "months" } }]],
  ] as [string, PivotAxisField[]][])("writes a date field grouped by %s and reads it back", (_name, rows) => {
    const s = dated();
    dpivot(s, { rows });
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain("<fieldGroup");
    expect(cache).toContain("<rangePr");
    expect(cache).toContain("<groupItems");
    roundTrip(s);
  });

  it("writes a grouped date field the way Excel does: the date field is the finest part, the coarser parts are fields of their own", () => {
    const s = dated();
    dpivot(s, { rows: [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "months" } }] });
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<cacheFields count="4">');
    expect(cache).toContain('<cacheField name="When" numFmtId="');
    expect(cache).toContain('<fieldGroup par="3" base="0"><rangePr groupBy="months"');
    expect(cache).toContain('<cacheField name="Years" numFmtId="0" databaseField="0">');
    expect(cache).toContain('<fieldGroup base="0"><rangePr groupBy="years"');
    expect(cache).toContain('<s v="2023"/><s v="2024"/>');
    expect(cache).toContain("containsDate=\"1\"");
    const table = text(f, "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<rowFields count="2"><field x="3"/><field x="0"/></rowFields>');
    expect(table).toContain('<pivotFields count="4">');
  });

  it("writes numbers grouped in ranges", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Qty", group: { by: "number", step: 5, start: 0, end: 20 } }], values: ["Sales"] });
    const cache = text(parts(s), "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<rangePr autoStart="0" autoEnd="0" startNum="0" endNum="20" groupInterval="5"/>');
    expect(cache).toContain('<s v="&lt;0"/><s v="0-4"/><s v="5-9"/><s v="10-14"/><s v="15-19"/><s v="20-24"/><s v="&gt;20"/>');
    roundTrip(s);
    const t = make();
    pivot(t, { rows: [{ field: "Qty", group: { by: "number", step: 3 } }], values: ["Sales"] });
    roundTrip(t);
  });

  it("writes items grouped under names as a field of its own that names where each item goes", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } }, "Region"], values: ["Sales"] });
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<cacheField name="Region2" numFmtId="0" databaseField="0">');
    expect(cache).toContain('<fieldGroup base="0"><discretePr count="3"><x v="0"/><x v="1"/><x v="0"/></discretePr><groupItems count="2"><s v="Coasts"/><s v="North"/></groupItems></fieldGroup>');
    expect(text(f, "xl/pivotTables/pivotTable1.xml")).toContain('<rowFields count="2"><field x="4"/><field x="0"/></rowFields>');
    roundTrip(s);
  });

  it("keeps a heading chosen for the group and the items a pivot table leaves out of a group", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: { by: "items", name: "Area", groups: [{ name: "Coasts", items: ["East", "West"] }] }, hidden: ["North"] }], values: ["Sales"] });
    roundTrip(s);
  });

  it("leaves a pivot table that groups a field it also uses plainly as the cells it drew", () => {
    const s = dated();
    dpivot(s, { rows: [{ field: "When", group: { by: "years" } }, "When"] });
    expect(Object.keys(parts(s)).some((k) => k.includes("pivotTable"))).toBe(false);
    expect(back(s).workbook.sheets[1]!.pivots).toBeUndefined();
  });
});

describe("values down the rows in XLSX files", () => {
  it("writes the values as a field of the rows and reads them back, in each layout", () => {
    for (const layout of [{}, { outline: true }, { tabular: true }]) {
      const s = make();
      pivot(s, { rows: ["Region"], values: ["Sales", "Qty"], valuesOnRows: true, ...layout });
      const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
      expect(table).toContain('dataOnRows="1"');
      expect(table).toContain('<rowFields count="2"><field x="0"/><field x="-2"/></rowFields>');
      expect(table).not.toContain("colFields");
      roundTrip(s);
    }
  });

  it("lists a row for each value of each item, and a grand total row for each value", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales", "Qty"], valuesOnRows: true, tabular: true });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<rowItems count="8"><i><x/><x/></i><i r="1" i="1"><x v="1"/></i><i><x v="1"/><x/></i><i r="1" i="1"><x v="1"/></i><i><x v="2"/><x/></i>');
    expect(table).toContain('<i t="grand"><x/></i><i t="grand" i="1"><x v="1"/></i></rowItems>');
  });

  it("works with column fields", () => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: ["Sales", "Qty"], valuesOnRows: true });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<colFields count="1"><field x="1"/></colFields>');
    roundTrip(s);
  });
});

describe("filters by label, date and value in XLSX files", () => {
  it.each([
    ["captionContains", { kind: "label", a: { op: "contains", value: "s" } }, '<customFilter val="*s*"/>'],
    ["captionBeginsWith", { kind: "label", a: { op: "beginsWith", value: "E" } }, '<customFilter val="E*"/>'],
    ["captionNotEndsWith", { kind: "label", a: { op: "notEndsWith", value: "t" } }, '<customFilter operator="notEqual" val="*t"/>'],
    ["captionEqual", { kind: "label", a: { op: "equals", value: "East" } }, '<customFilter val="East"/>'],
    ["captionGreaterThan", { kind: "label", a: { op: "greaterThan", value: "F" } }, 'operator="greaterThan" val="F"'],
    ["captionBetween", { kind: "label", a: { op: "greaterThanOrEqual", value: "E" }, b: { op: "lessThanOrEqual", value: "N" } }, '<customFilters and="1">'],
    ["captionNotBetween", { kind: "label", a: { op: "lessThan", value: "E" }, b: { op: "greaterThan", value: "N" }, or: true }, "<customFilters><customFilter operator=\"lessThan\""],
    ["valueGreaterThan", { kind: "value", by: 0, a: { op: "greaterThan", value: 100 } }, 'operator="greaterThan" val="100"'],
    ["valueBetween", { kind: "value", by: 0, a: { op: "greaterThanOrEqual", value: 40 }, b: { op: "lessThanOrEqual", value: 110 } }, 'val="40"'],
    ["valueNotEqual", { kind: "value", by: 0, a: { op: "notEquals", value: 44 } }, 'operator="notEqual" val="44"'],
  ] as [string, PivotAxisField["filter"], string][])("writes %s and reads it back", (type, filter, xml) => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", filter }], values: ["Sales"] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain(`type="${type}"`);
    expect(table).toContain(xml);
    roundTrip(s);
  });

  it("writes a filter by date period as a dynamic filter, for every period", () => {
    for (const period of ["today", "thisMonth", "lastQuarter", "nextYear", "yearToDate", "q3", "m11"] as const) {
      const s = dated();
      dpivot(s, { rows: [{ field: "When", filter: { kind: "date", period } }] });
      const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
      expect(table).toContain(`<dynamicFilter type="${/^[qm]\d+$/.test(period) ? period.toUpperCase() : period}"/>`);
      roundTrip(s);
    }
  });

  it("writes a filter by date on dates as dateEqual, dateBetween and the others, and reads them back", () => {
    const day = dateSerial(2023, 2, 20) ?? 0;
    const cases: [string, PivotAxisField["filter"]][] = [
      ["dateEqual", { kind: "label", a: { op: "equals", value: day } }],
      ["dateNewerThan", { kind: "label", a: { op: "greaterThan", value: day } }],
      ["dateOlderThanOrEqual", { kind: "label", a: { op: "lessThanOrEqual", value: day } }],
      ["dateBetween", { kind: "label", a: { op: "greaterThanOrEqual", value: day }, b: { op: "lessThanOrEqual", value: day + 400 } }],
      ["dateNotBetween", { kind: "label", a: { op: "lessThan", value: day }, b: { op: "greaterThan", value: day + 400 }, or: true }],
    ];
    for (const [type, filter] of cases) {
      const s = new SheetSession(createWorkbook("D", ["Data", "Pivot"]), { now: () => 45_000.5 });
      s.setValues("Data", "A1", [["When", "N"], [dateSerial(2023, 1, 5), 1], [dateSerial(2023, 2, 20), 2], [dateSerial(2024, 1, 9), 4]]);
      s.setFormat("Data", "A2:A4", "m/d/yyyy");
      s.createPivot("Pivot", { source: "Data!A1:B4", anchor: "A1", rows: [{ field: "When", filter }], values: ["N"] } as never);
      expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain(`type="${type}"`);
      roundTrip(s);
    }
  });

  it("leaves a filter on empty labels, a filter by colour, or two tests joined oddly as the cells it drew", () => {
    for (const filter of [{ kind: "label", a: { op: "blank" } }, { kind: "color", fill: "#ffff00" }, { kind: "label", a: { op: "contains", value: "a" }, b: { op: "contains", value: "s" } }] as PivotAxisField["filter"][]) {
      const s = make();
      pivot(s, { rows: [{ field: "Region", filter }], values: ["Sales"] });
      expect(Object.keys(parts(s)).some((k) => k.includes("pivotTable"))).toBe(false);
      expect(back(s).workbook.sheets[1]!.pivots).toBeUndefined();
    }
  });
});

describe("more ways to show a value in XLSX files", () => {
  it.each([
    ["percentRunningTotal", "percentOfRunningTotal"],
    ["rankAscending", "rankAscending"],
    ["rankDescending", "rankDescending"],
    ["percentOfParentRow", "percentOfParentRow"],
    ["percentOfParentColumn", "percentOfParentCol"],
  ] as const)("writes %s in the data field's extension and reads it back", (showAs, x14) => {
    const s = make();
    pivot(s, showAs === "percentOfParentColumn" ? { rows: ["Product"], columns: ["Region", "Qty"], values: [{ field: "Sales", showAs }] } : { rows: ["Region", "Product"], values: [{ field: "Sales", showAs }] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain(`<x14:dataField pivotShowAs="${x14}"/>`);
    expect(table).not.toContain(`showDataAs="${x14}"`);
    roundTrip(s);
  });

  it("keeps the field a rank or a running total runs along", () => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs: "rankDescending", base: { field: "Region" } }] });
    roundTrip(s);
  });
});

describe("calculated items in XLSX files", () => {
  it("writes the item into the cache and its field, and reads it back", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<sharedItems count="4"><s v="East"/><s v="North"/><s v="West"/><s v="Coasts"/></sharedItems>');
    expect(cache).toContain('<calculatedItems count="1"><calculatedItem field="0" formula="East + West"><pivotArea type="data" outline="0" fieldPosition="0"><references count="1"><reference field="0" count="1" selected="0"><x v="3"/></reference></references></pivotArea></calculatedItem></calculatedItems>');
    expect(text(f, "xl/pivotTables/pivotTable1.xml")).toContain('<item x="3"/>');
    roundTrip(s);
  });
});

describe("a pivot table from several ranges in XLSX files", () => {
  it("writes the ranges as a consolidation cache and reads them back", () => {
    const s = new SheetSession(createWorkbook("C", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
    s.setValues("Data", "A6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
    s.createPivot("Pivot", { source: "Data!A1:C3", ranges: [{ source: "Data!A1:C3" }, { source: "Data!A6:C8", name: "Last year" }], anchor: "A1", rows: ["Row"], columns: ["Column"], values: ["Value"], filters: [{ field: "Page1", items: ["Item1", "Last year"] }] } as never);
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    expect(cache).toContain('<cacheSource type="consolidation"><consolidation autoPage="0"><pages count="1"><page count="2"><pageItem name="Item1"/><pageItem name="Last year"/></page></pages><rangeSets count="2"><rangeSet i1="0" ref="A1:C3" sheet="Data"/><rangeSet i1="1" ref="A6:C8" sheet="Data"/></rangeSets></consolidation></cacheSource>');
    expect(cache).toContain('<cacheField name="Page1"');
    roundTrip(s);
  });
});

describe("pivot table styles in XLSX files", () => {
  it("writes the style and its options, and reads them back", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], style: { name: "PivotStyleMedium9", rowStripes: true, colStripes: true, colHeaders: false } });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('<pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="0" showRowStripes="1" showColStripes="1" showLastColumn="1"/>');
    roundTrip(s);
  });
  it("writes none as a style with no name, and the default style as no style", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], style: { name: "none" } });
    expect(text(parts(s), "xl/pivotTables/pivotTable1.xml")).toContain('<pivotTableStyleInfo showRowHeaders="1"');
    roundTrip(s);
    const t = make();
    pivot(t, { rows: ["Region"], values: ["Sales"] });
    expect(text(parts(t), "xl/pivotTables/pivotTable1.xml")).toContain('name="PivotStyleLight16"');
    expect(back(t).workbook.sheets[1]!.pivots![0]!.style).toBeUndefined();
  });
});

describe("items a slicer leaves out in XLSX files", () => {
  it("writes the items left out of a field the table doesn't use, and reads them back as a filter that isn't shown", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], filters: [{ field: "Product", items: ["Plum"], hidden: true }] });
    const table = text(parts(s), "xl/pivotTables/pivotTable1.xml");
    expect(table).toContain('<item h="1" x="0"/><item h="1" x="1"/><item x="2"/><item t="default"/>');
    expect(table).not.toContain("pageFields");
    roundTrip(s);
  });
});

describe("slicers and timelines on pivot tables in XLSX files", () => {
  it("writes a slicer with its cache (the pivot table, the field and which items are picked) and reads it back with the filter", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    const sl = s.addPivotSlicer("Pivot", p.id, { field: "Region", caption: "Where", columns: 2, style: "SlicerStyleDark2" });
    s.pivotSlicerSelect(sl.id, ["East", "West"]);
    const f = parts(s);
    const cache = text(f, "xl/slicerCaches/slicerCache1.xml");
    expect(cache).toContain('sourceName="Region"');
    expect(cache).toContain('<pivotTables><pivotTable tabId="2" name="PivotTable1"/></pivotTables>');
    expect(cache).toContain('<data><tabular pivotCacheId="1"><items count="3"><i x="0" s="1"/><i x="1"/><i x="2" s="1"/></items></tabular></data>');
    expect(text(f, "xl/slicers/slicer1.xml")).toContain('caption="Where" columnCount="2" style="SlicerStyleDark2"');
    expect(text(f, "xl/pivotCache/pivotCacheDefinition1.xml")).toContain('<x14:pivotCacheDefinition pivotCacheId="1"/>');
    expect(text(f, "xl/drawings/drawing1.xml")).toContain('<sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="Where"/>');
    expect(text(f, "xl/workbook.xml")).toContain('<definedName name="Slicer_Region">#N/A</definedName>');
    expect(text(f, "[Content_Types].xml")).toContain("application/vnd.ms-excel.slicerCache+xml");
    const got = roundTrip(s);
    expect(got.slicers).toHaveLength(1);
    expect(got.rows[0]!.hidden).toEqual(["North"]);
  });

  it("writes a slicer on a field the pivot table doesn't use", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    const sl = s.addPivotSlicer("Pivot", p.id, { field: "Product" });
    s.pivotSlicerSelect(sl.id, ["Plum"]);
    const f = parts(s);
    expect(text(f, "xl/slicerCaches/slicerCache1.xml")).toContain('<i x="0"/><i x="1"/><i x="2" s="1"/>');
    roundTrip(s);
  });

  it("puts the slicers of a pivot table in the same part as a table's, and keeps both", () => {
    const s = make();
    s.createTable("Data", "A1:D6", { name: "Orders" });
    s.addSlicer("Data", { table: "Orders", column: "Product" });
    const p = s.createPivot("Pivot", { source: "Orders", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.addPivotSlicer("Pivot", p.id, { field: "Region" });
    const read = back(s);
    expect(read.warnings).toEqual([]);
    expect(read.workbook.sheets[0]!.slicers).toHaveLength(1);
    expect(read.workbook.sheets[1]!.pivots![0]!.slicers).toHaveLength(1);
  });

  it("writes a timeline with its cache and the dates it keeps, and reads it back", () => {
    const s = dated();
    const p = dpivot(s, { rows: ["When"] });
    const tl = s.addPivotTimeline("Pivot", p.id, { field: "When", caption: "Dates", level: "quarters" });
    s.pivotTimelineSelect(tl.id, dateSerial(2023, 2, 1) ?? 0, dateSerial(2023, 12, 31) ?? 0);
    const f = parts(s);
    const cache = text(f, "xl/timelineCaches/timelineCache1.xml");
    expect(cache).toContain('name="NativeTimeline_When" sourceName="When"');
    expect(cache).toContain('filterType="dateBetween"');
    expect(cache).toContain('<selection startDate="2023-02-01T00:00:00" endDate="2023-12-31T00:00:00"/><bounds startDate="2023-01-01T00:00:00" endDate="2025-01-01T00:00:00"/>');
    expect(text(f, "xl/timelines/timeline1.xml")).toContain('caption="Dates" level="1" selectionLevel="1"');
    expect(text(f, "xl/drawings/drawing1.xml")).toContain("timeslicer");
    expect(text(f, "xl/workbook.xml")).toContain("<x15:timelineCacheRefs>");
    expect(text(f, "xl/workbook.xml")).toContain('<definedName name="NativeTimeline_When">#N/A</definedName>');
    expect(text(f, "xl/worksheets/sheet2.xml")).toContain("<x15:timelineRefs>");
    expect(text(f, "[Content_Types].xml")).toContain("application/vnd.ms-excel.timelineCache+xml");
    const got = roundTrip(s);
    expect(got.timelines).toHaveLength(1);
  });

  it("writes a timeline with no dates picked as one that keeps every date", () => {
    const s = dated();
    const p = dpivot(s, { rows: ["When"] });
    s.addPivotTimeline("Pivot", p.id, { field: "When" });
    expect(text(parts(s), "xl/timelineCaches/timelineCache1.xml")).toContain('filterType="unknown"');
    const got = roundTrip(s);
    expect(got.timelines![0]!.start).toBeUndefined();
  });

  it("keeps the slicer of a pivot table that was read as plain cells out of the file", () => {
    const s = dated();
    const p = dpivot(s, { rows: [{ field: "When", group: { by: "years" } }, "When"] });
    s.addPivotSlicer("Pivot", p.id, { field: "Qty" });
    const f = parts(s);
    expect(Object.keys(f).some((k) => k.includes("slicer"))).toBe(false);
  });
});

describe("the package check on the rest of the pivot tables", () => {
  const edit = (f: Record<string, Uint8Array>, path: string, fn: (t: string) => string) => ({ ...f, [path]: strToU8(fn(strFromU8(f[path]!))) });
  const problems = (f: Record<string, Uint8Array>) => lintPackage(zipSync(f)).join("\n");

  it("passes what Pli wrote for groups, values down the rows, filters, slicers and timelines", () => {
    const s = dated();
    const p = dpivot(s, { rows: [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "months" } }], filters: [] });
    s.addPivotSlicer("Pivot", p.id, { field: "Qty" });
    s.addPivotTimeline("Pivot", p.id, { field: "When" });
    expect(problems(parts(s))).toBe("");
    const t = make();
    pivot(t, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] }, filter: { kind: "label", a: { op: "contains", value: "o" } } }], values: ["Sales", "Qty"], valuesOnRows: true });
    expect(problems(parts(t))).toBe("");
  });

  it("notices a group that lists the wrong number of items, a field grouped over one that isn't there, and items sent to a group that isn't", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } }], values: ["Sales"] });
    const f = parts(s);
    const cache = "xl/pivotCache/pivotCacheDefinition1.xml";
    expect(problems(edit(f, cache, (t) => t.replace('<groupItems count="2">', '<groupItems count="5">')))).toMatch(/says 5 group items but lists 2/);
    expect(problems(edit(f, cache, (t) => t.replace('<fieldGroup base="0">', '<fieldGroup base="9">')))).toMatch(/group over field 9/);
    expect(problems(edit(f, cache, (t) => t.replace('<x v="0"/></discretePr>', '<x v="7"/></discretePr>')))).toMatch(/sends an item to group 7/);
    expect(problems(edit(f, cache, (t) => t.replace('<discretePr count="3">', '<discretePr count="9">')))).toMatch(/says 9 items are grouped/);
  });

  it("notices values on the rows that the table doesn't say, a filter of a kind the format doesn't have, and a rank written in the wrong place", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales", "Qty"], valuesOnRows: true });
    const f = parts(s);
    const table = "xl/pivotTables/pivotTable1.xml";
    expect(problems(edit(f, table, (t) => t.replace(' dataOnRows="1"', "")))).toMatch(/-2 is a row field but dataOnRows isn't set/);
    const g = make();
    pivot(g, { rows: [{ field: "Region", filter: { kind: "label", a: { op: "contains", value: "o" } } }], values: ["Sales"] });
    expect(problems(edit(parts(g), table, (t) => t.replace('type="captionContains"', 'type="bogusType"')))).toMatch(/type "bogusType"/);
    const r = make();
    pivot(r, { rows: ["Region"], values: [{ field: "Sales", showAs: "rankAscending" }] });
    expect(problems(edit(parts(r), table, (t) => t.replace('pivotShowAs="rankAscending"', 'pivotShowAs="rank"')))).toMatch(/pivotShowAs="rank"/);
  });

  it("notices a slicer or timeline for a pivot table that isn't there, and a calculated item that points at nothing", () => {
    const s = dated();
    const p = dpivot(s, { rows: ["When"] });
    s.addPivotSlicer("Pivot", p.id, { field: "Qty" });
    s.addPivotTimeline("Pivot", p.id, { field: "When" });
    const f = parts(s);
    expect(problems(edit(f, "xl/slicerCaches/slicerCache1.xml", (t) => t.replace('name="PivotTable1"', 'name="Nope"')))).toMatch(/pivot table "Nope"/);
    expect(problems(edit(f, "xl/timelineCaches/timelineCache1.xml", (t) => t.replace('name="PivotTable1"', 'name="Nope"')))).toMatch(/pivot table "Nope"/);
    expect(problems(edit(f, "xl/pivotCache/pivotCacheDefinition1.xml", (t) => t.replace('pivotCacheId="1"', 'pivotCacheId="77"')))).toMatch(/pivot cache 1/);
    const c = make();
    pivot(c, { rows: ["Region"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
    expect(problems(edit(parts(c), "xl/pivotCache/pivotCacheDefinition1.xml", (t) => t.replace('<x v="3"/></reference>', '<x v="9"/></reference>')))).toMatch(/calculated item points at item 9/);
  });
  it("reads the formula the way Excel saves it (Region[East]+Region[West])", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] } as never);
    const f = parts(s);
    const cache = text(f, "xl/pivotCache/pivotCacheDefinition1.xml");
    f["xl/pivotCache/pivotCacheDefinition1.xml"] = new TextEncoder().encode(cache.replace('formula="East + West"', 'formula="Region[East]+Region[West]"'));
    const got = fromXlsx(zipSync(f)).workbook.sheets[1]!.pivots![0]!;
    expect(got.calculatedItems).toEqual([{ field: "Region", name: "Coasts", formula: "East+West" }]);
  });
});
