import { describe, expect, it, vi } from "vitest";
import { rebaseWith } from "@pli.dev/core";
import { transformDeckOps, type Deck, type DeckOp } from "../src";
import { apply, canon, crowd, firstDiff, randomBatch, randomOp, rng, same, show, startDeck, warmedUp } from "./fuzz-helpers";
import { normalizeOps } from "../src";

/**
 * The convergence fuzzer. Random operations are made by random people on decks that start alike, passed through the
 * transform, and applied in both orders. Whatever happens, everyone must end with the same deck.
 * `FUZZ_RUNS` scales how many cases run (the default is small enough for every test run).
 */
vi.setConfig({ testTimeout: 20 * 60_000 });
const RUNS = Number(process.env.FUZZ_RUNS ?? 1) || 1;
const rebase = rebaseWith<DeckOp>(transformDeckOps);

describe("transform: pairs", () => {
  it("converges for random pairs of operations (TP1)", () => {
    for (let seed = 1; seed <= 3000 * RUNS; seed++) {
      const r = rng(seed);
      const start = warmedUp(r);
      const a = randomBatch(r, start, "a", 1);
      const b = randomBatch(r, start, "b", 1);
      if (a.length === 0 || b.length === 0) continue;
      const [a2, b2] = transformDeckOps(a, b);
      let viaB: Deck;
      let viaA: Deck;
      try {
        viaB = apply(apply(start, b), a2);
        viaA = apply(apply(start, a), b2);
      } catch (error) {
        throw new Error(`seed ${seed}: a transformed operation failed (${(error as Error).message})\na  = ${show(a)}\nb  = ${show(b)}\na' = ${show(a2)}\nb' = ${show(b2)}`);
      }
      if (!same(viaB, viaA)) {
        throw new Error(`seed ${seed}: diverged\na  = ${show(a)}\nb  = ${show(b)}\na' = ${show(a2)}\nb' = ${show(b2)}\n${firstDiff(canon(viaB), canon(viaA))}`);
      }
    }
  });

  it("converges for random batches of operations", () => {
    for (let seed = 1; seed <= 2000 * RUNS; seed++) {
      const r = rng(seed * 7919);
      const start = warmedUp(r);
      const as = randomBatch(r, start, "a", 4);
      const bs = randomBatch(r, start, "b", 4);
      if (as.length === 0 || bs.length === 0) continue;
      const [as2, bs2] = transformDeckOps(as, bs);
      let viaB: Deck;
      let viaA: Deck;
      try {
        viaB = apply(apply(start, bs), as2);
        viaA = apply(apply(start, as), bs2);
      } catch (error) {
        throw new Error(`seed ${seed}: a transformed batch failed (${(error as Error).message})\na  = ${show(as)}\nb  = ${show(bs)}\na' = ${show(as2)}\nb' = ${show(bs2)}`);
      }
      if (!same(viaB, viaA)) {
        throw new Error(`seed ${seed}: batches diverged\na  = ${show(as)}\nb  = ${show(bs)}\na' = ${show(as2)}\nb' = ${show(bs2)}\n${firstDiff(canon(viaB), canon(viaA))}`);
      }
    }
  });
});

// ---- Several people and a server -------------------------------------------------------------------------------

/** The algorithm the sync client and server run, in miniature: a sequencer, and clients with one batch in flight and the rest waiting. */
class Simulation {
  serverDoc: Deck;
  history: Deck[];
  log: { client: number; ops: DeckOp[] }[] = [];
  clients: SimClient[];
  toServer: { client: number; base: number; ops: DeckOp[] }[][];
  toClient: { index: number }[][];

  constructor(start: Deck, count: number) {
    this.serverDoc = start;
    this.history = [start];
    this.clients = Array.from({ length: count }, (_, i) => new SimClient(i, start, this));
    this.toServer = this.clients.map(() => []);
    this.toClient = this.clients.map(() => []);
  }

  serverReceives(from: number): void {
    const batch = this.toServer[from]!.shift()!;
    const unseen = this.log.slice(batch.base).flatMap((entry) => entry.ops);
    const [ops] = transformDeckOps(batch.ops, unseen);
    try {
      this.serverDoc = apply(this.serverDoc, ops);
    } catch (error) {
      throw new Error(`the server couldn't apply c${batch.client}'s batch (${(error as Error).message})\nbatch = ${show(batch.ops)}\nunseen = ${show(unseen)}\ntransformed = ${show(ops)}`);
    }
    this.log.push({ client: batch.client, ops });
    this.history.push(this.serverDoc);
    for (const wire of this.toClient) wire.push({ index: this.log.length - 1 });
  }

  clientReceives(to: number): void {
    const { index } = this.toClient[to]!.shift()!;
    this.clients[to]!.receive(this.log[index]!);
  }

  quiet(): boolean {
    return this.toServer.every((w) => w.length === 0) && this.toClient.every((w) => w.length === 0) && this.clients.every((c) => !c.inflight && c.pending.length === 0);
  }
}

class SimClient {
  doc: Deck;
  version = 0;
  inflight: DeckOp[] | null = null;
  pending: DeckOp[] = [];
  lastRebase = "";
  constructor(readonly id: number, start: Deck, readonly sim: Simulation) {
    this.doc = start;
  }

  edit(ops: DeckOp[]): void {
    this.doc = apply(this.doc, ops);
    this.pending.push(...ops);
    this.check("after its own edit");
    this.flush();
  }

  /** What every client must always satisfy: its deck is what the server had at its version, plus its own changes not yet taken. */
  check(when: string): void {
    const expected = apply(this.sim.history[this.version]!, [...(this.inflight ?? []), ...this.pending]);
    if (!same(this.doc, expected)) throw new Error(`c${this.id} is out of step ${when}\nfirst difference (expected vs actual): ${firstDiff(canon(expected), canon(this.doc))}\n${this.lastRebase}`);
  }

  flush(): void {
    if (this.inflight || this.pending.length === 0) return;
    this.inflight = this.pending;
    this.pending = [];
    this.sim.toServer[this.id]!.push({ client: this.id, base: this.version, ops: this.inflight });
  }

  receive(entry: { client: number; ops: DeckOp[] }): void {
    this.version++;
    if (entry.client === this.id) {
      this.inflight = null;
      this.check("after its own batch was accepted");
      this.flush();
      return;
    }
    const before = { inflight: this.inflight, pending: this.pending };
    const next = rebase(this.inflight ?? [], this.pending, entry.ops);
    this.lastRebase = `entry from c${entry.client} = ${show(entry.ops)}\ninflight before = ${show(before.inflight ?? [])}\npending before = ${show(before.pending)}\ninflight after = ${show(next.inflight)}\npending after = ${show(next.pending)}\nincoming after = ${show(next.incoming)}`;
    this.inflight = this.inflight ? next.inflight : null;
    this.pending = next.pending;
    try {
      this.doc = apply(this.doc, next.incoming);
    } catch (error) {
      throw new Error(`c${this.id} couldn't apply an entry from c${entry.client} (${(error as Error).message})\n${this.lastRebase}`);
    }
    this.check(`after taking an entry from c${entry.client}`);
  }
}

function runSimulation(seed: number, clients: number, steps: number): void {
  const r = rng(seed);
  const start = warmedUp(r);
  const sim = new Simulation(start, clients);
  const trace: string[] = [];
  try {
    for (let step = 0; step < steps; step++) {
      const what = r.pick(["edit", "edit", "toServer", "toClient"] as const);
      if (what === "edit") {
        const c = sim.clients[r.int(clients)]!;
        const ops = randomBatch(r, c.doc, `c${c.id}`, 2);
        if (ops.length === 0) continue;
        trace.push(`c${c.id} edits ${show(ops)}`);
        c.edit(ops);
      } else if (what === "toServer") {
        const waiting = sim.toServer.map((w, i) => (w.length > 0 ? i : -1)).filter((i) => i >= 0);
        if (waiting.length > 0) {
          const i = r.pick(waiting);
          trace.push(`server takes c${i}'s batch`);
          sim.serverReceives(i);
        }
      } else {
        const waiting = sim.toClient.map((w, i) => (w.length > 0 ? i : -1)).filter((i) => i >= 0);
        if (waiting.length > 0) {
          const i = r.pick(waiting);
          trace.push(`c${i} takes the next entry`);
          sim.clientReceives(i);
        }
      }
    }
    let guard = 0;
    while (!sim.quiet() && guard++ < 10000) {
      const up = sim.toServer.findIndex((w) => w.length > 0);
      if (up >= 0 && r.chance(0.5)) {
        sim.serverReceives(up);
        continue;
      }
      const down = sim.toClient.findIndex((w) => w.length > 0);
      if (down >= 0) sim.clientReceives(down);
      else if (up >= 0) sim.serverReceives(up);
    }
  } catch (error) {
    throw new Error(`seed ${seed}: ${(error as Error).message}\n${((error as Error).stack ?? "").split("\n").slice(1, Number(process.env.FUZZ_STACK ?? 7)).join("\n")}\n${trace.slice(-60).join("\n")}`);
  }
  for (const c of sim.clients) {
    if (!same(c.doc, sim.serverDoc)) throw new Error(`seed ${seed}: client ${c.id} differs from the server\nfirst difference: ${firstDiff(canon(sim.serverDoc), canon(c.doc))}\n${trace.slice(-60).join("\n")}`);
  }
}

describe("transform: clients and a server", () => {
  it("two people converge", () => {
    for (let seed = 1; seed <= 500 * RUNS; seed++) runSimulation(seed, 2, 40);
  });

  it("three people converge", () => {
    for (let seed = 1; seed <= 300 * RUNS; seed++) runSimulation(seed * 31, 3, 60);
  });

  it("five people converge over a long session", () => {
    for (let seed = 1; seed <= 60 * RUNS; seed++) runSimulation(seed * 101, 5, 150);
  });

  it("converge when everyone works on the same slide", () => {
    crowd.on = true;
    try {
      for (let seed = 1; seed <= 300 * RUNS; seed++) runSimulation(seed * 17, 3, 60);
      for (let seed = 1; seed <= 40 * RUNS; seed++) runSimulation(seed * 29, 5, 120);
    } finally {
      crowd.on = false;
    }
  });
});

describe("what the fuzzer relies on", () => {
  it("turns whole-element changes into fine ones that give the same element", () => {
    const start = startDeck();
    const el = start.slides[0]!.elements[1]!;
    const ops = normalizeOps(start, [{ type: "replace_element", owner: "s0", element: { ...el, x: 5, y: 6 } as never }]);
    expect(ops.map((o) => o.type)).toEqual(["set_path", "set_path"]);
    expect(apply(start, ops).slides[0]!.elements[1]).toMatchObject({ x: 5, y: 6 });
  });
  it("makes operations", () => {
    const r = rng(3);
    expect(randomOp(r, startDeck(), "t") ?? true).toBeTruthy();
  });
});
