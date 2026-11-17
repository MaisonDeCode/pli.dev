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
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const setField = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const field = (label: string) => q<HTMLInputElement>(`[aria-label="${label}"]`);
const button = (label: string) => q<HTMLButtonElement>(`.pli-findbar [aria-label="${label}"]`);
const textButton = (text: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-findbar button")].find((b) => b.textContent === text)!;
const activeCell = () => field("Name box").value;
const status = () => q(".pli-findbar-count").textContent;

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]), { now: () => 45000 });
  session.setValues("Sheet1", "A1", [
    ["Name", "City", "Qty"],
    ["Ana Smith", "Boston", 10],
    ["Bo smith", "Austin", 4],
    ["Cy Jones", "boston", 7],
  ]);
  session.setValues("Other", "A1", [["Smithy"]]);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("find and replace in the grid", () => {
  it("opens from the Edit menu, marks every cell it finds and steps between them", () => {
    mount();
    expect(host.querySelector(".pli-findbar")).toBeNull();
    choose("Edit", "Find…");
    expect(host.querySelector(".pli-findbar")).toBeTruthy();
    expect(document.activeElement).toBe(field("Find"));
    expect(host.querySelector(".pli-findbar [aria-label='Replace with']")).toBeNull();

    setField(field("Find"), "smith");
    expect(host.querySelectorAll(".pli-grid-found")).toHaveLength(2);
    expect(status()).toBe("2 found");

    key(field("Find"), "Enter");
    expect(activeCell()).toBe("A2");
    expect(status()).toBe("1 of 2");
    expect(q(".pli-grid-found[data-current]")).toBeTruthy();
    key(field("Find"), "Enter");
    expect(activeCell()).toBe("A3");
    key(field("Find"), "Enter"); // wraps round
    expect(activeCell()).toBe("A2");
    key(field("Find"), "Enter", { shiftKey: true }); // and back
    expect(activeCell()).toBe("A3");
    act(() => void button("Previous match").click());
    expect(activeCell()).toBe("A2");

    setField(field("Find"), "zzz");
    expect(status()).toBe("No results");
    expect(host.querySelectorAll(".pli-grid-found")).toHaveLength(0);
  });

  it("opens with Ctrl+F, closes with Escape, and takes the options", () => {
    mount();
    key(q(".pli-grid-sink, textarea") as HTMLElement, "f", { ctrlKey: true });
    expect(host.querySelector(".pli-findbar")).toBeTruthy();
    setField(field("Find"), "boston");
    expect(status()).toBe("2 found");
    const [matchCase, entire, regex] = [...host.querySelectorAll<HTMLInputElement>(".pli-findbar-check input")];
    act(() => void matchCase!.click());
    expect(status()).toBe("1 found");
    act(() => void matchCase!.click());
    act(() => void entire!.click());
    setField(field("Find"), "bos");
    expect(status()).toBe("No results");
    act(() => void entire!.click());
    act(() => void regex!.click());
    setField(field("Find"), "^b.*n$");
    expect(status()).toBe("2 found");
    setField(field("Find"), "(");
    expect(status()).toBe("Not a pattern that can be searched for");
    key(field("Find"), "Escape");
    expect(host.querySelector(".pli-findbar")).toBeNull();
    expect(host.querySelectorAll(".pli-grid-found")).toHaveLength(0);
  });

  it("looks in this sheet, all sheets, or the selection", () => {
    const s = mount();
    key(q("textarea"), "f", { ctrlKey: true });
    setField(field("Find"), "smith");
    expect(status()).toBe("2 found");
    setField(q<HTMLSelectElement>("[aria-label='Search in']"), "workbook");
    expect(status()).toBe("3 found");
    setField(q<HTMLSelectElement>("[aria-label='Search in']"), "sheet");
    expect(s.find({ text: "smith" })).toHaveLength(3);
    // Stepping through all sheets goes to the other sheet.
    setField(q<HTMLSelectElement>("[aria-label='Search in']"), "workbook");
    key(field("Find"), "Enter");
    key(field("Find"), "Enter");
    key(field("Find"), "Enter");
    expect(q(".pli-sheet-tab[aria-selected=true], [role=tab][aria-selected=true]").textContent).toContain("Other");
    expect(activeCell()).toBe("A1");
  });

  it("replaces one at a time and all at once, and undoes both", () => {
    const s = mount();
    key(q("textarea"), "h", { ctrlKey: true });
    expect(field("Replace with")).toBeTruthy();
    setField(field("Find"), "smith");
    setField(field("Replace with"), "Wright");
    expect(status()).toBe("2 found");

    act(() => void textButton("Replace").click()); // nothing is selected yet: goes to the first
    expect(activeCell()).toBe("A2");
    expect(s.value("Sheet1", "A2")).toBe("Ana Smith");
    act(() => void textButton("Replace").click());
    expect(s.value("Sheet1", "A2")).toBe("Ana Wright");
    expect(activeCell()).toBe("A3");
    expect(status()).toBe("1 of 1");

    act(() => void textButton("Replace all").click());
    expect(s.value("Sheet1", "A3")).toBe("Bo Wright");
    expect(status()).toBe("Replaced 1 in 1 cell.");
    act(() => s.undo());
    expect(s.value("Sheet1", "A3")).toBe("Bo smith");
    expect(s.value("Sheet1", "A2")).toBe("Ana Wright");
  });

  it("shows no replace row when the sheet is read only", () => {
    const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
    session.setCell("Sheet1", "A1", "x");
    act(() => root.render(<PliSheet session={session} readOnly />));
    key(q("textarea"), "h", { ctrlKey: true });
    expect(host.querySelector(".pli-findbar")).toBeNull();
    key(q("textarea"), "f", { ctrlKey: true });
    expect(host.querySelector(".pli-findbar")).toBeTruthy();
    expect(host.querySelector("[aria-label='Replace with']")).toBeNull();
  });

  it("finds only errors, only a look, and can reach hidden sheets", () => {
    const s = mount();
    s.setCell("Sheet1", "D2", "=1/0");
    s.setStyle("Sheet1", "B3", { bold: true });
    s.hideSheets(["Other"]);
    key(q("textarea"), "f", { ctrlKey: true });
    const check = (label: string) => [...host.querySelectorAll<HTMLInputElement>(".pli-findbar-check input")].find((i) => i.parentElement!.textContent!.includes(label))!;
    act(() => void check("Errors only").click());
    expect(status()).toBe("1 found");
    act(() => void check("Errors only").click());
    expect(status()).toBe("");
    setField(q<HTMLSelectElement>("[aria-label='Format']"), "bold");
    expect(status()).toBe("1 found");
    setField(q<HTMLSelectElement>("[aria-label='Format']"), "any");
    setField(field("Find"), "smithy");
    setField(q<HTMLSelectElement>("[aria-label='Search in']"), "workbook");
    expect(status()).toBe("No results");
    act(() => void check("Hidden sheets").click());
    expect(status()).toBe("1 found");
  });

  it("finds the cells that look like the active cell", () => {
    const s = mount();
    s.setStyle("Sheet1", "A1:C1", { bold: true });
    s.setStyle("Sheet1", "B3", { fill: "#ffff00" });
    key(q("textarea"), "f", { ctrlKey: true });
    // The active cell is A1: bold, no fill.
    setField(q<HTMLSelectElement>("[aria-label='Format']"), "like");
    expect(status()).toBe("1 of 3");
    expect(s.find({ text: "", format: { bold: true, fill: "none", italic: false, underline: false, strike: false, color: "auto" } })).toHaveLength(3);
  });
});
