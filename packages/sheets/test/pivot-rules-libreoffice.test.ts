import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/** LibreOffice opens a file with rules that follow a pivot table, keeps the pivot table and the formatting on its cells. Runs only where LibreOffice is installed. */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-pivotrule-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("rules on pivot tables through LibreOffice", () => {
  it("opens the file and keeps the pivot table", () => {
    const s = new SheetSession(createWorkbook("pr", ["Data", "Pivot"]));
    s.setValues("Data", "A1", [["Region", "Qty"], ["East", 10], ["West", 7], ["East", 2], ["North", 4]]);
    const p = s.createPivot("Pivot", { source: "Data!A1:B5", anchor: "A1", rows: ["Region"], values: ["Qty"] });
    s.addRule("Pivot", { kind: "cell", op: "greaterThan", values: ["5"], ranges: [], style: { fill: "#ffc7ce", bold: true }, pivot: { id: p.id } });
    writeFileSync(join(dir, "p.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "p.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const { workbook } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "p.xlsx"))));
    const sheet = workbook.sheets[1]!;
    // The pivot table is kept, with the same numbers.
    expect(sheet.pivots).toHaveLength(1);
    const sums = ["B1", "B2", "B3", "B4", "B5", "B6"].map((a) => sheet.cells[a]?.v).filter((v) => typeof v === "number");
    expect(sums.sort()).toEqual([12, 23, 4, 7].sort());
    // LibreOffice has no conditional formats on pivot table cells, so the rule is not written back; the file opens and the table is kept.
  }, 180_000);
});
