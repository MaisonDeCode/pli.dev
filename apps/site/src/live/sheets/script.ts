import { createWorkbook, type SheetSession, type Workbook } from "@pli.dev/sheets";
import type { Segment } from "../player";

/**
 * The Sheets story, as small edits made through the session (`setCell`, `setFormat`, `setStyle`, `insertChart`, `addRule`):
 *
 *   step 0  a quarterly sales table is filled in, cell by cell, row by row
 *   step 1  totals and a growth column are computed with formulas, and the numbers are formatted and coloured
 *   step 2  a column chart is drawn from the data, with a data bar on the totals and the best growth picked out
 *
 * The same actions run with pauses when a step is played and all at once when it is applied instantly.
 */
export const SHEET = "Sales";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
export const REGIONS: readonly (readonly [string, number, number, number, number])[] = [
  ["North", 42100, 48300, 51900, 55200],
  ["South", 31500, 35200, 38800, 37100],
  ["East", 28900, 30100, 33400, 36000],
  ["West", 36700, 41000, 44200, 46800],
  ["Central", 19300, 22800, 24100, 26500],
  ["Remote", 12400, 15900, 18300, 21700],
];
const LAST = REGIONS.length + 1; // the last region's row
const TOTAL = LAST + 1; // the total row

const FILL_MS = 60;
const HEAD_FILL = "#dcf3ea";
const HEAD_TEXT = "#0b6b4c";
const BAR = "#34b88b";
const SERIES = ["#bfe9d9", "#7fd3b4", "#34b88b", "#0f8a63"];

export function blankWorkbook(): Workbook {
  return createWorkbook("Quarterly sales", [SHEET]);
}

export function createScript(s: SheetSession): readonly [Segment, Segment, Segment] {
  const cell = (list: { ms: number; run(): void }[], address: string, value: string | number, ms = FILL_MS) =>
    list.push({ ms, run: () => s.setCell(SHEET, address, value) });
  const act = (list: { ms: number; run(): void }[], ms: number, run: () => void) => list.push({ ms, run });

  // Step 0: the data.
  const first: { ms: number; run(): void }[] = [];
  act(first, 0, () => {
    [12, 9, 9, 9, 9, 11, 9].forEach((w, i) => s.setColumnWidth(SHEET, i + 1, w));
  });
  act(first, 300, () => {});
  ["Region", ...QUARTERS].forEach((h, i) => cell(first, `${"ABCDE"[i]}1`, h));
  REGIONS.forEach((row, r) => row.forEach((v, c) => cell(first, `${"ABCDE"[c]}${r + 2}`, v)));
  act(first, 400, () => {});

  // Step 1: formulas and formats.
  const second: { ms: number; run(): void }[] = [];
  act(second, 250, () => {});
  cell(second, "F1", "Total");
  cell(second, "G1", "Growth");
  for (let r = 2; r <= LAST; r++) cell(second, `F${r}`, `=SUM(B${r}:E${r})`);
  for (let r = 2; r <= LAST; r++) cell(second, `G${r}`, `=(E${r}-B${r})/B${r}`);
  cell(second, `A${TOTAL}`, "Total");
  for (const col of "BCDEF") cell(second, `${col}${TOTAL}`, `=SUM(${col}2:${col}${LAST})`);
  cell(second, `G${TOTAL}`, `=(E${TOTAL}-B${TOTAL})/B${TOTAL}`);
  act(second, 300, () => s.setFormat(SHEET, `B2:F${TOTAL}`, "$#,##0"));
  act(second, 200, () => s.setFormat(SHEET, `G2:G${TOTAL}`, "0.0%"));
  act(second, 250, () => {
    s.setStyle(SHEET, "A1:G1", { bold: true, fill: HEAD_FILL, color: HEAD_TEXT });
    s.setStyle(SHEET, "B1:G1", { align: "right" });
  });
  act(second, 250, () => {
    s.setStyle(SHEET, `A${TOTAL}:G${TOTAL}`, { bold: true });
    s.setBorders(SHEET, `A${TOTAL}:G${TOTAL}`, "top", { style: "thin", color: "#6b7280" });
  });
  act(second, 300, () => {});

  // Step 2: a chart and two rules.
  const third: { ms: number; run(): void }[] = [];
  act(third, 300, () => {
    const chart = s.insertChart(SHEET, `A1:E${LAST}`, { type: "column" });
    s.updateChart(SHEET, chart.id, {
      title: "Revenue by region",
      legend: "bottom",
      from: { row: 1, col: 8 },
      width: 380,
      height: 250,
      series: chart.series.map((x, i) => ({ ...x, color: SERIES[i % SERIES.length]! })),
    });
  });
  act(third, 450, () => {
    s.addRule(SHEET, { kind: "dataBar", ranges: [`F2:F${LAST}`], min: { type: "num", value: 0 }, max: { type: "max" }, color: BAR, solid: true });
  });
  act(third, 350, () => {
    s.addRule(SHEET, { kind: "top", rank: 1, ranges: [`G2:G${LAST}`], style: { bold: true, color: HEAD_TEXT, fill: "#bff0dc" } });
  });
  act(third, 300, () => {});

  return [first, second, third];
}
