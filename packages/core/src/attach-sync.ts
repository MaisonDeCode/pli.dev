import type { CollabRoom, SocketLike } from "./collab";
import type { CommentClient } from "./comments";
import type { Session } from "./session";
import type { SyncModel } from "./sync";
import { SyncClient, type SyncClientOptions } from "./sync-client";

export interface AttachSyncOptions<State, Op, Meta> {
  /** The room that carries presence, comments and sync. It is connected for you if it is idle. */
  room: CollabRoom<any>;
  /** The comments of this file, shared through the room while attached. */
  comments?: CommentClient<any> | null;
  /** The version the session was loaded at (see `SyncClientOptions.version`). */
  version?: SyncClientOptions<State, Op, Meta>["version"];
  verifyEvery?: SyncClientOptions<State, Op, Meta>["verifyEvery"];
  onResync?: SyncClientOptions<State, Op, Meta>["onResync"];
  /**
   * A socket.io client (or anything with `on`/`off`): its `connect` and `disconnect` events tell the sync client whether it
   * is online, so changes made offline are kept and sent when the socket comes back.
   */
  socket?: SocketLike;
}

export interface AttachedSync<State, Op, Meta> {
  readonly sync: SyncClient<State, Op, Meta>;
  /** Resolves once the first copy of the shared document has arrived (the session then holds it). */
  readonly ready: Promise<void>;
  /** Stops syncing, takes the comments off the room, and disconnects the room if `attachSync` was the one that connected it. */
  stop(): void;
}

/** Tells a sync client when a socket loses its connection and gets it back. Returns a function that stops listening. */
export function trackSocket(sync: Pick<SyncClient<any, any, any>, "setOnline">, socket: SocketLike): () => void {
  const down = () => sync.setOnline(false);
  const up = () => sync.setOnline(true);
  socket.on("disconnect", down);
  socket.on("connect", up);
  return () => {
    socket.off?.("disconnect", down);
    socket.off?.("connect", up);
  };
}

/**
 * Puts a session on a shared document: the one call every editor makes to go live.
 *
 *     const live = attachSync(session, sheetSyncModel, { room, comments: session.comments, socket });
 *     await live.ready;       // the shared document has arrived
 *     live.stop();            // on unmount
 *
 * It starts a `SyncClient` over the room, shares the file's comments through the same room, connects the room if nobody
 * has, and (with `socket`) follows the socket's connection state. Everything it does is undone by `stop`.
 */
export function attachSync<State, Op, Meta = undefined>(
  session: Session<State, Op, Meta> | { core: Session<State, Op, Meta> },
  model: SyncModel<State, Op>,
  options: AttachSyncOptions<State, Op, Meta>,
): AttachedSync<State, Op, Meta> {
  const core = "core" in session ? session.core : session;
  const { room, comments } = options;
  const sync = new SyncClient<State, Op, Meta>({ session: core, room, model, version: options.version, verifyEvery: options.verifyEvery, onResync: options.onResync });
  const cleanups: (() => void)[] = [];
  if (comments) room.attachComments(comments);
  if (options.socket) cleanups.push(trackSocket(sync, options.socket));
  sync.start();
  const mine = room.status === "idle";
  if (mine) void Promise.resolve(room.connect()).catch(() => {});

  const ready = new Promise<void>((resolve) => {
    if (sync.version !== null) return resolve();
    const off = sync.subscribe(() => {
      if (sync.version !== null) {
        off();
        resolve();
      }
    });
    cleanups.push(off);
  });

  let stopped = false;
  return {
    sync,
    ready,
    stop() {
      if (stopped) return;
      stopped = true;
      sync.stop();
      for (const cleanup of cleanups.splice(0)) cleanup();
      if (comments) room.attachComments(null);
      if (mine) room.disconnect();
    },
  };
}
