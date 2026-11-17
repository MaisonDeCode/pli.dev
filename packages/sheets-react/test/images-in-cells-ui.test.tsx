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



const cellMenu = (x: number, y: number) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y })));
const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === label);
const URL_ = "https://example.com/logo.png";

describe("pictures in cells in the grid", () => {
  it("are drawn inside the cell, fitted to it, with the cell's text left out", () => {
    const s = mount();
    s.setCellPicture("Sheet1", "B2", { src: pngUri(40, 20), alt: "A red box" });
    act(() => root.render(<PliSheet session={s} />));
    const view = q(".pli-cell-picture");
    expect(view.style.left).toBe("64px");
    expect(view.style.top).toBe("20px");
    expect(view.style.width).toBe("64px");
    expect(view.style.height).toBe("20px");
    const img = view.querySelector("img")!;
    expect(img.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.style.objectFit).toBe("contain");
    expect(img.alt).toBe("A red box");
    expect(host.textContent).not.toContain("A red box"); // the description isn't painted over the picture
  });

  it("follow the size of their cell", () => {
    const s = mount();
    s.setCellPicture("Sheet1", "B2", { src: pngUri(40, 20) });
    s.setColumnWidth("Sheet1", 2, 20);
    s.setRowHeight("Sheet1", 2, 60);
    act(() => root.render(<PliSheet session={s} />));
    const view = q(".pli-cell-picture");
    expect(view.style.width).toBe("145px");
    expect(view.style.height).toBe("80px");
  });

  it("from an IMAGE formula are drawn when pictures from the web are allowed, with the sizing asked for", () => {
    const s = mount();
    s.setCell("Sheet1", "B2", `=IMAGE("${URL_}","Logo",1)`);
    s.setCell("Sheet1", "B3", `=IMAGE("${URL_}","Own size",2)`);
    s.setCell("Sheet1", "B4", `=IMAGE("${URL_}","Custom",3,30,50)`);
    act(() => root.render(<PliSheet session={s} remoteImages />));
    const imgs = [...host.querySelectorAll<HTMLImageElement>(".pli-cell-picture img")];
    expect(imgs.map((i) => i.src)).toEqual([URL_, URL_, URL_]);
    expect(imgs.map((i) => i.style.objectFit)).toEqual(["fill", "none", "fill"]);
    expect([imgs[2]!.style.width, imgs[2]!.style.height]).toEqual(["50px", "30px"]);
  });

  it("from the web are not fetched unless allowed: the cell shows its text instead", () => {
    const s = mount();
    s.setCell("Sheet1", "B2", `=IMAGE("${URL_}","Our logo")`);
    act(() => root.render(<PliSheet session={s} />));
    expect(host.querySelector(".pli-cell-picture")).toBeNull();
    expect(host.querySelector(`img[src="${URL_}"]`)).toBeNull();
    expect(host.textContent).toContain("Our logo");
  });

  it("from a data: URI are drawn without being allowed anything, since they fetch nothing", () => {
    const s = mount();
    s.setCell("Sheet1", "B2", `=IMAGE("${pngUri(8, 8)}","tiny")`);
    act(() => root.render(<PliSheet session={s} />));
    expect(host.querySelector(".pli-cell-picture img")).not.toBeNull();
  });

  it("are put in the active cell from the Insert menu's file chooser", async () => {
    const s = mount();
    act(() => root.render(<PliSheet session={s} />));
    const input = q<HTMLInputElement>("input[aria-label='Insert an image in the cell']");
    Object.defineProperty(input, "files", { value: [new File([png(30, 15) as unknown as BlobPart], "box.png", { type: "image/png" })], configurable: true });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(s.cell("Sheet1", "A1")!.picture).toBeDefined();
    expect(s.cell("Sheet1", "A1")!.v).toBe("box"); // the file's name, like a floating picture's description
    expect(menuLabels().includes("Image in cell…")).toBe(true);
  });

  it("are turned into a picture over the cells, and removed, from the cell's right-click menu", () => {
    const s = mount();
    s.setCellPicture("Sheet1", "A2", { src: pngUri(40, 20), alt: "box" });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", at(10, 30));
    pointer("pointerup", at(10, 30));
    cellMenu(at(10, 30).clientX, at(10, 30).clientY);
    act(() => void item("Place picture over cells")!.click());
    expect(s.cell("Sheet1", "A2")).toBeUndefined();
    expect(s.images("Sheet1")).toHaveLength(1);
    expect(selected()).not.toBeNull();
    // And back: the picture's right-click menu has Place in cell.
    cellMenu(at(10, 30).clientX, at(10, 30).clientY);
    act(() => void item("Place in cell")!.click());
    expect(s.images("Sheet1")).toHaveLength(0);
    expect(s.cell("Sheet1", "A2")!.picture).toBeDefined();
    pointer("pointerdown", at(10, 30));
    pointer("pointerup", at(10, 30));
    cellMenu(at(10, 30).clientX, at(10, 30).clientY);
    act(() => void item("Remove picture")!.click());
    expect(s.cell("Sheet1", "A2")).toBeUndefined();
  });

  it("show no picture items on a cell that has none", () => {
    const s = mount();
    act(() => root.render(<PliSheet session={s} />));
    cellMenu(at(10, 30).clientX, at(10, 30).clientY);
    expect(item("Place picture over cells")).toBeUndefined();
  });
});

function menuLabels(): string[] {
  act(() => void [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "Insert")!.click());
  return [...document.querySelectorAll(".pli-menu-label")].map((e) => e.textContent ?? "");
}
