import { PliError } from "@pli.dev/core";
import { readAnnotations, readThreads } from "./annots/read";
import type { ReadContext } from "./context";
import { PdfFile } from "./cos/file";
import { isString, textOf, type PdfRef } from "./cos/objects";
import { readFields } from "./forms/read";
import { MAIN_SOURCE, type Page, type PdfDoc, type PdfMeta, type Source } from "./model";
import { readPageLabels } from "./pages/labels";
import { readOutline } from "./pages/outline";
import { savePdf } from "./saver";
import { PdfSession, type PdfSessionOptions } from "./session";
import { hashBytes } from "./sources";

export interface OpenPdfOptions extends PdfSessionOptions {
  /** The file's name, shown by the app and used for downloads. */
  name?: string;
  /** The id of the document (comments and storage are named by it). By default a fingerprint of the bytes, so everyone who opens the same file agrees. */
  id?: string;
}

/** The file's own information, as JSON. */
function readMeta(file: PdfFile): PdfMeta {
  const info = file.info();
  const meta: PdfMeta = {};
  if (!info) return meta;
  for (const [key, field] of [["Title", "title"], ["Author", "author"], ["Subject", "subject"], ["Keywords", "keywords"], ["Creator", "creator"]] as const) {
    const v = file.dictGet(info, key);
    if (isString(v)) {
      const text = textOf(v);
      if (text) meta[field] = text;
    }
  }
  return meta;
}

/** The context the readers get for one file: every page's id and object. */
export function readContext(file: PdfFile, sourceId: string): ReadContext {
  const pages = file.pages();
  const pageIdByRef = new Map<string, string>();
  const pageRefById = new Map<string, PdfRef>();
  for (const p of pages) {
    const id = pageId(sourceId, p.index);
    pageIdByRef.set(p.ref.key, id);
    pageRefById.set(id, p.ref);
  }
  return { file, sourceId, pages, pageIdByRef, pageRefById };
}

/** The id of page `index` of a source, as read from a file: two clients that open the same bytes agree on it. */
export const pageId = (sourceId: string, index: number): string => `p:${sourceId}:${index}`;

/**
 * Reads a PDF file into a `PdfDoc`: pages, annotations, form fields, outline, comments and information. The file's
 * bytes are kept in the session's `SourceStore` as the `main` source and are what `save` writes to.
 */
export function readPdf(bytes: Uint8Array, options: OpenPdfOptions = {}): { doc: PdfDoc; file: PdfFile } {
  const file = PdfFile.open(bytes, { password: options.password });
  const ctx = readContext(file, MAIN_SOURCE);
  if (ctx.pages.length === 0) throw new PliError("invalid_document", "this PDF has no pages");
  const labels = readPageLabels(file, ctx.pages.length);
  const pages: Page[] = ctx.pages.map((info) => {
    const [x0, y0, x1, y1] = info.cropBox;
    return {
      id: pageId(MAIN_SOURCE, info.index),
      from: { source: MAIN_SOURCE, index: info.index },
      width: x1 - x0,
      height: y1 - y0,
      rotate: info.rotate,
      ...(labels?.[info.index] ? { label: labels[info.index] } : {}),
      annots: readAnnotations(ctx, info, pageId(MAIN_SOURCE, info.index)),
    };
  });
  const hash = hashBytes(bytes);
  const source: Source = { id: MAIN_SOURCE, name: options.name ?? "document.pdf", pages: pages.length, size: bytes.length, hash };
  const comments = readThreads(pages);
  const doc: PdfDoc = {
    id: options.id ?? `pdf_${hash}`,
    ...(options.name ? { name: options.name } : {}),
    meta: readMeta(file),
    sources: [source],
    pages,
    outline: readOutline(ctx),
    fields: readFields(ctx),
    ...(Object.keys(comments).length > 0 ? { comments } : {}),
  };
  return { doc, file };
}

/** Opens a PDF for editing: `const session = await openPdf(bytes)`. Throws `PliError` (`invalid_document`, or `unsupported` for a password that is missing or wrong). */
export async function openPdf(bytes: Uint8Array, options: OpenPdfOptions = {}): Promise<PdfSession> {
  const { doc } = readPdf(bytes, options);
  const session = new PdfSession(doc, options);
  await session.sources.put(doc.sources[0]!, bytes);
  session.saver = savePdf;
  return session;
}
