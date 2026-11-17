import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfFile, PdfStream, PdfString, aesCbcDecryptRaw, aesCbcEncryptRaw, aesDecryptPdf, md5, rc4, sha256, sha384, sha512, textOf as pdfText } from "../src/cos";
import { Encryptor, bytesOf, buildClassic, hex, obj, simpleDoc, streamObj, type EncMode, type Obj, textOf } from "./support/handmade";

const fromHex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const rnd = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

describe("primitives", () => {
  it("MD5 matches known values and Node for every length up to 300", () => {
    expect(hex(md5(new Uint8Array(0)))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(hex(md5(bytesOf("abc")))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(hex(md5(bytesOf("The quick brown fox jumps over the lazy dog")))).toBe("9e107d9d372bb6826bd81d3542a419d6");
    for (let n = 0; n <= 300; n++) {
      const d = rnd(n);
      expect(hex(md5(d))).toBe(createHash("md5").update(d).digest("hex"));
    }
  });

  it("SHA-256, SHA-384 and SHA-512 match known values and Node", () => {
    expect(hex(sha256(bytesOf("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(sha384(bytesOf("abc")))).toBe("cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7");
    expect(hex(sha512(bytesOf("abc")))).toBe("ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
    for (const [name, fn] of [["sha256", sha256], ["sha384", sha384], ["sha512", sha512]] as const) {
      for (const n of [0, 1, 55, 56, 63, 64, 65, 111, 112, 119, 120, 127, 128, 129, 1000, 4097]) {
        const d = rnd(n);
        expect(hex(fn(d))).toBe(createHash(name).update(d).digest("hex"));
      }
    }
  });

  it("RC4 matches the published test vectors", () => {
    expect(hex(rc4(bytesOf("Key"), bytesOf("Plaintext")))).toBe("bbf316e8d940af0ad3");
    expect(hex(rc4(bytesOf("Wiki"), bytesOf("pedia")))).toBe("1021bf0420");
    expect(hex(rc4(bytesOf("Secret"), bytesOf("Attack at dawn")))).toBe("45a01f645fc35b383552544b9bf5");
  });

  it("AES matches FIPS-197 and Node (CBC, 128 and 256 bit)", () => {
    const zero = new Uint8Array(16);
    const k128 = fromHex("000102030405060708090a0b0c0d0e0f");
    const pt = fromHex("00112233445566778899aabbccddeeff");
    expect(hex(aesCbcEncryptRaw(k128, zero, pt))).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
    expect(hex(aesCbcDecryptRaw(k128, zero, fromHex("69c4e0d86a7b0430d8cdb78070b4c55a")))).toBe(hex(pt));
    const k256 = fromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    expect(hex(aesCbcEncryptRaw(k256, zero, pt))).toBe("8ea2b7ca516745bfeafc49904b496089");
    expect(hex(aesCbcDecryptRaw(k256, zero, fromHex("8ea2b7ca516745bfeafc49904b496089")))).toBe(hex(pt));
    for (const klen of [16, 32]) {
      const key = rnd(klen);
      const iv = rnd(16);
      const data = rnd(16 * 37);
      const c = createCipheriv(klen === 16 ? "aes-128-cbc" : "aes-256-cbc", key, iv);
      c.setAutoPadding(false);
      const ct = new Uint8Array(Buffer.concat([c.update(data), c.final()]));
      expect(hex(aesCbcEncryptRaw(key, iv, data))).toBe(hex(ct));
      expect(hex(aesCbcDecryptRaw(key, iv, ct))).toBe(hex(data));
      const d = createDecipheriv(klen === 16 ? "aes-128-cbc" : "aes-256-cbc", key, iv);
      d.setAutoPadding(false);
      expect(hex(new Uint8Array(Buffer.concat([d.update(ct), d.final()])))).toBe(hex(data));
    }
  });

  it("aesDecryptPdf strips the IV and PKCS#5 padding and survives short or damaged input", () => {
    const key = rnd(16);
    const iv = rnd(16);
    const c = createCipheriv("aes-128-cbc", key, iv);
    const ct = new Uint8Array(Buffer.concat([c.update(bytesOf("hello pdf")), c.final()]));
    const data = new Uint8Array([...iv, ...ct]);
    expect(textOf(aesDecryptPdf(key, data))).toBe("hello pdf");
    expect(aesDecryptPdf(key, data.subarray(0, 10)).length).toBe(0);
    expect(() => aesDecryptPdf(key, data.subarray(0, 40))).not.toThrow();
  });
});

// ---- whole files -----------------------------------------------------------------------------------------------------

const TEXT = "BT /F1 12 Tf 72 700 Td (secret words) Tj ET";

function encryptedDoc(mode: EncMode, opts: { user?: string; owner?: string; encryptMetadata?: boolean } = {}, flate = false): Uint8Array {
  const enc = new Encryptor(mode, { userPassword: opts.user, ownerPassword: opts.owner, encryptMetadata: opts.encryptMetadata }, 20);
  const objs: Obj[] = [
    obj(1, "<< /Type /Catalog /Pages 2 0 R /Metadata 7 0 R >>"),
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>"),
    enc.stream(4, "", TEXT, flate),
    obj(5, `<< /Title ${enc.str(5, "Top secret title")} /Producer (not hex ${"x".repeat(3)}) >>`.replace("(not hex xxx)", enc.str(5, "Producer"))),
    obj(6, `[ ${enc.str(6, "in an array")} << /K ${enc.str(6, "in a dict")} >> ]`),
    enc.stream(7, "/Type /Metadata /Subtype /XML", "<x:xmpmeta/>"),
    enc.encryptObj,
  ];
  if (opts.encryptMetadata === false) objs[6] = { num: 7, body: `<< /Length 12 /Type /Metadata /Subtype /XML >>\nstream\n<x:xmpmeta/>\nendstream` };
  return buildClassic(objs, { info: 5, trailerExtra: enc.trailerExtra }).bytes;
}

const MODES: EncMode[] = ["rc4-40", "rc4-128", "aes-128", "aes-256-r5", "aes-256-r6"];

describe("encrypted files (empty user password)", () => {
  for (const mode of MODES) {
    it(`${mode}: strings and streams are decrypted at get time`, () => {
      for (const flate of [false, true]) {
        const f = PdfFile.open(encryptedDoc(mode, {}, flate));
        expect(f.encrypted).toBe(true);
        expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe(TEXT);
        const info = f.info()!;
        expect(pdfText(info.get("Title") as PdfString)).toBe("Top secret title");
        expect(pdfText(info.get("Producer") as PdfString)).toBe("Producer");
        const arr = f.getRef(6) as [PdfString, PdfDict];
        expect(pdfText(arr[0])).toBe("in an array");
        expect(pdfText(arr[1].get("K") as PdfString)).toBe("in a dict");
        expect(f.pageCount()).toBe(1);
      }
    });
  }

  it("does not decrypt the Encrypt dictionary", () => {
    const f = PdfFile.open(encryptedDoc("aes-128"));
    const enc = f.get(f.trailer.get("Encrypt")) as PdfDict;
    expect((enc.get("O") as PdfString).bytes.length).toBe(32);
    expect(enc.get("V")).toBe(4);
  });

  it("leaves metadata alone when EncryptMetadata is false", () => {
    for (const mode of ["rc4-128", "aes-128"] as EncMode[]) {
      const f = PdfFile.open(encryptedDoc(mode, { encryptMetadata: false }));
      expect(textOf(f.decode(f.getRef(7) as PdfStream))).toBe("<x:xmpmeta/>");
      expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe(TEXT);
    }
  });
});

describe("passwords", () => {
  for (const mode of MODES) {
    it(`${mode}: user and owner passwords, wrong and missing`, () => {
      const bytes = encryptedDoc(mode, { user: "open sesame", owner: "boss" });
      const needs = /password required/;
      expect(() => PdfFile.open(bytes)).toThrow(needs);
      expect(() => PdfFile.open(bytes, { password: "nope" })).toThrow(/wrong password/);
      try {
        PdfFile.open(bytes);
      } catch (e) {
        expect((e as { code: string }).code).toBe("unsupported");
      }
      for (const pw of ["open sesame", "boss"]) {
        const f = PdfFile.open(bytes, { password: pw });
        expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe(TEXT);
      }
    });
  }

  it("non-ASCII passwords (UTF-8 for AES-256, Latin-1 before)", () => {
    const b256 = encryptedDoc("aes-256-r6", { user: "pässwörd" });
    expect(PdfFile.open(b256, { password: "pässwörd" }).pageCount()).toBe(1);
    const b128 = encryptedDoc("rc4-128", { user: "pässwörd" });
    expect(PdfFile.open(b128, { password: "pässwörd" }).pageCount()).toBe(1);
  });
});

describe("crypt filters", () => {
  it("honours Identity for a stream with an explicit Crypt filter", () => {
    const enc = new Encryptor("aes-128", {}, 20);
    const objs: Obj[] = [
      ...simpleDoc(1).slice(0, 3),
      enc.stream(4, "", TEXT),
      streamObj(5, "/Filter [/Crypt] /DecodeParms [<< /Type /CryptFilterDecodeParms /Name /Identity >>]", "plain stream"),
      enc.encryptObj,
    ];
    const f = PdfFile.open(buildClassic(objs, { trailerExtra: enc.trailerExtra }).bytes);
    expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe(TEXT);
    expect(textOf(f.decode(f.getRef(5) as PdfStream))).toBe("plain stream");
  });

  it("StmF Identity leaves streams alone but still decrypts strings", () => {
    const enc = new Encryptor("aes-128", {}, 20);
    const encObj = obj(20, enc.encryptObj.body.toString().replace("/StmF /StdCF", "/StmF /Identity"));
    const objs: Obj[] = [...simpleDoc(1).slice(0, 3), streamObj(4, "", TEXT), obj(5, `<< /Title ${enc.str(5, "t")} >>`), encObj];
    const f = PdfFile.open(buildClassic(objs, { trailerExtra: enc.trailerExtra, info: 5 }).bytes);
    expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe(TEXT);
    expect(pdfText(f.info()!.get("Title") as PdfString)).toBe("t");
  });
});

describe("unsupported handlers", () => {
  it("a non-standard security handler is reported, not guessed", () => {
    const objs: Obj[] = [...simpleDoc(1).slice(0, 3), obj(20, "<< /Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s5 /V 4 >>")];
    expect(() => PdfFile.open(buildClassic(objs, { trailerExtra: "/Encrypt 20 0 R" }).bytes)).toThrow(/unsupported/);
  });
});
