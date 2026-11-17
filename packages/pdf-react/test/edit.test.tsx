// @vitest-environment jsdom
// Edit text and pictures in the editor: click text to retype it, see the change on the page, list and take back changes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createFonts, type FontEnv, type FontSource } from "@pli.dev/core";
import { EDIT_TOOL, editorFrame, editorPoint, layerTransform, pageContent, runLength, CSS_UNITS } from "../src";
import { saveBytes } from "../src/saving";
import { renderPdf } from "../../pdf/test/support/render";
import { openPdf } from "@pli.dev/pdf";
import { bluePng, blueUri, byLabel, centre, chooseMenu, chooseEdit, click, clientOf, editButton, editPdf, editor, fire, flush, host, key, layerOf, mountEditor, pointer, q, qa, run, runOf, saveFile, tap, typeIn, useEditHost } from "./editHarness";

useEditHost();

describe("the Edit tool: text", () => {
  it("puts the tool on from its button and from the Q key, and shows a box round every piece of text", async () => {
    const { session } = await mountEditor(editPdf());
    expect(editButton().getAttribute("aria-pressed")).toBe("false");
    await click(editButton());
    expect(q(".pli-pdf").getAttribute("data-tool")).toBe(EDIT_TOOL);
    expect(editButton().getAttribute("aria-pressed")).toBe("true");
    await flush();
    const boxes = qa(".pli-edit-run");
    expect(boxes.length).toBe((await session.content.runs(session.doc.pages[0]!.id)).length);
    expect(qa(".pli-edit-run[data-locked]").length).toBe(2); // Type 3 and invisible text
    await click(editButton());
    expect(q(".pli-pdf").getAttribute("data-tool")).toBeNull();
    await key(q(".pli-pdf-scroller"), "q");
    expect(q(".pli-pdf").getAttribute("data-tool")).toBe(EDIT_TOOL);
    await key(q(".pli-pdf-scroller"), "q");
    expect(q(".pli-pdf").getAttribute("data-tool")).toBeNull();
  });

  it("highlights the text under the pointer", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const r = await runOf(session, "Quarterly report");
    const at = clientOf(...centre(r.box));
    await pointer(layerOf(), "pointermove", at, {});
    const hot = qa(".pli-edit-run[data-hover]");
    expect(hot).toHaveLength(1);
    expect(hot[0]!.getAttribute("data-run")).toBe(r.id);
    await pointer(layerOf(), "pointermove", clientOf(5, 5), {});
    expect(qa(".pli-edit-run[data-hover]")).toHaveLength(0);
  });

  it("opens an editor on the clicked text, in its own size, and Enter keeps the new text as one undoable change", async () => {
    const { session, pageId } = await mountEditor(editPdf());
    await chooseEdit();
    const r = await runOf(session, "Revenue grew by ten percent");
    await tap(centre(r.box));
    await flush();
    const ta = editor()!;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe("Revenue grew by ten percent");
    expect(ta.style.fontSize).toBe("12px");
    expect(document.activeElement).toBe(ta);
    await typeIn(ta, "Revenue grew by twelve percent");
    expect(session.doc.pages[0]!.edits).toBeUndefined(); // nothing yet: the change is kept on Enter
    await key(ta, "Enter");
    await flush();
    expect(editor()).toBeNull();
    const edits = session.doc.pages[0]!.edits!;
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ type: "text", run: r.id, text: "Revenue grew by twelve percent", oldText: "Revenue grew by ten percent" });
    expect(session.canUndo).toBe(true);
    // the preview: a white box over the old text and the new text on it
    const preview = q(".pli-edit-preview .pli-edit-text");
    expect(preview.querySelector("rect")!.getAttribute("fill")).toBe("#ffffff");
    expect(preview.querySelector("text")!.textContent).toBe("Revenue grew by twelve percent");
    // undo takes it back, redo brings it again
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(session.doc.pages[0]!.edits ?? []).toHaveLength(0);
    expect(qa(".pli-edit-preview .pli-edit-text")).toHaveLength(0);
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true, shiftKey: true });
    expect(session.doc.pages[0]!.edits).toHaveLength(1);
    expect(pageId).toBe(session.doc.pages[0]!.id);
  });

  it("Escape gives up the new text; clicking away keeps it; text that was not changed is not an edit", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const r = await runOf(session, "Quarterly report");
    await tap(centre(r.box));
    await flush();
    await typeIn(editor()!, "Annual report");
    await key(editor()!, "Escape");
    await flush();
    expect(editor()).toBeNull();
    expect(session.doc.pages[0]!.edits).toBeUndefined();
    expect(q(".pli-pdf").getAttribute("data-tool")).toBe(EDIT_TOOL); // Escape in the editor does not put the tool down

    await tap(centre(r.box));
    await flush();
    await key(editor()!, "Enter"); // not changed
    await flush();
    expect(session.doc.pages[0]!.edits).toBeUndefined();

    await tap(centre(r.box));
    await flush();
    await typeIn(editor()!, "Annual report");
    await act(async () => editor()!.blur());
    await flush();
    expect(session.doc.pages[0]!.edits).toHaveLength(1);
    expect(editor()).toBeNull();
  });

  it("clicking another piece of text keeps the first change and opens the second", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const a = await runOf(session, "Quarterly report");
    const b = await runOf(session, "Revenue grew by ten percent");
    await tap(centre(a.box));
    await flush();
    await typeIn(editor()!, "Annual report");
    await tap(centre(b.box));
    await flush();
    expect(session.doc.pages[0]!.edits).toHaveLength(1);
    expect(editor()!.value).toBe("Revenue grew by ten percent");
  });

  it("opens again on text that was changed, with the new text, and putting the old text back takes the change away", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const r = await runOf(session, "Quarterly report");
    await tap(centre(r.box));
    await flush();
    await typeIn(editor()!, "Annual report");
    await key(editor()!, "Enter");
    await flush();
    await tap(centre(r.box));
    await flush();
    expect(editor()!.value).toBe("Annual report");
    await typeIn(editor()!, "Quarterly report");
    await key(editor()!, "Enter");
    await flush();
    expect(session.doc.pages[0]!.edits ?? []).toHaveLength(0);
  });

  it("explains text that cannot be edited and opens no editor", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const runs = await session.content.editableRuns(session.doc.pages[0]!.id);
    const t3 = runs.find((r) => r.font === "type3")!;
    const hidden = runs.find((r) => r.text.includes("hidden"))!;
    expect(t3.editable).toBe(false);
    await pointer(layerOf(), "pointermove", clientOf(...centre(t3.box)), {});
    const tip = q(".pli-edit-tip");
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toBe(t3.reason);
    await tap(centre(hidden.box));
    await flush();
    expect(editor()).toBeNull();
    expect(q(".pli-edit-tip").textContent).toBe(hidden.reason);
    expect(q(".pli-edit-props").textContent).toContain(hidden.reason!);
    expect(session.doc.pages[0]!.edits).toBeUndefined();
  });

  it("lists the changes in the Edits tab, takes one back, and takes them all back in one step", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    for (const [from, to] of [["Quarterly report", "Annual report"], ["Revenue grew by ten percent", ""]] as const) {
      await tap(centre((await runOf(session, from)).box));
      await flush();
      await typeIn(editor()!, to);
      await key(editor()!, "Enter");
      await flush();
    }
    await click(q("#pli-pdf-tab-edits"));
    const items = qa(".pli-edit-item");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Page 1");
    expect(items[0]!.textContent).toContain("“Quarterly report” to “Annual report”");
    expect(items[1]!.textContent).toContain("Remove “Revenue grew by ten percent”");
    expect(q(".pli-edit-foot").textContent).toContain("new file");
    await click(q("button[aria-label='Remove edit: “Quarterly report” to “Annual report”']"));
    expect(qa(".pli-edit-item")).toHaveLength(1);
    expect(session.doc.pages[0]!.edits).toHaveLength(1);
    await click(qa(".pli-edit-foot button").find((b) => b.textContent === "Remove all edits")!);
    expect(session.doc.pages[0]!.edits ?? []).toHaveLength(0);
    expect(q(".pli-edit-list").textContent).toContain("No edits yet");
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(session.doc.pages[0]!.edits).toHaveLength(1); // undo brings back what remove-all took away
  });
});

const lora = new Uint8Array(readFileSync(resolve(__dirname, "../../core/test/fixtures/fonts/lora-latin-400-normal.ttf")));
const env: FontEnv = { canLoad: false, register() {}, load: async () => false, isInstalled: () => false };
const registry = () => {
  const source: FontSource = { name: "fake", faces: () => [], file: async (family) => (family.family === "Lora" ? lora : null) };
  return createFonts({ env, storage: null, source });
};
const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(text);

/** Edits the run with this text: click it, type, Enter. */
async function retype(session: Awaited<ReturnType<typeof mountEditor>>["session"], from: string, to: string) {
  await tap(centre((await runOf(session, from)).box));
  await flush();
  await typeIn(editor()!, to);
  await key(editor()!, "Enter");
  await flush();
}

/** Lets the animation frame the editor waits for before it gives the focus back go by. */
const later = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

describe("reading the pages", () => {
  it("reads no page's text for the tool until it is on, and keeps what it read", async () => {
    const session = await openPdf(editPdf(), { name: "edit.pdf" });
    const spy = vi.spyOn(session.content, "text");
    await mountEditor(editPdf(), { session });
    expect(spy).not.toHaveBeenCalled();
    await chooseEdit();
    expect(spy).toHaveBeenCalledTimes(1);
    await chooseEdit(); // off again
    await chooseEdit(); // and on: the page is kept, not read again
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("with the keyboard", () => {
  const hit = (text: string) => qa(".pli-edit-hit").find((e) => e.getAttribute("aria-label") === `Edit text: ${text}`)!;

  it("has a button over every piece of text and picture in reading order, only while the tool is on", async () => {
    const { session } = await mountEditor(editPdf());
    expect(qa(".pli-edit-hit")).toHaveLength(0);
    await chooseEdit();
    const runs = await session.content.runs(session.doc.pages[0]!.id);
    const labels = qa(".pli-edit-hit").map((e) => e.getAttribute("aria-label"));
    expect(labels).toHaveLength(runs.length + 1);
    expect(labels.slice(0, runs.length)).toEqual(runs.map((r) => (r.editable ? `Edit text: ${r.text}` : `Text that cannot be edited: ${r.text}`)));
    expect(labels[labels.length - 1]).toBe("Picture 1: choose to replace or delete it");
    expect(qa(".pli-edit-hit").every((e) => e.tabIndex === 0 && e.getAttribute("role") === "button")).toBe(true);
    const locked = qa(".pli-edit-hit[aria-disabled]");
    expect(locked).toHaveLength(2);
    expect(locked[0]!.getAttribute("aria-description")).toMatch(/Type 3|invisible/);
  });

  it("Enter on a piece of text opens the editor; Enter in it keeps the text and gives the focus back to the same piece", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const target = hit("Quarterly report");
    await act(async () => target.focus());
    expect(q(".pli-edit-run[data-hover]").getAttribute("data-run")).toBe(target.dataset.run);
    await key(target, "Enter");
    await flush();
    expect(editor()!.value).toBe("Quarterly report");
    await typeIn(editor()!, "Annual report");
    await key(editor()!, "Enter");
    await later();
    expect(session.doc.pages[0]!.edits).toHaveLength(1);
    expect(document.activeElement).toBe(hit("Quarterly report"));
    await key(hit("Quarterly report"), " ");
    await flush();
    expect(editor()!.value).toBe("Annual report");
    await key(editor()!, "Escape");
    await later();
    expect(editor()).toBeNull();
    expect(document.activeElement).toBe(hit("Quarterly report"));
  });

  it("selects a picture, and says why text cannot be edited", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    await key(qa(".pli-edit-hit[data-image]")[0]!, "Enter");
    await flush();
    expect(q(".pli-edit-props").textContent).toContain("4 × 4 pixels");
    const hidden = qa(".pli-edit-hit[aria-disabled]").find((e) => e.getAttribute("aria-label")!.includes("hidden"))!;
    await act(async () => hidden.focus());
    await key(hidden, "Enter");
    await flush();
    expect(editor()).toBeNull();
    const reason = (await session.content.editableRuns(session.doc.pages[0]!.id)).find((r) => r.text.includes("hidden"))!.reason!;
    expect(q(".pli-edit-props").textContent).toContain(reason);
    expect(q(".pli-edit-tip").textContent).toBe(reason);
  });
});

describe("where the editor sits", () => {
  it("lies on the baseline of the text, turned with it, for text at 0, 90, 180 and 270 degrees", async () => {
    const turned = (a: number, b: number, c: number, d: number, x: number, y: number) => `BT /F1 12 Tf ${a} ${b} ${c} ${d} ${x} ${y} Tm (Some words here) Tj ET`;
    const bytes = editPdf({ content: [turned(1, 0, 0, 1, 100, 700), turned(0, -1, 1, 0, 500, 700), turned(-1, 0, 0, -1, 400, 300), turned(0, 1, -1, 0, 100, 200)].join("\n") });
    const { session } = await mountEditor(bytes);
    const id = session.doc.pages[0]!.id;
    const content = pageContent(await session.content.runs(id), await session.content.editableRuns(id), []);
    expect(content.runs.map((r) => (Math.round(r.angle) + 360) % 360).sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    for (const r of content.runs) {
      const f = editorFrame(r, r.font.size);
      const at = (x: number, y: number) => editorPoint(f, x, y);
      // the start of the baseline is the start of the run, and the baseline runs the way the text runs
      const [sx, sy] = at(0, f.lift);
      expect(sx).toBeCloseTo(r.origin[0], 3);
      expect(sy).toBeCloseTo(r.origin[1], 3);
      const [ex, ey] = at(r.length, f.lift);
      const rad = (r.angle * Math.PI) / 180;
      expect(ex).toBeCloseTo(r.origin[0] + r.length * Math.cos(rad), 2);
      expect(ey).toBeCloseTo(r.origin[1] + r.length * Math.sin(rad), 2);
      // the whole editor stays within a line of the run's box
      const slack = r.font.size * 0.5;
      for (const [x, y] of [at(0, 0), at(f.width, 0), at(0, f.height), at(f.width, f.height)]) {
        expect(x).toBeGreaterThanOrEqual(r.box.x - slack);
        expect(x).toBeLessThanOrEqual(r.box.x + r.box.w + slack);
        expect(y).toBeGreaterThanOrEqual(r.box.y - slack);
        expect(y).toBeLessThanOrEqual(r.box.y + r.box.h + slack);
      }
    }
  });

  it.each([
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [0, 2],
    [1, 2],
    [3, 0.5],
  ])("hits the right text and puts the editor in page space when the view is turned %i quarter turns at zoom %f", async (turns, zoom) => {
    const { session } = await mountEditor(editPdf(), { turns, zoom });
    await chooseEdit();
    for (const text of ["Quarterly report", "Revenue grew by ten percent", "Turned words"]) {
      const r = await runOf(session, text);
      await tap(centre(r.box), { rotation: turns * 90, zoom });
      await flush();
      const ta = editor()!;
      expect(ta, text).not.toBeNull();
      expect(ta.dataset.run).toBe(r.id);
      expect(ta.value).toBe(text);
      const f = editorFrame({ origin: r.origin, angle: r.angle, length: runLength(r.box, r.origin, r.angle) }, r.font.size);
      expect(ta.style.left).toBe(`${f.left}px`);
      expect(ta.style.top).toBe(`${f.top}px`);
      expect(ta.style.transform).toBe(f.transform);
      // the layer the editor is in is turned and scaled like the page
      const layer = ta.closest<HTMLElement>(".pli-pdf-overlay-dom")!;
      expect(layer.style.transform).toBe(layerTransform({ width: 612, height: 792, rotation: turns * 90, scale: zoom * CSS_UNITS }));
      await key(ta, "Escape");
    }
    // one more check: a point on the empty page picks nothing, at this turn
    await tap([300, 400], { rotation: turns * 90, zoom });
    expect(editor()).toBeNull();
  });
});

describe("the panel", () => {
  it("changes the font, size, style, colour and fit of the new text, and keeps them in the edit", async () => {
    const { session } = await mountEditor(editPdf(), { props: { edit: { fonts: false } } });
    await chooseEdit();
    await tap(centre((await runOf(session, "Revenue grew by ten percent")).box));
    await flush();
    const panel = () => q(".pli-edit-props");
    const bar = () => q(".pli-pdf-formatbar");
    // the text bar above the pages has the font, size, style and colour; the panel keeps what the bar has not
    expect(bar().getAttribute("data-target")).toBe("edit");
    expect(bar().textContent).toContain("Helvetica");
    expect(panel().querySelector("[aria-label='Bold']")).toBeNull();
    await act(async () => {
      const sel = bar().querySelector<HTMLSelectElement>("select[aria-label=Font]")!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "Times");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const size = bar().querySelector<HTMLInputElement>("input[aria-label='Font size']")!;
    await typeIn(size, "18");
    await key(size, "Enter");
    await click(bar().querySelector("[aria-label='Bold']"));
    await click(bar().querySelector("[aria-label='Italic']"));
    await click(bar().querySelector("[aria-label='Text colour']"));
    await click(byLabel("#ff0000", document));
    await click(panel().querySelector("[aria-label='Shrink to fit']"));
    // while typing, the editor already shows the choices
    const ta = editor()!;
    expect(ta.style.fontSize).toBe("18px");
    expect(ta.style.fontWeight).toBe("700");
    expect(ta.style.fontStyle).toBe("italic");
    expect(ta.style.color).toBe("rgb(255, 0, 0)");
    expect(session.doc.pages[0]!.edits).toBeUndefined();
    await typeIn(ta, "Revenue grew a lot");
    await key(ta, "Enter");
    await flush();
    expect(session.doc.pages[0]!.edits![0]).toMatchObject({ type: "text", text: "Revenue grew a lot", family: "Times", size: 18, bold: true, italic: true, color: "#ff0000", fit: "shrink" });
    // the text is selected after Enter: a change in the panel is another change of the same edit, one step of undo
    await click(bar().querySelector("[aria-label='Text colour']"));
    await click(byLabel("#0000ff", document));
    await flush();
    expect(session.doc.pages[0]!.edits).toHaveLength(1);
    expect(session.doc.pages[0]!.edits![0]).toMatchObject({ text: "Revenue grew a lot", color: "#0000ff", size: 18 });
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(session.doc.pages[0]!.edits![0]).toMatchObject({ color: "#ff0000" });
    // "keep the original" takes the edit away
    await click(qa(".pli-edit-props button").find((b) => b.textContent === "Keep the original text")!);
    expect(session.doc.pages[0]!.edits ?? []).toHaveLength(0);
  });

  it("offers the font picker of the editor's registry", async () => {
    const fonts = registry();
    const { session } = await mountEditor(editPdf(), { props: { fonts } });
    await chooseEdit();
    await tap(centre((await runOf(session, "Quarterly report")).box));
    await flush();
    expect(q(".pli-pdf-formatbar button[aria-label='Font']")).not.toBeNull();
  });

  it("says when new text is wider than the old, on the panel and in the Edits tab", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    await retype(session, "Quarterly report", "Quarterly report with a great many more words than it had before");
    await flush(10);
    expect(q(".pli-edit-props .pli-edit-warnings").textContent).toMatch(/wider/);
    await click(q("#pli-pdf-tab-edits"));
    await flush(4);
    expect(q(".pli-edit-item .pli-edit-warnings").textContent).toMatch(/wider than the old/);
  });

  it("says when a font that is not in the file nor offered to the save is replaced", async () => {
    const { session } = await mountEditor(editPdf());
    await run(async () => {
      await session.content.replaceText((await runOf(session, "Quarterly report")).id, "Annual report", { family: "Lora" });
    });
    await flush(10);
    await click(q("#pli-pdf-tab-edits"));
    expect(q(".pli-edit-item .pli-edit-warnings").textContent).toMatch(/Lora/);
  });
});

describe("pictures", () => {
  const imageBox = async (session: Awaited<ReturnType<typeof mountEditor>>["session"]) => (await session.content.images(session.doc.pages[0]!.id))[0]!;

  it("shows a box on the picture, selects it on a click and says what it is", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const img = await imageBox(session);
    expect(qa(".pli-edit-image")).toHaveLength(1);
    await pointer(layerOf(), "pointermove", clientOf(...centre(img.box)), {});
    expect(q(".pli-edit-image").hasAttribute("data-hover")).toBe(true);
    await tap(centre(img.box));
    await flush();
    expect(editor()).toBeNull();
    expect(q(".pli-edit-image").hasAttribute("data-selected")).toBe(true);
    expect(q(".pli-edit-props").textContent).toContain("4 × 4 pixels");
  });

  it("replaces a picture from a file, shows it, fits it, takes it out, and undo brings each step back", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const img = await imageBox(session);
    await tap(centre(img.box));
    await flush();
    const input = q<HTMLInputElement>(".pli-edit-props input[type=file]");
    const png = bluePng(20, 10);
    const file = { type: "image/png", arrayBuffer: async () => png.slice().buffer };
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await fire(input, new Event("change", { bubbles: true }));
    await flush();
    const edit = () => session.doc.pages[0]!.edits![0] as Extract<NonNullable<(typeof session.doc.pages)[0]["edits"]>[number], { type: "image" }>;
    expect(edit()).toMatchObject({ type: "image", target: img.id });
    expect(edit().picture!.src).toBe(blueUri(20, 10));
    const shown = q(".pli-edit-picture image");
    expect(shown.getAttribute("href")).toBe(blueUri(20, 10));
    expect(shown.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(q(".pli-edit-props").textContent).toContain("will be replaced");
    await click(q(".pli-edit-props input[aria-label='Stretch to fill']"));
    expect(edit().fit).toBe("stretch");
    expect(q(".pli-edit-picture image").getAttribute("preserveAspectRatio")).toBe("none");
    await click(qa(".pli-edit-props button").find((b) => b.textContent!.includes("Delete picture"))!);
    expect(edit().picture).toBeNull();
    expect(qa(".pli-edit-picture image")).toHaveLength(0);
    expect(q(".pli-edit-picture rect").getAttribute("fill")).toBe("#ffffff");
    await click(q("#pli-pdf-tab-edits"));
    expect(q(".pli-edit-item").textContent).toContain("Remove a picture");
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(edit().picture).not.toBeNull();
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(edit().fit).toBe("contain");
    await click(qa("button").find((b) => b.getAttribute("aria-label")?.startsWith("Remove edit"))!);
    expect(session.doc.pages[0]!.edits ?? []).toHaveLength(0);
    expect(qa(".pli-edit-picture")).toHaveLength(0);
  });
});

describe("saving what was edited", () => {
  it("writes the new text and not the old, and the other text stays", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    await retype(session, "Quarterly report", "Annual report");
    await retype(session, "Revenue grew by ten percent", "");
    const out = await session.save();
    expect(contains(out, "Quarterly")).toBe(false);
    expect(contains(out, "Revenue")).toBe(false);
    const r = await renderPdf(out, 0, 2);
    expect(r.text).toContain("Annual report");
    expect(r.text).not.toContain("Quarterly");
    expect(r.text).not.toContain("Revenue");
    expect(r.text).toContain("Turned words");
  });

  it("writes a picture that was swapped, and one that was removed", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    const img = (await session.content.images(session.doc.pages[0]!.id))[0]!;
    await tap(centre(img.box));
    await flush();
    const input = q<HTMLInputElement>(".pli-edit-props input[type=file]");
    Object.defineProperty(input, "files", { value: [{ type: "image/png", arrayBuffer: async () => bluePng(20, 10).slice().buffer }], configurable: true });
    await fire(input, new Event("change", { bubbles: true }));
    await flush();
    const r = await renderPdf(await session.save(), 0, 2);
    const [x, y] = centre(img.box);
    expect(r.pixel(x, y).slice(0, 3)).toEqual([0, 0, 255]);
    await click(qa(".pli-edit-props button").find((b) => b.textContent!.includes("Delete picture"))!);
    const gone = await renderPdf(await session.save(), 0, 2);
    expect(gone.pixel(x, y).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("embeds the font of the fonts prop for text set in another family", async () => {
    const fonts = registry();
    const { session } = await mountEditor(editPdf(), { props: { fonts } });
    await chooseEdit();
    await run(async () => {
      await session.content.replaceText((await runOf(session, "Quarterly report")).id, "Annual report", { family: "Lora" });
    });
    await flush();
    const out = await saveBytes(session);
    expect(contains(out, "Lora")).toBe(true);
    const r = await renderPdf(out, 0, 2);
    expect(r.text).toContain("Annual report");
    expect(r.text).not.toContain("Quarterly");
  });
});

describe("a viewer that cannot edit", () => {
  it("has no Edit button, no Edits tab and no key, but still shows the changes that are waiting", async () => {
    const { session } = await mountEditor(editPdf(), { props: { readOnly: true } });
    expect(qa("button[aria-label='Edit text and pictures']")).toHaveLength(0);
    expect(qa("#pli-pdf-tab-edits")).toHaveLength(0);
    await key(q(".pli-pdf-scroller"), "q");
    expect(q(".pli-pdf").getAttribute("data-tool")).toBeNull();
    await run(async () => {
      await session.content.replaceText((await runOf(session, "Quarterly report")).id, "Annual report");
    });
    await flush();
    expect(q(".pli-edit-preview text").textContent).toBe("Annual report");
  });

  it("has its button in the tools row when the editor has no annotation tools, and works from there", async () => {
    const { session } = await mountEditor(editPdf(), { props: { annotations: false } });
    expect(q(".pli-pdf-toolbar")).toBeNull();
    expect(q(".pli-pdf-ribbon button[aria-label='Edit text and pictures']")).not.toBeNull();
    await chooseEdit();
    expect(q(".pli-pdf").getAttribute("data-tool")).toBe(EDIT_TOOL);
    await retype(session, "Quarterly report", "Annual report");
    expect(session.doc.pages[0]!.edits).toHaveLength(1);
    await key(q(".pli-pdf-scroller"), "q");
    expect(q(".pli-pdf").getAttribute("data-tool")).toBeNull();
  });

  it("has its button in the top toolbar instead, with topToolbar and no annotation tools", async () => {
    await mountEditor(editPdf(), { props: { annotations: false, topToolbar: true } });
    expect(q(".pli-pdf-toolbar [data-group='extra'] button[aria-label='Edit text and pictures']")).not.toBeNull();
    expect(q(".pli-pdf-ribbon")).toBeNull();
    await chooseEdit();
    expect(q(".pli-pdf").getAttribute("data-tool")).toBe(EDIT_TOOL);
  });

  it("can be left out of the editor", async () => {
    await mountEditor(editPdf(), { props: { edit: false } });
    expect(qa("button[aria-label='Edit text and pictures']")).toHaveLength(0);
    expect(qa("#pli-pdf-tab-edits")).toHaveLength(0);
  });
});

describe("telling people the file is written anew", () => {
  it("says it once after a save, and always in the download dialog", async () => {
    const saved: Uint8Array[] = [];
    const { session } = await mountEditor(editPdf(), { props: { onSave: (b: Uint8Array) => void saved.push(b) } });
    await chooseEdit();
    await retype(session, "Quarterly report", "Annual report");
    await saveFile();
    await flush();
    const toast = () => document.querySelector(".pli-pdf-toast")?.textContent ?? "";
    expect(toast()).toContain("written as a new file");
    expect(saved).toHaveLength(1);
    await run(() => session.pages.rotate([session.doc.pages[0]!.id], 90));
    await saveFile();
    await flush();
    expect(toast()).toContain("Saved edit.pdf");
    expect(toast()).not.toContain("new file");
    // the download dialog always says it while changes are waiting
    await chooseMenu("File", "Download", "More download options…");
    expect(q("dialog[open] [data-edits]").textContent).toContain("written as a new file");
  });
});
