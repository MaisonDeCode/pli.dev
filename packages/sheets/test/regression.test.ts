import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, isError, type Value } from "../src";

function session(cells: Record<string, string | number>) {
  const s = new SheetSession(createWorkbook("r"));
  s.setCells("Sheet1", cells);
  return s;
}
/** The values a formula spills into, row by row. */
function spill(s: SheetSession, formula: string, rows: number, cols: number): Value[][] {
  s.setCell("Sheet1", "K1", "=" + formula);
  const out: Value[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Value[] = [];
    for (let c = 0; c < cols; c++) row.push(s.value("Sheet1", `${String.fromCharCode(75 + c)}${1 + r}`));
    out.push(row);
  }
  return out;
}

// Excel's help example: y = 2x + 1 exactly.
const LINE = { A1: 1, A2: 9, A3: 5, A4: 7, B1: 0, B2: 4, B3: 2, B4: 3 };

describe("LINEST", () => {
  it("gives the slope and intercept as a row", () => {
    const s = session(LINE);
    expect(spill(s, "LINEST(A1:A4,B1:B4)", 2, 2)).toEqual([[2, 1], [null, null]]);
    expect(spill(s, "LINEST(A1:A4,B1:B4,TRUE,FALSE)", 1, 2)).toEqual([[2, 1]]);
  });

  it("gives the five rows of statistics, with #N/A in the cells it doesn't fill", () => {
    const s = session({ ...LINE, A4: 7.5 });
    const r = spill(s, "LINEST(A1:A4,B1:B4,TRUE,TRUE)", 5, 2);
    expect(r[0]![0]).toBeCloseTo(2.0428571, 6);
    expect(r[2]![1]).toBeGreaterThan(0);
    expect(r[3]![1]).toBe(2); // degrees of freedom
    for (const row of [2, 3, 4]) expect(isError(r[row]![1]!) || typeof r[row]![1] === "number").toBe(true);
    const wide = spill(session({ ...LINE, A4: 7.5, C1: 1, C2: 3, C3: 2, C4: 5 }), "LINEST(A1:A4,B1:C4,TRUE,TRUE)", 5, 3);
    expect(wide[2]![2]).toEqual({ error: "#N/A" });
    expect(wide[3]![2]).toEqual({ error: "#N/A" });
    expect(wide[4]![2]).toEqual({ error: "#N/A" });
  });

  it("puts the coefficients of several variables last variable first", () => {
    // y = 3 + 2 a + 5 b exactly
    const cells: Record<string, number> = {};
    const a = [1, 2, 3, 4, 5, 6];
    const b = [2, 1, 5, 3, 6, 4];
    a.forEach((v, i) => ((cells[`A${i + 1}`] = 3 + 2 * v + 5 * b[i]!), (cells[`B${i + 1}`] = v), (cells[`C${i + 1}`] = b[i]!)));
    const [row] = spill(session(cells), "LINEST(A1:A6,B1:C6)", 1, 3);
    expect(row![0]).toBeCloseTo(5, 9);
    expect(row![1]).toBeCloseTo(2, 9);
    expect(row![2]).toBeCloseTo(3, 9);
  });

  it("forces the line through zero when const is FALSE and gives #N/A for the intercept's error", () => {
    const s = session({ A1: 2, A2: 4.2, A3: 5.9, B1: 1, B2: 2, B3: 3 });
    const r = spill(s, "LINEST(A1:A3,B1:B3,FALSE,TRUE)", 5, 2);
    expect(r[0]![0]).toBeCloseTo((2 + 8.4 + 17.7) / 14, 9);
    expect(r[0]![1]).toBe(0);
    expect(r[1]![1]).toEqual({ error: "#N/A" });
    expect(r[3]![1]).toBe(2); // n - 1
  });

  it("uses 1, 2, 3… when there are no known x's, and reads a row of y with the variables in rows", () => {
    const s = session({ A1: 3, B1: 5, C1: 7, D1: 9 });
    expect(spill(s, "LINEST(A1:D1)", 1, 2)).toEqual([[2, 1]]);
    const t = session({ A1: 1, B1: 9, C1: 5, D1: 7, A2: 0, B2: 4, C2: 2, D2: 3 });
    expect(spill(t, "LINEST(A1:D1,A2:D2)", 1, 2)).toEqual([[2, 1]]);
  });

  it("gives a variable that repeats the others a coefficient of 0 and an error of 0, as Excel does", () => {
    const cells: Record<string, number> = {};
    const a = [1, 2, 3, 4, 5, 6, 7];
    const b = [2, 1, 5, 3, 6, 4, 9];
    const noise = [0.1, -0.2, 0.15, -0.05, 0.2, -0.1, 0.05];
    a.forEach((v, i) => {
      cells[`A${i + 1}`] = 1 + 2 * v + 3 * b[i]! + noise[i]!;
      cells[`B${i + 1}`] = v;
      cells[`C${i + 1}`] = b[i]!;
      cells[`D${i + 1}`] = v + b[i]!; // a combination of B and C
    });
    const r = spill(session(cells), "LINEST(A1:A7,B1:D7,TRUE,TRUE)", 5, 4);
    expect(r[0]![0]).toBe(0);
    expect(r[1]![0]).toBe(0);
    expect(r[0]![1]).toBeCloseTo(3, 0);
    expect(r[0]![2]).toBeCloseTo(2, 0);
    expect(r[3]![1]).toBe(4); // 7 observations, 2 variables and the intercept
  });

  it("is #REF! when the shapes don't fit, #VALUE! for text or blanks, and passes errors on", () => {
    const s = session({ ...LINE, A5: "x", B5: 1, C1: 1, C2: 2 });
    expect(spill(s, "LINEST(A1:A4,B1:B3)", 1, 1)[0]![0]).toEqual({ error: "#REF!" });
    expect(spill(s, "LINEST(A1:B4,B1:B4)", 1, 1)[0]![0]).toEqual({ error: "#REF!" });
    expect(spill(s, "LINEST(A1:A5,B1:B5)", 1, 1)[0]![0]).toEqual({ error: "#VALUE!" });
    expect(spill(s, "LINEST(A1:A4,C1:C4)", 1, 1)[0]![0]).toEqual({ error: "#VALUE!" });
    expect(spill(s, "LINEST(A1:A4,B1:B4,TRUE,NA())", 1, 1)[0]![0]).toEqual({ error: "#N/A" });
  });
});

describe("LOGEST", () => {
  it("fits y = b * m^x", () => {
    const s = session({ A1: 6, A2: 18, A3: 54, A4: 162, B1: 1, B2: 2, B3: 3, B4: 4 });
    const [row] = spill(s, "LOGEST(A1:A4,B1:B4)", 1, 2);
    expect(row![0]).toBeCloseTo(3, 9);
    expect(row![1]).toBeCloseTo(2, 9);
  });
  it("keeps the statistics of the fit to the logarithms and is #NUM! for values that aren't over 0", () => {
    const s = session({ A1: 6, A2: 18, A3: 55, A4: 160, B1: 1, B2: 2, B3: 3, B4: 4, C1: 1, C2: 0, C3: 2, C4: 3 });
    const r = spill(s, "LOGEST(A1:A4,B1:B4,TRUE,TRUE)", 5, 2);
    expect(r[2]![0]).toBeGreaterThan(0.99);
    expect(r[3]![1]).toBe(2);
    expect(spill(s, "LOGEST(C1:C4,B1:B4)", 1, 1)[0]![0]).toEqual({ error: "#NUM!" });
  });
});

describe("TREND and GROWTH", () => {
  it("gives the values on the line at the new points, shaped like the new points", () => {
    const s = session(LINE);
    expect(spill(s, "TREND(A1:A4,B1:B4,{5;6})", 2, 1)).toEqual([[11], [13]]);
    expect(spill(s, "TREND(A1:A4,B1:B4,{5,6,7})", 1, 3)).toEqual([[11, 13, 15]]);
    expect(spill(s, "TREND(A1:A4,B1:B4)", 4, 1).map((r) => r[0])).toEqual([1, 9, 5, 7]);
    const own = spill(s, "TREND(A1:A4)", 4, 1).map((r) => r[0] as number); // y on 1, 2, 3, 4
    [3.4, 4.8, 6.2, 7.6].forEach((v, i) => expect(own[i]).toBeCloseTo(v, 9));
  });
  it("takes several variables a row at a time", () => {
    const cells: Record<string, number> = {};
    const a = [1, 2, 3, 4, 5, 6];
    const b = [2, 1, 5, 3, 6, 4];
    a.forEach((v, i) => ((cells[`A${i + 1}`] = 3 + 2 * v + 5 * b[i]!), (cells[`B${i + 1}`] = v), (cells[`C${i + 1}`] = b[i]!)));
    cells["E1"] = 10;
    cells["F1"] = 1;
    cells["E2"] = 0;
    cells["F2"] = 2;
    const r = spill(session(cells), "TREND(A1:A6,B1:C6,E1:F2)", 2, 1);
    expect(r[0]![0]).toBeCloseTo(3 + 20 + 5, 9);
    expect(r[1]![0]).toBeCloseTo(3 + 0 + 10, 9);
  });
  it("forces zero with const FALSE", () => {
    const s = session({ A1: 2, A2: 4, A3: 6, B1: 1, B2: 2, B3: 3 });
    expect(spill(s, "TREND(A1:A3,B1:B3,{10},FALSE)", 1, 1)[0]![0]).toBeCloseTo(20, 9);
  });
  it("GROWTH follows y = b * m^x", () => {
    const s = session({ A1: 6, A2: 18, A3: 54, A4: 162, B1: 1, B2: 2, B3: 3, B4: 4 });
    const r = spill(s, "GROWTH(A1:A4,B1:B4,{5;6})", 2, 1);
    expect(r[0]![0]).toBeCloseTo(486, 6);
    expect(r[1]![0]).toBeCloseTo(1458, 5);
    expect(spill(s, "GROWTH(A1:A4)", 4, 1)[3]![0]).toBeCloseTo(162, 6);
  });
});
