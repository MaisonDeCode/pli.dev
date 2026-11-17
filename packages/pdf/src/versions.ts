import { VersionHistory, canonicalJson, type DiffSummary, type Users, type VersionStorage, type VersionSupport } from "@pli.dev/core";
import type { Annotation, FormField, Page, PdfDoc, Source } from "./model";
import { pdfReducer, type PagePatch, type PdfOp } from "./ops";
import type { PdfSelection, PdfSession } from "./session";
import { hashPdfDoc } from "./sync";

/**
 * Named versions of a PDF. A version is the `PdfDoc` as it was (plain JSON: no file bytes, sources by hash), and restoring
 * one is an ordinary list of PDF operations, so it is one undo step, is merged with what other people are doing, and is sent
 * to everyone like any other edit.
 *
 * What a restore does not bring back: the document's `id` (it names the file, not its content), and anything held outside
 * the JSON. Pages that come from a source file need the bytes of that file in the session's `SourceStore`: a version keeps
 * the source entry (name, hash, size), never the bytes. A restore of pages of a source that this session never held, and
 * that the store cannot give, still produces the right operations; the pages show "Waiting for the file" until the store
 * has the bytes (see `storageSources`), exactly like pages a peer merged in.
 */

/** Equal as JSON, whatever the order of keys, with `undefined` the same as absent. */
const same = (a: unknown, b: unknown): boolean => a === b || canonicalJson(a) === canonicalJson(b);

/** The ids of a longest increasing run of `order` (the target position of each kept item, in the order they are now): these stay where they are, everything else is moved. */
function stayers(ids: readonly string[], order: readonly number[]): Set<string> {
  const tails: number[] = []; // index into `order` of the smallest tail of an increasing run of each length
  const back: number[] = new Array(order.length).fill(-1);
  for (let i = 0; i < order.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (order[tails[mid]!]! < order[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<string>();
  for (let i = tails.length > 0 ? tails[tails.length - 1]! : -1; i >= 0; i = back[i]!) keep.add(ids[i]!);
  return keep;
}

const keysOf = (a: object | undefined, b: object | undefined): string[] => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];

/** What to patch on `from` to make it `to`: the keys that differ, with `null` for a key that goes. */
function diffPatch(from: object, to: object, skip: readonly string[] = []): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of keysOf(from, to)) {
    if (skip.includes(key)) continue;
    const a = (from as Record<string, unknown>)[key];
    const b = (to as Record<string, unknown>)[key];
    if (!same(a, b)) patch[key] = b === undefined ? null : b;
  }
  return patch;
}

function sourceOps(current: readonly Source[], target: readonly Source[]): PdfOp[] {
  const ops: PdfOp[] = [];
  const want = new Map(target.map((s) => [s.id, s]));
  const have = new Map(current.map((s) => [s.id, s]));
  // Sources are listed in the order they were added. Keep the ones that are already in the right order, re-add the rest.
  const kept = current.filter((s) => want.has(s.id));
  let k = 0;
  while (k < kept.length && k < target.length && kept[k]!.id === target[k]!.id) k++;
  const again = new Set([...kept.slice(k).map((s) => s.id)]);
  for (const s of current) if (!want.has(s.id) || again.has(s.id)) ops.push({ type: "remove_source", id: s.id });
  for (const s of kept.slice(0, k)) {
    const patch = diffPatch(have.get(s.id)!, want.get(s.id)!, ["id"]);
    if (Object.keys(patch).length > 0) ops.push({ type: "patch_source", id: s.id, patch: patch as never });
  }
  for (const s of target.slice(k)) ops.push({ type: "insert_source", source: s });
  return ops;
}

/**
 * The operations that turn `current` into `target`, for `VersionHistory.restore`. Only what differs is touched: a page or an
 * annotation that is the same in both is left alone; things only in `current` are removed; things only in `target` are
 * inserted where they were (positions are given by the thing they follow, so pages and annotations come back in the order
 * of the version, and a restore merges with other people's edits like any edit). Apply them with `pdfReducer` (or
 * `session.transact`) and the document equals `target`, apart from its `id`. An empty `comments` or `edits` is the same as none.
 */
export function restorePdfOps(current: PdfDoc, target: PdfDoc): PdfOp[] {
  const ops: PdfOp[] = [];
  let doc = current;
  const emit = (op: PdfOp): void => {
    doc = pdfReducer.apply(doc, op).state;
    ops.push(op);
  };

  for (const op of sourceOps(current.sources, target.sources)) emit(op);

  // ---- the name and the document properties
  const meta = diffPatch(doc.meta, target.meta);
  if (!same(doc.name, target.name)) meta.name = target.name ?? null;
  if (Object.keys(meta).length > 0) emit({ type: "set_meta", patch: meta as never });

  // ---- pages: first take away what the version does not have, then put things in order
  const wantPage = new Map(target.pages.map((p) => [p.id, p]));
  for (let i = doc.pages.length - 1; i >= 0; i--) {
    const page = doc.pages[i]!;
    const want = wantPage.get(page.id);
    if (!want || !same(page.from, want.from)) emit({ type: "remove_page", id: page.id, prev: doc.pages[i - 1]?.id ?? null });
  }
  // Annotations that are on another page in the version (or not in it) go; a page's own removal already took its own.
  const wantAnnotPage = new Map<string, string>();
  for (const page of target.pages) for (const a of page.annots) wantAnnotPage.set(a.id, page.id);
  for (const page of [...doc.pages]) {
    for (let i = page.annots.length - 1; i >= 0; i--) {
      const a = page.annots[i]!;
      if (wantAnnotPage.get(a.id) !== page.id) emit({ type: "remove_annot", page: page.id, id: a.id, prev: page.annots[i - 1]?.id ?? null });
    }
  }
  const here = new Map(doc.pages.map((p) => [p.id, p]));
  const targetIndex = new Map(target.pages.map((p, i) => [p.id, i]));
  const stay = stayers(
    doc.pages.map((p) => p.id),
    doc.pages.map((p) => targetIndex.get(p.id)!),
  );
  let before: string | null = null;
  for (const want of target.pages) {
    const page = here.get(want.id);
    if (!page) {
      emit({ type: "insert_page", page: want, after: before });
    } else {
      if (!stay.has(want.id)) emit({ type: "move_page", id: want.id, after: before });
      const patch: PagePatch = {};
      if (page.rotate !== want.rotate) patch.rotate = want.rotate;
      if (page.width !== want.width) patch.width = want.width;
      if (page.height !== want.height) patch.height = want.height;
      if (page.label !== want.label) patch.label = want.label ?? null;
      if (Object.keys(patch).length > 0) emit({ type: "patch_page", id: want.id, patch });
      if (!same(page.edits ?? [], want.edits ?? [])) emit({ type: "set_edits", page: want.id, edits: want.edits ?? [] });
      annotOps(page, want, emit);
    }
    before = want.id;
  }

  // ---- form fields
  const wantField = new Map(target.fields.map((f) => [f.id, f]));
  for (let i = doc.fields.length - 1; i >= 0; i--) {
    const f = doc.fields[i]!;
    if (!wantField.has(f.id)) emit({ type: "remove_field", id: f.id, prev: doc.fields[i - 1]?.id ?? null });
  }
  const haveField = new Map(doc.fields.map((f) => [f.id, f]));
  const fieldIndex = new Map(target.fields.map((f, i) => [f.id, i]));
  const fieldStay = stayers(
    doc.fields.map((f) => f.id),
    doc.fields.map((f) => fieldIndex.get(f.id)!),
  );
  let fieldBefore: string | null = null;
  for (const want of target.fields) {
    const field = haveField.get(want.id);
    if (!field) emit({ type: "insert_field", field: want, after: fieldBefore });
    else if (!fieldStay.has(want.id)) {
      // There is no "move field": take it out and put it back (its widgets and value come along).
      const at = doc.fields.findIndex((f) => f.id === want.id);
      emit({ type: "remove_field", id: want.id, prev: doc.fields[at - 1]?.id ?? null });
      emit({ type: "insert_field", field: want, after: fieldBefore });
    } else if (!same(field, want)) {
      if (same({ ...field, value: want.value }, want)) emit({ type: "set_value", id: want.id, value: want.value });
      else emit({ type: "replace_field", field: want });
    }
    fieldBefore = want.id;
  }

  // ---- bookmarks, comment threads
  if (!same(doc.outline, target.outline)) emit({ type: "set_outline", items: target.outline });
  const threadsNow = doc.comments ?? {};
  const threadsWant = target.comments ?? {};
  for (const id of Object.keys(threadsNow)) if (!(id in threadsWant)) emit({ type: "set_thread", id, thread: null });
  for (const [id, thread] of Object.entries(threadsWant)) if (!same(threadsNow[id], thread)) emit({ type: "set_thread", id, thread });
  return ops;
}

/** The operations that make the annotations of `page` (already holding only annotations the version has on it) the same as `want`'s. */
function annotOps(page: Page, want: Page, emit: (op: PdfOp) => void): void {
  const index = new Map(want.annots.map((a, i) => [a.id, i]));
  const have = new Map(page.annots.map((a) => [a.id, a]));
  const stay = stayers(
    page.annots.map((a) => a.id),
    page.annots.map((a) => index.get(a.id)!),
  );
  let before: string | null = null;
  for (const annot of want.annots) {
    const old: Annotation | undefined = have.get(annot.id);
    if (!old) emit({ type: "insert_annot", page: page.id, annot, after: before });
    else {
      if (!stay.has(annot.id)) emit({ type: "move_annot", id: annot.id, after: before });
      if (!same(old, annot)) emit({ type: "replace_annot", annot });
    }
    before = annot.id;
  }
}

// ---- Saying what changed -------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const isEmptyValue = (value: FormField["value"]): boolean => value === null || value === "" || value === false || (Array.isArray(value) && value.length === 0);

/**
 * One line for what a list of operations does to the document `before`: "Added 3 annotations, deleted page 4". Pages are
 * numbered by where they were when the operation came up (the document is followed through the list). An empty list is
 * "No changes".
 */
export function summarizePdfOps(ops: readonly PdfOp[], before: PdfDoc): string {
  return describe(ops, before).line;
}

interface Described {
  line: string;
  added: number;
  removed: number;
  changed: number;
}

function describe(ops: readonly PdfOp[], start: PdfDoc): Described {
  let doc = start;
  const sets = {
    pagesAdded: [] as number[],
    pagesRemoved: [] as number[],
    pagesMoved: new Set<string>(),
    rotated: new Set<string>(),
    relabelled: new Set<string>(),
    resized: new Set<string>(),
    annotsAdded: new Set<string>(),
    annotsRemoved: new Set<string>(),
    annotsChanged: new Set<string>(),
    annotsMoved: new Set<string>(),
    filled: new Set<string>(),
    cleared: new Set<string>(),
    fieldsAdded: new Set<string>(),
    fieldsRemoved: new Set<string>(),
    fieldsChanged: new Set<string>(),
    edited: new Set<string>(),
    threads: new Set<string>(),
  };
  let outline = false;
  let meta = false;
  let sources = false;
  for (const op of ops) {
    switch (op.type) {
      case "insert_page": {
        doc = pdfReducer.apply(doc, op).state;
        sets.pagesAdded.push(doc.pages.findIndex((p) => p.id === op.page.id) + 1);
        continue;
      }
      case "remove_page": {
        sets.pagesRemoved.push(doc.pages.findIndex((p) => p.id === op.id) + 1);
        break;
      }
      case "move_page": sets.pagesMoved.add(op.id); break;
      case "patch_page":
        if (op.patch.rotate !== undefined) sets.rotated.add(op.id);
        if (op.patch.label !== undefined) sets.relabelled.add(op.id);
        if (op.patch.width !== undefined || op.patch.height !== undefined) sets.resized.add(op.id);
        break;
      case "set_edits": sets.edited.add(op.page); break;
      case "insert_annot": sets.annotsAdded.add(op.annot.id); break;
      case "remove_annot": sets.annotsRemoved.add(op.id); break;
      case "replace_annot": sets.annotsChanged.add(op.annot.id); break;
      case "move_annot": sets.annotsMoved.add(op.id); break;
      case "insert_field": sets.fieldsAdded.add(op.field.id); break;
      case "remove_field": sets.fieldsRemoved.add(op.id); break;
      case "replace_field": sets.fieldsChanged.add(op.field.id); break;
      case "set_value": (isEmptyValue(op.value) ? sets.cleared : sets.filled).add(op.id); break;
      case "set_outline": outline = true; break;
      case "set_meta": meta = true; break;
      case "set_thread": sets.threads.add(op.id); break;
      case "insert_source":
      case "remove_source":
      case "patch_source": sources = true; break;
    }
    doc = pdfReducer.apply(doc, op).state;
  }

  // An annotation taken off one page and put on another is moved, not added and deleted.
  const movedPage = [...sets.annotsAdded].filter((id) => sets.annotsRemoved.has(id));
  for (const id of movedPage) {
    sets.annotsAdded.delete(id);
    sets.annotsRemoved.delete(id);
    sets.annotsMoved.add(id);
  }
  // Something that is both added and changed (or moved) is just added.
  for (const id of sets.annotsAdded) {
    sets.annotsChanged.delete(id);
    if (!movedPage.includes(id)) sets.annotsMoved.delete(id);
  }
  const pageNames = (numbers: number[]): string => (numbers.length === 1 ? `page ${numbers[0]}` : `${numbers.length} pages`);

  const parts: string[] = [];
  // What was added, then what was changed, then what was taken away.
  if (sets.pagesAdded.length) parts.push(`added ${pageNames(sets.pagesAdded)}`);
  if (sets.annotsAdded.size) parts.push(`added ${plural(sets.annotsAdded.size, "annotation", "annotations")}`);
  if (sets.fieldsAdded.size) parts.push(`added ${plural(sets.fieldsAdded.size, "form field", "form fields")}`);
  if (sets.pagesMoved.size) parts.push(`moved ${plural(sets.pagesMoved.size, "page", "pages")}`);
  if (sets.rotated.size) parts.push(`rotated ${plural(sets.rotated.size, "page", "pages")}`);
  if (sets.resized.size) parts.push(`resized ${plural(sets.resized.size, "page", "pages")}`);
  if (sets.relabelled.size) parts.push(`renumbered ${plural(sets.relabelled.size, "page", "pages")}`);
  if (sets.annotsChanged.size) parts.push(`changed ${plural(sets.annotsChanged.size, "annotation", "annotations")}`);
  if (sets.annotsMoved.size) parts.push(`reordered ${plural(sets.annotsMoved.size, "annotation", "annotations")}`);
  if (sets.filled.size) parts.push(`filled ${plural(sets.filled.size, "form field", "form fields")}`);
  if (sets.cleared.size) parts.push(`cleared ${plural(sets.cleared.size, "form field", "form fields")}`);
  if (sets.fieldsChanged.size) parts.push(`changed ${plural(sets.fieldsChanged.size, "form field", "form fields")}`);
  if (sets.edited.size) parts.push(`edited the content of ${plural(sets.edited.size, "page", "pages")}`);
  if (outline) parts.push("changed the outline");
  if (meta) parts.push("changed the document properties");
  if (sets.threads.size) parts.push(`changed ${plural(sets.threads.size, "comment thread", "comment threads")}`);
  if (sets.pagesRemoved.length) parts.push(`deleted ${pageNames(sets.pagesRemoved)}`);
  if (sets.annotsRemoved.size) parts.push(`deleted ${plural(sets.annotsRemoved.size, "annotation", "annotations")}`);
  if (sets.fieldsRemoved.size) parts.push(`removed ${plural(sets.fieldsRemoved.size, "form field", "form fields")}`);
  if (parts.length === 0 && sources) parts.push("changed the files the pages come from");
  const line = parts.length === 0 ? "No changes" : parts.join(", ").replace(/^./, (c) => c.toUpperCase());
  return {
    line,
    added: sets.pagesAdded.length + sets.annotsAdded.size + sets.fieldsAdded.size,
    removed: sets.pagesRemoved.length + sets.annotsRemoved.size + sets.fieldsRemoved.size,
    changed: sets.pagesMoved.size + sets.rotated.size + sets.resized.size + sets.relabelled.size + sets.annotsChanged.size + sets.annotsMoved.size + sets.filled.size + sets.cleared.size + sets.fieldsChanged.size + sets.edited.size + sets.threads.size + (outline ? 1 : 0) + (meta ? 1 : 0),
  };
}

/** What differs between two versions of a document, for the history panel's "changes since this version": the line `summarizePdfOps` gives for the operations that turn `from` into `to`. */
export function summarizePdfDiff(from: PdfDoc, to: PdfDoc): DiffSummary {
  const d = describe(restorePdfOps(from, to), from);
  return { added: d.added, removed: d.removed, changed: d.changed, lines: [d.line] };
}

/** What `VersionHistory` needs to know about PDF documents: how to restore one, and how to say what changed. */
export const pdfVersionSupport: VersionSupport<PdfDoc, PdfOp> = { restoreOps: restorePdfOps, summarize: summarizePdfDiff };

// ---- A history for a PDF session -----------------------------------------------------------------------------

/**
 * What is selected after a restore: the same things, as far as they still exist. If the page that was shown is gone, the page
 * now at its position (or the last one) is shown, so the selection never points at nothing.
 */
export function selectionAfterRestore(selection: PdfSelection, before: PdfDoc, after: PdfDoc): PdfSelection {
  const pages = new Set(after.pages.map((p) => p.id));
  const annots = new Set(after.pages.flatMap((p) => p.annots.map((a) => a.id)));
  const fields = new Set(after.fields.map((f) => f.id));
  let page = selection.page;
  if (page !== null && !pages.has(page)) {
    const at = before.pages.findIndex((p) => p.id === page);
    page = after.pages[Math.min(Math.max(at, 0), after.pages.length - 1)]?.id ?? null;
  }
  const next: PdfSelection = { page, annots: selection.annots.filter((id) => annots.has(id)) };
  if (selection.fields) next.fields = selection.fields.filter((id) => fields.has(id));
  if (selection.pages) next.pages = selection.pages.filter((id) => pages.has(id));
  return next;
}

export interface PdfVersionHistoryOptions {
  /** Where the versions are kept (`memoryVersionStorage`, or your own over a table, a bucket, a folder). */
  storage: VersionStorage<PdfDoc>;
  /** Who is signed in and their role: saving and restoring need `editor`. */
  users: Users;
  /** The id the versions are kept under. Default: the document's id (`session.doc.id`). */
  file?: string;
  /** The position in the shared log, for a shared file: `() => sync.version`. */
  version?: () => number | null;
  /** Keep the state before a restore as a version of its own (default true). */
  keepBeforeRestore?: boolean;
  now?: () => number;
}

/**
 * A `VersionHistory` for a PDF session, with `pdfVersionSupport`. A restore is one undoable step (undo brings back the
 * document as it was just before), the selection is kept where it still points at something, and with live editing the
 * restore reaches everyone as an ordinary change.
 *
 *     const history = pdfVersionHistory(session, { storage, users });
 *     await history.save("Sent to legal");
 *     await history.restore(history.versions[0].id);
 */
export function pdfVersionHistory(session: PdfSession, options: PdfVersionHistoryOptions): VersionHistory<PdfDoc, PdfOp> {
  return new VersionHistory<PdfDoc, PdfOp>({
    file: options.file ?? session.doc.id,
    session: {
      get state() {
        return session.doc;
      },
      transact(ops) {
        const before = session.doc;
        const after = ops.reduce((doc, op) => pdfReducer.apply(doc, op).state, before);
        session.transact(ops, { selection: selectionAfterRestore(session.selection, before, after) });
      },
    },
    storage: options.storage,
    users: options.users,
    support: pdfVersionSupport,
    hash: hashPdfDoc,
    version: options.version,
    keepBeforeRestore: options.keepBeforeRestore,
    now: options.now,
  });
}
