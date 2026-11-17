import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CollabRoom,
  EditorRegistry,
  PliError,
  ShareClient,
  Session,
  Users,
  VersionHistory,
  createEditorSession,
  roomName,
  socketTransport,
  type EditorSession,
  type Reducer,
  type SyncModel,
} from "@pli.dev/core";
import { DocumentSession, createDoc, documentEditorSession } from "@pli.dev/docs";
import { SheetSession, createWorkbook, sheetEditorSession } from "@pli.dev/sheets";
import { DeckSession, createDeck, deckEditorSession } from "@pli.dev/decks";
import { PdfSession, pdfEditorSession } from "@pli.dev/pdf";
import { attachCollabServer } from "../server/collab-server";
import { defaultEditors } from "../server/editors";
import { serverSharingStore, serverVersionStorage } from "../src/collab/connection";

// ---- Two fake editors, so the server is tested without depending on any real editor's merge rules ---------------
//
// A "grid" (like a sheet): cells by address, the later write to a cell wins. A "slides" (like a deck): an ordered list of
// slides placed after one another, each with a title; two slides added after the same one both stay, in a fixed order.

type GridState = { cells: Record<string, string> };
type GridOp = { type: "set"; cell: string; value: string | null };
const gridReducer: Reducer<GridState, GridOp> = {
  apply(state, op) {
    const cells = { ...state.cells };
    const old = cells[op.cell] ?? null;
    if (op.value === null) delete cells[op.cell];
    else cells[op.cell] = op.value;
    return { state: { cells }, inverse: { type: "set", cell: op.cell, value: old } };
  },
};
const gridModel: SyncModel<GridState, GridOp> = {
  apply: (s, op) => gridReducer.apply(s, op).state,
  // The later write to the same cell wins; the earlier one's copy has nothing left to do there.
  transform: (later, earlier) => [[...later], earlier.filter((e) => !later.some((l) => l.cell === e.cell))],
  hash: (s) => JSON.stringify(Object.entries(s.cells).sort(([a], [b]) => a.localeCompare(b))),
};

type SlidesState = { order: string[]; titles: Record<string, string> };
type SlidesOp = { type: "add"; id: string; after: string | null } | { type: "remove"; id: string } | { type: "title"; id: string; text: string };
const slidesReducer: Reducer<SlidesState, SlidesOp> = {
  apply(state, op) {
    if (op.type === "add") {
      const at = op.after === null ? 0 : state.order.indexOf(op.after) + 1;
      if (op.after !== null && at === 0) throw new PliError("not_found", "no such slide");
      const order = [...state.order.slice(0, at), op.id, ...state.order.slice(at)];
      return { state: { ...state, order }, inverse: { type: "remove", id: op.id } };
    }
    if (!state.order.includes(op.id)) throw new PliError("not_found", "no such slide");
    if (op.type === "remove") {
      const i = state.order.indexOf(op.id);
      const order = state.order.filter((x) => x !== op.id);
      return { state: { ...state, order }, inverse: { type: "add", id: op.id, after: i === 0 ? null : state.order[i - 1]! } };
    }
    return { state: { ...state, titles: { ...state.titles, [op.id]: op.text } }, inverse: { type: "title", id: op.id, text: state.titles[op.id] ?? "" } };
  },
};
const slidesModel: SyncModel<SlidesState, SlidesOp> = {
  apply: (s, op) => slidesReducer.apply(s, op).state,
  transform(later, earlier) {
    // Two slides added after the same one: the later goes after the earlier, so both orders agree.
    const l = later.map((op) => ({ ...op }) as SlidesOp);
    const e = earlier.map((op) => ({ ...op }) as SlidesOp);
    for (const lo of l) for (const eo of e) if (lo.type === "add" && eo.type === "add" && lo.after === eo.after) lo.after = eo.id;
    return [l, e];
  },
  hash: (s) => JSON.stringify([s.order, Object.entries(s.titles).sort(([a], [b]) => a.localeCompare(b))]),
};

const fakeEditors = () =>
  new EditorRegistry([
    { kind: "grid", model: gridModel, create: () => ({ cells: { A1: "start" } }) },
    { kind: "slides", model: slidesModel, create: () => ({ order: ["s1"], titles: { s1: "Title" } }) },
  ]);

const gridEditor = (): EditorSession<GridState, GridOp, undefined> => createEditorSession({ kind: "grid", core: new Session<GridState, GridOp>({ cells: {} }, gridReducer), model: gridModel });
const slidesEditor = (): EditorSession<SlidesState, SlidesOp, undefined> => createEditorSession({ kind: "slides", core: new Session<SlidesState, SlidesOp>({ order: [], titles: {} }, slidesReducer), model: slidesModel });

// ---- The harness ----------------------------------------------------------------------------------------------

let http: HttpServer;
let server: ReturnType<typeof attachCollabServer>;
let url: string;
const open: (() => void)[] = [];

async function start(options: Parameters<typeof attachCollabServer>[1] = {}) {
  http = createServer();
  server = attachCollabServer(http, { onError: (error) => { throw error; }, ...options });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

beforeEach(() => start({ editors: fakeEditors() }));

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

/** One person: a socket, a room, and an editor session of any kind put on the shared document with `attachSync`. */
async function join<S, O, M>(room: string, name: string, editor: EditorSession<S, O, M>, auth: Record<string, unknown> = {}) {
  const socket: Socket = io(url, { forceNew: true, autoConnect: false, auth });
  const users = new Users({ id: `u_${name}`, name });
  const live = new CollabRoom({ room, transport: socketTransport(socket), users });
  socket.connect();
  const attached = editor.attachSync(live, { socket, verifyEvery: 0 });
  open.push(() => {
    attached.stop();
    socket.disconnect();
  });
  await attached.ready;
  return { socket, editor, room: live, sync: attached.sync, users };
}
const settled = (...people: { sync: { unsynced: number } }[]) => until(() => people.every((p) => p.sync.unsynced === 0), "changes to be saved");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Tests ----------------------------------------------------------------------------------------------------

describe("one server for every editor", () => {
  it("serves a sheet-like room: both people get the starting file and their changes merge", async () => {
    const room = roomName("grid", "budget");
    const [a, b] = [await join(room, "ana", gridEditor()), await join(room, "ben", gridEditor())];
    expect(a.editor.state.cells).toEqual({ A1: "start" });
    a.editor.transact([{ type: "set", cell: "B1", value: "ana" }, { type: "set", cell: "C1", value: "shared" }]);
    b.editor.transact([{ type: "set", cell: "B2", value: "ben" }, { type: "set", cell: "C1", value: "ben wins or ana does" }]);
    await settled(a, b);
    await until(() => a.editor.hash() === b.editor.hash(), "both copies to agree");
    expect(a.editor.state.cells.B1).toBe("ana");
    expect(a.editor.state.cells.B2).toBe("ben");
    expect(a.editor.state.cells.C1).toBeDefined();
    // Undo takes back only your own change.
    a.editor.undo();
    await settled(a, b);
    await until(() => a.editor.hash() === b.editor.hash(), "undo to reach everyone");
    expect(b.editor.state.cells.B1).toBeUndefined();
    expect(b.editor.state.cells.B2).toBe("ben");
  });

  it("serves a deck-like room: slides added after the same slide at once both stay, in the same order for everyone", async () => {
    const room = roomName("slides", "launch");
    const [a, b] = [await join(room, "ana", slidesEditor()), await join(room, "ben", slidesEditor())];
    expect(a.editor.state.order).toEqual(["s1"]);
    a.editor.transact([{ type: "add", id: "ana-1", after: "s1" }, { type: "title", id: "ana-1", text: "Ana's slide" }]);
    b.editor.transact([{ type: "add", id: "ben-1", after: "s1" }, { type: "title", id: "s1", text: "Renamed" }]);
    await settled(a, b);
    await until(() => a.editor.hash() === b.editor.hash(), "both decks to agree");
    expect(a.editor.state.order).toHaveLength(3);
    expect(a.editor.state.order[0]).toBe("s1");
    expect(a.editor.state.titles).toMatchObject({ s1: "Renamed", "ana-1": "Ana's slide" });
  });

  it("drops a change to something that was removed meanwhile, and puts that person back on the server's copy", async () => {
    const room = roomName("slides", "removal");
    const a = await join(room, "ana", slidesEditor());
    const b = await join(room, "ben", slidesEditor());
    // Ben goes offline and titles slide 1; while he is away Ana removes it.
    b.socket.disconnect();
    await until(() => b.sync.status === "offline", "ben to notice he is offline");
    b.editor.transact([{ type: "title", id: "s1", text: "Too late" }]);
    a.editor.transact([{ type: "remove", id: "s1" }]);
    await settled(a);
    b.socket.connect();
    await until(() => b.sync.status === "synced" && b.editor.hash() === a.editor.hash(), "ben to be brought up to date");
    expect(b.editor.state.order).toEqual([]);
    expect(b.sync.lastResync?.reason).toMatch(/left out|server's copy/);
  });

  it("keeps each room and each kind apart, in the one store", async () => {
    const [a, b, c] = [await join("grid:one", "ana", gridEditor()), await join("grid:two", "ben", gridEditor()), await join("slides:one", "cy", slidesEditor())];
    a.editor.transact([{ type: "set", cell: "Z9", value: "only in one" }]);
    c.editor.transact([{ type: "title", id: "s1", text: "only slides" }]);
    await settled(a, c);
    await wait(100);
    expect(b.editor.state.cells.Z9).toBeUndefined();
    const stored = await server.store.entries("grid:one", 0);
    expect(stored?.map((e: { ops: unknown[] }) => e.ops.length)).toEqual([1]);
    expect((await server.store.entries("slides:one", 0))?.length).toBe(1);
    expect((await server.store.entries("grid:two", 0))?.length).toBe(0);
  });

  it("treats a plain room name as a document, and refuses a kind nobody registered", async () => {
    await server.close();
    http.closeAllConnections?.();
    await start({ editors: new EditorRegistry([{ kind: "document", model: fakeEditors().get("grid")!.model, create: () => ({ cells: { hello: "doc" } }) }]) });
    const plain = await join("just-a-name", "ana", gridEditor());
    expect(plain.editor.state.cells.hello).toBe("doc");

    const socket = io(url, { forceNew: true });
    const refused = new Promise<string>((resolve) => socket.on("pli:refused", (_room: string, reason: string) => resolve(reason)));
    socket.emit("pli:join", "spreadsheet:x");
    expect(await refused).toContain("No \"spreadsheet\" editor");
    socket.disconnect();
  });

  it("asks the app before it lets a connection join or change a file", async () => {
    await server.close();
    http.closeAllConnections?.();
    const calls: string[] = [];
    await start({
      editors: fakeEditors(),
      authorize: ({ socket, action, message }) => {
        calls.push(action);
        // A real app checks its own session here; the demo trusts a role the client says it has. Anyone may join and read;
        // only an editor may send changes.
        return message?.type !== "ops" || socket.handshake.auth.role === "editor";
      },
    });
    const room = "grid:locked";
    const editor = await join(room, "ana", gridEditor(), { role: "editor" });
    const viewer = await join(room, "vic", gridEditor(), { role: "viewer" });
    editor.editor.transact([{ type: "set", cell: "B1", value: "from the editor" }]);
    await settled(editor);
    await until(() => viewer.editor.state.cells.B1 === "from the editor", "the viewer to see the editor's change");
    viewer.editor.transact([{ type: "set", cell: "B2", value: "from the viewer" }]);
    // The server says no: the viewer is sent back to the server's copy.
    await until(() => viewer.editor.state.cells.B2 === undefined && viewer.sync.status === "synced", "the viewer to be put back");
    expect(editor.editor.state.cells.B2).toBeUndefined();
    expect(calls).toContain("join");
    expect(calls).toContain("sync");
  });

  it("keeps people's versions and sharing for any kind of room, through adapters", async () => {
    const room = "grid:budget-2026";
    const a = await join(room, "ana", gridEditor());
    const b = await join(room, "ben", gridEditor());
    a.editor.transact([{ type: "set", cell: "B1", value: "v1" }]);
    await settled(a);

    // Version history over the server's table.
    const storage = serverVersionStorage<GridState>(a.socket, room);
    const history = new VersionHistory<GridState, GridOp>({
      file: room,
      session: a.editor,
      storage,
      users: new Users({ current: { id: "u_ana", name: "ana" }, role: "editor" }),
      hash: gridModel.hash,
      version: () => a.sync.version,
      support: { restoreOps: (current, target) => [...Object.keys(current.cells).map((cell) => ({ type: "set", cell, value: null }) as GridOp), ...Object.entries(target.cells).map(([cell, value]) => ({ type: "set", cell, value }) as GridOp)] },
    });
    await history.ready;
    const saved = await history.save("Before the board");
    a.editor.transact([{ type: "set", cell: "B1", value: "v2" }]);
    await settled(a);
    await history.restore(saved.id);
    await settled(a);
    await until(() => b.editor.state.cells.B1 === "v1", "the restore to reach ben");
    expect(history.versions.map((v) => v.name)).toContain("Before the board");
    // A version saved by the server from the sequencer's own copy, with no editor involved.
    const server_made = await storage.snapshot("Nightly", "system");
    expect(server_made.state).toEqual({ cells: { A1: "start", B1: "v1" } });
    expect(server_made.version).toBeGreaterThan(0);
    await history.reload();
    expect(history.versions.map((v) => v.name)).toEqual(expect.arrayContaining(["Nightly", "Before the board"]));

    // Sharing: what one person grants, the other's dialog sees.
    const sharing = (who: typeof a, id: string) => new ShareClient({ file: room, users: new Users({ current: { id, name: id }, role: "editor" }), store: serverSharingStore(who.socket, room) });
    const one = sharing(a, "u_ana");
    const two = sharing(b, "u_ben");
    await Promise.all([one.ready, two.ready]);
    one.invite([{ id: "cy", name: "Cy" }], "commenter");
    await until(() => two.settings.grants.some((g) => g.userId === "cy"), "ben to see the new grant");
    expect(two.roleOf({ id: "cy" })).toBe("commenter");
  });
});

describe("the real editors on the same server", () => {
  beforeEach(async () => {
    await server.close();
    http.closeAllConnections?.();
    await start({ editors: defaultEditors() });
  });

  it("serves a document room (the default kind) and a PDF room", async () => {
    const doc = () => documentEditorSession(new DocumentSession(createDoc("", [])));
    const [a, b] = [await join("doc-notes", "ana", doc()), await join("doc-notes", "ben", doc())];
    a.editor.transact([{ type: "set_title", title: "Agreed title" }]);
    await until(() => b.editor.state.title === "Agreed title", "ben to get the title");

    const pdf = () => pdfEditorSession(new PdfSession());
    const [p, q] = [await join("pdf:contract", "ana", pdf()), await join("pdf:contract", "ben", pdf())];
    p.editor.transact([{ type: "set_meta", patch: { title: "Contract" } }]);
    await until(() => q.editor.state.meta.title === "Contract", "ben to get the PDF title");
    expect(q.editor.hash()).toBe(p.editor.hash());
  });

  it("serves sheet and deck rooms with the models the editors export", async () => {
    const sheet = () => sheetEditorSession(new SheetSession(createWorkbook("x")));
    const [s1, s2] = [await join("sheet:budget", "ana", sheet()), await join("sheet:budget", "ben", sheet())];
    const id = s1.editor.state.sheets[0]!.id;
    s1.editor.transact([{ type: "set_cells", sheet: id, cells: { A1: { v: "Revenue" } } }]);
    s2.editor.transact([{ type: "set_cells", sheet: id, cells: { B1: { v: 42 } } }]);
    await settled(s1, s2);
    await until(() => s1.editor.hash() === s2.editor.hash(), "both sheets to agree");
    expect(s1.editor.state.sheets[0]!.cells.A1?.v).toBe("Revenue");
    expect(s1.editor.state.sheets[0]!.cells.B1?.v).toBe(42);

    const deck = () => deckEditorSession(new DeckSession(createDeck()));
    const [d1, d2] = [await join("deck:launch", "ana", deck()), await join("deck:launch", "ben", deck())];
    d1.editor.transact([{ type: "set_deck", patch: { title: "Launch plan" } }]);
    await until(() => d2.editor.state.title === "Launch plan", "ben to get the deck title");
  });
});

