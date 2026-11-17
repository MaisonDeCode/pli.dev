import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  DEFAULT_PAGE,
  DocumentSession,
  createDoc,
  hasFirstPageRegions,
  isRegionLinked,
  paragraph,
  parseDoc,
  plainText,
  regionKeyFor,
  resolveRegion,
  sectionBreak,
  sectionsOf,
  serializeDoc,
  toDocx,
  validateDoc,
  type Block,
  type Doc,
} from "../src";

const text = (blocks: Block[] | undefined) => (blocks ?? []).map((b) => ("runs" in b ? plainText(b.runs) : b.type)).join("|");

/** Three sections; the document's header is "Doc head". */
function three(): Doc {
  return {
    ...createDoc("T", [paragraph("a"), sectionBreak("next_page"), paragraph("b"), sectionBreak("next_page"), paragraph("c")]),
    header: [paragraph("Doc head")],
  };
}

describe("a section's headers and footers", () => {
  it("shows the document's until a section has its own, and a section without its own shows the one before", () => {
    const s = new DocumentSession(three());
    const sections = sectionsOf(s.state);
    expect([0, 1, 2].map((i) => resolveRegion(s.state, sections, i, "header").owner)).toEqual([0, 0, 0]);
    s.setSectionRegion(1, "header", [paragraph("Chapter 2")]);
    const after = sectionsOf(s.state);
    expect([0, 1, 2].map((i) => text(resolveRegion(s.state, after, i, "header").blocks))).toEqual(["Doc head", "Chapter 2", "Chapter 2"]);
    expect([0, 1, 2].map((i) => resolveRegion(s.state, after, i, "header").owner)).toEqual([0, 1, 1]);
    expect([0, 1, 2].map((i) => isRegionLinked(after, i, "header"))).toEqual([false, false, true]);
    expect(isRegionLinked(after, 1, "footer")).toBe(true);
  });

  it("links back to the previous section with null, and the change is one undo step", () => {
    const s = new DocumentSession(three());
    s.setSectionRegion(1, "header", [paragraph("Own")]);
    s.setSectionRegion(1, "header", null);
    const sections = sectionsOf(s.state);
    expect(resolveRegion(s.state, sections, 1, "header").owner).toBe(0);
    expect(sections[1]!.start?.regions).toBeUndefined();
    s.undo();
    expect(text(resolveRegion(s.state, sectionsOf(s.state), 1, "header").blocks)).toBe("Own");
  });

  it("can be blank on purpose, without falling back to the previous section", () => {
    const s = new DocumentSession(three());
    s.setSectionRegion(1, "header", []);
    const sections = sectionsOf(s.state);
    const r = resolveRegion(s.state, sections, 1, "header");
    expect(r).toEqual({ blocks: [], owner: 1 });
    expect(isRegionLinked(sections, 1, "header")).toBe(false);
  });

  it("sets the first section's through the document", () => {
    const s = new DocumentSession(three());
    s.setSectionRegion(0, "footer", [paragraph("Foot")]);
    expect(text(s.state.footer)).toBe("Foot");
    s.setSectionRegion(0, "footer", null);
    expect(s.state.footer).toBeUndefined();
  });

  it("rejects a section that doesn't exist", () => {
    const s = new DocumentSession(three());
    expect(() => s.setSectionRegion(7, "header", [])).toThrow(/No section 7/);
    expect(() => s.setSectionFirstPage(7, true)).toThrow(/No section 7/);
  });

  it("has its own first-page setting", () => {
    const s = new DocumentSession(three());
    s.setSectionFirstPage(1, true);
    s.setSectionFirstPage(0, true);
    const sections = sectionsOf(s.state);
    expect([0, 1, 2].map((i) => hasFirstPageRegions(s.state, sections, i))).toEqual([true, true, false]);
    s.setSectionFirstPage(1, false);
    expect(sectionsOf(s.state)[1]!.start?.differentFirstPage).toBeUndefined();
  });

  it("uses the first page's header on the first page of the section, not only page 1", () => {
    const page = { differentFirstPage: true };
    expect(regionKeyFor(page, "header", 4, true)).toBe("headerFirst");
    expect(regionKeyFor(page, "header", 5, false)).toBe("header");
    expect(regionKeyFor(page, "header", 1)).toBe("headerFirst");
    expect(regionKeyFor({ differentOddEven: true }, "header", 6, false)).toBe("headerEven");
  });
});

describe("saving section headers and footers", () => {
  it("round-trips", () => {
    const s = new DocumentSession(three());
    s.setSectionRegion(1, "header", [paragraph("Own")]);
    s.setSectionRegion(2, "footerFirst", []);
    s.setSectionFirstPage(2, true);
    expect(parseDoc(serializeDoc(s.state))).toEqual(s.state);
  });

  it("rejects an unknown region, a bad block, and a section break inside one", () => {
    const base = three();
    const withRegions = (regions: unknown): Doc => ({ ...base, blocks: base.blocks.map((b) => (b.type === "section_break" ? { ...b, regions } : b)) as Block[] });
    expect(() => validateDoc(withRegions({ headerThird: [] }))).toThrow(/headerThird/);
    expect(() => validateDoc(withRegions({ header: [{ id: "x", type: "nope" }] }))).toThrow(/header/);
    expect(() => validateDoc(withRegions({ header: [{ id: "x", type: "section_break", kind: "continuous" }] }))).toThrow(/can't hold a section break/);
  });
});

describe("Word export of section headers and footers", () => {
  const read = (doc: Doc) => {
    const zip = unzipSync(toDocx(doc));
    return { names: Object.keys(zip), get: (n: string) => strFromU8(zip[n]!) };
  };

  it("lists a section's own headers in its properties, and leaves the others to inherit", () => {
    const s = new DocumentSession(three());
    s.setSectionRegion(1, "header", [paragraph("Chapter 2")]);
    const { get, names } = read(s.state);
    const sects = [...get("word/document.xml").matchAll(/<w:sectPr>(.*?)<\/w:sectPr>/g)].map((m) => m[1]!);
    expect(sects).toHaveLength(3);
    expect(sects[0]).toContain('w:headerReference w:type="default"');
    expect(sects[1]).toContain('w:headerReference w:type="default"');
    expect(sects[2]).not.toContain("headerReference");
    expect(names.filter((n) => /^word\/header\d\.xml$/.test(n))).toHaveLength(2);
    const files = names.filter((n) => /^word\/header\d\.xml$/.test(n)).map((n) => get(n));
    expect(files.some((x) => x.includes("Chapter 2"))).toBe(true);
    expect(files.some((x) => x.includes("Doc head"))).toBe(true);
  });

  it("writes a blank part for a section that is empty on purpose, so it doesn't inherit", () => {
    const s = new DocumentSession(three());
    s.setSectionRegion(1, "header", []);
    const { get, names } = read(s.state);
    expect(names.filter((n) => /^word\/header\d\.xml$/.test(n))).toHaveLength(2);
    const sects = [...get("word/document.xml").matchAll(/<w:sectPr>(.*?)<\/w:sectPr>/g)].map((m) => m[1]!);
    expect(sects[1]).toContain("headerReference");
  });

  it("sets the first-page header and titlePg per section", () => {
    const s = new DocumentSession(three());
    s.setSectionFirstPage(1, true);
    s.setSectionRegion(1, "headerFirst", [paragraph("Opening")]);
    const { get } = read(s.state);
    const sects = [...get("word/document.xml").matchAll(/<w:sectPr>(.*?)<\/w:sectPr>/g)].map((m) => m[1]!);
    expect(sects[0]).not.toContain("titlePg");
    expect(sects[1]).toContain("<w:titlePg/>");
    expect(sects[1]).toContain('w:type="first"');
    expect(sects[2]).not.toContain("titlePg");
  });

  it("is unchanged for one section", () => {
    const doc = { ...createDoc("T", [paragraph("x")]), header: [paragraph("H")], page: { ...DEFAULT_PAGE, differentFirstPage: true }, headerFirst: [paragraph("F")] };
    const { get, names } = read(doc);
    expect(names.filter((n) => /^word\/header\d\.xml$/.test(n))).toHaveLength(2);
    expect(get("word/document.xml")).toContain("<w:titlePg/>");
  });
});
