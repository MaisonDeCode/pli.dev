import { strFromU8, unzipSync } from "fflate";
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
  const s = new SheetSession(createWorkbook("PivotRules", ["Data", "Pivot"]), { now: () => 45_000.5 });
  s.setValues("Data", "A1", DATA);
  return s;
};
const style = { fill: "#ffc7ce" };
const rule = (s: SheetSession, id: string) => s.conditionalFormats("Pivot").find((r) => r.id === id)!;

describe("conditional formats that follow a pivot table", () => {
  it("cover the cells that show a value, and not the labels, headings or other values", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Qty", "Sales"] });
    // Region | Sum of Qty | Sum of Sales; East, North, West, Grand Total
    const all = s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style, pivot: { id: p.id } });
    expect(all.ranges).toEqual(["B3:C6"]); // under the caption and heading rows, with the grand total
    const sales = s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style, pivot: { id: p.id, value: 1 } });
    expect(sales.ranges).toEqual(["C3:C6"]);
    expect(s.conditionalEffect("Pivot", "C3")?.style?.fill).toBe("#ffc7ce");
    expect(s.conditionalEffect("Pivot", "A3")).toBeUndefined();
  });

  it("can be limited to the items of one row field, leaving out totals", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"] });
    const text = s.values("Pivot", "A1:B12").map((r) => String(r[0]));
    const r = s.addRule("Pivot", { kind: "dataBar", ranges: [], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6", pivot: { id: p.id, rows: "Product" } });
    // Every row that shows a product (not a region's subtotal row, not the grand total).
    const covered = new Set<string>();
    for (const range of r.ranges) {
      const [a, b] = range.split(":");
      const r1 = Number(a!.slice(1));
      const r2 = Number((b ?? a)!.slice(1));
      for (let i = r1; i <= r2; i++) covered.add(text[i - 1]!);
    }
    expect([...covered].sort()).toEqual(["Apple", "Pear", "Plum"].sort());
    expect(covered.has("East")).toBe(false);
    expect(covered.has("Grand Total")).toBe(false);
    const regions = s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["0"], ranges: [], style, pivot: { id: p.id, rows: "Region" } });
    expect(regions.ranges.length).toBeGreaterThan(0);
    for (const range of regions.ranges) expect(range).not.toEqual(r.ranges[0]);
  });

  it("follow the pivot table when it is drawn again: a new field, a refresh, a bigger source", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    const r = s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["50"], ranges: [], style, pivot: { id: p.id } });
    expect(rule(s, r.id).ranges).toEqual(["B2:B5"]);
    s.setValues("Data", "A7", [["South", "Fig", 1, 9]]);
    s.updatePivot("Pivot", p.id, { source: "Data!A1:D7" });
    expect(rule(s, r.id).ranges).toEqual(["B2:B6"]);
    s.updatePivot("Pivot", p.id, { columns: ["Product"] });
    expect(rule(s, r.id).ranges.length).toBeGreaterThan(0);
    const now = s.pivots("Pivot")[0]!;
    // Every covered cell is inside the pivot table's body.
    for (const range of rule(s, r.id).ranges) expect(range.startsWith("A")).toBe(false);
    expect(now.range).not.toBe(p.range);
  });

  it("are one undo step with the refresh, and go with the pivot table", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    const r = s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["50"], ranges: [], style, pivot: { id: p.id } });
    s.setValues("Data", "A7", [["South", "Fig", 1, 9]]);
    s.updatePivot("Pivot", p.id, { source: "Data!A1:D7" });
    s.undo();
    expect(rule(s, r.id).ranges).toEqual(["B2:B5"]);
    s.deletePivot("Pivot", p.id);
    expect(s.conditionalFormats("Pivot")).toEqual([]);
    s.undo();
    expect(s.conditionalFormats("Pivot")).toHaveLength(1);
  });

  it("are refused for a pivot table or field that isn't there, and survive saving", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    expect(() => s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: "nope" } })).toThrow(/No pivot table/);
    expect(() => s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: p.id, rows: "Product" } })).toThrow(/isn't a row field/);
    expect(() => s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: p.id, value: 4 } })).toThrow(/no value number/);
    s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: p.id, rows: "Region", value: 0 } });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[1]!.conditional![0]!.pivot).toEqual({ id: p.id, rows: "Region", value: 0 });
  });

  it("copied out of the pivot table become ordinary rules", () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["50"], ranges: [], style, pivot: { id: p.id } });
    s.copy({ sheet: "Pivot", range: "B2:B3" }, { sheet: "Pivot", at: "E2" });
    const copy = s.conditionalFormats("Pivot").find((r) => r.ranges.includes("E2:E3"));
    expect(copy).toBeTruthy();
    expect(copy!.pivot).toBeUndefined();
  });
});

describe("pivot rules in XLSX files", () => {
  const build = () => {
    const s = make();
    const p = s.createPivot("Pivot", { source: "Data!A1:D6", anchor: "A1", rows: ["Region", "Product"], values: ["Qty", "Sales"] });
    s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["50"], ranges: [], style, pivot: { id: p.id, value: 1 } });
    s.addRule("Pivot", { kind: "dataBar", ranges: [], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6", pivot: { id: p.id, rows: "Product" } });
    s.addRule("Pivot", { kind: "errors", ranges: [], style, pivot: { id: p.id } });
    s.addRule("Pivot", { kind: "cell", op: "equal", values: ["1"], ranges: ["F1:F3"], style });
    return { s, p };
  };

  it("are written as the pivot table's own conditional formats, tied to the sheet's rules by priority", () => {
    const { s } = build();
    const parts = unzipSync(toXlsx(s.state));
    const table = strFromU8(parts["xl/pivotTables/pivotTable1.xml"]!);
    expect(table).toContain('<conditionalFormats count="3">');
    expect(table).toContain('<conditionalFormat scope="field" priority="1"><pivotAreas count="1"><pivotArea type="data" collapsedLevelsAreSubtotals="1" fieldPosition="0"><references count="1"><reference field="4294967294" count="1" selected="0"><x v="1"/></reference></references>');
    expect(table).toContain('<reference field="1" count="0" selected="0"/>');
    expect(table).toContain('<conditionalFormat scope="data" priority="3"><pivotAreas count="1"><pivotArea type="data" collapsedLevelsAreSubtotals="1" fieldPosition="0"></pivotArea>');
    // Where Excel looks for them: after the data fields and before the style.
    expect(table.indexOf("</dataFields>")).toBeLessThan(table.indexOf("<conditionalFormats"));
    expect(table.indexOf("</conditionalFormats>")).toBeLessThan(table.indexOf("<pivotTableStyleInfo"));
    const sheet = strFromU8(parts["xl/worksheets/sheet2.xml"]!);
    expect(sheet.match(/<conditionalFormatting pivot="1"/g)).toHaveLength(3);
    expect(sheet).toMatch(/<conditionalFormatting sqref="F1:F3">/);
  });

  it("come back as rules that follow the pivot table, and the ordinary rule stays ordinary", () => {
    const { s, p } = build();
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const sheet = workbook.sheets[1]!;
    expect(sheet.pivots).toHaveLength(1);
    const id = sheet.pivots![0]!.id;
    expect(sheet.conditional!.map((r) => r.pivot)).toEqual([{ id, value: 1 }, { id, rows: "Product" }, { id }, undefined]);
    expect(sheet.conditional!.map((r) => r.ranges)).toEqual(s.conditionalFormats("Pivot").map((r) => r.ranges));
    // And they follow it again once it is refreshed.
    const t = new SheetSession(workbook);
    t.setValues("Data", "A7", [["South", "Fig", 1, 9]]);
    t.updatePivot("Pivot", id, { source: "Data!A1:D7" });
    expect(t.conditionalFormats("Pivot")[0]!.ranges).not.toEqual(s.conditionalFormats("Pivot")[0]!.ranges);
    void p;
  });

  it("are plain rules when the pivot table has to be written as plain cells", () => {
    const { s } = build();
    // A filter by the colour of the source cells has no place in the file, so the pivot table is written as the cells it drew.
    s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { rows: [{ field: "Region", filter: { kind: "color", fill: "#ff0000" } }], values: ["Sales"] } as never);
    const parts = unzipSync(toXlsx(s.state));
    expect(Object.keys(parts).some((k) => k.startsWith("xl/pivotTables/"))).toBe(false);
    expect(strFromU8(parts["xl/worksheets/sheet2.xml"]!)).not.toContain('pivot="1"');
  });
});
