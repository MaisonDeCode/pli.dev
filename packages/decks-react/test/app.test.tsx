// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDeck, parseDeck, plainText, serializeDeck, toPptx, type TableElement } from "@pli.dev/decks";
import { DownloadProvider } from "@pli.dev/react";
import { PliDeck, type PliDeckDownload } from "../src";
import { byLabel, click, host, key, menuItem, newSession, pointer, q, qa, render, run, runAsync, sampleDeck, setValue, useHost } from "./harness";

useHost();

const openMenu = (name: string) => click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name));
const choose = (name: string, ...path: string[]) => {
  openMenu(name);
  for (const label of path) click(menuItem(label));
};
const pickSlide = (i: number) => {
  pointer(qa(".pli-deck-film-item")[i]!, "pointerdown", 5, 5);
  pointer(window, "pointerup");
};
const wait = (ms: number) => runAsync(() => new Promise((r) => setTimeout(r, ms)));
const ctrl = (el: Element, k: string, init: KeyboardEventInit = {}) => key(el, k, { metaKey: true, ...init });

describe("find and replace", () => {
  it("finds across slides and notes, steps through matches, selecting each and highlighting it", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    ctrl(q(".pli-deck-filmstrip"), "f");
    const find = byLabel("Find") as HTMLInputElement;
    setValue(find, "agenda");
    // the slide title and the notes
    expect(q(".pli-deck-find-count").textContent).toBe("1 of 2");
    key(find, "Enter");
    expect(q(".pli-deck-find-count").textContent).toBe("2 of 2");
    key(find, "Enter");
    expect(q(".pli-deck-find-count").textContent).toBe("1 of 2");
    expect(s.selection.slide).toBe(s.deck.slides[1]!.id);
    expect(s.selection.elements).toEqual([s.deck.slides[1]!.elements[0]!.id]);
    expect(q("mark.pli-deck-find-current", q(".pli-deck-canvas-slide")).textContent).toBe("Agenda");
    click(byLabel("Previous match"));
    expect(q(".pli-deck-find-count").textContent).toBe("2 of 2");
    setValue(find, "zzz");
    expect(q(".pli-deck-find-count").textContent).toBe("No results");
    expect(host.querySelector("mark")).toBeNull();
  });

  it("matches case on request, replaces one, replaces all, and undoes as one step", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    openMenu("Edit");
    click(menuItem("Find and replace"));
    const find = byLabel("Find") as HTMLInputElement;
    setValue(find, "o");
    const total = s.find("o").length;
    expect(q(".pli-deck-find-count").textContent).toBe(`1 of ${total}`);
    click(q(".pli-deck-find-bar input[type=checkbox]"));
    setValue(find, "O");
    expect(q(".pli-deck-find-count").textContent).toBe(`1 of ${s.find("O", { matchCase: true }).length}`);
    click(q(".pli-deck-find-bar input[type=checkbox]"));
    setValue(find, "Hello");
    setValue(byLabel("Replace with") as HTMLInputElement, "Howdy");
    click([...qa("button", q(".pli-deck-find-bar"))].find((b) => b.textContent === "Replace")!);
    expect(plainText((s.deck.slides[0]!.elements[0] as unknown as { text: { paragraphs: never[] } }).text.paragraphs)).toBe("Howdy world");
    setValue(find, "o");
    setValue(byLabel("Replace with") as HTMLInputElement, "0");
    click([...qa("button", q(".pli-deck-find-bar"))].find((b) => b.textContent === "Replace all")!);
    expect(s.find("o", { matchCase: true })).toHaveLength(0);
    expect(plainText((s.deck.slides[0]!.elements[0] as unknown as { text: { paragraphs: never[] } }).text.paragraphs)).toBe("Hell0 w0rld".replace("Hell0", "H0wdy"));
    run(() => s.undo());
    expect(s.find("o", { matchCase: true }).length).toBeGreaterThan(0);
  });

  it("replaces a match in the speaker notes, and Escape closes the bar", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    ctrl(q(".pli-deck-filmstrip"), "f");
    setValue(byLabel("Find") as HTMLInputElement, "Remember");
    setValue(byLabel("Replace with") as HTMLInputElement, "Recall");
    click([...qa("button", q(".pli-deck-find-bar"))].find((b) => b.textContent === "Replace")!);
    expect(s.deck.slides[1]!.notes).toBe("Recall the agenda");
    key(byLabel("Find"), "Escape");
    expect(host.querySelector(".pli-deck-find-bar")).toBeNull();
  });

  it("can find but not replace when read only", () => {
    render(<PliDeck session={newSession()} readOnly />);
    ctrl(q(".pli-deck-filmstrip"), "f");
    expect(byLabel("Find")).toBeTruthy();
    expect(host.querySelector('[aria-label="Replace with"]')).toBeNull();
  });
});

describe("menus", () => {
  const expected: Record<string, string[]> = {
    File: ["New presentation", "Open…", "Download", "Save as theme (.potx)", "Import theme…", "Page setup…"],
    Edit: ["Undo", "Redo", "Cut", "Copy", "Paste", "Duplicate", "Delete", "Select all", "Find and replace"],
    View: ["Present from beginning", "Present from current slide", "Presenter view", "Zoom", "Show speaker notes", "Show filmstrip", "Snap to guides", "Edit master"],
    Insert: ["Image", "Text box", "Shape", "Line", "Table", "New slide", "Link…", "Placeholder"],
    Slide: ["New slide", "Duplicate slide", "Delete slide", "Skip slide", "Move slide", "Change background…", "Change layout", "Reset layout", "Transition…", "Edit master", "Change theme…"],
    Format: ["Text", "Align & indent", "Line & paragraph spacing", "Bullets & numbering", "Clear formatting", "Format options…"],
    Arrange: ["Order", "Align horizontally", "Align vertically", "Distribute", "Rotate", "Group", "Ungroup"],
    Tools: ["Find and replace", "Word count", "Alt text…"],
  };

  it("has File, Edit, View, Insert, Slide, Format, Arrange and Tools (and no Help) with the expected items", () => {
    render(<PliDeck session={newSession()} />);
    const names = qa(".pli-menubar-button").map((b) => b.textContent);
    expect(names).toEqual(Object.keys(expected));
    expect(q('[role="menubar"]')).toBeTruthy();
    for (const [name, items] of Object.entries(expected)) {
      openMenu(name);
      const labels = [...document.querySelectorAll(".pli-menu-panel > ul > li .pli-menu-label")].map((e) => e.textContent);
      expect(labels, name).toEqual(expect.arrayContaining(items));
      openMenu(name);
    }
  });

  it("every enabled item, at any depth, runs without error and closes the menu", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.confirm = () => true;
    const s = newSession();
    const slide = s.deck.slides[2]!;
    s.selection = { slide: slide.id, slides: [slide.id], elements: [] };
    render(<PliDeck session={s} />);
    pointer(q(".pli-deck-stage"), "pointerdown", 160, 190);
    pointer(window, "pointerup");
    // the buttons of one level of an open menu, after opening the ancestors in `path`
    const level = (name: string, path: string[]): HTMLButtonElement[] => {
      openMenu(name);
      let list = document.querySelector<HTMLElement>(".pli-menu-panel > ul")!;
      for (const step of path) {
        const b = [...list.querySelectorAll<HTMLButtonElement>(":scope > li > button")].find((x) => x.querySelector(".pli-menu-label")!.textContent === step)!;
        click(b);
        list = b.parentElement!.querySelector<HTMLElement>(":scope > .pli-submenu > ul")!;
      }
      return [...list.querySelectorAll<HTMLButtonElement>(":scope > li > button")];
    };
    const labelOf = (b: HTMLElement) => b.querySelector(".pli-menu-label")!.textContent!;
    const cleanup = () => {
      document.querySelectorAll("dialog[open]").forEach((d) => d.removeAttribute("open"));
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      for (const close of qa('[aria-label^="Close"]')) click(close);
      if (document.querySelector(".pli-menu-panel")) openMenu([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.getAttribute("aria-expanded") === "true")!.textContent!);
    };
    let invoked = 0;
    const visit = (name: string, path: string[]) => {
      const labels = level(name, path).map(labelOf);
      cleanup();
      for (const label of labels) {
        const item = level(name, path).find((b) => labelOf(b) === label);
        if (!item || item.disabled) {
          cleanup();
          continue;
        }
        if (item.getAttribute("aria-haspopup")) {
          cleanup();
          visit(name, [...path, label]);
        } else {
          click(item);
          invoked++;
          expect(document.querySelector(".pli-menu-panel"), `${name} > ${path.concat(label).join(" > ")} closes the menu`).toBeNull();
          cleanup();
        }
      }
    };
    for (const name of Object.keys(expected)) {
      if (name === "File") continue;
      visit(name, []);
    }
    expect(invoked).toBeGreaterThan(60);
    expect(errors.mock.calls.filter((c) => !String(c[0]).includes("act(")).length).toBe(0);
    errors.mockRestore();
  });

  it("Edit > Undo and Redo reflect the history", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    openMenu("Edit");
    expect((menuItem("Redo") as HTMLButtonElement).disabled).toBe(true);
    expect((menuItem("Undo") as HTMLButtonElement).disabled).toBe(true);
    expect((menuItem("Delete") as HTMLButtonElement).disabled).toBe(true);
    openMenu("Edit");
    const slide = s.deck.slides[0]!;
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 150);
    pointer(window, "pointerup");
    choose("Edit", "Delete");
    expect(s.deck.slides[0]!.elements.length).toBe(slide.elements.length - 1);
    choose("Edit", "Undo");
    expect(s.deck.slides[0]!.elements.length).toBe(slide.elements.length);
    openMenu("Edit");
    expect((menuItem("Redo") as HTMLButtonElement).disabled).toBe(false);
  });

  it("View > Zoom changes the slide size, and Fit follows the space", () => {
    render(<PliDeck session={newSession()} />);
    const width = () => q(".pli-deck-canvas-slide").style.width;
    expect(width()).toBe("720px");
    choose("View", "Zoom", "50%");
    expect(width()).toBe("480px");
    choose("View", "Zoom", "200%");
    expect(width()).toBe("1920px");
    click(byLabel("Zoom"));
    click(menuItem("Fit"));
    expect(width()).toBe("720px");
    choose("View", "Show filmstrip");
    expect(host.querySelector(".pli-deck-filmstrip")).toBeNull();
  });
});

describe("files", () => {
  it("downloads PowerPoint, PDF and Pli JSON through onDownload with the right names and contents", async () => {
    const got: PliDeckDownload[] = [];
    render(<PliDeck session={newSession()} onDownload={(f) => void got.push(f)} />);
    choose("File", "Download", "Microsoft PowerPoint (.pptx)");
    await wait(30);
    choose("File", "Download", "PDF document (.pdf)");
    await wait(200);
    choose("File", "Download", "Pli JSON (.json)");
    await wait(30);
    choose("File", "Save as theme (.potx)");
    await wait(30);
    expect(got.map((g) => g.name)).toEqual(["Sample.pptx", "Sample.pdf", "Sample.json", "Sample theme.potx"]);
    expect([...got[0]!.data.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(got[0]!.type).toContain("presentationml.presentation");
    expect(new TextDecoder().decode(got[1]!.data.slice(0, 5))).toBe("%PDF-");
    expect(parseDeck(new TextDecoder().decode(got[2]!.data)).slides.length).toBe(3);
    expect([...got[3]!.data.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(got[3]!.type).toContain("template");
  });

  it("uses the DownloadProvider's function, and the deck's own onDownload wins", async () => {
    const fromProvider: string[] = [];
    const own: string[] = [];
    render(
      <DownloadProvider onDownload={(f) => void fromProvider.push(f.name)}>
        <PliDeck session={newSession()} />
      </DownloadProvider>,
    );
    choose("File", "Download", "Pli JSON (.json)");
    await wait(30);
    expect(fromProvider).toEqual(["Sample.json"]);
    render(
      <DownloadProvider onDownload={(f) => void fromProvider.push(f.name)}>
        <PliDeck session={newSession()} onDownload={(f) => void own.push(f.name)} />
      </DownloadProvider>,
    );
    choose("File", "Download", "Pli JSON (.json)");
    await wait(30);
    expect(own).toEqual(["Sample.json"]);
    expect(fromProvider).toEqual(["Sample.json"]);
  });

  it("menuLabels renames and removes menus and items, and the renamed item still does its job", async () => {
    const got: string[] = [];
    render(<PliDeck session={newSession()} onDownload={(f) => void got.push(f.name)} menuLabels={{ File: "Presentation", Tools: false, Download: "Export" }} />);
    const bar = [...host.querySelectorAll(".pli-menubar-button")].map((b) => b.textContent);
    expect(bar).toContain("Presentation");
    expect(bar).not.toContain("File");
    expect(bar).not.toContain("Tools");
    choose("Presentation", "Export", "Pli JSON (.json)");
    await wait(30);
    expect(got).toEqual(["Sample.json"]);
  });

  it("says why when the download function fails", async () => {
    render(<PliDeck session={newSession()} onDownload={() => Promise.reject(new Error("the drive is full"))} />);
    choose("File", "Download", "Pli JSON (.json)");
    await wait(30);
    expect(host.textContent).toContain("the drive is full");
  });

  it("passes the PDF options on", async () => {
    const got: PliDeckDownload[] = [];
    const rasterize = vi.fn(() => undefined);
    const s = newSession();
    run(() => s.addImage(s.deck.slides[0]!.id, "https://example.com/x.svg", { w: 100, h: 100 }));
    render(<PliDeck session={s} onDownload={(f) => void got.push(f)} pdf={{ rasterize }} />);
    choose("File", "Download", "PDF document (.pdf)");
    await wait(200);
    expect(rasterize).toHaveBeenCalled();
    expect(q(".pli-deck-warnings-banner").textContent).toContain("note");
    click([...qa("button", q(".pli-deck-warnings-banner"))].find((b) => b.textContent === "Dismiss"));
    expect(host.querySelector(".pli-deck-warnings-banner")).toBeNull();
  });

  const openWith = async (file: File) => {
    const input = q<HTMLInputElement>('input[aria-label="Open presentation"]');
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await runAsync(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
    });
  };

  it("opens a Pli JSON file and a PowerPoint file, replacing the deck and clearing history", async () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const other = createDeck({ title: "Other deck" });
    await openWith(new File([serializeDeck(other)], "other.json"));
    expect(s.deck.title).toBe("Other deck");
    expect(s.deck.slides.length).toBe(1);
    expect(s.canUndo).toBe(false);
    expect((q("input.pli-doc-title") as HTMLInputElement).value).toBe("Other deck");
    await openWith(new File([toPptx(parseDeck(JSON.stringify(sampleDeck()))) as BlobPart], "deck.pptx"));
    expect(s.deck.slides.length).toBe(3);
    expect(qa(".pli-deck-film-item").length).toBe(3);
  });

  it("says when a file can't be opened and leaves the deck alone", async () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    await openWith(new File(["not a deck"], "broken.json"));
    expect(q('[role="alert"]').textContent).toContain("couldn't be opened");
    expect(s.deck.slides.length).toBe(3);
  });

  it("starts a new presentation after asking", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    run(() => s.setTitle("x"));
    window.confirm = () => false;
    choose("File", "New presentation");
    expect(s.deck.slides.length).toBe(3);
    window.confirm = () => true;
    choose("File", "New presentation");
    expect(s.deck.slides.length).toBe(1);
    expect(s.deck.title).toBe("Untitled presentation");
  });

  it("sets the slide size from Page setup, scaling the content", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("File", "Page setup…");
    setValue(byLabel("Slide size") as HTMLSelectElement, "Widescreen (16:9)");
    click(document.querySelector('dialog button[type="submit"]'));
    expect(s.deck.size).toEqual({ width: 960, height: 540 });
    choose("File", "Page setup…");
    setValue(byLabel("Slide size") as HTMLSelectElement, "custom");
    setValue(byLabel("Width in inches") as HTMLInputElement, "8");
    setValue(byLabel("Height in inches") as HTMLInputElement, "6");
    click(document.querySelector('dialog button[type="submit"]'));
    expect(s.deck.size).toEqual({ width: 576, height: 432 });
  });

  it("edits the title on blur and with Enter", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const input = byLabel("Presentation title") as HTMLInputElement;
    setValue(input, "Quarterly");
    expect(s.deck.title).toBe("Sample");
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    act(() => {
      input.blur();
      input.dispatchEvent(new FocusEvent("blur"));
    });
    key(input, "Enter");
    expect(s.deck.title).toBe("Quarterly");
  });
});

describe("tables", () => {
  const insertTable = (s: ReturnType<typeof newSession>) => {
    choose("Insert", "Table", "3 × 3");
    const slide = s.deck.slides[0]!;
    return { slide, table: () => slide.elements.find((e) => e.type === "table") as TableElement };
  };
  const tbl = (s: ReturnType<typeof newSession>) => s.deck.slides[0]!.elements.find((e) => e.type === "table") as TableElement;

  it("inserts a table that is selected, and click on a cell edits it; Tab moves, and Tab in the last cell adds a row", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    insertTable(s);
    expect(tbl(s).rows.length).toBe(3);
    const t = tbl(s);
    // click the first cell
    pointer(q(".pli-deck-stage"), "pointerdown", t.x! + 10, t.y! + 10);
    pointer(window, "pointerup", t.x! + 10, t.y! + 10);
    expect(q('[role="textbox"]')).toBeTruthy();
    const type = (text: string) => act(() => void q('[role="textbox"]').dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true })));
    type("a");
    key(q('[role="textbox"]'), "Tab");
    type("b");
    expect(plainText(tbl(s).rows[0]!.cells[0]!.paragraphs)).toBe("a");
    expect(plainText(tbl(s).rows[0]!.cells[1]!.paragraphs)).toBe("b");
    for (let i = 0; i < 7; i++) key(q('[role="textbox"]'), "Tab");
    expect(tbl(s).rows.length).toBe(3);
    key(q('[role="textbox"]'), "Tab");
    expect(tbl(s).rows.length).toBe(4);
    key(q('[role="textbox"]'), "Tab", { shiftKey: true });
    type("z");
    expect(plainText(tbl(s).rows[2]!.cells[2]!.paragraphs)).toBe("z");
  });

  it("adds and removes rows and columns, merges selected cells, and toggles header and banding from the Table menu", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    insertTable(s);
    const t = tbl(s);
    pointer(q(".pli-deck-stage"), "pointerdown", t.x! + 10, t.y! + 10);
    // dragging across cells selects a block
    pointer(window, "pointermove", t.x! + 10 + t.columns[0]!, t.y! + 10 + t.rows[0]!.h);
    pointer(window, "pointerup");
    expect(qa(".pli-deck-cellsel").length).toBe(1);
    click(byLabel("Table"));
    click(menuItem("Merge cells"));
    expect(tbl(s).rows[0]!.cells[0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    click(byLabel("Table"));
    click(menuItem("Unmerge cells"));
    expect(tbl(s).rows[0]!.cells[0]!.colSpan).toBeUndefined();
    click(byLabel("Table"));
    click(menuItem("Insert row below"));
    click(byLabel("Table"));
    click(menuItem("Insert column right"));
    expect(tbl(s).rows.length).toBeGreaterThanOrEqual(4);
    expect(tbl(s).columns.length).toBeGreaterThanOrEqual(4);
    click(byLabel("Table"));
    click(menuItem("Delete column"));
    click(byLabel("Table"));
    click(menuItem("Delete row"));
    click(byLabel("Table"));
    click(menuItem("Banded rows"));
    expect(tbl(s).banded).toBe(true);
    click(byLabel("Table"));
    click(menuItem("Header row"));
    expect(tbl(s).headerRow).toBe(false);
  });

  it("fills selected cells from the toolbar, and drags a column border to resize", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    insertTable(s);
    const t = tbl(s);
    pointer(q(".pli-deck-stage"), "pointerdown", t.x! + 10, t.y! + 10);
    pointer(window, "pointerup");
    key(q('[role="textbox"]'), "Escape");
    click(byLabel("Fill color"));
    click(document.querySelector<HTMLElement>('.pli-swatch[aria-label="#ff0000"]'));
    expect(tbl(s).rows[0]!.cells[0]!.fill).toBe("#ff0000");
    expect(tbl(s).rows[0]!.cells[1]!.fill).toBeUndefined();
    const edge = t.x! + t.columns[0]!;
    pointer(q(".pli-deck-stage"), "pointerdown", edge, t.y! + 10);
    pointer(window, "pointermove", edge + 30, t.y! + 10);
    pointer(window, "pointerup", edge + 30, t.y! + 10);
    expect(tbl(s).columns[0]).toBeCloseTo(t.columns[0]! + 30);
    expect(tbl(s).columns[1]).toBeCloseTo(t.columns[1]! - 30);
  });
});

describe("theme and layout editor", () => {
  it("edits the layouts on the same canvas, adds, renames and removes layouts, and changes show on the slides", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("View", "Edit master");
    expect(q(".pli-deck-theme-banner")).toBeTruthy();
    expect(host.querySelector(".pli-deck-filmstrip")).toBeNull();
    const items = () => qa(".pli-deck-template-row");
    expect(items().length).toBe(s.deck.masters[0]!.layouts.length);
    // the layout of the first slide is shown, with its placeholders as selectable shapes
    const layout = s.layout(s.deck.slides[0]!.layout).layout;
    expect(qa(".pli-deck-canvas-slide [data-from=layout]").length).toBe(layout.elements.length);
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 150);
    pointer(window, "pointerup");
    expect(s.selection.elements).toEqual([layout.elements[0]!.id]);
    key(q(".pli-deck-stage"), "ArrowDown", { shiftKey: true });
    expect(s.layout(layout.id).layout.elements[0]!.y).toBe(layout.elements[0]!.y! + 10);
    // add a layout (a copy of the shown one)
    const before = s.deck.masters[0]!.layouts.length;
    click([...qa("button")].find((b) => b.textContent!.includes("Add layout")));
    expect(s.deck.masters[0]!.layouts.length).toBe(before + 1);
    // rename it
    const added = s.deck.masters[0]!.layouts.at(-1)!;
    click(byLabel(`Rename layout ${added.name}`));
    const input = byLabel("Layout name") as HTMLInputElement;
    setValue(input, "Pull quote");
    key(input, "Enter");
    act(() => {
      input.blur();
      input.dispatchEvent(new FocusEvent("blur"));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(s.deck.masters[0]!.layouts.at(-1)!.name).toBe("Pull quote");
    // remove it again
    click(byLabel("Delete layout Pull quote"));
    expect(s.deck.masters[0]!.layouts.length).toBe(before);
    // a layout that slides use can't be removed
    expect((byLabel(`Delete layout ${layout.name}`) as HTMLButtonElement).disabled).toBe(true);
    // the master
    click(q(".pli-deck-template-item"));
    expect(qa(".pli-deck-canvas-slide [data-from=master]").length).toBeGreaterThan(0);
    click(q(".pli-deck-theme-banner button"));
    expect(host.querySelector(".pli-deck-theme-banner")).toBeNull();
    expect(qa(".pli-deck-film-item").length).toBe(3);
  });

  it("changes a layout's background, which every slide on it shows", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("View", "Edit master");
    click(byLabel("Background"));
    click(document.querySelector<HTMLElement>('dialog .pli-swatch[aria-label="#fce8e6"]'));
    click(document.querySelector('dialog button[type="submit"]'));
    expect(s.layout(s.deck.slides[0]!.layout).layout.background).toBe("#fce8e6");
    expect(s.scene(s.deck.slides[0]!.id).background).toMatchObject({ color: "#fce8e6" });
  });
});

describe("slides: layout, background and transitions", () => {
  it("changes a slide's layout from the toolbar's Layout menu with previews", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Layout"));
    const buttons = qa(".pli-deck-layout-button", document.body as HTMLElement);
    expect(buttons.length).toBe(s.deck.masters[0]!.layouts.length);
    expect(buttons[0]!.querySelector(".pli-deck-slide")).toBeTruthy();
    click(buttons.find((b) => b.title === "Title only")!);
    expect(s.layout(s.deck.slides[0]!.layout).layout.name).toBe("Title only");
  });

  it("sets one slide's or every slide's background", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Background"));
    click(document.querySelector<HTMLElement>('dialog .pli-swatch[aria-label="#e8f0fe"]'));
    click(document.querySelector('dialog button[type="submit"]'));
    expect(s.deck.slides.map((x) => x.background)).toEqual([undefined, "#e8f0fe", undefined]);
    click(byLabel("Background"));
    click(document.querySelector<HTMLElement>('dialog .pli-swatch[aria-label="#fff8e1"]'));
    click([...qa("dialog button")].find((b) => b.textContent === "Apply to all slides"));
    expect(s.deck.slides.every((x) => x.background === "#fff8e1")).toBe(true);
    click(byLabel("Background"));
    click([...qa("dialog button")].find((b) => b.textContent === "Reset")!);
    expect(s.deck.slides[1]!.background).toBeUndefined();
  });
});

describe("clipboard and shortcuts", () => {
  const clipboard = () => {
    const store: Record<string, string> = {};
    return { store, data: { getData: (t: string) => store[t] ?? "", setData: (t: string, v: string) => void (store[t] = v), files: [] as File[] } };
  };
  const fire = (el: Element, type: string, data: unknown) => {
    const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    e.clipboardData = data;
    act(() => void el.dispatchEvent(e));
    return e;
  };

  it("copies elements as tagged JSON text, cuts, and pastes them (with new ids) on the same or another slide", () => {
    const s = newSession();
    const slide = s.deck.slides[2]!;
    s.selection = { slide: slide.id, slides: [slide.id], elements: [] };
    render(<PliDeck session={s} />);
    const stage = q(".pli-deck-stage");
    pointer(stage, "pointerdown", 160, 190);
    pointer(window, "pointerup");
    const cb = clipboard();
    fire(stage, "copy", cb.data);
    const clip = JSON.parse(cb.store["text/plain"]!);
    expect(clip.format).toBe("pli.deck.elements");
    expect(clip.elements).toHaveLength(1);
    const count = s.elementsOf(slide.id).length;
    fire(stage, "paste", cb.data);
    expect(s.elementsOf(slide.id).length).toBe(count + 1);
    const pasted = s.elementsOf(slide.id).at(-1)!;
    expect(pasted.id).not.toBe(clip.elements[0].id);
    expect(pasted.x).toBe(clip.elements[0].x + 12);
    // cut and paste on another slide
    fire(stage, "cut", cb.data);
    expect(s.elementsOf(slide.id).length).toBe(count);
    pickSlide(0);
    fire(q(".pli-deck-stage"), "paste", cb.data);
    expect(s.deck.slides[0]!.elements.at(-1)).toMatchObject({ type: "shape", geometry: "rect" });
  });

  it("pastes plain text as a text box and a picture file as an image", async () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const cb = clipboard();
    cb.store["text/plain"] = "pasted words";
    fire(q(".pli-deck-stage"), "paste", cb.data);
    const el = s.deck.slides[0]!.elements.at(-1)!;
    expect(plainText((el as unknown as { text: { paragraphs: never[] } }).text.paragraphs)).toBe("pasted words");
    expect(el).toMatchObject({ textBox: true });
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    await runAsync(async () => {
      const e = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      e.clipboardData = { getData: () => "", files: [file] };
      q(".pli-deck-stage").dispatchEvent(e);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(s.deck.slides[0]!.elements.at(-1)!.type).toBe("image");
  });

  it("copies and pastes slides in the filmstrip through the clipboard", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    const cb = clipboard();
    fire(q(".pli-deck-filmstrip"), "copy", cb.data);
    expect(JSON.parse(cb.store["text/plain"]!).format).toBe("pli.deck.slides");
    fire(q(".pli-deck-filmstrip"), "paste", cb.data);
    expect(s.deck.slides.length).toBe(4);
    expect(plainText((s.deck.slides[2]!.elements[0] as unknown as { text: { paragraphs: never[] } }).text.paragraphs)).toBe("Agenda");
  });

  it("Cmd+Z, Cmd+Shift+Z and Cmd+Y undo and redo; Cmd+M adds a slide; Cmd+Alt+Shift+M skips one", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const stage = q(".pli-deck-stage");
    ctrl(stage, "m");
    expect(s.deck.slides.length).toBe(4);
    ctrl(stage, "z");
    expect(s.deck.slides.length).toBe(3);
    ctrl(stage, "z", { shiftKey: true });
    expect(s.deck.slides.length).toBe(4);
    ctrl(stage, "z");
    ctrl(stage, "y");
    expect(s.deck.slides.length).toBe(4);
    ctrl(stage, "m", { altKey: true, shiftKey: true, code: "KeyM" });
    expect(s.deck.slides.find((x) => x.id === s.selection.slide)!.skipped).toBe(true);
  });

  it("Cmd+B/I/U format the selected shape's text, and alignment and list shortcuts work", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const stage = q(".pli-deck-stage");
    pointer(stage, "pointerdown", 100, 150);
    pointer(window, "pointerup");
    ctrl(stage, "b");
    ctrl(stage, "e", { shiftKey: true });
    const json = JSON.stringify(s.deck.slides[0]!.elements[0]);
    expect(json).toContain('"bold":true');
    expect(json).toContain('"align":"center"');
    ctrl(stage, "8", { shiftKey: true });
    expect(JSON.stringify(s.deck.slides[0]!.elements[0])).toContain('"bullet"');
  });

  it("Enter starts editing a selected shape, Tab cycles the selection, Escape clears it", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    const stage = q(".pli-deck-stage");
    key(stage, "Tab");
    expect(s.selection.elements).toEqual([s.deck.slides[0]!.elements[0]!.id]);
    key(stage, "Tab");
    expect(s.selection.elements).toEqual([s.deck.slides[0]!.elements[1]!.id]);
    key(stage, "Tab", { shiftKey: true });
    expect(s.selection.elements).toEqual([s.deck.slides[0]!.elements[0]!.id]);
    key(stage, "Enter");
    expect(q('[role="textbox"]')).toBeTruthy();
    key(q('[role="textbox"]'), "Escape");
    key(stage, "Escape");
    expect(s.selection.elements).toEqual([]);
  });

  it("arrow keys with nothing selected change slide", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    key(q(".pli-deck-stage"), "ArrowDown");
    expect(s.selection.slide).toBe(s.deck.slides[1]!.id);
  });
});

describe("read only", () => {
  it("leaves viewing, zooming, downloading and presenting, and no editing chrome", () => {
    const s = newSession();
    render(<PliDeck session={s} readOnly />);
    expect(byLabel("Presentation title")).toHaveProperty("readOnly", true);
    for (const l of ["Undo", "Redo", "Bold", "Text box", "Image", "Shape", "New slide", "Layout", "Theme", "Transition", "Background"]) expect(host.querySelector(`[aria-label="${l}"]`), l).toBeNull();
    expect(byLabel("Zoom")).toBeTruthy();
    expect(byLabel("Present")).toBeTruthy();
    // editing commands do nothing
    const stage = q(".pli-deck-stage");
    key(stage, "m", { metaKey: true });
    key(stage, "z", { metaKey: true });
    key(stage, "Delete");
    expect(s.deck.slides.length).toBe(3);
    pointer(qa(".pli-deck-film-item")[1]!, "contextmenu", 5, 5);
    expect(host.querySelector(".pli-deck-contextmenu")).toBeNull();
    key(q(".pli-deck-filmstrip"), "Enter");
    key(q(".pli-deck-filmstrip"), "Delete");
    expect(s.deck.slides.length).toBe(3);
    openMenu("Edit");
    expect((menuItem("Delete") as HTMLButtonElement).disabled).toBe(true);
    expect((menuItem("Copy") as HTMLButtonElement).disabled).toBe(true);
    openMenu("Edit");
    openMenu("File");
    expect((menuItem("New presentation") as HTMLButtonElement).disabled).toBe(true);
    expect((menuItem("Download") as HTMLButtonElement).disabled).toBe(false);
    // slides can still be looked through
    pickSlide(2);
    expect(s.selection.slide).toBe(s.deck.slides[2]!.id);
  });

  it("can hide the menu and the toolbar", () => {
    render(<PliDeck session={newSession()} menu={false} toolbar={false} />);
    expect(host.querySelector(".pli-menubar")).toBeNull();
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    expect(host.querySelector(".pli-deck-filmstrip")).toBeTruthy();
  });
});

describe("accessibility", () => {
  it("labels the toolbar, menubar, filmstrip and canvas, and exposes alt text on elements", () => {
    const s = newSession();
    const slide = s.deck.slides[2]!;
    s.selection = { slide: slide.id, slides: [slide.id], elements: [] };
    run(() => s.addImage(slide.id, "data:image/png;base64,AAAA", { w: 40, h: 40 }, { x: 0, y: 0 }, { alt: "A tiny logo" }));
    render(<PliDeck session={s} />);
    expect(q('[role="toolbar"]').getAttribute("aria-label")).toBe("Formatting");
    expect(q('[role="menubar"]')).toBeTruthy();
    expect(q('[role="listbox"]').getAttribute("aria-multiselectable")).toBe("true");
    expect(q(".pli-deck-stage").getAttribute("aria-label")).toBe("Slide canvas");
    expect(q('.pli-deck-canvas-slide [role="img"][aria-label="A tiny logo"]')).toBeTruthy();
    for (const b of qa(".pli-deck-toolbar button.pli-tool")) expect(b.getAttribute("aria-label") ?? b.textContent, b.outerHTML).toBeTruthy();
    expect(byLabel("Undo").hasAttribute("disabled")).toBe(false);
  });
});

describe("dialogs", () => {
  it("shows the word count", () => {
    render(<PliDeck session={newSession()} />);
    choose("Tools", "Word count");
    const text = q("dialog dl").textContent!;
    expect(text).toContain("Slides3");
    expect(text).toContain("Words in speaker notes3");
  });

  it("inserts a picture by URL", async () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("Insert", "Image", "By URL…");
    setValue(byLabel("Image URL") as HTMLInputElement, "https://example.com/p.png");
    await runAsync(async () => {
      click(document.querySelector('dialog button[type="submit"]'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(s.deck.slides[0]!.elements.at(-1)).toMatchObject({ type: "image", src: "https://example.com/p.png" });
  });

  it("uploads a picture through the host's storage hook when given", async () => {
    const s = newSession();
    const upload = vi.fn(async () => "https://cdn.example/x.png");
    render(<PliDeck session={s} uploadImage={upload} />);
    const input = q<HTMLInputElement>('input[aria-label="Upload picture"]');
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1])], "x.png", { type: "image/png" })], configurable: true });
    await runAsync(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(upload).toHaveBeenCalled();
    expect(s.deck.slides[0]!.elements.at(-1)).toMatchObject({ type: "image", src: "https://cdn.example/x.png" });
  });
});
