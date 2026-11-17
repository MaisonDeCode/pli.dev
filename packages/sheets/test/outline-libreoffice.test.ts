import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice keeps groups. A file Pli writes must open there with the levels and the collapsed groups, and what it writes back
 * must read the same. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-outline-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("groups through LibreOffice", () => {
  it("keeps levels, collapsed groups and which rows and columns are hidden", () => {
    const s = new SheetSession(createWorkbook("outline", ["Data"]));
    s.setValues("Data", "A1", Array.from({ length: 12 }, (_, r) => Array.from({ length: 8 }, (_, c) => r * 10 + c)));
    s.groupRows("Data", 2, 6);
    s.groupRows("Data", 3, 4);
    s.toggleGroup("Data", "row", 5);
    s.groupColumns("Data", 2, 3);
    s.toggleGroup("Data", "col", 4);
    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx")))).workbook.sheets[0]!;
    const levels = (dims: Record<string, { level?: number }> | undefined) => Object.fromEntries(Object.entries(dims ?? {}).filter(([, d]) => d.level).map(([k, d]) => [k, d.level]));
    expect(levels(back.rows)).toEqual({ "2": 1, "3": 2, "4": 2, "5": 1, "6": 1 });
    expect(levels(back.columns)).toEqual({ B: 1, C: 1 });
    expect(Object.entries(back.rows ?? {}).filter(([, d]) => d.hidden).map(([k]) => k)).toEqual(["3", "4"]);
    expect(Object.entries(back.columns ?? {}).filter(([, d]) => d.hidden).map(([k]) => k)).toEqual(["B", "C"]);
    expect(back.rows!["5"]?.collapsed).toBe(true);
    // LibreOffice writes `collapsed="false"` on a collapsed group's summary column, so that mark is Pli's (and Excel's) alone.
  });
});
