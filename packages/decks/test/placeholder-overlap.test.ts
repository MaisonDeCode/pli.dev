import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, DeckSession, SIZE_GOOGLE, builtinTheme, createDeck, newId, paragraphsFromText, type Layout, type Master, type ShapeElement } from "../src";

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

/** Every pair of placeholders drawn for a slide that overlap, as "a / b". */
function collisions(s: DeckSession, slideId: string): string[] {
  const holders = s.scene(slideId).elements.filter((e) => e.placeholder && e.from === "slide");
  const out: string[] = [];
  holders.forEach((a, i) => holders.slice(i + 1).forEach((b) => overlap(a, b) && out.push(`${a.placeholder!.type}${a.placeholder!.idx ?? ""} / ${b.placeholder!.type}${b.placeholder!.idx ?? ""}`)));
  return out;
}

function sample(master?: Master): DeckSession {
  const s = new DeckSession(createDeck({ size: SIZE_GOOGLE, ...(master ? { master } : {}) }));
  const layout = (k: string) => s.deck.masters[0]!.layouts.find((l) => l.kind === k)!.id;
  const t = (id: string, i: number, text: string) => s.setText(id, s.slide(id).elements[i]!.id, paragraphsFromText(text));
  t(s.deck.slides[0]!.id, 0, "Title");
  t(s.deck.slides[0]!.id, 1, "Subtitle");
  const a = s.addSlide({ layout: layout("titleAndBody") });
  t(a.id, 0, "Agenda");
  t(a.id, 1, "One\nTwo");
  const c = s.addSlide({ layout: layout("titleAndTwoColumns") });
  t(c.id, 0, "Columns");
  t(c.id, 1, "a");
  t(c.id, 2, "b");
  s.addSlide({ layout: layout("titleOnly") });
  return s;
}

/** A theme the way a designer's template often is: layouts are pictures and text boxes, with no placeholders at all. */
function pictureOnlyTheme(): Master {
  const base = builtinTheme(BUILTIN_THEMES[0]!.id, SIZE_GOOGLE);
  const layouts: Layout[] = ["Cover", "Divider", "Blank"].map((name) => ({
    id: newId("l_"),
    name,
    kind: name === "Blank" ? "blank" : "custom",
    elements: [{ type: "image", id: newId("e_"), src: "data:image/png;base64,AA==", x: 0, y: 0, w: 120, h: 405 }],
  }));
  return { ...base, elements: [], layouts };
}

describe("placeholders do not print over each other", () => {
  it("in every built-in theme and layout", () => {
    for (const t of BUILTIN_THEMES) {
      const s = sample(builtinTheme(t.id, SIZE_GOOGLE));
      for (const l of s.deck.masters[0]!.layouts) {
        const slide = s.addSlide({ layout: l.id });
        expect(collisions(s, slide.id), `${t.name} / ${l.name}`).toEqual([]);
      }
    }
  });

  it("after applying a theme whose layouts have no placeholders", () => {
    const s = sample();
    s.applyTheme(pictureOnlyTheme());
    for (const slide of s.deck.slides) {
      expect(collisions(s, slide.id), slide.id).toEqual([]);
      for (const e of s.scene(slide.id).elements) {
        if (!e.placeholder) continue;
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.x + e.w).toBeLessThanOrEqual(s.deck.size.width);
        expect(e.y + e.h).toBeLessThanOrEqual(s.deck.size.height);
      }
    }
    // titles sit above the content
    const body = s.deck.slides[1]!;
    const els = s.scene(body.id).elements.filter((e) => e.placeholder);
    const title = els.find((e) => e.placeholder!.type === "title")!;
    const text = els.find((e) => e.placeholder!.type === "body")!;
    expect(title.y + title.h).toBeLessThanOrEqual(text.y + 1);
    // the cover slide's title is above its subtitle
    const cover = s.scene(s.deck.slides[0]!.id).elements.filter((e) => e.placeholder);
    expect(cover.find((e) => e.placeholder!.type === "ctrTitle")!.y).toBeLessThan(cover.find((e) => e.placeholder!.type === "subTitle")!.y);
  });

  it("when a slide moves to a layout that lacks its placeholders", () => {
    const s = sample();
    s.applyTheme(pictureOnlyTheme());
    const blank = s.deck.masters[0]!.layouts.find((l) => l.kind === "blank")!;
    s.setLayout(s.deck.slides[2]!.id, blank.id);
    expect(collisions(s, s.deck.slides[2]!.id)).toEqual([]);
  });

  it("applyTheme picks the layout that has the slide's placeholders", () => {
    const s = sample();
    const base = builtinTheme(BUILTIN_THEMES[1]!.id, SIZE_GOOGLE);
    const plain: Layout = { id: newId("l_"), name: "Cover", kind: "custom", elements: [] };
    const withHolders = base.layouts.find((l) => l.kind === "titleAndBody")!;
    s.applyTheme({ ...base, layouts: [plain, ...base.layouts] });
    const used = s.deck.masters[0]!.layouts.find((l) => l.id === s.deck.slides[1]!.layout)!;
    expect(used.name).toBe(withHolders.name);
    const holder = used.elements.find((e): e is ShapeElement => e.type === "shape" && e.placeholder?.type === "body");
    expect(holder).toBeTruthy();
  });
});
