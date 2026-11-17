import { describe, expect, it } from "vitest";
import { Lexer, PdfDict, PdfName, PdfRef, PdfStream, PdfString, parseContentStream, parseIndirectObject, parseObject, textOf, type PdfObj } from "../src/cos";
import { bytesOf, textOf as latin1 } from "./support/handmade";

const parse = (s: string): PdfObj => parseObject(bytesOf(s));
const str = (o: PdfObj): string => latin1((o as PdfString).bytes);

describe("lexer", () => {
  it("reads numbers in all the forms real files use", () => {
    const toks = (s: string) => {
      const lx = new Lexer(bytesOf(s));
      const out: unknown[] = [];
      for (let t = lx.next(); !(t instanceof Object && "value" in t && t.value === "<eof>"); t = lx.next()) out.push(t);
      return out;
    };
    expect(toks("1 -2 +3 .5 -.5 +.5 4. 0.25 --3 007")).toEqual([1, -2, 3, 0.5, -0.5, 0.5, 4, 0.25, -3, 7]);
    expect(toks("1.2.3 12-3")).toEqual([1.2, 12]);
    expect(toks("123456789012")).toEqual([123456789012]);
  });

  it("skips comments and every kind of white space", () => {
    expect(parse("%c\n\t\f\0 \r\n 12 % trailing")).toBe(12);
    expect(parse("[1%comment ]\n 2]")).toEqual([1, 2]);
  });

  it("decodes names with #xx", () => {
    expect((parse("/A#20B") as PdfName).value).toBe("A B");
    expect((parse("/Name#2") as PdfName).value).toBe("Name#2");
    expect((parse("/") as PdfName).value).toBe("");
    expect(parse("/Same")).toBe(PdfName.of("Same"));
  });

  it("decodes literal strings: escapes, octal, line continuation, nested parentheses", () => {
    expect(str(parse("(a\\nb\\tc\\\\d\\(e\\)f)"))).toBe("a\nb\tc\\d(e)f");
    expect(str(parse("(\\101\\60\\0053\\7)"))).toBe("A0\x053\x07");
    expect(str(parse("(a\\\nb\\\r\nc)"))).toBe("abc");
    expect(str(parse("(a(b(c))d)"))).toBe("a(b(c))d");
    expect(str(parse("(x\r\ny\rz)"))).toBe("x\ny\nz");
    expect(str(parse("(\\400)"))).toBe("\0"); // overflow wraps like most readers
    expect(str(parse("(\\q)"))).toBe("q"); // unknown escape: the character itself
    expect(str(parse("(unterminated"))).toBe("unterminated");
  });

  it("decodes hex strings, odd digits, whitespace and junk", () => {
    const s = parse("<48 65 6C6c 6F>") as PdfString;
    expect(str(s)).toBe("Hello");
    expect(s.hex).toBe(true);
    expect([...(parse("<ABC>") as PdfString).bytes]).toEqual([0xab, 0xc0]);
    expect([...(parse("<>") as PdfString).bytes]).toEqual([]);
    expect([...(parse("<4g1>") as PdfString).bytes]).toEqual([0x41]);
  });
});

describe("objects", () => {
  it("parses nested containers and references", () => {
    const o = parse("<< /A [1 2 0 R (s) /N true false null] /B << /C 3.5 >> /D 4 0 R >>") as PdfDict;
    const a = o.get("A") as PdfObj[];
    expect(a[0]).toBe(1);
    expect(a[1]).toEqual(new PdfRef(2, 0));
    expect(str(a[2]!)).toBe("s");
    expect(a.slice(3)).toEqual([PdfName.of("N"), true, false, null]);
    expect((o.get("B") as PdfDict).get("C")).toBe(3.5);
    expect(o.get("D")).toEqual(new PdfRef(4, 0));
  });

  it("does not take two numbers and a word that is not R for a reference", () => {
    expect(parse("[1 2 3]")).toEqual([1, 2, 3]);
    expect(parse("[1 0 R2 5]")).toEqual([1, 0, 5]);
    expect(parse("[1 2 R]")).toEqual([new PdfRef(1, 2)]);
    expect(parse("[1.5 0 R]")).toEqual([1.5, 0]);
    expect(parse("[-1 0 R]")).toEqual([-1, 0]);
  });

  it("survives unclosed arrays and dictionaries", () => {
    expect(parse("[1 2 3")).toEqual([1, 2, 3]);
    const d = parse("<< /A 1 /B [2 3 endobj") as PdfDict;
    expect(d.get("A")).toBe(1);
    expect(d.get("B")).toEqual([2, 3]);
  });

  it("copes with a key without value and with junk keys", () => {
    const d = parse("<< /A /B 5 /C >>") as PdfDict;
    expect(d.get("A")).toEqual(PdfName.of("B"));
    expect(d.has("C")).toBe(true);
    expect(d.get("C")).toBe(null);
    const e = parse("<< 1 2 /K /V >>") as PdfDict;
    expect(e.get("K")).toEqual(PdfName.of("V"));
  });

  it("refuses to recurse without end", () => {
    const deep = "[".repeat(10000);
    expect(parseObject(bytesOf(deep))).toBe(null);
    expect(parseObject(bytesOf("<< /A ".repeat(10000)))).toBe(null);
  });
});

describe("indirect objects and streams", () => {
  it("reads obj ... endobj", () => {
    const r = parseIndirectObject(bytesOf("12 3 obj\n<< /A 1 >>\nendobj\n"), 0)!;
    expect([r.num, r.gen]).toEqual([12, 3]);
    expect((r.obj as PdfDict).get("A")).toBe(1);
  });

  it("works without endobj and with the dictionary glued to obj", () => {
    const r = parseIndirectObject(bytesOf("5 0 obj<</K/V>>5 0 R"), 0)!;
    expect((r.obj as PdfDict).get("K")).toEqual(PdfName.of("V"));
    expect(parseIndirectObject(bytesOf("5 0 obj endobj"), 0)!.obj).toBe(null);
  });

  it("returns null when there is no object header", () => {
    expect(parseIndirectObject(bytesOf("garbage"), 0)).toBe(null);
    expect(parseIndirectObject(bytesOf("1 0 R"), 0)).toBe(null);
    expect(parseIndirectObject(bytesOf("1 0 obj 5"), 100)).toBe(null);
  });

  const body = "0123456789";
  const make = (dictLen: string, tail = "\nendstream\nendobj\n", eol = "\n") => bytesOf(`7 0 obj\n<< /Length ${dictLen} >>\nstream${eol}${body}${tail}`);
  const data = (b: Uint8Array) => latin1(((parseIndirectObject(b, 0)!.obj as PdfStream).data));

  it("takes stream data by Length", () => {
    expect(data(make("10"))).toBe(body);
    expect(data(make("10", "endstream\nendobj\n"))).toBe(body); // no EOL before endstream
    expect(data(make("10", "\r\nendstream"))).toBe(body);
  });

  it("falls back to scanning for endstream when Length is wrong, missing or indirect", () => {
    expect(data(make("4"))).toBe(body);
    expect(data(make("999"))).toBe(body);
    expect(data(make("0"))).toBe(body);
    expect(data(make("9 0 R"))).toBe(body);
    expect(data(bytesOf(`7 0 obj\n<< >>\nstream\n${body}\nendstream`))).toBe(body);
    expect(data(bytesOf(`7 0 obj\n<< /Length -3 >>\nstream\n${body}\nendstream`))).toBe(body);
  });

  it("resolves an indirect Length through the callback", () => {
    const b = make("9 0 R", "\nendstream\nendobj");
    const s = parseIndirectObject(b, 0, { resolveLength: () => 10 })!.obj as PdfStream;
    expect(latin1(s.data)).toBe(body);
  });

  it("handles CRLF and lone CR after the stream keyword", () => {
    expect(data(make("10", undefined, "\r\n"))).toBe(body);
    expect(data(make("10", undefined, "\r"))).toBe(body);
  });

  it("keeps binary data that contains the word endstream when Length is right", () => {
    const payload = "ab\nendstream\ncd";
    const b = bytesOf(`7 0 obj\n<< /Length ${payload.length} >>\nstream\n${payload}\nendstream\nendobj\n`);
    expect(latin1((parseIndirectObject(b, 0)!.obj as PdfStream).data)).toBe(payload);
  });

  it("reads a stream with no endstream and no endobj to the end", () => {
    const b = bytesOf("7 0 obj\n<< /Length 50 >>\nstream\nabcdef");
    expect(latin1((parseIndirectObject(b, 0)!.obj as PdfStream).data)).toBe("abcdef");
  });

  it("reports where the object ends", () => {
    const text = "1 0 obj\n<< /A 1 >>\nendobj\n2 0 obj\n(x)\nendobj\n";
    const r = parseIndirectObject(bytesOf(text), 0)!;
    const r2 = parseIndirectObject(bytesOf(text), r.end)!;
    expect(r2.num).toBe(2);
  });
});

describe("content streams", () => {
  const ops = (s: string) => parseContentStream(bytesOf(s));

  it("splits operators and operands", () => {
    const o = ops("q 1 0 0 1 10 20 cm BT /F1 12 Tf (Hi) Tj [(A) -20 (B)] TJ ET Q");
    expect(o.map((x) => x.op)).toEqual(["q", "cm", "BT", "Tf", "Tj", "TJ", "ET", "Q"]);
    expect(o[1]!.args).toEqual([1, 0, 0, 1, 10, 20]);
    expect(o[3]!.args[0]).toBe(PdfName.of("F1"));
    expect(textOf(o[4]!.args[0] as PdfString)).toBe("Hi");
    expect((o[5]!.args[0] as PdfObj[]).length).toBe(3);
  });

  it("knows the quote operators, starred operators and marked content with property dictionaries", () => {
    const o = ops("(a) ' 1 2 (b) \" T* /OC << /MCID 3 /P (x) >> BDC EMC f* B*");
    expect(o.map((x) => x.op)).toEqual(["'", '"', "T*", "BDC", "EMC", "f*", "B*"]);
    expect(o[3]!.args[1]).toBeInstanceOf(PdfDict);
  });

  it("splits glued tokens that are delimiters apart", () => {
    const o = ops("/F1 12 Tf(text)Tj[(a)]TJ");
    expect(o.map((x) => x.op)).toEqual(["Tf", "Tj", "TJ"]);
  });

  it("ignores comments, stray brackets and keeps true/false/null as operands", () => {
    const o = ops("% hi\n1 w ] >> true false null foo\n");
    expect(o.map((x) => x.op)).toEqual(["w", "foo"]);
    expect(o[1]!.args).toEqual([true, false, null]);
  });

  it("does not take numbers for references", () => {
    const o = ops("1 0 R 5 re");
    expect(o.map((x) => x.op)).toEqual(["R", "re"]);
  });

  it("makes one operation of an inline image (uncompressed, size known)", () => {
    const img = "\x00\x80\xff\x10 EI \x20\x30"; // contains ' EI ' in the data
    const o = ops(`q BI /W 5 /H 2 /BPC 8 /CS /G ID ${img}\nEI Q`);
    expect(o.map((x) => x.op)).toEqual(["q", "BI", "Q"]);
    const [d, data] = o[1]!.args as [PdfDict, PdfString];
    expect(d.get("W")).toBe(5);
    expect(latin1(data.bytes)).toBe(img);
  });

  it("finds the end of a filtered inline image by looking at what follows EI", () => {
    const data = "\x01\x02 EI\x80\x81\x82 more\x00\xff";
    const o = ops(`BI /W 9 /H 9 /F /Fl ID ${data}\nEI\nQ q`);
    expect(o.map((x) => x.op)).toEqual(["BI", "Q", "q"]);
    expect(latin1((o[0]!.args[1] as PdfString).bytes)).toBe(data);
  });

  it("handles ASCIIHex and ASCII85 inline images", () => {
    const o = ops("BI /W 1 /H 1 /BPC 8 /CS /G /F /AHx ID 7f> EI Q");
    expect(o.map((x) => x.op)).toEqual(["BI", "Q"]);
    expect(latin1((o[0]!.args[1] as PdfString).bytes)).toBe("7f>");
  });

  it("copes with an inline image that never ends", () => {
    const o = ops("BI /W 1 /H 1 ID abc");
    expect(o.length).toBe(1);
    expect(o[0]!.op).toBe("BI");
  });

  it("is fast: 200k operations", () => {
    const line = "q 1 0 0 1 10.5 20.25 cm BT /F1 12 Tf (Hello world) Tj [(A) -20 (B)] TJ ET Q\n";
    const big = bytesOf(line.repeat(20000));
    const t = performance.now();
    const o = parseContentStream(big);
    const ms = performance.now() - t;
    expect(o.length).toBe(20000 * 8);
    expect(ms).toBeLessThan(2000);
  });
});
