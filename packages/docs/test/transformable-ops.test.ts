import { describe, expect, it } from "vitest";
import {
  DocumentSession,
  PliError,
  canonicalOps,
  caret,
  createDoc,
  diffBlock,
  docReducer,
  heading,
  paragraph,
  plainText,
  restoreMarks,
  marksSegments,
  type Block,
  type Doc,
  type DocOp,
  type Run,
} from "../src";

const runsOf = (doc: Doc, i = 0) => (doc.blocks[i] as unknown as { runs: Run[] }).runs;
const apply = (doc: Doc, ...ops: DocOp[]) => ops.reduce((d, op) => docReducer.apply(d, op).state, doc);

/** Everything a session applied, with the operations that undo and redo ran, so none of them can be a snapshot. */
function recorder(session: DocumentSession) {
  const seen: DocOp[] = [];
  session.subscribe((event) => seen.push(...event.ops));
  return seen;
}

const SNAPSHOT = new Set(["replace_block", "set_runs"]);

describe("restore_marks", () => {
  const doc = createDoc("T", [paragraph("Hello big world")]);
  const id = doc.blocks[0]!.id;

  it("sets the marks over a range and leaves the text", () => {
    const bold = apply(doc, { type: "format_text", block: id, from: 6, to: 9, patch: { bold: true } });
    const back = apply(bold, { type: "restore_marks", block: id, from: 0, to: 15, segments: [{ length: 15 }] });
    expect(runsOf(back)).toEqual([{ text: "Hello big world" }]);
    expect(plainText(runsOf(back))).toBe("Hello big world");
  });

  it("is the inverse of format_text, and inverts itself", () => {
    const op: DocOp = { type: "format_text", block: id, from: 6, to: 9, patch: { bold: true, color: "#f00" } };
    const { state, inverse } = docReducer.apply(doc, op);
    expect(inverse.type).toBe("restore_marks");
    const undone = docReducer.apply(state, inverse);
    expect(runsOf(undone.state)).toEqual(runsOf(doc));
    expect(docReducer.apply(undone.state, undone.inverse).state).toEqual(state);
  });

  it("records the marks of the range only, so undo leaves text outside it alone", () => {
    const { state, inverse } = docReducer.apply(doc, { type: "format_text", block: id, from: 6, to: 9, patch: { italic: true } });
    // Someone types at the very end, and someone at the start (the range moves, as a transform would move it).
    const typed = apply(state, { type: "insert_text", block: id, offset: 15, runs: [{ text: "!!" }] });
    const undone = apply(typed, inverse);
    expect(plainText(runsOf(undone))).toBe("Hello big world!!");
    expect(runsOf(undone)).toEqual([{ text: "Hello big world!!" }]);
  });

  it("rejects segments that don't add up to the range", () => {
    expect(() => restoreMarks(runsOf(doc), 0, 5, [{ length: 3 }])).toThrow(PliError);
    expect(() => apply(doc, { type: "restore_marks", block: id, from: 0, to: 99, segments: [{ length: 99 }] })).toThrow(/outside/);
  });

  it("keeps marks that straddle run boundaries", () => {
    const mixed = apply(doc, { type: "format_text", block: id, from: 0, to: 5, patch: { bold: true } }, { type: "format_text", block: id, from: 3, to: 9, patch: { italic: true } });
    const segments = marksSegments(runsOf(mixed), 2, 7);
    expect(segments.reduce((n, s) => n + s.length, 0)).toBe(5);
    const wiped = apply(mixed, { type: "restore_marks", block: id, from: 2, to: 7, segments: [{ length: 5 }] });
    expect(plainText(runsOf(wiped))).toBe("Hello big world");
    const restored = apply(wiped, { type: "restore_marks", block: id, from: 2, to: 7, segments });
    expect(runsOf(restored)).toEqual(runsOf(mixed));
  });
});

describe("update_block", () => {
  const doc = createDoc("T", [paragraph("Hello")]);
  const id = doc.blocks[0]!.id;

  it("changes properties and keeps the text, and inverts", () => {
    const { state, inverse } = docReducer.apply(doc, { type: "update_block", id, patch: { type: "heading", level: 2, align: "center" } });
    expect(state.blocks[0]).toMatchObject({ type: "heading", level: 2, align: "center", runs: [{ text: "Hello" }] });
    expect(docReducer.apply(state, inverse).state).toEqual(doc);
  });

  it("removes a property with null", () => {
    const aligned = apply(doc, { type: "update_block", id, patch: { align: "right" } });
    const cleared = apply(aligned, { type: "update_block", id, patch: { align: null } });
    expect("align" in cleared.blocks[0]!).toBe(false);
  });

  it("won't touch the id or the text", () => {
    expect(() => apply(doc, { type: "update_block", id, patch: { runs: [] } })).toThrow(/can't change "runs"/);
    expect(() => apply(doc, { type: "update_block", id, patch: { id: "x" } })).toThrow(PliError);
    expect(() => apply(doc, { type: "update_block", id: "nope", patch: { align: "left" } })).toThrow(/No block/);
  });

  it("works inside a table cell", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("x")]));
    s.select(caret(s.state.blocks[0]!.id, 0));
    s.insertTable(2, 2);
    const cellBlock = (s.state.blocks.find((b) => b.type === "table") as unknown as { rows: { cells: { blocks: Block[] }[] }[] }).rows[0]!.cells[0]!.blocks[0]!;
    const next = apply(s.state, { type: "update_block", id: cellBlock.id, patch: { align: "center" } });
    const table = next.blocks.find((b) => b.type === "table") as unknown as { rows: { cells: { blocks: Block[] }[] }[] };
    expect(table.rows[0]!.cells[0]!.blocks[0]).toMatchObject({ align: "center" });
  });
});

describe("canonicalOps", () => {
  const doc = createDoc("T", [paragraph("Hello world"), heading(1, "Title")]);
  const [a, b] = doc.blocks.map((x) => x.id);

  it("returns the very same list when nothing needs rewriting", () => {
    const ops: DocOp[] = [{ type: "insert_text", block: a!, offset: 0, runs: [{ text: "x" }] }];
    expect(canonicalOps(doc, ops)).toBe(ops);
  });

  it("tells a property change as a patch", () => {
    const next = { ...doc.blocks[1]!, level: 3 } as Block;
    expect(diffBlock(doc, b!, next)).toEqual([{ type: "update_block", id: b, patch: { level: 3 } }]);
  });

  it("tells a change of marks alone as restore_marks", () => {
    const next = { ...doc.blocks[0]!, runs: [{ text: "Hello ", marks: { bold: true } }, { text: "world" }] } as Block;
    const ops = diffBlock(doc, a!, next);
    expect(ops.map((o) => o.type)).toEqual(["restore_marks"]);
    expect(runsOf(apply(doc, ...ops))).toEqual([{ text: "Hello ", marks: { bold: true } }, { text: "world" }]);
  });

  it("tells a change of text as a delete and an insert", () => {
    const next = { ...doc.blocks[0]!, runs: [{ text: "Bye" }] } as Block;
    expect(diffBlock(doc, a!, next).map((o) => o.type)).toEqual(["delete_text", "insert_text"]);
    const cleared = { ...doc.blocks[0]!, runs: [] } as Block;
    expect(diffBlock(doc, a!, cleared).map((o) => o.type)).toEqual(["delete_text"]);
  });

  it("does nothing for an identical block", () => {
    expect(diffBlock(doc, a!, structuredClone(doc.blocks[0]!))).toEqual([]);
  });

  it("keeps a swap between a text block and one with no text as a replace_block", () => {
    const next: Block = { id: a!, type: "divider" };
    expect(diffBlock(doc, a!, next)).toEqual([{ type: "replace_block", id: a, block: next }]);
  });

  it("follows the document through a batch", () => {
    const inserted = paragraph("New");
    const ops = canonicalOps(doc, [
      { type: "insert_block", block: inserted, after: a! },
      { type: "replace_block", id: inserted.id, block: { ...inserted, align: "center" } },
    ]);
    expect(ops.map((o) => o.type)).toEqual(["insert_block", "update_block"]);
    expect(apply(doc, ...ops).blocks[1]).toMatchObject({ align: "center" });
  });

  it("reports the same errors a replace_block would", () => {
    expect(() => canonicalOps(doc, [{ type: "replace_block", id: "nope", block: doc.blocks[0]! }])).toThrow(/No block/);
    expect(() => canonicalOps(doc, [{ type: "replace_block", id: a!, block: { ...doc.blocks[0]!, id: "other" } }])).toThrow(/keep the block id/);
  });

  it("gives the same document as replace_block, for many random replacements", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    const words = ["alpha", "beta", "gamma", ""];
    for (let i = 0; i < 300; i++) {
      const base = createDoc("T", [{ ...paragraph(words[rand(4)]! + " " + words[rand(4)]!), ...(rand(2) ? { align: "right" as const } : {}) }]);
      const id = base.blocks[0]!.id;
      const text = words[rand(4)]! + " " + words[rand(4)]!;
      const marks = rand(2) ? { bold: true } : undefined;
      const next = {
        id,
        type: rand(2) ? "paragraph" : "heading",
        ...(rand(2) ? { level: 2 } : { level: 1 }),
        ...(rand(2) ? { align: "center" } : {}),
        runs: text.trim() ? [{ text, marks }] : [],
      } as unknown as Block;
      if (next.type === "paragraph") delete (next as unknown as Record<string, unknown>).level;
      const direct = apply(base, { type: "replace_block", id, block: next });
      const fine = apply(base, ...canonicalOps(base, [{ type: "replace_block", id, block: next }]));
      expect(JSON.parse(JSON.stringify(fine.blocks))).toEqual(JSON.parse(JSON.stringify(direct.blocks.map((blk) => ({ ...blk, ...("runs" in blk ? { runs: normalized(blk.runs) } : {}) })))));
    }
  });
});

function normalized(runs: Run[]): Run[] {
  return runs.filter((r) => r.text !== "");
}

describe("what sessions record", () => {
  function busy() {
    const s = new DocumentSession(createDoc("T", [paragraph("one two three"), paragraph("four five"), paragraph("six")]));
    const seen = recorder(s);
    const [a, b, c] = s.state.blocks.map((x) => x.id);
    s.select({ anchor: { block: a!, offset: 4 }, focus: { block: a!, offset: 7 } });
    s.toggleMark("bold");
    s.setMarks({ color: "#336699", fontSize: 14 });
    s.setAlign("center");
    s.setBlockType({ type: "heading", level: 2 });
    s.setBlockType({ type: "paragraph" });
    s.select(caret(b!, 2));
    s.toggleBlockType({ type: "list_item", list: "bullet" });
    s.indent();
    s.outdent();
    s.setParagraphFormat({ spaceAfter: 12, indentLeft: 18 });
    s.insertTable(2, 2);
    s.select(caret(c!, 1));
    s.insertSectionBreak("next_page");
    s.setColumns({ count: 2 });
    s.setPageShape({ size: "a4", orientation: "landscape", margins: { top: 1, bottom: 1, left: 1, right: 1 } }, 1);
    while (s.canUndo) s.undo();
    while (s.canRedo) s.redo();
    return { s, seen };
  }

  it("never emits a snapshot of a block or its text, applying, undoing or redoing", () => {
    const { seen } = busy();
    const snapshots = seen.filter((op) => SNAPSHOT.has(op.type));
    expect(snapshots.map((o) => o.type)).toEqual([]);
    expect(new Set(seen.map((o) => o.type)).has("update_block")).toBe(true);
    expect(new Set(seen.map((o) => o.type)).has("restore_marks")).toBe(true);
  });

  it("undoes to the original document and redoes to the edited one", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("one two three")]));
    const original = structuredClone(s.state);
    s.select({ anchor: { block: s.state.blocks[0]!.id, offset: 0 }, focus: { block: s.state.blocks[0]!.id, offset: 3 } });
    s.toggleMark("bold");
    s.setBlockType({ type: "heading", level: 1 });
    const edited = structuredClone(s.state);
    s.undo();
    s.undo();
    expect(s.state).toEqual(original);
    s.redo();
    s.redo();
    expect(s.state).toEqual(edited);
  });

  it("undoing a heading conversion keeps what was typed after it", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("Hello")]));
    const id = s.state.blocks[0]!.id;
    s.select(caret(id, 5));
    s.setBlockType({ type: "heading", level: 1 });
    // Someone else types in the block.
    s.transact([{ type: "insert_text", block: id, offset: 5, runs: [{ text: " there" }] }], { origin: "remote" });
    s.undo();
    expect(s.state.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(plainText(runsOf(s.state))).toBe("Hello there");
  });

  it("undoing bold keeps what was typed after it", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("Hello world")]));
    const id = s.state.blocks[0]!.id;
    s.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 5 } });
    s.toggleMark("bold");
    s.transact([{ type: "insert_text", block: id, offset: 11, runs: [{ text: "!" }] }], { origin: "remote" });
    s.undo();
    expect(runsOf(s.state)).toEqual([{ text: "Hello world!" }]);
  });
});
