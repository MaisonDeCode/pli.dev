import {
  commentStoreInFile,
  reloadCommentsOnHistory,
  CommentClient,
  PliError,
  type CommentClientOptions,
  type CommentStore,
  type Thread,
  type Users,
} from "@pli.dev/core";
import type { Annotation, PdfAnchor } from "../model";
import { findAnnot } from "../ops";
import type { PdfSession } from "../session";

/** How comments are set up. Without this, a session has no comments. */
export interface PdfCommentsOptions {
  /** Who is commenting, and who the authors of comments are. */
  users: Users;
  /**
   * Where comment threads are kept: `"document"` (the default) saves them inside the PDF (as text annotations and
   * replies, so other readers show them), or a `CommentStore` of your own, such as a table in your database.
   */
  store?: CommentStore<PdfAnchor> | "document";
  permissions?: CommentClientOptions<PdfAnchor>["permissions"];
  onError?: CommentClientOptions<PdfAnchor>["onError"];
}

/** Keeps comment threads inside the document (`PdfDoc.comments`). `write` applies ops without making an undo step. */
export function documentCommentStore(source: { readonly doc: { comments?: Record<string, Thread<PdfAnchor>> }; write(id: string, thread: Thread<PdfAnchor> | null): void }): CommentStore<PdfAnchor> {
  return commentStoreInFile<PdfAnchor>({ threads: () => Object.values(source.doc.comments ?? {}), write: (id, thread) => source.write(id, thread) });
}

/**
 * Comment threads (`@pli.dev/core` `CommentClient` with a `PdfAnchor`): `session.comments`. Turn them on with `enable`.
 * A sticky note is an annotation plus a thread; a comment on a highlight is the same. Both are shared by every Pli
 * editor, so stores, servers and transports work unchanged.
 */
export class CommentCommands {
  #client: CommentClient<PdfAnchor> | null = null;

  constructor(protected readonly session: PdfSession) {}

  /** The comments of this document, or null if comments weren't turned on. */
  get client(): CommentClient<PdfAnchor> | null {
    return this.#client;
  }

  enable(options: PdfCommentsOptions): CommentClient<PdfAnchor> {
    const session = this.session;
    const inDocument = options.store === undefined || options.store === "document";
    // A thread kept in the document is part of it. What this person does is a change like any other (not an undo step),
    // so a shared session (`SyncClient`) sends it and the server's copy holds it; what arrives from the room is written
    // as a remote change, which is not sent again.
    const keep = (options: { origin?: "remote"; history?: false }) =>
      documentCommentStore({
        get doc() {
          return session.doc;
        },
        write: (id, thread) => session.transact([{ type: "set_thread", id, thread }], options),
      });
    const documentStore = keep({ history: false });
    const fromRoom = keep({ origin: "remote" });
    const client = new CommentClient<PdfAnchor>({
      file: session.doc.id,
      users: options.users,
      store: inDocument ? documentStore : (options.store as CommentStore<PdfAnchor>),
      initial: Object.values(session.doc.comments ?? {}),
      permissions: options.permissions,
      onError: (error, change) => {
        if (change.type === "thread.create") this.#detach(change.thread.id);
        options.onError?.(error, change);
      },
    });
    client.onChange((change, origin) => {
      if (inDocument && origin === "remote") void fromRoom.save(session.doc.id, change);
      if (change.type === "thread.delete") this.#detach(change.threadId);
    });
    if (inDocument) reloadCommentsOnHistory(client, session, (op) => op.type === "set_thread");
    this.#client = client;
    return client;
  }

  #need(): CommentClient<PdfAnchor> {
    if (!this.#client) throw new PliError("unsupported", "Comments aren't turned on: call session.comments.enable({ users })");
    return this.#client;
  }

  /** Takes the annotation of a thread that went away off the page (a sticky note with no comments left). Not an undo step. */
  #detach(threadId: string): void {
    const doc = this.session.doc;
    const ops = doc.pages.flatMap((p) => p.annots.filter((a) => a.thread === threadId && a.type === "note").map((a) => ({ type: "remove_annot" as const, page: p.id, id: a.id })));
    if (ops.length > 0) this.session.transact(ops, { history: false });
  }

  /**
   * Puts a sticky note on a page with `body` as the first comment of a new thread, as one undo step. Returns the
   * thread. The note's text in the PDF is the first comment; replies are written as replies.
   */
  addNote(pageId: string, x: number, y: number, body: string, mentions?: readonly string[]): Thread<PdfAnchor> {
    const client = this.#need();
    const s = this.session;
    const annotId = `a_${Math.random().toString(36).slice(2, 10)}`;
    const thread = client.createThread(body, { page: pageId, annot: annotId, x, y }, undefined, mentions);
    s.annots.add(pageId, { id: annotId, type: "note", x, y, contents: body, thread: thread.id, icon: "comment" });
    return thread;
  }

  /** Starts a thread on an existing annotation (a highlight, a shape). */
  commentOn(annotId: string, body: string, mentions?: readonly string[]): Thread<PdfAnchor> {
    const client = this.#need();
    const found = findAnnot(this.session.doc, annotId);
    if (!found) throw new PliError("not_found", `annotation ${annotId} not found`);
    const annot = found.page.annots[found.index]!;
    const at = anchorPoint(annot);
    const thread = client.createThread(body, { page: found.page.id, annot: annotId, ...at }, undefined, mentions);
    this.session.annots.update(annotId, { thread: thread.id, contents: annot.contents ?? body });
    return thread;
  }
}

/** A point to show a comment at, for an annotation. */
export function anchorPoint(annot: Annotation): { x: number; y: number; quote?: string } {
  switch (annot.type) {
    case "note":
      return { x: annot.x, y: annot.y };
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly": {
      const r = annot.rects[0];
      return { x: r ? r.x : 0, y: r ? r.y : 0, ...(annot.quote ? { quote: annot.quote } : {}) };
    }
    case "redact": {
      const r = annot.rects[0];
      return { x: r?.x ?? 0, y: r?.y ?? 0 };
    }
    case "line":
      return { x: annot.from[0], y: annot.from[1] };
    case "ink":
      return { x: annot.strokes[0]?.[0]?.[0] ?? 0, y: annot.strokes[0]?.[0]?.[1] ?? 0 };
    case "polygon":
    case "polyline":
      return { x: annot.points[0]?.[0] ?? 0, y: annot.points[0]?.[1] ?? 0 };
    default:
      return { x: annot.rect.x, y: annot.rect.y };
  }
}
