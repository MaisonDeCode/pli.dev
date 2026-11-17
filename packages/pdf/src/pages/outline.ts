/**
 * The outline (bookmarks): reading the `/Outlines` tree into `OutlineItem`s, writing them back, and the pure helpers
 * the commands and the page operations use to change an outline tree.
 */
import type { ReadContext, WriteContext } from "../context";
import { PdfDict, PdfName, PdfRef, PdfString, isArray, isDict, isName, isRef, isString, pdfText, textOf } from "../cos/objects";
import type { PdfObj } from "../cos/objects";
import type { OutlineItem } from "../model";
import { makeDest, resolveDest } from "./dest";

// ---- reading -------------------------------------------------------------------------------------------------------

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0");

/** The outline (bookmarks) of a file, as JSON. Ids are `o:<path>` (`o:0.2.1`: the second child of the third child of the first item). */
export function readOutline(ctx: ReadContext): OutlineItem[] {
  const { file } = ctx;
  let root: PdfObj;
  try {
    root = file.get(file.catalog().get("Outlines"));
  } catch {
    return [];
  }
  if (!isDict(root)) return [];
  const seen = new Set<number>();
  let budget = 200_000;
  const level = (first: PdfObj | undefined, path: number[], depth: number): OutlineItem[] => {
    const items: OutlineItem[] = [];
    let ref = first;
    while (isRef(ref) && budget-- > 0) {
      if (seen.has(ref.num)) break;
      seen.add(ref.num);
      const d = file.get(ref);
      if (!isDict(d)) break;
      const p = [...path, items.length];
      const titleObj = file.get(d.get("Title"));
      const item: OutlineItem = { id: `o:${p.join(".")}`, title: isString(titleObj) ? textOf(titleObj) : "", children: [] };
      const target = destOf(ctx, d);
      if (target.dest) item.dest = target.dest;
      if (target.uri) item.uri = target.uri;
      const color = file.get(d.get("C"));
      if (isArray(color) && color.length >= 3) {
        const c = color.slice(0, 3).map((v) => file.get(v));
        if (c.every((v) => typeof v === "number") && c.some((v) => v !== 0)) item.color = `#${hex2(c[0] as number)}${hex2(c[1] as number)}${hex2(c[2] as number)}`;
      }
      const flags = file.get(d.get("F"));
      if (typeof flags === "number") {
        if (flags & 1) item.italic = true;
        if (flags & 2) item.bold = true;
      }
      if (depth < 64 && isRef(d.get("First"))) item.children = level(d.get("First"), p, depth + 1);
      const count = file.get(d.get("Count"));
      if (item.children.length > 0) item.open = !(typeof count === "number" && count < 0);
      items.push(item);
      ref = d.get("Next");
    }
    return items;
  };
  return level(root.get("First"), [], 0);
}

function destOf(ctx: ReadContext, d: PdfDict): { dest?: { page: string; y?: number }; uri?: string } {
  const { file } = ctx;
  if (d.has("Dest")) {
    const r = resolveDest(ctx, d.get("Dest"));
    if (r) return { dest: r };
  }
  const a = file.get(d.get("A"));
  if (isDict(a)) {
    const s = file.get(a.get("S"));
    if (isName(s, "GoTo")) {
      const r = resolveDest(ctx, a.get("D"));
      if (r) return { dest: r };
    } else if (isName(s, "URI")) {
      const u = file.get(a.get("URI"));
      if (isString(u)) return { uri: textOf(u) };
    }
  }
  return {};
}

// ---- tree helpers (pure) -------------------------------------------------------------------------------------------

/** Where an item is: its parent (null at the top), its position in the parent's children, and the list that holds it. */
export interface OutlineSite {
  item: OutlineItem;
  parent: OutlineItem | null;
  index: number;
  siblings: readonly OutlineItem[];
}

export function findOutlineItem(items: readonly OutlineItem[], id: string, parent: OutlineItem | null = null): OutlineSite | undefined {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.id === id) return { item, parent, index: i, siblings: items };
    const found = findOutlineItem(item.children, id, item);
    if (found) return found;
  }
  return undefined;
}

/** Every item, depth first. */
export function eachOutlineItem(items: readonly OutlineItem[], visit: (item: OutlineItem, depth: number) => void, depth = 0): void {
  for (const item of items) {
    visit(item, depth);
    eachOutlineItem(item.children, visit, depth + 1);
  }
}

/** The tree with the item `id` replaced by `fn(item)` (taken out when `fn` returns null, replaced by several when it returns a list). Untouched branches are shared. */
export function mapOutlineItem(items: readonly OutlineItem[], id: string, fn: (item: OutlineItem) => OutlineItem | OutlineItem[] | null): OutlineItem[] {
  let changed = false;
  const out: OutlineItem[] = [];
  for (const item of items) {
    if (item.id === id) {
      changed = true;
      const next = fn(item);
      if (Array.isArray(next)) out.push(...next);
      else if (next) out.push(next);
      continue;
    }
    const children = mapOutlineItem(item.children, id, fn);
    if (children !== item.children) {
      changed = true;
      out.push({ ...item, children });
    } else out.push(item);
  }
  return changed ? out : (items as OutlineItem[]);
}

/** The tree with `item` put at `index` (end by default) among the children of `parentId` (null: the top level). */
export function insertOutlineItem(items: readonly OutlineItem[], parentId: string | null, index: number | undefined, item: OutlineItem): OutlineItem[] {
  const put = (list: readonly OutlineItem[]): OutlineItem[] => {
    const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, at), item, ...list.slice(at)];
  };
  if (parentId === null) return put(items);
  return mapOutlineItem(items, parentId, (p) => ({ ...p, children: put(p.children), open: p.open ?? true }));
}

/**
 * The outline without the items that go to pages that are not in `pages`. The children of a dropped item move up to
 * take its place, so the bookmarks below a deleted chapter heading are not lost with it. Items that have no
 * destination at all (plain headings) stay.
 */
export function pruneOutline(items: readonly OutlineItem[], pages: ReadonlySet<string>): OutlineItem[] {
  let changed = false;
  const out: OutlineItem[] = [];
  for (const item of items) {
    const children = pruneOutline(item.children, pages);
    const dangling = item.dest !== undefined && !pages.has(item.dest.page) && item.uri === undefined;
    if (dangling) {
      changed = true;
      out.push(...children);
      continue;
    }
    if (children !== item.children) {
      changed = true;
      const next = { ...item, children };
      if (children.length === 0) delete next.open;
      out.push(next);
    } else out.push(item);
  }
  return changed ? out : (items as OutlineItem[]);
}

/** The same tree with every item's destination page changed by `map` (return undefined to take the destination off). */
export function mapOutlinePages(items: readonly OutlineItem[], map: (page: string) => string | undefined, newId: (item: OutlineItem) => string = (i) => i.id): OutlineItem[] {
  return items.map((item) => {
    const { dest, ...rest } = item;
    const page = dest ? map(dest.page) : undefined;
    const next: OutlineItem = { ...rest, id: newId(item), children: mapOutlinePages(item.children, map, newId) };
    if (dest && page !== undefined) next.dest = { ...dest, page };
    return next;
  });
}

// ---- writing -------------------------------------------------------------------------------------------------------

const canonical = (items: readonly OutlineItem[]): string => JSON.stringify(items);

/** How many items an open item shows below it (the items of open children count their own children too). */
function visibleBelow(item: OutlineItem): number {
  let n = 0;
  for (const c of item.children) n += 1 + (c.open === false ? 0 : visibleBelow(c));
  return n;
}

function asciiUri(uri: string): PdfString {
  return pdfText(/^[\x20-\x7e]*$/.test(uri) ? uri : encodeURI(uri));
}

/** Writes the outline if it changed. Items that go to pages that are no longer in the document are dropped. */
export function writeOutline(ctx: WriteContext): void {
  const { doc, baseline, overlay, main, pageRefs } = ctx;
  const items = pruneOutline(doc.outline, new Set(pageRefs.keys()));
  if (main && canonical(items) === canonical(baseline.outline)) return;
  if (!main && items.length === 0) return;
  const catalog = overlay.editCatalog();
  const old = catalog.get("Outlines");
  if (items.length === 0) {
    catalog.delete("Outlines");
  } else {
    const rootRef = overlay.add(new PdfDict());
    const make = (list: readonly OutlineItem[], parent: PdfRef): PdfRef[] => {
      const refs = list.map(() => overlay.add(new PdfDict()));
      list.forEach((item, i) => {
        const d = new PdfDict();
        d.set("Title", pdfText(item.title));
        d.set("Parent", parent);
        if (i > 0) d.set("Prev", refs[i - 1]!);
        if (i < list.length - 1) d.set("Next", refs[i + 1]!);
        if (item.children.length > 0) {
          const kids = make(item.children, refs[i]!);
          d.set("First", kids[0]!);
          d.set("Last", kids[kids.length - 1]!);
          const n = visibleBelow(item);
          d.set("Count", item.open === false ? -n : n);
        }
        if (item.dest && pageRefs.has(item.dest.page)) d.set("Dest", makeDest(overlay, pageRefs.get(item.dest.page)!, item.dest.y));
        else if (item.uri) d.set("A", new PdfDict({ S: PdfName.of("URI"), URI: asciiUri(item.uri) }));
        if (item.color && /^#[0-9a-f]{6}$/i.test(item.color)) {
          const v = item.color.slice(1);
          const c = [0, 2, 4].map((k) => Math.round((parseInt(v.slice(k, k + 2), 16) / 255) * 1000) / 1000);
          if (c.some((x) => x !== 0)) d.set("C", c);
        }
        const flags = (item.italic ? 1 : 0) | (item.bold ? 2 : 0);
        if (flags) d.set("F", flags);
        overlay.set(refs[i]!, d);
      });
      return refs;
    };
    const top = make(items, rootRef);
    overlay.set(rootRef, new PdfDict({ Type: PdfName.of("Outlines"), First: top[0]!, Last: top[top.length - 1]!, Count: visibleBelow({ id: "", title: "", children: items as OutlineItem[] }) }));
    catalog.set("Outlines", rootRef);
  }
  // The old tree is no longer linked: free it, so it is not carried along.
  if (isRef(old)) freeOutlineTree(ctx, old);
}

function freeOutlineTree(ctx: WriteContext, root: PdfRef): void {
  const { overlay } = ctx;
  const seen = new Set<number>();
  const walk = (ref: PdfObj | undefined, depth: number): void => {
    let r = ref;
    while (isRef(r) && !seen.has(r.num) && depth < 64) {
      seen.add(r.num);
      const d = overlay.get(r);
      if (!isDict(d) || !(d.has("Title") || isName(d.get("Type"), "Outlines"))) return;
      walk(d.get("First"), depth + 1);
      const next = d.get("Next");
      overlay.remove(r);
      r = next;
    }
  };
  walk(root, 0);
}
