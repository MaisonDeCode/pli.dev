import { createId } from "./ids";
import { PliError } from "./errors";
import type { Role, Users } from "./users";

/**
 * Comments are shared by every editor. A thread is a conversation about one place in a file; what "place"
 * means is up to the editor, so the thread carries an `anchor` that only that editor reads (a text range in
 * a document, a cell in a sheet, an object on a slide). Everything else is the same everywhere.
 */
export interface Comment {
  id: string;
  /** The `PliUser.id` of the author. The name and picture are looked up when it is shown. */
  author: string;
  body: string;
  /** Milliseconds since 1970. */
  createdAt: number;
  editedAt?: number;
  /** The ids of the people mentioned in `body` with `@Name`. Tell them: Pli doesn't notify anyone, your store sees every comment with this list. */
  mentions?: string[];
}

export interface Thread<Anchor = unknown> {
  id: string;
  /** Where the thread is attached. Opaque to the comment machinery, and plain JSON. */
  anchor?: Anchor;
  /** The conversation, oldest first. The first comment starts the thread. */
  comments: Comment[];
  /** Set once someone marks the thread resolved. */
  resolved?: { by: string; at: number };
  createdAt: number;
}

/**
 * One change to the comments of a file. This is the whole vocabulary: a store that saves these, and a
 * transport that carries them, can keep every client in step. Each change is safe to apply twice.
 */
export type CommentChange<Anchor = unknown> =
  | { type: "thread.create"; thread: Thread<Anchor> }
  | { type: "thread.delete"; threadId: string }
  | { type: "thread.resolve"; threadId: string; by: string; at: number }
  | { type: "thread.reopen"; threadId: string }
  | { type: "comment.add"; threadId: string; comment: Comment }
  | { type: "comment.edit"; threadId: string; commentId: string; body: string; at: number; mentions?: string[] }
  | { type: "comment.delete"; threadId: string; commentId: string };

/**
 * Where comments are kept. Implement this over whatever you already have: a database table, an API, a
 * collection in Firestore. Only `load` and `save` are required.
 *
 * `save` is called once per change, in order, and should throw (or reject) if it couldn't keep it. Comments
 * written by someone else reach this client through `subscribe`, or through the room's transport.
 */
export interface CommentStore<Anchor = unknown> {
  /** Every thread of the file `file`. */
  load(file: string): Thread<Anchor>[] | Promise<Thread<Anchor>[]>;
  /** Keeps one change. */
  save(file: string, change: CommentChange<Anchor>): void | Promise<void>;
  /** Calls `listener` with changes made by other people. Skip it if a room's transport carries them. */
  subscribe?(file: string, listener: (change: CommentChange<Anchor>) => void): () => void;
}

/** Applies one change, returning the new list. A change that doesn't fit (a reply to a deleted thread) is ignored. */
export function applyCommentChange<A>(threads: readonly Thread<A>[], change: CommentChange<A>): Thread<A>[] {
  const edit = (id: string, fn: (thread: Thread<A>) => Thread<A>) => threads.map((t) => (t.id === id ? fn(t) : t));
  switch (change.type) {
    case "thread.create":
      return threads.some((t) => t.id === change.thread.id)
        ? edit(change.thread.id, () => change.thread)
        : [...threads, change.thread];
    case "thread.delete":
      return threads.filter((t) => t.id !== change.threadId);
    case "thread.resolve":
      return edit(change.threadId, (t) => ({ ...t, resolved: { by: change.by, at: change.at } }));
    case "thread.reopen":
      return edit(change.threadId, ({ resolved: _resolved, ...t }) => t);
    case "comment.add":
      return edit(change.threadId, (t) =>
        t.comments.some((c) => c.id === change.comment.id) ? t : { ...t, comments: [...t.comments, change.comment] },
      );
    case "comment.edit":
      return edit(change.threadId, (t) => ({
        ...t,
        comments: t.comments.map((c) => (c.id === change.commentId ? withMentions({ ...c, body: change.body, editedAt: change.at }, change.mentions) : c)),
      }));
    case "comment.delete":
      return edit(change.threadId, (t) => ({ ...t, comments: t.comments.filter((c) => c.id !== change.commentId) }));
  }
}

/** `comment` with exactly these mentions: none given means none left. */
function withMentions(comment: Comment, mentions: readonly string[] | undefined): Comment {
  const { mentions: _old, ...rest } = comment;
  return mentions && mentions.length > 0 ? { ...rest, mentions: [...mentions] } : rest;
}

/** The id of the thread a change is about. */
export function changeThreadId(change: CommentChange<unknown>): string {
  return change.type === "thread.create" ? change.thread.id : change.threadId;
}

/** Keeps the threads in a store in a list in memory. For demos, tests and the offline case. */
export function memoryCommentStore<A = unknown>(initial: Record<string, Thread<A>[]> = {}): CommentStore<A> & { threads(file: string): Thread<A>[] } {
  const files = new Map<string, Thread<A>[]>(Object.entries(initial));
  const listeners = new Map<string, Set<(change: CommentChange<A>) => void>>();
  return {
    threads: (file) => files.get(file) ?? [],
    load: (file) => files.get(file) ?? [],
    save(file, change) {
      files.set(file, applyCommentChange(files.get(file) ?? [], change));
      for (const listener of listeners.get(file) ?? []) listener(change);
    },
    subscribe(file, listener) {
      const set = listeners.get(file) ?? new Set();
      listeners.set(file, set);
      set.add(listener);
      return () => set.delete(listener);
    },
  };
}

export type CommentAction = "comment" | "reply" | "edit" | "delete" | "resolve" | "deleteThread";

export interface PermissionContext<A = unknown> {
  user: { id: string; role: Role };
  thread?: Thread<A>;
  comment?: Comment;
}

export interface CommentClientOptions<A = unknown> {
  /** Which file these comments belong to: usually the document's id. */
  file: string;
  /** Who is commenting. */
  users: Users;
  /** Where comments are kept. Without a store they live in memory and are lost on reload. */
  store?: CommentStore<A>;
  /** Threads to start with, such as the ones saved inside the file. They are shown at once, and the store's replace them when loaded. */
  initial?: Thread<A>[];
  /**
   * Decides who may do what, where the defaults aren't right. Return `true` or `false`, or `undefined` to
   * leave it to the default: viewers can't write; commenters can add and reply, and edit or delete their own
   * comments; editors can also delete anyone's comments and threads. Anyone who can comment can resolve.
   */
  permissions?(action: CommentAction, context: PermissionContext<A>): boolean | undefined;
  /** Called when the store couldn't keep a change. The change has been taken back. */
  onError?(error: PliError, change: CommentChange<A>): void;
}

type Listener = () => void;

/**
 * The comments of one file, as the editor sees them. Changes show at once and are then handed to the store;
 * if the store refuses one, it's taken back and `onError` hears of it. Changes from other people come in
 * through `receive` (a room's transport calls it) or the store's `subscribe`.
 */
export class CommentClient<A = unknown> {
  readonly file: string;
  readonly users: Users;
  #store: CommentStore<A> | null;
  #options: CommentClientOptions<A>;
  /** What the store has accepted, plus changes from others. */
  #confirmed: Thread<A>[];
  /** Local changes the store hasn't answered yet. */
  #pending: CommentChange<A>[] = [];
  #threads: Thread<A>[];
  #queue: Promise<void> = Promise.resolve();
  #listeners = new Set<Listener>();
  #outgoing = new Set<(change: CommentChange<A>) => void>();
  #changes = new Set<(change: CommentChange<A>, origin: "local" | "remote") => void>();
  #status: "loading" | "ready" | "error" = "ready";
  #unsubscribe: (() => void) | null = null;
  #unwatchUsers: () => void;
  #ready: Promise<void>;

  constructor(options: CommentClientOptions<A>) {
    this.#options = options;
    this.file = options.file;
    this.users = options.users;
    this.#store = options.store ?? null;
    this.#confirmed = options.initial ?? [];
    this.#threads = this.#confirmed;
    this.#ready = this.#store ? this.#load() : Promise.resolve();
    this.#unsubscribe = this.#store?.subscribe?.(this.file, (change) => this.receive(change)) ?? null;
    this.#unwatchUsers = this.users.subscribe(() => this.#emit());
  }

  /** The threads now, including changes the store hasn't answered yet. Oldest first. */
  get threads(): readonly Thread<A>[] {
    return this.#threads;
  }

  get status(): "loading" | "ready" | "error" {
    return this.#status;
  }

  /** Resolves when the store's threads have loaded. */
  get ready(): Promise<void> {
    return this.#ready;
  }

  thread(id: string): Thread<A> | undefined {
    return this.#threads.find((t) => t.id === id);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Calls `listener` with every change as it shows: ours the moment we make it, other people's as they arrive. */
  onChange(listener: (change: CommentChange<A>, origin: "local" | "remote") => void): () => void {
    this.#changes.add(listener);
    return () => this.#changes.delete(listener);
  }

  /** Calls `listener` with each local change once the store has kept it. A room uses this to tell the others. */
  onOutgoing(listener: (change: CommentChange<A>) => void): () => void {
    this.#outgoing.add(listener);
    return () => this.#outgoing.delete(listener);
  }

  /** Whether the current user may do this. Use it to hide buttons; the methods below check it too. */
  can(action: CommentAction, thread?: Thread<A>, comment?: Comment): boolean {
    const user = this.users.current;
    if (!user) return false;
    const context: PermissionContext<A> = { user: { id: user.id, role: this.users.role }, thread, comment };
    const decided = this.#options.permissions?.(action, context);
    if (decided !== undefined) return decided;
    const role = this.users.role;
    if (role === "viewer") return false;
    if (role === "editor") return true;
    switch (action) {
      case "comment":
      case "reply":
      case "resolve":
        return true;
      case "edit":
      case "delete":
        return comment?.author === user.id;
      case "deleteThread":
        return thread?.comments.every((c) => c.author === user.id) ?? false;
    }
  }

  /** Starts a thread with its first comment. Returns the new thread. */
  createThread(body: string, anchor?: A, id: string = createId("th_"), mentions?: readonly string[]): Thread<A> {
    const user = this.#need("comment");
    const now = Date.now();
    const thread: Thread<A> = { id, comments: [withMentions({ id: createId("cm_"), author: user, body, createdAt: now }, mentions)], createdAt: now };
    if (anchor !== undefined) thread.anchor = anchor;
    this.#local({ type: "thread.create", thread });
    return thread;
  }

  /** Adds a comment to a thread. `mentions` lists the ids of the people `body` mentions with `@Name`. */
  reply(threadId: string, body: string, mentions?: readonly string[]): Comment {
    const user = this.#need("reply", threadId);
    const comment = withMentions({ id: createId("cm_"), author: user, body, createdAt: Date.now() }, mentions);
    this.#local({ type: "comment.add", threadId, comment });
    return comment;
  }

  /** Changes the text of a comment. `mentions` replaces the list the comment had. */
  editComment(threadId: string, commentId: string, body: string, mentions?: readonly string[]): void {
    this.#need("edit", threadId, commentId);
    const change: CommentChange<A> = { type: "comment.edit", threadId, commentId, body, at: Date.now() };
    if (mentions && mentions.length > 0) change.mentions = [...mentions];
    this.#local(change);
  }

  /** Deletes a comment. Deleting the only comment of a thread deletes the thread. */
  deleteComment(threadId: string, commentId: string): void {
    this.#need("delete", threadId, commentId);
    const thread = this.thread(threadId);
    if (thread && thread.comments.length <= 1) this.#local({ type: "thread.delete", threadId });
    else this.#local({ type: "comment.delete", threadId, commentId });
  }

  deleteThread(threadId: string): void {
    this.#need("deleteThread", threadId);
    this.#local({ type: "thread.delete", threadId });
  }

  resolve(threadId: string): void {
    const user = this.#need("resolve", threadId);
    this.#local({ type: "thread.resolve", threadId, by: user, at: Date.now() });
  }

  reopen(threadId: string): void {
    this.#need("resolve", threadId);
    this.#local({ type: "thread.reopen", threadId });
  }

  /** Takes in a change made by someone else. It is not saved again or sent on. */
  receive(change: CommentChange<A>): void {
    this.#confirmed = applyCommentChange(this.#confirmed, change);
    this.#rebuild();
    for (const listener of this.#changes) listener(change, "remote");
  }

  /** Stops listening to the store. */
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#unwatchUsers();
    this.#listeners.clear();
    this.#changes.clear();
  }

  /** Loads the store's threads again, for after a lost connection. */
  reload(): Promise<void> {
    if (!this.#store) return Promise.resolve();
    this.#ready = this.#load();
    return this.#ready;
  }

  async #load(): Promise<void> {
    this.#status = "loading";
    this.#emit();
    try {
      const loaded = await this.#store!.load(this.file);
      // Threads that arrived while loading stay, unless the store has its own copy.
      const fresh = new Set(loaded.map((t) => t.id));
      this.#confirmed = [...loaded, ...this.#confirmed.filter((t) => !fresh.has(t.id) && this.#pending.some((c) => c.type === "thread.create" && c.thread.id === t.id))];
      this.#status = "ready";
    } catch (cause) {
      this.#status = "error";
      this.#options.onError?.(new PliError("storage", "Couldn't load comments", { cause }), { type: "thread.delete", threadId: "" });
    }
    this.#rebuild();
  }

  #need(action: CommentAction, threadId?: string, commentId?: string): string {
    const user = this.users.current;
    if (!user) throw new PliError("invalid_operation", "Sign in to comment: no current user was given");
    const thread = threadId ? this.thread(threadId) : undefined;
    if (threadId && !thread) throw new PliError("not_found", `No thread "${threadId}"`);
    const comment = commentId ? thread?.comments.find((c) => c.id === commentId) : undefined;
    if (commentId && !comment) throw new PliError("not_found", `No comment "${commentId}"`);
    if (!this.can(action, thread, comment)) throw new PliError("invalid_operation", `Not allowed to ${action}`);
    return user.id;
  }

  #local(change: CommentChange<A>): void {
    this.#pending.push(change);
    this.#rebuild();
    for (const listener of this.#changes) listener(change, "local");
    if (!this.#store) {
      // No store: the memory is the record.
      this.#pending = this.#pending.filter((c) => c !== change);
      this.#confirmed = applyCommentChange(this.#confirmed, change);
      for (const listener of this.#outgoing) listener(change);
      return;
    }
    const threadId = changeThreadId(change);
    this.#queue = this.#queue.then(async () => {
      // An earlier change to this thread failed, so this one has nothing to build on.
      if (!this.#pending.includes(change)) return;
      try {
        await this.#store!.save(this.file, change);
        this.#pending = this.#pending.filter((c) => c !== change);
        this.#confirmed = applyCommentChange(this.#confirmed, change);
        this.#rebuild();
        for (const listener of this.#outgoing) listener(change);
      } catch (cause) {
        this.#pending = this.#pending.filter((c) => changeThreadId(c) !== threadId);
        this.#rebuild();
        this.#options.onError?.(new PliError("storage", "Couldn't save the comment", { cause }), change);
      }
    });
  }

  #rebuild(): void {
    this.#threads = this.#pending.reduce<Thread<A>[]>((all, change) => applyCommentChange(all, change), this.#confirmed);
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
