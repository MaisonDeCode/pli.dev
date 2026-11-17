// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollabRoom, Users, memoryHub } from "@pli.dev/core";
import { SheetSession, createWorkbook, type CellAnchor } from "@pli.dev/sheets";
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
  vi.restoreAllMocks();
});

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const sink = () => q<HTMLTextAreaElement>(".pli-grid-sink");
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void sink().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const ana = { id: "ana", name: "Ana Ito" };
const ben = { id: "ben", name: "Ben Ray", color: "#2f9e44" };

describe("PliSheet with comments and people", () => {
  it("Ctrl+Alt+M opens the panel to write a comment, the cell gets a mark, the thread is listed", async () => {
    const session = new SheetSession(createWorkbook("B", ["Data"]));
    session.setCell("Data", "A1", "7");
    act(() => root.render(<PliSheet session={session} users={new Users({ current: ana })} comments />));
    key("m", { ctrlKey: true, altKey: true });
    await tick();
    expect(document.querySelector(".pli-sheet-comments")).toBeTruthy();
    const box = q<HTMLTextAreaElement>(".pli-sheet-comments textarea");
    expect(box).toBeTruthy();
    // The shared composer takes the text and sends with Ctrl+Enter.
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(box, "Is 7 right?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
    await tick();
    expect(session.comments.client!.threads).toHaveLength(1);
    expect(session.cell("Data", "A1")?.thread).toBe(session.comments.client!.threads[0]!.id);
    expect(host.querySelector(".pli-grid-thread")).toBeTruthy();
    expect(q(".pli-sheet-comments").textContent).toContain("Is 7 right?");
    expect(q(".pli-sheet-comments").textContent).toContain("Data!A1");
  });

  it("shows the comment item in the Insert menu and leaves notes alone", () => {
    const session = new SheetSession(createWorkbook("B", ["Data"]));
    act(() => root.render(<PliSheet session={session} users={new Users({ current: ana })} comments />));
    expect(q('[aria-label="Comments"]')).toBeTruthy();
    act(() => root.render(<PliSheet session={new SheetSession(createWorkbook("B"))} />));
    expect(host.querySelector('[aria-label="Comments"]')).toBeNull();
  });

  it("shows other people: avatars, an outline round their cell with their name, a dot on their sheet tab, and typing", async () => {
    const hub = memoryHub();
    const session = new SheetSession(createWorkbook("B", ["Data", "Other"]));
    const room = new CollabRoom<CellAnchor>({ room: "r", transport: hub.transport(), users: new Users({ current: ana }) });
    const friend = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users({ current: ben }) });
    await friend.connect();
    act(() => root.render(<PliSheet session={session} users={new Users({ current: ana })} room={room} comments />));
    await tick();
    const dataId = session.sheet("Data").id;
    act(() => friend.setPresence({ sheet: dataId, selection: { active: "C3", ranges: ["C3:D4"] }, editing: "C3" }));
    await tick();
    expect(host.querySelectorAll(".pli-grid-peers .pli-peer-outline").length).toBeGreaterThan(0);
    expect(host.querySelector(".pli-grid-peers")!.textContent).toContain("Ben Ray is typing");
    expect(host.querySelector(".pli-sheet-tab-person")).toBeTruthy();
    expect(host.querySelector('.pli-sheet-tab-people')!.getAttribute("aria-label")).toContain("Ben Ray");
    // Someone on another sheet leaves the outline off this one.
    act(() => friend.setPresence({ sheet: session.sheet("Other").id, selection: { active: "A1", ranges: ["A1"] }, editing: null }));
    await tick();
    expect(host.querySelectorAll(".pli-grid-peers .pli-peer-outline").length).toBe(0);
    act(() => root.unmount());
    root = createRoot(host);
    friend.disconnect();
  });
});
