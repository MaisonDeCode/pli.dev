import { createId, PliError } from "@pli.dev/core";
import { bounds, hitTest, resizeTo, translate } from "../annots/geometry";
import type { Annotation, LineEnd, NoteAnnot, PdfPicture, Pt, Rect, StrokeStyle, TextStyle } from "../model";
import { findAnnot } from "../ops";
import type { PdfSession } from "../session";

/** An annotation as you make it: the id, author and times are filled in. */
export type NewAnnotation = Annotation extends infer A ? (A extends Annotation ? Omit<A, "id"> & { id?: string } : never) : never;

/** Options every builder takes. */
export interface AddOptions {
  /** The text readers show for the annotation. */
  contents?: string;
  opacity?: number;
  /** Select the new annotation (default true). */
  select?: boolean;
  /** Join this change with the last one in the undo history (for drawing that goes on). */
  merge?: boolean;
  id?: string;
  /** A signature: the name of the signature field it signs (see `session.forms.sign`, which also places and fits it). */
  field?: string;
}

export interface StrokeOptions {
  color?: string;
  width?: number;
  dash?: number[];
}

/** What `restyle` can change; each annotation type takes the parts that apply to it. */
export interface Restyle extends StrokeOptions {
  /** `null` removes the fill. */
  fill?: string | null;
  opacity?: number;
  /** Text boxes. */
  size?: number;
  family?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
}

export type SignatureInput =
  | { mode: "draw"; strokes: Pt[][]; color?: string; width?: number }
  | { mode: "type"; text: string; font?: string; color?: string }
  | { mode: "image"; picture: PdfPicture };

const DEFAULT_COLOR = { highlight: "#ffeb3b", underline: "#1e88e5", strikeout: "#e53935", squiggly: "#e53935" } as const;
const stroke = (o: StrokeOptions, color: string, width: number): StrokeStyle => ({ color: o.color ?? color, width: o.width ?? width, ...(o.dash && o.dash.length > 0 ? { dash: o.dash } : {}) });

/** Commands on annotations: `session.annots`. */
export class AnnotCommands {
  constructor(protected readonly session: PdfSession) {}

  /** Puts an annotation on a page and selects it. Returns its id. */
  add(pageId: string, annot: NewAnnotation, options: { select?: boolean; merge?: boolean } = {}): string {
    const s = this.session;
    if (!s.doc.pages.some((p) => p.id === pageId)) throw new PliError("not_found", `page ${pageId} not found`);
    const now = s.now();
    const user = s.options.user;
    const full = {
      ...annot,
      id: annot.id ?? createId("a_"),
      created: annot.created ?? now,
      modified: annot.modified ?? now,
      ...(user && annot.author === undefined ? { author: user.id } : {}),
      ...(user?.name && annot.authorName === undefined ? { authorName: user.name } : {}),
    } as Annotation;
    const page = s.doc.pages.find((p) => p.id === pageId)!;
    const top = page.annots[page.annots.length - 1]?.id ?? null;
    s.transact([{ type: "insert_annot", page: pageId, annot: full, after: top }], { selection: options.select === false ? undefined : { page: pageId, annots: [full.id] }, merge: options.merge });
    return full.id;
  }

  get(id: string): Annotation | undefined {
    const found = findAnnot(this.session.doc, id);
    return found?.page.annots[found.index];
  }

  /** Changes some properties of an annotation. */
  update(id: string, patch: Partial<Annotation>, options: { merge?: boolean } = {}): void {
    const found = findAnnot(this.session.doc, id);
    if (!found) throw new PliError("not_found", `annotation ${id} not found`);
    const current = found.page.annots[found.index]!;
    const next = { ...current, ...patch, id, modified: this.session.now() } as Annotation;
    this.session.transact([{ type: "replace_annot", annot: next }], { merge: options.merge });
  }

  /** Removes annotations. */
  remove(ids: readonly string[]): void {
    const doc = this.session.doc;
    const ops = ids.flatMap((id) => {
      const found = findAnnot(doc, id);
      return found ? [{ type: "remove_annot" as const, page: found.page.id, id }] : [];
    });
    this.session.transact(ops, { selection: { annots: this.session.selection.annots.filter((a) => !ids.includes(a)) } });
  }

  /** Every annotation of a page, bottom to top. */
  list(pageId: string): readonly Annotation[] {
    return this.session.doc.pages.find((p) => p.id === pageId)?.annots ?? [];
  }

  // ---- Builders -------------------------------------------------------------------------------------------------

  #common(o: AddOptions): { id?: string; contents?: string; opacity?: number } {
    return { ...(o.id ? { id: o.id } : {}), ...(o.contents ? { contents: o.contents } : {}), ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) };
  }

  /** Marks text: one rectangle per line. `type` is `highlight` (default), `underline`, `strikeout` or `squiggly`. */
  addHighlight(pageId: string, rects: Rect[], options: AddOptions & { type?: "highlight" | "underline" | "strikeout" | "squiggly"; color?: string; quote?: string } = {}): string {
    const type = options.type ?? "highlight";
    return this.add(pageId, { ...this.#common(options), type, color: options.color ?? DEFAULT_COLOR[type], rects, ...(options.quote ? { quote: options.quote } : {}) }, options);
  }

  /** Freehand drawing: strokes are lists of points. */
  addInk(pageId: string, strokes: Pt[][], options: AddOptions & StrokeOptions = {}): string {
    return this.add(pageId, { ...this.#common(options), type: "ink", strokes, stroke: stroke(options, "#000000", 2) }, options);
  }

  /** A rectangle or an ellipse. */
  addShape(pageId: string, kind: "square" | "circle", rect: Rect, options: AddOptions & StrokeOptions & { fill?: string } = {}): string {
    return this.add(pageId, { ...this.#common(options), type: kind, rect, stroke: stroke(options, "#e53935", 2), ...(options.fill ? { fill: options.fill } : {}) }, options);
  }

  /** A line, with an arrow or other mark at either end. */
  addLine(pageId: string, from: Pt, to: Pt, options: AddOptions & StrokeOptions & { startEnd?: LineEnd; endEnd?: LineEnd } = {}): string {
    return this.add(pageId, { ...this.#common(options), type: "line", from, to, stroke: stroke(options, "#e53935", 2), ...(options.startEnd ? { startEnd: options.startEnd } : {}), ...(options.endEnd ? { endEnd: options.endEnd } : {}) }, options);
  }

  /** A polygon (`closed`, the default) or a polyline. */
  addPoly(pageId: string, points: Pt[], options: AddOptions & StrokeOptions & { closed?: boolean; fill?: string } = {}): string {
    const type = options.closed === false ? "polyline" : "polygon";
    return this.add(pageId, { ...this.#common(options), type, points, stroke: stroke(options, "#e53935", 2), ...(options.fill ? { fill: options.fill } : {}) }, options);
  }

  /** A text box. */
  addFreeText(pageId: string, rect: Rect, text: string, options: AddOptions & Partial<TextStyle> & { fill?: string; stroke?: StrokeStyle } = {}): string {
    const style: TextStyle = { family: options.family ?? "Helvetica", size: options.size ?? 14, color: options.color ?? "#000000", ...(options.bold ? { bold: true } : {}), ...(options.italic ? { italic: true } : {}), ...(options.align ? { align: options.align } : {}) };
    return this.add(pageId, { ...this.#common(options), type: "freetext", rect, text, style, ...(options.fill ? { fill: options.fill } : {}), ...(options.stroke ? { stroke: options.stroke } : {}) }, options);
  }

  /** A sticky note without a comment thread (use `session.comments.addNote` for one with a conversation). */
  addNote(pageId: string, x: number, y: number, text: string, options: AddOptions & { icon?: NoteAnnot["icon"]; color?: string } = {}): string {
    return this.add(pageId, { ...this.#common(options), type: "note", x, y, contents: text, icon: options.icon ?? "note", ...(options.color ? { color: options.color } : {}) }, options);
  }

  /** A stamp: a standard one by name (`Approved`, `Draft`, `NotApproved`, ...), one with a label of your own, or a picture. */
  addStamp(pageId: string, rect: Rect, stamp: string | { name: string; label?: string; color?: string } | { picture: PdfPicture }, options: AddOptions = {}): string {
    return this.add(pageId, { ...this.#common(options), type: "stamp", rect, stamp: typeof stamp === "string" ? { name: stamp } : stamp }, options);
  }

  /** A signature, drawn (strokes relative to the box), typed or from a picture. */
  addSignature(pageId: string, rect: Rect, signature: SignatureInput, options: AddOptions = {}): string {
    const base = { ...this.#common(options), type: "signature" as const, rect, ...(options.field ? { field: options.field } : {}) };
    if (signature.mode === "draw") return this.add(pageId, { ...base, mode: "draw", strokes: signature.strokes, ...(signature.color ? { color: signature.color } : {}), ...(signature.width ? { width: signature.width } : {}) }, options);
    if (signature.mode === "type") return this.add(pageId, { ...base, mode: "type", text: signature.text, ...(signature.font ? { font: signature.font } : {}), ...(signature.color ? { color: signature.color } : {}) }, options);
    return this.add(pageId, { ...base, mode: "image", picture: signature.picture }, options);
  }

  /** A picture on the page (PNG or JPEG as a data URI). */
  addImage(pageId: string, rect: Rect, picture: PdfPicture, options: AddOptions = {}): string {
    return this.add(pageId, { ...this.#common(options), type: "image", rect, picture }, options);
  }

  /** A link to a web address (`{ uri }`) or to a page of this document (`{ page, y? }`). */
  addLink(pageId: string, rect: Rect, target: { uri: string } | { page: string; y?: number }, options: AddOptions = {}): string {
    return this.add(pageId, { ...this.#common(options), type: "link", rect, ..."uri" in target ? { uri: target.uri } : { dest: { page: target.page, ...(target.y !== undefined ? { y: target.y } : {}) } } }, options);
  }

  /** Marks areas for redaction: they show a box until the redactions are applied. */
  markRedaction(pageId: string, rects: Rect[], options: AddOptions & { fill?: string; overlay?: string } = {}): string {
    return this.add(pageId, { ...this.#common(options), type: "redact", rects, ...(options.fill ? { fill: options.fill } : {}), ...(options.overlay ? { overlay: options.overlay } : {}) }, options);
  }

  // ---- Editing --------------------------------------------------------------------------------------------------

  /** The text of an annotation: a text box's text, a typed signature's name, otherwise the comment text. */
  setText(id: string, text: string, options: { merge?: boolean } = {}): void {
    const a = this.#need(id);
    if (a.type === "freetext") this.update(id, { text }, options);
    else if (a.type === "signature") this.update(id, { text }, options);
    else this.update(id, { contents: text }, options);
  }

  /** Changes colours, line and text style: the parts that apply to the annotation's type. */
  restyle(id: string, style: Restyle, options: { merge?: boolean } = {}): void {
    const a = this.#need(id);
    const patch: Record<string, unknown> = {};
    if (style.opacity !== undefined) patch.opacity = style.opacity;
    const withStroke = (s: StrokeStyle): StrokeStyle => {
      const next: StrokeStyle = { ...s, ...(style.color ? { color: style.color } : {}), ...(style.width !== undefined ? { width: style.width } : {}) };
      if (style.dash) {
        if (style.dash.length > 0) next.dash = style.dash;
        else delete next.dash;
      }
      return next;
    };
    const fill = (): void => {
      if (style.fill === null) patch.fill = undefined;
      else if (style.fill) patch.fill = style.fill;
    };
    switch (a.type) {
      case "highlight":
      case "underline":
      case "strikeout":
      case "squiggly":
        if (style.color) patch.color = style.color;
        break;
      case "ink":
      case "line":
        patch.stroke = withStroke(a.stroke);
        break;
      case "square":
      case "circle":
      case "polygon":
      case "polyline":
        patch.stroke = withStroke(a.stroke);
        fill();
        break;
      case "freetext": {
        patch.style = { ...a.style, ...(style.color ? { color: style.color } : {}), ...(style.size ? { size: style.size } : {}), ...(style.family ? { family: style.family } : {}), ...(style.bold !== undefined ? { bold: style.bold || undefined } : {}), ...(style.italic !== undefined ? { italic: style.italic || undefined } : {}), ...(style.align ? { align: style.align } : {}) };
        fill();
        if (style.width !== undefined) patch.stroke = style.width > 0 ? { color: a.stroke?.color ?? "#000000", ...a.stroke, width: style.width } : undefined;
        break;
      }
      case "note":
        if (style.color) patch.color = style.color;
        break;
      case "stamp":
        if (!("picture" in a.stamp) && style.color) patch.stamp = { ...a.stamp, color: style.color };
        break;
      case "signature":
        if (style.color) patch.color = style.color;
        if (style.width !== undefined) patch.width = style.width;
        break;
      case "redact":
        if (style.fill) patch.fill = style.fill;
        break;
      default:
        break;
    }
    const clean = Object.fromEntries(Object.entries(patch));
    const found = findAnnot(this.session.doc, id)!;
    const current = found.page.annots[found.index]!;
    const next = { ...current, ...clean, id, modified: this.session.now() } as Record<string, unknown>;
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
    this.session.transact([{ type: "replace_annot", annot: next as unknown as Annotation }], { merge: options.merge });
  }

  /** Moves annotations by (dx, dy) in page space, as one undo step (`merge` joins it with the last one, for dragging). */
  moveBy(ids: readonly string[], dx: number, dy: number, options: { merge?: boolean } = {}): void {
    const now = this.session.now();
    const ops = ids.flatMap((id) => {
      const a = this.get(id);
      return a ? [{ type: "replace_annot" as const, annot: { ...translate(a, dx, dy), modified: now } }] : [];
    });
    this.session.transact(ops, { merge: options.merge });
  }

  /** Stretches an annotation so that what covered `bounds(annot)` covers `rect` (see `resizeTo`). */
  resize(id: string, rect: Rect, options: { merge?: boolean } = {}): void {
    const a = this.#need(id);
    this.session.transact([{ type: "replace_annot", annot: { ...resizeTo(a, rect), modified: this.session.now() } }], { merge: options.merge });
  }

  /** Moves an annotation in the drawing order: `after` is the annotation it goes above (null: the bottom). */
  reorder(id: string, after: string | null): void {
    this.#need(id);
    this.session.transact([{ type: "move_annot", id, after }]);
  }

  bringToFront(id: string): void {
    const found = findAnnot(this.session.doc, id);
    if (!found) throw new PliError("not_found", `annotation ${id} not found`);
    const last = found.page.annots[found.page.annots.length - 1];
    if (last && last.id !== id) this.reorder(id, last.id);
  }

  sendToBack(id: string): void {
    this.reorder(id, null);
  }

  /** The box around an annotation, in page space. */
  bounds(id: string): Rect {
    return bounds(this.#need(id));
  }

  /** The topmost annotation at a point of a page (within `tolerance` points), for selecting with the pointer. */
  at(pageId: string, point: Pt, tolerance = 3): Annotation | undefined {
    const list = this.list(pageId);
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i]!;
      if (!a.hidden && hitTest(a, point, tolerance)) return a;
    }
    return undefined;
  }

  #need(id: string): Annotation {
    const a = this.get(id);
    if (!a) throw new PliError("not_found", `annotation ${id} not found`);
    return a;
  }
}
