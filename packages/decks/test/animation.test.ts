import { describe, expect, it } from "vitest";
import { DeckSession, buildTimeline, cloneSlide, createDeck, finalPoses, paragraphsFromText, parseDeck, poseAt, serializeDeck, validateDeck, type Animation } from "../src";

function setup() {
  const s = new DeckSession(createDeck());
  const slide = s.deck.slides[0]!.id;
  const a = s.addShape(slide, "rect", { x: 100, y: 100, w: 100, h: 50 });
  const b = s.addShape(slide, "ellipse", { x: 300, y: 100, w: 100, h: 50 });
  const c = s.addTextBox(slide, { x: 50, y: 250, w: 300, h: 80 }, "one\ntwo\nthree");
  return { s, slide, a, b, c };
}
const size = { width: 720, height: 405 };
const frames = (s: DeckSession, slide: string) => new Map(s.scene(slide).elements.map((e) => [e.id, { x: e.x, y: e.y, w: e.w, h: e.h }]));

describe("animations in the session", () => {
  it("add, change, move and remove, each undoable", () => {
    const { s, slide, a, b } = setup();
    const x = s.addAnimation(slide, { target: a.id, kind: "fade" });
    const y = s.addAnimation(slide, { target: b.id, kind: "fly", direction: "left", trigger: "withPrevious" });
    expect(s.animations(slide).map((v) => v.id)).toEqual([x.id, y.id]);
    expect(x).toMatchObject({ class: "entrance", trigger: "onClick", duration: 500 });
    s.updateAnimation(slide, y.id, { duration: 900, delay: 100, easing: "easeOut" });
    expect(s.animations(slide)[1]).toMatchObject({ duration: 900, delay: 100, easing: "easeOut" });
    s.moveAnimation(slide, y.id, "up");
    expect(s.animations(slide).map((v) => v.id)).toEqual([y.id, x.id]);
    s.removeAnimations(slide, [x.id]);
    expect(s.animations(slide).map((v) => v.id)).toEqual([y.id]);
    s.undo();
    expect(s.animations(slide).length).toBe(2);
    while (s.canUndo && s.animations(slide).length) s.undo();
    expect(s.slide(slide).animations).toBeUndefined();
    s.redo();
    expect(s.animations(slide).length).toBe(1);
  });

  it("refuses an unknown target, a bad kind or a duplicate id", () => {
    const { s, slide, a } = setup();
    expect(() => s.addAnimation(slide, { target: "nope", kind: "fade" })).toThrow(/No element/);
    expect(() => s.addAnimation(slide, { target: a.id, kind: "pulse", class: "entrance" })).toThrow(/only an emphasis/);
    const x = s.addAnimation(slide, { target: a.id, kind: "fade" });
    expect(() => s.setAnimations(slide, [x, x])).toThrow(/same id|Two animations/);
  });

  it("deleting an element takes its animations with it, and undo brings both back", () => {
    const { s, slide, a, b } = setup();
    s.addAnimation(slide, { target: a.id, kind: "fade" });
    s.addAnimation(slide, { target: b.id, kind: "zoom" });
    s.deleteElements(slide, [a.id]);
    expect(s.animations(slide).map((v) => v.target)).toEqual([b.id]);
    s.undo();
    expect(s.animations(slide).map((v) => v.target)).toEqual([a.id, b.id]);
  });

  it("copy and paste, and duplicate, bring the animations along to the new elements", () => {
    const { s, slide, a } = setup();
    s.addAnimation(slide, { target: a.id, kind: "fly", direction: "right" });
    const clip = s.copyElements(slide, [a.id]);
    expect(clip.animations?.length).toBe(1);
    const [copy] = s.pasteElements(slide, clip, 10);
    const list = s.animations(slide);
    expect(list.length).toBe(2);
    expect(list[1]).toMatchObject({ target: copy, kind: "fly", direction: "right" });
    expect(list[1]!.id).not.toBe(list[0]!.id);
    const [dup] = s.duplicateElements(slide, [a.id]);
    expect(s.animations(slide).filter((v) => v.target === dup).length).toBe(1);
    // the clip also pastes on another slide
    const other = s.addSlide();
    const [onOther] = s.pasteElements(other.id, clip);
    expect(s.animations(other.id)[0]).toMatchObject({ target: onOther });
    expect(() => validateDeck(JSON.parse(JSON.stringify(s.deck)))).not.toThrow();
  });

  it("duplicating a slide gives the copy its own animations on its own elements", () => {
    const { s, slide, a } = setup();
    s.addAnimation(slide, { target: a.id, kind: "wipe" });
    const [copy] = s.duplicateSlides([slide]);
    const own = copy!.elements.map((e) => e.id);
    expect(copy!.animations?.length).toBe(1);
    expect(own).toContain(copy!.animations![0]!.target);
    expect(copy!.animations![0]!.target).not.toBe(a.id);
    expect(copy!.animations![0]!.id).not.toBe(s.animations(slide)[0]!.id);
    expect(cloneSlide(s.slide(slide)).animations![0]!.target).not.toBe(a.id);
  });

  it("grouping keeps the first member's animations on the group; ungrouping drops them", () => {
    const { s, slide, a, b } = setup();
    s.addAnimation(slide, { target: a.id, kind: "fade" });
    s.addAnimation(slide, { target: b.id, kind: "zoom" });
    const g = s.group(slide, [a.id, b.id])!;
    expect(s.animations(slide).map((v) => v.target)).toEqual([g]);
    s.ungroup(slide, g);
    expect(s.animations(slide)).toEqual([]);
  });

  it("a picture put in a placeholder keeps the placeholder's animation", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const ph = slide.elements[0]!;
    s.addAnimation(slide.id, { target: ph.id, kind: "fade" });
    const id = s.fillPlaceholderWithPicture(slide.id, ph.id, "data:image/png;base64,AA==", { w: 10, h: 10 });
    expect(s.animations(slide.id)[0]!.target).toBe(id);
  });

  it("is checked when a deck is read", () => {
    const { s, slide, a } = setup();
    s.addAnimation(slide, { target: a.id, kind: "spin", repeat: 2 });
    expect(parseDeck(serializeDeck(s.deck)).slides[0]!.animations?.[0]).toMatchObject({ kind: "spin", repeat: 2 });
    const bad = JSON.parse(JSON.stringify(s.deck));
    bad.slides[0].animations[0].target = "ghost";
    expect(() => validateDeck(bad)).toThrow(/no element "ghost"/);
    const worse = JSON.parse(JSON.stringify(s.deck));
    worse.slides[0].animations[0].kind = "explode";
    expect(() => validateDeck(worse)).toThrow(/unknown kind/);
  });
});

describe("the animation timeline", () => {
  const anim = (o: Partial<Animation> & { id: string; target: string }): Animation => ({ class: "entrance", kind: "fade", duration: 500, ...o });

  it("groups animations into click steps and times with/after previous", () => {
    const { s, slide, a, b, c } = setup();
    s.setAnimations(slide, [
      anim({ id: "1", target: a.id }),
      anim({ id: "2", target: b.id, trigger: "withPrevious", delay: 200 }),
      anim({ id: "3", target: c.id, trigger: "afterPrevious" }),
      anim({ id: "4", target: a.id, class: "exit" }),
    ]);
    const steps = buildTimeline(s.slide(slide));
    expect(steps.length).toBe(2);
    expect(steps[0]!.auto).toBe(false);
    expect(steps[0]!.effects.map((e) => [e.start, e.end])).toEqual([[0, 500], [200, 700], [700, 1200]]);
    expect(steps[0]!.duration).toBe(1200);
    expect(steps[1]!.effects.length).toBe(1);
  });

  it("starts by itself when the first animation is not on click", () => {
    const { s, slide, a } = setup();
    s.setAnimations(slide, [anim({ id: "1", target: a.id, trigger: "afterPrevious" })]);
    expect(buildTimeline(s.slide(slide))[0]!.auto).toBe(true);
  });

  it("builds text by paragraph, one click each", () => {
    const { s, slide, c } = setup();
    s.setAnimations(slide, [anim({ id: "1", target: c.id, text: "paragraph" })]);
    const steps = buildTimeline(s.slide(slide));
    expect(steps.length).toBe(3);
    expect(steps.map((st) => st.effects[0]!.paragraph)).toEqual([0, 1, 2]);
  });

  it("hides entrance elements until their turn and shows them after", () => {
    const { s, slide, a, b } = setup();
    s.setAnimations(slide, [anim({ id: "1", target: a.id }), anim({ id: "2", target: a.id, class: "exit" }), anim({ id: "3", target: b.id, class: "emphasis", kind: "spin" })]);
    const steps = buildTimeline(s.slide(slide));
    const at = (step: number, t: number) => poseAt(s.slide(slide), { steps, step, t }, frames(s, slide), size);
    expect(at(0, -1).get(a.id)!.visible).toBe(false);
    expect(at(0, 250).get(a.id)).toMatchObject({ visible: true, opacity: 0.5 });
    expect(at(0, Infinity).get(a.id)).toMatchObject({ visible: true, opacity: 1 });
    expect(at(1, Infinity).get(a.id)!.visible).toBe(false);
    expect(at(0, 0).get(b.id)).toMatchObject({ visible: true, rotate: 0 });
    expect(at(2, 250).get(b.id)!.rotate).toBeCloseTo(180);
    expect(at(2, Infinity).get(b.id)!.rotate).toBe(360);
    expect(finalPoses(s.slide(slide), frames(s, slide), size).get(a.id)!.visible).toBe(false);
  });

  it("flies in from just off the slide edge, wipes and moves along a path", () => {
    const { s, slide, a, b } = setup();
    s.setAnimations(slide, [
      anim({ id: "1", target: a.id, kind: "fly", direction: "left", easing: "linear" }),
      anim({ id: "2", target: b.id, kind: "wipe", direction: "up", trigger: "withPrevious" }),
      anim({ id: "3", target: a.id, class: "emphasis", kind: "motion", path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }),
    ]);
    const steps = buildTimeline(s.slide(slide));
    const f = frames(s, slide);
    const early = poseAt(s.slide(slide), { steps, step: 0, t: 0 }, f, size).get(a.id)!;
    expect(early.dx).toBeCloseTo(-200); // right edge at the slide's left edge
    expect(poseAt(s.slide(slide), { steps, step: 0, t: 250 }, f, size).get(b.id)!.clip).toEqual({ from: "up", t: 0.5 });
    const mid = poseAt(s.slide(slide), { steps, step: 1, t: 250 }, f, size).get(a.id)!;
    expect(mid.dx).toBeCloseTo(100);
    expect(mid.dy).toBeCloseTo(0);
    const end = poseAt(s.slide(slide), { steps, step: 1, t: Infinity }, f, size).get(a.id)!;
    expect(end).toMatchObject({ dx: 100, dy: 100 });
  });

  it("paragraph builds show paragraphs one by one", () => {
    const { s, slide, c } = setup();
    s.setAnimations(slide, [anim({ id: "1", target: c.id, text: "paragraph" })]);
    const steps = buildTimeline(s.slide(slide));
    const p = poseAt(s.slide(slide), { steps, step: 1, t: Infinity }, frames(s, slide), size).get(c.id)!;
    expect(p.visible).toBe(true);
    expect(p.paragraphs).toEqual({ 0: 1, 1: 1, 2: 0 });
  });

  it("repeat runs an emphasis several times", () => {
    const { s, slide, a } = setup();
    s.setAnimations(slide, [anim({ id: "1", target: a.id, class: "emphasis", kind: "spin", repeat: 2, easing: "linear" })]);
    const steps = buildTimeline(s.slide(slide));
    expect(steps[0]!.duration).toBe(1000);
    expect(poseAt(s.slide(slide), { steps, step: 0, t: 750 }, frames(s, slide), size).get(a.id)!.rotate).toBeCloseTo(180);
    expect(poseAt(s.slide(slide), { steps, step: 0, t: Infinity }, frames(s, slide), size).get(a.id)!.rotate).toBe(720);
  });

  void paragraphsFromText;
});

describe("animation edits that arrive in a burst", () => {
  it("can be merged into one undo step", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!.id;
    const a = s.addShape(slide, "rect", {});
    const x = s.addAnimation(slide, { target: a.id, kind: "fade" });
    s.updateAnimation(slide, x.id, { duration: 600 });
    s.updateAnimation(slide, x.id, { duration: 700 }, { merge: true });
    s.updateAnimation(slide, x.id, { duration: 800 }, { merge: true });
    expect(s.animations(slide)[0]!.duration).toBe(800);
    s.undo();
    expect(s.animations(slide)[0]!.duration).toBe(500);
  });
});
