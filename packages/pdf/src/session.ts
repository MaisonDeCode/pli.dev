import { createId, PliError, Session, type ChangeEvent, type TransactOptions } from "@pli.dev/core";
import { AnnotCommands } from "./commands/annots";
import { CommentCommands } from "./commands/comments";
import { ContentCommands } from "./commands/content";
import { FormCommands } from "./commands/forms";
import { OutlineCommands } from "./commands/outline";
import { PageCommands } from "./commands/pages";
import { MAIN_SOURCE, type PdfDoc } from "./model";
import { pdfReducer, type PdfOp } from "./ops";
import { memorySourceStore, type SourceStore } from "./sources";
import type { SaveOptions, SaveResult } from "./save";
import { hashPdfDoc } from "./sync";

/** What is selected, saved with each undo step so that undo puts the selection back. */
export interface PdfSelection {
  /** The page shown. */
  page: string | null;
  /** Selected annotations on it. */
  annots: string[];
  /** Selected form fields. */
  fields?: string[];
  /** Pages selected in the thumbnails (for the page tools: rotate, delete, extract). */
  pages?: string[];
}

export type PdfChangeEvent = ChangeEvent<PdfDoc, PdfOp, PdfSelection>;

export interface PdfSessionOptions {
  /** Where the bytes of source files are kept. Memory by default; back it with your file storage to share documents. */
  sources?: SourceStore;
  /** Who is editing: stamped on annotations as `author`, with `authorName` written into the PDF. */
  user?: { id: string; name?: string };
  /** The time in milliseconds, for `created` and `modified`. */
  now?: () => number;
  /** The password the file was opened with, used again when saving an encrypted file. */
  password?: string;
}

/** An empty document with no pages. */
export function emptyDoc(id: string = createId("pdf_")): PdfDoc {
  return { id, meta: {}, sources: [], pages: [], outline: [], fields: [] };
}

/**
 * A PDF being edited. State is a `PdfDoc` (plain JSON); every change goes through `transact` as invertible
 * `PdfOp`s. Commands are grouped by what they work on:
 *
 *     session.annots.add(...)    session.pages.rotate(...)    session.forms.setValue(...)
 *     session.content.applyRedactions(...)    session.outline.set(...)    session.comments...
 *
 * `openPdf` (see `open.ts`) makes a session from a file; `session.save()` writes it back.
 */
export class PdfSession {
  readonly core: Session<PdfDoc, PdfOp, PdfSelection>;
  readonly sources: SourceStore;
  readonly options: PdfSessionOptions;
  /** The document as read from the `main` source: every save is the original file plus the difference from this. */
  baseline: PdfDoc;
  /** The document at the last save, to tell whether there is anything unsaved. */
  saved: PdfDoc;
  readonly annots = new AnnotCommands(this);
  readonly pages = new PageCommands(this);
  readonly forms = new FormCommands(this);
  readonly content = new ContentCommands(this);
  readonly outline = new OutlineCommands(this);
  readonly comments = new CommentCommands(this);
  /** What is selected now. Saved with undo steps. */
  selection: PdfSelection = { page: null, annots: [] };
  /** Set by `openPdf`: how this session writes itself back. */
  saver?: (session: PdfSession, options: SaveOptions) => Promise<SaveResult>;

  constructor(doc: PdfDoc = emptyDoc(), options: PdfSessionOptions = {}) {
    this.core = new Session<PdfDoc, PdfOp, PdfSelection>(doc, pdfReducer);
    this.baseline = doc;
    this.saved = doc;
    this.options = options;
    this.sources = options.sources ?? memorySourceStore();
    this.selection = { page: doc.pages[0]?.id ?? null, annots: [] };
    // A shared session (`SyncClient`) replaces the whole document when it joins or reloads. The baseline stays what the file
    // says (a save is the file plus the difference), so peers' changes are still written; but a document that came back equal
    // to the baseline or to the last save is those documents (nothing to write, nothing unsaved).
    this.core.subscribe((event) => {
      if (!event.reset) return;
      const state = this.core.state;
      let hash: string | undefined;
      const same = (other: PdfDoc): boolean => other === state || (hash ??= hashPdfDoc(state)) === hashPdfDoc(other);
      if (this.baseline !== state && same(this.baseline)) this.baseline = state;
      if (this.saved !== state && same(this.saved)) this.saved = state;
    });
  }

  get doc(): PdfDoc {
    return this.core.state;
  }
  get canUndo(): boolean {
    return this.core.canUndo;
  }
  get canRedo(): boolean {
    return this.core.canRedo;
  }
  /** True when the document differs from the one that was opened or last saved. */
  get dirty(): boolean {
    return this.core.state !== this.saved;
  }

  now(): number {
    return (this.options.now ?? Date.now)();
  }

  subscribe(listener: (event: PdfChangeEvent) => void): () => void {
    return this.core.subscribe(listener);
  }

  /** Applies operations as one undoable step. `selection` is what the step leaves selected. */
  transact(ops: readonly PdfOp[], options: TransactOptions<PdfSelection> & { selection?: Partial<PdfSelection> } = {}): void {
    if (ops.length === 0) return;
    const before = options.before ?? this.selection;
    const { selection, ...rest } = options;
    const after = options.after ?? { ...this.selection, ...selection };
    this.core.transact(ops, { ...rest, before, after });
    this.selection = after;
  }

  select(selection: Partial<PdfSelection>): void {
    this.selection = { ...this.selection, ...selection };
  }

  undo(): boolean {
    const ok = this.core.undo();
    return ok;
  }
  redo(): boolean {
    return this.core.redo();
  }

  /** Writes the document to PDF bytes. */
  async save(options: SaveOptions = {}): Promise<Uint8Array> {
    return (await this.saveDetailed(options)).bytes;
  }

  /** Like `save`, and says how the file was written and what could not be written exactly. */
  async saveDetailed(options: SaveOptions = {}): Promise<SaveResult> {
    if (!this.saver) throw new PliError("unsupported", "this session has no file to save to: open one with openPdf, or pass a saver");
    return this.saver(this, options);
  }

  /** Says the document as it is now has been saved (`dirty` is false until the next change). `save` does not call it: you may not have stored the bytes. */
  markSaved(): void {
    this.saved = this.core.state;
  }

  /** Replaces the whole document and forgets history, as when a shared document reloads. */
  reset(doc: PdfDoc): void {
    this.core.reset(doc);
    this.baseline = doc;
    this.saved = doc;
    this.selection = { page: doc.pages[0]?.id ?? null, annots: [] };
  }

  /** The bytes of the file that was opened (the `main` source), if this store has them. */
  async mainBytes(): Promise<Uint8Array | undefined> {
    const source = this.doc.sources.find((s) => s.id === MAIN_SOURCE);
    return source ? this.sources.get(source) : undefined;
  }
}

export type { ChangeEvent };
