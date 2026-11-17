import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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

const CONFIGS: Record<string, Parameters<SheetSession["createPivot"]>[1]> = {
  "rows and a sum": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: ["Sales"] },
  "rows, columns and a sum": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], columns: ["Product"], values: ["Qty"] },
  "two row fields": { source: "Data!A1:D8", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"] },
  "two values": { source: "Data!A1:D8", anchor: "A1", rows: ["Product"], values: ["Qty", "Sales"] },
  "average, max and count": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: [{ field: "Qty", fn: "average" }, { field: "Sales", fn: "max", name: "Biggest" }, { field: "Product", fn: "count", name: "How many" }] },
  "min and product": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: [{ field: "Qty", fn: "min" }, { field: "Sales", fn: "product", name: "Times" }] },
  "deviations": { source: "Data!A1:D8", anchor: "A1", rows: ["Product"], values: [{ field: "Sales", fn: "stdDevp", name: "SD pop" }, { field: "Qty", fn: "varp", name: "Var pop" }] },
  "a filter": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: ["Sales"], filters: [{ field: "Product", items: ["Apple", "Pear"] }] },
  "tabular with subtotals": { source: "Data!A1:D8", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"], tabular: true },
  "no grand totals": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], columns: ["Product"], values: ["Sales"], grandTotalRows: false, grandTotalColumns: false },
  "a share of the total": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: [{ field: "Sales", showAs: "percentOfTotal" }] },
  "sorted by a value": { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", sortBy: { value: 0, descending: true } }], columns: ["Product"], values: ["Sales"] },
  "outline form": { source: "Data!A1:D8", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"], outline: true },
  "the top two": { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", filter: { kind: "top", by: 0, n: 2 } }], values: ["Sales"] },
  "your own order": { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", order: ["West", "East"] }], values: ["Sales"] },
  "blank lines and repeated labels": { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", blankRow: true }, "Product"], values: ["Sales"], tabular: true, repeatLabels: true },
  "a calculated field": { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], values: ["Sales", "Unit"], calculated: [{ name: "Unit", formula: "Sales / Qty" }] },
  "a hidden item": { source: "Data!A1:D8", anchor: "A1", rows: [{ field: "Region", hidden: ["North"] }], columns: ["Product"], values: ["Sales"] },
};

describe.skipIf(!SOFFICE)("pivot tables through LibreOffice", () => {
  for (const [label, spec] of Object.entries(CONFIGS)) {
    it(`sums up the same numbers: ${label}`, () => {
      const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
      s.setValues("Data", "A1", DATA);
      const p = s.createPivot("Pivot", spec);
      const { sheet } = throughLibreOffice(s);
      const mine = numbers(s.sheet("Pivot").cells, p.range);
      expect(mine.length).toBeGreaterThan(2);
      // LibreOffice's pivot table has the same numbers (it lays the headings out and names totals its own way).
      const theirs = sheet.pivots?.[0];
      expect(theirs, `LibreOffice kept the pivot table`).toBeDefined();
      const got = numbers(sheet.cells, theirs!.range).sort((a, b) => a - b);
      const want = [...mine].sort((a, b) => a - b);
      expect(got.length).toBe(want.length);
      got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 8));
    });
  }

  it("keeps the fields where they were put, the functions and the headings", () => {
    const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
    s.setValues("Data", "A1", DATA);
    s.createPivot("Pivot", { source: "Data!A1:D8", anchor: "A1", rows: ["Region"], columns: ["Product"], values: [{ field: "Sales", fn: "max", name: "Best sale" }, { field: "Qty", fn: "average" }] });
    const { sheet } = throughLibreOffice(s);
    const p = sheet.pivots![0]!;
    expect(p.source).toBe("Data!$A$1:$D$8");
    expect(p.rows.map((f) => f.field)).toEqual(["Region"]);
    expect(p.columns.map((f) => f.field)).toEqual(["Product"]);
    expect(p.values.map((v) => [v.field, v.fn, v.name])).toEqual([["Sales", "max", "Best sale"], ["Qty", "average", undefined]]);
  });

  it("opens a pivot table made over a table", () => {
    const s = new SheetSession(createWorkbook("pv", ["Data", "Pivot"]));
    s.setValues("Data", "A1", DATA);
    s.createTable("Data", "A1:D8", { name: "Orders" });
    s.createPivot("Pivot", { source: "Orders", anchor: "A1", rows: ["Product"], values: ["Qty"] });
    const { sheet } = throughLibreOffice(s);
    const got = numbers(sheet.cells, sheet.pivots![0]!.range).sort((a, b) => a - b);
    expect(got).toEqual(numbers(s.sheet("Pivot").cells, s.pivots("Pivot")[0]!.range).sort((a, b) => a - b));
  });
});
