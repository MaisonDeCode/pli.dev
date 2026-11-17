// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { annots, byLabel, click, flush, host, key, mount, q, qa, run, setValue, tap, useAnnotHost } from "./annotHarness";
import { chooseMenu, menuButton } from "./harness";
import { centre, chooseEdit, editPdf, mountEditor, runOf, typeIn, useEditHost } from "./editHarness";

useAnnotHost();
useEditHost();

const P0 = "p:main:0";
type A = Record<string, any>;
const bar = () => document.querySelector<HTMLElement>(".pli-pdf-formatbar");
const box = { type: "freetext", rect: { x: 100, y: 100, w: 160, h: 40 }, text: "Hello", style: { family: "Helvetica", size: 12, color: "#000000" } };
const get = (m: { session: { annots: { get(id: string): unknown } } }, id: string) => m.session.annots.get(id) as A;
const menuLabels = () => qa("[role=menu] [role^=menuitem]", document).map((e) => e.querySelector(".pli-menu-label")?.textContent ?? "");
const menuItem = (label: string) => qa<HTMLButtonElement>("[role=menu] [role^=menuitem]", document).find((e) => e.querySelector(".pli-menu-label")?.textContent === label)!;

async function withBox(extra: Record<string, unknown> = {}) {
  const m = await mount();
  const id = await run(() => m.session.annots.add(P0, { ...box, ...extra } as never));
  await flush();
  return { ...m, id };
}

describe("the text format bar of a text box", () => {
  it("shows only while a text box is selected, with the controls Docs has under its menus", async () => {
    const m = await mount();
    expect(bar()).toBeNull();
    const rect = await run(() => m.session.annots.add(P0, { type: "square", rect: { x: 10, y: 10, w: 50, h: 50 }, stroke: { color: "#000000", width: 1 } } as never));
    await flush();
    expect(bar()).toBeNull(); // a rectangle has no text
    const id = await run(() => m.session.annots.add(P0, box as never));
    await flush();
    expect(bar()).not.toBeNull();
    expect(bar()!.getAttribute("role")).toBe("toolbar");
    expect(bar()!.getAttribute("aria-label")).toBe("Text formatting");
    for (const label of ["Font", "Decrease font size", "Increase font size", "Bold", "Italic", "Text colour", "Fill colour", "Align left", "Align center", "Align right", "Border width"]) {
      expect(bar()!.querySelector(`[aria-label='${label}']`), label).not.toBeNull();
    }
    expect(bar()!.querySelector("input[aria-label='Font size']")).not.toBeNull();
    await run(() => m.c().clearSelection());
    await flush();
    expect(bar()).toBeNull();
    void rect;
    void id;
  });

  it("sets the font through the shared picker, the size with the box and the steps, and bold and italic", async () => {
    const m = await withBox();
    await click(byLabel("Font", bar()!));
    expect(document.querySelector(".pli-fonts")).not.toBeNull();
    const size = bar()!.querySelector<HTMLInputElement>("input[aria-label='Font size']")!;
    await setValue(size, "20");
    await key(size, "Enter");
    expect(get(m, m.id).style.size).toBe(20);
    await click(byLabel("Increase font size", bar()!));
    expect(get(m, m.id).style.size).toBe(24);
    await click(byLabel("Decrease font size", bar()!));
    await click(byLabel("Decrease font size", bar()!));
    expect(get(m, m.id).style.size).toBe(18);
    // a size outside the range is not taken
    await setValue(size, "900");
    await key(size, "Enter");
    expect(get(m, m.id).style.size).toBe(18);
    expect(size.value).toBe("18");
    await click(byLabel("Bold", bar()!));
    await click(byLabel("Italic", bar()!));
    expect(get(m, m.id).style).toMatchObject({ bold: true, italic: true });
    expect(byLabel("Bold", bar()!).getAttribute("aria-pressed")).toBe("true");
    // choices made one after another are one step of undo (as in the properties panel), and undo takes them back
    await run(() => m.session.undo());
    expect(get(m, m.id).style).toEqual({ family: "Helvetica", size: 12, color: "#000000" });
  });

  it("sets the text colour, the fill and the border, and the alignment", async () => {
    const m = await withBox();
    await click(byLabel("Text colour", bar()!));
    await click(byLabel("#ff0000", document));
    expect(get(m, m.id).style.color).toBe("#ff0000");
    await click(byLabel("Fill colour", bar()!));
    await click(byLabel("#ffff00", document));
    expect(get(m, m.id).fill).toBe("#ffff00");
    await click(byLabel("Fill colour", bar()!));
    await click(qa<HTMLButtonElement>(".pli-color-none", document).at(-1)!);
    expect(get(m, m.id).fill).toBeUndefined();
    await click(byLabel("Border width", bar()!));
    await click(menuItem("3 pt"));
    expect(get(m, m.id).stroke).toMatchObject({ width: 3 });
    await click(byLabel("Align right", bar()!));
    expect(get(m, m.id).style.align).toBe("right");
    expect(byLabel("Align right", bar()!).getAttribute("aria-pressed")).toBe("true");
    expect(byLabel("Align left", bar()!).getAttribute("aria-pressed")).toBe("false");
  });

  it("works on every selected text box at once, and not on a locked one", async () => {
    const m = await mount();
    const [a, b] = await run(() => [0, 1].map((i) => m.session.annots.add(P0, { ...box, rect: { x: 100, y: 100 + i * 60, w: 160, h: 40 } } as never, { select: false })));
    await run(() => m.c().select([a!, b!]));
    await flush();
    await click(byLabel("Bold", bar()!));
    expect([a, b].map((id) => get(m, id!).style.bold)).toEqual([true, true]);
    await run(() => m.session.annots.update(a!, { locked: true } as never));
    await flush();
    expect(bar()).toBeNull();
  });

  it("shows while the text box is being typed in, and what it changes is the box's", async () => {
    const m = await mount();
    await click(byLabel("Text box", host));
    await tap([100, 100]);
    await flush();
    const area = q("textarea.pli-pdf-text-editor", host) as HTMLTextAreaElement;
    expect(bar()).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, "Typed");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(byLabel("Bold", bar()!));
    await click(byLabel("Align center", bar()!));
    await key(area, "Escape");
    await flush();
    expect(annots(m.session)[0]).toMatchObject({ type: "freetext", text: "Typed", style: { bold: true, align: "center" } });
  });

  it("has the keys Ctrl+B and Ctrl+I for the selected box and while typing in it", async () => {
    const m = await withBox();
    await key(q(".pli-pdf-scroller", host), "b", { ctrlKey: true });
    expect(get(m, m.id).style.bold).toBe(true);
    await key(q(".pli-pdf-scroller", host), "i", { metaKey: true });
    expect(get(m, m.id).style.italic).toBe(true);
    await key(q(".pli-pdf-scroller", host), "b", { ctrlKey: true });
    expect(get(m, m.id).style.bold).toBeUndefined();
    expect(byLabel("Bold", bar()!).getAttribute("title")).toContain("Ctrl+B");
    // while typing: the keys go to the box
    await run(() => m.c().beginEdit(P0, get(m, m.id) as never, false));
    await flush();
    const area = q("textarea.pli-pdf-text-editor", host);
    await key(area, "b", { ctrlKey: true });
    expect(get(m, m.id).style.bold).toBe(true);
  });

  it("is for the next text box when the Text box tool is on and nothing is selected, and remembers what was chosen", async () => {
    const m = await mount();
    expect(bar()).toBeNull();
    await click(byLabel("Text box", host));
    expect(bar()).not.toBeNull();
    await click(byLabel("Italic", bar()!));
    await click(byLabel("Align center", bar()!));
    const size = bar()!.querySelector<HTMLInputElement>("input[aria-label='Font size']")!;
    await setValue(size, "30");
    await key(size, "Enter");
    expect(m.c().style("text")).toMatchObject({ italic: true, align: "center", size: 30 });
    await tap([100, 100]);
    await flush();
    const area = q("textarea.pli-pdf-text-editor", host) as HTMLTextAreaElement;
    expect(area.style.fontSize).toBe("30px");
    expect(area.style.fontStyle).toBe("italic");
  });

  it("is not there in a read-only viewer", async () => {
    const m = await mount({ kit: { readOnly: true } });
    await run(() => m.session.annots.add(P0, box as never));
    await flush();
    expect(bar()).toBeNull();
  });
});

describe("Format menu", () => {
  it("has its entries disabled until there is something to format, then does the same as the bar", async () => {
    const m = await mount();
    await click(menuButton("Format"));
    expect(menuLabels()).toEqual(["Text", "Align text", "Border width", "Arrange"]);
    expect(menuItem("Text").disabled).toBe(false); // a submenu opens even when its entries are off
    await click(menuItem("Text"));
    expect(menuItem("Bold").disabled).toBe(true);
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    await run(() => m.session.annots.add(P0, box as never));
    await flush();
    await chooseMenu("Format", "Text", "Bold");
    expect(get(m, annots(m.session)[0]!.id).style.bold).toBe(true);
    await chooseMenu("Format", "Text", "Increase font size");
    expect(annots(m.session)[0]).toMatchObject({ style: { size: 14 } });
    await chooseMenu("Format", "Align text", "Right");
    expect(annots(m.session)[0]).toMatchObject({ style: { align: "right" } });
    await chooseMenu("Format", "Border width", "2 pt");
    expect(annots(m.session)[0]).toMatchObject({ stroke: { width: 2 } });
    // the bar shows the same state
    expect(byLabel("Bold", bar()!).getAttribute("aria-pressed")).toBe("true");
    await click(menuButton("Format"));
    await click(menuItem("Text"));
    expect(menuItem("Bold").getAttribute("aria-checked")).toBe("true");
  });

  it("arranges the selection: order and lock", async () => {
    const m = await mount();
    const [a, b] = await run(() => [0, 1].map((i) => m.session.annots.add(P0, { type: "square", rect: { x: 100 + i * 20, y: 100, w: 100, h: 60 }, stroke: { color: "#000000", width: 1 } } as never, { select: false })));
    await run(() => m.c().select([a!]));
    await flush();
    await chooseMenu("Format", "Arrange", "Bring to front");
    expect(annots(m.session).map((x) => x.id)).toEqual([b, a]);
    await chooseMenu("Format", "Arrange", "Lock");
    expect(get(m, a!).locked).toBe(true);
    await click(menuButton("Format"));
    await click(menuItem("Arrange"));
    expect(menuItem("Unlock")).toBeTruthy();
  });
});

describe("the text bar of the Edit tool", () => {
  it("shows font, size, bold, italic and colour for the text selected with the tool, and nothing the page's text cannot have", async () => {
    const { session } = await mountEditor(editPdf(), { props: { edit: { fonts: false } } });
    expect(bar()).toBeNull();
    await chooseEdit();
    expect(bar()).toBeNull(); // the tool is on, nothing is picked
    const { tap: tapPage } = await import("./annotHarness");
    await tapPage(centre((await runOf(session, "Revenue grew by ten percent")).box));
    await flush();
    expect(bar()!.getAttribute("data-target")).toBe("edit");
    for (const label of ["Font", "Font size", "Bold", "Italic", "Text colour"]) expect(bar()!.querySelector(`[aria-label='${label}']`), label).not.toBeNull();
    for (const label of ["Fill colour", "Align left", "Border width"]) expect(bar()!.querySelector(`[aria-label='${label}']`), label).toBeNull();
    await click(bar()!.querySelector("[aria-label='Bold']"));
    await click(bar()!.querySelector("[aria-label='Increase font size']"));
    const ta = document.querySelector<HTMLTextAreaElement>(".pli-edit-editor")!;
    await typeIn(ta, "Revenue grew a lot");
    await key(ta, "Enter");
    await flush();
    expect(session.doc.pages[0]!.edits![0]).toMatchObject({ type: "text", text: "Revenue grew a lot", bold: true, size: 14 });
    // Format > Text works on it too, and has no alignment or border for it
    await chooseMenu("Format", "Text", "Italic");
    await flush();
    expect(session.doc.pages[0]!.edits![0]).toMatchObject({ italic: true });
    await click(menuButton("Format"));
    expect(menuItem("Align text").disabled).toBe(true);
    expect(menuItem("Border width").disabled).toBe(true);
  });
});
