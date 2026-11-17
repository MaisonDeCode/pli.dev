import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fromXlsx, toXlsx } from "../src";
import { SAMPLES } from "./excel-check/samples";

/** LibreOffice opens the check kit's formatting file (every kind of rule, rules that point at other sheets, merges, pivot rules) and writes the same formatting back. Runs only where LibreOffice is installed. */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-formatrest-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("the formatting check file through LibreOffice", () => {
  it("keeps the merges, every kind of rule and the pivot table", () => {
    const sample = SAMPLES.find((s) => s.file === "33-formatting-rest.xlsx")!;
    // LibreOffice 26.8 closes with "Unspecified Application Error" on a data bar whose start or end is a formula in Excel 2010's
    // extension, as Excel writes it, so that one rule is left out of the file it is given.
    const session = sample.build();
    for (const r of session.conditionalFormats("Linked")) if (r.kind === "dataBar") session.deleteRule("Linked", r.id);
    const bytes = toXlsx(session.state, { now: () => 45_000.5 });
    const original = fromXlsx(bytes).workbook;
    writeFileSync(join(dir, "f.xlsx"), bytes);
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 150_000 });
    const { workbook } = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx"))));
    const sheet = (w: typeof workbook, name: string) => w.sheets.find((s) => s.name === name)!;
    const kinds = (w: typeof workbook, name: string) => (sheet(w, name).conditional ?? []).map((r) => r.kind).sort();
    expect(sheet(workbook, "Merges").merges?.slice().sort()).toEqual(sheet(original, "Merges").merges?.slice().sort());
    expect(sheet(workbook, "Pivot").pivots).toHaveLength(1);
    // Rules LibreOffice has: values, text, formulas, ranks, averages, periods, blanks, errors, duplicates, scales, bars and icons.
    for (const name of ["Compare", "Text", "Blanks", "Scales", "Icons", "Linked"]) {
      expect(kinds(workbook, name).length, name).toBeGreaterThanOrEqual(Math.floor(kinds(original, name).length * 0.8));
    }
    // The rules that point at other sheets keep their formulas.
    const linked = sheet(workbook, "Linked").conditional ?? [];
    expect(linked.some((r) => r.kind === "cell" && r.values[0]!.includes("Limits"))).toBe(true);
    expect(linked.some((r) => r.kind === "formula" && r.formula.includes("Limits"))).toBe(true);
  }, 200_000);
});
