import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx, type Chart } from "../src";
import { errorBarAmounts, populationSd, standardError } from "../src/errorbars";
import { boxStats, histogramBins, paretoSeries, quantile, splitOfPie } from "../src/chartstats";

function book(): SheetSession {
  const s = new SheetSession(createWorkbook("Axes", ["Data"]));
  s.setValues("Data", "A1", [
    ["Month", "Sales", "Margin", "Units", "Err+", "Err-"],
    ["Jan", 10, 0.2, 5, 1, 2],
    ["Feb", 15, 0.25, 8, 2, 1],
    ["Mar", 12, 0.22, 6, 3, 3],
    ["Apr", 20, 0.3, 9, 1, 1],
    ["May", 24, 0.28, 12, 2, 4],
  ]);
  return s;
}
const cat = "Data!$A$2:$A$6";
const ser = (col: string, extra: object = {}) => ({ nameRef: `Data!$${col}$1`, values: `Data!$${col}$2:$${col}$6`, ...extra });
/** A chart without its id, and without series colours (a file always gives each series one, so the palette's are filled in on reading). */
const strip = (c: Chart) => {
  const { id: _id, ...rest } = c;
  return { ...rest, series: c.series.map(({ color: _color, ...r }) => r) };
};
const files = (s: SheetSession) => unzipSync(toXlsx(s.state));
const chartXml = (s: SheetSession, n = 1) => strFromU8(files(s)[`xl/charts/chart${n}.xml`]!);
function roundTrip(s: SheetSession) {
  const back = fromXlsx(toXlsx(s.state));
  return { back, got: back.workbook.sheets.find((x) => x.name === "Data")!.charts!.map(strip), want: s.state.sheets.find((x) => x.name === "Data")!.charts!.map(strip) };
}
const near = (a: number, b: number, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(d);

describe("axis settings are checked and tidied", () => {
  it("keeps what is set and drops what says the default", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B")], axes: { y: { min: 0, max: 40, majorUnit: 10, minorUnit: 2, majorGridlines: true, minorGridlines: true, majorTick: "out", minorTick: "in", labels: "low" }, x: { reverse: false, majorGridlines: false, labelEvery: 2 } } });
    expect(c.axes).toEqual({ y: { min: 0, max: 40, majorUnit: 10, minorUnit: 2, minorGridlines: true, minorTick: "in", labels: "low" }, x: { labelEvery: 2 } });
    s.updateChart("Data", c.id, { axes: { y: {} } });
    expect(s.charts("Data")[0]!.axes).toBeUndefined();
  });

  it("refuses settings that make no sense", () => {
    const s = book();
    const add = (axes: Chart["axes"], type: Chart["type"] = "column") => () => s.addChart("Data", { type, categories: cat, series: [ser("B")], axes });
    expect(add({ y: { min: 5, max: 5 } })).toThrow(/minimum must be below/);
    expect(add({ y: { majorUnit: 0 } })).toThrow(/majorUnit must be a number above 0/);
    expect(add({ y: { log: 1 } })).toThrow(/log base/);
    expect(add({ y: { log: 10, min: 0 } })).toThrow(/above 0 on a logarithmic/);
    expect(add({ x: { min: 0 } })).toThrow(/category axis and has no min/);
    expect(add({ y: { labelEvery: 2 } })).toThrow(/value axis and has no labelEvery/);
    expect(add({ y: { labels: "middle" as never } })).toThrow(/labels are one of/);
    expect(add({ y: { majorTick: "big" as never } })).toThrow(/majorTick is one of/);
    expect(add({ z: {} } as never)).toThrow(/axes x, y, x2 and y2/);
    expect(add({ y2: { min: 0 } }, "waterfall")).toThrow(/no second axis/);
    expect(add({ y: { crosses: "middle" as never } })).toThrow(/crossing is/);
    expect(add({ y: { bogus: 1 } as never })).toThrow(/no setting "bogus"/);
  });

  it("takes the scale of the value axis of a scatter chart on x as well", () => {
    const s = book();
    const c = s.addChart("Data", { type: "scatter", series: [ser("C", { x: "Data!$B$2:$B$6" })], axes: { x: { min: 0, max: 30, log: undefined, majorUnit: 5 }, y: { log: 10 } } });
    expect(c.axes).toEqual({ x: { min: 0, max: 30, majorUnit: 5 }, y: { log: 10 } });
  });

  it("is kept by the saved workbook and refused when misspelt", () => {
    const s = book();
    s.addChart("Data", { type: "line", categories: cat, series: [ser("B")], axes: { y: { log: 10 } } });
    const again = parseWorkbook(serializeWorkbook(s.state));
    expect(again.sheets.find((x) => x.name === "Data")!.charts![0]!.axes).toEqual({ y: { log: 10 } });
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets.find((x: { name: string }) => x.name === "Data").charts[0].axes.y.min = "low";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/min must be a number/);
  });
});

describe("error bar arithmetic", () => {
  const values = [2, 4, 4, 4, 5, 5, 7, 9];
  const none = () => undefined;
  it("works out fixed, percentage, standard deviation and standard error amounts", () => {
    expect(errorBarAmounts({ kind: "fixed", value: 2 }, [1, 2, null], none)).toMatchObject({ plus: [2, 2, null], minus: [2, 2, null] });
    expect(errorBarAmounts({ kind: "fixed" }, [1], none).plus).toEqual([1]);
    expect(errorBarAmounts({ kind: "percent", value: 10 }, [10, -20, 0], none).plus).toEqual([1, 2, 0]);
    expect(errorBarAmounts({ kind: "percent" }, [100], none).plus).toEqual([5]);
    near(populationSd(values), 2);
    expect(errorBarAmounts({ kind: "stdDev", value: 2 }, values, none).plus[0]).toBeCloseTo(4, 9);
    // sample standard deviation is sqrt(32/7); the standard error divides that by sqrt(8)
    near(standardError(values), Math.sqrt(32 / 7) / Math.sqrt(8));
    expect(errorBarAmounts({ kind: "stdErr" }, values, none).minus[3]).toBeCloseTo(Math.sqrt(32 / 7) / Math.sqrt(8), 9);
    expect(populationSd([])).toBe(0);
    expect(standardError([5])).toBe(0);
  });

  it("draws one side only when asked, and custom amounts from cells or typed in", () => {
    expect(errorBarAmounts({ kind: "fixed", value: 3, direction: "plus" }, [1, 2], none)).toMatchObject({ plus: [3, 3], minus: [0, 0] });
    expect(errorBarAmounts({ kind: "fixed", value: 3, direction: "minus" }, [1, 2], none)).toMatchObject({ plus: [0, 0], minus: [3, 3] });
    const read = (ref: string | undefined) => (ref === "P" ? [1, 2, 3] : ref === "M" ? [0.5, 0.5, 0.5] : undefined);
    const c = errorBarAmounts({ kind: "custom", plus: "P", minus: "M", endCap: false }, [10, 20, 30], read);
    expect(c).toMatchObject({ plus: [1, 2, 3], minus: [0.5, 0.5, 0.5], endCap: false });
    // typed amounts: a list, and a single number for every point; a missing side is zero
    expect(errorBarAmounts({ kind: "custom", plus: [5] }, [1, 2, 3], none)).toMatchObject({ plus: [5, 5, 5], minus: [0, 0, 0] });
    expect(errorBarAmounts({ kind: "custom", plus: [1, 2], minus: [9] }, [1, 2, 3], none)).toMatchObject({ plus: [1, 2, 0], minus: [9, 9, 9] });
  });
});

describe("error bars on a chart", () => {
  it("are checked", () => {
    const s = book();
    const add = (type: Chart["type"], errorBars: object, extra: object = {}) => () => s.addChart("Data", { type, categories: cat, series: [ser("B", { errorBars })], ...extra });
    expect(add("column", { y: { kind: "weird" } })).toThrow(/fixed, percent, stdDev, stdErr or custom/);
    expect(add("column", { y: { kind: "fixed", value: -1 } })).toThrow(/amount must be a number from 0/);
    expect(add("column", { y: { kind: "custom" } })).toThrow(/need amounts/);
    expect(add("column", { y: { kind: "custom", plus: "nonsense" } })).toThrow(/reference to cells/);
    expect(add("column", { y: { kind: "custom", plus: ["a"] } })).toThrow(/list of numbers/);
    expect(add("column", { x: { kind: "fixed" } })).toThrow(/Only scatter and bubble/);
    expect(add("pie", { y: { kind: "fixed" } })).toThrow(/can't have error bars/);
    expect(add("column", { y: { kind: "fixed" } }, { view3d: { rotX: 15, rotY: 20 } })).toThrow(/3-D chart can't have error bars/);
    expect(add("column", { y: { kind: "fixed" } }, { grouping: "percent" })).toThrow(/100% stacked/);
    expect(add("column", { y: { kind: "fixed", direction: "left" } })).toThrow(/direction/);
    expect(add("column", { y: { kind: "fixed", color: "red" } })).toThrow(/#rrggbb/);
    expect(add("column", { z: {} })).toThrow(/along x or y/);
  });

  it("tidy defaults away and are read with the chart's data", () => {
    const s = book();
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B", { errorBars: { y: { kind: "percent", value: 10, direction: "both", endCap: true } } })] });
    expect(c.series[0]!.errorBars).toEqual({ y: { kind: "percent", value: 10 } });
    const d = s.chartData("Data", c.id);
    d.series[0]!.errorBars!.y!.plus.forEach((v, i) => near(v!, [1, 1.5, 1.2, 2, 2.4][i]!));
    expect(d.series[0]!.errorBars!.y!.endCap).toBe(true);
  });

  it("follow the cells their custom amounts come from", () => {
    const s = book();
    const c = s.addChart("Data", { type: "line", categories: cat, series: [ser("B", { errorBars: { y: { kind: "custom", plus: "Data!$E$2:$E$6", minus: "Data!$F$2:$F$6" } } })] });
    expect(s.chartData("Data", c.id).series[0]!.errorBars!.y!.minus).toEqual([2, 1, 3, 1, 4]);
    s.setCell("Data", "F2", 9);
    expect(s.chartData("Data", c.id).series[0]!.errorBars!.y!.minus[0]).toBe(9);
    // a row inserted above moves the references, as for any chart reference
    s.insertRows("Data", 1, 1);
    const moved = s.charts("Data")[0]!.series[0]!.errorBars!.y!;
    expect(moved.plus).toBe("Data!$E$3:$E$7");
    expect(moved.minus).toBe("Data!$F$3:$F$7");
  });

  it("give a scatter chart bars along x as well", () => {
    const s = book();
    const c = s.addChart("Data", { type: "scatter", series: [ser("C", { x: "Data!$B$2:$B$6", errorBars: { x: { kind: "fixed", value: 2 }, y: { kind: "stdErr" } } })] });
    const d = s.chartData("Data", c.id).series[0]!.errorBars!;
    expect(d.x!.plus).toEqual([2, 2, 2, 2, 2]);
    expect(d.y!.plus.every((v) => (v as number) > 0)).toBe(true);
  });
});

describe("axis settings in XLSX", () => {
  it("writes scaling, units, gridlines, ticks, labels and crossing, and reads them back", () => {
    const s = book();
    s.addChart("Data", {
      type: "column", categories: cat, series: [ser("B")],
      axes: {
        y: { min: 0, max: 40, majorUnit: 10, minorUnit: 5, minorGridlines: true, minorTick: "out", majorTick: "cross", labels: "high", crosses: 10, format: "$#,##0" },
        x: { reverse: true, labelEvery: 2, tickEvery: 2, majorTick: "none", labels: "low", crosses: "max" },
      },
    });
    const xml = chartXml(s);
    expect(xml).toMatch(/<c:valAx>.*<c:scaling><c:orientation val="minMax"\/><c:max val="40"\/><c:min val="0"\/><\/c:scaling>/);
    expect(xml).toMatch(/<c:crossBetween val="between"\/><c:majorUnit val="10"\/><c:minorUnit val="5"\/>/);
    expect(xml).toContain('<c:numFmt formatCode="$#,##0" sourceLinked="0"/>');
    expect(xml).toMatch(/<c:minorGridlines\/>/);
    expect(xml).toMatch(/<c:catAx>.*<c:scaling><c:orientation val="maxMin"\/><\/c:scaling>/);
    expect(xml).toMatch(/<c:tickLblSkip val="2"\/><c:tickMarkSkip val="2"\/>/);
    // the category axis crosses the value axis at 10; the value axis crosses the categories at their far end
    expect(xml).toMatch(/<c:catAx>.*<c:crossesAt val="10"\/>.*<\/c:catAx>/);
    expect(xml).toMatch(/<c:valAx>.*<c:crosses val="max"\/>/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });

  it("writes a logarithmic scale and reverses a value axis", () => {
    const s = book();
    s.addChart("Data", { type: "line", categories: cat, series: [ser("B")], axes: { y: { log: 10, min: 1, max: 1000, reverse: true, majorUnit: 10 } } });
    const xml = chartXml(s);
    expect(xml).toMatch(/<c:scaling><c:logBase val="10"\/><c:orientation val="maxMin"\/><c:max val="1000"\/><c:min val="1"\/><\/c:scaling>/);
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });

  it("keeps the first-at-the-top look of a bar chart and tells reversing it from not", () => {
    const s = book();
    s.addChart("Data", { type: "bar", categories: cat, series: [ser("B")] });
    s.addChart("Data", { type: "bar", categories: cat, series: [ser("B")], axes: { x: { reverse: true } } });
    s.addChart("Data", { type: "bar", categories: cat, series: [ser("B")], axes: { x: { crosses: "min" } } });
    const one = chartXml(s, 1);
    const two = chartXml(s, 2);
    // Pli draws the first category at the top: the file says maxMin, and the value axis crosses at the far end to stay at the bottom
    expect(one).toMatch(/<c:catAx>.*<c:orientation val="maxMin"\/>/);
    expect(one).toMatch(/<c:valAx>.*<c:crosses val="max"\/>/);
    expect(two).toMatch(/<c:catAx>.*<c:orientation val="minMax"\/>/);
    expect(two).toMatch(/<c:valAx>.*<c:crosses val="autoZero"\/>/);
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });

  it("writes axes for scatter, a second value axis, hidden axes and an axis with no labels", () => {
    const s = book();
    s.addChart("Data", { type: "scatter", series: [ser("C", { x: "Data!$B$2:$B$6" }), ser("D", { x: "Data!$B$2:$B$6", axis: "secondary" })], axes: { x: { min: 0, max: 30, majorGridlines: false, minorGridlines: true }, y: { log: 2 }, y2: { min: 0, max: 20, majorUnit: 5, labels: "none" } } });
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B"), ser("C", { type: "line", axis: "secondary" })], axes: { y: { hidden: true }, y2: { max: 1, majorGridlines: true } } });
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
    expect(chartXml(s, 2)).toMatch(/<c:valAx><c:axId val="222"\/><c:scaling>.*<c:delete val="1"\/>/);
  });

  it("writes gridlines on a scatter chart's x axis as a default, as it is drawn", () => {
    const s = book();
    s.addChart("Data", { type: "scatter", series: [ser("C", { x: "Data!$B$2:$B$6" })] });
    expect(chartXml(s).match(/<c:majorGridlines\/>/g)).toHaveLength(2);
  });

  it("reads the axes of a file made elsewhere", () => {
    const s = book();
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B")] });
    const f = files(s);
    let xml = strFromU8(f["xl/charts/chart1.xml"]!);
    // what Excel would write for: min 5, max 50, major 15, log off, a crossing at 7, ticks inside, labels low, no major gridlines
    xml = xml.replace(/<c:valAx>.*<\/c:valAx>/, `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/><c:max val="50"/><c:min val="5"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="0.0" sourceLinked="0"/><c:majorTickMark val="in"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="15"/></c:valAx>`);
    xml = xml.replace('<c:crosses val="autoZero"/><c:auto', '<c:crossesAt val="7"/><c:auto');
    f["xl/charts/chart1.xml"] = new TextEncoder().encode(xml);
    const back = fromXlsx(zipSync(f));
    expect(back.workbook.sheets[0]!.charts![0]!.axes).toEqual({ y: { min: 5, max: 50, majorUnit: 15, majorGridlines: false, majorTick: "in", labels: "low", format: "0.0", crosses: 7 } });
  });
});

describe("error bars in XLSX", () => {
  const kinds: [string, object][] = [
    ["fixed", { y: { kind: "fixed", value: 3 } }],
    ["percentage on one side with no cap", { y: { kind: "percent", value: 8, direction: "plus", endCap: false } }],
    ["standard deviations", { y: { kind: "stdDev", value: 2, color: "#ff0000" } }],
    ["standard error", { y: { kind: "stdErr", direction: "minus" } }],
    ["custom from cells", { y: { kind: "custom", plus: "Data!$E$2:$E$6", minus: "Data!$F$2:$F$6" } }],
    ["custom typed in", { y: { kind: "custom", plus: [1, 2, 3, 4, 5], minus: [0.5] } }],
  ];
  for (const type of ["column", "bar", "line", "area"] as const) {
    it(`round-trips every kind on a ${type} chart`, () => {
      const s = book();
      for (const [, errorBars] of kinds) s.addChart("Data", { type, categories: cat, series: [ser("B", { errorBars })] });
      const { got, want, back } = roundTrip(s);
      expect(back.warnings).toEqual([]);
      expect(got).toEqual(want);
    });
  }

  it("writes the elements Excel uses", () => {
    const s = book();
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B", { errorBars: { y: { kind: "custom", plus: "Data!$E$2:$E$6", minus: [2] } } })] });
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B", { errorBars: { y: { kind: "percent", value: 8, direction: "plus", endCap: false, color: "#00ff00" } } })] });
    expect(chartXml(s, 1)).toMatch(/<c:errBars><c:errBarType val="both"\/><c:errValType val="cust"\/><c:noEndCap val="0"\/><c:plus><c:numRef><c:f>Data!\$E\$2:\$E\$6<\/c:f><c:numCache>.*<\/c:numRef><\/c:plus><c:minus><c:numLit>.*<c:v>2<\/c:v>.*<\/c:numLit><\/c:minus><\/c:errBars>/);
    expect(chartXml(s, 2)).toMatch(/<c:errBars><c:errBarType val="plus"\/><c:errValType val="percentage"\/><c:noEndCap val="1"\/><c:val val="8"\/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="00FF00"\/><\/a:solidFill><\/a:ln><\/c:spPr><\/c:errBars>/);
  });

  it("round-trips scatter and bubble bars along both x and y", () => {
    const s = book();
    s.addChart("Data", { type: "scatter", series: [ser("C", { x: "Data!$B$2:$B$6", errorBars: { x: { kind: "fixed", value: 1 }, y: { kind: "percent", value: 5 } } })] });
    s.addChart("Data", { type: "bubble", series: [ser("C", { x: "Data!$B$2:$B$6", size: "Data!$D$2:$D$6", errorBars: { y: { kind: "stdDev" } } })] });
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
    expect(chartXml(s, 1)).toMatch(/<c:errBars><c:errDir val="x"\/>.*<\/c:errBars><c:errBars><c:errDir val="y"\/>/);
  });

  it("round-trips a combined chart where only the line has bars", () => {
    const s = book();
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B"), ser("C", { type: "line", axis: "secondary", errorBars: { y: { kind: "fixed", value: 0.05 } } })] });
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });
});

describe("the other options in XLSX", () => {
  it("round-trips pie angles and explosion", () => {
    const s = book();
    s.addChart("Data", { type: "pie", categories: cat, firstSliceAngle: 90, labels: true, series: [ser("B", { explosion: 10, pointExplosion: { "2": 40 } })] });
    s.addChart("Data", { type: "doughnut", categories: cat, firstSliceAngle: 270, holeSize: 40, series: [ser("B", { pointExplosion: { "0": 25 } }), ser("D")] });
    s.addChart("Data", { type: "pieOfPie", categories: cat, series: [ser("B", { explosion: 5 })] });
    const xml = chartXml(s, 1);
    expect(xml).toContain('<c:firstSliceAng val="90"/>');
    expect(xml).toMatch(/<c:ser>.*<c:explosion val="10"\/><c:dPt>/);
    expect(xml).toMatch(/<c:dPt><c:idx val="2"\/><c:bubble3D val="0"\/><c:explosion val="40"\/>/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });

  it("round-trips a custom split of a pie of pie and a bar of pie", () => {
    const s = book();
    s.addChart("Data", { type: "pieOfPie", categories: cat, split: { by: "custom", at: 0, points: [0, 3] }, series: [ser("B")] });
    s.addChart("Data", { type: "barOfPie", categories: cat, split: { by: "custom", at: 0, points: [1] }, series: [ser("B")] });
    expect(chartXml(s, 1)).toMatch(/<c:splitType val="cust"\/><c:custSplit><c:secondPiePt val="0"\/><c:secondPiePt val="3"\/><\/c:custSplit><c:secondPieSize/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
    expect(() => s.addChart("Data", { type: "pieOfPie", categories: cat, split: { by: "custom", at: 0, points: [-1] }, series: [ser("B")] })).toThrow(/custom split/);
  });

  it("splits a pie of pie at the chosen points", () => {
    const { main, second } = splitOfPie([10, 20, 30, 40], { by: "custom", at: 0, points: [0, 2] });
    expect(second.map((p) => p.index)).toEqual([0, 2]);
    expect(main.map((p) => p.index)).toEqual([1, 3, null]);
    expect(main[2]!.value).toBe(40);
  });

  it("round-trips the look of a stock chart", () => {
    const s = book();
    const four = [ser("B"), ser("C"), ser("D"), ser("B")];
    s.addChart("Data", { type: "stock", stock: "ohlc", categories: cat, series: four, stockLook: { hiLowLines: false, upColor: "#00aa00", downColor: "#cc0000", gapWidth: 80 } });
    s.addChart("Data", { type: "stock", stock: "ohlc", categories: cat, series: four, stockLook: { hiLowColor: "#0000ff", upDownBars: false } });
    s.addChart("Data", { type: "stock", stock: "hlc", categories: cat, series: four.slice(0, 3), stockLook: { hiLowLines: false } });
    const xml = chartXml(s, 1);
    expect(xml).not.toContain("<c:hiLowLines");
    expect(xml).toMatch(/<c:upDownBars><c:gapWidth val="80"\/><c:upBars><c:spPr><a:solidFill><a:srgbClr val="00AA00"\/>/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
    expect(() => s.addChart("Data", { type: "stock", stock: "ohlc", categories: cat, series: four, stockLook: { gapWidth: 900 } })).toThrow(/0 to 500/);
  });

  it("round-trips label content, label positions and fonts", () => {
    const s = book();
    s.addChart("Data", { type: "column", categories: cat, labels: true, labelShow: ["category", "value"], labelPosition: "insideEnd", series: [ser("B")], font: { family: "Arial", size: 9, color: "#333333" }, titleFont: { size: 18, italic: true, bold: false, color: "#aa0000" }, title: "Sales" });
    s.addChart("Data", { type: "pie", categories: cat, labels: true, labelShow: ["category", "percent"], labelPosition: "outsideEnd", series: [ser("B")] });
    s.addChart("Data", { type: "line", categories: cat, labels: true, labelShow: ["series", "value"], labelPosition: "below", series: [ser("B")] });
    const xml = chartXml(s, 1);
    expect(xml).toContain('<c:dLblPos val="inEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="1"/>');
    expect(xml).toMatch(/<c:txPr><a:bodyPr\/><a:lstStyle\/><a:p><a:pPr><a:defRPr sz="900" b="0"><a:solidFill><a:srgbClr val="333333"\/><\/a:solidFill><a:latin typeface="Arial" pitchFamily="34" charset="0"\/>/);
    expect(xml).toMatch(/<c:title>.*sz="1800" b="0" i="1"/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
    expect(() => s.addChart("Data", { type: "column", categories: cat, labels: true, labelPosition: "above", series: [ser("B")] })).toThrow(/labels can go/);
    expect(() => s.addChart("Data", { type: "column", categories: cat, labels: true, labelShow: ["percent"], series: [ser("B")] })).toThrow(/Only pie/);
    expect(() => s.addChart("Data", { type: "column", categories: cat, font: { size: 0 }, series: [ser("B")] })).toThrow(/size is from 1 to 400/);
  });

  it("limits where labels can go to what Excel offers", () => {
    const s = book();
    expect(() => s.addChart("Data", { type: "column", grouping: "stacked", categories: cat, labels: true, labelPosition: "outsideEnd", series: [ser("B")] })).toThrow(/labels can go center, insideEnd, insideBase/);
    expect(() => s.addChart("Data", { type: "area", categories: cat, labels: true, labelPosition: "center", series: [ser("B")] })).toThrow(/no position to choose/);
  });
});

describe("explosion and angles are checked", () => {
  it("accepts 0 to 400 percent and 0 to 360 degrees", () => {
    const s = book();
    const add = (extra: object, sx: object = {}) => () => s.addChart("Data", { type: "pie", categories: cat, series: [ser("B", sx)], ...extra });
    expect(add({ firstSliceAngle: 400 })).toThrow(/0 to 360/);
    expect(add({}, { explosion: 401 })).toThrow(/0 to 400/);
    expect(add({}, { pointExplosion: { first: 5 } })).toThrow(/by point number/);
    expect(add({}, { pointExplosion: { "1": 500 } })).toThrow(/0 to 400/);
    // fields that don't belong to the kind are dropped, as the other kind options are
    const c = s.addChart("Data", { type: "column", categories: cat, series: [ser("B", { explosion: 20 })], firstSliceAngle: 30 });
    expect(c.firstSliceAngle).toBeUndefined();
    expect(c.series[0]!.explosion).toBeUndefined();
  });
});

describe("histogram bins as Excel counts them", () => {
  const data = [1, 2, 2, 3, 3, 3, 4, 4, 5, 9, 10, 18, 19, 20];
  it("counts the overflow and underflow bins among the number of bins asked for", () => {
    // 6 bins asked for: one is the underflow bin, one the overflow bin, so four are cut between 2 and 18
    const bins = histogramBins(data, { by: "count", size: 6, underflow: 2, overflow: 18 });
    expect(bins).toHaveLength(6);
    expect(bins[0]!.label).toBe("≤ 2");
    expect(bins[5]!.label).toBe("> 18");
    expect(bins.slice(1, 5).map((b) => [b.from, b.to])).toEqual([[2, 6], [6, 10], [10, 14], [14, 18]]);
    expect(bins.map((b) => b.count)).toEqual([3, 6, 2, 0, 1, 2]);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(data.length);
    // with only an overflow bin, five are cut between the smallest value and the overflow limit
    expect(histogramBins(data, { by: "count", size: 6, overflow: 18 })).toHaveLength(6);
    expect(histogramBins(data, { by: "count", size: 4 })).toHaveLength(4);
  });

  it("cuts by width from the smallest value, the last bin reaching past the largest", () => {
    const bins = histogramBins(data, { by: "width", size: 5 });
    expect(bins.map((b) => [b.from, b.to, b.count])).toEqual([[1, 6, 9], [6, 11, 2], [11, 16, 0], [16, 21, 3]]);
    expect(bins[0]!.label).toBe("[1, 6]");
    expect(bins[1]!.label).toBe("(6, 11]");
  });

  it("includes a value on the limit in the upper bin when the lower end is the closed one", () => {
    const bins = histogramBins([0, 5, 10], { by: "width", size: 5, closed: "left" });
    expect(bins.map((b) => [b.label, b.count])).toEqual([["[0, 5)", 1], ["[5, 10]", 2]]);
    const right = histogramBins([0, 5, 10], { by: "width", size: 5 });
    expect(right.map((b) => [b.label, b.count])).toEqual([["[0, 5]", 2], ["(5, 10]", 1]]);
  });

  it("uses Scott's rule for the automatic width and rounds the bin count up", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - 50.5) ** 2, 0) / 99);
    const width = (3.5 * sd) / Math.cbrt(100);
    const bins = histogramBins(v);
    near(bins[0]!.to - bins[0]!.from, width);
    expect(bins).toHaveLength(Math.ceil(99 / width));
    expect(bins[bins.length - 1]!.to).toBeGreaterThanOrEqual(100);
  });
});

describe("quartiles as Excel's two methods", () => {
  it("matches QUARTILE.EXC and QUARTILE.INC on odd and even counts", () => {
    const odd = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const even = [1, 2, 3, 4, 5, 6, 7, 8];
    // 1..9: the exclusive method leaves the median out of the halves (2.5 and 7.5), the inclusive method keeps it in (3 and 7)
    expect([quantile(odd, 0.25, "exclusive"), quantile(odd, 0.75, "exclusive")]).toEqual([2.5, 7.5]);
    expect([quantile(odd, 0.25, "inclusive"), quantile(odd, 0.75, "inclusive")]).toEqual([3, 7]);
    // 1..8: QUARTILE.EXC is 2.25 and 6.75, QUARTILE.INC is 2.75 and 6.25
    expect([quantile(even, 0.25, "exclusive"), quantile(even, 0.75, "exclusive")]).toEqual([2.25, 6.75]);
    expect([quantile(even, 0.25, "inclusive"), quantile(even, 0.75, "inclusive")]).toEqual([2.75, 6.25]);
    expect(boxStats(even, "inclusive")!.median).toBe(4.5);
  });

  it("puts the whiskers on the furthest values within 1.5 box lengths and the rest are outliers", () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 30], "inclusive")!;
    // QUARTILE.INC: Q1 3.25, Q3 7.75, so the upper fence is 7.75 + 6.75 = 14.5
    near(b.q1, 3.25);
    near(b.q3, 7.75);
    expect(b.high).toBe(9);
    expect(b.low).toBe(1);
    expect(b.outliers).toEqual([30]);
  });
});

describe("Pareto of several series", () => {
  it("orders by the first series and gives each series its own running share", () => {
    const r = paretoSeries(["a", "b", "c"], [[5, 20, 10], [4, 1, 5]]);
    expect(r.categories).toEqual(["b", "c", "a"]);
    expect(r.lines[0]!.map((p) => p.value)).toEqual([20, 10, 5]);
    expect(r.lines[1]!.map((p) => p.value)).toEqual([1, 5, 4]);
    expect(r.lines[0]!.map((p) => Math.round(p.cumulative * 1000) / 1000)).toEqual([0.571, 0.857, 1]);
    expect(r.lines[1]!.map((p) => p.cumulative)).toEqual([0.1, 0.6, 1]);
  });
});

describe("the Excel 2016 kinds with the later options", () => {
  const exPart = (s: SheetSession, n = 1) => strFromU8(files(s)[`xl/charts/chartEx${n}.xml`]!);

  it("round-trips a histogram of several series and its bin settings", () => {
    const s = book();
    s.addChart("Data", { type: "histogram", series: [ser("B"), ser("D")], bins: { by: "count", size: 4, underflow: 8, overflow: 20, closed: "left" } });
    const xml = exPart(s);
    expect(xml.match(/<cx:series layoutId="clusteredColumn"/g)).toHaveLength(2);
    expect(xml).toMatch(/<cx:binning intervalClosed="l" underflow="8" overflow="20"><cx:binCount val="4"\/><\/cx:binning>/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });

  it("round-trips a Pareto of several series", () => {
    const s = book();
    s.addChart("Data", { type: "pareto", categories: cat, series: [ser("B"), ser("D")] });
    const xml = exPart(s);
    expect(xml.match(/<cx:series layoutId="paretoLine" ownerIdx="[01]"/g)).toHaveLength(2);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });

  it("round-trips the axes, labels and connectors", () => {
    const s = book();
    s.addChart("Data", { type: "waterfall", categories: cat, series: [ser("B")], totals: [4], waterfall: { connectors: false }, labels: true, labelPosition: "insideEnd", axes: { y: { min: -5, max: 50, majorUnit: 10, minorUnit: 5, minorGridlines: true, majorTick: "in", labels: "none", format: "0.0" }, x: { majorTick: "none", hidden: true, majorGridlines: true } } });
    const xml = exPart(s);
    expect(xml).toContain('<cx:visibility connectorLines="0"/>');
    expect(xml).toContain('<cx:dataLabels pos="inEnd">');
    expect(xml).toMatch(/<cx:axis id="1"><cx:valScaling max="50" min="-5" majorUnit="10" minorUnit="5"\/>/);
    expect(xml).toMatch(/<cx:axis id="0" hidden="1">/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });

  it("refuses the settings the newer kinds don't have", () => {
    const s = book();
    expect(() => s.addChart("Data", { type: "histogram", series: [ser("B")], axes: { y: { log: 10 } } })).toThrow(/no log/);
    expect(() => s.addChart("Data", { type: "boxWhisker", series: [ser("B")], axes: { y: { reverse: true } } })).toThrow(/no reverse/);
    expect(() => s.addChart("Data", { type: "waterfall", categories: cat, series: [ser("B")], axes: { y: { labels: "low" } } })).toThrow(/beside the axis/);
  });

  it("round-trips what treemap and sunburst labels say, and fonts", () => {
    const s = book();
    s.addChart("Data", { type: "treemap", categories: cat, series: [ser("B")], labels: true, labelShow: ["value", "category", "series"], font: { family: "Arial", size: 12 }, title: "T", titleFont: { italic: true } });
    s.addChart("Data", { type: "sunburst", categories: cat, series: [ser("B")], labelShow: ["value"] });
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
    expect(exPart(s, 1)).toContain('<cx:visibility seriesName="1" categoryName="1" value="1"/>');
    expect(exPart(s, 1)).toContain("<cx:txPr>");
  });

  it("round-trips box and whisker with a quartile method and axes", () => {
    const s = book();
    s.addChart("Data", { type: "boxWhisker", series: [ser("B"), ser("D")], box: { quartile: "inclusive", meanLine: true }, axes: { y: { min: 0, max: 30 } } });
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });
});

describe("rich text in titles", () => {
  it("keeps the pieces of a title with their own looks, in a file and back", () => {
    const s = book();
    s.addChart("Data", { type: "column", categories: cat, series: [ser("B")], titleRuns: [{ text: "Sales ", bold: true, color: "#aa0000" }, { text: "by month", italic: true, underline: true, size: 11 }] });
    const c = s.charts("Data")[0]!;
    expect(c.title).toBe("Sales by month");
    expect(chartXml(s)).toMatch(/<a:r><a:rPr lang="en-US" sz="1400" b="1"><a:solidFill><a:srgbClr val="AA0000"\/><\/a:solidFill><\/a:rPr><a:t>Sales <\/a:t><\/a:r><a:r><a:rPr lang="en-US" sz="1100" b="1" i="1" u="sng">/);
    const { got, want, back } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });
  it("refuses a piece with no text", () => {
    const s = book();
    expect(() => s.addChart("Data", { type: "column", categories: cat, series: [ser("B")], titleRuns: [{ size: 0 } as never] })).toThrow(/needs text/);
  });
});
