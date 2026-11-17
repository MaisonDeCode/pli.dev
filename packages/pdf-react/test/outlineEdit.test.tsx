// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import type { OutlineItem } from "@pli.dev/pdf";
import { byLabel, click, fire, flush, key, nextPage, q, qa, scrollTo, setValue, useHost } from "./harness";
import { dragEvent, mountPdf, openWords, stubDialogs, WORDS } from "./pagesSupport";

useHost();
stubDialogs();

const OUTLINE = [
  { title: "One", page: 0, children: [{ title: "One A", page: 1 }] },
  { title: "Two", page: 2 },
  { title: "Three", page: 4 },
];

const titles = (items: readonly OutlineItem[]): string[] => items.flatMap((i) => [i.title, ...titles(i.children).map((t) => `  ${t}`)]);
const row = (title: string) => qa(".pli-pdf-outline-row").find((r) => r.querySelector("[role=treeitem]")?.textContent === title)!;
const item = (title: string) => row(title).querySelector<HTMLElement>("[role=treeitem]")!;
const toast = () => document.querySelector(".pli-pdf-toast")?.textContent ?? "";

async function mount(outline = OUTLINE, extra: Record<string, unknown> = {}) {
  const session = await openWords(WORDS, "book.pdf", [], outline);
  await mountPdf(session, extra);
  await click(q("#pli-pdf-tab-outline"));
  // fold open so every bookmark is on screen
  for (const b of qa<HTMLButtonElement>(".pli-pdf-outline-toggle:not(:disabled)")) if (b.getAttribute("aria-label")?.startsWith("Expand")) await click(b);
  return session;
}

describe("adding bookmarks", () => {
  it("adds a bookmark to the page shown and lets you name it at once", async () => {
    const session = await mount([]);
    expect(q(".pli-pdf-empty").textContent).toContain("No bookmarks yet");
    await click(q(".pli-pdf-outline-add"));
    const input = byLabel("Bookmark title") as HTMLInputElement;
    expect(input.value).toBe("Page 1");
    await setValue(input, "Introduction");
    await key(input, "Enter");
    expect(session.outline.items).toHaveLength(1);
    expect(session.outline.items[0]).toMatchObject({ title: "Introduction", dest: { page: "p:main:0" } });
    expect(session.outline.items[0]!.dest!.y).toBeUndefined();
    expect(item("Introduction")).toBeTruthy();
    expect(document.activeElement).toBe(item("Introduction"));
    // it is in the saved file
    const reopened = await import("@pli.dev/pdf").then(async (m) => m.openPdf(await session.save()));
    expect(reopened.outline.items.map((i) => i.title)).toEqual(["Introduction"]);
  });

  it("remembers how far down the page the view is", async () => {
    const session = await mount([]);
    await scrollTo(q(".pli-pdf-scroller"), 400);
    await click(q(".pli-pdf-outline-add"));
    await key(byLabel("Bookmark title"), "Enter");
    const dest = session.outline.items[0]!.dest!;
    expect(dest.page).toBe("p:main:0");
    // 400 px down at 100% zoom, less the 16 px above the first page, in points
    expect(dest.y).toBeCloseTo((400 - 16) / (96 / 72), 0);
  });

  it("puts a new bookmark after the one that was chosen, at the same level", async () => {
    const session = await mount();
    await click(item("One A"));
    await nextPage();
    await click(q(".pli-pdf-outline-add"));
    await key(byLabel("Bookmark title"), "Enter");
    expect(titles(session.outline.items)).toEqual(["One", "  One A", "  Page 3", "Two", "Three"]);
    expect(session.outline.items[0]!.children[1]!.dest!.page).toBe("p:main:2");
  });
});

describe("renaming and deleting", () => {
  it("renames by double click and by F2, and Escape or an empty title changes nothing", async () => {
    const session = await mount();
    await act(async () => item("Two").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    let input = byLabel("Bookmark title") as HTMLInputElement;
    expect(input.value).toBe("Two");
    await setValue(input, "Second");
    await key(input, "Enter");
    expect(session.outline.items.map((i) => i.title)).toEqual(["One", "Second", "Three"]);
    item("Second").focus();
    await key(item("Second"), "F2");
    input = byLabel("Bookmark title") as HTMLInputElement;
    await setValue(input, "Nope");
    await key(input, "Escape");
    expect(session.outline.items[1]!.title).toBe("Second");
    await key(item("Second"), "F2");
    input = byLabel("Bookmark title") as HTMLInputElement;
    await setValue(input, "   ");
    await key(input, "Enter");
    expect(session.outline.items[1]!.title).toBe("Second");
    await session.save();
  });

  it("deletes with the button or the Delete key, with an Undo", async () => {
    const session = await mount();
    await click(item("Three"));
    await click(byLabel("Delete Three"));
    expect(session.outline.items.map((i) => i.title)).toEqual(["One", "Two"]);
    expect(toast()).toContain('Bookmark "Three" deleted');
    await click(q(".pli-pdf-toast-action"));
    expect(session.outline.items.map((i) => i.title)).toEqual(["One", "Two", "Three"]);
    item("Two").focus();
    await click(item("Two"));
    await key(item("Two"), "Delete");
    expect(session.outline.items.map((i) => i.title)).toEqual(["One", "Three"]);
    // a bookmark takes its children with it
    await click(item("One"));
    await key(item("One"), "Delete");
    expect(titles(session.outline.items)).toEqual(["Three"]);
    await click(q(".pli-pdf-toast-action"));
    expect(titles(session.outline.items)).toEqual(["One", "  One A", "Three"]);
  });
});

describe("structure", () => {
  it("indents and outdents with the buttons and the keyboard", async () => {
    const session = await mount();
    await click(item("Two"));
    await click(byLabel("Indent Two"));
    expect(titles(session.outline.items)).toEqual(["One", "  One A", "  Two", "Three"]);
    expect((byLabel("Indent One") as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel("Outdent One") as HTMLButtonElement).disabled).toBe(true);
    await key(item("Two"), "ArrowLeft", { altKey: true, shiftKey: true });
    expect(titles(session.outline.items)).toEqual(["One", "  One A", "Two", "Three"]);
    await key(item("Two"), "ArrowRight", { altKey: true, shiftKey: true });
    expect(titles(session.outline.items)).toEqual(["One", "  One A", "  Two", "Three"]);
    expect(document.activeElement).toBe(item("Two"));
    await click(item("One A"));
    await click(byLabel("Outdent One A"));
    // "One A" leaves "One" and comes right after it; "Two" stays under "One"
    expect(titles(session.outline.items)).toEqual(["One", "  Two", "One A", "Three"]);
  });

  it("moves a bookmark up and down among its neighbours with Alt+Arrow", async () => {
    const session = await mount();
    await click(item("Three"));
    await key(item("Three"), "ArrowUp", { altKey: true });
    expect(session.outline.items.map((i) => i.title)).toEqual(["One", "Three", "Two"]);
    await key(item("Three"), "ArrowUp", { altKey: true });
    await key(item("Three"), "ArrowUp", { altKey: true });
    expect(session.outline.items.map((i) => i.title)).toEqual(["Three", "One", "Two"]);
    await key(item("Three"), "ArrowDown", { altKey: true });
    expect(session.outline.items.map((i) => i.title)).toEqual(["One", "Three", "Two"]);
  });

  it("makes a bookmark go to the page shown", async () => {
    const session = await mount();
    await nextPage();
    await nextPage();
    await nextPage();
    await click(byLabel("Send One to the page shown"));
    expect(session.outline.items[0]!.dest!.page).toBe("p:main:3");
    expect(q(".pli-pdf-announce").textContent).toBe("The bookmark now goes to page 4");
  });

  it("drags a bookmark to a new place, or into another", async () => {
    const session = await mount();
    const draggable = (title: string) => row(title);
    const box = (r: HTMLElement) => (r.getBoundingClientRect = () => ({ top: 0, height: 100, left: 0, right: 100, bottom: 100, width: 100, x: 0, y: 0, toJSON() {} }) as DOMRect);
    // before "One"
    box(row("One"));
    await fire(draggable("Three"), dragEvent("dragstart"));
    await fire(row("One"), dragEvent("dragover", { clientY: 10 }));
    expect(row("One").getAttribute("data-drop")).toBe("before");
    await fire(row("One"), dragEvent("drop", { clientY: 10 }));
    expect(session.outline.items.map((i) => i.title)).toEqual(["Three", "One", "Two"]);
    // after "Two"
    box(row("Two"));
    await fire(draggable("Three"), dragEvent("dragstart"));
    await fire(row("Two"), dragEvent("drop", { clientY: 90 }));
    expect(session.outline.items.map((i) => i.title)).toEqual(["One", "Two", "Three"]);
    // into "Two"
    await fire(draggable("Three"), dragEvent("dragstart"));
    await fire(row("Two"), dragEvent("dragover", { clientY: 50 }));
    expect(row("Two").getAttribute("data-drop")).toBe("into");
    await fire(row("Two"), dragEvent("drop", { clientY: 50 }));
    expect(titles(session.outline.items)).toEqual(["One", "  One A", "Two", "  Three"]);
    // down inside the same list: "One" after "Two"
    box(row("Two"));
    await fire(draggable("One"), dragEvent("dragstart"));
    await fire(row("Two"), dragEvent("drop", { clientY: 90 }));
    expect(titles(session.outline.items)).toEqual(["Two", "  Three", "One", "  One A"]);
  });

  it("does not let a bookmark be dropped into itself or what is under it", async () => {
    const session = await mount();
    await fire(row("One"), dragEvent("dragstart"));
    const over = dragEvent("dragover", { clientY: 5 });
    await fire(row("One A"), over);
    expect(over.defaultPrevented).toBe(false);
    await fire(row("One A"), dragEvent("drop", { clientY: 5 }));
    expect(titles(session.outline.items)).toEqual(["One", "  One A", "Two", "Three"]);
    expect(session.canUndo).toBe(false);
  });
});

describe("read only", () => {
  it("shows the outline without any editing", async () => {
    const session = await mount(OUTLINE, { readOnly: true });
    expect(document.querySelector(".pli-pdf-outline-tools")).toBeNull();
    expect(document.querySelector(".pli-pdf-outline-actions")).toBeNull();
    expect(row("Two").getAttribute("draggable")).toBeNull();
    item("Two").focus();
    await key(item("Two"), "F2");
    await key(item("Two"), "Delete");
    expect(document.querySelector("input")).not.toBe(byLabel("Bookmark title"));
    expect(session.canUndo).toBe(false);
    await flush();
  });
});
