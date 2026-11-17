import { describe, expect, it } from "vitest";
import {
  CollabRoom,
  DocumentSession,
  SyncClient,
  Users,
  createAuthority,
  createDoc,
  docSyncModel,
  memoryDocumentStore,
  type Authority,
  type Doc,
  type DocOp,
  type DocumentStore,
  type Selection,
  type Transport,
} from "../src";
import { canon, firstDiff, randomBatch, rng, same, startDoc } from "./fuzz-helpers";
import { Net, rig, serverDoc } from "./sync-net";

/**
 * The real thing, in miniature: `DocumentSession`s with `SyncClient`s, talking through a network we step by hand to an
 * authority over a store, with random edits. When everything has been delivered, every client must hold the document
 * the server holds. `FUZZ_RUNS` scales it.
 */
/** The fuzz tests are scaled up with FUZZ_RUNS and need more time than a test usually gets. */
const LONG = 20 * 60_000;
const RUNS = Number(process.env.FUZZ_RUNS ?? 1) || 1;

/** Runs one session of random editing and checks the result. Returns how much happened, to show the fuzzer is doing something. */
async function run(seed: number, clients: number, steps: number, options: { offline?: boolean; servers?: number; undo?: boolean } = {}): Promise<{ entries: number; resyncs: number }> {
  const r = rng(seed);
  const start = (() => {
    let doc = startDoc();
    for (const op of randomBatch(r, doc, "warm", 4)) doc = docSyncModel.apply(doc, op);
    return doc;
  })();
  const world = await rig(clients, start, { servers: options.servers });
  try {
    return await play(world);
  } finally {
    world.dispose();
  }

  async function play(world: Awaited<ReturnType<typeof rig>>): Promise<{ entries: number; resyncs: number }> {
  const trace: string[] = [];
  const script: unknown[] = [];
  const brief = (ops: readonly DocOp[]) => JSON.stringify(ops, (key, value) => (key === "rows" || key === "within" ? `[${(value as unknown[]).length}]` : key === "runs" ? (value as { text: string }[]).map((x) => x.text).join("") : value));
  try {
    for (let step = 0; step < steps; step++) {
      const roll = r.int(100);
      const i = r.int(clients);
      if (options.undo && roll < 14) {
        // Someone presses undo, or redo.
        if (r.chance(0.7)) {
          trace.push(`c${i} undo`);
          script.push({ k: "undo", i });
          world.sessions[i]!.undo();
        } else {
          trace.push(`c${i} redo`);
          script.push({ k: "redo", i });
          world.sessions[i]!.redo();
        }
      } else if (roll < 45) {
        const ops = randomBatch(r, world.sessions[i]!.state, `c${i}`, 2);
        if (ops.length > 0) {
          trace.push(`c${i} edit ${brief(ops)}`);
          script.push({ k: "edit", i, ops });
          world.sessions[i]!.transact(ops);
        }
      } else if (roll < 70) {
        trace.push("server takes a batch");
        const which = r.int(world.net.authorities.length);
        script.push({ k: "serve", which });
        await world.net.serve(which);
      } else if (roll < 95) {
        trace.push(`c${i} takes a message`);
        script.push({ k: "deliver", i });
        world.net.deliver(i);
      } else if (options.offline) {
        const away = world.net.offline.has(i);
        if (away) world.net.offline.delete(i);
        else world.net.offline.add(i);
        world.syncs[i]!.setOnline(away);
      }
    }
    for (const i of [...world.net.offline]) {
      world.net.offline.delete(i);
      world.syncs[i]!.setOnline(true);
    }
    await world.net.settle();
  } catch (error) {
    if (process.env.SHRINK) (await import("node:fs")).writeFileSync("/tmp/script.json", JSON.stringify({ clients, start, script }));
    throw new Error(`seed ${seed}: ${(error as Error).message}`);
  }
  const server = await serverDoc(world.store);
  for (const [i, session] of world.sessions.entries()) {
    if (!same(session.state, server) && process.env.SHRINK) (await import("node:fs")).writeFileSync("/tmp/script.json", JSON.stringify({ clients, start, script }));
    if (!same(session.state, server)) throw new Error(`seed ${seed}: client ${i} differs from the server\nfirst difference: ${firstDiff(canon(server), canon(session.state))}\n${trace.slice(-40).join("\n")}`);
    const sync = world.syncs[i]!;
    if (sync.status !== "synced" || sync.unsynced !== 0) throw new Error(`seed ${seed}: client ${i} is ${sync.status} with ${sync.unsynced} unsynced`);
  }
  // Nobody should have had to reload because of the algorithm; only because of an offline window.
  if (!options.offline && world.resyncs.length > 0 && process.env.SHRINK) (await import("node:fs")).writeFileSync("/tmp/script.json", JSON.stringify({ clients, start, script }));
  if (!options.offline && world.resyncs.length > 0) throw new Error(`seed ${seed}: reloads: ${JSON.stringify(world.resyncs)}`);
  return { entries: (await world.store.entries("room", 0))?.length ?? 0, resyncs: world.resyncs.length };
  }
}

describe("SyncClient and createAuthority with real documents", () => {
  it("really does edit: many batches get through, with a server that merges them", async () => {
    let entries = 0;
    for (let seed = 1; seed <= 20; seed++) entries += (await run(seed, 3, 90)).entries;
    // About a dozen accepted batches per session, from three people working at once.
    expect(entries / 20).toBeGreaterThan(8);
  }, LONG);

  it("really does drop off: offline sessions have people reload now and then, and still agree", async () => {
    let resyncs = 0;
    for (let seed = 1; seed <= 60; seed++) resyncs += (await run(seed * 53, 3, 100, { offline: true })).resyncs;
    // Messages lost while someone was away leave gaps, and the safety net (reloading) closes them. It must actually be used here.
    expect(resyncs).toBeGreaterThan(0);
  }, LONG);

  it("two people converge", async () => {
    for (let seed = 1; seed <= 150 * RUNS; seed++) await run(seed, 2, 60);
  }, LONG);

  it("three people converge", async () => {
    for (let seed = 1; seed <= 80 * RUNS; seed++) await run(seed * 17, 3, 90);
  }, LONG);

  it("five people converge over a long session", async () => {
    for (let seed = 1; seed <= 15 * RUNS; seed++) await run(seed * 101, 5, 220);
  }, LONG);

  it("converge when two server processes share the store", async () => {
    for (let seed = 1; seed <= 60 * RUNS; seed++) await run(seed * 31, 3, 80, { servers: 2 });
  }, LONG);

  it("converge when people undo and redo while others edit", async () => {
    for (let seed = 1; seed <= 120 * RUNS; seed++) await run(seed * 7, 2, 80, { undo: true });
    for (let seed = 1; seed <= 60 * RUNS; seed++) await run(seed * 19, 3, 110, { undo: true });
    for (let seed = 1; seed <= 12 * RUNS; seed++) await run(seed * 131, 5, 220, { undo: true });
  }, LONG);

  it("converge when people undo, drop off and come back", async () => {
    for (let seed = 1; seed <= 60 * RUNS; seed++) await run(seed * 41, 3, 110, { undo: true, offline: true });
  }, LONG);

  it("converge when people drop off and come back", async () => {
    for (let seed = 1; seed <= 80 * RUNS; seed++) await run(seed * 53, 3, 100, { offline: true });
  }, LONG);
});

describe("SyncClient with a document session", () => {
  it("shows a change at once, and the server's copy replaces the session's on joining", async () => {
    const world = await rig(2, startDoc());
    expect(world.sessions[0]!.state.blocks.length).toBeGreaterThan(0);
    expect(same(world.sessions[0]!.state, world.sessions[1]!.state)).toBe(true);
    const first = world.sessions[0]!.state.blocks[1]!.id;
    world.sessions[0]!.transact([{ type: "insert_text", block: first, offset: 0, runs: [{ text: ">> " }] }]);
    const text = (s: DocumentSession) => JSON.stringify(s.state.blocks[1]);
    expect(text(world.sessions[0]!)).toContain(">> ");
    expect(text(world.sessions[1]!)).not.toContain(">> ");
    await world.net.settle();
    expect(text(world.sessions[1]!)).toContain(">> ");
  });

  it("keeps your caret with your text when someone else types above it", async () => {
    const world = await rig(2, startDoc());
    const block = world.sessions[0]!.state.blocks[1]!.id;
    world.sessions[0]!.select({ anchor: { block, offset: 4 }, focus: { block, offset: 4 } });
    world.sessions[1]!.transact([{ type: "insert_text", block, offset: 0, runs: [{ text: "12345" }] }]);
    await world.net.settle();
    expect(world.sessions[0]!.selection!.focus.offset).toBe(9);
  });

  it("starts from a stored version, and is only sent what happened since", async () => {
    const world = await rig(1, startDoc());
    const block = world.sessions[0]!.state.blocks[1]!.id;
    world.sessions[0]!.transact([{ type: "insert_text", block, offset: 0, runs: [{ text: "a" }] }]);
    await world.net.settle();
    // Saved by the app at version 1.
    const saved = world.sessions[0]!.state;
    for (const letter of "bc") {
      world.sessions[0]!.transact([{ type: "insert_text", block, offset: 0, runs: [{ text: letter }] }]);
      await world.net.settle();
    }
    const later = new DocumentSession(saved);
    const resets: boolean[] = [];
    later.subscribe((event) => void (event.reset && resets.push(true)));
    const room = new CollabRoom<undefined>({ room: "room", transport: world.net.transport(1), users: new Users({ id: "later", name: "Later" }) });
    await room.connect();
    const sync = new SyncClient<Doc, DocOp, Selection | null>({ session: later, room, model: docSyncModel, version: 1, verifyEvery: 0 });
    sync.start();
    await world.net.settle();
    expect(sync.version).toBe(3);
    expect(same(later.state, world.sessions[0]!.state)).toBe(true);
    // It caught up from what it had: nothing was replaced.
    expect(resets).toEqual([]);
  });

  it("reloads the document when asked, and says how many changes it hadn't had confirmed", async () => {
    const world = await rig(2, startDoc());
    const block = world.sessions[0]!.state.blocks[1]!.id;
    world.sessions[0]!.transact([{ type: "insert_text", block, offset: 0, runs: [{ text: "mine" }] }]);
    world.syncs[0]!.resync("a test");
    await world.net.settle();
    // The change had already been sent, so the server took it; the client just no longer knew that.
    expect(same(world.sessions[0]!.state, world.sessions[1]!.state)).toBe(true);
    expect(world.resyncs.at(-1)).toEqual({ client: 0, reason: "a test", lost: 1 });
    expect(world.syncs[0]!.status).toBe("synced");
  });
});
