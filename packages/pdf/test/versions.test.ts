import { CollabRoom, SyncClient, Users, createAuthority, isSyncMessage, canonicalJson, memoryDocumentStore, memoryVersionStorage, versionFromStore, stateAtVersion, currentFromStore, type Thread } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import {
  PdfSession,
  emptyDoc,
  hashPdfDoc,
  openPdf,
  pdfReducer,
  pdfSyncModel,
  pdfVersionHistory,
  pdfVersionSupport,
  readPdf,
  restorePdfOps,
  selectionAfterRestore,
  summarizePdfDiff,
  summarizePdfOps,
  type Annotation,
  type FormField,
  type OutlineItem,
  type Page,
  type PdfAnchor,
  type PdfDoc,
  type PdfOp,
  type PdfSelection,
  type Source,
} from "../src";
import { buildClassic, simpleDoc } from "./support/handmade";

// ---- Building blocks -----------------------------------------------------------------------------------------

const canonical = (doc: PdfDoc): string => canonicalJson(doc);
const apply = (doc: PdfDoc, ops: readonly PdfOp[]): PdfDoc => ops.reduce((d, op) => pdfReducer.apply(d, op).state, doc);

const page = (id: string, extra: Partial<Page> = {}): Page => ({ id, from: null, width: 200, height: 300, rotate: 0, annots: [], ...extra });
const doc = (pages: Page[], extra: Partial<PdfDoc> = {}): PdfDoc => ({ ...emptyDoc("d"), pages, ...extra });
const stroke = { color: "#ff0000", width: 2 };
const rect = { x: 10, y: 20, w: 50, h: 30 };

/** One annotation of every type. */
const everyAnnot = (n: string): Annotation[] => [
  { id: `${n}-hl`, type: "highlight", color: "#ffeb3b", rects: [rect], quote: "hello" },
  { id: `${n}-ul`, type: "underline", color: "#00f", rects: [rect] },
  { id: `${n}-so`, type: "strikeout", color: "#f00", rects: [rect, rect] },
  { id: `${n}-sq`, type: "squiggly", color: "#0f0", rects: [rect] },
  { id: `${n}-ink`, type: "ink", strokes: [[[1, 2], [3, 4], [5, 6]]], stroke },
  { id: `${n}-sqr`, type: "square", rect, stroke, fill: "#eee" },
  { id: `${n}-cir`, type: "circle", rect, stroke },
  { id: `${n}-line`, type: "line", from: [0, 0], to: [50, 50], stroke, endEnd: "arrow" },
  { id: `${n}-poly`, type: "polygon", points: [[0, 0], [10, 0], [5, 9]], stroke, fill: "#fa0" },
  { id: `${n}-pl`, type: "polyline", points: [[0, 0], [10, 0], [5, 9]], stroke },
  { id: `${n}-ft`, type: "freetext", rect, text: "Hi", style: { family: "Helvetica", size: 12, color: "#000" } },
  { id: `${n}-note`, type: "note", x: 5, y: 6, contents: "A note", thread: `${n}-th` },
  { id: `${n}-st1`, type: "stamp", rect, stamp: { name: "Approved" } },
  { id: `${n}-st2`, type: "stamp", rect, stamp: { picture: { src: "data:image/png;base64,AAAA", width: 4, height: 4 } } },
  { id: `${n}-sig`, type: "signature", rect, mode: "draw", strokes: [[[0, 0], [5, 5]]], color: "#000", width: 2 },
  { id: `${n}-img`, type: "image", rect, picture: { src: "https://example.test/a.png" } },
  { id: `${n}-link`, type: "link", rect, uri: "https://example.test" },
  { id: `${n}-red`, type: "redact", rects: [rect], fill: "#000", overlay: "X" },
];

const textField = (id: string, value: string | null = null): FormField => ({ id, name: id, type: "text", value, widgets: [{ id: `${id}-w`, page: "p1", rect }] });
const thread = (id: string, body = "Hello"): Thread<PdfAnchor> => ({ id, anchor: { page: "p1", x: 1, y: 2 }, comments: [{ id: `${id}-c`, author: "u", body, createdAt: 1 }], createdAt: 1 });
const mainSource: Source = { id: "main", name: "a.pdf", pages: 3, size: 100, hash: "h1" };

/** What restoring `target` onto `current` does: the result must be `target`. */
function restores(current: PdfDoc, target: PdfDoc): PdfOp[] {
  const ops = restorePdfOps(current, target);
  const result = apply(current, ops);
  expect(canonical(result)).toBe(canonical(target));
  return ops;
}

const types = (ops: readonly PdfOp[]) => ops.map((o) => o.type);

// ---- Per entity ----------------------------------------------------------------------------------------------

describe("restoring a version of a PDF: one case per kind of thing", () => {
  const base = () => doc([page("p1"), page("p2"), page("p3")], { sources: [mainSource] });

  it("does nothing when nothing differs, and ignores key order and undefined", () => {
    const a = base();
    expect(restorePdfOps(a, structuredClone(a))).toEqual([]);
    const b = structuredClone(a);
    b.pages[0] = { ...b.pages[0]!, label: undefined };
    expect(restorePdfOps(a, b)).toEqual([]);
  });

  it("puts back a deleted page with its annotations, in place", () => {
    const then = base();
    then.pages[1] = page("p2", { annots: [everyAnnot("x")[0]!], label: "ii" });
    const now = apply(then, [{ type: "remove_page", id: "p2" }]);
    const ops = restores(now, then);
    expect(ops).toEqual([{ type: "insert_page", page: then.pages[1], after: "p1" }]);
  });

  it("deletes pages that the version does not have, taking their annotations (no per-annotation operations)", () => {
    const then = base();
    const now = apply(then, [
      { type: "insert_page", page: page("n1", { annots: [everyAnnot("y")[0]!, everyAnnot("y")[1]!] }), after: "p1" },
      { type: "insert_page", page: page("n2"), after: null },
    ]);
    const ops = restores(now, then);
    expect(types(ops)).toEqual(["remove_page", "remove_page"]);
  });

  it("moves pages back with the fewest moves", () => {
    const then = doc(["a", "b", "c", "d", "e"].map((id) => page(id)));
    // "a" went to the end: one move puts it back
    const now = apply(then, [{ type: "move_page", id: "a", after: "e" }]);
    expect(restores(now, then)).toEqual([{ type: "move_page", id: "a", after: null }]);
    // reversed order
    const reversed = apply(then, [
      { type: "move_page", id: "e", after: null },
      { type: "move_page", id: "d", after: "e" },
      { type: "move_page", id: "c", after: "d" },
      { type: "move_page", id: "b", after: "c" },
    ]);
    expect(reversed.pages.map((p) => p.id)).toEqual(["e", "d", "c", "b", "a"]);
    expect(restores(reversed, then)).toHaveLength(4);
  });

  it("rotates, resizes and relabels pages back, and removes a label that was added", () => {
    const then = doc([page("p1", { label: "i" }), page("p2")]);
    const now = apply(then, [
      { type: "patch_page", id: "p1", patch: { rotate: 90, width: 100, label: null } },
      { type: "patch_page", id: "p2", patch: { label: "A-1", rotate: 270 } },
    ]);
    const ops = restores(now, then);
    expect(ops).toHaveLength(2);
    expect(ops[1]).toEqual({ type: "patch_page", id: "p2", patch: { rotate: 0, label: null } });
  });

  it("replaces a page whose source changed", () => {
    const then = doc([page("p1", { from: { source: "main", index: 0 } })], { sources: [mainSource] });
    const now = doc([page("p1", { from: { source: "other", index: 2 } })], { sources: [mainSource, { id: "other", name: "o.pdf", pages: 3, size: 5, hash: "h2" }] });
    expect(types(restores(now, then))).toEqual(["remove_source", "remove_page", "insert_page"]);
  });

  it("brings back every type of annotation that was deleted, and removes every type that was added", () => {
    const all = everyAnnot("a");
    const withAll = doc([page("p1", { annots: all }), page("p2")]);
    const without = doc([page("p1"), page("p2")]);
    const del = restores(without, withAll);
    expect(del.map((o) => o.type)).toEqual(all.map(() => "insert_annot"));
    // inserted in drawing order: each one above the one before
    expect(del.map((o) => (o as { after: string | null }).after)).toEqual([null, ...all.slice(0, -1).map((a) => a.id)]);
    const add = restores(withAll, without);
    expect(types(add)).toEqual(all.map(() => "remove_annot"));
  });

  it("changes annotations back, only the ones that changed", () => {
    const all = everyAnnot("a");
    const then = doc([page("p1", { annots: all })]);
    const now = structuredClone(then);
    const changed = now.pages[0]!.annots.map((a, i) => (i % 5 === 0 ? ({ ...a, contents: "edited" } as Annotation) : a));
    now.pages[0]!.annots = changed;
    const ops = restores(now, then);
    expect(ops).toHaveLength(Math.ceil(all.length / 5));
    expect(new Set(types(ops))).toEqual(new Set(["replace_annot"]));
  });

  it("restores the drawing order of annotations", () => {
    const [a, b, c, d] = everyAnnot("o").slice(0, 4) as [Annotation, Annotation, Annotation, Annotation];
    const then = doc([page("p1", { annots: [a, b, c, d] })]);
    const now = apply(then, [{ type: "move_annot", id: "o-hl", after: "o-sq" }]);
    expect(now.pages[0]!.annots.map((x) => x.id)).toEqual(["o-ul", "o-so", "o-sq", "o-hl"]);
    expect(restores(now, then)).toEqual([{ type: "move_annot", id: "o-hl", after: null }]);
  });

  it("moves an annotation back to the page it was on", () => {
    const [a, b] = everyAnnot("m") as [Annotation, Annotation];
    const then = doc([page("p1", { annots: [a, b] }), page("p2")]);
    const now = apply(then, [
      { type: "remove_annot", page: "p1", id: "m-hl" },
      { type: "insert_annot", page: "p2", annot: a, after: null },
    ]);
    expect(types(restores(now, then))).toEqual(["remove_annot", "insert_annot"]);
  });

  it("keeps annotations of a page that was deleted when they were moved to a page that stays", () => {
    const [a] = everyAnnot("k") as [Annotation];
    const then = doc([page("p1"), page("p2", { annots: [a] })]);
    const now = apply(then, [
      { type: "remove_annot", page: "p2", id: a.id },
      { type: "insert_annot", page: "p1", annot: a, after: null },
      { type: "remove_page", id: "p2" },
    ]);
    restores(now, then);
    restores(then, now);
  });

  it("restores form values and fields", () => {
    const then = doc([page("p1")], { fields: [textField("a", "one"), textField("b"), { ...textField("c"), type: "checkbox", value: true }] });
    const now = apply(then, [
      { type: "set_value", id: "a", value: "changed" },
      { type: "set_value", id: "c", value: false },
      { type: "remove_field", id: "b" },
      { type: "insert_field", field: textField("new", "x"), after: null },
    ]);
    const ops = restores(now, then);
    expect(types(ops).sort()).toEqual(["insert_field", "remove_field", "set_value", "set_value"]);
    // a field whose settings changed is replaced whole
    const styled = apply(then, [{ type: "replace_field", field: { ...then.fields[0]!, tooltip: "T", flags: { required: true } } }]);
    expect(types(restores(styled, then))).toEqual(["replace_field"]);
  });

  it("restores the order of form fields", () => {
    const then = doc([page("p1")], { fields: ["a", "b", "c", "d"].map((id) => textField(id, id)) });
    const now = apply(then, [
      { type: "remove_field", id: "a" },
      { type: "insert_field", field: then.fields[0]!, after: "d" },
    ]);
    expect(now.fields.map((f) => f.id)).toEqual(["b", "c", "d", "a"]);
    restores(now, then);
  });

  it("restores the outline, the page edits, the properties and the name", () => {
    const outline: OutlineItem[] = [{ id: "o1", title: "One", dest: { page: "p1" }, children: [{ id: "o2", title: "Two", dest: { page: "p2", y: 10 }, children: [] }] }];
    const edits = [
      { id: "e1", type: "text" as const, run: "r1", text: "New", oldText: "Old" },
      { id: "e2", type: "image" as const, target: "i1", picture: null },
      { id: "e3", type: "redact" as const, rects: [rect], fill: "#000" },
    ];
    const then = doc([page("p1", { edits }), page("p2")], { outline, meta: { title: "T", author: "A" }, name: "a.pdf" });
    const now = apply(then, [
      { type: "set_outline", items: [] },
      { type: "set_edits", page: "p1", edits: [] },
      { type: "set_edits", page: "p2", edits: [edits[0]!] },
      { type: "set_meta", patch: { title: "Other", subject: "S", author: null, name: null } },
    ]);
    const ops = restores(now, then);
    expect(types(ops)).toEqual(["set_meta", "set_edits", "set_edits", "set_outline"]);
  });

  it("restores comment threads kept in the document", () => {
    const then = doc([page("p1")], { comments: { t1: thread("t1"), t2: thread("t2", "Second") } });
    const now = apply(then, [
      { type: "set_thread", id: "t1", thread: thread("t1", "Edited") },
      { type: "set_thread", id: "t2", thread: null },
      { type: "set_thread", id: "t3", thread: thread("t3") },
    ]);
    expect(types(restores(now, then)).sort()).toEqual(["set_thread", "set_thread", "set_thread"]);
    // down to no threads at all
    restores(then, doc([page("p1")]));
  });

  it("adds, changes and removes sources, and keeps their order", () => {
    const s = (id: string, hash = "h"): Source => ({ id, name: `${id}.pdf`, pages: 2, size: 9, hash });
    const then = doc([page("p1")], { sources: [s("main"), s("a"), s("b")] });
    const now = apply(then, [
      { type: "remove_source", id: "a" },
      { type: "patch_source", id: "b", patch: { hash: "changed", location: "x://y" } },
      { type: "insert_source", source: s("c") },
    ]);
    restores(now, then);
    // a new source is added at the end: nothing else is touched
    expect(restores(then, doc([page("p1")], { sources: [...then.sources, s("z")] }))).toEqual([{ type: "insert_source", source: s("z") }]);
    // different order
    restores(doc([page("p1")], { sources: [s("b"), s("main"), s("a")] }), then);
  });

  it("restores pages of a source that is not in the current document: the source entry comes with them", () => {
    const then = doc([page("p1", { from: { source: "main", index: 0 } }), page("p2", { from: { source: "extra", index: 0 } })], { sources: [mainSource, { id: "extra", name: "e.pdf", pages: 1, size: 7, hash: "hx", location: "s3://e" }] });
    const now = doc([page("p1", { from: { source: "main", index: 0 } })], { sources: [mainSource] });
    const ops = restores(now, then);
    expect(types(ops)).toEqual(["insert_source", "insert_page"]);
  });

  it("does not touch the document id", () => {
    const a = base();
    const b = { ...structuredClone(a), id: "other" };
    expect(restorePdfOps(a, b)).toEqual([]);
  });
});

// ---- The property test ---------------------------------------------------------------------------------------

/** A small deterministic random generator. */
function random(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!;
  return { next, int, pick, chance: (p: number) => next() < p };
}

/** A random valid operation for `d`. Ids are made from `tag` and a counter so that two runs never collide by accident. */
function randomOp(d: PdfDoc, rnd: ReturnType<typeof random>, tag: string, counter: { n: number }): PdfOp | null {
  const id = (k: string) => `${tag}${k}${counter.n++}`;
  const pages = d.pages;
  const anyPage = () => rnd.pick(pages);
  const allAnnots = pages.flatMap((p) => p.annots.map((a) => ({ page: p, annot: a })));
  const newAnnot = (): Annotation => {
    const a = rnd.pick(everyAnnot(id("n")));
    return { ...a, id: id("a"), ...(rnd.chance(0.3) ? { contents: `c${rnd.int(100)}` } : {}) } as Annotation;
  };
  const afterOf = <T extends { id: string }>(list: readonly T[]): string | null => (list.length === 0 || rnd.chance(0.3) ? null : rnd.pick(list).id);
  switch (rnd.int(26)) {
    case 0:
    case 1:
      return { type: "insert_page", page: page(id("p"), { rotate: rnd.pick([0, 90, 180, 270] as const), width: 100 + rnd.int(300), annots: rnd.chance(0.4) ? [newAnnot()] : [], from: rnd.chance(0.5) && d.sources.length ? { source: rnd.pick(d.sources).id, index: rnd.int(5) } : null }), after: rnd.chance(0.2) ? undefined : afterOf(pages) };
    case 2:
      return pages.length > 1 ? { type: "remove_page", id: anyPage().id } : null;
    case 3:
    case 4:
      return pages.length > 1 ? { type: "move_page", id: anyPage().id, after: afterOf(pages) } : null;
    case 5:
      return pages.length ? { type: "patch_page", id: anyPage().id, patch: rnd.pick<PdfOp & { type: "patch_page" } extends { patch: infer P } ? P : never>([{ rotate: rnd.pick([0, 90, 180, 270] as const) }, { label: `L${rnd.int(9)}` }, { label: null }, { width: 50 + rnd.int(50), height: 60 }]) } : null;
    case 6:
    case 7:
    case 8:
      return pages.length ? { type: "insert_annot", page: anyPage().id, annot: newAnnot(), after: rnd.chance(0.2) ? undefined : afterOf(anyPage().annots) } : null;
    case 9: {
      if (!allAnnots.length) return null;
      const { page: p, annot } = rnd.pick(allAnnots);
      return { type: "remove_annot", page: p.id, id: annot.id };
    }
    case 10:
    case 11: {
      if (!allAnnots.length) return null;
      const { annot } = rnd.pick(allAnnots);
      return { type: "replace_annot", annot: { ...annot, contents: `edit${rnd.int(1000)}`, opacity: rnd.chance(0.5) ? 0.5 : undefined } as Annotation };
    }
    case 12:
    case 13: {
      if (!allAnnots.length) return null;
      const { page: p, annot } = rnd.pick(allAnnots);
      return { type: "move_annot", id: annot.id, after: afterOf(p.annots) };
    }
    case 14:
      return { type: "insert_field", field: textField(id("f"), rnd.chance(0.5) ? `v${rnd.int(9)}` : null), after: rnd.chance(0.2) ? undefined : afterOf(d.fields) };
    case 15:
      return d.fields.length ? { type: "remove_field", id: rnd.pick(d.fields).id } : null;
    case 16:
      return d.fields.length ? { type: "replace_field", field: { ...rnd.pick(d.fields), tooltip: `t${rnd.int(5)}`, options: [{ value: "a" }] } } : null;
    case 17:
    case 18:
      return d.fields.length ? { type: "set_value", id: rnd.pick(d.fields).id, value: rnd.pick<FormField["value"]>(["x", "", null, true, false, ["a", "b"]]) } : null;
    case 19:
      return { type: "set_outline", items: pages.length ? [{ id: id("o"), title: `T${rnd.int(9)}`, dest: { page: anyPage().id }, children: rnd.chance(0.5) ? [{ id: id("o"), title: "child", children: [] }] : [] }] : [] };
    case 20:
      return pages.length ? { type: "set_edits", page: anyPage().id, edits: rnd.chance(0.3) ? [] : [{ id: id("e"), type: "text", run: "r", text: `t${rnd.int(9)}` }, { id: id("e"), type: "redact", rects: [rect] }] } : null;
    case 21:
      return { type: "set_meta", patch: rnd.pick([{ title: `T${rnd.int(5)}` }, { author: null }, { subject: "s", keywords: "k" }, { name: rnd.chance(0.5) ? "n.pdf" : null }]) };
    case 22: {
      const key = `t${rnd.int(4)}`;
      return { type: "set_thread", id: key, thread: rnd.chance(0.3) ? null : thread(key, `b${rnd.int(9)}`) };
    }
    case 23:
      return { type: "insert_source", source: { id: id("s"), name: "x.pdf", pages: 3, size: 10, hash: `h${rnd.int(9)}` } };
    case 24:
      return d.sources.length ? { type: "patch_source", id: rnd.pick(d.sources).id, patch: { hash: `h${rnd.int(99)}`, ...(rnd.chance(0.5) ? { location: "x://y" } : {}) } } : null;
    default:
      return d.sources.length > 1 ? { type: "remove_source", id: rnd.pick(d.sources).id } : null;
  }
}

/** Runs `count` random operations on `d`. */
function evolve(d: PdfDoc, rnd: ReturnType<typeof random>, tag: string, count: number, counter = { n: 0 }): PdfDoc {
  let out = d;
  for (let i = 0; i < count; i++) {
    // Now and then: an annotation moved to another page, or a page swapped for one with the same id from another place.
    if (rnd.chance(0.06) && out.pages.length > 1) {
      const holders = out.pages.filter((p) => p.annots.length > 0);
      if (holders.length > 0) {
        const from = rnd.pick(holders);
        const annot = rnd.pick(from.annots);
        const to = rnd.pick(out.pages.filter((p) => p.id !== from.id));
        out = apply(out, [
          { type: "remove_annot", page: from.id, id: annot.id },
          { type: "insert_annot", page: to.id, annot, after: rnd.chance(0.5) ? null : to.annots[0]?.id ?? null },
        ]);
        continue;
      }
    }
    if (rnd.chance(0.03) && out.pages.length > 1) {
      const target = rnd.pick(out.pages);
      const at = out.pages.indexOf(target);
      out = apply(out, [
        { type: "remove_page", id: target.id },
        { type: "insert_page", page: { ...target, from: { source: "main", index: rnd.int(9) } }, after: out.pages[at - 1]?.id ?? null },
      ]);
      continue;
    }
    const op = randomOp(out, rnd, tag, counter);
    if (!op) continue;
    out = pdfReducer.apply(out, op).state;
  }
  return out;
}

describe("restoring a version of a PDF: round trip property", () => {
  const start = () => doc([page("p1"), page("p2"), page("p3")], { sources: [mainSource] });

  it("restoreOps(B, A) applied to B equals A, for A -> B made of random operations", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = random(seed);
      const a = evolve(start(), rnd, "a", 5 + rnd.int(40));
      const b = evolve(a, rnd, "b", 1 + rnd.int(40));
      const ops = restorePdfOps(b, a);
      let result: PdfDoc;
      try {
        result = apply(b, ops);
      } catch (e) {
        throw new Error(`seed ${seed}: restore ops threw: ${(e as Error).message}`);
      }
      if (canonical(result) !== canonical(a)) throw new Error(`seed ${seed}: restore did not reach the version`);
      // and forward, from the old one to the new
      expect(canonical(apply(a, restorePdfOps(a, b)))).toBe(canonical(b));
    }
  });

  it("works between two unrelated documents (nothing shared but the id)", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const x = evolve(start(), random(seed), "x", 30);
      const y = evolve(start(), random(seed + 1000), "y", 30);
      expect(canonical(apply(x, restorePdfOps(x, y)))).toBe(canonical(y));
      expect(canonical(apply(y, restorePdfOps(y, x)))).toBe(canonical(x));
    }
  });

  it("is minimal: a single change is a single operation, and restoring twice is a no-op", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = random(seed);
      const a = evolve(start(), rnd, "a", 30);
      const op = (() => {
        for (let i = 0; i < 20; i++) {
          const o = randomOp(a, rnd, "s", { n: 0 });
          if (o && ["patch_page", "replace_annot", "set_value", "remove_annot", "set_outline", "set_meta"].includes(o.type)) return o;
        }
        return null;
      })();
      if (!op) continue;
      const b = pdfReducer.apply(a, op).state;
      if (canonical(a) === canonical(b)) continue;
      expect(restorePdfOps(b, a).length).toBeLessThanOrEqual(2);
      expect(restorePdfOps(apply(b, restorePdfOps(b, a)), a)).toEqual([]);
    }
  });

  it("every restore operation is valid for the reducer when applied one at a time to a sequence of random versions", () => {
    const rnd = random(99);
    const versions: PdfDoc[] = [start()];
    for (let i = 0; i < 12; i++) versions.push(evolve(versions[i]!, rnd, `v${i}`, 15));
    let now = versions[versions.length - 1]!;
    for (let i = 0; i < 40; i++) {
      const target = rnd.pick(versions);
      now = apply(now, restorePdfOps(now, target));
      expect(canonical(now)).toBe(canonical(target));
    }
  });
});

// ---- Saying what changed -------------------------------------------------------------------------------------

describe("what a restore says it changes", () => {
  const four = () => doc([page("p1"), page("p2"), page("p3"), page("p4")]);

  it("says what was added and deleted, with pages numbered by position at that time", () => {
    const d = four();
    const ops: PdfOp[] = [
      ...everyAnnot("s").slice(0, 3).map((annot) => ({ type: "insert_annot" as const, page: "p1", annot, after: null })),
      { type: "remove_page", id: "p4" },
    ];
    expect(summarizePdfOps(ops, d)).toBe("Added 3 annotations, deleted page 4");
    // numbered as it goes: after page 1 is gone, "p3" is page 2
    expect(summarizePdfOps([{ type: "remove_page", id: "p1" }, { type: "remove_page", id: "p3" }], d)).toBe("Deleted 2 pages");
    expect(summarizePdfOps([{ type: "remove_page", id: "p1" }], d)).toBe("Deleted page 1");
    expect(summarizePdfOps([{ type: "insert_page", page: page("n"), after: "p2" }], d)).toBe("Added page 3");
  });

  it("says what was rotated, filled, changed and moved, with plurals", () => {
    const d = doc([page("p1"), page("p2")], { fields: ["a", "b", "c", "d", "e"].map((id) => textField(id)) });
    expect(
      summarizePdfOps(
        [
          { type: "patch_page", id: "p1", patch: { rotate: 90 } },
          { type: "patch_page", id: "p2", patch: { rotate: 90 } },
          ...(["a", "b", "c", "d", "e"] as const).map((id) => ({ type: "set_value" as const, id, value: "x" })),
        ],
        d,
      ),
    ).toBe("Rotated 2 pages, filled 5 form fields");
    expect(summarizePdfOps([{ type: "patch_page", id: "p1", patch: { rotate: 90 } }, { type: "set_value", id: "a", value: "x" }], d)).toBe("Rotated 1 page, filled 1 form field");
    expect(summarizePdfOps([{ type: "set_value", id: "a", value: null }], d)).toBe("Cleared 1 form field");
    expect(summarizePdfOps([{ type: "set_outline", items: [] }, { type: "set_meta", patch: { title: "x" } }, { type: "move_page", id: "p2", after: null }], d)).toBe("Moved 1 page, changed the outline, changed the document properties");
  });

  it("says 'No changes' for nothing", () => {
    expect(summarizePdfOps([], four())).toBe("No changes");
    const d = four();
    expect(summarizePdfDiff(d, structuredClone(d)).lines).toEqual(["No changes"]);
  });

  it("describes what turns one version into another, with counts", () => {
    const then = doc([page("p1", { annots: everyAnnot("q").slice(0, 2) }), page("p2"), page("p3")]);
    const now = apply(then, [
      { type: "remove_page", id: "p3" },
      { type: "insert_annot", page: "p2", annot: everyAnnot("w")[0]!, after: null },
      { type: "patch_page", id: "p1", patch: { rotate: 180 } },
    ]);
    expect(summarizePdfDiff(then, now)).toEqual({ added: 1, removed: 1, changed: 1, lines: ["Added 1 annotation, rotated 1 page, deleted page 3"] });
    expect(summarizePdfDiff(now, then)).toEqual({ added: 1, removed: 1, changed: 1, lines: ["Added page 3, rotated 1 page, deleted 1 annotation"] });
  });

  it("is the support a history uses", () => {
    expect(pdfVersionSupport.restoreOps).toBe(restorePdfOps);
    expect(pdfVersionSupport.summarize).toBe(summarizePdfDiff);
  });
});

// ---- Through a session: one undo step ------------------------------------------------------------------------

describe("restoring through a PdfSession", () => {
  const users = (role: "editor" | "viewer" = "editor") => new Users({ current: { id: "ana", name: "Ana" }, role });

  async function rig() {
    const d = doc([page("p1", { annots: everyAnnot("a").slice(0, 3) }), page("p2"), page("p3")], { fields: [textField("name")], sources: [mainSource], meta: { title: "Plan" } });
    const session = new PdfSession(d);
    const storage = memoryVersionStorage<PdfDoc>();
    const history = pdfVersionHistory(session, { storage, users: users(), now: (() => { let t = 1000; return () => t++; })() });
    await history.ready;
    return { session, storage, history };
  }

  it("restores everything as ONE undo step, and undo brings back the state from just before", async () => {
    const { session, history } = await rig();
    const version = await history.save("Sent to legal");
    const snapshot = structuredClone(session.doc);
    // a lot of editing after the version, with many separate steps
    session.annots.addHighlight("p2", [rect]);
    session.pages.rotate(["p1"], 90);
    session.forms.setValue("name", "Sam");
    session.pages.remove(["p3"]);
    session.outline.set([{ id: "o1", title: "Intro", dest: { page: "p1" }, children: [] }]);
    session.core.transact([{ type: "set_meta", patch: { title: "Changed" } }]);
    const before = structuredClone(session.doc);
    expect(canonical(before)).not.toBe(canonical(snapshot));

    await history.restore(version.id);
    expect(canonical(session.doc)).toBe(canonical(snapshot));
    expect(hashPdfDoc(session.doc)).toBe(version.hash);

    // The state before the restore was kept as a version of its own.
    expect(history.versions.some((v) => v.automatic && v.hash === hashPdfDoc(before))).toBe(true);

    expect(session.undo()).toBe(true);
    expect(canonical(session.doc)).toBe(canonical(before));
    expect(session.redo()).toBe(true);
    expect(canonical(session.doc)).toBe(canonical(snapshot));
    // one step: a second undo is the edit before the restore, not part of it
    session.undo();
    session.undo();
    expect(canonical(session.doc)).not.toBe(canonical(snapshot));
    expect(canonical(session.doc)).not.toBe(canonical(before));
  });

  it("restores nothing when the document is the version, and says so in the comparison", async () => {
    const { session, history } = await rig();
    const version = await history.save("Same");
    expect(history.compare(version.id).lines).toEqual(["No changes"]);
    const steps = session.canUndo;
    await history.restore(version.id);
    expect(session.canUndo).toBe(steps);
    session.pages.rotate(["p2"], 90);
    expect(history.compare(version.id).lines).toEqual(["Rotated 1 page"]);
  });

  it("keeps the selection where it still points, and moves the page shown to a page that exists", async () => {
    const { session, history } = await rig();
    const version = await history.save("Three pages");
    session.pages.remove(["p3"]);
    session.annots.addHighlight("p2", [rect]);
    const added = session.doc.pages[1]!.annots[0]!.id;
    session.select({ page: "p2", annots: [added, "a-hl"] });
    await history.restore(version.id);
    // the highlight made after the version is gone; the one that was there stays selected; page 2 is still there
    expect(session.selection).toMatchObject({ page: "p2", annots: ["a-hl"] });
    // a page that went away: the page now at its place
    const sel: PdfSelection = { page: "gone", annots: ["x"], pages: ["gone", "p1"] };
    const before = doc([page("p1"), page("gone"), page("p3")]);
    const after = doc([page("p1"), page("p3")]);
    expect(selectionAfterRestore(sel, before, after)).toEqual({ page: "p3", annots: [], pages: ["p1"] });
    expect(selectionAfterRestore({ page: "p3", annots: [] }, doc([page("p1"), page("p3")]), doc([page("p1")]))).toEqual({ page: "p1", annots: [] });
    expect(selectionAfterRestore({ page: "p1", annots: [] }, doc([page("p1")]), doc([])).page).toBeNull();
  });

  it("only editors may restore", async () => {
    const session = new PdfSession(doc([page("p1")]));
    const history = pdfVersionHistory(session, { storage: memoryVersionStorage<PdfDoc>(), users: users("viewer") });
    await history.ready;
    expect(history.canEdit).toBe(false);
    await expect(history.save("x")).rejects.toThrow(/Only editors/);
  });
});

// ---- Two clients over a live room ----------------------------------------------------------------------------

describe("restoring a version while the file is shared", () => {
  const bytes = buildClassic(simpleDoc(3)).bytes;

  async function rig() {
    const store = memoryDocumentStore<PdfDoc, PdfOp>();
    const authority = createAuthority({ store, model: pdfSyncModel, create: () => readPdf(bytes).doc });
    const receivers: ((d: unknown) => void)[] = [];
    const transport = () => {
      let me = -1;
      return {
        connect: (_room: string, receive: (d: unknown) => void) => void (me = receivers.push(receive) - 1),
        send: (data: unknown) =>
          queueMicrotask(() => {
            const copy = JSON.parse(JSON.stringify(data)) as unknown;
            if (isSyncMessage(copy)) void authority.receive("r", copy, (env) => receivers.forEach((r) => r(JSON.parse(JSON.stringify(env)))));
            else receivers.forEach((r, i) => i !== me && r(copy));
          }),
        disconnect: () => {},
      };
    };
    const storage = memoryVersionStorage<PdfDoc>();
    const join = async (id: string) => {
      const users = new Users({ current: { id, name: id }, role: "editor" });
      const session = await openPdf(bytes, { user: { id, name: id } });
      const room = new CollabRoom<PdfAnchor>({ room: "r", transport: transport(), users });
      const sync = new SyncClient<PdfDoc, PdfOp, PdfSelection>({ session: session.core, room, model: pdfSyncModel, version: 0, verifyEvery: 0 });
      await room.connect();
      sync.start();
      const history = pdfVersionHistory(session, { storage, users, file: "f", version: () => sync.version });
      await history.ready;
      return { session, sync, history };
    };
    const settle = async () => {
      for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 3));
    };
    return { join, settle, store, storage };
  }

  it("converges: A edits, A names a version, A edits more, B restores; the restore is B's undo step only", async () => {
    const { join, settle, store, storage } = await rig();
    const a = await join("a");
    const b = await join("b");
    const c = await join("c");
    await settle();
    const [p1, p2, p3] = a.session.doc.pages.map((p) => p.id) as [string, string, string];

    a.session.annots.addHighlight(p1, [rect]);
    a.session.pages.rotate([p2], 90);
    await settle();
    const version = await a.history.save("Draft");
    expect(version.version).toBe(a.sync.version);
    const snapshot = structuredClone(a.session.doc);

    a.session.annots.addHighlight(p2, [rect]);
    a.session.pages.remove([p3]);
    a.session.pages.rotate([p1], 180);
    await settle();
    expect(hashPdfDoc(b.session.doc)).toBe(hashPdfDoc(a.session.doc));
    expect(b.session.doc.pages).toHaveLength(2);
    const beforeRestore = structuredClone(b.session.doc);
    expect(c.session.canUndo).toBe(false);

    await b.history.reload();
    expect(b.history.versions.map((v) => v.name)).toEqual(["Draft"]);
    await b.history.restore(version.id);
    await settle();

    for (const client of [a, b, c]) {
      expect(canonical(client.session.doc)).toBe(canonical(snapshot));
      expect(hashPdfDoc(client.session.doc)).toBe(version.hash);
    }
    // the server's copy agrees
    const server = await currentFromStore(store, pdfSyncModel, "r");
    expect(hashPdfDoc(server!.state)).toBe(version.hash);
    // B's own step: B can undo it, and everyone follows. C made no edits and has nothing to undo.
    expect(b.session.canUndo).toBe(true);
    expect(c.session.canUndo).toBe(false);
    // a "Before restoring" copy was kept for the way back
    await b.history.reload();
    expect(b.history.versions.some((v) => v.automatic && v.hash === hashPdfDoc(beforeRestore))).toBe(true);

    b.session.undo();
    await settle();
    for (const client of [a, b, c]) expect(canonical(client.session.doc)).toBe(canonical(beforeRestore));
    // The one A named, what B had before restoring it, and the restore itself.
    expect(storage.count("f")).toBe(3);
  });

  it("restores a version that the server saved with no editor open", async () => {
    const { join, settle, store, storage } = await rig();
    const a = await join("a");
    const b = await join("b");
    await settle();
    const [p1, p2] = a.session.doc.pages.map((p) => p.id) as [string, string];
    a.session.pages.rotate([p1], 90);
    await settle();
    const saved = await versionFromStore({ store, model: pdfSyncModel, storage, room: "r", file: "f", name: "Nightly", by: "system" });
    expect(saved.hash).toBe(hashPdfDoc(a.session.doc));
    expect(saved.version).toBe(a.sync.version);
    expect(canonical((await stateAtVersion(store, pdfSyncModel, "r", saved.version!))!)).toBe(canonical(saved.state));
    a.session.pages.rotate([p2], 180);
    a.session.annots.addHighlight(p1, [rect]);
    await settle();
    await b.history.reload();
    await b.history.restore(saved.id);
    await settle();
    expect(hashPdfDoc(a.session.doc)).toBe(saved.hash);
    expect(hashPdfDoc(b.session.doc)).toBe(saved.hash);
  });

  it("merges with an edit made at the same moment", async () => {
    const { join, settle } = await rig();
    const a = await join("a");
    const b = await join("b");
    await settle();
    const [p1, p2] = a.session.doc.pages.map((p) => p.id) as [string, string];
    const version = await a.history.save("Start");
    a.session.pages.rotate([p1], 90);
    await settle();
    await b.history.reload();
    // B restores while A rotates another page: both land
    const restoring = b.history.restore(version.id);
    a.session.pages.rotate([p2], 180);
    await restoring;
    await settle();
    expect(hashPdfDoc(a.session.doc)).toBe(hashPdfDoc(b.session.doc));
    expect(a.session.doc.pages[0]!.rotate).toBe(0);
    expect(a.session.doc.pages[1]!.rotate).toBe(180);
  });
});
