// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { byLabel, chooseMenu, click, fire, flush, key, q, qa, setValue, useHost } from "./harness";
import { dragEvent, fileOf, mountPdf, openWords, pdfOf, sessionWords, stubDialogs, WORDS } from "./pagesSupport";

useHost();
stubDialogs();

const cells = () => qa(".pli-pdf-cell");
const body = () => q(".pli-pdf-organise-body");
const order = (s: { doc: { pages: { id: string }[] } }) => s.doc.pages.map((p) => p.id.replace("p:main:", ""));
const toast = () => document.querySelector(".pli-pdf-toast")?.textContent ?? "";
const pageButton = (n: number) => q<HTMLButtonElement>(`.pli-pdf-organise button[aria-label="Page ${n}"]`);
const dialogButton = (text: string) => qa<HTMLButtonElement>("dialog[open] button").find((b) => b.textContent!.trim() === text)!;

// The grid has no size in jsdom, so it lays out for 900 by 600: four 166 px cells with 16 px gaps, centred; rows are 272 px tall.
const cellX = (col: number, frac = 0.1) => 94 + col * 182 + frac * 166;
const cellY = (row: number) => 20 + row * 272 + 10;

async function open(n = 6, extra: Record<string, unknown> = {}) {
  const session = await openWords(WORDS.slice(0, n));
  const m = await mountPdf(session, extra);
  await click(byLabel("Organise pages"));
  await flush();
  return m;
}

describe("organise view", () => {
  it("opens over the document with a big thumbnail for each page, and Done closes it", async () => {
    await open();
    expect(q(".pli-pdf-organise").getAttribute("aria-label")).toBe("Organise pages");
    expect(cells().map((c) => c.querySelector(".pli-pdf-thumb-label")!.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(q(".pli-pdf-scroller").hasAttribute("inert")).toBe(true);
    expect(q(".pli-pdf-announce").textContent).toBe("Organise pages");
    await click(q(".pli-pdf-organise-done"));
    expect(document.querySelector(".pli-pdf-organise")).toBeNull();
    expect(q(".pli-pdf-scroller").hasAttribute("inert")).toBe(false);
  });

  it("opens from the View menu too, and Escape closes it", async () => {
    const session = await openWords(WORDS.slice(0, 3));
    await mountPdf(session);
    await chooseMenu("View", "Organise pages…");
    expect(q(".pli-pdf-organise")).toBeTruthy();
    await key(pageButton(1), "Escape");
    expect(document.querySelector(".pli-pdf-organise")).toBeNull();
  });

  it("selects with click, shift and ctrl/cmd, and keeps the selection in the session", async () => {
    const { session } = await open();
    await click(pageButton(2));
    expect(session.selection.pages).toEqual(["p:main:1"]);
    expect(pageButton(2).getAttribute("aria-pressed")).toBe("true");
    await click(pageButton(4), { shiftKey: true });
    expect(session.selection.pages).toEqual(["p:main:1", "p:main:2", "p:main:3"]);
    await click(pageButton(6), { ctrlKey: true });
    expect(session.selection.pages).toHaveLength(4);
    await key(body(), "a", { ctrlKey: true });
    expect(session.selection.pages).toHaveLength(6);
  });

  it("has a select mode where a tap adds or takes away a page (no Ctrl key on a phone)", async () => {
    const { session } = await open();
    await click(q(".pli-pdf-organise-select"));
    expect(q(".pli-pdf-organise-select").getAttribute("aria-pressed")).toBe("true");
    await click(pageButton(2));
    await click(pageButton(4));
    await click(pageButton(5));
    // the page shown (the first) counts as chosen, so the taps add to it
    expect(session.selection.pages).toEqual(["p:main:0", "p:main:1", "p:main:3", "p:main:4"]);
    await click(pageButton(4));
    expect(session.selection.pages).toEqual(["p:main:0", "p:main:1", "p:main:4"]);
    await click(q(".pli-pdf-organise-select"));
    await click(pageButton(6));
    expect(session.selection.pages).toEqual(["p:main:5"]);
  });

  it("walks with the arrow keys (a row at a time with up and down) and extends with shift", async () => {
    const { session } = await open();
    pageButton(1).focus();
    await key(pageButton(1), "ArrowRight");
    expect(session.selection.page).toBe("p:main:1");
    await key(pageButton(2), "ArrowDown");
    expect(session.selection.page).toBe("p:main:5");
    await key(pageButton(6), "ArrowUp");
    expect(session.selection.page).toBe("p:main:1");
    await key(pageButton(2), "ArrowRight", { shiftKey: true });
    expect(session.selection.pages).toEqual(["p:main:1", "p:main:2"]);
    await key(pageButton(3), "End");
    expect(session.selection.page).toBe("p:main:5");
    await key(pageButton(6), "Home");
    expect(session.selection.page).toBe("p:main:0");
    expect(document.activeElement).toBe(pageButton(1));
  });

  it("turns, inserts after and deletes from the buttons of one thumbnail", async () => {
    const { session } = await open();
    await click(byLabel("Turn page 2 clockwise"));
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([0, 90, 0, 0, 0, 0]);
    await click(byLabel("Turn page 2 anticlockwise"));
    expect(session.doc.pages[1]!.rotate).toBe(0);
    await click(byLabel("Insert a blank page after page 1"));
    expect(session.doc.pages).toHaveLength(7);
    expect(session.doc.pages[1]!.from).toBeNull();
    await click(byLabel("Delete page 2"));
    expect(session.doc.pages).toHaveLength(6);
    expect(toast()).toContain("1 page deleted");
    await click(q(".pli-pdf-toast-action"));
    expect(session.doc.pages).toHaveLength(7);
  });

  it("works on every selected page when the thumbnail is one of them, and on just that page when it is not", async () => {
    const { session } = await open();
    await click(pageButton(1));
    await click(pageButton(3), { shiftKey: true });
    await click(byLabel("Turn page 2 clockwise"));
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([90, 90, 90, 0, 0, 0]);
    await click(byLabel("Turn page 5 clockwise"));
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([90, 90, 90, 0, 90, 0]);
  });

  it("drags pages to a new place with a drop line between the thumbnails", async () => {
    const { session } = await open();
    const cell = cells()[0]!;
    await fire(cell, dragEvent("dragstart"));
    expect(cell.hasAttribute("data-dragging")).toBe(true);
    await fire(body(), dragEvent("dragover", { clientX: cellX(3), clientY: cellY(0) }));
    const line = q(".pli-pdf-drop-line-v");
    expect(parseFloat(line.style.left)).toBeCloseTo(94 + 3 * 182 - 8);
    await fire(body(), dragEvent("drop", { clientX: cellX(3), clientY: cellY(0) }));
    await fire(cell, dragEvent("dragend"));
    expect(order(session)).toEqual(["1", "2", "0", "3", "4", "5"]);
    expect(await sessionWords(session)).toEqual(["Bravo", "Charlie", "Alpha", "Delta", "Echo", "Foxtrot"]);
    // the right half of a thumbnail means "after it", and the second row works too
    await fire(cells()[3]!, dragEvent("dragstart"));
    await fire(body(), dragEvent("drop", { clientX: cellX(0, 0.9), clientY: cellY(0) }));
    expect(order(session)).toEqual(["1", "3", "2", "0", "4", "5"]);
    await fire(cells()[1]!, dragEvent("dragstart"));
    await fire(body(), dragEvent("drop", { clientX: cellX(3), clientY: cellY(1) }));
    // past the last thumbnail of the second row is the end
    expect(order(session)).toEqual(["1", "2", "0", "4", "5", "3"]);
  });

  it("drags a selection of pages together", async () => {
    const { session } = await open();
    await click(pageButton(1));
    await click(pageButton(2), { shiftKey: true });
    await fire(cells()[1]!, dragEvent("dragstart"));
    await fire(body(), dragEvent("drop", { clientX: cellX(0, 0.9), clientY: cellY(1) }));
    // after page 5 (row 2, first column)
    expect(order(session)).toEqual(["2", "3", "4", "0", "1", "5"]);
  });

  it("adds a dropped PDF or picture at the drop position", async () => {
    const { session } = await open(4);
    const other = fileOf("more.pdf", pdfOf(["Xray"]));
    await fire(body(), dragEvent("dragover", { clientX: cellX(2), clientY: cellY(0), types: ["Files"] }));
    expect(document.querySelector(".pli-pdf-drop-line-v")).toBeTruthy();
    await fire(body(), dragEvent("drop", { clientX: cellX(2), clientY: cellY(0), types: ["Files"], files: [other] }));
    await flush();
    expect(await sessionWords(session)).toEqual(["Alpha", "Bravo", "Xray", "Charlie", "Delta"]);
  });

  it("moves selected pages with Alt+Arrow and deletes with the Delete key (after asking, for several)", async () => {
    const { session } = await open();
    await click(pageButton(3));
    await key(pageButton(3), "ArrowLeft", { altKey: true });
    expect(order(session)).toEqual(["0", "2", "1", "3", "4", "5"]);
    // down is a row (four pages) down: to the end here
    await key(pageButton(2), "ArrowDown", { altKey: true });
    expect(order(session)).toEqual(["0", "1", "3", "4", "5", "2"]);
    await click(pageButton(5));
    await click(pageButton(6), { shiftKey: true });
    await key(pageButton(6), "Delete");
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Delete 2 pages?");
    await click(dialogButton("Delete"));
    expect(order(session)).toEqual(["0", "1", "3", "4"]);
  });

  it("changes the size of the thumbnails with the slider", async () => {
    await open(3);
    const width = () => parseFloat(cells()[0]!.style.width);
    expect(width()).toBe(166);
    await setValue(byLabel("Thumbnail size") as HTMLInputElement, "250");
    expect(width()).toBe(266);
    expect(parseFloat(q(".pli-pdf-organise .pli-pdf-thumb-page").style.width)).toBeGreaterThan(150);
  });

  it("goes to a page when it is double clicked or Enter is pressed, closing the view", async () => {
    const { session } = await open();
    const cell = pageButton(4);
    await act(async () => cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(document.querySelector(".pli-pdf-organise")).toBeNull();
    expect(session.selection.page).toBe("p:main:3");
    await click(byLabel("Organise pages"));
    await key(pageButton(4), "ArrowRight");
    await key(pageButton(5), "Enter");
    expect(document.querySelector(".pli-pdf-organise")).toBeNull();
    expect(session.selection.page).toBe("p:main:4");
  });

  it("opens the page menu on right click, with the thumbnail selected", async () => {
    const { session } = await open();
    await fire(cells()[2]!, new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }));
    expect(session.selection.pages).toEqual(["p:main:2"]);
    expect(q(".pli-pdf-ctx")).toBeTruthy();
    // Escape closes the menu, not the view
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector(".pli-pdf-ctx")).toBeNull();
    expect(q(".pli-pdf-organise")).toBeTruthy();
  });

  it("is look-only in a read-only viewer", async () => {
    const session = await openWords(WORDS.slice(0, 3));
    await mountPdf(session, { readOnly: true });
    await click(byLabel("Organise pages"));
    expect(cells()).toHaveLength(3);
    expect(document.querySelector(".pli-pdf-cell-actions")).toBeNull();
    expect(cells()[0]!.getAttribute("draggable")).toBeNull();
    await fire(cells()[0]!, dragEvent("dragstart"));
    await fire(body(), dragEvent("drop", { clientX: cellX(2), clientY: cellY(0) }));
    expect(session.canUndo).toBe(false);
  });

  it("draws only the thumbnails near the view for a long document", async () => {
    const session = await openWords(Array.from({ length: 400 }, (_, i) => `P${i}`));
    await mountPdf(session);
    await click(byLabel("Organise pages"));
    expect(cells().length).toBeLessThan(60);
    expect(cells().length).toBeGreaterThan(4);
  });
});
