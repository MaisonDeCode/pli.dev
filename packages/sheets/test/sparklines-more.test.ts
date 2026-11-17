import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, layoutSparkline, officeThemeColors, parseWorkbook, serializeWorkbook, sparkColor, sparklineSvg, toXlsx, type SparkShape, type SparklineGroup } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Spark", ["Sheet1", "Other"]));
  s.setValues("Sheet1", "A1", [
    ["Region", 45000, 45001, 45002, 45010],
    ["North", 1, 3, 2, 5],
    ["South", 4, -1, 2, 3],
  ]);
  return s;
};
const group = (extra: Partial<SparklineGroup> = {}): SparklineGroup => ({ id: "g", type: "line", items: [{ cell: "F2", source: "Sheet1!$B$2:$E$2" }], ...extra });
const line = (shape: SparkShape) => {
  if (shape.kind !== "line") throw new Error("not a line");
  return shape;
};
const bars = (shape: SparkShape) => {
  if (shape.kind !== "bars") throw new Error("not bars");
  return shape;
};

describe("a date axis", () => {
  it("is a row or column of dates, kept like the data, and checked", () => {
    const s = make();
    const g = s.addSparklines("Sheet1", { id: "g", location: "F2:F3", data: "B2:E3", dateAxis: "B1:E1" });
    expect(g.dateAxis).toBe("Sheet1!$B$1:$E$1");
    expect(() => s.updateSparklines("Sheet1", "g", { dateAxis: "B1:E2" })).toThrow(/one row or one column/);
    expect(() => s.updateSparklines("Sheet1", "g", { dateAxis: "nonsense" })).toThrow(/isn't a row or column of dates/);
    expect(() => s.updateSparklines("Sheet1", "g", { dateAxis: "Nope!A1:D1" })).toThrow(/no sheet/);
    s.updateSparklines("Sheet1", "g", { dateAxis: undefined });
    expect(s.sparklines("Sheet1")[0]!.dateAxis).toBeUndefined();
    s.undo();
    expect(s.sparklines("Sheet1")[0]!.dateAxis).toBe("Sheet1!$B$1:$E$1");
  });

  it("follows inserted rows and columns and a renamed sheet, and leaves the axis out when the dates are deleted", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", dateAxis: "B1:E1" });
    s.insertColumns("Sheet1", 1, 1);
    expect(s.sparklines("Sheet1")[0]!.dateAxis).toBe("Sheet1!$C$1:$F$1");
    s.insertRows("Sheet1", 1, 1);
    expect(s.sparklines("Sheet1")[0]!.dateAxis).toBe("Sheet1!$C$2:$F$2");
    s.renameSheet("Sheet1", "Data");
    expect(s.sparklines("Data")[0]!.dateAxis).toBe("Data!$C$2:$F$2");
    const dated = line(s.sparklineShape("Data", "G3", 105, 20)!).lines[0]!.map(([x]) => x);
    expect(dated[1]! - dated[0]!).toBeCloseTo(10, 5);
    s.deleteRows("Data", 2, 1);
    // The axis has nothing to read now: the points are spaced evenly again, and the file still loads.
    const shape = line(s.sparklineShape("Data", "G2", 100, 20)!);
    expect(shape.lines[0]!.map(([x]) => Math.round(x * 100) / 100)).toEqual([2.5, 34.17, 65.83, 97.5]);
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.sparklines).toEqual(s.sparklines("Data"));
  });

  it("puts the points of a line where their dates are", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", dateAxis: "B1:E1" });
    // 45000, 45001, 45002 and 45010: three days one after the other and then a long wait.
    const xs = line(s.sparklineShape("Sheet1", "F2", 105, 20)!).lines[0]!.map(([x]) => x);
    expect(xs[0]).toBeCloseTo(2.5, 5);
    expect(xs[3]).toBeCloseTo(102.5, 5);
    expect(xs[1]! - xs[0]!).toBeCloseTo(10, 5);
    expect(xs[2]! - xs[1]!).toBeCloseTo(10, 5);
    expect(xs[3]! - xs[2]!).toBeCloseTo(80, 5);
    s.updateSparklines("Sheet1", "g", { dateAxis: undefined });
    const even = line(s.sparklineShape("Sheet1", "F2", 105, 20)!).lines[0]!.map(([x]) => x);
    expect(even[1]! - even[0]!).toBeCloseTo(even[3]! - even[2]!, 5);
  });

  it("draws the points in date order, mirrors for right to left, and leaves out a point with no date", () => {
    const values = [10, 20, 30, 40];
    const dates = [4, 1, 3, null];
    const shape = line(layoutSparkline(values, group({ dateAxis: "Sheet1!$A$1:$D$1" }), 65, 20, { dates }));
    // Dates 1, 3, 4 are the values 20, 30, 10; the point with no date isn't drawn.
    expect(shape.lines[0]!.map(([x]) => Math.round(x * 100) / 100)).toEqual([2.5, 42.5, 62.5]);
    expect(shape.lines[0]![1]![1]).toBeLessThan(shape.lines[0]![0]![1]);
    const rtl = line(layoutSparkline(values, group({ dateAxis: "Sheet1!$A$1:$D$1", rightToLeft: true }), 65, 20, { dates }));
    expect(rtl.lines[0]!.map(([x]) => Math.round(x * 100) / 100)).toEqual([62.5, 22.5, 2.5]);
    // Two points on one day sit at one place, and one day alone is in the middle.
    expect(line(layoutSparkline([1, 2], group({ dateAxis: "Sheet1!$A$1:$B$1" }), 60, 20, { dates: [5, 5] })).lines[0]!.map(([x]) => x)).toEqual([30, 30]);
  });

  it("gives bars room for the smallest gap between two dates, and puts them at their dates", () => {
    const shape = bars(layoutSparkline([1, 2, 3], group({ type: "column", dateAxis: "Sheet1!$A$1:$C$1" }), 65, 20, { dates: [0, 1, 5] }));
    // Six days, so six slots of 10 (60 wide inside the padding of 2.5): bars on days 0, 1 and 5, a little in from the slot.
    expect(shape.bars.map((b) => b.x)).toEqual([3.5, 13.5, 53.5]);
    expect(shape.bars[0]!.w).toBeCloseTo(shape.bars[1]!.w, 5);
    const win = bars(layoutSparkline([1, -1, 1], group({ type: "winloss", dateAxis: "Sheet1!$A$1:$C$1" }), 65, 20, { dates: [0, 3, 4] }));
    expect(win.bars[1]!.x - win.bars[0]!.x).toBeCloseTo(3 * 12, 5);
  });

  it("leaves everything else about drawing as it was without a date axis", () => {
    const plain = layoutSparkline([1, 3, 2], group(), 60, 20);
    expect(line(plain).lines).toEqual([[[2.5, 17.5], [30, 2.5], [57.5, 10]]]);
    expect(layoutSparkline([1, 3, 2], group({ dateAxis: "Sheet1!$A$1:$C$1" }), 60, 20)).toEqual(plain);
  });

  it("ignores data in hidden columns together with its date", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", dateAxis: "B1:E1" });
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "col", index: 3, hidden: true }]);
    const xs = line(s.sparklineShape("Sheet1", "F2", 105, 20)!).lines[0]!.map(([x]) => x);
    expect(xs).toHaveLength(3);
    expect(xs[1]! - xs[0]!).toBeCloseTo(20, 5);
    expect(xs[2]! - xs[1]!).toBeCloseTo(80, 5);
  });
});

describe("theme colours", () => {
  it("are kept as the theme colour and its tint, and checked", () => {
    const s = make();
    const g = s.addSparklines("Sheet1", { location: "F2", data: "B2:E2", color: { theme: 4, tint: -0.5 }, highColor: { theme: 5 }, high: true, axisColor: "#112233" });
    expect(g.color).toEqual({ theme: 4, tint: -0.5 });
    expect(g.highColor).toEqual({ theme: 5 });
    expect(() => s.updateSparklines("Sheet1", g.id, { color: { theme: 12 } })).toThrow(/0 to 11/);
    expect(() => s.updateSparklines("Sheet1", g.id, { color: { theme: 4, tint: 2 } })).toThrow(/-1 to 1/);
    expect(() => s.updateSparklines("Sheet1", g.id, { color: 5 as never })).toThrow(/rrggbb/);
    s.updateSparklines("Sheet1", g.id, { color: { theme: 4, tint: 0 } });
    expect(s.sparklines("Sheet1")[0]!.color).toEqual({ theme: 4 });
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.sparklines).toEqual(s.sparklines("Sheet1"));
  });

  it("are looked up in the workbook's colours when drawn, and made lighter or darker by the tint", () => {
    expect(sparkColor({ theme: 4 }, "#000000")).toBe("#4472c4");
    expect(sparkColor("#123456", "#000000")).toBe("#123456");
    expect(sparkColor(undefined, "#abcdef")).toBe("#abcdef");
    // "Blue, Accent 1, Lighter 80%" is d9e1f2 and "Darker 50%" is 203864 in Office's palette.
    expect(sparkColor({ theme: 4, tint: 0.8 }, "#000000")).toBe("#d9e1f2");
    expect(sparkColor({ theme: 4, tint: -0.5 }, "#000000")).toBe("#203764");
    expect(officeThemeColors()).toHaveLength(10);
    const own = ["#ffffff", "#000000", "#eeeeee", "#111111", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];
    expect(sparkColor({ theme: 5 }, "#000000", own)).toBe("#00ff00");
  });

  it("colour the line, the dots and the bars of a drawing, from the palette of the workbook", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", color: { theme: 4, tint: -0.5 }, high: true, highColor: { theme: 5 }, showAxis: true, axisColor: { theme: 1 }, min: -5 });
    let shape = line(s.sparklineShape("Sheet1", "F2", 100, 20)!);
    expect(shape.color).toBe("#203764");
    expect(shape.dots.map((d) => d.color)).toEqual(["#ed7d31"]);
    expect(shape.axisColor).toBe("#000000");
    s.transact([{ type: "restore", workbook: { ...s.state, themeColors: ["#ffffff", "#000000", "#eeeeee", "#111111", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"] } }]);
    shape = line(s.sparklineShape("Sheet1", "F2", 100, 20)!);
    expect(shape.color).toBe(sparkColor({ theme: 4, tint: -0.5 }, "", s.state.themeColors));
    expect(shape.dots.map((d) => d.color)).toEqual(["#00ff00"]);
    expect(sparklineSvg(shape)).toContain('stroke="#000000"');
  });
});

describe("in XLSX files", () => {
  const sheetXml = (s: SheetSession) => strFromU8(unzipSync(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!);

  it("write the date axis as dateAxis with the dates after the colours, and read it back", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2:F3", data: "B2:E3", dateAxis: "B1:E1", type: "column" });
    const xml = sheetXml(s);
    expect(xml).toMatch(/<x14:sparklineGroup [^>]*dateAxis="1"/);
    expect(xml).toMatch(/<x14:colorLow rgb="FFD00000"\/><xm:f>Sheet1!B1:E1<\/xm:f><x14:sparklines>/);
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.sparklines![0]!.dateAxis).toBe("Sheet1!$B$1:$E$1");
    expect(back.workbook.sheets[0]!.sparklines).toEqual([{ ...s.sparklines("Sheet1")[0]!, id: expect.any(String) }]);
  });

  it("read a date axis written by another program, on another sheet and quoted", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", dateAxis: "B1:E1" });
    const files = unzipSync(toXlsx(s.state));
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!).replace("<xm:f>Sheet1!B1:E1</xm:f>", "<xm:f>'Other'!$B$7:$E$7</xm:f>");
    const back = fromXlsx(zipSync({ ...files, "xl/worksheets/sheet1.xml": strToU8(xml) }));
    expect(back.workbook.sheets[0]!.sparklines![0]!.dateAxis).toBe("Other!$B$7:$E$7");
    const off = strFromU8(files["xl/worksheets/sheet1.xml"]!).replace('dateAxis="1"', 'dateAxis="0"');
    expect(fromXlsx(zipSync({ ...files, "xl/worksheets/sheet1.xml": strToU8(off) })).workbook.sheets[0]!.sparklines![0]!.dateAxis).toBeUndefined();
  });

  it("write theme colours as theme and tint, with the theme part that gives them their meaning, and read them back", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", color: { theme: 4, tint: -0.5 }, negativeColor: { theme: 5 }, high: true, highColor: "#00aa00" });
    const xml = sheetXml(s);
    expect(xml).toContain('<x14:colorSeries theme="4" tint="-0.5"/>');
    expect(xml).toContain('<x14:colorNegative theme="5"/>');
    expect(xml).toContain('<x14:colorHigh rgb="FF00AA00"/>');
    const files = unzipSync(toXlsx(s.state));
    expect(strFromU8(files["xl/theme/theme1.xml"]!)).toContain('<a:accent1><a:srgbClr val="4472C4"/></a:accent1>');
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain("/xl/theme/theme1.xml");
    expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).toContain('Target="theme/theme1.xml"');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.sparklines![0]).toMatchObject({ color: { theme: 4, tint: -0.5 }, negativeColor: { theme: 5 }, highColor: "#00aa00" });
    // Office's own palette is not kept in the workbook.
    expect(back.workbook.themeColors).toBeUndefined();
  });

  it("write no theme part when nothing needs one, and keep a palette of the workbook's own", () => {
    const plain = make();
    plain.addSparklines("Sheet1", { location: "F2", data: "B2:E2", color: "#336699" });
    expect(Object.keys(unzipSync(toXlsx(plain.state))).filter((n) => n.includes("theme"))).toEqual([]);
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", color: { theme: 6 } });
    const own = ["#ffffff", "#000000", "#eeeeee", "#111111", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];
    s.transact([{ type: "restore", workbook: { ...s.state, themeColors: own } }]);
    const back = fromXlsx(toXlsx(s.state));
    expect(back.workbook.themeColors).toEqual(own);
    expect(new SheetSession(back.workbook).sparklineShape("Sheet1", "F2", 100, 20)).toMatchObject({ color: "#0000ff" });
    expect(parseWorkbook(serializeWorkbook(s.state)).themeColors).toEqual(own);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.themeColors = ["#fff"];
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/ten colours/);
  });

  it("read the colours Excel starts with as the theme colours they are, and an indexed colour as its RGB", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2", data: "B2:E2", color: "#336699", markerColor: "#00aa00", markers: true });
    const files = unzipSync(toXlsx(s.state));
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!)
      .replace('<x14:colorSeries rgb="FF336699"/>', '<x14:colorSeries theme="4" tint="-0.499984740745262"/>')
      .replace('<x14:colorMarkers rgb="FF00AA00"/>', '<x14:colorMarkers indexed="10"/>')
      .replace(/<x14:colorFirst [^>]*\/>/, '<x14:colorFirst theme="99"/>');
    const g = fromXlsx(zipSync({ ...files, "xl/worksheets/sheet1.xml": strToU8(xml) })).workbook.sheets[0]!.sparklines![0]!;
    expect(g.color).toEqual({ theme: 4, tint: -0.499984740745262 });
    expect(g.markerColor).toBe("#ff0000");
    expect(g.firstColor).toBeUndefined();
  });
});
