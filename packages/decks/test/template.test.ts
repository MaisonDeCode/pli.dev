import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, importTemplate, resolveSlide, resolveTemplate, scaleMaster, validateDeck, SIZE_STANDARD, SIZE_WIDESCREEN, type Deck, type ShapeElement } from "../src";
import { classic43, editPptx, googleExport, powerpointTemplate } from "./fixtures/build-pptx";

describe("importTemplate", () => {
  it("returns the masters of a PowerPoint template, its size and a sample deck", () => {
    const t = importTemplate(powerpointTemplate());
    expect(t.size).toEqual(SIZE_WIDESCREEN);
    expect(t.masters).toHaveLength(1);
    const m = t.masters[0]!;
    expect(m.name).toBe("Office Theme");
    expect(m.layouts.map((l) => l.name)).toEqual(["Title Slide", "Title and Content"]);
    expect(t.sampleDeck?.slides).toHaveLength(3);
    expect(t.sampleDeck?.masters[0]).toBe(m);
    expect(t.warnings).toEqual([]);
    expect(() => validateDeck(t.sampleDeck)).not.toThrow();
  });

  it("returns no sample deck for a template with no slides", () => {
    const bytes = editPptx(powerpointTemplate(), (p) => {
      for (const k of Object.keys(p)) if (/^ppt\/(slides|notesSlides)\//.test(k)) delete p[k];
      p["ppt/presentation.xml"] = (p["ppt/presentation.xml"] as string).replace(/<p:sldIdLst>.*<\/p:sldIdLst>/, "");
    });
    const t = importTemplate(bytes);
    expect(t.sampleDeck).toBeUndefined();
    expect(t.masters).toHaveLength(1);
    expect(t.masters[0]!.layouts).toHaveLength(2);
    // The masters still draw: resolve a layout as it is edited.
    const deck: Deck = { ...createDeck({ size: t.size, master: t.masters[0], firstSlide: false }) };
    const scene = resolveTemplate(deck, t.masters[0]!.layouts[1]!.id);
    expect(scene.elements.some((e) => e.placeholder?.type === "title")).toBe(true);
  });

  it("reads a Google Slides export: master name from the theme, layout names kept, a layout picture kept as a decoration", () => {
    const t = importTemplate(googleExport());
    expect(t.size).toEqual({ width: 720, height: 405 });
    const m = t.masters[0]!;
    expect(m.name).toBe("Simple Dark");
    expect(m.layouts.map((l) => l.name)).toContain("TITLE_AND_BODY");
    const withPicture = m.layouts.find((l) => l.name === "CUSTOM_1")!;
    expect(withPicture.elements.map((e) => e.type)).toEqual(["image"]);
    expect(withPicture.elements.some((e) => e.type === "shape" && e.placeholder)).toBe(false);
  });

  it("names the masters of a multi-master file apart", () => {
    const bytes = editPptx(classic43(), (p) => {
      // a second master that reuses the first one's theme and layouts under another file name
      p["ppt/slideMasters/slideMaster2.xml"] = p["ppt/slideMasters/slideMaster1.xml"] as string;
      p["ppt/slideMasters/_rels/slideMaster2.xml.rels"] = (p["ppt/slideMasters/_rels/slideMaster1.xml.rels"] as string).replace(/slideLayout(\d)/g, "slideLayout$1");
      p["ppt/_rels/presentation.xml.rels"] = (p["ppt/_rels/presentation.xml.rels"] as string).replace("</Relationships>", '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>');
      p["ppt/presentation.xml"] = (p["ppt/presentation.xml"] as string).replace("</p:sldMasterIdLst>", '<p:sldMasterId id="2147483900" r:id="rId99"/></p:sldMasterIdLst>');
    });
    const t = importTemplate(bytes);
    expect(t.masters).toHaveLength(2);
    expect(new Set(t.masters.map((m) => m.name)).size).toBe(2);
    expect(t.masters.every((m) => m.layouts.length > 0)).toBe(true);
  });

  it("gives a master that DeckSession.applyTheme and insert accept", () => {
    const t = importTemplate(googleExport());
    const s = new DeckSession(createDeck({ size: t.size }));
    s.applyTheme(t.masters[0]!);
    expect(s.deck.masters).toHaveLength(1);
    expect(s.deck.masters[0]!.name).toBe("Simple Dark");
    expect(s.deck.slides[0]!.layout).toBe(s.deck.masters[0]!.layouts.find((l) => l.kind === "title")!.id);
    const scene = resolveSlide(s.deck, s.deck.slides[0]!);
    expect(scene.background).toMatchObject({ kind: "gradient" });
    expect(() => validateDeck(s.deck)).not.toThrow();
    // the imported master is untouched (applyTheme clones it)
    expect(t.masters[0]!.id).not.toBe(s.deck.masters[0]!.id);
  });
});

describe("scaleMaster", () => {
  const t = importTemplate(powerpointTemplate());
  const master = t.masters[0]!;

  it("returns a copy when the size does not change", () => {
    const copy = scaleMaster(master, t.size, t.size);
    expect(copy).toEqual(master);
    expect(copy).not.toBe(master);
    expect(copy.elements[0]).not.toBe(master.elements[0]);
  });

  it("moves 16:9 to 4:3: x by the width ratio, y by the height ratio, text by the smaller", () => {
    const scaled = scaleMaster(master, SIZE_WIDESCREEN, SIZE_STANDARD);
    const bar = scaled.elements.find((e) => e.type === "shape" && !e.placeholder)!;
    expect(bar).toMatchObject({ x: 0, w: 720, y: 504, h: 36 });
    const title = scaled.elements.find((e): e is ShapeElement => e.type === "shape" && e.placeholder?.type === "title")!;
    const src = master.elements.find((e): e is ShapeElement => e.type === "shape" && e.placeholder?.type === "title")!;
    expect(title.x).toBeCloseTo(src.x! * 0.75, 2);
    expect(title.w).toBeCloseTo(src.w! * 0.75, 2);
    expect(title.y).toBeCloseTo(src.y!, 2);
    expect(scaled.textStyles.title[0]!.marks!.fontSize).toBe(33);
    expect(scaled.textStyles.body[0]!.marL).toBeCloseTo(master.textStyles.body[0]!.marL! * 0.75, 3);
    expect(scaled.textStyles.body[0]!.marks!.fontSize).toBe(21);
    // the source is untouched
    expect(master.textStyles.title[0]!.marks!.fontSize).toBe(44);
    expect(scaled.id).toBe(master.id);
    expect(scaled.layouts[0]!.id).toBe(master.layouts[0]!.id);
    const layoutTitle = scaled.layouts[0]!.elements.find((e): e is ShapeElement => e.type === "shape" && e.placeholder?.type === "ctrTitle")!;
    expect(layoutTitle.text!.levels![0]!.marks!.fontSize).toBe(45);
  });

  it("keeps text sized to the slide when a 4:3 master moves to 16:9", () => {
    const four = importTemplate(classic43());
    const wide = scaleMaster(four.masters[0]!, four.size, SIZE_WIDESCREEN);
    // the height does not change, so text keeps its size while boxes widen
    expect(wide.textStyles.title[0]!.marks!.fontSize).toBe(44);
    const title = wide.elements.find((e): e is ShapeElement => e.type === "shape" && e.placeholder?.type === "title")!;
    expect(title.w).toBeCloseTo((8229600 / 12700) * (960 / 720), 2);
  });

  it("lets a scaled master be used in a deck of the other size", () => {
    const scaled = scaleMaster(master, SIZE_WIDESCREEN, SIZE_STANDARD);
    const s = new DeckSession(createDeck({ size: SIZE_STANDARD }));
    s.applyTheme(scaled);
    const scene = resolveSlide(s.deck, s.deck.slides[0]!);
    expect(scene.width).toBe(720);
    for (const e of scene.elements) expect(e.x + e.w).toBeLessThanOrEqual(720.01);
    expect(() => validateDeck(s.deck)).not.toThrow();
  });

  it("scales tables, groups, images and lines in decorations", () => {
    const m = scaleMaster(
      {
        ...master,
        elements: [
          { type: "group", id: "g", x: 100, y: 100, w: 200, h: 100, children: [{ type: "shape", id: "c", geometry: "rect", x: 100, y: 100, w: 100, h: 50, line: { width: 2 } }] },
          { type: "table", id: "t", x: 0, y: 0, w: 200, h: 40, columns: [100, 100], rows: [{ h: 40, cells: [{ paragraphs: [{ runs: [{ text: "a", marks: { fontSize: 20 } }] }] }, { paragraphs: [{ runs: [] }] }] }] },
          { type: "image", id: "i", src: "data:image/png;base64,AA==", x: 10, y: 10, w: 100, h: 100 },
        ],
      },
      { width: 100, height: 100 },
      { width: 200, height: 50 },
    );
    const [g, tb, im] = m.elements;
    expect(g).toMatchObject({ x: 200, y: 50, w: 400, h: 50 });
    expect(g!.type === "group" && g.children[0]).toMatchObject({ x: 200, y: 50, w: 200, h: 25, line: { width: 1 } });
    expect(tb).toMatchObject({ columns: [200, 200] });
    expect(tb!.type === "table" && tb.rows[0]!.h).toBe(20);
    expect(tb!.type === "table" && tb.rows[0]!.cells[0]!.paragraphs[0]!.runs[0]!.marks!.fontSize).toBe(10);
    expect(im).toMatchObject({ x: 20, y: 5, w: 200, h: 50 });
  });
});
