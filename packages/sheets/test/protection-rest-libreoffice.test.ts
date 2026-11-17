import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/** Hidden formulas that columns and rows carry, and Windows-account permissions, through LibreOffice. Runs only where it is installed. */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-protect-rest-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const viaLibreOffice = (name: string, bytes: Uint8Array) => {
  writeFileSync(join(dir, `${name}.xlsx`), bytes);
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
  return fromXlsx(new Uint8Array(readFileSync(join(dir, "out", `${name}.xlsx`))));
};

describe.skipIf(!SOFFICE)("protection, the rest, through LibreOffice", () => {
  it("keeps the formulas a whole column hides", () => {
    const s = new SheetSession(createWorkbook("hide", ["Form"]));
    s.setValues("Form", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null]]);
    s.setCell("Form", "C2", "=B2*2");
    s.setCell("Form", "C3", "=B3*2");
    s.setCell("Form", "A3", "=B3+1");
    s.setFormulaHidden("Form", "C:C", true);
    s.protectSheet("Form");
    const back = new SheetSession(viaLibreOffice("hide", toXlsx(s.state)).workbook);
    expect(back.isProtected("Form")).toBe(true);
    expect(back.formulaHidden("Form", "C2")).toBe(true);
    expect(back.formulaHidden("Form", "C3")).toBe(true);
    expect(back.formulaHidden("Form", "A3")).toBe(false);
  });

  it("keeps Windows accounts on a range that may be edited", () => {
    const s = new SheetSession(createWorkbook("accounts", ["Form"]));
    s.setValues("Form", "A1", [["Name", "Qty"], ["Pens", 10]]);
    const sid = "S-1-5-21-1004336348-1177238915-682003330-1001";
    s.addEditRange("Form", { name: "Mine", ranges: ["B2"], permissions: [`sid:${sid}`] });
    s.protectSheet("Form");
    const back = viaLibreOffice("accounts", toXlsx(s.state));
    const ranges = back.workbook.sheets[0]!.editRanges ?? [];
    // LibreOffice reads protected ranges; whether it writes the descriptor back is what this finds out.
    expect(ranges.map((r) => r.name)).toEqual(["Mine"]);
    expect(ranges[0]!.permissions).toEqual([`sid:${sid}`]);
  });
});
