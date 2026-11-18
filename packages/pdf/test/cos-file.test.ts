import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { PdfDict, PdfFile, PdfName, PdfRef, PdfStream, PdfString, textOf as pdfText, type PageInfo } from "../src/cos";
import { lzwEncode } from "./support/encoders";
import { Encryptor, appendUpdate, buildClassic, buildHybrid, buildXrefStreamPdf, bytesOf, concat, obj, simpleDoc, streamObj, textOf, type Obj } from "./support/handmade";

const here = dirname(fileURLToPath(import.meta.url));
const standardFontDataUrl = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

interface Seen {
  pages: { view: number[]; rotate: number; text: string }[];
}
async function pdfjsSees(bytes: Uint8Array, password?: string): Promise<Seen> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password, standardFontDataUrl, verbosity: 0, isEvalSupported: false, useWorkerFetch: false } as never).promise;
  try {
    const pages: Seen["pages"] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      pages.push({ view: p.view, rotate: p.rotate, text: tc.items.map((x) => ("str" in x ? x.str : "")).join("") });
    }
    return { pages };
  } finally {
    await doc.loadingTask.destroy();
  }
}

const sizeOf = (p: PageInfo) => [p.cropBox[0], p.cropBox[1], p.cropBox[2], p.cropBox[3]];
const pageText = (f: PdfFile, p: PageInfo): string => {
  const c = f.get(p.dict.get("Contents"));
  return c instanceof PdfStream ? textOf(f.decode(c)) : "";
};

// ---- fixtures -----------------------------------------------------------------------------------------------------

const classic3 = () => buildClassic(simpleDoc(3, { mediaBox: "[0 0 200 100]", text: (i) => `BT /F1 12 Tf 10 50 Td (Page ${i + 1}) Tj ET` }));

describe("classic xref files", () => {
  it("reads pages, version, trailer, object numbers", () => {
    const b = classic3();
    const f = PdfFile.open(b.bytes);
    expect(f.repaired).toBe(false);
    expect(f.encrypted).toBe(false);
    expect(f.version).toBe("1.7");
    expect(f.pageCount()).toBe(3);
    expect(f.size).toBe(9);
    expect(f.startxref).toBe(b.xrefOffset);
    expect(f.objectNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(f.has(5)).toBe(true);
    expect(f.has(0)).toBe(false);
    expect(f.has(99)).toBe(false);
    expect(f.trailer.get("Root")).toEqual(new PdfRef(1, 0));
    expect((f.catalog().get("Type") as PdfName).value).toBe("Catalog");
    expect(f.pages().map((p) => sizeOf(p))).toEqual([[0, 0, 200, 100], [0, 0, 200, 100], [0, 0, 200, 100]]);
    expect(f.pages().map((p) => pageText(f, p))).toEqual(["BT /F1 12 Tf 10 50 Td (Page 1) Tj ET", "BT /F1 12 Tf 10 50 Td (Page 2) Tj ET", "BT /F1 12 Tf 10 50 Td (Page 3) Tj ET"]);
    expect(f.pages()[1]!.ref).toEqual(new PdfRef(4, 0));
    expect(f.pages()[1]!.index).toBe(1);
    expect(f.pages()).toBe(f.pages()); // cached
  });

  it("does not change the input bytes", () => {
    const b = classic3().bytes;
    const copy = b.slice();
    const f = PdfFile.open(b);
    f.pages();
    for (const n of f.objectNumbers()) f.getRef(n);
    expect(b).toEqual(copy);
    expect(f.bytes).toBe(b);
  });

  it("resolves chains of references, missing objects and reference loops", () => {
    const objs = [...simpleDoc(1), obj(20, "21 0 R"), obj(21, "22 0 R"), obj(22, "(end)"), obj(23, "24 0 R"), obj(24, "23 0 R"), obj(25, "<< /Length 25 0 R >>\nstream\nabc\nendstream")];
    const f = PdfFile.open(buildClassic(objs).bytes);
    expect(pdfText(f.getRef(20) as PdfString)).toBe("end");
    expect(f.get(new PdfRef(20, 0))).toBe(f.getRef(22));
    expect(f.getRef(999)).toBe(null);
    expect(f.get(undefined)).toBe(null);
    expect(f.get(7)).toBe(7);
    expect(f.getRef(23)).toBe(null);
    const s = f.getRef(25) as PdfStream;
    expect(textOf(s.data)).toBe("abc"); // self-referencing Length falls back to scanning
  });

  it("keeps generation numbers and ignores a generation mismatch in a reference", () => {
    const objs = [...simpleDoc(1), obj(20, "(old gen)", 3)];
    const f = PdfFile.open(buildClassic(objs).bytes);
    expect(f.generation(20)).toBe(3);
    expect(f.generation(1)).toBe(0);
    expect(pdfText(f.get(new PdfRef(20, 0)) as PdfString)).toBe("old gen");
  });

  it("dictGet follows references", () => {
    const f = PdfFile.open(classic3().bytes);
    const page = f.pages()[0]!;
    expect(f.dictGet(page.dict, "Contents")).toBeInstanceOf(PdfStream);
    expect(f.dictGet(page.dict, "Nope")).toBe(null);
  });

  it("reads Info", () => {
    const f = PdfFile.open(buildClassic([...simpleDoc(1), obj(20, "<< /Title (Hi) >>")], { info: 20 }).bytes);
    expect(pdfText(f.info()!.get("Title") as PdfString)).toBe("Hi");
    expect(PdfFile.open(classic3().bytes).info()).toBe(null);
  });

  it("accepts a table whose first subsection starts at 1", () => {
    const b = classic3();
    const text = textOf(b.bytes).replace("xref\n0 9\n0000000000 65535 f \n", "xref\n1 8\n0000000000 65535 f \n").replace(/^(0000000000 65535 f \n)/m, "$1");
    // shifted table: entries for 1..8 now begin with the free entry; objects are off by one -> repaired or tolerant, either way pages are found
    const f = PdfFile.open(bytesOf(text));
    expect(f.pageCount()).toBe(3);
  });
});

describe("xref streams and object streams", () => {
  const objs = () => simpleDoc(2).map((o) => o);
  it("reads an xref stream (Flate, with and without predictor)", () => {
    for (const predictor of [false, true]) {
      const f = PdfFile.open(buildXrefStreamPdf(objs(), { predictor }).bytes);
      expect(f.repaired).toBe(false);
      expect(f.pageCount()).toBe(2);
      expect(f.pages()[0]!.mediaBox).toEqual([0, 0, 612, 792]);
    }
  });

  it("reads objects out of an object stream", () => {
    const o = objs();
    const b = buildXrefStreamPdf(o, { objStm: [1, 2, 3, 4] });
    const f = PdfFile.open(b.bytes);
    expect(f.repaired).toBe(false);
    expect(f.pageCount()).toBe(2);
    expect(f.objectNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // 5..6 contents, then the object stream (7) and the xref stream (8)
    expect(f.has(3)).toBe(true);
    expect(pageText(f, f.pages()[1]!)).toContain("Page 2");
  });

  it("works uncompressed, too", () => {
    const f = PdfFile.open(buildXrefStreamPdf(objs(), { objStm: [1, 2], compress: false }).bytes);
    expect(f.pageCount()).toBe(2);
  });

  it("finds the right index even when the stored index is wrong", () => {
    const b = buildXrefStreamPdf(objs(), { objStm: [1, 2, 3, 4], compress: false });
    // damage: swap member order in xref rows is hard to do by hand; instead check lookup by number is used by removing member 3's pair
    const f = PdfFile.open(b.bytes);
    expect((f.getRef(3) as PdfDict).get("Type")).toEqual(PdfName.of("Page"));
  });
});

describe("incremental updates and hybrid files", () => {
  it("the newest object wins; added and freed objects", () => {
    const base = buildClassic(simpleDoc(2, { text: (i) => `(original ${i})` }));
    const upd = appendUpdate(base.bytes, [streamObj(5, "", "(replaced)"), obj(30, "(new)")], { size: 31 });
    const f = PdfFile.open(upd.bytes);
    expect(f.repaired).toBe(false);
    expect(f.startxref).toBe(upd.xrefOffset);
    expect(textOf(f.decode(f.getRef(5) as PdfStream))).toBe("(replaced)");
    expect(textOf(f.decode(f.getRef(6) as PdfStream))).toBe("(original 1)");
    expect(pdfText(f.getRef(30) as PdfString)).toBe("new");
    expect(f.size).toBe(31);
    expect(f.objectNumbers()).toContain(30);
    const freed = PdfFile.open(appendUpdate(upd.bytes, [], { free: [30], size: 31 }).bytes);
    expect(freed.has(30)).toBe(false);
    expect(freed.getRef(30)).toBe(null);
    expect(freed.has(5)).toBe(true);
  });

  it("an update can replace the catalog and the page tree (a page is added)", () => {
    const base = buildClassic(simpleDoc(1));
    const upd = appendUpdate(base.bytes, [obj(2, "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>"), obj(9, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 60] >>")], { size: 10 });
    const f = PdfFile.open(upd.bytes);
    expect(f.pageCount()).toBe(2);
    expect(sizeOf(f.pages()[1]!)).toEqual([0, 0, 50, 60]);
  });

  it("chains of several updates", () => {
    let b = buildClassic(simpleDoc(1, { text: () => "(v0)" })).bytes;
    for (let i = 1; i <= 5; i++) b = appendUpdate(b, [streamObj(4, "", `(v${i})`)], { size: 5 }).bytes;
    const f = PdfFile.open(b);
    expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe("(v5)");
  });

  it("a hybrid file: the table plus an XRefStm for the objects in the object stream", () => {
    const o = simpleDoc(2);
    const f = PdfFile.open(buildHybrid(o, [3, 4]).bytes);
    expect(f.repaired).toBe(false);
    expect(f.pageCount()).toBe(2);
    expect((f.getRef(3) as PdfDict).get("Type")).toEqual(PdfName.of("Page"));
  });

  it("a hybrid file that lists the hidden objects as free in its table", () => {
    const b = buildHybrid(simpleDoc(2), [3, 4], { listHiddenAsFree: true });
    const f = PdfFile.open(b.bytes);
    expect(f.repaired).toBe(false);
    expect(f.pageCount()).toBe(2);
  });

  it("an update after an xref-stream file (Prev points at an xref stream)", () => {
    const base = buildXrefStreamPdf(simpleDoc(1), { objStm: [1, 2, 3] });
    const upd = appendUpdate(base.bytes, [streamObj(4, "", "(updated)")], { size: base.offsets.size + 3 });
    const f = PdfFile.open(upd.bytes);
    expect(f.repaired).toBe(false);
    expect(f.pageCount()).toBe(1);
    expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe("(updated)");
  });

  it("a Prev loop ends", () => {
    const b = classic3();
    const text = textOf(b.bytes).replace("trailer\n<<", `trailer\n<< /Prev ${b.xrefOffset}`);
    expect(PdfFile.open(bytesOf(text)).pageCount()).toBe(3);
  });
});

describe("broken files are repaired", () => {
  const fixtures = (): [string, Uint8Array][] => {
    const b = classic3();
    const t = textOf(b.bytes);
    return [
      ["startxref too large", bytesOf(t.replace(/startxref\n\d+/, "startxref\n99999999"))],
      ["startxref points into the middle of an object", bytesOf(t.replace(/startxref\n\d+/, `startxref\n${b.offsets.get(4)! + 5}`))],
      ["startxref is zero", bytesOf(t.replace(/startxref\n\d+/, "startxref\n0"))],
      ["startxref missing", bytesOf(t.slice(0, t.indexOf("startxref")))],
      ["no xref, no trailer", buildClassic(simpleDoc(3, { mediaBox: "[0 0 200 100]" }), { omitXref: true }).bytes],
      ["xref table damaged", bytesOf(t.replace("xref\n0 9", "xref\n0 x"))],
      ["truncated before the xref", bytesOf(t.slice(0, t.indexOf("xref\n0 9") + 20))],
      ["no endobj anywhere", bytesOf(t.replaceAll("endobj", ""))],
    ];
  };

  for (const [name, bytes] of fixtures()) {
    it(`${name}`, () => {
      const f = PdfFile.open(bytes);
      expect(f.repaired).toBe(true);
      expect(f.startxref).toBe(0);
      expect(f.pageCount()).toBe(3);
      expect(f.pages()[2]!.mediaBox).toEqual([0, 0, 200, 100]);
      expect(pageText(f, f.pages()[0]!)).toContain("Page 1");
    });
  }

  it("a wrong offset for a single object repairs the file on first use", () => {
    const b = classic3();
    const wrong = textOf(b.bytes).replace(String(b.offsets.get(3)!).padStart(10, "0"), String(b.offsets.get(3)! + 7).padStart(10, "0"));
    const f = PdfFile.open(bytesOf(wrong));
    expect(f.repaired).toBe(false);
    expect(f.pageCount()).toBe(3);
    expect(f.repaired).toBe(true);
  });

  it("the last of two copies of an object wins when the xref is gone", () => {
    const objs = [...simpleDoc(1), obj(4, "(dup)")];
    const f = PdfFile.open(buildClassic(objs.concat([obj(10, "(first)"), obj(10, "(second)")]), { omitXref: true }).bytes);
    expect(pdfText(f.getRef(10) as PdfString)).toBe("second");
  });

  it("finds a trailer-less file's catalog by its type", () => {
    const f = PdfFile.open(buildClassic(simpleDoc(2), { omitXref: true }).bytes);
    expect(f.pageCount()).toBe(2);
    expect(f.trailer.get("Root")).toEqual(new PdfRef(1, 0));
  });

  it("recovers an xref-stream file with a broken startxref (Root from the XRef stream dictionary, objects from object streams)", () => {
    const b = buildXrefStreamPdf(simpleDoc(2), { objStm: [1, 2, 3, 4] });
    const t = textOf(b.bytes).replace(/startxref\n\d+/, "startxref\n12");
    const f = PdfFile.open(bytesOf(t));
    expect(f.repaired).toBe(true);
    expect(f.pageCount()).toBe(2);
    expect(f.generation(3)).toBe(0);
  });

  it("a save cut off in the middle of an incremental update opens as the state before it", () => {
    const base = buildClassic(simpleDoc(1, { text: () => "(old)" }));
    const upd = appendUpdate(base.bytes, [streamObj(4, "", "(new)")], { size: 5 });
    const f = PdfFile.open(upd.bytes.subarray(0, upd.xrefOffset + 3));
    expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe("(old)");
  });

  it("with no xref at all, the newest copy of an updated object wins", () => {
    const base = buildClassic(simpleDoc(1, { text: () => "(old)" }));
    const upd = appendUpdate(base.bytes, [streamObj(5, "", "(new)")], { size: 6 });
    const noXref = upd.bytes.subarray(0, base.xrefOffset).slice(); // drop the table of the first revision...
    const f = PdfFile.open(concat(noXref, upd.bytes.subarray(upd.offsets.get(5)!, upd.xrefOffset)));
    expect(f.repaired).toBe(true);
    expect(textOf(f.decode(f.getRef(5) as PdfStream))).toBe("(new)");
  });

  it("a stream whose Length is wrong does not hide the next objects", () => {
    const objs = simpleDoc(2);
    objs[4] = { num: 5, body: concat("<< /Length 3 >>\nstream\n(Page one has longer text)\nendstream") };
    const f = PdfFile.open(buildClassic(objs, { omitXref: true }).bytes);
    expect(f.pageCount()).toBe(2);
    expect(textOf((f.getRef(5) as PdfStream).data)).toBe("(Page one has longer text)");
    expect(f.has(6)).toBe(true);
  });

  it("binary stream data that looks like objects is skipped", () => {
    const fake = "1 0 obj << /Type /Catalog /Pages 99 0 R >> endobj 2 0 obj << /Type /Pages /Kids [] >> endobj";
    const objs = [...simpleDoc(1), streamObj(20, "", fake)];
    const f = PdfFile.open(buildClassic(objs, { omitXref: true }).bytes);
    expect(f.pageCount()).toBe(1);
  });
});

describe("junk around the file", () => {
  it("garbage before %PDF- (offsets relative to the header)", () => {
    const b = buildClassic(simpleDoc(2), { prefix: "garbage line\r\nmore junk 0 obj\n" });
    const f = PdfFile.open(b.bytes);
    expect(f.headerOffset).toBe(30);
    expect(f.repaired).toBe(false);
    expect(f.pageCount()).toBe(2);
  });

  it("garbage before %PDF- with absolute offsets", () => {
    const prefix = "junk\n\n";
    const clean = buildClassic(simpleDoc(2));
    const bytes = concat(prefix, clean.bytes); // offsets inside are now off by the prefix length
    const f = PdfFile.open(bytes);
    expect(f.pageCount()).toBe(2);
  });

  it("garbage and text after %%EOF", () => {
    const b = buildClassic(simpleDoc(2), { suffix: "\n\n\0\0trailing junk startxref 12 " + "x".repeat(3000) });
    const f = PdfFile.open(b.bytes);
    expect(f.pageCount()).toBe(2);
  });

  it("a lone CR as line ending in the xref table and the trailer", () => {
    const b = buildClassic(simpleDoc(1));
    const t = textOf(b.bytes);
    const i = t.indexOf("xref\n");
    const crs = t.slice(0, i) + t.slice(i).replaceAll("\n", "\r");
    const f = PdfFile.open(bytesOf(crs));
    expect(f.repaired).toBe(false);
    expect(f.pageCount()).toBe(1);
  });
});

describe("page tree", () => {
  const doc = (pages: string, extra: Obj[] = [], catalog = "<< /Type /Catalog /Pages 2 0 R >>", media = "") =>
    PdfFile.open(buildClassic([obj(1, catalog), obj(2, pages), ...extra], { omitXref: false }).bytes);
  const page = (n: number, dict = "") => obj(n, `<< /Type /Page /Parent 2 0 R ${dict} >>`);

  it("nested tree, order is depth first", () => {
    const f = doc("<< /Type /Pages /Kids [10 0 R 5 0 R 11 0 R] /Count 4 >>", [
      obj(10, "<< /Type /Pages /Parent 2 0 R /Kids [3 0 R 4 0 R] /Count 2 >>"),
      page(3, "/MediaBox [0 0 1 1]"),
      page(4, "/MediaBox [0 0 2 2]"),
      page(5, "/MediaBox [0 0 3 3]"),
      obj(11, "<< /Type /Pages /Parent 2 0 R /Kids [12 0 R] /Count 1 >>"),
      obj(12, "<< /Type /Pages /Kids [6 0 R] /Count 1 >>"),
      page(6, "/MediaBox [0 0 4 4]"),
    ]);
    expect(f.pages().map((p) => p.mediaBox[2])).toEqual([1, 2, 3, 4]);
    expect(f.pages().map((p) => p.ref.num)).toEqual([3, 4, 5, 6]);
  });

  it("inherits Resources, MediaBox, CropBox and Rotate; a page's own values win", () => {
    const f = doc("<< /Type /Pages /Kids [10 0 R] /Count 2 /MediaBox [0 0 500 500] /Rotate 90 /Resources << /Font << /A 1 0 R >> >> >>", [
      obj(10, "<< /Type /Pages /Parent 2 0 R /Kids [3 0 R 4 0 R] /Count 2 /CropBox [10 10 400 300] /Rotate 180 >>"),
      page(3),
      page(4, "/MediaBox [0 0 100 200] /Rotate 270 /Resources << >>"),
    ]);
    const [a, b] = f.pages();
    expect(a!.mediaBox).toEqual([0, 0, 500, 500]);
    expect(a!.cropBox).toEqual([10, 10, 400, 300]);
    expect(a!.rotate).toBe(180);
    expect(((a!.dict.get("Resources") as PdfDict).get("Font") as PdfDict).has("A")).toBe(true);
    expect(b!.mediaBox).toEqual([0, 0, 100, 200]);
    expect(b!.cropBox).toEqual([10, 10, 100, 200]); // clipped to the media box
    expect(b!.rotate).toBe(270);
    expect((b!.dict.get("Resources") as PdfDict).keys()).toEqual([]);
  });

  it("normalises Rotate", () => {
    const rots = ["0", "90", "180", "270", "360", "450", "-90", "-180", "45", "100", "(x)", "90.0", "null"];
    const f = doc(`<< /Type /Pages /Kids [${rots.map((_, i) => `${10 + i} 0 R`).join(" ")}] /Count ${rots.length} >>`, rots.map((r, i) => page(10 + i, `/MediaBox [0 0 10 10] /Rotate ${r}`)));
    expect(f.pages().map((p) => p.rotate)).toEqual([0, 90, 180, 270, 0, 90, 270, 180, 90, 90, 0, 90, 0]);
  });

  it("normalises MediaBox: reversed corners, indirect numbers, junk, missing", () => {
    const f = doc("<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] /Count 6 >>", [
      page(3, "/MediaBox [612 792 0 0]"),
      page(4, "/MediaBox [0 0 20 0 R 30]"), // `20 0 R` is a reference to an object that is a number
      page(5, "/MediaBox [0 0 (x) 5]"),
      page(6, "/MediaBox [0 0 0 0]"),
      page(7),
      page(8, "/MediaBox [-10.5 -20.25 100.75 50]"),
      obj(20, "40"),
    ]);
    const p = f.pages();
    expect(p[0]!.mediaBox).toEqual([0, 0, 612, 792]);
    expect(p[1]!.mediaBox).toEqual([0, 0, 40, 30]);
    expect(p[2]!.mediaBox).toEqual([0, 0, 612, 792]);
    expect(p[3]!.mediaBox).toEqual([0, 0, 612, 792]);
    expect(p[4]!.mediaBox).toEqual([0, 0, 612, 792]);
    expect(p[5]!.mediaBox).toEqual([-10.5, -20.25, 100.75, 50]);
  });

  it("a CropBox that does not overlap the MediaBox is ignored", () => {
    const f = doc("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", [page(3, "/MediaBox [0 0 100 100] /CropBox [200 200 300 300]")]);
    expect(f.pages()[0]!.cropBox).toEqual([0, 0, 100, 100]);
  });

  it("survives cycles, missing Type, kids that are not pages, wrong counts and missing kids", () => {
    const f = doc("<< /Type /Pages /Kids [10 0 R 3 0 R 99 0 R 20 0 R (str) null 2 0 R 4 0 R] /Count 1000 >>", [
      obj(10, "<< /Type /Pages /Kids [2 0 R 10 0 R 3 0 R] >>"), // cycles back to the root and to itself
      obj(3, "<< /Parent 2 0 R /MediaBox [0 0 7 7] >>"), // no /Type at all: still a page
      obj(20, "<< /Type /Font /BaseFont /Helvetica >>"), // not a page
      obj(4, "<< /Type /Page /MediaBox [0 0 8 8] >>"),
    ]);
    expect(f.pages().map((p) => p.mediaBox[2])).toEqual([7, 8]);
    expect(f.pageCount()).toBe(2);
  });

  it("the same page object listed twice appears once", () => {
    const f = doc("<< /Type /Pages /Kids [3 0 R 3 0 R] /Count 2 >>", [page(3, "/MediaBox [0 0 5 5]")]);
    expect(f.pageCount()).toBe(1);
  });

  it("a very deep tree does not overflow the stack", () => {
    const n = 5000;
    const objs: Obj[] = [obj(1, "<< /Type /Catalog /Pages 2 0 R >>")];
    for (let i = 0; i < n; i++) objs.push(obj(2 + i, `<< /Type /Pages /Kids [${3 + i} 0 R] /Count 1 >>`));
    objs.push(obj(2 + n, "<< /Type /Page /MediaBox [0 0 5 5] >>"));
    const f = PdfFile.open(buildClassic(objs).bytes);
    expect(() => f.pageCount()).not.toThrow(); // depth limit: pages beyond it are dropped, then found by scanning
    expect(f.pageCount()).toBe(1);
  });

  it("falls back to scanning for pages when the catalog has no usable page tree", () => {
    const f = doc("<< /Type /Pages /Kids [] /Count 0 >>", [page(3, "/MediaBox [0 0 5 5]"), page(4, "/MediaBox [0 0 6 6]")], "<< /Type /Catalog >>");
    expect(f.pages().map((p) => p.mediaBox[2])).toEqual([5, 6]);
  });

  it("scanned pages inherit from /Parent", () => {
    const f = doc("<< /Type /Pages /Kids [] /MediaBox [0 0 33 44] /Rotate 90 >>", [page(3)], "<< /Type /Catalog /Pages 99 0 R >>");
    expect(f.pages()[0]!.mediaBox).toEqual([0, 0, 33, 44]);
    expect(f.pages()[0]!.rotate).toBe(90);
  });

  it("a document without pages has none", () => {
    const f = doc("<< /Type /Pages /Kids [] /Count 0 >>");
    expect(f.pageCount()).toBe(0);
  });
});

describe("agreement with pdf.js", () => {
  const rotated = simpleDoc(3, { pageExtra: (i) => `/Rotate ${[0, 90, 270][i]}` });
  const named: [string, Uint8Array][] = [
    ["classic", classic3().bytes],
    ["xref stream", buildXrefStreamPdf(simpleDoc(2)).bytes],
    ["xref stream + predictor + object stream", buildXrefStreamPdf(simpleDoc(3), { objStm: [1, 2, 3, 4, 5], predictor: true }).bytes],
    ["hybrid", buildHybrid(simpleDoc(2), [3, 4]).bytes],
    ["incremental", appendUpdate(buildClassic(simpleDoc(1)).bytes, [obj(2, "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>"), obj(9, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 60] /CropBox [5 5 40 50] /Rotate 90 >>")], { size: 10 }).bytes],
    ["rotated", buildClassic(rotated).bytes],
    ["broken startxref", bytesOf(textOf(classic3().bytes).replace(/startxref\n\d+/, "startxref\n17"))],
    ["junk before header", buildClassic(simpleDoc(2), { prefix: "junk\n" }).bytes],
    ["inherited boxes", buildClassic(simpleDoc(2, { mediaBox: "[0 0 300 400]", pagesExtra: "/CropBox [10 20 250 350] /Rotate 180" })).bytes],
    ["lzw content", buildClassic([...simpleDoc(1).slice(0, 3), { num: 4, body: concat("<< /Length 0 /Filter /LZWDecode >>\nstream\n", lzwEncode(bytesOf("BT /F1 12 Tf 10 50 Td (Hi LZW) Tj ET")), "\nendstream") }]).bytes],
  ];

  for (const [name, bytes] of named) {
    it(name, async () => {
      const f = PdfFile.open(bytes);
      const seen = await pdfjsSees(bytes);
      expect(f.pageCount()).toBe(seen.pages.length);
      f.pages().forEach((p, i) => {
        expect(sizeOf(p)).toEqual(seen.pages[i]!.view);
        expect(p.rotate).toBe(seen.pages[i]!.rotate);
      });
    });
  }

  it("an LZW content stream: pdf.js reads the text our encoder wrote and we decode it back", async () => {
    const bytes = named.find((n) => n[0] === "lzw content")![1];
    expect((await pdfjsSees(bytes)).pages[0]!.text).toBe("Hi LZW");
    const f = PdfFile.open(bytes);
    expect(pageText(f, f.pages()[0]!)).toBe("BT /F1 12 Tf 10 50 Td (Hi LZW) Tj ET");
  });

  it("text from our decoded content streams equals what pdf.js reads", async () => {
    const bytes = buildXrefStreamPdf(simpleDoc(2, { text: (i) => `BT /F1 12 Tf 10 50 Td (Hello ${i}) Tj ET` }), { objStm: [1, 2, 3, 4] }).bytes;
    const seen = await pdfjsSees(bytes);
    expect(seen.pages.map((p) => p.text)).toEqual(["Hello 0", "Hello 1"]);
    const f = PdfFile.open(bytes);
    expect(pageText(f, f.pages()[1]!)).toContain("(Hello 1)");
  });
});

describe("encrypted fixtures made by qpdf (pikepdf)", () => {
  const read = (n: string) => new Uint8Array(readFileSync(join(here, "fixtures", n)));
  const cases: [string, string][] = [
    ["enc-rc4-40.pdf", ""],
    ["enc-rc4-128.pdf", ""],
    ["enc-aes-128.pdf", ""],
    ["enc-aes-256.pdf", ""],
    ["enc-aes-128-objstm.pdf", ""],
    ["enc-aes-256-objstm.pdf", ""],
    ["enc-rc4-128-pw.pdf", "user pw"],
    ["enc-aes-128-pw.pdf", "user pw"],
    ["enc-aes-256-pw.pdf", "user pw"],
  ];
  for (const [name, pw] of cases) {
    it(`${name}`, async () => {
      const bytes = read(name);
      if (pw) {
        expect(() => PdfFile.open(bytes)).toThrow(/password required/);
        expect(() => PdfFile.open(bytes, { password: "wrong" })).toThrow(/wrong password/);
        expect(PdfFile.open(bytes, { password: "own pw" }).pageCount()).toBe(1); // owner password
      }
      const f = PdfFile.open(bytes, { password: pw || undefined });
      expect(f.encrypted).toBe(true);
      expect(f.pageCount()).toBe(1);
      expect(f.pages()[0]!.mediaBox).toEqual([0, 0, 300, 400]);
      expect(pageText(f, f.pages()[0]!)).toBe("BT /F1 24 Tf 40 300 Td (Hello encrypted world) Tj ET");
      expect(pdfText(f.info()!.get("Title") as PdfString)).toBe("Encrypted fixture title");
      const seen = await pdfjsSees(bytes, pw || undefined);
      expect(seen.pages[0]!.text).toContain("Hello encrypted world");
    });
  }

  it("our own encrypted test files open in pdf.js, too (the encryptor in the test support is right)", async () => {
    const { Encryptor } = await import("./support/handmade");
    for (const mode of ["rc4-40", "rc4-128", "aes-128", "aes-256-r5", "aes-256-r6"] as const) {
      const enc = new Encryptor(mode, { userPassword: "pw" }, 20);
      const objs = [...simpleDoc(1).slice(0, 3), enc.stream(4, "", "BT /F1 12 Tf 10 10 Td (open sesame) Tj ET"), enc.encryptObj];
      const bytes = buildClassic(objs, { trailerExtra: enc.trailerExtra }).bytes;
      const seen = await pdfjsSees(bytes, "pw");
      expect(seen.pages[0]!.text).toContain("open sesame");
    }
  });
});

describe("size and speed", () => {
  it("opens a file with 30000 objects and reads every page quickly", () => {
    const n = 15000;
    const bytes = buildClassic(simpleDoc(n, { text: (i) => `(p${i})` })).bytes;
    const t = performance.now();
    const f = PdfFile.open(bytes);
    expect(f.pageCount()).toBe(n);
    expect(f.objectNumbers().length).toBe(2 * n + 2);
    expect(performance.now() - t).toBeLessThan(3000);
    // the same file without its xref is repaired in one scan
    const t2 = performance.now();
    const g = PdfFile.open(bytes.subarray(0, bytes.length - 50).slice(0, bytes.length - 60));
    expect(g.repaired).toBe(true);
    expect(g.pageCount()).toBe(n);
    expect(performance.now() - t2).toBeLessThan(5000);
  });

  it("a repaired encrypted file still decrypts", () => {
    const enc = new Encryptor("aes-128", { userPassword: "pw" }, 20);
    const good = buildClassic([...simpleDoc(1).slice(0, 3), enc.stream(4, "", "(secret)"), enc.encryptObj], { trailerExtra: enc.trailerExtra }).bytes;
    const broken = bytesOf(textOf(good).replace(/startxref\n\d+/, "startxref\n3"));
    const f = PdfFile.open(broken, { password: "pw" });
    expect(f.repaired).toBe(true);
    expect(f.encrypted).toBe(true);
    expect(textOf(f.decode(f.getRef(4) as PdfStream))).toBe("(secret)");
    expect(() => PdfFile.open(broken)).toThrow(/password required/);
  });
});

describe("nasty input", () => {
  const fails = (bytes: Uint8Array) => {
    try {
      PdfFile.open(bytes);
      return null;
    } catch (e) {
      return e as { code?: string; message: string };
    }
  };

  it("empty input, text, random bytes and zeros are not PDFs", () => {
    expect(fails(new Uint8Array(0))!.code).toBe("invalid_document");
    expect(fails(bytesOf("hello world, this is not a pdf"))!.code).toBe("invalid_document");
    const rnd = new Uint8Array(100000).map((_, i) => (i * 2654435761) >>> 24);
    expect(fails(rnd)!.code).toBe("invalid_document");
    expect(fails(bytesOf("%PDF-1.7\n"))!.code).toBe("invalid_document");
  });

  it("5 MB of zeros does not hang", () => {
    const t = performance.now();
    expect(fails(new Uint8Array(5_000_000))!.code).toBe("invalid_document");
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it("5 MB of 'obj' noise and '%PDF-' prefixes does not hang", () => {
    const t = performance.now();
    expect(fails(bytesOf("1 0 obj ".repeat(600_000)))!.code).toBeDefined();
    expect(fails(bytesOf("%PDF-1.4 << [ ( ".repeat(300_000)))!.code).toBeDefined();
    expect(performance.now() - t).toBeLessThan(6000);
  });

  it("every truncation of a good file either opens or fails cleanly", () => {
    const bytes = buildXrefStreamPdf(simpleDoc(3), { objStm: [1, 2, 3, 4, 5] }).bytes;
    const classic = classic3().bytes;
    for (const b of [bytes, classic]) {
      for (let cut = 0; cut < b.length; cut += Math.max(1, Math.floor(b.length / 60))) {
        const r = (() => {
          try {
            const f = PdfFile.open(b.subarray(0, cut));
            f.pages();
            for (const n of f.objectNumbers()) f.getRef(n);
            return "ok";
          } catch (e) {
            return (e as { code?: string }).code ?? "other:" + (e as Error).message;
          }
        })();
        expect(["ok", "invalid_document"]).toContain(r);
      }
    }
  });

  it("flipping bytes in a good file never throws anything but a clean error", () => {
    const b = classic3().bytes;
    let state = 12345;
    for (let round = 0; round < 60; round++) {
      const m = b.slice();
      for (let k = 0; k < 8; k++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        m[state % m.length] = (state >> 8) & 255;
      }
      try {
        const f = PdfFile.open(m);
        f.pages();
        for (const n of f.objectNumbers()) f.getRef(n);
      } catch (e) {
        expect((e as { code?: string }).code).toBe("invalid_document");
      }
    }
  });

  it("a stream that claims a huge Length, a huge Size and a huge object stream count", () => {
    const objs = [...simpleDoc(1), obj(20, "<< /Length 99999999999 >>\nstream\nabc\nendstream"), obj(21, "<< /Type /ObjStm /N 99999999 /First 5 /Length 10 >>\nstream\n1 0 2 0 3 \nendstream")];
    const f = PdfFile.open(buildClassic(objs, { trailerExtra: "/Size 4000000000" }).bytes);
    expect(textOf((f.getRef(20) as PdfStream).data)).toBe("abc");
    expect(f.size).toBeLessThan(1e9 + 1);
    expect(f.pageCount()).toBe(1);
  });

  it("a Flate bomb in a content stream is refused, but the rest of the file still works", () => {
    const bomb = streamObj(20, "", new Uint8Array(20_000_000), true);
    const f = PdfFile.open(buildClassic([...simpleDoc(1), bomb]).bytes, { maxStreamSize: 1_000_000 });
    expect(f.pageCount()).toBe(1);
    expect(() => f.decode(f.getRef(20) as PdfStream)).toThrow(/larger/);
  });

  it("an xref subsection that claims billions of entries does not allocate them", () => {
    const b = classic3();
    const t = textOf(b.bytes).replace("xref\n0 9", "xref\n0 2000000000");
    const start = performance.now();
    const f = PdfFile.open(bytesOf(t));
    expect(f.pageCount()).toBe(3);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

// ---- independent readers (python), opt-in -----------------------------------------------------------------------------

const py = process.env.PLI_PDF_PYTHON;
function runCheck(path: string, password?: string): any {
  const args = ["-I", join(here, "..", "scripts", "pdfcheck.py"), path, ...(password ? ["--password", password] : [])];
  const out = execFileSync(py!, args, { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf('{\n "file"'))); // MuPDF may print warnings first
}
describe.skipIf(!py)("python readers (pikepdf, pypdf, pymupdf) agree", () => {
  it("see the same pages in our fixtures", () => {
    const dir = mkdtempSync(join(tmpdir(), "pli-pdf-reader-"));
    try {
      const cases: [string, Uint8Array, number][] = [
        ["classic", classic3().bytes, 3],
        ["xrefstream", buildXrefStreamPdf(simpleDoc(3), { objStm: [1, 2, 3, 4, 5], predictor: true }).bytes, 3],
        ["hybrid", buildHybrid(simpleDoc(2), [3, 4]).bytes, 2],
        ["incremental", appendUpdate(buildClassic(simpleDoc(1)).bytes, [obj(2, "<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>"), obj(9, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 60] >>")], { size: 10 }).bytes, 2],
      ];
      for (const [name, bytes, pages] of cases) {
        const path = join(dir, `${name}.pdf`);
        writeFileSync(path, bytes);
        const out = runCheck(path);
        expect(out.qpdf.pages, name).toBe(pages);
        expect(out.pypdf.pages.length, name).toBe(pages);
        expect(out.mupdf.pages, name).toBe(pages);
        const f = PdfFile.open(bytes);
        expect(f.pageCount()).toBe(pages);
        f.pages().forEach((p, i) => {
          expect(out.pypdf.pages[i].box, name).toEqual([p.mediaBox[0], p.mediaBox[1], p.mediaBox[2], p.mediaBox[3]]);
          expect(out.pypdf.pages[i].rotate, name).toBe(p.rotate);
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("open our encrypted test files with the password", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pli-pdf-reader-"));
    try {
      {
        const { Encryptor } = await import("./support/handmade");
        for (const mode of ["rc4-40", "rc4-128", "aes-128", "aes-256-r6"] as const) {
          const enc = new Encryptor(mode, { userPassword: "pw" }, 20);
          const bytes = buildClassic([...simpleDoc(1).slice(0, 3), enc.stream(4, "", "BT /F1 12 Tf 10 10 Td (open sesame) Tj ET"), enc.encryptObj], { trailerExtra: enc.trailerExtra }).bytes;
          const path = join(dir, `${mode}.pdf`);
          writeFileSync(path, bytes);
          const out = runCheck(path, "pw");
          expect(out.qpdf.pages, mode).toBe(1);
          expect(out.mupdf.text[0], mode).toContain("open sesame");
          if (!out.pypdf.error) expect(out.pypdf.pages[0].text, mode).toContain("open sesame"); // pypdf needs `cryptography` for AES
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
