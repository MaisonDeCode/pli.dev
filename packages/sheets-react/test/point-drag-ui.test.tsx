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

/** The viewport position of a point on the grid's lines: x is the left edge of column `col`, y the top edge of row `row`. */
const edge = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64, clientY: 24 + (row - 1) * 20 });
const drag = (from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }) => {
  pointer("pointerdown", from);
  pointer("pointermove", to);
  pointer("pointerup", to);
};

describe("the outline of a reference being typed can be dragged", () => {
  it("dragging its edge moves the reference by as many cells as the pointer goes, keeping its shape and its dollar signs", () => {
    mount();
    click(1, 8); // H1
    type("=SUM($B$2:C3)+E5");
    expect(outlines()).toHaveLength(2);
    // the left edge of the range, halfway down its first row: B2:C3's left edge is the line at the left of column B
    const left = { ...edge(2, 2), clientY: edge(2, 2).clientY + 10 };
    drag(left, { clientX: left.clientX + 64 + 10, clientY: left.clientY + 20 });
    expect(sink().value).toBe("=SUM($C$3:D4)+E5");
  });

  it("dragging its bottom right corner stretches it, and back to the first cell makes it one cell again", () => {
    mount();
    click(1, 8);
    type("=SUM(B2:C3)");
    const corner = edge(4, 4); // the bottom right corner of C3
    drag(corner, { clientX: corner.clientX + 30, clientY: corner.clientY + 10 });
    expect(sink().value).toBe("=SUM(B2:D4)");
    const again = edge(5, 5);
    drag(again, { clientX: edge(2, 2).clientX + 10, clientY: edge(2, 2).clientY + 10 });
    expect(sink().value).toBe("=SUM(B2)");
  });

  it("keeps the sheet's name in front of a reference to another sheet it moves, and leaves other sheets' references alone", () => {
    mount();
    click(1, 8);
    type("=Other!B2+B2");
    // Other!B2 is outlined on Other, not here, so only the plain B2 can be dragged on this sheet
    const left = { ...edge(2, 2), clientY: edge(2, 2).clientY + 10 };
    drag(left, { clientX: left.clientX + 64 + 10, clientY: left.clientY });
    expect(sink().value).toBe("=Other!B2+C2");
  });

  it("is for formulas being typed only: out of an entry, or in a plain text entry, the edge of the grid does what it always did", () => {
    const s = mount();
    click(2, 2);
    const left = { ...edge(2, 2), clientY: edge(2, 2).clientY + 10 };
    // the selection's own edge moves the cell (the mouse's drag-to-move), it is not a reference
    drag(left, { clientX: left.clientX + 64 + 10, clientY: left.clientY });
    expect(s.value("Sheet1", "B2")).toBe(null);
    expect(s.value("Sheet1", "C2")).toBe(5);
  });

  it("a click away from the outline still puts a cell address in, as before", () => {
    mount();
    click(1, 8);
    type("=");
    click(3, 3);
    expect(sink().value).toBe("=C3");
  });
});
