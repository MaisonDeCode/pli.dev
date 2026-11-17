/**
 * The page tools: everything the thumbnails, the organise view and the page menus do to pages, in one place.
 *
 * `PageTools` is an observable controller (one per session). The components only call it: it checks what may be done
 * (read-only, the last page), runs the engine command (`session.pages.*`), tells the person what happened (a toast
 * with Undo, a message for screen readers) and holds the state of the dialogs. Headless tests can drive it directly.
 */
import { PliError } from "@pli.dev/core";
import { parseRanges, sniffImage, type Page, type PdfSession, type SplitSpec } from "@pli.dev/pdf";
import { documentName, downloadBytes, downloadFiles, fileStem, pickFiles, safeName, type NamedFile } from "./download";
import { getPageSelection, setPageSelection, setSelection } from "./hooks";
import { withFonts } from "./saving";
import { Notices, Store, plainMessage } from "./store";

export type NumberingStyle = Parameters<PdfSession["pages"]["numberPages"]>[1];

/** The dialogs the page tools open. */
export type PageDialog =
  | { type: "delete"; ids: string[]; items: number }
  | { type: "password"; fileName: string; error?: string }
  | { type: "extract" }
  | { type: "split" }
  | { type: "labels" }
  | { type: "move" };

/** What a host can plug in: where downloads go. */
export interface PageToolsOptions {
  /** Hands a file to the person (default: a browser download). */
  download?: (bytes: Uint8Array, name: string, mime: string) => void | Promise<void>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1-3, 5" for page positions (0-based in, 1-based out). */
export function rangeText(positions: readonly number[], sep = ", "): string {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j > i ? `${sorted[i]! + 1}-${sorted[j]! + 1}` : String(sorted[i]! + 1));
    i = j + 1;
  }
  return out.join(sep);
}

/** What `splitPlan` made of the pages: "1-3", "4-5" for each part. */
export function describePlan(doc: { pages: readonly { id: string }[] }, plan: readonly (readonly string[])[]): string[] {
  const at = new Map(doc.pages.map((p, i) => [p.id, i] as const));
  return plan.map((ids) => rangeText(ids.map((id) => at.get(id)!)));
}

/** The kind of file some bytes are: a PDF, a JPEG or PNG picture, or neither. */
export function sniffFile(data: Uint8Array, mime?: string): "pdf" | "image" | null {
  const head = new TextDecoder("latin1").decode(data.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  try {
    sniffImage(data, mime);
    return "image";
  } catch {
    return null;
  }
}

const isPasswordError = (e: unknown): e is PliError => e instanceof PliError && e.code === "unsupported" && /password/i.test(e.message);
const messageOf = plainMessage;

export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The controller behind the thumbnails, the organise view and the page menus. */
export class PageTools extends Store {
  readonly notices: Notices;
  /** Set on every render by the viewer. */
  readOnly = false;
  options: PageToolsOptions = {};
  dialog: PageDialog | null = null;
  /** The pages being dragged (null: not dragging). */
  drag: { ids: string[] } | null = null;
  /** The organise view is open. */
  organise = false;
  /** Something slow is running (a message), or null. */
  busy: string | null = null;
  private passwordAnswer: ((password: string | null) => void) | null = null;

  constructor(readonly session: PdfSession, notices: Notices = new Notices()) {
    super();
    this.notices = notices;
  }

  // ---- what is selected ---------------------------------------------------------------------------------------------

  get pages(): readonly Page[] {
    return this.session.doc.pages;
  }

  /** The page shown. */
  get currentId(): string | null {
    return this.session.selection.page;
  }

  /** The pages the tools work on: the selected pages, or the page shown when fewer than two are selected. */
  selected(): string[] {
    const raw = getPageSelection(this.session);
    if (raw.length > 1) return this.inOrder(raw);
    const cur = this.pages.find((p) => p.id === this.currentId) ?? this.pages[0];
    return cur ? [cur.id] : [];
  }

  /** The ids that are pages of the document, in document order. */
  inOrder(ids: readonly string[]): string[] {
    const want = new Set(ids);
    return this.pages.filter((p) => want.has(p.id)).map((p) => p.id);
  }

  positions(ids: readonly string[]): number[] {
    const want = new Set(ids);
    const out: number[] = [];
    this.pages.forEach((p, i) => want.has(p.id) && out.push(i));
    return out;
  }

  select(ids: readonly string[]): void {
    setPageSelection(this.session, ids);
  }

  selectAll(): void {
    this.select(this.pages.map((p) => p.id));
    this.notices.announce(`All ${plural(this.pages.length, "page")} selected`);
  }

  private target(ids?: readonly string[]): string[] {
    return ids ? this.inOrder(ids) : this.selected();
  }

  private editable(): boolean {
    if (this.readOnly) {
      this.notices.announce("This document is read-only.");
      return false;
    }
    return true;
  }

  private run<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      this.notices.error(messageOf(e));
      return undefined;
    }
  }

  // ---- pages ------------------------------------------------------------------------------------------------------

  rotate(degrees: 90 | -90 | 180, ids?: readonly string[]): void {
    const list = this.target(ids);
    if (list.length === 0 || !this.editable()) return;
    this.run(() => {
      this.session.pages.rotate(list, degrees);
      setSelection(this.session, {});
      this.notices.announce(`Turned ${plural(list.length, "page")} ${degrees === -90 ? "anticlockwise" : degrees === 180 ? "upside down" : "clockwise"}`);
    });
  }

  /** Deletes pages; asks first when there are several or they carry annotations or form fields. */
  requestRemove(ids?: readonly string[]): void {
    const list = this.target(ids);
    if (list.length === 0 || !this.editable()) return;
    if (list.length >= this.pages.length) {
      this.notices.error("A PDF needs at least one page, so the last pages cannot be deleted.");
      return;
    }
    const items = this.itemsOn(list);
    if (list.length > 1 || items > 0) {
      this.openDialog({ type: "delete", ids: list, items });
      return;
    }
    this.remove(list);
  }

  /** Annotations and form fields on pages (a deleted page takes them along). */
  itemsOn(ids: readonly string[]): number {
    const want = new Set(ids);
    let n = 0;
    for (const p of this.pages) if (want.has(p.id)) n += p.annots.length;
    for (const f of this.session.doc.fields) n += f.widgets.filter((w) => want.has(w.page)).length;
    return n;
  }

  remove(ids: readonly string[]): void {
    const list = this.inOrder(ids);
    if (list.length === 0 || !this.editable()) return;
    this.run(() => {
      this.session.pages.remove(list);
      setSelection(this.session, {});
      this.notices.show(`${plural(list.length, "page")} deleted`, { action: { label: "Undo", run: () => this.undo() } });
    });
  }

  duplicate(ids?: readonly string[]): void {
    const list = this.target(ids);
    if (list.length === 0 || !this.editable()) return;
    this.run(() => {
      const copies = this.session.pages.duplicate(list);
      setSelection(this.session, {});
      this.notices.announce(`Duplicated ${plural(list.length, "page")}; the copies are pages ${rangeText(this.positions(copies))}`);
    });
  }

  /** A blank page before the first or after the last of the pages, the size of its neighbour. */
  insertBlank(where: "before" | "after", ids?: readonly string[]): void {
    const list = this.target(ids);
    if (list.length === 0 || !this.editable()) return;
    this.run(() => {
      const first = this.pages.findIndex((p) => p.id === list[0]);
      const after = where === "after" ? list[list.length - 1]! : (this.pages[first - 1]?.id ?? null);
      const id = this.session.pages.insertBlank(after);
      setSelection(this.session, {});
      this.notices.announce(`Inserted a blank page as page ${this.pages.findIndex((p) => p.id === id) + 1}`);
    });
  }

  /** Where the first of `ids` ends up in the list without them, for a drop before position `pos` (0 to page count) of the full list. */
  restIndexFor(ids: readonly string[], pos: number): number {
    const moving = new Set(ids);
    let n = 0;
    for (let i = 0; i < Math.min(pos, this.pages.length); i++) if (!moving.has(this.pages[i]!.id)) n++;
    return n;
  }

  /** Moves pages so they come before position `pos` (0 to page count) of the list as it is now. */
  moveBefore(ids: readonly string[], pos: number): void {
    const list = this.inOrder(ids);
    if (list.length === 0 || !this.editable()) return;
    const index = this.restIndexFor(list, pos);
    // Dropping the pages where they already are changes nothing, so it is not a step to undo.
    const moving = new Set(list);
    const rest = this.pages.filter((p) => !moving.has(p.id));
    const result = [...rest.slice(0, index), ...this.pages.filter((p) => moving.has(p.id)), ...rest.slice(index)];
    if (result.every((p, i) => p.id === this.pages[i]!.id)) return;
    this.run(() => {
      this.session.pages.move(list, index);
      setSelection(this.session, {});
      this.notices.announce(`Moved ${plural(list.length, "page")} ${list.length === 1 ? "to position" : "to start at position"} ${this.pages.findIndex((p) => p.id === list[0]) + 1}`);
    });
  }

  /** Moves the pages one place up (-1) or down (1), or to the start or end. */
  moveBy(delta: -1 | 1 | "start" | "end", ids?: readonly string[]): void {
    const list = this.target(ids);
    if (list.length === 0 || !this.editable()) return;
    const moving = new Set(list);
    const firstAt = this.pages.findIndex((p) => moving.has(p.id));
    const restCount = this.pages.length - list.length;
    // The pages before the first moving page are all "rest", so the block starts at `firstAt` among the rest.
    const to = delta === "start" ? 0 : delta === "end" ? restCount : Math.max(0, Math.min(restCount, firstAt + delta));
    // Position in the full list that `moveBefore` wants: the page that ends up right after the block.
    const rest = this.pages.filter((p) => !moving.has(p.id));
    const pos = to >= rest.length ? this.pages.length : this.pages.findIndex((p) => p.id === rest[to]!.id);
    this.moveBefore(list, pos);
  }

  /** "Move to...": before page number `page` (1 to count + 1, the end). */
  moveToPage(ids: readonly string[], page: number): void {
    this.moveBefore(ids, Math.max(0, Math.min(this.pages.length, Math.round(page) - 1)));
  }

  // ---- pages from files ---------------------------------------------------------------------------------------------

  /** Chooses PDF and picture files with the browser's file chooser and inserts them before position `at`. */
  async chooseAndInsert(at: number): Promise<void> {
    if (!this.editable()) return;
    const files = await pickFiles({ accept: "application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg", multiple: true });
    if (files.length) await this.insertFiles(files, at);
  }

  /** Inserts the pages of PDF files, and a page for each JPEG or PNG picture, before position `at` (0 to page count). */
  async insertFiles(files: readonly Pick<File, "name" | "type" | "arrayBuffer">[], at: number): Promise<number> {
    if (files.length === 0 || !this.editable()) return 0;
    let position = Math.max(0, Math.min(at, this.pages.length));
    let total = 0;
    const problems: string[] = [];
    let images: { data: Uint8Array; mime?: string }[] = [];
    this.setBusy("Adding pages…");
    try {
      const flush = async () => {
        if (images.length === 0) return;
        const made = await this.session.pages.insertImages(images, { at: position });
        position += made.length;
        total += made.length;
        images = [];
      };
      for (const file of files) {
        try {
          const data = new Uint8Array(await file.arrayBuffer());
          const kind = sniffFile(data, file.type || undefined);
          if (kind === "image") {
            images.push({ data, mime: file.type || undefined });
            continue;
          }
          await flush();
          if (kind !== "pdf") {
            problems.push(`${file.name} is not a PDF, JPEG or PNG file.`);
            continue;
          }
          let password: string | undefined;
          for (;;) {
            try {
              const made = await this.session.pages.insertFrom(data, { at: position, name: file.name, password });
              position += made.length;
              total += made.length;
              break;
            } catch (e) {
              if (!isPasswordError(e)) throw e;
              const answer = await this.askPassword(file.name, password === undefined ? undefined : "That password did not work.");
              if (answer === null) {
                problems.push(`${file.name} needs a password and was skipped.`);
                break;
              }
              password = answer;
            }
          }
        } catch (e) {
          problems.push(`${file.name}: ${messageOf(e)}`);
        }
      }
      await flush();
    } finally {
      this.setBusy(null);
    }
    setSelection(this.session, {});
    if (total > 0) this.notices.show(`Added ${plural(total, "page")}${problems.length ? `. ${problems[0]}` : ""}`, { action: { label: "Undo", run: () => this.undo() } });
    else if (problems.length) this.notices.error(problems.join(" "));
    return total;
  }

  private setBusy(message: string | null): void {
    this.busy = message;
    this.emit();
  }

  private askPassword(fileName: string, error?: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.passwordAnswer = resolve;
      this.openDialog({ type: "password", fileName, error });
    });
  }

  /** The answer to the password dialog (null: skip the file). */
  answerPassword(password: string | null): void {
    const answer = this.passwordAnswer;
    this.passwordAnswer = null;
    this.closeDialog();
    answer?.(password);
  }

  // ---- extract, split, labels -------------------------------------------------------------------------------------

  private get download() {
    return this.options.download ?? downloadBytes;
  }

  /** Makes a new PDF of the pages and hands it over. With `remove` the pages also leave this document. */
  async extract(ids: readonly string[], options: { remove?: boolean } = {}): Promise<boolean> {
    const list = this.inOrder(ids);
    if (list.length === 0) return false;
    if (options.remove && !this.editable()) return false;
    this.setBusy("Extracting pages…");
    try {
      const prepared = await withFonts(this.session);
      const bytes = await this.session.pages.extract(list, prepared.options);
      const name = `${safeName(fileStem(documentName(this.session.doc)))}-pages-${rangeText(this.positions(list), "_")}.pdf`;
      await this.download(bytes, name, "application/pdf");
      this.notices.announce(`Extracted ${plural(list.length, "page")} to ${name}`);
      if (options.remove && list.length < this.pages.length) this.remove(list);
      return true;
    } catch (e) {
      this.notices.error(`Could not extract the pages. ${messageOf(e)}`);
      return false;
    } finally {
      this.setBusy(null);
    }
  }

  /** The parts a split would make, as page ranges; throws a `PliError` with a plain message when the spec is wrong. */
  planSplit(spec: SplitSpec): string[] {
    return describePlan(this.session.doc, this.session.pages.splitPlan(spec));
  }

  /** Cuts the document into files and downloads them (as one ZIP unless `zip` is false). */
  async split(spec: SplitSpec, options: { zip?: boolean } = {}): Promise<boolean> {
    this.setBusy("Splitting…");
    try {
      const prepared = await withFonts(this.session);
      const parts = await this.session.pages.split(spec, prepared.options);
      const stem = safeName(fileStem(documentName(this.session.doc)));
      const width = String(parts.length).length;
      const files: NamedFile[] = parts.map((data, i) => ({ name: `${stem}-part-${String(i + 1).padStart(width, "0")}.pdf`, data }));
      await downloadFiles(files, { zip: options.zip, zipName: `${stem}-split.zip`, download: this.download });
      this.notices.announce(`Split into ${plural(files.length, "file")}`);
      return true;
    } catch (e) {
      this.notices.error(`Could not split the document. ${messageOf(e)}`);
      return false;
    } finally {
      this.setBusy(null);
    }
  }

  /** Numbers pages (or clears or sets their labels). */
  applyLabels(ids: readonly string[], how: { style: NumberingStyle | "none" | "custom"; start?: number; prefix?: string; text?: string }): void {
    const list = this.inOrder(ids);
    if (list.length === 0 || !this.editable()) return;
    this.run(() => {
      if (how.style === "none") this.session.pages.setLabel(list, null);
      else if (how.style === "custom") this.session.pages.setLabel(list, how.text ?? "");
      else this.session.pages.numberPages(list, how.style, { start: how.start, prefix: how.prefix });
      setSelection(this.session, {});
      this.notices.announce(how.style === "none" ? `Removed the labels of ${plural(list.length, "page")}` : `Labelled ${plural(list.length, "page")}`);
    });
  }

  // ---- undo, dialogs, organise ---------------------------------------------------------------------------------------

  undo(): void {
    if (this.session.undo()) {
      setSelection(this.session, {});
      this.notices.announce("Undone");
    }
  }

  redo(): void {
    if (this.session.redo()) {
      setSelection(this.session, {});
      this.notices.announce("Redone");
    }
  }

  openDialog(dialog: PageDialog | null): void {
    this.dialog = dialog;
    this.emit();
  }

  closeDialog(): void {
    if (this.dialog?.type === "password") {
      const answer = this.passwordAnswer;
      this.passwordAnswer = null;
      answer?.(null);
    }
    this.openDialog(null);
  }

  setOrganise(open: boolean): void {
    if (this.organise === open) return;
    this.organise = open;
    this.emit();
    this.notices.announce(open ? "Organise pages" : "Back to the document");
  }

  startDrag(ids: readonly string[]): void {
    this.drag = { ids: this.inOrder(ids) };
  }

  endDrag(): void {
    this.drag = null;
  }

  dispose(): void {
    this.passwordAnswer?.(null);
    this.passwordAnswer = null;
    this.notices.dispose();
  }

  // ---- keys -------------------------------------------------------------------------------------------------------

  /**
   * Keys that work on the pages while the focus is in a page list (thumbnails, organise view). `cols` is how many pages are in a row
   * (1 for the sidebar). Returns true when the key was used.
   */
  handleListKey(e: KeyInfo, cols = 1): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.altKey && !mod) {
      const step = e.key === "ArrowUp" ? -cols : e.key === "ArrowDown" ? cols : e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (step !== 0) {
        for (let i = 0; i < Math.abs(step); i++) this.moveBy(step < 0 ? -1 : 1);
        return true;
      }
      if (e.key === "Home") return (this.moveBy("start"), true);
      if (e.key === "End") return (this.moveBy("end"), true);
      return false;
    }
    if (mod) {
      if (k === "d" && !e.shiftKey) return (this.duplicate(), true);
      return false;
    }
    if (this.readOnly) return false;
    if (e.key === "Delete" || e.key === "Backspace") return (this.requestRemove(), true);
    if (k === "r") return (this.rotate(e.shiftKey ? -90 : 90), true);
    if (e.key === "Insert") return (this.insertBlank("after"), true);
    return false;
  }

  /** Keys that work anywhere in the viewer (not in a text field). Returns true when the key was used. */
  handleGlobalKey(e: KeyInfo): boolean {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey || this.readOnly) return false;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === "r") return (this.rotate(90), true);
    if (e.shiftKey && k === "l") return (this.rotate(-90), true);
    if (e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) return (this.requestRemove(), true);
    if (k === "z") return (e.shiftKey ? this.redo() : this.undo(), true);
    if (k === "y") return (this.redo(), true);
    return false;
  }
}
