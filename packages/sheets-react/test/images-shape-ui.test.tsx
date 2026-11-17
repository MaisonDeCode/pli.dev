// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, shapePath } from "@pli.dev/sheets";
import { pictureAsPng } from "../src/PictureView";
import { GIFS, JPEGS } from "../../sheets/test/image-fixtures";
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

function mount(extra: object = {}, src = pngUri(100, 50)) {
  const s = new SheetSession(createWorkbook("t", ["Sheet1"]));
  s.setValues("Sheet1", "A1", [["x"]]);
  s.addImage("Sheet1", { src, id: "p", width: 100, height: 50, ...extra });
  act(() => root.render(<PliSheet session={s} />));
  return s;
}
const pick = () => key("ArrowDown", { altKey: true, shiftKey: true });
const img = (s: SheetSession) => s.images("Sheet1")[0]!;
const cropping = () => host.querySelector(".pli-grid-image[data-cropping]");
const said = () => q(".pli-grid-announce").textContent ?? "";
const rightClick = () => act(() => void scroller().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...at(40, 25) })));

describe("a picture cropped to a shape", () => {
  it("is drawn clipped to the shape's outline, and a plain one is not clipped", () => {
    mount({ shape: "ellipse" });
    const frame = q(".pli-grid-imageframe");
    expect(frame.getAttribute("data-shape")).toBe("ellipse");
    expect(frame.style.clipPath).toBe(`path('${shapePath("ellipse", 100, 50)}')`);
    act(() => root.render(<div />));
    mount();
    expect(q(".pli-grid-imageframe").style.clipPath).toBe("");
    expect(q(".pli-grid-imageframe").hasAttribute("data-shape")).toBe(false);
  });

  it("shows yellow handles on a picked shaped picture; dragging one adjusts the shape (one undo step), keys nudge it, and a plain picture has none", () => {
    const s = mount({ shape: "roundRect", width: 200, height: 100 });
    expect(host.querySelector(".pli-grid-adjhandle")).toBeNull();
    pick();
    const handle = q(".pli-grid-adjhandle");
    expect(handle.getAttribute("role")).toBe("slider");
    // the radius handle sits on the top edge, at the radius (a sixth of the shorter side)
    expect(handle.style.left).toBe("16.667px");
    const frame = q(".pli-grid-adjframe");
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    act(() => void handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 17, clientY: 0 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 0 })));
    // while dragging, the outline follows
    expect(q(".pli-grid-imageframe").style.clipPath).toBe(`path('${shapePath("roundRect", 200, 100, { adj: 30000 })}')`);
    act(() => void window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 30, clientY: 0 })));
    expect(img(s).shapeAdjust).toEqual({ adj: 30000 });
    s.undo();
    expect(img(s).shapeAdjust).toBeUndefined();
    act(() => void q(".pli-grid-adjhandle").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true })));
    expect(img(s).shapeAdjust!.adj!).toBeGreaterThan(16667);
  });

  it("is clipped to the part that is left after a crop, whatever the frame's size", () => {
    mount({ shape: "star5", crop: { left: 0.2 }, width: 80 });
    expect(q(".pli-grid-imageframe").style.clipPath).toBe(`path('${shapePath("star5", 80, 50)}')`);
  });

  it("has its border drawn along the shape and its shadow as a filter that follows it; a rectangle keeps the box shadow", () => {
    mount({ shape: "heart", border: { color: "#ff0000", width: 3 }, shadow: { distance: 6, blur: 8 }, glow: {} });
    expect(host.querySelector("div.pli-grid-imageborder")).toBeNull();
    const path = q<SVGPathElement>("svg.pli-grid-imageborder path");
    expect(path.getAttribute("d")).toBe(shapePath("heart", 100, 50));
    expect(path.getAttribute("stroke")).toBe("#ff0000");
    expect(path.getAttribute("stroke-width")).toBe("4");
    expect(q(".pli-grid-image").style.boxShadow).toBe("");
    const filter = q(".pli-grid-imagefx").style.filter;
    expect(filter).toContain("drop-shadow(0 0");
    expect(filter).toMatch(/drop-shadow\(\d+\.\d+px \d+\.\d+px 4px/);
    act(() => root.render(<div />));
    mount({ border: { color: "#ff0000" }, shadow: {} });
    expect(q(".pli-grid-image").style.boxShadow).not.toBe("");
    expect(host.querySelector("svg.pli-grid-imageborder")).toBeNull();
    expect(host.querySelector("div.pli-grid-imageborder")).not.toBeNull();
  });

  it("is chosen from the right-click menu, Crop to shape, with a tick on the one it has, and Rectangle takes it off", () => {
    const s = mount();
    pick();
    rightClick();
    act(() => void item("Crop to shape")!.click());
    for (const group of ["Rectangles", "Basic shapes", "Block arrows", "Stars"]) expect(item(group), group).toBeDefined();
    expect(item("Rectangle")!.getAttribute("aria-checked")).toBe("true");
    act(() => void item("Basic shapes")!.click());
    act(() => void item("Oval")!.click());
    expect(img(s).shape).toBe("ellipse");
    expect(q(".pli-grid-imageframe").getAttribute("data-shape")).toBe("ellipse");
    rightClick();
    act(() => void item("Crop to shape")!.click());
    expect(item("Rectangle")!.getAttribute("aria-checked")).not.toBe("true");
    act(() => void item("Stars")!.click());
    act(() => void item("Star: 5 points")!.click());
    expect(img(s).shape).toBe("star5");
    s.undo();
    expect(img(s).shape).toBe("ellipse");
    rightClick();
    act(() => void item("Crop to shape")!.click());
    act(() => void item("Rectangle")!.click());
    expect(img(s).shape).toBeUndefined();
  });

  it("has a slider for an artistic effect's level, with the effect's own range, kept in step with the number", () => {
    const s = mount();
    pick();
    key("Enter");
    setField(byLabel<HTMLSelectElement>("Effect", "select"), "paintBrush");
    const slider = dialog().querySelector<HTMLInputElement>('input[type="range"]')!;
    expect([slider.min, slider.max, slider.value]).toEqual(["1", "10", "5"]);
    setField(slider, "8");
    expect(byLabel("Effect level").value).toBe("8");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(img(s).artistic).toEqual({ kind: "paintBrush", level: 8 });
  });

  it("is chosen in Format picture… and kept when the dialog is saved without changes", () => {
    const s = mount({ shape: "hexagon" });
    pick();
    key("Enter");
    const select = byLabel<HTMLSelectElement>("Shape", "select");
    expect(select.value).toBe("hexagon");
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Rectangles", "Basic shapes", "Block arrows", "Stars", "Callouts"]);
    expect(select.querySelectorAll("option")).toHaveLength(37);
    setField(select, "triangle");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(img(s).shape).toBe("triangle");
    pick();
    key("Enter");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(img(s).shape).toBe("triangle");
    key("Enter");
    setField(byLabel<HTMLSelectElement>("Shape", "select"), "");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click());
    expect(img(s).shape).toBeUndefined();
  });
});

describe("cropping from the keyboard", () => {
  it("C puts a picked picture in crop mode, says so, and Enter or Escape leave it", () => {
    mount();
    key("c");
    expect(cropping()).toBeNull(); // nothing is picked yet
    pick();
    expect(said()).toMatch(/^Picture 1 of 1, selected\./);
    expect(said()).toContain("C crops it");
    key("C");
    expect(cropping()).not.toBeNull();
    expect(said()).toMatch(/^Crop mode, picture\./);
    expect(said()).toContain("Arrow keys cut the side they name");
    expect(q(".pli-grid-image").getAttribute("aria-label")).toBe("Picture, crop mode");
    key("Enter");
    expect(cropping()).toBeNull();
    expect(said()).toMatch(/^Crop mode off\./);
    expect(q(".pli-grid-image").getAttribute("aria-label")).toBe("Picture, selected");
    key("c");
    expect(cropping()).not.toBeNull();
    key("Escape");
    expect(cropping()).toBeNull();
    expect(host.querySelector(".pli-grid-image[data-selected]")).not.toBeNull();
  });

  it("C does nothing with Ctrl, Alt or Shift, or on a sheet that can't be changed", () => {
    mount();
    pick();
    key("c", { ctrlKey: true });
    key("c", { altKey: true });
    key("c", { shiftKey: true });
    expect(cropping()).toBeNull();
    act(() => root.render(<div />));
    const s = new SheetSession(createWorkbook("t", ["Sheet1"]));
    s.addImage("Sheet1", { src: pngUri(100, 50), width: 100, height: 50 });
    act(() => root.render(<PliSheet session={s} readOnly />));
    pick();
    key("c");
    expect(cropping()).toBeNull();
  });

  it("an arrow key cuts the side it names, 10 pixels, and the other edges stay where they are; each press is one undo step", () => {
    const s = mount();
    pick();
    key("c");
    key("ArrowLeft");
    expect(img(s).crop!.left).toBeCloseTo(0.1, 4);
    expect(img(s).width).toBe(90);
    expect(img(s).from).toMatchObject({ row: 1, col: 1, dx: 10 }); // the right edge hasn't moved
    expect(said()).toContain("Cut the left.");
    expect(said()).toContain("left 10 percent");
    expect(said()).toContain("The picture is 90 by 50 pixels.");
    key("ArrowRight");
    expect(img(s).crop).toMatchObject({ left: expect.closeTo(0.1, 4), right: expect.closeTo(0.1, 4) });
    expect(img(s).width).toBe(80);
    expect(img(s).from.dx).toBe(10);
    key("ArrowUp");
    key("ArrowDown");
    expect(img(s).height).toBe(30);
    expect(img(s).from.dy).toBe(10);
    expect(img(s).crop!.top).toBeCloseTo(0.2, 4);
    expect(img(s).crop!.bottom).toBeCloseTo(0.2, 4);
    s.undo();
    expect(img(s).crop!.bottom).toBeUndefined();
    s.undo();
    s.undo();
    expect(img(s).crop).toMatchObject({ left: expect.closeTo(0.1, 4) });
    expect(img(s).crop!.right).toBeUndefined();
  });

  it("Shift with an arrow gives back what was cut, Ctrl (or Cmd) makes the step 1 pixel", () => {
    const s = mount({ crop: { left: 0.2, right: 0.2 }, width: 60 });
    pick();
    key("c");
    key("ArrowLeft", { shiftKey: true });
    expect(img(s).crop!.left).toBeCloseTo(0.1, 4);
    expect(img(s).width).toBe(70);
    key("ArrowLeft", { shiftKey: true, ctrlKey: true });
    expect(img(s).crop!.left).toBeCloseTo(0.09, 4);
    expect(img(s).width).toBe(71);
    expect(said()).toContain("Gave back the left.");
    key("ArrowRight", { metaKey: true });
    expect(img(s).crop!.right).toBeCloseTo(0.21, 4);
    expect(img(s).width).toBe(70);
  });

  it("says when there is nothing to give back and when no more can be cut, and changes nothing", () => {
    const s = mount();
    pick();
    key("c");
    const before = JSON.stringify(img(s));
    key("ArrowLeft", { shiftKey: true });
    expect(said()).toBe("Nothing cut off the left to give back.");
    expect(JSON.stringify(img(s))).toBe(before);
    // Nine cuts leave a tenth of the picture; another would leave less than the 8 pixels a frame keeps.
    for (let i = 0; i < 12; i++) key("ArrowLeft");
    expect(img(s).crop!.left).toBeCloseTo(0.9, 4);
    expect(img(s).width).toBe(10);
    expect(said()).toBe("The left can't be cut any more.");
  });

  it("Alt with an arrow slides the picture under the frame, which stays where it is", () => {
    const s = mount({ crop: { left: 0.25, right: 0.25 }, width: 50 });
    pick();
    key("c");
    key("ArrowRight", { altKey: true });
    expect(img(s).crop!.left).toBeCloseTo(0.15, 4); // 10 pixels of a 100 pixel picture
    expect(img(s).crop!.right).toBeCloseTo(0.35, 4);
    expect(img(s).width).toBe(50);
    expect(img(s).from).toMatchObject({ row: 1, col: 1 });
    expect(said()).toContain("Picture slid right.");
    key("ArrowRight", { altKey: true });
    key("ArrowRight", { altKey: true });
    expect(img(s).crop!.left).toBeUndefined();
    expect(img(s).crop!.right).toBeCloseTo(0.5, 4);
    key("ArrowRight", { altKey: true });
    expect(said()).toBe("The picture can't slide any further that way.");
    key("ArrowLeft", { altKey: true, ctrlKey: true });
    expect(img(s).crop!.left).toBeCloseTo(0.01, 4);
  });

  it("a mirrored picture is cut on the side of the picture that is on the named side of the screen", () => {
    const s = mount({ flipH: true });
    pick();
    key("c");
    key("ArrowLeft");
    expect(img(s).crop!.right).toBeCloseTo(0.1, 4);
    expect(img(s).crop!.left).toBeUndefined();
    expect(img(s).from.dx).toBe(10);
  });

  it("without crop mode an arrow moves the picture, as before", () => {
    const s = mount();
    pick();
    key("ArrowRight");
    expect(img(s).from.dx).toBe(10);
    expect(img(s).crop).toBeUndefined();
  });

  it("is refused on a sheet that can't be changed", () => {
    const s = new SheetSession(createWorkbook("t", ["Sheet1"]));
    s.addImage("Sheet1", { src: pngUri(100, 50), width: 100, height: 50, crop: { left: 0.1 } });
    act(() => root.render(<PliSheet session={s} readOnly />));
    pick();
    key("ArrowLeft");
    expect(img(s).crop!.left).toBe(0.1);
  });
});

describe("a picture cropped to a shape, copied out as an image", () => {
  it("is clipped to the shape (mirrored with the picture) and its border follows the shape", () => {
    const calls: string[] = [];
    const paths: string[] = [];
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(public d: string) { paths.push(d); } };
    const ctxOf = () => {
      const c: Record<string, unknown> = {};
      return new Proxy(c, {
        get: (t, name: string) => (name in t ? t[name] : name === "createLinearGradient" ? () => ({ addColorStop: () => {} }) : (...a: unknown[]) => void calls.push(`${name}${name === "scale" ? `(${a.join(",")})` : ""}`)),
        set: (t, name: string, value) => {
          t[name] = value;
          if (name === "globalCompositeOperation") calls.push(`composite=${value}`);
          return true;
        },
      });
    };
    HTMLCanvasElement.prototype.getContext = function () { return ctxOf(); } as never;
    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
    const image = { id: "p", src: "x", from: { row: 1, col: 1 }, width: 100, height: 50, shape: "ellipse", flipH: true, border: { color: "#ff0000" } } as never;
    const el = document.createElement("img");
    Object.defineProperty(el, "complete", { value: true });
    Object.defineProperty(el, "naturalWidth", { value: 100 });
    Object.defineProperty(el, "naturalHeight", { value: 50 });
    expect(pictureAsPng(image, el, 100, 50)).toBe("data:image/png;base64,AAAA");
    expect(paths).toEqual([shapePath("ellipse", 100, 50)]); // one outline, used to clip and to draw the border
    expect(calls).toContain("composite=destination-in");
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke");
    expect(calls).not.toContain("strokeRect");
    expect(calls.filter((c) => c === "scale(-1,1)").length).toBeGreaterThanOrEqual(2);
    delete (globalThis as { Path2D?: unknown }).Path2D;
  });
});

describe("artistic effects on JPEG and GIF pictures in the grid", () => {
  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

  for (const [type, file] of [["jpeg", JPEGS["baseline420"]!.file], ["gif", GIFS["plain"]!.file]] as const) {
    it(`draws a ${type.toUpperCase()} with an effect from the engine's own pixels, as a PNG`, async () => {
      const src = `data:image/${type};base64,${file}`;
      mount({ artistic: { kind: "marker", level: 30 }, width: 94, height: 62 }, src);
      await flush();
      const shown = q<HTMLImageElement>(".pli-grid-image img").getAttribute("src")!;
      expect(shown).toMatch(/^data:image\/png;base64,/);
      expect(shown).not.toBe(src);
    });
  }

  it("offers all twenty-two effects in Format picture…", () => {
    mount();
    pick();
    key("Enter");
    const options = [...byLabel<HTMLSelectElement>("Effect", "select").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toHaveLength(23);
    for (const name of ["Marker", "Chalk sketch", "Cement", "Crisscross etching", "Light screen", "Pastels smooth", "Plastic wrap", "Texturizer", "Watercolor sponge", "Paint strokes"]) expect(options).toContain(name);
  });
});
