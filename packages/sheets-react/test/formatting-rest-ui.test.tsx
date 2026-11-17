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

describe("rules for the selected cells of a pivot table", () => {
  const DATA = [["Region", "Product", "Sales"], ["East", "Apple", 100], ["East", "Pear", 40], ["West", "Apple", 70], ["West", "Pear", 33]];
  /** Selects cells by typing their address in the name box. */
  const select = (address: string) => {
    const box = q<HTMLInputElement>(".pli-sheet-namebox");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, address);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(nameBox()).toBe(address);
  };
  const openRuleDialog = (address: string) => {
    click(all(".pli-sheet-tab-name").find((b) => b.textContent === "Pivot")!);
    select(address);
    click(q('button[aria-label="Conditional formatting"]'));
    click(item("Manage rules"));
    click([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "New rule…")!);
  };
  const fill = (placeholder: string, value: string) =>
    act(() => {
      const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("offers the selected cells as a scope, and the rule follows their items", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "A1", DATA);
      x.createPivot("Pivot", { source: "Sheet1!A1:C5", anchor: "A1", rows: ["Region", "Product"], values: ["Sales"] });
    }, ["Sheet1", "Pivot"]);
    // Rows: heading (1), East (2), Apple (3), Pear (4), West (5), Apple (6), Pear (7), Grand Total (8). Column B shows the sales.
    openRuleDialog("B6:B7");
    expect(document.body.textContent).toContain("The selected cells of PivotTable1, wherever they move");
    setSelect("Apply the rule to", "selection");
    fill("10 or $D$1", "0");
    submit();
    const rule = s.conditionalFormats("Pivot")[0]!;
    expect(rule.pivot).toMatchObject({ id: s.pivots("Pivot")[0]!.id, rows: "Product", items: { Region: ["West"] } });
    expect(rule.ranges).toEqual(["B6:B7"]);
    // The rule follows the table when a region is added.
    act(() => {
      s.setValues("Sheet1", "A6", [["West", "Plum", 5]]);
      s.updatePivot("Pivot", s.pivots("Pivot")[0]!.id, { source: "Sheet1!A1:C6" });
    });
    expect(s.conditionalFormats("Pivot")[0]!.ranges).toEqual(["B6:B8"]);
  });

  it("is not offered when the selection takes in a label", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "A1", DATA);
      x.createPivot("Pivot", { source: "Sheet1!A1:C5", anchor: "A1", rows: ["Region"], values: ["Sales"] });
    }, ["Sheet1", "Pivot"]);
    openRuleDialog("A2:B2");
    expect(document.body.textContent).toContain("The cells of PivotTable1, wherever they move");
    expect(document.body.textContent).not.toContain("The selected cells of PivotTable1");
  });
});
