import { fontKey } from "@pli.dev/core";
import { parseCell } from "./address";
import type { Workbook } from "./model";

/**
 * Every font family a workbook names, once each, in the order they come: for each sheet its cells (row by row), the runs of
 * their notes, then everything else on the sheet (charts, conditional formats, tables, pivot tables), and last the table and
 * pivot styles of the workbook. Only names that are written down count: the default font that cells without a font of their
 * own take (Calibri) is not listed unless some cell says it, and a note's default (Tahoma) likewise.
 *
 * A host calls `registry.pdfFonts(usedFonts(wb))` to fetch what printing the workbook to PDF needs, or `registry.load` on each
 * to have them ready for the screen.
 */
export function usedFonts(wb: Workbook): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: unknown) => {
    if (typeof name !== "string") return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = fontKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  /** The names under the keys that hold a font: `fontFamily` anywhere, `family` in a chart (a `ChartFont`), `font` of a note's run. */
  const walk = (node: unknown, inChart: boolean): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inChart);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "fontFamily" || (inChart && key === "family")) add(value);
      else walk(value, inChart);
    }
  };

  for (const sheet of wb.sheets) {
    const keys = Object.keys(sheet.cells).sort((a, b) => {
      const p = parseCell(a);
      const q = parseCell(b);
      return p && q ? p.row - q.row || p.col - q.col : a < b ? -1 : 1;
    });
    for (const key of keys) {
      const cell = sheet.cells[key]!;
      add(cell.s?.fontFamily);
      for (const run of cell.noteRuns ?? []) add(run.font);
    }
    const { cells: _cells, charts, ...rest } = sheet;
    walk(rest, false);
    walk(charts, true);
  }
  walk(wb.tableStyles, false);
  walk(wb.pivotStyles, false);
  walk(wb.slicerStyles, false);
  return out;
}
