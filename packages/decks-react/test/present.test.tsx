// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PliDeck, PresentMode, nextShown, prevShown } from "../src";
import { byLabel, click, host, key, menuItem, newSession, pointer, q, qa, render, run, useHost } from "./harness";

useHost();
afterEach(() => vi.useRealTimers());

const press = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const counter = () => q(".pli-deck-pcount").textContent;
const shown = () => q(".pli-deck-present-layer").textContent;

function mount(extra: { onExit?: () => void; start?: number; presenter?: boolean } = {}) {
  const s = newSession();
  const onExit = extra.onExit ?? vi.fn();
  render(<PresentMode session={s} start={extra.start} presenter={extra.presenter} onExit={onExit} fullscreen={false} />);
  return { s, onExit };
}

describe("present mode", () => {
  it("fills the viewport, shows the first slide without prompts, and is a dialog", () => {
    mount();
    const root = q(".pli-deck-present");
    expect(root.getAttribute("role")).toBe("dialog");
    expect(counter()).toBe("Slide 1 / 3");
    expect(shown()).toContain("Hello world");
    expect(shown()).not.toContain("Click to add");
  });

  it("moves with the arrows, space, Page Up/Down, Home and End", () => {
    mount();
    press("ArrowRight");
    expect(counter()).toBe("Slide 2 / 3");
    press(" ");
    expect(counter()).toBe("Slide 3 / 3");
    press("PageUp");
    expect(counter()).toBe("Slide 2 / 3");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(counter()).toBe("Slide 1 / 3");
    press("End");
    expect(counter()).toBe("Slide 3 / 3");
    press("Home");
    expect(counter()).toBe("Slide 1 / 3");
    press(" ", { shiftKey: true });
    expect(counter()).toBe("Slide 1 / 3");
    press("PageDown");
    expect(counter()).toBe("Slide 2 / 3");
  });

  it("jumps to a slide by typing its number and Enter", () => {
    mount();
    press("3");
    expect(q(".pli-deck-pcount").textContent).toContain("go to 3");
    press("Enter");
    expect(counter()).toBe("Slide 3 / 3");
    press("9");
    press("Enter");
    expect(counter()).toBe("Slide 3 / 3");
    press("1");
    press("Enter");
    expect(counter()).toBe("Slide 1 / 3");
  });

  it("goes to a black or white screen with B and W, and back with the same key or any move", () => {
    mount();
    press("b");
    expect(q(".pli-deck-present-blank").dataset.blank).toBe("black");
    press("b");
    expect(host.querySelector(".pli-deck-present-blank")).toBeNull();
    press("w");
    expect(q(".pli-deck-present-blank").dataset.blank).toBe("white");
    press("ArrowRight");
    expect(host.querySelector(".pli-deck-present-blank")).toBeNull();
    expect(counter()).toBe("Slide 1 / 3");
  });

  it("clicking advances, the end shows an exit card, and Escape leaves", () => {
    const { onExit } = mount();
    const stage = q(".pli-deck-present-stage");
    click(stage);
    click(stage);
    expect(counter()).toBe("Slide 3 / 3");
    click(stage);
    expect(q(".pli-deck-present-end").textContent).toContain("End of presentation");
    expect(onExit).not.toHaveBeenCalled();
    press("ArrowLeft");
    expect(host.querySelector(".pli-deck-present-end")).toBeNull();
    press("Escape");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("skips skipped slides, forwards and back, unless you start on one", () => {
    const s = newSession();
    run(() => s.setSkipped([s.deck.slides[1]!.id], true));
    expect(nextShown(s.deck.slides, 0)).toBe(2);
    expect(prevShown(s.deck.slides, 2)).toBe(0);
    render(<PresentMode session={s} onExit={() => undefined} fullscreen={false} />);
    press("ArrowRight");
    expect(counter()).toBe("Slide 3 / 3");
    press("ArrowLeft");
    expect(counter()).toBe("Slide 1 / 3");
    press("End");
    press("Home");
    expect(counter()).toBe("Slide 1 / 3");
    render(<PresentMode key="again" session={s} start={1} onExit={() => undefined} fullscreen={false} />);
    expect(counter()).toBe("Slide 2 / 3");
  });

  it("shows speaker notes in the floating panel and in the presenter view with the next slide and a timer", () => {
    const s = newSession();
    render(<PresentMode session={s} start={1} onExit={() => undefined} fullscreen={false} />);
    expect(host.querySelector(".pli-deck-present-notes")).toBeNull();
    click(byLabel("Speaker notes", q(".pli-deck-present-bar")));
    expect(q(".pli-deck-present-notes").textContent).toBe("Remember the agenda");
    press("s");
    expect(q(".pli-deck-presenter")).toBeTruthy();
    expect(q(".pli-deck-presenter-next").textContent).not.toContain("End of presentation");
    expect(q('[role="timer"]').textContent).toBe("0:00");
    expect(q(".pli-deck-presenter-current").textContent).toContain("Agenda");
    press("ArrowRight");
    expect(q(".pli-deck-presenter-next").textContent).toContain("End of presentation");
    expect(q(".pli-deck-present-notes").textContent).toContain("No speaker notes");
    click(byLabel("Larger notes text"));
    expect(q<HTMLElement>(".pli-deck-present-notes").style.fontSize).toBe("1.15em");
  });

  it("runs the presenter timer, which can pause and reset", () => {
    vi.useFakeTimers();
    mount({ presenter: true });
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(q('[role="timer"]').textContent).toBe("0:03");
    click(byLabel("Pause timer"));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(q('[role="timer"]').textContent).toBe("0:03");
    click(byLabel("Reset timer"));
    expect(q('[role="timer"]').textContent).toBe("0:00");
  });

  it("toggles the laser pointer, which follows the pointer", () => {
    mount();
    press("l");
    pointer(q(".pli-deck-present-stage"), "pointermove", 40, 50);
    const laser = q<HTMLElement>(".pli-deck-laser");
    expect(laser.style.left).toBe("40px");
    expect(byLabel("Laser pointer").getAttribute("aria-pressed")).toBe("true");
    press("l");
    expect(host.querySelector(".pli-deck-laser")).toBeNull();
  });

  it("plays a slide's transition as layers with the duration, then removes the old slide", () => {
    vi.useFakeTimers();
    const s = newSession();
    run(() => s.setTransition([s.deck.slides[1]!.id], { type: "push", direction: "left", duration: 400 }));
    render(<PresentMode session={s} onExit={() => undefined} fullscreen={false} />);
    press("ArrowRight");
    const layers = qa(".pli-deck-present-layer");
    expect(layers.map((l) => l.className.includes("out") ? "out" : "in")).toEqual(["out", "in"]);
    expect(layers[1]!.dataset.transition).toBe("push");
    expect(layers[1]!.dataset.direction).toBe("left");
    expect(layers[1]!.style.getPropertyValue("--pli-deck-dur")).toBe("400ms");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(qa(".pli-deck-present-layer").length).toBe(1);
    // going back has no animation
    press("ArrowLeft");
    expect(qa(".pli-deck-present-layer").length).toBe(1);
  });

  it("does not animate when the system asks for reduced motion", () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {}, media: q }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const s = newSession();
      run(() => s.setTransition([s.deck.slides[1]!.id], { type: "fade", duration: 400 }));
      render(<PresentMode session={s} onExit={() => undefined} fullscreen={false} />);
      press("ArrowRight");
      expect(qa(".pli-deck-present-layer").length).toBe(1);
    } finally {
      window.matchMedia = orig;
    }
  });

  it("advances by itself after the slide's time", () => {
    vi.useFakeTimers();
    const s = newSession();
    run(() => s.setTransition([s.deck.slides[0]!.id], { type: "none", advanceAfter: 2000 }));
    render(<PresentMode session={s} onExit={() => undefined} fullscreen={false} />);
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(counter()).toBe("Slide 1 / 3");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(counter()).toBe("Slide 2 / 3");
  });

  it("has buttons for previous, next, exit and (when the host can) a presenter window", () => {
    const open = vi.fn();
    const s = newSession();
    const onExit = vi.fn();
    render(<PresentMode session={s} onExit={onExit} onOpenPresenterWindow={open} fullscreen={false} />);
    click(byLabel("Next slide"));
    expect(counter()).toBe("Slide 2 / 3");
    click(byLabel("Previous slide"));
    expect(counter()).toBe("Slide 1 / 3");
    click(byLabel("Open presenter view in a new window"));
    expect(open).toHaveBeenCalled();
    click(byLabel("Exit slideshow"));
    expect(onExit).toHaveBeenCalled();
  });

  it("links on a slide are followable while presenting", () => {
    const s = newSession();
    run(() => s.addShape(s.deck.slides[0]!.id, "rect", {}, { link: "https://example.com" }));
    render(<PresentMode session={s} onExit={() => undefined} fullscreen={false} />);
    expect(q("a.pli-deck-link").getAttribute("href")).toBe("https://example.com");
  });
});

describe("starting a slideshow from the editor", () => {
  it("Cmd+Enter presents from the beginning and Cmd+Shift+Enter from the current slide", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pointer(qa(".pli-deck-film-item")[1]!, "pointerdown", 5, 5);
    pointer(window, "pointerup");
    key(q(".pli-deck-filmstrip"), "Enter", { metaKey: true, shiftKey: true });
    expect(counter()).toBe("Slide 2 / 3");
    press("Escape");
    expect(host.querySelector(".pli-deck-present")).toBeNull();
    key(q(".pli-deck-filmstrip"), "Enter", { metaKey: true });
    expect(counter()).toBe("Slide 1 / 3");
    press("Escape");
  });

  it("the View menu offers present from the beginning, from the current slide and the presenter view", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const view = () => click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === "View"));
    view();
    click(menuItem("Presenter view"));
    expect(q(".pli-deck-presenter")).toBeTruthy();
    press("Escape");
    view();
    click(menuItem("Present from beginning"));
    expect(counter()).toBe("Slide 1 / 3");
  });

  it("a read only editor can still present", () => {
    const s = newSession();
    render(<PliDeck session={s} readOnly />);
    click(byLabel("Present"));
    expect(counter()).toBe("Slide 1 / 3");
  });
});
