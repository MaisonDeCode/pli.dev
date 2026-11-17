import type { SheetSession } from "@pli.dev/sheets";

const SHEET = "Charts";

/** A year of sales by region, and one chart of each kind drawn from it. Change a number and the charts follow. */
export function fillChartsSheet(s: SheetSession): void {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const north = [42, 45, 51, 49, 58, 62, 66, 64, 59, 55, 60, 71];
  const south = [30, 33, 31, 38, 41, 40, 47, 52, 49, 46, 44, 53];
  const east = [18, 22, 25, 24, 29, 33, 31, 36, 38, 35, 39, 44];
  s.setValues(SHEET, "A1", [["Month", "North", "South", "East"], ...months.map((m, i) => [m, north[i]!, south[i]!, east[i]!])]);
  s.setStyle(SHEET, "A1:D1", { bold: true, fill: "#e4e2fb", color: "#3730a3" });

  s.setValues(SHEET, "A15", [
    ["Region", "Year total"],
    ["North", "=SUM(B2:B13)"],
    ["South", "=SUM(C2:C13)"],
    ["East", "=SUM(D2:D13)"],
  ]);
  s.setStyle(SHEET, "A15:B15", { bold: true, fill: "#e4e2fb", color: "#3730a3" });

  s.setValues(SHEET, "A21", [
    ["Ad spend", "Sales"],
    [5, 31], [8, 38], [12, 44], [15, 52], [19, 55], [22, 63], [26, 66], [31, 79], [35, 83], [40, 94],
  ]);
  s.setStyle(SHEET, "A21:B21", { bold: true, fill: "#e4e2fb", color: "#3730a3" });
  s.setColumnWidth(SHEET, 1, 12);
  s.setColumnWidth(SHEET, 2, 11);

  const at = (col: number, row: number) => ({ row, col });
  const w = 420;
  const h = 260;
  // Clustered columns for the first half of the year.
  s.insertChart(SHEET, "A1:D7", { type: "column" });
  const first = s.charts(SHEET)[0]!;
  s.updateChart(SHEET, first.id, { title: "Sales by month", yTitle: "Units", from: at(6, 1), width: w, height: h });

  const stacked = s.insertChart(SHEET, "A1:D7", { type: "column" });
  s.updateChart(SHEET, stacked.id, { title: "The same, stacked", grouping: "stacked", from: at(13, 1), width: w, height: h });

  const line = s.insertChart(SHEET, "A1:D13", { type: "line" });
  s.updateChart(SHEET, line.id, { title: "Trend over the year", smooth: true, legend: "top", from: at(6, 15), width: w, height: h });

  const area = s.insertChart(SHEET, "A1:D13", { type: "area" });
  s.updateChart(SHEET, area.id, { title: "Area, stacked", grouping: "stacked", legend: "right", from: at(13, 15), width: w, height: h });

  const bar = s.insertChart(SHEET, "A15:B18", { type: "bar" });
  s.updateChart(SHEET, bar.id, { title: "Year total by region", labels: true, from: at(6, 29), width: w, height: h });

  const pie = s.insertChart(SHEET, "A15:B18", { type: "pie" });
  s.updateChart(SHEET, pie.id, { title: "Share of the year", labels: true, legend: "right", from: at(13, 29), width: w, height: h });

  // The same kinds in three dimensions, for comparison.
  const col3 = s.insertChart(SHEET, "A1:D7", { type: "column" });
  s.updateChart(SHEET, col3.id, { title: "3-D columns", view3d: { rotX: 15, rotY: 20 }, from: at(20, 1), width: w, height: h });
  const bar3 = s.insertChart(SHEET, "A15:B18", { type: "bar" });
  s.updateChart(SHEET, bar3.id, { title: "3-D bars", view3d: { rotX: 15, rotY: 20 }, labels: true, from: at(20, 15), width: w, height: h });
  const area3 = s.insertChart(SHEET, "A1:D13", { type: "area" });
  s.updateChart(SHEET, area3.id, { title: "3-D area, stacked", grouping: "stacked", view3d: { rotX: 20, rotY: 25 }, legend: "right", from: at(20, 29), width: w, height: h });
  const pie3 = s.insertChart(SHEET, "A15:B18", { type: "pie" });
  s.updateChart(SHEET, pie3.id, { title: "3-D pie", view3d: { rotX: 40, rotY: 0 }, labels: true, legend: "right", from: at(20, 43), width: w, height: h });

  s.addChart(SHEET, {
    type: "scatter",
    title: "Does advertising pay?",
    xTitle: "Ad spend",
    yTitle: "Sales",
    legend: "none",
    series: [{ name: "Sales", x: `${SHEET}!$A$22:$A$31`, values: `${SHEET}!$B$22:$B$31`, color: "#ed7d31" }],
    from: at(6, 43),
    width: w,
    height: h,
  });
}
