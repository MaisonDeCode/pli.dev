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
const outlines = () => [...host.querySelectorAll<HTMLElement>(".pli-grid-ref")];

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]));
  session.setValues("Sheet1", "A1", [[1, 2, 3], [4, 5, 6], [7, 8, 9], [null, null, null], [10, null, null]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("arrow keys point at cells while a formula is typed", () => {
  it("moves a reference from the cell being edited, instead of the text cursor", () => {
    mount();
    click(2, 5); // E2
    type("=");
    key("ArrowRight");
    expect(sink().value).toBe("=F2");
    key("ArrowDown");
    expect(sink().value).toBe("=F3");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(sink().value).toBe("=D3");
    key("ArrowUp");
    expect(sink().value).toBe("=D2");
    expect(outlines()).toHaveLength(1); // the reference is outlined in colour, like one that was clicked
  });

  it("Shift extends the reference to a range, and Ctrl (Cmd) jumps to the edge of the data", () => {
    mount();
    click(1, 5);
    type("=SUM(");
    key("ArrowLeft", { ctrlKey: true }); // from E1 to the edge of the data: C1
    expect(sink().value).toBe("=SUM(C1");
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    expect(sink().value).toBe("=SUM(C1:C3");
    key("ArrowLeft", { shiftKey: true, ctrlKey: true });
    expect(sink().value).toBe("=SUM(A1:C3");
  });

  it("Ctrl jumps over the gap to the next filled cell, as it does outside a formula", () => {
    mount();
    click(1, 1);
    type("=SUM(");
    key("ArrowDown", { ctrlKey: true }); // A1 is filled with A2 below it: to the end of the run
    expect(sink().value).toBe("=SUM(A3");
    key("ArrowDown", { ctrlKey: true, shiftKey: true }); // A4 is empty: on to A5
    expect(sink().value).toBe("=SUM(A3:A5");
  });

  it("an arrow key without Shift after a range collapses it to one cell", () => {
    mount();
    click(1, 5);
    type("=SUM(");
    key("ArrowLeft");
    key("ArrowLeft");
    key("ArrowLeft", { shiftKey: true });
    expect(sink().value).toBe("=SUM(B1:C1");
    key("ArrowDown");
    expect(sink().value).toBe("=SUM(B2");
  });

  it("typing another character keeps the reference and carries on, and the next arrow key points again", () => {
    const s = mount();
    click(1, 5);
    type("=");
    key("ArrowLeft"); // D1
    type("=D1+"); // an operator: the reference is committed
    key("ArrowLeft");
    expect(sink().value).toBe("=D1+D1"); // from E1, one cell to the left
    type("=D1+D1*");
    key("ArrowDown", { shiftKey: true });
    expect(sink().value).toBe("=D1+D1*E1:E2"); // from the cell being edited, E1
    key("Enter");
    expect(s.cell("Sheet1", "E1")?.f).toBe("D1+D1*E1:E2");
  });

  it("an arrow key after a finished entry still accepts it and moves on, and F2 gives the arrow keys back to the text", () => {
    const s = mount();
    click(1, 5);
    type("7");
    key("ArrowDown");
    expect(s.value("Sheet1", "E1")).toBe(7);
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("E2");
    type("=");
    key("F2"); // edit mode: the arrow keys move the text cursor
    key("ArrowRight");
    expect(sink().value).toBe("=");
    key("F2"); // back to enter mode: they point again
    key("ArrowRight");
    expect(sink().value).toBe("=F2");
  });

  it("moving the text cursor away ends pointing; a typed reference is then not moved", () => {
    mount();
    click(1, 5);
    type("=A1+");
    key("ArrowDown");
    expect(sink().value).toBe("=A1+E2");
    act(() => sink().setSelectionRange(3, 3));
    sink().focus();
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    key("ArrowRight"); // not after an operator any more: the entry is accepted and the selection moves
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("F1");
  });

  it("names the sheet when the entry is carried to another one", () => {
    mount();
    click(1, 5);
    type("=");
    act(() => void host.querySelectorAll<HTMLElement>(".pli-sheet-tab-name")[1]!.click());
    key("ArrowRight");
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("=Other!B1"); // from the cell selected on that sheet (A1), one to the right
    key("ArrowDown");
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("=Other!B2");
  });
});
