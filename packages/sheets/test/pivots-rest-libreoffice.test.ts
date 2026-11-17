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
// LibreOffice leaves out the label filters, the value filter between two numbers, and the items left out of a field the table does not use:
// it reads the file but draws every item. Excel applies them when it refreshes; those are checked in the file itself (pivots-rest-xlsx.test.ts).
const PLAIN: Record<string, Spec> = {
  "values down the rows": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: ["Qty", "Sales"], valuesOnRows: true },
  "values down the rows in tabular form": { source: "Data!A1:D8", anchor: "A1", rows: ["Region", "Product"], values: ["Qty", "Sales"], valuesOnRows: true, tabular: true },
  "a value filter": { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", filter: { kind: "value", by: 0, a: { op: "greaterThan", value: 80 } } }], values: ["Sales"] },
  "numbers grouped": { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Qty", group: { by: "number", step: 4, start: 0, end: 12 } }], values: ["Sales"] },
  "a style and stripes": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: ["Sales"], style: { name: "PivotStyleMedium3", rowStripes: true } },
};
const DATES: Record<string, Spec> = {
  "dates by year": { source: "Data!A1:C7", anchor: "A1", rows: [{ field: "When", group: { by: "years" } }], values: ["N"] },
  "dates by month": { source: "Data!A1:C7", anchor: "A1", rows: [{ field: "When", group: { by: "months" } }], values: ["N"] },
  "dates by quarter": { source: "Data!A1:C7", anchor: "A1", rows: [{ field: "When", group: { by: "quarters" } }], columns: ["Region"], values: ["N"] },
  "dates by year and month": { source: "Data!A1:C7", anchor: "A1", rows: [{ field: "When", group: { by: "years" } }, { field: "When", group: { by: "months" } }], values: ["N"] },
  "dates in ranges of 30 days": { source: "Data!A1:C7", anchor: "A1", rows: [{ field: "When", group: { by: "dayRange", days: 30 } }], values: ["N"] },
};

describe.skipIf(!SOFFICE)("the rest of the pivot tables through LibreOffice", () => {
  const check = (s: SheetSession, label: string) => {
    const p = s.pivots("Pivot")[0]!;
    const { sheet } = throughLibreOffice(s);
    // The years are numbers in Pli's cells and text in LibreOffice's.
    const mine = numbers(s.sheet("Pivot").cells, p.range).filter((v) => !(/year/.test(label) && (v === 2023 || v === 2024)));
    expect(mine.length, `${label} has numbers`).toBeGreaterThan(1);
    const theirs = sheet.pivots?.[0];
    expect(theirs, `LibreOffice kept the pivot table`).toBeDefined();
    const got = numbers(sheet.cells, theirs!.range).sort((a, b) => a - b);
    const want = [...mine].sort((a, b) => a - b);
    expect(got).toEqual(want);
  };
  for (const [label, spec] of Object.entries(PLAIN)) {
    it(`sums up the same numbers: ${label}`, () => {
      const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
      s.setValues("Data", "A1", DATA);
      s.createPivot("Pivot", spec);
      check(s, label);
    });
  }
  for (const [label, spec] of Object.entries(DATES)) {
    it(`sums up the same numbers: ${label}`, () => {
      const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
      s.setValues("Data", "A1", DATED);
      s.setFormat("Data", "A2:A7", "m/d/yyyy");
      s.createPivot("Pivot", spec);
      check(s, label);
    });
  }
});
