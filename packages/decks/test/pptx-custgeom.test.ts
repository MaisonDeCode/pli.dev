import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { customPath, customTextRect, fromPptx, resolveSlide, toPptx, validateDeck, type Deck, type Element, type GroupElement, type ImageElement, type ShapeElement } from "../src";
import { PNG_1X1, simpleDeck, sp, txBody, para, xfrm } from "./fixtures/build-pptx";

// Hand-written custom geometry, as PowerPoint writes it. Sizes are in EMU (12700 per point).
const pt = (x: number | string, y: number | string) => `<a:pt x="${x}" y="${y}"/>`;
const wrapGeom = (inner: string, rect = '<a:rect l="l" t="t" r="r" b="b"/>', lists = "") => `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>${rect}<a:pathLst>${inner}</a:pathLst></a:custGeom>`.replace("<a:gdLst/>", lists || "<a:gdLst/>");
const solid = '<a:solidFill><a:srgbClr val="336699"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:ln>';
const shape = (id: number, name: string, box: [number, number, number, number], geom: string, tx = "") => sp(id, name, { spPr: `${xfrm(...box)}${geom}${solid}`, tx });

// a circle, as four quarter arcs from the left point
const CIRCLE = wrapGeom(
  `<a:path w="100" h="100"><a:moveTo>${pt(0, 50)}</a:moveTo><a:arcTo wR="50" hR="50" stAng="10800000" swAng="5400000"/><a:arcTo wR="50" hR="50" stAng="16200000" swAng="5400000"/><a:arcTo wR="50" hR="50" stAng="0" swAng="5400000"/><a:arcTo wR="50" hR="50" stAng="5400000" swAng="5400000"/><a:close/></a:path>`,
);

const circlePic = (id: number, rid: string, box: [number, number, number, number]) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Round photo" descr="A photo"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(...box)}${CIRCLE}</p:spPr></p:pic>`;

const BLOB = wrapGeom(
  `<a:path w="2000" h="1000"><a:moveTo>${pt(0, 500)}</a:moveTo><a:quadBezTo>${pt(0, 0)}${pt(1000, 0)}</a:quadBezTo><a:quadBezTo>${pt(2000, 0)}${pt(2000, 500)}</a:quadBezTo><a:cubicBezTo>${pt(2000, 800)}${pt(1500, 1000)}${pt(1000, 1000)}</a:cubicBezTo><a:lnTo>${pt(300, 900)}</a:lnTo><a:close/></a:path>`,
);

const ARC = wrapGeom(`<a:path w="100" h="100" fill="none"><a:moveTo>${pt(100, 50)}</a:moveTo><a:arcTo wR="50" hR="50" stAng="0" swAng="10800000"/></a:path>`);

const OPEN = wrapGeom(`<a:path w="100" h="100" fill="none"><a:moveTo>${pt(0, 100)}</a:moveTo><a:lnTo>${pt(50, 0)}</a:lnTo><a:lnTo>${pt(100, 100)}</a:lnTo></a:path><a:path w="10" h="10" stroke="0"><a:moveTo>${pt(0, 0)}</a:moveTo><a:lnTo>${pt(10, 0)}</a:lnTo><a:lnTo>${pt(10, 10)}</a:lnTo><a:close/></a:path>`);

// a rectangle with a notch whose depth is an adjustment, and text that stays out of the notch
const GUIDED = `<a:custGeom><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst><a:gdLst><a:gd name="x1" fmla="*/ w adj 100000"/><a:gd name="y1" fmla="*/ h 1 2"/></a:gdLst><a:ahLst/><a:cxnLst/><a:rect l="x1" t="t" r="r" b="b"/><a:pathLst><a:path><a:moveTo><a:pt x="l" y="t"/></a:moveTo><a:lnTo><a:pt x="r" y="t"/></a:lnTo><a:lnTo><a:pt x="r" y="b"/></a:lnTo><a:lnTo><a:pt x="x1" y="b"/></a:lnTo><a:lnTo><a:pt x="x1" y="y1"/></a:lnTo><a:lnTo><a:pt x="l" y="y1"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`;

const slideXml = (circleBox: [number, number, number, number] = [914400, 914400, 1828800, 1828800]) => [
  circlePic(10, "rId2", circleBox),
  shape(11, "Blob", [3000000, 914400, 2540000, 1270000], BLOB),
  shape(12, "Half ring", [6000000, 914400, 1270000, 1270000], ARC),
  shape(13, "Peak", [914400, 3000000, 1270000, 1270000], OPEN),
  shape(14, "Notched", [3000000, 3000000, 2540000, 1270000], GUIDED, txBody(para("Notch text"))),
  shape(15, "Sizeless", [6000000, 3000000, 2540000, 1270000], `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path><a:moveTo>${pt(0, 0)}</a:moveTo><a:lnTo>${pt(2540000, 0)}</a:lnTo><a:lnTo>${pt(2540000, 1270000)}</a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`),
];

const FILES = { slideRels: [[{ id: "rId2", type: "image", target: "../media/dot.png" }]], parts: { "ppt/media/dot.png": PNG_1X1 } };
const build = (shapes: string[] = slideXml()) => simpleDeck([shapes.join("")], FILES);

const els = (deck: Deck): Element[] => deck.slides[0]!.elements;
const named = (deck: Deck, name: string) => els(deck).find((e) => e.name === name)!;

describe("custGeom import", () => {
  const { deck, warnings } = fromPptx(build());

  it("reads every freeform without a warning, and the deck validates", () => {
    expect(warnings.filter((w) => /freeform|replaced/.test(w))).toEqual([]);
    expect(warnings).toEqual([]);
    expect(() => validateDeck(deck)).not.toThrow();
  });

  it("masks a picture with its path", () => {
    const img = named(deck, "Round photo") as ImageElement;
    expect(img.type).toBe("image");
    expect(img.geometry).toBeUndefined();
    expect(img.custom!.paths).toHaveLength(1);
    expect(img.custom!.paths[0]!.commands.map((c) => c[0])).toEqual(["M", "A", "A", "A", "A", "Z"]);
    expect(img.custom!.paths[0]).toMatchObject({ w: 100, h: 100 });
    expect(img.custom!.paths[0]!.commands[1]).toEqual(["A", 50, 50, 10800000, 5400000]);
    const el = resolveSlide(deck, deck.slides[0]!).elements.find((e) => e.id === img.id)!;
    expect(el.custom).toEqual(img.custom);
    const d = customPath(el.custom!, el.w, el.h).map((p) => p.d).join(" ");
    expect(d).toMatch(/^M 0 72 C /);
    expect(d.match(/C /g)).toHaveLength(4);
  });

  it("reads a blob with quadratic and cubic curves", () => {
    const blob = named(deck, "Blob") as ShapeElement;
    expect(blob.geometry).toBe("custom");
    expect(blob.fill).toBe("#336699");
    expect(blob.custom!.paths[0]!.commands.map((c) => c[0])).toEqual(["M", "Q", "Q", "C", "L", "Z"]);
    expect(blob.custom!.paths[0]).toMatchObject({ w: 2000, h: 1000 });
    expect(blob.custom!.rect).toBeUndefined();
  });

  it("reads an arc and stroke-only paths", () => {
    const ring = named(deck, "Half ring") as ShapeElement;
    expect(ring.custom!.paths[0]).toMatchObject({ fill: "none", commands: [["M", 100, 50], ["A", 50, 50, 0, 10800000]] });
    const peak = named(deck, "Peak") as ShapeElement;
    expect(peak.custom!.paths).toHaveLength(2);
    expect(peak.custom!.paths[0]!.fill).toBe("none");
    expect(peak.custom!.paths[1]).toMatchObject({ stroke: false, w: 10, h: 10 });
    const out = customPath(peak.custom!, peak.w!, peak.h!);
    expect(out.map((p) => [p.fill, p.stroke])).toEqual([[false, true], [true, false]]);
  });

  it("reads guides, adjustments and the text rectangle", () => {
    const n = named(deck, "Notched") as ShapeElement;
    expect(n.custom!.adjust).toEqual({ adj: 25000 });
    expect(n.custom!.guides).toEqual([{ name: "x1", fmla: "*/ w adj 100000" }, { name: "y1", fmla: "*/ h 1 2" }]);
    expect(n.custom!.rect).toEqual({ l: "x1", t: "t", r: "r", b: "b" });
    // made of guides, the path has no size of its own: it is drawn in the element's EMU space and follows the element
    expect(n.custom!.paths[0]).toMatchObject({ w: 0, h: 0 });
    expect(customPath(n.custom!, 200, 100)[0]!.d).toBe("M 0 0 L 200 0 L 200 100 L 50 100 L 50 50 L 0 50 Z");
    expect(customTextRect(n.custom!, 200, 100)).toEqual({ x: 50, y: 0, w: 150, h: 100 });
    // and it follows a resize
    expect(customPath(n.custom!, 400, 100)[0]!.d).toBe("M 0 0 L 400 0 L 400 100 L 100 100 L 100 50 L 0 50 Z");
  });

  it("gives a path with no size the element's box", () => {
    const s = named(deck, "Sizeless") as ShapeElement;
    expect(s.custom!.paths[0]).toMatchObject({ w: 2540000, h: 1270000 });
    expect(customPath(s.custom!, s.w!, s.h!)[0]!.d).toBe("M 0 0 L 200 0 L 200 100 Z");
  });

  it("reads freeforms inside groups, scaled with the group", () => {
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="40" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="1270000"/></a:xfrm></p:grpSpPr>${shape(41, "Inner", [0, 0, 1270000, 1270000], BLOB)}</p:grpSp>`;
    const { deck: d, warnings: w } = fromPptx(build([group]));
    expect(w).toEqual([]);
    const g = els(d)[0] as GroupElement;
    const inner = g.children[0] as ShapeElement;
    expect(inner.w).toBe(200);
    expect(inner.custom!.paths).toHaveLength(1);
  });

  it("warns, but still draws, when a path uses a guide nothing defines, and drops paths with nothing to draw", () => {
    const typo = wrapGeom(`<a:path w="100" h="100"><a:moveTo>${pt(0, 0)}</a:moveTo><a:lnTo>${pt("nowhere", 100)}</a:lnTo><a:lnTo>${pt(100, 100)}</a:lnTo><a:close/></a:path>`);
    const empty = wrapGeom(`<a:path w="100" h="100"><a:moveTo>${pt(0, 0)}</a:moveTo></a:path>`);
    const { deck: d, warnings: w } = fromPptx(build([shape(20, "Typo", [0, 0, 1270000, 1270000], typo), shape(21, "Empty", [0, 0, 1270000, 1270000], empty)]));
    expect(w.some((m) => /guide/.test(m) && /nowhere/.test(m))).toBe(true);
    expect(w.some((m) => /without a drawable path/.test(m))).toBe(true);
    expect((els(d)[0] as ShapeElement).custom).toBeDefined();
    expect(els(d)[1]).toMatchObject({ geometry: "rect" });
    expect((els(d)[1] as ShapeElement).custom).toBeUndefined();
    expect(() => validateDeck(d)).not.toThrow();
  });

  it("caps absurdly large paths", () => {
    const lines = Array.from({ length: 21_000 }, (_, i) => `<a:lnTo>${pt(i % 100, i % 50)}</a:lnTo>`).join("");
    const big = wrapGeom(`<a:path w="100" h="100"><a:moveTo>${pt(0, 0)}</a:moveTo>${lines}</a:path>`);
    const { deck: d, warnings: w } = fromPptx(build([shape(30, "Big", [0, 0, 1270000, 1270000], big)]));
    expect(w.some((m) => /too complex/.test(m))).toBe(true);
    expect((els(d)[0] as ShapeElement).custom!.paths[0]!.commands.length).toBeLessThanOrEqual(20_000);
    expect(() => validateDeck(d)).not.toThrow();
  });
});

describe("custGeom export", () => {
  const original = fromPptx(build()).deck;
  const bytes = toPptx(original);
  const files = unzipSync(bytes);
  const slideName = Object.keys(files).find((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))!;
  const xml = strFromU8(files[slideName]!);

  it("writes a:custGeom for shapes and pictures in schema order", () => {
    expect(xml.match(/<a:custGeom>/g)).toHaveLength(6);
    expect(xml).not.toContain('prst="custom"');
    for (const m of xml.matchAll(/<a:custGeom>(.*?)<\/a:custGeom>/g)) {
      const order = [...m[1]!.matchAll(/<a:(avLst|gdLst|ahLst|cxnLst|rect|pathLst)\b/g)].map((x) => x[1]);
      expect(order).toEqual(["avLst", "gdLst", "ahLst", "cxnLst", "rect", "pathLst"]);
    }
    // in a picture, the geometry follows the transform
    const pic = /<p:pic>.*?<\/p:pic>/s.exec(xml)![0];
    expect(pic).toMatch(/<\/a:xfrm><a:custGeom>/);
    expect(pic).not.toContain("prstGeom");
    expect(xml).toContain('<a:gd name="adj" fmla="val 25000"/>');
    expect(xml).toContain('<a:gd name="x1" fmla="*/ w adj 100000"/>');
    expect(xml).toContain('<a:rect l="x1" t="t" r="r" b="b"/>');
    expect(xml).toContain('<a:path w="100" h="100" fill="none">');
    expect(xml).toContain("<a:path><a:moveTo><a:pt x=\"l\" y=\"t\"/>");
    expect(xml).toContain('stroke="0"');
    expect(xml).toContain('<a:arcTo wR="50" hR="50" stAng="10800000" swAng="5400000"/>');
    expect(xml).toContain("<a:quadBezTo>");
  });

  it("reads back to the same freeforms", () => {
    const { deck, warnings } = fromPptx(bytes);
    expect(warnings).toEqual([]);
    for (const name of ["Round photo", "Blob", "Half ring", "Peak", "Notched", "Sizeless"]) {
      expect((named(deck, name) as ShapeElement).custom, name).toEqual((named(original, name) as ShapeElement).custom);
    }
    expect(named(deck, "Blob")).toMatchObject({ type: "shape", geometry: "custom" });
    expect(named(deck, "Round photo")).toMatchObject({ type: "image" });
    // and a second trip changes nothing
    const again = fromPptx(toPptx(deck)).deck;
    for (const name of ["Round photo", "Notched"]) expect((named(again, name) as ShapeElement).custom).toEqual((named(deck, name) as ShapeElement).custom);
  });

  it("keeps fractional path coordinates by writing them at a larger scale", () => {
    const { deck } = fromPptx(build([shape(50, "Frac", [0, 0, 1270000, 1270000], BLOB)]));
    const s = deck.slides[0]!.elements[0] as ShapeElement;
    s.custom = { paths: [{ w: 1, h: 1, commands: [["M", 0.25, 0.5], ["L", 0.75, 0.5], ["A", 0.25, 0.25, 0, 5400000], ["Z"]] }] };
    const out = fromPptx(toPptx(deck)).deck.slides[0]!.elements[0] as ShapeElement;
    expect(out.custom!.paths[0]).toMatchObject({ w: 1000, h: 1000 });
    const a = customPath(s.custom!, 100, 100)[0]!.d;
    const b = customPath(out.custom!, 100, 100)[0]!.d;
    expect(b).toBe(a);
  });

  it("writes a shape named custom without a path as a rectangle", () => {
    const { deck } = fromPptx(build([shape(51, "Nothing", [0, 0, 1270000, 1270000], BLOB)]));
    const s = deck.slides[0]!.elements[0] as ShapeElement;
    delete s.custom;
    const out = strFromU8(unzipSync(toPptx(deck))[slideName]!);
    expect(out).not.toContain("custGeom");
    expect(out).toContain('<a:prstGeom prst="rect">');
  });
});
