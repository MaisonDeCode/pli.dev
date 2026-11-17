import { hashState, type SyncModel } from "@pli.dev/core";
import type { PdfDoc } from "./model";
import { pdfReducer, type PdfOp } from "./ops";
import type { PdfSelection } from "./session";

/** A short fingerprint of a document (FNV-1a over its canonical JSON, with its length). Equal documents have equal fingerprints. */
export const hashPdfDoc = (doc: PdfDoc): string => hashState(doc);

/** What an operation works on: the kind of thing, its id, and what the operation does to it. */
interface Target {
  kind: "page" | "annot" | "field" | "thread" | "source" | "outline" | "meta";
  id: string;
  act: "create" | "remove" | "write" | "move";
  /** The page an annotation operation is about, which a removed page takes with it. */
  page?: string;
}

function target(op: PdfOp): Target {
  switch (op.type) {
    case "set_meta": return { kind: "meta", id: "", act: "write" };
    case "insert_source": return { kind: "source", id: op.source.id, act: "create" };
    case "remove_source": return { kind: "source", id: op.id, act: "remove" };
    case "patch_source": return { kind: "source", id: op.id, act: "write" };
    case "insert_page": return { kind: "page", id: op.page.id, act: "create" };
    case "remove_page": return { kind: "page", id: op.id, act: "remove" };
    case "move_page": return { kind: "page", id: op.id, act: "move" };
    case "patch_page": return { kind: "page", id: op.id, act: "write" };
    case "set_edits": return { kind: "page", id: op.page, act: "write" };
    case "insert_annot": return { kind: "annot", id: op.annot.id, act: "create", page: op.page };
    case "remove_annot": return { kind: "annot", id: op.id, act: "remove", page: op.page };
    case "replace_annot": return { kind: "annot", id: op.annot.id, act: "write" };
    case "move_annot": return { kind: "annot", id: op.id, act: "move" };
    case "insert_field": return { kind: "field", id: op.field.id, act: "create" };
    case "remove_field": return { kind: "field", id: op.id, act: "remove" };
    case "replace_field": return { kind: "field", id: op.field.id, act: "write" };
    case "set_value": return { kind: "field", id: op.id, act: "write" };
    case "set_outline": return { kind: "outline", id: "", act: "write" };
    case "set_thread": return { kind: "thread", id: op.id, act: "write" };
  }
}

/** The page an operation is about (what a removed page takes with it), if it names one. */
function pageOf(op: PdfOp): string | undefined {
  switch (op.type) {
    case "insert_annot":
    case "remove_annot":
      return op.page;
    case "set_edits":
    case "patch_page":
    case "move_page":
      return op.type === "set_edits" ? op.page : op.id;
    default:
      return undefined;
  }
}

/** The id an operation puts something after (its position anchor), and the one it positions. */
function anchor(op: PdfOp): { item: string; after: string | null | undefined } | undefined {
  switch (op.type) {
    case "insert_page": return { item: op.page.id, after: op.after };
    case "move_page": return { item: op.id, after: op.after };
    case "insert_annot": return { item: op.annot.id, after: op.after };
    case "move_annot": return { item: op.id, after: op.after };
    case "insert_field": return { item: op.field.id, after: op.after };
    default: return undefined;
  }
}

const withAfter = (op: PdfOp, after: string | null | undefined): PdfOp => ({ ...(op as object), after }) as PdfOp;

/** The page or annotation that precedes what a remove operation removes (so others that followed it follow that instead). */
const prevOfRemove = (op: PdfOp): string | null | undefined => (op.type === "remove_page" || op.type === "remove_annot" || op.type === "remove_field" ? op.prev : undefined);

/** A move of the item an insert or move puts somewhere (to restore its place after the thing it follows has moved). */
const movedLike = (op: PdfOp): PdfOp => {
  const a = anchor(op)!;
  return op.type === "insert_page" || op.type === "move_page" ? { type: "move_page", id: a.item, after: null } : { type: "move_annot", id: a.item, after: null };
};

/**
 * Transforms `l` (made later) and `e` (accepted earlier), both made from the same document, into `l'` and `e'` so that
 * `e` then `l'` and `l` then `e'` give the same document. `null` means nothing is left to do.
 */
function pair(l: PdfOp, e: PdfOp): [PdfOp[], PdfOp[]] {
  const tl = target(l);
  const te = target(e);

  // A removed page takes its annotations and edits with it.
  if (te.kind === "page" && te.act === "remove" && te.id !== tl.id) {
    if (pageOf(l) === te.id) return [[], [e]]
  }
  if (tl.kind === "page" && tl.act === "remove" && pageOf(e) === tl.id && te.id !== tl.id) {
    // `e` worked on a page that `l` removes: `e` has nothing left to do after `l`.
    return [[l], []]
  }

  // Something placed after a thing that another change removed follows what that thing followed.
  const al = anchor(l);
  if (al && al.after !== undefined && al.after !== null && te.act === "remove" && te.id === al.after && te.kind === tl.kind) {
    return [[withAfter(l, prevOfRemove(e) ?? null)], [e]]
  }
  const ae = anchor(e);
  if (ae && ae.after !== undefined && ae.after !== null && tl.act === "remove" && tl.id === ae.after && te.kind === tl.kind) {
    return [[l], [withAfter(e, prevOfRemove(l) ?? null)]]
  }

  // Something placed after a thing that another change moved stays after it, wherever it went.
  if (al && al.after && te.act === "move" && te.id === al.after && te.kind === tl.kind && tl.kind !== "field") {
    return [[l], [e, withAfter(movedLike(l), al.after)]];
  }
  if (ae && ae.after && tl.act === "move" && tl.id === ae.after && te.kind === tl.kind && te.kind !== "field") {
    return [[l, withAfter(movedLike(e), ae.after)], [e]];
  }

  // Two things placed after the same thing: the later one goes after the earlier one, so both orders agree.
  if (al && ae && te.kind === tl.kind && al.after === ae.after && al.after !== undefined && al.item !== ae.item) {
    return [[withAfter(l, ae.item)], [e]]
  }

  if (te.kind !== tl.kind || te.id !== tl.id) return [[l], [e]]

  // The same thing.
  if (te.act === "remove" && tl.act === "remove") return [[], []]
  if (te.act === "remove") return [[], [e]]
  if (tl.act === "remove") return [[l], []]
  if (te.act === "create" && tl.act === "create") return [[], []]
  if (l.type === "patch_page" && e.type === "patch_page") {
    // Different fields of a page both stand; the same field goes to the later change.
    const mine = new Set(Object.keys(l.patch));
    const rest = Object.fromEntries(Object.entries(e.patch).filter(([k]) => !mine.has(k)));
    return [[l], Object.keys(rest).length > 0 ? [{ ...e, patch: rest } as PdfOp] : []];
  }
  if (l.type === "set_meta" && e.type === "set_meta") {
    const mine = new Set(Object.keys(l.patch));
    const rest = Object.fromEntries(Object.entries(e.patch).filter(([k]) => !mine.has(k)));
    return [[l], Object.keys(rest).length > 0 ? [{ ...e, patch: rest } as PdfOp] : []];
  }
  // Writes and moves of the same thing: the later change wins. (A page move and a page patch don't clash.)
  if ((l.type === "move_page" || l.type === "move_annot") !== (e.type === "move_page" || e.type === "move_annot")) return [[l], [e]]
  if ((l.type === "set_edits") !== (e.type === "set_edits") && tl.kind === "page") return [[l], [e]]
  return [[l], []]
}

/** Transforms two lists of operations made from the same document. */
export function transformPdfOps(later: readonly PdfOp[], earlier: readonly PdfOp[]): [PdfOp[], PdfOp[]] {
  let e: PdfOp[] = [...earlier];
  const out: PdfOp[] = [];
  for (const op of later) {
    let current: PdfOp | null = op;
    const tail: PdfOp[] = [];
    const nextE: PdfOp[] = [];
    for (const other of e) {
      if (!current) {
        nextE.push(other);
        continue;
      }
      const [l2, e2] = pair(current, other);
      // The later change is one operation, or none; a second one it brings is carried on with the first.
      current = l2[0] ?? null;
      tail.push(...l2.slice(1));
      nextE.push(...e2);
    }
    if (current) out.push(current);
    out.push(...tail);
    e = nextE;
  }
  return [out, e];
}

/**
 * How PDF operations combine, for `SyncClient` and `createAuthority`:
 *
 *     const sync = new SyncClient({ session: pdf.core, room, model: pdfSyncModel });
 *     const authority = createAuthority({ store, model: pdfSyncModel });
 *
 * Positions are named by the page or annotation they follow, and changes to different things never clash; when two
 * people change the same thing, the later change wins; a page that was deleted takes its annotations with it. The
 * client's fingerprint check (`hash`) puts right any rare case that does not merge cleanly.
 */
export const pdfSyncModel: SyncModel<PdfDoc, PdfOp> = {
  apply: (doc, op) => pdfReducer.apply(doc, op).state,
  transform: transformPdfOps,
  mapMeta: (selection: PdfSelection, ops) => {
    // Forget a selection that points at something that is gone.
    const removedPages = new Set(ops.flatMap((o) => (o.type === "remove_page" ? [o.id] : [])));
    const removedAnnots = new Set(ops.flatMap((o) => (o.type === "remove_annot" ? [o.id] : [])));
    if (!selection) return selection;
    const page = selection.page && removedPages.has(selection.page) ? null : selection.page;
    const annots = selection.annots.filter((a) => !removedAnnots.has(a));
    return page === selection.page && annots.length === selection.annots.length ? selection : { ...selection, page, annots };
  },
  mapPresence: (state, ops) => {
    const removedPages = new Set(ops.flatMap((o) => (o.type === "remove_page" ? [o.id] : [])));
    let next = state;
    if (typeof next.page === "string" && removedPages.has(next.page)) next = { ...next, page: null };
    const cursor = next.cursor as { page?: unknown } | null | undefined;
    // The pointer of a person on a page that is gone is not on any page.
    if (cursor && typeof cursor.page === "string" && removedPages.has(cursor.page)) next = { ...next, cursor: null };
    return next;
  },
  hash: hashPdfDoc,
};
