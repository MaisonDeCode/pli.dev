import { describe, expect, it } from "vitest";
import { CollabRoom, Users, memoryCommentStore, memoryHub } from "@pli.dev/core";
import { DeckSession, createDeck, paragraphsFromText, plainText, type DeckAnchor, type ShapeElement } from "../src";
import { rig } from "./sync-net";
import { startDeck } from "./fuzz-helpers";

const tick = () => new Promise((r) => setTimeout(r, 5));
const users = (id = "u1", role?: "viewer" | "commenter" | "editor") => new Users({ id, name: `User ${id}`, ...(role ? {} : {}) } as never);

function session() {
  const s = new DeckSession(createDeck());
  const slide = s.deck.slides[0]!.id;
  const title = s.deck.slides[0]!.elements[0]!.id;
  s.setText(slide, title, paragraphsFromText("Annual plan for next year"));
  const client = s.comments.enable({ users: users() });
  return { s, slide, title, client };
}

const textOf = (s: DeckSession, slide: string, id: string) => plainText((s.element(slide, id) as ShapeElement).text!.paragraphs);

describe("comments on a deck", () => {
  it("starts threads on a slide, an element and some words, with replies and resolving", async () => {
    const { s, slide, title, client } = session();
    const a = s.comments.commentOnSlide(slide, "Check this slide", { x: 10, y: 20 });
    const b = s.comments.commentOnElement(slide, title, "Rename?");
    const c = s.comments.commentOnText(slide, title, { from: { p: 0, o: 7 }, to: { p: 0, o: 11 } }, "Which plan?");
    expect(client.threads.map((t) => t.id)).toEqual([a.id, b.id, c.id]);
    expect(a.anchor).toEqual({ slide, point: { x: 10, y: 20 } });
    expect(b.anchor).toMatchObject({ slide, element: title, quote: "Annual plan for next year" });
    expect(c.anchor).toMatchObject({ slide, element: title, text: { from: 7, to: 11 }, quote: "plan" });
    client.reply(c.id, "This one");
    client.resolve(c.id);
    await tick();
    expect(s.deck.comments![c.id]!.comments).toHaveLength(2);
    expect(s.deck.comments![c.id]!.resolved).toBeTruthy();
    client.reopen(c.id);
    await tick();
    expect(s.deck.comments![c.id]!.resolved).toBeUndefined();
    // the words are marked, and the marks are not an undo step
    expect(s.comments.anchorState(client.thread(c.id)!).text).toEqual({ from: 7, to: 11 });
    // only the text typed before the comments is an undo step: commenting is not
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.canUndo).toBe(false);
    expect(s.deck.comments![c.id]).toBeTruthy();
  });

  it("is turned on or an error", () => {
    const s = new DeckSession(createDeck());
    expect(() => s.comments.commentOnSlide(s.deck.slides[0]!.id, "hi")).toThrow(/aren't turned on/);
  });

  it("keeps a thread's place when slides are reordered and duplicated, and when elements move", () => {
    const { s, slide, title, client } = session();
    const second = s.addSlide();
    const t = s.comments.commentOnText(slide, title, { from: { p: 0, o: 0 }, to: { p: 0, o: 6 } }, "Annual?");
    s.moveSlides([slide], 1);
    expect(s.deck.slides.map((x) => x.id)).toEqual([second.id, slide]);
    s.moveBy(slide, [title], 30, 40);
    s.setFrame(slide, title, { w: 123 });
    const state = s.comments.anchorState(client.thread(t.id)!);
    expect(state).toMatchObject({ slide, element: title, orphan: null, text: { from: 0, to: 6 } });
    // a copy of the slide doesn't copy the thread's highlight
    const [copy] = s.duplicateSlides([slide]);
    const copied = JSON.stringify(copy!.elements);
    expect(copied).not.toContain(t.id);
    expect(JSON.stringify(s.slide(slide).elements)).toContain(t.id);
    expect(s.comments.threadsOn(slide).map((x) => x.id)).toEqual([t.id]);
    expect(s.comments.threadsOn(copy!.id)).toEqual([]);
  });

  it("follows the words while people edit around them", () => {
    const { s, slide, title, client } = session();
    const t = s.comments.commentOnText(slide, title, { from: { p: 0, o: 7 }, to: { p: 0, o: 11 } }, "Which plan?");
    const el = s.element(slide, title) as ShapeElement;
    s.setText(slide, title, [{ runs: [{ text: "THE " }, ...el.text!.paragraphs[0]!.runs] }]);
    expect(textOf(s, slide, title)).toBe("THE Annual plan for next year");
    expect(s.comments.anchorState(client.thread(t.id)!).text).toEqual({ from: 11, to: 15 });
  });

  it("makes an orphan of a thread whose element, words or slide went, and brings it back on undo", () => {
    const { s, slide, title, client } = session();
    const second = s.addSlide();
    const onEl = s.comments.commentOnElement(slide, title, "About the title");
    const onText = s.comments.commentOnText(slide, title, { from: { p: 0, o: 7 }, to: { p: 0, o: 11 } }, "plan");
    const onSecond = s.comments.commentOnSlide(second.id, "Second");
    // the words are deleted but the element stays
    s.setText(slide, title, paragraphsFromText("Annual for next year"));
    expect(s.comments.anchorState(client.thread(onText.id)!)).toMatchObject({ element: title, text: null, orphan: "text" });
    expect(s.comments.anchorState(client.thread(onEl.id)!).orphan).toBeNull();
    s.deleteElements(slide, [title]);
    expect(s.comments.anchorState(client.thread(onEl.id)!)).toMatchObject({ slide, element: null, orphan: "element" });
    expect(s.comments.threadsOn(slide).map((t) => t.id)).toContain(onEl.id);
    s.deleteSlides([second.id]);
    expect(s.comments.anchorState(client.thread(onSecond.id)!).orphan).toBe("slide");
    expect(s.comments.orphans().map((t) => t.id)).toEqual([onSecond.id]);
    s.undo();
    expect(s.comments.anchorState(client.thread(onSecond.id)!).orphan).toBeNull();
  });

  it("takes the highlight off when its thread is deleted", async () => {
    const { s, slide, title, client } = session();
    const t = s.comments.commentOnText(slide, title, { from: { p: 0, o: 0 }, to: { p: 0, o: 6 } }, "x");
    expect(JSON.stringify(s.slide(slide))).toContain(t.id);
    client.deleteThread(t.id);
    await tick();
    expect(JSON.stringify(s.slide(slide))).not.toContain(`"comment":["${t.id}"`);
    expect(s.deck.comments).toBeUndefined();
  });

  it("follows the permissions of the users", () => {
    const s = new DeckSession(createDeck());
    const viewer = new Users({ id: "v", name: "Viewer", role: "viewer" } as never);
    const client = s.comments.enable({ users: viewer, permissions: (action) => (action === "comment" ? false : undefined) });
    expect(client.can("comment")).toBe(false);
    expect(() => s.comments.commentOnSlide(s.deck.slides[0]!.id, "no")).toThrow(/Not allowed/);
  });

  it("keeps threads in a store of your own when asked", async () => {
    const store = memoryCommentStore<DeckAnchor>();
    const s = new DeckSession(createDeck());
    const client = s.comments.enable({ users: users(), store });
    const t = s.comments.commentOnSlide(s.deck.slides[0]!.id, "In my database");
    await client.ready;
    await new Promise((r) => setTimeout(r, 0));
    expect(store.threads(s.deck.id).map((x) => x.id)).toEqual([t.id]);
    expect(s.deck.comments).toBeUndefined();
  });

  it("shares threads between people through a room, without sync", async () => {
    const hub = memoryHub();
    const a = new DeckSession(createDeck());
    const b = new DeckSession(createDeck());
    b.load({ ...a.deck });
    const ua = users("a");
    const ub = users("b");
    const ca = a.comments.enable({ users: ua });
    const cb = b.comments.enable({ users: ub });
    const ra = new CollabRoom<DeckAnchor>({ room: "r", transport: hub.transport(), users: ua, comments: ca });
    const rb = new CollabRoom<DeckAnchor>({ room: "r", transport: hub.transport(), users: ub, comments: cb });
    await ra.connect();
    await rb.connect();
    const t = a.comments.commentOnSlide(a.deck.slides[0]!.id, "Hello from a");
    await tick();
    cb.reply(t.id, "Hello from b");
    await tick();
    expect(cb.threads.map((x) => x.id)).toEqual([t.id]);
    expect(ca.thread(t.id)!.comments.map((c) => c.body)).toEqual(["Hello from a", "Hello from b"]);
    // each deck holds both comments too
    expect(a.deck.comments![t.id]!.comments).toHaveLength(2);
    expect(b.deck.comments![t.id]!.comments).toHaveLength(2);
  });

  it("travels with live editing: replies from two people merge, and the panel's client hears them", async () => {
    const world = await rig(2, startDeck());
    const [a, b] = world.sessions as [DeckSession, DeckSession];
    const ca = a.comments.enable({ users: world.users[0]! });
    const cb = b.comments.enable({ users: world.users[1]! });
    const t = a.comments.commentOnElement("s0", "e1", "Is this right?");
    await world.net.settle();
    expect(cb.threads.map((x) => x.id)).toEqual([t.id]);
    ca.reply(t.id, "from a");
    cb.reply(t.id, "from b");
    cb.resolve(t.id);
    await world.net.settle();
    for (const s of [a, b]) expect(s.deck.comments![t.id]!.comments.map((c) => c.body).sort()).toEqual(["Is this right?", "from a", "from b"]);
    expect(ca.thread(t.id)!.comments).toHaveLength(3);
    expect(ca.thread(t.id)!.resolved).toBeTruthy();
    world.dispose();
  });
});
