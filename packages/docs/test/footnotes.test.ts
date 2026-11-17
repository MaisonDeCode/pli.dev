import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  DocumentSession,
  FOOTNOTE_CHAR,
  caret,
  createDoc,
  documentStats,
  footnoteIds,
  footnoteNumbers,
  fragmentToJson,
  paragraph,
  parseDoc,
  plainText,
  pruneFootnotes,
  serializeDoc,
  sliceSelection,
  table,
  toDocx,
  toHtml,
  toMarkdown,
  validateDoc,
  type Block,
  type Doc,
  type Run,
  type TableBlock,
} from "../src";

const texts = (s: DocumentSession) => s.state.blocks.map((b) => ("runs" in b ? plainText(b.runs).replaceAll(FOOTNOTE_CHAR, "·") : `<${b.type}>`));
const note = (text: string): Block[] => [paragraph(text)];
const noteText = (s: DocumentSession, id: string) => plainText((s.state.footnotes![id]![0] as unknown as { runs: Run[] }).runs);

/** "Alpha beta gamma" with notes after "Alpha" (a) and "gamma" (c), and one in the next paragraph. */
function sample() {
  const s = new DocumentSession(createDoc("T", [paragraph("Alpha beta gamma"), paragraph("Delta")]));
  const [first, second] = s.state.blocks.map((b) => b.id);
  s.select(caret(second!, 5));
  const d = s.insertFootnote(note("About delta."))!;
  s.select(caret(first!, 16));
  const c = s.insertFootnote(note("About gamma."))!;
  s.select(caret(first!, 5));
  const a = s.insertFootnote(note("About alpha."))!;
  return { s, a, c, d };
}

describe("footnotes in the model", () => {
  it("inserts a reference and its note as one undo step", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("Hello world")]));
    s.select(caret(s.state.blocks[0]!.id, 5));
    const id = s.insertFootnote(note("Hi."))!;
    expect(texts(s)).toEqual(["Hello·  world".replace("  ", " ")]);
    expect(s.state.footnotes![id]).toHaveLength(1);
    expect(s.selection!.focus.offset).toBe(6);
    s.undo();
    expect(texts(s)).toEqual(["Hello world"]);
    expect(s.state.footnotes).toBeUndefined();
    s.redo();
    expect(footnoteIds(s.state.blocks)).toEqual([id]);
  });

  it("numbers notes by where the references are, and renumbers as they move", () => {
    const { s, a, c, d } = sample();
    expect([...footnoteNumbers(s.state)]).toEqual([[a, 1], [c, 2], [d, 3]]);
    // Removing the first reference renumbers the rest.
    s.select({ anchor: { block: s.state.blocks[0]!.id, offset: 5 }, focus: { block: s.state.blocks[0]!.id, offset: 6 } });
    s.deleteSelection();
    expect([...footnoteNumbers(s.state)]).toEqual([[c, 1], [d, 2]]);
  });

  it("keeps a deleted reference's note for undo, and drops it when saving", () => {
    const { s, a } = sample();
    s.select({ anchor: { block: s.state.blocks[0]!.id, offset: 5 }, focus: { block: s.state.blocks[0]!.id, offset: 6 } });
    s.deleteSelection();
    expect(s.state.footnotes![a]).toBeDefined();
    expect(Object.keys(parseDoc(serializeDoc(s.state)).footnotes ?? {})).not.toContain(a);
    s.undo();
    expect(footnoteIds(s.state.blocks)).toContain(a);
    expect(noteText(s, a)).toBe("About alpha.");
  });

  it("does not make typed text a reference, and no reference in a code block", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("ab")]));
    s.select(caret(s.state.blocks[0]!.id, 1));
    s.insertFootnote();
    s.typeText("X");
    const runs = (s.state.blocks[0] as { runs: { text: string; marks?: object }[] }).runs;
    expect(runs.find((r) => r.text.includes("X"))!.marks).toBeUndefined();

    const code = new DocumentSession(createDoc("T", [{ id: "c", type: "code_block", runs: [{ text: "x" }] }]));
    code.select(caret("c", 1));
    expect(code.insertFootnote()).toBeNull();
  });

  it("works inside table cells, in reading order", () => {
    const t = table([["a", "b"]]);
    const s = new DocumentSession(createDoc("T", [paragraph("before"), t, paragraph("after")]));
    const cells = (s.state.blocks[1] as TableBlock).rows[0]!.cells;
    s.select(caret(s.state.blocks[2]!.id, 5));
    const last = s.insertFootnote(note("z"))!;
    s.select(caret(cells[1]!.blocks[0]!.id, 1));
    const inCell = s.insertFootnote(note("y"))!;
    expect(footnoteIds(s.state.blocks)).toEqual([inCell, last]);
  });

  it("does not count references as characters", () => {
    const { s } = sample();
    expect(documentStats(s.state).characters).toBe("Alpha beta gamma".length + "Delta".length);
  });
});

describe("saving footnotes", () => {
  it("round-trips", () => {
    const { s } = sample();
    expect(parseDoc(serializeDoc(s.state))).toEqual(s.state);
  });

  it("rejects a reference with no note, an empty note, and what a note can't hold", () => {
    const { s, a } = sample();
    const dangling = { ...s.state, footnotes: { ...s.state.footnotes } } as Doc;
    delete dangling.footnotes![a];
    expect(() => validateDoc(dangling)).toThrow(/has no note/);
    expect(() => validateDoc({ ...s.state, footnotes: { ...s.state.footnotes, [a]: [] } })).toThrow(/at least one block/);
    expect(() => validateDoc({ ...s.state, footnotes: { ...s.state.footnotes, [a]: [{ id: "x", type: "divider" }] } })).toThrow(/can't hold a divider/);
    expect(() => validateDoc({ ...s.state, footnotes: { ...s.state.footnotes, [a]: [{ id: "x", type: "table", rows: [], columns: [] }] } })).toThrow();
  });

  it("prunes notes nothing refers to, and leaves the document alone when all are used", () => {
    const { s } = sample();
    expect(pruneFootnotes(s.state)).toBe(s.state);
    const bare = { ...createDoc("T", [paragraph("x")]), footnotes: { gone: note("n") } };
    expect(pruneFootnotes(bare).footnotes).toBeUndefined();
  });
});

describe("copying and pasting footnotes", () => {
  it("copies the notes a selection refers to, and only those", () => {
    const { s, a, c } = sample();
    const first = s.state.blocks[0]!.id;
    const slice = sliceSelection(s.state, { anchor: { block: first, offset: 0 }, focus: { block: first, offset: 18 } });
    expect(Object.keys(slice.footnotes!).sort()).toEqual([a, c].sort());
  });

  it("pastes with new notes of their own, so editing one doesn't change the other", () => {
    const { s, a } = sample();
    const first = s.state.blocks[0]!.id;
    const second = s.state.blocks[1]!.id;
    const slice = sliceSelection(s.state, { anchor: { block: first, offset: 0 }, focus: { block: first, offset: 6 } });
    s.select(caret(second, 0));
    s.paste({ fragment: fragmentToJson(slice.blocks, slice.footnotes) });
    const ids = footnoteIds(s.state.blocks);
    expect(ids).toHaveLength(4);
    const copy = ids.find((id) => id !== a && noteText(s, id) === "About alpha.")!;
    expect(copy).toBeDefined();
    s.setFootnote(copy, note("Changed."));
    expect(noteText(s, a)).toBe("About alpha.");
    s.undo();
    s.undo();
    expect(footnoteIds(s.state.blocks)).toHaveLength(3);
  });

  it("puts no reference characters in copied plain text", () => {
    const { s } = sample();
    const first = s.state.blocks[0]!.id;
    s.select({ anchor: { block: first, offset: 0 }, focus: { block: first, offset: 18 } });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return import("../src").then(({ selectionToPlainText }) => {
      expect(selectionToPlainText(s.state, s.selection!)).toBe("Alpha beta gamma");
    });
  });
});

describe("exporting footnotes", () => {
  it("HTML: numbered references with links, and the notes after the body", () => {
    const { s } = sample();
    const html = toHtml(s.state);
    expect(html).toContain('<sup class="footnote-ref"><a href="#fn-1" id="fnref-1">1</a></sup>');
    expect(html).toContain('<sup class="footnote-ref"><a href="#fn-3" id="fnref-3">3</a></sup>');
    expect(html).toContain('<li id="fn-1"><p>About alpha.</p>');
    expect(html.indexOf("fn-1")).toBeLessThan(html.indexOf("fn-2"));
    expect(html).not.toContain(FOOTNOTE_CHAR);
  });

  it("Markdown: [^n] references and definitions", () => {
    const { s } = sample();
    const md = toMarkdown(s.state);
    expect(md).toContain("Alpha[^1] beta gamma[^2]");
    expect(md).toContain("Delta[^3]");
    expect(md).toContain("[^1]: About alpha.");
    expect(md).toContain("[^3]: About delta.");
  });

  it("Markdown: a note's later paragraphs are indented", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("x")]));
    s.select(caret(s.state.blocks[0]!.id, 1));
    s.insertFootnote([paragraph("one"), paragraph("two")]);
    expect(toMarkdown(s.state)).toContain("[^1]: one\n\n    two");
  });

  const unzip = (doc: Doc) => {
    const zip = unzipSync(toDocx(doc));
    return { names: Object.keys(zip), read: (n: string) => strFromU8(zip[n]!) };
  };

  it("Word: real footnotes, with separators, settings, styles and relationships", () => {
    const { s } = sample();
    const { names, read } = unzip(s.state);
    expect(names).toContain("word/footnotes.xml");
    const body = read("word/document.xml");
    expect([...body.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    const notes = read("word/footnotes.xml");
    expect(notes).toContain('w:type="separator" w:id="-1"');
    expect(notes).toContain('w:type="continuationSeparator" w:id="0"');
    expect(notes).toMatch(/<w:footnote w:id="1">.*?<w:footnoteRef\/>.*?About alpha\./s);
    expect(notes).toMatch(/<w:footnote w:id="3">.*?About delta\./s);
    expect(read("word/settings.xml")).toContain('<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>');
    expect(read("word/_rels/document.xml.rels")).toContain("relationships/footnotes");
    expect(read("[Content_Types].xml")).toContain("/word/footnotes.xml");
    expect(read("word/styles.xml")).toContain('w:styleId="FootnoteReference"');
    expect(read("word/styles.xml")).toContain('w:styleId="FootnoteText"');
    expect(body).not.toContain(FOOTNOTE_CHAR);
  });

  it("Word: a document without notes has no footnotes part", () => {
    const { names, read } = unzip(createDoc("T", [paragraph("plain")]));
    expect(names).not.toContain("word/footnotes.xml");
    // The settings part is always there, but has nothing about notes.
    expect(read("word/settings.xml")).not.toContain("footnotePr");
    expect(read("[Content_Types].xml")).not.toContain("footnotes");
  });

  it("Word: links inside a note get their own relationships", () => {
    const s = new DocumentSession(createDoc("T", [paragraph("x")]));
    s.select(caret(s.state.blocks[0]!.id, 1));
    s.insertFootnote([paragraph([{ text: "site", marks: { link: "https://example.com" } }] as never)]);
    const { read } = unzip(s.state);
    expect(read("word/_rels/footnotes.xml.rels")).toContain("https://example.com");
  });
});
