// Every annotation type saved as a real PDF annotation, drawn by pdf.js from the appearance stream we wrote.
import { describe, expect, it } from "vitest";
import { PdfFile, openPdf } from "../src";
import type { Annotation, PdfSession } from "../src";
import { WHITE, expectPixel, hex, newSession, solidPng } from "./support/annots";
import { renderPdf, type Rendered } from "./support/render";

const PAGE = "p:main:0";

async function saveAndRender(s: PdfSession): Promise<{ bytes: Uint8Array; r: Rendered; warnings: string[] }> {
  const result = await s.saveDetailed();
  const r = await renderPdf(result.bytes, 0, 2);
  return { bytes: result.bytes, r, warnings: result.warnings };
}

describe("annotations are written as real annotations with appearances", () => {
  it("highlights multiply over what is below", async () => {
    const s = await newSession();
    s.annots.addHighlight(PAGE, [{ x: 20, y: 30, w: 100, h: 20 }], { color: "#ffeb3b" });
    const { r, bytes } = await saveAndRender(s);
    expectPixel(r, 100, 40, hex("#ffeb3b"), 30);
    expectPixel(r, 100, 100, WHITE, 5);
    // The text under the highlight is still there (multiply keeps black black).
    expect(r.text).toContain("Hello annotated world");
    const file = PdfFile.open(bytes);
    const annots = file.dictGet(file.pages()[0]!.dict, "Annots") as unknown[];
    expect(annots).toHaveLength(1);
  });

  it("draws underline, strikeout and squiggly lines", async () => {
    const s = await newSession();
    s.annots.addHighlight(PAGE, [{ x: 20, y: 100, w: 100, h: 20 }], { type: "underline", color: "#0000ff" });
    s.annots.addHighlight(PAGE, [{ x: 20, y: 150, w: 100, h: 20 }], { type: "strikeout", color: "#ff0000" });
    s.annots.addHighlight(PAGE, [{ x: 20, y: 200, w: 100, h: 20 }], { type: "squiggly", color: "#00aa00" });
    const { r } = await saveAndRender(s);
    expectPixel(r, 60, 119, [0, 0, 255], 90);
    expect(r.inkIn(20, 112, 100, 8)).toBeGreaterThan(100);
    expect(r.inkIn(20, 158, 100, 6)).toBeGreaterThan(100);
    expectPixel(r, 60, 161, [255, 0, 0], 90);
    expect(r.inkIn(20, 214, 100, 10)).toBeGreaterThan(50);
    expect(r.inkIn(20, 200, 100, 8)).toBe(0);
  });

  it("draws ink with round, smooth strokes", async () => {
    const s = await newSession();
    s.annots.addInk(PAGE, [[[20, 100], [60, 140], [100, 100], [140, 140]], [[20, 200], [120, 200]], [[200, 300]]], { color: "#d50000", width: 6 });
    const { r } = await saveAndRender(s);
    expectPixel(r, 70, 200, [213, 0, 0], 40);
    expectPixel(r, 20, 100, [213, 0, 0], 60);
    expect(r.inkIn(195, 295, 12, 12)).toBeGreaterThan(20); // a single point is a dot
    expectPixel(r, 150, 250, WHITE, 5);
  });

  it("draws squares and circles with fill, border, dashes and opacity", async () => {
    const s = await newSession();
    s.annots.addShape(PAGE, "square", { x: 20, y: 100, w: 80, h: 60 }, { color: "#000000", width: 4, fill: "#ffcc00" });
    s.annots.addShape(PAGE, "circle", { x: 120, y: 100, w: 80, h: 60 }, { color: "#0000ff", width: 4, fill: "#00ff00", dash: [6, 3] });
    s.annots.addShape(PAGE, "square", { x: 20, y: 200, w: 80, h: 60 }, { color: "#000000", width: 0, fill: "#ff0000", opacity: 0.5 });
    const { r } = await saveAndRender(s);
    expectPixel(r, 60, 130, hex("#ffcc00"), 10);
    expectPixel(r, 22, 130, [0, 0, 0], 60); // the stroke is inside the box, at its edge
    expectPixel(r, 160, 130, hex("#00ff00"), 10);
    expectPixel(r, 124, 102, WHITE, 5); // the corner of a circle's box is empty
    expectPixel(r, 60, 230, [255, 128, 128], 25);
  });

  it("draws lines with arrow heads and other ends", async () => {
    const s = await newSession();
    s.annots.addLine(PAGE, [20, 100], [200, 100], { color: "#6200ea", width: 3, endEnd: "closed-arrow", startEnd: "circle" });
    s.annots.addLine(PAGE, [20, 150], [200, 150], { color: "#6200ea", width: 3, endEnd: "open-arrow", startEnd: "square" });
    s.annots.addLine(PAGE, [20, 200], [200, 200], { color: "#6200ea", width: 3, endEnd: "diamond", startEnd: "slash" });
    const { r } = await saveAndRender(s);
    expectPixel(r, 110, 100, hex("#6200ea"), 60);
    expectPixel(r, 190, 100, hex("#6200ea"), 60); // inside the filled head
    expect(r.inkIn(185, 92, 20, 16)).toBeGreaterThan(150);
    expect(r.inkIn(185, 142, 20, 16)).toBeGreaterThan(40);
    expect(r.inkIn(10, 92, 20, 16)).toBeGreaterThan(30);
  });

  it("draws polygons and polylines", async () => {
    const s = await newSession();
    s.annots.addPoly(PAGE, [[50, 100], [150, 100], [100, 180]], { color: "#000000", width: 2, fill: "#ff8800" });
    s.annots.addPoly(PAGE, [[50, 220], [100, 260], [150, 220]], { closed: false, color: "#0000ff", width: 3, fill: "#ff0000" });
    const { r } = await saveAndRender(s);
    expectPixel(r, 100, 120, hex("#ff8800"), 10);
    expectPixel(r, 60, 175, WHITE, 5);
    // An open polyline is not filled.
    expectPixel(r, 100, 225, WHITE, 5);
    expect(r.inkIn(95, 255, 10, 10)).toBeGreaterThan(20);
  });

  it("lays out free text in its box, wrapped, with fill and border", async () => {
    const s = await newSession();
    s.annots.addFreeText(PAGE, { x: 20, y: 100, w: 120, h: 80 }, "A longer text that has to wrap onto several lines in its box", { size: 12, color: "#d50000", fill: "#e8f5e9", stroke: { color: "#1b5e20", width: 2 } });
    s.annots.addFreeText(PAGE, { x: 20, y: 220, w: 120, h: 40 }, "centred", { size: 14, align: "center", bold: true, family: "Times" });
    const { r, warnings } = await saveAndRender(s);
    expectPixel(r, 130, 175, hex("#e8f5e9"), 10);
    expectPixel(r, 21, 140, hex("#1b5e20"), 60);
    expect(r.inkIn(22, 102, 116, 76)).toBeGreaterThan(300);
    expect(r.inkIn(22, 102, 116, 10)).toBeGreaterThan(40); // text starts at the top
    expect(r.inkIn(60, 232, 60, 16)).toBeGreaterThan(40); // centred
    expect(r.inkIn(22, 232, 20, 16)).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("clips overflowing text to the box", async () => {
    const s = await newSession();
    s.annots.addFreeText(PAGE, { x: 20, y: 100, w: 60, h: 20 }, "one two three four five six seven eight nine ten", { size: 12 });
    const { r } = await saveAndRender(s);
    expect(r.inkIn(20, 124, 100, 40)).toBe(0);
  });

  it("draws sticky notes of every icon", async () => {
    const s = await newSession();
    const icons = ["comment", "note", "help", "insert", "key", "paragraph"] as const;
    icons.forEach((icon, i) => s.annots.addNote(PAGE, 20 + i * 40, 100, "text", { icon, color: "#ffd600" }));
    const { r } = await saveAndRender(s);
    icons.forEach((icon, i) => {
      expect(r.inkIn(20 + i * 40, 100, 24, 24), icon).toBeGreaterThan(80);
    });
    expectPixel(r, 20 + 12, 100 + 15, hex("#ffd600"), 20); // the comment bubble is yellow in the middle (between the lines)
  });

  it("draws standard stamps and stamps with a label of your own", async () => {
    const s = await newSession();
    s.annots.addStamp(PAGE, { x: 20, y: 100, w: 140, h: 40 }, "Approved");
    s.annots.addStamp(PAGE, { x: 20, y: 160, w: 140, h: 40 }, "NotApproved");
    s.annots.addStamp(PAGE, { x: 20, y: 220, w: 140, h: 40 }, { name: "Custom", label: "Received", color: "#0000ff" });
    const { r } = await saveAndRender(s);
    expect(r.inkIn(20, 100, 140, 40)).toBeGreaterThan(300);
    expectPixel(r, 21, 120, hex("#2e7d32"), 80);
    expectPixel(r, 21, 180, hex("#c62828"), 80);
    expectPixel(r, 21, 240, [0, 0, 255], 80);
    expectPixel(r, 8, 120, WHITE, 5);
  });

  it("draws picture stamps, images and image signatures fitted in their box", async () => {
    const s = await newSession();
    s.annots.addStamp(PAGE, { x: 20, y: 100, w: 80, h: 40 }, { picture: { src: solidPng([255, 0, 0]) } });
    s.annots.addImage(PAGE, { x: 120, y: 100, w: 40, h: 80 }, { src: solidPng([0, 0, 255], 8) });
    s.annots.addSignature(PAGE, { x: 20, y: 200, w: 60, h: 60 }, { mode: "image", picture: { src: solidPng([0, 160, 0]) } });
    const { r, warnings } = await saveAndRender(s);
    // a square picture in an 80 x 40 box: 40 x 40 in the middle
    expectPixel(r, 60, 120, [255, 0, 0], 10);
    expectPixel(r, 25, 120, WHITE, 5);
    expectPixel(r, 140, 140, [0, 0, 255], 10);
    expectPixel(r, 140, 105, WHITE, 5);
    expectPixel(r, 50, 230, [0, 160, 0], 10);
    expect(warnings).toEqual([]);
  });

  it("draws drawn and typed signatures", async () => {
    const s = await newSession();
    s.annots.addSignature(PAGE, { x: 20, y: 100, w: 100, h: 40 }, { mode: "draw", strokes: [[[5, 30], [30, 8], [55, 30], [80, 8]]], color: "#001a80", width: 3 });
    s.annots.addSignature(PAGE, { x: 20, y: 200, w: 140, h: 40 }, { mode: "type", text: "Jane Signer", color: "#001a80" });
    const { r } = await saveAndRender(s);
    expectPixel(r, 20 + 30, 100 + 8, [0, 26, 128], 60);
    expect(r.inkIn(20, 100, 100, 40)).toBeGreaterThan(150);
    expect(r.inkIn(20, 200, 140, 40)).toBeGreaterThan(150);
  });

  it("shows redaction marks as a tinted box", async () => {
    const s = await newSession();
    s.annots.markRedaction(PAGE, [{ x: 20, y: 100, w: 100, h: 20 }, { x: 20, y: 140, w: 100, h: 20 }], { fill: "#000000" });
    const { r } = await saveAndRender(s);
    expectPixel(r, 70, 110, [166, 166, 166], 40);
    expectPixel(r, 70, 130, WHITE, 5);
  });

  it("writes links without drawing anything, to a web address and to a page", async () => {
    const s = await newSession();
    s.annots.addLink(PAGE, { x: 20, y: 100, w: 100, h: 20 }, { uri: "https://example.com/x" });
    s.annots.addLink(PAGE, { x: 20, y: 140, w: 100, h: 20 }, { page: PAGE, y: 50 });
    const { r, bytes } = await saveAndRender(s);
    expect(r.inkIn(20, 100, 100, 70)).toBe(0);
    const again = await openPdf(bytes);
    const links = again.doc.pages[0]!.annots.filter((a) => a.type === "link");
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ uri: "https://example.com/x" });
    expect(links[1]).toMatchObject({ dest: { page: PAGE, y: 50 } });
  });

  it("keeps every annotation on reading it back", async () => {
    const s = await newSession();
    s.annots.addHighlight(PAGE, [{ x: 20, y: 30, w: 100, h: 20 }], { color: "#ffeb3b", contents: "important" });
    s.annots.addInk(PAGE, [[[20, 100], [60, 140]]], { color: "#d50000", width: 3, dash: [4, 2] });
    s.annots.addShape(PAGE, "circle", { x: 20, y: 200, w: 80, h: 60 }, { color: "#0000ff", width: 3, fill: "#00ff00", opacity: 0.5 });
    s.annots.addLine(PAGE, [20, 300], [200, 300], { color: "#6200ea", width: 3, endEnd: "closed-arrow" });
    s.annots.addFreeText(PAGE, { x: 150, y: 100, w: 120, h: 50 }, "Some text", { size: 12, color: "#d50000", fill: "#ffffcc", stroke: { color: "#00aa00", width: 2 }, italic: true, family: "Times", align: "right" });
    s.annots.addNote(PAGE, 250, 20, "a note", { icon: "key", color: "#ff0000" });
    s.annots.addStamp(PAGE, { x: 150, y: 200, w: 100, h: 30 }, { name: "Draft", label: "My draft", color: "#123456" });
    s.annots.addSignature(PAGE, { x: 150, y: 250, w: 100, h: 30 }, { mode: "draw", strokes: [[[1, 2], [3, 4]]], width: 2 });
    s.annots.addSignature(PAGE, { x: 150, y: 290, w: 100, h: 30 }, { mode: "type", text: "Typed", color: "#222222" });
    s.annots.addImage(PAGE, { x: 20, y: 330, w: 30, h: 30 }, { src: solidPng([10, 20, 30]) });
    s.annots.markRedaction(PAGE, [{ x: 60, y: 330, w: 30, h: 30 }], { fill: "#ffffff", overlay: "REDACTED" });
    const { bytes } = await saveAndRender(s);
    const again = await openPdf(bytes);
    const was = s.doc.pages[0]!.annots;
    const now = again.doc.pages[0]!.annots;
    expect(now.map((a) => a.type)).toEqual(was.map((a) => a.type));
    const strip = (a: Annotation) => {
      const { id: _id, ref: _ref, created: _c, modified: _m, thread: _t, ...rest } = a as Annotation & { thread?: string };
      return JSON.parse(JSON.stringify(rest));
    };
    was.forEach((a, i) => {
      const b = now[i]!;
      const x = strip(a);
      const y = strip(b);
      if (a.type === "image") {
        expect(y.picture.src).toMatch(/^data:image\/png;base64,/);
        delete x.picture;
        delete y.picture;
      }
      // The words under a highlight are found when the file is read again.
      if (a.type === "highlight") x.quote = "Hello annotated";
      expect(y, a.type).toEqual(x);
    });
  });
});
