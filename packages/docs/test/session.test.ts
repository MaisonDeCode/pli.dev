import { beforeEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "@pli.dev/core";
import { DocumentSession, createDoc, heading, paragraph, plainText, type DocOp } from "../src";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

function textOf(session: DocumentSession, index: number): string {
  const block = session.state.blocks[index]!;
  return "runs" in block ? plainText(block.runs) : "";
}

describe("DocumentSession", () => {
  it("inserts, formats and deletes text", () => {
    const p = paragraph("Hello world");
    const session = new DocumentSession(createDoc("T", [p]));

    session.insertText(p.id, 5, ",");
    expect(textOf(session, 0)).toBe("Hello, world");

    session.format(p.id, 0, 5, { bold: true });
    const block = session.state.blocks[0]!;
    expect("runs" in block && block.runs[0]).toEqual({ text: "Hello", marks: { bold: true } });

    session.deleteText(p.id, 5, 6);
    expect(textOf(session, 0)).toBe("Hello world");
  });

  it("undoes and redoes a full editing sequence back to the original", () => {
    const p = paragraph("abc");
    const original = createDoc("T", [p]);
    const session = new DocumentSession(original);

    session.insertText(p.id, 3, "def");
    session.format(p.id, 1, 4, { italic: true });
    session.insertBlock(heading(1, "Title"));
    session.deleteBlock(p.id);
    const final = session.state;

    while (session.canUndo) session.undo();
    expect(session.state).toEqual(original);

    while (session.canRedo) session.redo();
    expect(session.state).toEqual(final);
  });

  it("clears the redo stack after a new edit", () => {
    const p = paragraph("a");
    const session = new DocumentSession(createDoc("T", [p]));
    session.insertText(p.id, 1, "b");
    session.undo();
    expect(session.canRedo).toBe(true);
    session.insertText(p.id, 1, "c");
    expect(session.canRedo).toBe(false);
  });

  it("rolls back a failed transaction without touching state or history", () => {
    const p = paragraph("abc");
    const session = new DocumentSession(createDoc("T", [p]));
    const before = session.state;

    const ops: DocOp[] = [
      { type: "insert_text", block: p.id, offset: 0, runs: [{ text: "x" }] },
      { type: "delete_text", block: p.id, from: 50, to: 60 },
    ];
    expect(() => session.transact(ops)).toThrowError(/outside text/);
    expect(session.state).toBe(before);
    expect(session.canUndo).toBe(false);
  });

  it("notifies subscribers with the origin of each change", () => {
    const p = paragraph("a");
    const session = new DocumentSession(createDoc("T", [p]));
    const origins: string[] = [];
    const stop = session.subscribe((e) => origins.push(e.origin));

    session.insertText(p.id, 1, "b");
    session.undo();
    session.redo();
    stop();
    session.undo();

    expect(origins).toEqual(["local", "undo", "redo"]);
  });

  it("rejects text ops on blocks without text", () => {
    const session = new DocumentSession(createDoc("T"));
    session.transact([{ type: "insert_block", block: { id: "d", type: "divider" }, after: null }]);
    expect(() => session.insertText("d", 0, "x")).toThrowError(/has no text/);
  });

  it("rejects unknown block ids", () => {
    const session = new DocumentSession(createDoc("T"));
    expect(() => session.deleteBlock("missing")).toThrowError(/No block/);
  });

  it("never mutates a previous state", () => {
    const p = paragraph("abc");
    const session = new DocumentSession(createDoc("T", [p]));
    const before = session.state;
    const snapshot = JSON.stringify(before);
    session.insertText(p.id, 0, "x");
    session.format(p.id, 0, 2, { bold: true });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
