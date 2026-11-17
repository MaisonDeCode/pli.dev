import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook } from "../src";

/** A sheet with a filter over A1:C6 and a table "Sales" over E1:G6. */
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
const hidden = (s: SheetSession) => Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r)).sort((a, b) => a - b);
const items = (s: SheetSession) => [2, 3, 4, 5, 6].map((r) => String(s.value("Sheet1", `E${r}`)));
const tableId = (s: SheetSession) => s.sheet("Sheet1").tables![0]!.id;

describe("filter views: tables", () => {
  it("saves the filters and sort of every table with the view, by table id and column name", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    s.sortTable("Sales", "Qty", "descending");
    const v = s.saveFilterView("Sheet1", "East");
    expect(v.tables).toEqual({ [tableId(s)]: { filters: { Region: ["east"] }, sort: { column: "Qty", descending: true } } });
    expect(v.range).toBe("A1:C6");
    // a copy: later changes to the table don't reach the view
    s.filterTable("Sales", "Region", ["west"]);
    expect(s.filterViews("Sheet1")[0]!.tables![tableId(s)]!.filters).toEqual({ Region: ["east"] });
  });

  it("a sheet with tables but nothing filtered holds an empty list of tables, which means the tables are unfiltered in the view", () => {
    const s = make();
    const v = s.saveFilterView("Sheet1", "Plain");
    expect(v.tables).toEqual({});
    const t = new SheetSession(createWorkbook("No tables", ["Sheet1"]));
    t.setValues("Sheet1", "A1", [["a"], [1], [2]]);
    t.setFilter("Sheet1", "A1:A3");
    expect(t.saveFilterView("Sheet1", "Plain").tables).toBeUndefined();
  });

  it("can be saved with only a table filter, no sheet filter, and refuses when there is nothing at all", () => {
    const s = make();
    s.setFilter("Sheet1", null);
    expect(s.canSaveFilterView("Sheet1")).toBe(false);
    expect(() => s.saveFilterView("Sheet1", "None")).toThrow(/no filter/);
    s.filterTable("Sales", "Region", ["west"]);
    expect(s.canSaveFilterView("Sheet1")).toBe(true);
    const v = s.saveFilterView("Sheet1", "West");
    expect(v.range).toBeUndefined();
    expect(v.tables).toEqual({ [tableId(s)]: { filters: { Region: ["west"] } } });
    expect(() => s.saveFilterView("Sheet1", "Sorted", { sort: { column: 3 } })).toThrow();
  });

  it("showing a view filters the table as the view says, without touching the table, the sheet or the history", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    s.saveFilterView("Sheet1", "East");
    s.filterTable("Sales", "Region", ["west"]);
    s.saveFilterView("Sheet1", "West");
    s.filterTable("Sales", "Region", null);
    expect(hidden(s)).toEqual([]);
    const before = JSON.stringify(s.state);
    expect(s.filterViewRows("Sheet1", "East")).toEqual({ hide: [3, 5, 6], show: [] });
    expect(s.filterViewRows("Sheet1", "West")).toEqual({ hide: [2, 4, 6], show: [] });
    expect(JSON.stringify(s.state)).toBe(before);
    expect(s.canUndo).toBe(true); // only the earlier edits are in the history
  });

  it("the table's own filters stop counting while a view that knows about tables shows, and come back for the rest of the sheet", () => {
    const s = make();
    s.saveFilterView("Sheet1", "Everything"); // tables: {} -> tables unfiltered
    s.filterTable("Sales", "Region", ["west"]);
    expect(hidden(s)).toEqual([2, 4, 6]);
    // the table hides rows 2, 4, 6 itself; the view shows them
    expect(s.filterViewRows("Sheet1", "Everything")).toEqual({ hide: [], show: [2, 4, 6] });
  });

  it("a view saved before tables were part of it leaves the tables as they are", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    const v = s.saveFilterView("Sheet1", "Reds");
    s.filterColumn("Sheet1", 2, null);
    const doc = JSON.parse(serializeWorkbook(s.state));
    delete doc.workbook.sheets[0].filterViews[0].tables;
    const old = new SheetSession(parseWorkbook(JSON.stringify(doc)));
    old.filterTable("Sales", "Region", ["west"]);
    // Row 3 (Bo, blue) is hidden by the view; the table's rows 2, 4, 6 are hidden already.
    const rows = old.filterViewRows("Sheet1", v.id);
    expect(rows.hide.sort()).toContain(3);
    expect(rows.show).toEqual([]);
  });

  it("applying a view for everyone sets the table's filters and sort, hides its rows, and undoes in one step", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    s.sortTable("Sales", "Qty", "descending");
    const v = s.saveFilterView("Sheet1", "East by qty");
    s.filterTable("Sales", "Region", null);
    s.sortTable("Sales", "Item", "ascending");
    expect(items(s)).toEqual(["cap", "ink", "pad", "pen", "tin"]);
    s.applyFilterView("Sheet1", v.id);
    expect(s.sheet("Sheet1").tables![0]).toMatchObject({ filters: { Region: ["east"] }, sort: { column: "Qty", descending: true } });
    expect(items(s)).toEqual(["ink", "cap", "tin", "pen", "pad"]);
    expect(hidden(s)).toEqual([2, 3, 4]); // east rows are pen (row 5) and pad (row 6) after the sort
  });

  it("applying a view with another table state restores the filters in one undo step", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    const v = s.saveFilterView("Sheet1", "East");
    s.filterTable("Sales", "Region", ["west"]);
    const before = JSON.stringify(s.state);
    s.applyFilterView("Sheet1", v.id);
    expect(s.sheet("Sheet1").tables![0]!.filters).toEqual({ Region: ["east"] });
    expect(hidden(s)).toEqual([3, 5, 6]);
    s.undo();
    expect(JSON.stringify(s.state)).toBe(before);
    s.redo();
    expect(hidden(s)).toEqual([3, 5, 6]);
  });

  it("applying a view with an empty table list clears the table's filters; a view without it leaves them", () => {
    const s = make();
    const plain = s.saveFilterView("Sheet1", "Plain");
    s.filterTable("Sales", "Region", ["west"]);
    s.applyFilterView("Sheet1", plain.id);
    expect(s.sheet("Sheet1").tables![0]!.filters).toBeUndefined();
    expect(hidden(s)).toEqual([]);
    // the same view without the tables entry
    s.filterTable("Sales", "Region", ["west"]);
    const doc = JSON.parse(serializeWorkbook(s.state));
    delete doc.workbook.sheets[0].filterViews[0].tables;
    const old = new SheetSession(parseWorkbook(JSON.stringify(doc)));
    old.applyFilterView("Sheet1", "Plain");
    expect(old.sheet("Sheet1").tables![0]!.filters).toEqual({ Region: ["west"] });
  });

  it("a view that holds only table filters applies by dropping the sheet's own filter", () => {
    const s = make();
    s.setFilter("Sheet1", null);
    s.filterTable("Sales", "Region", ["north"]);
    const v = s.saveFilterView("Sheet1", "North");
    s.filterTable("Sales", "Region", null);
    s.setFilter("Sheet1", "A1:C6");
    s.filterColumn("Sheet1", 2, ["red"]);
    expect(hidden(s)).toEqual([3, 5, 6]);
    s.applyFilterView("Sheet1", v.id);
    expect(s.sheet("Sheet1").filter).toBeUndefined();
    expect(hidden(s)).toEqual([2, 3, 4, 5]);
  });

  it("a sort that can't be done in a table leaves everything as it was", () => {
    const s = make();
    s.sortTable("Sales", "Qty", "ascending");
    const v = s.saveFilterView("Sheet1", "By qty");
    // the editor refuses a merge inside a table (as Excel does), so the file-borne case is built from the operation
    s.transact([{ type: "add_merge", sheet: s.sheet("Sheet1").id, range: "E3:F3" }]);
    const before = JSON.stringify(s.state.sheets[0]);
    expect(() => s.applyFilterView("Sheet1", v.id)).toThrow(/merged/);
    expect(JSON.stringify(s.state.sheets[0])).toBe(before);
  });

  it("update takes the tables as they are now; rename and delete keep the rest", () => {
    const s = make();
    const v = s.saveFilterView("Sheet1", "Mine");
    s.filterTable("Sales", "Region", ["west"]);
    s.updateFilterView("Sheet1", v.id);
    expect(s.filterViews("Sheet1")[0]!.tables![tableId(s)]).toEqual({ filters: { Region: ["west"] } });
    s.renameFilterView("Sheet1", v.id, "Renamed");
    expect(s.filterViews("Sheet1")[0]!.tables![tableId(s)]).toEqual({ filters: { Region: ["west"] } });
    s.undo();
    s.undo();
    expect(s.filterViews("Sheet1")[0]!.tables).toEqual({});
  });

  it("what a view holds for a table goes when its column or table goes", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    s.filterTable("Sales", "Qty", ["3"]);
    s.saveFilterView("Sheet1", "Two");
    s.deleteColumns("Sheet1", 7, 1); // Qty
    expect(s.filterViews("Sheet1")[0]!.tables![tableId(s)]).toEqual({ filters: { Region: ["east"] } });
    s.undo();
    expect(s.filterViews("Sheet1")[0]!.tables![tableId(s)]!.filters).toEqual({ Region: ["east"], Qty: ["3"] });
    s.deleteColumns("Sheet1", 5, 3);
    // the whole table went; a view that has a sheet filter stays, with nothing for tables
    expect(s.filterViews("Sheet1")[0]!.tables).toEqual({});
  });

  it("a view that only held a table filter goes with its table", () => {
    const s = make();
    s.setFilter("Sheet1", null);
    s.filterTable("Sales", "Region", ["east"]);
    s.saveFilterView("Sheet1", "East");
    s.deleteColumns("Sheet1", 5, 3);
    expect(s.filterViews("Sheet1")).toEqual([]);
  });

  it("a view keeps its table filters when rows are inserted above the table", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    s.saveFilterView("Sheet1", "East");
    s.filterTable("Sales", "Region", null);
    s.insertRows("Sheet1", 1, 2);
    expect(s.filterViews("Sheet1")[0]!.tables![tableId(s)]!.filters).toEqual({ Region: ["east"] });
    expect(s.filterViewRows("Sheet1", "East").hide).toEqual([5, 7, 8]);
  });

  it("round-trips through the saved file and is checked on the way in", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    s.filterTableRule("Sales", "Qty", { kind: "custom", a: { op: "greaterThan", value: 2 } });
    s.sortTable("Sales", "Qty");
    s.filterColumn("Sheet1", 2, ["red"]);
    s.saveFilterView("Sheet1", "East");
    const again = parseWorkbook(serializeWorkbook(s.state));
    expect(again.sheets[0]!.filterViews).toEqual(s.state.sheets[0]!.filterViews);
    const bad = (edit: (v: Record<string, unknown>) => void) => {
      const doc = JSON.parse(serializeWorkbook(s.state));
      edit(doc.workbook.sheets[0].filterViews[0]);
      return () => parseWorkbook(JSON.stringify(doc));
    };
    const id = tableId(s);
    expect(bad((v) => (v.tables = []))).toThrow(/tables/);
    expect(bad((v) => (v.tables = { [id]: { extra: 1 } }))).toThrow(/unknown/);
    expect(bad((v) => (v.tables = { [id]: { filters: { Region: "x" } } }))).toThrow();
    expect(bad((v) => (v.tables = { [id]: { sort: { column: "" } } }))).toThrow(/column name/);
    expect(bad((v) => delete v.range)).toThrow(/needs a range/);
  });

  it("protection: a protected sheet that allows filters can apply a view; looking is always allowed", () => {
    const s = make();
    s.filterTable("Sales", "Region", ["east"]);
    const v = s.saveFilterView("Sheet1", "East");
    s.filterTable("Sales", "Region", null);
    s.protectSheet("Sheet1", { allow: ["autoFilter"] });
    expect(s.filterViewRows("Sheet1", v.id).hide).toEqual([3, 5, 6]);
    s.applyFilterView("Sheet1", v.id);
    expect(s.sheet("Sheet1").tables![0]!.filters).toEqual({ Region: ["east"] });
  });
});
