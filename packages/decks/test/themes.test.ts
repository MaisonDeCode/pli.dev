import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEMES,
  builtinTheme,
  createDeck,
  parseDeck,
  resolveSlide,
  serializeDeck,
  slideFromLayout,
  validateDeck,
  paragraphsFromText,
  allElementIds,
  parseHex,
  toHex,
  type Deck,
  type Element,
  type LayoutKind,
  type Master,
  type ResolvedElement,
  type Rgba,
  type Slide,
  type SlideSize,
} from "../src";

const SIZES: SlideSize[] = [{ width: 720, height: 405 }, { width: 960, height: 540 }, { width: 720, height: 540 }];
const KINDS: LayoutKind[] = ["title", "titleAndBody", "sectionHeader", "titleAndTwoColumns", "titleOnly", "oneColumnText", "captionLeft", "bigNumber", "blank"];

const lin = (v: number) => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const lum = (c: Rgba) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (s: string) => parseHex(s);
const over = (top: Rgba, alpha: number, under: Rgba): Rgba => ({ r: top.r * alpha + under.r * (1 - alpha), g: top.g * alpha + under.g * (1 - alpha), b: top.b * alpha + under.b * (1 - alpha), a: 1 });

/** Every colour a text frame can sit on: the slide background and anything drawn under it that the frame touches. */
function backdrops(scene: ReturnType<typeof resolveSlide>, frame: ResolvedElement): Rgba[] {
  let base: Rgba[] = scene.background.kind === "solid" ? [hex(scene.background.color)] : scene.background.kind === "gradient" ? scene.background.stops.map((s) => hex(s.color)) : [{ r: 255, g: 255, b: 255, a: 1 }];
  for (const e of scene.elements) {
    if (e === frame || e.from === "slide" || e.hidden) continue;
    const overlap = Math.min(e.x + e.w, frame.x + frame.w) - Math.max(e.x, frame.x) > 0.5 && Math.min(e.y + e.h, frame.y + frame.h) - Math.max(e.y, frame.y) > 0.5;
    if (!overlap || e.fill.kind === "none") continue;
    if (e.fill.kind === "solid") base = base.map((b) => over(hex(e.fill.kind === "solid" ? e.fill.color : "#000000"), e.fill.kind === "solid" ? e.fill.alpha : 1, b));
    else if (e.fill.kind === "gradient") base = e.fill.stops.flatMap((st) => base.map((b) => over(hex(st.color), st.alpha, b)));
  }
  return base;
}

function sampleSlide(master: Master, layoutId: string): Slide {
  const layout = master.layouts.find((l) => l.id === layoutId)!;
  const slide = slideFromLayout(layout);
  for (const e of slide.elements) if (e.type === "shape" && e.placeholder) e.text = { paragraphs: paragraphsFromText("Sample text") };
  // footers: not added to new slides, but they can be, and they must be readable too
  for (const [i, type] of (["dt", "ftr", "sldNum"] as const).entries()) {
    slide.elements.push({ type: "shape", id: `footer${i}`, geometry: "rect", placeholder: { type, idx: 10 + i }, text: { paragraphs: paragraphsFromText("Footer") } });
  }
  return slide;
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;

describe("built-in themes", () => {
  it("has twelve with unique ids and names", () => {
    expect(BUILTIN_THEMES).toHaveLength(12);
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(12);
    expect(new Set(BUILTIN_THEMES.map((t) => t.name)).size).toBe(12);
    expect(BUILTIN_THEMES.map((t) => t.id)).toEqual(expect.arrayContaining(["simple-light", "simple-dark", "paperwhite", "midnight", "coral", "forest", "slate", "sunrise", "mono", "ocean", "plum", "chalk"]));
    expect(builtinTheme("midnight", SIZES[0]!).name).toBe("Midnight");
    expect(builtinTheme("nope", SIZES[0]!).name).toBe("Simple Light");
  });

  it("uses common fonts and real colour schemes", () => {
    const common = /^(Arial|Georgia|Verdana|Trebuchet MS|Courier New|Times New Roman|Roboto)$/;
    for (const t of BUILTIN_THEMES) {
      expect(t.theme.fonts.major, t.id).toMatch(common);
      expect(t.theme.fonts.minor, t.id).toMatch(common);
      expect(Object.keys(t.theme.colors)).toHaveLength(12);
      for (const v of Object.values(t.theme.colors)) expect(v, t.id).toMatch(/^#[0-9a-f]{6}$/);
    }
    // the themes differ from each other
    expect(new Set(BUILTIN_THEMES.map((t) => t.theme.colors.accent1)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(BUILTIN_THEMES.map((t) => `${t.theme.fonts.major}/${t.theme.fonts.minor}`)).size).toBeGreaterThanOrEqual(6);
  });

  it("keeps text readable on its background (at least 4.5:1)", () => {
    for (const t of BUILTIN_THEMES) {
      const m = t.build(SIZES[0]!);
      const col = (slot: keyof typeof t.theme.colors) => hex(t.theme.colors[slot]);
      expect(contrast(col("dk1"), col("lt1")), `${t.id} text on background`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(col("dk2"), col("lt1")), `${t.id} muted on background`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(col("dk1"), col("lt2")), `${t.id} text on band`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(col("dk2"), col("lt2")), `${t.id} muted on band`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(col("hlink"), col("lt1")), `${t.id} link`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(col("folHlink"), col("lt1")), `${t.id} followed link`).toBeGreaterThanOrEqual(4.5);
      // table headers: lt1 text on accent1
      expect(contrast(col("lt1"), col("accent1")), `${t.id} table header`).toBeGreaterThanOrEqual(3);
      expect(m.background, t.id).toBeTruthy();
    }
  });

  for (const size of SIZES) {
    describe(`at ${size.width}x${size.height}`, () => {
      for (const t of BUILTIN_THEMES) {
        it(`${t.id}: a valid master with every layout, in bounds, with readable text`, () => {
          const master = t.build(size);
          const deck: Deck = createDeck({ size, master });
          expect(() => validateDeck(JSON.parse(JSON.stringify(deck)))).not.toThrow();
          expect(parseDeck(serializeDeck(deck)).masters[0]!.name).toBe(t.name);

          // every layout kind, once
          expect(master.layouts.map((l) => l.kind)).toEqual(KINDS);

          // unique ids across the master and its layouts, and across builds
          const ids: string[] = [];
          const walk = (els: Element[]) => els.forEach((e) => (ids.push(e.id), e.type === "group" && walk(e.children)));
          walk(master.elements);
          for (const l of master.layouts) {
            ids.push(l.id);
            walk(l.elements);
          }
          expect(new Set(ids).size, "unique ids").toBe(ids.length);
          const again = t.build(size);
          expect(again.id).not.toBe(master.id);
          expect(again.layouts[0]!.id).not.toBe(master.layouts[0]!.id);

          for (const layout of master.layouts) {
            // placeholders inside the slide
            const frames = layout.elements.filter((e) => e.type === "shape" && e.placeholder && e.x !== undefined);
            for (const e of [...frames, ...master.elements.filter((x) => x.type === "shape" && x.placeholder)]) {
              expect(e.x!, `${layout.kind} x`).toBeGreaterThanOrEqual(-0.01);
              expect(e.y!, `${layout.kind} y`).toBeGreaterThanOrEqual(-0.01);
              expect(e.x! + e.w!, `${layout.kind} right`).toBeLessThanOrEqual(size.width + 0.01);
              expect(e.y! + e.h!, `${layout.kind} bottom`).toBeLessThanOrEqual(size.height + 0.01);
            }
            // title and body don't overlap each other
            const texts = layout.elements.filter((e) => e.type === "shape" && e.placeholder && ["title", "ctrTitle", "body", "subTitle"].includes(e.placeholder.type));
            for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) expect(overlaps(texts[i] as never, texts[j] as never), `${layout.kind} placeholders ${i}/${j} overlap`).toBe(false);

            // text colours against whatever is behind them
            const d2: Deck = { ...deck, slides: [sampleSlide(master, layout.id)] };
            const scene = resolveSlide(d2, d2.slides[0]!, { slideNumber: 1, slideCount: 1 });
            let checked = 0;
            for (const e of scene.elements) {
              if (e.from !== "slide" || !e.text) continue;
              const run = e.text.paragraphs.flatMap((p) => p.runs)[0];
              if (!run) continue;
              checked++;
              const fg = hex(run.color);
              for (const bg of backdrops(scene, e)) expect(contrast(fg, bg), `${t.id} ${layout.kind} ${e.placeholder?.type} ${run.color} on ${toHex(bg)}`).toBeGreaterThanOrEqual(4.5);
              // the text is inside the slide
              expect(e.x + e.w).toBeLessThanOrEqual(size.width + 0.01);
              expect(e.y + e.h).toBeLessThanOrEqual(size.height + 0.01);
            }
            expect(checked, `${layout.kind} text`).toBeGreaterThanOrEqual(3);
          }
        });
      }
    });
  }

  it("scales decorations with the slide", () => {
    for (const t of BUILTIN_THEMES) {
      const small = t.build(SIZES[0]!);
      const wide = t.build(SIZES[1]!);
      expect(wide.elements.length, t.id).toBe(small.elements.length);
      const sizeOf = (m: Master) => m.elements.filter((e) => !e.placeholder).map((e) => e.w ?? 0);
      sizeOf(small).forEach((w, i) => expect(sizeOf(wide)[i]!, t.id).toBeGreaterThanOrEqual(w));
    }
  });

  it("builds into a deck whose slides resolve and whose elements have unique ids", () => {
    for (const t of BUILTIN_THEMES) {
      const deck = createDeck({ size: SIZES[1]!, master: t.build(SIZES[1]!) });
      for (const l of deck.masters[0]!.layouts.slice(1)) deck.slides.push(slideFromLayout(l));
      expect(deck.slides).toHaveLength(9);
      for (const s of deck.slides) {
        const scene = resolveSlide(deck, s);
        expect(scene.background.kind).not.toBe("none");
        for (const e of scene.elements) expect(Number.isFinite(e.x + e.y + e.w + e.h)).toBe(true);
      }
      const all = allElementIds(deck);
      expect(new Set(all).size, t.id).toBe(all.length);
    }
  });

  it("includes dark and light themes", () => {
    const dark = BUILTIN_THEMES.filter((t) => lum(hex(t.theme.colors.lt1)) < 0.2).map((t) => t.id);
    expect(dark).toEqual(expect.arrayContaining(["simple-dark", "midnight", "chalk"]));
    expect(BUILTIN_THEMES.length - dark.length).toBeGreaterThanOrEqual(8);
  });
});
