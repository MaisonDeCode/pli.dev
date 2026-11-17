/**
 * Destinations: where a link, a bookmark or the open action goes. Reading turns them into `{ page, y }` in page space;
 * writing makes `[pageRef /XYZ null top null]`; `scrubRemovedPages` takes out every reference to pages that are no
 * longer in the document, so a deleted page's content does not stay reachable through a link.
 */
import type { PageInfo } from "../cos/file";
import { PdfDict, PdfName, PdfRef, isArray, isDict, isName, isRef, isString } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import type { Overlay } from "../cos/overlay";
import { ensureArray, inheritedPageAttr } from "../cos/pagetree";

/** What the destination helpers need: a `PdfFile` or an `Overlay`. */
export interface DestReader {
  get(o: PdfObj | undefined): PdfObj;
  catalog(): PdfDict;
}

const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

/** The key of a name tree entry: the bytes of the string as Latin-1 characters. */
export const treeKey = (o: PdfObj): string | undefined => (isString(o) ? latin1(o.bytes) : isName(o) ? o.value : undefined);

/** Every `[key, value]` pair of a name tree (`/Names`) or number tree (`/Nums`), in tree order. Cycles and absurd sizes are cut. */
export function treeEntries(r: Pick<DestReader, "get">, root: PdfObj | undefined, leafKey: "Names" | "Nums"): [PdfObj, PdfObj][] {
  const out: [PdfObj, PdfObj][] = [];
  const seen = new Set<number>();
  const walk = (node: PdfObj | undefined, depth: number): void => {
    if (depth > 32 || out.length > 1_000_000) return;
    if (isRef(node)) {
      if (seen.has(node.num)) return;
      seen.add(node.num);
    }
    const d = r.get(node);
    if (!isDict(d)) return;
    const leaf = r.get(d.get(leafKey));
    if (isArray(leaf)) for (let i = 0; i + 1 < leaf.length; i += 2) out.push([r.get(leaf[i]), leaf[i + 1] ?? null]);
    const kids = r.get(d.get("Kids"));
    if (isArray(kids)) for (const k of kids) walk(k, depth + 1);
  };
  walk(root, 0);
  return out;
}

const namedCache = new WeakMap<object, Map<string, PdfObj>>();

/** The named destinations of a document (the `/Names /Dests` tree and the old `/Dests` dictionary): name -> destination value (array or dictionary with `/D`). */
export function namedDests(r: DestReader, cache = true): Map<string, PdfObj> {
  const hit = cache ? namedCache.get(r) : undefined;
  if (hit) return hit;
  const map = new Map<string, PdfObj>();
  try {
    const cat = r.catalog();
    const dests = r.get(cat.get("Dests"));
    if (isDict(dests)) for (const [k, v] of dests.map) map.set(k, v);
    const names = r.get(cat.get("Names"));
    if (isDict(names)) {
      for (const [k, v] of treeEntries(r, names.get("Dests"), "Names")) {
        const key = treeKey(k);
        if (key !== undefined) map.set(key, v);
      }
    }
  } catch {
    // a broken catalog has no named destinations
  }
  if (cache) namedCache.set(r, map);
  return map;
}

/** The explicit destination array behind a destination value (an array, a name or string of a named destination, or a dictionary with `/D`). */
export function destArray(r: DestReader, value: PdfObj | undefined, names: Map<string, PdfObj> = namedDests(r)): PdfObj[] | null {
  let o = r.get(value);
  for (let hops = 0; hops < 8; hops++) {
    if (isArray(o)) return o;
    if (isDict(o)) o = r.get(o.get("D"));
    else if (isString(o) || isName(o)) {
      const key = treeKey(o)!;
      const next = names.get(key);
      if (next === undefined) return null;
      o = r.get(next);
    } else return null;
  }
  return null;
}

/** The object number of the page a destination goes to, or undefined when it goes nowhere in this file. */
export function destPageNum(r: DestReader, value: PdfObj | undefined, names?: Map<string, PdfObj>): number | undefined {
  const a = destArray(r, value, names);
  const first = a?.[0];
  return isRef(first) ? first.num : undefined;
}

/** What a destination resolved against a file's pages: the page id and how far down (page space). */
export interface ResolvedDest {
  page: string;
  y?: number;
}

export interface DestContext {
  file: DestReader;
  pages: readonly PageInfo[];
  pageIdByRef: ReadonlyMap<string, string>;
}

const lookups = new WeakMap<object, { byNum: Map<number, string>; infoByNum: Map<number, PageInfo> }>();

function lookupFor(ctx: DestContext) {
  let l = lookups.get(ctx.pageIdByRef);
  if (!l) {
    const byNum = new Map<number, string>();
    for (const [key, id] of ctx.pageIdByRef) byNum.set(Number(key.split(" ")[0]), id);
    const infoByNum = new Map<number, PageInfo>();
    for (const p of ctx.pages) infoByNum.set(p.ref.num, p);
    lookups.set(ctx.pageIdByRef, (l = { byNum, infoByNum }));
  }
  return l;
}

/**
 * Turns a destination (`[page /XYZ left top zoom]`, a name, a string, or a dictionary with `/D`) into a page id and a
 * y in page space (down from the top of the visible box). Undefined when it does not go to a page of this file.
 */
export function resolveDest(ctx: DestContext, value: PdfObj | undefined): ResolvedDest | undefined {
  const a = destArray(ctx.file, value);
  if (!a || a.length === 0) return undefined;
  const first = a[0];
  if (!isRef(first)) return undefined;
  const { byNum, infoByNum } = lookupFor(ctx);
  const page = byNum.get(first.num);
  if (page === undefined) return undefined;
  const mode = ctx.file.get(a[1]);
  const n = (i: number): number | undefined => {
    const v = ctx.file.get(a[i]);
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  let top: number | undefined;
  if (isName(mode)) {
    if (mode.value === "XYZ") top = n(3);
    else if (mode.value === "FitH" || mode.value === "FitBH") top = n(2);
    else if (mode.value === "FitR") top = n(5);
  }
  const info = infoByNum.get(first.num);
  if (top === undefined || !info) return { page };
  return { page, y: Math.round((info.cropBox[3] - top) * 1000) / 1000 };
}

/** The visible box (CropBox or MediaBox, as left, bottom, right, top) of a page object in an overlay. */
export function visibleBox(o: Overlay, page: PdfRef): [number, number, number, number] {
  const d = o.get(page);
  const box = (key: string): [number, number, number, number] | null => {
    if (!isDict(d)) return null;
    const a = o.get(inheritedPageAttr(o, d, key));
    if (!isArray(a) || a.length < 4) return null;
    const v = a.slice(0, 4).map((x) => o.get(x));
    if (!v.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
    const [x0, y0, x1, y1] = v as number[];
    return [Math.min(x0!, x1!), Math.min(y0!, y1!), Math.max(x0!, x1!), Math.max(y0!, y1!)];
  };
  const media = box("MediaBox") ?? [0, 0, 612, 792];
  const crop = box("CropBox");
  if (!crop) return media;
  const c: [number, number, number, number] = [Math.max(crop[0], media[0]), Math.max(crop[1], media[1]), Math.min(crop[2], media[2]), Math.min(crop[3], media[3])];
  return c[2] > c[0] && c[3] > c[1] ? c : media;
}

/** `[page /XYZ null top null]` for a place `y` points down the page (no `y`: the page, as it is shown now). */
export function makeDest(o: Overlay, page: PdfRef, y?: number): PdfObj[] {
  const top = y === undefined ? null : Math.round((visibleBox(o, page)[3] - y) * 1000) / 1000;
  return [new PdfRef(page.num, page.gen), PdfName.of("XYZ"), null, top, null];
}

// ---- taking out references to removed pages -----------------------------------------------------------------------

/**
 * Removes everything in the file that goes to one of the pages in `removed` (object numbers): link destinations and
 * GoTo actions on the pages that stay, the open action, named destinations and article threads. Without this a
 * deleted page would stay reachable (and so in the file) through a link to it.
 */
export function scrubRemovedPages(o: Overlay, removed: ReadonlySet<number>, kept: readonly PdfRef[]): void {
  if (removed.size === 0) return;
  const names = namedDests(o, false);
  const goesToRemoved = (value: PdfObj | undefined): boolean => {
    const n = destPageNum(o, value, names);
    return n !== undefined && removed.has(n);
  };
  const actionGoesToRemoved = (a: PdfObj | undefined): boolean => {
    const d = o.get(a);
    return isDict(d) && isName(o.get(d.get("S")), "GoTo") && goesToRemoved(d.get("D"));
  };
  const dictGoesToRemoved = (d: PdfDict): boolean => (d.has("Dest") && goesToRemoved(d.get("Dest"))) || (d.has("A") && actionGoesToRemoved(d.get("A")));
  const fix = (d: PdfDict): void => {
    if (d.has("Dest") && goesToRemoved(d.get("Dest"))) d.delete("Dest");
    if (d.has("A") && actionGoesToRemoved(d.get("A"))) d.delete("A");
  };

  // Links (and any annotation with a destination) on the pages that stay.
  for (const pageRef of kept) {
    const page = o.get(pageRef);
    if (!isDict(page)) continue;
    const annots = o.get(page.get("Annots"));
    if (!isArray(annots)) continue;
    annots.forEach((el, i) => {
      const target = o.get(el);
      if (!isDict(target) || !dictGoesToRemoved(target)) return;
      if (isRef(el)) fix(o.edit<PdfDict>(el));
      else {
        const arr = ensureArray(o, o.edit<PdfDict>(pageRef), "Annots");
        const direct = arr[i];
        if (isDict(direct)) fix(direct);
      }
    });
  }

  // The open action and the catalog's additional actions.
  const cat = o.catalog();
  const open = cat.get("OpenAction");
  if (open !== undefined && (isArray(o.get(open)) ? goesToRemoved(open) : actionGoesToRemoved(open))) o.editCatalog().delete("OpenAction");

  // Named destinations.
  const hits = [...names].filter(([, v]) => goesToRemoved(v)).map(([k]) => k);
  if (hits.length > 0) {
    const gone = new Set(hits);
    const catalog = o.editCatalog();
    const oldDests = catalog.get("Dests");
    if (oldDests !== undefined && isDict(o.get(oldDests))) {
      const d = isRef(oldDests) ? o.edit<PdfDict>(oldDests) : (oldDests as PdfDict);
      for (const k of [...d.map.keys()]) if (gone.has(k)) d.delete(k);
    }
    const namesEntry = catalog.get("Names");
    if (namesEntry !== undefined && isDict(o.get(namesEntry))) {
      const nd = isRef(namesEntry) ? o.edit<PdfDict>(namesEntry) : (namesEntry as PdfDict);
      const tree = nd.get("Dests");
      if (tree !== undefined && isDict(o.get(tree))) {
        const empty = pruneNameTree(o, tree, gone, true);
        if (empty) nd.delete("Dests");
      }
    }
  }

  // Article threads whose beads are on a removed page.
  const threads = o.get(cat.get("Threads"));
  if (isArray(threads)) {
    const keep = threads.filter((t) => !threadTouches(o, t, removed));
    if (keep.length !== threads.length) {
      const c = o.editCatalog();
      if (keep.length === 0) c.delete("Threads");
      else c.set("Threads", keep.map((t) => t));
    }
  }
}

function threadTouches(o: Overlay, thread: PdfObj, removed: ReadonlySet<number>): boolean {
  const t = o.get(thread);
  if (!isDict(t)) return false;
  let bead = t.get("F");
  const start = isRef(bead) ? bead.num : -1;
  for (let i = 0; i < 100_000 && isRef(bead); i++) {
    const b = o.get(bead);
    if (!isDict(b)) return false;
    const p = b.get("P");
    if (isRef(p) && removed.has(p.num)) return true;
    bead = b.get("N") ?? null;
    if (isRef(bead) && bead.num === start) return false;
  }
  return false;
}

/** Removes entries named in `gone` from a name tree; returns whether the node is now empty. Limits are recomputed. */
function pruneNameTree(o: Overlay, node: PdfObj, gone: ReadonlySet<string>, isRoot: boolean): boolean {
  const d0 = o.get(node);
  if (!isDict(d0)) return true;
  const d = isRef(node) ? o.edit<PdfDict>(node) : (node as PdfDict);
  const leaf = o.get(d.get("Names"));
  let count = 0;
  if (isArray(leaf)) {
    const next: PdfObj[] = [];
    for (let i = 0; i + 1 < leaf.length; i += 2) {
      const key = treeKey(o.get(leaf[i]));
      if (key !== undefined && gone.has(key)) continue;
      next.push(leaf[i]!, leaf[i + 1] ?? null);
    }
    if (next.length !== leaf.length) {
      const arr = isRef(d.get("Names")) ? o.edit<PdfObj[]>(d.get("Names") as PdfRef) : (d.get("Names") as PdfObj[]);
      arr.length = 0;
      arr.push(...next);
    }
    count += next.length / 2;
    if (next.length > 0 && !isRoot) {
      const first = o.get(next[0]);
      const last = o.get(next[next.length - 2]);
      if (isString(first) && isString(last)) d.set("Limits", [first, last]);
    }
  }
  const kids = o.get(d.get("Kids"));
  if (isArray(kids)) {
    const keep: PdfObj[] = [];
    for (const k of kids) if (!pruneNameTree(o, k, gone, false)) keep.push(k);
    const arr = isRef(d.get("Kids")) ? o.edit<PdfObj[]>(d.get("Kids") as PdfRef) : (d.get("Kids") as PdfObj[]);
    arr.length = 0;
    arr.push(...keep);
    count += keep.length;
    if (keep.length > 0 && !isRoot) {
      const lo = o.get(keep[0]);
      const hi = o.get(keep[keep.length - 1]);
      const limits = (n: PdfObj): PdfObj[] | undefined => (isDict(n) && isArray(o.get(n.get("Limits"))) ? (o.get(n.get("Limits")) as PdfObj[]) : undefined);
      const a = limits(lo)?.[0];
      const b = limits(hi)?.[1];
      if (a !== undefined && b !== undefined) d.set("Limits", [a, b]);
    }
  }
  return count === 0;
}

