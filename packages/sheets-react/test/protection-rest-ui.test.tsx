// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
/** Cells are 64 by 20 pixels, after a header of 48 by 24. */
const cellAt = (row: number, col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 24 + (row - 1) * 20 + 10 });
const click = (row: number, col: number) => (pointer("pointerdown", cellAt(row, col)), pointer("pointerup", cellAt(row, col)));
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const setField = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const type = (text: string) => setField(sink(), text);
const menuButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === label)!;
const choose = (...path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  for (const name of path.slice(1)) {
    const hit = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === name);
    if (!hit) throw new Error(`No menu item "${name}"`);
    act(() => void hit.click());
  }
};
const menuItem = (path: string[]) => {
  act(() => void menuButton(path[0]!).click());
  return [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === path[1]);
};
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]")!;
const dialogButton = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const notice = () => host.querySelector(".pli-notice")?.textContent ?? "";
const nameBox = () => q<HTMLInputElement>(".pli-sheet-namebox").value;

function mount(user?: { id: string; roles?: string[] }) {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]), { now: () => 45000 });
  session.setValues("Sheet1", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null]]);
  act(() => root.render(<PliSheet session={session} {...(user ? { user } : {})} />));
  return session;
}
const header = (col: number) => ({ clientX: 48 + (col - 1) * 64 + 10, clientY: 10 });
const rowHeader = (row: number) => ({ clientX: 10, clientY: 24 + (row - 1) * 20 + 10 });
const clickAt = (xy: { clientX: number; clientY: number }) => (pointer("pointerdown", xy), pointer("pointerup", xy));
const field = (label: string) => [...dialog().querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.startsWith(label))!.querySelector<HTMLInputElement>("input")!;


/** Looks at a menu item and closes the menu again. */
const peek = (path: string[]) => {
  const item = menuItem(path);
  const state = item && { disabled: item.disabled, checked: item.getAttribute("aria-checked") };
  act(() => void menuButton(path[0]!).click());
  return state;
};
const reviewLabels = () => [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-panel .pli-menu-item")].map((b) => b.querySelector(".pli-menu-label")?.textContent);
const press = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));

describe("the Review menu", () => {
  it("holds the notes and protection commands, and Data no longer does", () => {
    mount();
    act(() => void menuButton("Review").click());
    const labels = reviewLabels();
    for (const wanted of ["New note…", "Delete note", "Show/hide note", "Show all notes", "Hide all notes", "Previous note", "Next note", "Protect sheet…", "Protect workbook structure…", "Allow edit ranges…", "Lock edit ranges again"]) expect(labels, wanted).toContain(wanted);
    act(() => void menuButton("Data").click());
    const data = reviewLabels();
    expect(data).toContain("Subtotal…");
    for (const gone of ["Protect sheet…", "Allow edit ranges…", "Protect workbook structure…"]) expect(data, gone).not.toContain(gone);
  });

  it("can be reached with the keyboard: Arrow keys step along the menu bar and down the items, Enter chooses", () => {
    mount();
    act(() => void menuButton("Data").click());
    press(host.querySelector(".pli-menubar")!, "ArrowRight");
    expect(menuButton("Review").getAttribute("aria-expanded")).toBe("true");
    const items = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-panel .pli-menu-item:not(:disabled)")];
    expect(items.length).toBeGreaterThan(3);
    // The items are buttons, so Tab and Enter reach them; the arrows move between them.
    act(() => items[0]!.focus());
    press(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    press(items[1]!, "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    expect(menuButton("Review").getAttribute("aria-haspopup")).toBe("menu");
    // Wrapping round the menu bar.
    press(host.querySelector(".pli-menubar")!, "ArrowRight");
    expect(menuButton("File").getAttribute("aria-expanded")).toBe("true");
  });

  it("protects and unprotects the sheet and the workbook, and the items say which", () => {
    const s = mount();
    expect(peek(["Review", "Unprotect sheet…"])).toBeUndefined();
    choose("Review", "Protect sheet…");
    act(() => void dialogButton("Protect").click());
    expect(s.isProtected("Sheet1")).toBe(true);
    expect(peek(["Review", "Unprotect sheet…"])).toBeTruthy();
    choose("Review", "Unprotect sheet…");
    expect(s.isProtected("Sheet1")).toBe(false);
    choose("Review", "Protect workbook structure…");
    act(() => void dialogButton("Protect").click());
    expect(s.workbookProtected).toBe(true);
    expect(peek(["Review", "Unprotect workbook…"])).toBeTruthy();
  });

  it("has the toolbar's Review and protect button with the same commands", () => {
    const s = mount();
    const button = q<HTMLButtonElement>("button[aria-label='Review and protect']");
    act(() => void button.click());
    const labels = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item .pli-menu-label")].map((l) => l.textContent);
    expect(labels).toContain("Protect sheet…");
    expect(labels).toContain("Show all notes");
    act(() => void [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.textContent?.includes("Protect sheet…"))!.click());
    expect(dialog().textContent).toContain("Protect sheet");
    act(() => void dialogButton("Protect").click());
    expect(s.isProtected("Sheet1")).toBe(true);
  });

  it("notes commands work from it: add, show all, step, delete", () => {
    const s = mount();
    s.setNote("Sheet1", "B2", "first");
    s.setNote("Sheet1", "C3", "second");
    click(2, 2);
    expect(peek(["Review", "Edit note…"])).toBeTruthy();
    choose("Review", "Show all notes");
    expect(s.cell("Sheet1", "B2")!.noteBox?.show).toBe(true);
    expect(s.cell("Sheet1", "C3")!.noteBox?.show).toBe(true);
    choose("Review", "Hide all notes");
    expect(s.cell("Sheet1", "B2")!.noteBox?.show).not.toBe(true);
    choose("Review", "Next note");
    expect(nameBox()).toBe("C3");
    choose("Review", "Previous note");
    expect(nameBox()).toBe("B2");
    choose("Review", "Delete note");
    expect(s.cell("Sheet1", "B2")?.note).toBeUndefined();
    click(4, 1);
    choose("Review", "New note…");
    expect(dialog()).toBeTruthy();
  });

  it("closes the ranges that were opened with a password", () => {
    const s = mount();
    s.addEditRange("Sheet1", { name: "Quantities", ranges: ["B2:B3"], password: "open" });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    expect(peek(["Review", "Lock edit ranges again"])!.disabled).toBe(true);
    s.unlockEditRange("Sheet1", "Quantities", "open");
    act(() => root.render(<PliSheet session={s} />));
    expect(peek(["Review", "Lock edit ranges again"])!.disabled).toBe(false);
    choose("Review", "Lock edit ranges again");
    expect(s.editRangeOpen("Sheet1", "Quantities")).toBe(false);
  });

  it("is read-only friendly: notes can be read but not changed", () => {
    const s = new SheetSession(createWorkbook("t", ["Sheet1"]), { now: () => 45000 });
    s.setNote("Sheet1", "A1", "n");
    act(() => root.render(<PliSheet session={s} readOnly />));
    expect(peek(["Review", "Protect sheet…"])!.disabled).toBe(true);
    expect(peek(["Review", "Next note"])!.disabled).toBe(false);
  });
});

describe("hidden formulas on whole rows and columns, from the menu", () => {
  it("Format > Hide formulas on a whole column hides the formula bar's formulas in it", () => {
    const s = mount();
    s.setCell("Sheet1", "C2", "=B2*2");
    clickAt(header(3));
    expect(nameBox()).toBe("C:C");
    choose("Format", "Hide formulas when protected");
    expect(s.state.sheets[0]!.columns).toEqual({ C: { hideFormula: true } });
    expect(peek(["Format", "Hide formulas when protected"])!.checked).toBe("true");
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(2, 3);
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("");
    expect(peek(["Format", "Hide formulas when protected"])!.disabled).toBe(true);
    key("F2");
    expect(sink().value).toBe("");
    key("Escape");
    s.unprotectSheet("Sheet1");
    click(2, 3);
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("=B2*2");
  });

  it("works on a whole row, and a second choice shows the formulas again", () => {
    const s = mount();
    s.setCell("Sheet1", "C2", "=B2*2");
    clickAt(rowHeader(2));
    choose("Format", "Hide formulas when protected");
    expect(s.state.sheets[0]!.rows).toEqual({ "2": { hideFormula: true } });
    choose("Format", "Hide formulas when protected");
    expect(s.state.sheets[0]!.rows).toBeUndefined();
  });

  it("a copy of a whole column that hides formulas brings values, not formulas, and doesn't walk through every cell", () => {
    const s = mount();
    s.setCell("Sheet1", "C2", "=B2*2");
    s.setFormulaHidden("Sheet1", "C:C", true);
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    clickAt(header(3));
    const data = new Map<string, string>();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: { setData: (t: string, v: string) => void data.set(t, v), getData: (t: string) => data.get(t) ?? "" } });
    const spy = vi.spyOn(s, "formulaHidden");
    act(() => void sink().dispatchEvent(copy));
    expect(data.get("text/plain")).toContain("20");
    expect(data.get("text/plain")).not.toContain("B2*2");
    expect(spy.mock.calls.length).toBeLessThan(10); // the whole-column check never asks cell by cell
  });
});

describe("Windows accounts, from the user prop and the dialog", () => {
  const SID = "S-1-5-21-1004336348-1177238915-682003330-1001";
  it("lets the user with that account edit a range that names it", () => {
    const s = mount({ id: "ada", accounts: [SID] } as { id: string });
    s.addEditRange("Sheet1", { name: "Mine", ranges: ["B2"], permissions: [`sid:${SID}`] });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} user={{ id: "ada", accounts: [SID] }} />));
    click(2, 2);
    type("11");
    key("Enter");
    expect(s.value("Sheet1", "B2")).toBe(11);
    act(() => root.render(<PliSheet session={s} user={{ id: "bob", accounts: ["S-1-5-21-1-2-3-9"] }} />));
    click(2, 2);
    type("12");
    expect(notice()).toContain("only some people");
  });

  it("takes accounts and denied accounts in the Allow edit ranges dialog", () => {
    const s = mount();
    choose("Review", "Allow edit ranges…");
    setField(field("Title"), "Mine");
    setField(field("Cells"), "B2");
    setField(field("Roles"), `finance, sid:${SID}`);
    setField(field("Denied"), "interns");
    act(() => void dialogButton("Add").click());
    expect(s.editRanges("Sheet1")[0]).toMatchObject({ permissions: ["finance", `sid:${SID}`], denied: ["interns"] });
    expect(dialog().querySelector("table")!.textContent).toContain("not interns");
  });
});

describe("deleting rows and columns on a protected sheet, from the menu", () => {
  const deleteRowFromMenu = (row: number) => {
    clickAt(rowHeader(row));
    expect(nameBox()).toBe(`${row}:${row}`);
    act(() => void pointer("contextmenu", rowHeader(row)));
    const del = [...document.querySelectorAll<HTMLButtonElement>(".pli-grid-menu .pli-menu-item")].find((b) => b.textContent?.startsWith("Delete row"));
    expect(del, "Delete row in the menu").toBeTruthy();
    act(() => void del!.click());
  };
  it("says it as Excel does, and works once the whole row is unlocked", () => {
    const s = mount();
    s.setLocked("Sheet1", "3:3", false);
    s.protectSheet("Sheet1", { allow: ["selectLockedCells", "selectUnlockedCells", "deleteRows"] });
    act(() => root.render(<PliSheet session={s} />));
    deleteRowFromMenu(2);
    expect(notice()).toContain("cell or chart you're trying to change is on a protected sheet");
    expect(s.cell("Sheet1", "A2")?.v).toBe("Pens");
    act(() => void [...host.querySelectorAll<HTMLButtonElement>(".pli-notice button")].find((b) => b.textContent === "Dismiss")?.click());
    deleteRowFromMenu(3);
    expect([s.cell("Sheet1", "A3"), notice()]).toEqual([undefined, ""]);
    expect(s.cell("Sheet1", "A2")?.v).toBe("Pens");
  });
});
