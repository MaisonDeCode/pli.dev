import { createId } from "@pli.dev/core";
import type { Doc, TableBlock, TableCell, TableRow } from "./model";
import { emptyParagraph, endPointOf, finish, startPointOf, where, type Command, type CommandResult } from "./command-utils";
import {
  cellAt,
  colSpanOf,
  deleteColumnsAt,
  deleteRowsAt,
  insertColumnAt,
  insertRowAt,
  mergeRect,
  normalizeColumns,
  originsIn,
  rectOfCell,
  rowSpanOf,
  splitAt,
  type GridRect,
} from "./grid";
import { caret, cellRect, type Point, type Selection } from "./selection";

export { normalizeColumns };

function newCell(): TableCell {
  return { id: createId("c_"), blocks: [emptyParagraph()] };
}

function newRow(columns: number): TableRow {
  return { id: createId("r_"), cells: Array.from({ length: columns }, newCell) };
}

/** A table of empty cells with equal columns. */
export function createTable(
  rows: number,
  columns: number,
  options: { headerRow?: boolean; borders?: TableBlock["borders"] } = {},
): TableBlock {
  const r = Math.max(1, Math.floor(rows));
  const c = Math.max(1, Math.floor(columns));
  return {
    id: createId("b_"),
    type: "table",
    rows: Array.from({ length: r }, () => newRow(c)),
    columns: normalizeColumns(Array.from({ length: c }, () => 1)),
    ...(options.headerRow && { headerRow: true }),
    ...(options.borders && { borders: options.borders }),
  };
}

interface Here {
  table: TableBlock;
  /** The cell the caret is in; null when the table itself is selected. */
  row: number | null;
  col: number | null;
  /** The squares covered: the caret's cell (all of a merged cell), a dragged rectangle, or the whole table. */
  rect: GridRect;
}

/** The table the selection is in or on, and which squares of its grid it covers. */
function hereIn(doc: Doc, selection: Selection): Here | null {
  const dragged = cellRect(doc, selection);
  if (dragged) {
    const { row1, row2, col1, col2 } = dragged;
    return { table: dragged.table, row: row1, col: col1, rect: { row1, row2, col1, col2 } };
  }
  const located = where(doc, selection.focus.block);
  if (located.cell) {
    const { table, row, col, cell } = located.cell;
    return { table, row, col, rect: rectOfCell(cell, row, col) };
  }
  if (located.block.type === "table") {
    const table = located.block;
    return { table, row: null, col: null, rect: { row1: 0, row2: table.rows.length - 1, col1: 0, col2: table.columns.length - 1 } };
  }
  return null;
}

/** The table the selection is in or on, for UI that needs to know. */
export function tableAtSelection(doc: Doc, selection: Selection): TableBlock | null {
  return hereIn(doc, selection)?.table ?? null;
}

function replaceTable(table: TableBlock, next: TableBlock, to: Point): CommandResult {
  return { ops: [{ type: "replace_block", id: table.id, block: next }], selection: caret(to.block, to.offset) };
}

/** The start of the content of whatever cell owns a grid square. */
function firstBlockOfCell(table: TableBlock, row: number, col: number): Point {
  const r = Math.min(Math.max(row, 0), table.rows.length - 1);
  const c = Math.min(Math.max(col, 0), table.columns.length - 1);
  return { block: cellAt(table, r, c).cell.blocks[0]!.id, offset: 0 };
}

/**
 * Adds a row above or below the selected row (below a merged cell's last row). With the whole table
 * selected, at the start or end. The caret goes to the same column of the new row, or to `column`.
 */
export function addRow(position: "above" | "below", column?: number): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const { table, rect } = here;
    const at = position === "above" ? (here.row === null ? 0 : rect.row1) : here.row === null ? table.rows.length : rect.row2 + 1;
    const next = insertRowAt(table, at);
    return replaceTable(table, next, firstBlockOfCell(next, at, column ?? here.col ?? 0));
  };
}

/** Adds a column left or right of the selected column. Existing columns shrink to make room. */
export function addColumn(position: "left" | "right"): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const { table, rect } = here;
    const at = position === "left" ? (here.col === null ? 0 : rect.col1) : here.col === null ? table.columns.length : rect.col2 + 1;
    const next = insertColumnAt(table, at);
    return replaceTable(table, next, firstBlockOfCell(next, here.row ?? 0, at));
  };
}

/** Removes the selected rows. Removing every row removes the table. */
export function deleteRow(): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const { table, rect } = here;
    if (rect.row1 === 0 && rect.row2 === table.rows.length - 1) return deleteTable()(doc, selection);
    const next = deleteRowsAt(table, rect.row1, rect.row2);
    return replaceTable(table, next, firstBlockOfCell(next, rect.row1, here.col ?? 0));
  };
}

/** Removes the selected columns. Removing every column removes the table. */
export function deleteColumn(): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const { table, rect } = here;
    if (rect.col1 === 0 && rect.col2 === table.columns.length - 1) return deleteTable()(doc, selection);
    const next = deleteColumnsAt(table, rect.col1, rect.col2);
    return replaceTable(table, next, firstBlockOfCell(next, here.row ?? 0, rect.col1));
  };
}

/** Removes the whole table. */
export function deleteTable(): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const { table } = here;
    const top = doc.blocks.findIndex((b) => b.id === table.id);
    const before = doc.blocks[top - 1];
    const after = doc.blocks[top + 1];
    const point = (before && endPointOf(before)) || (after && startPointOf(after)) || null;
    return finish(doc, [{ type: "delete_block", id: table.id }], point ? caret(point.block, point.offset) : caret(table.id, 0));
  };
}

/**
 * Merges the selected cells into one. Select two or more cells by dragging across them. Their
 * contents are joined, in reading order, in the merged cell.
 */
export function mergeCells(): Command {
  return (doc, selection) => {
    const dragged = cellRect(doc, selection);
    if (!dragged) return null;
    const next = mergeRect(dragged.table, dragged);
    if (!next) return null;
    return replaceTable(dragged.table, next, firstBlockOfCell(next, dragged.row1, dragged.col1));
  };
}

/** Splits every merged cell in the selection back into single cells. */
export function splitCells(): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    let next: TableBlock | null = null;
    for (const { row, col } of originsIn(here.table, here.rect)) {
      next = splitAt(next ?? here.table, row, col) ?? next;
    }
    return next ? replaceTable(here.table, next, firstBlockOfCell(next, here.rect.row1, here.rect.col1)) : null;
  };
}

/** Turns the first row into a header row, or back into a normal one. */
export function setHeaderRow(on: boolean): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here || !!here.table.headerRow === on) return null;
    const { headerRow: _old, ...rest } = here.table;
    const next: TableBlock = on ? { ...rest, headerRow: true } : rest;
    return { ops: [{ type: "replace_block", id: here.table.id, block: next }], selection };
  };
}

/** Chooses which cell borders are drawn. */
export function setTableBorders(borders: NonNullable<TableBlock["borders"]>): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here || (here.table.borders ?? "all") === borders) return null;
    const { borders: _old, ...rest } = here.table;
    const next: TableBlock = borders === "all" ? rest : { ...rest, borders };
    return { ops: [{ type: "replace_block", id: here.table.id, block: next }], selection };
  };
}

/** Changes a property of the selected cells (merged cells count once). */
function updateCells(table: TableBlock, rect: GridRect, change: (cell: TableCell) => TableCell): TableBlock {
  const rows = table.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((cell, c) => {
      const inside = r >= rect.row1 && r <= rect.row2 && c >= rect.col1 && c <= rect.col2;
      return inside && !cell.covered ? change(cell) : cell;
    }),
  }));
  return { ...table, rows };
}

/** Colors the background of the selected cells (the whole table if it is selected). `null` clears it. */
export function setCellShade(color: string | null): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const next = updateCells(here.table, here.rect, (cell) => {
      const { shade: _old, ...rest } = cell;
      return color ? { ...rest, shade: color } : rest;
    });
    return { ops: [{ type: "replace_block", id: here.table.id, block: next }], selection };
  };
}

/** Sets where the content sits in the height of the selected cells. `top` is the default. */
export function setCellVerticalAlign(align: "top" | "middle" | "bottom"): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const next = updateCells(here.table, here.rect, (cell) => {
      const { vAlign: _old, ...rest } = cell;
      return align === "top" ? rest : { ...rest, vAlign: align };
    });
    return { ops: [{ type: "replace_block", id: here.table.id, block: next }], selection };
  };
}

/**
 * Sets the minimum height, in points, of the selected rows. A row still grows to fit its content.
 * `null` goes back to fitting the content.
 */
export function setRowHeight(points: number | null): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here) return null;
    const height = points === null ? null : Math.min(2000, Math.max(6, points));
    const rows = here.table.rows.map((row, r) => {
      if (r < here.rect.row1 || r > here.rect.row2) return row;
      const { height: _old, ...rest } = row;
      return height === null ? rest : { ...rest, height };
    });
    return { ops: [{ type: "replace_block", id: here.table.id, block: { ...here.table, rows } }], selection };
  };
}

/** Sets the width of every column, as fractions of the table. They are scaled to add up to 1. */
export function setColumnWidths(widths: readonly number[]): Command {
  return (doc, selection) => {
    const here = hereIn(doc, selection);
    if (!here || widths.length !== here.table.columns.length) return null;
    const columns = normalizeColumns(widths);
    return { ops: [{ type: "replace_block", id: here.table.id, block: { ...here.table, columns } }], selection };
  };
}

export type CellMove = { to: Point } | { appendRow: true } | null;

/**
 * Where Tab or Shift+Tab goes from the caret: the next cell in reading order (a merged cell counts
 * once), or, past the last cell, a request to add a row. Null when the caret isn't in a table, or is
 * in the first cell going back.
 */
export function cellNeighbor(doc: Doc, selection: Selection, direction: 1 | -1): CellMove {
  const located = where(doc, selection.focus.block);
  if (!located.cell) return null;
  const { table, row, col } = located.cell;
  const cols = table.columns.length;
  const total = table.rows.length * cols;
  for (let index = row * cols + col + direction; index >= 0 && index < total; index += direction) {
    const r = Math.floor(index / cols);
    const c = index % cols;
    if (!table.rows[r]!.cells[c]!.covered) return { to: firstBlockOfCell(table, r, c) };
  }
  return direction > 0 ? { appendRow: true } : null;
}

export { colSpanOf, rowSpanOf };
