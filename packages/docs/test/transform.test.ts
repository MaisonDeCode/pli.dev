import { describe, expect, it } from "vitest";
import { canonicalOps, createDoc, docReducer, heading, paragraph, plainText, rebase, table, transformOps, transformPair, type Block, type Doc, type DocOp, type Run } from "../src";

const apply = (doc: Doc, ops: readonly DocOp[]) => ops.reduce((d, op) => docReducer.apply(d, op).state, doc);
/** JSON with the keys of every object in order, so two documents that differ only in how they were built compare equal. */
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/**
 * Two people make `a` and `b` from the same document, and `b` reaches the server first. Both orders must give one
 * document, and this returns it.
 */
function merge(start: Doc, a: DocOp[], b: DocOp[]): Doc {
  const [a2, b2] = transformOps(a, b);
  const viaB = apply(apply(start, b), a2);
  const viaA = apply(apply(start, a), b2);
  expect(canon(viaB.blocks)).toBe(canon(viaA.blocks));
  return viaB;
}

const text = (doc: Doc, i = 0) => plainText((doc.blocks[i] as unknown as { runs: Run[] }).runs);
const runs = (doc: Doc, i = 0) => (doc.blocks[i] as unknown as { runs: Run[] }).runs;

function setup() {
  const doc = createDoc("T", [paragraph("Hello world"), paragraph("Second"), paragraph("Third")]);
  const [one, two, three] = doc.blocks.map((b) => b.id) as [string, string, string];
  return { doc, one, two, three };
}
const ins = (block: string, offset: number, t: string, marks?: Run["marks"]): DocOp => ({ type: "insert_text", block, offset, runs: [{ text: t, marks }] });
const del = (block: string, from: number, to: number): DocOp => ({ type: "delete_text", block, from, to });

describe("text in one block", () => {
  it("keeps both when two people type in the same place, the earlier first", () => {
    const { doc, one } = setup();
    expect(text(merge(doc, [ins(one, 5, "A")], [ins(one, 5, "B")]))).toBe("HelloBA world");
  });

  it("moves typing that comes after someone else's", () => {
    const { doc, one } = setup();
    expect(text(merge(doc, [ins(one, 8, "A")], [ins(one, 2, "BBB")]))).toBe("HeBBBllo woArld");
  });

  it("keeps typing made inside text someone deletes, at the start of the gap", () => {
    const { doc, one } = setup();
    expect(text(merge(doc, [ins(one, 7, "X")], [del(one, 5, 9)]))).toBe("HelloXld");
    expect(text(merge(doc, [del(one, 5, 9)], [ins(one, 7, "X")]))).toBe("HelloXld");
  });

  it("deletes once what both delete, and the union of what overlaps", () => {
    const { doc, one } = setup();
    expect(text(merge(doc, [del(one, 2, 6)], [del(one, 2, 6)]))).toBe("Heworld");
    expect(text(merge(doc, [del(one, 2, 6)], [del(one, 4, 9)]))).toBe("Held");
  });

  it("leaves operations on other blocks alone", () => {
    const { doc, one, two } = setup();
    const [a2, b2] = transformOps([ins(one, 0, "A")], [ins(two, 0, "B")]);
    expect(a2).toEqual([ins(one, 0, "A")]);
    expect(b2).toEqual([ins(two, 0, "B")]);
  });
});

describe("formatting and comments", () => {
  it("doesn't format text typed inside the formatted range", () => {
    const { doc, one } = setup();
    const merged = merge(doc, [{ type: "format_text", block: one, from: 2, to: 8, patch: { bold: true } }], [ins(one, 5, "XX")]);
    expect(runs(merged)).toEqual([{ text: "He" }, { text: "llo", marks: { bold: true } }, { text: "XX" }, { text: " wo", marks: { bold: true } }, { text: "rld" }]);
  });

  it("moves a format when text is typed before it, and shrinks it when text is deleted under it", () => {
    const { doc, one } = setup();
    const fmt: DocOp = { type: "format_text", block: one, from: 6, to: 11, patch: { italic: true } };
    expect(runs(merge(doc, [fmt], [ins(one, 0, ">>")]))).toEqual([{ text: ">>Hello " }, { text: "world", marks: { italic: true } }]);
    // "Hello world" with "o wo" (4 to 8) removed is "Hellrld", and the italic "world" is now "rld".
    expect(runs(merge(doc, [fmt], [del(one, 4, 8)]))).toEqual([{ text: "Hell" }, { text: "rld", marks: { italic: true } }]);
  });

  it("gives a conflicting format to the later one", () => {
    const { doc, one } = setup();
    const on: DocOp = { type: "format_text", block: one, from: 0, to: 5, patch: { bold: true } };
    const off: DocOp = { type: "format_text", block: one, from: 3, to: 8, patch: { bold: null } };
    // `off` is later, so it wins over the shared "lo": bold is left only on "Hel".
    expect(runs(merge(doc, [off], [on]))).toEqual([{ text: "Hel", marks: { bold: true } }, { text: "lo world" }]);
    // And if `on` is the later one, "Hello" is bold.
    expect(runs(merge(doc, [on], [off]))).toEqual([{ text: "Hello", marks: { bold: true } }, { text: " world" }]);
  });

  it("keeps formats that don't conflict, from both", () => {
    const { doc, one } = setup();
    const merged = merge(doc, [{ type: "format_text", block: one, from: 0, to: 11, patch: { italic: true } }], [{ type: "format_text", block: one, from: 0, to: 5, patch: { bold: true } }]);
    expect(runs(merged)).toEqual([{ text: "Hello", marks: { bold: true, italic: true } }, { text: " world", marks: { italic: true } }]);
  });

  it("puts formatting on top of restored marks, when the formatting came later", () => {
    const { doc, one } = setup();
    const restore: DocOp = { type: "restore_marks", block: one, from: 0, to: 5, segments: [{ length: 5, marks: { color: "#f00" } }] };
    const bold: DocOp = { type: "format_text", block: one, from: 2, to: 8, patch: { bold: true } };
    expect(runs(merge(doc, [bold], [restore]))[0]).toEqual({ text: "He", marks: { color: "#f00" } });
    expect(runs(merge(doc, [bold], [restore]))[1]).toEqual({ text: "llo", marks: { color: "#f00", bold: true } });
  });

  it("lets restored marks override earlier formatting, when the restore came later", () => {
    const { doc, one } = setup();
    const restore: DocOp = { type: "restore_marks", block: one, from: 0, to: 5, segments: [{ length: 5 }] };
    const bold: DocOp = { type: "format_text", block: one, from: 2, to: 8, patch: { bold: true } };
    // The restore wipes bold from "Hello"; the rest of the bold range, " wo", stays bold.
    expect(runs(merge(doc, [restore], [bold]))).toEqual([{ text: "Hello" }, { text: " wo", marks: { bold: true } }, { text: "rld" }]);
  });

  it("splits a comment around text typed inside it", () => {
    const { doc, one } = setup();
    const comment: DocOp = { type: "comment_text", block: one, from: 0, to: 11, id: "th_1", on: true };
    const merged = merge(doc, [comment], [ins(one, 5, "!!")]);
    expect(runs(merged)).toEqual([{ text: "Hello", marks: { comment: ["th_1"] } }, { text: "!!" }, { text: " world", marks: { comment: ["th_1"] } }]);
  });

  it("lets two comments cover the same words", () => {
    const { doc, one } = setup();
    const merged = merge(doc, [{ type: "comment_text", block: one, from: 0, to: 5, id: "th_b", on: true }], [{ type: "comment_text", block: one, from: 3, to: 8, id: "th_a", on: true }]);
    expect(runs(merged)).toEqual([
      { text: "Hel", marks: { comment: ["th_b"] } },
      { text: "lo", marks: { comment: ["th_a", "th_b"] } },
      { text: " wo", marks: { comment: ["th_a"] } },
      { text: "rld" },
    ]);
  });

  it("doesn't let restoring marks (undo of bold) take a comment off", () => {
    const { doc, one } = setup();
    const withComment = apply(doc, [{ type: "comment_text", block: one, from: 0, to: 5, id: "th_1", on: true }]);
    const restored = apply(withComment, [{ type: "restore_marks", block: one, from: 0, to: 5, segments: [{ length: 5, marks: { bold: true } }] }]);
    expect(runs(restored)[0]).toEqual({ text: "Hello", marks: { bold: true, comment: ["th_1"] } });
  });
});

describe("blocks", () => {
  it("loses typing in a paragraph someone deletes", () => {
    const { doc, two } = setup();
    const removal = canonicalOps(doc, [{ type: "delete_block", id: two }]);
    const merged = merge(doc, [ins(two, 0, "typed")], removal);
    expect(merged.blocks).toHaveLength(2);
    expect(merged.blocks.some((b) => b.id === two)).toBe(false);
  });

  it("loses typing in the second paragraph of a join", () => {
    const { doc, one, two } = setup();
    // Joining: the second paragraph's text goes onto the first, and the second is deleted.
    const join = [ins(one, 11, "Second"), ...canonicalOps(doc, [{ type: "delete_block", id: two }])];
    const merged = merge(doc, [ins(two, 0, "typed")], join);
    expect(text(merged)).toBe("Hello worldSecond");
    expect(merged.blocks).toHaveLength(2);
  });

  it("lets the later change to a property win", () => {
    const doc = createDoc("T", [heading(1, "Title")]);
    const id = doc.blocks[0]!.id;
    const merged = merge(doc, [{ type: "update_block", id, patch: { level: 3 } }], [{ type: "update_block", id, patch: { level: 2, align: "center" } }]);
    expect(merged.blocks[0]).toMatchObject({ level: 3, align: "center" });
  });

  it("keeps blocks inserted in the same place in the order they were accepted", () => {
    const { doc, one } = setup();
    const a = paragraph("A");
    const b = paragraph("B");
    const merged = merge(doc, [{ type: "insert_block", block: a, after: one }], [{ type: "insert_block", block: b, after: one }]);
    expect(merged.blocks.map((x) => x.id).slice(0, 3)).toEqual([one, b.id, a.id]);
  });

  it("puts a block inserted after a deleted block where the deleted block was", () => {
    const { doc, one, two, three } = setup();
    const removal = canonicalOps(doc, [{ type: "delete_block", id: two }]);
    const added = paragraph("New");
    const merged = merge(doc, [{ type: "insert_block", block: added, after: two }], removal);
    expect(merged.blocks.map((b) => b.id)).toEqual([one, added.id, three]);
    // Also at the very start of the document.
    const first = canonicalOps(doc, [{ type: "delete_block", id: one }]);
    expect(merge(doc, [{ type: "insert_block", block: added, after: one }], first).blocks.map((b) => b.id)).toEqual([added.id, two, three]);
  });

  it("deletes a block once when two people delete it", () => {
    const { doc, two } = setup();
    const removal = () => canonicalOps(doc, [{ type: "delete_block", id: two }]);
    expect(merge(doc, removal(), removal()).blocks).toHaveLength(2);
  });

  it("follows a chain of removals for where something goes", () => {
    const { doc, one, two, three } = setup();
    const added = paragraph("New");
    const removals = canonicalOps(doc, [{ type: "delete_block", id: two }, { type: "delete_block", id: one }]);
    const merged = merge(doc, [{ type: "insert_block", block: added, after: two }], removals);
    expect(merged.blocks.map((b) => b.id)).toEqual([added.id, three]);
  });

  it("keeps a block in the order when something is inserted where a deleted block's neighbour is", () => {
    const { doc, one, two, three } = setup();
    const added = paragraph("New");
    // One person inserts after the first block, another deletes the second (which was after the first).
    const merged = merge(doc, [{ type: "insert_block", block: added, after: one }], canonicalOps(doc, [{ type: "delete_block", id: two }]));
    expect(merged.blocks.map((b) => b.id)).toEqual([one, added.id, three]);
  });
});

describe("tables", () => {
  function grid() {
    const t = table([["a1", "a2"], ["b1", "b2"]]);
    const doc = createDoc("T", [paragraph("x"), t, paragraph("y")]);
    const cell = (r: number, c: number) => t.rows[r]!.cells[c]!.blocks[0]!.id;
    return { doc, t, cell };
  }

  it("lets a structure change win over typing in the table", () => {
    const { doc, t, cell } = grid();
    const rows = structuredClone(t.rows);
    rows[0]!.height = 40;
    const structure = canonicalOps(doc, [{ type: "update_block", id: t.id, patch: { rows } }]);
    const merged = merge(doc, [ins(cell(1, 1), 2, "!")], structure);
    const out = merged.blocks[1] as typeof t;
    expect(out.rows[0]!.height).toBe(40);
    expect(plainText((out.rows[1]!.cells[1]!.blocks[0] as unknown as { runs: Run[] }).runs)).toBe("b2");
  });

  it("applies typing in different tables independently of each other's structure", () => {
    const { doc, t, cell } = grid();
    const merged = merge(doc, [ins(cell(0, 0), 0, ">")], [{ type: "update_block", id: t.id, patch: { borders: "none" } }]);
    const out = merged.blocks[1] as typeof t;
    expect(out.borders).toBe("none");
    expect(plainText((out.rows[0]!.cells[0]!.blocks[0] as unknown as { runs: Run[] }).runs)).toBe(">a1");
  });

  it("drops edits to a table that is deleted", () => {
    const { doc, t, cell } = grid();
    const removal = canonicalOps(doc, [{ type: "delete_block", id: t.id }]);
    const merged = merge(doc, [ins(cell(0, 0), 0, ">"), { type: "insert_block", block: paragraph("n"), after: null, cell: t.rows[1]!.cells[0]!.id }], removal);
    expect(merged.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("leaves one empty paragraph in a cell that two people empty at once, and lets an insert replace it", () => {
    const t = table([["a1", "a2"]]);
    const cellId = t.rows[0]!.cells[0]!.id;
    const first = t.rows[0]!.cells[0]!.blocks[0]!;
    const extra = paragraph("extra");
    const withTwo = apply(createDoc("T", [t]), [{ type: "insert_block", block: extra, after: first.id }]);
    const remove = (id: string) => canonicalOps(withTwo, [{ type: "delete_block", id }]);
    const merged = merge(withTwo, remove(first.id), remove(extra.id));
    const cell = (merged.blocks[0] as typeof t).rows[0]!.cells[0]!;
    expect(cell.blocks.map((b) => b.id)).toEqual([`${cellId}~empty`]);
    const filled = apply(merged, [{ type: "insert_block", block: paragraph("new"), after: null, cell: cellId }]);
    expect(((filled.blocks[0] as typeof t).rows[0]!.cells[0]!.blocks as Block[]).map((b) => plainText((b as unknown as { runs: Run[] }).runs))).toEqual(["new"]);
  });
});

describe("the rest of the document", () => {
  it("lets the later change to a document setting win, and leaves others alone", () => {
    const { doc } = setup();
    const [a2, b2] = transformPair({ type: "set_title", title: "mine" }, { type: "set_title", title: "theirs" });
    expect(a2).toEqual([{ type: "set_title", title: "mine" }]);
    expect(b2).toEqual([]);
    expect(transformPair({ type: "set_title", title: "x" }, { type: "set_region", region: "header", blocks: null })[1]).toHaveLength(1);
    void doc;
  });

  it("lets the later change to a comment thread win", () => {
    const thread = (by: string) => ({ id: "th", createdAt: 1, comments: [{ id: "c", author: "a", body: "x", createdAt: 1 }], resolved: { by, at: 2 } });
    const [a2, b2] = transformPair({ type: "set_thread", id: "th", thread: thread("me") }, { type: "set_thread", id: "th", thread: thread("them") });
    expect(a2).toHaveLength(1);
    expect(b2).toHaveLength(0);
  });
});

describe("lists of operations and a client's waiting changes", () => {
  it("transforms each operation past each, keeping their order", () => {
    const { doc, one } = setup();
    const a = [ins(one, 0, "1"), ins(one, 1, "2"), ins(one, 2, "3")];
    const b = [ins(one, 0, "x"), ins(one, 1, "y")];
    expect(text(merge(doc, a, b))).toBe("xy123Hello world");
  });

  it("drops what a client typed into a table that someone else rewrote, and what it built there", () => {
    const t = table([["a1"]]);
    const doc = createDoc("T", [t]);
    const cell = t.rows[0]!.cells[0]!;
    const rowsWithNew = structuredClone(t.rows);
    const fresh = paragraph("fresh");
    rowsWithNew[0]!.cells[0]!.blocks.push(fresh as never);
    const mine = canonicalOps(doc, [{ type: "update_block", id: t.id, patch: { rows: rowsWithNew } }, { type: "insert_text", block: fresh.id, offset: 0, runs: [{ text: "typed" }] }] as DocOp[]);
    const theirs = canonicalOps(doc, [{ type: "delete_block", id: t.id }]);
    const result = rebase(mine, [], theirs);
    // Their deletion wins; what I sent is gone, and their deletion now covers what I added.
    expect(result.inflight).toEqual([]);
    expect(result.incoming[0]).toMatchObject({ type: "delete_block", id: t.id });
    expect((result.incoming[0] as { within?: string[] }).within).toEqual(expect.arrayContaining([fresh.id]));
    void cell;
  });

  it("drops waiting changes built on something in flight that lost out", () => {
    const t = table([["a1"]]);
    const doc = createDoc("T", [t]);
    const fresh = paragraph("fresh");
    const rows = structuredClone(t.rows);
    rows[0]!.cells[0]!.blocks.push(fresh as never);
    // In flight: a new block in the table. Waiting: typing in that new block.
    const inflight = canonicalOps(doc, [{ type: "update_block", id: t.id, patch: { rows } }]);
    const pending: DocOp[] = [ins(fresh.id, 0, "typed")];
    // Meanwhile someone deleted the whole table, and that was accepted first.
    const result = rebase(inflight, pending, canonicalOps(doc, [{ type: "delete_block", id: t.id }]));
    expect(result.inflight).toEqual([]);
    expect(result.pending).toEqual([]);
    // The deletion is applied to the document as the client has it now, with the new block and its text in the table.
    const local = apply(apply(doc, inflight), pending);
    expect(apply(local, result.incoming).blocks).toEqual([]);
  });

  it("keeps waiting changes when what they build on survives", () => {
    const { doc, one } = setup();
    const added = paragraph("New");
    const inflight: DocOp[] = [{ type: "insert_block", block: added, after: one }];
    const pending: DocOp[] = [ins(added.id, 0, "typed")];
    // Someone else typed in the first block: nothing to do with the new one.
    const result = rebase(inflight, pending, [ins(one, 0, ">>")]);
    expect(result.inflight).toEqual(inflight);
    expect(result.pending).toEqual(pending);
    expect(result.incoming).toEqual([ins(one, 0, ">>")]);
  });
});

describe("a caret when someone else edits", () => {
  it("moves with text typed or deleted before it, and stays put for text after it", async () => {
    const { DocumentSession, caret } = await import("../src");
    const s = new DocumentSession(createDoc("T", [paragraph("Hello world")]));
    const id = s.state.blocks[0]!.id;
    s.select(caret(id, 8));
    s.transact([ins(id, 2, "XX")], { origin: "remote" });
    expect(s.selection!.focus.offset).toBe(10);
    s.transact([del(id, 0, 3)], { origin: "remote" });
    expect(s.selection!.focus.offset).toBe(7);
    s.transact([ins(id, 9, "!!")], { origin: "remote" });
    expect(s.selection!.focus.offset).toBe(7);
    // Typed at the caret itself, the caret stays in front.
    s.transact([ins(id, 7, "@")], { origin: "remote" });
    expect(s.selection!.focus.offset).toBe(7);
    // Inside deleted text, it goes to the start of the gap.
    s.transact([del(id, 4, 9)], { origin: "remote" });
    expect(s.selection!.focus.offset).toBe(4);
  });

  it("moves both ends of a selection, and leaves your own edits to set the caret", async () => {
    const { DocumentSession } = await import("../src");
    const s = new DocumentSession(createDoc("T", [paragraph("Hello world")]));
    const id = s.state.blocks[0]!.id;
    s.select({ anchor: { block: id, offset: 2 }, focus: { block: id, offset: 7 } });
    s.transact([ins(id, 0, ">>")], { origin: "remote" });
    expect(s.selection).toEqual({ anchor: { block: id, offset: 4 }, focus: { block: id, offset: 9 } });
    s.typeText("!");
    expect(s.selection!.focus.offset).toBeGreaterThan(0);
  });
});
