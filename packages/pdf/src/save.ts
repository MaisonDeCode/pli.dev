/** How a document is written. */
export interface SaveOptions {
  /**
   * `auto` (default): append to the original file (the original bytes are kept exactly, so digital signatures stay
   * valid) unless the change has to remove content: deleted pages, redactions, replaced text or pictures, or
   * `flatten`, which write a new file. `incremental` fails if that is not possible. `rewrite` always writes a new file.
   * `optimise` writes a new, smaller file: unused objects dropped, streams recompressed, object streams.
   */
  mode?: "auto" | "incremental" | "rewrite" | "optimise";
  /** Draw annotations and form fields into the pages and remove them, so no reader can change them. Implies a new file. */
  flatten?: boolean | "annotations" | "forms";
  /** Names for the `/T` entry of replies and comments, by `PliUser.id` (readers show the name; the id is kept in the file as well). */
  authorNames?: Record<string, string>;
  /** Fonts to embed for text boxes and form fields, by name, in the shape `FontRegistry.pdfFonts()` returns. */
  fonts?: Record<string, Uint8Array>;
  /**
   * Take what identifies the document out of the new file: the information dictionary (title, author...), XMP
   * metadata, attached files, JavaScript, page thumbnails and private application data. Needs a new file: use
   * `mode: "rewrite"` (`session.content.scrubMetadata()` does).
   */
  scrub?: boolean;
  /**
   * Fetches a picture that is a web address (annotation pictures kept in file storage are). Default: `globalThis.fetch`
   * when there is one. A picture that cannot be fetched is not embedded (an annotation picture is drawn as a placeholder box, a picture
   * replacement keeps the old picture) and the result has a warning.
   */
  fetch?: (url: string) => Promise<FetchedPicture>;
}

/** What `SaveOptions.fetch` returns: the bytes of a PNG or JPEG picture (the type is found from the bytes). */
export interface FetchedPicture {
  bytes: Uint8Array;
  mime?: string;
}

/** What `save` found worth telling. */
export interface SaveResult {
  bytes: Uint8Array;
  /** `incremental` appended to the original file; `rewrite` wrote a new one. */
  mode: "incremental" | "rewrite";
  /** Things that could not be written exactly (a font that was missing, an annotation type that was dropped). */
  warnings: string[];
}
