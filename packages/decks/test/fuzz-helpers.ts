import type { CommentChange } from "@pli.dev/core";
import {
  canonicalJson,
  createDeck,
  deckReducer,
  deckSyncModel,
  normalizeOps,
  replaceRange,
  setParagraphProps,
  applyMarks,
  slideFromLayout,
  type ChartElement,
  type Deck,
  type DeckAnchor,
  type DeckOp,
  type Element,
  type GroupElement,
  type Paragraph,
  type ShapeElement,
  type Slide,
  type TableElement,
} from "../src";

/** Shared by the fuzzers: random decks, random operations, and ways to compare decks. */

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)]!;
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
export type Rng = ReturnType<typeof rng>;

export const canon = (deck: Deck): string => canonicalJson(deck);
export const same = (a: Deck, b: Deck): boolean => canon(a) === canon(b);

export function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}: ...${a.slice(Math.max(0, i - 60), i + 120)}\n      vs ...${b.slice(Math.max(0, i - 60), i + 120)}`;
}

export const show = (ops: readonly DeckOp[]): string => JSON.stringify(ops, (k, v) => (k === "slide" || k === "element" || k === "elements" || k === "master" ? summary(v) : v)).slice(0, 1500);
function summary(v: unknown): unknown {
  if (Array.isArray(v)) return `[${v.length} elements]`;
  if (v && typeof v === "object" && "id" in v) return `<${(v as { id: string }).id}>`;
  return v;
}

export function apply(deck: Deck, ops: readonly DeckOp[]): Deck {
  return ops.reduce((d, op) => {
    try {
      return deckSyncModel.apply(d, op);
    } catch (error) {
      throw new Error(`${(error as Error).message} while applying ${show([op])} (slides: ${d.slides.map((s) => s.id).join(",")})`);
    }
  }, deck);
}

const text = (id: string, s: string, extra: Partial<ShapeElement> = {}): ShapeElement => ({
  type: "shape",
  id,
  geometry: "rect",
  x: 20,
  y: 20,
  w: 200,
  h: 60,
  text: { paragraphs: s.split("\n").map((line) => ({ runs: line ? [{ text: line }] : [] })) },
  ...extra,
});

/** A deck with a few slides holding text, a table, a chart and a group, with fixed ids. */
export function startDeck(): Deck {
  const deck = createDeck();
  const layouts = deck.masters[0]!.layouts;
  const slides: Slide[] = [0, 1, 2].map((i) => ({ ...slideFromLayout(layouts[1]!, `s${i}`), elements: [], notes: i === 0 ? "first notes\nsecond line" : "" }));
  const table: TableElement = {
    type: "table",
    id: "t1",
    x: 30,
    y: 100,
    w: 300,
    h: 90,
    columns: [100, 100, 100],
    rows: [0, 1, 2].map((r) => ({ h: 30, cells: [0, 1, 2].map((c) => ({ paragraphs: [{ runs: [{ text: `r${r}c${c}` }] }] })) })),
  };
  const chart: ChartElement = {
    type: "chart",
    id: "c1",
    x: 340,
    y: 100,
    w: 300,
    h: 200,
    chartType: "column",
    categories: ["A", "B", "C"],
    series: [
      { name: "One", values: [1, 2, 3] },
      { name: "Two", values: [3, 2, 1] },
    ],
  };
  const group: GroupElement = { type: "group", id: "g1", x: 10, y: 250, w: 200, h: 100, children: [text("g1a", "in group a", { x: 10, y: 250, w: 90, h: 50 }), text("g1b", "in group b", { x: 110, y: 250, w: 90, h: 50 })] };
  slides[0]!.elements = [
    text("e1", "Hello world\nSecond paragraph here", { text: { paragraphs: [{ runs: [{ text: "Hello " }, { text: "world", marks: { bold: true } }] }, { align: "center", runs: [{ text: "Second paragraph here" }] }] } }),
    text("e2", "Another shape", { x: 240, y: 20 }),
    table,
    chart,
  ];
  slides[1]!.elements = [text("e3", "Slide two\nwith lines\nand more"), group];
  slides[2]!.elements = [text("e4", ""), text("e5", "Third", { x: 300, y: 300 })];
  return { ...deck, slides };
}

/** A deck that has had some random changes already, so cases start from varied states. */
export function warmedUp(r: Rng): Deck {
  let deck = startDeck();
  const n = r.int(6);
  for (let i = 0; i < n; i++) {
    const op = randomOp(r, deck, "w");
    if (!op) continue;
    try {
      deck = apply(deck, normalizeOps(deck, [op]));
    } catch {
      // not applicable
    }
  }
  return deck;
}

// ---- Random operations -----------------------------------------------------------------------------------------

/** When on, people work on the first slide (most of the time), so their changes meet. */
export const crowd = { on: false };

let counter = 0;
const fresh = (tag: string) => `${tag}${++counter}`;

const WORDS = ["alpha", "b", "gamma ", "δ", "é", "x y", "😀", "\n", "z"];
const COLORS = ["#ff0000", "#00ff00", "#0000ff", "#123456", "#abcdef"];

interface Located {
  owner: string;
  element: Element;
}

function allElements(deck: Deck, r: Rng): Located[] {
  const out: Located[] = [];
  const walk = (owner: string, list: readonly Element[]) => {
    for (const e of list) {
      out.push({ owner, element: e });
      if (e.type === "group") walk(owner, e.children);
    }
  };
  for (const s of crowd.on && deck.slides[0] ? [deck.slides[0]] : deck.slides) walk(s.id, s.elements);
  // Templates are edited now and then.
  if (r.chance(0.15)) {
    const m = r.pick(deck.masters);
    walk(m.id, m.elements);
    const l = r.pick(m.layouts);
    walk(l.id, l.elements);
  }
  return out;
}

function randomRange(r: Rng, ps: readonly Paragraph[]) {
  const p = r.int(ps.length);
  const len = ps[p]!.runs.reduce((n, x) => n + x.text.length, 0);
  const o = r.int(len + 1);
  const p2 = r.chance(0.2) ? Math.min(ps.length - 1, p + r.int(2)) : p;
  const len2 = ps[p2]!.runs.reduce((n, x) => n + x.text.length, 0);
  const o2 = p2 === p ? Math.min(len, o + r.int(4)) : r.int(len2 + 1);
  return { from: { p, o }, to: { p: p2, o: o2 } };
}

function editedText(r: Rng, ps: readonly Paragraph[]): Paragraph[] {
  const body = ps.length ? ps : [{ runs: [] }];
  const range = randomRange(r, body);
  switch (r.int(5)) {
    case 0:
    case 1:
      return replaceRange(body, { from: range.from, to: range.from }, r.pick(WORDS)).paragraphs;
    case 2:
      return replaceRange(body, range, "").paragraphs;
    case 3:
      return applyMarks(body, range, r.chance(0.5) ? { bold: true } : { color: r.pick(COLORS) });
    default:
      return setParagraphProps(body, range, r.pick([{ align: "right" as const }, { level: 1 }, { bullet: null }, { align: null }]));
  }
}

const withText = (e: ShapeElement, paragraphs: Paragraph[]): ShapeElement => ({ ...e, text: { ...(e.text ?? {}), paragraphs } });

const thread = (r: Rng, deck: Deck, tag: string, author: string): CommentChange<DeckAnchor> => {
  const slide = r.pick(deck.slides);
  const id = fresh(`th${tag}`);
  return { type: "thread.create", thread: { id, anchor: { slide: slide.id }, comments: [{ id: fresh("cm"), author, body: "hi", createdAt: 1000 + r.int(50) }], createdAt: 1000 + r.int(50) } };
};

/** One random change to a deck, written the way the editing commands write them (whole elements and all). */
export function randomOp(r: Rng, deck: Deck, tag: string): DeckOp | null {
  if (deck.slides.length === 0) {
    const layout = r.pick(deck.masters[0]!.layouts);
    return { type: "insert_slide", slide: { ...slideFromLayout(layout, fresh(`${tag}s`)), notes: "" }, index: 0 };
  }
  const slide = crowd.on && deck.slides[0] && r.chance(0.85) ? deck.slides[0] : r.pick(deck.slides);
  const choice = r.int(40);
  const found = (): Located | null => {
    const list = allElements(deck, r);
    return list.length ? r.pick(list) : null;
  };
  switch (choice) {
    case 0:
    case 1:
    case 2: {
      const f = found();
      if (!f) return null;
      return { type: "replace_element", owner: f.owner, element: { ...f.element, x: r.int(500), y: r.int(300) } as Element };
    }
    case 3: {
      const f = found();
      if (!f) return null;
      return { type: "replace_element", owner: f.owner, element: { ...f.element, w: 20 + r.int(400), h: 20 + r.int(200) } as Element };
    }
    case 4: {
      const f = found();
      if (!f || f.element.type !== "shape") return null;
      return { type: "replace_element", owner: f.owner, element: { ...f.element, fill: r.pick(COLORS) } };
    }
    case 5: {
      const f = found();
      if (!f) return null;
      return { type: "replace_element", owner: f.owner, element: { ...f.element, rotation: r.int(360) } as Element };
    }
    case 6:
    case 7:
    case 8:
    case 9:
    case 10:
    case 11: {
      const f = found();
      if (!f || f.element.type !== "shape") return null;
      return { type: "replace_element", owner: f.owner, element: withText(f.element, editedText(r, f.element.text?.paragraphs ?? [])) };
    }
    case 12:
    case 13: {
      const f = found();
      if (!f || f.element.type !== "table") return null;
      const t = f.element;
      const row = r.int(t.rows.length);
      const col = r.int(t.rows[row]!.cells.length);
      const rows = t.rows.map((x, ri) => (ri === row ? { ...x, cells: x.cells.map((c, ci) => (ci === col ? { ...c, paragraphs: editedText(r, c.paragraphs) } : c)) } : x));
      return { type: "replace_element", owner: f.owner, element: { ...t, rows } };
    }
    case 14: {
      const f = found();
      if (!f || f.element.type !== "table") return null;
      const t = f.element;
      if (r.chance(0.5)) return { type: "replace_element", owner: f.owner, element: { ...t, rows: [...t.rows, { ...t.rows[0]!, cells: t.rows[0]!.cells.map((c) => ({ ...c, paragraphs: [{ runs: [{ text: "new" }] }] })) }] } };
      return { type: "replace_element", owner: f.owner, element: { ...t, h: (t.h ?? 90) + r.int(30), rows: t.rows.map((x, i) => (i === 0 ? { ...x, h: x.h + 1 } : x)) } };
    }
    case 15:
    case 16: {
      const f = found();
      if (!f || f.element.type !== "chart") return null;
      const c = f.element;
      const s = r.int(c.series.length);
      if (r.chance(0.2)) return { type: "replace_element", owner: f.owner, element: { ...c, series: [...c.series, { name: "New", values: c.categories.map(() => r.int(10)) }] } };
      if (r.chance(0.3)) return { type: "replace_element", owner: f.owner, element: { ...c, categories: c.categories.map((x, i) => (i === 0 ? x + "!" : x)) } };
      return { type: "replace_element", owner: f.owner, element: { ...c, series: c.series.map((x, i) => (i === s ? { ...x, values: x.values.map((v, k) => (k === 0 ? r.int(100) : v)) } : x)) } };
    }
    case 17:
    case 18: {
      const owner = r.chance(0.8) ? slide : r.pick(deck.masters[0]!.layouts);
      const id = fresh(`${tag}e`);
      const el = text(id, "new " + id, { x: r.int(400), y: r.int(300) });
      return { type: "insert_element", owner: owner.id, element: el, index: r.int(owner.elements.length + 1) };
    }
    case 19:
    case 20: {
      if (slide.elements.length === 0) return null;
      return { type: "remove_element", owner: slide.id, id: r.pick(slide.elements).id };
    }
    case 21: {
      if (slide.elements.length < 2) return null;
      return { type: "move_element", owner: slide.id, id: r.pick(slide.elements).id, index: r.int(slide.elements.length) };
    }
    case 22:
    case 23: {
      const layout = r.pick(deck.masters[0]!.layouts);
      const s = { ...slideFromLayout(layout, fresh(`${tag}s`)), notes: "" };
      return { type: "insert_slide", slide: s, index: r.int(deck.slides.length + 1) };
    }
    case 24: {
      if (deck.slides.length < 2) return null;
      return { type: "remove_slide", id: slide.id };
    }
    case 25:
    case 26: {
      if (deck.slides.length < 2) return null;
      return { type: "move_slide", id: slide.id, index: r.int(deck.slides.length) };
    }
    case 27: {
      return { type: "patch_slide", id: slide.id, patch: r.pick([{ name: tag + r.int(9) }, { background: r.pick(COLORS) }, { transition: { type: "fade" as const } }, { skipped: true }, { name: null }]) };
    }
    case 28:
    case 29: {
      const notes = slide.notes;
      const at = r.int(notes.length + 1);
      return { type: "patch_slide", id: slide.id, patch: { notes: notes.slice(0, at) + r.pick(WORDS) + notes.slice(at + r.int(3)) } };
    }
    case 30: {
      const m = r.pick(deck.masters);
      const slot = r.pick(["accent1", "accent2", "dk1"] as const);
      if (r.chance(0.6)) return { type: "patch_master", id: m.id, patch: { theme: { ...m.theme, colors: { ...m.theme.colors, [slot]: r.pick(COLORS) } } } };
      return { type: "patch_master", id: m.id, patch: { theme: { ...m.theme, fonts: { ...m.theme.fonts, major: r.pick(["Arial", "Georgia"]) } } } };
    }
    case 31: {
      const m = r.pick(deck.masters);
      return { type: "patch_master", id: m.id, patch: { textStyles: { ...m.textStyles, title: { ...m.textStyles.title, 0: { ...m.textStyles.title[0], marks: { ...m.textStyles.title[0]?.marks, fontSize: 10 + r.int(40) } } } } } };
    }
    case 32: {
      const l = r.pick(deck.masters[0]!.layouts);
      return { type: "patch_layout", id: l.id, patch: { name: tag + r.int(9) } };
    }
    case 33: {
      const m = deck.masters[0]!;
      const l = { ...m.layouts[0]!, id: fresh(`${tag}l`), name: "Made", elements: [] };
      return { type: "insert_layout", master: m.id, layout: l, index: r.int(m.layouts.length + 1) };
    }
    case 34: {
      const m = deck.masters[0]!;
      return { type: "move_layout", id: r.pick(m.layouts).id, index: r.int(m.layouts.length) };
    }
    case 35:
      return { type: "set_deck", patch: { title: tag + r.int(9) } };
    case 36: {
      if (slide.elements.length < 2) return null;
      const [a, b] = [slide.elements[0]!, slide.elements[1]!];
      if (a.type === "group" || b.type === "group") return null;
      return { type: "set_elements", owner: slide.id, elements: [{ type: "group", id: fresh(`${tag}g`), children: [a, b] }, ...slide.elements.slice(2)] };
    }
    case 37:
    case 38: {
      const users = ["u1", "u2"];
      const existing = Object.values(deck.comments ?? {});
      if (existing.length === 0 || r.chance(0.3)) return { type: "comment", change: thread(r, deck, tag, r.pick(users)) };
      const t = r.pick(existing);
      switch (r.int(5)) {
        case 0:
          return { type: "comment", change: { type: "comment.add", threadId: t.id, comment: { id: fresh("cm"), author: r.pick(users), body: "re", createdAt: 1000 + r.int(50) } } };
        case 1:
          return { type: "comment", change: { type: "thread.resolve", threadId: t.id, by: r.pick(users), at: 2000 + r.int(50) } };
        case 2:
          return { type: "comment", change: { type: "thread.reopen", threadId: t.id } };
        case 3:
          return { type: "comment", change: { type: "comment.edit", threadId: t.id, commentId: t.comments[0]!.id, body: "e" + r.int(9), at: 3000 + r.int(50) } };
        default:
          return { type: "comment", change: { type: "thread.delete", threadId: t.id } };
      }
    }
    default: {
      const f = found();
      if (!f || f.element.type !== "shape") return null;
      return { type: "replace_element", owner: f.owner, element: { ...f.element, line: { color: r.pick(COLORS), width: 1 + r.int(4) } } };
    }
  }
}

/** A batch of changes by one person, each made on the deck the one before left. */
export function randomBatch(r: Rng, deck: Deck, tag: string, max = 3): DeckOp[] {
  const out: DeckOp[] = [];
  let d = deck;
  const n = 1 + r.int(max);
  for (let i = 0; i < n; i++) {
    const raw = randomOp(r, d, tag);
    if (!raw) continue;
    let ops: DeckOp[];
    try {
      ops = normalizeOps(d, [raw]);
      d = apply(d, ops);
    } catch {
      continue;
    }
    out.push(...ops);
  }
  return out;
}

export { deckReducer };
