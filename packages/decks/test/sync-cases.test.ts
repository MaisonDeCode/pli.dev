import { describe, expect, it } from "vitest";
import { createDeck, deckSyncModel, hashDeck, mapDeckPresence, mapDeckSelection, normalizeOps, slideFromLayout, transformDeckOps, applyDelta, diffDocs, invertDelta, mapIndex, paragraphsToDoc, docToParagraphs, transformDelta, type Deck, type DeckOp, type ShapeElement, type TableElement, type ChartElement, type Paragraph } from "../src";
import { apply, startDeck } from "./fuzz-helpers";
import { replaceRange } from "../src";

/** Both orders must reach the same deck: `later` was made after `earlier` was accepted, from the same deck. */
function merge(start: Deck, later: DeckOp[], earlier: DeckOp[]): Deck {
  const l = normalizeOps(start, later);
  const e = normalizeOps(start, earlier);
  const [l2, e2] = transformDeckOps(l, e);
  const a = apply(apply(start, e), l2);
  const b = apply(apply(start, l), e2);
  expect(hashDeck(a)).toBe(hashDeck(b));
  return a;
}

const el = (deck: Deck, slide: string, id: string) => deck.slides.find((s) => s.id === slide)!.elements.find((e) => e.id === id)!;
const replace = (start: Deck, slide: string, id: string, change: Record<string, unknown>): DeckOp => ({ type: "replace_element", owner: slide, element: { ...el(start, slide, id), ...change } as never });
const text = (e: unknown) => ((e as ShapeElement).text!.paragraphs as Paragraph[]).map((p) => p.runs.map((r) => r.text).join("")).join("\n");
const typed = (start: Deck, id: string, at: number, insert: string, owner = "s0"): DeckOp => {
  const e = el(start, owner, id) as ShapeElement;
  const next = replaceRange(e.text!.paragraphs, { from: { p: 0, o: at }, to: { p: 0, o: at } }, insert).paragraphs;
  return replace(start, owner, id, { text: { ...e.text, paragraphs: next } });
};

describe("merging two people's changes to a deck", () => {
  const start = startDeck();

  it("keeps a move and a recolour of one shape", () => {
    const d = merge(start, [replace(start, "s0", "e2", { fill: "#ff0000" })], [replace(start, "s0", "e2", { x: 300, y: 40 })]);
    expect(el(d, "s0", "e2")).toMatchObject({ x: 300, y: 40, fill: "#ff0000" });
  });

  it("lets the later change win on one property and keeps the other properties of both", () => {
    const d = merge(start, [replace(start, "s0", "e2", { x: 111, w: 50 })], [replace(start, "s0", "e2", { x: 222, h: 70 })]);
    expect(el(d, "s0", "e2")).toMatchObject({ x: 111, w: 50, h: 70 });
  });

  it("merges two people typing in one text box, character by character", () => {
    const d = merge(start, [typed(start, "e1", 0, "AA ")], [typed(start, "e1", 11, "!!")]);
    expect(text(el(d, "s0", "e1"))).toBe("AA Hello world!!\nSecond paragraph here");
    const same = merge(start, [typed(start, "e1", 5, "L")], [typed(start, "e1", 5, "E")]);
    expect(text(el(same, "s0", "e1"))).toBe("HelloEL world\nSecond paragraph here");
  });

  it("keeps bold and typing together, and a split paragraph", () => {
    const e = el(start, "s0", "e1") as ShapeElement;
    const bold: DeckOp = replace(start, "s0", "e1", { text: { ...e.text, paragraphs: [{ runs: [{ text: "Hello world", marks: { bold: true } }] }, e.text!.paragraphs[1]] } });
    const d = merge(start, [bold], [typed(start, "e1", 5, "XYZ")]);
    const paragraphs = (el(d, "s0", "e1") as ShapeElement).text!.paragraphs;
    expect(paragraphs[0]!.runs.map((r) => [r.text, !!r.marks?.bold])).toEqual([["Hello", true], ["XYZ", false], [" world", true]]);
  });

  it("merges edits to different cells of a table, and to one cell", () => {
    const t = el(start, "s0", "t1") as TableElement;
    const cell = (r: number, c: number, s: string): DeckOp => ({ type: "replace_element", owner: "s0", element: { ...t, rows: t.rows.map((row, ri) => (ri === r ? { ...row, cells: row.cells.map((x, ci) => (ci === c ? { ...x, paragraphs: [{ runs: [{ text: s }] }] } : x)) } : row)) } });
    const d = merge(start, [cell(0, 0, "one")], [cell(2, 2, "two")]);
    const rows = (el(d, "s0", "t1") as TableElement).rows;
    expect([rows[0]!.cells[0]!, rows[2]!.cells[2]!].map((c) => c.paragraphs[0]!.runs[0]!.text)).toEqual(["one", "two"]);
    merge(start, [cell(1, 1, "later")], [cell(1, 1, "earlier")]);
  });

  it("merges chart data edits to different values", () => {
    const c = el(start, "s0", "c1") as ChartElement;
    const d = merge(
      start,
      [replace(start, "s0", "c1", { series: c.series.map((s, i) => (i === 1 ? { ...s, values: [3, 2, 99] } : s)) })],
      [replace(start, "s0", "c1", { series: c.series.map((s, i) => (i === 0 ? { ...s, values: [42, 2, 3] } : s)) })],
    );
    expect((el(d, "s0", "c1") as ChartElement).series.map((s) => s.values)).toEqual([[42, 2, 3], [3, 2, 99]]);
  });

  it("drops an edit to something that was deleted", () => {
    const d = merge(start, [replace(start, "s0", "e2", { x: 5 })], [{ type: "remove_element", owner: "s0", id: "e2" }]);
    expect(d.slides[0]!.elements.map((e) => e.id)).toEqual(["e1", "t1", "c1"]);
    const s = merge(start, [typed(start, "e3", 0, "x", "s1")], [{ type: "remove_slide", id: "s1" }]);
    expect(s.slides.map((x) => x.id)).toEqual(["s0", "s2"]);
    merge(start, [{ type: "remove_element", owner: "s0", id: "e2" }], [{ type: "remove_element", owner: "s0", id: "e2" }]);
    const g = merge(start, [replace(start, "s1", "g1", { x: 1 }), { type: "set_path", target: { owner: "s1", id: "g1a", within: ["g1"] }, path: ["x"], value: 4 }], [{ type: "remove_element", owner: "s1", id: "g1" }]);
    expect(g.slides[1]!.elements.map((e) => e.id)).toEqual(["e3"]);
  });

  it("shifts slides inserted, deleted and moved at the same time", () => {
    const layout = start.masters[0]!.layouts[1]!;
    const n1 = slideFromLayout(layout, "n1");
    const n2 = slideFromLayout(layout, "n2");
    const d = merge(start, [{ type: "insert_slide", slide: n1, index: 1 }], [{ type: "insert_slide", slide: n2, index: 1 }]);
    expect(d.slides.map((s) => s.id)).toEqual(["s0", "n2", "n1", "s1", "s2"]);
    expect(merge(start, [{ type: "move_slide", id: "s2", index: 0 }], [{ type: "remove_slide", id: "s0" }]).slides.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(merge(start, [{ type: "move_slide", id: "s0", index: 2 }], [{ type: "move_slide", id: "s0", index: 1 }]).slides.map((s) => s.id)).toEqual(["s1", "s2", "s0"]);
    merge(start, [{ type: "remove_slide", id: "s1" }, { type: "insert_slide", slide: n1, index: 1 }], [{ type: "move_slide", id: "s2", index: 0 }]);
  });

  it("merges edits to the master: different colours, different fonts, a layout's name", () => {
    const m = start.masters[0]!;
    const d = merge(
      start,
      [{ type: "patch_master", id: m.id, patch: { theme: { ...m.theme, colors: { ...m.theme.colors, accent1: "#111111" } } } }],
      [{ type: "patch_master", id: m.id, patch: { theme: { ...m.theme, colors: { ...m.theme.colors, accent2: "#222222" }, fonts: { ...m.theme.fonts, major: "Georgia" } } } }],
    );
    expect(d.masters[0]!.theme.colors).toMatchObject({ accent1: "#111111", accent2: "#222222" });
    expect(d.masters[0]!.theme.fonts.major).toBe("Georgia");
    merge(start, [{ type: "patch_layout", id: m.layouts[0]!.id, patch: { name: "A" } }], [{ type: "patch_layout", id: m.layouts[0]!.id, patch: { name: "B", kind: "custom" } }]);
  });

  it("merges speaker notes typed by two people", () => {
    const d = merge(start, [{ type: "patch_slide", id: "s0", patch: { notes: "XX first notes\nsecond line" } }], [{ type: "patch_slide", id: "s0", patch: { notes: "first notes\nsecond line!!" } }]);
    expect(d.slides[0]!.notes).toBe("XX first notes\nsecond line!!");
  });

  it("lets a regrouping beat edits to the same slide's elements", () => {
    const a = start.slides[0]!.elements[0]!;
    const b = start.slides[0]!.elements[1]!;
    const group: DeckOp = { type: "set_elements", owner: "s0", elements: [{ type: "group", id: "gg", children: [a, b] }, ...start.slides[0]!.elements.slice(2)] };
    const d = merge(start, [group], [replace(start, "s0", "e2", { x: 9 })]);
    expect(d.slides[0]!.elements[0]!.id).toBe("gg");
  });

  it("removes a slide made with a layout someone deleted, and a layout deleted under a new slide", () => {
    const m = start.masters[0]!;
    const lastLayout = m.layouts[m.layouts.length - 1]!;
    const fresh = slideFromLayout(lastLayout, "made");
    const d = merge(start, [{ type: "insert_slide", slide: fresh, index: 1 }], [{ type: "remove_layout", id: lastLayout.id }]);
    expect(d.slides.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(d.masters[0]!.layouts.some((l) => l.id === lastLayout.id)).toBe(false);
    const e = merge(start, [{ type: "remove_layout", id: lastLayout.id }], [{ type: "insert_slide", slide: fresh, index: 1 }]);
    expect(e.slides.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
  });

  it("merges comment replies, and lets the later resolve or reopen win", () => {
    const thread = { id: "t", anchor: { slide: "s0" }, comments: [{ id: "c0", author: "a", body: "hi", createdAt: 1 }], createdAt: 1 };
    const base = apply(start, [{ type: "comment", change: { type: "thread.create", thread } }]);
    const d = merge(
      base,
      [{ type: "comment", change: { type: "comment.add", threadId: "t", comment: { id: "c2", author: "b", body: "two", createdAt: 3 } } }, { type: "comment", change: { type: "thread.resolve", threadId: "t", by: "b", at: 9 } }],
      [{ type: "comment", change: { type: "comment.add", threadId: "t", comment: { id: "c1", author: "a", body: "one", createdAt: 2 } } }, { type: "comment", change: { type: "thread.reopen", threadId: "t" } }],
    );
    expect(d.comments!.t!.comments.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
    expect(d.comments!.t!.resolved).toBeTruthy();
  });
});

describe("selections, cursors and fingerprints", () => {
  it("moves selections and cursors with the text, and forgets what was deleted", () => {
    const sel = { slide: "s1", slides: ["s1", "s2"], elements: ["e3", "g1"], text: { element: "e3", range: { from: { p: 0, o: 1 }, to: { p: 0, o: 2 } } } };
    const gone = mapDeckSelection(sel, [{ type: "remove_element", owner: "s1", id: "e3", from: 0 }, { type: "remove_slide", id: "s2", from: 2 }]);
    expect(gone).toMatchObject({ slide: "s1", slides: ["s1"], elements: ["g1"], text: undefined });
    expect(mapDeckSelection(sel, [{ type: "remove_slide", id: "s1", from: 1 }])!.slide).toBeNull();
    const presence = { slide: "s1", selection: ["e3", "g1"], caret: { element: "e3", anchor: 5, focus: 8 } };
    const moved = mapDeckPresence(presence, [{ type: "edit_text", owner: "s1", id: "e3", delta: [{ retain: 2 }, { insert: "abc" }] }]);
    expect(moved.caret).toEqual({ element: "e3", anchor: 8, focus: 11 });
    expect(mapDeckPresence(presence, [{ type: "remove_element", owner: "s1", id: "e3", from: 0 }])).toMatchObject({ selection: ["g1"], caret: null });
    expect(mapDeckPresence(presence, [{ type: "remove_slide", id: "s1", from: 1 }])).toMatchObject({ slide: null, selection: [], caret: null });
  });

  it("gives equal decks equal fingerprints and different decks different ones", () => {
    const a = startDeck();
    const b = JSON.parse(JSON.stringify(a)) as Deck;
    expect(hashDeck(a)).toBe(hashDeck(b));
    expect(hashDeck(apply(a, [{ type: "set_deck", patch: { title: "x" } }]))).not.toBe(hashDeck(a));
    expect(hashDeck(createDeck())).not.toBe(hashDeck(createDeck()));
  });
});

describe("text deltas", () => {
  const doc = (s: string) => paragraphsToDoc(s.split("\n").map((t) => ({ runs: t ? [{ text: t }] : [] })));

  it("round-trips paragraphs, marks and line breaks inside a paragraph", () => {
    const ps: Paragraph[] = [{ align: "center", level: 1, bullet: null, runs: [{ text: "a" }, { text: "b\nc", marks: { bold: true, comment: ["t1", "t2"] } }] }, { runs: [] }];
    expect(docToParagraphs(paragraphsToDoc(ps))).toEqual(ps);
  });

  it("diffs, applies, inverts and maps positions", () => {
    const a = doc("hello world\nsecond");
    const b = doc("hello brave world\nsecond");
    const d = diffDocs(a, b);
    expect(applyDelta(a, d)).toEqual(b);
    expect(applyDelta(b, invertDelta(d, a))).toEqual(a);
    expect(mapIndex(8, d)).toBe(14);
    expect(applyDelta(a, diffDocs(a, doc("hello world\nsec")))).toEqual(doc("hello world\nsec"));
    expect(mapIndex(6, [{ retain: 6 }, { insert: "x" }], true)).toBe(6);
    expect(mapIndex(6, [{ retain: 6 }, { insert: "x" }])).toBe(7);
  });

  it("transforms two edits so both orders agree", () => {
    const a = doc("abcdef");
    const x = [{ retain: 2 }, { delete: 2 }, { insert: "X" }];
    const y = [{ retain: 3 }, { insert: "Y" }, { retain: 1, attrs: { bold: true } }];
    const xy = applyDelta(applyDelta(a, y), transformDelta(x, y, { baseFirst: true, selfWins: true }));
    const yx = applyDelta(applyDelta(a, x), transformDelta(y, x, { baseFirst: false, selfWins: false }));
    expect(xy).toEqual(yx);
  });
});
