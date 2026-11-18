/** Test helpers for the page tests: what pdf.js sees in a file (pages, sizes, rotation, text, labels, outline) and a raw search of the file. */
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PdfFile, PdfStream } from "../../src/cos";

const require_ = createRequire(import.meta.url);
const standardFontDataUrl = join(dirname(require_.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

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

export interface PageSeen {
  /** The size as pdf.js shows the page (rotation applied). */
  width: number;
  height: number;
  rotate: number;
  text: string;
}

export interface FileSeen {
  pages: PageSeen[];
  labels: string[] | null;
  outline: { title: string; page: number | null; items: unknown[] }[] | null;
}

type PdfjsDoc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

/** Opens the bytes with pdf.js and reads every page. Throws when pdf.js cannot open the file. */
export async function seen(bytes: Uint8Array, withOutline = false): Promise<FileSeen> {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl, verbosity: 0, isEvalSupported: false, useSystemFonts: false, CanvasFactory } as never);
  const doc: PdfjsDoc = await task.promise;
  try {
    const pages: PageSeen[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const v = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ width: Math.round(v.width * 100) / 100, height: Math.round(v.height * 100) / 100, rotate: page.rotate, text: content.items.map((it) => ("str" in it ? it.str : "")).join(" ").trim() });
    }
    const labels = (await doc.getPageLabels()) as string[] | null;
    let outline: FileSeen["outline"] = null;
    if (withOutline) {
      const raw = (await doc.getOutline()) as { title: string; dest: unknown; items: unknown[] }[] | null;
      const resolve = async (list: typeof raw): Promise<NonNullable<FileSeen["outline"]>> => {
        const out: NonNullable<FileSeen["outline"]> = [];
        for (const item of list ?? []) {
          let dest = item.dest;
          if (typeof dest === "string") dest = await doc.getDestination(dest);
          let page: number | null = null;
          if (Array.isArray(dest) && dest[0] && typeof dest[0] === "object") page = await doc.getPageIndex(dest[0] as never);
          out.push({ title: item.title, page, items: await resolve(item.items as typeof raw) });
        }
        return out;
      };
      outline = raw ? await resolve(raw) : [];
    }
    return { pages, labels, outline };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** The text of each page, as pdf.js reads it. */
export async function texts(bytes: Uint8Array): Promise<string[]> {
  return (await seen(bytes)).pages.map((p) => p.text);
}

/** Whether `needle` is anywhere in the file: in its raw bytes, or in a stream once decoded. */
export function fileContains(bytes: Uint8Array, needle: string): boolean {
  const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
  if (latin(bytes).includes(needle)) return true;
  const file = PdfFile.open(bytes);
  for (const n of file.objectNumbers()) {
    const o = file.getRef(n);
    if (o instanceof PdfStream) {
      try {
        if (latin(file.decode(o)).includes(needle)) return true;
      } catch {
        // an image stream: not text
      }
    }
  }
  return false;
}
