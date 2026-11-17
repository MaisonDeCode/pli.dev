import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

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
  s.setFilter("Sheet1", "A1:C6");
  return s;
};
const hidden = (s: SheetSession) => Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r)).sort((a, b) => a - b);
const names = (s: SheetSession) => {
  const out: string[] = [];
  for (let r = 2; r <= 6; r++) out.push(String(s.value("Sheet1", `A${r}`)));
  return out;
};

describe("filter views: the list", () => {
  it("saves the sheet's filter under a name, and refuses without a filter or with a bad or repeated name", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    const v = s.saveFilterView("Sheet1", "  Reds ");
    expect(v).toMatchObject({ name: "Reds", range: "A1:C6", columns: { B: ["red"] } });
    expect(s.filterViews("Sheet1")).toHaveLength(1);
    expect(() => s.saveFilterView("Sheet1", "reds")).toThrow(/already a view called/);
    expect(() => s.saveFilterView("Sheet1", "   ")).toThrow(/needs a name/);
    expect(() => s.saveFilterView("Sheet1", "x".repeat(81))).toThrow(/at most 80/);
    s.setFilter("Sheet1", null);
    expect(() => s.saveFilterView("Sheet1", "None")).toThrow(/no filter/);
    // the saved copy does not follow later changes to the sheet's filter
    s.setFilter("Sheet1", "A1:C6");
    s.filterColumn("Sheet1", 2, ["blue"]);
    expect(s.filterViews("Sheet1")[0]!.columns).toEqual({ B: ["red"] });
  });

  it("renames, updates from the current filter, and deletes; every step undoes", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    const v = s.saveFilterView("Sheet1", "Reds");
    s.undo();
    expect(s.filterViews("Sheet1")).toEqual([]);
    s.redo();
    s.renameFilterView("Sheet1", v.id, "Red team");
    expect(s.filterViews("Sheet1")[0]!.name).toBe("Red team");
    expect(() => s.renameFilterView("Sheet1", v.id, "")).toThrow();
    s.saveFilterView("Sheet1", "Other");
    expect(() => s.renameFilterView("Sheet1", v.id, "OTHER")).toThrow(/already/);
    s.filterColumn("Sheet1", 2, ["blue"]);
    s.updateFilterView("Sheet1", "Red team", { sort: { column: 3, descending: true } }); // found by name too
    expect(s.filterViews("Sheet1")[0]).toMatchObject({ columns: { B: ["blue"] }, sort: { column: "C", descending: true } });
    s.undo();
    expect(s.filterViews("Sheet1")[0]!.columns).toEqual({ B: ["red"] });
    s.deleteFilterView("Sheet1", v.id);
    expect(s.filterViews("Sheet1").map((x) => x.name)).toEqual(["Other"]);
    s.undo();
    expect(s.filterViews("Sheet1")).toHaveLength(2);
    expect(() => s.deleteFilterView("Sheet1", "nope")).toThrow(/no view/);
    expect(() => s.saveFilterView("Sheet1", "Sorted", { sort: { column: 9 } })).toThrow(/outside/);
  });

  it("a sort stays when the view is updated without saying, and goes with null", () => {
    const s = make();
    const v = s.saveFilterView("Sheet1", "By amount", { sort: { column: 3 } });
    expect(v.sort).toEqual({ column: "C" });
    s.updateFilterView("Sheet1", v.id);
    expect(s.filterViews("Sheet1")[0]!.sort).toEqual({ column: "C" });
    s.updateFilterView("Sheet1", v.id, { sort: null });
    expect(s.filterViews("Sheet1")[0]!.sort).toBeUndefined();
  });

  it("is limited to 100 views a sheet", () => {
    const s = make();
    for (let i = 0; i < 100; i++) s.saveFilterView("Sheet1", `V${i}`);
    expect(() => s.saveFilterView("Sheet1", "one more")).toThrow(/at most 100/);
  });
});

describe("filter views: showing one without changing the sheet", () => {
  it("says which rows to hide and show compared with what the sheet shows, and changes nothing", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.saveFilterView("Sheet1", "Reds");
    s.filterColumn("Sheet1", 2, ["blue"]);
    s.saveFilterView("Sheet1", "Blues");
    s.filterColumn("Sheet1", 2, null);
    s.filterColumnRule("Sheet1", 3, { kind: "custom", a: { op: "greaterThan", value: 15 } });
    expect(hidden(s)).toEqual([3, 6]);
    const before = JSON.stringify(s.state);
    // Bo (3) and Ed (6) are hidden by the sheet's own filter (amounts of 15 or less). The Reds view hides every row that isn't red:
    // Bo and Ed are hidden already, so only Di (5) is new.
    expect(s.filterViewRows("Sheet1", "Reds")).toEqual({ hide: [5], show: [] });
    // The Blues view hides Ann, Cy (red) and Ed (green) and shows Bo.
    expect(s.filterViewRows("Sheet1", "Blues")).toEqual({ hide: [2, 4], show: [3] });
    expect(JSON.stringify(s.state)).toBe(before);
  });

  it("with no filter on the sheet, a view hides what it filters", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["green"]);
    const v = s.saveFilterView("Sheet1", "Green");
    s.setFilter("Sheet1", null);
    expect(hidden(s)).toEqual([]);
    expect(s.filterViewRows("Sheet1", v.id)).toEqual({ hide: [2, 3, 4, 5], show: [] });
  });

  it("rows the person hid by hand are not shown by a view, and a view hides the others", () => {
    const s = make();
    s.setFilter("Sheet1", null);
    s.setFilter("Sheet1", "A1:C6");
    s.filterColumn("Sheet1", 2, ["red"]);
    const v = s.saveFilterView("Sheet1", "Reds");
    s.setFilter("Sheet1", null);
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "row", index: 2, hidden: true }]);
    expect(s.filterViewRows("Sheet1", v.id).hide).toEqual([3, 5, 6]);
    expect(s.filterViewRows("Sheet1", v.id).show).toEqual([]);
  });
});

describe("filter views: applying one for everyone", () => {
  it("makes it the sheet's filter, hides the rows to match, and undoes in one step", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    const reds = s.saveFilterView("Sheet1", "Reds");
    s.filterColumn("Sheet1", 2, null);
    s.filterColumnRule("Sheet1", 3, { kind: "custom", a: { op: "greaterThan", value: 15 } });
    expect(hidden(s)).toEqual([3, 6]);
    s.applyFilterView("Sheet1", reds.id);
    expect(s.sheet("Sheet1").filter).toEqual({ range: "A1:C6", columns: { B: ["red"] } });
    expect(hidden(s)).toEqual([3, 5, 6]);
    s.undo();
    expect(s.sheet("Sheet1").filter!.columns).toEqual({ C: { kind: "custom", a: { op: "greaterThan", value: 15 } } });
    expect(hidden(s)).toEqual([3, 6]);
    s.redo();
    expect(hidden(s)).toEqual([3, 5, 6]);
  });

  it("applies a view on a different range: the rows of the old range come back", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.setFilter("Sheet1", "A1:C3");
    s.filterColumn("Sheet1", 2, ["blue"]);
    const small = s.saveFilterView("Sheet1", "Small");
    s.setFilter("Sheet1", "A1:C6");
    s.filterColumn("Sheet1", 2, ["red"]);
    expect(hidden(s)).toEqual([3, 5, 6]);
    s.applyFilterView("Sheet1", small.id);
    expect(s.sheet("Sheet1").filter!.range).toBe("A1:C3");
    expect(hidden(s)).toEqual([2]);
  });

  it("with a sort, sorts the data and hides rows by the sorted data, still one undo step", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red", "blue"]);
    const v = s.saveFilterView("Sheet1", "Big first", { sort: { column: 3, descending: true } });
    s.filterColumn("Sheet1", 2, null);
    s.applyFilterView("Sheet1", v.id);
    expect(names(s)).toEqual(["Di", "Ann", "Cy", "Bo", "Ed"]);
    expect(hidden(s)).toEqual([6]); // Ed is green and now last
    s.undo();
    expect(names(s)).toEqual(["Ann", "Bo", "Cy", "Di", "Ed"]);
    expect(hidden(s)).toEqual([]);
    s.redo();
    expect(names(s)).toEqual(["Di", "Ann", "Cy", "Bo", "Ed"]);
  });

  it("a sort that can't be done leaves the sheet as it was", () => {
    const s = make();
    const v = s.saveFilterView("Sheet1", "Sorted", { sort: { column: 3 } });
    s.mergeCells("Sheet1", "A2:B2");
    const before = JSON.stringify(s.state.sheets[0]);
    expect(() => s.applyFilterView("Sheet1", v.id)).toThrow(/merged/);
    expect(JSON.stringify(s.state.sheets[0])).toBe(before);
  });
});

describe("filter views: inserting and deleting rows and columns", () => {
  it("a view follows its range when rows are inserted above it or inside it", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.saveFilterView("Sheet1", "Reds");
    s.insertRows("Sheet1", 1, 2);
    expect(s.filterViews("Sheet1")[0]!.range).toBe("A3:C8");
    s.insertRows("Sheet1", 5, 1);
    expect(s.filterViews("Sheet1")[0]!.range).toBe("A3:C9");
  });

  it("columns move the criteria with them, and criteria on a deleted column are forgotten; the sort goes with its column", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.filterColumn("Sheet1", 3, ["30"]);
    s.saveFilterView("Sheet1", "Both", { sort: { column: 3 } });
    s.insertColumns("Sheet1", 1, 1);
    expect(s.filterViews("Sheet1")[0]).toMatchObject({ range: "B1:D6", columns: { C: ["red"], D: ["30"] }, sort: { column: "D" } });
    s.deleteColumns("Sheet1", 4, 1);
    const v = s.filterViews("Sheet1")[0]!;
    expect(v.columns).toEqual({ C: ["red"] });
    expect(v.sort).toBeUndefined();
  });

  it("a view whose range is deleted goes, and so does one cut down to a single row", () => {
    const s = make();
    s.saveFilterView("Sheet1", "All");
    s.deleteRows("Sheet1", 2, 5);
    expect(s.filterViews("Sheet1")).toEqual([]);
    const t = make();
    t.saveFilterView("Sheet1", "All");
    t.deleteRows("Sheet1", 1, 6);
    expect(t.filterViews("Sheet1")).toEqual([]);
  });
});

describe("filter views: protection, saving, and files", () => {
  it("on a protected sheet that doesn't allow filters, the list can't be changed; where it does, it can", () => {
    const s = make();
    s.saveFilterView("Sheet1", "Mine");
    s.protectSheet("Sheet1");
    expect(() => s.saveFilterView("Sheet1", "More")).toThrow(/protected/);
    expect(() => s.deleteFilterView("Sheet1", "Mine")).toThrow(/protected/);
    expect(s.filterViewRows("Sheet1", "Mine")).toEqual({ hide: [], show: [] }); // looking is always allowed
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["autoFilter"] });
    s.saveFilterView("Sheet1", "More");
    expect(s.filterViews("Sheet1")).toHaveLength(2);
  });

  it("round-trips through the saved file and is checked on the way in", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.saveFilterView("Sheet1", "Reds", { sort: { column: 3 } });
    const again = parseWorkbook(serializeWorkbook(s.state));
    expect(again.sheets[0]!.filterViews).toEqual(s.state.sheets[0]!.filterViews);
    const bad = (edit: (v: Record<string, unknown>) => void) => {
      const doc = JSON.parse(serializeWorkbook(s.state));
      edit(doc.workbook.sheets[0].filterViews[0]);
      return () => parseWorkbook(JSON.stringify(doc));
    };
    expect(bad((v) => (v.range = "A1"))).toThrow(/two rows/);
    expect(bad((v) => (v.columns = { H: ["x"] }))).toThrow(/outside/);
    expect(bad((v) => (v.sort = { column: "Z" }))).toThrow(/inside its range/);
    expect(bad((v) => (v.extra = 1))).toThrow();
    expect(bad((v) => (v.name = ""))).toThrow(/needs a name/);
  });

  it("an XLSX file holds the filter in force as an ordinary autofilter, and the views as Excel's named sheet views", () => {
    const s = make();
    s.filterColumn("Sheet1", 2, ["red"]);
    s.saveFilterView("Sheet1", "Reds");
    s.filterColumn("Sheet1", 2, ["blue"]);
    s.saveFilterView("Sheet1", "Blues");
    s.applyFilterView("Sheet1", "Reds");
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!;
    expect(back.filter).toEqual({ range: "A1:C6", columns: { B: ["red"] } });
    expect(back.filterViews!.map((v) => [v.name, v.range, v.columns])).toEqual([["Reds", "A1:C6", { B: ["red"] }], ["Blues", "A1:C6", { B: ["blue"] }]]);
    expect(Object.entries(back.rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r))).toEqual([3, 5, 6]);
  });
});
