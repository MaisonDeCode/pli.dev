import { beforeEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "@pli.dev/core";
import { plainText, table, type TableBlock } from "../src";
import {
  cellAt,
  checkGrid,
  deleteColumnsAt,
  deleteRowsAt,
  expandRect,
  insertColumnAt,
  insertRowAt,
  mergeRect,
  originMap,
  originsIn,
  rowSpanOf,
  splitAt,
} from "../src/grid";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

/** An r by c table whose cells say where they started: "00", "01", … */
function make(rows: number, cols: number): TableBlock {
  return table(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${r}${c}`)));
}

/** The grid as text: a cell shows its content and span, a covered square shows "·". */
function show(t: TableBlock): string[] {
  return t.rows.map((row) =>
    row.cells
      .map((cell) => {
        if (cell.covered) return "·";
        const text = cell.blocks.map((b) => ("runs" in b ? plainText(b.runs) : b.type)).join("+") || "∅";
        const span = (cell.rowSpan ? `r${cell.rowSpan}` : "") + (cell.colSpan ? `c${cell.colSpan}` : "");
        return span ? `${text}[${span}]` : text;
      })
      .join(" "),
  );
}

const merge = (t: TableBlock, row1: number, col1: number, row2: number, col2: number) =>
  mergeRect(t, expandRect(t, { row1, row2, col1, col2 }))!;

describe("merging and splitting", () => {
  it("merges a rectangle into its top-left cell and appends the other contents", () => {
    const t = merge(make(3, 3), 0, 0, 1, 1);
    expect(show(t)).toEqual(["00+01+10+11[r2c2] · 02", "· · 12", "20 21 22"]);
    expect(checkGrid(t)).toBeNull();
  });

  it("skips empty cells when joining content, and keeps one block if all are empty", () => {
    const base = make(1, 3);
    base.rows[0]!.cells[1]!.blocks = [{ id: "e", type: "paragraph", runs: [] }];
    expect(show(merge(base, 0, 0, 0, 2))).toEqual(["00+02[c3] · ·"]);
    const blank = table([["", ""]]);
    expect(show(merge(blank, 0, 0, 0, 1))).toEqual(["∅[c2] ·"]);
  });

  it("does nothing for a single cell", () => {
    expect(mergeRect(make(2, 2), { row1: 0, row2: 0, col1: 0, col2: 0 })).toBeNull();
  });

  it("splits a merged cell, leaving the content in its first square", () => {
    const merged = merge(make(2, 3), 0, 0, 1, 1);
    const split = splitAt(merged, 0, 0)!;
    expect(show(split)).toEqual(["00+01+10+11 ∅ 02", "∅ ∅ 12"]);
    expect(checkGrid(split)).toBeNull();
    expect(splitAt(split, 0, 0)).toBeNull();
    expect(splitAt(merged, 0, 1)).toBeNull();
  });

  it("expands a rectangle to take in whole merged cells, however they overlap", () => {
    const t = merge(merge(make(4, 4), 0, 1, 1, 2), 2, 0, 3, 0);
    // A rectangle that only touches the corner of the first merge grows to include all of it.
    expect(expandRect(t, { row1: 1, row2: 2, col1: 2, col2: 3 })).toEqual({ row1: 0, row2: 2, col1: 1, col2: 3 });
    // And growth can chain: the new area touches another merged cell.
    expect(expandRect(t, { row1: 1, row2: 2, col1: 0, col2: 1 })).toEqual({ row1: 0, row2: 3, col1: 0, col2: 2 });
    expect(expandRect(t, { row1: 0, row2: 0, col1: 0, col2: 0 })).toEqual({ row1: 0, row2: 0, col1: 0, col2: 0 });
  });

  it("merging across an existing merge swallows it", () => {
    const t = merge(merge(make(3, 3), 0, 0, 0, 1), 0, 1, 1, 1);
    // Selecting (0,1)-(1,1) expands over the horizontal merge at row 0, so the result covers (0,0)-(1,1).
    expect(show(t)[0]).toMatch(/\[r2c2\]/);
    expect(checkGrid(t)).toBeNull();
  });

  it("maps every square to the cell that owns it", () => {
    const t = merge(make(3, 3), 1, 1, 2, 2);
    const o = originMap(t);
    expect(o[2]![2]).toEqual({ row: 1, col: 1 });
    expect(o[0]![0]).toEqual({ row: 0, col: 0 });
    expect(cellAt(t, 2, 1).row).toBe(1);
    expect(rowSpanOf(cellAt(t, 2, 1).cell)).toBe(2);
    expect(originsIn(t, { row1: 1, row2: 2, col1: 1, col2: 2 })).toHaveLength(1);
  });
});

describe("inserting rows and columns", () => {
  it("grows a vertical merge when a row is inserted inside it, and not at its edges", () => {
    const t = merge(make(3, 2), 0, 0, 1, 0);
    const inside = insertRowAt(t, 1);
    expect(show(inside)).toEqual(["00+10[r3] 01", "· ∅", "· 11", "20 21"]);
    expect(checkGrid(inside)).toBeNull();
    expect(show(insertRowAt(t, 0))[0]).toBe("∅ ∅");
    expect(show(insertRowAt(t, 2))[2]).toBe("∅ ∅");
    expect(show(insertRowAt(t, 3))[3]).toBe("∅ ∅");
  });

  it("grows a horizontal merge when a column is inserted inside it", () => {
    const t = merge(make(2, 3), 0, 0, 0, 1);
    const inside = insertColumnAt(t, 1);
    expect(show(inside)).toEqual(["00+01[c3] · · 02", "10 ∅ 11 12"]);
    expect(checkGrid(inside)).toBeNull();
    expect(show(insertColumnAt(t, 2))[0]).toBe("00+01[c2] · ∅ 02");
  });

  it("handles a block merge crossing the line in both directions", () => {
    const t = merge(make(3, 3), 0, 0, 1, 1);
    expect(checkGrid(insertRowAt(t, 1))).toBeNull();
    expect(checkGrid(insertColumnAt(t, 1))).toBeNull();
    expect(show(insertRowAt(t, 1))[0]).toContain("[r3c2]");
    expect(show(insertColumnAt(t, 1))[0]).toContain("[r2c3]");
  });
});

describe("deleting rows and columns", () => {
  it("shrinks a merge when a row it covers is deleted", () => {
    const t = merge(make(3, 2), 0, 0, 2, 0);
    const out = deleteRowsAt(t, 1, 1);
    expect(show(out)).toEqual(["00+10+20[r2] 01", "· 21"]);
    expect(checkGrid(out)).toBeNull();
  });

  it("moves a merged cell down when the row it started in is deleted", () => {
    const t = merge(make(3, 2), 0, 0, 1, 0);
    const out = deleteRowsAt(t, 0, 0);
    // Row 0 goes, so the merged cell now starts at the old row 1 and covers just that one row.
    expect(show(out)).toEqual(["00+10 11", "20 21"]);
    expect(checkGrid(out)).toBeNull();
    const taller = deleteRowsAt(merge(make(4, 2), 0, 0, 2, 0), 0, 0);
    expect(show(taller)).toEqual(["00+10+20[r2] 11", "· 21", "30 31"]);
  });

  it("removes a merge completely when every row it covers is deleted", () => {
    const t = merge(make(4, 2), 1, 0, 2, 0);
    expect(show(deleteRowsAt(t, 1, 2))).toEqual(["00 01", "30 31"]);
  });

  it("does the same for columns, and removes their widths", () => {
    const t = merge(make(2, 4), 0, 0, 0, 2);
    const out = deleteColumnsAt(t, 0, 0);
    expect(show(out)).toEqual(["00+01+02[c2] · 03", "11 12 13"]);
    expect(out.columns).toHaveLength(3);
    expect(checkGrid(out)).toBeNull();
    expect(show(deleteColumnsAt(t, 1, 1))).toEqual(["00+01+02[c2] · 03", "10 12 13"]);
    expect(show(deleteColumnsAt(merge(make(2, 4), 0, 1, 0, 2), 1, 2))).toEqual(["00 03", "10 13"]);
  });
});

describe("random sequences of structural edits", () => {
  /** A small deterministic generator so a failure can be reproduced from its seed. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it.each(Array.from({ length: 25 }, (_, i) => i + 1))("keeps the grid consistent (seed %i)", (seed) => {
    const random = rng(seed);
    const int = (n: number) => Math.floor(random() * n);
    let t = make(4, 4);
    let steps = 0;
    for (let i = 0; i < 300; i++) {
      const rows = t.rows.length;
      const cols = t.columns.length;
      const r1 = int(rows), r2 = r1 + int(rows - r1), c1 = int(cols), c2 = c1 + int(cols - c1);
      let next: TableBlock | null = null;
      switch (int(7)) {
        case 0: next = mergeRect(t, expandRect(t, { row1: r1, row2: r2, col1: c1, col2: c2 })); break;
        case 1: next = splitAt(t, r1, c1); break;
        case 2: next = insertRowAt(t, int(rows + 1)); break;
        case 3: next = insertColumnAt(t, int(cols + 1)); break;
        case 4: next = rows > 1 ? deleteRowsAt(t, r1, Math.min(r2, rows - 2 < r1 ? r1 : r2)) : null; if (next && next.rows.length === 0) next = null; break;
        case 5: next = cols > 1 ? deleteColumnsAt(t, c1, c2) : null; if (next && next.columns.length === 0) next = null; break;
        default: break;
      }
      if (!next || next.rows.length === 0 || next.columns.length === 0) continue;
      steps++;
      t = next;
      expect(checkGrid(t), `step ${i}`).toBeNull();
      // Every square has an owner, and every owner is a real cell.
      const owners = originMap(t);
      for (const line of owners) for (const o of line) expect(t.rows[o.row]!.cells[o.col]!.covered).toBeUndefined();
    }
    expect(steps).toBeGreaterThan(100);
  });
});
