import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { strFromU8, unzlibSync } from "fflate";
import { parseTrueType, toPdf, type PdfPage } from "../src";

/** A small reader for the PDFs this writes: enough to check the file is built right and see what was drawn. */
function read(bytes: Uint8Array) {
  const text = strFromU8(bytes, true);
  expect(text.startsWith("%PDF-1.7\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  expect(text.slice(start, start + 4)).toBe("xref");
  const [, count] = /^xref\n0 (\d+)\n/.exec(text.slice(start))!.map(Number) as [number, number];
  const entries = text.slice(start).split("\n").slice(2, 2 + count);
  expect(entries[0]).toBe("0000000000 65535 f ");
  const objects = new Map<number, { dict: string; stream?: Uint8Array; body: string }>();
  entries.slice(1).forEach((entry, i) => {
    expect(entry).toMatch(/^\d{10} 00000 n $/);
    const offset = Number(entry.slice(0, 10));
    const id = i + 1;
    expect(text.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    const end = text.indexOf("endobj", offset);
    const body = text.slice(offset + `${id} 0 obj\n`.length, end);
    const streamAt = body.indexOf("\nstream\n");
    if (streamAt < 0) return void objects.set(id, { dict: body, body });
    const dict = body.slice(0, streamAt);
    const length = Number(/\/Length (\d+)/.exec(dict)![1]);
    const from = offset + `${id} 0 obj\n`.length + streamAt + "\nstream\n".length;
    const raw = bytes.subarray(from, from + length);
    objects.set(id, { dict, body, stream: dict.includes("FlateDecode") ? unzlibSync(raw) : raw });
  });
  const trailer = /trailer\n<< (.*) >>/.exec(text)![1]!;
  return { text, objects, trailer, count };
}

const page = (items: PdfPage["items"], extra: Partial<PdfPage> = {}): PdfPage => ({ width: 612, height: 792, items, ...extra });
const contentOf = (pdf: ReturnType<typeof read>, pageNumber = 0) => {
  const pages = [...pdf.objects.values()].filter((o) => /\/Type \/Page /.test(o.dict));
  const id = Number(/\/Contents (\d+) 0 R/.exec(pages[pageNumber]!.dict)![1]);
  return strFromU8(pdf.objects.get(id)!.stream!, true);
};

describe("toPdf: the file", () => {
  it("is built right: a header, objects where the table says, and a trailer that points at the catalog", () => {
    const pdf = read(toPdf([page([{ type: "text", x: 72, y: 100, text: "Hello", font: { family: "Arial" }, size: 12 }])]));
    const root = Number(/\/Root (\d+) 0 R/.exec(pdf.trailer)![1]);
    expect(pdf.objects.get(root)!.dict).toMatch(/^<< \/Type \/Catalog \/Pages \d+ 0 R/);
    expect(Number(/\/Size (\d+)/.exec(pdf.trailer)![1])).toBe(pdf.count);
    expect([...pdf.objects.values()].filter((o) => /\/Type \/Pages /.test(o.dict))).toHaveLength(1);
  });

  it("has a page for each page, with its size", () => {
    const pdf = read(toPdf([page([], { width: 595.28, height: 841.89 }), page([], { width: 792, height: 612 })]));
    const sizes = [...pdf.objects.values()].filter((o) => /\/Type \/Page /.test(o.dict)).map((o) => /\/MediaBox \[0 0 ([\d. ]+)\]/.exec(o.dict)![1]);
    expect(sizes).toEqual(["595.28 841.89", "792 612"]);
    expect([...pdf.objects.values()].find((o) => /\/Type \/Pages /.test(o.dict))!.dict).toContain("/Count 2");
  });

  it("records the title, and writes it so any reader shows it", () => {
    const pdf = read(toPdf([page([])], { title: "Q3 plan — résumé", author: "Ana" }));
    const info = [...pdf.objects.values()].find((o) => o.dict.includes("/Producer"))!.dict;
    expect(info).toContain("/Title <FEFF");
    expect(info).toContain("/Author <FEFF0041006E0061>");
  });

  it("can leave the pages uncompressed to be read as they are", () => {
    const pdf = read(toPdf([page([{ type: "text", x: 1, y: 1, text: "plain", font: { family: "Arial" }, size: 10 }])], { compress: false }));
    expect(pdf.text).toContain("BT /F1 10 Tf");
  });
});

describe("toPdf: what is drawn", () => {
  it("draws text from the top left, with the baseline flipped to the PDF's bottom left", () => {
    const content = contentOf(read(toPdf([page([{ type: "text", x: 72, y: 100, text: "Hi", font: { family: "Arial" }, size: 12, color: "#ff0000" }])])));
    expect(content).toBe("BT /F1 12 Tf 1 0 0 rg 100 Tz 1 0 0 1 72 692 Tm <4869> Tj ET\n");
  });

  it("stretches text to the width it had where it was laid out", () => {
    // "Hi" in Helvetica is 722 + 222 = 944/1000 em: at 10 pt, 9.44 pt wide.
    const content = contentOf(read(toPdf([page([{ type: "text", x: 0, y: 0, text: "Hi", font: { family: "Arial" }, size: 10, width: 18.88 }])])));
    expect(content).toContain("200 Tz");
  });

  it("keeps the squeeze within reason", () => {
    const squeeze = contentOf(read(toPdf([page([{ type: "text", x: 0, y: 0, text: "Hi", font: { family: "Arial" }, size: 10, width: 0.5 }])])));
    expect(squeeze).toContain("40 Tz");
    const stretch = contentOf(read(toPdf([page([{ type: "text", x: 0, y: 0, text: "Hi", font: { family: "Arial" }, size: 10, width: 500 }])])));
    expect(stretch).toContain("250 Tz");
  });

  it("chooses the standard font by family and style", () => {
    const cases: [string, boolean, boolean, string][] = [
      ["Arial", false, false, "Helvetica"],
      ["Arial", true, false, "Helvetica-Bold"],
      ["Verdana", true, true, "Helvetica-BoldOblique"],
      ["Times New Roman", false, true, "Times-Italic"],
      ["Georgia", true, false, "Times-Bold"],
      ["Courier New", false, false, "Courier"],
      ["ui-monospace, Menlo", true, true, "Courier-BoldOblique"],
      ["system-ui", false, false, "Helvetica"],
    ];
    for (const [family, bold, italic, name] of cases) {
      const pdf = read(toPdf([page([{ type: "text", x: 0, y: 0, text: "x", font: { family, bold, italic }, size: 10 }])]));
      expect(pdf.text, family).toContain(`/BaseFont /${name} `);
    }
  });

  it("uses one font object for all the text in the same font, across pages", () => {
    const item = { type: "text" as const, x: 0, y: 0, text: "x", font: { family: "Arial" }, size: 10 };
    const pdf = read(toPdf([page([item]), page([item, { ...item, font: { family: "Arial", bold: true } }])]));
    expect([...pdf.text.matchAll(/\/Type \/Font /g)]).toHaveLength(2);
  });

  it("encodes Western European text, typographic punctuation and the euro", () => {
    const content = contentOf(read(toPdf([page([{ type: "text", x: 0, y: 0, text: "Café “quoted” — €5…", font: { family: "Arial" }, size: 10 }])])));
    // C a f é(E9) space “(93) q u o t e d ”(94) space —(97) space €(80) 5 …(85)
    expect(content).toContain("<436166E9209371756F74656494209720803585>");
  });

  it("swaps in what looks like a character that has no code, drops what can't be seen, and warns about the rest", () => {
    const warnings: string[] = [];
    const content = contentOf(read(toPdf([page([{ type: "text", x: 0, y: 0, text: "a‑b​c中", font: { family: "Arial" }, size: 10 }])], { warnings })));
    expect(content).toContain("<612D62633F>"); // a - b c ?
    expect(warnings.join(" ")).toMatch(/no place in the fonts.*中/);
  });

  it("draws filled and outlined rectangles and lines", () => {
    const content = contentOf(
      read(
        toPdf([
          page([
            { type: "rect", x: 10, y: 20, width: 100, height: 50, fill: "#e5e7eb" },
            { type: "rect", x: 10, y: 20, width: 100, height: 50, stroke: "#000", strokeWidth: 2 },
            { type: "line", x1: 0, y1: 5, x2: 50, y2: 5, color: "rgb(255, 0, 0)", width: 0.5, dash: [3, 2] },
          ]),
        ]),
      ),
    );
    expect(content).toContain("0.898 0.906 0.922 rg 10 722 100 50 re f");
    expect(content).toContain("0 0 0 RG 2 w 10 722 100 50 re S");
    expect(content).toContain("1 0 0 RG 0.5 w [3 2] 0 d 0 787 m 50 787 l S");
  });

  it("puts links on the page, for web and mail addresses only", () => {
    const pdf = read(
      toPdf([
        page([], {
          links: [
            { x: 10, y: 10, width: 40, height: 12, url: "https://pli.dev/a b" },
            { x: 10, y: 30, width: 40, height: 12, url: "mailto:a@b.co" },
            { x: 10, y: 50, width: 40, height: 12, url: "javascript:alert(1)" },
            { x: 10, y: 70, width: 40, height: 12, url: "#anchor" },
          ],
        }),
      ]),
    );
    const annots = [...pdf.objects.values()].filter((o) => o.dict.includes("/Subtype /Link"));
    expect(annots).toHaveLength(2);
    expect(annots[0]!.dict).toContain("/Rect [10 770 50 782]");
    expect(annots[0]!.dict).toContain("/URI (https://pli.dev/a b)");
    expect(pdf.text).not.toContain("javascript");
  });
});

describe("toPdf: pictures", () => {
  it("passes a JPEG through as it is", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = read(toPdf([page([{ type: "image", x: 10, y: 10, width: 100, height: 50, image: { jpeg, width: 4, height: 2, components: 3 } }])]));
    const image = [...pdf.objects.values()].find((o) => o.dict.includes("/DCTDecode"))!;
    expect([...image.stream!]).toEqual([...jpeg]);
    expect(image.dict).toContain("/ColorSpace /DeviceRGB");
    expect(contentOf(pdf)).toBe("q 100 0 0 50 10 732 cm /Im1 Do Q\n");
  });

  it("writes pixels as colors, with a separate alpha only when something is see-through", () => {
    const opaque = { rgba: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]), width: 2, height: 1 };
    const clear = { rgba: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 40]), width: 2, height: 1 };
    const a = read(toPdf([page([{ type: "image", x: 0, y: 0, width: 2, height: 1, image: opaque }])]));
    expect(a.text).not.toContain("/SMask");
    const colored = [...a.objects.values()].find((o) => o.dict.includes("/Subtype /Image"))!;
    expect([...colored.stream!]).toEqual([255, 0, 0, 0, 255, 0]);
    const b = read(toPdf([page([{ type: "image", x: 0, y: 0, width: 2, height: 1, image: clear }])]));
    const mask = [...b.objects.values()].find((o) => o.dict.includes("/DeviceGray"))!;
    expect([...mask.stream!]).toEqual([255, 40]);
    expect(b.text).toContain("/SMask");
  });

  it("writes a picture used twice once", () => {
    const image = { rgba: Uint8Array.from([0, 0, 0, 255]), width: 1, height: 1 };
    const draw = { type: "image" as const, x: 0, y: 0, width: 1, height: 1, image };
    const pdf = read(toPdf([page([draw, { ...draw, x: 5 }])]));
    expect([...pdf.objects.values()].filter((o) => o.dict.includes("/Subtype /Image"))).toHaveLength(1);
  });
});

describe("toPdf: embedded fonts", () => {
  const arial = "/System/Library/Fonts/Supplemental/Arial.ttf";
  it.skipIf(!existsSync(arial))("embeds a TrueType font and draws with its glyphs, so text beyond Latin-1 shows", () => {
    const bytes = new Uint8Array(readFileSync(arial));
    const font = parseTrueType(bytes);
    expect(font.name).toBe("ArialMT");
    expect(font.glyphFor("A".codePointAt(0)!)).toBeGreaterThan(0);
    expect(font.glyphFor("Ж".codePointAt(0)!)).toBeGreaterThan(0);
    expect((font.advance(font.glyphFor(65)) * 1000) / font.unitsPerEm).toBeCloseTo(667, -1);

    const warnings: string[] = [];
    const pdf = read(toPdf([page([{ type: "text", x: 10, y: 10, text: "AЖ", font: { family: "Arial" }, size: 12 }])], { fonts: { Arial: bytes }, warnings }));
    expect(warnings).toEqual([]);
    expect(pdf.text).toContain("/Subtype /Type0");
    expect(pdf.text).toContain("/Encoding /Identity-H");
    const content = contentOf(pdf);
    expect(content).toMatch(/<[0-9A-F]{8}> Tj/);
    const file = [...pdf.objects.values()].find((o) => o.dict.includes("/Length1"))!;
    expect(file.stream!.length).toBe(bytes.length);
    const map = [...pdf.objects.values()].find((o) => o.stream && strFromU8(o.stream, true).includes("beginbfchar"))!;
    expect(strFromU8(map.stream!, true)).toContain("<0416>");
  });

  it("refuses what isn't a TrueType font, and falls back to the standard font with a warning", () => {
    expect(() => parseTrueType(new Uint8Array(4))).toThrowError(/Not a usable TrueType font/);
    expect(() => parseTrueType(Uint8Array.from([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrowError(/PostScript outlines/);
    const warnings: string[] = [];
    const pdf = read(toPdf([page([{ type: "text", x: 0, y: 0, text: "x", font: { family: "Broken" }, size: 10 }])], { fonts: { Broken: new Uint8Array(40) }, warnings }));
    expect(pdf.text).toContain("/BaseFont /Helvetica ");
    expect(warnings.join(" ")).toMatch(/"Broken" couldn't be embedded/);
  });
});

describe("toPdf: clipping text, rectangles and lines, and a fixed date", () => {
  it("cuts text, a rectangle and a line off at a clip rectangle, as it does a picture", () => {
    const clip = { x: 10, y: 20, width: 100, height: 30 };
    const pdf = read(
      toPdf([
        page([
          { type: "text", x: 12, y: 40, text: "cut", font: { family: "Helvetica" }, size: 12, clip },
          { type: "rect", x: 0, y: 0, width: 300, height: 300, fill: "#ff0000", clip },
          { type: "line", x1: 0, y1: 25, x2: 300, y2: 25, clip },
          { type: "text", x: 12, y: 80, text: "whole", font: { family: "Helvetica" }, size: 12 },
        ]),
      ]),
    );
    const content = contentOf(pdf);
    // The page is 792 high: the clip's bottom is at 792 - 50 = 742.
    expect(content.match(/q 10 742 100 30 re W n/g)).toHaveLength(3);
    expect(content.match(/\nQ\n/g)).toHaveLength(2 + 1);
    expect(content).toMatch(/q 10 742 100 30 re W n\nBT [^\n]*Tj ET\nQ/);
    // The text with no clip is not wrapped in one.
    expect(content).toMatch(/\nBT [^\n]*Tm <776[0-9A-F]+> Tj ET\n$/);
  });

  it("writes the date it is given, so that the same pages make the same bytes", () => {
    const pages = [page([{ type: "text", x: 0, y: 0, text: "x", font: { family: "Helvetica" }, size: 10 }])];
    const date = new Date(Date.UTC(2026, 10, 10, 1, 2, 3));
    const a = toPdf(pages, { date });
    expect(strFromU8(a, true)).toContain("(D:20261110010203Z)");
    expect(Buffer.from(a).equals(Buffer.from(toPdf(pages, { date })))).toBe(true);
  });
});

describe("toPdf: transparency", () => {
  it("writes nothing extra for items without opacity, so existing pages come out as they did", () => {
    const items: PdfPage["items"] = [
      { type: "rect", x: 10, y: 20, width: 100, height: 50, fill: "#e5e7eb", stroke: "#000" },
      { type: "path", d: [["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["Z"]], fill: "#f00" },
      { type: "line", x1: 0, y1: 5, x2: 50, y2: 5 },
      { type: "text", x: 1, y: 2, text: "a", font: { family: "Arial" }, size: 10 },
    ];
    const same = items.map((item) => ({ ...item, opacity: 1, fillOpacity: 1, strokeOpacity: 1 }) as PdfPage["items"][number]);
    const plain = toPdf([page(items)], { date: new Date(0) });
    expect(plain).toEqual(toPdf([page(same)], { date: new Date(0) }));
    expect(strFromU8(plain, true)).not.toContain("ExtGState");
    expect(contentOf(read(plain))).not.toContain(" gs");
  });

  it("registers a graphics state per pair of opacities, and uses it inside q and Q", () => {
    const pdf = read(
      toPdf([
        page([
          { type: "rect", x: 10, y: 20, width: 100, height: 50, fill: "#ff0000", opacity: 0.5 },
          { type: "rect", x: 10, y: 20, width: 100, height: 50, fill: "#00ff00", opacity: 0.5 },
          { type: "path", d: [["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["Z"]], fill: "#0000ff", stroke: "#000000", fillOpacity: 0.25 },
        ]),
      ]),
    );
    const content = contentOf(pdf);
    expect(content).toContain("q /GS1 gs\n1 0 0 rg 10 722 100 50 re f\nQ\n");
    expect(content).toContain("q /GS1 gs\n0 1 0 rg 10 722 100 50 re f\nQ\n");
    expect(content).toMatch(/q \/GS2 gs 0 0 1 rg 0 0 0 RG 1 w 0 J 0 j 0 792 m 10 792 l 10 782 l h B Q/);
    const page0 = [...pdf.objects.values()].find((o) => /\/Type \/Page /.test(o.dict))!.dict;
    expect(page0).toContain("/ExtGState << /GS1 << /Type /ExtGState /ca 0.5 /CA 0.5 >> /GS2 << /Type /ExtGState /ca 0.25 /CA 1 >> >>");
  });

  it("fades the fill and the stroke separately, and multiplies opacity into both", () => {
    const content = contentOf(read(toPdf([page([{ type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#000", stroke: "#000", opacity: 0.5, fillOpacity: 0.5, strokeOpacity: 0.2 }])])));
    expect(content).toBe("q /GS1 gs\n0 0 0 rg 0 782 10 10 re f\n0 0 0 RG 1 w 0 782 10 10 re S\nQ\n");
    const pdf = read(toPdf([page([{ type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#000", stroke: "#000", opacity: 0.5, fillOpacity: 0.5, strokeOpacity: 0.2 }])]));
    expect([...pdf.objects.values()].some((o) => o.dict.includes("/ca 0.25 /CA 0.1"))).toBe(true);
  });

  it("makes lines, text and pictures translucent, and draws nothing that is fully clear", () => {
    const image = { rgba: Uint8Array.from([0, 0, 0, 255]), width: 1, height: 1 };
    const content = contentOf(
      read(
        toPdf([
          page([
            { type: "line", x1: 0, y1: 5, x2: 50, y2: 5, color: "#f00", opacity: 0.4 },
            { type: "text", x: 1, y: 2, text: "a", font: { family: "Arial" }, size: 10, opacity: 0.3 },
            { type: "image", x: 0, y: 0, width: 4, height: 4, image, opacity: 0.6 },
            { type: "rect", x: 0, y: 0, width: 4, height: 4, fill: "#f00", opacity: 0 },
          ]),
        ]),
      ),
    );
    expect(content).toContain("q /GS1 gs 1 0 0 RG 1 w [] 0 d 0 787 m 50 787 l S Q\n");
    expect(content).toMatch(/q \/GS2 gs BT \/F1 10 Tf 0 0 0 rg 100 Tz 1 0 0 1 1 790 Tm <61> Tj ET Q\n/);
    expect(content).toContain("q /GS3 gs 4 0 0 4 0 788 cm /Im1 Do Q\n");
    expect(content).not.toContain("1 0 0 rg");
  });

  it("does not let a dashed line dash the outline drawn after it", () => {
    const content = contentOf(
      read(
        toPdf([
          page([
            { type: "line", x1: 0, y1: 5, x2: 50, y2: 5, dash: [3, 2] },
            { type: "rect", x: 0, y: 0, width: 10, height: 10, stroke: "#000" },
          ]),
        ]),
      ),
    );
    expect(content).toContain("[] 0 d 0 0 0 RG 1 w 0 782 10 10 re S");
  });
});

describe("toPdf: turning text and pictures", () => {
  const numbers = (s: string) => s.split(" ").map(Number);
  const tm = (content: string) => numbers(/([-\d. ]+) Tm/.exec(content)![1]!.trim());

  it("turns text clockwise about its start point by default", () => {
    const [a, b, c, d, e, f] = tm(contentOf(read(toPdf([page([{ type: "text", x: 100, y: 200, text: "x", font: { family: "Arial" }, size: 10, rotate: 90 }])]))));
    expect(a).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(-1, 5); // the baseline runs down the page
    expect(c).toBeCloseTo(1, 5);
    expect(d).toBeCloseTo(0, 5);
    expect([e, f]).toEqual([100, 592]);
  });

  it("turns text about an origin, which moves where it starts", () => {
    // Start at (110, 200), centre at (100, 200): a quarter turn clockwise takes it to (100, 210), which is 582 up from the bottom of 792.
    const m = tm(contentOf(read(toPdf([page([{ type: "text", x: 110, y: 200, text: "x", font: { family: "Arial" }, size: 10, rotate: 90, origin: [100, 200] }])]))));
    expect(m[4]).toBeCloseTo(100, 3);
    expect(m[5]).toBeCloseTo(582, 3);
    const m45 = tm(contentOf(read(toPdf([page([{ type: "text", x: 0, y: 0, text: "x", font: { family: "Arial" }, size: 10, rotate: 45 }])]))));
    expect(m45[0]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(m45[1]).toBeCloseTo(-Math.SQRT1_2, 3);
  });

  it("leaves text upright when the turn is zero", () => {
    const content = contentOf(read(toPdf([page([{ type: "text", x: 1, y: 2, text: "x", font: { family: "Arial" }, size: 10, rotate: 0 }])])));
    expect(content).toContain("1 0 0 1 1 790 Tm");
  });

  it("draws a turned picture with a matrix that maps its corners clockwise", () => {
    const image = { rgba: Uint8Array.from([0, 0, 0, 255]), width: 1, height: 1 };
    // 20 wide, 10 tall, top left at (50, 100), turned a quarter about its centre (60, 105): it ends up 10 wide and 20 tall.
    const content = contentOf(read(toPdf([page([{ type: "image", x: 50, y: 100, width: 20, height: 10, image, rotate: 90, origin: [60, 105] }])])));
    const m = numbers(/q ([-\d. ]+) cm/.exec(content)![1]!);
    expect(m[0]).toBeCloseTo(0, 3);
    expect(m[1]).toBeCloseTo(-20, 3); // the picture's right direction points down the page
    expect(m[2]).toBeCloseTo(10, 3); // and its up direction points right
    expect(m[3]).toBeCloseTo(0, 3);
    // the picture's bottom left corner (50, 110) goes to (55, 95): the top left of the turned picture
    expect(m[4]).toBeCloseTo(55, 3);
    expect(m[5]).toBeCloseTo(792 - 95, 3);
  });

  it("mirrors a picture with a negative scale, keeps it in its box, and combines mirroring with a turn", () => {
    const image = { rgba: Uint8Array.from([0, 0, 0, 255]), width: 1, height: 1 };
    const flipped = contentOf(read(toPdf([page([{ type: "image", x: 10, y: 20, width: 40, height: 30, image, flipH: true, flipV: true }])])));
    expect(flipped).toBe("q -40 0 0 -30 50 772 cm /Im1 Do Q\n");
    const both = numbers(/q ([-\d. ]+) cm/.exec(contentOf(read(toPdf([page([{ type: "image", x: 10, y: 20, width: 40, height: 30, image, flipH: true, rotate: 180, origin: [30, 35] }])]))))![1]!);
    // mirrored, then half a turn about the box's centre: the same as mirroring top to bottom
    expect(both.map((v) => Math.round(v * 1000) / 1000)).toEqual([40, 0, 0, -30, 10, 772]);
  });

  it("cuts a picture to an outline and a rectangle in page coordinates, inside the transparency state", () => {
    const image = { rgba: Uint8Array.from([0, 0, 0, 255]), width: 1, height: 1 };
    const content = contentOf(
      read(toPdf([page([{ type: "image", x: 0, y: 0, width: 10, height: 10, image, opacity: 0.5, clip: { x: 1, y: 1, width: 5, height: 5 }, clipPath: [["M", 0, 0], ["L", 10, 0], ["L", 5, 10], ["Z"]] }])])),
    );
    expect(content).toBe("q /GS1 gs 1 786 5 5 re W n 0 792 m 10 792 l 5 782 l h W n 10 0 0 10 0 782 cm /Im1 Do Q\n");
  });
});

describe("toPdf: gradients", () => {
  it("fills a rectangle with a shading clipped to it, one function over the stops", () => {
    const pdf = read(
      toPdf([
        page([
          {
            type: "rect",
            x: 10,
            y: 20,
            width: 100,
            height: 50,
            gradient: { kind: "linear", from: [10, 20], to: [110, 20], stops: [{ at: 0, color: "#ff0000" }, { at: 0.5, color: "#00ff00" }, { at: 1, color: "#0000ff" }] },
          },
        ]),
      ]),
    );
    expect(contentOf(pdf)).toBe("q 10 722 100 50 re W n /Sh1 sh Q\n");
    const page0 = [...pdf.objects.values()].find((o) => /\/Type \/Page /.test(o.dict))!.dict;
    expect(page0).toContain("/Shading << /Sh1 << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [10 772 110 772] /Function << /FunctionType 3");
    expect(page0).toContain("/Bounds [0.5]");
    expect(page0).toContain("/C0 [1 0 0] /C1 [0 1 0]");
    expect(page0).not.toContain("ExtGState");
  });

  it("fades a gradient out with a luminosity mask and keeps a stroke on top of it", () => {
    const pdf = read(
      toPdf([
        page([
          {
            type: "path",
            d: [["M", 0, 0], ["L", 100, 0], ["L", 100, 100], ["Z"]],
            stroke: "#000000",
            strokeWidth: 2,
            gradient: { kind: "radial", center: [50, 50], radius: 40, stops: [{ at: 0, color: "#ffffff" }, { at: 1, color: "#ffffff", opacity: 0 }] },
            fillOpacity: 0.5,
          },
        ]),
      ]),
    );
    const content = contentOf(pdf);
    expect(content).toMatch(/^q \/GS1 gs 0 792 m 100 792 l 100 692 l h W n \/Sh1 sh Q\nq 0 0 0 RG 2 w 0 J 0 j 0 792 m [^\n]* S Q\n$/);
    const page0 = [...pdf.objects.values()].find((o) => /\/Type \/Page /.test(o.dict))!.dict;
    expect(page0).toMatch(/\/GS1 << \/Type \/ExtGState \/ca 0\.5 \/CA 1 \/SMask << \/Type \/Mask \/S \/Luminosity \/G \d+ 0 R >> >>/);
    expect(page0).toContain("/ShadingType 3 /ColorSpace /DeviceRGB /Coords [50 742 0 50 742 40]");
    const mask = [...pdf.objects.values()].find((o) => o.dict.includes("/Subtype /Form"))!;
    expect(mask.dict).toContain("/Group << /S /Transparency /CS /DeviceGray >>");
    expect(mask.dict).toContain("/ColorSpace /DeviceGray");
    expect(mask.dict).toContain("/C0 [1] /C1 [0]");
    expect(strFromU8(mask.stream!, true)).toBe("/Sh0 sh");
  });

  it("keeps stops in order and keeps the function valid when stops share a position or leave the ends open", () => {
    const text = strFromU8(
      toPdf([page([{ type: "rect", x: 0, y: 0, width: 10, height: 10, gradient: { kind: "linear", from: [0, 0], to: [10, 0], stops: [{ at: 0.6, color: "#000000" }, { at: 0.3, color: "#ffffff" }, { at: 0.3, color: "#ff0000" }] } }])], { compress: false }),
      true,
    );
    // padded at both ends, and the equal positions pushed apart so that the bounds climb
    const bounds = /\/Bounds \[([^\]]+)\]/.exec(text)![1]!.split(" ").map(Number);
    expect(bounds.length).toBe(3);
    for (let i = 1; i < bounds.length; i++) expect(bounds[i]!).toBeGreaterThan(bounds[i - 1]!);
    expect(bounds[0]!).toBeGreaterThan(0);
    expect(bounds[bounds.length - 1]!).toBeLessThan(1);
  });

  it("asks the viewer to smooth a picture that says so, and says nothing otherwise", () => {
    const rgba = Uint8Array.from([0, 0, 0, 100]);
    const smooth = read(toPdf([page([{ type: "image", x: 0, y: 0, width: 9, height: 9, image: { rgba, width: 1, height: 1, smooth: true } }])]));
    expect(smooth.text.match(/\/Interpolate true/g)).toHaveLength(2); // the colors and the alpha
    const plain = read(toPdf([page([{ type: "image", x: 0, y: 0, width: 9, height: 9, image: { rgba, width: 1, height: 1 } }])]));
    expect(plain.text).not.toContain("Interpolate");
  });
});
