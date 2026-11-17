import { describe, expect, it } from "vitest";
import { decodeGif, decodeImage, decodeJpeg } from "../src";
import { GIFS, JPEGS } from "./image-fixtures";

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

/** The mean and the greatest difference, over the colour channels, between the pixels read and the reference's. */
function compare(got: { width: number; height: number; data: Uint8ClampedArray }, ref: Uint8Array, channels: 3 | 4) {
  let sum = 0;
  let worst = 0;
  const n = got.width * got.height;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(got.data[i * 4 + c]! - ref[i * channels + c]!);
      sum += d;
      worst = Math.max(worst, d);
    }
  }
  return { mean: sum / (n * 3), worst };
}

describe("JPEG reader", () => {
  for (const [name, f] of Object.entries(JPEGS)) {
    it(`reads ${name} like libjpeg does`, () => {
      const got = decodeJpeg(bytes(f.file));
      expect(got).not.toBeNull();
      expect([got!.width, got!.height]).toEqual([f.w, f.h]);
      const { mean, worst } = compare(got!, bytes(f.ref), 3);

      // The rounding of the inverse transform and the way smaller colour planes are stretched differ a little from libjpeg's.
      expect(mean).toBeLessThan(0.6);
      expect(worst).toBeLessThanOrEqual(4);
    });
  }

  it("is found by decodeImage and refuses what isn't a JPEG", () => {
    expect(decodeImage(bytes(JPEGS["baseline444"]!.file))).not.toBeNull();
    expect(decodeJpeg(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(decodeJpeg(bytes(JPEGS["baseline444"]!.file).subarray(0, 40))).toBeNull();
    expect(decodeImage(new Uint8Array(10))).toBeNull();
  });

  it("shows what a cut-short file still holds", () => {
    const full = bytes(JPEGS["baseline444"]!.file);
    const got = decodeJpeg(full.subarray(0, Math.floor(full.length * 0.8)));
    expect(got).not.toBeNull();
    expect([got!.width, got!.height]).toEqual([JPEGS["baseline444"]!.w, JPEGS["baseline444"]!.h]);
  });
});

describe("GIF reader", () => {
  for (const [name, f] of Object.entries(GIFS)) {
    it(`reads ${name} like Pillow does`, () => {
      const got = decodeGif(bytes(f.file));
      expect(got).not.toBeNull();
      expect([got!.width, got!.height]).toEqual([f.w, f.h]);
      const ref = bytes(f.ref);
      let wrong = 0;
      for (let i = 0; i < f.w * f.h; i++) {
        // A see-through pixel has no colour to compare.
        if (got!.data[i * 4 + 3] !== ref[i * 4 + 3]) wrong++;
        else if (ref[i * 4 + 3] !== 0) for (let c = 0; c < 3; c++) if (got!.data[i * 4 + c] !== ref[i * 4 + c]) wrong++;
      }
      expect(wrong).toBe(0);
    });
  }

  it("has see-through pixels where the file says so, and refuses what isn't a GIF", () => {
    const got = decodeGif(bytes(GIFS["transparent"]!.file))!;
    expect([...got.data].filter((_, i) => i % 4 === 3).some((a) => a === 0)).toBe(true);
    expect(decodeGif(new Uint8Array(20))).toBeNull();
    expect(decodeImage(bytes(GIFS["plain"]!.file))).not.toBeNull();
  });
});
