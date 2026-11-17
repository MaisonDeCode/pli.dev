import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, headerFooterRuns, headerPictureFrom, scaleHeaderPicture, textWidthPt, toXlsx, withPictureCode, type PageSetup } from "../src";
import { pngUri } from "./images-helpers";

const now = () => 45_000.5;
const make = () => new SheetSession(createWorkbook("More", ["Sheet1"]), { now });
const firstPage = (s: SheetSession) => s.printPage("Sheet1", s.printLayout("Sheet1").pages[0]!);
const files = (s: SheetSession) => Object.fromEntries(Object.entries(unzipSync(toXlsx(s.state))).map(([k, v]) => [k, v]));
const text = (f: Record<string, Uint8Array>, name: string) => strFromU8(f[name]!);

describe("text running on into empty cells", () => {
  it("measures text roughly the way Calibri sets it", () => {
    expect(textWidthPt("", 11)).toBe(0);
    expect(textWidthPt("iiii", 11)).toBeLessThan(textWidthPt("MMMM", 11));
    expect(textWidthPt("Hello world", 11)).toBeGreaterThan(40);
    expect(textWidthPt("Hello world", 11)).toBeLessThan(70);
    expect(textWidthPt("abc", 22)).toBeCloseTo(textWidthPt("abc", 11) * 2, 5);
  });

  it("lets a long text run over the empty cells to its right and stops at the next cell with something in it", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["A rather long piece of text that does not fit", null, null, "stop", null]]);
    const page = firstPage(s);
    expect(page.overflow).toHaveLength(1);
    expect(page.overflow[0]).toMatchObject({ row: 1, col: 1, side: "right", from: 1, to: 3 });
    expect(page.overflow[0]!.over).toBe(2);
    // The text is a box over the cells to its right: 3 cells of 48pt.
    expect(page.html).toContain("pli-print-run");
    expect(page.html).toMatch(/left:0;width:144pt;justify-content:flex-start/);
    expect(page.html).toContain("overflow:visible");
  });

  it("does not run on into a cell that has something in it, nor when the text fits", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["A rather long piece of text", "x", null], ["short", null, null]]);
    const page = firstPage(s);
    expect(page.overflow).toHaveLength(0);
    expect(page.html).not.toContain("pli-print-run");
  });

  it("runs right-aligned text to the left and centred text both ways", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", null, "A rather long piece of text for here", null, null]]);
    s.setStyle("Sheet1", "C1", { align: "right" });
    let page = firstPage(s);
    expect(page.overflow[0]).toMatchObject({ side: "left", col: 3 });
    expect(page.overflow[0]!.from).toBeLessThan(3);
    expect(page.html).toMatch(/right:0;width:\d+pt;justify-content:flex-end/);
    s.setStyle("Sheet1", "C1", { align: "center" });
    page = firstPage(s);
    expect(page.overflow[0]).toMatchObject({ side: "both" });
    expect(page.html).toMatch(/left:-48pt;width:192pt;justify-content:center;padding-left:2pt;padding-right:50pt/);
  });

  it("prints text that runs past the last cell in full when there is no print area, and cuts it at the print area when there is one", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["x", "A rather long piece of text that runs well past the last cell"]]);
    expect(s.printLayout("Sheet1").areas[0]!.c2).toBeGreaterThan(2);
    expect(firstPage(s).overflow[0]).toMatchObject({ row: 1, col: 2 });
    s.setPrintArea("Sheet1", ["A1:B1"]);
    expect(s.printLayout("Sheet1").areas[0]).toEqual({ r1: 1, c1: 1, r2: 1, c2: 2 });
    expect(firstPage(s).overflow).toHaveLength(0);
  });

  it("is cut at the page's edge: only the columns on the page are room", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["A very very long piece of text that goes on and on and on and on and on", null, null, null, null, null]]);
    s.setPrintArea("Sheet1", ["A1:C1"]);
    const page = firstPage(s);
    expect(page.overflow[0]).toMatchObject({ from: 1, to: 3 });
    expect(page.html).toMatch(/width:144pt/);
  });

  it("does not move text that wraps, numbers, merged cells or a cell with a picture", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["A rather long piece of text that does not fit", null, null], [123456789012345, null, null], ["Merged text that is also rather long indeed", null, null]]);
    s.setStyle("Sheet1", "A1", { wrap: true });
    s.mergeCells("Sheet1", "A3:B3");
    const page = firstPage(s);
    expect(page.overflow).toHaveLength(0);
  });

  it("keeps the underline on the box and the text only in the box", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["A rather long piece of text that does not fit", null, "z"]]);
    s.setStyle("Sheet1", "A1", { underline: true, bold: true });
    const html = firstPage(s).html;
    expect(html).toMatch(/pli-print-run[^>]*text-decoration:underline">A rather long/);
    expect(html.match(/A rather long/g)).toHaveLength(1);
  });
});

describe("how errors print", () => {
  const withErrors = (errors?: PageSetup["errors"]) => {
    const s = make();
    s.setValues("Sheet1", "A1", [["x", "=1/0", "=NA()"]]);
    if (errors) s.setPageSetup("Sheet1", { errors });
    return firstPage(s).html;
  };
  it("prints them as they show, empty, as dashes or as #N/A", () => {
    const shown = withErrors();
    expect(shown).toContain("#DIV/0!");
    expect(shown).toContain("#N/A");
    const blank = withErrors("blank");
    expect(blank).not.toContain("#DIV/0!");
    expect(blank).not.toContain("#N/A");
    const dash = withErrors("dash");
    expect(dash.match(/--/g)).toHaveLength(2);
    const na = withErrors("na");
    expect(na).not.toContain("#DIV/0!");
    expect(na.match(/#N\/A/g)).toHaveLength(2);
  });
  it("is refused when it is not one of the choices, and reads and writes the XLSX attribute", () => {
    const s = make();
    expect(() => s.setPageSetup("Sheet1", { errors: "nonsense" as never })).toThrow(/Errors print/);
    for (const [mode, attr] of [["blank", "blank"], ["dash", "dash"], ["na", "NA"]] as const) {
      s.setPageSetup("Sheet1", { errors: mode });
      const f = files(s);
      expect(text(f, "xl/worksheets/sheet1.xml")).toContain(`errors="${attr}"`);
      expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.page?.errors).toBe(mode);
    }
    s.setPageSetup("Sheet1", { errors: null });
    expect(text(files(s), "xl/worksheets/sheet1.xml")).not.toContain("errors=");
  });
});

describe("black and white and draft quality", () => {
  const colourful = () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["Title", 5]]);
    s.setStyle("Sheet1", "A1", { fill: "#ffcc00", color: "#ff0000", bold: true, border: { bottom: { style: "thin", color: "#0000ff" } } });
    s.setStyle("Sheet1", "B1", { fill: "#00ff00" });
    return s;
  };
  it("prints in colour by default and in black on white with black and white", () => {
    const s = colourful();
    const colour = firstPage(s).html;
    expect(colour).toContain("#ffcc00");
    expect(colour).toContain("#ff0000");
    s.setPageSetup("Sheet1", { blackAndWhite: true });
    const page = firstPage(s);
    expect(page.mono).toBe(true);
    expect(page.html).not.toContain("#ffcc00");
    expect(page.html).not.toContain("#00ff00");
    expect(page.html).not.toContain("#ff0000");
    expect(page.html).not.toContain("#0000ff");
    expect(page.html).toContain("color:#000");
    expect(page.html).toContain("font-weight:bold");
    expect(page.html).toMatch(/border-bottom:[^;]*#000/);
  });
  it("leaves the colours out of the header and footer, and the gridlines per the setting", () => {
    const s = colourful();
    s.setPageSetup("Sheet1", { blackAndWhite: true, gridlines: true, header: { center: "&KFF0000Red" } });
    const page = firstPage(s);
    expect(page.header.center[0]).toEqual({ text: "Red" });
    expect(page.html).toContain("border:0.5pt solid #bfbfbf");
  });
  it("draft quality prints no gridlines, charts, pictures or sparklines, and they do not make the sheet any bigger", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1, 2]]);
    s.setPageSetup("Sheet1", { gridlines: true });
    expect(firstPage(s).html).toContain("border:0.5pt solid #bfbfbf");
    s.addImage("Sheet1", { src: pngUri(8, 8), from: { row: 40, col: 8 }, width: 100, height: 100 });
    expect(s.printLayout("Sheet1").pages.length).toBeGreaterThan(0);
    const wide = s.printLayout("Sheet1").areas[0]!;
    expect(wide.r2).toBeGreaterThan(30);
    s.setPageSetup("Sheet1", { draft: true });
    const page = firstPage(s);
    expect(page.graphics).toBe(false);
    expect(page.html).not.toContain("border:0.5pt solid #bfbfbf");
    expect(s.printLayout("Sheet1").areas[0]).toEqual({ r1: 1, c1: 1, r2: 1, c2: 2 });
  });
  it("draft quality leaves a picture in a cell out", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["x"]]);
    s.setCellPicture("Sheet1", "B1", { src: pngUri(4, 4) });
    s.setPageSetup("Sheet1", { gridlines: true });
    expect(firstPage(s).html).toContain("<img");
    s.setPageSetup("Sheet1", { draft: true });
    expect(firstPage(s).html).not.toContain("<img");
  });
  it("writes and reads blackAndWhite and draft", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1]]);
    s.setPageSetup("Sheet1", { blackAndWhite: true, draft: true });
    expect(text(files(s), "xl/worksheets/sheet1.xml")).toMatch(/<pageSetup[^>]*blackAndWhite="1"[^>]*draft="1"/);
    expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.page).toMatchObject({ blackAndWhite: true, draft: true });
    expect(() => s.setPageSetup("Sheet1", { draft: "yes" as never })).toThrow(/true or false/);
  });
});

describe("printing notes", () => {
  const noted = () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 3 }, (_, r) => [`r${r}`, r]));
    s.setNote("Sheet1", "A1", "First note");
    s.setNote("Sheet1", "B3", "Second note\nwith two lines");
    return s;
  };
  it("prints no notes unless asked", () => {
    const s = noted();
    expect(s.printLayout("Sheet1").pages).toHaveLength(1);
    expect(firstPage(s).notes).toEqual([]);
  });
  it("prints them on pages after the sheet, numbered on", () => {
    const s = noted();
    s.setPageSetup("Sheet1", { comments: "end", footer: { center: "Page &P of &N" } });
    const layout = s.printLayout("Sheet1");
    expect(layout.pages).toHaveLength(2);
    const last = layout.pages[1]!;
    expect(last.notes).toEqual([{ cell: "A1", text: "First note" }, { cell: "B3", text: "Second note\nwith two lines" }]);
    expect(last.number).toBe(2);
    const page = s.printPage("Sheet1", last);
    expect(page.html).toContain("Cell A1:");
    expect(page.html).toContain("First note");
    expect(page.html).toContain("Cell B3:");
    expect(page.footer.center.map((r) => r.text).join("")).toBe("Page 2 of 2");
  });
  it("starts another page when the list is longer than one", () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 80 }, (_, r) => [r]));
    for (let r = 1; r <= 80; r++) s.setNote("Sheet1", `A${r}`, `Note number ${r}`);
    s.setPageSetup("Sheet1", { comments: "end" });
    const pages = s.printLayout("Sheet1").pages;
    const notePages = pages.filter((p) => p.notes);
    expect(notePages.length).toBeGreaterThan(1);
    expect(notePages.flatMap((p) => p.notes!)).toHaveLength(80);
    expect(pages.map((p) => p.number)).toEqual(pages.map((_, i) => i + 1));
  });
  it("prints only the notes that are showing, as their boxes, when asked to print them as displayed", () => {
    const s = noted();
    s.setPageSetup("Sheet1", { comments: "sheet" });
    expect(s.printLayout("Sheet1").pages).toHaveLength(1);
    // None is showing, so none prints.
    expect(firstPage(s).notes).toEqual([]);
    s.showNote("Sheet1", "A1");
    const page = firstPage(s);
    expect(page.notes.map((n) => n.cell)).toEqual(["A1"]);
    const a1 = page.notes[0]!;
    // The usual box: 15px right of the cell's top right corner (A is 64px wide), 10px above its top (but a box starts no higher than the sheet), 144 by 80 pixels.
    expect(a1.x).toBeCloseTo((64 + 15) * 0.75, 5);
    expect(a1.y).toBe(0);
    expect(a1.width).toBe(108);
    expect(a1.height).toBe(60);
    expect(a1.text).toBe("First note");
  });
  it("only prints the part of a note's box that is over the page's cells, and the notes whose boxes reach the page", () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 100 }, (_, r) => [r, r, r, r]));
    s.setNote("Sheet1", "A1", "top");
    s.setNote("Sheet1", "A90", "bottom");
    s.showNote("Sheet1", "A1");
    s.showNote("Sheet1", "A90");
    s.setPageSetup("Sheet1", { comments: "sheet" });
    const pages = s.printLayout("Sheet1").pages;
    expect(pages.length).toBeGreaterThan(1);
    expect(s.printPage("Sheet1", pages[0]!).notes.map((n) => n.cell)).toEqual(["A1"]);
    expect(s.printPage("Sheet1", pages[1]!).notes.map((n) => n.cell)).toEqual(["A90"]);
  });
  it("prints the size and place the box has been given, with its look and author", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [["a", "b", "c", "d", "e"], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]]);
    s.setNote("Sheet1", "B2", "Hello world", { runs: [{ text: "Hello ", bold: true }, { text: "world" }], author: "Pat", box: { width: 200, height: 40, dx: 20, dy: 30, show: true } });
    s.setPageSetup("Sheet1", { comments: "sheet" });
    const n = firstPage(s).notes[0]!;
    // B is the second column (64px), row 2 starts at 20px: the cell's top right is (128, 20).
    expect(n).toMatchObject({ cell: "B2", x: (128 + 20) * 0.75, y: (20 + 30) * 0.75, width: 150, height: 30, author: "Pat" });
    expect(n.runs).toEqual([{ text: "Hello ", bold: true }, { text: "world" }]);
  });
  it("writes and reads cellComments", () => {
    const s = noted();
    for (const [mode, attr] of [["end", "atEnd"], ["sheet", "asDisplayed"]] as const) {
      s.setPageSetup("Sheet1", { comments: mode });
      expect(text(files(s), "xl/worksheets/sheet1.xml")).toContain(`cellComments="${attr}"`);
      expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.page?.comments).toBe(mode);
    }
    expect(() => s.setPageSetup("Sheet1", { comments: "all" as never })).toThrow(/Comments print/);
  });
});

describe("pictures in headers and footers", () => {
  const logo = pngUri(40, 20);
  it("works out a picture's size on paper from its pixels, a percent or one side", () => {
    expect(headerPictureFrom(logo)).toMatchObject({ width: 30, height: 15 });
    expect(headerPictureFrom(logo, { scale: 200 })).toMatchObject({ width: 60, height: 30 });
    expect(headerPictureFrom(logo, { height: 30 })).toMatchObject({ width: 60, height: 30 });
    expect(headerPictureFrom(logo, { width: 90, height: 10 })).toMatchObject({ width: 90, height: 10 });
    const p = headerPictureFrom(logo, { width: 60 });
    expect(scaleHeaderPicture(p, { percent: 50 })).toMatchObject({ width: 30, height: 15 });
    expect(scaleHeaderPicture(p, { width: 120 })).toMatchObject({ width: 120, height: 60 });
    expect(scaleHeaderPicture(p, { width: 120, lockAspect: false })).toMatchObject({ width: 120, height: 30 });
    expect(() => scaleHeaderPicture(p, { percent: 0 })).toThrow(/percent/);
  });
  it("keeps the &G code in step with the picture", () => {
    expect(withPictureCode("Report", true)).toBe("Report&G");
    expect(withPictureCode("A&GB", true)).toBe("A&GB");
    expect(withPictureCode("A&&GB", true)).toBe("A&&GB&G");
    expect(withPictureCode("A&GB&G", false)).toBe("AB");
    expect(withPictureCode("&G", false)).toBe("");
  });
  it("puts the picture in a run where the code is", () => {
    const pic = headerPictureFrom(logo);
    const ctx = { page: 1, pages: 1, file: "f", sheet: "s", now: new Date(0), picture: pic };
    expect(headerFooterRuns("Logo: &G !", ctx)).toEqual([{ text: "Logo: " }, { text: "", picture: pic }, { text: " !" }]);
  });
  it("sets and takes away a picture as one undo step, with the code in the text", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1]]);
    s.setHeaderFooterPicture("Sheet1", "header", "left", headerPictureFrom(logo));
    expect(s.pageSetup("Sheet1").header).toEqual({ left: "&G" });
    expect(s.pageSetup("Sheet1").pictures!.header!.left).toMatchObject({ width: 30, height: 15 });
    const page = firstPage(s);
    expect(page.header.left).toHaveLength(1);
    expect(page.header.left[0]!.picture).toMatchObject({ width: 30 });
    s.undo();
    expect(s.pageSetup("Sheet1")).toEqual({});
    s.redo();
    s.setHeaderFooterPicture("Sheet1", "header", "left", null);
    expect(s.pageSetup("Sheet1")).toEqual({});
  });
  it("uses the first page's and even pages' own pictures, and turns those pages on", () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 100 }, (_, r) => [r]));
    s.setHeaderFooterPicture("Sheet1", "header", "center", headerPictureFrom(pngUri(10, 10)));
    s.setHeaderFooterPicture("Sheet1", "firstHeader", "right", headerPictureFrom(pngUri(20, 20)));
    s.setHeaderFooterPicture("Sheet1", "evenFooter", "left", headerPictureFrom(pngUri(30, 30)));
    expect(s.pageSetup("Sheet1")).toMatchObject({ differentFirstPage: true, differentOddEven: true });
    const pages = s.printLayout("Sheet1").pages;
    const at = (n: number) => s.printPage("Sheet1", pages[n]!);
    expect(at(0).header.right[0]!.picture!.width).toBeCloseTo(15, 5);
    expect(at(0).header.center).toEqual([]);
    expect(at(2).header.center[0]!.picture!.width).toBeCloseTo(7.5, 5);
    expect(at(1).footer.left[0]!.picture!.width).toBeCloseTo(22.5, 5);
  });
  it("prints no header and footer pictures in draft quality", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1]]);
    s.setHeaderFooterPicture("Sheet1", "header", "left", headerPictureFrom(logo));
    s.setPageSetup("Sheet1", { draft: true });
    expect(firstPage(s).header.left).toEqual([]);
  });
  it("refuses what is not a picture or a place", () => {
    const s = make();
    expect(() => s.setHeaderFooterPicture("Sheet1", "header", "left", { src: "data:image/png;base64,AAAA", width: 10, height: 10 })).toThrow();
    expect(() => s.setHeaderFooterPicture("Sheet1", "header", "left", { src: logo, width: 0, height: 10 })).toThrow(/points/);
    expect(() => s.setHeaderFooterPicture("Sheet1", "side" as never, "left", headerPictureFrom(logo))).toThrow(/header or footer/);
    expect(() => s.setHeaderFooterPicture("Sheet1", "header", "middle" as never, headerPictureFrom(logo))).toThrow(/left, center or right/);
    expect(() => s.setPageSetup("Sheet1", { pictures: { header: { left: { src: logo, width: 5, height: 5, crop: { left: 0.6, right: 0.6 } } } } })).toThrow(/nothing/);
  });
  it("writes a header-and-footer drawing and reads it back", () => {
    const s = make();
    s.setValues("Sheet1", "A1", [[1]]);
    s.setNote("Sheet1", "A1", "a note too");
    s.setHeaderFooterPicture("Sheet1", "header", "left", { ...headerPictureFrom(logo, { width: 80 }), crop: { left: 0.1 }, alt: "Logo" });
    s.setHeaderFooterPicture("Sheet1", "footer", "right", headerPictureFrom(pngUri(8, 8)));
    s.setHeaderFooterPicture("Sheet1", "firstHeader", "center", headerPictureFrom(pngUri(6, 6)));
    s.setHeaderFooterPicture("Sheet1", "evenFooter", "left", headerPictureFrom(pngUri(4, 4)));
    const f = files(s);
    const sheetXml = text(f, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toMatch(/<legacyDrawing r:id="[^"]+"\/><legacyDrawingHF r:id="[^"]+"\/>/);
    expect(sheetXml).toMatch(/<oddHeader>&amp;L&amp;G<\/oddHeader>/);
    const vmlName = Object.keys(f).find((k) => /vmlDrawingHF1\.vml$/.test(k))!;
    const vml = text(f, vmlName);
    for (const id of ["LH", "RF", "CHFIRST", "LFEVEN"]) expect(vml).toContain(`id="${id}"`);
    expect(vml).toContain("width:80pt;height:40pt");
    expect(vml).toContain('cropleft="6554f"');
    expect(Object.keys(f).filter((k) => /^xl\/media\//.test(k))).toHaveLength(4);
    expect(text(f, "xl/worksheets/_rels/sheet1.xml.rels")).toContain("vmlDrawingHF1.vml");
    expect(text(f, "[Content_Types].xml")).toContain('Extension="png"');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    const page = back.workbook.sheets[0]!.page!;
    expect(page.pictures!.header!.left).toMatchObject({ width: 80, height: 40, alt: "Logo" });
    expect(page.pictures!.header!.left!.crop!.left).toBeCloseTo(0.1, 3);
    expect(page.pictures!.footer!.right).toMatchObject({ width: 6, height: 6 });
    expect(page.pictures!.firstHeader!.center).toBeDefined();
    expect(page.pictures!.evenFooter!.left).toBeDefined();
    expect(page.header).toEqual({ left: "&G" });
    expect(back.workbook.sheets[0]!.cells["A1"]!.note).toBe("a note too");
    expect(page.pictures!.header!.left!.src).toBe(s.pageSetup("Sheet1").pictures!.header!.left!.src);
  });
});

describe("moving page breaks and print areas", () => {
  const long = () => {
    const s = make();
    s.setValues("Sheet1", "A1", Array.from({ length: 150 }, (_, r) => [r, r]));
    return s;
  };
  it("moves a manual break, and turns an automatic one into a manual one where it is dropped", () => {
    const s = long();
    s.setPageBreak("Sheet1", "row", 10);
    s.movePageBreak("Sheet1", "row", 10, 20);
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([20]);
    const auto = s.printLayout("Sheet1").pages.find((p) => p.range.r1 === 21)!.range.r2;
    s.movePageBreak("Sheet1", "row", auto, auto - 5);
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([20, auto - 5]);
    expect(s.printLayout("Sheet1").pages.some((p) => p.range.r2 === auto - 5)).toBe(true);
    s.undo();
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([20]);
  });
  it("refuses a break outside the sheet and does nothing when it stays where it is", () => {
    const s = long();
    expect(() => s.movePageBreak("Sheet1", "row", 5, 0)).toThrow(/page break goes after/);
    s.movePageBreak("Sheet1", "row", 5, 5);
    expect(s.pageSetup("Sheet1").rowBreaks).toBeUndefined();
    expect(s.canUndo).toBe(true); // the values
  });
  it("scales at the size it fits at when a break is made on a sheet set to fit pages", () => {
    const s = long();
    s.setPageSetup("Sheet1", { fit: { wide: 1, tall: 1 } });
    const scale = s.printLayout("Sheet1").scale;
    s.insertPageBreak("Sheet1", "row", 50);
    expect(s.pageSetup("Sheet1")).toMatchObject({ rowBreaks: [50], scale });
    expect(s.pageSetup("Sheet1").fit).toBeUndefined();
  });
  it("moves one edge of the print area, also when there isn't one yet", () => {
    const s = long();
    s.movePrintAreaEdge("Sheet1", 0, "bottom", 40);
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A1:B40"]);
    s.movePrintAreaEdge("Sheet1", 0, "top", 5);
    s.movePrintAreaEdge("Sheet1", 0, "right", 4);
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A5:D40"]);
    expect(() => s.movePrintAreaEdge("Sheet1", 0, "top", 41)).toThrow(/at least one cell/);
    expect(() => s.movePrintAreaEdge("Sheet1", 3, "top", 1)).toThrow(/no such print range/);
    s.undo();
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A5:B40"]);
  });
});
