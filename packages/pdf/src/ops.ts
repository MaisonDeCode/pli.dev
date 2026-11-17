import { PliError, type Reducer, type Thread } from "@pli.dev/core";
import type { Annotation, FormField, OutlineItem, Page, PageEdit, PdfAnchor, PdfDoc, PdfMeta, Rotation, Source } from "./model";

/** What `patch_page` can change. A field set to `null` is removed. */
export interface PagePatch {
  rotate?: Rotation;
  label?: string | null;
  width?: number;
  height?: number;
}

/**
 * Every change to a PDF is one of these JSON operations. They are invertible, so history works, and serializable,
 * so they can be logged, stored and sent to other people. Pages, annotations and fields are named by id.
 */
export type PdfOp =
  | { type: "set_meta"; patch: { [K in keyof PdfMeta]?: string | null } & { name?: string | null } }
  | { type: "insert_source"; source: Source }
  | { type: "remove_source"; id: string }
  | { type: "patch_source"; id: string; patch: Partial<Omit<Source, "id">> }
  /**
   * Puts a page after the page `after` (null: first; left out: last). Positions are named by the page they follow, not
   * by number, so changes made at the same time by different people still land where each meant them.
   */
  | { type: "insert_page"; page: Page; after?: string | null }
  /** `prev` is the page it followed (set by the reducer's inverse and by commands), so that undo puts it back. */
  | { type: "remove_page"; id: string; prev?: string | null }
  | { type: "move_page"; id: string; after: string | null }
  | { type: "patch_page"; id: string; patch: PagePatch }
  /** Puts an annotation on a page, above the annotation `after` (null: at the bottom; left out: on top, but commands always say which, so that insertions made at the same time by different people merge). */
  | { type: "insert_annot"; page: string; annot: Annotation; after?: string | null }
  | { type: "remove_annot"; page: string; id: string; prev?: string | null }
  /** Replaces the annotation with the same id, wherever it is. */
  | { type: "replace_annot"; annot: Annotation }
  /** Changes the drawing order of an annotation on its page: puts it above `after` (null: at the bottom). */
  | { type: "move_annot"; id: string; after: string | null }
  | { type: "insert_field"; field: FormField; after?: string | null }
  | { type: "remove_field"; id: string; prev?: string | null }
  /** Replaces the field with the same id (its widgets, options and flags too). */
  | { type: "replace_field"; field: FormField }
  | { type: "set_value"; id: string; value: FormField["value"] }
  /** Replaces the whole outline. */
  | { type: "set_outline"; items: OutlineItem[] }
  /** Replaces a page's content edits. */
  | { type: "set_edits"; page: string; edits: PageEdit[] }
  /** Sets (or with null removes) a comment thread kept in the document. */
  | { type: "set_thread"; id: string; thread: Thread<PdfAnchor> | null };

function missing(what: string, id: string): never {
  throw new PliError("not_found", `${what} ${id} not found`);
}

function bad(message: string): never {
  throw new PliError("invalid_operation", message);
}

/** The page and index of an annotation, or undefined. */
export function findAnnot(doc: PdfDoc, id: string): { page: Page; pageIndex: number; index: number } | undefined {
  for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
    const page = doc.pages[pageIndex]!;
    const index = page.annots.findIndex((a) => a.id === id);
    if (index >= 0) return { page, pageIndex, index };
  }
  return undefined;
}

const pageIndex = (doc: PdfDoc, id: string): number => {
  const i = doc.pages.findIndex((p) => p.id === id);
  return i < 0 ? missing("page", id) : i;
};

const withPage = (doc: PdfDoc, index: number, page: Page): PdfDoc => ({ ...doc, pages: doc.pages.map((p, i) => (i === index ? page : p)) });

/** Puts `item` after the entry with id `after` (first if null, last if undefined or not found). */
function insertAfter<T extends { id: string }>(list: readonly T[], item: T, after: string | null | undefined): T[] {
  let at = list.length;
  if (after === null) at = 0;
  else if (after !== undefined) {
    const i = list.findIndex((x) => x.id === after);
    if (i >= 0) at = i + 1;
  }
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** The id of the entry before position `i`, or null at the start. */
const prevOf = <T extends { id: string }>(list: readonly T[], i: number): string | null => list[i - 1]?.id ?? null;

/** Applies `patch` and returns the patch that puts the old values back. `null` removes a key. */
function patchObject<T extends object>(target: T, patch: Record<string, unknown>): { next: T; undo: Record<string, unknown> } {
  const next: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  const undo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const old = (target as Record<string, unknown>)[key];
    undo[key] = old === undefined ? null : old;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return { next: next as T, undo };
}

export const pdfReducer: Reducer<PdfDoc, PdfOp> = {
  apply(doc, op) {
    switch (op.type) {
      case "set_meta": {
        const { name, ...meta } = op.patch;
        const m = patchObject(doc.meta, meta);
        const undo: PdfOp & { type: "set_meta" } = { type: "set_meta", patch: m.undo as never };
        let next: PdfDoc = { ...doc, meta: m.next };
        if (name !== undefined) {
          undo.patch.name = doc.name ?? null;
          const { name: _old, ...rest } = next;
          next = name === null ? rest : { ...rest, name };
        }
        return { state: next, inverse: undo };
      }
      case "insert_source": {
        if (doc.sources.some((s) => s.id === op.source.id)) bad(`source ${op.source.id} exists`);
        return { state: { ...doc, sources: [...doc.sources, op.source] }, inverse: { type: "remove_source", id: op.source.id } };
      }
      case "remove_source": {
        const source = doc.sources.find((s) => s.id === op.id) ?? missing("source", op.id);
        return { state: { ...doc, sources: doc.sources.filter((s) => s !== source) }, inverse: { type: "insert_source", source } };
      }
      case "patch_source": {
        const source = doc.sources.find((s) => s.id === op.id) ?? missing("source", op.id);
        const p = patchObject(source, op.patch as Record<string, unknown>);
        return { state: { ...doc, sources: doc.sources.map((s) => (s === source ? p.next : s)) }, inverse: { type: "patch_source", id: op.id, patch: p.undo } };
      }
      case "insert_page": {
        if (doc.pages.some((p) => p.id === op.page.id)) bad(`page ${op.page.id} exists`);
        return { state: { ...doc, pages: insertAfter(doc.pages, op.page, op.after) }, inverse: { type: "remove_page", id: op.page.id } };
      }
      case "remove_page": {
        const i = pageIndex(doc, op.id);
        const page = doc.pages[i]!;
        return { state: { ...doc, pages: doc.pages.filter((_, j) => j !== i) }, inverse: { type: "insert_page", page, after: prevOf(doc.pages, i) } };
      }
      case "move_page": {
        const i = pageIndex(doc, op.id);
        const page = doc.pages[i]!;
        const rest = doc.pages.filter((_, j) => j !== i);
        return { state: { ...doc, pages: insertAfter(rest, page, op.after === op.id ? prevOf(doc.pages, i) : op.after) }, inverse: { type: "move_page", id: op.id, after: prevOf(doc.pages, i) } };
      }
      case "patch_page": {
        const i = pageIndex(doc, op.id);
        const p = patchObject(doc.pages[i]!, op.patch as Record<string, unknown>);
        return { state: withPage(doc, i, p.next), inverse: { type: "patch_page", id: op.id, patch: p.undo as PagePatch } };
      }
      case "insert_annot": {
        const i = pageIndex(doc, op.page);
        if (findAnnot(doc, op.annot.id)) bad(`annotation ${op.annot.id} exists`);
        const page = doc.pages[i]!;
        return { state: withPage(doc, i, { ...page, annots: insertAfter(page.annots, op.annot, op.after) }), inverse: { type: "remove_annot", page: op.page, id: op.annot.id } };
      }
      case "remove_annot": {
        const i = pageIndex(doc, op.page);
        const page = doc.pages[i]!;
        const index = page.annots.findIndex((a) => a.id === op.id);
        if (index < 0) missing("annotation", op.id);
        return { state: withPage(doc, i, { ...page, annots: page.annots.filter((_, j) => j !== index) }), inverse: { type: "insert_annot", page: op.page, annot: page.annots[index]!, after: prevOf(page.annots, index) } };
      }
      case "replace_annot": {
        const found = findAnnot(doc, op.annot.id) ?? missing("annotation", op.annot.id);
        const annots = found.page.annots.map((a, j) => (j === found.index ? op.annot : a));
        return { state: withPage(doc, found.pageIndex, { ...found.page, annots }), inverse: { type: "replace_annot", annot: found.page.annots[found.index]! } };
      }
      case "move_annot": {
        const found = findAnnot(doc, op.id) ?? missing("annotation", op.id);
        const annot = found.page.annots[found.index]!;
        const rest = found.page.annots.filter((_, j) => j !== found.index);
        const before = prevOf(found.page.annots, found.index);
        return { state: withPage(doc, found.pageIndex, { ...found.page, annots: insertAfter(rest, annot, op.after === op.id ? before : op.after) }), inverse: { type: "move_annot", id: op.id, after: before } };
      }
      case "insert_field": {
        if (doc.fields.some((f) => f.id === op.field.id)) bad(`field ${op.field.id} exists`);
        return { state: { ...doc, fields: insertAfter(doc.fields, op.field, op.after) }, inverse: { type: "remove_field", id: op.field.id } };
      }
      case "remove_field": {
        const index = doc.fields.findIndex((f) => f.id === op.id);
        if (index < 0) missing("field", op.id);
        return { state: { ...doc, fields: doc.fields.filter((_, j) => j !== index) }, inverse: { type: "insert_field", field: doc.fields[index]!, after: prevOf(doc.fields, index) } };
      }
      case "replace_field": {
        const index = doc.fields.findIndex((f) => f.id === op.field.id);
        if (index < 0) missing("field", op.field.id);
        return { state: { ...doc, fields: doc.fields.map((f, j) => (j === index ? op.field : f)) }, inverse: { type: "replace_field", field: doc.fields[index]! } };
      }
      case "set_value": {
        const index = doc.fields.findIndex((f) => f.id === op.id);
        if (index < 0) missing("field", op.id);
        const field = doc.fields[index]!;
        return { state: { ...doc, fields: doc.fields.map((f, j) => (j === index ? { ...field, value: op.value } : f)) }, inverse: { type: "set_value", id: op.id, value: field.value } };
      }
      case "set_outline":
        return { state: { ...doc, outline: op.items }, inverse: { type: "set_outline", items: doc.outline } };
      case "set_thread": {
        const previous = doc.comments?.[op.id] ?? null;
        const { [op.id]: _removed, ...others } = doc.comments ?? {};
        const comments = op.thread ? { ...others, [op.id]: op.thread } : others;
        const { comments: _old, ...rest } = doc;
        return { state: Object.keys(comments).length > 0 ? { ...rest, comments } : rest, inverse: { type: "set_thread", id: op.id, thread: previous } };
      }
      case "set_edits": {
        const i = pageIndex(doc, op.page);
        const page = doc.pages[i]!;
        const old = page.edits ?? [];
        const { edits: _e, ...rest } = page;
        const next: Page = op.edits.length > 0 ? { ...rest, edits: op.edits } : rest;
        return { state: withPage(doc, i, next), inverse: { type: "set_edits", page: op.page, edits: old } };
      }
    }
  },
};

/** The ids of every annotation in the document. */
export function annotIds(doc: PdfDoc): Set<string> {
  const ids = new Set<string>();
  for (const page of doc.pages) for (const a of page.annots) ids.add(a.id);
  return ids;
}
