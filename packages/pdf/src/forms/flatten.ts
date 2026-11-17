/** Flattening: every widget's appearance is drawn into its page, and the widgets and the AcroForm go. */
import { ContentBuilder, ResourceNames } from "../cos/content";
import { PdfDict, PdfRef, PdfStream, isArray, isDict, isName, isNum, isRef, isStream } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import { cloneDirect } from "../cos/overlay";
import { inheritedPageAttr } from "../cos/pagetree";
import { editChild } from "./edit";
import { AF, normRect, numbersOf } from "./tree";
import type { Box } from "./tree";
import type { FormWriter } from "./write";

type Matrix = [number, number, number, number, number, number];

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * ISO 32000-1 12.5.5: the matrix that puts the form's transformed bounding box on the annotation's rectangle. Returns
 * the `cm` to apply before `Do` (the form's own `/Matrix` is applied by `Do`).
 */
export function appearanceMatrix(bbox: Box, matrix: Matrix, rect: Box): Matrix {
  const corners = [apply(matrix, bbox[0], bbox[1]), apply(matrix, bbox[2], bbox[1]), apply(matrix, bbox[2], bbox[3]), apply(matrix, bbox[0], bbox[3])];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const tx0 = Math.min(...xs);
  const ty0 = Math.min(...ys);
  const tw = Math.max(...xs) - tx0;
  const th = Math.max(...ys) - ty0;
  const sx = tw > 0 ? (rect[2] - rect[0]) / tw : 1;
  const sy = th > 0 ? (rect[3] - rect[1]) / th : 1;
  return [sx, 0, 0, sy, rect[0] - tx0 * sx, rect[1] - ty0 * sy];
}

/** The appearance stream to draw for a widget (its normal appearance in the state `/AS` names), as a reference. */
function appearanceOf(w: FormWriter, widget: PdfDict): PdfRef | undefined {
  const o = w.o;
  const ap = o.get(widget.get("AP"));
  if (!isDict(ap)) return undefined;
  const nRaw = ap.get("N");
  const n = o.get(nRaw);
  if (isStream(n)) return isRef(nRaw) ? nRaw : undefined;
  if (isDict(n)) {
    const as = o.get(widget.get("AS"));
    if (!isName(as)) return undefined;
    const entry = n.get(as.value);
    return isRef(entry) && isStream(o.get(entry)) ? entry : undefined;
  }
  return undefined;
}

/** Makes `/Resources` of the page one that can be changed (copied from where it was inherited when the page has none of its own). */
function pageResources(w: FormWriter, page: PdfDict): PdfDict {
  const o = w.o;
  if (!page.has("Resources")) {
    const inh = inheritedPageAttr(o, page, "Resources");
    const r = o.get(inh);
    page.set("Resources", isDict(r) ? cloneDirect(r) : new PdfDict());
  }
  return editChild(o, page, "Resources");
}

function streamOf(text: string): PdfStream {
  return new ContentBuilder().raw(text).toStream();
}

/** Draws every widget of every page into the page, removes the widgets, and removes the AcroForm. */
export function flattenAll(w: FormWriter): void {
  const o = w.o;
  const gone = new Set<number>();
  for (const page of w.ctx.doc.pages) {
    const pref = w.pageRef(page.id);
    const pd = pref ? o.get(pref) : null;
    if (!pref || !isDict(pd)) continue;
    const annots = o.get(pd.get("Annots"));
    if (!isArray(annots)) continue;
    const drawn: { ref: PdfRef; m: Matrix }[] = [];
    const widgets: PdfRef[] = [];
    for (const a of annots) {
      if (!isRef(a)) continue;
      const d = o.get(a);
      if (!isDict(d) || !isName(o.get(d.get("Subtype")), "Widget")) continue;
      widgets.push(a);
      const flags = o.get(d.get("F"));
      if (isNum(flags) && (flags & (AF.Hidden | AF.NoView))) continue;
      const rect = normRect(o, d.get("Rect"));
      const ref = appearanceOf(w, d);
      const form = ref ? o.get(ref) : null;
      if (!rect || !ref || !isStream(form)) continue;
      const bb = normRect(o, form.dict.get("BBox")) ?? [0, 0, rect[2] - rect[0], rect[3] - rect[1]];
      const mm = numbersOf(o, form.dict.get("Matrix"));
      const matrix: Matrix = mm && mm.length >= 6 ? [mm[0]!, mm[1]!, mm[2]!, mm[3]!, mm[4]!, mm[5]!] : [1, 0, 0, 1, 0, 0];
      drawn.push({ ref, m: appearanceMatrix(bb, matrix, rect) });
    }
    if (widgets.length === 0) continue;
    const edit = o.edit<PdfDict>(pref);
    if (drawn.length > 0) {
      const res = new ResourceNames(pageResources(w, edit));
      const c = new ContentBuilder();
      for (const { ref, m } of drawn) {
        const name = res.xobject(ref);
        c.save().transform(...m).doXObject(name).restore();
      }
      const cur = edit.get("Contents");
      let list: PdfObj[] = [];
      if (isArray(cur)) list = [...cur];
      else if (isRef(cur)) {
        const t = o.get(cur);
        list = isArray(t) ? [...t] : [cur];
      }
      const q = o.add(streamOf("q"));
      const qq = o.add(streamOf("Q"));
      const add = o.add(c.toStream());
      edit.set("Contents", [q, ...list, qq, add]);
    }
    for (const r of widgets) gone.add(r.num);
  }
  w.sweepPages(gone);
  // the form itself
  const cat = o.catalog();
  if (cat.has("AcroForm")) o.editCatalog().delete("AcroForm");
}
