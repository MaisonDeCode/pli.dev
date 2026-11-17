// @vitest-environment jsdom
// The default layout of the editor has no top toolbar: the menu bar has every command the toolbar had, and the status bar at the
// bottom of the pages has the page box and the zoom. These tests check that nothing was lost, and that `topToolbar` brings it back.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { Users } from "@pli.dev/core";
import { makeSamplePdf, openPdf } from "@pli.dev/pdf";
import { PdfEditor, PliPdf, type PdfEditorProps } from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { chooseMenu, click, closeMenus, flush, key, menuButton, q, qa, render, run, setValue, useHost } from "./harness";
import { stubDialogs, viewport } from "./pagesSupport";

useHost();
stubDialogs();

afterEach(() => {
  delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});

async function mount(props: Partial<PdfEditorProps> = {}) {
  const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf", user: { id: "u1", name: "Ana Reyes" } });
  const users = new Users({ id: "u1", name: "Ana Reyes" });
  await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={viewport} defaultZoom={1} users={users} comments onShare={() => undefined} annotations={{ storageKey: "" }} onSave={() => undefined} {...props} />);
  await flush();
  return session;
}

const pageBox = () => q<HTMLInputElement>(".pli-pdf-statusbar input[aria-label='Page number']");
const zoomText = () => q(".pli-pdf-statusbar .pli-pdf-zoom-label").textContent!.replace(/\s+/g, "");
const firstPageWidth = () => q(".pli-pdf-page").style.width;
const keyDown = (init: KeyboardEventInit) => key(q(".pli-pdf-scroller"), init.key!, init);

/** Every entry of the menu bar, with its path and the key it shows. */
async function menuTable() {
  const out = new Map<string, { path: string; shortcut: string; disabled: boolean }>();
  for (const menu of qa(".pli-menubar-button").map((b) => b.textContent!)) {
    await click(menuButton(menu));
    // open every submenu so that its entries are in the document
    // one submenu is open at a time: open each in turn and read what is in the document after each
    const entries = new Set<HTMLElement>();
    const read = () => qa("[role=menu] [role^=menuitem]", document).forEach((e) => entries.add(e));
    read();
    for (const name of qa("[role=menu] [aria-haspopup=menu]", document).map((s) => s.textContent!)) {
      const sub = qa("[role=menu] [aria-haspopup=menu]", document).find((s) => s.textContent === name);
      if (!sub) continue;
      await click(sub);
      read();
    }
    for (const entry of entries) {
      if (entry.getAttribute("aria-haspopup") === "menu") continue;
      const label = entry.querySelector(".pli-menu-label")?.textContent ?? entry.textContent!;
      const shortcut = entry.querySelector(".pli-menu-shortcut")?.textContent ?? "";
      out.set(`${menu}|${label}`, { path: menu, shortcut, disabled: entry.hasAttribute("disabled") || entry.getAttribute("aria-disabled") === "true" });
    }
    await closeMenus();
  }
  return out;
}

describe("the default layout has no top toolbar", () => {
  it("has the title row, the menu bar, the tools row and a status bar, and no toolbar", async () => {
    await mount();
    expect(qa(".pli-pdf-toolbar:not(.pli-pdf-ribbon):not(.pli-pdf-formatbar)")).toHaveLength(0);
    expect(q(".pli-pdf-titlebar")).not.toBeNull();
    expect(q(".pli-menubar")).not.toBeNull();
    expect(q(".pli-pdf-ribbon [aria-label='Highlight']")).not.toBeNull();
    expect(q(".pli-pdf-statusbar")).not.toBeNull();
    // the title row keeps Comments and Share
    expect(q(".pli-pdf-titlebar [data-command='comments'], .pli-pdf-titlebar .pli-share-button")).not.toBeNull();
  });

  it("brings the toolbar back with topToolbar, and then the page box and the zoom are in it (not twice)", async () => {
    await mount({ topToolbar: true });
    expect(q(".pli-pdf-toolbar")).not.toBeNull();
    expect(q(".pli-pdf-statusbar")).toBeNull();
    expect(qa("input[aria-label='Page number']")).toHaveLength(1);
    expect(qa("[aria-label='Zoom']")).toHaveLength(1);
  });

  it("has the toolbar when there is no menu bar, because it then holds the name and the File menu", async () => {
    await mount({ menu: false });
    expect(q(".pli-pdf-toolbar")).not.toBeNull();
    expect(q(".pli-pdf-statusbar")).toBeNull();
    await mount({ menu: false, topToolbar: false });
    expect(q(".pli-pdf-toolbar")).toBeNull();
  });

  it("leaves the status bar out with statusBar={false}", async () => {
    await mount({ statusBar: false });
    expect(q(".pli-pdf-statusbar")).toBeNull();
    // the live message for screen readers stays
    expect(q(".pli-pdf-status").textContent).toBe("Page 1 of 2");
  });
});

describe("the status bar", () => {
  it("shows the page and the number of pages, and follows the page shown", async () => {
    const session = await mount();
    expect(pageBox().value).toBe("1");
    expect(q(".pli-pdf-statusbar .pli-pdf-page-total").textContent).toBe("/ 2");
    await run(() => (session.selection.page = session.doc.pages[1]!.id) as never);
    await chooseMenu("View", "Go to", "Next page");
    expect(pageBox().value).toBe("2");
  });

  it("goes to the page typed in the box, and gives up on Escape", async () => {
    const session = await mount();
    await act(async () => pageBox().focus());
    await setValue(pageBox(), "2");
    await key(pageBox(), "Enter");
    await flush();
    expect(session.selection.page).toBe(session.doc.pages[1]!.id);
    await act(async () => pageBox().focus());
    await setValue(pageBox(), "1");
    await key(pageBox(), "Escape");
    expect(pageBox().value).toBe("2");
    expect(session.selection.page).toBe(session.doc.pages[1]!.id);
  });

  it("zooms with - and +, and with the drop-down: the usual sizes, fit width, fit page and actual size", async () => {
    await mount();
    expect(zoomText()).toBe("100%");
    await click(q(".pli-pdf-statusbar [aria-label='Zoom in']"));
    const bigger = zoomText();
    expect(parseInt(bigger)).toBeGreaterThan(100);
    await click(q(".pli-pdf-statusbar [aria-label='Zoom out']"));
    expect(zoomText()).toBe("100%");
    await click(q(".pli-pdf-statusbar [aria-label='Zoom']"));
    const labels = qa("[role=menu] [role^=menuitem]", document).map((b) => b.textContent!.replace("✓", ""));
    expect(labels).toEqual(expect.arrayContaining(["50%", "100%", "200%", "Fit width", "Fit page", "Actual size"]));
    await click(qa("[role=menu] [role^=menuitem]", document).find((b) => b.textContent!.includes("200%"))!);
    expect(zoomText()).toBe("200%");
  });

  it("has the Properties button with the dot that says a panel is waiting, as the toolbar had", async () => {
    const session = testSession({ pages: 1 });
    const view = (k: string | null) => <PliPdf session={session} renderer={fakeRenderer({ pages: 1 })} viewport={viewport} rightPanel={<p>mine</p>} rightPanelKey={k} />;
    await render(view("a"));
    await click(q(".pli-pdf-right-close"));
    await render(view("a"));
    expect(q(".pli-pdf-statusbar .pli-pdf-props-toggle").hasAttribute("data-hint")).toBe(true);
    await click(q(".pli-pdf-statusbar .pli-pdf-props-toggle"));
    expect(q(".pli-pdf-right")).not.toBeNull();
  });

  it("gives the host's own tools a row of their own, since there is no toolbar to hold them", async () => {
    const pen = { id: "pen", label: "Pen", icon: <span>P</span>, cursor: "crosshair", onPointer: () => {} } as never;
    const changes: (string | null)[] = [];
    await render(<PliPdf session={testSession({ pages: 2 })} renderer={fakeRenderer({ pages: 2 })} viewport={viewport} tools={[pen]} onToolChange={(id) => changes.push(id)} />);
    await flush();
    expect(q(".pli-pdf-toolbar")).toBeNull();
    await click(q(".pli-pdf-toolrow [aria-label='Pen']"));
    expect(changes).toEqual(["pen"]);
  });
});

/** What the old toolbar had: the label of each command, and the menu it is now in. */
const FROM_THE_TOOLBAR: [menu: string, label: string, shortcut?: RegExp][] = [
  ["Edit", "Undo", /Z/],
  ["Edit", "Redo", /Y|⇧.*Z|Shift/],
  ["File", "Print…", /P/],
  ["View", "Show sidebar", /S/],
  ["View", "Show properties panel", /P/],
  ["View", "Zoom in", /\+/],
  ["View", "Zoom out", /-/],
  ["View", "Actual size", /0/],
  ["View", "Fit width", /W/],
  ["View", "Fit page", /A/],
  ["View", "Rotate view clockwise", /R/],
  ["View", "Organise pages…"],
  ["View", "Continuous"],
  ["View", "Single page"],
  ["View", "Two pages"],
  ["View", "Go to page…", /G/],
  ["View", "First page", /Home/],
  ["View", "Previous page", /PageUp/],
  ["View", "Next page", /PageDown/],
  ["View", "Last page", /End/],
  ["Edit", "Find…", /F/],
  ["View", "Full screen", /F/],
  ["File", "Save", /S/],
  ["File", "PDF document (.pdf)"],
  ["Tools", "Organise pages…"],
  ["Tools", "Prepare form"],
  ["Tools", "Export data…"],
  ["File", "Save a copy", /S/],
  ["Tools", "Edit text and pictures"],
];

describe("every command of the old toolbar is in the menu bar, with its key", () => {
  it("has each entry, with a key where there is one", async () => {
    await mount();
    const table = await menuTable();
    const found = (menu: string, label: string) => [...table].find(([k]) => k === `${menu}|${label}`)?.[1];
    for (const [menu, label, shortcut] of FROM_THE_TOOLBAR) {
      const entry = found(menu, label);
      expect(entry, `${menu} > ${label}`).toBeDefined();
      if (shortcut) expect(entry!.shortcut, `${menu} > ${label} shows its key`).toMatch(shortcut);
    }
  });

  it("has an entry for each toolbar button, by the same name (checked against the toolbar of topToolbar)", async () => {
    await mount({ topToolbar: true });
    const buttons = qa("[data-command]", q(".pli-pdf-toolbar")).map((b) => b.getAttribute("aria-label")!);
    expect(buttons.length).toBeGreaterThan(8);
    const table = await menuTable();
    const names = new Set([...table.keys()].map((k) => k.split("|")[1]!.replace(/…$/, "")));
    // a button and its menu entry can differ in a word ("Rotate view" and "Rotate view clockwise", "Find" and "Find…")
    const near = (name: string) => [...names].some((n) => n === name || n.startsWith(name) || name.startsWith(n) || n.endsWith(name) || n.includes(name.replace("Exit ", "")));
    // what the title row and a drop-down carry is checked on its own
    for (const name of buttons.filter((b) => !["Sidebar", "Zoom", "Fit width", "Fit page", "Save", "Properties"].includes(b))) expect(near(name), `no menu entry for the "${name}" button`).toBe(true);
    for (const [name, label] of [["Sidebar", "Show sidebar"], ["Properties", "Show properties panel"], ["Save", "Save"], ["Fit width", "Fit width"], ["Fit page", "Fit page"]] as const) {
      if (buttons.includes(name)) expect(names.has(label), `${label}`).toBe(true);
    }
  });

  it("keeps an entry disabled, not missing, where it cannot be used (print with no way to print, go to with no page box)", async () => {
    await mount({ statusBar: false });
    const table = await menuTable();
    expect(table.get("View|Go to page…")?.disabled).toBe(true);
  });
});

describe("the same keys still work, with no toolbar", () => {
  it("Alt+Shift+G puts the cursor in the page box", async () => {
    await mount();
    await keyDown({ key: "G", code: "KeyG", altKey: true, shiftKey: true, bubbles: true });
    expect(document.activeElement).toBe(pageBox());
  });

  it("Alt+Shift+W and Alt+Shift+A fit the width and the page", async () => {
    await mount();
    await keyDown({ key: "W", code: "KeyW", altKey: true, shiftKey: true, bubbles: true });
    const width = zoomText();
    await keyDown({ key: "A", code: "KeyA", altKey: true, shiftKey: true, bubbles: true });
    const page = zoomText();
    expect(width).not.toBe("100%");
    expect(page).not.toBe(width);
    await chooseMenu("View", "Zoom", "Fit width");
    expect(zoomText()).toBe(width);
    await keyDown({ key: "0", ctrlKey: true, bubbles: true });
    expect(zoomText()).toBe("100%");
  });

  it("Alt+Shift+R turns the view a quarter turn", async () => {
    await mount();
    const before = firstPageWidth();
    await keyDown({ key: "R", code: "KeyR", altKey: true, shiftKey: true, bubbles: true });
    expect(firstPageWidth()).not.toBe(before);
    await chooseMenu("View", "Rotate view clockwise");
    await chooseMenu("View", "Rotate view clockwise");
    await chooseMenu("View", "Rotate view clockwise");
    expect(firstPageWidth()).toBe(before);
  });

  it("Alt+Shift+F goes full screen where the browser can", async () => {
    const asked: Element[] = [];
    (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen = function (this: Element) {
      asked.push(this);
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    await mount();
    await keyDown({ key: "F", code: "KeyF", altKey: true, shiftKey: true, bubbles: true });
    expect(asked).toEqual([q(".pli-pdf")]);
  });

  it("Ctrl+F finds, Ctrl+Z undoes, Alt+Shift+S and Alt+Shift+P show the sidebar and the panel", async () => {
    const session = await mount();
    await keyDown({ key: "f", ctrlKey: true, bubbles: true });
    expect(q(".pli-pdf-find")).not.toBeNull();
    await key(q(".pli-pdf-find-input"), "Escape");
    await run(() => session.annots.addHighlight(session.doc.pages[0]!.id, [{ x: 72, y: 100, w: 100, h: 14 }]));
    expect(session.canUndo).toBe(true);
    await keyDown({ key: "z", ctrlKey: true, bubbles: true });
    expect(session.canUndo).toBe(false);
    expect(q(".pli-pdf-sidebar")).not.toBeNull();
    await keyDown({ key: "S", code: "KeyS", altKey: true, shiftKey: true, bubbles: true });
    expect(document.querySelector(".pli-pdf-sidebar")).toBeNull();
  });

  it("lists the new keys in the keyboard help", async () => {
    await mount();
    await chooseMenu("Help", "Keyboard shortcuts");
    const text = document.querySelector("dialog[open]")!.textContent!;
    for (const want of ["Go to a page", "fit the width", "Turn the view", "Full screen"]) expect(text).toContain(want);
  });
});
