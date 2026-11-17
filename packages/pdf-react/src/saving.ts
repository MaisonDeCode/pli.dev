/**
 * Everything that writes the document goes through here (Save, Download, Print, flatten, extract, split, page pictures), so
 * the fonts reach the file the same way each time: the font files the document's text needs are fetched from the editor's
 * `FontRegistry` (the `fonts` prop) and passed as `SaveOptions.fonts`; what could not be fetched is a warning of the result.
 */
import type { FontRegistry } from "@pli.dev/core";
import { documentFonts, type PdfSession, type SaveOptions, type SaveResult } from "@pli.dev/pdf";

const registries = new WeakMap<PdfSession, FontRegistry>();

/** The fonts used when this session is saved (set by the viewer from its `fonts` prop; null removes them). */
export function setSessionFonts(session: PdfSession, fonts: FontRegistry | null | undefined): void {
  if (fonts) registries.set(session, fonts);
  else registries.delete(session);
}

export const sessionFonts = (session: PdfSession): FontRegistry | undefined => registries.get(session);

/** Save options with the font files this document needs (fetched now) and the warnings of getting them. */
export async function withFonts(session: PdfSession, options: SaveOptions = {}): Promise<{ options: SaveOptions; warnings: string[] }> {
  const registry = registries.get(session);
  if (!registry) return { options, warnings: [] };
  const { families, text } = await documentFonts(session);
  if (families.length === 0) return { options, warnings: [] };
  const got = await registry.pdfFonts(families, { text });
  return { options: { ...options, fonts: { ...got.fonts, ...options.fonts } }, warnings: got.warnings };
}

/** `session.saveDetailed` with the fonts; the warnings of fetching them come first in the result's. */
export async function saveDetailed(session: PdfSession, options: SaveOptions = {}): Promise<SaveResult> {
  const prepared = await withFonts(session, options);
  const result = await session.saveDetailed(prepared.options);
  return prepared.warnings.length ? { ...result, warnings: [...prepared.warnings, ...result.warnings] } : result;
}

/** `session.save` with the fonts. */
export async function saveBytes(session: PdfSession, options: SaveOptions = {}): Promise<Uint8Array> {
  return (await saveDetailed(session, options)).bytes;
}

/**
 * What a save would warn about, before you save: fonts that could not be fetched, and what staged text edits would do (text
 * wider than the old, a font replaced by a standard one). Empty when all is well.
 */
export async function preflight(session: PdfSession): Promise<string[]> {
  const out: string[] = [];
  const prepared = await withFonts(session);
  out.push(...prepared.warnings);
  for (const page of session.doc.pages) {
    for (const e of page.edits ?? []) {
      if (e.type !== "text") continue;
      try {
        const plan = await session.content.planText(e.run, e.text, { page: page.id, family: e.family, size: e.size, bold: e.bold, italic: e.italic, fit: e.fit }, prepared.options.fonts);
        for (const w of plan.warnings) if (!out.includes(w)) out.push(w);
      } catch {
        // the run is gone (the file changed): the save itself says what happened
      }
    }
  }
  return out;
}
