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
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a number format with * in the grid", () => {
  it("stretches the fill character between the two parts of the text", () => {
    const s = new SheetSession(createWorkbook("t", ["Sheet1"]));
    s.setCell("Sheet1", "A1", 5);
    s.setFormat("Sheet1", "A1", "$* 0");
    s.setColumnWidth("Sheet1", 1, 200);
    s.setCell("Sheet1", "A2", 7);
    s.setFormat("Sheet1", "A2", "0.0");
    act(() => root.render(<PliSheet session={s} />));
    const filled = host.querySelectorAll(".pli-cell-filled");
    expect(filled).toHaveLength(1);
    const parts = [...filled[0]!.querySelectorAll("span")].map((x) => x.textContent!.slice(0, 3));
    expect(parts[0]).toBe("$");
    expect(parts[1]).toBe("   ");
    expect(parts[2]).toBe("5");
  });
});
