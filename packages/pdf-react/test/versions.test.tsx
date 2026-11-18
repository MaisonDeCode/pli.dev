// @vitest-environment jsdom
// Version history in the PDF editor: the shared panel, a restore that is one undoable step.
import { describe, expect, it } from "vitest";
import { Users, memoryVersionStorage } from "@pli.dev/core";
import { hashPdfDoc, pdfVersionHistory, type PdfDoc, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor, type PdfEditorProps } from "../src";
import { fakeRenderer } from "../src/testing";
import { chooseMenu, click, flush, q, qa, render, run, useHost } from "./harness";
import { openWords, stubDialogs, viewport } from "./pagesSupport";

useHost();
stubDialogs();

async function mount(session: PdfSession, props: Partial<PdfEditorProps> = {}) {
  await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: session.doc.pages.length })} viewport={viewport} defaultZoom={1} annotations={{ storageKey: "" }} {...props} />);
  await flush();
}

const editors = () => new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
const rect = { x: 72, y: 100, w: 100, h: 14 };
const pageCount = (s: PdfSession) => s.doc.pages.length;

async function openHistory() {
  await chooseMenu("View", "Version history");
  await flush();
}

const versionNames = () => qa(".pli-version:not(.pli-version-current) .pli-version-name-text").map((e) => e.textContent);
const restoreButton = (version: string) => qa(".pli-version", document).find((li) => li.querySelector(".pli-version-name-text")?.textContent === version)!.querySelector<HTMLElement>(".pli-version-actions .pli-link-button")!;

describe("version history in the PDF editor", () => {
  it("restores an older version, as one undo step", async () => {
    const session = await openWords();
    const storage = memoryVersionStorage<PdfDoc>();
    const history = pdfVersionHistory(session, { storage, users: editors() });
    await history.ready;
    await mount(session, { history, users: editors() });
    const [first] = session.doc.pages.map((p) => p.id) as [string];

    const before = structuredClone(session.doc);
    await run(async () => void (await history.save("Sent to legal")));
    await run(() => {
      session.annots.addHighlight(first, [rect]);
      session.pages.rotate([first], 90);
      session.pages.remove([session.doc.pages[4]!.id]);
    });
    const after = structuredClone(session.doc);
    expect(pageCount(session)).toBe(4);

    await openHistory();
    expect(q("#pli-pdf-tab-history").getAttribute("aria-selected")).toBe("true");
    expect(versionNames()).toEqual(["Sent to legal"]);

    // Restoring needs no confirmation: it adds a version and the way back is in the list.
    await click(restoreButton("Sent to legal"));
    await flush();
    expect(JSON.stringify(session.doc)).toBe(JSON.stringify(before));
    expect(pageCount(session)).toBe(5);
    // the way back was kept in the list
    expect(versionNames()).toEqual(expect.arrayContaining(["Sent to legal", 'Before restoring "Sent to legal"', 'Restored "Sent to legal"']));

    // one undo puts back everything that was there before the restore
    await run(() => void session.undo());
    expect(hashPdfDoc(session.doc)).toBe(hashPdfDoc(after));
    expect(pageCount(session)).toBe(4);
    // the editor follows: the page count it shows is the restored one
    await run(() => void session.redo());
    expect(pageCount(session)).toBe(5);
    expect(q(".pli-pdf-page-total").getAttribute("aria-label")).toBe("of 5");
  });

  it("builds the history itself from `versions` and `users`, saves a named version and restores it", async () => {
    const session = await openWords();
    const storage = memoryVersionStorage<PdfDoc>();
    await mount(session, { versions: storage, users: editors(), autoSaveVersions: false });
    await openHistory();
    const input = q<HTMLInputElement>(".pli-version-name input");
    await run(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "Draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(q(".pli-version-name button"));
    await flush();
    expect(versionNames()).toEqual(["Draft"]);
    expect(storage.count(session.doc.id)).toBe(1);

    const first = session.doc.pages[0]!.id;
    const saved = hashPdfDoc(session.doc);
    await run(() => void session.pages.rotate([first], 180));
    await click(restoreButton("Draft"));
    await flush();
    expect(hashPdfDoc(session.doc)).toBe(saved);
    expect(session.canUndo).toBe(true);
  });

  it("keeps the page shown and the selection valid after a restore", async () => {
    const session = await openWords();
    const history = pdfVersionHistory(session, { storage: memoryVersionStorage<PdfDoc>(), users: editors() });
    await history.ready;
    await mount(session, { history, users: editors() });
    const ids = session.doc.pages.map((p) => p.id);
    await run(async () => void (await history.save("Five pages")));
    await run(() => {
      session.pages.remove([ids[4]!]);
      session.select({ page: ids[3]!, annots: [] });
    });
    await run(async () => void (await history.restore(history.versions[0]!.id)));
    expect(session.selection.page).toBe(ids[3]);
    // a version with fewer pages than where the person is looking
    const small = await run(async () => (await history.save("Four pages")).id);
    await run(() => void session.pages.insertBlank(ids[3]!));
    await run(() => session.select({ page: session.doc.pages[4]!.id, annots: [] }));
    await run(async () => void (await history.restore(small)));
    expect(session.doc.pages.map((p) => p.id)).toEqual(ids);
    expect(ids).toContain(session.selection.page);
    // and undo brings the selection back with the document
    await run(() => void session.undo());
    expect(session.doc.pages).toHaveLength(6);
  });

  it("offers no Restore to someone who may not edit (the shared panel's own rule)", async () => {
    const session = await openWords();
    const storage = memoryVersionStorage<PdfDoc>();
    const history = pdfVersionHistory(session, { storage, users: editors() });
    await history.ready;
    await run(async () => void (await history.save("Draft")));
    const viewers = new Users({ current: { id: "vic", name: "Vic" }, role: "viewer" });
    const readOnly = pdfVersionHistory(session, { storage, users: viewers });
    await readOnly.ready;
    await mount(session, { history: readOnly, users: viewers, readOnly: true });
    await openHistory();
    expect(versionNames()).toEqual(["Draft"]);
    expect(document.querySelector(".pli-version-actions")).toBeNull();
    expect(document.querySelector(".pli-version-name")).toBeNull();
  });
});
