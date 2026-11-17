// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";
import { readRuns, renderRuns, selectOffsets, selectionOffsets } from "../src/noteDom";

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
const pointer = (type: string, xy: { clientX: number; clientY: number }, target: Element = q(".pli-grid-scroller")) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
/** Cells are 64 by 20 pixels, after a header of 48 by 24. */
const cellAt = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
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
const editor = () => dialog().querySelector<HTMLElement>('[role="textbox"]')!;
const writeNote = (text: string) => act(() => { editor().textContent = text; editor().dispatchEvent(new Event("input", { bubbles: true })); });
const select = (from: number, to: number) => act(() => { selectOffsets(editor(), from, to); document.dispatchEvent(new Event("selectionchange")); });
const tool = (label: string) => dialog().querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const setField = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const card = () => document.querySelector<HTMLElement>(".pli-cellcard");

function mount(props: { author?: string } = {}, options: { author?: string } = {}) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]), options);
  session.setValues("Sheet1", "A1", [["x", "y"], ["z", null]]);
  act(() => root.render(<PliSheet session={session} {...props} />));
  return session;
}

describe("the note editor", () => {
  it("formats the selected text with the toolbar and the shortcuts, and saves the runs", () => {
    const s = mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("Check the total now");
    select(10, 15);
    act(() => void tool("Bold").click());
    expect(tool("Bold").getAttribute("aria-pressed")).toBe("true");
    select(10, 15);
    key(editor(), "i", { ctrlKey: true });
    select(10, 15);
    setField(tool("Size") as HTMLSelectElement, "14");
    act(() => {
      const c = tool("Text colour") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(c, "#c00000");
      c.dispatchEvent(new Event("change", { bubbles: true }));
      c.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void dialogButton("Save").click());
    expect(s.note("Sheet1", "A2")).toBe("Check the total now");
    expect(s.cell("Sheet1", "A2")?.noteRuns).toEqual([{ text: "Check the " }, { text: "total", bold: true, italic: true, size: 14, color: "#c00000" }, { text: " now" }]);
  });

  it("toggles a look off when all of the selection has it, strikes with Ctrl+5, and clears formatting", () => {
    const s = mount();
    s.setNote("Sheet1", "A2", "plain bold plain", { runs: [{ text: "plain " }, { text: "bold", bold: true }, { text: " plain" }] });
    click(2, 1);
    key(document.querySelector(".pli-grid-sink")!, "F2", { shiftKey: true });
    expect(editor().querySelector("span")!.textContent).toBe("bold");
    select(6, 10);
    key(editor(), "b", { ctrlKey: true }); // all of it is bold: bold comes off
    select(0, 5);
    key(editor(), "5", { ctrlKey: true });
    act(() => void dialogButton("Save").click());
    expect(s.cell("Sheet1", "A2")?.noteRuns).toEqual([{ text: "plain", strike: true }, { text: " bold plain" }]);
    key(document.querySelector(".pli-grid-sink")!, "F2", { shiftKey: true });
    select(0, 16);
    act(() => void tool("Clear formatting").click());
    act(() => void dialogButton("Save").click());
    expect(s.cell("Sheet1", "A2")?.noteRuns).toBeUndefined();
    expect(s.note("Sheet1", "A2")).toBe("plain bold plain");
  });

  it("keeps a note plain when nothing is formatted, and can keep it showing", () => {
    const s = mount();
    click(1, 2);
    choose("Insert", "Note…");
    writeNote("one\ntwo");
    act(() => void (dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!).click());
    act(() => void dialogButton("Save").click());
    expect(s.cell("Sheet1", "B1")).toMatchObject({ note: "one\ntwo", noteBox: { show: true } });
    expect(s.cell("Sheet1", "B1")?.noteRuns).toBeUndefined();
    expect(host.querySelectorAll(".pli-notebox")).toHaveLength(1);
  });

  it("types plain text when pasting, and a line break for Enter in text", () => {
    mount();
    click(1, 1);
    choose("Insert", "Note…");
    writeNote("ab");
    select(1, 1);
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { getData: () => "X\nY" };
    act(() => void editor().dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(readRuns(editor()).text).toBe("aX\nYb");
  });
});

describe("noteDom", () => {
  const dom = (html: string) => {
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.append(el);
    return el;
  };
  it("reads what browsers make of typing: spans, tags, blocks and breaks", () => {
    expect(readRuns(dom('a<b>b</b><span style="font-style: italic; color: rgb(255, 0, 0); font-size: 12pt; font-family: Arial, sans-serif">c</span>')).runs).toEqual([{ text: "a" }, { text: "b", bold: true }, { text: "c", italic: true, color: "#ff0000", size: 12, font: "Arial" }]);
    expect(readRuns(dom("a<div>b</div><div><br></div><div>c</div>")).text).toBe("a\nb\n\nc");
    expect(readRuns(dom("a<br>b<br>")).text).toBe("a\nb");
    expect(readRuns(dom("a<br><br>")).text).toBe("a\n");
    expect(readRuns(dom('<span style="font-family: Tahoma; font-size: 9pt">x</span>')).runs).toEqual([{ text: "x" }]);
  });
  it("renders runs and finds offsets in them, round trip", () => {
    const el = dom("");
    renderRuns(el, [{ text: "ab\ncd", bold: true }, { text: "ef\n" }]);
    expect(readRuns(el).text).toBe("ab\ncdef\n");
    selectOffsets(el, 4, 7);
    expect(selectionOffsets(el)).toEqual({ from: 4, to: 7 });
    selectOffsets(el, 8, 8);
    expect(selectionOffsets(el)).toEqual({ from: 8, to: 8 });
    expect(readRuns(el).runs).toEqual([{ text: "ab\ncd", bold: true }, { text: "ef\n" }]);
  });
});

describe("the author", () => {
  it("is written on a new note from the author prop, shown in the dialog and the card, and never invented", () => {
    const s = mount({ author: "Ana" });
    click(2, 1);
    choose("Insert", "Note…");
    expect(dialog().textContent).toContain("By Ana");
    writeNote("with an author");
    act(() => void dialogButton("Save").click());
    expect(s.noteInfo("Sheet1", "A2")?.author).toBe("Ana");
    expect(card()!.textContent).toContain("Ana:");
    expect(card()!.textContent).toContain("with an author");

    const plain = mount();
    click(2, 1);
    choose("Insert", "Note…");
    expect(dialog().textContent).not.toContain("By ");
    writeNote("anonymous");
    act(() => void dialogButton("Save").click());
    expect(plain.noteInfo("Sheet1", "A2")).toEqual({ text: "anonymous" });
  });

  it("keeps the author of a note when someone else edits it", () => {
    const s = mount({ author: "Bo" });
    s.setNote("Sheet1", "A2", "first", { author: "Ana" });
    click(2, 1);
    key(document.querySelector(".pli-grid-sink")!, "F2", { shiftKey: true });
    writeNote("second");
    act(() => void dialogButton("Save").click());
    expect(s.noteInfo("Sheet1", "A2")).toMatchObject({ text: "second", author: "Ana" });
  });
});

describe("note boxes that stay showing", () => {
  it("are drawn with a line to their cell, by Show/hide note, Show all and Hide all, and not as a hover card", () => {
    vi.useFakeTimers();
    try {
      const s = mount();
      s.setNote("Sheet1", "A2", "first", { author: "Ana" });
      s.setNote("Sheet1", "B2", "second");
      click(1, 1);
      expect(host.querySelectorAll(".pli-notebox")).toHaveLength(0);
      click(2, 1);
      choose("Insert", "Notes", "Show/hide note");
      expect(host.querySelectorAll(".pli-notebox")).toHaveLength(1);
      expect(q(".pli-notebox").textContent).toContain("Ana:");
      expect(q(".pli-notebox").textContent).toContain("first");
      expect(host.querySelectorAll(".pli-notelines line")).toHaveLength(1);
      expect(s.noteInfo("Sheet1", "A2")?.box?.show).toBe(true);
      choose("Insert", "Notes", "Show all notes");
      expect(host.querySelectorAll(".pli-notebox")).toHaveLength(2);
      click(1, 1);
      pointer("pointermove", cellAt(2, 2));
      act(() => void vi.advanceTimersByTime(500));
      expect(card()).toBeNull(); // it is on the sheet already
      choose("Insert", "Notes", "Hide all notes");
      expect(host.querySelectorAll(".pli-notebox")).toHaveLength(0);
      act(() => void s.undo());
      expect(host.querySelectorAll(".pli-notebox")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("move by dragging and are sized by their handles, each as one undo step", () => {
    const s = mount();
    act(() => void s.setNote("Sheet1", "B2", "move me", { box: { show: true } }));
    click(2, 2);
    const box = () => q(".pli-notebox");
    const at = (x: number, y: number) => ({ clientX: x, clientY: y });
    // the box starts 15px right of the cell's right edge (header 48 + 2 columns of 64) and 10px above its top (24 + 20)
    expect(box().style.left).toBe(`${15 + 128}px`);
    pointer("pointerdown", at(300, 50), box());
    pointer("pointermove", at(340, 70), box());
    pointer("pointerup", at(340, 70), box());
    expect(s.noteInfo("Sheet1", "B2")?.box).toEqual({ dx: 55, dy: 10, show: true });
    const se = q('.pli-notebox-grip[data-grip="se"]');
    pointer("pointerdown", at(500, 100), se);
    pointer("pointermove", at(560, 130), se);
    pointer("pointerup", at(560, 130), se);
    expect(s.noteInfo("Sheet1", "B2")?.box).toEqual({ dx: 55, dy: 10, width: 204, height: 110, show: true });
    const nw = q('.pli-notebox-grip[data-grip="nw"]');
    pointer("pointerdown", at(300, 50), nw);
    pointer("pointermove", at(320, 60), nw);
    pointer("pointerup", at(320, 60), nw);
    expect(s.noteInfo("Sheet1", "B2")?.box).toEqual({ dx: 75, dy: 20, width: 184, height: 100, show: true });
    act(() => void s.undo());
    expect(s.noteInfo("Sheet1", "B2")?.box).toEqual({ dx: 55, dy: 10, width: 204, height: 110, show: true });
    // too small is stopped at a least size
    pointer("pointerdown", at(500, 100), q('.pli-notebox-grip[data-grip="se"]'));
    pointer("pointermove", at(0, 0), q('.pli-notebox-grip[data-grip="se"]'));
    pointer("pointerup", at(0, 0), q('.pli-notebox-grip[data-grip="se"]'));
    expect(s.noteInfo("Sheet1", "B2")?.box).toMatchObject({ width: 32, height: 20 });
  });

  it("have a Hide button, open the editor when double-clicked, and can't be moved on a read-only sheet", () => {
    const s = mount();
    act(() => void s.setNote("Sheet1", "B2", "hello", { box: { show: true } }));
    click(2, 2);
    act(() => void q<HTMLButtonElement>('.pli-notebox [aria-label="Hide note"]').click());
    expect(host.querySelectorAll(".pli-notebox")).toHaveLength(0);
    expect(s.noteInfo("Sheet1", "B2")?.box?.show).toBeUndefined();
    act(() => void s.showNote("Sheet1", "B2", true));
    act(() => void q(".pli-notebox").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(dialog().textContent).toContain("Note on B2");
    act(() => void dialogButton("Cancel").click());
    act(() => root.render(<PliSheet session={s} readOnly />));
    click(2, 2);
    expect(host.querySelectorAll(".pli-notebox-grip")).toHaveLength(0);
    pointer("pointerdown", { clientX: 300, clientY: 50 }, q(".pli-notebox"));
    pointer("pointermove", { clientX: 400, clientY: 90 }, q(".pli-notebox"));
    pointer("pointerup", { clientX: 400, clientY: 90 }, q(".pli-notebox"));
    expect(s.noteInfo("Sheet1", "B2")?.box).toEqual({ show: true });
  });

  it("steps to the next and previous note", () => {
    const s = mount();
    s.setNote("Sheet1", "B1", "a");
    s.setNote("Sheet1", "A2", "b");
    click(1, 1);
    choose("Insert", "Notes", "Next note");
    expect(q<HTMLInputElement>('[aria-label="Name box"]').value).toBe("B1");
    choose("Insert", "Notes", "Next note");
    expect(q<HTMLInputElement>('[aria-label="Name box"]').value).toBe("A2");
    choose("Insert", "Notes", "Previous note");
    expect(q<HTMLInputElement>('[aria-label="Name box"]').value).toBe("B1");
  });

  it("show the rich text of a note", () => {
    const s = mount();
    act(() => void s.setNote("Sheet1", "B2", "a bold b", { runs: [{ text: "a " }, { text: "bold", bold: true, color: "#ff0000" }, { text: " b" }], box: { show: true } }));
    const span = q(".pli-notebox .pli-note-body span");
    expect(span.textContent).toBe("bold");
    expect(span.style.fontWeight).toBe("bold");
    expect(span.style.color).toBe("rgb(255, 0, 0)");
  });
});

describe("find and replace in notes", () => {
  const setup = () => {
    const s = mount();
    s.setValues("Sheet1", "A3", [["Smith in a cell"]]);
    s.setNote("Sheet1", "A1", "Ask Smith about it", { runs: [{ text: "Ask " }, { text: "Smith", bold: true }, { text: " about it" }] });
    s.setNote("Sheet1", "B2", "smith again, Smith");
    s.setNote("Sheet1", "B3", "nothing");
    return s;
  };
  const field = (label: string) => q<HTMLInputElement>(`[aria-label="${label}"]`);
  const status = () => q(".pli-findbar-count").textContent;

  it("looks in notes with its own option, marks the cells, counts and steps between them", () => {
    setup();
    choose("Edit", "Find…");
    setField(field("Find"), "smith");
    expect(status()).toBe("1 found"); // the cell A3 is found as a value; A1 is the active cell
    setField(q<HTMLSelectElement>('[aria-label="Look in"]'), "notes");
    expect(host.querySelectorAll(".pli-grid-found")).toHaveLength(2);
    expect(status()).toBe("1 of 2"); // A1 is active, and its note has the text
    key(field("Find"), "Enter");
    expect(field("Name box").value).toBe("B2");
    expect(status()).toBe("2 of 2");
    expect(card()!.textContent).toContain("smith again");
    key(field("Find"), "Enter");
    expect(field("Name box").value).toBe("A1");
    expect(status()).toBe("1 of 2");
  });

  it("replaces in notes, keeping the look of where the text sat, as one undo step", () => {
    const s = setup();
    choose("Edit", "Find and replace…");
    setField(field("Find"), "smith");
    setField(q<HTMLSelectElement>('[aria-label="Look in"]'), "notes");
    setField(field("Replace with"), "Jones");
    const all = [...host.querySelectorAll<HTMLButtonElement>(".pli-findbar button")].find((b) => b.textContent === "Replace all")!;
    act(() => void all.click());
    expect(status()).toBe("Replaced 3 in 2 notes.");
    expect(s.note("Sheet1", "A1")).toBe("Ask Jones about it");
    expect(s.cell("Sheet1", "A1")?.noteRuns).toEqual([{ text: "Ask " }, { text: "Jones", bold: true }, { text: " about it" }]);
    expect(s.note("Sheet1", "B2")).toBe("Jones again, Jones");
    expect(s.value("Sheet1", "A3")).toBe("Smith in a cell");
    act(() => void s.undo());
    expect(s.note("Sheet1", "B2")).toBe("smith again, Smith");
    expect(s.note("Sheet1", "A1")).toBe("Ask Smith about it");
  });

  it("replaces one note at a time", () => {
    const s = setup();
    choose("Edit", "Find and replace…");
    setField(field("Find"), "Smith");
    setField(q<HTMLSelectElement>('[aria-label="Look in"]'), "notes");
    setField(field("Replace with"), "X");
    click(1, 1);
    act(() => void [...host.querySelectorAll<HTMLButtonElement>(".pli-findbar button")].find((b) => b.textContent === "Replace")!.click());
    expect(s.note("Sheet1", "A1")).toBe("Ask X about it");
    expect(s.note("Sheet1", "B2")).toBe("smith again, Smith");
  });
});
