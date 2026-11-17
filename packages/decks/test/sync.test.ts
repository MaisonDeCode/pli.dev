import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, deckSyncModel, parseDeck, serializeDeck, type DeckOp, type DeckSelection } from "../src";
import { apply, canon, crowd, firstDiff, randomBatch, rng, same, startDeck } from "./fuzz-helpers";
import { failures, rig, serverDeck } from "./sync-net";

/**
 * The real thing, in miniature: `DeckSession`s with `SyncClient`s, talking through a network we step by hand (and cut
 * now and then) to an authority over a store, with random edits. When everything has been delivered, every client must
 * hold the deck the server holds. `FUZZ_RUNS` scales it.
 */
const LONG = 20 * 60_000;
const RUNS = Number(process.env.FUZZ_RUNS ?? 1) || 1;

async function run(seed: number, clients: number, steps: number, options: { offline?: boolean; servers?: number; undo?: boolean } = {}): Promise<{ entries: number; resyncs: number }> {
  if (process.env.ONLY && seed !== Number(process.env.ONLY)) return { entries: 0, resyncs: 0 };
  const r = rng(seed);
  const start = (() => {
    let deck = startDeck();
    for (const op of randomBatch(r, deck, "warm", 4)) deck = deckSyncModel.apply(deck, op);
    return deck;
  })();
  failures.length = 0;
  const world = await rig(clients, start, { servers: options.servers });
  const trace: string[] = [];
  const brief = (ops: readonly DeckOp[]) => JSON.stringify(ops, (key, value) => (key === "element" || key === "slide" || key === "layout" ? `<${(value as { id?: string })?.id}>` : value)).slice(0, 400);
  try {
    for (let step = 0; step < steps; step++) {
      const roll = r.int(100);
      const i = r.int(clients);
      if (options.undo && roll < 14) {
        if (r.chance(0.7)) {
          trace.push(`c${i} undo`);
          world.sessions[i]!.undo();
        } else {
          trace.push(`c${i} redo`);
          world.sessions[i]!.redo();
        }
      } else if (roll < 45) {
        const ops = randomBatch(r, world.sessions[i]!.deck, `c${i}`, 2);
        if (ops.length > 0) {
          trace.push(`c${i} edit ${brief(ops)}`);
          world.sessions[i]!.transact(ops);
        }
      } else if (roll < 70) {
        trace.push("server takes a batch");
        await world.net.serve(r.int(world.net.authorities.length));
      } else if (roll < 95) {
        trace.push(`c${i} takes a message`);
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
    world.dispose();
    throw new Error(`seed ${seed}: ${(error as Error).message}\n${trace.slice(-30).join("\n")}`);
  }
  try {
    const server = await serverDeck(world.store);
    if (process.env.TRACE_OWNER) {
      const entries = (await world.store.entries("room", 0)) ?? [];
      const owner = process.env.TRACE_OWNER;
      for (const e of entries) {
        const ops = e.ops.filter((o) => JSON.stringify(o, (k, v) => (k === "element" || k === "slide" ? v?.id : v)).includes(owner));
        if (ops.length) console.log(`entry ${e.version} ${e.client.slice(-3)}`, JSON.stringify(ops, (k, v) => (k === "element" || k === "slide" ? `<${v?.id}>` : k === "delta" ? "~" : v)).slice(0, 600));
      }
      console.log("server s1:", server.slides.find((x) => x.id === owner)?.elements.map((e) => e.id).join(","));
      for (const [i, session] of world.sessions.entries()) console.log(`c${i} s1:`, session.deck.slides.find((x) => x.id === owner)?.elements.map((e) => e.id).join(","));
    }
    for (const [i, session] of world.sessions.entries()) {
      if (!same(session.deck, server)) throw new Error(`seed ${seed}: client ${i} differs from the server\nfirst difference: ${firstDiff(canon(server), canon(session.deck))}\n${trace.slice(-30).join("\n")}`);
      const sync = world.syncs[i]!;
      if (sync.status !== "synced" || sync.unsynced !== 0) throw new Error(`seed ${seed}: client ${i} is ${sync.status} with ${sync.unsynced} unsynced`);
    }
    // Nobody should have had to reload because of the algorithm; only because of an offline window.
    if (process.env.TRACE_ID && world.resyncs.length > 0) {
      const entries = (await world.store.entries("room", 0)) ?? [];
      for (const e of entries) if (JSON.stringify(e).includes(process.env.TRACE_ID)) console.log(`entry ${e.version} from ${e.client} base?`, JSON.stringify(e.ops, (k, v) => (k === "element" || k === "slide" ? `<${v?.id}>` : v)).slice(0, 700));
    }
    if (!options.offline && world.resyncs.length > 0) throw new Error(`seed ${seed}: reloads: ${JSON.stringify(world.resyncs)}\nserver failures: ${failures.join("\n")}\n${(process.env.TRACE_ID ? trace.filter((t) => t.includes(process.env.TRACE_ID!) || t.includes("undo") || t.includes("redo")) : trace.slice(-30)).join("\n")}`);
    return { entries: (await world.store.entries("room", 0))?.length ?? 0, resyncs: world.resyncs.length };
  } finally {
    world.dispose();
  }
}

describe("SyncClient and createAuthority with real decks", () => {
  it("really does edit: many batches get through, with a server that merges them", async () => {
    let entries = 0;
    for (let seed = 1; seed <= 20; seed++) entries += (await run(seed, 3, 90)).entries;
    expect(entries / 20).toBeGreaterThan(6);
  }, LONG);

  it("really does drop off: offline sessions have people reload now and then, and still agree", async () => {
    let resyncs = 0;
    for (let seed = 1; seed <= 60; seed++) resyncs += (await run(seed * 53, 3, 100, { offline: true })).resyncs;
    expect(resyncs).toBeGreaterThan(0);
  }, LONG);

  it("two people converge", async () => {
    for (let seed = 1; seed <= 100 * RUNS; seed++) await run(seed, 2, 60);
  }, LONG);

  it("three people converge", async () => {
    for (let seed = 1; seed <= 60 * RUNS; seed++) await run(seed * 17, 3, 90);
  }, LONG);

  it("five people converge over a long session", async () => {
    for (let seed = 1; seed <= 10 * RUNS; seed++) await run(seed * 101, 5, 220);
  }, LONG);

  it("converge when everyone works on one slide", async () => {
    crowd.on = true;
    try {
      for (let seed = 1; seed <= 80 * RUNS; seed++) await run(seed * 13, 3, 90);
    } finally {
      crowd.on = false;
    }
  }, LONG);

  it("converge when two server processes share the store", async () => {
    for (let seed = 1; seed <= 40 * RUNS; seed++) await run(seed * 31, 3, 80, { servers: 2 });
  }, LONG);

  it("converge when people undo and redo while others edit", async () => {
    for (let seed = 1; seed <= 100 * RUNS; seed++) await run(seed * 7, 2, 80, { undo: true });
    for (let seed = 1; seed <= 50 * RUNS; seed++) await run(seed * 19, 3, 110, { undo: true });
    for (let seed = 1; seed <= 8 * RUNS; seed++) await run(seed * 131, 5, 220, { undo: true });
  }, LONG);

  it("converge when people undo, drop off and come back", async () => {
    for (let seed = 1; seed <= 50 * RUNS; seed++) await run(seed * 41, 3, 110, { undo: true, offline: true });
  }, LONG);

  it("converge when people drop off and come back", async () => {
    for (let seed = 1; seed <= 60 * RUNS; seed++) await run(seed * 53, 3, 100, { offline: true });
  }, LONG);
});

describe("SyncClient with a deck session", () => {
  it("shows a change at once, and the server's copy replaces the session's on joining", async () => {
    const world = await rig(2, startDeck());
    expect(world.sessions[0]!.deck.slides.length).toBe(3);
    expect(same(world.sessions[0]!.deck, world.sessions[1]!.deck)).toBe(true);
    world.sessions[0]!.setTitle("Mine");
    expect(world.sessions[0]!.deck.title).toBe("Mine");
    expect(world.sessions[1]!.deck.title).not.toBe("Mine");
    await world.net.settle();
    expect(world.sessions[1]!.deck.title).toBe("Mine");
    world.dispose();
  });

  it("keeps your selection when someone deletes the slide you were on, by showing the next one", async () => {
    const world = await rig(2, startDeck());
    const [a, b] = world.sessions as [DeckSession, DeckSession];
    b.selection = { slide: "s1", elements: ["e3"] };
    a.deleteSlides(["s1"]);
    await world.net.settle();
    expect(b.deck.slides.map((s) => s.id)).toEqual(["s0", "s2"]);
    expect(b.selection.slide).toBe("s2");
    expect(b.selection.elements).toEqual([]);
    world.dispose();
  });

  it("undoes only your own change, with other people's edits kept", async () => {
    const world = await rig(2, startDeck());
    const [a, b] = world.sessions as [DeckSession, DeckSession];
    a.setFrame("s0", "e2", { x: 400 });
    await world.net.settle();
    b.setFrame("s0", "e1", { x: 50 });
    await world.net.settle();
    a.undo();
    await world.net.settle();
    expect(b.element("s0", "e2").x).toBe(240);
    expect(b.element("s0", "e1").x).toBe(50);
    expect(a.element("s0", "e1").x).toBe(50);
    world.dispose();
  });

  it("applies a transformed sequence the same way the model does", () => {
    const start = startDeck();
    const ops: DeckOp[] = [{ type: "set_path", target: { owner: "s0", id: "e1" }, path: ["x"], value: 1 }];
    expect(apply(start, ops).slides[0]!.elements[0]!.x).toBe(1);
    expect(createDeck().slides.length).toBe(1);
    const sel: DeckSelection = { slide: null, elements: [] };
    expect(sel.elements).toEqual([]);
  });
});

describe("a deck always has a slide", () => {
  it("puts one back when two people each delete a different slide and none is left", async () => {
    const world = await rig(2, { ...startDeck(), slides: startDeck().slides.slice(0, 2) });
    const [a, b] = world.sessions as [DeckSession, DeckSession];
    // each sees two slides and deletes the one that is not on its canvas, never the last: the deck can still end up empty
    a.deck.slides.length;
    b.deck.slides.length;
    a.transact([{ type: "remove_slide", id: "s0" }]);
    b.transact([{ type: "remove_slide", id: "s1" }]);
    await world.net.settle();
    await new Promise((r) => setTimeout(r, 0));
    await world.net.settle();
    expect(a.deck.slides.length).toBeGreaterThan(0);
    expect(a.deck.slides.map((s) => s.id)).toEqual(b.deck.slides.map((s) => s.id));
    world.dispose();
  });
});

describe("animations of deleted objects", () => {
  it("are taken off when one person animates what another deletes, and the deck still validates", async () => {
    const world = await rig(2, startDeck());
    const [a, b] = world.sessions as [DeckSession, DeckSession];
    a.deleteElements("s0", ["e2"]);
    b.addAnimation("s0", { target: "e2", kind: "fade" });
    await world.net.settle();
    await new Promise((r) => setTimeout(r, 0));
    await world.net.settle();
    for (const s of [a, b]) {
      expect(s.deck.slides[0]!.animations ?? []).toEqual([]);
      expect(() => parseDeck(serializeDeck(s.deck))).not.toThrow();
    }
    expect(same(a.deck, b.deck)).toBe(true);
    world.dispose();
  });
});
