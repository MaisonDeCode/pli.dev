import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { PdfName, PdfStream } from "../src/cos/objects";
import { createPdf } from "../src/cos/writer";
import { jpegInfo, makeImageXObject } from "../src/image";
import { finishPage, newPage } from "./support/build";
import { renderPdf } from "./support/render";

function jpeg(w: number, h: number, color: string): Uint8Array {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return new Uint8Array(c.toBuffer("image/jpeg"));
}

/** Just enough JPEG for the header reader: SOI, an optional Adobe marker, a frame header. */
function header(marker: number, components: number, adobe?: number, bits = 8): Uint8Array {
  const out = [0xff, 0xd8];
  if (adobe !== undefined) out.push(0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, adobe);
  out.push(0xff, marker, 0, 8 + components * 3, bits, 0, 20, 0, 30, components);
  for (let i = 0; i < components; i++) out.push(i + 1, 0x11, 0);
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

describe("JPEG pictures", () => {
  it("reads size and channels", () => {
    const info = jpegInfo(jpeg(24, 10, "#336699"))!;
    expect([info.width, info.height, info.components, info.bits]).toEqual([24, 10, 3, 8]);
    expect(jpegInfo(header(0xc0, 1))!.components).toBe(1);
    expect(jpegInfo(header(0xc2, 3))!.components).toBe(3);
    expect(jpegInfo(header(0xc3, 3))).toBeUndefined();
    expect(jpegInfo(header(0xc0, 2))).toBeUndefined();
    expect(jpegInfo(header(0xc0, 4, 2))).toMatchObject({ components: 4, adobe: true, transform: 2, width: 30, height: 20 });
  });

  it("passes the bytes through as DCTDecode", () => {
    const o = createPdf();
    const bytes = jpeg(8, 8, "#ff8800");
    const img = makeImageXObject(o, { jpeg: bytes });
    expect(img).toMatchObject({ width: 8, height: 8, alpha: false });
    const s = o.get(img.ref) as PdfStream;
    expect(s.data).toBe(bytes);
    expect(s.dict.get("Filter")).toBe(PdfName.of("DCTDecode"));
    expect(s.dict.get("ColorSpace")).toBe(PdfName.of("DeviceRGB"));
    expect(s.dict.has("Decode")).toBe(false);
  });

  it("inverts Adobe CMYK with a Decode array and uses DeviceGray for one channel", () => {
    const o = createPdf();
    const cmyk = o.get(makeImageXObject(o, { jpeg: header(0xc0, 4, 2) }).ref) as PdfStream;
    expect(cmyk.dict.get("ColorSpace")).toBe(PdfName.of("DeviceCMYK"));
    expect(cmyk.dict.get("Decode")).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    const plainCmyk = o.get(makeImageXObject(o, { jpeg: header(0xc0, 4) }).ref) as PdfStream;
    expect(plainCmyk.dict.has("Decode")).toBe(false);
    const gray = o.get(makeImageXObject(o, { jpeg: header(0xc0, 1) }).ref) as PdfStream;
    expect(gray.dict.get("ColorSpace")).toBe(PdfName.of("DeviceGray"));
  });

  it("refuses 12-bit and damaged JPEGs", () => {
    const o = createPdf();
    expect(() => makeImageXObject(o, { jpeg: header(0xc0, 3, undefined, 12) })).toThrow(/12 bits/);
    expect(() => makeImageXObject(o, { jpeg: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) })).toThrow(/JPEG/);
  });

  it("draws in the right place and colour with pdf.js", async () => {
    const t = newPage(100, 100);
    const img = makeImageXObject(t.overlay, { jpeg: jpeg(32, 32, "#00aa00") });
    t.content.drawXObject(t.res.xobject(img.ref), 20, 20, 30, 30);
    finishPage(t);
    const r = await renderPdf(t.overlay.rewrite(), 0, 2);
    const inside = r.pixel(35, 65); // page y 35 is from the bottom
    expect(inside[1]).toBeGreaterThan(130);
    expect(inside[0]).toBeLessThan(60);
    expect(r.pixel(10, 10)).toEqual([255, 255, 255, 255]);
    expect(r.pixel(35, 10)).toEqual([255, 255, 255, 255]);
  });
});
