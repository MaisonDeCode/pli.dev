// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { ShareClient, Users, VersionHistory, memorySharingStore, memoryVersionStorage } from "@pli.dev/core";
import { PdfFile, makeSamplePdf, openPdf, textOf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor, flattenMenu, shortcutGroups, type PdfEditorProps, type PdfMenus } from "../src";
import { fakeRenderer } from "../src/testing";
import { byLabel, chooseMenu, click, fire, flush, key, menuButton, q, qa, render, run, setValue, useHost } from "./harness";
import { openWords, stubDialogs, viewport } from "./pagesSupport";

useHost();
stubDialogs();

const MENUS = ["File", "Edit", "View", "Insert", "Format", "Tools", "Help"];

async function mount(session: PdfSession, props: Partial<PdfEditorProps> = {}) {
  const downloads: { name: string; bytes: Uint8Array; mime: string }[] = [];
  const renderer = fakeRenderer({ pages: session.doc.pages.length });
  await render(<PdfEditor session={session} renderer={renderer} viewport={viewport} defaultZoom={1} annotations={{ storageKey: "" }} topToolbar onDownload={(bytes, name, mime) => void downloads.push({ name, bytes, mime })} {...props} />);
  await flush();
  return { downloads, renderer };
}

const labelsOf = (items: ReturnType<typeof qa>) => items.map((e) => e.querySelector(".pli-menu-label")?.textContent ?? e.textContent!);
const toolbar = () => q(".pli-pdf-toolbar");
const zoomLabel = () => q(".pli-pdf-zoom-label").textContent!.trim();

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
});

describe("the menu bar", () => {
  it("has File, Edit, View, Insert, Format, Tools and Help, as the other editors have, above the toolbar", async () => {
    await mount(await openWords());
    expect(qa(".pli-menubar-button").map((b) => b.textContent)).toEqual(MENUS);
    const bar = q(".pli-menubar");
    expect(bar.getAttribute("role")).toBe("menubar");
    // the title row, the menus and the toolbar, in that order
    const order = qa(".pli-pdf-titlebar, .pli-menubar, .pli-pdf-toolbar");
    expect(order.map((e) => e.className.split(" ")[0])).toEqual(["pli-titlebar", "pli-menubar", "pli-toolbar"]);
  });

  it("moves between menus with the arrow keys and closes on Escape, like the shared menu bar", async () => {
    await mount(await openWords());
    await click(menuButton("File"));
    expect(q(".pli-menubar-button[aria-expanded=true]").textContent).toBe("File");
    await key(q(".pli-menubar"), "ArrowRight");
    expect(q(".pli-menubar-button[aria-expanded=true]").textContent).toBe("Edit");
    await key(q(".pli-menubar"), "ArrowLeft");
    await key(q(".pli-menubar"), "ArrowLeft");
    expect(q(".pli-menubar-button[aria-expanded=true]").textContent).toBe("Help");
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector(".pli-menubar-button[aria-expanded=true]")).toBeNull();
  });

  it("lists in each menu what the tools and the pages offer", async () => {
    await mount(await openWords());
    const open = async (menu: string) => {
      await click(menuButton(menu));
      return labelsOf(qa("[role=menu] [role^=menuitem]", document));
    };
    expect(await open("File")).toEqual(["Save a copy", "Download", "Document properties…", "Print…"]);
    expect(await open("Edit")).toEqual(["Undo", "Redo", "Cut", "Copy", "Paste", "Duplicate", "Delete", "Select all annotations", "Find…", "Find and replace…"]);
    expect(await open("View")).toEqual(["Zoom in", "Zoom out", "Actual size", "Zoom", "Page layout", "Rotate view clockwise", "Go to", "Show sidebar", "Show properties panel", "Organise pages…", "Show links", "Full screen", "Theme"]);
    expect(await open("Insert")).toEqual(["Text box", "Image…", "Shape", "Drawing (pen)", "Signature", "Stamp", "Note", "Comment", "Link", "Mark up text", "Form field", "Blank page", "Pages from a file…"]);
    expect(await open("Format")).toEqual(["Text", "Align text", "Border width", "Arrange"]);
    expect(await open("Tools")).toEqual(["Redact", "Edit text and pictures", "Prepare form", "Form", "Organise pages…", "Find…", "Find and replace…", "Word count…"]);
    expect(await open("Help")).toEqual(["Keyboard shortcuts"]);
  });

  it("has no two entries with the same name in one menu, and no two with the same key", async () => {
    await mount(await openWords(), { onOpen: () => undefined, onSave: () => undefined, onShare: () => undefined });
    for (const menu of MENUS) {
      await click(menuButton(menu));
      // open every submenu too
      for (const entry of qa("[role=menu] [aria-haspopup=menu]", document)) await click(entry);
      const lists = qa("[role=menu]", document).map((m) => [...m.querySelectorAll(":scope > li > button")].map((b) => ({ label: b.querySelector(".pli-menu-label")!.textContent!, key: b.querySelector(".pli-menu-shortcut")?.textContent ?? "" })));
      for (const list of lists) {
        const names = list.map((e) => e.label);
        expect(new Set(names).size, `${menu}: ${names.join(", ")}`).toBe(names.length);
        const keys = list.map((e) => e.key).filter(Boolean);
        expect(new Set(keys).size, `${menu} keys: ${keys.join(", ")}`).toBe(keys.length);
      }
      await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    }
  });

  it("is stacked on a narrow editor: it wraps and its menus stay inside", async () => {
    await mount(await openWords(), { hostWidth: 360 });
    expect(q(".pli-pdf").getAttribute("data-size")).toBe("phone");
    expect(q(".pli-pdf-menubar")).not.toBeNull();
    expect(qa(".pli-menubar-button")).toHaveLength(7);
  });

  it("is left out with menu={false}: the name and a File menu are in the toolbar, as before", async () => {
    await mount(await openWords(), { menu: false, onSave: () => undefined });
    expect(document.querySelector(".pli-menubar")).toBeNull();
    expect(toolbar().querySelector(".pli-pdf-title")).not.toBeNull();
    await click(byLabel("File", toolbar()));
    expect(labelsOf(qa("[role=menu] [role^=menuitem]", document))).toContain("Print…");
  });

  it("takes the entries of the `menus` prop: added at the end of a menu, or placed and removed by a function", async () => {
    const calls: string[] = [];
    await mount(await openWords(), { menus: { Tools: [{ label: "My check", onSelect: () => void calls.push("mine") }] } });
    await chooseMenu("Tools", "My check");
    expect(calls).toEqual(["mine"]);
    await render(<div />);
    const renderer = fakeRenderer({ pages: 2 });
    const session = await openWords();
    await render(<PdfEditor session={session} renderer={renderer} viewport={viewport} menus={(base: PdfMenus) => ({ ...base, Help: [...(base.Help ?? []), { label: "Support" }], Edit: [] })} />);
    await flush();
    expect(menuButton("Edit")).toBeUndefined();
    await click(menuButton("Help"));
    expect(labelsOf(qa("[role=menu] [role^=menuitem]", document))).toEqual(["Keyboard shortcuts", "Support"]);
  });
});

describe("one list of commands for the toolbar and the menus", () => {
  it("gives a button and its menu entry the same name, key and enabled state", async () => {
    const session = await openWords();
    await mount(session, { onSave: () => undefined });
    const pairs: [string, string, string[]][] = [
      ["Undo", "Edit", ["Undo"]],
      ["Redo", "Edit", ["Redo"]],
      ["Print", "File", ["Print…"]],
      ["Zoom in", "View", ["Zoom in"]],
      ["Zoom out", "View", ["Zoom out"]],
      ["Find", "Edit", ["Find…"]],
    ];
    const check = async () => {
      for (const [button, menu, path] of pairs) {
        const b = byLabel(button, toolbar()) as HTMLButtonElement;
        await click(menuButton(menu));
        const item = qa("[role=menu] [role^=menuitem]", document).find((e) => e.textContent!.startsWith(path[0]!))! as HTMLButtonElement;
        const key = item.querySelector(".pli-menu-shortcut")?.textContent;
        expect(item.disabled, `${button} enabled state`).toBe(b.disabled);
        if (key) expect(b.title, `${button} tooltip`).toContain(key);
        await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      }
    };
    await check();
    await run(() => session.pages.rotate([session.doc.pages[0]!.id], 90));
    await check();
    expect((byLabel("Undo", toolbar()) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("undo, redo, print and the other buttons of the toolbar", () => {
  it("undoes and redoes, and is disabled when there is nothing to undo or redo", async () => {
    const session = await openWords();
    await mount(session);
    const undo = () => byLabel("Undo", toolbar()) as HTMLButtonElement;
    const redo = () => byLabel("Redo", toolbar()) as HTMLButtonElement;
    expect([undo().disabled, redo().disabled]).toEqual([true, true]);
    await run(() => session.pages.rotate([session.doc.pages[0]!.id], 90));
    expect([undo().disabled, redo().disabled]).toEqual([false, true]);
    await click(undo());
    expect(session.doc.pages[0]!.rotate).toBe(0);
    expect([undo().disabled, redo().disabled]).toEqual([true, false]);
    await click(redo());
    expect(session.doc.pages[0]!.rotate).toBe(90);
    // the menu does the same
    await chooseMenu("Edit", "Undo");
    expect(session.doc.pages[0]!.rotate).toBe(0);
    await chooseMenu("Edit", "Redo");
    expect(session.doc.pages[0]!.rotate).toBe(90);
  });

  it("has one Undo and one Redo, in the toolbar (the ribbon no longer repeats them)", async () => {
    await mount(await openWords());
    expect(qa("[aria-label='Undo']")).toHaveLength(1);
    expect(qa("[aria-label='Redo']")).toHaveLength(1);
    expect(byLabel("Undo")!.closest(".pli-pdf-toolbar")).not.toBeNull();
  });

  it("prints from the toolbar button and the menu", async () => {
    const prints: string[] = [];
    await mount(await openWords(), { onPrint: () => void prints.push("print") });
    await click(byLabel("Print", toolbar()));
    await chooseMenu("File", "Print…");
    expect(prints).toEqual(["print", "print"]);
  });

  it("zooms in, out and to a fit, with a dropdown and a button that offers the other fit", async () => {
    await mount(await openWords());
    expect(zoomLabel()).toBe("100%");
    await click(byLabel("Zoom in", toolbar()));
    expect(zoomLabel()).toBe("125%");
    await click(byLabel("Zoom out", toolbar()));
    await click(byLabel("Zoom out", toolbar()));
    expect(zoomLabel()).toBe("75%");
    await click(byLabel("Fit width", toolbar()));
    expect(byLabel("Fit page", toolbar())).not.toBeNull(); // now it offers the other
    await click(byLabel("Fit page", toolbar()));
    expect(byLabel("Fit width", toolbar())).not.toBeNull();
    await chooseMenu("View", "Actual size");
    expect(zoomLabel()).toBe("100%");
    await chooseMenu("View", "Zoom", "200%");
    expect(zoomLabel()).toBe("200%");
    await chooseMenu("View", "Zoom in");
    expect(zoomLabel()).toBe("300%");
  });

  it("changes the layout and turns the view from the View menu", async () => {
    await mount(await openWords());
    await chooseMenu("View", "Page layout", "Single page");
    expect(q(".pli-pdf").getAttribute("data-view-mode")).toBe("single");
    await chooseMenu("View", "Rotate view clockwise");
    expect(q(".pli-pdf-page").getAttribute("data-rotation")).toBe("90");
  });

  it("goes to a page from View > Go to", async () => {
    const session = await openWords();
    await mount(session);
    await chooseMenu("View", "Go to", "Last page");
    expect(session.selection.page).toBe(session.doc.pages.at(-1)!.id);
    await chooseMenu("View", "Go to", "Previous page");
    expect(session.selection.page).toBe(session.doc.pages.at(-2)!.id);
    await chooseMenu("View", "Go to", "First page");
    expect(session.selection.page).toBe(session.doc.pages[0]!.id);
  });

  it("folds the sidebar from the View menu and shows its state", async () => {
    await mount(await openWords());
    expect(document.querySelector(".pli-pdf-sidebar")).not.toBeNull();
    await chooseMenu("View", "Show sidebar");
    expect(document.querySelector(".pli-pdf-sidebar")).toBeNull();
    await click(menuButton("View"));
    const item = qa("[role=menu] [role^=menuitem]", document).find((e) => e.textContent!.startsWith("Show sidebar"))!;
    expect(item.getAttribute("aria-checked")).toBe("false");
  });
});

describe("full screen", () => {
  it("is offered where the browser has the Fullscreen API: it asks the editor to go full screen, and shows that it is", async () => {
    const asked: Element[] = [];
    (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen = function (this: Element) {
      asked.push(this);
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    (document as { exitFullscreen?: unknown }).exitFullscreen = () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    await mount(await openWords());
    expect((byLabel("Full screen", toolbar()) as HTMLButtonElement).disabled).toBe(false);
    await click(byLabel("Full screen", toolbar()));
    expect(asked).toEqual([q(".pli-pdf")]);
    expect(q(".pli-pdf").hasAttribute("data-fullscreen")).toBe(true);
    expect(byLabel("Exit full screen", toolbar())).not.toBeNull();
    await chooseMenu("View", "Exit full screen");
    expect(q(".pli-pdf").hasAttribute("data-fullscreen")).toBe(false);
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  it("is disabled, not missing, where the browser has none", async () => {
    await mount(await openWords());
    expect((byLabel("Full screen", toolbar()) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("theme", () => {
  it("is chosen in View > Theme: match the system, light or dark, and the host hears it", async () => {
    const heard: string[] = [];
    await mount(await openWords(), { onThemeChange: (t) => void heard.push(t) });
    expect(q(".pli-pdf").getAttribute("data-theme")).toBeNull();
    await chooseMenu("View", "Theme", "Dark");
    expect(q(".pli-pdf").getAttribute("data-theme")).toBe("dark");
    await chooseMenu("View", "Theme", "Light");
    expect(q(".pli-pdf").getAttribute("data-theme")).toBe("light");
    await chooseMenu("View", "Theme", "Match the system");
    expect(q(".pli-pdf").getAttribute("data-theme")).toBeNull();
    expect(heard).toEqual(["dark", "light", "auto"]);
  });

  it("starts as the theme prop says, shows it ticked, and follows a new prop", async () => {
    const session = await openWords();
    const renderer = fakeRenderer({ pages: 5 });
    await render(<PdfEditor session={session} renderer={renderer} viewport={viewport} theme="dark" />);
    await flush();
    expect(q(".pli-pdf").getAttribute("data-theme")).toBe("dark");
    await click(menuButton("View"));
    await click(qa("[role=menu] [role^=menuitem]", document).find((e) => e.textContent!.startsWith("Theme"))!);
    expect(labelsOf(qa("[role=menu] [aria-checked=true]", document)).filter((l) => ["Match the system", "Light", "Dark"].includes(l))).toEqual(["Dark"]);
    await render(<PdfEditor session={session} renderer={renderer} viewport={viewport} theme="light" />);
    await flush();
    expect(q(".pli-pdf").getAttribute("data-theme")).toBe("light");
  });
});

describe("the keyboard help", () => {
  it("opens from Help, from ? and from Ctrl+/, and lists every group of the shortcut registry", async () => {
    await mount(await openWords());
    const groups = () => qa("dialog[open] .pli-pdf-shortcut-group h3").map((h) => h.textContent);
    await chooseMenu("Help", "Keyboard shortcuts");
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Keyboard shortcuts");
    expect(groups()).toEqual(shortcutGroups().map((g) => g.group));
    expect(groups()).toEqual(["Viewer", "Pages and files", "Forms", "Annotations", "Edit text and pictures"]);
    // every row of every group is in the dialog
    const rows = qa("dialog[open] .pli-pdf-shortcut-group tbody tr").length;
    expect(rows).toBe(shortcutGroups().reduce((n, g) => n + g.rows.length, 0));
    expect(q("dialog[open]").textContent).toContain("Find and replace");
    await click(qa<HTMLButtonElement>("dialog[open] button").find((b) => b.textContent === "Close")!);
    expect(document.querySelector("dialog[open]")).toBeNull();
    await key(q(".pli-pdf-scroller"), "?", { shiftKey: true });
    expect(document.querySelector("dialog[open] .pli-pdf-shortcut-group")).not.toBeNull();
    await click(qa<HTMLButtonElement>("dialog[open] button").find((b) => b.textContent === "Close")!);
    await key(q(".pli-pdf-scroller"), "/", { ctrlKey: true });
    expect(document.querySelector("dialog[open] .pli-pdf-shortcut-group")).not.toBeNull();
  });

  it("does not open while typing a question mark in a field", async () => {
    await mount(await openWords());
    await click(byLabel("Find", toolbar()));
    await key(byLabel("Find", document)!.matches("input") ? byLabel("Find", document) : q(".pli-pdf-find-input"), "?", { shiftKey: true });
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("lists the keys of tools another part registered", async () => {
    const { registerShortcuts } = await import("../src");
    const off = registerShortcuts("Zebra tools", () => [{ keys: "Z", action: "Stripe it" }]);
    await mount(await openWords());
    await chooseMenu("Help", "Keyboard shortcuts");
    expect(qa("dialog[open] .pli-pdf-shortcut-group h3").map((h) => h.textContent)).toContain("Zebra tools");
    expect(q("dialog[open]").textContent).toContain("Stripe it");
    off();
  });
});

describe("document properties and word count", () => {
  it("shows what the file is and writes the title, author, subject and keywords as one step of undo", async () => {
    const session = await openPdf(await makeSamplePdf({ title: "Start title" }), { name: "sample.pdf" });
    await mount(session);
    await chooseMenu("File", "Document properties…");
    await flush();
    const dialog = q("dialog[open]");
    expect(q("input[aria-label=Title]", dialog).getAttribute("value") ?? (q("input[aria-label=Title]", dialog) as HTMLInputElement).value).toBe("Start title");
    const facts = q(".pli-pdf-facts", dialog).textContent!;
    expect(facts).toContain("Pages2");
    expect(facts).toContain("8.5 × 11 in");
    expect(facts).toContain("Letter");
    expect(facts).toContain("PDF version");
    expect(facts).toContain("Protected with a passwordNo");
    await setValue(q("input[aria-label=Title]", dialog) as HTMLInputElement, "New title");
    await setValue(q("input[aria-label=Author]", dialog) as HTMLInputElement, "A. Writer");
    await setValue(q("input[aria-label=Subject]", dialog) as HTMLInputElement, "A subject");
    await setValue(q("input[aria-label=Keywords]", dialog) as HTMLInputElement, "one, two");
    await click(qa<HTMLButtonElement>("dialog[open] button").find((b) => b.textContent === "Save")!);
    expect(session.doc.meta).toMatchObject({ title: "New title", author: "A. Writer", subject: "A subject", keywords: "one, two" });
    let saved!: Uint8Array;
    await act(async () => void (saved = await session.save()));
    const file = PdfFile.open(saved);
    const info = file.info()!;
    expect(textOf(file.dictGet(info, "Title") as never)).toBe("New title");
    expect(textOf(file.dictGet(info, "Author") as never)).toBe("A. Writer");
    expect(await run(() => session.undo())).toBe(true);
    expect(session.doc.meta).toMatchObject({ title: "Start title" });
    expect(session.doc.meta.author).toBeUndefined();
  });

  it("only shows the properties in a read-only editor", async () => {
    const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });
    await mount(session, { readOnly: true });
    await chooseMenu("File", "Document properties…");
    expect((q("input[aria-label=Title]", q("dialog[open]")) as HTMLInputElement).readOnly).toBe(true);
    expect(qa<HTMLButtonElement>("dialog[open] button").map((b) => b.textContent)).toEqual(["Close"]);
  });

  it("counts the words and characters of the pages", async () => {
    const session = await openWords(["Alpha", "Bravo Charlie", "Delta"]);
    await mount(session);
    await chooseMenu("Tools", "Word count…");
    await flush(12);
    const text = q("dialog[open]").textContent!;
    expect(text).toContain("Pages3");
    expect(text).toContain("Words4");
    expect(text).toContain("Characters (no spaces)" + String("AlphaBravoCharlieDelta".length));
  });
});

describe("downloads from the File menu", () => {
  it("offers the PDF, an optimised and a flattened PDF, the pages as pictures and the form data", async () => {
    const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });
    const { downloads } = await mount(session);
    await chooseMenu("File", "Download", "PDF document");
    await flush();
    expect(downloads.at(-1)).toMatchObject({ name: "sample.pdf", mime: "application/pdf" });
    expect(new TextDecoder("latin1").decode(downloads.at(-1)!.bytes.subarray(0, 5))).toBe("%PDF-");

    await chooseMenu("File", "Download", "Optimised PDF");
    await flush();
    expect(downloads.at(-1)!.name).toBe("sample-optimised.pdf");
    expect(PdfFile.open(downloads.at(-1)!.bytes).pageCount()).toBe(2);

    await chooseMenu("File", "Download", "Flattened PDF");
    await flush();
    expect(downloads.at(-1)!.name).toBe("sample-flattened.pdf");
    const flat = PdfFile.open(downloads.at(-1)!.bytes);
    // flattened: the form fields are drawn into the pages and gone as fields
    expect(flat.dictGet(flat.catalog(), "AcroForm")).toBeNull();

    await chooseMenu("File", "Download", "Form data");
    await flush();
    expect(downloads.at(-1)).toMatchObject({ name: "sample-data.json", mime: "application/json" });
    expect(Object.keys(JSON.parse(new TextDecoder().decode(downloads.at(-1)!.bytes)))).toContain("name");

    await chooseMenu("File", "Download", "Pages as pictures");
    expect(q("dialog[open] .pli-dialog-title").textContent).toBe("Export pages as pictures");
  });

  it("leaves out the form data entry when there is no form", async () => {
    await mount(await openWords());
    await click(menuButton("File"));
    await click(qa("[role=menu] [role^=menuitem]", document).find((e) => e.textContent!.startsWith("Download"))!);
    const item = qa("[role=menu] [role^=menuitem]", document).find((e) => e.textContent!.startsWith("Form data")) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
  });
});

describe("pages, from the Insert and View menus", () => {
  it("inserts a blank page after the one shown, and opens the organise view", async () => {
    const session = await openWords();
    await mount(session);
    await chooseMenu("Insert", "Blank page");
    expect(session.doc.pages).toHaveLength(6);
    expect(session.doc.pages[1]!.from).toBeNull();
    await chooseMenu("View", "Organise pages…");
    expect(document.querySelector(".pli-pdf-organise")).not.toBeNull();
  });

  it("disables the editing entries in a read-only editor", async () => {
    await mount(await openWords(), { readOnly: true });
    await click(menuButton("Insert"));
    const blank = qa("[role=menu] [role^=menuitem]", document).find((e) => e.textContent === "Blank page") as HTMLButtonElement | undefined;
    expect(blank?.disabled ?? true).toBe(true);
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    // no history to show in a viewer that cannot change
    expect(byLabel("Undo", toolbar())).toBeNull();
  });
});

describe("share, comments and who is here", () => {
  it("has a Share button only when the host gives onShare, and it calls it", async () => {
    await mount(await openWords());
    expect(document.querySelector(".pli-share-button")).toBeNull();
    const shares: string[] = [];
    await mount(await openWords(), { onShare: () => void shares.push("share"), actions: <button type="button" aria-label="My action">x</button> });
    await click(q(".pli-share-button"));
    expect(shares).toEqual(["share"]);
    expect(q(".pli-titlebar .pli-actions [aria-label='My action']")).not.toBeNull();
    // after the host's own controls, at the end of the row
    expect([...q(".pli-titlebar .pli-actions").children].map((e) => e.getAttribute("aria-label") ?? e.textContent)).toEqual(["My action", "Share"]);
  });

  it("opens the shared Share dialog when the host gives a ShareClient, and still calls onShare", async () => {
    const users = new Users({ current: { id: "ana", name: "Ana" }, role: "editor", search: () => [] });
    const store = memorySharingStore({ f: { owner: "ana", grants: [], link: { enabled: false, role: "viewer" } } });
    const client = new ShareClient({ file: "f", users, store, linkUrl: (f) => `https://example.test/${f}` });
    await client.ready;
    const calls: string[] = [];
    await mount(await openWords(), { shareClient: client, onShare: () => void calls.push("hook") });
    expect(q(".pli-titlebar .pli-share-button").getAttribute("title")).toBe("Share");
    await click(q(".pli-titlebar .pli-share-button"));
    expect(calls).toEqual(["hook"]);
    expect(q("dialog[open]").textContent).toContain("Share");
    expect(q("dialog[open] .pli-dialog-title, dialog[open] h2")).not.toBeNull();
  });

  it("shows a Version history tab and File entry for a VersionHistory, and nothing without one", async () => {
    await mount(await openWords());
    expect(document.querySelector("#pli-pdf-tab-history")).toBeNull();
    await render(<div />);
    const session = await openWords();
    const users = new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
    const history = new VersionHistory({ file: "f", session: session.core as never, storage: memoryVersionStorage<never>(), users, hash: () => "h", support: { restoreOps: () => [] } });
    await history.ready;
    await mount(session, { history: history as never });
    expect(q("#pli-pdf-tab-history").getAttribute("title")).toBe("History");
    await chooseMenu("File", "Version history");
    expect(q("#pli-pdf-tab-history").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".pli-versions")).not.toBeNull();
    await chooseMenu("File", "Version history");
    expect(document.querySelector(".pli-pdf-sidebar")).toBeNull();
  });

  it("has a Comments button that opens the Comments tab and counts what is open", async () => {
    const users = new Users({ id: "u1", name: "Ana Reyes" });
    const session = await openWords();
    await mount(session, { comments: true, users, user: { id: "u1", name: "Ana Reyes" }, defaultSidebar: null });
    expect(document.querySelector(".pli-pdf-sidebar")).toBeNull();
    const button = () => byLabel("Comments", q(".pli-titlebar"))!;
    expect(button().getAttribute("aria-pressed")).toBe("false");
    await click(button());
    expect(document.querySelector(".pli-pdf-sidebar")).not.toBeNull();
    expect(q("#pli-pdf-tab-comments").getAttribute("aria-selected")).toBe("true");
    expect(button().getAttribute("aria-pressed")).toBe("true");
    await run(() => void session.comments.addNote(session.doc.pages[0]!.id, 50, 50, "First"));
    await flush();
    expect(q(".pli-titlebar").textContent).toContain("Comments (1)");
    await click(byLabel("Comments (1)", q(".pli-titlebar"))!);
    expect(document.querySelector(".pli-pdf-sidebar")).toBeNull();
  });

  it("has no Comments button when comments are not turned on", async () => {
    await mount(await openWords());
    expect(q(".pli-titlebar").querySelector(".pli-pdf-comments-button")).toBeNull();
  });
});

describe("the name of the document", () => {
  it("is in the title row, and renames the document", async () => {
    const session = await openWords();
    await mount(session);
    expect(q(".pli-titlebar .pli-pdf-title")).not.toBeNull();
    await click(byLabel("Rename report.pdf")!);
    const input = q(".pli-pdf-title-input") as HTMLInputElement;
    await setValue(input, "Renamed.pdf");
    await key(input, "Enter");
    expect(session.doc.name).toBe("Renamed.pdf");
  });
});

describe("the flat list of a menu", () => {
  it("is what flattenMenu reads: entries with the submenus they are in", async () => {
    const menus: PdfMenus = { File: [{ label: "A", items: [{ label: "B", onSelect: () => undefined }, "separator", { label: "C", items: [{ label: "D" }] }] }, "separator", { label: "E" }] };
    expect(flattenMenu(menus.File!).map((e) => [...e.path, e.item.label].join(" > "))).toEqual(["A > B", "A > C > D", "E"]);
    void fire;
  });
});
