import { PliError } from "@pli.dev/core";
import type { WriteContext } from "../context";
import type { PdfFile } from "../cos/file";
import { PdfDict, PdfName, PdfRef, isArray, isDict, isName, isRef } from "../cos/objects";
import { inheritedPageAttr, setPages } from "../cos/pagetree";
import { MAIN_SOURCE, type Page, type PdfDoc } from "../model";
import { scrubRemovedPages } from "./dest";
import { writePageLabels } from "./labels";

/** The id a page of the opened file has (`open.ts` makes the same). */
const mainPageId = (index: number): string => `p:${MAIN_SOURCE}:${index}`;

/** Annotation types that `Page.annots` models: a page copied together with them carries them as JSON, so the raw copies are dropped. */
const MODELLED = new Set(["Text", "Link", "FreeText", "Line", "Square", "Circle", "Polygon", "PolyLine", "Highlight", "Underline", "Squiggly", "StrikeOut", "Stamp", "Ink", "Redact", "Popup"]);

const BLANK: PdfName = PdfName.of("Page");

/**
 * Puts the document's pages in the file in the document's order: pages of the original stay (their page object is kept),
 * pages of other sources are copied in, blank pages are made, rotation and labels are set. Fills `ctx.pageRefs` with the
 * page object of every page id. Touches nothing about the page tree when the pages are the original's, in the same order.
 */
export function applyPages(ctx: WriteContext): void {
  const { overlay, doc, main, sources } = ctx;
  const infos = main ? main.pages() : [];
  const originalRefs = infos.map((p) => p.ref);

  // Which page of the document keeps each original page object: the page with its own id, else the first that is from it.
  const owner = new Map<number, string>();
  if (main) {
    for (const p of doc.pages) {
      if (p.from?.source === MAIN_SOURCE && p.id === mainPageId(p.from.index) && p.from.index < infos.length && !owner.has(p.from.index)) owner.set(p.from.index, p.id);
    }
    for (const p of doc.pages) {
      if (p.from?.source === MAIN_SOURCE && p.from.index < infos.length && !owner.has(p.from.index)) owner.set(p.from.index, p.id);
    }
  }

  const refs: PdfRef[] = [];
  const ownerIndex: (number | undefined)[] = [];
  const seenIds = new Set<string>();
  const usedNums = new Set<number>();
  doc.pages.forEach((page, position) => {
    const duplicateId = seenIds.has(page.id);
    seenIds.add(page.id);
    let ref: PdfRef;
    let sourceRotate = 0;
    let copied = false;
    const from = page.from;
    if (from === null) {
      ref = overlay.add(new PdfDict({ Type: BLANK, MediaBox: [0, 0, page.width, page.height], Resources: new PdfDict() }));
    } else {
      const info = from.source === MAIN_SOURCE && main ? infos[from.index] : undefined;
      if (info && !duplicateId && owner.get(from.index) === page.id && !usedNums.has(info.ref.num)) {
        ref = info.ref;
        sourceRotate = info.rotate;
        ownerIndex[position] = from.index;
      } else {
        const file: PdfFile | undefined = sources.get(from.source);
        if (!file) throw new PliError("not_found", `source ${from.source} is not available`);
        const sourceInfo = file.pages()[from.index];
        if (!sourceInfo) throw new PliError("out_of_range", `page ${page.id}: ${from.source} has no page ${from.index + 1}`);
        ref = overlay.importPage(file, from.index);
        sourceRotate = sourceInfo.rotate;
        copied = true;
      }
    }
    usedNums.add(ref.num);
    if (!ctx.pageRefs.has(page.id)) ctx.pageRefs.set(page.id, ref);
    refs.push(ref);
    if (copied) dropModelledAnnots(ctx, ref, page);
    setRotation(ctx, ref, page.rotate, sourceRotate, copied);
  });

  const unchanged = main !== null && refs.length === originalRefs.length && refs.every((r, i) => r.num === originalRefs[i]!.num);
  if (!unchanged) setPages(overlay, refs);

  if (main) {
    const kept = new Set(refs.map((r) => r.num));
    const removed = new Set(originalRefs.filter((r) => !kept.has(r.num)).map((r) => r.num));
    if (removed.size > 0) scrubRemovedPages(overlay, removed, refs);
  }
  writePageLabels(ctx, ownerIndex);
}

/** Makes the page object turn as `want` says. `Page.rotate` replaces what the source page had. */
function setRotation(ctx: WriteContext, ref: PdfRef, want: number, have: number, isCopy: boolean): void {
  if (want === have) return;
  const { overlay } = ctx;
  const d = overlay.edit<PdfDict>(ref);
  if (want !== 0) {
    d.set("Rotate", want);
    return;
  }
  // 0: take the entry off, unless the page would then take a turn from its page tree.
  let inherited = false;
  if (!isCopy) {
    const parent = overlay.get(d.get("Parent"));
    if (isDict(parent)) {
      const v = overlay.get(inheritedPageAttr(overlay, parent, "Rotate"));
      inherited = typeof v === "number" && v % 360 !== 0;
    }
  }
  if (inherited) d.set("Rotate", 0);
  else d.delete("Rotate");
}

/**
 * A copied page comes with copies of its annotations. When the document carries the page's annotations (and form
 * fields) as JSON, the writers write those, so the raw copies of the kinds they cover are taken off.
 */
function dropModelledAnnots(ctx: WriteContext, ref: PdfRef, page: Page): void {
  const { overlay, doc } = ctx;
  const d = overlay.get(ref);
  if (!isDict(d)) return;
  const annots = overlay.get(d.get("Annots"));
  if (!isArray(annots) || annots.length === 0) return;
  const hasAnnots = page.annots.length > 0;
  const hasWidgets = hasWidgetsOn(doc, page.id);
  if (!hasAnnots && !hasWidgets) return;
  const keep = annots.filter((a) => {
    const t = overlay.get(a);
    if (!isDict(t)) return true;
    const sub = overlay.get(t.get("Subtype"));
    if (!isName(sub)) return true;
    if (sub.value === "Widget") return !hasWidgets;
    return !(hasAnnots && MODELLED.has(sub.value));
  });
  if (keep.length === annots.length) return;
  const e = overlay.edit<PdfDict>(ref);
  if (keep.length === 0) e.delete("Annots");
  else e.set("Annots", keep.filter((k) => isRef(k) || isDict(k)));
}

function hasWidgetsOn(doc: PdfDoc, pageId: string): boolean {
  return doc.fields.some((f) => f.widgets.some((w) => w.page === pageId));
}
