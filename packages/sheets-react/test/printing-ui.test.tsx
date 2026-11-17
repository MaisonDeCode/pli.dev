// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";
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
  document.querySelectorAll("iframe").forEach((f) => f.remove());
  vi.useRealTimers();
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const cellAt = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const setField = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
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
const field = (label: string) => dialog().querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
const overlay = () => document.querySelector<HTMLElement>(".pli-print-overlay");

function mount(rows = 100, cols = 12, props: Partial<React.ComponentProps<typeof PliSheet>> = {}) {
  const session = new SheetSession(createWorkbook("Budget", ["Sheet1"]), { now: () => 45000 });
  session.setValues("Sheet1", "A1", Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r + 1}c${c + 1}`)));
  act(() => root.render(<PliSheet session={session} {...props} />));
  return session;
}

describe("page setup", () => {
  it("opens from the File menu, shows what the sheet has, and saves what was changed as one undo step", () => {
    const s = mount();
    s.setPageSetup("Sheet1", { header: { center: "Old" } });
    choose("File", "Page setup…");
    expect(dialog().textContent).toContain("Page setup: Sheet1");
    expect(dialog().querySelector<HTMLInputElement>('[data-slot="header:center"]')!.value).toBe("Old");
    expect((field("Paper") as HTMLSelectElement).value).toBe("letter");
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[name=orientation]")][1]!.click());
    setField(field("Paper"), "a4");
    setField(field("Scale in percent"), "75");
    setField(field("top margin"), "1");
    setField(dialog().querySelector<HTMLInputElement>('[data-slot="header:center"]')!, "&A");
    setField(dialog().querySelector<HTMLInputElement>('[data-slot="footer:right"]')!, "Page &P of &N");
    setField(field("Rows to repeat"), "1:2");
    setField(field("Print area"), "A1:D20, F1:G5");
    act(() => void dialogButton("Save").click());
    expect(s.pageSetup("Sheet1")).toEqual({ orientation: "landscape", paper: "a4", scale: 75, margins: { top: 1 }, header: { center: "&A" }, footer: { right: "Page &P of &N" }, printArea: ["A1:D20", "F1:G5"], titleRows: [1, 2] });
    act(() => void s.undo());
    expect(s.pageSetup("Sheet1")).toEqual({ header: { center: "Old" } });
  });

  it("fits to pages instead of scaling, inserts a code where the cursor is, and says what is refused", () => {
    const s = mount();
    choose("File", "Page setup…");
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[name=sizing]")][1]!.click());
    setField(field("Pages wide"), "1");
    setField(field("Pages tall"), "0");
    const center = dialog().querySelector<HTMLInputElement>('[data-slot="header:center"]')!;
    act(() => void center.focus());
    setField(center, "Page ");
    act(() => void center.setSelectionRange(5, 5));
    setField(field("Insert a code") as HTMLSelectElement, "&P");
    expect(center.value).toBe("Page &P");
    setField(field("Print area"), "nonsense");
    act(() => void dialogButton("Save").click());
    expect(dialog().textContent).toContain("isn't a range");
    expect(s.pageSetup("Sheet1")).toEqual({});
    setField(field("Print area"), "");
    act(() => void dialogButton("Save").click());
    expect(s.pageSetup("Sheet1")).toEqual({ fit: { wide: 1, tall: 0 }, header: { center: "Page &P" } });
  });
});

describe("print preview", () => {
  it("shows the pages with their cells, headers and footers, from the File menu or Ctrl+P, and closes", () => {
    const s = mount();
    s.setPageSetup("Sheet1", { header: { center: "&A" }, footer: { right: "Page &P of &N" } });
    choose("File", "Print…");
    expect(overlay()).toBeTruthy();
    expect(overlay()!.textContent).toContain("6 pages at 100%");
    const pages = overlay()!.querySelectorAll(".pli-print-page");
    expect(pages).toHaveLength(6);
    expect(pages[0]!.textContent).toContain("Sheet1");
    expect(pages[0]!.textContent).toContain("Page 1 of 6");
    expect(pages[0]!.textContent).toContain("r1c1");
    expect(pages[0]!.textContent).toContain("r45c10");
    expect(pages[0]!.textContent).not.toContain("r46c1");
    expect(pages[1]!.textContent).toContain("r46c1");
    expect(pages[0]!.querySelector<HTMLElement>(".pli-print-scaled")!.style.transform).toBe("scale(1)");
    expect((pages[0] as HTMLElement).style.width).toBe("612pt");
    act(() => void [...overlay()!.querySelectorAll("button")].find((b) => b.textContent === "Close")!.click());
    expect(overlay()).toBeNull();
    key("p", { ctrlKey: true });
    expect(overlay()).toBeTruthy();
    act(() => void overlay()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(overlay()).toBeNull();
  });

  it("follows the page setup: paper, scale, headings, centring, a picture over the cells, and nothing to print", () => {
    const s = mount(10, 3);
    s.setPageSetup("Sheet1", { orientation: "landscape", paper: "a4", scale: 50, headings: true, centerHorizontally: true, gridlines: true, blackAndWhite: true });
    s.addImage("Sheet1", { src: pngUri(40, 20), from: { row: 2, col: 2 }, width: 40, height: 20, alt: "A box" });
    choose("File", "Print…");
    const page = overlay()!.querySelector<HTMLElement>(".pli-print-page")!;
    expect(parseFloat(page.style.width)).toBeCloseTo(841.89, 1);
    expect(page.querySelector<HTMLElement>(".pli-print-scaled")!.style.transform).toBe("scale(0.5)");
    expect(page.querySelector<HTMLElement>(".pli-print-content")!.style.filter).toBe("grayscale(1)");
    expect(parseFloat(page.querySelector<HTMLElement>(".pli-print-scaled")!.style.left)).toBeGreaterThan(0); // centred
    expect(page.querySelector("th")!.textContent).toBe(""); // the corner of the headings
    expect(page.innerHTML).toContain("border:0.5pt solid #bfbfbf");
    const img = page.querySelector<HTMLImageElement>(".pli-print-objects img")!;
    expect(img.alt).toBe("A box");
    expect((img.closest(".pli-print-objects > div") as HTMLElement).style.left).toBe("64px");
    expect((img.closest(".pli-print-objects > div") as HTMLElement).style.top).toBe("20px");
    act(() => void [...overlay()!.querySelectorAll("button")].find((b) => b.textContent === "Close")!.click());
    const empty = new SheetSession(createWorkbook("Empty"));
    act(() => root.render(<PliSheet session={empty} />));
    choose("File", "Print…");
    expect(overlay()!.textContent).toContain("Nothing to print");
    expect([...overlay()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Download PDF")!.disabled).toBe(true);
  });

  it("sends the pages to a page of their own and prints it with the browser's dialog, when that is asked for", () => {
    vi.useFakeTimers();
    mount(60, 3, { browserPrint: true });
    choose("File", "Print…");
    // The browser's dialog is not the Print button: it is a button of its own that is there only when asked for.
    expect([...overlay()!.querySelectorAll("button")].some((b) => b.textContent === "Print")).toBe(false);
    act(() => void [...overlay()!.querySelectorAll("button")].find((b) => b.textContent === "Print with the browser…")!.click());
    const frame = document.querySelector<HTMLIFrameElement>("iframe[aria-hidden=true]")!;
    expect(frame).toBeTruthy();
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, "print", { value: print, configurable: true });
    act(() => void vi.advanceTimersByTime(100));
    expect(print).toHaveBeenCalledTimes(1);
    const doc = frame.contentDocument!;
    expect(doc.querySelectorAll(".pli-print-page")).toHaveLength(2);
    expect(doc.head.textContent).toContain("@page{size:612pt 792pt;margin:0}");
    expect(doc.body.textContent).toContain("r1c1");
    expect(doc.body.textContent).not.toContain("Print preview");
  });

  it("opens the page setup from the preview", () => {
    mount(5, 3);
    choose("File", "Print…");
    act(() => void [...overlay()!.querySelectorAll("button")].find((b) => b.textContent === "Page setup…")!.click());
    expect(dialog().textContent).toContain("Page setup");
  });
});

describe("page breaks, and the print area, from the menus", () => {
  it("makes and removes page breaks, drawn on the sheet, and shows where a page is full", () => {
    const s = mount();
    choose("View", "Page breaks");
    expect(host.querySelectorAll(".pli-grid-break:not([data-manual])").length).toBeGreaterThan(0); // after column 10, where a page is full
    choose("View", "Page breaks");
    expect(host.querySelectorAll(".pli-grid-break")).toHaveLength(0);
    click(11, 3);
    choose("Insert", "Page break", "Page break above");
    choose("Insert", "Page break", "Page break to the left");
    expect(s.pageSetup("Sheet1")).toMatchObject({ rowBreaks: [10], colBreaks: [2] });
    expect(host.querySelectorAll(".pli-grid-break[data-manual]").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelectorAll(".pli-grid-break:not([data-manual])")).toHaveLength(0);
    choose("Insert", "Page break", "Remove page breaks here");
    expect(s.pageSetup("Sheet1")).toEqual({});
    choose("Insert", "Page break", "Page break above");
    choose("Insert", "Page break", "Remove all page breaks");
    expect(s.pageSetup("Sheet1")).toEqual({});
  });

  it("sets the print area to the selection and clears it", () => {
    const s = mount();
    click(2, 2);
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    choose("Format", "Print area", "Set print area");
    expect(s.pageSetup("Sheet1").printArea).toEqual(["B2:C3"]);
    choose("Format", "Print area", "Clear print area");
    expect(s.pageSetup("Sheet1").printArea).toBeUndefined();
  });
});
