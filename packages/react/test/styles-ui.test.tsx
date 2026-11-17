// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentSession, createDoc, image, listItem, paragraph, text, type Doc, type DocStyle } from "@pli.dev/docs";
import { DocumentView } from "../src/render";
import { PliDocument } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note: DocStyle = { name: "Note", kind: "paragraph", marks: { italic: true, color: "#336699", fontSize: 13 }, align: "center", format: { spaceAfter: 18, indentLeft: 36 } };
const loud: DocStyle = { name: "Loud", kind: "character", marks: { bold: true, color: "#cc0000" } };

const withStyles = (doc: Doc): Doc => ({ ...doc, styles: { note, loud } });
const html = (doc: Doc) => renderToStaticMarkup(<DocumentView doc={doc} />);

describe("drawing styled text", () => {
  it("gives a paragraph its style's alignment and spacing, and its text the style's look", () => {
    const out = html(withStyles(createDoc("T", [{ ...paragraph("Careful"), style: "note" }])));
    expect(out).toContain("text-align:center");
    expect(out).toContain("margin-bottom:18pt");
    expect(out).toContain("margin-left:36pt");
    expect(out).toContain("<em>Careful</em>");
    expect(out).toContain("color:#336699");
    expect(out).toContain("font-size:13pt");
  });

  it("lets the paragraph's own settings and the text's own marks win", () => {
    const out = html(withStyles(createDoc("T", [{ ...paragraph([text("Careful", { color: "#000000", italic: false })]), style: "note", align: "right" }])));
    expect(out).toContain("text-align:right");
    expect(out).not.toContain("<em>");
    expect(out).not.toContain("#336699");
  });

  it("draws a character style on the text that has it", () => {
    const out = html(withStyles(createDoc("T", [paragraph([text("plain "), text("loud", { style: "loud" })])])));
    expect(out).toContain("<strong>loud</strong>");
    expect(out).toContain("color:#cc0000");
    expect(out).toContain("plain ");
  });

  it("keeps the model's text exactly, so selections still line up", () => {
    const out = html(withStyles(createDoc("T", [{ ...paragraph([text("Hello "), text("world", { style: "loud" })]), style: "note" }])));
    expect(out.replace(/<[^>]*>/g, "")).toBe("Hello world");
  });

  it("draws a block that points at a missing style plainly", () => {
    const out = html({ ...createDoc("T", [{ ...paragraph("x"), style: "gone" }]), styles: { note } });
    expect(out).not.toContain("text-align");
  });

  it("draws the document without styles as before", () => {
    expect(html(createDoc("T", [paragraph("x")]))).toMatch(/^<p data-block-id="[^"]+" data-type="paragraph">x<\/p>$/);
  });
});

describe("the editor's style controls", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    // jsdom has no modal dialogs.
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const setup = () => {
    const session = new DocumentSession(withStyles(createDoc("T", [paragraph("Hello world")])));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 5 } });
    act(() => root.render(<PliDocument session={session} />));
    return session;
  };
  const choose = (select: HTMLSelectElement, value: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      set.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

  it("lists the document's paragraph styles in the style box and applies one", () => {
    const session = setup();
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Paragraph style"]')!;
    const options = [...select.querySelectorAll("optgroup option")].map((o) => o.textContent);
    expect(options).toEqual(["Note"]);
    choose(select, "style:note");
    expect(session.state.blocks[0]).toMatchObject({ style: "note" });
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Paragraph style"]')!.value).toBe("style:note");
  });

  it("goes back to a built-in style when one is picked, taking the custom style off", () => {
    const session = setup();
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Paragraph style"]')!, "style:note");
    choose(host.querySelector<HTMLSelectElement>('select[aria-label="Paragraph style"]')!, "h1");
    expect(session.state.blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(session.state.blocks[0]).not.toHaveProperty("style");
  });

  it("offers the styles in the Format menu, and applies a character style to the selected text", () => {
    const session = setup();
    const format = [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "Format")!;
    act(() => void format.click());
    const submenu = [...host.querySelectorAll<HTMLElement>(".pli-menu-list button")].find((b) => b.textContent?.includes("Your styles"))!;
    act(() => void submenu.click());
    const labels = [...host.querySelectorAll(".pli-menu-list .pli-menu-label")].map((l) => l.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Note", "Loud (text)", "Manage styles…"]));
    const loudItem = [...host.querySelectorAll<HTMLElement>(".pli-menu-list button")].find((b) => b.textContent?.includes("Loud (text)"))!;
    act(() => void loudItem.click());
    expect((session.state.blocks[0] as { runs: { marks?: { style?: string } }[] }).runs[0]!.marks?.style).toBe("loud");
  });

  it("makes a style from the selection through the dialog", () => {
    const session = new DocumentSession(createDoc("T", [{ ...paragraph([text("Styled", { italic: true })]), align: "center" }]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 6 } });
    act(() => root.render(<PliDocument session={session} />));
    const format = [...host.querySelectorAll<HTMLButtonElement>(".pli-menubar-button")].find((b) => b.textContent === "Format")!;
    act(() => void format.click());
    act(() => void [...host.querySelectorAll<HTMLElement>(".pli-menu-list button")].find((b) => b.textContent?.includes("Your styles"))!.click());
    act(() => void [...host.querySelectorAll<HTMLElement>(".pli-menu-list button")].find((b) => b.textContent?.includes("New paragraph style"))!.click());
    const input = host.querySelector<HTMLInputElement>('dialog input[type="text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fancy");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => void host.querySelector<HTMLFormElement>("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(session.state.styles?.fancy).toMatchObject({ name: "Fancy", kind: "paragraph", marks: { italic: true }, align: "center" });
    expect(session.state.blocks[0]).toMatchObject({ style: "fancy" });
  });
});

describe("wrapping text around a picture", () => {
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

  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("is marked on the picture's figure, for the page's CSS to float", () => {
    const doc = { ...createDoc("T", [{ ...image(PNG, { width: 10, height: 10 }), wrap: "right" as const }, paragraph("x")]) };
    expect(renderToStaticMarkup(<DocumentView doc={doc} />)).toMatch(/<figure [^>]*data-wrap="right"/);
    expect(renderToStaticMarkup(<DocumentView doc={createDoc("T", [image(PNG, { width: 10, height: 10 })])} />)).not.toContain("data-wrap");
  });

  it("has a control that appears when a picture is selected, and sets the wrap", () => {
    const session = new DocumentSession(createDoc("T", [image(PNG, { width: 10, height: 10 }), paragraph("text")]));
    const text = session.state.blocks[1]!.id;
    session.select({ anchor: { block: text, offset: 0 }, focus: { block: text, offset: 0 } });
    act(() => root.render(<PliDocument session={session} />));
    expect(host.querySelector('[aria-label="Picture options"]')).toBeNull();
    act(() => session.select({ anchor: { block: session.state.blocks[0]!.id, offset: 0 }, focus: { block: session.state.blocks[0]!.id, offset: 0 } }));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Picture options"]')!;
    expect(button).not.toBeNull();
    act(() => void button.click());
    const item = [...host.querySelectorAll<HTMLElement>(".pli-menu-list button")].find((b) => b.textContent?.includes("picture on the left"))!;
    act(() => void item.click());
    expect(session.state.blocks[0]).toMatchObject({ wrap: "left" });
  });

  it("crops a picture to a shape from the picture menu, and shows all of it while the crop is being set", () => {
    const session = new DocumentSession(createDoc("T", [image(PNG, { width: 400, height: 200 }), paragraph("text")]));
    const id = session.state.blocks[0]!.id;
    session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });
    act(() => root.render(<PliDocument session={session} />));
    const open = () => act(() => void host.querySelector<HTMLButtonElement>('[aria-label="Picture options"]')!.click());
    const choose = (text: string) => act(() => void [...host.querySelectorAll<HTMLElement>(".pli-menu-list button, .pli-menu-list [role^=menuitem]")].find((b) => b.textContent?.trim() === text)!.click());
    open();
    choose("Crop");
    expect(session.croppingImage).toBe(id);
    expect(host.querySelectorAll(".pli-crop-handle").length).toBe(4);
    // The cropped picture is drawn inside a box that hides the rest of it.
    act(() => void session.cropImage(id, { top: 0, bottom: 0, left: 0.25, right: 0 }, { rescale: true }));
    act(() => void session.setCropping(false));
    expect(host.querySelector(".pli-image-frame span[style*='overflow']")).not.toBeNull();
    expect(session.state.blocks[0]).toMatchObject({ width: 300, height: 200 });
  });
});

describe("numbering a list", () => {
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

  const items = () => listLabelsOf(host);
  const listLabelsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-type="list_item"]')].map((e) => e.getAttribute("data-marker"));

  it("draws the marker a list item names, and counts from its start", () => {
    const doc = createDoc("T", [
      { ...listItem("ordered", "a"), marker: "upper-roman" as const },
      { ...listItem("ordered", "b"), marker: "upper-roman" as const },
      { ...listItem("ordered", "c"), marker: "upper-roman" as const, start: 7 },
    ]);
    const html = renderToStaticMarkup(<DocumentView doc={doc} />);
    expect([...html.matchAll(/data-marker="([^"]*)"/g)].map((m) => m[1])).toEqual(["I.", "II.", "VII."]);
  });

  it("has a list menu that appears in a list, restarts numbering and changes the style", () => {
    const session = new DocumentSession(createDoc("T", [paragraph("plain"), listItem("ordered", "a"), listItem("ordered", "b")]));
    const place = (n: number) => session.select({ anchor: { block: session.state.blocks[n]!.id, offset: 0 }, focus: { block: session.state.blocks[n]!.id, offset: 0 } });
    place(0);
    act(() => root.render(<PliDocument session={session} />));
    expect(host.querySelector('[aria-label="List style and numbering"]')).toBeNull();
    act(() => place(2));
    const open = () => act(() => void host.querySelector<HTMLButtonElement>('[aria-label="List style and numbering"]')!.click());
    const pick = (text: string) => act(() => void [...host.querySelectorAll<HTMLElement>(".pli-menu-list button")].find((b) => b.textContent?.includes(text))!.click());
    open();
    pick("Restart at 1");
    expect(session.state.blocks[2]).toMatchObject({ start: 1 });
    open();
    pick("A. B. C.");
    expect(items()).toEqual(["A.", "A."]);
    open();
    pick("Continue numbering");
    expect(items()).toEqual(["A.", "B."]);
  });
});

describe("a header or footer that isn't being edited", () => {
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

  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("is drawn and measured inside the same kind of editor surface as the one it is edited in, so all three are the same size", () => {
    const doc = { ...createDoc("T", [paragraph("body")]), header: [paragraph("Report"), image(PNG, { width: 40, height: 20 })] };
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    try {
      act(() => root.render(<PliDocument session={new DocumentSession(doc)} />));
    } finally {
      globalThis.ResizeObserver = original;
    }
    // The page's copy, and the invisible copy that tells the page how much room to leave. Without the surface, a picture
    // keeps the browser's own margins on a figure and is squeezed, and paragraphs have gaps the editor doesn't.
    expect(host.querySelector(".pli-region-zone[data-kind='header'] .pli-region > .pli-editor.pli-region-editor")).not.toBeNull();
    expect(host.querySelector(".pli-measure.pli-region > .pli-editor.pli-region-editor")).not.toBeNull();
  });
});

describe("File > Download in an app that saves files itself", () => {
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

  it("gives each file to onDownload, with its name, type and bytes, instead of downloading it", async () => {
    const files: { name: string; type: string; data: Uint8Array }[] = [];
    const session = new DocumentSession(createDoc("Report", [paragraph("Hello")]));
    act(() => root.render(<PliDocument session={session} onDownload={(file) => void files.push(file)} />));
    const click = (match: (b: HTMLElement) => boolean) => act(() => void [...host.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(match)!.click());
    const fileMenu = (b: HTMLElement) => b.textContent?.trim().startsWith("File") ?? false;
    click(fileMenu);
    click((b) => b.textContent?.startsWith("Download") ?? false);
    click((b) => b.textContent?.includes("DOCX document") ?? false);
    await act(async () => {});
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "Report.docx", type: expect.stringContaining("wordprocessingml") });
    expect([files[0]!.data[0], files[0]!.data[1]]).toEqual([0x50, 0x4b]);
  });
});

describe("the toolbar on a phone", () => {
  let host: HTMLElement;
  let root: Root;
  const original = window.matchMedia;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.matchMedia = original;
  });

  const phone = (matches: boolean) => {
    window.matchMedia = ((query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  };
  const labels = () => {
    act(() => void host.querySelector<HTMLButtonElement>('[aria-label="More formatting"]')!.click());
    return [...host.querySelectorAll<HTMLElement>(".pli-menu-list button, .pli-menu-list [role=menuitem]")].map((b) => b.textContent?.trim());
  };

  it("has the layout and zoom in its More menu, and the status bar leaves them out", () => {
    phone(true);
    act(() => root.render(<PliDocument session={new DocumentSession(createDoc("T", [paragraph("x")]))} />));
    expect(host.querySelector('.pli-status [aria-label="Layout"]')).toBeNull();
    const items = labels();
    const joined = items.join("|");
    expect(joined).toContain("Pageless");
    expect(joined).toContain("Zoom");
    act(() => void [...host.querySelectorAll<HTMLElement>(".pli-menu-list button")].find((b) => b.textContent?.trim() === "Pageless")!.click());
    expect(host.querySelector(".pli-sheet-continuous, [data-view='continuous']")).not.toBeNull();
  });

  it("keeps the layout switch in the status bar, and out of the menu, on a wide screen", () => {
    phone(false);
    act(() => root.render(<PliDocument session={new DocumentSession(createDoc("T", [paragraph("x")]))} />));
    expect(host.querySelector('.pli-status [aria-label="Layout"]')).not.toBeNull();
    expect(labels().join("|")).not.toContain("Pageless");
  });

  it("shows the layout switch in the status bar on a phone when there is no toolbar to hold it", () => {
    phone(true);
    act(() => root.render(<PliDocument session={new DocumentSession(createDoc("T", [paragraph("x")]))} toolbar={false} />));
    expect(host.querySelector('.pli-status [aria-label="Layout"]')).not.toBeNull();
  });

  it("orders the toolbar's groups so the most used come first, with the menu pinned last", () => {
    act(() => root.render(<PliDocument session={new DocumentSession(createDoc("T", [paragraph("x")]))} />));
    const groups = [...host.querySelectorAll<HTMLElement>(".pli-toolbar [data-group]")].map((g) => g.dataset.group);
    expect(groups).toEqual(["history", "style", "marks", "insert", "align", "list", "more"]);
  });
});

describe("the toolbar docked above the keyboard on a phone", () => {
  let host: HTMLElement;
  let root: Root;
  const originalMedia = window.matchMedia;
  const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const originalHeight = window.innerHeight;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.matchMedia = originalMedia;
    if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
    else delete (window as { visualViewport?: unknown }).visualViewport;
    Object.defineProperty(window, "innerHeight", { value: originalHeight, configurable: true });
  });

  const phone = (matches: boolean) => {
    window.matchMedia = ((query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  };
  const viewport = (height: number) => {
    const listeners: Record<string, () => void> = {};
    const fake = { height, offsetTop: 0, scale: 1, addEventListener: (type: string, fn: () => void) => void (listeners[type] = fn), removeEventListener() {} };
    Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    return { set: (h: number) => { fake.height = h; listeners.resize?.(); } };
  };
  const render = () => act(() => root.render(<PliDocument session={new DocumentSession(createDoc("T", [paragraph("x")]))} />));

  it("sits at the bottom of the editor, below the page and the status bar, instead of at the top", () => {
    phone(true);
    render();
    const children = [...host.querySelector(".pli-document")!.children].map((c) => c.className.split(" ")[0]);
    expect(host.querySelector(".pli-chrome .pli-toolbar")).toBeNull();
    expect(children.indexOf("pli-toolbar")).toBeGreaterThan(children.indexOf("pli-body"));
    expect(children.indexOf("pli-toolbar")).toBeGreaterThan(children.indexOf("pli-status"));
    expect(host.querySelector(".pli-toolbar")?.classList.contains("pli-toolbar-docked")).toBe(true);
  });

  it("stays at the top on a wide screen", () => {
    phone(false);
    render();
    expect(host.querySelector(".pli-chrome .pli-toolbar")).not.toBeNull();
    expect(host.querySelector(".pli-toolbar-docked")).toBeNull();
  });

  it("fits the editor to what a keyboard leaves, and goes back when it closes", () => {
    phone(true);
    const keyboard = viewport(800);
    render();
    const editor = () => host.querySelector<HTMLElement>(".pli-document")!;
    expect(editor().hasAttribute("data-keyboard")).toBe(false);
    act(() => keyboard.set(480));
    expect(editor().hasAttribute("data-keyboard")).toBe(true);
    expect(editor().style.position).toBe("fixed");
    expect(editor().style.height).toBe("480px");
    act(() => keyboard.set(800));
    expect(editor().hasAttribute("data-keyboard")).toBe(false);
    expect(editor().style.position).toBe("");
  });

  it("does not take a little change of the visible area for a keyboard", () => {
    phone(true);
    const keyboard = viewport(800);
    render();
    act(() => keyboard.set(740));
    expect(host.querySelector(".pli-document")!.hasAttribute("data-keyboard")).toBe(false);
  });
});
