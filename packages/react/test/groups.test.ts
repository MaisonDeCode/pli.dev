import { describe, expect, it } from "vitest";
import { table, type TableBlock } from "@pli.dev/docs";
import { rowGroups } from "../src/layout/groups";

/** Marks squares as covered and sets the span, like the engine's merge does. */
function span(t: TableBlock, row: number, col: number, rows: number, cols: number): TableBlock {
  const cells = t.rows.map((r) => r.cells.slice());
  cells[row]![col] = { ...cells[row]![col]!, ...(rows > 1 && { rowSpan: rows }), ...(cols > 1 && { colSpan: cols }) };
  for (let r = row; r < row + rows; r++) {
    for (let c = col; c < col + cols; c++) {
      if (r !== row || c !== col) cells[r]![c] = { id: cells[r]![c]!.id, blocks: [], covered: true };
    }
  }
  return { ...t, rows: t.rows.map((r, i) => ({ ...r, cells: cells[i]! })) };
}

const grid = (rows: number, cols: number) => table(Array.from({ length: rows }, () => Array.from({ length: cols }, () => "x")));

describe("rowGroups", () => {
  it("makes every row its own group when nothing spans rows", () => {
    expect(rowGroups(grid(4, 2))).toEqual([{ first: 0, last: 0 }, { first: 1, last: 1 }, { first: 2, last: 2 }, { first: 3, last: 3 }]);
  });

  it("keeps the rows of a vertical merge together", () => {
    expect(rowGroups(span(grid(5, 3), 1, 0, 3, 1))).toEqual([{ first: 0, last: 0 }, { first: 1, last: 3 }, { first: 4, last: 4 }]);
  });

  it("chains overlapping merges into one group", () => {
    let t = span(grid(6, 3), 0, 0, 2, 1); // rows 0-1
    t = span(t, 1, 1, 2, 1); // rows 1-2, which overlaps the first
    expect(rowGroups(t)).toEqual([{ first: 0, last: 2 }, { first: 3, last: 3 }, { first: 4, last: 4 }, { first: 5, last: 5 }]);
  });

  it("ignores horizontal merges", () => {
    expect(rowGroups(span(grid(3, 4), 1, 0, 1, 3))).toHaveLength(3);
  });

  it("puts a merge that reaches the last row in the final group", () => {
    expect(rowGroups(span(grid(3, 2), 1, 1, 2, 1))).toEqual([{ first: 0, last: 0 }, { first: 1, last: 2 }]);
  });
});
