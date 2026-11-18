/** Test helper: opens PDF bytes with pdf.js in Node, renders a page to pixels, and reads its text. Not part of the package. */
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require_ = createRequire(import.meta.url);
const root = dirname(require_.resolve("pdfjs-dist/package.json"));
const standardFontDataUrl = join(root, "standard_fonts") + "/";

export interface Rendered {
  width: number;
  height: number;
  /** RGBA. */
  data: Uint8ClampedArray;
  text: string;
  pages: number;
  /** Text items as pdf.js reports them (width in page units at scale 1). */
  items: { str: string; width: number; x: number; y: number; font: string }[];
  /** Pixel at page coordinates in PDF points measured from the top left. */
  pixel(x: number, y: number): [number, number, number, number];
  /** How many pixels in the box (points from the top left) are not near white. */
  inkIn(x: number, y: number, w: number, h: number): number;
}

class CanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(pair: { canvas: { width: number; height: number } }, width: number, height: number) {
    pair.canvas.width = width;
    pair.canvas.height = height;
  }
  destroy(pair: { canvas: { width: number; height: number } }) {
    pair.canvas.width = 0;
    pair.canvas.height = 0;
  }
  // pdf.js 6 asks the factory for a context without an alpha channel when it draws a page.
  getNoAlphaContext(canvas: { getContext(kind: "2d", o?: object): unknown }) {
    return canvas.getContext("2d", { alpha: false });
  }
}

export async function renderPdf(bytes: Uint8Array, pageIndex = 0, scale = 2): Promise<Rendered> {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl, verbosity: 0, isEvalSupported: false, useSystemFonts: false, CanvasFactory } as never);
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context as never, viewport, canvas: canvas as never } as never).promise;
    const content = await page.getTextContent();
    const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    const items = content.items.flatMap((i) => ("str" in i ? [{ str: i.str, width: i.width, x: i.transform[4]!, y: i.transform[5]!, font: i.fontName }] : []));
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixel = (x: number, y: number): [number, number, number, number] => {
      const px = Math.floor(x * scale);
      const py = Math.floor(y * scale);
      const o = (py * canvas.width + px) * 4;
      return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!, image.data[o + 3]!];
    };
    const inkIn = (x: number, y: number, w: number, h: number): number => {
      let n = 0;
      for (let py = Math.floor(y * scale); py < Math.min(canvas.height, Math.ceil((y + h) * scale)); py++)
        for (let px = Math.floor(x * scale); px < Math.min(canvas.width, Math.ceil((x + w) * scale)); px++) {
          const o = (py * canvas.width + px) * 4;
          if (image.data[o]! < 235 || image.data[o + 1]! < 235 || image.data[o + 2]! < 235) n++;
        }
      return n;
    };
    return { width: canvas.width, height: canvas.height, data: image.data, text, pages: doc.numPages, items, pixel, inkIn };
  } finally {
    await doc.loadingTask.destroy();
  }
}
