import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, DeckSession, createDeck, fromPptx, paragraphsFromText, plainText, resolveSlide, toPotx, toPptx, validateDeck, SIZE_GOOGLE, SIZE_STANDARD, SIZE_WIDESCREEN, importTemplate, type Deck, type Element, type ShapeElement, type Slide, type SlideSize } from "../src";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==";

const shapesOf = (s: Slide) => s.elements.filter((e): e is ShapeElement => e.type === "shape");
const kindOf = (deck: Deck, s: Slide) => deck.masters.flatMap((m) => m.layouts).find((l) => l.id === s.layout)!.kind;
const r2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number | undefined, b: number | undefined, tol = 0.5) => expect(Math.abs((a ?? NaN) - (b ?? NaN))).toBeLessThanOrEqual(tol);

function richDeck(size: SlideSize = SIZE_WIDESCREEN): Deck {
  const s = new DeckSession(createDeck({ title: "Round trip", size }));
  const first = s.deck.slides[0]!;
  s.setText(first.id, first.elements[0]!.id, paragraphsFromText("Annual plan"));
  s.setText(first.id, first.elements[1]!.id, paragraphsFromText("Example Corp"));
  s.setNotes(first.id, "Welcome.\nSecond line.");
  s.setTransition([first.id], { type: "fade", duration: 500, advanceAfter: 4000 });

  const body = s.addSlide();
  s.setText(body.id, body.elements[0]!.id, paragraphsFromText("Highlights"));
  s.setText(body.id, body.elements[1]!.id, [
    { runs: [{ text: "Plain " }, { text: "bold", marks: { bold: true, color: { theme: "accent1", lumMod: 0.6, lumOff: 0.4 } } }, { text: " link", marks: { link: "https://example.com/a", underline: true } }], spaceBefore: 6, lineSpacing: 1.5 },
    { runs: [{ text: "Nested", marks: { italic: true, fontSize: 14, fontFamily: "Georgia", color: "#336699" } }], level: 1 },
    { runs: [{ text: "Numbered" }], bullet: { type: "number", scheme: "alphaLcPeriod", start: 3 }, align: "center", marL: 20, indent: -20 },
  ]);
  s.setNotes(body.id, "Notes for the second slide");
  // 750 ms is what the writer's "medium" speed means: PowerPoint 2007's `spd` is all the file says
  s.setTransition([body.id], { type: "push", direction: "left", duration: 750 });
  s.setBackground([body.id], { gradient: { angle: 45, stops: [{ at: 0, color: "#112233" }, { at: 1, color: { theme: "lt2" } }] } });

  const shapes = s.addSlide({ layout: s.deck.masters[0]!.layouts.find((l) => l.kind === "titleOnly")!.id });
  s.setSkipped([shapes.id], true);
  s.addShape(shapes.id, "roundRect", { x: 40.25, y: 120.5, w: 200, h: 100 }, {
    name: "Box",
    alt: "A decorative box",
    rotation: 30,
    adjust: { adj: 12500 },
    fill: { theme: "accent2", lumMod: 0.75 },
    line: { width: 2.5, color: { theme: "accent1" }, dash: "dash", tail: "triangle" },
    shadow: { color: "#000000", blur: 6, dx: 3, dy: 4 },
    text: { paragraphs: paragraphsFromText("Inside"), vAlign: "middle", insets: { l: 4, t: 2, r: 6, b: 8 }, autofit: "shrink" },
  });
  s.addTextBox(shapes.id, { x: 300, y: 120, w: 200, h: 40 }, "Text box");
  s.addImage(shapes.id, PNG, { w: 5, h: 5 }, { x: 500, y: 200 }, { alt: "Dot", crop: { l: 0.1, t: 0.2, r: 0.05, b: 0 } });
  const a = s.addShape(shapes.id, "rect", { x: 20, y: 300, w: 40, h: 40 });
  const b = s.addShape(shapes.id, "ellipse", { x: 100, y: 310, w: 40, h: 40 }, { text: { paragraphs: paragraphsFromText("in group") } });
  s.group(shapes.id, [a.id, b.id]);

  const tables = s.addSlide();
  const table = s.addTable(tables.id, 3, 2, { x: 40, y: 140, w: 600 });
  s.setCellParagraphs(tables.id, table.id, 0, 0, paragraphsFromText("Header"));
  s.setCellParagraphs(tables.id, table.id, 1, 1, paragraphsFromText("Cell"));
  s.setTableOptions(tables.id, table.id, { headerRow: true, banded: true });
  return s.deck;
}

describe("PPTX round trip", () => {
  const original = richDeck();
  const { deck, warnings } = fromPptx(toPptx(original));

  it("recovers a valid deck without warnings", () => {
    expect(() => validateDeck(deck)).not.toThrow();
    expect(warnings).toEqual([]);
    expect(deck.size).toEqual(original.size);
    expect(deck.slides).toHaveLength(original.slides.length);
    expect(deck.title).toBe("Round trip");
  });

  it("keeps theme colours, fonts, name, layout kinds and names", () => {
    const [m0, m1] = [original.masters[0]!, deck.masters[0]!];
    expect(m1.name).toBe(m0.name);
    expect(m1.theme.colors).toEqual(m0.theme.colors);
    expect(m1.theme.fonts).toEqual(m0.theme.fonts);
    expect(m1.layouts.map((l) => l.kind)).toEqual(m0.layouts.map((l) => l.kind));
    expect(m1.layouts.map((l) => l.name)).toEqual(m0.layouts.map((l) => l.name));
    expect(m1.background).toEqual(m0.background);
    for (const [i, s] of original.slides.entries()) expect(kindOf(deck, deck.slides[i]!)).toBe(kindOf(original, s));
  });

  it("keeps slide text, placeholders, notes, transitions, hidden flag and background", () => {
    for (const [i, s] of original.slides.entries()) {
      const t = deck.slides[i]!;
      expect(t.notes).toBe(s.notes);
      expect(t.transition).toEqual(s.transition);
      expect(!!t.skipped).toBe(!!s.skipped);
      expect(shapesOf(t).map((e) => e.placeholder?.type)).toEqual(shapesOf(s).map((e) => e.placeholder?.type));
      expect(shapesOf(t).map((e) => (e.text ? plainText(e.text.paragraphs) : ""))).toEqual(shapesOf(s).map((e) => (e.text ? plainText(e.text.paragraphs) : "")));
    }
    expect(deck.slides[1]!.background).toMatchObject({ gradient: { kind: "linear", angle: 45 } });
  });

  it("keeps frames within half a point", () => {
    for (const [i, s] of original.slides.entries()) {
      const t = deck.slides[i]!;
      expect(t.elements.length).toBe(s.elements.length);
      s.elements.forEach((e, j) => {
        const f = t.elements[j]!;
        expect(f.type).toBe(e.type);
        for (const k of ["x", "y", "w", "h"] as const) {
          if (e[k] === undefined) expect(f[k]).toBeUndefined();
          else near(f[k], e[k]);
        }
        near(f.rotation ?? 0, e.rotation ?? 0, 0.01);
      });
    }
  });

  it("keeps run formatting and paragraph properties", () => {
    const body = shapesOf(deck.slides[1]!)[1]!.text!.paragraphs;
    expect(body[0]!.runs[1]!.marks).toMatchObject({ bold: true, color: { theme: "accent1", lumMod: 0.6, lumOff: 0.4 } });
    expect(body[0]!.runs[2]!.marks).toMatchObject({ link: "https://example.com/a", underline: true });
    expect(body[0]).toMatchObject({ spaceBefore: 6, lineSpacing: 1.5 });
    expect(body[1]!.level).toBe(1);
    expect(body[1]!.runs[0]!.marks).toMatchObject({ italic: true, fontSize: 14, fontFamily: "Georgia", color: "#336699" });
    expect(body[2]).toMatchObject({ align: "center", marL: 20, indent: -20, bullet: { type: "number", scheme: "alphaLcPeriod", start: 3 } });
  });

  it("keeps shapes, paint, images, groups and tables", () => {
    const box = shapesOf(deck.slides[2]!).find((e) => e.name === "Box")!;
    expect(box).toMatchObject({ geometry: "roundRect", alt: "A decorative box", adjust: { adj: 12500 }, fill: { theme: "accent2", lumMod: 0.75 } });
    expect(box.line).toMatchObject({ width: 2.5, dash: "dash", tail: "triangle", color: { theme: "accent1" } });
    expect(box.shadow).toMatchObject({ blur: 6, dx: expect.closeTo(3, 1), dy: expect.closeTo(4, 1) });
    expect(box.text).toMatchObject({ vAlign: "middle", autofit: "shrink", insets: { l: 4, t: 2, r: 6, b: 8 } });
    const img = deck.slides[2]!.elements.find((e) => e.type === "image")!;
    expect(img.type === "image" && img.src.startsWith("data:image/png")).toBe(true);
    expect(img).toMatchObject({ alt: "Dot", crop: { l: expect.closeTo(0.1, 3), t: expect.closeTo(0.2, 3), r: expect.closeTo(0.05, 3) } });
    expect(deck.slides[2]!.elements.find((e) => e.type === "group")?.type === "group" && true).toBe(true);
    const table = deck.slides[3]!.elements.find((e) => e.type === "table")!;
    expect(table.type === "table" && table.rows.map((r) => r.cells.length)).toEqual([2, 2, 2]);
    expect(table.type === "table" && table.headerRow && table.banded).toBe(true);
    expect(table.type === "table" && table.rows[0]!.cells[0]!.paragraphs[0]!.runs[0]!.text).toBe("Header");
  });

  it("resolves to the same text sizes, fonts and colours as the original", () => {
    for (const [i, s] of original.slides.entries()) {
      const a = resolveSlide(original, s);
      const b = resolveSlide(deck, deck.slides[i]!);
      expect(b.background.kind).toBe(a.background.kind);
      const pick = (sc: typeof a) => sc.elements.filter((e) => e.text).map((e) => e.text!.paragraphs.flatMap((p) => p.runs.map((r) => [r.text, r2(r.fontSize), r.fontFamily, r.link ? "link" : r.color, r.bold, r.italic] as const)));
      expect(pick(b)).toEqual(pick(a));
      const frames = (sc: typeof a) => sc.elements.map((e) => [e.x, e.y, e.w, e.h]);
      frames(b).forEach((f, j) => f.forEach((v, k) => near(v, frames(a)[j]![k]!, 0.5)));
    }
  });
});

describe("PPTX round trip of every built-in theme", () => {
  for (const t of BUILTIN_THEMES) {
    for (const size of [SIZE_WIDESCREEN, SIZE_GOOGLE, SIZE_STANDARD]) {
      it(`${t.name} at ${size.width}x${size.height}`, () => {
        const master = t.build(size);
        const s = new DeckSession(createDeck({ size, master, firstSlide: false }));
        for (const l of master.layouts) {
          const slide = s.addSlide({ layout: l.id });
          for (const e of slide.elements) if (e.type === "shape" && e.placeholder) s.setText(slide.id, e.id, paragraphsFromText(`Text ${e.placeholder.type}`));
        }
        const out = fromPptx(toPptx(s.deck));
        expect(out.warnings).toEqual([]);
        expect(() => validateDeck(out.deck)).not.toThrow();
        const m1 = out.deck.masters[0]!;
        expect(m1.theme.colors).toEqual(master.theme.colors);
        expect(m1.theme.fonts).toEqual(master.theme.fonts);
        expect(m1.layouts.map((l) => l.kind)).toEqual(master.layouts.map((l) => l.kind));
        // text styles survive: sizes, colours, fonts of what each slide draws
        for (const [i, slide] of s.deck.slides.entries()) {
          const a = resolveSlide(s.deck, slide);
          const b = resolveSlide(out.deck, out.deck.slides[i]!);
          const pick = (sc: typeof a) => sc.elements.filter((e) => e.text && e.placeholder).map((e) => [e.placeholder!.type, e.text!.paragraphs.map((p) => p.runs.map((r) => [r2(r.fontSize), r.fontFamily, r.color, r.bold])), e.text!.vAlign]);
          expect(pick(b)).toEqual(pick(a));
          expect(b.background).toEqual(a.background);
          expect(b.elements.length).toBe(a.elements.length);
          b.elements.forEach((e, j) => {
            for (const k of ["x", "y", "w", "h"] as const) near(e[k], a.elements[j]![k], 0.5);
          });
        }
      });
    }
  }
});

describe("template round trip", () => {
  it("reads back what toPotx wrote", () => {
    const deck = richDeck();
    const t = importTemplate(toPotx(deck));
    expect(t.size).toEqual(deck.size);
    expect(t.masters).toHaveLength(1);
    expect(t.masters[0]!.layouts.map((l) => l.name)).toEqual(deck.masters[0]!.layouts.map((l) => l.name));
    expect(t.sampleDeck).toBeUndefined();
  });
});

// keep Element in use for type-only helpers above
export type { Element };
