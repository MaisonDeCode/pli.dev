import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook, type FilterRule } from "../src";

// 45000 is 2023-03-15, a Wednesday.
const TODAY = 45_000;
const make = () => {
  const s = new SheetSession(createWorkbook("Filters", ["Sheet1"]), { now: () => TODAY + 0.5 });
  s.setValues("Sheet1", "A1", [
    ["Name", "Amount", "Day"],
    ["Apple pie", 10, TODAY],
    ["apple tart", 25, TODAY - 1],
    ["Banana", 7, TODAY + 1],
    ["Cherry pie", 40, TODAY - 10],
    ["Pear", null, TODAY - 40],
    ["Plum pie", 25, TODAY - 400],
    ["Fig", 3, TODAY + 40],
  ]);
  s.setFormat("Sheet1", "C2:C8", "yyyy-mm-dd");
  s.setFilter("Sheet1", "A1:C8");
  return s;
};
/** The names in the rows the filter lets through. */
const shown = (s: SheetSession, col = "A") => {
  const out: string[] = [];
  for (let r = 2; r <= 8; r++) if (!s.sheet("Sheet1").rows?.[String(r)]?.hidden) out.push(String(s.value("Sheet1", `${col}${r}`) ?? ""));
  return out;
};
const rule = (s: SheetSession, col: number, r: FilterRule) => s.filterColumnRule("Sheet1", col, r);

describe("filters by condition", () => {
  it("text: contains, begins, ends, equals with wildcards, and their opposites, without regard to capitals", () => {
    const s = make();
    rule(s, 1, { kind: "custom", a: { op: "contains", value: "PIE" } });
    expect(shown(s)).toEqual(["Apple pie", "Cherry pie", "Plum pie"]);
    rule(s, 1, { kind: "custom", a: { op: "beginsWith", value: "apple" } });
    expect(shown(s)).toEqual(["Apple pie", "apple tart"]);
    rule(s, 1, { kind: "custom", a: { op: "endsWith", value: "ie" } });
    expect(shown(s)).toEqual(["Apple pie", "Cherry pie", "Plum pie"]);
    rule(s, 1, { kind: "custom", a: { op: "notContains", value: "pie" } });
    expect(shown(s)).toEqual(["apple tart", "Banana", "Pear", "Fig"]);
    rule(s, 1, { kind: "custom", a: { op: "equals", value: "?ig" } });
    expect(shown(s)).toEqual(["Fig"]);
    rule(s, 1, { kind: "custom", a: { op: "equals", value: "b*a*a" } });
    expect(shown(s)).toEqual(["Banana"]);
    rule(s, 1, { kind: "custom", a: { op: "notEquals", value: "*pie" } });
    expect(shown(s)).toEqual(["apple tart", "Banana", "Pear", "Fig"]);
  });

  it("numbers: comparisons, between (two joined by and), either (joined by or), empty cells", () => {
    const s = make();
    rule(s, 2, { kind: "custom", a: { op: "greaterThan", value: 10 } });
    expect(shown(s)).toEqual(["apple tart", "Cherry pie", "Plum pie"]);
    rule(s, 2, { kind: "custom", a: { op: "greaterThanOrEqual", value: "10" }, b: { op: "lessThan", value: 40 } });
    expect(shown(s)).toEqual(["Apple pie", "apple tart", "Plum pie"]);
    rule(s, 2, { kind: "custom", a: { op: "lessThan", value: 5 }, b: { op: "greaterThan", value: 30 }, or: true });
    expect(shown(s)).toEqual(["Cherry pie", "Fig"]);
    rule(s, 2, { kind: "custom", a: { op: "equals", value: 25 } });
    expect(shown(s)).toEqual(["apple tart", "Plum pie"]);
    rule(s, 2, { kind: "custom", a: { op: "notEquals", value: 25 } });
    expect(shown(s)).toEqual(["Apple pie", "Banana", "Cherry pie", "Pear", "Fig"]);
    rule(s, 2, { kind: "custom", a: { op: "blank" } });
    expect(shown(s)).toEqual(["Pear"]);
    rule(s, 2, { kind: "custom", a: { op: "notBlank" } });
    expect(shown(s)).toEqual(["Apple pie", "apple tart", "Banana", "Cherry pie", "Plum pie", "Fig"]);
    rule(s, 2, { kind: "custom", a: { op: "lessThanOrEqual", value: 7 } });
    expect(shown(s)).toEqual(["Banana", "Fig"]);
  });

  it("dates compare as dates, whether typed as a date or a number", () => {
    const s = make();
    rule(s, 3, { kind: "custom", a: { op: "greaterThan", value: "2023-03-15" } });
    expect(shown(s)).toEqual(["Banana", "Fig"]);
    rule(s, 3, { kind: "custom", a: { op: "lessThanOrEqual", value: TODAY - 10 } });
    expect(shown(s)).toEqual(["Cherry pie", "Pear", "Plum pie"]);
  });

  it("top and bottom: items or percent, with ties coming along", () => {
    const s = make();
    rule(s, 2, { kind: "top", n: 2 });
    expect(shown(s)).toEqual(["apple tart", "Cherry pie", "Plum pie"]);
    rule(s, 2, { kind: "top", n: 1 });
    expect(shown(s)).toEqual(["Cherry pie"]);
    rule(s, 2, { kind: "top", n: 2, bottom: true });
    expect(shown(s)).toEqual(["Banana", "Fig"]);
    rule(s, 2, { kind: "top", n: 50, percent: true });
    expect(shown(s)).toEqual(["apple tart", "Cherry pie", "Plum pie"]);
    rule(s, 2, { kind: "top", n: 1, percent: true });
    expect(shown(s)).toEqual(["Cherry pie"]);
  });

  it("above and below the average of the numbers in the column", () => {
    const s = make();
    // 10, 25, 7, 40, 25, 3: the average is 18.33.
    rule(s, 2, { kind: "average" });
    expect(shown(s)).toEqual(["apple tart", "Cherry pie", "Plum pie"]);
    rule(s, 2, { kind: "average", below: true });
    expect(shown(s)).toEqual(["Apple pie", "Banana", "Fig"]);
  });

  it("dates in a period counted from today, and the quarter or month of any year", () => {
    const s = make();
    const day = (p: FilterRule) => {
      rule(s, 3, p);
      return shown(s);
    };
    expect(day({ kind: "date", period: "today" })).toEqual(["Apple pie"]);
    expect(day({ kind: "date", period: "yesterday" })).toEqual(["apple tart"]);
    expect(day({ kind: "date", period: "tomorrow" })).toEqual(["Banana"]);
    // Sunday 12 March to Saturday 18 March.
    expect(day({ kind: "date", period: "thisWeek" })).toEqual(["Apple pie", "apple tart", "Banana"]);
    expect(day({ kind: "date", period: "thisMonth" })).toEqual(["Apple pie", "apple tart", "Banana", "Cherry pie"]);
    expect(day({ kind: "date", period: "lastMonth" })).toEqual(["Pear"]);
    expect(day({ kind: "date", period: "thisQuarter" })).toEqual(["Apple pie", "apple tart", "Banana", "Cherry pie", "Pear"]);
    expect(day({ kind: "date", period: "thisYear" })).toEqual(["Apple pie", "apple tart", "Banana", "Cherry pie", "Pear", "Fig"]);
    expect(day({ kind: "date", period: "lastYear" })).toEqual(["Plum pie"]);
    expect(day({ kind: "date", period: "yearToDate" })).toEqual(["Apple pie", "apple tart", "Cherry pie", "Pear"]);
    expect(day({ kind: "date", period: "q1" })).toEqual(["Apple pie", "apple tart", "Banana", "Cherry pie", "Pear", "Plum pie"]);
    expect(day({ kind: "date", period: "m2" })).toEqual(["Pear", "Plum pie"]);
    expect(day({ kind: "date", period: "m4" })).toEqual(["Fig"]);
  });

  it("colours: a fill, no fill, a font colour", () => {
    const s = make();
    s.setStyle("Sheet1", "A2:A3", { fill: "#ffff00" });
    s.setStyle("Sheet1", "A4", { fill: "#ff0000", color: "#0000ff" });
    rule(s, 1, { kind: "color", fill: "#FFFF00" });
    expect(shown(s)).toEqual(["Apple pie", "apple tart"]);
    expect(s.sheet("Sheet1").filter!.columns!["A"]).toEqual({ kind: "color", fill: "#ffff00" });
    rule(s, 1, { kind: "color", fill: "none" });
    expect(shown(s)).toEqual(["Cherry pie", "Pear", "Plum pie", "Fig"]);
    rule(s, 1, { kind: "color", font: "#0000ff" });
    expect(shown(s)).toEqual(["Banana"]);
    rule(s, 1, { kind: "color", font: "auto" });
    expect(shown(s)).toEqual(["Apple pie", "apple tart", "Cherry pie", "Pear", "Plum pie", "Fig"]);
  });

  it("works with a list in another column, replaces a list in the same column, and undoes in one step", () => {
    const s = make();
    s.filterColumn("Sheet1", 1, ["Apple pie", "apple tart", "Banana"]);
    rule(s, 2, { kind: "custom", a: { op: "greaterThan", value: 8 } });
    expect(shown(s)).toEqual(["Apple pie", "apple tart"]);
    rule(s, 1, { kind: "custom", a: { op: "contains", value: "pie" } });
    expect(shown(s)).toEqual(["Apple pie", "Cherry pie", "Plum pie"]);
    s.undo();
    expect(shown(s)).toEqual(["Apple pie", "apple tart"]);
    s.filterColumn("Sheet1", 1, ["Fig"]);
    expect(s.sheet("Sheet1").filter!.columns!["A"]).toEqual(["Fig"]);
    s.filterColumnRule("Sheet1", 2, null);
    s.filterColumn("Sheet1", 1, null);
    expect(shown(s)).toHaveLength(7);
    expect(s.sheet("Sheet1").filter!.columns).toBeUndefined();
  });

  it("is applied again to changed cells, and a changed average moves the line", () => {
    const s = make();
    rule(s, 2, { kind: "average" });
    s.setCell("Sheet1", "B5", 1000);
    s.reapplyFilter("Sheet1");
    expect(shown(s)).toEqual(["Cherry pie"]);
    s.setCell("Sheet1", "B5", 40);
    s.setCell("Sheet1", "B2", 500);
    s.reapplyFilter("Sheet1");
    expect(shown(s)).toEqual(["Apple pie"]);
  });

  it("says what is wrong with a rule", () => {
    const s = make();
    const bad = (r: unknown) => () => rule(s, 1, r as FilterRule);
    expect(bad({ kind: "custom", a: { op: "bigger", value: 1 } })).toThrow(/compares with one of/);
    expect(bad({ kind: "custom", a: { op: "equals" } })).toThrow(/needs a value/);
    expect(bad({ kind: "top", n: 0 })).toThrow(/whole number/);
    expect(bad({ kind: "top", n: 101, percent: true })).toThrow(/1 to 100/);
    expect(bad({ kind: "date", period: "someday" })).toThrow(/names one of/);
    expect(bad({ kind: "color" })).toThrow(/fill colour or a font colour/);
    expect(bad({ kind: "color", fill: "red" })).toThrow(/#rrggbb/);
    expect(bad({ kind: "mystery" })).toThrow(/kind is/);
    expect(() => s.filterColumnRule("Sheet1", 9, { kind: "average" })).toThrow(/outside the filter/);
    expect(shown(s)).toHaveLength(7);
  });

  it("is saved with the workbook, and follows its column when columns are inserted", () => {
    const s = make();
    rule(s, 2, { kind: "custom", a: { op: "greaterThan", value: 5 }, b: { op: "lessThan", value: 30 }, or: true });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.filter).toEqual(s.state.sheets[0]!.filter);
    expect(() => parseWorkbook(serializeWorkbook(s.state).replace('"op":"greaterThan"', '"op":"nonsense"'))).toThrow(/compares with one of/);
    s.insertColumns("Sheet1", 1);
    expect(Object.keys(s.sheet("Sheet1").filter!.columns!)).toEqual(["C"]);
    expect(s.sheet("Sheet1").filter!.range).toBe("B1:D8");
  });
});

describe("tables filtered by condition", () => {
  const table = () => {
    const s = make();
    s.setFilter("Sheet1", null);
    s.createTable("Sheet1", "A1:C8", { name: "Fruit" });
    return s;
  };
  it("hides rows by a rule, together with other columns' lists and rules", () => {
    const s = table();
    s.filterTableRule("Fruit", "Amount", { kind: "custom", a: { op: "greaterThanOrEqual", value: 10 } });
    expect(shown(s)).toEqual(["Apple pie", "apple tart", "Cherry pie", "Plum pie"]);
    s.filterTableRule("Fruit", "Name", { kind: "custom", a: { op: "endsWith", value: "pie" } });
    expect(shown(s)).toEqual(["Apple pie", "Cherry pie", "Plum pie"]);
    s.filterTable("Fruit", "Day", [s.display("Sheet1", "C2").text]);
    expect(shown(s)).toEqual(["Apple pie"]);
    expect(Object.keys(s.tables("Sheet1")[0]!.filters!)).toEqual(["Amount", "Name", "Day"]);
    s.undo();
    s.undo();
    expect(shown(s)).toEqual(["Apple pie", "apple tart", "Cherry pie", "Plum pie"]);
    s.clearTableFilters("Fruit");
    expect(shown(s)).toHaveLength(7);
  });

  it("keeps a rule when its column is renamed, and drops it when the column goes", () => {
    const s = table();
    s.filterTableRule("Fruit", "Amount", { kind: "top", n: 1 });
    s.setCell("Sheet1", "B1", "Total");
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Total: { kind: "top", n: 1 } });
    s.deleteColumns("Sheet1", 2);
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
  });

  it("lets a slicer see the other columns' rules, and shows a rule on its own column as everything let through", () => {
    const s = table();
    s.addSlicer("Sheet1", { table: "Fruit", column: "Name" });
    const id = s.sheet("Sheet1").slicers![0]!.id;
    s.filterTableRule("Fruit", "Amount", { kind: "custom", a: { op: "greaterThan", value: 20 } });
    const items = s.slicerItems(id);
    expect(items.filter((i) => i.available).map((i) => i.value).sort()).toEqual(["Cherry pie", "Plum pie", "apple tart"].sort());
    expect(items.every((i) => i.selected)).toBe(true);
    s.filterTableRule("Fruit", "Name", { kind: "custom", a: { op: "contains", value: "pie" } });
    expect(s.slicerItems(id).every((i) => i.selected)).toBe(true);
    s.slicerSelect(id, ["Fig"]);
    expect(s.tables("Sheet1")[0]!.filters!["Name"]).toEqual(["Fig"]);
  });
});
