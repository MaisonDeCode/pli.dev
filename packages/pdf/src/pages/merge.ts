/**
 * Moving pages between files: merging another file in (`insertFromSource`), taking pages out into a new file
 * (`extractPages`, `splitPages`), and the headless `mergePdfs`.
 */
import { createId, PliError } from "@pli.dev/core";
import { readAnnotations, readThreads, threadIdOf } from "../annots/read";
import { PdfFile } from "../cos/file";
import { Overlay } from "../cos/overlay";
import { readFields } from "../forms/read";
import { MAIN_SOURCE, type Annotation, type FormField, type OutlineItem, type Page, type PdfDoc, type Source } from "../model";
import type { PdfOp } from "../ops";
import { pageId, readContext } from "../open";
import { savePdf } from "../saver";
import type { SaveOptions } from "../save";
import { emptyDoc, PdfSession } from "../session";
import { hashBytes } from "../sources";
import { eachOutlineItem, mapOutlinePages, pruneOutline, readOutline } from "./outline";

export interface InsertFromOptions {
  /** The position (0 first, default: the end) where the first inserted page goes. */
  at?: number;
  /** Instead of `at`: the page the new pages follow (`null`: at the start). */
  after?: string | null;
  /** The pages of the other file to take (0-based, in this order). All of them by default. */
  pages?: readonly number[];
  /** The other file's name, kept in `PdfDoc.sources`. */
  name?: string;
  /** The password of an encrypted file. */
  password?: string;
  /** Take the annotations of the pages along (default true). */
  annotations?: boolean;
  /** Take the form fields on the pages along (default true). */
  fields?: boolean;
  /** Take the file's bookmarks along, for the pages taken (default true). */
  outline?: boolean;
  /** Add a bookmark for the inserted file at the top level (its own bookmarks go under it). `true` uses the file's name. */
  bookmark?: boolean | string;
}

const stripName = (name: string): string => name.replace(/\.pdf$/i, "");

/** A copy of an annotation read from another file: a new id (and a thread and replies that follow it), nothing that ties it to that file. */
function freshAnnot(a: Annotation, pageMap: ReadonlyMap<string, string>): Annotation | undefined {
  const { ref: _ref, thread, replies, ...rest } = a;
  const id = createId("a_");
  const next = { ...rest, id } as Annotation;
  if (thread) next.thread = threadIdOf(id);
  if (replies) next.replies = replies.map(({ ref: _r, ...reply }) => ({ ...reply, id: createId("c_") }));
  if (next.type === "link" && next.dest) {
    const page = pageMap.get(next.dest.page);
    if (page) next.dest = { ...next.dest, page };
    else {
      const { dest: _d, ...link } = next;
      if (link.uri === undefined) return undefined;
      return link as Annotation;
    }
  }
  return next;
}

/** The position of the first page an outline item (or one below it) goes to, or Infinity. */
function outlineStart(item: OutlineItem, position: ReadonlyMap<string, number>): number {
  let best = Infinity;
  eachOutlineItem([item], (i) => {
    const p = i.dest ? position.get(i.dest.page) : undefined;
    if (p !== undefined && p < best) best = p;
  });
  return best;
}

/**
 * Adds pages of another PDF file to the document (merge). The file becomes a new `Source` (its bytes go to the
 * session's source store), the pages are inserted with fresh ids, and their annotations, form fields and bookmarks
 * come along. One undo step. Returns the new page ids.
 */
export async function insertFromSource(session: PdfSession, source: Uint8Array | PdfFile | PdfSession, options: InsertFromOptions = {}): Promise<string[]> {
  let bytes: Uint8Array;
  let file: PdfFile;
  let name = options.name;
  if (source instanceof PdfFile) {
    file = source;
    bytes = source.bytes;
  } else if (source instanceof Uint8Array) {
    bytes = source;
    file = PdfFile.open(bytes, { password: options.password });
  } else {
    bytes = await source.save();
    file = PdfFile.open(bytes);
    name ??= source.doc.name;
  }
  name ??= "document.pdf";
  const infos = file.pages();
  if (infos.length === 0) throw new PliError("invalid_document", "this PDF has no pages");
  const wanted = options.pages ?? infos.map((_, i) => i);
  for (const i of wanted) if (!Number.isInteger(i) || i < 0 || i >= infos.length) throw new PliError("out_of_range", `the file has no page ${i + 1}`);
  if (wanted.length === 0) return [];

  const doc = session.doc;
  // Where it goes.
  let after: string | null;
  if (options.after !== undefined) {
    if (options.after !== null && !doc.pages.some((p) => p.id === options.after)) throw new PliError("not_found", `page ${options.after} not found`);
    after = options.after;
  } else if (options.at !== undefined) {
    const at = Math.max(0, Math.min(Math.floor(options.at), doc.pages.length));
    after = at === 0 ? null : doc.pages[at - 1]!.id;
  } else after = doc.pages[doc.pages.length - 1]?.id ?? null;

  // The source: an encrypted file is kept as a new, unencrypted file (the saver opens sources without a password).
  const stored = file.encrypted ? new Overlay(file).rewrite() : bytes;
  const hash = hashBytes(stored);
  const ops: PdfOp[] = [];
  let src: Source | undefined = doc.sources.find((s) => s.hash === hash && s.pages === infos.length);
  if (!src) {
    src = { id: createId("s_"), name, pages: infos.length, size: stored.length, hash };
    const put = await session.sources.put(src, stored);
    if (put && typeof put === "object" && "location" in put && put.location) src = { ...src, location: put.location };
    ops.push({ type: "insert_source", source: src });
  }
  const sid = src.id;

  // The pages.
  const ctx = readContext(file, sid);
  const pageMap = new Map<string, string>();
  const pages: Page[] = wanted.map((index) => {
    const info = infos[index]!;
    const id = createId("p_");
    const readId = pageId(sid, index);
    if (!pageMap.has(readId)) pageMap.set(readId, id);
    const [x0, y0, x1, y1] = info.cropBox;
    return { id, from: { source: sid, index }, width: x1 - x0, height: y1 - y0, rotate: info.rotate, annots: [] };
  });
  if (options.annotations !== false) {
    pages.forEach((page, k) => {
      const info = infos[wanted[k]!]!;
      let read: Annotation[] = [];
      try {
        read = readAnnotations(ctx, info, pageId(sid, info.index));
      } catch {
        read = [];
      }
      page.annots = read.flatMap((a) => {
        const f = freshAnnot(a, pageMap);
        return f ? [f] : [];
      });
    });
  }
  pages.forEach((page, k) => {
    ops.push({ type: "insert_page", page, after: k === 0 ? after : pages[k - 1]!.id });
  });
  // Comment threads of those annotations.
  for (const thread of Object.values(readThreads(pages))) ops.push({ type: "set_thread", id: thread.id, thread });

  // Form fields on those pages.
  if (options.fields !== false) {
    let fields: FormField[] = [];
    try {
      fields = readFields(ctx);
    } catch {
      fields = [];
    }
    const names = new Set(doc.fields.map((f) => f.name));
    for (const f of fields) {
      const { ref: _ref, ...rest } = f;
      const widgets = f.widgets.flatMap((w) => {
        const page = pageMap.get(w.page);
        if (!page) return [];
        const { ref: _wref, ...wr } = w;
        return [{ ...wr, id: createId("w_"), page }];
      });
      if (widgets.length === 0) continue;
      let fieldName = f.name;
      for (let k = 2; names.has(fieldName); k++) fieldName = `${f.name}_${k}`;
      names.add(fieldName);
      ops.push({ type: "insert_field", field: { ...rest, id: createId("f_"), name: fieldName, widgets } });
    }
  }

  // Bookmarks.
  const wantOutline = options.outline !== false;
  let added: OutlineItem[] = [];
  if (wantOutline) {
    try {
      added = pruneOutline(
        mapOutlinePages(readOutline(ctx), (p) => pageMap.get(p), () => createId("o_")),
        new Set(pages.map((p) => p.id)),
      );
    } catch {
      added = [];
    }
  }
  if (options.bookmark) {
    const title = typeof options.bookmark === "string" ? options.bookmark : stripName(name);
    added = [{ id: createId("o_"), title, dest: { page: pages[0]!.id }, children: added, ...(added.length > 0 ? { open: true } : {}) }];
  }
  if (added.length > 0) {
    const order = doc.pages.map((p) => p.id);
    const at = after === null ? 0 : order.indexOf(after) + 1;
    order.splice(at, 0, ...pages.map((p) => p.id));
    const position = new Map(order.map((id, i) => [id, i] as const));
    const last = at + pages.length - 1;
    let index = doc.outline.findIndex((item) => {
      const s = outlineStart(item, position);
      return s !== Infinity && s > last;
    });
    if (index < 0) index = doc.outline.length;
    ops.push({ type: "set_outline", items: [...doc.outline.slice(0, index), ...added, ...doc.outline.slice(index)] });
  }

  const ids = pages.map((p) => p.id);
  session.transact(ops, { selection: { page: ids[0]!, annots: [], pages: ids } });
  return ids;
}

// ---- extract and split ---------------------------------------------------------------------------------------------

/** The document with only these pages: their fields, the bookmarks that go to them, their comment threads. */
export function subsetDoc(doc: PdfDoc, keep: ReadonlySet<string>): PdfDoc {
  const pages = doc.pages.filter((p) => keep.has(p.id));
  const used = new Set(pages.flatMap((p) => (p.from ? [p.from.source] : [])));
  const fields = doc.fields.flatMap((f) => {
    const widgets = f.widgets.filter((w) => keep.has(w.page));
    return widgets.length === 0 ? [] : [widgets.length === f.widgets.length ? f : { ...f, widgets }];
  });
  const next: PdfDoc = { ...doc, sources: doc.sources.filter((s) => used.has(s.id)), pages, outline: pruneOutline(doc.outline, keep), fields };
  if (doc.comments) {
    const comments = Object.fromEntries(Object.entries(doc.comments).filter(([, t]) => !t.anchor || keep.has(t.anchor.page)));
    if (Object.keys(comments).length > 0) next.comments = comments;
    else delete next.comments;
  }
  return next;
}

/** A new PDF with only these pages (in document order) and what belongs to them. */
export async function extractPages(session: PdfSession, ids: readonly string[], options: SaveOptions = {}): Promise<Uint8Array> {
  const have = new Set(session.doc.pages.map((p) => p.id));
  for (const id of ids) if (!have.has(id)) throw new PliError("not_found", `page ${id} not found`);
  const sub = subsetDoc(session.doc, new Set(ids));
  if (sub.pages.length === 0) throw new PliError("invalid_operation", "there are no pages to extract");
  const tmp = new PdfSession(sub, { ...session.options, sources: session.sources });
  if (sub.sources.some((s) => s.id === MAIN_SOURCE)) tmp.baseline = session.baseline;
  tmp.saver = savePdf;
  return tmp.save({ ...options, mode: options.mode === "optimise" ? "optimise" : "rewrite" });
}

/** Page ranges, 1-based: `"1-3,5,8-"`, or a list of page numbers and `[from, to]` pairs. */
export type PageRanges = string | readonly (number | readonly [number, number])[];

/** How to cut a document into several: by ranges, every `n` pages, or at the bookmarks of a level (1 is the top level). */
export type SplitSpec = { ranges: PageRanges } | { every: number } | { outline: number | true };

export function parseRanges(ranges: PageRanges, count: number): [number, number][] {
  const out: [number, number][] = [];
  const check = (n: number): number => {
    if (!Number.isInteger(n) || n < 1 || n > count) throw new PliError("out_of_range", `the document has no page ${n}`);
    return n;
  };
  if (typeof ranges === "string") {
    for (const token of ranges.split(",").map((t) => t.trim()).filter(Boolean)) {
      const m = /^(\d*)\s*(-?)\s*(\d*)$/.exec(token);
      if (!m || (m[1] === "" && m[3] === "")) throw new PliError("invalid_operation", `cannot read the page range "${token}"`);
      const a = m[1] === "" ? 1 : Number(m[1]);
      const b = m[2] === "" ? a : m[3] === "" ? count : Number(m[3]);
      out.push([Math.min(check(a), check(b)), Math.max(a, b)]);
    }
  } else {
    for (const r of ranges) {
      const [a, b] = typeof r === "number" ? [r, r] : r;
      out.push([Math.min(check(a), check(b)), Math.max(a, b)]);
    }
  }
  return out;
}

/** The page ids of each part a split makes. */
export function splitPlan(doc: PdfDoc, spec: SplitSpec): string[][] {
  const ids = doc.pages.map((p) => p.id);
  if ("ranges" in spec) return parseRanges(spec.ranges, ids.length).map(([a, b]) => ids.slice(a - 1, b));
  if ("every" in spec) {
    const n = Math.floor(spec.every);
    if (!(n >= 1)) throw new PliError("invalid_operation", "split every n pages needs n of at least 1");
    const out: string[][] = [];
    for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
    return out;
  }
  const level = spec.outline === true ? 1 : Math.max(1, Math.floor(spec.outline));
  const position = new Map(ids.map((id, i) => [id, i] as const));
  const starts = new Set<number>();
  eachOutlineItem(doc.outline, (item, depth) => {
    const p = item.dest ? position.get(item.dest.page) : undefined;
    if (depth === level - 1 && p !== undefined) starts.add(p);
  });
  const sorted = [...starts].sort((a, b) => a - b);
  if (sorted.length === 0) return [ids];
  if (sorted[0] !== 0) sorted.unshift(0);
  return sorted.map((s, i) => ids.slice(s, sorted[i + 1] ?? ids.length));
}

/** Cuts the document into several PDF files. */
export async function splitPages(session: PdfSession, spec: SplitSpec, options: SaveOptions = {}): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const ids of splitPlan(session.doc, spec)) out.push(await extractPages(session, ids, options));
  return out;
}

// ---- merge ---------------------------------------------------------------------------------------------------------

export interface MergeOptions {
  /** The files' names, for the bookmarks and the sources. */
  names?: readonly string[];
  /** A top-level bookmark for every file (its own bookmarks under it). */
  bookmarks?: boolean;
  /** Keep the files' own bookmarks (default true). */
  outline?: boolean;
  /** Passwords for encrypted files, by position. */
  passwords?: readonly (string | undefined)[];
}

/** Puts PDF files one after the other in a new PDF. Headless: no session needed. */
export async function mergePdfs(files: readonly Uint8Array[], options: MergeOptions = {}): Promise<Uint8Array> {
  if (files.length === 0) throw new PliError("invalid_operation", "there are no files to merge");
  const session = new PdfSession(emptyDoc());
  session.saver = savePdf;
  for (let i = 0; i < files.length; i++) {
    await insertFromSource(session, files[i]!, { name: options.names?.[i] ?? `document-${i + 1}.pdf`, bookmark: options.bookmarks === true, outline: options.outline, password: options.passwords?.[i] });
  }
  return session.save();
}
