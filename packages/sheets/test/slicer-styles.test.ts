import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Slicers", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", [
    ["Region", "Qty"],
    ["West", 10],
    ["East", 4],
    ["West", 2],
  ]);
  s.createTable("Sheet1", "A1:B4", { name: "Sales" });
  return s;
};
const harbor = {
  wholeTable: { fill: "#f4f8fc", color: "#1f3a5f" },
  headerRow: { fill: "#1f3a5f", color: "#ffffff", bold: true },
  selectedItemWithData: { fill: "#6aa6e3", color: "#ffffff", bold: true },
  unselectedItemWithData: { fill: "#e6eef7", color: "#1f3a5f" },
  unselectedItemWithNoData: { color: "#9aa7b5", italic: true },
  hoveredUnselectedItemWithData: { fill: "#cfe1f4" },
};

describe("slicer styles of your own", () => {
  it("defines a style, names it from a slicer, and undoes", () => {
    const s = make();
    s.setSlicerStyle("Harbor", harbor);
    expect(s.slicerStyles()["Harbor"]).toEqual(harbor);
    const x = s.addSlicer("Sheet1", { table: "Sales", column: "Region", style: "Harbor" });
    expect(s.sheet("Sheet1").slicers![0]!.style).toBe("Harbor");
    s.undo();
    s.undo();
    expect(s.slicerStyles()).toEqual({});
    expect(x.id).toBeTruthy();
  });

  it("refuses names of Excel's styles and of table styles, and bad looks", () => {
    const s = make();
    expect(() => s.setSlicerStyle("SlicerStyleLight2", harbor)).toThrow(/built-in/);
    expect(() => s.setSlicerStyle("", harbor)).toThrow();
    expect(() => s.setSlicerStyle("X", { selectedItemWithData: { fill: "blue" } })).toThrow(/#rrggbb/);
    expect(() => s.setSlicerStyle("X", { bogus: {} } as never)).toThrow(/bogus/);
    s.setTableStyle("Shared", { headerRow: { bold: true } });
    expect(() => s.setSlicerStyle("shared", harbor)).toThrow(/table style/);
    s.setSlicerStyle("Own", harbor);
    expect(() => s.setTableStyle("own", { headerRow: { bold: true } })).toThrow(/slicer style/);
  });

  it("removing a style sends the slicers that used it back to the default, in one undo step", () => {
    const s = make();
    s.setSlicerStyle("Harbor", harbor);
    s.addSlicer("Sheet1", { table: "Sales", column: "Region", style: "Harbor" });
    s.setSlicerStyle("harbor", null);
    expect(s.slicerStyles()).toEqual({});
    expect(s.sheet("Sheet1").slicers![0]!.style).toBeUndefined();
    s.undo();
    expect(s.sheet("Sheet1").slicers![0]!.style).toBe("Harbor");
    expect(s.slicerStyles()["Harbor"]).toBeTruthy();
  });

  it("starts from one of Excel's styles", () => {
    const s = make();
    const light = s.slicerStyleParts("SlicerStyleLight2")!;
    expect(light.selectedItemWithData!.fill).toBeTruthy();
    expect(s.slicerStyleParts("SlicerStyleDark1")!.headerRow!.fill).toBe("#4472c4");
    expect(s.slicerStyleParts("Nope")).toBeNull();
    s.setSlicerStyle("Mine", light);
    expect(s.slicerStyleParts("mine")).toEqual(s.slicerStyles()["Mine"]);
  });

  it("is kept in the workbook JSON and checked there", () => {
    const s = make();
    s.setSlicerStyle("Harbor", harbor);
    expect(parseWorkbook(serializeWorkbook(s.state)).slicerStyles).toEqual({ Harbor: harbor });
    const json = JSON.parse(serializeWorkbook(s.state));
    json.workbook.slicerStyles.Harbor.wholeTable.fill = "red";
    expect(() => parseWorkbook(JSON.stringify(json))).toThrow(/slicerStyles/);
    json.workbook.slicerStyles = { SlicerStyleDark1: {} };
    expect(() => parseWorkbook(JSON.stringify(json))).toThrow(/built-in/);
  });
});

describe("slicer styles in an XLSX file", () => {
  it("writes the whole slicer and heading as a table style and the buttons as a slicer style, and reads them back", () => {
    const s = make();
    s.setSlicerStyle("Harbor", harbor);
    s.addSlicer("Sheet1", { table: "Sales", column: "Region", style: "Harbor" });
    const bytes = toXlsx(s.state);
    const files = unzipSync(bytes);
    const styles = strFromU8(files["xl/styles.xml"]!);
    expect(styles).toMatch(/<tableStyle name="Harbor" pivot="0" table="0" count="2"><tableStyleElement type="wholeTable" dxfId="\d+"\/><tableStyleElement type="headerRow" dxfId="\d+"\/><\/tableStyle>/);
    expect(styles).toContain('<ext uri="{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}"');
    expect(styles).toMatch(/<x14:slicerStyle name="Harbor"><x14:slicerStyleElements><x14:slicerStyleElement type="unselectedItemWithData" dxfId="\d+"\/>/);
    expect(styles).toContain('type="hoveredUnselectedItemWithData"');
    expect(styles).not.toContain('type="wholeTable" dxfId="\d+"/><x14');
    const slicers = Object.entries(files).find(([n]) => /xl\/slicers\/slicer\d+\.xml/.test(n))![1];
    expect(strFromU8(slicers)).toContain('style="Harbor"');
    const back = fromXlsx(bytes);
    expect(back.warnings).toEqual([]);
    expect(back.workbook.slicerStyles).toEqual({ Harbor: harbor });
    // It is a slicer style, not a table style.
    expect(back.workbook.tableStyles).toBeUndefined();
    expect(back.workbook.sheets[0]!.slicers![0]!.style).toBe("Harbor");
  });

  it("writes nothing for a workbook with no styles of the kind, and keeps table styles beside slicer styles", () => {
    const s = make();
    expect(strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!)).not.toContain("slicerStyles");
    s.setTableStyle("Grid", { headerRow: { bold: true } });
    s.setSlicerStyle("Harbor", harbor);
    const styles = strFromU8(unzipSync(toXlsx(s.state))["xl/styles.xml"]!);
    expect(styles).toContain('<tableStyles count="2"');
    const back = fromXlsx(toXlsx(s.state));
    expect(Object.keys(back.workbook.tableStyles ?? {})).toEqual(["Grid"]);
    expect(Object.keys(back.workbook.slicerStyles ?? {})).toEqual(["Harbor"]);
  });
});
