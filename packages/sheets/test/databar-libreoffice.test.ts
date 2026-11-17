import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/** LibreOffice reads Excel 2010's data bar settings and writes them back. Runs only where LibreOffice is installed. */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-databar-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("data bar settings through LibreOffice", () => {
  it("keeps automatic ends and the negative colour", () => {
    const s = new SheetSession(createWorkbook("bars", ["Data"]));
    s.setValues("Data", "A1", [[5], [-3], [12], [0]]);
    s.addRule("Data", { kind: "dataBar", ranges: ["A1:A4"], min: { type: "auto" }, max: { type: "auto" }, color: "#638ec6", negativeColor: "#ff0000", border: true, borderColor: "#0b3d91", negativeBorderColor: "#990000", rtl: true });
    writeFileSync(join(dir, "b.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "b.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const { workbook } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "b.xlsx"))));
    const bar = workbook.sheets[0]!.conditional?.find((r) => r.kind === "dataBar");
    // LibreOffice keeps the automatic ends and both colours; it has no bar borders or direction of its own, so those it drops.
    expect(bar).toMatchObject({ color: "#638ec6", negativeColor: "#ff0000", min: { type: "auto" }, max: { type: "auto" } });
  }, 180_000);
});
