// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CollabRoom, Users, memoryHub } from "@pli.dev/core";
import { DeckSession, type DeckAnchor } from "@pli.dev/decks";
import { PliDeck } from "../src";
import { Net, rig } from "../../decks/test/sync-net";
import { byLabel, click, key, menuItem, newSession, pointer, q, qa, render, run, runAsync, sampleDeck, setValue, useHost } from "./harness";

useHost();

const wait = (ms = 5) => runAsync(() => new Promise((r) => setTimeout(r, ms)));
const openMenu = (name: string) => click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name));

function person(id: string, name = `User ${id}`) {
  return new Users({ id, name });
}

describe("comments in the editor", () => {
  it("starts a comment from Insert > Comment, shows its bubble, the thumbnail's count and the panel", async () => {
    const s = newSession();
    const users = person("a");
    render(<PliDeck session={s} users={users} comments />);
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 150);
    pointer(window, "pointerup");
    openMenu("Insert");
    click(menuItem("Comment"));
    expect(q(".pli-deck-comments-panel")).toBeTruthy();
    expect(q(".pli-deck-comment-target").textContent).toContain("selected object");
    const box = q<HTMLTextAreaElement>(".pli-deck-comment-draft textarea");
    setValue(box, "Is this the right title?");
    click([...document.querySelectorAll<HTMLElement>(".pli-deck-comment-draft button")].find((b) => b.textContent === "Comment"));
    await wait();
    expect(s.comments.client!.threads).toHaveLength(1);
    expect(s.comments.client!.threads[0]!.anchor).toMatchObject({ slide: s.deck.slides[0]!.id, element: expect.any(String) });
    expect(qa(".pli-deck-pin")).toHaveLength(1);
    expect(q(".pli-deck-film-comments").textContent).toBe("1");
    expect(q(".pli-deck-thread-list").textContent).toContain("Is this the right title?");
    // resolving it hides the bubble; the Resolved filter lists it
    click([...document.querySelectorAll<HTMLElement>(".pli-thread-actions button")].find((b) => b.textContent === "Resolve"));
    await wait();
    expect(q(".pli-deck-pin").hasAttribute("data-resolved")).toBe(true);
    click([...document.querySelectorAll<HTMLElement>(".pli-deck-comment-filters button")].find((b) => b.textContent === "Resolved"));
    expect(q(".pli-deck-thread-list").textContent).toContain("Is this the right title?");
  });

  it("opens the panel with Ctrl+Alt+M and lists the threads of other slides under All", async () => {
    const s = newSession();
    render(<PliDeck session={s} users={person("a")} comments />);
    const client = s.comments.client!;
    run(() => s.comments.commentOnSlide(s.deck.slides[1]!.id, "Second slide thing"));
    await wait();
    key(q(".pli-deck-stage"), "m", { ctrlKey: true, altKey: true, code: "KeyM" });
    expect(q(".pli-deck-comments-panel")).toBeTruthy();
    expect(q(".pli-deck-comment-target").textContent).toBe("On slide 1");
    expect(q(".pli-deck-thread-list").textContent).toBe("");
    click([...document.querySelectorAll<HTMLElement>(".pli-deck-comment-filters button")].find((b) => b.textContent === "All"));
    expect(q(".pli-deck-thread-list").textContent).toContain("Second slide thing");
    expect(q(".pli-deck-thread-where").textContent).toBe("Slide 2");
    expect(client.threads).toHaveLength(1);
  });

  it("shows a thread whose slide was deleted as an orphan", async () => {
    const s = newSession();
    render(<PliDeck session={s} users={person("a")} comments />);
    const doomed = s.deck.slides[2]!.id;
    run(() => s.comments.commentOnSlide(doomed, "About the last slide"));
    await wait();
    run(() => s.deleteSlides([doomed]));
    await wait();
    key(q(".pli-deck-stage"), "m", { ctrlKey: true, altKey: true, code: "KeyM" });
    click([...document.querySelectorAll<HTMLElement>(".pli-deck-comment-filters button")].find((b) => b.textContent === "All"));
    expect(q(".pli-deck-thread-list").textContent).toContain("The slide was deleted");
    expect(q(".pli-deck-thread-where").textContent).toBe("Deleted slide");
  });
});

describe("people in the editor", () => {
  it("shows who is here, who is on which slide, their selection with a name tag, and a presenter to follow", async () => {
    const hub = memoryHub();
    const deck = sampleDeck();
    const mine = newSession(JSON.parse(JSON.stringify(deck)));
    const theirs = new DeckSession(JSON.parse(JSON.stringify(deck)));
    const me = person("me", "Me Myself");
    const other = person("ada", "Ada Lovelace");
    const myRoom = new CollabRoom<DeckAnchor>({ room: "d", transport: hub.transport(), users: me });
    const hers = new CollabRoom<DeckAnchor>({ room: "d", transport: hub.transport(), users: other });
    render(<PliDeck session={mine} room={myRoom} users={me} />);
    await wait();
    await hers.connect();
    const slide2 = deck.slides[1]!;
    hers.setPresence({ slide: slide2.id, selection: [slide2.elements[0]!.id], caret: null, present: null });
    await wait(20);
    expect(qa(".pli-presence .pli-avatar")).toHaveLength(1);
    expect(q(".pli-presence .pli-avatar").getAttribute("aria-label")).toBe("Ada Lovelace");
    expect(qa(".pli-deck-film-item")[1]!.querySelector(".pli-deck-film-dot")).toBeTruthy();
    expect(qa(".pli-deck-film-item")[0]!.querySelector(".pli-deck-film-dot")).toBeFalsy();
    // go to her slide: her selection is outlined with her name
    pointer(qa(".pli-deck-film-item")[1]!, "pointerdown", 5, 5);
    pointer(window, "pointerup");
    expect(q(".pli-deck-remote-sel .pli-deck-remote-tag").textContent).toBe("Ada Lovelace");
    // she starts a slideshow
    hers.setPresence({ slide: slide2.id, selection: [], caret: null, present: { slide: deck.slides[2]!.id, step: 0 } });
    await wait(20);
    expect(q(".pli-deck-follow-banner").textContent).toContain("Ada Lovelace is presenting");
    click([...document.querySelectorAll<HTMLElement>(".pli-deck-follow-banner button")].find((b) => b.textContent === "Follow"));
    expect(q(".pli-deck-present")).toBeTruthy();
    // she moves on, and the show follows; when she stops, it ends
    hers.setPresence({ slide: slide2.id, selection: [], caret: null, present: { slide: deck.slides[0]!.id, step: 0 } });
    await wait(20);
    expect(q(".pli-deck-present").textContent).toContain("Hello world");
    hers.setPresence({ slide: slide2.id, selection: [], caret: null, present: null });
    await wait(20);
    expect(document.querySelector(".pli-deck-present")).toBeFalsy();
    hers.disconnect();
    myRoom.disconnect();
  });

  it("says what you are doing: the slide, the selected objects and, while presenting, the slide shown", async () => {
    const hub = memoryHub();
    const mine = newSession();
    const me = person("me");
    const room = new CollabRoom<DeckAnchor>({ room: "d", transport: hub.transport(), users: me });
    const watcher = new CollabRoom<DeckAnchor>({ room: "d", transport: hub.transport(), users: person("w") });
    await watcher.connect();
    render(<PliDeck session={mine} room={room} users={me} />);
    await wait(20);
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 150);
    pointer(window, "pointerup");
    await wait(20);
    const state = watcher.peers[0]!.state as { slide: string; selection: string[] };
    expect(state.slide).toBe(mine.deck.slides[0]!.id);
    expect(state.selection).toEqual([mine.deck.slides[0]!.elements[0]!.id]);
    watcher.disconnect();
    room.disconnect();
  });
});

describe("live editing in the editor", () => {
  it("shows the sync state and takes in another person's changes", async () => {
    const world = await rig(2, sampleDeck());
    const [a, b] = world.sessions as [DeckSession, DeckSession];
    // the editor takes the room a rig made, with its own sync client
    world.syncs[0]!.stop();
    render(<PliDeck session={a} room={world.rooms[0] as never} users={world.users[0]} sync />);
    await runAsync(() => world.net.settle());
    expect(byLabel("Synced") ?? document.querySelector("[data-status]")).toBeTruthy();
    run(() => b.setTitle("Edited elsewhere"));
    await runAsync(() => world.net.settle());
    expect((q(".pli-doc-title") as HTMLInputElement).value).toBe("Edited elsewhere");
    expect(a.deck.title).toBe("Edited elsewhere");
    void Net;
    world.syncs[1]!.stop();
  });
});
