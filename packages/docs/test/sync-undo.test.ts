import { describe, expect, it } from "vitest";
import { caret, createDoc, paragraph, plainText, table, type Block, type Doc, type Run, type TableBlock } from "../src";
import { same, startDoc } from "./fuzz-helpers";
import { rig } from "./sync-net";

const textOf = (doc: Doc, id: string): string => {
  const find = (blocks: readonly Block[]): Block | undefined => {
    for (const b of blocks) {
      if (b.id === id) return b;
      if (b.type === "table") for (const row of b.rows) for (const cell of row.cells) { const inner = find(cell.blocks); if (inner) return inner; }
    }
    return undefined;
  };
  const block = find(doc.blocks) as unknown as { runs: Run[] } | undefined;
  return block ? plainText(block.runs) : "<gone>";
};

describe("undo while other people edit", () => {
  it("undoes your typing and keeps theirs, when they typed before it", async () => {
    const w = await rig(2, startDoc());
    const id = w.sessions[0]!.state.blocks[1]!.id;
    const original = textOf(w.sessions[0]!.state, id);
    w.sessions[0]!.transact([{ type: "insert_text", block: id, offset: original.length, runs: [{ text: " MINE" }] }]);
    w.sessions[1]!.transact([{ type: "insert_text", block: id, offset: 0, runs: [{ text: "THEIRS " }] }]);
    await w.net.settle();
    expect(textOf(w.sessions[0]!.state, id)).toBe(`THEIRS ${original} MINE`);
    w.sessions[0]!.undo();
    await w.net.settle();
    expect(textOf(w.sessions[0]!.state, id)).toBe(`THEIRS ${original}`);
    expect(same(w.sessions[0]!.state, w.sessions[1]!.state)).toBe(true);
  });

  it("takes bold off the text it was put on, which has moved", async () => {
    const w = await rig(2, startDoc());
    const id = w.sessions[0]!.state.blocks[1]!.id;
    w.sessions[0]!.select({ anchor: { block: id, offset: 4 }, focus: { block: id, offset: 8 } });
    w.sessions[0]!.toggleMark("bold");
    w.sessions[1]!.transact([{ type: "insert_text", block: id, offset: 0, runs: [{ text: "ZZ" }] }]);
    await w.net.settle();
    w.sessions[0]!.undo();
    await w.net.settle();
    const runs = (w.sessions[0]!.state.blocks[1] as unknown as { runs: Run[] }).runs;
    expect(runs.some((r) => r.marks?.bold)).toBe(false);
    expect(textOf(w.sessions[0]!.state, id).startsWith("ZZ")).toBe(true);
    expect(same(w.sessions[0]!.state, w.sessions[1]!.state)).toBe(true);
  });

  it("turns a heading back into a paragraph without losing what someone typed in it", async () => {
    const w = await rig(2, startDoc());
    const id = w.sessions[0]!.state.blocks[1]!.id;
    w.sessions[0]!.select(caret(id, 0));
    w.sessions[0]!.setBlockType({ type: "heading", level: 2 });
    w.sessions[1]!.transact([{ type: "insert_text", block: id, offset: 0, runs: [{ text: "TYPED " }] }]);
    await w.net.settle();
    expect(w.sessions[0]!.state.blocks[1]!.type).toBe("heading");
    w.sessions[0]!.undo();
    await w.net.settle();
    expect(w.sessions[0]!.state.blocks[1]!.type).toBe("paragraph");
    expect(textOf(w.sessions[0]!.state, id).startsWith("TYPED ")).toBe(true);
    expect(same(w.sessions[0]!.state, w.sessions[1]!.state)).toBe(true);
    expect(w.resyncs).toEqual([]);
  });

  it("puts back a deleted block where it was, even if blocks were added around it", async () => {
    const w = await rig(2, startDoc());
    const before = w.sessions[0]!.state.blocks.map((b) => b.id);
    const victim = before[2]!;
    w.sessions[0]!.deleteBlock(victim);
    w.sessions[1]!.transact([{ type: "insert_block", block: paragraph("new one"), after: before[1]! }]);
    await w.net.settle();
    w.sessions[0]!.undo();
    await w.net.settle();
    const ids = w.sessions[0]!.state.blocks.map((b) => b.id);
    expect(ids).toContain(victim);
    expect(ids.indexOf(victim)).toBeGreaterThan(ids.indexOf(before[1]!));
    expect(same(w.sessions[0]!.state, w.sessions[1]!.state)).toBe(true);
    expect(w.resyncs).toEqual([]);
  });

  it("redoes after other people's changes too", async () => {
    const w = await rig(2, startDoc());
    const id = w.sessions[0]!.state.blocks[1]!.id;
    const original = textOf(w.sessions[0]!.state, id);
    w.sessions[0]!.transact([{ type: "insert_text", block: id, offset: original.length, runs: [{ text: "!" }] }]);
    await w.net.settle();
    w.sessions[0]!.undo();
    await w.net.settle();
    w.sessions[1]!.transact([{ type: "insert_text", block: id, offset: 0, runs: [{ text: "<<" }] }]);
    await w.net.settle();
    w.sessions[0]!.redo();
    await w.net.settle();
    expect(textOf(w.sessions[0]!.state, id)).toBe(`<<${original}!`);
    expect(same(w.sessions[0]!.state, w.sessions[1]!.state)).toBe(true);
  });
});

describe("your caret and other people's cursors", () => {
  it("goes to the end of the block before, when its block is deleted", async () => {
    const w = await rig(2, startDoc());
    const [, a, b] = w.sessions[0]!.state.blocks.map((x) => x.id);
    w.sessions[0]!.select(caret(b!, 3));
    w.sessions[1]!.deleteBlock(b!);
    await w.net.settle();
    const length = textOf(w.sessions[0]!.state, a!).length;
    expect(w.sessions[0]!.selection).toEqual(caret(a!, length));
  });

  it("keeps other people's cursors with their text", async () => {
    const w = await rig(3, startDoc());
    const id = w.sessions[0]!.state.blocks[1]!.id;
    // Client 1 puts its cursor at 10; the others hear of it.
    w.rooms[1]!.setPresence({ selection: caret(id, 10) });
    await w.net.settle();
    const seen = () => (w.rooms[0]!.peers.find((p) => p.client === w.rooms[1]!.client)?.state.selection as { focus: { offset: number } }).focus.offset;
    expect(seen()).toBe(10);
    // Client 2 types five characters in front of it: client 0 sees the cursor move along.
    w.sessions[2]!.transact([{ type: "insert_text", block: id, offset: 0, runs: [{ text: "12345" }] }]);
    await w.net.settle();
    expect(seen()).toBe(15);
    // And so does a change client 0 makes itself.
    w.sessions[0]!.transact([{ type: "insert_text", block: id, offset: 0, runs: [{ text: "ab" }] }]);
    expect(seen()).toBe(17);
  });
});

describe("a cell two people emptied at once", () => {
  function setup() {
    const t = table([["a1", "a2"]]);
    const first = t.rows[0]!.cells[0]!.blocks[0]!;
    const extra = paragraph("extra");
    const doc = createDoc("T", [paragraph("above"), t]);
    const withTwo = { ...doc, blocks: [doc.blocks[0]!, { ...t, rows: [{ ...t.rows[0]!, cells: [{ ...t.rows[0]!.cells[0]!, blocks: [first, extra as never] }, t.rows[0]!.cells[1]!] }] }] } as Doc;
    return { doc: withTwo, cell: t.rows[0]!.cells[0]!.id, first, extra };
  }

  it("lets someone type in the empty cell: a real block takes the stand-in's place, for everyone", async () => {
    const { doc, cell, first, extra } = setup();
    const w = await rig(3, doc);
    w.sessions[0]!.deleteBlock(first.id);
    w.sessions[1]!.deleteBlock(extra.id);
    await w.net.settle();
    const standIn = `${cell}~empty`;
    const cellBlocks = (d: Doc) => (d.blocks[1] as TableBlock).rows[0]!.cells[0]!.blocks.map((b) => b.id);
    expect(cellBlocks(w.sessions[0]!.state)).toEqual([standIn]);
    // Client 2 clicks into the empty cell and types.
    w.sessions[2]!.select(caret(standIn, 0));
    w.sessions[2]!.typeText("hello");
    expect(cellBlocks(w.sessions[2]!.state)).not.toContain(standIn);
    const here = w.sessions[2]!.selection!;
    expect(textOf(w.sessions[2]!.state, here.focus.block)).toBe("hello");
    expect(here.focus.offset).toBe(5);
    await w.net.settle();
    expect(same(w.sessions[0]!.state, w.sessions[2]!.state)).toBe(true);
    expect(same(w.sessions[1]!.state, w.sessions[2]!.state)).toBe(true);
    expect(w.resyncs).toEqual([]);
    // The caret of someone who was in the stand-in goes to the block that replaced it.
  });

  it("puts a caret that was in the stand-in into the block that replaced it", async () => {
    const { doc, cell, first, extra } = setup();
    const w = await rig(3, doc);
    w.sessions[0]!.deleteBlock(first.id);
    w.sessions[1]!.deleteBlock(extra.id);
    await w.net.settle();
    w.sessions[0]!.select(caret(`${cell}~empty`, 0));
    w.sessions[2]!.transact([{ type: "insert_block", block: paragraph("typed"), after: null, cell }]);
    await w.net.settle();
    const sel = w.sessions[0]!.selection!;
    expect(textOf(w.sessions[0]!.state, sel.focus.block)).toBe("typed");
  });

  it("can undo typing into it", async () => {
    const { doc, cell, first, extra } = setup();
    const w = await rig(2, doc);
    w.sessions[0]!.deleteBlock(first.id);
    w.sessions[1]!.deleteBlock(extra.id);
    await w.net.settle();
    w.sessions[0]!.select(caret(`${cell}~empty`, 0));
    w.sessions[0]!.typeText("x");
    await w.net.settle();
    w.sessions[0]!.undo();
    await w.net.settle();
    expect((w.sessions[0]!.state.blocks[1] as TableBlock).rows[0]!.cells[0]!.blocks.map((b) => b.id)).toEqual([`${cell}~empty`]);
    expect(same(w.sessions[0]!.state, w.sessions[1]!.state)).toBe(true);
    expect(w.resyncs).toEqual([]);
  });
});
