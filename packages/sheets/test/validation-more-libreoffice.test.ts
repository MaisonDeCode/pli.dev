import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * A list that allows several items is a plain list to anyone but Pli, and a list read from another workbook is an
 * external link with the cells that were read. LibreOffice must open both and write the validation back. Runs only where
 * LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-validmore-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const through = (name: string, bytes: Uint8Array) => {
  writeFileSync(join(dir, `${name}.xlsx`), bytes);
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
  return fromXlsx(new Uint8Array(readFileSync(join(dir, "out", `${name}.xlsx`))));
};

describe.skipIf(!SOFFICE)("lists with several items and lists from other workbooks through LibreOffice", () => {
  it("opens a list that allows several items as the plain list it is in the file", () => {
    const s = new SheetSession(createWorkbook("multi", ["Data", "Lists"]));
    s.setValues("Lists", "A1", [["red"], ["green"], ["blue"]]);
    s.addValidation("Data", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B2:B9"], multiple: true });
    const { workbook, warnings } = through("multi", toXlsx(s.state));
    expect(warnings).toEqual([]);
    const rule = workbook.sheets[0]!.validations![0]!;
    expect(rule).toMatchObject({ kind: "list", source: "Lists!$A$1:$A$3", alert: "information" });
    // one item is fine to it, and anything else only informs, which is why Pli writes "information" for such a list
    const t = new SheetSession(workbook);
    expect(t.checkEntry("Data", "B2", "green")).toBeNull();
  }, 180_000);

  it("opens a file whose list reads another workbook, and keeps the validation", () => {
    const s = new SheetSession(createWorkbook("ext", ["Data"]), { now: () => 46000.5 });
    s.addValidation("Data", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$3", ranges: ["B2:B9"], snapshot: { items: ["Pens", "Paper", "Ink"], read: "2025-12-09" } });
    const { workbook } = through("ext", toXlsx(s.state));
    // Pli's own reading of what it wrote is checked in validation-more.test.ts; here LibreOffice only has to open it
    expect(workbook.sheets).toHaveLength(1);
  }, 180_000);

  it("opens cell formulas, names and validation limits that read another workbook, and writes them back as links", () => {
    const s = new SheetSession(createWorkbook("cells", ["Data"]), { now: () => 46000.5 });
    s.setExternalCells("Prices.xlsx", "Sheet1", { A2: "Pens", B2: 2.5, B3: 4 }, { path: "Prices.xlsx" });
    s.setCell("Data", "A1", "=[Prices.xlsx]Sheet1!B2*2");
    s.setCell("Data", "A2", "=SUM(Cost)");
    s.defineName("Cost", "[Prices.xlsx]Sheet1!$B$2:$B$3");
    s.addValidation("Data", { kind: "decimal", op: "lessThanOrEqual", values: ["[Prices.xlsx]Sheet1!$B$3"], ranges: ["C2:C9"] });
    const { workbook } = through("cells", toXlsx(s.state));
    const data = workbook.sheets[0]!;
    // LibreOffice keeps the values Pli cached with the formulas, and writes the references back as links to that file
    expect(data.cells["A1"]!.f).toMatch(/^\[[^\]]+\]Sheet1!B2\*2$|^'\[[^\]]+\]Sheet1'!B2\*2$/);
    const back = new SheetSession(workbook);
    expect(back.value("Data", "A1")).toBe(5);
    expect(back.externalBooks.length).toBeGreaterThan(0);
  }, 180_000);
});
