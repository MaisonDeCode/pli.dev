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
  window.confirm = () => true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const left = (col: number) => 48 + (col - 1) * 64;
const top = (row: number) => 24 + (row - 1) * 20;
const cellXY = (row: number, col: number) => ({ clientX: left(col) + 10, clientY: top(row) + 10 });
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const click = (row: number, col: number) => (pointer("pointerdown", cellXY(row, col)), pointer("pointerup", cellXY(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const btn = (e: Element) => act(() => void e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
const menu = (name: string) => [...host.querySelectorAll<HTMLElement>(".pli-menubar button")].find((b) => b.textContent === name)!;
const item = (text: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox]")].find((e) => e.textContent?.includes(text))!;
const setField = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const submit = () => act(() => void document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

function mount(setup: (s: SheetSession) => void, props: Record<string, unknown> = {}) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Lists"]), { now: () => 46000 });
  setup(session);
  act(() => root.render(<PliSheet session={session} {...props} />));
  return session;
}

describe("filling carries the validation in the grid", () => {
  it("Ctrl+D and the fill handle extend the rule of the cell they copy, each as one step", () => {
    const s = mount((x) => {
      x.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1"] });
      x.setCell("Sheet1", "A1", 4);
    });
    click(1, 1);
    // drag the handle at the corner of A1 down to A4
    pointer("pointerdown", { clientX: left(2), clientY: top(2) });
    pointer("pointermove", cellXY(4, 1));
    pointer("pointerup", cellXY(4, 1));
    expect(s.cell("Sheet1", "A4")?.v).toBe(4);
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["A1:A4"]);
    act(() => void s.undo());
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["A1"]);
    // and Ctrl+D over A1:A3
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(3, 1));
    pointer("pointerup", cellXY(3, 1));
    key("d", { ctrlKey: true });
    expect(s.validations("Sheet1")[0]!.ranges).toEqual(["A1:A3"]);
    expect(() => s.setCell("Sheet1", "A3", 11)).toThrow();
  });
});

describe("a separator for dropdown cells in the grid", () => {
  it("is asked for in Insert > Dropdown… when several choices are allowed, and joins the picks", () => {
    const s = mount(() => {});
    click(2, 2);
    btn(menu("Insert"));
    btn(item("Dropdown…"));
    const options = () => [...document.querySelectorAll<HTMLInputElement>(".pli-dropdown-options input")];
    expect(document.querySelector('input[aria-label="Separator"]')).toBeNull();
    act(() => void options()[0]!.click()); // allow several
    setField(document.querySelector<HTMLInputElement>('input[aria-label="Separator"]')!, " | ");
    submit();
    expect(s.cell("Sheet1", "B2")?.control).toMatchObject({ type: "dropdown", multiple: true, separator: " | " });
    s.pickChoice("Sheet1", "B2", "Option 1");
    s.pickChoice("Sheet1", "B2", "Option 2");
    expect(s.cell("Sheet1", "B2")?.v).toBe("Option 1 | Option 2");
  });

  it("is kept when the typed choices of a dropdown are edited in the Data validation dialog", () => {
    const s = mount((x) => x.setControl("Sheet1", "A1", { type: "dropdown", options: [{ value: "red" }, { value: "green" }], multiple: true, separator: "; " }));
    click(1, 1);
    btn(menu("Data"));
    btn(item("Data validation"));
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Separator"]')!.value).toBe("; ");
    setField(document.querySelector<HTMLInputElement>('input[aria-label="Separator"]')!, "/");
    submit();
    expect(s.cell("Sheet1", "A1")?.control).toMatchObject({ type: "dropdown", multiple: true, separator: "/" });
    // a separator that is only spaces is refused with a reason
    btn(menu("Data"));
    btn(item("Data validation"));
    setField(document.querySelector<HTMLInputElement>('input[aria-label="Separator"]')!, "  ");
    submit();
    expect(document.querySelector("dialog[open]")!.textContent).toContain("Give the separator");
    expect(s.cell("Sheet1", "A1")?.control).toMatchObject({ separator: "/" });
  });
});

describe("validation rules that read other workbooks in the grid", () => {
  it("sets a limit read from another workbook and says how its copy stands", () => {
    const s = mount((x) => x.setExternalCells("Limits.xlsx", "Sheet1", { A1: 10 }, { read: "2025-12-09" }));
    click(1, 1);
    btn(menu("Data"));
    btn(item("Data validation"));
    setField(document.querySelector<HTMLSelectElement>("select")!, "whole");
    setField(document.querySelector<HTMLInputElement>('input[placeholder="10 or A1"]')!, "1");
    setField(document.querySelectorAll<HTMLInputElement>(".pli-chartform-pair input")[1]!, "[Limits.xlsx]Sheet1!$A$1");
    submit();
    expect(s.validations("Sheet1")[0]).toMatchObject({ kind: "whole", values: ["1", "[Limits.xlsx]Sheet1!$A$1"] });
    expect(() => s.setCell("Sheet1", "A1", 11)).toThrow();
    btn(menu("Data"));
    btn(item("Data validation"));
    const status = document.querySelector(".pli-ruleform-external")!;
    expect(status.textContent).toBe("Limits.xlsx: copy kept in the workbook, read 2025-12-09 (may be out of date)");
  });

  it("is read again from Data > Refresh links to other workbooks, for formulas as well as rules", async () => {
    const asked: string[] = [];
    const s = mount((x) => x.setCell("Sheet1", "B1", "=[Prices.xlsx]Sheet1!A2*2"), { externalLists: (book: string, ref: string) => (asked.push(`${book}|${ref}`), [21]) });
    await act(async () => {});
    expect(asked).toEqual(["Prices.xlsx|Sheet1!$A$2"]);
    expect(s.value("Sheet1", "B1")).toBe(42);
    asked.length = 0;
    btn(menu("Data"));
    expect(item("Refresh links to other workbooks").hasAttribute("disabled") || item("Refresh links to other workbooks").getAttribute("aria-disabled") === "true").toBe(false);
    await act(async () => void item("Refresh links to other workbooks").click());
    expect(asked).toEqual(["Prices.xlsx|Sheet1!$A$2"]);
    expect(host.querySelector(".pli-notice")?.textContent).toContain("Links read again: 0 changed, 1 the same.");
  });
});
