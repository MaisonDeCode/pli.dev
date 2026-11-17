import { act } from "react";
import { beforeEach } from "vitest";
import { encodeBase64 } from "@pli.dev/core";
import { openPdf, type PdfSession } from "@pli.dev/pdf";
import { PdfEditor, type PdfEditorProps } from "../src";
import { fakeRenderer } from "../src/testing";
import { makePdf, STD_FONTS } from "../../pdf/test/support/content";
import { obj, streamObj } from "../../pdf/test/support/handmade";
import { makePng } from "../../pdf/test/support/png";
import { byLabel, click, flush, host, q, render, rotateView, useHost } from "./harness";

export { byLabel, chooseMenu, click, fire, flush, host, key, q, qa, run, saveFile } from "./harness";
export { clientOf, layerOf, pointer, tap } from "./annotHarness";

/** jsdom has no modal dialogs; the editors' tests shim them the same way. */
export function useEditHost() {
  useHost();
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
    try {
      localStorage.clear();
    } catch {
      // no storage
    }
  });
}

export const viewport = { width: 800, height: 600 };

const T3 = streamObj(50, "", "10 0 d0 0 0 10 10 re f");
const pixels = (): Uint8Array => {
  const d = new Uint8Array(4 * 4 * 3);
  for (let i = 0; i < 16; i++) d.set([200, 10, 10], i * 3);
  return d;
};

/** A Letter page with a title, a line, a turned line, Type 3 text, invisible text and a picture, all made by hand. */
export function editPdf(extra: { content?: string; rotate?: number } = {}): Uint8Array {
  return makePdf({
    mediaBox: "[0 0 612 792]",
    rotate: extra.rotate,
    fonts: {
      ...STD_FONTS,
      T: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 10 10] /FontMatrix [0.1 0 0 0.1 0 0] /CharProcs << /sq 50 0 R >> /Encoding << /Type /Encoding /Differences [97 /sq] >> /FirstChar 97 /LastChar 97 /Widths [10] /Resources << >> >>",
    },
    resources: "/XObject << /Im1 20 0 R >>",
    objs: [T3, streamObj(20, "/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8", pixels()), obj(60, "<< >>")],
    content:
      extra.content ??
      [
        "BT /F1 24 Tf 72 700 Td (Quarterly report) Tj ET",
        "BT /F1 12 Tf 72 660 Td (Revenue grew by ten percent) Tj ET",
        "BT /F1 12 Tf 0 -1 1 0 540 700 Tm (Turned words) Tj ET",
        "BT /T 20 Tf 72 600 Td (aaa) Tj ET",
        "BT /F1 12 Tf 3 Tr 72 560 Td (hidden ocr) Tj ET",
        "q 100 0 0 50 300 500 cm /Im1 Do Q",
      ].join("\n"),
  });
}

export const bluePng = (w = 20, h = 10): Uint8Array => makePng({ width: w, height: h, colorType: 2, depth: 8, sample: () => [0, 0, 255] });
export const blueUri = (w = 20, h = 10): string => `data:image/png;base64,${encodeBase64(bluePng(w, h))}`;

export interface Mounted {
  session: PdfSession;
  pageId: string;
  renderer: ReturnType<typeof fakeRenderer>;
}

export interface MountOptions {
  /** Quarter turns of the view (the rotate button pressed this many times). */
  turns?: number;
  zoom?: number;
  props?: Partial<PdfEditorProps>;
  /** A session made by the test (to watch what is asked of it). */
  session?: PdfSession;
}

/** The whole editor on a hand-made file. */
export async function mountEditor(bytes: Uint8Array, o: MountOptions = {}): Promise<Mounted> {
  const session = o.session ?? (await openPdf(bytes, { name: "edit.pdf", user: { id: "u1", name: "Ana Reyes" } }));
  const renderer = fakeRenderer({ pages: session.doc.pages.length });
  await render(<PdfEditor session={session} renderer={renderer} viewport={viewport} defaultZoom={o.zoom ?? 1} annotations={{ storageKey: "" }} {...o.props} />);
  await flush();
  for (let i = 0; i < (o.turns ?? 0); i++) await rotateView();
  await flush();
  return { session, pageId: session.doc.pages[0]!.id, renderer };
}

export const editButton = () => q("button[aria-label='Edit text and pictures']");
/** Puts the Edit tool on, and waits for the page's text to be read. */
export async function chooseEdit() {
  await click(editButton());
  await flush();
}

/** Types into the text editor the way a person does: the value changes and the page hears an input. */
export async function typeIn(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export const editor = () => document.querySelector<HTMLTextAreaElement>(".pli-edit-editor");
export const centre = (r: { x: number; y: number; w: number; h: number }): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** The run whose text is `text`, as the engine reads it. */
export async function runOf(session: PdfSession, text: string) {
  const runs = await session.content.runs(session.doc.pages[0]!.id);
  const r = runs.find((x) => x.text === text);
  if (!r) throw new Error(`no run "${text}" among ${runs.map((x) => x.text).join(" | ")}`);
  return r;
}
