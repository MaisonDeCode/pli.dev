/** Pages as pictures: draws pages of a PDF with the viewer's renderer and saves each as PNG or JPEG. */
import { PliError } from "@pli.dev/core";
import { canvasScale } from "./geometry";
import { abortError, type PdfRenderer } from "./renderer";

export interface ExportImagesOptions {
  renderer: PdfRenderer;
  /** The file to draw. Pass the SAVED bytes, so annotations and form fields are in the pictures. */
  bytes: Uint8Array;
  password?: string;
  /** Pages to draw, 0-based, in this order. */
  pages: readonly number[];
  format: "png" | "jpeg";
  /** Pixels per inch (72 is one pixel per point). */
  dpi: number;
  /** JPEG quality, 0 to 1 (default 0.92). */
  quality?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface PageImage {
  /** 0-based position of the page. */
  index: number;
  data: Uint8Array;
  width: number;
  height: number;
}

export const IMAGE_MIME = { png: "image/png", jpeg: "image/jpeg" } as const;

function readBlob(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function toBytes(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") return reject(new PliError("unsupported", "This browser cannot save a page as a picture."));
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new PliError("unsupported", "The page could not be saved as a picture (it may be too big)."));
        readBlob(blob).then(resolve, reject);
      },
      mime,
      quality,
    );
  });
}

/** Draws pages one at a time (so memory stays small) and returns the pictures. Stops with an AbortError when `signal` aborts. */
export async function exportPageImages(o: ExportImagesOptions): Promise<PageImage[]> {
  const doc = await o.renderer.open(o.bytes, { ...(o.password ? { password: o.password } : {}), annotations: true });
  const out: PageImage[] = [];
  try {
    for (let n = 0; n < o.pages.length; n++) {
      if (o.signal?.aborted) throw abortError();
      const index = o.pages[n]!;
      const page = await doc.page(index);
      try {
        const { scale } = canvasScale(page.width, page.height, o.dpi / 72, 1);
        const canvas = document.createElement("canvas");
        await page.render({ canvas, scale, rotation: page.rotate, signal: o.signal });
        if (o.signal?.aborted) throw abortError();
        // Paper is white: draw on white so a picture has no see-through page (and a JPEG no black one).
        let flat = canvas;
        const ctx = (() => {
          try {
            const c = document.createElement("canvas");
            c.width = canvas.width;
            c.height = canvas.height;
            const g = c.getContext("2d");
            if (g) flat = c;
            return g;
          } catch {
            return null;
          }
        })();
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, flat.width, flat.height);
          ctx.drawImage(canvas, 0, 0);
        }
        const data = await toBytes(flat, IMAGE_MIME[o.format], o.quality ?? 0.92);
        out.push({ index, data, width: canvas.width, height: canvas.height });
      } finally {
        page.destroy();
      }
      o.onProgress?.(n + 1, o.pages.length);
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
