// Optional: checks files written by the writer with three independent readers (qpdf via pikepdf, pypdf, MuPDF).
// Set PLI_PDF_PYTHON to a python that has pikepdf, pypdf and pymupdf.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfFile, PdfName, PdfString, pdfText } from "../src/cos";
import { Overlay, addStandardFont, createPdf, embedTrueType, makeImageXObject, pageRefs, setPages } from "../src/write";
import { readFileSync } from "node:fs";
import { finishPage, newPage } from "./support/build";
import { makePng } from "./support/png";

const python = process.env.PLI_PDF_PYTHON;
const script = new URL("../scripts/pdfcheck.py", import.meta.url).pathname;
const lora = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url)));

function check(path: string): { qpdf: { problems?: string[]; pages?: number; error?: string }; pypdf: { pages: { text: string; annots: unknown[] }[] }; mupdf: { pages: number; text: string[] } } {
  return JSON.parse(execFileSync(python!, [script, path], { encoding: "utf8", maxBuffer: 1 << 26 }));
}

function doc(): Overlay {
  const t = newPage(200, 200);
  const f = t.res.font(addStandardFont(t.overlay, "Times", { bold: true }));
  const e = embedTrueType(t.overlay, lora, { family: "Lora" });
  t.content.beginText().font(f, 16).textMove(10, 150).showText("Standard Times").endText();
  t.content.beginText().font(t.res.font(e.ref), 16).textMove(10, 120).showGlyphs(e.encode("Embedded Lora éñ")).endText();
  t.content.drawXObject(t.res.xobject(makeImageXObject(t.overlay, { png: makePng({ width: 2, height: 2, colorType: 6, depth: 8, sample: (x) => [255, 0, 0, x * 255] }) }).ref), 10, 10, 40, 40);
  e.finish();
  finishPage(t);
  t.overlay.editInfo().set("Title", pdfText("Check"));
  const annot = t.overlay.add(new PdfDict({ Type: PdfName.of("Annot"), Subtype: PdfName.of("Text"), Rect: [150, 150, 170, 170], Contents: new PdfString(new TextEncoder().encode("a note")) }));
  t.overlay.edit<PdfDict>(t.page).set("Annots", [annot]);
  return t.overlay;
}

describe.skipIf(!python)("independent readers", () => {
  it("open every kind of file the writer makes", () => {
    const dir = mkdtempSync(join(tmpdir(), "pli-pdf-"));
    const base = doc().rewrite();
    const files: Record<string, Uint8Array> = {
      plain: base,
      compressed: doc().rewrite({ compress: true }),
      objstm: doc().rewrite({ compress: true, objectStreams: true }),
      xref: doc().rewrite({ xrefStream: true }),
    };
    const upd = new Overlay(PdfFile.open(base));
    upd.editInfo().set("Title", pdfText("Updated"));
    upd.edit<PdfDict>(pageRefs(upd)[0]!).set("Rotate", 90);
    files.incremental = upd.incremental();
    const upd2 = new Overlay(PdfFile.open(files.objstm!));
    upd2.edit<PdfDict>(pageRefs(upd2)[0]!).set("Rotate", 90);
    files.incrementalOnStream = upd2.incremental();
    files.rewriteOfIncremental = new Overlay(PdfFile.open(files.incremental)).rewrite({ compress: true });
    const withJunk = new Overlay(PdfFile.open(base));
    const junk = [withJunk.add(pdfText("a")), withJunk.add(pdfText("b"))];
    const junked = withJunk.incremental();
    const freeing = new Overlay(PdfFile.open(junked));
    for (const j of junk) freeing.remove(j);
    files.freed = freeing.incremental();
    const freeingStream = new Overlay(PdfFile.open(new Overlay(PdfFile.open(files.objstm!)).rewrite({ xrefStream: true })));
    const j2 = freeingStream.add(pdfText("c"));
    const f2 = new Overlay(PdfFile.open(freeingStream.incremental()));
    f2.remove(j2);
    files.freedOnStream = f2.incremental();
    const copy = createPdf();
    setPages(copy, [copy.importPage(PdfFile.open(base), 0), copy.importPage(PdfFile.open(base), 0)]);
    files.copy = copy.rewrite();
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(dir, name + ".pdf");
      writeFileSync(path, bytes);
      const r = check(path);
      expect(r.qpdf.problems, name).toEqual([]);
      expect(r.qpdf.error, name).toBeUndefined();
      const pages = name === "copy" ? 2 : 1;
      expect(r.qpdf.pages, name).toBe(pages);
      expect(r.pypdf.pages.length, name).toBe(pages);
      expect(r.mupdf.pages, name).toBe(pages);
      expect(r.pypdf.pages[0]!.text, name).toContain("Standard Times");
      expect(r.pypdf.pages[0]!.text, name).toContain("Embedded Lora éñ");
      expect(r.mupdf.text[0], name).toContain("Embedded Lora");
      expect(r.pypdf.pages[0]!.annots.length, name).toBe(1);
    }
  });
});
