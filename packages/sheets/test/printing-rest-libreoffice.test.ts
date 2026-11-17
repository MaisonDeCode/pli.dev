import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, headerPictureFrom, printToPdf, toXlsx } from "../src";
import { pngUri } from "./images-helpers";

/**
 * LibreOffice as a second reader of the rest of printing: a sheet with both notes and pictures in its header (two legacy
 * drawings that must not share shape numbers), and the PDF Pli writes itself, which LibreOffice can open and count the pages of.
 * Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-print3-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

let n = 0;
const convert = (bytes: Uint8Array, ext: "xlsx" | "pdf", target: string) => {
  const name = `f${n++}`;
  writeFileSync(join(dir, `${name}.${ext}`), bytes);
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", target, "--outdir", join(dir, "out"), join(dir, `${name}.${ext}`)], { stdio: "ignore", timeout: 120_000 });
  return join(dir, "out", `${name}.${target.split(":")[0]}`);
};
const SWIFT = ["/usr/bin/swift"].find(existsSync);
const pageCount = (pdf: string) => (readFileSync(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe.skipIf(!SOFFICE)("the rest of printing through LibreOffice", () => {
  // LibreOffice does not write pictures in headers back (it reads them, and drops them on saving), so what is checked is that a
  // sheet with both drawings opens in it, keeps its note and its page count, and prints the same pages of cells.
  it("opens a sheet that has pictures in its header and notes too (two drawings with shape numbers of their own)", () => {
    const s = new SheetSession(createWorkbook("Logos", ["Sheet1"]), { now: () => 45_000.5 });
    s.setValues("Sheet1", "A1", Array.from({ length: 5 }, (_, r) => [`r${r}`, r]));
    s.setNote("Sheet1", "B2", "A note", { box: { show: true } });
    s.setHeaderFooterPicture("Sheet1", "header", "left", headerPictureFrom(pngUri(40, 20, [30, 150, 60]), { width: 80, height: 40 }));
    s.setHeaderFooterPicture("Sheet1", "footer", "right", headerPictureFrom(pngUri(40, 20, [30, 60, 150]), { width: 60, height: 30 }));
    const bytes = toXlsx(s.state);
    const back = fromXlsx(new Uint8Array(readFileSync(convert(bytes, "xlsx", "xlsx:Calc MS Excel 2007 XML")))).workbook.sheets[0]!;
    expect(back.cells["B2"]?.note).toBe("A note");
    expect(back.cells["B2"]?.noteBox?.show).toBe(true);
    expect(pageCount(convert(bytes, "xlsx", "pdf"))).toBe(s.printLayout("Sheet1").pages.length);
  });

  it("opens the PDF Pli writes, with as many pages as the printout has", async () => {
    const s = new SheetSession(createWorkbook("Budget", ["Sheet1"]), { now: () => 45_000.5 });
    s.setValues("Sheet1", "A1", Array.from({ length: 150 }, (_, r) => [`row ${r + 1}`, r, "=B1*2"]));
    s.setPageSetup("Sheet1", { header: { center: "&A" }, footer: { right: "Page &P of &N" }, gridlines: true });
    const { bytes, pages } = await printToPdf(s, "Sheet1", { date: new Date(0) });
    expect(pages).toBe(s.printLayout("Sheet1").pages.length);
    // LibreOffice's PDF import (Draw) opens it and finds the same pages.
    const out = convert(bytes, "pdf", "pdf:writer_pdf_Export");
    expect(pageCount(out)).toBe(pages);
  });

  // PDFKit (Apple's own PDF reader) is a reader that has nothing to do with Pli: the text it finds on each page is what Pli drew there.
  it.skipIf(!SWIFT)("is read by PDFKit page by page, with the header, footer, row ranges and numbers each page holds", async () => {
    const s = new SheetSession(createWorkbook("Budget", ["Sheet1"]), { now: () => 45_000.5 });
    s.setValues("Sheet1", "A1", Array.from({ length: 150 }, (_, r) => [`row ${r + 1}`, r + 1, "=B1*2"]));
    s.setFormat("Sheet1", "C1:C150", "#,##0.00");
    s.setPageSetup("Sheet1", { header: { center: "Report &A" }, footer: { right: "Page &P of &N" }, titleRows: [1, 1] });
    const { bytes } = await printToPdf(s, "Sheet1", { date: new Date(0) });
    const file = join(dir, "own.pdf");
    writeFileSync(file, bytes);
    const layout = s.printLayout("Sheet1");
    const pages = execFileSync(SWIFT!, [join(__dirname, "pdf-pages.swift"), file], { encoding: "utf8", timeout: 180_000 })
      .split("=====PAGE=====")
      .slice(1);
    expect(pages).toHaveLength(layout.pages.length);
    layout.pages.forEach((page, i) => {
      expect(pages[i], `page ${i + 1}`).toContain("Report Sheet1");
      expect(pages[i]).toContain(`Page ${i + 1} of ${layout.pages.length}`);
      expect(pages[i]).toContain(`row ${page.range.r1}`);
      expect(pages[i]).toContain(`row ${page.range.r2}`);
      // The repeated first row is on every page.
      expect(pages[i]).toContain("row 1");
    });
    expect(pages[0]).toContain("2.00");
  });
});
