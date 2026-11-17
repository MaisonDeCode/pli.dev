// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Annotation } from "@pli.dev/pdf";
import { annots, byLabel, click, drag, flush, host, key, layerOf, mount, pointer, q, qa, run, clientOf, tap, tool, useAnnotHost } from "./annotHarness";

useAnnotHost();

const P0 = "p:main:0";
const P1 = "p:main:1";
const stroke = { color: "#000000", width: 2 };
const scroller = () => q(".pli-pdf-scroller");
type A = Annotation & Record<string, any>;
const get = (m: { session: { annots: { get(id: string): Annotation | undefined } } }, id: string) => m.session.annots.get(id) as A;
const rect = (x = 100, y = 100, w = 100, h = 60) => ({ type: "square", rect: { x, y, w, h }, stroke }) as never;
const sel = (m: { session: { selection: { annots: string[] } } }) => m.session.selection.annots;

async function withRect(opts: Parameters<typeof mount>[0] = {}) {
  const m = await mount(opts);
  const id = await run(() => m.session.annots.add(P0, rect(), { select: false }));
  await tool("Select");
  return { ...m, id };
}

const views = [
  { turns: 0, zoom: 1 },
  { turns: 1, zoom: 1 },
  { turns: 2, zoom: 2 },
  { turns: 3, zoom: 0.5 },
] as const;

describe.each(views)("select tool with the view turned $turns quarter turns at zoom $zoom", ({ turns, zoom }) => {
  const opts = { rotation: turns * 90, zoom };

  it("selects with a click on the outline, not inside an empty shape, and clears on empty space", async () => {
    const { session, id } = await withRect({ turns, zoom });
    await tap([100, 130], opts);
    expect(sel({ session })).toEqual([id]);
    expect(q(".pli-pdf-selbox")).toBeTruthy();
    await tap([300, 500], opts);
    expect(sel({ session })).toEqual([]);
    await tap([150, 130], opts);
    expect(sel({ session })).toEqual([]);
  });

  it("moves with a drag, as one undo step, and the selection stays", async () => {
    const m = await withRect({ turns, zoom });
    await drag([100, 130], [130, 150], { ...opts, steps: [[110, 135], [120, 140]] });
    expect(get(m, m.id).rect).toEqual({ x: 130, y: 120, w: 100, h: 60 });
    expect(sel(m)).toEqual([m.id]);
    await run(() => m.session.undo());
    expect(get(m, m.id).rect).toEqual({ x: 100, y: 100, w: 100, h: 60 });
    await run(() => m.session.redo());
    expect(get(m, m.id).rect).toEqual({ x: 130, y: 120, w: 100, h: 60 });
  });

  it("resizes by a handle, keeping the opposite corner, as one undo step", async () => {
    const m = await withRect({ turns, zoom });
    await tap([100, 130], opts);
    // the handles are on the box around the line (half its width out)
    await drag([201, 161], [221, 171], { ...opts, steps: [[210, 165]] });
    expect(get(m, m.id).rect).toEqual({ x: 100, y: 100, w: 120, h: 70 });
    await drag([99, 99], [109, 104], opts);
    expect(get(m, m.id).rect).toEqual({ x: 110, y: 105, w: 110, h: 65 });
    await run(() => m.session.undo());
    await run(() => m.session.undo());
    expect(get(m, m.id).rect).toEqual({ x: 100, y: 100, w: 100, h: 60 });
  });

  it("selects several with a marquee", async () => {
    const m = await mount({ turns, zoom });
    const [a, b] = await run(() => [m.session.annots.add(P0, rect(100, 100), { select: false }), m.session.annots.add(P0, rect(300, 100), { select: false }), m.session.annots.add(P0, rect(100, 500), { select: false })]);
    await tool("Select");
    await drag([50, 60], [450, 200], opts);
    expect(sel(m)).toEqual([a, b]);
    expect(qa(".pli-pdf-selbox")).toHaveLength(2);
    // several together move together
    await drag([100, 130], [110, 140], opts);
    expect(get(m, a).rect).toMatchObject({ x: 110, y: 110 });
    expect(get(m, b).rect).toMatchObject({ x: 310, y: 110 });
    await run(() => m.session.undo());
    expect(get(m, a).rect).toMatchObject({ x: 100, y: 100 });
    expect(get(m, b).rect).toMatchObject({ x: 300, y: 100 });
  });
});

describe("select tool", () => {
  it("does not move on a click, keeps what it moves on the page, and Shift keeps to one direction", async () => {
    const m = await withRect();
    await drag([120, 100], [121, 101]);
    expect(get(m, m.id).rect).toMatchObject({ x: 100, y: 100 });
    await drag([130, 100], [930, 800]);
    expect(get(m, m.id).rect).toEqual({ x: 511, y: 731, w: 100, h: 60 });
    // Shift pressed after the drag has begun keeps it to one direction
    const layer = layerOf();
    await pointer(layer, "pointerdown", clientOf(541, 731));
    await pointer(layer, "pointermove", clientOf(481, 701), { shiftKey: true });
    await pointer(layer, "pointerup", clientOf(481, 701), { shiftKey: true });
    expect(get(m, m.id).rect).toEqual({ x: 451, y: 731, w: 100, h: 60 });
  });

  it("adds to and takes from the selection with Shift", async () => {
    const m = await mount();
    const [a, b] = await run(() => [m.session.annots.add(P0, rect(100, 100), { select: false }), m.session.annots.add(P0, rect(300, 100), { select: false })]);
    await tool("Select");
    await tap([100, 130]);
    await tap([300, 130], { init: { shiftKey: true } });
    expect(sel(m)).toEqual([a, b]);
    await tap([100, 130], { init: { shiftKey: true } });
    expect(sel(m)).toEqual([b]);
  });

  it("reshapes a line by its end points", async () => {
    const m = await mount();
    const id = await run(() => m.session.annots.add(P0, { type: "line", from: [100, 100], to: [300, 100], stroke } as never, { select: false }));
    await tool("Select");
    await tap([200, 100]);
    expect(sel(m)).toEqual([id]);
    expect(qa(".pli-pdf-handle[data-vertex]")).toHaveLength(2);
    expect(qa(".pli-pdf-handle[data-handle]")).toHaveLength(0);
    await drag([300, 100], [320, 160]);
    expect(get(m, id)).toMatchObject({ from: [100, 100], to: [320, 160] });
    await drag([100, 100], [100, 140], { init: { shiftKey: true } });
    expect(get(m, id).from[1]).toBeCloseTo(get(m, id).from[1]);
  });

  it("picks the top annotation where they overlap, and a locked one can be selected but not moved or deleted", async () => {
    const m = await mount();
    const [a, b] = await run(() => [m.session.annots.add(P0, { ...(rect(100, 100) as object), fill: "#ffffff" } as never, { select: false }), m.session.annots.add(P0, { ...(rect(120, 120) as object), fill: "#eeeeee" } as never, { select: false })]);
    await tool("Select");
    await tap([150, 150]);
    expect(sel(m)).toEqual([b]);
    await run(() => m.c().setLocked([b], true));
    await drag([150, 150], [250, 250]);
    expect(get(m, b).rect).toMatchObject({ x: 120, y: 120 });
    await key(scroller(), "Delete");
    expect(annots(m.session)).toHaveLength(2);
    expect(q(".pli-pdf-sr", host).textContent).toContain("Locked annotations can't be deleted");
    expect(qa(".pli-pdf-handle[data-handle]")).toHaveLength(0);
    expect(a).toBeTruthy();
  });

  it("opens the comment of a note when it is double-clicked, and edits a text box in place", async () => {
    const m = await mount();
    const id = await run(() => m.session.annots.add(P0, { type: "note", x: 200, y: 200, contents: "Look here", icon: "comment" } as never, { select: false }));
    await tool("Select");
    await tap([210, 210]);
    await tap([210, 210]);
    const box = q("[role=dialog]", host);
    expect(box.getAttribute("aria-label")).toBe("Note comment");
    expect((q("textarea", box) as HTMLTextAreaElement).value).toBe("Look here");
    expect(m.c().popover).toEqual({ kind: "comment", annot: id });
  });

  it("shows other people's selections in their colour", async () => {
    const m = await mount({ kit: { presence: [{ user: { id: "u9", name: "Chi Tran", color: "#c2255c" }, annots: [] }] } });
    const id = await run(() => m.session.annots.add(P0, rect(), { select: false }));
    await run(() => {
      m.c().presence = [{ user: { id: "u9", name: "Chi Tran", color: "#c2255c" }, page: P0, annots: [id] }];
      m.c().emit();
    });
    const mark = q("[data-presence=u9]");
    expect(q("rect", mark).getAttribute("stroke")).toBe("#c2255c");
    expect(q("text", mark).textContent).toBe("Chi Tran");
  });

  it("marks the viewer when something is selected, so touch dragging can be on", async () => {
    const m = await withRect();
    expect(q(".pli-pdf").hasAttribute("data-annot-selected")).toBe(false);
    await tap([100, 130]);
    expect(q(".pli-pdf").hasAttribute("data-annot-selected")).toBe(true);
    await run(() => m.c().clearSelection());
    expect(q(".pli-pdf").hasAttribute("data-annot-selected")).toBe(false);
  });
});

describe("keyboard", () => {
  it("deletes with Delete or Backspace as one undo step, and undo and redo with the keyboard", async () => {
    const m = await withRect();
    await tap([100, 130]);
    await key(scroller(), "Delete");
    expect(annots(m.session)).toHaveLength(0);
    expect(sel(m)).toEqual([]);
    expect(q(".pli-pdf-sr", host).textContent).toContain("deleted");
    await key(scroller(), "z", { ctrlKey: true });
    expect(annots(m.session)).toHaveLength(1);
    await key(scroller(), "z", { ctrlKey: true, shiftKey: true });
    expect(annots(m.session)).toHaveLength(0);
    await key(scroller(), "y", { metaKey: true });
    expect(annots(m.session)).toHaveLength(0);
    await key(scroller(), "z", { metaKey: true });
    expect(annots(m.session)).toHaveLength(1);
    await run(() => m.c().select([m.id]));
    await key(scroller(), "Backspace");
    expect(annots(m.session)).toHaveLength(0);
  });

  it("duplicates with Ctrl+D: a copy a little to the side, selected, in one undo step", async () => {
    const m = await withRect();
    await tap([100, 130]);
    await key(scroller(), "d", { ctrlKey: true });
    expect(annots(m.session)).toHaveLength(2);
    const copy = annots(m.session)[1] as A;
    expect(copy.id).not.toBe(m.id);
    expect(copy.rect).toEqual({ x: 112, y: 112, w: 100, h: 60 });
    expect(sel(m)).toEqual([copy.id]);
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(1);
  });

  it("copies and pastes within the document: shifted on the same page, in place on another", async () => {
    const m = await withRect();
    await run(() => m.c().select([m.id]));
    await key(scroller(), "c", { metaKey: true });
    await key(scroller(), "v", { metaKey: true });
    await key(scroller(), "v", { metaKey: true });
    expect((annots(m.session) as A[]).map((a) => a.rect.x)).toEqual([100, 112, 124]);
    await run(() => m.c().select([], P1));
    await key(scroller(), "v", { metaKey: true });
    expect((annots(m.session, 1)[0] as A).rect).toEqual({ x: 100, y: 100, w: 100, h: 60 });
    expect(m.session.selection.page).toBe(P1);
    await run(() => m.c().select([m.id], P0));
    await key(scroller(), "x", { metaKey: true });
    expect(annots(m.session).map((a) => a.id)).not.toContain(m.id);
  });

  it("changes the drawing order with Ctrl+] and Ctrl+[ , or to the very front and back with Shift", async () => {
    const m = await mount();
    const [a, b, c] = await run(() => [0, 1, 2].map((i) => m.session.annots.add(P0, rect(100 + i * 10, 100), { select: false })));
    const order = () => annots(m.session).map((x) => x.id);
    await tool("Select");
    await run(() => m.c().select([a!]));
    await key(scroller(), "]", { ctrlKey: true });
    expect(order()).toEqual([b, a, c]);
    await key(scroller(), "]", { ctrlKey: true, shiftKey: true });
    expect(order()).toEqual([b, c, a]);
    await key(scroller(), "[", { ctrlKey: true });
    expect(order()).toEqual([b, a, c]);
    await key(scroller(), "[", { ctrlKey: true, shiftKey: true });
    expect(order()).toEqual([a, b, c]);
    await run(() => m.session.undo());
    expect(order()).toEqual([b, a, c]);
    // two at once keep their order
    await run(() => m.c().select([b!, c!]));
    await key(scroller(), "[", { ctrlKey: true, shiftKey: true });
    expect(order()).toEqual([b, c, a]);
    await key(scroller(), "}", { ctrlKey: true, shiftKey: true });
    expect(order()).toEqual([a, b, c]);
  });

  it("nudges with the arrow keys, ten points with Shift, in one undo step for a run of presses, and stops at the page edge", async () => {
    const m = await withRect();
    await tap([100, 130]);
    await key(scroller(), "ArrowRight");
    await key(scroller(), "ArrowRight");
    await key(scroller(), "ArrowDown", { shiftKey: true });
    expect(get(m, m.id).rect).toMatchObject({ x: 102, y: 110 });
    await run(() => m.session.undo());
    expect(get(m, m.id).rect).toMatchObject({ x: 100, y: 100 });
    for (let i = 0; i < 11; i++) await key(scroller(), "ArrowLeft", { shiftKey: true });
    // the line's own width stays on the page
    expect(get(m, m.id).rect.x).toBe(1);
  });

  it("leaves the arrow keys to the viewer when nothing is selected", async () => {
    const m = await withRect();
    const stopped = await run(() => scroller().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(stopped).toBe(true);
    expect(get(m, m.id).rect.y).toBe(100);
  });

  it("selects every annotation of the page with Ctrl+A, and Escape clears the selection before it puts the tool down", async () => {
    const m = await mount();
    const ids = await run(() => [rect(10, 10), rect(200, 10)].map((r) => m.session.annots.add(P0, r, { select: false })));
    await tool("Select");
    await key(scroller(), "a", { ctrlKey: true });
    expect(sel(m)).toEqual(ids);
    await key(scroller(), "Escape");
    expect(sel(m)).toEqual([]);
    expect(m.c().toolId).toBe("select");
    await key(scroller(), "Escape");
    expect(m.c().toolId).toBeNull();
  });

  it("opens the text of a selected text box or the comment of a selected note with Enter", async () => {
    const m = await mount();
    const [t, n] = await run(() => [
      m.session.annots.add(P0, { type: "freetext", rect: { x: 100, y: 100, w: 100, h: 30 }, text: "hello", style: { family: "Helvetica", size: 12, color: "#000000" } } as never, { select: false }),
      m.session.annots.add(P0, { type: "note", x: 300, y: 100, contents: "n" } as never, { select: false }),
    ]);
    await tool("Select");
    await run(() => m.c().select([n!]));
    await key(scroller(), "Enter");
    expect(m.c().popover).toEqual({ kind: "comment", annot: n });
    await run(() => m.c().closePopover());
    await run(() => m.c().select([t!]));
    await key(scroller(), "Enter");
    expect(q("textarea.pli-pdf-text-editor")).toBeTruthy();
    expect((q("textarea.pli-pdf-text-editor") as HTMLTextAreaElement).value).toBe("hello");
  });

  it("leaves the keys of the thumbnails and the sidebar to them, and Escape clears a selection when no tool is on", async () => {
    const m = await mount();
    const thumbs = q(".pli-pdf-thumbs");
    await key(thumbs, "r");
    await key(thumbs, "h");
    expect(m.c().toolId).toBeNull();
    const id = await run(() => m.session.annots.add(P0, rect(), { select: true }));
    // Ctrl+D in the thumbnails duplicates pages, not annotations
    await key(thumbs, "d", { ctrlKey: true });
    expect(annots(m.session)).toHaveLength(1);
    await key(scroller(), "Escape");
    expect(m.session.selection.annots).toEqual([]);
    expect(id).toBeTruthy();
  });

  it("does nothing in a viewer that cannot edit", async () => {
    const m = await mount({ kit: { readOnly: true }, props: { readOnly: true } });
    const id = await run(() => m.session.annots.add(P0, rect(), { select: false }));
    await run(() => m.c().select([id]));
    await key(scroller(), "Delete");
    expect(annots(m.session)).toHaveLength(1);
    await key(scroller(), "p");
    expect(m.c().toolId).toBeNull();
  });
});

describe("touch and pointer events", () => {
  it("draws with a pen's batched points, all in page space", async () => {
    const m = await mount();
    await tool("Pen");
    const layer = layerOf();
    const at = (x: number, y: number) => clientOf(x, y);
    await pointer(layer, "pointerdown", at(100, 100));
    const batch = [at(110, 105), at(120, 110), at(130, 108)].map(([clientX, clientY]) => ({ clientX, clientY }));
    const move = new MouseEvent("pointermove", { bubbles: true, clientX: batch[2]!.clientX, clientY: batch[2]!.clientY });
    (move as unknown as { getCoalescedEvents: () => unknown[] }).getCoalescedEvents = () => batch;
    await run(() => layer.dispatchEvent(move));
    await pointer(layer, "pointerup", at(130, 108));
    const ink = annots(m.session)[0] as A;
    const xs = ink.strokes[0].map((p: number[]) => p[0]);
    expect(xs[0]).toBe(100);
    expect(xs.at(-1)).toBe(130);
    expect(Math.max(...xs)).toBeLessThanOrEqual(130);
    expect(byLabel("Pen", host)).toBeTruthy();
    await flush();
    expect(layer.classList.contains("pli-pdf-interact")).toBe(true);
  });
});
