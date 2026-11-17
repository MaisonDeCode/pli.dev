import type { FormField, PdfDoc, SignatureAnnot } from "../model";

/**
 * A signature field is COVERED when a signature annotation says it signs it (`SignatureAnnot.field`, the field's name). A covered
 * field draws nothing of its own: no caption, no wash, no border. The signature is the only thing in its box, in the editor and in the
 * saved file (the field's widget gets an empty appearance), and flattening leaves the signature on a clean page. Remove the signature
 * (delete, undo) and the field is as it was.
 *
 * Covering is derived from the annotations, never stored on the field, so it cannot disagree with them.
 */
export type CoveredField = FormField & { covered?: true };

/** The signature annotation that signs `field`, if the document has one. */
export function signatureOf(doc: Pick<PdfDoc, "pages">, field: Pick<FormField, "name">): SignatureAnnot | undefined {
  for (const page of doc.pages) for (const a of page.annots) if (a.type === "signature" && a.field === field.name) return a;
  return undefined;
}

/** The names of the fields that signature annotations sign. */
export function coveredNames(doc: Pick<PdfDoc, "pages">): Set<string> {
  const out = new Set<string>();
  for (const page of doc.pages) for (const a of page.annots) if (a.type === "signature" && a.field) out.add(a.field);
  return out;
}

/** The fields with `covered: true` on the signature fields that are covered (the other fields are returned as they are). */
export function withCover(fields: readonly FormField[], doc: Pick<PdfDoc, "pages">): CoveredField[] {
  const names = coveredNames(doc);
  if (names.size === 0) return [...fields];
  return fields.map((f) => (f.type === "signature" && names.has(f.name) ? { ...f, covered: true as const } : f));
}
