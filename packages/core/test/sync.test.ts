import { describe, expect, it, vi } from "vitest";
import {
  CollabRoom,
  PliError,
  Session,
  SyncClient,
  SYNC_KIND,
  Users,
  createAuthority,
  memoryDocumentStore,
  type Authority,
  type DocumentStore,
  type Reducer,
  type SyncModel,
  type Transport,
} from "../src";

import { model, reducer, type Op } from "./toy";

// ---- A network we can step through, and an authority on the end of it ------------------------------------------

class Net {
  up: { from: number; data: unknown }[] = [];
  down: unknown[][] = [];
  receivers: ((data: unknown) => void)[] = [];
  /** Entries to lose on their way down, for testing a lost message. */
  lose: ((data: unknown, to: number) => boolean) | null = null;
  /** Clients that can't hear the server (and whose messages don't reach it). */
  offline = new Set<number>();
  constructor(public authorities: Authority[]) {}

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

  /** One message up to the server (to authority `which`), and its answers queued for everyone. */
  async serve(which = 0): Promise<boolean> {
    const next = this.up.shift();
    if (!next) return false;
    await this.authorities[which]!.receive("room", next.data, (envelope) => {
      this.down.forEach((queue, i) => {
        if (!this.lose?.(envelope, i) && !this.offline.has(i)) queue.push(envelope);
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

  /** Everything that is in flight arrives. */
  async settle(): Promise<void> {
    for (let guard = 0; guard < 10_000; guard++) {
      let moved = false;
      while (await this.serve()) moved = true;
      for (let i = 0; i < this.down.length; i++) while (this.deliver(i)) moved = true;
      // Something may have been sent while we were looking (a client coming back online sends a moment later).
      if (!moved && this.up.length === 0) return;
    }
    throw new Error("the network never went quiet");
  }
}

interface Rig {
  net: Net;
  store: DocumentStore<string, Op>;
  sessions: Session<string, Op>[];
  syncs: SyncClient<string, Op>[];
  rooms: CollabRoom<undefined>[];
}

async function rig(count: number, options: { initial?: string; authorities?: number; snapshotEvery?: number; maxCatchUp?: number; verifyEvery?: number; onResync?: (info: { reason: string; lost: number }) => void; model?: SyncModel<string, Op>; onError?: (e: unknown) => void; authorize?: Parameters<typeof createAuthority>[0]["authorize"] } = {}): Promise<Rig> {
  const store = memoryDocumentStore<string, Op>();
  const authorities = Array.from({ length: options.authorities ?? 1 }, () =>
    createAuthority<string, Op>({ store, model: options.model ?? model, create: () => options.initial ?? "", snapshotEvery: options.snapshotEvery, maxCatchUp: options.maxCatchUp, onError: options.onError, authorize: options.authorize as never }),
  );
  const net = new Net(authorities);
  const sessions: Session<string, Op>[] = [];
  const syncs: SyncClient<string, Op>[] = [];
  const rooms: CollabRoom<undefined>[] = [];
  for (let i = 0; i < count; i++) {
    const session = new Session<string, Op>("", reducer);
    const room = new CollabRoom<undefined>({ room: "room", transport: net.transport(i), users: new Users({ id: `u${i}`, name: `User ${i}` }) });
    await room.connect();
    const sync = new SyncClient<string, Op>({ session, room, model: options.model ?? model, verifyEvery: options.verifyEvery ?? 0, onResync: options.onResync });
    sessions.push(session);
    rooms.push(room);
    syncs.push(sync);
    sync.start();
  }
  await net.settle();
  return { net, store, sessions, syncs, rooms };
}

const ins = (at: number, s: string): Op => ({ t: "ins", at, s });
const del = (at: number, n: number): Op => ({ t: "del", at, n });
const type = (r: Rig, i: number, ...ops: Op[]) => r.sessions[i]!.transact(ops);
const texts = (r: Rig) => r.sessions.map((s) => s.state);

describe("joining", () => {
  it("takes the server's document on the first join", async () => {
    const r = await rig(2, { initial: "Hello" });
    expect(texts(r)).toEqual(["Hello", "Hello"]);
    expect(r.syncs.map((s) => [s.version, s.status])).toEqual([[0, "synced"], [0, "synced"]]);
  });

  it("is told to start over, not given a document, for a room that doesn't exist and can't be made", async () => {
    const store = memoryDocumentStore<string, Op>();
    const errors: unknown[] = [];
    const authority = createAuthority<string, Op>({ store, model, onError: (e) => errors.push(e) });
    const sent: unknown[] = [];
    await authority.receive("nowhere", { v: 1, client: "c1", message: { type: "custom", kind: SYNC_KIND, data: { type: "join", have: null } } }, (e) => sent.push(e));
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(sent)).toContain("resync");
  });

  it("ignores messages that aren't for it", async () => {
    const r = await rig(1);
    const sent: unknown[] = [];
    for (const junk of [null, 5, { v: 2 }, { v: 1, client: "x", message: { type: "hello" } }, { v: 1, client: "x", message: { type: "custom", kind: "other", data: {} } }, { v: 1, client: "x", message: { type: "custom", kind: SYNC_KIND, data: { type: "ops", batch: 1 } } }]) {
      await r.net.authorities[0]!.receive("room", junk, (e) => sent.push(e));
    }
    expect(sent).toEqual([]);
  });
});

describe("editing together", () => {
  it("shows your change at once and everyone else's after the server has it", async () => {
    const r = await rig(2, { initial: "Hello" });
    type(r, 0, ins(5, " world"));
    expect(texts(r)).toEqual(["Hello world", "Hello"]);
    expect(r.syncs[0]!.status).toBe("saving");
    expect(r.syncs[0]!.unsynced).toBe(1);
    await r.net.settle();
    expect(texts(r)).toEqual(["Hello world", "Hello world"]);
    expect(r.syncs.map((s) => [s.version, s.status, s.unsynced])).toEqual([[1, "synced", 0], [1, "synced", 0]]);
  });

  it("merges changes made at the same time, in the order the server took them", async () => {
    const r = await rig(3, { initial: "abc" });
    type(r, 0, ins(1, "X"));
    type(r, 1, ins(1, "Y"));
    type(r, 2, del(0, 2));
    await r.net.settle();
    expect(new Set(texts(r)).size).toBe(1);
    expect(texts(r)[0]).toContain("X");
    expect(texts(r)[0]).toContain("Y");
  });

  it("sends the next batch only after the last was taken, and keeps typing in order", async () => {
    const r = await rig(2, { initial: "" });
    for (const letter of "hello") type(r, 0, ins(r.sessions[0]!.state.length, letter));
    // One batch in flight, the rest waiting.
    expect(r.net.up).toHaveLength(1);
    await r.net.settle();
    expect(texts(r)).toEqual(["hello", "hello"]);
  });

  it("treats undo as one more change to send", async () => {
    const r = await rig(2, { initial: "Hello" });
    type(r, 0, ins(5, "!"));
    await r.net.settle();
    r.sessions[0]!.undo();
    await r.net.settle();
    expect(texts(r)).toEqual(["Hello", "Hello"]);
  });

  it("applies what comes from the server without making it an undo step", async () => {
    const r = await rig(2, { initial: "Hello" });
    type(r, 1, ins(5, "!"));
    await r.net.settle();
    expect(r.sessions[0]!.canUndo).toBe(false);
  });

  it("converges after a long random session", async () => {
    const r = await rig(4, { initial: "start" });
    let seed = 99;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    for (let step = 0; step < 400; step++) {
      const roll = rand(10);
      const i = rand(4);
      const text = r.sessions[i]!.state;
      if (roll < 5) type(r, i, ins(rand(text.length + 1), "abcdef"[rand(6)]!));
      else if (roll < 7 && text.length > 1) type(r, i, del(rand(text.length - 1), 1 + rand(2)));
      else if (roll < 9) await r.net.serve();
      else r.net.deliver(rand(4));
    }
    await r.net.settle();
    expect(new Set(texts(r)).size).toBe(1);
    expect(r.syncs.every((s) => s.status === "synced")).toBe(true);
  });
});

describe("connection trouble", () => {
  it("keeps changes made offline and sends them when back, catching up first", async () => {
    const r = await rig(2, { initial: "Hello" });
    r.net.offline.add(0);
    r.syncs[0]!.setOnline(false);
    expect(r.syncs[0]!.status).toBe("offline");
    type(r, 0, ins(5, " there"));
    type(r, 1, ins(0, ">> "));
    await r.net.settle();
    // The other person's change is in the shared document; the offline one has only its own.
    expect(texts(r)).toEqual(["Hello there", ">> Hello"]);
    r.net.offline.delete(0);
    r.syncs[0]!.setOnline(true);
    await r.net.settle();
    expect(texts(r)[0]).toBe(texts(r)[1]);
    expect(texts(r)[0]).toBe(">> Hello there");
    expect(r.syncs[0]!.status).toBe("synced");
  });

  it("doesn't apply a batch twice when it is sent again after a lost connection", async () => {
    const r = await rig(2, { initial: "Hello" });
    type(r, 0, ins(5, "!"));
    // The batch reaches the server, but the answer is lost, and the client rejoins and sends it again.
    r.net.lose = (data, to) => to === 0 && JSON.stringify(data).includes('"entry"');
    await r.net.serve();
    r.net.lose = null;
    r.syncs[0]!.setOnline(false);
    r.syncs[0]!.setOnline(true);
    await r.net.settle();
    expect(texts(r)).toEqual(["Hello!", "Hello!"]);
    expect(r.syncs[0]!.version).toBe(1);
  });

  it("reloads when it misses an update", async () => {
    const r = await rig(2, { initial: "Hello" });
    const resyncs = vi.fn();
    const sync = new SyncClient<string, Op>({ session: r.sessions[1]!, room: r.rooms[1]!, model, verifyEvery: 0, onResync: resyncs, version: r.syncs[1]!.version });
    r.syncs[1]!.stop();
    sync.start();
    // Entry 1 never reaches client 1.
    r.net.lose = (data, to) => to === 1 && JSON.stringify(data).includes('"version":1,');
    type(r, 0, ins(5, "1"));
    await r.net.settle();
    r.net.lose = null;
    type(r, 0, ins(6, "2"));
    await r.net.settle();
    expect(texts(r)).toEqual(["Hello12", "Hello12"]);
    expect(resyncs).toHaveBeenCalledWith({ reason: "missed an update", lost: 0 });
  });

  it("reloads a client whose document has quietly come to differ from the server's", async () => {
    vi.useFakeTimers();
    try {
      const resyncs = vi.fn();
      const r = await rig(2, { initial: "Hello", verifyEvery: 1000, onResync: resyncs });
      // Break it behind the client's back.
      r.sessions[1]!.reset("Hxllo");
      vi.advanceTimersByTime(1000);
      await r.net.settle();
      expect(texts(r)).toEqual(["Hello", "Hello"]);
      expect(resyncs).toHaveBeenCalledTimes(1);
      expect(resyncs).toHaveBeenCalledWith({ reason: "your document differs from the server's", lost: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reloads a client that can't apply an update from the server", async () => {
    // A model that doesn't merge deletes: two people delete the same text, and the second finds it gone.
    const careless: SyncModel<string, Op> = { ...model, transform: (a, b) => [[...a], [...b]] };
    const resyncs: { reason: string; lost: number }[] = [];
    const r = await rig(2, { initial: "abc", model: careless, onResync: (info) => resyncs.push(info) });
    type(r, 0, del(0, 3));
    type(r, 1, del(0, 3));
    await r.net.settle();
    expect(texts(r)).toEqual(["", ""]);
    expect(resyncs).toEqual([{ reason: "couldn't apply an update", lost: 1 }]);
  });

  it("reloads the client whose change the server had to leave part of out", async () => {
    // The server can't apply an insert of "!" (the text it goes in is gone, say), though the client could.
    const picky: SyncModel<string, Op> = {
      ...model,
      apply: (text, op) => {
        if (op.t === "ins" && op.s === "!") throw new PliError("not_found", "the text is gone");
        return model.apply(text, op);
      },
    };
    const resyncs: { reason: string; lost: number }[] = [];
    const r = await rig(2, { initial: "abc", model: picky, onResync: (info) => resyncs.push(info) });
    type(r, 0, ins(3, "!"));
    expect(r.sessions[0]!.state).toBe("abc!");
    await r.net.settle();
    expect(texts(r)).toEqual(["abc", "abc"]);
    expect(resyncs).toEqual([{ reason: "the server left out part of a change", lost: 0 }]);
    expect(await r.store.entries("room", 0)).toMatchObject([{ dropped: true, ops: [] }]);
  });
});

describe("the server", () => {
  it("keeps one history even when two server processes take changes at once", async () => {
    const r = await rig(3, { initial: "abc", authorities: 2 });
    type(r, 0, ins(0, "A"));
    type(r, 1, ins(3, "B"));
    // Both batches are handled at the same time, by different processes, from the same base.
    const [first, second] = r.net.up.splice(0, 2);
    const seen: unknown[] = [];
    const send = (e: unknown) => {
      r.net.down.forEach((q) => q.push(e));
      seen.push(e);
    };
    await Promise.all([r.net.authorities[0]!.receive("room", first!.data, send), r.net.authorities[1]!.receive("room", second!.data, send)]);
    await r.net.settle();
    expect(new Set(texts(r)).size).toBe(1);
    expect(texts(r)[0]).toBe("AabcB");
    expect(r.store.entries("room", 0)).resolves.toHaveLength(2);
  });

  it("saves a snapshot now and then, and sends a snapshot to someone too far behind", async () => {
    const r = await rig(1, { initial: "", snapshotEvery: 3, maxCatchUp: 2 });
    for (let i = 0; i < 7; i++) {
      type(r, 0, ins(i, String(i)));
      await r.net.settle();
    }
    const snapshot = await r.store.load("room");
    expect(snapshot).toEqual({ state: "012345", version: 6 });
    // A new client with an old version gets the document, not 7 entries.
    const session = new Session<string, Op>("", reducer);
    const net = r.net;
    const room = new CollabRoom<undefined>({ room: "room", transport: net.transport(1), users: new Users({ id: "late", name: "Late" }) });
    await room.connect();
    const late = new SyncClient<string, Op>({ session, room, model, verifyEvery: 0, version: 1 });
    late.start();
    await net.settle();
    expect(session.state).toBe("0123456");
    expect(late.version).toBe(7);
  });

  it("catches up a client that is only a little behind, with just the entries it missed", async () => {
    const r = await rig(2, { initial: "" });
    r.net.offline.add(1);
    r.syncs[1]!.setOnline(false);
    for (let i = 0; i < 3; i++) {
      type(r, 0, ins(i, String(i)));
      await r.net.settle();
    }
    const upBefore = r.net.up.length;
    r.net.offline.delete(1);
    r.syncs[1]!.setOnline(true);
    await r.net.settle();
    expect(upBefore).toBe(0);
    expect(texts(r)).toEqual(["012", "012"]);
  });

  it("refuses what it isn't asked to allow, and tells the client to reload", async () => {
    const decide = vi.fn(({ message }: { message: { type: string } }) => message.type !== "ops");
    const r = await rig(1, { initial: "x", authorize: decide as never });
    const resyncs = vi.fn();
    r.syncs[0]!.stop();
    const sync = new SyncClient<string, Op>({ session: r.sessions[0]!, room: r.rooms[0]!, model, verifyEvery: 0, version: 0, onResync: resyncs });
    sync.start();
    await r.net.settle();
    type(r, 0, ins(1, "!"));
    await r.net.settle();
    // The change it just made is the one it loses.
    expect(resyncs).toHaveBeenCalledWith({ reason: "not allowed", lost: 1 });
    expect(r.sessions[0]!.state).toBe("x");
    expect(await r.store.entries("room", 0)).toEqual([]);
  });

  it("reports a change that can't be applied and has the client reload", async () => {
    const errors: unknown[] = [];
    const r = await rig(2, { initial: "ab", onError: (e) => errors.push(e) });
    // A change that is wrong for the document (an insert past the end) is refused rather than half-kept.
    r.sessions[0]!.reset("ab");
    r.net.up.push({ from: 0, data: { v: 1, client: r.rooms[0]!.client, message: { type: "custom", kind: SYNC_KIND, data: { type: "ops", batch: "bad", base: 0, ops: [ins(99, "x")] } } } });
    await r.net.settle();
    expect(errors).toHaveLength(1);
    expect(await r.store.entries("room", 0)).toEqual([]);
  });
});

describe("a store", () => {
  it("only lets one entry in for each version", async () => {
    const store = memoryDocumentStore<string, Op>();
    await store.save("r", { state: "", version: 0 });
    expect(await store.append("r", { version: 1, client: "a", batch: "1", ops: [] })).toBe(true);
    expect(await store.append("r", { version: 1, client: "b", batch: "2", ops: [] })).toBe(false);
    expect(await store.append("r", { version: 3, client: "b", batch: "3", ops: [] })).toBe(false);
    expect(await store.entries("r", 0)).toHaveLength(1);
    expect(await store.entries("r", 1)).toEqual([]);
  });

  it("says when it has trimmed the entries asked for", async () => {
    const store = memoryDocumentStore<string, Op>({ keepEntries: 1 });
    await store.save("r", { state: "", version: 0 });
    for (let v = 1; v <= 4; v++) await store.append("r", { version: v, client: "a", batch: String(v), ops: [] });
    await store.save("r", { state: "x", version: 4 });
    expect(await store.entries("r", 0)).toBeNull();
    expect(await store.entries("r", 4)).toEqual([]);
  });

  it("gives back copies, so changing what it returned doesn't change it", async () => {
    const store = memoryDocumentStore<{ n: number }, never>();
    await store.save("r", { state: { n: 1 }, version: 0 });
    const loaded = (await store.load("r"))!;
    loaded.state.n = 99;
    expect((await store.load("r"))!.state.n).toBe(1);
  });
});
