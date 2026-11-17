// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";
import { png, pngUri } from "../../sheets/test/images-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  // jsdom's files don't read themselves.
  if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function (this: Blob) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.readAsArrayBuffer(this); }); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
/** Cells are 64 by 20 pixels, after a header of 48 by 24. */
const at = (x: number, y: number) => ({ clientX: 48 + x, clientY: 24 + y });
const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  pointer("pointerdown", at(from.x, from.y));
  pointer("pointermove", at(to.x, to.y));
  pointer("pointerup", at(to.x, to.y));
};
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const file = (name: string, bytes: Uint8Array, type = "image/png") => new File([bytes as unknown as BlobPart], name, { type });

function mount(sheets = ["Sheet1"]) {
  const session = new SheetSession(createWorkbook("t", sheets));
  session.setValues("Sheet1", "A1", [["x"]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}
const selected = () => q(".pli-grid-image[data-selected]");
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const setField = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const clip = () => {
  const store: Record<string, string> = {};
  return { store, setData: (t: string, v: string) => void (store[t] = v), getData: (t: string) => store[t] ?? "", files: [] as File[] };
};
const copyEvent = (type: "copy" | "cut", data: ReturnType<typeof clip>) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  act(() => void sink().dispatchEvent(event));
};
const pasteEvent = (data: ReturnType<typeof clip>) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  act(() => void sink().dispatchEvent(event));
};


describe("pictures turned, flipped and cropped", () => {
  it("are drawn turned, mirrored and cropped as their settings say", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50, rotation: 30, flipH: true, crop: { left: 0.25, top: 0.1 } });
    act(() => root.render(<PliSheet session={s} />));
    const box = q(".pli-grid-image");
    expect(box.style.transform).toBe("rotate(30deg)");
    expect(q(".pli-grid-imageframe").style.transform).toBe("scale(-1, 1)");
    const img = q<HTMLImageElement>(".pli-grid-image img");
    // 100 by 50 shows 75% across and 90% down, so the whole picture is drawn 133 by 56 and moved left and up.
    expect(parseFloat(img.style.width)).toBeCloseTo(100 / 0.75, 3);
    expect(parseFloat(img.style.height)).toBeCloseTo(50 / 0.9, 3);
    expect(parseFloat(img.style.left)).toBeCloseTo(-0.25 * (100 / 0.75), 3);
    expect(parseFloat(img.style.top)).toBeCloseTo(-0.1 * (50 / 0.9), 3);
  });

  it("are picked by their turned shape, not the box they were turned in", () => {
    const s = mount();
    // 200 by 20, turned a quarter: it now stands up, 20 across and 200 high, around its centre at (150, 110).
    s.addImage("Sheet1", { src: pngUri(100, 10), id: "p", from: { row: 5, col: 1, dx: 50 }, width: 200, height: 20, rotation: 90 });
    act(() => root.render(<PliSheet session={s} />));
    const click = (x: number, y: number) => (pointer("pointerdown", at(x, y)), pointer("pointerup", at(x, y)));
    click(150, 40 + 10 + 80); // above the flat box but on the standing picture
    expect(selected()).not.toBeNull();
    key("Escape");
    expect(q(".pli-grid-image[data-selected]")).toBeNull();
    click(60, 105 + 10 + 5); // inside the flat box's left end, but off the standing picture
    expect(q(".pli-grid-image[data-selected]")).toBeNull();
  });

  it("are formatted from the dialog in one undo step, and the crop keeps the scale", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 200, height: 100 });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", at(50, 25));
    pointer("pointerup", at(50, 25));
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(50, 25) })));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent?.startsWith("Format picture"))!.click());
    const boxes = [...dialog().querySelectorAll<HTMLInputElement>("input")];
    const [rotation, flipH, flipV, left, top, right, bottom] = boxes;
    const [size, move, free] = [...dialog().querySelectorAll<HTMLInputElement>("input[name=image-placement]")];
    setField(rotation!, "45");
    act(() => void flipV!.click());
    setField(left!, "25");
    setField(right!, "25");
    act(() => void free!.click());
    expect(flipH!.checked).toBe(false);
    expect(size!.checked).toBe(false);
    expect(move!.checked).toBe(false);
    expect([top!.value, bottom!.value]).toEqual(["0", "0"]);
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(s.images("Sheet1")[0]!).toMatchObject({ rotation: 45, flipV: true, crop: { left: 0.25, right: 0.25 }, placement: "free", width: 100, height: 100 });
    act(() => s.undo());
    expect(s.images("Sheet1")[0]!).toMatchObject({ width: 200, height: 100 });
    expect(s.images("Sheet1")[0]!.rotation).toBeUndefined();
  });

  it("say what is wrong in the dialog and keep it open", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 200, height: 100 });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", at(50, 25));
    pointer("pointerup", at(50, 25));
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(50, 25) })));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent?.startsWith("Format picture"))!.click());
    const [, , , left, , right] = [...dialog().querySelectorAll<HTMLInputElement>("input")];
    setField(left!, "60");
    setField(right!, "60");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(dialog().querySelector("[role=alert]")!.textContent).toContain("leave some");
    expect(s.images("Sheet1")[0]!.crop).toBeUndefined();
  });

  it("are turned and mirrored from the right-click menu", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50 });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", at(50, 25));
    pointer("pointerup", at(50, 25));
    const menu = (label: string) => {
      act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(50, 25) })));
      act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === label)!.click());
    };
    menu("Rotate right 90°");
    menu("Rotate right 90°");
    menu("Rotate left 90°");
    menu("Flip horizontally");
    expect(s.images("Sheet1")[0]!).toMatchObject({ rotation: 90, flipH: true });
  });
});

describe("pictures that follow their cells, from the menu", () => {
  it("are set to move and size with cells, and the menu shows which is in force", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 40 });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", at(50, 25));
    pointer("pointerup", at(50, 25));
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(50, 25) })));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Move and size")!.click());
    const items = () => [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")];
    const sizing = items().find((b) => b.querySelector(".pli-menu-label")?.textContent === "Move and size with cells")!;
    act(() => void sizing.click());
    expect(s.images("Sheet1")[0]!.placement).toBe("size");
    // Making the row under it taller stretches it on screen and in the workbook.
    act(() => s.setRowHeight("Sheet1", 2, 60));
    expect(s.images("Sheet1")[0]!.height).toBe(40 + 60 * (4 / 3) - 20);
    expect(parseFloat(q(".pli-grid-image").style.height)).toBe(40 + 60 * (4 / 3) - 20);
  });
});

describe("pictures from the keyboard", () => {
  it("are picked with Alt+Shift+Down, then Tab and Shift+Tab step between them, and Escape lets go", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "a", from: { row: 2, col: 1 }, width: 60, height: 30 });
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "b", from: { row: 6, col: 3 }, width: 60, height: 30 });
    s.addChart("Sheet1", { type: "column", series: [{ values: "Sheet1!A1:A1" }], id: "c", from: { row: 10, col: 1 } });
    act(() => root.render(<PliSheet session={s} />));
    const ids = () => [...host.querySelectorAll(".pli-grid-chart[data-selected]")].length;
    expect(ids()).toBe(0);
    key("ArrowDown", { altKey: true, shiftKey: true });
    expect(ids()).toBe(1);
    expect(selected().getAttribute("style")).toContain("top: 20px"); // the first picture, in row 2
    key("Tab");
    expect(selected().getAttribute("style")).toContain("top: 100px"); // the second, in row 6
    key("Tab");
    expect(q(".pli-grid-chart[data-selected]:not(.pli-grid-image)")).not.toBeNull(); // the chart is after the pictures
    key("Tab");
    expect(selected().getAttribute("style")).toContain("top: 20px"); // round again
    key("Tab", { shiftKey: true });
    expect(q(".pli-grid-chart[data-selected]:not(.pli-grid-image)")).not.toBeNull();
    key("ArrowUp", { altKey: true, shiftKey: true });
    expect(selected().getAttribute("style")).toContain("top: 100px");
    key("Escape");
    expect(ids()).toBe(0);
    key("ArrowUp", { altKey: true, shiftKey: true }); // none picked: Up starts from the last
    expect(q(".pli-grid-chart[data-selected]:not(.pli-grid-image)")).not.toBeNull();
  });

  it("are moved by the arrow keys, 10 pixels or 1 with Ctrl, and stretched with Shift", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "a", from: { row: 3, col: 2 }, width: 60, height: 30 });
    act(() => root.render(<PliSheet session={s} />));
    key("ArrowDown", { altKey: true, shiftKey: true });
    key("ArrowRight");
    key("ArrowRight", { ctrlKey: true });
    key("ArrowDown");
    key("ArrowUp", { ctrlKey: true });
    expect(s.images("Sheet1")[0]!.from).toEqual({ row: 3, col: 2, dx: 11, dy: 9 }); // column B starts at 64: 10 + 1 pixels in, and row 3 starts at 40: 10 - 1 down
    expect(selected()).not.toBeNull(); // still picked
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown", { shiftKey: true, ctrlKey: true });
    expect(s.images("Sheet1")[0]!).toMatchObject({ width: 70, height: 31 });
    key("ArrowLeft", { shiftKey: true });
    key("ArrowLeft", { shiftKey: true });
    expect(s.images("Sheet1")[0]!.width).toBe(50);
    act(() => s.undo());
    expect(s.images("Sheet1")[0]!.width).toBe(60);
    key("Delete");
    expect(s.images("Sheet1")).toHaveLength(0);
  });

  it("don't move on a read-only sheet", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "a", from: { row: 3, col: 2 }, width: 60, height: 30 });
    act(() => root.render(<PliSheet session={s} readOnly />));
    key("ArrowDown", { altKey: true, shiftKey: true });
    key("ArrowRight");
    expect(s.images("Sheet1")[0]!.from).toEqual({ row: 3, col: 2 });
  });
});

describe("copying a picture", () => {
  it("copies it with Ctrl+C and pastes it at the active cell, on another sheet too, and each paste is one undo step", () => {
    const s = mount(["Sheet1", "Other"]);
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "a", from: { row: 3, col: 2 }, width: 60, height: 30, alt: "Red box", rotation: 20, placement: "size" });
    act(() => root.render(<PliSheet session={s} />));
    key("ArrowDown", { altKey: true, shiftKey: true });
    const data = clip();
    copyEvent("copy", data);
    expect(data.store["text/plain"]).toContain("Red box");
    // Another sheet: click its tab, a cell, and paste.
    act(() => void [...host.querySelectorAll<HTMLButtonElement>(".pli-sheet-tab-name")].find((t) => t.textContent === "Other")!.click());
    const cellClick = { clientX: 48 + 64 * 3 + 5, clientY: 24 + 20 * 4 + 5 };
    pointer("pointerdown", cellClick);
    pointer("pointerup", cellClick);
    pasteEvent(data);
    const there = s.images("Other");
    expect(there).toHaveLength(1);
    expect(there[0]!).toMatchObject({ from: { row: 5, col: 4 }, width: 60, height: 30, alt: "Red box", rotation: 20, placement: "size" });
    expect(s.images("Sheet1")).toHaveLength(1);
    expect(selected()).not.toBeNull();
    pasteEvent(data); // again, at the same cell
    expect(s.images("Other")).toHaveLength(2);
    act(() => s.undo());
    expect(s.images("Other")).toHaveLength(1);
  });

  it("cuts a picture: it goes from where it was when it is pasted, in one step", () => {
    const s = mount(["Sheet1", "Other"]);
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "a", from: { row: 3, col: 2 }, width: 60, height: 30 });
    act(() => root.render(<PliSheet session={s} />));
    key("ArrowDown", { altKey: true, shiftKey: true });
    const data = clip();
    copyEvent("cut", data);
    expect(s.images("Sheet1")).toHaveLength(1); // not yet
    act(() => void [...host.querySelectorAll<HTMLButtonElement>(".pli-sheet-tab-name")].find((t) => t.textContent === "Other")!.click());
    pasteEvent(data);
    expect(s.images("Sheet1")).toHaveLength(0);
    expect(s.images("Other")).toHaveLength(1);
    act(() => s.undo());
    expect(s.images("Sheet1")).toHaveLength(1);
    expect(s.images("Other")).toHaveLength(0);
  });

  it("copies cells as before when no picture is picked", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "a", from: { row: 3, col: 2 }, width: 60, height: 30 });
    act(() => root.render(<PliSheet session={s} />));
    const data = clip();
    copyEvent("copy", data);
    expect(data.store["text/plain"]).toBe("x");
    expect(s.images("Sheet1")).toHaveLength(1);
  });
});
