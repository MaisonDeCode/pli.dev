import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  DocumentSession,
  PliError,
  Users,
  bold,
  code,
  codeBlock,
  createDoc,
  divider,
  fromDocx,
  heading,
  image,
  italic,
  link,
  listItem,
  pageBreak,
  paragraph,
  plainText,
  quote,
  sectionBreak,
  subtitle,
  suggestionsIn,
  table,
  text,
  title,
  toDocx,
  toc,
  validateDoc,
  type Block,
  type Doc,
  type DocxOptions,
} from "../src";

// A 1x1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const roundTrip = (doc: Doc, options?: DocxOptions) => fromDocx(toDocx(doc, options));

/** A document with the ids taken off, so two can be compared by what they hold. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "id" || key === "src") continue;
      out[key] = shape(v);
    }
    return out;
  }
  return value;
}

const blocksOf = (doc: Doc) => shape(doc.blocks);

/** The text of a block that has some. */
const textOf = (block: Block): string => plainText((block as unknown as { runs: Parameters<typeof plainText>[0] }).runs);

describe("a document written and read back", () => {
  it("keeps text, formatting, headings, lists, quotes and links", () => {
    const original = createDoc("T", [
      title("The Title"),
      subtitle("A subtitle"),
      heading(1, "Heading one"),
      heading(3, "Heading three"),
      paragraph(["Plain, ", bold("bold"), ", ", italic("italic"), ", ", text("both", { bold: true, italic: true }), " and ", link("a link", "https://pli.dev/x"), "."]),
      paragraph([text("red", { color: "#cc0000" }), text(" big", { fontSize: 18 }), text(" serif", { fontFamily: "Georgia" }), text(" lit", { highlight: "#ffff00" })]),
      paragraph([text("under", { underline: true }), text(" gone", { strike: true }), text("sup", { superscript: true }), text("sub", { subscript: true })]),
      listItem("bullet", "One"),
      listItem("bullet", "Nested", 1),
      listItem("ordered", "First"),
      listItem("ordered", "Second"),
      quote("Quoted"),
      codeBlock("a = 1;\nb = 2;"),
      paragraph("Last"),
    ]);
    const { doc, warnings } = roundTrip(original);
    expect(warnings).toEqual([]);
    expect(doc.title).toBe("T");
    expect(blocksOf(doc)).toEqual(blocksOf(original));
  });

  it("keeps alignment, spacing and indents", () => {
    const original = createDoc("T", [
      { ...paragraph("Centered", "center") },
      { ...paragraph("Spaced"), format: { lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12 } },
      { ...paragraph("Indented"), format: { indentLeft: 36, indentRight: 18, indentFirst: 18 } },
      { ...paragraph("Hanging"), format: { indentLeft: 36, indentFirst: -18 } },
      paragraph("Justified", "justify"),
    ]);
    expect(blocksOf(roundTrip(original).doc)).toEqual(blocksOf(original));
  });

  it("keeps tables with merged cells, shading, header rows, row heights and borders", () => {
    const grid = table([["A", "B", "C"], ["D", "E", "F"], ["G", "H", "I"]], { headerRow: true });
    grid.rows[0]!.cells[0]!.colSpan = 2;
    grid.rows[0]!.cells[1] = { id: "x", blocks: [], covered: true };
    grid.rows[1]!.cells[2]!.rowSpan = 2;
    grid.rows[2]!.cells[2] = { id: "y", blocks: [], covered: true };
    grid.rows[1]!.cells[0]!.shade = "#fde68a";
    grid.rows[1]!.cells[1]!.vAlign = "middle";
    grid.rows[2]!.height = 40;
    grid.borders = "horizontal";
    const original = createDoc("T", [paragraph("Before"), grid, paragraph("After")]);
    const { doc } = roundTrip(original);
    // The exporter sets cell paragraphs close together and makes a header row bold; those come back as the formatting they are.
    const plain = (blocks: unknown) => JSON.parse(JSON.stringify(shape(blocks), (k, v) => (k === "format" && v?.spaceAfter === 2 ? undefined : k === "marks" && v?.bold === true && Object.keys(v).length === 1 ? undefined : v)));
    expect(plain(doc.blocks)).toEqual(plain(original.blocks));
    const back = doc.blocks[1] as typeof grid;
    expect(back.rows[0]!.cells[0]!.colSpan).toBe(2);
    expect(back.rows[1]!.cells[2]!.rowSpan).toBe(2);
  });

  it("doesn't grow paragraphs where Word wants one between tables or after the last", () => {
    const original = createDoc("T", [table([["a"]]), table([["b"]])]);
    const { doc } = roundTrip(original);
    expect(doc.blocks.map((b) => b.type)).toEqual(["table", "table"]);
  });

  it("keeps pictures, with their size and description", () => {
    const original = createDoc("T", [paragraph("Above"), image(PNG, { width: 120, height: 80 }, { alt: "A pixel", align: "center" }), paragraph("Below")]);
    const { doc } = roundTrip(original);
    expect(doc.blocks[1]).toMatchObject({ type: "image", width: 120, height: 80, alt: "A pixel", align: "center" });
    expect((doc.blocks[1] as { src: string }).src).toMatch(/^data:image\/png;base64,/);
    expect(blocksOf(doc)).toEqual(blocksOf(original));
  });

  it("keeps page breaks, dividers and the table of contents", () => {
    const original = createDoc("T", [heading(1, "One"), toc(2, "Contents"), paragraph("x"), pageBreak(), divider(), heading(2, "Two")]);
    const { doc } = roundTrip(original);
    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "toc", "paragraph", "page_break", "divider", "heading"]);
    expect(doc.blocks[1]).toMatchObject({ levels: 2, title: "Contents" });
  });

  it("keeps a table of contents that has no title", () => {
    const original = createDoc("T", [heading(1, "One"), toc(3, ""), paragraph("x")]);
    const { doc } = roundTrip(original);
    expect(doc.blocks[1]).toMatchObject({ type: "toc", levels: 3, title: "" });
  });

  it("keeps page setup, columns and section breaks", () => {
    const original: Doc = {
      ...createDoc("T", [paragraph("One"), sectionBreak("next_page", { count: 2, gap: 24 }), paragraph("Two"), sectionBreak("continuous"), paragraph("Three")]),
      page: { size: "a4", orientation: "landscape", margins: { top: 0.5, right: 0.75, bottom: 1, left: 1.25 }, columns: { count: 3, gap: 18 } },
    };
    const { doc } = roundTrip(original);
    expect(doc.page).toEqual(original.page);
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "section_break", "paragraph", "section_break", "paragraph"]);
    expect(doc.blocks[1]).toMatchObject({ kind: "next_page", columns: { count: 2, gap: 24 } });
    expect(doc.blocks[3]).toMatchObject({ kind: "continuous" });
  });

  it("keeps a section's own page size", () => {
    const wide = sectionBreak("next_page");
    wide.page = { orientation: "landscape", margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 } };
    const { doc } = roundTrip(createDoc("T", [paragraph("a"), wide, paragraph("b")]));
    expect(doc.blocks[1]).toMatchObject({ type: "section_break", page: { size: "letter", orientation: "landscape", margins: { top: 0.5 } } });
  });

  it("keeps headers and footers, with page-number fields and different first and even pages", () => {
    const original: Doc = {
      ...createDoc("T", [paragraph("Body")]),
      page: { size: "letter", orientation: "portrait", margins: { top: 1, right: 1, bottom: 1, left: 1 }, differentFirstPage: true, differentOddEven: true },
      header: [paragraph("Header")],
      footer: [paragraph(["Page ", text("1", { field: "page" }), " of ", text("1", { field: "pages" })], "center")],
      headerFirst: [paragraph("First header")],
      headerEven: [paragraph("Even header")],
    };
    const { doc } = roundTrip(original);
    expect(shape(doc.header)).toEqual(shape(original.header));
    expect(shape(doc.footer)).toEqual(shape(original.footer));
    expect(shape(doc.headerFirst)).toEqual(shape(original.headerFirst));
    expect(shape(doc.headerEven)).toEqual(shape(original.headerEven));
    expect(doc.page).toMatchObject({ differentFirstPage: true, differentOddEven: true });
  });

  it("keeps footnotes, numbered by where they are cited", () => {
    const original: Doc = {
      ...createDoc("T", [paragraph(["One", text("​", { footnote: "a" }), " two", text("​", { footnote: "b" })])]),
      footnotes: { a: [paragraph("First note")], b: [paragraph(["Second ", bold("note")])] },
    };
    const { doc } = roundTrip(original);
    const refs = (doc.blocks[0] as { runs: { marks?: { footnote?: string } }[] }).runs.filter((r) => r.marks?.footnote);
    expect(refs).toHaveLength(2);
    const notes = doc.footnotes!;
    expect(textOf(notes[refs[0]!.marks!.footnote!]![0]!)).toBe("First note");
    expect(textOf(notes[refs[1]!.marks!.footnote!]![0]!)).toBe("Second note");
  });

  it("keeps comments with their text, authors, replies and resolved state", () => {
    const base = createDoc("T", [paragraph("Alpha beta gamma")]);
    const id = base.blocks[0]!.id;
    const original: Doc = {
      ...base,
      blocks: [{ ...base.blocks[0]!, runs: [{ text: "Alpha " }, { text: "beta", marks: { comment: ["th1"] } }, { text: " gamma" }] } as Block],
      comments: {
        th1: {
          id: "th1",
          createdAt: 1_700_000_000_000,
          anchor: { block: id, from: 6, to: 10, quote: "beta" },
          comments: [
            { id: "c1", author: "Ana Reyes", body: "Why beta?\nSecond line", createdAt: 1_700_000_000_000 },
            { id: "c2", author: "Ben Ito", body: "Because.", createdAt: 1_700_000_100_000 },
          ],
          resolved: { by: "Ben Ito", at: 1_700_000_100_000 },
        },
      },
    };
    const { doc, authors } = roundTrip(original, { authorName: (u) => u });
    const threads = Object.values(doc.comments ?? {});
    expect(threads).toHaveLength(1);
    const thread = threads[0]!;
    expect(thread.comments.map((c) => c.body)).toEqual(["Why beta?\nSecond line", "Because."]);
    expect(thread.comments.map((c) => c.author)).toEqual(["ana-reyes", "ben-ito"]);
    expect(thread.resolved).toBeDefined();
    expect(thread.anchor).toMatchObject({ from: 6, to: 10, quote: "beta" });
    expect(authors.map((a) => a.name).sort()).toEqual(["Ana Reyes", "Ben Ito"]);
    expect((doc.blocks[0] as { runs: { text: string; marks?: { comment?: string[] } }[] }).runs.find((r) => r.marks?.comment)!.text).toBe("beta");
  });

  it("uses the user ids the app gives for comment authors", () => {
    const base = createDoc("T", [paragraph("Alpha")]);
    const original: Doc = {
      ...base,
      blocks: [{ ...base.blocks[0]!, runs: [{ text: "Alpha", marks: { comment: ["t"] } }] } as Block],
      comments: { t: { id: "t", createdAt: 1, anchor: { block: base.blocks[0]!.id, from: 0, to: 5, quote: "Alpha" }, comments: [{ id: "c", author: "u_42", body: "hi", createdAt: 1 }] } },
    };
    const { doc, authors } = fromDocx(toDocx(original, { authorName: () => "Ana Reyes" }), { userId: (name) => (name === "Ana Reyes" ? "u_42" : name) });
    expect(Object.values(doc.comments!)[0]!.comments[0]!.author).toBe("u_42");
    expect(authors).toEqual([{ id: "u_42", name: "Ana Reyes" }]);
  });

  it("keeps named styles, their bases, and where they are used", () => {
    const original: Doc = {
      ...createDoc("T", [
        { ...paragraph([text("Careful ", {}), text("now", { style: "key" })]), style: "kid" },
        { ...paragraph("Plain note"), style: "note" },
        { ...heading(2, "Styled heading"), style: "note" },
      ]),
      styles: {
        note: { name: "Note", kind: "paragraph", marks: { italic: true, color: "#336699", fontSize: 13 }, align: "center", format: { spaceAfter: 18, indentLeft: 36 } },
        kid: { name: "Kid", kind: "paragraph", basedOn: "note", marks: { bold: true } },
        key: { name: "Key term", kind: "character", marks: { bold: true, color: "#be185d" } },
      },
    };
    const { doc } = roundTrip(original);
    expect(doc.styles).toEqual(original.styles);
    expect(doc.blocks[0]).toMatchObject({ style: "kid" });
    expect((doc.blocks[0] as { runs: { marks?: { style?: string } }[] }).runs[1]!.marks?.style).toBe("key");
    expect(doc.blocks[1]).toMatchObject({ style: "note" });
  });
});

describe("a document from elsewhere", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const file = (body: string, extra: Record<string, string> = {}): Uint8Array =>
    zipSync({
      "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
    });

  it("reads plain paragraphs with no other parts at all", () => {
    const { doc } = fromDocx(file('<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve"> world </w:t></w:r></w:p>'));
    expect(doc.blocks.map(textOf)).toEqual(["Hello", " world "]);
    expect(doc.title).toBe("Untitled");
    validateDoc(doc);
  });

  it("reads tabs, line breaks, entities and several runs in a paragraph", () => {
    const { doc } = fromDocx(file('<w:p><w:r><w:t>a &amp; b</w:t><w:tab/><w:t>c</w:t><w:br/><w:t>&#x41;&#66;</w:t></w:r></w:p>'));
    expect(textOf(doc.blocks[0]!)).toBe("a & b\tc\nAB");
  });

  const tracked = '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r><w:ins w:id="1" w:author="Ana Reyes" w:date="2026-01-02T03:04:05Z"><w:r><w:t xml:space="preserve">added </w:t></w:r></w:ins><w:del w:id="2" w:author="Ben Ito" w:date="2026-01-03T00:00:00Z"><w:r><w:delText xml:space="preserve">removed </w:delText></w:r></w:del><w:r><w:t>end</w:t></w:r></w:p>';

  it("keeps tracked changes as suggestions, with who made them and when", () => {
    const { doc, authors } = fromDocx(file(tracked));
    const runs = (doc.blocks[0] as unknown as { runs: { text: string; marks?: { suggest?: { kind: string; by: string; at: number } } }[] }).runs;
    expect(runs.map((r) => [r.text, r.marks?.suggest?.kind, r.marks?.suggest?.by])).toEqual([["keep "], ["added ", "insert", "ana-reyes"], ["removed ", "delete", "ben-ito"], ["end"]].map((x) => (x.length === 1 ? [x[0], undefined, undefined] : x)));
    expect(runs[1]!.marks!.suggest!.at).toBe(Date.parse("2026-01-02T03:04:05Z"));
    expect(authors.map((a) => a.id).sort()).toEqual(["ana-reyes", "ben-ito"]);
    expect(suggestionsIn(doc)).toHaveLength(2);
    validateDoc(doc);
  });

  it("can instead take the text as it reads with every change accepted", () => {
    const { doc, authors } = fromDocx(file(tracked), { trackedChanges: "accept" });
    expect(textOf(doc.blocks[0]!)).toBe("keep added end");
    expect(suggestionsIn(doc)).toEqual([]);
    expect(authors).toEqual([]);
  });

  it("reads headings and lists through Word's own styles and numbering", () => {
    const styles = `<w:styles ${W}>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="MyHeading"><w:name w:val="My Heading"/><w:basedOn w:val="Heading1"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
    </w:styles>`;
    const numbering = `<w:numbering ${W}>
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="8"><w:abstractNumId w:val="1"/></w:num>
    </w:numbering>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      <Relationship Id="n" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
    </Relationships>`;
    const { doc } = fromDocx(
      file(
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Top</w:t></w:r></w:p>
         <w:p><w:pPr><w:pStyle w:val="MyHeading"/></w:pPr><w:r><w:t>Mine</w:t></w:r></w:p>
         <w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>b1</w:t></w:r></w:p>
         <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>b2</w:t></w:r></w:p>
         <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="8"/></w:numPr></w:pPr><w:r><w:t>n1</w:t></w:r></w:p>
         <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>none</w:t></w:r></w:p>`,
        { "word/styles.xml": styles, "word/numbering.xml": numbering, "word/_rels/document.xml.rels": rels },
      ),
    );
    expect(doc.blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(doc.blocks[0]).not.toHaveProperty("style");
    expect(doc.blocks[1]).toMatchObject({ type: "heading", level: 1, style: "my-heading" });
    expect(doc.styles?.["my-heading"]).toEqual({ name: "My Heading", kind: "paragraph", marks: { bold: true, fontSize: 20 } });
    expect(doc.blocks[2]).toMatchObject({ type: "list_item", list: "bullet", depth: 0 });
    expect(doc.blocks[3]).toMatchObject({ type: "list_item", list: "bullet", depth: 1 });
    expect(doc.blocks[4]).toMatchObject({ type: "list_item", list: "ordered", depth: 0 });
    expect(doc.blocks[5]).toMatchObject({ type: "paragraph" });
  });

  it("reads fields written the long way: page numbers, links and a table of contents Word built", () => {
    const body = `
      <w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>
      <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Intro</w:t></w:r><w:r><w:tab/><w:t>3</w:t></w:r></w:p>
      <w:p><w:r><w:t>Chapter</w:t></w:r><w:r><w:tab/><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://pli.dev" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>the site</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>.</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>`;
    const { doc } = fromDocx(file(body, { "word/styles.xml": `<w:styles ${W}><w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/></w:style></w:styles>` }));
    expect(doc.blocks.map((b) => b.type)).toEqual(["toc", "paragraph", "paragraph"]);
    expect(doc.blocks[0]).toMatchObject({ levels: 2, title: "Contents" });
    const runs = (b: Block) => (b as { runs: { text: string; marks?: Record<string, unknown> }[] }).runs;
    expect(runs(doc.blocks[1]!)).toEqual([{ text: "See " }, { text: "the site", marks: { link: "https://pli.dev" } }, { text: "." }]);
    expect(runs(doc.blocks[2]!)).toEqual([{ text: "Page " }, { text: "1", marks: { field: "page" } }]);
  });

  it("reads a picture stored in the file and says so when it can't use one", () => {
    const png = Uint8Array.from(atob(PNG.split(",")[1]!), (c) => c.charCodeAt(0));
    const drawing = (rid: string) => `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="p" descr="Alt text"/><a:graphic><a:graphicData><a:pic><a:blipFill><a:blip r:embed="${rid}"/></a:blipFill></a:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="i1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/>
      <Relationship Id="i2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/b.emf"/>
    </Relationships>`;
    const bytes = zipSync({
      "word/document.xml": strToU8(`<w:document ${W}><w:body><w:p><w:r><w:t>Look: </w:t></w:r>${drawing("i1")}<w:r><w:t> after</w:t></w:r></w:p><w:p>${drawing("i2")}</w:p></w:body></w:document>`),
      "word/_rels/document.xml.rels": strToU8(rels),
      "word/media/a.png": png,
      "word/media/b.emf": Uint8Array.from([1, 2, 3]),
    });
    const { doc, warnings } = fromDocx(bytes);
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph", "paragraph"]);
    expect(doc.blocks[1]).toMatchObject({ width: 100, height: 50, alt: "Alt text" });
    expect(warnings.join(" ")).toMatch(/EMF/);
  });

  it("flattens a table inside a table and tells you", () => {
    const inner = '<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const { doc, warnings } = fromDocx(file(`<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>outer</w:t></w:r></w:p>${inner}<w:p/></w:tc></w:tr></w:tbl>`));
    const t = doc.blocks[0] as unknown as { rows: { cells: { blocks: Block[] }[] }[] };
    expect(t.rows[0]!.cells[0]!.blocks.map(textOf)).toEqual(["outer", "inner", ""]);
    expect(warnings.join(" ")).toMatch(/table inside a table/);
  });

  it("copes with a table that has no grid, ragged rows and a broken merge", () => {
    const { doc } = fromDocx(file('<w:tbl><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'));
    validateDoc(doc);
    expect(doc.blocks[0]!.type).toBe("table");
  });

  it("gives the page setup and sections of a file whose sections are marked inside paragraphs", () => {
    const body = `<w:p><w:r><w:t>One</w:t></w:r></w:p>
      <w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr></w:p>
      <w:p><w:r><w:t>Two</w:t></w:r></w:p>
      <w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols w:num="2" w:space="360"/></w:sectPr>`;
    const { doc } = fromDocx(file(body));
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "section_break", "paragraph"]);
    expect(doc.blocks[1]).toMatchObject({ kind: "continuous", columns: { count: 2, gap: 18 } });
  });

  it("uses the document title from the file's properties", () => {
    const { doc } = fromDocx(file("<w:p/>", { "docProps/core.xml": '<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>My report</dc:title></cp:coreProperties>' }));
    expect(doc.title).toBe("My report");
  });

  it("leaves out what it can't use and says so", () => {
    const { warnings } = fromDocx(file('<w:p><w:r><w:pict/></w:r></w:p>'));
    expect(warnings.join(" ")).toMatch(/drawing or embedded object/);
  });
});

describe("a file that isn't one", () => {
  const fails = (bytes: Uint8Array, message: RegExp) => {
    try {
      fromDocx(bytes);
    } catch (error) {
      expect(error).toBeInstanceOf(PliError);
      expect((error as PliError).code).toBe("invalid_document");
      expect((error as Error).message).toMatch(message);
      return;
    }
    throw new Error("should have thrown");
  };

  it("refuses something that isn't a zip", () => fails(strToU8("hello"), /zip/));
  it("refuses a zip with no document", () => fails(zipSync({ "a.txt": strToU8("x") }), /document\.xml/));
  it("refuses a document that isn't XML", () => fails(zipSync({ "word/document.xml": strToU8("<w:document><w:body>") }), /XML/));
  it("refuses a document with no body", () => fails(zipSync({ "word/document.xml": strToU8("<document/>") }), /body/));
  it("refuses a file that unpacks to more than its limit", () => {
    const big = zipSync({ "word/document.xml": strToU8(`<w:document xmlns:w="x"><w:body>${"<w:p/>".repeat(1000)}</w:body></w:document>`) });
    expect(() => fromDocx(big, { maxUnpackedBytes: 100 })).toThrowError(/too large/);
  });

  it("doesn't expand entities it was given", () => {
    const xml = '<!DOCTYPE d [<!ENTITY a "boom">]><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>';
    const { doc } = fromDocx(zipSync({ "word/document.xml": strToU8(xml) }));
    expect(textOf(doc.blocks[0]!)).toBe("&a;");
  });

  it("refuses elements nested absurdly deep", () => {
    const xml = `<w:document xmlns:w="x"><w:body>${"<w:sdt><w:sdtContent>".repeat(300)}${"</w:sdtContent></w:sdt>".repeat(300)}</w:body></w:document>`;
    fails(zipSync({ "word/document.xml": strToU8(xml) }), /deeply/);
  });
});

describe("what was imported can be used", () => {
  it("is a valid document that exports again", () => {
    const original = createDoc("T", [heading(1, "H"), paragraph(["a ", bold("b"), code(" c")]), table([["x", "y"], ["z", "w"]]), listItem("bullet", "li")]);
    const { doc } = roundTrip(original);
    validateDoc(doc);
    const again = roundTrip(doc);
    expect(blocksOf(again.doc)).toEqual(blocksOf(doc));
  });
});

// ---- Hostile and damaged files ---------------------------------------------------------------------------------

describe("what Word and LibreOffice write", () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const pack = (body: string, styles = "") =>
    zipSync({
      "word/document.xml": strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
      ...(styles ? { "word/styles.xml": strToU8(`<w:styles ${W}>${styles}</w:styles>`) } : {}),
    });

  it("asks Word to open what Pli writes as a current document, not in Compatibility Mode", () => {
    const settings = strFromU8(unzipSync(toDocx(createDoc("T", [paragraph("x")])))["word/settings.xml"]!);
    expect(settings).toContain('<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>');
  });

  it("takes the heading of a table of contents that is wrapped in a content control", () => {
    const styles = '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/></w:style>';
    const { doc } = fromDocx(
      pack(
        `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Table of contents</w:t></w:r></w:p>
         <w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>
           <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\o "1-2" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Intro</w:t></w:r></w:p>
           <w:p><w:r><w:t>Next</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
         </w:sdtContent></w:sdt>`,
        styles,
      ),
    );
    expect(doc.blocks.map((b) => b.type)).toEqual(["toc"]);
    expect(doc.blocks[0]).toMatchObject({ levels: 2, title: "Table of contents" });
  });

  it("doesn't make styles of the character halves Word pairs with its own", () => {
    const styles = `
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:link w:val="Heading1Char"/></w:style>
      <w:style w:type="character" w:customStyle="1" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/><w:link w:val="Heading1"/><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>`;
    const { doc } = fromDocx(pack('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Heading1Char"/></w:rPr><w:t>Hi</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>There</w:t></w:r></w:p>', styles));
    expect(Object.values(doc.styles ?? {}).map((s) => s.name)).toEqual(["Strong"]);
  });

  it("leaves out a header that holds only the empty paragraph Word always has", () => {
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="h" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>';
    const bytes = zipSync({
      "word/document.xml": strToU8(`<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="h"/></w:sectPr></w:body></w:document>`),
      "word/_rels/document.xml.rels": strToU8(rels),
      "word/header1.xml": strToU8(`<w:hdr ${W}><w:p/></w:hdr>`),
    });
    expect(fromDocx(bytes).doc.header).toBeUndefined();
  });
});

describe("damaged files", () => {
  const rich = (): Doc => {
    const base = createDoc("T", [
      title("Title"),
      heading(1, "Head"),
      toc(2),
      paragraph([text("styled", { style: "key" }), " ", text("note", { comment: ["th"] }), text("​", { footnote: "f" })]),
      listItem("bullet", "li"),
      table([["a", "b"], ["c", "d"]], { headerRow: true }),
      image(PNG, { width: 10, height: 10 }, { alt: "x" }),
      sectionBreak("next_page", { count: 2 }),
      paragraph("end"),
    ]);
    const first = base.blocks[3]!;
    return {
      ...base,
      header: [paragraph("h")],
      footer: [paragraph([text("1", { field: "page" })])],
      footnotes: { f: [paragraph("note")] },
      styles: { key: { name: "Key", kind: "character", marks: { bold: true } }, n: { name: "N", kind: "paragraph", marks: { italic: true } } },
      comments: { th: { id: "th", createdAt: 1, anchor: { block: first.id, from: 7, to: 11, quote: "note" }, comments: [{ id: "c", author: "a", body: "b", createdAt: 1 }] } },
    };
  };

  function rng(seed: number) {
    let s = seed >>> 0 || 1;
    const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(a: readonly T[]) => a[Math.floor(next() * a.length)]! };
  }

  const JUNK = ["-5", "0", "999999999999", "abc", "", "1.5e400", "NaN", "restart", "continue", "auto", "-1"];

  it("never fails any way but with an error that says the file is bad, and never makes an invalid document", () => {
    const runs = Number(process.env.FUZZ_RUNS ?? 1) || 1;
    const original = unzipSync(toDocx(rich(), { authorName: (u) => u }));
    const parts = Object.keys(original).filter((n) => n.endsWith(".xml") && n.startsWith("word/") && !n.includes("_rels"));
    let imported = 0;
    for (let seed = 1; seed <= 400 * runs; seed++) {
      const r = rng(seed * 7919);
      const files = { ...original };
      const name = r.pick(parts);
      let xml = strFromU8(files[name]!);
      for (let k = 0; k <= r.int(3); k++) {
        const how = r.int(5);
        const at = r.int(xml.length);
        if (how === 0) xml = xml.slice(0, at) + xml.slice(at + 1 + r.int(60));
        else if (how === 1) xml = xml.replace(/w:val="[^"]*"/, (m) => (r.next() < 0.5 ? m : `w:val="${r.pick(JUNK)}"`));
        else if (how === 2) xml = xml.replace(/w:(w|h|top|left|bottom|right|num|space|id|ilvl|numId|type)="[^"]*"/, (m) => `${m.split("=")[0]}="${r.pick(JUNK)}"`);
        else if (how === 3) xml = xml.replace(/<w:(\w+)/, (_m, tag: string) => `<w:${r.pick(["p", "tbl", "tc", "r", "sectPr", "drawing", tag])}`);
        else xml = xml.slice(0, at) + r.pick(["</w:p>", "<w:p>", "&", "<", "<w:tbl>", "<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>", "<w:tc>"]) + xml.slice(at);
      }
      files[name] = strToU8(xml);
      try {
        const { doc } = fromDocx(zipSync(files));
        validateDoc(doc);
        imported++;
      } catch (error) {
        if (!(error instanceof PliError)) throw new Error(`seed ${seed} (${name}): ${(error as Error).stack}`);
        expect(error.code).toBe("invalid_document");
      }
    }
    // Most damage is small enough that the file still opens.
    expect(imported).toBeGreaterThan(100);
  });
});

describe("suggestions in a file", () => {
  it("are written as tracked changes and read back as the same suggestions", () => {
    const original: Doc = createDoc("T", [
      {
        id: "p",
        type: "paragraph",
        runs: [
          { text: "Keep " },
          { text: "new", marks: { bold: true, suggest: { id: "a", kind: "insert", by: "u_ana", at: Date.UTC(2026, 0, 2, 3, 4, 5) } } },
          { text: " old\tgone", marks: { suggest: { id: "b", kind: "delete", by: "u_ben", at: Date.UTC(2026, 0, 3) } } },
        ],
      },
    ]);
    const bytes = toDocx(original, { authorName: (id) => ({ u_ana: "Ana Reyes", u_ben: "Ben Ito" })[id as "u_ana"] ?? id });
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
    expect(xml).toMatch(/<w:ins w:id="\d+" w:author="Ana Reyes" w:date="2026-01-02T03:04:05Z"><w:r>/);
    expect(xml).toMatch(/<w:del w:id="\d+" w:author="Ben Ito" w:date="2026-01-03T00:00:00Z"><w:r>.*<w:delText xml:space="preserve"> old<\/w:delText><w:tab\/><w:delText xml:space="preserve">gone<\/w:delText>/s);
    const { doc, authors } = fromDocx(bytes, { userId: (name) => ({ "Ana Reyes": "u_ana", "Ben Ito": "u_ben" })[name as "Ana Reyes"] ?? name });
    const list = suggestionsIn(doc);
    expect(list.map((s) => [s.kind, s.by, s.text])).toEqual([["insert", "u_ana", "new"], ["delete", "u_ben", " old\tgone"]]);
    expect(authors.map((a) => a.id).sort()).toEqual(["u_ana", "u_ben"]);
  });
});

describe("opening a file in a session", () => {
  const imported = () => {
    const base = createDoc("From file", [heading(1, "Imported"), paragraph([text("with a ", {}), text("comment", { comment: ["th"] })]), table([["a"]])]);
    const doc: Doc = {
      ...base,
      page: { size: "a4", orientation: "portrait", margins: { top: 1, right: 1, bottom: 1, left: 1 } },
      header: [paragraph("Imported header")],
      styles: { note: { name: "Note", kind: "paragraph", marks: { italic: true } } },
      comments: { th: { id: "th", createdAt: 1, anchor: { block: base.blocks[1]!.id, from: 7, to: 14, quote: "comment" }, comments: [{ id: "c", author: "ana", body: "hi", createdAt: 1 }] } },
    };
    return doc;
  };

  it("replaces the whole document, in one undo step", () => {
    const old: Doc = { ...createDoc("Old", [paragraph("old one"), paragraph("old two")]), header: [paragraph("old header")], footnotes: { f: [paragraph("n")] }, styles: { gone: { name: "Gone", kind: "character" } } };
    const session = new DocumentSession(old);
    const before = session.state;
    session.replaceDocument(imported());
    expect(session.state.title).toBe("From file");
    expect(session.state.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "table"]);
    expect(session.state.page?.size).toBe("a4");
    expect(session.state.header).toEqual(imported().header?.map((b) => ({ ...b, id: expect.any(String) })));
    expect(session.state.footnotes).toBeUndefined();
    expect(Object.keys(session.state.styles ?? {})).toEqual(["note"]);
    expect(session.selection?.anchor.offset).toBe(0);
    expect(session.undo()).toBe(true);
    expect(session.state).toEqual(before);
    expect(session.redo()).toBe(true);
    expect(session.state.title).toBe("From file");
  });

  it("brings the comments in when they are saved in the document, and takes them out again on undo", async () => {
    const session = new DocumentSession(createDoc("Old", [paragraph("old")]), { comments: { users: new Users({ id: "ana", name: "Ana" }) } });
    session.replaceDocument(imported());
    await session.comments!.ready;
    expect(session.comments!.threads.map((t) => t.id)).toEqual(["th"]);
    session.undo();
    await new Promise((r) => setTimeout(r, 0));
    expect(session.comments!.threads).toEqual([]);
  });

  it("leaves comments alone when the app keeps them in its own store", () => {
    const session = new DocumentSession(createDoc("Old", [paragraph("old")]), { comments: { users: new Users({ id: "ana", name: "Ana" }), store: { load: () => [], save: () => {} } } });
    session.replaceDocument(imported());
    expect(session.state.comments).toBeUndefined();
  });

  it("refuses text whose ids are already in the document", () => {
    const session = new DocumentSession(createDoc("Old", [paragraph("old")]));
    expect(() => session.replaceDocument({ ...createDoc("X", []), blocks: session.state.blocks })).toThrowError(/already in the document/);
  });

  it("opens what was just exported, text and all", () => {
    const original = createDoc("Round", [heading(1, "Round"), paragraph(["trip ", bold("ok")])]);
    const { doc } = fromDocx(toDocx(original));
    const session = new DocumentSession(createDoc("Blank", [paragraph("")]));
    session.replaceDocument(doc);
    expect(session.state.blocks.map(textOf)).toEqual(["Round", "trip ok"]);
  });
});

describe("files made by other applications, kept as fixtures", () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/docx", name)));

  it("reads what LibreOffice wrote: structure, styles, lists, table, footnote, comment, tracked changes and header", () => {
    const { doc, warnings, authors } = fromDocx(fixture("libreoffice-interop.docx"));
    expect(warnings).toEqual([]);
    expect(doc.blocks.map((b) => b.type)).toEqual([
      "title", "subtitle", "toc", "heading", "list_item", "list_item", "list_item", "list_item", "list_item", "paragraph", "list_item",
      "heading", "paragraph", "quote", "code_block", "heading", "table", "paragraph", "heading", "image", "page_break", "heading", "paragraph", "section_break", "heading", "paragraph",
    ]);
    expect(doc.blocks[2]).toMatchObject({ type: "toc", levels: 2, title: "Table of contents" });
    expect(doc.blocks.filter((b) => b.type === "list_item").map((b) => `${(b as { list: string }).list}${(b as { depth: number }).depth}`)).toEqual(["bullet0", "bullet1", "bullet0", "ordered0", "ordered0", "ordered0"]);
    expect(Object.keys(doc.styles ?? {})).toEqual(["note"]);
    expect(Object.keys(doc.footnotes ?? {})).toHaveLength(1);
    expect(Object.values(doc.comments ?? {})[0]!.comments.map((c) => c.body)).toEqual(["Is this right?", "Yes."]);
    expect(suggestionsIn(doc).map((s) => [s.kind, s.text])).toEqual([["insert", "Added words"], ["delete", " removed words"]]);
    expect(authors.map((a) => a.name).sort()).toEqual(["Ana Reyes", "Ben Ito"]);
    expect(doc.header).toBeDefined();
    const grid = doc.blocks.find((b) => b.type === "table") as unknown as { rows: { cells: { rowSpan?: number; shade?: string }[] }[]; headerRow?: boolean };
    expect(grid.rows[1]!.cells[2]!.rowSpan).toBe(2);
    expect(grid.rows[1]!.cells[0]!.shade).toBe("#fde68a");
  });

  it("reads what Pli wrote for Word, and writes it again the same", () => {
    const first = fromDocx(fixture("pli-interop.docx"));
    const second = fromDocx(toDocx(first.doc, { authorName: (id) => id }));
    expect(blocksOf(second.doc)).toEqual(blocksOf(first.doc));
  });
});
