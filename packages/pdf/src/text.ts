/**
 * Reading and searching the text of PDF pages, headless (no DOM, no renderer): the same interpreter that redaction and
 * text editing use, so what is found is what is removed. See `content/text.ts` for how text is put together and what
 * it does not do (columns, right-to-left order).
 *
 * ```ts
 * const page = extractText(file, 0);                      // a PdfFile or bytes: synchronous
 * const page = await extractText(session, "p:main:0");    // a session: the bytes may have to be fetched
 * const hits = searchText(file, "invoice", { wholeWord: true });
 * ```
 */
import { PliError } from "@pli.dev/core";
import { PdfFile } from "./cos/file";
import { analyzeFilePage, analyzeSessionPage } from "./content/read";
import { searchPage, type PageText, type SearchHit, type SearchOptions } from "./content/text";
import type { PdfSession } from "./session";

export type { PageImage, PageText, SearchHit, SearchOptions, TextGlyph, TextLine, TextRun } from "./content/text";

const isSession = (x: unknown): x is PdfSession => typeof x === "object" && x !== null && "saveDetailed" in x && "doc" in x;
const asFile = (x: PdfFile | Uint8Array): PdfFile => (x instanceof Uint8Array ? PdfFile.open(x) : x);

/** The text, runs (with a box per glyph) and pictures of a page. A file: the page's 0-based index; a session: its index or id. */
export function extractText(input: PdfFile | Uint8Array, page: number): PageText;
export function extractText(input: PdfSession, page: number | string): Promise<PageText>;
export function extractText(input: PdfFile | Uint8Array | PdfSession, page: number | string): PageText | Promise<PageText> {
  if (isSession(input)) {
    const id = typeof page === "string" ? page : input.doc.pages[page]?.id;
    if (!id) throw new PliError("not_found", `page ${page} not found`);
    return analyzeSessionPage(input, id).then((r) => ({ ...r.text, pageId: id }));
  }
  if (typeof page !== "number") throw new PliError("invalid_operation", "a file's pages are named by number");
  return analyzeFilePage(asFile(input), page).text;
}

/** Finds `query` in the text of every page (or `options.pages`). Rectangles are in page space, one per line of a match. */
export function searchText(input: PdfFile | Uint8Array, query: string, options?: SearchOptions): SearchHit[];
export function searchText(input: PdfSession, query: string, options?: SearchOptions): Promise<SearchHit[]>;
export function searchText(input: PdfFile | Uint8Array | PdfSession, query: string, options: SearchOptions = {}): SearchHit[] | Promise<SearchHit[]> {
  if (isSession(input)) {
    return (async () => {
      const hits: SearchHit[] = [];
      const pages = input.doc.pages;
      for (let i = 0; i < pages.length; i++) {
        if (options.pages && !options.pages.includes(i)) continue;
        const p = pages[i]!;
        if (!p.from) continue;
        const { text } = await analyzeSessionPage(input, p.id);
        for (const h of searchPage(text, query, options)) hits.push({ ...h, page: i, pageId: p.id });
      }
      return hits;
    })();
  }
  const file = asFile(input);
  const hits: SearchHit[] = [];
  const n = file.pageCount();
  for (let i = 0; i < n; i++) {
    if (options.pages && !options.pages.includes(i)) continue;
    hits.push(...searchPage(analyzeFilePage(file, i).text, query, options));
  }
  return hits;
}
