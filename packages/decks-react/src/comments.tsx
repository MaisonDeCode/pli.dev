/**
 * Comments in the slide editor, as in Google Slides: a bubble on the slide for each thread (on the element or the place it is
 * about), a count on the slide's thumbnail, and a panel that lists the threads with the filters "This slide", "All" and "Resolved".
 * Everything a thread card does (replies, @mentions, edit, delete, resolve) is the shared one from `@pli.dev/react`.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { CommentClient, Thread } from "@pli.dev/core";
import { textPosition, type DeckAnchor, type DeckSession, type Scene, type TextRange } from "@pli.dev/decks";
import { Avatar, Composer, ThreadCard, keepFocus } from "@pli.dev/react";
import { SidePanel } from "./panels";
import type { TextHighlight } from "./SlideView";

/** What a new comment would be about: the words being edited, the selected element, or the slide. */
export interface CommentDraft {
  slide: string;
  element?: string;
  /** The words (a text range, in a table cell when `cell` is set). */
  range?: TextRange;
  cell?: [number, number];
  /** What is being commented on, in words: shown above the box. */
  label: string;
}

export function useThreads(client: CommentClient<DeckAnchor> | null): readonly Thread<DeckAnchor>[] {
  const subscribe = useCallback((listener: () => void) => client?.subscribe(listener) ?? (() => {}), [client]);
  const none = useMemo<readonly Thread<DeckAnchor>[]>(() => [], []);
  return useSyncExternalStore(subscribe, () => client?.threads ?? none, () => none);
}

/** The threads that count as open on a slide, for its thumbnail's badge. */
export function openCounts(threads: readonly Thread<DeckAnchor>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of threads) if (t.anchor && !t.resolved) out.set(t.anchor.slide, (out.get(t.anchor.slide) ?? 0) + 1);
  return out;
}

/** The words of a slide's threads, as highlights to draw in the text (the active thread's in a stronger colour). */
export function commentHighlights(session: DeckSession, slideId: string | null, threads: readonly Thread<DeckAnchor>[], active: string | null): TextHighlight[] {
  if (!slideId) return [];
  const out: TextHighlight[] = [];
  for (const t of threads) {
    if (t.anchor?.slide !== slideId || !t.anchor.text || (t.resolved && t.id !== active)) continue;
    const state = session.comments.anchorState(t);
    if (!state.text || !state.element) continue;
    const el = session.element(slideId, state.element);
    const ps = el.type === "shape" ? el.text?.paragraphs : el.type === "table" && state.text.cell ? el.rows[state.text.cell[0]]?.cells[state.text.cell[1]]?.paragraphs : undefined;
    if (!ps) continue;
    const a = textPosition(ps, state.text.from);
    const b = textPosition(ps, state.text.to);
    for (let p = a.p; p <= b.p; p++) {
      const len = ps[p]!.runs.reduce((n, r) => n + r.text.length, 0);
      const from = p === a.p ? a.o : 0;
      const to = p === b.p ? b.o : len;
      if (to > from) out.push({ element: state.element, ...(state.text.cell ? { cell: state.text.cell } : {}), paragraph: p, offset: from, length: to - from, kind: "comment", thread: t.id, current: t.id === active });
    }
  }
  return out;
}

interface Pin {
  thread: Thread<DeckAnchor>;
  x: number;
  y: number;
  orphan: boolean;
}

/** Where the bubbles of a slide's threads go, in points: at the place or the element's top right corner, the rest down the right edge. */
function pinsFor(session: DeckSession, slideId: string, scene: Scene, threads: readonly Thread<DeckAnchor>[], active: string | null): Pin[] {
  const out: Pin[] = [];
  let free = 0;
  for (const t of threads) {
    const a = t.anchor;
    if (!a || a.slide !== slideId || (t.resolved && t.id !== active)) continue;
    const state = session.comments.anchorState(t);
    const el = a.element ? scene.elements.find((e) => e.id === a.element) : undefined;
    if (a.point && !a.element) out.push({ thread: t, x: a.point.x, y: a.point.y, orphan: false });
    else if (el) out.push({ thread: t, x: el.x + el.w, y: el.y, orphan: state.orphan === "text" });
    else out.push({ thread: t, x: scene.width - 20, y: 8 + free++ * 28, orphan: !!a.element });
  }
  return out;
}

/** The comment bubbles over the slide. Drawn in the editor only. */
export function CommentPins({ session, client, slideId, scene, scale, activeId, onActivate }: { session: DeckSession; client: CommentClient<DeckAnchor>; slideId: string; scene: Scene; scale: number; activeId: string | null; onActivate: (id: string) => void }) {
  const threads = useThreads(client);
  const pins = useMemo(() => pinsFor(session, slideId, scene, threads, activeId), [session, slideId, scene, threads, activeId, session.deck]);
  if (pins.length === 0) return null;
  return (
    <div className="pli-deck-pins">
      {pins.map(({ thread, x, y, orphan }) => {
        const first = client.users.get(thread.comments[0]!.author);
        return (
          <button
            key={thread.id}
            type="button"
            className="pli-deck-pin"
            data-active={thread.id === activeId || undefined}
            data-resolved={!!thread.resolved || undefined}
            data-orphan={orphan || undefined}
            data-thread={thread.id}
            style={{ left: x * scale, top: y * scale }}
            aria-label={`Comment by ${first.name}${thread.comments.length > 1 ? `, ${thread.comments.length - 1} ${thread.comments.length === 2 ? "reply" : "replies"}` : ""}${thread.resolved ? ", resolved" : ""}`}
            onMouseDown={keepFocus}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onActivate(thread.id);
            }}
          >
            <Avatar user={first} size={22} />
            {thread.comments.length > 1 && <span className="pli-deck-pin-count">{thread.comments.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

export type CommentFilter = "slide" | "all" | "resolved";

const FILTERS: [CommentFilter, string][] = [
  ["slide", "This slide"],
  ["all", "All"],
  ["resolved", "Resolved"],
];

/** The side panel: a box for the comment being started, and the threads under the filters. */
export function DeckCommentsPanel({
  session,
  client,
  slideId,
  activeId,
  onActivate,
  draft,
  onDraftDone,
  onClose,
  readOnly,
}: {
  session: DeckSession;
  client: CommentClient<DeckAnchor>;
  slideId: string | null;
  activeId: string | null;
  onActivate: (id: string | null) => void;
  draft: CommentDraft | null;
  onDraftDone: () => void;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const threads = useThreads(client);
  const [filter, setFilter] = useState<CommentFilter>("slide");
  const deck = session.deck;
  const order = (t: Thread<DeckAnchor>) => {
    const i = deck.slides.findIndex((s) => s.id === t.anchor?.slide);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const shown = useMemo(() => {
    const list = threads.filter((t) => (filter === "resolved" ? !!t.resolved : !t.resolved && (filter === "all" || t.anchor?.slide === slideId)));
    return [...list].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
  }, [threads, filter, slideId, deck.slides]); // eslint-disable-line react-hooks/exhaustive-deps
  const canComment = !readOnly && client.can("comment");

  const submit = (body: string, mentions: string[]) => {
    if (!draft) return;
    try {
      let created: Thread<DeckAnchor>;
      if (draft.range && draft.element) created = session.comments.commentOnText(draft.slide, draft.element, draft.range, body, { cell: draft.cell, mentions });
      else if (draft.element) created = session.comments.commentOnElement(draft.slide, draft.element, body, mentions);
      else created = session.comments.commentOnSlide(draft.slide, body, undefined, mentions);
      onActivate(created.id);
      setFilter((f) => (f === "resolved" ? "slide" : f));
    } finally {
      onDraftDone();
    }
  };

  return (
    <SidePanel title="Comments" onClose={onClose} className="pli-deck-comments-panel">
      <div className="pli-deck-comment-filters" role="tablist" aria-label="Which comments">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className="pli-button" data-active={filter === key || undefined} onMouseDown={keepFocus} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>
      {draft && canComment && (
        <div className="pli-deck-comment-draft">
          <p className="pli-deck-comment-target">{draft.label}</p>
          <Composer autoFocus placeholder="Comment" submit="Comment" users={client.users} file={client.file} onSubmit={submit} onCancel={onDraftDone} />
        </div>
      )}
      {shown.length === 0 && !draft && <p className="pli-deck-comments-empty">{filter === "resolved" ? "No resolved comments." : filter === "slide" ? "No comments on this slide." : "No comments yet."}</p>}
      <div className="pli-deck-thread-list">
        {shown.map((t) => {
          const state = session.comments.anchorState(t);
          const index = deck.slides.findIndex((s) => s.id === t.anchor?.slide);
          const where = state.orphan === "slide" ? "Deleted slide" : `Slide ${index + 1}`;
          const missing = state.orphan === "slide" ? "The slide was deleted" : state.orphan === "element" ? "The commented object was deleted" : "The commented text was deleted";
          return (
            <div key={t.id} className="pli-deck-thread" data-orphan={state.orphan ?? undefined}>
              {filter !== "slide" && <p className="pli-deck-thread-where">{where}</p>}
              <ul className="pli-threads">
                <ThreadCard<DeckAnchor>
                  client={client}
                  thread={t}
                  active={t.id === activeId}
                  onActivate={onActivate}
                  attached={!state.orphan}
                  missing={missing}
                  fallbackQuote={t.anchor?.element ? "Commented object" : "Comment on the slide"}
                  quoteLabel="Go to the comment"
                />
              </ul>
            </div>
          );
        })}
      </div>
    </SidePanel>
  );
}
