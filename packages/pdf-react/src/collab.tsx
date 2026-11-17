/**
 * Collaboration for the viewer: comments, the room (who is here, and what they are looking at), and live editing.
 *
 * What `PliPdf` does with its `comments`, `room`, `users` and `sync` props, all through `@pli.dev/core` (the same pieces every
 * Pli editor uses, so a server, a transport and a comment store written for one work for all):
 *
 * - `comments`: turns on `session.comments` (`CommentClient`) for the session, with `users` from the props. The threads are
 *   kept in the document by default, or in the `store` you give.
 * - `room`: the viewer attaches the comments to it, connects it, and disconnects it when it goes away. It says
 *   `{ page, selection, tool }` (the page shown, the selected annotations, the active tool) through `room.setPresence`, and
 *   shows a "who is here" stack in the toolbar. The annotation layer draws other people's selections (`presenceFromPeers`).
 * - `sync`: a `SyncClient` with `pdfSyncModel` over `room` keeps the session in step with the shared document. It is
 *   stopped when the viewer goes away.
 *
 * A file that a peer added to the document (merged pages) is not sent to you with the change, only a description of it. Its
 * bytes are fetched with `session.sources.get(source)`, so give the session a `SourceStore` that can reach the same file
 * storage (`storageSources`). Until they arrive the pages of that file show "Waiting for the file" and ask again, with
 * growing pauses, so a store that gets the file a little later (an upload still running) fills them in.
 */
import { useEffect, useMemo, useRef } from "react";
import { SyncClient, throttle, type CollabRoom, type Peer, type PliUser, type Users } from "@pli.dev/core";
import { pdfSyncModel, type PdfAnchor, type PdfCommentsOptions, type PdfDoc, type PdfOp, type PdfSelection, type PdfSession } from "@pli.dev/pdf";
import { PresenceBar, SyncIndicator, useRoomPeers, useSyncStatus } from "@pli.dev/react/collab";

/** Options of `comments`: `PdfCommentsOptions` with `users` optional (the `users` prop is used when it is left out). */
export type CommentsProp = true | (Omit<PdfCommentsOptions, "users"> & { users?: Users });

/** Options of `sync`. */
export interface SyncProp {
  /** The version of the shared document the session was loaded at, if you kept it (see `SyncClientOptions.version`). */
  version?: number | null;
  /** How often to check the document against the server's, in ms (default 30 seconds; 0 never). */
  verifyEvery?: number;
  /** Called when the document was reloaded from the server, and how many of your changes it may have lost. */
  onResync?: (info: { reason: string; lost: number }) => void;
}

export interface CollabProps {
  room?: CollabRoom<PdfAnchor>;
  users?: Users;
  comments?: CommentsProp;
  sync?: boolean | SyncProp;
}

/** The people in a room, kept up to date (the hook every editor shares). */
export { useRoomPeers };

/** What we last told each room, so a redraw that changed nothing says nothing. */
const told = new WeakMap<object, string>();

/** Where a person's pointer is: on which page, and where on it (page space: points from the top left, not turned). */
export interface PresenceCursor {
  page: string;
  x: number;
  y: number;
}

/** How often the pointer's position is sent at most, in ms. */
export const CURSOR_MS = 50;

/** Says what this person is doing, unless it is what the room was told last. */
export function publishPresence(room: CollabRoom<any>, state: { page: string | null; selection: readonly string[]; tool: string | null; cursor?: PresenceCursor | null }): void {
  const text = JSON.stringify(state);
  if (told.get(room) === text) return;
  told.set(room, text);
  room.setPresence({ page: state.page, selection: [...state.selection], tool: state.tool, cursor: state.cursor ?? null });
}

/** Runs `send` at most once every `ms`, the last request winning (moved to `@pli.dev/core`, which every editor uses). */
export { throttle };

export interface Collab {
  /** The sync client, when `sync` is on and there is a room. */
  sync: SyncClient<PdfDoc, PdfOp, PdfSelection> | null;
  peers: readonly Peer[];
  /** The person using this window. */
  you: PliUser | null;
}

/** Wires comments, the room and sync to the session for as long as the component is mounted. See the header of this file. */
export function useCollab(session: PdfSession, props: CollabProps, toolId: string | null): Collab {
  const { room, users, comments, sync: syncProp } = props;
  // Comments are on before the first paint, so the Comments tab finds its client.
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
        ? new SyncClient<PdfDoc, PdfOp, PdfSelection>({
            session: session.core,
            room: room!,
            model: pdfSyncModel,
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
    sync?.start();
    const mine = room.status === "idle";
    if (mine) void Promise.resolve(room.connect()).catch(() => {});
    return () => {
      sync?.stop();
      if (client) room.attachComments(null);
      if (mine) room.disconnect();
    };
  }, [room, client, sync]);

  const peers = useRoomPeers(room);
  return { sync, peers, you: users?.current ?? commentUsers?.current ?? null };
}

/** The "who is here" stack and, with live editing, the sync state: the viewer puts it in its toolbar. */
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
