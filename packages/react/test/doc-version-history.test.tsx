// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, Users, createDoc, memoryVersionStorage, paragraph, text, type Doc } from "@pli.dev/docs";
import { PliDocument } from "../src";

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

const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)));
const ana = () => new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
const session = () => new DocumentSession(createDoc("Plan", [paragraph([text("First words")])]));
const menuButton = (name: string) => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name)!;
const items = () => [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role^=menuitem]")];
const bodyText = (el: ParentNode) => el.querySelector(".pli-page, .pli-body, [data-type=paragraph], p")?.textContent ?? "";

async function open(s: DocumentSession, storage = memoryVersionStorage<Doc>(), users = ana()) {
  act(() => root.render(<PliDocument session={s} versions={storage} users={users} autoSaveVersions={false} />));
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
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form.pli-version-name")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
};
const rows = () => [...host.querySelectorAll<HTMLElement>(".pli-version-main")];

describe("PliDocument: View > Version history", () => {
  it("is only there when there is a history", async () => {
    act(() => root.render(<PliDocument session={session()} />));
    act(() => menuButton("View").click());
    expect(items().map((i) => i.textContent)).not.toContain("Version history");
  });

  it("opens the panel, lists the current version first, and names a version", async () => {
    await open(session());
    expect(host.querySelector(".pli-versions")).toBeTruthy();
    expect(rows()[0]!.textContent).toContain("Current version");
    await saveVersion("First draft");
    expect(rows().map((r) => r.querySelector(".pli-version-name-text")!.textContent)).toEqual(["Current version", "First draft"]);
  });

  it("shows an older version read-only while the real document is untouched, then goes back", async () => {
    const s = session();
    await open(s);
    await saveVersion("Before");
    act(() => s.transact([{ type: "set_title", title: "Changed title" }]));
    await settle();
    await act(async () => rows().find((r) => r.textContent?.includes("Before"))!.click());
    await settle();
    expect(host.querySelector(".pli-version-bar")?.textContent).toContain("Before");
    const preview = host.querySelector(".pli-version-preview .pli-document")!;
    expect(preview).toBeTruthy();
    expect(preview.getAttribute("data-readonly")).not.toBeNull();
    expect(s.state.title).toBe("Changed title"); // the real document is untouched
    // The preview shows the version's title, not the current one.
    expect(host.querySelector(".pli-version-preview")!.textContent).toContain("First words");
    act(() => (host.querySelector(".pli-version-bar .pli-button:not(.pli-button-primary)") as HTMLElement).click());
    await settle();
    expect(host.querySelector(".pli-version-preview")).toBeNull();
  });

  it("restores a previewed version as a new version, and keeps the earlier ones", async () => {
    const s = session();
    const storage = await open(s);
    await saveVersion("Before");
    act(() => s.transact([{ type: "set_title", title: "Changed title" }]));
    await settle();
    await act(async () => rows().find((r) => r.textContent?.includes("Before"))!.click());
    await settle();
    await act(async () => (host.querySelector(".pli-version-bar .pli-button-primary") as HTMLElement).click());
    await settle();
    expect(s.state.title).toBe("Plan");
    expect(host.querySelector(".pli-version-preview")).toBeNull();
    const names = rows().map((r) => r.querySelector(".pli-version-name-text")!.textContent);
    expect(names).toEqual(expect.arrayContaining(["Before", 'Before restoring "Before"', 'Restored "Before"']));
    expect(storage.count(s.state.id)).toBe(3);
    // Undo brings back what was there before the restore.
    act(() => s.undo());
    expect(s.state.title).toBe("Changed title");
  });

  it("leaves the preview when the panel is closed", async () => {
    const s = session();
    await open(s);
    await saveVersion("Before");
    await act(async () => rows().find((r) => r.textContent?.includes("Before"))!.click());
    await settle();
    expect(host.querySelector(".pli-version-preview")).toBeTruthy();
    act(() => (host.querySelector('button[aria-label="Close version history"]') as HTMLElement).click());
    await settle();
    expect(host.querySelector(".pli-version-preview")).toBeNull();
    expect(host.querySelector(".pli-versions")).toBeNull();
  });

  it("offers no restore to a viewer", async () => {
    const viewer = new Users({ current: { id: "v", name: "V" }, role: "viewer" });
    const storage = memoryVersionStorage<Doc>();
    const s = session();
    await storage.save(s.state.id, { id: "v1", name: "Old", at: 1, by: "ana", hash: "x", state: JSON.parse(JSON.stringify(s.state)) });
    await open(s, storage, viewer);
    expect(host.textContent).not.toContain("Restore this version");
    await act(async () => rows().find((r) => r.textContent?.includes("Old"))!.click());
    await settle();
    expect(host.querySelector(".pli-version-bar")).toBeTruthy();
    expect(host.querySelector(".pli-version-bar .pli-button-primary")).toBeNull();
  });
});
