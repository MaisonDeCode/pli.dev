// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Users } from "@pli.dev/core";
import { makeSamplePdf, openPdf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor, type PdfEditorProps } from "../src";
import { fakeRenderer } from "../src/testing";
import { byLabel, click, flush, host, key, menuButton, q, qa, render, run, useHost } from "./harness";
import { stubDialogs, viewport } from "./pagesSupport";

useHost();
stubDialogs();

/**
 * Every bar of the editor is checked the same way: no two buttons in one bar draw the same picture (so a person can tell them
 * apart), and every button has a tooltip and a name for a screen reader (its `aria-label` or visible text).
 */

async function mount(props: Partial<PdfEditorProps> = {}) {
  const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf", user: { id: "u1", name: "Ana Reyes" } });
  const users = new Users({ id: "u1", name: "Ana Reyes" });
  await render(
    <PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={viewport} defaultZoom={1} users={users} comments onSave={() => undefined} onOpen={() => undefined} onShare={() => undefined} annotations={{ storageKey: "" }} {...props} />,
  );
  await flush();
  return session;
}

/** What a control draws: the markup of its picture, or null when it has none (text, a colour dot). */
const picture = (el: Element): string | null => {
  const svg = el.querySelector("svg");
  return svg ? svg.innerHTML : null;
};

const nameOf = (el: Element) => el.getAttribute("aria-label") || el.textContent?.trim() || "";

/** The controls of a bar: buttons (and the buttons that open menus), tabs. Inputs are checked for a name only. */
const controlsOf = (bar: Element) => [...bar.querySelectorAll<HTMLElement>("button, [role=tab]")].filter((b) => !b.closest("[role=menu], .pli-panel"));

function check(barName: string, bar: Element | null) {
  expect(bar, `${barName} is there`).not.toBeNull();
  const controls = controlsOf(bar!);
  expect(controls.length, `${barName} has controls`).toBeGreaterThan(0);
  const seen = new Map<string, string>();
  for (const c of controls) {
    const name = nameOf(c);
    expect(name, `${barName}: a control with no name (${c.outerHTML.slice(0, 120)})`).not.toBe("");
    expect(c.getAttribute("title") ?? "", `${barName}: "${name}" has no tooltip`).not.toBe("");
    const pic = picture(c);
    if (pic === null) continue;
    const other = seen.get(pic);
    expect(other, `${barName}: "${name}" draws the same picture as "${other}"`).toBeUndefined();
    seen.set(pic, name);
  }
  for (const input of bar!.querySelectorAll<HTMLElement>("input:not([type=hidden]), select")) {
    expect(nameOf(input) || input.getAttribute("aria-label") || input.closest("label")?.textContent, `${barName}: an input with no name`).toBeTruthy();
  }
  return controls.map(nameOf);
}

describe("the bars of the editor", () => {
  it("sidebar tabs: one picture each, Annotations and Edits apart from each other", async () => {
    await mount();
    const names = check("sidebar tabs", q(".pli-pdf-tabs"));
    expect(names).toEqual(["Thumbnails", "Outline", "Comments", "Annotations", "Edits"]);
    // the Version history tab is a different picture again
    expect(q("#pli-pdf-tab-edits svg").innerHTML).not.toBe(q("#pli-pdf-tab-annotations svg").innerHTML);
    const picture = (id: string) => q(`#pli-pdf-tab-${id} svg`).innerHTML;
    expect(picture("annotations")).not.toBe(picture("edits"));
    // the Outline is a tree, not a plain list of lines: it has the square of a parent
    expect(q("#pli-pdf-tab-outline svg").querySelector("rect")).not.toBeNull();
  });

  it("sidebar tabs with a Version history tab: still one picture each", async () => {
    const { VersionHistory, memoryVersionStorage } = await import("@pli.dev/core");
    const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });
    const users = new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
    const history = new VersionHistory({ file: "f", session: session.core as never, storage: memoryVersionStorage<never>(), users, hash: () => "h", support: { restoreOps: () => [] } });
    await history.ready;
    await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={viewport} history={history as never} />);
    await flush();
    expect(check("sidebar tabs", q(".pli-pdf-tabs"))).toContain("History");
  });

  it("status bar: the page box and the zoom, the only bar of the viewer itself that is always there", async () => {
    await mount();
    expect(q(".pli-pdf-toolbar")).toBeNull();
    const names = check("status bar", q(".pli-pdf-statusbar"));
    expect(names).toEqual(expect.arrayContaining(["Zoom out", "Zoom", "Zoom in"]));
    expect(q<HTMLInputElement>(".pli-pdf-statusbar input").getAttribute("aria-label")).toBe("Page number");
  });

  it("toolbar (topToolbar)", async () => {
    await mount({ topToolbar: true });
    expect(q(".pli-pdf-statusbar")).toBeNull(); // the toolbar has the page box and the zoom
    const names = check("toolbar", q(".pli-pdf-toolbar"));
    for (const want of ["Sidebar", "Undo", "Redo", "Print", "Previous page", "Next page", "Zoom out", "Zoom", "Zoom in", "Fit width", "Page layout", "Rotate view", "Find", "Full screen", "Properties", "Save"]) {
      expect(names, want).toContain(want);
    }
  });

  it("title row: Comments and Share, with the name of the document", async () => {
    await mount();
    const names = check("title row", q(".pli-pdf-titlebar"));
    expect(names).toEqual(expect.arrayContaining(["Comments", "Share"]));
    expect(q(".pli-titlebar .pli-share-button")).not.toBeNull(); // the shared Share button
  });

  it("ribbon", async () => {
    await mount();
    const names = check("ribbon", q(".pli-pdf-ribbon"));
    for (const want of ["Select", "Highlight", "Underline", "Strikethrough", "Squiggly underline", "Pen", "Eraser", "Shapes", "Text box", "Note", "Comment on selection", "Stamps", "Signature", "Picture", "Link", "Redact", "Redaction options", "Edit text and pictures", "Show links"]) {
      expect(names, want).toContain(want);
    }
    // the ribbon has no undo and redo: they are in the Edit menu (and in the toolbar, with topToolbar)
    expect(names).not.toContain("Undo");
  });

  it("text bar, with a text box selected", async () => {
    const session = await mount();
    await run(() => session.annots.add(session.doc.pages[0]!.id, { type: "freetext", rect: { x: 100, y: 300, w: 160, h: 40 }, text: "Hi", style: { family: "Helvetica", size: 12, color: "#000000" } } as never));
    await flush();
    const names = check("text bar", document.querySelector(".pli-pdf-formatbar"));
    expect(names).toEqual(expect.arrayContaining(["Font", "Decrease font size", "Increase font size", "Bold", "Italic", "Text colour", "Fill colour", "Align left", "Align center", "Align right", "Border width"]));
  });

  it("form bar and the Prepare form tools", async () => {
    await mount({ topToolbar: true });
    const fill = check("form bar", q(".pli-pdf-formbar"));
    expect(fill).toEqual(expect.arrayContaining(["Highlight fields", "Clear form", "Flatten…"]));
    await click(byLabel("Prepare form", q(".pli-pdf-toolbar")));
    const design = check("Prepare form bar", q(".pli-pdf-designbar"));
    expect(design).toEqual(expect.arrayContaining(["Text field", "Multi-line text", "Check box", "Radio group", "Drop-down", "List box", "Signature field", "Button", "Duplicate field", "Delete field", "Show tab order"]));
    // the toolbar: Form (a menu) and Prepare form are two different pictures, and neither is a field type
    check("toolbar with Prepare form", q(".pli-pdf-toolbar"));
  });

  it("page tools above the thumbnails", async () => {
    await mount();
    const names = check("page tools", q(".pli-pdf-pagebar"));
    expect(names).toEqual(expect.arrayContaining(["Turn pages anticlockwise", "Turn pages clockwise", "Delete pages", "Duplicate pages", "Insert a blank page after", "Organise pages", "More page tools"]));
  });

  it("find bar, with replace", async () => {
    await mount();
    await key(q(".pli-pdf-scroller"), "h", { ctrlKey: true });
    const names = check("find bar", q(".pli-pdf-find"));
    expect(names).toEqual(expect.arrayContaining(["Previous match", "Next match", "Match case", "Whole words", "Show replace", "Redact all matches", "Close find", "Replace", "Replace all"]));
  });

  it("every menu entry has a name, and a menu has no entry twice", async () => {
    await mount();
    for (const menu of ["File", "Edit", "View", "Insert", "Format", "Tools", "Help"]) {
      await click(menuButton(menu));
      for (const entry of qa("[role=menu] [aria-haspopup=menu]", document)) await click(entry);
      for (const list of qa("[role=menu]", document)) {
        const labels = [...list.querySelectorAll(":scope > li > button .pli-menu-label")].map((l) => l.textContent!);
        expect(labels.every((l) => l.trim() !== ""), `${menu}: an entry with no name`).toBe(true);
        expect(new Set(labels).size, `${menu}: ${labels.join(", ")}`).toBe(labels.length);
      }
      await key(document.body, "Escape");
    }
    void host;
  });

  it("the same checks hold on a phone-width editor", async () => {
    await mount({ hostWidth: 360 });
    check("status bar (phone)", q(".pli-pdf-statusbar"));
    await render(<div />);
    await mount({ hostWidth: 360, topToolbar: true });
    check("toolbar (phone)", q(".pli-pdf-toolbar"));
    check("ribbon (phone)", q(".pli-pdf-ribbon"));
  });

  it("a bar of a viewer that cannot change has no editing controls, and its controls are still named", async () => {
    const session: PdfSession = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });
    await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={viewport} defaultZoom={1} readOnly topToolbar />);
    await flush();
    const names = check("toolbar (read only)", q(".pli-pdf-toolbar"));
    expect(names).not.toContain("Undo");
    expect(names).not.toContain("Save");
    expect(names).toContain("Print");
    check("title row (read only)", q(".pli-pdf-titlebar"));
  });
});
