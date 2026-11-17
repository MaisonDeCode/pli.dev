import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice reads and writes charts independently of Pli. A file Pli writes must open there with every chart, and a
 * file LibreOffice writes (a different layout of the same parts) must read back as the same charts. Runs only where
 * LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-charts-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("charts through LibreOffice", () => {
  it("opens Pli's charts and writes them back as the same charts", () => {
    const s = new SheetSession(createWorkbook("charts", ["Sales"]));
    s.setValues("Sales", "A1", [["Month", "North", "South"], ["Jan", 10, 20], ["Feb", 15, 25], ["Mar", 12, 30]]);
    s.setValues("Sales", "A6", [["Region", "Total"], ["North", 37], ["South", 75]]);
    s.setValues("Sales", "E1", [[1, 3], [2, 5], [4, 4]]);
    const column = s.insertChart("Sales", "A1:C4", { type: "column" });
    s.updateChart("Sales", column.id, { title: "Sales by month", legend: "top", xTitle: "Month", yTitle: "Units", from: { row: 9, col: 1 }, width: 400, height: 240 });
    const stacked = s.insertChart("Sales", "A1:C4", { type: "bar" });
    s.updateChart("Sales", stacked.id, { grouping: "stacked", from: { row: 9, col: 9 } });
    s.insertChart("Sales", "A1:C4", { type: "line" });
    s.insertChart("Sales", "A1:C4", { type: "area" });
    s.insertChart("Sales", "A6:B8", { type: "pie" });
    const col3 = s.insertChart("Sales", "A1:C4", { type: "column" });
    s.updateChart("Sales", col3.id, { view3d: { rotX: 20, rotY: 30 }, from: { row: 50, col: 1 } });
    const pie3 = s.insertChart("Sales", "A6:B8", { type: "pie" });
    s.updateChart("Sales", pie3.id, { view3d: { rotX: 40, rotY: 0 }, from: { row: 50, col: 9 } });
    s.addChart("Sales", { type: "scatter", title: "Pairs", series: [{ name: "P", x: "Sales!$E$1:$E$3", values: "Sales!$F$1:$F$3" }], from: { row: 30, col: 1 } });

    writeFileSync(join(dir, "c.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "c.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "c.xlsx"))));
    const charts = back.workbook.sheets[0]!.charts ?? [];

    expect(charts.map((c) => c.type)).toEqual(["column", "bar", "line", "area", "pie", "column", "pie", "scatter"]);
    // 3-D charts come back 3-D (LibreOffice may round the angles).
    expect(charts[5]!.view3d).toBeTruthy();
    expect(charts[6]!.view3d).toBeTruthy();
    expect(charts[0]!.view3d).toBeUndefined();
    expect(charts[0]).toMatchObject({ title: "Sales by month", xTitle: "Month", yTitle: "Units", legend: "top", categories: "Sales!$A$2:$A$4" });
    expect(charts[0]!.series.map((x) => x.values)).toEqual(["Sales!$B$2:$B$4", "Sales!$C$2:$C$4"]);
    expect(charts[0]!.series.map((x) => x.nameRef)).toEqual(["Sales!$B$1", "Sales!$C$1"]);
    expect(charts[1]!.grouping).toBe("stacked");
    expect(charts[4]!.series[0]!.values).toBe("Sales!$B$7:$B$8");
    expect(charts[7]!.series[0]).toMatchObject({ x: "Sales!$E$1:$E$3", values: "Sales!$F$1:$F$3" });
    // The size and place survive a trip through another program, to within a cell.
    expect(charts[0]!.from).toMatchObject({ row: 9, col: 1 });
    expect(Math.abs(charts[0]!.width - 400)).toBeLessThan(8);
    expect(Math.abs(charts[0]!.height - 240)).toBeLessThan(8);
  }, 180_000);
});
