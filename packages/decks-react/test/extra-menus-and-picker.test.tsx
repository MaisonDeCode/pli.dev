// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createDeck, serializeDeck } from "@pli.dev/decks";
import type { FilePickRequest } from "@pli.dev/react";
import { PliDeck } from "../src";
import { byLabel, click, menuItem, newSession, openMenu, q, qa, render, runAsync, useHost } from "./harness";

useHost();

const labels = () => [...document.querySelectorAll(".pli-menu-panel > ul > li")].map((li) => (li.classList.contains("pli-menu-separator") || li.querySelector("hr") || li.getAttribute("role") === "separator" ? "-" : li.querySelector(".pli-menu-label")?.textContent ?? ""));
const menuNames = () => qa(".pli-menubar-button").map((b) => b.textContent);

describe("extraMenus", () => {
  it("adds items to the end of a built-in menu, after a divider, and they run", () => {
    const share = vi.fn();
    render(<PliDeck session={newSession()} extraMenus={{ File: [{ label: "Share…", onSelect: share }] }} />);
    openMenu("File");
    const items = labels();
    expect(items.slice(-2)).toEqual(["-", "Share…"]);
    expect(items).toContain("Open…");
    click(menuItem("Share…"));
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("can put items after or before a built-in one", () => {
    render(<PliDeck session={newSession()} extraMenus={{ Insert: { items: [{ label: "Chart from data…", onSelect: () => undefined }], after: "Table" }, Edit: { items: [{ label: "Mine", onSelect: () => undefined }], before: "Undo" } }} />);
    openMenu("Insert");
    const insert = labels();
    expect(insert[insert.indexOf("Table") + 1]).toBe("Chart from data…");
    openMenu("Edit");
    expect(labels()[0]).toBe("Mine");
  });

  it("makes a menu of its own, last (there is no Help here), with submenus", () => {
    const run = vi.fn();
    render(<PliDeck session={newSession()} extraMenus={{ AI: [{ label: "Summarize", onSelect: run }, { label: "Rewrite", items: [{ label: "Shorter", onSelect: run }] }], Reports: [{ label: "Export report", onSelect: run }] }} />);
    expect(menuNames()).toEqual(["File", "Edit", "View", "Insert", "Slide", "Format", "Arrange", "Tools", "AI", "Reports"]);
    openMenu("AI");
    expect(labels()).toEqual(["Summarize", "Rewrite"]);
    click(menuItem("Summarize"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves your items alone when the presentation is read only (the built-in ones are disabled)", () => {
    const run = vi.fn();
    render(<PliDeck session={newSession()} readOnly extraMenus={{ Edit: [{ label: "Report a problem", onSelect: run }] }} />);
    openMenu("Edit");
    expect(menuItem("Report a problem").hasAttribute("disabled") || menuItem("Report a problem").getAttribute("aria-disabled") === "true").toBe(false);
    expect(menuItem("Paste").hasAttribute("disabled") || menuItem("Paste").getAttribute("aria-disabled") === "true").toBe(true);
    click(menuItem("Report a problem"));
    expect(run).toHaveBeenCalled();
  });

  it("changes nothing when nothing is passed", () => {
    render(<PliDeck session={newSession()} extraMenus={{}} />);
    expect(menuNames()).toEqual(["File", "Edit", "View", "Insert", "Slide", "Format", "Arrange", "Tools"]);
  });
});

describe("filePicker", () => {
  it("is asked for a presentation by File > Open, and what it returns is loaded", async () => {
    const s = newSession();
    const file = new File([serializeDeck(createDeck({ title: "Picked deck" }))], "picked.pli", { type: "application/json" });
    const picker = vi.fn(async (_req: FilePickRequest) => file);
    render(<PliDeck session={s} filePicker={picker} />);
    openMenu("File");
    await runAsync(async () => {
      click(menuItem("Open…"));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(picker).toHaveBeenCalledTimes(1);
    const req = picker.mock.calls[0]![0];
    expect(req).toMatchObject({ purpose: "open", multiple: false });
    expect(req.accept).toContain(".pptx");
    expect(typeof req.browse).toBe("function");
    expect(s.deck.title).toBe("Picked deck");
  });

  it("does nothing when the picker is cancelled", async () => {
    const s = newSession();
    const before = s.deck;
    render(<PliDeck session={s} filePicker={() => null} />);
    openMenu("File");
    await runAsync(async () => {
      click(menuItem("Open…"));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(s.deck).toBe(before);
    expect(document.querySelector(".pli-deck-notice")).toBeNull();
  });

  it("is asked for pictures by Insert > Image, and puts them on the slide", async () => {
    const s = newSession();
    const picker = vi.fn((_req: FilePickRequest) => [new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" })]);
    render(<PliDeck session={s} filePicker={picker} />);
    const slide = s.deck.slides[0]!.id;
    const count = s.slide(slide).elements.length;
    openMenu("Insert");
    click(menuItem("Image"));
    await runAsync(async () => {
      click(menuItem("Upload from computer…"));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(picker.mock.calls[0]![0]).toMatchObject({ purpose: "image", accept: "image/*", multiple: true });
    expect(s.slide(slide).elements.length).toBe(count + 1);
    expect(s.slide(slide).elements.at(-1)!.type).toBe("image");
  });

  it("is asked for the theme file in the Themes panel", async () => {
    const picker = vi.fn((_req: FilePickRequest) => null);
    render(<PliDeck session={newSession()} filePicker={picker} />);
    click(byLabel("Theme"));
    expect(document.querySelector('input[aria-label^="Import theme"]')).toBeNull();
    const button = qa<HTMLButtonElement>(".pli-deck-theme-panel button").find((b) => b.textContent === "Import theme…")!;
    await runAsync(async () => {
      click(button);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(picker.mock.calls[0]![0]).toMatchObject({ purpose: "import", multiple: false });
    expect(picker.mock.calls[0]![0].accept).toContain(".potx");
  });

  it("gives the background dialog's picture field to the picker too", async () => {
    const picker = vi.fn((_req: FilePickRequest) => null);
    render(<PliDeck session={newSession()} filePicker={picker} />);
    openMenu("Slide");
    click(menuItem("Change background…"));
    const button = qa<HTMLButtonElement>(".pli-dialog button").find((b) => b.textContent === "Choose a picture…")!;
    expect(document.querySelector('input[aria-label="Background image"]')).toBeNull();
    await runAsync(async () => {
      click(button);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(picker.mock.calls[0]![0]).toMatchObject({ purpose: "image", accept: "image/*" });
  });

  it("keeps the browser's own inputs when no picker is given", () => {
    render(<PliDeck session={newSession()} />);
    expect(q('input[type="file"][aria-label="Upload picture"]')).toBeTruthy();
    expect(q('input[type="file"][aria-label="Open presentation"]')).toBeTruthy();
    click(byLabel("Theme"));
    expect(document.querySelector('input[aria-label^="Import theme"]')).toBeTruthy();
  });
});
