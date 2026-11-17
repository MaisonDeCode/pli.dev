import { describe, expect, it } from "vitest";
import { PliError } from "@pli.dev/core";
import { DeckSession, fromPptx, resolveSlide, validateDeck, type Deck, type ShapeElement, type Slide } from "../src";
import { classic43, googleExport, powerpointTemplate, GOOGLE_COLORS, POWERPOINT_TITLE } from "./fixtures/build-pptx";

const shapes = (s: Slide) => s.elements.filter((e): e is ShapeElement => e.type === "shape");
const byPh = (s: Slide, type: string) => shapes(s).find((e) => e.placeholder?.type === type)!;
const text = (e: ShapeElement) => e.text!.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
const layoutOf = (deck: Deck, s: Slide) => deck.masters.flatMap((m) => m.layouts).find((l) => l.id === s.layout)!;

describe("fromPptx: a PowerPoint-style file", () => {
  const { deck, warnings } = fromPptx(powerpointTemplate());

  it("is a valid deck with the file's size, theme, masters and layouts", () => {
    expect(() => validateDeck(deck)).not.toThrow();
    expect(deck.size).toEqual({ width: 960, height: 540 });
    expect(deck.masters).toHaveLength(1);
    const m = deck.masters[0]!;
    expect(m.name).toBe("Office Theme");
    expect(m.theme.colors.accent1).toBe("#4472c4");
    expect(m.theme.colors.dk1).toBe("#000000");
    expect(m.theme.colors.lt1).toBe("#ffffff");
    expect(m.theme.fonts).toEqual({ major: "Calibri Light", minor: "Calibri" });
    expect(m.layouts.map((l) => [l.name, l.kind])).toEqual([["Title Slide", "title"], ["Title and Content", "titleAndBody"]]);
    expect(warnings).toEqual([]);
  });

  it("reads the master background from bgRef and its decoration", () => {
    const m = deck.masters[0]!;
    // bgRef idx 1001 is the first background fill style (solid phClr) coloured by bg1, which the map sends to lt1.
    expect(m.background).toEqual({ theme: "lt1" });
    const bar = m.elements.find((e) => e.type === "shape" && !e.placeholder)!;
    expect(bar).toMatchObject({ x: 0, w: 960, h: 36 });
    expect((bar as ShapeElement).fill).toEqual({ theme: "accent1" });
  });

  it("reads text styles with sizes, spacing, bullets and fonts", () => {
    const m = deck.masters[0]!;
    expect(m.textStyles.title[0]).toMatchObject({ align: "left", lineSpacing: 0.9, spaceBefore: 0, bullet: null });
    expect(m.textStyles.title[0]!.marks).toMatchObject({ fontSize: 44, fontFamily: "+mj-lt", color: { theme: "dk1" } });
    const l1 = m.textStyles.body[0]!;
    expect(l1.marks!.fontSize).toBe(28);
    expect(l1.marL).toBe(18);
    expect(l1.indent).toBe(-18);
    expect(l1.spaceBefore).toBe(10);
    expect(l1.bullet).toMatchObject({ type: "char", char: "•", font: "Arial" });
    expect(m.textStyles.body[1]!.marks!.fontSize).toBe(24);
    expect(deck.defaultTextStyle![0]!.marks).toMatchObject({ fontSize: 18, fontFamily: "+mn-lt" });
  });

  it("reads placeholders with frames, anchors and level styles, and drops stock prompt text", () => {
    const layout = deck.masters[0]!.layouts[0]!;
    const title = layout.elements.find((e): e is ShapeElement => e.type === "shape" && e.placeholder?.type === "ctrTitle")!;
    expect(title).toMatchObject({ x: 120, w: 720 });
    expect(title.text!.vAlign).toBe("bottom");
    expect(title.text!.levels![0]).toMatchObject({ align: "center", marks: { fontSize: 60 } });
    // "Click to edit Master title style" is stock text: not kept as a prompt.
    expect(text(title)).toBe("");
    const sub = layout.elements.find((e): e is ShapeElement => e.type === "shape" && e.placeholder?.type === "subTitle")!;
    expect(sub.placeholder!.idx).toBe(1);
    expect(sub.text!.levels![0]).toMatchObject({ marL: 0, indent: 0, bullet: null });
    expect(text(sub)).toBe("");
  });

  it("reads slides: placeholders inherit their frames, shapes get their style colours", () => {
    expect(deck.slides).toHaveLength(3);
    const [s1, s2, s3] = deck.slides as [Slide, Slide, Slide];
    expect(layoutOf(deck, s1).kind).toBe("title");
    expect(text(byPh(s1, "ctrTitle"))).toBe(POWERPOINT_TITLE);
    expect(byPh(s1, "ctrTitle").x).toBeUndefined();
    expect(layoutOf(deck, s2).name).toBe("Title and Content");
    const body = byPh(s2, "obj");
    expect(body.placeholder).toEqual({ type: "obj", idx: 1 });
    expect(body.text!.autofit).toBe("shrink");
    expect(body.text!.paragraphs.map((p) => p.level ?? 0)).toEqual([0, 1, 0]);
    const card = shapes(s2).find((e) => !e.placeholder)!;
    expect(card.geometry).toBe("roundRect");
    expect(card.adjust).toEqual({ adj: 25000 });
    expect(card.fill).toEqual({ theme: "accent1" });
    expect(card.line).toMatchObject({ width: 1, color: { theme: "accent1", shade: 0.5 } });
    // The style's fontRef makes its text white (lt1).
    expect(card.text!.levels![0]!.marks!.color).toEqual({ theme: "lt1" });
    expect(card.text!.paragraphs[0]!.align).toBe("center");
    expect(s3.skipped).toBe(true);
    expect(s2.skipped).toBeUndefined();
  });

  it("reads pictures (with crop and alt text), notes and transitions", () => {
    const s2 = deck.slides[1]!;
    const img = s2.elements.find((e) => e.type === "image")!;
    expect(img.type === "image" && img.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(img).toMatchObject({ x: expect.closeTo(78.74, 1), alt: "Sample chart image" });
    expect((img as { crop: unknown }).crop).toEqual({ l: 0.1, t: 0.05, r: 0.1, b: 0.05 });
    expect(s2.notes).toBe("Mention the new regions.\nKeep it under two minutes.");
    expect(deck.slides[0]!.notes).toBe("");
    expect(s2.transition).toEqual({ type: "fade", duration: 2000 });
    expect(deck.slides[2]!.transition).toEqual({ type: "push", direction: "down", advanceAfter: 5000 });
  });

  it("resolves a slide title through the layout and master to size, colour, font and frame", () => {
    const scene = resolveSlide(deck, deck.slides[1]!, { slideNumber: 2, slideCount: 3 });
    const title = scene.elements.find((e) => e.placeholder?.type === "title")!;
    const run = title.text!.paragraphs[0]!.runs[0]!;
    expect(run).toMatchObject({ fontSize: 44, fontFamily: "Calibri Light", color: "#000000", text: "Highlights" });
    expect(title).toMatchObject({ x: 66, y: expect.closeTo(28.75, 1), w: 828 });
    expect(title.text!.vAlign).toBe("middle");
    const body = scene.elements.find((e) => e.placeholder?.type === "obj")!;
    const p0 = body.text!.paragraphs[0]!;
    expect(p0.runs[0]).toMatchObject({ fontSize: 28, fontFamily: "Calibri" });
    expect(p0.bullet?.label).toBe("•");
    expect(p0.lineSpacing).toBe(0.9);
    expect(body.text!.paragraphs[1]!.runs[0]!.fontSize).toBe(24);
    expect(scene.background).toMatchObject({ kind: "solid", color: "#ffffff" });
    const card = scene.elements.find((e) => e.geometry === "roundRect")!;
    expect(card.fill).toMatchObject({ kind: "solid", color: "#4472c4" });
    expect(card.text!.paragraphs[0]!.runs[0]!.color).toBe("#ffffff");
    // the accent bar from the master is drawn, the placeholders are not
    expect(scene.elements.some((e) => e.from === "master" && e.h === 36)).toBe(true);
  });

  it("makes every id fresh and unique", () => {
    const ids = new Set<string>();
    const add = (id: string) => {
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    };
    add(deck.id);
    for (const m of deck.masters) {
      add(m.id);
      for (const l of m.layouts) add(l.id);
    }
    for (const s of deck.slides) add(s.id);
    const other = fromPptx(powerpointTemplate()).deck;
    expect(other.slides[0]!.id).not.toBe(deck.slides[0]!.id);
  });

  it("works with DeckSession.applyTheme and edits", () => {
    const g = fromPptx(googleExport()).deck;
    const s = new DeckSession(g);
    s.applyTheme(deck.masters[0]!);
    expect(s.deck.masters).toHaveLength(1);
    expect(s.deck.masters[0]!.name).toBe("Office Theme");
    expect(() => validateDeck(s.deck)).not.toThrow();
    // slides map to the layouts of the same kind
    const kinds = s.deck.slides.map((x) => layoutOf(s.deck, x).kind);
    expect(kinds).toEqual(["title", "titleAndBody", "titleAndBody"]);
  });
});

describe("fromPptx: a Google Slides export", () => {
  const { deck, warnings } = fromPptx(googleExport());

  it("reads the size, theme name and fonts", () => {
    expect(() => validateDeck(deck)).not.toThrow();
    expect(deck.size).toEqual({ width: 720, height: 405 });
    const m = deck.masters[0]!;
    expect(m.name).toBe("Simple Dark");
    expect(m.theme.fonts).toEqual({ major: "Roboto", minor: "Roboto" });
  });

  it("keeps capitalised layout names and works out their kinds", () => {
    const layouts = deck.masters[0]!.layouts;
    expect(layouts.map((l) => l.name)).toEqual(["TITLE", "SECTION_HEADER", "TITLE_AND_BODY", "TITLE_AND_TWO_COLUMNS", "TITLE_ONLY", "BLANK", "CUSTOM_1"]);
    expect(layouts.map((l) => l.kind)).toEqual(["title", "sectionHeader", "titleAndBody", "titleAndTwoColumns", "titleOnly", "blank", "blank"]);
  });

  it("applies the colour map: bg1 is dk1 and tx1 is lt1", () => {
    const m = deck.masters[0]!;
    expect(m.background).toEqual({ theme: "dk1" });
    expect(m.textStyles.title[0]!.marks!.color).toEqual({ theme: "lt1" });
    expect(m.textStyles.body[0]!.marks!.color).toEqual({ theme: "lt2" });
    const grad = deck.masters[0]!.layouts[0]!.background;
    expect(grad).toEqual({ gradient: { kind: "linear", angle: 90, stops: [{ at: 0, color: { theme: "dk1" } }, { at: 1, color: { theme: "dk2" } }] } });
    const scene = resolveSlide(deck, deck.slides[1]!);
    expect(scene.background).toMatchObject({ kind: "solid", color: `#${GOOGLE_COLORS.dk1.toLowerCase()}` });
    const title = scene.elements.find((e) => e.placeholder?.type === "title")!;
    expect(title.text!.paragraphs[0]!.runs[0]).toMatchObject({ color: "#ffffff", fontFamily: "Roboto", fontSize: 36, bold: true });
  });

  it("reads absolute placeholders, bullets, line spacing, links, breaks and notes", () => {
    const s2 = deck.slides[1]!;
    const body = byPh(s2, "body");
    expect(body).toMatchObject({ x: expect.closeTo(24.5, 0), w: expect.closeTo(670.9, 1) });
    const p0 = body.text!.paragraphs[0]!;
    expect(p0).toMatchObject({ marL: 36, indent: -27, lineSpacing: 1.15, bullet: { type: "char", char: "●", size: 100 } });
    expect(p0.runs[1]!.marks).toMatchObject({ link: "https://example.com/community", underline: true });
    const p1 = body.text!.paragraphs[1]!;
    expect(p1.level).toBe(1);
    expect(p1.runs.map((r) => r.text).join("")).toBe("Host four events\nand two workshops");
    expect(p1.spaceBefore).toBe(16);
    expect(s2.notes).toBe("First goal.\n\nSecond goal.");
    expect(deck.slides[0]!.notes).toBe("Welcome everyone.");
  });

  it("reads a table, a group (children in slide coordinates), a line and a text box", () => {
    const s2 = deck.slides[1]!;
    const table = s2.elements.find((e) => e.type === "table")!;
    expect(table.type === "table" && table.columns).toEqual([162, 162]);
    expect(table.type === "table" && table.rows.map((r) => r.cells.length)).toEqual([2, 2]);
    expect(table.type === "table" && table.headerRow).toBe(true);
    expect(table.type === "table" && table.rows[0]!.cells[0]!.fill).toBe("#4285f4");
    const group = s2.elements.find((e) => e.type === "group")!;
    expect(group.type === "group" && group.children).toHaveLength(2);
    // the group's child space is half the size of its frame: 1000000 EMU wide inside 2000000
    if (group.type === "group") {
      expect(group.children[0]).toMatchObject({ x: expect.closeTo(393.7, 1), w: expect.closeTo(78.74, 1) });
      expect(group.children[1]).toMatchObject({ x: expect.closeTo(393.7 + 78.74, 1) });
      expect(group).toMatchObject({ x: expect.closeTo(393.7, 1), w: expect.closeTo(157.48, 1) });
    }
    const line = shapes(s2).find((e) => e.geometry === "line")!;
    expect(line).toMatchObject({ flipV: true, line: { width: 1.5, dash: "dash", tail: "triangle", head: "none", color: { theme: "accent3" } } });
    const box = shapes(deck.slides[2]!).find((e) => e.textBox)!;
    expect(box.text!.autofit).toBe("resize");
    expect(box.text!.paragraphs[0]!.runs[0]!.marks).toMatchObject({ fontSize: 20, fontFamily: "Roboto", color: { theme: "accent1" } });
  });

  it("keeps a picture on a layout as a decoration", () => {
    const l = deck.masters[0]!.layouts[6]!;
    expect(l.elements.map((e) => e.type)).toEqual(["image"]);
  });

  it("warns about what it can't import and does not throw", () => {
    expect(warnings.some((w) => /chart/i.test(w))).toBe(true);
    expect(warnings.some((w) => /freeform/i.test(w))).toBe(false);
    // the freeform triangle is kept as custom geometry, not replaced by a rectangle
    const custom = shapes(deck.slides[2]!).find((e) => e.fill === "#fbbc04")!;
    expect(custom.geometry).toBe("custom");
    expect(custom.custom!.paths[0]).toMatchObject({ w: 100, h: 100, commands: [["M", 0, 0], ["L", 100, 50], ["L", 0, 100], ["Z"]] });
    // the chart whose part is missing stays as an empty dashed box with its name, so the slide keeps its layout
    const stand = shapes(deck.slides[2]!).find((e) => e.name === "Chart 3")!;
    expect(stand).toMatchObject({ geometry: "rect", fill: null, x: expect.closeTo(157.48, 1) });
    expect(deck.slides[2]!.elements.some((e) => e.type === "table")).toBe(false);
  });

  it("resolves every slide", () => {
    for (const s of deck.slides) {
      const scene = resolveSlide(deck, s);
      expect(scene.elements.length).toBeGreaterThan(0);
      for (const e of scene.elements) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y) && e.w >= 0 && e.h >= 0).toBe(true);
      }
    }
  });
});

describe("fromPptx: a 4:3 deck", () => {
  const { deck, warnings } = fromPptx(classic43());
  it("reads the 4:3 size and resolves inherited titles", () => {
    expect(validateDeck(deck)).toBe(deck);
    expect(deck.size).toEqual({ width: 720, height: 540 });
    expect(warnings).toEqual([]);
    expect(deck.title).toBe("Safety briefing");
    const scene = resolveSlide(deck, deck.slides[1]!);
    const title = scene.elements.find((e) => e.placeholder?.type === "title")!;
    expect(title).toMatchObject({ x: 36, w: 648 });
    expect(title.text!.paragraphs[0]!.runs[0]).toMatchObject({ fontSize: 44, bold: true, fontFamily: "Arial", color: "#1f497d" });
    expect(title.text!.paragraphs[0]!.align).toBe("center");
    const body = scene.elements.find((e) => e.placeholder?.type === "obj")!;
    const p = body.text!.paragraphs[0]!;
    expect(p.runs[0]!.fontSize).toBe(32);
    expect(p.spaceBefore).toBeCloseTo(6.4, 5); // 20% of 32
  });
});

describe("fromPptx: errors", () => {
  it("throws invalid_document for something that is not a zip", () => {
    for (const bytes of [new Uint8Array(), new TextEncoder().encode("hello"), new Uint8Array([0x50, 0x4b, 1, 2, 3])]) {
      expect(() => fromPptx(bytes)).toThrowError(PliError);
      try {
        fromPptx(bytes);
      } catch (e) {
        expect((e as PliError).code).toBe("invalid_document");
        expect((e as PliError).message).toMatch(/PowerPoint|zip/);
      }
    }
  });
});
