// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet, type ChipKind } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const pointer = (type: string, xy: { clientX: number; clientY: number }, extra: MouseEventInit = {}) =>
  act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy, ...extra })));
const click = (row: number, col: number, extra: MouseEventInit = {}) => (pointer("pointerdown", cellXY(row, col), extra), pointer("pointerup", cellXY(row, col), extra));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const cardEl = () => document.querySelector<HTMLElement>(".pli-chipcard");

const people: Record<string, string> = { u1: "Ann Lee", u2: "Bo Chan" };

function mount(options: { card?: ChipKind["card"] } = {}) {
  const chips: Record<string, ChipKind> = {
    person: {
      label: "Person",
      resolve: (id) => (people[id] ? { value: id, label: people[id]!, color: "#bfdbfe" } : undefined),
      search: () => [],
      card: options.card ?? ((item, { close }): ReactNode => (
        <div className="mine">
          <strong>{item.label}</strong>
          <button type="button" onClick={close}>Close</button>
        </div>
      )),
    },
    plain: { label: "Plain", resolve: (id) => ({ value: id, label: id }) },
  };
  const session = new SheetSession(createWorkbook("t"));
  session.setControl("Sheet1", "A1", { type: "badge", kind: "person" });
  session.setCell("Sheet1", "A1", "u1");
  session.setControl("Sheet1", "B1", { type: "badge", kind: "person" });
  session.setCell("Sheet1", "B1", "gone"); // an id the app doesn't know: plain text, no card
  session.setControl("Sheet1", "C1", { type: "badge", kind: "plain" });
  session.setCell("Sheet1", "C1", "x");
  session.setControl("Sheet1", "A2", { type: "badge", kind: "person", multiple: true });
  session.setCell("Sheet1", "A2", "u1, u2");
  session.setCell("Sheet1", "D1", "https://pli.dev");
  act(() => root.render(<PliSheet session={session} chips={chips} />));
  // jsdom has no layout: put each badge where its cell is, 6 pixels in and 18 wide.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const chip = this.dataset?.chip;
    if (chip !== undefined) {
      const cell = this.closest<HTMLElement>(".pli-cell")!;
      const index = [...cell.querySelectorAll("[data-chip]")].indexOf(this);
      const left = parseFloat(cell.style.left) + 48 + 6 + index * 22;
      const top = parseFloat(cell.style.top) + 24 + 2;
      return { left, top, right: left + 18, bottom: top + 17, width: 18, height: 17, x: left, y: top, toJSON() {} } as DOMRect;
    }
    return { left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
  return session;
}

describe("clicking a badge opens the app's own card", () => {
  it("draws only badges that have a card as clickable, and opens the card under the one clicked", () => {
    mount();
    expect(host.querySelectorAll("[data-chip]")).toHaveLength(3); // A1, and both people in A2; not the unknown id or the kind without a card
    const at = { clientX: 48 + 10, clientY: 24 + 10 };
    pointer("pointerdown", at);
    expect(cardEl()).toBeNull(); // opens when the pointer is let go
    pointer("pointerup", at);
    const card = cardEl()!;
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-label")).toBe("Ann Lee");
    expect(card.querySelector(".mine strong")?.textContent).toBe("Ann Lee");
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("A1"); // the click still selected the cell
    expect(card.contains(document.activeElement)).toBe(true); // focus moved into the card
  });

  it("opens the badge that was clicked when a cell holds several", () => {
    mount();
    const second = { clientX: 48 + 6 + 22 + 8, clientY: 24 + 20 + 10 };
    pointer("pointerdown", second);
    pointer("pointerup", second);
    expect(cardEl()!.getAttribute("aria-label")).toBe("Bo Chan");
  });

  it("a click beside the badge, on an unknown id, on a kind without a card, or with Ctrl, Cmd or Shift only selects", () => {
    mount();
    pointer("pointerdown", { clientX: 48 + 28, clientY: 24 + 10 }); // right of the badge, inside the cell
    pointer("pointerup", { clientX: 48 + 28, clientY: 24 + 10 });
    click(1, 2);
    click(1, 3);
    click(1, 1, { ctrlKey: true });
    click(1, 1, { metaKey: true });
    click(1, 1, { shiftKey: true });
    expect(cardEl()).toBeNull();
  });

  it("a drag that starts on a badge and ends elsewhere selects a range and opens nothing", () => {
    mount();
    pointer("pointerdown", { clientX: 48 + 10, clientY: 24 + 10 });
    pointer("pointermove", cellXY(3, 3));
    pointer("pointerup", cellXY(3, 3));
    expect(cardEl()).toBeNull();
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("A1:C3");
  });

  it("Escape closes it and gives the keyboard back to the grid; so does the card's own button, a click elsewhere, or moving the selection", () => {
    mount();
    const at = { clientX: 48 + 10, clientY: 24 + 10 };
    const open = () => (pointer("pointerdown", at), pointer("pointerup", at));
    open();
    act(() => void cardEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(cardEl()).toBeNull();
    expect(document.activeElement).toBe(sink());
    open();
    act(() => void cardEl()!.querySelector<HTMLButtonElement>("button")!.click());
    expect(cardEl()).toBeNull();
    open();
    act(() => void document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(cardEl()).toBeNull();
    open();
    key("ArrowRight"); // keys typed into the card's neighbours don't count, but the selection leaving the cell closes it
    expect(cardEl()).toBeNull();
  });

  it("clicking the same badge again closes the card instead of opening it twice", () => {
    mount();
    const at = { clientX: 48 + 10, clientY: 24 + 10 };
    pointer("pointerdown", at);
    pointer("pointerup", at);
    expect(cardEl()).not.toBeNull();
    pointer("pointerdown", at);
    pointer("pointerup", at);
    expect(cardEl()).toBeNull();
  });

  it("Space and Alt+Enter on the selected cell open the card, the active cell announces it, and Enter still moves down", () => {
    mount();
    click(1, 4); // a cell with no badge: Space does nothing special
    key(" ");
    expect(cardEl()).toBeNull();
    click(1, 1);
    // (that click opened the card at the pointer; close it first)
    act(() => void cardEl()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(sink().getAttribute("aria-label")).toContain("press Space for details");
    key(" ");
    expect(cardEl()?.getAttribute("aria-label")).toBe("Ann Lee");
    act(() => void cardEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    key("Enter", { altKey: true });
    expect(cardEl()).not.toBeNull();
    act(() => void cardEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    key("Enter");
    expect(cardEl()).toBeNull();
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("A2");
  });

  it("does not take over the picker: the arrow button, Alt+Down and F2 still open the list, which closes the card", async () => {
    mount();
    click(1, 1);
    expect(cardEl()).not.toBeNull();
    key("ArrowDown", { altKey: true });
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    expect(document.querySelector(".pli-grid-choicemenu")).not.toBeNull();
    expect(cardEl()).toBeNull();
  });

  it("a kind with no card keeps clicks going to the cell, as before", () => {
    mount();
    expect(q(".pli-pill-label")).toBeTruthy();
    click(1, 3);
    expect(cardEl()).toBeNull();
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("C1");
  });
});
