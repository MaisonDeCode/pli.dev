/**
 * Collaboration for the spreadsheet: comments, the room (who is here, and what they are looking at), and live editing.
 *
 * What `PliSheet` does with its `comments`, `room`, `users` and `sync` props, all through `@pli.dev/core` (the same pieces every
 * Pli editor uses, so a server, a transport and a comment store written for one work for all):
 *
 * - `comments`: turns on `session.comments` (`CommentClient`) with `users` from the props. Threads are kept in the workbook by
 *   default (and in the `.xlsx` file as threaded comments), or in the `store` you give. Notes, the classic yellow comments, are a
 *   separate thing and keep working beside them.
 * - `room`: the editor attaches the comments to it, connects it, and disconnects it when it goes away. It says
 *   `{ sheet, selection, editing }` through `room.setPresence`: the sheet shown, the selected cells and the cell being typed in.
 *   Other people show as avatars in the title row, a dot on the sheet tab they are on, a coloured outline with their name round
 *   their selection and a "typing" tag on the cell they are editing. Scrolling is not shared.
 * - `sync`: a `SyncClient` with `sheetSyncModel` over `room` keeps the session in step with the shared workbook.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { SyncClient, userColor, type CollabRoom, type CommentClient, type Peer, type PliUser, type Users } from "@pli.dev/core";
import { cellAddress, parseCell, parseRange, selectionRanges, sheetSyncModel, type Bounds, type CellAnchor, type GridSelection, type SheetCommentsOptions, type SheetOp, type SheetSession, type Workbook } from "@pli.dev/sheets";
import { PresenceBar, SyncIndicator, useSyncStatus } from "@pli.dev/react";

/** Options of `comments`: `SheetCommentsOptions` with `users` optional (the `users` prop is used when it is left out). */
export type CommentsProp = true | (Omit<SheetCommentsOptions, "users"> & { users?: Users });

/** Options of `sync`. */
export interface SyncProp {
  /** The version of the shared workbook the session was loaded at, if you kept it (see `SyncClientOptions.version`). */
  version?: number | null;
  /** How often to check the workbook against the server's, in ms (default 30 seconds; 0 never). */
  verifyEvery?: number;
  /** Called when the workbook was reloaded from the server, and how many of your changes it may have lost. */
  onResync?: (info: { reason: string; lost: number }) => void;
}

export interface CollabProps {
  room?: CollabRoom<CellAnchor>;
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

/** What a person shares: the sheet they are on, their selection and the cell they are typing in. */
export interface SheetPresenceState {
  sheet: string | null;
  selection: GridSelection | null;
  editing: { row: number; col: number } | null;
}

/** What we last told each room, so a redraw that changed nothing says nothing. */
const told = new WeakMap<object, string>();

/** Says what this person is doing, unless it is what the room was told last. */
export function publishPresence(room: CollabRoom<any>, state: SheetPresenceState): void {
  const selection = state.selection ? { active: addressOf(state.selection), ranges: selectionRanges(state.selection).map(boundsText) } : null;
  const payload = { sheet: state.sheet, surface: state.sheet, selection, editing: state.editing ? cellAddress(state.editing.row, state.editing.col) : null };
  const text = JSON.stringify(payload);
  if (told.get(room) === text) return;
  told.set(room, text);
  room.setPresence(payload);
}

function addressOf(sel: GridSelection): string {
  const a = sel.active ?? sel.anchor;
  return cellAddress(a.row, a.col);
}

function boundsText(b: Bounds): string {
  return b.r1 === b.r2 && b.c1 === b.c2 ? cellAddress(b.r1, b.c1) : `${cellAddress(b.r1, b.c1)}:${cellAddress(b.r2, b.c2)}`;
}

/** One person's marks on a sheet, in cells. */
export interface PeerMark {
  /** The connection (one person with two tabs open shows twice). */
  client: string;
  user: PliUser;
  color: string;
  ranges: Bounds[];
  active: { row: number; col: number } | null;
  /** The cell they are typing in. */
  editing: { row: number; col: number } | null;
}

const asBounds = (range: unknown): Bounds | null => (typeof range === "string" ? parseRange(range) : null);

/** The marks other people leave on a sheet: the cells they have selected, and the one they are typing in. */
export function peerMarks(peers: readonly Peer[], _you: PliUser | null, sheetId: string): PeerMark[] {
  const out: PeerMark[] = [];
  for (const peer of peers) {
    const state = peer.state as { sheet?: string | null; selection?: { active?: string; ranges?: string[] } | null; editing?: string | null };
    if (state.sheet !== sheetId) continue;
    const ranges = (state.selection?.ranges ?? []).flatMap((r) => {
      const b = asBounds(r);
      return b ? [b] : [];
    });
    const active = typeof state.selection?.active === "string" ? parseCell(state.selection.active) : null;
    const editing = typeof state.editing === "string" ? parseCell(state.editing) : null;
    if (!ranges.length && !active && !editing) continue;
    out.push({ client: peer.client, user: peer.user, color: peer.user.color ?? userColor(peer.user.id), ranges, active: active ? { row: active.row, col: active.col } : null, editing: editing ? { row: editing.row, col: editing.col } : null });
  }
  return out;
}

/** The people who are on each sheet, by sheet id (for the dots on the tabs). */
export function peersBySheet(peers: readonly Peer[]): Map<string, PliUser[]> {
  const out = new Map<string, PliUser[]>();
  for (const peer of peers) {
    const sheet = (peer.state as { sheet?: unknown }).sheet;
    if (typeof sheet !== "string") continue;
    const list = out.get(sheet) ?? [];
    if (!list.some((u) => u.id === peer.user.id)) list.push(peer.user);
    out.set(sheet, list);
  }
  return out;
}

export interface Collab {
  /** The sync client, when `sync` is on and there is a room. */
  sync: SyncClient<Workbook, SheetOp> | null;
  peers: readonly Peer[];
  /** The person using this window. */
  you: PliUser | null;
  /** The comments of the workbook, when they are on. */
  comments: CommentClient<CellAnchor> | null;
}

/** Wires comments, the room and sync to the session for as long as the component is mounted. See the header of this file. */
export function useSheetCollab(session: SheetSession, props: CollabProps): Collab {
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
        ? new SyncClient<Workbook, SheetOp>({
            session: session.core,
            room: room!,
            model: sheetSyncModel,
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

