import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice keeps tables, their filters and sorts, and tables with no header row. A file Pli writes must open there
 * (slicers, which it doesn't have, are ignored) with the rows hidden the way Pli hid them, and what it writes back must
 * read the same. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-tables-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("tables through LibreOffice", () => {
  it("opens a filtered, sorted table, a table with no header row and a slicer, and writes them back", () => {
    const s = new SheetSession(createWorkbook("tables", ["Data"]));
    s.setValues("Data", "A1", [["Region", "Item", "Qty"], ["West", "Pens", 10], ["East", "Paper", 4], ["West", "Ink", 2], ["North", "Pens", 7]]);
    s.createTable("Data", "A1:C5", { name: "Sales" });
    s.filterTable("Sales", "Region", ["West"]);
    s.sortTable("Sales", "Qty", "descending");
    s.setTableStyle("Mine", { headerRow: { bold: true, fill: "#336699", color: "#ffffff" }, firstRowStripe: { fill: "#e0ecf8" } });
    s.setTableOptions("Sales", { style: "Mine" });
    s.setValues("Data", "F1", [["Scores"], [1], [2]]);
    s.createTable("Data", "F1:F3", { name: "Plain" });
    s.setTableHeader("Plain", false);
    s.addSlicer("Data", { table: "Sales", column: "Region" });

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const sheet = back.workbook.sheets[0]!;
    const sales = sheet.tables!.find((t) => t.name === "Sales")!;
    const plain = sheet.tables!.find((t) => t.name === "Plain")!;

    expect(sales).toMatchObject({ range: "A1:C5", style: "Mine", filters: { Region: ["West"] } });
    expect(plain).toMatchObject({ range: "F2:F3", headerRow: false, columns: ["Scores"] });
    // LibreOffice applied the filter itself: the rows that don't pass are the ones Pli hid.
    const hidden = Object.entries(sheet.rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r));
    expect(hidden.sort()).toEqual([3, 4]);
    expect([2, 3, 4, 5].map((r) => sheet.cells[`C${r}`]?.v)).toEqual([10, 7, 4, 2]);
  });
});
