import { PliError } from "@pli.dev/core";
import type { Bounds } from "./address";
import { CHART_COLORS, chartRef, chartRefText } from "./chart";
import type { Chart, ChartSeries } from "./model";
import type { Value } from "./values";

/*
 * Series by rows. A chart's series are references, so a table with the months across (a row for each series) is just
 * series whose values are rows. This file picks series that way from cells, says which way a chart's data runs, and
 * switches it (Excel's Switch Row/Column): every series becomes a category and every category a series.
 */

/** Whether a chart's series run down columns or across rows; null when that can't be said (typed-in series, single cells…). */
export function chartOrientation(chart: Pick<Chart, "series">, home: string): "columns" | "rows" | null {
  let found: "columns" | "rows" | null = null;
  for (const s of chart.series) {
    const r = chartRef(s.values, home);
    if (!r) return null;
    const tall = r.bounds.r2 > r.bounds.r1;
    const wide = r.bounds.c2 > r.bounds.c1;
    const o = tall && !wide ? "columns" : wide && !tall ? "rows" : null;
    if (o === null) return chart.series.length === 1 && !tall && !wide ? "columns" : null;
    if (found && found !== o) return null;
    found = o;
  }
  return found;
}

const refOf = (home: string, b: Bounds) => chartRefText(home, b);

/**
 * Switches the rows and columns of a chart's data: the categories become series (named by the old labels) and the series become the
 * categories (labelled by the old names). The series must run the same way, side by side (or one above the other) over the
 * same cells, and their names (when they have cells for them) must stand in a line. Returns the new `categories` and `series`.
 * Colours, trendlines, error bars and point colours belong to the old series and are not carried over.
 */
export function switchRowsColumns(chart: Chart, home: string): { categories?: string; series: ChartSeries[] } {
  const bad = (m: string): never => {
    throw new PliError("invalid_operation", m);
  };
  if (chart.type === "scatter" || chart.type === "bubble" || chart.type === "stock" || chart.type === "histogram" || chart.type === "boxWhisker" || chart.type === "waterfall" || chart.type === "pareto" || chart.type === "funnel") {
    bad(`A ${chart.type} chart has no rows and columns to switch`);
  }
  const way = chartOrientation(chart, home);
  if (!way) bad("The series of this chart must each be a row, or each a column, of cells to switch them");
  const parts = chart.series.map((s) => chartRef(s.values, home)!);
  const sheet = parts[0]!.sheet;
  if (parts.some((p) => p.sheet.toLowerCase() !== sheet.toLowerCase())) bad("The series are on different sheets");
  const cols = way === "columns";
  // Along the series: where their values run (rows of a column series, columns of a row series). Across: where the series stand.
  const lo = (b: Bounds) => (cols ? b.r1 : b.c1);
  const hi = (b: Bounds) => (cols ? b.r2 : b.c2);
  const at = (b: Bounds) => (cols ? b.c1 : b.r1);
  if (parts.some((p) => lo(p.bounds) !== lo(parts[0]!.bounds) || hi(p.bounds) !== hi(parts[0]!.bounds))) bad("The series don't cover the same cells, so they can't be switched");
  const positions = parts.map((p) => at(p.bounds)).sort((a, b) => a - b);
  for (let i = 1; i < positions.length; i++) if (positions[i] !== positions[i - 1]! + 1) bad("The series aren't next to each other, so they can't be switched");
  const first = positions[0]!;
  const length = hi(parts[0]!.bounds) - lo(parts[0]!.bounds) + 1;
  const start = lo(parts[0]!.bounds);

  // The old names become the new categories: they must stand in a line, in the order of the series.
  let categories: string | undefined;
  const ordered = chart.series.map((s, i) => ({ s, p: parts[i]!, i })).sort((a, b) => at(a.p.bounds) - at(b.p.bounds));
  const nameCells = ordered.map(({ s }) => (s.nameRef ? chartRef(s.nameRef, home) : null));
  if (nameCells.every((n) => n !== null && n.bounds.r1 === n.bounds.r2 && n.bounds.c1 === n.bounds.c2 && n.sheet.toLowerCase() === sheet.toLowerCase())) {
    const cells = nameCells.map((n) => n!.bounds);
    const along = cols ? (b: Bounds) => b.c1 : (b: Bounds) => b.r1;
    const fixed = cols ? (b: Bounds) => b.r1 : (b: Bounds) => b.c1;
    if (cells.every((c) => fixed(c) === fixed(cells[0]!)) && cells.every((c, i) => i === 0 || along(c) === along(cells[i - 1]!) + 1)) {
      categories = refOf(sheet, cols ? { r1: cells[0]!.r1, c1: cells[0]!.c1, r2: cells[0]!.r1, c2: cells[cells.length - 1]!.c1 } : { r1: cells[0]!.r1, c1: cells[0]!.c1, r2: cells[cells.length - 1]!.r1, c2: cells[0]!.c1 });
    }
  }

  // The old categories become the names of the new series, one cell each.
  const cat = chart.categories ? chartRef(chart.categories, home) : null;
  const catCells: Bounds[] | null =
    cat && cat.sheet.toLowerCase() === sheet.toLowerCase() && (cols ? cat.bounds.r2 - cat.bounds.r1 + 1 === length && cat.bounds.c1 === cat.bounds.c2 : cat.bounds.c2 - cat.bounds.c1 + 1 === length && cat.bounds.r1 === cat.bounds.r2)
      ? Array.from({ length }, (_, k) => (cols ? { r1: cat.bounds.r1 + k, c1: cat.bounds.c1, r2: cat.bounds.r1 + k, c2: cat.bounds.c1 } : { r1: cat.bounds.r1, c1: cat.bounds.c1 + k, r2: cat.bounds.r1, c2: cat.bounds.c1 + k }))
      : null;

  const count = positions.length;
  const series: ChartSeries[] = Array.from({ length }, (_, k) => {
    // The values of new series k: the cells at place k along the old series, across all of them.
    const values = cols ? { r1: start + k, c1: first, r2: start + k, c2: first + count - 1 } : { r1: first, c1: start + k, r2: first + count - 1, c2: start + k };
    return {
      ...(catCells ? { nameRef: refOf(sheet, catCells[k]!) } : {}),
      values: refOf(sheet, values),
      color: CHART_COLORS[k % CHART_COLORS.length]!,
    };
  });
  return { ...(categories ? { categories } : {}), series };
}

/** The series a block of cells has when each row is a series (a table with the months across): a first row of text or dates gives the labels, a first column of text gives the names. */
export function pickByRows(b: Bounds, sheet: string, val: (r: number, c: number) => Value, isDate: (r: number, c: number) => boolean): { series: ChartSeries[]; categories?: string; dates: boolean } {
  const isText = (v: Value) => typeof v === "string" && v !== "";
  const multiRow = b.r2 > b.r1;
  const wide = b.c2 > b.c1;
  const dateFirst = wide && isDate(b.r1, b.c1 + 1);
  const catRow = multiRow && wide && (isText(val(b.r1, b.c1 + 1)) || dateFirst || val(b.r1, b.c1) === null) ? b.r1 : 0;
  const hasHeader = wide && Array.from({ length: b.r2 - b.r1 + 1 }, (_, i) => b.r1 + i).some((r) => r !== catRow && isText(val(r, b.c1)));
  const left = hasHeader ? b.c1 + 1 : b.c1;
  const series: ChartSeries[] = [];
  for (let r = b.r1; r <= b.r2; r++) {
    if (r === catRow) continue;
    let numbers = 0;
    for (let c = left; c <= b.c2; c++) if (typeof val(r, c) === "number") numbers++;
    if (!numbers) continue;
    series.push({
      ...(hasHeader && isText(val(r, b.c1)) ? { nameRef: refOf(sheet, { r1: r, c1: b.c1, r2: r, c2: b.c1 }) } : {}),
      values: refOf(sheet, { r1: r, c1: left, r2: r, c2: b.c2 }),
      color: CHART_COLORS[series.length % CHART_COLORS.length]!,
    });
  }
  return { series, ...(catRow ? { categories: refOf(sheet, { r1: catRow, c1: left, r2: catRow, c2: b.c2 }) } : {}), dates: !!catRow && dateFirst };
}
