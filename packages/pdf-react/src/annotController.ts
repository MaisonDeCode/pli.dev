import { createId, userColor, Users, type CommentClient, type FontRegistry, type Peer, type StorageClient } from "@pli.dev/core";
import { findAnnot, type Annotation, type FreeTextAnnot, type NoteAnnot, type PdfAnchor, type PdfOp, type PdfPicture, type PdfSession, type Pt, type Rect, type StampAnnot, type TextStyle } from "@pli.dev/pdf";
import { ALIGN_LABEL, DISTRIBUTE_LABEL, alignMoves, distributeMoves, type Align, type Distribute, type Move } from "./align";
import { annotBounds, boundsOfAll, canMove, centredRect, clampRect, fitInside, moveBy, round2, selectionBox } from "./annotGeometry";
import { cloneStyles, loadStyles, saveStyles, styleKeyOf, type StyleKey, type Styles, type ToolStyle } from "./annotStyles";
import { withText } from "./annotProps";
import { textHeight } from "./annotSvg";
import { setSelection } from "./hooks";
import type { PdfViewContext } from "./extensions";
import { selectionRects, type SelectedText } from "./geometry";
import { fileToPicture, imageSizeOf, dataUriBytes, loadSignatures, type SignatureValue } from "./signatures";
import { STANDARD_STAMPS, stampSize, type StampDef } from "./stamps";

export type ToolId =
  | "select"
  | "highlight"
  | "underline"
  | "strikeout"
  | "squiggly"
  | "ink"
  | "eraser"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polyline"
  | "polygon"
  | "text"
  | "note"
  | "stamp"
  | "signature"
  | "image"
  | "link"
  | "redact";

/** What the next click on a page puts down: a stamp, a signature or a picture chosen from a menu. */
export type Placing =
  | { kind: "stamp"; stamp: StampAnnot["stamp"]; w: number; h: number }
  | { kind: "signature"; value: SignatureValue; ratio: number; w: number }
  | { kind: "image"; picture: PdfPicture; w: number; h: number };

/** Something being drawn or dragged right now, shown by the layer and turned into an annotation when the pointer lets go. */
export type Draft =
  | { type: "ink"; page: string; points: Pt[]; style: ToolStyle }
  | { type: "box"; kind: "rectangle" | "ellipse" | "line" | "arrow" | "redact" | "link" | "text" | "placing"; page: string; from: Pt; to: Pt; style: ToolStyle }
  | { type: "poly"; page: string; closed: boolean; points: Pt[]; hover: Pt | null; style: ToolStyle }
  | { type: "marquee"; page: string; rect: Rect }
  | { type: "note"; page: string; x: number; y: number; style: ToolStyle };

/** A floating panel next to something on a page. */
export type Popover =
  | { kind: "comment"; annot: string }
  | { kind: "new-note"; page: string; x: number; y: number }
  | { kind: "link"; annot?: string; page: string; rect: Rect };

export type DialogKind = "signature" | "initials" | "stamp-text" | "apply-redactions" | null;

export interface Editing {
  page: string;
  /** The text box being typed in. `isNew` boxes are not in the document until they have text. */
  annot: FreeTextAnnot;
  isNew: boolean;
}

export interface TextSelectionState {
  selected: SelectedText[];
  /** Where to show the mini toolbar: a rectangle on the screen (CSS pixels). */
  at: { x: number; y: number; w: number; h: number };
}

export interface PresenceInfo {
  user: { id: string; name: string; color?: string };
  page?: string | null;
  annots?: readonly string[];
  tool?: string | null;
  /** Where their pointer is, in page space, when it is over a page. */
  cursor?: { page: string; x: number; y: number } | null;
}

/**
 * The people in a room as `presence` for the annotation layer: what `CollabRoom` peers hold in `state` is
 * `{ page, selection: string[], tool, cursor }` (what `onPresence` reports and `pdfSyncModel.mapPresence` keeps valid). Everyone gets
 * a colour: their own, or one chosen from their id (the one the "who is here" stack uses).
 */
export function presenceFromPeers(peers: readonly Peer[], you?: string): PresenceInfo[] {
  return peers
    .filter((p) => p.user.id !== you)
    .map((p) => {
      const s = p.state as { page?: unknown; selection?: unknown; tool?: unknown; cursor?: unknown };
      const c = s.cursor as { page?: unknown; x?: unknown; y?: unknown } | null | undefined;
      const cursor = c && typeof c.page === "string" && typeof c.x === "number" && typeof c.y === "number" && Number.isFinite(c.x) && Number.isFinite(c.y) ? { page: c.page, x: c.x, y: c.y } : null;
      return {
        user: { id: p.user.id, name: p.user.name, color: p.user.color ?? userColor(p.user.id) },
        cursor,
        page: typeof s.page === "string" ? s.page : null,
        annots: Array.isArray(s.selection) ? s.selection.filter((x): x is string => typeof x === "string") : [],
        tool: typeof s.tool === "string" ? s.tool : null,
      };
    });
}

export interface AnnotControllerOptions {
  session: PdfSession;
  user?: { id: string; name?: string };
  storage?: StorageClient;
  /** The fonts the pickers offer. `false`: a plain list of the standard fonts. */
  fonts?: FontRegistry | false;
  /** Prefix for what is kept in the browser (styles, saved signatures). */
  storageKey?: string;
  /** Which tools exist; the others are left out. Default: all. */
  tools?: readonly ToolId[];
  stamps?: readonly StampDef[];
  /** The compact bar over a selected annotation. Default true. */
  popover?: boolean;
  /** The mini toolbar over selected text. Default true. */
  selectionBar?: boolean;
  /** No editing (set by `useAnnotationKit` from its `readOnly` option). */
  readOnly?: boolean;
  /** Called when the page, the selected annotations or the tool changes, for presence (see `pdfSyncModel.mapPresence`). */
  onPresence?: (state: { page: string | null; selection: string[]; tool: string | null }) => void;
}

const PASTE_OFFSET = 12;
const MERGE_MS = 1200;
export const MIN_DRAG = 3;

/**
 * The state behind the annotation tools: which tool, the styles, the selection, what is being drawn, popovers and dialogs,
 * and the commands (add, change, delete, duplicate, copy, order, comment). It is a plain object with `subscribe`, so the
 * tools (which are not React components) and the components share it. Every change to the document goes through
 * `session.transact`: a whole drag, stroke or typing run is one undo step.
 */
export class AnnotController {
  readonly session: PdfSession;
  readonly options: AnnotControllerOptions;
  readonly namespace: string;
  readonly tools: ReadonlySet<ToolId>;
  readonly stamps: readonly StampDef[];
  styles: Styles;
  view: PdfViewContext | null = null;
  toolId: string | null = null;
  draft: Draft | null = null;
  placing: Placing | null = null;
  /** Annotations drawn in a moved or resized position while the pointer is down. */
  preview = new Map<string, Annotation>();
  /** Annotations the eraser has touched in the stroke that is still going. */
  erased = new Set<string>();
  editing: Editing | null = null;
  popover: Popover | null = null;
  dialog: DialogKind = null;
  textSelection: TextSelectionState | null = null;
  showLinks = false;
  presence: readonly PresenceInfo[] = [];
  live = "";
  version = 0;
  clipboard: { annots: Annotation[]; page: string; pastes: number } | null = null;
  lastStamp: StampDef | null = null;
  /** Things the ribbon does for the keyboard: it owns the hidden file input. */
  actions: { pickImage?: () => void } = {};
  #plainUsers: Users | null = null;

  #listeners = new Set<() => void>();
  #lastEdit: { key: string; time: number } | null = null;
  #liveTick = 0;

  constructor(options: AnnotControllerOptions) {
    this.session = options.session;
    this.options = options;
    this.namespace = options.storageKey ?? "pli-pdf";
    this.tools = new Set(options.tools ?? ALL_TOOLS);
    this.stamps = options.stamps ?? STANDARD_STAMPS;
    this.styles = options.storageKey === "" ? cloneStyles() : loadStyles(this.namespace);
  }

  // ---- state -------------------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    for (const l of this.#listeners) l();
  }

  get user(): { id: string; name?: string } | undefined {
    return this.options.user ?? this.session.options.user;
  }

  get client(): CommentClient<PdfAnchor> | null {
    return this.session.comments.client;
  }

  /** The people of the comments, or just the current user when comments are not turned on. */
  get users(): Users {
    const client = this.client;
    if (client) return client.users;
    const u = this.user;
    if (!this.#plainUsers || this.#plainUsers.current?.id !== u?.id) this.#plainUsers = new Users(u ? { id: u.id, name: u.name ?? u.id } : null);
    return this.#plainUsers;
  }

  get readOnly(): boolean {
    return !!this.options.readOnly || (this.view?.readOnly ?? false);
  }

  now(): number {
    return this.session.now();
  }

  /** Says something to screen readers (a polite live region in the ribbon). */
  announce(message: string): void {
    this.live = message + (this.#liveTick++ % 2 ? "​" : "");
    this.emit();
  }

  setView(view: PdfViewContext): void {
    this.view = view;
  }

  /** Redraws whatever shows the controller when the document or the selection changes. Returns how to stop. */
  connect(): () => void {
    return this.session.subscribe(() => this.emit());
  }

  /** The tool the viewer reports as active (from `onToolChange`). Leaving a tool drops what it was drawing. */
  setToolId(id: string | null): void {
    if (id === this.toolId) return;
    this.toolId = id;
    this.draft = null;
    this.erased.clear();
    this.preview.clear();
    if (id !== "stamp" && id !== "signature" && id !== "image") this.placing = null;
    if (id !== "select") this.popover = this.popover?.kind === "new-note" || this.popover?.kind === "link" ? this.popover : null;
    this.options.onPresence?.({ page: this.session.selection.page, selection: this.session.selection.annots, tool: id });
    this.emit();
  }

  /** Activates a tool (or none) through the viewer, so its `onCancel` runs and the toolbar follows. */
  setTool(id: ToolId | null): void {
    if (this.view) this.view.setTool(id);
    else this.setToolId(id);
  }

  /** Keeps the tool for another use if its style says so, else goes back to the select tool. */
  finishTool(key: StyleKey): void {
    if (!this.styles[key].sticky) this.setTool("select");
  }

  // ---- styles ------------------------------------------------------------------------------------------------------

  style(key: StyleKey): ToolStyle {
    return this.styles[key];
  }

  setStyle(key: StyleKey, patch: Partial<ToolStyle>): void {
    const next = { ...this.styles[key], ...patch };
    for (const k of Object.keys(next) as (keyof ToolStyle)[]) if (next[k] === undefined) delete next[k];
    this.styles = { ...this.styles, [key]: next as ToolStyle };
    if (this.options.storageKey !== "") saveStyles(this.namespace, this.styles);
    this.emit();
  }

  // ---- selection ---------------------------------------------------------------------------------------------------

  get selectedIds(): string[] {
    return this.session.selection.annots;
  }

  /** The selected annotations, as they are in the document (bottom to top). */
  get selected(): Annotation[] {
    const ids = new Set(this.session.selection.annots);
    if (ids.size === 0) return [];
    const out: Annotation[] = [];
    for (const page of this.session.doc.pages) for (const a of page.annots) if (ids.has(a.id)) out.push(a);
    return out;
  }

  pageOf(annotId: string): string | undefined {
    return findAnnot(this.session.doc, annotId)?.page.id;
  }

  select(ids: readonly string[], page?: string): void {
    const p = page ?? (ids[0] ? this.pageOf(ids[0]) : undefined) ?? this.session.selection.page;
    setSelection(this.session, { page: p, annots: [...ids] });
    this.options.onPresence?.({ page: p, selection: [...ids], tool: this.toolId });
    this.emit();
  }

  clearSelection(): void {
    if (this.session.selection.annots.length > 0) this.select([]);
  }

  selectAll(pageId: string | null = this.session.selection.page): void {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    if (page) this.select(page.annots.filter((a) => !a.hidden).map((a) => a.id), page.id);
  }

  /** Scrolls to an annotation and selects it. */
  reveal(annotId: string): void {
    const found = findAnnot(this.session.doc, annotId);
    if (!found) return;
    const a = found.page.annots[found.index]!;
    this.select([annotId], found.page.id);
    this.view?.goToPage(found.page.id, annotBounds(a).y);
  }

  // ---- changing the document ----------------------------------------------------------------------------------------

  #byline(): { author?: string; authorName?: string } {
    const u = this.user;
    const own = this.session.options.user;
    // `session.annots.add` stamps the session's user; the kit's user is used when the session has none.
    return u && !own ? { author: u.id, ...(u.name ? { authorName: u.name } : {}) } : {};
  }

  #top(pageId: string): string | null {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    return page?.annots[page.annots.length - 1]?.id ?? null;
  }

  /** Puts an annotation on a page, selects it, and says so. Returns its id. */
  add(pageId: string, annot: Omit<Annotation, "id"> & { id?: string }, options: { select?: boolean; say?: string } = {}): string {
    const id = this.session.annots.add(pageId, { ...this.#byline(), ...annot } as never, { select: options.select });
    this.#lastEdit = null;
    const index = this.session.doc.pages.findIndex((p) => p.id === pageId) + 1;
    this.announce(options.say ?? `${describeType(annot.type)} added on page ${index}`);
    return id;
  }

  /**
   * Changes properties of annotations as one undo step. Changes of the same property to the same annotations within a
   * moment (dragging a slider, typing) fold into the step before.
   */
  patch(ids: readonly string[], change: (a: Annotation) => Partial<Annotation>, mergeKey?: string): void {
    const doc = this.session.doc;
    const ops: PdfOp[] = [];
    const now = this.now();
    for (const id of ids) {
      const found = findAnnot(doc, id);
      if (!found) continue;
      const current = found.page.annots[found.index]!;
      const next: Record<string, unknown> = { ...current, ...change(current), id, modified: now };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      ops.push({ type: "replace_annot", annot: next as unknown as Annotation });
    }
    if (ops.length === 0) return;
    const key = mergeKey ? `${mergeKey}:${ids.join(",")}` : null;
    const merge = !!key && !!this.#lastEdit && this.#lastEdit.key === key && now - this.#lastEdit.time < MERGE_MS;
    this.session.transact(ops, { merge });
    this.#lastEdit = key ? { key, time: now } : null;
    // What was changed becomes what the tool draws next.
    const changed = ids.length === 1 ? this.session.annots.get(ids[0]!) : undefined;
    const sk = changed ? styleKeyOf(changed) : null;
    if (changed && sk) this.#learn(sk, changed);
    this.emit();
  }

  /** Remembers the look of an annotation as its tool's style. */
  #learn(key: StyleKey, a: Annotation): void {
    const style: Partial<ToolStyle> = {};
    if ("color" in a && typeof a.color === "string") style.color = a.color;
    if ("stroke" in a && a.stroke) {
      style.color = a.stroke.color;
      style.width = a.stroke.width;
      style.dash = a.stroke.dash;
    }
    if ("fill" in a) style.fill = a.fill;
    if (a.opacity !== undefined) style.opacity = a.opacity;
    if (a.type === "freetext") Object.assign(style, { family: a.style.family, size: a.style.size, bold: !!a.style.bold, italic: !!a.style.italic, color: a.style.color, align: a.style.align ?? "left" });
    if (a.type === "line") Object.assign(style, { startEnd: a.startEnd, endEnd: a.endEnd });
    if (a.type === "note" && a.icon) style.icon = a.icon;
    const merged = { ...this.styles[key], ...style };
    for (const k of Object.keys(merged) as (keyof ToolStyle)[]) if (merged[k] === undefined) delete merged[k];
    this.styles = { ...this.styles, [key]: merged as ToolStyle };
    if (this.options.storageKey !== "") saveStyles(this.namespace, this.styles);
  }

  /** Deletes the selected annotations (the locked ones stay). */
  deleteSelected(): void {
    const all = this.selected;
    const ids = all.filter((a) => !a.locked).map((a) => a.id);
    if (ids.length === 0) {
      if (all.length > 0) this.announce("Locked annotations can't be deleted. Unlock them first.");
      return;
    }
    this.remove(ids);
  }

  /**
   * Ends an erasing drag: annotations the eraser covered are removed, and pen strokes it cut are replaced by what is left of
   * them (an annotation with nothing left is removed). One undo step for the whole drag.
   */
  commitErase(): void {
    const gone = [...this.erased];
    const cut = [...this.preview.entries()].filter(([id]) => !this.erased.has(id));
    this.erased = new Set();
    this.preview = new Map();
    const doc = this.session.doc;
    const ops: PdfOp[] = [];
    for (const id of gone) {
      const found = findAnnot(doc, id);
      if (found) ops.push({ type: "remove_annot", page: found.page.id, id });
    }
    const now = this.now();
    for (const [id, a] of cut) if (findAnnot(doc, id)) ops.push({ type: "replace_annot", annot: { ...a, modified: now } as Annotation });
    if (ops.length === 0) return;
    this.session.transact(ops, { selection: { annots: this.session.selection.annots.filter((x) => !gone.includes(x)) } });
    this.#lastEdit = null;
    if (this.popover && "annot" in this.popover && this.popover.annot && gone.includes(this.popover.annot)) this.popover = null;
    this.announce(gone.length && !cut.length ? (gone.length === 1 ? "Annotation deleted" : `${gone.length} annotations deleted`) : cut.length ? "Pen strokes erased" : "Erased");
  }

  remove(ids: readonly string[]): void {
    this.session.annots.remove(ids);
    this.#lastEdit = null;
    if (this.popover && "annot" in this.popover && this.popover.annot && ids.includes(this.popover.annot)) this.popover = null;
    this.announce(ids.length === 1 ? "Annotation deleted" : `${ids.length} annotations deleted`);
  }

  #copyOf(a: Annotation, dx: number, dy: number): Annotation {
    const { ref: _ref, thread: _thread, id: _id, ...rest } = moveBy(a, dx, dy) as Annotation & { ref?: string; thread?: string };
    const now = this.now();
    const by = this.user;
    return { ...rest, id: createId("a_"), created: now, modified: now, ...(by ? { author: by.id, ...(by.name ? { authorName: by.name } : {}) } : {}), locked: undefined } as unknown as Annotation;
  }

  #insertCopies(pageId: string, copies: Annotation[], say: string): void {
    const clean = copies.map((c) => {
      const o = { ...c } as Record<string, unknown>;
      if (o.locked === undefined) delete o.locked;
      return o as unknown as Annotation;
    });
    let after = this.#top(pageId);
    const ops: PdfOp[] = clean.map((annot) => {
      const op: PdfOp = { type: "insert_annot", page: pageId, annot, after };
      after = annot.id;
      return op;
    });
    this.session.transact(ops, { selection: { page: pageId, annots: clean.map((c) => c.id) } });
    this.#lastEdit = null;
    this.announce(say);
  }

  /** Copies the selected annotations next to themselves. */
  duplicate(): void {
    const list = this.selected;
    if (list.length === 0) return;
    const page = this.pageOf(list[0]!.id)!;
    this.#insertCopies(page, list.map((a) => this.#copyOf(a, PASTE_OFFSET, PASTE_OFFSET)), list.length === 1 ? "Annotation duplicated" : `${list.length} annotations duplicated`);
  }

  copy(): boolean {
    const list = this.selected;
    if (list.length === 0) return false;
    this.clipboard = { annots: list.map((a) => JSON.parse(JSON.stringify(a)) as Annotation), page: this.pageOf(list[0]!.id)!, pastes: 0 };
    this.announce(list.length === 1 ? "Annotation copied" : `${list.length} annotations copied`);
    return true;
  }

  cut(): void {
    if (this.copy()) this.deleteSelected();
  }

  /** Puts the copied annotations on the page shown: in the same place on another page, shifted on the same one. */
  paste(): boolean {
    const clip = this.clipboard;
    const page = this.session.selection.page ?? clip?.page;
    if (!clip || !page) return false;
    clip.pastes++;
    const shift = page === clip.page ? PASTE_OFFSET * clip.pastes : 0;
    this.#insertCopies(page, clip.annots.map((a) => this.#copyOf(a, shift, shift)), clip.annots.length === 1 ? "Annotation pasted" : `${clip.annots.length} annotations pasted`);
    return true;
  }

  /** Moves the selected annotations by a step (arrow keys); repeated steps are one undo step. */
  nudge(dx: number, dy: number): void {
    const list = this.selected.filter(canMove);
    if (list.length === 0) return;
    const pageId = this.pageOf(list[0]!.id)!;
    const page = this.session.doc.pages.find((p) => p.id === pageId)!;
    const box = boundsOfAll(list);
    const mx = Math.max(-box.x, Math.min(page.width - box.x - box.w, dx));
    const my = Math.max(-box.y, Math.min(page.height - box.y - box.h, dy));
    if (mx === 0 && my === 0) return;
    this.patch(list.map((a) => a.id), (a) => moveBy(a, mx, my) as Partial<Annotation>, "nudge");
  }

  /** The selected annotations that can be moved, on the page of the first one: what Align and Distribute work on. */
  arrangeable(): Annotation[] {
    const list = this.selected.filter(canMove);
    const page = list[0] ? this.pageOf(list[0].id) : undefined;
    return list.filter((a) => this.pageOf(a.id) === page);
  }

  /** Lines the selected annotations up on an edge or a middle line of the box around them: one undo step. */
  align(how: Align): void {
    const list = this.arrangeable();
    const moves = alignMoves(list.map((a) => ({ id: a.id, box: selectionBox(a) })), how);
    this.#arrange(moves, list.length < 2 ? "Select two or more annotations to align them" : moves.length ? `${ALIGN_LABEL[how]}: ${list.length} annotations` : "Already aligned");
  }

  /** Makes the gaps between the selected annotations equal, keeping the outer two where they are: one undo step. */
  distribute(how: Distribute): void {
    const list = this.arrangeable();
    const moves = distributeMoves(list.map((a) => ({ id: a.id, box: selectionBox(a) })), how);
    this.#arrange(moves, list.length < 3 ? "Select three or more annotations to distribute them" : moves.length ? `${DISTRIBUTE_LABEL[how]}: ${list.length} annotations` : "Already evenly spaced");
  }

  #arrange(moves: readonly Move[], say: string): void {
    if (moves.length > 0) {
      const by = new Map(moves.map((m) => [m.id, m]));
      this.patch(moves.map((m) => m.id), (a) => moveBy(a, by.get(a.id)!.dx, by.get(a.id)!.dy) as Partial<Annotation>);
    }
    this.announce(say);
  }

  /** Changes the drawing order: one step up or down, or to the very top or bottom. */
  reorder(how: "forward" | "backward" | "front" | "back"): void {
    const list = this.selected;
    if (list.length === 0) return;
    const pageId = this.pageOf(list[0]!.id)!;
    const page = this.session.doc.pages.find((p) => p.id === pageId)!;
    const ids = list.map((a) => a.id);
    let order = page.annots.map((a) => a.id);
    const ops: PdfOp[] = [];
    const apply = (id: string, after: string | null) => {
      const without = order.filter((x) => x !== id);
      const at = after === null ? 0 : without.indexOf(after) + 1;
      if (after !== null && at === 0) return;
      const next = [...without.slice(0, at), id, ...without.slice(at)];
      if (next.join() === order.join()) return;
      order = next;
      ops.push({ type: "move_annot", id, after });
    };
    const selectedInOrder = order.filter((id) => ids.includes(id));
    if (how === "front") for (const id of selectedInOrder) apply(id, order[order.length - 1]!);
    else if (how === "back") for (const id of [...selectedInOrder].reverse()) apply(id, null);
    else if (how === "forward") {
      for (const id of [...selectedInOrder].reverse()) {
        const i = order.indexOf(id);
        const next = order[i + 1];
        if (next && !ids.includes(next)) apply(id, next);
      }
    } else {
      for (const id of selectedInOrder) {
        const i = order.indexOf(id);
        if (i > 0 && !ids.includes(order[i - 1]!)) apply(id, order[i - 2] ?? null);
      }
    }
    if (ops.length === 0) return;
    this.session.transact(ops);
    this.#lastEdit = null;
    this.announce({ forward: "Brought forward", backward: "Sent backward", front: "Brought to front", back: "Sent to back" }[how]);
  }

  setLocked(ids: readonly string[], locked: boolean): void {
    this.patch(ids, () => ({ locked: locked || undefined }) as Partial<Annotation>);
    this.announce(locked ? "Locked" : "Unlocked");
  }

  undo(): void {
    if (this.session.undo()) this.announce("Undone");
  }
  redo(): void {
    if (this.session.redo()) this.announce("Redone");
  }

  // ---- markup from text ---------------------------------------------------------------------------------------------

  /** Highlights, underlines, strikes out or squiggles the selected text: one annotation per page, one undo step. */
  markup(type: "highlight" | "underline" | "strikeout" | "squiggly", selected: readonly SelectedText[], options: { color?: string } = {}): string[] {
    const style = this.styles[type];
    const ops: PdfOp[] = [];
    const ids: string[] = [];
    const now = this.now();
    const tops = new Map<string, string | null>();
    for (const part of selected) {
      if (part.rects.length === 0) continue;
      const id = createId("a_");
      const annot = {
        id,
        type,
        color: options.color ?? style.color,
        rects: part.rects.map((r) => ({ x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) })),
        ...(part.text ? { quote: part.text } : {}),
        ...(style.opacity !== undefined && style.opacity < 1 ? { opacity: style.opacity } : {}),
        created: now,
        modified: now,
        ...(this.user ? { author: this.user.id, ...(this.user.name ? { authorName: this.user.name } : {}) } : {}),
      } as Annotation;
      if (!tops.has(part.page)) tops.set(part.page, this.#top(part.page));
      ops.push({ type: "insert_annot", page: part.page, annot, after: tops.get(part.page) ?? null });
      tops.set(part.page, id);
      ids.push(id);
    }
    if (ops.length === 0) return [];
    // A tool that stays on does not select what it draws; one that goes back to Select leaves the new mark selected.
    this.session.transact(ops, { selection: { page: selected[0]!.page, annots: style.sticky && this.toolId === type ? [] : ids } });
    this.#lastEdit = null;
    const word = { highlight: "Highlight", underline: "Underline", strikeout: "Strikethrough", squiggly: "Squiggly underline" }[type];
    this.announce(`${word} added on page ${selected[0]!.index + 1}`);
    this.#clearBrowserSelection();
    this.textSelection = null;
    this.emit();
    return ids;
  }

  #clearBrowserSelection(): void {
    try {
      window.getSelection?.()?.removeAllRanges();
    } catch {
      // nothing to clear
    }
  }

  // ---- comments -----------------------------------------------------------------------------------------------------

  /** Opens the comment of an annotation (its thread, or a box to start one). */
  openComment(annotId: string): void {
    this.popover = { kind: "comment", annot: annotId };
    this.emit();
  }

  closePopover(): void {
    if (!this.popover) return;
    if (this.popover.kind === "new-note" || this.popover.kind === "link") this.draft = null;
    this.popover = null;
    this.emit();
  }

  /** Starts (or, without comments turned on, sets) the comment of an annotation. */
  comment(annotId: string, body: string, mentions?: readonly string[]): void {
    const found = findAnnot(this.session.doc, annotId);
    if (!found) return;
    const client = this.client;
    if (client) {
      this.session.comments.commentOn(annotId, body, mentions);
    } else {
      this.session.annots.update(annotId, { contents: body });
    }
    this.announce("Comment added");
  }

  /**
   * Starts a comment from the keyboard or a menu: on the selected text it highlights the text and opens its comment; with no text
   * selected it puts the Note tool down, to click the page where the comment goes. Returns whether a comment box was opened.
   */
  commentOnSelection(): boolean {
    if (this.readOnly) return false;
    const selected = this.readSelection();
    if (selected.length > 0) {
      const ids = this.markup("highlight", selected);
      if (ids[0]) {
        this.openComment(ids[0]);
        return true;
      }
    }
    if (this.tools.has("note")) {
      this.setTool("note");
      this.announce("Click the page where the comment goes");
    }
    return false;
  }

  /** Puts a sticky note on a page with its first comment (a thread when comments are on, else the note's text). */
  addNote(pageId: string, x: number, y: number, body: string, mentions?: readonly string[]): string {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    if (!page) return "";
    const at = { x: round2(Math.max(0, Math.min(page.width - 24, x))), y: round2(Math.max(0, Math.min(page.height - 24, y))) };
    const style = this.styles.note;
    let id: string;
    if (this.client) {
      const thread = this.session.comments.addNote(pageId, at.x, at.y, body, mentions);
      id = thread.anchor?.annot ?? "";
      // One undo step with the note itself.
      this.session.annots.update(id, { color: style.color, icon: style.icon ?? "comment", ...this.#byline() } as Partial<Annotation>, { merge: true });
    } else {
      id = this.add(pageId, { type: "note", x: at.x, y: at.y, contents: body, icon: style.icon ?? "comment", color: style.color } as Omit<NoteAnnot, "id">, { say: "Note added" });
    }
    this.announce("Note added");
    return id;
  }

  // ---- text boxes ---------------------------------------------------------------------------------------------------

  /** A new, empty text box that is in the document only once it has text. */
  newTextBox(rect: Rect): FreeTextAnnot {
    const s = this.styles.text;
    const now = this.now();
    const by = this.user;
    return {
      id: createId("a_"),
      type: "freetext",
      rect,
      text: "",
      style: { family: s.family, size: s.size, color: s.color, ...(s.bold ? { bold: true } : {}), ...(s.italic ? { italic: true } : {}), ...(s.align !== "left" ? { align: s.align } : {}) },
      ...(s.fill ? { fill: s.fill } : {}),
      ...(s.width > 0 ? { stroke: { color: s.color, width: s.width, ...(s.dash ? { dash: s.dash } : {}) } } : {}),
      ...(s.opacity !== undefined && s.opacity < 1 ? { opacity: s.opacity } : {}),
      created: now,
      modified: now,
      ...(by ? { author: by.id, ...(by.name ? { authorName: by.name } : {}) } : {}),
    };
  }

  beginEdit(pageId: string, annot: FreeTextAnnot, isNew: boolean): void {
    if (annot.locked) return;
    this.editing = { page: pageId, annot, isNew };
    this.draft = null;
    this.select(isNew ? [] : [annot.id], pageId);
    this.#lastEdit = null;
    this.emit();
  }

  /** Bold or italic for the text box being typed in, or the selected text boxes (all on if the first is off, else all off). Returns whether there was a box. */
  toggleTextStyle(key: "bold" | "italic"): boolean {
    if (this.readOnly) return false;
    const e = this.editing;
    if (e) {
      this.editText({ style: { ...e.annot.style, [key]: !e.annot.style[key] } as TextStyle });
      return true;
    }
    const boxes = this.selected.filter((a): a is FreeTextAnnot => a.type === "freetext" && !a.locked);
    if (boxes.length === 0 || boxes.length !== this.selected.length) return false;
    const on = !boxes[0]!.style[key];
    this.patch(boxes.map((b) => b.id), (a) => withText(a, { [key]: on }), "text");
    return true;
  }

  /** Types into the text box being edited. Typing is one undo step: the first change is its own, the rest fold into it. */
  editText(patch: Partial<FreeTextAnnot>): void {
    const e = this.editing;
    if (!e) return;
    const next = { ...e.annot, ...patch } as FreeTextAnnot;
    this.editing = { ...e, annot: next };
    if (!e.isNew) {
      const { id: _id, ...rest } = patch as Record<string, unknown>;
      this.patch([next.id], () => rest as Partial<Annotation>, "typing");
      return;
    }
    this.emit();
  }

  /** Ends editing: a new box with text is added, one left empty is dropped without a trace. */
  finishEdit(): void {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    if (e.isNew) {
      if (e.annot.text.trim() !== "") {
        const annot = { ...e.annot };
        this.session.annots.add(e.page, annot as never, { select: true });
        this.announce("Text box added");
      }
    } else if (e.annot.text.trim() === "") {
      // Emptied an existing box: it goes, as an undo step the person can take back.
      this.session.annots.remove([e.annot.id]);
      this.announce("Empty text box deleted");
    }
    this.#lastEdit = null;
    this.setTool("select");
    this.emit();
  }

  /** The height a text box needs for its lines, so that typing grows the box. */
  textBoxHeight(lines: number, size: number): number {
    return round2(textHeight(lines, size));
  }

  // ---- pictures -----------------------------------------------------------------------------------------------------

  /** Turns a picture file into a picture annotation on a page (centered on `at`, or the page). Goes through `storage` when there is one. */
  async insertImage(file: { name?: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }, pageId = this.session.selection.page, at?: Pt): Promise<string | null> {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    if (!page) return null;
    try {
      let picture = await fileToPicture(file);
      const storage = this.options.storage;
      if (storage) {
        const up = await storage.upload(file as never, { name: file.name, type: file.type });
        const src = up.url ?? (await storage.resolve(up.ref));
        picture = { ...picture, src, ...(up.width && up.height ? { width: up.width, height: up.height } : {}) };
      }
      return this.placePicture(page.id, picture, at);
    } catch (error) {
      this.announce(error instanceof Error ? `Couldn't add the picture: ${error.message}` : "Couldn't add the picture");
      return null;
    }
  }

  placePicture(pageId: string, picture: PdfPicture, at?: Pt): string | null {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    if (!page) return null;
    const natural = picture.width && picture.height ? { w: picture.width, h: picture.height } : (() => {
      const bytes = dataUriBytes(picture.src)?.bytes;
      const size = bytes ? imageSizeOf(bytes) : null;
      return size ? { w: size.width, h: size.height } : { w: 200, h: 150 };
    })();
    // Pictures are 96 per inch on a screen: 72 points per 96 pixels, and never more than 60% of the page.
    const size = fitInside(natural.w * 0.75, natural.h * 0.75, page.width * 0.6, page.height * 0.6);
    const rect = centredRect(at?.[0] ?? page.width / 2, at?.[1] ?? page.height / 2, size.w, size.h, page.width, page.height);
    return this.add(page.id, { type: "image", rect, picture } as never, { say: "Picture added" });
  }

  // ---- stamps and signatures ----------------------------------------------------------------------------------------

  /** Chooses a stamp: the next click or drag on a page puts it down. */
  chooseStamp(stamp: StampDef | { picture: PdfPicture }): void {
    if (!("picture" in stamp)) this.lastStamp = stamp;
    const value: StampAnnot["stamp"] = "picture" in stamp ? stamp : { name: stamp.name, label: stamp.label, color: stamp.color };
    const label = "picture" in value ? "" : (value.label ?? value.name);
    const size = "picture" in value ? fitInside(value.picture.width ?? 160, value.picture.height ?? 60, 200, 100) : stampSize(label);
    this.placing = { kind: "stamp", stamp: value, w: size.w, h: size.h };
    this.setTool("stamp");
    this.announce("Click on the page to place the stamp");
  }

  /**
   * A signature field was clicked: the signature dialog opens, and what it makes is put INSIDE that field (as big as fits, with its
   * proportions), instead of being carried to a place on the page. Cancelling the dialog leaves the field as it was.
   */
  signField(field: { id: string; name: string }): void {
    if (this.readOnly) return;
    this.signTarget = { id: field.id, name: field.name };
    this.openDialog("signature");
  }

  /** The signature field the open signature dialog is for, or null (then a signature is placed by a click on the page). */
  signTarget: { id: string; name: string } | null = null;

  chooseSignature(value: SignatureValue, width = 150): void {
    const target = this.signTarget;
    this.signTarget = null;
    if (target) {
      try {
        this.session.forms.sign(target.id, value.mode === "draw" ? { mode: "draw", strokes: value.strokes, box: { width: value.width, height: value.height }, color: value.color, width: value.lineWidth } : value.mode === "type" ? { mode: "type", text: value.text, font: value.font, color: value.color } : { mode: "image", picture: value.picture });
        this.announce("Signed");
      } catch (e) {
        this.announce(`Could not sign: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.emit();
      return;
    }
    const ratio = value.mode === "draw" ? (value.height > 0 ? value.width / value.height : 3) : value.mode === "image" ? ((value.picture.width ?? 3) / (value.picture.height ?? 1)) : Math.max(1.5, value.text.length * 0.55);
    this.placing = { kind: "signature", value, ratio, w: width };
    this.setTool("signature");
    this.announce("Click on the page to place the signature, or drag to size it");
  }

  /** What a tool's key does: tools are chosen; stamps, signatures and pictures need something chosen first. Pressing it again puts the tool down. */
  chooseByKey(id: ToolId): void {
    if (this.toolId === id) return this.setTool(id === "select" ? null : "select");
    if (id === "stamp") return this.chooseStamp(this.lastStamp ?? this.stamps[0] ?? STANDARD_STAMPS[0]!);
    if (id === "signature") {
      const saved = loadSignatures(this.namespace, this.user?.id).find((s) => s.kind === "signature");
      return saved ? this.chooseSignature(saved.value) : this.openDialog("signature");
    }
    if (id === "image") return this.actions.pickImage?.();
    this.setTool(id);
  }

  openDialog(kind: DialogKind): void {
    // A signature dialog that is closed without making a signature (the Cancel button, Escape) leaves its field alone.
    if (kind === null) this.signTarget = null;
    this.dialog = kind;
    this.emit();
  }

  // ---- redaction ----------------------------------------------------------------------------------------------------

  /** How many redaction marks there are, and on how many pages. */
  redactionCount(): { marks: number; pages: number } {
    let marks = 0;
    let pages = 0;
    for (const p of this.session.doc.pages) {
      const n = p.annots.filter((a) => a.type === "redact").length;
      marks += n;
      if (n) pages++;
    }
    return { marks, pages };
  }

  /**
   * Marks every match of a search for redaction (the engine's `content.markSearch`, one undo step) and asks, in the apply
   * redactions dialog, whether to remove them. Returns how many matches were marked.
   */
  async redactMatches(query: string, options: { matchCase?: boolean; wholeWord?: boolean } = {}): Promise<number> {
    if (this.readOnly || !query.trim()) return 0;
    try {
      const ids = await this.session.content.markSearch(query, { caseSensitive: options.matchCase, wholeWord: options.wholeWord });
      if (ids.length === 0) {
        this.announce(`No matches for "${query}" to redact`);
        return 0;
      }
      this.announce(`${ids.length} ${ids.length === 1 ? "match" : "matches"} of "${query}" marked for redaction`);
      this.openDialog("apply-redactions");
      return ids.length;
    } catch (error) {
      this.announce(`Could not mark the matches: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  /** Marks the selected text for redaction (one mark per page). */
  markRedaction(selected: readonly SelectedText[]): string[] {
    const style = this.styles.redact;
    const ops: PdfOp[] = [];
    const ids: string[] = [];
    const now = this.now();
    for (const part of selected) {
      if (part.rects.length === 0) continue;
      const id = createId("a_");
      ops.push({ type: "insert_annot", page: part.page, annot: { id, type: "redact", rects: part.rects.map((r) => ({ ...r })), ...(style.fill ? { fill: style.fill } : {}), created: now, modified: now, ...(this.user ? { author: this.user.id } : {}) } as Annotation, after: this.#top(part.page) });
      ids.push(id);
    }
    if (ops.length === 0) return [];
    this.session.transact(ops, { selection: { page: selected[0]!.page, annots: ids } });
    this.textSelection = null;
    this.#clearBrowserSelection();
    this.announce("Marked for redaction. Nothing is removed until you apply the redactions.");
    this.emit();
    return ids;
  }

  /**
   * Applies every redaction mark (the engine's `content.applyRedactions`): the marks become edits of the page, one undo
   * step; the covered text and pictures are cut out of the file when it is saved. Where the engine does not have it this
   * says so and changes nothing.
   */
  async applyRedactions(): Promise<{ ok: boolean; message: string }> {
    const content = this.session.content as unknown as { applyRedactions?: () => unknown };
    if (typeof content.applyRedactions !== "function") {
      const message = "This version of the PDF engine can't apply redactions yet. The marks are kept; nothing was removed.";
      this.announce(message);
      return { ok: false, message };
    }
    try {
      const result = (await content.applyRedactions()) as { pages?: string[]; rects?: number; removedAnnotations?: number } | undefined;
      const rects = result?.rects;
      const pages = result?.pages?.length ?? 0;
      const removed = result?.removedAnnotations ?? 0;
      const message =
        typeof rects === "number"
          ? `Redactions applied: ${rects} ${rects === 1 ? "area" : "areas"} on ${pages} ${pages === 1 ? "page" : "pages"}. The covered content is removed from the file when you save.${removed ? ` ${removed} ${removed === 1 ? "annotation or comment" : "annotations or comments"} under the marks ${removed === 1 ? "was" : "were"} removed too.` : ""}`
          : "Redactions applied. The covered content is removed from the file when you save.";
      this.clearSelection();
      this.announce(message);
      return { ok: true, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The redactions could not be applied";
      this.announce(`Redactions could not be applied: ${message}`);
      return { ok: false, message };
    } finally {
      this.dialog = null;
      this.emit();
    }
  }

  /** The text selected in the pages now, as rectangles of page space (empty when nothing is selected). */
  readSelection(): SelectedText[] {
    try {
      const sel = window.getSelection?.();
      const scroller = this.view?.scroller();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !scroller) return [];
      return selectionRects(sel.getRangeAt(0), scroller);
    } catch {
      return [];
    }
  }

  // ---- drafts that become annotations -------------------------------------------------------------------------------

  /** Writes the previewed (moved, resized) annotations into the document as one undo step and drops the preview. */
  commitPreview(say?: string): void {
    const now = this.now();
    const ops: PdfOp[] = [...this.preview.values()].map((a) => ({ type: "replace_annot", annot: { ...a, modified: now } as Annotation }));
    this.preview = new Map();
    if (ops.length > 0) this.session.transact(ops);
    this.#lastEdit = null;
    if (say && ops.length > 0) this.announce(say);
    this.emit();
  }

  /** Turns the polyline or polygon being drawn into an annotation (or drops it if it has too few points). */
  finishPoly(): boolean {
    const d = this.draft;
    if (d?.type !== "poly") return false;
    this.draft = null;
    const points = d.points;
    if (points.length < (d.closed ? 3 : 2)) {
      this.emit();
      return false;
    }
    const s = d.style;
    const stroke = { color: s.color, width: s.width, ...(s.dash && s.dash.length ? { dash: s.dash } : {}) };
    this.add(d.page, d.closed ? ({ type: "polygon", points, stroke, ...(s.fill ? { fill: s.fill } : {}), ...(s.opacity !== undefined && s.opacity < 1 ? { opacity: s.opacity } : {}) } as never) : ({ type: "polyline", points, stroke, ...(s.opacity !== undefined && s.opacity < 1 ? { opacity: s.opacity } : {}) } as never), { select: !s.sticky });
    this.finishTool(d.closed ? "polygon" : "polyline");
    return true;
  }

  /** Drops whatever is being drawn, placed or typed, and says whether there was anything. */
  cancelDraft(): boolean {
    const had = !!(this.draft || this.preview.size || this.erased.size || this.popover || this.editing || this.placing);
    this.draft = null;
    this.preview = new Map();
    this.erased = new Set();
    this.popover = null;
    this.editing = null;
    if (this.toolId !== "stamp" && this.toolId !== "signature" && this.toolId !== "image") this.placing = null;
    if (had) this.emit();
    return had;
  }

  // ---- geometry helpers for the tools -------------------------------------------------------------------------------

  pageById(id: string) {
    return this.session.doc.pages.find((p) => p.id === id);
  }

  /** `rect` kept inside the page. */
  insidePage(pageId: string, rect: Rect): Rect {
    const p = this.pageById(pageId);
    return p ? clampRect(rect, p.width, p.height) : rect;
  }

  boxOf(a: Annotation): Rect {
    return selectionBox(a);
  }
}

export const ALL_TOOLS: readonly ToolId[] = ["select", "highlight", "underline", "strikeout", "squiggly", "ink", "eraser", "rectangle", "ellipse", "line", "arrow", "polyline", "polygon", "text", "note", "stamp", "signature", "image", "link", "redact"];

export function describeType(type: string): string {
  const names: Record<string, string> = {
    highlight: "Highlight",
    underline: "Underline",
    strikeout: "Strikethrough",
    squiggly: "Squiggly underline",
    ink: "Drawing",
    square: "Rectangle",
    circle: "Ellipse",
    line: "Line",
    polygon: "Polygon",
    polyline: "Polyline",
    freetext: "Text box",
    note: "Note",
    stamp: "Stamp",
    signature: "Signature",
    image: "Picture",
    link: "Link",
    redact: "Redaction mark",
  };
  return names[type] ?? "Annotation";
}
