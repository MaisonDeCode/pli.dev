/**
 * Save-time half of content editing: applies each page's `edits` (redaction, text and picture replacement) to the
 * page's content in the NEW file, removes annotations and form fields under redactions, and (with
 * `SaveOptions.scrub`) takes document information, XMP metadata, attached files and JavaScript out.
 */
import type { WriteContext } from "../context";
import { PdfDict, PdfRef, isArray, isDict, isName, isRef } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import { MAIN_SOURCE, type OutlineItem, type Page, type Rect } from "../model";
import { overlaps } from "./interpreter";
import { pageGeometry, sourceOf, type PageGeom } from "./page";
import { finishEmbeddedFonts, rewritePage, type RedactSpec, type RewriteInput } from "./rewrite";

function pageRefFor(ctx: WriteContext, page: Page): PdfRef | undefined {
  const known = ctx.pageRefs.get(page.id);
  if (known) return known;
  if (page.from && page.from.source === MAIN_SOURCE && ctx.main) return ctx.main.pages()[page.from.index]?.ref;
  return undefined;
}

/** The rectangle of an annotation in page space, or null. */
function annotRect(src: ReturnType<typeof sourceOf>, annot: PdfDict, geom: PageGeom): Rect | null {
  const r = src.get(annot.get("Rect"));
  if (!isArray(r) || r.length < 4) return null;
  const v = r.slice(0, 4).map((x) => src.get(x));
  if (!v.every((x): x is number => typeof x === "number")) return null;
  const x0 = Math.min(v[0]!, v[2]!);
  const x1 = Math.max(v[0]!, v[2]!);
  const y0 = Math.min(v[1]!, v[3]!);
  const y1 = Math.max(v[1]!, v[3]!);
  return { x: x0 - geom.box[0], y: geom.box[3] - y1, w: x1 - x0, h: y1 - y0 };
}

/** Takes a widget out of the form's field tree (and the field with it when it was the only widget). */
function removeWidgetField(ctx: WriteContext, widget: PdfRef): void {
  const o = ctx.overlay;
  const cat = o.catalog();
  let acroRef = cat.get("AcroForm");
  if (!acroRef || !isDict(o.get(acroRef))) return;
  const acro = isRef(acroRef) ? o.edit<PdfDict>(acroRef) : (o.editCatalog().get("AcroForm") as PdfDict);
  acroRef = undefined;
  const listOf = (owner: PdfDict, key: string): PdfObj[] | null => {
    const k = owner.get(key);
    if (isArray(k)) return k;
    if (isRef(k) && isArray(o.get(k))) return o.edit<PdfObj[]>(k);
    return null;
  };
  const contains = (list: PdfObj[], depth: number): boolean => {
    if (depth > 32) return false;
    for (const e of list) {
      if (isRef(e) && e.num === widget.num) return true;
      if (isRef(e)) {
        const node = o.get(e);
        const kids = isDict(node) ? node.get("Kids") : null;
        const arr = isArray(o.get(kids ?? null)) ? (o.get(kids ?? null) as PdfObj[]) : null;
        if (arr && contains(arr, depth + 1)) return true;
      }
    }
    return false;
  };
  const prune = (list: PdfObj[], depth: number): void => {
    if (depth > 32) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i]!;
      if (isRef(e) && e.num === widget.num) {
        list.splice(i, 1);
        continue;
      }
      if (!isRef(e)) continue;
      const node = o.get(e);
      if (!isDict(node)) continue;
      const kidsRaw = node.get("Kids");
      const arr = o.get(kidsRaw ?? null);
      if (!isArray(arr) || !contains(arr, depth + 1)) continue;
      const editable = o.edit<PdfDict>(e);
      const kids = listOf(editable, "Kids");
      if (!kids) continue;
      prune(kids, depth + 1);
      if (kids.length === 0) list.splice(i, 1);
    }
  };
  const fields = listOf(acro, "Fields");
  if (fields) prune(fields, 0);
}

function removeAnnotations(ctx: WriteContext, pageRef: PdfRef, geom: PageGeom, rects: Rect[]): void {
  const o = ctx.overlay;
  const src = sourceOf(o);
  const page = o.get(pageRef);
  if (!isDict(page)) return;
  const list = src.get(page.get("Annots"));
  if (!isArray(list)) return;
  const removed = new Set<number>();
  const keep: PdfObj[] = [];
  for (const e of list) {
    const a = src.get(e);
    if (!isDict(a)) {
      keep.push(e);
      continue;
    }
    const r = annotRect(src, a, geom);
    if (r && rects.some((x) => overlaps(r, x, 0.01))) {
      if (isRef(e)) {
        removed.add(e.num);
        if (isName(src.get(a.get("Subtype")), "Widget")) removeWidgetField(ctx, e);
      }
    } else keep.push(e);
  }
  if (removed.size === 0) return;
  // pop-ups belong to the annotation they open for
  const final = keep.filter((e) => {
    const a = src.get(e);
    const parent = isDict(a) ? a.get("Parent") : null;
    return !(isDict(a) && isName(src.get(a.get("Subtype")), "Popup") && isRef(parent) && removed.has(parent.num));
  });
  o.edit<PdfDict>(pageRef).set("Annots", final);
}

/** Alternative text of structure elements on a redacted page can repeat what was under the box. */
function stripStructureText(ctx: WriteContext, pageRef: PdfRef): void {
  const o = ctx.overlay;
  const root = o.catalog().get("StructTreeRoot");
  if (!root) return;
  for (const n of o.objectNumbers()) {
    const d = o.get(new PdfRef(n, 0));
    if (!isDict(d) || !d.has("S")) continue;
    if (!(d.has("ActualText") || d.has("Alt") || d.has("E"))) continue;
    const pg = d.get("Pg");
    if (!isRef(pg) || pg.num !== pageRef.num) continue;
    const e = o.edit<PdfDict>(new PdfRef(n, o.generation(n)));
    e.delete("ActualText");
    e.delete("Alt");
    e.delete("E");
  }
}

function outlineTitles(items: readonly OutlineItem[]): string[] {
  return items.flatMap((i) => [i.title, ...outlineTitles(i.children)]);
}

/** Looks for text that was just redacted in places this save does not touch, and says where. */
function warnAboutCopies(ctx: WriteContext, removed: string[]): void {
  const needles = [...new Set(removed.map((t) => t.trim()).filter((t) => t.length >= 3))];
  if (!needles.length) return;
  const has = (s: string | undefined | null) => !!s && needles.some((n) => s.toLowerCase().includes(n.toLowerCase()));
  const where: string[] = [];
  if (Object.values(ctx.doc.meta).some((v) => has(v as string))) where.push("the document information (title, author...)");
  if (outlineTitles(ctx.doc.outline).some(has)) where.push("the bookmarks");
  if (ctx.doc.fields.some((f) => has(f.name) || has(typeof f.value === "string" ? f.value : Array.isArray(f.value) ? f.value.join(" ") : ""))) where.push("form fields");
  if (ctx.doc.pages.some((p) => p.annots.some((a) => a.type !== "redact" && (has(a.contents) || ("quote" in a && has(a.quote)))))) where.push("comments or notes");
  if (where.length) ctx.warnings.push(`Text that was redacted also appears in ${where.join(", ")}. Those were not changed.`);
}

function scrubDocument(ctx: WriteContext): void {
  const o = ctx.overlay;
  const src = sourceOf(o);
  const info = o.info();
  if (info) {
    const d = o.editInfo();
    for (const k of d.keys()) d.delete(k);
  }
  const cat = o.editCatalog();
  for (const k of ["Metadata", "PieceInfo", "AA", "Collection", "Threads"]) cat.delete(k);
  const open = src.get(cat.get("OpenAction"));
  if (isDict(open) && isName(src.get(open.get("S")), "JavaScript")) cat.delete("OpenAction");
  const namesRef = cat.get("Names");
  if (namesRef && isDict(o.get(namesRef))) {
    const names = isRef(namesRef) ? o.edit<PdfDict>(namesRef) : (cat.get("Names") as PdfDict);
    names.delete("JavaScript");
    names.delete("EmbeddedFiles");
  }
  for (const page of ctx.doc.pages) {
    const ref = pageRefFor(ctx, page);
    if (!ref) continue;
    const p = o.edit<PdfDict>(ref);
    for (const k of ["Metadata", "PieceInfo", "Thumb", "AA"]) p.delete(k);
    const list = src.get(p.get("Annots"));
    if (!isArray(list)) continue;
    const keep: PdfObj[] = [];
    for (const e of list) {
      const a = src.get(e);
      if (isDict(a) && isName(src.get(a.get("Subtype")), "FileAttachment")) continue;
      if (isDict(a) && isRef(e) && (a.has("AA") || isJavaScript(src, a.get("A")))) {
        const ea = o.edit<PdfDict>(e);
        ea.delete("AA");
        if (isJavaScript(src, ea.get("A"))) ea.delete("A");
      }
      keep.push(e);
    }
    if (keep.length !== list.length) p.set("Annots", keep);
  }
}

function isJavaScript(src: ReturnType<typeof sourceOf>, action: PdfObj | undefined): boolean {
  const a = src.get(action);
  return isDict(a) && isName(src.get(a.get("S")), "JavaScript");
}

/** Applies each page's `edits` to its content. Needs a new file, not an update. */
export function applyEdits(ctx: WriteContext): void {
  const removed: string[] = [];
  let edited = false;
  for (const page of ctx.doc.pages) {
    const edits = page.edits;
    if (!edits || edits.length === 0) continue;
    const ref = pageRefFor(ctx, page);
    if (!ref) {
      ctx.warnings.push(`The edits on page ${page.id} were not written: the page is not in the file.`);
      continue;
    }
    const dict = ctx.overlay.get(ref);
    if (!isDict(dict)) continue;
    const src = sourceOf(ctx.overlay);
    const geom = pageGeometry(src, dict, ref);
    const input: RewriteInput = { redactions: [], texts: [], images: [] };
    for (const e of edits) {
      if (e.type === "redact") input.redactions.push({ rects: e.rects, fill: e.fill, overlay: e.overlay } satisfies RedactSpec);
      else if (e.type === "text") input.texts.push({ run: e.run, text: e.text, family: e.family, size: e.size, color: e.color, bold: e.bold, italic: e.italic, fit: e.fit });
      else input.images.push({ target: e.target, picture: e.picture, fit: e.fit });
    }
    const index = page.from?.index ?? ctx.doc.pages.indexOf(page);
    const outcome = rewritePage(ctx, ref, geom, index, input);
    removed.push(...outcome.removedText);
    edited = true;
    const rects = input.redactions.flatMap((r) => r.rects);
    if (rects.length) {
      removeAnnotations(ctx, ref, geom, rects);
      stripStructureText(ctx, ref);
    }
  }
  if (edited) finishEmbeddedFonts(ctx.overlay);
  warnAboutCopies(ctx, removed);
  if (ctx.options.scrub) scrubDocument(ctx);
}
