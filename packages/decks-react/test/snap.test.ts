import { describe, expect, it } from "vitest";
import { snap } from "../src";
import { cropByHandle, hitsElement, inFrame, resizeFrame, rotatePoint, visualBounds } from "../src/geometry";

const slide = { width: 720, height: 405 };

describe("snap", () => {
  it("snaps the centre to the slide centre and shows a guide", () => {
    const r = snap({ x: 300, y: 50, w: 118, h: 40 }, [], slide);
    expect(r.dx).toBe(1);
    expect(r.dy).toBe(0);
    expect(r.guides).toContainEqual({ kind: "edge", axis: "x", pos: 360, from: 50, to: 90 });
  });

  it("snaps edges to the slide's edges within the threshold only", () => {
    expect(snap({ x: 3, y: 100, w: 50, h: 50 }, [], slide).dx).toBe(-3);
    expect(snap({ x: 9, y: 100, w: 50, h: 50 }, [], slide).dx).toBe(0);
    expect(snap({ x: 9, y: 100, w: 50, h: 50 }, [], slide, { threshold: 10 }).dx).toBe(-9);
    const r = snap({ x: 668, y: 405 - 50 - 3, w: 50, h: 50 }, [], slide);
    expect(r).toMatchObject({ dx: 2, dy: 3 });
  });

  it("snaps to other elements' edges and centres and spans both in the guide", () => {
    const other = { x: 100, y: 200, w: 80, h: 60 };
    const r = snap({ x: 102, y: 20, w: 40, h: 30 }, [other], slide);
    expect(r.dx).toBe(-2);
    const g = r.guides.find((x) => x.axis === "x" && x.pos === 100)!;
    expect(g.from).toBe(20);
    expect(g.to).toBe(260);
    // centre to centre
    const c = snap({ x: 125, y: 20, w: 30, h: 30 }, [other], slide);
    expect(c.dx).toBe(0);
    expect(c.guides.some((x) => x.axis === "x" && x.pos === 140)).toBe(true);
  });

  it("snaps to equal spacing between elements and marks the gaps", () => {
    const a = { x: 100, y: 100, w: 50, h: 50 };
    const b = { x: 200, y: 100, w: 50, h: 50 }; // gap of 50
    const r = snap({ x: 303, y: 100, w: 50, h: 50 }, [a, b], slide, { threshold: 5 });
    expect(r.dx).toBe(-3);
    expect(r.guides.filter((g) => g.kind === "gap").length).toBe(2);
    // not for a box in another row
    const far = snap({ x: 303, y: 300, w: 50, h: 50 }, [a, b], slide, { threshold: 5 });
    expect(far.guides.some((g) => g.kind === "gap")).toBe(false);
  });

  it("only snaps the edges being dragged when resizing", () => {
    const r = snap({ x: 20, y: 20, w: 337, h: 40 }, [], slide, { edges: { r: true } });
    expect(r.dx).toBe(3);
    expect(snap({ x: 3, y: 20, w: 40, h: 40 }, [], slide, { edges: { r: true } }).dx).toBe(0);
    expect(snap({ x: 3, y: 20, w: 40, h: 40 }, [], slide, { edges: { r: true }, spacing: false }).dy).toBe(0);
  });
});

describe("geometry", () => {
  it("resizes about the opposite corner", () => {
    const f = resizeFrame({ x: 100, y: 100, w: 100, h: 50, rotation: 0 }, "se", 260, 180);
    expect(f).toEqual({ x: 100, y: 100, w: 160, h: 80, rotation: 0 });
    const nw = resizeFrame({ x: 100, y: 100, w: 100, h: 50, rotation: 0 }, "nw", 80, 90);
    expect(nw).toEqual({ x: 80, y: 90, w: 120, h: 60, rotation: 0 });
  });

  it("keeps the aspect ratio, resizes from the centre, and never goes below the minimum", () => {
    const k = resizeFrame({ x: 0, y: 0, w: 100, h: 50, rotation: 0 }, "se", 200, 60, { keepAspect: true });
    expect(k.w / k.h).toBeCloseTo(2);
    const c = resizeFrame({ x: 100, y: 100, w: 100, h: 50, rotation: 0 }, "e", 250, 125, { fromCenter: true });
    expect(c).toMatchObject({ x: 50, w: 200 });
    const small = resizeFrame({ x: 0, y: 0, w: 100, h: 50, rotation: 0 }, "e", -50, 0);
    expect(small.w).toBe(4);
  });

  it("resizes a rotated frame so that the opposite edge stays put", () => {
    const f = { x: 100, y: 100, w: 100, h: 50, rotation: 90 };
    const c = { x: 150, y: 125 };
    // the east handle of a frame turned 90 degrees points down; drag it 30 further down
    const handle = rotatePoint(200, 125, c.x, c.y, 90);
    const out = resizeFrame(f, "e", handle.x, handle.y + 30);
    expect(out.w).toBeCloseTo(130);
    const west = rotatePoint(out.x, out.y + out.h / 2, out.x + out.w / 2, out.y + out.h / 2, 90);
    const was = rotatePoint(100, 125, c.x, c.y, 90);
    expect(west.x).toBeCloseTo(was.x);
    expect(west.y).toBeCloseTo(was.y);
  });

  it("finds bounds and hits of rotated frames", () => {
    const f = { x: 0, y: 0, w: 100, h: 20, rotation: 90 };
    const b = visualBounds(f);
    expect(b.w).toBeCloseTo(20);
    expect(b.h).toBeCloseTo(100);
    expect(inFrame(f, 50, 50)).toBe(true);
    expect(inFrame(f, 10, 50)).toBe(false);
    expect(inFrame(f, 10, 50, 50)).toBe(true);
    void hitsElement;
  });

  it("crops by an edge handle without moving the picture", () => {
    const r = cropByHandle({ x: 0, y: 0, w: 100, h: 100, rotation: 0 }, {}, "w", 25, 50);
    expect(r.frame).toMatchObject({ x: 25, w: 75 });
    expect(r.crop.l).toBeCloseTo(0.25);
    // dragging out past the picture stops at its edge
    const back = cropByHandle(r.frame, r.crop, "w", -40, 50);
    expect(back.frame.x).toBeCloseTo(0);
    expect(back.crop.l).toBeCloseTo(0);
  });
});
