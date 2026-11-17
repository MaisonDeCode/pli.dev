import { describe, expect, it } from "vitest";
import { openPdf, makeSamplePdf, PdfDict, PdfFile, PdfStream, signatureOf, coveredNames, type Annotation, type Rect, type SignatureAnnot } from "../src";
import { decodeStream } from "../src/cos/filters";
import { buildClassic, obj, streamObj } from "./support/handmade";
import { renderPdf } from "./support/render";

// Signing a signature field: the signature goes INSIDE the field's box, as big as fits with its own proportions, as one undo step, and
// the field then draws nothing of its own (no caption such as "Sign here") until the signature is removed.

const sig = (a: Annotation | undefined): SignatureAnnot => a as SignatureAnnot;
const inside = (r: Rect, box: Rect, eps = 0.01) => r.x >= box.x - eps && r.y >= box.y - eps && r.x + r.w <= box.x + box.w + eps && r.y + r.h <= box.y + box.h + eps;
const draw = (w: number, h: number) => ({ mode: "draw" as const, strokes: [[[0, h / 2], [w / 4, 0], [w / 2, h], [w, h / 2]] as [number, number][]], box: { width: w, height: h }, color: "#112233", width: 2 });

const signatures = (s: { doc: { pages: { annots: Annotation[] }[] } }) => s.doc.pages.flatMap((p) => p.annots).filter((a) => a.type === "signature").map((a) => a.id);

async function sample() {
  const session = await openPdf(await makeSamplePdf());
  return { session, field: session.forms.byName("signature")!, page: session.doc.pages[0]! };
}

describe("forms.sign", () => {
  it("puts a drawn signature inside the field's box, scaled to fit with its proportions kept", async () => {
    const { session, field, page } = await sample();
    const box = field.widgets[0]!.rect; // 240 x 44
    const id = session.forms.sign(field.id, draw(300, 60));
    const a = sig(session.annots.get(id));
    expect(a.type).toBe("signature");
    expect(a.field).toBe("signature");
    expect(inside(a.rect, box)).toBe(true);
    // 5 : 1 stays 5 : 1, and it is as big as the box allows (the height limits it)
    expect(a.rect.w / a.rect.h).toBeCloseTo(5, 1);
    expect(a.rect.h).toBeGreaterThan(box.h - 6);
    // centred in the box
    expect(a.rect.x - box.x).toBeCloseTo(box.x + box.w - (a.rect.x + a.rect.w), 1);
    expect(a.rect.y - box.y).toBeCloseTo(box.y + box.h - (a.rect.y + a.rect.h), 1);
    // the strokes follow the scale and stay inside the rectangle
    const k = a.rect.w / 300;
    expect(a.strokes![0]![3]![0]).toBeCloseTo(300 * k, 1);
    expect(a.strokes!.flat().every((p) => p[0] >= 0 && p[0] <= a.rect.w + 0.01 && p[1] >= 0 && p[1] <= a.rect.h + 0.01)).toBe(true);
    // it is on the field's page, selected, and the field is covered
    expect(page.annots.filter((x) => x.type === "signature")).toHaveLength(0); // (the page's links are not signatures)
    expect(session.doc.pages[0]!.annots.filter((x) => x.type === "signature").map((x) => x.id)).toEqual([id]);
    expect(session.selection.annots).toEqual([id]);
    expect(signatureOf(session.doc, field)?.id).toBe(id);
    expect([...coveredNames(session.doc)]).toEqual(["signature"]);
  });

  it("fits a tall signature by its width, a typed name and a picture, always inside the box", async () => {
    const { session, field } = await sample();
    const box = field.widgets[0]!.rect;
    const tall = sig(session.annots.get(session.forms.sign(field.id, draw(40, 120))));
    expect(inside(tall.rect, box)).toBe(true);
    expect(tall.rect.w / tall.rect.h).toBeCloseTo(1 / 3, 2);
    expect(tall.rect.h).toBeGreaterThan(box.h - 6);
    const typed = sig(session.annots.get(session.forms.sign(field.id, { mode: "type", text: "Grace Hopper", font: "Dancing Script", color: "#000000" })));
    expect(inside(typed.rect, box)).toBe(true);
    expect(typed.text).toBe("Grace Hopper");
    const picture = { src: "data:image/png;base64,iVBORw0KGgo=", width: 400, height: 100 };
    const image = sig(session.annots.get(session.forms.sign(field.id, { mode: "image", picture })));
    expect(inside(image.rect, box)).toBe(true);
    expect(image.rect.w / image.rect.h).toBeCloseTo(4, 1);
    // a box that is tall and narrow
    const narrow = await openPdf(await makeSamplePdf());
    const f2 = narrow.forms.byName("signature")!;
    narrow.forms.setRect(f2.widgets[0]!.id, { x: 100, y: 100, w: 40, h: 120 });
    const wide = sig(narrow.annots.get(narrow.forms.sign(f2.id, draw(300, 60))));
    expect(inside(wide.rect, { x: 100, y: 100, w: 40, h: 120 })).toBe(true);
    expect(wide.rect.w / wide.rect.h).toBeCloseTo(5, 1);
  });

  it("is one undo step, and undo takes the signature away and uncovers the field", async () => {
    const { session, field } = await sample();
    expect(session.canUndo).toBe(false);
    const id = session.forms.sign(field.id, draw(300, 60));
    expect(session.canUndo).toBe(true);
    session.undo();
    expect(signatures(session)).toHaveLength(0);
    expect(signatureOf(session.doc, field)).toBeUndefined();
    expect(coveredNames(session.doc).size).toBe(0);
    expect(session.canUndo).toBe(false);
    session.redo();
    expect(session.annots.get(id)).toBeDefined();
    expect(signatureOf(session.doc, field)?.id).toBe(id);
    // deleting the signature uncovers the field as well
    session.annots.remove([id]);
    expect(signatureOf(session.doc, field)).toBeUndefined();
  });

  it("replaces an earlier signature of the same field in one step", async () => {
    const { session, field } = await sample();
    const first = session.forms.sign(field.id, draw(300, 60));
    const second = session.forms.sign(field.id, { mode: "type", text: "Ada" });
    expect(signatures(session)).toEqual([second]);
    session.undo();
    expect(signatures(session)).toEqual([first]);
  });

  it("refuses a field that is not a signature field, is read only, or holds a digital signature", async () => {
    const { session, field } = await sample();
    expect(() => session.forms.sign(session.forms.byName("name")!.id, draw(300, 60))).toThrow(/not a signature field/);
    session.forms.update(field.id, { flags: { readOnly: true } });
    expect(() => session.forms.sign(field.id, draw(300, 60))).toThrow(/read only/);
    expect(() => session.forms.sign("nothing", draw(300, 60))).toThrow(/not found/);
  });
});

describe("a signed field in the saved file", () => {
  it("keeps the link, so the field is covered again when the file is opened", async () => {
    const { session, field } = await sample();
    session.forms.sign(field.id, draw(300, 60));
    const again = await openPdf(await session.save());
    const a = sig(again.doc.pages[0]!.annots.find((x) => x.type === "signature"));
    expect(a.field).toBe("signature");
    expect(signatureOf(again.doc, again.forms.byName("signature")!)).toBeDefined();
    // removed in the second file, the field is not covered
    again.annots.remove([a.id]);
    expect(coveredNames(again.doc).size).toBe(0);
  });

  it("gives the widget an empty appearance, and takes it away only with the signature", async () => {
    const { session, field } = await sample();
    const out = await session.save();
    // before: nothing says the field is covered
    const wDraw = field.widgets[0]!.rect;
    session.forms.update(field.id, { appearance: { fill: "#dde6ff", border: "#336699" } });
    const unsigned = await session.save();
    expect(apContent(unsigned, "signature")).toContain("re");
    session.forms.sign(field.id, draw(300, 60));
    const signed = await session.save();
    expect(apContent(signed, "signature").trim()).toBe("");
    void out;
    void wDraw;
  });
});

// ---- a field made by another program, with a caption in its own appearance ---------------------------------------------

/** A one-page file with a signature field whose appearance says "Sign here" at its left end. */
function foreignFile(): Uint8Array {
  const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  return buildClassic([
    obj(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 0 Tf 0 g) >> >>"),
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} >> >> /Contents 4 0 R /Annots [5 0 R] >>`),
    streamObj(4, "", "BT /F1 12 Tf 72 700 Td (Agreement) Tj ET"),
    obj(5, "<< /Type /Annot /Subtype /Widget /FT /Sig /T (agreement_sig) /Rect [100 600 300 640] /F 4 /P 3 0 R /AP << /N 6 0 R >> >>"),
    streamObj(6, `/Type /XObject /Subtype /Form /BBox [0 0 200 40] /Resources << /Font << /F1 ${font} >> >>`, "BT /F1 12 Tf 4 14 Td (Sign here) Tj ET"),
  ]).bytes;
}

/** The decoded content of the normal appearance of the (first) widget of a field, by field name. */
function apContent(bytes: Uint8Array, name: string): string {
  const file = PdfFile.open(bytes);
  for (const page of file.pages()) {
    const annots = file.dictGet(page.dict, "Annots");
    if (!Array.isArray(annots)) continue;
    for (const ref of annots) {
      const d = file.get(ref);
      if (!(d instanceof PdfDict)) continue;
      const t = file.get(d.get("T"));
      const title = typeof t === "string" ? t : t && typeof t === "object" && "bytes" in t ? new TextDecoder().decode((t as { bytes: Uint8Array }).bytes) : String(t);
      if (title !== name) continue;
      const ap = file.get(d.get("AP"));
      const n = ap instanceof PdfDict ? file.get(ap.get("N")) : null;
      if (n instanceof PdfStream) return new TextDecoder("latin1").decode(decodeStream(n, (o) => file.get(o)));
      return "";
    }
  }
  throw new Error(`no widget ${name}`);
}

/** The /F of the widget of a field, by name. */
function widgetFlags(bytes: Uint8Array, name: string): number {
  const file = PdfFile.open(bytes);
  for (const page of file.pages()) {
    const annots = file.dictGet(page.dict, "Annots");
    if (!Array.isArray(annots)) continue;
    for (const ref of annots) {
      const d = file.get(ref);
      if (!(d instanceof PdfDict)) continue;
      const t = file.get(d.get("T"));
      const title = typeof t === "string" ? t : t && typeof t === "object" && "bytes" in t ? new TextDecoder().decode((t as { bytes: Uint8Array }).bytes) : String(t);
      if (title === name) return Number(file.get(d.get("F")) ?? 0);
    }
  }
  throw new Error(`no widget ${name}`);
}

describe("the caption of a field made by another program", () => {
  it("is in the field's appearance until the field is signed, and gone from the saved file after", async () => {
    const bytes = foreignFile();
    expect(apContent(bytes, "agreement_sig")).toContain("(Sign here)");
    const session = await openPdf(bytes);
    const field = session.forms.byName("agreement_sig")!;
    expect(field.type).toBe("signature");
    const box = field.widgets[0]!.rect;
    const before = await renderPdf(await session.save(), 0, 3);
    // the caption is at the left end of the box
    const strip = { x: box.x + 2, y: box.y + 2, w: 24, h: box.h - 4 };
    expect(before.inkIn(strip.x, strip.y, strip.w, strip.h)).toBeGreaterThan(20);

    session.forms.sign(field.id, draw(40, 10)); // a small signature: it stays clear of the left end
    const signed = await session.saveDetailed();
    expect(signed.mode).toBe("incremental");
    expect(apContent(signed.bytes, "agreement_sig")).not.toContain("Sign here");
    expect(apContent(signed.bytes, "agreement_sig").trim()).toBe("");
    const after = await renderPdf(signed.bytes, 0, 3);
    expect(after.inkIn(strip.x, strip.y, strip.w, strip.h)).toBe(0);
    // the signature itself is there, inside the box
    expect(after.inkIn(box.x + 28, box.y + 2, box.w - 30, box.h - 4)).toBeGreaterThan(20);
    expect(after.inkIn(box.x - 20, box.y - 20, box.w + 40, 18)).toBe(0);
  });

  it("is not drawn again by flattening: the page has the signature and no caption, and no field", async () => {
    const session = await openPdf(foreignFile());
    const field = session.forms.byName("agreement_sig")!;
    const box = field.widgets[0]!.rect;
    session.forms.sign(field.id, draw(40, 10));
    const flat = await session.saveDetailed({ flatten: "forms" });
    const file = PdfFile.open(flat.bytes);
    expect(file.catalog().has("AcroForm")).toBe(false);
    const again = await openPdf(flat.bytes);
    expect(again.doc.fields).toEqual([]);
    const r = await renderPdf(flat.bytes, 0, 3);
    expect(r.inkIn(box.x + 2, box.y + 2, 24, box.h - 4)).toBe(0);
    expect(r.inkIn(box.x + 28, box.y + 2, box.w - 30, box.h - 4)).toBeGreaterThan(20);
  });

  it("hides the widget while it is covered (readers such as MuPDF mark any signature field of their own) and shows it again when the signature goes", async () => {
    const session = await openPdf(foreignFile());
    const id = session.forms.sign(session.forms.byName("agreement_sig")!.id, draw(40, 10));
    const signed = await session.save();
    expect(widgetFlags(signed, "agreement_sig") & 2).toBe(2);
    expect(widgetFlags(signed, "agreement_sig") & 4).toBe(4); // what it had is kept
    // the signed file opened again, the signature taken off, saved: the field is as visible as before
    const again = await openPdf(signed);
    again.annots.remove([sig(again.doc.pages[0]!.annots.find((a) => a.type === "signature")).id]);
    const open = await again.save();
    expect(widgetFlags(open, "agreement_sig") & 2).toBe(0);
    expect(widgetFlags(open, "agreement_sig") & 4).toBe(4);
    void id;
  });

  it("is back when the signature is removed before the file is saved (nothing is written for it)", async () => {
    const bytes = foreignFile();
    const session = await openPdf(bytes);
    const field = session.forms.byName("agreement_sig")!;
    const id = session.forms.sign(field.id, draw(40, 10));
    session.annots.remove([id]);
    const out = await session.save();
    expect(apContent(out, "agreement_sig")).toContain("(Sign here)");
    session.undo(); // the removal undone: signed again
    session.undo(); // and the signing undone
    expect(apContent(await session.save(), "agreement_sig")).toContain("(Sign here)");
  });
});

// ---- the same file in independent readers (pikepdf and qpdf, MuPDF): set PLI_PDF_PYTHON to a Python with them -------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const python = process.env.PLI_PDF_PYTHON;

describe.skipIf(!python)("a signed field in other readers", () => {
  const dir = python ? mkdtempSync(join(tmpdir(), "pli-sign-")) : "";
  const probe = `
import json, sys, pikepdf, fitz
path, x, y, w, h = sys.argv[1], *map(float, sys.argv[2:6])
pdf = pikepdf.open(path)
aps = {}
for a in pdf.pages[0].get("/Annots", []):
    if a.get("/Subtype") == "/Widget":
        n = a["/AP"]["/N"]
        aps[str(a.get("/T"))] = n.read_bytes().decode("latin1")
doc = fitz.open(path)
pix = doc[0].get_pixmap(matrix=fitz.Matrix(3, 3), clip=fitz.Rect(x, y, x + w, y + h), alpha=False)
ink = sum(1 for i in range(0, len(pix.samples), pix.n) if min(pix.samples[i:i + 3]) < 235)
print(json.dumps({"aps": aps, "ink": ink, "widgets": [wd.field_name for wd in doc[0].widgets()]}))
`;
  const run = (name: string, bytes: Uint8Array, box: Rect, left: number) => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    const q = execFileSync(python!, [new URL("../scripts/pdfcheck.py", import.meta.url).pathname, path], { encoding: "utf8", maxBuffer: 1 << 26 });
    const info = JSON.parse(execFileSync(python!, ["-c", probe, path, String(box.x + 2), String(box.y + 2), String(left), String(box.h - 4)], { encoding: "utf8", maxBuffer: 1 << 26 })) as { aps: Record<string, string>; ink: number; widgets: string[] };
    return { qpdf: (JSON.parse(q) as { qpdf: { problems?: string[] } }).qpdf, ...info };
  };

  it("has no caption in the widget's appearance and none on the page in MuPDF, and qpdf finds nothing wrong", async () => {
    const session = await openPdf(foreignFile());
    const box = session.forms.byName("agreement_sig")!.widgets[0]!.rect;
    const before = run("unsigned.pdf", await session.save(), box, 24);
    expect(before.aps.agreement_sig).toContain("Sign here");
    expect(before.ink).toBeGreaterThan(20);
    session.forms.sign(session.forms.byName("agreement_sig")!.id, draw(40, 10));
    const signed = run("signed.pdf", await session.save(), box, 24);
    expect(signed.qpdf.problems).toEqual([]);
    expect(signed.aps.agreement_sig.trim()).toBe("");
    expect(signed.ink).toBe(0);
    expect(signed.widgets).toContain("agreement_sig");
    const flat = run("flat.pdf", await session.save({ flatten: "forms" }), box, 24);
    expect(flat.qpdf.problems).toEqual([]);
    expect(flat.widgets).toEqual([]);
    expect(flat.ink).toBe(0);
  });
});
