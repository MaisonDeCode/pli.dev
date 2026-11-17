import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

/**
 * A file that carries named sheet views must open in LibreOffice as an ordinary workbook: the sheet's AutoFilter, the table with its
 * filter and the values all as they were. (What Excel makes of the views is the kit's file 32.) Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-fview-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("filter views through LibreOffice", () => {
  it("a workbook with views opens, keeps its filters and table, and opens with the views alongside", () => {
    const s = new SheetSession(createWorkbook("Views", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Name", "Team", "Amount"], ["Ann", "red", 30], ["Bo", "blue", 10], ["Cy", "red", 20]]);
    s.setValues("Sheet1", "E1", [["Item", "Region", "Qty"], ["pen", "east", 3], ["ink", "west", 9], ["pad", "east", 1]]);
    s.setFilter("Sheet1", "A1:C4");
    s.createTable("Sheet1", "E1:G4", { name: "Sales" });
    s.filterColumn("Sheet1", 2, ["red"]);
    s.filterTable("Sales", "Region", ["east"]);
    s.saveFilterView("Sheet1", "Reds");
    s.filterColumn("Sheet1", 2, null);
    s.saveFilterView("Sheet1", "All teams");
    s.filterColumn("Sheet1", 2, ["red"]);
    writeFileSync(join(dir, "v.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "v.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "v.xlsx")))).workbook.sheets[0]!;
    expect(back.filter).toEqual({ range: "A1:C4", columns: { B: ["red"] } });
    expect(back.tables?.[0]).toMatchObject({ name: "Sales", range: "E1:G4", filters: { Region: ["east"] } });
    expect(back.cells["A2"]!.v).toBe("Ann");
    expect(back.cells["G4"]!.v).toBe(1);
    // LibreOffice 26.8 has sheet views of its own: it reads the names and writes the views again from the state it has, so the
    // contents it hands back are not Pli's (older versions drop the part). The names are all that can be compared.
    if (back.filterViews) expect(back.filterViews.map((v) => v.name)).toEqual(["Reds", "All teams"]);
  });
});
