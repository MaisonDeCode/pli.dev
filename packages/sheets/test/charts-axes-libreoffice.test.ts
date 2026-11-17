import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice reads and writes charts of its own, so it is an independent reader of what Pli writes for axis scales,
 * gridlines, tick marks, error bars, pie angles and the look of a stock chart: it has to open the file and keep the setting
 * when it saves it again, and Pli has to read what it saved. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-charts-axes-")) : "";
const lo = (args: string[]) => execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", ...args], { stdio: "ignore", timeout: 120_000 });

describe.skipIf(!SOFFICE)("axes and error bars through LibreOffice", () => {
  it("keeps scales, logarithmic axes, reversed axes, gridlines, ticks and error bars", () => {
    const s = new SheetSession(createWorkbook("axes", ["Data"]));
    s.setValues("Data", "A1", [["Month", "Sales", "Err+", "Err-"], ["Jan", 10, 1, 2], ["Feb", 150, 2, 1], ["Mar", 120, 3, 3], ["Apr", 20, 1, 1], ["May", 900, 2, 4]]);
    const cat = "Data!$A$2:$A$6";
    const v = (extra: object = {}) => ({ nameRef: "Data!$B$1", values: "Data!$B$2:$B$6", ...extra });
    s.addChart("Data", { type: "column", categories: cat, series: [v({ errorBars: { y: { kind: "fixed", value: 5 } } })], axes: { y: { min: 0, max: 1000, majorUnit: 250, minorUnit: 50, minorGridlines: true, majorTick: "cross", minorTick: "out" } } });
    s.addChart("Data", { type: "line", categories: cat, series: [v({ errorBars: { y: { kind: "custom", plus: "Data!$C$2:$C$6", minus: "Data!$D$2:$D$6" } } })], axes: { y: { log: 10, min: 1, max: 1000 }, x: { reverse: true } } });
    s.addChart("Data", { type: "bar", categories: cat, series: [v({ errorBars: { y: { kind: "percent", value: 10, direction: "plus", endCap: false } } })], axes: { y: { reverse: true, majorGridlines: false } } });
    s.addChart("Data", { type: "scatter", series: [v({ x: "Data!$C$2:$C$6", errorBars: { x: { kind: "fixed", value: 1 }, y: { kind: "stdDev", value: 1 } } })], axes: { x: { min: 0, max: 6, majorUnit: 2 }, y: { labels: "high" } } });
    writeFileSync(join(dir, "a.xlsx"), toXlsx(s.state));
    lo(["--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "a.xlsx")]);
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "a.xlsx"))));
    const charts = back.workbook.sheets[0]!.charts ?? [];
    expect(charts.map((c) => c.type)).toEqual(["column", "line", "bar", "scatter"]);
    // the column chart: the fixed scale and its unit (LibreOffice keeps no minor unit or minor gridlines of a value axis it saves)
    expect(charts[0]!.axes!.y).toMatchObject({ min: 0, max: 1000, majorUnit: 250 });
    expect(charts[0]!.series[0]!.errorBars!.y).toMatchObject({ kind: "fixed", value: 5 });
    // the line chart: a log scale, a reversed category axis, and custom bars from the same cells
    expect(charts[1]!.axes!.y).toMatchObject({ log: 10, min: 1, max: 1000 });
    expect(charts[1]!.axes!.x).toMatchObject({ reverse: true });
    expect(charts[1]!.series[0]!.errorBars!.y).toMatchObject({ kind: "custom", plus: "Data!$C$2:$C$6", minus: "Data!$D$2:$D$6" });
    // the bar chart: a reversed value axis without gridlines, and percentage bars on the plus side
    expect(charts[2]!.axes!.y).toMatchObject({ reverse: true, majorGridlines: false });
    expect(charts[2]!.series[0]!.errorBars!.y).toMatchObject({ kind: "percent", value: 10, direction: "plus" });
    // the scatter chart: bars along both x and y, and the x scale
    expect(charts[3]!.axes!.x).toMatchObject({ min: 0, max: 6, majorUnit: 2 });
    expect(charts[3]!.series[0]!.errorBars!.x).toEqual({ kind: "fixed" });
    expect(charts[3]!.series[0]!.errorBars!.y).toMatchObject({ kind: "stdDev" });
  }, 180_000);

  it("opens a pie with a first slice angle and exploded slices, and a stock chart with its own look", () => {
    const s = new SheetSession(createWorkbook("kinds", ["Data"]));
    s.setValues("Data", "A1", [["Month", "Open", "High", "Low", "Close"], ["Jan", 10, 14, 8, 12], ["Feb", 12, 15, 9, 10], ["Mar", 10, 13, 7, 13], ["Apr", 13, 18, 11, 17]]);
    const cat = "Data!$A$2:$A$5";
    const col = (c: string) => ({ nameRef: `Data!$${c}$1`, values: `Data!$${c}$2:$${c}$5` });
    s.addChart("Data", { type: "pie", categories: cat, firstSliceAngle: 120, series: [{ ...col("C"), explosion: 15, pointExplosion: { "1": 40 } }] });
    s.addChart("Data", { type: "stock", stock: "ohlc", categories: cat, series: [col("B"), col("C"), col("D"), col("E")], stockLook: { upColor: "#00aa00", downColor: "#cc0000", gapWidth: 60 } });
    s.addChart("Data", { type: "stock", stock: "hlc", categories: cat, series: [col("C"), col("D"), col("E")], stockLook: { hiLowLines: false } });
    writeFileSync(join(dir, "b.xlsx"), toXlsx(s.state));
    lo(["--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "b.xlsx")]);
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "b.xlsx"))));
    const charts = back.workbook.sheets[0]!.charts ?? [];
    expect(charts.map((c) => c.type)).toEqual(["pie", "stock", "stock"]);
    expect(charts[0]!.firstSliceAngle).toBe(120);
    expect(charts[0]!.series[0]!.pointExplosion).toMatchObject({ "1": 40 });
    expect(charts[1]!.stockLook).toMatchObject({ upColor: "#00aa00", downColor: "#cc0000" });
  }, 180_000);
});
