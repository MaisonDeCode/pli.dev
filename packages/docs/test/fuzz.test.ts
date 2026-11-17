import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "@pli.dev/core";
import {
  DocumentSession,
  bold,
  blockLength,
  codeBlock,
  createDoc,
  divider,
  heading,
  image,
  listItem,
  pageBreak,
  paragraph,
  quote,
  subtitle,
  title,
  toc,
  flattenBlocks,
  locate,
  table,
  validateDoc,
  type Selection,
} from "../src";

/** Small deterministic PRNG so failures reproduce from the seed. */
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

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

function randomSelection(session: DocumentSession, random: () => number): Selection {
  // Any block in reading order, including the blocks inside table cells.
  const blocks = flattenBlocks(session.state.blocks).filter((b) => b.type !== "table" || random() < 0.1);
  const point = () => {
    const block = blocks[Math.floor(random() * blocks.length)]!;
    return { block: block.id, offset: Math.floor(random() * (blockLength(block) + 1)) };
  };
  const anchor = point();
  return { anchor, focus: random() < 0.4 ? anchor : point() };
}

/** Steps, over all seeds, at which the document had a merged table. Checked at the end. */
let mergedSteps = 0;

describe("random editing", () => {
  // Merged tables must really be exercised, not just possible.
  afterAll(() => expect(mergedSteps).toBeGreaterThan(3000));

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))("keeps the document valid and fully undoable (seed %i)", (seed) => {
    const random = rng(seed);
    const session = new DocumentSession(
      createDoc("Fuzz", [
        title("Doc title"),
        subtitle("A subtitle"),
        toc(3),
        heading(1, "Title"),
        paragraph(["Some ", bold("bold"), " text 😀 here"]),
        image("data:image/png;base64,AAAA", { width: 40, height: 20 }),
        pageBreak(),
        listItem("bullet", "one"),
        listItem("bullet", "two", 1),
        listItem("ordered", "three"),
        divider(),
        quote("quoted"),
        codeBlock("code\nblock"),
        table([["one", "two", "x"], ["three", "four", "y"], ["five", "six", "z"]], { headerRow: true }),
        paragraph("last"),
      ]),
    );
    const original = session.state;

    const actions: (() => boolean)[] = [
      () => session.typeText(["a", "😀", "xyz", " "][Math.floor(random() * 4)]!),
      () => session.splitBlock(),
      () => session.backspace(),
      () => session.deleteForward(),
      () => session.deleteSelection(),
      () => session.toggleMark(["bold", "italic", "underline", "strike", "code"][Math.floor(random() * 5)] as "bold"),
      () => session.setMarks({ color: random() < 0.5 ? "#f00" : null }),
      () => session.toggleBlockType({ type: "heading", level: 2 }),
      () => session.setBlockType({ type: "list_item", list: random() < 0.5 ? "bullet" : "ordered" }),
      () => session.setBlockType({ type: "code_block" }),
      () => session.setBlockType({ type: "paragraph" }),
      () => session.indent(),
      () => session.outdent(),
      () => session.setAlign(["left", "center", "right"][Math.floor(random() * 3)] as "left"),
      () => session.setMarks({ fontSize: [10, 14, null][Math.floor(random() * 3)] as number, fontFamily: random() < 0.5 ? "Georgia" : null }),
      () => session.toggleMark(random() < 0.5 ? "superscript" : "subscript"),
      () => session.setParagraphFormat({ lineHeight: random() < 0.5 ? 1.5 : null, spaceAfter: random() < 0.5 ? 12 : null }),
      () => session.clearFormatting(),
      () => session.setLink(random() < 0.5 ? "https://pli.dev" : null),
      () => session.setBlockType({ type: random() < 0.5 ? "title" : "subtitle" }),
      () =>
        session.insertBlockAtCaret(
          [pageBreak(), divider(), toc(2), image("data:image/png;base64,AAAA", { width: 10, height: 10 })][Math.floor(random() * 4)]!,
        ),
      () => session.insertField("page"),
      () => session.insertTable(1 + Math.floor(random() * 3), 1 + Math.floor(random() * 3)),
      () => session.addRow(random() < 0.5 ? "above" : "below"),
      () => session.addColumn(random() < 0.5 ? "left" : "right"),
      () => session.deleteRow(),
      () => session.deleteColumn(),
      () => random() < 0.1 && session.deleteTable(),
      () => session.setCellShade(random() < 0.5 ? "#ffe58f" : null),
      () => session.setHeaderRow(random() < 0.5),
      () => session.moveToCell(random() < 0.5 ? 1 : -1),
      () => session.mergeCells(),
      () => session.mergeCells(),
      () => session.splitCells(),
      () => session.setRowHeight(random() < 0.3 ? null : 20 + Math.floor(random() * 40)),
      () => session.setCellVerticalAlign((["top", "middle", "bottom"] as const)[Math.floor(random() * 3)]!),
    ];

    let applied = 0;
    let stepsWithMerges = 0;
    for (let i = 0; i < 500; i++) {
      session.select(randomSelection(session, random));
      if (actions[Math.floor(random() * actions.length)]!()) applied++;

      // After every step: a valid, non-empty document with a selection that points inside it.
      expect(() => validateDoc(session.state)).not.toThrow();
      if (session.state.blocks.some((b) => b.type === "table" && b.rows.some((r) => r.cells.some((c) => c.rowSpan || c.colSpan)))) stepsWithMerges++;
      expect(session.state.blocks.length).toBeGreaterThan(0);
      const sel = session.selection!;
      for (const p of [sel.anchor, sel.focus]) {
        const block = locate(session.state, p.block)?.block;
        expect(block, `selection points at missing block ${p.block}`).toBeDefined();
        expect(p.offset).toBeLessThanOrEqual(blockLength(block!));
      }
      // No empty runs are left behind.
      for (const b of flattenBlocks(session.state.blocks)) {
        if (!("runs" in b)) continue;
        expect(b.runs.every((r) => r.text !== "")).toBe(true);
      }
    }

    // Guards against a vacuous run where most commands are no-ops.
    expect(applied).toBeGreaterThan(150);
    mergedSteps += stepsWithMerges;
    expect(flattenBlocks(session.state.blocks).length).toBeGreaterThan(0);

    const final = session.state;
    while (session.canUndo) session.undo();
    expect(session.state).toEqual(original);
    while (session.canRedo) session.redo();
    expect(session.state).toEqual(final);
  });
});
