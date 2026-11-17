import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { IMAGE_SHAPES, IMAGE_SHAPE_NAMES, SHAPE_GROUPS, SheetSession, cleanShape, createWorkbook, fromXlsx, parseWorkbook, serializeWorkbook, shapeOfPreset, shapePath, toXlsx } from "../src";
import { lintPackage } from "./excel-check/lint";
import { pngUri } from "./images-helpers";

const make = () => new SheetSession(createWorkbook("shapes", ["Data", "Other"]));
const SRC = pngUri(40, 20);
const drawing = (s: SheetSession) => {
  const files = unzipSync(toXlsx(s.state));
  return { files, xml: strFromU8(files[Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!]!) };
};

/** The points a path goes through (an arc is taken as a line to its end), as numbers. */
function polygon(d: string): [number, number][] {
  return [...d.replace(/A[\d.]+ [\d.]+ 0 [01] [01] /g, "L").matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}
const area = (pts: [number, number][]) => Math.abs(pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * y, 0)) / 2;

describe("the shapes a picture can be cropped to", () => {
  it("have a name Excel uses, a label and a group", () => {
    expect(IMAGE_SHAPE_NAMES).toHaveLength(36);
    for (const k of IMAGE_SHAPE_NAMES) {
      expect(IMAGE_SHAPES[k].label.length, k).toBeGreaterThan(2);
      expect(SHAPE_GROUPS).toContain(IMAGE_SHAPES[k].group);
      expect(shapeOfPreset(k)).toBe(k);
      expect(cleanShape(k)).toBe(k);
    }
    expect(shapeOfPreset("rect")).toBeUndefined();
    expect(shapeOfPreset("cloud")).toBeUndefined();
    expect(shapeOfPreset("constructor")).toBeUndefined();
    expect(() => cleanShape("cloud" as never)).toThrow(/shape is one of/);
    expect(() => cleanShape("toString" as never)).toThrow();
  });

  it("each draws a closed outline made of finite numbers, for a wide, a tall and a small frame", () => {
    for (const k of IMAGE_SHAPE_NAMES) {
      for (const [w, h] of [[200, 100], [60, 180], [5, 5]] as const) {
        const d = shapePath(k, w, h);
        expect(d, k).toMatch(/^M/);
        expect(d, k).toMatch(/Z$/);
        expect(d, k).not.toMatch(/NaN|Infinity/);
        // Everything stays within the frame (a speech bubble's tail points outside it; a heart's curves are drawn with controls that reach outside it, the line itself does not).
        if (k !== "heart" && !k.startsWith("wedge")) for (const [x, y] of polygon(d)) {
          expect(x, `${k} x`).toBeGreaterThanOrEqual(-0.01);
          expect(x, `${k} x`).toBeLessThanOrEqual(w + 0.01);
          expect(y, `${k} y`).toBeGreaterThanOrEqual(-0.01);
          expect(y, `${k} y`).toBeLessThanOrEqual(h + 0.01);
        }
      }
    }
  });

  it("have the areas their geometry says", () => {
    const w = 200;
    const h = 100;
    const a = (k: (typeof IMAGE_SHAPE_NAMES)[number]) => area(polygon(shapePath(k, w, h)));
    expect(a("triangle")).toBeCloseTo((w * h) / 2, 0);
    expect(a("rtTriangle")).toBeCloseTo((w * h) / 2, 0);
    expect(a("diamond")).toBeCloseTo((w * h) / 2, 0);
    expect(a("parallelogram")).toBeCloseTo(w * h - 25 * 100 * 0.5 * 2 * 1, -1); // two triangles of 25 by 100 are cut off
    expect(a("trapezoid")).toBeCloseTo(w * h - 25 * 100, 0);
    expect(a("plus")).toBeCloseTo(w * h - 4 * 25 * 25, 0);
    expect(a("octagon")).toBeCloseTo(w * h - 4 * 0.5 * 29.289 ** 2, 0);
    // A star has less area than the pentagon round it; more points with a fatter body have more.
    expect(a("star5")).toBeLessThan(a("pentagon"));
    expect(a("star8")).toBeGreaterThan(a("star5"));
    expect(a("star4")).toBeLessThan(a("diamond"));
    // The snipped and rounded rectangles lose their corners and nothing else.
    expect(a("snip1Rect")).toBeCloseTo(w * h - 0.5 * 16.667 ** 2, 0);
    expect(a("snip2DiagRect")).toBeCloseTo(w * h - 2 * 0.5 * 16.667 ** 2, 0);
  });

  it("an oval and a rounded rectangle use arcs, the others straight lines", () => {
    expect(shapePath("ellipse", 80, 40)).toContain("A40 20");
    expect(shapePath("roundRect", 80, 60)).toContain("A10 10 0 0 1");
    expect(shapePath("triangle", 80, 60)).not.toMatch(/[AC]/);
    expect(shapePath("heart", 80, 60)).toContain("C");
  });
});

describe("a picture cropped to a shape", () => {
  it("is set in one undo step, with a guard, and taken off with null", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, width: 100, height: 50 });
    expect(p.shape).toBeUndefined();
    s.cropImageToShape("Data", p.id, "ellipse");
    expect(s.images("Data")[0]!.shape).toBe("ellipse");
    s.formatImage("Data", p.id, { shape: "star5", rotation: 30 });
    expect(s.images("Data")[0]!).toMatchObject({ shape: "star5", rotation: 30 });
    s.undo();
    expect(s.images("Data")[0]!).toMatchObject({ shape: "ellipse" });
    expect(s.images("Data")[0]!.rotation).toBeUndefined();
    s.cropImageToShape("Data", p.id, null);
    expect(s.images("Data")[0]!.shape).toBeUndefined();
    s.undo();
    expect(s.images("Data")[0]!.shape).toBe("ellipse");
    expect(() => s.cropImageToShape("Data", p.id, "cloud" as never)).toThrow(/shape is one of/);
    expect(() => s.addImage("Data", { src: SRC, shape: "nope" as never })).toThrow(/shape is one of/);
    expect(s.images("Data")[0]!.shape).toBe("ellipse");
  });

  it("can be given when the picture is added, is copied with it, and keeps its crop to a ratio", () => {
    const s = make();
    const p = s.addImage("Data", { src: pngUri(100, 50), width: 100, height: 50, shape: "heart" });
    expect(s.copyImage("Data", p.id, { sheet: "Other" }).shape).toBe("heart");
    s.cropImageToRatio("Data", p.id, "1:1");
    expect(s.images("Data")[0]!).toMatchObject({ shape: "heart", crop: { left: 0.25, right: 0.25 } });
  });

  it("is kept in a saved workbook and a bad shape in one is refused", () => {
    const s = make();
    s.addImage("Data", { src: SRC, shape: "roundRect" });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.images![0]!.shape).toBe("roundRect");
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].images[0].shape = "cloud";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/shape/);
  });

  it("goes into an XLSX file as the picture's preset geometry and comes back", () => {
    const s = make();
    s.addImage("Data", { src: SRC, shape: "star5" });
    s.addImage("Data", { src: SRC });
    const { xml } = drawing(s);
    expect(xml).toContain('<a:prstGeom prst="star5"><a:avLst/></a:prstGeom>');
    expect(xml).toContain('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>');
    expect(lintPackage(toXlsx(s.state))).toEqual([]);
    const back = fromXlsx(toXlsx(s.state));
    expect(back.workbook.sheets[0]!.images!.map((x) => x.shape)).toEqual(["star5", undefined]);
    expect(back.warnings).toEqual([]);
  });

  it("every shape goes through an XLSX file", () => {
    for (const shape of IMAGE_SHAPE_NAMES) {
      const s = make();
      s.addImage("Data", { src: SRC, shape, rotation: 20, border: { color: "#ff0000" } });
      expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!, shape).toMatchObject({ shape, rotation: 20 });
    }
  });

  it("a shape Pli doesn't have is read as a rectangle, with a warning", () => {
    const s = make();
    s.addImage("Data", { src: SRC, shape: "star5" });
    const files = unzipSync(toXlsx(s.state));
    const name = Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    files[name] = new TextEncoder().encode(strFromU8(files[name]!).replace('prst="star5"', 'prst="cloud"'));
    const back = fromXlsx(zipSync(files));
    expect(back.workbook.sheets[0]!.images).toHaveLength(1);
    expect(back.workbook.sheets[0]!.images![0]!.shape).toBeUndefined();
    expect(back.warnings.join(" ")).toMatch(/shape Pli doesn't have/);
  });
});
