/**
 * A small sample PDF made with the engine, for demos, tests and first tries: two Letter pages of text with a bookmark
 * outline, a little form (a name, a choice, a check box and a signature field) and two links (one to the other page, one to
 * a web address). Nothing in it is real: it needs no file and no network.
 *
 *     const bytes = await makeSamplePdf();
 *     const session = await openPdf(bytes, { name: "sample.pdf" });
 */
import { ContentBuilder, ResourceNames } from "./cos/content";
import { PdfDict, PdfName, PdfRef, pdfText } from "./cos/objects";
import { setPages } from "./cos/pagetree";
import { createPdf } from "./cos/writer";
import { addStandardFont } from "./fonts/standard";
import { openPdf } from "./open";

export interface SampleOptions {
  /** The title in the file's information (default "Pli.PDF sample"). */
  title?: string;
}

const W = 612;
const H = 792;

interface Line {
  text: string;
  x: number;
  /** From the top of the page. */
  y: number;
  size: number;
  bold?: boolean;
}

const PAGE_ONE: Line[] = [
  { text: "Pli.PDF sample", x: 72, y: 90, size: 28, bold: true },
  { text: "This file was made in your browser by the Pli.PDF engine. Select this text, highlight it,", x: 72, y: 132, size: 12 },
  { text: "draw on the page, add a note, or fill in the form below. Nothing leaves this window.", x: 72, y: 150, size: 12 },
  { text: "Sample form", x: 72, y: 214, size: 16, bold: true },
  { text: "Name", x: 72, y: 254, size: 12 },
  { text: "Colour", x: 72, y: 294, size: 12 },
  { text: "Subscribe to updates", x: 100, y: 334, size: 12 },
  { text: "Signature", x: 72, y: 394, size: 12 },
  { text: "Go to page 2", x: 72, y: 470, size: 12 },
  { text: "Open a web page", x: 72, y: 500, size: 12 },
];

const PAGE_TWO: Line[] = [
  { text: "Page two", x: 72, y: 90, size: 28, bold: true },
  { text: "The quick brown fox jumps over the lazy dog.", x: 72, y: 132, size: 12 },
  { text: "Pack my box with five dozen liquor jugs.", x: 72, y: 150, size: 12 },
  { text: "How vexingly quick daft zebras jump.", x: 72, y: 168, size: 12 },
  { text: "Back to page 1", x: 72, y: 230, size: 12 },
];

/** The two pages of text, as a file (no form, links or outline yet). */
function textPages(title: string): Uint8Array {
  const o = createPdf();
  const refs: PdfRef[] = [];
  const font = addStandardFont(o, "Helvetica");
  const bold = addStandardFont(o, "Helvetica", { bold: true });
  for (const lines of [PAGE_ONE, PAGE_TWO]) {
    const res = new ResourceNames(new PdfDict());
    const c = new ContentBuilder();
    const f = res.font(font);
    const b = res.font(bold);
    for (const l of lines) {
      c.beginText().font(l.bold ? b : f, l.size).textMove(l.x, H - l.y).showText(l.text).endText();
    }
    const page = o.add(new PdfDict({ Type: PdfName.of("Page"), MediaBox: [0, 0, W, H] }));
    const content = o.add(c.toStream());
    const d = o.edit<PdfDict>(page);
    d.set("Contents", content);
    d.set("Resources", res.dict);
    refs.push(page);
  }
  setPages(o, refs);
  o.editInfo().set("Title", pdfText(title));
  return o.rewrite({ gc: true });
}

/** A sample PDF with text, bookmarks, a form and links. */
export async function makeSamplePdf(options: SampleOptions = {}): Promise<Uint8Array> {
  const session = await openPdf(textPages(options.title ?? "Pli.PDF sample"), { name: "sample.pdf", now: () => Date.UTC(2026, 0, 1) });
  const [one, two] = session.doc.pages.map((p) => p.id) as [string, string];

  session.forms.addField(one, { type: "text", name: "name", rect: { x: 150, y: 246, w: 240, h: 22 }, tooltip: "Your name" }, { select: false });
  session.forms.addField(one, { type: "dropdown", name: "colour", rect: { x: 150, y: 286, w: 160, h: 22 }, options: ["Red", "Green", "Blue"], value: "Green" }, { select: false });
  session.forms.addField(one, { type: "checkbox", name: "subscribe", rect: { x: 72, y: 326, w: 18, h: 18 } }, { select: false });
  session.forms.addField(one, { type: "signature", name: "signature", rect: { x: 150, y: 380, w: 240, h: 44 } }, { select: false });

  session.annots.addLink(one, { x: 72, y: 460, w: 90, h: 18 }, { page: two, y: 0 });
  session.annots.addLink(one, { x: 72, y: 490, w: 110, h: 18 }, { uri: "https://example.com/" });
  session.annots.addLink(two, { x: 72, y: 220, w: 100, h: 18 }, { page: one, y: 0 });

  session.outline.add("Pli.PDF sample", one);
  const form = session.outline.add("Sample form", one, { y: 200 });
  void form;
  session.outline.add("Page two", two);

  return session.save({ mode: "rewrite" });
}
