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
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const pointer = (type: string, xy: { clientX: number; clientY: number }) => act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
/** Where the headings end and the cells start: a header of 48 by 24, after the outline margin if there are groups. */
const origin = () => {
  const corner = q(".pli-grid-corner");
  return { x: 48 + parseFloat(corner.style.left || "0"), y: 24 + parseFloat(corner.style.top || "0") };
};
/** Cells are 64 by 20 pixels. */
const cellAt = (row: number, col: number) => ({ clientX: origin().x + (col - 1) * 64 + 10, clientY: origin().y + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const rowHeads = () => [...host.querySelectorAll(".pli-grid-rowhead")].map((e) => e.textContent);
const colHeads = () => [...host.querySelectorAll(".pli-grid-colhead")].map((e) => e.textContent);
/** The margin has one strip for the columns' brackets and buttons (first) and one for the rows' (second). */
const strip = (axis: "rows" | "cols") => host.querySelectorAll(".pli-grid-marginclip")[axis === "cols" ? 0 : 1]!;
const buttons = (axis: "rows" | "cols") => [...strip(axis).querySelectorAll(".pli-outline-button")].map((e) => e.textContent);
/** The button of a summary row is in the margin, one level in from the left. */
const clickRowButton = (slot: number, level = 1) => {
  const xy = { clientX: level * 14 + 7, clientY: origin().y + (slot - 1) * 20 + 10 };
  pointer("pointerdown", xy);
  pointer("pointerup", xy);
};
const clickColButton = (col: number, level = 1) => {
  const xy = { clientX: origin().x + col * 64 - 8, clientY: level * 14 + 7 };
  pointer("pointerdown", xy);
  pointer("pointerup", xy);
};
/** The 1 2 3 buttons in the corner of the margin: for rows along its bottom, for columns down its left. */
const clickRowLevel = (level: number) => {
  const top = parseFloat(host.querySelector<HTMLElement>(".pli-outline-level")!.style.top || "0");
  const xy = { clientX: (level - 1) * 14 + 7, clientY: top + 7 };
  pointer("pointerdown", xy);
  pointer("pointerup", xy);
};
const clickColLevel = (level: number) => {
  const xy = { clientX: 7, clientY: (level - 1) * 14 + 7 };
  pointer("pointerdown", xy);
  pointer("pointerup", xy);
};

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1"]));
  session.setValues("Sheet1", "A1", Array.from({ length: 10 }, (_, r) => Array.from({ length: 6 }, (_, c) => `r${r + 1}c${c + 1}`)));
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("groups in the grid", () => {
  it("are made from the Data menu, drawn with a bracket and a button in the heading, and collapsed by the button", () => {
    const s = mount();
    click(2, 1);
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    choose("Data", "Group", "Group rows");
    expect(s.outlineGroups("Sheet1", "row")).toEqual([{ axis: "row", level: 1, from: 2, to: 4, summary: 5, collapsed: false }]);
    expect(buttons("rows")).toEqual(["−"]);
    expect(strip("rows").querySelectorAll(".pli-outline-line")).toHaveLength(1);
    clickRowButton(5);
    expect(s.sheet("Sheet1").rows!["5"]?.collapsed).toBe(true);
    expect(rowHeads()).not.toContain("3");
    expect(rowHeads()).toContain("5");
    expect(buttons("rows")).toEqual(["+"]);
    clickRowButton(2); // the hidden rows have gone, so row 5 is now the second one on screen
    expect(rowHeads()).toContain("3");
    expect(buttons("rows")).toEqual(["−"]);
    act(() => void s.undo()); // takes back the last step, which opened the group
    expect(rowHeads()).not.toContain("3");
    act(() => void s.undo());
    expect(rowHeads()).toContain("3");
  });

  it("work for columns, with the button in the heading of the summary column", () => {
    const s = mount();
    click(1, 2);
    key("ArrowRight", { shiftKey: true });
    choose("Data", "Group", "Group columns");
    expect(s.outlineGroups("Sheet1", "col")[0]).toMatchObject({ from: 2, to: 3, summary: 4 });
    expect(buttons("cols")).toEqual(["−"]);
    clickColButton(4);
    expect(colHeads()).not.toContain("B");
    expect(colHeads()).toContain("D");
    expect(buttons("cols")).toEqual(["+"]);
  });

  it("show a level from the menu, expand everything, ungroup, and put summaries above", () => {
    const s = mount();
    s.groupRows("Sheet1", 2, 8);
    s.groupRows("Sheet1", 3, 5);
    act(() => root.render(<PliSheet session={s} />));
    choose("Data", "Group", "Show", "Rows to level", "Level 1");
    expect(rowHeads().slice(0, 3)).toEqual(["1", "9", "10"]);
    choose("Data", "Group", "Show", "Rows to level", "Level 2");
    expect(rowHeads()).toContain("2");
    expect(rowHeads()).not.toContain("3");
    choose("Data", "Group", "Show", "Rows to level", "All");
    expect(rowHeads()).toContain("3");
    click(3, 1);
    key("ArrowDown", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    choose("Data", "Group", "Ungroup rows");
    expect(s.outlineDepth("Sheet1", "row")).toBe(1);
    choose("Data", "Group", "Summary rows below detail");
    expect(s.sheet("Sheet1").outline).toEqual({ summaryAbove: true });
    expect(s.outlineGroups("Sheet1", "row")[0]!.summary).toBe(1);
  });

  it("have a margin with 1 2 3 buttons that show the rows or columns down to a level", () => {
    const s = mount();
    expect(origin()).toEqual({ x: 48, y: 24 });
    s.groupRows("Sheet1", 2, 8);
    s.groupRows("Sheet1", 3, 5);
    act(() => root.render(<PliSheet session={s} />));
    expect(origin().x).toBe(48 + 3 * 14); // a level more than the groups are deep
    expect([...host.querySelectorAll(".pli-outline-level")].map((e) => e.textContent)).toEqual(["1", "2", "3"]);
    clickRowLevel(1);
    expect(rowHeads().slice(0, 3)).toEqual(["1", "9", "10"]);
    clickRowLevel(2);
    expect(rowHeads()).toContain("2");
    expect(rowHeads()).not.toContain("3");
    clickRowLevel(3);
    expect(rowHeads()).toContain("3");
    // A bracket for each level, and the margin goes when the groups do.
    expect(strip("rows").querySelectorAll(".pli-outline-line")).toHaveLength(2);
    s.ungroupRows("Sheet1", 2, 8);
    s.ungroupRows("Sheet1", 2, 8);
    act(() => root.render(<PliSheet session={s} />));
    expect(host.querySelector(".pli-outline-level")).toBeNull();
    expect(origin()).toEqual({ x: 48, y: 24 });
    // Columns have theirs, down the left of the margin.
    s.groupColumns("Sheet1", 2, 3);
    s.groupColumns("Sheet1", 2, 2);
    act(() => root.render(<PliSheet session={s} />));
    expect(host.querySelectorAll(".pli-outline-level")).toHaveLength(3);
    clickColLevel(1);
    expect(colHeads()).not.toContain("B");
    expect(colHeads()).toContain("D");
    clickColLevel(3);
    expect(colHeads()).toContain("B");
  });

  it("do nothing when the margin is clicked between its buttons, or on a read-only sheet", () => {
    const s = mount();
    s.groupRows("Sheet1", 2, 4);
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    const before = JSON.stringify(s.sheet("Sheet1").rows);
    clickRowLevel(1);
    expect(JSON.stringify(s.sheet("Sheet1").rows)).toBe(before);
    const xy = { clientX: 3, clientY: 200 };
    pointer("pointerdown", xy);
    pointer("pointerup", xy);
    expect(q<HTMLInputElement>(".pli-sheet-namebox").value).toBe("A1");
  });

  it("say why when they can't be made, and do nothing on a read-only sheet", () => {
    const s = mount();
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(2, 1);
    choose("Data", "Group", "Group rows");
    expect(host.querySelector(".pli-notice")?.textContent).toContain("format rows");
    expect(s.outlineDepth("Sheet1", "row")).toBe(0);
  });

  it("are made and taken apart from the keyboard with Alt+Shift+Right and Left", () => {
    const s = mount();
    click(2, 1);
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { altKey: true, shiftKey: true });
    expect(s.outlineGroups("Sheet1", "row")).toEqual([{ axis: "row", level: 1, from: 2, to: 3, summary: 4, collapsed: false }]);
    key("ArrowLeft", { altKey: true, shiftKey: true });
    expect(s.outlineGroups("Sheet1", "row")).toEqual([]);
    // With whole columns selected it is columns that are grouped.
    const xy = { clientX: 48 + 64 + 10, clientY: 10 };
    expect(origin()).toEqual({ x: 48, y: 24 }); // no groups, no margin
    pointer("pointerdown", xy);
    pointer("pointerup", xy);
    key("ArrowRight", { altKey: true, shiftKey: true });
    expect(s.outlineGroups("Sheet1", "col")).toEqual([{ axis: "col", level: 1, from: 2, to: 2, summary: 3, collapsed: false }]);
    expect(s.outlineGroups("Sheet1", "row")).toEqual([]);
    key("ArrowLeft", { altKey: true, shiftKey: true });
    expect(s.outlineGroups("Sheet1", "col")).toEqual([]);
  });
});
