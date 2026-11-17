/**
 * Collaboration for the slide editor: comments, the room (who is here, and what they are looking at), and live editing.
 *
 * What `PliDeck` does with its `comments`, `room`, `users` and `sync` props, all through `@pli.dev/core` (the same pieces every
 * Pli editor uses, so a server, a transport and a comment store written for one work for all):
 *
 * - `comments`: turns on `session.comments` (`CommentClient`) with `users` from the props. Threads are kept in the deck by
 *   default (and in the `.pptx` file), or in the `store` you give.
 * - `room`: the editor attaches the comments to it, connects it, and disconnects it when it goes away. It says
 *   `{ slide, selection, caret, present }` through `room.setPresence`: the slide shown, the selected elements, the text
 *   cursor in a text being edited, and, in a slideshow, the slide and step shown. Other people show as avatars in the title row,
 *   a coloured dot on the filmstrip, an outline with a name on the canvas and a cursor in the text.
 * - `sync`: a `SyncClient` with `deckSyncModel` over `room` keeps the session in step with the shared deck.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SyncClient, userColor, type CollabRoom, type CommentClient, type Peer, type PliUser, type Users } from "@pli.dev/core";
import { deckSyncModel, flatOffset, textPosition, type Deck, type DeckAnchor, type DeckCommentsOptions, type DeckOp, type DeckPresence, type DeckSelection, type DeckSession, type Scene } from "@pli.dev/decks";
import { PresenceBar, SyncIndicator, useSyncStatus } from "@pli.dev/react";
import { posToDom } from "./domsel";

/** Options of `comments`: `DeckCommentsOptions` with `users` optional (the `users` prop is used when it is left out). */
export type CommentsProp = true | (Omit<DeckCommentsOptions, "users"> & { users?: Users });

/** Options of `sync`. */
export interface SyncProp {
  /** The version of the shared deck the session was loaded at, if you kept it (see `SyncClientOptions.version`). */
  version?: number | null;
  /** How often to check the deck against the server's, in ms (default 30 seconds; 0 never). */
  verifyEvery?: number;
  /** Called when the deck was reloaded from the server, and how many of your changes it may have lost. */
  onResync?: (info: { reason: string; lost: number }) => void;
}

export interface CollabProps {
  room?: CollabRoom<DeckAnchor>;
  users?: Users;
  comments?: CommentsProp;
  sync?: boolean | SyncProp;
}

const NO_PEERS: readonly Peer[] = [];

/** The people in a room, kept up to date. */
export function useRoomPeers(room: CollabRoom<any> | undefined): readonly Peer[] {
  return useSyncExternalStore(
    (listener) => room?.subscribe(listener) ?? (() => {}),
    () => room?.peers ?? NO_PEERS,
    () => NO_PEERS,
  );
}

/** What we last told each room, so a redraw that changed nothing says nothing. */
const told = new WeakMap<object, string>();

/** Says what this person is doing, unless it is what the room was told last. */
export function publishPresence(room: CollabRoom<any>, state: Required<DeckPresence> & { present: { slide: string; step: number } | null }): void {
  const text = JSON.stringify(state);
  if (told.get(room) === text) return;
  told.set(room, text);
  room.setPresence({ slide: state.slide, surface: state.slide, selection: [...state.selection], caret: state.caret, present: state.present });
}

export interface Collab {
  /** The sync client, when `sync` is on and there is a room. */
  sync: SyncClient<Deck, DeckOp, DeckSelection> | null;
  peers: readonly Peer[];
  /** The person using this window. */
  you: PliUser | null;
  /** The comments of the deck, when they are on. */
  comments: CommentClient<DeckAnchor> | null;
}

/** Wires comments, the room and sync to the session for as long as the component is mounted. See the header of this file. */
export function useDeckCollab(session: DeckSession, props: CollabProps): Collab {
  const { room, users, comments, sync: syncProp } = props;
  // Comments are on before the first paint, so the panel finds its client.
  const commentUsers = (comments && comments !== true ? comments.users : undefined) ?? users;
  useMemo(() => {
    if (!comments || session.comments.client || !commentUsers) return;
    const options = comments === true ? {} : comments;
    session.comments.enable({ ...options, users: commentUsers });
  }, [session, !!comments, commentUsers]); // eslint-disable-line react-hooks/exhaustive-deps
  const client = comments ? session.comments.client : null;

  const syncOptions: SyncProp | null = syncProp ? (syncProp === true ? {} : syncProp) : null;
  const latestSync = useRef(syncOptions);
  latestSync.current = syncOptions;
  const wantSync = !!syncOptions && !!room;
  const sync = useMemo(
    () =>
      wantSync
        ? new SyncClient<Deck, DeckOp, DeckSelection>({
            session: session.core,
            room: room!,
            model: deckSyncModel,
            version: latestSync.current?.version ?? null,
            verifyEvery: latestSync.current?.verifyEvery,
            onResync: (info) => latestSync.current?.onResync?.(info),
          })
        : null,
    [session, room, wantSync],
  );

  // Join the room: comments, then sync, then connect.
  useEffect(() => {
    if (!room) return;
    if (client) room.attachComments(client);
    session.syncing = !!sync;
    sync?.start();
    const mine = room.status === "idle";
    if (mine) void Promise.resolve(room.connect()).catch(() => {});
    return () => {
      sync?.stop();
      session.syncing = false;
      if (client) room.attachComments(null);
      if (mine) room.disconnect();
    };
  }, [room, client, sync, session]);

  const peers = useRoomPeers(room);
  return { sync, peers, you: users?.current ?? commentUsers?.current ?? null, comments: client };
}

/** The "who is here" stack and, with live editing, the sync state: the editor puts it in its title row. */
export function PeopleBar({ collab, room }: { collab: Collab; room: CollabRoom<any> | undefined }) {
  const state = useSyncStatus(collab.sync);
  if (!room) return null;
  return (
    <>
      <PresenceBar peers={collab.peers} you={collab.you} />
      {collab.sync && <SyncIndicator status={state.status} unsynced={state.unsynced} />}
    </>
  );
}

export const peerColor = (peer: Peer): string => peer.user.color ?? userColor(peer.user.id);

/** The other people, one entry per person (a person with two tabs open is one). */
export function otherPeers(peers: readonly Peer[], you: PliUser | null | undefined): Peer[] {
  const seen = new Set<string>();
  const out: Peer[] = [];
  for (const p of peers) {
    if (p.user.id === you?.id || seen.has(p.user.id + p.client)) continue;
    seen.add(p.user.id + p.client);
    out.push(p);
  }
  return out;
}

/** Who is on which slide, for the filmstrip's dots. */
export function peersBySlide(peers: readonly Peer[], you: PliUser | null | undefined): Map<string, PliUser[]> {
  const out = new Map<string, PliUser[]>();
  for (const p of otherPeers(peers, you)) {
    const slide = p.state.slide;
    if (typeof slide !== "string") continue;
    const list = out.get(slide) ?? [];
    if (!list.some((u) => u.id === p.user.id)) list.push({ ...p.user, color: peerColor(p) });
    out.set(slide, list);
  }
  return out;
}

/** A person who is giving a slideshow, and where they are in it. */
export interface Presenter {
  peer: Peer;
  slide: string;
  step: number;
}

export function presentersOf(peers: readonly Peer[], you: PliUser | null | undefined): Presenter[] {
  return otherPeers(peers, you).flatMap((peer) => {
    const p = peer.state.present as { slide?: unknown; step?: unknown } | null | undefined;
    return p && typeof p.slide === "string" ? [{ peer, slide: p.slide, step: typeof p.step === "number" ? p.step : 0 }] : [];
  });
}

// ---- Over the canvas ---------------------------------------------------------------------------------------------

interface Caret {
  key: string;
  user: PliUser;
  color: string;
  left: number;
  top: number;
  height: number;
  rects: { left: number; top: number; width: number; height: number }[];
}

/**
 * Other people on the slide being shown: the elements they have selected as a coloured outline with their name, and the text
 * cursor and selection of whoever is typing. Drawn over the canvas, in the editor only.
 */
export function RemoteLayer({ session, peers, you, slideId, scene, scale }: { session: DeckSession; peers: readonly Peer[]; you: PliUser | null | undefined; slideId: string | null; scene: Scene; scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [carets, setCarets] = useState<Caret[]>([]);
  const here = useMemo(() => otherPeers(peers, you).filter((p) => p.state.slide === slideId), [peers, you, slideId]);
  const deck = session.deck;

  useLayoutEffect(() => {
    const root = ref.current?.parentElement;
    if (!root || slideId === null) return setCarets((c) => (c.length ? [] : c));
    const origin = root.getBoundingClientRect();
    const next: Caret[] = [];
    for (const peer of here) {
      const caret = peer.state.caret as DeckPresence["caret"] | null | undefined;
      if (!caret) continue;
      try {
        const host = root.querySelector<HTMLElement>(`[data-element="${CSS.escape(caret.element)}"]`);
        const body = (caret.cell ? host?.querySelector<HTMLElement>(`[data-row="${caret.cell[0]}"][data-col="${caret.cell[1]}"] .pli-deck-text-body`) : host?.querySelector<HTMLElement>(".pli-deck-text-body")) ?? null;
        if (!body) continue;
        const el = session.element(slideId, caret.element);
        const ps = el.type === "shape" ? el.text?.paragraphs : el.type === "table" && caret.cell ? el.rows[caret.cell[0]]?.cells[caret.cell[1]]?.paragraphs : undefined;
        if (!ps) continue;
        const a = posToDom(body, textPosition(ps, caret.anchor));
        const f = posToDom(body, textPosition(ps, caret.focus));
        if (!a || !f) continue;
        const range = document.createRange();
        range.setStart(f.node, f.offset);
        range.collapse(true);
        const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
        const rects: Caret["rects"] = [];
        if (caret.anchor !== caret.focus) {
          const sel = document.createRange();
          const forward = caret.anchor <= caret.focus;
          const [s, e] = forward ? [a, f] : [f, a];
          sel.setStart(s.node, s.offset);
          sel.setEnd(e.node, e.offset);
          for (const q of Array.from(sel.getClientRects())) if (q.width > 0) rects.push({ left: q.left - origin.left, top: q.top - origin.top, width: q.width, height: q.height });
        }
        next.push({ key: peer.client, user: peer.user, color: peerColor(peer), left: r.left - origin.left, top: r.top - origin.top, height: r.height || 14 * scale, rects });
      } catch {
        // the text moved out from under the cursor; the next update draws it
      }
    }
    setCarets((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  });

  return (
    <div ref={ref} className="pli-deck-remote" aria-hidden="true">
      {here.flatMap((peer) => {
        const color = peerColor(peer);
        const ids = Array.isArray(peer.state.selection) ? (peer.state.selection as string[]) : [];
        return ids.flatMap((id) => {
          const el = scene.elements.find((e) => e.id === id);
          if (!el || deck.slides.length === 0) return [];
          return [
            <div key={`${peer.client}:${id}`} className="pli-deck-remote-sel" style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, borderColor: color, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}>
              <span className="pli-deck-remote-tag" style={{ background: color }}>{peer.user.name}</span>
            </div>,
          ];
        });
      })}
      {carets.map((c) => (
        <div key={c.key} className="pli-deck-remote-caret-group">
          {c.rects.map((r, i) => (
            <span key={i} className="pli-deck-remote-range" style={{ left: r.left, top: r.top, width: r.width, height: r.height, background: c.color }} />
          ))}
          <span className="pli-deck-remote-caret" style={{ left: c.left, top: c.top, height: c.height, background: c.color }}>
            <span className="pli-deck-remote-tag pli-deck-remote-caret-tag" style={{ background: c.color }}>{c.user.name}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The flat offsets a text range has in an element's text, for the presence a person publishes while editing. */
export function caretOf(session: DeckSession, owner: string, element: string, cell: [number, number] | undefined, range: { from: { p: number; o: number }; to: { p: number; o: number } }): DeckPresence["caret"] {
  try {
    const el = session.element(owner, element);
    const ps = el.type === "shape" ? el.text?.paragraphs : el.type === "table" && cell ? el.rows[cell[0]]?.cells[cell[1]]?.paragraphs : undefined;
    if (!ps) return null;
    return { element, ...(cell ? { cell } : {}), anchor: flatOffset(ps, range.from), focus: flatOffset(ps, range.to) };
  } catch {
    return null;
  }
}
