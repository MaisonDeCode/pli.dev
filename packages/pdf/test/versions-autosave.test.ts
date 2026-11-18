import { Users, memoryVersionStorage } from "@pli.dev/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memorySourceStore, missingVersionSources, openPdf, pdfVersionHistory, type PdfDoc, type Source } from "../src";
import { buildClassic, simpleDoc } from "./support/handmade";

afterEach(() => vi.useRealTimers());

const editor = () => new Users({ current: { id: "ana", name: "Ana" }, role: "editor" });
const open = () => openPdf(buildClassic(simpleDoc(3)).bytes, { name: "a.pdf" });

describe("pdfVersionHistory: automatic versions and the restore entry", () => {
  it("passes `autoSave` to the history: an Original on a file with none, then an Autosaved one after changes, and dispose stops it", async () => {
    vi.useFakeTimers();
    const session = await open();
    const storage = memoryVersionStorage<PdfDoc>();
    const history = pdfVersionHistory(session, { storage, users: editor(), autoSave: { every: 1000 } });
    await history.ready;
    await vi.advanceTimersByTimeAsync(0);
    expect(history.versions.map((v) => v.name)).toEqual(["Original"]);
    session.pages.rotate([session.doc.pages[0]!.id], 90);
    await vi.advanceTimersByTimeAsync(1500);
    expect(history.versions.map((v) => v.name).sort()).toEqual(["Autosaved", "Original"]);
    expect(history.versions.every((v) => v.automatic)).toBe(true);
    history.dispose();
    session.pages.rotate([session.doc.pages[1]!.id], 90);
    await vi.advanceTimersByTimeAsync(5000);
    expect(storage.count(session.doc.id)).toBe(2);
  });

  it("keeps nothing by itself without `autoSave`", async () => {
    vi.useFakeTimers();
    const session = await open();
    const storage = memoryVersionStorage<PdfDoc>();
    const history = pdfVersionHistory(session, { storage, users: editor() });
    await history.ready;
    session.pages.rotate([session.doc.pages[0]!.id], 90);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(storage.count(session.doc.id)).toBe(0);
    history.dispose();
  });

  it("does not autosave for someone who may not edit", async () => {
    vi.useFakeTimers();
    const session = await open();
    const storage = memoryVersionStorage<PdfDoc>();
    const viewer = new Users({ current: { id: "vic", name: "Vic" }, role: "viewer" });
    const history = pdfVersionHistory(session, { storage, users: viewer, autoSave: { every: 100 } });
    await history.ready;
    session.pages.rotate([session.doc.pages[0]!.id], 90);
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.count(session.doc.id)).toBe(0);
    history.dispose();
  });

  it("adds a Restored entry after a restore and keeps every earlier version, or leaves it out with keepAfterRestore false", async () => {
    for (const keep of [undefined, false]) {
      const session = await open();
      const storage = memoryVersionStorage<PdfDoc>();
      const history = pdfVersionHistory(session, { storage, users: editor(), keepAfterRestore: keep });
      await history.ready;
      const saved = await history.save("Three pages");
      session.pages.remove([session.doc.pages[2]!.id]);
      await history.restore(saved.id);
      expect(session.doc.pages).toHaveLength(3);
      const names = history.versions.map((v) => v.name);
      expect(names).toContain("Three pages");
      expect(names).toContain('Before restoring "Three pages"');
      expect(names.includes('Restored "Three pages"')).toBe(keep !== false);
    }
  });
});

describe("missingVersionSources", () => {
  const source = (id: string): Source => ({ id, name: `${id}.pdf`, pages: 1, size: 10, hash: id });
  const doc = (): PdfDoc => ({
    id: "d",
    meta: {},
    sources: [source("main"), source("gone"), source("unused")],
    pages: [
      { id: "p1", from: { source: "main", index: 0 }, width: 100, height: 100, rotate: 0, annots: [] },
      { id: "p2", from: { source: "gone", index: 0 }, width: 100, height: 100, rotate: 0, annots: [] },
      { id: "p3", from: null, width: 100, height: 100, rotate: 0, annots: [] },
    ],
    outline: [],
    fields: [],
  });

  it("lists the sources of the version's pages that the store cannot give, and none when it has them all", async () => {
    const store = memorySourceStore({ main: new Uint8Array([1]), unused: new Uint8Array([2]) });
    expect((await missingVersionSources(doc(), store)).map((s) => s.id)).toEqual(["gone"]);
    store.put(source("gone"), new Uint8Array([3]));
    expect(await missingVersionSources(doc(), store)).toEqual([]);
  });

  it("counts a store that throws as missing", async () => {
    const store = { get: () => Promise.reject(new Error("offline")), put: () => {} };
    expect((await missingVersionSources(doc(), store)).map((s) => s.id)).toEqual(["main", "gone"]);
  });
});
