// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";
import { readRuns, renderRuns, runsFromHtml, selectOffsets } from "../src/noteDom";
import { pngUri } from "../../sheets/test/images-helpers";

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


/** jsdom's files can't give their bytes; this one does. */
const withBytes = (file: File, bytes: Uint8Array): File => Object.assign(file, { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const put = (fn: () => void) => act(() => void fn());
const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string) => setField(el, v);
const field = (label: string) => dialog().querySelector<HTMLInputElement & HTMLSelectElement>(`[aria-label="${label}"]`)!;
const openLooks = () => act(() => void (dialog().querySelector("details") as HTMLDetailsElement).setAttribute("open", ""));
const save = () => act(() => void dialogButton("Save").click());
const pasteInto = (data: Record<string, string>) => {
  const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  paste.clipboardData = { getData: (t: string) => data[t] ?? "" };
  act(() => void editor().dispatchEvent(paste));
};

describe("the look of a note's box in the note dialog", () => {
  it("sets a fill, transparency, line, weight, dashes and no shadow, and saves them beside the box", () => {
    const s = mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("Look at me");
    openLooks();
    setValue(field("Fill colour"), "#ffcc00");
    setValue(field("Transparency"), "30");
    setValue(field("Line colour"), "#c00000");
    setValue(field("Line weight"), "2");
    setValue(field("Line dashes"), "longDash");
    act(() => void field("Shadow").click());
    save();
    expect(s.noteInfo("Sheet1", "A2")?.box).toEqual({ fill: "#ffcc00", transparency: 30, line: "#c00000", lineWeight: 2, dash: "longDash", shadow: false });
  });

  it("starts from the note's look, can take the line off, and 'Usual look' puts everything back", () => {
    const s = mount();
    put(() => {
      s.setNote("Sheet1", "A2", "styled", { box: { width: 200, show: true } });
      s.setNoteLook("Sheet1", "A2", { fill: "#aabbcc", line: "#112233" });
    });
    click(2, 1);
    key(document.querySelector(".pli-grid-sink")!, "F2", { shiftKey: true });
    openLooks();
    expect(field("Fill colour").value).toBe("#aabbcc");
    expect(field("Line colour").value).toBe("#112233");
    act(() => void field("No line").click());
    save();
    // the size and the showing are kept
    expect(s.noteInfo("Sheet1", "A2")?.box).toEqual({ width: 200, show: true, fill: "#aabbcc", line: "none" });
    key(document.querySelector(".pli-grid-sink")!, "F2", { shiftKey: true });
    openLooks();
    act(() => void dialogButton("Usual look").click());
    save();
    expect(s.noteInfo("Sheet1", "A2")?.box).toEqual({ width: 200, show: true });
  });

  it("fills the box with a picture from a file, shows it, and removes it", async () => {
    const s = mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("with picture");
    openLooks();
    const bytes = Uint8Array.from(atob(pngUri(2, 2).split(",")[1]!), (c) => c.charCodeAt(0));
    const file = withBytes(new File([bytes], "bg.png", { type: "image/png" }), bytes);
    await act(async () => {
      Object.defineProperty(field("Fill picture"), "files", { configurable: true, value: [file] });
      field("Fill picture").dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(dialog().querySelector(".pli-note-thumb")).not.toBeNull();
    save();
    expect(s.noteInfo("Sheet1", "A2")?.box?.picture).toMatch(/^data:image\/png;base64,/);
    key(document.querySelector(".pli-grid-sink")!, "F2", { shiftKey: true });
    openLooks();
    act(() => void dialogButton("Remove picture").click());
    save();
    expect(s.noteInfo("Sheet1", "A2")?.box).toBeUndefined();
  });

  it("says why a file is not a picture it can use", async () => {
    mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("x");
    openLooks();
    await act(async () => {
      Object.defineProperty(field("Fill picture"), "files", { configurable: true, value: [withBytes(new File(["hello"], "a.txt", { type: "text/plain" }), new TextEncoder().encode("hello"))] });
      field("Fill picture").dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(dialog().querySelector('[role="alert"]')?.textContent).toMatch(/picture/i);
  });
});

describe("drawing a note's look", () => {
  it("draws a shown note with its fill layer, line, dashes and no shadow, and keeps the look when it is dragged", () => {
    const s = mount();
    put(() => {
      s.setNote("Sheet1", "B2", "boxed", { box: { show: true, dx: 20 } });
      s.setNoteLook("Sheet1", "B2", { fill: "#ffcc00", transparency: 40, line: "#c00000", lineWeight: 2, dash: "dash", shadow: false });
    });
    const box = q(".pli-notebox");
    expect(box.style.border).toContain("2pt");
    expect(box.style.border).toContain("dashed");
    expect(box.style.boxShadow).toBe("none");
    const layer = q(".pli-notebox .pli-note-fill");
    expect(layer.style.backgroundColor).toBe("rgb(255, 204, 0)");
    expect(layer.style.opacity).toBe("0.6");
    expect(host.querySelector<SVGLineElement>(".pli-notelines line")!.style.stroke).toBe("#c00000");
    // dragging the box keeps its look
    const down = (type: string, x: number, y: number) => act(() => void box.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })));
    down("pointerdown", 200, 100);
    down("pointermove", 230, 120);
    down("pointerup", 230, 120);
    expect(s.noteInfo("Sheet1", "B2")?.box).toMatchObject({ fill: "#ffcc00", transparency: 40, line: "#c00000", show: true });
    expect(s.noteInfo("Sheet1", "B2")?.box?.dx).not.toBe(20);
  });

  it("draws a picture fill, and a line of none", () => {
    const s = mount();
    put(() => {
      s.setNote("Sheet1", "B2", "pic", { box: { show: true } });
      s.setNoteLook("Sheet1", "B2", { picture: pngUri(2, 2), line: "none" });
    });
    const layer = q(".pli-notebox .pli-note-fill");
    expect(layer.style.backgroundImage).toContain("data:image/png");
    expect(q(".pli-notebox").style.borderColor).toBe("transparent");
  });

  it("leaves a box with no look to the stylesheet", () => {
    const s = mount();
    put(() => s.setNote("Sheet1", "B2", "plain", { box: { show: true } }));
    expect(host.querySelector(".pli-notebox .pli-note-fill")).toBeNull();
    expect(q(".pli-notebox").getAttribute("style")).not.toContain("border");
  });

  it("shows the look on the card of a selected cell", () => {
    const s = mount();
    put(() => {
      s.setNote("Sheet1", "A2", "card", {});
      s.setNoteLook("Sheet1", "A2", { fill: "#ddeeff", line: "#334455" });
    });
    click(2, 1);
    expect(card()!.querySelector<HTMLElement>(".pli-note-fill")!.style.backgroundColor).toBe("rgb(221, 238, 255)");
    expect(card()!.querySelector<HTMLElement>(".pli-cellcard-text")!.style.border).toContain("rgb(51, 68, 85)");
  });
});

describe("links in a note", () => {
  it("links the selected words from the Link button, and saves the run with its address", () => {
    const s = mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("see the docs now");
    select(8, 12);
    act(() => void tool("Link").click());
    setValue(field("Link address"), "www.pli.dev/docs");
    act(() => void dialog().querySelector<HTMLElement>('[aria-label="Link the selected words"]')!.querySelectorAll("button")[0]!.click());
    expect(editor().querySelector("a")!.textContent).toBe("docs");
    save();
    expect(s.noteInfo("Sheet1", "A2")?.runs).toEqual([{ text: "see the " }, { text: "docs", link: "https://www.pli.dev/docs" }, { text: " now" }]);
  });

  it("asks for words to link when nothing is selected, refuses a script, and removes a link", () => {
    const s = mount();
    put(() => s.setNote("Sheet1", "A2", "go there", { runs: [{ text: "go " }, { text: "there", link: "https://pli.dev" }] }));
    click(2, 1);
    key(document.querySelector(".pli-grid-sink")!, "F2", { shiftKey: true });
    select(1, 1);
    key(editor(), "k", { ctrlKey: true });
    expect(dialog().querySelector('[role="alert"]')?.textContent).toMatch(/Select the words/);
    select(0, 2);
    key(editor(), "k", { ctrlKey: true });
    setValue(field("Link address"), "javascript:alert(1)");
    key(field("Link address"), "Enter");
    expect(dialog().querySelector('[role="alert"]')?.textContent).toMatch(/script/);
    // with the caret inside the link, its address is shown and it can be removed
    act(() => void dialogButton("Cancel").click());
    select(5, 5);
    act(() => void tool("Link").click());
    expect(field("Link address").value).toBe("https://pli.dev");
    act(() => void dialogButton("Remove link").click());
    save();
    expect(s.cell("Sheet1", "A2")?.noteRuns).toBeUndefined();
  });

  it("draws links in a shown note as clickable, follows them, and does not drag the box from the link", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const s = mount();
    put(() => s.setNote("Sheet1", "B2", "open pli now", { runs: [{ text: "open " }, { text: "pli", link: "https://pli.dev" }, { text: " now" }], box: { show: true } }));
    const a = q<HTMLAnchorElement>(".pli-notebox a.pli-note-link");
    expect(a.textContent).toBe("pli");
    expect(a.getAttribute("href")).toBe("https://pli.dev");
    act(() => void a.click());
    expect(open).toHaveBeenCalledWith("https://pli.dev", "_blank", "noopener,noreferrer");
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 });
    act(() => void a.dispatchEvent(down));
    expect(s.noteInfo("Sheet1", "B2")?.box).toEqual({ show: true });
  });

  it("follows a link to a place in the workbook from the card", () => {
    const s = mount();
    put(() => {
      s.addSheet?.("Other");
      s.setNote("Sheet1", "A2", "to c3", { runs: [{ text: "to " }, { text: "c3", link: "#Sheet1!C3" }] });
    });
    click(2, 1);
    const a = card()!.querySelector<HTMLAnchorElement>("a.pli-note-link")!;
    expect(a.hasAttribute("href")).toBe(false);
    act(() => void a.click());
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("C3");
  });

  it("pastes a web address over selected words as a link, and formatted text with its look", () => {
    mount();
    click(1, 1);
    choose("Insert", "Note…");
    writeNote("see docs");
    select(4, 8);
    pasteInto({ "text/plain": "https://pli.dev/docs" });
    expect(readRuns(editor()).runs).toEqual([{ text: "see " }, { text: "https://pli.dev/docs", link: "https://pli.dev/docs" }]);
    select(0, 3);
    pasteInto({ "text/plain": "BOLD x", "text/html": '<p><b>BOLD</b> <a href="https://x.dev">x</a> <script>1</script><span style="color:#000000">k</span></p>' });
    const r = readRuns(editor()).runs;
    expect(r.slice(0, 3)).toEqual([{ text: "BOLD", bold: true }, { text: " " }, { text: "x", link: "https://x.dev" }]);
    expect(readRuns(editor()).text).toBe("BOLD x k https://pli.dev/docs");
  });
});

describe("a look for what is typed next", () => {
  it("applies a button pressed on a point to the next characters, and the buttons show it", () => {
    const s = mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("ab");
    select(1, 1);
    act(() => void tool("Bold").click());
    expect(tool("Bold").getAttribute("aria-pressed")).toBe("true");
    const type = (data: string) => act(() => void editor().dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data })));
    type("X");
    type("Y");
    expect(readRuns(editor()).runs).toEqual([{ text: "a" }, { text: "XY", bold: true }, { text: "b" }]);
    // moving away drops what was pending
    select(0, 0);
    expect(tool("Bold").getAttribute("aria-pressed")).toBe("false");
    type("Z");
    expect(readRuns(editor()).text).toBe("aXYb");
    save();
    expect(s.cell("Sheet1", "A2")?.noteRuns).toEqual([{ text: "a" }, { text: "XY", bold: true }, { text: "b" }]);
  });

  it("takes a toggled look off again before typing, and mixes with a colour", () => {
    mount();
    click(2, 1);
    choose("Insert", "Note…");
    writeNote("");
    act(() => void tool("Italic").click());
    act(() => void tool("Italic").click());
    const type = (data: string) => act(() => void editor().dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data })));
    act(() => {
      const c = tool("Text colour") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(c, "#0000ff");
      c.dispatchEvent(new Event("change", { bubbles: true }));
      c.dispatchEvent(new Event("input", { bubbles: true }));
    });
    select(0, 0);
    type("q");
    // italic was pressed twice (so it is off) and blue is pending
    expect(readRuns(editor()).runs).toEqual([{ text: "q", color: "#0000ff" }]);
  });
});

describe("noteDom: links and pasted HTML", () => {
  it("renders a link run as an anchor with data-link and reads it back", () => {
    const el = document.createElement("div");
    renderRuns(el, [{ text: "go " }, { text: "there", link: "https://pli.dev", bold: true }]);
    expect(el.querySelector("a")!.getAttribute("data-link")).toBe("https://pli.dev");
    expect(el.querySelector("a")!.hasAttribute("href")).toBe(false);
    expect(readRuns(el).runs).toEqual([{ text: "go " }, { text: "there", link: "https://pli.dev", bold: true }]);
  });

  it("keeps the look and the links of pasted HTML, leaves out scripts and unsafe addresses, and trims block edges", () => {
    const runs = runsFromHtml('<div><p>one <i>two</i></p><p><a href="javascript:alert(1)">bad</a> <a href="mailto:a@b.dev">mail</a></p><script>x()</script></div>');
    expect(runs).toEqual([{ text: "one " }, { text: "two", italic: true }, { text: "\nbad " }, { text: "mail", link: "mailto:a@b.dev" }]);
    expect(runsFromHtml("")).toEqual([]);
  });
});
