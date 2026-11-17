import "./polyfills";
import { docsEditor } from "./editors/docs";
import catalog from "./catalog.json";
import { makeBridge, ok, type PliBridge } from "./runtime";

/**
 * The Documents engine as Swift and Kotlin use it: one script with no DOM, no timers and no network, whose whole interface is
 * strings. A document is opened to a number (a handle); everything else takes the handle and JSON text and returns JSON text,
 * so nothing but strings crosses between the two languages and nothing can throw across the boundary.
 *
 * Every reply is `{ "ok": true, "value": … }` or `{ "ok": false, "error": { "code": "…", "message": "…" } }`, with the events
 * the app should hear about (`events`) and, for work that isn't finished, `pending`. `runtime.ts` has the rest of the interface
 * (users, comments, live editing, files), which every editor shares.
 */
const generic = makeBridge([docsEditor], { version: "0.0.0" });

export interface OpenOptions {
  /** The title of a new document. */
  title?: string;
  /** The person using the document, for suggestions and comments. */
  user?: { id: string; name: string; role?: "viewer" | "commenter" | "editor" };
  /** Whether to turn on suggestions (tracked changes). Default true when there is a user. */
  suggestions?: boolean;
  /** Which services the app provides: `directory`, `storage`, `comments`. */
  host?: string[];
}

export const Pli = {
  ...generic,

  /** The commands there are, from the catalog the Swift and Kotlin code is generated from. */
  commands(): string {
    return ok(catalog.commands.map((c) => c.name));
  },

  /** Opens a document from its JSON (as `read("document")` gives it), or a new empty one. Returns the handle. */
  open(documentJson?: string | null, optionsJson?: string | null): string {
    return generic.openEditor("docs", "json", documentJson || null, optionsJson);
  },

  /** The document as a .docx file, as base64. */
  exportDocx(handle: number): string {
    return generic.exportFile(handle, "docx");
  },

  /** Replaces the document with a .docx file (as base64). Returns `{ warnings, authors }`. */
  importDocx(handle: number, base64: string, optionsJson?: string | null): string {
    return generic.importFile(handle, "docx", base64, optionsJson);
  },
};

export type { PliBridge };
(globalThis as { Pli?: typeof Pli }).Pli = Pli;
