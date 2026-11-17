import { describe, expect, it } from "vitest";
import { DocumentSession, createDoc, image, paragraph, validateDoc, type Block, type TableBlock } from "../src";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const types = (blocks: readonly Block[]) => blocks.map((b) => b.type);

describe("laying out a header with columns and a picture", () => {
  it("puts the columns in an empty header without a blank line above or below", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });
    expect(session.insertColumns(2)).toBe(true);
    expect(types(session.state.blocks)).toEqual(["table"]);
    validateDoc(session.state);
  });

  it("puts the columns under header text without a blank line after", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("Report")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 6 }, focus: { block: id, offset: 6 } });
    session.insertColumns(3);
    expect(types(session.state.blocks)).toEqual(["paragraph", "table"]);
  });

  it("puts a picture in an empty table cell in place of the blank line, and keeps it selected", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("")]));
    session.select({ anchor: { block: session.state.blocks[0]!.id, offset: 0 }, focus: { block: session.state.blocks[0]!.id, offset: 0 } });
    session.insertColumns(2);
    const table = session.state.blocks[0] as TableBlock;
    const first = table.rows[0]!.cells[0]!.blocks[0]!.id;
    session.select({ anchor: { block: first, offset: 0 }, focus: { block: first, offset: 0 } });
    expect(session.insertBlockAtCaret(image(PNG, { width: 40, height: 20 }))).toBe(true);
    const cell = (session.state.blocks[0] as TableBlock).rows[0]!.cells[0]!;
    expect(types(cell.blocks)).toEqual(["image"]);
    expect(session.selection?.focus.block).toBe(cell.blocks[0]!.id);
    validateDoc(session.state);
    session.undo();
    expect(types((session.state.blocks[0] as TableBlock).rows[0]!.cells[0]!.blocks)).toEqual(["paragraph"]);
  });

  it("still keeps a line under a picture in the body", () => {
    const body = new DocumentSession(createDoc("T", [paragraph("")]));
    body.select({ anchor: { block: body.state.blocks[0]!.id, offset: 0 }, focus: { block: body.state.blocks[0]!.id, offset: 0 } });
    body.insertBlockAtCaret(image(PNG, { width: 40, height: 20 }));
    expect(types(body.state.blocks)).toEqual(["image", "paragraph"]);
  });
});

describe("deleting a range that stops at the start of a table", () => {
  const build = () => {
    const session = new DocumentSession(createDoc("T", [paragraph("Report")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 6 }, focus: { block: id, offset: 6 } });
    session.insertColumns(2);
    const table = session.state.blocks[1] as TableBlock;
    return { session, id, table };
  };

  it("deletes the text above it and keeps the table, as cutting a triple-clicked line does", () => {
    const { session, id, table } = build();
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: table.id, offset: 0 } });
    expect(session.deleteSelection()).toBe(true);
    expect(types(session.state.blocks)).toEqual(["paragraph", "table"]);
    expect((session.state.blocks[0] as { runs: unknown[] }).runs).toEqual([]);
    validateDoc(session.state);
  });

  it("still removes a table that a range covers completely", () => {
    const { session, id } = build();
    session.insertBlock(paragraph("After"));
    const last = session.state.blocks[2]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: last, offset: 2 } });
    session.deleteSelection();
    expect(types(session.state.blocks)).toEqual(["paragraph"]);
  });
});

describe("the empty line above a table", () => {
  it("goes with Delete, which moves the caret into the table, and Backspace in the table leaves it alone", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });
    session.insertColumns(2);
    session.insertBlock(paragraph(""), null);
    expect(types(session.state.blocks)).toEqual(["paragraph", "table"]);
    const first = session.state.blocks[0]!.id;
    session.select({ anchor: { block: first, offset: 0 }, focus: { block: first, offset: 0 } });
    expect(session.deleteForward()).toBe(true);
    expect(types(session.state.blocks)).toEqual(["table"]);
    const cell = (session.state.blocks[0] as TableBlock).rows[0]!.cells[0]!.blocks[0]!.id;
    expect(session.selection?.focus.block).toBe(cell);
    expect(session.backspace()).toBe(false);
    validateDoc(session.state);
  });

  it("is not removed by Delete when text follows or the line has words", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("Report")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 6 }, focus: { block: id, offset: 6 } });
    session.insertColumns(2);
    session.select({ anchor: { block: id, offset: 6 }, focus: { block: id, offset: 6 } });
    expect(session.deleteForward()).toBe(false);
    expect(types(session.state.blocks)).toEqual(["paragraph", "table"]);
  });
});
