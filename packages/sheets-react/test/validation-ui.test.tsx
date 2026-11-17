// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
let answer = true;
let asked: string[] = [];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  answer = true;
  asked = [];
  window.confirm = (m?: string) => (asked.push(String(m)), answer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const click = (row: number, col: number) => (pointer("pointerdown", cellXY(row, col)), pointer("pointerup", cellXY(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const type = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(sink(), text);
    sink().dispatchEvent(new Event("input", { bubbles: true }));
  });
const btn = (e: Element, init: MouseEventInit = {}) => act(() => void e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
const dataMenu = () => [...host.querySelectorAll<HTMLElement>(".pli-menubar button")].find((b) => b.textContent === "Data")!;
const item = (text: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox]")].find((e) => e.textContent?.includes(text))!;

function mount(setup: (s: SheetSession) => void) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Lists"]), { now: () => 45000 });
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("data validation in the grid", () => {
  it("keeps a refused entry in the editor with the reason, and takes a good one", () => {
    const s = mount((x) => x.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1:A5"] }));
    click(1, 1);
    type("50");
    key("Enter");
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    expect(sink().hasAttribute("data-editing")).toBe(true);
    expect(q(".pli-notice").textContent).toContain("Enter a whole number between 1 and 10.");
    type("5");
    key("Enter");
    expect(s.cell("Sheet1", "A1")?.v).toBe(5);
  });

  it("asks before it lets a warning through, and keeps editing when told no", () => {
    const s = mount((x) => x.addValidation("Sheet1", { kind: "whole", op: "equal", values: ["1"], ranges: ["A1"], alert: "warning", errorTitle: "Careful", error: "That isn't 1." }));
    click(1, 1);
    type("7");
    answer = false;
    key("Enter");
    expect(asked[0]).toContain("Careful");
    expect(asked[0]).toContain("That isn't 1.");
    expect(s.cell("Sheet1", "A1")).toBeUndefined();
    answer = true;
    key("Enter");
    expect(s.cell("Sheet1", "A1")?.v).toBe(7);
  });

  it("shows the input message beside the selected cell", () => {
    mount((x) => x.addValidation("Sheet1", { kind: "decimal", op: "greaterThan", values: ["0"], ranges: ["B2"], promptTitle: "Price", prompt: "More than nothing" }));
    expect(host.querySelector(".pli-grid-prompt")).toBeNull();
    click(2, 2);
    expect(q(".pli-grid-prompt").textContent).toBe("PriceMore than nothing");
    click(3, 3);
    expect(host.querySelector(".pli-grid-prompt")).toBeNull();
  });

  it("circles the cells that break a rule", () => {
    mount((x) => {
      x.setValues("Sheet1", "A1", [[5], [50], [7]]);
      x.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1:A3"] });
    });
    btn(dataMenu());
    btn(item("Circle invalid data"));
    expect(host.querySelectorAll(".pli-grid-invalid")).toHaveLength(1);
    expect(q<HTMLElement>(".pli-grid-invalid").style.top).toBe("20px"); // row 2
  });

  it("opens the list of a validation from its arrow and puts the choice in the cell", () => {
    const s = mount((x) => {
      x.setValues("Lists", "A1", [["red"], ["green"]]);
      x.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$2", ranges: ["B1:B3"] });
    });
    click(1, 2);
    btn(q(".pli-grid-choicebtn"));
    // the button is drawn; opening the list is done from the keyboard too
    key("ArrowDown", { altKey: true });
    const choice = [...document.querySelectorAll<HTMLElement>(".pli-choice-item")].find((e) => e.textContent === "green")!;
    expect(choice).toBeTruthy();
    btn(choice);
    expect(s.cell("Sheet1", "B1")?.v).toBe("green");
  });

  it("is set from the dialog, with typed choices becoming a dropdown", () => {
    const s = mount(() => {});
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(3, 1));
    pointer("pointerup", cellXY(3, 1));
    btn(dataMenu());
    btn(item("Data validation"));
    const field = (sel: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
    const set = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
      act(() => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      });
    expect(field('input[placeholder="B2:B20"]').value).toBe("A1:A3");
    set(field("select"), "whole");
    set(field('input[placeholder="10 or A1"]'), "1");
    set(document.querySelectorAll<HTMLInputElement>(".pli-chartform-pair input")[1]!, "10");
    act(() => void document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(s.validations("Sheet1")[0]).toMatchObject({ kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1:A3"] });
    expect(() => s.setCell("Sheet1", "A2", 11)).toThrow();

    // Typed choices make a dropdown cell, as Insert > Dropdown does.
    btn(dataMenu());
    btn(item("Data validation"));
    set(field("select"), "list");
    set(field('input[placeholder^="=Lists"]'), "red, green");
    act(() => void document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(s.validations("Sheet1")).toEqual([]);
    expect(s.cell("Sheet1", "A2")?.control).toMatchObject({ type: "dropdown", strict: true, options: [{ value: "red" }, { value: "green" }] });
  });
});

describe("tables in the grid", () => {
  it("draws a table's style, and makes one from the Insert menu", () => {
    const s = mount((x) => x.setValues("Sheet1", "A1", [["Item", "Qty"], ["Pens", 10], ["Ink", 2]]));
    const insert = [...host.querySelectorAll<HTMLElement>(".pli-menubar button")].find((b) => b.textContent === "Insert")!;
    click(2, 1);
    btn(insert);
    btn(item("Table…"));
    const range = document.querySelector<HTMLInputElement>('input[placeholder="A1:D20"]')!;
    expect(range.value).toBe("A1:B3"); // the block around the active cell
    act(() => void document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(s.tables("Sheet1")[0]).toMatchObject({ name: "Table1", range: "A1:B3" });
    const header = [...host.querySelectorAll<HTMLElement>(".pli-cell")].find((c) => c.textContent === "Item")!;
    expect(header.style.background).toBe("rgb(68, 114, 196)");
    expect(header.querySelector<HTMLElement>(".pli-cell-text")!.style.fontWeight).toBe("700");
  });

  it("goes to a table by its name in the name box, and renames it from the Format menu", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "B2", [["Item", "Qty"], ["Pens", 10], ["Ink", 2]]);
      x.createTable("Sheet1", "B2:C4", { name: "Orders" });
    });
    const box = q<HTMLInputElement>(".pli-sheet-namebox");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "Orders");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("B3:C4");
    const format = [...host.querySelectorAll<HTMLElement>(".pli-menubar button")].find((b) => b.textContent === "Format")!;
    btn(format);
    btn(item("Table"));
    btn(item("Rename table"));
    const name = document.querySelector<HTMLInputElement>("dialog input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Sales");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(s.tables("Sheet1")[0]!.name).toBe("Sales");
  });
});

describe("pasting from another program", () => {
  const paste = (text: string, html: string) =>
    act(() => {
      const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { getData: (t: string) => (t === "text/html" ? html : t === "text/plain" ? text : "") };
      sink().dispatchEvent(e);
    });

  it("brings the look of an HTML table, and falls back to the text without one", () => {
    const s = mount(() => {});
    click(2, 2);
    paste("a\tb", '<table><tr><td style="font-weight:bold;background:#ffee00">a</td><td colspan=2 style="border-bottom:2px solid #f00">12%</td></tr></table>');
    expect(s.cell("Sheet1", "B2")).toMatchObject({ v: "a", s: { bold: true, fill: "#ffee00" } });
    expect(s.cell("Sheet1", "C2")).toMatchObject({ v: 0.12, fmt: "0%" });
    expect(s.merges("Sheet1")).toEqual(["C2:D2"]);
    click(5, 1);
    paste("x\ty", "<p>no table here</p>");
    expect(s.cell("Sheet1", "B5")?.v).toBe("y");
  });

  it("keeps the copy made here when the clipboard still holds it", () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "A1", [["=1+1", 3]]);
      x.setStyle("Sheet1", "A1", { bold: true });
    });
    click(1, 1);
    const copy = new Event("copy", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    const clip: Record<string, string> = {};
    copy.clipboardData = { setData: (t: string, v: string) => (clip[t] = v) };
    act(() => void sink().dispatchEvent(copy));
    expect(clip["text/html"]).toContain("font-weight:bold");
    click(4, 1);
    paste(clip["text/plain"]!, clip["text/html"]!);
    expect(s.cell("Sheet1", "A4")).toMatchObject({ f: "1+1", s: { bold: true } }); // the formula came with it
  });
});

describe("several choices, other workbooks and pastes in the grid", () => {
  const pasteEvent = (text: string, html = "") =>
    act(() => {
      const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { getData: (t: string) => (t === "text/html" ? html : t === "text/plain" ? text : "") };
      sink().dispatchEvent(e);
    });
  const choices = () => [...document.querySelectorAll<HTMLElement>(".pli-choice-item")];

  it("picks several items from a list rule, with ticks, and leaves with Done", () => {
    const s = mount((x) => {
      x.setValues("Lists", "A1", [["red"], ["green"], ["blue"]]);
      x.addValidation("Sheet1", { kind: "list", source: "Lists!$A$1:$A$3", ranges: ["B1"], multiple: true });
    });
    click(1, 2);
    key("ArrowDown", { altKey: true });
    btn(choices().find((e) => e.textContent?.includes("red"))!);
    btn(choices().find((e) => e.textContent?.includes("blue"))!);
    expect(s.cell("Sheet1", "B1")?.v).toBe("red, blue");
    // the menu stays open and shows what is picked
    expect(choices().filter((e) => e.querySelector(".pli-choice-tick")?.textContent === "✓").map((e) => e.textContent)).toHaveLength(2);
    btn(choices().find((e) => e.textContent?.includes("red"))!);
    expect(s.cell("Sheet1", "B1")?.v).toBe("blue");
    btn(q(".pli-choice-done"));
    expect(document.querySelector(".pli-choice-item")).toBeNull();
  });

  it("closes at once for a single list, and says where a list from another workbook came from", async () => {
    const s = mount((x) => x.addValidation("Sheet1", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$2", ranges: ["B1"], snapshot: { items: ["Pens", "Ink"], read: "2025-12-01" } }));
    click(1, 2);
    key("ArrowDown", { altKey: true });
    expect(document.querySelector(".pli-choice-source")!.textContent).toBe("From Prices.xlsx, read 2025-12-01 (may be out of date)");
    expect(document.querySelector(".pli-choice-done")).toBeNull();
    btn(choices().find((e) => e.textContent?.includes("Ink"))!);
    expect(s.cell("Sheet1", "B1")?.v).toBe("Ink");
    expect(document.querySelector(".pli-choice-item")).toBeNull();
  });

  it("reads a list from another workbook through the externalLists prop and keeps the snapshot", async () => {
    const session = new SheetSession(createWorkbook("t", ["Sheet1"]), { now: () => 46000 });
    session.addValidation("Sheet1", { kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$2", ranges: ["B1"] });
    const asked: string[] = [];
    await act(async () => {
      root.render(<PliSheet session={session} externalLists={(book, ref) => (asked.push(`${book}|${ref}`), ["Pens", "Ink"])} />);
    });
    expect(asked).toEqual(["Prices.xlsx|Sheet1!$A$1:$A$2"]);
    expect(session.validationChoices("Sheet1", "B1")).toEqual(["Pens", "Ink"]);
    expect(session.externalListStatus("Sheet1", "B1")?.state).toBe("fresh");
    click(1, 2);
    key("ArrowDown", { altKey: true });
    expect(document.querySelector(".pli-choice-source")!.textContent).toBe("From Prices.xlsx");
  });

  it("sets several choices and a source in another workbook from the dialog", () => {
    const s = mount(() => {});
    click(1, 1);
    btn(dataMenu());
    btn(item("Data validation"));
    const field = (sel: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
    const set = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
      act(() => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      });
    set(field("select"), "list");
    set(field('input[placeholder^="=Lists"]'), "[Prices.xlsx]Sheet1!$A$1:$A$10");
    act(() => void [...document.querySelectorAll<HTMLInputElement>("dialog input[type=checkbox]")].find((c) => c.parentElement?.textContent?.includes("several"))!.click());
    set(field('input[aria-label="Separator"]'), "; ");
    act(() => void document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(s.validations("Sheet1")[0]).toMatchObject({ kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$10", multiple: true, separator: "; " });
  });

  it("does not check a paste by default, and notices the cells that break a rule when asked", () => {
    const s = mount((x) => x.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1:A3"] }));
    click(1, 1);
    pasteEvent("5\n50\n7");
    expect(s.cell("Sheet1", "A2")?.v).toBe(50);
    expect(document.querySelector(".pli-notice-paste")).toBeNull();
    s.undo();
    s.validatePaste = "warn";
    click(1, 1);
    pasteEvent("5\n50\n7");
    expect(q(".pli-notice-paste").textContent).toContain("1 cell pasted breaks a data validation rule (A2)");
    expect(s.cell("Sheet1", "A2")?.v).toBe(50);
    btn([...q(".pli-notice-paste").querySelectorAll("button")].find((b) => b.textContent === "Circle")!);
    expect(host.querySelectorAll(".pli-grid-invalid")).toHaveLength(1);
    expect(document.querySelector(".pli-notice-paste")).toBeNull();
  });

  it("refuses the cells that break a stop rule when the validatePaste prop says refuse", () => {
    const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
    session.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["A1:A3"] });
    act(() => root.render(<PliSheet session={session} validatePaste="refuse" />));
    expect(session.validatePaste).toBe("refuse");
    click(1, 1);
    pasteEvent("5\n50\n7");
    expect(session.cell("Sheet1", "A1")?.v).toBe(5);
    expect(session.cell("Sheet1", "A2")).toBeUndefined();
    expect(q(".pli-notice-paste").textContent).toContain("1 cell kept what it had");
    btn([...q(".pli-notice-paste").querySelectorAll("button")].find((b) => b.textContent === "Dismiss")!);
    expect(document.querySelector(".pli-notice-paste")).toBeNull();
  });

  it("pastes values only from the Edit menu's Paste special, keeping the rules of the cells they land on", async () => {
    const s = mount((x) => {
      x.setValues("Sheet1", "A1", [["=2+3", 50]]);
      x.addValidation("Sheet1", { kind: "whole", op: "between", values: ["1", "10"], ranges: ["C1:D1"] });
    });
    s.validatePaste = "warn";
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(1, 2));
    pointer("pointerup", cellXY(1, 2));
    const clip: Record<string, string> = {};
    const copy = new Event("copy", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    copy.clipboardData = { setData: (t: string, v: string) => (clip[t] = v) };
    act(() => void sink().dispatchEvent(copy));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: () => Promise.resolve(clip["text/plain"]!) } });
    click(1, 3);
    btn([...host.querySelectorAll<HTMLElement>(".pli-menubar button")].find((b) => b.textContent === "Edit")!);
    await act(async () => void item("Paste special").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    await act(async () => void item("Values only").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(s.cell("Sheet1", "C1")).toEqual({ v: 5 }); // the formula arrived as its value
    expect(s.cell("Sheet1", "D1")?.v).toBe(50);
    expect(s.validations("Sheet1")).toHaveLength(1); // the rule on C1:D1 stayed
    expect(q(".pli-notice-paste").textContent).toContain("D1");
  });
});
