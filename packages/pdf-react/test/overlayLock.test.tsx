// @vitest-environment jsdom
// The annotations (and every other layer in page space) must stay locked to the page at every size of the editor, zoom, fit mode and
// turn. jsdom lays nothing out, so these tests read the numbers the viewer gives the browser: the page's box (its left, top, width and
// height in CSS pixels, from the layout), the transform of each layer over it, and where the pointer is converted to page space. What
// the browser then draws is those numbers, so a layer that is placed by the same arithmetic as the box cannot drift from it.
import { createRef, act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PdfEditor, setSelection, type PliPdfHandle } from "../src";
import { pageToTurned, turnedSize, type Zoom } from "../src/geometry";
import { fakeRenderer, testSession } from "../src/testing";
import { byLabel, click, fire, flush, host, key, q, qa, render, run, useHost } from "./harness";
import { mount as mountAnnotated, shape } from "./annotHarness";
import { selectionBox } from "../src/annotGeometry";

useHost();
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

const stroke = { color: "#000000", width: 2 };
const RECT = { x: 100, y: 150, w: 200, h: 80 };
const INK: [number, number][] = [[60, 90], [180, 300], [400, 420]];

// ---- reading what the viewer gave the browser --------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** A CSS transform (`translate()`, `rotate()`, `scale()`; the first is the outermost) as a matrix. */
function matrixOf(transform: string): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  for (const [, fn, args] of transform.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const n = args!.split(",").map((a) => parseFloat(a));
    if (fn === "translate") m = mul(m, [1, 0, 0, 1, n[0]!, n[1] ?? 0]);
    else if (fn === "rotate") {
      const r = (n[0]! * Math.PI) / 180;
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    } else if (fn === "scale") m = mul(m, [n[0]!, 0, 0, n[1] ?? n[0]!, 0, 0]);
    else throw new Error(`unexpected transform ${fn}`);
  }
  return m;
}
const apply = (m: Matrix, [x, y]: [number, number]): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const px = (s: string) => parseFloat(s);
const boxOf = (page = 0) => {
  const el = qa(".pli-pdf-page")[page]!;
  return { left: px(el.style.left), top: px(el.style.top), width: px(el.style.width), height: px(el.style.height), rotation: Number(el.dataset.rotation) };
};
const svgOf = (page = 0) => qa(".pli-pdf-page")[page]!.querySelector<SVGSVGElement>("svg.pli-pdf-overlay:not(.pli-pdf-blend-layer)")!;
const layers = (page = 0) => [...qa(".pli-pdf-page")[page]!.querySelectorAll<HTMLElement | SVGElement>(".pli-pdf-overlay, .pli-pdf-overlay-dom, .pli-pdf-text-layer")];

/**
 * Where a point of the page should be on the page's box, worked out from the box alone: the point turned with the page, as a fraction of
 * the turned page, times the box. (The renderer stretches its picture over exactly this box, so this is where the page's content is.)
 */
function expectedOnBox(page: { width: number; height: number }, rotation: number, [x, y]: [number, number], box: { width: number; height: number }): [number, number] {
  const turned = turnedSize(page.width, page.height, rotation);
  const [tx, ty] = pageToTurned(x, y, page.width, page.height, rotation);
  return [(tx / turned.width) * box.width, (ty / turned.height) * box.height];
}

/** Where a layer puts a point of page space, relative to the page's box (the layer's own transform; the box is at its left and top). */
const onScreen = (layer: Element, p: [number, number]) => apply(matrixOf((layer as HTMLElement).style.transform), p);

// ---- the editor, with a size we choose ---------------------------------------------------------------------------

interface Size {
  width: number;
  height: number;
}
let size: Size = { width: 800, height: 600 };

/** jsdom has no layout: say how big the scrolling area and the whole editor are, as the browser would. */
function measure(next: Size) {
  size = next;
  for (const el of qa(".pli-pdf-scroller")) {
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => size.width });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => size.height });
  }
  for (const el of qa(".pli-pdf")) Object.defineProperty(el, "clientWidth", { configurable: true, get: () => size.width + 260 });
}
const resize = (next: Size) =>
  act(async () => {
    measure(next);
    window.dispatchEvent(new Event("resize"));
  });

interface Setup {
  pages?: { width: number; height: number }[];
  zoom?: Zoom;
  turns?: number;
  size?: Size;
}

async function mount(o: Setup = {}) {
  const pages = o.pages ?? [{ width: 612, height: 792 }, { width: 612, height: 792 }];
  const session = testSession({ pages });
  const ref = createRef<PliPdfHandle>();
  size = o.size ?? { width: 800, height: 600 };
  await render(<PdfEditor ref={ref} session={session} renderer={fakeRenderer({ pages })} defaultZoom={o.zoom ?? "fit-width"} annotations={{ storageKey: "" }} />);
  measure(size);
  await resize(size);
  await flush();
  for (let i = 0; i < (o.turns ?? 0); i++) await run(() => ref.current!.rotateView(90));
  await flush();
  const page = session.doc.pages[0]!;
  const rectId = await run(() => session.annots.add(page.id, { type: "square", rect: RECT, stroke } as never));
  const inkId = await run(() => session.annots.add(page.id, { type: "ink", strokes: [INK], stroke } as never));
  return { session, ref, page, rectId, inkId };
}

afterEach(() => {
  size = { width: 800, height: 600 };
});

// ---- the annotations are where the page content is -----------------------------------------------------------------

const SIZES: Size[] = [{ width: 640, height: 500 }, { width: 820, height: 600 }, { width: 1013, height: 777 }, { width: 377, height: 401 }];
const ZOOMS: Zoom[] = ["fit-width", "fit-page", 0.6716, 1.3333, 2];
const PAGES = [{ name: "Letter", width: 612, height: 792 }, { name: "A4", width: 595.28, height: 841.89 }, { name: "a landscape page", width: 792, height: 612 }];

describe.each(PAGES)("an annotation on $name stays locked to the page", (pageSize) => {
  it.each([0, 1, 2, 3])("with the view turned %i quarter turns, at every size and zoom", async (turns) => {
    const { ref } = await mount({ pages: [pageSize, pageSize], turns, zoom: "fit-width" });
    const rotation = turns * 90;
    for (const zoom of ZOOMS) {
      for (const next of SIZES) {
        await resizeAndZoom(ref, next, zoom);
        const box = boxOf();
        const svg = svgOf();
        const label = `${zoom} in ${next.width}x${next.height}`;
        // the box is the page, turned, at the scale: its width over the page's is the same scale on both sides
        const turned = turnedSize(pageSize.width, pageSize.height, rotation);
        expect(box.width / turned.width, label).toBeCloseTo(box.height / turned.height, 6);
        // every layer is placed on the box by the same transform, with no offset of its own
        for (const layer of layers()) {
          expect((layer as HTMLElement).style.left, label).toBe("");
          expect((layer as HTMLElement).style.top, label).toBe("");
        }
        const transforms = new Set(layers().map((l) => (l as HTMLElement).style.transform));
        expect([...transforms], label).toHaveLength(1);
        // a rectangle's corners and the points of a stroke are where the box says they are
        for (const p of [[RECT.x, RECT.y], [RECT.x + RECT.w, RECT.y + RECT.h], ...INK] as [number, number][]) {
          const got = onScreen(svg, p);
          const want = expectedOnBox(pageSize, rotation, p, box);
          expect(got[0], `${label} x of ${p}`).toBeCloseTo(want[0], 3);
          expect(got[1], `${label} y of ${p}`).toBeCloseTo(want[1], 3);
        }
        // the drawn shapes are given in page space (the same numbers whatever the size), not in pixels
        const shape = svg.querySelector("rect[width], path");
        expect(shape, label).not.toBeNull();
      }
    }
  });
});

async function resizeAndZoom(ref: { current: PliPdfHandle | null }, next: Size, zoom: Zoom) {
  await resize(next);
  await run(() => ref.current!.setZoom(zoom));
  await flush(2);
}

// ---- resizing -----------------------------------------------------------------------------------------------------

describe("resizing the editor", () => {
  it("moves the page and the annotation together: the annotation keeps its place on the page at every width, in fit width", async () => {
    const m = await mount({ zoom: "fit-width", size: { width: 900, height: 600 } });
    const before = boxOf();
    const frac = (box: typeof before, p: [number, number]) => onScreen(svgOf(), p).map((v, i) => v / (i === 0 ? box.width : box.height));
    const first = frac(before, [RECT.x, RECT.y]);
    for (const w of [700, 520, 1100, 377, 1013]) {
      await resize({ width: w, height: 600 });
      await flush(2);
      const box = boxOf();
      expect(box.width, `at ${w}`).not.toBeCloseTo(before.width, 0);
      const now = frac(box, [RECT.x, RECT.y]);
      expect(now[0], `x at ${w}`).toBeCloseTo(first[0]!, 6);
      expect(now[1], `y at ${w}`).toBeCloseTo(first[1]!, 6);
      // fit width: the page is the width of the area less the padding, and centred
      expect(box.width, `fit at ${w}`).toBeCloseTo(w - 32, 3);
    }
  });

  it("is applied before the browser paints: a resize is in the page's box at once, not a frame later", async () => {
    await mount({ zoom: "fit-width", size: { width: 900, height: 600 } });
    const before = boxOf().width;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      measure({ width: 600, height: 600 });
      window.dispatchEvent(new Event("resize")); // not inside act: nothing is flushed for us
      expect(boxOf().width, "the box of the next frame").toBeCloseTo(568, 3);
      expect(boxOf().width).not.toBeCloseTo(before, 0);
      // and the layer over it is made by the same render, not the one before
      expect(matrixOf(svgOf().style.transform)[0]).toBeCloseTo(boxOf().width / 612, 6);
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    }
    await flush();
  });

  it("scales the layers by the same number the page box was made with (not a rounded one)", async () => {
    const m = await mount({ zoom: 1.33337, size: { width: 900, height: 600 } });
    const box = boxOf();
    const scale = matrixOf(svgOf().style.transform)[0]!;
    expect(scale).toBeCloseTo(box.width / 612, 6);
    // at a big zoom a rounded scale is a pixel off at the far edge of the page
    await run(() => m.ref.current!.setZoom(7.77777));
    await flush(2);
    expect(matrixOf(svgOf().style.transform)[0]! * 612).toBeCloseTo(boxOf().width, 3);
  });

  it("keeps an annotation on the page while the page is still being drawn (the canvas is later than the layers)", async () => {
    const pages = [{ width: 612, height: 792 }];
    const session = testSession({ pages });
    const ref = createRef<PliPdfHandle>();
    size = { width: 900, height: 600 };
    await render(<PdfEditor ref={ref} session={session} renderer={fakeRenderer({ pages, latency: 50 })} defaultZoom="fit-width" annotations={{ storageKey: "" }} />);
    measure(size);
    await resize(size);
    await run(() => session.annots.add(session.doc.pages[0]!.id, { type: "square", rect: RECT, stroke } as never));
    expect(qa(".pli-pdf-page")[0]!.getAttribute("data-state")).not.toBe("ready"); // still drawing
    const first = onScreen(svgOf(), [RECT.x, RECT.y]);
    const box = boxOf();
    expect(first[0]! / box.width).toBeCloseTo(RECT.x / 612, 6);
    await resize({ width: 640, height: 600 });
    expect(onScreen(svgOf(), [RECT.x, RECT.y])[0]! / boxOf().width).toBeCloseTo(RECT.x / 612, 6);
    await act(async () => void (await new Promise((r) => setTimeout(r, 120))));
    await flush();
    expect(onScreen(svgOf(), [RECT.x, RECT.y])[0]! / boxOf().width).toBeCloseTo(RECT.x / 612, 6);
  });
});

// ---- resizing while drawing ---------------------------------------------------------------------------------------

describe("resizing while a stroke is being drawn", () => {
  const point = (box: ReturnType<typeof boxOf>, p: [number, number], rotation = 0): [number, number] => expectedOnBox({ width: 612, height: 792 }, rotation, p, box);
  const move = (layer: Element, type: "pointerdown" | "pointermove" | "pointerup", at: [number, number]) =>
    fire(layer, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], button: 0, buttons: type === "pointerup" ? 0 : 1 }));

  /** Draws one stroke of five points; with `resizing` the editor is made narrower, then wider, between them. Returns the points the pen kept. */
  async function drawStroke(resizing: boolean) {
    const m = await mount({ zoom: "fit-width", size: { width: 900, height: 700 } });
    await click(byLabel("Pen", host));
    const layer = () => qa(".pli-pdf-page")[0]!.querySelector<HTMLElement>(".pli-pdf-interact")!;
    const path: [number, number][] = [[100, 100], [180, 140], [260, 220], [300, 260], [380, 330]];
    await move(layer(), "pointerdown", point(boxOf(), path[0]!));
    await move(layer(), "pointermove", point(boxOf(), path[1]!));
    await move(layer(), "pointermove", point(boxOf(), path[2]!));
    // the window is made narrower in the middle of the stroke: the page is smaller, and the same pointer positions mean other pixels
    if (resizing) {
      await resize({ width: 520, height: 700 });
      await flush(2);
      expect(boxOf().width).toBeCloseTo(488, 3);
    }
    await move(layer(), "pointermove", point(boxOf(), path[3]!));
    if (resizing) {
      await resize({ width: 1100, height: 700 });
      await flush(2);
    }
    await move(layer(), "pointermove", point(boxOf(), path[4]!));
    await move(layer(), "pointerup", point(boxOf(), path[4]!));
    const drawn = m.session.doc.pages[0]!.annots.find((a) => a.type === "ink" && a.id !== m.inkId)!;
    expect(drawn).toBeDefined();
    // what is shown while drawing is in the same layer, placed like the rest
    expect(layers().every((l) => (l as HTMLElement).style.transform === svgOf().style.transform)).toBe(true);
    return (drawn as unknown as { strokes: [number, number][][] }).strokes.flat();
  }

  it("records the points where they were drawn on the page, whatever the size of the editor was when each one arrived", async () => {
    const steady = await drawStroke(false);
    const resized = await drawStroke(true);
    // (the pen smooths and thins what it is given; whatever it does, it does the same with the same points)
    expect(steady.length).toBeGreaterThanOrEqual(3);
    expect(resized).toHaveLength(steady.length);
    resized.forEach((p, i) => {
      expect(p[0], `x of point ${i}`).toBeCloseTo(steady[i]![0], 1);
      expect(p[1], `y of point ${i}`).toBeCloseTo(steady[i]![1], 1);
    });
    // and the first and last points are the ones drawn
    expect(resized[0]![0]).toBeCloseTo(100, 1);
    expect(resized[0]![1]).toBeCloseTo(100, 1);
    expect(resized.at(-1)![0]).toBeCloseTo(380, 1);
    expect(resized.at(-1)![1]).toBeCloseTo(330, 1);
  });

  it("keeps the shape being dragged under the pointer when the size changes before the pointer moves again", async () => {
    const m = await mount({ zoom: "fit-width", size: { width: 900, height: 700 } });
    await shape("Rectangle");
    const layer = () => qa(".pli-pdf-page")[0]!.querySelector<HTMLElement>(".pli-pdf-interact")!;
    await move(layer(), "pointerdown", point(boxOf(), [120, 400]));
    await move(layer(), "pointermove", point(boxOf(), [200, 460]));
    await resize({ width: 480, height: 700 });
    await flush(2);
    await move(layer(), "pointermove", point(boxOf(), [320, 520]));
    await move(layer(), "pointerup", point(boxOf(), [320, 520]));
    const squares = m.session.doc.pages[0]!.annots.filter((a) => a.type === "square" && a.id !== m.rectId) as unknown as { rect: { x: number; y: number; w: number; h: number } }[];
    expect(squares).toHaveLength(1);
    const r = squares[0]!.rect;
    expect([r.x, r.y, r.x + r.w, r.y + r.h].map((v) => Math.round(v * 10) / 10)).toEqual([120, 400, 320, 520]);
  });
});

const mountAnnot = (o: { zoom: number }) => mountAnnotated({ zoom: o.zoom, pages: 2 });
/** Zooms the annotation test viewer to a fraction (Ctrl and the keys of the viewer step through its list; a fit or a number is set by the handle in the other tests). */
async function annotZoom(zoom: number) {
  const steps = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
  const now = Number(qa(".pli-pdf-page")[0]!.style.width.replace("px", "")) / (612 * (96 / 72));
  let at = steps.findIndex((z) => Math.abs(z - now) < 0.05);
  const to = steps.findIndex((z) => Math.abs(z - zoom) < 0.05);
  while (at !== to) {
    await key(q(".pli-pdf-scroller"), at < to ? "+" : "-", { ctrlKey: true });
    at += at < to ? 1 : -1;
  }
}

// ---- what floats over an annotation ---------------------------------------------------------------------------------

/** jsdom has no layout: give the page elements the rectangle their style says, offset by where the editor sits on the screen. */
function placePages(offset: { left: number; top: number }) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("pli-pdf-page")) {
      const left = offset.left + parseFloat(this.style.left);
      const top = offset.top + parseFloat(this.style.top);
      const width = parseFloat(this.style.width);
      const height = parseFloat(this.style.height);
      return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
  return () => void (HTMLElement.prototype.getBoundingClientRect = original);
}

describe("the bar over a selected annotation follows it", () => {
  it("is put by the page as it is NOW after a resize or a zoom, not as it was before the render", async () => {
    const restore = placePages({ left: 0, top: 0 });
    try {
      const m = await mount({ zoom: 0.6, size: { width: 900, height: 700 } });
        await run(() => setSelection(m.session, { annots: [m.rectId] }));
      await flush();
      const bar = () => q<HTMLElement>("[role=toolbar][aria-label='Rectangle actions']");
      const expected = () => {
        const box = boxOf();
        // the bar is over the annotation's selection box: its rectangle and half the line's width around it
        const edge = selectionBox(m.session.annots.get(m.rectId)!);
        const [x] = onScreen(svgOf(), [edge.x, edge.y]);
        return box.left + x!;
      };
      const barLeft = () => parseFloat(bar().style.left);
      // a popover keeps 8 pixels from the window's edge: the checks are of positions inside it
      for (const [w, zoom] of [[900, 0.6], [900, 1], [640, "fit-width"], [1100, 1.5], [500, "fit-width"], [900, 0.6]] as [number, Zoom][]) {
        await resize({ width: w, height: 700 });
        await run(() => m.ref.current!.setZoom(zoom));
        await flush(2);
        const want = Math.max(8, Math.min(expected(), window.innerWidth - 8));
        expect(barLeft(), `at ${w}, zoom ${zoom}`).toBeCloseTo(want, 1);
      }
    } finally {
      restore();
    }
  });

  it("follows a zoom alone (no resize of the window to prompt it) and a change of the editor's size seen only by the observer", async () => {
    const restore = placePages({ left: 0, top: 0 });
    try {
      const m = await mount({ zoom: 0.6, size: { width: 900, height: 700 } });
      await run(() => setSelection(m.session, { annots: [m.rectId] }));
      await flush();
      const bar = () => q<HTMLElement>("[role=toolbar][aria-label='Rectangle actions']");
      const edge = () => selectionBox(m.session.annots.get(m.rectId)!);
      const expected = () => Math.max(8, Math.min(boxOf().left + onScreen(svgOf(), [edge().x, edge().y])[0]!, window.innerWidth - 8));
      for (const zoom of [1, 1.5, 0.75, 2, 0.6]) {
        await run(() => m.ref.current!.setZoom(zoom));
        await flush(2);
        expect(parseFloat(bar().style.left), `zoom ${zoom}`).toBeCloseTo(expected(), 1);
      }
      // the observer sees a change of size that the window never hears of (a panel opening beside the pages)
      measure({ width: 600, height: 700 });
      await act(async () => void (await Promise.resolve()));
      await run(() => m.ref.current!.setZoom("fit-width"));
      await flush(2);
      expect(parseFloat(bar().style.left)).toBeCloseTo(expected(), 1);
    } finally {
      restore();
    }
  });

  it("is carried along when the editor moves on the screen without resizing (a sidebar opening beside it)", async () => {
    const offset = { left: 0, top: 0 };
    const restore = placePages(offset);
    try {
      const m = await mount({ zoom: 0.8, size: { width: 700, height: 700 } });
        await run(() => setSelection(m.session, { annots: [m.rectId] }));
      await flush();
      const bar = () => q<HTMLElement>("[role=toolbar][aria-label='Rectangle actions']");
      const before = parseFloat(bar().style.left);
      offset.left = 120; // the editor is pushed right by something beside it, and nothing in it is resized
      await act(async () => void window.dispatchEvent(new Event("resize")));
      await flush(2);
      expect(parseFloat(bar().style.left)).toBeCloseTo(before + 120, 1);
    } finally {
      restore();
    }
  });
});

describe("the bar over selected text follows the text", () => {
  it("is put by the rectangles of the selection in page space, so it moves with a zoom", async () => {
    const restore = placePages({ left: 0, top: 0 });
    try {
      const m = await mountAnnot({ zoom: 0.6 });
      const text = { page: m.session.doc.pages[0]!.id, index: 0, rects: [{ x: 120, y: 160, w: 140, h: 14 }], text: "some words" };
      // `at` is the screen place measured when the pointer went up, at another zoom and another place: it must not be what places the bar
      await act(async () => {
        m.c().textSelection = { selected: [text], at: { x: 900, y: 900, w: 10, h: 10 } };
        m.c().emit();
      });
      await flush();
      const bar = () => q<HTMLElement>("[role=toolbar][aria-label='Text selection']");
      const expected = () => boxOf().left + onScreen(svgOf(), [120, 160])[0]!;
      expect(parseFloat(bar().style.left)).toBeCloseTo(expected(), 1);
      const was = parseFloat(bar().style.left);
      for (const zoom of [1, 1.5, 0.8]) {
        await act(async () => void (await annotZoom(zoom)));
        await flush(2);
        expect(parseFloat(bar().style.left), `zoom ${zoom}`).toBeCloseTo(Math.max(8, Math.min(expected(), window.innerWidth - 8)), 1);
      }
      expect(parseFloat(bar().style.left)).not.toBeCloseTo(was, 0);
    } finally {
      restore();
    }
  });
});
