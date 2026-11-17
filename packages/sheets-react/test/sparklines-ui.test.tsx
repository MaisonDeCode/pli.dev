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
const sparks = () => host.querySelectorAll(".pli-cell-spark");

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
  session.setValues("Sheet1", "A1", [["Q1", "Q2", "Q3", "Q4"], [1, 3, 2, 5], [4, -1, 2, 3], [7, 7, 7, 7]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("sparklines in the grid", () => {
  it("are made for the selected data from the Insert menu, with the cells beside it suggested, and drawn in the cells", () => {
    const s = mount();
    click(2, 1);
    key("ArrowRight", { shiftKey: true, ctrlKey: true });
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    choose("Insert", "Sparklines…");
    expect(dialog().textContent).toContain("Insert sparklines");
    expect(field("Data range").value).toBe("A2:D4");
    expect(field("Location range").value).toBe("E2:E4");
    act(() => void dialogButton("Insert").click());
    expect(s.sparklines("Sheet1")).toHaveLength(1);
    expect(s.sparklines("Sheet1")[0]!.items.map((i) => i.cell)).toEqual(["E2", "E3", "E4"]);
    expect(sparks()).toHaveLength(3);
    expect(sparks()[0]!.querySelector("polyline")).toBeTruthy();
    act(() => void s.undo());
    expect(sparks()).toHaveLength(0);
  });

  it("say why when the data and the cells don't fit, and what is asked of a column or win/loss look", () => {
    const s = mount();
    choose("Insert", "Sparklines…");
    act(() => void dialogButton("Insert").click());
    expect(dialog().textContent).toContain("Say which cells hold the data");
    setField(field("Data range"), "A2:D4");
    setField(field("Location range"), "F2:F3");
    act(() => void dialogButton("Insert").click());
    expect(dialog().textContent).toContain("2 cells need 2 rows");
    setField(field("Location range"), "F2:F4");
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[name=sparktype]")][1]!.click());
    expect(dialog().querySelector('[aria-label="Dot colour"]')).toBeNull();
    act(() => void dialogButton("Insert").click());
    expect(s.sparklines("Sheet1")[0]!.type).toBe("column");
    expect(sparks()[0]!.querySelector("rect")).toBeTruthy();
  });

  it("are changed from a cell they are in, with the look saved and put back to Excel's when it is left out", () => {
    const s = mount();
    s.addSparklines("Sheet1", { id: "g", location: "E2:E4", data: "A2:D4", color: "#336699", markers: true });
    act(() => root.render(<PliSheet session={s} />));
    click(3, 5);
    choose("Insert", "Sparklines…");
    expect(dialog().textContent).toContain("Sparklines");
    expect(dialog().querySelector('[aria-label="Data range"]')).toBeNull();
    expect(field("Line colour").value).toBe("#336699");
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((b) => b.parentElement!.textContent!.includes("High point"))!.click());
    setField(field("High point colour"), "#00aa00");
    setField(field("Line colour"), "#376092"); // Excel's own: not kept
    setField(field("Least on the axis"), "custom");
    setField(field("Least value"), "-5");
    setField(field("Empty cells"), "span");
    act(() => void dialogButton("Save").click());
    expect(s.sparklines("Sheet1")[0]).toMatchObject({ id: "g", high: true, highColor: "#00aa00", markers: true, min: -5, emptyAs: "span" });
    expect(s.sparklines("Sheet1")[0]!.color).toBeUndefined();
  });

  it("are removed from the dialog, and cleared from the cells of a selection from the Edit menu", () => {
    const s = mount();
    s.addSparklines("Sheet1", { id: "g", location: "E2:E4", data: "A2:D4" });
    act(() => root.render(<PliSheet session={s} />));
    click(2, 5);
    key("ArrowDown", { shiftKey: true });
    choose("Edit", "Clear sparklines");
    expect(s.sparklines("Sheet1")[0]!.items.map((i) => i.cell)).toEqual(["E4"]);
    click(4, 5);
    choose("Insert", "Sparklines…");
    act(() => void dialogButton("Remove sparklines").click());
    expect(s.sparklines("Sheet1")).toEqual([]);
    expect(sparks()).toHaveLength(0);
  });

  it("are in print preview, over their cells", () => {
    const s = mount();
    s.addSparklines("Sheet1", { location: "E2:E4", data: "A2:D4", type: "column" });
    act(() => root.render(<PliSheet session={s} />));
    choose("File", "Print…");
    const page = document.querySelector(".pli-print-page")!;
    expect(page.querySelectorAll("svg rect").length).toBeGreaterThan(0);
    expect(page.querySelectorAll("td svg")).toHaveLength(3);
  });
});
