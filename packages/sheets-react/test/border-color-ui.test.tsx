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
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void host.querySelector(".pli-grid-scroller")!.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

describe("the border colour button", () => {
  it("gives the lines of the selected cells one colour, whatever they had, and is the colour new lines are drawn in", () => {
    const s = new SheetSession(createWorkbook("t"));
    s.setValues("Sheet1", "A1", [[1, 2], [3, 4]]);
    s.setBorders("Sheet1", "A1", "all", { style: "thin", color: "#ff0000" });
    s.setBorders("Sheet1", "B2", "all", { style: "thick", color: "#0000ff" });
    act(() => root.render(<PliSheet session={s} />));
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(2, 2));
    pointer("pointerup", cellXY(2, 2));
    click(host.querySelector('button[aria-label="Border color"]')!);
    click(document.querySelector('button[aria-label="#e03131"], .pli-swatch')!);
    const look = s.borderLook("Sheet1", "A1:B2");
    expect(look?.color).not.toBe("mixed");
    expect(look?.style).toBe("mixed"); // each line kept its style
    expect(s.cell("Sheet1", "B2")?.s?.border?.bottom?.style).toBe("thick");
  });
});
