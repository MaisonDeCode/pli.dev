// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseDeck, serializeDeck } from "@pli.dev/decks";
import { DecksDemo, sampleDeck } from "../src/decks/DecksDemo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the slides demo", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("has a sample deck that is valid, with the slides the demo promises", () => {
    const deck = sampleDeck();
    expect(() => parseDeck(serializeDeck(deck))).not.toThrow();
    expect(deck.slides.length).toBe(4);
    expect(deck.slides.filter((s) => s.notes).length).toBeGreaterThanOrEqual(2);
    expect(deck.slides.some((s) => s.elements.some((e) => e.type === "table"))).toBe(true);
    expect(deck.slides.some((s) => s.transition)).toBe(true);
    expect(deck.slides.filter((s) => s.animations?.length).length).toBeGreaterThanOrEqual(3);
  });

  it("opens the editor on the sample, with nothing to undo, and can switch to a built-in theme", () => {
    act(() => root.render(<DecksDemo />));
    expect(host.querySelectorAll(".pli-deck-film-item").length).toBe(4);
    expect((host.querySelector('[aria-label="Undo"]') as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector(".pli-deck-canvas-slide")!.textContent).toContain("Quarterly review");
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Try a theme"]')!;
    const choice = [...select.options].find((o) => o.value)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, choice.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((host.querySelector('[aria-label="Undo"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
