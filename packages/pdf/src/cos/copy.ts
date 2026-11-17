/**
 * Deep copy of object graphs between files (`Overlay.copyFrom`, `Overlay.importPage`).
 *
 * Rules, so that a copied page keeps working and drags nothing else along:
 *  - Page tree objects (`/Type /Page` or `/Pages`) are never followed. A reference to one is kept as it is when copying
 *    inside one file, and becomes `null` between files, unless the page itself was copied (then it is mapped to the copy).
 *  - A page's `/Parent`, `/StructParents`, `/B` (article beads) and `/Thumb` are dropped; `/StructParent` is dropped everywhere.
 *  - Annotations are copied afresh on every `importPage` (so two imports of one page never share an annotation), with `/P`
 *    mapped to the new page; `/Popup` and its `/Parent` map to the copied pair.
 *  - A widget that has a `/Parent` becomes a self-contained field: the inherited `FT Ff V DV DA Q Opt MaxLen` are written on
 *    it and its `/T` is the full dotted name; the parent chain (and so the other widgets of the field) is left behind.
 *    Registering the widgets in the target's `/AcroForm` is up to the caller.
 *  - A `/Dest` (or a GoTo action's `/D`) that points to a page that was not copied, or is a named destination of another
 *    file, is removed.
 *  - Streams keep their bytes (they are shared, not duplicated in memory); `/Length` is left to the writer.
 */
import { PliError } from "@pli.dev/core";
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, isArray, isDict, isName, isRef, pdfText, textOf } from "./objects";
import type { PdfObj } from "./objects";
import { INHERITED_PAGE_KEYS, inheritedPageAttr, pageRefs } from "./pagetree";
import type { Overlay, PdfFileLike } from "./overlay";

interface Scope {
  memo: Map<number, PdfRef>;
  /** Objects reached from annotations: not shared with other imports. */
  local: boolean;
}

const FIELD_INHERITED = ["FT", "Ff", "V", "DV", "DA", "Q", "Opt", "MaxLen"];
const PAGE_DROP = new Set(["Parent", "Annots", "StructParents", "B", "Thumb"]);

const isPageObject = (o: PdfObj): boolean => isDict(o) && (isName(o.get("Type"), "Page") || isName(o.get("Type"), "Pages"));

export class Copier {
  readonly #global: Scope = { memo: new Map(), local: false };
  readonly #pageMap = new Map<number, PdfRef>();
  readonly #queue: { from: PdfRef; to: PdfRef; scope: Scope }[] = [];
  readonly #same: boolean;

  constructor(
    readonly target: Overlay,
    readonly source: PdfFileLike | Overlay,
  ) {
    this.#same = source === target || source === target.base;
  }

  /** Copies `obj` and what it refers to; a reference to a page is copied as that page (without its parent). */
  copy(obj: PdfObj): PdfObj {
    const out = this.#value(obj, this.#global, true);
    this.#drain();
    return out;
  }

  /** A fresh copy of page `index` of the source: not in any page tree. */
  copyPage(index: number): PdfRef {
    const src = this.source;
    let ref: PdfRef | undefined;
    let dict: PdfDict | undefined;
    const withPages = src as PdfFileLike;
    if (typeof withPages.pages === "function") {
      const pi = withPages.pages()[index];
      if (pi) {
        ref = pi.ref;
        dict = pi.dict.clone();
        if (!dict.has("MediaBox")) dict.set("MediaBox", pi.mediaBox);
        if (!dict.has("CropBox") && pi.cropBox.join() !== pi.mediaBox.join()) dict.set("CropBox", pi.cropBox);
        if (pi.rotate && !dict.has("Rotate")) dict.set("Rotate", pi.rotate);
      }
    } else {
      const r = pageRefs(src as Overlay)[index];
      const d = r ? src.get(r) : null;
      if (r && isDict(d)) {
        ref = r;
        dict = d.clone();
        for (const key of INHERITED_PAGE_KEYS) if (!dict.has(key)) {
          const v = inheritedPageAttr(src, d, key);
          if (v !== null) dict.set(key, v);
        }
      }
    }
    if (!ref || !dict) throw new PliError("out_of_range", `The file has no page ${index + 1}.`);
    const newRef = this.target.add(new PdfDict());
    this.#pageMap.set(ref.num, newRef);
    const out = new PdfDict();
    out.set("Type", PdfName.of("Page"));
    for (const [k, v] of dict.map) {
      if (PAGE_DROP.has(k) || k === "Type") continue;
      out.set(k, this.#value(v, this.#global));
    }
    const annots = this.source.get(dict.get("Annots"));
    if (isArray(annots) && annots.length) {
      const scope: Scope = { memo: new Map(), local: true };
      const copied: PdfObj[] = [];
      for (const a of annots) {
        const r = this.#value(a, scope);
        if (isRef(r)) copied.push(r);
      }
      if (copied.length) out.set("Annots", copied);
    }
    this.#drain();
    this.target.set(newRef, out);
    return newRef;
  }

  #drain(): void {
    while (this.#queue.length) {
      const { from, to, scope } = this.#queue.shift()!;
      const obj = this.source.get(from);
      this.target.set(to, this.#value(obj, scope));
    }
  }

  #mapRef(ref: PdfRef, scope: Scope, explicitPage = false): PdfObj {
    const mapped = this.#pageMap.get(ref.num);
    if (mapped) return mapped;
    const hit = scope.memo.get(ref.num) ?? (scope.local ? undefined : this.#global.memo.get(ref.num));
    if (hit) return hit;
    const target = this.source.get(ref);
    if (target === null) return null;
    if (isPageObject(target) && !explicitPage) return this.#same ? new PdfRef(ref.num, ref.gen) : null;
    const to = this.target.add(null);
    scope.memo.set(ref.num, to);
    this.#queue.push({ from: ref, to, scope });
    return to;
  }

  /** Whether a destination (array, or name/string of a named destination) can't work in the target. */
  #brokenDest(value: PdfObj | undefined): boolean {
    const v = this.source.get(value);
    if (isArray(v)) {
      const first = v[0];
      if (isRef(first)) {
        if (this.#pageMap.has(first.num)) return false;
        return !this.#same;
      }
      return false;
    }
    if (v instanceof PdfString || isName(v)) return !this.#same;
    return false;
  }

  #flattenWidget(d: PdfDict): PdfDict {
    const out = d.clone();
    const names: string[] = [];
    let node: PdfDict | null = d;
    let chain = 0;
    while (node && chain++ < 32) {
      const t = this.source.get(node.get("T"));
      if (t instanceof PdfString) names.unshift(textOf(t));
      if (node !== d) {
        for (const key of FIELD_INHERITED) if (!out.has(key) && node.has(key)) out.set(key, node.get(key) ?? null);
      }
      const parent: PdfObj = this.source.get(node.get("Parent"));
      node = isDict(parent) ? parent : null;
    }
    out.delete("Parent");
    if (names.length) out.set("T", pdfText(names.join(".")));
    return out;
  }

  #value(o: PdfObj, scope: Scope, explicitPage = false): PdfObj {
    if (isRef(o)) return this.#mapRef(o, scope, explicitPage);
    if (isArray(o)) return o.map((e) => this.#value(e, scope));
    if (o instanceof PdfStream) {
      const d = this.#dict(o.dict, scope);
      d.delete("Length");
      return new PdfStream(d, o.data);
    }
    if (o instanceof PdfDict) return this.#dict(o, scope);
    return o;
  }

  #dict(source: PdfDict, scope: Scope): PdfDict {
    let d = source;
    if (isName(d.get("Subtype"), "Widget") && isRef(d.get("Parent"))) d = this.#flattenWidget(d);
    const out = new PdfDict();
    const dropDest = d.has("Dest") && this.#brokenDest(d.get("Dest"));
    let dropAction = false;
    if (d.has("A")) {
      const a = this.source.get(d.get("A"));
      if (isDict(a) && isName(this.source.get(a.get("S")), "GoTo") && this.#brokenDest(a.get("D"))) dropAction = true;
    }
    for (const [k, v] of d.map) {
      if (k === "StructParent" || k === "StructParents") continue;
      if (k === "Dest" && dropDest) continue;
      if (k === "A" && dropAction) continue;
      const m = this.#value(v, scope);
      if (m === null && (k === "Parent" || k === "P")) continue;
      out.set(k, m);
    }
    return out;
  }
}
