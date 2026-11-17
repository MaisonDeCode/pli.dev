// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PliDeck } from "../src";
import { FILMSTRIP_THUMB_WIDTH } from "../src";
import { byLabel, click, host, key, menuItem, newSession, pointer, q, qa, render, run, useHost } from "./harness";

useHost();

const items = () => qa(".pli-deck-film-item");
const ids = (s: ReturnType<typeof newSession>) => s.deck.slides.map((x) => x.id);
const itemH = (s: ReturnType<typeof newSession>) => (s.deck.size.height * FILMSTRIP_THUMB_WIDTH) / s.deck.size.width + 16;

describe("filmstrip", () => {
  it("is a listbox of slides with numbers, thumbnails and the current slide marked", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const list = q("[role=listbox]");
    expect(list.getAttribute("aria-label")).toBe("Slides");
    expect(items().length).toBe(3);
    expect(items().map((i) => i.querySelector(".pli-deck-film-number")!.textContent)).toEqual(["1", "2", "3"]);
    expect(items()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(items()[0]!.getAttribute("aria-current")).toBe("true");
    expect(items()[1]!.querySelector(".pli-deck-film-thumb")!.textContent).toContain("Agenda");
    // thumbnails never show placeholder prompts
    expect(items()[0]!.textContent).not.toContain("Click to add");
  });

  it("selects with click, shift-click and ctrl-click", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pointer(items()[1]!, "pointerdown", 5, 5);
    pointer(window, "pointerup");
    expect(s.selection.slide).toBe(ids(s)[1]);
    pointer(items()[2]!, "pointerdown", 5, 5, { shiftKey: true });
    pointer(window, "pointerup");
    expect(s.selection.slides).toEqual([ids(s)[1], ids(s)[2]]);
    pointer(items()[0]!, "pointerdown", 5, 5, { ctrlKey: true });
    pointer(window, "pointerup");
    expect(s.selection.slides).toHaveLength(3);
    expect(items().every((i) => i.getAttribute("aria-selected") === "true")).toBe(true);
    expect(items().filter((i) => i.hasAttribute("data-current")).length).toBe(1);
  });

  it("moves with the arrow keys, adds with Enter and deletes with Delete", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const list = q("[role=listbox]");
    key(list, "ArrowDown");
    expect(s.selection.slide).toBe(ids(s)[1]);
    key(list, "ArrowDown", { shiftKey: true });
    expect(s.selection.slides).toEqual([ids(s)[1], ids(s)[2]]);
    key(list, "ArrowUp");
    key(list, "Home");
    expect(s.selection.slide).toBe(ids(s)[0]);
    key(list, "Enter");
    expect(s.deck.slides.length).toBe(4);
    expect(s.selection.slide).toBe(ids(s)[1]);
    key(list, "Delete");
    expect(s.deck.slides.length).toBe(3);
    run(() => s.undo());
    expect(s.deck.slides.length).toBe(4);
  });

  it("duplicates with Cmd+D and copies and pastes slides", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const list = q("[role=listbox]");
    key(list, "d", { metaKey: true });
    expect(s.deck.slides.length).toBe(4);
    expect(s.deck.slides[1]!.elements[0]!.id).not.toBe(s.deck.slides[0]!.elements[0]!.id);
    key(list, "c", { metaKey: true });
    key(list, "v", { metaKey: true });
    expect(s.deck.slides.length).toBe(5);
    expect(new Set(s.deck.slides.flatMap((x) => x.elements.map((e) => e.id))).size).toBe(s.deck.slides.reduce((n, x) => n + x.elements.length, 0));
  });

  it("reorders by dragging with a drop indicator", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const [a, b, c] = ids(s);
    const h = itemH(s);
    pointer(items()[0]!, "pointerdown", 10, 10);
    pointer(window, "pointermove", 10, h * 2 + 3);
    const drop = q(".pli-deck-film-drop");
    expect(drop.getAttribute("data-drop-index")).toBe("2");
    pointer(window, "pointerup", 10, h * 2 + 3);
    expect(ids(s)).toEqual([b, a, c]);
    expect(host.querySelector(".pli-deck-film-drop")).toBeNull();
    // dragging to the end
    pointer(items()[0]!, "pointerdown", 10, 10);
    pointer(window, "pointermove", 10, h * 3);
    pointer(window, "pointerup", 10, h * 3);
    expect(ids(s)).toEqual([a, c, b]);
    run(() => s.undo());
    expect(ids(s)).toEqual([b, a, c]);
  });

  it("does not reorder on a plain click", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const before = ids(s);
    pointer(items()[1]!, "pointerdown", 10, 10);
    pointer(window, "pointermove", 10, 12);
    pointer(window, "pointerup", 10, 12);
    expect(ids(s)).toEqual(before);
  });

  it("opens a context menu with the slide actions", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    act_context(items()[1]!);
    const labels = [...document.querySelectorAll(".pli-deck-contextmenu .pli-menu-label")].map((e) => e.textContent);
    for (const l of ["New slide", "Duplicate slide", "Delete slide", "Skip slide", "Cut", "Copy", "Paste", "Move slide", "Change background…", "Change layout"]) expect(labels).toContain(l);
    click(menuItem("Skip slide"));
    expect(s.deck.slides[1]!.skipped).toBe(true);
    expect(items()[1]!.hasAttribute("data-skipped")).toBe(true);
  });

  it("moves slides up, down, to the top and bottom from the Slide menu", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const [a, b, c] = ids(s);
    const move = (label: string) => {
      click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((x) => x.textContent === "Slide"));
      click(menuItem("Move slide"));
      click(menuItem(label));
    };
    move("Move slide down");
    expect(ids(s)).toEqual([b, a, c]);
    move("Move slide to end");
    expect(ids(s)).toEqual([b, c, a]);
    move("Move slide up");
    expect(ids(s)).toEqual([b, a, c]);
    move("Move slide to beginning");
    expect(ids(s)).toEqual([a, b, c]);
  });

  it("adds a slide from the toolbar's new slide button and picks a layout from its menu", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("New slide"));
    expect(s.deck.slides.length).toBe(4);
    click(byLabel("New slide with layout"));
    const blank = [...document.querySelectorAll<HTMLElement>(".pli-deck-layout-button")].find((b) => b.title === "Blank")!;
    click(blank);
    expect(s.deck.slides.length).toBe(5);
    expect(s.layout(s.deck.slides[s.deck.slides.indexOf(s.slide(s.selection.slide!)!)]!.layout).layout.name).toBe("Blank");
  });
});

function act_context(el: Element) {
  pointer(el, "contextmenu", 20, 20);
}
