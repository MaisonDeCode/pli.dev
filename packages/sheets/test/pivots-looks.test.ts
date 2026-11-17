import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook } from "../src";
import type { PivotAxisField, PivotValue } from "../src";

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

describe("several filters on one field", () => {
  it("lets through only what passes a label filter, a value filter and the items picked", () => {
    const s = make();
    // Regions: East 160, North 44, South 11, West 103.
    pivot(s, {
      rows: [{ field: "Region", filter: { kind: "label", a: { op: "notEquals", value: "South" } }, filters: [{ kind: "value", by: 0, a: { op: "greaterThan", value: 50 } }], hidden: ["West"] }],
      values: ["Sales"],
    });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["East", "160"], ["Grand Total", "160"]]);
    const f = s.pivots("Pivot")[0]!.rows[0]!;
    expect(f.filter?.kind).toBe("label");
    expect(f.filters).toHaveLength(1);
  });
  it("combines a label filter with a top filter", () => {
    const s = make();
    pivot(s, { rows: [{ field: "Region", filter: { kind: "label", a: { op: "notEquals", value: "East" } }, filters: [{ kind: "top", by: 0, n: 2 }] }], values: ["Sales"] });
    expect(shown(s, now(s))).toEqual([["Row Labels", "Sum of Sales"], ["North", "44"], ["West", "103"], ["Grand Total", "147"]]);
  });
  it("refuses two filters of the same kind, or more than three", () => {
    const s = make();
    const two = { kind: "label" as const, a: { op: "contains" as const, value: "e" } };
    expect(() => pivot(s, { rows: [{ field: "Region", filter: two, filters: [{ kind: "date", period: "thisYear" }] }], values: ["Sales"] })).toThrow(/two filters of the same kind/);
    expect(() => pivot(s, { rows: [{ field: "Region", filter: two, filters: [{ kind: "top", by: 0, n: 1 }, { kind: "value", by: 0, a: { op: "equals", value: 1 } }] }], values: ["Sales"] })).toThrow(/two filters of the same kind/);
  });
  it("works on columns too, and keeps the filters in JSON", () => {
    const s = make();
    pivot(s, { columns: [{ field: "Region", filter: { kind: "label", a: { op: "beginsWith", value: "E" } }, filters: [{ kind: "value", by: 0, a: { op: "greaterThan", value: 10 } }] }], values: ["Sales"] });
    expect(shown(s, now(s))).toEqual([["Sum of Sales", "Column Labels", ""], ["", "East", "Grand Total"], ["Total", "160", "160"]]);
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[1]!.pivots![0]!.columns[0]!.filters).toHaveLength(1);
  });
});

describe("groups inside groups", () => {
  it("groups the groups and shows the outer ones, inner ones and items on the rows", () => {
    const s = make();
    const inner = { by: "items" as const, name: "Pair", groups: [{ name: "Coasts", items: ["East", "West"] }] };
    const outer = { by: "items" as const, name: "Everything", groups: [{ name: "Anywhere", items: ["Coasts", "North"] }], of: inner };
    pivot(s, { rows: [{ field: "Region", group: outer }, { field: "Region", group: inner }, { field: "Region" }], values: ["Sales"], tabular: true });
    expect(shown(s, now(s)).map((r) => r.join("|"))).toEqual([
      "Everything|Pair|Region|Sum of Sales",
      "Anywhere|Coasts|East|160",
      "||West|103",
      "|Coasts Total||263",
      "Anywhere|North|North|44",
      "|North Total||44",
      "Anywhere Total|||307",
      "South|South|South|11",
      "|South Total||11",
      "South Total|||11",
      "Grand Total|||318",
    ]);
  });
  it("names the headings Region2 and Region3 unless told", () => {
    const s = make();
    const p = pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "X", items: ["Coasts"] }], of: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } } }], values: ["Sales"] });
    expect(shown(s, p.range)[0]![0]).toBe("Row Labels");
    const t = make();
    pivot(t, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "X", items: ["Coasts"] }], of: { by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] } } }], values: ["Sales"], tabular: true });
    expect(shown(t, now(t))[0]![0]).toBe("Region3");
  });
  it("refuses a group with the name of one inside it, and groups too deep", () => {
    const s = make();
    expect(() => pivot(s, { rows: [{ field: "Region", group: { by: "items", groups: [{ name: "A", items: ["East"] }], of: { by: "items", groups: [{ name: "A", items: ["West"] }] } } }], values: ["Sales"] })).toThrow(/name of a group inside/);
    let g: PivotAxisField["group"] = { by: "items", groups: [{ name: "G0", items: ["East"] }] };
    for (let i = 1; i < 8; i++) g = { by: "items", groups: [{ name: `G${i}`, items: [`G${i - 1}`] }], of: g as never };
    expect(() => pivot(s, { rows: [{ field: "Region", group: g }], values: ["Sales"] })).toThrow(/deep/);
  });
});

describe("pivot styles of your own", () => {
  it("draws the parts of a style on the cells and draws again when the style changes", () => {
    const s = make();
    s.setPivotStyle("Mine", {
      wholeTable: { color: "#111111" },
      headerRow: { fill: "#003366", color: "#ffffff", bold: true },
      firstColumn: { italic: true },
      totalRow: { fill: "#ffcc00", bold: true },
      firstRowStripe: { fill: "#eeeeee" },
      firstSubtotalRow: { fill: "#ccddee" },
    });
    pivot(s, { rows: ["Region", "Product"], values: ["Sales"], style: { name: "Mine", rowStripes: true } });
    const at = (a: string) => s.cell("Pivot", a)?.s;
    expect(at("A1")).toMatchObject({ fill: "#003366", color: "#ffffff", bold: true });
    expect(at("B1")).toMatchObject({ fill: "#003366" });
    const last = now(s).split(":")[1]!;
    expect(at(last)).toMatchObject({ fill: "#ffcc00", bold: true });
    expect(at("A2")).toMatchObject({ italic: true, fill: "#ccddee" });
    s.setPivotStyle("Mine", { headerRow: { fill: "#990000" } });
    expect(at("A1")).toMatchObject({ fill: "#990000" });
  });
  it("is refused for an unknown name, and a removed style gives the table the default look", () => {
    const s = make();
    expect(() => pivot(s, { rows: ["Region"], values: ["Sales"], style: { name: "Nope" } })).toThrow(/no pivot table style called/);
    s.setPivotStyle("Mine", { headerRow: { fill: "#003366" } });
    pivot(s, { rows: ["Region"], values: ["Sales"], style: { name: "Mine" } });
    s.setPivotStyle("Mine", null);
    expect(s.pivots("Pivot")[0]!.style).toBeUndefined();
    expect(s.cell("Pivot", "A1")?.s?.fill).toBe("#dce6f1");
  });
  it("refuses a built-in name and checks each part", () => {
    const s = make();
    expect(() => s.setPivotStyle("PivotStyleLight16", {})).toThrow(/built-in/);
    expect(() => s.setPivotStyle("Bad", { headerRow: { fill: "red" } })).toThrow();
    expect(() => s.setPivotStyle("Bad", { nothing: {} } as never)).toThrow(/has wholeTable/);
  });
  it("styles the filter area, the blank lines, the sub-headings and the subtotal columns", () => {
    const s = make();
    s.setPivotStyle("Mine", { pageFieldLabels: { bold: true, fill: "#aaaaaa" }, pageFieldValues: { fill: "#bbbbbb" }, firstRowSubheading: { italic: true }, firstSubtotalColumn: { fill: "#cccccc" }, blankRow: { fill: "#dddddd" } });
    pivot(s, { rows: [{ field: "Region", blankRow: true }, "Product"], columns: [], values: ["Sales"], filters: [{ field: "Qty", items: ["10", "5", "7", "3", "2", "4", "1"] }], style: { name: "Mine" }, outline: true });
    expect(s.cell("Pivot", "A1")?.s).toMatchObject({ bold: true, fill: "#aaaaaa" });
    expect(s.cell("Pivot", "B1")?.s).toMatchObject({ fill: "#bbbbbb" });
  });
  it("is kept in JSON", () => {
    const s = make();
    s.setPivotStyle("Mine", { headerRow: { fill: "#003366", border: { bottom: { style: "thin", color: "#000000" }, horizontal: { style: "hair" } } }, rowStripeSize: 2, firstRowStripe: { fill: "#eeeeee" } });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.pivotStyles?.["Mine"]?.rowStripeSize).toBe(2);
    expect(back.pivotStyles?.["Mine"]?.headerRow?.border?.horizontal).toEqual({ style: "hair" });
  });
});

describe("formatting kept on the cells of a pivot table", () => {
  it("keeps a colour given to a number by what the number stands for", () => {
    const s = make();
    pivot(s, { rows: ["Region"], columns: ["Product"], values: ["Sales"] });
    // East / Apple sits at row 3, column B (Apple is the first product).
    const before = shown(s, now(s));
    expect(before[2]![0]).toBe("East");
    s.setStyle("Pivot", "B3", { fill: "#ffff00", bold: true });
    expect(s.cell("Pivot", "B3")?.s).toMatchObject({ fill: "#ffff00", bold: true });
    const f = s.pivots("Pivot")[0]!.formats!;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ part: "data", items: [{ field: "Product", item: "Apple" }, { field: "Region", item: "East" }], value: 0, style: { fill: "#ffff00", bold: true } });
    // Changing the layout moves the look with the cell.
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: ["Product"], columns: ["Region"] });
    expect(shown(s, now(s))[1]).toEqual(["Row Labels", "East", "North", "South", "West", "Grand Total"]);
    // The cell is now Apple (row) / East (column).
    expect(s.cell("Pivot", "B3")?.s?.fill).toBe("#ffff00");
  });
  it("keeps a number format and a look on the row labels and the totals, and one undo takes the edit away", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    s.setFormat("Pivot", "B2:B6", "$#,##0");
    expect(s.cell("Pivot", "B2")?.fmt).toBe("$#,##0");
    s.setStyle("Pivot", "A2", { color: "#ff0000" });
    expect(s.cell("Pivot", "A2")?.s?.color).toBe("#ff0000");
    s.refreshPivot("Pivot", s.pivots("Pivot")[0]!.id);
    expect(s.cell("Pivot", "B3")?.fmt).toBe("$#,##0");
    expect(s.cell("Pivot", "A2")?.s?.color).toBe("#ff0000");
    s.undo();
    s.undo();
    expect(s.cell("Pivot", "A2")?.s?.color).toBeUndefined();
    expect(s.cell("Pivot", "B2")?.fmt).toBe("$#,##0");
  });
  it("still refuses to change a value in the table, and a look on corner cells is not kept", () => {
    const s = make();
    pivot(s, { rows: ["Region"], values: ["Sales"] });
    expect(() => s.setValues("Pivot", "B2", [[1]])).toThrow(/Can't change part of a pivot table/);
    s.setStyle("Pivot", "A1:B1", { fill: "#00ff00" });
    expect(s.pivots("Pivot")[0]!.formats).toBeUndefined();
  });
  it("can be given and cleared from the API, and is kept in JSON", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    s.formatPivot("Pivot", p.id, { part: "data", grand: "row" }, { style: { bold: true, fill: "#ffeecc" } });
    const last = now(s).split(":")[1]!;
    expect(s.cell("Pivot", last)?.s).toMatchObject({ bold: true, fill: "#ffeecc" });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[1]!.pivots![0]!.formats).toHaveLength(1);
    s.clearPivotFormats("Pivot", p.id);
    expect(s.cell("Pivot", last)?.s?.fill).toBeUndefined();
  });
  it("takes a look off with null", () => {
    const s = make();
    const p = pivot(s, { rows: ["Region"], values: ["Sales"] });
    s.formatPivot("Pivot", p.id, { part: "label", items: [] }, { style: { bold: null } });
    const last = Number(now(s).split(":")[1]!.replace(/[A-Z]+/, ""));
    expect(s.cell("Pivot", `A${last}`)?.s?.bold).toBeUndefined();
  });
});

describe("a pivot table of several ranges with page fields of its own", () => {
  const ranges = (s: SheetSession) => {
    s.setValues("Data", "H1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
    s.setValues("Data", "H6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
  };
  it("has the page fields Page1 to Page4 you ask for, named by range", () => {
    const s = make();
    ranges(s);
    pivot(s, {
      source: "Data!H1:J3",
      ranges: [{ source: "Data!H1:J3", names: ["Now", "2024"] }, { source: "Data!H6:J8", names: ["Then", "2023"] }],
      pageFields: 2,
      rows: ["Row"],
      columns: ["Page2"],
      values: ["Value"],
      filters: [{ field: "Page1", items: ["Now", "Then"] }],
    });
    expect(s.pivotFields("Data!H1:J3", "Pivot")).not.toContain("Page2");
    expect(shown(s, now(s)).map((r) => r.join("|"))).toEqual(["Page1|(All)||", "|||", "Sum of Value|Column Labels||", "Row Labels|2023|2024|Grand Total", "East|30|3|33", "West|70|7|77", "Grand Total|100|10|110"]);
    expect(s.pivots("Pivot")[0]!.pageFields).toBe(2);
  });
  it("has no page field with 0, and refuses more than 4", () => {
    const s = make();
    ranges(s);
    const spec = { source: "Data!H1:J3", ranges: [{ source: "Data!H1:J3" }, { source: "Data!H6:J8" }], rows: ["Row"], columns: ["Column"], values: ["Value"] };
    pivot(s, { ...spec, pageFields: 0 });
    expect(shown(s, now(s)).at(-1)!.at(-1)).toBe("110");
    const t = make();
    ranges(t);
    expect(() => pivot(t, { ...spec, pageFields: 5 })).toThrow(/0 to 4/);
    expect(() => pivot(t, { source: "Data!A1:D8", rows: ["Region"], values: ["Sales"], pageFields: 2 })).toThrow(/several ranges/);
  });
});
