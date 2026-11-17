import {
  CollabRoom,
  DocumentSession,
  SyncClient,
  Users,
  createAuthority,
  createDoc,
  docSyncModel,
  isSyncMessage,
  memoryDocumentStore,
  type Authority,
  type Doc,
  type DocOp,
  type DocumentStore,
  type Selection,
  type Transport,
} from "../src";

/** A network that is stepped by hand, an authority over a store at one end, and real sessions with sync clients at the other. */

export class Net {
  up: { from: number; data: unknown }[] = [];
  down: unknown[][] = [];
  receivers: ((data: unknown) => void)[] = [];
  offline = new Set<number>();
  constructor(readonly authorities: Authority[]) {}

  transport(i: number): Transport {
    return {
      connect: (_room, receive) => {
        this.receivers[i] = receive;
        this.down[i] = [];
      },
      send: (data) => void (this.offline.has(i) || this.up.push({ from: i, data })),
      disconnect: () => {},
    };
  }

  async serve(which = 0): Promise<boolean> {
    const next = this.up.shift();
    if (!next) return false;
    // Presence and comments are only passed on, as a server's relay does; changes go to the sequencer.
    if (!isSyncMessage(next.data)) {
      this.down.forEach((queue, i) => {
        if (i !== next.from && !this.offline.has(i)) queue.push(next.data);
      });
      return true;
    }
    await this.authorities[which % this.authorities.length]!.receive("room", next.data, (envelope) => {
      this.down.forEach((queue, i) => {
        if (!this.offline.has(i)) queue.push(envelope);
      });
    });
    return true;
  }

  deliver(i: number): boolean {
    const next = this.down[i]?.shift();
    if (next === undefined) return false;
    this.receivers[i]!(next);
    return true;
  }

  async settle(): Promise<void> {
    for (let guard = 0; guard < 100_000; guard++) {
      let moved = false;
      while (await this.serve()) moved = true;
      for (let i = 0; i < this.down.length; i++) while (this.deliver(i)) moved = true;
      // Something may have been sent while we were looking (a client coming back online sends a moment later).
      if (!moved && this.up.length === 0) return;
    }
    throw new Error("the network never went quiet");
  }
}

export interface Rig {
  net: Net;
  store: DocumentStore<Doc, DocOp>;
  sessions: DocumentSession[];
  syncs: SyncClient<Doc, DocOp, Selection | null>[];
  rooms: CollabRoom<undefined>[];
  /** Stops everything, so a test that makes many of these doesn't keep timers and documents alive. */
  dispose(): void;
  resyncs: { client: number; reason: string; lost: number }[];
}

export async function rig(count: number, initial: Doc, options: { servers?: number; snapshotEvery?: number; store?: DocumentStore<Doc, DocOp> } = {}): Promise<Rig> {
  const store = options.store ?? memoryDocumentStore<Doc, DocOp>();
  const authorities = Array.from({ length: options.servers ?? 1 }, () => createAuthority<Doc, DocOp>({ store, model: docSyncModel, create: () => initial, snapshotEvery: options.snapshotEvery ?? 25 }));
  const net = new Net(authorities);
  const sessions: DocumentSession[] = [];
  const syncs: Rig["syncs"] = [];
  const resyncs: Rig["resyncs"] = [];
  const rooms: CollabRoom<undefined>[] = [];
  for (let i = 0; i < count; i++) {
    const session = new DocumentSession(createDoc("", []));
    const room = new CollabRoom<undefined>({ room: "room", transport: net.transport(i), users: new Users({ id: `u${i}`, name: `User ${i}` }) });
    await room.connect();
    const sync = new SyncClient<Doc, DocOp, Selection | null>({ session, room, model: docSyncModel, verifyEvery: 0, onResync: (info) => resyncs.push({ client: i, ...info }) });
    sessions.push(session);
    rooms.push(room);
    syncs.push(sync);
    sync.start();
  }
  await net.settle();
  return {
    net,
    store,
    sessions,
    syncs,
    rooms,
    resyncs,
    dispose() {
      for (const sync of syncs) sync.stop();
      for (const room of rooms) room.disconnect();
    },
  };
}

/** The server's document: the last snapshot with every entry since replayed. */
export async function serverDoc(store: DocumentStore<Doc, DocOp>): Promise<Doc> {
  const snapshot = (await store.load("room"))!;
  const entries = (await store.entries("room", snapshot.version)) ?? [];
  return entries.reduce((doc, entry) => entry.ops.reduce((d, op) => docSyncModel.apply(d, op), doc), snapshot.state);
}

