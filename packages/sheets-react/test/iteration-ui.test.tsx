// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
/** Cells are 64 by 20 pixels, after a header of 48 by 24. */
const cellAt = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const setField = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
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
const menuItem = (path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  return [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === path[1]);
};
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const dialogButton = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const notice = () => host.querySelector(".pli-notice")?.textContent ?? "";
const mount = () => {
  const s = new SheetSession(createWorkbook("it"));
  s.setCell("Sheet1", "A1", "=(A1+10)/2");
  act(() => root.render(<PliSheet session={s} />));
  return s;
};

describe("the iterative calculation dialog", () => {
  it("turns it on with the numbers typed, and the cell settles", () => {
    const s = mount();
    expect(s.value("Sheet1", "A1")).not.toBe(10);
    choose("Data", "Iterative calculation…");
    const boxes = [...dialog().querySelectorAll<HTMLInputElement>("input")];
    expect(boxes[0]!.type).toBe("checkbox");
    expect(boxes[0]!.checked).toBe(false);
    expect(boxes[1]!.disabled).toBe(true);
    act(() => void boxes[0]!.click());
    expect(boxes[1]!.disabled).toBe(false);
    expect(boxes[1]!.value).toBe("100");
    setField(boxes[1]!, "300");
    setField(boxes[2]!, "0.000001");
    act(() => void dialogButton("OK").click());
    expect(s.iteration).toEqual({ maxIterations: 300, maxChange: 0.000001 });
    expect(Math.abs((s.value("Sheet1", "A1") as number) - 10)).toBeLessThan(0.00001);
    expect(menuItem(["Data", "Iterative calculation…"])).toBeTruthy();
  });

  it("says why when a number is no good, and turns it off again", () => {
    const s = mount();
    s.setIteration({});
    choose("Data", "Iterative calculation…");
    const boxes = [...dialog().querySelectorAll<HTMLInputElement>("input")];
    expect(boxes[0]!.checked).toBe(true);
    setField(boxes[1]!, "0");
    act(() => void dialogButton("OK").click());
    expect(dialog().querySelector("[role=alert]")!.textContent).toContain("whole number");
    expect(s.iteration).not.toBeNull();
    act(() => void boxes[0]!.click());
    act(() => void dialogButton("OK").click());
    expect(s.iteration).toBeNull();
  });
});
