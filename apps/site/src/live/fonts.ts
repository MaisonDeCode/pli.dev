import { createFonts, type FontRegistry } from "@pli.dev/core";

let registry: FontRegistry | undefined;

/**
 * The fonts of the live editors on the marketing pages: only the fonts every computer has. The editors' default registry
 * fetches Google families from a CDN when a document uses them, which a demo on a landing page must not depend on (it has to
 * look the same and work with no network). Nothing is fetched, nothing is written to storage, and a document that names a
 * font the visitor lacks falls back to its stack's generic family.
 */
export function liveFonts(): FontRegistry {
  return (registry ??= createFonts({ source: null, noGoogle: true, storage: null }));
}
