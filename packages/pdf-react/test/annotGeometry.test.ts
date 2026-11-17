import { describe, expect, it } from "vitest";
import type { Annotation, Pt } from "@pli.dev/pdf";
import {
  annotBounds,
  annotsInRect,
  boundsOfAll,
  canMove,
  canResize,
  constrainAngle,
  constrainSquare,
  finishStroke,
  fitInside,
  fitTo,
  geometryBounds,
  handlePoint,
  hitTest,
  moveBy,
  moveVertex,
  resizeBy,
  resizeRect,
  selectionBox,
  simplifyStroke,
  smoothPathData,
  squigglyPathData,
  thinPoints,
  topAnnotAt,
  vertices,
} from "../src/annotGeometry";

const stroke = { color: "#000000", width: 4 };
const sample = (): Annotation[] => [
  { id: "hl", type: "highlight", color: "#ff0", rects: [{ x: 10, y: 10, w: 100, h: 12 }, { x: 10, y: 24, w: 60, h: 12 }] },
  { id: "ul", type: "underline", color: "#00f", rects: [{ x: 10, y: 50, w: 80, h: 10 }] },
  { id: "so", type: "strikeout", color: "#f00", rects: [{ x: 10, y: 70, w: 80, h: 10 }] },
  { id: "sq", type: "squiggly", color: "#f00", rects: [{ x: 10, y: 90, w: 80, h: 10 }] },
  { id: "ink", type: "ink", strokes: [[[100, 100], [120, 140], [160, 120]], [[200, 200], [210, 210]]], stroke },
  { id: "rect", type: "square", rect: { x: 50, y: 300, w: 100, h: 60 }, stroke },
  { id: "oval", type: "circle", rect: { x: 200, y: 300, w: 100, h: 60 }, stroke, fill: "#abcdef" },
  { id: "line", type: "line", from: [10, 400], to: [110, 450], stroke, endEnd: "arrow" },
  { id: "poly", type: "polygon", points: [[300, 400], [400, 400], [350, 480]], stroke, fill: "#eeeeee" },
  { id: "pl", type: "polyline", points: [[300, 500], [350, 520], [400, 500]], stroke },
  { id: "txt", type: "freetext", rect: { x: 50, y: 520, w: 150, h: 40 }, text: "Hi", style: { family: "Helvetica", size: 12, color: "#000" } },
  { id: "note", type: "note", x: 500, y: 20 },
  { id: "stamp", type: "stamp", rect: { x: 400, y: 600, w: 120, h: 44 }, stamp: { name: "Approved" } },
  { id: "sig", type: "signature", rect: { x: 100, y: 650, w: 100, h: 40 }, mode: "draw", strokes: [[[0, 0], [50, 20], [100, 40]]], width: 2 },
  { id: "img", type: "image", rect: { x: 300, y: 650, w: 80, h: 40 }, picture: { src: "data:image/png;base64,AA==" } },
  { id: "link", type: "link", rect: { x: 10, y: 700, w: 100, h: 14 }, uri: "https://example.com" },
  { id: "red", type: "redact", rects: [{ x: 300, y: 10, w: 80, h: 10 }, { x: 300, y: 30, w: 40, h: 10 }] },
];
const by = (id: string) => sample().find((a) => a.id === id)!;

describe("bounds", () => {
  it("covers every annotation type", () => {
    expect(geometryBounds(by("hl"))).toEqual({ x: 10, y: 10, w: 100, h: 26 });
    expect(geometryBounds(by("ink"))).toEqual({ x: 100, y: 100, w: 110, h: 110 });
    expect(geometryBounds(by("rect"))).toEqual({ x: 50, y: 300, w: 100, h: 60 });
    expect(geometryBounds(by("line"))).toEqual({ x: 10, y: 400, w: 100, h: 50 });
    expect(geometryBounds(by("poly"))).toEqual({ x: 300, y: 400, w: 100, h: 80 });
    expect(geometryBounds(by("pl"))).toEqual({ x: 300, y: 500, w: 100, h: 20 });
    expect(geometryBounds(by("note"))).toEqual({ x: 500, y: 20, w: 24, h: 24 });
    expect(geometryBounds(by("red"))).toEqual({ x: 300, y: 10, w: 80, h: 30 });
    for (const a of sample()) {
      const b = geometryBounds(a);
      expect(Number.isFinite(b.x + b.y + b.w + b.h)).toBe(true);
    }
  });

  it("adds half the line width to what is drawn, and never lets a selection box get thin", () => {
    expect(annotBounds(by("rect"))).toEqual({ x: 48, y: 298, w: 104, h: 64 });
    expect(annotBounds(by("hl"))).toEqual(geometryBounds(by("hl")));
    const flat: Annotation = { id: "f", type: "line", from: [0, 10], to: [100, 10], stroke: { color: "#000", width: 0 } };
    expect(selectionBox(flat).h).toBe(6);
    expect(boundsOfAll([by("rect"), by("oval")])).toEqual({ x: 48, y: 298, w: 254, h: 64 });
  });
});

describe("hit testing", () => {
  it("hits markup and boxes inside, with a margin", () => {
    expect(hitTest(by("hl"), 50, 16)).toBe(true);
    expect(hitTest(by("hl"), 50, 40)).toBe(false);
    expect(hitTest(by("hl"), 50, 37.5, 2)).toBe(true);
    expect(hitTest(by("txt"), 60, 530)).toBe(true);
    expect(hitTest(by("txt"), 60, 600)).toBe(false);
    expect(hitTest(by("note"), 510, 30)).toBe(true);
    expect(hitTest(by("stamp"), 410, 610)).toBe(true);
    expect(hitTest(by("red"), 310, 15)).toBe(true);
    expect(hitTest(by("red"), 360, 35)).toBe(false);
  });

  it("hits ink and lines near the stroke, not away from it", () => {
    expect(hitTest(by("ink"), 110, 120)).toBe(true);
    expect(hitTest(by("ink"), 110, 180)).toBe(false);
    expect(hitTest(by("line"), 60, 425)).toBe(true);
    expect(hitTest(by("line"), 60, 440)).toBe(false);
    expect(hitTest(by("pl"), 325, 510)).toBe(true);
  });

  it("hits an unfilled shape on its outline only, a filled one anywhere inside", () => {
    expect(hitTest(by("rect"), 100, 330)).toBe(false);
    expect(hitTest(by("rect"), 100, 300)).toBe(true);
    expect(hitTest(by("oval"), 250, 330)).toBe(true);
    expect(hitTest(by("oval"), 250, 300)).toBe(true);
    expect(hitTest(by("oval"), 205, 303)).toBe(false);
    const hollow = { ...by("oval"), fill: undefined } as Annotation;
    expect(hitTest(hollow, 250, 330)).toBe(false);
    expect(hitTest(hollow, 250, 300)).toBe(true);
    expect(hitTest(by("poly"), 350, 430)).toBe(true);
    expect(hitTest(by("poly"), 310, 470)).toBe(false);
  });

  it("does not hit hidden annotations, and picks the topmost", () => {
    expect(hitTest({ ...by("hl"), hidden: true }, 50, 16)).toBe(false);
    const list: Annotation[] = [{ id: "a", type: "square", rect: { x: 0, y: 0, w: 100, h: 100 }, stroke, fill: "#fff" }, { id: "b", type: "square", rect: { x: 50, y: 50, w: 100, h: 100 }, stroke, fill: "#fff" }];
    expect(topAnnotAt(list, 60, 60)?.id).toBe("b");
    expect(topAnnotAt(list, 10, 10)?.id).toBe("a");
    expect(topAnnotAt(list, 300, 300)).toBeUndefined();
  });

  it("finds what a marquee touches", () => {
    expect(annotsInRect(sample(), { x: 0, y: 0, w: 120, h: 40 }).map((a) => a.id)).toEqual(["hl"]);
    expect(annotsInRect(sample(), { x: 290, y: 290, w: 20, h: 20 }).map((a) => a.id)).toEqual(["oval"]);
  });
});

describe("moving", () => {
  it("moves every type by the same amount", () => {
    for (const a of sample()) {
      const before = geometryBounds(a);
      const after = geometryBounds(moveBy(a, 7, -3));
      expect(after.x).toBeCloseTo(before.x + 7);
      expect(after.y).toBeCloseTo(before.y - 3);
      expect(after.w).toBeCloseTo(before.w);
      expect(after.h).toBeCloseTo(before.h);
      expect(moveBy(a, 0, 0)).toBe(a);
    }
  });

  it("moves points, rectangles and notes, and keeps the rest of the annotation", () => {
    expect(moveBy(by("line"), 5, 5)).toMatchObject({ from: [15, 405], to: [115, 455], endEnd: "arrow", id: "line" });
    expect(moveBy(by("note"), 1, 2)).toMatchObject({ x: 501, y: 22 });
    expect(moveBy(by("sig"), 1, 2)).toMatchObject({ rect: { x: 101, y: 652 }, strokes: [[[0, 0], [50, 20], [100, 40]]] });
  });

  it("knows what can be moved and resized", () => {
    expect(canMove(by("hl"))).toBe(false);
    expect(canMove(by("rect"))).toBe(true);
    expect(canMove({ ...by("rect"), locked: true })).toBe(false);
    expect(canResize(by("note"))).toBe(false);
    expect(canResize(by("hl"))).toBe(false);
    expect(canResize(by("red"))).toBe(false);
    expect(canResize(by("img"))).toBe(true);
  });
});

describe("resizing", () => {
  it("drags a handle and keeps the opposite corner", () => {
    const r = { x: 10, y: 10, w: 100, h: 50 };
    expect(resizeRect(r, "se", 20, 10)).toEqual({ x: 10, y: 10, w: 120, h: 60 });
    expect(resizeRect(r, "nw", 10, 5)).toEqual({ x: 20, y: 15, w: 90, h: 45 });
    expect(resizeRect(r, "e", -30, 99)).toEqual({ x: 10, y: 10, w: 70, h: 50 });
    expect(resizeRect(r, "n", 99, -20)).toEqual({ x: 10, y: -10, w: 100, h: 70 });
  });

  it("never goes below the smallest size, and can keep the ratio", () => {
    const r = { x: 10, y: 10, w: 100, h: 50 };
    expect(resizeRect(r, "e", -500, 0)).toEqual({ x: 10, y: 10, w: 4, h: 50 });
    const kept = resizeRect(r, "se", 100, 0, { keepAspect: true });
    expect(kept.w / kept.h).toBeCloseTo(2);
    expect(kept.x).toBe(10);
    expect(kept.y).toBe(10);
    const side = resizeRect(r, "e", 50, 0, { keepAspect: true });
    expect(side.w).toBe(150);
    expect(side.h).toBe(75);
    expect(side.y).toBeCloseTo(-2.5);
  });

  it("stretches the shape of every type into the new box", () => {
    const line = resizeBy(by("line"), "se", 100, 50);
    expect(line).toMatchObject({ from: [10, 400], to: [210, 500] });
    const ink = fitTo(by("ink"), { x: 0, y: 0, w: 55, h: 55 });
    expect(geometryBounds(ink)).toEqual({ x: 0, y: 0, w: 55, h: 55 });
    expect((ink as Annotation & { type: "ink" }).stroke.width).toBe(4);
    const poly = resizeBy(by("poly"), "e", 100, 0) as Annotation & { type: "polygon" };
    expect(poly.points[1]).toEqual([500, 400]);
    expect(poly.points[2]![0]).toBeCloseTo(400);
    const frame = resizeBy(by("rect"), "s", 0, 40) as Annotation & { type: "square" };
    expect(frame.rect).toEqual({ x: 50, y: 300, w: 100, h: 100 });
    const text = resizeBy(by("txt"), "w", -50, 0) as Annotation & { type: "freetext" };
    expect(text.rect).toEqual({ x: 0, y: 520, w: 200, h: 40 });
  });

  it("keeps a signature's strokes in its box and a picture's ratio", () => {
    const sig = resizeBy(by("sig"), "se", 100, 40) as Annotation & { type: "signature" };
    expect(sig.rect).toMatchObject({ w: 200, h: 80 });
    expect(sig.strokes![0]![2]).toEqual([200, 80]);
    const img = resizeBy(by("img"), "se", 40, 0) as Annotation & { type: "image" };
    expect(img.rect.w / img.rect.h).toBeCloseTo(2);
  });

  it("leaves what cannot be stretched alone", () => {
    const note = by("note");
    expect(resizeBy(note, "se", 50, 50)).toBe(note);
    expect(resizeBy(by("note"), "se", 50, 50)).toMatchObject({ x: 500, y: 20 });
    expect(resizeBy({ ...by("rect"), locked: true }, "se", 50, 50)).toMatchObject({ rect: { w: 100 } });
  });

  it("places handles on the box", () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    expect(handlePoint(box, "nw")).toEqual([0, 0]);
    expect(handlePoint(box, "e")).toEqual([100, 25]);
    expect(handlePoint(box, "s")).toEqual([50, 50]);
  });
});

describe("vertices", () => {
  it("reshapes lines and polygons by their points", () => {
    expect(vertices(by("line"))).toEqual([[10, 400], [110, 450]]);
    expect(vertices(by("rect"))).toBeNull();
    expect(vertices({ ...by("line"), locked: true })).toBeNull();
    expect(moveVertex(by("line"), 1, 200, 300)).toMatchObject({ from: [10, 400], to: [200, 300] });
    expect(moveVertex(by("line"), 0, 1, 2)).toMatchObject({ from: [1, 2] });
    expect((moveVertex(by("poly"), 2, 1.234, 5.678) as Annotation & { type: "polygon" }).points[2]).toEqual([1.23, 5.68]);
  });
});

describe("constraining", () => {
  it("snaps a line to 45 degrees and a drag to a square", () => {
    const [x, y] = constrainAngle([0, 0], [100, 10]);
    expect(x).toBeCloseTo(Math.hypot(100, 10));
    expect(y).toBeCloseTo(0);
    const [dx, dy] = constrainAngle([0, 0], [50, 60]);
    expect(dx).toBeCloseTo(dy);
    expect(constrainAngle([5, 5], [5, 5])).toEqual([5, 5]);
    expect(constrainSquare([10, 10], [60, 30])).toEqual([60, 60]);
    expect(constrainSquare([10, 10], [-20, 5])).toEqual([-20, -20]);
  });

  it("fits a picture inside a box without enlarging it", () => {
    expect(fitInside(1000, 500, 200, 200)).toEqual({ w: 200, h: 100 });
    expect(fitInside(50, 50, 200, 200)).toEqual({ w: 50, h: 50 });
  });
});

describe("strokes", () => {
  const wiggly: Pt[] = Array.from({ length: 200 }, (_, i) => [i * 0.2, Math.sin(i / 5) * 10 + (i % 2 ? 0.05 : -0.05)]);

  it("thins close points and simplifies within a tolerance", () => {
    expect(thinPoints([[0, 0], [0.1, 0], [0.2, 0], [5, 0]], 1)).toEqual([[0, 0], [5, 0]]);
    expect(thinPoints([[0, 0], [0.1, 0]], 1)).toEqual([[0, 0], [0.1, 0]]);
    const simple = simplifyStroke([[0, 0], [5, 0.05], [10, 0], [10, 10]], 0.2);
    expect(simple).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(simplifyStroke([[1, 1], [2, 2]], 1)).toEqual([[1, 1], [2, 2]]);
  });

  it("finishes a pen stroke with far fewer points, keeping both ends", () => {
    const out = finishStroke(wiggly);
    expect(out.length).toBeLessThan(wiggly.length / 2);
    expect(out[0]).toEqual([wiggly[0]![0], Math.round(wiggly[0]![1] * 100) / 100]);
    expect(out[out.length - 1]![0]).toBeCloseTo(wiggly[wiggly.length - 1]![0], 1);
    expect(finishStroke([[5, 5]])).toEqual([[5, 5]]);
  });

  it("writes a smooth path, a dot for one point and a zigzag for squiggles", () => {
    expect(smoothPathData([])).toBe("");
    expect(smoothPathData([[1, 2]])).toBe("M1 2h0.01");
    expect(smoothPathData([[1, 2], [3, 4]])).toBe("M1 2L3 4");
    expect(smoothPathData([[0, 0], [10, 0], [10, 10]])).toBe("M0 0Q10 0 10 5L10 10");
    const sq = squigglyPathData(0, 10, 20);
    expect(sq.startsWith("M0 20L")).toBe(true);
    expect(sq).toContain("L10 ");
  });
});
