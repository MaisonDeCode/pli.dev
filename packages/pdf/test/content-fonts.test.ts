import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { parseCMap } from "../src/content/fontinfo";
import { glyphNameToUnicode, baseEncoding } from "../src/content/glyphs";
import { PdfFile } from "../src/cos/file";
import { embedTrueType } from "../src/fonts/embed";
import { extractText } from "../src/text";
import { finishPage, newPage } from "./support/build";
import { makePdf } from "./support/content";
import { obj, streamObj } from "./support/handmade";
import { contains } from "./support/leak";
import { renderPdf } from "./support/render";

const lora = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url)));

describe("encodings and glyph names", () => {
  it("has 128 high characters in MacRoman and knows common glyph names", () => {
    expect(baseEncoding("MacRomanEncoding")![0x8e]).toBe("é");
    expect(baseEncoding("MacRomanEncoding")![0xd2]).toBe("“");
    expect(baseEncoding("MacRomanEncoding")!).toHaveLength(256);
    expect(baseEncoding("WinAnsiEncoding")![0x80]).toBe("€");
    expect(baseEncoding("StandardEncoding")![0x27]).toBe("’");
    expect(glyphNameToUnicode("eacute")).toBe("é");
    expect(glyphNameToUnicode("uni20AC")).toBe("€");
    expect(glyphNameToUnicode("f_i")).toBe("fi");
    expect(glyphNameToUnicode("A.sc")).toBe("A");
    expect(glyphNameToUnicode("nonsense")).toBe("");
  });

  it("parses ToUnicode maps: bfchar, bfrange, arrays and surrogate pairs", () => {
    const cm = parseCMap(new TextEncoder().encode("1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <01> <0058> <02> <00660069> endbfchar 2 beginbfrange <10> <12> <0041> <20> <21> [<0030> <D83DDE00>] endbfrange"));
    expect(cm.bf.get(1)).toBe("X");
    expect(cm.bf.get(2)).toBe("fi");
    expect([0x10, 0x11, 0x12].map((c) => cm.bf.get(c))).toEqual(["A", "B", "C"]);
    expect(cm.bf.get(0x21)).toBe("😀");
  });
});

describe("reading text in different fonts", () => {
  it("applies /Differences, ToUnicode and standard widths", () => {
    const fonts = {
      D: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /Euro /fi /eacute 200 /uni0416] >> >>",
      U: "<< /Type /Font /Subtype /Type1 /BaseFont /Foo /FirstChar 1 /LastChar 5 /Widths [600 600 600 1000 1000] /ToUnicode 50 0 R >>",
      M: "<< /Type /Font /Subtype /TrueType /BaseFont /Arial /Encoding /MacRomanEncoding >>",
    };
    const cmap = streamObj(50, "", "/CIDInit /ProcSet findresource begin begincmap 1 begincodespacerange <00> <FF> endcodespacerange 3 beginbfchar <01> <0058> <02> <0059> <03> <005A> endbfchar 1 beginbfrange <04> <05> <D83DDE00> endbfrange endcmap");
    const bytes = makePdf({ fonts, objs: [cmap], content: "BT /D 12 Tf 20 150 Td (ABC) Tj 0 -20 Td <C8> Tj /U 12 Tf 0 -20 Td <010203 0405> Tj /M 12 Tf 0 -20 Td <8e 8f> Tj ET" });
    const page = extractText(PdfFile.open(bytes), 0);
    expect(page.text.split("\n")).toEqual(["€fié", "Ж", "XYZ\u{1f600}\u{1f601}", "éè"]);
    // widths: the ToUnicode font has its own /Widths: X Y Z are 600 each
    const u = page.runs.find((r) => r.text.startsWith("XYZ"))!;
    expect(u.glyphs[0]!.box.w).toBeCloseTo(7.2, 2);
    expect(u.glyphs[1]!.box.x).toBeCloseTo(u.glyphs[0]!.box.x + 7.2, 2);
  });

  it("reads a 2-byte CID font written by the embedder (Identity-H, ToUnicode, /W) and redacts in it", async () => {
    const t = newPage(300, 200);
    const font = embedTrueType(t.overlay, lora, { family: "Lora" });
    const f = t.res.font(font.ref);
    t.content.beginText().font(f, 16).textMove(20, 150).showGlyphs(font.encode("Café señor KEEPME")).endText();
    t.content.beginText().font(f, 16).textMove(20, 110).showGlyphs(font.encode("The CIDSECRET code")).endText();
    font.finish();
    finishPage(t);
    const bytes = t.overlay.rewrite();
    const page = extractText(PdfFile.open(bytes), 0);
    expect(page.text).toBe("Café señor KEEPME\nThe CIDSECRET code");
    expect(page.runs[0]!.glyphs[0]!.box.w).toBeCloseTo(font.width("C", 16), 1);
    expect(page.runs[0]!.editable).toBe(true);

    const s = await openPdf(bytes);
    await s.content.markSearch("CIDSECRET");
    s.content.applyRedactions();
    const out = await s.save();
    const after = extractText(PdfFile.open(out), 0);
    expect(after.text).toBe("Café señor KEEPME\nThe  code");
    // the 2-byte codes of the redacted word are gone from the content (the codes of C, I, D, S, E, R, T)
    const codes = font.encode("CIDSECRET");
    const hex = Array.from(codes, (b) => b.toString(16).padStart(2, "0")).join("");
    expect(contains(out, hex)).toBe(false);
    const r = await renderPdf(out, 0, 2);
    expect(r.text).toContain("Café");
    expect(r.text).not.toContain("CIDSECRET");
    // "code" did not move
    const before = page.runs[1]!.glyphs;
    const kept = after.runs.flatMap((x) => x.glyphs).filter((g) => g.char === "c" || g.char === "o" || g.char === "d");
    const was = before.filter((g) => g.char === "c" || g.char === "o" || g.char === "d").slice(-3);
    expect(kept.slice(-3).map((g) => Math.round(g.box.x * 10))).toEqual(was.map((g) => Math.round(g.box.x * 10)));
  });

  it("says which text cannot be edited faithfully: Type 3, invisible text, vertical writing", async () => {
    const t3 = streamObj(50, "", "10 0 d0 0 0 10 10 re f");
    const fonts = {
      T: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 10 10] /FontMatrix [0.1 0 0 0.1 0 0] /CharProcs << /sq 50 0 R >> /Encoding << /Type /Encoding /Differences [97 /sq] >> /FirstChar 97 /LastChar 97 /Widths [10] /Resources << >> >>",
      H: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      V: "<< /Type /Font /Subtype /Type0 /BaseFont /Foo /Encoding /Identity-V /DescendantFonts [51 0 R] >>",
    };
    const cid = obj(51, "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Foo /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>");
    const bytes = makePdf({ fonts, objs: [t3, cid], content: "BT /T 20 Tf 20 150 Td (aaa) Tj /H 12 Tf 0 -30 Td 3 Tr (hidden ocr) Tj 0 Tr (plain) Tj /V 12 Tf <00410042> Tj ET" });
    const s = await openPdf(bytes);
    const runs = await s.content.editableRuns(s.doc.pages[0]!.id);
    const by = (text: string) => runs.find((r) => r.text.includes(text))!;
    expect(by("aaa")).toMatchObject({ editable: false, font: "type3" });
    expect(by("aaa").reason).toMatch(/Type 3/);
    expect(by("hidden")).toMatchObject({ editable: false });
    expect(by("hidden").reason).toMatch(/invisible/);
    expect(by("plain")).toMatchObject({ editable: true, font: "simple" });
    // the Type 3 glyphs advance by their widths: 3 glyphs of 1 em at 20
    expect(extractText(PdfFile.open(bytes), 0).runs.find((r) => r.text.includes("aaa"))!.box.w).toBeCloseTo(60, 0);
    await expect(s.content.replaceText(by("hidden").id, "x")).rejects.toThrow(/invisible/);
  });
});
