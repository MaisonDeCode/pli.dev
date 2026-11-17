import { describe, expect, it } from "vitest";
import { bounds, hitTest, resizeTo, translate, ptToPdf, ptFromPdf, rectToPdf, rectFromPdf } from "../src";
import type { Annotation, Pt } from "../src";
import { newSession } from "./support/annots";

const stroke = { color: "#000000", width: 4 };
const sample: Record<string, Annotation> = {
  highlight: { id: "1", type: "highlight", color: "#ff0", rects: [{ x: 10, y: 10, w: 50, h: 10 }, { x: 10, y: 30, w: 30, h: 10 }] },
  ink: { id: "2", type: "ink", strokes: [[[10, 10], [30, 30]], [[50, 10], [60, 20]]], stroke },
  square: { id: "3", type: "square", rect: { x: 10, y: 10, w: 40, h: 20 }, stroke },
  circle: { id: "4", type: "circle", rect: { x: 10, y: 10, w: 40, h: 20 }, stroke, fill: "#ff0000" },
  line: { id: "5", type: "line", from: [10, 10], to: [50, 30], stroke },
  polygon: { id: "6", type: "polygon", points: [[10, 10], [50, 10], [30, 40]], stroke, fill: "#00ff00" },
  polyline: { id: "7", type: "polyline", points: [[10, 10], [50, 10], [30, 40]], stroke },
  note: { id: "8", type: "note", x: 10, y: 10 },
  freetext: { id: "9", type: "freetext", rect: { x: 10, y: 10, w: 40, h: 20 }, text: "x", style: { family: "Helvetica", size: 12, color: "#000000" } },
  signature: { id: "10", type: "signature", rect: { x: 10, y: 10, w: 40, h: 20 }, mode: "draw", strokes: [[[0, 0], [40, 20]]] },
};

describe("coordinates", () => {
  it("converts between page space and PDF space", () => {
    const box = [50, 40, 250, 340] as const;
    expect(rectToPdf(box, { x: 10, y: 20, w: 30, h: 40 })).toEqual([60, 280, 90, 320]);
    expect(rectFromPdf(box, [60, 280, 90, 320])).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(rectFromPdf(box, [90, 320, 60, 280])).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(ptToPdf(box, [10, 20])).toEqual([60, 320]);
    expect(ptFromPdf(box, 60, 320)).toEqual([10, 20]);
  });
});

describe("bounds, hit test, move and resize", () => {
  it("reports bounds including the stroke", () => {
    expect(bounds(sample.highlight!)).toEqual({ x: 10, y: 10, w: 50, h: 30 });
    expect(bounds(sample.ink!)).toEqual({ x: 8, y: 8, w: 54, h: 24 });
    expect(bounds(sample.line!)).toEqual({ x: 8, y: 8, w: 44, h: 24 });
    expect(bounds(sample.note!)).toEqual({ x: 10, y: 10, w: 24, h: 24 });
    expect(bounds({ ...sample.line!, endEnd: "closed-arrow" } as Annotation).w).toBeGreaterThan(44);
  });

  it("hits what is drawn and not what is not", () => {
    const hit = (a: string, p: Pt, tol = 0) => hitTest(sample[a]!, p, tol);
    expect(hit("highlight", [30, 15])).toBe(true);
    expect(hit("highlight", [30, 25])).toBe(false);
    expect(hit("highlight", [30, 25], 6)).toBe(true);
    expect(hit("ink", [20, 20])).toBe(true);
    expect(hit("ink", [20, 28])).toBe(false);
    expect(hit("square", [30, 20])).toBe(false); // empty inside
    expect(hit("square", [10, 20])).toBe(true); // on the border
    expect(hit("circle", [30, 20])).toBe(true); // filled
    expect(hit("circle", [11, 11])).toBe(false); // the corner of its box
    expect(hit("line", [30, 20])).toBe(true);
    expect(hit("line", [30, 30])).toBe(false);
    expect(hit("polygon", [30, 20])).toBe(true);
    expect(hit("polygon", [12, 38])).toBe(false);
    expect(hit("polyline", [30, 20])).toBe(false);
    expect(hit("polyline", [30, 10])).toBe(true);
    expect(hit("note", [20, 20])).toBe(true);
    expect(hit("freetext", [20, 20])).toBe(true);
    expect(hit("freetext", [60, 20])).toBe(false);
  });

  it("moves every type and back", () => {
    for (const [name, a] of Object.entries(sample)) {
      const moved = translate(a, 7, -3);
      const b = bounds(a);
      const c = bounds(moved);
      expect([name, c.x - b.x, c.y - b.y, c.w, c.h]).toEqual([name, 7, -3, b.w, b.h]);
      expect(translate(moved, -7, 3), name).toEqual(a);
    }
  });

  it("resizes every type so its bounds become the new rectangle", () => {
    const target = { x: 100, y: 200, w: 80, h: 60 };
    for (const [name, a] of Object.entries(sample)) {
      if (name === "note") continue;
      const r = resizeTo(a, target);
      const b = bounds(r);
      expect(b.x, name).toBeCloseTo(target.x, 3);
      expect(b.y, name).toBeCloseTo(target.y, 3);
      expect(b.w, name).toBeCloseTo(target.w, 3);
      expect(b.h, name).toBeCloseTo(target.h, 3);
    }
    expect(resizeTo(sample.note!, target)).toMatchObject({ x: 100, y: 200 });
    // A signature's strokes stay in the box.
    expect(resizeTo(sample.signature!, target)).toMatchObject({ strokes: [[[0, 0], [80, 60]]] });
  });
});

describe("session helpers", () => {
  it("moves, resizes, restyles and orders annotations with undo", async () => {
    const s = await newSession();
    const P = "p:main:0";
    const a = s.annots.addShape(P, "square", { x: 10, y: 10, w: 40, h: 40 }, { width: 2 });
    const b = s.annots.addInk(P, [[[100, 100], [120, 120]]]);
    s.annots.moveBy([a, b], 5, 5);
    expect(s.annots.get(a)).toMatchObject({ rect: { x: 15, y: 15 } });
    expect(s.annots.get(b)).toMatchObject({ strokes: [[[105, 105], [125, 125]]] });
    s.undo();
    expect(s.annots.get(a)).toMatchObject({ rect: { x: 10, y: 10 } });
    s.annots.resize(a, { x: 0, y: 0, w: 100, h: 20 });
    expect(s.annots.get(a)).toMatchObject({ rect: { x: 0, y: 0, w: 100, h: 20 } });
    s.annots.restyle(a, { color: "#00ff00", width: 6, fill: "#ff0000", opacity: 0.5 });
    expect(s.annots.get(a)).toMatchObject({ stroke: { color: "#00ff00", width: 6 }, fill: "#ff0000", opacity: 0.5 });
    s.annots.restyle(a, { fill: null });
    expect(s.annots.get(a)).not.toHaveProperty("fill");
    expect(s.annots.at(P, [50, 1], 1)?.id).toBe(a);
    s.annots.bringToFront(a);
    expect(s.annots.list(P).map((x) => x.id)).toEqual([b, a]);
    s.annots.sendToBack(a);
    expect(s.annots.list(P).map((x) => x.id)).toEqual([a, b]);
    const t = s.annots.addFreeText(P, { x: 0, y: 200, w: 100, h: 30 }, "hi");
    s.annots.setText(t, "changed");
    s.annots.restyle(t, { size: 20, bold: true, color: "#112233" });
    expect(s.annots.get(t)).toMatchObject({ text: "changed", style: { size: 20, bold: true, color: "#112233", family: "Helvetica" } });
    s.annots.remove([a, b, t]);
    expect(s.annots.list(P)).toEqual([]);
  });
});
