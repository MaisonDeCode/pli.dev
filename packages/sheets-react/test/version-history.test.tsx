// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Users, memoryVersionStorage } from "@pli.dev/core";
import { SheetSession, createWorkbook, type Workbook } from "@pli.dev/sheets";
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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)));
const editor = () => new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
const make = () => new SheetSession(createWorkbook("Budget"));
const setA1 = (s: SheetSession, v: string) => act(() => s.transact([{ type: "set_cells", sheet: s.state.sheets[0]!.id, cells: { A1: { v } } }]));
const a1 = (s: SheetSession) => s.state.sheets[0]!.cells.A1?.v;
const menuButton = (name: string) => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name)!;
const items = () => [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role^=menuitem]")];
const rows = () => [...host.querySelectorAll<HTMLElement>(".pli-version-main")];

async function open(s: SheetSession, storage = memoryVersionStorage<Workbook>(), users = editor()) {
  act(() => root.render(<PliSheet session={s} versions={storage} users={users} autoSaveVersions={false} />));
  await settle();
  act(() => menuButton("View").click());
  const item = items().find((i) => i.textContent?.includes("Version history"));
  expect(item, items().map((i) => i.textContent).join(" | ")).toBeTruthy();
  act(() => item!.click());
  await settle();
  return storage;
}

const saveVersion = async (name: string) => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Name for the current version"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form.pli-version-name")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
};

describe("PliSheet: View > Version history", () => {
  it("is only there when there is a history", () => {
    act(() => root.render(<PliSheet session={make()} />));
    act(() => menuButton("View").click());
    expect(items().map((i) => i.textContent)).not.toContain("Version history");
  });

  it("opens the panel with the current version first, and names a version", async () => {
    await open(make());
    expect(host.querySelector(".pli-versions")).toBeTruthy();
    await saveVersion("Q1 numbers");
    expect(rows().map((r) => r.querySelector(".pli-version-name-text")!.textContent)).toEqual(["Current version", "Q1 numbers"]);
  });

  it("shows an older version read-only while the real workbook is untouched, then goes back", async () => {
    const s = make();
    setA1(s, "old value");
    await open(s);
    await saveVersion("Before");
    setA1(s, "new value");
    await act(async () => rows().find((r) => r.textContent?.includes("Before"))!.click());
    await settle();
    expect(host.querySelector(".pli-version-bar")?.textContent).toContain("Before");
    const preview = host.querySelector(".pli-sheet-version-preview")!;
    expect(preview.textContent).toContain("old value");
    expect(preview.textContent).not.toContain("new value");
    expect(a1(s)).toBe("new value");
    act(() => (host.querySelector(".pli-version-bar .pli-button:not(.pli-button-primary)") as HTMLElement).click());
    await settle();
    expect(host.querySelector(".pli-sheet-version-preview")).toBeNull();
  });

  it("restores a previewed version as a new version, keeps the earlier ones, and undo brings the sheet back", async () => {
    const s = make();
    setA1(s, "old value");
    const storage = await open(s);
    await saveVersion("Before");
    setA1(s, "new value");
    await act(async () => rows().find((r) => r.textContent?.includes("Before"))!.click());
    await settle();
    await act(async () => (host.querySelector(".pli-version-bar .pli-button-primary") as HTMLElement).click());
    await settle();
    expect(a1(s)).toBe("old value");
    expect(host.querySelector(".pli-sheet-version-preview")).toBeNull();
    const names = rows().map((r) => r.querySelector(".pli-version-name-text")!.textContent);
    expect(names).toEqual(expect.arrayContaining(["Before", 'Before restoring "Before"', 'Restored "Before"']));
    expect(storage.count(s.state.id)).toBe(3);
    act(() => void s.undo());
    expect(a1(s)).toBe("new value");
  });

  it("offers no restore to a viewer", async () => {
    const viewer = new Users({ current: { id: "v", name: "V" }, role: "viewer" });
    const storage = memoryVersionStorage<Workbook>();
    const s = make();
    await storage.save(s.state.id, { id: "v1", name: "Old", at: 1, by: "ana", hash: "x", state: JSON.parse(JSON.stringify(s.state)) });
    await open(s, storage, viewer);
    expect(host.textContent).not.toContain("Restore this version");
    await act(async () => rows().find((r) => r.textContent?.includes("Old"))!.click());
    await settle();
    expect(host.querySelector(".pli-version-bar")).toBeTruthy();
    expect(host.querySelector(".pli-version-bar .pli-button-primary")).toBeNull();
  });
});
