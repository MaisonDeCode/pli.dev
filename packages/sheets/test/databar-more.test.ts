import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type ConditionalRule } from "../src";

const make = (values: number[]) => {
  const s = new SheetSession(createWorkbook("Bars", ["Sheet1"]));
  s.setValues("Sheet1", "A1", values.map((v) => [v]));
  return s;
};
const bar = (s: SheetSession, a: string) => s.conditionalEffect("Sheet1", a)?.bar;
const add = (s: SheetSession, extra: object = {}) => s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:A4"], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6", ...extra } as never);
const strip = (r: ConditionalRule) => ({ ...r, id: "" });

describe("automatic ends of a data bar", () => {
  it("start at zero when every number is above it, so the lowest bar is not empty", () => {
    const s = make([10, 20, 30, 40]);
    add(s);
    expect(bar(s, "A1")?.to).toBeCloseTo(0.25);
    expect(bar(s, "A4")?.to).toBeCloseTo(1);
    const t = make([10, 20, 30, 40]);
    add(t, { min: { type: "min" }, max: { type: "max" } });
    expect(bar(t, "A1")?.to).toBe(0); // lowest value as the start leaves the first bar with nothing
  });

  it("start at the lowest number when some are negative, with the zero line where zero falls", () => {
    const s = make([-10, 0, 10, 30]);
    add(s);
    const b = bar(s, "A1")!;
    expect(b.axis).toBeCloseTo(0.25);
    expect(b.from).toBeCloseTo(0);
    expect(b.to).toBeCloseTo(0.25);
    expect(bar(s, "A4")!.to).toBeCloseTo(1);
  });

  it("are checked and only a data bar has them", () => {
    const s = make([1]);
    expect(() => s.addRule("Sheet1", { kind: "colorScale", ranges: ["A1"], stops: [{ type: "auto", color: "#ffffff" }, { type: "max", color: "#000000" }] } as never)).toThrow(/point is one of/);
    expect(() => s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["A1"], thresholds: [{ type: "auto" }, { type: "num", value: 1 }] } as never)).toThrow();
    add(s);
    expect(s.conditionalFormats("Sheet1")[0]).toMatchObject({ min: { type: "auto" }, max: { type: "auto" } });
  });
});

describe("data bars that grow from the right", () => {
  it("turn every bar about the middle of the cell", () => {
    const s = make([10, 20, 40]);
    add(s, { rtl: true });
    expect(bar(s, "A3")).toMatchObject({ from: 0, to: 1, rtl: true });
    const b = bar(s, "A1")!;
    expect(b.from).toBeCloseTo(0.75);
    expect(b.to).toBeCloseTo(1);
  });

  it("turn the zero line too", () => {
    const s = make([-10, 30]);
    add(s, { rtl: true });
    const b = bar(s, "A1")!;
    expect(b.axis).toBeCloseTo(0.75);
    expect(b.from).toBeCloseTo(0.75);
    expect(b.to).toBeCloseTo(1);
  });
});

describe("border colours of a data bar", () => {
  it("are kept for the bars and the negative ones, and drawn", () => {
    const s = make([-5, 5]);
    add(s, { border: true, borderColor: "#112233", negativeColor: "#ff0000", negativeBorderColor: "#990000" });
    expect(bar(s, "A2")).toMatchObject({ border: true, borderColor: "#112233" });
    expect(bar(s, "A1")).toMatchObject({ border: true, borderColor: "#990000", color: "#ff0000" });
  });

  it("negative bars share the positive border colour unless told otherwise", () => {
    const s = make([-5, 5]);
    add(s, { border: true, borderColor: "#112233", negativeColor: "#ff0000" });
    expect(bar(s, "A1")?.borderColor).toBe("#112233");
  });

  it("are checked", () => {
    const s = make([1]);
    expect(() => add(s, { borderColor: "red" })).toThrow(/border colour/);
    expect(() => add(s, { negativeBorderColor: "#12" })).toThrow(/negative border colour/);
  });
});

describe("the settings in XLSX files", () => {
  it("are written to Excel 2010's extension and read back unchanged", () => {
    const s = make([-5, 5, 10, 15]);
    add(s, { border: true, borderColor: "#112233", negativeColor: "#ff0000", negativeBorderColor: "#990000", rtl: true, solid: true, axisColor: "#000000" });
    const parts = unzipSync(toXlsx(s.state));
    const sheet = strFromU8(parts["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('direction="rightToLeft"');
    expect(sheet).toContain('negativeBarBorderColorSameAsPositive="0"');
    expect(sheet).toContain('<x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/>');
    expect(sheet).toContain('<x14:borderColor rgb="FF112233"/>');
    expect(sheet).toContain('<x14:negativeBorderColor rgb="FF990000"/>');
    // The older form can only say lowest and highest.
    expect(sheet).toContain('<dataBar minLength="0" maxLength="100"><cfvo type="min"/><cfvo type="max"/>');
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    expect(workbook.sheets[0]!.conditional!.map(strip)).toEqual(s.conditionalFormats("Sheet1").map(strip));
  });

  it("every bar has the extension (without it Excel saves the bar back with no axis)", () => {
    const s = make([1, 2]);
    add(s);
    expect(strFromU8(unzipSync(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!)).toContain("autoMin");
    const t = make([1, 2]);
    add(t, { min: { type: "min" }, max: { type: "max" } });
    const plain = strFromU8(unzipSync(toXlsx(t.state))["xl/worksheets/sheet1.xml"]!);
    expect(plain).toContain("x14:dataBar");
    expect(plain).toContain('axisPosition="automatic"');
  });
});
