import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentClient, Users, commentNotices, memoryCommentStore, type CommentNotice, type CommentStore, type PliUser } from "../src";

const PEOPLE: PliUser[] = [
  { id: "ana", name: "Ana" },
  { id: "ben", name: "Ben" },
  { id: "cy", name: "Cy" },
  { id: "di", name: "Di" },
];
const users = (me = "ana") => new Users({ current: PEOPLE.find((p) => p.id === me)!, lookup: (ids) => PEOPLE.filter((p) => ids.includes(p.id)) });
const ids = (notice: CommentNotice) => notice.recipients.map((r) => `${r.user.id}:${r.reason}`);
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("commentNotices", () => {
  afterEach(() => vi.useRealTimers());

  it("tells the people a new thread mentions, and never the author", async () => {
    const seen: CommentNotice[] = [];
    const client = new CommentClient({ file: "f", users: users(), onNotify: (n) => void seen.push(n) });
    client.createThread("Look @Ben and @Ana", { at: "1" }, undefined, ["ben", "ana"]);
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "comment.created", file: "f", actor: { id: "ana" } });
    expect(ids(seen[0]!)).toEqual(["ben:mention"]);
    expect(seen[0]!.thread.comments[0]!.body).toContain("@Ben");
    expect(seen[0]!.comment?.id).toBe(seen[0]!.thread.comments[0]!.id);
  });

  it("still announces a comment that mentions nobody, with no recipients", async () => {
    const seen: CommentNotice[] = [];
    const client = new CommentClient({ file: "f", users: users(), onNotify: (n) => void seen.push(n) });
    client.createThread("Note to self", { at: "1" });
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.recipients).toEqual([]);
  });

  it("tells a reply's mentions and the others in the thread, each once", async () => {
    const store = memoryCommentStore<{ at: string }>();
    // Ben and Cy talk first, then Ana replies, naming Cy and Di.
    const ben = new CommentClient({ file: "f", users: users("ben"), store });
    const thread = ben.createThread("First", { at: "1" });
    await ben.ready;
    const cyClient = new CommentClient({ file: "f", users: users("cy"), store });
    await cyClient.ready;
    cyClient.reply(thread.id, "Second");
    const seen: CommentNotice[] = [];
    const ana = new CommentClient({ file: "f", users: users("ana"), store, onNotify: (n) => void seen.push(n) });
    await ana.ready;
    ana.reply(thread.id, "Hi @Cy and @Di", ["cy", "di"]);
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe("comment.replied");
    // Cy is named and also took part: told once, as a mention. Ben only took part.
    expect(ids(seen[0]!).sort()).toEqual(["ben:participant", "cy:mention", "di:mention"]);
  });

  it("tells only the people an edit names for the first time", async () => {
    const seen: CommentNotice[] = [];
    const client = new CommentClient({ file: "f", users: users(), onNotify: (n) => void seen.push(n) });
    const thread = client.createThread("Hi @Ben", { at: "1" }, undefined, ["ben"]);
    await settle();
    seen.length = 0;
    client.editComment(thread.id, thread.comments[0]!.id, "Hi @Ben and @Cy", ["ben", "cy"]);
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe("comment.edited");
    expect(ids(seen[0]!)).toEqual(["cy:mention"]);
    // A second edit that adds no one tells no one.
    seen.length = 0;
    client.editComment(thread.id, thread.comments[0]!.id, "Hi @Ben and @Cy!", ["ben", "cy"]);
    await settle();
    expect(seen[0]!.recipients).toEqual([]);
  });

  it("tells the people in a thread when it is resolved and reopened", async () => {
    const store = memoryCommentStore<{ at: string }>();
    const ben = new CommentClient({ file: "f", users: users("ben"), store });
    const thread = ben.createThread("Question", { at: "1" });
    await ben.ready;
    const seen: CommentNotice[] = [];
    const ana = new CommentClient({ file: "f", users: users("ana"), store, onNotify: (n) => void seen.push(n) });
    await ana.ready;
    ana.reply(thread.id, "Answer");
    ana.resolve(thread.id);
    ana.reopen(thread.id);
    await settle();
    const resolved = seen.find((n) => n.type === "thread.resolved")!;
    expect(ids(resolved)).toEqual(["ben:participant"]);
    expect(resolved.comment).toBeUndefined();
    expect(seen.find((n) => n.type === "thread.reopened")).toBeTruthy();
  });

  it("waits for the store to keep the change, and says nothing when it refuses", async () => {
    let allow = false;
    const store: CommentStore<{ at: string }> = {
      load: () => [],
      save: async () => {
        await settle();
        if (!allow) throw new Error("no");
      },
    };
    const seen: CommentNotice[] = [];
    const errors: unknown[] = [];
    const client = new CommentClient({ file: "f", users: users(), store, onNotify: (n) => void seen.push(n), onError: (e) => void errors.push(e) });
    await client.ready;
    client.createThread("Hi @Ben", { at: "1" }, undefined, ["ben"]);
    expect(seen).toHaveLength(0); // not yet kept
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toHaveLength(1);
    expect(seen).toHaveLength(0); // refused: nobody is told about a comment that does not exist
    allow = true;
    client.createThread("Hi @Ben again", { at: "2" }, undefined, ["ben"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1);
  });

  it("is not called for other people's comments", async () => {
    const store = memoryCommentStore<{ at: string }>();
    const seen: CommentNotice[] = [];
    const ana = new CommentClient({ file: "f", users: users("ana"), store, onNotify: (n) => void seen.push(n) });
    await ana.ready;
    // What another client made arrives as a remote change.
    ana.receive({ type: "thread.create", thread: { id: "th", anchor: { at: "1" }, comments: [{ id: "c", author: "ben", body: "Hi @Ana", createdAt: 1, mentions: ["ana"] }], createdAt: 1 } });
    await settle();
    expect(seen).toHaveLength(0);
  });

  it("does not break commenting when the handler throws, and does not hide the error", async () => {
    vi.useFakeTimers();
    const client = new CommentClient({
      file: "f",
      users: users(),
      onNotify: () => {
        throw new Error("mail is down");
      },
    });
    expect(() => client.createThread("Hi", { at: "1" })).not.toThrow();
    expect(client.threads).toHaveLength(1);
    expect(() => vi.runAllTimers()).toThrow("mail is down");
  });

  it("stops when disposed, and can be attached on its own", async () => {
    const a: CommentNotice[] = [];
    const b: CommentNotice[] = [];
    const client = new CommentClient({ file: "f", users: users(), onNotify: (n) => void a.push(n) });
    const stop = commentNotices(client, (n) => void b.push(n));
    client.createThread("One", { at: "1" });
    await settle();
    expect([a.length, b.length]).toEqual([1, 1]);
    stop();
    client.createThread("Two", { at: "2" });
    await settle();
    expect([a.length, b.length]).toEqual([2, 1]);
    client.dispose();
    client.createThread("Three", { at: "3" });
    await settle();
    expect(a.length).toBe(2);
  });
});

describe("Users: the app's own hooks", () => {
  it("tells search which file the mention is typed in", async () => {
    const search = vi.fn(() => PEOPLE);
    const u = new Users({ current: PEOPLE[0]!, search });
    await u.search("b", { file: "doc-1" });
    expect(search).toHaveBeenCalledWith("b", { file: "doc-1" });
  });

  it("passes a click on a person to the app, and says whether it handles one", () => {
    const open = vi.fn();
    const handled = new Users({ current: PEOPLE[0]!, open });
    expect(handled.canOpen).toBe(true);
    handled.open(PEOPLE[1]!);
    expect(open).toHaveBeenCalledWith(PEOPLE[1]);
    expect(new Users(PEOPLE[0]!).canOpen).toBe(false);
  });
});
