import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { PliError, encodeBase64 } from "@pli.dev/core";
import { fromPptx, resolveSlide, validateDeck, type Deck, type Element, type ShapeElement } from "../src";
import { PNG_1X1, classic43, editPptx, googleExport, para, powerpointTemplate, pic, rels, simpleDeck, sp, txBody, xfrm, xml } from "./fixtures/build-pptx";

const rect = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
const box = (id: number, name: string, extra = "", tx = "") => sp(id, name, { spPr: `${xfrm(914400, 914400, 1828800, 914400)}${rect}${extra}`, tx });
const readOne = (shapes: string, options?: Parameters<typeof simpleDeck>[1]) => fromPptx(simpleDeck([shapes], options));
const first = (deck: Deck): Element[] => deck.slides[0]!.elements;
const shapeAt = (deck: Deck, i = 0) => first(deck)[i] as ShapeElement;

function expectInvalid(fn: () => unknown, message?: RegExp): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PliError);
    expect((e as PliError).code).toBe("invalid_document");
    if (message) expect((e as PliError).message).toMatch(message);
    return;
  }
  throw new Error("expected a PliError");
}

describe("fromPptx robustness", () => {
  it("throws a clear invalid_document error for a non-zip and for a package with no presentation", () => {
    expectInvalid(() => fromPptx(new TextEncoder().encode("this is not a zip file")), /zip/);
    expectInvalid(() => fromPptx(new Uint8Array(0)), /zip/);
    expectInvalid(() => fromPptx(zipSync({ "hello.txt": strToU8("hi") })), /presentation\.xml/);
    expectInvalid(() => fromPptx(zipSync({ "ppt/presentation.xml": strToU8("<oops") })), /presentation/);
    expectInvalid(() => fromPptx(zipSync({ "ppt/presentation.xml": strToU8("<root/>") })), /presentation/);
  });

  it("recovers what it can from a truncated zip, with a warning", () => {
    const bytes = powerpointTemplate();
    const cut = bytes.slice(0, Math.floor(bytes.length * 0.7));
    const { deck, warnings } = fromPptx(cut);
    expect(warnings.some((w) => /damaged/i.test(w))).toBe(true);
    expect(() => validateDeck(deck)).not.toThrow();
    expect(deck.masters).toHaveLength(1);
    // a cut so early that the presentation part is lost cannot be read at all
    expectInvalid(() => fromPptx(bytes.slice(0, 40)));
  });

  it("warns about a missing slide part and keeps the others", () => {
    const bytes = editPptx(powerpointTemplate(), (p) => {
      delete p["ppt/slides/slide2.xml"];
    });
    const { deck, warnings } = fromPptx(bytes);
    expect(deck.slides).toHaveLength(2);
    expect(warnings.some((w) => /slide list is missing/.test(w))).toBe(true);
  });

  it("falls back to the first layout for a slide with no relationships", () => {
    const bytes = editPptx(powerpointTemplate(), (p) => {
      delete p["ppt/slides/_rels/slide2.xml.rels"];
    });
    const { deck, warnings } = fromPptx(bytes);
    expect(warnings.some((w) => /Slide 2.*layout/.test(w))).toBe(true);
    expect(deck.slides[1]!.layout).toBe(deck.masters[0]!.layouts[0]!.id);
    expect(deck.slides[1]!.notes).toBe("");
    expect(() => validateDeck(deck)).not.toThrow();
    for (const s of deck.slides) resolveSlide(deck, s);
  });

  it("uses default colours when the theme is missing, and warns about missing pictures", () => {
    const bytes = editPptx(powerpointTemplate(), (p) => {
      delete p["ppt/theme/theme1.xml"];
      delete p["ppt/media/image1.png"];
    });
    const { deck, warnings } = fromPptx(bytes);
    expect(warnings.some((w) => /no readable theme/.test(w))).toBe(true);
    expect(warnings.some((w) => /picture.*missing/.test(w))).toBe(true);
    expect(deck.slides[1]!.elements.some((e) => e.type === "image")).toBe(false);
    for (const s of deck.slides) resolveSlide(deck, s);
  });

  it("makes a master when the file has none, and a layout when a master lists none", () => {
    const noMaster = editPptx(classic43(), (p) => {
      for (const k of Object.keys(p)) if (/slideMasters|slideLayouts/.test(k)) delete p[k];
    });
    const { deck, warnings } = fromPptx(noMaster);
    expect(warnings.some((w) => /no readable slide master/.test(w))).toBe(true);
    expect(() => validateDeck(deck)).not.toThrow();
    for (const s of deck.slides) resolveSlide(deck, s);
  });

  it("copes with odd and huge numbers", () => {
    const { deck, warnings } = readOne(
      box(10, "Odd", "", txBody(`<a:p><a:pPr marL="NaN" indent="99999999999999999999999"><a:lnSpc><a:spcPct val="abc"/></a:lnSpc></a:pPr><a:r><a:rPr sz="99999999999" spc="1e99" baseline="zzz"/><a:t>Odd</a:t></a:r></a:p>`)) +
        sp(11, "Huge", { spPr: `<a:xfrm rot="99999999999999"><a:off x="-99999999999999999" y="1e30"/><a:ext cx="99999999999999999999" cy="-5"/></a:xfrm>${rect}` }) +
        sp(12, "Garbage", { spPr: `<a:xfrm rot="x"><a:off x="a" y="b"/><a:ext cx="c" cy="d"/></a:xfrm><a:prstGeom prst=""><a:avLst><a:gd name="adj" fmla="val bogus"/></a:avLst></a:prstGeom><a:ln w="-1"><a:solidFill><a:srgbClr val="zzz"/></a:solidFill></a:ln>` }),
    );
    expect(() => validateDeck(deck)).not.toThrow();
    for (const e of first(deck)) for (const k of ["x", "y", "w", "h", "rotation"] as const) if (e[k] !== undefined) expect(Number.isFinite(e[k])).toBe(true);
    const odd = shapeAt(deck);
    expect(odd.text!.paragraphs[0]!.runs[0]!.marks!.fontSize).toBeLessThanOrEqual(4000);
    resolveSlide(deck, deck.slides[0]!);
    expect(warnings).toBeInstanceOf(Array);
  });

  it("replaces unknown geometry with rectangles, and warns about charts and unknown relationships", () => {
    const chart = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="30" name="Sales chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId9"/></a:graphicData></a:graphic></p:graphicFrame>`;
    const smartArt = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="31" name="Diagram"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId5" r:lo="rId6" r:qs="rId7" r:cs="rId8"/></a:graphicData></a:graphic></p:graphicFrame>`;
    const ole = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="32" name="Object"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="Worksheet" r:id="rId10"><p:embed/>${pic(33, "Fallback", "rId2", [0, 0, 914400, 914400])}</p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`;
    const video = `<p:pic><p:nvPicPr><p:cNvPr id="34" name="Video"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rId11"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch/></p:blipFill><p:spPr>${xfrm(0, 914400, 914400, 914400)}</p:spPr></p:pic>`;
    const mc = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="cx1"><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="35" name="Funnel"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"/></a:graphic></p:graphicFrame></mc:Choice><mc:Fallback>${pic(36, "Chart picture", "rId2", [0, 2000000, 914400, 914400])}</mc:Fallback></mc:AlternateContent>`;
    const { deck, warnings } = readOne(chart + smartArt + ole + video + mc + box(40, "Plain"), {
      slideRels: [
        [
          { id: "rId2", type: "image", target: "../media/image1.png" },
          { id: "rId9", type: "http://example.com/unknown/type", target: "../charts/chart1.xml" },
          { id: "rId10", type: "oleObject", target: "../embeddings/oleObject1.bin" },
          { id: "rId11", type: "video", target: "file:///nonexistent.mp4", external: true },
          { id: "rId12", type: "http://example.com/other", target: "mailto:x@example.com", external: true },
        ],
      ],
      parts: { "ppt/media/image1.png": PNG_1X1 },
    });
    expect(warnings.some((w) => /chart/i.test(w))).toBe(true);
    expect(warnings.some((w) => /SmartArt/i.test(w))).toBe(true);
    expect(warnings.some((w) => /embedded object/i.test(w))).toBe(true);
    expect(warnings.some((w) => /audio\/video/i.test(w))).toBe(true);
    // the OLE object, the video poster and the mc fallback picture all became images
    expect(first(deck).filter((e) => e.type === "image")).toHaveLength(3);
    expect(first(deck).some((e) => e.type === "shape" && e.name === "Plain")).toBe(true);
    expect(() => validateDeck(deck)).not.toThrow();
  });

  it("isolates a slide whose XML is broken", () => {
    const bytes = editPptx(powerpointTemplate(), (p) => {
      p["ppt/slides/slide2.xml"] = "<p:sld><p:cSld>";
    });
    const { deck, warnings } = fromPptx(bytes);
    expect(deck.slides).toHaveLength(2);
    expect(warnings.some((w) => /slide2\.xml.*couldn't be read/.test(w))).toBe(true);
  });

  it("ignores DOCTYPE entities", () => {
    const bytes = editPptx(simpleDeck([box(10, "Text", "", txBody(para("&lol; and &amp; ok")))]), (p) => {
      p["ppt/slides/slide1.xml"] = `<!DOCTYPE p:sld [<!ENTITY lol "${"lol".repeat(1000)}">]>\n${p["ppt/slides/slide1.xml"] as string}`;
    });
    const { deck } = fromPptx(bytes);
    const text = shapeAt(deck).text!.paragraphs[0]!.runs[0]!.text;
    expect(text).toBe("&lol; and & ok");
  });

  it("refuses a file that unpacks past the limit", () => {
    const big = zipSync({ "ppt/presentation.xml": strToU8("<p:presentation xmlns:p='x'/>"), "ppt/media/big.png": new Uint8Array(3_000_000) });
    expectInvalid(() => fromPptx(big, { maxUnpackedBytes: 1_000_000 }), /too large/);
  });

  it("stops at a shape cap and a nesting cap", () => {
    const many = Array.from({ length: 10_050 }, (_, i) => box(100 + i, `S${i}`)).join("");
    const r1 = readOne(many);
    expect(first(r1.deck).length).toBe(10_000);
    expect(r1.warnings.some((w) => /more than 10000 shapes/.test(w))).toBe(true);
    let nested = box(9, "Leaf");
    for (let i = 0; i < 30; i++) nested = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${200 + i}" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>${nested}</p:grpSp>`;
    const r2 = readOne(nested);
    expect(r2.warnings.some((w) => /nested too deeply/.test(w))).toBe(true);
    expect(() => validateDeck(r2.deck)).not.toThrow();
  });

  it("drops dangerous links but keeps web and mail links", () => {
    const run = (rid: string, t: string) => `<a:r><a:rPr lang="en-US"><a:hlinkClick r:id="${rid}"/></a:rPr><a:t>${t}</a:t></a:r>`;
    const { deck, warnings } = readOne(box(10, "Links", "", txBody(`<a:p>${run("rId2", "bad")}${run("rId3", "web")}${run("rId4", "mail")}</a:p>`)), {
      slideRels: [
        [
          { id: "rId2", type: "hyperlink", target: "javascript:alert(1)", external: true },
          { id: "rId3", type: "hyperlink", target: "https://example.com/a?b=c&amp;d=e", external: true },
          { id: "rId4", type: "hyperlink", target: "mailto:team@example.com", external: true },
        ],
      ],
    });
    const runs = shapeAt(deck).text!.paragraphs[0]!.runs;
    expect(runs.map((r) => r.marks?.link)).toEqual([undefined, "https://example.com/a?b=c&d=e", "mailto:team@example.com"]);
    expect(warnings.some((w) => /javascript/.test(w))).toBe(true);
  });
});

describe("fromPptx details", () => {
  it("applies group rotation to the children and keeps them in slide coordinates", () => {
    const group = (rot: string) =>
      `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="50" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm ${rot}><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="1270000"/></a:xfrm></p:grpSpPr>${sp(51, "Child", { spPr: `${xfrm(0, 0, 1270000, 1270000)}${rect}` })}</p:grpSp>`;
    const { deck } = readOne(group('rot="5400000"'));
    const g = first(deck)[0]!;
    expect(g.type).toBe("group");
    const c = (g as { children: Element[] }).children[0]!;
    // a 100pt square centred at (50,50) in a 200 x 100 group centred at (100,50), turned a quarter clockwise: centre (100, 0)
    expect(c.x).toBeCloseTo(50, 3);
    expect(c.y).toBeCloseTo(-50, 3);
    expect(c.rotation).toBe(90);
    const flipped = readOne(group('flipH="1"')).deck;
    const fc = (first(flipped)[0] as { children: Element[] }).children[0]!;
    expect(fc.x).toBeCloseTo(100, 3);
    expect(fc.flipH).toBe(true);
  });

  it("reads colours with modifiers, alpha and theme references", () => {
    const { deck } = readOne(
      box(10, "A", '<a:solidFill><a:schemeClr val="tx2"><a:lumMod val="75000"/><a:lumOff val="25000"/></a:schemeClr></a:solidFill>') +
        box(11, "B", '<a:solidFill><a:srgbClr val="ff8800"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:ln w="38100"><a:solidFill><a:schemeClr val="accent2"><a:tint val="40000"/></a:schemeClr></a:solidFill><a:prstDash val="sysDot"/></a:ln>') +
        box(12, "C", '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:path path="circle"/></a:gradFill><a:effectLst><a:outerShdw blurRad="127000" dist="254000" dir="2700000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>') +
        box(13, "D", '<a:noFill/><a:ln><a:noFill/></a:ln>') +
        box(14, "E", '<a:blipFill><a:blip r:embed="rId2"/><a:tile/></a:blipFill>'),
      { slideRels: [[{ id: "rId2", type: "image", target: "../media/image1.png" }]], parts: { "ppt/media/image1.png": PNG_1X1 } },
    );
    const [a, b, c, d, e] = first(deck) as ShapeElement[];
    // classic43 maps tx2 to dk2
    expect(a!.fill).toEqual({ theme: "dk2", lumMod: 0.75, lumOff: 0.25 });
    expect(b!.fill).toBe("#ff880080");
    expect(b!.line).toMatchObject({ width: 3, dash: "sysDot", color: { theme: "accent2", tint: 0.6 } });
    expect(c!.fill).toMatchObject({ gradient: { kind: "radial" } });
    expect(c!.shadow).toMatchObject({ blur: 10, dx: expect.closeTo(10 * Math.SQRT1_2 * 2, 0), color: "#00000066" });
    expect(d!.fill).toBeNull();
    expect(d!.line).toBeNull();
    expect(e!.fill).toMatchObject({ image: { mode: "tile" } });
  });

  it("reads fields, hidden shapes, alt text, connectors and custom transitions", () => {
    const fld = `<a:p><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>7</a:t></a:fld><a:r><a:rPr lang="en-US"/><a:t> of </a:t></a:r><a:fld id="{2}" type="datetime1"><a:rPr lang="en-US"/><a:t>1/2/2030</a:t></a:fld></a:p>`;
    const { deck } = readOne(
      `<p:sp><p:nvSpPr><p:cNvPr id="10" name="Hidden" descr="A hidden box" hidden="1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 100, 100)}${rect}</p:spPr>${txBody(fld)}</p:sp>`,
      { slideTail: '<p:transition spd="fast"><p:wipe dir="l"/></p:transition>' },
    );
    const s = shapeAt(deck);
    expect(s).toMatchObject({ hidden: true, alt: "A hidden box" });
    const runs = s.text!.paragraphs[0]!.runs;
    expect(runs.map((r) => r.marks?.field)).toEqual(["slideNumber", undefined, "date"]);
    expect(runs[0]!.text).toBe("7");
    expect(deck.slides[0]!.transition).toEqual({ type: "wipe", direction: "right", duration: 500 });
  });

  it("applies a slide's own colour map override", () => {
    const { deck } = readOne(box(10, "Dark", '<a:solidFill><a:schemeClr val="bg1"/></a:solidFill>'), {});
    expect(shapeAt(deck).fill).toEqual({ theme: "lt1" });
    const overridden = editPptx(simpleDeck([box(10, "Dark", '<a:solidFill><a:schemeClr val="bg1"/></a:solidFill>')]), (p) => {
      p["ppt/slides/slide1.xml"] = (p["ppt/slides/slide1.xml"] as string).replace("<a:masterClrMapping/>", '<a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>');
    });
    expect(shapeAt(fromPptx(overridden).deck).fill).toEqual({ theme: "dk1" });
  });

  it("gives a picture placeholder the frame of its layout placeholder and keeps the link", () => {
    const withPic = `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture"/><p:cNvPicPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch/></p:blipFill><p:spPr/></p:pic>`;
    const { deck } = readOne(withPic, { slideRels: [[{ id: "rId2", type: "image", target: "../media/image1.png" }]], parts: { "ppt/media/image1.png": PNG_1X1 } });
    const img = first(deck)[0]!;
    expect(img.type).toBe("image");
    expect(img).toMatchObject({ x: 36, w: 648 });
    // it stays linked to the placeholder, so it takes the layout's shape too
    expect(img.placeholder).toBeDefined();
  });

  it("reads an svg picture, and skips parts that are not pictures", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const { deck, warnings } = readOne(pic(9, "Vector", "rId2", [0, 0, 100, 100]) + pic(10, "Sniffed", "rId3", [0, 200, 100, 100]) + pic(11, "Metafile", "rId4", [0, 400, 100, 100]), {
      slideRels: [[{ id: "rId2", type: "image", target: "../media/v.svg" }, { id: "rId3", type: "image", target: "../media/blob.dat" }, { id: "rId4", type: "image", target: "../media/m.emf" }]],
      parts: { "ppt/media/v.svg": svg, "ppt/media/blob.dat": PNG_1X1, "ppt/media/m.emf": new Uint8Array([1, 0, 0, 0]) },
    });
    const srcs = first(deck).map((e) => (e.type === "image" ? e.src.slice(0, 25) : ""));
    expect(srcs[0]).toBe("data:image/svg+xml;base64");
    // .dat is not a picture extension, so it is not read at all
    expect(first(deck).filter((e) => e.type === "image")).toHaveLength(2);
    expect(warnings.some((w) => /missing from the file/.test(w))).toBe(true);
    expect(warnings.some((w) => /EMF\/WMF/.test(w))).toBe(true);
  });

  it("reads a slide background from a theme reference, a layout that hides master shapes, and bullet variants", () => {
    const body = (pPr: string) => box(10, "B", "", txBody(`<a:p><a:pPr ${pPr}</a:pPr><a:r><a:rPr sz="2000"/><a:t>x</a:t></a:r></a:p>`));
    const bytes = editPptx(
      simpleDeck([
        body('marL="0"><a:lnSpc><a:spcPts val="3000"/></a:lnSpc><a:spcAft><a:spcPct val="50000"/></a:spcAft><a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="80000"/><a:buFont typeface="Wingdings"/><a:buChar char="§"/>') +
          body('><a:buAutoNum type="romanUcPeriod" startAt="4"/>') +
          body('><a:buNone/>'),
      ]),
      (p) => {
        p["ppt/slides/slide1.xml"] = (p["ppt/slides/slide1.xml"] as string).replace("<p:cSld>", '<p:cSld><p:bg><p:bgRef idx="1003"><a:schemeClr val="accent1"/></p:bgRef></p:bg>');
        p["ppt/slideLayouts/slideLayout2.xml"] = (p["ppt/slideLayouts/slideLayout2.xml"] as string).replace("<p:sldLayout ", '<p:sldLayout showMasterSp="0" ');
      },
    );
    const { deck } = fromPptx(bytes);
    expect(deck.slides[0]!.background).toMatchObject({ gradient: { kind: "linear", angle: 90, stops: [{ color: { theme: "accent1", tint: expect.closeTo(0.07, 5) } }, { color: { theme: "accent1", shade: expect.closeTo(0.37, 5) } }] } });
    expect(deck.masters[0]!.layouts[1]!.showMasterElements).toBe(false);
    const [a, b, c] = first(deck) as ShapeElement[];
    const pa = a!.text!.paragraphs[0]!;
    expect(pa).toMatchObject({ marL: 0, lineSpacing: 1.5, spaceAfter: 10, bullet: { type: "char", char: "▪", color: "#ff0000", size: 80 } });
    expect(pa.bullet).not.toHaveProperty("font");
    expect(b!.text!.paragraphs[0]!.bullet).toEqual({ type: "number", scheme: "romanUcPeriod", start: 4 });
    expect(c!.text!.paragraphs[0]!.bullet).toBeNull();
  });

  it("reads a SmartArt diagram from its drawing part as a group of shapes", () => {
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="31" name="Diagram"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2540000" cy="1270000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId5" r:lo="rId6" r:qs="rId7" r:cs="rId8"/></a:graphicData></a:graphic></p:graphicFrame>`;
    const data = xml('<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:extLst><a:ext xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rId9" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>');
    const drawing = xml(`<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp modelId="{1}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Step one</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>`);
    const { deck, warnings } = readOne(frame, {
      slideRels: [[{ id: "rId5", type: "diagramData", target: "../diagrams/data1.xml" }, { id: "rId9", type: "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing", target: "../diagrams/drawing1.xml" }]],
      parts: { "ppt/diagrams/data1.xml": data, "ppt/diagrams/drawing1.xml": drawing },
    });
    expect(warnings).toEqual([]);
    const g = first(deck)[0]!;
    expect(g.type).toBe("group");
    const kid = (g as { children: ShapeElement[] }).children[0]!;
    expect(kid).toMatchObject({ geometry: "roundRect", x: 100, y: 100, w: 100, h: 100, fill: "#4472c4" });
    expect(kid.text!.paragraphs[0]!.runs[0]!.text).toBe("Step one");
  });

  it("encodes big pictures exactly", () => {
    const big = new Uint8Array(100_003).map((_, i) => (i * 31 + 7) & 255);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    const { deck } = readOne(pic(9, "Big", "rId2", [0, 0, 100, 100]), { slideRels: [[{ id: "rId2", type: "image", target: "../media/big.png" }]], parts: { "ppt/media/big.png": big } });
    const img = first(deck)[0]!;
    expect(img.type === "image" && img.src).toBe(`data:image/png;base64,${encodeBase64(big)}`);
  });

  it("reads Google-style files end to end without warnings beyond the known ones", () => {
    const { warnings } = fromPptx(googleExport());
    expect(warnings.sort()).toEqual(
      [
        "Slide 3: a chart (\"Chart 3\") could not be read (its chart part is missing); an empty box stands in for it",
      ].sort(),
    );
  });

  it("reads a minimal file with no slides and an odd size", () => {
    const { deck, warnings } = fromPptx(
      editPptx(simpleDeck([]), (p) => {
        p["ppt/presentation.xml"] = (p["ppt/presentation.xml"] as string).replace(/cx="\d+" cy="\d+"/, 'cx="1" cy="-3"');
      }),
    );
    expect(deck.slides).toHaveLength(0);
    expect(deck.size).toEqual({ width: 960, height: 540 });
    expect(warnings.some((w) => /slide size/.test(w))).toBe(true);
    expect(() => validateDeck(deck)).not.toThrow();
  });

  it("reads slides listed out of file order and ignores unlisted slides", () => {
    const bytes = editPptx(classic43(), (p) => {
      p["ppt/presentation.xml"] = (p["ppt/presentation.xml"] as string).replace(/<p:sldIdLst>.*<\/p:sldIdLst>/, '<p:sldIdLst><p:sldId id="300" r:id="rId3"/></p:sldIdLst>');
    });
    const { deck } = fromPptx(bytes);
    expect(deck.slides).toHaveLength(1);
    expect(deck.title).toBe("Rules");
  });

  it("is not fooled by an x:rels file with bad content", () => {
    const bytes = editPptx(classic43(), (p) => {
      p["ppt/slides/_rels/slide1.xml.rels"] = xml("<Relationships><Relationship/><Relationship Id=\"rId1\"/></Relationships>");
      p["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = rels([]);
    });
    const { deck } = fromPptx(bytes);
    expect(deck.slides).toHaveLength(2);
    expect(() => validateDeck(deck)).not.toThrow();
  });
});
