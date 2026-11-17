import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice keeps cell locks and sheet protection (but not a workbook's structure protection). A file Pli writes must open there with the sheet protected,
 * the right cells unlocked and the right things allowed, and what it writes back must read the same. Runs only where
 * LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-protect-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("protection through LibreOffice", () => {
  it("keeps what is locked and what is allowed", () => {
    const s = new SheetSession(createWorkbook("protect", ["Form", "Other"]));
    s.setValues("Form", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null]]);
    s.setCell("Form", "C2", "=B2*2");
    s.setStyle("Form", "B2:B3", { locked: false });
    s.setStyle("Form", "C2", { hideFormula: true });
    s.protectSheet("Form", { password: "pli", allow: ["selectLockedCells", "selectUnlockedCells", "formatCells", "sort", "insertRows"] });
    s.protectWorkbook();

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const form = back.workbook.sheets[0]!;
    expect(form.protection).toBeTruthy();
    for (const allowed of ["formatCells", "sort", "insertRows", "selectLockedCells", "selectUnlockedCells"] as const) expect(form.protection!.allow, allowed).toContain(allowed);
    for (const locked of ["formatColumns", "deleteRows", "autoFilter", "objects"] as const) expect(form.protection!.allow, locked).not.toContain(locked);
    expect(form.cells["B2"]?.s?.locked).toBe(false);
    expect(form.cells["B3"]?.s?.locked).toBe(false);
    expect(form.cells["A1"]?.s?.locked).toBeUndefined();
    expect(form.cells["C2"]?.s?.hideFormula).toBe(true);
    // LibreOffice writes `<workbookProtection/>` with nothing in it, with or without a password, so the structure's protection
    // is checked in Excel (excel-check/11), not here.
    expect(back.workbook.sheets[1]!.protection).toBeUndefined();
    expect(back.warnings).toEqual([]);
  });

  it("keeps the locks that columns and rows carry, and the ranges that may be edited", () => {
    const s = new SheetSession(createWorkbook("protect", ["Form"]));
    s.setValues("Form", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null]]);
    s.setLocked("Form", "B:B", false);
    s.setLocked("Form", "3:3", false);
    s.addEditRange("Form", { name: "Totals", ranges: ["C2:C3"] });
    s.protectSheet("Form");

    writeFileSync(join(dir, "g.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "g.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = new SheetSession(fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "g.xlsx")))).workbook);
    expect(back.isProtected("Form")).toBe(true);
    expect(back.isLocked("Form", "A1")).toBe(true);
    expect(back.isLocked("Form", "A2")).toBe(true);
    expect(back.isLocked("Form", "B1")).toBe(false);
    expect(back.isLocked("Form", "B2")).toBe(false);
    expect(back.isLocked("Form", "B3")).toBe(false);
    // (A cell locked on its own inside an unlocked column or row is not checked here: LibreOffice reads a cell whose style is the default as having none, and takes its row's.)
    expect(back.isLocked("Form", "A3")).toBe(false);
    expect(back.isLocked("Form", "C3")).toBe(false);
    expect(back.isLocked("Form", "C2")).toBe(true);
    expect(back.editRanges("Form").map((r) => r.name)).toEqual(["Totals"]);
    back.setCell("Form", "C2", 1);
  });
});
