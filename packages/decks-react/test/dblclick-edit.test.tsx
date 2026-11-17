// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, builtinTheme, SIZE_GOOGLE } from "@pli.dev/decks";
import { PliDeck } from "../src";
import { byLabel, click, newSession, pointer, q, qa, render, run, useHost } from "./harness";

useHost();

const notice = () => document.querySelector(".pli-deck-notice")?.textContent ?? "";
const pickSlide = (i: number) => {
  pointer(qa(".pli-deck-film-item")[i]!, "pointerdown", 5, 5);
  pointer(window, "pointerup");
};
const editing = () => document.querySelector('[role="textbox"]');

describe("double-clicking an element starts editing its text", () => {
  it("on a slide", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    const title = s.scene(s.deck.slides[1]!.id).elements.find((e) => e.placeholder?.type === "title")!;
    pointer(q(".pli-deck-stage"), "dblclick", title.x + 10, title.y + 10);
    expect(notice()).toBe("");
    expect(editing()).toBeTruthy();
  });

  it("on a layout's placeholder in the master view", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Master"));
    expect(document.querySelector(".pli-deck-theme-banner")).toBeTruthy();
    const title = s.scene(s.deck.slides[1]!.layout).elements.find((e) => e.placeholder?.type === "title" && e.from === "layout")!;
    pointer(q(".pli-deck-stage"), "dblclick", title.x + 10, title.y + 10);
    expect(notice()).toBe("");
    expect(editing()).toBeTruthy();
  });

  it("on the master's own placeholder", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Master"));
    click(qa(".pli-deck-template-item").find((b) => b.textContent!.includes("(master)")));
    const title = s.scene(s.deck.masters[0]!.id).elements.find((e) => e.placeholder?.type === "title")!;
    pointer(q(".pli-deck-stage"), "dblclick", title.x + 10, title.y + 10);
    expect(notice()).toBe("");
    expect(editing()).toBeTruthy();
  });

  it("in the master view after the theme was changed under it (the master being edited is replaced)", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Master"));
    click(qa(".pli-deck-template-item").find((b) => b.textContent!.includes("(master)")));
    run(() => s.applyTheme(builtinTheme(BUILTIN_THEMES[1]!.id, SIZE_GOOGLE)));
    const title = s.scene(s.deck.masters[0]!.id).elements.find((e) => e.placeholder?.type === "title" && e.from === "master")!;
    pointer(q(".pli-deck-stage"), "dblclick", title.x + 10, title.y + 10);
    expect(notice()).toBe("");
    expect(editing()).toBeTruthy();
    // the list shows the new master as the one being edited
    expect(qa(".pli-deck-template-item[aria-current='true']").length).toBe(1);
  });

  it("in the master view after undoing a theme change", () => {
    const s = newSession();
    run(() => s.applyTheme(builtinTheme(BUILTIN_THEMES[1]!.id, SIZE_GOOGLE)));
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Master"));
    click(qa(".pli-deck-template-item").find((b) => b.textContent!.includes("(master)")));
    run(() => s.undo());
    const title = s.scene(s.deck.masters[0]!.id).elements.find((e) => e.placeholder?.type === "title" && e.from === "master")!;
    pointer(q(".pli-deck-stage"), "dblclick", title.x + 10, title.y + 10);
    expect(notice()).toBe("");
    expect(editing()).toBeTruthy();
  });

  it("says what happened, in plain words, if an object is no longer there", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    const title = s.scene(s.deck.slides[1]!.id).elements.find((e) => e.placeholder?.type === "title")!;
    // the object is removed between the click and the edit
    run(() => s.deleteElements(s.deck.slides[1]!.id, [title.id]));
    pointer(q(".pli-deck-stage"), "dblclick", title.x + 10, title.y + 10);
    expect(notice()).not.toMatch(/e_[a-z0-9]+/);
  });
});

describe("plain words for a failed lookup", async () => {
  const { plainError } = await import("../src/PliDeck");
  it("never shows an element id", () => {
    expect(plainError(new Error('No element "e_l5g0kkty3xwi"'))).not.toMatch(/e_l5g/);
    expect(plainError(new Error('No slide, layout or master "m_abc"'))).toMatch(/no longer there/);
    expect(plainError(new Error("Not a placeholder"))).toBe("Not a placeholder");
  });
});

describe("the slide fits its pane", () => {
  it("in the master view, where the panes beside it change size, as in the slide view", () => {
    let box = { w: 1000, h: 640 };
    const spec = (name: "clientWidth" | "clientHeight") =>
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return this.classList.contains("pli-deck-area") ? (name === "clientWidth" ? box.w : box.h) : 0; } });
    spec("clientWidth");
    spec("clientHeight");
    try {
      const s = newSession();
      render(<PliDeck session={s} />);
      const frame = () => parseFloat((q(".pli-deck-slide-frame") as HTMLElement).style.width);
      expect(frame()).toBeLessThanOrEqual(1000 - 48);
      expect(frame()).toBeGreaterThan(800);
      // the master view takes room from the pane; no resize event arrives, the next render must notice
      box = { w: 620, h: 560 };
      click(byLabel("Master"));
      expect(frame()).toBeLessThanOrEqual(620 - 48);
      box = { w: 380, h: 560 };
      click(qa(".pli-deck-template-item").find((b) => b.textContent!.includes("(master)")));
      expect(frame()).toBeLessThanOrEqual(380 - 48);
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
