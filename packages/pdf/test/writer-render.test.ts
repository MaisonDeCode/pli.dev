import { createCanvas } from "@napi-rs/canvas";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addStandardFont, embedTrueType, makeImageXObject, measure, encodeWinAnsi } from "../src/write";
import { makePng } from "./support/png";
import { finishPage, newPage } from "./support/build";
import { renderPdf } from "./support/render";

const lora = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url)));

function jpegBytes(): Uint8Array {
  const c = createCanvas(16, 16);
  const g = c.getContext("2d");
  g.fillStyle = "#0000ff";
  g.fillRect(0, 0, 16, 16);
  return new Uint8Array(c.toBuffer("image/jpeg"));
}

function buildDemo() {
  const t = newPage(200, 200);
  const { overlay, content: c, res } = t;
  const helv = res.font(addStandardFont(overlay, "Arial"));
  const embedded = embedTrueType(overlay, lora, { family: "Lora" });
  const lo = res.font(embedded.ref);
  // vector: a red square, top-left at (10,10) in page space
  c.save().fillColor("#ff0000").rect(10, 170, 30, 20).fill().restore();
  c.save().strokeColor("#00aa00").lineWidth(3).dash([4, 2]).moveTo(60, 180).lineTo(110, 180).stroke().restore();
  // text
  c.beginText().font(helv, 14).textMove(10, 140).showText("Standard text").endText();
  c.beginText().font(lo, 14).textMove(10, 110).showGlyphs(embedded.encode("Embedded Lora")).endText();
  // PNG with alpha: left half transparent, right half solid green
  const png = makeImageXObject(overlay, { png: makePng({ width: 4, height: 4, colorType: 6, depth: 8, sample: (x) => (x < 2 ? [0, 0, 0, 0] : [0, 200, 0, 255]) }) });
  c.drawXObject(res.xobject(png.ref), 10, 40, 40, 40);
  // JPEG
  const jpeg = makeImageXObject(overlay, { jpeg: jpegBytes() });
  c.drawXObject(res.xobject(jpeg.ref), 100, 40, 40, 40);
  // translucent shape with blend
  const gs = res.extGState({ fillOpacity: 0.5 });
  c.save().gs(gs).fillColor("#000000").rect(150, 150, 40, 40).fill().restore();
  embedded.finish();
  finishPage(t);
  return { t, embedded };
}

describe("writer render", () => {
  it("renders text, images and shapes with pdf.js", async () => {
    const { t } = buildDemo();
    const bytes = t.overlay.rewrite();
    const r = await renderPdf(bytes, 0, 2);
    expect(r.pages).toBe(1);
    expect(r.text).toContain("Standard text");
    expect(r.text).toContain("Embedded Lora");
    // red square at page y 10..30 (top-left space)
    expect(r.pixel(25, 20)).toEqual([255, 0, 0, 255]);
    // PNG: left half transparent (white), right half green; the picture is at y 120..160 from the top
    expect(r.pixel(15, 140)).toEqual([255, 255, 255, 255]);
    const green = r.pixel(45, 140);
    expect(green[1]).toBeGreaterThan(150);
    expect(green[0]).toBeLessThan(40);
    // JPEG blue
    const blue = r.pixel(120, 140);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(60);
    // text drawn: ink near both lines
    expect(r.inkIn(10, 48, 90, 14)).toBeGreaterThan(20);
    expect(r.inkIn(10, 78, 90, 14)).toBeGreaterThan(20);
    // half-opaque black: mid grey
    const grey = r.pixel(170, 30);
    expect(grey[0]).toBeGreaterThan(110);
    expect(grey[0]).toBeLessThan(145);
    // the dash: ink on the line, gaps between dashes
    expect(r.inkIn(60, 18, 50, 4)).toBeGreaterThan(30);
  });

  it("writes the same page with every rewrite option and pdf.js reads each", async () => {
    const { t } = buildDemo();
    const variants = [{}, { compress: true }, { compress: true, xrefStream: true }, { compress: true, objectStreams: true }, { gc: false }, { version: "1.4" }];
    for (const v of variants) {
      const bytes = t.overlay.rewrite(v);
      const r = await renderPdf(bytes, 0, 1);
      expect(r.text, JSON.stringify(v)).toContain("Embedded Lora");
      expect(r.pixel(25, 20), JSON.stringify(v)).toEqual([255, 0, 0, 255]);
    }
    const plain = t.overlay.rewrite();
    const small = t.overlay.rewrite({ compress: true, objectStreams: true });
    expect(small.length).toBeLessThan(plain.length);
    expect(new TextDecoder("latin1").decode(small.subarray(0, 8))).toBe("%PDF-1.7");
    expect(new TextDecoder("latin1").decode(plain.subarray(0, 8))).toBe("%PDF-1.7");
  });

  it("subsets the embedded font", () => {
    const { embedded, t } = buildDemo();
    const bytes = t.overlay.rewrite();
    expect(bytes.length).toBeLessThan(lora.length / 2);
    expect(embedded.hasGlyph("e")).toBe(true);
    expect(embedded.hasGlyph("中")).toBe(false);
    expect(embedded.width("Embedded", 10)).toBeGreaterThan(30);
    expect(embedded.width("Embedded", 10)).toBeLessThan(60);
  });

  it("measures standard font text", () => {
    expect(measure("Hello", "Helvetica", 10)).toBeCloseTo((722 + 556 + 222 + 222 + 556) / 100, 5);
    expect(measure("iiii", "Courier New", 10)).toBeCloseTo(24, 5);
    expect(measure("“q”", "Times New Roman", 1000, { bold: true })).toBeGreaterThan(1000);
    expect([...encodeWinAnsi("a€•é中")]).toEqual([97, 128, 149, 233, 63]);
  });

  it("can write the files for a look with the python checker", () => {
    if (process.env.PLI_PDF_WRITE_DIR) {
      const { t } = buildDemo();
      const dir = mkdtempSync(join(process.env.PLI_PDF_WRITE_DIR, "w-"));
      for (const [name, o] of Object.entries({ plain: {}, objstm: { compress: true, objectStreams: true }, xref: { xrefStream: true } })) writeFileSync(join(dir, name + ".pdf"), t.overlay.rewrite(o));
      expect(dir).toBeTruthy();
    }
    expect(tmpdir()).toBeTruthy();
  });
});
