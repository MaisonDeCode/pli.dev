import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * LibreOffice keeps links and notes. A file Pli writes must open there with both, and what it writes back must read the same
 * (so the comments part and the drawing for the boxes are ones a program other than ours accepts). Runs only where LibreOffice
 * is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-links-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("links and notes through LibreOffice", () => {
  it("opens links and notes and writes them back", () => {
    const s = new SheetSession(createWorkbook("links", ["Data", "Other"]));
    s.setValues("Data", "A1", [["Pli", "Sheet", "Mail"], ["plain", null, null]]);
    s.setValues("Other", "B2", [["there"]]);
    s.setLink("Data", "A1", { to: "https://pli.dev/sheets/?a=1&b=2", tip: "Pli's site" });
    s.setLink("Data", "B1", { to: "#Other!B2" });
    s.setLink("Data", "C1", { to: "mailto:ana@example.com" });
    s.setNote("Data", "A2", "First line\nSecond line & <more>");
    s.setNote("Other", "B2", "A note on the other sheet");

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const [data, other] = back.workbook.sheets;
    expect(data!.cells["A1"]?.link).toMatchObject({ to: "https://pli.dev/sheets/?a=1&b=2" });
    expect(data!.cells["B1"]?.link?.to).toMatch(/^#.*Other.*B2$/);
    expect(data!.cells["C1"]?.link?.to).toBe("mailto:ana@example.com");
    expect(data!.cells["A1"]?.v).toBe("Pli");
    expect(data!.cells["A2"]?.note).toBe("First line\nSecond line & <more>");
    expect(other!.cells["B2"]?.note).toBe("A note on the other sheet");
    expect(back.warnings).toEqual([]);
  });
});
