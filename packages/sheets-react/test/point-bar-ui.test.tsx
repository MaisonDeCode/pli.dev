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

const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const click = (row: number, col: number) => (pointer("pointerdown", cellXY(row, col)), pointer("pointerup", cellXY(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const type = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(sink(), text);
    sink().dispatchEvent(new Event("input", { bubbles: true }));
  });
const bar = () => q<HTMLInputElement>(".pli-sheet-bar");
const barKey = (k: string, init: KeyboardEventInit = {}) => act(() => void bar().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const typeInBar = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(bar(), text);
    bar().dispatchEvent(new Event("input", { bubbles: true }));
  });
const caretIn = (at: number) => act(() => bar().setSelectionRange(at, at));
const outlines = () => [...host.querySelectorAll<HTMLElement>(".pli-grid-ref")];

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]));
  session.setValues("Sheet1", "A1", [[1, 2, 3], [4, 5, 6], [7, 8, 9], [null, null, null], [10, null, null]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("arrow keys point at cells in the formula bar", () => {
  it("start in Edit mode, where the arrow keys move the text cursor, and F2 turns Point mode on", () => {
    mount();
    click(1, 5); // E1
    act(() => bar().focus());
    typeInBar("=");
    caretIn(1);
    barKey("ArrowRight");
    expect(bar().value).toBe("="); // edit mode: nothing is pointed at
    barKey("F2");
    barKey("ArrowRight");
    expect(bar().value).toBe("=F1");
    barKey("ArrowDown");
    expect(bar().value).toBe("=F2");
    barKey("F2"); // back to Edit: the text cursor moves again
    caretIn(1);
    barKey("ArrowRight");
    expect(bar().value).toBe("=F2");
  });

  it("move a reference from the cell being edited, extend it with Shift and jump with Ctrl, like the grid's editor", () => {
    const s = mount();
    click(1, 5);
    act(() => bar().focus());
    typeInBar("=SUM(");
    caretIn(5);
    barKey("F2");
    barKey("ArrowLeft", { ctrlKey: true }); // from E1 to the edge of the data: C1
    expect(bar().value).toBe("=SUM(C1");
    barKey("ArrowDown", { shiftKey: true });
    barKey("ArrowDown", { shiftKey: true });
    expect(bar().value).toBe("=SUM(C1:C3");
    barKey("ArrowLeft", { shiftKey: true, ctrlKey: true });
    expect(bar().value).toBe("=SUM(A1:C3");
    barKey("ArrowDown"); // without Shift: one cell again, from the end of the range
    expect(bar().value).toBe("=SUM(A4");
    typeInBar("=SUM(A4)");
    barKey("Enter");
    expect(s.cell("Sheet1", "E1")?.f).toBe("SUM(A4)");
  });

  it("outline the reference on the sheet, keep the caret after it, and carry on after an operator", () => {
    mount();
    click(2, 5);
    act(() => bar().focus());
    typeInBar("=");
    caretIn(1);
    barKey("F2");
    barKey("ArrowLeft");
    expect(bar().value).toBe("=D2");
    expect(outlines()).toHaveLength(1);
    typeInBar("=D2+");
    caretIn(4);
    barKey("ArrowUp");
    expect(bar().value).toBe("=D2+E1"); // a new reference from the cell being edited
    typeInBar("=D2+E1+1");
    barKey("ArrowRight"); // typing ended the pointing, and a finished formula is not a place for a reference: the text cursor's job
    expect(bar().value).toBe("=D2+E1+1");
  });

  it("clicking in the bar's text goes back to Edit mode, and a finished entry keeps its arrow keys", () => {
    mount();
    click(1, 5);
    act(() => bar().focus());
    typeInBar("=");
    caretIn(1);
    barKey("F2");
    barKey("ArrowRight");
    expect(bar().value).toBe("=F1");
    act(() => void bar().dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    caretIn(1);
    barKey("ArrowRight");
    expect(bar().value).toBe("=F1");
    // a number in the bar is not a formula: Point mode leaves the arrow keys alone
    typeInBar("5");
    barKey("F2");
    barKey("ArrowLeft");
    expect(bar().value).toBe("5");
  });

  it("name the sheet when the entry is carried to another one", () => {
    mount();
    click(1, 5);
    act(() => bar().focus());
    typeInBar("=");
    caretIn(1);
    barKey("F2");
    act(() => void host.querySelectorAll<HTMLElement>(".pli-sheet-tab-name")[1]!.click());
    barKey("ArrowRight");
    expect(bar().value).toBe("=Other!B1");
  });

  it("scroll the sheet to the cell pointed at", () => {
    mount();
    click(1, 5);
    act(() => bar().focus());
    typeInBar("=");
    caretIn(1);
    barKey("F2");
    expect(q(".pli-grid-scroller").scrollTop).toBe(0);
    barKey("ArrowDown", { ctrlKey: true }); // nothing below in the column: the last row
    expect(bar().value).toBe("=E1048576");
    expect(q(".pli-grid-scroller").scrollTop).toBeGreaterThan(0);
  });
});
