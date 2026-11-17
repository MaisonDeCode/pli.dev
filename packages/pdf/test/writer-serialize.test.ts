import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, bytesToLatin1, latin1Bytes } from "../src/cos/objects";
import { formatNumber, serializeObject } from "../src/cos/writer";

const text = (o: Parameters<typeof serializeObject>[0], options?: Parameters<typeof serializeObject>[1]) => bytesToLatin1(serializeObject(o, options));

describe("serializeObject", () => {
  it("writes numbers without exponents and with at most 5 decimals", () => {
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1 / 3)).toBe("0.33333");
    expect(formatNumber(-2.5)).toBe("-2.5");
    expect(formatNumber(1e-9)).toBe("0");
    expect(formatNumber(1.5e-7)).toBe("0");
    expect(formatNumber(1e21)).toBe("1000000000000000000000");
    expect(formatNumber(123456.7891234)).toBe("123456.78912");
    expect(formatNumber(NaN)).toBe("0");
    expect(formatNumber(Infinity)).toBe("0");
  });

  it("escapes names", () => {
    expect(text(PdfName.of("Type"))).toBe("/Type");
    expect(text(PdfName.of("A B"))).toBe("/A#20B");
    expect(text(PdfName.of("a/b(c)#"))).toBe("/a#2fb#28c#29#23");
    expect(text(PdfName.of("é"))).toBe("/#c3#a9");
    expect(text(PdfName.of(""))).toBe("/");
  });

  it("escapes strings and writes hex strings", () => {
    expect(text(new PdfString(latin1Bytes("a(b)c\\d")))).toBe("(a\\(b\\)c\\\\d)");
    expect(text(new PdfString(Uint8Array.of(10, 13, 0, 0x7f)))).toBe("(\\n\\r\\000\\177)");
    expect(text(new PdfString(Uint8Array.of(0xde, 0xad, 0x01), true))).toBe("<dead01>");
  });

  it("writes arrays, dictionaries and references; null entries of a dictionary are left out", () => {
    const d = new PdfDict({ A: [1, 2.5, true, null, PdfName.of("N")], B: new PdfRef(7, 0), C: null });
    expect(text(d)).toBe("<< /A [1 2.5 true null /N] /B 7 0 R >>");
  });

  it("maps or drops references", () => {
    const d = new PdfDict({ A: new PdfRef(1), B: [new PdfRef(2)], C: new PdfRef(3) });
    const out = text(d, { mapRef: (r) => (r.num === 1 ? new PdfRef(10) : r.num === 2 ? null : r) });
    expect(out).toBe("<< /A 10 0 R /B [null] /C 3 0 R >>");
  });

  it("writes a stream with its Length, replacing a stale one", () => {
    const s = new PdfStream(new PdfDict({ Length: new PdfRef(9), Foo: 1 }), latin1Bytes("hello"));
    expect(text(s)).toBe("<< /Foo 1 /Length 5 >>\nstream\nhello\nendstream");
  });

  it("compresses a stream with Flate on request, and leaves one that has a Filter alone", () => {
    const data = latin1Bytes("0 0 m 100 100 l S\n".repeat(50));
    const out = serializeObject(new PdfStream(new PdfDict(), data), { compress: true });
    const str = bytesToLatin1(out);
    expect(str).toContain("/Filter /FlateDecode");
    const m = /\/Length (\d+)/.exec(str)!;
    const start = str.indexOf("stream\n") + 7;
    const body = out.subarray(start, start + Number(m[1]));
    expect(bytesToLatin1(unzlibSync(body))).toBe(bytesToLatin1(data));
    const filtered = new PdfStream(new PdfDict({ Filter: PdfName.of("DCTDecode") }), data);
    expect(text(filtered, { compress: true })).toContain("/Filter /DCTDecode");
    expect(text(filtered, { compress: true })).not.toContain("Flate");
  });

  it("encrypts strings and stream data through the hook", () => {
    const flip = (b: Uint8Array) => b.map((x) => x ^ 255);
    const out = serializeObject(new PdfStream(new PdfDict({ S: new PdfString(Uint8Array.of(1, 2), true) }), Uint8Array.of(1, 2, 3)), { encrypt: { string: flip, stream: flip } });
    const str = bytesToLatin1(out);
    expect(str).toContain("<fefd>");
    expect(str).toContain("/Length 3");
  });
});
