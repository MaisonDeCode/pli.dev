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
  ["South", "Plum", 1, 11],
];
const make = () => {
  const s = new SheetSession(createWorkbook("Pivots", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", DATA);
  return s;
};
const shown = (s: SheetSession, range: string) => s.values("Pivot", range).map((r) => r.map((v) => (v === null ? "" : typeof v === "object" ? v.error : String(v))));
const pivot = (s: SheetSession, spec: { rows?: (string | PivotAxisField)[]; columns?: (string | PivotAxisField)[]; values?: (string | PivotValue)[] } & Record<string, unknown>, source = "Data!A1:D8") => s.createPivot("Pivot", { source, anchor: "A1", ...spec } as never);
const now = (s: SheetSession) => s.pivots("Pivot")[0]!.range;

describe("calculated items", () => {
  it("lists the item with the others and adds up what its formula says", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["Coasts", "263"], ["East", "160"], ["North", "44"], ["South", "11"], ["West", "103"], ["Grand Total", "581"]]);
  });
  it("puts the item inside every item of the field before it, with the inner items of the items it uses", () => {
    const s = make();
    pivot(s, { rows: ["Product", "Region"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
    const rows = shown(s, now(s)).map((r) => r.join("|"));
    expect(rows).toEqual(["Row Labels|Sum of Sales", "Apple|380", "Coasts|190", "East|120", "West|70", "Pear|146", "Coasts|73", "East|40", "West|33", "Plum|55", "Coasts|", "North|44", "South|11", "Grand Total|581"]);
    // Totals count the calculated item too, as Excel's do.
  });
  it("uses items that are left out, and keeps them out of the table", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", hidden: ["East", "West"] }], values: ["Sales"], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["Coasts", "263"], ["North", "44"], ["South", "11"], ["Grand Total", "318"]]);
  });
  it("shows #REF! for an item the field doesn't have, and refuses a name an item already has", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "Odd", formula: "East + Mars" }] });
    expect(shown(s, now(s)).map((r) => r.join("|"))).toContain("Odd|#REF!");
    const t = make();
    expect(() => pivot(t, { rows: ["Region"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "East", formula: "West" }] })).toThrow(/already has an item/);
  });
  it("is refused on a grouped field or one that isn't on the rows or columns", () => {
    const s = make();
    expect(() => pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "G", items: ["East"] }] } }], values: ["Sales"], calculatedItems: [{ field: "Region", name: "X", formula: "East" }] })).toThrow(/grouped/);
    expect(() => pivot(s, { rows: ["Product"], values: ["Sales"], calculatedItems: [{ field: "Region", name: "X", formula: "East" }] })).toThrow(/isn't a row or column field/);
  });
  it("works on columns and with a percent of the total", () => {
    const s = make();
    pivot(s, { columns: ["Region"], values: [{ field: "Sales", showAs: "percentOfTotal" }], calculatedItems: [{ field: "Region", name: "Coasts", formula: "East + West" }] });
    expect(shown(s, now(s))[1]).toEqual(["", "Coasts", "East", "North", "South", "West", "Grand Total"]);
    expect(Number(shown(s, now(s))[2]![1])).toBeCloseTo(263 / 581, 6);
  });
});

describe("grouping items you pick", () => {
  it("gathers the items under a name and leaves the others as they are", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } }], values: ["Sales"] });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["Coasts", "263"], ["North", "44"], ["South", "11"], ["Grand Total", "318"]]);
  });
  it("names the field's heading in the tabular layout and keeps the field's own items inside", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }, { name: "Inland", items: ["North", "South"] }], name: "Area" } }, "Region"], values: ["Sales"], tabular: true });
    const rows = shown(s, now(s)).map((r) => r.slice(0, 3).join("|"));
    expect(rows[0]).toBe("Area|Region|Sum of Sales");
    expect(rows).toContain("Coasts|East|160");
    expect(rows).toContain("Inland Total||55");
  });
  it("refuses a group with no name, and an item in two groups goes to the first", () => {
    const s = make();
    expect(() => pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: " ", items: ["East"] }] } }], values: ["Sales"] })).toThrow(/needs a name/);
    pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "A", items: ["East"] }, { name: "B", items: ["East", "West"] }] } }], values: ["Sales"] });
    expect(shown(s, now(s)).map((r) => r.join("|"))).toContain("A|160");
  });
});

describe("grouping times and days", () => {
  const T = (d: number, h: number, m: number, sec = 0) => (dateSerial(2024, 3, d) ?? 0) + (h * 3600 + m * 60 + sec) / 86400;
  const setup = () => {
    const s = new SheetSession(createWorkbook("T", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", [["When", "N"], [T(1, 9, 5, 30), 1], [T(1, 9, 50), 2], [T(2, 14, 5), 4], [T(10, 9, 15), 8]]);
    return s;
  };
  it("groups by hour, minute and second", () => {
    const s = setup();
    s.createPivot("Pivot", { source: "Data!A1:B5", anchor: "A1", rows: [{ field: "When", group: { by: "hours" } }], values: ["N"] });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of N"], ["9", "11"], ["14", "4"], ["Grand Total", "15"]]);
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: [{ field: "When", group: { by: "minutes" } }] });
    expect(shown(s, now(s)).map((r) => r[0])).toEqual(["Row Labels", "5", "15", "50", "Grand Total"]);
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: [{ field: "When", group: { by: "seconds" } }] });
    expect(shown(s, now(s)).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of N", "0|14", "30|1", "Grand Total|15"]);
  });
  it("groups dates in ranges of days", () => {
    const s = setup();
    s.createPivot("Pivot", { source: "Data!A1:B5", anchor: "A1", rows: [{ field: "When", group: { by: "dayRange", days: 7 } }], values: ["N"] });
    expect(shown(s, now(s)).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of N", "3/1/2024 - 3/7/2024|7", "3/8/2024 - 3/10/2024|8", "Grand Total|15"]);
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: [{ field: "When", group: { by: "dayRange", days: 7, start: T(2, 0, 0) } }] });
    expect(shown(s, now(s)).map((r) => r[0])).toEqual(["Row Labels", "<3/2/2024", "3/2/2024 - 3/8/2024", "3/9/2024 - 3/10/2024", "Grand Total"]);
  });
  it("groups by years and months at once by placing the field twice", () => {
    const s = new SheetSession(createWorkbook("T", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", [["D", "N"], [dateSerial(2023, 1, 5), 1], [dateSerial(2023, 2, 5), 2], [dateSerial(2024, 1, 9), 4]]);
    s.createPivot("Pivot", { source: "Data!A1:B4", anchor: "A1", rows: [{ field: "D", group: { by: "years" } }, { field: "D", group: { by: "months" } }], values: ["N"], tabular: true });
    expect(shown(s, now(s)).map((r) => r.join("|"))).toEqual(["Years|D|Sum of N", "2023|Jan|1", "|Feb|2", "2023 Total||3", "2024|Jan|4", "2024 Total||4", "Grand Total||7"]);
  });
});

describe("a pivot table from several ranges", () => {
  const setup = () => {
    const s = new SheetSession(createWorkbook("C", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
    s.setValues("Data", "A6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
    return s;
  };
  it("reads each range as row labels, column labels and numbers, with a page field naming the range", () => {
    const s = setup();
    s.createPivot("Pivot", { source: "Data!A1:C3", ranges: [{ source: "Data!A1:C3" }, { source: "Data!A6:C8", name: "Last year" }], anchor: "A1", rows: ["Row"], columns: ["Column"], values: ["Value"] });
    expect(shown(s, now(s))).toEqual([["Sum of Value", "Column Labels", "", ""], ["Row Labels", "Q1", "Q2", "Grand Total"], ["East", "11", "22", "33"], ["West", "33", "44", "77"], ["Grand Total", "44", "66", "110"]]);
    const pid = s.pivots("Pivot")[0]!.id;
    s.updatePivot("Pivot", pid, { filters: [{ field: "Page1", items: ["Item1"] }] });
    expect(shown(s, now(s)).map((r) => r.join("|")).slice(-3)).toEqual(["East|1|2|3", "West|3|4|7", "Grand Total|4|6|10"]);
  });
  it("follows the ranges when they change, with auto refresh", () => {
    const s = setup();
    const p = s.createPivot("Pivot", { source: "Data!A1:C3", ranges: [{ source: "Data!A1:C3" }, { source: "Data!A6:C8" }], anchor: "A1", rows: ["Row"], values: ["Value"], autoRefresh: true });
    s.setCell("Data", "B7", 100);
    expect(shown(s, now(s)).at(-1)).toEqual(["Grand Total", String(1 + 2 + 3 + 4 + 100 + 20 + 30 + 40)]);
    expect(p.ranges).toHaveLength(2);
  });
});

describe("filters by colour", () => {
  it("keeps the records whose cell has the colour", () => {
    const s = make();
    s.setStyle("Data", "A2", { fill: "#ffff00" });
    s.setStyle("Data", "A4", { fill: "#ffff00" });
    pivot(s, { rows: [{ field: "Region", filter: { kind: "color", fill: "#ffff00" } }], values: ["Sales"] });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["East", "100"], ["West", "70"], ["Grand Total", "170"]]);
  });
  it("picks the cells with no fill, or a font colour", () => {
    const s = make();
    s.setStyle("Data", "B2", { color: "#ff0000" });
    pivot(s, { rows: ["Region", { field: "Product", filter: { kind: "color", font: "#ff0000" } }], values: ["Sales"] });
    expect(shown(s, now(s)).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Sales", "East|100", "Apple|100", "Grand Total|100"]);
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: ["Region", { field: "Product", filter: { kind: "color", font: "auto" } }] });
    expect(shown(s, now(s)).at(-1)).toEqual(["Grand Total", "218"]);
  });
  it("refuses a colour that isn't one", () => {
    const s = make();
    expect(() => pivot(s, { rows: [{ field: "Region", filter: { kind: "color", fill: "yellow" } }], values: ["Sales"] })).toThrow(/#rrggbb/);
  });
});

describe("pivot table styles", () => {
  const styled = (style: Record<string, unknown>) => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"], style });
    return s;
  };
  it("draws the heading, the labels and the grand total in the look of the style", () => {
    const s = styled({ name: "PivotStyleMedium2" });
    expect(s.cell("Pivot", "A1")?.s).toMatchObject({ bold: true, fill: "#4472c4", color: "#ffffff" });
    expect(s.cell("Pivot", "B1")?.s).toMatchObject({ bold: true, fill: "#4472c4" });
    expect(s.cell("Pivot", "A6")?.s).toMatchObject({ bold: true, fill: "#4472c4", border: { top: { style: "medium" } } });
  });
  it("has banded rows and leaves the headings alone when asked", () => {
    const s = styled({ name: "PivotStyleLight9", rowStripes: true, colHeaders: false, rowHeaders: false });
    expect(s.cell("Pivot", "A1")?.s?.fill).toBeUndefined();
    expect(s.cell("Pivot", "B2")?.s?.fill).toBeDefined();
    expect(s.cell("Pivot", "B3")?.s?.fill).toBeUndefined();
    expect(s.cell("Pivot", "B4")?.s?.fill).toBeDefined();
    expect(s.cell("Pivot", "A2")?.s?.bold).toBeUndefined();
  });
  it("draws nothing for none, and keeps the default look without a style", () => {
    const s = styled({ name: "none" });
    expect(s.cell("Pivot", "A1")?.s?.fill).toBeUndefined();
    expect(s.cell("Pivot", "A1")?.s?.bold).toBeUndefined();
    const t = make();
    pivot(t, { rows: ["Region"], values: ["Sales"] });
    expect(t.cell("Pivot", "A1")?.s).toMatchObject({ bold: true, fill: "#dce6f1" });
  });
  it("knows every one of Excel's 84 names and refuses others", () => {
    for (const f of ["Light", "Medium", "Dark"]) for (const n of [1, 14, 28]) expect(() => styled({ name: `PivotStyle${f}${n}` })).not.toThrow();
    expect(() => styled({ name: "PivotStyleLight29" })).toThrow(/pivot table style/);
    expect(() => styled({ name: "TableStyleMedium2" })).toThrow(/pivot table style/);
  });
  it("changes with updatePivot and undoes", () => {
    const s = styled({ name: "PivotStyleDark3" });
    const id = s.pivots("Pivot")[0]!.id;
    s.updatePivot("Pivot", id, { style: undefined });
    expect(s.cell("Pivot", "A1")?.s).toMatchObject({ fill: "#dce6f1" });
    s.undo();
    expect(s.cell("Pivot", "A1")?.s?.color).toBe("#ffffff");
  });
});

describe("slicers and timelines on a pivot table", () => {
  it("shows the items as buttons and filters the table through the field in one undo step", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    const sl = s.addPivotSlicer("Pivot", p.id, { field: "Region" });
    expect(s.pivotSlicerItems(sl.id).map((i) => [i.value, i.count, i.selected])).toEqual([["East", 3, true], ["North", 1, true], ["South", 1, true], ["West", 2, true]]);
    s.pivotSlicerSelect(sl.id, ["East", "West"]);
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["East", "160"], ["West", "103"], ["Grand Total", "263"]]);
    expect(s.pivots("Pivot")[0]!.rows[0]!.hidden).toEqual(["North", "South"]);
    expect(s.pivotSlicerItems(sl.id).map((i) => i.selected)).toEqual([true, false, false, true]);
    s.undo();
    expect(shown(s, now(s)).at(-1)).toEqual(["Grand Total", "318"]);
    s.redo();
    s.pivotSlicerSelect(sl.id, null);
    expect(s.pivots("Pivot")[0]!.rows[0]!.hidden).toBeUndefined();
  });
  it("filters through a page filter, or through a hidden one when the table doesn't use the field", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"], filters: [{ field: "Product", items: [] }] });
    const byProduct = s.addPivotSlicer("Pivot", p.id, { field: "Product" });
    s.pivotSlicerSelect(byProduct.id, ["Apple"]);
    expect(s.pivots("Pivot")[0]!.filters![0]!.items).toEqual(["Apple"]);
    expect(s.cell("Pivot", "B1")?.v).toBe("Apple");
    const q = pivot(make(), { rows: ["Region"], values: ["Sales"] });
    const t = make();
    const p2 = pivot(t, { rows: ["Region"], values: ["Sales"] });
    const bySales = t.addPivotSlicer("Pivot", p2.id, { field: "Product" });
    t.pivotSlicerSelect(bySales.id, ["Plum"]);
    expect(t.pivots("Pivot")[0]!.filters).toEqual([{ field: "Product", items: ["Plum"], hidden: true }]);
    expect(shown(t, now(t))).toEqual([["Row Labels", "Sum of Sales"], ["North", "44"], ["South", "11"], ["Grand Total", "55"]]);
    t.pivotSlicerSelect(bySales.id, null);
    expect(t.pivots("Pivot")[0]!.filters).toBeUndefined();
    void q;
  });
  it("goes through the plain slicer calls the grid uses, and moves", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    const sl = s.addPivotSlicer("Pivot", p.id, { field: "Region", caption: "Where" });
    s.slicerSelect(sl.id, ["North"]);
    expect(s.slicerItems(sl.id).filter((i) => i.selected).map((i) => i.value)).toEqual(["North"]);
    s.updateSlicer("Pivot", { id: sl.id, table: "", column: "Region", caption: "Where", from: { row: 9, col: 9 }, width: 200, height: 250 });
    expect(s.pivotSlicers("Pivot")[0]).toMatchObject({ from: { row: 9, col: 9 }, width: 200, caption: "Where" });
    s.deleteSlicer("Pivot", sl.id);
    expect(s.pivotSlicers("Pivot")).toEqual([]);
  });
  it("lets a timeline pick a stretch of dates", () => {
    const s = new SheetSession(createWorkbook("T", ["Data", "Pivot"]), { now: () => 45_000.5 });
    s.setValues("Data", "A1", [["D", "N"], [dateSerial(2023, 1, 5), 1], [dateSerial(2023, 2, 5), 2], [dateSerial(2024, 1, 9), 4]]);
    const p = s.createPivot("Pivot", { source: "Data!A1:B4", anchor: "A1", rows: ["D"], values: ["N"] });
    const tl = s.addPivotTimeline("Pivot", p.id, { field: "D" });
    expect(s.pivotTimelineBounds(tl.id)).toEqual({ min: dateSerial(2023, 1, 5), max: dateSerial(2024, 1, 9) });
    s.pivotTimelineSelect(tl.id, dateSerial(2023, 2, 1), dateSerial(2023, 12, 31));
    expect(s.values("Pivot", s.pivots("Pivot")[0]!.range).at(-1)).toEqual(["Grand Total", 2]);
    s.undo();
    expect(s.values("Pivot", s.pivots("Pivot")[0]!.range).at(-1)).toEqual(["Grand Total", 7]);
    expect(() => s.addPivotTimeline("Pivot", p.id, { field: "N", id: "x" })).not.toThrow();
  });
  it("refuses a field the source doesn't have, and goes when the pivot table does", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    expect(() => s.addPivotSlicer("Pivot", p.id, { field: "Nope" })).toThrow(/no field/);
    s.addPivotSlicer("Pivot", p.id, { field: "Region" });
    s.deletePivot("Pivot", p.id);
    expect(s.pivotSlicers("Pivot")).toEqual([]);
  });
});

describe("saving and moving", () => {
  it("keeps every new setting through a saved workbook", () => {
    const s = make();
    const p = pivot(s, {
      rows: [{ field: "Region", group: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }], name: "Area" } }, { field: "Product", filter: { kind: "color", fill: "#ffff00" } }],
      values: ["Sales"],
      calculatedItems: [],
      style: { name: "PivotStyleDark5", colStripes: true },
      filters: [{ field: "Qty", items: ["10"], hidden: true }],
    });
    s.addPivotSlicer("Pivot", p.id, { field: "Region" });
    s.addPivotTimeline("Pivot", p.id, { field: "Qty", level: "years" });
    const again = parseWorkbook(serializeWorkbook(s.state));
    expect(again.sheets[1]!.pivots![0]).toEqual(s.state.sheets[1]!.pivots![0]);
  });
  it("refuses a workbook whose pivot table has a style or a slicer that isn't right", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    const json = JSON.parse(serializeWorkbook(s.state));
    json.workbook.sheets[1].pivots[0].style = { name: "PivotStyleHuge1" };
    expect(() => parseWorkbook(JSON.stringify(json))).toThrow(/pivot table style/);
    delete json.workbook.sheets[1].pivots[0].style;
    json.workbook.sheets[1].pivots[0].slicers = [{ id: "a", field: "Region", from: { row: 0, col: 1 }, width: 100, height: 100 }];
    expect(() => parseWorkbook(JSON.stringify(json))).toThrow(/cell to sit in/);
  });
  it("keeps a pivot table's slicers on their cells when rows are inserted above them", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"], anchor: "H1" });
    s.addPivotSlicer("Pivot", p.id, { field: "Region", from: { row: 10, col: 1 } });
    s.addPivotTimeline("Pivot", s.pivots("Pivot")[0]!.id, { field: "Qty", from: { row: 20, col: 3 } });
    s.insertRows("Pivot", 8, 2);
    expect(s.pivotSlicers("Pivot")[0]!.from).toMatchObject({ row: 12, col: 1 });
    expect(s.pivotTimelines("Pivot")[0]!.from).toMatchObject({ row: 22, col: 3 });
    s.insertColumns("Pivot", 1, 1);
    expect(s.pivotSlicers("Pivot")[0]!.from).toMatchObject({ row: 12, col: 2 });
    expect(s.pivots("Pivot")[0]!.anchor).toBe("I1");
  });
  it("keeps the colours a pivot table was filtered by up to date when the source changes", () => {
    const s = make();
    s.setStyle("Data", "A2", { fill: "#ffff00" });
    const p = pivot(s, { rows: [{ field: "Region", filter: { kind: "color", fill: "#ffff00" } }], values: ["Sales"], autoRefresh: true });
    expect(shown(s, now(s)).at(-1)).toEqual(["Grand Total", "100"]);
    s.setStyle("Data", "A4", { fill: "#ffff00" });
    s.refreshPivot("Pivot", p.id);
    expect(shown(s, now(s)).at(-1)).toEqual(["Grand Total", "170"]);
  });
});
