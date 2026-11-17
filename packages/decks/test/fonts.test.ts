import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { createFonts, type FontEnv, type FontSource } from "@pli.dev/core";
import { parseTrueType } from "@pli.dev/docs";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  DeckSession,
  createDeck,
  defaultMeasure,
  fontFaces,
  fontMeasurer,
  fontWidthFactor,
  fromPptx,
  layoutText,
  paragraphsFromText,
  toPdf,
  toPptx,
  usedFonts,
  type ChartElement,
  type Deck,
  type Paragraph,
  type ResolvedParagraph,
  type ResolvedRun,
  type ResolvedText,
  type ShapeElement,
  type TableElement,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const LORA = new Uint8Array(readFileSync(join(here, "../../core/test/fixtures/fonts/lora-latin-400-normal.ttf")));
const DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

type Files = Record<string, Uint8Array>;
const xmlOf = (bytes: Uint8Array): Files => unzipSync(bytes);
const part = (files: Files, name: string) => strFromU8(files[name]!);
const partsMatching = (files: Files, re: RegExp) => Object.keys(files).filter((n) => re.test(n));

/** A deck that names the fonts of the tests in a title, body, bullets, a table, a chart and a theme. */
function fontDeck(): Deck {
  const s = new DeckSession(createDeck({ title: "Fonts" }));
  const slide = s.deck.slides[0]!;
  const [title, sub] = slide.elements as ShapeElement[];
  s.setText(slide.id, title!.id, [{ runs: [{ text: "Lora heading", marks: { fontFamily: "Lora" } }, { text: " mono ", marks: { fontFamily: "Roboto Mono" } }, { text: "Calibri", marks: { fontFamily: "Calibri" } }] }]);
  s.setText(slide.id, sub!.id, [
    { runs: [{ text: "Comic", marks: { fontFamily: "Comic Sans MS" } }, { text: " amp", marks: { fontFamily: "Black & White <Sans>" } }], bullet: { type: "char", char: "★", font: "Lora" } },
    { runs: [{ text: "theme body", marks: { fontFamily: "+mn-lt" } }, { text: " theme head", marks: { fontFamily: "+mj-lt" } }] },
  ]);
  const body = s.addSlide();
  const table = s.addTable(body.id, 1, 1, { x: 40, y: 140, w: 300 }) as TableElement;
  const cell: Paragraph[] = [{ runs: [{ text: "cell", marks: { fontFamily: "Lora" } }] }];
  s.setCellParagraphs(body.id, table.id, 0, 0, cell);
  s.addChart(body.id, "column", { x: 40, y: 260, w: 400, h: 200 }, { fontFamily: "Roboto Mono" } as Partial<ChartElement>);
  return s.deck;
}

function withThemeFonts(deck: Deck, major: string, minor: string): Deck {
  const out = structuredClone(deck);
  out.masters[0]!.theme.fonts = { major, minor };
  return out;
}

describe("usedFonts", () => {
  it("lists theme fonts, runs, bullets, tables and charts once each, in document order, with theme references resolved", () => {
    const deck = withThemeFonts(fontDeck(), "Playfair Display", "Source Sans 3");
    const names = usedFonts(deck);
    expect(names.slice(0, 2)).toEqual(["Playfair Display", "Source Sans 3"]);
    for (const n of ["Lora", "Roboto Mono", "Calibri", "Comic Sans MS", "Black & White <Sans>"]) expect(names, n).toContain(n);
    expect(names.some((n) => n.startsWith("+"))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
    expect(names.indexOf("Lora")).toBeLessThan(names.indexOf("Roboto Mono"));
  });

  it("resolves +mj-lt and +mn-lt through the master of the slide's layout", () => {
    const deck = withThemeFonts(createDeck(), "Alpha Face", "Beta Face");
    const slide = deck.slides[0]!;
    (slide.elements[0] as ShapeElement).text = { paragraphs: [{ runs: [{ text: "x", marks: { fontFamily: "+mj-lt" } }] }] };
    // a second master with its own theme and a slide on it
    const other = structuredClone(deck.masters[0]!);
    other.id = "m2";
    other.theme.fonts = { major: "Gamma Face", minor: "Delta Face" };
    other.layouts = other.layouts.map((l) => ({ ...l, id: `${l.id}-2` }));
    deck.masters.push(other);
    deck.slides.push({ id: "s2", layout: other.layouts[0]!.id, elements: [{ type: "shape", id: "e2", geometry: "rect", text: { paragraphs: [{ runs: [{ text: "y", marks: { fontFamily: "+mn-lt" } }] }] } }], notes: "" });
    expect(usedFonts(deck)).toEqual(["Alpha Face", "Beta Face", "Gamma Face", "Delta Face"]);
  });

  it("ignores the East Asian and complex-script theme references", () => {
    const deck = fontDeck();
    (deck.slides[0]!.elements[0] as ShapeElement).text = { paragraphs: [{ runs: [{ text: "x", marks: { fontFamily: "+mn-ea" } }, { text: "y", marks: { fontFamily: "+mj-cs" } }] }] };
    expect(usedFonts(deck).some((n) => n.startsWith("+"))).toBe(false);
  });
});

describe("fonts in a PPTX file", () => {
  const deck = fontDeck();
  const bytes = toPptx(deck, { date: DATE });
  const files = xmlOf(bytes);
  const slide1 = part(files, "ppt/slides/slide1.xml");

  it("round trips every name unchanged, special characters included", () => {
    const back = fromPptx(bytes);
    expect(back.warnings).toEqual([]);
    const names = new Set(usedFonts(back.deck));
    for (const n of ["Lora", "Roboto Mono", "Calibri", "Comic Sans MS", "Black & White <Sans>"]) expect(names.has(n), n).toBe(true);
    const sub = back.deck.slides[0]!.elements[1] as ShapeElement;
    expect(sub.text!.paragraphs[0]!.bullet).toMatchObject({ type: "char", font: "Lora" });
    expect(sub.text!.paragraphs[1]!.runs.map((r) => r.marks?.fontFamily)).toEqual(["+mn-lt", "+mj-lt"]);
    const chart = back.deck.slides[1]!.elements.find((e) => e.type === "chart") as ChartElement;
    expect(chart.fontFamily).toBe("Roboto Mono");
  });

  it("writes pitchFamily and charset beside fonts Office doesn't have, and a bare name for Office fonts and theme references", () => {
    expect(slide1).toContain('<a:latin typeface="Lora" pitchFamily="18" charset="0"/>');
    expect(slide1).toContain('<a:latin typeface="Roboto Mono" pitchFamily="49" charset="0"/>');
    expect(slide1).toContain('<a:latin typeface="Calibri"/>');
    expect(slide1).toContain('<a:latin typeface="Comic Sans MS"/>');
    expect(slide1).toContain('<a:latin typeface="Black &amp; White &lt;Sans&gt;" pitchFamily="34" charset="0"/>');
    expect(slide1).toContain('<a:latin typeface="+mn-lt"/>');
    expect(slide1).toContain('<a:buFont typeface="Lora" pitchFamily="18" charset="0"/>');
  });

  it("writes the hint in the theme font scheme and in chart text", () => {
    const themed = xmlOf(toPptx(withThemeFonts(deck, "Playfair Display", "Roboto"), { date: DATE }));
    const theme = part(themed, partsMatching(themed, /^ppt\/theme\/theme\d+\.xml$/)[0]!);
    expect(theme).toContain('<a:majorFont><a:latin typeface="Playfair Display" pitchFamily="18" charset="0"/>');
    expect(theme).toContain('<a:minorFont><a:latin typeface="Roboto" pitchFamily="34" charset="0"/>');
    const chart = part(files, partsMatching(files, /^ppt\/charts\/chart\d+\.xml$/)[0]!);
    expect(chart).toContain('<a:latin typeface="Roboto Mono" pitchFamily="49" charset="0"/>');
  });

  it("keeps theme names through the theme round trip", () => {
    const back = fromPptx(toPptx(withThemeFonts(deck, "Playfair Display", "Roboto"), { date: DATE }));
    expect(back.deck.masters[0]!.theme.fonts).toEqual({ major: "Playfair Display", minor: "Roboto" });
  });

  it('"keep" is the default', () => {
    expect(part(xmlOf(toPptx(deck, { date: DATE, fonts: "keep" })), "ppt/slides/slide1.xml")).toBe(slide1);
  });

  it('"office" replaces every non-Office family, in runs, bullets, theme and chart text, and leaves Office fonts alone', () => {
    const themed = withThemeFonts(deck, "Playfair Display", "Roboto");
    const out = xmlOf(toPptx(themed, { date: DATE, fonts: "office" }));
    const s1 = part(out, "ppt/slides/slide1.xml");
    expect(s1).not.toMatch(/typeface="(Lora|Roboto Mono)"/);
    expect(s1).toContain('<a:latin typeface="Georgia"/>');
    expect(s1).toContain('<a:latin typeface="Consolas"/>');
    expect(s1).toContain('<a:buFont typeface="Georgia"/>');
    expect(s1).toContain('<a:latin typeface="Calibri"/>');
    expect(s1).toContain('<a:latin typeface="Comic Sans MS"/>');
    expect(s1).toContain('<a:latin typeface="Arial"/>'); // the made-up sans name
    expect(s1).toContain('<a:latin typeface="+mn-lt"/>');
    const theme = part(out, partsMatching(out, /^ppt\/theme\/theme\d+\.xml$/)[0]!);
    expect(theme).toContain('<a:majorFont><a:latin typeface="Georgia"/>');
    expect(theme).toContain('<a:minorFont><a:latin typeface="Arial"/>');
    expect(part(out, partsMatching(out, /^ppt\/charts\/chart\d+\.xml$/)[0]!)).toContain('<a:latin typeface="Consolas"/>');
    // the deck given is not changed
    expect(themed.masters[0]!.theme.fonts.major).toBe("Playfair Display");
    expect(fromPptx(toPptx(themed, { date: DATE, fonts: "office" })).warnings).toEqual([]);
  });

  it("is well formed XML in every part, in both modes", () => {
    for (const mode of ["keep", "office"] as const) {
      const out = xmlOf(toPptx(fontDeck(), { date: DATE, fonts: mode }));
      for (const name of partsMatching(out, /\.(xml|rels)$/)) {
        const errors: string[] = [];
        new DOMParser({ onError: (level, msg) => errors.push(`${level}: ${msg}`) }).parseFromString(part(out, name), "text/xml");
        expect(errors, `${mode} ${name}`).toEqual([]);
      }
    }
  });
});

describe("reading fonts from PowerPoint's XML", () => {
  /** A deck whose first slide's title carries the given `a:rPr` children, written by the writer and patched. */
  function importWith(rprInner: string, text = "Hello", theme?: (xml: string) => string): Deck {
    const base = createDeck();
    (base.slides[0]!.elements[0] as ShapeElement).text = { paragraphs: [{ runs: [{ text, marks: { fontFamily: "Placeholder Name" } }] }] };
    const files = xmlOf(toPptx(base, { date: DATE }));
    const slideName = "ppt/slides/slide1.xml";
    const xml = part(files, slideName).replace(/<a:latin typeface="Placeholder Name"[^>]*\/>/, rprInner);
    expect(xml).not.toContain("Placeholder Name");
    files[slideName] = new TextEncoder().encode(xml);
    if (theme) {
      const t = partsMatching(files, /^ppt\/theme\/theme\d+\.xml$/)[0]!;
      files[t] = new TextEncoder().encode(theme(part(files, t)));
    }
    // zipSync on the patched files
    return fromPptx(zip(files)).deck;
  }
  const first = (deck: Deck) => (deck.slides[0]!.elements[0] as ShapeElement).text!.paragraphs[0]!.runs[0]!.marks?.fontFamily;

  it("reads a:latin as written, with its hint attributes", () => {
    expect(first(importWith('<a:latin typeface="Lora" panose="00000500000000000000" pitchFamily="18" charset="0"/>'))).toBe("Lora");
  });

  it("keeps +mj-lt and +mn-lt as theme references", () => {
    expect(first(importWith('<a:latin typeface="+mj-lt"/>'))).toBe("+mj-lt");
    expect(first(importWith('<a:latin typeface="+mn-lt"/>'))).toBe("+mn-lt");
  });

  it("never turns +mj-ea, +mn-ea, +mj-cs... into family names", () => {
    expect(first(importWith('<a:latin typeface="+mn-ea"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>'))).toBeUndefined();
    expect(first(importWith('<a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/>', "日本語"))).toBeUndefined();
  });

  it("uses a:ea or a:cs only when a:latin is missing and the text has no Latin letters", () => {
    expect(first(importWith('<a:ea typeface="Yu Gothic"/>', "日本語"))).toBe("Yu Gothic");
    expect(first(importWith('<a:cs typeface="Arial Unicode MS"/>', "مرحبا"))).toBe("Arial Unicode MS");
    expect(first(importWith('<a:ea typeface="Yu Gothic"/>', "Hello"))).toBeUndefined();
    expect(first(importWith('<a:latin typeface="Lora"/><a:ea typeface="Yu Gothic"/>', "日本語"))).toBe("Lora");
  });

  it("reads theme fonts, falling back to the East Asian font and then Arial when a theme has no Latin one", () => {
    const patch = (major: string, minor: string) => (xml: string) =>
      xml.replace(/<a:majorFont>.*?<\/a:majorFont>/s, `<a:majorFont>${major}</a:majorFont>`).replace(/<a:minorFont>.*?<\/a:minorFont>/s, `<a:minorFont>${minor}</a:minorFont>`);
    const deck = importWith('<a:latin typeface="Lora"/>', "Hello", patch('<a:latin typeface=""/><a:ea typeface="Yu Gothic"/>', '<a:latin typeface="+mn-lt"/>'));
    expect(deck.masters[0]!.theme.fonts).toEqual({ major: "Yu Gothic", minor: "Arial" });
    const real = importWith('<a:latin typeface="Lora"/>', "Hello", patch('<a:latin typeface="Lora" panose="02020500000000000000"/>', '<a:latin typeface="Roboto Mono" pitchFamily="49" charset="0"/>'));
    expect(real.masters[0]!.theme.fonts).toEqual({ major: "Lora", minor: "Roboto Mono" });
  });
});

const zip = (files: Files): Uint8Array => zipSync(files);

// ---- Measuring -------------------------------------------------------------------------------------------------------

const run = (text: string, extra: Partial<ResolvedRun> = {}): ResolvedRun => ({
  text,
  fontFamily: "Lora",
  fontSize: 18,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "#000000",
  alpha: 1,
  baseline: 0,
  allCaps: false,
  smallCaps: false,
  letterSpacing: 0,
  ...extra,
});
const para = (runs: ResolvedRun[]): ResolvedParagraph => ({ runs, level: 0, align: "left", marL: 0, indent: 0, bullet: null, spaceBefore: 0, spaceAfter: 0, lineSpacing: 1, rtl: false, endSize: 18 });
const body = (paragraphs: ResolvedParagraph[]): ResolvedText => ({ paragraphs, vAlign: "top", insets: { l: 0, t: 0, r: 0, b: 0 }, wrap: true, autofit: "none" });
const style = (r: ResolvedRun) => ({ fontFamily: r.fontFamily, fontSize: r.fontSize, bold: r.bold, italic: r.italic, letterSpacing: r.letterSpacing, allCaps: false, smallCaps: false });

describe("text measuring", () => {
  it("keeps the numbers of the names it always knew", () => {
    expect(fontWidthFactor("Times New Roman")).toBe(0.9);
    expect(fontWidthFactor("Georgia")).toBe(0.97);
    expect(fontWidthFactor("Verdana")).toBe(1.14);
    expect(fontWidthFactor("Open Sans")).toBe(1.04);
    expect(fontWidthFactor("Calibri")).toBe(0.92);
    expect(fontWidthFactor("Roboto")).toBe(0.92);
    expect(fontWidthFactor("Arial")).toBe(1);
    expect(fontWidthFactor("Courier New")).toBe(1);
  });

  it("estimates families it doesn't know from the catalogue", () => {
    expect(fontWidthFactor("Lora")).toBeCloseTo(0.96, 2); // a serif
    expect(fontWidthFactor("Some Condensed Face")).toBeLessThan(1);
    expect(fontWidthFactor("Some Extended Face")).toBeGreaterThan(1);
    expect(fontWidthFactor("Unheard Of Sans")).toBe(1);
  });

  it("measures every monospace family of the catalogue as fixed-width", () => {
    const a = defaultMeasure("iiii", style(run("", { fontFamily: "Source Code Pro" })));
    const b = defaultMeasure("WWWW", style(run("", { fontFamily: "Source Code Pro" })));
    expect(a).toBeCloseTo(b, 6);
    expect(defaultMeasure("iiii", style(run("", { fontFamily: "Space Mono" })))).toBeCloseTo(defaultMeasure("WWWW", style(run("", { fontFamily: "Space Mono" }))), 6);
    expect(defaultMeasure("iiii", style(run("", { fontFamily: "Lora" })))).toBeLessThan(defaultMeasure("WWWW", style(run("", { fontFamily: "Lora" }))));
  });

  it("reads glyph advances from a font file", () => {
    const measure = fontMeasurer({ Lora: LORA });
    const font = parseTrueType(LORA);
    const r = run("Hello world");
    const expected = ([...r.text].reduce((n, ch) => n + font.advance(font.glyphFor(ch.codePointAt(0)!)), 0) / font.unitsPerEm) * r.fontSize;
    expect(measure(r.text, style(r))).toBeCloseTo(expected, 6);
    expect(measure(r.text, style(r))).not.toBeCloseTo(defaultMeasure(r.text, style(r)), 1);
    expect(measure(r.text, { ...style(r), letterSpacing: 1 })).toBeCloseTo(expected + 11, 6);
  });

  it("matches names and styles the way the PDF writer does and falls back for the rest", () => {
    const measure = fontMeasurer({ Lora: LORA });
    const r = run("Hello world");
    expect(measure(r.text, { ...style(r), fontFamily: "lora" })).toBeCloseTo(measure(r.text, style(r)), 6); // case
    expect(measure(r.text, { ...style(r), bold: true })).toBeCloseTo(defaultMeasure(r.text, { ...style(r), bold: true }), 6); // no "Lora bold" file
    expect(measure(r.text, { ...style(r), fontFamily: "Arial" })).toBeCloseTo(defaultMeasure(r.text, { ...style(r), fontFamily: "Arial" }), 6);
    const faces = fontFaces({ Lora: LORA, "Lora bold": LORA });
    expect(faces.face("LORA", true, false)).toBe("Lora");
    expect(faces.face("Lora", false, true)).toBeUndefined();
  });

  it("measures a character the font lacks as the standard font would and says the font doesn't cover it", () => {
    const faces = fontFaces({ Lora: LORA });
    const r = run("Привет");
    expect(faces.covers("Lora", false, false, "Hello world 123")).toBe(true);
    expect(faces.covers("Lora", false, false, "Привет")).toBe(false);
    expect(faces.covers("Arial", false, false, "Hello")).toBe(false);
    expect(faces.measure(r.text, style(r))).toBeCloseTo(defaultMeasure(r.text, style(r)), 6);
  });

  it("breaks lines at the real widths of the font", () => {
    const text = "The quick brown fox jumps over the lazy dog and keeps running far away";
    const doc = body([para([run(text)])]);
    const exact = fontMeasurer({ Lora: LORA });
    const width = 260;
    const estimated = layoutText(doc, width, 1000);
    const measured = layoutText(doc, width, 1000, exact);
    const lines = (l: typeof estimated) => l.lines.map((x) => x.segments.map((s) => s.text).join(""));
    expect(lines(measured)).not.toEqual(lines(estimated));
    // each line really fits the width by the font's own advances, and a word more would not
    const words = lines(measured);
    for (const [i, line] of words.entries()) {
      expect(exact(line.trimEnd(), style(run(line)))).toBeLessThanOrEqual(width + 1e-6);
      const next = words[i + 1]?.split(" ")[0];
      if (next) expect(exact(`${line}${next}`.trimEnd(), style(run(line)))).toBeGreaterThan(width);
    }
  });
});

// ---- PDF -------------------------------------------------------------------------------------------------------------

const fakeEnv: FontEnv = { canLoad: false, register: () => undefined, load: async () => false, isInstalled: () => false };
const fakeSource: FontSource = { name: "test", faces: () => [], file: async () => LORA };

const loraDeck = (text: string, family = "Lora"): Deck => {
  const s = new DeckSession(createDeck({ title: "Lora" }));
  const slide = s.deck.slides[0]!;
  s.setText(slide.id, (slide.elements[0] as ShapeElement).id, [{ runs: [{ text, marks: { fontFamily: family, fontSize: 32 } }] }]);
  return s.deck;
};

describe("a PDF of a deck with fonts", () => {
  it("embeds the files the registry fetched for usedFonts(deck)", async () => {
    const deck = loraDeck("Hello world");
    const registry = createFonts({ storage: null, env: fakeEnv, source: fakeSource });
    const { fonts, warnings } = await registry.pdfFonts(usedFonts(deck));
    expect(warnings).toEqual([]);
    expect(Object.keys(fonts)).toContain("Lora");
    const out = toPdf(deck, { fonts, date: DATE, compress: false });
    expect(out.warnings).toEqual([]);
    const pdf = latin1(out.bytes);
    expect(pdf).toContain("/FontFile2");
    const without = latin1(toPdf(deck, { date: DATE, compress: false }).bytes);
    expect(without).not.toContain("/FontFile2");
  });

  it("lays the text out with the embedded font's widths unless a measurer is given", () => {
    const deck = loraDeck("The quick brown fox jumps over the lazy dog and keeps running far away until night");
    const bare = latin1(toPdf(deck, { date: DATE, compress: false }).bytes);
    const real = latin1(toPdf(deck, { fonts: { Lora: LORA }, date: DATE, compress: false }).bytes);
    const same = latin1(toPdf(deck, { fonts: { Lora: LORA }, measure: defaultMeasure, date: DATE, compress: false }).bytes);
    const tj = (pdf: string) => (pdf.match(/ Tj/g) ?? []).length;
    expect(tj(real)).toBeGreaterThan(0);
    expect(real).not.toBe(same);
    expect(tj(same)).toBeGreaterThan(0);
    expect(bare).not.toContain("/FontFile2");
  });

  it("draws characters the font lacks in a standard font, warns, and keeps the line together", () => {
    const deck = loraDeck("Hello Привет world");
    const out = toPdf(deck, { fonts: { Lora: LORA }, date: DATE, compress: false });
    const pdf = latin1(out.bytes);
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("/BaseFont /Times-Roman"); // the pieces the font lacks (Lora is a serif)
    expect(out.warnings.join("\n")).toMatch(/no place in the fonts and became "\?"/);
    // the Latin pieces still use the embedded font: no .notdef box (glyph 0000) in the shown text
    expect(pdf).not.toMatch(/<(?:[0-9A-F]{4})*0000(?:[0-9A-F]{4})*> Tj/);
  });

  it("falls back for a bullet the font lacks instead of drawing a box", () => {
    const s = new DeckSession(createDeck({ title: "Bullets" }));
    const slide = s.deck.slides[0]!;
    s.setText(slide.id, (slide.elements[1] as ShapeElement).id, [{ runs: [{ text: "Point", marks: { fontFamily: "Lora" } }], bullet: { type: "char", char: "➢" }, marL: 20, indent: -20 }]);
    const out = toPdf(s.deck, { fonts: { Lora: LORA }, date: DATE, compress: false });
    const pdf = latin1(out.bytes);
    expect(pdf).not.toMatch(/<(?:[0-9A-F]{4})*0000(?:[0-9A-F]{4})*> Tj/);
  });

  it("warns about missing files only once and doesn't break for a family without a file", () => {
    const deck = loraDeck("Hello", "Some Unknown Family");
    const out = toPdf(deck, { fonts: { Lora: LORA }, date: DATE, compress: false });
    expect(latin1(out.bytes)).not.toContain("/FontFile2");
    expect(out.warnings).toEqual([]);
  });
});
