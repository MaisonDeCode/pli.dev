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

function mount() {
  const session = new SheetSession(createWorkbook("t", ["Sheet1", "Other"]), { now: () => 45000 });
  session.setValues("Sheet1", "A1", [["Name", "Qty", "Total"], ["Pens", 10, null], ["Paper", 4, null]]);
  session.setCell("Sheet1", "C2", "=B2*2");
  session.setStyle("Sheet1", "B2:B3", { locked: false });
  act(() => root.render(<PliSheet session={session} />));
  return session;
}

describe("protecting a sheet from the menu", () => {
  it("asks for a password and what people may do, protects, marks the tab and the status bar", () => {
    const s = mount();
    choose("Review", "Protect sheet…");
    expect(dialog().querySelectorAll("input[type=checkbox]")).toHaveLength(15);
    const [pw, again] = [...dialog().querySelectorAll<HTMLInputElement>("input[type=password]")];
    setField(pw!, "secret");
    setField(again!, "different");
    act(() => void dialogButton("Protect").click());
    expect(dialog().textContent).toContain("The two passwords are different");
    expect(s.isProtected("Sheet1")).toBe(false);
    setField(again!, "secret");
    const boxes = [...dialog().querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    act(() => void boxes[2]!.click()); // format cells
    act(() => void dialogButton("Protect").click());
    expect(s.isProtected("Sheet1")).toBe(true);
    expect(s.protection("Sheet1")!.allow).toEqual(["selectLockedCells", "selectUnlockedCells", "formatCells"]);
    expect(s.protection("Sheet1")!.password).toBeTruthy();
    expect(host.querySelector(".pli-sheet-tab-lock")).toBeTruthy();
    expect(host.textContent).toContain("Protected sheet");
    expect(menuItem(["Review", "Unprotect sheet…"])).toBeTruthy();
  });

  it("is taken off with the password, and says when it is wrong", () => {
    const s = mount();
    s.protectSheet("Sheet1", { password: "secret" });
    act(() => root.render(<PliSheet session={s} />));
    choose("Review", "Unprotect sheet…");
    setField(dialog().querySelector<HTMLInputElement>("input[type=password]")!, "nope");
    act(() => void dialogButton("Unprotect").click());
    expect(dialog().textContent).toContain("That password isn't right");
    expect(s.isProtected("Sheet1")).toBe(true);
    setField(dialog().querySelector<HTMLInputElement>("input[type=password]")!, "secret");
    act(() => void dialogButton("Unprotect").click());
    expect(s.isProtected("Sheet1")).toBe(false);
    expect(host.querySelector(".pli-sheet-tab-lock")).toBeNull();
  });

  it("is taken off at once when there is no password", () => {
    const s = mount();
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    choose("Review", "Unprotect sheet…");
    expect(s.isProtected("Sheet1")).toBe(false);
  });
});

describe("a protected sheet in the grid", () => {
  it("says why when a locked cell is typed in or cleared, and lets an unlocked one be edited", () => {
    const s = mount();
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(1, 1);
    type("x");
    expect(notice()).toContain("locked");
    expect(sink().hasAttribute("data-editing")).toBe(false);
    expect(s.value("Sheet1", "A1")).toBe("Name");
    key("Delete");
    expect(s.value("Sheet1", "A1")).toBe("Name");
    key("F2");
    expect(sink().hasAttribute("data-editing")).toBe(false);
    click(2, 2);
    type("11");
    key("Enter");
    expect(s.value("Sheet1", "B2")).toBe(11);
    expect(s.value("Sheet1", "C2")).toBe(22);
  });

  it("says why when something is pasted into a locked cell", () => {
    const s = mount();
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(1, 1);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (t: string) => (t === "text/plain" ? "pasted" : ""), files: [] } });
    act(() => void sink().dispatchEvent(paste));
    expect(notice()).toContain("locked");
    expect(s.value("Sheet1", "A1")).toBe("Name");
  });

  it("says why when a menu action is refused, and lets what is allowed through", () => {
    const s = mount();
    s.protectSheet("Sheet1", { allow: ["selectLockedCells", "selectUnlockedCells", "formatCells"] });
    act(() => root.render(<PliSheet session={s} />));
    click(2, 2);
    choose("Edit", "Delete row");
    expect(notice()).toContain("delete rows");
    expect(s.value("Sheet1", "A2")).toBe("Pens");
    click(2, 2);
    key("b", { ctrlKey: true });
    expect(s.cell("Sheet1", "B2")?.s?.bold).toBe(true);
  });

  it("keeps the lock flags of the cells from the Format menu, and doesn't let them change while protected", () => {
    const s = mount();
    click(1, 1);
    choose("Format", "Locked"); // unlocks A1
    expect(s.isLocked("Sheet1", "A1")).toBe(false);
    choose("Format", "Locked");
    expect(s.isLocked("Sheet1", "A1")).toBe(true);
    choose("Format", "Hide formulas when protected");
    expect(s.cell("Sheet1", "A1")?.s?.hideFormula).toBe(true);
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    expect(menuItem(["Format", "Locked"])!.disabled).toBe(true);
  });

  it("hides a formula from the formula bar and from a copy, but not its value", () => {
    const s = mount();
    s.setStyle("Sheet1", "C2", { hideFormula: true, locked: false });
    click(2, 3);
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("=B2*2");
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(2, 3);
    expect(q<HTMLInputElement>(".pli-sheet-bar").value).toBe("");
    expect(host.textContent).toContain("20");
    key("F2");
    expect(sink().value).toBe(""); // the editor opens empty: what is typed replaces the formula
    key("Escape");
    const data = new Map<string, string>();
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: { setData: (t: string, v: string) => void data.set(t, v), getData: (t: string) => data.get(t) ?? "" } });
    act(() => void sink().dispatchEvent(copy));
    expect(data.get("text/plain")).toBe("20");
  });

  it("limits where the selection can go when locked cells can't be selected, and Enter jumps between unlocked cells", () => {
    const s = mount();
    s.protectSheet("Sheet1", { allow: ["selectUnlockedCells"] });
    act(() => root.render(<PliSheet session={s} />));
    click(2, 2); // B2 is unlocked
    expect(nameBox()).toBe("B2");
    click(1, 1); // A1 is locked: the click is ignored
    expect(nameBox()).toBe("B2");
    key("ArrowLeft");
    expect(nameBox()).toBe("B2");
    key("ArrowDown"); // B3 is unlocked
    expect(nameBox()).toBe("B3");
    key("ArrowDown"); // B4 isn't
    expect(nameBox()).toBe("B3");
    click(2, 2);
    type("12");
    key("Enter"); // down: B3
    expect(nameBox()).toBe("B3");
    type("5");
    key("Enter"); // down: B4 is locked, nothing below is unlocked, so it stays
    expect(s.value("Sheet1", "B3")).toBe(5);
  });
});

describe("a workbook with its structure protected", () => {
  it("says why when a sheet is added from the menu, and unprotects with the password", () => {
    const s = mount();
    choose("Review", "Protect workbook structure…");
    const [pw, again] = [...dialog().querySelectorAll<HTMLInputElement>("input[type=password]")];
    setField(pw!, "wb");
    setField(again!, "wb");
    act(() => void dialogButton("Protect").click());
    expect(s.workbookProtected).toBe(true);
    choose("Insert", "Sheet");
    expect(notice()).toContain("structure is protected");
    expect(s.state.sheets).toHaveLength(2);
    choose("Review", "Unprotect workbook…");
    setField(dialog().querySelector<HTMLInputElement>("input[type=password]")!, "wb");
    act(() => void dialogButton("Unprotect").click());
    expect(s.workbookProtected).toBe(false);
  });
});
