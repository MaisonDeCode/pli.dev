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
const pointer = (type: string, xy: { clientX: number; clientY: number }, init: MouseEventInit = {}) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy, ...init })));
const click = (xy: { clientX: number; clientY: number }, init: MouseEventInit = {}) => (pointer("pointerdown", xy, init), pointer("pointerup", xy, init));
/** Cells are 64 by 20 pixels, after a header of 48 by 24. */
const cellAt = (row: number, col: number, dx = 10, dy = 10) => ({ clientX: 48 + (col - 1) * 64 + dx, clientY: 24 + (row - 1) * 20 + dy });
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const labels = () => [...document.querySelectorAll(".pli-menu-label")].map((e) => e.textContent);
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}" in ${labels().join(", ")}`);
    act(() => void hit.click());
  }
};
const setField = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const texts = () => [...host.querySelectorAll(".pli-cell")].map((e) => e.textContent);
const dialogButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find((b) => b.textContent === text)!;

function mount(setup: (s: SheetSession) => void) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]), { now: () => 45000 });
  session.setValues("Sheet1", "A1", [
    ["Region", "Item", "Qty", "Total"],
    ["West", "Pens", 10, null],
    ["East", "Paper", 4, null],
    ["West", "Ink", 2, null],
    ["North", "Pens", 7, null],
  ]);
  session.createTable("Sheet1", "A1:D5", { name: "Sales" });
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("slicer styles of your own", () => {
  it("are made from the slicer's settings, with a sample, given to the slicer and drawn", () => {
    const s = mount((x) => x.addSlicer("Sheet1", { table: "Sales", column: "Item", from: { row: 8, col: 1 } }));
    const menu = () => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 48 + 20, clientY: 24 + 9 * 20 + 10 })));
    menu();
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent === "Slicer settings\u2026")!.click());
    act(() => void dialogButton("New slicer style\u2026").click());
    expect(document.querySelector("dialog[open]")!.textContent).toContain("New slicer style");
    setField(document.querySelector<HTMLInputElement>("dialog[open] input[type=text]")!, "Harbor");
    const field = (label: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`dialog[open] [aria-label="${label}"]`)!;
    // The selected buttons: a fill and bold; the sample (a slicer) follows.
    expect(field("Part").value).toBe("selectedItemWithData");
    setField(field("Fill") as HTMLInputElement, "#6aa6e3");
    act(() => void (field("Bold") as HTMLInputElement).click());
    const sample = () => [...document.querySelectorAll<HTMLElement>("dialog[open] .pli-slicer-item")];
    expect(sample().some((e) => e.style.background.includes("106, 166, 227") && e.style.fontWeight === "700")).toBe(true);
    setField(field("Part") as HTMLSelectElement, "headerRow");
    setField(field("Fill") as HTMLInputElement, "#1f3a5f");
    expect(document.querySelector<HTMLElement>("dialog[open] .pli-slicer-head")!.style.background).toContain("31, 58, 95");
    act(() => void dialogButton("Done").click());
    expect(s.slicerStyles()["Harbor"]).toEqual({ selectedItemWithData: { fill: "#6aa6e3", bold: true }, headerRow: { fill: "#1f3a5f" } });
    expect(s.slicers("Sheet1")[0]!.style).toBe("Harbor");
    // The slicer in the grid is drawn in it: every button is let through, so each is a "selected item with data".
    const items = [...host.querySelectorAll<HTMLElement>(".pli-slicer-item")];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.style.background.includes("106, 166, 227"))).toBe(true);
    expect(q(".pli-slicer-head").style.background).toContain("31, 58, 95");
    // It can be changed from the settings again, and a name already taken is refused.
    menu();
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent === "Slicer settings\u2026")!.click());
    act(() => void dialogButton("Edit this style\u2026").click());
    expect(document.querySelector<HTMLInputElement>("dialog[open] input[type=text]")!.value).toBe("Harbor");
    act(() => void dialogButton("Cancel").click());
  });
});
