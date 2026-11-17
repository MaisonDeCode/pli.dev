import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type FilterRule } from "../src";

/**
 * LibreOffice has filters by condition, top and bottom, and colour. A file Pli writes must open there with the same filter on the
 * column, and what LibreOffice writes back must read as the same rule. (LibreOffice doesn't apply a filter when it opens a file, so
 * which rows each rule lets through is checked in Pli's own tests.) Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-fcond-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

let n = 0;
const throughLibreOffice = (s: SheetSession) => {
  const name = `f${++n}`;
  writeFileSync(join(dir, `${name}.xlsx`), toXlsx(s.state));
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
  return fromXlsx(new Uint8Array(readFileSync(join(dir, "out", `${name}.xlsx`)))).workbook;
};

const RULES: Record<string, FilterRule> = {
  "contains": { kind: "custom", a: { op: "contains", value: "pie" } },
  "does not contain": { kind: "custom", a: { op: "notContains", value: "pie" } },
  "begins with": { kind: "custom", a: { op: "beginsWith", value: "app" } },
  "ends with": { kind: "custom", a: { op: "endsWith", value: "ie" } },
  "greater than": { kind: "custom", a: { op: "greaterThan", value: 10 } },
  "between": { kind: "custom", a: { op: "greaterThanOrEqual", value: 10 }, b: { op: "lessThanOrEqual", value: 25 } },
  "either": { kind: "custom", a: { op: "lessThan", value: 5 }, b: { op: "greaterThan", value: 30 }, or: true },
  "top 3": { kind: "top", n: 3 },
  "bottom 2": { kind: "top", n: 2, bottom: true },
  "top 30 percent": { kind: "top", n: 30, percent: true },
};

describe.skipIf(!SOFFICE)("filters by condition through LibreOffice", () => {
  for (const [label, rule] of Object.entries(RULES)) {
    it(`keeps the rule on a column: ${label}`, () => {
      const s = new SheetSession(createWorkbook("f", ["Sheet1"]), { now: () => 45_000.5 });
      s.setValues("Sheet1", "A1", [["Name", "Amount", "Day"], ["Apple pie", 10, 45_000], ["apple tart", 25, 44_999], ["Banana", 7, 45_001], ["Cherry pie", 40, 44_990], ["Plum pie", 25, 44_600], ["Fig", 3, 45_040]]);
      s.setStyle("Sheet1", "A2:B3", { fill: "#ffff00", color: "#0000ff" });
      s.setFilter("Sheet1", "A1:C7");
      const column = rule.kind === "date" ? 3 : rule.kind === "custom" && "value" in rule.a && typeof rule.a.value === "string" ? 1 : 2;
      s.filterColumnRule("Sheet1", column, rule);
      const letters = "ABC"[column - 1]!;
      const back = throughLibreOffice(s).sheets[0]!;
      expect(back.filter?.columns?.[letters], `LibreOffice kept the filter on column ${letters}`).toEqual(rule);
    });
  }

  it("opens a filter by colour, with the colour it names (LibreOffice writes its own style for it)", () => {
    const s = new SheetSession(createWorkbook("f", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Name", "Amount"], ["Apple pie", 10], ["Banana", 7]]);
    s.setStyle("Sheet1", "A2:B2", { fill: "#ffff00", color: "#0000ff" });
    s.setFilter("Sheet1", "A1:B3");
    s.filterColumnRule("Sheet1", 2, { kind: "color", fill: "#ffff00" });
    s.filterColumnRule("Sheet1", 1, { kind: "color", font: "#0000ff" });
    throughLibreOffice(s);
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, "out", `f${n}.xlsx`))));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const styles = strFromU8(files["xl/styles.xml"]!);
    expect(sheet).toMatch(/<filterColumn colId="1"><colorFilter cellColor="1" dxfId="\d+"\/>/);
    expect(sheet).toMatch(/<filterColumn colId="0"><colorFilter cellColor="0" dxfId="\d+"\/>/);
    expect(styles).toContain("FFFFFF00");
    expect(styles).toContain("FF0000FF");
  });

  it("opens a file with an average or a date filter, which it doesn't have, without losing a cell", () => {
    const s = new SheetSession(createWorkbook("f", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Amount", "Day"], [10, 45_000], [7, 45_001], [40, 44_990]]);
    s.setFilter("Sheet1", "A1:B4");
    s.filterColumnRule("Sheet1", 1, { kind: "average" });
    s.filterColumnRule("Sheet1", 2, { kind: "date", period: "thisMonth" });
    const back = throughLibreOffice(s).sheets[0]!;
    expect(Object.keys(back.cells)).toHaveLength(8);
    expect(back.filter?.range).toBe("A1:B4");
  });

  it("keeps the rule on a column of a table", () => {
    const s = new SheetSession(createWorkbook("f", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["Name", "Amount"], ["Apple pie", 10], ["Banana", 7], ["Cherry pie", 40]]);
    s.createTable("Sheet1", "A1:B4", { name: "Fruit" });
    s.filterTableRule("Fruit", "Amount", { kind: "custom", a: { op: "greaterThan", value: 8 } });
    const back = throughLibreOffice(s).sheets[0]!;
    expect(back.tables?.[0]?.filters?.["Amount"]).toEqual({ kind: "custom", a: { op: "greaterThan", value: 8 } });
  });
});
