import { describe, expect, it } from "vitest";
import { PdfDict, PdfName } from "../src/cos/objects";
import { createPdf } from "../src/cos/writer";
import { addStandardFont, encodeWinAnsi, measure, standardFamilyFor, standardFontName, standardWidth, winAnsiCode } from "../src/fonts/standard";

describe("standard fonts", () => {
  it("names the 12 faces", () => {
    expect(standardFontName("Helvetica")).toBe("Helvetica");
    expect(standardFontName("Helvetica", { bold: true, italic: true })).toBe("Helvetica-BoldOblique");
    expect(standardFontName("Times", { italic: true })).toBe("Times-Italic");
    expect(standardFontName("Times")).toBe("Times-Roman");
    expect(standardFontName("Courier", { bold: true })).toBe("Courier-Bold");
  });

  it("maps font names to a standard family", () => {
    expect(standardFamilyFor("Arial")).toBe("Helvetica");
    expect(standardFamilyFor("Helvetica Neue")).toBe("Helvetica");
    expect(standardFamilyFor("Times New Roman")).toBe("Times");
    expect(standardFamilyFor("Courier New")).toBe("Courier");
    expect(standardFamilyFor("Georgia")).toBe("Times");
    expect(standardFamilyFor("Consolas")).toBe("Courier");
    expect(standardFamilyFor("Some Unknown Font")).toBe("Helvetica");
  });

  it("knows the widths of the Adobe font metrics", () => {
    expect(standardWidth(32, "Helvetica")).toBe(278);
    expect(standardWidth(65, "Helvetica")).toBe(667);
    expect(standardWidth(65, "Helvetica", { bold: true })).toBe(722);
    expect(standardWidth(65, "Times")).toBe(722);
    expect(standardWidth(105, "Times", { italic: true })).toBe(278);
    expect(standardWidth(65, "Courier", { bold: true })).toBe(600);
    expect(measure("AAA", "Arial", 10)).toBeCloseTo(20.01, 5);
    expect(measure("", "Arial", 10)).toBe(0);
  });

  it("encodes WinAnsi", () => {
    expect([...encodeWinAnsi("Aé€’–  ")]).toEqual([65, 233, 128, 146, 150, 32, 160]);
    expect(winAnsiCode("Ж")).toBe(63);
    expect([...encodeWinAnsi("a\tb\nc")]).toEqual([97, 32, 98, 32, 99]);
    expect([...encodeWinAnsi("a​b­c")]).toEqual([97, 98, 99]);
  });

  it("adds one font dictionary per face to an overlay", () => {
    const o = createPdf();
    const a = addStandardFont(o, "Arial");
    expect(addStandardFont(o, "Helvetica")).toEqual(a);
    expect(addStandardFont(o, "Arial", { bold: true })).not.toEqual(a);
    const d = o.get(a) as PdfDict;
    expect(d.get("BaseFont")).toBe(PdfName.of("Helvetica"));
    expect(d.get("Encoding")).toBe(PdfName.of("WinAnsiEncoding"));
    expect((d.get("Widths") as number[]).length).toBe(224);
    expect(addStandardFont(createPdf(), "Arial").num).toBeGreaterThan(0);
  });
});
