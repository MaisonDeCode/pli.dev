import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { SheetSession, createWorkbook, fromXlsx, sniffImage, toXlsx } from "../src";
import { pngUri } from "./images-helpers";

/** LibreOffice reads the fill, line and picture of a note's box the way Pli writes them, and writes them back so Pli reads the same. Runs only where LibreOffice is installed. */
const SOFFICE = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"].find(existsSync);
const dir = SOFFICE ? mkdtempSync(join(tmpdir(), "pli-notes-look-")) : "";
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!SOFFICE)("note boxes with a fill, a line and a picture through LibreOffice", () => {
  it("keeps the colours, the line, the weight, the transparency and the picture", () => {
    const s = new SheetSession(createWorkbook("notes", ["Data"]));
    s.setValues("Data", "A1", [["a", "b", "c"]]);
    s.setNote("Data", "A1", "coloured", { box: { width: 200, height: 90, show: true } });
    s.setNoteLook("Data", "A1", { fill: "#99ccff", line: "#c00000", lineWeight: 2, transparency: 25 });
    s.setNote("Data", "B1", "with a picture", { box: { width: 200, height: 90, show: true } });
    s.setNoteLook("Data", "B1", { picture: pngUri(16, 12, [20, 140, 60]) });
    s.setNote("Data", "C1", "no line", { box: { show: true } });
    s.setNoteLook("Data", "C1", { line: "none", fill: "#ffe699" });

    writeFileSync(join(dir, "f.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", join(dir, "out"), join(dir, "f.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const back = fromXlsx(new Uint8Array(readFileSync(join(dir, "out", "f.xlsx")))).workbook.sheets[0]!.cells;
    expect(back["A1"]?.noteBox).toMatchObject({ fill: "#99ccff", line: "#c00000" });
    expect(back["A1"]?.noteBox?.lineWeight).toBeGreaterThan(1.5);
    expect(back["A1"]?.noteBox?.lineWeight).toBeLessThan(2.5);
    expect(back["C1"]?.noteBox).toMatchObject({ fill: "#ffe699" });
    expect(back["C1"]?.noteBox?.line).toBe("none");
  });

  it("reads a picture that fills a note's box (LibreOffice keeps it as a stretched bitmap fill, with the same picture)", () => {
    const s = new SheetSession(createWorkbook("notes", ["Data"]));
    s.setValues("Data", "A1", [["a", "b"]]);
    s.setNote("Data", "B1", "with a picture", { box: { width: 200, height: 90, show: true } });
    s.setNoteLook("Data", "B1", { picture: pngUri(16, 12, [20, 140, 60]) });
    writeFileSync(join(dir, "p.xlsx"), toXlsx(s.state));
    execFileSync(SOFFICE!, [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", "ods", "--outdir", join(dir, "ods"), join(dir, "p.xlsx")], { stdio: "ignore", timeout: 120_000 });
    const files = unzipSync(new Uint8Array(readFileSync(join(dir, "ods", "p.ods"))));
    const pictures = Object.keys(files).filter((n) => n.startsWith("Pictures/") && !n.endsWith("/"));
    expect(pictures).toHaveLength(1);
    expect(sniffImage(files[pictures[0]!]!)).toMatchObject({ type: "png", width: 16, height: 12 });
    expect(strFromU8(files["content.xml"]!)).toContain('draw:fill="bitmap"');
  });
});
