import { deflateRawSync, deflateSync, constants as zc } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfName, PdfStream, ascii85Decode, asciiHexDecode, decodeStream, decodeStreamPartial, encodeFlate, inflateTolerant, lzwDecode, runLengthDecode } from "../src/cos";
import { a85Encode, lzwEncode, rlEncode } from "./support/encoders";
import { bytesOf, textOf } from "./support/handmade";

const stream = (data: Uint8Array | string, filter?: string | string[], parms?: Record<string, number>[] | Record<string, number>): PdfStream => {
  const d = new PdfDict();
  if (filter !== undefined) d.set("Filter", Array.isArray(filter) ? filter.map((f) => PdfName.of(f)) : PdfName.of(filter));
  if (parms) {
    const mk = (p: Record<string, number>) => new PdfDict(Object.entries(p));
    d.set("DecodeParms", Array.isArray(parms) ? parms.map(mk) : mk(parms));
  }
  return new PdfStream(d, typeof data === "string" ? bytesOf(data) : data);
};

const sample = (n: number, seed = 1): Uint8Array => {
  let s = seed;
  return Uint8Array.from({ length: n }, (_, i) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return i % 7 < 4 ? (i >> 3) & 255 : (s >> 16) & 255;
  });
};

const flat = (rows: Uint8Array[]): Uint8Array => Uint8Array.from(rows.flatMap((r) => [...r]));

// ---- test-side encoders ----------------------------------------------------------------------------------------------

function pngEncode(rows: Uint8Array[], bpp: number, type: (r: number) => number): Uint8Array {
  const out: number[] = [];
  let prev: Uint8Array = new Uint8Array(rows[0]!.length);
  rows.forEach((row, r) => {
    const t = type(r);
    out.push(t);
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let p = 0;
      if (t === 1) p = a;
      else if (t === 2) p = b;
      else if (t === 3) p = (a + b) >> 1;
      else if (t === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out.push((row[i]! - p) & 255);
    }
    prev = row;
  });
  return Uint8Array.from(out);
}

describe("Flate", () => {
  it("round trips", () => {
    const d = sample(100000);
    expect(decodeStream(stream(encodeFlate(d), "FlateDecode"))).toEqual(d);
    expect(decodeStream(stream(encodeFlate(new Uint8Array(0)), "FlateDecode")).length).toBe(0);
  });

  it("accepts the abbreviated name and a Filter array", () => {
    const d = sample(1000);
    expect(decodeStream(stream(encodeFlate(d), "Fl"))).toEqual(d);
    expect(decodeStream(stream(encodeFlate(d), ["FlateDecode"]))).toEqual(d);
  });

  it("the tolerant decoder handles stored, fixed and dynamic blocks", () => {
    const d = sample(70000, 5);
    for (const opts of [{ level: 0 }, { level: 6, strategy: zc.Z_FIXED }, { level: 9 }, { level: 1, strategy: zc.Z_HUFFMAN_ONLY }, { level: 6, strategy: zc.Z_RLE }]) {
      const z = new Uint8Array(deflateSync(d, opts));
      expect(inflateTolerant(z, 2, 1 << 30)).toEqual(d);
      const raw = new Uint8Array(deflateRawSync(d, opts));
      expect(inflateTolerant(raw, 0, 1 << 30)).toEqual(d);
    }
  });

  it("returns what it could decode from truncated data", () => {
    const d = bytesOf("The quick brown fox jumps over the lazy dog. ".repeat(2000));
    const z = encodeFlate(d);
    const cut = z.subarray(0, Math.floor(z.length * 0.6));
    const r = decodeStream(stream(cut, "FlateDecode"));
    expect(r.length).toBeGreaterThan(d.length / 4);
    expect(r.length).toBeLessThan(d.length);
    expect(textOf(r.subarray(0, 50))).toBe(textOf(d.subarray(0, 50)));
  });

  it("returns the good part of corrupt data", () => {
    const d = sample(60000, 9);
    const z = new Uint8Array(deflateSync(d, { level: 9 }));
    const bad = z.slice();
    for (let i = 20000; i < 20010; i++) bad[i] ^= 0xa5;
    const r = decodeStream(stream(bad, "FlateDecode"));
    expect(r.length).toBeGreaterThan(1000);
    expect(r.subarray(0, 1000)).toEqual(d.subarray(0, 1000));
  });

  it("copes with garbage, an empty stream, a missing zlib header and a missing checksum", () => {
    expect(decodeStream(stream(new Uint8Array(0), "FlateDecode")).length).toBe(0);
    expect(() => decodeStream(stream(sample(100), "FlateDecode"))).not.toThrow();
    const d = sample(5000);
    expect(decodeStream(stream(new Uint8Array(deflateRawSync(d)), "FlateDecode"))).toEqual(d);
    const z = encodeFlate(d);
    expect(decodeStream(stream(Uint8Array.from([0x0a, ...z]), "FlateDecode"))).toEqual(d); // stray newline before the data
    expect(decodeStream(stream(z.subarray(0, z.length - 4), "FlateDecode"))).toEqual(d);
  });

  it("refuses a decompression bomb", () => {
    const bomb = encodeFlate(new Uint8Array(30_000_000), 9);
    expect(() => decodeStream(stream(bomb, "FlateDecode"), undefined, { maxSize: 1_000_000 })).toThrow(/larger/);
    expect(decodeStream(stream(bomb, "FlateDecode"), undefined, { maxSize: 40_000_000 }).length).toBe(30_000_000);
  });
});

describe("LZW", () => {
  it("decodes with EarlyChange 1 (default) and 0", () => {
    const d = sample(30000, 3);
    expect(lzwDecode(lzwEncode(d, 1), 1)).toEqual(d);
    expect(lzwDecode(lzwEncode(d, 0), 0)).toEqual(d);
    expect(decodeStream(stream(lzwEncode(d, 1), "LZWDecode"))).toEqual(d);
    expect(decodeStream(stream(lzwEncode(d, 0), "LZW", { EarlyChange: 0 }))).toEqual(d);
  });

  it("handles runs (the KwKwK case) and returns partial data when truncated", () => {
    const d = new Uint8Array(5000).fill(65);
    expect(lzwDecode(lzwEncode(d), 1)).toEqual(d);
    const e = lzwEncode(sample(8000, 4));
    expect(lzwDecode(e.subarray(0, e.length >> 1), 1).length).toBeGreaterThan(1000);
  });

  it("matches the example in the PDF specification", () => {
    // 45 45 45 45 45 65 45 45 45 66 encodes to 80 0B 60 50 22 0C 0C 85 01 (ISO 32000-1, 7.4.4.2)
    const r = lzwDecode(Uint8Array.from([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]), 1);
    expect([...r]).toEqual([45, 45, 45, 45, 45, 65, 45, 45, 45, 66]);
  });
});

describe("ASCII filters and run length", () => {
  it("ASCIIHexDecode: white space, odd digits, end marker, lower case", () => {
    expect([...asciiHexDecode(bytesOf("48 65\n6c 6C 6f>junk"))]).toEqual([...bytesOf("Hello")]);
    expect([...asciiHexDecode(bytesOf("7>"))]).toEqual([0x70]);
    expect([...asciiHexDecode(bytesOf(""))]).toEqual([]);
  });

  it("ASCII85Decode: groups, z, partial group, <~ prefix, white space", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 100, 1001]) {
      const d = sample(n, n);
      expect(ascii85Decode(bytesOf(a85Encode(d)))).toEqual(d);
    }
    const z = Uint8Array.from([0, 0, 0, 0, 1, 2, 3, 4]);
    expect(a85Encode(z).startsWith("z")).toBe(true);
    expect(ascii85Decode(bytesOf(a85Encode(z)))).toEqual(z);
    expect(textOf(ascii85Decode(bytesOf(a85Encode(bytesOf("Hello World1")))))).toBe("Hello World1");
    const enc = a85Encode(bytesOf("Hello World1"));
    expect(textOf(ascii85Decode(bytesOf(`<~${enc.slice(0, 6)}\n ${enc.slice(6)}`)))).toBe("Hello World1");
  });

  it("RunLengthDecode", () => {
    for (const n of [0, 1, 5, 300, 5000]) {
      const d = new Uint8Array(n).map((_, i) => (i % 50 < 20 ? 7 : i & 255));
      expect(runLengthDecode(rlEncode(d))).toEqual(d);
    }
    expect([...runLengthDecode(Uint8Array.from([2, 1, 2, 3, 254, 9, 128, 5]))]).toEqual([1, 2, 3, 9, 9, 9]);
    expect([...runLengthDecode(Uint8Array.from([5, 1, 2]))].slice(0, 2)).toEqual([1, 2]); // truncated
  });

  it("a chain of filters is applied in order", () => {
    const d = sample(2000, 2);
    const inner = encodeFlate(d);
    expect(decodeStream(stream(bytesOf(a85Encode(inner)), ["ASCII85Decode", "FlateDecode"]))).toEqual(d);
    const hexed = bytesOf(Array.from(rlEncode(inner), (b) => b.toString(16).padStart(2, "0")).join("") + ">");
    expect(decodeStream(stream(hexed, ["AHx", "RL", "Fl"]))).toEqual(d);
  });

  it("the Crypt filter is the identity", () => {
    expect(textOf(decodeStream(stream("abc", "Crypt")))).toBe("abc");
  });
});

describe("predictors", () => {
  const rowsOf = (w: number, h: number, bytesPerPixel: number): Uint8Array[] => Array.from({ length: h }, (_, r) => sample(w * bytesPerPixel, r + 11));

  it("PNG: all five filter types, 1, 3 and 4 bytes per pixel", () => {
    for (const bpp of [1, 3, 4]) {
      const rows = rowsOf(17, 12, bpp);
      const enc = pngEncode(rows, bpp, (r) => r % 5);
      const s = stream(encodeFlate(enc), "FlateDecode", { Predictor: 15, Colors: bpp, BitsPerComponent: 8, Columns: 17 });
      expect(decodeStream(s)).toEqual(flat(rows));
    }
  });

  it("PNG: 16-bit and 4-bit samples (bytes per pixel rounds up)", () => {
    const rows = rowsOf(9, 6, 6); // 3 colours x 16 bit
    expect(decodeStream(stream(encodeFlate(pngEncode(rows, 6, (r) => (r % 4) + 1)), "FlateDecode", { Predictor: 12, Colors: 3, BitsPerComponent: 16, Columns: 9 }))).toEqual(flat(rows));
    const rows4 = rowsOf(10, 5, 1).map((r) => r.subarray(0, 5)); // 10 columns x 4 bit = 5 bytes
    expect(decodeStream(stream(encodeFlate(pngEncode(rows4, 1, (r) => (r % 4) + 1)), "FlateDecode", { Predictor: 10, Colors: 1, BitsPerComponent: 4, Columns: 10 }))).toEqual(flat(rows4));
  });

  it("PNG: a truncated last row decodes as far as it goes", () => {
    const enc = pngEncode(rowsOf(8, 4, 1), 1, () => 2);
    const f = stream(encodeFlate(enc.subarray(0, enc.length - 3)), "FlateDecode", { Predictor: 12, Columns: 8 });
    expect(decodeStream(f).length).toBe(8 * 4 - 3);
  });

  it("TIFF predictor 2 for 8, 16 and 1-bit samples", () => {
    const cols = 11;
    const raw8 = rowsOf(cols, 4, 3);
    const enc8 = raw8.map((r) => r.map((v, i) => (i >= 3 ? (v - r[i - 3]!) & 255 : v)));
    const s8 = stream(encodeFlate(flat(enc8)), "FlateDecode", { Predictor: 2, Colors: 3, BitsPerComponent: 8, Columns: cols });
    expect(decodeStream(s8)).toEqual(flat(raw8));

    const raw16 = rowsOf(5, 3, 2);
    const enc16 = raw16.map((r) => {
      const o = r.slice();
      for (let i = 2; i < r.length; i += 2) {
        const v = ((r[i]! << 8) | r[i + 1]!) - ((r[i - 2]! << 8) | r[i - 1]!);
        o[i] = (v >> 8) & 255;
        o[i + 1] = v & 255;
      }
      return o;
    });
    const s16 = stream(encodeFlate(flat(enc16)), "FlateDecode", { Predictor: 2, Colors: 1, BitsPerComponent: 16, Columns: 5 });
    expect(decodeStream(s16)).toEqual(flat(raw16));

    // 1 bit: every bit is stored as the difference (xor) to the sample on its left
    const bitsRaw = [0b10110010, 0b01000000];
    const out = bitsRaw.map((byte) => {
      let prev = 0;
      let e = 0;
      for (let b = 7; b >= 0; b--) {
        const v = (byte >> b) & 1;
        e |= ((v - prev) & 1) << b;
        prev = v;
      }
      return e;
    });
    const s1 = stream(encodeFlate(Uint8Array.from(out)), "FlateDecode", { Predictor: 2, Colors: 1, BitsPerComponent: 1, Columns: 16 });
    // one row of 16 bits: the second byte continues from the first
    expect(decodeStream(s1)[0]).toBe(bitsRaw[0]);
  });

  it("works on LZW too", () => {
    const rows = rowsOf(6, 6, 3);
    const s = stream(lzwEncode(pngEncode(rows, 3, (r) => r % 5)), "LZWDecode", { Predictor: 15, Colors: 3, Columns: 6 });
    expect(decodeStream(s)).toEqual(flat(rows));
  });

  it("DecodeParms as an array lines up with the filter array", () => {
    const rows = rowsOf(4, 4, 1);
    const enc = encodeFlate(pngEncode(rows, 1, () => 1));
    const s = stream(bytesOf(a85Encode(enc)), ["ASCII85Decode", "FlateDecode"], [{}, { Predictor: 11, Columns: 4 }]);
    expect(decodeStream(s)).toEqual(flat(rows));
  });
});

describe("image filters", () => {
  it("stop the chain and are reported", () => {
    const jpegish = Uint8Array.from([0xff, 0xd8, 1, 2, 3]);
    const flated = encodeFlate(jpegish);
    const r = decodeStreamPartial(stream(flated, ["FlateDecode", "DCTDecode"]));
    expect(r.data).toEqual(jpegish);
    expect(r.remaining).toEqual(["DCTDecode"]);
    expect(decodeStream(stream(flated, ["FlateDecode", "DCT"]))).toEqual(jpegish);
  });

  it("report their parameters", () => {
    const r = decodeStreamPartial(stream(Uint8Array.of(1, 2), "CCITTFaxDecode", { K: -1, Columns: 100 }));
    expect(r.remaining).toEqual(["CCITTFaxDecode"]);
    expect(r.remainingParams[0]!.get("Columns")).toBe(100);
    expect(decodeStreamPartial(stream("x")).remaining).toEqual([]);
    for (const f of ["JPXDecode", "JBIG2Decode"]) expect(decodeStreamPartial(stream("x", f)).remaining).toEqual([f]);
  });

  it("an unknown filter is an error", () => {
    expect(() => decodeStream(stream("x", "MadeUpDecode"))).toThrow(/unsupported/);
  });
});
