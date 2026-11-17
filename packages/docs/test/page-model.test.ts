import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { setIdGenerator } from "@pli.dev/core";
import {
  DEFAULT_PAGE,
  DocumentSession,
  PAGE_SIZES,
  bold,
  caret,
  createDoc,
  divider,
  documentStats,
  findAll,
  heading,
  image,
  link,
  listItem,
  matchSelection,
  pageBreak,
  pageDimensions,
  paragraph,
  parseDoc,
  plainText,
  quote,
  selectionState,
  serializeDoc,
  spaced,
  subtitle,
  text,
  title,
  toDocx,
  toHtml,
  toMarkdown,
  toc,
  validateDoc,
  replaceMatches,
  type Block,
  type Doc,
  type Selection,
} from "../src";

beforeEach(() => {
  let n = 0;
  setIdGenerator(() => String(++n));
});

// A 1x1 transparent PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const runsOf = (b: Block | undefined) => (b && "runs" in b ? b.runs : []);

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

describe("page setup", () => {
  it("sizes pages with orientation applied", () => {
    expect(pageDimensions(DEFAULT_PAGE)).toEqual({ width: 8.5, height: 11 });
    expect(pageDimensions({ ...DEFAULT_PAGE, orientation: "landscape" })).toEqual({ width: 11, height: 8.5 });
    expect(PAGE_SIZES.a4.width).toBeCloseTo(8.27);
  });

  it("sets and undoes page setup and regions", () => {
    const p = paragraph("x");
    const s = setup([p], caret(p.id, 0));
    const a4 = { ...DEFAULT_PAGE, size: "a4" as const };
    s.setPage(a4);
    expect(s.state.page).toEqual(a4);
    s.setRegion("header", [paragraph("Header")]);
    s.setRegion("footer", [paragraph("Footer")]);
    expect(s.state.header).toHaveLength(1);

    s.undo();
    s.undo();
    s.undo();
    expect(s.state.page).toBeUndefined();
    expect(s.state.header).toBeUndefined();
    expect(s.state.footer).toBeUndefined();
  });
});

describe("new blocks and fonts", () => {
  it("inserts an image after the caret block and puts the caret in a following paragraph", () => {
    const p = paragraph("hello");
    const s = setup([p], caret(p.id, 5));
    const img = image(PNG, { width: 100, height: 50 });
    s.insertBlockAtCaret(img);
    expect(outline(s)).toEqual(["paragraph:hello", "image", "paragraph:"]);
    expect(s.selection!.focus.block).toBe(s.state.blocks[2]!.id);
    s.undo();
    expect(outline(s)).toEqual(["paragraph:hello"]);
  });

  it("inserts before a block at offset 0 and splits in the middle", () => {
    const a = paragraph("abcd");
    const s = setup([a], caret(a.id, 0));
    s.insertBlockAtCaret(pageBreak());
    expect(outline(s)).toEqual(["page_break", "paragraph:abcd"]);

    const b = paragraph("abcd");
    const t = setup([b], caret(b.id, 2));
    t.insertBlockAtCaret(toc());
    expect(outline(t)).toEqual(["paragraph:ab", "toc", "paragraph:cd"]);
  });

  it("applies font family and size, and makes superscript and subscript exclusive", () => {
    const p = paragraph("hello");
    const s = setup([p], range(p, 0, p, 5));
    s.setMarks({ fontFamily: "Georgia", fontSize: 18 });
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "hello", marks: { fontFamily: "Georgia", fontSize: 18 } }] });

    s.toggleMark("superscript");
    s.toggleMark("subscript");
    const marks = runsOf(s.state.blocks[0])[0]!.marks!;
    expect(marks.subscript).toBe(true);
    expect(marks.superscript).toBeUndefined();
  });

  it("carries font settings to the next typed text when only a caret is set", () => {
    const p = paragraph("ab");
    const s = setup([p], caret(p.id, 2));
    s.setMarks({ fontSize: 24, color: "#f00" });
    expect(s.pendingMarks).toMatchObject({ fontSize: 24, color: "#f00" });
    s.typeText("c");
    expect(s.state.blocks[0]).toMatchObject({
      runs: [{ text: "ab" }, { text: "c", marks: { fontSize: 24, color: "#f00" } }],
    });
  });

  it("sets paragraph spacing and clears it again", () => {
    const p = paragraph("x");
    const s = setup([p], caret(p.id, 0));
    s.setParagraphFormat({ lineHeight: 1.5, spaceAfter: 12, indentLeft: 36 });
    expect(s.state.blocks[0]).toMatchObject({ format: { lineHeight: 1.5, spaceAfter: 12, indentLeft: 36 } });
    s.setParagraphFormat({ lineHeight: null, spaceAfter: null, indentLeft: null });
    expect(s.state.blocks[0]).not.toHaveProperty("format");
  });

  it("converts to title and subtitle keeping alignment, and Enter at the end of a title starts a paragraph", () => {
    const p = paragraph("Big", "center");
    const s = setup([p], caret(p.id, 3));
    s.setBlockType({ type: "title" });
    expect(s.state.blocks[0]).toMatchObject({ type: "title", align: "center" });
    s.splitBlock();
    expect(outline(s)).toEqual(["title:Big", "paragraph:"]);
    expect(s.state.blocks[1]).toMatchObject({ align: "center" });
  });

  it("aligns images and resizes them through updateBlock", () => {
    const img = image(PNG, { width: 100, height: 50 });
    const s = setup([img, paragraph("x")], caret(img.id, 0));
    s.setAlign("center");
    expect(s.state.blocks[0]).toMatchObject({ align: "center" });
    s.updateBlock(img.id, { width: 200, height: 100 });
    expect(s.state.blocks[0]).toMatchObject({ width: 200, height: 100, type: "image" });
    s.undo();
    expect(s.state.blocks[0]).toMatchObject({ width: 100 });
  });

  it("clears character formatting and alignment but keeps links", () => {
    const p = paragraph([text("styled", { bold: true, fontSize: 20, link: "https://pli.dev" })], "right");
    const s = setup([p], range(p, 0, p, 6));
    s.clearFormatting();
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "styled", marks: { link: "https://pli.dev" } }] });
    expect(s.state.blocks[0]).not.toHaveProperty("align");
  });

  it("sets and removes links, and inserts a link at a caret", () => {
    const p = paragraph("go here");
    const s = setup([p], range(p, 3, p, 7));
    s.setLink("https://pli.dev");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "go " }, { text: "here", marks: { link: "https://pli.dev" } }] });
    s.setLink(null);
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "go here" }] });

    s.select(caret(p.id, 7));
    s.setLink("https://x.dev", "site");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "go here" }, { text: "site", marks: { link: "https://x.dev" } }] });
  });

  it("inserts page number fields without inheriting links", () => {
    const p = paragraph("Page ");
    const s = setup([p], caret(p.id, 5));
    s.insertField("page");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "Page " }, { text: "1", marks: { field: "page" } }] });
    s.typeText("!");
    expect(s.state.blocks[0]).toMatchObject({ runs: [{ text: "Page " }, { text: "1", marks: { field: "page" } }, { text: "!" }] });
  });
});

describe("selection state", () => {
  it("reports fonts, mixed values, spacing and the selected image", () => {
    const p = paragraph([text("a", { fontSize: 12 }), text("b", { fontSize: 20 })]);
    const img = image(PNG, { width: 10, height: 10 });
    const s = setup([spaced("x", { lineHeight: 2 }), p, img], range(p, 0, p, 2));
    let state = selectionState(s.state, s.selection);
    expect(state.fontSize).toEqual({ value: 12, mixed: true });
    s.select(range(p, 0, p, 1));
    state = selectionState(s.state, s.selection);
    expect(state.fontSize).toEqual({ value: 12, mixed: false });

    s.select(caret(s.state.blocks[0]!.id, 0));
    expect(selectionState(s.state, s.selection).format).toEqual({ lineHeight: 2 });
    s.select(caret(img.id, 0));
    expect(selectionState(s.state, s.selection).image?.id).toBe(img.id);
  });
});

describe("find and replace", () => {
  const doc = () =>
    createDoc("T", [paragraph("The cat sat. Cat CAT cat."), heading(1, "category"), divider(), paragraph([bold("cat"), " dog"])]);

  it("finds matches case-insensitively by default, or by case and whole word", () => {
    const d = doc();
    expect(findAll(d, "cat")).toHaveLength(6);
    expect(findAll(d, "cat", { matchCase: true })).toHaveLength(4);
    expect(findAll(d, "cat", { wholeWord: true })).toHaveLength(5);
    expect(findAll(d, "")).toEqual([]);
  });

  it("replaces all matches in one undoable step, keeping formatting", () => {
    const d = doc();
    const s = new DocumentSession(d);
    s.select(caret(d.blocks[0]!.id, 0));
    s.exec(replaceMatches(findAll(s.state, "cat", { wholeWord: true }), "dog"));
    expect(plainText(runsOf(s.state.blocks[0]))).toBe("The dog sat. dog dog dog.");
    expect(s.state.blocks[3]).toMatchObject({ runs: [{ text: "dog", marks: { bold: true } }, { text: " dog" }] });
    s.undo();
    expect(plainText(runsOf(s.state.blocks[0]))).toBe("The cat sat. Cat CAT cat.");
  });

  it("selects a match and counts words", () => {
    const d = doc();
    const [first] = findAll(d, "sat");
    expect(matchSelection(first!)).toEqual({
      anchor: { block: d.blocks[0]!.id, offset: 8 },
      focus: { block: d.blocks[0]!.id, offset: 11 },
    });
    expect(documentStats(createDoc("T", [paragraph("Hello, big world"), paragraph("  "), paragraph("a")]))).toEqual({
      words: 4,
      characters: 19,
      charactersNoSpaces: 15,
    });
  });
});

describe("serialization of the new model", () => {
  const rich = (): Doc => ({
    ...createDoc("Rich", [
      title("T"),
      subtitle("S"),
      toc(2),
      image(PNG, { width: 10, height: 20 }, { alt: "dot", align: "center" }),
      pageBreak(),
      spaced([text("x", { fontFamily: "Georgia", fontSize: 14, superscript: true })], { lineHeight: 1.5, indentFirst: -18 }),
    ]),
    page: { size: "a4", orientation: "landscape", margins: { top: 0.5, right: 1, bottom: 0.5, left: 1 } },
    header: [paragraph("H")],
    footer: [paragraph([text("1", { field: "page" })])],
  });

  it("round-trips", () => {
    const d = rich();
    expect(parseDoc(serializeDoc(d))).toEqual(d);
  });

  it.each([
    ["bad page size", { ...rich(), page: { size: "huge", orientation: "portrait", margins: { top: 1, right: 1, bottom: 1, left: 1 } } }, /doc\.page\.size/],
    ["bad image size", { ...createDoc("T", [{ id: "i", type: "image", src: "x", width: 0, height: 5 }]) }, /width/],
    ["bad font size", { ...createDoc("T", [{ id: "p", type: "paragraph", runs: [{ text: "x", marks: { fontSize: 0 } }] }]) }, /fontSize/],
    ["bad field", { ...createDoc("T", [{ id: "p", type: "paragraph", runs: [{ text: "x", marks: { field: "date" as never } }] }]) }, /field/],
    ["bad toc level", { ...createDoc("T", [{ id: "t", type: "toc", levels: 9 as never }]) }, /levels/],
    ["unknown format field", { ...createDoc("T", [{ id: "p", type: "paragraph", runs: [], format: { zoom: 2 } as never }]) }, /unknown field "zoom"/],
    ["bad header", { ...rich(), header: [{ id: "x", type: "nope" }] }, /doc\.header\[0\]\.type/],
  ])("rejects %s", (_name, value, message) => {
    expect(() => validateDoc(value)).toThrowError(message);
  });
});

describe("exports of the new model", () => {
  const rich = (): Doc => ({
    ...createDoc("Rich <doc>", [
      title("My title"),
      subtitle("Sub"),
      toc(2, "Contents"),
      heading(1, "Intro"),
      paragraph([text("fancy", { fontFamily: "Georgia", fontSize: 14, superscript: true }), " ", link("link", "https://pli.dev")]),
      heading(2, "Details"),
      heading(3, "Too deep"),
      image(PNG, { width: 40, height: 20 }, { alt: "dot", align: "center" }),
      pageBreak(),
      spaced("spaced", { lineHeight: 1.5, spaceAfter: 12, indentLeft: 36, indentFirst: 18 }),
      listItem("ordered", "one"),
      quote("q"),
    ]),
    page: { size: "a4", orientation: "landscape", margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: [paragraph("Report header")],
    footer: [paragraph(["Page ", text("1", { field: "page" }), " of ", text("1", { field: "pages" })], "center")],
  });

  it("renders HTML with anchors, a linked TOC, images, fonts and a print page size", () => {
    const html = toHtml(rich(), { fullDocument: true });
    expect(html).toContain("@page { size: 11.69in 8.27in;");
    expect(html).toContain('<p class="title"');
    expect(html).toMatch(/<nav class="toc"><p class="toc-title"><strong>Contents<\/strong><\/p>/);
    expect(html).toMatch(/<a href="#h-[^"]+">Intro<\/a>/);
    expect(html).toMatch(/<a href="#h-[^"]+">Details<\/a>/);
    expect(html).not.toContain(">Too deep</a>");
    expect(html).toContain("<sup>");
    expect(html).toContain("font-family:Georgia");
    expect(html).toContain("font-size:14pt");
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain("break-after:page");
    expect(html).toContain("line-height:1.5;margin-bottom:12pt;margin-left:36pt;text-indent:18pt");
  });

  it("drops image sources that could run script", () => {
    const html = toHtml(createDoc("T", [image("javascript:alert(1)", { width: 1, height: 1 })]));
    expect(html).toBe("");
  });

  it("renders Markdown with a TOC of anchor links", () => {
    const md = toMarkdown(rich());
    expect(md).toContain("# My title");
    expect(md).toContain("_Sub_");
    expect(md).toContain("**Contents**");
    expect(md).toContain("- [Intro](#intro)");
    expect(md).toContain("  - [Details](#details)");
    expect(md).not.toContain("Too deep](#");
    expect(md).toContain("![dot](data:image/png;base64,");
    expect(md).toContain("<sup>fancy</sup>");
  });

  describe("DOCX", () => {
    const files = () => unzipSync(toDocx(rich()));
    const xml = (name: string) => strFromU8(files()[name]!);

    it("contains header, footer, settings and media parts", () => {
      expect(Object.keys(files()).sort()).toEqual([
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/fontTable.xml",
        "word/footer1.xml",
        "word/header1.xml",
        "word/media/image1.png",
        "word/numbering.xml",
        "word/settings.xml",
        "word/styles.xml",
      ]);
    });

    it("produces well-formed XML in every part", () => {
      for (const name of Object.keys(files())) {
        if (name.startsWith("word/media/")) continue;
        const errors: string[] = [];
        new DOMParser({ onError: (_l, msg) => errors.push(msg) }).parseFromString(xml(name), "text/xml");
        expect(errors, name).toEqual([]);
      }
    });

    it("embeds the image bytes exactly", () => {
      const bytes = files()["word/media/image1.png"]!;
      expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });

    it("sets page size, orientation, margins and header/footer references", () => {
      const doc = xml("word/document.xml");
      expect(doc).toContain('<w:pgSz w:w="16834" w:h="11909" w:orient="landscape"/>');
      expect(doc).toContain('<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"');
      expect(doc).toContain('<w:headerReference w:type="default" r:id="rIdHeader1"/>');
      expect(doc).toContain('<w:footerReference w:type="default" r:id="rIdFooter1"/>');
      expect(xml("word/_rels/document.xml.rels")).toContain('Target="header1.xml"');
    });

    it("writes page-number fields in the footer", () => {
      const footer = xml("word/footer1.xml");
      expect(footer).toContain('<w:fldSimple w:instr=" PAGE ">');
      expect(footer).toContain('<w:fldSimple w:instr=" NUMPAGES ">');
      expect(footer).toContain('<w:pStyle w:val="Footer"/>');
      expect(xml("word/header1.xml")).toContain("Report header");
    });

    it("writes a TOC field limited to the chosen levels, and asks Word to refresh it", () => {
      const doc = xml("word/document.xml");
      expect(doc).toContain('TOC \\o "1-2" \\h \\z \\u');
      expect(doc).toContain('<w:pStyle w:val="TOC1"/>');
      expect(doc).toContain('<w:pStyle w:val="TOC2"/>');
      expect(doc).not.toContain('<w:pStyle w:val="TOC3"/>');
      expect(xml("word/settings.xml")).toContain('<w:updateFields w:val="true"/>');
    });

    it("writes images, page breaks, fonts, sizes, vertical alignment and paragraph spacing", () => {
      const doc = xml("word/document.xml");
      expect(doc).toContain('<wp:extent cx="381000" cy="190500"/>');
      expect(doc).toContain('descr="dot"');
      expect(doc).toContain('<w:br w:type="page"/>');
      expect(doc).toContain('<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/>');
      expect(doc).toContain('<w:sz w:val="28"/>');
      expect(doc).toContain('<w:vertAlign w:val="superscript"/>');
      expect(doc).toContain('<w:spacing w:after="240" w:line="360" w:lineRule="auto"/>');
      expect(doc).toContain('<w:ind w:left="720" w:firstLine="360"/>');
    });

    it("scales images that are wider than the text area", () => {
      const wide = createDoc("T", [image(PNG, { width: 2000, height: 1000 })]);
      const doc = strFromU8(unzipSync(toDocx(wide))["word/document.xml"]!);
      // Letter portrait, one inch margins: 6.5in of text = 624px = 5943600 EMU.
      expect(doc).toContain('<wp:extent cx="5943600" cy="2971800"/>');
    });

    it("leaves a placeholder for remote images instead of failing", () => {
      const remote = createDoc("T", [image("https://example.com/a.png", { width: 10, height: 10 }, { alt: "remote" })]);
      const doc = strFromU8(unzipSync(toDocx(remote))["word/document.xml"]!);
      expect(doc).toContain("[Image: remote]");
    });

    it("omits header and footer parts when unused, but still says the file is a current one", () => {
      const files = unzipSync(toDocx(createDoc("T", [paragraph("x")])));
      expect(Object.keys(files)).not.toContain("word/header1.xml");
      expect(strFromU8(files["word/settings.xml"]!)).not.toContain("updateFields");
    });
  });
});

describe("deleting ranges that start and end on non-text blocks", () => {
  it("removes both and lands the caret on the next block", () => {
    const img = image(PNG, { width: 10, height: 10 });
    const mid = paragraph("middle");
    const brk = pageBreak();
    const after = paragraph("after");
    const s = setup([img, mid, brk, after], range(img, 0, brk, 0));
    s.deleteSelection();
    expect(outline(s)).toEqual(["paragraph:after"]);
    expect(s.selection).toEqual(caret(after.id, 0));
  });
});
