import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";

const sheetXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!);

describe("a function named on its own, as an argument", () => {
  const make = (formula: string) => {
    const s = new SheetSession(createWorkbook("F", ["Sheet1"]), { now: () => 45_000.5 });
    s.setValues("Sheet1", "A1", [["a", 1], ["b", 2], ["a", 3], ["b", 4]]);
    s.setValues("Sheet1", "D1", [[formula]]);
    return s;
  };

  it("is written the way Excel writes it, `_xleta.SUM`", () => {
    const xml = sheetXml(toXlsx(make("=GROUPBY(A1:A4,B1:B4,SUM)").state));
    expect(xml).toContain("_xlfn.GROUPBY(A1:A4,B1:B4,_xleta.SUM)");
  });

  it("keeps the dot of a name like STDEV.S and does not prefix it a second time", () => {
    const xml = sheetXml(toXlsx(make("=GROUPBY(A1:A4,B1:B4,STDEV.S)").state));
    expect(xml).toContain("_xleta.STDEV.S)");
    expect(xml).not.toContain("_xleta._xlfn");
  });

  it("is written the same for a function newer than the rest, and for BYROW", () => {
    expect(sheetXml(toXlsx(make("=GROUPBY(A1:A4,B1:B4,PERCENTOF)").state))).toContain("_xleta.PERCENTOF");
    expect(sheetXml(toXlsx(make("=BYROW(B1:B4,SUM)").state))).toContain("_xlfn.BYROW(B1:B4,_xleta.SUM)");
  });

  it("reads back as the plain name", () => {
    const back = fromXlsx(toXlsx(make("=GROUPBY(A1:A4,B1:B4,SUM)").state));
    const text = JSON.stringify(back.workbook.sheets[0]!.cells);
    expect(text).toMatch(/GROUPBY\(A1:A4,\s*B1:B4,\s*SUM\)/);
    expect(text).not.toContain("_xleta");
  });
});
