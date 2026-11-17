/**
 * The fonts a document needs files for when it is saved, so a host can fetch them first:
 *
 *     const { families, text } = await documentFonts(session);
 *     const { fonts, warnings } = await registry.pdfFonts(families, { text });
 *     await session.save({ fonts });
 *
 * Text boxes (`freetext`), typed signatures, form fields with a font that is not one of the standard ones, and staged text
 * edits (`session.content.editFonts()`). The standard fonts (Helvetica, Arial, Times, Courier and their generic names) need no file.
 */
import { fileKeyFor } from "./forms/names";
import type { PdfDoc } from "./model";
import type { PdfSession } from "./session";

const STANDARD = /^(helvetica|arial|times|courier|sans|serif|mono|helv|cour)/i;

/** The families and the characters of a document's own text (not the staged text edits: see `documentFonts`). */
export function docFonts(doc: PdfDoc): { families: string[]; text: string } {
  const families = new Set<string>();
  let text = "";
  const add = (family: string | undefined) => {
    const f = family?.trim();
    if (f && !STANDARD.test(f)) families.add(f);
  };
  for (const page of doc.pages) {
    for (const a of page.annots) {
      if (a.type === "freetext") {
        add(a.style.family);
        text += a.text;
      } else if (a.type === "signature" && a.mode === "type") {
        add(a.font);
        text += a.text ?? "";
      }
    }
  }
  for (const f of doc.fields) {
    const font = f.appearance?.font;
    if (font) add(fileKeyFor(font).family);
    if (typeof f.value === "string") text += f.value;
    else if (Array.isArray(f.value)) text += f.value.join("");
    for (const o of f.options ?? []) text += o.label ?? o.value;
  }
  return { families: [...families], text: [...new Set(text)].join("") };
}

/** `docFonts` plus what the staged text edits will need. */
export async function documentFonts(session: PdfSession): Promise<{ families: string[]; text: string }> {
  const own = docFonts(session.doc);
  const edits = await session.content.editFonts();
  const families = new Set([...own.families, ...edits.families.filter((f) => !STANDARD.test(f))]);
  return { families: [...families], text: [...new Set(own.text + edits.text)].join("") };
}
