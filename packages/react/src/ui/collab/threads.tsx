import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { activeMention, insertMention, mentionsIn, splitMentions, type AnchorTracker, type Comment, type CommentClient, type PliUser, type Thread, type Users } from "@pli.dev/core";
import { Avatar } from "./people";
import { CollabIcons } from "./icons";

const MINUTE = 60_000;
/** "just now", "5m ago", "3h ago", or the date. */
export function timeAgo(then: number, now = Date.now()): string {
  const age = now - then;
  if (age < MINUTE) return "just now";
  if (age < 60 * MINUTE) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < 24 * 60 * MINUTE) return `${Math.floor(age / (60 * MINUTE))}h ago`;
  if (age < 7 * 24 * 60 * MINUTE) return `${Math.floor(age / (24 * 60 * MINUTE))}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(then).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** A comment's text, with the people it mentions picked out. */
export function CommentBody({ comment, users }: { comment: Comment; users: Users }) {
  const mentioned = (comment.mentions ?? []).map((id) => users.get(id));
  const me = users.current?.id;
  return (
    <p className="pli-comment-body">
      {splitMentions(comment.body, mentioned).map((part, i) =>
        "text" in part ? (
          part.text
        ) : (
          <span key={i} className="pli-mention" data-self={part.mention.id === me || undefined}>
            @{part.mention.name}
          </span>
        ),
      )}
    </p>
  );
}

/**
 * A box to write in. Ctrl/Cmd+Enter sends, Esc cancels. Typing `@` offers the people the app's directory finds
 * (see `UserDirectory.search`); picking one writes `@Name` and records their id with the comment.
 */
export function Composer({
  placeholder,
  submit,
  initial = "",
  initialMentions = [],
  users,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  placeholder: string;
  submit: string;
  initial?: string;
  initialMentions?: readonly string[];
  users: Users;
  onSubmit: (body: string, mentions: string[]) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** People picked from the list, and the ones the comment already mentioned: the candidates for `mentions`. */
  const [known, setKnown] = useState<PliUser[]>(() => initialMentions.map((id) => users.get(id)));
  const [matches, setMatches] = useState<PliUser[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const typing = users.canSearch ? activeMention(body, caret) : null;
  const listId = useId();

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Ask the directory what has been typed after the @. A slower answer to an earlier question is ignored.
  const query = typing && typing.start !== dismissed ? typing.query : null;
  useEffect(() => {
    if (query === null) {
      setMatches([]);
      return;
    }
    let current = true;
    users
      .search(query)
      .then((found) => {
        if (!current) return;
        setMatches(found.filter((user) => user.id !== users.current?.id).slice(0, 6));
        setHighlight(0);
      })
      .catch(() => current && setMatches([]));
    return () => {
      current = false;
    };
  }, [users, query]);

  const choose = (user: PliUser) => {
    if (!typing) return;
    const next = insertMention(body, typing, caret, user);
    setBody(next.text);
    setCaret(next.caret);
    setKnown((list) => (list.some((u) => u.id === user.id) ? list : [...list, user]));
    setMatches([]);
    // Put the caret after the name once the new text is in the box.
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = () => {
    const trimmed = body.trim();
    if (trimmed) {
      onSubmit(trimmed, mentionsIn(trimmed, known));
      setBody("");
      setCaret(0);
    }
  };
  const open = query !== null && matches.length > 0;
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((i) => (i + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab") {
        event.preventDefault();
        choose(matches[highlight]!);
        return;
      }
      if (event.key === "Escape") {
        // Closes the list, not the box.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(typing!.start);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="pli-composer">
      <textarea
        ref={ref}
        value={body}
        rows={2}
        placeholder={placeholder}
        aria-label={placeholder}
        role={users.canSearch ? "combobox" : undefined}
        aria-expanded={users.canSearch ? open : undefined}
        aria-controls={open ? listId : undefined}
        aria-autocomplete={users.canSearch ? "list" : undefined}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        onChange={(e) => {
          setBody(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="pli-mention-list" role="listbox" id={listId} aria-label="People">
          {matches.map((user, i) => (
            <li
              key={user.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(event) => {
                // Keep the focus in the box.
                event.preventDefault();
                choose(user);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <Avatar user={user} size={20} />
              <span>{user.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="pli-composer-actions">
        {onCancel && (
          <button type="button" className="pli-button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="pli-button pli-button-primary" disabled={!body.trim()} onClick={send}>
          {submit}
        </button>
      </div>
    </div>
  );
}

/**
 * A thread as a card: the quoted place, every comment with edit and delete, replies, and resolve. Shared by every editor
 * (it shows the anchor's `quote`, or what `quote` says). `attached` says whether the thing the thread is about still exists.
 */
export function ThreadCard<A>({
  client,
  thread,
  active,
  onActivate,
  attached = true,
  quote,
  missing = "The commented text was deleted",
  fallbackQuote = "Commented text",
  quoteLabel = "Go to the commented text",
}: {
  client: CommentClient<A>;
  thread: Thread<A>;
  active: boolean;
  onActivate: (id: string | null) => void;
  attached?: boolean;
  /** What to show as the thread's place (a quote, a cell address). Defaults to the anchor's `quote`. */
  quote?: ReactNode;
  /** What is shown instead of the quote when `attached` is false. */
  missing?: string;
  /** What is shown when the anchor has no quote. */
  fallbackQuote?: string;
  /** The accessible name of the quote button. */
  quoteLabel?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const can = (action: Parameters<typeof client.can>[0], comment?: Comment) => client.can(action, thread, comment);
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch {
      // A permission that changed under us: the buttons catch up on the next render.
    }
  };

  return (
    <li ref={ref} className="pli-thread" data-active={active || undefined} data-resolved={!!thread.resolved || undefined} data-thread={thread.id}>
      <button type="button" className="pli-thread-quote" onClick={() => onActivate(thread.id)} aria-label={quoteLabel}>
        {attached ? quote || (thread.anchor as { quote?: string } | undefined)?.quote || fallbackQuote : <em>{missing}</em>}
      </button>
      {thread.comments.map((comment, i) => {
        const author = client.users.get(comment.author);
        return (
          <div key={comment.id} className="pli-comment-item">
            <div className="pli-comment-head">
              <Avatar user={author} size={22} />
              <span className="pli-comment-author">{author.name}</span>
              <time className="pli-comment-time" dateTime={new Date(comment.createdAt).toISOString()} title={new Date(comment.createdAt).toLocaleString()}>
                {timeAgo(comment.createdAt)}
              </time>
              {comment.editedAt && <span className="pli-comment-time">(edited)</span>}
              {(can("edit", comment) || can("delete", comment)) && editing !== comment.id && (
                <span className="pli-comment-tools">
                  {can("edit", comment) && (
                    <button type="button" className="pli-link-button" onClick={() => setEditing(comment.id)}>
                      Edit
                    </button>
                  )}
                  {can("delete", comment) && (
                    <button type="button" className="pli-link-button" onClick={() => (thread.comments.length === 1 || i === 0 ? setConfirming(comment.id) : attempt(() => client.deleteComment(thread.id, comment.id)))}>
                      Delete
                    </button>
                  )}
                </span>
              )}
            </div>
            {editing === comment.id ? (
              <Composer
                autoFocus
                initial={comment.body}
                initialMentions={comment.mentions}
                users={client.users}
                placeholder="Edit comment"
                submit="Save"
                onCancel={() => setEditing(null)}
                onSubmit={(body, mentions) => {
                  attempt(() => client.editComment(thread.id, comment.id, body, mentions));
                  setEditing(null);
                }}
              />
            ) : (
              <CommentBody comment={comment} users={client.users} />
            )}
            {confirming === comment.id && (
              <p className="pli-comment-confirm" role="alert">
                {thread.comments.length === 1 ? "Delete this comment and its thread?" : "Delete this comment?"}{" "}
                <button type="button" className="pli-link-button pli-danger" onClick={() => attempt(() => client.deleteComment(thread.id, comment.id))}>
                  Delete
                </button>{" "}
                <button type="button" className="pli-link-button" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </p>
            )}
          </div>
        );
      })}
      {thread.resolved && (
        <p className="pli-thread-resolved">
          Resolved by {client.users.get(thread.resolved.by).name} · {timeAgo(thread.resolved.at)}
        </p>
      )}
      {active && !thread.resolved && can("reply") && (
        <Composer placeholder="Reply" submit="Reply" users={client.users} onSubmit={(body, mentions) => attempt(() => void client.reply(thread.id, body, mentions))} />
      )}
      {can("resolve") && (
        <div className="pli-thread-actions">
          <button type="button" className="pli-button" onClick={() => attempt(() => (thread.resolved ? client.reopen(thread.id) : client.resolve(thread.id)))}>
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
        </div>
      )}
    </li>
  );
}

// ---- The panel ------------------------------------------------------------------------------------------------

/** What `CommentThreads` can narrow the list to. */
export type CommentFilter = "all" | "open" | "resolved" | "mine" | "mentions";

const FILTERS: { id: CommentFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "mine", label: "Mine" },
  { id: "mentions", label: "Mentions" },
  { id: "all", label: "All" },
];

export interface CommentThreadsProps<A> {
  client: CommentClient<A>;
  /** The thread that is open: its place is selected, or it was clicked. */
  activeId: string | null;
  onActivate: (id: string | null) => void;
  /** A comment being started: what it is about, and what to do when it is written or given up. */
  draft?: { quote: ReactNode; onSubmit: (body: string, mentions: string[]) => void; onCancel: () => void } | null;
  /** Says what each thread is about (the quoted text, a cell address, "Slide 3"). Defaults to the anchor's `quote`. */
  quote?: (thread: Thread<A>) => ReactNode;
  /** Tells whether a thread's content still exists. Pass an `AnchorTracker` (or anything with `isAttached` and `subscribe`). */
  anchors?: Pick<AnchorTracker<A, any, any, any>, "isAttached" | "subscribe"> | null;
  /** The same as `anchors`, for an editor that works it out itself. */
  isAttached?: (thread: Thread<A>) => boolean;
  /** Puts the threads in the order the editor wants (reading order). Default: oldest first. */
  order?: (threads: readonly Thread<A>[]) => Thread<A>[];
  /** `menu` (the default) offers Open, Resolved, Mine, Mentions and All; `toggle` is one "Show N resolved" link. */
  filters?: "menu" | "toggle";
  /** The filter to start with. Default `open`. */
  initialFilter?: CommentFilter;
  onClose?: () => void;
  title?: string;
  /** Shown when there is nothing to list. */
  empty?: ReactNode;
  missing?: string;
  fallbackQuote?: string;
  quoteLabel?: string;
}

const byCreation = <A,>(threads: readonly Thread<A>[]): Thread<A>[] => [...threads].sort((a, b) => a.createdAt - b.createdAt);

/**
 * The comments panel every editor uses: a header with a count, a filter, a box for the comment being started, and the
 * threads as cards. It never looks inside the file: the editor says what each thread is about (`quote`), whether it is still
 * attached (`anchors`), and what to do when one is chosen (`onActivate`).
 */
export function CommentThreads<A>({
  client,
  activeId,
  onActivate,
  draft,
  quote,
  anchors,
  isAttached,
  order = byCreation,
  filters = "menu",
  initialFilter = "open",
  onClose,
  title = "Comments",
  empty,
  missing,
  fallbackQuote,
  quoteLabel,
}: CommentThreadsProps<A>) {
  const threads = useSyncExternalStore(
    useCallback((listener: () => void) => client.subscribe(listener), [client]),
    () => client.threads,
    () => client.threads,
  );
  // The anchors moving is a reason to draw again.
  useSyncExternalStore(
    useCallback((listener: () => void) => anchors?.subscribe(listener) ?? (() => {}), [anchors]),
    () => anchors,
    () => anchors,
  );
  const [filter, setFilter] = useState<CommentFilter>(initialFilter === "resolved" && filters === "toggle" ? "open" : initialFilter);
  const [showResolved, setShowResolved] = useState(false);
  const me = client.users.current?.id;

  const sorted = useMemo(() => order(threads), [order, threads]);
  const open = sorted.filter((t) => !t.resolved);
  const resolved = sorted.filter((t) => t.resolved);
  const matches = (t: Thread<A>): boolean => {
    switch (filter) {
      case "all":
        return true;
      case "open":
        return !t.resolved;
      case "resolved":
        return !!t.resolved;
      case "mine":
        return !!me && t.comments.some((c) => c.author === me);
      case "mentions":
        return !!me && t.comments.some((c) => c.mentions?.includes(me));
    }
  };
  const visible = filters === "toggle" ? (showResolved ? sorted : open) : sorted.filter(matches);

  // Ask the directory about everyone at once.
  const authors = useMemo(() => threads.flatMap((t) => t.comments.map((c) => c.author)), [threads]);
  useEffect(() => client.users.prefetch(authors), [client, authors]);

  const canComment = client.can("comment");
  const attachedFor = (t: Thread<A>) => (isAttached ? isAttached(t) : anchors ? anchors.isAttached(t.id) : true);
  const counts: Record<CommentFilter, number> = {
    all: sorted.length,
    open: open.length,
    resolved: resolved.length,
    mine: me ? sorted.filter((t) => t.comments.some((c) => c.author === me)).length : 0,
    mentions: me ? sorted.filter((t) => t.comments.some((c) => c.mentions?.includes(me))).length : 0,
  };

  return (
    <aside className="pli-comments" aria-label={title}>
      <div className="pli-comments-head">
        <strong>{title}</strong>
        <span className="pli-comments-count">{open.length}</span>
        {onClose && (
          <button type="button" className="pli-tool" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            {CollabIcons.close}
          </button>
        )}
      </div>
      {filters === "menu" && (
        <div className="pli-comment-filters" role="group" aria-label="Show comments">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="pli-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== "all" && counts[f.id] > 0 && <span className="pli-chip-count">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
      )}
      {client.status === "error" && (
        <p className="pli-comments-note" role="alert">
          Comments couldn't be loaded.{" "}
          <button type="button" className="pli-link-button" onClick={() => void client.reload()}>
            Try again
          </button>
        </p>
      )}
      {draft && (
        <div className="pli-thread pli-thread-draft" data-active>
          <p className="pli-thread-quote">{draft.quote}</p>
          <Composer autoFocus placeholder="Add a comment" submit="Comment" users={client.users} onCancel={draft.onCancel} onSubmit={draft.onSubmit} />
        </div>
      )}
      <ul className="pli-thread-list">
        {visible.map((thread) => (
          <ThreadCard
            key={thread.id}
            client={client}
            thread={thread}
            active={thread.id === activeId}
            onActivate={onActivate}
            attached={attachedFor(thread)}
            quote={quote?.(thread)}
            missing={missing}
            fallbackQuote={fallbackQuote}
            quoteLabel={quoteLabel}
          />
        ))}
      </ul>
      {visible.length === 0 && !draft && (
        <p className="pli-comments-note">{empty ?? (canComment ? (filter === "open" || filters === "toggle" ? "No open comments." : "No comments here.") : "No comments yet.")}</p>
      )}
      {filters === "toggle" && resolved.length > 0 && (
        <button type="button" className="pli-link-button pli-comments-toggle" onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Hide" : "Show"} {resolved.length} resolved
        </button>
      )}
    </aside>
  );
}
