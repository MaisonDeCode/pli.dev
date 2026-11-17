import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  CommentClient,
  DocumentSession,
  Users,
  commentIdsIn,
  commentRanges,
  commentsAt,
  createDoc,
  fragmentToJson,
  memoryCommentStore,
  paragraph,
  parseDoc,
  plainText,
  serializeDoc,
  stripComments,
  toDocx,
  validateDoc,
  PliError,
  type CommentStore,
  type DocAnchor,
  type PliUser,
  type Run,
  type Selection,
  type Thread,
} from "../src";

const ana: PliUser = { id: "ana", name: "Ana" };
const ben: PliUser = { id: "ben", name: "Ben" };
const flush = () => new Promise((r) => setTimeout(r, 0));

function make(options: { user?: PliUser; store?: CommentStore<DocAnchor> | "document"; text?: string[] } = {}) {
  const doc = createDoc("T", (options.text ?? ["Alpha beta gamma", "Delta"]).map((t) => paragraph(t)));
  const session = new DocumentSession(doc, { comments: { users: new Users(options.user ?? ana), store: options.store } });
  const ids = session.state.blocks.map((b) => b.id);
  const select = (block: number, from: number, to: number, endBlock = block): Selection => ({
    anchor: { block: ids[block]!, offset: from },
    focus: { block: ids[endBlock]!, offset: to },
  });
  return { session, ids, select };
}

const runsOf = (s: DocumentSession, block: number) => (s.state.blocks[block] as unknown as { runs: Run[] }).runs;

describe("comment marks", () => {
  it("attaches a thread to the selected text, and starts the thread", () => {
    const { session, select } = make();
    session.select(select(0, 6, 10));
    const thread = session.comment("Why beta?")!;
    expect(thread.anchor).toMatchObject({ from: 6, to: 10, quote: "beta" });
    expect(runsOf(session, 0).map((r) => [r.text, r.marks?.comment])).toEqual([
      ["Alpha ", undefined],
      ["beta", [thread.id]],
      [" gamma", undefined],
    ]);
    expect(session.comments!.threads[0]!.comments[0]).toMatchObject({ author: "ana", body: "Why beta?" });
  });

  it("does nothing with no text selected", () => {
    const { session, select } = make();
    session.select(select(0, 3, 3));
    expect(session.comment("Hi")).toBeNull();
    expect(session.comments!.threads).toHaveLength(0);
  });

  it("covers text across paragraphs", () => {
    const { session, select, ids } = make();
    session.select(select(0, 11, 3, 1));
    const thread = session.comment("Both")!;
    expect(commentRanges(session.state, thread.id)).toEqual([
      { block: ids[0], from: 11, to: 16 },
      { block: ids[1], from: 0, to: 3 },
    ]);
  });

  it("lets threads overlap, and reports every one at a caret", () => {
    const { session, select } = make();
    session.select(select(0, 0, 10));
    const a = session.comment("A")!;
    session.select(select(0, 6, 16));
    const b = session.comment("B")!;
    expect(commentsAt(session.state, select(0, 7, 7)).sort()).toEqual([a.id, b.id].sort());
    expect(commentsAt(session.state, select(0, 2, 2))).toEqual([a.id]);
    expect(commentsAt(session.state, select(1, 2, 2))).toEqual([]);
    // The caret at the far edge of text still reaches it, but not the text past it.
    expect(commentsAt(session.state, select(0, 10, 10)).sort()).toEqual([a.id, b.id].sort());
    expect(commentsAt(session.state, select(0, 16, 16))).toEqual([b.id]);
  });

  it("undoes as one step", () => {
    const { session, select } = make();
    session.select(select(0, 6, 10));
    session.comment("Hi");
    session.undo();
    expect(commentIdsIn(session.state.blocks).size).toBe(0);
    session.redo();
    expect(commentIdsIn(session.state.blocks).size).toBe(1);
  });

  it("keeps the mark on the right text when text before it changes", () => {
    const { session, select, ids } = make();
    session.select(select(0, 6, 10));
    const thread = session.comment("Hi")!;
    session.insertText(ids[0]!, 0, "Well, ");
    expect(commentRanges(session.state, thread.id)).toEqual([{ block: ids[0], from: 12, to: 16 }]);
  });

  it("joins runs again once a thread is gone", async () => {
    const { session, select } = make();
    session.select(select(0, 6, 10));
    const thread = session.comment("Hi")!;
    session.comments!.deleteThread(thread.id);
    await flush();
    expect(runsOf(session, 0)).toEqual([{ text: "Alpha beta gamma" }]);
    expect(session.comments!.threads).toEqual([]);
  });

  it("doesn't bring back a deleted thread's highlight when undoing another comment", async () => {
    const { session, select } = make();
    session.select(select(0, 0, 5));
    const a = session.comment("A")!;
    session.select(select(0, 6, 10));
    const b = session.comment("B")!;
    session.comments!.deleteThread(a.id);
    expect(commentIdsIn(session.state.blocks)).toEqual(new Set([b.id]));
    session.undo(); // takes back b's highlight, not a's deletion
    expect(commentIdsIn(session.state.blocks).size).toBe(0);
  });

  it("drops the highlight when a paste copies commented text", () => {
    const { session, select } = make();
    session.select(select(0, 6, 10));
    session.comment("Hi");
    const copied = stripComments(session.state.blocks);
    expect(commentIdsIn(copied).size).toBe(0);
    expect(commentIdsIn(session.state.blocks).size).toBe(1);
    const json = fragmentToJson(session.state.blocks.slice(0, 1));
    session.select({ anchor: { block: session.state.blocks[1]!.id, offset: 0 }, focus: { block: session.state.blocks[1]!.id, offset: 0 } });
    session.paste({ fragment: json });
    expect([...commentIdsIn(session.state.blocks)]).toHaveLength(1);
    expect(plainText(runsOf(session, 1)).startsWith("Alpha beta gamma")).toBe(true);
    expect(runsOf(session, 1).some((r) => r.marks?.comment)).toBe(false);
  });
});

describe("where comments are kept", () => {
  it("saves threads in the document by default, and they come back with it", async () => {
    const { session, select } = make();
    session.select(select(0, 6, 10));
    const thread = session.comment("Why?")!;
    session.comments!.reply(thread.id, "Because");
    await flush();
    expect(Object.keys(session.state.comments!)).toEqual([thread.id]);
    const reopened = new DocumentSession(parseDoc(serializeDoc(session.state)), { comments: { users: new Users(ben) } });
    expect(reopened.comments!.threads[0]!.comments.map((c) => c.body)).toEqual(["Why?", "Because"]);
    expect(reopened.comments!.threads[0]!.comments[1]!.author).toBe("ana");
    expect(commentRanges(reopened.state, thread.id)).toHaveLength(1);
  });

  it("doesn't undo a comment's text when undoing typing", async () => {
    const { session, select } = make();
    session.select(select(0, 6, 10));
    const thread = session.comment("Why?")!;
    await flush();
    session.comments!.reply(thread.id, "Because");
    await flush();
    session.undo();
    expect(session.state.comments![thread.id]!.comments).toHaveLength(2);
  });

  it("keeps comments in a store of your own, and not in the document", async () => {
    const store = memoryCommentStore<DocAnchor>();
    const { session, select } = make({ store });
    await session.comments!.ready;
    session.select(select(0, 6, 10));
    const thread = session.comment("Why?")!;
    await flush();
    expect(session.state.comments).toBeUndefined();
    expect(store.threads(session.state.id)[0]!.id).toBe(thread.id);
  });

  it("restores a highlight the saved document doesn't have, from the thread's anchor", async () => {
    const doc = createDoc("T", [paragraph("Alpha beta gamma")]);
    const block = doc.blocks[0]!.id;
    const thread: Thread<DocAnchor> = {
      id: "th_x",
      createdAt: 1,
      anchor: { block, from: 6, to: 10, quote: "beta" },
      comments: [{ id: "c1", author: "ben", body: "Hmm", createdAt: 1 }],
    };
    const session = new DocumentSession(doc, { comments: { users: new Users(ana), store: memoryCommentStore({ [doc.id]: [thread] }) } });
    await session.comments!.ready;
    await flush();
    expect(commentRanges(session.state, "th_x")).toEqual([{ block, from: 6, to: 10 }]);
  });

  it("finds the quote when the text has moved, and leaves a thread whose text is gone", async () => {
    const doc = createDoc("T", [paragraph("Well, alpha beta gamma"), paragraph("Nothing here")]);
    const [first, second] = doc.blocks.map((b) => b.id);
    const moved: Thread<DocAnchor> = { id: "m", createdAt: 1, anchor: { block: first!, from: 6, to: 10, quote: "beta" }, comments: [{ id: "c", author: "ben", body: "x", createdAt: 1 }] };
    const gone: Thread<DocAnchor> = { id: "g", createdAt: 2, anchor: { block: second!, from: 0, to: 4, quote: "beta" }, comments: [{ id: "d", author: "ben", body: "y", createdAt: 2 }] };
    const session = new DocumentSession(doc, { comments: { users: new Users(ana), store: memoryCommentStore({ [doc.id]: [moved, gone] }) } });
    await session.comments!.ready;
    await flush();
    expect(commentRanges(session.state, "m")).toEqual([{ block: first, from: 12, to: 16 }]);
    expect(commentRanges(session.state, "g")).toEqual([]);
    expect(session.comments!.threads).toHaveLength(2);
  });

  it("shows a comment from someone else, with its highlight, when it arrives", async () => {
    const store = memoryCommentStore<DocAnchor>();
    const { session, ids } = make({ store });
    await session.comments!.ready;
    const thread: Thread<DocAnchor> = {
      id: "th_remote",
      createdAt: 1,
      anchor: { block: ids[0]!, from: 0, to: 5, quote: "Alpha" },
      comments: [{ id: "c", author: "ben", body: "Nice", createdAt: 1 }],
    };
    session.comments!.receive({ type: "thread.create", thread });
    expect(commentRanges(session.state, "th_remote")).toEqual([{ block: ids[0], from: 0, to: 5 }]);
    session.comments!.receive({ type: "thread.delete", threadId: "th_remote" });
    expect(commentRanges(session.state, "th_remote")).toEqual([]);
  });

  it("takes back the highlight when the store refuses the thread", async () => {
    const errors: PliError[] = [];
    const store: CommentStore<DocAnchor> = { load: () => [], save: async () => { throw new Error("down"); } };
    const doc = createDoc("T", [paragraph("Alpha beta gamma")]);
    const session = new DocumentSession(doc, { comments: { users: new Users(ana), store, onError: (e) => errors.push(e) } });
    await session.comments!.ready;
    const block = doc.blocks[0]!.id;
    session.select({ anchor: { block, offset: 0 }, focus: { block, offset: 5 } });
    session.comment("Hi");
    expect(commentIdsIn(session.state.blocks).size).toBe(1);
    await flush();
    await flush();
    expect(commentIdsIn(session.state.blocks).size).toBe(0);
    expect(errors[0]!.code).toBe("storage");
  });

  it("refuses to comment for a viewer or for no one, without touching the document", () => {
    const viewer = new DocumentSession(createDoc("T", [paragraph("Alpha")]), { comments: { users: new Users({ current: ana, role: "viewer" }) } });
    const block = viewer.state.blocks[0]!.id;
    viewer.select({ anchor: { block, offset: 0 }, focus: { block, offset: 3 } });
    expect(() => viewer.comment("Hi")).toThrow(PliError);
    expect(commentIdsIn(viewer.state.blocks).size).toBe(0);
    const plain = new DocumentSession(createDoc("T", [paragraph("Alpha")]));
    expect(plain.comments).toBeNull();
    expect(() => plain.comment("Hi")).toThrow(/aren't turned on/);
  });
});

describe("saving", () => {
  it("validates comment marks and saved threads", async () => {
    const { session, select } = make();
    session.select(select(0, 6, 10));
    session.comment("Hi");
    await flush();
    const good = JSON.parse(JSON.stringify(session.state));
    expect(() => validateDoc(good)).not.toThrow();
    const badMark = JSON.parse(JSON.stringify(good));
    badMark.blocks[0].runs[1].marks.comment = "th_1";
    expect(() => validateDoc(badMark)).toThrow(/list of thread ids/);
    const badThread = JSON.parse(JSON.stringify(good));
    badThread.comments[Object.keys(badThread.comments)[0]!].comments[0].body = 5;
    expect(() => validateDoc(badThread)).toThrow(/expected a string/);
    const badKey = JSON.parse(JSON.stringify(good));
    badKey.comments.other = badKey.comments[Object.keys(badKey.comments)[0]!];
    expect(() => validateDoc(badKey)).toThrow(/must match its key/);
  });

  it("keeps threads whose text has gone", async () => {
    const { session, select, ids } = make();
    session.select(select(0, 6, 10));
    const thread = session.comment("Hi")!;
    await flush();
    session.transact([{ type: "delete_text", block: ids[0]!, from: 6, to: 10 }]);
    const again = parseDoc(serializeDoc(session.state));
    expect(again.comments![thread.id]).toBeDefined();
  });
});

describe("Word export", () => {
  async function commented() {
    const { session, select } = make({ text: ["Alpha beta gamma", "Delta epsilon"] });
    session.select(select(0, 6, 10));
    const thread = session.comment("Why <beta>?\nSecond line")!;
    session.comments!.reply(thread.id, "Because");
    session.select(select(0, 11, 5, 1));
    const across = session.comment("Across")!;
    session.comments!.resolve(across.id);
    await flush();
    return { session, thread, across };
  }
  const files = (doc: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(doc)).map(([k, v]) => [k, strFromU8(v)]));

  it("writes comments with their ranges, replies and resolved state", async () => {
    const { session } = await commented();
    const zip = files(toDocx(session.state, { authorName: (id) => (id === "ana" ? "Ana Reyes" : id) }));
    const body = zip["word/document.xml"]!;
    // Three comments (two in the first thread), each with a start, an end and a reference, in the right place.
    expect(body.match(/<w:commentRangeStart/g)).toHaveLength(3);
    expect(body.match(/<w:commentRangeEnd/g)).toHaveLength(3);
    expect(body.match(/<w:commentReference/g)).toHaveLength(3);
    expect(body).toContain('<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/><w:r><w:t xml:space="preserve">beta</w:t></w:r><w:commentRangeEnd w:id="0"/>');
    const comments = zip["word/comments.xml"]!;
    expect(comments).toContain('w:author="Ana Reyes"');
    expect(comments).toContain('w:initials="AR"');
    expect(comments).toContain("Why &lt;beta&gt;?");
    expect(comments).toContain("Second line");
    const ext = zip["word/commentsExtended.xml"]!;
    expect(ext.match(/paraIdParent/g)).toHaveLength(1);
    expect(ext.match(/w15:done="1"/g)).toHaveLength(1);
    expect(zip["[Content_Types].xml"]).toContain("/word/comments.xml");
    expect(zip["word/_rels/document.xml.rels"]).toContain("comments.xml");
  });

  it("writes a thread across paragraphs as one range", async () => {
    const { session } = await commented();
    const body = files(toDocx(session.state))["word/document.xml"]!;
    const start = body.indexOf('<w:commentRangeStart w:id="2"/>');
    const end = body.indexOf('<w:commentRangeEnd w:id="2"/>');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(body.slice(start, end)).toContain("</w:p><w:p>");
  });

  it("takes threads from the options, and leaves out one whose text is gone", async () => {
    const { session, thread } = await commented();
    const store = session.comments!.threads;
    const only = toDocx(session.state, { comments: store.filter((t) => t.id === thread.id) });
    expect(files(only)["word/comments.xml"]!.match(/<w:comment /g)).toHaveLength(2);
    session.transact([{ type: "delete_text", block: session.state.blocks[0]!.id, from: 6, to: 10 }]);
    const after = files(toDocx(session.state, { comments: store }));
    expect(after["word/comments.xml"]!.match(/<w:comment /g)).toHaveLength(1);
  });

  it("writes no comment parts when there are none", () => {
    const zip = files(toDocx(createDoc("T", [paragraph("Hi")])));
    expect(zip["word/comments.xml"]).toBeUndefined();
    expect(zip["word/document.xml"]).not.toContain("comment");
  });
});

describe("comments in a shared document", () => {
  function shared() {
    const doc = createDoc("T", [paragraph("Alpha beta gamma")]);
    const session = new DocumentSession(doc, { comments: { users: new Users(ana), store: memoryCommentStore<DocAnchor>(), synced: true } });
    const block = doc.blocks[0]!.id;
    return { session, block };
  }

  it("doesn't put a highlight back by itself when a thread arrives: the highlight is a change that arrives with it", async () => {
    const { session, block } = shared();
    await session.comments!.ready;
    const thread: Thread<DocAnchor> = { id: "th_x", createdAt: 1, anchor: { block, from: 0, to: 5, quote: "Alpha" }, comments: [{ id: "c", author: "ben", body: "Hi", createdAt: 1 }] };
    session.comments!.receive({ type: "thread.create", thread });
    expect(commentRanges(session.state, "th_x")).toEqual([]);
    expect(session.comments!.threads).toHaveLength(1);
  });

  it("takes the highlight off as a change that is sent, and not an undo step, when you delete a thread", async () => {
    const { session, block } = shared();
    await session.comments!.ready;
    session.select({ anchor: { block, offset: 0 }, focus: { block, offset: 5 } });
    const thread = session.comment("Hi")!;
    const origins: string[] = [];
    session.subscribe((e) => void origins.push(`${e.origin}:${e.ops.map((o) => o.type).join(",")}`));
    session.comments!.deleteThread(thread.id);
    expect(commentRanges(session.state, thread.id)).toEqual([]);
    expect(origins).toEqual(["local:comment_text"]);
    // The undo step is still the comment's own, so undoing takes back the highlight it added, not the deletion.
    session.undo();
    expect(commentIdsIn(session.state.blocks).size).toBe(0);
  });

  it("leaves the highlight to the person who deleted the thread when it is deleted somewhere else", async () => {
    const { session, block } = shared();
    await session.comments!.ready;
    session.select({ anchor: { block, offset: 0 }, focus: { block, offset: 5 } });
    const thread = session.comment("Hi")!;
    session.comments!.receive({ type: "thread.delete", threadId: thread.id });
    // That person's change takes the highlight off for everyone; it isn't done twice.
    expect(commentRanges(session.state, thread.id)).toHaveLength(1);
  });
});
