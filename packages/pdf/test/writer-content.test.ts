import { describe, expect, it } from "vitest";
import { ContentBuilder, ResourceNames, hex, literal, parseHexColor } from "../src/cos/content";
import { PdfDict, PdfName, PdfRef, bytesToLatin1 } from "../src/cos/objects";
import { parseContentStream } from "../src/cos";

describe("ContentBuilder", () => {
  it("writes operators with short numbers", () => {
    const c = new ContentBuilder();
    c.save().fillColor("#ff8000").strokeColor("#00f").lineWidth(1.5).lineCap("round").lineJoin("bevel").miterLimit(4).dash([3, 1.5], 0.5);
    c.rect(1, 2, 3.14159265, 4).fill().rect(0, 0, 1, 1).fill(true).moveTo(0, 0).lineTo(10, 0).curveTo(1, 2, 3, 4, 5, 6).close().stroke().fillStroke().fillStroke(true).closeStroke();
    c.rect(0, 0, 5, 5).clip().rect(0, 0, 5, 5).clip(true).endPath().restore();
    expect(c.toString()).toBe(
      [
        "q",
        "1 0.50196 0 rg",
        "0 0 1 RG",
        "1.5 w",
        "1 J",
        "2 j",
        "4 M",
        "[3 1.5] 0.5 d",
        "1 2 3.14159 4 re",
        "f",
        "0 0 1 1 re",
        "f*",
        "0 0 m",
        "10 0 l",
        "1 2 3 4 5 6 c",
        "h",
        "S",
        "B",
        "B*",
        "s",
        "0 0 5 5 re",
        "W",
        "n",
        "0 0 5 5 re",
        "W*",
        "n",
        "n",
        "Q",
        "",
      ].join("\n"),
    );
  });

  it("writes text with escaping, hex glyph strings, and transforms", () => {
    const c = new ContentBuilder();
    c.beginText().font("F1", 12).textMove(10, 20).showText("a(b)\\c\né").showGlyphs(Uint8Array.of(0, 5, 255, 1)).charSpacing(0.5).textMode(3).endText();
    c.translate(5, 6).rotate(90).drawXObject("Im1", 0, 0, 10, 20);
    const ops = parseContentStream(c.toBytes()).map((o) => o.op);
    expect(ops).toEqual(["BT", "Tf", "Td", "Tj", "Tj", "Tc", "Tr", "ET", "cm", "cm", "q", "cm", "Do", "Q"]);
    expect(c.toString()).toContain("(a\\(b\\)\\\\c\\n\\351) Tj");
    expect(c.toString()).toContain("<0005ff01> Tj");
    expect(c.toString()).toContain("0 1 -1 0 0 0 cm");
    expect(literal(new Uint8Array([40, 0]))).toBe("(\\(\\000)");
    expect(hex(new Uint8Array([1, 171]))).toBe("<01ab>");
  });

  it("draws an ellipse with four curves and builds a stream", () => {
    const c = new ContentBuilder();
    c.ellipse(0, 0, 10, 6);
    expect(c.toString().match(/ c\n/g)!.length).toBe(4);
    const s = c.toStream({ Type: PdfName.of("XObject") });
    expect(bytesToLatin1(s.data)).toBe(c.toString());
    expect(s.dict.get("Type")).toBe(PdfName.of("XObject"));
    expect(new ContentBuilder().raw("1 0 0 1 0 0 cm").toString()).toBe("1 0 0 1 0 0 cm\n");
  });

  it("rejects colours it cannot read", () => {
    expect(parseHexColor("#FFF")).toEqual([1, 1, 1]);
    expect(parseHexColor("00ff00")).toEqual([0, 1, 0]);
    expect(() => parseHexColor("red")).toThrow();
  });
});

describe("ResourceNames", () => {
  it("names fonts, pictures and graphics states without clashes", () => {
    const dict = new PdfDict({ Font: new PdfDict({ F1: new PdfRef(9) }) });
    const r = new ResourceNames(dict);
    expect(r.font(new PdfRef(9))).toBe("F1");
    expect(r.font(new PdfRef(10))).toBe("F2");
    expect(r.font(new PdfRef(10))).toBe("F2");
    expect(r.xobject(new PdfRef(11))).toBe("Im1");
    const a = r.extGState({ fillOpacity: 0.5 });
    expect(r.extGState({ fillOpacity: 0.5 })).toBe(a);
    const b = r.extGState({ fillOpacity: 0.5, blendMode: "Multiply" });
    expect(b).not.toBe(a);
    const gs = (dict.get("ExtGState") as PdfDict).get(b) as PdfDict;
    expect(gs.get("ca")).toBe(0.5);
    expect(gs.get("BM")).toBe(PdfName.of("Multiply"));
    expect(gs.has("CA")).toBe(false);
  });
});
