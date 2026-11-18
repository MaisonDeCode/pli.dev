// @vitest-environment jsdom
// Version history in the View menu, and looking at an older version before restoring it.
import { describe, expect, it, vi } from "vitest";
import { Users, memoryVersionStorage } from "@pli.dev/core";
import { hashPdfDoc, memorySourceStore, openPdf, pdfVersionHistory, type PdfDoc, type PdfSession, type Source } from "@pli.dev/pdf";
import { PdfEditor, type PdfEditorProps } from "../src";
import { fakeRenderer } from "../src/testing";
import { byLabel, chooseMenu, click, flush, key, menuEntry, q, qa, render, run, useHost } from "./harness";
import { WORDS, openWords, pdfOf, stubDialogs, viewport } from "./pagesSupport";

useHost();
stubDialogs();

async function mount(session: PdfSession, props: Partial<PdfEditorProps> = {}) {
  await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 12 })} viewport={viewport} defaultZoom={1} annotations={{ storageKey: "" }} {...props} />);
  await flush();
}

const editors = () => new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
const viewers = () => new Users({ current: { id: "vic", name: "Vic" }, role: "viewer" });
const rect = { x: 72, y: 100, w: 100, h: 14 };

const openHistory = async () => {
  await chooseMenu("View", "Version history");
  await flush();
};
const rows = () => qa(".pli-version:not(.pli-version-current)", document);
const row = (name: string) => rows().find((li) => li.querySelector(".pli-version-name-text")?.textContent === name)!;
const names = () => rows().map((li) => li.querySelector(".pli-version-name-text")!.textContent);
const choose = async (name: string) => {
  await click(row(name).querySelector(".pli-version-main"));
  await flush(10);
};
const preview = () => document.querySelector<HTMLElement>("[data-version-preview]");
const previewPages = () => Number(preview()!.querySelector(".pli-pdf-page-total")?.getAttribute("aria-label")?.replace("of ", ""));
// the editor's own status bar is the last one in the page: a preview has one of its own inside the page area
const livePages = () => Number(qa(".pli-pdf-page-total").at(-1)!.getAttribute("aria-label")!.replace("of ", ""));

/** A document with a version "Five pages" saved, then changed: a page less, a highlight, a rotation. */
async function changed(extra: Partial<PdfEditorProps> = {}, users = editors()) {
  const session = await openWords();
  const storage = memoryVersionStorage<PdfDoc>();
  const history = pdfVersionHistory(session, { storage, users });
  await history.ready;
  await mount(session, { history, users, ...extra });
  const first = session.doc.pages[0]!.id;
  await run(async () => void (await history.save("Five pages")));
  const then = structuredClone(session.doc);
  await run(() => {
    session.annots.addHighlight(first, [rect]);
    session.pages.rotate([first], 90);
    session.pages.remove([session.doc.pages[4]!.id]);
  });
  return { session, storage, history, then };
}

describe("View > Version history", () => {
  it("is in the View menu only when there is a history, and not in File any more", async () => {
    await mount(await openWords());
    expect(await menuEntry("View", "Version history")).toBeUndefined();
    await key(document.body, "Escape");
    await mount(await openWords(), { versions: memoryVersionStorage<PdfDoc>(), users: editors() });
    const entry = await menuEntry("View", "Version history");
    expect(entry).toBeDefined();
    expect(entry!.getAttribute("aria-checked")).toBe("false");
    await key(document.body, "Escape");
    expect(await menuEntry("File", "Version history")).toBeUndefined();
  });

  it("opens the History tab, shows a tick while it is open, and closes it again", async () => {
    await mount(await openWords(), { versions: memoryVersionStorage<PdfDoc>(), users: editors() });
    await openHistory();
    expect(q("#pli-pdf-tab-history").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".pli-versions")).not.toBeNull();
    expect((await menuEntry("View", "Version history"))!.getAttribute("aria-checked")).toBe("true");
    await key(document.body, "Escape");
    await chooseMenu("View", "Version history");
    expect(document.querySelector(".pli-pdf-sidebar")).toBeNull();
  });
});

describe("previewing a version", () => {
  it("shows the older pages, annotations and order in the viewer while the real document stays as it is", async () => {
    const { session } = await changed();
    const live = hashPdfDoc(session.doc);
    const undoable = session.canUndo;
    const selection = structuredClone(session.selection);
    expect(livePages()).toBe(4);
    await openHistory();
    expect(document.querySelector(".pli-version-current")).not.toBeNull();
    await choose("Five pages");
    expect(preview()).not.toBeNull();
    expect(q(".pli-version-bar").textContent).toContain("Five pages");
    expect(previewPages()).toBe(5);
    // the highlight made later is not in the older page, and the real page keeps its own
    const firstOf = (root: ParentNode) => root.querySelector(".pli-pdf-page")!;
    expect(firstOf(preview()!)).not.toBeNull();
    expect(preview()!.querySelectorAll("[data-annot]").length).toBe(0);
    expect(session.doc.pages[0]!.annots).toHaveLength(1);
    // nothing about the real document moved
    expect(hashPdfDoc(session.doc)).toBe(live);
    expect(session.canUndo).toBe(undoable);
    expect(session.selection).toEqual(selection);
    expect(livePages()).toBe(4);
    // the row is shown as the one being looked at
    expect(row("Five pages").getAttribute("data-active")).toBe("true");
  });

  it("shows an annotation the version had and the document has since lost,", async () => {
    const session = await openWords();
    const users = editors();
    const history = pdfVersionHistory(session, { storage: memoryVersionStorage<PdfDoc>(), users });
    await history.ready;
    await mount(session, { history, users });
    const first = session.doc.pages[0]!.id;
    await run(() => void session.annots.addHighlight(first, [rect]));
    await run(async () => void (await history.save("Marked")));
    await run(() => void session.annots.remove([session.doc.pages[0]!.annots[0]!.id]));
    expect(document.querySelectorAll(".pli-pdf-scroller [data-annot]").length).toBe(0);
    await openHistory();
    await choose("Marked");
    expect(preview()!.querySelectorAll("[data-annot][data-type='highlight']").length).toBe(1);
    // the preview is read-only: no ribbon, no tools to change it
    expect(preview()!.querySelectorAll(".pli-pdf-ribbon .pli-tool").length).toBe(0);
    expect(session.doc.pages[0]!.annots).toHaveLength(0);
  });

  it("goes back with the Current version row, the Back button and Escape", async () => {
    const { session } = await changed();
    await openHistory();
    await choose("Five pages");
    await click(document.querySelector(".pli-version-current .pli-version-main"));
    expect(preview()).toBeNull();
    await choose("Five pages");
    await click(byLabel("Viewing an earlier version")!.querySelectorAll("button")[1]!);
    expect(preview()).toBeNull();
    await choose("Five pages");
    await key(q(".pli-versions"), "Escape");
    expect(preview()).toBeNull();
    // the keys of the editor do not touch the document while a version is shown
    await choose("Five pages");
    const live = hashPdfDoc(session.doc);
    await key(q(".pli-versions"), "z", { ctrlKey: true });
    expect(hashPdfDoc(session.doc)).toBe(live);
    // closing the History tab ends the preview too
    await chooseMenu("View", "Version history");
    expect(preview()).toBeNull();
  });

  it("restores from the bar: one undo step, a Restored entry, every earlier version kept, and the preview is left", async () => {
    const { session, then, storage } = await changed();
    const undoBefore = session.canUndo;
    await openHistory();
    await choose("Five pages");
    await click(qa("button", q(".pli-version-bar")).find((b) => b.textContent === "Restore this version"));
    await flush(10);
    expect(preview()).toBeNull();
    expect(JSON.stringify(session.doc.pages.map((p) => ({ ...p, annots: p.annots.length })))).toBe(JSON.stringify(then.pages.map((p) => ({ ...p, annots: p.annots.length }))));
    expect(livePages()).toBe(5);
    expect(names()).toEqual(expect.arrayContaining(["Five pages", 'Before restoring "Five pages"', 'Restored "Five pages"']));
    expect(storage.count(session.doc.id)).toBe(3);
    // one undo brings back what was there before
    await run(() => void session.undo());
    expect(livePages()).toBe(4);
    expect(undoBefore).toBe(true);
  });

  it("can restore from the panel's own button too, and the panel lists the new entry", async () => {
    const { session } = await changed();
    await openHistory();
    await click(row("Five pages").querySelector(".pli-version-actions .pli-link-button"));
    await flush(10);
    expect(session.doc.pages).toHaveLength(5);
    expect(names()).toContain('Restored "Five pages"');
  });

  it("gives a viewer the preview but no Restore", async () => {
    const users = viewers();
    const session = await openWords();
    const storage = memoryVersionStorage<PdfDoc>();
    const editorHistory = pdfVersionHistory(session, { storage, users: editors() });
    await editorHistory.ready;
    await run(async () => void (await editorHistory.save("Draft")));
    const history = pdfVersionHistory(session, { storage, users });
    await history.ready;
    await mount(session, { history, users, readOnly: true });
    await openHistory();
    await choose("Draft");
    expect(preview()).not.toBeNull();
    expect(qa("button", q(".pli-version-bar")).map((b) => b.textContent)).toEqual(["Back to current"]);
  });
});

describe("a version whose source file is gone from the document", () => {
  async function withInsertedPages(store?: ReturnType<typeof memorySourceStore>) {
    const sources = store ?? memorySourceStore();
    const session = await openPdf(pdfOf(WORDS.slice(0, 2)), { name: "main.pdf", sources });
    const storage = memoryVersionStorage<PdfDoc>();
    const history = pdfVersionHistory(session, { storage, users: editors() });
    await history.ready;
    await mount(session, { history, users: editors() });
    await run(async () => void (await session.pages.insertFrom(pdfOf(["Zulu", "Yankee"]), { at: 2, name: "extra.pdf" })));
    expect(session.doc.pages).toHaveLength(4);
    await run(async () => void (await history.save("With the extra pages")));
    const extra = session.doc.pages.slice(2).map((p) => p.id);
    await run(() => void session.pages.remove(extra));
    return { session, history, sources };
  }

  it("is previewed and restored from the bytes the session still holds", async () => {
    const { session } = await withInsertedPages();
    expect(session.doc.pages).toHaveLength(2);
    await openHistory();
    await choose("With the extra pages");
    expect(previewPages()).toBe(4);
    expect(document.querySelector(".pli-pdf-version-note")).toBeNull();
    await click(qa("button", q(".pli-version-bar")).find((b) => b.textContent === "Restore this version"));
    await flush(10);
    expect(session.doc.pages).toHaveLength(4);
    expect(session.doc.pages[2]!.from?.source).toBeTruthy();
    expect(await session.sources.get(session.doc.sources.find((s) => s.id === session.doc.pages[2]!.from!.source) as Source)).toBeInstanceOf(Uint8Array);
  });

  it("says so, and still restores, when the source store no longer has the file", async () => {
    const memory = memorySourceStore();
    const forgetful = { get: vi.fn((s: Source) => (s.name === "extra.pdf" ? undefined : memory.get(s))), put: (s: Source, b: Uint8Array) => memory.put(s, b) };
    const { session } = await withInsertedPages(forgetful as never);
    await openHistory();
    await choose("With the extra pages");
    const note = document.querySelector(".pli-pdf-version-note")!;
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toContain("extra.pdf");
    await click(qa("button", q(".pli-version-bar")).find((b) => b.textContent === "Restore this version"));
    await flush(10);
    expect(session.doc.pages).toHaveLength(4);
    expect(preview()).toBeNull();
  });
});

describe("saving versions by itself", () => {
  it("keeps an Original version when the editor makes the history from `versions`, and not with autoSaveVersions={false}", async () => {
    const on = memoryVersionStorage<PdfDoc>();
    const a = await openWords();
    await mount(a, { versions: on, users: editors() });
    await flush(10);
    expect(((on.list(a.doc.id)) as { name: string }[]).map((v) => v.name)).toEqual(["Original"]);
    const off = memoryVersionStorage<PdfDoc>();
    const b = await openWords();
    await mount(b, { versions: off, users: editors(), autoSaveVersions: false });
    await flush(10);
    expect(off.count(b.doc.id)).toBe(0);
  });

  it("keeps an Autosaved version after changes, as often as autoSaveVersions says, and stops when the editor is gone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const storage = memoryVersionStorage<PdfDoc>();
      const session = await openWords();
      await mount(session, { versions: storage, users: editors(), autoSaveVersions: { every: 50, baseline: false } });
      await flush(4);
      await run(() => void session.pages.rotate([session.doc.pages[0]!.id], 90));
      await vi.advanceTimersByTimeAsync(80);
      await flush(4);
      expect(((storage.list(session.doc.id)) as { name: string }[]).map((v) => v.name)).toEqual(["Autosaved"]);
      await render(<div />);
      await run(() => void session.pages.rotate([session.doc.pages[1]!.id], 90));
      await vi.advanceTimersByTimeAsync(200);
      expect(storage.count(session.doc.id)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
