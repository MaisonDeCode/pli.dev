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



const URL_ = "https://example.com/logo.png";
const labels = () => [...document.querySelectorAll(".pli-menu-label")].map((e) => e.textContent ?? "");

describe("a picture's border, shadow and corrections in the grid", () => {
  it("are drawn: a line round it, a shadow behind it that falls the same way when it is turned, and the corrections on the picture", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50, border: { color: "#ff8800", width: 3, dash: "dash" }, shadow: { distance: 10, angle: 0, blur: 4, color: "#000000", opacity: 0.5 }, brightness: 0.5, contrast: -0.25, grayscale: true });
    act(() => root.render(<PliSheet session={s} />));
    const border = q(".pli-grid-imageborder");
    expect(border.style.borderStyle).toBe("dashed");
    expect(border.style.borderWidth).toBe("4px"); // 3 points
    expect(border.style.borderColor).toMatch(/rgb\(255, 136, 0\)|#ff8800/);
    expect(q(".pli-grid-image").style.boxShadow).toContain("10.00px 0.00px 4px");
    const img = q<HTMLImageElement>(".pli-grid-image img");
    expect(img.style.filter).toBe("brightness(1.5) contrast(0.75) grayscale(1)");
  });

  it("keep a shadow pointing the same way on the screen when the picture is turned a quarter", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50, rotation: 90, shadow: { distance: 10, angle: 0 } });
    act(() => root.render(<PliSheet session={s} />));
    const shadow = q(".pli-grid-image").style.boxShadow;
    const [x, y] = shadow.split(" ").map(parseFloat);
    expect(x).toBeCloseTo(0, 1); // the turned box's own x is the screen's y
    expect(Math.abs(y!)).toBeCloseTo(10, 1);
  });

  it("are set in the dialog in one step, and shown back when it is opened again", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50 });
    act(() => root.render(<PliSheet session={s} />));
    key("ArrowDown", { altKey: true, shiftKey: true });
    key("Enter");
    const inputs = () => [...dialog().querySelectorAll<HTMLInputElement>("input")];
    const byLabel = (text: string) => [...dialog().querySelectorAll("label")].find((l) => l.textContent?.trim().startsWith(text))!.querySelector("input")!;
    act(() => void byLabel("Line round the picture").click());
    setField(byLabel("Width (points)"), "2");
    act(() => void byLabel("Shadow behind the picture").click());
    setField(byLabel("Distance (pixels)"), "9");
    setField(byLabel("Brightness"), "30");
    setField(byLabel("Contrast"), "-10");
    act(() => void byLabel("Shades of grey").click());
    expect(inputs().length).toBeGreaterThan(10);
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(s.images("Sheet1")[0]!).toMatchObject({ border: { color: "#000000", width: 2 }, shadow: { distance: 9 }, brightness: 0.3, contrast: -0.1, grayscale: true });
    act(() => s.undo());
    expect(s.images("Sheet1")[0]!.border).toBeUndefined();
    act(() => s.redo());
    key("Enter");
    expect(byLabel("Line round the picture").checked).toBe(true);
    expect(byLabel("Width (points)").value).toBe("2");
    expect(byLabel("Brightness").value).toBe("30");
  });

  it("show in the print preview as they do on the sheet", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50, rotation: 20, crop: { left: 0.2 }, border: { color: "#ff0000" } });
    act(() => root.render(<PliSheet session={s} />));
    choose("File", "Print…");
    const page = document.querySelector(".pli-print-page")!;
    const box = page.querySelector<HTMLElement>(".pli-print-objects > div")!;
    expect(box.style.transform).toBe("rotate(20deg)");
    expect(box.querySelector(".pli-grid-imageborder")).not.toBeNull();
    expect(parseFloat(box.querySelector<HTMLImageElement>("img")!.style.width)).toBeCloseTo(100 / 0.8, 3);
  });
});

describe("cropping by dragging", () => {
  const altDrag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, altKey: true, ...at(from.x, from.y) })));
    pointer("pointermove", at(to.x, to.y));
    pointer("pointerup", at(to.x, to.y));
  };
  const setup = (extra: object = {}) => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50, ...extra });
    act(() => root.render(<PliSheet session={s} />));
    key("ArrowDown", { altKey: true, shiftKey: true });
    return s;
  };
  const img = (s: SheetSession) => s.images("Sheet1")[0]!;

  it("cuts the left edge: the picture keeps its scale, shrinks and its left moves in", () => {
    const s = setup();
    altDrag({ x: 1, y: 25 }, { x: 21, y: 25 }); // the left edge, 20 pixels in
    expect(img(s).crop?.left).toBeCloseTo(0.2, 2);
    expect(img(s).width).toBe(80);
    expect(img(s).height).toBe(50);
    expect(img(s).from.dx).toBe(20);
  });

  it("cuts the bottom right corner on both sides, and pulling out again gives it back", () => {
    const s = setup();
    altDrag({ x: 100, y: 50 }, { x: 50, y: 25 });
    expect(img(s).crop?.right).toBeCloseTo(0.5, 2);
    expect(img(s).crop?.bottom).toBeCloseTo(0.5, 2);
    expect(img(s).width).toBe(50);
    altDrag({ x: 50, y: 25 }, { x: 100, y: 50 });
    expect(img(s).crop).toBeUndefined();
    expect(img(s).width).toBe(100);
    expect(img(s).height).toBe(50);
  });

  it("cuts the other side of a picture that is mirrored, and is one undo step", () => {
    const s = setup({ flipH: true });
    altDrag({ x: 1, y: 25 }, { x: 21, y: 25 });
    expect(img(s).crop?.right).toBeCloseTo(0.2, 2);
    expect(img(s).crop?.left).toBeUndefined();
    s.undo();
    expect(img(s).crop).toBeUndefined();
    expect(img(s).width).toBe(100);
  });

  it("doesn't cut the picture away completely", () => {
    const s = setup();
    altDrag({ x: 1, y: 25 }, { x: 200, y: 25 });
    expect(img(s).crop!.left!).toBeLessThanOrEqual(0.95);
    expect(img(s).width).toBeGreaterThan(0);
  });
});

describe("copying a picture out to other programs", () => {
  it("puts the picture on the clipboard as an image in HTML, with its description as text", () => {
    const s = mount();
    s.addImage("Sheet1", { src: pngUri(100, 50), id: "p", width: 100, height: 50, alt: "A red box" });
    act(() => root.render(<PliSheet session={s} />));
    key("ArrowDown", { altKey: true, shiftKey: true });
    const data = clip();
    copyEvent("copy", data);
    expect(data.store["text/plain"]).toContain("A red box");
    expect(data.store["text/html"]).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="A red box" width="100" height="50">/);
  });
});

describe("pictures from the web", () => {
  it("are turned on and off from the View menu for this session, and the menu shows which", () => {
    const s = mount();
    s.setCell("Sheet1", "B2", `=IMAGE("${URL_}","Our logo")`);
    act(() => root.render(<PliSheet session={s} />));
    expect(host.querySelector(".pli-cell-picture")).toBeNull();
    act(() => void [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "View")!.click());
    const item = () => [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Pictures from the web")!;
    expect(item().getAttribute("aria-checked") ?? item().querySelector("[data-checked]") ?? item().textContent).toBeTruthy();
    act(() => void item().click());
    expect(host.querySelector(`.pli-cell-picture img[src="${URL_}"]`)).not.toBeNull();
    act(() => void [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "View")!.click());
    act(() => void item().click());
    expect(host.querySelector(".pli-cell-picture")).toBeNull();
  });

  it("show the description in place of a picture that doesn't load, and don't ask for it again", () => {
    const s = mount();
    s.setCell("Sheet1", "B2", `=IMAGE("https://example.com/missing-${Math.random().toString(36).slice(2)}.png","Our logo")`);
    act(() => root.render(<PliSheet session={s} remoteImages />));
    const img = q<HTMLImageElement>(".pli-cell-picture img");
    act(() => void img.dispatchEvent(new Event("error")));
    const placeholder = q(".pli-cell-picture-missing");
    expect(placeholder.textContent).toBe("Our logo");
    expect(host.querySelector(".pli-cell-picture img")).toBeNull();
    // Drawn again (a change elsewhere), it goes straight to the placeholder.
    act(() => s.setCell("Sheet1", "D4", "x"));
    expect(host.querySelector(".pli-cell-picture img")).toBeNull();
    expect(q(".pli-cell-picture-missing").textContent).toBe("Our logo");
  });

  it("can be kept in the cell: fetched and put there in the formula's place", async () => {
    const s = mount();
    s.setCell("Sheet1", "A2", `=IMAGE("${URL_}","Our logo")`);
    act(() => root.render(<PliSheet session={s} remoteImages />));
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new Uint8Array(png(20, 10)), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
    try {
      pointer("pointerdown", at(10, 30));
      pointer("pointerup", at(10, 30));
      act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(10, 30) })));
      expect(labels()).toContain("Keep picture in cell");
      act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Keep picture in cell")!.click());
      await flush();
      await flush();
      expect(s.cell("Sheet1", "A2")!.f).toBeUndefined();
      expect(s.cell("Sheet1", "A2")!.picture).toMatchObject({ alt: "Our logo" });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("say when a picture can't be fetched to keep, and leave the formula", async () => {
    const s = mount();
    s.setCell("Sheet1", "A2", `=IMAGE("${URL_}","Our logo")`);
    act(() => root.render(<PliSheet session={s} remoteImages />));
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    try {
      pointer("pointerdown", at(10, 30));
      pointer("pointerup", at(10, 30));
      act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(10, 30) })));
      act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Keep picture in cell")!.click());
      await flush();
      expect(host.querySelector(".pli-notice")!.textContent).toContain("couldn't be fetched");
      expect(s.cell("Sheet1", "A2")!.f).toContain("IMAGE");
    } finally {
      globalThis.fetch = original;
    }
  });
});
