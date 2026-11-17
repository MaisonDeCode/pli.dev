// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import {
  CSS_UNITS,
  PliPdf,
  TextLayer,
  boxesBetween,
  canvasScale,
  currentFromScroll,
  fitZoom,
  layerTransform,
  layoutPages,
  pageToScreen,
  rectToScreen,
  rowRanges,
  screenToPage,
  screenToPageRect,
  selectionRects,
  stepZoom,
  turnedSize,
  type TextRun,
} from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { flush, host, q, qa, render, useHost } from "./harness";

useHost();

const W = 200;
const H = 100;
const rotations = [0, 90, 180, 270] as const;

describe("page space and the screen", () => {
  it("swaps width and height for quarter turns", () => {
    expect(turnedSize(W, H, 0)).toEqual({ width: 200, height: 100 });
    expect(turnedSize(W, H, 90)).toEqual({ width: 100, height: 200 });
    expect(turnedSize(W, H, 180)).toEqual({ width: 200, height: 100 });
    expect(turnedSize(W, H, 270)).toEqual({ width: 100, height: 200 });
    expect(turnedSize(W, H, 450)).toEqual({ width: 100, height: 200 });
  });

  it("puts the corners of the page where a turned page has them", () => {
    const f = (rotation: number) => ({ width: W, height: H, rotation, scale: 2 });
    // top left corner of the page, then top right
    expect(pageToScreen(f(0), 0, 0)).toEqual([0, 0]);
    expect(pageToScreen(f(90), 0, 0)).toEqual([200, 0]); // turned clockwise, the top left goes to the top right
    expect(pageToScreen(f(180), 0, 0)).toEqual([400, 200]);
    expect(pageToScreen(f(270), 0, 0)).toEqual([0, 400]);
    expect(pageToScreen(f(90), W, 0)).toEqual([200, 400]);
    expect(pageToScreen(f(270), W, 0)).toEqual([0, 0]);
  });

  it("converts back and forth exactly, for every turn and zoom", () => {
    for (const rotation of rotations) {
      for (const scale of [0.5, 1, CSS_UNITS, 3.7]) {
        const f = { width: W, height: H, rotation, scale };
        for (const [x, y] of [[0, 0], [10, 20], [W, H], [123.5, 77.25]] as const) {
          const [sx, sy] = pageToScreen(f, x, y);
          const [bx, by] = screenToPage(f, sx, sy);
          expect(bx).toBeCloseTo(x, 9);
          expect(by).toBeCloseTo(y, 9);
        }
        const r = { x: 10, y: 20, w: 50, h: 30 };
        const back = screenToPageRect(f, rectToScreen(f, r));
        expect(back.x).toBeCloseTo(r.x, 9);
        expect(back.y).toBeCloseTo(r.y, 9);
        expect(back.w).toBeCloseTo(r.w, 9);
        expect(back.h).toBeCloseTo(r.h, 9);
      }
    }
  });

  it("turns a rectangle into the box around it on the screen", () => {
    const r = rectToScreen({ width: W, height: H, rotation: 90, scale: 1 }, { x: 10, y: 20, w: 50, h: 30 });
    expect(r).toEqual({ x: 50, y: 10, w: 30, h: 50 });
  });

  it("gives the layer transform that makes page coordinates land on the screen", () => {
    const frame = (rotation: number) => ({ width: W, height: H, rotation, scale: 2 });
    expect(layerTransform(frame(0))).toBe("scale(2)");
    expect(layerTransform(frame(90))).toBe("translate(200px, 0) rotate(90deg) scale(2)");
    expect(layerTransform(frame(180))).toBe("translate(400px, 200px) rotate(180deg) scale(2)");
    expect(layerTransform(frame(270))).toBe("translate(0, 400px) rotate(270deg) scale(2)");
    // the transform and pageToScreen agree: apply rotate then translate to a point, by hand
    const apply = (rotation: number, x: number, y: number): [number, number] => {
      const s = 2;
      const a = (rotation * Math.PI) / 180;
      const rx = x * s * Math.cos(a) - y * s * Math.sin(a);
      const ry = x * s * Math.sin(a) + y * s * Math.cos(a);
      const t = rotation === 90 ? [H * s, 0] : rotation === 180 ? [W * s, H * s] : rotation === 270 ? [0, W * s] : [0, 0];
      return [Math.round(rx + t[0]!) + 0, Math.round(ry + t[1]!) + 0];
    };
    for (const rotation of rotations) for (const [x, y] of [[0, 0], [30, 10], [W, H]] as const) expect(apply(rotation, x, y)).toEqual(pageToScreen(frame(rotation), x, y).map((n) => Math.round(n) + 0));
  });
});

describe("zoom maths", () => {
  it("steps through the usual zooms", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.94, 1)).toBe(1);
    expect(stepZoom(0.94, -1)).toBe(0.75);
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.1, -1)).toBe(0.1);
  });

  it("fits width and page", () => {
    const view = { width: 800, height: 600 };
    expect(fitZoom("fit-width", { width: 612, height: 792 }, view, 16)).toBeCloseTo(768 / (612 * CSS_UNITS), 6);
    expect(fitZoom("fit-page", { width: 612, height: 792 }, view, 16)).toBeCloseTo(568 / (792 * CSS_UNITS), 6);
    // a wide page is limited by its width even when fitting the page
    expect(fitZoom("fit-page", { width: 1000, height: 100 }, view, 16)).toBeCloseTo(768 / (1000 * CSS_UNITS), 6);
  });

  it("keeps a canvas under the pixel limit", () => {
    expect(canvasScale(612, 792, 1, 1)).toEqual({ scale: 1, capped: false });
    expect(canvasScale(612, 792, 1, 2).capped).toBe(false);
    const big = canvasScale(612, 792, 8, 2);
    expect(big.capped).toBe(true);
    expect(612 * big.scale * (792 * big.scale)).toBeLessThanOrEqual(16_000_001);
    expect(612 * big.scale * (792 * big.scale)).toBeGreaterThan(15_000_000);
  });
});

describe("layout", () => {
  const pages = Array.from({ length: 10 }, () => ({ width: 100, height: 200, rotate: 0 }));
  const viewport = { width: 400, height: 300 };

  it("stacks pages in a column, centred", () => {
    const l = layoutPages(pages, { mode: "continuous", scale: 1, viewRotation: 0, viewport, current: 0 });
    expect(l.boxes.length).toBe(10);
    expect(l.boxes[0]).toMatchObject({ left: 150, top: 16, width: 100, height: 200 });
    expect(l.boxes[1]!.top).toBe(16 + 200 + 12);
    expect(l.height).toBe(16 + 10 * 200 + 9 * 12 + 16);
    expect(l.width).toBe(400);
  });

  it("is wider than the view when the pages are", () => {
    const l = layoutPages(pages, { mode: "continuous", scale: 5, viewRotation: 0, viewport, current: 0 });
    expect(l.width).toBe(500 + 32);
    expect(l.boxes[0]!.left).toBe(16);
  });

  it("uses each page's own turn and the view's", () => {
    const l = layoutPages([{ width: 100, height: 200, rotate: 90 }, { width: 100, height: 200, rotate: 0 }], { mode: "continuous", scale: 1, viewRotation: 90, viewport, current: 0 });
    expect(l.boxes[0]).toMatchObject({ width: 100, height: 200, rotation: 180 });
    expect(l.boxes[1]).toMatchObject({ width: 200, height: 100, rotation: 90 });
  });

  it("lays out one row for single-page and two-page views", () => {
    expect(layoutPages(pages, { mode: "single", scale: 1, viewRotation: 0, viewport, current: 4 }).boxes.map((b) => b.index)).toEqual([4]);
    const two = layoutPages(pages, { mode: "spread", scale: 1, viewRotation: 0, viewport, current: 5 });
    expect(two.boxes.map((b) => b.index)).toEqual([4, 5]);
    expect(two.boxes[1]!.left).toBe(two.boxes[0]!.left + 100 + 12);
    expect(rowRanges(5, "spread")).toEqual([[0, 1], [2, 3], [4, 4]]);
    expect(rowRanges(5, "spread", true)).toEqual([[0, 0], [1, 2], [3, 4]]);
  });

  it("finds the boxes in a band, and the page most in view", () => {
    const l = layoutPages(pages, { mode: "continuous", scale: 1, viewRotation: 0, viewport, current: 0 });
    expect(boxesBetween(l, 0, 100).map((b) => b.index)).toEqual([0]);
    expect(boxesBetween(l, 200, 300).map((b) => b.index)).toEqual([0, 1]);
    expect(boxesBetween(l, 1000, 1100).map((b) => b.index)).toEqual([4, 5]);
    expect(currentFromScroll(l, 0, 300)).toBe(0);
    expect(currentFromScroll(l, 150, 300)).toBe(1);
    expect(currentFromScroll(l, l.height - 300, 300)).toBe(9);
  });
});

const runs: TextRun[] = [
  { str: "Hello ", x: 72, y: 110, w: 36, h: 12 },
  { str: "world", x: 108, y: 110, w: 30, h: 12, eol: true },
  { str: "Next line", x: 72, y: 130, w: 54, h: 12, eol: true },
];

describe("text layer", () => {
  it("places each run by its box, in page space, for all four turns", async () => {
    for (const rotation of rotations) {
      const frame = { width: 612, height: 792, rotation, scale: 1.5 };
      await render(<TextLayer runs={runs} frame={frame} pageId="p" index={0} />);
      const layer = q(".pli-pdf-text-layer");
      expect(layer.style.width).toBe("612px");
      expect(layer.style.height).toBe("792px");
      expect(layer.style.transform).toBe(layerTransform(frame));
      const spans = qa("span[data-run]", layer);
      expect(spans.map((s) => [s.style.left, s.style.top, s.style.fontSize])).toEqual([
        ["72px", "110px", "12px"],
        ["108px", "110px", "12px"],
        ["72px", "130px", "12px"],
      ]);
    }
  });

  it("stretches a run to its width and turns slanted text", async () => {
    // jsdom cannot measure text, so a letter is half the size wide: "Hi" at 10px is 10px; the run is 20px wide
    const frame = { width: 100, height: 100, rotation: 0, scale: 1 };
    await render(<TextLayer runs={[{ str: "Hi", x: 10, y: 20, w: 20, h: 10, angle: -30 }]} frame={frame} pageId="p" index={0} />);
    const span = q("span[data-run]");
    expect(span.style.transform).toBe("rotate(-30deg) scaleX(2)");
  });
});

describe("selection in page space", () => {
  const textRange = (a: Node, ao: number, b: Node, bo: number) => {
    const range = document.createRange();
    range.setStart(a, ao);
    range.setEnd(b, bo);
    return range;
  };

  it("measures a selection over two runs as one rectangle per line, whatever the turn", async () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      const session = testSession({ pages: [{ rotate }, {}] });
      await render(<PliPdf session={session} renderer={fakeRenderer({ pages: 2 })} viewport={{ width: 800, height: 600 }} defaultZoom={1} />);
      await flush();
      const spans = qa("span[data-run]", q(".pli-pdf-text-layer"));
      expect(spans.length).toBe(5);
      const range = textRange(spans[1]!.firstChild!, 2, spans[2]!.firstChild!, 3);
      const out = selectionRects(range, host);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ page: "p:main:0", index: 0, text: "llo wor" });
      // "llo " is 4 of 6 letters of a 36 wide run (x 72 + 12), "wor" 3 of 5 letters of a 30 wide run: 84 to 126
      expect(out[0]!.rects).toEqual([{ x: 84, y: 110, w: 42, h: 12 }]);
    }
  });

  it("splits a selection at the end of a line, and over pages", async () => {
    const session = testSession({ pages: 2 });
    await render(<PliPdf session={session} renderer={fakeRenderer({ pages: 2 })} viewport={{ width: 800, height: 600 }} defaultZoom={0.5} />);
    await flush();
    const layers = qa(".pli-pdf-text-layer");
    expect(layers.length).toBe(2);
    const first = qa("span[data-run]", layers[0]!);
    const second = qa("span[data-run]", layers[1]!);
    // from the middle of "Alpha beta gamma" on page 1 to "Page 2" on page 2
    const out = selectionRects(textRange(first[3]!.firstChild!, 6, second[0]!.firstChild!, 4), host);
    expect(out.map((o) => o.page)).toEqual(["p:main:0", "p:main:1"]);
    expect(out[0]!.rects).toHaveLength(2); // two lines: the rest of "Alpha beta gamma" and "The quick brown fox"
    expect(out[0]!.rects[0]!.y).toBe(130);
    expect(out[0]!.rects[1]!.y).toBe(150);
    expect(out[0]!.text).toBe("beta gamma\nThe quick brown fox");
    expect(out[1]!.text).toBe("Page");
    expect(out[1]!.rects).toEqual([{ x: 72, y: 72, w: 36, h: 18 }]);
  });

  it("ignores a selection outside the text layers", async () => {
    await render(<TextLayer runs={runs} frame={{ width: 612, height: 792, rotation: 0, scale: 1 }} pageId="p" index={0} />);
    const p = document.createElement("p");
    p.textContent = "elsewhere";
    document.body.append(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    expect(selectionRects(range, document)).toEqual([]);
    await act(async () => {});
  });
});
