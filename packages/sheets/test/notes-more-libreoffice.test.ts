import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/** LibreOffice reads notes with a look, an author and a box the way Pli writes them, and writes them back so Pli reads the same. Runs only where LibreOffice is installed. */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-notes-more-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("notes with a look, an author and a box through LibreOffice", () => {
  it("keeps the text, the author, the bold and colour, the size and whether it shows", () => {
    const s = new SheetSession(createWorkbook("notes", ["Data"]), { author: "Ana" });
    s.setValues("Data", "A1", [["a", "b"]]);
    s.setNote("Data", "A1", "Check the total now", { runs: [{ text: "Check the " }, { text: "total", bold: true, color: "#c00000" }, { text: " now" }], box: { width: 260, height: 110, show: true } });
    s.setNote("Data", "B1", "hidden by default");

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const a1 = back.workbook.sheets[0]!.cells["A1"]!;
    expect(a1.note).toBe("Check the total now");
    expect(a1.noteAuthor).toBe("Ana");
    expect(a1.noteRuns?.find((r) => r.bold)?.text).toBe("total");
    expect(a1.noteRuns?.find((r) => r.bold)?.color).toBe("#c00000");
    expect(a1.noteBox?.show).toBe(true);
    expect(a1.noteBox?.width).toBeGreaterThan(200);
    expect(back.workbook.sheets[0]!.cells["B1"]?.noteBox?.show).toBeUndefined();
    expect(back.workbook.sheets[0]!.cells["B1"]?.note).toBe("hidden by default");
  });
});
