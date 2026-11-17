// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
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
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
/** Cells are 64 by 20 pixels, after a header of 48 by 24. */
const cellAt = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const setField = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const type = (text: string) => setField(sink(), text);
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const dialogButton = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
/** The note editor is a rich text box, not a text area: its text is set the way a browser would leave it. */
const writeNote = (text: string) => act(() => { const el = dialog().querySelector<HTMLElement>('[role="textbox"]')!; el.textContent = text; el.dispatchEvent(new Event("input", { bubbles: true })); });
const noteText = () => dialog().querySelector<HTMLElement>('[role="textbox"]')!.textContent;
const card = () => document.querySelector<HTMLElement>(".pli-cellcard");
const cardButton = (text: string) => [...card()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]));
  session.setValues("Sheet1", "A1", [["Pli", "x"], ["plain", null]]);
  session.setValues("Other", "C3", [["there"]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("links in the grid", () => {
  it("inserts a link from the Insert menu, draws it as one, and shows a card with its address", () => {
    const s = mount();
    expect(card()).toBeNull();
    choose("Insert", "Link…");
    expect(dialog().querySelector("input[type=text]")).toBeTruthy();
    const [text, address] = [...dialog().querySelectorAll<HTMLInputElement>("input[type=text]")];
    expect(text!.value).toBe("Pli");
    setField(address!, "pli.dev/sheets");
    act(() => void dialogButton("Insert").click());
    expect(s.link("Sheet1", "A1")?.to).toBe("https://pli.dev/sheets");
    const shown = q(".pli-cell-text");
    expect(shown.closest<HTMLElement>(".pli-cell")!.style.cssText + shown.parentElement!.outerHTML).toMatch(/0563c1|rgb\(5, 99, 193\)/i);
    expect(card()!.textContent).toContain("https://pli.dev/sheets");
    expect([...card()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Open", "Edit…", "Remove"]);
  });

  it("opens a web address in a new tab and a place in the workbook in its sheet", () => {
    const s = mount();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    s.setLink("Sheet1", "B1", { to: "#Other!C3" });
    click(1, 1);
    act(() => void cardButton("Open").click());
    expect(open).toHaveBeenCalledWith("https://pli.dev", "_blank", "noopener,noreferrer");
    click(1, 2);
    act(() => void cardButton("Open").click());
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("C3");
    expect(q("[role=tab][aria-selected=true]").textContent).toContain("Other");
  });

  it("follows a link on Alt+Enter, and removes it from the card", () => {
    const s = mount();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    click(1, 1);
    key("Enter", { altKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    act(() => void cardButton("Remove").click());
    expect(s.link("Sheet1", "A1")).toBeNull();
    expect(card()).toBeNull();
  });

  it("follows a link on Ctrl+click or Cmd+click, and adds other cells to the selection as before", () => {
    const s = mount();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    click(1, 1);
    expect(open).not.toHaveBeenCalled(); // a plain click only selects
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const at = cellAt(1, 1);
      act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...at, ...mod })));
      act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, ...at, ...mod })));
    }
    expect(open).toHaveBeenCalledTimes(2);
    // Ctrl+click on a cell that is not a link adds it to the selection, and follows nothing.
    click(3, 3);
    const at = cellAt(4, 3);
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...at, ctrlKey: true })));
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, ...at, ctrlKey: true })));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("draws a link in the theme's hyperlink colour, the followed colour once it was followed, and follows a theme change", () => {
    const s = mount();
    vi.spyOn(window, "open").mockImplementation(() => null);
    act(() => {
      s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
      s.setLink("Sheet1", "B1", { to: "https://pli.dev/b" });
    });
    const ink = (n: number) => {
      for (let e: HTMLElement | null = document.querySelectorAll<HTMLElement>(".pli-cell-text")[n]!; e && !e.classList.contains("pli-grid-scroller"); e = e.parentElement) if (e.style.color) return e.style.color;
      return "";
    };
    const colourOf = (hex: string) => { const e = document.createElement("i"); e.style.color = hex; return e.style.color; };
    expect(ink(0)).toBe(colourOf("#0563c1"));
    const at = cellAt(1, 1);
    const ctrl = { ctrlKey: true };
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, ...at, ...ctrl })));
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, ...at, ...ctrl })));
    expect(s.link("Sheet1", "A1")?.followed).toBe(true);
    expect(s.link("Sheet1", "B1")?.followed).toBeUndefined();
    expect(ink(0)).toBe(colourOf("#954f72"));
    expect(ink(1)).toBe(colourOf("#0563c1"));
    // The card's Open and Alt+Enter mark the link too.
    click(1, 2);
    act(() => void cardButton("Open").click());
    expect(s.link("Sheet1", "B1")?.followed).toBe(true);
    // The theme's own hyperlink colours recolour both.
    act(() => s.transact([{ type: "restore", workbook: { ...s.state, themeColors: ["#ffffff", "#000000", "#e7e6e6", "#44546a", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#008000", "#800080"] } }]));
    expect(ink(0)).toBe(colourOf("#800080"));
    // Followed on a protected sheet, or one that can't be opened, changes nothing.
    act(() => s.setLink("Sheet1", "A2", { to: "C:\\files\\a.txt" }));
    click(2, 1);
    key("Enter", { altKey: true });
    expect(s.link("Sheet1", "A2")?.followed).toBeUndefined();
  });

  it("turns a typed web address into a link, and edits and removes a link in the dialog", () => {
    const s = mount();
    click(2, 1);
    type("www.pli.dev");
    key("Enter");
    expect(s.link("Sheet1", "A2")?.to).toBe("https://www.pli.dev");
    click(2, 1);
    act(() => void cardButton("Edit…").click());
    const [, address, tip] = [...dialog().querySelectorAll<HTMLInputElement>("input[type=text]")];
    expect(address!.value).toBe("https://www.pli.dev");
    setField(tip!, "Home page");
    act(() => void dialogButton("Save").click());
    expect(s.link("Sheet1", "A2")).toEqual({ to: "https://www.pli.dev", tip: "Home page" });
    click(2, 1);
    act(() => void cardButton("Edit…").click());
    act(() => void dialogButton("Remove link").click());
    expect(s.link("Sheet1", "A2")).toBeNull();
    expect(s.value("Sheet1", "A2")).toBe("www.pli.dev");
  });

  it("links to a place in the workbook from the dialog, and refuses a bad reference", () => {
    const s = mount();
    choose("Insert", "Link…");
    setField(dialog().querySelector("select")!, "place");
    const selects = dialog().querySelectorAll("select");
    setField(selects[1] as HTMLSelectElement, s.sheet("Other").id);
    const cell = [...dialog().querySelectorAll<HTMLInputElement>("input[type=text]")].find((i) => i.value === "A1")!;
    setField(cell, "nonsense!");
    act(() => void dialogButton("Insert").click());
    expect(dialog().textContent).toContain("Type a cell such as B4");
    expect(s.link("Sheet1", "A1")).toBeNull();
    setField(cell, "c3");
    act(() => void dialogButton("Insert").click());
    expect(s.link("Sheet1", "A1")?.to).toBe("#Other!C3");
  });

  it("is on the right-click menu", () => {
    const s = mount();
    s.setLink("Sheet1", "A1", { to: "https://pli.dev" });
    click(1, 1);
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 40 })));
    const labels = [...document.querySelectorAll(".pli-menu-label")].map((e) => e.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Edit link…", "Remove link", "Insert note…"]));
  });
});

describe("notes in the grid", () => {
  it("adds a note from the Insert menu, marks the cell, and shows the note on the card", () => {
    const s = mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("Ask Ana\nabout this");
    act(() => void dialogButton("Save").click());
    expect(s.note("Sheet1", "A2")).toBe("Ask Ana\nabout this");
    expect(host.querySelectorAll(".pli-grid-note")).toHaveLength(1);
    expect(card()!.textContent).toContain("Ask Ana");
    expect([...card()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Edit note…", "Show note", "Delete note"]);
  });

  it("edits and deletes a note from its card", () => {
    const s = mount();
    s.setNote("Sheet1", "B2", "first");
    click(2, 2);
    act(() => void cardButton("Edit note…").click());
    expect(noteText()).toBe("first");
    writeNote("second");
    act(() => void dialogButton("Save").click());
    expect(s.note("Sheet1", "B2")).toBe("second");
    act(() => void cardButton("Delete note").click());
    expect(s.note("Sheet1", "B2")).toBeNull();
    expect(host.querySelectorAll(".pli-grid-note")).toHaveLength(0);
    expect(card()).toBeNull();
  });

  it("shows a note when the pointer rests on its cell, without buttons", () => {
    vi.useFakeTimers();
    try {
      const s = mount();
      s.setNote("Sheet1", "B2", "hovered");
      click(1, 1);
      expect(card()).toBeNull();
      pointer("pointermove", cellAt(2, 2));
      expect(card()).toBeNull();
      act(() => void vi.advanceTimersByTime(500));
      expect(card()!.textContent).toBe("hovered");
      expect(card()!.querySelectorAll("button")).toHaveLength(0);
      pointer("pointermove", cellAt(3, 3));
      // It waits a moment, in case the pointer is on its way to the card, and then goes.
      expect(card()).not.toBeNull();
      act(() => void vi.advanceTimersByTime(400));
      expect(card()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the pointer reach a hovered note's card to click a link in it, and closes it when the pointer leaves", () => {
    vi.useFakeTimers();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const s = mount();
      s.setNote("Sheet1", "B2", "see pli now", { runs: [{ text: "see " }, { text: "pli", link: "https://pli.dev" }, { text: " now" }] });
      click(1, 1);
      pointer("pointermove", cellAt(2, 2));
      act(() => void vi.advanceTimersByTime(500));
      expect(card()).not.toBeNull();
      // on the way down to the card the pointer crosses the cell under B2
      pointer("pointermove", cellAt(2, 3));
      act(() => void vi.advanceTimersByTime(100));
      expect(card()).not.toBeNull();
      act(() => void card()!.querySelector<HTMLAnchorElement>("a.pli-note-link")!.click());
      expect(open).toHaveBeenCalledWith("https://pli.dev", "_blank", "noopener,noreferrer");
      // the pointer leaves the card: it goes
      act(() => void card()!.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
      expect(card()).toBeNull();
    } finally {
      vi.useRealTimers();
      open.mockRestore();
    }
  });

  it("opens the note dialog with Shift+F2", () => {
    const s = mount();
    click(2, 2);
    key("F2", { shiftKey: true });
    expect(dialog().textContent).toContain("New note on B2");
    writeNote("from the keyboard");
    act(() => void dialogButton("Save").click());
    expect(s.note("Sheet1", "B2")).toBe("from the keyboard");
  });

  it("shows a link or note on a read-only sheet, without ways to change them", () => {
    const s = mount();
    s.setNote("Sheet1", "A1", "keep");
    act(() => root.render(<PliSheet session={s} readOnly />));
    click(1, 1);
    expect(card()!.textContent).toContain("keep");
    expect(card()!.querySelectorAll("button")).toHaveLength(0);
  });
});
