import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, toXlsx } from "../src";
import { boxStats, buildTree, histogramBins, paretoPoints, quantile, splitOfPie, squarify, sunburstArcs, waterfallSteps } from "../src/chartstats";
import { fitTrendline, trendlineLine } from "../src/trendline";

function book(): SheetSession {
  const s = new SheetSession(createWorkbook("More", ["Data"]));
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
const strip = (c: { id: string }) => {
  const { id: _id, ...rest } = c;
  return rest;
};
const files = (s: SheetSession) => unzipSync(toXlsx(s.state));
const part = (f: Record<string, Uint8Array>, name: string) => strFromU8(f[name]!);
function roundTrip(s: SheetSession) {
  const back = fromXlsx(toXlsx(s.state));
  return { back, got: back.workbook.sheets.find((x) => x.name === "Data")!.charts!.map(strip), want: s.state.sheets.find((x) => x.name === "Data")!.charts!.map(strip) };
}

describe("trendline maths", () => {
  const near = (a: number, b: number, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(d);

  it("fits a straight line exactly and reports R squared 1", () => {
    const { fit } = fitTrendline({ type: "linear" }, [1, 2, 3, 4], [3, 5, 7, 9]);
    near(fit!.coef[1]!, 2);
    near(fit!.coef[0]!, 1);
    near(fit!.rSquared, 1);
    expect(fit!.equation).toBe("y = 2x + 1");
  });

  it("agrees with the textbook least squares on noisy data", () => {
    // x = 1..5, y = 2.2 3.8 6.1 8.3 9.9: slope = Sxy / Sxx, intercept = ybar - slope xbar
    const xs = [1, 2, 3, 4, 5];
    const ys = [2.2, 3.8, 6.1, 8.3, 9.9];
    const xb = 3;
    const yb = ys.reduce((a, b) => a + b) / 5;
    const sxy = xs.reduce((s, x, i) => s + (x - xb) * (ys[i]! - yb), 0);
    const sxx = xs.reduce((s, x) => s + (x - xb) ** 2, 0);
    const syy = ys.reduce((s, y) => s + (y - yb) ** 2, 0);
    const { fit } = fitTrendline({ type: "linear" }, xs, ys);
    near(fit!.coef[1]!, sxy / sxx);
    near(fit!.coef[0]!, yb - (sxy / sxx) * xb);
    near(fit!.rSquared, (sxy * sxy) / (sxx * syy));
  });

  it("fits exponential, logarithmic and power curves through the reduced straight line", () => {
    const xs = [1, 2, 3, 4, 5];
    const exp = fitTrendline({ type: "exponential" }, xs, xs.map((x) => 3 * Math.exp(0.5 * x))).fit!;
    near(exp.coef[0]!, 3, 1e-7);
    near(exp.coef[1]!, 0.5, 1e-9);
    near(exp.rSquared, 1);
    const log = fitTrendline({ type: "logarithmic" }, xs, xs.map((x) => 2 * Math.log(x) + 1)).fit!;
    near(log.coef[1]!, 2);
    near(log.coef[0]!, 1);
    const pow = fitTrendline({ type: "power" }, xs, xs.map((x) => 4 * x ** 1.5)).fit!;
    near(pow.coef[0]!, 4, 1e-7);
    near(pow.coef[1]!, 1.5, 1e-9);
    expect(pow.equation).toBe("y = 4x^1.5");
    expect(exp.equation).toBe("y = 3e^0.5x");
    expect(log.equation).toBe("y = 2ln(x) + 1");
  });

  it("fits polynomials of order 2 to 6", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const f = (x: number) => 0.5 * x ** 2 - 3 * x + 4;
    const quad = fitTrendline({ type: "polynomial", order: 2 }, xs, xs.map(f)).fit!;
    near(quad.coef[2]!, 0.5);
    near(quad.coef[1]!, -3);
    near(quad.coef[0]!, 4);
    expect(quad.equation).toBe("y = 0.5x² - 3x + 4");
    const g = (x: number) => 1e-3 * x ** 6 - 0.02 * x ** 5 + 0.1 * x ** 4 - x ** 3 + 2 * x ** 2 + x - 5;
    const six = fitTrendline({ type: "polynomial", order: 6 }, xs, xs.map(g)).fit!;
    near(six.coef[6]!, 1e-3, 1e-6);
    near(six.at(7.5), g(7.5), 1e-6);
    near(six.rSquared, 1, 1e-9);
  });

  it("forces the line through an intercept, with R squared around the intercept as LINEST (const = FALSE) does", () => {
    const { fit } = fitTrendline({ type: "linear", intercept: 0 }, [1, 2, 3], [2, 4.5, 5.5]);
    // slope = sum(xy) / sum(x^2) = (2 + 9 + 16.5) / 14
    near(fit!.coef[1]!, 27.5 / 14);
    expect(fit!.coef[0]).toBe(0);
    const resid = [2 - 27.5 / 14, 4.5 - 55 / 14, 5.5 - 82.5 / 14].reduce((s, r) => s + r * r, 0);
    near(fit!.rSquared, 1 - resid / (4 + 20.25 + 30.25)); // around the intercept, here zero
  });

  it("says why a fit can't be made", () => {
    expect(fitTrendline({ type: "exponential" }, [1, 2, 3], [1, 0, 2]).problem).toMatch(/positive/);
    expect(fitTrendline({ type: "logarithmic" }, [0, 1, 2], [1, 2, 3]).problem).toMatch(/positive/);
    expect(fitTrendline({ type: "power" }, [1, 2, 3], [1, -2, 3]).problem).toMatch(/positive/);
    expect(fitTrendline({ type: "linear" }, [1], [1]).problem).toMatch(/too few/);
    expect(fitTrendline({ type: "polynomial", order: 3 }, [1, 2, 3], [1, 2, 3]).problem).toMatch(/too few/);
    expect(fitTrendline({ type: "linear" }, [2, 2, 2], [1, 2, 3]).problem).toMatch(/one x/);
  });

  it("skips missing points", () => {
    const { fit } = fitTrendline({ type: "linear" }, [1, 2, 3, 4], [3, null, 7, 9]);
    near(fit!.coef[1]!, 2);
  });

  it("draws forward and backward forecasts, and the moving average from the period-th point", () => {
    const line = trendlineLine({ type: "linear", forward: 2, backward: 1 }, [1, 2, 3, 4], [3, 5, 7, 9]);
    expect(line.points[0]).toEqual([0, 1]);
    near(line.points[1]![0], 6);
    near(line.points[1]![1], 13);
    const ma = trendlineLine({ type: "movingAverage", period: 3 }, [1, 2, 3, 4, 5], [10, 20, 30, 40, 80]);
    expect(ma.points).toEqual([[3, 20], [4, 30], [5, 50]]);
    expect(trendlineLine({ type: "movingAverage", period: 3 }, [1, 2], [1, 2]).problem).toMatch(/too few/);
    // a log curve can't run back to zero
    const log = trendlineLine({ type: "logarithmic", backward: 5 }, [1, 2, 3], [1, 2, 3]);
    expect(Math.min(...log.points.map((p) => p[0]))).toBeGreaterThan(0);
  });
});

describe("trendlines on a chart", () => {
  it("are read into the chart's data with name, equation and R squared", () => {
    const s = book();
    const c = s.addChart("Data", {
      type: "line",
      categories: "Data!$A$2:$A$6",
      series: [{ nameRef: "Data!$B$1", values: "Data!$B$2:$B$6", trendlines: [{ type: "linear", equation: true, rSquared: true, forward: 1 }, { type: "movingAverage", period: 2, name: "Smoothed" }] }],
    });
    const d = s.chartData("Data", c.id).series[0]!.trendlines!;
    expect(d.map((t) => t.name)).toEqual(["Linear (Sales)", "Smoothed"]);
    expect(d[0]!.equation).toBe("y = 3.3x + 6.3");
    expect(d[0]!.rSquared).toBeCloseTo(0.8201, 3);
    expect(d[0]!.points.at(-1)![0]).toBe(6);
    expect(d[1]!.equation).toBeUndefined();
    expect(d[1]!.points).toEqual([[2, 12.5], [3, 13.5], [4, 16], [5, 22]]);
  });

  it("use the x values of a scatter chart", () => {
    const s = book();
    const c = s.addChart("Data", { type: "scatter", series: [{ x: "Data!$B$2:$B$6", values: "Data!$D$2:$D$6", trendlines: [{ type: "linear", equation: true }] }] });
    const t = s.chartData("Data", c.id).series[0]!.trendlines![0]!;
    expect(t.points[0]![0]).toBe(10);
    expect(t.points.at(-1)![0]).toBe(24);
  });

  it("are refused where Excel has none, and checked", () => {
    const s = book();
    const trend = { trendlines: [{ type: "linear" as const }] };
    expect(() => s.addChart("Data", { type: "pie", series: [{ values: "Data!$B$2:$B$6", ...trend }] })).toThrow(/can't have trendlines/);
    expect(() => s.addChart("Data", { type: "column", grouping: "stacked", series: [{ values: "Data!$B$2:$B$6", ...trend }] })).toThrow(/stacked/);
    expect(() => s.addChart("Data", { type: "column", view3d: { rotX: 10, rotY: 10 }, series: [{ values: "Data!$B$2:$B$6", ...trend }] })).toThrow(/3-D/);
    expect(() => s.addChart("Data", { type: "line", series: [{ values: "Data!$B$2:$B$6", trendlines: [{ type: "polynomial", order: 7 }] }] })).toThrow(/order/);
    expect(() => s.addChart("Data", { type: "line", series: [{ values: "Data!$B$2:$B$6", trendlines: [{ type: "movingAverage", period: 1 }] }] })).toThrow(/period/);
    expect(() => s.addChart("Data", { type: "line", series: [{ values: "Data!$B$2:$B$6", trendlines: [{ type: "power", intercept: 1 }] }] })).toThrow(/intercept/);
    expect(() => s.addChart("Data", { type: "line", series: [{ values: "Data!$B$2:$B$6", trendlines: [{ type: "log" as never }] }] })).toThrow(/trendline is one of/);
  });

  it("go through the saved file and Excel's chart XML", () => {
    const s = book();
    s.addChart("Data", {
      type: "scatter",
      series: [
        {
          x: "Data!$B$2:$B$6",
          values: "Data!$D$2:$D$6",
          color: "#112233",
          trendlines: [
            { type: "linear", equation: true, rSquared: true, forward: 2, backward: 1, name: "Fit" },
            { type: "polynomial", order: 3, intercept: 1 } as never,
            { type: "exponential", color: "#00aa00" },
            { type: "logarithmic" },
            { type: "power" },
            { type: "movingAverage", period: 3 },
          ],
        },
      ],
    });
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.charts).toEqual(s.state.sheets[0]!.charts);
    const xml = part(files(s), "xl/charts/chart1.xml");
    expect(xml).toContain('<c:trendlineType val="linear"/>');
    expect(xml).toContain('<c:name>Fit</c:name>');
    expect(xml).toContain('<c:forward val="2"/><c:backward val="1"/>');
    expect(xml).toContain('<c:dispRSqr val="1"/><c:dispEq val="1"/>');
    for (const t of ["exp", "log", "poly", "power", "movingAvg"]) expect(xml).toContain(`<c:trendlineType val="${t}"/>`);
    expect(xml).toContain('<c:order val="3"/><c:intercept val="1"/>');
    expect(xml).toContain('<c:period val="3"/>');
    const { back, got, want } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
  });

  it("rejects unknown trendline fields in a saved workbook", () => {
    const s = book();
    s.addChart("Data", { type: "line", series: [{ values: "Data!$B$2:$B$6", trendlines: [{ type: "linear" }] }] });
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].charts[0].series[0].trendlines[0].extra = 1;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/unknown field "extra"/);
  });
});

describe("combined charts and secondary axes", () => {
  const combo = (s: SheetSession) =>
    s.addChart("Data", {
      type: "column",
      title: "Sales and margin",
      categories: "Data!$A$2:$A$6",
      yTitle: "Sales",
      y2Title: "Margin",
      series: [
        { nameRef: "Data!$B$1", values: "Data!$B$2:$B$6", color: "#4472c4" },
        { nameRef: "Data!$C$1", values: "Data!$C$2:$C$6", color: "#ed7d31", type: "line", axis: "secondary" },
        { nameRef: "Data!$D$1", values: "Data!$D$2:$D$6", color: "#a5a5a5", type: "area" },
      ],
    });

  it("keeps a kind and an axis for each series, and checks them", () => {
    const s = book();
    combo(s);
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.charts).toEqual(s.state.sheets[0]!.charts);
    expect(() => s.addChart("Data", { type: "bar", series: [{ values: "Data!$B$2:$B$6", type: "line" }] })).toThrow(/column, line or area chart/);
    expect(() => s.addChart("Data", { type: "column", series: [{ values: "Data!$B$2:$B$6", type: "pie" as never }] })).toThrow(/column, line or area/);
    expect(() => s.addChart("Data", { type: "pie", series: [{ values: "Data!$B$2:$B$6", axis: "secondary" }] })).toThrow(/no second axis/);
    expect(() => s.addChart("Data", { type: "column", view3d: { rotX: 10, rotY: 20 }, series: [{ values: "Data!$B$2:$B$6", axis: "secondary" }] })).toThrow(/3-D chart can't combine/);
  });

  it("is written as several chart elements sharing axes, with a second value axis on the right", () => {
    const s = book();
    combo(s);
    const xml = part(files(s), "xl/charts/chart1.xml");
    expect(xml.indexOf("<c:areaChart>")).toBeGreaterThan(-1);
    expect(xml.indexOf("<c:barChart>")).toBeLessThan(xml.indexOf("<c:areaChart>")); // the chart's own kind comes first
    expect(xml).toContain("<c:barChart>");
    // the area and the column share the first axes, the line is on the second
    expect(xml).toMatch(/<c:areaChart>.*<c:axId val="111"\/><c:axId val="222"\/><\/c:areaChart>/);
    expect(xml).toMatch(/<c:lineChart>.*<c:axId val="333"\/><c:axId val="444"\/><\/c:lineChart>/);
    expect(xml).toMatch(/<c:valAx><c:axId val="444"\/>.*<c:axPos val="r"\/>.*<c:crosses val="max"\/>/);
    // the second category axis is hidden unless asked for
    expect(xml).toMatch(/<c:catAx><c:axId val="333"\/><c:scaling>.*?<c:delete val="1"\/>/);
    expect(xml).toContain("Margin");
  });

  it("reads back the same chart, in any order the file lists its elements", () => {
    const s = book();
    combo(s);
    const { back, got, want } = roundTrip(s);
    expect(back.warnings).toEqual([]);
    expect(got).toEqual(want);
    // a file that lists the line before the column still has the same series, each with its own kind
    const f = files(s);
    const xml = part(f, "xl/charts/chart1.xml");
    const line = /<c:lineChart>.*<\/c:lineChart>/.exec(xml)![0];
    const moved = xml.replace(line, "").replace("<c:barChart>", `${line}<c:barChart>`);
    const alt = { ...f, "xl/charts/chart1.xml": new TextEncoder().encode(moved) };
    const again = fromXlsx(zipSync(alt)).workbook.sheets[0]!.charts![0]!;
    expect(again.series.map((x) => [x.type ?? again.type, x.axis ?? "primary"])).toEqual([["column", "primary"], ["line", "secondary"], ["area", "primary"]]);
  });

  it("shows the second category axis when asked, and a stacked column keeps its piling with a line over it", () => {
    const s = book();
    const c = combo(s);
    s.updateChart("Data", c.id, { secondaryCategoryAxis: true, x2Title: "Months again", grouping: "stacked" });
    const xml = part(files(s), "xl/charts/chart1.xml");
    expect(xml).toMatch(/<c:catAx><c:axId val="333"\/><c:scaling>.*?<c:delete val="0"\/><c:axPos val="t"\/>/);
    expect(xml).toMatch(/<c:barChart>.*?<c:grouping val="stacked"\/>/);
    expect(xml).toMatch(/<c:lineChart><c:grouping val="standard"\/>/);
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });

  it("puts scatter series on a second axis too", () => {
    const s = book();
    s.addChart("Data", { type: "scatter", series: [{ x: "Data!$B$2:$B$6", values: "Data!$D$2:$D$6", color: "#4472c4" }, { x: "Data!$B$2:$B$6", values: "Data!$C$2:$C$6", axis: "secondary", color: "#ed7d31" }], y2Title: "Margin" });
    const { got, want } = roundTrip(s);
    expect(got).toEqual(want);
  });
});

describe("the other chart kinds in XLSX", () => {
  const add = (s: SheetSession, spec: Parameters<SheetSession["addChart"]>[1]) => s.addChart("Data", { ...(spec.type === "scatter" || spec.type === "bubble" ? {} : { categories: "Data!$A$2:$A$6" }), ...spec });
  const ser = (n: string, col: string) => ({ nameRef: `Data!$${col}$1`, values: `Data!$${col}$2:$${col}$6`, color: n });

  const specs: [string, Parameters<SheetSession["addChart"]>[1], RegExp][] = [
    ["doughnut", { type: "doughnut", holeSize: 65, labels: true, series: [{ values: "Data!$B$2:$B$6" }, { values: "Data!$D$2:$D$6" }] }, /<c:doughnutChart>.*<c:holeSize val="65"\/>/],
    ["radar", { type: "radar", series: [ser("#4472c4", "B"), ser("#ed7d31", "D")] }, /<c:radarStyle val="marker"\/>/],
    ["filled radar", { type: "radar", filled: true, series: [ser("#4472c4", "B")] }, /<c:radarStyle val="filled"\/>/],
    ["bubble", { type: "bubble", bubbleScale: 150, series: [{ x: "Data!$B$2:$B$6", values: "Data!$C$2:$C$6", size: "Data!$D$2:$D$6", color: "#4472c4" }] }, /<c:bubbleChart>.*<c:bubbleSize>.*<c:bubbleScale val="150"\/>/],
    ["stock hlc", { type: "stock", stock: "hlc", series: [ser("#4472c4", "B"), ser("#ed7d31", "C"), ser("#a5a5a5", "D")] }, /<c:stockChart>.*<c:hiLowLines\/>/],
    ["stock ohlc", { type: "stock", stock: "ohlc", series: [ser("#4472c4", "B"), ser("#ed7d31", "C"), ser("#a5a5a5", "D"), ser("#ffc000", "B")] }, /<c:upDownBars>/],
    ["stock vohlc", { type: "stock", stock: "vohlc", y2Title: "Price", series: [ser("#4472c4", "B"), ser("#ed7d31", "C"), ser("#a5a5a5", "D"), ser("#ffc000", "B"), ser("#70ad47", "C")] }, /<c:barChart>.*<c:stockChart>.*<c:upDownBars>/],
    ["surface", { type: "surface", view3d: { rotX: 20, rotY: 30 }, wireframe: true, series: [ser("#4472c4", "B"), ser("#ed7d31", "C"), ser("#a5a5a5", "D")] }, /<c:surface3DChart><c:wireframe val="1"\/>/],
    ["contour", { type: "surface", view3d: { rotX: 90, rotY: 0 }, series: [ser("#4472c4", "B"), ser("#ed7d31", "C")] }, /<c:surfaceChart>/],
    ["pie of pie", { type: "pieOfPie", split: { by: "value", at: 12 }, secondSize: 60, series: [{ values: "Data!$B$2:$B$6" }] }, /<c:ofPieType val="pie"\/>.*<c:splitType val="val"\/><c:splitPos val="12"\/><c:secondPieSize val="60"\/>/],
    ["bar of pie", { type: "barOfPie", series: [{ values: "Data!$B$2:$B$6" }] }, /<c:ofPieType val="bar"\/>.*<c:splitType val="pos"\/>/],
    ["scatter straight lines, no markers", { type: "scatter", lines: true, markers: false, series: [{ x: "Data!$B$2:$B$6", values: "Data!$D$2:$D$6", color: "#4472c4" }] }, /<c:symbol val="none"\/>/],
    ["line without markers", { type: "line", markers: false, series: [ser("#4472c4", "B")] }, /<c:symbol val="none"\/>/],
  ];
  for (const [name, spec, pattern] of specs) {
    it(`${name}: written as Excel's chart and read back the same`, () => {
      const s = book();
      add(s, spec);
      const xml = part(files(s), "xl/charts/chart1.xml");
      expect(xml).toMatch(pattern);
      expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.charts).toEqual(s.state.sheets[0]!.charts);
      const { back, got, want } = roundTrip(s);
      expect(back.warnings).toEqual([]);
      expect(got).toEqual(want);
    });
  }

  it("checks the options of each kind", () => {
    const s = book();
    const one = [{ values: "Data!$B$2:$B$6" }];
    expect(() => add(s, { type: "doughnut", holeSize: 95, series: one })).toThrow(/hole/);
    expect(() => add(s, { type: "stock", stock: "ohlc", series: one })).toThrow(/needs 4 series/);
    expect(() => add(s, { type: "pieOfPie", split: { by: "position", at: 2.5 }, series: one })).toThrow(/whole number/);
    expect(() => add(s, { type: "bubble", bubbleScale: 400, series: one })).toThrow(/bubble scale/);
    expect(() => add(s, { type: "radar", view3d: { rotX: 1, rotY: 1 }, series: one })).toThrow(/can't be 3-D/);
    expect(() => add(s, { type: "histogram", bins: { by: "width" }, series: one })).toThrow(/above 0/);
    expect(() => add(s, { type: "histogram", bins: { underflow: 5, overflow: 3 }, series: one })).toThrow(/below its overflow/);
    expect(() => add(s, { type: "waterfall", totals: [-1], series: one })).toThrow(/point numbers/);
    // options of another kind are dropped
    const c = add(s, { type: "column", holeSize: 40, totals: [1], series: one });
    expect(c.holeSize).toBeUndefined();
    expect(c.totals).toBeUndefined();
  });
});

describe("Excel 2016's kinds (chartex)", () => {
  function sheet(): SheetSession {
    const s = new SheetSession(createWorkbook("Ex", ["Data"]));
    s.setValues("Data", "A1", [
      ["Step", "Amount", "Region", "Product", "Value"],
      ["Start", 100, "North", "Pens", 12],
      ["Sales", 40, "North", "Ink", 7],
      ["Costs", -30, "North", "Paper", 9],
      ["Refunds", -10, "South", "Pens", 15],
      ["Total", 100, "South", "Ink", 4],
      ["", "", "South", "Paper", 6],
    ]);
    return s;
  }
  const strip2 = (c: { id: string }) => strip(c);

  const cases: [string, Parameters<SheetSession["addChart"]>[1], RegExp[]][] = [
    ["waterfall", { type: "waterfall", title: "Cash", totals: [0, 4], labels: true, categories: "Data!$A$2:$A$6", series: [{ nameRef: "Data!$B$1", values: "Data!$B$2:$B$6" }] }, [/layoutId="waterfall"/, /<cx:subtotals><cx:idx val="0"\/><cx:idx val="4"\/><\/cx:subtotals>/, /<cx:legend pos="b"/]],
    ["histogram", { type: "histogram", bins: { by: "width", size: 5, closed: "left", overflow: 20, underflow: 6 }, series: [{ values: "Data!$E$2:$E$7" }] }, [/layoutId="clusteredColumn"/, /<cx:binning intervalClosed="l" underflow="6" overflow="20"><cx:binSize val="5"\/>/]],
    ["histogram by count", { type: "histogram", bins: { by: "count", size: 4 }, series: [{ values: "Data!$E$2:$E$7" }] }, [/<cx:binCount val="4"\/>/]],
    ["pareto", { type: "pareto", categories: "Data!$D$2:$D$7", series: [{ values: "Data!$E$2:$E$7" }] }, [/layoutId="paretoLine"/, /<cx:axis id="2">/]],
    ["funnel", { type: "funnel", labels: true, categories: "Data!$A$2:$A$6", series: [{ values: "Data!$B$2:$B$6" }] }, [/layoutId="funnel"/]],
    ["box and whisker", { type: "boxWhisker", box: { quartile: "inclusive", meanMarker: false, meanLine: true, innerPoints: true, outliers: false }, categories: "Data!$C$2:$C$7", series: [{ values: "Data!$E$2:$E$7", color: "#4472c4" }, { values: "Data!$B$2:$B$7", color: "#ed7d31" }] }, [/layoutId="boxWhisker"/, /quartileMethod="inclusive"/, /meanMarker="0"/, /outliers="0"/, /<cx:data id="1">/]],
    ["treemap", { type: "treemap", parentLabels: "overlapping", categories: "Data!$C$2:$D$7", series: [{ values: "Data!$E$2:$E$7" }] }, [/layoutId="treemap"/, /parentLabelLayout val="overlapping"/, /<cx:f>Data!\$C\$2:\$D\$7<\/cx:f>/]],
    ["sunburst", { type: "sunburst", categories: "Data!$C$2:$D$7", series: [{ values: "Data!$E$2:$E$7" }] }, [/layoutId="sunburst"/]],
  ];
  for (const [name, spec, patterns] of cases) {
    it(`${name}: written as a chartex part, anchored in alternate content, and read back the same`, () => {
      const s = sheet();
      s.addChart("Data", spec);
      const f = files(s);
      const xml = part(f, "xl/charts/chartEx1.xml");
      expect(xml).toContain("<cx:chartSpace");
      for (const p of patterns) expect(xml).toMatch(p);
      expect(part(f, "[Content_Types].xml")).toContain('PartName="/xl/charts/chartEx1.xml" ContentType="application/vnd.ms-office.chartex+xml"');
      expect(part(f, "xl/drawings/_rels/drawing1.xml.rels")).toContain('Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"');
      expect(part(f, "xl/drawings/drawing1.xml")).toContain("<mc:AlternateContent");
      const back = fromXlsx(toXlsx(s.state));
      expect(back.warnings).toEqual([]);
      expect(back.workbook.sheets[0]!.charts!.map(strip2)).toEqual(s.state.sheets[0]!.charts!.map(strip2));
    });
  }

  it("numbers ordinary and chartex parts together, and keeps their order on the sheet", () => {
    const s = sheet();
    s.addChart("Data", { type: "column", categories: "Data!$A$2:$A$6", series: [{ values: "Data!$B$2:$B$6" }] });
    s.addChart("Data", { type: "waterfall", categories: "Data!$A$2:$A$6", series: [{ values: "Data!$B$2:$B$6" }] });
    s.addChart("Data", { type: "line", categories: "Data!$A$2:$A$6", series: [{ values: "Data!$B$2:$B$6" }] });
    const names = Object.keys(files(s)).filter((k) => /^xl\/charts\/chart(Ex)?\d+\.xml$/.test(k)).sort();
    expect(names).toEqual(["xl/charts/chart1.xml", "xl/charts/chart3.xml", "xl/charts/chartEx2.xml"]);
    // Excel for Mac drops the drawing when a chart of Excel 2016's kinds has no style and colour part beside it.
    expect(Object.keys(files(s)).filter((k) => /chartEx2\.xml\.rels$|style2\.xml$|colors2\.xml$/.test(k)).length).toBe(3);
    expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.charts!.map((c) => c.type)).toEqual(["column", "waterfall", "line"]);
  });

  it("reads a chart of Excel 2016's kinds whose cells are named in hidden names, as Excel itself saves it", () => {
    const s = sheet();
    s.addChart("Data", { type: "waterfall", categories: "Data!$A$2:$A$6", series: [{ values: "Data!$B$2:$B$6" }] });
    const f = files(s);
    const refs: string[] = [];
    f["xl/charts/chartEx1.xml"] = strToU8(
      strFromU8(f["xl/charts/chartEx1.xml"]!)
        .replace(/<cx:f>([^<]*)<\/cx:f>/g, (_m, r: string) => `<cx:f>_xlchart.v1.${refs.push(r) - 1}</cx:f>`)
        .replace(/<cx:lvl[^>]*>.*?<\/cx:lvl>/g, ""),
    );
    const names = refs.map((r, i) => `<definedName name="_xlchart.v1.${i}" hidden="1">${r}</definedName>`).join("");
    const book = strFromU8(f["xl/workbook.xml"]!);
    f["xl/workbook.xml"] = strToU8(book.includes("<definedNames>") ? book.replace("<definedNames>", `<definedNames>${names}`) : book.replace("<calcPr", `<definedNames>${names}</definedNames><calcPr`));
    const got = fromXlsx(zipSync(f)).workbook.sheets[0]!.charts![0]!;
    expect(got.type).toBe("waterfall");
    expect(got.series[0]!.values).toBe("Data!$B$2:$B$6");
    expect(got.categories).toBe("Data!$A$2:$A$6");
  });

  it("says what it leaves out of a chartex kind it doesn't know", () => {
    const s = sheet();
    s.addChart("Data", { type: "funnel", categories: "Data!$A$2:$A$6", series: [{ values: "Data!$B$2:$B$6" }] });
    const f = files(s);
    f["xl/charts/chartEx1.xml"] = new TextEncoder().encode(part(f, "xl/charts/chartEx1.xml").replace('layoutId="funnel"', 'layoutId="regionMap"'));
    const back = fromXlsx(zipSync(f));
    expect(back.workbook.sheets[0]!.charts).toBeUndefined();
    expect(back.warnings.join(" ")).toMatch(/regionMap chart is not supported/);
  });

  it("reads treemap labels that span columns as levels", () => {
    const s = sheet();
    const c = s.addChart("Data", { type: "treemap", categories: "Data!$C$2:$D$7", series: [{ values: "Data!$E$2:$E$7" }] });
    const d = s.chartData("Data", c.id);
    expect(d.levels).toEqual([["North", "North", "North", "South", "South", "South"], ["Pens", "Ink", "Paper", "Pens", "Ink", "Paper"]]);
    expect(d.categories).toEqual(["Pens", "Ink", "Paper", "Pens", "Ink", "Paper"]);
  });
});

describe("the arithmetic of the statistical kinds", () => {
  it("bins like Excel: automatic width, a chosen width or count, overflow and underflow", () => {
    const v = [1, 2, 2, 3, 3, 3, 4, 4, 5, 9];
    const byWidth = histogramBins(v, { by: "width", size: 2 });
    expect(byWidth.map((b) => b.label)).toEqual(["[1, 3]", "(3, 5]", "(5, 7]", "(7, 9]"]);
    expect(byWidth.map((b) => b.count)).toEqual([6, 3, 0, 1]);
    const left = histogramBins(v, { by: "width", size: 2, closed: "left" });
    expect(left.map((b) => b.label)).toEqual(["[1, 3)", "[3, 5)", "[5, 7)", "[7, 9]"]);
    expect(left.map((b) => b.count)).toEqual([3, 5, 1, 1]);
    const byCount = histogramBins(v, { by: "count", size: 4 });
    expect(byCount).toHaveLength(4);
    expect(byCount[0]!.to - byCount[0]!.from).toBeCloseTo(2);
    expect(byCount.reduce((s, b) => s + b.count, 0)).toBe(10);
    const flow = histogramBins(v, { by: "width", size: 2, underflow: 2, overflow: 7 });
    expect(flow.map((b) => b.label)).toEqual(["≤ 2", "(2, 4]", "(4, 6]", "(6, 7]", "> 7"]);
    expect(flow.map((b) => b.count)).toEqual([3, 5, 1, 0, 1]);
    // automatic width is 3.5 s / n^(1/3)
    const mean = v.reduce((a, b) => a + b) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1));
    const auto = histogramBins(v);
    expect(auto[0]!.to - auto[0]!.from).toBeCloseTo((3.5 * sd) / Math.cbrt(v.length), 9);
    expect(auto.reduce((s, b) => s + b.count, 0)).toBe(10);
    expect(histogramBins([])).toEqual([]);
    expect(histogramBins([5, 5, 5])).toHaveLength(1);
  });

  it("works quartiles out like QUARTILE.INC and QUARTILE.EXC", () => {
    const sorted = [1, 3, 4, 7, 8, 12, 15];
    expect(quantile(sorted, 0.25, "inclusive")).toBe(3.5);
    expect(quantile(sorted, 0.25, "exclusive")).toBe(3);
    expect(quantile(sorted, 0.75, "inclusive")).toBe(10);
    expect(quantile(sorted, 0.75, "exclusive")).toBe(12);
    expect(quantile(sorted, 0.5, "exclusive")).toBe(7);
    const b = boxStats([1, 3, 4, 7, 8, 12, 15, 40], "inclusive")!;
    expect(b.outliers).toEqual([40]);
    expect(b.high).toBe(15);
    expect(b.mean).toBe(11.25);
    expect(boxStats([])).toBeNull();
  });

  it("lays out a waterfall, a Pareto, a split pie and a tree", () => {
    expect(waterfallSteps([100, 40, -30, 110, -10, 100], [0, 3, 5])).toEqual([
      { from: 0, to: 100, kind: "total" },
      { from: 100, to: 140, kind: "increase" },
      { from: 140, to: 110, kind: "decrease" },
      { from: 0, to: 110, kind: "total" },
      { from: 110, to: 100, kind: "decrease" },
      { from: 0, to: 100, kind: "total" },
    ]);
    const p = paretoPoints(["a", "b", "c"], [10, 60, 30]);
    expect(p.map((x) => x.category)).toEqual(["b", "c", "a"]);
    expect(p.map((x) => x.cumulative)).toEqual([0.6, 0.9, 1]);
    const split = splitOfPie([10, 20, 30, 5, 5], { by: "position", at: 2 });
    expect(split.second.map((x) => x.index)).toEqual([3, 4]);
    expect(split.main.map((x) => x.value)).toEqual([10, 20, 30, 10]);
    expect(splitOfPie([10, 20, 30, 5, 5], { by: "percent", at: 10 }).second.map((x) => x.index)).toEqual([3, 4]);
    expect(splitOfPie([1, 2], { by: "position", at: 5 }).second).toEqual([]);

    const tree = buildTree([["N", "", "", "S", ""], ["a", "b", "c", "a", "b"]], [1, 2, 3, 4, 5]);
    expect(tree.value).toBe(15);
    expect(tree.children.map((c) => [c.name, c.value, c.children.length])).toEqual([["N", 6, 3], ["S", 9, 2]]);
    const tiles = squarify(tree.children, { x: 0, y: 0, w: 100, h: 60 });
    expect(tiles.reduce((s, t) => s + t.rect.w * t.rect.h, 0)).toBeCloseTo(6000, 6);
    expect(tiles[0]!.node.name).toBe("S");
    const arcs = sunburstArcs(tree);
    expect(arcs.filter((a) => a.level === 0).map((a) => [a.node.name, a.from, a.to])).toEqual([["N", 0, 0.4], ["S", 0.4, 1]]);
    expect(arcs.filter((a) => a.level === 1)).toHaveLength(5);
  });
});
