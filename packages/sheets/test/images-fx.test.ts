import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ARTISTIC, ARTISTIC_KINDS, SheetSession, createWorkbook, decodeImage, decodePng, encodePng, fromXlsx, parseWorkbook, serializeWorkbook, toDataUri, toXlsx } from "../src";
import { lintPackage } from "./excel-check/lint";
import { GIFS, JPEGS } from "./image-fixtures";
import { png, pngUri } from "./images-helpers";
import { decodeJxr } from "../src/jxr";
import { JXR_FILES } from "./jxr-fixtures";
const bytesOf2 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const make = () => new SheetSession(createWorkbook("fx", ["Data", "Other"]));
const SRC = pngUri(40, 20);
const drawing = (s: SheetSession) => {
  const files = unzipSync(toXlsx(s.state));
  return { files, xml: strFromU8(files[Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!]!) };
};
/** The files of `xl/media` of a package: the pictures as drawn (PNG), and the HD Photo files that hold the originals. */
const mediaOf = (files: Record<string, Uint8Array>) => {
  const names = Object.keys(files).filter((k) => k.startsWith("xl/media/")).sort();
  return { all: names, drawn: names.filter((k) => /\.(png|jpeg|gif)$/.test(k)), layers: names.filter((k) => k.endsWith(".wdp")) };
};
const bytesOf = (uri: string) => Uint8Array.from(atob(uri.split(",")[1]!), (c) => c.charCodeAt(0));
/** A PNG with something in it, so an effect shows. */
const busy = () => {
  const data = new Uint8ClampedArray(30 * 20 * 4);
  for (let i = 0; i < 600; i++) data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4);
  return toDataUri(encodePng({ width: 30, height: 20, data }), "png");
};

describe("glow, soft edges, reflection and artistic effects", () => {
  it("are kept with the usual parts left out, and changed in one undoable step", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, glow: { color: "#4472C4", radius: 10, opacity: 0.4 }, softEdge: 0, reflection: { size: 0.5, blur: 3 }, artistic: { kind: "blur", level: 10 } });
    expect(s.images("Data")[0]!).toMatchObject({ glow: {}, reflection: { blur: 3 }, artistic: { kind: "blur" } });
    expect(s.images("Data")[0]!.softEdge).toBeUndefined();
    expect(s.images("Data")[0]!.artistic!.level).toBeUndefined();
    s.formatImage("Data", p.id, { glow: { color: "#ff0000", radius: 20, opacity: 0.8 }, softEdge: 12, reflection: { startOpacity: 0.7, endOpacity: 0.1, distance: 5, size: 0.3 }, artistic: { kind: "mosaic", level: 70 } });
    expect(s.images("Data")[0]!).toMatchObject({ glow: { color: "#ff0000", radius: 20, opacity: 0.8 }, softEdge: 12, reflection: { startOpacity: 0.7, endOpacity: 0.1, distance: 5, size: 0.3 }, artistic: { kind: "mosaic", level: 70 } });
    s.formatImage("Data", p.id, { glow: null, softEdge: null, reflection: null, artistic: null });
    const img = s.images("Data")[0]!;
    expect([img.glow, img.softEdge, img.reflection, img.artistic]).toEqual([undefined, undefined, undefined, undefined]);
    s.undo();
    expect(s.images("Data")[0]!.artistic!.kind).toBe("mosaic");
  });

  it("are checked", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC });
    expect(() => s.formatImage("Data", p.id, { glow: { color: "blue" } })).toThrow(/#rrggbb/);
    expect(() => s.formatImage("Data", p.id, { glow: { radius: 500 } })).toThrow(/glow/);
    expect(() => s.formatImage("Data", p.id, { glow: { opacity: 2 } })).toThrow(/opacity/);
    expect(() => s.formatImage("Data", p.id, { softEdge: -1 })).toThrow(/soft edges/);
    expect(() => s.formatImage("Data", p.id, { reflection: { size: 0 } })).toThrow(/size/);
    expect(() => s.formatImage("Data", p.id, { reflection: { startOpacity: 3 } })).toThrow(/start opacity/);
    expect(() => s.formatImage("Data", p.id, { artistic: { kind: "oil" as never } })).toThrow(/artistic effect/);
    expect(() => s.formatImage("Data", p.id, { artistic: { kind: "cutout", level: 9 } })).toThrow(/1 to 6/);
    expect(() => s.formatImage("Data", p.id, { artistic: { kind: "blur", level: 2.5 } })).toThrow(/whole number/);
  });

  it("are saved with the workbook, and a bad one is named", () => {
    const s = make();
    s.addImage("Data", { src: SRC, glow: { radius: 30 }, softEdge: 8, reflection: { distance: 4 }, artistic: { kind: "glass", level: 40 } });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.images![0]).toMatchObject({ glow: { radius: 30 }, softEdge: 8, reflection: { distance: 4 }, artistic: { kind: "glass", level: 40 } });
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].images[0].artistic = { kind: "nope" };
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/artistic/);
  });

  it("travel with a copy of the picture to another sheet", () => {
    const s = make();
    const p = s.addImage("Data", { src: SRC, glow: {}, softEdge: 4, artistic: { kind: "cutout", level: 2 } });
    expect(s.copyImage("Data", p.id, { sheet: "Other" })).toMatchObject({ glow: {}, softEdge: 4, artistic: { kind: "cutout", level: 2 } });
  });

  it("go into an XLSX file as glow, reflection and soft edges in the order the schema wants, and come back", () => {
    const s = make();
    s.addImage("Data", {
      src: SRC,
      glow: { color: "#336699", radius: 12, opacity: 0.5 },
      shadow: { blur: 4 },
      reflection: { blur: 2, startOpacity: 0.6, endOpacity: 0.05, distance: 3, size: 0.4 },
      softEdge: 7.5,
    });
    const { xml, files } = drawing(s);
    expect(xml).toContain('<a:glow rad="114300"><a:srgbClr val="336699"><a:alpha val="50000"/></a:srgbClr></a:glow>');
    expect(xml).toContain('<a:softEdge rad="71438"/>');
    expect(xml).toMatch(/<a:reflection blurRad="19050" stA="60000" endA="5000" endPos="40000" dist="28575" dir="5400000" fadeDir="5400000" sx="100000" sy="-100000"[^>]*\/>/);
    expect(xml.indexOf("<a:glow")).toBeLessThan(xml.indexOf("<a:outerShdw"));
    expect(xml.indexOf("<a:outerShdw")).toBeLessThan(xml.indexOf("<a:reflection"));
    expect(xml.indexOf("<a:reflection")).toBeLessThan(xml.indexOf("<a:softEdge"));
    expect(lintPackage(toXlsx(s.state))).toEqual([]);
    expect(Object.keys(files).filter((k) => k.startsWith("xl/media/"))).toHaveLength(1);
    const img = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!;
    expect(img).toMatchObject({ glow: { color: "#336699", radius: 12, opacity: 0.5 }, softEdge: 7.5, reflection: { blur: 2, startOpacity: 0.6, endOpacity: 0.05, distance: 3, size: 0.4 } });
  });

  it("read a glow and a line in a theme colour, as the theme's colour", () => {
    const s = make();
    s.addImage("Data", { src: SRC, glow: { color: "#336699" } });
    const bytes = toXlsx(s.state);
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    files[name] = new TextEncoder().encode(strFromU8(files[name]!).replace(/<a:srgbClr val="336699">(.*?)<\/a:srgbClr>/, '<a:schemeClr val="accent2">$1</a:schemeClr>'));
    
    const img = fromXlsx(zipSync(files)).workbook.sheets[0]!.images![0]!;
    expect(img.glow!.color).toBe("#ed7d31");
  });

  it("go into an XLSX file with an artistic effect as the picture drawn and the original, as an HD Photo, with the effect, and come back as the original", () => {
    const s = make();
    const src = busy();
    s.addImage("Data", { src, artistic: { kind: "blur", level: 20 }, grayscale: true });
    const { xml, files } = drawing(s);
    // the layer is the HD Photo file, the way Excel keeps it
    expect(xml).toMatch(/<a14:imgLayer r:embed="rId\d+"><a14:imgEffect><a14:artisticBlur radius="20"\/><\/a14:imgEffect><\/a14:imgLayer>/);
    expect(xml).toContain('{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}');
    expect(xml).toContain('<a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/>');
    expect(xml.indexOf("<a:grayscl/>")).toBeLessThan(xml.indexOf("<a:extLst>"));
    const media = mediaOf(files);
    expect(media.drawn).toHaveLength(1);
    expect(media.layers).toEqual([expect.stringMatching(/^xl\/media\/hdphoto\d+\.wdp$/)]);
    const rels = strFromU8(files[Object.keys(files).find((k) => /drawings\/_rels\/drawing\d+\.xml\.rels$/.test(k))!]!);
    expect(rels).toContain(`Type="http://schemas.microsoft.com/office/2007/relationships/hdphoto" Target="../media/${media.layers[0]!.slice("xl/media/".length)}"`);
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain('<Default Extension="wdp" ContentType="image/vnd.ms-photo"/>');
    const drawn = decodePng(files[media.drawn[0]!]!)!;
    const original = decodeJxr(files[media.layers[0]!]!)!;
    expect(original.data).toEqual(decodePng(bytesOf(src))!.data);
    expect(drawn.data).not.toEqual(original.data);
    expect(lintPackage(toXlsx(s.state))).toEqual([]);
    const img = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!;
    expect(decodePng(bytesOf(img.src))!.data).toEqual(decodePng(bytesOf(src))!.data);
    expect(img).toMatchObject({ artistic: { kind: "blur", level: 20 }, grayscale: true });
  });

  it("go into an XLSX file plain when the pixels of the picture can't be read here", () => {
    // A JPEG that says it uses arithmetic coding (which Pli doesn't read) can't be drawn, so it is written as it is.
    const jpeg = Uint8Array.from(atob(JPEGS["baseline444"]!.file), (c) => c.charCodeAt(0));
    const at = jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xc0);
    jpeg[at + 1] = 0xc9;
    const s = make();
    s.addImage("Data", { src: toDataUri(jpeg, "jpeg"), width: 20, height: 20, artistic: { kind: "blur" } });
    const { xml, files } = drawing(s);
    expect(xml).not.toContain("imgProps");
    expect(mediaOf(files).all).toHaveLength(1);
    expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!.artistic).toBeUndefined();
  });

  for (const [type, fixture] of [["jpeg", JPEGS["baseline420"]!], ["gif", GIFS["plain"]!]] as const) {
    it(`go into an XLSX file with an artistic effect on a ${type.toUpperCase()}: the picture drawn as a PNG, the original with the effect, and come back as the original`, () => {
      const src = `data:image/${type};base64,${fixture.file}`;
      const s = make();
      s.addImage("Data", { src, width: 94, height: 62, artistic: { kind: "pencilSketch", level: 40 } });
      const { xml, files } = drawing(s);
      expect(xml).toContain("<a14:artisticPencilSketch pressure=\"40\"/>");
      const media = mediaOf(files);
      expect(media.drawn).toEqual([expect.stringMatching(/\.png$/)]);
      expect(media.layers).toHaveLength(1);
      const drawn = decodePng(files[media.drawn[0]!]!)!;
      expect([drawn.width, drawn.height]).toEqual([fixture.w, fixture.h]);
      const original = decodeJxr(files[media.layers[0]!]!)!;
      // the original is kept exactly as the pixels the picture has
      expect(original.data).toEqual(decodeImage(bytesOf(src))!.data);
      expect(drawn.data).not.toEqual(original.data);
      expect(lintPackage(toXlsx(s.state))).toEqual([]);
      const back = fromXlsx(toXlsx(s.state));
      // (it comes back as a PNG of those pixels)
      expect(decodePng(bytesOf(back.workbook.sheets[0]!.images![0]!.src))!.data).toEqual(original.data);
      expect(back.workbook.sheets[0]!.images![0]!.artistic).toEqual({ kind: "pencilSketch", level: 40 });
      expect(back.warnings).toEqual([]);
    });
  }

  it("every artistic effect goes into an XLSX file and comes back with its level, for PNG, JPEG and GIF", () => {
    for (const kind of ARTISTIC_KINDS) {
      const level = ARTISTIC[kind].max;
      for (const src of [busy(), `data:image/jpeg;base64,${JPEGS["baseline444"]!.file}`, `data:image/gif;base64,${GIFS["plain"]!.file}`]) {
        const s = make();
        s.addImage("Data", { src, width: 40, height: 30, artistic: { kind, level } });
        const { xml } = drawing(s);
        expect(xml, kind).toContain(`<a14:${ARTISTIC[kind].element} ${ARTISTIC[kind].attribute}="${level}"/>`);
        const back = fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.images![0]!;
        expect(back, kind).toMatchObject({ artistic: { kind, level } });
        expect(decodePng(bytesOf(back.src))!.data, kind).toEqual(decodeImage(bytesOf(src))!.data);
      }
    }
  });

  it("are read from an Excel file whose layer Pli can't read as the picture Excel drew, with a warning", () => {
    const s = make();
    s.addImage("Data", { src: busy(), artistic: { kind: "mosaic", level: 30 } });
    const files = unzipSync(toXlsx(s.state));
    const layer = mediaOf(files).layers[0]!;
    files[layer] = new Uint8Array([0x49, 0x49, 0xbc, 1, 8, 0, 0, 0]); // the start of a .wdp, not a picture Pli reads

    const back = fromXlsx(zipSync(files));
    expect(back.workbook.sheets[0]!.images![0]!.artistic).toBeUndefined();
    expect(back.warnings.join(" ")).toMatch(/artistic effect/);
  });

  it("are read from an Excel file whose layer is an HD Photo written by another encoder, as that picture", () => {
    for (const name of ["rgbLossless", "rgbaLossless"]) {
      const s = make();
      s.addImage("Data", { src: busy(), artistic: { kind: "mosaic", level: 30 } });
      const files = unzipSync(toXlsx(s.state));
      const theirs = bytesOf2(JXR_FILES[name]!.file);
      files[mediaOf(files).layers[0]!] = theirs;
      const back = fromXlsx(zipSync(files));
      const img = back.workbook.sheets[0]!.images![0]!;
      expect(img.artistic).toEqual({ kind: "mosaic", level: 30 });
      expect(back.warnings).toEqual([]);
      const pixels = decodePng(bytesOf(img.src))!;
      expect(pixels.data).toEqual(decodeJxr(theirs)!.data);
      if (name === "rgbaLossless") expect(pixels.data[3]).not.toBe(255);
    }
  });

  it("is checked by the package check: the layer of an effect must be an HD Photo by the relationship made for it", () => {
    const s = make();
    s.addImage("Data", { src: busy(), artistic: { kind: "blur" } });
    const files = unzipSync(toXlsx(s.state));
    expect(lintPackage(zipSync(files))).toEqual([]);
    const rels = Object.keys(files).find((k) => /drawings\/_rels\/drawing\d+\.xml\.rels$/.test(k))!;
    files[rels] = strToU8(strFromU8(files[rels]!).replace("http://schemas.microsoft.com/office/2007/relationships/hdphoto", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"));
    expect(lintPackage(zipSync(files)).join(" ")).toMatch(/isn't an HD Photo/);
  });

  it("an effect Excel has and Pli does not is read as the picture Excel drew, with a warning", () => {
    const s = make();
    s.addImage("Data", { src: busy(), artistic: { kind: "blur" } });
    const files = unzipSync(toXlsx(s.state));
    const name = Object.keys(files).find((k) => /xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    files[name] = new TextEncoder().encode(strFromU8(files[name]!).replace('<a14:artisticBlur radius="10"/>', '<a14:artisticSomethingNew size="20"/>'));
    
    const back = fromXlsx(zipSync(files));
    expect(back.workbook.sheets[0]!.images![0]!.artistic).toBeUndefined();
    expect(back.warnings.join(" ")).toMatch(/artistic effect/);
  });
});

describe("cropping to a shape", () => {
  const picture = (s: SheetSession, w = 100, h = 50, extra: object = {}) => s.addImage("Data", { src: toDataUri(png(w, h), "png"), width: w, height: h, ...extra });

  it("crops to a ratio from the middle, keeping the picture's scale", () => {
    const s = make();
    const p = picture(s);
    s.cropImageToRatio("Data", p.id, "1:1");
    const a = s.images("Data")[0]!;
    expect(a.crop!.left).toBeCloseTo(0.25, 4);
    expect(a.crop!.right).toBeCloseTo(0.25, 4);
    expect(a.crop!.top).toBeUndefined();
    expect([a.width, a.height]).toEqual([50, 50]);
    s.cropImageToRatio("Data", p.id, 2);
    expect([s.images("Data")[0]!.width, s.images("Data")[0]!.height]).toEqual([100, 50]);
    expect(s.images("Data")[0]!.crop).toBeUndefined();
    s.cropImageToRatio("Data", p.id, "4:3");
    const c = s.images("Data")[0]!;
    expect(c.width / c.height).toBeCloseTo(4 / 3, 1);
    s.undo();
    expect(s.images("Data")[0]!.crop).toBeUndefined();
  });

  it("crops a tall picture at the top and bottom, and one already cropped keeps its scale", () => {
    const s = make();
    const p = picture(s, 40, 80);
    s.cropImageToRatio("Data", p.id, "16:9");
    const a = s.images("Data")[0]!;
    expect(a.crop!.top).toBeGreaterThan(0.3);
    expect(a.crop!.left).toBeUndefined();
    expect([a.width, a.height]).toEqual([40, 23]);
    const q = picture(s, 100, 50, { crop: { left: 0.5 }, width: 50, height: 50 });
    s.cropImageToRatio("Data", q.id, "16:9");
    const b = s.images("Data").find((x) => x.id === q.id)!;
    expect([b.width, b.height]).toEqual([89, 50]); // the whole picture is 100 by 50 on the sheet; 16:9 of it is 89 wide
  });

  it("fills the frame it is in, or fits inside it", () => {
    const s = make();
    const p = picture(s, 100, 50, { width: 60, height: 60 });
    s.cropImageToRatio("Data", p.id, "fill");
    const a = s.images("Data")[0]!;
    expect([a.width, a.height]).toEqual([60, 60]);
    expect(a.crop!.left).toBeCloseTo(0.25, 4);
    s.cropImageToRatio("Data", p.id, "fit");
    const b = s.images("Data")[0]!;
    expect(b.crop).toBeUndefined();
    expect([b.width, b.height]).toEqual([60, 30]);
  });

  it("says what a shape can be", () => {
    const s = make();
    const p = picture(s);
    expect(() => s.cropImageToRatio("Data", p.id, "wide")).toThrow(/crop shape/);
    expect(() => s.cropImageToRatio("Data", p.id, 0)).toThrow(/crop shape/);
    expect(() => s.cropImageToRatio("Data", "nope", 1)).toThrow(/No picture/);
  });
});
