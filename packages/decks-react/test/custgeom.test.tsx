// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { customPath, customTextRect, paragraphsFromText, type CustomGeometry } from "@pli.dev/decks";
import { SlideView, hitTest } from "../src";
import { newSession, q, qa, render, sampleDeck, useHost } from "./harness";

useHost();

const circle: CustomGeometry = { paths: [{ w: 100, h: 100, commands: [["M", 0, 50], ["A", 50, 50, 10800000, 21600000], ["Z"]] }] };
const notched: CustomGeometry = {
  adjust: { adj: 25000 },
  guides: [{ name: "x1", fmla: "*/ w adj 100000" }],
  rect: { l: "x1", t: "t", r: "r", b: "b" },
  paths: [
    { w: 0, h: 0, commands: [["M", "l", "t"], ["L", "r", "t"], ["L", "r", "b"], ["L", "x1", "b"], ["Z"]] },
    { w: 10, h: 10, fill: "none", commands: [["M", 0, 0], ["L", 10, 10]] },
  ],
};

function setup() {
  const s = newSession(sampleDeck());
  const slide = s.deck.slides[2]!;
  const shape = s.addShape(slide.id, "custom", { x: 100, y: 100, w: 200, h: 100 }, {
    custom: notched,
    fill: "#ff8800",
    line: { width: 2, color: "#003366" },
    text: { paragraphs: paragraphsFromText("Inside") },
  });
  const image = s.addImage(slide.id, "data:image/png;base64,AAAA", { w: 120, h: 120 }, { x: 400, y: 100 }, { custom: circle, line: { width: 3, color: "#ff0000" } });
  return { s, slide, shape, image };
}

describe("custom geometry in SlideView", () => {
  it("draws a custom shape from its path, with fill, line, fill-less paths and the text rectangle", () => {
    const { s, slide, shape } = setup();
    render(<SlideView scene={s.scene(slide.id)} />);
    const el = q(`[data-element="${shape.id}"]`);
    const paths = qa<SVGPathElement>("path", el);
    const expected = customPath(notched, 200, 100);
    expect(paths.map((p) => p.getAttribute("d"))).toEqual(expected.map((p) => p.d));
    expect(paths[0]!.getAttribute("d")).toBe("M 0 0 L 200 0 L 200 100 L 50 100 Z");
    expect(paths[0]!.getAttribute("fill")).toBe("#ff8800");
    expect(paths[0]!.getAttribute("stroke")).toBe("#003366");
    expect(paths[0]!.getAttribute("stroke-width")).toBe("2");
    // a path with fill="none" is only stroked
    expect(paths[1]!.getAttribute("fill")).toBe("none");
    expect(paths[1]!.getAttribute("stroke")).toBe("#003366");
    // the text sits in the geometry's own rectangle
    const rect = customTextRect(notched, 200, 100);
    const text = q(".pli-deck-text", el);
    expect(text.textContent).toBe("Inside");
    expect(text.style.left).toBe(`${rect.x}px`);
    expect(text.style.width).toBe(`${rect.w}px`);
    expect(rect).toEqual({ x: 50, y: 0, w: 150, h: 100 });
  });

  it("fills a custom shape with a gradient and flips only its geometry", () => {
    const { s, slide, shape } = setup();
    s.updateElement(slide.id, shape.id, { fill: { gradient: { angle: 90, stops: [{ at: 0, color: "#ff0000" }, { at: 1, color: "#0000ff" }] } }, flipH: true });
    render(<SlideView scene={s.scene(slide.id)} />);
    const el = q(`[data-element="${shape.id}"]`);
    expect(el.querySelector("linearGradient")).toBeTruthy();
    expect(qa<SVGPathElement>("path", el)[0]!.getAttribute("fill")).toMatch(/^url\(#/);
    expect((el.querySelector("svg") as SVGElement).style.transform).toBe("scale(-1, 1)");
  });

  it("clips a picture to its custom path and strokes the outline", () => {
    const { s, slide, image } = setup();
    render(<SlideView scene={s.scene(slide.id)} />);
    const el = q(`[data-element="${image.id}"]`);
    const d = customPath(circle, 120, 120).map((p) => p.d).join(" ");
    const clip = q(".pli-deck-image-clip", el);
    expect(clip.getAttribute("style")).toContain("clip-path");
    expect(clip.getAttribute("style")).toContain(d);
    expect(d.match(/C /g)).toHaveLength(4);
    const outline = q<SVGPathElement>("svg path", el);
    expect(outline.getAttribute("d")).toBe(d);
    expect(outline.getAttribute("stroke")).toBe("#ff0000");
  });

  it("is hit by clicks inside its bounding box", () => {
    const { s, slide, shape, image } = setup();
    const scene = s.scene(slide.id);
    expect(hitTest(scene, "slide", 150, 150)?.id).toBe(shape.id);
    expect(hitTest(scene, "slide", 460, 160)?.id).toBe(image.id);
    expect(hitTest(scene, "slide", 380, 160)).toBeNull();
  });

  it("keeps the picture a plain rectangle once the custom mask is removed", () => {
    const { s, slide, image } = setup();
    s.updateElement(slide.id, image.id, { custom: null });
    render(<SlideView scene={s.scene(slide.id)} />);
    expect(q(".pli-deck-image-clip", q(`[data-element="${image.id}"]`)).getAttribute("style") ?? "").not.toContain("clip-path");
  });
});
