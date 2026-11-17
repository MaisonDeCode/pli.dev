// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, encodePng, toDataUri } from "@pli.dev/sheets";
import { PliSheet } from "../src";
import { pictureAsPng } from "../src/PictureView";
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
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const scroller = () => q(".pli-grid-scroller");
const pointer = (type: string, xy: { clientX: number; clientY: number }, init: MouseEventInit = {}) => act(() => void scroller().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init, ...xy })));
/** Cells are 64 by 20 pixels, after a header of 48 by 24. */
const at = (x: number, y: number) => ({ clientX: 48 + x, clientY: 24 + y });
const drag = (from: { x: number; y: number }, to: { x: number; y: number }, init: MouseEventInit = {}) => {
  pointer("pointerdown", at(from.x, from.y), init);
  pointer("pointermove", at(to.x, to.y), init);
  pointer("pointerup", at(to.x, to.y), init);
};
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const item = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = item(name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const setField = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const byLabel = <T extends HTMLElement = HTMLInputElement>(text: string, tag = "input") => [...dialog().querySelectorAll("label")].find((l) => l.textContent?.trim().startsWith(text))!.querySelector<T>(tag)!;
const save = () => act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());

/** A PNG with something in it, so that an effect changes it. */
const busyUri = () => {
  const data = new Uint8ClampedArray(30 * 20 * 4);
  for (let i = 0; i < 600; i++) data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4);
  return toDataUri(encodePng({ width: 30, height: 20, data }), "png");
};

function mount(extra: object = {}, src = pngUri(100, 50)) {
  const s = new SheetSession(createWorkbook("t", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [["x"]]);
  s.addImage("Sheet1", { src, id: "p", width: 100, height: 50, ...extra });
  act(() => root.render(<PliSheet session={s} />));
  return s;
}
const pick = () => key("ArrowDown", { altKey: true, shiftKey: true });
const img = (s: SheetSession) => s.images("Sheet1")[0]!;

describe("glow, soft edges, reflection and artistic effects in the grid", () => {
  it("draw a glow from the picture's shape, soft edges as a fade at the sides, and a reflection under the picture", () => {
    mount({ glow: { color: "#ff0000", radius: 12, opacity: 0.5 }, softEdge: 8, reflection: { distance: 6, size: 0.5, startOpacity: 0.6, blur: 2 } });
    const fx = q(".pli-grid-imagefx");
    expect(fx.hasAttribute("data-glow")).toBe(true);
    expect(fx.style.filter).toContain("drop-shadow(0 0 6px rgba(255, 0, 0, 0.5)) drop-shadow(0 0 12px rgba(255, 0, 0, 0.5))");
    const frame = q(".pli-grid-imagefx .pli-grid-imageframe");
    expect(frame.getAttribute("style")).toContain("linear-gradient(to right, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)");
    const mirror = q(".pli-grid-imagereflect");
    expect(mirror.style.top).toBe("56px"); // the picture's height and the distance
    expect(mirror.style.height).toBe("50px");
    expect(mirror.getAttribute("style")).toContain("rgba(0, 0, 0, 0.6) 0%");
    expect(mirror.getAttribute("style")).toContain("blur(2px)");
    expect((mirror.firstElementChild as HTMLElement).style.transform).toBe("scaleY(-1)");
    expect(host.querySelectorAll(".pli-grid-image img")).toHaveLength(2);
  });

  it("draw nothing extra for a plain picture, and keep the soft edge to half the picture", () => {
    mount();
    expect(host.querySelector(".pli-grid-imagereflect")).toBeNull();
    expect(q(".pli-grid-imagefx").hasAttribute("data-glow")).toBe(false);
    expect(q(".pli-grid-imageframe").getAttribute("style") ?? "").not.toContain("gradient");
    act(() => root.unmount());
    root = createRoot(host);
    mount({ softEdge: 100 });
    expect(q(".pli-grid-imageframe").getAttribute("style")).toContain("#000 25px"); // half the 50 pixel height at most... the width's is 50
  });

  it("show an artistic effect as a copy of the picture with the effect drawn, a moment after", async () => {
    const src = busyUri();
    mount({ artistic: { kind: "mosaic", level: 90 } }, src);
    expect(q<HTMLImageElement>(".pli-grid-image img").getAttribute("src")).toBe(src);
    await flush();
    const drawn = q<HTMLImageElement>(".pli-grid-image img").getAttribute("src")!;
    expect(drawn).toMatch(/^data:image\/png;base64,/);
    expect(drawn).not.toBe(src);
  });

  it("show in the print preview too", () => {
    mount({ glow: {}, reflection: {}, softEdge: 5 });
    choose("File", "Print…");
    const box = document.querySelector(".pli-print-page .pli-print-objects > div")!;
    expect(box.querySelector(".pli-grid-imagefx[data-glow]")).not.toBeNull();
    expect(box.querySelector(".pli-grid-imagereflect")).not.toBeNull();
  });

  it("are set in the Format picture dialog, undone in one step, and shown again when it is opened", () => {
    const s = mount();
    pick();
    key("Enter");
    act(() => void byLabel<HTMLInputElement>("Glow round the picture").click());
    setField(byLabel("Glow size"), "20");
    setField(byLabel("Glow transparency"), "25");
    setField(byLabel("Soft edge size"), "6");
    act(() => void byLabel<HTMLInputElement>("Reflection under the picture").click());
    setField(byLabel("Reflection size"), "40");
    setField(byLabel("Reflection distance"), "3");
    setField(byLabel<HTMLSelectElement>("Effect", "select"), "pencilSketch");
    expect(byLabel("Effect level").value).toBe("25");
    setField(byLabel("Effect level"), "60");
    save();
    expect(img(s)).toMatchObject({ glow: { radius: 20, opacity: 0.75 }, softEdge: 6, reflection: { size: 0.4, distance: 3 }, artistic: { kind: "pencilSketch", level: 60 } });
    act(() => s.undo());
    expect([img(s).glow, img(s).softEdge, img(s).reflection, img(s).artistic]).toEqual([undefined, undefined, undefined, undefined]);
    act(() => s.redo());
    key("Enter");
    expect(byLabel("Glow size").value).toBe("20");
    expect(byLabel("Glow transparency").value).toBe("25");
    expect(byLabel("Soft edge size").value).toBe("6");
    expect(byLabel("Reflection distance").value).toBe("3");
    expect(byLabel<HTMLSelectElement>("Effect", "select").value).toBe("pencilSketch");
    expect(byLabel("Effect level").value).toBe("60");
  });

  it("are not saved from the dialog with a level the effect doesn't have (the field says so), and nothing changes", () => {
    const s = mount();
    pick();
    key("Enter");
    setField(byLabel<HTMLSelectElement>("Effect", "select"), "cutout");
    setField(byLabel("Effect level"), "40");
    expect(byLabel("Effect level").getAttribute("max")).toBe("6");
    save();
    expect(img(s).artistic).toBeUndefined();
  });

  it("a dialog save keeps the shadow's colour and opacity", () => {
    const s = mount({ shadow: { color: "#336699", opacity: 0.8 } });
    pick();
    key("Enter");
    save();
    expect(img(s).shadow).toMatchObject({ color: "#336699", opacity: 0.8 });
  });
});

describe("the crop tool", () => {
  const cropping = () => host.querySelector(".pli-grid-image[data-cropping]");
  const setup = (extra: object = {}) => {
    const s = mount(extra);
    pick();
    return s;
  };

  it("is turned on from the picture's context menu: the whole picture shows dimmed and the handles become crop marks", () => {
    const s = setup({ crop: { left: 0.2 }, width: 80 });
    act(() => void scroller().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(40, 25) })));
    expect(item("Crop")).toBeDefined();
    expect(item("Crop to shape")).toBeDefined();
    act(() => void item("Crop")!.click());
    expect(cropping()).not.toBeNull();
    const full = q(".pli-grid-cropfull");
    expect(parseFloat(full.style.width)).toBeCloseTo(100, 3); // the whole picture: 80 is 80% of it
    expect(parseFloat(full.style.left)).toBeCloseTo(-20, 3);
    expect(host.querySelectorAll(".pli-grid-cropmark")).toHaveLength(12); // 4 corners with two bars, 4 edges with one
    expect(host.querySelector(".pli-grid-charthandle")).toBeNull();
    expect(img(s).crop).toMatchObject({ left: 0.2 });
    // The menu says it is on.
    act(() => void scroller().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(40, 25) })));
    expect(item("Crop")!.getAttribute("aria-checked")).toBe("true");
  });

  it("is turned on from Format > Picture and the toolbar, and off again with Enter, Escape or the same command", () => {
    setup();
    choose("Format", "Picture", "Crop");
    expect(cropping()).not.toBeNull();
    key("Enter");
    expect(cropping()).toBeNull();
    expect(host.querySelector(".pli-grid-image[data-selected]")).not.toBeNull(); // still picked
    const button = () => host.querySelector<HTMLButtonElement>('button[aria-label="Crop picture"]')!;
    act(() => void button().click());
    expect(cropping()).not.toBeNull();
    expect(button().getAttribute("aria-pressed")).toBe("true");
    key("Escape");
    expect(cropping()).toBeNull();
    expect(host.querySelector(".pli-grid-image[data-selected]")).not.toBeNull();
    act(() => void button().click());
    act(() => void button().click());
    expect(cropping()).toBeNull();
  });

  it("is off for the toolbar button until a picture is picked, and for a sheet that is read only", () => {
    mount();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Crop picture"]')!.disabled).toBe(true);
    pick();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Crop picture"]')!.disabled).toBe(false);
  });

  it("crops by dragging an edge with no Alt held, as one undo step; the picture keeps its scale", () => {
    const s = setup();
    choose("Format", "Picture", "Crop");
    drag({ x: 1, y: 25 }, { x: 21, y: 25 });
    expect(img(s).crop?.left).toBeCloseTo(0.2, 2);
    expect(img(s).width).toBe(80);
    expect(cropping()).not.toBeNull(); // still in crop mode
    drag({ x: 100, y: 50 }, { x: 60, y: 25 });
    expect(img(s).crop?.right).toBeCloseTo(0.4, 2);
    s.undo();
    expect(img(s).crop?.right).toBeUndefined();
    expect(img(s).crop?.left).toBeCloseTo(0.2, 2);
  });

  it("moves the picture under the frame when it is dragged inside, keeping the frame where it is", () => {
    const s = setup({ crop: { left: 0.25, right: 0.25 }, width: 50 });
    choose("Format", "Picture", "Crop");
    drag({ x: 25, y: 25 }, { x: 35, y: 25 }); // the picture moves 10 pixels right: it shows more of its left
    expect(img(s).crop!.left).toBeCloseTo(0.15, 2);
    expect(img(s).crop!.right).toBeCloseTo(0.35, 2);
    expect(img(s).width).toBe(50);
    expect(img(s).from).toMatchObject({ row: 1, col: 1 });
    drag({ x: 25, y: 25 }, { x: -300, y: 25 }); // as far as the picture goes
    expect(img(s).crop!.left).toBeCloseTo(0.5, 2);
    expect(img(s).crop!.right).toBeUndefined();
  });

  it("moves the picture the other way when it is mirrored", () => {
    const s = setup({ crop: { left: 0.25, right: 0.25 }, width: 50, flipH: true });
    choose("Format", "Picture", "Crop");
    drag({ x: 25, y: 25 }, { x: 35, y: 25 });
    expect(img(s).crop!.left).toBeCloseTo(0.35, 2);
  });

  it("without crop mode, dragging inside moves the picture and an edge resizes it; Alt on an edge still crops", () => {
    const s = setup();
    drag({ x: 50, y: 25 }, { x: 60, y: 25 });
    expect(img(s).from.dx).toBe(10);
    expect(img(s).crop).toBeUndefined();
    act(() => void scroller().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, altKey: true, ...at(11, 25) })));
    pointer("pointermove", at(31, 25), { altKey: true });
    pointer("pointerup", at(31, 25), { altKey: true });
    expect(img(s).crop?.left).toBeCloseTo(0.2, 2);
  });

  it("ends when another thing is picked or a click lands on the cells", () => {
    setup();
    choose("Format", "Picture", "Crop");
    drag({ x: 300, y: 200 }, { x: 300, y: 200 });
    expect(cropping()).toBeNull();
  });

  it("crops to a shape from the menus: a ratio, fill and fit", () => {
    const s = setup();
    choose("Format", "Picture", "Crop to shape", "Square (1:1)");
    expect([img(s).width, img(s).height]).toEqual([50, 50]);
    expect(img(s).crop!.left).toBeCloseTo(0.25, 3);
    choose("Format", "Picture", "Crop to shape", "Fit in the frame");
    expect(img(s).crop).toBeUndefined();
    expect([img(s).width, img(s).height]).toEqual([50, 25]);
    act(() => void scroller().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(20, 10) })));
    act(() => void item("Crop to shape")!.click());
    act(() => void item("Widescreen 16:9")!.click());
    expect(img(s).width / img(s).height).toBeCloseTo(16 / 9, 1);
    choose("Format", "Picture", "Remove crop");
    expect(img(s).crop).toBeUndefined();
  });

  it("is turned on from the Format picture dialog's Crop on the sheet button, after saving what was changed in it", () => {
    const s = setup();
    key("Enter");
    setField(byLabel("Soft edge size"), "4");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Crop on the sheet")!.click());
    expect(img(s).softEdge).toBe(4);
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(cropping()).not.toBeNull();
  });

  it("Remove effects takes the glow, soft edges, reflection, artistic effect and shadow off in one step", () => {
    const s = mount({ glow: {}, softEdge: 3, reflection: {}, artistic: { kind: "blur" }, shadow: {} });
    pick();
    choose("Format", "Picture", "Remove effects");
    expect([img(s).glow, img(s).softEdge, img(s).reflection, img(s).artistic, img(s).shadow]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    s.undo();
    expect(img(s).glow).toBeDefined();
  });
});

describe("a picture copied out as an image with its effects", () => {
  it("draws the glow with the canvas's shadow and the reflection mirrored below, in a bigger picture", () => {
    const calls: string[] = [];
    const ctxOf = () => {
      const c: Record<string, unknown> = {};
      return new Proxy(c, {
        get: (t, name: string) => (name in t ? t[name] : name === "createLinearGradient" ? () => ({ addColorStop: () => calls.push("stop") }) : (...a: unknown[]) => void calls.push(`${name}`)),
        set: (t, name: string, value) => {
          t[name] = value;
          if (name === "shadowBlur") calls.push(`shadowBlur=${value}`);
          return true;
        },
      });
    };
    const sizes: { w: number; h: number }[] = [];
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      sizes.push({ w: this.width, h: this.height });
      return ctxOf();
    } as never;
    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
    const image = { id: "p", src: "x", from: { row: 1, col: 1 }, width: 100, height: 50, glow: { radius: 10 }, reflection: { size: 0.5, distance: 4 }, softEdge: 5 } as never;
    const el = Object.assign(document.createElement("img"), {}) as HTMLImageElement;
    Object.defineProperty(el, "complete", { value: true });
    Object.defineProperty(el, "naturalWidth", { value: 100 });
    Object.defineProperty(el, "naturalHeight", { value: 50 });
    expect(pictureAsPng(image, el, 100, 50)).toBe("data:image/png;base64,AAAA");
    expect(calls).toContain("shadowBlur=20"); // 10 pixels at the 2 times scale
    expect(calls.filter((c) => c === "drawImage").length).toBeGreaterThanOrEqual(6); // the picture, the mirror and the glow twice, then the picture itself
    // The first canvas is the result: room for the glow (and the reflection's blur) all round and the reflection (4 + 25) below the picture.
    expect(sizes[0]!.w).toBe((100 + 2 * 16) * 2);
    expect(sizes[0]!.h).toBe((50 + 2 * 16 + 4 + 25) * 2);
  });
});
