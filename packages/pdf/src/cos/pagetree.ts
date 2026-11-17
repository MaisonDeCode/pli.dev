/**
 * Page tree helpers shared by everything that adds, removes or moves pages: reading the tree, finding inherited
 * attributes, and rebuilding it as one flat `/Pages` node.
 */
import { PliError } from "@pli.dev/core";
import { PdfDict, PdfName, PdfRef, isArray, isDict, isName, isRef } from "./objects";
import type { PdfObj } from "./objects";
import type { Overlay } from "./overlay";

/** Anything that can resolve references and knows its trailer: a `PdfFile` or an `Overlay`. */
export interface TreeReader {
  get(o: PdfObj | undefined): PdfObj;
  readonly trailer: PdfDict;
}

/** The attributes a page takes from its ancestors in the page tree. */
export const INHERITED_PAGE_KEYS = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;

const isNode = (d: PdfDict): boolean => isName(d.get("Type"), "Pages") || (!isName(d.get("Type"), "Page") && d.has("Kids"));

/** The page objects in reading order, from the catalog's page tree (cycles and broken entries are skipped). */
export function pageRefs(src: TreeReader): PdfRef[] {
  const root = src.get(src.trailer.get("Root"));
  const out: PdfRef[] = [];
  if (!isDict(root)) return out;
  const seen = new Set<number>();
  const walk = (ref: PdfObj, depth: number) => {
    if (!isRef(ref) || seen.has(ref.num) || depth > 64) return;
    seen.add(ref.num);
    const d = src.get(ref);
    if (!isDict(d)) return;
    if (isNode(d)) {
      const kids = src.get(d.get("Kids"));
      if (isArray(kids)) for (const k of kids) walk(k, depth + 1);
    } else out.push(ref);
  };
  walk(root.get("Pages") ?? null, 0);
  return out;
}

/** An attribute of a page, from the page or its nearest ancestor that has it (`null` if none). The raw value: may be a reference. */
export function inheritedPageAttr(src: Pick<TreeReader, "get">, page: PdfDict, key: string): PdfObj {
  let d: PdfDict | null = page;
  for (let i = 0; i < 64 && d; i++) {
    const v = d.get(key);
    if (v !== undefined && v !== null) return v;
    const parent = src.get(d.get("Parent"));
    d = isDict(parent) ? parent : null;
  }
  return null;
}

/**
 * The array under `key` of `dict`, ready to change: a new empty one is stored when there is none, a referenced array
 * becomes a private copy in the overlay. `dict` itself must be one you can change (from `overlay.edit` or `overlay.add`).
 */
export function ensureArray(o: Overlay, dict: PdfDict, key: string): PdfObj[] {
  const v = dict.get(key);
  if (isArray(v)) return v;
  if (isRef(v) && isArray(o.get(v))) return o.edit<PdfObj[]>(v);
  const a: PdfObj[] = [];
  dict.set(key, a);
  return a;
}

/**
 * Makes `pages` the document's pages, in this order, under one flat `/Pages` node (the old root is reused; older
 * intermediate nodes are freed). Each page gets `/Parent`, and the inherited `Resources`, `MediaBox`, `CropBox` and
 * `Rotate` it had from its old ancestors written on it, so nothing changes how it looks.
 */
export function setPages(o: Overlay, pages: PdfRef[]): void {
  const catalog = o.editCatalog();
  let rootRef = catalog.get("Pages");
  const oldRoot = isRef(rootRef) ? o.get(rootRef) : null;
  // The nodes of the old tree, to free the ones in between.
  const oldNodes: PdfRef[] = [];
  if (isRef(rootRef) && isDict(oldRoot)) {
    const seen = new Set<number>([rootRef.num]);
    const walk = (ref: PdfObj, depth: number) => {
      if (!isRef(ref) || seen.has(ref.num) || depth > 64) return;
      seen.add(ref.num);
      const d = o.get(ref);
      if (isDict(d) && isNode(d)) {
        oldNodes.push(ref);
        const kids = o.get(d.get("Kids"));
        if (isArray(kids)) for (const k of kids) walk(k, depth + 1);
      }
    };
    const kids = o.get(oldRoot.get("Kids"));
    if (isArray(kids)) for (const k of kids) walk(k, 1);
  }
  if (!isRef(rootRef) || !isDict(oldRoot)) {
    rootRef = o.add(new PdfDict({ Type: PdfName.of("Pages"), Kids: [], Count: 0 }));
    catalog.set("Pages", rootRef);
  }
  const root = rootRef as PdfRef;
  for (const p of pages) {
    const d = o.get(p);
    if (!isDict(d)) throw new PliError("invalid_operation", `Object ${p.num} is not a page.`);
    const missing: [string, PdfObj][] = [];
    if (!d.has("Resources") || !d.has("MediaBox") || !d.has("CropBox") || !d.has("Rotate")) {
      for (const key of INHERITED_PAGE_KEYS) if (!d.has(key)) {
        const v = inheritedPageAttr(o, d, key);
        if (v !== null) missing.push([key, v]);
      }
    }
    const parent = d.get("Parent");
    const typed = isName(d.get("Type"), "Page");
    if (missing.length === 0 && typed && isRef(parent) && parent.num === root.num) continue;
    const e = o.edit<PdfDict>(p);
    e.set("Type", PdfName.of("Page"));
    for (const [k, v] of missing) e.set(k, isRef(v) ? v : cloneValue(v));
    e.set("Parent", root);
  }
  const rootDict = o.edit<PdfDict>(root);
  rootDict.set("Type", PdfName.of("Pages"));
  rootDict.set("Kids", pages.map((p) => new PdfRef(p.num, p.gen)));
  rootDict.set("Count", pages.length);
  rootDict.delete("Parent");
  const keep = new Set(pages.map((p) => p.num));
  for (const n of oldNodes) if (!keep.has(n.num) && n.num !== root.num) o.remove(n);
}

const cloneValue = (v: PdfObj): PdfObj => (isArray(v) ? v.map(cloneValue) : v instanceof PdfDict ? new PdfDict([...v.map].map(([k, x]) => [k, cloneValue(x)] as const)) : v);
