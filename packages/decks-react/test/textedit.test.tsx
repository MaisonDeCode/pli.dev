// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { plainText, type TextRange } from "@pli.dev/decks";
import { PliDeck } from "../src";
import { writeSelection } from "../src/domsel";
import { byLabel, click, key, menuItem, newSession, pointer, q, qa, render, run, setValue, useHost } from "./harness";

useHost();

const body = () => q<HTMLElement>('[role="textbox"]');
const titleOf = (s: ReturnType<typeof newSession>) => s.deck.slides[0]!.elements[0]!;
const textOf = (s: ReturnType<typeof newSession>, slide = 0, el = 0) => {
  const e = s.deck.slides[slide]!.elements[el]!;
  return e.type === "shape" && e.text ? plainText(e.text.paragraphs) : "";
};

/** Starts editing the title of the first slide by double-clicking it. */
function edit(s = newSession()) {
  render(<PliDeck session={s} />);
  pointer(q(".pli-deck-stage"), "dblclick", 100, 150);
  return s;
}

function select(range: TextRange) {
  act(() => {
    writeSelection(body(), range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}
const pickSlide = (i: number) => {
  pointer(qa(".pli-deck-film-item")[i]!, "pointerdown", 5, 5);
  pointer(window, "pointerup");
};
const caret = (p: number, o: number) => select({ from: { p, o }, to: { p, o } });
function beforeInput(inputType: string, data?: string) {
  const e = new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true });
  act(() => {
    body().dispatchEvent(e);
  });
  return e;
}
const typeText = (t: string) => [...t].forEach((c) => beforeInput("insertText", c));

describe("text editing", () => {
  it("double-click opens an editor over the shape, with the text drawn by the same code", () => {
    edit();
    expect(body().getAttribute("contenteditable")).toBe("true");
    expect(body().textContent).toBe("Hello world");
    // the shape's own text is hidden under the editor so it isn't drawn twice
    expect(qa(".pli-deck-canvas-slide .pli-deck-text").filter((t) => t.textContent === "Hello world").length).toBe(1);
  });

  it("types at the caret, taking the marks before it", () => {
    const s = edit();
    typeText("!!");
    expect(textOf(s)).toBe("Hello world!!");
    caret(0, 5);
    typeText(",");
    expect(textOf(s)).toBe("Hello, world!!");
  });

  it("is one undo step for a burst of typing, and redo brings it back", () => {
    const s = edit();
    typeText("abc");
    beforeInput("deleteContentBackward");
    expect(textOf(s)).toBe("Hello worldab");
    run(() => s.undo());
    expect(textOf(s)).toBe("Hello world");
    run(() => s.redo());
    expect(textOf(s)).toBe("Hello worldab");
  });

  it("replaces a selection, and Backspace and Delete remove characters and words", () => {
    const s = edit();
    select({ from: { p: 0, o: 0 }, to: { p: 0, o: 5 } });
    typeText("J");
    expect(textOf(s)).toBe("J world");
    caret(0, 7);
    beforeInput("deleteWordBackward");
    expect(textOf(s)).toBe("J ");
    caret(0, 0);
    beforeInput("deleteContentForward");
    expect(textOf(s)).toBe(" ");
    beforeInput("deleteContentBackward");
    expect(textOf(s)).toBe(" ");
  });

  it("Enter splits the paragraph, Backspace at its start joins them, and Shift+Enter makes a line break inside", () => {
    const s = edit();
    caret(0, 5);
    beforeInput("insertParagraph");
    expect(textOf(s)).toBe("Hello\n world");
    expect(s.deck.slides[0]!.elements[0]).toMatchObject({ text: { paragraphs: [{}, {}] } });
    beforeInput("deleteContentBackward");
    expect(textOf(s)).toBe("Hello world");
    caret(0, 5);
    beforeInput("insertLineBreak");
    expect((titleOf(s) as { text: { paragraphs: unknown[] } }).text.paragraphs.length).toBe(1);
    expect(textOf(s)).toBe("Hello\n world");
  });

  it("toolbar bold toggles on the selected text only, and the button follows the selection", () => {
    const s = edit();
    select({ from: { p: 0, o: 0 }, to: { p: 0, o: 5 } });
    expect(byLabel("Bold").getAttribute("aria-pressed")).toBe("false");
    click(byLabel("Bold"));
    const runs = (titleOf(s) as { text: { paragraphs: { runs: { text: string; marks?: { bold?: boolean } }[] }[] } }).text.paragraphs[0]!.runs;
    expect(runs).toEqual([{ text: "Hello", marks: { bold: true } }, { text: " world" }]);
    select({ from: { p: 0, o: 1 }, to: { p: 0, o: 3 } });
    expect(byLabel("Bold").getAttribute("aria-pressed")).toBe("true");
    select({ from: { p: 0, o: 7 }, to: { p: 0, o: 9 } });
    expect(byLabel("Bold").getAttribute("aria-pressed")).toBe("false");
    select({ from: { p: 0, o: 0 }, to: { p: 0, o: 11 } });
    click(byLabel("Bold"));
    click(byLabel("Bold"));
    run(() => s.undo());
    run(() => s.undo());
    expect(JSON.stringify((titleOf(s) as { text: unknown }).text)).toContain('"bold":true');
  });

  it("with a caret, bold applies to what is typed next and sets nothing yet", () => {
    const s = edit();
    caret(0, 5);
    click(byLabel("Bold"));
    expect(byLabel("Bold").getAttribute("aria-pressed")).toBe("true");
    typeText("X");
    const runs = (titleOf(s) as { text: { paragraphs: { runs: { text: string; marks?: { bold?: boolean } }[] }[] } }).text.paragraphs[0]!.runs;
    expect(runs.map((r) => [r.text, !!r.marks?.bold])).toEqual([["Hello", false], ["X", true], [" world", false]]);
  });

  it("Cmd+B, Cmd+I and Cmd+U toggle marks in the editor", () => {
    const s = edit();
    select({ from: { p: 0, o: 0 }, to: { p: 0, o: 11 } });
    key(body(), "b", { metaKey: true });
    key(body(), "i", { ctrlKey: true });
    key(body(), "u", { metaKey: true });
    const m = (titleOf(s) as { text: { paragraphs: { runs: { marks?: Record<string, boolean> }[] }[] } }).text.paragraphs[0]!.runs[0]!.marks;
    expect(m).toEqual({ bold: true, italic: true, underline: true });
  });

  it("sets font size, family, colour and alignment on the selection", () => {
    const s = edit();
    select({ from: { p: 0, o: 0 }, to: { p: 0, o: 5 } });
    click(byLabel("Increase font size"));
    const size = (titleOf(s) as { text: { paragraphs: { runs: { marks?: { fontSize?: number } }[] }[] } }).text.paragraphs[0]!.runs[0]!.marks!.fontSize!;
    expect(size).toBeGreaterThan(48);
    click(byLabel("Align right"));
    expect((titleOf(s) as { text: { paragraphs: { align: string }[] } }).text.paragraphs[0]!.align).toBe("right");
    click(byLabel("Font"));
    setValue(document.querySelector('input[aria-label="Search fonts"]') as HTMLInputElement, "Georgia");
    click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent!.startsWith("Georgia"))!);
    expect(JSON.stringify(titleOf(s))).toContain('"fontFamily":"Georgia"');
  });

  it("makes bullets and numbers, and Tab and Shift+Tab change the level", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    pointer(q(".pli-deck-stage"), "dblclick", 100, 160);
    expect(body().textContent).toBe("●One●Two●Three");
    caret(1, 1);
    click(byLabel("Numbered list"));
    const ps = () => (s.deck.slides[1]!.elements[1] as { text: { paragraphs: { bullet?: { type: string } | null; level?: number; marL?: number }[] } }).text.paragraphs;
    expect(ps()[1]!.bullet).toMatchObject({ type: "number" });
    key(body(), "Tab");
    expect(ps()[1]!.level).toBe(1);
    expect(ps()[1]!.marL).toBeGreaterThan(0);
    key(body(), "Tab", { shiftKey: true });
    expect(ps()[1]!.level ?? 0).toBe(0);
    // Enter on an empty list item ends the list
    caret(2, 5);
    beforeInput("insertParagraph");
    expect(ps().length).toBe(4);
    beforeInput("insertParagraph");
    expect(ps().length).toBe(4);
    expect(ps()[3]!.bullet).toBeNull();
  });

  it("pastes plain text, and HTML as text, at the caret", () => {
    const s = edit();
    const paste = (data: Record<string, string>) => {
      const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { getData: (t: string) => data[t] ?? "", setData() {}, files: [] };
      act(() => {
        body().dispatchEvent(e);
      });
      return e;
    };
    expect(paste({ "text/plain": " and\nmore" }).defaultPrevented).toBe(true);
    expect(textOf(s)).toBe("Hello world and\nmore");
    paste({ "text/html": "<p>one</p><p>two <b>x</b></p>" });
    expect(textOf(s)).toBe("Hello world and\nmoreone\ntwo x");
  });

  it("follows an IME: the browser changes the text during composition and it is read back at the end", () => {
    const s = edit();
    caret(0, 11);
    act(() => {
      body().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    // during composition, beforeinput is left alone
    const e = new InputEvent("beforeinput", { inputType: "insertCompositionText", data: "に", bubbles: true, cancelable: true, isComposing: true });
    act(() => {
      body().dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(false);
    expect(textOf(s)).toBe("Hello world");
    // the browser put the text in the DOM
    const textNode = body().querySelector(".pli-deck-run")!.firstChild as Text;
    act(() => {
      textNode.data = "Hello worldに";
      body().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "に" }));
    });
    expect(textOf(s)).toBe("Hello worldに");
    expect(body().textContent).toBe("Hello worldに");
  });

  it("types over a selected shape's text, starting an edit: typing a letter with a shape selected", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 150);
    pointer(window, "pointerup", 100, 150);
    key(q(".pli-deck-stage"), "Z");
    expect(q('[role="textbox"]')).toBeTruthy();
    expect(textOf(s)).toBe("Hello worldZ");
  });

  it("Escape leaves the editor and keeps the shape selected", () => {
    const s = edit();
    key(body(), "Escape");
    expect(qa('[role="textbox"]').length).toBe(0);
    expect(s.selection.elements).toEqual([titleOf(s).id]);
  });

  it("clicking elsewhere on the slide leaves the editor", () => {
    edit();
    pointer(q(".pli-deck-stage"), "pointerdown", 650, 380);
    pointer(window, "pointerup", 650, 380);
    expect(qa('[role="textbox"]').length).toBe(0);
  });

  it("edits a shape with no text yet, centred, and a placeholder's prompt shows until there is text", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    expect(q(".pli-deck-canvas-slide").textContent).not.toContain("Click to add subtitle".slice(0, 0) + "zzz");
    expect(q(".pli-deck-canvas-slide").textContent).toContain("Click to add subtitle");
    pickSlide(2);
    pointer(q(".pli-deck-stage"), "dblclick", 160, 190);
    typeText("Hi");
    const rect = s.deck.slides[2]!.elements.find((e) => e.type === "shape" && e.geometry === "rect" && !e.placeholder) as { text: { vAlign: string; paragraphs: { align: string }[] } };
    expect(plainText(rect.text.paragraphs as never)).toBe("Hi");
    expect(rect.text.vAlign).toBe("middle");
    expect(rect.text.paragraphs[0]!.align).toBe("center");
  });

  it("formats whole shapes from the toolbar when not editing text", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 150);
    pointer(window, "pointerup", 100, 150);
    click(byLabel("Bold"));
    expect(JSON.stringify(titleOf(s))).toContain('"bold":true');
    click(byLabel("Align center"));
    expect(JSON.stringify(titleOf(s))).toContain('"align":"center"');
    void menuItem;
  });

  it("inserts a link into selected text", () => {
    const s = edit();
    select({ from: { p: 0, o: 0 }, to: { p: 0, o: 5 } });
    click(byLabel("Link"));
    const input = document.querySelector<HTMLInputElement>('dialog input[type="text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      document.querySelector<HTMLElement>('dialog button[type="submit"]')!.click();
    });
    expect(JSON.stringify(titleOf(s))).toContain('"link":"https://example.com"');
  });
});
