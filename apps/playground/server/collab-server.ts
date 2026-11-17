import { Server, type Socket } from "socket.io";
import {
  EditorRegistry,
  applyCommentChange,
  applyShareChange,
  createAuthority,
  isSyncMessage,
  memoryDocumentStore,
  parseRoom,
  versionFromStore,
  NOBODY,
  type Authority,
  type ClientSync,
  type CommentChange,
  type DocumentStore,
  type NamedVersion,
  type ShareChange,
  type ShareSettings,
  type Thread,
} from "@pli.dev/core";
import { defaultEditors } from "./editors";

export interface CollabServerOptions {
  /** The editor kinds this server serves. Default: document, sheet, deck and pdf (see `editors.ts`). */
  editors?: EditorRegistry;
  /** Where every room's document is kept, whatever its editor. Default: memory. A SQL store (`sql-document-store.ts`) works unchanged. */
  store?: DocumentStore<any, any>;
  onError?: (error: unknown, room: string) => void;
  /**
   * Decides whether a connection may join a room, change its document, or use its comments, versions and sharing. This is
   * where an app checks its own session or token. Return false to refuse. Default: allow everything (it is a demo).
   */
  authorize?: (request: { socket: Socket; room: string; kind: string; action: "join" | "sync" | "data"; /** For `sync`: what the client asks (`join`, `ops`, `hash`), so a read-only person can still join and check, but not send changes. */ message?: ClientSync }) => boolean | Promise<boolean>;
}

/**
 * The playground's collaboration server: what an app would run beside its web server. One server, any editor.
 *
 * - **Rooms by editor kind.** A room is named `kind:id` (`sheet:budget`, `deck:launch`; a plain name is a `document`). The
 *   kind picks the sync model, so one process serves documents, sheets, decks and PDFs at once, all through the same
 *   `createAuthority` and the same `DocumentStore`.
 * - **Realtime.** Socket.io rooms carry the messages. A change to the document goes to that kind's sequencer, whose answers
 *   go to the whole room; anything else (presence, comments) is passed on to the rest of the room.
 * - **Data.** Comments, named versions and sharing settings live in per-room "databases" (memory here; yours would be tables)
 *   that the clients reach through `CommentStore`, `VersionStorage` and `SharingStore` adapters over the socket.
 *
 * It is attached to the dev server's own HTTP server, so `pnpm playground` runs everything on one port.
 */
export function attachCollabServer(http: ConstructorParameters<typeof Server>[0], options: CollabServerOptions = {}) {
  const io = new Server(http, { serveClient: false });
  const editors = options.editors ?? defaultEditors();
  const store = options.store ?? memoryDocumentStore<any, any>();
  const onError = options.onError ?? ((error: unknown, room: string) => console.error(`[collab] ${room}:`, error));

  // One sequencer per editor kind, all over the same store; the room name keeps their documents apart.
  const authorities = new Map<string, Authority>();
  const kindOf = (room: string) => parseRoom(room).kind ?? "document";
  const authorityFor = (kind: string): Authority | null => {
    const found = authorities.get(kind);
    if (found) return found;
    const editor = editors.get(kind);
    if (!editor) return null;
    const made = createAuthority<any, any>({
      store,
      model: editor.model,
      create: editor.create,
      onError,
      // The server asks the app before it lets a connection change a file; `socket` is not known inside the authority, so it
      // is looked up from the client id the room message carries.
      authorize: options.authorize
        ? async ({ room, client, message }: { room: string; client: string; message: ClientSync }) => {
            const socket = sockets.get(client);
            return socket ? options.authorize!({ socket, room, kind, action: "sync", message }) : false;
          }
        : undefined,
    });
    authorities.set(kind, made);
    return made;
  };
  /** The socket behind each `CollabRoom.client` id, learnt from the messages it sends. */
  const sockets = new Map<string, Socket>();

  // The "databases" behind the adapters.
  const threads = new Map<string, Thread<unknown>[]>();
  const versions = new Map<string, NamedVersion[]>();
  const sharing = new Map<string, ShareSettings>();

  const valid = (room: unknown): room is string => typeof room === "string" && room.length > 0 && room.length < 100;
  const allowed = async (socket: Socket, room: string, action: "join" | "sync" | "data") => (options.authorize ? options.authorize({ socket, room, kind: kindOf(room), action }) : true);
  /** Answers a client's call. (Socket.io's `timeout` adds the error argument on the client side, so the server sends only the result.) */
  const answer = (reply: unknown, ...args: unknown[]) => typeof reply === "function" && (reply as (...a: unknown[]) => void)(...args);

  io.on("connection", (socket: Socket) => {
    // A join that has to ask the app first is not finished when the next message from the same socket arrives, so those
    // messages wait for it.
    const joining = new Map<string, Promise<void>>();
    socket.on("pli:join", (room: unknown) => {
      if (!valid(room)) return;
      if (!editors.has(kindOf(room))) {
        socket.emit("pli:refused", room, `No "${kindOf(room)}" editor is registered on this server`);
        return;
      }
      if (!options.authorize) {
        void socket.join(room);
        return;
      }
      const attempt = allowed(socket, room, "join").then(async (ok) => {
        if (ok) await socket.join(room);
        else socket.emit("pli:refused", room, "not allowed");
      });
      joining.set(room, attempt);
      void attempt.finally(() => joining.get(room) === attempt && joining.delete(room));
    });
    socket.on("pli:leave", (room: unknown) => {
      if (valid(room)) void socket.leave(room);
    });
    socket.on("pli", async (room: unknown, data: unknown) => {
      if (!valid(room)) return;
      const waiting = joining.get(room);
      if (waiting) await waiting;
      // Only people in a room may speak in it.
      if (!socket.rooms.has(room)) return;
      if (isSyncMessage(data)) {
        const client = (data as { client?: unknown }).client;
        if (typeof client === "string") sockets.set(client, socket);
        const authority = authorityFor(kindOf(room));
        if (authority) void authority.receive(room, data, (envelope) => io.to(room).emit("pli", room, envelope));
      } else {
        socket.to(room).emit("pli", room, data);
      }
    });
    socket.on("disconnect", () => {
      for (const [client, s] of sockets) if (s === socket) sockets.delete(client);
    });

    // Comments: load a room's threads, and save one change at a time.
    socket.on("lab:comments:load", async (room: unknown, reply: unknown) => {
      if (valid(room) && (await allowed(socket, room, "data"))) answer(reply, threads.get(room) ?? []);
    });
    socket.on("lab:comments:save", async (room: unknown, change: CommentChange<unknown>, reply: unknown) => {
      if (!valid(room) || !change || typeof change.type !== "string" || !(await allowed(socket, room, "data"))) return;
      threads.set(room, applyCommentChange(threads.get(room) ?? [], change));
      answer(reply);
    });

    // Named versions: list, save one from a client, save one straight from the sequencer's store, delete.
    socket.on("lab:versions:list", async (room: unknown, reply: unknown) => {
      if (valid(room) && (await allowed(socket, room, "data"))) answer(reply, versions.get(room) ?? []);
    });
    socket.on("lab:versions:save", async (room: unknown, version: NamedVersion, reply: unknown) => {
      if (!valid(room) || !version || typeof version.id !== "string" || !(await allowed(socket, room, "data"))) return;
      versions.set(room, [...(versions.get(room) ?? []).filter((v) => v.id !== version.id), version]);
      answer(reply);
    });
    socket.on("lab:versions:remove", async (room: unknown, id: unknown, reply: unknown) => {
      if (!valid(room) || typeof id !== "string" || !(await allowed(socket, room, "data"))) return;
      versions.set(room, (versions.get(room) ?? []).filter((v) => v.id !== id));
      answer(reply);
    });
    socket.on("lab:versions:snapshot", async (room: unknown, name: unknown, by: unknown, reply: unknown) => {
      if (!valid(room) || typeof name !== "string" || typeof by !== "string" || !(await allowed(socket, room, "data"))) return;
      const editor = editors.get(kindOf(room));
      if (!editor) return;
      try {
        const memory = { list: () => [], get: () => undefined, save: (_f: string, v: NamedVersion) => void versions.set(room, [...(versions.get(room) ?? []), v]), remove: () => {} };
        const saved = await versionFromStore({ store, model: editor.model, storage: memory, room, name, by });
        answer(reply, { saved });
      } catch (error) {
        answer(reply, { error: error instanceof Error ? error.message : String(error) });
      }
    });

    // Sharing: the settings of a room, and one change at a time.
    socket.on("lab:share:load", async (room: unknown, reply: unknown) => {
      if (valid(room) && (await allowed(socket, room, "data"))) answer(reply, sharing.get(room) ?? NOBODY);
    });
    socket.on("lab:share:save", async (room: unknown, change: ShareChange, reply: unknown) => {
      if (!valid(room) || !change || typeof change.type !== "string" || !(await allowed(socket, room, "data"))) return;
      const next = applyShareChange(sharing.get(room) ?? NOBODY, change);
      sharing.set(room, next);
      // Everyone else in the room hears of it, so a Share dialog that is open stays right.
      socket.to(room).emit("lab:share:changed", room, change);
      answer(reply);
    });
  });

  return {
    io,
    store,
    editors,
    close: () => new Promise<void>((resolve) => void io.close(() => resolve())),
  };
}
