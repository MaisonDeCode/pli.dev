// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import type { FilePicker } from "@pli.dev/react";
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

const session = () => new SheetSession(createWorkbook("Budget"));
const menuButtons = () => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")];
const openMenu = (name: string) => act(() => menuButtons().find((b) => b.textContent === name)!.click());
const items = () => [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")];
const item = (label: string) => items().find((i) => i.textContent?.startsWith(label));
const click = (el: Element | undefined) => act(() => (el as HTMLElement).click());

describe("PliSheet: extraMenus", () => {
  it("adds an item to File, after a divider, and runs it", () => {
    const onSelect = vi.fn();
    act(() => root.render(<PliSheet session={session()} extraMenus={{ File: [{ label: "Share…", onSelect }] }} />));
    openMenu("File");
    const labels = items().map((i) => i.textContent);
    expect(labels[labels.length - 1]).toBe("Share…");
    click(item("Share…"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("adds a menu of your own to the bar", () => {
    const onSelect = vi.fn();
    act(() => root.render(<PliSheet session={session()} extraMenus={{ AI: [{ label: "Fill from a prompt…", onSelect }] }} />));
    const names = menuButtons().map((b) => b.textContent);
    expect(names).toEqual(["File", "Edit", "View", "Insert", "Format", "Data", "Review", "AI"]);
    openMenu("AI");
    click(item("Fill from a prompt"));
    expect(onSelect).toHaveBeenCalled();
  });

  it("changes nothing without it", () => {
    act(() => root.render(<PliSheet session={session()} />));
    expect(menuButtons().map((b) => b.textContent)).toEqual(["File", "Edit", "View", "Insert", "Format", "Data", "Review"]);
  });
});

describe("PliSheet: filePicker", () => {
  it("is asked for File > Import with the spreadsheet types", async () => {
    const picker = vi.fn<FilePicker>(() => null);
    act(() => root.render(<PliSheet session={session()} filePicker={picker} />));
    openMenu("File");
    await act(async () => click(item("Import")));
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0]![0]).toMatchObject({ purpose: "import", multiple: false });
    expect(picker.mock.calls[0]![0].accept).toContain(".xlsx");
  });

  it("is asked for Insert > Image, and may return several files", async () => {
    const picker = vi.fn<FilePicker>(() => null);
    act(() => root.render(<PliSheet session={session()} filePicker={picker} />));
    openMenu("Insert");
    await act(async () => click(item("Image…")));
    expect(picker.mock.calls[0]![0]).toMatchObject({ purpose: "image", accept: "image/*", multiple: true });
  });

  it("keeps the hidden file fields when there is no picker", () => {
    act(() => root.render(<PliSheet session={session()} />));
    expect(host.querySelector('input[type=file][aria-label="Import a spreadsheet"]')).not.toBeNull();
    expect(host.querySelector('input[type=file][aria-label="Insert an image"]')).not.toBeNull();
  });
});
