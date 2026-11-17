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

// Row headers are 48 wide and column headers 24 tall; columns 64 wide and rows 20 tall.
const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const left = (col: number) => 48 + (col - 1) * 64;
const top = (row: number) => 24 + (row - 1) * 20;

function mount() {
  const session = new SheetSession(createWorkbook("t"), { now: () => 45000 });
  session.setCells("Sheet1", { A1: "Title", C1: "=A1&\"!\"", A3: 1, B3: 2 });
  session.mergeCells("Sheet1", "A1:B1");
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const nameBox = () => q<HTMLInputElement>(".pli-sheet-namebox").value;
function pointer(type: string, xy: { clientX: number; clientY: number }, extra: MouseEventInit = {}) {
  act(() => {
    q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy, ...extra }));
  });
}
const click = (row: number, col: number) => {
  pointer("pointerdown", cellXY(row, col));
  pointer("pointerup", cellXY(row, col));
};
/** Drags from a point to another with the pointer, in steps like a real drag. */
function drag(from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, extra: MouseEventInit = {}) {
  pointer("pointerdown", from, extra);
  pointer("pointermove", to, extra);
  return () => pointer("pointerup", to, extra);
}

describe("dragging merged cells", () => {
  it("clicking a merged cell selects the range, and dragging its edge moves the merge with its value", () => {
    const s = mount();
    click(1, 1);
    expect(nameBox()).toBe("A1:B1");
    const up = drag({ clientX: left(1) + 1, clientY: top(1) + 10 }, { clientX: left(1) + 1 + 64 * 3, clientY: top(1) + 10 + 20 * 4 });
    expect(q(".pli-grid-fill-preview[data-move]")).toBeTruthy();
    expect(q(".pli-grid-fill-preview[data-move]").hasAttribute("data-refused")).toBe(false);
    up();
    expect(s.merges("Sheet1")).toEqual(["D5:E5"]);
    expect(s.cell("Sheet1", "D5")?.v).toBe("Title");
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(s.cell("Sheet1", "C1")?.f).toBe('D5&"!"');
    expect(nameBox()).toBe("D5:E5");
    act(() => void s.undo());
    expect(s.merges("Sheet1")).toEqual(["A1:B1"]);
  });

  it("with Ctrl it copies the merge", () => {
    const s = mount();
    click(1, 1);
    drag({ clientX: left(1) + 1, clientY: top(1) + 10 }, { clientX: left(1) + 1, clientY: top(1) + 10 + 20 * 5 }, { ctrlKey: true })();
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "A6:B6"]);
    expect(s.cell("Sheet1", "A6")?.v).toBe("Title");
  });

  it("a range that holds a merge can be dragged, and the merge goes with it", () => {
    const s = mount();
    click(1, 1);
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(2, 3), { shiftKey: true });
    pointer("pointerup", cellXY(2, 3), { shiftKey: true });
    expect(nameBox()).toBe("A1:C2");
    drag({ clientX: left(1) + 1, clientY: top(2) + 10 }, { clientX: left(1) + 1 + 64 * 2, clientY: top(2) + 10 + 20 * 7 })();
    expect(nameBox()).toBe("C8:E9");
    expect(s.merges("Sheet1")).toEqual(["C8:D8"]);
    expect(s.cell("Sheet1", "C8")?.v).toBe("Title");
  });

  it("shows a drop that would hit other merged cells in red and refuses it, saying why", () => {
    const s = mount();
    s.mergeCells("Sheet1", "D5:E6");
    click(1, 1);
    const up = drag({ clientX: left(1) + 1, clientY: top(1) + 10 }, { clientX: left(1) + 1 + 64 * 3, clientY: top(1) + 10 + 20 * 4 });
    expect(q(".pli-grid-fill-preview[data-move]").hasAttribute("data-refused")).toBe(true);
    up();
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "D5:E6"]);
    expect(s.cell("Sheet1", "A1")?.v).toBe("Title");
    expect(host.textContent).toContain("D5:E6");
  });

  it("refuses to drop onto a locked cell of a protected sheet", () => {
    const s = mount();
    s.protectSheet("Sheet1");
    click(1, 1);
    expect(s.relocateProblem({ sheet: "Sheet1", range: "A1:B1" }, { sheet: "Sheet1", at: "D5" })).toMatch(/locked/);
  });

  it("dragging the fill handle of a merged range repeats the merge", () => {
    const s = mount();
    click(1, 1);
    const handle = { clientX: left(3), clientY: top(2) };
    drag(handle, { clientX: left(1) + 10, clientY: top(4) + 10 })();
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "A2:B2", "A3:B3", "A4:B4"]);
    expect(s.cell("Sheet1", "A3")?.v).toBe("Title");
  });

  it("the fill handle refuses to run over merged cells in the way", () => {
    const s = mount();
    s.mergeCells("Sheet1", "A3:B4");
    click(1, 1);
    const up = drag({ clientX: left(3), clientY: top(2) }, { clientX: left(1) + 10, clientY: top(4) + 10 });
    expect(q(".pli-grid-fill-preview:not([data-move])").hasAttribute("data-refused")).toBe(true);
    up();
    expect(s.merges("Sheet1")).toEqual(["A1:B1", "A3:B4"]);
    expect(host.textContent).toContain("A3:B4");
  });
});
