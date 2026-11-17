import type { FontRegistry } from "@pli.dev/core";
import type { PageEdit, PdfPicture, PdfSession } from "@pli.dev/pdf";
import { editorFrame, hitContent, pageContent, type EditImage, type EditRun, type PageContent } from "./editGeometry";
import type { PdfViewContext } from "./extensions";
import { fileToPicture } from "./signatures";
import { withFonts } from "./saving";
import { Store } from "./store";

/**
 * The state behind the Edit tool: which text and pictures of each page can be changed, what is under the pointer, what is
 * selected, the text being typed, and the list of changes waiting to be saved. Every change goes through
 * `session.content` (`replaceText`, `replaceImage`, `removeEdit`), so each is one undo step and every collaborator sees it.
 */

/** The id of the tool in the viewer's tool registry. */
export const EDIT_TOOL = "edit-content";
/** The key that chooses the tool. */
export const EDIT_KEY = "Q";

/** What the person chose for new text; anything left out stays as the page has it. */
export interface EditStyle {
  family?: string;
  /** Points. */
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fit?: "none" | "shrink";
}

export interface EditTarget {
  page: string;
  kind: "run" | "image";
  id: string;
}

/** The text being typed. */
export interface Editing {
  page: string;
  run: EditRun;
  text: string;
  /** Only what was chosen: unset fields follow the page's font. */
  style: EditStyle;
}

/** One change waiting for the save, as the Edits tab lists it. */
export interface PendingEdit {
  id: string;
  page: string;
  /** 1-based. */
  pageNumber: number;
  kind: "text" | "image";
  /** What happens, in a short line. */
  label: string;
  /** What the engine would say about it at save time. */
  warnings: string[];
  edit: Extract<PageEdit, { type: "text" | "image" }>;
}

export interface ContentEditOptions {
  /** The fonts the picker offers. `false`: a plain list of the standard fonts. */
  fonts?: FontRegistry | false;
  /** No editing. */
  readOnly?: boolean;
}

export type Load = { state: "loading" } | { state: "ready"; content: PageContent } | { state: "error"; message: string };

const EMPTY: PageContent = { runs: [], images: [] };
const same = (a: EditTarget | null, b: EditTarget | null): boolean => a === b || (!!a && !!b && a.page === b.page && a.kind === b.kind && a.id === b.id);
const clip = (s: string, n = 40): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The style a text edit carries, without the parts that were not chosen. */
export function styleOfEdit(e: Extract<PageEdit, { type: "text" }> | undefined): EditStyle {
  if (!e) return {};
  const out: EditStyle = {};
  if (e.family !== undefined) out.family = e.family;
  if (e.size !== undefined) out.size = e.size;
  if (e.color !== undefined) out.color = e.color;
  if (e.bold !== undefined) out.bold = e.bold;
  if (e.italic !== undefined) out.italic = e.italic;
  if (e.fit !== undefined) out.fit = e.fit;
  return out;
}

const sameStyle = (a: EditStyle, b: EditStyle): boolean => JSON.stringify([a.family, a.size, a.color, a.bold, a.italic, a.fit]) === JSON.stringify([b.family, b.size, b.color, b.bold, b.italic, b.fit]);

export class EditController extends Store {
  readonly session: PdfSession;
  readonly options: ContentEditOptions;
  view: PdfViewContext | null = null;
  toolId: string | null = null;
  hover: EditTarget | null = null;
  selected: EditTarget | null = null;
  editing: Editing | null = null;
  /** How a new picture is fitted into the old one's box. */
  fit: "contain" | "stretch" = "contain";
  /** What the last message was, for screen readers. */
  live = "";
  /** What the engine says about the text being typed (font substituted, too wide). */
  editingWarnings: string[] = [];

  #pages = new Map<string, { key: string; load: Load; promise: Promise<void> }>();
  #plans = new Map<string, { key: string; warnings: string[] }>();
  #planning = new Set<string>();
  #typing: ReturnType<typeof setTimeout> | undefined;
  #typingKey = 0;
  #tick = 0;

  constructor(session: PdfSession, options: ContentEditOptions = {}) {
    super();
    this.session = session;
    this.options = options;
  }

  refresh(): void {
    this.emit();
  }

  get readOnly(): boolean {
    return !!this.options.readOnly || (this.view?.readOnly ?? false);
  }

  get active(): boolean {
    return this.toolId === EDIT_TOOL;
  }

  setView(view: PdfViewContext): void {
    this.view = view;
  }

  announce(message: string): void {
    this.live = message + (this.#tick++ % 2 ? "​" : "");
    this.emit();
  }

  /** Redraws when the document changes and works out what a save would say about the staged edits. Returns how to stop. */
  connect(): () => void {
    this.#refreshPlans();
    const off = this.session.subscribe(() => {
      this.#refreshPlans();
      this.emit();
    });
    return () => {
      off();
      clearTimeout(this.#typing);
    };
  }

  /** The tool the viewer reports as active. Leaving the tool finishes what was being typed. */
  setToolId(id: string | null): void {
    if (id === this.toolId) return;
    const was = this.toolId;
    this.toolId = id;
    if (was === EDIT_TOOL && id !== EDIT_TOOL) {
      void this.commit();
      this.hover = null;
    }
    this.emit();
  }

  /** Chooses the tool (or puts it down) through the viewer, so the toolbar follows. */
  setTool(on: boolean): void {
    const id = on ? EDIT_TOOL : null;
    if (this.view) this.view.setTool(id);
    else this.setToolId(id);
  }

  // ---- what is on the pages -------------------------------------------------------------------------------------------

  /** The runs and pictures of a page, read when first asked for and kept. */
  load(pageId: string): Load {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    if (!page) return { state: "error", message: "The page is not in the document." };
    const key = `${page.id}|${JSON.stringify(page.from ?? null)}`;
    const have = this.#pages.get(pageId);
    if (have && have.key === key) return have.load;
    if (!page.from) {
      const load: Load = { state: "ready", content: EMPTY };
      this.#pages.set(pageId, { key, load, promise: Promise.resolve() });
      return load;
    }
    const entry = { key, load: { state: "loading" } as Load, promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        const c = this.session.content;
        const [text, editable] = await Promise.all([c.text(pageId), c.editableRuns(pageId)]);
        entry.load = { state: "ready", content: pageContent(text.runs, editable, text.images) };
      } catch (e) {
        entry.load = { state: "error", message: e instanceof Error ? e.message : String(e) };
      }
      if (this.#pages.get(pageId) === entry) this.emit();
    })();
    this.#pages.set(pageId, entry);
    return entry.load;
  }

  /** Waits until a page's content is read. */
  async ready(pageId: string): Promise<PageContent> {
    this.load(pageId);
    await this.#pages.get(pageId)?.promise;
    const l = this.load(pageId);
    return l.state === "ready" ? l.content : EMPTY;
  }

  content(pageId: string): PageContent {
    const l = this.load(pageId);
    return l.state === "ready" ? l.content : EMPTY;
  }

  run(pageId: string, id: string): EditRun | undefined {
    return this.content(pageId).runs.find((r) => r.id === id);
  }

  image(pageId: string, id: string): EditImage | undefined {
    return this.content(pageId).images.find((i) => i.id === id);
  }

  /** The text change waiting for a run, if any. */
  textEdit(pageId: string, runId: string): Extract<PageEdit, { type: "text" }> | undefined {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    return page?.edits?.find((e): e is Extract<PageEdit, { type: "text" }> => e.type === "text" && e.run === runId);
  }

  imageEdit(pageId: string, imageId: string): Extract<PageEdit, { type: "image" }> | undefined {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    return page?.edits?.find((e): e is Extract<PageEdit, { type: "image" }> => e.type === "image" && e.target === imageId);
  }

  // ---- the pointer ------------------------------------------------------------------------------------------------------

  /** Finds what is under a point and remembers it for the hover box. Does not redraw when nothing changed. */
  hoverAt(pageId: string, x: number, y: number, scale = 1): void {
    const content = this.content(pageId);
    const hit = hitContent(content, x, y, Math.max(1, 3 / scale));
    const next: EditTarget | null = hit ? { page: pageId, kind: hit.kind, id: hit.kind === "run" ? hit.run.id : hit.image.id } : null;
    if (same(next, this.hover)) return;
    this.hover = next;
    this.emit();
  }

  /** Marks what is under the pointer, or has the keyboard focus, for the hover box. */
  point(target: EditTarget | null): void {
    if (same(target, this.hover)) return;
    this.hover = target;
    this.emit();
  }

  /** Selects a picture (from the keyboard; a click does it through `pick`). */
  selectImage(pageId: string, imageId: string): void {
    this.selected = this.hover = { page: pageId, kind: "image", id: imageId };
    this.emit();
  }

  /** Selects text that cannot be edited, so the panel and the tip say why. */
  selectRun(pageId: string, run: EditRun): void {
    this.selected = this.hover = { page: pageId, kind: "run", id: run.id };
    if (!run.editable) this.announce(run.reason ?? "This text cannot be edited.");
    else this.emit();
  }

  /** A click: finishes what was being typed, then picks what is at the point (text opens the editor). */
  async pick(pageId: string, x: number, y: number, scale = 1): Promise<void> {
    await this.commit();
    const content = await this.ready(pageId);
    const hit = hitContent(content, x, y, Math.max(1, 3 / scale));
    if (!hit) {
      this.selected = null;
      this.hover = null;
      this.emit();
      return;
    }
    if (hit.kind === "image") {
      this.selected = this.hover = { page: pageId, kind: "image", id: hit.image.id };
      this.emit();
      return;
    }
    // The pointer is where it clicked.
    this.selected = this.hover = { page: pageId, kind: "run", id: hit.run.id };
    if (!hit.run.editable) {
      this.announce(hit.run.reason ?? "This text cannot be edited.");
      return;
    }
    this.beginEdit(pageId, hit.run);
  }

  // ---- typing ------------------------------------------------------------------------------------------------------------

  /** Opens the in-place editor on a run, with the text and choices of the change waiting for it, if there is one. */
  beginEdit(pageId: string, run: EditRun): void {
    if (this.readOnly || !run.editable) return;
    const pending = this.textEdit(pageId, run.id);
    this.editing = { page: pageId, run, text: pending ? pending.text : run.text, style: styleOfEdit(pending) };
    this.selected = { page: pageId, kind: "run", id: run.id };
    this.editingWarnings = [];
    this.emit();
  }

  /** The text typed so far. One line: a line break becomes a space. */
  setText(text: string): void {
    const e = this.editing;
    if (!e) return;
    this.editing = { ...e, text: text.replace(/\r?\n/g, " ") };
    this.emit();
    this.#planTyping();
  }

  #planTyping(): void {
    clearTimeout(this.#typing);
    const key = ++this.#typingKey;
    this.#typing = setTimeout(async () => {
      const e = this.editing;
      if (!e) return;
      const warnings = await this.#warningsFor(e.page, e.run.id, e.text, e.style);
      if (key !== this.#typingKey || this.editing?.run.id !== e.run.id) return;
      this.editingWarnings = warnings;
      this.emit();
    }, 120);
  }

  async #warningsFor(page: string, runId: string, text: string, style: EditStyle): Promise<string[]> {
    try {
      const { options } = await withFonts(this.session);
      const plan = await this.session.content.planText(runId, text, { page, ...style }, options.fonts);
      return plan.warnings;
    } catch {
      return [];
    }
  }

  /** Changes how the new text looks: while typing, what the editor shows; otherwise the selected text (a change of its own). */
  async setStyle(patch: EditStyle): Promise<void> {
    const merge = (base: EditStyle): EditStyle => {
      const out: EditStyle = { ...base };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (out as Record<string, unknown>)[k];
        else (out as Record<string, unknown>)[k] = v;
      }
      return out;
    };
    const e = this.editing;
    if (e) {
      this.editing = { ...e, style: merge(e.style) };
      this.emit();
      this.#planTyping();
      return;
    }
    const sel = this.selected;
    if (this.readOnly || !sel || sel.kind !== "run") return;
    const run = this.run(sel.page, sel.id);
    if (!run || !run.editable) return;
    const pending = this.textEdit(sel.page, run.id);
    await this.#write(sel.page, run, pending ? pending.text : run.text, merge(styleOfEdit(pending)));
  }

  /** Finishes the typing: the text becomes a change waiting for the save (nothing, when it is as it was). */
  async commit(): Promise<void> {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    this.editingWarnings = [];
    clearTimeout(this.#typing);
    const pending = this.textEdit(e.page, e.run.id);
    const was = pending ? pending.text : e.run.text;
    const wasStyle = styleOfEdit(pending);
    if (e.text === was && sameStyle(e.style, wasStyle)) {
      this.emit();
      return;
    }
    await this.#write(e.page, e.run, e.text, e.style);
  }

  /** Gives up what was typed. */
  cancel(): void {
    if (!this.editing) return;
    this.editing = null;
    this.editingWarnings = [];
    clearTimeout(this.#typing);
    this.emit();
  }

  async #write(pageId: string, run: EditRun, text: string, style: EditStyle): Promise<void> {
    const pending = this.textEdit(pageId, run.id);
    try {
      if (text === run.text && Object.keys(style).length === 0) {
        // Back to what the page has: the change is taken away.
        if (pending) this.session.content.removeEdit(pending.id);
      } else {
        await this.session.content.replaceText(run.id, text, { page: pageId, ...style });
      }
      this.announce(text === "" ? "The text will be removed" : `Text changed to ${clip(text, 60)}`);
    } catch (err) {
      this.announce(err instanceof Error ? err.message : String(err));
    }
  }

  // ---- pictures ------------------------------------------------------------------------------------------------------------

  /** Replaces the selected picture with a file (PNG or JPEG). */
  async replacePicture(file: { type: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<void> {
    const sel = this.selected;
    if (this.readOnly || !sel || sel.kind !== "image") return;
    try {
      const picture = await fileToPicture(file);
      await this.#setPicture(sel.page, sel.id, picture);
      this.announce("Picture will be replaced");
    } catch (e) {
      this.announce(e instanceof Error ? e.message : String(e));
    }
  }

  /** Takes the selected picture out. */
  async deletePicture(): Promise<void> {
    const sel = this.selected;
    if (this.readOnly || !sel || sel.kind !== "image") return;
    await this.#setPicture(sel.page, sel.id, null);
    this.announce("Picture will be removed");
  }

  async #setPicture(pageId: string, imageId: string, picture: PdfPicture | null): Promise<void> {
    await this.session.content.replaceImage(imageId, picture, { page: pageId, fit: this.imageEdit(pageId, imageId)?.fit ?? this.fit });
  }

  /** How the new picture sits in the old one's box. Changes the picture waiting for the selected one, and the next. */
  async setFit(fit: "contain" | "stretch"): Promise<void> {
    this.fit = fit;
    const sel = this.selected;
    if (!this.readOnly && sel?.kind === "image") {
      const e = this.imageEdit(sel.page, sel.id);
      if (e) await this.session.content.replaceImage(sel.id, e.picture, { page: sel.page, fit });
    }
    this.emit();
  }

  // ---- the list of changes ---------------------------------------------------------------------------------------------------

  /** The staged text and picture changes of the document, in page order. */
  pending(): PendingEdit[] {
    const out: PendingEdit[] = [];
    this.session.doc.pages.forEach((page, i) => {
      for (const e of page.edits ?? []) {
        if (e.type === "redact") continue;
        const warnings = e.type === "text" ? (this.#plans.get(e.id)?.warnings ?? []) : [];
        let label: string;
        if (e.type === "text") label = e.text === "" ? `Remove “${clip(e.oldText ?? this.run(page.id, e.run)?.text ?? "text")}”` : `“${clip(e.oldText ?? this.run(page.id, e.run)?.text ?? "text")}” to “${clip(e.text)}”`;
        else label = e.picture ? "Replace a picture" : "Remove a picture";
        out.push({ id: e.id, page: page.id, pageNumber: i + 1, kind: e.type, label, warnings, edit: e });
      }
    });
    return out;
  }

  /** Takes one change back. */
  remove(editId: string): void {
    if (this.readOnly) return;
    const e = this.editing;
    const target = this.pending().find((p) => p.id === editId);
    if (e && target?.edit.type === "text" && target.edit.run === e.run.id) this.cancel();
    this.session.content.removeEdit(editId);
    this.announce("Edit removed");
  }

  /** Takes every text and picture change back, in one undo step (applied redactions stay). */
  removeAll(): void {
    if (this.readOnly) return;
    this.cancel();
    const ops = this.session.doc.pages.filter((p) => p.edits?.some((e) => e.type !== "redact")).map((p) => ({ type: "set_edits" as const, page: p.id, edits: (p.edits ?? []).filter((e) => e.type === "redact") }));
    if (ops.length) this.session.transact(ops);
    this.announce("All edits removed");
  }

  /** Shows a change on the page: goes there and selects what it changes. */
  reveal(editId: string): void {
    for (const page of this.session.doc.pages) {
      const e = page.edits?.find((x) => x.id === editId);
      if (!e || e.type === "redact") continue;
      this.selected = e.type === "text" ? { page: page.id, kind: "run", id: e.run } : { page: page.id, kind: "image", id: e.target };
      this.emit();
      void this.ready(page.id).then((content) => {
        const box = e.type === "text" ? content.runs.find((r) => r.id === e.run)?.box : content.images.find((i) => i.id === e.target)?.box;
        this.view?.goToPage(page.id, box?.y);
        this.emit();
      });
      return;
    }
  }

  #refreshPlans(): void {
    const live = new Set<string>();
    this.session.doc.pages.forEach((page) => {
      for (const e of page.edits ?? []) {
        if (e.type !== "text") continue;
        live.add(e.id);
        const key = JSON.stringify([e.run, e.text, e.family, e.size, e.color, e.bold, e.italic, e.fit]);
        if (this.#plans.get(e.id)?.key === key || this.#planning.has(`${e.id}|${key}`)) continue;
        this.#planning.add(`${e.id}|${key}`);
        void this.#warningsFor(page.id, e.run, e.text, styleOfEdit(e)).then((warnings) => {
          this.#planning.delete(`${e.id}|${key}`);
          // The edit may have changed while the plan was being made.
          const now = this.session.doc.pages.flatMap((p) => p.edits ?? []).find((x) => x.id === e.id);
          if (!now || now.type !== "text" || JSON.stringify([now.run, now.text, now.family, now.size, now.color, now.bold, now.italic, now.fit]) !== key) return;
          this.#plans.set(e.id, { key, warnings });
          this.emit();
        });
      }
    });
    for (const id of [...this.#plans.keys()]) if (!live.has(id)) this.#plans.delete(id);
  }

  /** Waits until the warnings of the staged changes are worked out (for tests and for a save that must show them). */
  async settled(): Promise<void> {
    for (let i = 0; i < 50 && this.#planning.size > 0; i++) await new Promise((r) => setTimeout(r, 0));
  }

  // ---- looks ------------------------------------------------------------------------------------------------------------

  /** What the new text will look like for a run: the choices made, else the page's own font. */
  looks(run: EditRun, style: EditStyle): { family: string; size: number; color: string; bold: boolean; italic: boolean; fit: "none" | "shrink" } {
    return {
      family: style.family ?? run.font.family,
      size: style.size ?? run.font.size,
      color: style.color ?? run.color ?? "#000000",
      bold: style.bold ?? !!run.font.bold,
      italic: style.italic ?? !!run.font.italic,
      fit: style.fit ?? "none",
    };
  }

  /** The frame of the editor for the text now: see `editorFrame`. */
  frame(run: EditRun, style: EditStyle, width = 0) {
    return editorFrame(run, style.size ?? run.font.size, width);
  }
}
