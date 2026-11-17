import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPdf, PdfDict, PdfFile, isDict, isName } from "../src";
import { appearanceMatrix } from "../src/forms/flatten";
import { renderPdf } from "./support/render";
import { buildClassic, obj, simpleDoc, streamObj } from "./support/handmade";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));

function widgetsOf(bytes: Uint8Array): number {
  const file = PdfFile.open(bytes);
  let n = 0;
  for (const p of file.pages()) {
    const annots = file.dictGet(p.dict, "Annots");
    if (Array.isArray(annots)) for (const a of annots) if (isDict(file.get(a)) && isName(file.dictGet(file.get(a) as PdfDict, "Subtype"), "Widget")) n++;
  }
  return n;
}

describe("flattening forms", () => {
  it("draws the filled fields into the page and removes the widgets and the form", async () => {
    const s = await openPdf(fixture("forms-basic"));
    s.forms.fill({ name: "Flat Name", agree: true, size: "1", colour: "Blue", fruit: ["Pear"], notes: "one\ntwo" });
    const live = await s.save();
    const result = await s.saveDetailed({ flatten: "forms" });
    expect(result.mode).toBe("rewrite");
    expect(widgetsOf(live)).toBeGreaterThan(5);
    expect(widgetsOf(result.bytes)).toBe(0);
    const file = PdfFile.open(result.bytes);
    expect(file.catalog().has("AcroForm")).toBe(false);
    const t = await openPdf(result.bytes);
    expect(t.doc.fields).toEqual([]);
    // the page looks the same as the form did (annotations drawn by pdf.js)
    const a = await renderPdf(live, 0, 2);
    const b = await renderPdf(result.bytes, 0, 2);
    const boxes: [number, number, number, number][] = [[80, 50, 200, 20], [80, 80, 200, 50], [80, 142, 14, 14], [110, 172, 14, 14], [80, 200, 120, 20], [80, 235, 120, 50]];
    for (const box of boxes) {
      const ia = a.inkIn(box[0], box[1], box[2], box[3]);
      const ib = b.inkIn(box[0], box[1], box[2], box[3]);
      expect(ib, `box ${box}`).toBeGreaterThan(ia * 0.7);
      expect(ib, `box ${box}`).toBeLessThan(ia * 1.3 + 3);
    }
    // the page's own text stays
    expect(b.text).toContain("Sample form");
  });

  it("makes appearances for a form that said they were out of date", async () => {
    const s = await openPdf(fixture("forms-acro"));
    const flat = await s.save({ flatten: "forms" });
    expect(widgetsOf(flat)).toBe(0);
    const r = await renderPdf(flat, 0, 3);
    expect(r.inkIn(20, 30, 180, 20)).toBeGreaterThan(80); // "Ada" in the first name box
    expect(r.inkIn(20, 160, 120, 20)).toBeGreaterThan(40); // "France"
    expect(r.inkIn(60, 126, 14, 14)).toBeGreaterThan(20); // radio B is on (a square)
  });

  it("does not draw hidden widgets, but removes them", async () => {
    const objs = simpleDoc(1).map((o) => (o.num === 1 ? obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 10 0 R >>") : o.num === 3 ? obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [11 0 R 12 0 R] >>") : o));
    objs.push(obj(10, "<< /Fields [11 0 R 12 0 R] >>"));
    objs.push(obj(11, "<< /FT /Tx /T (shown) /Subtype /Widget /Rect [10 10 60 40] /F 4 /AP << /N 13 0 R >> >>"));
    objs.push(obj(12, "<< /FT /Tx /T (hidden) /Subtype /Widget /Rect [100 10 150 40] /F 2 /AP << /N 13 0 R >> >>"));
    objs.push(streamObj(13, "/Type /XObject /Subtype /Form /BBox [0 0 50 30]", "0 0 0 rg 0 0 50 30 re f"));
    const flat = await (await openPdf(buildClassic(objs).bytes)).save({ flatten: "forms" });
    const r = await renderPdf(flat, 0, 2);
    expect(r.inkIn(10, 160, 50, 30)).toBeGreaterThan(1000);
    expect(r.inkIn(100, 160, 50, 30)).toBe(0);
    expect(widgetsOf(flat)).toBe(0);
  });

  it("maps the form's matrix and box onto the rectangle (ISO 32000-1 12.5.5)", () => {
    // unit box to a rectangle
    expect(appearanceMatrix([0, 0, 10, 10], [1, 0, 0, 1, 0, 0], [20, 30, 40, 70])).toEqual([2, 0, 0, 4, 20, 30]);
    // a box that does not start at the origin
    expect(appearanceMatrix([10, 10, 30, 20], [1, 0, 0, 1, 0, 0], [0, 0, 20, 10])).toEqual([1, 0, 0, 1, -10, -10]);
    // turned a quarter (the form's own matrix turns it): the transformed box is 10 wide and 20 high
    const m = appearanceMatrix([0, 0, 20, 10], [0, 1, -1, 0, 10, 0], [100, 100, 110, 120]);
    expect(m).toEqual([1, 0, 0, 1, 100, 100]);
  });

  it("flattens fields made in the same save", async () => {
    const s = await openPdf(buildClassic(simpleDoc(1, { mediaBox: "[0 0 300 300]" })).bytes);
    s.forms.addField(s.doc.pages[0]!.id, { type: "text", name: "t", rect: { x: 10, y: 10, w: 120, h: 24 }, value: "Printed" });
    s.forms.addField(s.doc.pages[0]!.id, { type: "checkbox", name: "c", rect: { x: 10, y: 50, w: 16, h: 16 }, value: true });
    const flat = await s.save({ flatten: "forms" });
    expect(widgetsOf(flat)).toBe(0);
    const r = await renderPdf(flat, 0, 3);
    expect(r.inkIn(12, 12, 116, 20)).toBeGreaterThan(80);
    expect(r.inkIn(12, 52, 12, 12)).toBeGreaterThan(15);
  });
});
