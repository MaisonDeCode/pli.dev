import { describe, expect, it } from "vitest";
import { memoryVersionStorage, Users } from "@pli.dev/core";
import { BUILTIN_THEMES, DeckSession, SIZE_WIDESCREEN, builtinTheme, createDeck, deckReducer, deckVersionHistory, paragraphsFromText, restoreDeckOps, summarizeDeckDiff, type Deck, type DeckOp } from "../src";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const apply = (deck: Deck, ops: readonly DeckOp[]): Deck => ops.reduce((d, op) => deckReducer.apply(d, op).state, deck);
/** Everything a restore brings back: the deck without its id, comments and the order of its masters. */
const content = (d: Deck) => {
  const { id: _id, comments: _c, ...rest } = clone(d);
  return { ...rest, masters: [...rest.masters].sort((a, b) => (a.id < b.id ? -1 : 1)) };
};

function fresh(): DeckSession {
  const s = new DeckSession(createDeck({ title: "Plan" }));
  const first = s.deck.slides[0]!;
  s.setText(first.id, first.elements[0]!.id, paragraphsFromText("Title"));
  for (const t of ["Two", "Three", "Four"]) {
    const sl = s.addSlide();
    s.setText(sl.id, sl.elements[0]!.id, paragraphsFromText(t));
  }
  s.addShape(s.deck.slides[1]!.id, "rect", { x: 10, y: 10, w: 50, h: 50 });
  s.addTextBox(s.deck.slides[1]!.id, {}, "note");
  s.setNotes(s.deck.slides[2]!.id, "speaker words", { merge: false });
  return s;
}

/** The deck before and after `change`, and what restoring turns the after back into. */
function roundTrip(change: (s: DeckSession) => void) {
  const s = fresh();
  const before = clone(s.deck);
  change(s);
  const after = clone(s.deck);
  const ops = restoreDeckOps(after, before);
  const restored = apply(after, ops);
  return { before, after, ops, restored };
}

describe("restoring a deck version", () => {
  const cases: [string, (s: DeckSession) => void][] = [
    ["nothing changed", () => undefined],
    ["a slide added", (s) => void s.addSlide()],
    ["slides added at the start and the end", (s) => { s.addSlide({ index: 0 }); s.addSlide(); }],
    ["a slide removed", (s) => s.deleteSlides([s.deck.slides[1]!.id])],
    ["slides removed and added together", (s) => { s.deleteSlides([s.deck.slides[0]!.id, s.deck.slides[2]!.id]); s.addSlide(); }],
    ["all slides but one removed", (s) => s.deleteSlides(s.deck.slides.slice(1).map((x) => x.id))],
    ["slides reordered", (s) => s.moveSlides([s.deck.slides[3]!.id], 0)],
    ["slides reversed", (s) => { s.moveSlides([s.deck.slides[3]!.id], 0); s.moveSlides([s.deck.slides[3]!.id], 1); s.moveSlides([s.deck.slides[3]!.id], 2); }],
    ["a slide's text edited", (s) => s.setText(s.deck.slides[2]!.id, s.deck.slides[2]!.elements[0]!.id, paragraphsFromText("Changed"))],
    ["elements added, removed and reordered", (s) => {
      const id = s.deck.slides[1]!.id;
      s.deleteElements(id, [s.slide(id).elements[1]!.id]);
      s.addShape(id, "ellipse", {});
      s.arrange(id, [s.slide(id).elements[0]!.id], "front");
    }],
    ["elements grouped", (s) => { const id = s.deck.slides[1]!.id; s.group(id, s.slide(id).elements.slice(1).map((e) => e.id)); }],
    ["notes", (s) => s.setNotes(s.deck.slides[2]!.id, "different words", { merge: false })],
    ["a transition, a skipped slide, a background", (s) => { s.setTransition([s.deck.slides[0]!.id], { type: "fade" }); s.setSkipped([s.deck.slides[1]!.id], true); }],
    ["an animation", (s) => { const sl = s.deck.slides[1]!; s.addAnimation(sl.id, { target: sl.elements[1]!.id, kind: "fade" }); }],
    ["the title and the size", (s) => { s.setTitle("Renamed"); s.setSize(SIZE_WIDESCREEN); }],
    ["the theme colours", (s) => s.setTheme(s.deck.masters[0]!.id, { colors: { accent1: "#00ff00" } as never })],
    ["a whole other theme (new master and layouts)", (s) => s.applyTheme(builtinTheme(BUILTIN_THEMES[1]!.id, s.deck.size))],
    ["a layout added, renamed and moved", (s) => {
      const m = s.deck.masters[0]!;
      const l = s.addLayout(m.id, "Mine", "custom", m.layouts[0]!.id);
      s.patchLayout(m.layouts[1]!.id, { name: "Renamed layout" });
      s.moveLayout(l.id, 0);
    }],
    ["a layout removed that slides had used", (s) => {
      const m = s.deck.masters[0]!;
      const l = s.addLayout(m.id, "Temp");
      s.setLayout(s.deck.slides[1]!.id, l.id);
    }],
    ["a master's elements", (s) => s.addShape(s.deck.masters[0]!.id, "rect", { x: 5, y: 5, w: 20, h: 20 })],
  ];
  for (const [name, change] of cases) {
    it(`brings back the version after: ${name}`, () => {
      const { before, restored, after, ops } = roundTrip(change);
      expect(content(restored)).toEqual(content(before));
      // a restore of a deck that is already the version does nothing
      if (name === "nothing changed") expect(ops).toEqual([]);
      void after;
    });
  }

  it("touches only what differs (the unchanged slides and elements are left alone)", () => {
    const { ops, before } = roundTrip((s) => s.setText(s.deck.slides[2]!.id, s.deck.slides[2]!.elements[0]!.id, paragraphsFromText("Changed")));
    expect(ops.length).toBe(1);
    expect(ops[0]).toMatchObject({ type: "replace_element", owner: before.slides[2]!.id });
  });

  it("keeps the comments as they are now, and the deck's id", () => {
    const s = fresh();
    const before = clone(s.deck);
    const after: Deck = { ...clone(s.deck), comments: { t1: { id: "t1" } as never } };
    const restored = apply(after, restoreDeckOps(after, before));
    expect(restored.comments).toEqual(after.comments);
    expect(restored.id).toBe(after.id);
  });

  it("merges with an edit somebody else made meanwhile to a slide the version does not touch", () => {
    const s = fresh();
    const before = clone(s.deck);
    s.setText(s.deck.slides[0]!.id, s.deck.slides[0]!.elements[0]!.id, paragraphsFromText("Mine"));
    const mine = clone(s.deck);
    const ops = restoreDeckOps(mine, before);
    // somebody else retitles slide 4 while the restore is on its way
    const theirs = clone(mine);
    const last = theirs.slides[3]!;
    theirs.slides[3] = { ...last, notes: "theirs" };
    const merged = apply(theirs, ops);
    expect(merged.slides[0]).toEqual(before.slides[0]);
    expect(merged.slides[3]!.notes).toBe("theirs");
  });

  it("produces operations that are valid one after the other on the deck as it is", () => {
    for (const [, change] of cases) {
      const { ops, after } = roundTrip(change);
      expect(() => apply(after, ops)).not.toThrow();
    }
  });
});

describe("summarizeDeckDiff", () => {
  it("says what changed since a version", () => {
    const s = fresh();
    const was = clone(s.deck);
    s.setText(s.deck.slides[2]!.id, s.deck.slides[2]!.elements[0]!.id, paragraphsFromText("Changed"));
    s.setNotes(s.deck.slides[3]!.id, "x", { merge: false });
    s.addSlide();
    s.deleteSlides([s.deck.slides[0]!.id]);
    s.setTitle("Renamed");
    const d = summarizeDeckDiff(was, s.deck);
    expect(d.lines).toEqual(["2 slides changed", "1 slide added", "1 slide removed", "Title changed"].map((l) => l));
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(summarizeDeckDiff(was, was).lines).toEqual([]);
  });
});

const users = (role: "editor" | "viewer" = "editor") => new Users({ current: { id: "u1", name: "Ada" }, role });

describe("deckVersionHistory", () => {
  it("restores as one undoable step, adds new versions and keeps the earlier ones", async () => {
    const s = fresh();
    const history = deckVersionHistory(s, { storage: memoryVersionStorage<Deck>(), users: users() });
    await history.ready;
    const v1 = await history.save("First");
    s.setText(s.deck.slides[0]!.id, s.deck.slides[0]!.elements[0]!.id, paragraphsFromText("Edited"));
    s.addSlide();
    const editedTitle = s.deck.slides[0]!.elements[0]!;
    await history.restore(v1.id);
    expect(content(s.deck)).toEqual(content(v1.state));
    const names = history.versions.map((v) => v.name);
    expect(names).toContain("First");
    expect(names).toContain('Restored "First"');
    expect(names).toContain('Before restoring "First"');
    // one step takes the restore back
    expect(s.undo()).toBe(true);
    expect(s.deck.slides.length).toBe(5);
    expect(s.deck.slides[0]!.elements[0]).toEqual(editedTitle);
    expect(s.redo()).toBe(true);
    expect(content(s.deck)).toEqual(content(v1.state));
  });

  it("leaves the selection on something that exists", async () => {
    const s = fresh();
    const history = deckVersionHistory(s, { storage: memoryVersionStorage<Deck>(), users: users() });
    await history.ready;
    const v = await history.save("Four slides");
    const added = s.addSlide();
    s.selection = { slide: added.id, slides: [added.id], elements: [added.elements[0]!.id] };
    await history.restore(v.id);
    expect(s.deck.slides.some((x) => x.id === s.selection.slide)).toBe(true);
    expect(s.selection.elements).toEqual([]);
  });

  it("is refused for a viewer", async () => {
    const s = fresh();
    const history = deckVersionHistory(s, { storage: memoryVersionStorage<Deck>(), users: users("viewer") });
    await history.ready;
    expect(history.canEdit).toBe(false);
  });

  it("two copies of a deck that take the same restore end up the same", async () => {
    const a = fresh();
    const history = deckVersionHistory(a, { storage: memoryVersionStorage<Deck>(), users: users() });
    await history.ready;
    const v = await history.save("Start");
    a.addSlide();
    a.deleteSlides([a.deck.slides[0]!.id]);
    a.setTitle("Edited");
    // what a restore sends to the other copy: the same operations, applied there
    const sent = restoreDeckOps(a.deck, v.state);
    const b2 = new DeckSession(clone(a.deck));
    b2.applyRemote(sent);
    await history.restore(v.id);
    expect(content(b2.deck)).toEqual(content(a.deck));
  });
});
