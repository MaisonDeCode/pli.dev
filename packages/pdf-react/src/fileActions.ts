/**
 * The file commands: save, download, print, export pages as pictures, open, rename.
 *
 * `FileActions` is an observable controller (one per session), like `PageTools`. The host's callbacks (`onSave`, `onOpen`,
 * `onPrint`, `download`) are set on `hooks` on every render.
 */
import { PliError } from "@pli.dev/core";
import { MAIN_SOURCE, pdfFromImages, type PdfSession, type SaveOptions, type SaveResult } from "@pli.dev/pdf";
import { documentName, downloadBytes, fileStem, makeZip, pickFiles, safeName, type NamedFile } from "./download";
import { exportPageImages, IMAGE_MIME } from "./exportImages";
import { setSelection } from "./hooks";
import { rangeText, sniffFile } from "./pageTools";
import type { PdfRenderer } from "./renderer";
import { preflight, saveBytes, saveDetailed } from "./saving";
import { Notices, Store, plainMessage } from "./store";

/** How a download is written (the options of the download dialog). */
export type SaveChoice = "keep" | "optimise" | "flatten" | "forms";

export interface FileHooks {
  /** Called with the saved bytes; the document counts as saved once the promise it returns resolves. */
  onSave?: (bytes: Uint8Array, result: SaveResult) => void | Promise<void>;
  /** Replaces the document with another file. Without it the Open and Create commands are not offered. */
  onOpen?: (bytes: Uint8Array, name: string) => void | Promise<void>;
  /** Replaces the built-in print. */
  onPrint?: () => void | Promise<void>;
  /** Replaces the browser download. */
  download?: (bytes: Uint8Array, name: string, mime: string) => void | Promise<void>;
}

export type FileDialog =
  | { type: "download" }
  | { type: "result"; title: string; name: string; size: number; original: number; mode: "incremental" | "rewrite"; warnings: string[] }
  | { type: "export" }
  | { type: "discard"; then: () => void | Promise<void> };

export interface ExportRequest {
  format: "png" | "jpeg";
  dpi: number;
  /** Which pages: the selected ones, all, or a range text like `1-3,7`. */
  pages: "selected" | "all" | string;
  zip?: boolean;
}

/** The save options for a choice in the download dialog. */
export function saveOptionsFor(choice: SaveChoice, scrub = false): SaveOptions {
  const base: SaveOptions = choice === "optimise" ? { mode: "optimise" } : choice === "flatten" ? { flatten: true } : choice === "forms" ? { flatten: "forms" } : { mode: "auto" };
  if (scrub) return { ...base, scrub: true, mode: base.mode === "auto" || base.mode === undefined ? "rewrite" : base.mode };
  return base;
}

const messageOf = plainMessage;

/** The sessions that were already told, once, that a file with edited text and pictures is written as a new file. */
const toldAboutEdits = new WeakSet<PdfSession>();
export const EDITS_NOTE = "Edited text and pictures are written as a new file: the old text and pictures are cut out of the pages, and digital signatures in the file stop being valid.";
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

export class FileActions extends Store {
  hooks: FileHooks = {};
  readOnly = false;
  dialog: FileDialog | null = null;
  /** Something slow is running (a message), or null. */
  busy: string | null = null;
  /** Page pictures being made. */
  progress: { done: number; total: number } | null = null;
  private abort: AbortController | null = null;

  constructor(
    readonly session: PdfSession,
    readonly renderer: PdfRenderer,
    readonly notices: Notices,
    /** The pages selected in the viewer (ids), for the export dialog. */
    readonly selectedPages: () => string[],
  ) {
    super();
  }

  get name(): string {
    return documentName(this.session.doc);
  }

  get originalSize(): number {
    return this.session.doc.sources.find((s) => s.id === MAIN_SOURCE)?.size ?? 0;
  }

  /** Whether text or picture changes (made with the Edit tool) are waiting for the save. Such a file is always written as a new file. */
  hasEdits(): boolean {
    return this.session.doc.pages.some((p) => p.edits?.some((e) => e.type === "text" || e.type === "image"));
  }

  get canSave(): boolean {
    return !!this.session.saver;
  }

  private setBusy(message: string | null): void {
    this.busy = message;
    this.emit();
  }

  openDialog(d: FileDialog | null): void {
    this.dialog = d;
    this.emit();
  }

  closeDialog(): void {
    if (this.dialog?.type === "export") this.abort?.abort();
    this.openDialog(null);
  }

  private send(bytes: Uint8Array, name: string, mime: string): void | Promise<void> {
    return (this.hooks.download ?? downloadBytes)(bytes, name, mime);
  }

  // ---- save and download -------------------------------------------------------------------------------------------

  /** Saves with `onSave`. The document is marked saved only when the host's promise resolves. Returns whether it was saved. */
  async save(): Promise<boolean> {
    const onSave = this.hooks.onSave;
    if (!onSave || this.readOnly) return false;
    this.setBusy("Saving…");
    try {
      const result = await saveDetailed(this.session);
      await onSave(result.bytes, result);
      this.session.markSaved();
      setSelection(this.session, {});
      if (result.warnings.length > 0) this.showResult("Saved with warnings", this.name, result);
      else if (this.hasEdits() && !toldAboutEdits.has(this.session)) {
        toldAboutEdits.add(this.session);
        this.notices.show(`Saved ${this.name}. ${EDITS_NOTE}`, { ms: 12000 });
      } else this.notices.show(`Saved ${this.name}`, { ms: 3000 });
      return true;
    } catch (e) {
      this.notices.error(`Could not save. ${messageOf(e)}`);
      return false;
    } finally {
      this.setBusy(null);
    }
  }

  private showResult(title: string, name: string, result: SaveResult): void {
    this.openDialog({ type: "result", title, name, size: result.bytes.length, original: this.originalSize, mode: result.mode, warnings: result.warnings });
  }

  /** Writes the document with the chosen options and downloads it. The document is NOT marked saved: this is a copy. */
  async download(choice: SaveChoice = "keep", options: { scrub?: boolean; name?: string; dialog?: boolean } = {}): Promise<boolean> {
    this.setBusy("Preparing the file…");
    try {
      const result = await saveDetailed(this.session, saveOptionsFor(choice, options.scrub));
      const name = options.name ?? `${safeName(fileStem(this.name))}.pdf`;
      await this.send(result.bytes, name, "application/pdf");
      if (options.dialog === false && result.warnings.length === 0) this.notices.show(`Downloaded ${name}`, { ms: 3000 });
      else this.showResult(result.warnings.length ? "Downloaded with warnings" : "Downloaded", name, result);
      return true;
    } catch (e) {
      this.notices.error(`Could not download. ${messageOf(e)}`);
      return false;
    } finally {
      this.setBusy(null);
    }
  }

  /** The values of the form fields as a JSON file (what Import data reads back). Says so when there is no form. */
  async exportFormData(): Promise<boolean> {
    if (this.session.doc.fields.length === 0) {
      this.notices.error("This document has no form fields.");
      return false;
    }
    const name = `${safeName(fileStem(this.name))}-data.json`;
    try {
      await this.send(new TextEncoder().encode(JSON.stringify(this.session.forms.exportData(), null, 2) + "\n"), name, "application/json");
      this.notices.show(`Saved the form data as ${name}`, { ms: 4000 });
      return true;
    } catch (e) {
      this.notices.error(`Could not save the form data. ${messageOf(e)}`);
      return false;
    }
  }

  /** A quick copy: the document as it is, downloaded with "-copy" in the name. */
  saveCopy(): Promise<boolean> {
    return this.download("keep", { name: `${safeName(fileStem(this.name))}-copy.pdf`, dialog: false });
  }

  /** What a download or save would warn about (fonts not found, text edits that do not fit), found before writing the file. */
  preflight(): Promise<string[]> {
    return preflight(this.session).catch(() => []);
  }

  // ---- print --------------------------------------------------------------------------------------------------------

  /** Prints the document as it would be saved (annotations in), through a hidden frame. */
  async print(): Promise<boolean> {
    if (this.hooks.onPrint) {
      try {
        await this.hooks.onPrint();
        return true;
      } catch (e) {
        this.notices.error(`Could not print. ${messageOf(e)}`);
        return false;
      }
    }
    this.setBusy("Preparing to print…");
    try {
      const bytes = await saveBytes(this.session);
      printBytes(bytes);
      return true;
    } catch (e) {
      this.notices.error(e instanceof PliError && e.code === "unsupported" ? "Printing is not available here. Download the file and print it." : `Could not print. ${messageOf(e)}`);
      return false;
    } finally {
      this.setBusy(null);
    }
  }

  // ---- pages as pictures -------------------------------------------------------------------------------------------

  /** The 0-based positions an export request asks for. */
  exportPositions(request: ExportRequest["pages"]): number[] {
    const list = this.session.doc.pages;
    if (request === "all") return list.map((_, i) => i);
    if (request === "selected") {
      const want = new Set(this.selectedPages());
      return list.flatMap((p, i) => (want.has(p.id) ? [i] : []));
    }
    const out = new Set<number>();
    for (const token of request.split(",").map((t) => t.trim()).filter(Boolean)) {
      const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(token);
      if (!m || (m[1] === "" && m[3] === "")) throw new PliError("invalid_operation", `Cannot read the page range "${token}".`);
      const a = m[1] === "" ? 1 : Number(m[1]);
      const b = m[2] === "" ? a : m[3] === "" ? list.length : Number(m[3]);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
        if (n < 1 || n > list.length) throw new PliError("out_of_range", `The document has no page ${n}.`);
        out.add(n - 1);
      }
    }
    return [...out].sort((x, y) => x - y);
  }

  /** Draws the pages from the SAVED file (so annotations show) and downloads them as pictures. */
  async exportImages(request: ExportRequest): Promise<boolean> {
    let positions: number[];
    try {
      positions = this.exportPositions(request.pages);
    } catch (e) {
      this.notices.error(messageOf(e));
      return false;
    }
    if (positions.length === 0) {
      this.notices.error("Choose at least one page.");
      return false;
    }
    this.abort = new AbortController();
    this.progress = { done: 0, total: positions.length };
    this.emit();
    try {
      const bytes = await saveBytes(this.session);
      const images = await exportPageImages({
        renderer: this.renderer,
        bytes,
        password: this.session.options.password,
        pages: positions,
        format: request.format,
        dpi: request.dpi,
        signal: this.abort.signal,
        onProgress: (done, total) => {
          this.progress = { done, total };
          this.emit();
        },
      });
      const stem = safeName(fileStem(this.name));
      const width = String(this.session.doc.pages.length).length;
      const ext = request.format === "jpeg" ? "jpg" : "png";
      const files: NamedFile[] = images.map((img) => ({ name: `${stem}-page-${String(img.index + 1).padStart(width, "0")}.${ext}`, data: img.data }));
      if (files.length > 1 && request.zip !== false) {
        await this.send(makeZip(files), `${stem}-pages.zip`, "application/zip");
      } else {
        for (const f of files) {
          await this.send(f.data, f.name, IMAGE_MIME[request.format]);
          if (files.length > 1) await new Promise((r) => setTimeout(r, 120));
        }
      }
      this.notices.show(`Saved ${files.length === 1 ? "1 picture" : `${files.length} pictures`} of page${positions.length === 1 ? "" : "s"} ${rangeText(positions)}`, { ms: 5000 });
      this.openDialog(null);
      return true;
    } catch (e) {
      if (isAbort(e)) this.notices.announce("Cancelled");
      else this.notices.error(`Could not make the pictures. ${messageOf(e)}`);
      return false;
    } finally {
      this.progress = null;
      this.abort = null;
      this.emit();
    }
  }

  cancelExport(): void {
    this.abort?.abort();
  }

  // ---- open, create, rename ----------------------------------------------------------------------------------------

  get canOpen(): boolean {
    return !!this.hooks.onOpen;
  }

  /** Runs `then` now, or after the person agrees to drop the unsaved changes. */
  private guarded(then: () => void | Promise<void>): void | Promise<void> {
    if (this.session.dirty) return this.openDialog({ type: "discard", then });
    return then();
  }

  /** Chooses a PDF with the file chooser and hands it to the host (`onOpen`). */
  async chooseAndOpen(): Promise<void> {
    if (!this.hooks.onOpen) return;
    const [file] = await pickFiles({ accept: "application/pdf,.pdf" });
    if (file) await this.openFile(file);
  }

  async openFile(file: Pick<File, "name" | "arrayBuffer">): Promise<void> {
    const onOpen = this.hooks.onOpen;
    if (!onOpen) return;
    const data = new Uint8Array(await file.arrayBuffer());
    if (sniffFile(data) !== "pdf") {
      this.notices.error(`${file.name} is not a PDF file.`);
      return;
    }
    await this.guarded(async () => {
      try {
        await onOpen(data, file.name);
      } catch (e) {
        this.notices.error(`Could not open ${file.name}. ${messageOf(e)}`);
      }
    });
  }

  /** Chooses pictures and makes a new PDF with a page for each, handed to the host (`onOpen`). */
  async chooseAndCreate(): Promise<void> {
    if (!this.hooks.onOpen) return;
    const files = await pickFiles({ accept: "image/png,image/jpeg,.png,.jpg,.jpeg", multiple: true });
    if (files.length) await this.createFromImages(files);
  }

  async createFromImages(files: readonly Pick<File, "name" | "type" | "arrayBuffer">[]): Promise<void> {
    const onOpen = this.hooks.onOpen;
    if (!onOpen || files.length === 0) return;
    this.setBusy("Making the PDF…");
    let bytes: Uint8Array;
    try {
      const images = await Promise.all(files.map(async (f) => ({ data: new Uint8Array(await f.arrayBuffer()), mime: f.type || undefined })));
      bytes = await pdfFromImages(images);
    } catch (e) {
      this.notices.error(`Could not make a PDF from the pictures. ${messageOf(e)}`);
      return;
    } finally {
      this.setBusy(null);
    }
    const name = `${safeName(fileStem(files[0]!.name), "pictures")}.pdf`;
    await this.guarded(async () => {
      try {
        await onOpen(bytes, name);
      } catch (e) {
        this.notices.error(`Could not open the new PDF. ${messageOf(e)}`);
      }
    });
  }

  /** Renames the document (the name used for downloads and shown in the title). */
  rename(name: string): void {
    const next = name.trim();
    if (!next || this.readOnly || next === this.name) return;
    this.session.transact([{ type: "set_meta", patch: { name: next } }]);
    setSelection(this.session, {});
    this.notices.announce(`Renamed to ${next}`);
  }

  dispose(): void {
    this.abort?.abort();
  }
}

/**
 * Prints PDF bytes through a hidden frame. Needs a browser with `URL.createObjectURL`; a PliError `unsupported` says when
 * it has none. The frame is removed after printing (or after a minute).
 */
export function printBytes(bytes: Uint8Array): HTMLIFrameElement {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof document === "undefined") throw new PliError("unsupported", "Printing is not available here.");
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.title = "Print";
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0", pointerEvents: "none" });
  let cleaned = false;
  const clean = () => {
    if (cleaned) return;
    cleaned = true;
    frame.remove();
    URL.revokeObjectURL?.(url);
  };
  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    if (!win) return clean();
    win.addEventListener?.("afterprint", () => setTimeout(clean, 500), { once: true });
    try {
      win.focus();
      win.print();
    } catch {
      clean();
    }
  });
  frame.src = url;
  document.body.append(frame);
  setTimeout(clean, 120_000);
  return frame;
}
