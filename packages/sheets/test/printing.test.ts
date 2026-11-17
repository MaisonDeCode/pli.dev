import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, headerFooterFor, headerFooterRuns, parseWorkbook, serializeWorkbook, toXlsx, type PageSetup } from "../src";
import { pngUri } from "./images-helpers";

/** A sheet with `rows` rows and `cols` columns of numbers. */
const make = (rows: number, cols: number) => {
  const s = new SheetSession(createWorkbook("Print", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r * 100 + c)));
  return s;
};
const ranges = (s: SheetSession) => s.printLayout("Sheet1").pages.map((p) => `${p.range.c1}-${p.range.c2}/${p.range.r1}-${p.range.r2}`);

describe("page setup", () => {
  it("keeps only what isn't the default, and puts it all back with null", () => {
    const s = make(3, 3);
    s.setPageSetup("Sheet1", { orientation: "landscape", paper: "letter", scale: 100, margins: { top: 0.75, left: 1 }, order: "over" });
    expect(s.pageSetup("Sheet1")).toEqual({ orientation: "landscape", margins: { left: 1 }, order: "over" });
    s.setPageSetup("Sheet1", { orientation: null, margins: null, order: null });
    expect(s.pageSetup("Sheet1")).toEqual({});
    expect(s.sheet("Sheet1").page).toBeUndefined();
    s.undo();
    expect(s.pageSetup("Sheet1").order).toBe("over");
  });

  it("scaling and fitting to pages are one choice: the last one said wins", () => {
    const s = make(3, 3);
    s.setPageSetup("Sheet1", { scale: 50 });
    s.setPageSetup("Sheet1", { fit: { wide: 1, tall: 2 } });
    expect(s.pageSetup("Sheet1")).toEqual({ fit: { wide: 1, tall: 2 } });
    s.setPageSetup("Sheet1", { scale: 75 });
    expect(s.pageSetup("Sheet1")).toEqual({ scale: 75 });
  });

  it("refuses what isn't a page setup", () => {
    const s = make(3, 3);
    const bad = (patch: Record<string, unknown>, re: RegExp) => expect(() => s.setPageSetup("Sheet1", patch as never)).toThrow(re);
    bad({ orientation: "sideways" }, /landscape/);
    bad({ paper: "foolscap" }, /paper/);
    bad({ scale: 5 }, /10 to 400/);
    bad({ scale: 500 }, /10 to 400/);
    bad({ fit: { wide: -1, tall: 1 } }, /Fit to/);
    bad({ margins: { top: -1 } }, /margin/);
    bad({ margins: { sideways: 1 } }, /isn't a margin/);
    bad({ printArea: ["nonsense"] }, /isn't a range/);
    bad({ rowBreaks: [0] }, /Row page breaks/);
    bad({ header: { left: "x".repeat(256) } }, /255/);
    bad({ titleRows: [3, 2] }, /rows to repeat/);
    bad({ colour: "red" }, /isn't part of a page setup/);
  });

  it("sets the print area, the rows and columns repeated and the page breaks", () => {
    const s = make(100, 12);
    s.setPrintArea("Sheet1", ["$A$1:$C$5", "e10:f12"]);
    expect(s.pageSetup("Sheet1").printArea).toEqual(["A1:C5", "E10:F12"]);
    s.setPrintTitles("Sheet1", { rows: "$1:$2", cols: "A:B" });
    expect(s.printTitles("Sheet1")).toEqual({ rows: "1:2", cols: "A:B" });
    s.setPrintTitles("Sheet1", { rows: null });
    expect(s.printTitles("Sheet1")).toEqual({ cols: "A:B" });
    expect(() => s.setPrintTitles("Sheet1", { rows: "A:B" })).toThrow(/isn't rows/);
    s.setPageBreak("Sheet1", "row", 20);
    s.setPageBreak("Sheet1", "row", 10);
    s.setPageBreak("Sheet1", "col", 3);
    expect(s.pageSetup("Sheet1")).toMatchObject({ rowBreaks: [10, 20], colBreaks: [3] });
    s.setPageBreak("Sheet1", "row", 10, false);
    expect(s.pageSetup("Sheet1").rowBreaks).toEqual([20]);
    s.clearPageBreaks("Sheet1");
    expect(s.pageSetup("Sheet1").rowBreaks).toBeUndefined();
    s.setPrintArea("Sheet1", null);
    expect(s.pageSetup("Sheet1").printArea).toBeUndefined();
  });

  it("follows inserted and deleted rows and columns", () => {
    const s = make(100, 12);
    s.setPageSetup("Sheet1", { printArea: ["B2:D10"], titleRows: [1, 2], titleCols: [1, 1], rowBreaks: [20, 40], colBreaks: [5] });
    s.insertRows("Sheet1", 30, 5);
    expect(s.pageSetup("Sheet1")).toMatchObject({ rowBreaks: [20, 45], printArea: ["B2:D10"], titleRows: [1, 2] });
    s.insertRows("Sheet1", 1, 1);
    expect(s.pageSetup("Sheet1")).toMatchObject({ printArea: ["B3:D11"], titleRows: [2, 3], rowBreaks: [21, 46] });
    s.deleteRows("Sheet1", 4, 3); // a break and part of the area go with the rows
    expect(s.pageSetup("Sheet1")).toMatchObject({ printArea: ["B3:D8"], titleRows: [2, 3] });
    s.deleteRows("Sheet1", 2, 2); // the title rows
    expect(s.pageSetup("Sheet1").titleRows).toBeUndefined();
    s.insertColumns("Sheet1", 1, 2);
    expect(s.pageSetup("Sheet1")).toMatchObject({ titleCols: [3, 3], colBreaks: [7] });
    s.deleteColumns("Sheet1", 7, 1);
    expect(s.pageSetup("Sheet1").colBreaks).toBeUndefined();
    s.undo(); // the deleted column's break comes back
    expect(s.pageSetup("Sheet1")).toMatchObject({ titleCols: [3, 3], colBreaks: [7] });
    s.undo();
    expect(s.pageSetup("Sheet1")).toMatchObject({ titleCols: [1, 1], colBreaks: [5] });
  });

  it("is saved with the workbook and checked when it is read", () => {
    const s = make(5, 5);
    s.setPageSetup("Sheet1", { orientation: "landscape", paper: "a4", fit: { wide: 1, tall: 0 }, header: { center: "&A" }, footer: { right: "Page &P of &N" }, printArea: ["A1:B2"], titleRows: [1, 1], rowBreaks: [3], differentFirstPage: true, firstHeader: { left: "First" } });
    const back = parseWorkbook(serializeWorkbook(s.state));
    expect(back.sheets[0]!.page).toEqual(s.sheet("Sheet1").page);
    const bad = JSON.parse(serializeWorkbook(s.state));
    bad.workbook.sheets[0].page.paper = "foolscap";
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/paper/);
    bad.workbook.sheets[0].page = {};
    expect(() => parseWorkbook(JSON.stringify(bad))).toThrow(/defaults/);
  });

  it("can be changed on a protected sheet", () => {
    const s = make(5, 5);
    s.protectSheet("Sheet1");
    s.setPageSetup("Sheet1", { orientation: "landscape" });
    expect(s.pageSetup("Sheet1").orientation).toBe("landscape");
  });
});

describe("pagination", () => {
  it("fills a letter page with 10 columns and 45 rows of the default size, down and then over", () => {
    const s = make(100, 12);
    const layout = s.printLayout("Sheet1");
    expect(layout.paper).toEqual({ width: 612, height: 792 });
    expect(layout.scale).toBe(100);
    expect(ranges(s)).toEqual(["1-10/1-45", "1-10/46-90", "1-10/91-100", "11-12/1-45", "11-12/46-90", "11-12/91-100"]);
    expect(layout.pages.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("goes over and then down when asked, and numbers pages from the number given", () => {
    const s = make(100, 12);
    s.setPageSetup("Sheet1", { order: "over", firstPageNumber: 7 });
    const layout = s.printLayout("Sheet1");
    expect(ranges(s)).toEqual(["1-10/1-45", "11-12/1-45", "1-10/46-90", "11-12/46-90", "1-10/91-100", "11-12/91-100"]);
    expect(layout.pages.map((p) => p.number)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it("uses landscape, other paper and a scale", () => {
    const s = make(100, 30);
    s.setPageSetup("Sheet1", { orientation: "landscape" });
    expect(s.printLayout("Sheet1").paper).toEqual({ width: 792, height: 612 });
    expect(ranges(s).slice(0, 2)).toEqual(["1-14/1-33", "1-14/34-66"]);
    s.setPageSetup("Sheet1", { orientation: null, paper: "a4" });
    expect(s.printLayout("Sheet1").paper.width).toBeCloseTo(595.28, 1);
    s.setPageSetup("Sheet1", { paper: null, scale: 50 });
    expect(ranges(s).slice(0, 2)).toEqual(["1-21/1-91", "1-21/92-100"]);
    s.setPageSetup("Sheet1", { scale: 200 });
    expect(s.printLayout("Sheet1").pages[0]!.range).toMatchObject({ c2: 5, r2: 22 });
  });

  it("shrinks to fit a number of pages, up to 100%, ignoring the breaks made", () => {
    const s = make(100, 12);
    s.setPageSetup("Sheet1", { fit: { wide: 1, tall: 0 }, rowBreaks: [10] });
    const layout = s.printLayout("Sheet1");
    expect(layout.scale).toBe(88); // 12 columns are 576 pt; 511.2 pt is a page
    expect(new Set(layout.pages.map((p) => p.range.c1)).size).toBe(1);
    expect(layout.pages[0]!.range.r2).toBeGreaterThan(45);
    s.setPageSetup("Sheet1", { fit: { wide: 1, tall: 1 } });
    expect(s.printLayout("Sheet1").pages).toHaveLength(1);
    expect(s.printLayout("Sheet1").scale).toBeLessThan(60);
    const small = make(5, 3);
    small.setPageSetup("Sheet1", { fit: { wide: 1, tall: 1 } });
    expect(small.printLayout("Sheet1").scale).toBe(100); // it never enlarges
  });

  it("breaks where a break was made, and where the page is full after it", () => {
    const s = make(100, 4);
    s.setPageBreak("Sheet1", "row", 10);
    s.setPageBreak("Sheet1", "row", 60);
    s.setPageBreak("Sheet1", "col", 2);
    expect(ranges(s)).toEqual(["1-2/1-10", "1-2/11-55", "1-2/56-60", "1-2/61-100", "3-4/1-10", "3-4/11-55", "3-4/56-60", "3-4/61-100"]);
  });

  it("repeats title rows and columns, on the first page too when they are above or left of the print area", () => {
    const s = make(100, 12);
    s.setPrintTitles("Sheet1", { rows: "1:2", cols: "A:A" });
    const pages = s.printLayout("Sheet1").pages;
    expect(pages[0]).toMatchObject({ range: { r1: 1, r2: 45, c1: 1, c2: 10 } });
    expect(pages[0]!.titleRows).toBeUndefined(); // they are part of the first page already
    expect(pages[1]).toMatchObject({ range: { r1: 46, r2: 88 }, titleRows: [1, 2] }); // two rows of room are given up
    expect(pages[0]!.titleCols).toBeUndefined();
    const second = pages.find((p) => p.range.c1 > 1)!;
    expect(second.titleCols).toEqual([1, 1]);
    expect(second.range.c2 - second.range.c1).toBeLessThanOrEqual(1);
    s.setPageSetup("Sheet1", { printArea: ["A5:B60"] });
    const area = s.printLayout("Sheet1").pages;
    expect(area[0]).toMatchObject({ titleRows: [1, 2], range: { r1: 5, r2: 47 } }); // above the area: on every page
  });

  it("prints each print range from a new page, and leaves hidden rows and columns out", () => {
    const s = make(100, 12);
    s.setPrintArea("Sheet1", ["A1:B3", "D50:D52"]);
    expect(ranges(s)).toEqual(["1-2/1-3", "4-4/50-52"]);
    expect(s.printLayout("Sheet1").pages.map((p) => p.area)).toEqual([0, 1]);
    const t = make(100, 3);
    for (let r = 1; r <= 50; r++) t.transact([{ type: "set_size", sheet: t.sheet("Sheet1").id, axis: "row", index: r, hidden: true }]);
    expect(ranges(t)).toEqual(["1-3/1-95", "1-3/96-100"]); // 50 hidden rows count for nothing: 45 more fit on the first page
  });

  it("counts charts and pictures in what is printed, and prints nothing for an empty sheet", () => {
    const s = new SheetSession(createWorkbook("Empty"));
    expect(s.printLayout("Sheet1").pages).toEqual([]);
    s.addImage("Sheet1", { src: pngUri(100, 50), from: { row: 60, col: 1 }, width: 100, height: 50 });
    expect(ranges(s).at(-1)).toBe("1-2/46-62"); // the picture starts in row 60, is 50 pixels high and ends in row 62
  });

  it("makes room for the headings that print", () => {
    const s = make(100, 12);
    s.setPageSetup("Sheet1", { headings: true });
    expect(ranges(s)[0]).toBe("1-10/1-44"); // 28 pt and 15 pt less: still 10 columns of 48 pt, but 44 rows
  });
});

describe("headers and footers", () => {
  const ctx = { page: 3, pages: 12, file: "Budget.xlsx", sheet: "Q1", now: new Date(2024, 1, 29, 14, 5) };

  it("works out the codes and keeps the styles that come with them", () => {
    expect(headerFooterRuns("Page &P of &N", ctx)).toEqual([{ text: "Page 3 of 12" }]);
    expect(headerFooterRuns("&F — &A &D &T", ctx)).toEqual([{ text: "Budget.xlsx — Q1 2/29/2024 2:05 PM" }]);
    expect(headerFooterRuns("&B&14Report&B plain &I&Uslanted&I&U", ctx)).toEqual([
      { text: "Report", bold: true, size: 14 },
      { text: " plain ", size: 14 },
      { text: "slanted", italic: true, underline: true, size: 14 },
    ]);
    expect(headerFooterRuns('&"Courier New,Bold"mono &Kff0000red &Sstruck', ctx)).toEqual([
      { text: "mono ", font: "Courier New" },
      { text: "red ", font: "Courier New", color: "#ff0000" },
      { text: "struck", font: "Courier New", color: "#ff0000", strike: true },
    ]);
    expect(headerFooterRuns("Tom && Jerry &G &Z", ctx)).toEqual([{ text: "Tom & Jerry  " }]);
    expect(headerFooterRuns("", ctx)).toEqual([]);
  });

  it("gives the first page and the even pages their own", () => {
    const page = { header: { center: "usual" }, firstHeader: { center: "first" }, evenHeader: { center: "even" }, footer: { left: "f" } };
    expect(headerFooterFor(page, "header", 1, 1)?.center).toBe("usual");
    expect(headerFooterFor({ ...page, differentFirstPage: true }, "header", 1, 1)?.center).toBe("first");
    expect(headerFooterFor({ ...page, differentFirstPage: true }, "header", 2, 1)?.center).toBe("usual");
    expect(headerFooterFor({ ...page, differentOddEven: true }, "header", 2, 1)?.center).toBe("even");
    expect(headerFooterFor({ ...page, differentOddEven: true }, "header", 3, 1)?.center).toBe("usual");
    expect(headerFooterFor({ ...page, differentFirstPage: true }, "footer", 1, 1)).toBeUndefined();
    expect(headerFooterFor(undefined, "header", 1, 1)).toBeUndefined();
  });
});

describe("a page as it prints", () => {
  it("has the cells with their sizes, the repeated titles, gridlines and headings, and a header and footer", () => {
    const s = make(100, 12);
    s.setColumnWidth("Sheet1", 1, 20);
    s.setStyle("Sheet1", "A1", { bold: true });
    s.setPageSetup("Sheet1", { gridlines: true, headings: true, titleRows: [1, 1], header: { center: "&A" }, footer: { right: "Page &P of &N" } });
    const layout = s.printLayout("Sheet1");
    const page = s.printPage("Sheet1", layout.pages[1]!);
    expect(page.html).toContain('<col style="width:28pt">');
    expect(page.html).toContain('<col style="width:' + (145 * 0.75) + 'pt">'); // 20 characters: 145 px
    expect(page.html).toContain("border:0.5pt solid #bfbfbf");
    expect(page.html).toMatch(/<th [^>]*>A<\/th>/);
    expect(page.html).toMatch(/<th [^>]*>45<\/th>/); // headings count the sheet's own rows (44 fit on the first page)
    expect(page.html).toMatch(/<th [^>]*>1<\/th>/); // and the repeated title row is the first
    expect(page.html.indexOf(">1</th>")).toBeLessThan(page.html.indexOf(">45</th>"));
    expect(page.header.center).toEqual([{ text: "Sheet1" }]);
    expect(page.footer.right).toEqual([{ text: "Page 2 of 6" }]);
    expect(page.main.y).toBeCloseTo(15 + 15, 5); // headings, then the title row
    expect(page.origin).toEqual({ x: 0, y: 44 * 20 });
    expect(page.width).toBeCloseTo(page.main.x + page.main.width, 5);
  });

  it("cuts a merged range where the page ends, and leaves hidden columns out", () => {
    const s = make(100, 12);
    s.mergeCells("Sheet1", "J44:L46");
    const first = s.printPage("Sheet1", s.printLayout("Sheet1").pages[0]!); // columns 1 to 10, rows 1 to 45
    expect(first.html).toMatch(/<td colspan="1" rowspan="2"|<td rowspan="2"/);
    expect(first.html).not.toContain('colspan="3"');
    s.transact([{ type: "set_size", sheet: s.sheet("Sheet1").id, axis: "col", index: 2, hidden: true }]);
    const page = s.printPage("Sheet1", s.printLayout("Sheet1").pages[0]!);
    expect((page.html.match(/<col /g) ?? []).length).toBe(10);
  });
});

describe("in XLSX files", () => {
  const sheetXml = (s: SheetSession, n = 1) => strFromU8(unzipSync(toXlsx(s.state))[`xl/worksheets/sheet${n}.xml`]!);
  const everything: PageSetup = {
    orientation: "landscape",
    paper: "a4",
    scale: 80,
    margins: { top: 1, left: 0.5, header: 0.4 },
    centerHorizontally: true,
    centerVertically: true,
    gridlines: true,
    headings: true,
    order: "over",
    blackAndWhite: true,
    firstPageNumber: 5,
    printArea: ["A1:C10", "E2:F4"],
    titleRows: [1, 2],
    titleCols: [1, 1],
    rowBreaks: [10, 20],
    colBreaks: [3],
    header: { left: "&D", center: '&"Arial,Bold"&14Report', right: "&P of &N" },
    footer: { center: "Tom && Jerry" },
    firstHeader: { center: "First page" },
    evenFooter: { right: "even" },
    differentFirstPage: true,
    differentOddEven: true,
  };

  it("writes a sheet's printing in the order the schema wants, and reads all of it back", () => {
    const s = make(30, 6);
    s.setPageSetup("Sheet1", everything);
    const xml = sheetXml(s);
    const order = ["<printOptions ", "<pageMargins ", "<pageSetup ", "<headerFooter ", "<rowBreaks ", "<colBreaks "].map((t) => xml.indexOf(t));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(xml.indexOf("</sheetData>")).toBeLessThan(order[0]!);
    expect(xml).toContain('<printOptions horizontalCentered="1" verticalCentered="1" headings="1" gridLines="1"/>');
    expect(xml).toContain('<pageMargins left="0.5" right="0.7" top="1" bottom="0.75" header="0.4" footer="0.3"/>');
    expect(xml).toContain('<pageSetup paperSize="9" scale="80" firstPageNumber="5" useFirstPageNumber="1" pageOrder="overThenDown" blackAndWhite="1" orientation="landscape"/>');
    expect(xml).toContain('<oddHeader>&amp;L&amp;D&amp;C&amp;"Arial,Bold"&amp;14Report&amp;R&amp;P of &amp;N</oddHeader>');
    expect(xml).toContain("<oddFooter>&amp;CTom &amp;&amp; Jerry</oddFooter>");
    expect(xml).toContain('<headerFooter differentOddEven="1" differentFirst="1">');
    expect(xml).toContain('<rowBreaks count="2" manualBreakCount="2"><brk id="10" max="16383" man="1"/><brk id="20" max="16383" man="1"/></rowBreaks>');
    expect(xml).toContain('<colBreaks count="1" manualBreakCount="1"><brk id="3" max="1048575" man="1"/></colBreaks>');
    const files = unzipSync(toXlsx(s.state));
    const book = strFromU8(files["xl/workbook.xml"]!);
    expect(book).toContain('<definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A$1:$C$10,Sheet1!$E$2:$F$4</definedName>');
    expect(book).toContain('<definedName name="_xlnm.Print_Titles" localSheetId="0">Sheet1!$A:$A,Sheet1!$1:$2</definedName>');
    const back = fromXlsx(toXlsx(s.state));
    expect(back.warnings).toEqual([]);
    expect(back.workbook.sheets[0]!.page).toEqual(s.sheet("Sheet1").page);
    expect(back.workbook.names).toBeUndefined(); // the print names are the sheet's, not names of the workbook's own
  });

  it("writes fit to pages with the flag Excel wants, and reads it back", () => {
    const s = make(30, 6);
    s.setPageSetup("Sheet1", { fit: { wide: 1, tall: 0 } });
    const xml = sheetXml(s);
    expect(xml).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(xml).toContain('fitToWidth="1" fitToHeight="0"');
    expect(xml).not.toContain(' scale="');
    expect(fromXlsx(toXlsx(s.state)).workbook.sheets[0]!.page).toEqual({ fit: { wide: 1, tall: 0 } });
    s.setTabColor("Sheet1", "#ff0000");
    expect(sheetXml(s)).toContain('<sheetPr><tabColor rgb="FFFF0000"/><pageSetUpPr fitToPage="1"/></sheetPr>');
  });

  it("writes nothing for a sheet that prints as the defaults, and names the print area of a sheet whose name needs quotes", () => {
    const s = new SheetSession(createWorkbook("Names", ["Plain", "Q1 sales", "O'Brien"]));
    s.setCell("Plain", "A1", 1);
    expect(sheetXml(s, 1)).not.toMatch(/pageMargins|pageSetup|printOptions/);
    s.setPrintArea("Q1 sales", ["B2:C3"]);
    s.setPrintArea("O'Brien", ["A1:A2"]);
    s.setPrintTitles("O'Brien", { rows: "1:1" });
    const book = strFromU8(unzipSync(toXlsx(s.state))["xl/workbook.xml"]!);
    expect(book).toContain('localSheetId="1">\'Q1 sales\'!$B$2:$C$3<');
    expect(book).toContain('localSheetId="2">\'O\'\'Brien\'!$A$1:$A$2<');
    expect(book).toContain("'O''Brien'!$1:$1");
    const back = fromXlsx(toXlsx(s.state)).workbook;
    expect(back.sheets[1]!.page).toEqual({ printArea: ["B2:C3"] });
    expect(back.sheets[2]!.page).toEqual({ printArea: ["A1:A2"], titleRows: [1, 1] });
    expect(back.sheets[0]!.page).toBeUndefined();
  });

  it("reads what Excel writes: sections of a header in any order, whole columns as a print area, paper it hasn't got", () => {
    const s = make(5, 5);
    s.setPageSetup("Sheet1", { orientation: "landscape" });
    const files = unzipSync(toXlsx(s.state));
    files["xl/worksheets/sheet1.xml"] = strToU8(
      strFromU8(files["xl/worksheets/sheet1.xml"]!).replace('paperSize="1"', 'paperSize="77"').replace("</worksheet>", '<headerFooter><oddHeader>&amp;R&amp;P&amp;L&amp;F&amp;CCentre &amp;&amp; more&amp;K0CCCCC</oddHeader></headerFooter></worksheet>'),
    );
    files["xl/workbook.xml"] = strToU8(strFromU8(files["xl/workbook.xml"]!).replace("</sheets>", '</sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Sheet1!$A:$B</definedName></definedNames>'));
    const read = fromXlsx(zipSync(files));
    expect(read.warnings.some((w) => /code 77/.test(w))).toBe(true);
    expect(read.workbook.sheets[0]!.page).toMatchObject({ orientation: "landscape", printArea: ["A1:B1048576"], header: { left: "&F", center: "Centre && more&K0CCCCC", right: "&P" } });
  });
});
