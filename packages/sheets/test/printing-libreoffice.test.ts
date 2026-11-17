import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx, type PageSetup } from "../src";
import { SAMPLES } from "./excel-check/samples";

/**
 * LibreOffice prints. A file Pli writes, turned into a PDF there, must have the pages Pli says it has (so the print area,
 * titles, breaks, scale, paper and margins mean to LibreOffice what they mean to Pli), the header and footer on each page, and
 * what LibreOffice writes back must read as the same page setup. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const SWIFT = ["/usr/bin/swift"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-print-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const make = (rows: number, cols: number, page: PageSetup) => {
  const s = new SheetSession(createWorkbook("Print", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r + 1}c${c + 1}`)));
  s.setPageSetup("Sheet1", page);
  return s;
};

let n = 0;
/** The workbook as LibreOffice prints it: the PDF's path. */
const toPdf = (s: SheetSession): string => {
  const name = `f${n++}`;
  writeFileSync(join(dir, `${name}.xlsx`), toXlsx(s.state));
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "pdf", "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
  return join(dir, "out", `${name}.pdf`);
};
const pageCount = (pdf: string) => (readFileSync(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

const CASES: [string, number, number, PageSetup][] = [
  ["the defaults", 100, 12, {}],
  ["landscape", 100, 12, { orientation: "landscape" }],
  ["A4", 100, 12, { paper: "a4" }],
  ["legal", 100, 12, { paper: "legal" }],
  ["a scale of 50%", 100, 30, { scale: 50 }],
  ["a scale of 150%", 60, 10, { scale: 150 }],
  ["margins of half an inch", 100, 12, { margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } }],
  ["wide margins", 100, 12, { margins: { top: 2, bottom: 2, left: 2, right: 2 } }],
  ["fit to one page wide", 100, 12, { fit: { wide: 1, tall: 0 } }],
  ["fit to one page", 100, 12, { fit: { wide: 1, tall: 1 } }],
  ["fit to two by two", 200, 24, { fit: { wide: 2, tall: 2 } }],
  ["a print area", 100, 12, { printArea: ["B2:E20"] }],
  ["two print areas", 100, 12, { printArea: ["A1:B3", "D50:F60"] }],
  ["breaks you made", 100, 4, { rowBreaks: [10, 60], colBreaks: [2] }],
  ["rows and columns to repeat", 100, 12, { titleRows: [1, 2], titleCols: [1, 1] }],
  ["pages over then down", 100, 12, { order: "over" }],
];

describe.skipIf(!SOFFICE)("printing through LibreOffice", () => {
  for (const [what, rows, cols, page] of CASES) {
    it(`prints on as many pages as Pli says, with ${what}`, () => {
      const s = make(rows, cols, page);
      expect(pageCount(toPdf(s)), what).toBe(s.printLayout("Sheet1").pages.length);
    });
  }

  it("prints the Excel check's printing sample on as many pages as Pli says, every sheet of it", () => {
    const s = SAMPLES.find((x) => x.file === "12-printing.xlsx")!.build();
    const pli = s.state.sheets.reduce((n, sheet) => n + s.printLayout(sheet.id).pages.length, 0);
    expect(pli).toBeGreaterThan(5);
    expect(pageCount(toPdf(s))).toBe(pli);
  });

  it("keeps the page setup when LibreOffice writes the file back", () => {
    const page: PageSetup = { orientation: "landscape", paper: "a4", scale: 80, margins: { top: 1, left: 0.5 }, centerHorizontally: true, gridlines: true, headings: true, order: "over", printArea: ["A1:C10"], titleRows: [1, 2], rowBreaks: [5], header: { center: "&A" }, footer: { left: "&F", right: "Page &P of &N" } };
    const s = make(30, 6, page);
    const name = `back${n++}`;
    writeFileSync(join(dir, `${name}.xlsx`), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", `${name}.xlsx`)))).workbook.sheets[0]!.page!;
    expect(back).toMatchObject({ orientation: "landscape", paper: "a4", scale: 80, centerHorizontally: true, gridlines: true, headings: true, order: "over", printArea: ["A1:C10"], titleRows: [1, 2], rowBreaks: [5] });
    expect(back.margins).toMatchObject({ top: 1, left: 0.5 });
    expect(back.header?.center).toBe("&A");
    expect(back.footer?.right).toBe("Page &P of &N");
  });

  it.skipIf(!SWIFT)("prints the header and footer, page numbers and the rows each page holds as Pli lays them out", () => {
    const s = make(100, 3, { header: { center: "Sheet &A" }, footer: { right: "Page &P of &N" }, titleRows: [1, 1] });
    const pdf = toPdf(s);
    const pages = execFileSync(SWIFT!, [join(__dirname, "pdf-pages.swift"), pdf], { encoding: "utf8", timeout: 180_000 })
      .split("=====PAGE=====")
      .slice(1);
    const layout = s.printLayout("Sheet1");
    expect(pages).toHaveLength(layout.pages.length);
    layout.pages.forEach((p, i) => {
      expect(pages[i], `page ${i + 1}`).toContain("Sheet Sheet1");
      expect(pages[i], `page ${i + 1}`).toContain(`Page ${p.number} of ${layout.pages.length}`);
      expect(pages[i], `page ${i + 1}`).toContain(`r${p.range.r1}c1`);
      expect(pages[i], `page ${i + 1}`).toContain(`r${p.range.r2}c3`);
      expect(pages[i], `page ${i + 1}`).not.toContain(`r${p.range.r2 + 1}c1 `);
      expect(pages[i], `page ${i + 1}`).toContain("r1c1"); // the title row is on every page
    });
  });
});
