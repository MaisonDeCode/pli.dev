// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, createDoc, paragraph } from "@pli.dev/docs";
import { PliDocument, extendMenus, relabelMenus, type MenuDefinition, type MenuLabels } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const menus = (): MenuDefinition[] => [
  {
    label: "File",
    items: [
      { label: "Open" },
      "separator",
      { label: "Download", items: [{ label: "DOCX document (.docx)" }, { label: "PDF document (.pdf)" }] },
      "separator",
      { label: "Print" },
    ],
  },
  { label: "Insert", items: [{ label: "Table", items: [{ label: "2 × 2" }] }, { label: "Page break" }] },
  { label: "Format", items: [{ label: "Table", items: [{ label: "Insert row" }] }, { label: "Clear formatting" }] },
  { label: "Help", items: [{ label: "Shortcuts" }] },
];

/** The menus as nested text, to compare. */
const shape = (list: MenuDefinition[]) =>
  list.map((m) => [m.label, ...m.items.map((i): unknown => (i === "separator" ? "-" : i.items ? [i.label, ...i.items.map((x) => (x === "separator" ? "-" : x.label))] : i.label))]);

describe("relabelMenus", () => {
  it("renames a menu or an item by its text, wherever it is", () => {
    const out = relabelMenus(menus(), { Download: "Export", Table: "Grid", Help: "Support" });
    expect(shape(out)).toEqual([
      ["File", "Open", "-", ["Export", "DOCX document (.docx)", "PDF document (.pdf)"], "-", "Print"],
      ["Insert", ["Grid", "2 × 2"], "Page break"],
      ["Format", ["Grid", "Insert row"], "Clear formatting"],
      ["Support", "Shortcuts"],
    ]);
  });

  it("renames just the one a path names, and a path wins over the plain text", () => {
    const out = relabelMenus(menus(), { "Insert > Table": "Add a table", Table: "Grid" });
    expect(shape(out)[1]).toEqual(["Insert", ["Add a table", "2 × 2"], "Page break"]);
    expect(shape(out)[2]).toEqual(["Format", ["Grid", "Insert row"], "Clear formatting"]);
  });

  it("finds an item by the text each part has now, even when a part above it is renamed", () => {
    const out = relabelMenus(menus(), { "File > Download": "Export", "File > Download > PDF document (.pdf)": "PDF" });
    expect(shape(out)[0]).toEqual(["File", "Open", "-", ["Export", "DOCX document (.docx)", "PDF"], "-", "Print"]);
  });

  it("takes an item out with false, with its submenu, and tidies the lines it leaves", () => {
    const out = relabelMenus(menus(), { Download: false, Print: false });
    expect(shape(out)[0]).toEqual(["File", "Open"]);
    expect(shape(relabelMenus(menus(), { Open: false }))[0]).toEqual(["File", ["Download", "DOCX document (.docx)", "PDF document (.pdf)"], "-", "Print"]);
  });

  it("takes out a submenu when every item in it is taken out, and a menu with nothing left", () => {
    const out = relabelMenus(menus(), { "DOCX document (.docx)": false, "PDF document (.pdf)": false, "Insert > Table": false, "Insert > Page break": false });
    expect(shape(out)[0]).toEqual(["File", "Open", "-", "Print"]);
    expect(out.map((m) => m.label)).toEqual(["File", "Format", "Help"]);
  });

  it("leaves the original menus alone, ignores keys that match nothing, and returns the same list for no labels", () => {
    const original = menus();
    relabelMenus(original, { Open: "Open file" });
    expect(shape(original)).toEqual(shape(menus()));
    expect(shape(relabelMenus(original, { "No such item": "x", "File > Nothing": false }))).toEqual(shape(menus()));
    expect(relabelMenus(original, undefined)).toBe(original);
    expect(relabelMenus(original, {})).toBe(original);
  });

  it("keeps what an item does, its shortcut and its state", () => {
    const onSelect = () => undefined;
    const [file] = relabelMenus([{ label: "File", items: [{ label: "Save", shortcut: "Ctrl+S", disabled: true, checked: true, onSelect }] }], { Save: "Keep" });
    expect(file!.items[0]).toEqual({ label: "Keep", shortcut: "Ctrl+S", disabled: true, checked: true, onSelect });
  });

  it("accepts a path written with or without spaces around the arrow", () => {
    expect(shape(relabelMenus(menus(), { "File>Download": "Export" }))[0]).toEqual(["File", "Open", "-", ["Export", "DOCX document (.docx)", "PDF document (.pdf)"], "-", "Print"]);
  });
});

describe("extendMenus with labels", () => {
  it("adds your items first, by the text the built-in items have now, and then renames and removes", () => {
    const labels: MenuLabels = { Download: "Export", "Share…": "Send" };
    const out = extendMenus(menus(), { File: { items: [{ label: "Share…" }], after: "Download" } }, labels);
    expect(shape(out)[0]).toEqual(["File", "Open", "-", ["Export", "DOCX document (.docx)", "PDF document (.pdf)"], "Send", "-", "Print"]);
  });
});

describe("PliDocument menuLabels", () => {
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
  const session = () => new DocumentSession(createDoc("T", [paragraph("x")]));
  const bar = () => [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].map((b) => b.textContent);
  const open = (name: string) => act(() => void [...host.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name)!.click());
  const items = () => [...host.querySelectorAll<HTMLElement>(".pli-menu-panel [role=menuitem]")].map((i) => i.textContent?.replace("›", "").trim());

  it("renames and removes the built-in menus and items, and what the item does is unchanged", () => {
    act(() => root.render(<PliDocument session={session()} menuLabels={{ File: "Document", Help: false, "Insert > Page break": false, "Download": "Export" }} />));
    expect(bar()).toContain("Document");
    expect(bar()).not.toContain("File");
    open("Document");
    expect(items()).toContain("Export");
    expect(items()).not.toContain("Download");
    open("Insert");
    expect(items()).not.toContain("Page break");
    expect(items()).toContain("Horizontal line");
  });

  it("shows the built-in text when there are no labels", () => {
    act(() => root.render(<PliDocument session={session()} />));
    expect(bar()).toEqual(expect.arrayContaining(["File", "Edit", "View", "Insert", "Format"]));
    open("File");
    expect(items()).toContain("Download");
  });
});
