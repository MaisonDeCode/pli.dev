import { createRequire } from "node:module";
import type { DatabaseSync as Database } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createDoc, paragraph, plainText, type Doc, type DocOp } from "@pli.dev/docs";
import { sqlDocumentStore } from "../server/sql-document-store";
import { rig } from "../../../packages/docs/test/sync-net";

// Loaded this way because the test runner doesn't know `node:sqlite` is a built-in module.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };

const fresh = () => sqlDocumentStore<{ n: number }, { add: number }>(new DatabaseSync(":memory:"));

describe("a DocumentStore over SQL", () => {
  it("has no document for a room until one is saved, and gives back what was saved", async () => {
    const store = fresh();
    expect(await store.load("r")).toBeNull();
    await store.save("r", { state: { n: 1 }, version: 0 });
    expect(await store.load("r")).toEqual({ state: { n: 1 }, version: 0 });
    await store.save("r", { state: { n: 2 }, version: 5 });
    expect(await store.load("r")).toEqual({ state: { n: 2 }, version: 5 });
  });

  it("lets an entry in only for the version after the log's head: the compare-and-set", async () => {
    const store = fresh();
    await store.save("r", { state: { n: 0 }, version: 0 });
    const entry = (version: number, batch = String(version)) => ({ version, client: "c", batch, ops: [{ add: 1 }] });
    expect(await store.append("r", entry(1))).toBe(true);
    // Someone else got version 1 first.
    expect(await store.append("r", entry(1, "other"))).toBe(false);
    // And it can't skip ahead.
    expect(await store.append("r", entry(3))).toBe(false);
    expect(await store.append("r", entry(2))).toBe(true);
    expect((await store.entries("r", 0))!.map((e) => e.version)).toEqual([1, 2]);
    expect((await store.entries("r", 1))!.map((e) => e.batch)).toEqual(["2"]);
    expect(await store.entries("r", 2)).toEqual([]);
  });

  it("keeps rooms apart", async () => {
    const store = fresh();
    await store.save("a", { state: { n: 0 }, version: 0 });
    await store.save("b", { state: { n: 0 }, version: 0 });
    expect(await store.append("a", { version: 1, client: "c", batch: "x", ops: [] })).toBe(true);
    expect(await store.append("b", { version: 1, client: "c", batch: "y", ops: [] })).toBe(true);
    expect(await store.entries("a", 0)).toHaveLength(1);
  });

  it("keeps whether an entry had to leave something out", async () => {
    const store = fresh();
    await store.save("r", { state: { n: 0 }, version: 0 });
    await store.append("r", { version: 1, client: "c", batch: "x", ops: [], dropped: true });
    expect((await store.entries("r", 0))![0]).toMatchObject({ dropped: true });
  });

  it("says it has trimmed what it no longer has, so a client far behind is sent the snapshot", async () => {
    const store = sqlDocumentStore<{ n: number }, { add: number }>(new DatabaseSync(":memory:"), { keepEntries: 1 });
    await store.save("r", { state: { n: 0 }, version: 0 });
    for (let v = 1; v <= 4; v++) await store.append("r", { version: v, client: "c", batch: String(v), ops: [] });
    await store.save("r", { state: { n: 4 }, version: 4 });
    expect(await store.entries("r", 0)).toBeNull();
    expect(await store.entries("r", 3)!).not.toBeNull();
    expect(await store.entries("r", 4)).toEqual([]);
    // Appending carries on from the snapshot's version when the whole log has gone.
    expect(await store.append("r", { version: 5, client: "c", batch: "5", ops: [] })).toBe(true);
  });

  it("keeps the log going after the whole log was trimmed away", async () => {
    const store = sqlDocumentStore<{ n: number }, { add: number }>(new DatabaseSync(":memory:"), { keepEntries: 0 });
    await store.save("r", { state: { n: 0 }, version: 0 });
    await store.append("r", { version: 1, client: "c", batch: "1", ops: [] });
    await store.save("r", { state: { n: 1 }, version: 1 });
    expect(await store.entries("r", 0)).toBeNull();
    expect(await store.append("r", { version: 1, client: "c", batch: "again", ops: [] })).toBe(false);
    expect(await store.append("r", { version: 2, client: "c", batch: "2", ops: [] })).toBe(true);
  });
});

describe("live editing over SQL", () => {
  it("keeps everyone's changes, and carries on across a restart of the server", async () => {
    const db = new DatabaseSync(":memory:");
    const store = sqlDocumentStore<Doc, DocOp>(db);
    const world = await rig(2, createDoc("Shared", [paragraph("one"), paragraph("two")]), { store, snapshotEvery: 3 });
    const [a, b] = world.sessions;
    const first = a!.state.blocks[0]!.id;
    const second = a!.state.blocks[1]!.id;
    for (let i = 0; i < 4; i++) {
      a!.transact([{ type: "insert_text", block: first, offset: 0, runs: [{ text: `a${i} ` }] }]);
      b!.transact([{ type: "insert_text", block: second, offset: 0, runs: [{ text: `b${i} ` }] }]);
      await world.net.settle();
    }
    expect(JSON.stringify(a!.state.blocks)).toBe(JSON.stringify(b!.state.blocks));
    // Snapshots were taken along the way; a server that starts from the store alone has the same document.
    const snapshot = (await store.load("room"))!;
    expect(snapshot.version).toBeGreaterThan(0);
    const log = (await store.entries("room", snapshot.version)) ?? [];
    expect(snapshot.version + log.length).toBe(8);
    expect(plainText((a!.state.blocks[0] as unknown as { runs: { text: string }[] }).runs)).toBe("a3 a2 a1 a0 one");
  });

  it("takes two changes at once from two server processes sharing the database, one after the other", async () => {
    const store = sqlDocumentStore<Doc, DocOp>(new DatabaseSync(":memory:"));
    const world = await rig(3, createDoc("Shared", [paragraph("one")]), { store, servers: 2 });
    const block = world.sessions[0]!.state.blocks[0]!.id;
    world.sessions[0]!.transact([{ type: "insert_text", block, offset: 0, runs: [{ text: "A " }] }]);
    world.sessions[1]!.transact([{ type: "insert_text", block, offset: 3, runs: [{ text: " B" }] }]);
    world.sessions[2]!.transact([{ type: "insert_text", block, offset: 0, runs: [{ text: "C " }] }]);
    // All three batches are in hand, and three servers handle them at the same time, from the same version.
    const batches = world.net.up.splice(0, 3);
    const send = (envelope: unknown) => world.net.down.forEach((queue) => queue.push(envelope));
    await Promise.all(batches.map((b, i) => world.net.authorities[i % 2]!.receive("room", b.data, send)));
    await world.net.settle();
    const texts = world.sessions.map((s) => plainText((s.state.blocks[0] as unknown as { runs: { text: string }[] }).runs));
    expect(new Set(texts).size).toBe(1);
    for (const piece of ["A ", " B", "C ", "one"]) expect(texts[0]).toContain(piece);
    expect(((await store.entries("room", 0)) ?? []).map((e) => e.version)).toEqual([1, 2, 3]);
  });
});
