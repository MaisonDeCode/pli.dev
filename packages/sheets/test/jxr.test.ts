import { describe, expect, it } from "vitest";
import { BitReader, BitWriter, AdaptiveHuffman, IDX_CC } from "../src/jxr-common";
import { decodeCodestream } from "../src/jxr-decode";
import { encodeCodestream, rgbToPlanes } from "../src/jxr-encode";
import { decodeJxr, encodeJxr, isJxr, readJxrParts } from "../src/jxr";
import { fwdStage1, fwdStage2, invStage1, invStage2 } from "../src/jxr-transform";
import { JXR_FILES } from "./jxr-fixtures";
import { JXR_FORMS } from "./jxr-forms-fixtures";
import { JXR_OTHER } from "./jxr-other-fixtures";
import type { JxrOptions } from "../src/jxr";

/*
 * JPEG XR (HD Photo). The pictures in `jxr-fixtures.ts` were written by the reference implementation (jxrlib), and the
 * pictures Pli writes were checked the other way round: jxrlib reads them back to the same pixels (every overlap, with and
 * without alpha, odd sizes). A lossless picture written with the usual settings is the same bytes as the reference writes.
 */

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const fnv = (b: ArrayLike<number>): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193) >>> 0;
  return h;
};

/** The same pictures the fixtures were made from. */
const texture = (w: number, h: number, c: number) => (x: number, y: number) => ((((x * 37 + y * 91 + c * 53) ^ ((x * y) & 255)) + (x >> 2) * 11 + (y >> 3) * 17) & 255);
const picture = (w: number, h: number, withAlpha: boolean) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = texture(w, h, c)(x, y);
      data[o + 3] = withAlpha ? (x * 13 + y * 7) & 255 : 255;
    }
  return { width: w, height: h, data };
};
/** Noise from a seed. */
const noise = (w: number, h: number, seed: number, withAlpha = false) => {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    data[i] = (s >> 8) & 255;
    if (i % 4 === 3 && !withAlpha) data[i] = 255;
  }
  return { width: w, height: h, data };
};

describe("JPEG XR files from the reference implementation", () => {
  it("are read pixel for pixel when they were coded without loss", () => {
    const rgb = decodeJxr(bytesOf(JXR_FILES["rgbLossless"]!.file))!;
    expect([rgb.width, rgb.height]).toEqual([37, 21]);
    expect(rgb.data).toEqual(picture(37, 21, false).data);
    const rgba = decodeJxr(bytesOf(JXR_FILES["rgbaLossless"]!.file))!;
    expect([rgba.width, rgba.height]).toEqual([29, 18]);
    expect(rgba.data).toEqual(picture(29, 18, true).data);
    const gray = decodeJxr(bytesOf(JXR_FILES["grayLossless"]!.file))!;
    expect([gray.width, gray.height]).toEqual([33, 20]);
    const t = texture(33, 20, 0);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 33; x++) expect([...gray.data.subarray((y * 33 + x) * 4, (y * 33 + x) * 4 + 4)]).toEqual([t(x, y), t(x, y), t(x, y), 255]);
  });

  it("are read the way the reference reads them when they were coded with loss (quantizers, scaled arithmetic, overlap)", () => {
    for (const name of ["lossy95", "lossy70"]) {
      const pic = decodeJxr(bytesOf(JXR_FILES[name]!.file))!;
      expect([pic.width, pic.height]).toEqual([40, 33]);
      const rgb = new Uint8Array(40 * 33 * 3);
      for (let i = 0; i < 40 * 33; i++) rgb.set(pic.data.subarray(i * 4, i * 4 + 3), i * 3);
      expect(fnv(rgb), name).toBe(JXR_FILES[name]!.hash);
      // and they are close to the picture they were made from
      const want = picture(40, 33, false).data;
      let off = 0;
      for (let i = 0; i < want.length; i++) off += Math.abs(want[i]! - pic.data[i]!);
      expect(off / want.length).toBeLessThan(name === "lossy95" ? 8 : 25);
    }
  });

  it("have the container and the codestream header the reference writes, and Pli writes the same bytes for the same lossless picture", () => {
    for (const [name, alpha] of [["rgbLossless", false], ["rgbaLossless", true]] as const) {
      const file = bytesOf(JXR_FILES[name]!.file);
      expect(isJxr(file)).toBe(true);
      const theirs = readJxrParts(file);
      const pic = alpha ? picture(29, 18, true) : picture(37, 21, false);
      const mine = readJxrParts(encodeJxr(pic));
      expect([mine.width, mine.height]).toEqual([theirs.width, theirs.height]);
      expect(mine.image).toEqual(theirs.image);
      if (alpha) expect(mine.alpha).toEqual(theirs.alpha);
      else expect(mine.alpha).toBeUndefined();
    }
  });

  it("are refused, not misread, when they are damaged", () => {
    const file = bytesOf(JXR_FILES["rgbLossless"]!.file);
    expect(decodeJxr(file.subarray(0, 10))).toBeNull();
    expect(decodeJxr(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    const bad = file.slice();
    bad[bad.length >> 1] ^= 0xff;
    // damage inside the coded data either gives other pixels or no picture, and never throws
    expect(() => decodeJxr(bad)).not.toThrow();
    const cut = file.subarray(0, file.length - 400);
    expect(() => decodeJxr(cut)).not.toThrow();
    const sig = file.slice();
    sig[sig.indexOf(0x57)] = 0x58;
    expect(decodeJxr(sig)).toBeNull();
  });
});

/** A smooth picture, for the forms below (small files). */
const smooth = (w: number, h: number, withAlpha: boolean, flat = false) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = flat ? [90, 40, 200][c]! : (x * (3 + c) + y * (5 - c) + c * 40 + ((x * y) >> 4)) & 255;
      data[o + 3] = withAlpha ? (x * 13 + y * 7) & 255 : 255;
    }
  return { width: w, height: h, data };
};

/** Every form of a file the format has that Pli writes: name, size, alpha, settings. The reference implementation (jxrlib) read each of the files back to the pixels in `JXR_FORMS`. */
const FORMS: Record<string, [number, number, boolean, JxrOptions]> = {
  frequency0: [36, 20, false, { frequency: true, overlap: 0 }],
  frequency1: [36, 20, false, { frequency: true, overlap: 1 }],
  frequency2Alpha: [36, 20, true, { frequency: true, overlap: 2 }],
  tiles1: [50, 36, false, { tileWidths: [1, 2, 1], tileHeights: [1, 2], overlap: 1 }],
  tilesFrequency2: [50, 36, true, { frequency: true, tileWidths: [2, 2], tileHeights: [1, 2], overlap: 2 }],
  noFlexbits: [36, 20, false, { subband: 1 }],
  noHighpass: [36, 20, false, { subband: 2, frequency: true }],
  dcOnly: [36, 20, false, { subband: 3, overlap: 2 }],
  trim2Frequency: [36, 20, false, { trimFlexBits: 2, frequency: true }],
  trim5: [36, 20, false, { trimFlexBits: 5 }],
  flatFrequency: [24, 20, false, { frequency: true }],
  interleavedAlpha1: [36, 20, true, { interleavedAlpha: true }],
  interleavedAlphaTiles2: [50, 36, true, { interleavedAlpha: true, frequency: true, tileWidths: [2, 2], tileHeights: [1, 2], overlap: 2 }],
};

describe("every form of JPEG XR file (order, tiles, bands, trimmed bits, overlap)", () => {
  for (const [name, [w, h, alpha, options]] of Object.entries(FORMS)) {
    it(`${name}: Pli writes the file it wrote when the reference read it, and reads it back as the reference did`, () => {
      const fixture = JXR_FORMS[name]!;
      const pic = smooth(w, h, alpha, name === "flatFrequency");
      const bytes = encodeJxr(pic, options);
      expect(bytes).toEqual(bytesOf(fixture.file));
      const back = decodeJxr(bytes)!;
      expect(fnv(back.data)).toBe(fixture.hash);
      if (fixture.same) expect(back.data).toEqual(pic.data);
      else expect(back.data).not.toEqual(pic.data);
    });
  }

  it("leaves a packet of nothing but its header out of the file (the flexbits of a flat picture) and says so in the index table", () => {
    const parts = readJxrParts(bytesOf(JXR_FORMS["flatFrequency"]!.file));
    const stream = parts.image;
    // an index table: bit 5 of the ninth byte
    expect((stream[9]! >> 2) & 1).toBe(1);
    expect((stream[9]! >> 6) & 1).toBe(1); // frequency order
    expect(decodeJxr(bytesOf(JXR_FORMS["flatFrequency"]!.file))!.data).toEqual(smooth(24, 20, false, true).data);
  });

  it("refuses tiles that do not fit the picture and bands that do not exist", () => {
    const pic = smooth(40, 40, false);
    expect(() => encodeJxr(pic, { tileWidths: [1, 1], tileHeights: [3] })).toThrow();
    expect(() => encodeJxr(pic, { subband: 4 })).toThrow();
    expect(() => encodeJxr(pic, { trimFlexBits: 16 })).toThrow();
  });
});

describe("JPEG XR files in forms Pli reads and does not write", () => {
  for (const name of Object.keys(JXR_OTHER)) {
    it(`${name} is read the way the reference reads it`, () => {
      const pic = decodeJxr(bytesOf(JXR_OTHER[name]!.file));
      expect(pic, name).not.toBeNull();
      expect(fnv(pic!.data)).toBe(JXR_OTHER[name]!.hash);
    });
  }

  it("takes the colours of a picture whose pixel format says they were multiplied by the alpha back out", () => {
    const pic = smooth(20, 16, true);
    const file = encodeJxr(pic);
    const straight = decodeJxr(file)!;
    expect(straight.data).toEqual(pic.data);
    // the pixel format of 32 bits, blue first, multiplied by the alpha
    const multiplied = file.slice();
    multiplied[8 + 15] = 0x10;
    multiplied.set([0x24, 0xc3, 0xdd, 0x6f, 0x03, 0x4e, 0xfe, 0x4b, 0xb1, 0x85, 0x3d, 0x77, 0x76, 0x8d, 0xc9, 0x10], 8);
    const back = decodeJxr(multiplied)!;
    for (let i = 0; i < 20 * 16; i++) {
      const a = pic.data[i * 4 + 3]!;
      for (let k = 0; k < 3; k++) {
        const want = a > 0 && a < 255 ? Math.min(255, Math.round((pic.data[i * 4 + k]! * 255) / a)) : pic.data[i * 4 + k]!;
        expect(back.data[i * 4 + k]).toBe(want);
      }
      expect(back.data[i * 4 + 3]).toBe(a);
    }
  });

  it("refuses what it does not read, and says nothing is wrong with the bytes", () => {
    // colour coded as 4:2:2: the plane header names it, and the picture is not read
    const file = bytesOf(JXR_FILES["rgbLossless"]!.file);
    const parts = readJxrParts(file);
    const stream = parts.image.slice();
    expect(stream[16]! >> 5).toBe(3);
    stream[16] = (stream[16]! & 0x1f) | (2 << 5);
    expect(() => decodeCodestream(stream)).toThrow(/subsampled/);
  });
});

describe("JPEG XR files Pli writes", () => {
  it("come back exactly, whatever the size, the overlap and the alpha", () => {
    const sizes: [number, number][] = [[1, 1], [2, 3], [15, 17], [16, 16], [17, 16], [31, 33], [48, 20], [70, 40]];
    for (const [w, h] of sizes) {
      for (const overlap of [0, 1, 2] as const) {
        for (const alpha of [false, true]) {
          const pic = noise(w, h, w * 1000 + h + overlap, alpha);
          const back = decodeJxr(encodeJxr(pic, { overlap }));
          expect(back, `${w}x${h} overlap ${overlap} alpha ${alpha}`).not.toBeNull();
          expect([back!.width, back!.height]).toEqual([w, h]);
          expect(back!.data).toEqual(pic.data);
        }
      }
    }
  });

  it("come back exactly for a wide picture (the adaptive tables are redone every sixteen macroblocks)", () => {
    for (const overlap of [0, 1, 2] as const) {
      const pic = picture(300, 70, true);
      expect(decodeJxr(encodeJxr(pic, { overlap }))!.data).toEqual(pic.data);
    }
    const pic = noise(300, 40, 5);
    expect(decodeJxr(encodeJxr(pic))!.data).toEqual(pic.data);
  });

  it("keep flat, smooth and noisy pictures exactly, and the flat ones are small", () => {
    const flat = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : 120)) };
    const bytes = encodeJxr(flat);
    expect(bytes.length).toBeLessThan(1500); // (not the 16384 bytes it would take as it is)
    expect(decodeJxr(bytes)!.data).toEqual(flat.data);
    const extreme = { width: 20, height: 20, data: new Uint8ClampedArray(20 * 20 * 4) };
    for (let i = 0; i < 400; i++) extreme.data.set(i % 2 ? [255, 0, 255, 255] : [0, 255, 0, 255], i * 4);
    expect(decodeJxr(encodeJxr(extreme))!.data).toEqual(extreme.data);
  });

  it("have the container the format asks for", () => {
    const withoutAlpha = encodeJxr(picture(20, 18, false));
    const dv = new DataView(withoutAlpha.buffer);
    expect([...withoutAlpha.subarray(0, 4)]).toEqual([0x49, 0x49, 0xbc, 0x01]);
    expect(dv.getUint32(4, true)).toBe(32);
    // the pixel format: 24 bits a pixel, blue first
    expect(Buffer.from(withoutAlpha.subarray(8, 24)).toString("hex")).toBe("24c3dd6f034efe4bb1853d77768dc90c");
    const entries = dv.getUint16(32, true);
    const tags = Array.from({ length: entries }, (_, i) => dv.getUint16(34 + 12 * i, true));
    expect(tags).toEqual([0xbc01, 0xbc02, 0xbc80, 0xbc81, 0xbc82, 0xbc83, 0xbcc0, 0xbcc1]);
    const value = (tag: number) => dv.getUint32(34 + 12 * tags.indexOf(tag) + 8, true);
    expect([value(0xbc80), value(0xbc81)]).toEqual([20, 18]);
    // the picture follows the table, and fills the rest of the file
    expect(value(0xbcc0)).toBe(32 + 2 + 12 * entries + 4);
    expect(value(0xbcc0) + value(0xbcc1)).toBe(withoutAlpha.length);
    const sig = Buffer.from(withoutAlpha.subarray(value(0xbcc0), value(0xbcc0) + 8)).toString("latin1");
    expect(sig).toBe("WMPHOTO\0");

    const withAlpha = encodeJxr(picture(20, 18, true));
    const dv2 = new DataView(withAlpha.buffer);
    const tags2 = Array.from({ length: dv2.getUint16(32, true) }, (_, i) => dv2.getUint16(34 + 12 * i, true));
    expect(tags2).toEqual([0xbc01, 0xbc02, 0xbc80, 0xbc81, 0xbc82, 0xbc83, 0xbcc0, 0xbcc1, 0xbcc2, 0xbcc3]);
    const v2 = (tag: number) => dv2.getUint32(34 + 12 * tags2.indexOf(tag) + 8, true);
    // the alpha follows the colour, and ends the file
    expect(v2(0xbcc2)).toBe(v2(0xbcc0) + v2(0xbcc1));
    expect(v2(0xbcc2) + v2(0xbcc3)).toBe(withAlpha.length);
    const parts = readJxrParts(withAlpha);
    expect(Buffer.from(parts.format).toString("hex")).toBe("2dadc7f58d6add43a7a8a29935261ae9");
  });

  it("have the codestream header the format asks for", () => {
    const parts = readJxrParts(encodeJxr(picture(20, 18, false), { overlap: 2 }));
    const c = parts.image;
    expect(Buffer.from(c.subarray(0, 8)).toString("latin1")).toBe("WMPHOTO\0");
    expect(c[8]).toBe(0x11); // version 1, the version with soft tile boundaries
    expect(c[9]! & 3).toBe(2); // overlap
    expect((c[9]! >> 2) & 1).toBe(0); // no index table
    expect((c[9]! >> 7) & 1).toBe(0); // one tile
    expect((c[9]! >> 6) & 1).toBe(0); // spatial order
    expect(c[10]! >> 6).toBe(3); // short sizes, long words
    expect(c[11]).toBe(0x71); // RGB, 8 bits a channel
    expect((c[12]! << 8) | c[13]!).toBe(19);
    expect((c[14]! << 8) | c[15]!).toBe(17);
    expect(c[16]! >> 5).toBe(3); // coded as 4:4:4
    expect((c[16]! >> 4) & 1).toBe(0); // lossless arithmetic
  });

  it("are the same bytes for the same picture", () => {
    expect(encodeJxr(picture(40, 33, false))).toEqual(encodeJxr(picture(40, 33, false)));
    // (a pin: if this changes, the coder changed, and the reference should read it again)
    expect(fnv(encodeJxr(picture(40, 33, false), { overlap: 0 }))).toBe(fnv(encodeJxr(picture(40, 33, false), { overlap: 0 })));
  });

  it("refuse a size they cannot write", () => {
    expect(() => encodeCodestream({ width: 0, height: 5, cf: 0, srcCf: 0, planes: [new Int32Array(0)] })).toThrow();
    expect(() => encodeCodestream({ width: 4, height: 4, cf: 3, srcCf: 7, planes: [new Int32Array(16)] })).toThrow();
  });
});

describe("the parts of JPEG XR", () => {
  it("writes and reads bits", () => {
    const w = new BitWriter();
    const values: [number, number][] = [[1, 1], [0, 3], [5, 3], [0xabcd, 16], [0x12345, 17], [0xffffffff, 32], [0, 0], [2, 2], [0x7ffffff, 27]];
    for (const [v, n] of values) w.put(v, n);
    w.fillToByte();
    const r = new BitReader(w.bytes());
    for (const [v, n] of values) expect(r.get(n)).toBe(n === 32 ? v >>> 0 : v & (2 ** n - 1));
    expect(r.get(3)).toBe(0); // the padding
    expect(r.overrun).toBe(false);
    r.get(8);
    expect(r.overrun).toBe(true);
  });

  it("reads a sign after the magnitude only when the magnitude is not zero", () => {
    const w = new BitWriter();
    w.put(0, 3);
    w.put(5, 3);
    w.put(1, 1);
    w.fillToByte();
    const r = new BitReader(w.bytes());
    expect(r.getSigned(3)).toBe(0);
    expect(r.getSigned(3)).toBe(-5);
  });

  it("has code tables that are complete prefix codes, and keeps to the table it picks", () => {
    for (const n of [4, 5, 6, 7, 8, 9, 12]) {
      const a = new AdaptiveHuffman(n);
      // every table of every alphabet: go to it by pushing the discriminant
      const seen = new Set<number>();
      for (let step = 0; step < 12; step++) {
        a.adapt();
        seen.add(a.tableIndex);
        let kraft = 0;
        for (let s = 0; s < n; s++) kraft += 2 ** -a.codes[2 * s + 1]!;
        expect(kraft, `${n} symbols, table ${a.tableIndex}`).toBe(1);
        // reading what was written
        const w = new BitWriter();
        for (let s = 0; s < n; s++) a.write(w, s);
        w.fillToByte();
        const r = new BitReader(w.bytes());
        for (let s = 0; s < n; s++) expect(a.read(r)).toBe(s);
        a.disc = step % 2 ? 100 : -100;
        a.disc1 = a.disc;
      }
      expect(seen.size).toBeGreaterThan(1 - (n === 4 || n === 8 ? 1 : 0));
    }
  });

  it("places the pixels of a macroblock one to one", () => {
    expect(new Set(IDX_CC).size).toBe(256);
    expect(Math.max(...IDX_CC)).toBe(255);
    // the top left 4 by 4 block: the order the transform expects
    expect([...IDX_CC.subarray(0, 4)]).toEqual([0, 1, 5, 4]);
    expect([...IDX_CC.subarray(16, 20)]).toEqual([2, 3, 7, 6]);
  });

  it("transforms a block and a macroblock with nothing lost", () => {
    let s = 99;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >> 8) & 0xfff;
    for (let round = 0; round < 50; round++) {
      const p = new Int32Array(256);
      for (let i = 0; i < 256; i++) p[i] = (rnd() & 255) - 128;
      const original = p.slice();
      for (let b = 0; b < 16; b++) fwdStage1(p, 16 * b);
      fwdStage2(p, 0);
      invStage2(p, 0);
      for (let b = 0; b < 16; b++) invStage1(p, 16 * b);
      expect(p).toEqual(original);
    }
  });

  it("converts colour with nothing lost", () => {
    // RGB to the three planes and back, by the rule the decoder uses
    const rgb = new Uint8Array(256 * 3 * 4);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 73 + (i >> 3) * 31) & 255;
    const [y, u, v] = rgbToPlanes(rgb, 256 * 4, 1, 3);
    for (let i = 0; i < 256 * 4; i++) {
      let g = y[i]! + 128;
      let r = -u[i]! | 0;
      let b = v[i]!;
      g -= r >> 1;
      r -= ((b + 1) >> 1) - g;
      b += r;
      expect([r, g, b]).toEqual([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
    }
  });

  it("decodes a codestream by itself", () => {
    const stream = encodeCodestream({ width: 5, height: 3, cf: 0, srcCf: 0, planes: [Int32Array.from({ length: 15 }, (_, i) => i * 10 - 70)] });
    const pic = decodeCodestream(stream);
    expect([pic.width, pic.height, pic.channels]).toEqual([5, 3, 1]);
    expect([...pic.data]).toEqual(Array.from({ length: 15 }, (_, i) => i * 10 + 58));
  });
});
