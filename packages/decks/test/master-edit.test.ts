import { describe, expect, it } from "vitest";
import {
  DeckSession,
  builtinTheme,
  createDeck,
  fromPptx,
  importTemplate,
  paragraphsFromText,
  resolveSlide,
  toPptx,
  validateDeck,
  withLevelPrompts,
  SIZE_WIDESCREEN,
  type Deck,
  type ResolvedElement,
  type ShapeElement,
} from "../src";
import { classic43, editPptx, powerpointTemplate } from "./fixtures/build-pptx";

const ph = (els: readonly { type: string; placeholder?: { type: string } }[], ...types: string[]) =>
  els.find((e) => e.type === "shape" && e.placeholder && types.includes(e.placeholder.type)) as ShapeElement;

/** A deck with a content slide on "Title and body" and a section slide on "Section header", each with title text. */
function twoSlideDeck() {
  const s = new DeckSession(createDeck());
  const master = s.deck.masters[0]!;
  const content = master.layouts.find((l) => l.kind === "titleAndBody")!;
  const section = master.layouts.find((l) => l.kind === "sectionHeader")!;
  const a = s.addSlide({ layout: content.id });
  const b = s.addSlide({ layout: section.id });
  for (const slide of [a, b]) {
    const t = ph(s.slide(slide.id).elements, "title");
    s.setText(slide.id, t.id, paragraphsFromText("Heading"));
  }
  const body = ph(s.slide(a.id).elements, "body");
  s.setText(a.id, body.id, [
    { runs: [{ text: "First" }] },
    { level: 1, runs: [{ text: "Second" }] },
    { level: 2, runs: [{ text: "Third" }] },
  ]);
  return { s, master, content, section, a: a.id, b: b.id, body: body.id };
}

const sceneEl = (s: DeckSession, slide: string, ...types: string[]): ResolvedElement => s.scene(slide).elements.find((e) => e.placeholder && types.includes(e.placeholder.type))!;
const titleRun = (s: DeckSession, slide: string) => sceneEl(s, slide, "title").text!.paragraphs[0]!.runs[0]!;

describe("master text styles", () => {
  it("a new master shows the five prompt levels in its body and a title prompt", () => {
    const master = createDeck().masters[0]!;
    const body = ph(master.elements, "body");
    expect(body.text!.paragraphs.map((p) => p.level ?? 0)).toEqual([0, 1, 2, 3, 4]);
    expect(body.text!.paragraphs.map((p) => p.runs[0]!.text)).toEqual(["Click to edit Master text styles", "Second level", "Third level", "Fourth level", "Fifth level"]);
    expect(ph(master.elements, "title").text!.paragraphs[0]!.runs[0]!.text).toBe("Click to edit Master title style");
    // the built-in themes get them too
    expect(ph(builtinTheme("paperwhite", SIZE_WIDESCREEN).elements, "body").text!.paragraphs).toHaveLength(5);
  });

  it("slides still say Click to add ... in their empty placeholders", () => {
    const s = new DeckSession(createDeck());
    const slide = s.addSlide();
    expect(sceneEl(s, slide.id, "body").prompt).toBe("Click to add text");
    expect(sceneEl(s, slide.id, "title").prompt).toBe("Click to add title");
  });

  it("formatting the master title reaches every slide's title unless its layout overrides", () => {
    const { s, master, a, b } = twoSlideDeck();
    const title = ph(master.elements, "title");
    expect(titleRun(s, a).fontSize).toBeLessThan(40);
    s.formatTemplateText(master.id, title.id, { fontSize: 40, bold: true, color: "#ff0000" });
    for (const slide of [a, b]) {
      const run = titleRun(s, slide);
      expect(run.bold).toBe(true);
      expect(run.color).toBe("#ff0000");
    }
    expect(titleRun(s, a).fontSize).toBe(40);
    // the section header layout sets its own size (1.4 times the master's); colour and bold still come from the master
    const sectionSize = s.deck.masters[0]!.layouts.find((l) => l.kind === "sectionHeader")!.elements[0]!;
    expect(sectionSize.type === "shape" && sectionSize.text?.levels?.[0]?.marks?.fontSize).toBeGreaterThan(0);
    expect(titleRun(s, b).fontSize).toBe(sectionSize.type === "shape" ? sectionSize.text!.levels![0]!.marks!.fontSize : -1);
    // the style is on the master, not on the placeholder's runs
    expect(s.deck.masters[0]!.textStyles.title[0]!.marks).toMatchObject({ fontSize: 40, bold: true, color: "#ff0000" });
    expect(ph(s.deck.masters[0]!.elements, "title").text!.paragraphs[0]!.runs[0]!.marks).toBeUndefined();
    // the master view shows it too
    expect(s.scene(master.id).elements.find((e) => e.placeholder?.type === "title")!.text!.paragraphs[0]!.runs[0]!.fontSize).toBe(40);
  });

  it("undo restores the master and the slides", () => {
    const { s, master, a } = twoSlideDeck();
    const before = titleRun(s, a);
    s.formatTemplateText(master.id, ph(master.elements, "title").id, { fontSize: 40, bold: true });
    expect(titleRun(s, a).fontSize).toBe(40);
    expect(s.undo()).toBe(true);
    expect(titleRun(s, a)).toEqual(before);
    expect(s.deck.masters[0]!.textStyles.title[0]!.marks?.bold).toBeFalsy();
    s.redo();
    expect(titleRun(s, a).fontSize).toBe(40);
  });

  it("formatText on a master placeholder does the same as formatTemplateText", () => {
    const { s, master, a } = twoSlideDeck();
    s.formatText(master.id, [ph(master.elements, "title").id], { italic: true, fontFamily: "Georgia" });
    expect(titleRun(s, a)).toMatchObject({ italic: true, fontFamily: "Georgia" });
  });

  it("styles each level of the master body on its own", () => {
    const { s, master, a } = twoSlideDeck();
    const mBody = ph(master.elements, "body");
    const before = sceneEl(s, a, "body").text!.paragraphs.map((p) => p.runs[0]!.fontSize);
    // select the "Second level" prompt (paragraph 1)
    s.formatTemplateText(master.id, mBody.id, { fontSize: 30, color: "#00aa00" }, { from: { p: 1, o: 2 }, to: { p: 1, o: 2 } });
    s.formatTemplateParagraphs(master.id, mBody.id, { align: "center", spaceAfter: 9, bullet: null }, { from: { p: 1, o: 0 }, to: { p: 1, o: 0 } });
    const paras = sceneEl(s, a, "body").text!.paragraphs;
    expect(paras[0]!.runs[0]!.fontSize).toBe(before[0]);
    expect(paras[1]!.runs[0]).toMatchObject({ fontSize: 30, color: "#00aa00" });
    expect(paras[1]).toMatchObject({ align: "center", spaceAfter: 9, bullet: null });
    expect(paras[2]!.runs[0]!.fontSize).toBe(before[2]);
    expect(paras[0]!.align).toBe("left");
    expect(s.deck.masters[0]!.textStyles.body[1]).toMatchObject({ align: "center", marks: { fontSize: 30 } });
  });

  it("with no range every level the placeholder shows takes the change", () => {
    const { s, master, a } = twoSlideDeck();
    s.formatTemplateText(master.id, ph(master.elements, "body").id, { bold: true });
    const paras = sceneEl(s, a, "body").text!.paragraphs;
    expect(paras.every((p) => p.runs[0]!.bold)).toBe(true);
    // levels 0..4 got it, 5..8 did not
    expect(Object.keys(s.deck.masters[0]!.textStyles.body).map(Number).filter((k) => s.deck.masters[0]!.textStyles.body[k]!.marks?.bold)).toEqual([0, 1, 2, 3, 4]);
  });

  it("replaces a master placeholder's own level overrides, which would hide the style from slides", () => {
    const t = importTemplate(powerpointTemplate());
    const s = new DeckSession(createDeck({ size: t.size, master: t.masters[0], firstSlide: false }));
    const m = s.deck.masters[0]!;
    // the Date placeholder of this template has its own level 1 (12pt); the title and body use the master's text styles
    const slide = s.addSlide({ layout: m.layouts[1]!.id });
    const titleEl = ph(s.slide(slide.id).elements, "title");
    s.setText(slide.id, titleEl.id, paragraphsFromText("Hi"));
    // give the master title placeholder its own level style, as some templates do
    s.updateElement(m.id, ph(m.elements, "title").id, (e) => (e.type === "shape" ? { ...e, text: { ...e.text!, levels: { 0: { marks: { fontSize: 20, bold: false } } } } } : e));
    expect(titleRun(s, slide.id).fontSize).toBe(20);
    s.formatTemplateText(m.id, ph(s.deck.masters[0]!.elements, "title").id, { fontSize: 36, bold: true });
    expect(titleRun(s, slide.id)).toMatchObject({ fontSize: 36, bold: true });
    expect(ph(s.deck.masters[0]!.elements, "title").text!.levels).toBeUndefined();
  });

  it("date, footer and number placeholders of the master keep their style in their own levels", () => {
    const { s, master, a } = twoSlideDeck();
    const num = ph(master.elements, "sldNum");
    s.formatTemplateText(master.id, num.id, { fontSize: 22, bold: true });
    s.formatTemplateParagraphs(master.id, num.id, { align: "left" });
    const after = ph(s.deck.masters[0]!.elements, "sldNum");
    expect(after.text!.levels![0]).toMatchObject({ align: "left", marks: { fontSize: 22, bold: true } });
    // the other placeholders' text style is untouched, and so is the title's
    expect(s.deck.masters[0]!.textStyles.other[0]!.marks?.bold).toBeUndefined();
    expect(sceneEl(s, a, "title").text!.paragraphs[0]!.runs[0]!.bold).toBe(false);
  });

  it("a layout change affects only the slides on that layout", () => {
    const { s, content, a, b } = twoSlideDeck();
    const layoutTitle = ph(content.elements, "title");
    const bBefore = titleRun(s, b);
    s.formatTemplateText(content.id, layoutTitle.id, { fontSize: 50, color: "#0000ff", italic: true });
    expect(titleRun(s, a)).toMatchObject({ fontSize: 50, color: "#0000ff", italic: true });
    expect(titleRun(s, b)).toEqual(bBefore);
    // the master is unchanged and the style sits in the layout placeholder's levels
    expect(s.deck.masters[0]!.textStyles.title[0]!.marks?.italic).toBeUndefined();
    const stored = ph(s.deck.masters[0]!.layouts.find((l) => l.id === content.id)!.elements, "title");
    expect(stored.text!.levels![0]!.marks).toMatchObject({ fontSize: 50, italic: true });
    s.undo();
    expect(titleRun(s, a).fontSize).not.toBe(50);
  });

  it("a layout body takes per-level and paragraph styles for its own level only", () => {
    const { s, content, a } = twoSlideDeck();
    const layoutBody = ph(content.elements, "body");
    // layout bodies show the five levels too
    expect(layoutBody.text!.paragraphs).toHaveLength(5);
    s.formatTemplateParagraphs(content.id, layoutBody.id, { marL: 60, bullet: { type: "number", scheme: "arabicPeriod" } }, { from: { p: 2, o: 0 }, to: { p: 2, o: 0 } });
    const paras = sceneEl(s, a, "body").text!.paragraphs;
    expect(paras[2]).toMatchObject({ marL: 60, bullet: { label: "1." } });
    expect(paras[1]!.bullet!.label).toBe("○");
  });

  it("paragraph-level overrides are cleared from the edited paragraphs so the style shows", () => {
    const { s, master, a } = twoSlideDeck();
    const t = ph(master.elements, "title");
    s.setText(master.id, t.id, [{ align: "right", runs: [{ text: "Click to edit Master title style", marks: { color: "#123456" } }] }]);
    s.formatTemplateText(master.id, t.id, { color: "#ff00ff" });
    s.formatTemplateParagraphs(master.id, t.id, { align: "center" });
    const stored = ph(s.deck.masters[0]!.elements, "title").text!.paragraphs[0]!;
    expect(stored.align).toBeUndefined();
    expect(stored.runs[0]!.marks).toBeUndefined();
    expect(titleRun(s, a)).toMatchObject({ color: "#ff00ff" });
    expect(sceneEl(s, a, "title").text!.paragraphs[0]!.align).toBe("center");
  });

  it("decorations on masters and layouts keep ordinary run formatting", () => {
    const { s, master } = twoSlideDeck();
    const box = s.addTextBox(master.id, { x: 10, y: 10, w: 200, h: 30 }, "Company");
    expect(s.isTemplateText(master.id, box.id)).toBe(false);
    s.formatText(master.id, [box.id], { bold: true });
    const stored = s.element(master.id, box.id) as ShapeElement;
    expect(stored.text!.paragraphs[0]!.runs[0]!.marks).toEqual({ bold: true });
    expect(() => s.formatTemplateText(master.id, box.id, { bold: true })).toThrow();
  });

  it("slide placeholders still format their own runs", () => {
    const { s, a } = twoSlideDeck();
    const t = ph(s.slide(a).elements, "title");
    expect(s.isTemplateText(a, t.id)).toBe(false);
    s.formatText(a, [t.id], { bold: true });
    expect((s.element(a, t.id) as ShapeElement).text!.paragraphs[0]!.runs[0]!.marks).toEqual({ bold: true });
  });

  it("a level change is one undo step even for several paragraphs", () => {
    const { s, master } = twoSlideDeck();
    const steps = s.canUndo;
    s.formatTemplateText(master.id, ph(master.elements, "body").id, { fontFamily: "Georgia" });
    s.undo();
    expect(s.deck.masters[0]!.textStyles.body[1]!.marks?.fontFamily).toBeUndefined();
    expect(steps).toBe(true);
  });
});

describe("level prompts", () => {
  it("adds the five levels to a master whose body placeholder is empty, and leaves slides alone", () => {
    const t = importTemplate(powerpointTemplate());
    const imported = t.masters[0]!;
    // the importer already adds them to templates; the same call on a raw file's master does it for a whole deck
    const raw = fromPptx(powerpointTemplate()).deck;
    expect(ph(raw.masters[0]!.elements, "body").text!.paragraphs).toHaveLength(1);
    const s = new DeckSession(raw);
    const slidesBefore = JSON.stringify(s.deck.slides);
    expect(s.addLevelPrompts()).toBe(true);
    expect(ph(s.deck.masters[0]!.elements, "body").text!.paragraphs.map((p) => p.level ?? 0)).toEqual([0, 1, 2, 3, 4]);
    expect(ph(s.deck.masters[0]!.elements, "title").text!.paragraphs[0]!.runs[0]!.text).toBe("Click to edit Master title style");
    expect(JSON.stringify(s.deck.slides)).toBe(slidesBefore);
    expect(s.addLevelPrompts()).toBe(false);
    expect(ph(imported.elements, "body").text!.paragraphs).toHaveLength(5);
    s.undo();
    expect(ph(s.deck.masters[0]!.elements, "body").text!.paragraphs).toHaveLength(1);
  });

  it("does not touch placeholders that already have text, or subtitles", () => {
    const master = createDeck().masters[0]!;
    expect(withLevelPrompts(master)).toBe(master);
    const sub = ph(master.layouts[0]!.elements, "subTitle");
    expect(sub.text!.paragraphs).toHaveLength(1);
  });

  it("round-trips through PPTX without the prompt text becoming content", async () => {
    const s = new DeckSession(createDeck());
    const bytes = await toPptx(s.deck);
    const back = fromPptx(bytes).deck;
    expect(ph(back.masters[0]!.elements, "body").text!.paragraphs.every((p) => p.runs.length === 0)).toBe(true);
    const slide = back.slides[0]!;
    expect(resolveSlide(back, slide).elements.every((e) => !e.prompt || !/level|Master/.test(e.prompt))).toBe(true);
  });
});

describe("masters", () => {
  it("adds a built-in theme as another master, with fresh ids and undo", () => {
    const s = new DeckSession(createDeck({ size: SIZE_WIDESCREEN }));
    const original = s.deck.masters[0]!;
    const added = s.addMaster(builtinTheme("paperwhite", s.deck.size));
    expect(s.deck.masters.map((m) => m.name)).toEqual(["Simple Light", "Paperwhite"]);
    expect(added.id).not.toBe(original.id);
    expect(s.deck.slides[0]!.layout).toBe(original.layouts[0]!.id);
    s.addSlide({ layout: added.layouts[1]!.id });
    expect(() => validateDeck(s.deck)).not.toThrow();
    s.undo();
    s.undo();
    expect(s.deck.masters).toHaveLength(1);
  });

  it("gives an added master a name that is not taken", () => {
    const s = new DeckSession(createDeck());
    const a = s.addMaster(builtinTheme("simple-light", s.deck.size));
    const b = s.addMaster(builtinTheme("simple-light", s.deck.size));
    expect(new Set([s.deck.masters[0]!.name, a.name, b.name]).size).toBe(3);
  });

  it("duplicates a master with its layouts and their placeholders under new ids", () => {
    const s = new DeckSession(createDeck());
    const src = s.deck.masters[0]!;
    const copy = s.duplicateMaster(src.id);
    expect(s.deck.masters.map((m) => m.id)).toEqual([src.id, copy.id]);
    expect(copy.name).toBe("Simple Light copy");
    expect(copy.layouts.map((l) => l.name)).toEqual(src.layouts.map((l) => l.name));
    const ids = new Set([...src.layouts.map((l) => l.id), ...src.layouts.flatMap((l) => l.elements.map((e) => e.id))]);
    for (const l of copy.layouts) {
      expect(ids.has(l.id)).toBe(false);
      for (const e of l.elements) expect(ids.has(e.id)).toBe(false);
    }
    // editing the copy leaves the original alone
    s.formatTemplateText(copy.id, ph(copy.elements, "title").id, { fontSize: 99 });
    expect(s.deck.masters[0]!.textStyles.title[0]!.marks?.fontSize).not.toBe(99);
    expect(s.deck.masters[1]!.textStyles.title[0]!.marks?.fontSize).toBe(99);
  });

  it("renames a master", () => {
    const s = new DeckSession(createDeck());
    s.renameMaster(s.deck.masters[0]!.id, "  Corporate ");
    expect(s.deck.masters[0]!.name).toBe("Corporate");
    expect(() => s.renameMaster(s.deck.masters[0]!.id, " ")).toThrow();
  });

  it("removes a master only when no slide uses it and one remains", () => {
    const s = new DeckSession(createDeck());
    const only = s.deck.masters[0]!;
    expect(() => s.removeMaster(only.id)).toThrow();
    const second = s.addMaster(builtinTheme("simple-dark", s.deck.size));
    const slide = s.addSlide({ layout: second.layouts[1]!.id });
    expect(() => s.removeMaster(second.id)).toThrow(/use/i);
    s.setLayout(slide.id, only.layouts[1]!.id);
    s.removeMaster(second.id);
    expect(s.deck.masters).toHaveLength(1);
    s.undo();
    expect(s.deck.masters).toHaveLength(2);
  });

  it("moves a slide to a layout of another master", () => {
    const s = new DeckSession(createDeck());
    const second = s.addMaster(builtinTheme("simple-dark", s.deck.size));
    const slide = s.addSlide();
    s.setLayout(slide.id, second.layouts.find((l) => l.kind === "titleOnly")!.id);
    expect(s.scene(slide.id).theme.name).toBe("Simple Dark");
  });

  it("reads a two-master template, and each master edits on its own", () => {
    const bytes = editPptx(classic43(), (p) => {
      p["ppt/slideMasters/slideMaster2.xml"] = p["ppt/slideMasters/slideMaster1.xml"] as string;
      p["ppt/slideMasters/_rels/slideMaster2.xml.rels"] = p["ppt/slideMasters/_rels/slideMaster1.xml.rels"] as string;
      p["ppt/_rels/presentation.xml.rels"] = (p["ppt/_rels/presentation.xml.rels"] as string).replace("</Relationships>", '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>');
      p["ppt/presentation.xml"] = (p["ppt/presentation.xml"] as string).replace("</p:sldMasterIdLst>", '<p:sldMasterId id="2147483900" r:id="rId99"/></p:sldMasterIdLst>');
    });
    const t = importTemplate(bytes);
    expect(t.masters).toHaveLength(2);
    for (const m of t.masters) expect(ph(m.elements, "body").text!.paragraphs).toHaveLength(5);
    const deck: Deck = { ...t.sampleDeck! };
    const s = new DeckSession(deck);
    const [m1, m2] = s.deck.masters;
    const slidesBefore = JSON.stringify(s.deck.slides);
    s.formatTemplateText(m1!.id, ph(m1!.elements, "title").id, { fontSize: 31, bold: false });
    expect(JSON.stringify(s.deck.slides)).toBe(slidesBefore);
    // the sample slides are on the first master; the title there follows the edit, the second master is unchanged
    const slide = s.deck.slides[1]!;
    expect(titleRun(s, slide.id)).toMatchObject({ fontSize: 31, bold: false });
    expect(s.deck.masters[1]!.textStyles.title[0]!.marks?.fontSize).not.toBe(31);
    expect(m2!.textStyles.title[0]!.marks?.bold).toBe(true);
  });
});

describe("layouts", () => {
  it("moves a layout up and down, with undo", () => {
    const s = new DeckSession(createDeck());
    const m = s.deck.masters[0]!;
    const [first, second] = m.layouts;
    s.moveLayout(second!.id, "up");
    expect(s.deck.masters[0]!.layouts.slice(0, 2).map((l) => l.id)).toEqual([second!.id, first!.id]);
    s.moveLayout(second!.id, "up"); // at the top: nothing
    expect(s.deck.masters[0]!.layouts[0]!.id).toBe(second!.id);
    s.moveLayout(second!.id, "down");
    expect(s.deck.masters[0]!.layouts[1]!.id).toBe(second!.id);
    s.moveLayout(first!.id, m.layouts.length - 1);
    expect(s.deck.masters[0]!.layouts.at(-1)!.id).toBe(first!.id);
    s.undo();
    expect(s.deck.masters[0]!.layouts[0]!.id).toBe(first!.id);
    const last = s.deck.masters[0]!.layouts.at(-1)!;
    s.moveLayout(last.id, "down");
    expect(s.deck.masters[0]!.layouts.at(-1)!.id).toBe(last.id);
  });

  it("moves a layout that slides use", () => {
    const s = new DeckSession(createDeck());
    const used = s.deck.slides[0]!.layout;
    s.moveLayout(used, "down");
    expect(s.deck.slides[0]!.layout).toBe(used);
  });

  it("duplicates a layout after the original, keeping kind, background and visibility of master shapes", () => {
    const s = new DeckSession(createDeck());
    const src = s.deck.masters[0]!.layouts[2]!;
    s.patchLayout(src.id, { background: "#112233", showMasterElements: false, kind: "custom" });
    const copy = s.duplicateLayout(src.id);
    const list = s.deck.masters[0]!.layouts;
    expect(list[3]!.id).toBe(copy.id);
    expect(copy).toMatchObject({ name: `${src.name} copy`, kind: "custom", background: "#112233", showMasterElements: false });
    expect(copy.elements.map((e) => e.id).some((id) => src.elements.some((x) => x.id === id))).toBe(false);
    expect(copy.elements).toHaveLength(src.elements.length);
    // the copy is independent of the original
    s.formatTemplateText(copy.id, ph(copy.elements, "title").id, { fontSize: 77 });
    expect(ph(s.deck.masters[0]!.layouts[2]!.elements, "title").text!.levels?.[0]?.marks?.fontSize).not.toBe(77);
    s.undo();
    s.undo();
    expect(s.deck.masters[0]!.layouts).toHaveLength(list.length - 1);
  });
});

describe("placeholders on layouts and masters", () => {
  it("adds a title, a body, a picture and the footers to a blank layout, with frames and prompts", () => {
    const s = new DeckSession(createDeck());
    const blank = s.deck.masters[0]!.layouts.find((l) => l.kind === "blank")!;
    const title = s.addPlaceholder(blank.id, "title");
    const body = s.addPlaceholder(blank.id, "body");
    const body2 = s.addPlaceholder(blank.id, "body", { x: 10, y: 20, w: 100, h: 50 });
    const pic = s.addPlaceholder(blank.id, "pic");
    const num = s.addPlaceholder(blank.id, "sldNum");
    const date = s.addPlaceholder(blank.id, "dt");
    const footer = s.addPlaceholder(blank.id, "ftr");
    const sub = s.addPlaceholder(blank.id, "subTitle");
    expect(title.placeholder).toEqual({ type: "title" });
    expect(body.w).toBeGreaterThan(300);
    expect(body.text!.paragraphs).toHaveLength(5);
    expect(body2).toMatchObject({ x: 10, y: 20, w: 100, h: 50 });
    expect(new Set([body.placeholder!.idx, body2.placeholder!.idx, pic.placeholder!.idx, sub.placeholder!.idx]).size).toBe(4);
    // footers inherit the master's frame and idx
    expect(num.x).toBeUndefined();
    expect(num.placeholder!.idx).toBe(12);
    expect(date.placeholder!.idx).toBe(10);
    expect(footer.placeholder!.idx).toBe(11);
    const scene = s.scene(blank.id);
    const byType = (t: string) => scene.elements.find((e) => e.placeholder?.type === t && e.from === "layout")!;
    expect(byType("title").prompt).toBe("Click to add title");
    expect(byType("pic").prompt).toBe("Click to add picture");
    expect(byType("pic").w).toBeGreaterThan(0);
    expect(byType("sldNum").w).toBeGreaterThan(0);
    // a slide on that layout gets the placeholders (not the footers)
    const slide = s.addSlide({ layout: blank.id });
    s.setLayout(slide.id, s.deck.masters[0]!.layouts[0]!.id);
    s.setLayout(slide.id, blank.id);
    expect(s.slide(slide.id).elements.some((e) => e.type === "shape" && e.placeholder?.type === "pic")).toBe(true);
    expect(s.slide(slide.id).elements.some((e) => e.type === "shape" && e.placeholder?.type === "sldNum")).toBe(false);
    s.undo();
    expect(() => validateDeck(s.deck)).not.toThrow();
  });

  it("refuses a second title or footer on a layout", () => {
    const s = new DeckSession(createDeck());
    const layout = s.deck.masters[0]!.layouts.find((l) => l.kind === "titleOnly")!;
    expect(() => s.addPlaceholder(layout.id, "title")).toThrow(/already/);
    const blank = s.deck.masters[0]!.layouts.find((l) => l.kind === "blank")!;
    s.addPlaceholder(blank.id, "dt");
    expect(() => s.addPlaceholder(blank.id, "dt")).toThrow(/already/);
  });

  it("restores a deleted footer on the master with its default frame", () => {
    const s = new DeckSession(createDeck());
    const m = s.deck.masters[0]!;
    s.deleteElements(m.id, [ph(m.elements, "sldNum").id]);
    expect(s.deck.masters[0]!.elements.some((e) => e.type === "shape" && e.placeholder?.type === "sldNum")).toBe(false);
    const num = s.addPlaceholder(m.id, "sldNum");
    expect(num.placeholder).toEqual({ type: "sldNum", idx: 12 });
    expect(num.x).toBeGreaterThan(s.deck.size.width / 2);
    expect(() => s.addPlaceholder(m.id, "title")).toThrow();
  });

  it("styles a placeholder added to a layout through the layout's levels", () => {
    const s = new DeckSession(createDeck());
    const blank = s.deck.masters[0]!.layouts.find((l) => l.kind === "blank")!;
    const body = s.addPlaceholder(blank.id, "body");
    const slide = s.addSlide({ layout: blank.id });
    const slideBody = s.slide(slide.id).elements.find((e) => e.type === "shape" && e.placeholder?.type === "body")!;
    s.setText(slide.id, slideBody.id, paragraphsFromText("Hello"));
    s.formatTemplateText(blank.id, body.id, { fontSize: 33 });
    expect(sceneEl(s, slide.id, "body").text!.paragraphs[0]!.runs[0]!.fontSize).toBe(33);
  });
});
