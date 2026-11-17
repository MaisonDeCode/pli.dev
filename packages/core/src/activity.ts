import type { CommentChange, CommentClient } from "./comments";
import { createId } from "./ids";
import type { ChangeEvent } from "./session";
import type { Users } from "./users";

/**
 * An activity feed for a file: who commented, replied, resolved, mentioned whom, edited, saved a version, changed who
 * has access. It is derived from events Pli already has (`CommentClient.onChange`, a session's changes), so every editor
 * gets one by connecting it; it is also an audit trail when you keep it in an `ActivityStore` of your own. Notifications
 * ("Ana mentioned you") are the entries that concern one person.
 */

export type ActivityKind =
  | "comment.created"
  | "comment.replied"
  | "comment.edited"
  | "comment.deleted"
  | "thread.resolved"
  | "thread.reopened"
  | "thread.deleted"
  | "mention"
  | "edit"
  | "version.saved"
  | "version.restored"
  | "share.granted"
  | "share.revoked"
  | "share.link";

export interface ActivityEvent {
  id: string;
  /** Milliseconds since 1970. */
  at: number;
  kind: ActivityKind;
  /** The `PliUser.id` who did it; empty when it isn't known (an edit from a collaborator the session can't name). */
  user: string;
  /** What it is about: a thread id, a version id. */
  ref?: string;
  /** Who it concerns: the person mentioned, the owner of the thread replied to, the person given access. */
  target?: string;
  /** For `edit`: how many changes were folded into this entry. */
  count?: number;
  /** A line of the text involved (the first words of a comment), to give the entry context. */
  excerpt?: string;
}

/** Where activity is kept, if it should outlive the page. Implement `append` (and `list` for history on load). */
export interface ActivityStore {
  append(file: string, event: ActivityEvent): void | Promise<void>;
  list?(file: string, options?: { limit?: number }): ActivityEvent[] | Promise<ActivityEvent[]>;
}

export function memoryActivityStore(): ActivityStore & { events(file: string): ActivityEvent[] } {
  const files = new Map<string, ActivityEvent[]>();
  return {
    events: (file) => files.get(file) ?? [],
    append(file, event) {
      files.set(file, [...(files.get(file) ?? []), JSON.parse(JSON.stringify(event)) as ActivityEvent]);
    },
    list(file, options) {
      const all = files.get(file) ?? [];
      return options?.limit ? all.slice(-options.limit) : all;
    },
  };
}

export interface ActivityFeedOptions {
  file: string;
  users: Users;
  store?: ActivityStore;
  /** Edits by the same person closer together than this (ms) are one entry. Default 5 minutes. */
  editWindow?: number;
  /** Keep this many entries in memory. Default 500. */
  limit?: number;
  now?: () => number;
}

type Listener = () => void;

const EXCERPT = 80;
const excerpt = (text: string | undefined) => (text ? (text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text) : undefined);

export class ActivityFeed {
  readonly file: string;
  readonly users: Users;
  readonly #options: ActivityFeedOptions;
  #events: ActivityEvent[] = [];
  #listeners = new Set<Listener>();
  #lastEdit: ActivityEvent | null = null;
  #now: () => number;

  constructor(options: ActivityFeedOptions) {
    this.#options = options;
    this.file = options.file;
    this.users = options.users;
    this.#now = options.now ?? Date.now;
  }

  /** Newest first. */
  get events(): readonly ActivityEvent[] {
    return this.#events;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Loads what the store has kept, before anything new. */
  async load(): Promise<void> {
    const kept = (await this.#options.store?.list?.(this.file, { limit: this.#options.limit ?? 500 })) ?? [];
    const known = new Set(this.#events.map((e) => e.id));
    this.#events = [...this.#events, ...kept.filter((e) => !known.has(e.id))].sort((a, b) => b.at - a.at);
    this.#emit();
  }

  /** Adds an entry. Returns it. */
  record(event: Omit<ActivityEvent, "id" | "at"> & { at?: number }): ActivityEvent {
    const entry: ActivityEvent = { id: createId("ev_"), at: this.#now(), ...event };
    this.#add(entry);
    void Promise.resolve(this.#options.store?.append(this.file, entry)).catch(() => {});
    return entry;
  }

  /** What one change to the comments means for the feed. Local changes are by the current user; others' by who they name. */
  recordComment(change: CommentChange<any>, origin: "local" | "remote", client?: Pick<CommentClient<any>, "thread">): void {
    const me = this.users.current?.id ?? "";
    const mentions = (ids: readonly string[] | undefined, user: string, ref: string, text: string) => {
      for (const id of ids ?? []) if (id !== user) this.record({ kind: "mention", user, ref, target: id, excerpt: excerpt(text) });
    };
    switch (change.type) {
      case "thread.create": {
        const first = change.thread.comments[0];
        const user = first?.author ?? me;
        this.record({ kind: "comment.created", user, ref: change.thread.id, excerpt: excerpt(first?.body), at: first?.createdAt });
        mentions(first?.mentions, user, change.thread.id, first?.body ?? "");
        break;
      }
      case "comment.add": {
        const owner = client?.thread(change.threadId)?.comments[0]?.author;
        this.record({ kind: "comment.replied", user: change.comment.author, ref: change.threadId, target: owner && owner !== change.comment.author ? owner : undefined, excerpt: excerpt(change.comment.body), at: change.comment.createdAt });
        mentions(change.comment.mentions, change.comment.author, change.threadId, change.comment.body);
        break;
      }
      case "comment.edit": {
        const user = origin === "local" ? me : (client?.thread(change.threadId)?.comments.find((c) => c.id === change.commentId)?.author ?? "");
        this.record({ kind: "comment.edited", user, ref: change.threadId, excerpt: excerpt(change.body), at: change.at });
        mentions(change.mentions, user, change.threadId, change.body);
        break;
      }
      case "comment.delete":
        this.record({ kind: "comment.deleted", user: origin === "local" ? me : "", ref: change.threadId });
        break;
      case "thread.resolve":
        this.record({ kind: "thread.resolved", user: change.by, ref: change.threadId, at: change.at });
        break;
      case "thread.reopen":
        this.record({ kind: "thread.reopened", user: origin === "local" ? me : "", ref: change.threadId });
        break;
      case "thread.delete":
        this.record({ kind: "thread.deleted", user: origin === "local" ? me : "", ref: change.threadId });
        break;
    }
  }

  /** Records every comment change of a client, ours and other people's. Returns a function that stops. */
  trackComments(client: CommentClient<any>): () => void {
    return client.onChange((change, origin) => this.recordComment(change, origin, client));
  }

  /**
   * Records edits, folding a person's run of changes into one entry that counts them. Changes by other people are
   * attributed with `whose` if you can say whose they are (the sync entry's client), else to nobody in particular.
   */
  trackEdits(session: { subscribe(listener: (event: ChangeEvent<any, any, any>) => void): () => void }, options: { whose?: (event: ChangeEvent<any, any, any>) => string | undefined } = {}): () => void {
    return session.subscribe((event) => {
      if (event.reset || event.ops.length === 0) return;
      const user = event.origin === "remote" ? (options.whose?.(event) ?? "") : (this.users.current?.id ?? "");
      const now = this.#now();
      const last = this.#lastEdit;
      if (last && last.user === user && now - last.at < (this.#options.editWindow ?? 300_000)) {
        // The same person still at it: the entry grows, and stays where it was in the list.
        last.count = (last.count ?? 1) + 1;
        last.at = now;
        this.#events = [last, ...this.#events.filter((e) => e !== last)];
        this.#emit();
        return;
      }
      this.#lastEdit = this.record({ kind: "edit", user, count: 1 });
    });
  }

  /** The entries that concern one person: they were mentioned, or someone replied to their thread. Newest first. */
  notificationsFor(userId: string): ActivityEvent[] {
    return this.#events.filter((e) => e.target === userId && (e.kind === "mention" || e.kind === "comment.replied") && e.user !== userId);
  }

  #add(entry: ActivityEvent): void {
    this.#events = [entry, ...this.#events].sort((a, b) => b.at - a.at).slice(0, this.#options.limit ?? 500);
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** A sentence for an entry, naming the people through `users`: "Ana mentioned you", "Ben resolved a thread". */
export function describeActivity(event: ActivityEvent, users: Users): string {
  const me = users.current?.id;
  const who = event.user === "" ? "Someone" : event.user === me ? "You" : users.get(event.user).name;
  const target = event.target ? (event.target === me ? "you" : users.get(event.target).name) : "";
  switch (event.kind) {
    case "comment.created":
      return `${who} commented`;
    case "comment.replied":
      return event.target ? `${who} replied to ${event.target === me ? "your" : `${target}'s`} comment` : `${who} replied`;
    case "comment.edited":
      return `${who} edited a comment`;
    case "comment.deleted":
      return `${who} deleted a comment`;
    case "thread.resolved":
      return `${who} resolved a thread`;
    case "thread.reopened":
      return `${who} reopened a thread`;
    case "thread.deleted":
      return `${who} deleted a thread`;
    case "mention":
      return `${who} mentioned ${target}`;
    case "edit":
      return event.count && event.count > 1 ? `${who} made ${event.count} changes` : `${who} made a change`;
    case "version.saved":
      return `${who} saved a version`;
    case "version.restored":
      return `${who} restored a version`;
    case "share.granted":
      return `${who} gave ${target || "someone"} access`;
    case "share.revoked":
      return `${who} removed ${target || "someone"}'s access`;
    case "share.link":
      return `${who} changed the link settings`;
  }
}
