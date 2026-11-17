/**
 * Helpers for testing code that uses the viewer (`@pli.dev/pdf-react/testing`): a renderer that draws labelled rectangles
 * instead of pages, and a session built by hand. Nothing here needs pdf.js, a PDF file or a real canvas.
 */
import { MAIN_SOURCE, PdfSession, emptyDoc, hashBytes, type OutlineItem, type Page, type PdfDoc, type Rotation, type Source } from "@pli.dev/pdf";
import { abortError, type OpenOptions, type PdfRenderer, type RenderedDocument, type RenderedOutlineItem, type RenderedPage, type RenderOptions, type TextRun } from "./renderer";

export interface FakePageSpec {
  width?: number;
  height?: number;
  /** The source page's own /Rotate. */
  rotate?: number;
  text?: TextRun[];
}

export interface FakeRendererOptions {
  /** How many pages the files have, or a spec for each page. Default 3. */
  pages?: number | FakePageSpec[];
  /** Milliseconds each `render` takes (default 0: it still waits for a microtask). */
  latency?: number;
  /** The outline `RenderedDocument.outline()` returns. */
  outline?: RenderedOutlineItem[];
  /** Text of a page; the default has a title, a phrase split over two runs and a line of words. */
  text?: (index: number, width: number, height: number) => TextRun[];
}

export interface RenderCall {
  /** 0-based position in the file. */
  page: number;
  scale: number;
  rotation: number;
  /** Rendering finished (false: aborted). */
  done: boolean;
}

export interface FakeRenderer extends PdfRenderer {
  /** What happened, for assertions. */
  readonly stats: {
    opens: number;
    destroyedDocs: number;
    pagesLoaded: number[];
    destroyedPages: number[];
    renders: RenderCall[];
    /** Pages being drawn right now. */
    active: number;
  };
  /** Make `render` wait until `release()` (to test cancelling and priorities). */
  hold(): void;
  release(): void;
}

/** Runs of text for a page of the fake renderer: deterministic, in page space. */
export function defaultFakeText(index: number, width: number, _height: number): TextRun[] {
  const run = (str: string, x: number, y: number, h: number, eol = false): TextRun => ({ str, x, y, w: Math.round(str.length * h * 0.5 * 100) / 100, h, ...(eol ? { eol } : {}) });
  void width;
  return [run(`Page ${index + 1}`, 72, 72, 18, true), run("Hello ", 72, 110, 12), run("world", 72 + 6 * 6, 110, 12, true), run("Alpha beta gamma", 72, 130, 12, true), run("The quick brown fox", 72, 150, 12, true)];
}

/** A renderer for tests: pages are white rectangles with the page number drawn on them, and text is deterministic. */
export function fakeRenderer(options: FakeRendererOptions = {}): FakeRenderer {
  const specs = (): FakePageSpec[] => (Array.isArray(options.pages) ? options.pages : Array.from({ length: options.pages ?? 3 }, () => ({})));
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  const stats: FakeRenderer["stats"] = { opens: 0, destroyedDocs: 0, pagesLoaded: [], destroyedPages: [], renders: [], active: 0 };

  const makePage = (spec: FakePageSpec, index: number): RenderedPage => {
    const width = spec.width ?? 612;
    const height = spec.height ?? 792;
    const rotate = spec.rotate ?? 0;
    stats.pagesLoaded.push(index);
    return {
      width,
      height,
      rotate,
      async render({ canvas, scale, rotation, signal }: RenderOptions) {
        const call: RenderCall = { page: index, scale, rotation, done: false };
        stats.renders.push(call);
        stats.active++;
        try {
          if (signal?.aborted) throw abortError();
          const wait = options.latency ?? 0;
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => reject(abortError());
            signal?.addEventListener("abort", onAbort, { once: true });
            const go = () => {
              if (gate) gate.then(finish, finish);
              else finish();
            };
            const finish = () => {
              signal?.removeEventListener("abort", onAbort);
              resolve();
            };
            if (wait > 0) setTimeout(go, wait);
            else queueMicrotask(go);
          });
          if (signal?.aborted) throw abortError();
          const turned = rotation % 180 !== 0;
          canvas.width = Math.max(1, Math.ceil((turned ? height : width) * scale));
          canvas.height = Math.max(1, Math.ceil((turned ? width : height) * scale));
          canvas.dataset.fakePage = String(index);
          const ctx = safeContext(canvas);
          if (ctx) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#3366cc";
            ctx.fillRect(canvas.width * 0.1, canvas.height * 0.1, canvas.width * 0.3, canvas.height * 0.05);
            ctx.fillStyle = "#000000";
            ctx.font = `${Math.max(8, Math.round(canvas.height * 0.04))}px sans-serif`;
            ctx.fillText(`Page ${index + 1}`, canvas.width * 0.1, canvas.height * 0.3);
          }
          call.done = true;
        } finally {
          stats.active--;
        }
      },
      async text() {
        return (options.text ?? defaultFakeText)(index, width, height).map((r) => ({ ...r }));
      },
      destroy() {
        stats.destroyedPages.push(index);
      },
    };
  };

  return {
    stats,
    hold() {
      gate = new Promise<void>((r) => (open = r));
    },
    release() {
      gate = null;
      open?.();
      open = null;
    },
    async open(_bytes: Uint8Array, _o?: OpenOptions): Promise<RenderedDocument> {
      stats.opens++;
      const list = specs();
      return {
        pages: list.length,
        page: async (i) => {
          if (i < 0 || i >= list.length) throw new Error(`no page ${i}`);
          return makePage(list[i]!, i);
        },
        outline: async () => options.outline ?? [],
        destroy() {
          stats.destroyedDocs++;
        },
      };
    },
  };
}

function safeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return (canvas.getContext?.("2d") as CanvasRenderingContext2D | null) ?? null;
  } catch {
    return null;
  }
}

export interface TestSessionOptions {
  /** Pages from the `main` source: a count, or a size for each (points; default Letter). */
  pages?: number | { width?: number; height?: number; rotate?: Rotation }[];
  /** How many blank pages to add at the end. */
  blank?: number;
  outline?: OutlineItem[];
  /** Bytes of the `main` source (anything: the fake renderer does not read them). */
  bytes?: Uint8Array;
}

/** A session made by hand: a `main` source with the given pages (and bytes in `session.sources`), no file needed. */
export function testSession(options: TestSessionOptions = {}): PdfSession {
  const specs: { width?: number; height?: number; rotate?: Rotation }[] = Array.isArray(options.pages) ? options.pages : Array.from({ length: options.pages ?? 3 }, () => ({}));
  const bytes = options.bytes ?? new TextEncoder().encode("%PDF-1.7 test");
  const source: Source = { id: MAIN_SOURCE, name: "test.pdf", pages: specs.length, size: bytes.length, hash: hashBytes(bytes) };
  const pages: Page[] = specs.map((s, i) => ({ id: `p:main:${i}`, from: { source: MAIN_SOURCE, index: i }, width: s.width ?? 612, height: s.height ?? 792, rotate: s.rotate ?? 0, annots: [] }));
  for (let i = 0; i < (options.blank ?? 0); i++) pages.push({ id: `blank${i}`, from: null, width: 612, height: 792, rotate: 0, annots: [] });
  const doc: PdfDoc = { ...emptyDoc("test"), sources: [source], pages, outline: options.outline ?? [] };
  const session = new PdfSession(doc);
  void session.sources.put(source, bytes);
  return session;
}
