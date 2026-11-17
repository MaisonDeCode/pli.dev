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

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const click = (row: number, col: number) => (pointer("pointerdown", cellXY(row, col)), pointer("pointerup", cellXY(row, col)));
const key = (k: string) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
const type = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(sink(), text);
    sink().dispatchEvent(new Event("input", { bubbles: true }));
  });
const mode = () => q(".pli-sheet-mode").textContent;

describe("the status bar says Ready, Enter, Edit or Point", () => {
  it("follows the entry", () => {
    act(() => root.render(<PliSheet session={new SheetSession(createWorkbook("t", ["Sheet1"]))} />));
    expect(mode()).toBe("Ready");
    click(2, 2);
    type("ab");
    expect(mode()).toBe("Enter");
    key("F2");
    expect(mode()).toBe("Edit");
    key("F2");
    expect(mode()).toBe("Enter");
    key("Escape");
    expect(mode()).toBe("Ready");
    type("=");
    expect(mode()).toBe("Point");
    type("=A1");
    expect(mode()).toBe("Enter");
  });

  it("is left out with the status bar", () => {
    act(() => root.render(<PliSheet session={new SheetSession(createWorkbook("t", ["Sheet1"]))} statusBar={false} />));
    expect(host.querySelector(".pli-sheet-mode")).toBeNull();
  });
});
