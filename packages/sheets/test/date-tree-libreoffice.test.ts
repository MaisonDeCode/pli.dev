import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/** Whether LibreOffice reads the dates a filter picks from the tree (`dateGroupItem`) and hides the same rows. Runs only where it is installed. */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-datetree-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const TODAY = 45_000; // 2023-03-15

describe.skipIf(!SOFFICE)("date picks through LibreOffice", () => {
  it("reads a filter that picks a month and a day from the tree, and writes it back", () => {
    const s = new SheetSession(createWorkbook("dates", ["Data"]), { now: () => TODAY });
    s.setValues("Data", "A1", [["Name", "Day"], ["a", TODAY], ["b", TODAY - 1], ["c", TODAY + 1], ["d", TODAY - 10], ["e", TODAY - 40], ["f", TODAY - 400], ["g", TODAY + 40]]);
    s.setFormat("Data", "B2:B8", "yyyy-mm-dd");
    s.setFilter("Data", "A1:B8");
    s.filterColumnRule("Data", 2, { kind: "dateGroups", groups: [{ by: "month", year: 2023, month: 3 }, { by: "day", year: 2023, month: 2, day: 3 }] });
    // Pli hid the rows of f (7, a year earlier) and g (8, in April)
    const files = unzipSync(toXlsx(s.state));
    expect(strFromU8(files["xl/worksheets/sheet1.xml"]!)).toContain("dateGroupItem");
    writeFileSync(join(dir, "f.xlsx"), zipSync(files));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const out = back.workbook.sheets[0]!;
    // LibreOffice understood the month pick: it writes the filter back as the days of March 2023 that the data has, and the 3rd of February.
    const rule = out.filter?.columns?.B;
    expect(rule && !Array.isArray(rule) && rule.kind).toBe("dateGroups");
    const days = (rule as { groups: { by: string; year: number; month: number; day: number }[] }).groups.filter((g) => g.year === 2023 && g.month === 3).map((g) => g.day).sort((a, b) => a - b);
    expect(days).toEqual([5, 14, 15, 16]);
    // The rows Pli hid stay hidden through LibreOffice.
    const hidden = Object.entries(out.rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r)).sort((a, b) => a - b);
    expect(hidden).toEqual([7, 8]);
  });
});
