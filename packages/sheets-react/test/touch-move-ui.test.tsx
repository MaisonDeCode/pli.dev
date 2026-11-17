// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.useRealTimers();
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const namebox = () => q<HTMLInputElement>(".pli-sheet-namebox").value;

/** A pointer event of a given kind of input, at a place, on an element (the grid by default). */
function fire(type: string, xy: { clientX: number; clientY: number }, pointerType: "touch" | "mouse" | "pen" = "touch", on: Element = q(".pli-grid-scroller")) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: pointerType === "touch" ? 7 : 1 });
  act(() => void on.dispatchEvent(event));
}
const tap = (row: number, col: number) => (fire("pointerdown", cellXY(row, col)), fire("pointerup", cellXY(row, col)));
const handle = (which: "start" | "end" | "fill") => q(`.pli-grid-touchhandle[data-handle="${which}"]`);
const mover = () => host.querySelector<HTMLElement>(".pli-grid-touchmove");
/** Where a handle is, as the pointer would find it. */
const at = (el: HTMLElement) => ({ clientX: parseFloat(el.style.left), clientY: parseFloat(el.style.top) });

function mount(readOnly = false) {
  const session = new SheetSession(createWorkbook("t"));
  session.setValues("Sheet1", "A1", [[1, "a"], [2, "b"], [null, null], [null, null], [null, null]]);
  session.setCell("Sheet1", "C1", "=A1+A2");
  act(() => root.render(<PliSheet session={session} readOnly={readOnly} />));
  return session;
}
const preview = () => host.querySelector<HTMLElement>(".pli-grid-fill-preview[data-move]");

describe("touch: the handle for moving cells", () => {
  it("is drawn for a finger only, beside the selection: above it, or at its side when there is no room above", () => {
    mount();
    expect(mover()).toBeNull();
    fire("pointerdown", cellXY(3, 3), "mouse");
    fire("pointerup", cellXY(3, 3), "mouse");
    expect(mover()).toBeNull();
    tap(4, 3); // C4: room above
    expect(mover()).not.toBeNull();
    expect(at(mover()!)).toEqual({ clientX: 48 + 2 * 64 + 32, clientY: 24 + 3 * 20 - 24 });
    tap(1, 3); // C1 is in the first row: nothing above, so it sits to the left
    expect(at(mover()!)).toEqual({ clientX: 48 + 2 * 64 - 24, clientY: 24 + 10 });
    tap(1, 1); // A1: no room above or to the left, so to the right
    expect(at(mover()!)).toEqual({ clientX: 48 + 64 + 24, clientY: 24 + 10 });
    fire("pointerdown", cellXY(3, 3), "pen");
    fire("pointerup", cellXY(3, 3), "pen");
    expect(mover()).toBeNull();
  });

  it("is not offered on a read-only sheet, while typing, for whole columns", () => {
    mount(true);
    tap(2, 2);
    expect(mover()).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    mount();
    tap(3, 3);
    expect(mover()).not.toBeNull();
    fire("pointerdown", { clientX: 48 + 10, clientY: 10 });
    fire("pointerup", { clientX: 48 + 10, clientY: 10 }); // the column heading A
    expect(mover()).toBeNull();
  });

  it("dragging it moves the selected cells by as far as the finger goes, and formulas that pointed at them follow", () => {
    const s = mount();
    tap(1, 1);
    const end = handle("end");
    fire("pointerdown", at(end), "touch", end);
    fire("pointermove", cellXY(2, 2), "touch", end);
    fire("pointerup", cellXY(2, 2), "touch", end);
    expect(namebox()).toBe("A1:B2");
    const grip = mover()!;
    const from = at(grip); // beside A1:B2, at the cell right of the selection (C... row 1)
    fire("pointerdown", from, "touch", grip);
    // three rows down and one column over
    fire("pointermove", { clientX: from.clientX + 64, clientY: from.clientY + 3 * 20 }, "touch", grip);
    expect(preview()).not.toBeNull();
    fire("pointerup", { clientX: from.clientX + 64, clientY: from.clientY + 3 * 20 }, "touch", grip);
    expect(preview()).toBeNull();
    expect(namebox()).toBe("B4:C5");
    expect([s.value("Sheet1", "B4"), s.value("Sheet1", "C4"), s.value("Sheet1", "B5"), s.value("Sheet1", "C5")]).toEqual([1, "a", 2, "b"]);
    expect(s.value("Sheet1", "A1")).toBe(null);
    expect(s.cell("Sheet1", "C1")?.f).toBe("B4+B5"); // the formula follows the cells it read
    act(() => void s.undo());
    expect(s.value("Sheet1", "A1")).toBe(1);
  });

  it("a drag that ends where it began moves nothing, and a gesture the browser takes over puts nothing down", () => {
    const s = mount();
    tap(1, 1);
    const grip = mover()!;
    const from = at(grip);
    fire("pointerdown", from, "touch", grip);
    fire("pointermove", { clientX: from.clientX, clientY: from.clientY + 4 }, "touch", grip);
    fire("pointerup", { clientX: from.clientX, clientY: from.clientY + 4 }, "touch", grip);
    expect(s.value("Sheet1", "A1")).toBe(1);
    expect(namebox()).toBe("A1");
    const again = mover()!;
    fire("pointerdown", at(again), "touch", again);
    fire("pointermove", { clientX: at(again).clientX, clientY: at(again).clientY + 3 * 20 }, "touch", again);
    expect(preview()).not.toBeNull();
    fire("pointercancel", { clientX: at(again).clientX, clientY: at(again).clientY + 3 * 20 }, "touch", again);
    expect(preview()).toBeNull();
    expect(s.value("Sheet1", "A1")).toBe(1);
    expect(s.value("Sheet1", "A4")).toBe(null);
  });

  it("a drop that is refused shows why and puts nothing down", () => {
    const s = mount();
    act(() => s.mergeCells("Sheet1", "E1:F1"));
    tap(1, 1);
    const grip = mover()!;
    const from = at(grip);
    fire("pointerdown", from, "touch", grip);
    // onto half of the merged cells E1:F1: from the handle (right of A1) four columns on is E... move A1 onto F1
    const to = { clientX: from.clientX + 4 * 64, clientY: from.clientY };
    fire("pointermove", to, "touch", grip);
    expect(preview()!.hasAttribute("data-refused")).toBe(true);
    fire("pointerup", to, "touch", grip);
    expect(s.value("Sheet1", "A1")).toBe(1);
  });
});
