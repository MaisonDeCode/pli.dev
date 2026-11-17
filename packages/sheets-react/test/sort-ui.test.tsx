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
const qty = (s: SheetSession) => [2, 3, 4, 5].map((r) => s.value("Sheet1", `C${r}`));
const dialogTextButton = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

describe("sorting by more than one column and by colour in the grid", () => {
  it("opens the Sort dialog from a table's filter menu and sorts by two levels", () => {
    const s = mount();
    click(cellAt(1, 1, 64 - 8, 12));
    act(() => void menuItem("Custom sort\u2026").click());
    expect(dialog().textContent).toContain("Sort Sales");
    expect((field("Column, level 1") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Region");
    act(() => void dialogTextButton("Add level").click());
    setField(field("Column, level 2"), "3");
    setField(field("Order, level 2"), "down");
    act(() => void dialogButton("OK").click());
    expect(s.tableSort("Sales")).toEqual([{ column: "Region" }, { column: "Qty", descending: true }]);
    expect([2, 3, 4, 5].map((r) => s.value("Sheet1", `A${r}`))).toEqual(["East", "North", "West", "West"]);
    expect(qty(s)).toEqual([4, 7, 10, 2]);
    // It opens again on the sort as it is, and a level can be copied, moved and deleted.
    click(cellAt(1, 1, 64 - 8, 12));
    act(() => void menuItem("Custom sort\u2026").click());
    expect((field("Column, level 2") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Qty");
    act(() => void (dialog().querySelector<HTMLButtonElement>('[aria-label="Move level 2 up"]'))!.click());
    expect((field("Column, level 1") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Qty");
    act(() => void (dialog().querySelector<HTMLButtonElement>('[aria-label="Delete level 1"]'))!.click());
    act(() => void dialogButton("OK").click());
    expect(s.tableSort("Sales")).toEqual([{ column: "Region" }]);
  });

  it("sorts by a cell colour picked in the dialog, and says what is wrong", () => {
    const s = mount((x) => {
      x.setStyle("Sheet1", "C3", { fill: "#ffc7ce" });
      x.setStyle("Sheet1", "C5", { fill: "#c6efce" });
    });
    click(cellAt(1, 3, 64 - 8, 12));
    act(() => void menuItem("Custom sort\u2026").click());
    setField(field("Sort on, level 1"), "cellColor");
    expect(field("Colour, level 1")).toBeTruthy();
    expect([...field("Colour, level 1").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["No fill", "#c6efce", "#ffc7ce"]);
    setField(field("Colour, level 1"), "#ffc7ce");
    act(() => void dialogTextButton("Add level").click());
    setField(field("Column, level 2"), "3");
    setField(field("Sort on, level 2"), "cellColor");
    setField(field("Colour, level 2"), "#ffc7ce");
    act(() => void dialogButton("OK").click());
    expect(dialog().textContent).toContain("twice"); // the same colour of the same column twice
    setField(field("Colour, level 2"), "#c6efce");
    act(() => void dialogButton("OK").click());
    expect(s.tableSort("Sales")).toEqual([{ column: "Qty", by: "cellColor", color: "#ffc7ce" }, { column: "Qty", by: "cellColor", color: "#c6efce" }]);
    expect(qty(s)).toEqual([4, 7, 10, 2]);
  });

  it("sorts by a swatch in the filter menu, for a table and for the sheet's own filter", () => {
    const s = mount((x) => {
      x.setStyle("Sheet1", "C3", { fill: "#ffc7ce" });
      x.setStyle("Sheet1", "C5", { color: "#9c0006" });
    });
    click(cellAt(1, 3, 64 - 8, 12));
    const swatch = (label: string) => document.querySelector<HTMLButtonElement>(`.pli-grid-filtermenu [aria-label="${label}"]`)!;
    expect(document.querySelectorAll(".pli-sortswatch").length).toBe(2 + 2);
    act(() => void swatch("Sort by cell colour #ffc7ce").click());
    expect(qty(s)).toEqual([4, 10, 2, 7]);
    expect(s.tableSort("Sales")).toEqual([{ column: "Qty", by: "cellColor", color: "#ffc7ce" }]);
    click(cellAt(1, 3, 64 - 8, 12));
    act(() => void swatch("Sort by font colour #9c0006").click());
    expect(qty(s)[0]).toBe(7);
    // A column with one look has no swatches.
    click(cellAt(1, 1, 64 - 8, 12));
    expect(document.querySelectorAll(".pli-sortswatch").length).toBe(0);
  });

  it("sorts a range from Data > Custom sort with a header box", () => {
    const s = mount((x) => {
      x.convertToRange("Sales");
      x.setStyle("Sheet1", "A4", { fill: "#ffc7ce" });
    });
    click(cellAt(2, 1));
    choose("Data", "Custom sort\u2026");
    expect(dialog().textContent).toContain("Sort range");
    const header = dialog().querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(header.checked).toBe(true);
    expect([...field("Column, level 1").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Region", "Item", "Qty", "Day"]);
    setField(field("Sort on, level 1"), "cellColor");
    setField(field("Colour, level 1"), "#ffc7ce");
    act(() => void dialogButton("OK").click());
    expect(s.value("Sheet1", "C2")).toBe(2); // the red row (West, Ink, 2) is on top, under the header
    expect(s.value("Sheet1", "A1")).toBe("Region");
  });
});

describe("removing duplicates in the grid", () => {
  it("removes the repeated rows of a table, comparing the columns ticked, and says how many", () => {
    const s = mount((x) => x.setValues("Sheet1", "A6", [["West", "Pens", 99, 44_000]]));
    click(cellAt(2, 1));
    choose("Format", "Table", "Remove duplicates…");
    expect(dialog().textContent).toContain("Remove duplicates from Sales");
    // Compare Region and Item only.
    for (const label of ["Qty", "Day"]) act(() => void [...dialog().querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.trim() === label)!.querySelector("input")!.click());
    act(() => void dialogButton("OK").click());
    expect(s.tables("Sheet1")[0]!.range).toBe("A1:D5");
    expect(document.body.textContent).toContain("1 duplicate row found and removed; 4 unique rows remain.");
  });

  it("works on a range from Data > Remove duplicates, and refuses with no column ticked", () => {
    const s = mount((x) => {
      x.convertToRange("Sales");
      x.setValues("Sheet1", "A6", [["West", "Pens", 10, 45_000]]);
    });
    click(cellAt(2, 1));
    choose("Data", "Remove duplicates…");
    expect(dialog().textContent).toContain("Remove duplicates");
    act(() => void dialogTextButton("Unselect all").click());
    act(() => void dialogButton("OK").click());
    expect(dialog().textContent).toContain("at least one column");
    act(() => void dialogTextButton("Select all").click());
    act(() => void dialogButton("OK").click());
    expect(s.value("Sheet1", "A6")).toBeNull();
    expect(s.value("Sheet1", "A5")).toBe("North");
  });
});
