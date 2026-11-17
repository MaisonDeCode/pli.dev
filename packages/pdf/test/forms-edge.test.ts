import { describe, expect, it } from "vitest";
import { openPdf, PdfDict, PdfFile, createPdf, isDict, isName, pageRefs, parseObject } from "../src";
import type { PdfDoc, WriteContext } from "../src";
import { writeForms } from "../src/forms/write";
import { renderPdf } from "./support/render";
import { buildClassic, obj, simpleDoc, streamObj } from "./support/handmade";

function formDoc(extra: { pageExtra?: string; mediaBox?: string; widget: string; field?: string }) {
  const objs = simpleDoc(1, { mediaBox: extra.mediaBox ?? "[0 0 300 300]" }).map((o) =>
    o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o.num === 3 ? obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox ${extra.mediaBox ?? "[0 0 300 300]"} /Contents 4 0 R /Annots [11 0 R] ${extra.pageExtra ?? ""} >>`) : o,
  );
  objs.push(obj(10, "<< /Fields [11 0 R] /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> >> >>"));
  objs.push(obj(11, `<< /FT /Tx /T (a) /Subtype /Widget /Type /Annot /P 3 0 R ${extra.widget} >>`));
  return buildClassic(objs).bytes;
}

describe("page boxes and rotation", () => {
  it("uses the crop box as the origin of page space", async () => {
    const bytes = formDoc({ pageExtra: "/CropBox [50 100 250 300]", widget: "/Rect [60 250 160 280] /MK << /BC [0 0 0] >>" });
    const s = await openPdf(bytes);
    const f = s.forms.byName("a")!;
    expect(f.widgets[0]!.rect).toEqual({ x: 10, y: 20, w: 100, h: 30 });
    s.forms.fill({ a: "Cropped" });
    s.forms.addField(s.doc.pages[0]!.id, { type: "text", name: "b", rect: { x: 10, y: 100, w: 100, h: 30 }, value: "New" });
    const out = await s.save();
    const t = await openPdf(out);
    expect(t.forms.byName("b")!.widgets[0]!.rect).toEqual({ x: 10, y: 100, w: 100, h: 30 });
    const file = PdfFile.open(out);
    const d = file.getRef(Number(t.forms.byName("b")!.widgets[0]!.ref!.split(" ")[0])) as PdfDict;
    expect(file.dictGet(d, "Rect")).toEqual([60, 170, 160, 200]);
    const r = await renderPdf(out, 0, 3);
    expect(r.inkIn(12, 22, 96, 26)).toBeGreaterThan(50);
    expect(r.inkIn(12, 102, 96, 26)).toBeGreaterThan(30);
  });

  it("keeps rectangles in unrotated page space on a rotated page", async () => {
    const bytes = formDoc({ pageExtra: "/Rotate 90", widget: "/Rect [10 10 110 40]" });
    const s = await openPdf(bytes);
    expect(s.forms.byName("a")!.widgets[0]!.rect).toEqual({ x: 10, y: 260, w: 100, h: 30 });
    s.forms.fill({ a: "Turned" });
    const t = await openPdf(await s.save());
    expect(t.forms.byName("a")).toMatchObject({ value: "Turned", widgets: [{ rect: { x: 10, y: 260, w: 100, h: 30 } }] });
  });
});

describe("text", () => {
  it("round-trips brackets, backslashes, quotes and non-Latin text", async () => {
    const s = await openPdf(formDoc({ widget: "/Rect [10 10 200 40]" }));
    for (const text of ["a (b) c", "back\\slash", "tab\tand\nbreak", "café €", "你好 😀", ""]) {
      s.forms.fill({ a: text });
      const t = await openPdf(await s.save({ fonts: {} }));
      expect(t.forms.byName("a")?.value, JSON.stringify(text)).toBe(text);
    }
  });

  it("draws a widget turned a quarter (/MK /R 90) along its long side", async () => {
    const s = await openPdf(formDoc({ widget: "/Rect [20 20 50 220] /MK << /R 90 /BC [0 0 0] >>" }));
    s.forms.fill({ a: "Vertical text" });
    const r = await renderPdf(await s.save(), 0, 3);
    // the field is 30 wide and 200 high: the text starts at its bottom and reads upward, inside its width
    expect(r.inkIn(22, 220, 26, 58)).toBeGreaterThan(30);
    expect(r.inkIn(22, 175, 26, 45)).toBeGreaterThan(30);
    expect(r.inkIn(22, 82, 26, 60)).toBe(0);
    expect(r.inkIn(54, 80, 40, 200)).toBe(0);
  });
});

describe("pages that are gone", () => {
  it("takes the fields of a deleted page out of the form", async () => {
    const objs = simpleDoc(2).map((o) =>
      o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o.num === 3 ? obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 5 0 R /Annots [11 0 R] >>") : o.num === 4 ? obj(4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 6 0 R /Annots [12 0 R] >>") : o,
    );
    objs.push(obj(10, "<< /Fields [11 0 R 12 0 R] /DA (/Helv 0 Tf 0 g) >>"));
    objs.push(obj(11, "<< /FT /Tx /T (one) /Subtype /Widget /Rect [10 10 100 30] /P 3 0 R >>"));
    objs.push(obj(12, "<< /FT /Tx /T (two) /Subtype /Widget /Rect [10 10 100 30] /P 4 0 R >>"));
    const s = await openPdf(buildClassic(objs).bytes);
    s.pages.remove([s.doc.pages[0]!.id]);
    const out = await s.save();
    const t = await openPdf(out);
    expect(t.doc.fields.map((f) => f.name)).toEqual(["two"]);
  });
});

describe("widgets that came with copied pages", () => {
  it("are put in the form, with their font", async () => {
    const main = buildClassic(simpleDoc(1)).bytes;
    const srcObjs = simpleDoc(1).map((o) => (o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o.num === 3 ? obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Annots [11 0 R] >>") : o));
    srcObjs.push(obj(10, "<< /Fields [12 0 R] /DR << /Font << /Fx << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >> >> >> >>"));
    srcObjs.push(obj(12, "<< /T (group) /FT /Tx /DA (/Fx 10 Tf 0 g) /Kids [11 0 R] >>"));
    srcObjs.push(obj(11, "<< /Parent 12 0 R /Subtype /Widget /Type /Annot /Rect [10 10 100 30] /V (copied) /T (leaf) >>"));
    const source = PdfFile.open(buildClassic(srcObjs).bytes);
    const mainFile = PdfFile.open(main);
    const { Overlay } = await import("../src");
    const overlay = new Overlay(mainFile);
    const copy = overlay.importPage(source, 0);
    const doc: PdfDoc = { id: "d", meta: {}, sources: [], pages: [{ id: "p:main:0", from: { source: "main", index: 0 }, width: 612, height: 792, rotate: 0, annots: [] }, { id: "n", from: { source: "other", index: 0 }, width: 612, height: 792, rotate: 0, annots: [] }], outline: [], fields: [] };
    const ctx: WriteContext = { overlay, doc, baseline: doc, main: mainFile, sources: new Map([["other", source]]), pageRefs: new Map([["n", copy]]), options: {}, rewrite: false, now: 0, warnings: [] };
    writeForms(ctx);
    const out = overlay.incremental();
    const file = PdfFile.open(out);
    const form = file.dictGet(file.catalog(), "AcroForm") as PdfDict;
    expect(isDict(form)).toBe(true);
    expect((file.dictGet(form, "Fields") as unknown[]).length).toBe(1);
    const fonts = file.dictGet(file.dictGet(form, "DR") as PdfDict, "Font") as PdfDict;
    expect(fonts.has("Fx")).toBe(true);
    // pdf.js and our own reader both see the field, flat-named as the copy rule says
    const t = await openPdf(out);
    expect(t.doc.fields.map((f) => [f.name, f.value])).toEqual([["group.leaf", "copied"]]);
    void pageRefs; void parseObject; void createPdf; void isName; void streamObj;
  });
});

describe("digital signatures", () => {
  function signed(): Uint8Array {
    const objs = simpleDoc(1).map((o) => (o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o.num === 3 ? obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Annots [11 0 R 12 0 R] >>") : o));
    objs.push(obj(10, "<< /Fields [11 0 R 12 0 R] /SigFlags 3 /DA (/Helv 0 Tf 0 g) >>"));
    objs.push(obj(11, "<< /FT /Sig /T (sign) /Subtype /Widget /Rect [10 10 110 40] /P 3 0 R /V 13 0 R >>"));
    objs.push(obj(12, "<< /FT /Tx /T (note) /Subtype /Widget /Rect [10 60 110 80] /P 3 0 R >>"));
    objs.push(obj(13, "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0 0 0] /Contents <00> >>"));
    return buildClassic(objs).bytes;
  }

  it("reads a signed field and keeps the file's bytes when a form is filled", async () => {
    const bytes = signed();
    const s = await openPdf(bytes);
    expect(s.forms.byName("sign")).toMatchObject({ type: "signature", signed: true, value: null });
    expect(() => s.forms.fill({ sign: "x" })).toThrow(/cannot be filled/);
    s.forms.fill({ note: "after signing" });
    const r = await s.saveDetailed();
    expect(r.mode).toBe("incremental");
    expect(r.warnings).toEqual([]);
    expect(r.bytes.subarray(0, bytes.length)).toEqual(bytes);
    const t = await openPdf(r.bytes);
    expect(t.forms.byName("sign")?.signed).toBe(true);
    expect(t.forms.byName("note")?.value).toBe("after signing");
    // the signature value itself is untouched
    const file = PdfFile.open(r.bytes);
    expect(isDict(file.getRef(13))).toBe(true);
  });

  it("warns when a save has to write a new file", async () => {
    const s = await openPdf(signed());
    s.forms.fill({ note: "x" });
    const rewritten = await s.saveDetailed({ mode: "rewrite" });
    expect(rewritten.warnings.join(" ")).toMatch(/digital signature/);
    const flat = await s.saveDetailed({ flatten: "forms" });
    expect(flat.warnings.filter((w) => /digital signature/.test(w))).toHaveLength(1);
  });
});
