import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  DEFAULT_PAGE,
  DocumentSession,
  createDoc,
  paragraph,
  parseDoc,
  sameShape,
  sectionBreak,
  sectionShape,
  sectionsOf,
  serializeDoc,
  startsOnNewPage,
  toDocx,
  toHtml,
  validateDoc,
  type Doc,
  type SectionShape,
} from "../src";

const letter: SectionShape = { size: "letter", orientation: "portrait", margins: { top: 1, right: 1, bottom: 1, left: 1 } };
const landscapeA4: SectionShape = { size: "a4", orientation: "landscape", margins: { top: 0.5, right: 0.75, bottom: 0.5, left: 0.75 } };

function three(): DocumentSession {
  return new DocumentSession(createDoc("T", [paragraph("a"), sectionBreak("continuous"), paragraph("b"), sectionBreak("continuous"), paragraph("c")]));
}

describe("a section's page shape", () => {
  it("is the document's until a section sets its own, and later sections follow the one before", () => {
    const s = three();
    s.setPageShape(landscapeA4, 1);
    const sections = sectionsOf(s.state);
    expect([0, 1, 2].map((i) => sectionShape(s.state, sections, i).size)).toEqual(["letter", "a4", "letter"]);
  });

  it("starts a section whose pages differ on a new page, even for a continuous break", () => {
    const s = three();
    s.setPageShape(landscapeA4, 1);
    const sections = sectionsOf(s.state);
    expect([0, 1, 2].map((i) => startsOnNewPage(s.state, sections, i))).toEqual([false, true, true]);
    expect(sectionsOf(createDoc("T", [paragraph("x")])).length).toBe(1);
  });

  it("compares shapes by every value", () => {
    expect(sameShape(letter, { ...letter, margins: { ...letter.margins } })).toBe(true);
    expect(sameShape(letter, { ...letter, margins: { ...letter.margins, left: 1.25 } })).toBe(false);
    expect(sameShape(letter, { ...letter, orientation: "landscape" })).toBe(false);
  });
});

describe("setting page shapes", () => {
  it("sets one section and leaves the others as they were, in one undo step", () => {
    const s = three();
    s.setPageShape(landscapeA4, 1);
    const sections = sectionsOf(s.state);
    // The third section had followed the second, so it keeps what it had: Letter.
    expect(sectionShape(s.state, sections, 2)).toEqual(letter);
    expect(sections[2]!.start?.page).toEqual({ size: "letter", orientation: "portrait", margins: letter.margins });
    s.undo();
    expect(sectionsOf(s.state).every((x) => !x.start?.page)).toBe(true);
  });

  it("sets the first section through the document, keeping its other settings", () => {
    const s = new DocumentSession({ ...three().state, page: { ...DEFAULT_PAGE, columns: { count: 2 }, differentFirstPage: true } });
    s.setPageShape(landscapeA4, 0);
    expect(s.state.page).toMatchObject({ size: "a4", orientation: "landscape", columns: { count: 2 }, differentFirstPage: true });
    // The second section had followed the first.
    expect(sectionShape(s.state, sectionsOf(s.state), 1)).toEqual(letter);
  });

  it("sets the whole document and clears every section's own setting", () => {
    const s = three();
    s.setPageShape(landscapeA4, 1);
    s.setPageShape({ ...letter, size: "legal" }, "document");
    expect(sectionsOf(s.state).every((x) => !x.start?.page)).toBe(true);
    expect([0, 1, 2].map((i) => sectionShape(s.state, sectionsOf(s.state), i).size)).toEqual(["legal", "legal", "legal"]);
  });

  it("does nothing when nothing changes, and refuses a section that doesn't exist", () => {
    const s = three();
    s.setPageShape(letter, 1);
    expect(s.canUndo).toBe(false);
    expect(() => s.setPageShape(letter, 9)).toThrow(/No section 9/);
  });
});

describe("saving page shapes", () => {
  it("round-trips", () => {
    const s = three();
    s.setPageShape(landscapeA4, 1);
    expect(parseDoc(serializeDoc(s.state))).toEqual(s.state);
  });

  it("rejects a bad size, orientation or margin", () => {
    const withPage = (page: unknown): Doc => ({ ...createDoc("T", [paragraph("a"), { id: "b", type: "section_break", kind: "continuous", page } as never, paragraph("c")]) });
    expect(() => validateDoc(withPage({ size: "tabloid" }))).toThrow(/size/);
    expect(() => validateDoc(withPage({ orientation: "sideways" }))).toThrow(/orientation/);
    expect(() => validateDoc(withPage({ margins: { top: 1, right: 1, bottom: 1, left: 9 } }))).toThrow(/left/);
    expect(() => validateDoc(withPage({ extra: 1 }))).toThrow();
    expect(validateDoc(withPage({ size: "a4" }))).toBeTruthy();
  });
});

describe("exporting page shapes", () => {
  const sections = (doc: Doc) => {
    const xml = strFromU8(unzipSync(toDocx(doc))["word/document.xml"]!);
    return [...xml.matchAll(/<w:sectPr>(.*?)<\/w:sectPr>/g)].map((m) => m[1]!);
  };

  it("Word: each section has its own size and margins, and a changed shape starts a new page", () => {
    const s = three();
    s.setPageShape(landscapeA4, 1);
    const [first, second, third] = sections(s.state);
    expect(first).toContain('w:w="12240" w:h="15840"');
    expect(first).toContain('w:top="1440" w:right="1440"');
    // A4 landscape: 11.69 x 8.27 in, 0.5 / 0.75 in margins; and the continuous break became a new page.
    expect(second).toContain('w:orient="landscape"');
    expect(second).toMatch(/w:w="16834" w:h="11909"/);
    expect(second).toContain('w:top="720" w:right="1080" w:bottom="720" w:left="1080"');
    expect(second).not.toContain("continuous");
    expect(third).toContain('w:w="12240" w:h="15840"');
    expect(third).not.toContain("continuous");
  });

  it("Word: a continuous section with the same shape stays continuous", () => {
    const [, second] = sections(three().state);
    expect(second).toContain('<w:type w:val="continuous"/>');
  });

  it("HTML: sections with their own shape get a named page", () => {
    const s = three();
    s.setPageShape(landscapeA4, 1);
    const html = toHtml(s.state, { fullDocument: true });
    expect(html).toContain("@page section2 { size: 11.69in 8.27in; margin: 0.5in 0.75in 0.5in 0.75in; }");
    expect(html).toContain("page:section2");
    // The third section is back to the first's shape, so it uses the plain page.
    expect(html).not.toContain("@page section3");
    expect(toHtml(three().state, { fullDocument: true })).not.toContain("@page section");
  });
});
