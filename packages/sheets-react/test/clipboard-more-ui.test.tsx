// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OUTSIDE = readFileSync(join(process.cwd(), "packages/sheets/test/fixtures/clipboard/excel-formulas-outside.html"), "utf8");
const SHEETS_RANGE = readFileSync(join(process.cwd(), "packages/sheets/test/fixtures/clipboard/google-sheets-range.html"), "utf8");

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
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const click = (row: number, col: number) => (pointer("pointerdown", cellXY(row, col)), pointer("pointerup", cellXY(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const btn = (e: Element, init: MouseEventInit = {}) => act(() => void e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
const menu = (name: string) => [...host.querySelectorAll<HTMLElement>(".pli-menubar button")].find((b) => b.textContent === name)!;
const item = (text: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox]")].find((e) => e.textContent?.includes(text))!;

function mount(setup: (s: SheetSession) => void = () => {}) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]), { now: () => 45000 });
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

const paste = (text: string, html: string) =>
  act(() => {
    const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    e.clipboardData = { getData: (t: string) => (t === "text/html" ? html : t === "text/plain" ? text : ""), files: [] };
    sink().dispatchEvent(e);
  });

const copyOut = () => {
  const clip: Record<string, string> = {};
  const copy = new Event("copy", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  copy.clipboardData = { setData: (t: string, v: string) => (clip[t] = v) };
  act(() => void sink().dispatchEvent(copy));
  return clip;
};


const withClipboard = (clip: Record<string, string>) =>
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      read: async () => [{ types: Object.keys(clip), getType: async (t: string) => ({ text: async () => clip[t]! }) }],
      readText: async () => clip["text/plain"]!,
    },
  });

const special = async (name: string) => {
  btn(menu("Edit"));
  btn(item("Paste special"));
  await act(async () => {
    btn(item(name));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("Edit > Paste special > Transpose", () => {
  it("turns a range copied here, and selects the turned range", async () => {
    const s = mount((x) => x.setValues("Sheet1", "A1", [[1, 2, 3], [4, 5, "=A2+B2"]]));
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    const clip = copyOut();
    withClipboard(clip);
    click(5, 5);
    await special("Transpose");
    expect(s.values("Sheet1", "E5:F7")).toEqual([[1, 4], [2, 5], [3, 9]]);
    expect(s.cell("Sheet1", "F7")?.f).toBe("F5+F6");
    s.undo();
    expect(s.cell("Sheet1", "E5")).toBeUndefined();
  });

  it("a cut with Transpose moves the cells", async () => {
    const s = mount((x) => x.setValues("Sheet1", "A1", [[1, 2]]));
    click(1, 1);
    key("ArrowRight", { shiftKey: true });
    const clip = copyOut();
    act(() => void sink().dispatchEvent(Object.assign(new Event("cut", { bubbles: true, cancelable: true }), { clipboardData: { setData: () => {} } })));
    withClipboard(clip);
    click(4, 4);
    await special("Transpose");
    expect(s.values("Sheet1", "D4:D5")).toEqual([[1], [2]]);
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
  });

  it("turns another program's table", async () => {
    const s = mount();
    withClipboard({ "text/plain": "1\t2\n3\t4", "text/html": '<table><tr><td x:num="1">1</td><td x:num="2">2</td></tr><tr><td x:num="3">3</td><td x:num="4">4</td></tr></table>' });
    click(2, 2);
    await special("Transpose");
    expect(s.values("Sheet1", "B2:C3")).toEqual([[1, 3], [2, 4]]);
  });

  it("turns Google Sheets' range and its formulas", async () => {
    const s = mount();
    withClipboard({ "text/plain": "Item", "text/html": SHEETS_RANGE });
    click(1, 1);
    await special("Transpose");
    expect(s.cell("Sheet1", "B4")?.f).toBe("B2*B3");
  });
});

describe("Edit > Paste special > Formulas from Excel…", () => {
  const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
  const submitDialog = () => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Paste")!.click();
  const type = (el: HTMLInputElement, value: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("reads formulas that point outside the copied cells from the cell you name", async () => {
    const s = mount();
    withClipboard({ "text/plain": "20\t30\n21\t31", "text/html": OUTSIDE });
    click(10, 4);
    // Without help they stay values, and the notice says how to bring them.
    await special("Values only");
    btn(menu("Edit"));
    btn(item("Paste special"));
    btn(item("Formulas from Excel"));
    expect(dialog()).toBeTruthy();
    type(dialog().querySelector<HTMLInputElement>("input[type=text]")!, "A2");
    await act(async () => {
      submitDialog();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.cell("Sheet1", "D10")?.f).toBe("E10*10");
  });

  it("with the box empty reads them as written", async () => {
    const s = mount();
    withClipboard({ "text/plain": "20\t30\n21\t31", "text/html": OUTSIDE });
    click(10, 4);
    btn(menu("Edit"));
    btn(item("Paste special"));
    btn(item("Formulas from Excel"));
    await act(async () => {
      submitDialog();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.cell("Sheet1", "D10")?.f).toBe("B2*10");
  });

  it("says when what was typed is not a cell", () => {
    mount();
    btn(menu("Edit"));
    btn(item("Paste special"));
    btn(item("Formulas from Excel"));
    type(dialog().querySelector<HTMLInputElement>("input[type=text]")!, "nope");
    act(() => void submitDialog());
    expect(dialog().textContent).toMatch(/not a cell address/);
  });

  it("the notice for formulas that were left says where to look", () => {
    mount();
    click(10, 4);
    paste("20\t30\n21\t31", OUTSIDE);
    expect(q(".pli-notice").textContent).toMatch(/Formulas from Excel/);
  });
});
