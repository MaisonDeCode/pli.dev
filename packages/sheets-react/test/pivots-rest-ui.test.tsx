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
const pointer = (type: string, xy: { clientX: number; clientY: number }, init: MouseEventInit = {}) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy, ...init })));
const cellAt = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const setField = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
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
const notice = () => host.querySelector(".pli-notice")?.textContent ?? "";
const shownCells = () => [...host.querySelectorAll(".pli-cell")].map((c) => c.textContent);

const DAY = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;

function mount(setup: (s: SheetSession) => void = () => {}) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
  session.setValues("Sheet1", "A1", [
    ["Region", "Product", "Qty", "Sales", "When"],
    ["East", "Apple", 10, 100, DAY(2024, 1, 5)],
    ["East", "Pear", 5, 40, DAY(2024, 2, 9)],
    ["West", "Apple", 7, 70, DAY(2024, 2, 20)],
    ["North", "Plum", 4, 44, DAY(2024, 4, 2)],
  ]);
  session.setFormat("Sheet1", "E2:E5", "m/d/yyyy");
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}
const seed = (s: SheetSession) => s.createPivot("Sheet1", { source: "Sheet1!A1:E5", anchor: "G1", rows: ["Region"], values: ["Sales"] });
const edit = () => {
  click(2, 7);
  choose("Data", "Pivot table", "Edit pivot table…");
};
const pivotNumbers = (s: SheetSession) => s.values("Sheet1", s.pivots("Sheet1")[0]!.range).map((r) => r.map((v) => (v === null ? "" : String(v))));

describe("pivot table slicers in the grid", () => {
  it("show the items as buttons, filter the pivot table by a click and by Ctrl+click, and clear", () => {
    const s = mount((x) => {
      const p = seed(x);
      x.addPivotSlicer("Sheet1", p.id, { field: "Region", from: { row: 10, col: 7 } });
    });
    expect(q(".pli-slicer-caption").textContent).toBe("Region");
    expect([...host.querySelectorAll(".pli-slicer-item")].map((e) => e.textContent)).toEqual(["East", "North", "West"]);
    const first = { clientX: 48 + 6 * 64 + 20, clientY: 24 + 9 * 20 + 32 + 6 + 10 };
    const at = (n: number) => ({ clientX: first.clientX, clientY: first.clientY + n * 32 });
    pointer("pointerdown", first);
    pointer("pointerup", first);
    expect(s.pivots("Sheet1")[0]!.rows[0]!.hidden).toEqual(["North", "West"]);
    expect(pivotNumbers(s).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Sales", "East|140", "Grand Total|140"]);
    expect([...host.querySelectorAll(".pli-slicer-item[data-on]")].map((e) => e.textContent)).toEqual(["East"]);
    pointer("pointerdown", at(2), { ctrlKey: true });
    pointer("pointerup", at(2), { ctrlKey: true });
    expect(s.pivots("Sheet1")[0]!.rows[0]!.hidden).toEqual(["North"]);
    // One undo takes back the click, the filter and the redrawn cells together.
    act(() => void s.undo());
    expect(s.pivots("Sheet1")[0]!.rows[0]!.hidden).toEqual(["North", "West"]);
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "140"]);
    // The button at the right of the heading clears the filter.
    pointer("pointerdown", { clientX: 48 + 6 * 64 + 180 - 12, clientY: 24 + 9 * 20 + 12 });
    pointer("pointerup", { clientX: 48 + 6 * 64 + 180 - 12, clientY: 24 + 9 * 20 + 12 });
    expect(s.pivots("Sheet1")[0]!.rows[0]!.hidden).toBeUndefined();
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "254"]);
  });

  it("move by their heading and have a delete in their menu", () => {
    const s = mount((x) => {
      const p = seed(x);
      x.addPivotSlicer("Sheet1", p.id, { field: "Region", from: { row: 10, col: 7 } });
    });
    const head = { clientX: 48 + 6 * 64 + 20, clientY: 24 + 9 * 20 + 7 };
    pointer("pointerdown", head);
    pointer("pointermove", { clientX: head.clientX + 70, clientY: head.clientY + 40 });
    pointer("pointerup", { clientX: head.clientX + 70, clientY: head.clientY + 40 });
    expect(s.pivotSlicers("Sheet1")[0]!.from).toMatchObject({ row: 12, dx: 70 });
    act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: head.clientX + 70, clientY: head.clientY + 40 })));
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent === "Delete slicer")!.click());
    expect(s.pivotSlicers("Sheet1")).toEqual([]);
    expect(host.querySelector(".pli-slicer")).toBeNull();
  });

  it("are added and taken away in the pivot table dialog", () => {
    const s = mount((x) => void seed(x));
    edit();
    setField(field("Add a slicer for"), "Product");
    setField(field("Add a timeline for"), "When");
    act(() => void dialogButton("Save").click());
    expect(s.pivotSlicers("Sheet1")).toHaveLength(1);
    expect(s.pivotSlicers("Sheet1")[0]).toMatchObject({ field: "Product" });
    expect(s.pivotTimelines("Sheet1")).toHaveLength(1);
    expect(host.querySelectorAll(".pli-slicer").length).toBeGreaterThanOrEqual(1);
    edit();
    act(() => void field("Remove the slicer for Product").click());
    act(() => void dialogButton("Save").click());
    expect(s.pivotSlicers("Sheet1")).toEqual([]);
    expect(s.pivotTimelines("Sheet1")).toHaveLength(1);
  });
});

describe("pivot table timelines in the grid", () => {
  const withTimeline = (x: SheetSession) => {
    const p = x.createPivot("Sheet1", { source: "Sheet1!A1:E5", anchor: "G1", rows: ["Region"], values: ["Sales"] });
    x.addPivotTimeline("Sheet1", p.id, { field: "When", from: { row: 10, col: 7 } });
  };
  const tile = (n: number) => ({ clientX: 48 + 6 * 64 + 6 + n * 54 + 20, clientY: 24 + 9 * 20 + 32 + 6 + 16 + 10 });

  it("shows the months under their year, and picks dates by a click, stretches them with Shift, and clears", () => {
    const s = mount(withTimeline);
    expect(q(".pli-timeline .pli-slicer-caption").textContent).toBe("When");
    expect([...host.querySelectorAll(".pli-timeline-tile")].map((e) => e.textContent)).toEqual(["Jan", "Feb", "Mar", "Apr"]);
    expect([...host.querySelectorAll(".pli-timeline-group")].map((e) => e.textContent)).toEqual(["2024"]);
    pointer("pointerdown", tile(1));
    pointer("pointerup", tile(1));
    expect(s.pivotTimelines("Sheet1")[0]).toMatchObject({ start: DAY(2024, 2, 1), end: DAY(2024, 2, 29) });
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "110"]);
    pointer("pointerdown", tile(3), { shiftKey: true });
    pointer("pointerup", tile(3), { shiftKey: true });
    expect(s.pivotTimelines("Sheet1")[0]).toMatchObject({ start: DAY(2024, 2, 1), end: DAY(2024, 4, 30) });
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "154"]);
    expect([...host.querySelectorAll(".pli-timeline-tile[data-on]")].map((e) => e.textContent)).toEqual(["Feb", "Mar", "Apr"]);
    act(() => void s.undo());
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "110"]);
    pointer("pointerdown", tile(1));
    pointer("pointerup", tile(1));
    expect(s.pivotTimelines("Sheet1")[0]!.start).toBeUndefined();
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "254"]);
  });

  it("is cleared by the button in its heading", () => {
    const s = mount((x) => {
      withTimeline(x);
      x.pivotTimelineSelect(x.pivotTimelines("Sheet1")[0]!.id, DAY(2024, 1, 1), DAY(2024, 1, 31));
    });
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "100"]);
    pointer("pointerdown", { clientX: 48 + 6 * 64 + 360 - 12, clientY: 24 + 9 * 20 + 12 });
    pointer("pointerup", { clientX: 48 + 6 * 64 + 360 - 12, clientY: 24 + 9 * 20 + 12 });
    expect(pivotNumbers(s).at(-1)).toEqual(["Grand Total", "254"]);
  });
});

describe("the rest of the pivot table dialog", () => {
  it("adds a calculated item", () => {
    const s = mount((x) => void seed(x));
    edit();
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add a calculated item")!.click());
    setField(field("Calculated item 1 name"), "Coasts");
    setField(field("Calculated item 1 formula"), "East + West");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.calculatedItems).toEqual([{ field: "Region", name: "Coasts", formula: "East + West" }]);
    expect(pivotNumbers(s).map((r) => r.join("|"))).toContain("Coasts|210");
  });

  it("groups items you pick", () => {
    const s = mount((x) => void seed(x));
    edit();
    setField(field("Group Region"), "items");
    setField(field("Group 1 of Region"), "Coasts");
    const items = [...dialog().querySelectorAll<HTMLInputElement>('[aria-label="Items in group 1 of Region"] input')];
    act(() => void items.find((i) => i.parentElement!.textContent!.includes("East"))!.click());
    act(() => void items.find((i) => i.parentElement!.textContent!.includes("West"))!.click());
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.rows[0]!.group).toEqual({ by: "items", groups: [{ name: "Coasts", items: ["East", "West"] }] });
    expect(pivotNumbers(s).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Sales", "Coasts|210", "North|44", "Grand Total|254"]);
  });

  it("groups dates by years and months together, and times and days in ranges", () => {
    const s = mount((x) => void x.createPivot("Sheet1", { source: "Sheet1!A1:E5", anchor: "G1", rows: [{ field: "When", group: { by: "years" } }], values: ["Sales"] }));
    edit();
    setField(field("Also group When by"), "months");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.rows.map((f) => f.group)).toEqual([{ by: "years" }, { by: "months" }]);
    edit();
    setField(field("Group When"), "dayRange");
    setField(field("When group days"), "30");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.rows[0]!.group).toEqual({ by: "dayRange", days: 30 });
  });

  it("filters by the colour of the source cells", () => {
    const s = mount((x) => {
      seed(x);
      x.setStyle("Sheet1", "A2", { fill: "#ffff00" });
      x.setStyle("Sheet1", "A4", { fill: "#ffff00" });
    });
    edit();
    setField(field("Filter Region"), "color");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.rows[0]!.filter).toEqual({ kind: "color", fill: "#ffff00" });
    expect(pivotNumbers(s).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Sales", "East|100", "West|70", "Grand Total|170"]);
  });

  it("combines several ranges into one pivot table", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "M1", [["", "Q1", "Q2"], ["East", 1, 2], ["West", 3, 4]]);
      x.setValues("Sheet1", "M6", [["", "Q1", "Q2"], ["East", 10, 20], ["West", 30, 40]]);
    });
    click(1, 13);
    choose("Insert", "Pivot table…");
    setField(field("Source range or table"), "Sheet1!M1:O3");
    setField(field("Other ranges to combine"), "Sheet1!M6:O8, Last year");
    setField(field("Row goes in"), "rows");
    setField(field("Column goes in"), "columns");
    setField(field("Value goes in"), "values");
    act(() => void dialogButton("Create").click());
    const made = s.state.sheets[1]!;
    expect(made.pivots![0]!.ranges).toEqual([{ source: "Sheet1!$M$1:$O$3" }, { source: "Sheet1!$M$6:$O$8", name: "Last year" }]);
    expect(s.values(made.name, made.pivots![0]!.range).at(-1)).toEqual(["Grand Total", 44, 66, 110]);
  });

  it("picks a pivot table style and its bands", () => {
    const s = mount((x) => void seed(x));
    edit();
    setField(field("Pivot table style"), "PivotStyleMedium2");
    act(() => void [...dialog().querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((i) => i.parentElement!.textContent!.includes("Banded rows"))!.click());
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.style).toEqual({ name: "PivotStyleMedium2", rowStripes: true });
    expect(s.cell("Sheet1", "G1")?.s).toMatchObject({ fill: "#4472c4", color: "#ffffff", bold: true });
    edit();
    setField(field("Pivot table style"), "");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.style).toBeUndefined();
  });
});
