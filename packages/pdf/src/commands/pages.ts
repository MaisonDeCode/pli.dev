import { createId, PliError } from "@pli.dev/core";
import type { PdfFile } from "../cos/file";
import type { Annotation, Page, Rotation } from "../model";
import type { PdfOp } from "../ops";
import { pdfFromImages, type ImageInput, type PdfFromImagesOptions } from "../pages/images";
import { extractPages, insertFromSource, splitPages, splitPlan, type InsertFromOptions, type SplitSpec } from "../pages/merge";
import { pruneOutline } from "../pages/outline";
import type { SaveOptions } from "../save";
import type { PdfSession } from "../session";

/** Letter, in points. */
export const LETTER = { width: 612, height: 792 } as const;

export interface InsertImagesOptions extends PdfFromImagesOptions {
  /** The position (0 first, default: the end) where the first new page goes. */
  at?: number;
  /** Instead of `at`: the page the new pages follow (`null`: at the start). */
  after?: string | null;
}

export type NumberingStyle = "decimal" | "roman" | "ROMAN" | "alpha" | "ALPHA";

const ROMAN: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

function numberLabel(style: NumberingStyle, n: number): string {
  if (style === "decimal") return String(n);
  if (style === "roman" || style === "ROMAN") {
    let s = "";
    let rest = n;
    for (const [v, t] of ROMAN) while (rest >= v) (s += t), (rest -= v);
    return style === "ROMAN" ? s.toUpperCase() : s;
  }
  const s = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
  return style === "ALPHA" ? s.toUpperCase() : s;
}

/** A copy of an annotation for a duplicated page: a new id, not tied to the object it was read from, not part of a comment thread (its own text stays). */
function cloneAnnot(a: Annotation): Annotation {
  const { ref: _ref, thread: _thread, replies: _replies, resolved: _resolved, ...rest } = a;
  return { ...rest, id: createId("a_") } as Annotation;
}

/** Commands on pages: `session.pages`. */
export class PageCommands {
  constructor(protected readonly session: PdfSession) {}

  /** The page with this id. */
  get(id: string): Page {
    const page = this.session.doc.pages.find((p) => p.id === id);
    if (!page) throw new PliError("not_found", `page ${id} not found`);
    return page;
  }

  index(id: string): number {
    return this.session.doc.pages.findIndex((p) => p.id === id);
  }

  /** Turns pages a quarter turn at a time (`90` clockwise, `-90` anticlockwise). */
  rotate(ids: readonly string[], degrees: 90 | -90 | 180): void {
    const ops = ids.map((id) => {
      const page = this.get(id);
      const rotate = ((((page.rotate + degrees) % 360) + 360) % 360) as Rotation;
      return { type: "patch_page" as const, id, patch: { rotate } };
    });
    this.session.transact(ops);
  }

  /**
   * Takes pages out of the document, with their annotations, form widgets, comment threads and the bookmarks and links
   * that went to them. The last page cannot be deleted.
   */
  remove(ids: readonly string[]): void {
    const doc = this.session.doc;
    const gone = new Set(ids.filter((id) => doc.pages.some((p) => p.id === id)));
    if (gone.size === 0) return;
    const keep = doc.pages.filter((p) => !gone.has(p.id));
    if (keep.length === 0) throw new PliError("invalid_operation", "a PDF needs at least one page");
    const next = keep[Math.min(doc.pages.findIndex((p) => gone.has(p.id)), keep.length - 1)]!;
    const ops: PdfOp[] = doc.pages.filter((p) => gone.has(p.id)).map((p) => ({ type: "remove_page" as const, id: p.id, prev: doc.pages[this.index(p.id) - 1]?.id ?? null }));
    // What belonged to the pages goes with them.
    for (const page of keep) {
      for (const a of page.annots) {
        if (a.type === "link" && a.dest && gone.has(a.dest.page)) {
          if (a.uri === undefined) ops.push({ type: "remove_annot", page: page.id, id: a.id, prev: page.annots[page.annots.indexOf(a) - 1]?.id ?? null });
          else {
            const { dest: _dest, ...link } = a;
            ops.push({ type: "replace_annot", annot: link });
          }
        }
      }
    }
    for (const f of doc.fields) {
      const widgets = f.widgets.filter((w) => !gone.has(w.page));
      if (widgets.length === f.widgets.length) continue;
      if (widgets.length === 0) ops.push({ type: "remove_field", id: f.id, prev: doc.fields[doc.fields.indexOf(f) - 1]?.id ?? null });
      else ops.push({ type: "replace_field", field: { ...f, widgets } });
    }
    const outline = pruneOutline(doc.outline, new Set(keep.map((p) => p.id)));
    if (outline !== doc.outline) ops.push({ type: "set_outline", items: outline });
    for (const [id, thread] of Object.entries(doc.comments ?? {})) if (thread.anchor && gone.has(thread.anchor.page)) ops.push({ type: "set_thread", id, thread: null });
    this.session.transact(ops, { selection: { page: next.id, annots: [], pages: [] } });
  }

  /** Moves pages so that the first of them ends at `index` (in the list without them), keeping their order. */
  move(ids: readonly string[], index: number): void {
    const doc = this.session.doc;
    const moving = doc.pages.filter((p) => ids.includes(p.id));
    const rest = doc.pages.filter((p) => !ids.includes(p.id));
    const at = Math.max(0, Math.min(index, rest.length));
    let after: string | null = rest[at - 1]?.id ?? null;
    this.session.transact(
      moving.map((p) => {
        const op = { type: "move_page" as const, id: p.id, after };
        after = p.id;
        return op;
      }),
    );
  }

  /** Adds a blank page after `after` (at the end by default), the size of the page before it or Letter. */
  insertBlank(after?: string | null, size?: { width: number; height: number }): string {
    const doc = this.session.doc;
    const at = after === undefined ? doc.pages.length : after === null ? 0 : this.index(after) + 1;
    const ref = doc.pages[Math.max(0, at - 1)] ?? doc.pages[0];
    const anchor = after === undefined ? (doc.pages[doc.pages.length - 1]?.id ?? null) : after;
    const dims = size ?? (ref ? { width: ref.width, height: ref.height } : LETTER);
    const page: Page = { id: createId("p_"), from: null, width: dims.width, height: dims.height, rotate: 0, annots: [] };
    this.session.transact([{ type: "insert_page", page, after: anchor }], { selection: { page: page.id, annots: [], pages: [page.id] } });
    return page.id;
  }

  /**
   * Copies pages. The copies are put together after the last of the copied pages, in document order, and get the
   * annotations and form fields of the originals (new ids; the fields get names of their own). Returns the ids of the copies.
   */
  duplicate(ids: readonly string[]): string[] {
    const doc = this.session.doc;
    const chosen = doc.pages.filter((p) => ids.includes(p.id));
    if (chosen.length === 0) return [];
    let after: string = chosen[chosen.length - 1]!.id;
    const ops: PdfOp[] = [];
    const out: string[] = [];
    const copyOf = new Map<string, string>();
    for (const p of chosen) {
      const { label: _label, ...rest } = p;
      const copy: Page = { ...rest, id: createId("p_"), annots: p.annots.map(cloneAnnot) };
      if (p.edits) copy.edits = p.edits.map((e) => ({ ...e, id: createId("e_") }));
      copyOf.set(p.id, copy.id);
      ops.push({ type: "insert_page", page: copy, after });
      after = copy.id;
      out.push(copy.id);
    }
    // Form fields: the widgets on the copied pages become fields of their own, so the copies can be filled in separately.
    const names = new Set(doc.fields.map((f) => f.name));
    for (const f of doc.fields) {
      const widgets = f.widgets.filter((w) => copyOf.has(w.page)).map(({ ref: _ref, ...w }) => ({ ...w, id: createId("w_"), page: copyOf.get(w.page)! }));
      if (widgets.length === 0) continue;
      let name = f.name;
      for (let k = 2; names.has(name); k++) name = `${f.name}_${k}`;
      names.add(name);
      const { ref: _fref, ...field } = f;
      ops.push({ type: "insert_field", field: { ...field, id: createId("f_"), name, widgets } });
    }
    this.session.transact(ops, { selection: { page: out[0]!, annots: [], pages: out } });
    return out;
  }

  /** Sets (or with `null` takes off) the label readers show for pages (`ii`, `A-3`). */
  setLabel(ids: readonly string[], label: string | null): void {
    this.session.transact(ids.map((id) => ({ type: "patch_page" as const, id: this.get(id).id, patch: { label } })));
  }

  /** Numbers pages in order in a style: `numberPages(ids, "roman", { start: 1, prefix: "" })` labels them `i`, `ii`, `iii`. */
  numberPages(ids: readonly string[], style: NumberingStyle, options: { start?: number; prefix?: string } = {}): void {
    const doc = this.session.doc;
    const chosen = doc.pages.filter((p) => ids.includes(p.id));
    const start = Math.max(1, Math.floor(options.start ?? 1));
    this.session.transact(chosen.map((p, i) => ({ type: "patch_page" as const, id: p.id, patch: { label: (options.prefix ?? "") + numberLabel(style, start + i) } })));
  }

  /** Makes a new PDF of just these pages, with their annotations and form fields. */
  extract(ids: readonly string[], options?: SaveOptions): Promise<Uint8Array> {
    return extractPages(this.session, ids, options);
  }

  /** The page ids of each part `split` would make. */
  splitPlan(spec: SplitSpec): string[][] {
    return splitPlan(this.session.doc, spec);
  }

  /** Cuts the document into several PDF files: by page ranges (`{ ranges: "1-3,5" }`), every n pages (`{ every: 10 }`) or at bookmarks (`{ outline: 1 }`). */
  split(spec: SplitSpec, options?: SaveOptions): Promise<Uint8Array[]> {
    return splitPages(this.session, spec, options);
  }

  /** Merges another PDF into this one. Returns the ids of the new pages. See `InsertFromOptions`. */
  insertFrom(source: Uint8Array | PdfFile | PdfSession, options?: InsertFromOptions): Promise<string[]> {
    return insertFromSource(this.session, source, options);
  }

  /** Adds a page for each picture (JPEG or PNG). Returns the ids of the new pages. */
  async insertImages(images: readonly ImageInput[], options: InsertImagesOptions = {}): Promise<string[]> {
    const { at, after, ...rest } = options;
    return insertFromSource(this.session, await pdfFromImages(images, rest), { at, after, name: "images.pdf" });
  }
}
