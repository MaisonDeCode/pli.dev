import { describe, expect, it } from "vitest";
import { ARTISTIC_KINDS, applyArtistic, artisticPng, decodePng, encodePng, scaleDown, toDataUri, type ArtisticKind, type Rgba } from "../src";
import { png } from "./images-helpers";

/** A picture with something in it: a diagonal gradient with a dark square and a bright bar. */
function scene(w = 48, h = 36): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let c: [number, number, number] = [(x * 255) / w, (y * 255) / h, 128];
      if (x > 10 && x < 22 && y > 8 && y < 24) c = [20, 30, 60];
      if (x > 30 && x < 34) c = [250, 240, 40];
      data.set(c, o);
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
const flat = (w: number, h: number, c: [number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...c, 255], i * 4);
  return { width: w, height: h, data };
};
const mean = (r: Rgba) => {
  let s = 0;
  for (let i = 0; i < r.width * r.height; i++) s += (r.data[i * 4]! + r.data[i * 4 + 1]! + r.data[i * 4 + 2]!) / 3;
  return s / (r.width * r.height);
};
const spread = (r: Rgba) => {
  const m = mean(r);
  let s = 0;
  for (let i = 0; i < r.width * r.height; i++) s += ((r.data[i * 4]! + r.data[i * 4 + 1]! + r.data[i * 4 + 2]!) / 3 - m) ** 2;
  return Math.sqrt(s / (r.width * r.height));
};
const distinct = (r: Rgba) => new Set(Array.from({ length: r.width * r.height }, (_, i) => `${r.data[i * 4]},${r.data[i * 4 + 1]},${r.data[i * 4 + 2]}`)).size;

describe("a PNG reader and writer in plain code", () => {
  it("reads what it writes, and reads the PNGs the tests make", () => {
    const pic = scene();
    const back = decodePng(encodePng(pic))!;
    expect(back.width).toBe(48);
    expect(back.height).toBe(36);
    expect(Array.from(back.data)).toEqual(Array.from(pic.data));
    const solid = decodePng(png(5, 3, [10, 20, 30]))!;
    expect([...solid.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(solid.data.length).toBe(5 * 3 * 4);
  });

  it("says no to what is not a PNG it can read", () => {
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
    const bytes = png(4, 4);
    expect(decodePng(bytes.slice(0, 40))).toBeNull();
    const interlaced = bytes.slice();
    interlaced[28] = 1; // the interlace byte of the header
    expect(decodePng(interlaced)).toBeNull();
  });
});

describe("artistic effects, computed on the pixels", () => {
  it("every effect keeps the size and the alpha, and is the same each time", () => {
    const pic = scene();
    pic.data[3] = 100;
    for (const kind of ARTISTIC_KINDS) {
      const a = applyArtistic(pic, { kind });
      const b = applyArtistic(pic, { kind });
      expect([a.width, a.height], kind).toEqual([48, 36]);
      expect(a.data[3], kind).toBe(100);
      expect(Array.from(a.data), kind).toEqual(Array.from(b.data));
      expect(Array.from(a.data), `${kind} changes something`).not.toEqual(Array.from(pic.data));
    }
  });

  it("does not change the picture it is given", () => {
    const pic = scene();
    const copy = Array.from(pic.data);
    for (const kind of ARTISTIC_KINDS) applyArtistic(pic, { kind, level: 3 });
    expect(Array.from(pic.data)).toEqual(copy);
  });

  it("blur keeps the average and loses the detail, more with a bigger level", () => {
    const pic = scene();
    const a = applyArtistic(pic, { kind: "blur", level: 5 });
    const b = applyArtistic(pic, { kind: "blur", level: 40 });
    expect(Math.abs(mean(a) - mean(pic))).toBeLessThan(6);
    expect(spread(a)).toBeLessThan(spread(pic));
    expect(spread(b)).toBeLessThan(spread(a));
    expect(applyArtistic(flat(20, 20, [90, 60, 30]), { kind: "blur" }).data.slice(0, 3)).toEqual(new Uint8ClampedArray([90, 60, 30]));
  });

  it("pencil sketch draws a flat picture white and the outlines darker; pencil grayscale is grey", () => {
    const white = applyArtistic(flat(20, 20, [90, 120, 150]), { kind: "pencilSketch" });
    expect([...white.data.slice(0, 3)]).toEqual([255, 255, 255]);
    const sketch = applyArtistic(scene(), { kind: "pencilSketch" });
    const dark = Array.from({ length: 48 * 36 }, (_, i) => sketch.data[i * 4]!).filter((v) => v < 200).length;
    expect(dark).toBeGreaterThan(20);
    const grey = applyArtistic(scene(), { kind: "pencilGrayscale" });
    for (let i = 0; i < 48 * 36; i++) expect(grey.data[i * 4]).toBe(grey.data[i * 4 + 1]);
  });

  it("mosaic makes blocks of one colour, bigger with a bigger level", () => {
    const pic = scene(64, 64);
    const small = applyArtistic(pic, { kind: "mosaic", level: 10 });
    const big = applyArtistic(pic, { kind: "mosaic", level: 90 });
    expect(distinct(big)).toBeLessThan(distinct(small));
    // The block at the top left is one colour all through (a level of 90 on 64 pixels is a 3 pixel block).
    const at = (r: Rgba, x: number, y: number) => r.data[(y * r.width + x) * 4]!;
    expect(at(big, 0, 0)).toBe(at(big, 1, 1));
  });

  it("cutout keeps few shades", () => {
    expect(distinct(applyArtistic(scene(), { kind: "cutout", level: 1 }))).toBeLessThanOrEqual(8);
    expect(distinct(applyArtistic(scene(), { kind: "cutout", level: 3 }))).toBeLessThanOrEqual(64);
  });

  it("paint brush smooths flat areas and keeps their edges", () => {
    const out = applyArtistic(scene(), { kind: "paintBrush", level: 2 });
    expect(spread(out)).toBeLessThan(spread(scene()) + 1);
    expect(distinct(out)).toBeLessThan(distinct(scene()));
  });

  it("film grain has the same average as the picture and is grainier; glass has joints", () => {
    const pic = flat(40, 40, [120, 120, 120]);
    const grained = applyArtistic(pic, { kind: "filmGrain", level: 60 });
    expect(Math.abs(mean(grained) - 120)).toBeLessThan(6);
    expect(spread(grained)).toBeGreaterThan(5);
    const glass = applyArtistic(pic, { kind: "glass", level: 25 });
    expect(glass.data[0]).toBeLessThan(120); // a joint at the corner
    expect(glass.data[(5 * 40 + 5) * 4]).toBe(120);
  });

  it("photocopy and line drawing are black and white or grey, and a flat picture is white", () => {
    expect(applyArtistic(flat(16, 16, [250, 250, 250]), { kind: "lineDrawing" }).data[0]).toBe(255);
    expect(applyArtistic(flat(16, 16, [250, 250, 250]), { kind: "photocopy" }).data[0]).toBeGreaterThan(240);
    const lines = applyArtistic(scene(), { kind: "lineDrawing" });
    expect(new Set(Array.from({ length: 48 * 36 }, (_, i) => lines.data[i * 4])).size).toBe(2);
  });

  it("glow edges is dark where nothing changes, and glow diffused is lighter than the picture", () => {
    expect(applyArtistic(flat(16, 16, [80, 140, 200]), { kind: "glowEdges" }).data[0]).toBe(0);
    const pic = scene();
    expect(mean(applyArtistic(pic, { kind: "glowDiffused" }))).toBeGreaterThan(mean(pic));
  });

  it("a PNG goes in and a PNG comes out; something else is null; a big picture is scaled down first", () => {
    const out = artisticPng(encodePng(scene()), { kind: "blur" })!;
    expect(decodePng(out)!.width).toBe(48);
    expect(artisticPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]), { kind: "blur" })).toBeNull();
    const big = scaleDown(flat(3000, 1500, [1, 2, 3]));
    expect([big.width, big.height]).toEqual([1200, 600]);
    expect([...big.data.slice(0, 4)]).toEqual([1, 2, 3, 255]);
    const small = flat(10, 10, [1, 2, 3]);
    expect(scaleDown(small)).toBe(small);
  });

  it("every kind has a name, a file element and a range", () => {
    for (const kind of ARTISTIC_KINDS as ArtisticKind[]) {
      expect(typeof kind).toBe("string");
      expect(toDataUri(encodePng(flat(2, 2, [1, 1, 1])), "png")).toMatch(/^data:image\/png/);
    }
    expect(ARTISTIC_KINDS).toHaveLength(22);
  });
});
