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

import { dateSerial } from "../../sheets/src/values";

const D = (y: number, m: number, d: number) => dateSerial(y, m, d)!;

function mount(setup: (s: SheetSession) => void = () => {}) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]), { now: () => D(2023, 6, 1) });
  session.setValues("Sheet1", "A1", [
    ["Order", "Day", "Qty"],
    ["a", D(2022, 11, 20), 1],
    ["b", D(2023, 1, 5), 2],
    ["c", D(2023, 1, 31), 3],
    ["d", D(2023, 3, 15), 4],
    ["e", D(2023, 6, 30), 5],
  ]);
  session.setFormat("Sheet1", "B2:B6", "yyyy-mm-dd");
  session.createTable("Sheet1", "A1:C6", { name: "Orders" });
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;

describe("the date tree in a filter menu", () => {
  it("shows years that open into months and days, with three-state boxes, and filters by what is ticked", () => {
    const s = mount();
    click(cellAt(1, 2, 64 - 8, 12)); // the filter button in B1
    const tree = document.querySelector<HTMLElement>('[role="tree"]')!;
    expect(tree).toBeTruthy();
    expect([...tree.querySelectorAll(":scope > li > label .pli-grid-filtervalue")].map((e) => e.textContent)).toEqual(["2022", "2023"]);
    // years start closed; open 2023, then January
    act(() => void button("Expand 2023").click());
    expect([...tree.querySelectorAll('[role="treeitem"] .pli-grid-filtervalue')].map((e) => e.textContent)).toContain("January");
    act(() => void button("Expand January 2023").click());
    expect([...tree.querySelectorAll('[role="treeitem"] .pli-grid-filtervalue')].map((e) => e.textContent)).toEqual(expect.arrayContaining(["5", "31"]));
    // untick the 31st: January becomes "some", 2023 becomes "some"
    const box = (name: string) => tree.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
    act(() => void box("31 January 2023").click());
    expect(box("January 2023").indeterminate).toBe(true);
    expect(box("2023").indeterminate).toBe(true);
    expect(box("2022").checked).toBe(true);
    // untick the whole of 2022
    act(() => void box("2022").click());
    expect(box("2022").checked).toBe(false);
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-filteractions button")].find((b) => b.textContent === "OK")!.click());
    expect(s.tables("Sheet1")[0]!.filters).toEqual({
      Day: { kind: "dateGroups", groups: [{ by: "day", year: 2023, month: 1, day: 5 }, { by: "month", year: 2023, month: 3 }, { by: "month", year: 2023, month: 6 }] },
    });
    expect(s.sheet("Sheet1").rows?.["2"]?.hidden).toBe(true);
    expect(s.sheet("Sheet1").rows?.["4"]?.hidden).toBe(true);
    expect(s.sheet("Sheet1").rows?.["3"]?.hidden).toBeUndefined();
  });

  it("opens with the current filter ticked, searches the dates, and clears them", () => {
    const s = mount((t) => t.filterTableRule("Orders", "Day", { kind: "dateGroups", groups: [{ by: "year", year: 2022 }] }));
    click(cellAt(1, 2, 64 - 8, 12));
    const tree = document.querySelector<HTMLElement>('[role="tree"]')!;
    const box = (name: string) => tree.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
    expect(box("2022").checked).toBe(true);
    expect(box("2023").checked).toBe(false);
    setField(document.querySelector<HTMLInputElement>('input[aria-label="Search values"]')!, "march");
    expect([...tree.querySelectorAll('[role="treeitem"] .pli-grid-filtervalue')].map((e) => e.textContent)).toEqual(["2023", "March", "15"]);
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-filterlinks button")].find((b) => b.textContent === "Select all")!.click());
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-filteractions button")].find((b) => b.textContent === "OK")!.click());
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
  });

  it("is a flat list for a column with no dates", () => {
    mount();
    click(cellAt(1, 1, 64 - 8, 12));
    expect(document.querySelector('[role="tree"]')).toBeNull();
    expect(document.querySelector('[aria-label="Values"]')).toBeTruthy();
  });
});

describe("lines between cells in the table style editor", () => {
  it("sets the lines between rows and columns of a part", () => {
    const s = mount();
    click(cellAt(2, 1));
    choose("Format", "Table", "Table style", "New table style…");
    setField(document.querySelector<HTMLInputElement>("dialog input[type=text]")!, "Grid");
    act(() => void [...document.querySelectorAll<HTMLButtonElement>("dialog .pli-stylebuilder-parts button")].find((b) => b.textContent === "Whole table")!.click());
    setField(document.querySelector<HTMLSelectElement>('dialog select[aria-label="line between rows"]')!, "thin");
    setField(document.querySelector<HTMLSelectElement>('dialog select[aria-label="line between columns"]')!, "dashed");
    setField(document.querySelector<HTMLSelectElement>('dialog select[aria-label="top line"]')!, "thick");
    setField(document.querySelector<HTMLInputElement>('dialog input[aria-label="line between rows color"]')!, "#336699");
    // The sample draws them: the cell in the second row, second column has lines all round, from the neighbours' sides
    const sample = document.querySelector<HTMLTableElement>('dialog table[aria-label="Sample table"]')!;
    expect(sample.rows[2]!.cells[1]!.style.borderTop).toMatch(/solid/);
    expect(sample.rows[2]!.cells[1]!.style.borderLeft).toMatch(/dashed/);
    expect(sample.rows[0]!.cells[0]!.style.borderTop).toMatch(/3px/);
    act(() => void dialogButton("Done").click());
    expect(s.state.tableStyles?.["Grid"]?.wholeTable).toEqual({ border: { top: { style: "thick" }, horizontal: { style: "thin", color: "#336699" }, vertical: { style: "dashed" } } });
    expect(s.tables("Sheet1")[0]!.style).toBe("Grid");
  });
});

describe("timelines", () => {
  /** A pointer event on the timeline itself; it works in its own pixels (the test window has no layout, so the box is at 0,0). */
  const tl = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
    act(() => void host.querySelector(".pli-timeline")!.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...init })));
  const STRIP_Y = 30 + 18 + 10;
  const periodX = (i: number) => 8 + i * 48 + 5; // months
  const insert = (s: SheetSession) => {
    choose("Insert", "Timeline…");
    expect(document.querySelector("dialog[open]")?.textContent).toMatch(/Insert timeline/);
    act(() => void dialogButton("Insert").click());
    return s.timelines("Sheet1")[0]!;
  };

  it("is inserted from the Insert menu for a column of dates, and draws the periods of the data", () => {
    const s = mount();
    click(cellAt(2, 2));
    const t = insert(s);
    expect(t).toMatchObject({ column: "Day", level: "months", from: { row: 1, col: 5 } });
    const el = host.querySelector(".pli-timeline")!;
    expect([...el.querySelectorAll(".pli-timeline-period")].map((e) => e.textContent)).toEqual(["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"]);
    expect([...el.querySelectorAll(".pli-timeline-parent")].map((e) => e.textContent)).toEqual(["2022", "2023"]);
    expect(el.querySelector(".pli-timeline-level")!.textContent).toMatch(/MONTHS/);
  });

  it("has no Insert entry to use for a table with no dates", () => {
    const s = new SheetSession(createWorkbook("t", ["Sheet1"]));
    s.setValues("Sheet1", "A1", [["x"], ["y"]]);
    s.createTable("Sheet1", "A1:A2", { name: "Plain" });
    act(() => root.render(<PliSheet session={s} />));
    act(() => void menuButton("Insert").click());
    const item = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Timeline…")!;
    expect(item.disabled || item.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("filters the table by the range dragged out over its periods, and by its handles", () => {
    const s = mount((x) => x.addTimeline("Sheet1", { table: "Orders", column: "Day" }));
    tl("pointerdown", periodX(2), STRIP_Y);
    tl("pointermove", periodX(4), STRIP_Y);
    expect(host.querySelectorAll(".pli-timeline-period[data-on]")).toHaveLength(3); // while dragging
    tl("pointerup", periodX(4), STRIP_Y);
    expect(s.tables("Sheet1")[0]!.filters).toEqual({ Day: { kind: "dateGroups", groups: [{ by: "month", year: 2023, month: 1 }, { by: "month", year: 2023, month: 2 }, { by: "month", year: 2023, month: 3 }] } });
    expect([...host.querySelectorAll(".pli-timeline-period[data-on]")].map((e) => e.textContent)).toEqual(["Jan", "Feb", "Mar"]);
    expect(host.querySelector(".pli-timeline-range")!.textContent).toBe("Jan 2023 - Mar 2023");
    expect(s.sheet("Sheet1").rows?.["2"]?.hidden).toBe(true); // 2022
    expect(s.sheet("Sheet1").rows?.["6"]?.hidden).toBe(true); // June
    // pull the right handle (at the end of March) to the end of April
    tl("pointerdown", 8 + 5 * 48, STRIP_Y);
    tl("pointerup", periodX(5), STRIP_Y);
    expect(s.timelineInfo(t(s)).selection).toEqual({ start: D(2023, 1, 1), end: D(2023, 4, 30) });
    // a plain press picks one month; Shift pulls the range out from there
    tl("pointerdown", periodX(7), STRIP_Y);
    tl("pointerup", periodX(7), STRIP_Y);
    expect(s.timelineInfo(t(s)).selection).toEqual({ start: D(2023, 6, 1), end: D(2023, 6, 30) });
    tl("pointerdown", periodX(5), STRIP_Y, { shiftKey: true });
    tl("pointerup", periodX(5), STRIP_Y, { shiftKey: true });
    expect(s.timelineInfo(t(s)).selection).toEqual({ start: D(2023, 4, 1), end: D(2023, 6, 30) });
  });

  it("changes its periods from the header, clears its range, and follows the header filter", () => {
    const s = mount((x) => x.addTimeline("Sheet1", { table: "Orders", column: "Day", width: 420 }));
    tl("pointerdown", periodX(0), STRIP_Y);
    tl("pointerup", periodX(0), STRIP_Y);
    expect(s.timelineInfo(t(s)).selection).toEqual({ start: D(2022, 11, 1), end: D(2022, 11, 30) });
    tl("pointerdown", 420 - 34 - 96 + 20, 10); // the periods word
    tl("pointerup", 420 - 34 - 96 + 20, 10);
    expect(s.timelines("Sheet1")[0]!.level).toBe("days");
    expect(host.querySelector(".pli-timeline-level")!.textContent).toMatch(/DAYS/);
    tl("pointerdown", 420 - 10, 10); // clear
    tl("pointerup", 420 - 10, 10);
    expect(s.tables("Sheet1")[0]!.filters).toBeUndefined();
    expect(s.sheet("Sheet1").rows?.["2"]?.hidden).toBeUndefined();
    // a filter made in the table's own menu shows in the timeline
    act(() => s.filterTableRule("Orders", "Day", { kind: "dateGroups", groups: [{ by: "year", year: 2023 }] }));
    expect(host.querySelector(".pli-timeline-range")!.textContent).toMatch(/Jan 2023/);
  });

  it("is moved by its header, resized by its corner, and offers its settings and Delete in a menu", () => {
    const s = mount((x) => x.addTimeline("Sheet1", { table: "Orders", column: "Day" }));
    tl("pointerdown", 100, 10);
    tl("pointermove", 200, 10);
    tl("pointerup", 200, 10);
    expect(s.timelines("Sheet1")[0]!.from).toMatchObject({ row: 1, col: 6, dx: 36 });
    tl("pointerdown", 419, 129);
    tl("pointermove", 459, 169);
    tl("pointerup", 459, 169);
    expect(s.timelines("Sheet1")[0]).toMatchObject({ width: 460, height: 170 });
    act(() => void host.querySelector(".pli-timeline")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })));
    expect(labels()).toEqual(expect.arrayContaining(["Timeline settings…", "Periods", "Clear range", "Delete timeline"]));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Timeline settings…")!.click());
    setField(document.querySelector<HTMLInputElement>('dialog input[type="text"]')!, "When");
    setField(document.querySelector<HTMLSelectElement>("dialog select")!, "quarters");
    act(() => void dialogButton("Done").click());
    expect(s.timelines("Sheet1")[0]).toMatchObject({ caption: "When", level: "quarters" });
    act(() => void host.querySelector(".pli-timeline")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Delete timeline")!.click());
    expect(s.timelines("Sheet1")).toEqual([]);
  });
});
const t = (s: SheetSession) => s.timelines("Sheet1")[0]!.id;
