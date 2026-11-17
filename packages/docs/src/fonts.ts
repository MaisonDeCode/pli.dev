import type { Block, Doc } from "./model";
import { flattenBlocks } from "./tree";

/**
 * Every font family a document names, once each, in the order the document meets them: the body's text (table cells
 * included, section headers and footers where their section starts), then the page's headers and footers, the
 * footnotes, and last the families of the named styles. A family the document never names (the editor's default font,
 * the Courier New of code) is not listed. Names are as written in the document; hand them to a font registry to get
 * what a PDF needs: `registry.pdfFonts(usedFonts(doc))`.
 */
export function usedFonts(doc: Doc): string[] {
  const seen = new Set<string>();
  const add = (name: string | undefined) => {
    const trimmed = name?.trim();
    if (trimmed) seen.add(trimmed);
  };
  const walk = (blocks: readonly Block[] | undefined) => {
    if (!blocks) return;
    for (const block of flattenBlocks(blocks)) {
      if ("runs" in block) for (const run of block.runs) add(run.marks?.fontFamily);
      else if (block.type === "section_break" && block.regions) for (const list of Object.values(block.regions)) walk(list);
    }
  };
  walk(doc.blocks);
  for (const name of ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"] as const) walk(doc[name]);
  for (const note of Object.values(doc.footnotes ?? {})) walk(note);
  for (const style of Object.values(doc.styles ?? {})) add(style.marks?.fontFamily);
  return [...seen];
}
