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

describe("pivot data from outside, second filters, styles of your own, and the host hook", () => {
  it("lists the pivot styles of your own in the dialog and keeps the choice", () => {
    const s = mount((x) => {
      x.setPivotStyle("Pli blue", { headerRow: { fill: "#1f3864", color: "#ffffff" } });
    });
    seed(s);
    edit();
    const sel = field("Pivot table style") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toContain("Pli blue");
    setField(sel, "Pli blue");
    act(() => void dialogButton("Save").click());
    expect(s.pivots("Sheet1")[0]!.style?.name).toBe("Pli blue");
    expect(s.cell("Sheet1", "G1")?.s?.fill).toBe("#1f3864");
  });
  it("adds a second filter of the other kind to a field", () => {
    const s = mount();
    seed(s);
    edit();
    // Region has a label filter, and also a value filter.
    setField(field("Filter Region"), "label");
    setField(field("Region filter test"), "notEquals");
    setField(field("Region filter text"), "North");
    setField(field("Second filter on Region"), "value");
    setField(field("Region second filter test"), "greaterThan");
    setField(field("Region second filter text"), "50");
    act(() => void dialogButton("Save").click());
    const f = s.pivots("Sheet1")[0]!.rows[0]!;
    expect(f.filter).toEqual({ kind: "label", a: { op: "notEquals", value: "North" } });
    expect(f.filters).toEqual([{ kind: "value", by: 0, a: { op: "greaterThan", value: 50 } }]);
    expect(pivotNumbers(s)).toEqual([["Row Labels", "Sum of Sales"], ["East", "140"], ["West", "70"], ["Grand Total", "210"]]);
  });
  it("asks the host for the rows of a pivot table over outside data when the editor opens, and draws it again", async () => {
    const s = mount((x) => {
      x.setDataBlock("data:Sales", [["Region", "Sales"], ["East", 1], ["West", 2]]);
      x.createPivot("Sheet1", { source: "data:Sales", anchor: "G1", rows: ["Region"], values: ["Sales"] });
    });
    expect(s.values("Sheet1", s.pivots("Sheet1")[0]!.range).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Sales", "East|1", "West|2", "Grand Total|3"]);
    act(() => root.render(<PliSheet session={s} pivotData={async () => [["Region", "Sales"], ["East", 10], ["West", 20], ["East", 5]]} />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(s.dataBlock("data:Sales")?.rows).toHaveLength(4);
    expect(s.values("Sheet1", s.pivots("Sheet1")[0]!.range).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Sales", "East|15", "West|20", "Grand Total|35"]);
  });
  it("offers page fields for a pivot table of several ranges", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "L1", [["", "Q1"], ["East", 1]]);
      x.setValues("Sheet1", "L6", [["", "Q1"], ["East", 2]]);
    });
    seed(s);
    edit();
    setField(field("Other ranges to combine"), "Sheet1!L6:M7,Then");
    setField(field("Source range or table"), "Sheet1!L1:M2");
    expect([...(field("Page fields") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["0", "1", "2", "3", "4"]);
    setField(field("Page fields"), "0");
    expect(dialog().textContent).toContain("no page field");
  });
});
