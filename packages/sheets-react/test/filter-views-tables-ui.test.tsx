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
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
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
const dialogButton = (text: string | RegExp) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")))!;
const setField = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
/** The row numbers drawn in the row headings: hidden rows have none. */
const shownRows = () => [...host.querySelectorAll(".pli-grid-rowhead")].map((e) => Number(e.textContent)).filter((n) => n <= 6);
const bar = () => host.querySelector<HTMLElement>(".pli-viewbar");
const barButton = (text: string) => [...bar()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const menuLabels = () => [...document.querySelectorAll(".pli-menu-item .pli-menu-label")].map((e) => e.textContent);

function mount() {
  const s = new SheetSession(createWorkbook("t"));
  s.setValues("Sheet1", "A1", [["Item", "Region", "Qty"], ["pen", "east", 3], ["ink", "west", 9], ["pad", "east", 1], ["cap", "west", 7], ["tin", "north", 4]]);
  s.createTable("Sheet1", "A1:C6", { name: "Sales" });
  act(() => root.render(<PliSheet session={s} />));
  return s;
}
const hiddenRows = (s: SheetSession) => Object.entries(s.sheet("Sheet1").rows ?? {}).filter(([, d]) => d.hidden).map(([r]) => Number(r));

describe("filter views and tables in the grid", () => {
  it("a table filter can be saved as a view, shown for one person, and applied for everyone", () => {
    const s = mount();
    act(() => s.filterTable("Sales", "Region", ["east"]));
    choose("Data", "Filter views", "Save current filter as a view…");
    setField(dialog().querySelector<HTMLInputElement>("input[type=text]")!, "East");
    act(() => void dialogButton("Save current filter").click());
    expect(s.filterViews("Sheet1")).toHaveLength(1);
    // saving shows the view; the dialog says what it holds
    expect(dialog().querySelector(".pli-views-summary")!.textContent).toBe("Sales (1 filtered)");
    act(() => void dialogButton("Close").click());
    expect(shownRows()).toEqual([1, 2, 4]);
    act(() => void barButton("Close view").click());
    act(() => s.filterTable("Sales", "Region", null));
    expect(shownRows()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hiddenRows(s)).toEqual([]);
    const before = JSON.stringify(s.state);
    choose("Data", "Filter views", "East");
    expect(shownRows()).toEqual([1, 2, 4]);
    expect(JSON.stringify(s.state)).toBe(before);
    act(() => void barButton("Apply for everyone").click());
    expect(s.sheet("Sheet1").tables![0]!.filters).toEqual({ Region: ["east"] });
    expect(hiddenRows(s)).toEqual([3, 5, 6]);
    act(() => void s.undo());
    expect(hiddenRows(s)).toEqual([]);
  });

  it("a view that says the table is unfiltered shows all its rows while the table itself stays filtered", () => {
    const s = mount();
    act(() => s.filterTable("Sales", "Region", ["east"]));
    // a view needs a filter somewhere to be saved: filter the little list beside the table
    act(() => {
      s.setValues("Sheet1", "F1", [["Name", "Team"], ["Ann", "red"], ["Bo", "blue"]]);
      s.setFilter("Sheet1", "F1:G3");
      s.filterTable("Sales", "Region", null);
      s.saveFilterView("Sheet1", "Everything");
      s.filterTable("Sales", "Region", ["west"]);
    });
    expect(shownRows()).toEqual([1, 3, 5]);
    choose("Data", "Filter views", "Everything");
    expect(shownRows()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.sheet("Sheet1").tables![0]!.filters).toEqual({ Region: ["west"] });
  });

  it("with nothing filtered anywhere there is nothing to save", () => {
    mount();
    choose("Data", "Filter views", "Manage views…");
    expect(dialogButton("Save current filter").disabled).toBe(true);
  });
});
