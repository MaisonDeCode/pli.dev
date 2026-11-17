import { beforeEach, describe, expect, it } from "vitest";
import { PliError, setIdGenerator } from "@pli.dev/core";
import {
  DocumentSession,
  bold,
  caret,
  cellRect,
  createDoc,
  createTable,
  divider,
  docReducer,
  documentStats,
  findAll,
  heading,
  image,
  listItem,
  locate,
  pageBreak,
  paragraph,
  parseDoc,
  plainText,
  replaceMatches,
  selectionState,
  selectionToPlainText,
  serializeDoc,
  table,
  validateDoc,
  type Block,
  type Doc,
  type Selection,
  type TableBlock,
} from "../src";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

/** The text of every cell of a table, row by row. */
function grid(doc: Doc, id: string): string[][] {
  const t = doc.blocks.find((b) => b.id === id) as TableBlock;
  return t.rows.map((row) => row.cells.map((cell) => cell.blocks.map((b) => ("runs" in b ? plainText(b.runs) : `<${b.type}>`)).join("|")));
}

/** The id of the first block of a cell. */
const cellBlock = (t: TableBlock, row: number, col: number, index = 0) => t.rows[row]!.cells[col]!.blocks[index]!;

const range = (a: string, ao: number, b: string, bo: number): Selection => ({
  anchor: { block: a, offset: ao },
  focus: { block: b, offset: bo },
});

function setup(blocks: Block[], selection: Selection) {
  const session = new DocumentSession(createDoc("T", blocks));
  session.select(selection);
  return session;
}

/** A document: a paragraph, a 2x3 table with text, then a paragraph. */
function sample() {
  const before = paragraph("before");
  const t = table(
    [
      ["a1", "b1", "c1"],
      ["a2", "b2", "c2"],
    ],
    { headerRow: true },
  );
  const after = paragraph("after");
  return { before, t, after, session: setup([before, t, after], caret(cellBlock(t, 0, 0).id, 0)) };
}

const structure = (doc: Doc) => doc.blocks.map((b) => (b.type === "table" ? `table ${b.rows.length}x${b.columns.length}` : "runs" in b ? `${b.type}:${plainText(b.runs)}` : b.type));

describe("table model", () => {
  it("builds tables with equal columns that add up to exactly 1, and validates them", () => {
    const t = createTable(3, 7);
    expect(t.rows).toHaveLength(3);
    expect(t.columns).toHaveLength(7);
    expect(t.columns.reduce((a, b) => a + b, 0)).toBe(1);
    expect(() => validateDoc(createDoc("T", [t]))).not.toThrow();
  });

  it("finds blocks inside cells by id", () => {
    const { t, session } = sample();
    const inner = cellBlock(t, 1, 2);
    const found = locate(session.state, inner.id)!;
    expect(found.cell).toMatchObject({ row: 1, col: 2 });
    expect(found.topIndex).toBe(1);
  });

  it("round-trips through JSON", () => {
    const { session } = sample();
    expect(parseDoc(serializeDoc(session.state))).toEqual(session.state);
  });
});

describe("operations inside cells", () => {
  it("edits text in a cell and undoes it", () => {
    const { t, session } = sample();
    const b = cellBlock(t, 0, 1);
    session.insertText(b.id, 2, "!");
    session.format(b.id, 0, 2, { bold: true });
    expect(grid(session.state, t.id)[0]).toEqual(["a1", "b1!", "c1"]);
    session.undo();
    session.undo();
    expect(grid(session.state, t.id)[0]).toEqual(["a1", "b1", "c1"]);
  });

  it("refuses to delete the last block of a cell, and keeps ids unique", () => {
    const { t, session } = sample();
    expect(() => session.deleteBlock(cellBlock(t, 0, 0).id)).toThrowError(/at least one block/);
    expect(() => session.insertBlock(paragraph("x"), "nowhere")).toThrowError(/No block/);
    const duplicate = { ...paragraph("dup"), id: cellBlock(t, 0, 0).id };
    expect(() => session.insertBlock(duplicate, null)).toThrowError(/already exists/);
  });

  it("inserts at the start of a cell with the cell option, and undoes the insert", () => {
    const { t, session } = sample();
    const cell = t.rows[0]!.cells[0]!;
    const extra = paragraph("first");
    session.transact([{ type: "insert_block", block: extra, after: null, cell: cell.id }]);
    expect(grid(session.state, t.id)[0]![0]).toBe("first|a1");
    session.undo();
    expect(grid(session.state, t.id)[0]![0]).toBe("a1");
    // Deleting and undoing puts the block back where it was, including at the start of a cell.
    session.transact([{ type: "insert_block", block: extra, after: null, cell: cell.id }]);
    session.transact([{ type: "delete_block", id: extra.id }]);
    session.undo();
    expect(grid(session.state, t.id)[0]![0]).toBe("first|a1");
  });

  it("reduces a replace_block of a whole table and inverts it", () => {
    const { t, session } = sample();
    const before = session.state;
    const smaller = { ...t, rows: t.rows.slice(0, 1) };
    const { state, inverse } = docReducer.apply(before, { type: "replace_block", id: t.id, block: smaller });
    expect((state.blocks[1] as TableBlock).rows).toHaveLength(1);
    expect(docReducer.apply(state, inverse).state).toEqual(before);
  });
});

describe("typing and editing in cells", () => {
  it("types, splits with Enter inside the cell, and stays in the cell", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 0, 0).id, 2));
    session.typeText("X");
    session.splitBlock();
    session.typeText("Y");
    expect(grid(session.state, t.id)[0]![0]).toBe("a1X|Y");
    expect(structure(session.state)).toEqual(["paragraph:before", "table 2x3", "paragraph:after"]);
  });

  it("does not join across the edge of a cell, or reach into a table from outside", () => {
    const { before, t, after, session } = sample();
    // Backspace at the very start of a cell does nothing.
    session.select(caret(cellBlock(t, 0, 1).id, 0));
    expect(session.backspace()).toBe(false);
    // Delete at the very end of a cell does nothing.
    session.select(caret(cellBlock(t, 0, 0).id, 2));
    expect(session.deleteForward()).toBe(false);
    // Backspace at the start of the paragraph after a table does nothing.
    session.select(caret(after.id, 0));
    expect(session.backspace()).toBe(false);
    // Delete at the end of the paragraph before a table does nothing.
    session.select(caret(before.id, 6));
    expect(session.deleteForward()).toBe(false);
    expect(grid(session.state, t.id)[0]).toEqual(["a1", "b1", "c1"]);
  });

  it("joins blocks within one cell", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 0, 0).id, 2));
    session.splitBlock();
    session.backspace();
    expect(grid(session.state, t.id)[0]![0]).toBe("a1");
  });

  it("supports lists and images in cells", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 1, 0).id, 0));
    session.toggleBlockType({ type: "list_item", list: "bullet" });
    expect((cellBlock(session.state.blocks[1] as TableBlock, 1, 0) as Block).type).toBe("list_item");
    session.select(caret(cellBlock(t, 1, 1).id, 2));
    session.insertBlockAtCaret(image("data:image/png;base64,AAAA", { width: 10, height: 10 }));
    expect(grid(session.state, t.id)[1]![1]).toBe("b2|<image>|");
  });

  it("does not allow tables or page breaks inside a cell", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 0, 0).id, 1));
    expect(session.insertTable(2, 2)).toBe(false);
    expect(session.insertBlockAtCaret(pageBreak())).toBe(false);
  });

  it("removes an image from a cell that has nothing else by emptying the cell", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 0, 0).id, 2));
    session.insertBlockAtCaret(image("data:image/png;base64,AAAA", { width: 10, height: 10 }));
    const img = (session.state.blocks[1] as TableBlock).rows[0]!.cells[0]!.blocks[1]!;
    session.select(caret(img.id, 0));
    session.backspace();
    // The image is gone; the paragraph that was added after it stays.
    expect(grid(session.state, t.id)[0]![0]).toBe("a1|");
  });
});

describe("tab navigation", () => {
  it("moves through cells and adds a row after the last one", () => {
    const { t, session } = sample();
    expect(session.moveToCell(1)).toBe(true);
    expect(session.selection!.focus.block).toBe(cellBlock(t, 0, 1).id);
    session.select(caret(cellBlock(t, 0, 2).id, 0));
    session.moveToCell(1);
    expect(session.selection!.focus.block).toBe(cellBlock(t, 1, 0).id);
    session.moveToCell(-1);
    expect(session.selection!.focus.block).toBe(cellBlock(t, 0, 2).id);

    session.select(caret(cellBlock(t, 1, 2).id, 0));
    session.moveToCell(1);
    const grown = session.state.blocks[1] as TableBlock;
    expect(grown.rows).toHaveLength(3);
    expect(session.selection!.focus.block).toBe(grown.rows[2]!.cells[0]!.blocks[0]!.id);
  });

  it("does nothing outside a table or before the first cell", () => {
    const { before, t, session } = sample();
    session.select(caret(before.id, 0));
    expect(session.moveToCell(1)).toBe(false);
    session.select(caret(cellBlock(t, 0, 0).id, 0));
    expect(session.moveToCell(-1)).toBe(false);
  });
});

describe("rows and columns", () => {
  it("adds rows and columns where asked, and undoes each as one step", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 0, 1).id, 1));
    session.addRow("below");
    expect(grid(session.state, t.id).map((r) => r[0])).toEqual(["a1", "", "a2"]);
    // The caret moved into the new row, so "above" adds another one before it.
    session.addRow("above");
    expect(grid(session.state, t.id).map((r) => r[0])).toEqual(["a1", "", "", "a2"]);

    session.select(caret(cellBlock(session.state.blocks[1] as TableBlock, 1, 1).id, 0));
    session.addColumn("right");
    const wide = session.state.blocks[1] as TableBlock;
    expect(wide.columns).toHaveLength(4);
    expect(wide.columns.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(grid(session.state, t.id)[1]).toEqual(["", "", "", ""]);
    session.addColumn("left");
    expect(grid(session.state, t.id)[0]).toEqual(["a1", "b1", "", "", "c1"]);

    session.undo();
    session.undo();
    session.undo();
    session.undo();
    expect(grid(session.state, t.id)).toEqual([["a1", "b1", "c1"], ["a2", "b2", "c2"]]);
    expect(session.canUndo).toBe(false);
  });

  it("puts the caret in the new row and column", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 0, 2).id, 0));
    session.addRow("below");
    const next = session.state.blocks[1] as TableBlock;
    expect(session.selection!.focus.block).toBe(cellBlock(next, 1, 2).id);
  });

  it("deletes the selected rows and columns, and the table when none are left", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 0, 1).id, 0));
    session.deleteColumn();
    expect(grid(session.state, t.id)).toEqual([["a1", "c1"], ["a2", "c2"]]);
    expect((session.state.blocks[1] as TableBlock).columns.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);

    session.deleteRow();
    expect(grid(session.state, t.id)).toEqual([["a2", "c2"]]);

    session.deleteRow();
    expect(structure(session.state)).toEqual(["paragraph:before", "paragraph:after"]);
    session.undo();
    expect(structure(session.state)).toEqual(["paragraph:before", "table 1x2", "paragraph:after"]);
  });

  it("deletes the whole table and lands the caret next to it", () => {
    const { before, t, session } = sample();
    session.select(caret(cellBlock(t, 1, 1).id, 1));
    session.deleteTable();
    expect(structure(session.state)).toEqual(["paragraph:before", "paragraph:after"]);
    expect(session.selection).toEqual(caret(before.id, 6));
  });

  it("deletes a dragged range of rows", () => {
    const t = table([["a"], ["b"], ["c"], ["d"]]);
    const session = setup([paragraph("p"), t], range(cellBlock(t, 1, 0).id, 0, cellBlock(t, 2, 0).id, 1));
    session.deleteRow();
    expect(grid(session.state, t.id)).toEqual([["a"], ["d"]]);
  });
});

describe("table properties", () => {
  it("toggles the header row and the borders", () => {
    const { t, session } = sample();
    expect((session.state.blocks[1] as TableBlock).headerRow).toBe(true);
    session.setHeaderRow(false);
    expect(session.state.blocks[1]).not.toHaveProperty("headerRow");
    expect(session.setHeaderRow(false)).toBe(false);
    session.setTableBorders("none");
    expect((session.state.blocks[1] as TableBlock).borders).toBe("none");
    session.setTableBorders("all");
    expect(session.state.blocks[1]).not.toHaveProperty("borders");
    expect(session.state.blocks[1]!.id).toBe(t.id);
  });

  it("shades the cell, a dragged rectangle, or the whole table", () => {
    const { t, session } = sample();
    session.setCellShade("#ffe58f");
    const shades = () => (session.state.blocks[1] as TableBlock).rows.map((r) => r.cells.map((c) => c.shade ?? "-"));
    expect(shades()).toEqual([["#ffe58f", "-", "-"], ["-", "-", "-"]]);

    session.select(range(cellBlock(t, 0, 1).id, 0, cellBlock(t, 1, 2).id, 0));
    session.setCellShade("#cfe");
    expect(shades()).toEqual([["#ffe58f", "#cfe", "#cfe"], ["-", "#cfe", "#cfe"]]);
    session.setCellShade(null);
    expect(shades()).toEqual([["#ffe58f", "-", "-"], ["-", "-", "-"]]);
  });

  it("sets column widths, scaled to add up to 1, and rejects the wrong count", () => {
    const { session } = sample();
    session.setColumnWidths([1, 2, 1]);
    expect((session.state.blocks[1] as TableBlock).columns).toEqual([0.25, 0.5, 0.25]);
    expect(session.setColumnWidths([1, 1])).toBe(false);
  });

  it("reports table state for toolbars", () => {
    const { t, session } = sample();
    session.select(caret(cellBlock(t, 1, 2).id, 0));
    expect(selectionState(session.state, session.selection).table).toMatchObject({ rows: 2, columns: 3, row: 1, column: 2, headerRow: true, selectedRows: 1, selectedColumns: 1 });
    session.select(range(cellBlock(t, 0, 0).id, 0, cellBlock(t, 1, 1).id, 0));
    expect(selectionState(session.state, session.selection).table).toMatchObject({ row: 0, column: 0, selectedRows: 2, selectedColumns: 2 });
    session.select(caret(session.state.blocks[0]!.id, 0));
    expect(selectionState(session.state, session.selection).table).toBeNull();
  });
});

describe("selecting across cells", () => {
  it("treats a drag between two cells as a rectangle", () => {
    const { t, session } = sample();
    const sel = range(cellBlock(t, 0, 2).id, 1, cellBlock(t, 1, 0).id, 1);
    expect(cellRect(session.state, sel)).toMatchObject({ row1: 0, row2: 1, col1: 0, col2: 2 });
    expect(cellRect(session.state, caret(cellBlock(t, 0, 0).id, 1))).toBeNull();
  });

  it("formats the text of every cell in the rectangle", () => {
    const { t, session } = sample();
    session.select(range(cellBlock(t, 0, 0).id, 1, cellBlock(t, 1, 1).id, 1));
    session.toggleMark("bold");
    const cells = (session.state.blocks[1] as TableBlock).rows.flatMap((r) => r.cells.map((c) => c.blocks[0]));
    const boldFlags = cells.map((b) => "runs" in b! && b.runs.every((r) => r.marks?.bold));
    expect(boldFlags).toEqual([true, true, false, true, true, false]);
  });

  it("clears the cells in the rectangle when deleted, and types into the first", () => {
    const { t, session } = sample();
    session.select(range(cellBlock(t, 0, 0).id, 0, cellBlock(t, 1, 1).id, 1));
    session.deleteSelection();
    expect(grid(session.state, t.id)).toEqual([["", "", "c1"], ["", "", "c2"]]);
    session.undo();
    expect(grid(session.state, t.id)).toEqual([["a1", "b1", "c1"], ["a2", "b2", "c2"]]);

    session.select(range(cellBlock(t, 0, 0).id, 0, cellBlock(t, 0, 1).id, 1));
    session.typeText("Z");
    expect(grid(session.state, t.id)[0]).toEqual(["Z", "", "c1"]);
  });

  it("copies a rectangle of cells as tab-separated text", () => {
    const { t, session } = sample();
    const sel = range(cellBlock(t, 0, 1).id, 0, cellBlock(t, 1, 2).id, 0);
    expect(selectionToPlainText(session.state, sel)).toBe("b1\tc1\nb2\tc2");
  });
});

describe("selections that cross a table's edge", () => {
  it("deleting from before a table into a cell trims both sides and keeps the table", () => {
    const { before, t, session } = sample();
    session.select(range(before.id, 3, cellBlock(t, 0, 1).id, 1));
    session.deleteSelection();
    expect(structure(session.state)).toEqual(["paragraph:bef", "table 2x3", "paragraph:after"]);
    expect(grid(session.state, t.id)).toEqual([["", "1", "c1"], ["a2", "b2", "c2"]]);
    // The cell contents between the two ends were cleared, the unselected ones kept.
    expect(session.selection).toEqual(caret(before.id, 3));
  });

  it("deleting from a cell to after a table trims both sides and keeps the table", () => {
    const { t, after, session } = sample();
    session.select(range(cellBlock(t, 1, 1).id, 1, after.id, 2));
    session.deleteSelection();
    expect(structure(session.state)).toEqual(["paragraph:before", "table 2x3", "paragraph:ter"]);
    expect(grid(session.state, t.id)).toEqual([["a1", "b1", "c1"], ["a2", "b", ""]]);
  });

  it("deletes a table that is wholly inside the range, and joins the text on either side", () => {
    const { before, after, session } = sample();
    session.select(range(before.id, 3, after.id, 2));
    session.deleteSelection();
    expect(structure(session.state)).toEqual(["paragraph:befter"]);
    session.undo();
    expect(structure(session.state)).toEqual(["paragraph:before", "table 2x3", "paragraph:after"]);
  });

  it("selecting everything and deleting leaves one empty paragraph", () => {
    const { session } = sample();
    session.selectAll();
    session.deleteSelection();
    expect(structure(session.state)).toEqual(["paragraph:"]);
  });

  it("keeps a cell non-empty when the range covers all of its blocks", () => {
    const t = table([["one", "two"]]);
    const session = setup([paragraph("x"), t, paragraph("y")], caret("none", 0));
    session.select(range("x".length ? session.state.blocks[0]!.id : "", 0, session.state.blocks[2]!.id, 1));
    session.deleteSelection();
    expect(structure(session.state)).toEqual(["paragraph:"]);
  });
});

describe("inserting tables", () => {
  it("inserts a table after the caret with the caret in its first cell", () => {
    const p = paragraph("hello");
    const session = setup([p], caret(p.id, 5));
    session.insertTable(3, 2, { headerRow: true });
    const t = session.state.blocks[1] as TableBlock;
    expect(structure(session.state)).toEqual(["paragraph:hello", "table 3x2", "paragraph:"]);
    expect(t.headerRow).toBe(true);
    expect(session.selection).toEqual(caret(cellBlock(t, 0, 0).id, 0));
    session.typeText("typed");
    expect(grid(session.state, t.id)[0]).toEqual(["typed", ""]);
    session.undo();
    session.undo();
    expect(structure(session.state)).toEqual(["paragraph:hello"]);
  });

  it("splits a paragraph to insert a table in the middle of it", () => {
    const p = paragraph("abcd");
    const session = setup([p], caret(p.id, 2));
    session.insertTable(1, 1);
    expect(structure(session.state)).toEqual(["paragraph:ab", "table 1x1", "paragraph:cd"]);
  });
});

describe("find, replace and stats see into cells", () => {
  it("finds and replaces text in cells, keeping formatting", () => {
    const t = table([[["a ", bold("cat")], "dog"], ["the cat", "bird"]]);
    const session = setup([paragraph("cat"), t], caret("0", 0));
    session.select(caret(session.state.blocks[0]!.id, 0));
    const matches = findAll(session.state, "cat");
    expect(matches).toHaveLength(3);
    session.exec(replaceMatches(matches, "fox"));
    expect(grid(session.state, t.id)).toEqual([["a fox", "dog"], ["the fox", "bird"]]);
    const first = (session.state.blocks[1] as TableBlock).rows[0]!.cells[0]!.blocks[0]!;
    expect(first).toMatchObject({ runs: [{ text: "a " }, { text: "fox", marks: { bold: true } }] });
    expect(documentStats(session.state).words).toBe(1 + 2 + 1 + 2 + 1);
  });
});

describe("validation", () => {
  const good = () => createTable(2, 2);
  const withTable = (t: unknown) => ({ id: "d", type: "document", title: "T", blocks: [t] });

  it.each([
    ["ragged rows", (t: TableBlock) => ({ ...t, rows: [t.rows[0], { ...t.rows[1], cells: [t.rows[1]!.cells[0]] }] }), /expected 2 cells/],
    ["widths that don't add up", (t: TableBlock) => ({ ...t, columns: [0.2, 0.2] }), /add up to 1/],
    ["no rows", (t: TableBlock) => ({ ...t, rows: [] }), /at least one row/],
    ["an empty cell", (t: TableBlock) => ({ ...t, rows: [{ ...t.rows[0], cells: [{ ...t.rows[0]!.cells[0], blocks: [] }, t.rows[0]!.cells[1]] }, t.rows[1]] }), /at least one block/],
    ["a table inside a cell", (t: TableBlock) => ({ ...t, rows: [{ ...t.rows[0], cells: [{ ...t.rows[0]!.cells[0], blocks: [createTable(1, 1)] as never }, t.rows[0]!.cells[1]] }, t.rows[1]] }), /can't go inside a table cell/],
    ["a page break inside a cell", (t: TableBlock) => ({ ...t, rows: [{ ...t.rows[0], cells: [{ ...t.rows[0]!.cells[0], blocks: [pageBreak()] as never }, t.rows[0]!.cells[1]] }, t.rows[1]] }), /can't go inside a table cell/],
    ["a duplicate id across cells", (t: TableBlock) => ({ ...t, rows: [t.rows[0], { ...t.rows[1], cells: [{ ...t.rows[1]!.cells[0], id: t.rows[0]!.cells[0]!.id }, t.rows[1]!.cells[1]] }] }), /duplicate id/],
    ["bad borders", (t: TableBlock) => ({ ...t, borders: "dotted" }), /borders/],
  ])("rejects %s", (_name, mutate, message) => {
    const t = mutate(good());
    expect(() => validateDoc(withTable(t))).toThrowError(message);
    try {
      validateDoc(withTable(t));
    } catch (e) {
      expect(e).toBeInstanceOf(PliError);
    }
  });

  it("accepts lists, images and dividers in cells", () => {
    const t = good();
    t.rows[0]!.cells[0]!.blocks = [listItem("bullet", "x"), image("data:image/png;base64,AAAA", { width: 1, height: 1 }), divider()];
    expect(() => validateDoc(withTable(t))).not.toThrow();
  });
});

describe("undo groups table edits with the selection", () => {
  it("restores the caret when a structural edit is undone", () => {
    const { t, session } = sample();
    const start = caret(cellBlock(t, 0, 1).id, 1);
    session.select(start);
    session.addColumn("right");
    expect(session.selection).not.toEqual(start);
    session.undo();
    expect(session.selection).toEqual(start);
    expect(heading(1, "x").type).toBe("heading");
  });
});
