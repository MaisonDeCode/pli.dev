import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setIdGenerator } from "@pli.dev/core";
import {
  DocumentSession,
  bold,
  caret,
  codeBlock,
  commands,
  createDoc,
  heading,
  listItem,
  paragraph,
  plainText,
  selectionState,
  selectionToPlainText,
  sliceSelection,
  toMarkdown,
  type Block,
  type Selection,
} from "../src";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

const outline = (s: DocumentSession) =>
  s.state.blocks.map((b) => ("runs" in b ? `${b.type}:${plainText(b.runs)}` : b.type));

function setup(blocks: Block[], selection: Selection) {
  const session = new DocumentSession(createDoc("T", blocks));
  session.select(selection);
  return session;
}

const range = (a: Block, ao: number, b: Block, bo: number): Selection => ({
  anchor: { block: a.id, offset: ao },
  focus: { block: b.id, offset: bo },
});

describe("pastePlainText", () => {
  it("turns line breaks into blocks in one undo step", () => {
    const p = paragraph("ab");
    const s = setup([p], caret(p.id, 1));
    s.pastePlainText("X\nY\r\nZ");
    expect(outline(s)).toEqual(["paragraph:aX", "paragraph:Y", "paragraph:Zb"]);
    expect(s.selection!.focus.offset).toBe(1);

    s.undo();
    expect(outline(s)).toEqual(["paragraph:ab"]);
    expect(s.canUndo).toBe(false);
  });

  it("replaces a selection and continues list items", () => {
    const a = listItem("bullet", "one");
    const b = listItem("bullet", "two");
    const s = setup([a, b], range(a, 1, b, 1));
    s.pastePlainText("1\n2");
    expect(outline(s)).toEqual(["list_item:o1", "list_item:2wo"]);
  });

  it("keeps line breaks inside code blocks", () => {
    const c = codeBlock("");
    const s = setup([c], caret(c.id, 0));
    s.pastePlainText("a\nb");
    expect(outline(s)).toEqual(["code_block:a\nb"]);
  });
});

describe("syncBlockText", () => {
  const apply = (s: DocumentSession, id: string, text: string, offset = 0) =>
    s.exec(commands.syncBlockText(id, text, offset));

  it("applies the smallest edit and keeps formatting around it", () => {
    const p = paragraph(["hello ", bold("big"), " world"]);
    const s = setup([p], caret(p.id, 0));
    apply(s, p.id, "hello big brave world");
    expect(s.state.blocks[0]).toMatchObject({
      runs: [{ text: "hello " }, { text: "big", marks: { bold: true } }, { text: " brave world" }],
    });
  });

  it("keeps the formatting of replaced text", () => {
    const p = paragraph(["a ", bold("teh"), " b"]);
    const s = setup([p], caret(p.id, 0));
    apply(s, p.id, "a the b", 5);
    expect(s.state.blocks[0]).toMatchObject({
      runs: [{ text: "a " }, { text: "the", marks: { bold: true } }, { text: " b" }],
    });
    expect(s.selection).toEqual(caret(p.id, 5));
  });

  it("handles pure deletions and emoji safely", () => {
    const p = paragraph("a😀b");
    const s = setup([p], caret(p.id, 0));
    apply(s, p.id, "ab");
    expect(outline(s)).toEqual(["paragraph:ab"]);
    apply(s, p.id, "a😁b");
    expect(outline(s)).toEqual(["paragraph:a😁b"]);
  });

  it("does nothing when the text already matches", () => {
    const p = paragraph("same");
    const s = setup([p], caret(p.id, 0));
    expect(apply(s, p.id, "same")).toBe(false);
  });
});

describe("pending marks", () => {
  it("applies a toggled format to the next typed text only", () => {
    const p = paragraph("ab");
    const s = setup([p], caret(p.id, 2));
    s.toggleMark("bold");
    expect(s.pendingMarks).toEqual({ bold: true });
    s.typeText("c");
    s.typeText("d");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "ab" }, { text: "cd", marks: { bold: true } }] });
  });

  it("can turn off a mark that the text before the caret has", () => {
    const p = paragraph([bold("ab")]);
    const s = setup([p], caret(p.id, 2));
    s.toggleMark("bold");
    s.typeText("c");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "ab", marks: { bold: true } }, { text: "c" }] });
  });

  it("is dropped when the selection moves, and toggling twice cancels", () => {
    const p = paragraph("ab");
    const s = setup([p], caret(p.id, 2));
    s.toggleMark("italic");
    s.select(caret(p.id, 1));
    expect(s.pendingMarks).toBeNull();

    s.toggleMark("italic");
    s.toggleMark("italic");
    s.typeText("x");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "axb" }] });
  });

  it("bumps the revision and notifies listeners", () => {
    const p = paragraph("ab");
    const s = setup([p], caret(p.id, 2));
    let calls = 0;
    s.onSelectionChange(() => calls++);
    const before = s.revision;
    s.toggleMark("bold");
    expect(calls).toBe(1);
    expect(s.revision).toBeGreaterThan(before);
  });
});

describe("selectionState", () => {
  it("reports marks, block type and alignment", () => {
    const h = heading(2, [bold("Title")], "center");
    const s = setup([h], range(h, 0, h, 5));
    const state = selectionState(s.state, s.selection, s.pendingMarks);
    expect(state.marks.bold).toBe(true);
    expect(state.marks.italic).toBe(false);
    expect(state.block).toEqual({ type: "heading", level: 2 });
    expect(state.align).toBe("center");
  });

  it("says a mark is active for a range only when all of it has the mark", () => {
    const p = paragraph([bold("ab"), "cd"]);
    const s = setup([p], range(p, 0, p, 4));
    expect(selectionState(s.state, s.selection).marks.bold).toBe(false);
    s.select(range(p, 0, p, 2));
    expect(selectionState(s.state, s.selection).marks.bold).toBe(true);
  });

  it("returns null for mixed blocks and reports indent availability", () => {
    const a = paragraph("a");
    const b = listItem("bullet", "b");
    const c = listItem("bullet", "c");
    const s = setup([a, b, c], range(a, 0, b, 1));
    expect(selectionState(s.state, s.selection).block).toBeNull();
    s.select(caret(c.id, 0));
    const state = selectionState(s.state, s.selection);
    expect(state.canIndent).toBe(true);
    expect(state.canOutdent).toBe(true);
    // A plain paragraph can move in from the margin, but has nowhere to go back to.
    s.select(caret(a.id, 0));
    expect(selectionState(s.state, s.selection).canIndent).toBe(true);
    expect(selectionState(s.state, s.selection).canOutdent).toBe(false);
  });

  it("reflects pending marks at a caret", () => {
    const p = paragraph("ab");
    const s = setup([p], caret(p.id, 1));
    s.toggleMark("underline");
    expect(selectionState(s.state, s.selection, s.pendingMarks).marks.underline).toBe(true);
  });
});

describe("clipboard slices", () => {
  it("slices partial first and last blocks and keeps formatting", () => {
    const a = paragraph(["one ", bold("two")]);
    const b = paragraph("three");
    const s = setup([a, b], range(a, 2, b, 3));
    const slice = sliceSelection(s.state, s.selection!);
    expect(slice.blocks).toHaveLength(2);
    expect(slice.blocks[0]).toMatchObject({ runs: [{ text: "e " }, { text: "two", marks: { bold: true } }] });
    expect(selectionToPlainText(s.state, s.selection!)).toBe("e two\nthr");
  });

  it("is empty for a caret", () => {
    const p = paragraph("x");
    const s = setup([p], caret(p.id, 0));
    expect(sliceSelection(s.state, s.selection!).blocks).toEqual([]);
  });
});

describe("soft line breaks in Markdown", () => {
  it("writes a hard break and indents list continuations", () => {
    const md = toMarkdown(
      createDoc("T", [paragraph("a\nb"), listItem("bullet", "c\nd")]),
    );
    expect(md).toBe("a  \nb\n\n- c  \n  d\n");
  });
});

describe("typing runs", () => {
  afterEach(() => vi.useRealTimers());

  const type = (s: DocumentSession, text: string) => [...text].forEach((ch) => s.typeText(ch));

  it("undoes a burst of typing in one step, and restores the caret", () => {
    vi.useFakeTimers();
    const p = paragraph("");
    const s = setup([p], caret(p.id, 0));
    type(s, "hello");
    vi.advanceTimersByTime(300);
    type(s, " world");
    expect(outline(s)).toEqual(["paragraph:hello world"]);

    s.undo();
    expect(outline(s)).toEqual(["paragraph:"]);
    expect(s.selection).toEqual(caret(p.id, 0));
    s.redo();
    expect(outline(s)).toEqual(["paragraph:hello world"]);
    expect(s.selection).toEqual(caret(p.id, 11));
  });

  it("starts a new step after a pause", () => {
    vi.useFakeTimers();
    const p = paragraph("");
    const s = setup([p], caret(p.id, 0));
    type(s, "one");
    vi.advanceTimersByTime(1500);
    type(s, " two");
    s.undo();
    expect(outline(s)).toEqual(["paragraph:one"]);
  });

  it("starts a new step when the caret moves or a different action happens", () => {
    vi.useFakeTimers();
    const p = paragraph("");
    const s = setup([p], caret(p.id, 0));
    type(s, "ab");
    s.select(caret(p.id, 0));
    type(s, "c");
    s.undo();
    expect(outline(s)).toEqual(["paragraph:ab"]);

    type(s, "d");
    s.splitBlock();
    type(s, "e");
    s.undo();
    // Undo put the caret back at the start, so "d" went there, Enter split after it, and undoing
    // "e" left that split alone.
    expect(outline(s)).toEqual(["paragraph:d", "paragraph:ab"]);
  });

  it("groups repeated backspaces separately from typing", () => {
    vi.useFakeTimers();
    const p = paragraph("abcdef");
    const s = setup([p], caret(p.id, 6));
    s.backspace();
    s.backspace();
    s.backspace();
    s.typeText("X");
    expect(outline(s)).toEqual(["paragraph:abcX"]);
    s.undo();
    expect(outline(s)).toEqual(["paragraph:abc"]);
    s.undo();
    expect(outline(s)).toEqual(["paragraph:abcdef"]);
  });

  it("does not merge a keystroke that replaces a selection into earlier typing", () => {
    vi.useFakeTimers();
    const p = paragraph("abc");
    const s = setup([p], caret(p.id, 3));
    s.typeText("d");
    s.select(range(p, 0, p, 2));
    s.typeText("X");
    s.undo();
    expect(outline(s)).toEqual(["paragraph:abcd"]);
  });
});
