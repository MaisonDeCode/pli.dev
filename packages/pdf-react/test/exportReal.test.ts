// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPdf } from "@pli.dev/pdf";
import { exportPageImages } from "../src";
import { pdfjsRenderer } from "../src/pdfjs";
import { buildPdf } from "./pdfbuild";

// Pictures of pages from a REAL renderer (pdf.js, with node-canvas as the canvas): annotations of the saved file must be in them.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/pdfjs-dist");
const renderer = () => pdfjsRenderer({ pdfjs: pdfjs as never, standardFontDataUrl: path.join(root, "standard_fonts") + "/" });

type Shim = { createElement(tag: string): unknown };
const g = globalThis as unknown as { document?: Shim };
let saved: Shim | undefined;
beforeEach(() => {
  saved = g.document;
  g.document = {
    createElement: () => {
      const c = createCanvas(1, 1) as unknown as HTMLCanvasElement & { toBuffer(type: string, quality?: number): Buffer };
      // node-canvas has no toBlob: make one from toBuffer, as a browser's canvas would answer
      c.toBlob = (cb, type, quality) => cb(new Blob([new Uint8Array(c.toBuffer(type ?? "image/png", type === "image/jpeg" ? Math.round((quality ?? 0.9) * 100) : undefined))], { type: type ?? "image/png" }));
      return c;
    },
  };
});
afterEach(() => {
  g.document = saved;
});

async function pixels(data: Uint8Array) {
  const img = await loadImage(Buffer.from(data));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, at: (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data] };
}

async function markedSession() {
  const session = await openPdf(buildPdf([{ width: 200, height: 100 }, { width: 200, height: 100 }]), { name: "marked.pdf" });
  session.annots.add("p:main:0", { type: "square", rect: { x: 20, y: 10, w: 60, h: 40 }, stroke: { color: "#ff0000", width: 2 }, fill: "#ff0000" });
  return session;
}

describe("page pictures from the saved file", () => {
  it("show the annotations (a renderer that is told to draw them), on white paper", async () => {
    const session = await markedSession();
    const bytes = await session.save();
    const [png] = await exportPageImages({ renderer: renderer(), bytes, pages: [0], format: "png", dpi: 72 });
    const p = await pixels(png!.data);
    expect([p.width, p.height]).toEqual([200, 100]);
    expect(p.at(50, 30)).toEqual([255, 0, 0, 255]);
    expect(p.at(150, 80)).toEqual([255, 255, 255, 255]);
    // the viewer's own way of opening a file (no annotations) leaves the square out: that is why the export asks for them
    const plain = await renderer().open(bytes);
    const page = await plain.page(0);
    const c = createCanvas(1, 1) as unknown as HTMLCanvasElement;
    await page.render({ canvas: c, scale: 1, rotation: page.rotate });
    expect([...(c as never as { getContext(t: string): CanvasRenderingContext2D }).getContext("2d").getImageData(50, 30, 1, 1).data]).not.toEqual([255, 0, 0, 255]);
  });

  it("scale with the resolution, turn with the page, and JPEG has a white page", async () => {
    const session = await markedSession();
    session.pages.rotate(["p:main:0"], 90);
    const bytes = await session.save();
    const out = await exportPageImages({ renderer: renderer(), bytes, pages: [0, 1], format: "jpeg", dpi: 144, quality: 0.95 });
    expect(out.map((o) => o.index)).toEqual([0, 1]);
    const first = await pixels(out[0]!.data);
    expect([first.width, first.height]).toEqual([200, 400]); // 100 x 200 points turned, at twice 72 dpi
    const second = await pixels(out[1]!.data);
    expect([second.width, second.height]).toEqual([400, 200]);
    const white = second.at(300, 150);
    expect(white[0]).toBeGreaterThan(245);
    expect(white[1]).toBeGreaterThan(245);
    expect(white[2]).toBeGreaterThan(245);
    // the square is in the turned picture: a quarter turn clockwise puts its top left corner at the top right
    const inside = first.at(160, 60);
    expect(inside[0]).toBeGreaterThan(200);
    expect(inside[1]).toBeLessThan(60);
  });

  it("report progress and stop on abort", async () => {
    const session = await markedSession();
    const bytes = await session.save();
    const seen: number[] = [];
    const ctl = new AbortController();
    await expect(
      exportPageImages({
        renderer: renderer(),
        bytes,
        pages: [0, 1],
        format: "png",
        dpi: 72,
        signal: ctl.signal,
        onProgress: (done) => {
          seen.push(done);
          ctl.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([1]);
  });
});
