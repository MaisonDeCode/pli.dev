import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DeckSession, createDeck, fromPptx, paragraphsFromText, toPotx, toPptx, type Deck, type DeckAnchor } from "../src";
import type { Thread } from "@pli.dev/core";

/** A deck with a thread of each kind: on a slide, on a shape, on some words, with replies, resolved. */
function commented(): { deck: Deck; slide: string; shape: string } {
  const s = new DeckSession(createDeck({ title: "Comments" }));
  const slide = s.deck.slides[0]!.id;
  const shape = s.deck.slides[0]!.elements[0]!.id;
  s.setText(slide, shape, paragraphsFromText("Annual plan for next year"));
  const second = s.addSlide();
  const threads: Thread<DeckAnchor>[] = [
    { id: "th_slide", anchor: { slide, point: { x: 100, y: 50 } }, createdAt: 1_700_000_000_000, comments: [{ id: "cm_1", author: "ada", body: "Check the title slide", createdAt: 1_700_000_000_000 }] },
    {
      id: "th_shape",
      anchor: { slide, element: shape, quote: "Annual plan" },
      createdAt: 1_700_000_100_000,
      comments: [
        { id: "cm_2", author: "grace", body: "Rename this?\nSecond line", createdAt: 1_700_000_100_000, mentions: ["ada"] },
        { id: "cm_3", author: "ada", body: "Yes, done", createdAt: 1_700_000_200_000 },
        { id: "cm_4", author: "grace", body: "Thanks", createdAt: 1_700_000_300_000 },
      ],
      resolved: { by: "grace", at: 1_700_000_400_000 },
    },
    { id: "th_text", anchor: { slide, element: shape, text: { from: 7, to: 11 }, quote: "plan" }, createdAt: 1_700_000_500_000, comments: [{ id: "cm_5", author: "ada", body: "Which plan?", createdAt: 1_700_000_500_000 }] },
    { id: "th_two", anchor: { slide: second.id }, createdAt: 1_700_000_600_000, comments: [{ id: "cm_6", author: "grace", body: "Empty slide", createdAt: 1_700_000_600_000 }] },
    { id: "th_gone", anchor: { slide: "deleted-slide" }, createdAt: 1_700_000_700_000, comments: [{ id: "cm_7", author: "ada", body: "On a deleted slide", createdAt: 1_700_000_700_000 }] },
  ];
  const deck: Deck = { ...s.deck, comments: Object.fromEntries(threads.map((t) => [t.id, t])) };
  return { deck, slide, shape };
}

const names: Record<string, { name: string; initials?: string }> = { ada: { name: "Ada Lovelace", initials: "AL" }, grace: { name: "Grace Hopper", initials: "GH" } };
const byName = (a: { name: string }) => (a.name === "Ada Lovelace" ? "ada" : "grace");

/** The file without the extension Pli adds, as a file made by PowerPoint has none. */
function withoutPliExtension(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  for (const [name, data] of Object.entries(files)) {
    if (!/comments\/|authors|commentAuthors/.test(name) || name.endsWith(".rels")) continue;
    files[name] = strToU8(strFromU8(data).replace(/<p:ext uri="\{6F2D3B3E[^>]*>.*?<\/p:ext>/gs, "").replace(/<p188:extLst>.*?<\/p188:extLst>/gs, ""));
  }
  return zipSync(files);
}

describe.each(["legacy", "modern"] as const)("comments in a PPTX file (%s)", (mode) => {
  const files = (bytes: Uint8Array) => unzipSync(bytes);

  it("writes the parts, the authors and the relationships", () => {
    const { deck } = commented();
    const out = files(toPptx(deck, { comments: mode, commentAuthor: (id) => names[id] }));
    const list = Object.keys(out);
    if (mode === "legacy") {
      expect(list).toContain("ppt/commentAuthors.xml");
      expect(list.filter((n) => /^ppt\/comments\/comment\d+\.xml$/.test(n))).toHaveLength(2);
      expect(strFromU8(out["ppt/commentAuthors.xml"]!)).toContain('name="Ada Lovelace"');
      expect(strFromU8(out["ppt/commentAuthors.xml"]!)).toContain('initials="GH"');
    } else {
      expect(list).toContain("ppt/authors.xml");
      expect(list.filter((n) => /^ppt\/comments\/modernComment_/.test(n))).toHaveLength(2);
      expect(strFromU8(out["ppt/comments/" + list.find((n) => /modernComment_100_/.test(n))!.split("/").pop()!]!)).toContain('status="resolved"');
    }
    const types = strFromU8(out["[Content_Types].xml"]!);
    expect(types).toContain(mode === "legacy" ? "presentationml.comments+xml" : "application/vnd.ms-powerpoint.comments+xml");
    expect(strFromU8(out["ppt/_rels/presentation.xml.rels"]!)).toContain(mode === "legacy" ? "commentAuthors" : "relationships/authors");
  });

  it("gives the same threads back: authors, replies, resolved, the shape, the words", () => {
    const { deck, slide, shape } = commented();
    const back = fromPptx(toPptx(deck, { comments: mode, commentAuthor: (id) => names[id] }), { commentAuthor: byName });
    const threads = back.deck.comments!;
    expect(Object.keys(threads).sort()).toEqual(["th_shape", "th_slide", "th_text", "th_two"]);
    const s = threads.th_shape!;
    expect(s.comments.map((c) => [c.id, c.author, c.body])).toEqual([
      ["cm_2", "grace", "Rename this?\nSecond line"],
      ["cm_3", "ada", "Yes, done"],
      ["cm_4", "grace", "Thanks"],
    ]);
    expect(s.comments[0]!.mentions).toEqual(["ada"]);
    expect(s.resolved).toMatchObject({ by: "grace", at: 1_700_000_400_000 });
    expect(s.createdAt).toBe(1_700_000_100_000);
    expect(s.anchor).toMatchObject({ slide: back.deck.slides[0]!.id, element: back.deck.slides[0]!.elements[0]!.id, quote: "Annual plan" });
    expect(threads.th_slide!.anchor).toMatchObject({ slide: back.deck.slides[0]!.id });
    expect(threads.th_slide!.anchor!.point!.x).toBeCloseTo(100, 0);
    expect(threads.th_two!.anchor!.slide).toBe(back.deck.slides[1]!.id);
    expect(threads.th_text!.anchor!.text).toEqual({ from: 7, to: 11 });
    // the words are marked in the text, which is where the highlight comes from
    const run = (back.deck.slides[0]!.elements[0] as { text: { paragraphs: { runs: { text: string; marks?: { comment?: string[] } }[] }[] } }).text.paragraphs[0]!.runs;
    expect(run.map((r) => [r.text, r.marks?.comment ?? null])).toEqual([["Annual ", null], ["plan", ["th_text"]], [" for next year", null]]);
    expect(back.commentAuthors).toMatchObject({ ada: { name: "Ada Lovelace" }, grace: { name: "Grace Hopper" } });
    void slide;
    void shape;
  });

  it("reads a file PowerPoint made (no extension of ours): authors, text, replies and, in modern comments, the resolved state", () => {
    const { deck } = commented();
    const bytes = withoutPliExtension(toPptx(deck, { comments: mode, commentAuthor: (id) => names[id] }));
    const back = fromPptx(bytes, { commentAuthor: byName });
    const threads = Object.values(back.deck.comments!);
    expect(threads).toHaveLength(mode === "legacy" ? 4 : 4);
    const rename = threads.find((t) => t.comments[0]!.body.startsWith("Rename"))!;
    expect(rename.comments.map((c) => [c.author, c.body])).toEqual([["grace", "Rename this?\nSecond line"], ["ada", "Yes, done"], ["grace", "Thanks"]]);
    expect(rename.anchor!.slide).toBe(back.deck.slides[0]!.id);
    if (mode === "modern") {
      expect(rename.resolved).toBeTruthy();
      expect(rename.anchor!.element).toBe(back.deck.slides[0]!.elements[0]!.id);
    }
    // the second slide's comment stays on the second slide
    expect(threads.find((t) => t.comments[0]!.body === "Empty slide")!.anchor!.slide).toBe(back.deck.slides[1]!.id);
    expect(back.warnings.filter((w) => /omment/.test(w))).toEqual([]);
  });

  it("writes the same bytes twice and leaves comments out of a template", () => {
    const { deck } = commented();
    const date = new Date("2024-01-01T00:00:00Z");
    expect(toPptx(deck, { comments: mode, date })).toEqual(toPptx(deck, { comments: mode, date }));
    expect(Object.keys(unzipSync(toPotx(deck, { comments: mode }))).some((n) => /comment|authors/i.test(n))).toBe(false);
    expect(Object.keys(unzipSync(toPptx(deck, { comments: "none" }))).some((n) => /comment|authors/i.test(n))).toBe(false);
  });
});

describe("comments in a PPTX file", () => {
  it("writes a deck with no comments exactly as before", () => {
    const deck = createDeck();
    const names = Object.keys(unzipSync(toPptx(deck)));
    expect(names.some((n) => /comment|authors/i.test(n))).toBe(false);
    expect(fromPptx(toPptx(deck)).deck.comments).toBeUndefined();
  });

  it("tolerates a comments part that is broken", () => {
    const { deck } = commented();
    const files = unzipSync(toPptx(deck));
    for (const name of Object.keys(files)) if (/comments\/comment\d+\.xml$/.test(name)) files[name] = strToU8("<p:cmLst><p:cm");
    const back = fromPptx(zipSync(files));
    expect(back.deck.slides.length).toBe(2);
    expect(back.warnings.length).toBeGreaterThan(0);
  });
});
