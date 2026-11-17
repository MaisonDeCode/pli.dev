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
  window.confirm = () => true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const nameBox = () => q<HTMLInputElement>(".pli-sheet-namebox").value;
const click = (el: Element, init: MouseEventInit = {}) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
const pointer = (type: string, xy: { clientX: number; clientY: number }) =>
  act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const item = (text: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox]")].find((e) => e.textContent?.includes(text))!;

function mount(setup: (s: SheetSession) => void, names = ["Sheet1"]) {
  const session = new SheetSession(createWorkbook("t", names), { now: () => 45000 });
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}


const setSelect = (label: string, value: string) =>
  act(() => {
    const el = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
const submit = () => act(() => void document.querySelector<HTMLFormElement>("dialog[open] form, dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

describe("rules that follow a pivot table", () => {
  const DATA = [["Region", "Product", "Sales"], ["East", "Apple", 100], ["East", "Pear", 40], ["West", "Apple", 70]];

  it("the rule dialog offers the pivot table's cells when the selection is in one", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "A1", DATA);
      x.createPivot("Pivot", { source: "Sheet1!A1:C4", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    }, ["Sheet1", "Pivot"]);
    // Open the second sheet.
    click(all(".pli-sheet-tab-name").find((b) => b.textContent === "Pivot")!);
    pointer("pointerdown", cellXY(2, 2));
    pointer("pointerup", cellXY(2, 2));
    click(q('button[aria-label="Conditional formatting"]'));
    click(item("Manage rules"));
    click([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "New rule…")!);
    expect(document.body.textContent).toContain("The cells of PivotTable1, wherever they move");
    setSelect("Apply the rule to", "pivot");
    expect(document.querySelector('select[aria-label="Pivot row field"]')).toBeTruthy();
    act(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="10 or $D$1"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "50");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    submit();
    const rule = s.conditionalFormats("Pivot")[0]!;
    expect(rule.pivot).toEqual({ id: s.pivots("Pivot")[0]!.id });
    expect(rule.ranges).toEqual(["B2:B4"]);
  });

  it("is not offered outside a pivot table", () => {
    mount((x) => x.setValues("Sheet1", "A1", DATA));
    pointer("pointerdown", cellXY(2, 2));
    pointer("pointerup", cellXY(2, 2));
    click(q('button[aria-label="Conditional formatting"]'));
    click(item("Manage rules"));
    click([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "New rule…")!);
    expect(document.body.textContent).not.toContain("wherever they move");
  });
});

describe("data bar settings in the rule dialog", () => {
  it("offers automatic ends, the direction and border colours, and saves them", () => {
    const s = mount((x) => x.setValues("Sheet1", "A1", [[1], [2]]));
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(2, 1));
    pointer("pointerup", cellXY(2, 1));
    click(q('button[aria-label="Conditional formatting"]'));
    click(item("Manage rules"));
    click([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "New rule…")!);
    act(() => {
      const kind = document.querySelector<HTMLSelectElement>("dialog select")!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(kind, "dataBar");
      kind.dispatchEvent(new Event("change", { bubbles: true }));
    });
    setSelect("Shortest type", "auto");
    setSelect("Longest type", "auto");
    const box = (text: string) => [...document.querySelectorAll<HTMLLabelElement>("dialog label")].find((l) => l.textContent?.includes(text))!.querySelector<HTMLInputElement>("input")!;
    click(box("Border"));
    click(box("Bars grow from the right"));
    submit();
    expect(s.conditionalFormats("Sheet1")[0]).toMatchObject({ kind: "dataBar", min: { type: "auto" }, max: { type: "auto" }, border: true, rtl: true });
  });
});
