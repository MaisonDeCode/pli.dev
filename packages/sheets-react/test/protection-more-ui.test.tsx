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

describe("locks that columns and rows carry, from the menu", () => {
  it("Format > Locked on a whole column unlocks the column, the cells in it and the cells made later", () => {
    const s = mount();
    clickAt(header(2));
    expect(nameBox()).toBe("B:B");
    choose("Format", "Locked");
    expect(s.state.sheets[0]!.columns).toEqual({ B: { locked: false } });
    expect(s.isLocked("Sheet1", "B2")).toBe(false);
    expect(s.isLocked("Sheet1", "B500")).toBe(false);
    expect(s.isLocked("Sheet1", "A2")).toBe(true);
    // The menu shows it, and a second choice locks the column again.
    act(() => void menuButton("Format").click());
    const item = [...document.querySelectorAll<HTMLButtonElement>(".pli-menu-item")].find((b) => b.querySelector(".pli-menu-label")?.textContent === "Locked")!;
    act(() => void item.click());
    expect(s.state.sheets[0]!.columns).toBeUndefined();
    s.undo();
    expect(s.isLocked("Sheet1", "B500")).toBe(false);
  });

  it("Format > Locked on a whole row works the same, and the protected sheet then lets those cells be typed in", () => {
    const s = mount();
    clickAt(rowHeader(3));
    choose("Format", "Locked");
    expect(s.state.sheets[0]!.rows).toEqual({ "3": { locked: false } });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(3, 6);
    type("hello");
    key("Enter");
    expect(s.value("Sheet1", "F3")).toBe("hello");
    click(4, 6);
    type("no");
    expect(notice()).toContain("locked");
  });
});

describe("ranges that people may edit, from the menu", () => {
  it("adds, modifies and deletes a range in the dialog, and shows them in a list", () => {
    const s = mount();
    click(2, 2);
    choose("Review", "Allow edit ranges…");
    expect(field("Cells").value).toBe("B2");
    setField(field("Title"), "Quantities");
    setField(field("Cells"), "B2:B3");
    setField(field("Password"), "open");
    act(() => void dialogButton("Add").click());
    expect(s.editRanges("Sheet1")).toHaveLength(1);
    expect(s.editRanges("Sheet1")[0]!.password).toBeTruthy();
    expect(dialog().querySelector("table")!.textContent).toContain("Quantities");
    expect(dialog().querySelector("table")!.textContent).toContain("password");
    act(() => void dialogButton("Modify").click());
    expect(field("Title").value).toBe("Quantities");
    setField(field("Roles"), "finance");
    act(() => void dialogButton("Save").click());
    expect(s.editRanges("Sheet1")[0]!.permissions).toEqual(["finance"]);
    expect(s.editRanges("Sheet1")[0]!.password).toBeTruthy();
    setField(field("Title"), "quantities");
    setField(field("Cells"), "nonsense");
    act(() => void dialogButton("Add").click());
    expect(dialog().textContent).toMatch(/already|isn't a range/);
    act(() => void dialogButton("Delete").click());
    expect(s.editRanges("Sheet1")).toHaveLength(0);
  });

  it("asks for the password when a cell of the range is typed in, and says it is wrong, then lets the edit through", () => {
    const s = mount();
    s.addEditRange("Sheet1", { name: "Quantities", ranges: ["B2:B3"], password: "open" });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(2, 2);
    type("11");
    expect(dialog().textContent).toContain('Password for "Quantities"');
    expect(sink().hasAttribute("data-editing")).toBe(false);
    setField(dialog().querySelector<HTMLInputElement>("input[type=password]")!, "wrong");
    act(() => void dialogButton("OK").click());
    expect(dialog().textContent).toContain("That password isn't right");
    setField(dialog().querySelector<HTMLInputElement>("input[type=password]")!, "open");
    act(() => void dialogButton("OK").click());
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(notice()).toContain("open for editing");
    click(2, 2);
    type("11");
    key("Enter");
    expect(s.value("Sheet1", "B2")).toBe(11);
    // Outside the range is still locked, with the usual message.
    click(1, 1);
    type("x");
    expect(notice()).toContain("locked");
  });

  it("asks too when a menu action or a paste meets such a cell", () => {
    const s = mount();
    s.addEditRange("Sheet1", { name: "Quantities", ranges: ["B2:B3"], password: "open" });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    click(2, 2);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (t: string) => (t === "text/plain" ? "7" : ""), files: [] } });
    act(() => void sink().dispatchEvent(paste));
    expect(dialog().textContent).toContain("Quantities");
    expect(s.value("Sheet1", "B2")).toBe(10);
  });

  it("can't be changed while the sheet is protected", () => {
    const s = mount();
    s.addEditRange("Sheet1", { name: "Quantities", ranges: ["B2:B3"] });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} />));
    choose("Review", "Allow edit ranges…");
    expect(dialog().textContent).toContain("Unprotect it");
    expect(dialog().querySelector("input[type=text]")).toBeNull();
  });
});

describe("who may do what, from the menu and the user prop", () => {
  it("takes the roles in the Protect dialog and lets a user with the role in", () => {
    const s = mount({ id: "u1", roles: ["owner"] });
    choose("Review", "Protect sheet…");
    setField(dialog().querySelector<HTMLInputElement>("input[aria-label^='Roles that may also: Sort']")!, "analyst, owner");
    setField(field("Roles that may change locked cells"), "owner");
    act(() => void dialogButton("Protect").click());
    expect(s.protection("Sheet1")!.roles).toEqual({ sort: ["analyst", "owner"] });
    expect(s.protection("Sheet1")!.editLocked).toEqual(["owner"]);
    // The user prop is the person: the owner may type in a locked cell.
    click(1, 1);
    type("Owner's");
    key("Enter");
    expect(s.value("Sheet1", "A1")).toBe("Owner's");
  });

  it("refuses the same typing to someone without the role, and follows a changed user prop", () => {
    const s = mount({ id: "u2", roles: ["clerk"] });
    s.protectSheet("Sheet1", { editLocked: ["owner"] });
    act(() => root.render(<PliSheet session={s} user={{ id: "u2", roles: ["clerk"] }} />));
    click(1, 1);
    type("no");
    expect(notice()).toContain("locked");
    expect(s.user).toEqual({ id: "u2", roles: ["clerk"] });
    act(() => root.render(<PliSheet session={s} user={{ id: "u3", roles: ["owner"] }} />));
    expect(s.user!.id).toBe("u3");
    click(1, 1);
    type("yes");
    key("Enter");
    expect(s.value("Sheet1", "A1")).toBe("yes");
  });

  it("opens a range for its role without a password", () => {
    const s = mount({ id: "f", roles: ["finance"] });
    s.addEditRange("Sheet1", { name: "Quantities", ranges: ["B2:B3"], password: "open", permissions: ["finance"] });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} user={{ id: "f", roles: ["finance"] }} />));
    click(2, 2);
    type("12");
    key("Enter");
    expect(s.value("Sheet1", "B2")).toBe(12);
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("says that a range names other people, when it has no password to ask for", () => {
    const s = mount({ id: "x" });
    s.addEditRange("Sheet1", { name: "Quantities", ranges: ["B2:B3"], permissions: ["finance"] });
    s.protectSheet("Sheet1");
    act(() => root.render(<PliSheet session={s} user={{ id: "x" }} />));
    click(2, 2);
    type("12");
    expect(notice()).toContain("only some people");
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
});
