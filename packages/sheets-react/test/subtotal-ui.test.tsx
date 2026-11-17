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
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const cellAt = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
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

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
  session.setValues("Sheet1", "A1", [
    ["Region", "Product", "Qty"],
    ["East", "Ink", 1],
    ["East", "Pen", 2],
    ["West", "Ink", 4],
    ["West", "Pen", 5],
  ]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}
const column = (s: SheetSession, col: string, rows: number) => Array.from({ length: rows }, (_, i) => s.display("Sheet1", `${col}${i + 1}`).text);

describe("the Subtotal dialog", () => {
  it("opens from the Data menu on the list around the cell, with the columns of its headings, and subtotals it", () => {
    const s = mount();
    click(2, 1);
    choose("Data", "Subtotal…");
    expect(dialog().textContent).toContain("A1:C5");
    expect([...field("At each change in").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Region", "Product", "Qty"]);
    // The last column starts picked, and sum is the function.
    expect((field("Add subtotal to Qty") as HTMLInputElement).checked).toBe(true);
    expect((field("Add subtotal to Product") as HTMLInputElement).checked).toBe(false);
    expect(field("Use function").value).toBe("sum");
    expect(dialogButton("Remove all").disabled).toBe(true);
    act(() => void dialogButton("OK").click());
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(column(s, "A", 8)).toEqual(["Region", "East", "East", "East Total", "West", "West", "West Total", "Grand Total"]);
    expect(column(s, "C", 8)).toEqual(["Qty", "1", "2", "3", "4", "5", "9", "12"]);
    // The rows show in the grid with the outline's margin.
    expect(host.querySelectorAll(".pli-outline-button").length).toBe(2);
    act(() => void s.undo());
    expect(column(s, "A", 5)).toEqual(["Region", "East", "East", "West", "West"]);
  });

  it("takes the choices of the dialog: the column, the function, the columns, and how the rows are laid out", () => {
    const s = mount();
    click(2, 1);
    choose("Data", "Subtotal…");
    setField(field("At each change in"), "B");
    setField(field("Use function"), "max");
    act(() => void field("Summary below data").click());
    act(() => void field("Grand total").click());
    act(() => void dialogButton("OK").click());
    // The list isn't sorted by product, so every row is a run of its own.
    expect(s.cell("Sheet1", "C2")!.f).toBe("SUBTOTAL(4,C3:C3)");
    expect(column(s, "B", 9)).toEqual(["Product", "Ink Max", "Ink", "Pen Max", "Pen", "Ink Max", "Ink", "Pen Max", "Pen"]);
    expect(s.sheet("Sheet1").outline).toEqual({ summaryAbove: true });
  });

  it("says why when nothing is picked or the list can't be subtotalled, and removes all subtotals", () => {
    const s = mount();
    click(2, 1);
    choose("Data", "Subtotal…");
    act(() => void field("Add subtotal to Qty").click());
    act(() => void dialogButton("OK").click());
    expect(dialog().textContent).toContain("Pick at least one column");
    act(() => void field("Add subtotal to Qty").click());
    act(() => void dialogButton("OK").click());
    expect(s.subtotalRows("Sheet1", "A1").rows).toEqual([4, 7, 8]);
    choose("Data", "Subtotal…");
    expect(dialogButton("Remove all").disabled).toBe(false);
    act(() => void dialogButton("Remove all").click());
    expect(s.subtotalRows("Sheet1", "A1").rows).toEqual([]);
    expect(column(s, "A", 5)).toEqual(["Region", "East", "East", "West", "West"]);
    expect(s.sheet("Sheet1").rows).toBeUndefined();
  });
});

describe("the Subtotal dialog and tables, pivots and sorting", () => {
  it("says a table can't be subtotalled, and turns it into a range when OK is pressed", () => {
    const s = mount();
    s.createTable("Sheet1", "A1:C5", { name: "Orders" });
    click(2, 1);
    choose("Data", "Subtotal…");
    expect(dialog().textContent).toContain("Orders is a table, and a table can't be subtotalled");
    act(() => void dialogButton("OK").click());
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(s.tables("Sheet1")).toHaveLength(0);
    expect(column(s, "A", 8)).toEqual(["Region", "East", "East", "East Total", "West", "West", "West Total", "Grand Total"]);
    // One undo brings the table and the plain list back.
    act(() => void s.undo());
    expect(s.tables("Sheet1")).toHaveLength(1);
    expect(column(s, "A", 5)).toEqual(["Region", "East", "East", "West", "West"]);
  });

  it("sorts the list first when asked to", () => {
    const s = mount();
    s.setValues("Sheet1", "A2", [["West", "Ink", 4], ["East", "Pen", 2], ["West", "Pen", 5], ["East", "Ink", 1]]);
    click(2, 1);
    choose("Data", "Subtotal…");
    expect(dialog().textContent).not.toContain("is a table");
    act(() => void (field("Sort the list by this column first") as HTMLInputElement).click());
    act(() => void dialogButton("OK").click());
    expect(column(s, "A", 8)).toEqual(["Region", "East", "East", "East Total", "West", "West", "West Total", "Grand Total"]);
    expect(column(s, "C", 8)).toEqual(["Qty", "2", "1", "3", "4", "5", "9", "12"]);
  });

  it("is greyed out over a pivot table, and says why when the selection takes one in", () => {
    const s = mount();
    s.createPivot("Sheet1", { name: "PT", source: "Sheet1!A1:C5", anchor: "F1", rows: ["Region"], values: [{ field: "Qty" }] });
    click(2, 6);
    act(() => void menuButton("Data").click());
    const item = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Subtotal…")!;
    expect(item.disabled).toBe(true);
    act(() => void menuButton("Data").click());
    // From the list's own cell the dialog opens as usual.
    click(2, 1);
    choose("Data", "Subtotal…");
    expect(dialog()).toBeTruthy();
  });

  it("sets what a column of a table's totals row works out, from Format > Table", () => {
    const s = mount();
    s.createTable("Sheet1", "A1:C5", { name: "Orders" });
    s.setTableTotals("Orders", true);
    click(6, 3);
    choose("Format", "Table", "Total row function", "Average");
    expect(s.cell("Sheet1", "C6")!.f).toBe("SUBTOTAL(101,Orders[Qty])");
    expect(s.value("Sheet1", "C6")).toBe(3);
    // The choice that is on shows ticked, and None empties the cell.
    act(() => void menuButton("Format").click());
    for (const name of ["Table", "Total row function"]) act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name)!.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")];
    const ticked = items.filter((b) => b.getAttribute("aria-checked") === "true" || b.getAttribute("aria-checked") === "mixed").map((b) => b.querySelector(".pli-menu-label")?.textContent);
    expect(ticked).toContain("Average");
    act(() => void items.find((b) => b.querySelector(".pli-menu-label")?.textContent === "None")!.click());
    expect(s.cell("Sheet1", "C6")).toBeUndefined();
  });
});
