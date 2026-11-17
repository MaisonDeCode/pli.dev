import { io, type Socket } from "socket.io-client";
import type { CommentChange, CommentStore, DocAnchor, Thread } from "@pli.dev/docs";

/** A connection to the playground's collaboration server (`server/collab-server.ts`). It connects when you ask it to. */
export function openSocket(): Socket {
  return io({ autoConnect: false, forceNew: true });
}

/**
 * Comments kept by the server, the way an app's `CommentStore` would keep them in its database: ask for a room's
 * threads, and send each change as it happens. Each call waits for the server to say it has them.
 */
export function serverCommentStore(socket: Socket, room: string): CommentStore<DocAnchor> {
  return {
    load: () =>
      new Promise<Thread<DocAnchor>[]>((resolve, reject) => {
        socket.timeout(8000).emit("lab:comments:load", room, (error: Error | null, threads: Thread<DocAnchor>[]) => (error ? reject(error) : resolve(threads)));
      }),
    save: (_file: string, change: CommentChange<DocAnchor>) =>
      new Promise<void>((resolve, reject) => {
        socket.timeout(8000).emit("lab:comments:save", room, change, (error: Error | null) => (error ? reject(error) : resolve()));
      }),
  };
}

// ---- The same adapters for any editor ---------------------------------------------------------------------------
//
// Each is a few lines over the socket: they are what an app writes to put its own database behind Pli's interfaces.

import type { NamedVersion, ShareChange, ShareSettings, SharingStore, VersionStorage } from "@pli.dev/core";

const ask = <T>(socket: Socket, event: string, ...args: unknown[]) =>
  new Promise<T>((resolve, reject) => {
    socket.timeout(8000).emit(event, ...args, (error: Error | string | null, result: T) => (error ? reject(error instanceof Error ? error : new Error(String(error))) : resolve(result)));
  });

/** Named versions kept by the server, for `VersionHistory`. */
export function serverVersionStorage<State>(socket: Socket, room: string): VersionStorage<State> & { snapshot(name: string, by: string): Promise<NamedVersion<State>> } {
  return {
    list: () => ask<NamedVersion<State>[]>(socket, "lab:versions:list", room),
    get: async (_file, id) => (await ask<NamedVersion<State>[]>(socket, "lab:versions:list", room)).find((v) => v.id === id),
    save: async (_file, version) => void (await ask<void>(socket, "lab:versions:save", room, version)),
    remove: async (_file, id) => void (await ask<void>(socket, "lab:versions:remove", room, id)),
    /** Asks the server to save a version of the file as its sequencer has it, with no editor open. */
    snapshot: async (name, by) => {
      const result = await ask<{ saved?: NamedVersion<State>; error?: string }>(socket, "lab:versions:snapshot", room, name, by);
      if (!result.saved) throw new Error(result.error ?? "The server couldn't save a version");
      return result.saved;
    },
  };
}

/** Sharing settings kept by the server, for `ShareClient`. Changes other people make arrive through `subscribe`. */
export function serverSharingStore(socket: Socket, room: string): SharingStore {
  return {
    load: () => ask<ShareSettings>(socket, "lab:share:load", room),
    save: async (_file, change: ShareChange) => void (await ask<void>(socket, "lab:share:save", room, change)),
    subscribe(_file, listener) {
      const on = (from: string, change: ShareChange) => from === room && listener(change);
      socket.on("lab:share:changed", on);
      return () => void socket.off("lab:share:changed", on);
    },
  };
}
