import { createId } from "@pli.dev/core";
import type { CellBlock, ParagraphBlock, TableBlock, TableCell, TableRow } from "./model";

/**
 * The grid logic of tables with merged cells. Everything here is pure: it takes a table and
 * returns a new one. A merged cell is the cell at its top-left square (`colSpan`, `rowSpan`); the
 * other squares it covers hold `covered` placeholder cells. See `TableCell`.
 */

/** Column widths that add up to exactly 1, whatever the rounding. */
export function normalizeColumns(widths: readonly number[]): number[] {
  const total = widths.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return widths.map(() => 1 / widths.length);
  const fractions = widths.map((w) => Math.max(0, w) / total);
  // Fold the rounding error into the last column so the sum is exactly 1.
  const rest = fractions.slice(0, -1).reduce((sum, f) => sum + f, 0);
  fractions[fractions.length - 1] = 1 - rest;
  return fractions;
}

export function rowSpanOf(cell: TableCell): number {
  return cell.rowSpan ?? 1;
}

export function colSpanOf(cell: TableCell): number {
  return cell.colSpan ?? 1;
}

/** A rectangle of grid squares, inclusive. */
export interface GridRect {
  row1: number;
  row2: number;
  col1: number;
  col2: number;
}

/** The top-left square of the cell that covers every square of the grid. `origin[r][c]` is that cell's row and column. */
export function originMap(table: TableBlock): { row: number; col: number }[][] {
  const rows = table.rows.length;
  const cols = table.columns.length;
  const map: ({ row: number; col: number } | undefined)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => undefined));
  table.rows.forEach((row, r) =>
    row.cells.forEach((cell, c) => {
      if (cell.covered) return;
      for (let rr = r; rr < Math.min(rows, r + rowSpanOf(cell)); rr++) {
        for (let cc = c; cc < Math.min(cols, c + colSpanOf(cell)); cc++) {
          if (!map[rr]![cc]) map[rr]![cc] = { row: r, col: c };
        }
      }
    }),
  );
  // A well-formed table covers every square; if not, a square is its own origin.
  return map.map((line, r) => line.map((o, c) => o ?? { row: r, col: c }));
}

/** The cell, with its position, that owns a grid square. */
export function cellAt(table: TableBlock, row: number, col: number): { cell: TableCell; row: number; col: number } {
  const origin = originMap(table)[row]![col]!;
  return { cell: table.rows[origin.row]!.cells[origin.col]!, row: origin.row, col: origin.col };
}

/** The squares of a cell: its own position and span. */
export function rectOfCell(cell: TableCell, row: number, col: number): GridRect {
  return { row1: row, row2: row + rowSpanOf(cell) - 1, col1: col, col2: col + colSpanOf(cell) - 1 };
}

/** Grows a rectangle until it contains every merged cell it touches, completely. */
export function expandRect(table: TableBlock, rect: GridRect): GridRect {
  const origins = originMap(table);
  let { row1, row2, col1, col2 } = rect;
  for (let changed = true; changed; ) {
    changed = false;
    for (let r = row1; r <= row2; r++) {
      for (let c = col1; c <= col2; c++) {
        const o = origins[r]![c]!;
        const full = rectOfCell(table.rows[o.row]!.cells[o.col]!, o.row, o.col);
        if (full.row1 < row1) (row1 = full.row1), (changed = true);
        if (full.row2 > row2) (row2 = full.row2), (changed = true);
        if (full.col1 < col1) (col1 = full.col1), (changed = true);
        if (full.col2 > col2) (col2 = full.col2), (changed = true);
      }
    }
  }
  return { row1, row2, col1, col2 };
}

/** The real cells (not placeholders) whose top-left square is inside a rectangle, in reading order. */
export function originsIn(table: TableBlock, rect: GridRect): { cell: TableCell; row: number; col: number }[] {
  const out: { cell: TableCell; row: number; col: number }[] = [];
  for (let r = rect.row1; r <= rect.row2; r++) {
    for (let c = rect.col1; c <= rect.col2; c++) {
      const cell = table.rows[r]!.cells[c]!;
      if (!cell.covered) out.push({ cell, row: r, col: c });
    }
  }
  return out;
}

const emptyParagraph = (): ParagraphBlock => ({ id: createId("b_"), type: "paragraph", runs: [] });

export function newCell(): TableCell {
  return { id: createId("c_"), blocks: [emptyParagraph()] };
}

function placeholder(): TableCell {
  return { id: createId("c_"), blocks: [], covered: true };
}

/** A copy of the cell with some properties changed; `undefined` removes one. */
function withCell(cell: TableCell, patch: Partial<Record<keyof TableCell, unknown>>): TableCell {
  const next: Record<string, unknown> = { ...cell, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next as unknown as TableCell;
}

const clone = (table: TableBlock): { rows: TableRow[] } => ({
  rows: table.rows.map((row) => ({ ...row, cells: row.cells.slice() })),
});

/** Inserts a row before index `at` (0 to the number of rows). Merged cells that cross that line grow to cover it. */
export function insertRowAt(table: TableBlock, at: number): TableBlock {
  const { rows } = clone(table);
  const origins = originMap(table);
  const cells: TableCell[] = [];
  for (let c = 0; c < table.columns.length; c++) {
    const crossing = at > 0 && at < table.rows.length ? origins[at]![c]! : null;
    if (crossing && crossing.row < at) {
      cells.push(placeholder());
      // The merged cell grows by one row, once, when we are at its first column.
      if (c === crossing.col) {
        const row = rows[crossing.row]!;
        row.cells[crossing.col] = withCell(row.cells[crossing.col]!, { rowSpan: rowSpanOf(row.cells[crossing.col]!) + 1 });
      }
    } else {
      cells.push(newCell());
    }
  }
  rows.splice(at, 0, { id: createId("r_"), cells });
  return { ...table, rows };
}

/**
 * Inserts a column before index `at`. Merged cells that cross that line grow to cover it. The new
 * column takes an equal share of the width, and the others shrink to make room.
 */
export function insertColumnAt(table: TableBlock, at: number): TableBlock {
  const { rows } = clone(table);
  const origins = originMap(table);
  table.rows.forEach((_, r) => {
    const crossing = at > 0 && at < table.columns.length ? origins[r]![at]! : null;
    const cells = rows[r]!.cells;
    if (crossing && crossing.col < at) {
      cells.splice(at, 0, placeholder());
      if (r === crossing.row) {
        cells[crossing.col] = withCell(cells[crossing.col]!, { colSpan: colSpanOf(cells[crossing.col]!) + 1 });
      }
    } else {
      cells.splice(at, 0, newCell());
    }
  });
  const share = 1 / (table.columns.length + 1);
  const columns = normalizeColumns([
    ...table.columns.slice(0, at).map((w) => w * (1 - share)),
    share,
    ...table.columns.slice(at).map((w) => w * (1 - share)),
  ]);
  return { ...table, rows, columns };
}

/**
 * Removes rows `from` to `to`. A merged cell that started in a removed row but reaches further
 * moves to the first row that is left, with the rows it still covers.
 */
export function deleteRowsAt(table: TableBlock, from: number, to: number): TableBlock {
  const { rows } = clone(table);
  table.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (cell.covered) return;
      const end = r + rowSpanOf(cell) - 1;
      if (r >= from && r <= to && end > to) {
        // The cell survives, one row below the deleted block, taking over a placeholder's square.
        const target = rows[to + 1]!.cells;
        const remaining = end - to;
        target[c] = withCell(cell, { rowSpan: remaining > 1 ? remaining : undefined, covered: undefined });
      } else if (r < from && end >= from) {
        const removed = Math.min(end, to) - from + 1;
        const span = rowSpanOf(cell) - removed;
        rows[r]!.cells[c] = withCell(cell, { rowSpan: span > 1 ? span : undefined });
      }
    });
  });
  return { ...table, rows: rows.filter((_, r) => r < from || r > to) };
}

/** Removes columns `from` to `to`. The remaining columns share the width. */
export function deleteColumnsAt(table: TableBlock, from: number, to: number): TableBlock {
  const { rows } = clone(table);
  table.rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (cell.covered) return;
      const end = c + colSpanOf(cell) - 1;
      if (c >= from && c <= to && end > to) {
        const remaining = end - to;
        rows[r]!.cells[to + 1] = withCell(cell, { colSpan: remaining > 1 ? remaining : undefined, covered: undefined });
      } else if (c < from && end >= from) {
        const removed = Math.min(end, to) - from + 1;
        const span = colSpanOf(cell) - removed;
        rows[r]!.cells[c] = withCell(cell, { colSpan: span > 1 ? span : undefined });
      }
    });
  });
  return {
    ...table,
    rows: rows.map((row) => ({ ...row, cells: row.cells.filter((_, c) => c < from || c > to) })),
    columns: normalizeColumns(table.columns.filter((_, c) => c < from || c > to)),
  };
}

const isEmptyCell = (cell: TableCell) =>
  cell.blocks.every((b) => ("runs" in b ? b.runs.length === 0 : false) && b.type !== "image" && b.type !== "divider");

/**
 * Merges every cell in a rectangle (already expanded to whole cells) into the one at its top-left.
 * The contents of the other cells are appended to it in reading order, skipping empty ones.
 */
export function mergeRect(table: TableBlock, rect: GridRect): TableBlock | null {
  if (rect.row1 === rect.row2 && rect.col1 === rect.col2) return null;
  const { rows } = clone(table);
  const members = originsIn(table, rect);
  const first = members[0]!;
  const content: CellBlock[] = [];
  for (const { cell } of members) {
    if (!isEmptyCell(cell)) content.push(...cell.blocks);
  }
  const blocks = content.length > 0 ? content : first.cell.blocks;
  rows[first.row]!.cells[first.col] = withCell(first.cell, {
    blocks,
    rowSpan: rect.row2 > rect.row1 ? rect.row2 - rect.row1 + 1 : undefined,
    colSpan: rect.col2 > rect.col1 ? rect.col2 - rect.col1 + 1 : undefined,
  });
  for (let r = rect.row1; r <= rect.row2; r++) {
    for (let c = rect.col1; c <= rect.col2; c++) {
      if (r === rect.row1 && c === rect.col1) continue;
      const cell = rows[r]!.cells[c]!;
      rows[r]!.cells[c] = { id: cell.id, blocks: [], covered: true };
    }
  }
  return { ...table, rows };
}

/** Splits a merged cell back into single cells. The content stays in the top-left one. */
export function splitAt(table: TableBlock, row: number, col: number): TableBlock | null {
  const cell = table.rows[row]?.cells[col];
  if (!cell || cell.covered || (rowSpanOf(cell) === 1 && colSpanOf(cell) === 1)) return null;
  const { rows } = clone(table);
  const rect = rectOfCell(cell, row, col);
  for (let r = rect.row1; r <= rect.row2; r++) {
    for (let c = rect.col1; c <= rect.col2; c++) {
      if (r === row && c === col) continue;
      rows[r]!.cells[c] = { id: rows[r]!.cells[c]!.id, blocks: [emptyParagraph()] };
    }
  }
  rows[row]!.cells[col] = withCell(cell, { rowSpan: undefined, colSpan: undefined });
  return { ...table, rows };
}

/**
 * Checks that a table's grid is consistent: one cell per column in every row, spans that stay inside
 * the table, and exactly one real cell for every square. Returns a problem, or null.
 */
export function checkGrid(table: TableBlock): string | null {
  const rows = table.rows.length;
  const cols = table.columns.length;
  const owner: (string | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  for (let r = 0; r < rows; r++) {
    const row = table.rows[r]!;
    if (row.cells.length !== cols) return `rows[${r}] has ${row.cells.length} cells, expected ${cols}`;
    for (let c = 0; c < cols; c++) {
      const cell = row.cells[c]!;
      if (cell.covered) {
        if (cell.blocks.length > 0) return `rows[${r}].cells[${c}] is covered but has content`;
        if (cell.rowSpan || cell.colSpan) return `rows[${r}].cells[${c}] is covered but has a span`;
        continue;
      }
      if (cell.blocks.length === 0) return `rows[${r}].cells[${c}] needs at least one block`;
      const rs = rowSpanOf(cell);
      const cs = colSpanOf(cell);
      if (r + rs > rows || c + cs > cols) return `rows[${r}].cells[${c}] spans outside the table`;
      for (let rr = r; rr < r + rs; rr++) {
        for (let cc = c; cc < c + cs; cc++) {
          if (owner[rr]![cc]) return `rows[${rr}].cells[${cc}] is covered twice`;
          owner[rr]![cc] = cell.id;
          // Squares under a span other than the cell's own must be placeholders.
          if ((rr !== r || cc !== c) && !table.rows[rr]!.cells[cc]!.covered) {
            return `rows[${rr}].cells[${cc}] is under a merged cell but not marked covered`;
          }
        }
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!owner[r]![c] && table.rows[r]!.cells[c]!.covered) return `rows[${r}].cells[${c}] is covered by nothing`;
    }
  }
  return null;
}
