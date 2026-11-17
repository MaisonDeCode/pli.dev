import { PliError } from "@pli.dev/core";
import { flattenAnnotations, writeAnnotations } from "./annots/write";
import type { WriteContext } from "./context";
import { PdfFile } from "./cos/file";
import { pdfText, type PdfRef } from "./cos/objects";
import { Overlay } from "./cos/overlay";
import { createPdf } from "./cos/writer";
import { applyEdits } from "./content/apply";
import { flattenForms, writeForms } from "./forms/write";
import { MAIN_SOURCE, type PdfDoc, type PdfMeta } from "./model";
import { applyPages } from "./pages/apply";
import { resolvePictures } from "./pictures";
import { writeOutline } from "./pages/outline";
import type { SaveOptions, SaveResult } from "./save";
import type { PdfSession } from "./session";

/** A PDF date string, `D:20261116123000Z`. */
export function pdfDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Why a save has to write a new file instead of appending to the original, or null if it doesn't. */
export function rewriteReason(doc: PdfDoc, baseline: PdfDoc, options: SaveOptions, hasMain: boolean): string | null {
  if (!hasMain) return "the document has no original file";
  if (options.mode === "rewrite" || options.mode === "optimise") return `mode ${options.mode}`;
  if (options.flatten) return "flatten";
  if (options.scrub) return "scrub";
  const kept = new Set(doc.pages.map((p) => p.id));
  if (baseline.pages.some((p) => !kept.has(p.id))) return "pages were deleted (their content must not stay in the file)";
  if (doc.pages.some((p) => p.edits?.length)) return "page content was edited or redacted";
  return null;
}

function writeMeta(ctx: WriteContext): void {
  const { overlay, doc, baseline, rewrite, now } = ctx;
  const changed = (Object.keys({ ...doc.meta, ...baseline.meta }) as (keyof PdfMeta)[]).filter((k) => doc.meta[k] !== baseline.meta[k]);
  const fresh = !ctx.main;
  if (changed.length === 0 && !fresh && !rewrite && !ctx.doc.pages.length) return;
  if (changed.length === 0 && !fresh) return;
  const info = overlay.editInfo();
  const keys: Record<keyof PdfMeta, string> = { title: "Title", author: "Author", subject: "Subject", keywords: "Keywords", creator: "Creator" };
  for (const k of fresh ? (Object.keys(doc.meta) as (keyof PdfMeta)[]) : changed) {
    const v = doc.meta[k];
    if (v) info.set(keys[k], pdfText(v));
    else info.delete(keys[k]);
  }
  info.set("ModDate", pdfText(pdfDate(now)));
  if (fresh) {
    info.set("Producer", pdfText("Pli.PDF"));
    info.set("CreationDate", pdfText(pdfDate(now)));
  }
}

/**
 * Writes a document to PDF bytes: the original file plus what changed since it was read (an update appended to the
 * original, which keeps its bytes and so its signatures), or a new file when content has to go. Set as
 * `PdfSession.saver` by `openPdf`.
 */
export async function savePdf(session: PdfSession, options: SaveOptions = {}): Promise<SaveResult> {
  const password = session.options.password;
  const sources = new Map<string, PdfFile>();
  const needed = new Set<string>(session.doc.pages.flatMap((p) => (p.from ? [p.from.source] : [])));
  if (session.doc.sources.some((s) => s.id === MAIN_SOURCE)) needed.add(MAIN_SOURCE);
  for (const id of needed) {
    const source = session.doc.sources.find((s) => s.id === id);
    if (!source) throw new PliError("not_found", `source ${id} is not part of this document`);
    const bytes = await session.sources.get(source);
    if (!bytes) throw new PliError("storage", `the bytes of ${source.name} are not available: put them in the session's source store`);
    sources.set(id, PdfFile.open(bytes, { password: id === MAIN_SOURCE ? password : undefined }));
  }
  const main = sources.get(MAIN_SOURCE) ?? null;

  // Nothing changed: the original file, byte for byte.
  if (main && session.doc === session.baseline && !options.flatten && (options.mode === undefined || options.mode === "auto" || options.mode === "incremental")) {
    return { bytes: main.bytes, mode: "incremental", warnings: [] };
  }

  // Pictures that are web addresses are fetched and written from a copy of the document.
  const resolved = await resolvePictures(session.doc, session.baseline, options);
  const { doc, baseline } = resolved;

  const reason = rewriteReason(doc, baseline, options, main !== null);
  if (options.mode === "incremental" && reason) throw new PliError("invalid_operation", `this change cannot be saved as an update of the original file: ${reason}`);

  const build = (rewrite: boolean): SaveResult => {
    const overlay: Overlay = main ? new Overlay(main) : createPdf();
    const ctx: WriteContext = { overlay, doc, baseline: main ? baseline : { ...baseline, pages: [] }, main, sources, pageRefs: new Map<string, PdfRef>(), options, rewrite, now: session.now(), warnings: [...resolved.warnings] };
    applyPages(ctx);
    if (rewrite) applyEdits(ctx);
    writeAnnotations(ctx);
    writeForms(ctx);
    writeOutline(ctx);
    writeMeta(ctx);
    if (options.flatten) {
      if (options.flatten !== "forms") flattenAnnotations(ctx);
      if (options.flatten !== "annotations") flattenForms(ctx);
    }
    // A new file is never encrypted, whatever the original was.
    if (rewrite && main?.encrypted) ctx.warnings.push("The original file is encrypted: the saved file is a new, unencrypted copy.");
    const bytes = rewrite ? overlay.rewrite({ gc: true, compress: options.mode === "optimise" || undefined, objectStreams: options.mode === "optimise", xrefStream: options.mode === "optimise" }) : overlay.incremental();
    return { bytes, mode: rewrite ? "rewrite" : "incremental", warnings: ctx.warnings };
  };

  if (reason) return build(true);
  try {
    return build(false);
  } catch (error) {
    // An encrypted original that cannot be appended to is written out as a new, unencrypted file.
    if (error instanceof PliError && error.code === "unsupported" && options.mode !== "incremental") {
      return build(true);
    }
    throw error;
  }
}
