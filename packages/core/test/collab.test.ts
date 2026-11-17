import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollabRoom,
  CommentClient,
  PliError,
  Users,
  applyCommentChange,
  memoryCommentStore,
  memoryHub,
  socketTransport,
  userColor,
  userInitials,
  webSocketTransport,
  type CommentChange,
  type CommentStore,
  type PliUser,
  type SocketLike,
  type Thread,
} from "../src";

const ana: PliUser = { id: "ana", name: "Ana Reyes" };
const ben: PliUser = { id: "ben", name: "Ben Ito", color: "#123456" };

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe("users", () => {
  it("gives every user a color, and the same one each time", () => {
    expect(userColor("ana")).toBe(userColor("ana"));
    expect(new Users(ana).current?.color).toMatch(/^#/);
    expect(new Users(ben).current?.color).toBe("#123456");
  });

  it("makes initials", () => {
    expect(userInitials(ana)).toBe("AR");
    expect(userInitials({ name: "cher" })).toBe("C");
    expect(userInitials({ name: "  " })).toBe("?");
  });

  it("answers at once with a placeholder, then the real user once the directory replies", async () => {
    const lookup = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() })));
    const users = new Users({ current: ana, lookup });
    const seen = vi.fn();
    users.subscribe(seen);
    expect(users.get("zed").name).toBe("zed");
    users.get("zed");
    users.get("kim");
    await flush();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(["zed", "kim"]);
    expect(users.get("zed").name).toBe("ZED");
    expect(seen).toHaveBeenCalled();
  });

  it("falls back to placeholders when the directory fails", async () => {
    const users = new Users({ current: ana, lookup: async () => { throw new Error("down"); } });
    users.get("zed");
    await flush();
    expect(users.get("zed").name).toBe("zed");
  });

  it("is anonymous with no user", () => {
    expect(new Users().current).toBeNull();
  });
});

describe("comment changes", () => {
  const thread: Thread = { id: "t1", createdAt: 1, comments: [{ id: "c1", author: "ana", body: "Hi", createdAt: 1 }] };

  it("applies each kind of change", () => {
    let all = applyCommentChange([], { type: "thread.create", thread });
    all = applyCommentChange(all, { type: "comment.add", threadId: "t1", comment: { id: "c2", author: "ben", body: "Yo", createdAt: 2 } });
    all = applyCommentChange(all, { type: "comment.edit", threadId: "t1", commentId: "c2", body: "Yo!", at: 3 });
    all = applyCommentChange(all, { type: "thread.resolve", threadId: "t1", by: "ana", at: 4 });
    expect(all[0]!.comments.map((c) => c.body)).toEqual(["Hi", "Yo!"]);
    expect(all[0]!.comments[1]!.editedAt).toBe(3);
    expect(all[0]!.resolved).toEqual({ by: "ana", at: 4 });
    all = applyCommentChange(all, { type: "thread.reopen", threadId: "t1" });
    expect(all[0]!.resolved).toBeUndefined();
    all = applyCommentChange(all, { type: "comment.delete", threadId: "t1", commentId: "c1" });
    expect(all[0]!.comments).toHaveLength(1);
    expect(applyCommentChange(all, { type: "thread.delete", threadId: "t1" })).toEqual([]);
  });

  it("is safe to apply twice, and ignores changes to threads that are gone", () => {
    const create: CommentChange = { type: "thread.create", thread };
    const add: CommentChange = { type: "comment.add", threadId: "t1", comment: { id: "c2", author: "ben", body: "Yo", createdAt: 2 } };
    const once = [create, add].reduce(applyCommentChange, [] as Thread[]);
    const twice = [create, add, create, add].reduce(applyCommentChange, [] as Thread[]);
    expect(twice[0]!.comments).toHaveLength(2);
    expect(twice.length).toBe(once.length);
    expect(applyCommentChange([], add)).toEqual([]);
  });
});

function client(user: PliUser | null, store?: CommentStore, extra: Partial<ConstructorParameters<typeof CommentClient>[0]> = {}) {
  return new CommentClient({ file: "f", users: new Users(user), store, ...extra });
}

describe("CommentClient", () => {
  it("keeps threads in memory without a store", () => {
    const comments = client(ana);
    const thread = comments.createThread("First", { at: 1 });
    comments.reply(thread.id, "Second");
    expect(comments.threads[0]!.comments.map((c) => c.body)).toEqual(["First", "Second"]);
    expect(comments.threads[0]!.anchor).toEqual({ at: 1 });
    expect(comments.threads[0]!.comments[0]!.author).toBe("ana");
  });

  it("shows a change at once and saves it to the store", async () => {
    const store = memoryCommentStore();
    const comments = client(ana, store);
    await comments.ready;
    const thread = comments.createThread("Hi");
    expect(comments.threads).toHaveLength(1);
    expect(store.threads("f")).toHaveLength(0);
    await flush();
    expect(store.threads("f")[0]!.id).toBe(thread.id);
  });

  it("loads what the store has, and keeps initial threads until then", async () => {
    const saved: Thread = { id: "old", createdAt: 1, comments: [{ id: "c", author: "ben", body: "Old", createdAt: 1 }] };
    const comments = client(ana, memoryCommentStore({ f: [saved] }));
    expect(comments.status).toBe("loading");
    await comments.ready;
    expect(comments.status).toBe("ready");
    expect(comments.threads.map((t) => t.id)).toEqual(["old"]);
  });

  it("takes a change back, and tells you, when the store refuses it", async () => {
    const errors: PliError[] = [];
    const store: CommentStore = { load: () => [], save: async () => { throw new Error("offline"); } };
    const comments = client(ana, store, { onError: (e) => errors.push(e) });
    await comments.ready;
    const thread = comments.createThread("Hi");
    comments.reply(thread.id, "Again");
    expect(comments.threads).toHaveLength(1);
    await flush();
    await flush();
    expect(comments.threads).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("storage");
  });

  it("saves changes in order", async () => {
    const saved: string[] = [];
    const store: CommentStore = {
      load: () => [],
      save: async (_file, change) => {
        await new Promise((r) => setTimeout(r, change.type === "thread.create" ? 5 : 0));
        saved.push(change.type);
      },
    };
    const comments = client(ana, store);
    await comments.ready;
    const thread = comments.createThread("Hi");
    comments.reply(thread.id, "Two");
    comments.resolve(thread.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).toEqual(["thread.create", "comment.add", "thread.resolve"]);
  });

  it("takes in changes from the store's subscription and from receive, without saving them again", async () => {
    const store = memoryCommentStore();
    const save = vi.spyOn(store, "save");
    const comments = client(ana, store);
    await comments.ready;
    const thread: Thread = { id: "t", createdAt: 1, comments: [{ id: "c", author: "ben", body: "Hi", createdAt: 1 }] };
    comments.receive({ type: "thread.create", thread });
    expect(comments.threads).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    store.save("f", { type: "comment.add", threadId: "t", comment: { id: "c2", author: "ben", body: "More", createdAt: 2 } });
    expect(comments.thread("t")!.comments).toHaveLength(2);
  });

  it("tells outgoing listeners once a change is kept", async () => {
    const comments = client(ana, memoryCommentStore());
    await comments.ready;
    const sent: string[] = [];
    comments.onOutgoing((c) => sent.push(c.type));
    comments.createThread("Hi");
    expect(sent).toEqual([]);
    await flush();
    expect(sent).toEqual(["thread.create"]);
  });

  describe("permissions", () => {
    const thread = (author: string): Thread => ({ id: "t", createdAt: 1, comments: [{ id: "c", author, body: "x", createdAt: 1 }] });

    it("lets no one comment without a user", () => {
      expect(() => client(null).createThread("Hi")).toThrow(/Sign in/);
      expect(client(null).can("comment")).toBe(false);
    });

    it("keeps viewers to reading", () => {
      const comments = client({ ...ana }, undefined, { initial: [thread("ben")] });
      const viewer = new CommentClient({ file: "f", users: new Users({ current: ana, role: "viewer" }), initial: [thread("ana")] });
      expect(viewer.can("comment")).toBe(false);
      expect(() => viewer.createThread("Hi")).toThrow(PliError);
      expect(comments.can("comment")).toBe(true);
    });

    it("lets commenters change only their own comments", () => {
      const comments = new CommentClient({ file: "f", users: new Users({ current: ana, role: "commenter" }), initial: [thread("ben")] });
      const other = comments.thread("t")!;
      expect(comments.can("reply", other)).toBe(true);
      expect(comments.can("resolve", other)).toBe(true);
      expect(comments.can("edit", other, other.comments[0])).toBe(false);
      expect(comments.can("deleteThread", other)).toBe(false);
      expect(() => comments.editComment("t", "c", "nope")).toThrow(/Not allowed/);
    });

    it("lets editors moderate", () => {
      const comments = new CommentClient({ file: "f", users: new Users({ current: ana, role: "editor" }), initial: [thread("ben")] });
      comments.deleteComment("t", "c");
      expect(comments.threads).toHaveLength(0);
    });

    it("lets your own rules decide", () => {
      const comments = new CommentClient({
        file: "f",
        users: new Users(ana),
        initial: [thread("ana")],
        permissions: (action) => (action === "deleteThread" ? false : undefined),
      });
      expect(comments.can("deleteThread", comments.thread("t"))).toBe(false);
      expect(comments.can("reply", comments.thread("t"))).toBe(true);
    });

    it("rejects a reply to a thread that isn't there", () => {
      expect(() => client(ana).reply("nope", "Hi")).toThrow(/No thread/);
    });
  });
});

describe("CollabRoom", () => {
  async function pair() {
    const hub = memoryHub();
    const a = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ana) });
    const b = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ben) });
    await a.connect();
    await b.connect();
    return { a, b, hub };
  }

  it("shows who else is here, and what they are doing", async () => {
    const { a, b } = await pair();
    expect(a.peers.map((p) => p.user.id)).toEqual(["ben"]);
    expect(b.peers.map((p) => p.user.id)).toEqual(["ana"]);
    b.setPresence({ at: 5 });
    expect(a.peers[0]!.state).toEqual({ at: 5 });
  });

  it("survives being disconnected and connected again before the transport is ready", async () => {
    const hub = memoryHub();
    const a = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ana) });
    const b = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ben) });
    await a.connect();
    // As React does in development: connect, disconnect, connect, all at once.
    const first = b.connect();
    b.disconnect();
    const second = b.connect();
    await Promise.all([first, second]);
    expect(b.status).toBe("connected");
    expect(a.peers.map((p) => p.user.id)).toEqual(["ben"]);
    expect(b.peers.map((p) => p.user.id)).toEqual(["ana"]);
    b.disconnect();
    expect(a.peers).toEqual([]);
  });

  it("drops someone who leaves", async () => {
    const { a, b } = await pair();
    b.disconnect();
    expect(a.peers).toEqual([]);
  });

  it("drops someone who goes quiet", async () => {
    vi.useFakeTimers();
    const hub = memoryHub();
    const a = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ana), heartbeat: 1000 });
    await a.connect();
    // Someone who says hello once and is never heard from again.
    const ghost = hub.transport();
    ghost.connect("r", () => {});
    ghost.send({ v: 1, client: "ghost", message: { type: "presence", user: ben, state: {} } });
    expect(a.peers).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(a.peers).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(a.peers).toEqual([]);
    a.disconnect();
  });

  it("shares comments between rooms", async () => {
    const hub = memoryHub();
    const ca = client(ana);
    const cb = client(ben);
    const a = new CollabRoom({ room: "r", transport: hub.transport(), users: ca.users, comments: ca });
    const b = new CollabRoom({ room: "r", transport: hub.transport(), users: cb.users, comments: cb });
    await a.connect();
    await b.connect();
    const thread = ca.createThread("Look at this", { at: 3 });
    expect(cb.thread(thread.id)!.comments[0]!.body).toBe("Look at this");
    cb.reply(thread.id, "Seen");
    expect(ca.thread(thread.id)!.comments).toHaveLength(2);
    ca.resolve(thread.id);
    expect(cb.thread(thread.id)!.resolved?.by).toBe("ana");
  });

  it("passes custom messages to the module that asked", async () => {
    const { a, b } = await pair();
    const got = vi.fn();
    a.onCustom("cell", got);
    b.sendCustom("cell", { at: "B2" });
    expect(got).toHaveBeenCalledWith({ at: "B2" }, expect.objectContaining({ user: expect.objectContaining({ id: "ben" }) }));
  });

  it("ignores messages that aren't its own format", async () => {
    const hub = memoryHub();
    const stranger = hub.transport();
    stranger.connect("r", () => {});
    const a = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ana) });
    await a.connect();
    stranger.send("hello");
    stranger.send({ v: 2 });
    stranger.send(null);
    expect(a.peers).toEqual([]);
  });

  it("works without a signed-in user, watching only", async () => {
    const hub = memoryHub();
    const a = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ana) });
    const watcher = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users() });
    await a.connect();
    await watcher.connect();
    expect(watcher.peers.map((p) => p.user.id)).toEqual(["ana"]);
    expect(a.peers).toEqual([]);
  });
});

describe("socket transports", () => {
  /** A server's view: sockets that join rooms and pass `pli` messages on to the rest of the room. */
  function fakeIo() {
    type Handler = (...args: any[]) => void;
    const sockets: { handlers: Map<string, Handler[]>; rooms: Set<string>; socket: SocketLike }[] = [];
    const make = () => {
      const handlers = new Map<string, Handler[]>();
      const rooms = new Set<string>();
      const self = { handlers, rooms, socket: null as unknown as SocketLike };
      self.socket = {
        on: (event, listener) => void handlers.set(event, [...(handlers.get(event) ?? []), listener]),
        off: (event, listener) => void handlers.set(event, (handlers.get(event) ?? []).filter((l) => l !== listener)),
        emit: (event, ...args) => {
          if (event === "pli:join") rooms.add(args[0] as string);
          if (event === "pli:leave") rooms.delete(args[0] as string);
          if (event === "pli") {
            for (const other of sockets) {
              if (other !== self && other.rooms.has(args[0] as string)) for (const h of other.handlers.get("pli") ?? []) h(...args);
            }
          }
        },
      };
      sockets.push(self);
      return self.socket;
    };
    return { make };
  }

  it("carries a room over socket.io-shaped sockets", async () => {
    const io = fakeIo();
    const a = new CollabRoom({ room: "doc", transport: socketTransport(io.make()), users: new Users(ana) });
    const b = new CollabRoom({ room: "doc", transport: socketTransport(io.make()), users: new Users(ben) });
    const other = new CollabRoom({ room: "elsewhere", transport: socketTransport(io.make()), users: new Users({ id: "x", name: "X" }) });
    await a.connect();
    await b.connect();
    await other.connect();
    expect(a.peers.map((p) => p.user.id)).toEqual(["ben"]);
    expect(other.peers).toEqual([]);
    b.disconnect();
    expect(a.peers).toEqual([]);
  });

  it("carries a room over a WebSocket", async () => {
    const sent: string[] = [];
    const listeners = new Set<(event: { data: unknown }) => void>();
    const ws = {
      readyState: 1,
      send: (data: string) => void sent.push(data),
      addEventListener: (_t: "message", l: (event: { data: unknown }) => void) => void listeners.add(l),
      removeEventListener: (_t: "message", l: (event: { data: unknown }) => void) => void listeners.delete(l),
    };
    const transport = webSocketTransport(ws);
    const received = vi.fn();
    transport.connect("doc", received);
    expect(JSON.parse(sent[0]!)).toEqual({ room: "doc", join: true });
    transport.send({ hi: 1 });
    expect(JSON.parse(sent[1]!)).toEqual({ room: "doc", data: { hi: 1 } });
    for (const l of listeners) l({ data: JSON.stringify({ room: "doc", data: { from: "x" } }) });
    for (const l of listeners) l({ data: JSON.stringify({ room: "other", data: 1 }) });
    for (const l of listeners) l({ data: "not json" });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({ from: "x" });
    transport.disconnect();
    expect(listeners.size).toBe(0);
  });
});

describe("a socket that reconnects", () => {
  it("is told again which room it is in, because the server doesn't remember a lost connection", () => {
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    const emitted: unknown[][] = [];
    const socket: SocketLike = {
      emit: (event, ...args) => void emitted.push([event, ...args]),
      on: (event, listener) => void handlers.set(event, [...(handlers.get(event) ?? []), listener]),
      off: (event, listener) => void handlers.set(event, (handlers.get(event) ?? []).filter((l) => l !== listener)),
    };
    const transport = socketTransport(socket);
    transport.connect("doc", () => {});
    expect(emitted).toEqual([["pli:join", "doc"]]);
    // The connection drops and comes back.
    for (const listener of handlers.get("connect") ?? []) listener();
    expect(emitted).toEqual([["pli:join", "doc"], ["pli:join", "doc"]]);
    transport.disconnect();
    for (const listener of handlers.get("connect") ?? []) listener();
    expect(emitted.at(-1)).toEqual(["pli:leave", "doc"]);
    expect(emitted).toHaveLength(3);
  });
});
