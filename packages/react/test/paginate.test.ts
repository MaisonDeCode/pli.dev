import { describe, expect, it } from "vitest";
import { paginate, sameLayout, type BlockMetric, type LineInfo } from "../src/layout/paginate";

// Pages have a 250px content area and a 300px stride (50px of gap and margins).
const G = { stride: 300, content: 250 };

/** A block of fixed height with no lines, such as an image. */
function atom(id: string, top: number, height: number, extra: Partial<BlockMetric> = {}): BlockMetric {
  return { id, top, height, ...extra };
}

/** A text block made of `count` 20px lines, with 5px between blocks coming from the caller. */
function text(id: string, top: number, count: number, extra: Partial<BlockMetric> = {}): BlockMetric {
  const lines: LineInfo[] = Array.from({ length: count }, (_, i) => ({
    offset: i * 10,
    top: top + i * 20,
    bottom: top + (i + 1) * 20,
  }));
  return { id, top, height: count * 20, lines: () => lines, firstLineHeight: 20, ...extra };
}

describe("paginate", () => {
  it("leaves content that fits on one page alone", () => {
    const layout = paginate([text("a", 0, 3), text("b", 70, 3)], G);
    expect(layout.pages).toBe(1);
    expect(layout.before.size).toBe(0);
    expect(layout.splits.size).toBe(0);
    expect(layout.pageOf.get("b")).toBe(1);
  });

  it("moves an unsplittable block that would cross the page bottom onto the next page", () => {
    const layout = paginate([atom("a", 0, 100), atom("b", 110, 100), atom("c", 220, 100)], G);
    // c would run from 220 to 320, past the 250 limit, so it moves to 300.
    expect(layout.before.get("c")).toBe(80);
    expect(layout.pageOf.get("c")).toBe(2);
    expect(layout.pages).toBe(2);
    expect(layout.height).toBe(400);
  });

  it("splits a paragraph between lines and gaps it to the next page", () => {
    // 10 lines from y=200: lines 0-1 fit (to 240), line 2 (240-260) crosses the 250 limit.
    const layout = paginate([text("p", 200, 10)], G);
    expect(layout.splits.get("p")).toEqual([{ offset: 20, height: 60 }]);
    expect(layout.pages).toBe(2);
    expect(layout.pageOf.get("p")).toBe(1);
  });

  it("moves the whole paragraph rather than leave a single orphan line", () => {
    // Only one line (220-240) fits before the limit: move the block instead.
    const layout = paginate([text("p", 220, 6)], G);
    expect(layout.splits.size).toBe(0);
    expect(layout.before.get("p")).toBe(80);
    expect(layout.pageOf.get("p")).toBe(2);
  });

  it("pulls one more line over rather than strand a single widow line", () => {
    // 5 lines from y=170: lines at 170,190,210,230 fit (the 4th ends at 250). Line 4 (250-270)
    // would be alone on the next page, so line 3 goes with it.
    const layout = paginate([text("p", 170, 5)], G);
    expect(layout.splits.get("p")).toEqual([{ offset: 30, height: 300 - 230 }]);
  });

  it("splits a paragraph that spans several pages", () => {
    // 40 lines = 800px starting at the top of page 1.
    const layout = paginate([text("p", 0, 40)], G);
    const gaps = layout.splits.get("p")!;
    expect(gaps).toHaveLength(3);
    // Page 1 holds 12 lines (240px) before the 250 limit; each next page holds 12 as well.
    expect(gaps.map((s) => s.offset)).toEqual([120, 240, 360]);
    expect(layout.pages).toBe(4);
  });

  it("starts the block after a page break on a new page", () => {
    const layout = paginate([text("a", 0, 2), atom("brk", 45, 0, { pageBreak: true }), text("b", 50, 2)], G);
    expect(layout.pageOf.get("brk")).toBe(1);
    expect(layout.before.get("b")).toBe(250);
    expect(layout.pageOf.get("b")).toBe(2);
    expect(layout.pages).toBe(2);
  });

  it("keeps a heading with the start of the next block", () => {
    const heading = atom("h", 200, 30, { keepWithNext: true, firstLineHeight: 30 });
    const body = text("p", 238, 4);
    // The heading fits (to 230) but the first body line (238-258) would not, so the heading moves.
    const layout = paginate([heading, body], G);
    expect(layout.before.get("h")).toBe(100);
    expect(layout.pageOf.get("h")).toBe(2);
    expect(layout.pageOf.get("p")).toBe(2);
    expect(layout.before.has("p")).toBe(false);
  });

  it("does not push a heading that is already at the top of a page", () => {
    const layout = paginate([atom("h", 0, 30, { keepWithNext: true }), atom("tall", 38, 400)], G);
    expect(layout.before.has("h")).toBe(false);
  });

  it("lets a block taller than a page overflow instead of looping", () => {
    const layout = paginate([atom("big", 0, 600)], G);
    expect(layout.before.size).toBe(0);
    expect(layout.pages).toBeGreaterThanOrEqual(2);
  });

  it("moves a block that starts in the bottom margin", () => {
    const layout = paginate([atom("a", 0, 248), atom("b", 255, 20)], G);
    expect(layout.pageOf.get("b")).toBe(2);
    expect(layout.before.get("b")).toBe(45);
  });

  it("gives an empty document one page", () => {
    expect(paginate([], G).pages).toBe(1);
  });

  it("is stable: laying out the already spaced result adds nothing", () => {
    const blocks = [text("a", 0, 5), text("b", 110, 30), atom("c", 720, 100)];
    const first = paginate(blocks, G);
    const second = paginate(blocks, G);
    expect(sameLayout(first, second)).toBe(true);
  });
});

describe("repeated header rows", () => {
  // A header row (30px) and rows of 100px; content area 250, stride 300.
  const header = (top: number) => atom("h", top, 30, { keepWithNext: true, firstLineHeight: 30 });
  const row = (id: string, top: number) => atom(id, top, 100, { repeat: 30 });

  it("moves a row to the next page below a repeated copy of the header", () => {
    // Rows would sit at 40-140, 140-240, 240-340: the third doesn't fit.
    const layout = paginate([header(0), row("r1", 30), row("r2", 130), row("r3", 230)], G);
    // r3 moves to page 2, which starts at 300; the 30px header copy fills the end of the gap.
    expect(layout.before.get("r3")).toBe(300 + 30 - 230);
    expect(layout.repeats.get("r3")).toBe(30);
    expect(layout.pageOf.get("r3")).toBe(2);
    expect(layout.before.has("r2")).toBe(false);
  });

  it("repeats the header on every page of a long table", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`r${i}`, 30 + i * 100));
    const layout = paginate([header(0), ...rows], G);
    // Page 1 holds the header and two rows; each later page holds the header copy and two rows.
    expect([...layout.repeats.keys()]).toEqual(["r2", "r4", "r6"]);
    expect(layout.pages).toBe(4);
  });

  it("keeps the header row with the first row instead of leaving it alone at the bottom of a page", () => {
    const layout = paginate([atom("above", 0, 190), header(200), row("r1", 230)], G);
    // The header fits (200-230) but r1 (230-330) can't start on this page, so both move.
    expect(layout.before.get("h")).toBe(100);
    expect(layout.pageOf.get("h")).toBe(2);
    expect(layout.pageOf.get("r1")).toBe(2);
    expect(layout.repeats.has("h")).toBe(false);
  });

  it("includes the repeats when comparing layouts", () => {
    const a = paginate([header(0), row("r1", 30), row("r2", 130), row("r3", 230)], G);
    const b = paginate([header(0), atom("r1", 30, 100), atom("r2", 130, 100), atom("r3", 230, 100)], G);
    expect(sameLayout(a, b)).toBe(false);
  });
});

describe("sameLayout", () => {
  it("detects differences in spacers and pages", () => {
    const a = paginate([atom("a", 0, 100), atom("b", 110, 100), atom("c", 220, 100)], G);
    const b = paginate([atom("a", 0, 100), atom("b", 110, 100), atom("c", 220, 20)], G);
    expect(sameLayout(a, b)).toBe(false);
  });
});

describe("room reserved for footnotes", () => {
  it("moves a block down to the next page when the notes leave it too little room", () => {
    // Without notes, the block (200 to 240) fits in 250. With 40 reserved the page ends at 210.
    const blocks = [atom("a", 0, 200), atom("b", 200, 40)];
    expect(paginate(blocks, G).pageOf.get("b")).toBe(1);
    const reserved = paginate(blocks, { ...G, reserve: (page) => (page === 0 ? 40 : 0) });
    expect(reserved.pageOf.get("b")).toBe(2);
    expect(reserved.before.get("b")).toBe(100);
  });

  it("applies to the page it names and no other", () => {
    const blocks = [atom("a", 0, 200), atom("b", 300, 200), atom("c", 500, 40)];
    // Page 2 (index 1) holds b at 300-500 and c would end at 540 of its 550 limit; 40 reserved there moves c on.
    const layout = paginate(blocks, { ...G, reserve: (page) => (page === 1 ? 40 : 0) });
    expect(layout.pageOf.get("a")).toBe(1);
    expect(layout.pageOf.get("b")).toBe(2);
    expect(layout.pageOf.get("c")).toBe(3);
  });

  it("splits a paragraph earlier when the page has less room", () => {
    const withoutNotes = paginate([text("p", 150, 8)], G);
    const withNotes = paginate([text("p", 150, 8)], { ...G, reserve: () => 40 });
    const at = (l: typeof withoutNotes) => l.splits.get("p")![0]!.offset;
    expect(at(withNotes)).toBeLessThan(at(withoutNotes));
  });

  it("counts layouts with different notes as different", () => {
    const a = paginate([atom("a", 0, 10)], G);
    const b = { ...a, notes: new Map([[1, ["n1"]]]) };
    expect(sameLayout(a, b)).toBe(false);
    expect(sameLayout(b, { ...b, notes: new Map([[1, ["n1"]]]) })).toBe(true);
    expect(sameLayout(b, { ...b, notes: new Map([[1, ["n2"]]]) })).toBe(false);
  });
});

describe("text in columns", () => {
  /** `count` text blocks of four 20px lines each, 10px apart, laid out in the one narrow column the paginator is given. */
  const narrow = (count: number, from = 0): BlockMetric[] => Array.from({ length: count }, (_, i) => text(`b${i}`, from + i * 90, 4, { firstLineHeight: 20 }));
  const group = (blocks: BlockMetric[], columns = 2) => ({ columns, blocks, lineHeight: 20 });
  const heightOf = (blocks: BlockMetric[]) => blocks[blocks.length - 1]!.top + blocks[blocks.length - 1]!.height - blocks[0]!.top;

  it("puts a short run on one page, as tall as the columns need, and pulls up what follows it", () => {
    // Three blocks: 3*80 + 2*10 = 260px in one narrow column, so about half that in two columns.
    const blocks = narrow(3);
    const after = atom("after", 260 + 10, 20);
    const layout = paginate([group(blocks), after], G);
    const chunk = layout.chunks.get("b0")!;
    expect(layout.chunks.size).toBe(1);
    expect(chunk.columns).toBe(2);
    expect(chunk.height).toBeGreaterThanOrEqual(130);
    expect(chunk.height).toBeLessThan(200);
    // What follows starts right below the columns, not 270px down: the flow is shorter by what the columns saved.
    expect(layout.pageOf.get("after")).toBe(1);
    expect(layout.before.get("after")).toBeUndefined();
    expect(layout.height).toBeCloseTo(chunk.height + 10 + 20, 0);
    expect(blocks.every((b) => layout.pageOf.get(b.id) === 1)).toBe(true);
  });

  it("cuts a long run into one piece per page, none taller than a page", () => {
    const blocks = narrow(20); // 20*80 + 19*10 = 1790px: more than two pages of two 250px columns
    const layout = paginate([group(blocks)], G);
    expect(layout.chunks.size).toBeGreaterThanOrEqual(3);
    for (const chunk of layout.chunks.values()) expect(chunk.height).toBeLessThanOrEqual(G.content + 0.5);
    const pages = blocks.map((b) => layout.pageOf.get(b.id)!);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
    expect(layout.pages).toBe(layout.chunks.size);
    // Every piece but the first starts at the top of a page.
    const starts = [...layout.chunks.keys()];
    for (const id of starts.slice(1)) expect((layout.before.get(id) ?? 0) > 0).toBe(true);
  });

  it("starts in the room left on the page, and moves to the next page if there is none", () => {
    // Something fills the first 100px, then a run of columns.
    const lead = atom("lead", 0, 100);
    const some = paginate([lead, group(narrow(3, 110))], G);
    const chunk = some.chunks.get("b0")!;
    expect(some.pageOf.get("b0")).toBe(1);
    expect(100 + 10 + chunk.height).toBeLessThanOrEqual(G.content + 0.5);

    const fills = atom("fills", 0, 245);
    const none = paginate([fills, group(narrow(2, 255))], G);
    expect(none.pageOf.get("b0")).toBe(2);
    expect(none.before.get("b0")).toBeGreaterThan(0);
  });

  it("starts on a new page after a section break that asks for one", () => {
    const brk = atom("brk", 0, 10, { pageBreak: true });
    const layout = paginate([brk, group(narrow(2, 20))], G);
    expect(layout.pageOf.get("b0")).toBe(2);
    expect(layout.before.get("b0")).toBeGreaterThan(0);
  });

  it("keeps a heading with the text after it", () => {
    const blocks = [...narrow(8), atom("h", 8 * 90, 30, { keepWithNext: true }), text("tail", 8 * 90 + 40, 4)];
    const layout = paginate([group(blocks)], G);
    const last = [...layout.chunks.keys()].pop()!;
    // The heading is never the last block in a piece unless it is alone.
    const index = (id: string) => blocks.findIndex((b) => b.id === id);
    const starts = [...layout.chunks.keys()].map(index);
    expect(starts.includes(index("tail"))).toBe(false);
    expect(last).toBeDefined();
  });

  it("counts different pieces as different layouts", () => {
    const a = paginate([group(narrow(5))], G);
    const b = paginate([group(narrow(5))], G);
    expect(sameLayout(a, b)).toBe(true);
    const c = paginate([group(narrow(5), 3)], G);
    expect(sameLayout(a, c)).toBe(false);
    void heightOf;
  });
});

describe("sections that change the shape of the page", () => {
  // The first section: 250px of text, 25px above and below it, 20px between sheets. Stride 320.
  const portrait = { content: 250, before: 25, after: 25 };
  const landscape = { content: 150, before: 40, after: 10 };
  const sectionMetric = (section: number, geometry = portrait, newPage = false) => ({ section, geometry, newPage });
  const base = { stride: 320, content: 250, gap: 20 };

  it("places pages of one shape as before, and says which section each belongs to", () => {
    const layout = paginate([sectionMetric(0), atom("a", 0, 200), atom("b", 210, 200)], base);
    expect(layout.pageInfo).toEqual([{ start: 0, section: 0 }, { start: 320, section: 0 }]);
    expect(layout.pageOf.get("b")).toBe(2);
  });

  it("starts a section with a different page shape on a new page, whatever kind of break begins it", () => {
    const blocks = [sectionMetric(0), atom("a", 0, 100), sectionMetric(1, landscape, true), atom("b", 110, 100)];
    const layout = paginate(blocks, base);
    expect(layout.pageOf.get("a")).toBe(1);
    expect(layout.pageOf.get("b")).toBe(2);
    expect(layout.pageInfo.map((p) => p.section)).toEqual([0, 1]);
    // Page 2's text starts below page 1's text, its bottom space, the gap and its own top space.
    expect(layout.pageInfo[1]!.start).toBe(250 + 25 + 20 + 40);
    expect(layout.before.get("b")).toBe(335 - 110);
  });

  it("makes the pages after it the new shape, so a long section pages by its own height", () => {
    const blocks = [sectionMetric(0), atom("a", 0, 100), sectionMetric(1, landscape, true), atom("b", 110, 100), atom("c", 220, 100), atom("d", 330, 100)];
    const layout = paginate(blocks, base);
    // 150px of text per landscape page: b, then c, then d each on their own page.
    expect([...["b", "c", "d"]].map((id) => layout.pageOf.get(id))).toEqual([2, 3, 4]);
    expect(layout.pageInfo.map((p) => p.section)).toEqual([0, 1, 1, 1]);
    const [, p2, p3] = layout.pageInfo;
    expect(p3!.start - p2!.start).toBe(150 + 10 + 20 + 40);
  });

  it("goes back to the earlier shape for a later section", () => {
    const blocks = [sectionMetric(0), atom("a", 0, 100), sectionMetric(1, landscape, true), atom("b", 110, 100), sectionMetric(2, portrait, true), atom("c", 220, 100)];
    const layout = paginate(blocks, base);
    expect(layout.pageInfo.map((p) => p.section)).toEqual([0, 1, 2]);
    const [p1, p2, p3] = layout.pageInfo;
    expect(p2!.start - p1!.start).toBe(250 + 25 + 20 + 40);
    expect(p3!.start - p2!.start).toBe(150 + 10 + 20 + 25);
  });

  it("lets a section that keeps the page shape carry on in the same page", () => {
    const layout = paginate([sectionMetric(0), atom("a", 0, 100), sectionMetric(1, portrait, false), atom("b", 110, 100)], base);
    expect(layout.pageOf.get("b")).toBe(1);
    expect(layout.pageInfo).toHaveLength(1);
  });
});
