import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, isError, parseCsv, toXlsx } from "../src";

/**
 * LibreOffice has the Subtotal command and its own SUBTOTAL. A list Pli subtotals and writes must work out to the same numbers
 * there (nested subtotals and the grand total skip the subtotals inside them; hidden rows count for SUBTOTAL(9) and not for
 * SUBTOTAL(109)), and what LibreOffice saves back must still be the same rows and groups. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-subtotal-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const lo = (file: string, to: string, out: string) => execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", to, "--outdir", join(dir, out), join(dir, file)], { stdio: "ignore", timeout: 120_000 });

const list = () => {
  const s = new SheetSession(createWorkbook("sub", ["Data"]));
  s.setValues("Data", "A1", [
    ["Region", "Product", "Qty", "Amount"],
    ["East", "Ink", 1, 7.5],
    ["East", "Pen", 2, 10],
    ["East", "Pen", 3, 15.25],
    ["North", "Ink", 6, 2],
    ["West", "Ink", 4, 20],
    ["West", "Pen", 5, 25],
  ]);
  return s;
};

describe.skipIf(!SOFFICE)("subtotals through LibreOffice", () => {
  it("work out the same numbers there, nested, above or below, and with rows hidden", () => {
    const s = list();
    s.subtotal("Data", "A1:D7", { by: "Region", columns: ["Qty", "Amount"] });
    s.subtotal("Data", "A1:D11", { by: "Product", columns: ["Qty", "Amount"], fn: "average", replace: false });
    // Beside the list: the same sums with the folded rows counted and not.
    s.setCell("Data", "G1", "=SUBTOTAL(9,C2:C20)");
    s.setCell("Data", "G2", "=SUBTOTAL(109,C2:C20)");
    s.setCell("Data", "G3", "=SUBTOTAL(2,C2:C20)");
    s.setCell("Data", "G4", "=SUBTOTAL(7,C2:C20)");
    s.showLevel("Data", "row", 1);
    writeFileSync(join(dir, "a.xlsx"), toXlsx(s.state));
    lo("a.xlsx", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,false,false", "csv");
    const rows = parseCsv(readFileSync(join(dir, "csv", "a.csv"), "utf8"));
    const last = Number(s.usedRange("Data")!.replace(/^.*:[A-Z]+/, ""));
    const problems: string[] = [];
    for (let r = 1; r <= last; r++)
      for (const [c, col] of ["A", "B", "C", "D", "G"].entries()) {
        void c;
        const mine = s.value("Data", `${col}${r}`);
        const theirs = rows[r - 1]?.[col.charCodeAt(0) - 65] ?? "";
        if (mine === null) continue;
        const ok = typeof mine === "number" ? Math.abs(Number(theirs) - mine) < 1e-9 * Math.max(1, Math.abs(mine)) : isError(mine) ? theirs.startsWith("#") || theirs.startsWith("Err") : String(mine) === theirs;
        if (!ok) problems.push(`${col}${r}: Pli ${JSON.stringify(mine)}, LibreOffice ${theirs}`);
      }
    expect(problems).toEqual([]);
    expect(s.value("Data", "G1")).not.toBe(s.value("Data", "G2"));
  }, 150_000);

  it("come back from LibreOffice as the same rows with the same groups and summaries", () => {
    const s = list();
    s.subtotal("Data", "A1:D7", { by: "Region", columns: ["Qty"], summaryBelow: false });
    s.toggleGroup("Data", "row", 2);
    writeFileSync(join(dir, "b.xlsx"), toXlsx(s.state));
    lo("b.xlsx", "xlsx:Calc MS Excel 2007 XML", "out");
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "b.xlsx")))).workbook.sheets[0]!;
    expect(back.outline?.summaryAbove).toBe(true);
    const levels = (rows: typeof back.rows) => Object.fromEntries(Object.entries(rows ?? {}).filter(([, d]) => d.level).map(([k, d]) => [k, d.level]));
    expect(levels(back.rows)).toEqual(levels(s.sheet("Data").rows));
    const again = new SheetSession(fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "b.xlsx")))).workbook);
    expect(again.subtotalRows("Data", "A1").rows).toEqual(s.subtotalRows("Data", "A1").rows);
    expect(again.value("Data", "C2")).toBe(s.value("Data", "C2"));
    expect(again.removeSubtotals("Data", "A1")).toBe(4);
  }, 150_000);
});
