import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, paragraphsFromText, plainText, tableCellOrigin, type TableElement } from "../src";

function setup(rows = 3, cols = 3) {
  const s = new DeckSession(createDeck());
  const slide = s.deck.slides[0]!.id;
  const t = s.addTable(slide, rows, cols);
  const get = () => s.element(slide, t.id) as TableElement;
  return { s, slide, id: t.id, get };
}

describe("table operations", () => {
  it("inserts and deletes rows and columns, keeping the table size in step", () => {
    const { s, slide, id, get } = setup();
    s.setCellParagraphs(slide, id, 1, 1, paragraphsFromText("mid"));
    s.insertTableRows(slide, id, 1);
    expect(get().rows.length).toBe(4);
    expect(get().h).toBe(get().rows.reduce((n, r) => n + r.h, 0));
    expect(plainText(get().rows[2]!.cells[1]!.paragraphs)).toBe("mid");
    s.deleteTableRows(slide, id, 1);
    expect(plainText(get().rows[1]!.cells[1]!.paragraphs)).toBe("mid");
    s.insertTableColumns(slide, id, 3);
    expect(get().columns.length).toBe(4);
    expect(get().rows.every((r) => r.cells.length === 4)).toBe(true);
    s.deleteTableColumns(slide, id, 0, 2);
    expect(get().columns.length).toBe(2);
    expect(plainText(get().rows[1]!.cells[0]!.paragraphs)).toBe("");
    s.undo();
    expect(get().columns.length).toBe(4);
  });

  it("never deletes the last row or column", () => {
    const { s, slide, id, get } = setup(1, 1);
    s.deleteTableRows(slide, id, 0);
    s.deleteTableColumns(slide, id, 0);
    expect(get().rows.length).toBe(1);
    expect(get().columns.length).toBe(1);
  });

  it("merges a block (taking in whole merged cells), joins its text, and unmerges", () => {
    const { s, slide, id, get } = setup();
    s.setCellParagraphs(slide, id, 0, 0, paragraphsFromText("a"));
    s.setCellParagraphs(slide, id, 0, 1, paragraphsFromText("b"));
    s.mergeCells(slide, id, { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(get().rows[0]!.cells[0]!.colSpan).toBe(2);
    expect(get().rows[0]!.cells[1]!.covered).toBe(true);
    expect(plainText(get().rows[0]!.cells[0]!.paragraphs)).toBe("a\nb");
    // a block that touches the merged cell grows to include it
    s.mergeCells(slide, id, { r1: 0, c1: 1, r2: 1, c2: 1 });
    expect(get().rows[0]!.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(tableCellOrigin(get(), 1, 1)).toEqual({ r: 0, c: 0 });
    s.unmergeCells(slide, id, 1, 1);
    expect(get().rows[0]!.cells[0]!.colSpan).toBeUndefined();
    expect(get().rows[1]!.cells[1]!.covered).toBeUndefined();
  });

  it("keeps merged cells consistent when rows and columns are inserted and deleted through them", () => {
    const { s, slide, id, get } = setup(3, 3);
    s.mergeCells(slide, id, { r1: 0, c1: 0, r2: 1, c2: 1 });
    s.insertTableRows(slide, id, 1);
    expect(get().rows[0]!.cells[0]!.rowSpan).toBe(3);
    s.deleteTableRows(slide, id, 1);
    expect(get().rows[0]!.cells[0]!.rowSpan).toBe(2);
    s.insertTableColumns(slide, id, 1);
    expect(get().rows[0]!.cells[0]!.colSpan).toBe(3);
    s.deleteTableColumns(slide, id, 1);
    expect(get().rows[0]!.cells[0]!.colSpan).toBe(2);
    s.deleteTableRows(slide, id, 0);
    // the merged cell moved down a row, shorter
    expect(get().rows[0]!.cells[0]!.colSpan).toBe(2);
    expect(get().rows[0]!.cells[0]!.rowSpan).toBeUndefined();
  });

  it("sets cell fill and alignment, table options and sizes", () => {
    const { s, slide, id, get } = setup();
    s.setTableCells(slide, id, [[0, 0], [1, 1]], { fill: "#ff0000", vAlign: "middle" });
    expect(get().rows[1]!.cells[1]).toMatchObject({ fill: "#ff0000", vAlign: "middle" });
    s.setTableCells(slide, id, [[1, 1]], { fill: undefined });
    expect(get().rows[1]!.cells[1]!.fill).toBeUndefined();
    s.setTableOptions(slide, id, { banded: true, headerRow: false });
    expect(get()).toMatchObject({ banded: true, headerRow: false });
    s.setTableSizes(slide, id, { columns: [100, 50, 50], rows: [20, 20, 40] });
    expect(get()).toMatchObject({ w: 200, h: 80 });
  });

  it("sets notes with or without folding into the last undo step", () => {
    const s = new DeckSession(createDeck());
    const id = s.deck.slides[0]!.id;
    s.setNotes(id, "a", { merge: false });
    s.setNotes(id, "ab");
    s.undo();
    expect(s.slide(id).notes).toBe("");
  });
});
