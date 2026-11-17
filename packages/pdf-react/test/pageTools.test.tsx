// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { PdfFile } from "@pli.dev/pdf";
import { byLabel, click, fire, flush, key, q, qa, setValue, useHost } from "./harness";
import { dragEvent, fileOf, mountPdf, openWords, pdfOf, sessionWords, stubChooser, stubDialogs, tick, wordsOf, WORDS } from "./pagesSupport";
import { Encryptor, buildClassic, obj, type Obj } from "../../pdf/test/support/handmade";
import { makePng } from "../../pdf/test/support/png";
import { readZip } from "../src";

useHost();
stubDialogs();

const thumbs = () => qa(".pli-pdf-thumb");
const order = (s: { doc: { pages: { id: string }[] } }) => s.doc.pages.map((p) => p.id.replace("p:main:", ""));
const list = () => q("[role=listbox]");
const toast = () => document.querySelector(".pli-pdf-toast")?.textContent ?? "";
const button = (label: string) => byLabel(label) as HTMLButtonElement;
const dialogButton = (text: string) => qa<HTMLButtonElement>("dialog[open] button").find((b) => b.textContent!.trim() === text)!;
const menuItem = (label: string) => qa("[role=menu] [role^='menuitem']").find((b) => b.textContent!.includes(label))!;
/** The list position (CSS pixels) a drop at the top of thumbnail `i` has. */
const topOf = (i: number) => parseFloat(thumbs().find((t) => t.dataset.index === String(i))!.style.top);

describe("selecting pages", () => {
  it("click, shift range, ctrl toggle and select all go to session.selection.pages", async () => {
    const session = await openWords(WORDS);
    await mountPdf(session);
    await click(thumbs()[1]);
    expect(session.selection.pages).toEqual(["p:main:1"]);
    await click(thumbs()[3], { shiftKey: true });
    expect(session.selection.pages).toEqual(["p:main:1", "p:main:2", "p:main:3"]);
    await click(thumbs()[5], { ctrlKey: true });
    expect(session.selection.pages).toEqual(["p:main:1", "p:main:2", "p:main:3", "p:main:5"]);
    await click(thumbs()[2], { metaKey: true });
    expect(session.selection.pages).toEqual(["p:main:1", "p:main:3", "p:main:5"]);
    expect(q(".pli-pdf-pagebar-count").textContent).toBe("3 selected");
    await key(list(), "a", { ctrlKey: true });
    expect(session.selection.pages).toHaveLength(6);
    expect(q(".pli-pdf-announce").textContent).toBe("All 6 pages selected");
  });
});

describe("rotate", () => {
  it("turns the selected pages from the toolbar and from the keyboard, and undo puts them back", async () => {
    const session = await openWords(WORDS.slice(0, 4));
    await mountPdf(session);
    await click(thumbs()[0]);
    await click(thumbs()[1], { shiftKey: true });
    await click(button("Turn pages clockwise"));
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([90, 90, 0, 0]);
    expect(q(".pli-pdf-announce").textContent).toBe("Turned 2 pages clockwise");
    await key(list(), "R", { ctrlKey: true, shiftKey: true });
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([180, 180, 0, 0]);
    await key(list(), "L", { ctrlKey: true, shiftKey: true });
    await key(list(), "L", { ctrlKey: true, shiftKey: true });
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([0, 0, 0, 0]);
    // undo and redo from the keyboard, with the focus in the viewer
    await key(list(), "z", { ctrlKey: true });
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([90, 90, 0, 0]);
    await key(list(), "z", { ctrlKey: true, shiftKey: true });
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([0, 0, 0, 0]);
    await key(list(), "y", { metaKey: true });
    expect(session.canRedo).toBe(false);
    // the plain letter does it too, in the list
    await key(list(), "r");
    expect(session.doc.pages.map((p) => p.rotate)).toEqual([90, 90, 0, 0]);
    // the saved file turns the pages
    const saved = await session.save();
    expect(PdfFile.open(saved).pages().map((p) => p.rotate)).toEqual([90, 90, 0, 0]);
  });

  it("does not take Ctrl+Z away from a text field", async () => {
    const session = await openWords(WORDS.slice(0, 3));
    await mountPdf(session);
    await click(button("Turn pages clockwise"));
    expect(session.canUndo).toBe(true);
    const input = byLabel("Page number") as HTMLInputElement;
    await key(input, "z", { ctrlKey: true });
    expect(session.doc.pages[0]!.rotate).toBe(90);
  });
});

describe("delete", () => {
  it("deletes one plain page at once and offers Undo in a toast", async () => {
    const session = await openWords(WORDS.slice(0, 4));
    await mountPdf(session);
    await click(thumbs()[1]);
    await click(button("Delete pages"));
    expect(order(session)).toEqual(["0", "2", "3"]);
    expect(toast()).toContain("1 page deleted");
    expect(q(".pli-pdf-announce").textContent).toBe("1 page deleted");
    await click(q(".pli-pdf-toast-action"));
    expect(order(session)).toEqual(["0", "1", "2", "3"]);
    expect(document.querySelector(".pli-pdf-toast")).toBeNull();
  });

  it("asks before deleting several pages, and Cancel keeps them", async () => {
    const session = await openWords(WORDS.slice(0, 5));
    await mountPdf(session);
    await click(thumbs()[1]);
    await click(thumbs()[2], { shiftKey: true });
    await click(button("Delete pages"));
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Delete 2 pages?");
    expect(order(session)).toHaveLength(5);
    await click(dialogButton("Cancel"));
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(order(session)).toHaveLength(5);
    await click(button("Delete pages"));
    await click(dialogButton("Delete"));
    expect(order(session)).toEqual(["0", "3", "4"]);
    expect(toast()).toContain("2 pages deleted");
    await click(q(".pli-pdf-toast-action"));
    expect(order(session)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("asks when the page carries annotations, and says how many go with it", async () => {
    const session = await openWords(WORDS.slice(0, 3));
    session.annots.add("p:main:1", { type: "square", rect: { x: 10, y: 10, w: 50, h: 50 }, stroke: { color: "#ff0000", width: 2 } });
    await mountPdf(session);
    await click(thumbs()[1]);
    await key(list(), "Delete");
    expect(q("dialog[open] .pli-dialog-note").textContent).toContain("1 annotation or form field");
    await click(dialogButton("Delete"));
    expect(order(session)).toEqual(["0", "2"]);
  });

  it("keeps the last page", async () => {
    const session = await openWords(WORDS.slice(0, 2));
    await mountPdf(session);
    await key(list(), "a", { ctrlKey: true });
    expect((button("Delete pages")).disabled).toBe(true);
    await key(list(), "Delete");
    expect(toast()).toContain("at least one page");
    expect(order(session)).toHaveLength(2);
  });
});

describe("duplicate and insert blank", () => {
  it("duplicates the selected pages after the last of them", async () => {
    const session = await openWords(WORDS.slice(0, 4));
    await mountPdf(session);
    await click(thumbs()[0]);
    await click(thumbs()[1], { shiftKey: true });
    await click(button("Duplicate pages"));
    expect(session.doc.pages).toHaveLength(6);
    expect(await sessionWords(session)).toEqual(["Alpha", "Bravo", "Alpha", "Bravo", "Charlie", "Delta"]);
    expect(q(".pli-pdf-announce").textContent).toContain("Duplicated 2 pages");
  });

  it("inserts a blank page before and after, the size of the neighbour", async () => {
    const session = await openWords(WORDS.slice(0, 3), "sizes.pdf", [{}, { width: 300, height: 400 }, {}]);
    await mountPdf(session);
    await click(thumbs()[1]);
    await click(button("Insert a blank page after"));
    expect(session.doc.pages).toHaveLength(4);
    expect(session.doc.pages[2]).toMatchObject({ from: null, width: 300, height: 400 });
    // before the first page: the size of the page that follows
    await click(thumbs()[0]);
    await key(list(), "ContextMenu");
    await click(menuItem("Insert blank page before"));
    expect(session.doc.pages[0]).toMatchObject({ from: null, width: 612, height: 792 });
    expect(session.doc.pages).toHaveLength(5);
    expect(await sessionWords(session)).toEqual(["", "Alpha", "Bravo", "", "Charlie"]);
  });
});

describe("moving pages", () => {
  const mount = async (n = 6) => {
    const session = await openWords(WORDS.slice(0, n));
    await mountPdf(session);
    return session;
  };

  it("drags one page to a new place and shows the drop line", async () => {
    const session = await mount();
    await fire(thumbs()[0], dragEvent("dragstart"));
    await fire(list(), dragEvent("dragover", { clientY: topOf(3) }));
    const line = q(".pli-pdf-drop-line");
    expect(parseFloat(line.style.top)).toBeCloseTo(topOf(3) - 3);
    await fire(list(), dragEvent("drop", { clientY: topOf(3) }));
    await fire(thumbs()[0], dragEvent("dragend"));
    expect(order(session)).toEqual(["1", "2", "0", "3", "4", "5"]);
    expect(document.querySelector(".pli-pdf-drop-line")).toBeNull();
    expect(await sessionWords(session)).toEqual(["Bravo", "Charlie", "Alpha", "Delta", "Echo", "Foxtrot"]);
  });

  it("drags several selected pages together, keeping their order, and to the very end", async () => {
    const session = await mount();
    await click(thumbs()[0]);
    await click(thumbs()[1], { shiftKey: true });
    await fire(thumbs()[1], dragEvent("dragstart"));
    await fire(list(), dragEvent("drop", { clientY: topOf(4) }));
    expect(order(session)).toEqual(["2", "3", "0", "1", "4", "5"]);
    // everything below the last page is "the end"
    await click(thumbs()[0]);
    await fire(thumbs()[0], dragEvent("dragstart"));
    await fire(list(), dragEvent("drop", { clientY: 100000 }));
    expect(order(session)).toEqual(["3", "0", "1", "4", "5", "2"]);
  });

  it("dragging a page that is not selected selects just that page", async () => {
    const session = await mount();
    await click(thumbs()[0]);
    await click(thumbs()[1], { shiftKey: true });
    await fire(thumbs()[4], dragEvent("dragstart"));
    expect(session.selection.pages).toEqual(["p:main:4"]);
    await fire(list(), dragEvent("drop", { clientY: 0 }));
    expect(order(session)).toEqual(["4", "0", "1", "2", "3", "5"]);
  });

  it("dropping a page where it is changes nothing", async () => {
    const session = await mount();
    await fire(thumbs()[2], dragEvent("dragstart"));
    await fire(list(), dragEvent("drop", { clientY: topOf(3) }));
    expect(order(session)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(session.canUndo).toBe(false);
  });

  it("moves the selected pages with Alt+Arrow, Alt+Home and Alt+End, and says where they went", async () => {
    const session = await mount();
    await click(thumbs()[2]);
    await key(list(), "ArrowUp", { altKey: true });
    expect(order(session)).toEqual(["0", "2", "1", "3", "4", "5"]);
    expect(q(".pli-pdf-announce").textContent).toBe("Moved 1 page to position 2");
    await key(list(), "ArrowDown", { altKey: true });
    await key(list(), "ArrowDown", { altKey: true });
    expect(order(session)).toEqual(["0", "1", "3", "2", "4", "5"]);
    await key(list(), "End", { altKey: true });
    expect(order(session)).toEqual(["0", "1", "3", "4", "5", "2"]);
    await key(list(), "Home", { altKey: true });
    expect(order(session)).toEqual(["2", "0", "1", "3", "4", "5"]);
    await key(list(), "Home", { altKey: true });
    expect(session.doc.pages[0]!.id).toBe("p:main:2");
  });

  it("moves a block of pages with Alt+Arrow and gathers a scattered selection", async () => {
    const session = await mount();
    await click(thumbs()[1]);
    await click(thumbs()[3], { ctrlKey: true });
    await key(list(), "ArrowDown", { altKey: true });
    // the pages meet at the place one down from the first
    expect(order(session)).toEqual(["0", "2", "1", "3", "4", "5"]);
    const before = order(session).join();
    await key(list(), "ArrowDown", { altKey: true });
    expect(order(session).join()).not.toBe(before);
  });

  it("moves to a chosen page from the menu (the way without a mouse or a finger)", async () => {
    const session = await mount();
    await click(thumbs()[0]);
    await key(list(), "ContextMenu");
    await click(menuItem("Move 1 page to…"));
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Move 1 page");
    await setValue(byLabel("Move before page") as HTMLInputElement, "4");
    await click(dialogButton("Move"));
    expect(order(session)).toEqual(["1", "2", "0", "3", "4", "5"]);
    // 7 is the end
    await click(thumbs()[0]);
    await key(list(), "ContextMenu");
    await click(menuItem("Move 1 page to…"));
    await setValue(byLabel("Move before page") as HTMLInputElement, "7");
    await click(dialogButton("Move"));
    expect(order(session)).toEqual(["2", "0", "3", "4", "5", "1"]);
  });
});

describe("the page menu", () => {
  it("opens on right click with the pages selected, closes on Escape, and takes an unselected page into the selection", async () => {
    const session = await openWords(WORDS.slice(0, 4));
    await mountPdf(session);
    await click(thumbs()[0]);
    await fire(thumbs()[2], new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
    expect(session.selection.pages).toEqual(["p:main:2"]);
    const menu = q(".pli-pdf-ctx");
    expect(menu.querySelector("[role=menu]")!.getAttribute("aria-label")).toBe("Page menu");
    expect(menu.style.left).toBe("30px");
    expect(qa("[role=menu] [role^='menuitem']").map((i) => i.textContent!.replace(/\s+/g, " ")).slice(0, 2)).toEqual(["Turn clockwise⌘Shift+R".replace("⌘", /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"), "Turn anticlockwise" + (/Mac/.test(navigator.platform) ? "⌘" : "Ctrl+") + "Shift+L"]);
    await key(document.activeElement ?? document.body, "Escape");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector(".pli-pdf-ctx")).toBeNull();
  });

  it("is smaller in a read-only viewer: no editing, but pages can still be extracted", async () => {
    const session = await openWords(WORDS.slice(0, 3));
    const { downloads } = await mountPdf(session, { readOnly: true });
    expect(document.querySelector("[aria-label='Turn pages clockwise']")).toBeNull();
    expect(thumbs()[0]!.getAttribute("draggable")).toBeNull();
    await key(list(), "Delete");
    await key(list(), "r");
    expect(session.canUndo).toBe(false);
    await key(list(), "ContextMenu");
    expect(qa("[role=menu] [role^='menuitem']").map((i) => i.textContent)).toEqual(["Extract page…", "Split document…", "Select all pages"]);
    await click(menuItem("Extract page"));
    await click(dialogButton("Extract"));
    await flush();
    expect(downloads).toHaveLength(1);
    expect(wordsOf(downloads[0]!.bytes)).toEqual(["Alpha"]);
  });
});

describe("pages from files", () => {
  it("drops a PDF between pages: its pages go there", async () => {
    const session = await openWords(WORDS.slice(0, 3));
    await mountPdf(session);
    const other = fileOf("more.pdf", pdfOf(["Xray", "Yankee"]));
    await fire(list(), dragEvent("dragover", { clientY: topOf(1), types: ["Files"] }));
    expect(document.querySelector(".pli-pdf-drop-line")).toBeTruthy();
    await fire(list(), dragEvent("drop", { clientY: topOf(1), types: ["Files"], files: [other] }));
    await flush();
    expect(session.doc.pages).toHaveLength(5);
    expect(await sessionWords(session)).toEqual(["Alpha", "Xray", "Yankee", "Bravo", "Charlie"]);
    expect(toast()).toContain("Added 2 pages");
    await click(q(".pli-pdf-toast-action"));
    expect(session.doc.pages).toHaveLength(3);
  });

  it("makes pages of dropped pictures and says when a file is neither", async () => {
    const session = await openWords(WORDS.slice(0, 2));
    await mountPdf(session);
    const png = makePng({ width: 8, height: 6, colorType: 2, depth: 8, sample: () => [200, 30, 30] });
    await fire(list(), dragEvent("drop", { clientY: topOf(1), types: ["Files"], files: [fileOf("a.png", png, "image/png"), fileOf("b.png", png, "image/png")] }));
    await flush();
    expect(session.doc.pages).toHaveLength(4);
    expect(session.doc.pages.map((p) => p.from === null)).toEqual([false, false, false, false]);
    expect(session.doc.pages[1]!.width).toBeGreaterThan(session.doc.pages[1]!.height);
    expect(toast()).toContain("Added 2 pages");
    const bad = fileOf("notes.txt", new TextEncoder().encode("hello"), "text/plain");
    await fire(list(), dragEvent("drop", { clientY: 100000, types: ["Files"], files: [bad] }));
    await flush();
    expect(toast()).toContain("notes.txt is not a PDF, JPEG or PNG file.");
    expect(session.doc.pages).toHaveLength(4);
  });

  it("asks for the password of a protected file, and tries again when it is wrong", async () => {
    const enc = new Encryptor("aes-128", { userPassword: "open sesame" }, 20);
    const objs: Obj[] = [
      obj(1, "<< /Type /Catalog /Pages 2 0 R >>"),
      obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>"),
      enc.stream(4, "", "BT /F1 12 Tf 72 300 Td (Locked) Tj ET"),
      enc.encryptObj,
    ];
    const locked = buildClassic(objs, { trailerExtra: enc.trailerExtra }).bytes;
    const session = await openWords(WORDS.slice(0, 2));
    await mountPdf(session);
    await fire(list(), dragEvent("drop", { clientY: 0, types: ["Files"], files: [fileOf("secret.pdf", locked)] }));
    await tick();
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Password needed");
    expect(q("dialog[open] .pli-dialog-note").textContent).toContain("secret.pdf");
    expect((dialogButton("Add pages")).disabled).toBe(true);
    await setValue(byLabel("Password") as HTMLInputElement, "nope");
    await click(dialogButton("Add pages"));
    await tick();
    expect(q("dialog[open] [role=alert]").textContent).toBe("That password did not work.");
    await setValue(byLabel("Password") as HTMLInputElement, "open sesame");
    await click(dialogButton("Add pages"));
    await tick(20);
    expect(session.doc.pages).toHaveLength(3);
    expect(session.doc.pages[0]!.width).toBe(300);
  });

  it("skips a protected file when the person says so", async () => {
    const enc = new Encryptor("rc4-128", { userPassword: "pw" }, 20);
    const locked = buildClassic(
      [obj(1, "<< /Type /Catalog /Pages 2 0 R >>"), obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"), obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>"), enc.encryptObj],
      { trailerExtra: enc.trailerExtra },
    ).bytes;
    const session = await openWords(WORDS.slice(0, 2));
    await mountPdf(session);
    await fire(list(), dragEvent("drop", { clientY: 0, types: ["Files"], files: [fileOf("secret.pdf", locked)] }));
    await tick();
    await click(dialogButton("Skip this file"));
    await tick();
    expect(session.doc.pages).toHaveLength(2);
    expect(toast()).toContain("secret.pdf needs a password and was skipped.");
  });

  it("inserts from a file chosen in the menu, after the selected pages", async () => {
    const session = await openWords(WORDS.slice(0, 3));
    await mountPdf(session);
    await click(thumbs()[0]);
    const chooser = stubChooser([fileOf("add.pdf", pdfOf(["Xray"]))]);
    await key(list(), "ContextMenu");
    await click(menuItem("Insert pages from file"));
    await tick(10);
    chooser.restore();
    expect(chooser.accepted[0]).toContain("application/pdf");
    expect(await sessionWords(session)).toEqual(["Alpha", "Xray", "Bravo", "Charlie"]);
  });
});

describe("extract and split", () => {
  it("extracts the selected pages into a new file the engine can open", async () => {
    const session = await openWords(WORDS);
    const { downloads } = await mountPdf(session);
    await click(thumbs()[1]);
    await click(thumbs()[2], { shiftKey: true });
    await click(thumbs()[4], { ctrlKey: true });
    await key(list(), "ContextMenu");
    await click(menuItem("Extract 3 pages"));
    expect((byLabel("Pages to extract") as HTMLInputElement).value).toBe("2-3, 5");
    await click(dialogButton("Extract"));
    await flush();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("report-pages-2-3_5.pdf");
    expect(downloads[0]!.mime).toBe("application/pdf");
    expect(wordsOf(downloads[0]!.bytes)).toEqual(["Bravo", "Charlie", "Echo"]);
    expect(session.doc.pages).toHaveLength(6);
  });

  it("takes a range typed in the dialog, reports a bad one, and can delete the pages afterwards", async () => {
    const session = await openWords(WORDS);
    const { downloads } = await mountPdf(session);
    await key(list(), "ContextMenu");
    await click(menuItem("Extract page"));
    await setValue(byLabel("Pages to extract") as HTMLInputElement, "9");
    expect(q("dialog[open] [role=alert]").textContent).toBe("The document has no page 9.");
    expect(dialogButton("Extract").disabled).toBe(true);
    await setValue(byLabel("Pages to extract") as HTMLInputElement, "1-2");
    await click(q("dialog[open] input[type=checkbox]"));
    await click(dialogButton("Extract"));
    await flush();
    expect(wordsOf(downloads[0]!.bytes)).toEqual(["Alpha", "Bravo"]);
    expect(await sessionWords(session)).toEqual(["Charlie", "Delta", "Echo", "Foxtrot"]);
  });

  it("splits into parts: shows the plan and downloads one ZIP of files that open", async () => {
    const session = await openWords(WORDS);
    const { downloads } = await mountPdf(session);
    await key(list(), "ContextMenu");
    await click(menuItem("Split document"));
    await setValue(byLabel("Pages in each file") as HTMLInputElement, "4");
    expect(q("dialog[open] .pli-dialog-note[aria-live]").textContent).toBe("2 files: 1. pages 1-4; 2. pages 5-6");
    await click(dialogButton("Split into 2 files"));
    await flush(10);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe("report-split.zip");
    const files = readZip(downloads[0]!.bytes);
    expect(files.map((f) => f.name)).toEqual(["report-part-1.pdf", "report-part-2.pdf"]);
    expect(files.map((f) => wordsOf(f.data))).toEqual([["Alpha", "Bravo", "Charlie", "Delta"], ["Echo", "Foxtrot"]]);
  });

  it("splits by ranges as separate downloads when the ZIP is turned off, and by bookmarks", async () => {
    const session = await openWords(WORDS, "book.pdf", [], [
      { title: "One", page: 0 },
      { title: "Two", page: 2 },
      { title: "Three", page: 5 },
    ]);
    const { downloads } = await mountPdf(session);
    await key(list(), "ContextMenu");
    await click(menuItem("Split document"));
    await click(qa("dialog[open] input[type=radio]")[1]!);
    await setValue(byLabel("Page ranges") as HTMLInputElement, "1-2, 4");
    expect(q("dialog[open] .pli-dialog-note[aria-live]").textContent).toBe("2 files: 1. pages 1-2; 2. pages 4");
    await click(q("dialog[open] input[type=checkbox]"));
    await click(dialogButton("Split into 2 files"));
    await tick(400);
    expect(downloads.map((d) => d.name)).toEqual(["book-part-1.pdf", "book-part-2.pdf"]);
    expect(wordsOf(downloads[1]!.bytes)).toEqual(["Delta"]);
    downloads.length = 0;
    await key(list(), "ContextMenu");
    await click(menuItem("Split document"));
    await click(qa("dialog[open] input[type=radio]")[2]!);
    expect(q("dialog[open] .pli-dialog-note[aria-live]").textContent).toBe("3 files: 1. pages 1-2; 2. pages 3-5; 3. pages 6");
    await setValue(byLabel("Page ranges") as HTMLInputElement, "x");
    await click(qa("dialog[open] input[type=radio]")[1]!);
    await setValue(byLabel("Page ranges") as HTMLInputElement, "40");
    expect(q("dialog[open] [role=alert]").textContent).toBe("The document has no page 40.");
  });
});

describe("page labels", () => {
  it("numbers the selected pages in a style, with a start and a prefix, and clears them", async () => {
    const session = await openWords(WORDS.slice(0, 4));
    await mountPdf(session);
    await click(thumbs()[0]);
    await click(thumbs()[1], { shiftKey: true });
    await key(list(), "ContextMenu");
    await click(menuItem("Page labels"));
    const select = byLabel("Numbering") as HTMLSelectElement;
    await act(async () => {
      select.value = "roman";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(dialogButton("Apply"));
    expect(session.doc.pages.map((p) => p.label)).toEqual(["i", "ii", undefined, undefined]);
    expect(thumbs().map((t) => t.querySelector(".pli-pdf-thumb-label")!.textContent)).toEqual(["i", "ii", "3", "4"]);
    // all pages, starting at 3, with a prefix
    await key(list(), "ContextMenu");
    await click(menuItem("Page labels"));
    const scope = byLabel("Apply to") as HTMLSelectElement;
    await act(async () => {
      scope.value = "all";
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await setValue(byLabel("Start at") as HTMLInputElement, "3");
    await setValue(byLabel("Prefix") as HTMLInputElement, "A-");
    await click(dialogButton("Apply"));
    expect(session.doc.pages.map((p) => p.label)).toEqual(["A-3", "A-4", "A-5", "A-6"]);
    // and a clean slate
    await key(list(), "ContextMenu");
    await click(menuItem("Page labels"));
    const style = byLabel("Numbering") as HTMLSelectElement;
    await act(async () => {
      style.value = "none";
      style.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const sc = byLabel("Apply to") as HTMLSelectElement;
    await act(async () => {
      sc.value = "all";
      sc.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(dialogButton("Apply"));
    expect(session.doc.pages.every((p) => p.label === undefined)).toBe(true);
  });
});
