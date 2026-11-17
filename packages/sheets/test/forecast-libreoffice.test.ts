import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "../src";
import { SOFFICE, inLibreOffice, makeDir, removeDir } from "./libreoffice-formulas";

/**
 * `FORECAST.ETS` and its three companions against LibreOffice (which has the same four functions): the forecast, the
 * interval, the pattern length found and all eight statistics, on six series with and without a pattern, with and
 * without the options, for targets after, inside and between the points; and on timelines of months, quarters and
 * days, with gaps, repeated times and times out of order. Runs only where LibreOffice is installed.
 */
const dir = makeDir("ets");
afterAll(() => removeDir(dir));

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const serial = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

/** The formulas, and the cells they read. */
function build() {
  const cells: Record<string, number> = {};
  const formulas: string[] = [];
  for (let s = 0; s < 6; s++) {
    const n = 14 + s * 3;
    const period = [0, 4, 3, 0, 6, 12][s]!;
    const v = String.fromCharCode(66 + s * 2);
    const t = String.fromCharCode(67 + s * 2);
    for (let i = 0; i < n; i++) {
      cells[`${v}${i + 1}`] = Math.round((50 + i * (s % 3) + (period ? 8 * Math.sin((2 * Math.PI * i) / period) : 0) + rnd() * 6) * 100) / 100;
      cells[`${t}${i + 1}`] = i + 1;
    }
    const V = `${v}1:${v}${n}`;
    const T = `${t}1:${t}${n}`;
    for (const opt of ["", ",0", ",1"]) {
      formulas.push(
        `FORECAST.ETS(${n + 1},${V},${T}${opt})`, `FORECAST.ETS(${n + 3},${V},${T}${opt})`, `FORECAST.ETS(${n - 2},${V},${T}${opt})`, `FORECAST.ETS(${n + 1.5},${V},${T}${opt})`, `FORECAST.ETS(${n - 2.5},${V},${T}${opt})`,
        `FORECAST.ETS.CONFINT(${n + 1},${V},${T},0.95${opt})`, `FORECAST.ETS.CONFINT(${n + 4},${V},${T},0.8${opt})`, `FORECAST.ETS.SEASONALITY(${V},${T}${opt})`,
      );
      for (let k = 1; k <= 8; k++) formulas.push(`FORECAST.ETS.STAT(${V},${T},${k}${opt})`);
    }
  }
  return { cells, formulas };
}

function timelines() {
  const y = [12, 15, 11, 18, 14, 17, 13, 20, 16, 19, 15, 22, 18, 21];
  const cells: Record<string, number> = {};
  y.forEach((v, i) => {
    cells[`B${i + 1}`] = v; // months
    cells[`C${i + 1}`] = serial(2020, 1 + i, 1);
    cells[`J${i + 1}`] = v; // quarters
    cells[`K${i + 1}`] = serial(2020 + Math.floor((i * 3) / 12), 1 + ((i * 3) % 12), 1);
    cells[`L${i + 1}`] = v; // days
    cells[`M${i + 1}`] = serial(2020, 1, 1) + i;
    cells[`N${i + 1}`] = v; // month ends
    cells[`O${i + 1}`] = serial(2020, 2 + i, 0);
    cells[`P${i + 1}`] = v; // steps of 2
    cells[`Q${i + 1}`] = 2 * i + 10;
  });
  [1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16].forEach((t, i) => ((cells[`D${i + 1}`] = y[i]!), (cells[`E${i + 1}`] = t))); // gaps
  [1, 2, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9, 10, 11].forEach((t, i) => ((cells[`F${i + 1}`] = y[i]!), (cells[`G${i + 1}`] = t))); // repeated times
  [5, 3, 1, 2, 4, 6, 8, 7, 9, 10, 12, 11, 13, 14].forEach((t, i) => ((cells[`H${i + 1}`] = y[i]!), (cells[`I${i + 1}`] = t))); // out of order
  const d = (a: number, b: number, c: number) => String(serial(a, b, c));
  const f: string[] = [
    `FORECAST.ETS(${d(2021, 5, 1)},B1:B14,C1:C14)`, `FORECAST.ETS(${d(2021, 5, 15)},B1:B14,C1:C14)`, `FORECAST.ETS(${d(2020, 6, 1)},B1:B14,C1:C14)`, "FORECAST.ETS.STAT(B1:B14,C1:C14,8)", "FORECAST.ETS.SEASONALITY(B1:B14,C1:C14)",
    `FORECAST.ETS(${d(2021, 3, 1)},J1:J14,K1:K14)`, `FORECAST.ETS(${d(2024, 3, 1)},J1:J14,K1:K14)`, "FORECAST.ETS.STAT(J1:J14,K1:K14,8)",
    `FORECAST.ETS(${serial(2020, 1, 1) + 20},L1:L14,M1:M14)`, `FORECAST.ETS(${d(2021, 5, 31)},N1:N14,O1:O14)`, "FORECAST.ETS.STAT(N1:N14,O1:O14,8)", "FORECAST.ETS(40,P1:P14,Q1:Q14)", "FORECAST.ETS(41,P1:P14,Q1:Q14)", "FORECAST.ETS.STAT(P1:P14,Q1:Q14,8)",
    "FORECAST.ETS(16,H1:H14,I1:I14)", "SUM(FORECAST.ETS({20,21,22},D1:D14,E1:E14))", "FORECAST.ETS.SEASONALITY(L1:L14,M1:M14,0)", "FORECAST.ETS.SEASONALITY(L1:L14,M1:M14,4)",
    // errors
    "FORECAST.ETS(15,B1:B14,C1:C13)", "FORECAST.ETS(15,B1:B2,E1:E2)", "FORECAST.ETS(0,E1:E14,E1:E14)", "FORECAST.ETS(0,D1:D14,E1:E14)", "FORECAST.ETS(15,D1:D14,E1:E14,8)", "FORECAST.ETS(15,D1:D14,E1:E14,-1)", "FORECAST.ETS(15,D1:D14,E1:E14,1,2)", "FORECAST.ETS(15,D1:D14,E1:E14,1,1,8)",
  ];
  for (const o of ["", ",1,0", ",1,1", ",0,1"]) f.push(`FORECAST.ETS(18,D1:D14,E1:E14${o})`, `FORECAST.ETS.STAT(D1:D14,E1:E14,1${o})`);
  for (let a = 1; a <= 7; a++) f.push(`FORECAST.ETS(12,F1:F14,G1:G14,1,1,${a})`, `FORECAST.ETS.STAT(F1:F14,G1:G14,7,1,1,${a})`);
  return { cells, formulas: f };
}

function compare(formulas: string[], cells: Record<string, number>): string[] {
  const theirs = inLibreOffice(dir, formulas, cells);
  const s = new SheetSession(createWorkbook("p"));
  s.setCells("Sheet1", cells);
  formulas.forEach((f, i) => s.setCell("Sheet1", `A${i + 1}`, "=" + f));
  const bad: string[] = [];
  formulas.forEach((f, i) => {
    const mine = s.value("Sheet1", `A${i + 1}`);
    const lo = theirs[i]!;
    const ok = typeof mine === "number" ? Math.abs(mine - Number(lo)) <= 1e-7 * Math.max(1, Math.abs(mine)) : typeof mine === "object" && mine !== null && /^(#|Err)/.test(lo);
    if (!ok) bad.push(`${f}: Pli ${JSON.stringify(mine)}, LibreOffice ${lo}`);
  });
  return bad;
}

// Skipped: this test used to pass only because LibreOffice showed the values Pli had cached in the file (see `forceRecalculation`).
// Worked out for real, LibreOffice's search is not Excel's and neither is Pli's old copy of it; Pli follows Excel's own answers now
// (the tests in functions-rest.test.ts).
describe.skip("FORECAST.ETS against LibreOffice", () => {
  it("agrees on the forecast, interval, pattern length and statistics of six series", () => {
    const { cells, formulas } = build();
    expect(compare(formulas, cells)).toEqual([]);
  }, 300_000);

  it("agrees on timelines of months, quarters and days, gaps, repeated and unsorted times, the options and the errors", () => {
    const { cells, formulas } = timelines();
    expect(compare(formulas, cells)).toEqual([]);
  }, 300_000);
});
