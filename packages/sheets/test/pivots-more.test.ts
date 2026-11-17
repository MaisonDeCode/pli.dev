import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook } from "../src";
import type { PivotAxisField, PivotValue } from "../src";
import { dateSerial } from "../src/values";

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
const shown = (s: SheetSession, range: string) => s.values("Pivot", range).map((r) => r.map((v) => (v === null ? "" : typeof v === "object" ? v.error : String(v))));
const pivot = (s: SheetSession, spec: { rows?: (string | PivotAxisField)[]; columns?: (string | PivotAxisField)[]; values?: (string | PivotValue)[] } & Record<string, unknown>) =>
  s.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", ...spec } as never);
const colOf = (s: SheetSession, range: string, col: number) => shown(s, range).map((r) => r[col]);
/** Where the pivot table is now (the object `createPivot` gave back is as it was then). */
const now = (s: SheetSession) => s.pivots("Pivot")[0]!.range;

describe("sorting by a value", () => {
  it("orders the items by what they come to", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", sortBy: { value: 0, descending: true } }], values: ["Sales"] });
    expect(colOf(s, p.range, 0)).toEqual(["Row Labels", "East", "West", "North", "Grand Total"]);
    s.updatePivot("Pivot", p.id, { rows: [{ field: "Region", sortBy: { value: 0 } }] });
    expect(colOf(s, now(s), 0)).toEqual(["Row Labels", "North", "West", "East", "Grand Total"]);
  });

  it("sorts inner items within the item they are inside, and column items by their totals", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region", { field: "Product", sortBy: { value: 0, descending: true } }], values: ["Sales"], tabular: true });
    expect(shown(s, p.range).map((r) => r.slice(0, 2).join("/"))).toEqual(["Region/Product", "East/Apple", "/Pear", "East Total/", "North/Plum", "North Total/", "West/Apple", "/Pear", "West Total/", "Grand Total/"]);
    const q = pivot(make(), { rows: ["Region"], columns: [{ field: "Product", sortBy: { value: 0, descending: true } }], values: ["Sales"] });
    expect(q.range).toBe("A1:E6");
  });

  it("keeps the order by value when the data changes and the pivot table is refreshed", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", sortBy: { value: 0, descending: true } }], values: ["Sales"] });
    s.setCell("Data", "D5", 500);
    s.refreshPivot("Pivot", p.id);
    expect(colOf(s, p.range, 0).slice(1, 4)).toEqual(["West", "East", "North"]);
  });

  it("refuses a value that isn't there", () => {
    const s = make();
    expect(() => pivot(s, { rows: [{ field: "Region", sortBy: { value: 3 } }], values: ["Sales"] })).toThrow(/sorted by a value that isn't there/);
  });
});

describe("filters on items", () => {
  it("keeps the top items, and the totals count only those", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", filter: { kind: "top", by: 0, n: 2 } }], values: ["Sales"] });
    expect(shown(s, p.range)).toEqual([["Row Labels", "Sum of Sales"], ["East", "160"], ["West", "103"], ["Grand Total", "263"]]);
  });

  it("keeps the bottom items", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", filter: { kind: "top", by: 0, n: 1, bottom: true } }], values: ["Sales"] });
    expect(colOf(s, p.range, 0)).toEqual(["Row Labels", "North", "Grand Total"]);
  });

  it("keeps the items that make up a share, or an amount, of the whole", () => {
    const s = make();
    const share = pivot(s, { rows: [{ field: "Region", filter: { kind: "top", by: 0, n: 50, unit: "percent" } }], values: ["Sales"] });
    expect(colOf(s, share.range, 0).slice(1, -1)).toEqual(["East"]);
    s.updatePivot("Pivot", share.id, { rows: [{ field: "Region", filter: { kind: "top", by: 0, n: 250, unit: "sum" } }] });
    expect(colOf(s, now(s), 0).slice(1, -1)).toEqual(["East", "West"]);
  });

  it("keeps the top items inside each outer item", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region", { field: "Product", filter: { kind: "top", by: 0, n: 1 } }], values: ["Sales"], tabular: true });
    expect(shown(s, p.range).map((r) => r.slice(0, 3).join("/"))).toEqual(["Region/Product/Sum of Sales", "East/Apple/120", "East Total//120", "North/Plum/44", "North Total//44", "West/Apple/70", "West Total//70", "Grand Total//234"]);
  });

  it("filters by what an item comes to", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", filter: { kind: "value", by: 0, a: { op: "greaterThan", value: 50 }, b: { op: "lessThan", value: 150 } } }], values: ["Sales"] });
    expect(colOf(s, p.range, 0)).toEqual(["Row Labels", "West", "Grand Total"]);
  });

  it("filters by the text of the items", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", filter: { kind: "label", a: { op: "beginsWith", value: "w" } } }], values: ["Sales"] });
    expect(shown(s, p.range)).toEqual([["Row Labels", "Sum of Sales"], ["West", "103"], ["Grand Total", "103"]]);
    s.updatePivot("Pivot", p.id, { rows: [{ field: "Region", filter: { kind: "label", a: { op: "contains", value: "st" }, b: { op: "equals", value: "North" }, or: true } }] });
    expect(colOf(s, now(s), 0)).toEqual(["Row Labels", "East", "North", "West", "Grand Total"]);
  });

  it("filters the column items too", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: [{ field: "Product", filter: { kind: "top", by: 0, n: 1 } }], values: ["Sales"] });
    expect(shown(s, p.range)[1]).toEqual(["Row Labels", "Apple", "Grand Total"]);
  });

  it("refuses a filter by a value that isn't there", () => {
    const s = make();
    expect(() => pivot(s, { rows: [{ field: "Region", filter: { kind: "top", by: 2, n: 1 } }], values: ["Sales"] })).toThrow(/names one of the 1 values/);
  });
});

describe("values down the rows", () => {
  it("lists each value under its item in the compact layout", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales", "Qty"], valuesOnRows: true });
    expect(shown(s, p.range)).toEqual([
      ["Row Labels", "Total"],
      ["East", ""],
      ["Sum of Sales", "160"],
      ["Sum of Qty", "17"],
      ["North", ""],
      ["Sum of Sales", "44"],
      ["Sum of Qty", "4"],
      ["West", ""],
      ["Sum of Sales", "103"],
      ["Sum of Qty", "10"],
      ["Total Sum of Sales", "307"],
      ["Total Sum of Qty", "31"],
    ]);
    expect(s.cell("Pivot", "A3")?.s?.indent).toBe(1);
  });

  it("puts the value names in a column of their own in the tabular layout, with the columns across", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: ["Sales", "Qty"], valuesOnRows: true, tabular: true });
    expect(shown(s, p.range).slice(0, 4)).toEqual([
      ["", "", "Product", "", "", ""],
      ["Region", "Values", "Apple", "Pear", "Plum", "Grand Total"],
      ["East", "Sum of Sales", "120", "40", "", "160"],
      ["", "Sum of Qty", "12", "5", "", "17"],
    ]);
  });

  it("is ignored with a single value", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"], valuesOnRows: true });
    expect(p.range).toBe("A1:B5");
  });
});

describe("layouts", () => {
  it("outline form has a column for each field and the subtotal on the outer item's own line", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region", "Product"], values: ["Sales"], outline: true });
    expect(shown(s, p.range)).toEqual([
      ["Region", "Product", "Sum of Sales"],
      ["East", "", "160"],
      ["", "Apple", "120"],
      ["", "Pear", "40"],
      ["North", "", "44"],
      ["", "Plum", "44"],
      ["West", "", "103"],
      ["", "Apple", "70"],
      ["", "Pear", "33"],
      ["Grand Total", "", "307"],
    ]);
    expect(s.cell("Pivot", "A2")?.s?.bold).toBe(true);
  });

  it("choosing one layout lets go of another", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region", "Product"], values: ["Sales"], outline: true });
    s.updatePivot("Pivot", p.id, { tabular: true });
    expect(s.pivots("Pivot")[0]!.outline).toBeUndefined();
    expect(s.pivots("Pivot")[0]!.tabular).toBe(true);
    expect(() => s.createPivot("Pivot", { name: "Two", source: "Data!A1:D7", anchor: "H1", rows: ["Region"], values: ["Sales"] , ...{ tabular: true } } as never)).not.toThrow();
  });

  it("repeats the outer labels when asked", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region", "Product"], values: ["Sales"], tabular: true, repeatLabels: true });
    expect(colOf(s, p.range, 0).slice(0, 4)).toEqual(["Region", "East", "East", "East Total"]);
  });

  it("leaves a blank line after the items of a field", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", blankRow: true }], values: ["Sales"], tabular: true });
    expect(shown(s, p.range)).toEqual([["Region", "Sum of Sales"], ["East", "160"], ["", ""], ["North", "44"], ["", ""], ["West", "103"], ["", ""], ["Grand Total", "307"]]);
  });
});

describe("more ways to show a value", () => {
  const sales = (showAs: PivotValue["showAs"]): PivotValue => ({ field: "Sales", showAs });
  it("difference from the previous item", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: [sales("differenceFromPrevious")] });
    expect(shown(s, p.range)).toEqual([
      ["Sum of Sales", "Column Labels", "", "", ""],
      ["Row Labels", "Apple", "Pear", "Plum", "Grand Total"],
      // An item with no records counts as zero beside the one before it, as in Excel.
      ["East", "", "-80", "-40", ""],
      ["North", "", "", "44", ""],
      ["West", "", "-37", "-33", ""],
      ["Grand Total", "", "-117", "-29", ""],
    ]);
  });

  it("percent difference from the previous item", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: [sales("percentDifferenceFromPrevious")] });
    expect(s.value("Pivot", "C3")).toBeCloseTo(-80 / 120, 10);
    expect(s.cell("Pivot", "C3")?.fmt).toBe("0.00%");
    void p;
  });

  it("running total along the columns, or along the rows when there are no columns", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: [sales("runningTotal")] });
    expect(shown(s, p.range).slice(2, 4)).toEqual([["East", "120", "160", "160", ""], ["North", "0", "0", "44", ""]]);
    const t = make();
    const r = pivot(t, { rows: ["Region"], values: [sales("runningTotal")] });
    expect(colOf(t, r.range, 1)).toEqual(["Sum of Sales", "160", "204", "307", ""]);
  });

  it("rank", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: [sales("rankDescending")] });
    expect(colOf(s, p.range, 1)).toEqual(["Sum of Sales", "1", "3", "2", ""]);
    s.updatePivot("Pivot", p.id, { values: [sales("rankAscending")] });
    expect(colOf(s, now(s), 1)).toEqual(["Sum of Sales", "3", "1", "2", ""]);
  });

  it("difference from a chosen item, a percent of it, and the next item", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs: "differenceFrom", base: { field: "Product", item: "Apple" } }] });
    // Apple is blank (the item compared with); an item with no records counts as zero beside Apple's, and where neither has any it is blank.
    expect(shown(s, p.range).slice(2)).toEqual([["East", "", "-80", "-120", ""], ["North", "", "", "44", ""], ["West", "", "-37", "-70", ""], ["Grand Total", "", "-117", "-146", ""]]);
    s.updatePivot("Pivot", p.id, { values: [{ field: "Sales", showAs: "percentOf", base: { field: "Product", item: "Apple" } }] });
    expect(s.value("Pivot", "B3")).toBe(1);
    expect(s.value("Pivot", "C3")).toBeCloseTo(40 / 120, 10);
    expect(s.cell("Pivot", "C3")?.fmt).toBe("0.00%");
    s.updatePivot("Pivot", p.id, { values: [{ field: "Sales", showAs: "percentDifferenceFrom", base: { field: "Product", item: { step: "next" } } }] });
    expect(s.value("Pivot", "B3")).toBeCloseTo((120 - 40) / 40, 10);
  });

  it("runs along a field of the rows even when there are columns, and a percent running total ends at 100%", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs: "differenceFrom", base: { field: "Region", item: "East" } }] });
    // Apple: East 120, West 70 (North has none): West is 70 - 120.
    expect(s.value("Pivot", "B5")).toBe(-50);
    expect(s.value("Pivot", "B3")).toBe(null);
    const t = make();
    const r = pivot(t, { rows: ["Region"], values: [{ field: "Sales", showAs: "percentRunningTotal" }] });
    expect(colOf(t, r.range, 1).slice(1, 4).map((v) => Number(v).toFixed(4))).toEqual([(160 / 307).toFixed(4), (204 / 307).toFixed(4), "1.0000"]);
    t.updatePivot("Pivot", r.id, { values: [{ field: "Sales", showAs: "runningTotal", base: { field: "Region" } }] });
    expect(colOf(t, now(t), 1)).toEqual(["Sum of Sales", "160", "204", "307", ""]);
  });

  it("checks what a comparison runs along", () => {
    const s = make();
    expect(() => pivot(s, { rows: ["Region"], values: [{ field: "Sales", showAs: "differenceFrom" }] })).toThrow(/needs the item/);
    expect(() => pivot(s, { rows: ["Region"], values: [{ field: "Sales", showAs: "differenceFrom", base: { field: "Nope", item: "East" } }] })).toThrow(/isn't a row or column field/);
    expect(() => pivot(s, { rows: ["Region"], values: [{ field: "Sales", showAs: "percentOfTotal", base: { field: "Region" } }] })).toThrow(/compares items/);
  });

  it("share of the parent", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region", "Product"], values: [sales("percentOfParentRow")] });
    const col = s.values("Pivot", p.range).map((r) => r[1]);
    expect(col[1]).toBeCloseTo(160 / 307, 10);
    expect(col[2]).toBe(0.75);
    expect(col[3]).toBe(0.25);
    expect(col[9]).toBe(1);
  });

  it("index", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], columns: ["Product"], values: [sales("index")] });
    // East/Apple: 120 * 307 / (160 * 190)
    expect(s.value("Pivot", "B3")).toBeCloseTo((120 * 307) / (160 * 190), 10);
    void p;
  });

  it("is checked", () => {
    const s = make();
    expect(() => pivot(s, { rows: ["Region"], values: [{ field: "Sales", showAs: "nope" as never }] })).toThrow(/shows as/);
  });
});

describe("grouping", () => {
  const DATES = [
    ["When", "Amount", "Count"],
    [dateSerial(2024, 11, 20), 10, 1],
    [dateSerial(2025, 1, 15), 20, 2],
    [dateSerial(2025, 1, 31), 30, 3],
    [dateSerial(2025, 2, 3), 40, 4],
    [dateSerial(2025, 5, 9), 50, 5],
    [dateSerial(2025, 11, 20), 60, 6],
  ];
  const dated = () => {
    const s = new SheetSession(createWorkbook("Dates", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", DATES);
    s.setFormat("Data", "A2:A7", "yyyy-mm-dd");
    return s;
  };
  const dp = (s: SheetSession, spec: Record<string, unknown>) => s.createPivot("Pivot", { source: "Data!A1:C7", anchor: "A1", values: ["Amount"], ...spec } as never);

  it("groups dates by year", () => {
    const s = dated();
    const p = dp(s, { rows: [{ field: "When", group: { by: "years" } }] });
    expect(shown(s, p.range)).toEqual([["Row Labels", "Sum of Amount"], ["2024", "10"], ["2025", "200"], ["Grand Total", "210"]]);
  });

  it("groups dates by month, January of every year together, in calendar order", () => {
    const s = dated();
    const p = dp(s, { rows: [{ field: "When", group: { by: "months" } }] });
    expect(shown(s, p.range).map((r) => r.join("="))).toEqual(["Row Labels=Sum of Amount", "Jan=50", "Feb=40", "May=50", "Nov=70", "Grand Total=210"]);
  });

  it("groups dates by quarter, and by day", () => {
    const s = dated();
    const p = dp(s, { rows: [{ field: "When", group: { by: "quarters" } }] });
    expect(shown(s, p.range).map((r) => r.join("="))).toEqual(["Row Labels=Sum of Amount", "Qtr1=90", "Qtr2=50", "Qtr4=70", "Grand Total=210"]);
    s.updatePivot("Pivot", p.id, { rows: [{ field: "When", group: { by: "days" } }] });
    expect(colOf(s, now(s), 0).slice(1, 3)).toEqual(["15-Jan", "31-Jan"]);
  });

  it("puts years and months of the same field in one pivot table", () => {
    const s = dated();
    const p = dp(s, { rows: [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "months" } }], tabular: true });
    expect(shown(s, p.range).slice(0, 7).map((r) => r.slice(0, 3).join("/"))).toEqual(["Years/When/Sum of Amount", "2024/Nov/10", "2024 Total//10", "2025/Jan/50", "/Feb/40", "/May/50", "/Nov/60"]);
  });

  it("does not let the same group be placed twice", () => {
    const s = dated();
    expect(() => dp(s, { rows: [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "years" } }] })).toThrow(/twice/);
  });

  it("groups numbers in ranges", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Qty", group: { by: "number", step: 5, start: 0, end: 10 } }], values: ["Sales"] });
    expect(shown(s, p.range).map((r) => r.join("="))).toEqual(["Row Labels=Sum of Sales", "0-4=97", "5-9=110", "10-14=100", "Grand Total=307"]);
  });

  it("puts numbers outside the range in groups of their own", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Qty", group: { by: "number", step: 5, start: 3, end: 8 } }], values: ["Sales"] });
    expect(colOf(s, p.range, 0)).toEqual(["Row Labels", "<3", "3-7", "8-12", ">8", "Grand Total"].filter((x) => x !== "8-12"));
  });

  it("starts at the least number when no start is given", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Qty", group: { by: "number", step: 4 } }], values: ["Sales"] });
    expect(colOf(s, p.range, 0)).toEqual(["Row Labels", "2-5", "6-9", "10-13", "Grand Total"]);
  });

  it("hides and filters a group's items by what they show", () => {
    const s = dated();
    const p = dp(s, { rows: [{ field: "When", group: { by: "months" }, hidden: ["Jan"] }] });
    expect(colOf(s, p.range, 0)).toEqual(["Row Labels", "Feb", "May", "Nov", "Grand Total"]);
  });

  it("lists a group's items as they show", () => {
    const s = dated();
    expect(s.pivotFieldItems("Data!A1:C7", "Pivot", "When", { by: "quarters" })).toEqual(["Qtr1", "Qtr2", "Qtr4"]);
  });

  it("refuses a group that isn't one", () => {
    const s = dated();
    expect(() => dp(s, { rows: [{ field: "When", group: { by: "weeks" } }] })).toThrow(/Dates are grouped by/);
    expect(() => dp(s, { rows: [{ field: "When", group: { by: "number", step: 0 } }] })).toThrow(/step above zero/);
  });
});

describe("calculated fields", () => {
  it("works out a formula on the sums of fields", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Net"], calculated: [{ name: "Net", formula: "Sales - Qty" }] });
    expect(shown(s, p.range)).toEqual([["Row Labels", "Sum of Net"], ["East", "143"], ["North", "40"], ["West", "93"], ["Grand Total", "276"]]);
  });

  it("handles brackets, numbers, powers, names in quotes and division", () => {
    const s = new SheetSession(createWorkbook("Calc", ["Data", "Pivot"]));
    s.setValues("Data", "A1", [["Item", "Unit price", "Qty"], ["a", 2, 3], ["a", 4, 1], ["b", 5, 2]]);
    const p = s.createPivot("Pivot", {
      source: "Data!A1:C4",
      anchor: "A1",
      rows: ["Item"],
      values: [{ field: "Money", name: "Money" }, { field: "Half", name: "Half" }, { field: "Sq", name: "Sq" }],
      calculated: [
        { name: "Money", formula: "'Unit price' * Qty" },
        { name: "Half", formula: "(Qty + 1) / 2 - -1" },
        { name: "Sq", formula: "Qty ^ 2" },
      ],
    });
    // a: unit price 2+4, qty 3+1 -> 24; (4+1)/2+1 = 3.5; 16.  b: 5*2 = 10; 2.5; 4.  Together: 11 and 6 -> 66; 4.5; 36.
    expect(shown(s, p.range).slice(2)).toEqual([["a", "24", "3.5", "16"], ["b", "10", "2.5", "4"], ["Grand Total", "66", "4.5", "36"]]);
  });

  it("gives #DIV/0! when it divides by zero", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Ratio"], calculated: [{ name: "Ratio", formula: "Sales / (Qty - Qty)" }] });
    expect(colOf(s, p.range, 1)).toEqual(["Sum of Ratio", "#DIV/0!", "#DIV/0!", "#DIV/0!", "#DIV/0!"]);
  });

  it("shows a calculated field as a share", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: [{ field: "Net", showAs: "percentOfTotal" }], calculated: [{ name: "Net", formula: "Sales - Qty" }] });
    expect(s.value("Pivot", "B2")).toBeCloseTo(143 / 276, 10);
    void p;
  });

  it("refuses a bad formula, an unknown field and a name that's a field", () => {
    const s = make();
    expect(() => pivot(s, { rows: ["Region"], values: ["X"], calculated: [{ name: "X", formula: "Sales +" }] })).toThrow(/stops where a field or number should be/);
    expect(() => pivot(s, { rows: ["Region"], values: ["X"], calculated: [{ name: "X", formula: "Nope * 2" }] })).toThrow(/no field called "Nope"/);
    expect(() => pivot(s, { rows: ["Region"], values: ["Sales"], calculated: [{ name: "Sales", formula: "Qty * 2" }] })).toThrow(/has the name of a field/);
    expect(() => pivot(s, { rows: ["Region"], values: ["X"], calculated: [{ name: "X", formula: "SUM(Sales)" }] })).toThrow(/no functions/);
    expect(() => pivot(s, { rows: ["X"], values: ["Sales"], calculated: [{ name: "X", formula: "Qty" }] })).toThrow(/only be summed up/);
  });
});

describe("keeping and undoing", () => {
  it("round-trips through JSON", () => {
    const s = make();
    pivot(s, {
      rows: [{ field: "Region", sortBy: { value: 0, descending: true }, filter: { kind: "top", by: 0, n: 2 }, blankRow: true }, { field: "Qty", group: { by: "number", step: 5 } }],
      values: [{ field: "Sales", showAs: "runningTotal" }, "Net"],
      calculated: [{ name: "Net", formula: "Sales - Qty" }],
      outline: true,
      repeatLabels: true,
      valuesOnRows: true,
    });
    const again = parseWorkbook(serializeWorkbook(s.state));
    expect(again.sheets[1]!.pivots![0]).toEqual(s.pivots("Pivot")[0]);
  });

  it("is one undo step", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    s.updatePivot("Pivot", p.id, { rows: [{ field: "Region", sortBy: { value: 0, descending: true }, filter: { kind: "top", by: 0, n: 1 } }] });
    expect(colOf(s, "A1:B3", 0)).toEqual(["Row Labels", "East", "Grand Total"]);
    s.undo();
    expect(colOf(s, "A1:B5", 0)).toEqual(["Row Labels", "East", "North", "West", "Grand Total"]);
  });

  it("refuses a pivot table in a file that has both layouts", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    const text = serializeWorkbook(s.state).replace('"rows":[{"field":"Region"}]', '"tabular":true,"outline":true,"rows":[{"field":"Region"}]');
    expect(() => parseWorkbook(text)).toThrow(/tabular or outline/);
    void p;
  });
});

describe("GETPIVOTDATA", () => {
  const withPivot = () => {
    const s = make();
    pivot(s, { rows: ["Region", "Product"], columns: [], values: ["Sales", { field: "Qty", fn: "average", name: "Mean qty" }], tabular: true });
    return s;
  };
  it("finds a total, a subtotal and a single item", () => {
    const s = withPivot();
    s.setCell("Pivot", "G1", '=GETPIVOTDATA("Sales",A1)');
    s.setCell("Pivot", "G2", '=GETPIVOTDATA("Sum of Sales",A1,"Region","East")');
    s.setCell("Pivot", "G3", '=GETPIVOTDATA("Sales",A1,"Region","west","Product","Pear")');
    s.setCell("Pivot", "G4", '=GETPIVOTDATA("Mean qty",A1,"Region","East")');
    expect(s.value("Pivot", "G1")).toBe(307);
    expect(s.value("Pivot", "G2")).toBe(160);
    expect(s.value("Pivot", "G3")).toBe(33);
    expect(s.value("Pivot", "G4")).toBeCloseTo(17 / 3, 10);
  });

  it("finds a cell of a pivot table with columns, in the compact layout, and the value shown as it is shown", () => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", showAs: "percentOfRow" }] });
    s.setCell("Pivot", "H1", '=GETPIVOTDATA("Sales",A1,"Region","East","Product","Apple")');
    s.setCell("Pivot", "H2", '=GETPIVOTDATA("Sales",A1,"Product","Plum")');
    expect(s.value("Pivot", "H1")).toBeCloseTo(120 / 160, 10);
    expect(s.value("Pivot", "H2")).toBeCloseTo(44 / 307, 10);
  });

  it("finds values listed down the rows, and items of grouped fields", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Qty", group: { by: "number", step: 5, start: 0, end: 10 } }], values: ["Sales", "Qty"], valuesOnRows: true });
    s.setCell("Pivot", "H1", '=GETPIVOTDATA("Sum of Qty",A1,"Qty","5-9")');
    expect(s.value("Pivot", "H1")).toBe(12);
  });

  it("follows the source, and changes when the pivot table does", () => {
    const s = withPivot();
    s.setCell("Pivot", "G1", '=GETPIVOTDATA("Sales",A1,"Region","North")');
    expect(s.value("Pivot", "G1")).toBe(44);
    s.setCell("Data", "D7", 50);
    expect(s.value("Pivot", "G1")).toBe(50);
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: ["Product"] });
    expect(s.value("Pivot", "G1")).toEqual({ error: "#REF!" });
  });

  it("gives #REF! for something the pivot table doesn't have", () => {
    const s = withPivot();
    s.setCell("Pivot", "G1", '=GETPIVOTDATA("Nope",A1)');
    s.setCell("Pivot", "G2", '=GETPIVOTDATA("Sales",A1,"Region","South")');
    s.setCell("Pivot", "G3", '=GETPIVOTDATA("Sales",A1,"Product","Apple")');
    s.setCell("Pivot", "G4", '=GETPIVOTDATA("Sales",J9)');
    s.setCell("Pivot", "G5", '=GETPIVOTDATA("Sales",A1,"Region")');
    expect([1, 2, 3, 4].map((i) => s.value("Pivot", `G${i}`))).toEqual([{ error: "#REF!" }, { error: "#REF!" }, { error: "#REF!" }, { error: "#REF!" }]);
    expect(s.value("Pivot", "G5")).toEqual({ error: "#VALUE!" });
  });
});

describe("show details", () => {
  it("gives the records behind a cell, a subtotal and the grand total", () => {
    const s = make();
    pivot(s, { rows: ["Region", "Product"], columns: [], values: ["Sales"], tabular: true });
    // Row 2 is East/Apple (two records: rows 2 and 6 of the data), then East/Pear, East Total, ...
    const apple = s.pivotDetails("Pivot", "C2")!;
    expect(apple.fields).toEqual(["Region", "Product", "Qty", "Sales"]);
    expect(apple.records).toEqual([["East", "Apple", 10, 100], ["East", "Apple", 2, 20]]);
    expect(apple.rows).toEqual([2, 6]);
    expect(s.pivotDetails("Pivot", "C4")!.records).toHaveLength(3); // East Total
    expect(s.pivotDetails("Pivot", "C10")!.records).toHaveLength(6); // Grand Total
    expect(s.pivotDetails("Pivot", "A2")).toBeNull(); // a label
    expect(s.pivotDetails("Pivot", "C1")).toBeNull(); // a heading
    expect(s.pivotDetails("Data", "A2")).toBeNull(); // not in a pivot table
  });

  it("takes the columns into account, and leaves out what the filters and hidden items leave out", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", hidden: ["North"] }], columns: ["Product"], values: ["Sales"], filters: [{ field: "Qty", items: ["10", "5", "7", "3"] }] });
    // Compact layout: row 5 is East (rows: East, West, Grand Total), the filter takes rows 1-2 and the headers two more.
    const east = s.pivotDetails("Pivot", "B5")!;
    expect(east.records).toEqual([["East", "Apple", 10, 100]]);
    expect(s.pivotDetails("Pivot", "C5")!.records).toEqual([["East", "Pear", 5, 40]]);
    expect(s.pivotDetails("Pivot", "D7")!.records).toHaveLength(4);
  });

  it("follows values down the rows and calculated fields", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales", "Net"], calculated: [{ name: "Net", formula: "Sales - Qty" }], valuesOnRows: true });
    expect(s.pivotDetails("Pivot", "B3")!.records).toHaveLength(3); // East, Sum of Sales
    expect(s.pivotDetails("Pivot", "B2")).toBeNull(); // East's own line has no number
  });

  it("lists them on a new sheet with the headings and formats, as one undo step", () => {
    const s = make();
    s.setFormat("Data", "D2:D7", "$#,##0");
    s.setCell("Data", "B3", "'=odd");
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    const before = s.state.sheets.length;
    const made = s.showPivotDetails("Pivot", "B2");
    expect(s.state.sheets).toHaveLength(before + 1);
    expect(made.name).toBe("Details");
    expect(s.values("Details", "A1:D4")).toEqual([["Region", "Product", "Qty", "Sales"], ["East", "Apple", 10, 100], ["East", "=odd", 5, 40], ["East", "Apple", 2, 20]]);
    expect(s.cell("Details", "A1")?.s?.bold).toBe(true);
    expect(s.display("Details", "D2").text).toBe("$100");
    expect(s.showPivotDetails("Pivot", "B2").name).toBe("Details 2");
    s.undo();
    s.undo();
    expect(s.state.sheets).toHaveLength(before);
  });

  it("says when the cell has no details", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    expect(() => s.showPivotDetails("Pivot", "A2")).toThrow(/Show details works on a number/);
  });
});

describe("refreshing by itself", () => {
  it("follows changes to its source, as one undo step with the change", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], autoRefresh: true });
    expect(s.value("Pivot", "B2")).toBe(160);
    s.setCell("Data", "D2", 1000);
    expect(s.value("Pivot", "B2")).toBe(1060);
    s.undo();
    expect(s.value("Data", "D2")).toBe(100);
    expect(s.value("Pivot", "B2")).toBe(160);
    s.redo();
    expect(s.value("Pivot", "B2")).toBe(1060);
  });

  it("follows rows put into and taken out of its source range, and leaves others alone", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], autoRefresh: true });
    const still = new SheetSession(createWorkbook("Pivots", ["Data", "Pivot"]), { now: () => 45_000.5 });
    still.setValues("Data", "A1", DATA);
    still.createPivot("Pivot", { source: "Data!A1:D7", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.setCell("Data", "D2", 5);
    still.setCell("Data", "D2", 5);
    expect(s.value("Pivot", "B2")).toBe(65);
    expect(still.value("Pivot", "B2")).toBe(160); // not asked to follow: stale until refreshed
    s.setCell("Data", "H1", "outside the source");
    s.deleteRows("Data", 3, 1);
    expect(s.value("Pivot", "B2")).toBe(25);
  });

  it("is saved with the workbook and can be turned off", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"], autoRefresh: true });
    const back = new SheetSession(parseWorkbook(serializeWorkbook(s.state)));
    expect(back.pivots("Pivot")[0]!.autoRefresh).toBe(true);
    s.updatePivot("Pivot", p.id, { autoRefresh: false });
    expect(s.pivots("Pivot")[0]!.autoRefresh).toBeUndefined();
    s.setCell("Data", "D2", 1000);
    expect(s.value("Pivot", "B2")).toBe(160);
  });
});

describe("filtering by a period, and putting items in your own order", () => {
  // 45000.5 is 15 March 2023.
  const dated = () => {
    const s = new SheetSession(createWorkbook("Pivots", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", [
      ["Day", "Sales"],
      [dateSerial(2023, 3, 2), 10],
      [dateSerial(2023, 3, 20), 20],
      [dateSerial(2023, 2, 10), 40],
      [dateSerial(2022, 3, 10), 80],
      ["n/a", 160],
    ]);
    return s;
  };
  const make2 = (s: SheetSession, filter: PivotAxisField["filter"]) => s.createPivot("Pivot", { source: "Data!A1:B6", anchor: "A1", rows: [{ field: "Day", filter }], values: ["Sales"] });

  it("keeps the items that are dates in the period, counted from today", () => {
    const s = dated();
    make2(s, { kind: "date", period: "thisMonth" });
    expect(s.value("Pivot", "B2")).toBe(10);
    expect(s.value("Pivot", "B3")).toBe(20);
    expect(s.value("Pivot", "A4")).toBe("Grand Total");
    expect(s.value("Pivot", "B4")).toBe(30);
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: [{ field: "Day", filter: { kind: "date", period: "lastYear" } }] });
    expect(s.value("Pivot", "B3")).toBe(80);
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: [{ field: "Day", filter: { kind: "date", period: "q1" } }] });
    expect(s.value("Pivot", "B6")).toBe(150); // Q1 of any year: March 2023 twice, February 2023, March 2022
  });

  it("refuses a period it doesn't know and a grouped field", () => {
    const s = dated();
    expect(() => make2(s, { kind: "date", period: "someday" as never })).toThrow(/names one of the periods/);
    expect(() => s.createPivot("Pivot", { source: "Data!A1:B6", anchor: "A1", rows: [{ field: "Day", group: { by: "months" }, filter: { kind: "date", period: "thisYear" } }], values: ["Sales"] })).toThrow(/is grouped/);
  });

  it("puts items in the order named, the rest after them in the usual order", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", order: ["West", "East"] }], values: ["Sales"] });
    expect(colOf(s, p.range, 0)).toEqual(["Row Labels", "West", "East", "North", "Grand Total"]);
    s.updatePivot("Pivot", p.id, { rows: [{ field: "Region", order: ["North"], descending: true }] });
    expect(colOf(s, now(s), 0)).toEqual(["Row Labels", "North", "West", "East", "Grand Total"]);
    expect(() => s.updatePivot("Pivot", p.id, { rows: [{ field: "Region", order: ["North"], sortBy: { value: 0 } }] })).toThrow(/can't also be in an order/);
  });
});
