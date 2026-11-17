// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckSession, plainText } from "@pli.dev/decks";
import DecksLive from "../src/live/DecksLive";
import { DeckDirector } from "../src/live/decks/director";
import { DECK_STEPS, actionsFor, snapshotOf, slideShownAt } from "../src/live/decks/script";
import type { LiveBodyProps } from "../src/live/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warns = vi.spyOn(console, "warn").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  errors.mockRestore();
  warns.mockRestore();
});

const props = (over: Partial<LiveBodyProps> = {}): LiveBodyProps => ({ step: 0, steps: 3, interactive: false, reducedMotion: true, mode: "story", onReady: () => {}, ...over });
const mount = (p: LiveBodyProps, strict = false) => act(() => root.render(strict ? <StrictMode><DecksLive {...p} /></StrictMode> : <DecksLive {...p} />));
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** What the editor shows, read from its DOM. */
function shown() {
  const thumbs = [...host.querySelectorAll(".pli-deck-film-item")];
  const current = thumbs.findIndex((t) => t.hasAttribute("data-current"));
  const animations = [...host.querySelectorAll(".pli-deck-film-anim")].map((a) => a.getAttribute("aria-label"));
  const canvas = host.querySelector(".pli-deck-canvas-slide")?.textContent ?? "";
  return { slides: thumbs.length, current, animations, canvas };
}

describe("the Decks editor on the site", () => {
  it("renders the real editor, calls onReady once after its first frame, and logs nothing", async () => {
    const onReady = vi.fn();
    mount(props({ onReady }));
    expect(host.querySelector(".pli-deck")).not.toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    advance(1000);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
  });

  it("shows the state of each step when it is given at once (reduced motion)", () => {
    const seen = [0, 1, 2].map((step) => {
      mount(props({ step }));
      return shown();
    });
    expect(seen[0]).toMatchObject({ slides: 1, current: 0, animations: [] });
    expect(seen[0]!.canvas).toContain("Product review");
    expect(seen[1]).toMatchObject({ slides: 2, current: 1, animations: [] });
    expect(seen[1]!.canvas).toContain("Wins and worries");
    expect(seen[1]!.canvas).toContain("Hiring is behind plan");
    expect(seen[2]).toMatchObject({ slides: 3, current: 2 });
    expect(seen[2]!.animations).toEqual(["5 animations"]);
    expect(seen[2]!.canvas).toContain("From idea to launch");
    expect(seen[2]!.canvas).toContain("Launch");
    expect(seen[2]!.canvas).toContain("+17%");
    expect(host.querySelector(".pli-deck-canvas-slide .pli-deck-chart-svg")).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
  });

  it("goes 2 -> 0 -> 2 and ends in the same state, without remounting the editor", () => {
    mount(props({ step: 2 }));
    const editor = host.querySelector(".pli-deck");
    const first = shown();
    mount(props({ step: 0 }));
    expect(shown()).toMatchObject({ slides: 1, current: 0, animations: [] });
    mount(props({ step: 2 }));
    expect(shown()).toEqual(first);
    expect(host.querySelector(".pli-deck")).toBe(editor);
  });

  it("plays a step forward with delays when motion is allowed, and ends where the instant version does", () => {
    mount(props({ step: 0, reducedMotion: false }));
    expect(shown().slides).toBe(1);
    mount(props({ step: 1, reducedMotion: false }));
    expect(shown()).toMatchObject({ slides: 2, current: 1 }); // the slide is added and shown at once
    advance(1500);
    mount(props({ step: 2, reducedMotion: false }));
    expect(shown().slides).toBe(3);
    expect(shown().animations).toEqual([]); // objects arrive one at a time
    expect(shown().canvas).not.toContain("Launch");
    advance(1600);
    expect(shown().canvas).toContain("Launch");
    advance(2000);
    expect(shown().animations).toEqual(["5 animations"]);
    mount(props({ step: 2, reducedMotion: true }));
    expect(shown()).toMatchObject({ slides: 3, current: 2, animations: ["5 animations"] });
  });

  it("stops scripting once the visitor has the editor, and leaves its timers behind none", () => {
    mount(props({ step: 0, reducedMotion: false }));
    mount(props({ step: 2, reducedMotion: false })); // a jump: it lands at once
    expect(shown().slides).toBe(3);
    mount(props({ step: 0, reducedMotion: false }));
    mount(props({ step: 1, reducedMotion: false }));
    mount(props({ step: 2, reducedMotion: false })); // forward by one: playing
    advance(300);
    const slides = shown().slides;
    mount(props({ step: 2, reducedMotion: false, interactive: true }));
    advance(10000);
    expect(shown().slides).toBe(slides); // nothing more was done to the deck
    mount(props({ step: 0, reducedMotion: false, interactive: true }));
    expect(shown().slides).toBe(slides); // and the step is ignored
    expect(errors).not.toHaveBeenCalled();
  });

  it("is safe in StrictMode and leaves no timers after unmount", () => {
    const onReady = vi.fn();
    mount(props({ step: 0, reducedMotion: false, onReady }), true);
    mount(props({ step: 1, reducedMotion: false, onReady }), true);
    advance(100);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    advance(10000); // nothing runs after unmount
    expect(onReady.mock.calls.length).toBeLessThanOrEqual(2);
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    root = createRoot(host); // for afterEach
  });
});

describe("the Decks script and director (no React)", () => {
  const texts = (s: DeckSession) => s.deck.slides.map((sl) => sl.elements.map((e) => (e.type === "shape" && e.text ? plainText(e.text.paragraphs) : e.type)).join("|"));

  it("has snapshots that grow from one slide to three, with animations only in the last", () => {
    expect(DECK_STEPS).toBe(3);
    const [a, b, c] = [0, 1, 2].map(snapshotOf);
    expect([a!.slides.length, b!.slides.length, c!.slides.length]).toEqual([1, 2, 3]);
    expect(b!.masters[0]!.theme.name).toBe("Midnight");
    expect(a!.masters[0]!.theme.name).not.toBe("Midnight");
    expect(c!.slides.map((s) => s.animations?.length ?? 0)).toEqual([0, 0, 5]);
    const kinds = new Set(c!.slides[2]!.elements.map((e) => e.type));
    expect(kinds).toEqual(new Set(["shape", "table", "chart"]));
    // copies: loading one into a session must not change the next one
    expect(snapshotOf(2)).toEqual(c);
  });

  it("plays forward with the real commands and ends equal to the snapshot (ids aside)", () => {
    const session = new DeckSession(snapshotOf(0));
    const shownIds: string[] = [];
    const director = new DeckDirector(session, { show: (_s, id) => shownIds.push(id) }, 0);
    director.goTo(1, true);
    expect(director.settled).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(director.settled).toBe(1);
    director.goTo(2, true);
    vi.advanceTimersByTime(10000);
    expect(director.settled).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    const reference = new DeckSession(snapshotOf(2));
    expect(texts(session)).toEqual(texts(reference));
    expect(session.deck.slides.map((s) => s.animations?.map((a) => a.kind))).toEqual(reference.deck.slides.map((s) => s.animations?.map((a) => a.kind)));
    expect(session.deck.masters[0]!.theme.name).toBe("Midnight");
    expect(shownIds.at(-1)).toBe(session.deck.slides[2]!.id);
    // the story took real, undoable steps
    expect(session.canUndo).toBe(true);
  });

  it("cancels a playing step, and goes back by loading the snapshot", () => {
    const session = new DeckSession(snapshotOf(1));
    const director = new DeckDirector(session, { show: () => {} }, 1);
    director.goTo(2, true);
    vi.advanceTimersByTime(600);
    const partial = session.deck.slides.length;
    director.goTo(0, true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(session.deck.slides.length).toBe(1);
    expect(partial).toBe(3);
    expect(session.deck).toEqual(snapshotOf(0));
    expect(slideShownAt(session.deck, 0)).toBe(session.deck.slides[0]!.id);
    director.dispose();
    director.goTo(2, true);
    expect(session.deck.slides.length).toBe(1); // a disposed director does nothing
  });

  it("describes every action with a time, in order", () => {
    for (const step of [1, 2]) {
      const times = actionsFor(step).map((a) => a.at);
      expect(times).toEqual([...times].sort((x, y) => x - y));
      expect(times[0]).toBe(0);
    }
  });
});
