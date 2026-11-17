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

const cellXY = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const nameBox = () => q<HTMLInputElement>(".pli-sheet-namebox").value;
const click = (el: Element, init: MouseEventInit = {}) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
const pointer = (type: string, xy: { clientX: number; clientY: number }) =>
  act(() => void q(".pli-grid-scroller").dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...xy })));
const item = (text: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox]")].find((e) => e.textContent?.includes(text))!;

function mount(setup: (s: SheetSession) => void, names = ["Sheet1"]) {
  const session = new SheetSession(createWorkbook("t", names), { now: () => 45000 });
  setup(session);
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("merged cells in the grid", () => {
  it("draws a merged range as one cell and selects it whole", () => {
    mount((s) => {
      s.setValues("Sheet1", "A1", [["Title", "gone"], ["x", "y"]]);
      s.mergeCells("Sheet1", "A1:B2");
    });
    const cells = all(".pli-cell");
    const big = cells.find((c) => c.textContent === "Title")!;
    expect(big.style.width).toBe("128px");
    expect(big.style.height).toBe("40px");
    // The cells under it aren't drawn.
    expect(cells.some((c) => c.style.left === "64px" && c.style.top === "0px")).toBe(false);
    pointer("pointerdown", cellXY(2, 2));
    pointer("pointerup", cellXY(2, 2));
    expect(nameBox()).toBe("A1:B2");
  });

  it("steps out of a merged range with the arrow keys", () => {
    mount((s) => s.mergeCells("Sheet1", "A1:B2"));
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointerup", cellXY(1, 1));
    const key = (k: string) => act(() => void q(".pli-grid-sink").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
    key("ArrowDown");
    expect(nameBox()).toBe("A3");
    key("ArrowUp");
    expect(nameBox()).toBe("A1:B2");
    key("ArrowRight");
    expect(nameBox()).toBe("C1");
  });
});

describe("borders and conditional formats in the grid", () => {
  it("draws lines where the borders are", () => {
    mount((s) => {
      s.setValues("Sheet1", "A1", [["a", "b"]]);
      s.setBorders("Sheet1", "A1:B1", "outer", { style: "thick", color: "#ff0000" });
    });
    const lines = all(".pli-cell-line");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.some((l) => l.style.background === "rgb(255, 0, 0)" && l.style.height === "3px")).toBe(true);
  });

  it("draws diagonal borders, solid bars with a zero line, and the number format a rule gives", () => {
    mount((s) => {
      s.setValues("Sheet1", "A1", [[-5], [10], [0.256]]);
      s.setBorders("Sheet1", "B1", "diagonalDown", { style: "medium", color: "#ff0000" });
      s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:A2"], min: { type: "min" }, max: { type: "max" }, color: "#638ec6", negativeColor: "#ff0000", solid: true, border: true });
      s.addRule("Sheet1", { kind: "cell", op: "lessThan", values: ["1"], ranges: ["A3"], style: { fmt: "0.0%" } });
    });
    const diagonal = q<SVGElement>(".pli-cell-diagonal line");
    expect(diagonal.getAttribute("stroke")).toBe("#ff0000");
    expect(diagonal.getAttribute("stroke-width")).toBe("2");
    expect([diagonal.getAttribute("x1"), diagonal.getAttribute("y1"), diagonal.getAttribute("x2"), diagonal.getAttribute("y2")]).toEqual(["0", "0", "64", "20"]); // top-left to bottom-right
    expect(all(".pli-cell-axis")).toHaveLength(2);
    const bars = all(".pli-cell-bar");
    expect(bars[0]!.style.background).toBe("rgb(255, 0, 0)"); // solid, and red for the negative one
    expect(bars[1]!.style.background).toBe("rgb(99, 142, 198)");
    expect(bars[1]!.style.border).toContain("solid");
    expect(all(".pli-cell").some((c) => c.textContent === "25.6%")).toBe(true);
  });

  it("merges and centres from the menu", () => {
    const s = mount((x) => x.setValues("Sheet1", "A1", [["Title", "gone"]]));
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(1, 2));
    pointer("pointerup", cellXY(1, 2));
    click(q('button[aria-label="Merge cells"]'));
    click(item("Merge and center"));
    expect(s.merges("Sheet1")).toEqual(["A1:B1"]);
    expect(s.cell("Sheet1", "A1")).toEqual({ v: "Title", s: { align: "center" } });
  });

  it("fills, bars and icons follow the rules", () => {
    mount((s) => {
      s.setValues("Sheet1", "A1", [[5], [20]]);
      s.addRule("Sheet1", { kind: "cell", op: "greaterThan", values: ["10"], ranges: ["A1:A2"], style: { fill: "#ffc7ce", color: "#9c0006" } });
      s.addRule("Sheet1", { kind: "dataBar", ranges: ["A1:A2"], min: { type: "num", value: 0 }, max: { type: "num", value: 20 }, color: "#638ec6" });
      s.addRule("Sheet1", { kind: "iconSet", set: "3Arrows", ranges: ["A1:A2"], thresholds: [{ type: "num", value: 10 }, { type: "num", value: 15 }] });
    });
    const second = all(".pli-cell").find((c) => c.textContent === "20")!;
    expect(second.style.background).toBe("rgb(255, 199, 206)");
    expect(second.querySelector<HTMLElement>(".pli-cell-text")!.style.color).toBe("rgb(156, 0, 6)");
    expect(all(".pli-cell-bar").map((b) => b.style.width)).toEqual(["25%", "100%"]);
    expect(all(".pli-cell-icon")).toHaveLength(2);
  });

  it("a rule made in the dialog is added and listed", () => {
    const s = mount((x) => x.setValues("Sheet1", "A1", [[1], [2]]));
    pointer("pointerdown", cellXY(1, 1));
    pointer("pointermove", cellXY(2, 1));
    pointer("pointerup", cellXY(2, 1));
    click(q('button[aria-label="Conditional formatting"]'));
    click(item("Manage rules"));
    expect(document.body.textContent).toContain("This sheet has no conditional formats");
    click([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "New rule…")!);
    const field = (label: string) => document.querySelector<HTMLInputElement>(`input[placeholder="${label}"]`)!;
    expect(field("B2:B20").value).toBe("A1:A2");
    act(() => {
      const input = field("10 or $D$1");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void document.querySelector<HTMLFormElement>("dialog[open] form, dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(s.conditionalFormats("Sheet1")).toHaveLength(1);
    expect(s.conditionalFormats("Sheet1")[0]).toMatchObject({ kind: "cell", op: "greaterThan", values: ["1"], ranges: ["A1:A2"] });
  });
});

describe("sheet tabs", () => {
  const tab = (name: string) => all(".pli-sheet-tab-name").find((b) => b.textContent === name)!;
  const names = () => all(".pli-sheet-tab-name").map((b) => b.textContent);

  it("opens its menu with a background, inside the spreadsheet", () => {
    mount(() => {}, ["One", "Two"]);
    click(q('button[aria-label="Sheet options"]'));
    const panel = document.querySelector(".pli-panel")!;
    expect(host.contains(panel)).toBe(true); // so the editor's colours apply to it
  });

  it("colours a tab", () => {
    const s = mount(() => {}, ["One", "Two"]);
    click(q('button[aria-label="Sheet options"]'));
    click(item("Tab color"));
    click(item("Blue"));
    expect(s.sheet("One").tabColor).toBe("#1a56db");
    expect(q<HTMLElement>(".pli-sheet-tab").style.getPropertyValue("--pli-tab")).toBe("#1a56db");
    click(q('button[aria-label="Sheet options"]'));
    click(item("Tab color"));
    click(item("No color"));
    expect(s.sheet("One").tabColor).toBeUndefined();
  });

  it("hides and shows several sheets picked together", () => {
    const s = mount(() => {}, ["One", "Two", "Three"]);
    click(tab("Two"), { ctrlKey: true });
    click(tab("Three"), { ctrlKey: true });
    expect(all(".pli-sheet-tab[data-picked]")).toHaveLength(3);
    click(q('button[aria-label="Sheet options"]'));
    // Hiding all three would leave nothing to show.
    expect(item("Hide 3 sheets").hasAttribute("disabled")).toBe(true);
    click(q('button[aria-label="Sheet options"]')); // closes it
    click(tab("One"), { shiftKey: true }); // One to the one being looked at (Three)
    click(tab("One"), { ctrlKey: true }); // takes One out
    expect(all(".pli-sheet-tab[data-picked]").length).toBeGreaterThan(0);
    click(q('button[aria-label="Sheet options"]'));
    click(item("Hide 2 sheets"));
    expect(names()).toEqual(["One"]);
    expect(s.state.sheets.filter((x) => x.hidden).map((x) => x.name)).toEqual(["Two", "Three"]);
    click(q('button[aria-label="Sheet options"]'));
    click(item("Unhide"));
    click(item("Three"));
    expect(names()).toEqual(["One", "Three"]);
  });

  it("offers new sheet and unhide on a right click on the bar", () => {
    const s = mount((x) => x.hideSheets(["Two"]), ["One", "Two", "Three"]);
    const bar = q(".pli-sheet-tabs");
    act(() => void bar.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })));
    click(item("Unhide"));
    click(item("Two"));
    expect(s.sheet("Two").hidden).toBeUndefined();
    expect(names()).toEqual(["One", "Two", "Three"]);
    act(() => void bar.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })));
    expect(item("Unhide").hasAttribute("disabled")).toBe(true); // nothing is hidden now
    click(item("New sheet"));
    expect(s.state.sheets).toHaveLength(4);
    expect(names()).toHaveLength(4);
  });

  it("opens the sheet's menu on a right click on its tab", () => {
    const s = mount(() => {}, ["One", "Two", "Three"]);
    const rightClick = (name: string) => act(() => void tab(name).parentElement!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 300 })));
    rightClick("Three");
    // The tab right-clicked is the one acted on, whichever was showing.
    expect(all(".pli-sheet-tab[data-active]")[0]!.textContent).toBe("Three");
    expect(item("Rename")).toBeTruthy();
    expect(item("New sheet")).toBeTruthy();
    click(item("Tab color"));
    click(item("Green"));
    expect(s.sheet("Three").tabColor).toBe("#2f9e44");
    expect(s.sheet("One").tabColor).toBeUndefined();
    // On a group of picked tabs it acts on all of them.
    click(tab("One"));
    click(tab("Two"), { ctrlKey: true });
    rightClick("Two");
    expect(item("Hide 2 sheets")).toBeTruthy();
    click(item("Hide 2 sheets"));
    expect(names()).toEqual(["Three"]);
  });

  it("deletes several sheets picked together, after asking", () => {
    const s = mount(() => {}, ["One", "Two", "Three"]);
    click(tab("Two"), { metaKey: true });
    click(tab("Three"), { metaKey: true });
    click(q('button[aria-label="Sheet options"]'));
    expect(item("Delete 3 sheets").hasAttribute("disabled")).toBe(true);
    click(q('button[aria-label="Sheet options"]')); // closes it
    click(tab("One"), { metaKey: true });
    click(q('button[aria-label="Sheet options"]'));
    click(item("Delete 2 sheets"));
    expect(s.state.sheets.map((x) => x.name)).toEqual(["One"]);
    s.undo();
    expect(s.state.sheets.map((x) => x.name)).toEqual(["One", "Two", "Three"]);
  });
});
