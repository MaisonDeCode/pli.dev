import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  DEFAULT_PAGE,
  DocumentSession,
  caret,
  columnRuns,
  columnsAt,
  createDoc,
  paragraph,
  parseDoc,
  sectionBreak,
  sectionsOf,
  selectionState,
  serializeDoc,
  table,
  toDocx,
  toHtml,
  toMarkdown,
  validateDoc,
  type Block,
  type Columns,
  type Doc,
} from "../src";

/** Paragraphs "p0".."p4" with the given extra blocks between them, by position. */
function make(blocks: Block[], page?: Doc["page"]) {
  const s = new DocumentSession({ ...createDoc("T", blocks), ...(page && { page }) });
  return s;
}
const ps = (n: number) => Array.from({ length: n }, (_, i) => paragraph(`p${i}`));
const kinds = (s: DocumentSession) => s.state.blocks.map((b) => (b.type === "section_break" ? `|${b.kind === "continuous" ? "c" : "n"}${b.columns?.count ?? 1}` : "runs" in b ? b.runs.map((r) => r.text).join("") : b.type));
const two: Columns = { count: 2 };

describe("sections", () => {
  it("is one section when there are no breaks", () => {
    const doc = createDoc("T", ps(3));
    expect(sectionsOf(doc)).toEqual([{ from: 0, to: 3, columns: { count: 1, gap: 36, rule: false } }]);
  });

  it("splits at each break and takes each section's columns from the break before it", () => {
    const doc = createDoc("T", [paragraph("a"), sectionBreak("continuous", two), paragraph("b"), paragraph("c"), sectionBreak("next_page"), paragraph("d")]);
    const sections = sectionsOf({ ...doc, page: { ...DEFAULT_PAGE, columns: { count: 3, gap: 12 } } });
    expect(sections.map((s) => [s.from, s.to, s.columns.count])).toEqual([[0, 1, 3], [2, 4, 2], [5, 6, 1]]);
    expect(sections[0]!.columns.gap).toBe(12);
    expect(sections[1]!.start?.kind).toBe("continuous");
  });

  it("finds the columns at a block, with a break belonging to the section it starts", () => {
    const doc = createDoc("T", [paragraph("a"), sectionBreak("continuous", two), paragraph("b")]);
    expect([0, 1, 2].map((i) => columnsAt(doc, i).count)).toEqual([1, 2, 2]);
  });

  it("groups blocks in columns into runs that stop at page breaks", () => {
    const pb = { id: "pb", type: "page_break" as const };
    const doc = createDoc("T", [paragraph("a"), sectionBreak("continuous", two), paragraph("b"), paragraph("c"), pb, paragraph("d"), sectionBreak("continuous"), paragraph("e")]);
    expect(columnRuns(doc).map((r) => [r.from, r.to])).toEqual([[2, 4], [5, 6]]);
  });
});

describe("inserting a section break", () => {
  it("splits the section at the caret, and the new section keeps the columns", () => {
    const s = make(ps(3), { ...DEFAULT_PAGE, columns: two });
    s.select(caret(s.state.blocks[1]!.id, 1));
    s.insertSectionBreak("next_page");
    expect(kinds(s).filter((k) => k.startsWith("|"))).toEqual(["|n2"]);
    expect(sectionsOf(s.state).map((x) => x.columns.count)).toEqual([2, 2]);
    s.undo();
    expect(kinds(s)).toEqual(["p0", "p1", "p2"]);
  });

  it("is refused inside a table cell", () => {
    const t = table([["a"]]);
    const s = make([t]);
    s.select(caret(t.rows[0]!.cells[0]!.blocks[0]!.id, 0));
    expect(s.insertSectionBreak("continuous")).toBe(false);
  });
});

describe("setting columns", () => {
  it("with a caret sets the first section through the page, and later sections through their break", () => {
    const s = make([paragraph("a"), sectionBreak("continuous"), paragraph("b")]);
    s.select(caret(s.state.blocks[0]!.id, 0));
    s.setColumns(two);
    expect(s.state.page?.columns).toEqual(two);
    expect(s.state.page?.size).toBe("letter");
    s.select(caret(s.state.blocks[2]!.id, 0));
    s.setColumns({ count: 3, rule: true });
    expect((s.state.blocks[1] as { columns?: Columns }).columns).toEqual({ count: 3, rule: true });
    s.setColumns(null);
    expect((s.state.blocks[1] as { columns?: Columns }).columns).toBeUndefined();
    s.select(caret(s.state.blocks[0]!.id, 0));
    s.setColumns(null);
    expect(s.state.page).toEqual(DEFAULT_PAGE);
    expect(s.setColumns(null)).toBe(false);
  });

  it("with a selection in the middle, adds breaks above and below so the rest keeps its columns", () => {
    const s = make(ps(5));
    s.select({ anchor: { block: s.state.blocks[1]!.id, offset: 0 }, focus: { block: s.state.blocks[2]!.id, offset: 2 } });
    s.setColumns(two);
    expect(kinds(s)).toEqual(["p0", "|c2", "p1", "p2", "|c1", "p3", "p4"]);
    expect([0, 2, 5].map((i) => columnsAt(s.state, i).count)).toEqual([1, 2, 1]);
    s.undo();
    expect(kinds(s)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("with a selection from the top, uses the page for the first section and restores after it", () => {
    const s = make(ps(3));
    s.select({ anchor: { block: s.state.blocks[0]!.id, offset: 0 }, focus: { block: s.state.blocks[1]!.id, offset: 1 } });
    s.setColumns(two);
    expect(s.state.page?.columns).toEqual(two);
    expect(kinds(s)).toEqual(["p0", "p1", "|c1", "p2"]);
  });

  it("with a selection to the end, needs no break after", () => {
    const s = make(ps(3));
    s.select({ anchor: { block: s.state.blocks[1]!.id, offset: 0 }, focus: { block: s.state.blocks[2]!.id, offset: 2 } });
    s.setColumns(two);
    expect(kinds(s)).toEqual(["p0", "|c2", "p1", "p2"]);
  });

  it("reuses an existing break at the edge instead of adding another", () => {
    const s = make([paragraph("a"), sectionBreak("next_page"), paragraph("b"), paragraph("c")]);
    s.select({ anchor: { block: s.state.blocks[2]!.id, offset: 0 }, focus: { block: s.state.blocks[3]!.id, offset: 1 } });
    s.setColumns(two);
    expect(kinds(s)).toEqual(["a", "|n2", "b", "c"]);
  });

  it("changes breaks inside a selection too, so the whole selection is uniform", () => {
    const s = make([paragraph("a"), paragraph("b"), sectionBreak("continuous", { count: 3 }), paragraph("c"), paragraph("d")]);
    s.select({ anchor: { block: s.state.blocks[1]!.id, offset: 0 }, focus: { block: s.state.blocks[3]!.id, offset: 1 } });
    s.setColumns(two);
    // The text after the selection ("d") keeps the three columns it had.
    expect(kinds(s)).toEqual(["a", "|c2", "b", "|c2", "c", "|c3", "d"]);
  });

  it("clamps the count to what the model allows and reports the section's columns", () => {
    const s = make(ps(2));
    s.select(caret(s.state.blocks[0]!.id, 0));
    s.setColumns({ count: 9 });
    expect(selectionState(s.state, s.selection).columns.count).toBe(4);
  });
});

describe("saving sections", () => {
  it("round-trips", () => {
    const doc = { ...createDoc("T", [paragraph("a"), sectionBreak("next_page", { count: 2, gap: 20, rule: true }), paragraph("b")]), page: { ...DEFAULT_PAGE, columns: { count: 3 } } };
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
  });

  it("rejects bad columns, a bad kind, and a break in a cell or a header", () => {
    const base = createDoc("T", [paragraph("a")]);
    expect(() => validateDoc({ ...base, page: { ...DEFAULT_PAGE, columns: { count: 5 } } })).toThrow(/count/);
    expect(() => validateDoc({ ...base, blocks: [{ id: "x", type: "section_break", kind: "sideways" }] })).toThrow(/kind/);
    expect(() => validateDoc({ ...base, blocks: [{ id: "x", type: "section_break", kind: "continuous", columns: { count: 2, gap: -1 } }] })).toThrow(/gap/);
    expect(() => validateDoc({ ...base, header: [{ id: "h", type: "section_break", kind: "continuous" }] })).toThrow(/header/);
    const t = table([["a"]]);
    t.rows[0]!.cells[0]!.blocks.push({ id: "y", type: "section_break", kind: "continuous" } as never);
    expect(() => validateDoc({ ...base, blocks: [t] })).toThrow(/table cell/);
  });
});

describe("exporting sections", () => {
  const files = (doc: Doc) => {
    const zip = unzipSync(toDocx(doc));
    return (name: string) => strFromU8(zip[name]!);
  };

  it("Word: a section's properties close it, and the last section's close the body", () => {
    const doc = {
      ...createDoc("T", [paragraph("one"), sectionBreak("continuous", { count: 2, gap: 18, rule: true }), paragraph("two"), sectionBreak("next_page"), paragraph("three")]),
      header: [paragraph("Head")],
      page: { ...DEFAULT_PAGE, differentFirstPage: true },
    };
    const xml = files(doc)("word/document.xml");
    const sects = [...xml.matchAll(/<w:sectPr>(.*?)<\/w:sectPr>/g)].map((m) => m[1]!);
    expect(sects).toHaveLength(3);
    // First section: one column, the header, the first-page setting, and it starts on a new page by default.
    expect(sects[0]).toContain("<w:headerReference");
    expect(sects[0]).toContain("<w:titlePg/>");
    expect(sects[0]).not.toContain("<w:cols");
    expect(sects[0]).not.toContain("<w:type");
    // Second: two columns with a line, starting continuously. No header or first-page setting repeated.
    expect(sects[1]).toContain('<w:type w:val="continuous"/>');
    expect(sects[1]).toContain('<w:cols w:num="2" w:space="360" w:sep="1"/>');
    expect(sects[1]).not.toContain("headerReference");
    expect(sects[1]).not.toContain("titlePg");
    // Third: back to one column, a next-page start (Word's default).
    expect(sects[2]).not.toContain("<w:cols");
    expect(sects[2]).not.toContain("<w:type");
    // The first two live in paragraphs, in order, and the last closes the body.
    expect(xml.indexOf(sects[0]!)).toBeLessThan(xml.indexOf("two"));
    expect(xml.indexOf(sects[1]!)).toBeLessThan(xml.indexOf("three"));
    expect(xml.trimEnd().endsWith(`<w:sectPr>${sects[2]}</w:sectPr></w:body></w:document>`)).toBe(true);
  });

  it("Word: a document with no breaks has the one section properties, as before, with page-level columns", () => {
    const doc = { ...createDoc("T", [paragraph("x")]), page: { ...DEFAULT_PAGE, columns: { count: 3 } } };
    const xml = files(doc)("word/document.xml");
    expect([...xml.matchAll(/<w:sectPr>/g)]).toHaveLength(1);
    expect(xml).toContain('<w:cols w:num="3" w:space="720"/>');
  });

  it("HTML: sections with columns or a new page are wrapped to say so", () => {
    const doc = { ...createDoc("T", [paragraph("a"), sectionBreak("next_page", { count: 2, gap: 18, rule: true }), paragraph("b"), sectionBreak("continuous"), paragraph("c")]) };
    const html = toHtml(doc);
    expect(html).toContain('<div class="section" style="break-before:page;column-count:2;column-gap:18pt;column-rule:1px solid #bbb">');
    expect(html.indexOf("<p>a</p>")).toBeLessThan(html.indexOf("column-count"));
    expect(html.match(/<div class="section"/g)).toHaveLength(1);
    expect(html).toContain("<p>c</p>");
  });

  it("Markdown: leaves breaks out", () => {
    const md = toMarkdown(createDoc("T", [paragraph("a"), sectionBreak("next_page", { count: 2 }), paragraph("b")]));
    expect(md).toBe("a\n\nb\n");
  });
});

describe("deleting a section break", () => {
  it("joins the sections: the text after it takes the columns of the section above", () => {
    const s = make([paragraph("a"), sectionBreak("continuous", two), paragraph("b")]);
    s.select(caret(s.state.blocks[2]!.id, 0));
    s.backspace();
    expect(kinds(s)).toEqual(["a", "b"]);
    expect(s.state.blocks.some((b) => b.type === "section_break")).toBe(false);
    expect(sectionsOf(s.state)).toHaveLength(1);
    s.undo();
    expect(sectionsOf(s.state)).toHaveLength(2);
  });
});

describe("finding a section by block", () => {
  it("numbers sections from 0, with a break in the section it starts", async () => {
    const { sectionIndexAt } = await import("../src");
    const doc = createDoc("T", [paragraph("a"), sectionBreak("continuous"), paragraph("b"), paragraph("c"), sectionBreak("next_page"), paragraph("d")]);
    expect([0, 1, 2, 3, 4, 5].map((i) => sectionIndexAt(doc, i))).toEqual([0, 1, 1, 1, 2, 2]);
  });
});
