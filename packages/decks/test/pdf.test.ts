import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { builtinTheme, createDeck, deckToPdf, paragraphsFromText, shape, slideFromLayout, toPdf, type Deck, type Element, type ShapeElement, type Slide, SIZE_WIDESCREEN } from "../src";

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

/** Text shown by `Tj` operators (hex strings of WinAnsi codes) in an uncompressed PDF. */
function shownText(pdf: string): string[] {
  return [...pdf.matchAll(/<([0-9A-F]+)> Tj/g)].map((m) => String.fromCharCode(...(m[1]!.match(/../g) ?? []).map((h) => parseInt(h, 16))));
}
const pageCount = (pdf: string) => (pdf.match(/\/Type \/Page\b(?!s)/g) ?? []).length;

function jpegBytes(width: number, height: number): Uint8Array {
  const b = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9];
  return new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function pngBytes(width: number, height: number, pixel: [number, number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel, y * (width * 4 + 1) + 1 + x * 4);
  const idat = zlibSync(raw);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (all.set(p, at), (at += p.length));
  return all;
}

const dataUri = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;

function everythingDeck(): Deck {
  const deck = createDeck({ size: SIZE_WIDESCREEN, master: builtinTheme("sunrise", SIZE_WIDESCREEN), title: "All features" });
  const master = deck.masters[0]!;
  const title = deck.slides[0]!;
  const t = title.elements.find((e) => e.type === "shape" && e.placeholder?.type === "ctrTitle") as ShapeElement;
  t.text = { paragraphs: paragraphsFromText("Quarterly review") };
  const content: Slide = slideFromLayout(master.layouts.find((l) => l.kind === "titleAndBody")!);
  const tt = content.elements.find((e) => e.type === "shape" && e.placeholder?.type === "title") as ShapeElement;
  tt.text = { paragraphs: paragraphsFromText("Highlights") };
  const bd = content.elements.find((e) => e.type === "shape" && e.placeholder?.type === "body") as ShapeElement;
  bd.text = { paragraphs: paragraphsFromText("First point\nSecond point with a longer line that wraps around the body area, because it keeps going and going") };
  const extra: Element[] = [
    shape("roundRect", { x: 60, y: 300, w: 180, h: 90 }, { fill: { gradient: { kind: "linear", angle: 0, stops: [{ at: 0, color: "#ff0000" }, { at: 1, color: "#0000ff" }] } }, line: { color: "#000000", width: 2, dash: "dash" }, shadow: { dx: 3, dy: 3 }, text: { paragraphs: paragraphsFromText("Shadowed box", { bold: true, color: "#ffffff" }), vAlign: "middle" } }),
    shape("ellipse", { x: 280, y: 300, w: 120, h: 90 }, { fill: { gradient: { kind: "radial", stops: [{ at: 0, color: "#ffffff" }, { at: 1, color: "#00aa44" }] } } }),
    shape("rightArrow", { x: 430, y: 300, w: 120, h: 60 }, { rotation: 20, fill: "#ffaa00", line: { color: "#553300", width: 1 } }),
    shape("star5", { x: 580, y: 300, w: 80, h: 80 }, { fill: "#c9a227" }),
    shape("line", { x: 60, y: 430, w: 200, h: 0 }, { line: { color: "#333333", width: 3, head: "oval", tail: "triangle" } }),
    shape("smileyFace", { x: 700, y: 300, w: 80, h: 80 }, { fill: "#ffe066", line: { color: "#000000", width: 1 } }),
    { type: "shape", id: "tb", geometry: "rect", x: 300, y: 420, w: 300, h: 60, textBox: true, text: { paragraphs: [{ runs: [{ text: "Visit " }, { text: "the site", marks: { link: "https://example.com/deck", underline: true, color: "#1155cc" } }, { text: " now", marks: { highlight: "#ffff00", strike: true } }] }] } },
    { type: "table", id: "tbl", x: 620, y: 410, w: 200, h: 60, columns: [100, 100], headerRow: true, rows: [{ h: 30, cells: [{ paragraphs: paragraphsFromText("Name") }, { paragraphs: paragraphsFromText("Value") }] }, { h: 30, cells: [{ paragraphs: paragraphsFromText("Alpha") }, { paragraphs: paragraphsFromText("42"), fill: "#eeeeee" }] }] },
    { type: "image", id: "jpg", x: 60, y: 130, w: 120, h: 60, src: dataUri("image/jpeg", jpegBytes(32, 16)), crop: { l: 0.1, r: 0.1 }, line: { color: "#000000", width: 1 } },
    { type: "image", id: "png", x: 200, y: 130, w: 60, h: 60, src: dataUri("image/png", pngBytes(4, 4, [200, 30, 30, 255])), rotation: 30, geometry: "ellipse" },
    { type: "group", id: "g", x: 700, y: 130, w: 60, h: 30, children: [shape("rect", { x: 700, y: 130, w: 30, h: 30 }, { fill: "#222222" }), shape("diamond", { x: 730, y: 130, w: 30, h: 30 }, { fill: "#888888" })] },
    shape("rect", { x: 10, y: 10, w: 50, h: 50 }, { fill: "#ff00ff", hidden: true, name: "hidden" }),
  ];
  content.elements.push(...extra);
  content.notes = "Remember to mention the roadmap.\nSecond note line.";
  deck.slides.push(content);
  return deck;
}

describe("deck PDF", () => {
  it("writes a real PDF with a page of the slide's size for each slide", async () => {
    const deck = everythingDeck();
    const { bytes } = await deckToPdf(deck, { compress: false });
    const pdf = text(bytes);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pageCount(pdf)).toBe(2);
    expect(pdf).toContain("/MediaBox [0 0 960 540]");
    expect(pdf).toContain("/Title");
    // compressed output is a real, smaller-or-equal file with the same pages
    const packed = text((await deckToPdf(deck)).bytes);
    expect(pageCount(packed)).toBe(2);
    expect(packed).toContain("/FlateDecode");
  });

  it("draws slide text, links, tables and shapes without warnings for what it can do", async () => {
    const { bytes, warnings } = await deckToPdf(everythingDeck(), { compress: false });
    expect(warnings).toEqual([]);
    const pdf = text(bytes);
    const shown = shownText(pdf).join("|");
    for (const s of ["Quarterly review", "Highlights", "First point", "Shadowed box", "Name", "Value", "Alpha", "42", "the site", "Second point"]) expect(shown).toContain(s);
    expect(shown).not.toContain("Click to add"); // prompts of empty placeholders are not printed
    expect(pdf).toContain("/Subtype /Link");
    expect(pdf).toContain("/URI (https://example.com/deck)");
    // gradients are shadings (one smooth function each, not stripes); shapes are paths with curves
    expect(pdf).toContain("/ShadingType 2");
    expect(pdf).toContain("/ShadingType 3");
    expect(pdf).toMatch(/ W n \/Sh\d+ sh Q/);
    expect(pdf).toMatch(/ c /);
    // dashed outline, a JPEG, and a picture cut to an ellipse and turned by the PDF itself
    expect(pdf).toContain("[");
    expect(pdf).toContain("/DCTDecode");
    expect(pdf).toMatch(/ h W n [-\d. ]+ cm \/Im\d+ Do Q/);
    // a shadow is translucent copies of the shape
    expect(pdf).toContain("/ExtGState");
    // the hidden square is not drawn: no magenta fill
    expect(pdf).not.toContain("1 0 1 rg");
  });

  it("draws arrowheads at the ends of lines", async () => {
    const count = async (head: "none" | "triangle", tail: "none" | "oval") => {
      const deck = createDeck();
      deck.slides[0]!.elements.push(shape("line", { x: 100, y: 100, w: 200, h: 50 }, { line: { color: "#ff0000", width: 3, head, tail } }));
      return (text((await deckToPdf(deck, { compress: false })).bytes).match(/ f Q\n/g) ?? []).length;
    };
    const plain = await count("none", "none");
    expect(await count("triangle", "none")).toBe(plain + 1);
    expect(await count("triangle", "oval")).toBe(plain + 2);
  });

  it("applies the slide's own colours to the background and text", async () => {
    const deck = createDeck({ master: builtinTheme("midnight", { width: 720, height: 405 }) });
    const t = deck.slides[0]!.elements[0] as ShapeElement;
    t.text = { paragraphs: paragraphsFromText("Night") };
    const pdf = text((await deckToPdf(deck, { compress: false })).bytes);
    expect(pdf).toContain("/MediaBox [0 0 720 405]");
    // the title is the theme's light text colour (#f2f5fa)
    expect(pdf).toMatch(/0\.949 0\.961 0\.98 rg[^\n]*Tj/);
  });

  it("chooses slides, leaves out skipped ones and makes notes pages", async () => {
    const deck = everythingDeck();
    deck.slides.push({ ...slideFromLayout(deck.masters[0]!.layouts[1]!), skipped: true });
    const all = text((await deckToPdf(deck, { compress: false })).bytes);
    expect(pageCount(all)).toBe(2);
    const only = text((await deckToPdf(deck, { compress: false, slides: [deck.slides[1]!.id] })).bytes);
    expect(pageCount(only)).toBe(1);
    const listed = text((await deckToPdf(deck, { compress: false, slides: [deck.slides[2]!.id] })).bytes);
    expect(pageCount(listed)).toBe(1);
    const notes = text((await deckToPdf(deck, { compress: false, notes: true })).bytes);
    expect(pageCount(notes)).toBe(2);
    expect(notes).toContain("/MediaBox [0 0 612 792]");
    expect(shownText(notes).join("|")).toContain("Remember to mention the roadmap.");
    expect(shownText(notes).join("|")).toContain("Notes");
  });

  it("splits long notes over extra pages", async () => {
    const deck = createDeck();
    deck.slides[0]!.notes = Array.from({ length: 80 }, (_, i) => `Note line number ${i}`).join("\n");
    const pdf = text((await deckToPdf(deck, { compress: false, notes: true })).bytes);
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(shownText(pdf).join("|")).toContain("Note line number 79");
  });

  it("is deterministic for a given date", async () => {
    const deck = everythingDeck();
    const date = new Date(Date.UTC(2026, 0, 2));
    const a = (await deckToPdf(deck, { date })).bytes;
    const b = (await deckToPdf(deck, { date })).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const sync = toPdf(deck, { date });
    expect(Buffer.from(sync.bytes).equals(Buffer.from(a))).toBe(true);
  });

  it("says what it can't do: unreadable pictures, and nothing for what it can (turned text, turned JPEGs)", async () => {
    const deck = createDeck();
    const s = deck.slides[0]!;
    s.elements.push(
      shape("rect", { x: 100, y: 100, w: 120, h: 40 }, { rotation: 15, fill: "#cccccc", text: { paragraphs: paragraphsFromText("Tilted") } }),
      { type: "image", id: "j", x: 300, y: 100, w: 80, h: 40, src: dataUri("image/jpeg", jpegBytes(16, 8)), rotation: 45, flipH: true, geometry: "ellipse" },
      { type: "image", id: "web", x: 400, y: 100, w: 80, h: 40, src: "https://example.com/a.png", alt: "Logo" },
      { type: "image", id: "gif", x: 500, y: 100, w: 80, h: 40, src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
    );
    const { bytes, warnings } = await deckToPdf(deck, { compress: false });
    expect(warnings.some((w) => /rotated shape/.test(w))).toBe(false);
    expect(warnings.some((w) => /JPEG/.test(w))).toBe(false);
    expect(warnings.filter((w) => /grey box/.test(w))).toHaveLength(2);
    expect(warnings.some((w) => w.includes("Logo"))).toBe(true);
    expect(shownText(text(bytes)).join("|")).toContain("Logo");
    expect(pageCount(text(bytes))).toBe(1);
  });

  it("warns once for the whole file about characters no font has, and says what to do", async () => {
    const deck = createDeck();
    deck.slides[0]!.elements.push(shape("rect", { x: 10, y: 10, w: 300, h: 40 }, { text: { paragraphs: paragraphsFromText("Γειά σου Γειά σου 你好 你好") } }));
    deck.slides.push(slideFromLayout(deck.masters[0]!.layouts[1]!));
    (deck.slides[1]!.elements[0] as ShapeElement).text = { paragraphs: paragraphsFromText("Ωmega 你好") };
    const { warnings } = await deckToPdf(deck, { compress: false });
    const lost = warnings.filter((w) => /no place in the fonts/.test(w));
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatch(/你/);
    expect(lost[0]).toMatch(/Pass fonts/);
  });

  it("draws text in a turned shape turned with it, and upside down when the shape is flipped top to bottom", async () => {
    const deck = createDeck();
    deck.slides[0]!.elements.push(
      shape("rect", { x: 100, y: 100, w: 200, h: 60 }, { rotation: 90, text: { paragraphs: paragraphsFromText("Sideways") } }),
      shape("rect", { x: 400, y: 100, w: 200, h: 60 }, { flipV: true, text: { paragraphs: paragraphsFromText("Upside") } }),
      shape("rect", { x: 400, y: 300, w: 200, h: 60 }, { flipH: true, text: { paragraphs: paragraphsFromText("Mirror") } }),
    );
    const pdf = text((await deckToPdf(deck, { compress: false })).bytes);
    const tm = (word: string) => {
      const m = new RegExp(`Tz ([-\\d. ]+) Tm <${[...word].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("")}> Tj`).exec(pdf)!;
      return m[1]!.trim().split(" ").map(Number);
    };
    const [a, b, c, d] = tm("Sideways");
    expect([a, b, c, d].map((v) => Math.round(v! * 1000) / 1000)).toEqual([0, -1, 1, 0]);
    const up = tm("Upside");
    expect(up.slice(0, 4).map((v) => Math.round(v * 1000) / 1000)).toEqual([-1, 0, 0, -1]);
    expect(tm("Mirror").slice(0, 4)).toEqual([1, 0, 0, 1]);
  });

  it("turns a picture with the PDF's own matrix, JPEG included, and mirrors it", async () => {
    const deck = createDeck();
    deck.slides[0]!.elements.push(
      { type: "image", id: "a", x: 100, y: 100, w: 80, h: 40, src: dataUri("image/jpeg", jpegBytes(16, 8)), rotation: 90 },
      { type: "image", id: "b", x: 300, y: 100, w: 80, h: 40, src: dataUri("image/jpeg", jpegBytes(16, 8)), flipH: true },
    );
    const pdf = text((await deckToPdf(deck, { compress: false })).bytes);
    const matrices = [...pdf.matchAll(/q ([-\d. ]+) cm \/Im1 Do Q/g)].map((m) => m[1]!.trim().split(" ").map(Number));
    expect(matrices).toHaveLength(2);
    // a quarter turn about the centre: the picture's right edge points down the page (b = -width) and its up points right (c = height)
    expect(matrices[0]!.slice(0, 4).map((v) => Math.round(v))).toEqual([0, -80, 40, 0]);
    // mirrored: a negative scale, with the picture's origin on its right edge
    expect(matrices[1]!.slice(0, 4)).toEqual([-80, 0, 0, 40]);
    expect(matrices[1]![4]).toBe(380);
  });

  it("keeps opacity as PDF transparency: fills, lines, text, pictures", async () => {
    const deck = createDeck();
    deck.slides[0]!.elements.push(
      shape("rect", { x: 100, y: 100, w: 120, h: 40 }, { fill: "#ff000040", line: { color: "#00000026", width: 3 }, text: { paragraphs: paragraphsFromText("Faint", { color: "#0000ff80" }) } }),
    );
    const pdf = text((await deckToPdf(deck, { compress: false })).bytes);
    // 0x40 / 255 = 0.251 for the fill and 0x26 / 255 = 0.149 for the outline, together in one state
    expect(pdf).toMatch(/\/ca 0\.251 \/CA 0\.149/);
    expect(pdf).toMatch(/\/ca 0\.502 \/CA 1/); // the text
    expect(pdf).toMatch(/q \/GS\d+ gs 1 0 0 rg 0 0 0 RG 3 w [^\n]* B Q/);
  });

  it("paints a gradient as a shading clipped to the shape, with a luminosity mask where stops fade out", async () => {
    const draw = async (stops: { at: number; color: string }[], kind: "linear" | "radial" = "radial") => {
      const deck = createDeck();
      deck.slides[0]!.elements.push(shape("rect", { x: 100, y: 100, w: 200, h: 200 }, { fill: { gradient: { kind, angle: 90, stops } } }));
      return text((await deckToPdf(deck, { compress: false })).bytes);
    };
    const fade = await draw([{ at: 0, color: "#ff3377ff" }, { at: 1, color: "#ff337700" }]);
    // a radial shading from the centre (200, 405 - 200 = 205) out to the frame's corners, painted inside the clipped rectangle
    expect(fade).toMatch(/\/ShadingType 3 [^\n]*\/Coords \[200 205 0 200 205 141\.421\]/);
    expect(fade).toMatch(/q \/GS\d+ gs [^\n]* h W n \/Sh\d+ sh Q/);
    // the fade is a soft mask: a form with a gray shading of the stops' opacities (1 down to 0)
    expect(fade).toMatch(/\/SMask << \/Type \/Mask \/S \/Luminosity \/G \d+ 0 R >>/);
    expect(fade).toMatch(/\/ColorSpace \/DeviceGray [^\n]*\/C0 \[1\] \/C1 \[0\]/);
    expect(fade).toContain("/Sh0 sh");
    // solid stops need no mask, and a vertical linear gradient runs top to bottom through the centre
    const solid = await draw([{ at: 0, color: "#ff0000" }, { at: 0.5, color: "#00ff00" }, { at: 1, color: "#0000ff" }], "linear");
    expect(solid).not.toContain("/SMask");
    expect(solid).toMatch(/\/ShadingType 2 [^\n]*\/Coords \[200 305 200 105\] [^\n]*\/FunctionType 3/);
  });

  it("draws a soft shadow as a blurred picture with an alpha channel under the shape, and a hard one as a single copy", async () => {
    const draw = async (blur: number, geometry = "ellipse") => {
      const deck = createDeck();
      deck.slides[0]!.elements.push(shape(geometry, { x: 100, y: 100, w: 200, h: 100 }, { fill: "#3366ff", shadow: { dx: 6, dy: 8, blur, color: "#00000066" } }));
      return text((await deckToPdf(deck, { compress: false })).bytes);
    };
    const blank = text((await deckToPdf(createDeck(), { compress: false })).bytes);
    const soft = await draw(16);
    const hard = await draw(0);
    expect(blank).not.toContain("/Subtype /Image");
    // soft: a picture with a soft mask and smoothing, then the shape; hard: no picture, a copy in the shadow's colour (0.4 opaque)
    expect(soft).toContain("/Subtype /Image");
    expect(soft).toContain("/SMask");
    expect(soft).toContain("/Interpolate true");
    expect(soft.indexOf("Do Q")).toBeLessThan(soft.indexOf("0.2 0.4 1 rg"));
    expect(hard).not.toContain("/Subtype /Image");
    expect(hard).toMatch(/q \/GS\d+ gs 0 0 0 rg [^\n]* c [^\n]* f Q\nq 0\.2 0\.4 1 rg/);
    expect(hard).toContain("/ca 0.4 /CA 1");
    // the hard copy is the shape's own outline moved by the offset: a rectangle's corner (100, 100) goes to (106, 108)
    expect((await draw(0, "rect"))).toMatch(/0 0 0 rg [^\n]* 106 297 m 306 297 l 306 197 l 106 197 l h f Q/);
  });

  it("draws the shadow of a blurred line as nested, fading copies of the line", async () => {
    const deck = createDeck();
    deck.slides[0]!.elements.push(shape("line", { x: 100, y: 100, w: 200, h: 0 }, { line: { color: "#000000", width: 2 }, shadow: { dx: 0, dy: 6, blur: 12, color: "#000000aa" } }));
    const pdf = text((await deckToPdf(deck, { compress: false })).bytes);
    const widths = [...pdf.matchAll(/ RG ([\d.]+) w 0 J 1 j/g)].map((m) => Number(m[1]));
    // the wide faint copies come first and the line itself, 2 wide, last
    expect(widths.length).toBeGreaterThanOrEqual(5);
    expect(widths[0]!).toBeGreaterThan(widths[widths.length - 2]!);
    expect(widths[widths.length - 1]).toBe(2);
  });

  it("uses the host's rasterizer, awaited, for pictures it can't read", async () => {
    const deck = createDeck();
    deck.slides[0]!.elements.push({ type: "image", id: "svg", x: 100, y: 100, w: 80, h: 40, src: "data:image/svg+xml;utf8,<svg/>" });
    const rgba = new Uint8Array(2 * 2 * 4).fill(255);
    const seen: string[] = [];
    const { bytes, warnings } = await deckToPdf(deck, {
      compress: false,
      rasterize: async (src) => (seen.push(src), { rgba, width: 2, height: 2 }),
    });
    expect(seen).toEqual(["data:image/svg+xml;utf8,<svg/>"]);
    expect(warnings).toEqual([]);
    expect(text(bytes)).toContain("/Subtype /Image");
    // a synchronous call can't await it, and says so
    const sync = toPdf(deck, { compress: false, rasterize: async () => ({ rgba, width: 2, height: 2 }) });
    expect(sync.warnings.some((w) => /asynchronous/.test(w))).toBe(true);
    const syncOk = toPdf(deck, { compress: false, rasterize: () => ({ rgba, width: 2, height: 2 }) });
    expect(syncOk.warnings.filter((w) => /grey box/.test(w))).toEqual([]);
  });

  it("writes every built-in theme at every size without trouble", async () => {
    for (const size of [{ width: 720, height: 405 }, { width: 720, height: 540 }]) {
      for (const name of ["simple-light", "chalk", "plum", "ocean"]) {
        const deck = createDeck({ size, master: builtinTheme(name, size) });
        for (const l of deck.masters[0]!.layouts.slice(1)) {
          const s = slideFromLayout(l);
          for (const e of s.elements) if (e.type === "shape") e.text = { paragraphs: paragraphsFromText("Sample") };
          deck.slides.push(s);
        }
        const { bytes, warnings } = await deckToPdf(deck, { compress: false });
        expect(warnings, name).toEqual([]);
        expect(pageCount(text(bytes))).toBe(9);
      }
    }
  });
});
