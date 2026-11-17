import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { commentOrder, commentRanges, type CommentClient, type DocAnchor, type DocumentSession, type Peer, type PliUser, type Selection, type Thread } from "@pli.dev/docs";
import { domPointFromPoint } from "../dom";
import { useSessionRevision } from "../hooks";
import { CommentThreads } from "./collab/threads";

// The people, comments and sync interface is shared by every editor and lives in `./collab`. These names stay here so existing imports work.
export { Avatar, PresenceBar } from "./collab/people";
export { CommentBody, Composer, ThreadCard, timeAgo } from "./collab/threads";

export interface CommentsPanelProps {
  session: DocumentSession;
  client: CommentClient<DocAnchor>;
  /** The thread that is open: its text is selected, or it was clicked. */
  activeId: string | null;
  onActivate: (id: string | null) => void;
  /** A comment being started on this selection. */
  draft: { selection: Selection; quote: string } | null;
  onDraftDone: () => void;
  onClose: () => void;
}

/** The comments of a document: a list of threads in the order their text appears, with replies, edit, delete and resolve. */
export function CommentsPanel({ session, client, activeId, onActivate, draft, onDraftDone, onClose }: CommentsPanelProps) {
  const revision = useSessionRevision(session);
  const order = useMemo(() => commentOrder(session.state), [session, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const sort = useCallback(
    (threads: readonly Thread<DocAnchor>[]) => {
      const rank = (t: Thread<DocAnchor>) => order.get(t.id) ?? Number.MAX_SAFE_INTEGER;
      return [...threads].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
    },
    [order],
  );
  // Whether a thread's text is still in the document.
  const attached = useCallback((thread: Thread<DocAnchor>) => commentRanges(session.state, thread.id).length > 0, [session, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <CommentThreads
      client={client}
      activeId={activeId}
      onActivate={onActivate}
      order={sort}
      isAttached={attached}
      filters="toggle"
      onClose={onClose}
      empty={client.can("comment") ? "Select some text and choose Insert > Comment to start a conversation." : "No comments yet."}
      draft={
        draft && {
          quote: draft.quote,
          onCancel: onDraftDone,
          onSubmit: (body, mentions) => {
            try {
              const thread = session.comment(body, draft.selection, mentions);
              if (thread) onActivate(thread.id);
            } finally {
              onDraftDone();
            }
          },
        }
      }
    />
  );
}

interface Marker {
  key: string;
  user: PliUser;
  caret: { left: number; top: number; height: number } | null;
  rects: { left: number; top: number; width: number; height: number }[];
}

/**
 * Where the other people are: a colored caret with their name, and their selection shaded. Drawn over the
 * canvas, so it scrolls with the pages.
 */
export function RemoteCursors({ peers, you, getRoot, container, layoutKey }: {
  peers: readonly Peer[];
  you?: PliUser | null;
  getRoot: () => HTMLElement | null;
  container: HTMLElement | null;
  /** Anything that changes when the text moves: the layout, the zoom. */
  layoutKey: unknown;
}) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const revision = useRef(0);

  useLayoutEffect(() => {
    const root = getRoot();
    if (!root || !container) {
      setMarkers([]);
      return;
    }
    const origin = container.getBoundingClientRect();
    const next: Marker[] = [];
    for (const peer of peers) {
      const selection = peer.state.selection as Selection | null | undefined;
      if (!selection || peer.user.id === you?.id) continue;
      const focus = domPointFromPoint(root, selection.focus);
      const anchor = domPointFromPoint(root, selection.anchor);
      if (!focus || !anchor) continue;
      const toLocal = (r: { left: number; top: number }) => ({ left: r.left - origin.left + container.scrollLeft, top: r.top - origin.top + container.scrollTop });
      const range = root.ownerDocument.createRange();
      let caret: Marker["caret"] = null;
      try {
        range.setStart(focus.node, focus.offset);
        range.collapse(true);
        const rect = range.getClientRects()[0] ?? (focus.node instanceof Element ? focus.node.getBoundingClientRect() : focus.node.parentElement?.getBoundingClientRect());
        if (rect) caret = { ...toLocal(rect), height: rect.height || 16 };
      } catch {
        // The point moved out from under us; the next update draws it.
      }
      const rects: Marker["rects"] = [];
      if (selection.anchor.block !== selection.focus.block || selection.anchor.offset !== selection.focus.offset) {
        try {
          const [a, b] = [anchor, focus];
          const before = a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_PRECEDING || (a.node === b.node && b.offset < a.offset);
          const [start, end] = before ? [b, a] : [a, b];
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          for (const r of Array.from(range.getClientRects())) {
            if (r.width > 0) rects.push({ ...toLocal(r), width: r.width, height: r.height });
          }
        } catch {
          // As above.
        }
      }
      next.push({ key: peer.client, user: peer.user, caret, rects });
    }
    setMarkers(next);
    revision.current++;
  }, [peers, you, getRoot, container, layoutKey]);

  if (markers.length === 0) return null;
  return (
    <div className="pli-remote-layer" aria-hidden="true">
      {markers.map((m) => (
        <div key={m.key} style={{ ["--pli-peer" as string]: m.user.color }}>
          {m.rects.map((r, i) => (
            <span key={i} className="pli-remote-selection" style={r} />
          ))}
          {m.caret && (
            <span className="pli-remote-caret" style={{ left: m.caret.left, top: m.caret.top, height: m.caret.height }}>
              <span className="pli-remote-flag">{m.user.name}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
