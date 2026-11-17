import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SPARKLINE_COLORS, SheetSession, createWorkbook, fromXlsx, layoutSparkline, parseWorkbook, serializeWorkbook, sparklineSvg, toXlsx, type SparklineGroup } from "../src";

const make = () => {
  const s = new SheetSession(createWorkbook("Spark", ["Sheet1", "Other"]));
  s.setValues("Sheet1", "A1", [
    ["Region", "Q1", "Q2", "Q3", "Q4", "Trend"],
    ["North", 1, 3, 2, 5, null],
    ["South", 4, -1, 2, null, null],
    ["East", 7, 7, 7, 7, null],
  ]);
  return s;
};
const group = (extra: Partial<SparklineGroup> = {}): SparklineGroup => ({ id: "g", type: "line", items: [{ cell: "F2", source: "Sheet1!$B$2:$E$2" }], ...extra });

describe("sparklines on a sheet", () => {
  it("are put in a column of cells with a row of data for each, and undone", () => {
    const s = make();
    const g = s.addSparklines("Sheet1", { type: "column", location: "F2:F4", data: "B2:E4" });
    expect(g.items).toEqual([{ cell: "F2", source: "Sheet1!$B$2:$E$2" }, { cell: "F3", source: "Sheet1!$B$3:$E$3" }, { cell: "F4", source: "Sheet1!$B$4:$E$4" }]);
    expect(g.type).toBe("column");
    expect(s.sparklineAt("Sheet1", "F3")!.item.source).toBe("Sheet1!$B$3:$E$3");
    expect(s.sparklineAt("Sheet1", "A1")).toBeUndefined();
    s.undo();
    expect(s.sparklines("Sheet1")).toEqual([]);
  });

  it("are put in a row of cells with a column of data for each, or one cell with one row or column", () => {
    const s = make();
    const row = s.addSparklines("Sheet1", { location: "B6:E6", data: "B2:E4" });
    expect(row.items.map((i) => `${i.cell}=${i.source}`)).toEqual(["B6=Sheet1!$B$2:$B$4", "C6=Sheet1!$C$2:$C$4", "D6=Sheet1!$D$2:$D$4", "E6=Sheet1!$E$2:$E$4"]);
    const one = s.addSparklines("Sheet1", { location: "G2", data: "Other!A1:A5" });
    expect(one.items).toEqual([{ cell: "G2", source: "Other!$A$1:$A$5" }]);
  });

  it("refuse data and places that don't fit, and a cell that has one already", () => {
    const s = make();
    expect(() => s.addSparklines("Sheet1", { location: "F2:F4", data: "B2:E3" })).toThrow(/3 cells need 3 rows/);
    expect(() => s.addSparklines("Sheet1", { location: "B6:E6", data: "B2:C4" })).toThrow(/4 cells need 4 columns/);
    expect(() => s.addSparklines("Sheet1", { location: "F2", data: "B2:E4" })).toThrow(/one row or one column/);
    expect(() => s.addSparklines("Sheet1", { location: "F2:G3", data: "B2:E3" })).toThrow(/one row or one column/);
    expect(() => s.addSparklines("Sheet1", { location: "F2", data: "Nope!A1:A3" })).toThrow(/no sheet/);
    expect(() => s.addSparklines("Sheet1", { location: "F2" })).toThrow(/where the sparklines go/);
    s.addSparklines("Sheet1", { location: "F2", data: "B2:E2" });
    expect(() => s.addSparklines("Sheet1", { location: "F2", data: "B3:E3" })).toThrow(/F2 has a sparkline already/);
    expect(() => s.addSparklines("Sheet1", { type: "pie" as never, location: "F3", data: "B3:E3" })).toThrow(/sparkline is a/);
    expect(() => s.addSparklines("Sheet1", { location: "F3", data: "B3:E3", color: "red" })).toThrow(/rrggbb/);
    expect(() => s.addSparklines("Sheet1", { location: "F3", data: "B3:E3", min: 5, max: 1 })).toThrow(/below the most/);
  });

  it("read their numbers in order, with nothing for a cell that has none, and leave out hidden rows and columns unless asked", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2:F3", data: "B2:E3" });
    expect(s.sparklineValues("Sheet1", "F2")).toEqual([1, 3, 2, 5]);
    expect(s.sparklineValues("Sheet1", "F3")).toEqual([4, -1, 2, null]);
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "col", index: 3, hidden: true }]);
    expect(s.sparklineValues("Sheet1", "F2")).toEqual([1, 2, 5]);
    s.updateSparklines("Sheet1", "g", { showHidden: true });
    expect(s.sparklineValues("Sheet1", "F2")).toEqual([1, 3, 2, 5]);
    s.setCell("Sheet1", "B2", "=SUM(1,1)");
    expect(s.sparklineValues("Sheet1", "F2")[0]).toBe(2);
    s.setCell("Sheet1", "C2", "text");
    expect(s.sparklineValues("Sheet1", "F2")[1]).toBeNull();
  });

  it("are changed, taken out of cells, deleted, and checked when changed", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2:F4", data: "B2:E4" });
    s.updateSparklines("Sheet1", "g", { type: "winloss", color: "#112233", markers: true, high: true });
    expect(s.sparklines("Sheet1")[0]).toMatchObject({ type: "winloss", color: "#112233", markers: true, high: true });
    s.updateSparklines("Sheet1", "g", { markers: undefined, high: false as never, color: undefined });
    expect(s.sparklines("Sheet1")[0]).toEqual({ id: "g", type: "winloss", items: expect.any(Array) });
    expect(() => s.updateSparklines("Sheet1", "g", { lineWeight: 20 })).toThrow(/0.25 to 6/);
    expect(() => s.updateSparklines("Sheet1", "nope", {})).toThrow(/No sparklines/);
    s.clearSparklines("Sheet1", "F3:F3");
    expect(s.sparklines("Sheet1")[0]!.items.map((i) => i.cell)).toEqual(["F2", "F4"]);
    s.clearSparklines("Sheet1", "F1:F9");
    expect(s.sparklines("Sheet1")).toEqual([]);
    s.undo();
    expect(s.sparklines("Sheet1")[0]!.items).toHaveLength(2);
    s.deleteSparklines("Sheet1", "g");
    expect(s.sparklines("Sheet1")).toEqual([]);
  });

  it("stay in their cells and keep drawing their data as rows and columns are inserted and deleted, and sheets renamed", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", location: "F2:F4", data: "B2:E4" });
    s.insertRows("Sheet1", 1, 2);
    expect(s.sparklines("Sheet1")[0]!.items).toEqual([{ cell: "F4", source: "Sheet1!$B$4:$E$4" }, { cell: "F5", source: "Sheet1!$B$5:$E$5" }, { cell: "F6", source: "Sheet1!$B$6:$E$6" }]);
    expect(s.sparklineValues("Sheet1", "F4")).toEqual([1, 3, 2, 5]);
    s.insertColumns("Sheet1", 1, 1);
    expect(s.sparklines("Sheet1")[0]!.items[0]).toEqual({ cell: "G4", source: "Sheet1!$C$4:$F$4" });
    s.deleteRows("Sheet1", 5, 1); // the cell and the row of data of the second one
    expect(s.sparklines("Sheet1")[0]!.items.map((i) => i.cell)).toEqual(["G4", "G5"]);
    s.renameSheet("Sheet1", "Data");
    expect(s.sparklines("Data")[0]!.items[0]!.source).toBe("Data!$C$4:$F$4");
    expect(s.sparklineValues("Data", "G4")).toEqual([1, 3, 2, 5]);
    s.deleteRows("Data", 4, 1); // the cell of the first one goes, and the other moves up with its data
    expect(s.sparklines("Data")[0]!.items).toEqual([{ cell: "G4", source: "Data!$C$4:$F$4" }]);
    expect(s.sparklineValues("Data", "G4")).toEqual([7, 7, 7, 7]);
  });

  it("draw nothing when their data has gone", () => {
    const s = make();
    s.addSparklines("Sheet1", { location: "H2", data: "B3:E3" });
    s.deleteRows("Sheet1", 3, 1);
    expect(s.sparklineValues("Sheet1", "H2")).toEqual([]);
    expect(s.sparklineShape("Sheet1", "H2", 60, 20)).toMatchObject({ kind: "line", lines: [] });
  });

  it("are saved with the workbook and checked when it is read", () => {
    const s = make();
    s.addSparklines("Sheet1", { id: "g", type: "column", location: "F2:F3", data: "B2:E3", color: "#336699", negative: true, min: "group", max: 10, emptyAs: "zero" });
    const text = serializeWorkbook(s.state);
    expect(parseWorkbook(text).sheets[0]!.sparklines).toEqual(s.sparklines("Sheet1"));
    const bad = JSON.parse(text);
    bad.workbook.sheets[0].sparklines[0].items[0].source = "nonsense";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/isn't a row or column/);
    bad.workbook.sheets[0].sparklines[0].items[0].source = "Sheet1!$B$2:$E$2";
    bad.workbook.sheets[0].sparklines[0].extra = 1;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow();
  });

  it("can be put on a protected sheet only when formatting is allowed", () => {
    const s = make();
    s.protectSheet("Sheet1");
    expect(() => s.addSparklines("Sheet1", { location: "F2", data: "B2:E2" })).toThrow(/protected/);
    s.unprotectSheet("Sheet1");
    s.protectSheet("Sheet1", { allow: ["formatCells"] });
    s.addSparklines("Sheet1", { location: "F2", data: "B2:E2" });
  });
});

describe("how a sparkline is drawn", () => {
  it("puts a line's least at the bottom and its most at the top, evenly spaced", () => {
    const shape = layoutSparkline([1, 3, 2], group(), 60, 20);
    expect(shape).toMatchObject({ kind: "line", color: SPARKLINE_COLORS.series, weight: 0.75, dots: [] });
    if (shape.kind !== "line") throw new Error();
    expect(shape.lines).toEqual([[[2.5, 17.5], [30, 2.5], [57.5, 10]]]);
  });

  it("leaves a gap for an empty cell, joins across it, or counts it as zero", () => {
    const values = [1, null, 3];
    const lines = (g: Partial<SparklineGroup>) => (layoutSparkline(values, group(g), 60, 20) as Extract<ReturnType<typeof layoutSparkline>, { kind: "line" }>).lines;
    expect(lines({})).toHaveLength(2);
    expect(lines({ emptyAs: "span" })).toHaveLength(1);
    expect(lines({ emptyAs: "span" })[0]).toHaveLength(2);
    expect(lines({ emptyAs: "zero" })[0]).toHaveLength(3);
  });

  it("picks out points with dots: all of them, or the first, last, high, low and negative ones, each in its colour", () => {
    const dots = (g: Partial<SparklineGroup>) => (layoutSparkline([2, 5, -1, 3], group(g), 60, 20) as Extract<ReturnType<typeof layoutSparkline>, { kind: "line" }>).dots.map((d) => d.color);
    expect(dots({})).toEqual([]);
    expect(dots({ markers: true, markerColor: "#00ff00" })).toEqual(["#00ff00", "#00ff00", "#00ff00", "#00ff00"]);
    expect(dots({ first: true, last: true, high: true, low: true, firstColor: "#111111", lastColor: "#222222", highColor: "#333333", lowColor: "#444444" })).toEqual(["#111111", "#333333", "#444444", "#222222"]);
    expect(dots({ negative: true })).toEqual([SPARKLINE_COLORS.negative]);
  });

  it("grows bars from zero, with those below it in their own colour and a line along zero if asked", () => {
    const shape = layoutSparkline([2, -1, 4], group({ type: "column", color: "#336699", showAxis: true }), 60, 20);
    if (shape.kind !== "bars") throw new Error();
    expect(shape.bars.map((b) => [Math.round(b.y * 10) / 10, Math.round(b.h * 10) / 10, b.color])).toEqual([[8.5, 6, "#336699"], [14.5, 3, SPARKLINE_COLORS.negative], [2.5, 12, "#336699"]]);
    expect(shape.axis).toBeCloseTo(14.5, 5);
  });

  it("draws wins up and losses down at one height, and nothing for a tie", () => {
    const shape = layoutSparkline([1, -2, 0, 3], group({ type: "winloss" }), 60, 20);
    if (shape.kind !== "bars") throw new Error();
    expect(shape.bars.map((b) => [b.y, b.h, b.color])).toEqual([[2.5, 7.5, "#376092"], [10, 7.5, SPARKLINE_COLORS.negative], [2.5, 7.5, "#376092"]]);
  });

  it("can go from right to left, and take its axis from the group or from numbers", () => {
    const ltr = layoutSparkline([1, 2, 3], group({ type: "column" }), 60, 20);
    const rtl = layoutSparkline([1, 2, 3], group({ type: "column", rightToLeft: true }), 60, 20);
    if (ltr.kind !== "bars" || rtl.kind !== "bars") throw new Error();
    expect(rtl.bars.map((b) => b.h)).toEqual([...ltr.bars.map((b) => b.h)].reverse());
    const fixed = layoutSparkline([1, 2], group({ type: "column", max: 10 }), 60, 20);
    const auto = layoutSparkline([1, 2], group({ type: "column" }), 60, 20);
    if (fixed.kind !== "bars" || auto.kind !== "bars") throw new Error();
    expect(fixed.bars[1]!.h).toBeLessThan(auto.bars[1]!.h);
    const shared = layoutSparkline([1, 2], group({ type: "column", max: "group" }), 60, 20, { max: 8 });
    if (shared.kind !== "bars") throw new Error();
    expect(shared.bars[1]!.h).toBeCloseTo(((2 / 8) * 15), 5);
  });

  it("draws one point as a dot, nothing for no data, and the group's range from every sparkline of it", () => {
    const one = layoutSparkline([5], group(), 60, 20);
    expect(sparklineSvg(one)).toContain("<circle");
    expect(sparklineSvg(layoutSparkline([], group(), 60, 20))).not.toMatch(/polyline|rect|circle/);
    const s = make();
    s.addSparklines("Sheet1", { id: "g", type: "column", location: "F2:F3", data: "B2:E3", max: "group", min: "group" });
    const a = s.sparklineShape("Sheet1", "F2", 60, 20)!;
    const b = s.sparklineShape("Sheet1", "F3", 60, 20)!;
    if (a.kind !== "bars" || b.kind !== "bars") throw new Error();
    // 5 is the most in row 2 and 4 the most in row 3, but a shared axis draws 5 as the tallest bar of both.
    expect(a.bars.at(-1)!.h).toBeGreaterThan(b.bars[0]!.h);
    expect(s.sparklineShape("Sheet1", "A1", 60, 20)).toBeNull();
  });

  it("makes an svg with a polyline, bars, or dots", () => {
    expect(sparklineSvg(layoutSparkline([1, 3, 2], group({ markers: true }), 60, 20))).toMatch(/<polyline [^>]*points="2.5,17.5 30,2.5 57.5,10"[\s\S]*<circle/);
    expect(sparklineSvg(layoutSparkline([1, 3], group({ type: "column" }), 60, 20))).toMatch(/<rect /);
    expect(sparklineSvg(layoutSparkline([1, 3], group(), 60, 20))).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 60 20"/);
  });
});

describe("in XLSX files", () => {
  const xml = (s: SheetSession) => strFromU8(unzipSync(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!);

  it("writes groups as Excel does, in the sheet's extension list, and reads them back", () => {
    const s = make();
    s.addSparklines("Sheet1", { type: "column", location: "F2:F3", data: "B2:E3", color: "#336699", negative: true, high: true, min: 0, max: "group", emptyAs: "zero", lineWeight: 1.5, rightToLeft: true, showAxis: true, showHidden: true, negativeColor: "#aa0000" });
    s.addSparklines("Sheet1", { type: "winloss", location: "G2", data: "B3:E3" });
    s.addSparklines("Sheet1", { location: "H2", data: "Other!A1:A4", markers: true, first: true, last: true, low: true, markerColor: "#00aa00" });
    const x = xml(s);
    expect(x).toContain('<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">');
    expect(x).toContain('<x14:sparklineGroup type="column" lineWeight="1.5" displayEmptyCellsAs="zero" high="1" negative="1" displayXAxis="1" displayHidden="1" rightToLeft="1" manualMin="0" minAxisType="custom" maxAxisType="group">');
    expect(x).toContain('<x14:colorSeries rgb="FF336699"/><x14:colorNegative rgb="FFAA0000"/><x14:colorAxis rgb="FF000000"/>');
    expect(x).toContain('<x14:sparkline><xm:f>Sheet1!B2:E2</xm:f><xm:sqref>F2</xm:sqref></x14:sparkline>');
    expect(x).toContain('<x14:sparklineGroup type="stacked"');
    expect(x).toContain("<xm:f>Other!A1:A4</xm:f>");
    expect(x.indexOf("</sheetData>")).toBeLessThan(x.indexOf("<extLst>"));
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.sparklines!.map(({ id: _id, ...rest }) => rest)).toEqual(s.sparklines("Sheet1").map(({ id: _id, ...rest }) => rest));
  });

  it("quotes a sheet name that needs it, and shares the extension list with other things", () => {
    const s = new SheetSession(createWorkbook("Q", ["Plain", "Q1 sales"]));
    s.setValues("Q1 sales", "A1", [[1, 2, 3]]);
    s.setValues("Plain", "A1", [[1, 2, 3]]);
    s.addSparklines("Plain", { location: "E1", data: "'Q1 sales'!A1:C1" });
    s.addRule("Plain", { kind: "dataBar", ranges: ["A1:C1"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6" });
    const x = strFromU8(unzipSync(toXlsx(s.state))["xl/worksheets/sheet1.xml"]!);
    expect(x).toContain("<xm:f>'Q1 sales'!A1:C1</xm:f>");
    // the sparklines' extension and the data bar's are both in the sheet's one list
    expect((x.match(/<extLst>/g) ?? []).length).toBe(2); // the rule's link and the sheet's list
    expect((x.match(/<\/extLst><\/worksheet>/g) ?? []).length).toBe(1);
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.sparklines![0]!.items[0]).toEqual({ cell: "E1", source: "'Q1 sales'!$A$1:$C$1" });
    expect(back.workbook.sheets[0]!.conditional).toHaveLength(1);
  });

  it("reads Excel's own colours as left out, theme colours as theme colours, and drops what it can't read", () => {
    const s = make();
    s.addSparklines("Sheet1", { location: "F2", data: "B2:E2", color: "#336699" });
    const files = unzipSync(toXlsx(s.state));
    const edit = (fn: (t: string) => string) => fromXlsx(zipSync({ ...files, "xl/worksheets/sheet1.xml": strToU8(fn(strFromU8(files["xl/worksheets/sheet1.xml"]!))) }));
    const themed = edit((t) => t.replace('<x14:colorSeries rgb="FF336699"/>', '<x14:colorSeries theme="4"/>'));
    expect(themed.workbook.sheets[0]!.sparklines![0]!.color).toEqual({ theme: 4 });
    const broken = edit((t) => t.replace("<xm:sqref>F2</xm:sqref>", "<xm:sqref>nonsense</xm:sqref>"));
    expect(broken.workbook.sheets[0]!.sparklines).toBeUndefined();
    const twice = edit((t) => t.replace("</x14:sparklines>", "<x14:sparkline><xm:f>Sheet1!B3:E3</xm:f><xm:sqref>F2</xm:sqref></x14:sparkline></x14:sparklines>"));
    expect(twice.workbook.sheets[0]!.sparklines![0]!.items).toHaveLength(1);
  });
});
