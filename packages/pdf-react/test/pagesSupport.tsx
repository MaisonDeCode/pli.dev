import type { ReactElement } from "react";
import { act } from "react";
import { beforeEach } from "vitest";
import { extractText, openPdf, PdfFile, type PdfSession } from "@pli.dev/pdf";
import { PliPdf, type PliPdfProps } from "../src";
import { fakeRenderer } from "../src/testing";
import { buildPdf, type TestPage } from "./pdfbuild";
import { flush, render } from "./harness";

export const WORDS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];

/** A real PDF with a code word on each page. */
export const pdfOf = (words: string[], sizes: Partial<TestPage>[] = [], outline = [] as Parameters<typeof buildPdf>[1]): Uint8Array =>
  buildPdf(words.map((w, i) => ({ width: 612, height: 792, texts: [{ x: 72, y: 700, size: 24, text: w }], ...sizes[i] })), outline);

export async function openWords(words = WORDS.slice(0, 5), name = "report.pdf", sizes: Partial<TestPage>[] = [], outline: Parameters<typeof buildPdf>[1] = []): Promise<PdfSession> {
  return openPdf(pdfOf(words, sizes, outline), { name });
}

/** The code words of the pages of a PDF file, in order. */
export function wordsOf(bytes: Uint8Array): string[] {
  const n = PdfFile.open(bytes).pageCount();
  return Array.from({ length: n }, (_, i) => extractText(bytes, i).text.trim());
}

/** The code words of the pages of a session in order, found through the saved file. */
export async function sessionWords(session: PdfSession): Promise<string[]> {
  return wordsOf(await session.save());
}

/** jsdom has no modal dialogs: show and hide them by the `open` attribute. */
export function stubDialogs() {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  });
}

export interface Downloaded {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

export interface Mounted {
  session: PdfSession;
  renderer: ReturnType<typeof fakeRenderer>;
  downloads: Downloaded[];
}

export const viewport = { width: 800, height: 600 };

/** Mounts the viewer on a real PDF, with downloads collected instead of saved. */
export async function mountPdf(session: PdfSession, extra: Partial<PliPdfProps> = {}, wrap: (node: ReactElement) => ReactElement = (node) => node): Promise<Mounted> {
  const renderer = (extra.renderer as ReturnType<typeof fakeRenderer> | undefined) ?? fakeRenderer({ pages: session.doc.pages.length });
  const downloads: Downloaded[] = [];
  await render(wrap(<PliPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={1} onDownload={(bytes, name, mime) => void downloads.push({ name, bytes, mime })} {...extra} />));
  await flush();
  return { session, renderer, downloads };
}

/** A drag and drop event: jsdom has neither DragEvent nor DataTransfer, so this is a mouse event with a `dataTransfer`. */
export function dragEvent(type: string, init: { clientX?: number; clientY?: number; types?: string[]; files?: unknown[] } = {}): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 });
  const data: Record<string, string> = {};
  Object.defineProperty(e, "dataTransfer", {
    value: {
      types: init.types ?? [],
      files: init.files ?? [],
      items: [],
      effectAllowed: "all",
      dropEffect: "none",
      setData: (k: string, v: string) => void (data[k] = v),
      getData: (k: string) => data[k] ?? "",
    },
  });
  return e;
}

export const fileOf = (name: string, bytes: Uint8Array, type = "application/pdf") => ({ name, type, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer });

/** Stubs the browser's file chooser: the next `input.click()` on a file input answers with these files. */
export function stubChooser(files: unknown[]): { restore: () => void; accepted: string[] } {
  const original = HTMLInputElement.prototype.click;
  const accepted: string[] = [];
  HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
    if (this.type !== "file") return original.call(this);
    accepted.push(this.accept);
    Object.defineProperty(this, "files", { value: files, configurable: true });
    setTimeout(() => this.dispatchEvent(new Event("change")), 0);
  };
  return { restore: () => void (HTMLInputElement.prototype.click = original), accepted };
}

export const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
