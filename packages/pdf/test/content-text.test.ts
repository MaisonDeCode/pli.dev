import { describe, expect, it } from "vitest";
import { PdfFile } from "../src/cos/file";
import { pageWords, type PageText } from "../src/content/text";
import { extractText, searchText } from "../src/text";
import { streamObj } from "./support/handmade";
import { makePdf } from "./support/content";
import { compareWords, mupdfWords, python } from "./support/mupdf";
import { renderPdf } from "./support/render";

/** pdf.js and MuPDF are the oracles: what they find must be where we say it is. */
async function crossCheck(bytes: Uint8Array, tolerance = 2.5): Promise<{ ours: PageText[]; problems: string[] }> {
  const file = PdfFile.open(bytes);
  const ours = file.pages().map((_, i) => extractText(file, i));
  const problems: string[] = [];
  for (let i = 0; i < ours.length; i++) {
    const info = file.pages()[i]!;
    const [x0, , , y1] = info.cropBox;
    const page = ours[i]!;
    const pdfjs = await renderPdf(bytes, i, 1);
    for (const item of pdfjs.items) {
      const str = item.str.normalize("NFKC");
      const trimmed = str.trim();
      if (!trimmed) continue;
      const lead = str.length - str.trimStart().length;
      let found = false;
      for (const run of page.runs) {
        const at = run.text.normalize("NFKC").indexOf(trimmed);
        if (at < 0) continue;
        // glyph index = character index (ligatures excepted: fixtures that test them do not use this check)
        const g = run.glyphs[at]!;
        const dx = Math.abs(g.box.x - (item.x - x0));
        if (dx <= (lead ? 3 : 1) && Math.abs(run.origin[1] - (y1 - item.y)) <= 1.5 || (Math.abs(run.angle) > 1 && Math.abs(g.box.x + g.box.w / 2 - (item.x - x0)) < 30)) found = true;
        if (found) break;
      }
      if (!found) problems.push(`pdf.js item "${item.str}" at ${item.x},${item.y} not found among ${page.runs.map((r) => `"${r.text}"@${(r.glyphs[0]?.box.x ?? 0).toFixed(1)},${r.origin[1].toFixed(1)}`).join(" ")}`);
    }
    if (python) {
      const mu = mupdfWords(bytes).pages[i]!;
      problems.push(...compareWords(pageWords(page), mu.words, tolerance));
    }
  }
  return { ours, problems };
}

describe("reading text", () => {
  it("reads lines, kerning, spacing and font changes like pdf.js and MuPDF", async () => {
    const content = [
      "BT /F1 12 Tf 20 170 Td (Hello World) Tj",
      "0 -20 Td [(Wo) 120 (rld) -600 (again)] TJ",
      "/F2 14 Tf 0 -20 Td (Times text) Tj",
      "/F3 10 Tf 0.5 Tc 0 -20 Td (Spaced) Tj 0 Tc 10 Tw ( and words here) Tj",
      "/F4 11 Tf 0 Tw 14 TL T* (Next line) Tj (quoted line) ' 3 1 (both) \" ET",
    ].join("\n");
    const { ours, problems } = await crossCheck(makePdf({ content }));
    expect(problems).toEqual([]);
    const page = ours[0]!;
    expect(page.text.split("\n")).toEqual(["Hello World", "World again", "Times text", "Spaced and words here", "Next line", "quoted line", "both"]);
    expect(page.runs[0]!.font).toMatchObject({ name: "Helvetica", size: 12 });
    expect(page.runs.find((r) => r.text === "Next line")!.font).toMatchObject({ bold: true });
  });

  it("gives the same ids for the same bytes and different ones for different runs", () => {
    const bytes = makePdf({ content: "BT /F1 12 Tf 20 100 Td (one) Tj 0 -20 Td (two) Tj ET" });
    const a = extractText(PdfFile.open(bytes), 0).runs.map((r) => r.id);
    const b = extractText(PdfFile.open(bytes.slice()), 0).runs.map((r) => r.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(2);
    expect(a[0]).toMatch(/^r:0:\d+:0$/);
  });

  it("handles Tm, rotated text and a transformed coordinate system", async () => {
    const content = "q 1 0 0 1 10 10 cm BT /F1 12 Tf 0 1 -1 0 150 40 Tm (Going up) Tj ET Q BT /F2 12 Tf 1 0 0.3 1 30 150 Tm (Slanted) Tj ET q 0.5 0 0 0.5 0 0 cm BT /F1 40 Tf 100 200 Td (Half) Tj ET Q";
    const { ours, problems } = await crossCheck(makePdf({ content }));
    expect(problems).toEqual([]);
    const up = ours[0]!.runs.find((r) => r.text === "Going up")!;
    expect(Math.round(up.angle)).toBe(-90);
    expect(up.box.h).toBeGreaterThan(up.box.w);
    expect(ours[0]!.runs.find((r) => r.text === "Half")!.font.size).toBe(20);
  });

  it("uses the crop box and /Rotate", async () => {
    const content = "BT /F1 12 Tf 60 120 Td (Cropped text) Tj ET BT /F2 12 Tf 60 100 Td (Second line) Tj ET";
    const { ours, problems } = await crossCheck(makePdf({ content, mediaBox: "[0 0 300 200]", cropBox: "[50 40 250 160]", rotate: 90 }));
    expect(problems).toEqual([]);
    const run = ours[0]!.runs[0]!;
    // page space: origin at the crop box's top left, y down, unrotated
    expect(run.box.x).toBeCloseTo(10, 0);
    expect(run.box.y).toBeGreaterThan(30);
    expect(run.box.y).toBeLessThan(40);
    expect(ours[0]!.width).toBe(200);
    expect(ours[0]!.height).toBe(120);
  });

  it("enters form XObjects with their matrices", async () => {
    const form = streamObj(20, "/Type /XObject /Subtype /Form /BBox [0 0 100 50] /Matrix [1 0 0 1 100 20] /Resources << /Font << /F1 40 0 R >> >>", "BT /F1 10 Tf 5 20 Td (In the form) Tj ET");
    const bytes = makePdf({ content: "BT /F1 12 Tf 10 180 Td (Outside) Tj ET q 2 0 0 2 0 0 cm /Fm1 Do Q", resources: "/XObject << /Fm1 20 0 R >>", objs: [form] });
    const { ours, problems } = await crossCheck(bytes);
    expect(problems).toEqual([]);
    const run = ours[0]!.runs.find((r) => r.text === "In the form")!;
    expect(run.font.size).toBe(20);
    expect(run.id).toMatch(/^r:0:Fm1~\d+:0$/);
    expect(ours[0]!.text).toContain("Outside");
  });

  it("reads text split over several content streams", async () => {
    const bytes = makePdf({ content: ["BT /F1 12 Tf 20 100 Td (First) Tj", "ET BT /F1 12 Tf 20 80 Td (Second) Tj ET"] });
    expect(extractText(PdfFile.open(bytes), 0).text).toBe("First\nSecond");
  });
});

describe("searching", () => {
  it("finds words with rectangles, case, whole words, regular expressions and line breaks", () => {
    const bytes = makePdf({ content: "BT /F1 12 Tf 20 100 Td (The Invoice number is 12345.) Tj 0 -14 Td (An invoice is paid when) Tj 0 -14 Td (the total) Tj ET" });
    const file = PdfFile.open(bytes);
    const hits = searchText(file, "invoice");
    expect(hits.map((h) => h.text)).toEqual(["Invoice", "invoice"]);
    expect(hits[0]!.rects).toHaveLength(1);
    expect(hits[0]!.rects[0]!.x).toBeCloseTo(44.01, 1);
    expect(searchText(file, "invoice", { caseSensitive: true }).map((h) => h.text)).toEqual(["invoice"]);
    expect(searchText(file, "is", { wholeWord: true })).toHaveLength(2);
    expect(searchText(file, "\\d{5}", { regex: true }).map((h) => h.text)).toEqual(["12345"]);
    const across = searchText(file, "paid when the total");
    expect(across).toHaveLength(1);
    expect(across[0]!.rects).toHaveLength(2);
    expect(searchText(file, "")).toEqual([]);
  });
});

describe("through a session", () => {
  it("reads and searches pages by id, with merged and blank pages", async () => {
    const { openPdf } = await import("../src");
    const bytes = makePdf({ content: "BT /F1 12 Tf 20 100 Td (needle in page one) Tj ET", more: ["BT /F1 12 Tf 20 100 Td (second needle here) Tj ET"] });
    const s = await openPdf(bytes);
    s.pages.insertBlank("p:main:0");
    const second = s.doc.pages[2]!.id;
    expect((await extractText(s, second)).text).toBe("second needle here");
    expect((await extractText(s, 1)).text).toBe("");
    const hits = await searchText(s, "needle");
    expect(hits.map((h) => [h.page, h.pageId])).toEqual([[0, "p:main:0"], [2, "p:main:1"]]);
    expect((await s.content.search("needle")).map((h) => h.page)).toEqual([0, 2]);
    expect((await extractText(s, 0)).pageId).toBe("p:main:0");
  });
});
