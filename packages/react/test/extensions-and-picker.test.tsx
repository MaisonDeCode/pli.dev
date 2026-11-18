// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileInput, FilePickerProvider, extendMenus, pickWith, type FilePicker, type MenuDefinition } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = (): MenuDefinition[] => [
  { label: "File", items: [{ label: "New" }, { label: "Open…" }, "separator", { label: "Download" }] },
  { label: "Edit", items: [{ label: "Undo" }] },
  { label: "Help", items: [{ label: "About" }] },
];
const labels = (menu: MenuDefinition | undefined) => menu?.items.map((e) => (e === "separator" ? "-" : e.label));

describe("extendMenus", () => {
  it("returns the same menus when there is nothing to add", () => {
    const menus = base();
    expect(extendMenus(menus, undefined)).toBe(menus);
    expect(extendMenus(menus, {})).toBe(menus);
  });

  it("adds items to the end of a built-in menu, after a divider", () => {
    const out = extendMenus(base(), { File: [{ label: "Share…" }] });
    expect(labels(out[0])).toEqual(["New", "Open…", "-", "Download", "-", "Share…"]);
  });

  it("does not double a divider when the menu already ends in one", () => {
    const menus = base();
    menus[1]!.items.push("separator");
    expect(labels(extendMenus(menus, { Edit: [{ label: "Mine" }] })[1])).toEqual(["Undo", "-", "Mine"]);
  });

  it("puts items next to a named item with after or before", () => {
    const after = extendMenus(base(), { File: { items: [{ label: "Share…" }], after: "Open…" } });
    expect(labels(after[0])).toEqual(["New", "Open…", "Share…", "-", "Download"]);
    const before = extendMenus(base(), { File: { items: [{ label: "Share…" }], before: "New" } });
    expect(labels(before[0])).toEqual(["Share…", "New", "Open…", "-", "Download"]);
  });

  it("appends when the named item is not there", () => {
    const out = extendMenus(base(), { File: { items: [{ label: "Share…" }], after: "Nothing" } });
    expect(labels(out[0])).toEqual(["New", "Open…", "-", "Download", "-", "Share…"]);
  });

  it("adds menus of your own before Help, in the order given", () => {
    const out = extendMenus(base(), { AI: [{ label: "Summarize" }], Reports: [{ label: "Weekly" }] });
    expect(out.map((m) => m.label)).toEqual(["File", "Edit", "AI", "Reports", "Help"]);
  });

  it("adds them last when there is no Help menu", () => {
    const out = extendMenus(base().slice(0, 2), { AI: [{ label: "Summarize" }] });
    expect(out.map((m) => m.label)).toEqual(["File", "Edit", "AI"]);
  });

  it("keeps submenus and skips empty additions", () => {
    const out = extendMenus(base(), { AI: [{ label: "Rewrite", items: [{ label: "Shorter" }] }], Edit: [] });
    expect(out.find((m) => m.label === "AI")!.items).toEqual([{ label: "Rewrite", items: [{ label: "Shorter" }] }]);
    expect(labels(out[1])).toEqual(["Undo"]);
  });

  it("does not change the menus it was given", () => {
    const menus = base();
    extendMenus(menus, { File: [{ label: "Share…" }] });
    expect(labels(menus[0])).toEqual(["New", "Open…", "-", "Download"]);
  });
});

describe("pickWith", () => {
  const file = (name: string) => new File(["x"], name);

  it("hands a custom picker the request, with a way back to the browser's chooser", async () => {
    const picker = vi.fn<FilePicker>(async () => file("a.png"));
    const files = await pickWith(picker, { purpose: "image", accept: "image/*", label: "Insert a picture" });
    expect(files.map((f) => f.name)).toEqual(["a.png"]);
    const req = picker.mock.calls[0]![0];
    expect(req).toMatchObject({ purpose: "image", accept: "image/*", multiple: false, label: "Insert a picture" });
    expect(typeof req.browse).toBe("function");
  });

  it("accepts one file, a list, or nothing", async () => {
    const o = { purpose: "open", accept: ".docx", multiple: true, label: "Open" } as const;
    expect(await pickWith(() => [file("a"), file("b")], o)).toHaveLength(2);
    expect(await pickWith(() => null, o)).toEqual([]);
    expect(await pickWith(() => undefined, o)).toEqual([]);
    expect(await pickWith(() => [], o)).toEqual([]);
  });

  it("keeps only the first file when one is wanted", async () => {
    const files = await pickWith(() => [file("a"), file("b")], { purpose: "open", accept: "*", label: "Open" });
    expect(files.map((f) => f.name)).toEqual(["a"]);
  });
});

describe("FileInput", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("is the browser's own file field when there is no picker", () => {
    act(() => root.render(<FileInput purpose="image" accept="image/*" label="Picture file" onFiles={() => {}} />));
    const input = host.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(input.accept).toBe("image/*");
    expect(input.getAttribute("aria-label")).toBe("Picture file");
    expect(host.querySelector("button")).toBeNull();
  });

  it("is a button for your picker when there is one, and passes on what it returns", async () => {
    const onFiles = vi.fn();
    const picker: FilePicker = () => new File(["x"], "from-drive.png");
    act(() => root.render(<FilePickerProvider picker={picker}><FileInput purpose="image" accept="image/*" label="Choose a picture" onFiles={onFiles} /></FilePickerProvider>));
    expect(host.querySelector("input")).toBeNull();
    await act(async () => host.querySelector("button")!.click());
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]![0][0].name).toBe("from-drive.png");
  });

  it("does nothing when the picker is cancelled", async () => {
    const onFiles = vi.fn();
    act(() => root.render(<FilePickerProvider picker={() => null}><FileInput purpose="image" accept="image/*" label="Choose" onFiles={onFiles} /></FilePickerProvider>));
    await act(async () => host.querySelector("button")!.click());
    expect(onFiles).not.toHaveBeenCalled();
  });
});
