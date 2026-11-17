import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, fromPptx, resolveFill, toPptx } from "../src";
import type { Deck, Fill } from "../src";

const stops = [{ at: 0, color: "#ff0000" }, { at: 1, color: "#0000ff" }];

describe("radial gradient centre", () => {
  it("survives PPTX, including the corner foci Google Slides writes", () => {
    const s = new DeckSession(createDeck());
    const id = s.deck.slides[0]!.id;
    const corner = s.addShape(id, "rect", { x: 10, y: 10, w: 100, h: 100 }, { fill: { gradient: { kind: "radial", center: { x: 1, y: 0 }, stops } } });
    const mid = s.addShape(id, "rect", { x: 200, y: 10, w: 100, h: 100 }, { fill: { gradient: { kind: "radial", stops } } });
    const back: Deck = fromPptx(toPptx(s.deck, { date: new Date(0) })).deck;
    const fills = back.slides[0]!.elements.filter((e) => e.type === "shape" && !e.placeholder).map((e) => (e as { fill: Fill }).fill) as { gradient: { kind: string; center?: { x: number; y: number } } }[];
    expect(fills[0]!.gradient).toMatchObject({ kind: "radial", center: { x: 1, y: 0 } });
    expect(fills[1]!.gradient.center).toBeUndefined();
    void corner; void mid;
  });

  it("resolves the centre for renderers", () => {
    const r = resolveFill({ gradient: { kind: "radial", center: { x: 0, y: 1 }, stops } }, createDeck().masters[0]!.theme);
    expect(r).toMatchObject({ kind: "gradient", gradientKind: "radial", center: { x: 0, y: 1 } });
  });
});

describe("radial extent", () => {
  it("is a circle sized by the shorter side when there is a focus, and an ellipse over the shape when there is none", async () => {
    const { radialExtent } = await import("../src");
    expect(radialExtent(undefined, 100, 50)).toEqual({ cx: 50, cy: 25, r: Math.hypot(100, 50) / 2 });
    const e = radialExtent({ x: 0, y: 0 }, 60, 200);
    expect(e.cx).toBe(0);
    expect(e.r).toBeCloseTo(60 * Math.SQRT2);
  });
});
