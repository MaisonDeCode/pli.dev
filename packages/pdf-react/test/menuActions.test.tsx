// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { byLabel, chooseMenu, click, fire, flush, key, menuButton, q, qa, run } from "./harness";
import { chooseEdit, editPdf, mountEditor, useEditHost } from "./editHarness";
import { fixture } from "./formsHarness";
import { EDIT_TOOL } from "../src";
import { makePng } from "../../pdf/test/support/png";

useEditHost();

const tool = () => q(".pli-pdf").getAttribute("data-tool");
const annots = (session: { doc: { pages: { annots: { id: string; type: string }[] }[] } }) => session.doc.pages[0]!.annots;
const labelOf = (e: Element) => e.querySelector(".pli-menu-label")?.textContent ?? "";
const item = (label: string) => qa<HTMLButtonElement>("[role=menu] [role^=menuitem]", document).find((e) => labelOf(e) === label)!;
const sq = { type: "square", rect: { x: 100, y: 100, w: 100, h: 60 }, stroke: { color: "#000000", width: 1 } };

async function mount() {
  return mountEditor(editPdf(), { props: { users: undefined } });
}

describe("Insert menu: the tools", () => {
  it("puts the tool of each entry down, and shows which is down, the same as the ribbon", async () => {
    await mount();
    const cases: [string[], string][] = [
      [["Text box"], "text"],
      [["Shape", "Ellipse"], "ellipse"],
      [["Shape", "Polygon"], "polygon"],
      [["Drawing (pen)"], "ink"],
      [["Note"], "note"],
      [["Link"], "link"],
      [["Mark up text", "Highlight"], "highlight"],
      [["Mark up text", "Squiggly underline"], "squiggly"],
    ];
    for (const [path, id] of cases) {
      await chooseMenu("Insert", ...path);
      expect(tool(), path.join(" > ")).toBe(id);
      expect(q(`.pli-pdf-ribbon [data-tool='${id}']`)?.getAttribute("aria-pressed") ?? "true", path.join(" > ")).toBe("true");
    }
    // choosing the tool that is down puts it down (the menu and the ribbon do the same)
    await chooseMenu("Insert", "Mark up text", "Squiggly underline");
    expect(tool()).toBeNull();
    await click(menuButton("Insert"));
    await click(item("Mark up text"));
    expect(item("Squiggly underline").getAttribute("aria-checked")).toBe("false");
  });

  it("chooses a stamp, and opens the signature dialog", async () => {
    await mount();
    await chooseMenu("Insert", "Stamp", "Approved");
    expect(tool()).toBe("stamp");
    await chooseMenu("Insert", "Signature", "Create signature…");
    expect(document.querySelector(".pli-pdf-sig")).not.toBeNull();
  });

  it("adds a picture from a file", async () => {
    const { session } = await mount();
    const png = makePng({ width: 4, height: 4, colorType: 2, depth: 8, sample: () => [10, 200, 10] });
    const clicked = vi.spyOn(HTMLInputElement.prototype, "click");
    await chooseMenu("Insert", "Image…");
    // the menu opens the file chooser of the ribbon's picture button
    expect(clicked.mock.instances.map((i) => (i as unknown as HTMLInputElement).getAttribute("aria-label"))).toContain("Choose a picture");
    clicked.mockRestore();
    const input = q("input[aria-label='Choose a picture']") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "dot.png", type: "image/png", size: png.length, arrayBuffer: async () => png.slice().buffer as ArrayBuffer }] });
    await fire(input, new Event("change", { bubbles: true }));
    await flush(6);
    expect(annots(session).map((a) => a.type)).toContain("image");
  });

  it("starts a comment: with no text selected it puts the Note tool down, and the key does the same", async () => {
    await mount();
    await chooseMenu("Insert", "Comment");
    expect(tool()).toBe("note");
    await chooseMenu("Insert", "Note"); // put it down again
    expect(tool()).toBeNull();
    await key(q(".pli-pdf-scroller"), "m", { ctrlKey: true, altKey: true });
    expect(tool()).toBe("note");
    // the ribbon's button is the same command
    await chooseMenu("Insert", "Note");
    await click(byLabel("Comment on selection", q(".pli-pdf-ribbon")));
    expect(tool()).toBe("note");
  });

  it("starts a comment on the selected text: highlights it and opens the comment box", async () => {
    const { session, pageId } = await mount();
    const pick = vi.spyOn(window, "getSelection").mockReturnValue(null);
    pick.mockRestore();
    // The selection is read from the page's text layer; say what it holds.
    const spy = vi.spyOn(Object.getPrototypeOf(document.createElement("div")), "getBoundingClientRect").mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10, toJSON: () => ({}) }) as DOMRect);
    spy.mockRestore();
    const { AnnotController } = await import("../src");
    const original = AnnotController.prototype.readSelection;
    AnnotController.prototype.readSelection = () => [{ page: pageId, index: 0, text: "Quarterly", rects: [{ x: 72, y: 80, w: 100, h: 24 }] }] as never;
    try {
      await chooseMenu("Insert", "Comment");
    } finally {
      AnnotController.prototype.readSelection = original;
    }
    await flush();
    expect(annots(session).map((a) => a.type)).toEqual(["highlight"]);
    expect(document.querySelector(".pli-pdf-comment-popover")).not.toBeNull();
  });
});

describe("Edit menu: the annotations", () => {
  it("copies, pastes, duplicates, cuts and deletes the selected annotations, and selects them all", async () => {
    const { session, pageId } = await mount();
    await run(() => session.annots.add(pageId, sq as never));
    await flush();
    const count = () => annots(session).length;
    // Paste is off until something is copied
    await click(menuButton("Edit"));
    expect(item("Paste").disabled).toBe(true);
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await chooseMenu("Edit", "Copy");
    await chooseMenu("Edit", "Paste");
    expect(count()).toBe(2);
    await chooseMenu("Edit", "Duplicate");
    expect(count()).toBe(3);
    await chooseMenu("Edit", "Cut");
    expect(count()).toBe(2);
    await chooseMenu("Edit", "Select all annotations");
    expect(session.selection.annots).toHaveLength(2);
    await chooseMenu("Edit", "Delete");
    expect(count()).toBe(0);
    // and one undo brings the deletion back
    await chooseMenu("Edit", "Undo");
    expect(count()).toBe(2);
  });

  it("has Cut, Copy, Duplicate and Delete off with nothing selected", async () => {
    await mount();
    await click(menuButton("Edit"));
    for (const label of ["Cut", "Copy", "Duplicate", "Delete"]) expect(item(label).disabled, label).toBe(true);
    expect(item("Select all annotations").disabled).toBe(false);
  });
});

describe("View and Tools menus", () => {
  it("shows the links, the same as the ribbon button, and says so in both", async () => {
    await mount();
    await chooseMenu("View", "Show links");
    expect(byLabel("Show links", q(".pli-pdf-ribbon")).getAttribute("aria-pressed")).toBe("true");
    await click(menuButton("View"));
    expect(item("Show links").getAttribute("aria-checked")).toBe("true");
    await click(item("Show links"));
    expect(byLabel("Show links", q(".pli-pdf-ribbon")).getAttribute("aria-pressed")).toBe("false");
  });

  it("highlights the form fields (View) and opens the Form menu (Tools), Prepare form and the form field types", async () => {
    await mountEditor(fixture("forms-basic"), {});
    const pressed = () => qa(".pli-pdf-formbar button").find((b) => b.textContent === "Highlight fields")!.getAttribute("aria-pressed");
    const before = pressed();
    await chooseMenu("View", "Highlight form fields");
    expect(pressed()).not.toBe(before);
    await chooseMenu("Tools", "Prepare form");
    expect(q(".pli-pdf-designbar")).not.toBeNull();
    await click(menuButton("Tools"));
    expect(item("Prepare form").getAttribute("aria-checked")).toBe("true");
    await click(item("Prepare form"));
    expect(document.querySelector(".pli-pdf-designbar")).toBeNull();
    // the same switch is in the Form menu under Tools
    await chooseMenu("Tools", "Form", "Clear form");
    await chooseMenu("Insert", "Form field", "Check box");
    expect(q(".pli-pdf-designbar")).not.toBeNull();
    expect(q(".pli-pdf-designbar [aria-label='Check box']").getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the Redact tool down and the Edit tool, from Tools", async () => {
    await mount();
    await chooseMenu("Tools", "Redact", "Mark an area");
    expect(tool()).toBe("redact");
    await chooseMenu("Tools", "Edit text and pictures");
    await flush();
    expect(tool()).toBe(EDIT_TOOL);
    expect(byLabel("Edit text and pictures", q(".pli-pdf-ribbon")).getAttribute("aria-pressed")).toBe("true");
    await chooseMenu("Tools", "Edit text and pictures");
    expect(byLabel("Edit text and pictures", q(".pli-pdf-ribbon")).getAttribute("aria-pressed")).toBe("false");
    void chooseEdit;
    void fire;
  });

  it("leaves the tools out of the menus when the host leaves them out", async () => {
    await mountEditor(editPdf(), { props: { annotations: false, edit: false } });
    await click(menuButton("Tools"));
    expect(qa("[role=menu] [role^=menuitem]", document).map(labelOf)).toEqual(["Prepare form", "Form", "Organise pages…", "Find…", "Find and replace…", "Word count…"]);
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await click(menuButton("Insert"));
    expect(qa("[role=menu] [role^=menuitem]", document).map(labelOf)).toEqual(["Form field", "Blank page", "Pages from a file…"]);
  });
});
