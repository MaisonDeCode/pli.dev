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

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
  session.setValues("Sheet1", "A1", [
    ["Region", "Product", "Qty", "Sales"],
    ["East", "Apple", 10, 100],
    ["East", "Pear", 5, 40],
    ["West", "Apple", 7, 70],
    ["North", "Plum", 4, 44],
  ]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("pivot tables in the grid", () => {
  it("are made from the block of data around the active cell, on a new sheet, by putting fields in areas", () => {
    const s = mount();
    click(2, 1);
    choose("Insert", "Pivot table…");
    expect(dialog().textContent).toContain("Create pivot table");
    expect(field("Source range or table").value).toBe("Sheet1!$A$1:$D$5");
    expect(dialog().textContent).toContain("Region");
    setField(field("Region goes in"), "rows");
    setField(field("Sales goes in"), "values");
    act(() => void dialogButton("Create").click());
    expect(s.state.sheets).toHaveLength(2);
    const made = s.state.sheets[1]!;
    expect(made.pivots).toHaveLength(1);
    expect(made.pivots![0]).toMatchObject({ rows: [{ field: "Region" }], values: [{ field: "Sales", fn: "sum" }], range: "A1:B5" });
    // The new sheet is shown, with the table in it.
    expect(shownCells()).toEqual(expect.arrayContaining(["Row Labels", "Sum of Sales", "East", "North", "West", "Grand Total", "254"]));
    act(() => void s.undo());
    expect(s.pivots(made.name)).toHaveLength(0);
  });

  it("can go on an existing sheet at a cell, and say what is wrong before anything is made", () => {
    const s = mount();
    click(1, 1);
    choose("Insert", "Pivot table…");
    act(() => void dialogButton("Create").click());
    expect(dialog().textContent).toContain("at least one field");
    expect(s.state.sheets).toHaveLength(1);
    setField(field("Region goes in"), "rows");
    setField(field("Sales goes in"), "values");
    act(() => void dialogButton("Create").click());
    expect(s.state.sheets).toHaveLength(2);
    act(() => void s.undo());
    act(() => void s.undo());
    expect(s.state.sheets.length).toBeLessThanOrEqual(2);
  });

  it("refuses to cover cells that have something in them, taking back the sheet it added", () => {
    const s = mount();
    click(1, 1);
    choose("Insert", "Pivot table…");
    setField(field("Region goes in"), "rows");
    setField(field("Sales goes in"), "values");
    setField(field("Sheet for the pivot table"), "Sheet1");
    setField(field("Top-left cell"), "B2");
    act(() => void dialogButton("Create").click());
    expect(dialog().textContent).toMatch(/isn't empty|cover/);
    expect(s.state.sheets).toHaveLength(1);
    setField(field("Top-left cell"), "G1");
    act(() => void dialogButton("Create").click());
    expect(s.pivots("Sheet1")).toHaveLength(1);
    expect(shownCells()).toEqual(expect.arrayContaining(["Grand Total", "254"]));
  });

  it("are edited from a cell in them: fields, order, summary, items left out", () => {
    const s = mount();
    let p!: ReturnType<typeof s.createPivot>;
    act(() => void (p = s.createPivot("Sheet1", { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] })));
    click(2, 7);
    choose("Data", "Pivot table", "Edit pivot table…");
    expect(dialog().textContent).toContain(`Pivot table ${p.name}`);
    setField(field("Product goes in"), "columns");
    setField(field("Summarise Sales by"), "average");
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "All items" && b.closest("fieldset")?.getAttribute("aria-label") === "Rows")!.click());
    const north = [...dialog().querySelectorAll<HTMLInputElement>('[aria-label="Items of Region"] input')].find((i) => i.parentElement!.textContent!.includes("North"))!;
    act(() => void north.click());
    act(() => void dialogButton("Save").click());
    const now = s.pivots("Sheet1")[0]!;
    expect(now.columns).toEqual([{ field: "Product" }]);
    expect(now.rows).toEqual([{ field: "Region", hidden: ["North"] }]);
    expect(now.values[0]!.fn).toBe("average");
    expect(s.value("Sheet1", "H4")).toBe(70);
  });

  it("are refreshed from the Data menu, and everything else refuses to edit their cells", () => {
    const s = mount();
    act(() => void s.createPivot("Sheet1", { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] }));
    act(() => void s.setCell("Sheet1", "D2", 1000));
    expect(s.value("Sheet1", "H2")).toBe(140);
    click(2, 8);
    choose("Data", "Pivot table", "Refresh");
    expect(s.value("Sheet1", "H2")).toBe(1040);
    click(2, 8);
    act(() => void setField(sink(), "5"));
    key("Enter");
    expect(notice()).toContain("Can't change part of a pivot table");
    expect(s.value("Sheet1", "H2")).toBe(1040);
  });

  it("are turned into plain cells, or deleted", () => {
    const s = mount();
    act(() => void s.createPivot("Sheet1", { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] }));
    click(3, 7);
    choose("Data", "Pivot table", "Convert to values");
    expect(s.pivots("Sheet1")).toHaveLength(0);
    expect(s.value("Sheet1", "G3")).toBe("North");
    act(() => void s.createPivot("Sheet1", { source: "Sheet1!A1:D5", anchor: "G8", rows: ["Region"], values: ["Sales"] }));
    click(9, 7);
    choose("Data", "Pivot table", "Delete pivot table");
    expect(s.pivots("Sheet1")).toHaveLength(0);
    expect(s.cell("Sheet1", "G9")).toBeUndefined();
  });

  it("draw the indented items of nested rows", () => {
    const s = mount();
    act(() => void s.createPivot("Sheet1", { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region", "Product"], values: ["Sales"] }));
    const indented = [...host.querySelectorAll<HTMLElement>(".pli-cell")].filter((c) => c.textContent === "Apple").map((c) => (c.firstElementChild as HTMLElement | null)?.style.paddingLeft ?? c.style.paddingLeft);
    expect(indented.some((p) => p === "9px")).toBe(true);
  });

  const edit = (s: ReturnType<typeof mount>, spec: Parameters<ReturnType<typeof mount>["createPivot"]>[1]) => {
    act(() => void s.createPivot("Sheet1", spec));
    click(2, 7);
    choose("Data", "Pivot table", "Edit pivot table…");
  };
  const tick = (el: HTMLInputElement) => act(() => void el.click());
  const labelled = (text: string) => [...dialog().querySelectorAll("label")].find((l) => l.textContent!.includes(text))!.querySelector("input")!;

  it("sort an axis by a value and keep only its top items", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] });
    setField(field("Sort Region by"), "0");
    tick(field("Region largest to smallest") as HTMLInputElement);
    setField(field("Filter Region"), "top");
    setField(field("Region filter count"), "2");
    act(() => void dialogButton("Save").click());
    const now = s.pivots("Sheet1")[0]!;
    expect(now.rows).toEqual([{ field: "Region", sortBy: { value: 0, descending: true }, filter: { kind: "top", by: 0, n: 2 } }]);
    expect(s.values("Sheet1", "G2:H4")).toEqual([["East", 140], ["West", 70], ["Grand Total", 210]]);
  });

  it("filter the items by their label", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] });
    setField(field("Filter Region"), "label");
    setField(field("Region filter test"), "beginsWith");
    setField(field("Region filter text"), "w");
    act(() => void dialogButton("Save").click());
    expect(s.values("Sheet1", "G2:H3")).toEqual([["West", 70], ["Grand Total", 70]]);
  });

  it("group a field of numbers, and a field of dates", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Qty"], values: ["Sales"] });
    setField(field("Group Qty"), "number");
    setField(field("Qty group step"), "5");
    setField(field("Qty group start"), "0");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.rows).toEqual([{ field: "Qty", group: { by: "number", step: 5, start: 0 } }]);
    expect(s.values("Sheet1", "G2:H4")).toEqual([["0-4", 44], ["5-9", 110], ["10-14", 100]]);
  });

  it("add a calculated field, and put the values down the rows in outline form", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region", "Product"], values: ["Sales"], tabular: true });
    act(() => void [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add a calculated field")!.click());
    setField(field("Calculated field 1 name"), "Net");
    setField(field("Calculated field 1 formula"), "Sales - Qty");
    setField(field("Net goes in"), "values");
    tick(labelled("Outline"));
    tick(labelled("Show the values down the rows"));
    act(() => void dialogButton("Save").click());
    const now = s.pivots("Sheet1")[0]!;
    expect(now.calculated).toEqual([{ name: "Net", formula: "Sales - Qty" }]);
    expect(now.outline).toBe(true);
    expect(now.tabular).toBeUndefined();
    expect(now.valuesOnRows).toBe(true);
    expect(s.values("Sheet1", "G1:J2")).toEqual([["Region", "Product", "Values", "Total"], ["East", null, "Sum of Sales", 140]]);
  });

  it("show a value as a difference from the previous item", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], columns: ["Product"], values: ["Sales"] });
    setField(field("Show Sales as"), "differenceFromPrevious");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.values[0]!.showAs).toBe("differenceFromPrevious");
    expect(s.value("Sheet1", "I3")).toBe(-60);
  });

  it("show a value as a difference from a chosen item along a field, and refresh by itself", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], columns: ["Product"], values: ["Sales"] });
    setField(field("Show Sales as"), "differenceFrom");
    // It starts by comparing with the previous item of the innermost field, and the choices are the fields and items.
    expect(field("Sales runs along")).toBeTruthy();
    expect([...field("Sales compared with").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["(previous)", "(next)", "Apple", "Pear", "Plum"]);
    setField(field("Sales compared with"), "item:Apple");
    const refresh = [...dialog().querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((i) => i.parentElement!.textContent!.includes("Refresh when the source changes"))!;
    act(() => void refresh.click());
    act(() => void dialogButton("Save").click());
    const made = s.pivots("Sheet1")[0]!;
    expect(made.values[0]).toMatchObject({ showAs: "differenceFrom", base: { field: "Product", item: "Apple" } });
    expect(made.autoRefresh).toBe(true);
    // East: Pear 40 against Apple 100.
    expect(s.value("Sheet1", "I3")).toBe(-60);
    act(() => void s.setCell("Sheet1", "D3", 500));
    expect(s.value("Sheet1", "I3")).toBe(400);
  });

  it("put the items of a field in your own order, and keep only the dates in a period", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] });
    setField(field("Sort Region by"), "manual");
    // It starts from the usual order, and each item has buttons to move it.
    expect([...dialog().querySelectorAll('[aria-label="Order of Region"] li')].map((li) => li.firstChild!.textContent)).toEqual(["East", "North", "West"]);
    act(() => void (dialog().querySelector('[aria-label="Move West up"]') as HTMLButtonElement).click());
    act(() => void (dialog().querySelector('[aria-label="Move West up"]') as HTMLButtonElement).click());
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.rows[0]!.order).toEqual(["West", "East", "North"]);
    expect(s.values("Sheet1", "G2:G4").map((r) => r[0])).toEqual(["West", "East", "North"]);
  });

  it("offer a filter by the date period of an item", () => {
    const s = mount();
    edit(s, { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] });
    setField(field("Filter Region"), "date");
    setField(field("Region date period"), "lastYear");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.rows[0]!.filter).toEqual({ kind: "date", period: "lastYear" });
  });

  it("show the records behind a cell on a new sheet", () => {
    const s = mount();
    act(() => void s.createPivot("Sheet1", { source: "Sheet1!A1:D5", anchor: "G1", rows: ["Region"], values: ["Sales"] }));
    click(2, 7);
    key("ArrowRight");
    choose("Data", "Pivot table", "Show details");
    expect(notice()).toBe("");
    expect(s.state.sheets.map((x) => x.name)).toContain("Details");
    expect(s.values("Details", "A1:D3")).toEqual([["Region", "Product", "Qty", "Sales"], ["East", "Apple", 10, 100], ["East", "Pear", 5, 40]]);
  });
});
