// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimeline, type DeckSession } from "@pli.dev/decks";
import { PliDeck, PresentMode, SlideView, StepPlayer, setSelection } from "../src";
import { reshape } from "../src/MotionPanel";
import { elementLabel } from "../src/motion";
import { blur, byLabel, click, key, menuItem, newSession, pointer, q, qa, render, run, setValue, useHost } from "./harness";

useHost();
afterEach(() => vi.useRealTimers());

const FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame", "performance"] as const;
const fakeTime = () => vi.useFakeTimers({ toFake: [...FAKE] });
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const press = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const counter = () => q(".pli-deck-pcount").textContent;

/** The sample deck's slides: 0 title, 1 agenda (title + three-line body), 2 a title, a rectangle and an ellipse. */
function ids(s: DeckSession) {
  const [a, b, c] = s.deck.slides;
  const shapes = c!.elements.filter((e) => e.type === "shape" && !e.placeholder);
  return { s0: a!.id, s1: b!.id, s2: c!.id, t0: a!.elements[0]!.id, t1: b!.elements[0]!.id, body: b!.elements[1]!.id, title: c!.elements.find((e) => e.type === "shape" && e.placeholder)!.id, rect: shapes[0]!.id, ellipse: shapes[1]!.id };
}
const el = (id: string, within: ParentNode = document) => within.querySelector<HTMLElement>(`[data-element="${id}"]`);
const opacity = (id: string) => el(id)?.style.opacity;

function withAnimations() {
  const s = newSession();
  const d = ids(s);
  return { s, d };
}

// ---- Rendering a pose --------------------------------------------------------------------------------------------------

describe("drawing an animated element", () => {
  it("hides, fades, moves, turns and scales an element about its centre on top of its own rotation, and wipes with a clip", () => {
    const s = newSession();
    const d = ids(s);
    run(() => s.setFrame(d.s2, d.rect, { rotation: 30 }));
    const scene = s.scene(d.s2);
    const base = { visible: true, opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0 };
    render(<SlideView scene={scene} poses={new Map([[d.rect, { ...base, dx: 5, dy: -4, rotate: 10, scale: 2, opacity: 0.5 }], [d.ellipse, { ...base, visible: false }], [d.title, { ...base, clip: { from: "left" as const, t: 0.25 } }]])} />);
    expect(el(d.rect)!.style.transform).toBe("translate(5px, -4px) rotate(30deg) rotate(10deg) scale(2)");
    expect(el(d.rect)!.style.opacity).toBe("0.5");
    expect(el(d.ellipse)).toBeNull();
    expect(el(d.title)!.style.clipPath).toBe("inset(0 75% 0 0)");
    // without poses the slide is drawn as it always was
    render(<SlideView scene={scene} />);
    expect(el(d.rect)!.style.transform).toBe("rotate(30deg)");
    expect(el(d.rect)!.style.opacity).toBe("");
    expect(el(d.ellipse)).not.toBeNull();
  });

  it("wipes from each side", () => {
    const s = newSession();
    const d = ids(s);
    const base = { visible: true, opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0 };
    const clip = (from: "left" | "right" | "up" | "down") => {
      render(<SlideView scene={s.scene(d.s2)} poses={new Map([[d.rect, { ...base, clip: { from, t: 0.5 } }]])} />);
      return el(d.rect)!.style.clipPath;
    };
    expect(clip("right")).toBe("inset(0 0 0 50%)");
    expect(clip("up")).toBe("inset(0 0 50% 0)");
    expect(clip("down")).toBe("inset(50% 0 0 0)");
  });

  it("fades paragraphs one by one", () => {
    const { s, d } = withAnimations();
    render(<SlideView scene={s.scene(d.s1)} poses={new Map([[d.body, { visible: true, opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, paragraphs: { 0: 1, 1: 0.4, 2: 0 } }]])} />);
    const p = (i: number) => q<HTMLElement>(`[data-element="${d.body}"] .pli-deck-p[data-p="${i}"]`);
    expect(p(0).style.opacity).toBe("");
    expect(p(1).style.opacity).toBe("0.4");
    expect(p(2).style.opacity).toBe("0");
  });
});

// ---- The player --------------------------------------------------------------------------------------------------------

describe("stepping through a slide's animations", () => {
  const timeline = () => {
    const { s, d } = withAnimations();
    run(() => {
      s.addAnimation(d.s2, { target: d.rect, kind: "fade", duration: 400 });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "zoom", duration: 400, trigger: "withPrevious" });
      s.addAnimation(d.s2, { target: d.title, kind: "fade", duration: 400 });
    });
    return buildTimeline(s.slide(d.s2));
  };

  it("clicks run a step, a click during one finishes it, back undoes a step, skip finishes everything", () => {
    fakeTime();
    const player = new StepPlayer();
    player.load(timeline());
    expect(player.advance()).toBe(true);
    expect(player.running?.step).toBe(0);
    expect(player.advance()).toBe(true); // finishes step 0 rather than skipping to step 1
    expect(player.done).toBe(1);
    expect(player.running).toBeNull();
    expect(player.advance()).toBe(true);
    tick(500);
    expect(player.done).toBe(2);
    expect(player.advance()).toBe(false); // nothing left: the slideshow moves on
    expect(player.back()).toBe(true);
    expect(player.done).toBe(1);
    player.skipAll();
    expect(player.done).toBe(2);
    expect(player.remaining).toBe(false);
    player.load(timeline(), "end");
    expect(player.done).toBe(2);
    expect(player.back()).toBe(true);
    expect(player.back()).toBe(true);
    expect(player.back()).toBe(false);
  });

  it("running steps are not undone by going back past an auto step", () => {
    fakeTime();
    const { s, d } = withAnimations();
    run(() => {
      s.addAnimation(d.s2, { target: d.rect, kind: "fade", trigger: "afterPrevious" });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "fade" });
    });
    const player = new StepPlayer();
    player.load(buildTimeline(s.slide(d.s2)));
    expect(player.startAuto()).toBe(true);
    expect(player.back()).toBe(false); // the auto step is the slide's start
    tick(600);
    expect(player.done).toBe(1);
    expect(player.advance()).toBe(true);
    expect(player.back()).toBe(true);
    expect(player.done).toBe(1);
    expect(player.back()).toBe(false);
  });

  it("finishes every step at once when motion is reduced", () => {
    const player = new StepPlayer({ instant: () => true });
    player.load(timeline());
    player.advance();
    expect(player.running).toBeNull();
    expect(player.done).toBe(1);
  });
});

// ---- Presenting --------------------------------------------------------------------------------------------------------

describe("object animations in the slideshow", () => {
  function deck() {
    const { s, d } = withAnimations();
    run(() => {
      s.addAnimation(d.s0, { target: d.t0, kind: "fade", trigger: "afterPrevious", duration: 600 });
      s.addAnimation(d.s1, { target: d.body, kind: "fade", text: "paragraph", duration: 200 });
      s.addAnimation(d.s2, { target: d.rect, kind: "fade", duration: 400 });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "fly", direction: "left", trigger: "afterPrevious", duration: 400 });
      s.addAnimation(d.s2, { target: d.title, kind: "wipe", direction: "left", duration: 300 });
    });
    return { s, d };
  }
  const mount = (s: DeckSession, props: Partial<Parameters<typeof PresentMode>[0]> = {}, key?: string) => render(<PresentMode key={key} session={s} onExit={() => undefined} fullscreen={false} {...props} />);

  it("an auto step plays by itself as the slide shows, and the first click then goes to the next slide", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s);
    expect(opacity(d.t0)).toBe("0");
    tick(320);
    expect(Number(opacity(d.t0))).toBeGreaterThan(0.3);
    expect(Number(opacity(d.t0))).toBeLessThan(0.7);
    tick(400);
    expect(opacity(d.t0)).toBe("");
    expect(counter()).toBe("Slide 1 / 3");
    press("ArrowRight");
    expect(counter()).toBe("Slide 2 / 3");
  });

  it("shows entrance elements hidden at first, plays a click step, finishes it on the next click, then the next step, then moves on", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s, { start: 2 });
    expect(el(d.rect)).toBeNull();
    expect(el(d.ellipse)).toBeNull();
    expect(el(d.title)).toBeNull();
    press("ArrowRight");
    expect(opacity(d.rect)).toBe("0");
    tick(200);
    expect(opacity(d.rect)).toBe("0.5");
    expect(el(d.ellipse)).toBeNull(); // waits for the rectangle (after previous)
    tick(300);
    expect(opacity(d.rect)).toBe("");
    expect(el(d.ellipse)!.style.transform).toContain("translate(");
    press("ArrowRight"); // completes the running step instead of skipping a step
    expect(el(d.ellipse)!.style.transform).toBe("");
    expect(el(d.title)).toBeNull();
    expect(counter()).toBe("Slide 3 / 3");
    press(" ");
    expect(el(d.title)!.style.clipPath).toContain("inset(");
    tick(400);
    expect(el(d.title)!.style.clipPath).toBe("");
    press("n");
    expect(q(".pli-deck-present-end")).toBeTruthy();
  });

  it("builds text by paragraph, one click each", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s, { start: 1 });
    const p = (i: number) => q<HTMLElement>(`[data-element="${d.body}"] .pli-deck-p[data-p="${i}"]`);
    expect([0, 1, 2].map((i) => p(i).style.opacity)).toEqual(["0", "0", "0"]);
    press("Enter");
    tick(250);
    expect([0, 1, 2].map((i) => p(i).style.opacity)).toEqual(["", "0", "0"]);
    press("PageDown");
    press("PageDown");
    expect(p(1).style.opacity).toBe("");
    expect(p(2).style.opacity).toBe("0");
    expect(counter()).toBe("Slide 2 / 3");
  });

  it("goes back one step at a time (instantly) before the previous slide, which opens with its animations done", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s, { start: 2 });
    press("ArrowRight");
    tick(900);
    press("ArrowRight");
    tick(400);
    expect(el(d.title)!.style.clipPath).toBe("");
    press("ArrowLeft");
    expect(el(d.title)).toBeNull();
    expect(el(d.rect)).not.toBeNull();
    expect(counter()).toBe("Slide 3 / 3");
    press("p");
    expect(el(d.rect)).toBeNull();
    expect(el(d.ellipse)).toBeNull();
    expect(counter()).toBe("Slide 3 / 3");
    press("Backspace");
    expect(counter()).toBe("Slide 2 / 3");
    const p = (i: number) => q<HTMLElement>(`[data-element="${d.body}"] .pli-deck-p[data-p="${i}"]`);
    expect([0, 1, 2].map((i) => p(i).style.opacity)).toEqual(["", "", ""]);
    // going forward to a slide again starts it over
    press("ArrowRight");
    expect(el(d.rect)).toBeNull();
  });

  it("Home, End and a typed number show a slide at its start", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s, { start: 2 });
    press("ArrowRight");
    tick(1000);
    press("Home");
    expect(counter()).toBe("Slide 1 / 3");
    expect(opacity(d.t0)).toBe("0");
    press("End");
    expect(counter()).toBe("Slide 3 / 3");
    expect(el(d.rect)).toBeNull();
    press("2");
    press("Enter");
    expect(el(d.body)!.querySelector<HTMLElement>('.pli-deck-p[data-p="0"]')!.style.opacity).toBe("0");
  });

  it("A jumps all the slide's remaining animations to their end, and a button does too", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s, { start: 2 });
    press("a");
    expect(el(d.rect)).not.toBeNull();
    expect(el(d.ellipse)!.style.transform).toBe("");
    expect(el(d.title)!.style.clipPath).toBe("");
    expect(counter()).toBe("Slide 3 / 3");
    expect(host_has("Skip animations")).toBe(false);
    press("ArrowRight");
    expect(q(".pli-deck-present-end")).toBeTruthy();
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowLeft");
    click(byLabel("Skip animations"));
    expect(el(d.title)).not.toBeNull();
  });

  it("reduced motion: each step is complete the moment it starts, with no movement", () => {
    fakeTime();
    const orig = window.matchMedia;
    window.matchMedia = ((m: string) => ({ matches: m.includes("reduce"), addEventListener() {}, removeEventListener() {}, media: m }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const { s, d } = deck();
      mount(s);
      expect(opacity(d.t0)).toBe(""); // the auto step is already done
      press("ArrowRight");
      press("ArrowRight");
      press("ArrowRight");
      press("ArrowRight");
      expect(counter()).toBe("Slide 2 / 3");
      press("ArrowRight");
      expect(counter()).toBe("Slide 3 / 3");
      press("ArrowRight");
      expect(opacity(d.rect)).toBe("");
      expect(el(d.ellipse)!.style.transform).toBe("");
      expect(el(d.title)).toBeNull(); // step by step still
    } finally {
      window.matchMedia = orig;
    }
  });

  it("the reduceMotion option wins over the system, and animations={false} shows slides as drawn", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s, { start: 2, reduceMotion: true });
    press("ArrowRight");
    expect(opacity(d.rect)).toBe("");
    expect(el(d.ellipse)).not.toBeNull();
    mount(s, { start: 2, animations: false }, "off");
    expect(el(d.title)).not.toBeNull();
    expect(el(d.rect)).not.toBeNull();
    press("ArrowRight");
    expect(q(".pli-deck-present-end")).toBeTruthy();
  });

  it("the element animations start after the slide transition is over", () => {
    fakeTime();
    const { s, d } = withAnimations();
    run(() => {
      s.setTransition([d.s1], { type: "fade", duration: 400 });
      s.addAnimation(d.s1, { target: d.t1, kind: "fade", trigger: "afterPrevious", duration: 500 });
    });
    mount(s);
    press("ArrowRight");
    expect(qa(".pli-deck-present-layer").length).toBe(2);
    tick(300);
    expect(el(d.t1, q(".pli-deck-present-in"))).toBeNull();
    tick(200); // transition over (430 ms)
    expect(qa(".pli-deck-present-layer").length).toBe(1);
    tick(16);
    tick(250);
    expect(el(d.t1)).not.toBeNull();
    expect(Number(opacity(d.t1))).toBeGreaterThan(0.2);
    expect(Number(opacity(d.t1))).toBeLessThan(0.8);
    tick(400);
    expect(opacity(d.t1)).toBe("");
  });

  it("a click during a slide transition ends it and plays the first step", () => {
    fakeTime();
    const { s, d } = withAnimations();
    run(() => {
      s.setTransition([d.s2], { type: "fade", duration: 2000 });
      s.addAnimation(d.s2, { target: d.rect, kind: "fade", duration: 400 });
    });
    mount(s, { start: 1 });
    press("ArrowRight");
    expect(qa(".pli-deck-present-layer").length).toBe(2);
    press("ArrowRight");
    expect(qa(".pli-deck-present-layer").length).toBe(1);
    expect(counter()).toBe("Slide 3 / 3");
    expect(opacity(d.rect)).toBe("0");
  });

  it("the presenter view shows the same animation state as the audience", () => {
    fakeTime();
    const { s, d } = deck();
    mount(s, { start: 2, presenter: true });
    const cur = () => q(".pli-deck-presenter-current");
    expect(el(d.rect, cur())).toBeNull();
    press("ArrowRight");
    tick(200);
    expect(el(d.rect, cur())!.style.opacity).toBe("0.5");
    press("ArrowRight");
    expect(el(d.rect, cur())!.style.opacity).toBe("");
    expect(el(d.ellipse, cur())).not.toBeNull();
    // the next slide is shown as it will first appear
    mount(s, { start: 0, presenter: true }, "p0");
    expect(el(d.rect, q(".pli-deck-presenter-next"))).toBeNull();
  });

  it("auto-advance after a time goes to the next slide even with animations left", () => {
    fakeTime();
    const { s, d } = deck();
    run(() => s.setTransition([d.s2], { type: "none", advanceAfter: 3000 }));
    mount(s, { start: 2 });
    tick(3100);
    expect(q(".pli-deck-present-end")).toBeTruthy();
  });
});

const host_has = (label: string) => !!document.querySelector(`[aria-label="${label}"]`);

// ---- The editor --------------------------------------------------------------------------------------------------------

function editor() {
  const s = newSession();
  const d = ids(s);
  s.selection = { slide: d.s2, slides: [d.s2], elements: [] };
  render(<PliDeck session={s} />);
  const select = (...elements: string[]) => run(() => setSelection(s, { slide: d.s2, slides: [d.s2], elements }));
  const motion = () => click(q('button[aria-label="Motion"]'));
  return { s, d, select, motion };
}
const rows = () => qa(".pli-deck-anim-row");
const field = (label: string) => document.querySelector<HTMLSelectElement | HTMLInputElement>(`.pli-deck-motion-panel [aria-label="${label}"]`)!;
const commit = (label: string, v: string) => {
  const f = field(label);
  setValue(f, v);
  blur(f);
};

describe("the Motion panel", () => {
  it("opens from the toolbar and the Slide menu, with no animations at first", () => {
    const { motion } = editor();
    expect(document.querySelector(".pli-deck-motion-panel")).toBeNull();
    motion();
    expect(q(".pli-deck-motion-panel").textContent).toContain("No animations yet");
    expect(q<HTMLButtonElement>('button[aria-label="Add animation"], .pli-deck-motion-panel .pli-button-primary').disabled).toBe(true);
    click(byLabel("Close motion panel"));
    expect(document.querySelector(".pli-deck-motion-panel")).toBeNull();
    click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "Slide"));
    click(menuItem("Motion…"));
    expect(document.querySelector(".pli-deck-motion-panel")).not.toBeNull();
  });

  it("adds an animation for the selected object, edits every setting, and each change undoes", () => {
    const { s, d, select, motion } = editor();
    select(d.rect);
    motion();
    click(q(".pli-deck-motion-panel .pli-button-primary"));
    expect(s.animations(d.s2)).toMatchObject([{ target: d.rect, class: "entrance", kind: "fade", trigger: "onClick" }]);
    expect(rows().length).toBe(1);
    expect(rows()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(rows()[0]!.textContent).toContain("Rectangle");
    const id = s.animations(d.s2)[0]!.id;
    const a = () => s.animations(d.s2)[0]!;

    setValue(field("Animation effect") as HTMLSelectElement, "fly");
    expect(a()).toMatchObject({ kind: "fly", direction: "down" });
    setValue(field("Animation direction") as HTMLSelectElement, "left");
    expect(a().direction).toBe("left");
    setValue(field("Animation start") as HTMLSelectElement, "afterPrevious");
    expect(a().trigger).toBe("afterPrevious");
    commit("Animation duration", "1.25");
    expect(a().duration).toBe(1250);
    commit("Animation delay", "0.5");
    expect(a().delay).toBe(500);
    setValue(field("Animation easing") as HTMLSelectElement, "easeOut");
    expect(a().easing).toBe("easeOut");
    commit("Animation repeat", "3");
    expect(a().repeat).toBe(3);
    setValue(field("Animation class") as HTMLSelectElement, "exit");
    expect(a().class).toBe("exit");
    expect([...(field("Animation direction") as HTMLSelectElement).options].map((o) => o.text)).toContain("To left");
    // only the kinds that fit the class are offered, and a kind that doesn't fit is replaced
    setValue(field("Animation class") as HTMLSelectElement, "emphasis");
    expect([...(field("Animation effect") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["spin", "pulse", "grow", "motion"]);
    expect(a()).toMatchObject({ class: "emphasis", kind: "pulse", amount: 1.1 });
    expect(a().direction).toBeUndefined();
    commit("Animation pulse size", "1.3");
    expect(a().amount).toBe(1.3);
    setValue(field("Animation target") as HTMLSelectElement, d.ellipse);
    expect(a().target).toBe(d.ellipse);
    expect(a().id).toBe(id);

    // every change is one undo step
    run(() => s.undo());
    expect(a().target).toBe(d.rect);
    run(() => s.undo());
    expect(a().amount).toBe(1.1);
    run(() => {
      while (s.animations(d.s2).length) s.undo();
    });
    expect(rows().length).toBe(0);
  });

  it("only offers a text build for objects with text, and not for emphasis", () => {
    const { s, d, select, motion } = editor();
    run(() => s.setText(d.s2, d.title, [{ runs: [{ text: "One" }] }, { runs: [{ text: "Two" }] }]));
    select(d.rect);
    motion();
    click(q(".pli-deck-motion-panel .pli-button-primary"));
    expect(field("Animation text build")).toBeNull();
    setValue(field("Animation target") as HTMLSelectElement, d.title);
    setValue(field("Animation text build") as HTMLSelectElement, "paragraph");
    expect(s.animations(d.s2)[0]!.text).toBe("paragraph");
    expect(buildTimeline(s.slide(d.s2)).length).toBe(2);
    setValue(field("Animation text build") as HTMLSelectElement, "all");
    expect(s.animations(d.s2)[0]!.text).toBeUndefined();
    setValue(field("Animation class") as HTMLSelectElement, "emphasis");
    expect(field("Animation text build")).toBeNull();
  });

  it("lists the animations with number, object, effect, trigger and duration, and moves, duplicates and removes them", () => {
    const { s, d, select, motion } = editor();
    run(() => {
      s.addAnimation(d.s2, { target: d.rect, kind: "fade", duration: 1500 });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "fly", direction: "left", trigger: "withPrevious" });
      s.addAnimation(d.s2, { target: d.title, kind: "pulse", trigger: "afterPrevious" });
    });
    select();
    motion();
    expect(rows().map((r) => r.querySelector(".pli-deck-anim-index")!.textContent)).toEqual(["1", "2", "3"]);
    expect(rows()[0]!.textContent).toContain("Rectangle");
    expect(rows()[0]!.textContent).toContain("Fade in");
    expect(rows()[0]!.textContent).toContain("Click");
    expect(rows()[0]!.textContent).toContain("1.5 s");
    expect(rows()[1]!.textContent).toContain("Ellipse");
    expect(rows()[1]!.textContent).toContain("Fly in from left");
    expect(rows()[1]!.textContent).toContain("With prev.");
    expect(rows()[2]!.textContent).toContain("Title");
    expect(rows()[2]!.dataset.class).toBe("emphasis");
    expect(rows()[2]!.getAttribute("aria-label")).toContain("after previous");

    click(rows()[1]!);
    click(byLabel("Move animation up"));
    expect(s.animations(d.s2).map((a) => a.target)).toEqual([d.ellipse, d.rect, d.title]);
    click(byLabel("Move animation down"));
    expect(s.animations(d.s2).map((a) => a.target)).toEqual([d.rect, d.ellipse, d.title]);
    click(byLabel("Duplicate animation"));
    expect(s.animations(d.s2).map((a) => a.target)).toEqual([d.rect, d.ellipse, d.ellipse, d.title]);
    expect(s.animations(d.s2)[2]).toMatchObject({ kind: "fly", direction: "left", trigger: "withPrevious" });
    expect(new Set(s.animations(d.s2).map((a) => a.id)).size).toBe(4);
    click(byLabel("Remove animation"));
    expect(s.animations(d.s2).map((a) => a.target)).toEqual([d.rect, d.ellipse, d.title]);
    run(() => s.undo());
    expect(s.animations(d.s2).length).toBe(4);
    expect(byLabel("Move animation up").hasAttribute("disabled")).toBe(false);
  });

  it("keyboard: arrows pick, Alt+arrows move, Delete removes, Cmd+D duplicates, and none of it touches the objects", () => {
    const { s, d, select, motion } = editor();
    run(() => {
      s.addAnimation(d.s2, { target: d.rect, kind: "fade" });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "zoom" });
    });
    select(d.rect);
    motion();
    const list = q(".pli-deck-anim-list");
    const [a, b] = s.animations(d.s2);
    key(list, "ArrowDown");
    expect(list.getAttribute("aria-activedescendant")).toBe(`anim-${a!.id}`);
    key(list, "ArrowDown");
    expect(list.getAttribute("aria-activedescendant")).toBe(`anim-${b!.id}`);
    key(list, "ArrowUp", { altKey: true });
    expect(s.animations(d.s2).map((x) => x.id)).toEqual([b!.id, a!.id]);
    key(list, "d", { metaKey: true });
    expect(s.animations(d.s2).length).toBe(3);
    expect(s.slide(d.s2).elements.length).toBe(3); // no object was duplicated
    key(list, "Delete");
    expect(s.animations(d.s2).length).toBe(2);
    expect(s.slide(d.s2).elements.length).toBe(3); // and none deleted
    expect(s.selection.elements).toEqual([d.rect]);
  });

  it("reorders by dragging a row's grip", () => {
    const { s, d, select, motion } = editor();
    run(() => {
      s.addAnimation(d.s2, { target: d.rect, kind: "fade" });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "zoom" });
      s.addAnimation(d.s2, { target: d.title, kind: "spin" });
    });
    select();
    motion();
    rows().forEach((r, i) => (r.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40, left: 0, right: 100, width: 100, x: 0, y: i * 40, toJSON() {} }) as DOMRect));
    const first = s.animations(d.s2)[0]!.id;
    pointer(rows()[0]!.querySelector(".pli-deck-anim-grip")!, "pointerdown", 0, 20);
    pointer(window, "pointermove", 0, 110);
    pointer(window, "pointerup", 0, 110);
    expect(s.animations(d.s2).map((a) => a.id)[2]).toBe(first);
    run(() => s.undo());
    expect(s.animations(d.s2)[0]!.id).toBe(first);
  });

  it("is view-only when the editor is read only, but can still play", () => {
    const s = newSession();
    const d = ids(s);
    run(() => s.addAnimation(d.s2, { target: d.rect, kind: "fade" }));
    s.selection = { slide: d.s2, slides: [d.s2], elements: [d.rect] };
    render(<PliDeck session={s} readOnly />);
    click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "Slide"));
    click(menuItem("Motion…"));
    click(rows()[0]!);
    expect(byLabel("Remove animation").hasAttribute("disabled")).toBe(true);
    expect(byLabel("Duplicate animation").hasAttribute("disabled")).toBe(true);
    expect(q<HTMLButtonElement>(".pli-deck-motion-panel .pli-button-primary").disabled).toBe(true);
    expect(field("Animation effect").disabled).toBe(true);
    expect(q(".pli-deck-anim-grip", document.body)).toBeNull();
    expect(byLabel("Play animations").hasAttribute("disabled")).toBe(false);
    key(q(".pli-deck-anim-list"), "Delete");
    expect(s.animations(d.s2).length).toBe(1);
  });

  it("the Insert menu and the object's context menu add an animation to the selected object", () => {
    const { s, d, select } = editor();
    select(d.rect);
    click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "Insert"));
    click(menuItem("Animation"));
    expect(s.animations(d.s2).map((a) => a.target)).toEqual([d.rect]);
    expect(document.querySelector(".pli-deck-motion-panel")).not.toBeNull();
    // right click on the ellipse (it becomes the selection) and "Add animation"
    pointer(q(".pli-deck-stage"), "contextmenu", 450, 200);
    click(menuItem("Add animation"));
    expect(s.animations(d.s2).map((a) => a.target)).toEqual([d.rect, d.ellipse]);
    expect(rows().length).toBe(2);
    run(() => s.undo());
    expect(s.animations(d.s2).length).toBe(1);
  });

  it("swaps the shown settings in for the selected row, and says when a problem comes up", () => {
    const { s, d, select, motion } = editor();
    run(() => {
      s.addAnimation(d.s2, { target: d.rect, kind: "spin" });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "grow" });
    });
    select();
    motion();
    click(rows()[0]!);
    expect(field("Animation rotation")).not.toBeNull();
    click(rows()[1]!);
    expect(field("Animation rotation")).toBeNull();
    expect(field("Animation scale")).not.toBeNull();
    commit("Animation scale", "0.5");
    expect(s.animations(d.s2)[1]!.amount).toBe(0.5);
  });
});

describe("motion paths", () => {
  function pathEditor() {
    const e = editor();
    run(() => e.s.addAnimation(e.d.s2, { target: e.d.rect, kind: "motion", path: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    e.select();
    e.motion();
    click(rows()[0]!);
    return e;
  }
  const path = (e: ReturnType<typeof pathEditor>) => e.s.animations(e.d.s2)[0]!.path;

  it("edits the points as numbers, adds and removes points", () => {
    const e = pathEditor();
    commit("Point 2 X", "80");
    commit("Point 2 Y", "-20");
    expect(path(e)).toEqual([{ x: 0, y: 0 }, { x: 80, y: -20 }]);
    click(byLabel("Add point") ?? [...document.querySelectorAll<HTMLElement>(".pli-deck-anim-path .pli-button")].find((b) => b.textContent?.includes("Add point")));
    expect(path(e)).toEqual([{ x: 0, y: 0 }, { x: 80, y: -20 }, { x: 130, y: -20 }]);
    expect(byLabel("Remove point 2").hasAttribute("disabled")).toBe(false);
    click(byLabel("Remove point 2"));
    expect(path(e)).toEqual([{ x: 0, y: 0 }, { x: 130, y: -20 }]);
    expect(byLabel("Remove point 2").hasAttribute("disabled")).toBe(true);
    run(() => e.s.undo());
    expect(path(e)!.length).toBe(3);
  });

  it("draws the path over the canvas and moves a point by dragging it, as one undo step", () => {
    const e = pathEditor();
    // the rectangle is at 100,150 (120 by 80): its centre is 160,190
    const handle = (i: number) => q<HTMLElement>(`[data-path-point="${i}"]`);
    expect(handle(0).style.left).toBe("160px");
    expect(handle(1).style.left).toBe("260px");
    expect(handle(1).style.top).toBe("190px");
    pointer(handle(1), "pointerdown", 260, 190);
    pointer(window, "pointermove", 300, 250);
    pointer(window, "pointermove", 310, 260);
    expect(path(e)![1]).toEqual({ x: 100, y: 0 }); // nothing is stored until the drop
    expect(handle(1).style.left).toBe("310px");
    pointer(window, "pointerup", 310, 260);
    expect(path(e)).toEqual([{ x: 0, y: 0 }, { x: 150, y: 70 }]);
    run(() => e.s.undo());
    expect(path(e)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    // the start point can't be dragged, and arrow keys nudge a point
    pointer(handle(0), "pointerdown", 160, 190);
    pointer(window, "pointermove", 200, 200);
    pointer(window, "pointerup", 200, 200);
    expect(path(e)![0]).toEqual({ x: 0, y: 0 });
    key(handle(1), "ArrowRight", { shiftKey: true });
    expect(path(e)![1]).toEqual({ x: 110, y: 0 });
  });

  it("clean points: the first stays 0,0", () => {
    const e = pathEditor();
    expect(q('[data-path-point="0"]').dataset.start).toBe("");
  });
});

describe("badges and indicators", () => {
  it("numbers animated objects on the canvas when the panel is open or the object is selected, and a click picks the animation", () => {
    const { s, d, select, motion } = editor();
    run(() => {
      s.addAnimation(d.s2, { target: d.rect, kind: "fade" });
      s.addAnimation(d.s2, { target: d.ellipse, kind: "zoom" });
      s.addAnimation(d.s2, { target: d.rect, kind: "pulse" });
    });
    select();
    const badges = () => qa(".pli-deck-anim-badge", q(".pli-deck-canvas-slide"));
    expect(badges().length).toBe(0);
    select(d.ellipse);
    expect(badges().map((b) => b.textContent)).toEqual(["2"]);
    select(d.rect);
    expect(badges().map((b) => b.textContent)).toEqual(["1", "3"]);
    select();
    motion();
    expect(badges().map((b) => b.textContent).sort()).toEqual(["1", "2", "3"]);
    expect(badges()[0]!.getAttribute("aria-label")).toMatch(/^Animation \d: /);
    click(badges().find((b) => b.textContent === "2")!);
    expect(rows()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(badges().find((b) => b.textContent === "2")!.getAttribute("aria-pressed")).toBe("true");
    // clicking a badge does not select or move objects
    expect(s.selection.elements).toEqual([]);
  });

  it("opens the panel when a badge is clicked with it closed", () => {
    const { s, d, select } = editor();
    run(() => s.addAnimation(d.s2, { target: d.rect, kind: "fade" }));
    select(d.rect);
    expect(document.querySelector(".pli-deck-motion-panel")).toBeNull();
    click(q(".pli-deck-anim-badge"));
    expect(document.querySelector(".pli-deck-motion-panel")).not.toBeNull();
    expect(rows()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("never draws badges in thumbnails, the slideshow, or in a plain SlideView; the filmstrip marks slides that have animations", () => {
    const { s, d, motion } = editor();
    run(() => s.addAnimation(d.s2, { target: d.rect, kind: "fade" }));
    motion();
    expect(qa(".pli-deck-film-thumb .pli-deck-anim-badge").length).toBe(0);
    const marks = qa(".pli-deck-film-anim");
    expect(marks.length).toBe(1);
    expect(marks[0]!.closest(".pli-deck-film-item")!.getAttribute("data-slide-id")).toBe(d.s2);
    expect(marks[0]!.getAttribute("aria-label")).toBe("1 animation");
    run(() => s.addAnimation(d.s2, { target: d.ellipse, kind: "fade" }));
    expect(qa(".pli-deck-film-anim")[0]!.getAttribute("aria-label")).toBe("2 animations");
    render(<SlideView scene={s.scene(d.s2)} />);
    expect(qa(".pli-deck-anim-badge").length).toBe(0);
    render(<PresentMode session={s} start={2} onExit={() => undefined} fullscreen={false} />);
    expect(qa(".pli-deck-anim-badge").length).toBe(0);
  });
});

describe("the preview on the canvas", () => {
  function previewing() {
    const e = editor();
    run(() => {
      e.s.addAnimation(e.d.s2, { target: e.d.rect, kind: "fade", duration: 400 });
      e.s.addAnimation(e.d.s2, { target: e.d.ellipse, kind: "zoom", duration: 400 });
    });
    e.select();
    e.motion();
    return e;
  }
  const canvasEl = (id: string) => el(id, q(".pli-deck-canvas-slide"));

  it("Play runs the steps one after another, then restores the slide by itself", () => {
    fakeTime();
    const { d } = previewing();
    click(byLabel("Play animations"));
    expect(byLabel("Stop preview")).toBeTruthy();
    expect(canvasEl(d.rect)!.style.opacity).toBe("0");
    expect(canvasEl(d.ellipse)).toBeNull();
    expect(q(".pli-deck-stage").dataset.previewing).toBe("");
    tick(200);
    expect(canvasEl(d.rect)!.style.opacity).toBe("0.5");
    tick(250); // step 1 done; a pause; step 2
    tick(400);
    expect(canvasEl(d.ellipse)).not.toBeNull();
    tick(500);
    tick(1000);
    expect(canvasEl(d.rect)!.style.opacity).toBe("");
    expect(canvasEl(d.ellipse)).not.toBeNull();
    expect(host_has("Play animations")).toBe(true);
    expect(q(".pli-deck-stage").dataset.previewing).toBeUndefined();
  });

  it("Stop restores the slide at once, and an edit, another slide or Escape ends the preview", () => {
    fakeTime();
    const { s, d } = previewing();
    click(byLabel("Play animations"));
    tick(100);
    click(byLabel("Stop preview"));
    expect(canvasEl(d.rect)!.style.opacity).toBe("");
    click(byLabel("Play animations"));
    expect(canvasEl(d.rect)!.style.opacity).not.toBe("");
    run(() => s.moveBy(d.s2, [d.title], 1, 0));
    expect(host_has("Play animations")).toBe(true);
    click(byLabel("Play animations"));
    key(q(".pli-deck-root"), "Escape");
    expect(host_has("Play animations")).toBe(true);
    click(byLabel("Play animations"));
    pointer(qa(".pli-deck-film-item")[0]!, "pointerdown", 5, 5);
    pointer(window, "pointerup");
    expect(host_has("Play animations")).toBe(true);
  });

  it("with reduced motion it shows the end state", () => {
    fakeTime();
    const orig = window.matchMedia;
    window.matchMedia = ((m: string) => ({ matches: m.includes("reduce"), addEventListener() {}, removeEventListener() {}, media: m }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const { d } = previewing();
      click(byLabel("Play animations"));
      expect(byLabel("Stop preview")).toBeTruthy();
      expect(canvasEl(d.rect)!.style.opacity).toBe("");
      expect(canvasEl(d.ellipse)).not.toBeNull();
      expect(canvasEl(d.ellipse)!.style.transform).toBe("");
    } finally {
      window.matchMedia = orig;
    }
  });
});

describe("helpers", () => {
  it("reshape fills in what a new kind needs and drops what it does not", () => {
    const base = { id: "a", target: "t", class: "entrance" as const, kind: "fly" as const, direction: "left" as const, duration: 500, trigger: "onClick" as const };
    expect(reshape(base, { kind: "spin" })).toEqual({ kind: "spin", direction: null, amount: 360 });
    expect(reshape(base, { kind: "appear" })).toEqual({ kind: "appear", direction: null, duration: 0 });
    expect(reshape({ id: "a", target: "t", class: "entrance", kind: "appear", duration: 0 }, { kind: "zoom" })).toMatchObject({ kind: "zoom", duration: 500 });
    expect(reshape(base, { class: "emphasis" })).toMatchObject({ class: "emphasis", kind: "pulse", direction: null, amount: 1.1 });
    expect(reshape(base, { class: "emphasis", kind: "motion" })).toMatchObject({ path: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
    expect(reshape(base, { delay: null })).toEqual({});
    expect(reshape({ ...base, text: "paragraph" }, { class: "emphasis" })).toMatchObject({ text: null });
  });

  it("names elements by what they are", () => {
    const { s, d } = withAnimations();
    const named = (slide: string, id: string) => elementLabel(s.scene(slide).elements.find((e) => e.id === id)!);
    expect(named(d.s0, d.t0)).toBe("Title");
    expect(named(d.s1, d.body)).toBe("One Two Three");
    expect(named(d.s2, d.rect)).toBe("Rectangle");
    expect(named(d.s2, d.ellipse)).toBe("Ellipse");
    run(() => s.setText(d.s2, d.rect, [{ runs: [{ text: "A long caption that goes on and on and on" }] }]));
    expect(named(d.s2, d.rect)).toMatch(/^A long caption that…$/);
  });
});
