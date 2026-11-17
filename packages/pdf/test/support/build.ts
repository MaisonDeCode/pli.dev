/** Test helper: a one-page document with a content stream and resources, built with the writer. */
import { ContentBuilder, ResourceNames } from "../../src/cos/content";
import { PdfDict, PdfName, PdfRef } from "../../src/cos/objects";
import type { Overlay } from "../../src/cos/overlay";
import { setPages } from "../../src/cos/pagetree";
import { createPdf } from "../../src/cos/writer";

export interface TestPage {
  overlay: Overlay;
  page: PdfRef;
  content: ContentBuilder;
  res: ResourceNames;
}

/** A new document with a single 200 x 200 page; draw with `content`, then call `finishPage`. */
export function newPage(width = 200, height = 200): TestPage {
  const overlay = createPdf();
  const res = new ResourceNames(new PdfDict());
  const page = overlay.add(new PdfDict({ Type: PdfName.of("Page"), MediaBox: [0, 0, width, height] }));
  setPages(overlay, [page]);
  return { overlay, page, content: new ContentBuilder(), res };
}

export function finishPage(t: TestPage): void {
  const stream = t.overlay.add(t.content.toStream());
  const d = t.overlay.edit<PdfDict>(t.page);
  d.set("Contents", stream);
  d.set("Resources", t.res.dict);
}
