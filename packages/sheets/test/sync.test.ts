import { describe, expect, it } from "vitest";
import { sheetSyncModel, SheetSession, type SheetOp, type Workbook } from "../src";
import { randomBatch, rng, same, startBook } from "./sync-helpers";
import { failures, rig, serverBook } from "./sync-net";

/**
 * The real thing, in miniature: `SheetSession`s with `SyncClient`s, talking through a network we step by hand (and cut now
 * and then) to an authority over a store, with random edits and undo. When everything has been delivered, every client must
 * hold the workbook the server holds. `FUZZ_RUNS` scales it.
 */
const RUNS = Number(process.env.FUZZ_RUNS ?? 1) || 1;
const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, k === "merges" && Array.isArray(x) ? [...x].sort() : sorted(x)])) : v);
function diff(a: unknown, b: unknown): string {
  const x = JSON.stringify(sorted(a));
  const y = JSON.stringify(sorted(b));
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return `\n  server: ...${x.slice(Math.max(0, i - 60), i + 200)}\n  client: ...${y.slice(Math.max(0, i - 60), i + 200)}`;
}

async function run(seed: number, clients: number, steps: number, options: { offline?: boolean; undo?: boolean; only?: readonly string[] } = {}): Promise<void> {
  const r = rng(seed);
  failures.length = 0;
  if (process.env.SEED && seed !== Number(process.env.SEED)) return;
  const world = await rig(clients, startBook(true));
  const trace: string[] = [];
  if (process.env.WATCH) world.sessions.forEach((session, i) => session.subscribe((e) => void (!e.reset && JSON.stringify(e.ops).includes(process.env.WATCH!) && trace.push(`   c${i} applied ${JSON.stringify(e.ops).slice(0, 700)}`))));
  const brief = (ops: readonly SheetOp[]) => JSON.stringify(ops).slice(0, 300);
  try {
    for (let step = 0; step < Math.min(steps, Number(process.env.STEPS) || steps); step++) {
      const roll = r.int(100);
      const i = r.int(clients);
      if (options.undo && roll < 14) {
        trace.push(`c${i} ${r.chance(0.7) ? "undo" : "redo"}`);
        if (trace[trace.length - 1]!.endsWith("undo")) world.sessions[i]!.undo();
        else world.sessions[i]!.redo();
      } else if (roll < 45) {
        const ops = randomBatch(r, world.sessions[i]!.state, `c${i}`, 2, { only: options.only });
        if (ops.length > 0) {
          trace.push(`c${i} edit ${brief(ops)}`);
          try {
            world.sessions[i]!.transact(ops);
          } catch (error) {
            // The editor refuses to change the cells of a pivot table by hand: that change is not made.
            if (!/pivot table/.test((error as Error).message)) throw error;
          }
        }
      } else if (roll < 70) {
        trace.push("server takes a batch");
        await world.net.serve();
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
    throw new Error(`seed ${seed}: ${(error as Error).message}\n${trace.slice(-(Number(process.env.TRACE) || 25)).join("\n")}`);
  }
  try {
    const server = await serverBook(world.store);
    if (process.env.WATCH) {
      let w = (await world.store.load("room"))!.state;
      for (const entry of (await world.store.entries("room", 0)) ?? []) {
        w = entry.ops.reduce((x, op) => sheetSyncModel.apply(x, op), w);
        trace.push(`   v${entry.version} ${entry.client.slice(-4)} ${JSON.stringify(entry.ops.filter((o) => JSON.stringify(o).includes(process.env.WATCH!)).map((o) => (o as { type: string }).type + ":" + JSON.stringify((o as { slicer?: { id: string } }).slicer?.id ?? (o as { id?: string }).id) + "@" + ((o as { index?: number }).index ?? (o as { at?: number }).at)))} => ${JSON.stringify(w.sheets.find((x) => x.id === "s3")?.slicers?.map((x) => x.id))}`);
      }
    }
    if (process.env.WATCH) for (const entry of (await world.store.entries("room", 0)) ?? []) if (JSON.stringify(entry.ops).includes(process.env.WATCH)) trace.push(`   LOG ${JSON.stringify({ ...entry, ops: undefined })} ${JSON.stringify(entry.ops).slice(0, 900)}`);
    for (const [i, session] of world.sessions.entries()) {
      if (!same(session.state, server)) throw new Error(`seed ${seed}: client ${i} differs from the server${diff(server, session.state)}\n${failures.slice(-3).join("\n")}\n${world.resyncs.map((x) => `${x.client}:${x.reason}`).join(", ")}\n${trace.slice(-(Number(process.env.TRACE) || 25)).join("\n")}`);
      expect(world.syncs[i]!.unsynced).toBe(0);
    }
  } finally {
    world.dispose();
  }
}

describe("sheets over a real SyncClient and a lossy network", () => {
  it("two people converge", async () => {
    for (let seed = 1; seed <= 8 * RUNS; seed++) await run(seed, 2, 40);
  });
  it("three people converge, with undo", async () => {
    for (let seed = 1; seed <= 12 * RUNS; seed++) await run(seed * 7, 3, 60, { undo: true });
  });
  it("people who go offline and come back converge", async () => {
    for (let seed = 1; seed <= 8 * RUNS; seed++) await run(seed * 13, 3, 70, { offline: true, undo: true });
  });
});

describe("a shared workbook", () => {
  it("formulas are recomputed from the merged cells and never sent as values", async () => {
    const world = await rig(2, startBook());
    const [a, b] = world.sessions as [SheetSession, SheetSession];
    a.setCell("Data", "H1", "=SUM(A1:A3)");
    b.setCell("Data", "A1", "100");
    await world.net.settle();
    expect(a.value("Data", "H1")).toBe(100 + 21 + 31);
    expect(b.value("Data", "H1")).toBe(a.value("Data", "H1"));
    for (const entry of (await world.store.entries("room", 0)) ?? []) expect(JSON.stringify(entry.ops)).not.toMatch(/"v":152/);
    world.dispose();
  });

  it("undo takes back your own change and leaves theirs", async () => {
    const world = await rig(2, startBook());
    const [a, b] = world.sessions as [SheetSession, SheetSession];
    a.setCell("Data", "A1", "1000");
    b.setCell("Data", "B1", "2000");
    await world.net.settle();
    a.undo();
    await world.net.settle();
    expect(b.cell("Data", "A1")?.v).toBe(11);
    expect(b.cell("Data", "B1")?.v).toBe(2000);
    expect(a.state.sheets[0]!.cells["B1"]?.v).toBe(2000);
    world.dispose();
  });

  it("undoing a row insertion while someone else edits keeps their edit", async () => {
    const world = await rig(2, startBook());
    const [a, b] = world.sessions as [SheetSession, SheetSession];
    a.insertRows("Data", 2, 2);
    await world.net.settle();
    b.setCell("Data", "A6", "edited by b");
    await world.net.settle();
    a.undo();
    await world.net.settle();
    expect(same(a.state, b.state)).toBe(true);
    expect(b.cell("Data", "A4")?.v).toBe("edited by b");
    expect(a.state.sheets[0]!.cells["A1"]?.v).toBe(11);
    world.dispose();
  });

  it("deleting rows while someone edits a cell below shifts their edit", async () => {
    const world = await rig(2, startBook());
    const [a, b] = world.sessions as [SheetSession, SheetSession];
    a.deleteRows("Data", 1, 2);
    b.setCell("Data", "A5", "mine");
    await world.net.settle();
    expect(same(a.state, b.state)).toBe(true);
    expect(a.cell("Data", "A3")?.v).toBe("mine");
    world.dispose();
  });

  it("presence moves with the cells when rows are inserted above", () => {
    const moved = sheetSyncModel.mapPresence!({ sheet: "s1", selection: { active: "B5", ranges: ["B5:C6"] }, editing: "B5" }, [{ type: "insert_rows", sheet: "s1", at: 2, count: 3, name: "Data" }]);
    expect(moved).toEqual({ sheet: "s1", selection: { active: "B8", ranges: ["B8:C9"] }, editing: "B8" });
    expect(sheetSyncModel.mapPresence!({ sheet: "s1", selection: null, editing: null }, [{ type: "delete_sheet", id: "s1" }])).toMatchObject({ sheet: null });
  });
});

export type { Workbook };

describe("comments in a shared workbook", () => {
  it("replies made at the same moment both stay, and a thread shows up for everyone", async () => {
    const { Users } = await import("@pli.dev/core");
    const world = await rig(2, startBook());
    const [a, b] = world.sessions as [SheetSession, SheetSession];
    const ca = a.comments.enable({ users: new Users({ current: { id: "a", name: "A" } }) });
    const cb = b.comments.enable({ users: new Users({ current: { id: "b", name: "B" } }) });
    const t = a.comments.commentOn("Data", "B2", "look at this");
    await world.net.settle();
    expect(b.comments.threadAt("Data", "B2")?.id).toBe(t.id);
    expect(cb.thread(t.id)?.comments).toHaveLength(1);
    ca.reply(t.id, "from a");
    cb.reply(t.id, "from b");
    await world.net.settle();
    expect(same(a.state, b.state)).toBe(true);
    expect(ca.thread(t.id)!.comments.map((c) => c.body).sort()).toEqual(["from a", "from b", "look at this"]);
    expect(cb.thread(t.id)!.comments).toHaveLength(3);
    // The thread follows its cell for both when rows are inserted.
    a.insertRows("Data", 1, 2);
    await world.net.settle();
    expect(b.comments.placeOf(t.id)).toMatchObject({ cell: "B4" });
    world.dispose();
  });
});
