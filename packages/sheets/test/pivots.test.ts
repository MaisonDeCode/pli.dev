import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook } from "../src";

const DATA = [
  ["Region", "Product", "Qty", "Sales"],
  ["East", "Apple", 10, 100],
  ["East", "Pear", 5, 40],
  ["West", "Apple", 7, 70],
  ["West", "Pear", 3, 33],
  ["East", "Apple", 2, 20],
  ["North", "Plum", 4, 44],
];

const make = () => {
  const s = new SheetSession(createWorkbook("Pivots", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", DATA);
  return s;
};
/** The pivot table's cells as the text they show, row by row. */
const shown = (s: SheetSession, sheet: string, range: string) => s.values(sheet, range).map((r) => r.map((v) => (v === null ? "" : typeof v === "object" ? v.error : String(v))));

describe("pivot tables", () => {
  it("sums up by the items of a row field, with a grand total", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    expect(p.range).toBe("A1:B5");
    expect(p.name).toBe("PivotTable1");
    expect(p.source).toBe("Data!$A$1:$D$7");
    expect(shown(s, "Pivot", "A1:B5")).toEqual([
      ["Row Labels", "Sum of Sales"],
      ["East", "160"],
      ["North", "44"],
      ["West", "103"],
      ["Grand Total", "307"],
    ]);
    expect(s.cell("Pivot", "A5")?.s?.bold).toBe(true);
    expect(s.cell("Pivot", "A1")?.s?.bold).toBe(true);
    expect(s.cell("Pivot", "B2")?.s?.bold).toBeUndefined();
  });

  it("spreads a column field across, with a grand total column and a caption row", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], columns: ["Product"], values: ["Qty"] });
    expect(p.range).toBe("A1:E6");
    expect(shown(s, "Pivot", "A1:E6")).toEqual([
      ["Sum of Qty", "Column Labels", "", "", ""],
      ["Row Labels", "Apple", "Pear", "Plum", "Grand Total"],
      ["East", "12", "5", "", "17"],
      ["North", "", "", "4", "4"],
      ["West", "7", "3", "", "10"],
      ["Grand Total", "19", "8", "4", "31"],
    ]);
  });

  it("puts several values side by side under each column item", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], columns: ["Product"], values: ["Qty", "Sales"], grandTotalColumns: false });
    expect(p.range).toBe("A1:G7");
    expect(shown(s, "Pivot", "A1:G7")).toEqual([
      ["", "Column Labels", "", "", "", "", ""],
      ["", "Apple", "", "Pear", "", "Plum", ""],
      ["Row Labels", "Sum of Qty", "Sum of Sales", "Sum of Qty", "Sum of Sales", "Sum of Qty", "Sum of Sales"],
      ["East", "12", "120", "5", "40", "", ""],
      ["North", "", "", "", "", "4", "44"],
      ["West", "7", "70", "3", "33", "", ""],
      ["Grand Total", "19", "190", "8", "73", "4", "44"],
    ]);
  });

  it("lists several values down with no column field", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Qty", "Sales"] });
    // With no column fields the values get a "Values" caption over them, as in Excel.
    expect(shown(s, "Pivot", "A1:C6")).toEqual([
      ["", "Values", ""],
      ["Row Labels", "Sum of Qty", "Sum of Sales"],
      ["East", "17", "160"],
      ["North", "4", "44"],
      ["West", "10", "103"],
      ["Grand Total", "31", "307"],
    ]);
  });

  it("nests row fields: items indented under the one they belong to, which carries the subtotal", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "B2", rows: ["Region", "Product"], values: ["Sales"] });
    expect(p.range).toBe("B2:C11");
    expect(shown(s, "Pivot", "B2:C11")).toEqual([
      ["Row Labels", "Sum of Sales"],
      ["East", "160"],
      ["Apple", "120"],
      ["Pear", "40"],
      ["North", "44"],
      ["Plum", "44"],
      ["West", "103"],
      ["Apple", "70"],
      ["Pear", "33"],
      ["Grand Total", "307"],
    ]);
    expect(s.cell("Pivot", "B3")?.s?.bold).toBe(true);
    expect(s.cell("Pivot", "B4")?.s?.indent).toBe(1);
    expect(s.cell("Pivot", "B4")?.s?.bold).toBeUndefined();
  });

  it("tabular: a column for each row field, labels once per group, the subtotal after the group", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"], tabular: true });
    expect(p.range).toBe("A1:C10");
    expect(shown(s, "Pivot", "A1:C10")).toEqual([
      ["Region", "Product", "Sum of Sales"],
      ["East", "Apple", "120"],
      ["", "Pear", "40"],
      ["East Total", "", "160"],
      ["North", "Plum", "44"],
      ["North Total", "", "44"],
      ["West", "Apple", "70"],
      ["", "Pear", "33"],
      ["West Total", "", "103"],
      ["Grand Total", "", "307"],
    ]);
  });

  it("leaves out subtotals and grand totals on request", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: [{ field: "Region", subtotal: false }, "Product"], values: ["Sales"], grandTotalRows: false });
    expect(shown(s, "Pivot", "A1:B10")).toEqual([
      ["Row Labels", "Sum of Sales"],
      ["East", ""],
      ["Apple", "120"],
      ["Pear", "40"],
      ["North", ""],
      ["Plum", "44"],
      ["West", ""],
      ["Apple", "70"],
      ["Pear", "33"],
      ["", ""],
    ]);
  });

  it("nests column fields with subtotal columns", () => {
    const s = make();
    const t = new SheetSession(createWorkbook("T", ["Data", "Pivot"]));
    t.setValues("Data", "A1", [["Year", "Qtr", "Item", "N"], [2023, "Q1", "a", 1], [2023, "Q2", "a", 2], [2024, "Q1", "a", 4], [2024, "Q1", "b", 8]]);
    const c = t.createPivot("Pivot", { source: "Data!A1:D5", anchor: "A1", rows: ["Item"], columns: ["Year", "Qtr"], values: ["N"] });
    expect(c.range).toBe("A1:G6");
    expect(shown(t, "Pivot", "A1:G6")).toEqual([
      ["Sum of N", "Column Labels", "", "", "", "", ""],
      ["", "2023", "", "2023 Total", "2024", "2024 Total", "Grand Total"],
      ["Row Labels", "Q1", "Q2", "", "Q1", "", ""],
      ["a", "1", "2", "3", "4", "4", "7"],
      ["b", "", "", "", "8", "8", "8"],
      ["Grand Total", "1", "2", "3", "12", "12", "15"],
    ]);
  });

  it("sums up with count, average, max, min, product and the deviations; text counts by default", () => {
    const s = make();
    const fns = ["sum", "count", "countNums", "average", "max", "min", "product", "stdDev", "stdDevp", "var", "varp"] as const;
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: fns.map((fn, i) => ({ field: "Qty", fn, name: `f${i}` })) });
    // East has 10, 5, 2.
    const east = s.values("Pivot", "B3:L3")[0]!;
    expect(east.slice(0, 7)).toEqual([17, 3, 3, 17 / 3, 10, 2, 100]);
    expect(east[7]).toBeCloseTo(4.0414518843, 8);
    expect(east[8]).toBeCloseTo(3.2998316456, 8);
    expect(east[9]).toBeCloseTo(16.3333333333, 8);
    expect(east[10]).toBeCloseTo(10.8888888889, 8);
    // North has one record: no sample deviation or variance.
    const north = s.values("Pivot", "B4:L4")[0]!;
    expect(north.slice(7, 11)).toEqual([{ error: "#DIV/0!" }, 0, { error: "#DIV/0!" }, 0]);
    const t = make();
    t.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Product"] });
    expect(t.pivots("Pivot")[0]!.values[0]!.fn).toBe("count");
    expect(t.pivots("Pivot")[0]!.values[0]!.name).toBeUndefined();
    expect(shown(t, "Pivot", "A1:B5")[0]).toEqual(["Row Labels", "Count of Product"]);
    expect(shown(t, "Pivot", "A2:B5")).toEqual([["East", "3"], ["North", "1"], ["West", "2"], ["Grand Total", "6"]]);
  });

  it("shows results as a share of the row, the column or the whole", () => {
    const s = make();
    s.createPivot("Pivot", {
      source: "Data!A1:D7",
      anchor: "A1",
      rows: ["Region"],
      columns: ["Product"],
      values: [{ field: "Sales", showAs: "percentOfRow" }],
    });
    const p = s.pivots("Pivot")[0]!;
    expect(s.value("Pivot", "B3")).toBeCloseTo(120 / 160);
    expect(s.value("Pivot", "E3")).toBe(1);
    expect(s.cell("Pivot", "B3")?.fmt).toBe("0.00%");
    s.updatePivot("Pivot", p.id, { values: [{ field: "Sales", showAs: "percentOfColumn" }] });
    expect(s.value("Pivot", "B3")).toBeCloseTo(120 / 190);
    expect(s.value("Pivot", "B6")).toBe(1);
    s.updatePivot("Pivot", p.id, { values: [{ field: "Sales", showAs: "percentOfTotal", fmt: "0.0%" }] });
    expect(s.value("Pivot", "E6")).toBe(1);
    expect(s.value("Pivot", "B3")).toBeCloseTo(120 / 307);
    expect(s.cell("Pivot", "B3")?.fmt).toBe("0.0%");
  });

  it("filters by field, and leaves out items, before summing", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"], filters: [{ field: "Product", items: ["Apple"] }] });
    expect(s.pivots("Pivot")[0]!.range).toBe("A1:B6");
    expect(shown(s, "Pivot", "A1:B6")).toEqual([
      ["Product", "Apple"],
      ["", ""],
      ["Row Labels", "Sum of Sales"],
      ["East", "120"],
      ["West", "70"],
      ["Grand Total", "190"],
    ]);
    const p = s.pivots("Pivot")[0]!;
    s.updatePivot("Pivot", p.id, { filters: [{ field: "Product", items: ["Apple", "Pear"] }] });
    expect(shown(s, "Pivot", "A1:B1")).toEqual([["Product", "(Multiple Items)"]]);
    expect(s.value("Pivot", "B6")).toBe(263);
    s.updatePivot("Pivot", p.id, { filters: [{ field: "Product", items: ["Apple", "Pear", "Plum"] }] });
    expect(shown(s, "Pivot", "A1:B1")).toEqual([["Product", "(All)"]]);
    s.updatePivot("Pivot", p.id, { filters: undefined, rows: [{ field: "Region", hidden: ["North"] }] });
    expect(s.pivots("Pivot")[0]!.range).toBe("A1:B4");
    expect(shown(s, "Pivot", "A1:B4")).toEqual([["Row Labels", "Sum of Sales"], ["East", "160"], ["West", "103"], ["Grand Total", "263"]]);
  });
});


describe("pivot tables: items", () => {
  it("orders numbers, then text without regard to capitals, then logical values, with blanks last; descending flips each kind", () => {
    const s = new SheetSession(createWorkbook("Items", ["Data", "Pivot"]));
    s.setValues("Data", "A1", [["K", "N"], ["b", 1], [10, 1], ["A", 1], [2, 1], [null, 1], [true, 1], ["a", 1]]);
    const p = s.createPivot("Pivot", { source: "Data!A1:B8", anchor: "A1", rows: ["K"], values: ["N"] });
    expect(shown(s, "Pivot", "A2:B8")).toEqual([["2", "1"], ["10", "1"], ["A", "2"], ["b", "1"], ["true", "1"], ["(blank)", "1"], ["Grand Total", "7"]]);
    s.updatePivot("Pivot", p.id, { rows: [{ field: "K", descending: true }] });
    expect(shown(s, "Pivot", "A2:A8").flat()).toEqual(["10", "2", "b", "A", "true", "(blank)", "Grand Total"]);
    expect(s.value("Pivot", "A2")).toBe(10);
    expect(typeof s.value("Pivot", "A2")).toBe("number");
  });

  it("shows items in the number format of the source", () => {
    const s = new SheetSession(createWorkbook("Fmt", ["Data", "Pivot"]));
    s.setValues("Data", "A1", [["D", "N"], [45_000, 1], [45_001, 2]]);
    s.setFormat("Data", "A2:A3", "yyyy-mm-dd");
    s.createPivot("Pivot", { source: "Data!A1:B3", anchor: "A1", rows: ["D"], values: ["N"] });
    expect(s.cell("Pivot", "A2")?.fmt).toBe("yyyy-mm-dd");
    expect(s.display("Pivot", "A2").text).toBe("2023-03-15");
    expect(s.pivotFieldItems("Data!A1:B3", "Pivot", "D")).toEqual(["2023-03-15", "2023-03-16"]);
  });

  it("names a missing or repeated header, and counts errors as items", () => {
    const s = new SheetSession(createWorkbook("Names", ["Data", "Pivot"]));
    s.setValues("Data", "A1", [["Sales", null, "Sales"], ["a", 1, 2], ["b", 3, 4]]);
    expect(s.pivotFields("Data!A1:C3", "Pivot")).toEqual(["Sales", "Column2", "Sales2"]);
    s.setCell("Data", "B3", "=1/0");
    s.createPivot("Pivot", { source: "Data!A1:C3", anchor: "A1", rows: ["Sales"], values: ["Column2"] });
    // An error in the data is an error in the sum, and in the totals it reaches.
    expect(shown(s, "Pivot", "A1:B4")).toEqual([["Row Labels", "Sum of Column2"], ["a", "1"], ["b", "#DIV/0!"], ["Grand Total", "#DIV/0!"]]);
    const t = s.pivots("Pivot")[0]!;
    s.updatePivot("Pivot", t.id, { values: [{ field: "Column2", fn: "count" }] });
    expect(shown(s, "Pivot", "A2:B4")).toEqual([["a", "1"], ["b", "1"], ["Grand Total", "2"]]);
  });
});

describe("pivot tables: keeping them", () => {
  it("is refreshed on request, not when the data changes, and refresh undoes in one step", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.setCell("Data", "D2", 1000);
    expect(s.value("Pivot", "B2")).toBe(160);
    s.refreshPivot("Pivot", p.id);
    expect(s.value("Pivot", "B2")).toBe(1060);
    expect(s.value("Pivot", "B5")).toBe(1207);
    s.undo();
    expect(s.value("Pivot", "B2")).toBe(160);
    s.redo();
    expect(s.value("Pivot", "B2")).toBe(1060);
  });

  it("grows and shrinks as the data does, emptying the cells it leaves", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    expect(p.range).toBe("A1:B5");
    s.setValues("Data", "A8", [["South", "Fig", 1, 5]]);
    s.refreshPivot("Pivot", p.id);
    expect(s.pivots("Pivot")[0]!.range).toBe("A1:B6");
    s.setCell("Data", "A8", "East");
    s.refreshPivot("Pivot", p.id);
    expect(s.pivots("Pivot")[0]!.range).toBe("A1:B5");
    expect(s.cell("Pivot", "A6")).toBeUndefined();
    expect(s.cell("Pivot", "B6")).toBeUndefined();
  });

  it("refreshes all of them as one undo step", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "E1", rows: ["Product"], values: ["Qty"] });
    s.setCell("Data", "C2", 100);
    s.setCell("Data", "D2", 200);
    expect(s.refreshAllPivots()).toBe(2);
    expect(s.value("Pivot", "B2")).toBe(260);
    expect(s.value("Pivot", "F2")).toBe(109);
    s.undo();
    expect(s.value("Pivot", "B2")).toBe(160);
    expect(s.value("Pivot", "F2")).toBe(19);
  });

  it("follows inserted rows and columns in its source and above it", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "C5", rows: ["Region"], values: ["Sales"] });
    s.transact([{ type: "insert_rows", sheet: s.sheet("Data").id, at: 3, count: 2 }]);
    expect(s.pivots("Pivot")[0]!.source).toBe("Data!$A$1:$D$9");
    s.transact([{ type: "insert_cols", sheet: s.sheet("Data").id, at: 1, count: 1 }]);
    expect(s.pivots("Pivot")[0]!.source).toBe("Data!$B$1:$E$9");
    s.refreshPivot("Pivot", p.id);
    expect(s.value("Pivot", "D9")).toBe(307);
    s.transact([{ type: "insert_rows", sheet: s.sheet("Pivot").id, at: 2, count: 3 }]);
    expect(s.pivots("Pivot")[0]!.anchor).toBe("C8");
    expect(s.pivots("Pivot")[0]!.range).toBe("C8:D12");
    expect(s.value("Pivot", "D12")).toBe(307);
    s.transact([{ type: "delete_cols", sheet: s.sheet("Pivot").id, at: 1, count: 1 }]);
    expect(s.pivots("Pivot")[0]!.range).toBe("B8:C12");
    s.transact([{ type: "rename_sheet", id: s.sheet("Data").id, name: "Records" }]);
    expect(s.pivots("Pivot")[0]!.source).toBe("Records!$B$1:$E$9");
  });

  it("refuses to be cut through, and to be edited by hand", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    const id = s.sheet("Pivot").id;
    expect(() => s.transact([{ type: "insert_rows", sheet: id, at: 3, count: 1 }])).toThrow(/part of the pivot table/);
    expect(() => s.transact([{ type: "delete_rows", sheet: id, at: 5, count: 3 }])).toThrow(/part of the pivot table/);
    expect(() => s.transact([{ type: "insert_cols", sheet: id, at: 2, count: 1 }])).toThrow(/part of the pivot table/);
    s.transact([{ type: "insert_rows", sheet: id, at: 6, count: 1 }]);
    expect(() => s.setCell("Pivot", "B3", 5)).toThrow(/part of a pivot table/);
    expect(() => s.clear("Pivot", "A1:C9")).toThrow(/part of a pivot table/);
    // A look (not a value) is kept in the table instead of refused.
    expect(() => s.setStyle("Pivot", "B2", { bold: true })).not.toThrow();
    expect(s.pivots("Pivot")[0]!.formats).toHaveLength(1);
    s.setCell("Pivot", "A7", "free");
    expect(s.value("Pivot", "A7")).toBe("free");
  });

  it("only draws over empty cells, never over another pivot table or its own source", () => {
    const s = make();
    s.setCell("Pivot", "B3", "in the way");
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] })).toThrow(/isn't empty/);
    expect(s.pivots("Pivot")).toHaveLength(0);
    expect(s.value("Pivot", "A1")).toBe(null);
    s.setCell("Pivot", "B3", null);
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "B2", rows: ["Product"], values: ["Qty"] })).toThrow(/isn't empty|overlap/);
    expect(() => s.createPivot("Data", { source: "Data!A1:D7", anchor: "E1", rows: ["Region"], values: ["Sales"], name: "PivotTable1" })).toThrow(/called "PivotTable1" already/);
    expect(() => s.createPivot("Data", { source: "Data!A1:D7", anchor: "B3", rows: ["Region"], values: ["Sales"] })).toThrow(/isn't empty/);
    expect(() => s.updatePivot("Pivot", p.id, { anchor: "A1", rows: ["Region", "Product"], values: ["Sales"], tabular: true })).not.toThrow();
  });

  it("says what is wrong with fields and sources", () => {
    const s = make();
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Nope"], values: ["Sales"] })).toThrow(/no field called "Nope"/);
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region", "Region"], values: ["Sales"] })).toThrow(/twice/);
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1" })).toThrow(/at least one field/);
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", columns: ["Product"] })).toThrow(/value field/);
    expect(() => s.createPivot("Pivot", { source: "Nowhere!A1:D7", anchor: "A1", rows: ["Region"] })).toThrow(/no sheet/);
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: [{ field: "Sales" }, { field: "Sales" }] })).toThrow(/Two values/);
    expect(() => s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: [{ field: "Sales", fn: "median" as never }] })).toThrow(/summed up by/);
    expect(() => s.createPivot("Pivot", { source: "Data!A5:D5", anchor: "A1", rows: ["Region"] })).toThrow(/source/);
    expect(s.pivots("Pivot")).toHaveLength(0);
  });

  it("can be deleted with its cells, or kept as values", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.deletePivot("Pivot", p.id);
    expect(s.pivots("Pivot")).toHaveLength(0);
    expect(s.cell("Pivot", "A1")).toBeUndefined();
    s.undo();
    expect(s.pivots("Pivot")).toHaveLength(1);
    expect(s.value("Pivot", "B5")).toBe(307);
    s.deletePivot("Pivot", p.id, { keepCells: true });
    expect(s.pivots("Pivot")).toHaveLength(0);
    expect(s.value("Pivot", "B5")).toBe(307);
    s.setCell("Pivot", "B5", 1);
    expect(s.value("Pivot", "B5")).toBe(1);
  });

  it("reads a table as its source and follows it", () => {
    const s = make();
    s.createTable("Data", "A1:D7", { name: "Orders" });
    const p = s.createPivot("Pivot", { source: "Orders", anchor: "A1", rows: ["Product"], values: ["Qty"] });
    expect(p.source).toBe("Orders");
    s.setValues("Data", "A8", [["East", "Fig", 9, 1]]);
    expect(s.tables("Data")[0]!.range).toBe("A1:D8");
    s.refreshPivot("Pivot", p.id);
    expect(shown(s, "Pivot", "A1:B6")).toEqual([["Row Labels", "Sum of Qty"], ["Apple", "19"], ["Fig", "9"], ["Pear", "8"], ["Plum", "4"], ["Grand Total", "40"]]);
  });

  it("works on a protected sheet only when pivot tables are allowed, and then its locked cells too", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.protectSheet("Pivot");
    expect(() => s.refreshPivot("Pivot", p.id)).toThrow(/protected/);
    expect(() => s.updatePivot("Pivot", p.id, { rows: ["Product"] })).toThrow(/protected/);
    s.unprotectSheet("Pivot");
    s.protectSheet("Pivot", { allow: ["pivotTables"] });
    s.setCell("Data", "D2", 0);
    s.refreshPivot("Pivot", p.id);
    expect(s.value("Pivot", "B2")).toBe(60);
    s.updatePivot("Pivot", p.id, { rows: ["Product"] });
    expect(s.value("Pivot", "A2")).toBe("Apple");
    expect(() => s.setCell("Pivot", "D1", 1)).toThrow();
  });

  it("is saved with the workbook", () => {
    const s = make();
    s.createPivot("Pivot", {
      source: "Data!A1:D7",
      anchor: "B2",
      rows: [{ field: "Region", descending: true, hidden: ["North"], subtotal: false }, "Product"],
      columns: [],
      values: [{ field: "Sales", fn: "average", name: "Mean", fmt: "0.0", showAs: "percentOfTotal" }, "Qty"],
      filters: [{ field: "Qty", items: ["10", "5"] }],
      tabular: true,
      grandTotalRows: false,
    });
    const text = serializeWorkbook(s.state);
    const back = parseWorkbook(text);
    expect(back.sheets[1]!.pivots).toEqual(s.state.sheets[1]!.pivots);
    expect(() => parseWorkbook(text.replace('"anchor":"B2"', '"anchor":"nope"'))).toThrow(/isn't a cell/);
    expect(() => parseWorkbook(text.replace('"tabular":true', '"tabular":true,"mystery":1'))).toThrow(/unknown field/);
    const t = new SheetSession(back);
    expect(t.pivots("Pivot")[0]!.name).toBe("PivotTable1");
  });
});
