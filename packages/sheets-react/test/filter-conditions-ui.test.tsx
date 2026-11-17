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

function mount(setup: (s: SheetSession) => void = () => {}) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]), { now: () => 45_000.5 });
  session.setValues("Sheet1", "A1", [
    ["Region", "Item", "Qty", "Day"],
    ["West", "Pens", 10, 45_000],
    ["East", "Paper", 4, 44_900],
    ["West", "Ink", 2, 45_001],
    ["North", "Pens", 7, 44_000],
  ]);
  session.createTable("Sheet1", "A1:D5", { name: "Sales" });
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}
const menuItem = (text: string) => [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-filtermenu .pli-menu-item")].find((b) => b.textContent === text)!;
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const field = (label: string) => dialog().querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
const hidden = (s: SheetSession) => [2, 3, 4, 5].filter((r) => s.sheet("Sheet1").rows?.[String(r)]?.hidden);

describe("filtering by condition in the grid", () => {
  it("opens from a table's filter button, filters by a text condition, and marks the button", () => {
    const s = mount();
    click(cellAt(1, 1, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    expect(dialog().textContent).toContain("Filter Region by condition");
    setField(field("First comparison"), "beginsWith");
    setField(field("First value"), "w");
    act(() => void dialogButton("OK").click());
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: { kind: "custom", a: { op: "beginsWith", value: "w" } } });
    expect(hidden(s)).toEqual([3, 5]);
    expect(host.querySelector(".pli-grid-filterbtn[data-on]")).toBeTruthy();
    // The menu says what the filter does, and clears it.
    click(cellAt(1, 1, 64 - 8, 12));
    expect(q(".pli-grid-filterrule").textContent).toBe("begins with w");
    act(() => void menuItem("Clear filter from \u201CRegion\u201D").click());
    expect(hidden(s)).toEqual([]);
  });

  it("filters by two numbers joined by and, with a second condition added and taken away", () => {
    const s = mount();
    click(cellAt(1, 3, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    setField(field("First comparison"), "greaterThan");
    setField(field("First value"), "3");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add a second condition")!.click());
    setField(field("Second comparison"), "lessThan");
    setField(field("Second value"), "8");
    act(() => void dialogButton("OK").click());
    expect(s.tables("Sheet1")[0]!.filters!["Qty"]).toEqual({ kind: "custom", a: { op: "greaterThan", value: "3" }, b: { op: "lessThan", value: "8" } });
    expect(hidden(s)).toEqual([2, 4]);
    // The dialog opens on the filter as it is.
    click(cellAt(1, 3, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    expect((field("Second value") as HTMLInputElement).value).toBe("8");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Remove the second condition")!.click());
    act(() => void dialogButton("OK").click());
    expect(hidden(s)).toEqual([4]);
  });

  it("filters by the top or the bottom, above average, and a period of dates", () => {
    const s = mount();
    click(cellAt(1, 3, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    setField(field("Kind of condition"), "top");
    setField(field("How many"), "2");
    act(() => void dialogButton("OK").click());
    expect(s.tables("Sheet1")[0]!.filters!["Qty"]).toEqual({ kind: "top", n: 2 });
    expect(hidden(s)).toEqual([3, 4]);
    click(cellAt(1, 3, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    setField(field("Kind of condition"), "average");
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[name=filteravg]")][1]!.click());
    act(() => void dialogButton("OK").click());
    expect(s.tables("Sheet1")[0]!.filters!["Qty"]).toEqual({ kind: "average", below: true });
    expect(hidden(s)).toEqual([2, 5]);
    click(cellAt(1, 4, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    setField(field("Kind of condition"), "date");
    setField(field("Period"), "thisMonth");
    act(() => void dialogButton("OK").click());
    // 45000 is 15 March 2023: the other days are 5 December 2022 and 2 February 2020, and 16 March.
    expect(s.tables("Sheet1")[0]!.filters!["Day"]).toEqual({ kind: "date", period: "thisMonth" });
    expect(hidden(s)).toEqual([2, 3, 5]);
  });

  it("filters the sheet's own filter by the colours in a column, and says what is wrong", () => {
    const s = mount((x) => {
      x.deleteTable("Sales");
      x.setFilter("Sheet1", "A1:D5");
      x.setStyle("Sheet1", "A2:A3", { fill: "#ffff00" });
    });
    click(cellAt(1, 1, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    expect(dialog().textContent).toContain("Filter column A by condition");
    setField(field("Kind of condition"), "color");
    expect([...field("Colour").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["No fill", "#ffff00"]);
    setField(field("Colour"), "#ffff00");
    act(() => void dialogButton("OK").click());
    expect(s.sheet("Sheet1").filter!.columns!["A"]).toEqual({ kind: "color", fill: "#ffff00" });
    expect(hidden(s)).toEqual([4, 5]);
    click(cellAt(1, 1, 64 - 8, 12));
    act(() => void menuItem("Filter by condition\u2026").click());
    setField(field("Kind of condition"), "top");
    setField(field("How many"), "0");
    act(() => void dialogButton("OK").click());
    expect(dialog().textContent).toContain("whole number");
    expect(hidden(s)).toEqual([4, 5]);
    act(() => void dialogButton("Cancel").click());
  });
});
