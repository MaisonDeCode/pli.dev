// Reading annotations other tools made into JSON; and never failing on bad input.
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { openPdf, readPdf } from "../src";
import type { Annotation } from "../src";
import { type AnnotOf } from "./support/annots";
import { buildClassic, obj, simpleDoc, streamObj } from "./support/handmade";
import { decodePng } from "../src/image";
import { parseDataUri } from "../src/annots/util";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));
const read = (bytes: Uint8Array) => readPdf(bytes).doc;
const annots = (bytes: Uint8Array, page = 0): Annotation[] => read(bytes).pages[page]!.annots;

describe("readAnnotations on files made by PyMuPDF", () => {
  const doc = read(fixture("annots-mupdf"));
  const list = doc.pages[0]!.annots;
  const by = <T extends Annotation["type"]>(type: T) => list.filter((a) => a.type === type) as unknown as AnnotOf<T>[];

  it("finds every kind, in order, and leaves popups out", () => {
    expect(list.map((a) => a.type)).toEqual(["highlight", "underline", "strikeout", "squiggly", "ink", "square", "circle", "line", "polygon", "polyline", "freetext", "note", "stamp", "link", "link"]);
    expect(list.every((a) => a.id.startsWith("a:main:") && a.ref === `${a.id.split(":")[2]} 0`)).toBe(true);
  });

  it("turns quads into one rectangle per line, in page space", () => {
    const h = by("highlight")[0]!;
    expect(h.rects).toHaveLength(1);
    expect(h.rects[0]!.x).toBeCloseTo(55.78, 1);
    expect(h.rects[0]!.y).toBeCloseTo(34.95, 1); // 400 - 365.05
    expect(h).toMatchObject({ color: "#ffff00", authorName: "Reviewer A", contents: "about highlighted" });
    expect(by("squiggly")[0]!.color).toBe("#0000ff");
  });

  it("finds the words under marked text", () => {
    expect(by("highlight")[0]!.quote).toBe("highlighted");
    expect(by("underline")[0]!.quote).toBe("Underlined");
    expect(by("strikeout")[0]!.quote).toBe("Struck");
    expect(by("squiggly")[0]!.quote).toBe("Squiggly");
    expect(doc.comments!["t:main:11"]!.anchor!.quote).toBe("highlighted");
    expect((read(fixture("annots-crop")).pages[0]!.annots[0] as AnnotOf<"highlight">).quote).toBe("Cropped");
  });

  it("reads strokes, shapes, lines and polygons", () => {
    expect(by("ink")[0]).toMatchObject({ strokes: [[[20, 200], [40, 220], [60, 200], [80, 220]], [[20, 240], [80, 240]]], stroke: { color: "#ff0000", width: 3 } });
    expect(by("square")[0]).toMatchObject({ rect: { x: 99, y: 189, w: 62, h: 42 }, stroke: { color: "#0000ff", width: 2 }, fill: "#cce6ff", opacity: 0.8 });
    expect(by("circle")[0]).toMatchObject({ stroke: { color: "#008000", width: 2, dash: [3, 2] }, fill: "#ffff99" });
    expect(by("line")[0]).toMatchObject({ from: [20, 270], to: [120, 300], startEnd: "open-arrow", endEnd: "circle", stroke: { color: "#800080", width: 2 } });
    expect(by("polygon")[0]!.points).toHaveLength(5);
    expect(by("polygon")[0]).toMatchObject({ fill: "#ffcccc", stroke: { width: 1.5 } });
    expect(by("polyline")[0]!.points).toEqual([[240, 260], [270, 280], [240, 300], [270, 320]]);
  });

  it("reads free text with its style, a note, a stamp and links", () => {
    expect(by("freetext")[0]).toMatchObject({ text: "Free text box\nsecond line", style: { family: "Helvetica", size: 11, color: "#0000cc" }, fill: "#ffffcc", rect: { x: 20, y: 330, w: 130, h: 50 } });
    expect(by("note")[0]).toMatchObject({ x: 250, y: 20, icon: "note", contents: "A sticky note", authorName: "Reviewer B" });
    expect(by("stamp")[0]).toMatchObject({ stamp: { name: "Approved" } });
    const [web, page] = by("link");
    expect(web).toMatchObject({ uri: "https://example.com/a", rect: { x: 20, y: 36, w: 100, h: 20 } });
    expect(page).toMatchObject({ dest: { page: "p:main:1", y: 100 } });
  });

  it("makes comment threads of notes and markup with text", () => {
    expect(Object.keys(doc.comments ?? {}).length).toBe(5);
    const t = doc.comments!["t:main:33"]!;
    expect(t.comments).toEqual([{ id: "c:main:33", author: "Reviewer B", body: "A sticky note", createdAt: 0 }]);
    expect(t.anchor).toMatchObject({ page: "p:main:0", annot: "a:main:33", x: 250, y: 20 });
  });
});

describe("readAnnotations on odd files", () => {
  it("skips what it cannot understand and what Pli does not edit", () => {
    const list = annots(fixture("annots-reply"));
    expect(list.map((a) => a.type)).toEqual(["note", "highlight", "link"]);
  });

  it("collapses replies into the note and reads the review state", () => {
    const [note] = annots(fixture("annots-reply")) as AnnotOf<"note">[];
    expect(note).toMatchObject({ icon: "comment", open: true, color: "#ffcc00", resolved: true, contents: "First comment", authorName: "Ana Example" });
    expect(note.replies!.map((r) => [r.authorName, r.body])).toEqual([["Ben Example", "Reply one"], ["Ana Example", "Reply two"]]);
    expect(note.created).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(note.modified).toBe(Date.UTC(2026, 0, 2, 2, 4, 5)); // +01:00
  });

  it("uses the crop box and keeps the page's rotation out of the coordinates", () => {
    const d = read(fixture("annots-crop"));
    expect(d.pages[0]).toMatchObject({ width: 200, height: 300, rotate: 90 });
    const h = d.pages[0]!.annots[0] as AnnotOf<"highlight">;
    expect(h.rects[0]!.x).toBeCloseTo(20, 0);
  });

  it("reads an /Annots array that is an indirect object, and ignores entries that are not dictionaries", () => {
    const objs = simpleDoc(1, { pageExtra: () => "/Annots 20 0 R" });
    objs.push(obj(20, "[21 0 R 22 0 R 99 0 R null 5 (x) << /Subtype /Square /Rect [0 0 10 10] >>]"));
    objs.push(obj(21, "<< /Type /Annot /Subtype /Square /Rect [10 10 50 50] /C [1 0 0] >>"));
    objs.push(obj(22, "<< /Type /Annot /Subtype /Square /Rect [10 10 [50] 50] >>"));
    const list = annots(buildClassic(objs).bytes);
    expect(list.map((a) => a.type)).toEqual(["square"]);
    expect(list[0]).toMatchObject({ rect: { x: 10, y: 792 - 50 - 0.5 + 0.5, w: 40, h: 40 } });
  });

  it("never throws on damaged annotations", () => {
    const bad = [
      "/Subtype /Highlight /Rect [0 0 10 10] /QuadPoints [1 2 3]",
      "/Subtype /Highlight /Rect (x)",
      "/Subtype /Ink /Rect [0 0 10 10] /InkList [[1 2 3] 7 [(a) (b)]]",
      "/Subtype /Line /Rect [0 0 10 10] /L [1 2]",
      "/Subtype /Polygon /Rect [0 0 10 10] /Vertices [1]",
      "/Subtype /FreeText /Rect [0 0 10 10] /DA 12 /Q (x) /RD [1 2]",
      "/Subtype /Text /Rect [0 0 10 10] /Name 5 /Open /x /C [1 2 3 4 5 6]",
      "/Subtype /Stamp /Rect [0 0 10 10] /AP << /N 99 0 R >>",
      "/Subtype /Stamp /Rect [0 0 10 10] /AP 5",
      "/Subtype /Link /Rect [0 0 10 10] /A << /S /GoTo /D [99 0 R /XYZ 1 2 3] >>",
      "/Subtype /Link /Rect [0 0 10 10] /Dest (nowhere)",
      "/Subtype /Link /Rect [0 0 10 10] /A 5",
      "/Subtype /Square /Rect [0 0 10 10] /BS 5 /RD (x) /IC [] /CA (x) /F (x) /M (garbage) /T 5",
      "/Subtype /Text /Rect [0 0 10 10] /IRT 30 0 R",
      "/Subtype 5 /Rect [0 0 10 10]",
      "/Rect [0 0 10 10]",
    ];
    const objs = simpleDoc(1, { pageExtra: () => `/Annots [${bad.map((_, i) => `${30 + i} 0 R`).join(" ")}]` });
    // 30 is both the first annotation and the target of an IRT cycle.
    bad.forEach((b, i) => objs.push(obj(30 + i, `<< /Type /Annot ${b} >>`)));
    const doc = openPdf(buildClassic(objs).bytes);
    return doc.then((s) => {
      expect(s.doc.pages[0]!.annots.length).toBeGreaterThanOrEqual(0);
      // Whatever was read can be saved again.
      return s.save();
    });
  });

  it("follows named destinations in the catalog's /Dests and /Names trees", () => {
    const objs = simpleDoc(2, { pageExtra: (i) => (i === 0 ? "/Annots [30 0 R 31 0 R 32 0 R]" : "") });
    // catalog is object 1: rebuild it with named destinations
    objs[0] = obj(1, "<< /Type /Catalog /Pages 2 0 R /Dests << /Direct [4 0 R /XYZ 0 700 0] >> /Names << /Dests << /Kids [ << /Limits [(a) (m)] /Names [(chapter) [4 0 R /FitH 500] (z) << /D [4 0 R /Fit] >>] >> ] >> >> >>");
    objs.push(obj(30, "<< /Subtype /Link /Rect [0 0 10 10] /Dest /Direct >>"));
    objs.push(obj(31, "<< /Subtype /Link /Rect [0 20 10 30] /A << /S /GoTo /D (chapter) >> >>"));
    objs.push(obj(32, "<< /Subtype /Link /Rect [0 40 10 50] /Dest (z) >>"));
    const list = annots(buildClassic(objs).bytes) as AnnotOf<"link">[];
    expect(list.map((a) => a.dest)).toEqual([{ page: "p:main:1", y: 92 }, { page: "p:main:1", y: 292 }, { page: "p:main:1" }]);
  });
});

describe("pictures in stamps", () => {
  const withImage = (image: string | Uint8Array, imageDict: string, rest = "") => {
    const objs = simpleDoc(1, { pageExtra: () => "/Annots [30 0 R]" });
    objs.push(obj(30, `<< /Type /Annot /Subtype /Stamp /Rect [10 10 90 50] /Name /Custom /AP << /N 31 0 R >> ${rest} >>`));
    objs.push(streamObj(31, "/Type /XObject /Subtype /Form /BBox [0 0 80 40] /Resources << /XObject << /Im0 32 0 R >> >>", "q 80 0 0 40 0 0 cm /Im0 Do Q"));
    objs.push(streamObj(32, `/Type /XObject /Subtype /Image ${imageDict}`, image));
    return buildClassic(objs).bytes;
  };

  it("passes a JPEG through as it is", () => {
    const c = createCanvas(8, 8);
    const g = c.getContext("2d");
    g.fillStyle = "#336699";
    g.fillRect(0, 0, 8, 8);
    const jpg = new Uint8Array(c.toBuffer("image/jpeg"));
    const [a] = annots(withImage(jpg, `/Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`));
    expect(a!.type).toBe("stamp");
    const pic = (a as AnnotOf<"stamp">).stamp as { picture: { src: string; width: number } };
    const data = parseDataUri(pic.picture.src)!;
    expect(data.mime).toBe("image/jpeg");
    expect(data.bytes).toEqual(jpg);
    expect(pic.picture.width).toBe(8);
  });

  it("makes a PNG of a Flate RGB image with its soft mask", () => {
    const px = new Uint8Array(2 * 2 * 3);
    px.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    const objs = simpleDoc(1, { pageExtra: () => "/Annots [30 0 R]" });
    objs.push(obj(30, `<< /Type /Annot /Subtype /Stamp /Rect [10 10 90 50] /Name /ImageAnnot /AP << /N 31 0 R >> >>`));
    objs.push(streamObj(31, "/Type /XObject /Subtype /Form /BBox [0 0 80 40] /Resources << /XObject << /Im0 32 0 R >> >>", "q 80 0 0 40 0 0 cm /Im0 Do Q"));
    objs.push(streamObj(32, "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 33 0 R", px, true));
    objs.push(streamObj(33, "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(255, 128, 0, 255), true));
    const [a] = annots(buildClassic(objs).bytes);
    expect(a!.type).toBe("image"); // /Name /ImageAnnot is how Pli writes a picture on the page
    const pic = (a as AnnotOf<"image">).picture;
    const raster = decodePng(parseDataUri(pic.src)!.bytes);
    expect([...raster.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255]);
  });

  it("keeps a stamp with its name when the appearance is not a plain picture", () => {
    const [a] = annots(withImage("x", `/Width 1 /Height 1 /ColorSpace /DeviceCMYK /BitsPerComponent 8`));
    expect(a).toMatchObject({ type: "stamp", stamp: { name: "Custom" } });
    const flate = zlibSync(Uint8Array.of(1, 2, 3));
    void flate;
  });
});
