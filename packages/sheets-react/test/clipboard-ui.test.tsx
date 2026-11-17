// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EXCEL_FORMULAS = readFileSync(join(process.cwd(), "packages/sheets/test/fixtures/clipboard/excel-formulas.html"), "utf8");
const SHEETS_FORMULAS = readFileSync(join(process.cwd(), "packages/sheets/test/fixtures/clipboard/sheets-formulas.html"), "utf8");

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

describe("formulas and sizes from other programs", () => {
  it("pastes Excel's formulas, shifted, with the widths of the source into empty space", () => {
    const s = mount();
    click(10, 6);
    paste("1\t2\t3\n4\t5\t9\n5\t7\t12", EXCEL_FORMULAS);
    expect(s.cell("Sheet1", "H10")?.f).toBe("F10+G10");
    expect(s.cell("Sheet1", "F12")?.f).toBe("SUM(F10:F11)");
    expect(s.state.sheets[0]!.columns).toMatchObject({ F: { size: 10.71 } }); // 80px
    s.undo();
    expect(s.cell("Sheet1", "H10")).toBeUndefined();
    expect(s.state.sheets[0]!.columns).toBeUndefined();
  });

  it("says which formulas it could not bring", () => {
    const s = mount();
    click(5, 3);
    paste("", SHEETS_FORMULAS);
    expect(s.cell("Sheet1", "E5")?.f).toBe("C5+D5");
    expect(q(".pli-notice").textContent).toMatch(/1 formula/);
  });

  it("Ctrl+Shift+V pastes the values only", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "A1", [[1, 2], ["=A1+B1", null]]);
      x.setStyle("Sheet1", "A2", { bold: true });
    });
    click(2, 1);
    const clip = copyOut();
    click(5, 5);
    key("v", { ctrlKey: true, shiftKey: true });
    paste(clip["text/plain"]!, clip["text/html"]!);
    expect(s.cell("Sheet1", "E5")).toEqual({ v: 3 });
    click(6, 5);
    key("v", { ctrlKey: true });
    paste(clip["text/plain"]!, clip["text/html"]!);
    expect(s.cell("Sheet1", "E6")).toMatchObject({ f: "E5+F5", s: { bold: true } });
  });

  it("Edit > Paste special > Formulas, Values only and Keep source column widths", async () => {
    const s = mount((x) => x.setValues("Sheet1", "A1", [[4, "=A1*2"]]));
    click(1, 2);
    const clip = copyOut();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: async () => [{ types: ["text/plain", "text/html"], getType: async (t: string) => ({ text: async () => clip[t]! }) }],
        readText: async () => clip["text/plain"]!,
      },
    });
    const choose = async (name: string) => {
      btn(menu("Edit"));
      btn(item("Paste special"));
      await act(async () => {
        btn(item(name));
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      });
    };
    click(3, 1);
    await choose("Values only");
    expect(s.cell("Sheet1", "A3")).toEqual({ v: 8 });
    click(4, 3);
    await choose("Formulas");
    expect(s.cell("Sheet1", "C4")).toEqual({ f: "B4*2" });
    s.setColumnWidth("Sheet1", 2, 30);
    click(6, 3);
    await choose("Keep source column widths");
    expect(s.state.sheets[0]!.columns).toMatchObject({ B: { size: 30 }, C: { size: 30 } });
  });
});

describe("copying a table as a table", () => {
  it("Ctrl+C and Ctrl+V of a whole table make a new table; another program's pasted HTML does too", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "A1", [["Item", "Qty"], ["pen", 2], ["ink", 3]]);
      x.createTable("Sheet1", "A1:B3", { name: "Stock", style: "TableStyleMedium2" });
    });
    click(1, 1);
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    const clip = copyOut();
    expect(clip["text/html"]).toContain("data-pli-tables");
    click(1, 5);
    paste(clip["text/plain"]!, clip["text/html"]!);
    expect(s.tables("Sheet1").map((t) => [t.name, t.range])).toEqual([["Stock", "A1:B3"], ["Stock2", "E1:F3"]]);
    // From another window the text is not ours, so the HTML is read: the same table again.
    click(10, 1);
    paste("different", clip["text/html"]!);
    expect(s.tables("Sheet1").map((t) => t.name)).toEqual(["Stock", "Stock2", "Stock3"]);
  });
});
