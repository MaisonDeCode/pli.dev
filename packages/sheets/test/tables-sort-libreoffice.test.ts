import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fromXlsx, toXlsx } from "../src";
import { SAMPLES } from "./excel-check/samples";

/**
 * A file with a table sorted by several columns, by colour and by icon, and a slicer style of your own, must open in
 * LibreOffice with the rows where Pli put them and the colours on their cells, and what it writes back must read the same.
 * (LibreOffice keeps the first level of a table's sort at most; the other levels and the slicer style are Excel's.)
 * Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-tsort-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("a sorted table through LibreOffice", () => {
  it("opens the sample, keeps the order, the table and the colours, and writes it back", () => {
    const s = SAMPLES.find((x) => x.file === "35-tables-sort.xlsx")!.build();
    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx")))).workbook;
    const orders = back.sheets.find((x) => x.name === "Orders")!;
    const table = orders.tables!.find((t) => t.name === "Orders")!;
    expect(table.range).toBe("A1:D9");
    expect([2, 3, 4, 5, 6, 7, 8, 9].map((r) => `${orders.cells[`A${r}`]?.v} ${orders.cells[`B${r}`]?.v}`)).toEqual([
      "East Ink", "East Paper", "North Paper", "North Pens", "South Pens", "South Ink", "West Pens", "West Ink",
    ]);
    // The pink fills and the dark red text are on the same cells.
    expect([2, 3, 4, 5, 6, 7, 8, 9].filter((r) => orders.cells[`C${r}`]?.s?.fill === "#ffc7ce")).toEqual([3, 4, 9]);
    expect([2, 3, 4, 5, 6, 7, 8, 9].filter((r) => orders.cells[`B${r}`]?.s?.color === "#9c0006")).toEqual([2, 7, 9]);
    // Whatever LibreOffice kept of the sort, it is the first level.
    if (table.sort) expect(table.sort.column).toBe("Region");
  });
});
