import { describe, expect, it } from "vitest";
import { createPdf } from "../src/cos/writer";
import { PdfStream, isStream } from "../src/cos/objects";
import { decodePng, jpegInfo, makeImageXObject } from "../src/image";
import { makePng } from "./support/png";
import { unzlibSync } from "fflate";

const px = (r: ReturnType<typeof decodePng>, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];

describe("decodePng", () => {
  const gradient = (x: number, y: number) => [(x * 40) & 255, (y * 50) & 255, ((x + y) * 20) & 255];

  it("reads 8-bit RGB with every filter type", () => {
    const r = decodePng(makePng({ width: 6, height: 7, colorType: 2, depth: 8, sample: gradient }));
    expect([r.width, r.height]).toEqual([6, 7]);
    expect(px(r, 3, 4)).toEqual([...gradient(3, 4), 255]);
    expect(px(r, 5, 6)).toEqual([...gradient(5, 6), 255]);
  });

  it("reads RGBA, grey-alpha and 16-bit samples", () => {
    const rgba = decodePng(makePng({ width: 4, height: 4, colorType: 6, depth: 8, sample: (x, y) => [x * 60, y * 60, 9, 255 - x * 50] }));
    expect(px(rgba, 2, 3)).toEqual([120, 180, 9, 155]);
    const ga = decodePng(makePng({ width: 3, height: 3, colorType: 4, depth: 8, sample: (x, y) => [x * 100, y * 100] }));
    expect(px(ga, 2, 1)).toEqual([200, 200, 200, 100]);
    const deep = decodePng(makePng({ width: 3, height: 2, colorType: 2, depth: 16, sample: (x, y) => [x * 20000 + 255, y * 30000, 65535] }));
    expect(px(deep, 2, 1)).toEqual([(40255 >> 8) & 255, 30000 >> 8, 255, 255]);
  });

  it("reads palette images of 1, 2, 4 and 8 bits with transparency", () => {
    const palette = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [10, 20, 30],
    ];
    for (const depth of [2, 4, 8] as const) {
      const r = decodePng(makePng({ width: 5, height: 3, colorType: 3, depth, palette, trns: [255, 128], sample: (x, y) => [(x + y) % 4] }));
      expect(px(r, 1, 0)).toEqual([0, 255, 0, 128]);
      expect(px(r, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(px(r, 1, 2)).toEqual([10, 20, 30, 255]);
    }
    const one = decodePng(makePng({ width: 9, height: 2, colorType: 3, depth: 1, palette: palette.slice(0, 2), sample: (x) => [x % 2] }));
    expect(px(one, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(one, 7, 1)).toEqual([0, 255, 0, 255]);
  });

  it("reads 1, 2 and 4-bit grey and grey with a transparent colour", () => {
    const g4 = decodePng(makePng({ width: 5, height: 2, colorType: 0, depth: 4, sample: (x) => [x * 3] }));
    expect(px(g4, 4, 0)).toEqual([204, 204, 204, 255]);
    const key = decodePng(makePng({ width: 2, height: 1, colorType: 0, depth: 8, trns: [0, 7], sample: (x) => [x === 0 ? 7 : 200] }));
    expect(px(key, 0, 0)[3]).toBe(0);
    expect(px(key, 1, 0)[3]).toBe(255);
  });

  it("reads interlaced images the same as plain ones", () => {
    const spec = { width: 11, height: 9, colorType: 2 as const, depth: 8 as const, sample: gradient };
    const plain = decodePng(makePng(spec));
    const inter = decodePng(makePng({ ...spec, interlace: true }));
    expect(inter.data).toEqual(plain.data);
    const tiny = decodePng(makePng({ width: 1, height: 1, colorType: 6, depth: 8, interlace: true, sample: () => [1, 2, 3, 4] }));
    expect(px(tiny, 0, 0)).toEqual([1, 2, 3, 4]);
  });

  it("refuses what is not a PNG, and damaged data", () => {
    expect(() => decodePng(new Uint8Array(40))).toThrow(/PNG/);
    const good = makePng({ width: 4, height: 4, colorType: 2, depth: 8, sample: gradient });
    expect(() => decodePng(good.subarray(0, good.length - 30))).toThrow();
  });
});

describe("makeImageXObject", () => {
  it("stores colour and alpha separately, grey as grey, and sizes them", () => {
    const o = createPdf();
    const png = makePng({ width: 4, height: 2, colorType: 6, depth: 8, sample: (x) => [x * 60, x * 60, x * 60, x === 0 ? 0 : 255] });
    const img = makeImageXObject(o, { png });
    expect(img).toMatchObject({ width: 4, height: 2, alpha: true });
    const s = o.get(img.ref) as PdfStream;
    expect(isStream(s)).toBe(true);
    expect(s.dict.get("ColorSpace")?.toString()).toBe("/DeviceGray");
    const mask = o.get(s.dict.get("SMask")!) as PdfStream;
    expect([...unzlibSync(mask.data)]).toEqual([0, 255, 255, 255, 0, 255, 255, 255]);
    const opaque = makeImageXObject(o, { rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]), width: 2, height: 1 });
    const os = o.get(opaque.ref) as PdfStream;
    expect(os.dict.get("ColorSpace")?.toString()).toBe("/DeviceRGB");
    expect(os.dict.has("SMask")).toBe(false);
    expect([...unzlibSync(os.data)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses short pixel data and non-JPEGs", () => {
    const o = createPdf();
    expect(() => makeImageXObject(o, { rgba: new Uint8Array(3), width: 2, height: 2 })).toThrow();
    expect(() => makeImageXObject(o, { jpeg: new Uint8Array([1, 2, 3, 4]) })).toThrow(/JPEG/);
    expect(jpegInfo(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined();
  });
});
