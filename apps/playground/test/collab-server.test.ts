import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CollabRoom,
  DocumentSession,
  SyncClient,
  Users,
  createDoc,
  docSyncModel,
  plainText,
  socketTransport,
  type Doc,
  type DocAnchor,
  type DocOp,
  type Selection,
} from "@pli.dev/docs";
import { attachCollabServer } from "../server/collab-server";
import { serverCommentStore } from "../src/collab/connection";

let http: HttpServer;
let server: ReturnType<typeof attachCollabServer>;
let url: string;
const open: (() => void)[] = [];

beforeEach(async () => {
  http = createServer();
  server = attachCollabServer(http, { onError: (error) => { throw error; } });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const close of open.splice(0)) close();
  await server.close();
  http.closeAllConnections?.();
});

const until = async (check: () => boolean, what: string, ms = 4000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** One person: a connection, a copy of the document, and a sync client, as the browser's lab makes them. */
async function person(name: string, room = "test-room") {
  const socket: Socket = io(url, { forceNew: true, autoConnect: false });
  const users = new Users({ id: `u_${name}`, name });
  const session = new DocumentSession(createDoc("", []), { comments: { users, store: serverCommentStore(socket, room), synced: true } });
  const live = new CollabRoom<DocAnchor>({ room, transport: socketTransport(socket), users, comments: session.comments! });
  const sync = new SyncClient<Doc, DocOp, Selection | null>({ session, room: live, model: docSyncModel, verifyEvery: 0 });
  socket.on("disconnect", () => sync.setOnline(false));
  socket.on("connect", () => sync.setOnline(true));
  socket.connect();
  await live.connect();
  sync.start();
  open.push(() => {
    sync.stop();
    live.disconnect();
    socket.disconnect();
  });
  await until(() => sync.version !== null, `${name} to receive the document`);
  return { socket, session, sync, room: live };
}

const text = (s: DocumentSession, block: number) => plainText((s.state.blocks[block] as unknown as { runs: { text: string }[] }).runs);
const same = (a: DocumentSession, b: DocumentSession) => JSON.stringify(a.state.blocks) === JSON.stringify(b.state.blocks);

describe("the playground's collaboration server", () => {
  it("gives a new room the lab's meeting notes, to everyone who joins", async () => {
    const [a, b] = [await person("ana"), await person("ben")];
    expect(a.session.state.title).toBe("Q3 planning sync");
    expect(same(a.session, b.session)).toBe(true);
    expect(a.sync.status).toBe("synced");
  });

  it("keeps rooms apart", async () => {
    const a = await person("ana", "room-a");
    const b = await person("ben", "room-b");
    a.session.transact([{ type: "insert_text", block: a.session.state.blocks[0]!.id, offset: 0, runs: [{ text: "A: " }] }]);
    await until(() => a.sync.unsynced === 0, "a's change to be saved");
    await new Promise((r) => setTimeout(r, 100));
    expect(text(a.session, 0).startsWith("A: ")).toBe(true);
    expect(text(b.session, 0).startsWith("A: ")).toBe(false);
  });

  it("carries one person's change to the other, and merges changes made at the same time", async () => {
    const [a, b] = [await person("ana"), await person("ben")];
    const first = a.session.state.blocks[8]!.id; // the first discussion paragraph
    const original = text(a.session, 8);
    a.session.transact([{ type: "insert_text", block: first, offset: 0, runs: [{ text: "ANA " }] }]);
    b.session.transact([{ type: "insert_text", block: first, offset: original.length, runs: [{ text: " BEN" }] }]);
    await until(() => a.sync.unsynced === 0 && b.sync.unsynced === 0 && same(a.session, b.session), "both to agree");
    expect(text(a.session, 8)).toBe(`ANA ${original} BEN`);
  });

  it("keeps changes made offline and merges them on reconnecting", async () => {
    const [a, b] = [await person("ana"), await person("ben")];
    const block = a.session.state.blocks[8]!.id;
    const original = text(a.session, 8);
    a.socket.disconnect();
    await until(() => a.sync.status === "offline", "ana to notice");
    a.session.transact([{ type: "insert_text", block, offset: 0, runs: [{ text: "OFFLINE " }] }]);
    b.session.transact([{ type: "insert_text", block, offset: original.length, runs: [{ text: " ONLINE" }] }]);
    await until(() => b.sync.unsynced === 0, "ben's change to be saved");
    expect(text(a.session, 8)).toBe(`OFFLINE ${original}`);
    a.socket.connect();
    await until(() => a.sync.status === "synced" && same(a.session, b.session), "ana to catch up");
    expect(text(b.session, 8)).toBe(`OFFLINE ${original} ONLINE`);
  });

  it("brings a late joiner up to date with the changes so far", async () => {
    const a = await person("ana");
    a.session.transact([{ type: "insert_text", block: a.session.state.blocks[8]!.id, offset: 0, runs: [{ text: "EARLY " }] }]);
    await until(() => a.sync.unsynced === 0, "the change to be saved");
    const late = await person("cleo");
    expect(text(late.session, 8).startsWith("EARLY ")).toBe(true);
  });

  it("shows people who are here, and where their cursors are", async () => {
    const [a, b] = [await person("ana"), await person("ben")];
    const block = a.session.state.blocks[8]!.id;
    b.room.setPresence({ selection: { anchor: { block, offset: 3 }, focus: { block, offset: 3 } } });
    await until(() => a.room.peers.some((p) => p.user.id === "u_ben" && !!p.state.selection), "ana to see ben's cursor");
  });

  it("keeps comments in the server's database, and starts a late joiner with them", async () => {
    const [a, b] = [await person("ana"), await person("ben")];
    const block = a.session.state.blocks[8]!.id;
    a.session.select({ anchor: { block, offset: 4 }, focus: { block, offset: 12 } });
    const thread = a.session.comment("Is this right?")!;
    await until(() => b.session.comments!.thread(thread.id) !== undefined, "ben to see the comment");
    // The highlight is a change like any other, so ben has it too.
    await until(() => JSON.stringify(b.session.state).includes(thread.id), "the highlight to reach ben");
    const late = await person("cleo");
    await until(() => late.session.comments!.status === "ready" && late.session.comments!.threads.length === 1, "cleo to load the comments");
    expect(late.session.comments!.threads[0]!.comments[0]!.body).toBe("Is this right?");
    expect(JSON.stringify(late.session.state)).toContain(thread.id);
  });

  it("ignores someone who speaks in a room they haven't joined", async () => {
    const a = await person("ana");
    const before = text(a.session, 8);
    const intruder = io(url, { forceNew: true });
    await new Promise<void>((resolve) => intruder.on("connect", () => resolve()));
    intruder.emit("pli", "test-room", { v: 1, client: "intruder", message: { type: "custom", kind: "sync", data: { type: "ops", batch: "x", base: 0, ops: [{ type: "insert_text", block: a.session.state.blocks[8]!.id, offset: 0, runs: [{ text: "HACK" }] }] } } });
    await new Promise((r) => setTimeout(r, 150));
    intruder.disconnect();
    expect(text(a.session, 8)).toBe(before);
  });
});
