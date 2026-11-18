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

const session = () => new SheetSession(createWorkbook("Budget"));

describe("PliSheet: the theme prop", () => {
  it("writes nothing for auto and forces light or dark otherwise", () => {
    act(() => root.render(<PliSheet session={session()} />));
    expect(host.querySelector(".pli-spreadsheet")!.hasAttribute("data-theme")).toBe(false);
    act(() => root.render(<PliSheet session={session()} theme="dark" />));
    expect(host.querySelector(".pli-spreadsheet")!.getAttribute("data-theme")).toBe("dark");
    act(() => root.render(<PliSheet session={session()} theme="light" />));
    expect(host.querySelector(".pli-spreadsheet")!.getAttribute("data-theme")).toBe("light");
  });

  it("carries the theme to dialogs", () => {
    act(() => root.render(<PliSheet session={session()} theme="dark" />));
    const dialogs = [...host.querySelectorAll("dialog")];
    expect(dialogs.length).toBeGreaterThan(0);
    for (const d of dialogs) expect(d.getAttribute("data-theme")).toBe("dark");
  });
});

describe("PliSheet: slots in the title row", () => {
  it("puts startActions before the title and endActions last", () => {
    act(() => root.render(<PliSheet session={session()} startActions={<button id="back">Back</button>} actions={<button id="mid">Export</button>} endActions={<button id="end">Account</button>} />));
    const bar = host.querySelector(".pli-titlebar")!;
    const order = [...bar.querySelectorAll("#back, .pli-doc-title, #mid, #end")].map((el) => el.id || el.className);
    expect(order).toEqual(["back", "pli-doc-title", "mid", "end"]);
  });
});
