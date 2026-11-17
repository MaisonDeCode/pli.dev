import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, parseDeck, serializeDeck, paragraphsFromText, plainText, buildMaster, LIGHT_THEME, applyMarks, replaceRange, marksIn, SIZE_WIDESCREEN } from "../src";

const titleOf = (s: DeckSession, slide: string) => s.slide(slide).elements.find((e) => e.type === "shape" && e.placeholder?.type === "ctrTitle")!;

describe("deck session", () => {
  it("starts with a title slide whose placeholders inherit their frame and text style", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    expect(slide.elements.map((e) => e.type === "shape" && e.placeholder?.type)).toEqual(["ctrTitle", "subTitle"]);
    expect(titleOf(s, slide.id).x).toBeUndefined();
    const scene = s.scene(slide.id);
    const title = scene.elements.find((e) => e.placeholder?.type === "ctrTitle")!;
    expect(title.w).toBeGreaterThan(300);
    expect(title.prompt).toBe("Click to add title");
    s.setText(slide.id, title.id, paragraphsFromText("Hello"));
    const after = s.scene(slide.id).elements.find((e) => e.id === title.id)!;
    const run = after.text!.paragraphs[0]!.runs[0]!;
    expect(run.fontSize).toBeGreaterThan(40); // layout's size, from the master's title style scaled
    expect(run.fontFamily).toBe("Arial");
    expect(run.color).toBe("#000000");
    expect(after.prompt).toBeUndefined();
  });

  it("adds, duplicates, moves and deletes slides with undo", () => {
    const s = new DeckSession(createDeck());
    const first = s.deck.slides[0]!.id;
    const second = s.addSlide();
    expect(s.deck.slides.map((x) => x.id)).toEqual([first, second.id]);
    expect(s.layout(second.layout).layout.kind).toBe("titleAndBody");
    const [copy] = s.duplicateSlides([first]);
    expect(s.deck.slides.map((x) => x.id)).toEqual([first, copy!.id, second.id]);
    expect(copy!.elements[0]!.id).not.toBe(s.slide(first).elements[0]!.id);
    s.moveSlides([second.id], 0);
    expect(s.deck.slides[0]!.id).toBe(second.id);
    s.deleteSlides([second.id, copy!.id]);
    expect(s.deck.slides.length).toBe(1);
    s.undo();
    expect(s.deck.slides.length).toBe(3);
    s.undo();
    s.undo();
    s.undo();
    expect(s.deck.slides.map((x) => x.id)).toEqual([first]);
    expect(s.redo()).toBe(true);
  });

  it("keeps a slide when the last is deleted", () => {
    const s = new DeckSession(createDeck());
    s.deleteSlides([s.deck.slides[0]!.id]);
    expect(s.deck.slides.length).toBe(1);
  });

  it("edits elements: frames, arrange, align, distribute, group", () => {
    const s = new DeckSession(createDeck());
    const id = s.deck.slides[0]!.id;
    const a = s.addShape(id, "rect", { x: 10, y: 10, w: 50, h: 50 });
    const b = s.addShape(id, "ellipse", { x: 100, y: 40, w: 50, h: 50 });
    const c = s.addShape(id, "rect", { x: 300, y: 80, w: 50, h: 50 });
    s.align(id, [a.id, b.id, c.id], "top");
    expect([a, b, c].map((e) => s.element(id, e.id).y)).toEqual([10, 10, 10]);
    s.distribute(id, [a.id, b.id, c.id], "horizontal");
    expect(s.element(id, b.id).x).toBe(155);
    s.arrange(id, [a.id], "front");
    expect(s.slide(id).elements.at(-1)!.id).toBe(a.id);
    const g = s.group(id, [a.id, b.id])!;
    const group = s.element(id, g);
    expect(group.type).toBe("group");
    s.moveBy(id, [g], 10, 5);
    expect(s.element(id, a.id).x).toBe(20);
    s.setFrames(id, { [g]: { w: group.w! * 2 } });
    s.ungroup(id, g);
    expect(s.slide(id).elements.some((e) => e.type === "group")).toBe(false);
    s.deleteElements(id, [c.id]);
    expect(s.slide(id).elements.some((e) => e.id === c.id)).toBe(false);
    while (s.canUndo) s.undo();
    expect(s.slide(id).elements.length).toBe(2);
  });

  it("moves a placeholder off its layout frame when it is dragged", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const t = titleOf(s, slide.id);
    const before = s.frames(slide.id).get(t.id)!;
    s.moveBy(slide.id, [t.id], 20, 0);
    expect(s.element(slide.id, t.id).x).toBe(before.x + 20);
    expect(s.frames(slide.id).get(t.id)!.w).toBe(before.w);
  });

  it("changes a layout, keeping text that has no matching placeholder", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const sub = slide.elements[1]!;
    s.setText(slide.id, sub.id, paragraphsFromText("Keep me"));
    const blank = s.deck.masters[0]!.layouts.find((l) => l.kind === "blank")!;
    s.setLayout(slide.id, blank.id);
    expect(s.slide(slide.id).elements.length).toBe(1);
    const kept = s.slide(slide.id).elements[0]!;
    expect(kept.type === "shape" && kept.placeholder).toBeFalsy();
    expect(kept.w).toBeGreaterThan(0);
    s.undo();
    expect(s.slide(slide.id).layout).not.toBe(blank.id);
  });

  it("applies a theme: slides move to the matching layout and the old master goes", () => {
    const s = new DeckSession(createDeck());
    s.addSlide();
    const dark = buildMaster({ name: "Dark", theme: { ...LIGHT_THEME, name: "Dark", colors: { ...LIGHT_THEME.colors, dk1: "#ffffff", lt1: "#111111" } }, size: s.deck.size, background: { theme: "lt1" } });
    s.applyTheme(dark);
    expect(s.deck.masters.length).toBe(1);
    expect(s.deck.masters[0]!.name).toBe("Dark");
    expect(s.deck.slides.map((x) => s.layout(x.layout).layout.kind)).toEqual(["title", "titleAndBody"]);
    expect(s.scene(s.deck.slides[0]!.id).background).toEqual({ kind: "solid", color: "#111111", alpha: 1 });
    s.undo();
    expect(s.deck.masters[0]!.name).toBe("Simple Light");
  });

  it("rescales content when the slide size changes", () => {
    const s = new DeckSession(createDeck());
    const id = s.deck.slides[0]!.id;
    const a = s.addShape(id, "rect", { x: 72, y: 40, w: 144, h: 80 });
    s.setSize(SIZE_WIDESCREEN);
    expect(s.deck.size).toEqual(SIZE_WIDESCREEN);
    expect(s.element(id, a.id).x).toBeCloseTo(96);
    s.undo();
    expect(s.element(id, a.id).x).toBe(72);
  });

  it("finds and replaces in text and notes", () => {
    const s = new DeckSession(createDeck());
    const id = s.deck.slides[0]!.id;
    s.addTextBox(id, {}, "Alpha beta\nalpha");
    s.setNotes(id, "say Alpha first");
    expect(s.find("alpha").length).toBe(3);
    expect(s.find("alpha", { matchCase: true }).length).toBe(1);
    expect(s.replaceAll("alpha", "Omega")).toBe(3);
    expect(plainText((s.slide(id).elements.at(-1) as never as { text: { paragraphs: never[] } }).text.paragraphs)).toBe("Omega beta\nOmega");
    expect(s.slide(id).notes).toBe("say Omega first");
  });

  it("round-trips through JSON and rejects bad decks", () => {
    const s = new DeckSession(createDeck());
    s.addTextBox(s.deck.slides[0]!.id, {}, "x");
    expect(parseDeck(serializeDeck(s.deck))).toEqual(s.deck);
    expect(() => parseDeck("{")).toThrow();
    expect(() => parseDeck(JSON.stringify({ type: "deck", title: "", size: { width: 1, height: 1 }, masters: [], slides: [] }))).toThrow(/master/);
    const bad = JSON.parse(serializeDeck(s.deck));
    bad.deck.slides[0].layout = "nope";
    expect(() => parseDeck(JSON.stringify(bad))).toThrow(/layout/);
  });

  it("copies and pastes elements with fresh ids", () => {
    const s = new DeckSession(createDeck());
    const id = s.deck.slides[0]!.id;
    const a = s.addShape(id, "rect", { x: 1, y: 2, w: 3, h: 4 });
    const clip = s.copyElements(id, [a.id]);
    const [pasted] = s.pasteElements(id, clip, 10);
    expect(pasted).not.toBe(a.id);
    expect(s.element(id, pasted!).x).toBe(11);
  });
});

describe("text helpers", () => {
  it("applies marks to a range and reports common marks", () => {
    const ps = paragraphsFromText("hello world");
    const bold = applyMarks(ps, { from: { p: 0, o: 0 }, to: { p: 0, o: 5 } }, { bold: true });
    expect(bold[0]!.runs).toEqual([{ text: "hello", marks: { bold: true } }, { text: " world" }]);
    expect(marksIn(bold, { from: { p: 0, o: 1 }, to: { p: 0, o: 4 } })).toEqual({ bold: true });
    expect(marksIn(bold, { from: { p: 0, o: 1 }, to: { p: 0, o: 8 } })).toEqual({});
    const un = applyMarks(bold, { from: { p: 0, o: 0 }, to: { p: 0, o: 11 } }, { bold: null });
    expect(un[0]!.runs).toEqual([{ text: "hello world" }]);
  });

  it("replaces ranges across paragraphs", () => {
    const ps = paragraphsFromText("one\ntwo\nthree");
    const { paragraphs, caret } = replaceRange(ps, { from: { p: 0, o: 2 }, to: { p: 2, o: 2 } }, "X\nY");
    expect(plainText(paragraphs)).toBe("onX\nYree");
    expect(caret).toEqual({ p: 1, o: 1 });
  });
});

describe("line breaks and explicit false marks", () => {
  it("keeps a literal newline inside the run and writes it as a PPTX line break", async () => {
    const { toPptx, fromPptx, replaceRange } = await import("../src");
    const r = replaceRange(paragraphsFromText("ab"), { from: { p: 0, o: 1 }, to: { p: 0, o: 1 } }, "\n", undefined, { literal: true });
    expect(r.paragraphs.length).toBe(1);
    expect(r.paragraphs[0]!.runs[0]!.text).toBe("a\nb");
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    s.setText(slide.id, slide.elements[0]!.id, r.paragraphs);
    const back = fromPptx(toPptx(s.deck, { date: new Date(0) })).deck;
    const el = back.slides[0]!.elements.find((e) => e.type === "shape" && e.placeholder)!;
    expect(plainText((el as never as { text: { paragraphs: never[] } }).text.paragraphs)).toBe("a\nb");
  });

  it("lets text opt out of bold it inherits", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const box = s.addTextBox(slide.id, {}, "plain");
    s.formatText(slide.id, [box.id], { bold: true });
    s.formatText(slide.id, [box.id], { bold: false });
    const run = s.scene(slide.id).elements.find((e) => e.id === box.id)!.text!.paragraphs[0]!.runs[0]!;
    expect(run.bold).toBe(false);
    const ps = (s.element(slide.id, box.id) as never as { text: { paragraphs: { runs: { marks?: object }[] }[] } }).text.paragraphs;
    expect(ps[0]!.runs[0]!.marks).toEqual({ bold: false });
    // removal still works
    s.formatText(slide.id, [box.id], { bold: null });
    const ps2 = (s.element(slide.id, box.id) as never as { text: { paragraphs: { runs: { marks?: object }[] }[] } }).text.paragraphs;
    expect(ps2[0]!.runs[0]!.marks).toBeUndefined();
  });
});

describe("hiding background graphics", () => {
  it("drops master and layout decorations from a slide and survives PPTX", async () => {
    const { builtinTheme, fromPptx, toPptx } = await import("../src");
    const s = new DeckSession(createDeck({ master: builtinTheme("coral", { width: 720, height: 405 }) }));
    const id = s.deck.slides[0]!.id;
    const withArt = s.scene(id).elements.filter((e) => e.from !== "slide").length;
    expect(withArt).toBeGreaterThan(0);
    s.patchSlides([id], { showMasterElements: false });
    expect(s.scene(id).elements.filter((e) => e.from !== "slide").length).toBe(0);
    const back = fromPptx(toPptx(s.deck, { date: new Date(0) })).deck;
    expect(back.slides[0]!.showMasterElements).toBe(false);
    s.undo();
    expect(s.scene(id).elements.filter((e) => e.from !== "slide").length).toBe(withArt);
  });
});

describe("pictures in placeholders", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  function picDeck() {
    const s = new DeckSession(createDeck());
    const mask = { paths: [{ w: 100, h: 100, commands: [["M", 50, 0], ["C", 78, 0, 100, 22, 100, 50], ["C", 100, 78, 78, 100, 50, 100], ["C", 22, 100, 0, 78, 0, 50], ["C", 0, 22, 22, 0, 50, 0], ["Z"]] }] };
    const ph = { type: "shape", id: "e_pic", geometry: "custom", custom: mask, placeholder: { type: "pic", idx: 2 }, x: 100, y: 50, w: 200, h: 100, text: { paragraphs: [{ runs: [] }] } };
    const layout = { id: "l_pic", name: "Round picture", kind: "custom", elements: [ph] };
    s.transact([{ type: "insert_layout", master: s.deck.masters[0]!.id, layout } as never]);
    const slide = s.addSlide({ layout: "l_pic" });
    return { s, slide };
  }

  it("cover the frame (cropped to fit), take the layout's shape and keep the placeholder link", () => {
    const { s, slide } = picDeck();
    const id = s.slide(slide.id).elements[0]!.id;
    const picId = s.fillPlaceholderWithPicture(slide.id, id, png, { w: 400, h: 100 });
    const el = s.element(slide.id, picId);
    expect(el).toMatchObject({ type: "image", placeholder: { type: "pic", idx: 2 }, x: 100, y: 50, w: 200, h: 100 });
    // a 4:1 picture in a 2:1 frame loses a quarter of its width on each side
    expect((el as { crop: { l: number; r: number } }).crop).toEqual({ l: 0.25, r: 0.25 });
    const resolved = s.scene(slide.id).elements.find((r) => r.id === picId)!;
    expect(resolved.custom).toBeTruthy();
    expect(resolved.geometry).toBe("custom");
  });

  it("go back to an empty placeholder when deleted, and can be undone", () => {
    const { s, slide } = picDeck();
    const picId = s.fillPlaceholderWithPicture(slide.id, s.slide(slide.id).elements[0]!.id, png, { w: 100, h: 100 });
    s.deleteElements(slide.id, [picId]);
    expect(s.slide(slide.id).elements[0]).toMatchObject({ type: "shape", id: picId, placeholder: { type: "pic" } });
    s.undo();
    expect(s.slide(slide.id).elements[0]!.type).toBe("image");
  });

  it("round-trip through PPTX as a picture in its placeholder", async () => {
    const { toPptx, fromPptx } = await import("../src");
    const { s, slide } = picDeck();
    s.fillPlaceholderWithPicture(slide.id, s.slide(slide.id).elements[0]!.id, png, { w: 100, h: 100 });
    const back = fromPptx(toPptx(s.deck, { date: new Date(0) })).deck;
    const el = back.slides.at(-1)!.elements[0]!;
    expect(el).toMatchObject({ type: "image", placeholder: { type: "pic", idx: 2 } });
  });
});
