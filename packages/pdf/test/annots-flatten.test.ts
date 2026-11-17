// Flattening: appearances are drawn into the page and the annotations go.
import { describe, expect, it } from "vitest";
import { PdfFile, isArray, isDict, openPdf } from "../src";
import { WHITE, expectPixel, newSession } from "./support/annots";
import { buildClassic, obj, simpleDoc, streamObj } from "./support/handmade";
import { renderPdf } from "./support/render";

const PAGE = "p:main:0";

describe("flattenAnnotations", () => {
  it("draws appearances into the page and removes every annotation but links", async () => {
    const s = await newSession();
    s.annots.addHighlight(PAGE, [{ x: 20, y: 30, w: 100, h: 20 }], { color: "#ffeb3b" });
    s.annots.addShape(PAGE, "square", { x: 20, y: 100, w: 80, h: 60 }, { color: "#000000", width: 3, fill: "#ff0000" });
    s.annots.addFreeText(PAGE, { x: 120, y: 100, w: 100, h: 40 }, "Flat text", { size: 14, fill: "#ccffcc" });
    s.annots.addLink(PAGE, { x: 20, y: 200, w: 60, h: 20 }, { uri: "https://example.com" });
    const before = await renderPdf(await s.save(), 0, 2);
    const result = await s.saveDetailed({ flatten: "annotations" });
    expect(result.mode).toBe("rewrite");
    const file = PdfFile.open(result.bytes);
    const annots = file.dictGet(file.pages()[0]!.dict, "Annots");
    expect(isArray(annots) ? annots.length : 0).toBe(1);
    const after = await renderPdf(result.bytes, 0, 2);
    for (const [x, y] of [[70, 40], [60, 130], [170, 120], [100, 360]] as const) {
      expect(after.pixel(x, y), `pixel ${x},${y}`).toEqual(before.pixel(x, y));
    }
    expect(after.inkIn(0, 0, 300, 400)).toBeGreaterThan(before.inkIn(0, 0, 300, 400) - 300);
    expect(after.text).toContain("Hello annotated world");
    const again = await openPdf(result.bytes);
    expect(again.doc.pages[0]!.annots.map((a) => a.type)).toEqual(["link"]);
    expect(result.warnings).toEqual([]);
  });

  it("places an appearance by its BBox and Matrix into the annotation's Rect", async () => {
    const objs = simpleDoc(1, { mediaBox: "[0 0 300 400]", pageExtra: () => "/Annots [20 0 R 21 0 R 23 0 R]" });
    // 1: catalog, 2: pages, 3: page, 4: contents.
    objs.push(obj(20, "<< /Type /Annot /Subtype /Stamp /Rect [100 100 160 130] /F 4 /AP << /N 22 0 R >> >>"));
    objs.push(obj(21, "<< /Type /Annot /Subtype /Stamp /Rect [200 100 260 130] /F 4 /AP << /N 24 0 R >> >>"));
    objs.push(streamObj(22, "/Type /XObject /Subtype /Form /BBox [0 0 10 10]", "1 0 0 rg 0 0 10 10 re f"));
    // Hidden annotations are not drawn.
    objs.push(obj(23, "<< /Type /Annot /Subtype /Stamp /Rect [20 300 80 330] /F 2 /AP << /N 22 0 R >> >>"));
    // A rotated form: 90 degrees about the origin, BBox 10 x 20 ends up 20 x 10 and is stretched to the Rect.
    objs.push(streamObj(24, "/Type /XObject /Subtype /Form /BBox [0 0 10 20] /Matrix [0 1 -1 0 0 0]", "0 0 1 rg 0 0 10 20 re f 1 1 0 rg 0 0 10 5 re f"));
    const bytes = buildClassic(objs).bytes;
    const session = await openPdf(bytes);
    const out = await session.save({ flatten: "annotations" });
    const r = await renderPdf(out, 0, 2);
    expect(PdfFile.open(out).pages()[0]!.dict.has("Annots")).toBe(false);
    expectPixel(r, 130, 400 - 115, [255, 0, 0], 10);
    expectPixel(r, 101, 400 - 101, [255, 0, 0], 10);
    expectPixel(r, 159, 400 - 129, [255, 0, 0], 10);
    expectPixel(r, 99, 400 - 115, WHITE, 5);
    // The rotated one: blue, with a yellow strip along the side that the rotation puts at the left... (the form's bottom 5 units).
    expectPixel(r, 235, 400 - 115, [0, 0, 255], 10);
    expectPixel(r, 50, 400 - 315, WHITE, 5); // the hidden one is gone
    const yellowAt = [r.pixel(203, 400 - 115), r.pixel(257, 400 - 115)];
    expect(yellowAt.some((p) => p[0] > 200 && p[1] > 200 && p[2] < 80)).toBe(true);
  });

  it("makes an appearance for annotations that have none", async () => {
    const objs = simpleDoc(1, { mediaBox: "[0 0 300 400]", pageExtra: () => "/Annots [20 0 R 21 0 R]" });
    objs.push(obj(20, "<< /Type /Annot /Subtype /Square /Rect [100 100 160 130] /C [1 0 0] /IC [0 0 1] /BS << /W 2 >> >>"));
    objs.push(obj(21, "<< /Type /Annot /Subtype /Caret /Rect [20 20 40 40] >>"));
    const bytes = buildClassic(objs).bytes;
    const out = await (await openPdf(bytes)).saveDetailed({ flatten: "annotations" });
    const r = await renderPdf(out.bytes, 0, 2);
    expectPixel(r, 130, 400 - 115, [0, 0, 255], 10);
    // The caret cannot be drawn without an appearance: it stays, and we say so.
    expect(out.warnings.join(" ")).toMatch(/1 annotation has no appearance/);
    const file = PdfFile.open(out.bytes);
    const left = file.dictGet(file.pages()[0]!.dict, "Annots");
    expect(isArray(left) && left.length === 1 && isDict(file.get(left[0]))).toBe(true);
  });

  it("wraps the old content so a stray q or cm in it cannot move the drawing", async () => {
    const s = await newSession(buildClassic(simpleDoc(1, { mediaBox: "[0 0 300 400]", text: () => "2 0 0 2 50 50 cm BT /F1 14 Tf 20 360 Td (Hello) Tj ET" })).bytes);
    s.annots.addShape(PAGE, "square", { x: 20, y: 100, w: 40, h: 40 }, { width: 0, fill: "#ff0000" });
    const out = await s.save({ flatten: "annotations" });
    const r = await renderPdf(out, 0, 2);
    expectPixel(r, 40, 120, [255, 0, 0], 10);
  });
});
