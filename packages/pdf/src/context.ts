import type { PdfFile, PageInfo } from "./cos/file";
import type { Overlay } from "./cos/overlay";
import type { PdfRef } from "./cos/objects";
import type { PdfDoc } from "./model";
import type { SaveOptions } from "./save";

/** What the readers (annotations, forms, outline) need to turn a file into JSON. One per source file that is read. */
export interface ReadContext {
  file: PdfFile;
  /** The source id (`main` for the opened file): ids of things read are made from it (`a:main:42`). */
  sourceId: string;
  pages: readonly PageInfo[];
  /** Page id by page object (`"12 0"`): lets links, outline entries and widgets say which page they are on. */
  pageIdByRef: ReadonlyMap<string, string>;
  /** Page object (`"12 0"`) by page id. */
  pageRefById: ReadonlyMap<string, PdfRef>;
}

/** What the writers need to turn the JSON back into a file. One per save. */
export interface WriteContext {
  /** The file being built: the original plus changes, or an empty file when the document has none. */
  overlay: Overlay;
  /** The document now. */
  doc: PdfDoc;
  /** The document as it was read from the original file: what to compare with, to write only what changed. */
  baseline: PdfDoc;
  /** The original file (`main`), if there is one. */
  main: PdfFile | null;
  /** Every source file the pages use, opened. */
  sources: ReadonlyMap<string, PdfFile>;
  /** The page object of each page id, set by `applyPages`. Everything after it adds to these. */
  pageRefs: Map<string, PdfRef>;
  options: SaveOptions;
  /** Whether the output is a new file (so content may be removed) rather than an update of the original. */
  rewrite: boolean;
  /** The time, in milliseconds, for modified dates. */
  now: number;
  /** Notes about things that could not be written exactly (for `SaveResult` and the log). */
  warnings: string[];
}
