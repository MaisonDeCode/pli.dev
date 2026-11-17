import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, parseCsv, toXlsx } from "../src";
import { fitTrendline } from "../src/trendline";

/**
 * LibreOffice is an independent implementation of the least-squares fits that Excel's trendlines are defined by (LINEST,
 * LOGEST, RSQ), and it reads and writes charts of its own. The trendline maths must agree with its LINEST, and the
 * kinds of chart Pli writes must open there and come back as the same kinds. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-charts-more-")) : "";
const lo = (args: string[]) => execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", ...args], { stdio: "ignore", timeout: 120_000 });

describe.skipIf(!SOFFICE)("trendlines against LibreOffice", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const ys = [2.3, 3.1, 5.8, 6.2, 9.9, 12.4, 14.1, 20.5, 24.3, 33.8];
  const cases: { name: string; type: "linear" | "exponential" | "logarithmic" | "polynomial" | "power"; order?: number; intercept?: number }[] = [
    { name: "linear", type: "linear" },
    { name: "linear through 1.5", type: "linear", intercept: 1.5 },
    { name: "exponential", type: "exponential" },
    { name: "exponential through 2", type: "exponential", intercept: 2 },
    { name: "logarithmic", type: "logarithmic" },
    { name: "power", type: "power" },
    { name: "poly 2", type: "polynomial", order: 2 },
    { name: "poly 3", type: "polynomial", order: 3 },
    { name: "poly 4", type: "polynomial", order: 4 },
    { name: "poly 2 through 1", type: "polynomial", order: 2, intercept: 1 },
  ];

  it("fits the same lines and R squared as LINEST", () => {
    const s = new SheetSession(createWorkbook("trend", ["T"]));
    // A is x, B is y; P:S hold x, x², x³, x⁴ side by side for the polynomial fits.
    s.setValues("T", "A1", xs.map((x, i) => [x, ys[i]!]));
    s.setValues("T", "P1", xs.map((x) => [x, x * x, x ** 3, x ** 4]));
    const Y = "$B$1:$B$10";
    const X = "$A$1:$A$10";
    cases.forEach((c, i) => {
      const row = i + 1;
      const idx = (call: string, r: number, k: number) => `INDEX(${call},${r},${k})`;
      let call: string;
      let n = 1;
      let withIntercept = c.intercept === undefined;
      const shift = c.intercept === undefined ? "" : `-${c.intercept}`;
      if (c.type === "linear") call = `LINEST(${Y}${shift},${X},${withIntercept},TRUE)`;
      else if (c.type === "exponential") call = `LINEST(LN(${Y})${c.intercept === undefined ? "" : `-LN(${c.intercept})`},${X},${withIntercept},TRUE)`;
      else if (c.type === "logarithmic") call = `LINEST(${Y},LN(${X}),TRUE,TRUE)`;
      else if (c.type === "power") call = `LINEST(LN(${Y}),LN(${X}),TRUE,TRUE)`;
      else {
        n = c.order!;
        call = `LINEST(${Y}${shift},$P$1:$${String.fromCharCode(79 + n)}$10,${withIntercept},TRUE)`;
      }
      if (c.type === "logarithmic" || c.type === "power") withIntercept = true;
      // H.. are the coefficients highest power first, then the intercept; N is R squared.
      for (let k = 1; k <= n; k++) s.setCell("T", `${String.fromCharCode(71 + k)}${row}`, `=${idx(call, 1, k)}`);
      s.setCell("T", `${String.fromCharCode(72 + n)}${row}`, withIntercept ? `=${idx(call, 1, n + 1)}` : c.type === "exponential" ? `=LN(${c.intercept})` : `=${c.intercept}`);
      s.setCell("T", `N${row}`, `=${idx(call, 3, 1)}`);
    });
    writeFileSync(join(dir, "t.xlsx"), toXlsx(s.state));
    lo(["--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,false,false", "--outdir", dir, join(dir, "t.xlsx")]);
    const rows = parseCsv(readFileSync(join(dir, "t.csv"), "utf8"));
    cases.forEach((c, i) => {
      const theirs = rows[i]!;
      const n = c.type === "polynomial" ? c.order! : 1;
      const coefs = Array.from({ length: n + 1 }, (_, k) => Number(theirs[7 + k]));
      const r2 = Number(theirs[13]);
      const mine = fitTrendline({ type: c.type, ...(c.order ? { order: c.order } : {}), ...(c.intercept !== undefined ? { intercept: c.intercept } : {}) }, xs, ys).fit!;
      const close = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${c.name} ${what}: ${a} vs ${b}`).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)));
      // LINEST lists the highest power first; exponential and power are fitted to the logarithm of y.
      if (c.type === "linear" || c.type === "logarithmic") {
        close(mine.coef[1]!, coefs[0]!, "slope");
        close(mine.coef[0]!, coefs[1]!, "intercept");
      } else if (c.type === "exponential") {
        close(mine.coef[1]!, coefs[0]!, "b");
        close(Math.log(mine.coef[0]!), coefs[1]!, "ln c");
      } else if (c.type === "power") {
        close(mine.coef[1]!, coefs[0]!, "b");
        close(Math.log(mine.coef[0]!), coefs[1]!, "ln c");
      } else {
        for (let k = 0; k <= n; k++) close(mine.coef[n - k]!, coefs[k]!, `coefficient ${n - k}`);
      }
      close(mine.rSquared, r2, "R squared");
    });
  }, 150_000);
});

describe.skipIf(!SOFFICE)("the other chart kinds through LibreOffice", () => {
  it("opens combined charts, trendlines and the classic kinds, and writes them back as the same", () => {
    const s = new SheetSession(createWorkbook("kinds", ["Data"]));
    s.setValues("Data", "A1", [["Month", "Sales", "Margin", "Units"], ["Jan", 10, 0.2, 5], ["Feb", 15, 0.25, 8], ["Mar", 12, 0.22, 6], ["Apr", 20, 0.3, 9], ["May", 24, 0.28, 12]]);
    const cat = "Data!$A$2:$A$6";
    const ser = (col: string, extra = {}) => ({ nameRef: `Data!$${col}$1`, values: `Data!$${col}$2:$${col}$6`, ...extra });
    s.addChart("Data", { type: "column", categories: cat, y2Title: "Margin", series: [ser("B"), ser("C", { type: "line", axis: "secondary" }), ser("D", { type: "area" })] });
    s.addChart("Data", { type: "scatter", series: [ser("D", { x: "Data!$B$2:$B$6", trendlines: [{ type: "linear", equation: true, rSquared: true, forward: 2 }, { type: "polynomial", order: 3 }, { type: "movingAverage", period: 2 }] })] });
    s.addChart("Data", { type: "line", categories: cat, series: [ser("B", { trendlines: [{ type: "exponential" }, { type: "logarithmic" }, { type: "power", name: "Pow" }] })] });
    s.addChart("Data", { type: "doughnut", holeSize: 60, categories: cat, series: [ser("B")] });
    s.addChart("Data", { type: "radar", filled: true, categories: cat, series: [ser("B"), ser("D")] });
    s.addChart("Data", { type: "bubble", series: [ser("C", { x: "Data!$B$2:$B$6", size: "Data!$D$2:$D$6" })] });
    s.addChart("Data", { type: "stock", stock: "hlc", categories: cat, series: [ser("B"), ser("C"), ser("D")] });
    writeFileSync(join(dir, "k.xlsx"), toXlsx(s.state));
    lo(["--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "k.xlsx")]);
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "k.xlsx"))));
    const charts = back.workbook.sheets[0]!.charts ?? [];
    expect(charts.map((c) => c.type)).toEqual(["column", "scatter", "line", "doughnut", "radar", "bubble", "stock"]);
    // the combined chart keeps a line on a second axis and an area
    // (LibreOffice lists the series by kind, so the order may change.)
    expect(charts[0]!.series.map((x) => `${x.type ?? charts[0]!.type} ${x.axis ?? "primary"}`).sort()).toEqual(["area primary", "column primary", "line secondary"]);
    expect(charts[0]!.y2Title).toBe("Margin");
    // trendlines survive with their kinds and options
    expect(charts[1]!.series[0]!.trendlines!.map((t) => t.type)).toEqual(["linear", "polynomial", "movingAverage"]);
    expect(charts[1]!.series[0]!.trendlines![0]).toMatchObject({ equation: true, rSquared: true, forward: 2 });
    expect(charts[1]!.series[0]!.trendlines![1]!.order).toBe(3);
    expect(charts[1]!.series[0]!.trendlines![2]!.period).toBe(2);
    expect(charts[2]!.series[0]!.trendlines!.map((t) => t.type)).toEqual(["exponential", "logarithmic", "power"]);
    // (LibreOffice writes no hole size back for a doughnut.)
    expect(charts[4]!.filled).toBe(true);
    expect(charts[5]!.series[0]).toMatchObject({ x: "Data!$B$2:$B$6", size: "Data!$D$2:$D$6" });
  }, 180_000);
});
