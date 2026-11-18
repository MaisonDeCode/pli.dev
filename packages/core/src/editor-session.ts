import { attachSync, type AttachedSync, type AttachSyncOptions } from "./attach-sync";
import type { CollabRoom } from "./collab";
import type { CommentClient, CommentClientOptions, CommentStore } from "./comments";
import { PliError } from "./errors";
import { canonicalJson, hashText } from "./hash";
import { ScriptHost, type ScriptOptions } from "./scripting";
import type { ChangeEvent, Session, TransactOptions } from "./session";
import type { SyncModel } from "./sync";
import type { Users } from "./users";

/** How an editor session turns comments on. `store: "document"` keeps threads in the file itself, if the editor can. */
export interface EditorCommentsOptions {
  users: Users;
  store?: CommentStore<any> | "document";
  permissions?: CommentClientOptions<any>["permissions"];
  onError?: CommentClientOptions<any>["onError"];
  /** Hook in your own notifications: called once for each comment action of this person, with who to tell and why. See `CommentNotice`. */
  onNotify?: CommentClientOptions<any>["onNotify"];
}

/**
 * What every Pli editor's session offers, so that code written once (a shared toolbar, a script host, a sync helper, a
 * test, a server tool) works with a document, a sheet, a deck, a PDF, and the editors that come later. It is a view of
 * the editor's own session, which keeps its own richer API (`session.exec`, `workbook.cells`, ...): see each editor's
 * `...EditorSession(session)` adapter.
 */
export interface EditorSession<State = unknown, Op = unknown, Meta = unknown> {
  /** `"document"`, `"sheet"`, `"deck"`, `"pdf"`, or the name of an editor of yours. The room names and the server's registry use it. */
  readonly kind: string;
  /** The core session that holds state and history. `SyncClient` works on it. */
  readonly core: Session<State, Op, Meta>;
  /** How operations of this editor combine: the same model a server registers for this kind. */
  readonly model: SyncModel<State, Op>;
  readonly state: State;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Applies operations as one undoable step. */
  transact(ops: readonly Op[], options?: TransactOptions<Meta>): void;
  undo(): boolean;
  redo(): boolean;
  subscribe(listener: (event: ChangeEvent<State, Op, Meta>) => void): () => void;
  /** The state as canonical JSON (keys in order), the same for equal states: what a file or a version stores. */
  serialize(): string;
  /** A short fingerprint of the state; what `SyncClient` compares with the server's. */
  hash(): string;
  /** Whether this editor can have comments. */
  readonly supportsComments: boolean;
  /** The comments, once `enableComments` was called (or the editor turned them on itself). */
  readonly comments: CommentClient<any> | null;
  /** Turns comments on. Throws `unsupported` for an editor without them. */
  enableComments(options: EditorCommentsOptions): CommentClient<any>;
  /** Goes live on a room: see `attachSync`. */
  attachSync(room: CollabRoom<any>, options?: Omit<AttachSyncOptions<State, Op, Meta>, "room">): AttachedSync<State, Op, Meta>;
  /** A host to run scripts against this session: see `ScriptHost`. */
  script(options?: ScriptOptions<Op>): ScriptHost<State, Op, Meta>;
}

export interface EditorSessionParts<State, Op, Meta> {
  kind: string;
  core: Session<State, Op, Meta>;
  model: SyncModel<State, Op>;
  /** For an editor whose own `transact` does more than the core one (checks protection, tracks the selection). */
  transact?: (ops: readonly Op[], options?: TransactOptions<Meta>) => void;
  /** Present if the editor supports comments. */
  comments?: {
    /** The client now, or null before it was turned on. */
    get(): CommentClient<any> | null;
    /** Turns them on and returns the client. */
    enable(options: EditorCommentsOptions): CommentClient<any>;
  };
  /** Undo and redo of the editor's own session, when it does more than the core one. */
  undo?: () => boolean;
  redo?: () => boolean;
}

/** Makes an `EditorSession` from the parts an editor already has. An adapter is a dozen lines. */
export function createEditorSession<State, Op, Meta = unknown>(parts: EditorSessionParts<State, Op, Meta>): EditorSession<State, Op, Meta> {
  const { core, model, kind } = parts;
  const session: EditorSession<State, Op, Meta> = {
    kind,
    core,
    model,
    get state() {
      return core.state;
    },
    get canUndo() {
      return core.canUndo;
    },
    get canRedo() {
      return core.canRedo;
    },
    transact: (ops, options) => (parts.transact ?? ((o, p) => core.transact(o, p)))(ops, options),
    undo: () => (parts.undo ? parts.undo() : core.undo()),
    redo: () => (parts.redo ? parts.redo() : core.redo()),
    subscribe: (listener) => core.subscribe(listener),
    serialize: () => canonicalJson(core.state),
    hash: () => model.hash(core.state),
    get supportsComments() {
      return !!parts.comments;
    },
    get comments() {
      return parts.comments?.get() ?? null;
    },
    enableComments(options) {
      if (!parts.comments) throw new PliError("unsupported", `The ${kind} editor doesn't have comments yet`);
      return parts.comments.get() ?? parts.comments.enable(options);
    },
    attachSync(room, options = {}) {
      return attachSync(core, model, { comments: session.comments, ...options, room });
    },
    script: (options) => new ScriptHost<State, Op, Meta>(session, options),
  };
  return session;
}

/** The fingerprint to use when an editor has no better one: FNV-1a over the canonical JSON of the state. */
export const defaultHash = (state: unknown): string => hashText(canonicalJson(state));

/**
 * The `comments` part for an editor session that has `comments` and `enableComments(options)` of its own, or undefined
 * for one that has not (so `supportsComments` is false until it does). Adapters for editors that are gaining comments use it.
 */
export function commentsPart(host: object): EditorSessionParts<any, any, any>["comments"] {
  const h = host as { comments?: CommentClient<any> | null; enableComments?: (options: EditorCommentsOptions) => CommentClient<any> };
  if (typeof h.enableComments !== "function") return undefined;
  return { get: () => h.comments ?? null, enable: (options) => h.enableComments!(options) };
}
