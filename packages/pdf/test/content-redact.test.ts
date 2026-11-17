import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { PdfFile } from "../src/cos/file";
import { extractText, searchText } from "../src/text";
import { makePdf } from "./support/content";
import { contains } from "./support/leak";
import { compareWords, mupdfWords, python } from "./support/mupdf";
import { pageWords } from "../src/content/text";
import { renderPdf } from "./support/render";

const LINES = "BT /F1 12 Tf 20 170 Td (Account number: SECRET-4711 for the customer) Tj 0 -20 Td [(Name: ) -50 (Jane) 30 ( Doe)] TJ /F2 14 Tf 0 -20 Td (Public notes stay visible) Tj ET";

async function redactWords(bytes: Uint8Array, query: string, options: Record<string, unknown> = {}) {
  const s = await openPdf(bytes);
  const ids = await s.content.markSearch(query, options);
  expect(ids.length).toBeGreaterThan(0);
  const result = s.content.applyRedactions();
  const saved = await s.saveDetailed();
  return { s, result, saved };
}

describe("marking every match of a search", () => {
  it("is one undo step, whatever the number of matches, and the marks sit on the pages of the matches", async () => {
    const s = await openPdf(makePdf({ content: "BT /F1 12 Tf 20 170 Td (cat dog cat) Tj 0 -20 Td (one more cat) Tj ET", more: ["BT /F1 12 Tf 20 100 Td (a cat here) Tj ET"] }));
    const before = s.doc;
    const ids = await s.content.markSearch("cat");
    expect(ids).toHaveLength(4);
    const marks = s.doc.pages.map((p) => p.annots.filter((a) => a.type === "redact").length);
    expect(marks).toEqual([3, 1]);
    expect(s.doc.pages[0]!.annots.map((a) => a.id)).toEqual(ids.slice(0, 3));
    s.undo();
    expect(s.doc).toEqual(before);
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(s.doc.pages.flatMap((p) => p.annots)).toHaveLength(4);
    expect(await s.content.markSearch("zebra")).toEqual([]);
  });
});

describe("redaction", () => {
  it("removes the words from the file, keeps the rest where it was, and paints a black box", async () => {
    const bytes = makePdf({ content: LINES });
    const before = extractText(PdfFile.open(bytes), 0);
    const { saved, result } = await redactWords(bytes, "SECRET-4711");
    expect(saved.mode).toBe("rewrite");
    expect(result.rects).toBe(1);
    const out = saved.bytes;
    expect(contains(out, "SECRET")).toBe(false);
    expect(contains(out, "4711")).toBe(false);
    expect(contains(out, "Public notes")).toBe(true);
    const after = extractText(PdfFile.open(out), 0);
    expect(after.text).not.toContain("SECRET");
    expect(after.text).toContain("Account number:");
    expect(after.text).toContain("for the customer");
    // what was left did not move: compare the boxes of the words that are still there
    const was = new Map(pageWords(before).map((w) => [w.text, w.box]));
    for (const w of pageWords(after)) {
      const b = was.get(w.text);
      expect(b, w.text).toBeDefined();
      expect(Math.abs(w.box.x - b!.x), w.text).toBeLessThan(0.05);
      expect(Math.abs(w.box.y - b!.y), w.text).toBeLessThan(0.05);
    }
    // pdf.js: text gone, rest there, box is black
    const r = await renderPdf(out, 0, 2);
    expect(r.text).not.toContain("SECRET");
    expect(r.text).toContain("Public notes");
    const hit = before.runs[0]!.glyphs.find((g) => g.char === "S")!.box;
    expect(r.pixel(hit.x + 20, hit.y + hit.h / 2).slice(0, 3)).toEqual([0, 0, 0]);
    // MuPDF
    if (python) {
      const mu = mupdfWords(out).pages[0]!;
      expect(mu.text).not.toContain("SECRET");
      expect(compareWords(pageWords(after), mu.words)).toEqual([]);
    }
  });

  it("cuts glyphs out of kerned TJ arrays and a Tj in the middle of a word", async () => {
    const bytes = makePdf({ content: LINES });
    const { saved } = await redactWords(bytes, "Jane");
    const out = saved.bytes;
    expect(contains(out, "Jane")).toBe(false);
    expect(extractText(PdfFile.open(out), 0).text).toContain("Doe");
    const before = extractText(PdfFile.open(bytes), 0);
    const after = extractText(PdfFile.open(out), 0);
    const doeBefore = pageWords(before).find((w) => w.text === "Doe")!;
    const doeAfter = pageWords(after).find((w) => w.text === "Doe")!;
    expect(doeAfter.box.x).toBeCloseTo(doeBefore.box.x, 1);
  });

  it("is one undo step, and undo puts the marks back", async () => {
    const bytes = makePdf({ content: LINES });
    const s = await openPdf(bytes);
    await s.content.markSearch("Public");
    const before = s.doc;
    s.content.applyRedactions();
    expect(s.doc.pages[0]!.annots.filter((a) => a.type === "redact")).toHaveLength(0);
    expect(s.doc.pages[0]!.edits).toHaveLength(1);
    s.undo();
    expect(s.doc).toEqual(before);
    expect(s.doc.pages[0]!.annots.filter((a) => a.type === "redact")).toHaveLength(1);
  });

  it("redacts by rectangle, with an overlay text, and leaves other pages alone", async () => {
    const bytes = makePdf({ content: LINES, more: ["BT /F1 12 Tf 20 100 Td (SECRET on the second page) Tj ET"] });
    const s = await openPdf(bytes);
    const hit = searchText(PdfFile.open(bytes), "SECRET-4711")[0]!;
    s.content.markRedaction(s.doc.pages[0]!.id, hit.rects, { fill: "#ffff00", overlay: "REDACTED" });
    s.content.applyRedactions([s.doc.pages[0]!.id]);
    const out = await s.save();
    const file = PdfFile.open(out);
    expect(extractText(file, 0).text).not.toContain("SECRET");
    expect(extractText(file, 0).text).toContain("REDACTED");
    expect(extractText(file, 1).text).toContain("SECRET on the second page");
    const r = await renderPdf(out, 0, 2);
    const g = hit.rects[0]!;
    expect(r.pixel(g.x + 1, g.y + 1).slice(0, 3)).toEqual([255, 255, 0]);
  });
});

// ---- pictures ---------------------------------------------------------------------------------------------------------

import { createCanvas } from "@napi-rs/canvas";
import { decodeStream } from "../src/cos/filters";
import { PdfDict, PdfStream, PdfName } from "../src/cos/objects";
import { obj, streamObj } from "./support/handmade";
import { everything } from "./support/leak";

/** 10 x 10 RGB, every pixel different: (x * 20 + 1, y * 20 + 1, 77). */
function rgbImage(blue = 77): Uint8Array {
  const d = new Uint8Array(300);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) d.set([x * 20 + 1, y * 20 + 1, blue], (y * 10 + x) * 3);
  return d;
}
const triple = (x: number, y: number, blue = 77): string => String.fromCharCode(x * 20 + 1, y * 20 + 1, blue);

/** The images the first page draws, decoded: width, height, samples. */
function pageImages(bytes: Uint8Array): { name: string; width: number; height: number; data: Uint8Array; filter: string }[] {
  const f = PdfFile.open(bytes);
  const page = f.pages()[0]!;
  const res = f.get(page.dict.get("Resources")) as PdfDict;
  const xo = f.get(res.get("XObject")) as PdfDict | null;
  const out = [];
  for (const [name, ref] of xo?.map ?? []) {
    const s = f.get(ref);
    if (!(s instanceof PdfStream) || !(f.get(s.dict.get("Subtype")) instanceof PdfName) || (f.get(s.dict.get("Subtype")) as PdfName).value !== "Image") continue;
    const filter = String(f.get(s.dict.get("Filter")) ?? "");
    out.push({ name, width: f.get(s.dict.get("Width")) as number, height: f.get(s.dict.get("Height")) as number, data: decodeStream(s, (o) => f.get(o)), filter });
  }
  return out;
}

describe("redacting pictures", () => {
  const draw = "q 100 0 0 100 50 50 cm /Im1 Do Q BT /F1 12 Tf 20 20 Td (caption) Tj ET";
  const image = (flate: boolean) => streamObj(20, "/Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8", rgbImage(), flate);

  for (const flate of [false, true]) {
    it(`blanks the covered pixels of a ${flate ? "Flate" : "raw"} RGB picture and keeps the others`, async () => {
      const bytes = makePdf({ content: draw, resources: "/XObject << /Im1 20 0 R >>", objs: [image(flate)] });
      const s = await openPdf(bytes);
      s.content.markRedaction(s.doc.pages[0]!.id, [{ x: 70, y: 80, w: 30, h: 30 }]);
      s.content.applyRedactions();
      const out = await s.save();
      const imgs = pageImages(out);
      expect(imgs).toHaveLength(1);
      const { data } = imgs[0]!;
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 10; x++) {
          const px = Array.from(data.subarray((y * 10 + x) * 3, (y * 10 + x) * 3 + 3));
          const covered = x >= 2 && x <= 4 && y >= 3 && y <= 5;
          expect(px, `${x},${y}`).toEqual(covered ? [0, 0, 0] : [x * 20 + 1, y * 20 + 1, 77]);
        }
      // the covered pixel values are nowhere in the file, the others still are
      const all = everything(out).join("\u0000");
      expect(all.includes(triple(3, 4))).toBe(false);
      expect(all.includes(triple(7, 8))).toBe(true);
      expect(out.length).toBeGreaterThan(0);
      const r = await renderPdf(out, 0, 2);
      expect(r.pixel(85, 95).slice(0, 3)).toEqual([0, 0, 0]);
      expect(r.pixel(55, 55)[0]).toBeGreaterThan(0);
      expect(r.text).toContain("caption");
    });
  }

  it("removes a picture that is fully covered, and its object", async () => {
    const bytes = makePdf({ content: draw, resources: "/XObject << /Im1 20 0 R >>", objs: [image(true)] });
    const s = await openPdf(bytes);
    s.content.markRedaction(s.doc.pages[0]!.id, [{ x: 40, y: 40, w: 120, h: 120 }]);
    s.content.applyRedactions();
    const out = await s.save();
    expect(pageImages(out)).toHaveLength(0);
    expect(everything(out).join("").includes(triple(3, 4))).toBe(false);
  });

  it("handles inline images, turned pictures and pictures drawn twice", async () => {
    const raw = Array.from(rgbImage(88), (b) => String.fromCharCode(b)).join("");
    const content = `q 100 0 0 100 50 50 cm BI /W 10 /H 10 /BPC 8 /CS /RGB ID ${raw}\nEI Q q 0.7 0.7 -0.7 0.7 220 20 cm 60 0 0 60 0 0 cm /Im1 Do Q q 40 0 0 40 10 150 cm /Im1 Do Q`;
    const bytes = makePdf({ content, resources: "/XObject << /Im1 20 0 R >>", objs: [image(false)] });
    const s = await openPdf(bytes);
    const imgs = await s.content.images(s.doc.pages[0]!.id);
    expect(imgs.map((i) => i.id)).toEqual(["i:inline1", "i:Im1", "i:Im1#2"]);
    s.content.markRedaction(s.doc.pages[0]!.id, [{ x: 70, y: 80, w: 30, h: 30 }]);
    s.content.applyRedactions();
    const out = await s.save();
    const all = everything(out).join("\u0000");
    expect(all.includes(triple(3, 4, 88))).toBe(false);
    expect(all.includes(triple(7, 8, 88))).toBe(true);
    // the turned picture and the one drawn twice are outside the rectangle: untouched, still there
    expect(pageImages(out).some((i) => i.filter === "")).toBe(true);
    const r = await renderPdf(out, 0, 2);
    expect(r.pixel(85, 95).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("removes a JPEG that is partly covered (no decoder here) and says so", async () => {
    const c = createCanvas(16, 16);
    const g = c.getContext("2d");
    g.fillStyle = "#336699";
    g.fillRect(0, 0, 16, 16);
    const jpeg = new Uint8Array(c.toBuffer("image/jpeg"));
    const img = obj(20, new Uint8Array([...new TextEncoder().encode(`<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), ...jpeg, ...new TextEncoder().encode("\nendstream")]));
    const bytes = makePdf({ content: draw, resources: "/XObject << /Im1 20 0 R >>", objs: [img] });
    const s = await openPdf(bytes);
    s.content.markRedaction(s.doc.pages[0]!.id, [{ x: 70, y: 80, w: 30, h: 30 }]);
    s.content.applyRedactions();
    const saved = await s.saveDetailed();
    expect(pageImages(saved.bytes)).toHaveLength(0);
    expect(saved.warnings.join(" ")).toMatch(/could not be cut.*DCTDecode/);
    expect(everything(saved.bytes).join("\u0000").includes(String.fromCharCode(0xff, 0xd8))).toBe(false);
  });
});

// ---- forms, annotations, rotation --------------------------------------------------------------------------------------

describe("redacting forms, annotations and rotated pages", () => {
  it("rewrites a form XObject on a private copy: other pages keep theirs", async () => {
    const inner = streamObj(21, "/Type /XObject /Subtype /Form /BBox [0 0 200 40] /Resources << /Font << /F1 40 0 R >> >>", "BT /F1 12 Tf 0 10 Td (DEEPSECRET in nested) Tj ET");
    const form = streamObj(20, "/Type /XObject /Subtype /Form /BBox [0 0 200 60] /Matrix [1 0 0 1 20 100] /Resources << /Font << /F1 40 0 R >> /XObject << /Inner 21 0 R >> >>", "BT /F1 12 Tf 0 40 Td (FORMSECRET and more) Tj ET q 1 0 0 1 0 0 cm /Inner Do Q");
    const bytes = makePdf({ content: "/Fm1 Do BT /F1 12 Tf 20 20 Td (page one text) Tj ET", more: ["/Fm1 Do BT /F1 12 Tf 20 20 Td (page two text) Tj ET"], resources: "/XObject << /Fm1 20 0 R >>", objs: [form, inner] });
    const s = await openPdf(bytes);
    // only on page one
    for (const word of ["FORMSECRET", "DEEPSECRET"]) for (const h of searchText(PdfFile.open(bytes), word, { pages: [0] })) s.content.markRedaction(s.doc.pages[0]!.id, h.rects);
    s.content.applyRedactions();
    const out = await s.save();
    const f = PdfFile.open(out);
    expect(extractText(f, 0).text).not.toContain("SECRET");
    expect(extractText(f, 0).text).toContain("and more");
    expect(extractText(f, 0).text).toContain("in nested");
    expect(extractText(f, 1).text).toContain("FORMSECRET and more");
    expect(extractText(f, 1).text).toContain("DEEPSECRET in nested");
    const r = await renderPdf(out, 0, 2);
    expect(r.text).not.toContain("SECRET");
    // exactly one copy of each word is left in the file: page two's
    const joined = everything(out).slice(1).join("\u0000");
    expect(joined.split("FORMSECRET").length - 1).toBe(1);
    expect(joined.split("DEEPSECRET").length - 1).toBe(1);
  });

  it("takes out annotations and form fields under a redaction, and leaves the others", async () => {
    const annots = [
      obj(20, "<< /Type /Annot /Subtype /Link /Rect [20 150 200 170] /Border [0 0 0] /A << /S /URI /URI (http://example.test/secret) >> >>"),
      obj(21, "<< /Type /Annot /Subtype /Text /Rect [30 152 50 168] /Contents (a SECRETNOTE) /Popup 22 0 R >>"),
      obj(22, "<< /Type /Annot /Subtype /Popup /Rect [60 100 120 150] /Parent 21 0 R >>"),
      obj(23, "<< /Type /Annot /Subtype /Link /Rect [20 20 80 40] /Border [0 0 0] /A << /S /URI /URI (http://example.test/keep) >> >>"),
      obj(24, "<< /Type /Annot /Subtype /Widget /FT /Tx /T (ssn) /V (SECRETFIELD) /Rect [150 150 250 170] /F 4 >>"),
      obj(25, "<< /Type /Annot /Subtype /Widget /FT /Tx /T (other) /V (kept value) /Rect [150 20 250 40] /F 4 >>"),
    ];
    const bytes = makePdf({ content: "BT /F1 12 Tf 20 154 Td (SECRETWORD here) Tj ET", pageExtra: "/Annots [20 0 R 21 0 R 22 0 R 23 0 R 24 0 R 25 0 R]", catalog: "/AcroForm << /Fields [24 0 R 25 0 R] >>", objs: annots });
    const s = await openPdf(bytes);
    await s.content.markSearch("SECRETWORD");
    s.content.markRedaction(s.doc.pages[0]!.id, [{ x: 140, y: 25, w: 120, h: 30 }]);
    s.content.applyRedactions();
    expect(s.doc.fields.map((f) => f.name)).toEqual(["other"]);
    const out = await s.save();
    const joined = everything(out).join("\u0000");
    for (const gone of ["SECRETNOTE", "SECRETFIELD", "SECRETWORD", "example.test/secret"]) expect(joined.includes(gone), gone).toBe(false);
    for (const kept of ["example.test/keep", "kept value"]) expect(joined.includes(kept), kept).toBe(true);
    const f = PdfFile.open(out);
    const page = f.pages()[0]!;
    expect((f.get(page.dict.get("Annots")) as unknown[]).length).toBe(2); // the kept link and the kept field
    const fields = f.get((f.catalog().get("AcroForm") as PdfDict).get("Fields")) as unknown[];
    expect(fields).toHaveLength(1);
  });

  it("redacts on a page that is rotated with a crop box: the black box sits on the words", async () => {
    const bytes = makePdf({ content: "BT /F1 12 Tf 60 120 Td (alpha SECRETBOX omega) Tj ET", mediaBox: "[0 0 300 200]", cropBox: "[50 40 250 160]", rotate: 90 });
    const s = await openPdf(bytes);
    const hit = searchText(PdfFile.open(bytes), "SECRETBOX")[0]!.rects[0]!;
    await s.content.markSearch("SECRETBOX");
    s.content.applyRedactions();
    const out = await s.save();
    expect(contains(out, "SECRETBOX")).toBe(false);
    const after = extractText(PdfFile.open(out), 0);
    expect(after.text).toContain("alpha");
    expect(after.text).toContain("omega");
    // pdf.js draws the page rotated by 90 degrees clockwise: a point (x, y) of page space is drawn at (height - y, x)
    const r = await renderPdf(out, 0, 2);
    const px = 120 - (hit.y + hit.h / 2);
    const py = hit.x + hit.w / 2;
    expect(r.pixel(px, py).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("takes marked-content text and structure text out too", async () => {
    const bytes = makePdf({ content: "/P << /MCID 0 /ActualText (SECRETALT) >> BDC BT /F1 12 Tf 20 100 Td (SECRETLINE) Tj ET EMC /Span <</Alt (SECRETALT2)>> BDC BT /F1 12 Tf 20 60 Td (kept line) Tj ET EMC", catalog: "/StructTreeRoot 30 0 R", objs: [obj(30, "<< /Type /StructTreeRoot /K 31 0 R >>"), obj(31, "<< /Type /StructElem /S /P /P 30 0 R /Pg 3 0 R /K 0 /ActualText (SECRETSTRUCT) >>")] });
    const s = await openPdf(bytes);
    await s.content.markSearch("SECRETLINE");
    s.content.applyRedactions();
    const out = await s.save();
    for (const gone of ["SECRETLINE", "SECRETALT", "SECRETSTRUCT"]) expect(contains(out, gone), gone).toBe(false);
    expect(extractText(PdfFile.open(out), 0).text).toContain("kept line");
  });
});

// ---- the rest of the line does not move, whatever the text state ----------------------------------------------------------

describe("redaction keeps the rest of the text where it was", () => {
  const cases: Record<string, string> = {
    "horizontal scaling": "BT /F1 12 Tf 50 Tz 20 150 Td (one KILLWORD two three) Tj ET",
    "character and word spacing": "BT /F1 12 Tf 1.5 Tc 6 Tw 20 150 Td (one KILLWORD two three) Tj ET",
    "text rise and quotes": "BT /F1 12 Tf 14 TL 20 150 Td 3 Ts (one KILLWORD) Tj (two KILLWORD three) ' 2 1 (four KILLWORD five) \" ET",
    "turned text": "BT /F1 12 Tf 0 1 -1 0 150 40 Tm (one KILLWORD two three) Tj ET",
    "scaled coordinates": "q 0.5 0 0 0.5 10 10 cm BT /F1 24 Tf 20 250 Td (one KILLWORD two three) Tj ET Q",
    "kerning numbers": "BT /F1 12 Tf 20 150 Td [(one) -400 (KILL) 40 (WORD) -400 (two) 15 ( three)] TJ ET",
    "several strings and fonts": "BT /F1 12 Tf 20 150 Td (one ) Tj /F2 12 Tf (KILLWORD) Tj /F1 12 Tf ( two three) Tj ET",
  };
  for (const [name, content] of Object.entries(cases)) {
    it(name, async () => {
      const bytes = makePdf({ content });
      const before = pageWords(extractText(PdfFile.open(bytes), 0));
      const s = await openPdf(bytes);
      const marks = await s.content.markSearch("KILLWORD");
      expect(marks.length).toBeGreaterThan(0);
      s.content.applyRedactions();
      const out = await s.save();
      expect(contains(out, "KILLWORD")).toBe(false);
      expect(contains(out, "KILL")).toBe(false);
      const after = pageWords(extractText(PdfFile.open(out), 0));
      const wasWords = before.filter((w) => w.text !== "KILLWORD");
      expect(after.map((w) => w.text)).toEqual(wasWords.map((w) => w.text));
      after.forEach((w, i) => {
        expect(Math.abs(w.box.x - wasWords[i]!.box.x), w.text).toBeLessThan(0.05);
        expect(Math.abs(w.box.y - wasWords[i]!.box.y), w.text).toBeLessThan(0.05);
      });
    });
  }
});

describe("redacting drawings and saving as optimised files", () => {
  it("drops only the lines of a path that touch the box, keeps clips, and clips plain rectangles around it", async () => {
    // one path of three separate lines (a table grid), a filled rectangle behind the text, a clip, and text
    const content = "q 0 0 1 rg 10 150 280 30 re f Q 2 w 20 100 m 280 100 l 20 120 m 280 120 l 20 140 m 280 140 l S q 10 10 100 40 re W n 1 0 0 rg 0 0 300 200 re f Q BT /F1 12 Tf 100 112 Td (TARGET) Tj ET";
    const s = await openPdf(makePdf({ content }));
    await s.content.markSearch("TARGET");
    s.content.applyRedactions();
    const saved = await s.saveDetailed();
    expect(saved.warnings.join(" ")).toMatch(/1 drawn shape/);
    const f = PdfFile.open(saved.bytes);
    const stream = f.get(f.pages()[0]!.dict.get("Contents")) as PdfStream;
    const text = Array.from(f.decode(stream), (b) => String.fromCharCode(b)).join("");
    // the line at y 120 (page y 80) touches the word; the other two stay
    expect(text).toContain("20 100 m");
    expect(text).toContain("20 140 m");
    expect(text).not.toContain("20 120 m");
    expect(text).toMatch(/10 10 100 40 re\nW\nn/);
    const r = await renderPdf(saved.bytes, 0, 2);
    expect(r.pixel(60, 35).slice(0, 3)).toEqual([0, 0, 255]); // the blue rectangle at the top is still there
    expect(r.pixel(20, 175)[0]).toBe(255); // and the red one is cut only around the box
  });

  it("finds no trace of the words in an optimised file with object streams and compressed streams", async () => {
    const s = await openPdf(makePdf({ content: LINES, flate: true }));
    await s.content.markSearch("SECRET-4711");
    s.content.applyRedactions();
    const out = await s.save({ mode: "optimise" });
    expect(contains(out, "SECRET")).toBe(false);
    expect(contains(out, "Public notes")).toBe(true);
    expect(extractText(PdfFile.open(out), 0).text).toContain("Public notes");
  });
});
