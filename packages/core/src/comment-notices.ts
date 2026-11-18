import type { Comment, CommentChange, CommentClient, Thread } from "./comments";
import type { PliUser } from "./users";

/**
 * What to tell people about the comments. Pli doesn't send notifications: your app already has a way (email, push, an
 * inbox, a chat message). This turns each comment action into one plain event, with who should hear about it and why, so
 * you can hand it to that system.
 *
 * It is made by the person who did the thing, once the store has kept it, so with many people in a file each action is
 * announced once, not once for every open window.
 */

/** Why someone is being told. */
export type NoticeReason =
  /** The comment names them with `@`. For an edit, only the people it names for the first time. */
  | "mention"
  /** They wrote an earlier comment in the same thread. */
  | "participant";

export type CommentNoticeType =
  /** A new thread. */
  | "comment.created"
  /** A reply in a thread. */
  | "comment.replied"
  /** A comment was changed. */
  | "comment.edited"
  | "thread.resolved"
  | "thread.reopened";

export interface CommentNotice<Anchor = unknown> {
  type: CommentNoticeType;
  /** The file the comments belong to (`CommentClient.file`). */
  file: string;
  /** Milliseconds since 1970. */
  at: number;
  /** Who did it. */
  actor: PliUser;
  /** The thread, with the comment in it, as it was at that moment. `thread.anchor` says where in the file it is. */
  thread: Thread<Anchor>;
  /** The comment written or changed. Not set for `thread.resolved` and `thread.reopened`. */
  comment?: Comment;
  /**
   * The people to tell, each once, with the reason. Never the person who did it. Empty when nobody else is concerned
   * (a first comment that mentions no one): a notice is still sent, in case you tell people who watch the file.
   * Use `user.id` to find the person in your own system: the name and picture may not have been loaded yet.
   */
  recipients: { user: PliUser; reason: NoticeReason }[];
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/**
 * Calls `handler` with a notice for each comment action the person using this client takes, after the store has kept it.
 * Other people's actions come through their own clients. Returns a function that stops it. `CommentClientOptions.onNotify`
 * does this for you; use this to attach more than one handler, or to a client you didn't make.
 */
export function commentNotices<A>(client: CommentClient<A>, handler: (notice: CommentNotice<A>) => void | Promise<void>): () => void {
  /** The people each comment names, to tell what an edit adds. */
  const mentions = new Map<string, readonly string[]>();
  for (const thread of client.threads) for (const c of thread.comments) mentions.set(c.id, c.mentions ?? []);
  /** Notices made when a change was made, sent when the store has kept it. */
  const waiting = new WeakMap<CommentChange<A>, CommentNotice<A>>();

  const tell = (users: string[], reason: NoticeReason, actor: string): { user: PliUser; reason: NoticeReason }[] =>
    unique(users)
      .filter((id) => id !== actor)
      .map((id) => ({ user: client.users.get(id), reason }));
  const merge = (...lists: { user: PliUser; reason: NoticeReason }[][]) => {
    const seen = new Set<string>();
    return lists.flat().filter((r) => !seen.has(r.user.id) && !!seen.add(r.user.id));
  };

  const build = (change: CommentChange<A>): CommentNotice<A> | null => {
    const me = client.users.current;
    const base = { file: client.file, at: Date.now() };
    switch (change.type) {
      case "thread.create": {
        const first = change.thread.comments[0];
        if (!me || !first) return null;
        return { ...base, type: "comment.created", actor: me, thread: change.thread, comment: first, recipients: tell(first.mentions ?? [], "mention", me.id) };
      }
      case "comment.add": {
        const thread = client.thread(change.threadId);
        if (!me || !thread) return null;
        const earlier = thread.comments.filter((c) => c.id !== change.comment.id).map((c) => c.author);
        return {
          ...base,
          type: "comment.replied",
          actor: me,
          thread,
          comment: change.comment,
          recipients: merge(tell(change.comment.mentions ?? [], "mention", me.id), tell(earlier, "participant", me.id)),
        };
      }
      case "comment.edit": {
        const thread = client.thread(change.threadId);
        const comment = thread?.comments.find((c) => c.id === change.commentId);
        if (!me || !thread || !comment) return null;
        const had = new Set(mentions.get(change.commentId) ?? []);
        const added = (change.mentions ?? []).filter((id) => !had.has(id));
        return { ...base, type: "comment.edited", actor: me, thread, comment, recipients: tell(added, "mention", me.id) };
      }
      case "thread.resolve":
      case "thread.reopen": {
        const thread = client.thread(change.threadId);
        if (!me || !thread) return null;
        return { ...base, type: change.type === "thread.resolve" ? "thread.resolved" : "thread.reopened", actor: me, thread, recipients: tell(thread.comments.map((c) => c.author), "participant", me.id) };
      }
      default:
        return null;
    }
  };

  const stopChanges = client.onChange((change, origin) => {
    // Made before the change is remembered, since an edit is compared with what the comment named until now.
    if (origin === "local") {
      const notice = build(change);
      if (notice) waiting.set(change, notice);
    }
    if (change.type === "thread.create") for (const c of change.thread.comments) mentions.set(c.id, c.mentions ?? []);
    else if (change.type === "comment.add") mentions.set(change.comment.id, change.comment.mentions ?? []);
    else if (change.type === "comment.edit") mentions.set(change.commentId, change.mentions ?? []);
  });
  const stopOutgoing = client.onOutgoing((change) => {
    const notice = waiting.get(change);
    if (!notice) return;
    waiting.delete(change);
    // A handler that fails must not break commenting, and its error should not vanish: it is thrown where it can be seen.
    const fail = (error: unknown) => void setTimeout(() => { throw error; }, 0);
    try {
      void Promise.resolve(handler(notice)).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
  return () => {
    stopChanges();
    stopOutgoing();
  };
}
