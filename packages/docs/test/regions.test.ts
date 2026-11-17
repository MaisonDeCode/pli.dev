import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  DEFAULT_PAGE,
  DocumentSession,
  activeRegionNames,
  caret,
  createDoc,
  paragraph,
  parseDoc,
  plainText,
  regionBlocksFor,
  regionKeyFor,
  regionLabel,
  serializeDoc,
  toDocx,
  toHtml,
  validateDoc,
  type Doc,
  type Run,
  type TableBlock,
} from "../src";

function withRegions(page: Doc["page"], regions: Partial<Record<"header" | "footer" | "headerFirst" | "footerFirst" | "headerEven" | "footerEven", string>>): Doc {
  const doc: Doc = { ...createDoc("T", [paragraph("body")]), ...(page && { page }) };
  for (const [name, label] of Object.entries(regions)) (doc as unknown as Record<string, unknown>)[name] = [paragraph(label!)];
  return doc;
}

describe("which header a page shows", () => {
  it("is the same on every page by default", () => {
    for (const n of [1, 2, 3, 10]) expect(regionKeyFor(undefined, "header", n)).toBe("header");
  });

  it("gives page 1 its own with differentFirstPage", () => {
    const page = { differentFirstPage: true };
    expect([1, 2, 3].map((n) => regionKeyFor(page, "footer", n))).toEqual(["footerFirst", "footer", "footer"]);
  });

  it("gives even pages their own with differentOddEven", () => {
    const page = { differentOddEven: true };
    expect([1, 2, 3, 4].map((n) => regionKeyFor(page, "header", n))).toEqual(["header", "headerEven", "header", "headerEven"]);
  });

  it("lets the first page win when both are on", () => {
    const page = { differentFirstPage: true, differentOddEven: true };
    expect([1, 2, 3, 4].map((n) => regionKeyFor(page, "header", n))).toEqual(["headerFirst", "headerEven", "header", "headerEven"]);
  });

  it("returns the content, or nothing for a variant with none", () => {
    const doc = withRegions({ ...DEFAULT_PAGE, differentFirstPage: true }, { header: "H" });
    expect(regionBlocksFor(doc, "header", 1)).toBeUndefined();
    expect(plainText((regionBlocksFor(doc, "header", 2)![0] as unknown as { runs: Run[] }).runs)).toBe("H");
  });

  it("lists the regions in use and names them", () => {
    expect(activeRegionNames(undefined, "header")).toEqual(["header"]);
    expect(activeRegionNames({ differentFirstPage: true, differentOddEven: true }, "footer")).toEqual(["footer", "footerFirst", "footerEven"]);
    expect(regionLabel("header")).toBe("Header");
    expect(regionLabel("footerFirst")).toBe("First page footer");
    expect(regionLabel("headerEven")).toBe("Even page header");
  });
});

describe("session", () => {
  it("turns the options on and off in one undoable step each, keeping the content", () => {
    const session = new DocumentSession(withRegions(undefined, { headerFirst: "First" }));
    session.setRegionOptions({ differentFirstPage: true });
    expect(session.state.page?.differentFirstPage).toBe(true);
    expect(session.state.page?.size).toBe("letter");
    session.setRegionOptions({ differentFirstPage: false });
    expect(session.state.page).toEqual(DEFAULT_PAGE);
    expect(session.state.headerFirst).toBeDefined();
    session.undo();
    expect(session.state.page?.differentFirstPage).toBe(true);
    session.undo();
    expect(session.state.page).toBeUndefined();
  });

  it("does nothing when asked for what is already so", () => {
    const session = new DocumentSession();
    session.setRegionOptions({ differentOddEven: false });
    expect(session.canUndo).toBe(false);
  });

  it("sets and removes any region, with undo", () => {
    const session = new DocumentSession();
    session.setRegion("footerEven", [paragraph("E")]);
    expect(session.state.footerEven).toHaveLength(1);
    session.setRegion("footerEven", null);
    expect(session.state.footerEven).toBeUndefined();
    session.undo();
    expect(session.state.footerEven).toHaveLength(1);
  });

  it("inserts two or three borderless columns, aligned left, centre and right", () => {
    const session = new DocumentSession(createDoc("R", [paragraph("")]));
    session.select(caret(session.state.blocks[0]!.id, 0));
    session.insertColumns(3);
    const table = session.state.blocks.find((b) => b.type === "table") as TableBlock;
    expect(table.borders).toBe("none");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.cells.map((c) => (c.blocks[0] as { align?: string }).align)).toEqual([undefined, "center", "right"]);
    expect(session.selection!.focus.block).toBe(table.rows[0]!.cells[0]!.blocks[0]!.id);

    session.select(caret(session.state.blocks[session.state.blocks.length - 1]!.id, 0));
    session.insertColumns(2);
    const second = session.state.blocks.filter((b) => b.type === "table")[1] as TableBlock;
    expect(second.rows[0]!.cells.map((c) => (c.blocks[0] as { align?: string }).align)).toEqual([undefined, "right"]);
  });
});

describe("saving", () => {
  it("round-trips the new regions and options", () => {
    const doc = withRegions({ ...DEFAULT_PAGE, differentFirstPage: true, differentOddEven: true }, { header: "H", headerFirst: "HF", headerEven: "HE", footer: "F", footerFirst: "FF", footerEven: "FE" });
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("rejects a bad option and a malformed variant, naming the place", () => {
    const doc = withRegions(DEFAULT_PAGE, {});
    expect(() => validateDoc({ ...doc, page: { ...DEFAULT_PAGE, differentFirstPage: "yes" } })).toThrow(/differentFirstPage/);
    expect(() => validateDoc({ ...doc, headerEven: [{ id: "x", type: "nope" }] })).toThrow(/headerEven/);
    expect(() => validateDoc({ ...doc, headerSecond: [] })).toThrow();
  });
});

describe("Word export", () => {
  const files = (doc: Doc) => {
    const zip = unzipSync(toDocx(doc));
    return { names: Object.keys(zip).sort(), read: (name: string) => strFromU8(zip[name]!) };
  };

  it("writes one header and footer by default, as before", () => {
    const { names, read } = files(withRegions(undefined, { header: "H", footer: "F" }));
    expect(names).toEqual(expect.arrayContaining(["word/header1.xml", "word/footer1.xml"]));
    expect(names.filter((n) => /header|footer/.test(n))).toHaveLength(2);
    const body = read("word/document.xml");
    expect(body).toContain('w:headerReference w:type="default"');
    expect(body).not.toContain("titlePg");
    expect(read("word/settings.xml")).not.toContain("evenAndOddHeaders");
  });

  it("writes a first-page header with titlePg", () => {
    const { names, read } = files(withRegions({ ...DEFAULT_PAGE, differentFirstPage: true }, { header: "H", headerFirst: "First" }));
    const body = read("word/document.xml");
    expect(body).toMatch(/headerReference w:type="default" r:id="rIdHeader1"/);
    expect(body).toMatch(/headerReference w:type="first" r:id="rIdHeader2"/);
    expect(body).toContain("<w:titlePg/>");
    expect(read("word/header2.xml")).toContain("First");
    expect(read("word/header1.xml")).not.toContain("First");
    expect(read("word/settings.xml")).not.toContain("evenAndOddHeaders");
  });

  it("writes even pages with evenAndOddHeaders in the settings", () => {
    const { read } = files(withRegions({ ...DEFAULT_PAGE, differentOddEven: true }, { header: "Odd", headerEven: "Even", footerEven: "FE" }));
    expect(read("word/settings.xml")).toContain("<w:evenAndOddHeaders/>");
    expect(read("word/document.xml")).toContain('w:headerReference w:type="even"');
    expect(read("word/document.xml")).toContain('w:footerReference w:type="even"');
    expect(read("word/_rels/document.xml.rels")).toContain("settings.xml");
    expect(read("[Content_Types].xml")).toContain("/word/settings.xml");
    expect(read("[Content_Types].xml")).toContain("/word/footer1.xml");
  });

  it("leaves out variants that are switched off, and keeps the table-of-contents setting alongside", () => {
    const doc = { ...withRegions({ ...DEFAULT_PAGE, differentOddEven: true }, { header: "H", headerFirst: "unused", headerEven: "E" }), blocks: [{ id: "t", type: "toc" as const, levels: 2 }] };
    const { names, read } = files(doc as Doc);
    expect(names.filter((n) => /^word\/header\d\.xml$/.test(n))).toEqual(["word/header1.xml", "word/header2.xml"]);
    const settings = read("word/settings.xml");
    expect(settings).toContain("<w:evenAndOddHeaders/>");
    expect(settings).toContain("updateFields");
    expect(settings.indexOf("evenAndOddHeaders")).toBeLessThan(settings.indexOf("updateFields"));
  });

  it("keeps a table (columns) in a footer, with a paragraph after it", () => {
    const session = new DocumentSession(createDoc("F", [paragraph("")]));
    session.select(caret(session.state.blocks[0]!.id, 0));
    session.insertColumns(3);
    const doc = { ...createDoc("T", [paragraph("body")]), footer: session.state.blocks };
    const xml = files(doc).read("word/footer1.xml");
    expect(xml).toContain("<w:tbl>");
    expect(xml.slice(xml.lastIndexOf("</w:tbl>"))).toMatch(/^<\/w:tbl><w:p[ >\/]/);
  });
});

describe("print and HTML export", () => {
  it("prints one header and footer on every page by default", () => {
    const html = toHtml(withRegions(undefined, { header: "Title", footer: "Foot" }), { fullDocument: true });
    expect(html).toContain('@page { @top-left { content: "Title";');
    expect(html).not.toContain(":first");
    expect(html).not.toContain(":left");
  });

  it("blanks the first page unless it has its own", () => {
    const html = toHtml(withRegions({ ...DEFAULT_PAGE, differentFirstPage: true }, { header: "Title" }), { fullDocument: true });
    expect(html).toMatch(/@page :first \{[^}]*@top-left \{ content: none; \}/);
    const own = toHtml(withRegions({ ...DEFAULT_PAGE, differentFirstPage: true }, { header: "Title", headerFirst: "Cover" }), { fullDocument: true });
    expect(own).toMatch(/@page :first \{ @top-left \{ content: "Cover";/);
  });

  it("uses :right for odd pages and :left for even pages", () => {
    const html = toHtml(withRegions({ ...DEFAULT_PAGE, differentOddEven: true }, { header: "Odd", headerEven: "Even" }), { fullDocument: true });
    expect(html).toMatch(/@page :right \{ @top-left \{ content: "Odd";/);
    expect(html).toMatch(/@page :left \{ @top-left \{ content: "Even";/);
  });
});
