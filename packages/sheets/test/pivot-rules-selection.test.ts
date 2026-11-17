import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const DATA = [
  ["Region", "Product", "Qty", "Sales"],
  ["East", "Apple", 10, 100],
  ["East", "Pear", 5, 40],
  ["West", "Apple", 7, 70],
  ["West", "Pear", 3, 33],
  ["North", "Plum", 4, 44],
];

const make = () => {
  const s = new SheetSession(createWorkbook("PivotSel", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", DATA);
  return s;
};
const style = { fill: "#ffc7ce" };

describe("conditional formats for the selected cells of a pivot table", () => {
  it("follow only the items they are limited to", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"] });
    const text = s.values("Pivot", "A1:A12").map((r) => String(r[0]));
    const rule = s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style, pivot: { id: p.id, items: { Region: ["East"] } } });
    // The East line (its subtotal) and its products, but not West, North or the grand total.
    const covered = rule.ranges.flatMap((r) => {
      const [a, b = a] = r.split(":");
      return Array.from({ length: Number(b!.slice(1)) - Number(a!.slice(1)) + 1 }, (_, i) => Number(a!.slice(1)) + i);
    });
    const labels = covered.map((row) => text[row - 1]!.trim());
    expect(labels).toEqual(expect.arrayContaining(["East", "Apple", "Pear"]));
    expect(labels).not.toContain("West");
    expect(labels).not.toContain("North");
    expect(labels).not.toContain("Grand Total");
    expect(covered).toHaveLength(3);
  });

  it("combine items with a level, and follow the table when it changes", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"] });
    const rule = s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style, pivot: { id: p.id, rows: "Product", items: { Region: ["West"] } } });
    expect(s.values("Pivot", rule.ranges[0]!).flat().sort()).toEqual([33, 70]);
    s.setValues("Data", "A7", [["West", "Fig", 1, 9]]);
    s.updatePivot("Pivot", p.id, { source: "Data!A1:D7" });
    const after = s.conditionalFormats("Pivot")[0]!;
    expect(s.values("Pivot", after.ranges[0]!).flat().sort((a, b) => Number(a) - Number(b))).toEqual([9, 33, 70]);
  });

  it("are refused for a field that is not on the axes, and kept through save and load", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    expect(() => s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: p.id, items: { Product: ["Apple"] } } })).toThrow(/isn't a row or column field/);
    expect(() => s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: p.id, items: { Region: [] } } })).toThrow(/list of labels/);
    const r = s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: p.id, items: { Region: ["East", "East", "West"] } } });
    expect(r.pivot!.items).toEqual({ Region: ["East", "West"] });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[1]!.conditional![0]!.pivot!.items).toEqual({ Region: ["East", "West"] });
  });

  it("work out what a selection of cells is", () => {
    const s = make();
    s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Qty", "Sales"] });
    const text = s.values("Pivot", "A1:C14").map((r) => String(r[0]).trim());
    const row = (label: string, nth = 0) => text.map((t, i) => [t, i + 1] as const).filter(([t]) => t === label)[nth]![1];
    const apple = row("Apple", 0);
    // One cell: its value, its level, and the items it is under.
    expect(s.pivotSelectionScope("Pivot", `C${apple}`)).toMatchObject({ value: 1, rows: "Product", items: { Region: ["East"], Product: ["Apple"] } });
    // A whole column of the body is every item: no limit, and the value.
    const first = row("East");
    const last = row("Grand Total");
    expect(s.pivotSelectionScope("Pivot", `B${first}:B${last}`)).toEqual({ id: s.pivots("Pivot")[0]!.id, value: 0 });
    // Both values of one line don't name a value.
    const scope = s.pivotSelectionScope("Pivot", `B${apple}:C${apple}`)!;
    expect(scope.value).toBeUndefined();
    // Labels aren't value cells; outside the table there is no scope.
    expect(s.pivotSelectionScope("Pivot", `A${apple}:C${apple}`)).toBeNull();
    expect(s.pivotSelectionScope("Pivot", "H20")).toBeNull();
  });
});

describe("selected-cell rules in XLSX files", () => {
  const build = () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Qty", "Sales"] });
    s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["30"], ranges: [], style, pivot: { id: p.id, value: 1, rows: "Product", items: { Region: ["West", "East"] } } });
    s.addRule("Pivot", { kind: "cell", op: "equal", values: ["1"], ranges: ["F1:F3"], style });
    return { s, p };
  };

  it("are written as the pivot table's own formats for selected cells, naming the items by their place", () => {
    const { s } = build();
    const parts = unzipSync(toXlsx(s.state));
    const table = strFromU8(parts["xl/pivotTables/pivotTable1.xml"]!);
    // No scope attribute: selected cells are the default. Items are in the order the field lists them (North, West, East? no: East, North, West).
    expect(table).toContain('<conditionalFormats count="1"><conditionalFormat priority="1">');
    expect(table).toContain('<reference field="4294967294" count="1" selected="0"><x v="1"/></reference>');
    expect(table).toContain('<reference field="0" count="2" selected="0"><x v="2"/><x v="0"/></reference>');
    expect(table).toContain('<reference field="1" count="0" selected="0"/>');
    expect(table.indexOf('<reference field="0"')).toBeLessThan(table.indexOf('<reference field="1"'));
    expect(strFromU8(parts["xl/worksheets/sheet2.xml"]!).match(/<conditionalFormatting pivot="1"/g)).toHaveLength(1);
  });

  it("come back as rules that follow the items", () => {
    const { s } = build();
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const sheet = workbook.sheets[1]!;
    const id = sheet.pivots![0]!.id;
    expect(sheet.conditional![0]!.pivot).toEqual({ id, value: 1, rows: "Product", items: { Region: ["West", "East"] } });
    expect(sheet.conditional![1]!.pivot).toBeUndefined();
    // Same cells as before.
    expect(sheet.conditional![0]!.ranges).toEqual(s.conditionalFormats("Pivot")[0]!.ranges);
  });

  it("stay ordinary rules when the selection is headings, or names an item the table doesn't list", () => {
    const { s } = build();
    const parts = unzipSync(toXlsx(s.state));
    const table = strFromU8(parts["xl/pivotTables/pivotTable1.xml"]!);
    const changed = (text: string) => {
      const { workbook } = fromXlsx(zipSync({ ...parts, "xl/pivotTables/pivotTable1.xml": strToU8(text) }));
      return workbook.sheets[1]!.conditional![0]!;
    };
    // Labels only.
    expect(changed(table.replace('<pivotArea type="data"', '<pivotArea labelOnly="1" type="data"')).pivot).toBeUndefined();
    // An item number past the end of the field's items.
    expect(changed(table.replace('<x v="2"/><x v="0"/>', '<x v="9"/><x v="0"/>')).pivot).toBeUndefined();
    // Untouched, it follows.
    expect(changed(table).pivot).toBeDefined();
  });
});
