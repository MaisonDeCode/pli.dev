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

describe("a table's header", () => {
  it("has filter buttons that filter the table and sort it, and shows the sort", () => {
    const s = mount(() => {});
    expect(host.querySelectorAll(".pli-grid-filterbtn")).toHaveLength(4);
    click(cellAt(1, 1, 64 - 8, 12)); // the button in A1
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".pli-grid-filterlist input")];
    expect(boxes).toHaveLength(3); // East, North, West
    act(() => void boxes[0]!.click()); // untick East
    act(() => void boxes[1]!.click()); // untick North
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-filteractions button")].find((b) => b.textContent === "OK")!.click());
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: ["West"] });
    expect(s.sheet("Sheet1").rows?.["3"]?.hidden).toBe(true);
    expect(host.querySelector(".pli-grid-filterbtn[data-on]")).toBeTruthy();

    click(cellAt(1, 3, 64 - 8, 12)); // the button in C1
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-filtermenu .pli-menu-item")].find((b) => b.textContent === "Sort Z to A")!.click());
    expect(s.tables("Sheet1")[0]!.sort).toEqual({ column: "Qty", descending: true });
    expect([2, 3, 4, 5].map((r) => s.value("Sheet1", `C${r}`))).toEqual([10, 7, 4, 2]);
    expect(s.sheet("Sheet1").rows?.["3"]?.hidden).toBe(true); // 7 is North, still hidden
    expect(q(".pli-grid-filterbtn[data-sort=descending]").textContent).toBe("▼");
  });

  it("has no buttons when they are turned off, and none without a header row", () => {
    const s = mount(() => {});
    click(cellAt(2, 1));
    choose("Format", "Table", "Filter buttons");
    expect(s.tables("Sheet1")[0]!.filterButtons).toBe(false);
    expect(host.querySelectorAll(".pli-grid-filterbtn")).toHaveLength(0);
    choose("Format", "Table", "Header row");
    expect(s.tables("Sheet1")[0]!.headerRow).toBe(false);
    expect(s.tables("Sheet1")[0]!.range).toBe("A2:D5");
    expect(texts()).not.toContain("Region");
    choose("Format", "Table", "Header row");
    expect(s.tables("Sheet1")[0]!.headerRow).toBeUndefined();
    expect(texts()).toContain("Region");
  });
});

describe("exceptions in a calculated column", () => {
  it("marks the cell, and the button beside it restores the formula", () => {
    const s = mount((x) => {
      x.setCell("Sheet1", "D2", "=[@Qty]*2");
      x.setCell("Sheet1", "D4", 99);
    });
    expect(host.querySelectorAll(".pli-grid-exception")).toHaveLength(1);
    expect(host.querySelector(".pli-grid-exceptionbtn")).toBeNull();
    click(cellAt(4, 4));
    expect(host.querySelector(".pli-grid-exceptionbtn")).toBeTruthy();
    click(cellAt(4, 4, -10, 10)); // the button, at the left of the cell
    const items = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")];
    expect(items.map((b) => b.textContent).join("|")).toMatch(/doesn't follow its column's formula/);
    act(() => void items.find((b) => b.textContent === "Restore the column's formula here")!.click());
    expect(s.cell("Sheet1", "D4")?.f).toBe("[@Qty]*2");
    expect(host.querySelectorAll(".pli-grid-exception")).toHaveLength(0);
  });
});

describe("slicers", () => {
  it("are inserted from the Insert menu, filter by clicking a button, and go with the menu on them", () => {
    const s = mount(() => {});
    click(cellAt(2, 1));
    choose("Insert", "Slicer…");
    const boxes = [...document.querySelectorAll<HTMLInputElement>("dialog input[type=checkbox]")];
    expect(boxes.map((b) => b.parentElement!.textContent?.trim())).toEqual(["Region", "Item", "Qty", "Total"]);
    act(() => void boxes[0]!.click());
    act(() => void dialogButton("Insert").click());
    expect(s.slicers("Sheet1")).toHaveLength(1);
    expect(s.slicers("Sheet1")[0]).toMatchObject({ column: "Region", from: { row: 1, col: 6 } });
    expect([...host.querySelectorAll(".pli-slicer-item")].map((e) => e.textContent)).toEqual(["East", "North", "West"]);
    expect(q(".pli-slicer-caption").textContent).toBe("Region");

    // The first button is 32 + 6 pixels under the top of the slicer, 6 in from its left.
    const first = { clientX: 48 + 5 * 64 + 20, clientY: 24 + 32 + 6 + 10 };
    click(first);
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: ["East"] });
    expect([...host.querySelectorAll(".pli-slicer-item[data-on]")].map((e) => e.textContent)).toEqual(["East"]);
    click({ clientX: first.clientX, clientY: first.clientY + 32 }, { ctrlKey: true }); // North, added
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: ["East", "North"] });
    click(first); // East alone is not the one chosen, so it becomes the only one
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: ["East"] });
    click(first); // and again clears
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();

    // The button at the right of the heading clears a filter too.
    click({ clientX: first.clientX + 30, clientY: first.clientY + 64 });
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Region: ["West"] });
    click({ clientX: 48 + 5 * 64 + 180 - 12, clientY: 24 + 12 });
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
  });

  it("moves by its heading and has settings and a delete in its menu", () => {
    const s = mount((x) => x.addSlicer("Sheet1", { table: "Sales", column: "Item", from: { row: 8, col: 1 } }));
    const head = { clientX: 48 + 20, clientY: 24 + 7 * 20 + 10 };
    pointer("pointerdown", head);
    pointer("pointermove", { clientX: head.clientX + 128, clientY: head.clientY + 40 });
    pointer("pointerup", { clientX: head.clientX + 128, clientY: head.clientY + 40 });
    expect(s.slicers("Sheet1")[0]!.from).toMatchObject({ row: 10, col: 3 });
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 48 + 2 * 64 + 20, clientY: 24 + 9 * 20 + 10 })));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent === "Slicer settings…")!.click());
    setField(document.querySelector<HTMLInputElement>("dialog input[type=text]")!, "Pick a thing");
    setField(document.querySelector<HTMLInputElement>("dialog input[type=number]")!, "2");
    act(() => void dialogButton("Done").click());
    expect(s.slicers("Sheet1")[0]).toMatchObject({ caption: "Pick a thing", columns: 2 });
    expect(q(".pli-slicer-caption").textContent).toBe("Pick a thing");
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 48 + 2 * 64 + 20, clientY: 24 + 9 * 20 + 10 })));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent === "Delete slicer")!.click());
    expect(s.slicers("Sheet1")).toEqual([]);
    expect(host.querySelector(".pli-slicer")).toBeNull();
  });
});

describe("table styles of your own", () => {
  it("are made in a dialog with a sample, applied to the table, and listed in the style menu", () => {
    const s = mount(() => {});
    click(cellAt(2, 1));
    choose("Format", "Table", "Table style", "New table style…");
    setField(document.querySelector<HTMLInputElement>("dialog input[type=text]")!, "Night");
    // The header row part is selected: give it a fill.
    act(() => void document.querySelector<HTMLInputElement>('dialog input[aria-label="Fill"]')!.click());
    setField(document.querySelector<HTMLInputElement>('dialog input[aria-label="Fill color"]')!, "#112233");
    act(() => void document.querySelector<HTMLInputElement>('dialog input[aria-label="Bold"]')!.click());
    const sample = document.querySelector<HTMLTableElement>('dialog table[aria-label="Sample table"]')!;
    expect(sample.rows[0]!.cells[0]!.style.background).toMatch(/rgb\(17, 34, 51\)|#112233/);
    act(() => void dialogButton("Done").click());
    expect(s.state.tableStyles?.["Night"]?.headerRow).toEqual({ fill: "#112233", bold: true });
    expect(s.tables("Sheet1")[0]!.style).toBe("Night");
    choose("Format", "Table", "Table style");
    expect(labels()).toContain("Night");
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Delete this style")!.click());
    expect(s.state.tableStyles).toBeUndefined();
    expect(s.tables("Sheet1")[0]!.style).toBeUndefined();
  });

  it("refuses a name that Excel's own styles have", () => {
    const s = mount(() => {});
    click(cellAt(2, 1));
    choose("Format", "Table", "Table style", "New table style…");
    setField(document.querySelector<HTMLInputElement>("dialog input[type=text]")!, "TableStyleMedium2");
    act(() => void dialogButton("Done").click());
    expect(document.querySelector("dialog [role=alert]")?.textContent).toMatch(/already/);
    expect(s.state.tableStyles).toBeUndefined();
  });
});
