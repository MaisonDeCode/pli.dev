// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PageSources, type RenderedDocument } from "../src/index";
import { pdfjsRenderer } from "../src/pdfjs";
import { testSession } from "../src/testing";
import { buildPdf } from "./pdfbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/pdfjs-dist");
const make = () => pdfjsRenderer({ pdfjs: pdfjs as never, standardFontDataUrl: path.join(root, "standard_fonts") + "/" });
const canvas = () => createCanvas(1, 1) as unknown as HTMLCanvasElement;
const pixel = (c: HTMLCanvasElement, x: number, y: number) => [...(c as never as { getContext(t: string): CanvasRenderingContext2D }).getContext("2d").getImageData(x, y, 1, 1).data];
const RED = [255, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

const bytes = buildPdf(
  [
    { width: 200, height: 100, texts: [{ x: 20, y: 40, size: 20, text: "Hello world" }], rects: [{ x: 0, y: 0, w: 50, h: 30, rgb: [1, 0, 0] }] },
    { width: 200, height: 100, rotate: 90, rects: [{ x: 0, y: 0, w: 50, h: 30, rgb: [1, 0, 0] }] },
    { width: 300, height: 200, texts: [{ x: 30, y: 120, size: 24, text: "Quick brown fox" }, { x: 30, y: 60, size: 12, text: "Second line (with) parens" }] },
  ],
  [{ title: "One", page: 0, children: [{ title: "Two", page: 2 }] }, { title: "Three", page: 1 }],
);

async function open(): Promise<RenderedDocument> {
  return make().open(bytes);
}

/** The box around the dark pixels of a canvas, or null. */
function ink(c: HTMLCanvasElement, within?: { x: number; y: number; w: number; h: number }) {
  const ctx = (c as never as { getContext(t: string): CanvasRenderingContext2D }).getContext("2d");
  const x0 = Math.floor(within?.x ?? 0);
  const y0 = Math.floor(within?.y ?? 0);
  const w = Math.min(c.width - x0, Math.ceil(within?.w ?? c.width));
  const h = Math.min(c.height - y0, Math.ceil(within?.h ?? c.height));
  const data = ctx.getImageData(x0, y0, w, h).data;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i]! < 128 && data[i + 1]! < 128 && data[i + 2]! < 128) {
      minX = Math.min(minX, x + x0); maxX = Math.max(maxX, x + x0); minY = Math.min(minY, y + y0); maxY = Math.max(maxY, y + y0);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

describe("pdfjsRenderer", () => {
  it("opens a file and reports the pages with their size before rotation, and their own /Rotate", async () => {
    const copy = bytes.slice();
    const doc = await make().open(copy);
    expect(doc.pages).toBe(3);
    expect(copy).toEqual(bytes); // pdf.js was given a copy, ours is not emptied
    expect(copy.length).toBeGreaterThan(0);
    const a = await doc.page(0);
    const b = await doc.page(1);
    expect([a.width, a.height, a.rotate]).toEqual([200, 100, 0]);
    expect([b.width, b.height, b.rotate]).toEqual([200, 100, 90]);
    expect(await doc.page(0)).toBe(a);
    a.destroy();
    await doc.destroy();
  });

  it("draws the page: colours land where the file put them, at the scale asked for", async () => {
    const doc = await open();
    const page = await doc.page(0);
    const c = canvas();
    await page.render({ canvas: c, scale: 2, rotation: 0 });
    expect([c.width, c.height]).toEqual([400, 200]);
    // the red rectangle is at the bottom left in PDF space: 50 by 30 points
    expect(pixel(c, 10, 190)).toEqual(RED);
    expect(pixel(c, 90, 150)).toEqual(RED);
    expect(pixel(c, 110, 190)).toEqual(WHITE);
    expect(pixel(c, 300, 20)).toEqual(WHITE);
    // and there is dark text where "Hello world" is
    expect(ink(c, { x: 30, y: 60, w: 300, h: 50 })).not.toBeNull();
    await doc.destroy();
  });

  it("takes the rotation to show: it replaces the page's own /Rotate", async () => {
    const doc = await open();
    const plain = await doc.page(0);
    const c = canvas();
    await plain.render({ canvas: c, scale: 1, rotation: 90 });
    expect([c.width, c.height]).toEqual([100, 200]);
    // turned a quarter clockwise, the bottom left goes to the top left
    expect(pixel(c, 5, 5)).toEqual(RED);
    expect(pixel(c, 5, 150)).toEqual(WHITE);
    await plain.render({ canvas: c, scale: 1, rotation: 180 });
    expect([c.width, c.height]).toEqual([200, 100]);
    expect(pixel(c, 195, 5)).toEqual(RED);
    await plain.render({ canvas: c, scale: 1, rotation: 270 });
    expect(pixel(c, 95, 195)).toEqual(RED);
    // a page whose file says /Rotate 90, shown with rotation 0, is not turned
    const turned = await doc.page(1);
    const d = canvas();
    await turned.render({ canvas: d, scale: 1, rotation: 0 });
    expect([d.width, d.height]).toEqual([200, 100]);
    expect(pixel(d, 5, 95)).toEqual(RED);
    await turned.render({ canvas: d, scale: 1, rotation: 90 });
    expect([d.width, d.height]).toEqual([100, 200]);
    await doc.destroy();
  });

  it("gives text runs in page space whose boxes hold the drawn glyphs, at every turn", async () => {
    const doc = await open();
    const page = await doc.page(2);
    const runs = await page.text();
    expect(runs.map((r) => r.str)).toEqual(["Quick brown fox", "Second line (with) parens"]);
    const first = runs[0]!;
    // baseline at y = 200 - 120 = 80 from the top, 24 pt text: the box is 24 high, 0.8 of it above the baseline
    expect(first.x).toBeCloseTo(30, 1);
    expect(first.y).toBeCloseTo(80 - 0.8 * 24, 1);
    expect(first.h).toBeCloseTo(24, 1);
    expect(first.w).toBeGreaterThan(120);
    expect(first.w).toBeLessThan(200);
    expect(first.angle).toBeUndefined();
    const c = canvas();
    await page.render({ canvas: c, scale: 1, rotation: 0 });
    for (const run of runs) {
      const box = ink(c, { x: run.x - 10, y: run.y - 10, w: run.w + 20, h: run.h + 20 })!;
      expect(box).not.toBeNull();
      // the ink is inside the run's box (a little slack for antialiasing and descenders)
      expect(box.x).toBeGreaterThanOrEqual(run.x - 2);
      expect(box.x + box.w).toBeLessThanOrEqual(run.x + run.w + 2);
      expect(box.y).toBeGreaterThanOrEqual(run.y - 3);
      expect(box.y + box.h).toBeLessThanOrEqual(run.y + run.h + 3);
      expect(box.w).toBeGreaterThan(run.w * 0.8);
    }
    // the same run for a page whose file turns it: text is in unrotated page space either way
    const turned = await (await open()).page(0);
    const r0 = (await turned.text())[0]!;
    expect(r0.x).toBeCloseTo(20, 1);
    expect(r0.y).toBeCloseTo(60 - 0.8 * 20, 1);
    await doc.destroy();
  });

  it("stops rendering when the signal is aborted", async () => {
    const doc = await open();
    const page = await doc.page(0);
    const ctl = new AbortController();
    ctl.abort();
    await expect(page.render({ canvas: canvas(), scale: 1, rotation: 0, signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
    const ctl2 = new AbortController();
    const p = page.render({ canvas: canvas(), scale: 4, rotation: 0, signal: ctl2.signal });
    ctl2.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    // a later render still works
    const c = canvas();
    await page.render({ canvas: c, scale: 1, rotation: 0 });
    expect(pixel(c, 5, 95)).toEqual(RED);
    await doc.destroy();
  });

  it("reads the outline of the file, with pages as numbers", async () => {
    const doc = await open();
    const items = await doc.outline!();
    expect(items.map((i) => [i.title, i.page])).toEqual([["One", 0], ["Three", 1]]);
    expect(items[0]!.children.map((i) => [i.title, i.page])).toEqual([["Two", 2]]);
    await doc.destroy();
  });

  it("fails clearly for a file that is not a PDF", async () => {
    await expect(make().open(new TextEncoder().encode("this is not a pdf"))).rejects.toMatchObject({ code: "invalid_document" });
  });

  it("says what is missing when a browser has no worker configured", async () => {
    const fake = { getDocument: () => { throw new Error("should not get here"); }, GlobalWorkerOptions: { workerSrc: "" } };
    (globalThis as { document?: unknown }).document = {};
    try {
      await expect(pdfjsRenderer({ pdfjs: fake as never }).open(bytes)).rejects.toThrow(/workerSrc/);
      await expect(pdfjsRenderer({ pdfjs: fake as never, workerSrc: "/w.mjs" }).open(bytes)).rejects.toThrow("should not get here");
      expect(fake.GlobalWorkerOptions.workerSrc).toBe("/w.mjs");
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it("draws pages of a session through the page cache, blank pages white, and reopens a changed file", async () => {
    const session = testSession({ pages: 3, bytes, blank: 1 });
    const sources = new PageSources(session, make());
    const lease = sources.acquire(session.doc.pages[0]!);
    const page = await lease.promise;
    const c = canvas();
    await page.render({ canvas: c, scale: 1, rotation: 0 });
    expect(pixel(c, 5, 95)).toEqual(RED);
    const blank = await sources.acquire(session.doc.pages[3]!).promise;
    const b = canvas();
    await blank.render({ canvas: b, scale: 0.5, rotation: 90 });
    expect([b.width, b.height]).toEqual([396, 306]);
    expect(pixel(b, 100, 100)).toEqual(WHITE);
    expect(sources.stats.opened).toBe(1);
    // search text through the same cache
    const runs = await sources.text(session.doc.pages[2]!);
    expect(runs[0]!.str).toBe("Quick brown fox");
    lease.release();
    sources.destroy();
  });
});
