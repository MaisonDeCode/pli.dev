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

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
  session.setValues("Sheet1", "A1", [["x"]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("pictures in the grid", () => {
  it("are inserted from the Insert menu at the active cell, drawn, selected and described by their file's name", async () => {
    const s = mount();
    choose("Insert", "Image…");
    const input = q<HTMLInputElement>("input[aria-label='Insert an image']");
    Object.defineProperty(input, "files", { configurable: true, value: [file("team-photo_2024.png", png(100, 50))] });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(s.images("Sheet1")).toHaveLength(1);
    expect(s.images("Sheet1")[0]).toMatchObject({ from: { row: 1, col: 1 }, width: 100, height: 50, alt: "team photo 2024" });
    const img = q<HTMLImageElement>(".pli-grid-image img");
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(img.alt).toBe("team photo 2024");
    expect(q(".pli-grid-image").hasAttribute("data-selected")).toBe(true);
    expect(host.querySelectorAll(".pli-grid-charthandle")).toHaveLength(8);
  });

  it("say so when a file isn't a picture they can keep", async () => {
    const s = mount();
    choose("Insert", "Image…");
    const input = q<HTMLInputElement>("input[aria-label='Insert an image']");
    Object.defineProperty(input, "files", { configurable: true, value: [file("notes.txt", new TextEncoder().encode("hello"), "text/plain")] });
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();
    expect(s.images("Sheet1")).toHaveLength(0);
    expect(host.textContent).toMatch(/PNG, JPEG and GIF/);
  });

  it("are moved by dragging, in one undo step, and stay where they were dropped", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", from: { row: 1, col: 1 }, width: 100, height: 50 });
    act(() => root.render(<PliSheet session={s} />));
    drag({ x: 50, y: 25 }, { x: 50 + 64 + 10, y: 25 + 40 + 5 });
    expect(s.images("Sheet1")[0]!.from).toEqual({ row: 3, col: 2, dx: 10, dy: 5 });
    expect(s.images("Sheet1")[0]).toMatchObject({ width: 100, height: 50 });
    act(() => s.undo());
    expect(s.images("Sheet1")[0]!.from).toEqual({ row: 1, col: 1 });
  });

  it("keep their proportions when a corner is dragged, and not when an edge is", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", from: { row: 1, col: 1 }, width: 100, height: 50 });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", at(50, 25));
    pointer("pointerup", at(50, 25)); // select it
    drag({ x: 100, y: 50 }, { x: 150, y: 50 }); // the bottom right corner, pulled to the right only
    expect(s.images("Sheet1")[0]).toMatchObject({ width: 150, height: 75 });
    drag({ x: 150, y: 37 }, { x: 200, y: 37 }); // the right edge
    expect(s.images("Sheet1")[0]).toMatchObject({ width: 200, height: 75 });
    drag({ x: 1, y: 1 }, { x: 41, y: 31 }); // the top left corner shrinks it towards its bottom right
    const p = s.images("Sheet1")[0]!;
    expect(p.width / p.height).toBeCloseTo(200 / 75, 1);
    expect(p.width).toBeLessThan(200);
  });

  it("are deleted with the Delete key and the right-click menu, and described from it", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50 });
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "q", from: { row: 5, col: 1 }, width: 100, height: 50 });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", at(50, 25));
    pointer("pointerup", at(50, 25));
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(50, 25) })));
    const labels = [...document.querySelectorAll(".pli-menu-label")].map((e) => e.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Format picture…", "Copy", "Cut", "Rotate right 90°", "Flip horizontally", "Fit to the selected cells", "Original size", "Duplicate", "Bring to front", "Send to back", "Delete picture"]));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent?.startsWith("Format picture"))!.click());
    const dialog = document.querySelector("dialog[open]")!;
    const box = dialog.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "A red box");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(s.images("Sheet1").find((i) => i.id === "p")!.alt).toBe("A red box");
    key("Delete");
    expect(s.images("Sheet1").map((i) => i.id)).toEqual(["q"]);
    act(() => s.undo());
    expect(s.images("Sheet1").map((i) => i.id)).toEqual(["p", "q"]);
  });

  it("are inserted by pasting a picture, but not when cells were copied (which put a picture of them there too)", async () => {
    const s = mount();
    const paste = (data: Record<string, string>, files: File[]) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: (t: string) => data[t] ?? "", files } });
      act(() => void sink().dispatchEvent(event));
    };
    paste({}, [file("shot.png", png(60, 40))]);
    await flush();
    expect(s.images("Sheet1")).toHaveLength(1);
    paste({ "text/plain": "a\tb", "text/html": "<table><tr><td>a</td><td>b</td></tr></table>" }, [file("range.png", png(60, 40))]);
    await flush();
    expect(s.images("Sheet1")).toHaveLength(1);
    expect(s.value("Sheet1", "A1")).toBe("a");
  });

  it("are not draggable or deletable on a read-only sheet", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50 });
    act(() => root.render(<PliSheet session={s} readOnly />));
    expect(host.querySelectorAll(".pli-grid-image")).toHaveLength(1);
    drag({ x: 50, y: 25 }, { x: 150, y: 80 });
    expect(s.images("Sheet1")[0]!.from).toEqual({ row: 1, col: 1 });
    key("Delete");
    expect(s.images("Sheet1")).toHaveLength(1);
    expect(host.querySelectorAll(".pli-grid-charthandle")).toHaveLength(0);
  });
});
