// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { hashBytes } from "@pli.dev/pdf";
import { PageSources, RenderQueue, blankPage } from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { buildPdf } from "./pdfbuild";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("PageSources", () => {
  it("opens each source once and hands out its pages", async () => {
    const session = testSession({ pages: 4 });
    const fake = fakeRenderer({ pages: 4 });
    const sources = new PageSources(session, fake);
    const a = sources.acquire(session.doc.pages[0]!);
    const b = sources.acquire(session.doc.pages[3]!);
    const [pa, pb] = await Promise.all([a.promise, b.promise]);
    expect([pa.width, pb.height]).toEqual([612, 792]);
    expect(fake.stats.opens).toBe(1);
    expect(fake.stats.pagesLoaded).toEqual([0, 3]);
    // asking for a page again shares it
    const again = sources.acquire(session.doc.pages[0]!);
    expect(await again.promise).toBe(pa);
    expect(fake.stats.pagesLoaded).toEqual([0, 3]);
  });

  it("makes blank pages white without a renderer", async () => {
    const session = testSession({ pages: 1, blank: 2 });
    const fake = fakeRenderer({ pages: 1 });
    const sources = new PageSources(session, fake);
    const page = await sources.acquire(session.doc.pages[1]!).promise;
    expect([page.width, page.height, page.rotate]).toEqual([612, 792, 0]);
    expect(await page.text()).toEqual([]);
    const canvas = document.createElement("canvas");
    await page.render({ canvas, scale: 0.5, rotation: 270 });
    expect([canvas.width, canvas.height]).toEqual([396, 306]);
    expect(fake.stats.opens).toBe(0);
    expect((await blankPage(10, 20).text()).length).toBe(0);
  });

  it("frees pages nobody uses, keeping the most recent ones", async () => {
    const session = testSession({ pages: 6 });
    const fake = fakeRenderer({ pages: 6 });
    const sources = new PageSources(session, fake, { maxIdle: 2 });
    for (let i = 0; i < 6; i++) {
      const lease = sources.acquire(session.doc.pages[i]!);
      await lease.promise;
      lease.release();
    }
    await tick();
    expect(fake.stats.destroyedPages).toEqual([0, 1, 2, 3]);
    // a page that is in use is not freed
    const held = sources.acquire(session.doc.pages[4]!);
    for (let i = 0; i < 4; i++) {
      const lease = sources.acquire(session.doc.pages[i]!);
      await lease.promise;
      lease.release();
    }
    await tick();
    expect(fake.stats.destroyedPages).not.toContain(4);
    held.release();
  });

  it("forgets a file when its bytes change and opens it again", async () => {
    const session = testSession({ pages: 2 });
    const fake = fakeRenderer({ pages: 2 });
    const sources = new PageSources(session, fake);
    const lease = sources.acquire(session.doc.pages[0]!);
    await lease.promise;
    const bytes = new TextEncoder().encode("%PDF-1.7 changed");
    const source = { ...session.doc.sources[0]!, hash: hashBytes(bytes), size: bytes.length };
    await session.sources.put(source, bytes);
    session.transact([{ type: "patch_source", id: "main", patch: { hash: source.hash, size: source.size } }]);
    const next = sources.acquire(session.doc.pages[0]!);
    await next.promise;
    await tick();
    expect(fake.stats.opens).toBe(2);
    expect(fake.stats.destroyedDocs).toBe(1);
    expect(fake.stats.destroyedPages).toEqual([0]);
  });

  it("forgets a file that is no longer a source", async () => {
    const session = testSession({ pages: 2 });
    const fake = fakeRenderer({ pages: 2 });
    const sources = new PageSources(session, fake);
    await sources.acquire(session.doc.pages[1]!).promise;
    session.transact([{ type: "remove_page", id: "p:main:0" }, { type: "remove_page", id: "p:main:1" }, { type: "remove_source", id: "main" }]);
    sources.sync();
    await tick();
    expect(fake.stats.destroyedDocs).toBe(1);
  });

  it("rejects, rather than hanging, when the bytes or the page are missing", async () => {
    const session = testSession({ pages: 2 });
    const store = session.sources;
    // a source the store does not have
    session.transact([{ type: "insert_source", source: { id: "gone", name: "gone.pdf", pages: 1, size: 3, hash: "x" } }]);
    session.transact([{ type: "insert_page", page: { id: "g0", from: { source: "gone", index: 0 }, width: 10, height: 10, rotate: 0, annots: [] }, after: null }]);
    const sources = new PageSources(session, fakeRenderer({ pages: 2 }));
    await expect(sources.acquire(session.doc.pages[0]!).promise).rejects.toThrow(/not available/);
    session.transact([{ type: "insert_page", page: { id: "g9", from: { source: "main", index: 9 }, width: 10, height: 10, rotate: 0, annots: [] }, after: null }]);
    await expect(sources.acquire(session.doc.pages[0]!).promise).rejects.toThrow(/no page 10/);
    session.transact([{ type: "insert_page", page: { id: "g8", from: { source: "nope", index: 0 }, width: 10, height: 10, rotate: 0, annots: [] }, after: null }]);
    await expect(sources.acquire(session.doc.pages[0]!).promise).rejects.toThrow(/not in the document/);
    expect(store).toBe(session.sources);
  });

  it("keeps the text of pages for search", async () => {
    const session = testSession({ pages: 2 });
    const fake = fakeRenderer({ pages: 2 });
    const sources = new PageSources(session, fake, { maxIdle: 0 });
    const first = await sources.text(session.doc.pages[0]!);
    const again = await sources.text(session.doc.pages[0]!);
    expect(again).toBe(first);
    expect(first[0]!.str).toBe("Page 1");
    expect(fake.stats.pagesLoaded).toEqual([0]);
  });

  it("can be destroyed and used again (as under React strict mode)", async () => {
    const session = testSession({ pages: 2 });
    const fake = fakeRenderer({ pages: 2 });
    const sources = new PageSources(session, fake);
    await sources.acquire(session.doc.pages[0]!).promise;
    sources.destroy();
    await tick();
    expect(fake.stats.destroyedDocs).toBe(1);
    await sources.acquire(session.doc.pages[0]!).promise;
    expect(fake.stats.opens).toBe(2);
  });
});

describe("RenderQueue", () => {
  it("runs the most important jobs first, a few at a time", async () => {
    const q = new RenderQueue(2);
    const order: string[] = [];
    let gate!: () => void;
    const hold = new Promise<void>((r) => (gate = r));
    const job = (name: string, priority: number) => q.add(priority, async () => (order.push(name), await hold));
    const a = job("far", 30);
    const b = job("near", 10);
    const c = job("visible", 0);
    const d = job("visible2", 0);
    await tick();
    expect(order).toEqual(["visible", "visible2"]); // two at once, the visible ones first
    expect(q.stats.peak).toBe(2);
    gate();
    await Promise.all([a.done, b.done, c.done, d.done]);
    expect(order).toEqual(["visible", "visible2", "near", "far"]);
  });

  it("takes a waiting job out when cancelled, and aborts a running one", async () => {
    const q = new RenderQueue(1);
    let aborted = false;
    const running = q.add(0, (signal) => new Promise<void>((_, reject) => signal.addEventListener("abort", () => ((aborted = true), reject(Object.assign(new Error("x"), { name: "AbortError" }))))));
    let ran = false;
    const waiting = q.add(1, async () => void (ran = true));
    await tick();
    waiting.cancel();
    running.cancel();
    await Promise.all([running.done, waiting.done]);
    expect(aborted).toBe(true);
    expect(ran).toBe(false);
    expect(q.size).toBe(0);
  });

  it("lets a job be made more important while it waits", async () => {
    const q = new RenderQueue(1);
    const order: string[] = [];
    let gate!: () => void;
    const hold = new Promise<void>((r) => (gate = r));
    q.add(0, () => hold);
    const slow = q.add(20, async () => void order.push("was far"));
    const other = q.add(10, async () => void order.push("near"));
    slow.priority = 1;
    gate();
    await Promise.all([slow.done, other.done]);
    expect(order).toEqual(["was far", "near"]);
  });
});

// `openPdf` is written by the engine's reader; once it exists a file goes all the way in.
const engine = (await import("@pli.dev/pdf")) as unknown as { openPdf?: (bytes: Uint8Array) => Promise<import("@pli.dev/pdf").PdfSession> | import("@pli.dev/pdf").PdfSession };
describe.skipIf(!engine.openPdf)("a file opened with openPdf", () => {
  it("is shown page by page by the renderer", async () => {
    const bytes = buildPdf([{ width: 200, height: 100 }, { width: 300, height: 400 }]);
    const session = await engine.openPdf!(bytes);
    const fake = fakeRenderer({ pages: [{ width: 200, height: 100 }, { width: 300, height: 400 }] });
    const sources = new PageSources(session, fake);
    expect(session.doc.pages).toHaveLength(2);
    const second = await sources.acquire(session.doc.pages[1]!).promise;
    expect([second.width, second.height]).toEqual([300, 400]);
    expect(fake.stats.opens).toBe(1);
  });
});
