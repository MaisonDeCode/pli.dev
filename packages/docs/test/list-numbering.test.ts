import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DocumentSession,
  createDoc,
  fromDocx,
  suggestionsIn,
  htmlToFragment,
  listItem,
  listLabels,
  numberText,
  paragraph,
  selectionState,
  toDocx,
  toHtml,
  toMarkdown,
  validateDoc,
  type Block,
  type ListItemBlock,
} from "../src";

const item = (list: "bullet" | "ordered", text: string, extra: Partial<ListItemBlock> = {}, depth = 0): ListItemBlock => ({ ...listItem(list, text, depth), ...extra });
const labels = (blocks: Block[]) => listLabels(blocks).map((l) => l?.text);

describe("how numbers are written", () => {
  it("counts in letters and roman numerals", () => {
    expect(numberText(3, "decimal")).toBe("3");
    expect(numberText(27, "lower-alpha")).toBe("aa");
    expect(numberText(2, "upper-alpha")).toBe("B");
    expect(numberText(4, "lower-roman")).toBe("iv");
    expect(numberText(1994, "upper-roman")).toBe("MCMXCIV");
    expect(numberText(0, "upper-roman")).toBe("0");
  });
});

describe("the markers of a list", () => {
  it("goes 1. a. i. by depth, and carries on after a deeper item", () => {
    const blocks = [item("ordered", "a"), item("ordered", "b", {}, 1), item("ordered", "c", {}, 1), item("ordered", "d", {}, 2), item("ordered", "e")];
    expect(labels(blocks)).toEqual(["1.", "a.", "b.", "i.", "2."]);
  });

  it("starts at the number an item says and counts on from it", () => {
    const blocks = [item("ordered", "a"), item("ordered", "b"), item("ordered", "c", { start: 7 }), item("ordered", "d"), paragraph("x") as Block, item("ordered", "e")];
    expect(labels(blocks)).toEqual(["1.", "2.", "7.", "8.", undefined, "1."]);
  });

  it("uses the style an item names, and ignores one of the wrong kind", () => {
    const blocks = [item("ordered", "a", { marker: "upper-roman" }), item("ordered", "b", { marker: "upper-roman" }), item("bullet", "c", { marker: "square" }), item("bullet", "d", { marker: "decimal" as never })];
    expect(labels(blocks)).toEqual(["I.", "II.", "▪", "•"]);
  });
});

describe("changing a list", () => {
  const open = (blocks: Block[]) => {
    const session = new DocumentSession(createDoc("T", blocks));
    const at = (n: number) => session.state.blocks[n]!.id;
    const place = (n: number) => session.select({ anchor: { block: at(n), offset: 0 }, focus: { block: at(n), offset: 0 } });
    return { session, at, place, labels: () => labels(session.state.blocks) };
  };

  it("restarts numbering at an item, and continues it again", () => {
    const { session, place, labels } = open([item("ordered", "a"), item("ordered", "b"), item("ordered", "c")]);
    place(2);
    expect(session.setListStart(1)).toBe(true);
    expect(labels()).toEqual(["1.", "2.", "1."]);
    expect(session.continueNumbering()).toBe(true);
    expect(labels()).toEqual(["1.", "2.", "3."]);
    expect(session.continueNumbering()).toBe(false);
    session.undo();
    expect(labels()).toEqual(["1.", "2.", "1."]);
  });

  it("starts a list at any number, and says nothing for a first item that starts at 1", () => {
    const { session, place, labels } = open([item("ordered", "a"), item("ordered", "b")]);
    place(0);
    session.setListStart(4);
    expect(labels()).toEqual(["4.", "5."]);
    session.setListStart(1);
    expect((session.state.blocks[0] as ListItemBlock).start).toBeUndefined();
    expect(session.setListStart(-2)).toBe(false);
    expect(session.setListStart(1.5)).toBe(false);
  });

  it("does not number a bulleted item", () => {
    const { session, place } = open([item("bullet", "a")]);
    place(0);
    expect(session.setListStart(3)).toBe(false);
  });

  it("changes the marker of the whole list at that level, and back to the default", () => {
    const { session, place, labels } = open([item("ordered", "a"), item("ordered", "b", {}, 1), item("ordered", "c"), paragraph("x") as Block, item("ordered", "d")]);
    place(0);
    expect(session.setListMarker("upper-roman")).toBe(true);
    expect(labels()).toEqual(["I.", "a.", "II.", undefined, "1."]);
    expect(session.setListMarker("circle")).toBe(false);
    session.setListMarker("decimal");
    expect((session.state.blocks[0] as ListItemBlock).marker).toBeUndefined();
    expect(labels()).toEqual(["1.", "a.", "2.", undefined, "1."]);
  });

  it("keeps the style when a numbered list is toggled to numbered again, and drops it for bullets", () => {
    const { session, place } = open([item("ordered", "a", { marker: "upper-alpha", start: 3 })]);
    place(0);
    session.toggleBlockType({ type: "list_item", list: "bullet" });
    expect(session.state.blocks[0]).toMatchObject({ list: "bullet" });
    expect((session.state.blocks[0] as ListItemBlock).marker).toBeUndefined();
    expect((session.state.blocks[0] as ListItemBlock).start).toBeUndefined();
  });

  it("gives the new item from Enter the style and the count, without the start", () => {
    const { session, place, labels } = open([item("ordered", "ab", { marker: "lower-roman", start: 5 })]);
    place(0);
    session.select({ anchor: { block: session.state.blocks[0]!.id, offset: 1 }, focus: { block: session.state.blocks[0]!.id, offset: 1 } });
    session.splitBlock();
    expect(labels()).toEqual(["v.", "vi."]);
  });

  it("reports the item the caret is in", () => {
    const { session, place } = open([item("ordered", "a", { marker: "upper-alpha" }), item("ordered", "b", { marker: "upper-alpha", start: 9 })]);
    place(1);
    expect(selectionState(session.state, session.selection).list).toEqual({ kind: "ordered", marker: "upper-alpha", number: 9, restarts: true });
  });
});

describe("saving a list", () => {
  const blocks = (): Block[] => [
    item("ordered", "one", { marker: "upper-alpha" }),
    item("ordered", "two", { marker: "upper-alpha" }),
    paragraph("between"),
    item("ordered", "three", { marker: "upper-alpha", start: 3 }),
    item("ordered", "four", { marker: "upper-alpha" }),
    item("ordered", "five", { marker: "upper-alpha", start: 1 }),
    item("ordered", "six", { marker: "upper-alpha" }, 0),
    item("bullet", "dot", { marker: "square" }),
  ];

  it("is valid JSON of a document, and refuses a start on a bullet or a marker of the wrong kind", () => {
    expect(() => validateDoc(createDoc("T", blocks()))).not.toThrow();
    expect(() => validateDoc(createDoc("T", [item("bullet", "a", { start: 2 })]))).toThrow(/start/);
    expect(() => validateDoc(createDoc("T", [item("ordered", "a", { marker: "disc" })]))).toThrow(/marker/);
    expect(() => validateDoc(createDoc("T", [item("ordered", "a", { start: 1e9 })]))).toThrow(/start/);
  });

  it("comes back from DOCX with the same markers and the same numbers", () => {
    const doc = createDoc("T", blocks());
    const back = fromDocx(toDocx(doc)).doc;
    expect(labels(back.blocks)).toEqual(labels(doc.blocks));
  });

  it("keeps depth styles and a restart inside nested lists", () => {
    const doc = createDoc("T", [
      item("ordered", "a"),
      item("ordered", "b", {}, 1),
      item("ordered", "c", { start: 5 }, 1),
      item("ordered", "d"),
      item("ordered", "e", {}, 1),
    ]);
    const back = fromDocx(toDocx(doc)).doc;
    expect(labels(back.blocks)).toEqual(labels(doc.blocks));
    expect(labels(back.blocks)).toEqual(["1.", "a.", "e.", "2.", "a."]);
  });

  it("writes HTML a browser numbers the same way", () => {
    const html = toHtml(createDoc("T", blocks()));
    expect(html).toContain('<ol style="list-style-type:upper-alpha">');
    expect(html).toContain('<ol start="3" style="list-style-type:upper-alpha">');
    const again = htmlToFragment(html).blocks;
    expect(labels(again)).toEqual(labels(blocks()));
  });

  it("writes Markdown with the numbers the list shows", () => {
    const md = toMarkdown(createDoc("T", [item("ordered", "a", { start: 4 }), item("ordered", "b")]));
    expect(md).toBe("4. a\n5. b\n");
  });
});

describe("pasting a list", () => {
  const li = (text: string, style = "") => `<li dir="ltr" aria-level="1" style="list-style-type:${style || "decimal"}"><p dir="ltr" role="presentation">${text}</p></li>`;
  const paste = (html: string) => htmlToFragment(html).blocks;

  it("keeps a list that Google Docs writes as separate lists with a start and a style on each item", () => {
    const blocks = paste(`<b id="docs-internal-guid-1"><ol>${li("One", "upper-roman")}</ol><p>Between</p><ol start="2">${li("Two", "upper-roman")}</ol></b>`);
    expect(labels(blocks)).toEqual(["I.", undefined, "II."]);
    expect((blocks[2] as ListItemBlock).start).toBe(2);
  });

  it("reads the start, the type and the style of an ordinary list", () => {
    expect(labels(paste('<ol start="5" type="a"><li>x</li><li>y</li><li value="1">z</li><li>w</li></ol>'))).toEqual(["e.", "f.", "a.", "b."]);
    expect(labels(paste('<ol style="list-style-type:upper-alpha"><li>x</li><li>y</li></ol>'))).toEqual(["A.", "B."]);
    expect(labels(paste("<ul style='list-style-type:square'><li>x</li></ul>"))).toEqual(["▪"]);
  });

  it("does not carry one list's count into a list that follows it", () => {
    expect(labels(paste("<ol><li>a</li><li>b</li></ol><ol><li>c</li><li>d</li></ol>"))).toEqual(["1.", "2.", "1.", "2."]);
  });

  it("says nothing extra for a plain numbered list", () => {
    const blocks = paste("<ol><li>a</li><li>b</li></ol>") as ListItemBlock[];
    expect(blocks.every((b) => b.start === undefined && b.marker === undefined)).toBe(true);
  });

  it("reads the label of a Word list for its style and its number", () => {
    const word = (label: string, text: string) => `<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${label}<span>&nbsp;</span></span>${text}</p>`;
    expect(labels(paste(word("iii.", "x") + word("iv.", "y")))).toEqual(["iii.", "iv."]);
    expect(labels(paste(word("B.", "x") + word("C.", "y")))).toEqual(["B.", "C."]);
    expect(labels(paste(word("1.", "x") + word("2.", "y")))).toEqual(["1.", "2."]);
  });
});

describe("a list written by LibreOffice", () => {
  // A file LibreOffice saved from lists with roman numerals, a restart, a start at 7, a count carried on past a paragraph, squares and letters.
  const bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/docx/libreoffice-lists.docx"));

  it("is numbered the way LibreOffice shows it", () => {
    const { doc, warnings } = fromDocx(bytes);
    expect(warnings).toEqual([]);
    const shown = listLabels(doc.blocks).flatMap((l, i) => (l ? [`${l.text} ${(doc.blocks[i] as ListItemBlock).runs.map((r) => r.text).join("")}`] : []));
    expect(shown).toEqual([
      "I. Roman one",
      "II. Roman two",
      "I. Restarted at one",
      "II. Next",
      "7. Starts at seven",
      "8. Eight",
      "a. Nested a",
      "b. Nested b",
      "9. Nine",
      "10. Continues at ten",
      "11. Eleven",
      "▪ Square",
      "▪ Square two",
      "a. Lettered",
      "b. Lettered two",
    ]);
  });
});

describe("a document that Microsoft Word saved", () => {
  // word-input.docx, written by Pli, opened in Word and saved again as word-interop.docx: Word's own way of writing the same document.
  const bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/docx/word-interop.docx"));
  const { doc, warnings } = fromDocx(bytes);
  const text = (b: Block) => ("runs" in b ? b.runs.map((r) => r.text).join("") : "");

  it("is read without a warning, as the application that saved it", () => {
    expect(warnings).toEqual([]);
    expect(strFromBytes(bytes, "docProps/app.xml")).toContain("Microsoft Office Word");
  });

  it("numbers every list the way Word does: levels, carrying on, a start at 7 in capital letters, and a restart", () => {
    const shown = listLabels(doc.blocks).flatMap((l, i) => (l ? [`${l.text} ${text(doc.blocks[i]!)}`] : []));
    expect(shown).toEqual([
      "• First bullet", "◦ Nested bullet", "• Second bullet",
      "1. One", "2. Two", "a. Nested a", "b. Nested b", "3. Three",
      "4. Four (carries on)", "5. Five",
      "G. Seventh letter", "H. Eighth letter",
      "i. First", "ii. Second", "i. Restarted", "ii. Next",
    ]);
  });

  it("keeps the title, quotation, contents list, table, picture, breaks, footnote, header and footer", () => {
    const types = doc.blocks.map((b) => b.type);
    expect(types.slice(0, 3)).toEqual(["title", "subtitle", "toc"]);
    expect(types).toEqual(expect.arrayContaining(["quote", "table", "image", "page_break", "section_break"]));
    const picture = doc.blocks.find((b) => b.type === "image") as unknown as { width: number; height: number; alt?: string };
    expect([picture.width, picture.height, picture.alt]).toEqual([300, 120, "A blue rectangle"]);
    expect(Object.values(doc.footnotes ?? {})).toHaveLength(1);
    expect(doc.header?.map(text)).toEqual(["Pli test document"]);
    expect(doc.footer?.[0]).toMatchObject({ runs: expect.arrayContaining([expect.objectContaining({ marks: { field: "page" } })]) });
  });

  it("keeps the comments Word saved, each with its text, author and time, on the words it covers", () => {
    const threads = Object.values(doc.comments ?? {});
    expect(threads).toHaveLength(3);
    expect(threads.map((t) => t.comments.map((c) => c.body))).toEqual([["Adding a comment"], ["comment"], ["comment"]]);
    expect(threads.every((t) => t.comments.every((c) => !!c.author && c.createdAt > 0))).toBe(true);
    expect(threads.map((t) => t.anchor?.quote)).toEqual(["Text and styles", "has", "After"]);
    expect(fromDocx(bytes).authors).toHaveLength(1);
  });

  it("writes out and reads back the same", () => {
    const again = fromDocx(toDocx(doc)).doc;
    expect(listLabels(again.blocks).map((l) => l?.text)).toEqual(listLabels(doc.blocks).map((l) => l?.text));
    expect(again.blocks.map((b) => b.type)).toEqual(doc.blocks.map((b) => b.type));
  });
});

function strFromBytes(bytes: Uint8Array, name: string): string {
  return new TextDecoder().decode(unzipSync(bytes)[name]!);
}

describe("a Word file with a tracked change", () => {
  // word-interop.docx with Track Changes turned on in Word and one insertion typed.
  const bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/docx/word-tracked.docx"));

  it("keeps the insertion as a suggestion, with its author and time, in the text it was typed in", () => {
    const { doc, warnings, authors } = fromDocx(bytes);
    expect(warnings).toEqual([]);
    expect(authors).toHaveLength(1);
    const suggestions = suggestionsIn(doc);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ kind: "insert", text: "4", by: authors[0]!.id });
    const text = doc.blocks.flatMap((b) => ("runs" in b ? [b.runs.map((r) => r.text).join("")] : []));
    expect(text.some((t) => t.endsWith("New tracked change4"))).toBe(true);
  });

  it("can take the text as it would read with every change accepted", () => {
    const { doc } = fromDocx(bytes, { trackedChanges: "accept" });
    expect(suggestionsIn(doc)).toEqual([]);
    const text = doc.blocks.flatMap((b) => ("runs" in b ? [b.runs.map((r) => r.text).join("")] : []));
    expect(text.some((t) => t.endsWith("New tracked change4"))).toBe(true);
  });
});
