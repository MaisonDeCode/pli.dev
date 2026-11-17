import { describe, expect, it, vi } from "vitest";
import { docReducer, marksSegments, rebase, transformOps, transformPair, type Doc, type DocOp, type Run } from "../src";
import { apply, canon, firstDiff, rng, same, show, startDoc, warmedUp, randomBatch, randomOp } from "./fuzz-helpers";

/**
 * The convergence fuzzer. Random operations are made by random people on documents that start alike, passed
 * through the transform, and applied in both orders. Whatever happens, everyone must end with the same document.
 * `FUZZ_RUNS` scales how many cases run (the default is small enough for every test run).
 */
/** The fuzz tests are scaled up with FUZZ_RUNS and need more time than a test usually gets. */
const LONG = 20 * 60_000;
vi.setConfig({ testTimeout: LONG });
const RUNS = Number(process.env.FUZZ_RUNS ?? 1) || 1;

describe("transform: pairs", () => {
  it("converges for random pairs of operations (TP1)", () => {
    for (let seed = 1; seed <= 4000 * RUNS; seed++) {
      const r = rng(seed);
      const start = warmedUp(r);
      const a = randomOp(r, start, "a");
      const b = randomOp(r, start, "b");
      if (!a || !b) continue;
      try {
        docReducer.apply(start, a);
        docReducer.apply(start, b);
      } catch {
        continue;
      }
      const [a2, b2] = transformPair(a, b);
      let viaB: Doc;
      let viaA: Doc;
      try {
        viaB = apply(apply(start, [b]), a2);
        viaA = apply(apply(start, [a]), b2);
      } catch (error) {
        throw new Error(`seed ${seed}: a transformed operation failed (${(error as Error).message})\na  = ${show([a])}\nb  = ${show([b])}\na' = ${show(a2)}\nb' = ${show(b2)}`);
      }
      if (!same(viaB, viaA)) {
        throw new Error(`seed ${seed}: diverged\na  = ${show([a])}\nb  = ${show([b])}\na' = ${show(a2)}\nb' = ${show(b2)}\nb,a': ${JSON.stringify(canon(viaB))}\na,b': ${JSON.stringify(canon(viaA))}`);
      }
    }
  });

  it("converges for random batches of operations", () => {
    for (let seed = 1; seed <= 3000 * RUNS; seed++) {
      const r = rng(seed * 7919);
      const start = warmedUp(r);
      const as = randomBatch(r, start, "a");
      const bs = randomBatch(r, start, "b");
      if (as.length === 0 || bs.length === 0) continue;
      const [as2, bs2] = transformOps(as, bs);
      let viaB: Doc;
      let viaA: Doc;
      try {
        viaB = apply(apply(start, bs), as2);
        viaA = apply(apply(start, as), bs2);
      } catch (error) {
        throw new Error(`seed ${seed}: a transformed batch failed (${(error as Error).message})\na  = ${show(as)}\nb  = ${show(bs)}\na' = ${show(as2)}\nb' = ${show(bs2)}`);
      }
      if (!same(viaB, viaA)) {
        throw new Error(`seed ${seed}: batches diverged\na  = ${show(as)}\nb  = ${show(bs)}\na' = ${show(as2)}\nb' = ${show(bs2)}`);
      }
    }
  });
});

// ---- Several people and a server -------------------------------------------------------------------------------

/**
 * The algorithm the sync client and server will run, in miniature: a server that puts operations in one order, and
 * clients that keep one batch in flight and the rest waiting. Messages take their time, in order on each wire.
 */
class Simulation {
  serverDoc: Doc;
  /** The server's document after each number of entries: `history[n]` has `n` entries applied. */
  history: Doc[];
  log: { client: number; ops: DocOp[] }[] = [];
  clients: SimClient[];
  toServer: { client: number; base: number; ops: DocOp[] }[][];
  toClient: { index: number }[][];

  constructor(start: Doc, count: number) {
    this.serverDoc = start;
    this.history = [start];
    this.clients = Array.from({ length: count }, (_, i) => new SimClient(i, start, this));
    this.toServer = this.clients.map(() => []);
    this.toClient = this.clients.map(() => []);
  }

  serverReceives(from: number): void {
    const batch = this.toServer[from]!.shift()!;
    // Everything accepted since the client's base is what its batch hasn't seen.
    const unseen = this.log.slice(batch.base).flatMap((entry) => entry.ops);
    const [ops] = transformOps(batch.ops, unseen);
    if (process.env.FUZZ_TRACE) {
      const brief = (list: DocOp[]) => list.map((o) => (o.type === "update_block" && Array.isArray(o.patch.rows) ? `rows(${o.id.slice(-4)} within=${o.within?.length})` : o.type === "insert_block" ? `insert_block(${o.block.id.slice(-6)} after=${String(o.after).slice(-6)} cell=${String(o.cell).slice(-6)})` : o.type === "delete_block" ? `delete_block(${o.id.slice(-6)})` : `${o.type}(${"block" in o ? String(o.block).slice(-6) : ""})`)).join(", ");
      console.log(`SERVER from c${batch.client} base=${batch.base} log=${this.log.length}\n   in : ${brief(batch.ops)}\n   out: ${brief(ops)}`);
    }
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
  doc: Doc;
  /** How many log entries this client has taken in. */
  version = 0;
  inflight: DocOp[] | null = null;
  pending: DocOp[] = [];
  /** The last rebase, for explaining a failure. */
  lastRebase = "";
  constructor(readonly id: number, start: Doc, readonly sim: Simulation) {
    this.doc = start;
  }

  edit(ops: DocOp[]): void {
    this.doc = apply(this.doc, ops);
    this.pending.push(...ops);
    this.check("after its own edit");
    this.flush();
  }

  /** What every client must always satisfy: its document is what the server had at its version, plus its own changes not yet taken. */
  check(when: string): void {
    const expected = apply(this.sim.history[this.version]!, [...(this.inflight ?? []), ...this.pending]);
    if (!same(this.doc, expected)) {
      throw new Error(`c${this.id} is out of step ${when}\nfirst difference (expected vs actual): ${firstDiff(canon(expected), canon(this.doc))}\n${this.lastRebase}`);
    }
  }

  flush(): void {
    if (this.inflight || this.pending.length === 0) return;
    this.inflight = this.pending;
    this.pending = [];
    this.sim.toServer[this.id]!.push({ client: this.id, base: this.version, ops: this.inflight });
  }

  receive(entry: { client: number; ops: DocOp[] }): void {
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
    if (process.env.FUZZ_TRACE) console.log(`REBASE c${this.id} entry from c${entry.client}\n entry=${JSON.stringify(entry.ops).slice(0, 2500)}\n pendingBefore=${JSON.stringify(before.pending).slice(0, 800)}\n pendingAfter=${JSON.stringify(next.pending).slice(0, 800)}`);
    this.inflight = this.inflight ? next.inflight : null;
    this.pending = next.pending;
    try {
      this.doc = apply(this.doc, next.incoming);
    } catch (error) {
      throw new Error(`c${this.id} couldn't apply an entry from c${entry.client} (${(error as Error).message})\nentry = ${show(entry.ops)}\ninflight = ${show(this.inflight ?? [])}\npending = ${show(this.pending)}\nincoming = ${show(next.incoming)}`);
    }
    this.check(`after taking an entry from c${entry.client}`);
  }
}

function runSimulation(seed: number, clients: number, steps: number): void {
  const r = rng(seed);
  const start = warmedUp(r);
  const sim = new Simulation(start, clients);
  const trace: string[] = [];
  const note = (s: string) => trace.push(s);
  try {
    for (let step = 0; step < steps; step++) {
      const options = ["edit", "edit", "toServer", "toClient"] as const;
      const what = r.pick(options);
      if (what === "edit") {
        const c = sim.clients[r.int(clients)]!;
        const ops = randomBatch(r, c.doc, `c${c.id}`, 2);
        if (ops.length === 0) continue;
        note(`c${c.id} edits ${show(ops)}`);
        c.edit(ops);
      } else if (what === "toServer") {
        const waiting = sim.toServer.map((w, i) => (w.length > 0 ? i : -1)).filter((i) => i >= 0);
        if (waiting.length > 0) {
          const i = r.pick(waiting);
          note(`server takes c${i}'s batch`);
          sim.serverReceives(i);
        }
      } else {
        const waiting = sim.toClient.map((w, i) => (w.length > 0 ? i : -1)).filter((i) => i >= 0);
        if (waiting.length > 0) {
          const i = r.pick(waiting);
          note(`c${i} takes the next entry`);
          sim.clientReceives(i);
        }
      }
    }
    // Let everything arrive.
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
    throw new Error(`seed ${seed}: ${(error as Error).message}\n${((error as Error).stack ?? "").split("\n").slice(1, 7).join("\n")}\n${trace.slice(-400).join("\n")}`);
  }
  for (const c of sim.clients) {
    if (!same(c.doc, sim.serverDoc)) {
      throw new Error(`seed ${seed}: client ${c.id} differs from the server\nfirst difference: ${firstDiff(canon(sim.serverDoc), canon(c.doc))}\n${trace.slice(-400).join("\n")}`);
    }
  }
}

describe("transform: clients and a server", () => {
  it("two people converge", () => {
    for (let seed = 1; seed <= 600 * RUNS; seed++) runSimulation(seed, 2, 40);
  });

  it("three people converge", () => {
    for (let seed = 1; seed <= 400 * RUNS; seed++) runSimulation(seed * 31, 3, 60);
  });

  it("five people converge over a long session", () => {
    for (let seed = 1; seed <= 100 * RUNS; seed++) runSimulation(seed * 101, 5, 150);
  });
});

describe("what the fuzzer relies on", () => {
  it("reads marks the way restore_marks writes them", () => {
    const start = startDoc();
    const block = start.blocks[1] as unknown as { id: string; runs: Run[] };
    expect(marksSegments(block.runs, 0, 4)).toEqual([{ length: 4 }]);
  });
});
