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
  session.setValues("Sheet1", "A6", [[45000, 45001, 45002, 45010]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}
const xs = () => [...sparks()[0]!.querySelector("polyline")!.getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[0]))];

describe("sparklines with a date axis in the dialog", () => {
  it("are plotted by date when asked, with the range of dates typed as on the sheet", () => {
    const s = mount();
    click(2, 1);
    key("ArrowRight", { shiftKey: true, ctrlKey: true });
    choose("Insert", "Sparklines…");
    setField(field("Location range"), "E2");
    expect(dialog().querySelector('[aria-label="Date range"]')).toBeNull();
    act(() => void field("Plot by date").click());
    act(() => void dialogButton("Insert").click());
    expect(dialog().textContent).toContain("Say which cells hold the dates");
    setField(field("Date range"), "A6:D6");
    act(() => void dialogButton("Insert").click());
    expect(s.sparklines("Sheet1")[0]!.dateAxis).toBe("Sheet1!$A$6:$D$6");
    const x = xs();
    expect(x[1]! - x[0]!).toBeCloseTo(x[2]! - x[1]!, 3);
    expect(x[3]! - x[2]!).toBeGreaterThan(5 * (x[1]! - x[0]!));
  });

  it("show the dates of a group they are plotted by, and go back to even spacing when that is turned off", () => {
    const s = mount();
    s.addSparklines("Sheet1", { id: "g", location: "E2", data: "A2:D2", dateAxis: "A6:D6" });
    act(() => root.render(<PliSheet session={s} />));
    click(2, 5);
    choose("Insert", "Sparklines…");
    expect(field("Plot by date")).toMatchObject({ checked: true });
    expect(field("Date range").value).toBe("A6:D6");
    act(() => void field("Plot by date").click());
    act(() => void dialogButton("Save").click());
    expect(s.sparklines("Sheet1")[0]!.dateAxis).toBeUndefined();
    const x = xs();
    expect(x[3]! - x[2]!).toBeCloseTo(x[1]! - x[0]!, 3);
  });
});

describe("sparklines coloured from the theme in the dialog", () => {
  it("take a colour of the theme and a shade of it, drawn from the workbook's palette", () => {
    const s = mount();
    s.addSparklines("Sheet1", { id: "g", location: "E2", data: "A2:D2", high: true });
    act(() => root.render(<PliSheet session={s} />));
    click(2, 5);
    choose("Insert", "Sparklines…");
    expect(field("Line colour: shade")).toBeNull();
    setField(field("Line colour: colour of the theme"), "4");
    setField(field("Line colour: shade"), "-0.5");
    setField(field("High point colour: colour of the theme"), "5");
    act(() => void dialogButton("Save").click());
    expect(s.sparklines("Sheet1")[0]).toMatchObject({ color: { theme: 4, tint: -0.5 }, highColor: { theme: 5 } });
    expect(sparks()[0]!.querySelector("polyline")!.getAttribute("stroke")).toBe("#203764");
    expect(sparks()[0]!.querySelector("circle")!.getAttribute("fill")).toBe("#ed7d31");
  });

  it("show a theme colour as it is, offer a colour of your own again, and keep Excel's own colour as left out", () => {
    const s = mount();
    s.addSparklines("Sheet1", { id: "g", location: "E2", data: "A2:D2", color: { theme: 5, tint: 0.4 } });
    act(() => root.render(<PliSheet session={s} />));
    click(2, 5);
    choose("Insert", "Sparklines…");
    expect(field("Line colour: colour of the theme").value).toBe("5");
    expect(field("Line colour: shade").value).toBe("0.4");
    expect(field("Line colour").value).toBe("#f4b084");
    setField(field("Line colour: colour of the theme"), "custom");
    expect(field("Line colour: shade")).toBeNull();
    expect(field("Line colour").value).toBe("#f4b084");
    setField(field("Line colour"), "#376092");
    act(() => void dialogButton("Save").click());
    expect(s.sparklines("Sheet1")[0]!.color).toBeUndefined();
  });
});

describe("the SPARKLINE function in the grid", () => {
  it("draws a chart over the cell that holds the formula, and stops when the formula goes", () => {
    const s = mount();
    act(() => s.setCell("Sheet1", "F2", '=SPARKLINE(A2:D2,{"charttype","column"})'));
    expect(sparks()).toHaveLength(1);
    expect(sparks()[0]!.querySelector("rect")).toBeTruthy();
    act(() => s.setCell("Sheet1", "F2", "=SPARKLINE(A3:D3)"));
    expect(sparks()[0]!.querySelector("polyline")).toBeTruthy();
    act(() => s.setCell("Sheet1", "F2", "plain"));
    expect(sparks()).toHaveLength(0);
  });
});
