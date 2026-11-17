/**
 * Comments in the spreadsheet, as in Excel and Google Sheets: a mark in the corner of each cell that has a thread, a card with
 * the conversation when the pointer rests on the cell, and a panel that lists every thread with the filters Open, Resolved,
 * Mine and Mentions. Everything a thread card does (replies, @mentions, edit, delete, resolve) is the shared one from
 * `@pli.dev/react`. Notes, the classic yellow comments, are drawn and edited as before; a cell has one or the other.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CommentClient, Thread } from "@pli.dev/core";
import { cellAddress, parseCell, type CellAnchor, type SheetSession } from "@pli.dev/sheets";
import { CommentThreads, ThreadCard, keepFocus } from "@pli.dev/react";

/** A cell that has a thread, for the grid's corner mark. */
export interface ThreadMark {
  row: number;
  col: number;
  resolved: boolean;
  active: boolean;
}

const NONE: readonly never[] = [];

/** The threads of a client, kept up to date. */
export function useThreads(client: CommentClient<CellAnchor> | null): readonly Thread<CellAnchor>[] {
  const subscribe = useCallback((listener: () => void) => client?.subscribe(listener) ?? (() => {}), [client]);
  return useSyncExternalStore(subscribe, () => client?.threads ?? NONE, () => NONE);
}

/** The marks for the threads whose cell is on a sheet. */
export function threadMarks(session: SheetSession, threads: readonly Thread<CellAnchor>[], sheetId: string, active: string | null): ThreadMark[] {
  const out: ThreadMark[] = [];
  for (const t of threads) {
    const place = session.comments.placeOf(t.id);
    if (!place || place.sheet !== sheetId) continue;
    const pos = parseCell(place.cell);
    if (pos) out.push({ row: pos.row, col: pos.col, resolved: !!t.resolved, active: t.id === active });
  }
  return out;
}

/** Where a thread is, for the panel's label: `Sheet1!B3`. */
export function placeLabel(session: SheetSession, thread: Thread<CellAnchor>): string | undefined {
  const place = session.comments.placeOf(thread.id);
  if (!place) return thread.anchor ? `${thread.anchor.cell}` : undefined;
  const sheet = session.state.sheets.find((s) => s.id === place.sheet);
  return `${sheet?.name ?? ""}!${place.range ?? place.cell}`;
}

export interface CommentsPanelProps {
  session: SheetSession;
  client: CommentClient<CellAnchor>;
  /** The thread that is open. */
  activeId: string | null;
  /** Called when a thread is chosen: go to its cell. */
  onActivate(id: string | null): void;
  /** A comment being started on the selected cell or range: what it is about, and what to do when it is written or given up. */
  draft: { cell: string; onSubmit(body: string, mentions: string[]): void; onCancel(): void } | null;
  onClose(): void;
}

/** The comments panel: every thread of the workbook in sheet order, then reading order, and the threads whose cell was deleted last. */
export function CommentsPanel({ session, client, activeId, onActivate, draft, onClose }: CommentsPanelProps) {
  const threads = useThreads(client);
  const order = useCallback(
    (list: readonly Thread<CellAnchor>[]) => {
      const sheets = session.state.sheets.map((s) => s.id);
      const rank = (t: Thread<CellAnchor>) => {
        const place = session.comments.placeOf(t.id);
        const pos = place ? parseCell(place.cell) : null;
        return place && pos ? [sheets.indexOf(place.sheet), pos.row, pos.col] : [Infinity, 0, 0];
      };
      return [...list].sort((a, b) => {
        const x = rank(a);
        const y = rank(b);
        return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]! || a.createdAt - b.createdAt;
      });
    },
    [session, threads], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div className="pli-sheet-comments">
      <CommentThreads
        client={client}
        activeId={activeId}
        onActivate={onActivate}
        draft={draft ? { quote: <span className="pli-sheet-comment-cell">{draft.cell}</span>, onSubmit: draft.onSubmit, onCancel: draft.onCancel } : null}
        quote={(t) => placeLabel(session, t)}
        isAttached={(t) => session.comments.isAttached(t.id)}
        order={order}
        onClose={onClose}
        missing="The cell was deleted"
        fallbackQuote="Cell"
        quoteLabel="Go to the cell"
        empty={<p className="pli-comments-empty">No comments yet. Select a cell and press Ctrl+Alt+M.</p>}
      />
    </div>
  );
}

export interface ThreadHoverProps {
  client: CommentClient<CellAnchor>;
  thread: Thread<CellAnchor>;
  /** The cell's place in the window. */
  info: { left: number; top: number; right: number; bottom: number; active: boolean };
  container: HTMLElement | null;
  onActivate(id: string | null): void;
}

/** The card that shows a thread when the pointer rests on its cell (or the cell is selected): the conversation, with replies and resolve. */
export function ThreadHover({ client, thread, info, container, onActivate }: ThreadHoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const live = useThreads(client).find((t) => t.id === thread.id) ?? thread;
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    const below = info.bottom + 4;
    const top = below + box.height > window.innerHeight - margin ? Math.max(margin, info.top - box.height - 4) : below;
    setPlace({ left: Math.max(margin, Math.min(info.left, window.innerWidth - box.width - margin)), top });
  }, [info.left, info.top, info.bottom, live.comments.length, live.resolved]);
  const author = useMemo(() => client.users.get(live.comments[0]?.author ?? "").name, [client, live]);
  return createPortal(
    <div
      ref={ref}
      className="pli-panel pli-panel-fixed pli-sheet-threadcard"
      role={info.active ? "group" : "tooltip"}
      aria-label={`Comment by ${author}`}
      style={place ? { left: place.left, top: place.top } : { left: info.left, top: info.bottom + 4, visibility: "hidden" }}
      onMouseDown={keepFocus}
      onPointerLeave={() => {
        if (!info.active) window.dispatchEvent(new Event("pli-cellcard-left"));
      }}
    >
      <ThreadCard client={client} thread={live} active={info.active} onActivate={onActivate} />
    </div>,
    container ?? document.body,
  );
}

export { cellAddress };
