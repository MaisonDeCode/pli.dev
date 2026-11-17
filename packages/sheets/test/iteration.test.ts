import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, isError, parseCsv, parseWorkbook, serializeWorkbook, toXlsx } from "../src";

const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-iter-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const book = (cells: Record<string, string | number>) => {
  const s = new SheetSession(createWorkbook("it"));
  for (const [a, v] of Object.entries(cells)) s.setCell("Sheet1", a, v);
  return s;
};

describe("iterative calculation", () => {
  it("is off to begin with: a formula that reads itself reads 0 and is circular", () => {
    const s = book({ A1: "=A1+1", B1: "=B1" });
    expect(s.value("Sheet1", "B1")).toBe(0);
    expect(s.calculator.isCircular("Sheet1", "B1")).toBe(true);
    expect(s.value("Sheet1", "A1")).toBe(1);
    expect(s.calculator.isCircular("Sheet1", "A1")).toBe(true);
    expect(s.iteration).toBeNull();
  });

  it("counts up to the most iterations for a formula that never settles", () => {
    const s = book({ A1: "=A1+1" });
    s.setIteration({ maxIterations: 100 });
    expect(s.value("Sheet1", "A1")).toBe(100);
    expect(s.calculator.isCircular("Sheet1", "A1")).toBe(false);
    s.setIteration({ maxIterations: 7 });
    expect(s.value("Sheet1", "A1")).toBe(7);
  });

  it("stops once the change is small enough", () => {
    const s = book({ A1: "=(A1+10)/2" });
    s.setIteration({ maxIterations: 1000, maxChange: 0.001 });
    const v = s.value("Sheet1", "A1") as number;
    expect(Math.abs(v - 10)).toBeLessThan(0.002);
    expect(v).not.toBe(10); // it stopped early rather than running all 1000
    s.setIteration({ maxIterations: 1000, maxChange: 1e-12 });
    expect(s.value("Sheet1", "A1") as number).toBeCloseTo(10, 9);
  });

  it("settles a chain of cells that read each other, and what reads the chain", () => {
    const s = book({ A1: "=B1/2+5", B1: "=A1", C1: "=A1+B1" });
    s.setIteration({ maxIterations: 200, maxChange: 1e-9 });
    expect(s.value("Sheet1", "A1")).toBeCloseTo(10, 6);
    expect(s.value("Sheet1", "B1")).toBeCloseTo(10, 6);
    expect(s.value("Sheet1", "C1")).toBeCloseTo(20, 6);
  });

  it("works a loop out again when a cell it reads changes", () => {
    const s = book({ A1: "=A2*0.5+A1*0.5", A2: 4 });
    s.setIteration({ maxIterations: 500, maxChange: 1e-10 });
    expect(s.value("Sheet1", "A1")).toBeCloseTo(4, 6);
    s.setCell("Sheet1", "A2", 10);
    expect(s.value("Sheet1", "A1")).toBeCloseTo(10, 6);
  });

  it("starts from the value a cell had last, so a cell can keep a running total", () => {
    const s = book({ B1: 5, A1: "=A1+B1" });
    s.setIteration({ maxIterations: 1 });
    expect(s.value("Sheet1", "A1")).toBe(5);
    s.setCell("Sheet1", "B1", 7);
    expect(s.value("Sheet1", "A1")).toBe(12);
    s.setCell("Sheet1", "B1", 1);
    expect(s.value("Sheet1", "A1")).toBe(13);
  });

  it("reports an error that never settles as an error", () => {
    const s = book({ A1: "=A1/0" });
    s.setIteration({ maxIterations: 10 });
    expect(isError(s.value("Sheet1", "A1"))).toBe(true);
  });

  it("can be turned off again, and undone", () => {
    const s = book({ A1: "=A1+1" });
    s.setIteration({});
    expect(s.iteration).toEqual({ maxIterations: 100, maxChange: 0.001 });
    expect(s.value("Sheet1", "A1")).toBe(100);
    s.setIteration(null);
    expect(s.value("Sheet1", "A1")).toBe(1);
    expect(s.calculator.isCircular("Sheet1", "A1")).toBe(true);
    s.undo();
    expect(s.value("Sheet1", "A1")).toBe(100);
  });

  it("refuses settings that make no sense", () => {
    const s = book({});
    expect(() => s.setIteration({ maxIterations: 0 })).toThrow();
    expect(() => s.setIteration({ maxIterations: 1.5 })).toThrow();
    expect(() => s.setIteration({ maxIterations: 40000 })).toThrow();
    expect(() => s.setIteration({ maxChange: -1 })).toThrow();
    expect(() => s.setIteration({ maxChange: Number.NaN })).toThrow();
  });

  it("is saved with the workbook, and a bad setting in a file is named", () => {
    const s = book({ A1: "=A1+1" });
    s.setIteration({ maxIterations: 12, maxChange: 0.5 });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.iteration).toEqual({ maxIterations: 12, maxChange: 0.5 });
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.iteration.maxIterations = 0;
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/workbook\.iteration/);
    bad.workbook.iteration = { maxIterations: 3, extra: 1 };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/extra/);
  });

  it("goes in and out of Excel files as calcPr iterate, iterateCount and iterateDelta", () => {
    const s = book({ A1: "=A1+1" });
    s.setIteration({ maxIterations: 33, maxChange: 0.25 });
    const { workbook } = fromXlsx(toXlsx(s.state));
    expect(workbook.iteration).toEqual({ maxIterations: 33, maxChange: 0.25 });
    const off = book({ A1: 1 });
    expect(fromXlsx(toXlsx(off.state)).workbook.iteration).toBeUndefined();
  });
});

describe.skipIf(!SOFFICE)("iterative calculation through LibreOffice", () => {
  it("settles to the same numbers", () => {
    const s = book({ A1: "=B1/2+5", B1: "=A1", C1: "=(C1+30)/3", D1: "=A1+C1" });
    s.setIteration({ maxIterations: 500, maxChange: 1e-9 });
    writeFileSync(join(dir, "it.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,false,false", "--outdir", dir, join(dir, "it.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const row = parseCsv(readFileSync(join(dir, "it.csv"), "utf8"))[0]!;
    ["A1", "B1", "C1", "D1"].forEach((a, i) => expect(Number(row[i]), a).toBeCloseTo(s.value("Sheet1", a) as number, 3));
    expect(Number(row[0])).toBeCloseTo(10, 3);
    expect(Number(row[2])).toBeCloseTo(15, 3);
  });
});
