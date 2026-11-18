import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfFile, PdfName, PdfStream, PdfString, textOf as pdfText } from "../src/cos";
import { Overlay } from "../src/cos/overlay";
import { Encryptor, buildClassic, bytesOf, simpleDoc, textOf, type EncMode } from "./support/handmade";

const here = dirname(fileURLToPath(import.meta.url));
const py = process.env.PLI_PDF_PYTHON;
const fixture = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));

const NEW_TEXT = "BT /F1 12 Tf 10 10 Td (appended content) Tj ET";

function append(bytes: Uint8Array, password?: string) {
  const base = PdfFile.open(bytes, { password });
  const o = new Overlay(base);
  const info = o.add(new PdfDict({ Title: new PdfString(bytesOf("Added title")), Note: [new PdfString(bytesOf("in array"))] }));
  const stream = o.add(new PdfStream(new PdfDict({ Custom: PdfName.of("Yes") }), bytesOf(NEW_TEXT)));
  const out = o.incremental();
  return { out, info, stream };
}

describe("PdfFile.encryptor and incremental updates of encrypted files", () => {
  const cases: [string, string | undefined][] = [
    ["enc-rc4-40.pdf", undefined],
    ["enc-rc4-128.pdf", undefined],
    ["enc-aes-128.pdf", undefined],
    ["enc-aes-256.pdf", undefined],
    ["enc-aes-128-objstm.pdf", undefined],
    ["enc-aes-256-objstm.pdf", undefined],
    ["enc-rc4-128-pw.pdf", "user pw"],
    ["enc-aes-128-pw.pdf", "user pw"],
    ["enc-aes-256-pw.pdf", "own pw"],
  ];
  for (const [name, pw] of cases) {
    it(name, async () => {
      const original = fixture(name);
      const { out, info, stream } = append(original, pw);
      expect(out.subarray(0, original.length)).toEqual(original); // the old bytes are untouched
      // the new objects are not stored in the clear
      expect(textOf(out.subarray(original.length)).includes("Added title")).toBe(false);
      expect(textOf(out.subarray(original.length)).includes("appended content")).toBe(false);
      const f = PdfFile.open(out, { password: pw });
      expect(f.repaired).toBe(false);
      expect(pdfText(((f.getRef(info.num) as PdfDict).get("Title")) as PdfString)).toBe("Added title");
      expect(pdfText(((f.getRef(info.num) as PdfDict).get("Note") as PdfString[])[0]!)).toBe("in array");
      expect(textOf(f.decode(f.getRef(stream.num) as PdfStream))).toBe(NEW_TEXT);
      // old content still reads
      expect(f.pageCount()).toBe(1);
      const doc = await pdfjs.getDocument({ data: out.slice(), password: pw, verbosity: 0, isEvalSupported: false, useWorkerFetch: false } as never).promise;
      expect(doc.numPages).toBe(1);
      await doc.loadingTask.destroy();
    });
  }

  it("does not encrypt XRef/Identity streams or unencrypted metadata, and encrypts the rest (own encryptor files)", () => {
    for (const mode of ["rc4-128", "aes-128", "aes-256-r6"] as EncMode[]) {
      const enc = new Encryptor(mode, { encryptMetadata: false }, 20);
      const base = buildClassic([...simpleDoc(1).slice(0, 3), enc.stream(4, "", "(x)"), enc.encryptObj], { trailerExtra: enc.trailerExtra }).bytes;
      const f = PdfFile.open(base);
      const o = new Overlay(f);
      const meta = o.add(new PdfStream(new PdfDict({ Type: PdfName.of("Metadata"), Subtype: PdfName.of("XML") }), bytesOf("<x:xmpmeta/>")));
      const ident = o.add(new PdfStream(new PdfDict({ Filter: [PdfName.of("Crypt")], DecodeParms: [new PdfDict({ Name: PdfName.of("Identity") })] }), bytesOf("plain bytes")));
      const out = o.incremental();
      const tail = textOf(out.subarray(base.length));
      expect(tail.includes("<x:xmpmeta/>")).toBe(true); // EncryptMetadata false: left in the clear
      expect(tail.includes("plain bytes")).toBe(true); // Identity crypt filter: left in the clear
      const g = PdfFile.open(out);
      expect(textOf(g.decode(g.getRef(meta.num) as PdfStream))).toBe("<x:xmpmeta/>");
      expect(textOf(g.decode(g.getRef(ident.num) as PdfStream))).toBe("plain bytes");
    }
  });

  it("an unencrypted file has no encryptor", () => {
    const f = PdfFile.open(buildClassic(simpleDoc(1)).bytes);
    expect(f.encryptor(5)).toBeUndefined();
  });

  it("AES output has a fresh IV each time; RC4 output is deterministic", () => {
    const data = bytesOf("round trip ".repeat(5));
    const aes = PdfFile.open(fixture("enc-aes-128.pdf")).encryptor(77)!;
    expect(aes.string(data)).not.toEqual(aes.string(data));
    expect(aes.string(data).length).toBe(16 + 64); // IV + 55 bytes padded to 64
    const rc = PdfFile.open(fixture("enc-rc4-128.pdf")).encryptor(77)!;
    expect(rc.string(data)).toEqual(rc.string(data));
    expect(rc.string(data).length).toBe(data.length);
  });

  const check = py ? it : it.skip;
  check("qpdf, pikepdf and pypdf read the objects we appended", () => {
    const dir = mkdtempSync(join(tmpdir(), "pli-pdf-enc-"));
    try {
      for (const [name, pw] of cases) {
        const { out, info, stream } = append(fixture(name), pw);
        const path = join(dir, name);
        writeFileSync(path, out);
        const script = `
import pikepdf, sys, json
pdf = pikepdf.open(sys.argv[1], password=sys.argv[2])
problems = []
t = pdf.get_object((${info.num}, 0))
s = pdf.get_object((${stream.num}, 0))
print(json.dumps({"problems": problems, "title": str(t.Title), "note": str(t.Note[0]), "stream": s.read_bytes().decode("latin1"), "pages": len(pdf.pages)}))
`;
        const res = JSON.parse(execFileSync(py!, ["-I", "-c", script, path, pw ?? ""], { encoding: "utf8" }).trim().split("\n").pop()!);
        expect(res.problems, name).toEqual([]);
        expect(res.title, name).toBe("Added title");
        expect(res.note, name).toBe("in array");
        expect(res.stream, name).toBe(NEW_TEXT);
        expect(res.pages, name).toBe(1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
