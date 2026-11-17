import { beforeEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "@pli.dev/core";
import {
  DocumentSession,
  FRAGMENT_MIME,
  bold,
  caret,
  cloneBlocks,
  createDoc,
  fragmentToJson,
  heading,
  htmlToFragment,
  listItem,
  paragraph,
  parseFragmentJson,
  parseTabSeparated,
  plainText,
  readPaste,
  selectionToPlainText,
  sliceSelection,
  table,
  validateDoc,
  type Block,
  type Doc,
  type Selection,
  type TableBlock,
} from "../src";
import { checkGrid } from "../src/grid";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

const range = (a: string, ao: number, b: string, bo: number): Selection => ({ anchor: { block: a, offset: ao }, focus: { block: b, offset: bo } });
const textOf = (b: Block) => ("runs" in b ? plainText(b.runs) : `<${b.type}>`);
const lines = (doc: Doc) => doc.blocks.map((b) => (b.type === "table" ? "<table>" : textOf(b)));
const tbl = (s: DocumentSession) => s.state.blocks.find((b) => b.type === "table") as TableBlock;
const at = (t: TableBlock, r: number, c: number) => t.rows[r]!.cells[c]!.blocks[0]!.id;
const grid = (t: TableBlock) => t.rows.map((r) => r.cells.map((c) => (c.covered ? "·" : c.blocks.map(textOf).join("+"))).join(" | "));

function doc(...blocks: Block[]): { session: DocumentSession; ids: string[] } {
  const session = new DocumentSession(createDoc("T", blocks));
  return { session, ids: blocks.map((b) => b.id) };
}

describe("pasting text blocks", () => {
  it("pastes one block inline, into the text at the caret", () => {
    const { session, ids } = doc(paragraph("hello world"));
    session.select(caret(ids[0]!, 6));
    session.paste({ html: "big <b>bold</b> " });
    expect(lines(session.state)).toEqual(["hello big bold world"]);
    expect(session.selection!.focus.offset).toBe(6 + "big bold ".length);
    session.undo();
    expect(lines(session.state)).toEqual(["hello world"]);
  });

  it("drops the space at the end of a pasted paragraph, as HTML shows it, but keeps it in an inline selection", () => {
    const a = doc(paragraph("ab"));
    a.session.select(caret(a.ids[0]!, 1));
    a.session.paste({ html: "<p>x </p>" });
    expect(lines(a.session.state)).toEqual(["axb"]);
  });

  it("keeps formatting from the pasted text", () => {
    const { session, ids } = doc(paragraph("ab"));
    session.select(caret(ids[0]!, 1));
    session.paste({ html: '<span style="font-weight:700;color:#ff0000">X</span>' });
    const block = session.state.blocks[0] as { runs: { text: string; marks?: object }[] };
    expect(block.runs.find((r) => r.text === "X")!.marks).toEqual({ bold: true, color: "#ff0000" });
  });

  it("replaces the selection", () => {
    const { session, ids } = doc(paragraph("hello world"));
    session.select(range(ids[0]!, 0, ids[0]!, 5));
    session.paste({ text: "bye" });
    expect(lines(session.state)).toEqual(["bye world"]);
  });

  it("splits the paragraph for several blocks: first joins before, last joins after", () => {
    const { session, ids } = doc(paragraph("abcd"));
    session.select(caret(ids[0]!, 2));
    session.paste({ html: "<p>X</p><h2>Mid</h2><p>Y</p>" });
    expect(session.state.blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "paragraph"]);
    expect(lines(session.state)).toEqual(["abX", "Mid", "Ycd"]);
    expect(session.selection!.focus).toEqual({ block: session.state.blocks[2]!.id, offset: 1 });
    session.undo();
    expect(lines(session.state)).toEqual(["abcd"]);
    session.redo();
    expect(lines(session.state)).toEqual(["abX", "Mid", "Ycd"]);
  });

  it("at the start of a block, nothing joins before it", () => {
    const { session, ids } = doc(paragraph("tail"));
    session.select(caret(ids[0]!, 0));
    session.paste({ html: "<h1>Head</h1><p>one</p>" });
    expect(session.state.blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(lines(session.state)).toEqual(["Head", "onetail"]);
  });

  it("at the end of a block, nothing joins after it", () => {
    const { session, ids } = doc(paragraph("head"));
    session.select(caret(ids[0]!, 4));
    session.paste({ html: "<p>one</p><p>two</p>" });
    expect(lines(session.state)).toEqual(["headone", "two"]);
    expect(session.selection!.focus.offset).toBe(3);
  });

  it("lets an empty paragraph take the kind of a single pasted heading or list item", () => {
    const a = doc(paragraph(""));
    a.session.select(caret(a.ids[0]!, 0));
    a.session.paste({ html: "<h2>Title</h2>" });
    expect(a.session.state.blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(a.session.state.blocks).toHaveLength(1);

    const b = doc(listItem("bullet", ""));
    b.session.select(caret(b.ids[0]!, 0));
    b.session.paste({ html: "<p>plain</p>" });
    expect(b.session.state.blocks[0]).toMatchObject({ type: "list_item" });
    expect(textOf(b.session.state.blocks[0]!)).toBe("plain");
  });

  it("puts a pasted image between the halves and leaves room to type", () => {
    const { session, ids } = doc(paragraph("abcd"));
    session.select(caret(ids[0]!, 2));
    session.paste({ html: '<p>x</p><img src="https://x.dev/i.png" width="10" height="10">' });
    expect(session.state.blocks.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(lines(session.state)).toEqual(["abx", "<image>", "cd"]);
    expect(session.selection!.focus).toEqual({ block: session.state.blocks[2]!.id, offset: 0 });
  });

  it("reports images whose size is unknown", () => {
    const { session, ids } = doc(paragraph("a"));
    session.select(caret(ids[0]!, 1));
    const result = session.paste({ html: '<img src="https://x.dev/i.png">' });
    expect(result.applied).toBe(true);
    const image = session.state.blocks.find((b) => b.type === "image")!;
    expect(result.unsizedImages).toEqual([image.id]);
  });

  it("pastes plain text lines as paragraphs", () => {
    const { session, ids } = doc(paragraph("ab"));
    session.select(caret(ids[0]!, 1));
    session.paste({ text: "x\ny" });
    expect(lines(session.state)).toEqual(["ax", "yb"]);
  });

  it("Ctrl+Shift+V pastes only the text", () => {
    const { session, ids } = doc(paragraph(""));
    session.select(caret(ids[0]!, 0));
    session.paste({ html: "<h1>Rich</h1>", text: "Rich", plain: true });
    expect(session.state.blocks[0]!.type).toBe("paragraph");
    expect(textOf(session.state.blocks[0]!)).toBe("Rich");
  });

  it("does nothing for an empty clipboard", () => {
    const { session, ids } = doc(paragraph("a"));
    session.select(caret(ids[0]!, 0));
    expect(session.paste({}).applied).toBe(false);
    expect(session.paste({ html: "   ", text: "" }).applied).toBe(false);
    expect(session.paste({ html: "<script>x</script>" }).applied).toBe(false);
  });

  it("is one undo step", () => {
    const { session, ids } = doc(paragraph("abcd"));
    session.select(range(ids[0]!, 1, ids[0]!, 3));
    session.paste({ html: "<p>1</p><p>2</p><p>3</p>" });
    expect(session.state.blocks).toHaveLength(3);
    session.undo();
    expect(lines(session.state)).toEqual(["abcd"]);
    expect(session.undo()).toBe(false);
  });
});

describe("pasting a table", () => {
  const html = "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>";

  it("inserts a web table as a real table", () => {
    const { session, ids } = doc(paragraph("before"), paragraph("after"));
    session.select(caret(ids[0]!, 6));
    session.paste({ html });
    expect(session.state.blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(grid(tbl(session))).toEqual(["a | b", "c | d"]);
    expect(validateDoc(session.state)).toBeTruthy();
  });

  it("turns a spreadsheet range (tab-separated text) into a table", () => {
    const { session, ids } = doc(paragraph(""));
    session.select(caret(ids[0]!, 0));
    session.paste({ text: "Item\tQty\nPens\t4\nInk\t2\n" });
    expect(grid(tbl(session))).toEqual(["Item | Qty", "Pens | 4", "Ink | 2"]);
    session.undo();
    expect(session.state.blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("fills cells from the caret's cell and grows the table", () => {
    const t = table([["1", "2"], ["3", "4"]]);
    const { session } = doc(paragraph("p"), t);
    const cells = tbl(session);
    session.select(caret(at(cells, 1, 1), 0));
    session.paste({ text: "a\tb\nc\td" });
    const after = tbl(session);
    expect(grid(after)).toEqual(["1 | 2 | ", "3 | a | b", " | c | d"]);
    expect(checkGrid(after)).toBeNull();
    expect(after.id).toBe(cells.id);
    // The pasted range is selected, so it can be copied, shaded or cleared.
    expect(session.selection!.anchor.block).toBe(at(after, 1, 1));
    expect(session.selection!.focus.block).toBe(at(after, 2, 2));
    session.undo();
    expect(grid(tbl(session))).toEqual(["1 | 2", "3 | 4"]);
  });

  it("starts at the top-left of selected cells", () => {
    const { session } = doc(table([["1", "2", "3"], ["4", "5", "6"]]));
    const cells = tbl(session);
    session.select(range(at(cells, 0, 1), 0, at(cells, 1, 2), 0));
    session.paste({ text: "x\ty\nz\tw" });
    expect(grid(tbl(session))).toEqual(["1 | x | y", "4 | z | w"]);
  });

  it("keeps formatting and spans of the pasted table", () => {
    const { session } = doc(table([["", ""], ["", ""], ["", ""]]));
    const cells = tbl(session);
    session.select(caret(at(cells, 0, 0), 0));
    session.paste({ html: '<table><tr><td colspan=2 style="background:#ffe699"><b>wide</b></td></tr><tr><td>l</td><td>r</td></tr></table>' });
    const after = tbl(session);
    expect(after.rows[0]!.cells[0]!.colSpan).toBe(2);
    expect(after.rows[0]!.cells[1]!.covered).toBe(true);
    expect(after.rows[0]!.cells[0]!.shade).toBe("#ffe699");
    expect(checkGrid(after)).toBeNull();
  });

  it("becomes lines of text when it can't fill cells (merged target)", () => {
    const { session } = doc(table([["a", "b"], ["c", "d"]]));
    const cells = tbl(session);
    session.select(range(at(cells, 0, 0), 0, at(cells, 0, 1), 0));
    session.mergeCells();
    const merged = tbl(session);
    session.select(caret(at(merged, 0, 0), 0));
    session.paste({ text: "x\ty\nz\tw" });
    const after = tbl(session);
    expect(checkGrid(after)).toBeNull();
    expect(after.rows[0]!.cells[0]!.blocks.map(textOf)).toContain("x\ty");
  });

  it("turns a table into text inside a cell that isn't being filled", () => {
    const { session } = doc(table([["a"]]), paragraph("p"));
    const cells = tbl(session);
    session.select(caret(at(cells, 0, 0), 1));
    // Text before the table, so it is not a lone table: it is spliced in as blocks.
    session.paste({ html: `<p>lead</p>${"<table><tr><td>1</td><td>2</td></tr></table>"}` });
    const after = tbl(session);
    expect(after.rows[0]!.cells[0]!.blocks.every((b) => b.type !== "table" as string)).toBe(true);
    expect(after.rows[0]!.cells[0]!.blocks.map(textOf).join("|")).toBe("alead|1\t2");
  });

  it("never pastes a table into a table", () => {
    const { session } = doc(table([["a", "b"], ["c", "d"]]));
    const cells = tbl(session);
    session.select(caret(at(cells, 0, 0), 0));
    session.paste({ html: "<p>x</p><table><tr><td>1</td></tr></table>" });
    for (const block of session.state.blocks) {
      if (block.type !== "table") continue;
      for (const row of block.rows) for (const cell of row.cells) expect(cell.blocks.every((b) => (b.type as string) !== "table")).toBe(true);
    }
    expect(validateDoc(session.state)).toBeTruthy();
  });
});

describe("copy slices", () => {
  const setup = () => {
    const { session } = doc(paragraph("before"), table([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]], { headerRow: true }), paragraph("after"));
    return { session, t: tbl(session) };
  };

  it("copies a dragged rectangle of cells as a table of just those cells", () => {
    const { session, t } = setup();
    const slice = sliceSelection(session.state, range(at(t, 1, 1), 0, at(t, 2, 2), 0));
    expect(slice.blocks).toHaveLength(1);
    const copy = slice.blocks[0] as TableBlock;
    expect(grid(copy)).toEqual(["e | f", "h | i"]);
    expect(copy.headerRow).toBeUndefined();
    expect(copy.columns).toHaveLength(2);
    expect(copy.columns.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(selectionToPlainText(session.state, range(at(t, 1, 1), 0, at(t, 2, 2), 0))).toBe("e\tf\nh\ti");
  });

  it("keeps the header row when the rectangle starts at the top", () => {
    const { session, t } = setup();
    const copy = sliceSelection(session.state, range(at(t, 0, 0), 0, at(t, 1, 1), 0)).blocks[0] as TableBlock;
    expect(copy.headerRow).toBe(true);
  });

  it("keeps a whole table that the range covers, and text around it", () => {
    const { session } = setup();
    const first = session.state.blocks[0]!;
    const last = session.state.blocks[2]!;
    const slice = sliceSelection(session.state, range(first.id, 2, last.id, 3));
    expect(slice.blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(lines(slice)).toEqual(["fore", "<table>", "aft"]);
    expect(selectionToPlainText(session.state, range(first.id, 2, last.id, 3))).toBe("fore\na\tb\tc\nd\te\tf\ng\th\ti\naft");
  });

  it("gives plain blocks when only part of a table is in range", () => {
    const { session, t } = setup();
    const first = session.state.blocks[0]!;
    const slice = sliceSelection(session.state, range(first.id, 0, at(t, 0, 1), 1));
    expect(slice.blocks.some((b) => b.type === "table")).toBe(false);
  });

  it("quotes cells with tabs or line breaks, like a spreadsheet", () => {
    const { session } = doc(table([["a\tb", "c"], ["d", "x"]]));
    const t = tbl(session);
    session.select(range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    expect(selectionToPlainText(session.state, session.selection!)).toBe('"a\tb"\tc\nd\tx');
  });

  it("round-trips through the fragment format, ids and all", () => {
    const { session, t } = setup();
    const slice = sliceSelection(session.state, range(at(t, 0, 0), 0, at(t, 1, 1), 0));
    const json = fragmentToJson(slice.blocks);
    expect(parseFragmentJson(json)).toEqual(slice.blocks);
  });

  it("copy then paste within one document makes new ids and a real copy", () => {
    const { session, ids } = doc(paragraph("one"), paragraph("two"));
    const slice = sliceSelection(session.state, range(ids[0]!, 0, ids[0]!, 3));
    session.select(caret(ids[1]!, 3));
    session.paste({ fragment: fragmentToJson(slice.blocks) });
    expect(lines(session.state)).toEqual(["one", "twoone"]);
    session.paste({ fragment: fragmentToJson(sliceSelection(session.state, range(session.state.blocks[0]!.id, 0, session.state.blocks[1]!.id, 6)).blocks) });
    expect(validateDoc(session.state)).toBeTruthy();
  });
});

describe("tab-separated text", () => {
  it("reads rows and columns", () => {
    const t = parseTabSeparated("a\tb\nc\td\n")!;
    expect(grid(t)).toEqual(["a | b", "c | d"]);
  });

  it("reads quoted fields with tabs, newlines and quotes", () => {
    const t = parseTabSeparated('"x\ty"\t"line1\nline2"\n"say ""hi"""\tz')!;
    expect(t.rows[0]!.cells[0]!.blocks.map(textOf)).toEqual(["x\ty"]);
    expect(t.rows[0]!.cells[1]!.blocks.map(textOf)).toEqual(["line1", "line2"]);
    expect(t.rows[1]!.cells[0]!.blocks.map(textOf)).toEqual(['say "hi"']);
  });

  it("handles Windows line endings and empty cells", () => {
    const t = parseTabSeparated("a\t\r\n\tb\r\n")!;
    expect(grid(t)).toEqual(["a | ", " | b"]);
  });

  it("is not a table when it is ragged, one row, or one column", () => {
    expect(parseTabSeparated("a\tb\nc")).toBeNull();
    expect(parseTabSeparated("a\tb")).toBeNull();
    expect(parseTabSeparated("a\nb")).toBeNull();
    expect(parseTabSeparated("plain text")).toBeNull();
    expect(parseTabSeparated("")).toBeNull();
    expect(parseTabSeparated("\tx\n\ty")).not.toBeNull();
  });

  it("refuses huge ranges", () => {
    expect(parseTabSeparated(Array.from({ length: 600 }, () => "a\tb").join("\n"))).toBeNull();
    expect(parseTabSeparated(Array.from({ length: 2 }, () => Array.from({ length: 60 }, () => "a").join("\t")).join("\n"))).toBeNull();
  });
});

describe("readPaste", () => {
  it("prefers the fragment, then HTML, then a table from text, then text", () => {
    const fragment = fragmentToJson([paragraph("frag")]);
    expect(readPaste({ fragment, html: "<p>html</p>", text: "text" })).toMatchObject({ source: "fragment" });
    expect(readPaste({ html: "<p>html</p>", text: "text" })).toMatchObject({ source: "html" });
    expect(readPaste({ text: "a\tb\nc\td" })).toMatchObject({ source: "table" });
    expect(readPaste({ text: "text" })).toEqual({ source: "text", text: "text" });
    expect(readPaste({ plain: true, html: "<p>x</p>", text: "a\tb\nc\td" })).toEqual({ source: "text", text: "a\tb\nc\td" });
  });

  it("falls through a bad fragment", () => {
    expect(readPaste({ fragment: "{not json", text: "hi" })).toEqual({ source: "text", text: "hi" });
    expect(readPaste({ fragment: JSON.stringify({ format: "pli.doc", version: 1, doc: { blocks: [{ type: "evil" }] } }), text: "hi" })).toEqual({ source: "text", text: "hi" });
  });

  it("exports the MIME type", () => {
    expect(FRAGMENT_MIME).toBe("application/x-pli-fragment");
  });
});

describe("safety", () => {
  it("never lets script, handlers, or javascript: links through", () => {
    const hostile =
      '<p onclick="x()">hi <a href="javascript:alert(1)" onmouseover="y()">l</a><script>z()</script><img src="x" onerror="w()"><iframe src="https://evil"></iframe></p>';
    const frag = htmlToFragment(hostile);
    const json = JSON.stringify(frag.blocks);
    expect(json).not.toMatch(/javascript|onclick|onerror|onmouseover|script|iframe|evil/i);
  });

  it("rejects a fragment with an invalid structure", () => {
    const bad = fragmentToJson([paragraph("ok")]).replace('"paragraph"', '"paragraphs"');
    expect(parseFragmentJson(bad)).toBeNull();
    expect(parseFragmentJson("")).toBeNull();
  });

  it("clones blocks with fresh ids everywhere", () => {
    const t = table([["a"]]);
    const [copy] = cloneBlocks([t]) as TableBlock[];
    expect(copy!.id).not.toBe(t.id);
    expect(copy!.rows[0]!.id).not.toBe(t.rows[0]!.id);
    expect(copy!.rows[0]!.cells[0]!.id).not.toBe(t.rows[0]!.cells[0]!.id);
    expect(copy!.rows[0]!.cells[0]!.blocks[0]!.id).not.toBe(t.rows[0]!.cells[0]!.blocks[0]!.id);
  });
});

describe("realistic sources", () => {
  it("Google Docs: bold wrapper with normal weight, headings, lists", () => {
    const html = `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc">
      <h1 dir="ltr" style="line-height:1.38;margin-top:20pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;font-weight:400;">Plan</span></h1>
      <p dir="ltr" style="line-height:1.38;"><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;">Bold</span><span style="font-size:11pt;font-family:Arial,sans-serif;"> normal </span><span style="font-size:11pt;font-style:italic;">it</span></p>
      <ul style="margin-top:0;"><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span>One</span></p></li><li dir="ltr" aria-level="2"><p dir="ltr"><span>Sub</span></p></li></ul>
    </b>`;
    const blocks = htmlToFragment(html).blocks;
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list_item", "list_item"]);
    expect(blocks.map(textOf)).toEqual(["Plan", "Bold normal it", "One", "Sub"]);
    const p = blocks[1] as { runs: { text: string; marks?: object }[] };
    expect(p.runs[0]!.marks).toEqual({ bold: true });
    expect(p.runs[2]!.marks).toEqual({ italic: true });
  });

  it("Excel via real paste", () => {
    const html = `<html><body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=128 style='border-collapse:collapse;width:96pt'>
      <col width=64 span=2 style='width:48pt'>
      <tr height=20 style='height:15.0pt'><td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt;font-weight:700'>Name</td><td class=xl65 width=64 style='width:48pt'>Qty</td></tr>
      <tr height=20 style='height:15.0pt'><td height=20 align=right>Pens</td><td align=right x:num>4</td></tr>
    </table><!--EndFragment--></body></html>`;
    const { session, ids } = doc(paragraph(""));
    session.select(caret(ids[0]!, 0));
    session.paste({ html, text: "Name\tQty\nPens\t4\n" });
    const t = tbl(session);
    expect(grid(t)).toEqual(["Name | Qty", "Pens | 4"]);
    expect(t.rows[0]!.height).toBe(15);
    expect((t.rows[0]!.cells[0]!.blocks[0] as { runs: { marks?: object }[] }).runs[0]!.marks).toEqual({ bold: true });
    expect((t.rows[1]!.cells[1]!.blocks[0] as { align?: string }).align).toBe("right");
  });

  it("keeps working after: typing continues in the pasted text", () => {
    const { session, ids } = doc(paragraph("ab"));
    session.select(caret(ids[0]!, 1));
    session.paste({ html: "<p>X</p><p>Y</p>" });
    session.typeText("!");
    expect(lines(session.state)).toEqual(["aX", "Y!b"]);
  });
});

describe("fuzz: any paste into any document stays valid", () => {
  it("pastes random fragments at random places", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const fragments = [
      "<p>one</p>",
      "<p>a</p><p>b</p>",
      "<h1>H</h1><p>x</p>",
      "<ul><li>l1</li><li>l2<ul><li>deep</li></ul></li></ul>",
      "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>",
      "<table><tr><td colspan=2>w</td></tr><tr><td rowspan=2>t</td><td>x</td></tr><tr><td>y</td></tr></table>",
      '<p>t</p><img src="https://x.dev/a.png" width=5 height=5>',
      "<hr><p>after rule</p>",
      "<pre>code\nmore</pre>",
      "<p>text</p><table><tr><td>z</td></tr></table>",
    ];
    const texts = ["plain", "a\nb\nc", "1\t2\n3\t4", "x\ty\nz", "\"q\"\t\"r\ns\"\nu\tv"];
    for (let run = 0; run < 40; run++) {
      const session = new DocumentSession(
        createDoc("F", [
          paragraph("alpha beta"),
          heading(2, "Heading"),
          table([["a", "b"], ["c", "d"]]),
          listItem("bullet", "item"),
          paragraph(""),
          table([["x"]]),
        ]),
      );
      for (let step = 0; step < 25; step++) {
        const flat: { id: string; runs: { text: string }[] }[] = [];
        const visit = (b: Block) => {
          if ("runs" in b) flat.push(b);
          if (b.type === "table") for (const row of b.rows) for (const cell of row.cells) cell.blocks.forEach(visit);
        };
        session.state.blocks.forEach(visit);
        const pick = () => {
          const b = flat[rand(flat.length)]!;
          const len = b.runs.reduce((n, r) => n + r.text.length, 0);
          return { block: b.id, offset: rand(len + 1) };
        };
        session.select(rand(3) === 0 ? { anchor: pick(), focus: pick() } : (() => { const p = pick(); return { anchor: p, focus: p }; })());
        if (rand(2) === 0) session.paste({ html: fragments[rand(fragments.length)]! });
        else session.paste({ text: texts[rand(texts.length)]! });
        expect(() => validateDoc(session.state)).not.toThrow();
        for (const block of session.state.blocks) if (block.type === "table") expect(checkGrid(block)).toBeNull();
        if (rand(5) === 0) session.undo();
      }
      while (session.undo());
      expect(session.state.blocks).toHaveLength(6);
    }
  });
});

void bold;
