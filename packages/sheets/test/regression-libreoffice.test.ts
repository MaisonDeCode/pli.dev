import { afterAll, describe, expect, it } from "vitest";
import { SOFFICE, disagreements, makeDir, removeDir } from "./libreoffice-formulas";

/**
 * `LINEST`, `LOGEST`, `TREND` and `GROWTH` against LibreOffice: every coefficient and statistic, with and without an
 * intercept, with one and with several variables, with the variables in rows, and with a variable that is a combination
 * of the others. Runs only where LibreOffice is installed.
 */
const dir = makeDir("regression");
afterAll(() => removeDir(dir));

const Y = [3.1, 4.9, 7.2, 8.8, 11.3, 12.7, 15.4, 16.9, 19.6, 21.2];
const X1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const X2 = [2, 1, 4, 3, 6, 5, 9, 7, 12, 8];
const X3 = [5, 3, 8, 2, 9, 4, 7, 1, 6, 10];
const YP = [2.2, 3.1, 4.7, 7.0, 10.9, 16.2, 24.1, 36.3, 54.8, 81.0];
const cells: Record<string, number> = {};
Y.forEach((v, i) => {
  cells[`C${i + 1}`] = v;
  cells[`D${i + 1}`] = X1[i]!;
  cells[`E${i + 1}`] = X2[i]!;
  cells[`F${i + 1}`] = X3[i]!;
  cells[`G${i + 1}`] = X1[i]! + X2[i]!; // a combination of D and E
  cells[`H${i + 1}`] = YP[i]!;
  cells[`I${i + 1}`] = 4; // constant
});
// The same data on its side, in rows 20 to 24.
Y.forEach((v, i) => {
  const col = String.fromCharCode(65 + i);
  cells[`${col}20`] = v;
  cells[`${col}21`] = X1[i]!;
  cells[`${col}22`] = X2[i]!;
});

const SETS: Record<string, [string, string]> = {
  "one variable": ["C1:C10", "D1:D10"],
  "two variables": ["C1:C10", "D1:E10"],
  "three variables": ["C1:C10", "D1:F10"],
  "no x": ["C1:C10", ""],
  "variables in rows": ["A20:J20", "A21:J22"],
};

const FORMULAS: string[] = [];
for (const [name, [y, x]] of Object.entries(SETS)) {
  const xs = x ? `,${x}` : "";
  for (const constant of ["TRUE", "FALSE"]) {
    const call = (fn: string, yy = y) => `${fn}(${yy}${xs},${constant},TRUE)`;
    const width = name === "one variable" || name === "no x" ? 2 : name === "two variables" || name === "variables in rows" ? 3 : 4;
    for (let r = 1; r <= 5; r++) for (let c = 1; c <= width; c++) FORMULAS.push(`INDEX(${call("LINEST")},${r},${c})`);
    for (let c = 1; c <= width; c++) FORMULAS.push(`INDEX(LINEST(${y}${xs},${constant}),1,${c})`);
  }
}
// Three variables, with and without the intercept.
for (const constant of ["TRUE", "FALSE"]) {
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 4; c++) FORMULAS.push(`INDEX(LINEST(C1:C10,D1:F10,${constant},TRUE),${r},${c})`);
}
// A perfect fit and fits with as many observations as unknowns.
for (let r = 1; r <= 5; r++) for (let c = 1; c <= 2; c++) FORMULAS.push(`INDEX(LINEST({1;9;5;7},{0;4;2;3},TRUE,TRUE),${r},${c})`, `INDEX(LINEST({1;9;5},{0;4;2},TRUE,TRUE),${r},${c})`, `INDEX(LINEST({1;9},{0;4},TRUE,TRUE),${r},${c})`);
// The logarithmic fit.
for (const constant of ["TRUE", "FALSE"]) {
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 2; c++) FORMULAS.push(`INDEX(LOGEST(H1:H10,D1:D10,${constant},TRUE),${r},${c})`);
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 3; c++) FORMULAS.push(`INDEX(LOGEST(H1:H10,D1:E10,${constant},TRUE),${r},${c})`);
}
// Values on the fitted curves.
for (const constant of ["TRUE", "FALSE"]) {
  FORMULAS.push(`SUM(TREND(C1:C10,D1:D10,{11;12;13},${constant}))`, `INDEX(TREND(C1:C10,D1:D10,{11;12;13},${constant}),2)`, `SUM(TREND(C1:C10,D1:E10,E1:E3,${constant}))`);
  FORMULAS.push(`SUM(TREND(C1:C10,D1:E10,D1:E10,${constant}))`, `INDEX(TREND(C1:C10,D1:E10,D1:E10,${constant}),4)`, `SUM(TREND(C1:C10,,,${constant}))`);
  FORMULAS.push(`SUM(GROWTH(H1:H10,D1:D10,{11;12},${constant}))`, `INDEX(GROWTH(H1:H10,D1:E10,D1:E10,${constant}),7)`, `SUM(GROWTH(H1:H10,,,${constant}))`);
}
FORMULAS.push("SLOPE(C1:C10,D1:D10)", "INTERCEPT(C1:C10,D1:D10)", "RSQ(C1:C10,D1:D10)", "STEYX(C1:C10,D1:D10)", "FORECAST(11,C1:C10,D1:D10)", "FORECAST.LINEAR(11,C1:C10,D1:D10)");
// Things that are errors.
FORMULAS.push("INDEX(LINEST(C1:C10,D1:D9),1,1)", "INDEX(LINEST(C1:D10,D1:D10),1,1)", "INDEX(LOGEST(C1:C10,D1:D10),1,1)", "INDEX(LOGEST(C1:C10,D1:D10),1,2)");

describe.skipIf(!SOFFICE)("regression functions agree with LibreOffice", () => {
  it("on coefficients, statistics and predictions", () => {
    expect(FORMULAS.length).toBeGreaterThan(300);
    const problems = disagreements(dir, FORMULAS, cells);
    expect(problems.join("\n")).toBe("");
  }, 300_000);
});
