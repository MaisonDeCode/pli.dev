// Optional: checks the files the page operations write with three independent readers (qpdf via pikepdf, pypdf, MuPDF).
// Set PLI_PDF_PYTHON to a python that has pikepdf, pypdf and pymupdf.
import { createCanvas } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergePdfs, openPdf, pdfFromImages } from "../src";
import { readFileSync } from "node:fs";
import { fiveDoc, notedDoc, WORDS, wordsDoc } from "./support/pagesdocs";
import { makePng } from "./support/png";

const python = process.env.PLI_PDF_PYTHON;
const script = new URL("../scripts/pdfcheck.py", import.meta.url).pathname;

interface Check {
  qpdf: { problems?: string[]; pages?: number; error?: string };
  pypdf: { pages: { rotate: number; box: number[]; text: string }[]; outline: unknown[]; error?: string };
  mupdf: { pages: number; text: string[]; error?: string };
}

const dir = python ? mkdtempSync(join(tmpdir(), "pli-pdf-pages-")) : "";
let n = 0;

function check(bytes: Uint8Array): Check {
  const path = join(dir, `file-${n++}.pdf`);
  writeFileSync(path, bytes);
  return JSON.parse(execFileSync(python!, [script, path], { encoding: "utf8", maxBuffer: 1 << 26 }));
}

/** The words each reader finds on each page; and that all three agree there is nothing wrong. */
function words(bytes: Uint8Array): string[] {
  const r = check(bytes);
  expect(r.qpdf.error).toBeUndefined();
  expect(r.qpdf.problems).toEqual([]);
  expect(r.pypdf.error).toBeUndefined();
  expect(r.mupdf.error).toBeUndefined();
  expect(r.pypdf.pages.length).toBe(r.qpdf.pages);
  expect(r.mupdf.pages).toBe(r.qpdf.pages);
  const mu = r.mupdf.text.map((t) => t.trim());
  const py = r.pypdf.pages.map((p) => p.text.trim());
  expect(mu).toEqual(py);
  return mu;
}

describe.skipIf(!python)("independent readers see what the page operations wrote", () => {
  it("rotate, reorder, blank pages (an update of the original)", async () => {
    const s = await openPdf(fiveDoc());
    s.pages.rotate(["p:main:1"], 90);
    s.pages.move(["p:main:4"], 0);
    s.pages.insertBlank("p:main:0");
    const bytes = await s.save();
    expect(words(bytes)).toEqual(["Echo", "Alpha", "", "Bravo", "Charlie", "Delta"]);
    const r = check(bytes);
    expect(r.pypdf.pages.map((p) => p.rotate)).toEqual([0, 0, 0, 90, 0, 0]);
    expect(r.pypdf.outline.length).toBeGreaterThan(0);
  });

  it("delete (a new file) with the outline and links cleaned up", async () => {
    const s = await openPdf(fiveDoc());
    s.pages.remove(["p:main:4", "p:main:2"]);
    const bytes = await s.save();
    expect(words(bytes)).toEqual(["Alpha", "Bravo", "Delta"]);
    expect(JSON.stringify(check(bytes).pypdf.outline)).not.toContain("Echo");
  });

  it("merge, extract, split", async () => {
    const merged = await mergePdfs([wordsDoc(["Aa", "Bb"]), fiveDoc()], { bookmarks: true, names: ["a.pdf", "b.pdf"] });
    expect(words(merged)).toEqual(["Aa", "Bb", ...WORDS]);
    const r = check(merged);
    expect(JSON.stringify(r.pypdf.outline)).toContain("Part One");
    const s = await openPdf(merged);
    expect(words(await s.pages.extract([s.doc.pages[1]!.id, s.doc.pages[3]!.id]))).toEqual(["Bb", "Bravo"]);
    const parts = await s.pages.split({ every: 3 });
    expect(parts.map((p) => words(p))).toEqual([["Aa", "Bb", "Alpha"], ["Bravo", "Charlie", "Delta"], ["Echo"]]);
  });

  it("annotations and form fields of merged and copied pages", async () => {
    const form = new Uint8Array(readFileSync(new URL("./fixtures/forms-basic.pdf", import.meta.url)));
    const s = await openPdf(wordsDoc(["Aa"]));
    await s.pages.insertFrom(notedDoc());
    await s.pages.insertFrom(form);
    s.pages.duplicate([s.doc.pages[1]!.id]);
    const fields = s.doc.fields.length;
    const bytes = await s.save();
    const path = join(dir, `file-${n++}.pdf`);
    writeFileSync(path, bytes);
    const r = JSON.parse(execFileSync(python!, [script, path], { encoding: "utf8", maxBuffer: 1 << 26 }));
    expect(r.qpdf.problems).toEqual([]);
    expect(r.mupdf.pages).toBe(4 + 0);
    const types = (r.mupdf.annots as { page: number; type: string }[]).map((a) => `${a.page}:${a.type}`).sort();
    // Page 1 and its copy (page 2) each have a highlight and a square (MuPDF lists links apart).
    expect(types.filter((t) => t.startsWith("1:")).length).toBe(2);
    expect(types.filter((t) => t.startsWith("2:")).length).toBe(2);
    expect((r.mupdf.widgets as unknown[]).length).toBeGreaterThanOrEqual(fields);
    expect(Object.keys(r.pypdf.fields).length).toBe(fields);
  });

  it("pictures to pages", async () => {
    const canvas = createCanvas(30, 20);
    canvas.getContext("2d").fillRect(0, 0, 30, 20);
    const jpeg = new Uint8Array(canvas.toBuffer("image/jpeg", 90));
    const png = makePng({ width: 3, height: 3, colorType: 6, depth: 8, sample: (x) => [255, 0, 0, x * 100] });
    const bytes = await pdfFromImages([{ data: jpeg }, { data: png }], { fit: "image" });
    const r = check(bytes);
    expect(r.qpdf.problems).toEqual([]);
    expect(r.pypdf.pages.map((p) => p.box.slice(2))).toEqual([[30, 20], [3, 3]]);
    expect(r.mupdf.pages).toBe(2);
  });

  it("page labels and bookmarks, as pypdf and MuPDF read them", async () => {
    const s = await openPdf(wordsDoc(WORDS));
    s.pages.numberPages(["p:main:0", "p:main:1"], "roman");
    s.pages.numberPages(["p:main:2", "p:main:3", "p:main:4"], "decimal", { prefix: "A-" });
    s.pages.move(["p:main:0"], 4);
    s.outline.add("Last is first", "p:main:0", { y: 100 });
    const bytes = await s.save();
    const r = check(bytes);
    expect(r.qpdf.problems).toEqual([]);
    const path = join(dir, `file-${n - 1}.pdf`);
    const labels = execFileSync(python!, ["-c", "import sys,pypdf,pymupdf;print('|'.join(pypdf.PdfReader(sys.argv[1]).page_labels));d=pymupdf.open(sys.argv[1]);print('|'.join(p.get_label() for p in d))", path], { encoding: "utf8" }).trim().split("\n");
    expect(labels).toEqual(["ii|A-1|A-2|A-3|i", "ii|A-1|A-2|A-3|i"]);
    expect(r.pypdf.outline).toEqual([{ title: "Last is first", page: 4 }]);
  });
});
