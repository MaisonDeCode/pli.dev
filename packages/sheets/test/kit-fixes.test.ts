import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ProtectionError, SheetSession, createWorkbook, fromXlsx, toXlsx, writeSddl } from "../src";

describe("what Excel's copies of the check kit showed", () => {
  it("writes Everyone and the other well-known groups in SDDL by their short names, as Excel does", () => {
    expect(writeSddl(["sid:S-1-1-0"], undefined)).toBe("O:WDG:WDD:(A;;CC;;;WD)");
    expect(writeSddl(["sid:S-1-5-21-1-2-3-1001", "sid:S-1-5-32-544"], ["sid:S-1-5-18"])).toBe("O:WDG:WDD:(D;;CC;;;SY)(A;;CC;;;S-1-5-21-1-2-3-1001)(A;;CC;;;BA)");
    expect(writeSddl(undefined, ["sid:S-1-5-21-1-2-3-1001"])).toBe("O:WDG:WDD:(D;;CC;;;S-1-5-21-1-2-3-1001)(A;;CC;;;WD)");
  });

  it("reads a row's style that only repeats the sheet's lock and hiding as no lock of its own", () => {
    const s = new SheetSession(createWorkbook("p", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["a"], ["b"], ["c"]]);
    s.setStyle("Sheet1", "A1", { fill: "#ffff00" });
    const files = unzipSync(toXlsx(s.state));
    const key = "xl/worksheets/sheet1.xml";
    // a row with a custom format whose style is the default one (locked, formulas shown): Excel writes this for any row with a fill
    const xml = strFromU8(files[key]!).replace('<row r="3"', '<row r="3" s="0" customFormat="1"');
    const { workbook } = fromXlsx(zipSync({ ...files, [key]: strToU8(xml) }));
    expect(workbook.sheets[0]!.rows?.["3"]).toBeUndefined();
  });

  it("round-trips a row that is unlocked or hides formulas", () => {
    const s = new SheetSession(createWorkbook("p", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["a"], ["b"], ["c"]]);
    s.setLocked("Sheet1", "2:2", false);
    const { workbook } = fromXlsx(toXlsx(s.state));
    expect(workbook.sheets[0]!.rows?.["2"]?.locked).toBe(false);
  });

  it("keeps a chart's alternative text through an .xlsx file", () => {
    const s = new SheetSession(createWorkbook("c", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["x", 1], ["y", 2]]);
    s.addChart("Sheet1", { type: "column", alt: "Two columns: x is 1 and y is 2", series: [{ values: "Sheet1!B1:B2" }] });
    s.addChart("Sheet1", { type: "column", series: [{ values: "Sheet1!B1:B2" }], from: { row: 10, col: 1 } });
    const { workbook } = fromXlsx(toXlsx(s.state));
    const charts = workbook.sheets[0]!.charts!;
    expect(charts.map((c) => c.alt)).toEqual(["Two columns: x is 1 and y is 2", undefined]);
  });
});

describe("rows put in and taken out at many places on a protected sheet", () => {
  it("are checked place by place: an insert needs the permission, a delete needs every cell in the rows unlocked", () => {
    const s = new SheetSession(createWorkbook("p", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["h"], [1], [2], [3], [4]]);
    s.protectSheet("Sheet1", { allow: [] });
    expect(() => s.subtotal("Sheet1", "A1:A5", { by: "A", columns: ["A"] })).toThrow(ProtectionError);
    s.unprotectSheet("Sheet1");
    s.subtotal("Sheet1", "A1:A5", { by: "A", columns: ["A"] });
    s.protectSheet("Sheet1", { allow: ["insertRows", "deleteRows"] });
    // the subtotal rows are locked, so removing them is refused on a protected sheet
    expect(() => s.removeSubtotals("Sheet1", "A1:A15")).toThrow(ProtectionError);
  });
});
