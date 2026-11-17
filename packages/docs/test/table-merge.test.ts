import { beforeEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "@pli.dev/core";
import {
  DocumentSession,
  caret,
  createDoc,
  documentStats,
  findAll,
  paragraph,
  plainText,
  selectionState,
  selectionToPlainText,
  table,
  validateDoc,
  type Doc,
  type Selection,
  type TableBlock,
} from "../src";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

const range = (a: string, ao: number, b: string, bo: number): Selection => ({ anchor: { block: a, offset: ao }, focus: { block: b, offset: bo } });
const tbl = (s: DocumentSession) => s.state.blocks.find((b) => b.type === "table") as TableBlock;
/** The id of the first block of the real cell at a grid square. */
const at = (t: TableBlock, r: number, c: number) => t.rows[r]!.cells[c]!.blocks[0]!.id;

/** A paragraph, then a 3x3 table of "00".."22", then a paragraph. */
function setup() {
  const t = table(Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => `${r}${c}`)));
  const session = new DocumentSession(createDoc("T", [paragraph("before"), t, paragraph("after")]));
  session.select(caret(at(t, 0, 0), 0));
  return { session, t };
}

/** The table as text: merged cells show spans, covered squares show a dot. */
function show(t: TableBlock): string[] {
  return t.rows.map((row) =>
    row.cells
      .map((cell) => {
        if (cell.covered) return "·";
        const text = cell.blocks.map((b) => ("runs" in b ? plainText(b.runs) : b.type)).join("+");
        const span = (cell.rowSpan ? `r${cell.rowSpan}` : "") + (cell.colSpan ? `c${cell.colSpan}` : "");
        return span ? `${text}[${span}]` : text;
      })
      .join(" "),
  );
}

describe("merging cells", () => {
  it("merges a dragged rectangle, joins the contents, and puts the caret in the merged cell", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 1, at(t, 1, 1), 1));
    expect(selectionState(session.state, session.selection).table).toMatchObject({ canMerge: true, canSplit: false });
    expect(session.mergeCells()).toBe(true);
    const merged = tbl(session);
    expect(show(merged)).toEqual(["00+01+10+11[r2c2] · 02", "· · 12", "20 21 22"]);
    expect(session.selection).toEqual(caret(at(merged, 0, 0), 0));
    expect(selectionState(session.state, session.selection).table).toMatchObject({ canMerge: false, canSplit: true });
  });

  it("is one undo step, and does nothing for a single cell", () => {
    const { session, t } = setup();
    expect(session.mergeCells()).toBe(false);
    session.select(range(at(t, 0, 0), 0, at(t, 0, 2), 1));
    session.mergeCells();
    expect(show(tbl(session))[0]).toBe("00+01+02[c3] · ·");
    session.undo();
    expect(show(tbl(session))[0]).toBe("00 01 02");
    expect(session.mergeCells()).toBe(true); // the selection came back too
  });

  it("splits it again, keeping the text in the first square", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    session.mergeCells();
    expect(session.splitCells()).toBe(true);
    const split = show(tbl(session));
    expect(split[0]).toBe("00+01+10+11  02");
    // The squares that were hidden are real, empty cells again.
    expect(split[1]).toBe("  12");
    expect(session.splitCells()).toBe(false);
  });

  it("expands a drag that touches part of a merged cell to the whole cell", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    session.mergeCells();
    const m = tbl(session);
    // Dragging from the merged cell to the cell below it covers the merged cell's two rows and columns.
    session.select(range(at(m, 0, 0), 0, at(m, 2, 2), 0));
    session.mergeCells();
    expect(show(tbl(session))[0]).toMatch(/\[r3c3\]/);
    expect(validateDoc(session.state)).toBeTruthy();
  });
});

describe("working inside merged cells", () => {
  it("types into a merged cell, and Tab skips the hidden squares", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 0), 0));
    session.mergeCells(); // column 0, rows 0-1
    session.select(caret(at(tbl(session), 0, 0), 2));
    session.typeText("!");
    expect(show(tbl(session))[0]).toBe("00!+10[r2] 01 02");
    session.moveToCell(1);
    expect(session.selection!.focus.block).toBe(at(tbl(session), 0, 1));
    session.select(caret(at(tbl(session), 0, 2), 0));
    session.moveToCell(1);
    // After 02 comes row 1's first real cell, which is 11 because 10 is under the merged cell.
    expect(session.selection!.focus.block).toBe(at(tbl(session), 1, 1));
    session.moveToCell(-1);
    expect(session.selection!.focus.block).toBe(at(tbl(session), 0, 2));
  });

  it("Tab from the last real cell adds a row, and the caret goes to its first cell", () => {
    const { session, t } = setup();
    session.select(range(at(t, 2, 1), 0, at(t, 2, 2), 0));
    session.mergeCells();
    session.moveToCell(1);
    expect(tbl(session).rows).toHaveLength(4);
    expect(session.selection!.focus.block).toBe(at(tbl(session), 3, 0));
  });

  it("clears a merged cell when it is deleted as part of a drag, and leaves hidden squares alone", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 0, 1), 0));
    session.mergeCells();
    session.select(range(at(tbl(session), 0, 0), 0, at(tbl(session), 1, 0), 0));
    session.deleteSelection();
    // The drag from the merged cell to the cell under it is a 2x2 rectangle, because the merged cell
    // is two columns wide: both rows of both columns are cleared.
    const out = show(tbl(session));
    expect(out[0]).toBe("[c2] · 02");
    expect(out[1]).toBe("  12");
    expect(out[2]).toBe("20 21 22");
  });

  it("copies a rectangle through a merge as text: quoted multi-line cells, hidden squares empty", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    session.mergeCells();
    const m = tbl(session);
    expect(selectionToPlainText(session.state, range(at(m, 0, 0), 0, at(m, 2, 2), 0))).toBe('"00\n01\n10\n11"\t\t02\n\t\t12\n20\t21\t22');
  });

  it("find, replace and the word count only see real cells", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    session.mergeCells();
    // "00 01 10 11" is one merged cell with four paragraphs; the other five cells and two outer paragraphs make 11 words.
    expect(documentStats(session.state).words).toBe(4 + 5 + 2);
    expect(findAll(session.state, "11")).toHaveLength(1);
    // "0" appears twice in "00" and once each in 01, 10, 02 and 20: hidden squares add nothing.
    expect(findAll(session.state, "0")).toHaveLength(6);

  });
});

describe("rows and columns through merged cells", () => {
  it("adds a row inside a vertical merge and the merge grows", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 0), 0));
    session.mergeCells();
    session.select(caret(at(tbl(session), 2, 1), 0));
    session.addRow("above");
    expect(tbl(session).rows).toHaveLength(4);
    expect(show(tbl(session))[0]).toBe("00+10[r2] 01 02");
    // Inserted at row 2: the merge covers rows 0-1 only, so it does not grow.
    session.select(caret(at(tbl(session), 1, 1), 0));
    session.addRow("above");
    expect(show(tbl(session))[0]).toContain("[r3]");
  });

  it("adds below a merged cell's last row, and the caret lands in a real cell", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 0), 0));
    session.mergeCells();
    session.select(caret(at(tbl(session), 0, 0), 0));
    session.addRow("below");
    const rows = show(tbl(session));
    // The new row goes below the merged cell's last row (row 1), so it is row 2: three empty cells.
    expect(rows[2]).toBe("  ");
    expect(rows[3]).toBe("20 21 22");
    expect(tbl(session).rows[2]!.cells.some((c) => c.covered)).toBe(false);
    expect(session.selection!.focus.block).toBe(at(tbl(session), 2, 0));
  });

  it("deleting a row shrinks a merge, and deleting its first row moves the cell down", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 2, 0), 0));
    session.mergeCells(); // column 0, all three rows
    session.select(caret(at(tbl(session), 1, 1), 0));
    session.deleteRow();
    expect(show(tbl(session))).toEqual(["00+10+20[r2] 01 02", "· 21 22"]);
    session.select(caret(at(tbl(session), 0, 1), 0));
    session.deleteRow();
    expect(show(tbl(session))).toEqual(["00+10+20 21 22"]);
    session.undo();
    session.undo();
    expect(show(tbl(session))[0]).toBe("00+10+20[r3] 01 02");
  });

  it("deleting a column through a horizontal merge shrinks it", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 0, 2), 0));
    session.mergeCells();
    session.select(caret(at(tbl(session), 1, 1), 0));
    session.deleteColumn();
    expect(show(tbl(session))).toEqual(["00+01+02[c2] ·", "10 12", "20 22"]);
    expect(tbl(session).columns.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("deleting every row or column a selection covers removes the table", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 2, 0), 0));
    session.deleteColumn();
    expect(tbl(session).columns).toHaveLength(2);
    session.select(range(at(tbl(session), 0, 0), 0, at(tbl(session), 0, 1), 0));
    session.deleteRow();
    expect(tbl(session).rows).toHaveLength(2);
  });
});

describe("cell properties", () => {
  it("shades a merged cell once, through its first square", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    session.mergeCells();
    session.select(caret(at(tbl(session), 0, 0), 0));
    session.setCellShade("#cfe");
    const m = tbl(session);
    expect(m.rows[0]!.cells[0]!.shade).toBe("#cfe");
    expect(m.rows.flatMap((r) => r.cells).filter((c) => c.covered && c.shade)).toHaveLength(0);
  });

  it("sets vertical alignment and row height, and reads them back", () => {
    const { session, t } = setup();
    session.select(caret(at(t, 1, 1), 0));
    session.setCellVerticalAlign("middle");
    session.setRowHeight(48);
    expect(tbl(session).rows[1]!.cells[1]).toMatchObject({ vAlign: "middle" });
    expect(tbl(session).rows[1]!.height).toBe(48);
    expect(selectionState(session.state, session.selection).table).toMatchObject({ vAlign: "middle", rowHeight: 48 });

    session.setCellVerticalAlign("top");
    expect(tbl(session).rows[1]!.cells[1]).not.toHaveProperty("vAlign");
    session.setRowHeight(null);
    expect(tbl(session).rows[1]).not.toHaveProperty("height");
    expect(session.setRowHeight(1)).toBe(true);
    expect(tbl(session).rows[1]!.height).toBe(6); // clamped to a usable minimum
  });

  it("applies row height to every row a drag covers", () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 2), 0));
    session.setRowHeight(30);
    expect(tbl(session).rows.map((r) => r.height)).toEqual([30, 30, undefined]);
  });
});

describe("validation of merged tables", () => {
  const good = () => {
    const { session, t } = setup();
    session.select(range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    session.mergeCells();
    return JSON.parse(JSON.stringify(session.state)) as Doc;
  };
  const check = (mutate: (t: TableBlock) => void, message: RegExp) => {
    const doc = good();
    mutate(doc.blocks[1] as TableBlock);
    expect(() => validateDoc(doc)).toThrowError(message);
  };

  it("accepts a merged table, and one that went through JSON", () => {
    expect(() => validateDoc(good())).not.toThrow();
  });

  it("rejects bad spans, covered cells that hold content, and unmarked squares", () => {
    check((t) => { t.rows[0]!.cells[0]!.rowSpan = 9; }, /spans outside the table/);
    check((t) => { t.rows[0]!.cells[0]!.colSpan = 1; }, /expected a whole number of 2 or more/);
    check((t) => { t.rows[0]!.cells[1]!.blocks = [paragraph("x")]; }, /covered but has content/);
    check((t) => { delete t.rows[0]!.cells[1]!.covered; t.rows[0]!.cells[1]!.blocks = [paragraph("x")]; }, /not marked covered/);
    check((t) => { t.rows[2]!.cells[2]!.covered = true; t.rows[2]!.cells[2]!.blocks = []; }, /covered by nothing/);
    check((t) => { t.rows[0]!.cells[2]!.colSpan = 2; }, /spans outside|covered twice/);
    check((t) => { t.rows[2]!.cells[0]!.blocks = []; }, /at least one block/);
  });

  it("rejects bad row heights and vertical alignment", () => {
    check((t) => { t.rows[0]!.height = 0; }, /height/);
    check((t) => { (t.rows[0]!.cells[2] as { vAlign: string }).vAlign = "center"; }, /vAlign/);
  });
});
