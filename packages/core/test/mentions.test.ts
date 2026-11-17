import { describe, expect, it } from "vitest";
import { CommentClient, Users, activeMention, insertMention, memoryCommentStore, mentionsIn, splitMentions, type PliUser } from "../src";

const ben: PliUser = { id: "ben", name: "Ben Ito" };
const cleo: PliUser = { id: "cleo", name: "Cleo Park" };
const bo: PliUser = { id: "bo", name: "Ben" };
const me: PliUser = { id: "me", name: "Alex Morgan" };

describe("finding mentions", () => {
  it("finds the people named with @", () => {
    expect(mentionsIn("Can @Cleo Park and @Ben Ito look?", [ben, cleo])).toEqual(["cleo", "ben"]);
  });

  it("lists people in the order they appear, once each", () => {
    expect(mentionsIn("@Cleo Park, @Ben Ito, @Cleo Park again", [ben, cleo])).toEqual(["cleo", "ben"]);
  });

  it("ignores a name without the @, a longer name, and an @ inside a word", () => {
    expect(mentionsIn("Ben Ito said so", [ben])).toEqual([]);
    expect(mentionsIn("@Ben Itoh said so", [ben])).toEqual([]);
    expect(mentionsIn("mail@Ben Ito", [ben])).toEqual([]);
  });

  it("is not thrown by case, punctuation or other scripts", () => {
    expect(mentionsIn("thanks @ben ito!", [ben])).toEqual(["ben"]);
    expect(mentionsIn("@Ben Ito, hi", [ben])).toEqual(["ben"]);
    expect(mentionsIn("cc @Zoë Ñu", [{ id: "z", name: "Zoë Ñu" }])).toEqual(["z"]);
  });

  it("forgets a person whose mention was deleted from the text", () => {
    expect(mentionsIn("Just @Cleo Park now", [ben, cleo])).toEqual(["cleo"]);
  });
});

describe("splitting a comment for display", () => {
  it("cuts the text around each mention", () => {
    expect(splitMentions("Hi @Ben Ito, see @Cleo Park.", [ben, cleo])).toEqual([
      { text: "Hi " },
      { mention: ben },
      { text: ", see " },
      { mention: cleo },
      { text: "." },
    ]);
  });

  it("prefers the longer name when one holds the other", () => {
    expect(splitMentions("@Ben Ito and @Ben", [bo, ben])).toEqual([{ mention: ben }, { text: " and " }, { mention: bo }]);
  });

  it("returns one piece when nobody is mentioned", () => {
    expect(splitMentions("plain", [ben])).toEqual([{ text: "plain" }]);
    expect(splitMentions("", [ben])).toEqual([]);
  });
});

describe("typing a mention", () => {
  it("sees an @ that starts a word", () => {
    expect(activeMention("Hello @be", 9)).toEqual({ start: 6, query: "be" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("Hello\n@Ben Ito", 14)).toEqual({ start: 6, query: "Ben Ito" });
  });

  it("ignores an @ inside a word, a line break after it, and a space right after it", () => {
    expect(activeMention("mail@be", 7)).toBeNull();
    expect(activeMention("@ben\nnext", 9)).toBeNull();
    expect(activeMention("@ x", 3)).toBeNull();
    expect(activeMention("no at sign", 5)).toBeNull();
  });

  it("uses the last @ before the caret and stops at the caret", () => {
    expect(activeMention("@Ben Ito and @Cl later", 16)).toEqual({ start: 13, query: "Cl" });
  });

  it("replaces the typed part with the whole name and a space", () => {
    const text = "Hi @be and more";
    const typing = activeMention(text, 6)!;
    expect(insertMention(text, typing, 6, ben)).toEqual({ text: "Hi @Ben Ito  and more", caret: 12 });
  });
});

describe("mentions in comments", () => {
  it("are kept with the comment, replies and edits", () => {
    const store = memoryCommentStore();
    const client = new CommentClient({ file: "f", users: new Users(me), store });
    const thread = client.createThread("@Ben Ito look", undefined, undefined, ["ben"]);
    expect(thread.comments[0]!.mentions).toEqual(["ben"]);
    const reply = client.reply(thread.id, "@Cleo Park too", ["cleo"]);
    expect(reply.mentions).toEqual(["cleo"]);
    client.editComment(thread.id, reply.id, "Never mind");
    expect(client.thread(thread.id)!.comments[1]).toMatchObject({ body: "Never mind" });
    expect(client.thread(thread.id)!.comments[1]!.mentions).toBeUndefined();
    client.editComment(thread.id, reply.id, "@Ben Ito again", ["ben"]);
    expect(client.thread(thread.id)!.comments[1]!.mentions).toEqual(["ben"]);
  });

  it("leave no empty list on a comment that mentions nobody", () => {
    const client = new CommentClient({ file: "f", users: new Users(me) });
    const thread = client.createThread("plain", undefined, undefined, []);
    expect("mentions" in thread.comments[0]!).toBe(false);
  });

  it("reach the store, so an app can notify the people mentioned", async () => {
    const seen: unknown[] = [];
    const store = { ...memoryCommentStore(), save: async (_file: string, change: unknown) => void seen.push(change) };
    const client = new CommentClient({ file: "f", users: new Users(me), store });
    client.createThread("@Ben Ito", undefined, "th_1", ["ben"]);
    await client.ready;
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.stringify(seen)).toContain('"mentions":["ben"]');
  });
});
