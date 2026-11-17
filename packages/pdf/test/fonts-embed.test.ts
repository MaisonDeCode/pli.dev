import { readFileSync } from "node:fs";
import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfName, PdfRef, PdfStream, bytesToLatin1, isStream } from "../src/cos/objects";
import { createPdf } from "../src/cos/writer";
import { embedTrueType } from "../src/fonts/embed";
import { finishPage, newPage } from "./support/build";
import { renderPdf } from "./support/render";

const lora = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url)));

describe("embedTrueType", () => {
  it("encodes to 2-byte glyph numbers and measures", () => {
    const o = createPdf();
    const f = embedTrueType(o, lora, { family: "Lora" });
    const codes = f.encode("Hi");
    expect(codes.length).toBe(4);
    expect(codes[0]! << 8 | codes[1]!).not.toBe(0);
    expect(f.hasGlyph("H")).toBe(true);
    expect(f.hasGlyph("中")).toBe(false);
    expect(f.encode("中")).toEqual(Uint8Array.of(0, 0));
    expect(f.width("", 10)).toBe(0);
    expect(f.width("HH", 10)).toBeCloseTo(f.width("H", 10) * 2, 6);
    expect(f.ascent).toBeGreaterThan(0.5);
    expect(f.descent).toBeLessThan(0);
    expect(f.encode("a\tb").length).toBe(6); // a tab is a space
    expect(f.encode("a​b").length).toBe(4); // zero width space is dropped
  });

  it("describes the font the way a PDF needs", () => {
    const o = createPdf();
    const f = embedTrueType(o, lora, { family: "Lora" });
    f.encode("Hello world");
    f.finish();
    const type0 = o.get(f.ref) as PdfDict;
    expect(type0.get("Subtype")).toBe(PdfName.of("Type0"));
    expect(type0.get("Encoding")).toBe(PdfName.of("Identity-H"));
    const cid = o.get((type0.get("DescendantFonts") as PdfRef[])[0]!) as PdfDict;
    expect(cid.get("Subtype")).toBe(PdfName.of("CIDFontType2"));
    expect(cid.get("CIDToGIDMap")).toBe(PdfName.of("Identity"));
    const desc = o.get(cid.get("FontDescriptor")!) as PdfDict;
    expect((desc.get("FontName") as PdfName).value).toMatch(/^[A-Z]{6}\+Lora/);
    expect(desc.get("Flags")).toBe(32);
    expect(desc.get("ItalicAngle")).toBe(0);
    expect((desc.get("FontBBox") as number[]).length).toBe(4);
    expect(desc.get("Ascent")).toBeGreaterThan(500);
    expect(desc.get("Descent")).toBeLessThan(0);
    expect(desc.get("CapHeight")).toBeGreaterThan(500);
    const w = cid.get("W") as (number | number[])[];
    // distinct glyphs of "Hello world": H e l o space w r d
    expect(w.flat().length).toBeGreaterThan(8);
    // ToUnicode maps each used glyph back
    const uni = o.get(type0.get("ToUnicode")!) as PdfStream;
    const cmap = bytesToLatin1(unzlibSync(uni.data));
    expect(cmap).toContain("beginbfchar");
    expect(cmap).toMatch(/<[0-9A-F]{4}> <0048>/);
    expect(cmap).toMatch(/<[0-9A-F]{4}> <0077>/);
    const file = o.get(desc.get("FontFile2")!) as PdfStream;
    expect(isStream(file)).toBe(true);
    expect(file.dict.get("Length1")).toBe(unzlibSync(file.data).length);
  });

  it("subsets, and a subset of everything is not bigger than the font", () => {
    const sizeFor = (text: string, subset?: boolean) => {
      const o = createPdf();
      const f = embedTrueType(o, lora, { family: "Lora", subset });
      f.encode(text);
      f.finish();
      const type0 = o.get(f.ref) as PdfDict;
      const cid = o.get((type0.get("DescendantFonts") as PdfRef[])[0]!) as PdfDict;
      const desc = o.get(cid.get("FontDescriptor")!) as PdfDict;
      return (o.get(desc.get("FontFile2")!) as PdfStream).dict.get("Length1") as number;
    };
    const few = sizeFor("abc");
    const many = sizeFor("The quick brown fox jumps over the lazy dog. éñüßÅ");
    const whole = sizeFor("abc", false);
    expect(few).toBeLessThan(many);
    expect(many).toBeLessThan(whole);
    expect(whole).toBe(lora.length);
    expect(few).toBeLessThan(lora.length / 3);
  });

  it("pdf.js lays text out with the widths we measured and draws it", async () => {
    const t = newPage(300, 100);
    const f = embedTrueType(t.overlay, lora, { family: "Lora" });
    const name = t.res.font(f.ref);
    const text = "Waltz, bad nymph: for quick jigs vex! Éñ";
    t.content.beginText().font(name, 12).textMove(10, 50).showGlyphs(f.encode(text)).endText();
    f.finish();
    finishPage(t);
    const r = await renderPdf(t.overlay.rewrite({ compress: true }), 0, 3);
    expect(r.items.map((i) => i.str).join("")).toBe(text);
    const total = r.items.reduce((n, i) => n + i.width, 0);
    expect(total).toBeCloseTo(f.width(text, 12), 0);
    expect(r.inkIn(10, 35, 280, 20)).toBeGreaterThan(300);
  });

  it("can be finished again after more text, with the same objects", () => {
    const o = createPdf();
    const f = embedTrueType(o, lora, { family: "Lora" });
    f.encode("a");
    f.finish();
    const ref = f.ref;
    f.encode("bcd");
    f.finish();
    expect(f.ref).toEqual(ref);
    const type0 = o.get(f.ref) as PdfDict;
    const cid = o.get((type0.get("DescendantFonts") as PdfRef[])[0]!) as PdfDict;
    expect((cid.get("W") as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("refuses fonts it cannot embed", () => {
    const o = createPdf();
    const cff = lora.slice();
    cff.set([0x4f, 0x54, 0x54, 0x4f]);
    expect(() => embedTrueType(o, cff, { family: "X" })).toThrow(/PostScript/);
    expect(() => embedTrueType(o, new Uint8Array(100), { family: "X" })).toThrow();
    // set the "restricted licence" bit in OS/2 fsType
    const locked = lora.slice();
    const dv = new DataView(locked.buffer);
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const at = 12 + 16 * i;
      if (String.fromCharCode(...locked.subarray(at, at + 4)) === "OS/2") dv.setUint16(dv.getUint32(at + 8) + 8, 2);
    }
    expect(() => embedTrueType(o, locked, { family: "X" })).toThrow(/licence/);
  });
});
