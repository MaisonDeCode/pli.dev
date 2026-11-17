import { PliError } from "@pli.dev/core";
import { MAX_CHART_SIZE, MIN_CHART_SIZE } from "./chart";
import type { Slicer, Workbook } from "./model";
import { sharing } from "./ghosts";
import { allTables, tableColumns } from "./table";

/** Whether a slicer or timeline has nothing to filter: its table or column is gone, or the table has no header row. */
export function isOrphanPanel(wb: Workbook, panel: { table: string; column: string }): boolean {
  const entry = allTables(wb).find((t) => t.table.id === panel.table);
  return !entry || entry.table.headerRow === false || !tableColumns(entry.sheet, entry.bounds, entry.table).includes(panel.column);
}

export const DEFAULT_SLICER_WIDTH = 180;
export const DEFAULT_SLICER_HEIGHT = 220;
/** The most columns of buttons a slicer has. */
export const MAX_SLICER_COLUMNS = 20;

const bad = (m: string): never => {
  throw new PliError("invalid_operation", m);
};

/** A slicer made ready to keep, or an error that says what is wrong: it needs a table with that column, and room on the sheet. */
export function checkSlicer(wb: Workbook, slicer: Slicer): Slicer {
  if (typeof slicer.id !== "string" || slicer.id === "") bad("A slicer needs an id");
  // In a shared workbook the table or column may have been taken away at the same moment: the slicer is kept and shows nothing.
  if (!sharing()) {
    const entry = allTables(wb).find((t) => t.table.id === slicer.table);
    if (!entry) return bad("A slicer needs a table to filter");
    if (!tableColumns(entry.sheet, entry.bounds, entry.table).includes(slicer.column)) bad(`"${String(slicer.column)}" isn't a column of the table "${entry.table.name}"`);
    if (entry.table.headerRow === false) bad("A table with no header row can't be filtered");
  }
  const f = slicer.from;
  if (!f || !Number.isInteger(f.row) || !Number.isInteger(f.col) || f.row < 1 || f.col < 1) bad("A slicer needs a cell to sit in");
  for (const n of [slicer.width, slicer.height]) if (!(n >= MIN_CHART_SIZE && n <= MAX_CHART_SIZE)) bad(`A slicer is ${MIN_CHART_SIZE} to ${MAX_CHART_SIZE} pixels across and high`);
  for (const d of [f.dx, f.dy]) if (d !== undefined && !(d >= 0 && Number.isFinite(d))) bad("A slicer's offset in its cell must be 0 or more");
  if (slicer.columns !== undefined && !(Number.isInteger(slicer.columns) && slicer.columns >= 1 && slicer.columns <= MAX_SLICER_COLUMNS)) bad(`A slicer has 1 to ${MAX_SLICER_COLUMNS} columns of buttons`);
  const out: Slicer = { id: slicer.id, table: slicer.table, column: slicer.column, from: { ...f }, width: slicer.width, height: slicer.height };
  if (slicer.caption) out.caption = slicer.caption;
  if (slicer.style && slicer.style !== "SlicerStyleLight1") out.style = slicer.style;
  if (slicer.columns && slicer.columns > 1) out.columns = slicer.columns;
  return out;
}
