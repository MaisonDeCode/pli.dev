// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, caret, createDoc, listItem, paragraph, title } from "@pli.dev/docs";
import { Ruler } from "../src/ui/Ruler";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function mount(session: DocumentSession, zoom = 1) {
  act(() => root.render(<Ruler session={session} target={session} zoom={zoom} />));
}

const handle = (name: string) => host.querySelector<HTMLElement>(`[data-handle="${name}"]`);
const left = (name: string) => parseFloat(handle(name)!.style.left);
const press = (el: HTMLElement, key: string, shiftKey = false) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
const format = (s: DocumentSession) => (s.state.blocks[0] as { format?: Record<string, number> }).format;

function paragraphSession(extra = {}) {
  const s = new DocumentSession(createDoc("T", [{ ...paragraph("hello"), ...extra }]));
  s.select(caret(s.state.blocks[0]!.id, 0));
  return s;
}

describe("Ruler", () => {
  it("draws the margins at the page edges of the text, in pixels at 100% zoom", () => {
    mount(paragraphSession());
    expect(left("margin-left")).toBe(96);
    expect(left("margin-right")).toBe(816 - 96);
  });

  it("scales with zoom", () => {
    mount(paragraphSession(), 0.5);
    expect(left("margin-left")).toBe(48);
  });

  it("puts the indent markers where the paragraph's indents are", () => {
    mount(paragraphSession({ format: { indentLeft: 72, indentFirst: -36, indentRight: 36 } }));
    expect(left("left-indent")).toBe(96 + 96);
    expect(left("first-line")).toBe(96 + 48);
    expect(left("right-indent")).toBe(816 - 96 - 48);
  });

  it("nudges a marker with the arrow keys, a sixteenth of an inch at a time and half an inch with Shift", () => {
    const s = paragraphSession();
    mount(s);
    press(handle("left-indent")!, "ArrowRight");
    expect(format(s)).toEqual({ indentLeft: 4.5 });
    press(handle("left-indent")!, "ArrowRight", true);
    expect(format(s)).toEqual({ indentLeft: 40.5 });
    press(handle("left-indent")!, "ArrowLeft", true);
    press(handle("left-indent")!, "ArrowLeft");
    expect(format(s)).toBeUndefined();
  });

  it("moves the first line on its own, and the whole paragraph with the left marker", () => {
    const s = paragraphSession({ format: { indentLeft: 36 } });
    mount(s);
    press(handle("first-line")!, "ArrowRight", true);
    expect(format(s)).toEqual({ indentLeft: 36, indentFirst: 36 });
    press(handle("left-indent")!, "ArrowRight", true);
    expect(format(s)).toEqual({ indentLeft: 72, indentFirst: 36 });
  });

  it("never lets the first line go past the left margin", () => {
    const s = paragraphSession();
    mount(s);
    press(handle("first-line")!, "ArrowLeft", true);
    expect(format(s)).toBeUndefined();
  });

  it("moves the right indent in from the right margin", () => {
    const s = paragraphSession();
    mount(s);
    press(handle("right-indent")!, "ArrowLeft", true);
    expect(format(s)).toEqual({ indentRight: 36 });
  });

  it("changes the page margins with the margin handles, in one undo each", () => {
    const s = paragraphSession();
    mount(s);
    press(handle("margin-left")!, "ArrowRight", true);
    expect(s.state.page?.margins.left).toBe(1.5);
    press(handle("margin-right")!, "ArrowLeft", true);
    expect(s.state.page?.margins.right).toBe(1.5);
    act(() => void s.undo());
    expect(s.state.page?.margins.right).toBe(1);
    expect(s.state.page?.margins.left).toBe(1.5);
  });

  it("keeps the text area at least two inches wide", () => {
    const s = paragraphSession();
    mount(s);
    for (let i = 0; i < 40; i++) press(handle("margin-left")!, "ArrowRight", true);
    expect(s.state.page!.margins.left).toBeLessThanOrEqual(5);
    expect(8.5 - s.state.page!.margins.left - 1).toBeGreaterThanOrEqual(2);
  });

  it("shows no indent markers for a list item, the title or a cell, but still the margins", () => {
    const list = new DocumentSession(createDoc("T", [listItem("bullet", "a")]));
    list.select(caret(list.state.blocks[0]!.id, 0));
    mount(list);
    expect(handle("first-line")).toBeNull();
    expect(handle("margin-left")).not.toBeNull();

    const head = new DocumentSession(createDoc("T", [title("t")]));
    head.select(caret(head.state.blocks[0]!.id, 0));
    mount(head);
    expect(handle("left-indent")).toBeNull();
  });

  it("describes each marker to assistive technology", () => {
    mount(paragraphSession({ format: { indentLeft: 36 } }));
    const el = handle("left-indent")!;
    expect(el.getAttribute("role")).toBe("slider");
    expect(el.getAttribute("aria-label")).toBe("Left indent");
    expect(el.getAttribute("aria-valuetext")).toBe("0.50 inches");
  });
});
