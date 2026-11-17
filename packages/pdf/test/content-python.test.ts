// Optional: files made by MuPDF are read the same way by us and by it; files we redact and edit open cleanly in qpdf,
// pypdf and MuPDF and have lost the words. Set PLI_PDF_PYTHON to a python with pikepdf, pypdf and pymupdf.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { pageWords } from "../src/content/text";
import { PdfFile } from "../src/cos/file";
import { extractText, searchText } from "../src/text";
import { contains } from "./support/leak";
import { compareWords, mupdfWords, python } from "./support/mupdf";
import { renderPdf } from "./support/render";

const lora = new URL("../../core/test/fixtures/fonts/lora-latin-400-normal.ttf", import.meta.url).pathname;
const check = new URL("../scripts/pdfcheck.py", import.meta.url).pathname;

function make(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "pli-pdf-"));
  const out = join(dir, "made.pdf");
  execFileSync(python!, ["-I", new URL("../scripts/mkcontent.py", import.meta.url).pathname, out, lora]);
  return new Uint8Array(readFileSync(out));
}

function pdfcheck(bytes: Uint8Array): { qpdf: { problems?: string[]; error?: string }; pypdf: { pages: { text: string }[] }; mupdf: { text: string[] } } {
  const path = join(mkdtempSync(join(tmpdir(), "pli-pdf-")), "out.pdf");
  writeFileSync(path, bytes);
  return JSON.parse(execFileSync(python!, ["-I", check, path], { encoding: "utf8", maxBuffer: 1 << 26 }));
}

describe.skipIf(!python)("with MuPDF, qpdf and pypdf", () => {
  const made = python ? make() : new Uint8Array();

  it("reads a MuPDF file the way MuPDF does: words, boxes, turned and cropped pages", () => {
    const file = PdfFile.open(made);
    const mu = mupdfWords(made);
    for (let i = 0; i < file.pageCount(); i++) expect(compareWords(pageWords(extractText(file, i)), mu.pages[i]!.words)).toEqual([]);
    expect(extractText(file, 0).text).toContain("Café sécurité");
  });

  it("redacts a word and a corner of a picture; every reader opens the file and none finds the word", async () => {
    const s = await openPdf(made);
    expect((await s.content.markSearch("SECRETWORD")).length).toBe(2);
    expect((await s.content.markSearch("CIDSECRET")).length).toBe(1); // in a 2-byte font
    const page = s.doc.pages[0]!;
    const [img] = await s.content.images(page.id);
    expect(img).toBeDefined();
    s.content.markRedaction(page.id, [{ x: img!.box.x - 5, y: img!.box.y - 5, w: img!.box.w / 2 + 5, h: img!.box.h / 2 + 5 }]);
    s.content.applyRedactions();
    const saved = await s.saveDetailed();
    const out = saved.bytes;
    expect(contains(out, "SECRETWORD")).toBe(false);
    expect(contains(out, "CIDSECRET")).toBe(false);
    const c = pdfcheck(out);
    expect(c.qpdf.error).toBeUndefined();
    expect(c.qpdf.problems ?? []).toEqual([]);
    expect(c.pypdf.pages.map((p) => p.text).join("\n")).not.toContain("SECRETWORD");
    expect(c.mupdf.text.join("\n")).not.toContain("SECRETWORD");
    expect(c.mupdf.text.join("\n")).not.toContain("CIDSECRET");
    expect(c.mupdf.text.join("\n")).toContain("résumé");
    expect(c.mupdf.text.join("\n")).toContain("Invoice 20481");
    // the corner of the picture is black, the opposite corner is still the picture's colour
    const r = await renderPdf(out, 0, 2);
    expect(r.pixel(img!.box.x + 3, img!.box.y + 3).slice(0, 3)).toEqual([0, 0, 0]);
    const far = r.pixel(img!.box.x + img!.box.w - 3, img!.box.y + img!.box.h - 3);
    expect(far[0]).toBeGreaterThan(150);
    // the other words are where they were
    const before = pageWords(extractText(PdfFile.open(made), 0)).filter((w) => w.text !== "SECRETWORD");
    const after = pageWords(extractText(PdfFile.open(out), 0));
    for (const w of after) expect(before.some((b) => b.text === w.text && Math.abs(b.box.x - w.box.x) < 0.05 && Math.abs(b.box.y - w.box.y) < 0.05), w.text).toBe(true);
  });

  it("replaces text in a MuPDF file and the other readers show the new text", async () => {
    const s = await openPdf(made);
    const run = (await s.content.runs(s.doc.pages[0]!.id)).find((r) => r.text.startsWith("Invoice"))!;
    await s.content.replaceText(run.id, "Credit note 77 for ACME Widgets");
    const saved = await s.saveDetailed();
    expect(saved.warnings).toEqual([]);
    const c = pdfcheck(saved.bytes);
    expect(c.qpdf.problems ?? []).toEqual([]);
    expect(c.mupdf.text[0]).toContain("Credit note 77 for ACME Widgets");
    expect(c.mupdf.text[0]).not.toContain("Invoice");
    expect(c.pypdf.pages[0]!.text).toContain("Credit note 77");
    expect(searchText(saved.bytes, "Credit note")).toHaveLength(1);
  });

  it("writes files qpdf has nothing to say about, for every kind of edit", async () => {
    const { makePdf } = await import("./support/content");
    const { obj, streamObj } = await import("./support/handmade");
    const { makePng } = await import("./support/png");
    const { encodeBase64 } = await import("@pli.dev/core");
    const loraBytes = new Uint8Array(readFileSync(lora));
    const rgb = new Uint8Array(300);
    for (let i = 0; i < 100; i++) rgb.set([i * 2, 10, 200], i * 3);
    const form = streamObj(21, "/Type /XObject /Subtype /Form /BBox [0 0 200 60] /Matrix [1 0 0 1 20 100] /Resources << /Font << /F1 40 0 R >> >>", "BT /F1 12 Tf 0 30 Td (Inside form) Tj ET");
    const base = {
      content: "q 100 0 0 50 50 100 cm /Im1 Do Q /Fm1 Do BT /F1 12 Tf 20 20 Td (Plain words here) Tj ET BT /F2 12 Tf 20 60 Td [(Kern) 80 (ed) -300 (text)] TJ ET 0 0 1 rg 10 10 50 50 re f",
      resources: "/XObject << /Im1 20 0 R /Fm1 21 0 R >>",
      objs: [streamObj(20, "/Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8", rgb, true), form, obj(30, "<< /Type /Annot /Subtype /Link /Rect [10 10 60 60] /Border [0 0 0] >>")],
      pageExtra: "/Annots [30 0 R]",
    };
    const png = "data:image/png;base64," + encodeBase64(makePng({ width: 4, height: 4, colorType: 2, depth: 8, sample: () => [0, 200, 0] }));
    const runs: Record<string, (s: Awaited<ReturnType<typeof openPdf>>) => Promise<void>> = {
      redactText: async (s) => {
        await s.content.markSearch("Plain");
        s.content.applyRedactions();
      },
      redactRectOverEverything: async (s) => {
        s.content.markRedaction(s.doc.pages[0]!.id, [{ x: 30, y: 60, w: 100, h: 120 }]);
        s.content.applyRedactions();
      },
      replaceText: async (s) => void (await s.content.replaceText((await s.content.runs(s.doc.pages[0]!.id))[0]!.id, "Replaced \u00e9")),
      replaceTextEmbedded: async (s) => void (await s.content.replaceText((await s.content.runs(s.doc.pages[0]!.id))[0]!.id, "Replaced \u00e9", { family: "Lora" })),
      replaceImage: async (s) => void (await s.content.replaceImage("i:Im1", { src: png })),
      removeImage: async (s) => void (await s.content.replaceImage("i:Im1", null)),
    };
    for (const [name, run] of Object.entries(runs)) {
      const s = await openPdf(makePdf(base));
      await run(s);
      for (const options of [{}, { mode: "optimise" as const }]) {
        const out = await s.save({ ...options, fonts: { Lora: loraBytes } });
        const c = pdfcheck(out);
        expect(c.qpdf.error, name).toBeUndefined();
        expect(c.qpdf.problems ?? [], name).toEqual([]);
        expect(c.mupdf.text.length, name).toBe(1);
      }
    }
    const scrubbed = await (await openPdf(makePdf(base))).content.scrubMetadata();
    expect(pdfcheck(scrubbed.bytes).qpdf.problems ?? []).toEqual([]);
  });
});
