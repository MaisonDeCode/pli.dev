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
/** Where a handle is, as the pointer would find it. */
const at = (el: HTMLElement) => ({ clientX: parseFloat(el.style.left), clientY: parseFloat(el.style.top) });

function mount() {
  const session = new SheetSession(createWorkbook("t"));
  session.setValues("Sheet1", "A1", [[1, "a"], [2, "b"]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("touch: handles", () => {
  it("draws the handles and header grips only for a finger", () => {
    mount();
    expect(all(".pli-grid-touchhandle, .pli-grid-touchgrip")).toHaveLength(0);
    fire("pointerdown", cellXY(2, 2), "mouse");
    fire("pointerup", cellXY(2, 2), "mouse");
    expect(all(".pli-grid-touchhandle, .pli-grid-touchgrip")).toHaveLength(0);
    tap(2, 2);
    expect(all(".pli-grid-touchhandle").map((h) => h.dataset.handle)).toEqual(["start", "end", "fill"]);
    expect(all(".pli-grid-touchgrip").length).toBeGreaterThan(10);
    // a pen or a mouse takes them away again
    fire("pointerdown", cellXY(3, 3), "pen");
    fire("pointerup", cellXY(3, 3), "pen");
    expect(all(".pli-grid-touchhandle, .pli-grid-touchgrip")).toHaveLength(0);
  });

  it("dragging the round handles stretches the selection from the opposite corner", () => {
    mount();
    tap(2, 2);
    expect(namebox()).toBe("B2");
    const end = handle("end");
    expect(at(end)).toEqual({ clientX: 48 + 2 * 64, clientY: 24 + 2 * 20 }); // the bottom right corner of B2
    fire("pointerdown", at(end), "touch", end);
    fire("pointermove", cellXY(5, 4), "touch", end);
    fire("pointerup", cellXY(5, 4), "touch", end);
    expect(namebox()).toBe("B2:D5");
    const start = handle("start");
    fire("pointerdown", at(start), "touch", start);
    fire("pointermove", cellXY(1, 1), "touch", start);
    fire("pointerup", cellXY(1, 1), "touch", start);
    expect(namebox()).toBe("A1:D5");
  });

  it("the square handle fills: dragging it down copies a series, as the mouse's fill handle does", () => {
    const s = mount();
    tap(1, 1);
    const end = handle("end");
    fire("pointerdown", at(end), "touch", end);
    fire("pointermove", cellXY(2, 1), "touch", end);
    fire("pointerup", cellXY(2, 1), "touch", end);
    expect(namebox()).toBe("A1:A2");
    const fill = handle("fill");
    fire("pointerdown", at(fill), "touch", fill);
    fire("pointermove", cellXY(5, 1), "touch", fill);
    expect(q(".pli-grid-fill-preview")).toBeTruthy();
    fire("pointerup", cellXY(5, 1), "touch", fill);
    expect([3, 4, 5].map((n) => s.value("Sheet1", `A${n}`))).toEqual([3, 4, 5]);
    expect(namebox()).toBe("A1:A5");
  });

  it("the handles are not offered on a read-only sheet, nor while typing, nor for whole columns", () => {
    const s = new SheetSession(createWorkbook("t"));
    act(() => root.render(<PliSheet session={s} readOnly />));
    tap(1, 1);
    expect(all(".pli-grid-touchhandle")).toHaveLength(0);
    act(() => root.render(<PliSheet session={s} />));
    tap(1, 1);
    expect(all(".pli-grid-touchhandle")).toHaveLength(3);
    fire("pointerdown", { clientX: 48 + 10, clientY: 10 });
    fire("pointerup", { clientX: 48 + 10, clientY: 10 }); // the column heading A
    expect(namebox()).toBe("A:A");
    expect(all(".pli-grid-touchhandle")).toHaveLength(0);
  });
});

describe("touch: taps, scrolling and long presses", () => {
  it("a tap selects when the finger is lifted; a finger that moves is a scroll and selects nothing", () => {
    mount();
    fire("pointerdown", cellXY(3, 3));
    expect(namebox()).toBe("A1"); // not yet
    fire("pointerup", cellXY(3, 3));
    expect(namebox()).toBe("C3");
    fire("pointerdown", cellXY(5, 5));
    fire("pointermove", { clientX: cellXY(5, 5).clientX, clientY: cellXY(5, 5).clientY - 60 });
    fire("pointercancel", { clientX: cellXY(5, 5).clientX, clientY: cellXY(5, 5).clientY - 60 }); // the browser took the gesture to scroll
    expect(namebox()).toBe("C3");
    fire("pointerdown", cellXY(5, 5));
    fire("pointermove", { clientX: cellXY(5, 5).clientX + 80, clientY: cellXY(5, 5).clientY });
    fire("pointerup", { clientX: cellXY(5, 5).clientX + 80, clientY: cellXY(5, 5).clientY });
    expect(namebox()).toBe("C3"); // lifted somewhere else after moving: still a scroll
  });

  it("a small wobble is still a tap, and tapping a heading selects the whole column", () => {
    mount();
    fire("pointerdown", cellXY(2, 2));
    fire("pointermove", { clientX: cellXY(2, 2).clientX + 3, clientY: cellXY(2, 2).clientY + 2 });
    fire("pointerup", cellXY(2, 2));
    expect(namebox()).toBe("B2");
    fire("pointerdown", { clientX: 48 + 64 + 10, clientY: 10 });
    fire("pointerup", { clientX: 48 + 64 + 10, clientY: 10 });
    expect(namebox()).toBe("B:B");
  });

  it("a long press opens the cell menu on the cell pressed, and the lift afterwards selects nothing else", () => {
    vi.useFakeTimers();
    mount();
    tap(1, 1);
    fire("pointerdown", cellXY(4, 3));
    expect(document.querySelector(".pli-grid-menu")).toBeNull();
    act(() => void vi.advanceTimersByTime(600));
    expect(document.querySelector(".pli-grid-menu")).not.toBeNull();
    expect(namebox()).toBe("C4");
    fire("pointerup", cellXY(4, 3));
    expect(namebox()).toBe("C4");
  });

  it("a long press inside the selection keeps it; moving first cancels the press; a short press opens no menu", () => {
    vi.useFakeTimers();
    mount();
    tap(1, 1);
    const end = handle("end");
    fire("pointerdown", at(end), "touch", end);
    fire("pointermove", cellXY(3, 3), "touch", end);
    fire("pointerup", cellXY(3, 3), "touch", end);
    expect(namebox()).toBe("A1:C3");
    fire("pointerdown", cellXY(2, 2));
    act(() => void vi.advanceTimersByTime(600));
    expect(document.querySelector(".pli-grid-menu")).not.toBeNull();
    expect(namebox()).toBe("A1:C3");
    fire("pointerup", cellXY(2, 2));
    act(() => void document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector(".pli-grid-menu")).toBeNull();
    // moving cancels
    fire("pointerdown", cellXY(6, 6));
    fire("pointermove", { clientX: cellXY(6, 6).clientX + 40, clientY: cellXY(6, 6).clientY });
    act(() => void vi.advanceTimersByTime(600));
    expect(document.querySelector(".pli-grid-menu")).toBeNull();
    fire("pointercancel", cellXY(6, 6));
    // lifted early
    fire("pointerdown", cellXY(7, 7));
    act(() => void vi.advanceTimersByTime(100));
    fire("pointerup", cellXY(7, 7));
    act(() => void vi.advanceTimersByTime(600));
    expect(document.querySelector(".pli-grid-menu")).toBeNull();
  });

  it("the mouse still selects at once and a right click still opens the menu", () => {
    mount();
    fire("pointerdown", cellXY(3, 3), "mouse");
    expect(namebox()).toBe("C3");
    fire("pointerup", cellXY(3, 3), "mouse");
    fire("contextmenu", cellXY(4, 4), "mouse");
    expect(document.querySelector(".pli-grid-menu")).not.toBeNull();
  });
});

describe("touch: heading edges", () => {
  it("dragging a grip at the edge of a column heading resizes the column, and a grip on a row resizes the row", () => {
    const s = mount();
    tap(1, 1);
    const grip = q(`.pli-grid-touchgrip[data-grip="col"][data-index="2"]`);
    const edge = 48 + 2 * 64;
    expect(parseFloat(grip.style.left) + 11).toBe(edge);
    fire("pointerdown", { clientX: edge, clientY: 12 }, "touch", grip);
    fire("pointermove", { clientX: edge + 40, clientY: 12 }, "touch", grip);
    fire("pointerup", { clientX: edge + 40, clientY: 12 }, "touch", grip);
    const size = s.state.sheets[0]!.columns?.B?.size;
    expect(size).toBeGreaterThan(9.5); // 64 + 40 pixels is about 14.9 characters; it was about 8.4
    expect(s.state.sheets[0]!.columns?.A?.size).toBeUndefined();

    const rowGrip = q(`.pli-grid-touchgrip[data-grip="row"][data-index="3"]`);
    const bottom = 24 + 3 * 20;
    fire("pointerdown", { clientX: 20, clientY: bottom }, "touch", rowGrip);
    fire("pointermove", { clientX: 20, clientY: bottom + 20 }, "touch", rowGrip);
    fire("pointerup", { clientX: 20, clientY: bottom + 20 }, "touch", rowGrip);
    expect(s.state.sheets[0]!.rows?.["3"]?.size).toBeCloseTo(30, 0); // 20 + 20 pixels is 30 points
  });

  it("a finger at a heading edge is a plain tap on that heading, not a resize", () => {
    const s = mount();
    fire("pointerdown", { clientX: 48 + 64 - 1, clientY: 10 });
    fire("pointermove", { clientX: 48 + 64 + 30, clientY: 10 });
    fire("pointerup", { clientX: 48 + 64 + 30, clientY: 10 });
    expect(s.state.sheets[0]!.columns?.A?.size).toBeUndefined();
  });
});
