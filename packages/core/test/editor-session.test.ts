import { describe, expect, it, vi } from "vitest";
import {
  CollabRoom,
  CommentClient,
  EditorRegistry,
  PliError,
  ScriptHost,
  Session,
  Users,
  createAuthority,
  createEditorSession,
  hashState,
  memoryDocumentStore,
  parseRoom,
  roomName,
  trackSocket,
  type EditorSession,
} from "../src";
import { model, reducer, type Op } from "./toy";
import { serverHub } from "./server-hub";

/** A toy editor: a string with its own session wrapper, as a real editor has. */
function toyEditor(initial = ""): EditorSession<string, Op, undefined> {
  const core = new Session<string, Op, undefined>(initial, reducer);
  let client: CommentClient<unknown> | null = null;
  return createEditorSession({
    kind: "text",
    core,
    model,
    comments: {
      get: () => client,
      enable: (options) => (client = new CommentClient({ file: "toy", users: options.users })),
    },
  });
}

describe("an editor session", () => {
  it("offers the same surface whatever the editor is", () => {
    const editor = toyEditor("ab");
    const seen: string[] = [];
    editor.subscribe((event) => seen.push(event.origin));
    editor.transact([{ t: "ins", at: 2, s: "c" }]);
    expect(editor.state).toBe("abc");
    expect(editor.canUndo).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.state).toBe("ab");
    expect(editor.redo()).toBe(true);
    expect(seen).toEqual(["local", "undo", "redo"]);
    expect(editor.serialize()).toBe('"abc"');
    expect(editor.hash()).toBe(model.hash("abc"));
  });

  it("turns comments on once, and says when an editor can't", () => {
    const editor = toyEditor();
    expect(editor.supportsComments).toBe(true);
    expect(editor.comments).toBeNull();
    const users = new Users({ id: "u1", name: "Ana" });
    const client = editor.enableComments({ users });
    expect(editor.comments).toBe(client);
    expect(editor.enableComments({ users })).toBe(client);

    const bare = createEditorSession({ kind: "bare", core: new Session("", reducer), model });
    expect(bare.supportsComments).toBe(false);
    expect(() => bare.enableComments({ users })).toThrow(PliError);
  });

  it("goes live on a room with attachSync, and stops cleanly", async () => {
    const store = memoryDocumentStore<string, Op>();
    const hub = serverHub(createAuthority({ store, model, create: () => "Hello" }));
    const users = (id: string) => new Users({ id, name: id });
    const make = (id: string) => {
      const editor = toyEditor();
      const room = new CollabRoom({ room: "text:1", transport: hub.transport(), users: users(id) });
      return { editor, room, live: editor.attachSync(room, { verifyEvery: 0 }) };
    };
    const a = make("a");
    const b = make("b");
    await Promise.all([a.live.ready, b.live.ready]);
    await hub.idle();
    expect(a.editor.state).toBe("Hello");
    a.editor.transact([{ t: "ins", at: 5, s: "!" }]);
    await vi.waitFor(() => expect(b.editor.state).toBe("Hello!"));
    expect(a.live.sync.status).toBe("synced");
    a.live.stop();
    expect(a.room.status).toBe("idle");
    b.live.stop();
  });

  it("follows a socket's connection state", () => {
    const handlers = new Map<string, () => void>();
    const socket = { emit: () => undefined, on: (e: string, l: () => void) => void handlers.set(e, l), off: (e: string) => void handlers.delete(e) };
    const online: boolean[] = [];
    const stop = trackSocket({ setOnline: (o: boolean) => void online.push(o) }, socket as never);
    handlers.get("disconnect")!();
    handlers.get("connect")!();
    expect(online).toEqual([false, true]);
    stop();
    expect(handlers.size).toBe(0);
  });
});

describe("hashing", () => {
  it("gives equal states the same fingerprint whatever their key order", () => {
    expect(hashState({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } })).toBe(hashState({ b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1, x: undefined }));
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }));
  });
});

describe("scripts", () => {
  it("make one undo step out of everything a run does", () => {
    const editor = toyEditor("x");
    const host = editor.script();
    host.run((ctx) => {
      ctx.apply([{ t: "ins", at: 1, s: "y" }]);
      ctx.apply([{ t: "ins", at: 2, s: "z" }]);
      expect(ctx.state).toBe("xyz");
      expect(ctx.applied).toBe(2);
    });
    expect(editor.state).toBe("xyz");
    editor.undo();
    expect(editor.state).toBe("x");
    expect(editor.canUndo).toBe(false);
  });

  it("keeps a run apart from the step before it", () => {
    const editor = toyEditor("");
    editor.transact([{ t: "ins", at: 0, s: "a" }]);
    editor.script().run((ctx) => ctx.apply([{ t: "ins", at: 1, s: "b" }]));
    editor.undo();
    expect(editor.state).toBe("a");
  });

  it("takes back a run that throws", () => {
    const editor = toyEditor("x");
    expect(() =>
      editor.script().run((ctx) => {
        ctx.apply([{ t: "ins", at: 1, s: "y" }]);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(editor.state).toBe("x");
  });

  it("only gives what was granted", () => {
    const editor = toyEditor("x");
    const readOnly = editor.script({ grants: ["read"] });
    expect(() => readOnly.run((ctx) => ctx.apply([{ t: "ins", at: 0, s: "!" }]))).toThrow(/not allowed to write/);
    const blind = editor.script({ grants: ["write"] });
    expect(() => blind.run((ctx) => ctx.state)).toThrow(/not allowed to read/);
    expect(editor.script().run((ctx) => ctx.can("comments"))).toBe(false);
  });

  it("stops a run that applies too much or is told no", () => {
    const editor = toyEditor("");
    const capped = editor.script({ maxOps: 3 });
    expect(() => capped.run((ctx) => ctx.apply(Array.from({ length: 4 }, (_, i): Op => ({ t: "ins", at: i, s: "a" }))))).toThrow(/more than 3/);
    const picky = editor.script({ allow: (op) => op.t !== "del" });
    expect(() => picky.run((ctx) => ctx.apply([{ t: "del", at: 0, n: 0 }]))).toThrow(/not allowed/);
    let clock = 0;
    const slow = new ScriptHost(editor, { maxMs: 10, now: () => clock });
    expect(() => slow.run((ctx) => { clock = 50; ctx.apply([{ t: "ins", at: 0, s: "a" }]); })).toThrow(/longer than/);
  });

  it("doesn't tell onEdit about a script's own changes, so a handler can't loop", () => {
    const editor = toyEditor("");
    const host = editor.script();
    let calls = 0;
    host.onEdit((event) => {
      calls++;
      if (event.state.length < 5) host.run((ctx) => ctx.apply([{ t: "ins", at: event.state.length, s: "." }]));
    });
    editor.transact([{ t: "ins", at: 0, s: "a" }]);
    expect(calls).toBe(1);
    expect(editor.state).toBe("a.");
    expect(() => host.run(() => host.run(() => 1))).toThrow(/already running/);
  });
});

describe("the editor registry", () => {
  it("knows editors by kind, and refuses a name it can't use in a room", () => {
    const registry = new EditorRegistry([{ kind: "text", model }]);
    expect(registry.has("text")).toBe(true);
    expect(registry.get("text")?.model).toBe(model);
    expect(registry.kinds).toEqual(["text"]);
    expect(() => registry.register({ kind: "text", model })).toThrow(/already registered/);
    expect(() => registry.register({ kind: "Has Space", model })).toThrow(/not a valid editor kind/);
  });

  it("names rooms by kind and reads the names back", () => {
    expect(roomName("sheet", "budget-2026")).toBe("sheet:budget-2026");
    expect(parseRoom("sheet:budget-2026")).toEqual({ kind: "sheet", id: "budget-2026" });
    expect(parseRoom("plain-room")).toEqual({ kind: null, id: "plain-room" });
    expect(parseRoom("a:b:c")).toEqual({ kind: "a", id: "b:c" });
  });
});
