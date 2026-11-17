import { beforeEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "@pli.dev/core";
import {
  DocumentSession,
  bold,
  caret,
  codeBlock,
  createDoc,
  divider,
  heading,
  link,
  listItem,
  paragraph,
  plainText,
  text,
  type Block,
  type Selection,
} from "../src";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

/** "type:text" for each block, so assertions read like the document. */
function outline(session: DocumentSession): string[] {
  return session.state.blocks.map((b) => ("runs" in b ? `${b.type}:${plainText(b.runs)}` : b.type));
}

function setup(blocks: Block[], selection?: Selection) {
  const session = new DocumentSession(createDoc("T", blocks));
  if (selection) session.select(selection);
  return session;
}

const range = (a: Block, ao: number, b: Block, bo: number): Selection => ({
  anchor: { block: a.id, offset: ao },
  focus: { block: b.id, offset: bo },
});

describe("typeText", () => {
  it("inserts at the caret and moves it forward", () => {
    const p = paragraph("held");
    const s = setup([p], caret(p.id, 3));
    s.typeText("l");
    expect(outline(s)).toEqual(["paragraph:helld"]);
    expect(s.selection).toEqual(caret(p.id, 4));
  });

  it("replaces a selection, even a backwards one", () => {
    const p = paragraph("hello world");
    const s = setup([p], range(p, 11, p, 5));
    s.typeText("!");
    expect(outline(s)).toEqual(["paragraph:hello!"]);
  });

  it("inherits the formatting of the text before the caret", () => {
    const p = paragraph([bold("bold"), " plain"]);
    const s = setup([p], caret(p.id, 4));
    s.typeText("er");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "bolder", marks: { bold: true } }, { text: " plain" }] });
  });

  it("extends a link only when typing inside it", () => {
    const p = paragraph([link("docs", "https://pli.dev"), " end"]);
    const inside = setup([p], caret(p.id, 2));
    inside.typeText("X");
    expect(inside.state.blocks[0]).toMatchObject({ runs: [{ text: "doXcs", marks: { link: "https://pli.dev" } }, { text: " end" }] });

    const q = paragraph([link("docs", "https://pli.dev"), " end"]);
    const edge = setup([q], caret(q.id, 4));
    edge.typeText("X");
    expect(edge.state.blocks[0]).toMatchObject({ runs: [{ text: "docs", marks: { link: "https://pli.dev" } }, { text: "X end" }] });
  });

  it("replaces a selection that spans blocks", () => {
    const a = paragraph("one two");
    const b = paragraph("three four");
    const s = setup([a, b], range(a, 4, b, 6));
    s.typeText("-");
    expect(outline(s)).toEqual(["paragraph:one -four"]);
    expect(s.selection).toEqual(caret(a.id, 5));
  });
});

describe("deleting ranges", () => {
  it("merges the ends and removes blocks in between", () => {
    const a = paragraph("alpha");
    const b = paragraph("beta");
    const c = paragraph("gamma");
    const s = setup([a, b, c], range(a, 2, c, 3));
    s.deleteSelection();
    expect(outline(s)).toEqual(["paragraph:alma"]);
    expect(s.selection).toEqual(caret(a.id, 2));
  });

  it("keeps the first block's type", () => {
    const h = heading(1, "Title");
    const p = paragraph("body");
    const s = setup([h, p], range(h, 3, p, 2));
    s.deleteSelection();
    expect(outline(s)).toEqual(["heading:Titdy"]);
  });

  it("drops dividers inside the range without merging across them", () => {
    const a = paragraph("abc");
    const d = divider();
    const b = paragraph("def");
    const s = setup([a, d, b], range(a, 1, b, 1));
    s.deleteSelection();
    expect(outline(s)).toEqual(["paragraph:aef"]);
  });

  it("never leaves the document empty", () => {
    const a = paragraph("abc");
    const b = paragraph("def");
    const s = setup([a, b], range(a, 0, b, 3));
    s.deleteSelection();
    expect(outline(s)).toEqual(["paragraph:"]);
  });

  it("is one undo step", () => {
    const a = paragraph("alpha");
    const b = paragraph("beta");
    const s = setup([a, b], range(a, 2, b, 2));
    const before = s.state;
    s.deleteSelection();
    s.undo();
    expect(s.state).toEqual(before);
    expect(s.canUndo).toBe(false);
  });
});

describe("splitBlock (Enter)", () => {
  it("splits a paragraph, keeping formatting on both sides", () => {
    const p = paragraph(["ab", bold("cd"), "ef"]);
    const s = setup([p], caret(p.id, 3));
    s.splitBlock();
    expect(outline(s)).toEqual(["paragraph:abc", "paragraph:def"]);
    expect(s.state.blocks[1]).toMatchObject({ runs: [{ text: "d", marks: { bold: true } }, { text: "ef" }] });
    expect(s.selection).toEqual(caret(s.state.blocks[1]!.id, 0));
  });

  it("starts a paragraph after the end of a heading, but splits a heading in the middle", () => {
    const h = heading(2, "Title");
    const end = setup([h], caret(h.id, 5));
    end.splitBlock();
    expect(outline(end)).toEqual(["heading:Title", "paragraph:"]);

    const g = heading(2, "Title");
    const mid = setup([g], caret(g.id, 2));
    mid.splitBlock();
    expect(outline(mid)).toEqual(["heading:Ti", "heading:tle"]);
  });

  it("continues a list, and exits it on an empty item", () => {
    const item = listItem("bullet", "one");
    const s = setup([item], caret(item.id, 3));
    s.splitBlock();
    expect(outline(s)).toEqual(["list_item:one", "list_item:"]);
    s.splitBlock();
    expect(outline(s)).toEqual(["list_item:one", "paragraph:"]);
  });

  it("outdents an empty nested list item", () => {
    const a = listItem("bullet", "a");
    const b = listItem("bullet", "", 1);
    const s = setup([a, b], caret(b.id, 0));
    s.splitBlock();
    expect(s.state.blocks[1]).toMatchObject({ type: "list_item", depth: 0 });
  });

  it("adds a line break inside a code block", () => {
    const c = codeBlock("ab");
    const s = setup([c], caret(c.id, 1));
    s.splitBlock();
    expect(outline(s)).toEqual(["code_block:a\nb"]);
    expect(s.selection).toEqual(caret(c.id, 2));
  });

  it("replaces a selection before splitting", () => {
    const p = paragraph("abcdef");
    const s = setup([p], range(p, 2, p, 4));
    s.splitBlock();
    expect(outline(s)).toEqual(["paragraph:ab", "paragraph:ef"]);
  });

  it("adds a paragraph after a divider", () => {
    const d = divider();
    const s = setup([d], caret(d.id, 0));
    s.splitBlock();
    expect(outline(s)).toEqual(["divider", "paragraph:"]);
  });
});

describe("backspace", () => {
  it("deletes the character before the caret", () => {
    const p = paragraph("abc");
    const s = setup([p], caret(p.id, 2));
    s.backspace();
    expect(outline(s)).toEqual(["paragraph:ac"]);
    expect(s.selection).toEqual(caret(p.id, 1));
  });

  it("deletes an emoji as one character", () => {
    const p = paragraph("a😀b");
    const s = setup([p], caret(p.id, 3));
    s.backspace();
    expect(outline(s)).toEqual(["paragraph:ab"]);
    expect(s.selection).toEqual(caret(p.id, 1));
  });

  it("merges into the previous block at the start of a paragraph", () => {
    const a = paragraph(["one ", bold("two")]);
    const b = paragraph("three");
    const s = setup([a, b], caret(b.id, 0));
    s.backspace();
    expect(outline(s)).toEqual(["paragraph:one twothree"]);
    expect(s.selection).toEqual(caret(a.id, 7));
  });

  it("converts headings, quotes and list items before merging", () => {
    const a = paragraph("a");
    const h = heading(1, "H");
    const s = setup([a, h], caret(h.id, 0));
    s.backspace();
    expect(outline(s)).toEqual(["paragraph:a", "paragraph:H"]);

    const item = listItem("ordered", "x", 1);
    const t = setup([item], caret(item.id, 0));
    t.backspace();
    expect(t.state.blocks[0]).toMatchObject({ type: "list_item", depth: 0 });
    t.backspace();
    expect(t.state.blocks[0]).toMatchObject({ type: "paragraph" });
  });

  it("removes a divider above the caret", () => {
    const d = divider();
    const p = paragraph("x");
    const s = setup([d, p], caret(p.id, 0));
    s.backspace();
    expect(outline(s)).toEqual(["paragraph:x"]);
  });

  it("does nothing at the very start of the document", () => {
    const p = paragraph("x");
    const s = setup([p], caret(p.id, 0));
    expect(s.backspace()).toBe(false);
    expect(s.canUndo).toBe(false);
  });
});

describe("deleteForward", () => {
  it("deletes the character after the caret", () => {
    const p = paragraph("abc");
    const s = setup([p], caret(p.id, 1));
    s.deleteForward();
    expect(outline(s)).toEqual(["paragraph:ac"]);
    expect(s.selection).toEqual(caret(p.id, 1));
  });

  it("pulls the next block up at the end of a block", () => {
    const a = paragraph("one");
    const b = paragraph("two");
    const s = setup([a, b], caret(a.id, 3));
    s.deleteForward();
    expect(outline(s)).toEqual(["paragraph:onetwo"]);
    expect(s.selection).toEqual(caret(a.id, 3));
  });

  it("removes a divider below the caret", () => {
    const a = paragraph("one");
    const d = divider();
    const s = setup([a, d], caret(a.id, 3));
    s.deleteForward();
    expect(outline(s)).toEqual(["paragraph:one"]);
  });
});

describe("marks", () => {
  it("toggles a mark across blocks, then off again", () => {
    const a = paragraph("hello");
    const b = paragraph("world");
    const s = setup([a, b], range(a, 2, b, 3));
    s.toggleMark("bold");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "he" }, { text: "llo", marks: { bold: true } }] });
    expect(s.state.blocks[1]).toMatchObject({ runs: [{ text: "wor", marks: { bold: true } }, { text: "ld" }] });
    s.toggleMark("bold");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "hello" }] });
    expect(s.state.blocks[1]).toMatchObject({ runs: [{ text: "world" }] });
  });

  it("turns the mark on when only part of the selection has it", () => {
    const p = paragraph([bold("ab"), "cd"]);
    const s = setup([p], range(p, 0, p, 4));
    s.toggleMark("bold");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "abcd", marks: { bold: true } }] });
  });

  it("skips code blocks, and sets a pending format for a collapsed selection instead of editing", () => {
    const c = codeBlock("code");
    const s = setup([c], range(c, 0, c, 4));
    expect(s.toggleMark("bold")).toBe(false);
    const p = paragraph("x");
    const t = setup([p], caret(p.id, 1));
    const before = t.state;
    expect(t.toggleMark("bold")).toBe(true);
    expect(t.pendingMarks).toEqual({ bold: true });
    expect(t.state).toBe(before);
  });

  it("sets values like color and removes them with null", () => {
    const p = paragraph("abc");
    const s = setup([p], range(p, 0, p, 3));
    s.setMarks({ color: "#ff0000" });
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "abc", marks: { color: "#ff0000" } }] });
    s.setMarks({ color: null });
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "abc" }] });
  });
});

describe("block types", () => {
  it("converts selected blocks and toggles back to paragraphs", () => {
    const a = paragraph("a");
    const b = paragraph("b");
    const s = setup([a, b], range(a, 0, b, 1));
    s.toggleBlockType({ type: "heading", level: 2 });
    expect(outline(s)).toEqual(["heading:a", "heading:b"]);
    s.toggleBlockType({ type: "heading", level: 2 });
    expect(outline(s)).toEqual(["paragraph:a", "paragraph:b"]);
  });

  it("switches heading levels directly", () => {
    const h = heading(1, "x");
    const s = setup([h], caret(h.id, 0));
    s.toggleBlockType({ type: "heading", level: 3 });
    expect(s.state.blocks[0]).toMatchObject({ type: "heading", level: 3 });
  });

  it("strips formatting when converting to a code block", () => {
    const p = paragraph(["a", bold("b")]);
    const s = setup([p], caret(p.id, 0));
    s.setBlockType({ type: "code_block", language: "ts" });
    expect(s.state.blocks[0]).toEqual({ id: p.id, type: "code_block", language: "ts", runs: [{ text: "ab" }] });
  });

  it("keeps the depth of list items that change list kind", () => {
    const item = listItem("bullet", "x", 2);
    const s = setup([item], caret(item.id, 0));
    s.setBlockType({ type: "list_item", list: "ordered" });
    expect(s.state.blocks[0]).toMatchObject({ list: "ordered", depth: 2 });
  });

  it("aligns paragraphs and headings, and clears alignment for left", () => {
    const p = paragraph("x");
    const s = setup([p], caret(p.id, 0));
    s.setAlign("center");
    expect(s.state.blocks[0]).toMatchObject({ align: "center" });
    s.setAlign("left");
    expect(s.state.blocks[0]).not.toHaveProperty("align");
  });
});

describe("indent and outdent", () => {
  it("cannot indent the first item or go deeper than one below the item above", () => {
    const a = listItem("bullet", "a");
    const b = listItem("bullet", "b");
    const s = setup([a, b], caret(a.id, 0));
    expect(s.indent()).toBe(false);

    s.select(range(b, 0, b, 0));
    expect(s.indent()).toBe(true);
    expect(s.state.blocks[1]).toMatchObject({ depth: 1 });
    expect(s.indent()).toBe(false);
  });

  it("indents a selection as a group, keeping relative depth", () => {
    const a = listItem("bullet", "a");
    const b = listItem("bullet", "b");
    const c = listItem("bullet", "c", 1);
    const s = setup([a, b, c], range(b, 0, c, 1));
    s.indent();
    expect(s.state.blocks.map((x) => (x.type === "list_item" ? x.depth : -1))).toEqual([0, 1, 2]);
  });

  it("outdents, turning top-level items into paragraphs", () => {
    const a = listItem("bullet", "a", 1);
    const s = setup([a], caret(a.id, 0));
    s.outdent();
    expect(s.state.blocks[0]).toMatchObject({ type: "list_item", depth: 0 });
    s.outdent();
    expect(s.state.blocks[0]).toMatchObject({ type: "paragraph" });
  });
});

describe("history and selection", () => {
  it("restores the selection on undo and redo", () => {
    const p = paragraph("abc");
    const s = setup([p], caret(p.id, 1));
    s.typeText("XY");
    expect(s.selection).toEqual(caret(p.id, 3));

    s.select(caret(p.id, 0)); // user clicks elsewhere
    s.undo();
    expect(outline(s)).toEqual(["paragraph:abc"]);
    expect(s.selection).toEqual(caret(p.id, 1));

    s.redo();
    expect(outline(s)).toEqual(["paragraph:aXYbc"]);
    expect(s.selection).toEqual(caret(p.id, 3));
  });

  it("undoes a split and a merge in sequence", () => {
    const p = paragraph("abcd");
    const s = setup([p], caret(p.id, 2));
    const original = s.state;
    s.splitBlock();
    s.backspace();
    expect(outline(s)).toEqual(["paragraph:abcd"]);
    s.undo();
    expect(outline(s)).toEqual(["paragraph:ab", "paragraph:cd"]);
    s.undo();
    expect(s.state).toEqual(original);
    expect(s.selection).toEqual(caret(p.id, 2));
  });

  it("notifies selection listeners only when it changes", () => {
    const p = paragraph("abc");
    const s = setup([p], caret(p.id, 0));
    const seen: number[] = [];
    s.onSelectionChange((sel) => seen.push(sel!.focus.offset));
    s.select(caret(p.id, 2));
    s.select(caret(p.id, 2));
    s.typeText("x");
    expect(seen).toEqual([2, 3]);
  });

  it("clamps an out-of-range selection and recovers when its block is deleted", () => {
    const a = paragraph("ab");
    const b = paragraph("cd");
    const s = setup([a, b], caret(b.id, 0));
    s.select(caret(a.id, 99));
    expect(s.selection).toEqual(caret(a.id, 2));
    s.select(caret(b.id, 1));
    s.deleteBlock(b.id);
    expect(s.selection).toEqual(caret(a.id, 0));
  });

  it("lets custom commands run through exec", () => {
    const p = paragraph("abc");
    const s = setup([p], caret(p.id, 0));
    const shout = (_doc: unknown, sel: Selection) => ({
      ops: [{ type: "insert_text" as const, block: sel.focus.block, offset: 0, runs: [text("!")] }],
      selection: caret(sel.focus.block, 1),
    });
    expect(s.exec(shout)).toBe(true);
    expect(outline(s)).toEqual(["paragraph:!abc"]);
  });
});

describe("selections that end at the start of a block", () => {
  it("leave that block alone for block-level changes", () => {
    const a = paragraph("first");
    const b = heading(2, "second");
    const s = setup([a, b], range(a, 0, b, 0)); // what a triple-click on "first" selects
    s.setAlign("center");
    expect(s.state.blocks[0]).toMatchObject({ align: "center" });
    expect(s.state.blocks[1]).not.toHaveProperty("align");

    s.setBlockType({ type: "quote" });
    expect(s.state.blocks.map((x) => x.type)).toEqual(["quote", "heading"]);
  });

  it("still include a block when the selection starts there or the selection is collapsed", () => {
    const a = paragraph("");
    const b = paragraph("x");
    const s = setup([a, b], range(a, 0, b, 0));
    s.setAlign("right");
    expect(s.state.blocks[0]).toMatchObject({ align: "right" });
    s.select(caret(b.id, 0));
    s.setAlign("right");
    expect(s.state.blocks[1]).toMatchObject({ align: "right" });
  });
});
