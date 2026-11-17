import {
  CollabRoom,
  SyncClient,
  Users,
  createAuthority,
  isSyncMessage,
  memoryDocumentStore,
  type Authority,
  type DocumentStore,
  type Transport,
} from "@pli.dev/core";
import { SheetSession, sheetSyncModel, type SheetOp, type Workbook } from "../src";

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
      if (!moved && this.up.length === 0) return;
    }
    throw new Error("the network never went quiet");
  }
}

export interface Rig {
  net: Net;
  store: DocumentStore<Workbook, SheetOp>;
  sessions: SheetSession[];
  syncs: SyncClient<Workbook, SheetOp>[];
  rooms: CollabRoom<undefined>[];
  users: Users[];
  dispose(): void;
  resyncs: { client: number; reason: string; lost: number }[];
}

/** Operations the server could not apply, with why, for explaining a failure. */
export const failures: string[] = [];
const debugModel: typeof sheetSyncModel = {
  ...sheetSyncModel,
  apply(wb, op) {
    try {
      return sheetSyncModel.apply(wb, op);
    } catch (error) {
      failures.push(`${(error as Error).message}: ${JSON.stringify(op).slice(0, 500)}`);
      throw error;
    }
  },
};

export async function rig(count: number, initial: Workbook, options: { servers?: number; snapshotEvery?: number; store?: DocumentStore<Workbook, SheetOp> } = {}): Promise<Rig> {
  const store = options.store ?? memoryDocumentStore<Workbook, SheetOp>();
  const authorities = Array.from({ length: options.servers ?? 1 }, () => createAuthority<Workbook, SheetOp>({ store, model: debugModel, create: () => initial, snapshotEvery: options.snapshotEvery ?? 25 }));
  const net = new Net(authorities);
  const sessions: SheetSession[] = [];
  const syncs: Rig["syncs"] = [];
  const resyncs: Rig["resyncs"] = [];
  const rooms: CollabRoom<undefined>[] = [];
  const users: Users[] = [];
  for (let i = 0; i < count; i++) {
    const session = new SheetSession(JSON.parse(JSON.stringify(initial)) as Workbook);
    const u = new Users({ id: `u${i}`, name: `User ${i}` });
    const room = new CollabRoom<undefined>({ room: "room", transport: net.transport(i), users: u });
    await room.connect();
    const sync = new SyncClient<Workbook, SheetOp>({ session: session.core, room, model: sheetSyncModel, verifyEvery: 0, onResync: (info) => resyncs.push({ client: i, ...info }) });
    session.syncing = true;
    sessions.push(session);
    rooms.push(room);
    users.push(u);
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
    users,
    resyncs,
    dispose() {
      for (const sync of syncs) sync.stop();
      for (const room of rooms) room.disconnect();
    },
  };
}

/** The server's workbook: the last snapshot with every entry since replayed. */
export async function serverBook(store: DocumentStore<Workbook, SheetOp>): Promise<Workbook> {
  const snapshot = (await store.load("room"))!;
  const entries = (await store.entries("room", snapshot.version)) ?? [];
  return entries.reduce((wb, entry) => entry.ops.reduce((w, op) => sheetSyncModel.apply(w, op), wb), snapshot.state);
}
