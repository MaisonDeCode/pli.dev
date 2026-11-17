import { describe, expect, it } from "vitest";
import { strFromU8, unzlibSync } from "fflate";
import { SheetSession, createWorkbook, headerPictureFrom, printToPdf, type PdfRasterRequest, type PrintPdfOptions } from "../src";
import { pngUri } from "./images-helpers";

const now = () => 45_000.5;
const make = (title = "Budget") => new SheetSession(createWorkbook(title, ["Sheet1"]), { now });
const DATE = new Date(Date.UTC(2026, 10, 10));
const run = (s: SheetSession, options: PrintPdfOptions = {}) => printToPdf(s, "Sheet1", { date: DATE, ...options });

/** The content streams of a PDF, inflated, in file order. */
function streams(bytes: Uint8Array): string[] {
  const text = strFromU8(bytes, true);
  const out: string[] = [];
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out.push(strFromU8(unzlibSync(bytes.subarray(start, end).slice(0, end - start - 1)), true));
    } catch {
      /* not a compressed stream */
    }
  }
  return out.filter((c) => /BT|re |cm /.test(c));
}

/** The text drawn on each page, in order, with each piece's position (points from the top left of a page of `height`). */
function pages(bytes: Uint8Array, height = 792): { text: string; x: number; y: number }[][] {
  return streams(bytes).map((content) => {
    const out: { text: string; x: number; y: number }[] = [];
    for (const m of content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9A-F]*)> Tj/g)) {
      const codes = m[3]!.match(/../g) ?? [];
      out.push({ text: codes.map((c) => String.fromCharCode(parseInt(c, 16))).join(""), x: Number(m[1]), y: height - Number(m[2]) });
    }
    return out;
  });
}
const allText = (bytes: Uint8Array) => pages(bytes).map((p) => p.map((t) => t.text).join("|"));
const pageCount = (bytes: Uint8Array) => (strFromU8(bytes, true).match(/\/Type \/Page /g) ?? []).length;

describe("the printout as a PDF file", () => {
  it("is a PDF with a page for each page of the printout, as many as printLayout says", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 100 }, (_, r) => [`row ${r + 1}`]));
    const layout = s.printLayout("Sheet1");
    expect(layout.pages.length).toBeGreaterThan(1);
    const { bytes, pages: count } = await run(s);
    expect(strFromU8(bytes.subarray(0, 8))).toMatch(/^%PDF-1\.7/);
    expect(count).toBe(layout.pages.length);
    expect(pageCount(bytes)).toBe(layout.pages.length);
    expect(allText(bytes)[0]).toContain("row 1");
    expect(allText(bytes)[1]).toContain(`row ${layout.pages[1]!.range.r1}`);
    expect(strFromU8(bytes, true)).toContain("/MediaBox [0 0 612 792]");
  });

  it("makes the same bytes every time from the same sheet and date", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", 1], ["b", 2]]);
    const [x, y] = [await run(s), await run(s)];
    expect(Buffer.from(x.bytes).equals(Buffer.from(y.bytes))).toBe(true);
  });

  it("uses the paper, orientation and the pages asked for", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 100 }, (_, r) => [r]));
    s.setPageSetup("Sheet1", { paper: "a4", orientation: "landscape" });
    const all = await run(s);
    expect(strFromU8(all.bytes, true)).toContain("/MediaBox [0 0 841.89 595.276]");
    const second = await run(s, { pages: [2] });
    expect(second.pages).toBe(1);
    expect(allText(second.bytes)[0]).toContain(String(s.printLayout("Sheet1").pages[1]!.range.r1 - 1));
  });

  it("shows what the cells show: formatted values, aligned, bold and coloured, and clips text at its cell", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Item", "Price"], ["Pens, a rather long name", 3.5], ["x", "=B2*2"]]);
    s.setFormat("Sheet1", "B2:B3", "$#,##0.00");
    s.setStyle("Sheet1", "A1:B1", { bold: true, color: "#ff0000", fill: "#ffff00" });
    s.setValues("Sheet1", "C2", [["next"]]);
    const { bytes } = await run(s);
    const [page] = pages(bytes);
    const text = (t: string) => page!.find((p) => p.text === t)!;
    expect(text("$3.50")).toBeTruthy();
    expect(text("$7.00")).toBeTruthy();
    // Numbers sit at the right of their cell: column B ends at 50.4 + 48 * 2 = 146.4 (the left margin is 0.7in).
    expect(text("$3.50").x).toBeGreaterThan(110);
    expect(text("$3.50").x).toBeLessThan(146.4 - 2 - 20);
    const content = streams(bytes)[0]!;
    // The header's fill and red ink; the long text is cut off at its cell by a clip.
    expect(content).toMatch(/1 1 0 rg [\d. ]+ re f/);
    expect(content).toMatch(/1 0 0 rg/);
    expect(content).toMatch(/q [\d. ]+ re W n\nBT [^\n]*<[0-9A-F]+> Tj ET\nQ/);
  });

  it("draws gridlines and headings when the sheet prints them, and leaves gridlines out in draft quality", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", "b"], ["c", "d"]]);
    s.setPageSetup("Sheet1", { gridlines: true, headings: true });
    const withLines = streams((await run(s)).bytes)[0]!;
    expect(withLines).toContain("0.749 0.749 0.749 RG");
    // Row numbers and column letters.
    expect(pages((await run(s)).bytes)[0]!.map((t) => t.text)).toEqual(expect.arrayContaining(["A", "B", "1", "2"]));
    s.setPageSetup("Sheet1", { draft: true });
    const draft = streams((await run(s)).bytes)[0]!;
    expect(draft).not.toContain("0.749 0.749 0.749 RG");
    // Headings still print in draft quality: they are not graphics.
    expect(pages((await run(s)).bytes)[0]!.map((t) => t.text)).toContain("A");
  });

  it("draws the lines a cell has, double and dashed ones too", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", "b"]]);
    s.setStyle("Sheet1", "A1", { border: { bottom: { style: "dashed", color: "#00ff00" }, top: { style: "double", color: "#0000ff" } } });
    const content = streams((await run(s)).bytes)[0]!;
    expect(content).toContain("0 1 0 RG");
    expect(content).toMatch(/\[[\d. ]+\] 0 d/);
    expect((content.match(/0 0 1 RG/g) ?? []).length).toBe(2);
  });

  it("sets header and footer text in the margins, with page numbers worked out, and a picture in the header", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 100 }, (_, r) => [r]));
    s.setPageSetup("Sheet1", { header: { center: "Report &A" }, footer: { right: "Page &P of &N" } });
    s.setHeaderFooterPicture("Sheet1", "header", "left", headerPictureFrom(pngUri(8, 4, [0, 128, 0]), { width: 60, height: 30 }));
    const { bytes } = await run(s);
    const first = pages(bytes)[0]!;
    const total = s.printLayout("Sheet1").pages.length;
    expect(first.map((t) => t.text)).toEqual(expect.arrayContaining(["Report Sheet1", `Page 1 of ${total}`]));
    // The header is in the top margin (0.3in from the top), the footer in the bottom one.
    expect(first.find((t) => t.text === "Report Sheet1")!.y).toBeLessThan(36);
    expect(first.find((t) => t.text.startsWith("Page 1"))!.y).toBeGreaterThan(792 - 36);
    expect(pages(bytes)[1]!.map((t) => t.text)).toContain(`Page 2 of ${total}`);
    expect(strFromU8(bytes, true)).toMatch(/\/Subtype \/Image \/Width 8 \/Height 4/);
  });

  it("prints a picture over the cells, cut where the print area ends, and none in draft quality", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", "b"], ["c", "d"]]);
    s.addImage("Sheet1", { src: pngUri(16, 8, [200, 0, 0]), from: { row: 1, col: 1 }, width: 64, height: 32, alt: "box" });
    const text = (b: Uint8Array) => strFromU8(b, true);
    expect(text((await run(s)).bytes)).toMatch(/\/Subtype \/Image \/Width 16 \/Height 8/);
    s.setPageSetup("Sheet1", { draft: true });
    expect(text((await run(s)).bytes)).not.toMatch(/\/Subtype \/Image/);
  });

  it("turns pictures, charts and fills grey in black and white", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", 1]]);
    s.setStyle("Sheet1", "A1", { fill: "#ff0000", color: "#00ff00" });
    s.setPageSetup("Sheet1", { blackAndWhite: true });
    const content = streams((await run(s)).bytes)[0]!;
    expect(content).not.toMatch(/1 0 0 rg/);
    expect(content).not.toMatch(/0 1 0 rg/);
  });

  it("asks the host's rasterizer for a chart, and draws a frame with its title when there is none", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Item", "Qty"], ["a", 1], ["b", 2]]);
    const chart = s.addChart("Sheet1", { type: "radar", title: "Quantities", series: [{ values: "Sheet1!$B$2:$B$3" }], from: { row: 5, col: 1 }, width: 300, height: 200 });
    expect(chart).toBeTruthy();
    const none = await run(s);
    expect(none.warnings.join(" ")).toMatch(/radar chart is drawn by the host/);
    expect(allText(none.bytes)[0]).toContain("Quantities");
    const asked: PdfRasterRequest[] = [];
    const red = new Uint8Array(4 * 4 * 3).map((_, i) => (i % 4 === 0 ? 255 : i % 4 === 3 ? 255 : 0));
    const some = await run(s, { rasterize: (r) => (asked.push(r), { rgba: red, width: 4, height: 3 }) });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ kind: "chart", width: 300, height: 200 });
    expect(some.warnings).toEqual([]);
    expect(strFromU8(some.bytes, true)).toMatch(/\/Subtype \/Image \/Width 4 \/Height 3/);
    expect(allText(some.bytes)[0]).not.toContain("Quantities");
  });

  it("draws charts of the common kinds itself, as lines, rectangles and text, with no host to help", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Item", "Qty", "Cost"], ["Apples", 10, 4], ["Pears", 25, 8], ["Plums", 17, 6]]);
    for (const type of ["column", "bar", "line", "area", "scatter", "pie", "doughnut"] as const) {
      const c = s.addChart("Sheet1", { type, title: `T-${type}`, categories: "Sheet1!$A$2:$A$4", series: [{ values: "Sheet1!$B$2:$B$4", name: "Qty" }, { values: "Sheet1!$C$2:$C$4", name: "Cost" }], from: { row: 6, col: 1 }, width: 320, height: 220 });
      const out = await run(s);
      expect(out.warnings, type).toEqual([]);
      expect(allText(out.bytes)[0], type).toContain(`T-${type}`);
      const content = streams(out.bytes)[0]!;
      expect(content, type).toMatch(type === "pie" || type === "doughnut" ? / c / : /re f/);
      if (type === "column") expect(allText(out.bytes)[0]).toMatch(/Apples/);
      if (type === "pie") expect(allText(out.bytes)[0]).toMatch(/\d+%/);
      s.deleteChart("Sheet1", c.id);
    }
  });

  it("draws the icons of conditional formats as curves and polygons in the file, not as pictures", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1], [5], [9]]);
    s.addRule("Sheet1", { kind: "iconSet", ranges: ["A1:A3"], set: "3TrafficLights1", thresholds: [{ type: "num", value: 3 }, { type: "num", value: 7 }] } as never);
    const out = await run(s);
    expect(out.warnings).toEqual([]);
    const raw = strFromU8(out.bytes, true);
    expect(raw).not.toMatch(/\/Subtype \/Image/);
    // three circles, each four curves, each filled
    expect(streams(out.bytes)[0]!.match(/ c /g)!.length).toBeGreaterThanOrEqual(12);
    s.setPageSetup("Sheet1", { blackAndWhite: true });
    expect(streams((await run(s)).bytes)[0]).not.toMatch(/0\.898 0\.282/);
  });

  it("lets text run on over empty cells to the right, and cuts it off at the edge of the page's cells", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["A rather long sentence that needs several columns", null, null, null, null, "end"]]);
    s.setPageSetup("Sheet1", { colBreaks: [2] });
    const out = pages((await run(s)).bytes);
    // Page 1 has columns A:B: the sentence is there, cut off at B's edge by a clip that is 96pt wide (its own cell and the next).
    expect(out[0]!.map((t) => t.text)).toContain("A rather long sentence that needs several columns");
    expect(out[1]!.map((t) => t.text)).not.toContain("A rather long sentence that needs several columns");
    const clip = streams((await run(s)).bytes)[0]!.match(/q 50\.4 [\d.]+ ([\d.]+) [\d.]+ re W n/);
    expect(Number(clip![1])).toBeCloseTo(96, 0);
  });

  it("prints the notes that are showing as boxes with their author, and the list of notes after the sheet", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 6 }, (_, r) => ["a", "b", "c", "d", "e"].map((x) => `${x}${r}`)));
    s.setNote("Sheet1", "A2", "Shown note", { author: "Pat", box: { show: true } });
    s.setNote("Sheet1", "B5", "Hidden note");
    s.setPageSetup("Sheet1", { comments: "sheet" });
    const a = await run(s);
    const text = allText(a.bytes)[0]!;
    expect(text).toContain("Pat:");
    expect(text).toContain("Shown note");
    expect(text).not.toContain("Hidden note");
    expect(streams(a.bytes)[0]).toMatch(/1 1 0\.88\d* rg/);
    s.setPageSetup("Sheet1", { comments: "end" });
    const b = await run(s);
    expect(b.pages).toBe(2);
    const list = allText(b.bytes)[1]!;
    expect(list).toContain("Cell A2:");
    expect(list).toContain("Shown note");
    expect(list).toContain("Cell B5:");
    expect(list).toContain("Hidden note");
  });

  it("prints errors the way the page setup says", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["=1/0"]]);
    expect(allText((await run(s)).bytes)[0]).toBe("#DIV/0!");
    s.setPageSetup("Sheet1", { errors: "dash" });
    expect(allText((await run(s)).bytes)[0]).toBe("--");
  });

  it("keeps links on text as link areas", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["site"]]);
    s.setLink("Sheet1", "A1", { to: "https://example.com/" });
    expect(strFromU8((await run(s)).bytes, true)).toMatch(/\/URI \(https:\/\/example\.com\/\)/);
  });

  it("scales, centres and numbers pages as the setup says", async () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["x"]]);
    s.setPageSetup("Sheet1", { scale: 200, centerHorizontally: true, footer: { center: "&P" }, firstPageNumber: 7 });
    const out = pages((await run(s)).bytes)[0]!;
    expect(out.find((t) => t.text === "7")).toBeTruthy();
    const x = out.find((t) => t.text === "x")!;
    // At 200% the one cell (48pt) is 96pt wide, centred in the 511.2pt between the margins: its left edge is at 50.4 + (511.2 - 96) / 2, and its text 4pt inside.
    expect(x.x).toBeCloseTo(50.4 + (511.2 - 96) / 2 + 4, 0);
  });

  it("gives no pages for a sheet with nothing to print", async () => {
    const r = await run(make());
    expect(r.pages).toBe(0);
  });
});
