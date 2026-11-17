import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice reads sparklines coloured from the theme and a date axis. A file Pli writes must open there, keep the theme colours
 * (with their tints) and the date axis switch. (LibreOffice does not keep the range of dates the axis reads, so it comes back
 * from there as a plain sparkline; that is its limit, not the file's.) Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-spark-more-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("theme colours and date axes through LibreOffice", () => {
  it("keeps theme colours and tints, and writes the date axis switch back", () => {
    const s = new SheetSession(createWorkbook("spark", ["Data"]));
    s.setValues("Data", "A1", [[45000, 45001, 45002, 45010], [1, 3, 2, 5], [4, -1, 2, 3]]);
    s.addSparklines("Data", { type: "line", location: "F2", data: "A2:D2", dateAxis: "A1:D1", color: { theme: 4, tint: -0.5 }, high: true, highColor: { theme: 5 }, markers: true, markerColor: "#00aa00" });
    s.addSparklines("Data", { type: "column", location: "F3", data: "A3:D3", negative: true, negativeColor: { theme: 7, tint: 0.4 } });
    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const bytes = new Uint8Array(readFileSync(join(dir, "out", "f.xlsx")));
    expect(strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!)).toContain('dateAxis="1"');
    const groups = fromXlsx(bytes).workbook.sheets[0]!.sparklines ?? [];
    const line = groups.find((g) => g.type === "line")!;
    expect(line.color).toEqual({ theme: 4, tint: -0.5 });
    expect(line.highColor).toEqual({ theme: 5 });
    expect(line.markerColor).toBe("#00aa00");
    const column = groups.find((g) => g.type === "column")!;
    expect(column.negativeColor).toMatchObject({ theme: 7 });
    expect((column.negativeColor as { tint: number }).tint).toBeCloseTo(0.4, 2);
  }, 150_000);
});
