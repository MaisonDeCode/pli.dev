import type { ChartElement, ChartType } from "./model";

/** The labels the editor's Insert > Chart menu and chart dialog use. */
export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  column: "Column",
  bar: "Bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
  doughnut: "Doughnut",
  scatter: "Scatter",
};

/** The sample data a new chart starts with: three categories and two series (one for a pie or doughnut chart). */
export function sampleChartData(chartType: ChartType): Pick<ChartElement, "chartType" | "categories" | "series"> & Partial<ChartElement> {
  switch (chartType) {
    case "pie":
    case "doughnut":
      return { chartType, categories: ["Category A", "Category B", "Category C"], series: [{ name: "Share", values: [45, 30, 25] }], legend: "right" };
    case "scatter":
      return {
        chartType,
        categories: [],
        series: [
          { name: "Series 1", x: [1, 2, 3, 4], values: [4, 9, 6, 12] },
          { name: "Series 2", x: [1.5, 2.5, 3.5, 4.5], values: [7, 5, 10, 8] },
        ],
        legend: "bottom",
      };
    default:
      return {
        chartType,
        ...(chartType === "area" ? { grouping: "stacked" as const } : {}),
        categories: ["Category A", "Category B", "Category C"],
        series: [
          { name: "Series 1", values: [12, 19, 8], ...(chartType === "line" ? { marker: true } : {}) },
          { name: "Series 2", values: [9, 14, 17], ...(chartType === "line" ? { marker: true } : {}) },
        ],
        legend: "bottom",
      };
  }
}
