import { useSyncExternalStore } from "react";
import type { FieldAppearance, FieldFlags, FormField, FormProblem, NewField, PdfDoc, PdfOp, PdfSession, Pt, Rect, Widget } from "@pli.dev/pdf";
import { documentName, downloadBytes, fileStem } from "./download";
import type { PagePointerEvent, PdfViewContext } from "./extensions";
import { saveBytes } from "./saving";
import { ALIGN_LABEL, DISTRIBUTE_LABEL, alignMoves, distributeMoves, type Align, type Distribute, type Move } from "./align";
import { DRAG_PIXELS, copyName, dragRect, fieldLabel, freeName, kindInfo, moveRect, placeRect, readingOrder, snapRect, tabStops, type FieldKind, type OrderedWidget } from "./formsGeometry";

/**
 * The state behind the form tools: whether fields are highlighted, the form bar, Prepare form (design) mode, the selected
 * widget, what is being drawn, and the commands (fill, clear, export, import, flatten, add, move, delete, duplicate). A plain
 * object with `subscribe`, so the tools (which are not React components) and the components share it. Every change to the
 * document goes through `session.forms` or `session.transact`: one burst of typing, one drag or one run of arrow keys is one
 * undo step.
 */

export type FormDialog = "flatten" | null;

export interface FormControllerOptions {
  session: PdfSession;
  /** No filling and no design tools, whatever the viewer says. */
  readOnly?: boolean;
  /** Start with the fields highlighted (default true). */
  highlight?: boolean;
  /** A signature field was clicked: open your signature dialog. Without it the field cannot be signed from here. */
  onSign?: (field: FormField, widget: Widget) => void;
  /** Gets the flattened file. Default: download it as `<name>-flattened.pdf`. */
  onFlatten?: (bytes: Uint8Array, info: { name: string }) => void | Promise<void>;
  /** How a file is handed to the person (JSON data, the flattened PDF). Default: `downloadBytes`. */
  download?: (bytes: Uint8Array, name: string, mime: string) => void | Promise<void>;
}

export interface Notice {
  kind: "info" | "error";
  text: string;
}

/** The radio group being made: where each button goes so far. */
export interface RadioDraft {
  points: { page: string; rect: Rect }[];
}

export interface FormDraft {
  kind: FieldKind;
  page: string;
  from: Pt;
  to: Pt;
}

/** The text of a file (older engines have no `Blob.text`). */
function readText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsText(file);
  });
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class FormController {
  readonly session: PdfSession;
  readonly options: FormControllerOptions;
  view: PdfViewContext | null = null;
  highlight: boolean;
  bannerOpen = true;
  designing = false;
  /** Number the widgets in tab order. */
  showOrder = false;
  /** The selected widget (design mode); with `also`, the one the others were added to. */
  selected: string | null = null;
  /** Widgets added to the selection with Shift or Ctrl/Cmd click (design mode), besides `selected`. */
  also: string[] = [];
  draft: FormDraft | null = null;
  radio: RadioDraft | null = null;
  dialog: FormDialog = null;
  notice: Notice | null = null;
  live = "";
  version = 0;
  /** The widget that has the focus (so the message of an invalid field shows). */
  focused: string | null = null;
  /** A widget on a page that was not drawn yet: it is focused when it is. */
  pendingFocus: string | null = null;
  /** Fields the person has been in (a required field is only called invalid once visited). */
  touched = new Set<string>();
  /** Widgets drawn in another place while the pointer is down. */
  preview = new Map<string, Rect>();
  /** The viewer's file commands (File menu), when there are any: flattening goes through them. */
  files: { download(choice: "forms", options: { name?: string; dialog?: boolean }): Promise<boolean> } | null = null;
  /** Things the toolbar does for the keyboard: it owns the hidden file input. */
  actions: { pickFile?: () => void } = {};

  #listeners = new Set<() => void>();
  #last: { key: string; doc: PdfDoc } | null = null;
  #problems: { doc: PdfDoc; map: Map<string, FormProblem[]> } | null = null;
  #order: { doc: PdfDoc; order: OrderedWidget[]; stops: string[] } | null = null;
  #lastClick: { page: string; at: Pt; time: number } | null = null;
  #tick = 0;

  constructor(options: FormControllerOptions) {
    this.session = options.session;
    this.options = options;
    this.highlight = options.highlight ?? true;
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

  /** Redraws whatever shows the controller when the document changes. Returns how to stop. */
  connect(): () => void {
    return this.session.subscribe(() => this.emit());
  }

  setView(view: PdfViewContext): void {
    this.view = view;
  }

  get readOnly(): boolean {
    return !!this.options.readOnly || !!this.view?.readOnly;
  }

  get fields(): readonly FormField[] {
    return this.session.doc.fields;
  }

  /** Says something to screen readers (a polite live region in the toolbar). */
  announce(text: string): void {
    this.live = text + (this.#tick++ % 2 ? "​" : "");
    this.emit();
  }

  say(kind: Notice["kind"], text: string): void {
    this.notice = { kind, text };
    this.announce(text);
  }

  clearNotice(): void {
    if (!this.notice) return;
    this.notice = null;
    this.emit();
  }

  setHighlight(on: boolean): void {
    this.highlight = on;
    this.announce(on ? "Fields highlighted" : "Field highlight off");
  }

  closeBanner(): void {
    this.bannerOpen = false;
    this.emit();
  }

  openBanner(): void {
    this.bannerOpen = true;
    this.emit();
  }

  openDialog(kind: FormDialog): void {
    this.dialog = kind;
    this.emit();
  }

  // ---- what the document says about the form -----------------------------------------------------------------------

  /** Problems by field id (`session.forms.problems()`, kept until the document changes). */
  problems(): Map<string, FormProblem[]> {
    const doc = this.session.doc;
    if (this.#problems?.doc !== doc) {
      const map = new Map<string, FormProblem[]>();
      for (const p of this.session.forms.problems()) map.set(p.field, [...(map.get(p.field) ?? []), p]);
      this.#problems = { doc, map };
    }
    return this.#problems.map;
  }

  /** What is wrong with a field, if anything. A required field left empty counts once the person has been in it. */
  invalid(fieldId: string): FormProblem | undefined {
    return this.problems().get(fieldId)?.find((p) => p.kind !== "required" || this.touched.has(fieldId));
  }

  /** Every widget in reading order. */
  order(): readonly OrderedWidget[] {
    const doc = this.session.doc;
    if (this.#order?.doc !== doc) {
      const order = readingOrder(doc);
      this.#order = { doc, order, stops: tabStops(order).map((o) => o.widget.id) };
    }
    return this.#order.order;
  }

  /** The widgets Tab stops at (fill mode), in order. */
  stopIds(): string[] {
    this.order();
    return this.#order!.stops;
  }

  fieldOfWidget(widgetId: string): FormField | undefined {
    return this.session.forms.ofWidget(widgetId);
  }

  /** The selected widget with its field, when it still exists. */
  get selection(): { field: FormField; widget: Widget } | null {
    if (!this.selected) return null;
    const field = this.fieldOfWidget(this.selected);
    const widget = field?.widgets.find((w) => w.id === this.selected);
    return field && widget ? { field, widget } : null;
  }

  // ---- merging one burst of edits into one undo step ---------------------------------------------------------------

  /** True when the last change was made with this `key` and nothing has changed since: the next change joins its undo step. */
  #joins(key: string): boolean {
    return this.#last?.key === key && this.#last.doc === this.session.doc;
  }
  #remember(key: string | null): void {
    this.#last = key ? { key, doc: this.session.doc } : null;
  }
  /** The next change starts a new undo step. */
  endBurst(): void {
    this.#last = null;
  }

  // ---- filling -----------------------------------------------------------------------------------------------------

  /**
   * Puts a value in a field. While typing (`burst`) the edits of one field are one undo step; a choice (a check box, a
   * drop-down) is a step of its own. Returns the engine's message when the value is refused, else null.
   */
  edit(fieldId: string, value: FormField["value"], burst = false): string | null {
    if (this.readOnly) return "This form is read only";
    const key = `v:${fieldId}`;
    try {
      this.session.forms.setValue(fieldId, value, { merge: burst && this.#joins(key) });
    } catch (e) {
      return message(e);
    }
    this.#remember(burst ? key : null);
    return null;
  }

  /** Escape in a field: puts back what it had when the person went in. */
  revert(fieldId: string, start: FormField["value"]): void {
    const key = `v:${fieldId}`;
    if (this.#joins(key) && this.session.canUndo) this.session.undo();
    else if (JSON.stringify(this.session.forms.get(fieldId).value) !== JSON.stringify(start)) this.edit(fieldId, start);
    this.#remember(null);
    this.emit();
  }

  /** The person left a field. */
  leave(fieldId: string): void {
    this.endBurst();
    this.touched.add(fieldId);
    this.emit();
  }

  setFocused(widgetId: string | null): void {
    if (this.focused === widgetId) return;
    this.focused = widgetId;
    this.emit();
  }

  /** Puts every field back to its default value (one undo step). */
  clear(): void {
    if (this.readOnly) return;
    this.endBurst();
    const before = this.session.doc;
    this.session.forms.reset();
    this.touched.clear();
    this.announce(this.session.doc === before ? "The form is already empty" : "Form cleared");
  }

  // ---- moving between fields ---------------------------------------------------------------------------------------

  /** The element that takes the focus for a widget. */
  control(widgetId: string): HTMLElement | null {
    const root: ParentNode = this.view?.scroller() ?? document;
    const el = root.querySelector<HTMLElement>(`[data-widget-id="${widgetId.replace(/"/g, '\\"')}"]`);
    if (!el) return null;
    // In Prepare form the frame takes the focus; its picture of the control is inert.
    return this.designing ? el : (el.querySelector<HTMLElement>("[data-control]") ?? el);
  }

  /** Focuses a widget; when its page is not drawn the view goes there first and the widget takes the focus once it is. */
  focusWidget(widgetId: string): boolean {
    const el = this.control(widgetId);
    if (el) {
      this.pendingFocus = null;
      el.focus();
      return true;
    }
    const at = this.order().find((o) => o.widget.id === widgetId);
    if (!at || !this.view) return false;
    this.pendingFocus = widgetId;
    this.view.goToPage(at.widget.page, at.widget.rect.y);
    return true;
  }

  /** Where Tab (dir 1) or Shift+Tab (-1) goes from a widget, or null at the ends (the browser then moves on). */
  neighbour(widgetId: string, dir: 1 | -1): OrderedWidget | null {
    const list = this.designing ? this.order() : tabStops(this.order());
    const here = this.order().find((o) => o.widget.id === widgetId);
    if (!here) return null;
    let at = list.findIndex((o) => o.widget.id === widgetId);
    // A radio button that is not the stop of its group: the group's stop is where it is.
    if (at < 0) at = list.findIndex((o) => o.field.id === here.field.id);
    return list[at + dir] ?? null;
  }

  /** Tab and Shift+Tab. Returns true when the focus moved (the key must then be stopped). */
  tab(widgetId: string, dir: 1 | -1): boolean {
    const next = this.neighbour(widgetId, dir);
    if (!next) return false;
    return this.focusWidget(next.widget.id);
  }

  // ---- data, flatten -----------------------------------------------------------------------------------------------

  exportJson(): string {
    return JSON.stringify(this.session.forms.exportData(), null, 2);
  }

  get documentName(): string {
    return documentName(this.session.doc);
  }

  async #deliver(bytes: Uint8Array, name: string, mime: string): Promise<void> {
    await (this.options.download ?? downloadBytes)(bytes, name, mime);
  }

  /** Hands the form's values over as a JSON file. */
  async exportData(): Promise<string> {
    const name = `${fileStem(this.documentName)}-data.json`;
    try {
      await this.#deliver(new TextEncoder().encode(this.exportJson() + "\n"), name, "application/json");
      this.say("info", `Saved the form data as ${name}`);
    } catch (e) {
      this.say("error", `The data could not be saved: ${message(e)}`);
    }
    return name;
  }

  /** Fills the form from JSON text (what `exportData` makes). Says what was filled and what was skipped. */
  importText(text: string): { applied: string[]; skipped: { name: string; reason: string }[] } | null {
    if (this.readOnly) return null;
    this.endBurst();
    try {
      const result = this.session.forms.importData(text);
      const skipped = result.skipped.length ? ` ${result.skipped.length} skipped: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.` : "";
      this.say(result.applied.length || !result.skipped.length ? "info" : "error", `Filled ${result.applied.length} ${result.applied.length === 1 ? "field" : "fields"}.${skipped}`);
      return result;
    } catch (e) {
      this.say("error", message(e));
      return null;
    }
  }

  async importFile(file: Blob): Promise<void> {
    try {
      this.importText(await readText(file));
    } catch (e) {
      this.say("error", `The file could not be read: ${message(e)}`);
    }
  }

  /** The document as it would be saved with the form fields drawn into the pages (the session is not changed). */
  flattenedBytes(): Promise<Uint8Array> {
    return saveBytes(this.session, { flatten: "forms" });
  }

  /**
   * Writes a copy of the document with the form fields drawn into the pages and hands it over: to `onFlatten`, or the
   * viewer's File menu flow (its download hook, notices), or a plain download. The form in this window stays as it is.
   */
  async flatten(): Promise<boolean> {
    this.dialog = null;
    this.emit();
    const name = `${fileStem(this.documentName)}-flattened.pdf`;
    try {
      if (this.options.onFlatten) {
        await this.options.onFlatten(await this.flattenedBytes(), { name });
      } else if (this.files) {
        if (!(await this.files.download("forms", { name, dialog: false }))) return false;
      } else await this.#deliver(await this.flattenedBytes(), name, "application/pdf");
      this.say("info", `Saved a flattened copy as ${name}. The form in this window is unchanged.`);
      return true;
    } catch (e) {
      this.say("error", `The form could not be flattened: ${message(e)}`);
      return false;
    }
  }

  /** A signature field was clicked. */
  sign(field: FormField, widget: Widget): void {
    if (this.readOnly || field.signed) return;
    if (this.options.onSign) this.options.onSign(field, widget);
    else this.announce("Signing is not set up in this viewer");
  }

  // ---- Prepare form ------------------------------------------------------------------------------------------------

  setDesigning(on: boolean): void {
    if (on && this.readOnly) return;
    if (this.designing === on) return;
    this.designing = on;
    this.endBurst();
    this.cancelDraft();
    if (this.view?.tool?.startsWith("form:")) this.view.setTool(null);
    if (!on) (this.selected = null), (this.also = []);
    this.announce(on ? "Prepare form: choose a field type, then draw it on the page" : "Prepare form closed");
  }

  /** The kind of field the active tool draws. */
  get activeKind(): FieldKind | null {
    const t = this.view?.tool;
    return t?.startsWith("form:") ? (t.slice(5) as FieldKind) : null;
  }

  chooseKind(kind: FieldKind | null): void {
    if (!this.designing) this.setDesigning(true);
    this.cancelDraft();
    this.view?.setTool(kind && this.activeKind !== kind ? `form:${kind}` : null);
    if (kind && this.activeKind !== kind) this.announce(kindInfo(kind).hint);
  }

  cancelDraft(): void {
    if (!this.draft && !this.radio) return;
    this.draft = null;
    this.radio = null;
    this.#lastClick = null;
    this.emit();
  }

  beginDraw(kind: FieldKind, e: PagePointerEvent): void {
    this.draft = { kind, page: e.page.id, from: [e.x, e.y], to: [e.x, e.y] };
    this.emit();
  }

  moveDraw(e: PagePointerEvent): void {
    if (!this.draft || this.draft.page !== e.page.id) return;
    this.draft = { ...this.draft, to: [e.x, e.y] };
    this.emit();
  }

  /** The pointer is up: a drag draws a field of that size, a click one of the kind's own size. Returns the new field's id. */
  endDraw(e: PagePointerEvent): string | null {
    const d = this.draft;
    if (!d || d.page !== e.page.id) return null;
    this.draft = null;
    const page = { width: e.width, height: e.height };
    const dragged = Math.hypot(e.x - d.from[0], e.y - d.from[1]) * e.scale >= DRAG_PIXELS;
    const info = kindInfo(d.kind);
    const snapOn = !e.altKey;
    const rect = dragged ? dragRect(d.from, [e.x, e.y], page, { snap: snapOn }) : placeRect([e.x, e.y], info.w, info.h, page, { snap: snapOn });
    if (d.kind === "radio") {
      const prev = this.#lastClick;
      const now = Date.now();
      // A second click on the same spot finishes the group (a double-click).
      if (!dragged && prev && prev.page === d.page && now - prev.time < 600 && Math.hypot(prev.at[0] - e.x, prev.at[1] - e.y) * e.scale < 8 && this.radio?.points.length) {
        this.#lastClick = null;
        return this.finishRadio();
      }
      this.#lastClick = { page: d.page, at: [e.x, e.y], time: now };
      this.radio = { points: [...(this.radio?.points ?? []), { page: d.page, rect }] };
      this.announce(`${this.radio.points.length} ${this.radio.points.length === 1 ? "button" : "buttons"} placed. Press Enter or double-click to finish the group.`);
      return null;
    }
    return this.add(d.kind, d.page, rect);
  }

  /** The unused name a new field of this kind gets. */
  newName(kind: FieldKind): string {
    return freeName(kindInfo(kind).base, (n) => this.session.forms.nameProblem(n) !== undefined);
  }

  /** Adds a field of a kind on a page and selects it. Returns its id (null when it could not be made: the message is announced). */
  add(kind: FieldKind, pageId: string, rect: Rect): string | null {
    if (this.readOnly) return null;
    const info = kindInfo(kind);
    const spec: NewField = { type: info.type, name: this.newName(kind), rect };
    if (kind === "multiline") spec.flags = { multiline: true };
    if (kind === "dropdown" || kind === "list") spec.options = ["Option 1", "Option 2", "Option 3"];
    if (kind === "button") spec.caption = "Button";
    return this.#create(pageId, spec, `${info.label} added`);
  }

  #create(pageId: string, spec: NewField, say: string): string | null {
    this.endBurst();
    try {
      const id = this.session.forms.addField(pageId, spec, { select: true });
      this.selected = this.session.forms.get(id).widgets[0]!.id;
      this.draft = null;
      this.radio = null;
      this.view?.setTool(null);
      this.announce(`${say}: ${spec.name}`);
      return id;
    } catch (e) {
      this.announce(`The field could not be added: ${message(e)}`);
      return null;
    }
  }

  /** Puts a field of the kind in the middle of the page shown (the keyboard's way to add one). */
  addAtCenter(kind: FieldKind): string | null {
    const page = this.session.doc.pages.find((p) => p.id === (this.view?.pageId ?? this.session.selection.page)) ?? this.session.doc.pages[0];
    if (!page) return null;
    if (!this.designing) this.setDesigning(true);
    const info = kindInfo(kind);
    if (kind === "radio") {
      const gap = 24;
      const mid: Pt = [page.width / 2, page.height / 2];
      this.radio = {
        points: [-1, 1].map((s) => ({ page: page.id, rect: placeRect([mid[0] + (s * gap) / 2, mid[1]], info.w, info.h, page) })),
      };
      return this.finishRadio();
    }
    return this.add(kind, page.id, placeRect([page.width / 2, page.height / 2], info.w, info.h, page));
  }

  /** Makes the radio group out of the buttons placed. */
  finishRadio(): string | null {
    const r = this.radio;
    if (!r || r.points.length === 0) return null;
    const first = r.points[0]!;
    const spec: NewField = {
      type: "radio",
      name: this.newName("radio"),
      buttons: r.points.map((p, i) => ({ rect: p.rect, on: `Choice${i + 1}`, ...(p.page !== first.page ? { page: p.page } : {}) })),
    };
    return this.#create(first.page, spec, `Radio group of ${r.points.length} added`);
  }

  // ---- select, move, resize ----------------------------------------------------------------------------------------

  /** Every selected widget, the main one first. */
  get selectedIds(): string[] {
    return this.selected ? [this.selected, ...this.also] : [];
  }

  /** Adds a widget to the selection, or takes it out (Shift or Ctrl/Cmd click). */
  toggleWidget(widgetId: string): void {
    const ids = this.selectedIds;
    const next = ids.includes(widgetId) ? ids.filter((id) => id !== widgetId) : [...ids, widgetId];
    this.selected = next[0] ?? null;
    this.also = next.slice(1);
    const fields = [...new Set(next.map((id) => this.fieldOfWidget(id)?.id).filter((id): id is string => !!id))];
    this.session.select({ fields });
    this.endBurst();
    this.emit();
  }

  /** The selected widgets Align and Distribute work on: those on the page of the main one. */
  arrangeable(): Widget[] {
    const widgets = this.selectedIds.map((id) => this.fieldOfWidget(id)?.widgets.find((w) => w.id === id)).filter((w): w is Widget => !!w);
    const page = widgets[0]?.page;
    return widgets.filter((w) => w.page === page);
  }

  /** Lines the selected fields up (on the page of the main one): one undo step. */
  align(how: Align): void {
    const list = this.arrangeable();
    this.#arrange(alignMoves(list.map((w) => ({ id: w.id, box: w.rect })), how), list, list.length < 2 ? "Select two or more fields to align them" : `${ALIGN_LABEL[how]}: ${list.length} fields`);
  }

  /** Makes the gaps between the selected fields equal: one undo step. */
  distribute(how: Distribute): void {
    const list = this.arrangeable();
    this.#arrange(distributeMoves(list.map((w) => ({ id: w.id, box: w.rect })), how), list, list.length < 3 ? "Select three or more fields to distribute them" : `${DISTRIBUTE_LABEL[how]}: ${list.length} fields`);
  }

  #arrange(moves: readonly Move[], list: readonly Widget[], say: string): void {
    if (this.readOnly || moves.length === 0) return void this.announce(this.readOnly ? "This form is read only" : say);
    const page = this.pageSize(list[0]!.page);
    const by = new Map(moves.map((m) => [m.id, m]));
    const changes = list.flatMap((w) => {
      const m = by.get(w.id);
      if (!m || !page) return [];
      // Kept on the page; an even grid is not forced on them: they line up exactly.
      const x = Math.max(0, Math.min(page.width - w.rect.w, w.rect.x + m.dx));
      const y = Math.max(0, Math.min(page.height - w.rect.h, w.rect.y + m.dy));
      return [{ widget: w.id, rect: { ...w.rect, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } }];
    });
    this.endBurst();
    try {
      this.session.forms.setRects(changes);
    } catch (e) {
      return void this.announce(message(e));
    }
    this.announce(say);
  }

  selectWidget(widgetId: string | null): void {
    if (this.selected === widgetId && this.also.length === 0) return;
    this.also = [];
    this.selected = widgetId;
    const field = widgetId ? this.fieldOfWidget(widgetId) : undefined;
    this.session.select({ fields: field ? [field.id] : [] });
    this.endBurst();
    this.emit();
  }

  selectField(fieldId: string): void {
    const field = this.session.doc.fields.find((f) => f.id === fieldId);
    const w = field?.widgets[0];
    if (!field || !w) return;
    this.selectWidget(w.id);
    this.view?.goToPage(w.page, w.rect.y);
  }

  pageSize(pageId: string): { width: number; height: number } | null {
    const p = this.session.doc.pages.find((x) => x.id === pageId);
    return p ? { width: p.width, height: p.height } : null;
  }

  /** The rectangle a widget is drawn at: where the pointer has dragged it, or where it is. */
  rectOf(widget: Widget): Rect {
    return this.preview.get(widget.id) ?? widget.rect;
  }

  setPreview(widgetId: string, rect: Rect | null): void {
    if (rect) this.preview.set(widgetId, rect);
    else this.preview.delete(widgetId);
    this.emit();
  }

  /** Puts a widget at a rectangle (one undo step; arrow-key runs on one widget share one). */
  setRect(widgetId: string, rect: Rect, burstKey?: string): string | null {
    if (this.readOnly) return "This form is read only";
    const key = burstKey ? `r:${widgetId}:${burstKey}` : null;
    try {
      this.session.forms.setRect(widgetId, rect, undefined, { merge: key ? this.#joins(key) : false });
    } catch (e) {
      return message(e);
    }
    this.#remember(key);
    return null;
  }

  /** Moves the selected widget by points (arrow keys). */
  nudge(dx: number, dy: number): void {
    const s = this.selection;
    if (!s) return;
    if (this.also.length > 0) {
      // Several selected: they move together, as one box kept on the page.
      const list = this.arrangeable();
      const page = this.pageSize(s.widget.page);
      if (!page || list.length === 0) return;
      const x0 = Math.min(...list.map((w) => w.rect.x));
      const y0 = Math.min(...list.map((w) => w.rect.y));
      const x1 = Math.max(...list.map((w) => w.rect.x + w.rect.w));
      const y1 = Math.max(...list.map((w) => w.rect.y + w.rect.h));
      const mx = Math.max(-x0, Math.min(page.width - x1, dx));
      const my = Math.max(-y0, Math.min(page.height - y1, dy));
      if (mx === 0 && my === 0) return;
      this.endBurst();
      this.session.forms.setRects(list.map((w) => ({ widget: w.id, rect: { ...w.rect, x: w.rect.x + mx, y: w.rect.y + my } })));
      return;
    }
    const page = this.pageSize(s.widget.page);
    if (!page) return;
    const r = s.widget.rect;
    const x = Math.max(0, Math.min(page.width - r.w, r.x + dx));
    const y = Math.max(0, Math.min(page.height - r.h, r.y + dy));
    if (x === r.x && y === r.y) return;
    this.setRect(s.widget.id, { ...r, x, y }, "move");
  }

  /** Makes the selected widget wider or taller by points (Alt+arrow keys). */
  resizeBy(dw: number, dh: number): void {
    const s = this.selection;
    if (!s) return;
    const page = this.pageSize(s.widget.page);
    if (!page) return;
    const r = s.widget.rect;
    const w = Math.max(4, Math.min(page.width - r.x, r.w + dw));
    const h = Math.max(4, Math.min(page.height - r.y, r.h + dh));
    if (w === r.w && h === r.h) return;
    this.setRect(s.widget.id, { ...r, w, h }, "size");
  }

  /** Finishes a move or resize by the pointer: the rectangle is snapped and kept on the page. */
  commitRect(widgetId: string, rect: Rect, snapOn: boolean, resizing: boolean): void {
    this.setPreview(widgetId, null);
    const field = this.fieldOfWidget(widgetId);
    const widget = field?.widgets.find((w) => w.id === widgetId);
    const page = widget ? this.pageSize(widget.page) : null;
    if (!widget || !page) return;
    const next = resizing ? snapRect(rect, page, { snap: snapOn }) : moveRect(widget.rect, rect.x - widget.rect.x, rect.y - widget.rect.y, page, { snap: snapOn });
    if (next.x === widget.rect.x && next.y === widget.rect.y && next.w === widget.rect.w && next.h === widget.rect.h) return;
    this.endBurst();
    const problem = this.setRect(widgetId, next);
    if (problem) this.announce(problem);
    else this.announce(`${field ? fieldLabel(field) : "Field"} ${resizing ? "resized" : "moved"}`);
  }

  /** Deletes the selected widget; a radio group goes with its last button. */
  removeSelected(): void {
    const s = this.selection;
    if (!s || this.readOnly) return;
    this.endBurst();
    if (this.also.length > 0) {
      // Several selected: all of their fields go, in one step.
      const ids = [...new Set(this.selectedIds.map((id) => this.fieldOfWidget(id)?.id).filter((id): id is string => !!id))];
      this.session.forms.remove(ids);
      this.selected = null;
      this.also = [];
      this.announce(`${ids.length} fields deleted`);
      return;
    }
    const { field, widget } = s;
    if (field.type === "radio" && field.widgets.length > 1) {
      const widgets = field.widgets.filter((w) => w.id !== widget.id);
      const value = field.value === widget.on ? null : field.value;
      this.session.transact([{ type: "replace_field", field: { ...field, widgets, value } }], { selection: { fields: [field.id] } });
      this.selected = widgets[0]!.id;
      this.announce(`Button ${widget.on ?? ""} removed from ${field.name}`);
      return;
    }
    this.removeField(field.id);
  }

  /** Deletes a whole field. */
  removeField(fieldId: string): void {
    const field = this.session.doc.fields.find((f) => f.id === fieldId);
    if (!field || this.readOnly) return;
    this.endBurst();
    this.session.forms.remove([fieldId]);
    if (this.selected && !this.fieldOfWidget(this.selected)) this.selected = null;
    this.also = this.also.filter((id) => !!this.fieldOfWidget(id));
    this.announce(`${field.name} deleted`);
  }

  /** Copies the selected field (the whole radio group) a little way down and to the right, and selects the copy. */
  duplicate(): string | null {
    const s = this.selection;
    if (!s || this.readOnly) return null;
    const { field } = s;
    const taken = (n: string) => this.session.forms.nameProblem(n) !== undefined;
    const name = copyName(field.name, taken);
    const widgetsOf = field.widgets.map((w) => {
      const page = this.pageSize(w.page);
      const r = page ? moveRect(w.rect, 12, 12, page) : w.rect;
      return { rect: r, on: w.on, page: w.page };
    });
    const first = widgetsOf[0]!;
    const spec: NewField = {
      type: field.type,
      name,
      ...(field.type === "radio" ? { buttons: widgetsOf.map((w) => ({ rect: w.rect, on: w.on, page: w.page })) } : { rect: first.rect }),
      ...(field.type === "checkbox" && first.on ? { on: first.on } : {}),
      ...(field.options ? { options: field.options.map((o) => ({ ...o })) } : {}),
      ...(field.flags ? { flags: { ...field.flags } } : {}),
      ...(field.tooltip ? { tooltip: field.tooltip } : {}),
      ...(field.appearance ? { appearance: { ...field.appearance } } : {}),
      ...(field.caption !== undefined ? { caption: field.caption } : {}),
      ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
      ...(field.value !== null && field.type !== "radio" ? { value: field.value } : {}),
    };
    return this.#create(first.page, spec, "Duplicated");
  }

  // ---- properties --------------------------------------------------------------------------------------------------

  /** Changes a field (see `session.forms.update`). Edits with the same `burst` key on one field are one undo step. Returns the message when refused. */
  patch(
    fieldId: string,
    patch: { name?: string; value?: unknown; defaultValue?: FormField["value"]; options?: { value: string; label?: string }[] | null; flags?: { [K in keyof FieldFlags]?: FieldFlags[K] | undefined }; tooltip?: string | null; appearance?: { [K in keyof FieldAppearance]?: FieldAppearance[K] | undefined }; caption?: string | null },
    burst?: string,
  ): string | null {
    if (this.readOnly) return "This form is read only";
    const key = burst ? `p:${fieldId}:${burst}` : null;
    try {
      this.session.forms.update(fieldId, patch, { merge: key ? this.#joins(key) : false });
    } catch (e) {
      return message(e);
    }
    this.#remember(key);
    return null;
  }

  /** Changes what a radio button or a check box stands for when on. */
  setOn(fieldId: string, widgetId: string, on: string, burst = "on"): string | null {
    const field = this.session.doc.fields.find((f) => f.id === fieldId);
    const widget = field?.widgets.find((w) => w.id === widgetId);
    if (!field || !widget || this.readOnly) return "This form is read only";
    if (on === "" || on === "Off") return "A button's value cannot be empty or Off";
    if (field.widgets.some((w) => w.id !== widgetId && w.on === on)) return `Two buttons stand for "${on}"`;
    const key = `p:${fieldId}:${burst}:${widgetId}`;
    const widgets = field.widgets.map((w) => (w.id === widgetId ? { ...w, on } : w));
    const value = field.type === "radio" && field.value === widget.on ? on : field.value;
    const defaultValue = field.type === "radio" && field.defaultValue === widget.on ? on : field.defaultValue;
    const ops: PdfOp[] = [{ type: "replace_field", field: { ...field, widgets, value, ...(defaultValue !== undefined ? { defaultValue } : {}) } }];
    this.session.transact(ops, { merge: this.#joins(key) });
    this.#remember(key);
    return null;
  }
}

/** Re-renders when the controller changes (a mode, a draft, the selection, the live message). */
export function useFormController(c: FormController): number {
  return useSyncExternalStore(c.subscribe, c.getVersion, c.getVersion);
}

