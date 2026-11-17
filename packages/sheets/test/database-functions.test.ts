import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, isError, parseCsv, toXlsx, type Value } from "../src";

const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-db-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

// A table in A1:E8, criteria blocks to the right.
const TABLE = [
  ["Tree", "Height", "Age", "Yield", "Profit"],
  ["Apple", 18, 20, 14, 105],
  ["Pear", 12, 12, 10, 96],
  ["Cherry", 13, 14, 9, 105],
  ["Apple", 14, 15, 10, 75],
  ["Pear", 9, 8, 8, 76.8],
  ["Apple", 8, 9, 6, 45],
  ["Plum", 20, 5, null, 12],
];
const make = () => {
  const s = new SheetSession(createWorkbook("db"));
  s.setValues("Sheet1", "A1", TABLE);
  // G1:H2 Tree = Apple and Height > 10; G4:H6 Tree = Apple or Pear; J1:J2 begins with "P"; L1:L2 exact "=Pear"
  s.setValues("Sheet1", "G1", [["Tree", "Height"], ["Apple", ">10"]]);
  s.setValues("Sheet1", "G4", [["Tree"], ["Apple"], ["Pear"]]);
  s.setValues("Sheet1", "J1", [["Tree"], ["P"]]);
  s.setValues("Sheet1", "L1", [["Tree"], ["'=Pear"]]);
  s.setValues("Sheet1", "N1", [["Age", "Age"], [">8", "<15"]]);
  return s;
};

const CASES: [string, Value][] = [
  ['DSUM(A1:E8,"Profit",G1:H2)', 180],
  ['DSUM(A1:E8,5,G1:H2)', 180],
  ['DSUM(A1:E8,"profit",G4:G6)', 105 + 75 + 45 + 96 + 76.8],
  ['DAVERAGE(A1:E8,"Yield",G4:G6)', (14 + 10 + 6 + 10 + 8) / 5],
  ['DCOUNT(A1:E8,"Yield",G4:G6)', 5],
  ['DCOUNT(A1:E8,"Yield",A1:A8)', 6],
  ['DCOUNTA(A1:E8,"Yield",J1:J2)', 2],
  ['DCOUNTA(A1:E8,"Yield",G4:G6)', 5],
  ['DMAX(A1:E8,"Profit",G4:G6)', 105],
  ['DMIN(A1:E8,"Profit",G4:G6)', 45],
  ['DPRODUCT(A1:E8,"Yield",G1:H2)', 140],
  ['DGET(A1:E8,"Yield",L1:L2)', { error: "#NUM!" }],
  ['DGET(A1:E8,"Yield",G1:H2)', { error: "#NUM!" }],
  ['DSUM(A1:E8,"Profit",N1:O2)', 96 + 105 + 45],
  ['DSUM(A1:E8,"Nope",G1:H2)', { error: "#VALUE!" }],
  ['DSUM(A1:E8,9,G1:H2)', { error: "#VALUE!" }],
];

describe("the database functions", () => {
  it.each(CASES)("%s", (formula, want) => {
    const s = make();
    s.setCell("Sheet1", "Q1", `=${formula}`);
    const got = s.value("Sheet1", "Q1");
    if (typeof want === "number") expect(got).toBeCloseTo(want, 9);
    else expect(got).toEqual(want);
  });

  it("matches text that begins with the criterion, and = for the whole text", () => {
    const s = make();
    s.setCell("Sheet1", "Q1", '=DCOUNT(A1:E8,"Yield",J1:J2)');
    s.setCell("Sheet1", "Q2", '=DCOUNT(A1:E8,"Yield",L1:L2)');
    expect([s.value("Sheet1", "Q1"), s.value("Sheet1", "Q2")]).toEqual([2, 2]);
  });

  it("joins the conditions in a row by and, and the rows by or", () => {
    const s = make();
    s.setCell("Sheet1", "Q1", '=DCOUNTA(A1:E8,"Tree",G1:H2)');
    s.setCell("Sheet1", "Q2", '=DCOUNTA(A1:E8,"Tree",G4:G6)');
    expect([s.value("Sheet1", "Q1"), s.value("Sheet1", "Q2")]).toEqual([2, 5]);
  });

  it("gives one value, or says why there isn't one", () => {
    const s = make();
    s.setValues("Sheet1", "G9", [["Tree", "Age"], ["Cherry", ">0"]]);
    s.setValues("Sheet1", "G12", [["Tree"], ["Fig"]]);
    s.setCell("Sheet1", "Q1", '=DGET(A1:E8,"Profit",G9:H10)');
    s.setCell("Sheet1", "Q2", '=DGET(A1:E8,"Profit",G12:G13)');
    expect([s.value("Sheet1", "Q1"), s.value("Sheet1", "Q2")]).toEqual([105, { error: "#VALUE!" }]);
  });

  it("works out deviations and variances, and divides by zero as Excel does", () => {
    const s = make();
    const apples = [105, 75, 45];
    const mean = 75;
    const ss = apples.reduce((a, x) => a + (x - mean) ** 2, 0);
    s.setValues("Sheet1", "G9", [["Tree"], ["Apple"]]);
    s.setValues("Sheet1", "G12", [["Tree"], ["Fig"]]);
    s.setCell("Sheet1", "Q1", '=DSTDEV(A1:E8,"Profit",G9:G10)');
    s.setCell("Sheet1", "Q2", '=DSTDEVP(A1:E8,"Profit",G9:G10)');
    s.setCell("Sheet1", "Q3", '=DVAR(A1:E8,"Profit",G9:G10)');
    s.setCell("Sheet1", "Q4", '=DVARP(A1:E8,"Profit",G9:G10)');
    s.setCell("Sheet1", "Q5", '=DAVERAGE(A1:E8,"Profit",G12:G13)');
    s.setCell("Sheet1", "Q6", '=DMAX(A1:E8,"Profit",G12:G13)');
    expect(s.value("Sheet1", "Q1")).toBeCloseTo(Math.sqrt(ss / 2), 9);
    expect(s.value("Sheet1", "Q2")).toBeCloseTo(Math.sqrt(ss / 3), 9);
    expect(s.value("Sheet1", "Q3")).toBeCloseTo(ss / 2, 9);
    expect(s.value("Sheet1", "Q4")).toBeCloseTo(ss / 3, 9);
    expect(s.value("Sheet1", "Q5")).toEqual({ error: "#DIV/0!" });
    expect(s.value("Sheet1", "Q6")).toBe(0);
  });

  it("follows the cells it reads", () => {
    const s = make();
    s.setCell("Sheet1", "Q1", '=DSUM(A1:E8,"Profit",G1:H2)');
    expect(s.value("Sheet1", "Q1")).toBe(180);
    s.setCell("Sheet1", "E2", 205);
    expect(s.value("Sheet1", "Q1")).toBe(280);
    s.setCell("Sheet1", "H2", ">15");
    expect(s.value("Sheet1", "Q1")).toBe(205);
  });
});

describe.skipIf(!SOFFICE)("the database functions through LibreOffice", () => {
  it("give what LibreOffice gives on the same file", () => {
    const s = make();
    const formulas = CASES.map((c) => c[0]).filter((f) => !f.includes("DGET"));
    formulas.forEach((f, i) => s.setCell("Sheet1", `Q${i + 1}`, `=${f}`));
    writeFileSync(join(dir, "db.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,false,false", "--outdir", dir, join(dir, "db.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const rows = parseCsv(readFileSync(join(dir, "db.csv"), "utf8"));
    const col = 16; // Q
    formulas.forEach((f, i) => {
      const mine = s.value("Sheet1", `Q${i + 1}`);
      const theirs = rows[i]?.[col] ?? "";
      if (isError(mine)) expect(theirs.startsWith("#") || theirs.startsWith("Err:"), `${f}: ${theirs}`).toBe(true);
      else expect(Number(theirs), `${f}: ${theirs}`).toBeCloseTo(mine as number, 6);
    });
  });
});
