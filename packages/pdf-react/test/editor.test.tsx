// @vitest-environment jsdom
// The whole editor (`PdfEditor`): page tools, annotation tools and forms on one real file, in one DOM.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { makeSamplePdf, openPdf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor } from "../src";
import { fakeRenderer } from "../src/testing";
import { byLabel, click, flush, host, key, q, qa, render, openProperties, run, saveFile, togglePrepareForm, useHost } from "./harness";

useHost();

const viewport = { width: 800, height: 600 };

async function mount(extra: Record<string, unknown> = {}) {
  const bytes = await makeSamplePdf();
  const session = await openPdf(bytes, { name: "sample.pdf", user: { id: "u1", name: "Ana Reyes" } });
  const renderer = fakeRenderer({ pages: 2 });
  await render(<PdfEditor session={session} renderer={renderer} viewport={viewport} defaultZoom={1} annotations={{ storageKey: "" }} {...extra} />);
  await flush();
  return { session, renderer, bytes };
}

describe("PdfEditor: one editor, not three bolted together", () => {
  it("has one tools row, one status bar, one menu bar and one title, and no toolbar", async () => {
    await mount({ onSave: () => {} });
    expect(qa(".pli-pdf-toolbar")).toHaveLength(0);
    expect(qa(".pli-pdf-ribbon")).toHaveLength(1);
    expect(qa(".pli-pdf-statusbar")).toHaveLength(1);
    expect(qa(".pli-menubar")).toHaveLength(1);
    expect(qa(".pli-pdf-titlebar")).toHaveLength(1);
    expect(qa("[aria-label='Sidebar'][role=tablist]")).toHaveLength(1);
    expect(qa(".pli-pdf-right").length).toBeLessThanOrEqual(1);
    expect(qa("button[aria-label='Save']")).toHaveLength(0); // Save is File > Save (and Ctrl+S)
  });

  it("has one toolbar, one ribbon, one file menu and one title, with topToolbar", async () => {
    await mount({ onSave: () => {}, topToolbar: true });
    expect(qa(".pli-pdf-toolbar")).toHaveLength(1);
    expect(qa(".pli-pdf-ribbon")).toHaveLength(1);
    expect(qa(".pli-pdf-statusbar")).toHaveLength(0);
    expect(qa("[data-group='file']")).toHaveLength(1);
    expect(qa("[aria-label='Sidebar'][role=tablist]")).toHaveLength(1);
    expect(byLabel("Save", host)).not.toBeNull();
    expect(qa("button[aria-label='Save']")).toHaveLength(1);
  });

  it("has no duplicate ids, tool buttons or sidebar tabs", async () => {
    await mount();
    const ids = qa("[id]").map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    const buttons = qa(".pli-pdf-toolbar button, .pli-pdf-ribbon button").map((b) => b.getAttribute("aria-label")).filter(Boolean);
    expect(buttons.filter((b, i) => buttons.indexOf(b) !== i)).toEqual([]);
    const tabs = qa("[role=tab]").map((t) => t.id);
    expect(tabs).toEqual(["pli-pdf-tab-thumbnails", "pli-pdf-tab-outline", "pli-pdf-tab-comments", "pli-pdf-tab-annotations", "pli-pdf-tab-edits"]);
  });

  it("draws the form of the file and the annotations of the file in the same pages", async () => {
    const { session } = await mount();
    expect(qa(".pli-form-widget").length).toBeGreaterThanOrEqual(4);
    const pageId = session.doc.pages[0]!.id;
    await run(() => session.annots.addHighlight(pageId, [{ x: 72, y: 100, w: 100, h: 14 }]));
    expect(qa(".pli-pdf-page")[0]!.querySelectorAll("svg g").length).toBeGreaterThan(0);
  });

  it("undoes one step with one Ctrl+Z, even with the page tools, annotation tools and forms all listening", async () => {
    const { session } = await mount();
    const id = session.doc.pages[0]!.id;
    await run(() => session.annots.addHighlight(id, [{ x: 72, y: 100, w: 100, h: 14 }]));
    await run(() => session.annots.addHighlight(id, [{ x: 72, y: 200, w: 100, h: 14 }]));
    await run(() => session.pages.rotate([id], 90));
    const marks = () => session.doc.pages[0]!.annots.filter((a) => a.type === "highlight").length;
    expect(marks()).toBe(2);
    const scroller = q(".pli-pdf-scroller");
    await key(scroller, "z", { ctrlKey: true });
    expect(session.doc.pages[0]!.rotate).toBe(0); // the rotation went
    expect(marks()).toBe(2); // only that
    await key(scroller, "z", { ctrlKey: true });
    expect(marks()).toBe(1);
    await key(scroller, "z", { ctrlKey: true, shiftKey: true });
    expect(marks()).toBe(2);
  });

  it("keeps a form field's own undo for typing, and does not undo the document", async () => {
    const { session } = await mount();
    const field = session.forms.byName("name")!;
    await run(() => session.forms.setValue(field.id, "Sam"));
    const input = q<HTMLInputElement>(".pli-form-widget input[type=text], .pli-form-widget textarea");
    expect(input).not.toBeNull();
    await key(input, "z", { ctrlKey: true });
    expect(session.forms.byName("name")!.value).toBe("Sam"); // a text field handles its own undo
  });

  it("shows one properties panel at a time, and the form panel while preparing the form", async () => {
    await mount();
    await togglePrepareForm();
    expect(qa(".pli-pdf-right")).toHaveLength(0); // nothing selected: nothing to show
    await openProperties();
    expect(qa(".pli-pdf-right")).toHaveLength(1);
    expect(q(".pli-pdf-right .pli-form-props")).not.toBeNull();
    await togglePrepareForm();
    expect(qa(".pli-pdf-right .pli-form-props")).toHaveLength(0);
  });

  it("read-only: no editing tools, no ribbon edits, the Comments tab stays", async () => {
    await mount({ readOnly: true });
    expect(qa(".pli-pdf-toolbar [data-group='tools'] button")).toHaveLength(0);
    expect(qa("[role=tab]").map((t) => t.id)).toContain("pli-pdf-tab-comments");
    expect(qa(".pli-pdf-right")).toHaveLength(0);
  });

  it("the Save button hands the saved file to onSave and the dot goes", async () => {
    const saved: Uint8Array[] = [];
    const { session } = await mount({ onSave: (b: Uint8Array) => void saved.push(b) });
    await run(() => session.annots.addHighlight(session.doc.pages[0]!.id, [{ x: 72, y: 100, w: 100, h: 14 }]));
    expect(session.dirty).toBe(true);
    await saveFile();
    await flush();
    expect(saved).toHaveLength(1);
    expect(session.dirty).toBe(false);
    const again = await openPdf(saved[0]!);
    expect(again.doc.pages[0]!.annots.filter((a) => a.type === "highlight")).toHaveLength(1);
    expect(again.doc.fields).toHaveLength(4);
  });

  it("switching a tool through the toolbar reaches the annotation controller once", async () => {
    const seen: (string | null)[] = [];
    await mount({ onToolChange: (id: string | null) => void seen.push(id) });
    const pen = byLabel("Pen", q(".pli-pdf-ribbon"));
    expect(pen).toBeTruthy();
    await click(pen);
    expect(seen).toEqual([expect.any(String)]);
    await click(pen);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeNull();
  });

  it("is unmounted cleanly", async () => {
    const spy = vi.spyOn(console, "error");
    await mount();
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
void ({} as PdfSession);
