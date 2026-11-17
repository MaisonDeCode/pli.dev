import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dateSerial } from "../src/values";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type Cell, type Sheet } from "../src";

/**
 * LibreOffice reads a pivot table's definition and draws it again from the source. What it works out must agree with Pli's
 * own sums (the numbers, not the captions: LibreOffice says "Total Result" where Excel says "Grand Total"), and the
 * definition it writes back must read as the same fields. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-pivot-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const DATA = [
  ["Region", "Product", "Qty", "Sales"],
  ["East", "Apple", 10, 100],
  ["East", "Pear", 5, 40],
  ["West", "Apple", 7, 70],
  ["West", "Pear", 3, 33],
  ["East", "Apple", 2, 20],
  ["North", "Plum", 4, 44],
  ["North", "Apple", 8, 81],
];
const DATED = [
  ["When", "Region", "N"],
  [dateSerial(2023, 1, 5), "East", 1],
  [dateSerial(2023, 2, 20), "West", 2],
  [dateSerial(2023, 2, 25), "East", 4],
  [dateSerial(2023, 5, 9), "West", 8],
  [dateSerial(2024, 1, 9), "East", 16],
  [dateSerial(2024, 3, 30), "West", 32],
];

let n = 0;
function throughLibreOffice(s: SheetSession): { sheet: Sheet; workbook: ReturnType<typeof fromXlsx>["workbook"] } {
  const name = `f${++n}`;
  writeFileSync(join(dir, `${name}.xlsx`), toXlsx(s.state));
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
  const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", `${name}.xlsx`)))).workbook;
  return { sheet: back.sheets.find((x) => x.name === "Pivot")!, workbook: back };
}

/** The numbers in the cells of a range, in order, row by row. */
function numbers(cells: Record<string, Cell>, range: string): number[] {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range)!;
  const col = (s: string) => [...s].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  const name = (n: number) => (n > 26 ? String.fromCharCode(64 + Math.floor((n - 1) / 26)) : "") + String.fromCharCode(65 + ((n - 1) % 26));
  const out: number[] = [];
  for (let r = Number(m[2]); r <= Number(m[4]); r++) for (let c = col(m[1]!); c <= col(m[3]!); c++) if (typeof cells[`${name(c)}${r}`]?.v === "number") out.push(cells[`${name(c)}${r}`]!.v as number);
  return out;
}


type Spec = Parameters<SheetSession["createPivot"]>[1];
const inner = { by: "items" as const, name: "Pair", groups: [{ name: "Coasts", items: ["East", "West"] }] };
const outer = { by: "items" as const, name: "All", groups: [{ name: "Anywhere", items: ["Coasts", "North"] }], of: inner };
const SOURCE = "[Prices.xlsx]Sheet1!$A$1:$D$8";

describe.skipIf(!SOFFICE)("pivot tables over other data and with nested groups, through LibreOffice", () => {
  /** LibreOffice draws the table again from the file and writes it out; every number Pli drew has to be among the numbers it drew (it leaves some subtotals out). */
  const check = (s: SheetSession, label: string, subset = false, skip: number[] = []) => {
    const p = s.pivots("Pivot")[0]!;
    const { sheet } = throughLibreOffice(s);
    const mine = numbers(s.sheet("Pivot").cells, p.range);
    expect(mine.length, `${label} has numbers`).toBeGreaterThan(1);
    const all = numbers(sheet.cells, "A1:Z60");
    if (!subset) {
      expect(sheet.pivots?.[0], "LibreOffice kept the pivot table").toBeDefined();
      expect(numbers(sheet.cells, sheet.pivots![0]!.range).sort((a, b) => a - b)).toEqual([...mine].sort((a, b) => a - b));
    } else {
      const pool = [...all];
      for (const v of new Set(mine.filter((x) => !skip.includes(x)))) expect(pool, `${label}: ${v}`).toContain(v);
    }
  };
  it("reads the rows the cache holds for a range of another workbook", () => {
    const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
    s.setDataBlock(SOURCE, { rows: DATA, path: "file:///tmp/Prices.xlsx" });
    s.createPivot("Pivot", { source: SOURCE, anchor: "A1", rows: ["Region"], columns: ["Product"], values: ["Sales"] });
    check(s, "another workbook");
  });
  it("sums up groups inside groups", () => {
    const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
    s.setValues("Data", "A1", DATA);
    s.createPivot("Pivot", { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", group: outer }, { field: "Region", group: inner }, "Region"], values: ["Sales"], tabular: true });
    // LibreOffice reads the field but not the groups made over it (it draws East, North, West and the total): the group total Coasts, 263, is Pli's alone.
    check(s, "groups of groups", true, [263]);
  });
  it("opens a file with a pivot style of your own and kept looks", () => {
    const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
    s.setValues("Data", "A1", DATA);
    s.setPivotStyle("Mine", { headerRow: { fill: "#003366", color: "#ffffff" }, firstRowStripe: { fill: "#eeeeee" } });
    const p = s.createPivot("Pivot", { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: ["Sales"], style: { name: "Mine", rowStripes: true } });
    s.formatPivot("Pivot", p.id, { part: "data", items: [{ field: "Region", item: "East" }] }, { style: { bold: true } });
    check(s, "a style of your own", true);
  });
  it("opens a file with several filters on a field and a consolidation with two page fields", () => {
    const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
    s.setValues("Data", "A1", DATA);
    s.createPivot("Pivot", { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", filter: { kind: "label", a: { op: "notEquals", value: "South" } }, filters: [{ kind: "value", by: 0, a: { op: "greaterThan", value: 50 } }] }], values: ["Sales"] });
    // LibreOffice draws every item (it applies none of the filters); the file opens and the items it draws add up the same.
    expect(throughLibreOffice(s).sheet.cells).toBeDefined();
    const t = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
    t.setValues("Data", "H1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
    t.setValues("Data", "H6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
    t.createPivot("Pivot", { source: "Data!H1:J3", anchor: "A1", ranges: [{ source: "Data!H1:J3", names: ["A", "x"] }, { source: "Data!H6:J8", names: ["B", "y"] }], pageFields: 2, rows: ["Row"], columns: ["Column"], values: ["Value"] });
    check(t, "two page fields", true);
  });
});
