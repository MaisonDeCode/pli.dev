import { describe, expect, it } from "vitest";
import { ARTISTIC, ARTISTIC_KINDS, applyArtistic, artisticPng, cleanArtistic, decodeImage, decodePng, encodePng, type ArtisticKind, type Rgba } from "../src";
import { GIFS, JPEGS } from "./image-fixtures";

const NEW: ArtisticKind[] = ["marker", "chalkSketch", "cement", "crisscrossEtching", "lightScreen", "pastelsSmooth", "plasticWrap", "texturizer", "watercolorSponge", "paintStrokes"];

/** A picture with something in it: a diagonal gradient with a dark square and a bright bar. */
function scene(w = 64, h = 48): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let c: [number, number, number] = [(x * 255) / w, (y * 255) / h, 128];
      if (x > 12 && x < 28 && y > 10 && y < 30) c = [20, 30, 60];
      if (x > 40 && x < 45) c = [250, 240, 40];
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
const isGrey = (r: Rgba) => Array.from({ length: r.width * r.height }).every((_, i) => r.data[i * 4] === r.data[i * 4 + 1] && r.data[i * 4 + 1] === r.data[i * 4 + 2]);

describe("the other ten artistic effects", () => {
  it("are all there, with Excel's element names and a range for each", () => {
    expect(ARTISTIC_KINDS).toHaveLength(22);
    for (const k of NEW) {
      expect(ARTISTIC_KINDS).toContain(k);
      const a = ARTISTIC[k];
      expect(a.element).toBe(`artistic${k[0]!.toUpperCase()}${k.slice(1)}`);
      expect(a.min).toBeLessThan(a.max);
      expect(a.usual).toBeGreaterThanOrEqual(a.min);
      expect(a.usual).toBeLessThanOrEqual(a.max);
    }
    expect(Object.values(ARTISTIC).map((a) => a.element)).toHaveLength(new Set(Object.values(ARTISTIC).map((a) => a.element)).size);
    expect(ARTISTIC.paintStrokes.attribute).toBe("intensity");
    expect(ARTISTIC.cement.attribute).toBe("crackSpacing");
    expect(ARTISTIC.lightScreen.attribute).toBe("gridSize");
    expect(ARTISTIC.watercolorSponge.attribute).toBe("brushSize");
  });

  it("keep the size and the alpha, change the picture, never the one given, and are the same each time", () => {
    const pic = scene();
    pic.data[3] = 100;
    const copy = Array.from(pic.data);
    for (const kind of NEW) {
      const a = applyArtistic(pic, { kind });
      const b = applyArtistic(pic, { kind });
      expect([a.width, a.height], kind).toEqual([64, 48]);
      expect(a.data[3], kind).toBe(100);
      expect(Array.from(a.data), kind).toEqual(Array.from(b.data));
      expect(Array.from(a.data), `${kind} changes something`).not.toEqual(copy);
      for (const level of [ARTISTIC[kind].min, ARTISTIC[kind].max]) expect(applyArtistic(pic, { kind, level }).data.length, `${kind} ${level}`).toBe(copy.length);
    }
    expect(Array.from(pic.data)).toEqual(copy);
  });

  it("a stronger level changes the picture more, or differently", () => {
    const pic = scene();
    for (const kind of NEW) {
      const lo = applyArtistic(pic, { kind, level: ARTISTIC[kind].min });
      const hi = applyArtistic(pic, { kind, level: ARTISTIC[kind].max });
      expect(Array.from(lo.data), kind).not.toEqual(Array.from(hi.data));
    }
  });

  it("marker keeps flat colour with dark outlines, and is more colourful than a plain smoothing", () => {
    const out = applyArtistic(scene(), { kind: "marker" });
    const darkest = Math.min(...Array.from({ length: 64 * 48 }, (_, i) => out.data[i * 4]! + out.data[i * 4 + 1]! + out.data[i * 4 + 2]!));
    expect(darkest).toBeLessThan(60);
    expect(distinct(out)).toBeLessThan(distinct(scene()));
  });

  it("chalk sketch and crisscross etching are grey, a flat picture is pale or white", () => {
    const chalk = applyArtistic(scene(), { kind: "chalkSketch" });
    const etch = applyArtistic(scene(), { kind: "crisscrossEtching" });
    expect(isGrey(chalk)).toBe(true);
    expect(isGrey(etch)).toBe(true);
    expect(mean(applyArtistic(flat(30, 30, [250, 250, 250]), { kind: "chalkSketch" }))).toBeGreaterThan(200);
    expect(mean(applyArtistic(flat(30, 30, [250, 250, 250]), { kind: "crisscrossEtching" }))).toBeGreaterThan(240);
    // Dark parts get more lines than light ones: the dark square is darker on average than the bright bar.
    const at = (x: number, y: number) => etch.data[(y * 64 + x) * 4]!;
    let dark = 0;
    let light = 0;
    for (let y = 12; y < 28; y++) for (let x = 14; x < 26; x++) dark += at(x, y);
    for (let y = 12; y < 28; y++) for (let x = 41; x < 44; x++) light += at(x, y) * 4;
    expect(dark / (16 * 12)).toBeLessThan(light / (16 * 12));
    // Black lines and white only.
    expect(new Set(Array.from({ length: 64 * 48 }, (_, i) => etch.data[i * 4])).size).toBeLessThanOrEqual(3);
  });

  it("cement gives a flat picture a texture and light screen draws a grid of squares", () => {
    expect(spread(applyArtistic(flat(40, 40, [120, 120, 120]), { kind: "cement" }))).toBeGreaterThan(3);
    const screen = applyArtistic(flat(60, 60, [200, 100, 50]), { kind: "lightScreen", level: 20 });
    const cell = Math.max(4, Math.round((20 * 60) / 1200) + 3);
    // The joints between squares are darker than the middles of them.
    const px = (x: number, y: number) => screen.data[(y * 60 + x) * 4]!;
    expect(px(cell * 2, cell * 2)).toBeLessThan(px(cell * 2 + Math.floor(cell / 2), cell * 2 + Math.floor(cell / 2)));
  });

  it("pastels smooth, texturizer and watercolor sponge keep the colours of the picture roughly", () => {
    const pic = scene();
    for (const kind of ["pastelsSmooth", "texturizer", "watercolorSponge"] as const) {
      const out = applyArtistic(pic, { kind });
      expect(Math.abs(mean(out) - mean(pic)), kind).toBeLessThan(60);
    }
    expect(spread(applyArtistic(flat(40, 40, [120, 120, 120]), { kind: "texturizer" }))).toBeGreaterThan(2);
  });

  it("plastic wrap adds bright highlights", () => {
    const pic = scene();
    const out = applyArtistic(pic, { kind: "plasticWrap", level: 4 });
    const bright = (r: Rgba) => Array.from({ length: r.width * r.height }).filter((_, i) => r.data[i * 4]! > 240 && r.data[i * 4 + 1]! > 240).length;
    expect(bright(out)).toBeGreaterThan(bright(pic));
  });

  it("paint strokes smooth along the picture's edges and leave a flat picture as it is", () => {
    const flatOut = applyArtistic(flat(30, 30, [90, 120, 150]), { kind: "paintStrokes" });
    expect(Math.abs(flatOut.data[0]! - 90)).toBeLessThan(12);
    expect(distinct(applyArtistic(scene(), { kind: "paintStrokes" }))).toBeGreaterThan(5);
  });

  it("are kept to their range", () => {
    for (const kind of NEW) {
      expect(cleanArtistic({ kind, level: ARTISTIC[kind].usual })).toEqual({ kind });
      expect(() => cleanArtistic({ kind, level: ARTISTIC[kind].max + 1 })).toThrow();
      expect(() => cleanArtistic({ kind, level: 0 })).toThrow();
    }
  });
});

describe("artistic effects on JPEG and GIF pictures", () => {
  const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

  it("a JPEG goes in and a PNG comes out, the same as the effect on the JPEG's own pixels", () => {
    const jpeg = bytes(JPEGS["baseline444"]!.file);
    const out = artisticPng(jpeg, { kind: "pencilSketch" })!;
    expect(out).not.toBeNull();
    const direct = applyArtistic(decodeImage(jpeg)!, { kind: "pencilSketch" });
    expect(Array.from(decodePng(out)!.data)).toEqual(Array.from(direct.data));
  });

  it("a GIF goes in and a PNG comes out, and a see-through GIF stays see-through", () => {
    const gif = bytes(GIFS["transparent"]!.file);
    const out = decodePng(artisticPng(gif, { kind: "blur" })!)!;
    expect(out.width).toBe(GIFS["transparent"]!.w);
    expect(Array.from({ length: out.width * out.height }).some((_, i) => out.data[i * 4 + 3] === 0)).toBe(true);
  });

  it("works for every effect on both kinds", () => {
    for (const kind of ARTISTIC_KINDS) {
      expect(artisticPng(bytes(JPEGS["baseline420"]!.file), { kind }), kind).not.toBeNull();
      expect(artisticPng(bytes(GIFS["plain"]!.file), { kind }), kind).not.toBeNull();
    }
    expect(encodePng(scene()).length).toBeGreaterThan(0);
  });
});
