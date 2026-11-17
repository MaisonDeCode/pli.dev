/**
 * The renderer the viewer depends on. The UI never touches pdf.js types: everything it needs from a PDF library is here, so a
 * host can supply its own (PDFium or MuPDF compiled to WebAssembly, a native view, a server that returns images). The pdf.js
 * one lives in `@pli.dev/pdf-react/pdfjs`; a deterministic fake for tests is in `@pli.dev/pdf-react/testing`.
 *
 * Pli draws annotations itself from the editable JSON, so a renderer must NOT draw annotations or form fields into the
 * canvas: only the page's own content.
 */

/**
 * A piece of text on a page, in page space (the same as `@pli.dev/pdf`'s model: points, origin at the top left of the page's
 * visible box before it is rotated, y down).
 *
 * When `angle` is set the text is not horizontal: `x`,`y` is the top left corner of the unrotated box, `w`,`h` its size, and
 * the box is turned `angle` degrees clockwise around that corner. Without it, `x`,`y`,`w`,`h` is the box.
 */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The line ends after this run (a line break belongs in copied text). */
  eol?: boolean;
  dir?: "ltr" | "rtl" | "ttb";
  /** Degrees clockwise, for text that is not horizontal. */
  angle?: number;
}

export interface RenderOptions {
  /** The canvas to draw on. The renderer sets its `width` and `height` (the page size times `scale`, rounded up). */
  canvas: HTMLCanvasElement;
  /** Pixels per point. The UI has already multiplied by the device pixel ratio and capped the size. */
  scale: number;
  /** Degrees clockwise the page is shown turned: 0, 90, 180 or 270. It REPLACES the source page's own `/Rotate`. */
  rotation: number;
  /** Aborting stops the work and makes the promise reject with an `AbortError`. */
  signal?: AbortSignal;
}

export interface RenderedPage {
  /** Size in points at rotation 0, from the source page's visible box, not turned by its own `/Rotate`. */
  readonly width: number;
  readonly height: number;
  /** The `/Rotate` the source page has (information: `render` takes the rotation to show). */
  readonly rotate: number;
  render(options: RenderOptions): Promise<void>;
  /** The text of the page, in page space, in content order. */
  text(): Promise<TextRun[]>;
  /** Frees what the library holds for this page. */
  destroy(): void;
}

/** One entry of the outline (bookmarks) of a file, as a renderer reads it. Pages are numbers (0-based). */
export interface RenderedOutlineItem {
  title: string;
  /** The page it goes to (0-based) and how far down (page space), if it is a place in the file. */
  page?: number;
  y?: number;
  uri?: string;
  bold?: boolean;
  italic?: boolean;
  children: RenderedOutlineItem[];
}

export interface RenderedDocument {
  readonly pages: number;
  /** A page by number (0-based). The same page may be asked for again. */
  page(index: number): Promise<RenderedPage>;
  /** The outline of the file, for showing one the engine has not read (see the `fallbackOutline` prop). */
  outline?(): Promise<RenderedOutlineItem[]>;
  destroy(): void | Promise<void>;
}

export interface OpenOptions {
  password?: string;
  /**
   * Draw the file's own annotations and form fields into the picture. The viewer leaves this off (Pli draws annotations from
   * the editable JSON); pictures of pages and printing open the SAVED file with it on, so what was marked shows.
   */
  annotations?: boolean;
}

export interface PdfRenderer {
  open(bytes: Uint8Array, options?: OpenOptions): Promise<RenderedDocument>;
}

/** The error a cancelled `render` rejects with. */
export function abortError(): Error {
  const e = new Error("Rendering was cancelled");
  e.name = "AbortError";
  return e;
}

export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** Rotates a rectangle's corner coordinates: the bounding box of a run, with `angle` taken into account. */
export function runBounds(run: TextRun): { x: number; y: number; w: number; h: number } {
  if (!run.angle) return { x: run.x, y: run.y, w: run.w, h: run.h };
  const a = (run.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = [
    [0, 0],
    [run.w, 0],
    [run.w, run.h],
    [0, run.h],
  ].map(([px, py]) => [run.x + px! * cos - py! * sin, run.y + px! * sin + py! * cos] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The box of characters `from` to `to` of a run (equal width per character), as a page-space bounding rectangle. */
export function runSlice(run: TextRun, from: number, to: number): { x: number; y: number; w: number; h: number } {
  const n = Math.max(1, run.str.length);
  const f = Math.max(0, Math.min(n, from)) / n;
  const t = Math.max(0, Math.min(n, to)) / n;
  // Right to left text starts at the right edge.
  const [a, b] = run.dir === "rtl" ? [1 - t, 1 - f] : [f, t];
  if (run.dir === "ttb") return runBounds({ ...run, x: run.x, y: run.y + run.h * f, h: run.h * (t - f), angle: run.angle });
  return runBounds({ ...run, x: run.x + (run.angle ? Math.cos((run.angle * Math.PI) / 180) * run.w * a : run.w * a), y: run.y + (run.angle ? Math.sin((run.angle * Math.PI) / 180) * run.w * a : 0), w: run.w * (b - a) });
}
