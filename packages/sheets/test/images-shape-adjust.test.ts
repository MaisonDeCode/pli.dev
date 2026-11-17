import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { IMAGE_SHAPE_NAMES, SHAPE_ADJUSTMENTS, SheetSession, cleanShapeAdjust, createWorkbook, dragShapeHandle, fromXlsx, parseWorkbook, serializeWorkbook, shapeHandles, shapePath, shapeValues, toXlsx } from "../src";
import { pngUri } from "./images-helpers";

const make = () => new SheetSession(createWorkbook("adj", ["Data"]));
const SRC = pngUri(40, 20);
const nums = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe("shape adjustments (the yellow handles)", () => {
  it("every shape with handles has Office's defaults, in range, and a handle for each adjustment", () => {
    for (const [name, entry] of Object.entries(SHAPE_ADJUSTMENTS)) {
      const shape = name as (typeof IMAGE_SHAPE_NAMES)[number];
      const values = shapeValues(shape, 200, 100);
      for (const a of entry!.specs) {
        expect(values[a.name], `${shape} ${a.name}`).toBe(a.default);
        expect(a.default).toBeGreaterThanOrEqual(a.min);
        expect(a.default).toBeLessThanOrEqual(a.max(200, 100));
      }
      const handles = shapeHandles(shape, 200, 100);
      expect(handles.length, shape).toBeGreaterThan(0);
      expect(new Set(handles.flatMap((h) => h.names))).toEqual(new Set(entry!.specs.map((s) => s.name)));
      for (const h of handles) expect(Number.isFinite(h.x + h.y), shape).toBe(true);
      // the path is drawn with and without the defaults spelled out, and never has a bad number
      expect(shapePath(shape, 200, 100, values), shape).toBe(shapePath(shape, 200, 100));
      expect(shapePath(shape, 200, 100)).not.toMatch(/NaN|undefined/);
    }
  });

  it("changes the outline when a value changes: corner radius, arrow head, star depth, trapezoid slant", () => {
    expect(shapePath("roundRect", 100, 100, { adj: 40000 })).not.toBe(shapePath("roundRect", 100, 100));
    expect(shapePath("roundRect", 100, 100, { adj: 0 })).toMatch(/^M0 0L100 0/);
    expect(nums(shapePath("rightArrow", 100, 100, { adj2: 20000 }))).toContain(80);
    expect(nums(shapePath("rightArrow", 100, 100, { adj1: 20000 }))).toContain(40);
    const star = nums(shapePath("star5", 100, 100));
    const deep = nums(shapePath("star5", 100, 100, { adj: 5000 }));
    expect(deep).not.toEqual(star);
    expect(nums(shapePath("trapezoid", 100, 100, { adj: 10000 }))).toContain(10);
    expect(nums(shapePath("triangle", 100, 100, { adj: 0 }))).toContain(0);
  });

  it("keeps a value inside its range when drawn", () => {
    expect(shapeValues("roundRect", 100, 100, { adj: 90000 }).adj).toBe(50000);
    expect(shapeValues("trapezoid", 400, 100, { adj: 90000 }).adj).toBe(90000);
    expect(shapeValues("trapezoid", 100, 100, { adj: 90000 }).adj).toBe(50000);
    expect(shapeValues("star5", 100, 100, { adj: -5 }).adj).toBe(0);
  });

  it("gives a value for a handle dragged to a point, and puts the handle where it is dragged", () => {
    // a rounded rectangle: the handle is on the top edge, at the radius
    const [h] = shapeHandles("roundRect", 200, 100, { adj: 20000 });
    expect(h).toMatchObject({ x: 20, y: 0 });
    expect(dragShapeHandle("roundRect", 0, 30, 0, 200, 100)).toEqual({ adj: 30000 });
    expect(dragShapeHandle("roundRect", 0, 16.667, 0, 200, 100)).toBeUndefined();
    expect(dragShapeHandle("roundRect", 0, 500, 0, 200, 100)).toEqual({ adj: 50000 });
    // an arrow: the shaft handle moves up and down, the head handle along
    expect(dragShapeHandle("rightArrow", 0, 150, 10, 200, 100)).toEqual({ adj1: 80000 });
    expect(dragShapeHandle("rightArrow", 1, 150, 0, 200, 100)).toBeUndefined();
    expect(dragShapeHandle("rightArrow", 1, 170, 0, 200, 100)).toEqual({ adj2: 30000 });
    // a callout's tail: one handle sets both guides
    expect(dragShapeHandle("wedgeRectCallout", 0, 100 + 200 * 0.1, 50 + 100 * 0.9, 200, 100)).toEqual({ adj1: 10000, adj2: 90000 });
    // a star: the handle sits on an inner vertex and dragging it in makes the star spikier
    const [sh] = shapeHandles("star5", 100, 100);
    const spikier = dragShapeHandle("star5", 0, 50 + (sh!.x - 50) * 0.5, 50 + (sh!.y - 50) * 0.5, 100, 100);
    expect(spikier!.adj!).toBeLessThan(19098);
  });

  it("refuses names the shape does not have, and drops values equal to the default", () => {
    expect(() => cleanShapeAdjust("roundRect", { adj2: 5 })).toThrow(/no adjustment "adj2"/);
    expect(() => cleanShapeAdjust("ellipse", { adj: 5 })).toThrow(/no adjustment/);
    expect(() => cleanShapeAdjust("roundRect", { adj: Number.NaN })).toThrow(/number/);
    expect(cleanShapeAdjust("roundRect", { adj: 16667 })).toBeUndefined();
    expect(cleanShapeAdjust("roundRect", { adj: 20000.4 })).toEqual({ adj: 20000 });
  });

  it("is kept on the picture, reset when the shape changes, refused without a shape, and saved in the workbook", () => {
    const s = make();
    const img = s.addImage("Data", { src: SRC, width: 200, height: 100, shape: "roundRect", shapeAdjust: { adj: 30000 } });
    expect(s.images("Data")[0]!.shapeAdjust).toEqual({ adj: 30000 });
    s.formatImage("Data", img.id, { shapeAdjust: { adj: 10000 } });
    expect(s.images("Data")[0]!.shapeAdjust).toEqual({ adj: 10000 });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.images![0]!.shapeAdjust).toEqual({ adj: 10000 });
    s.undo();
    expect(s.images("Data")[0]!.shapeAdjust).toEqual({ adj: 30000 });
    s.cropImageToShape("Data", img.id, "star5");
    expect(s.images("Data")[0]!.shapeAdjust).toBeUndefined();
    s.cropImageToShape("Data", img.id, null);
    expect(() => s.formatImage("Data", img.id, { shapeAdjust: { adj: 1 } })).toThrow(/need a shape/);
  });

  it("is written as Office's guides (a:avLst) and read back, for every shape that has them", () => {
    const s = make();
    const wanted: Record<string, Record<string, number>> = { roundRect: { adj: 40000 }, rightArrow: { adj1: 30000, adj2: 70000 }, star5: { adj: 10000 }, wedgeRoundRectCallout: { adj1: 10000, adj2: 90000, adj3: 5000 }, snip2SameRect: { adj1: 20000, adj2: 8000 } };
    for (const [shape, adjust] of Object.entries(wanted)) s.addImage("Data", { src: SRC, width: 200, height: 100, shape: shape as never, shapeAdjust: adjust });
    const files = unzipSync(toXlsx(s.state));
    const xml = strFromU8(files[Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!]!);
    expect(xml).toContain('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 40000"/></a:avLst></a:prstGeom>');
    expect(xml).toContain('<a:gd name="adj1" fmla="val 30000"/><a:gd name="adj2" fmla="val 70000"/>');
    const { workbook, warnings } = fromXlsx(toXlsx(s.state));
    expect(warnings).toEqual([]);
    const got = Object.fromEntries(workbook.sheets[0]!.images!.map((i) => [i.shape, i.shapeAdjust]));
    expect(got).toEqual(wanted);
  });

  it("reads Excel's own forms: a guide with a formula Pli can't use, an unknown guide and the default left as it is", () => {
    const s = make();
    s.addImage("Data", { src: SRC, width: 200, height: 100, shape: "roundRect", shapeAdjust: { adj: 40000 } });
    const files = unzipSync(toXlsx(s.state));
    const key = Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    const read = (gds: string) => fromXlsx(zipSync({ ...files, [key]: strToU8(strFromU8(files[key]!).replace('<a:gd name="adj" fmla="val 40000"/>', gds)) })).workbook.sheets[0]!.images![0]!.shapeAdjust;
    expect(read('<a:gd name="adj" fmla="val 25000"/>')).toEqual({ adj: 25000 });
    expect(read('<a:gd name="adj" fmla="val 16667"/>')).toBeUndefined();
    expect(read('<a:gd name="adj" fmla="*/ ss 1 2"/>')).toBeUndefined();
    expect(read('<a:gd name="adj2" fmla="val 9"/><a:gd name="adj" fmla="val 1000"/>')).toEqual({ adj: 1000 });
    expect(read('<a:gd name="adj" fmla="val 99999"/>')).toEqual({ adj: 50000 });
  });

  it("has the callouts in the shape list", () => {
    expect(IMAGE_SHAPE_NAMES).toContain("wedgeRectCallout");
    const tail = shapePath("wedgeRectCallout", 200, 100, { adj1: 0, adj2: 100000 });
    // the tail leaves the bottom edge and points at (100, 150)
    expect(tail).toContain("L100 150");
    expect(shapePath("wedgeRoundRectCallout", 200, 100)).toMatch(/A/);
    expect(shapePath("wedgeEllipseCallout", 200, 100, { adj1: 0, adj2: 100000 })).toMatch(/^M[\d. ]+A/);
  });
});
