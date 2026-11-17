import { describe, expect, it } from "vitest";
import { PdfDict, PdfFile, PdfName, PdfRef, PdfStream, PdfString, bytesToLatin1, isDict, isRef, isStream, pdfText, textOf } from "../src/cos";
import type { PdfObj } from "../src/cos";
import { Overlay, addStandardFont, createPdf, makeImageXObject, pageRefs, setPages } from "../src/write";
import { renderPdf } from "./support/render";
import { makePng } from "./support/png";

const N = PdfName.of;
const s = (t: string) => new PdfString(new TextEncoder().encode(t));

/** Two pages. Page 1 inherits its MediaBox and Resources from the tree root; it has a picture, a font, split content, and annotations of every kind that points elsewhere. */
function source(): Uint8Array {
  const o = createPdf();
  const font = addStandardFont(o, "Times");
  const img = makeImageXObject(o, { png: makePng({ width: 2, height: 2, colorType: 2, depth: 8, sample: () => [0, 0, 255] }) });
  const c1 = o.add(new PdfStream(new PdfDict(), new TextEncoder().encode("q 1 0 0 rg 10 10 50 50 re f Q BT /F1 12 Tf 70 30 Td (Copied) Tj ET")));
  const c2 = o.add(new PdfStream(new PdfDict(), new TextEncoder().encode("q 50 0 0 50 120 10 cm /Im1 Do Q")));
  const page1 = o.add(new PdfDict({ Type: N("Page"), Contents: [c1, c2], StructParents: 0, Thumb: c1, B: [] }));
  const page2 = o.add(new PdfDict({ Type: N("Page"), Contents: o.add(new PdfStream(new PdfDict(), new Uint8Array())) }));
  const root = o.catalog().get("Pages") as PdfRef;
  const rd = o.edit<PdfDict>(root);
  rd.set("MediaBox", [0, 0, 220, 100]).set("Resources", new PdfDict({ Font: new PdfDict({ F1: font }), XObject: new PdfDict({ Im1: img.ref }) }));
  setPages(o, [page1, page2]);
  // annotations
  const popup = o.add(new PdfDict({ Type: N("Annot"), Subtype: N("Popup"), Rect: [0, 0, 10, 10] }));
  const note = o.add(new PdfDict({ Type: N("Annot"), Subtype: N("Text"), Rect: [5, 5, 20, 20], Contents: s("note"), Popup: popup, P: page1, StructParent: 3 }));
  o.edit<PdfDict>(popup).set("Parent", note);
  const toPage2 = o.add(new PdfDict({ Type: N("Annot"), Subtype: N("Link"), Rect: [0, 0, 5, 5], Dest: [page2, N("Fit")], P: page1 }));
  const goTo = o.add(new PdfDict({ Type: N("Annot"), Subtype: N("Link"), Rect: [0, 0, 5, 5], A: new PdfDict({ S: N("GoTo"), D: [page2, N("XYZ"), 0, 0, null] }) }));
  const named = o.add(new PdfDict({ Type: N("Annot"), Subtype: N("Link"), Rect: [0, 0, 5, 5], Dest: s("chapter1") }));
  const uri = o.add(new PdfDict({ Type: N("Annot"), Subtype: N("Link"), Rect: [0, 0, 5, 5], A: new PdfDict({ S: N("URI"), URI: s("https://example.com/") }) }));
  const parentField = o.add(new PdfDict({ T: s("form"), FT: N("Tx"), V: s("hello"), DA: s("/Helv 0 Tf") }));
  const widget = o.add(new PdfDict({ Type: N("Annot"), Subtype: N("Widget"), Rect: [30, 30, 90, 50], T: s("name"), Parent: parentField, P: page1 }));
  o.edit<PdfDict>(parentField).set("Kids", [widget]);
  o.editCatalog().set("AcroForm", new PdfDict({ Fields: [parentField] })).set("StructTreeRoot", new PdfDict({ Type: N("StructTreeRoot") }));
  o.edit<PdfDict>(page1).set("Annots", [note, popup, toPage2, goTo, named, uri, widget]);
  return o.rewrite();
}

const annotsOf = (f: Overlay | PdfFile, page: PdfRef): PdfDict[] => {
  const d = f.get(page) as PdfDict;
  return (f.get(d.get("Annots")) as PdfObj[]).map((r) => f.get(r) as PdfDict);
};

describe("importPage", () => {
  it("copies a page with its inherited resources into a new file, and it renders", async () => {
    const src = PdfFile.open(source());
    const o = createPdf();
    const p = o.importPage(src, 0);
    setPages(o, [p]);
    const out = o.rewrite({ compress: true });
    const f = PdfFile.open(out);
    expect(f.pageCount()).toBe(1);
    const page = f.pages()[0]!;
    expect(page.mediaBox).toEqual([0, 0, 220, 100]);
    expect(page.dict.has("StructParents")).toBe(false);
    expect(page.dict.has("Thumb")).toBe(false);
    const r = await renderPdf(out, 0, 2);
    expect(r.text).toContain("Copied");
    expect(r.pixel(30, 70)).toEqual([255, 0, 0, 255]); // red square: y from top = 100 - 35
    const blue = r.pixel(145, 65);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(60);
  });

  it("drops what would drag the rest of the file along and keeps annotations that still work", () => {
    const src = PdfFile.open(source());
    const o = createPdf();
    const p = o.importPage(src, 0);
    setPages(o, [p]);
    const out = PdfFile.open(o.rewrite());
    // nothing of page 2, the form tree or the structure tree came along
    expect(out.objectNumbers().length).toBeLessThan(src.objectNumbers().length);
    expect(out.catalog().has("StructTreeRoot")).toBe(false);
    expect(out.catalog().has("AcroForm")).toBe(false);
    const annots = annotsOf(out, out.pages()[0]!.ref);
    const kinds = annots.map((a) => (a.get("Subtype") as PdfName).value + (a.has("Dest") ? "+Dest" : "") + (a.has("A") ? "+A" : ""));
    expect(kinds).toEqual(["Text", "Popup", "Link", "Link", "Link", "Link+A", "Widget"]);
    const [note, popup, , , named, , widget] = annots as [PdfDict, PdfDict, PdfDict, PdfDict, PdfDict, PdfDict, PdfDict];
    // note and popup point at each other, in the new file; /P is the new page; StructParent is gone
    expect(out.get(note.get("Popup"))).toBe(popup);
    expect(out.get(popup.get("Parent"))).toBe(note);
    expect(note.get("P")).toEqual(out.pages()[0]!.ref);
    expect(note.has("StructParent")).toBe(false);
    expect(named.has("Dest")).toBe(false); // named destination of another file
    // the widget is a self-contained field with the full name and the inherited attributes
    expect(widget.has("Parent")).toBe(false);
    expect(textOf(widget.get("T") as PdfString)).toBe("form.name");
    expect((out.get(widget.get("FT")) as PdfName).value).toBe("Tx");
    expect(textOf(widget.get("V") as PdfString)).toBe("hello");
    expect(textOf(widget.get("DA") as PdfString)).toBe("/Helv 0 Tf");
  });

  it("keeps a link to a page that was imported too", () => {
    const src = PdfFile.open(source());
    const o = createPdf();
    const p2 = o.importPage(src, 1);
    const p1 = o.importPage(src, 0);
    setPages(o, [p1, p2]);
    const out = PdfFile.open(o.rewrite());
    const annots = annotsOf(out, out.pages()[0]!.ref);
    const link = annots[2]!;
    const dest = out.get(link.get("Dest")) as PdfObj[];
    expect(dest[0]).toEqual(out.pages()[1]!.ref);
    const goTo = out.get(annots[3]!.get("A")) as PdfDict;
    expect((out.get(goTo.get("D")) as PdfObj[])[0]).toEqual(out.pages()[1]!.ref);
  });

  it("imports the same page twice: shared fonts and pictures, separate pages and annotations", () => {
    const src = PdfFile.open(source());
    const o = createPdf();
    const a = o.importPage(src, 0);
    const b = o.importPage(src, 0);
    expect(a.num).not.toBe(b.num);
    setPages(o, [a, b]);
    const out = PdfFile.open(o.rewrite());
    const [pa, pb] = out.pages() as [ReturnType<PdfFile["pages"]>[number], ReturnType<PdfFile["pages"]>[number]];
    const fa = out.get(pa.dict.get("Resources")) as PdfDict;
    const fb = out.get(pb.dict.get("Resources")) as PdfDict;
    expect(fa.get("Font")).toEqual(fb.get("Font"));
    const na = annotsOf(out, pa.ref)[0]!;
    const nb = annotsOf(out, pb.ref)[0]!;
    expect(na).not.toBe(nb);
    expect(na.get("P")).toEqual(pa.ref);
    expect(nb.get("P")).toEqual(pb.ref);
  });

  it("duplicates a page inside one file", () => {
    const base = source();
    const o = new Overlay(PdfFile.open(base));
    const dup = o.importPage(o.base!, 0);
    setPages(o, [...pageRefs(o), dup]);
    const f = PdfFile.open(o.incremental());
    expect(f.pageCount()).toBe(3);
    const annots = annotsOf(f, f.pages()[2]!.ref);
    // links to page 2 still work (same file), and they point at the original page 2
    expect((f.get(annots[2]!.get("Dest")) as PdfObj[])[0]).toEqual(f.pages()[1]!.ref);
    expect(annots[0]!.get("P")).toEqual(f.pages()[2]!.ref);
    // the original page is untouched
    expect(annotsOf(f, f.pages()[0]!.ref)[0]!.get("P")).toEqual(f.pages()[0]!.ref);
  });

  it("copyFrom copies graphs, shares what was copied before, and keeps streams as they are", () => {
    const src = PdfFile.open(source());
    const o = createPdf();
    const contents = src.pages()[0]!.dict.get("Contents") as PdfRef[];
    const [one] = o.copyFrom(src, [contents[0]!]) as [PdfRef];
    const [again] = o.copyFrom(src, [contents[0]!]) as [PdfRef];
    expect(again).toEqual(one);
    const copied = o.get(one);
    expect(isStream(copied)).toBe(true);
    expect(bytesToLatin1((copied as PdfStream).data)).toContain("Copied");
    // a font dictionary with an indirect widths array, deep copied
    const res = src.pages()[0]!.dict.get("Resources") as PdfDict;
    const [fontDict] = o.copyFrom(src, [(res.get("Font") as PdfDict).get("F1")!]) as [PdfRef];
    expect(isRef(fontDict)).toBe(true);
    expect(isDict(o.get(fontDict))).toBe(true);
    expect(() => o.importPage(src, 5)).toThrow(/no page 6/);
  });
});
