/**
 * Reading page content from files and sessions: the text, the runs and the pictures of a page, with the file opened
 * once per session and source.
 */
import { PliError } from "@pli.dev/core";
import { PdfFile } from "../cos/file";
import type { Page } from "../model";
import { MAIN_SOURCE } from "../model";
import type { PdfSession } from "../session";
import { pageGeometry, sourceOf } from "./page";
import { analyzePage, type PageAnalysis, type PageText } from "./text";

const files = new WeakMap<PdfSession, Map<string, { hash: string; file: PdfFile }>>();

/** The opened file of a source of the session (kept until the source's fingerprint changes). */
export async function sessionFile(session: PdfSession, sourceId: string): Promise<PdfFile> {
  const source = session.doc.sources.find((s) => s.id === sourceId);
  if (!source) throw new PliError("not_found", `source ${sourceId} is not part of this document`);
  let per = files.get(session);
  if (!per) files.set(session, (per = new Map()));
  const have = per.get(sourceId);
  if (have && have.hash === source.hash) return have.file;
  const bytes = await session.sources.get(source);
  if (!bytes) throw new PliError("storage", `the bytes of ${source.name} are not available`);
  const file = PdfFile.open(bytes, { password: sourceId === MAIN_SOURCE ? session.options.password : undefined });
  per.set(sourceId, { hash: source.hash, file });
  return file;
}

const analyses = new WeakMap<PdfFile, Map<number, PageAnalysis>>();

/** Reads a page of a file (kept per file: a `PdfFile` never changes, so reading it again gives the same answer). Do not change what it returns. */
export function analyzeFilePage(file: PdfFile, index: number): PageAnalysis {
  let per = analyses.get(file);
  if (!per) analyses.set(file, (per = new Map()));
  const have = per.get(index);
  if (have) return have;
  const info = file.pages()[index];
  if (!info) throw new PliError("not_found", `the file has no page ${index}`);
  const src = sourceOf(file, (s) => file.decode(s));
  const analysis = analyzePage(src, pageGeometry(src, info.dict, info.ref), index);
  per.set(index, analysis);
  return analysis;
}

const empty = (page: Page, index: number): PageText => ({ page: index, width: page.width, height: page.height, text: "", lines: [], runs: [], images: [] });

/** The analysis of a page of a session; null for a blank page. */
export async function analyzeSessionPage(session: PdfSession, pageId: string): Promise<{ page: Page; analysis: PageAnalysis | null; text: PageText }> {
  const page = session.doc.pages.find((p) => p.id === pageId);
  if (!page) throw new PliError("not_found", `page ${pageId} not found`);
  if (!page.from) return { page, analysis: null, text: empty(page, 0) };
  const file = await sessionFile(session, page.from.source);
  const analysis = analyzeFilePage(file, page.from.index);
  return { page, analysis, text: analysis.text };
}
