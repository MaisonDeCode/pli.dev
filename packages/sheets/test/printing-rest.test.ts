import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, headerPictureFrom, toXlsx } from "../src";
import { lintPackage } from "./excel-check/lint";
import { pngUri } from "./images-helpers";
import { SAMPLES } from "./excel-check/samples";

const now = () => 45_000.5;
const make = (names: string[] = ["Sheet1"]) => new SheetSession(createWorkbook("Rest", names), { now });
const files = (s: SheetSession) => unzipSync(toXlsx(s.state));
const text = (f: Record<string, Uint8Array>, name: string) => strFromU8(f[name]!);

describe("pictures in headers and footers, the way Excel names them", () => {
  const withLogos = () => {
    const s = make(["One", "Two"]);
    for (const sheet of ["One", "Two"]) {
      s.setValues(sheet, "A1", [["a", "b"], [1, 2]]);
      s.setHeaderFooterPicture(sheet, "header", "left", headerPictureFrom(pngUri(8, 4), { width: 80, height: 40 }));
      s.setHeaderFooterPicture(sheet, "header", "right", headerPictureFrom(pngUri(8, 4, [0, 0, 255]), { width: 60, height: 30 }));
      s.setHeaderFooterPicture(sheet, "footer", "center", headerPictureFrom(pngUri(8, 4, [0, 255, 0]), { width: 60, height: 30 }));
      s.setHeaderFooterPicture(sheet, "firstHeader", "center", headerPictureFrom(pngUri(8, 4), { width: 60, height: 30 }));
      s.setHeaderFooterPicture(sheet, "evenFooter", "right", headerPictureFrom(pngUri(8, 4), { width: 60, height: 30 }));
    }
    return s;
  };

  it("writes one shape for each picture, named for its place, with a type, an o:spid and a relationship to its picture", () => {
    const f = files(withLogos());
    const vml = text(f, "xl/drawings/vmlDrawingHF1.vml");
    expect([...vml.matchAll(/<v:shape id="([A-Z]+)"/g)].map((m) => m[1])).toEqual(["LH", "RH", "CF", "RFEVEN", "CHFIRST"]);
    expect(vml.match(/type="#_x0000_t75"/g)).toHaveLength(5);
    expect(vml).toContain('<v:shapetype id="_x0000_t75"');
    const spids = [...vml.matchAll(/o:spid="(_x0000_s\d+)"/g)].map((m) => m[1]!);
    expect(new Set(spids).size).toBe(5);
    expect([...vml.matchAll(/<v:imagedata o:relid="(rId\d+)"/g)].map((m) => m[1])).toEqual(["rId1", "rId2", "rId3", "rId4", "rId5"]);
    expect(text(f, "xl/drawings/_rels/vmlDrawingHF1.vml.rels")).toMatch(/Id="rId5"[^>]*Target="..\/media\/image5\.png"/);
    expect(text(f, "xl/worksheets/sheet1.xml")).toMatch(/<legacyDrawingHF r:id="rId\d+"\/>/);
  });

  it("gives each sheet's header drawing a block of shape numbers of its own, after the blocks of the notes", () => {
    const s = withLogos();
    s.setNote("One", "B2", "A note");
    s.setNote("Two", "B2", "Another note");
    const f = files(s);
    // Two sheets: the notes use blocks 1 and 2, the header pictures blocks 3 and 4.
    expect(text(f, "xl/drawings/vmlDrawing1.vml")).toContain('<o:idmap v:ext="edit" data="1"/>');
    expect(text(f, "xl/drawings/vmlDrawing1.vml")).toContain('id="_x0000_s1025"');
    const hf1 = text(f, "xl/drawings/vmlDrawingHF1.vml");
    const hf2 = text(f, "xl/drawings/vmlDrawingHF2.vml");
    expect(hf1).toContain('<o:idmap v:ext="edit" data="3"/>');
    expect(hf2).toContain('<o:idmap v:ext="edit" data="4"/>');
    expect(hf1).toContain('o:spid="_x0000_s3073"');
    expect(hf2).toContain('o:spid="_x0000_s4097"');
    // No shape number is used by both drawings of a sheet.
    const noteIds = [...text(f, "xl/drawings/vmlDrawing1.vml").matchAll(/ id="(_x0000_s\d+)"/g)].map((m) => m[1]);
    const hfIds = [...hf1.matchAll(/o:spid="(_x0000_s\d+)"/g)].map((m) => m[1]);
    expect(noteIds.filter((id) => hfIds.includes(id))).toEqual([]);
    expect(lintPackage(toXlsx(s.state))).toEqual([]);
  });

  it("reads them back with their places and sizes", () => {
    const back = fromXlsx(toXlsx(withLogos().state)).workbook.sheets[0]!.page!;
    expect(back.pictures!.header!.left).toMatchObject({ width: 80, height: 40 });
    expect(back.pictures!.header!.right).toMatchObject({ width: 60, height: 30 });
    expect(back.pictures!.footer!.center).toMatchObject({ width: 60, height: 30 });
    expect(Object.keys(back.pictures!.firstHeader!)).toEqual(["center"]);
    expect(Object.keys(back.pictures!.evenFooter!)).toEqual(["right"]);
  });

  it("is passed by the package check, which notices a repeated shape number, a missing type and a picture the text has no &G for", () => {
    const s = withLogos();
    const bytes = toXlsx(s.state);
    expect(lintPackage(bytes)).toEqual([]);
    const f = unzipSync(bytes);
    const edit = (path: string, fn: (t: string) => string) => lintPackage(zipSync({ ...f, [path]: strToU8(fn(strFromU8(f[path]!))) })).join("\n");
    expect(edit("xl/drawings/vmlDrawingHF1.vml", (t) => t.replace(/o:spid="_x0000_s3074"/, 'o:spid="_x0000_s3073"'))).toMatch(/o:spid _x0000_s3073 is used twice/);
    expect(edit("xl/drawings/vmlDrawingHF1.vml", (t) => t.replace('type="#_x0000_t75"', 'type="#_x0000_t99"'))).toMatch(/type="#_x0000_t99", which no shapetype/);
    expect(edit("xl/drawings/vmlDrawingHF1.vml", (t) => t.replace('id="LH"', 'id="XH"'))).toMatch(/shape "XH" isn't one of the header and footer places/);
    expect(edit("xl/drawings/vmlDrawingHF1.vml", (t) => t.replace('id="RH"', 'id="LH"'))).toMatch(/shape id LH is used twice/);
    expect(edit("xl/drawings/vmlDrawingHF1.vml", (t) => t.replace('o:spid="_x0000_s3074"', 'o:spid="_x0000_s9999"'))).toMatch(/outside the blocks the idmap names/);
    expect(edit("xl/worksheets/sheet1.xml", (t) => t.replace(/&amp;G/g, ""))).toMatch(/has a picture, and the oddHeader text has no &G/);
  });
});

describe("text running on, at page breaks and print area edges", () => {
  const LONG = "A rather long sentence that needs several columns of room to be read in full";
  const pageOf = (s: SheetSession, n: number) => s.printPage("Sheet1", s.printLayout("Sheet1").pages[n]!);

  it("is cut off where a column page break falls, and the next page does not carry on with the rest", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[LONG, null, null, null, null, "end"]]);
    s.setPageSetup("Sheet1", { colBreaks: [2] });
    const layout = s.printLayout("Sheet1");
    expect(layout.pages.map((p) => [p.range.c1, p.range.c2])).toEqual([[1, 2], [3, 6]]);
    // The first page lets it run over B only; the second page has no trace of the sentence.
    expect(pageOf(s, 0).overflow).toEqual([expect.objectContaining({ col: 1, from: 1, to: 2, over: 1 })]);
    expect(pageOf(s, 0).html).toContain("pli-print-run");
    expect(pageOf(s, 1).overflow).toEqual([]);
    expect(pageOf(s, 1).html).not.toContain("sentence");
  });

  it("is cut off at the edge of the print area, whatever lies beyond it", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[LONG, null, null, null, null, "end"]]);
    s.setPageSetup("Sheet1", { printArea: ["A1:C1"] });
    const page = pageOf(s, 0);
    expect(page.overflow).toEqual([expect.objectContaining({ col: 1, from: 1, to: 3, over: 2 })]);
    expect(s.printLayout("Sheet1").pages).toHaveLength(1);
    // Right-aligned text in the print area's first column has nothing to run into on its left.
    s.setValues("Sheet1", "B2", [[LONG]]);
    s.setStyle("Sheet1", "B2", { align: "right" });
    s.setPageSetup("Sheet1", { printArea: ["B1:F2"] });
    expect(pageOf(s, 0).overflow.filter((o) => o.row === 2)).toEqual([]);
  });

  it("does not let a cell run on into a column that is not next to it on the page (a repeated title column)", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[LONG, null, null, null, null, "x"]]);
    s.setPageSetup("Sheet1", { colBreaks: [3], titleCols: [1, 1] });
    const pages = s.printLayout("Sheet1").pages;
    expect(pages).toHaveLength(2);
    const second = s.printPage("Sheet1", pages[1]!);
    // Page 2 has column A again as a title, then D to F: B and C are not there, so A's text stays in its own cell.
    expect(second.overflow).toEqual([]);
  });

  it("runs on over columns that are hidden between, as if they were not there", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[LONG, null, null, null, "stop"]]);
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "col", index: 2, hidden: true }]);
    const page = pageOf(s, 0);
    expect(page.overflow[0]).toMatchObject({ col: 1, to: 4 });
  });
});

describe("notes printed as displayed, the way Excel places them", () => {
  const grid = (rows = 8, cols = 8) => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${r}${c}`)));
    s.setPageSetup("Sheet1", { comments: "sheet" });
    return s;
  };
  const notes = (s: SheetSession, n = 0) => s.printPage("Sheet1", s.printLayout("Sheet1").pages[n]!).notes;

  it("lists only the notes that are kept showing, never the ones that show when the pointer rests on the cell", () => {
    const s = grid();
    s.setNote("Sheet1", "B2", "one");
    s.setNote("Sheet1", "C3", "two");
    expect(notes(s)).toEqual([]);
    s.showNote("Sheet1", "C3");
    expect(notes(s).map((n) => n.cell)).toEqual(["C3"]);
    s.showNote("Sheet1", "C3", false);
    expect(notes(s)).toEqual([]);
  });

  it("prints a note's box in the size and place it has on the sheet, so a box moved or sized prints that way", () => {
    const s = grid();
    s.setNote("Sheet1", "B2", "moved", { box: { show: true, dx: 100, dy: 40, width: 80, height: 50 } });
    // B2's top right corner is at (128px, 20px); the box starts 100px right of it and 40px below it.
    expect(notes(s)[0]).toMatchObject({ x: (128 + 100) * 0.75, y: (20 + 40) * 0.75, width: 60, height: 37.5 });
  });

  it("cuts a box off at the page's edge: a box wholly outside the print area is not printed, one partly inside is printed in part", () => {
    const s = grid();
    s.setNote("Sheet1", "C2", "inside", { box: { show: true, width: 300 } });
    s.setNote("Sheet1", "E5", "outside", { box: { show: true } });
    s.setPageSetup("Sheet1", { printArea: ["A1:D4"] });
    const page = s.printPage("Sheet1", s.printLayout("Sheet1").pages[0]!);
    expect(page.notes.map((n) => n.cell)).toEqual(["C2"]);
    // Its box is 300px wide from 15px right of C: much of it lies beyond D's edge (at 256px = 192pt of the page's 192pt width).
    const n = page.notes[0]!;
    expect(n.x + n.width).toBeGreaterThan(page.main.width);
    expect(n.x).toBeLessThan(page.main.width);
    // The page's own size is not changed by the notes: Excel cuts them at the print area.
    expect(page.main.width).toBe(192);
  });

  it("prints a box that crosses a page break on both pages, each with its own part", () => {
    const s = grid(4, 6);
    s.setNote("Sheet1", "B2", "wide", { box: { show: true, width: 160, height: 40, dx: -30 } });
    s.setPageSetup("Sheet1", { colBreaks: [2] });
    const layout = s.printLayout("Sheet1");
    expect(layout.pages.map((p) => [p.range.c1, p.range.c2])).toEqual([[1, 2], [3, 6]]);
    const first = notes(s, 0)[0]!;
    const second = notes(s, 1)[0]!;
    // The box starts 98px from the sheet's left edge (B ends at 128, less 30) and is 160px wide: it starts inside B on page 1 and runs past its edge;
    // page 2 starts at column C (128px), so the same box starts 30px before the page's first cell and ends 130px into it.
    expect(first.x).toBeCloseTo(98 * 0.75, 5);
    expect(first.x + first.width).toBeCloseTo(258 * 0.75, 5);
    expect(second.x).toBeCloseTo(-30 * 0.75, 5);
    expect(second.x + second.width).toBeCloseTo(130 * 0.75, 5);
  });

  it("follows hidden columns and rows, and prints no note whose cell is hidden", () => {
    const s = grid();
    s.setNote("Sheet1", "B2", "one", { box: { show: true } });
    s.setNote("Sheet1", "D2", "two", { box: { show: true } });
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "col", index: 3, hidden: true }]);
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "row", index: 2, hidden: true }]);
    expect(notes(s)).toEqual([]);
    s.setNote("Sheet1", "B3", "three", { box: { show: true } });
    // Column C is hidden, so D starts where B ends, and the box that starts 15px right of B's edge is 15px into D.
    expect(notes(s)[0]).toMatchObject({ cell: "B3", x: (128 + 15) * 0.75 });
  });

  it("is written and read as cellComments asDisplayed with the notes' own visible flags", () => {
    const s = grid();
    s.setNote("Sheet1", "B2", "one", { box: { show: true } });
    s.setNote("Sheet1", "C3", "two");
    const f = files(s);
    expect(text(f, "xl/worksheets/sheet1.xml")).toContain('cellComments="asDisplayed"');
    const vml = text(f, "xl/drawings/vmlDrawing1.vml");
    expect([...vml.matchAll(/<x:Visible\/>/g)]).toHaveLength(1);
    expect(vml).toMatch(/visibility:visible/);
    const back = fromXlsx(toXlsx(s.state));
    const session = new SheetSession(back.workbook, { now });
    expect(session.sheet("Sheet1").page?.comments).toBe("sheet");
    expect(session.printPage("Sheet1", session.printLayout("Sheet1").pages[0]!).notes.map((n) => n.cell)).toEqual(["B2"]);
  });
});

describe("header and footer pictures keep their &G code", () => {
  it("when the text of the header is set again, so the picture still shows in Excel", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a"]]);
    s.setHeaderFooterPicture("Sheet1", "header", "left", headerPictureFrom(pngUri(8, 4), { width: 60, height: 30 }));
    expect(s.pageSetup("Sheet1").header).toEqual({ left: "&G" });
    s.setPageSetup("Sheet1", { header: { center: "Title" } });
    expect(s.pageSetup("Sheet1").header).toEqual({ center: "Title", left: "&G" });
    s.setPageSetup("Sheet1", { header: { left: "Logo: " } });
    expect(s.pageSetup("Sheet1").header).toEqual({ left: "Logo: &G" });
    expect(lintPackage(toXlsx(s.state))).toEqual([]);
  });
});

describe("the printing sample of the Excel check kit (40)", () => {
  const sample = SAMPLES.find((x) => x.file === "40-printing-rest.xlsx")!;
  const s = sample.build();
  const pagesOf = (sheet: string) => s.printLayout(sheet).pages.map((p) => s.printPage(sheet, p));

  it("prints the three notes that are showing, and not the one that isn't, in the first sheet", () => {
    const [page] = pagesOf("Shown notes");
    expect(page!.notes.map((n) => n.cell)).toEqual(["A2", "F3", "C5"]);
    // F3's box starts 40px inside column F and runs past the print area's edge: its part over F is what prints.
    const f3 = page!.notes[1]!;
    expect(f3.x).toBeLessThan(page!.main.width);
    expect(f3.x + f3.width).toBeGreaterThan(page!.main.width);
    expect(page!.notes[2]).toMatchObject({ author: "Pat", width: 150, height: 45 });
  });

  it("lists all four notes on a page after the sheet in the second", () => {
    const layout = s.printLayout("NotesEnd");
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[1]!.notes!.map((n) => n.cell)).toEqual(["A2", "F3", "C5", "E9"].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it("has pictures in the headers and footers of a sheet that also has notes, with shape numbers that do not meet", () => {
    const f = files(s);
    const logos = Object.keys(f).filter((n) => /^xl\/drawings\/vmlDrawing(HF)?\d+\.vml$/.test(n));
    const ids = new Map<string, string[]>();
    for (const n of logos) for (const m of text(f, n).matchAll(/(?:o:spid|\bid)="(_x0000_s\d+)"/g)) ids.set(m[1]!, [...(ids.get(m[1]!) ?? []), n]);
    for (const [id, where] of ids) expect(where, id).toHaveLength(1);
    expect(lintPackage(toXlsx(s.state))).toEqual([]);
  });

  it("prints no gridlines, charts, pictures or sparklines on the draft sheet, and all of them on the other", async () => {
    const { printToPdf } = await import("../src");
    const pdf = async (sheet: string) => {
      const { bytes } = await printToPdf(s, sheet, { date: new Date(0) });
      return bytes;
    };
    expect((await pdf("Draft")).length).toBeLessThan((await pdf("NotDraft")).length);
    for (const name of ["Draft", "NotDraft"]) {
      const page = s.printPage(name, s.printLayout(name).pages[0]!);
      expect(page.graphics).toBe(name === "NotDraft");
      expect(page.html.includes("<img")).toBe(name === "NotDraft");
      expect(page.html.includes("border:0.5pt solid #bfbfbf")).toBe(name === "NotDraft");
    }
  });
});
