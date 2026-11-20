import {
  CommentClient,
  createAbortHandle,
  createId,
  PliError,
  reloadCommentsOnHistory,
  Session,
  type BlobLike,
  type CommentChange,
  type CommentClientOptions,
  type CommentStore,
  type StorageClient,
  type Thread,
  type TransactOptions,
  type Users,
} from "@pli.dev/core";
import { anchorFor, attachOps, commentIdsIn, detachOps, documentCommentStore, reanchorOps } from "./comments";
import * as commands from "./commands";
import type { Command } from "./commands";
import type { Align, Block, BoxStyle, Columns, Doc, DocAnchor, DocStyle, FloatingBlock, FloatPlacement, ImageCrop, ListMarker, MarkPatch, Marks, PageSetup, ParagraphFormatPatch, RegionName, Run } from "./model";
import { DEFAULT_PAGE, pageSetupOf } from "./page";
import { sameShape, sectionShape, sectionsOf, type SectionShape } from "./sections";
import type { ImportOptions } from "./html/import";
import { canonicalOps, materializeStandIns } from "./canonical";
import { docReducer, type DocOp } from "./ops";
import { readPaste, type PasteInput } from "./paste";
import { applyMarkPatch, textLength } from "./runs";
import { isFloating, isTextBlock } from "./model";
import { caret, clampSelection, isCollapsed, mapSelection, selectAll, type Selection } from "./selection";
import { collectIds, locate } from "./tree";
import { REGION_NAMES } from "./regions";
import { newStyleId } from "./styles";
import { resolveSuggestionOps, stripSuggestions, suggestDelete, suggestInsert, suggestionsIn, type Suggester, type SuggestionInfo } from "./suggestions";
import { plainText } from "./runs";

/** What `DocumentSession.paste` did. */
export interface PasteResult {
  applied: boolean;
  /** Ids of pasted images that need their size set once the image has loaded. */
  unsizedImages: string[];
}

/** Where an image's upload stands. An image with no upload state has nothing in progress. */
export type UploadState =
  | { status: "uploading"; progress: number }
  | { status: "failed"; error: PliError };

/** How an upload ended. */
export interface UploadOutcome {
  /** `stored`: the image now points at its stored file. `failed`: it didn't; see `error`. `gone`: the image was removed first. */
  status: "stored" | "failed" | "gone";
  /** Whether the new reference joined the insert's undo step, so one undo removes the image. */
  merged: boolean;
  error?: PliError;
}

/** How comments are set up. Without this, a session has no comments. */
export interface DocumentCommentsOptions {
  /** Who is commenting, and who the authors of comments are. */
  users: Users;
  /**
   * Where comment threads are kept: `"document"` (the default) saves them inside the document, so they travel
   * with the file; or a `CommentStore` of your own, such as a table in your database.
   */
  store?: CommentStore<DocAnchor> | "document";
  permissions?: CommentClientOptions<DocAnchor>["permissions"];
  /** Called when a comment couldn't be saved. The change has been taken back. */
  onError?: CommentClientOptions<DocAnchor>["onError"];
  /** Hook in your own notifications: called once for each comment action of this person, with who to tell and why. See `CommentNotice`. */
  onNotify?: CommentClientOptions<DocAnchor>["onNotify"];
  /**
   * Set this when the document is shared with a `SyncClient`. Highlights are then ordinary changes that go to everyone,
   * so the session no longer puts them back by itself (from a thread's anchor) when a thread arrives from elsewhere,
   * and taking a deleted thread's highlight off the text is a change that is sent too.
   */
  synced?: boolean;
}

export interface DocumentSessionOptions {
  /** Where uploaded files go. Without it, images are embedded in the document as data URIs. */
  storage?: StorageClient;
  /** Turns on comments. */
  comments?: DocumentCommentsOptions;
  /**
   * Turns on suggestions (tracked changes): `users` says who is suggesting. A viewer can't suggest, a commenter can suggest
   * and withdraw their own, and an editor can also accept and reject anyone's.
   */
  suggestions?: { users: Users };
}

interface UploadRecord {
  file: BlobLike & { name?: string };
  options: { name?: string; type?: string };
  handle: ReturnType<typeof createAbortHandle>;
  state: UploadState;
  done: Promise<UploadOutcome>;
}

/** How long a pause ends a run of typing, so a new burst becomes its own undo step. */
const TYPING_GROUP_MS = 1000;

export function emptyDoc(title = "Untitled"): Doc {
  return { id: createId("doc_"), type: "document", title, blocks: [] };
}

/**
 * A document with its history and selection. Two ways to edit:
 *
 * - Direct helpers such as `insertText(block, offset, text)` address a position explicitly.
 * - Selection commands such as `typeText`, `splitBlock` and `toggleMark` act on the current
 *   selection the way an editor does, and make undo restore the selection too.
 */
export class DocumentSession extends Session<Doc, DocOp, Selection | null> {
  #selection: Selection | null;
  #cropping: string | null = null;
  #pending: Marks | null = null;
  #revision = 0;
  /** The last typing or deleting step, so consecutive keystrokes can share one undo step. */
  #run: { kind: "insert" | "backspace" | "delete"; at: number; after: Selection } | null = null;
  #selectionListeners = new Set<(selection: Selection | null) => void>();
  #storage: StorageClient | null;
  #uploads = new Map<string, UploadRecord>();
  #comments: CommentClient<DocAnchor> | null = null;
  /** Whether comments are saved in the document itself, rather than in a store of the app's. */
  #commentsInDocument = false;
  #suggestUsers: Users | null = null;
  #suggesting = false;

  constructor(initial: Doc = emptyDoc(), options: DocumentSessionOptions = {}) {
    super(initial, docReducer);
    this.#storage = options.storage ?? null;
    if (options.comments) this.#attachComments(options.comments);
    this.#suggestUsers = options.suggestions?.users ?? null;
    this.#selection = clampSelection(initial, null);
    // Registered first, so every other listener sees the selection already updated.
    this.subscribe((event) => {
      this.#revision++;
      // Someone else's changes move your caret along with the text it was in.
      const kept = event.origin === "remote" && event.meta === undefined && this.#selection ? mapSelection(this.#selection, event.ops, event.state) : this.#selection;
      const next = clampSelection(event.state, event.meta !== undefined ? event.meta : kept);
      this.#setSelection(next);
    });
  }

  get selection(): Selection | null {
    return this.#selection;
  }

  /**
   * Formatting for the next typed character, set by toggling a mark with a caret (Ctrl+B, then
   * type). Cleared when the selection moves.
   */
  get pendingMarks(): Marks | null {
    return this.#pending;
  }

  /** Increases whenever the document, selection or pending formatting changes. Handy for UI subscriptions. */
  get revision(): number {
    return this.#revision;
  }

  /** The comments of this document, or null if comments weren't turned on. */
  get comments(): CommentClient<DocAnchor> | null {
    return this.#comments;
  }

  /** Where uploaded files go, if the app set one up. */
  get storage(): StorageClient | null {
    return this.#storage;
  }

  setStorage(storage: StorageClient | null): void {
    this.#storage = storage;
    this.#touch();
  }

  /** How an image's upload is going, if it has one. Changes are announced like selection changes. */
  uploadState(blockId: string): UploadState | undefined {
    return this.#uploads.get(blockId)?.state;
  }

  /** How many uploads are running. Save the document only when this is 0 (or `await whenUploadsSettle()`). */
  get pendingUploads(): number {
    let n = 0;
    for (const record of this.#uploads.values()) if (record.state.status === "uploading") n++;
    return n;
  }

  /** Resolves when no upload is running. Failed uploads don't hold it up. */
  async whenUploadsSettle(): Promise<void> {
    for (;;) {
      const running = [...this.#uploads.values()].filter((r) => r.state.status === "uploading");
      if (running.length === 0) return;
      await Promise.all(running.map((r) => r.done));
    }
  }

  /**
   * Uploads a file for an image block already in the document, and points the block at the stored file when
   * it is done. The block holds a temporary address (such as a `blob:` URL of the file) until then. Call it
   * right after inserting the block: if nothing else has changed by the time the upload finishes, the new
   * reference joins the insert's undo step.
   *
   * Never throws for an upload that fails; see the returned `status`. Throws if the session has no storage.
   */
  uploadImage(blockId: string, file: BlobLike & { name?: string }, options: { name?: string; type?: string } = {}): Promise<UploadOutcome> {
    const storage = this.#storage;
    if (!storage) throw new PliError("unsupported", "This document has no storage client to upload to.");
    const running = this.#uploads.get(blockId);
    if (running?.state.status === "uploading") return running.done;

    const handle = createAbortHandle();
    const snapshot = this.state;
    const record: UploadRecord = { file, options, handle, state: { status: "uploading", progress: 0 }, done: Promise.resolve({ status: "gone", merged: false }) };
    this.#uploads.set(blockId, record);
    this.#touch();

    let shown = 0;
    record.done = (async (): Promise<UploadOutcome> => {
      try {
        const result = await storage.upload(file, {
          ...options,
          signal: handle.signal,
          // Announce progress in steps, so a big upload doesn't redraw the document on every byte.
          onProgress: (fraction) => {
            if (fraction - shown < 0.05 && fraction < 1) return;
            shown = fraction;
            record.state = { status: "uploading", progress: fraction };
            this.#touch();
          },
        });
        if (result.url) storage.prime(result.ref, result.url);
        this.#uploads.delete(blockId);
        const block = locate(this.state, blockId)?.block;
        if (block?.type !== "image") {
          this.#touch();
          return { status: "gone", merged: false };
        }
        const merged = this.state === snapshot;
        this.updateBlock(blockId, { src: result.ref }, { merge: merged });
        this.#touch();
        return { status: "stored", merged };
      } catch (cause) {
        const error = cause instanceof PliError ? cause : new PliError("storage", `Upload failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        if (locate(this.state, blockId)?.block.type === "image") record.state = { status: "failed", error };
        else this.#uploads.delete(blockId);
        this.#touch();
        return { status: "failed", merged: false, error };
      }
    })();
    return record.done;
  }

  /** Tries a failed upload again with the same file. Returns null if there is nothing to retry. */
  retryUpload(blockId: string): Promise<UploadOutcome> | null {
    const record = this.#uploads.get(blockId);
    if (!record || record.state.status !== "failed") return null;
    return this.uploadImage(blockId, record.file, record.options);
  }

  /** Stops an upload that is running. It shows as failed (code `cancelled`) until retried or dismissed. */
  cancelUpload(blockId: string): void {
    this.#uploads.get(blockId)?.handle.abort();
  }

  /** Forgets a failed upload, such as after the image is removed. */
  dismissUpload(blockId: string): void {
    if (this.#uploads.get(blockId)?.state.status === "failed") {
      this.#uploads.delete(blockId);
      this.#touch();
    }
  }

  /** Announces a change that isn't an edit, so a UI redraws. */
  #touch(): void {
    this.#revision++;
    this.#notifySelection();
  }

  /** Moves the selection without editing. Offsets are clamped into the document. */
  select(selection: Selection | null): void {
    this.#setSelection(clampSelection(this.state, selection));
  }

  selectAll(): void {
    this.#setSelection(selectAll(this.state));
  }

  /** Fires when the selection or the pending formatting changes. */
  onSelectionChange(listener: (selection: Selection | null) => void): () => void {
    this.#selectionListeners.add(listener);
    return () => this.#selectionListeners.delete(listener);
  }

  /**
   * Runs a command against the current selection and applies its ops as one undoable step.
   * Returns false when the command had nothing to do. Custom commands (and, later, user
   * scripts) go through here too.
   */
  exec(command: Command): boolean {
    return this.#exec(command);
  }

  /** Any edit other than a continuing keystroke ends the current typing run. */
  override transact(ops: readonly DocOp[], options?: TransactOptions<Selection | null>): void {
    this.#run = null;
    // Nothing is written in a stand-in cell paragraph: it is first turned into a real block, and the caret goes with it.
    const written = options?.origin === "remote" ? { ops, renames: new Map<string, string>() } : materializeStandIns(this.state, ops);
    if (written.renames.size > 0 && options?.after) {
      const move = (point: { block: string; offset: number }) => ({ block: written.renames.get(point.block) ?? point.block, offset: point.offset });
      options = { ...options, after: { anchor: move(options.after.anchor), focus: move(options.after.focus) } };
    }
    super.transact(canonicalOps(this.state, written.ops), options);
  }

  override undo(): boolean {
    this.#run = null;
    return super.undo();
  }

  override redo(): boolean {
    this.#run = null;
    return super.redo();
  }

  #exec(command: Command, kind?: "insert" | "backspace" | "delete"): boolean {
    const selection = this.#selection;
    if (!selection) return false;
    const result = command(this.state, selection);
    if (!result) return false;
    const now = Date.now();
    const run = this.#run;
    // Keystrokes of the same kind, in one place, within a second of each other, undo together.
    const merge =
      !!kind &&
      !!run &&
      run.kind === kind &&
      now - run.at < TYPING_GROUP_MS &&
      isCollapsed(selection) &&
      sameSelection(run.after, selection);
    this.transact(result.ops, { before: selection, after: result.selection, merge });
    this.#run = kind ? { kind, at: now, after: result.selection } : null;
    return true;
  }

  // Suggestions.

  /** Whether suggestions are turned on for this session, whether or not the current user may make them. */
  get suggestionsEnabled(): boolean {
    return !!this.#suggestUsers;
  }

  /** The users that suggestions are attributed to: look up a suggestion's author here. */
  get suggestionUsers(): Users | null {
    return this.#suggestUsers;
  }

  /** Whether this session has suggestions turned on and the current user may make them. */
  get canSuggest(): boolean {
    return !!this.#suggestUsers?.current && this.#suggestUsers.role !== "viewer";
  }

  /** Whether typing and deleting are being suggested rather than done. */
  get suggesting(): boolean {
    return this.#suggesting && this.canSuggest;
  }

  /** Turns suggesting mode on or off. Returns false when this user can't suggest. */
  setSuggesting(on: boolean): boolean {
    if (on && !this.canSuggest) return false;
    if (this.#suggesting === on) return true;
    this.#suggesting = on;
    this.#pending = null;
    this.#touch();
    return true;
  }

  #suggester(): Suggester {
    return { by: this.#suggestUsers!.current!.id, at: Date.now(), newId: () => createId("sg_") };
  }

  /** Every suggestion in the document, in the order its text appears. */
  get suggestions(): SuggestionInfo[] {
    return suggestionsIn(this.state);
  }

  /** Whether the current user may accept or reject this suggestion: editors any, commenters their own. */
  canResolveSuggestion(suggestion: Pick<SuggestionInfo, "by">, action: "accept" | "reject"): boolean {
    const user = this.#suggestUsers?.current;
    if (!user) return false;
    const role = this.#suggestUsers!.role;
    if (role === "editor") return true;
    return role === "commenter" && action === "reject" && suggestion.by === user.id;
  }

  /** Accepts a suggestion: an addition becomes ordinary text and text proposed for deletion goes. One undo step. */
  acceptSuggestion(id: string): boolean {
    return this.#resolve("accept", id);
  }

  /** Rejects a suggestion: an addition is removed and text proposed for deletion stays as it was. One undo step. */
  rejectSuggestion(id: string): boolean {
    return this.#resolve("reject", id);
  }

  /** Accepts every suggestion the current user may accept. */
  acceptAllSuggestions(): boolean {
    return this.#resolve("accept");
  }

  rejectAllSuggestions(): boolean {
    return this.#resolve("reject");
  }

  #resolve(action: "accept" | "reject", id?: string): boolean {
    const allowed = new Map(this.suggestions.map((s) => [s.id, this.canResolveSuggestion(s, action)]));
    const ops = resolveSuggestionOps(this.state, action, (s) => (id === undefined || s.id === id) && !!allowed.get(s.id));
    if (ops.length === 0) return false;
    this.transact(ops, { before: this.#selection, after: this.#selection });
    return true;
  }

  // Selection commands.

  /** Types at the caret, replacing any selected text. */
  typeText(text: string, marks?: Marks): boolean {
    if (this.suggesting) {
      const done = this.#exec(suggestInsert(text, this.#suggester(), marks ?? this.#pending ?? undefined), text === "\n" ? undefined : "insert");
      this.#pending = null;
      return done;
    }
    const applied = this.#exec(commands.insertText(text, marks ?? this.#pending ?? undefined), text === "\n" ? undefined : "insert");
    this.#pending = null;
    return applied;
  }
  /** Pastes plain text; line breaks become new blocks. One undo step. */
  pastePlainText(text: string): boolean {
    // Pasted text is suggested as text; its line breaks stay inside the paragraph.
    if (this.suggesting) return this.exec(suggestInsert(text.replace(/\r\n?/g, "\n"), this.#suggester()));
    return this.exec(commands.insertPlainText(text));
  }
  /**
   * Pastes what the clipboard offered (see `PasteInput`) as one undo step: a Pli fragment, HTML with its
   * formatting and tables, tab-separated text as a table, or plain text. `unsizedImages` lists pasted
   * images whose size wasn't known, for a caller that can load them and set their size.
   */
  paste(input: PasteInput, options?: ImportOptions): PasteResult {
    const content = readPaste(input, options);
    if (!content) return { applied: false, unsizedImages: [] };
    if (content.source === "text") return { applied: this.pastePlainText(content.text), unsizedImages: [] };
    // Suggested, pasted blocks come as their text: structure isn't tracked.
    if (this.suggesting) return { applied: this.pastePlainText(stripSuggestions(content.blocks).map((b) => ("runs" in b ? plainText(b.runs) : "")).join("\n")), unsizedImages: [] };
    const applied = this.exec(commands.insertFragment(content.blocks, content.footnotes, content.styles));
    return { applied, unsizedImages: applied ? content.unsizedImages : [] };
  }
  /** Enter. */
  splitBlock(): boolean {
    return this.exec(commands.splitBlock());
  }
  /** Backspace. */
  backspace(): boolean {
    if (this.suggesting) return this.#exec(suggestDelete("backspace", this.#suggester()), "backspace");
    return this.#exec(commands.backspace(), "backspace");
  }
  /** Delete. */
  deleteForward(): boolean {
    if (this.suggesting) return this.#exec(suggestDelete("delete", this.#suggester()), "delete");
    return this.#exec(commands.deleteForward(), "delete");
  }
  deleteSelection(): boolean {
    if (this.suggesting) return this.exec(suggestDelete("selection", this.#suggester()));
    return this.exec(commands.deleteSelection());
  }
  /**
   * Toggles a mark on the selected text. With only a caret, it sets the formatting for the next
   * typed character instead.
   */
  toggleMark(key: commands.ToggleMarkKey): boolean {
    const selection = this.#selection;
    if (!selection) return false;
    if (!isCollapsed(selection)) return this.exec(commands.toggleMark(key));
    return this.#patchPending(commands.markPatchFor(key, !this.#caretMarks()[key]));
  }
  /**
   * Sets marks such as color, font or link on the selected text. With only a caret, it sets
   * them for the next typed character instead.
   */
  setMarks(patch: MarkPatch): boolean {
    const selection = this.#selection;
    if (selection && isCollapsed(selection)) return this.#patchPending(patch);
    return this.exec(commands.setMarks(patch));
  }
  clearFormatting(): boolean {
    return this.exec(commands.clearFormatting());
  }

  /**
   * Makes text wrap around the selected picture, which then sits at the left or right edge, or puts it back on a line of its
   * own with `null`. Returns false when no picture is selected.
   */
  setImageWrap(wrap: "left" | "right" | null): boolean {
    const selection = this.#selection;
    const block = selection ? locate(this.state, selection.focus.block)?.block : undefined;
    if (!block || block.type !== "image") return false;
    if ((block.wrap ?? null) === wrap && !block.float) return true;
    // Text wrapping round a picture, or the picture in a line of text, takes it off the page if it was fixed there.
    const { wrap: _old, float: _float, ...rest } = block;
    this.transact([{ type: "replace_block", id: block.id, block: (wrap ? { ...rest, wrap } : rest) as Block }]);
    return true;
  }

  /**
   * Crops the selected picture: `crop` is the share of it to cut away from each edge, or `null` to show all of it again. The picture
   * keeps its size on the page, so what is left is stretched to fit it, unless `keepShape` is false, which keeps what is left in
   * proportion by changing the height. Returns false when no picture is selected.
   */
  setImageCrop(crop: ImageCrop | null, options: { merge?: boolean } = {}): boolean {
    const selection = this.#selection;
    const block = selection ? locate(this.state, selection.focus.block)?.block : undefined;
    if (!block || block.type !== "image") return false;
    return this.cropImage(block.id, crop, options);
  }

  /**
   * Crops a picture by id (see `setImageCrop`). With `rescale`, the picture keeps its scale: cutting an edge makes it smaller on the
   * page, as it does in Word, instead of stretching what is left to the same size.
   */
  cropImage(id: string, crop: ImageCrop | null, options: { merge?: boolean; rescale?: boolean } = {}): boolean {
    const block = locate(this.state, id)?.block;
    if (!block || block.type !== "image") return false;
    const clean = crop && (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0) ? crop : null;
    const { crop: was, ...rest } = block;
    let { width, height } = block;
    if (options.rescale) {
      const had = was ?? { top: 0, right: 0, bottom: 0, left: 0 };
      const next = clean ?? { top: 0, right: 0, bottom: 0, left: 0 };
      const fullWidth = block.width / (1 - had.left - had.right);
      const fullHeight = block.height / (1 - had.top - had.bottom);
      width = Math.max(Math.round(fullWidth * (1 - next.left - next.right)), 1);
      height = Math.max(Math.round(fullHeight * (1 - next.top - next.bottom)), 1);
    }
    this.transact([{ type: "replace_block", id, block: { ...rest, width, height, ...(clean && { crop: clean }) } as Block }], options.merge ? { merge: true } : undefined);
    return true;
  }

  // Pictures and text boxes that float on the page.

  /** Puts a floating picture or text box in the document, against the paragraph the caret is in. See `floatingImage` and `textBox`. */
  insertFloat(block: FloatingBlock): boolean {
    return this.exec(commands.insertFloat(block));
  }

  /**
   * Changes where a floating picture or text box sits and how it looks: the parts of `change` replace the ones it has (an `x` or `y`
   * is replaced whole). `null` puts it back in the text: a picture on a line of its own, a text box as a plain one-cell table.
   * `id` is the block's, or the selected one's when left out. Returns false when it isn't a floating block.
   */
  setFloat(change: Partial<FloatPlacement & BoxStyle> | null, id?: string, options: { merge?: boolean } = {}): boolean {
    const target = id ?? this.#selection?.focus.block;
    const found = target ? locate(this.state, target) : null;
    // A caret in a text box's text means the box.
    const block = found?.cell && found.cell.table.float ? found.cell.table : found?.block;
    // A picture in the text can be put on the page (`{}` does it, at its paragraph); a table can't become a text box.
    const plain = block?.type === "image" && !block.float && !found?.cell && change !== null;
    if (!block || (!isFloating(block) && !plain)) return false;
    let float: Record<string, unknown> | null = null;
    if (change) {
      float = isFloating(block) ? { ...block.float } : { x: { from: "column" }, y: { from: "paragraph" } };
      for (const [key, value] of Object.entries(change)) {
        if (value === undefined) delete float[key];
        else float[key] = value;
      }
      // A text box keeps a size, and a picture keeps the one it has.
      if (block.type === "image") for (const key of ["width", "height", "shape", "fill", "fillOpacity", "line", "padding"]) delete float[key];
    }
    const patch: Record<string, unknown> = { float };
    // On the page, a picture is no longer beside text or lined up in a line.
    if (block.type === "image" && float) Object.assign(patch, { wrap: null, align: null });
    if (block.type === "image" && change && (change.width !== undefined || change.height !== undefined)) {
      patch.width = Math.max(1, Math.round(change.width ?? block.width));
      patch.height = Math.max(1, Math.round(change.height ?? block.height));
    }
    this.transact([{ type: "update_block", id: block.id, patch }], options.merge ? { merge: true } : undefined);
    return true;
  }

  /** The floating pictures and text boxes of the document, in the order they come in. */
  get floats(): FloatingBlock[] {
    return this.state.blocks.filter(isFloating);
  }

  /** The picture whose crop is being set (it shows all of the picture, with a grip on each edge), if any. */
  get croppingImage(): string | null {
    return this.#cropping;
  }

  /** Starts or ends setting the crop of the selected picture by dragging its edges. Returns false when no picture is selected. */
  setCropping(on: boolean): boolean {
    const selection = this.#selection;
    const block = selection ? locate(this.state, selection.focus.block)?.block : undefined;
    if (on && (!block || block.type !== "image")) return false;
    const next = on ? block!.id : null;
    if (next === this.#cropping) return true;
    this.#cropping = next;
    this.#revision++;
    this.#notifySelection();
    return true;
  }

  // Named styles.

  /** The named styles of the document, by id. */
  get styles(): Readonly<Record<string, DocStyle>> {
    return this.state.styles ?? {};
  }
  /** Sets the paragraph style of the selected paragraphs. `null` takes it off. */
  applyParagraphStyle(id: string | null): boolean {
    return this.exec(commands.setParagraphStyle(id));
  }
  /** Sets the character style of the selected text, or for the next typed character if only the caret is set. `null` takes it off. */
  applyCharacterStyle(id: string | null): boolean {
    const selection = this.#selection;
    if (id !== null && this.state.styles?.[id]?.kind !== "character") return false;
    if (selection && isCollapsed(selection)) return this.#patchPending({ style: id });
    return this.exec(commands.setCharacterStyle(id));
  }
  /**
   * Makes a style that looks like the selection and applies it (see `commands.defineStyle`). Returns the new style's id,
   * or null if there was nothing to take it from.
   */
  createStyle(name: string, kind: DocStyle["kind"]): string | null {
    const id = newStyleId(this.state, name);
    return this.exec(commands.defineStyle({ id, name: name.trim() || "Style", kind })) ? id : null;
  }
  /** Makes an existing style look like the selection. Everything using it follows. */
  updateStyleFromSelection(id: string): boolean {
    const style = this.state.styles?.[id];
    if (!style) return false;
    return this.exec(commands.defineStyle({ id, name: style.name, kind: style.kind, ...(style.basedOn && { basedOn: style.basedOn }) }));
  }
  /** Defines a style from its parts, or removes it with `null` (see `deleteStyle` to also take it off the text). */
  setStyle(id: string, style: DocStyle | null): void {
    this.transact([{ type: "set_style", id, style }]);
  }
  /** Changes the name, base or look of a style, leaving the rest as it was. */
  changeStyle(id: string, patch: Partial<Omit<DocStyle, "kind">>): boolean {
    const style = this.state.styles?.[id];
    if (!style) return false;
    this.transact([{ type: "set_style", id, style: { ...style, ...patch } }]);
    return true;
  }
  /** Removes a style, and takes it off every paragraph and piece of text that used it. */
  deleteStyle(id: string): boolean {
    return this.exec(commands.deleteStyle(id));
  }
  /**
   * Changes spacing or indents of the selected paragraphs. With `merge`, the change joins the previous undo
   * step, so a drag that makes many small changes undoes as one.
   */
  setParagraphFormat(patch: ParagraphFormatPatch, options: { merge?: boolean } = {}): boolean {
    if (!options.merge) return this.exec(commands.setParagraphFormat(patch));
    const selection = this.#selection;
    const result = selection && commands.setParagraphFormat(patch)(this.state, selection);
    if (!result) return false;
    this.transact(result.ops, { before: selection, after: result.selection, merge: true });
    return true;
  }
  /** Links the selection (or inserts `text` as a link at a caret). `null` removes the link. */
  setLink(url: string | null, text?: string): boolean {
    return this.exec(commands.setLink(url, text));
  }
  /** Inserts an image, page break, divider or table of contents at the caret. */
  insertBlockAtCaret(block: Block): boolean {
    return this.exec(commands.insertBlock(block));
  }
  insertField(field: "page" | "pages"): boolean {
    return this.exec(commands.insertField(field));
  }

  // Tables.

  /** Inserts a table at the caret, with the caret in its first cell. */
  insertTable(rows: number, columns: number, options?: { headerRow?: boolean; borders?: "all" | "horizontal" | "none" }): boolean {
    return this.exec(commands.insertTable(rows, columns, options));
  }
  addRow(position: "above" | "below"): boolean {
    return this.exec(commands.addRow(position));
  }
  addColumn(position: "left" | "right"): boolean {
    return this.exec(commands.addColumn(position));
  }
  /** Deletes the selected rows (or the table, if that is every row). */
  deleteRow(): boolean {
    return this.exec(commands.deleteRow());
  }
  deleteColumn(): boolean {
    return this.exec(commands.deleteColumn());
  }
  deleteTable(): boolean {
    return this.exec(commands.deleteTable());
  }
  /** Merges the cells covered by a drag across several cells into one. */
  mergeCells(): boolean {
    return this.exec(commands.mergeCells());
  }
  /** Splits merged cells in the selection back into single cells. */
  splitCells(): boolean {
    return this.exec(commands.splitCells());
  }
  /** Minimum height, in points, of the selected rows. `null` fits the content. */
  setRowHeight(points: number | null): boolean {
    return this.exec(commands.setRowHeight(points));
  }
  /** Where the content sits in the height of the selected cells. */
  setCellVerticalAlign(align: "top" | "middle" | "bottom"): boolean {
    return this.exec(commands.setCellVerticalAlign(align));
  }
  setHeaderRow(on: boolean): boolean {
    return this.exec(commands.setHeaderRow(on));
  }
  setTableBorders(borders: "all" | "horizontal" | "none"): boolean {
    return this.exec(commands.setTableBorders(borders));
  }
  /** Colors the selected cells' background. `null` clears it. */
  setCellShade(color: string | null): boolean {
    return this.exec(commands.setCellShade(color));
  }
  setColumnWidths(widths: readonly number[]): boolean {
    return this.exec(commands.setColumnWidths(widths));
  }
  /**
   * Tab and Shift+Tab: moves to the next or previous cell. Past the last cell it adds a row.
   * Returns false when the caret isn't in a table.
   */
  moveToCell(direction: 1 | -1): boolean {
    const selection = this.#selection;
    if (!selection) return false;
    const move = commands.cellNeighbor(this.state, selection, direction);
    if (!move) return false;
    if ("appendRow" in move) return this.exec(commands.addRow("below", 0));
    this.select(caret(move.to.block, move.to.offset));
    return true;
  }
  setBlockType(spec: commands.BlockSpec): boolean {
    return this.exec(commands.setBlockType(spec));
  }
  toggleBlockType(spec: commands.BlockSpec): boolean {
    return this.exec(commands.toggleBlockType(spec));
  }
  indent(): boolean {
    return this.exec(commands.indent());
  }
  outdent(): boolean {
    return this.exec(commands.outdent());
  }
  /** Sets the marker style of the selected lists: `"decimal"`, `"lower-alpha"`, `"upper-roman"`, `"square"` and so on. `null` goes back to the default. */
  setListMarker(marker: ListMarker | null): boolean {
    return this.exec(commands.setListMarker(marker));
  }
  /** Numbers the first selected item `start` and carries on from it: restarts a list at 1, or starts it at any number. */
  setListStart(start: number): boolean {
    return this.exec(commands.setListStart(start));
  }
  /** Takes the selected items back into the numbering of the list above them, undoing a restart. */
  continueNumbering(): boolean {
    return this.exec(commands.setListStart(null));
  }
  setAlign(align: Align): boolean {
    return this.exec(commands.setAlign(align));
  }

  // Direct, position-addressed helpers. These don't touch the selection except to keep it valid.

  insertBlock(block: Block, after: string | null = this.#lastId()): void {
    this.transact([{ type: "insert_block", block, after }]);
  }

  deleteBlock(id: string): void {
    const located = locate(this.state, id);
    // A table cell keeps at least one block. (Merging other people's edits may still leave one empty, and the operation then puts an empty paragraph there.)
    if (located?.cell && located.list.length === 1) throw new PliError("invalid_operation", "A table cell must keep at least one block");
    this.transact([{ type: "delete_block", id }]);
  }

  insertText(block: string, offset: number, text: string, marks?: Marks): void {
    const run: Run = marks ? { text, marks } : { text };
    this.transact([{ type: "insert_text", block, offset, runs: [run] }]);
  }

  /** Appends text to the end of a block. */
  appendText(block: string, text: string, marks?: Marks): void {
    const target = locate(this.state, block)?.block;
    const offset = target && "runs" in target ? textLength(target.runs) : 0;
    this.insertText(block, offset, text, marks);
  }

  deleteText(block: string, from: number, to: number): void {
    this.transact([{ type: "delete_text", block, from, to }]);
  }

  format(block: string, from: number, to: number, patch: MarkPatch): void {
    this.transact([{ type: "format_text", block, from, to, patch }]);
  }

  setTitle(title: string): void {
    this.transact([{ type: "set_title", title }]);
  }

  /** Sets page size, orientation and margins. `null` restores the default. With `merge`, joins the previous undo step. */
  setPage(page: PageSetup | null, options: { merge?: boolean } = {}): void {
    this.transact([{ type: "set_page", page }], options.merge ? { merge: true } : undefined);
  }

  /**
   * Starts a new section at the caret, on the next page or (`continuous`) right after the text above. It keeps the
   * columns of the section it was split from.
   */
  insertSectionBreak(kind: "next_page" | "continuous"): boolean {
    return this.exec(commands.insertSectionBreak(kind));
  }

  /**
   * Sets the columns of the text: of the section the caret is in, or, with a selection, of just the selected blocks
   * (section breaks are added around them as needed). `null` goes back to one column.
   */
  setColumns(columns: Columns | null): boolean {
    return this.exec(commands.setColumns(columns));
  }

  /**
   * Replaces everything in the document with what `next` has: its text, title, page setup, headers and footers,
   * footnotes and styles, and, when comments are saved in the document, its comments. One undo step, with the
   * caret at the start. `next`'s block ids must not already be in the document, which holds for what `fromDocx`
   * returns. Comments kept in a store of your own aren't touched: save `next.comments` there yourself.
   */
  replaceDocument(next: Doc): void {
    const old = this.state;
    const taken = collectIds(old.blocks);
    for (const id of collectIds(next.blocks)) {
      if (taken.has(id)) throw new PliError("invalid_operation", `Block id "${id}" is already in the document`);
    }
    const ops: DocOp[] = [];
    if (next.title !== old.title) ops.push({ type: "set_title", title: next.title });
    if (JSON.stringify(next.page ?? null) !== JSON.stringify(old.page ?? null)) ops.push({ type: "set_page", page: next.page ?? null });
    // The new text goes in after the old, which is then removed, so the document is never empty.
    let after = old.blocks[old.blocks.length - 1]?.id ?? null;
    for (const block of next.blocks) {
      ops.push({ type: "insert_block", block, after });
      after = block.id;
    }
    for (const block of old.blocks) ops.push({ type: "delete_block", id: block.id });
    for (const name of REGION_NAMES) if (old[name] !== undefined || next[name] !== undefined) ops.push({ type: "set_region", region: name, blocks: next[name] ?? null });
    for (const id of Object.keys(old.footnotes ?? {})) if (!next.footnotes?.[id]) ops.push({ type: "set_footnote", id, blocks: null });
    for (const [id, blocks] of Object.entries(next.footnotes ?? {})) ops.push({ type: "set_footnote", id, blocks });
    for (const id of Object.keys(old.styles ?? {})) if (!next.styles?.[id]) ops.push({ type: "set_style", id, style: null });
    for (const [id, style] of Object.entries(next.styles ?? {})) ops.push({ type: "set_style", id, style });
    if (this.#commentsInDocument) {
      for (const id of Object.keys(old.comments ?? {})) if (!next.comments?.[id]) ops.push({ type: "set_thread", id, thread: null });
      for (const [id, thread] of Object.entries(next.comments ?? {})) ops.push({ type: "set_thread", id, thread });
    }
    const first = next.blocks.find(isTextBlock);
    this.transact(ops, { before: this.selection, after: first ? caret(first.id, 0) : null });
    if (this.#commentsInDocument) void this.#comments?.reload();
  }

  /** Replaces the content of a header or footer (see `RegionName`). `null` removes it. */
  setRegion(region: RegionName, blocks: Block[] | null): void {
    this.transact([{ type: "set_region", region, blocks }]);
  }

  /**
   * Starts a comment thread on the selected text, with `body` as its first comment, as one undo step (which
   * takes the highlight off again). Returns null if no text is selected. Pass a selection to comment on text
   * other than the current one, for instance the one a comment box was opened for, and `mentions` for the ids of
   * the people `body` mentions with `@Name`.
   */
  comment(body: string, selection: Selection | null = this.selection, mentions?: readonly string[]): Thread<DocAnchor> | null {
    const client = this.#comments;
    if (!client) throw new PliError("unsupported", "Comments aren't turned on: pass `comments` when making the session");
    if (!selection || isCollapsed(selection)) return null;
    const anchor = anchorFor(this.state, selection);
    if (!anchor) return null;
    const id = createId("th_");
    const ops = attachOps(this.state, selection, id);
    // Created first, so a refusal (a viewer, say) leaves the document alone.
    const thread = client.createThread(body, anchor, id, mentions);
    this.transact(ops, { before: selection, after: selection });
    return thread;
  }

  /**
   * Turns comments on for a session that was made without them (the `comments` option does the same at construction).
   * Returns the client; if comments were already on, returns the one that is there.
   */
  enableComments(options: DocumentCommentsOptions): CommentClient<DocAnchor> {
    if (!this.#comments) this.#attachComments(options);
    return this.#comments!;
  }

  #attachComments(options: DocumentCommentsOptions): void {
    const session = this;
    const inDocument = options.store === undefined || options.store === "document";
    const documentStore = documentCommentStore({
      get state() {
        return session.state;
      },
      write: (ops) => session.transact(ops, { origin: "remote" }),
    });
    const store = inDocument ? documentStore : (options.store as CommentStore<DocAnchor>);
    const client = new CommentClient<DocAnchor>({
      file: this.state.id,
      users: options.users,
      store,
      initial: Object.values(this.state.comments ?? {}),
      permissions: options.permissions,
      onNotify: options.onNotify,
      onError: (error, change) => {
        // A thread that couldn't be saved has nothing to attach to.
        if (change.type === "thread.create") this.#detach(change.thread.id, options.synced ? "shared" : "remote");
        options.onError?.(error, change);
      },
    });
    client.onChange((change: CommentChange<DocAnchor>, origin) => {
      // Comments kept in the document are kept in every copy of it, so what others write is saved here too.
      if (inDocument && origin === "remote") void documentStore.save(this.state.id, change);
      if (change.type === "thread.delete") {
        // When shared, the person who deleted it takes the highlight off, and that reaches everyone else as a change.
        if (!options.synced || origin === "local") this.#detach(change.threadId, options.synced ? "shared" : "remote");
      } else if (change.type === "thread.create" && origin === "remote" && !options.synced) {
        this.#reanchor(change.thread);
      }
    });
    // Threads that arrive with the store's load and have lost their highlight get it back.
    if (!options.synced) {
      void client.ready.then(() => {
        for (const thread of client.threads) this.#reanchor(thread);
      });
    }
    this.#comments = client;
    this.#commentsInDocument = inDocument;
    // Undoing or redoing something that changed the comments saved in the document (an import, say) shows in the panel.
    if (inDocument) reloadCommentsOnHistory(client, this, (op) => op.type === "set_thread");
  }

  /** Takes a thread's highlight off the text. Not an undo step: the thread is what went. */
  #detach(id: string, kind: "remote" | "shared" = "remote"): void {
    const ops = detachOps(this.state, id);
    // Shared: a change like any other, sent to everyone, that isn't an undo step.
    if (ops.length > 0) this.transact(ops, kind === "shared" ? { history: false } : { origin: "remote" });
  }

  #reanchor(thread: Thread<DocAnchor>): void {
    if (commentIdsIn(this.state.blocks).has(thread.id)) return;
    const ops = reanchorOps(this.state, thread);
    if (ops.length > 0) this.transact(ops, { origin: "remote" });
  }

  /** Sets the text of a footnote (see `Doc.footnotes`). `null` removes it. */
  setFootnote(id: string, blocks: Block[] | null): void {
    this.transact([{ type: "set_footnote", id, blocks }]);
  }

  /**
   * Inserts a footnote reference at the caret (replacing a selection) and an empty note for it, as one undo
   * step. Returns the new note's id, to edit its text with `setFootnote`, or null where a note can't go.
   */
  insertFootnote(blocks?: Block[]): string | null {
    const id = createId("fn_");
    return this.exec(commands.insertFootnote(id, blocks)) ? id : null;
  }

  /**
   * Sets a header or footer of a section (see `RegionName`). Section 0 is the first, whose headers belong to the
   * document (`setRegion`). For a later section, `blocks` is its own header or footer, empty to make it blank,
   * and `null` links it to the previous section's again.
   */
  setSectionRegion(section: number, region: RegionName, blocks: Block[] | null): void {
    if (section === 0) return this.setRegion(region, blocks && blocks.length > 0 ? blocks : null);
    const start = sectionsOf(this.state)[section]?.start;
    if (!start) throw new PliError("not_found", `No section ${section}`);
    const { [region]: _old, ...others } = start.regions ?? {};
    const regions = blocks ? { ...others, [region]: blocks } : others;
    const { regions: _regions, ...rest } = start;
    this.transact([{ type: "replace_block", id: start.id, block: Object.keys(regions).length > 0 ? { ...rest, regions } : rest }]);
  }

  /**
   * Sets the page size, orientation and margins of one section, or of the whole document. Setting one section
   * leaves the others as they are: a section after it that followed it keeps the shape it had. Sections whose pages
   * are shaped differently from the one before start on a new page. With `"document"`, every section gets the same
   * shape and the per-section settings are cleared.
   */
  setPageShape(shape: SectionShape, scope: "document" | number = "document", options: { merge?: boolean } = {}): void {
    const doc = this.state;
    const sections = sectionsOf(doc);
    const page = pageSetupOf(doc);
    const ops: DocOp[] = [];
    if (scope === "document") {
      ops.push({ type: "set_page", page: { ...page, size: shape.size, orientation: shape.orientation, margins: shape.margins } });
      for (const section of sections) {
        if (section.start?.page) {
          const { page: _page, ...rest } = section.start;
          ops.push({ type: "replace_block", id: section.start.id, block: rest });
        }
      }
    } else {
      const own = sections[scope];
      if (!own) throw new PliError("not_found", `No section ${scope}`);
      const old = sectionShape(doc, sections, scope);
      if (sameShape(old, shape)) return;
      if (scope === 0) ops.push({ type: "set_page", page: { ...page, size: shape.size, orientation: shape.orientation, margins: shape.margins } });
      else ops.push({ type: "replace_block", id: own.start!.id, block: { ...own.start!, page: { size: shape.size, orientation: shape.orientation, margins: shape.margins } } });
      // The section after it, if it was following this one, keeps what it had.
      const after = sections[scope + 1]?.start;
      if (after && !after.page) ops.push({ type: "replace_block", id: after.id, block: { ...after, page: { size: old.size, orientation: old.orientation, margins: old.margins } } });
    }
    if (ops.length > 0) this.transact(ops, options.merge ? { merge: true } : undefined);
  }

  /** Gives a section's first page its own header and footer, or not. Section 0 is the first, set in the page setup. */
  setSectionFirstPage(section: number, on: boolean): void {
    if (section === 0) return this.setRegionOptions({ differentFirstPage: on });
    const start = sectionsOf(this.state)[section]?.start;
    if (!start) throw new PliError("not_found", `No section ${section}`);
    if (!!start.differentFirstPage === on) return;
    const { differentFirstPage: _old, ...rest } = start;
    this.transact([{ type: "replace_block", id: start.id, block: on ? { ...rest, differentFirstPage: true } : rest }]);
  }

  /**
   * Turns the first-page and odd/even headers and footers on or off. The content of one that is turned off
   * is kept, so turning it on again brings it back.
   */
  setRegionOptions(options: { differentFirstPage?: boolean; differentOddEven?: boolean }): void {
    const page = this.state.page ?? DEFAULT_PAGE;
    const next: PageSetup = { ...page };
    for (const key of ["differentFirstPage", "differentOddEven"] as const) {
      const value = options[key];
      if (value === undefined) continue;
      if (value) next[key] = true;
      else delete next[key];
    }
    if (JSON.stringify(next) !== JSON.stringify(page)) this.setPage(next);
  }

  /** Inserts a borderless table of two or three columns at the caret: text on the left and right, or left, centre and right. */
  insertColumns(count: 2 | 3): boolean {
    return this.exec(commands.insertColumns(count));
  }

  /**
   * Changes properties of a block, such as an image's size. The block keeps its id and type.
   * With `merge`, the change joins the previous undo step instead of being its own.
   */
  updateBlock(id: string, patch: Record<string, unknown>, options: { merge?: boolean } = {}): void {
    const block = locate(this.state, id)?.block;
    if (!block) throw new PliError("not_found", `No block with id "${id}"`);
    this.transact([{ type: "replace_block", id, block: { ...block, ...patch } as Block }], options.merge ? { merge: true } : undefined);
  }

  #caretMarks(): Marks {
    if (this.#pending) return this.#pending;
    const selection = this.#selection;
    if (!selection) return {};
    const block = locate(this.state, selection.focus.block)?.block;
    return (block && isTextBlock(block) ? commands.marksAtCaret(block, selection.focus.offset) : undefined) ?? {};
  }

  /** Records formatting to apply to the next typed text. */
  #patchPending(patch: MarkPatch): boolean {
    if (!this.#selection) return false;
    this.#pending = applyMarkPatch(this.#caretMarks(), patch) ?? {};
    this.#revision++;
    this.#notifySelection();
    return true;
  }

  #setSelection(next: Selection | null): void {
    if (sameSelection(this.#selection, next)) return;
    this.#selection = next;
    if (this.#cropping && next?.focus.block !== this.#cropping) this.#cropping = null;
    this.#pending = null;
    this.#revision++;
    this.#notifySelection();
  }

  #notifySelection(): void {
    for (const listener of this.#selectionListeners) listener(this.#selection);
  }

  #lastId(): string | null {
    return this.state.blocks[this.state.blocks.length - 1]?.id ?? null;
  }
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.anchor.block === b.anchor.block &&
    a.anchor.offset === b.anchor.offset &&
    a.focus.block === b.focus.block &&
    a.focus.offset === b.focus.offset
  );
}
