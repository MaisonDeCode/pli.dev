import { describe, expect, it, vi } from "vitest";
import {
  ActivityFeed,
  AnchorTracker,
  CommentClient,
  PliError,
  Session,
  ShareClient,
  Users,
  VersionHistory,
  createAuthority,
  currentFromStore,
  describeActivity,
  memoryActivityStore,
  memorySharingStore,
  memoryDocumentStore,
  memoryVersionStorage,
  stateAtVersion,
  textRangeResolver,
  versionFromStore,
  type TextRangeAnchor,
} from "../src";
import { model, reducer, type Op } from "./toy";
import { serverHub } from "./server-hub";

const ana = { id: "ana", name: "Ana" };
const ben = { id: "ben", name: "Ben" };

// ---- Anchors --------------------------------------------------------------------------------------------------

describe("threads following their content", () => {
  const resolver = textRangeResolver<Op, string>({
    textOf: (op) => (op.t === "ins" ? { target: "t", edits: [{ type: "insert", at: op.at, text: op.s }] } : { target: "t", edits: [{ type: "delete", from: op.at, to: op.at + op.n }] }),
  });

  function setup() {
    const session = new Session<string, Op>("hello brave world", reducer);
    const users = new Users(ana);
    const client = new CommentClient<TextRangeAnchor>({ file: "f", users });
    const thread = client.createThread("Why brave?", { target: "t", from: 6, to: 11, quote: "brave" });
    const persisted: unknown[] = [];
    const tracker = new AnchorTracker(session, client, resolver, { persist: (t, a) => void persisted.push([t.id, a]) });
    return { session, client, thread, tracker, persisted };
  }

  it("moves the anchor when text is typed before it, and keeps it when text is typed after", () => {
    const { session, thread, tracker, persisted } = setup();
    session.transact([{ t: "ins", at: 0, s: ">> " }]);
    expect(tracker.get(thread.id)).toMatchObject({ from: 9, to: 14, quote: "brave" });
    session.transact([{ t: "ins", at: 17, s: "!" }]);
    expect(tracker.get(thread.id)).toMatchObject({ from: 9, to: 14 });
    expect(persisted).toHaveLength(1);
    expect(tracker.describe(thread.id)).toBe("brave");
  });

  it("says when the text was deleted, and keeps it detached", () => {
    const { session, thread, tracker } = setup();
    const heard: number[] = [];
    tracker.subscribe(() => heard.push(1));
    session.transact([{ t: "del", at: 5, n: 8 }]);
    expect(tracker.get(thread.id)).toBeNull();
    expect(tracker.isAttached(thread.id)).toBe(false);
    expect(heard.length).toBeGreaterThan(0);
    session.undo();
    expect(tracker.get(thread.id)).toBeNull();
  });

  it("follows threads that arrive later, and forgets deleted ones", () => {
    const { session, client, tracker } = setup();
    const later = client.createThread("Second", { target: "t", from: 0, to: 5 });
    expect(tracker.get(later.id)).toMatchObject({ from: 0, to: 5 });
    session.transact([{ t: "ins", at: 0, s: "ab" }]);
    expect(tracker.get(later.id)).toMatchObject({ from: 2, to: 7 });
    client.deleteThread(later.id);
    expect(tracker.get(later.id)).toBeUndefined();
    expect(tracker.isAttached("unknown")).toBe(true);
  });
});

// ---- Versions -------------------------------------------------------------------------------------------------

describe("named versions", () => {
  const support = {
    restoreOps: (current: string, target: string): Op[] => [...(current.length ? [{ t: "del", at: 0, n: current.length } as Op] : []), ...(target ? [{ t: "ins", at: 0, s: target } as Op] : [])],
    summarize: (from: string, to: string) => ({ added: Math.max(0, to.length - from.length), removed: Math.max(0, from.length - to.length), changed: 0, lines: [`${from.length} to ${to.length} characters`] }),
  };
  function setup(role: "viewer" | "editor" = "editor") {
    const session = new Session<string, Op>("draft one", reducer);
    const users = new Users({ current: ana, role });
    let now = 1000;
    const history = new VersionHistory<string, Op>({ file: "f", session, storage: memoryVersionStorage<string>(), users, support, hash: model.hash, now: () => now++ });
    return { session, history };
  }

  it("saves a copy under a name, newest first", async () => {
    const { session, history } = setup();
    await history.ready;
    await history.save("First");
    session.transact([{ t: "ins", at: 9, s: " two" }]);
    const second = await history.save("Second", { note: "after edits" });
    expect(history.versions.map((v) => v.name)).toEqual(["Second", "First"]);
    expect(second).toMatchObject({ by: "ana", note: "after edits", state: "draft one two" });
  });

  it("restores as one undoable step and keeps what was there", async () => {
    const { session, history } = setup();
    const first = await history.save("First");
    session.transact([{ t: "ins", at: 9, s: " two" }]);
    await history.restore(first.id);
    expect(session.state).toBe("draft one");
    expect(history.versions.some((v) => v.automatic && v.state === "draft one two")).toBe(true);
    session.undo();
    expect(session.state).toBe("draft one two");
  });

  it("compares with the file now, and only lets editors save", async () => {
    const { session, history } = setup();
    const first = await history.save("First");
    session.transact([{ t: "ins", at: 9, s: "!!!" }]);
    expect(history.compare(first.id).lines).toEqual(["9 to 12 characters"]);
    const viewer = setup("viewer");
    await expect(viewer.history.save("No")).rejects.toThrow(PliError);
    await expect(history.save("  ")).rejects.toThrow(/needs a name/);
    await expect(history.restore("nope")).rejects.toThrow(/No version/);
    await history.remove(first.id);
    expect(history.versions.find((v) => v.id === first.id)).toBeUndefined();
  });

  it("is saved from the sequencer's store, and can read any version back", async () => {
    const store = memoryDocumentStore<string, Op>();
    const authority = createAuthority({ store, model, create: () => "Hi" });
    const hub = serverHub(authority);
    const { CollabRoom, SyncClient } = await import("../src");
    const session = new Session<string, Op>("", reducer);
    const room = new CollabRoom({ room: "r", transport: hub.transport(), users: new Users(ana) });
    await room.connect();
    const sync = new SyncClient({ session, room, model, verifyEvery: 0 });
    sync.start();
    await vi.waitFor(() => expect(sync.version).toBe(0));
    session.transact([{ t: "ins", at: 2, s: "!" }]);
    await vi.waitFor(() => expect(sync.unsynced).toBe(0));
    session.transact([{ t: "ins", at: 3, s: "!" }]);
    await vi.waitFor(() => expect(sync.version).toBe(2));
    await hub.idle();
    const storage = memoryVersionStorage<string>();
    const saved = await versionFromStore({ store, model, storage, room: "r", name: "Server copy", by: "ana" });
    expect(saved).toMatchObject({ version: 2, state: "Hi!!" });
    expect((await currentFromStore(store, model, "r"))?.version).toBe(2);
    expect(await stateAtVersion(store, model, "r", 1)).toBe("Hi!");
    expect(await stateAtVersion(store, model, "r", 9)).toBeNull();
    expect(storage.count("r")).toBe(1);
    await expect(versionFromStore({ store, model, storage, room: "none", name: "x", by: "a" })).rejects.toThrow(/No document/);
    sync.stop();
    room.disconnect();
  });
});

// ---- Activity -------------------------------------------------------------------------------------------------

describe("the activity feed", () => {
  function setup() {
    const users = new Users({ current: ana, role: "editor" });
    users.add([ben]);
    let now = 10_000;
    const store = memoryActivityStore();
    const feed = new ActivityFeed({ file: "f", users, store, now: () => (now += 1000) });
    const client = new CommentClient({ file: "f", users });
    feed.trackComments(client);
    return { feed, client, users, store, bump: (ms: number) => void (now += ms) };
  }

  it("records comments, replies, resolves and the mentions inside them", () => {
    const { feed, client, users } = setup();
    const thread = client.createThread("Can @Ben check?", undefined, undefined, ["ben"]);
    client.reply(thread.id, "Done", []);
    client.resolve(thread.id);
    expect(feed.events.map((e) => e.kind).sort()).toEqual(["comment.created", "comment.replied", "mention", "thread.resolved"]);
    expect(feed.notificationsFor("ben").map((e) => e.kind)).toEqual(["mention"]);
    const mention = feed.events.find((e) => e.kind === "mention")!;
    expect(describeActivity(mention, users)).toBe("You mentioned Ben");
  });

  it("tells a thread's owner when someone replies", () => {
    const { feed, client } = setup();
    const thread = client.createThread("Mine");
    feed.recordComment({ type: "comment.add", threadId: thread.id, comment: { id: "c9", author: "ben", body: "Reply", createdAt: 5 } }, "remote", client);
    expect(feed.notificationsFor("ana").map((e) => e.kind)).toEqual(["comment.replied"]);
  });

  it("folds a run of edits into one entry", () => {
    const { feed, bump } = setup();
    const session = new Session<string, Op>("", reducer);
    feed.trackEdits(session);
    session.transact([{ t: "ins", at: 0, s: "a" }]);
    session.transact([{ t: "ins", at: 1, s: "b" }]);
    session.transact([{ t: "ins", at: 2, s: "c" }]);
    expect(feed.events.filter((e) => e.kind === "edit")).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({ kind: "edit", count: 3, user: "ana" });
    bump(10 * 60_000);
    session.transact([{ t: "ins", at: 3, s: "d" }]);
    expect(feed.events.filter((e) => e.kind === "edit")).toHaveLength(2);
    expect(describeActivity(feed.events[1]!, new Users(ana))).toBe("You made 3 changes");
  });

  it("keeps entries in a store, and reads them back", async () => {
    const { feed, store, users } = setup();
    feed.record({ kind: "version.saved", user: "ana", ref: "ver_1" });
    expect(store.events("f")).toHaveLength(1);
    const again = new ActivityFeed({ file: "f", users, store });
    await again.load();
    expect(again.events.map((e) => e.kind)).toEqual(["version.saved"]);
  });
});

// ---- Sharing --------------------------------------------------------------------------------------------------

describe("sharing", () => {
  function setup(role: "viewer" | "editor" = "editor") {
    const users = new Users({ current: ana, role, search: (q) => [ana, ben, { id: "cy", name: "Cy" }].filter((u) => u.name.toLowerCase().includes(q.toLowerCase())) });
    const store = memorySharingStore({ f: { owner: "ana", grants: [], link: { enabled: false, role: "viewer" } } });
    const share = new ShareClient({ file: "f", users, store, linkUrl: (f) => `https://example.test/open/${f}` });
    return { share, store, users };
  }

  it("invites people by directory lookup and by address, with a role", async () => {
    const { share, store } = setup();
    await share.ready;
    expect((await share.search("b")).map((u) => u.id)).toEqual(["ben"]);
    share.invite([{ id: "ben", name: "Ben" }, "cy@example.test"], "commenter");
    expect(share.settings.grants.map((g) => [g.userId ?? g.email, g.role])).toEqual([["ben", "commenter"], ["cy@example.test", "commenter"]]);
    await vi.waitFor(() => expect(store.settings("f").grants).toHaveLength(2));
    expect((await share.search("b")).map((u) => u.id)).toEqual([]);
    expect(() => share.invite(["not an address"], "viewer")).toThrow(/email/);
  });

  it("changes and takes away roles, but never the owner's", async () => {
    const { share } = setup();
    await share.ready;
    share.invite([{ id: "ben", name: "Ben" }], "viewer");
    share.setRole({ userId: "ben" }, "editor");
    expect(share.roleOf({ id: "ben" })).toBe("editor");
    share.remove({ userId: "ben" });
    expect(share.roleOf({ id: "ben" })).toBeNull();
    expect(share.roleOf({ id: "ana" })).toBe("editor");
    expect(() => share.remove({ userId: "ana" })).toThrow(/owner/);
    expect(() => share.setRole({ userId: "zed" }, "viewer")).toThrow(/no access/);
  });

  it("gives what the link allows to everyone, or to signed-in people", async () => {
    const { share } = setup();
    await share.ready;
    expect(share.linkUrl).toBeNull();
    share.setLink({ enabled: true, role: "commenter" });
    expect(share.linkUrl).toBe("https://example.test/open/f");
    expect(share.roleOf(null)).toBe("commenter");
    share.setLink({ audience: "signed-in" });
    expect(share.roleOf(null)).toBeNull();
    expect(share.roleOf({ id: "stranger" })).toBe("commenter");
    share.invite([{ id: "ben", name: "Ben" }], "editor");
    expect(share.roleOf({ id: "ben" })).toBe("editor");
  });

  it("lets only editors share, and takes back what the store refuses", async () => {
    const viewer = setup("viewer");
    expect(viewer.share.can("invite")).toBe(false);
    expect(() => viewer.share.invite([{ id: "ben", name: "Ben" }], "viewer")).toThrow(/Not allowed/);
    const errors: unknown[] = [];
    const users = new Users({ current: ana, role: "editor" });
    const share = new ShareClient({ file: "f", users, store: { load: () => ({ grants: [], link: { enabled: false, role: "viewer" } }), save: () => { throw new Error("down"); } }, onError: (e) => void errors.push(e) });
    await share.ready;
    share.invite([{ id: "ben", name: "Ben" }], "viewer");
    expect(share.settings.grants).toHaveLength(1);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(share.settings.grants).toHaveLength(0);
  });

  it("reads changes other people make", async () => {
    const { share, store } = setup();
    await share.ready;
    store.save("f", { type: "grant", grant: { userId: "cy", role: "viewer", at: 1 } });
    expect(share.settings.grants.map((g) => g.userId)).toEqual(["cy"]);
  });
});

