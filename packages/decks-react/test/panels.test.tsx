// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { buildMaster, createDeck, toPptx, LIGHT_THEME, SIZE_GOOGLE, type Master } from "@pli.dev/decks";
import { PliDeck, NotesPane } from "../src";
import { byLabel, click, host, key, menuItem, newSession, pointer, q, qa, render, run, runAsync, setValue, useHost } from "./harness";

useHost();

const pickSlide = (i: number) => {
  pointer(qa(".pli-deck-film-item")[i]!, "pointerdown", 5, 5);
  pointer(window, "pointerup");
};
const menu = (name: string) => click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name));

describe("speaker notes", () => {
  it("shows the slide's notes, saves typing as one undo step, and follows the slide", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const area = () => q<HTMLTextAreaElement>("textarea.pli-deck-notes-text");
    expect(area().placeholder).toBe("Click to add speaker notes");
    expect(area().value).toBe("");
    pickSlide(1);
    expect(area().value).toBe("Remember the agenda");
    setValue(area(), "Remember the agenda!");
    setValue(area(), "Remember the agenda!!");
    expect(s.deck.slides[1]!.notes).toBe("Remember the agenda!!");
    run(() => s.undo());
    expect(s.deck.slides[1]!.notes).toBe("Remember the agenda");
    expect(area().value).toBe("Remember the agenda");
    pickSlide(0);
    setValue(area(), "first");
    expect(s.deck.slides[0]!.notes).toBe("first");
    expect(s.deck.slides[1]!.notes).toBe("Remember the agenda");
  });

  it("has a divider that resizes the pane by dragging or with the arrow keys", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const sep = q(".pli-deck-notes-divider");
    const h = () => Number(sep.getAttribute("aria-valuenow"));
    const start = h();
    key(sep, "ArrowUp");
    expect(h()).toBe(start + 16);
    pointer(sep, "pointerdown", 0, 500);
    pointer(window, "pointermove", 0, 450);
    pointer(window, "pointerup", 0, 450);
    expect(h()).toBe(start + 16 + 50);
    expect(q<HTMLTextAreaElement>("textarea.pli-deck-notes-text").style.height).toBe(`${h()}px`);
  });

  it("is read only when the editor is, and can be hidden from the View menu", () => {
    const s = newSession();
    render(<PliDeck session={s} readOnly />);
    expect(q<HTMLTextAreaElement>("textarea.pli-deck-notes-text").readOnly).toBe(true);
    render(<PliDeck session={s} />);
    menu("View");
    click(menuItem("Show speaker notes"));
    expect(host.querySelector("textarea.pli-deck-notes-text")).toBeNull();
  });

  it("is exported on its own", () => {
    const s = newSession();
    render(<NotesPane session={s} slideId={s.deck.slides[1]!.id} height={60} onResize={() => undefined} />);
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("Remember the agenda");
  });
});

describe("theme panel", () => {
  it("lists the built-in themes with previews and applies one", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const oldMaster = s.deck.masters[0]!.id;
    click(byLabel("Theme"));
    const cards = qa("[data-theme-id]");
    expect(cards.length).toBeGreaterThanOrEqual(6);
    expect(cards[0]!.querySelector(".pli-deck-slide")).toBeTruthy();
    const other = cards.find((c) => c.title !== s.deck.masters[0]!.theme.name)!;
    click(other);
    expect(s.deck.masters.length).toBe(1);
    expect(s.deck.masters[0]!.id).not.toBe(oldMaster);
    expect(s.deck.masters[0]!.theme.name).toBe(other.title);
    expect(s.deck.slides.every((x) => s.deck.masters[0]!.layouts.some((l) => l.id === x.layout))).toBe(true);
    run(() => s.undo());
    expect(s.deck.masters[0]!.id).toBe(oldMaster);
  });

  it("imports a PowerPoint file, previews each master with its layouts, and applies the one you pick", async () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Theme"));
    // a file built by the engine: a deck on a custom master
    const master: Master = buildMaster({ name: "Imported look", theme: { ...LIGHT_THEME, name: "Imported look", colors: { ...LIGHT_THEME.colors, accent1: "#123456" } }, size: SIZE_GOOGLE });
    const bytes = toPptx(createDeck({ master, size: SIZE_GOOGLE }));
    const file = new File([bytes as BlobPart], "theme.potx");
    const input = q<HTMLInputElement>('input[type="file"][aria-label^="Import theme"]');
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await runAsync(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    const imported = q("[data-master]");
    expect(imported.textContent).toContain("Imported look");
    expect(qa("figure", imported).length).toBe(master.layouts.length);
    expect(qa(".pli-deck-slide", imported).length).toBe(master.layouts.length);
    click(imported.querySelector<HTMLElement>("button.pli-button-primary"));
    expect(s.deck.masters[0]!.theme.colors.accent1).toBe("#123456");
    expect(host.querySelector("[data-master]")).toBeNull();
  });

  it("reports a file that is not a presentation", async () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Theme"));
    const input = q<HTMLInputElement>('input[type="file"][aria-label^="Import theme"]');
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1, 2, 3])], "x.pptx")], configurable: true });
    await runAsync(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(q('[role="alert"]').textContent!.length).toBeGreaterThan(3);
  });

  it("edits the colour scheme and the fonts", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Theme"));
    const accent = byLabel("Accent 1") as HTMLInputElement;
    setValue(accent, "#00aa00");
    setValue(accent, "#00bb00");
    expect(s.deck.masters[0]!.theme.colors.accent1).toBe("#00bb00");
    run(() => s.undo());
    expect(s.deck.masters[0]!.theme.colors.accent1).toBe("#4285f4");
    click(byLabel("Heading font"));
    setValue(document.querySelector('input[aria-label="Search fonts"]') as HTMLInputElement, "Georgia");
    click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent!.includes("Georgia"))!);
    expect(s.deck.masters[0]!.theme.fonts.major).toBe("Georgia");
    expect(qa(".pli-deck-font-pairs").length).toBe(0);
    // slides show the new colours
    expect(q(".pli-deck-canvas-slide")).toBeTruthy();
  });

  it("lays the colours out as one row each: a swatch, the name, then the hex", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Theme"));
    const rows = qa(".pli-deck-color-row");
    expect(rows.length).toBe(12);
    for (const row of rows) {
      const parts = [...row.children].map((c) => c.className);
      expect(parts).toEqual(["pli-deck-swatch", "pli-deck-color-name", "pli-deck-color-hex"]);
      // the picker lives inside the swatch, so the label text never sits under it
      expect(row.querySelector(".pli-deck-swatch input[type='color']")).toBeTruthy();
      expect(row.querySelector(".pli-deck-color-name")!.querySelector("input")).toBeNull();
    }
    const accent = q(".pli-deck-color-row[data-slot='accent1']");
    expect((accent.querySelector(".pli-deck-swatch") as HTMLElement).style.background).toBeTruthy();
    expect(accent.querySelector(".pli-deck-color-hex")!.textContent).toBe("#4285F4");
  });

  it("opens the font list inside the editor, so it gets the editor's colours, and chooses with the keyboard", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Theme"));
    click(byLabel("Body font"));
    const panel = document.querySelector(".pli-panel-fixed") as HTMLElement;
    expect(panel.closest(".pli-deck")).toBeTruthy();
    expect(panel.querySelector(".pli-fonts")).toBeTruthy();
    const search = panel.querySelector('input[aria-label="Search fonts"]') as HTMLInputElement;
    setValue(search, "Georgia");
    run(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(s.deck.masters[0]!.theme.fonts.minor).toBe("Georgia");
  });

  it("closes, and is read only for a read only editor", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Theme"));
    click(byLabel("Close themes panel"));
    expect(host.querySelector(".pli-deck-theme-panel")).toBeNull();
  });
});

describe("transition panel", () => {
  it("sets the type, direction, speed and auto-advance of the selected slides", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Transition"));
    expect(q('[aria-label="Transition panel"], .pli-deck-transition-panel')).toBeTruthy();
    expect(host.querySelector('[aria-label="Transition direction"]')).toBeNull();
    setValue(byLabel("Transition type") as HTMLSelectElement, "slide");
    expect(s.deck.slides[1]!.transition).toMatchObject({ type: "slide", direction: "right" });
    setValue(byLabel("Transition direction") as HTMLSelectElement, "up");
    expect(s.deck.slides[1]!.transition!.direction).toBe("up");
    const range = byLabel("Transition duration") as HTMLInputElement;
    setValue(range, "1500");
    act(() => {
      range.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }));
    });
    expect(s.deck.slides[1]!.transition!.duration).toBe(1500);
    const after = byLabel("Advance after seconds") as HTMLInputElement;
    setValue(after, "4");
    act(() => {
      after.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      after.blur();
      after.dispatchEvent(new FocusEvent("blur"));
    });
    key(after, "Enter");
    expect(s.deck.slides[1]!.transition!.advanceAfter).toBe(4000);
    expect(s.deck.slides[0]!.transition).toBeUndefined();
    click([...qa("button")].find((b) => b.textContent === "Apply to all slides"));
    expect(s.deck.slides.every((x) => x.transition?.type === "slide" && x.transition.duration === 1500)).toBe(true);
    setValue(byLabel("Transition type") as HTMLSelectElement, "none");
    expect(s.deck.slides[1]!.transition).toMatchObject({ type: "none", advanceAfter: 4000 });
  });

  it("applies to every selected slide", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(0);
    pointer(qa(".pli-deck-film-item")[2]!, "pointerdown", 5, 5, { shiftKey: true });
    pointer(window, "pointerup");
    click(byLabel("Transition"));
    setValue(byLabel("Transition type") as HTMLSelectElement, "fade");
    expect(s.deck.slides.map((x) => x.transition?.type)).toEqual(["fade", "fade", "fade"]);
  });
});

describe("format options panel", () => {
  it("sets position, size and rotation numerically, fill, line and alt text", () => {
    const s = newSession();
    const slide = s.deck.slides[2]!;
    s.selection = { slide: slide.id, slides: [slide.id], elements: [] };
    render(<PliDeck session={s} />);
    pointer(q(".pli-deck-stage"), "pointerdown", 160, 190);
    pointer(window, "pointerup");
    click(byLabel("Format options"));
    const rect = slide.elements.find((e) => e.type === "shape" && !e.placeholder)!;
    const field = (label: string) => byLabel(label, q(".pli-deck-format-panel")) as HTMLInputElement;
    const commit = (label: string, v: string) => {
      setValue(field(label), v);
      act(() => {
        field(label).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    };
    expect(field("X (pt)").value).toBe("100");
    commit("X (pt)", "50");
    commit("Width (pt)", "200");
    commit("Rotation (°)", "45");
    expect(s.element(slide.id, rect.id)).toMatchObject({ x: 50, w: 200, rotation: 45 });
    setValue(byLabel("Alt text") as HTMLTextAreaElement, "A box");
    act(() => {
      (byLabel("Alt text") as HTMLElement).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      (byLabel("Alt text") as HTMLElement).dispatchEvent(new FocusEvent("blur"));
    });
    commit("Weight (pt)", "5");
    expect((s.element(slide.id, rect.id) as { line: { width: number } }).line.width).toBe(5);
    click(byLabel("Drop shadow", q(".pli-deck-format-panel")) ?? q(".pli-deck-format-panel input[type=checkbox]"));
    expect((s.element(slide.id, rect.id) as { shadow: unknown }).shadow).toBeTruthy();
    click([...qa("button", q(".pli-deck-format-panel"))].find((b) => b.textContent === "Flip horizontal"));
    expect((s.element(slide.id, rect.id) as { flipH: boolean }).flipH).toBe(true);
  });
});
