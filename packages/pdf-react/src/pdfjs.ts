/**
 * The pdf.js renderer (`@pli.dev/pdf-react/pdfjs`).
 *
 *     import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
 *     <PliPdf session={session} renderer={pdfjsRenderer({ workerSrc })} />
 *
 * pdf.js (`pdfjs-dist`, Apache-2.0, Mozilla) is an optional peer dependency. It is imported with `import("pdfjs-dist")` the
 * first time a file is opened, so the 474 KB core and the 1.3 MB worker are not downloaded by pages that never show a PDF.
 *
 * SELF-HOSTING (no network needed): the worker, the character maps (`cmaps/`, for Chinese, Japanese, Korean and other
 * non-Latin fonts that are not embedded) and the standard fonts (`standard_fonts/`, for files that name Helvetica or Times
 * without embedding them) are files in `pdfjs-dist`. Ship them with your app and pass their addresses:
 *
 *     // Vite: `?url` gives the address of the file the build copies
 *     import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
 *     // webpack 5 / Vite / Rollup: the bundler copies the file when the URL is built like this
 *     const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
 *
 *     pdfjsRenderer({
 *       workerSrc,
 *       cMapUrl: "/pdfjs/cmaps/",                 // copy node_modules/pdfjs-dist/cmaps to your public folder
 *       standardFontDataUrl: "/pdfjs/standard_fonts/",
 *       wasmUrl: "/pdfjs/wasm/",                  // JPEG 2000 and other decoders (pdfjs-dist/wasm)
 *     });
 *
 * Without `workerSrc` (or `worker`) a browser cannot start the worker, and `open` fails with a message that says so: the
 * default of pdf.js is a relative path that only works from the folder the package is in. Pli never fetches from a CDN.
 * `disableWorker: true` runs pdf.js on the page itself (the main thread is blocked while it parses; use it only where
 * workers do not exist); it still needs `workerSrc`, which pdf.js loads as an ordinary script. To own the worker, create
 * it yourself and pass `worker: new pdfjs.PDFWorker({ port })`.
 *
 * ANNOTATIONS: pages are drawn with `annotationMode: DISABLE`. Pli draws annotations itself from the editable JSON in the
 * session, so a change shows at once and nothing is drawn twice (once by pdf.js from the file, once by Pli).
 *
 * MEMORY: pdf.js keeps decoded fonts, images and operator lists per page. `RenderedPage.destroy()` calls `page.cleanup()`,
 * `RenderedDocument.destroy()` ends the document and its worker task; the viewer calls them when pages scroll away and when a
 * source file leaves the document. The bytes you pass to `open` are copied (pdf.js would otherwise detach them).
 */
import { PliError } from "@pli.dev/core";
import { abortError, type OpenOptions, type PdfRenderer, type RenderedDocument, type RenderedOutlineItem, type RenderedPage, type RenderOptions, type TextRun } from "./renderer";

// The slice of the pdf.js API this file uses, so the UI does not depend on its (large, version-bound) types.
interface PdfjsViewport {
  width: number;
  height: number;
}
interface PdfjsRenderTask {
  promise: Promise<void>;
  cancel(): void;
}
interface PdfjsTextItem {
  str?: string;
  dir?: string;
  width?: number;
  height?: number;
  transform?: number[];
  hasEOL?: boolean;
}
interface PdfjsPage {
  view: number[];
  rotate: number;
  /** The page's /UserUnit: the size of a unit in 1/72 inch. pdf.js multiplies a viewport by it. */
  userUnit?: number;
  getViewport(o: { scale: number; rotation?: number }): PdfjsViewport;
  render(o: Record<string, unknown>): PdfjsRenderTask;
  getTextContent(o?: Record<string, unknown>): Promise<{ items: PdfjsTextItem[] }>;
  cleanup(): boolean | void;
}
interface PdfjsOutlineItem {
  title: string;
  bold?: boolean;
  italic?: boolean;
  dest?: string | unknown[] | null;
  url?: string | null;
  items?: PdfjsOutlineItem[];
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  getOutline(): Promise<PdfjsOutlineItem[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
  destroy(): Promise<void>;
}
export interface PdfjsModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfjsDocument>; destroy(): Promise<void> };
  GlobalWorkerOptions: { workerSrc: string };
  AnnotationMode?: { DISABLE: number; ENABLE?: number };
}

export interface PdfjsRendererOptions {
  /** The pdf.js module, if you load it yourself (the legacy build, or a different version). Default: `import("pdfjs-dist")`. */
  pdfjs?: PdfjsModule;
  /** Address of `pdf.worker.min.mjs`. */
  workerSrc?: string | URL;
  /** A pdf.js `PDFWorker` you made. */
  worker?: unknown;
  /** Folder of the character maps, with a trailing slash. */
  cMapUrl?: string;
  /** Folder of the standard fonts, with a trailing slash. */
  standardFontDataUrl?: string;
  /** Folder of pdf.js's WebAssembly decoders (JPEG 2000 and others), with a trailing slash. */
  wasmUrl?: string;
  /** Run pdf.js on the main thread. Needs `workerSrc` too. */
  disableWorker?: boolean;
}

const ASCENT = 0.8;

/** pdf.js text items to runs in page space (y down, not turned). */
export function textRuns(items: readonly PdfjsTextItem[], view: readonly number[]): TextRun[] {
  const [vx0 = 0, , , vy1 = 0] = view;
  const runs: TextRun[] = [];
  for (const item of items) {
    const t = item.transform;
    if (typeof item.str !== "string" || !t || t.length < 6) continue;
    if (item.str === "") {
      // An empty item can still end a line.
      if (item.hasEOL && runs.length) runs[runs.length - 1]!.eol = true;
      continue;
    }
    const [a, b, c, d, e, f] = t as [number, number, number, number, number, number];
    const size = item.height && item.height > 0 ? item.height : Math.hypot(c, d) || 10;
    const width = item.width && item.width > 0 ? item.width : size * 0.5 * item.str.length;
    // Angle of the baseline, clockwise on a page with y down.
    const angle = Math.atan2(-b, a);
    const ox = e - vx0;
    const oy = vy1 - f;
    const top = { x: ox + ASCENT * size * Math.sin(angle), y: oy - ASCENT * size * Math.cos(angle) };
    const run: TextRun = { str: item.str, x: round(top.x), y: round(top.y), w: round(width), h: round(size) };
    if (Math.abs(angle) > 1e-3) run.angle = round((angle * 180) / Math.PI);
    if (item.dir === "rtl" || item.dir === "ttb") run.dir = item.dir;
    if (item.hasEOL) run.eol = true;
    runs.push(run);
  }
  return runs;
}

const round = (n: number) => Math.round(n * 100) / 100;

class PdfjsRenderedPage implements RenderedPage {
  readonly width: number;
  readonly height: number;
  readonly rotate: number;
  private readonly page: PdfjsPage;
  private readonly mode: number;
  private textPromise?: Promise<TextRun[]>;

  constructor(page: PdfjsPage, mode: number) {
    this.page = page;
    this.mode = mode;
    this.width = page.view[2]! - page.view[0]!;
    this.height = page.view[3]! - page.view[1]!;
    this.rotate = ((page.rotate % 360) + 360) % 360;
  }

  async render({ canvas, scale, rotation, signal }: RenderOptions): Promise<void> {
    if (signal?.aborted) throw abortError();
    // `rotation` replaces the page's own /Rotate in pdf.js, which is what the document model means by `Page.rotate`.
    // `scale` is pixels per unit of the page's own box (what `width` and `height` are measured in, and what the overlays are scaled
    // by); pdf.js would multiply it by the page's /UserUnit and draw a page of user unit 2 four times as many pixels as the viewer
    // asked for (and allots memory for).
    const viewport = this.page.getViewport({ scale: scale / (this.page.userUnit && this.page.userUnit > 0 ? this.page.userUnit : 1), rotation });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PliError("unsupported", "the canvas has no 2d context");
    // The canvas is the viewport rounded UP to whole pixels, and the viewer stretches it over the page's box. Drawing the page
    // exactly as big as the canvas (not as big as the viewport) makes a point of the page land where the overlay layers, which
    // are scaled by exactly `scale`, put it: otherwise the picture is up to a pixel wider than they are.
    const fit = [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0];
    const task = this.page.render({ canvas, canvasContext: ctx, viewport, annotationMode: this.mode, ...(Math.abs(fit[0]! - 1) > 1e-9 || Math.abs(fit[3]! - 1) > 1e-9 ? { transform: fit } : {}) });
    const cancel = () => task.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await task.promise;
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && e.name === "RenderingCancelledException")) throw abortError();
      throw e;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  text(): Promise<TextRun[]> {
    this.textPromise ??= this.page.getTextContent({ includeMarkedContent: false, disableNormalization: false }).then((c) => textRuns(c.items, this.page.view));
    return this.textPromise;
  }

  destroy(): void {
    try {
      this.page.cleanup();
    } catch {
      // already gone
    }
  }
}

class PdfjsRenderedDocument implements RenderedDocument {
  readonly pages: number;
  private readonly doc: PdfjsDocument;
  private readonly task: { destroy(): Promise<void> };
  private readonly mode: number;
  private readonly cache = new Map<number, Promise<RenderedPage>>();

  constructor(doc: PdfjsDocument, task: { destroy(): Promise<void> }, mode: number) {
    this.doc = doc;
    this.task = task;
    this.mode = mode;
    this.pages = doc.numPages;
  }

  page(index: number): Promise<RenderedPage> {
    let p = this.cache.get(index);
    if (!p) {
      p = this.doc.getPage(index + 1).then((page) => new PdfjsRenderedPage(page, this.mode));
      this.cache.set(index, p);
      p.catch(() => this.cache.delete(index));
    }
    return p;
  }

  async outline(): Promise<RenderedOutlineItem[]> {
    const raw = await this.doc.getOutline().catch(() => null);
    if (!raw) return [];
    const walk = async (items: PdfjsOutlineItem[]): Promise<RenderedOutlineItem[]> => {
      const out: RenderedOutlineItem[] = [];
      for (const it of items) {
        const node: RenderedOutlineItem = { title: it.title, children: [] };
        if (it.bold) node.bold = true;
        if (it.italic) node.italic = true;
        if (it.url) node.uri = it.url;
        try {
          const dest = typeof it.dest === "string" ? await this.doc.getDestination(it.dest) : it.dest;
          if (Array.isArray(dest) && dest[0] !== null && dest[0] !== undefined) {
            const index = typeof dest[0] === "number" ? dest[0] : await this.doc.getPageIndex(dest[0]);
            node.page = index;
            const kind = (dest[1] as { name?: string } | undefined)?.name;
            if (kind === "XYZ" && typeof dest[3] === "number") {
              const page = await this.doc.getPage(index + 1);
              node.y = Math.max(0, round(page.view[3]! - dest[3]));
            }
          }
        } catch {
          // a destination that does not resolve is shown without a target
        }
        node.children = it.items?.length ? await walk(it.items) : [];
        out.push(node);
      }
      return out;
    };
    return walk(raw);
  }

  async destroy(): Promise<void> {
    this.cache.clear();
    await this.task.destroy().catch(() => {});
  }
}

/** A `PdfRenderer` that uses pdf.js. See the notes at the top of this file for hosting its files. */
export function pdfjsRenderer(options: PdfjsRendererOptions = {}): PdfRenderer {
  let loading: Promise<PdfjsModule> | undefined;
  const load = (): Promise<PdfjsModule> => {
    loading ??= (async () => {
      const mod = options.pdfjs ?? ((await import("pdfjs-dist")) as unknown as PdfjsModule);
      if (options.workerSrc) mod.GlobalWorkerOptions.workerSrc = String(options.workerSrc);
      else if (!mod.GlobalWorkerOptions.workerSrc && !options.worker && typeof document !== "undefined") {
        throw new PliError("unsupported", "pdf.js needs its worker file: pass `workerSrc` (or `worker`) to pdfjsRenderer(). See @pli.dev/pdf-react/pdfjs for how to host it.");
      }
      return mod;
    })();
    loading.catch(() => (loading = undefined));
    return loading;
  };
  return {
    async open(bytes: Uint8Array, open: OpenOptions = {}): Promise<RenderedDocument> {
      const pdfjs = await load();
      const params: Record<string, unknown> = {
        // pdf.js hands the buffer to its worker, which would empty ours.
        data: bytes.slice(),
        isEvalSupported: false,
        cMapPacked: true,
        verbosity: 0,
      };
      if (open.password) params.password = open.password;
      if (options.cMapUrl) params.cMapUrl = options.cMapUrl;
      if (options.standardFontDataUrl) params.standardFontDataUrl = options.standardFontDataUrl;
      if (options.wasmUrl) params.wasmUrl = options.wasmUrl;
      if (options.worker) params.worker = options.worker;
      if (options.disableWorker) params.disableWorker = true;
      const task = pdfjs.getDocument(params);
      try {
        const doc = await task.promise;
        return new PdfjsRenderedDocument(doc, task, open.annotations ? (pdfjs.AnnotationMode?.ENABLE ?? 1) : (pdfjs.AnnotationMode?.DISABLE ?? 0));
      } catch (e) {
        await task.destroy().catch(() => {});
        const name = e instanceof Error ? e.name : "";
        if (name === "PasswordException") throw new PliError("unsupported", (e as Error).message || "password required");
        if (name === "InvalidPDFException") throw new PliError("invalid_document", (e as Error).message || "not a PDF file");
        throw e;
      }
    },
  };
}
