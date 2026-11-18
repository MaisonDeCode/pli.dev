// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, createDoc, paragraph, text } from "@pli.dev/docs";
import { PliDocument, type FilePicker } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const session = () => new DocumentSession(createDoc("Plan", [paragraph([text("Hello")])]));
const menuButtons = () => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")];
const openMenu = (name: string) => act(() => menuButtons().find((b) => b.textContent === name)!.click());
const items = () => [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")];
const item = (label: string) => items().find((i) => i.textContent?.includes(label));
const click = (el: Element | undefined) => act(() => (el as HTMLElement).click());

describe("PliDocument: extraMenus", () => {
  it("adds an item to File and runs it", () => {
    const onSelect = vi.fn();
    act(() => root.render(<PliDocument session={session()} extraMenus={{ File: [{ label: "Share…", onSelect }] }} />));
    openMenu("File");
    const labels = items().map((i) => i.textContent);
    expect(labels.indexOf("Share…")).toBeGreaterThan(labels.findIndex((l) => l?.includes("Print")));
    click(item("Share…"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("puts an item where it was asked to go", () => {
    act(() => root.render(<PliDocument session={session()} extraMenus={{ File: { items: [{ label: "Share…" }], after: "Download" } }} />));
    openMenu("File");
    const labels = items().map((i) => i.textContent);
    expect(labels.indexOf("Share…")).toBe(labels.findIndex((l) => l?.includes("Download")) + 1);
  });

  it("adds a menu of your own to the bar, with a submenu", () => {
    const onSelect = vi.fn();
    act(() => root.render(<PliDocument session={session()} extraMenus={{ AI: [{ label: "Summarize", onSelect }, { label: "Rewrite", items: [{ label: "Shorter" }] }] }} />));
    expect(menuButtons().map((b) => b.textContent)).toContain("AI");
    openMenu("AI");
    expect(items().map((i) => i.textContent?.replace("›", ""))).toEqual(expect.arrayContaining(["Summarize", "Rewrite"]));
    click(item("Summarize"));
    expect(onSelect).toHaveBeenCalled();
  });

  it("changes nothing without it", () => {
    act(() => root.render(<PliDocument session={session()} />));
    expect(menuButtons().map((b) => b.textContent)).toEqual(["File", "Edit", "View", "Insert", "Format"]);
  });
});

describe("PliDocument: filePicker", () => {
  it("asks the picker for File > Import DOCX, and says what for", async () => {
    const picker = vi.fn<FilePicker>(() => null);
    act(() => root.render(<PliDocument session={session()} filePicker={picker} />));
    openMenu("File");
    await act(async () => click(item("Import DOCX")));
    expect(picker).toHaveBeenCalledTimes(1);
    const req = picker.mock.calls[0]![0];
    expect(req.purpose).toBe("import");
    expect(req.accept).toContain(".docx");
    expect(req.multiple).toBe(false);
  });

  it("asks the picker for the image upload", async () => {
    const picker = vi.fn<FilePicker>(() => new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" }));
    act(() => root.render(<PliDocument session={session()} filePicker={picker} />));
    await act(async () => click(host.querySelector('[aria-label="Insert image"]')!));
    const upload = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find((b) => b.textContent?.includes("Upload from computer"))!;
    await act(async () => upload.click());
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0]![0]).toMatchObject({ purpose: "image", accept: "image/*" });
  });

  it("keeps the browser's own file field when there is no picker", () => {
    act(() => root.render(<PliDocument session={session()} />));
    expect(host.querySelector('input[type=file][aria-label="Import a DOCX file"]')).not.toBeNull();
  });
});
