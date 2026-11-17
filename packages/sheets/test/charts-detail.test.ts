import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, chartOrientation, switchRowsColumns, type Chart } from "../src";

function book(): SheetSession {
  const s = new SheetSession(createWorkbook("Detail", ["Data"]));
  s.setValues("Data", "A1", [
    ["Month", "Sales", "Margin", "Units"],
    ["Jan", 10, 0.2, 5],
    ["Feb", 15, 0.25, 8],
    ["Mar", 12, 0.22, 6],
    ["Apr", 20, 0.3, 9],
    ["May", 24, 0.28, 12],
  ]);
  return s;
}
const cat = "Data!$A$2:$A$6";
const ser = (col: string, extra: object = {}) => ({ nameRef: `Data!$${col}$1`, values: `Data!$${col}$2:$${col}$6`, ...extra });
const strip = (c: Chart) => {
  const { id: _id, ...rest } = c;
  return { ...rest, series: c.series.map(({ color: _color, ...r }) => r) };
};
const files = (s: SheetSession) => unzipSync(toXlsx(s.state));
const part = (s: SheetSession, name: string) => strFromU8(files(s)[`xl/charts/${name}`]!);
function roundTrip(s: SheetSession) {
  const back = fromXlsx(toXlsx(s.state));
  return { back, got: back.workbook.sheets.find((x) => x.name === "Data")!.charts!.map(strip), want: s.state.sheets.find((x) => x.name === "Data")!.charts!.map(strip) };
}

describe("colours of single points", () => {
  it("are kept, checked and drawn from the data", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B", { pointColors: { "1": "#FF0000", "3": "#00ff00" } })] });
    expect(c.series[0]!.pointColors).toEqual({ "1": "#ff0000", "3": "#00ff00" });
    expect(s.chartData("Data", c.id).series[0]!.pointColors).toEqual({ "1": "#ff0000", "3": "#00ff00" });
    expect(() => s.updateChart("Data", c.id, { series: [ser("B", { pointColors: { x: "#ff0000" } })] })).toThrow(/by point number/);
    expect(() => s.updateChart("Data", c.id, { series: [ser("B", { pointColors: { "1": "red" } })] })).toThrow(/#rrggbb/);
    // a kind with no single points drops them
    const surface = s.addChart("Data", { type: "surface", view3d: { rotX: 20, rotY: 30 }, categories: cat, series: [ser("B", { pointColors: { "0": "#ff0000" } }), ser("C")] });
    expect(surface.series[0]!.pointColors).toBeUndefined();
  });

  it("travel in XLSX as c:dPt for columns, lines, scatter points and slices", () => {
    const s = book();
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B", { color: "#4472c4", pointColors: { "2": "#c00000" } })] });
    s.addChart("Data", { type: "line", categories: cat, series: [ser("B", { color: "#4472c4", pointColors: { "0": "#00b050" } })] });
    s.addChart("Data", { type: "pie", categories: cat, series: [ser("B", { pointColors: { "1": "#123456" } })] });
    s.addChart("Data", { type: "scatter", series: [ser("B", { x: "Data!$D$2:$D$6", color: "#4472c4", pointColors: { "4": "#7030a0" } })] });
    expect(part(s, "chart1.xml")).toMatch(/<c:invertIfNegative val="0"\/><c:dPt><c:idx val="2"\/><c:invertIfNegative val="0"\/><c:bubble3D val="0"\/><c:spPr><a:solidFill><a:srgbClr val="C00000"\/>/);
    expect(part(s, "chart2.xml")).toMatch(/<c:dPt><c:idx val="0"\/><c:marker><c:symbol val="circle"\/><c:size val="5"\/><c:spPr><a:solidFill><a:srgbClr val="00B050"\/>/);
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
    expect(got[2]!.series[0]!.pointColors).toEqual({ "1": "#123456" });
  });

  it("travel in the chartex part of a waterfall, with the colours of increases, decreases and totals", () => {
    const s = book();
    s.setValues("Data", "H1", [["Step", "Amount"], ["Start", 100], ["Sales", 40], ["Costs", -30], ["End", 110]]);
    s.addChart("Data", { type: "waterfall", totals: [0, 3], categories: "Data!$H$2:$H$5", series: [{ nameRef: "Data!$I$1", values: "Data!$I$2:$I$5", pointColors: { "1": "#111111" } }], waterfall: { increaseColor: "#00aa00", decreaseColor: "#aa0000" } });
    const xml = strFromU8(files(s)["xl/charts/chartEx1.xml"]!);
    // point 0 and 3 are totals (no colour asked), 1 is an increase with its own colour, 2 a decrease
    expect(xml).toMatch(/<cx:dataPt idx="1"><cx:spPr><a:solidFill><a:srgbClr val="111111"\/>/);
    expect(xml).toMatch(/<cx:dataPt idx="2"><cx:spPr><a:solidFill><a:srgbClr val="AA0000"\/>/);
    expect(xml).not.toMatch(/<cx:dataPt idx="0"/);
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets.find((x) => x.name === "Data")!.charts![0]!;
    expect(back.series[0]!.pointColors).toEqual({ "1": "#111111", "2": "#aa0000" });
  });
});

describe("fonts and titles of single axes", () => {
  it("are kept and travel in XLSX", () => {
    const s = book();
    const c = s.addChart("Data", {
      type: "column", categories: cat, series: [ser("B"), ser("D")], legendFont: { italic: true }, labels: true, labelFont: { size: 8, color: "#ff0000" },
      axes: { x: { font: { size: 8, bold: true } }, y: { font: { family: "Courier New", size: 12 }, titleFont: { italic: true, color: "#0000ff" } } },
      yTitle: "Sales",
    });
    expect(c.axes!.y!.titleFont).toEqual({ italic: true, color: "#0000ff" });
    const xml = part(s, "chart1.xml");
    expect(xml).toMatch(/<c:tickLblPos val="nextTo"\/><c:txPr><a:bodyPr\/><a:lstStyle\/><a:p><a:pPr><a:defRPr sz="800" b="1">/);
    expect(xml).toMatch(/<a:latin typeface="Courier New" pitchFamily="49" charset="0"\/>/);
    expect(xml).toMatch(/<c:legend>.*<c:txPr>.*i="1"/);
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });

  it("can have the title in pieces, and the title's text follows", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B")], axes: { y: { titleRuns: [{ text: "Sales", bold: true, color: "#ff0000" }, { text: " in $", italic: true }] } } });
    expect(c.yTitle).toBe("Sales in $");
    const xml = part(s, "chart1.xml");
    expect(xml).toMatch(/<a:t>Sales<\/a:t>.*<a:t> in \$<\/a:t>/);
    const { got, want } = roundTrip(s);
    expect(got[0]!.axes!.y!.titleRuns).toEqual(want[0]!.axes!.y!.titleRuns);
    expect(got[0]!.yTitle).toBe("Sales in $");
    expect(() => s.updateChart("Data", c.id, { axes: { y: { font: { size: 0 } } } })).toThrow(/size is from 1 to 400/);
  });

  it("travel in the chartex axes too", () => {
    const s = book();
    s.addChart("Data", { type: "histogram", series: [ser("B")], xTitle: "Bins", axes: { x: { font: { size: 8 }, titleFont: { bold: true } } } });
    const back = fromXlsx(toXlsx(s.state)).workbook.sheets.find((x) => x.name === "Data")!.charts![0]!;
    expect(back.axes!.x!.font).toEqual({ size: 8 });
    expect(back.xTitle).toBe("Bins");
  });
});

describe("the label of a trendline", () => {
  const withTrend = (label: object, extra: object = {}) => {
    const s = book();
    const c = s.addChart("Data", { type: "scatter", series: [{ name: "S", x: "Data!$B$2:$B$6", values: "Data!$D$2:$D$6", trendlines: [{ type: "linear", equation: true, rSquared: true, label, ...extra }] }] });
    return { s, c };
  };

  it("is worked out with its number format, or says its own text", () => {
    const { s, c } = withTrend({ format: "0.00" });
    const t = s.chartData("Data", c.id).series[0]!.trendlines![0]!;
    expect(t.labelLines![0]).toMatch(/^y = -?\d+\.\d\dx( [+-] \d+\.\d\d)?$/);
    expect(t.labelLines![1]).toMatch(/^R² = \d\.\d\d$/);
    s.updateChart("Data", c.id, { series: [{ ...c.series[0]!, trendlines: [{ type: "linear", equation: true, label: { text: "Fit" } }] }] });
    expect(s.chartData("Data", c.id).series[0]!.trendlines![0]!.labelLines).toEqual(["Fit"]);
  });

  it("is moved by an offset and kept only while a label is shown", () => {
    const { s, c } = withTrend({ x: -0.1, y: 0.25, font: { size: 9 } });
    expect(c.series[0]!.trendlines![0]!.label).toEqual({ x: -0.1, y: 0.25, font: { size: 9 } });
    expect(s.chartData("Data", c.id).series[0]!.trendlines![0]!.labelOffset).toEqual({ x: -0.1, y: 0.25 });
    s.updateChart("Data", c.id, { series: [{ ...c.series[0]!, trendlines: [{ type: "linear", label: { x: 0.1 } }] }] });
    expect(s.charts("Data")[0]!.series[0]!.trendlines![0]!.label).toBeUndefined();
    expect(() => s.updateChart("Data", c.id, { series: [{ ...c.series[0]!, trendlines: [{ type: "linear", equation: true, label: { x: 4 } }] }] })).toThrow(/from -1 to 1/);
  });

  it("travels in XLSX as c:trendlineLbl", () => {
    const { s } = withTrend({ format: "0.000", text: "My fit", x: -0.05, y: 0.1, font: { italic: true } });
    const xml = part(s, "chart1.xml");
    expect(xml).toMatch(/<c:trendlineLbl><c:layout><c:manualLayout><c:x val="-0.05"\/><c:y val="0.1"\/><\/c:manualLayout><\/c:layout><c:tx><c:rich>.*My fit.*<c:numFmt formatCode="0.000" sourceLinked="0"\/><c:txPr>/);
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });

  it("forces the line through the intercept, and the equation says so", () => {
    const s = book();
    const c = s.addChart("Data", { type: "scatter", series: [{ name: "S", x: "Data!$B$2:$B$6", values: "Data!$D$2:$D$6", trendlines: [{ type: "linear", equation: true, rSquared: true, intercept: 2 }] }] });
    const t = s.chartData("Data", c.id).series[0]!.trendlines![0]!;
    expect(t.equation).toMatch(/\+ 2$/);
    expect(t.points[0]![1]).toBeCloseTo(2 + Number(t.equation!.match(/= ([\d.]+)x/)![1]) * t.points[0]![0], 3);
    expect(roundTrip(s).got).toEqual(roundTrip(s).want);
  });
});

describe("3-D views", () => {
  it("keep perspective, right angles and depth, in the model and in XLSX", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B")], view3d: { rotX: 25, rotY: 40, perspective: 30, depth: 150 } });
    expect(c.view3d).toEqual({ rotX: 25, rotY: 40, perspective: 30, depth: 150 });
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B")], view3d: { rotX: 15, rotY: 20, rightAngle: true, perspective: 15 } });
    const xml = part(s, "chart1.xml");
    // the file holds twice the angle Excel's pane shows
    expect(xml).toContain('<c:depthPercent val="150"/><c:rAngAx val="0"/><c:perspective val="60"/>');
    expect(part(s, "chart2.xml")).toContain('<c:rAngAx val="1"/></c:view3D>');
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
    expect(() => s.updateChart("Data", c.id, { view3d: { rotX: 25, rotY: 40, perspective: 400 } })).toThrow(/angle of view/);
  });

  it("are refused for a scatter chart, as Excel has no 3-D scatter, and bubbles can be spheres", () => {
    const s = book();
    expect(() => s.addChart("Data", { type: "scatter", series: [ser("B", { x: "Data!$D$2:$D$6" })], view3d: { rotX: 10, rotY: 10 } })).toThrow(/Excel has none/);
    const b = s.addChart("Data", { type: "bubble", bubble3d: true, series: [ser("B", { x: "Data!$D$2:$D$6", size: "Data!$C$2:$C$6" })] });
    expect(b.bubble3d).toBe(true);
    expect(part(s, "chart1.xml")).toContain('<c:bubble3D val="1"/>');
    expect(roundTrip(s).got).toEqual(roundTrip(s).want);
  });
});

describe("combined charts, the rest", () => {
  it("draw a series as scatter points on the category numbers, in the model and in XLSX", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B"), ser("D", { type: "scatter", x: "Data!$C$2:$C$6" })] });
    expect(c.series[1]!.type).toBe("scatter");
    // without x values of its own the points stand at 1, 2, 3...
    const plain = s.addChart("Data", { type: "line", categories: cat, series: [ser("B"), ser("D", { type: "scatter" })] });
    expect(s.chartData("Data", plain.id).series[1]!.x).toEqual([1, 2, 3, 4, 5]);
    const xml = part(s, "chart1.xml");
    expect(xml).toMatch(/<c:barChart>.*<\/c:barChart><c:scatterChart>.*<c:xVal>.*<c:axId val="111"\/><c:axId val="222"\/><\/c:scatterChart><c:catAx>/);
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });

  it("pile up the series of a second kind on their own", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", grouping: "stacked", kindGrouping: { line: "stacked", area: "percent" }, categories: cat, series: [ser("B"), ser("D"), ser("B", { type: "line" }), ser("D", { type: "line" })] });
    // area has no series, so its grouping goes
    expect(c.kindGrouping).toEqual({ line: "stacked" });
    const xml = part(s, "chart1.xml");
    expect(xml).toMatch(/<c:lineChart><c:grouping val="stacked"\/>/);
    const { back, got, want } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });
});

describe("series by rows", () => {
  function across(): SheetSession {
    const s = new SheetSession(createWorkbook("Rows", ["Data"]));
    s.setValues("Data", "A1", [["", "Jan", "Feb", "Mar"], ["North", 10, 20, 30], ["South", 5, 6, 7]]);
    return s;
  }

  it("makes a chart whose series are the rows", () => {
    const s = across();
    const c = s.insertChart("Data", "A1:D3", { seriesIn: "rows" });
    expect(c.categories).toBe("Data!$B$1:$D$1");
    expect(c.series.map((x) => [x.nameRef, x.values])).toEqual([["Data!$A$2", "Data!$B$2:$D$2"], ["Data!$A$3", "Data!$B$3:$D$3"]]);
    expect(s.chartData("Data", c.id).series.map((x) => x.values)).toEqual([[10, 20, 30], [5, 6, 7]]);
    expect(chartOrientation(c, "Data")).toBe("rows");
    expect(roundTrip(s).got).toEqual(roundTrip(s).want);
  });

  it("switches the rows and columns of a chart, both ways, in one undo step", () => {
    const s = across();
    const c = s.insertChart("Data", "A1:D3", { seriesIn: "rows" });
    const switched = s.switchChartRowsColumns("Data", c.id);
    expect(switched.categories).toBe("Data!$A$2:$A$3");
    expect(switched.series.map((x) => [x.nameRef, x.values])).toEqual([
      ["Data!$B$1", "Data!$B$2:$B$3"],
      ["Data!$C$1", "Data!$C$2:$C$3"],
      ["Data!$D$1", "Data!$D$2:$D$3"],
    ]);
    expect(s.chartSeriesIn("Data", c.id)).toBe("columns");
    expect(s.chartData("Data", c.id).series.map((x) => x.values)).toEqual([[10, 5], [20, 6], [30, 7]]);
    const back = s.switchChartRowsColumns("Data", c.id);
    expect(back.series.map((x) => x.values)).toEqual(["Data!$B$2:$D$2", "Data!$B$3:$D$3"]);
    s.undo();
    expect(s.chartSeriesIn("Data", c.id)).toBe("columns");
    s.undo();
    expect(s.chartSeriesIn("Data", c.id)).toBe("rows");
  });

  it("refuses data that can't be switched", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B"), ser("D")] });
    expect(() => switchRowsColumns(c, "Data")).toThrow(/aren't next to each other/);
    const sc = s.addChart("Data", { type: "scatter", series: [ser("B", { x: "Data!$D$2:$D$6" })] });
    expect(() => switchRowsColumns(sc, "Data")).toThrow(/no rows and columns/);
    expect(() => s.switchChartRowsColumns("Data", "nope")).toThrow(/No chart/);
  });

  it("is saved with the workbook", () => {
    const s = across();
    s.insertChart("Data", "A1:D3", { seriesIn: "rows", type: "line" });
    const again = parseWorkbook(serializeWorkbook(s.state));
    expect(again.sheets[0]!.charts![0]!.series).toHaveLength(2);
  });
});
