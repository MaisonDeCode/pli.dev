// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DeckSession, createDeck, newId, type Layout, type ShapeElement } from "@pli.dev/decks";
import { PliDeck } from "../src";
import { q, qa, render, runAsync, useHost } from "./harness";

useHost();

/** A deck with one slide on a layout that has a title and a picture placeholder (idx 2). */
function pictureDeck() {
  const s = new DeckSession(createDeck());
  const pic: ShapeElement = { type: "shape", id: newId("e_"), geometry: "rect", placeholder: { type: "pic", idx: 2 }, x: 400, y: 100, w: 240, h: 180, text: { paragraphs: [{ runs: [] }] } };
  const layout: Layout = { id: newId("l_"), name: "Picture and title", kind: "custom", elements: [pic] };
  s.transact([{ type: "insert_layout", master: s.deck.masters[0]!.id, layout }]);
  const slide = s.addSlide({ layout: layout.id });
  return { s, slide, layout };
}

describe("picture placeholders", () => {
  it("show an icon and a prompt, not a text caret", () => {
    const { s } = pictureDeck();
    render(<PliDeck session={s} />);
    const prompt = q(".pli-deck-pic-prompt");
    expect(prompt.textContent).toContain("Click to add picture");
    expect(prompt.querySelector("svg")).toBeTruthy();
  });

  it("take a chosen picture, covering the frame and staying linked to the layout", async () => {
    const { s, slide } = pictureDeck();
    render(<PliDeck session={s} />);
    const ph = s.slide(slide.id).elements[0]!;
    s.selection = { slide: slide.id, elements: [ph.id] };
    const input = q<HTMLInputElement>('input[aria-label="Upload picture"]');
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1])], "photo.png", { type: "image/png" })], configurable: true });
    await runAsync(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    const els = s.slide(slide.id).elements;
    expect(els.length).toBe(1);
    expect(els[0]).toMatchObject({ type: "image", placeholder: { type: "pic", idx: 2 }, x: 400, y: 100, w: 240, h: 180 });
    expect(qa(".pli-deck-pic-prompt").length).toBe(0);
  });

  it("are not edited as text when typed into", () => {
    const { s, slide } = pictureDeck();
    render(<PliDeck session={s} />);
    expect(slide.elements[0]!.type).toBe("shape");
    expect(qa("[contenteditable='true']").length).toBe(0);
    void vi;
  });
});
