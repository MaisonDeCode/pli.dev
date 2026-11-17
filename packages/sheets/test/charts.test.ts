import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseWorkbook, serializeWorkbook } from "../src";

function sales(): SheetSession {
  const s = new SheetSession(createWorkbook("Charts", ["Sales", "Other"]));
  s.setValues("Sales", "A1", [
    ["Month", "North", "South"],
    ["Jan", 10, 20],
    ["Feb", 15, 25],
    ["Mar", 12, 30],
  ]);
  return s;
}

describe("inserting a chart from cells", () => {
  it("takes labels from the first column and names from the first row", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:C4");
    expect(chart.type).toBe("column");
    expect(chart.categories).toBe("Sales!$A$2:$A$4");
    expect(chart.series.map((x) => [x.nameRef, x.values])).toEqual([
      ["Sales!$B$1", "Sales!$B$2:$B$4"],
      ["Sales!$C$1", "Sales!$C$2:$C$4"],
    ]);
    // It sits to the right of the data, level with its first row.
    expect(chart.from).toEqual({ row: 1, col: 5 });
    expect(s.chartData("Sales", chart.id)).toEqual({
      categories: ["Jan", "Feb", "Mar"],
      series: [
        { name: "North", color: "#4472c4", values: [10, 15, 12] },
        { name: "South", color: "#ed7d31", values: [20, 25, 30] },
      ],
    });
  });

  it("charts the block around a single cell", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "B2");
    expect(chart.series).toHaveLength(2);
  });

  it("uses a line chart when the labels are dates", () => {
    const s = new SheetSession(createWorkbook("d"));
    s.setValues("Sheet1", "A1", [["Day", "Hits"], ["2024-01-01", 5], ["2024-01-02", 7]]);
    expect(s.insertChart("Sheet1", "A1:B3").type).toBe("line");
  });

  it("charts a lone column of numbers with no labels, and titles it by its heading", () => {
    const s = new SheetSession(createWorkbook("one"));
    s.setValues("Sheet1", "A1", [["Score"], [3], [5], [4]]);
    const chart = s.insertChart("Sheet1", "A1:A4");
    expect(chart.categories).toBeUndefined();
    expect(chart.title).toBe("Score");
    expect(s.chartData("Sheet1", chart.id).categories).toEqual(["1", "2", "3"]);
  });

  it("keeps only the first series of a pie chart, and refuses cells with no numbers", () => {
    const s = sales();
    expect(s.insertChart("Sales", "A1:C4", { type: "pie" }).series).toHaveLength(1);
    s.setValues("Other", "A1", [["x"], ["y"]]);
    expect(() => s.insertChart("Other", "A1:A2")).toThrow(/no numbers/);
  });
});

describe("a chart follows its cells", () => {
  it("shows new values when the cells change", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:C4");
    s.setCell("Sales", "B2", 99);
    expect(s.chartData("Sales", chart.id).series[0]!.values).toEqual([99, 15, 12]);
  });

  it("follows formulas", () => {
    const s = sales();
    s.setCell("Sales", "B2", "=SUM(C2:C4)");
    const chart = s.insertChart("Sales", "A1:B4");
    expect(s.chartData("Sales", chart.id).series[0]!.values[0]).toBe(75);
  });

  it("moves with inserted rows and columns", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:C4");
    s.insertRows("Sales", 1, 2);
    const moved = s.charts("Sales")[0]!;
    expect(moved.categories).toBe("Sales!$A$4:$A$6");
    expect(moved.series[0]!.values).toBe("Sales!$B$4:$B$6");
    expect(moved.series[0]!.nameRef).toBe("Sales!$B$3");
    expect(moved.from.row).toBe(3);
    s.insertColumns("Sales", 1, 1);
    expect(s.charts("Sales")[0]!.series[0]!.values).toBe("Sales!$C$4:$C$6");
    expect(s.charts("Sales")[0]!.from.col).toBe(6);
    expect(s.chartData("Sales", chart.id).series[0]!.values).toEqual([10, 15, 12]);
  });

  it("follows a renamed sheet and loses a deleted one", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:C4");
    s.renameSheet("Sales", "Numbers");
    expect(s.charts("Numbers")[0]!.series[0]!.values).toBe("Numbers!$B$2:$B$4");
    expect(s.chartData("Numbers", chart.id).series[0]!.values).toEqual([10, 15, 12]);
    const other = s.addChart("Other", { series: [{ values: "Numbers!$B$2:$B$4" }] });
    s.deleteSheet("Numbers");
    expect(s.charts("Other")[0]!.series[0]!.values).toBe("#REF!");
    expect(s.chartData("Other", other.id).series[0]!.values).toEqual([]);
  });

  it("leaves out hidden rows, as a filter does", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:C4");
    s.setRowHeight("Sales", 3, 0);
    s.transact([{ type: "set_size", sheet: s.sheet("Sales").id, axis: "row", index: 3, hidden: true }]);
    expect(s.chartData("Sales", chart.id).categories).toEqual(["Jan", "Mar"]);
  });

  it("takes scatter x values from the series, the labels or the count", () => {
    const s = new SheetSession(createWorkbook("xy"));
    s.setValues("Sheet1", "A1", [[1, 10], [2, 14], [4, 9]]);
    const withX = s.addChart("Sheet1", { type: "scatter", series: [{ x: "Sheet1!$A$1:$A$3", values: "Sheet1!$B$1:$B$3" }] });
    expect(s.chartData("Sheet1", withX.id).series[0]!.x).toEqual([1, 2, 4]);
    const byCount = s.addChart("Sheet1", { type: "scatter", series: [{ values: "Sheet1!$B$1:$B$3" }] });
    expect(s.chartData("Sheet1", byCount.id).series[0]!.x).toEqual([1, 2, 3]);
  });
});

describe("editing charts", () => {
  it("moves, resizes and deletes, each undoable", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:C4");
    s.updateChart("Sales", chart.id, { from: { row: 6, col: 2 }, width: 300 });
    expect(s.charts("Sales")[0]).toMatchObject({ from: { row: 6, col: 2 }, width: 300 });
    s.undo();
    expect(s.charts("Sales")[0]!.width).toBe(480);
    s.deleteChart("Sales", chart.id);
    expect(s.charts("Sales")).toEqual([]);
    s.undo();
    expect(s.charts("Sales")).toHaveLength(1);
    s.undo();
    expect(s.charts("Sales")).toEqual([]);
  });

  it("makes a drag one undo step when the later moves merge into the first", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:C4");
    [2, 3, 4].forEach((row, i) => s.updateChart("Sales", chart.id, { from: { row, col: 5 } }, { merge: i > 0 }));
    expect(s.charts("Sales")[0]!.from.row).toBe(4);
    s.undo();
    expect(s.charts("Sales")[0]!.from.row).toBe(1);
  });

  it("clears a field set to undefined", () => {
    const s = sales();
    const chart = s.insertChart("Sales", "A1:B4");
    expect(chart.title).toBe("North");
    s.updateChart("Sales", chart.id, { title: undefined });
    expect(s.charts("Sales")[0]!.title).toBeUndefined();
  });

  it("refuses what a chart can't be", () => {
    const s = sales();
    expect(() => s.addChart("Sales", { series: [{ values: "not a range" }] })).toThrow(/reference/);
    expect(() => s.addChart("Sales", { series: [], width: 10 })).toThrow(/pixels/);
    expect(() => s.addChart("Sales", { series: [{ values: "Sales!A1:A3", color: "red" }] })).toThrow(/colour/);
    expect(() => s.updateChart("Sales", "nope", { title: "x" })).toThrow(/No chart/);
  });
});

describe("saving charts", () => {
  it("round-trips through the saved file and is checked on the way in", () => {
    const s = sales();
    s.insertChart("Sales", "A1:C4", { type: "line" });
    const again = parseWorkbook(serializeWorkbook(s.state));
    expect(again.sheets[0]!.charts).toEqual(s.state.sheets[0]!.charts);

    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].charts[0].type = "donut";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/chart type/);
  });
});

describe("charts in XLSX files", () => {
  const withoutId = (c: { id: string }) => {
    const { id: _id, ...rest } = c;
    return rest;
  };

  it("writes every kind of chart and reads it back the same", async () => {
    const { fromXlsx, toXlsx } = await import("../src");
    const s = sales();
    s.setValues("Sales", "A6", [["Region", "Total"], ["North", 5], ["South", 7]]);
    s.setValues("Sales", "H1", [[1, 2], [2, 5], [3, 4]]);
    const a = s.insertChart("Sales", "A1:C4", { type: "column" });
    s.updateChart("Sales", a.id, { title: "Sales & <more>", grouping: "stacked", legend: "top", yTitle: "Units", xTitle: "Month", labels: true, from: { row: 3, col: 6, dx: 10, dy: 5 }, width: 400, height: 250 });
    s.insertChart("Sales", "A1:C4", { type: "bar" });
    const line = s.insertChart("Sales", "A1:C4", { type: "line" });
    s.updateChart("Sales", line.id, { smooth: true, legend: "none", series: line.series.map((x, i) => ({ ...x, color: i ? "#00aa00" : "#aa0000" })) });
    const area = s.insertChart("Sales", "A1:C4", { type: "area" });
    s.updateChart("Sales", area.id, { grouping: "percent", legend: "left" });
    s.insertChart("Sales", "A6:B8", { type: "pie" });
    s.addChart("Sales", { type: "scatter", title: "xy", series: [{ name: "Pairs", x: "Sales!$H$1:$H$3", values: "Sales!$I$1:$I$3", color: "#123456" }], from: { row: 20, col: 2 }, smooth: false });

    const file = toXlsx(s.state);
    const back = fromXlsx(file);
    expect(back.warnings).toEqual([]);
    const got = back.workbook.sheets[0]!.charts!;
    const want = s.state.sheets[0]!.charts!;
    expect(got.map(withoutId)).toEqual(want.map(withoutId));
  });

  it("keeps charts on the right sheets and leaves a sheet without charts alone", async () => {
    const { fromXlsx, toXlsx } = await import("../src");
    const s = sales();
    s.addChart("Other", { series: [{ values: "Sales!$B$2:$B$4" }], categories: "Sales!$A$2:$A$4", from: { row: 2, col: 2 } });
    const back = fromXlsx(toXlsx(s.state));
    expect(back.workbook.sheets[0]!.charts).toBeUndefined();
    expect(back.workbook.sheets[1]!.charts).toHaveLength(1);
    expect(back.workbook.sheets[1]!.charts![0]!.series[0]!.values).toBe("Sales!$B$2:$B$4");
  });

  it("writes the values the chart shows beside its references, so other programs can draw it", async () => {
    const { toXlsx } = await import("../src");
    const { unzipSync, strFromU8 } = await import("fflate");
    const s = sales();
    s.insertChart("Sales", "A1:C4");
    const files = unzipSync(toXlsx(s.state));
    const chart = strFromU8(files["xl/charts/chart1.xml"]!);
    expect(chart).toContain("<c:f>Sales!$B$2:$B$4</c:f>");
    expect(chart).toContain("<c:v>10</c:v>");
    expect(chart).toContain("<c:v>Jan</c:v>");
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain("/xl/charts/chart1.xml");
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain('<drawing r:id="rId1"/>');
  });

  it("says what it leaves out of a chart it can't draw", async () => {
    const { fromXlsx, toXlsx } = await import("../src");
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const s = sales();
    s.insertChart("Sales", "A1:C4");
    const files = unzipSync(toXlsx(s.state));
    files["xl/charts/chart1.xml"] = strToU8(strFromU8(files["xl/charts/chart1.xml"]!).replace(/c:barChart/g, "c:unknownChart"));
    const back = fromXlsx(zipSync(files));
    expect(back.workbook.sheets[0]!.charts).toBeUndefined();
    expect(back.warnings.join(" ")).toMatch(/unknown chart is not supported/);
  });
});

describe("3-D charts", () => {
  const withoutId = (c: { id: string }) => {
    const { id: _id, ...rest } = c;
    return rest;
  };

  it("keeps the view with the chart, and refuses a view that can't be", () => {
    const s = sales();
    const c = s.insertChart("Sales", "A1:C4");
    s.updateChart("Sales", c.id, { view3d: { rotX: 30, rotY: 45 } });
    expect(s.charts("Sales")[0]!.view3d).toEqual({ rotX: 30, rotY: 45 });
    expect(parseWorkbook(serializeWorkbook(s.state)).sheets[0]!.charts![0]!.view3d).toEqual({ rotX: 30, rotY: 45 });
    s.updateChart("Sales", c.id, { view3d: undefined });
    expect(s.charts("Sales")[0]!.view3d).toBeUndefined();
    expect(() => s.updateChart("Sales", c.id, { view3d: { rotX: 95, rotY: 0 } })).toThrow(/tilted 0 to 90/);
    expect(() => s.updateChart("Sales", c.id, { view3d: { rotX: 10, rotY: 400 } })).toThrow(/turned 0 to 360/);
    const xy = s.insertChart("Sales", "A1:C4", { type: "scatter" });
    expect(() => s.updateChart("Sales", xy.id, { view3d: { rotX: 15, rotY: 20 } })).toThrow(/scatter chart can't be 3-D/);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].charts[0].view3d = { rotX: 1, rotY: 2, extra: 3 };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/unknown field "extra"/);
  });

  it("is written as Excel's 3-D charts and read back the same", async () => {
    const { fromXlsx, toXlsx } = await import("../src");
    const { unzipSync, strFromU8 } = await import("fflate");
    const s = sales();
    s.setValues("Sales", "A6", [["Region", "Total"], ["North", 5], ["South", 7]]);
    const specs = [
      ["A1:C4", "column", { view3d: { rotX: 15, rotY: 20 } }],
      ["A1:C4", "bar", { view3d: { rotX: 25, rotY: 40 }, grouping: "stacked" }],
      ["A1:C4", "line", { view3d: { rotX: 10, rotY: 350 } }],
      ["A1:C4", "area", { view3d: { rotX: 20, rotY: 30 }, grouping: "stacked" }],
      ["A1:C4", "area", { view3d: { rotX: 20, rotY: 30 } }],
      ["A6:B8", "pie", { view3d: { rotX: 40, rotY: 0 } }],
    ] as const;
    for (const [range, type, patch] of specs) {
      const c = s.insertChart("Sales", range, { type });
      s.updateChart("Sales", c.id, patch);
    }
    const file = toXlsx(s.state);
    const parts = Object.entries(unzipSync(file)).filter(([k]) => k.startsWith("xl/charts/")).map(([, v]) => strFromU8(v));
    expect(parts.map((x) => /<c:(\w+3DChart)>/.exec(x)![1])).toEqual(["bar3DChart", "bar3DChart", "line3DChart", "area3DChart", "area3DChart", "pie3DChart"]);
    expect(parts[0]).toContain('<c:view3D><c:rotX val="15"/><c:rotY val="20"/>');
    expect(parts[4]).toContain("<c:serAx>"); // standard (not piled up) area has a series axis
    expect(parts[3]).not.toContain("<c:serAx>");
    const back = fromXlsx(file);
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.charts!.map(withoutId)).toEqual(s.state.sheets[0]!.charts!.map(withoutId));
  });

  it("reads a 3-D chart that gives no view with the usual one", async () => {
    const { fromXlsx, toXlsx } = await import("../src");
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const s = sales();
    const c = s.insertChart("Sales", "A1:C4");
    s.updateChart("Sales", c.id, { view3d: { rotX: 33, rotY: 44 } });
    const files = unzipSync(toXlsx(s.state));
    files["xl/charts/chart1.xml"] = strToU8(strFromU8(files["xl/charts/chart1.xml"]!).replace(/<c:view3D>.*?<\/c:view3D>/, ""));
    expect(fromXlsx(zipSync(files)).workbook.sheets[0]!.charts![0]!.view3d).toEqual({ rotX: 15, rotY: 20 });
  });
});
