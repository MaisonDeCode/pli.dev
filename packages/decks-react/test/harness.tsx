import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach } from "vitest";
import { DeckSession, createDeck, paragraphsFromText, type Deck } from "@pli.dev/decks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export let host: HTMLElement;
let root: Root;

/** Installs the jsdom shims the editor needs and mounts into a fresh host for each test. */
export function useHost() {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });
}

export const render = (el: ReactElement) => act(() => root.render(el));
export const rerender = render;
export const unmount = () => act(() => root.unmount());

/** A deck of three slides: a title slide, a bulleted one and a two-column one with a shape. */
export function sampleDeck(): Deck {
  const s = new DeckSession(createDeck({ title: "Sample" }));
  const first = s.deck.slides[0]!;
  const title = first.elements[0]!;
  s.setText(first.id, title.id, paragraphsFromText("Hello world"));
  const second = s.addSlide();
  s.setText(second.id, second.elements[0]!.id, paragraphsFromText("Agenda"));
  s.setText(second.id, second.elements[1]!.id, paragraphsFromText("One\nTwo\nThree"));
  s.setNotes(second.id, "Remember the agenda", { merge: false });
  const third = s.addSlide({ layout: s.deck.masters[0]!.layouts.find((l) => l.kind === "titleOnly")!.id });
  s.addShape(third.id, "rect", { x: 100, y: 150, w: 120, h: 80 });
  s.addShape(third.id, "ellipse", { x: 400, y: 150, w: 100, h: 100 });
  return JSON.parse(JSON.stringify(s.deck));
}

export function newSession(deck: Deck = sampleDeck()): DeckSession {
  const s = new DeckSession(deck);
  return s;
}

export const q = <T extends Element = HTMLElement>(sel: string, within: ParentNode = host) => within.querySelector<T>(sel)!;
export const qa = <T extends Element = HTMLElement>(sel: string, within: ParentNode = host) => [...within.querySelectorAll<T>(sel)];
export const byLabel = (label: string, within: ParentNode = document) => within.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;

export const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("click: no element");
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

export function pointer(target: EventTarget, type: string, x = 0, y = 0, extra: MouseEventInit = {}) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...extra }));
  });
}

export function key(target: EventTarget, k: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

export function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

export const blur = (el: HTMLElement) => act(() => {
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur"));
});

/** Opens a toolbar dropdown or menu-bar menu by its label. */
export const openMenu = (label: string) => click(document.querySelector(`.pli-menubar-button`) && [...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === label));
export const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>("[role^='menuitem']")].find((b) => b.querySelector(".pli-menu-label")?.textContent === label)!;

/** Runs something that changes the session (so React redraws inside act). */
export const run = <T,>(fn: () => T): T => {
  let out!: T;
  act(() => {
    out = fn();
  });
  return out;
};

/** Like `run`, for work that finishes later (reading a file). */
export const runAsync = async <T,>(fn: () => Promise<T> | T): Promise<T> => {
  let out!: T;
  await act(async () => {
    out = await fn();
  });
  return out;
};
