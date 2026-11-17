import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice has sparklines. A file Pli writes must open there with them, and what it writes back must read as the same groups
 * (type, the cells they sit in and draw, and the options). Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-spark-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("sparklines through LibreOffice", () => {
  it("keeps what each sparkline draws and where it sits, with its type and options", () => {
    const s = new SheetSession(createWorkbook("spark", ["Data"]));
    s.setValues("Data", "A1", [["a", 1, 3, 2, 5], ["b", 4, -1, 2, 3], ["c", 7, 7, 7, 7]]);
    s.addSparklines("Data", { type: "column", location: "F1:F3", data: "B1:E3", color: "#336699", negative: true, negativeColor: "#aa0000" });
    s.addSparklines("Data", { type: "line", location: "G1", data: "B1:E1", markers: true, high: true, lowColor: "#00aa00", low: true, lineWeight: 1.5 });
    s.addSparklines("Data", { type: "winloss", location: "H2", data: "B2:E2" });

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx")))).workbook.sheets[0]!;
    const groups = back.sparklines ?? [];
    expect(groups.map((g) => g.type).sort()).toEqual(["column", "line", "winloss"]);
    const cells = groups.flatMap((g) => g.items.map((i) => `${i.cell}=${i.source}`)).sort();
    expect(cells).toEqual(["F1=Data!$B$1:$E$1", "F2=Data!$B$2:$E$2", "F3=Data!$B$3:$E$3", "G1=Data!$B$1:$E$1", "H2=Data!$B$2:$E$2"]);
    const column = groups.find((g) => g.type === "column")!;
    expect(column).toMatchObject({ color: "#336699", negative: true, negativeColor: "#aa0000" });
    const line = groups.find((g) => g.type === "line")!;
    expect(line).toMatchObject({ markers: true, high: true, low: true, lowColor: "#00aa00" });
    expect(line.lineWeight).toBeCloseTo(1.5, 2);
  });
});
