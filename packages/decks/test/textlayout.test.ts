import { describe, expect, it } from "vitest";
import { createDeck, defaultMeasure, layoutText, paragraphsFromText, resolveSlide, type ResolvedParagraph, type ResolvedRun, type ResolvedText, type TextMeasurer } from "../src";

const run = (text: string, extra: Partial<ResolvedRun> = {}): ResolvedRun => ({
  text,
  fontFamily: "Arial",
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

const para = (runs: ResolvedRun[] | string, extra: Partial<ResolvedParagraph> = {}): ResolvedParagraph => ({
  runs: typeof runs === "string" ? [run(runs)] : runs,
  level: 0,
  align: "left",
  marL: 0,
  indent: 0,
  bullet: null,
  spaceBefore: 0,
  spaceAfter: 0,
  lineSpacing: 1,
  rtl: false,
  endSize: 18,
  ...extra,
});

const body = (paragraphs: ResolvedParagraph[], extra: Partial<ResolvedText> = {}): ResolvedText => ({
  paragraphs,
  vAlign: "top",
  insets: { l: 7.2, t: 3.6, r: 7.2, b: 3.6 },
  wrap: true,
  autofit: "none",
  ...extra,
});

// Helvetica widths per 1000 em: H 722 e 556 l 222 o 556 w 722 r 333 d 556 space 278
const HELLO = 2278;
const WORLD = 2389;

describe("default text measurer", () => {
  it("adds up Helvetica's widths", () => {
    const base = { fontFamily: "Arial", fontSize: 10, bold: false, italic: false, letterSpacing: 0, allCaps: false, smallCaps: false };
    expect(defaultMeasure("Hello", base)).toBeCloseTo(22.78, 6);
    expect(defaultMeasure("Hello", { ...base, bold: true })).toBeCloseTo(24.45, 6); // H722 e556 l278 l278 o611
    expect(defaultMeasure("Hello", { ...base, fontSize: 20 })).toBeCloseTo(45.56, 6);
    expect(defaultMeasure("Hello", { ...base, letterSpacing: 1 })).toBeCloseTo(27.78, 6);
    expect(defaultMeasure("Hello", { ...base, fontFamily: "Times New Roman" })).toBeCloseTo(22.78 * 0.9, 6); // narrower
    expect(defaultMeasure("Hello", { ...base, fontFamily: "Verdana" })).toBeGreaterThan(22.78); // wider
    expect(defaultMeasure("Hello", { ...base, fontFamily: "Courier New" })).toBeCloseTo(30, 6); // monospace 0.6 em
    expect(defaultMeasure("é—€", base)).toBeCloseTo((556 + 1000 + 744) / 100, 6);
    expect(defaultMeasure("", base)).toBe(0);
  });
});

describe("text layout", () => {
  it("lays one line out with the baseline where the font's line height puts it", () => {
    const lay = layoutText(body([para("Hello world")]), 200, 100);
    expect(lay.lines).toHaveLength(1);
    const line = lay.lines[0]!;
    const w = ((HELLO + 278 + WORLD) / 1000) * 18;
    expect(line.width).toBeCloseTo(w, 6);
    expect(line.x).toBeCloseTo(7.2, 6);
    expect(line.height).toBeCloseTo(21.6, 6); // 18 * 1.2
    expect(line.y).toBeCloseTo(3.6 + 21.6 - 0.25 * 18, 6);
    expect(line.segments).toHaveLength(1);
    expect(line.segments[0]!.text).toBe("Hello world");
    expect(line.segments[0]!.width).toBeCloseTo(w, 6);
    expect(lay.contentHeight).toBeCloseTo(21.6, 6);
    expect(lay.scale).toBe(1);
    expect(lay.overflow).toBe(false);
    expect(lay.neededHeight).toBeCloseTo(21.6 + 7.2, 6);
  });

  it("breaks at spaces and drops the space at the break", () => {
    // 60 points of room: "Hello" (41.0) fits, "Hello world" (89.0) doesn't
    const lay = layoutText(body([para("Hello world")]), 74.4, 100);
    expect(lay.lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["Hello", "world"]);
    expect(lay.lines[0]!.width).toBeCloseTo((HELLO / 1000) * 18, 6);
    expect(lay.lines[1]!.y - lay.lines[0]!.y).toBeCloseTo(21.6, 6);
    expect(lay.contentHeight).toBeCloseTo(43.2, 6);
    // no wrapping: one long line
    const flat = layoutText(body([para("Hello world")], { wrap: false }), 74.4, 100);
    expect(flat.lines).toHaveLength(1);
  });

  it("splits a word that is wider than the line", () => {
    const lay = layoutText(body([para("Supercalifragilisticexpialidocious")]), 14.4 + 60, 400);
    expect(lay.lines.length).toBeGreaterThan(3);
    for (const l of lay.lines) expect(l.width).toBeLessThanOrEqual(60.001);
    expect(lay.lines.map((l) => l.segments.map((s) => s.text).join("")).join("")).toBe("Supercalifragilisticexpialidocious");
    // a box narrower than one letter still makes progress
    const tiny = layoutText(body([para("abc")]), 14.4 + 1, 400);
    expect(tiny.lines.map((l) => l.segments.map((s) => s.text).join("")).join("")).toBe("abc");
  });

  it("breaks after a hyphen", () => {
    const lay = layoutText(body([para("well-known")]), 14.4 + 70, 100);
    // "well-" = w722 e556 l222 l222 -333 = 2055 -> 37.0pt; "known" = k500 n556 o556 w722 n556 = 2890 -> 52.0pt; together 89 > 70
    expect(lay.lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["well-", "known"]);
  });

  it("keeps runs as segments that carry their run", () => {
    const bold = run("bold", { bold: true });
    const lay = layoutText(body([para([run("Hello "), bold, run(" there")])]), 300, 100);
    const segs = lay.lines[0]!.segments;
    expect(segs.map((s) => s.text)).toEqual(["Hello ", "bold", " there"]);
    expect(segs[1]!.run).toBe(bold);
    expect(segs[0]!.x).toBeCloseTo(7.2, 6);
    expect(segs[1]!.x).toBeCloseTo(7.2 + segs[0]!.width, 6);
    expect(segs[2]!.x).toBeCloseTo(segs[1]!.x + segs[1]!.width, 6);
    // a word that spans two runs is not broken between them: "Hello" (41pt) moves to the next line whole
    const split = layoutText(body([para([run("ab "), run("Hel"), run("lo", { bold: true })])]), 14.4 + 45, 100);
    expect(split.lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["ab", "Hello"]);
    expect(split.lines[1]!.segments.map((s) => s.text)).toEqual(["Hel", "lo"]);
  });

  it("aligns left, center, right and justified", () => {
    const text = (align: "left" | "center" | "right" | "justify") => body([para("Hello world foo", { align })]);
    const room = 200 - 14.4;
    const center = layoutText(text("center"), 200, 100).lines[0]!;
    expect(center.x).toBeCloseTo(7.2 + (room - center.width) / 2, 6);
    const right = layoutText(text("right"), 200, 100).lines[0]!;
    expect(right.x + right.width).toBeCloseTo(200 - 7.2, 6);
    // justify: every line but the last spans the room
    const j = layoutText(body([para("Hello world foo bar baz qux quux", { align: "justify" })]), 14.4 + 130, 300);
    expect(j.lines.length).toBeGreaterThan(1);
    j.lines.slice(0, -1).forEach((l) => {
      const end = l.segments[l.segments.length - 1]!;
      expect(end.x + end.width).toBeCloseTo(7.2 + 130, 4);
    });
    const last = j.lines[j.lines.length - 1]!;
    expect(last.x).toBeCloseTo(7.2, 6);
    expect(last.segments.map((s) => s.text).join("")).toBe(last.segments.map((s) => s.text).join("").trimEnd());
  });

  it("places bullets in the hanging indent and wraps to the margin", () => {
    const p = para("Hello world", { marL: 18, indent: -14, bullet: { label: "●", color: "#ff0000", size: 100 } });
    const lay = layoutText(body([p]), 14.4 + 60, 200);
    const [first, second] = lay.lines;
    expect(first!.bullet).toBeDefined();
    expect(first!.bullet!.label).toBe("●");
    expect(first!.bullet!.x).toBeCloseTo(7.2 + 4, 6);
    expect(first!.bullet!.run.color).toBe("#ff0000");
    expect(first!.segments[0]!.x).toBeCloseTo(7.2 + 18, 6);
    expect(second!.bullet).toBeUndefined();
    expect(second!.segments[0]!.x).toBeCloseTo(7.2 + 18, 6);
    // the first line has less room than a paragraph without a margin
    const plain = layoutText(body([para("Hello world")]), 14.4 + 60, 200);
    expect(plain.lines).toHaveLength(2);
    // an empty paragraph shows no bullet
    const empty = layoutText(body([para([], { bullet: { label: "●", color: "#000000", size: 100 }, marL: 18, indent: -14 })]), 200, 100);
    expect(empty.lines[0]!.bullet).toBeUndefined();
    // a first-line indent without a bullet
    const ind = layoutText(body([para("Hello", { marL: 10, indent: 20 })]), 200, 100);
    expect(ind.lines[0]!.x).toBeCloseTo(7.2 + 30, 6);
  });

  it("applies line spacing and the space around paragraphs", () => {
    const lay = layoutText(body([para("One", { lineSpacing: 1.5, spaceAfter: 6 }), para("Two", { spaceBefore: 4 })]), 200, 200);
    const [a, b] = lay.lines;
    expect(a!.height).toBeCloseTo(18 * 1.2 * 1.5, 6);
    expect(a!.top).toBeCloseTo(3.6, 6);
    expect(b!.top).toBeCloseTo(3.6 + 32.4 + 6 + 4, 6);
    expect(lay.contentHeight).toBeCloseTo(32.4 + 6 + 4 + 21.6, 6);
    // space before the first paragraph is not applied
    const first = layoutText(body([para("One", { spaceBefore: 20 })]), 200, 100);
    expect(first.lines[0]!.top).toBeCloseTo(3.6, 6);
    // an empty paragraph is as tall as its end mark says
    const e = layoutText(body([para([], { endSize: 10 })]), 200, 100);
    expect(e.lines[0]!.height).toBeCloseTo(12, 6);
    expect(e.lines[0]!.segments).toEqual([]);
  });

  it("takes the tallest text on a line", () => {
    const lay = layoutText(body([para([run("a", { fontSize: 10 }), run("B", { fontSize: 30 })])]), 200, 100);
    expect(lay.lines[0]!.height).toBeCloseTo(36, 6);
    expect(lay.lines[0]!.y).toBeCloseTo(3.6 + 36 - 7.5, 6);
  });

  it("anchors vertically inside the insets", () => {
    const t = (vAlign: "top" | "middle" | "bottom") => layoutText(body([para("Hi")], { vAlign }), 200, 100).lines[0]!;
    const inner = 100 - 7.2;
    expect(t("top").top).toBeCloseTo(3.6, 6);
    expect(t("middle").top).toBeCloseTo(3.6 + (inner - 21.6) / 2, 6);
    expect(t("bottom").top).toBeCloseTo(3.6 + inner - 21.6, 6);
    // overflowing text still starts at the top when anchored at the top, and flags overflow
    const over = layoutText(body([para("Hi"), para("Hi"), para("Hi"), para("Hi"), para("Hi")]), 200, 50);
    expect(over.overflow).toBe(true);
    expect(over.lines[0]!.top).toBeCloseTo(3.6, 6);
  });

  it("raises and lowers superscript and subscript and shrinks them", () => {
    const lay = layoutText(body([para([run("x"), run("2", { baseline: 30 }), run("i", { baseline: -25 })])]), 200, 100);
    const [x, sup, sub] = lay.lines[0]!.segments;
    expect(x!.dy).toBeCloseTo(0, 6);
    expect(sup!.dy).toBeCloseTo(-5.4, 6); // 30% of 18, up
    expect(sub!.dy).toBeCloseTo(4.5, 6); // 25% of 18, down
    expect(sup!.fontSize).toBeLessThan(18);
    expect(sup!.run.baseline).toBe(30);
  });

  it("applies capitals", () => {
    const lay = layoutText(body([para([run("ab", { allCaps: true }), run("cD", { smallCaps: true })])]), 200, 100);
    const segs = lay.lines[0]!.segments;
    expect(segs[0]!.text).toBe("AB");
    expect(segs[0]!.width).toBeCloseTo(((667 + 667) / 1000) * 18, 6);
    expect(segs.map((s) => s.text).join("")).toBe("ABCD");
    expect(segs[1]!.fontSize).toBeCloseTo(18 * 0.8, 6); // the lowercase c
    expect(segs[2]!.fontSize).toBe(18);
  });

  it("shrinks text to fit, stepping down like PowerPoint", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const t = body([para(words)], { autofit: "shrink" });
    const big = layoutText(body([para(words)]), 300, 80);
    expect(big.overflow).toBe(true);
    const lay = layoutText(t, 300, 80);
    expect(lay.scale).toBeLessThan(1);
    expect(lay.scale).toBeGreaterThanOrEqual(0.25);
    expect([0.925, 0.85, 0.775, 0.7, 0.625, 0.55, 0.475, 0.4, 0.325, 0.25]).toContain(lay.scale);
    expect(lay.lineSpacingReduction).toBeLessThanOrEqual(0.2);
    expect(lay.overflow).toBe(false);
    expect(lay.contentHeight).toBeLessThanOrEqual(80 - 7.2 + 0.01);
    // segments are drawn at the scaled size
    expect(lay.lines[0]!.segments[0]!.fontSize).toBeCloseTo(18 * lay.scale, 6);
    // text that fits is left alone
    const small = layoutText(body([para("Hi")], { autofit: "shrink" }), 300, 80);
    expect(small.scale).toBe(1);
    expect(small.lineSpacingReduction).toBe(0);
    // hopeless text bottoms out at 25% and reports overflow
    const hopeless = layoutText(body([para((words + " ").repeat(40))], { autofit: "shrink" }), 100, 30);
    expect(hopeless.scale).toBe(0.25);
    expect(hopeless.overflow).toBe(true);
  });

  it("resizes to the text", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const lay = layoutText(body([para(words)], { autofit: "resize" }), 300, 20);
    expect(lay.overflow).toBe(false);
    expect(lay.scale).toBe(1);
    expect(lay.neededHeight).toBeCloseTo(lay.contentHeight + 7.2, 6);
    expect(lay.neededHeight).toBeGreaterThan(20);
    expect(lay.lines[0]!.top).toBeCloseTo(3.6, 6);
  });

  it("starts a new line at a line break in a run", () => {
    const lay = layoutText(body([para("one\ntwo")]), 300, 100);
    expect(lay.lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["one", "two"]);
  });

  it("uses the measurer it is given", () => {
    const tenPerChar: TextMeasurer = (text) => text.length * 10;
    const lay = layoutText(body([para("abcd efgh")]), 14.4 + 50, 100, tenPerChar);
    expect(lay.lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["abcd", "efgh"]);
    expect(lay.lines[0]!.width).toBe(40);
    const seen: string[] = [];
    layoutText(body([para([run("x", { bold: true, fontFamily: "Georgia", fontSize: 20, letterSpacing: 2 })])]), 100, 100, (text, r) => (seen.push(`${text}|${r.fontFamily}|${r.fontSize}|${r.bold}|${r.letterSpacing}`), 5));
    expect(seen).toContain("x|Georgia|20|true|2");
  });

  it("is deterministic and survives degenerate boxes", () => {
    const t = body([para("Hello world, this is a test of wrapping across several lines of text."), para("Second paragraph", { align: "center" })]);
    expect(JSON.stringify(layoutText(t, 120, 90))).toBe(JSON.stringify(layoutText(t, 120, 90)));
    for (const [w, h] of [[0, 0], [5, 5], [-10, 20], [1000, 1]] as const) {
      const lay = layoutText(t, w, h);
      expect(Number.isFinite(lay.contentHeight)).toBe(true);
      expect(lay.lines.length).toBeGreaterThan(0);
    }
    expect(layoutText(body([]), 100, 100).lines).toEqual([]);
  });

  it("lays out the text of a resolved slide", () => {
    const deck = createDeck();
    const slide = deck.slides[0]!;
    const title = slide.elements.find((e) => e.type === "shape" && e.placeholder?.type === "ctrTitle")!;
    if (title.type === "shape") title.text = { paragraphs: paragraphsFromText("Quarterly results and outlook for the year") };
    const el = resolveSlide(deck, slide).elements.find((e) => e.id === title.id)!;
    const lay = layoutText(el.text!, el.w, el.h);
    expect(lay.lines.length).toBeGreaterThanOrEqual(1);
    expect(lay.lines[0]!.segments[0]!.run.fontFamily).toBe("Arial");
    expect(lay.lines[0]!.segments[0]!.run.fontSize).toBeGreaterThan(40);
    expect(lay.lines.map((l) => l.segments.map((s) => s.text).join(" ")).join(" ").replace(/\s+/g, " ").trim()).toBe("Quarterly results and outlook for the year");
  });
});
