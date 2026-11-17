import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, headerPictureFrom, toXlsx, type PageSetup } from "../src";
import { pngUri } from "./images-helpers";

/**
 * LibreOffice reads and writes what Pli writes for the rest of printing: notes printed after the sheet or as displayed, how
 * errors print, black and white, draft quality and the pictures in a header. Runs only where LibreOffice is installed.
 */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-print2-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const make = (page: PageSetup) => {
  const s = new SheetSession(createWorkbook("Print", ["Sheet1"]), { now: () => 45_000.5 });
  s.setValues("Sheet1", "A1", Array.from({ length: 30 }, (_, r) => [`r${r + 1}c1`, r, r === 2 ? "=1/0" : r]));
  s.setNote("Sheet1", "A2", "First note");
  s.setNote("Sheet1", "B5", "Second note");
  s.setPageSetup("Sheet1", page);
  return s;
};

let n = 0;
const run = (s: SheetSession, target: string) => {
  const name = `f${n++}`;
  writeFileSync(join(dir, `${name}.xlsx`), toXlsx(s.state));
  execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", target, "--outdir", join(dir, "out"), join(dir, `${name}.xlsx`)], { stdio: "ignore", timeout: 120_000 });
  return join(dir, "out", `${name}.${target.split(":")[0]}`);
};
const pageCount = (pdf: string) => (readFileSync(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const roundTrip = (s: SheetSession) => fromXlsx(new Uint8Array(readFileSync(run(s, "xlsx:Calc MS Excel 2007 XML")))).workbook.sheets[0]!.page!;

describe.skipIf(!SOFFICE)("the rest of printing through LibreOffice", () => {
  // LibreOffice does not read cellComments, errors, draft or blackAndWhite from a file (it writes its own defaults back), so what
  // can be checked is that a file carrying them opens, prints the pages of cells Pli says it does, and keeps the rest of its setup.
  it("opens files with cellComments, errors, draft and blackAndWhite, and prints the cells' pages as Pli lays them out", () => {
    for (const page of [{ comments: "end" }, { comments: "sheet" }, { errors: "dash" }, { errors: "na" }, { errors: "blank" }, { draft: true }, { blackAndWhite: true }] as PageSetup[]) {
      const s = make({ ...page, orientation: "landscape", header: { center: "Kept" } });
      const cellPages = s.printLayout("Sheet1").pages.filter((p) => !p.notes).length;
      // With notes "as displayed" LibreOffice lays its note boxes out over the sheet, which can take it another page.
      const pages = pageCount(run(s, "pdf"));
      if (page.comments === "sheet") expect(pages).toBeGreaterThanOrEqual(cellPages);
      else expect(pages, JSON.stringify(page)).toBe(cellPages);
      const back = roundTrip(s);
      expect(back.orientation).toBe("landscape");
      expect(back.header?.center).toBe("Kept");
    }
  });

  it("opens a file with a picture in its header and keeps the header's text", () => {
    const s = make({ header: { center: "Quarterly" } });
    s.setHeaderFooterPicture("Sheet1", "header", "left", headerPictureFrom(pngUri(40, 20)));
    expect(pageCount(run(s, "pdf"))).toBe(s.printLayout("Sheet1").pages.length);
    expect(roundTrip(s).header?.center).toBe("Quarterly");
  });
});
