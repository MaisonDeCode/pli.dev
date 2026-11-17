import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, fromXlsx, toXlsx } from "../src";
import { written } from "./excel-check/report";
import { SAMPLES } from "./excel-check/samples";

/** What Excel did to kit files 22, 23, 32, 33 and 34 when it saved them (excel-check/back/), and what Pli writes because of it. */
const BACK = join(__dirname, "..", "..", "..", "excel-check", "back");
const back = (name: string) => (existsSync(join(BACK, name)) ? new Uint8Array(readFileSync(join(BACK, name))) : null);
const sample = (file: string) => SAMPLES.find((s) => s.file === file)!;

describe("filter views, as Excel keeps them (kit file 32)", () => {
  it("writes each view's sort over the whole filter range, header row included, as Excel rewrote it", () => {
    const part = strFromU8(unzipSync(written(sample("32-filter-views.xlsx")))["xl/namedSheetViews/namedSheetView1.xml"]!);
    expect(part).toContain('<sortCondition descending="1" ref="C1:C9"/>');
    expect(part).toContain('<sortCondition descending="1" ref="C12:C20"/>');
    expect(part).not.toContain('ref="C2:C9"');
  });

  const excel = back("32-filter-views.xlsx");
  it.skipIf(!excel)("reads Excel's own copy: all three views with their filters and sorts", () => {
    const { workbook, warnings } = fromXlsx(excel!);
    expect(warnings).toEqual([]);
    const team = workbook.sheets.find((s) => s.name === "Team")!;
    expect(team.filterViews?.map((v) => v.name).sort()).toEqual(["Blue or green", "Everything", "Reds, biggest first"]);
    const reds = team.filterViews!.find((v) => v.name === "Reds, biggest first")!;
    expect(reds.sort).toEqual({ column: "C", descending: true });
    expect(reds.columns).toBeDefined();
  });
});

describe("conditional formats, as Excel keeps them (kit files 22 and 33)", () => {
  it("marks the extension block of a rule on a pivot table pivot=1, as Excel does", () => {
    const files = unzipSync(written(sample("22-formatting-more.xlsx")));
    const sheets = Object.keys(files).filter((k) => /xl\/worksheets\/sheet\d+\.xml$/.test(k)).map((k) => strFromU8(files[k]!));
    expect(sheets.some((t) => /<x14:conditionalFormatting pivot="1" xmlns:xm=[^>]*><x14:cfRule type="dataBar"/.test(t))).toBe(true);
  });

  for (const file of ["22-formatting-more.xlsx", "33-formatting-rest.xlsx"]) {
    const excel = back(file);
    it.skipIf(!excel)(`${file}: Excel's copy keeps every rule`, () => {
      const mine = fromXlsx(written(sample(file))).workbook;
      const theirs = fromXlsx(excel!).workbook;
      // (Excel joins two rules that are the same on neighbouring columns into one over both, so plain cell rules may be fewer.)
      const rules = (wb: typeof mine) => wb.sheets.map((s) => (s.conditional ?? []).filter((r) => r.kind !== "cell").map((r) => r.kind).sort().join(","));
      const cells = (wb: typeof mine) => wb.sheets.map((s) => (s.conditional ?? []).filter((r) => r.kind === "cell").length);
      expect(rules(theirs)).toEqual(rules(mine));
      cells(mine).forEach((n, i) => expect(cells(theirs)[i]).toBeLessThanOrEqual(n));
      // an icon set of your own comes back as one rule, with its icons
      expect(theirs.sheets.flatMap((s) => s.conditional ?? []).filter((r) => r.kind === "iconSet" && r.custom)).toHaveLength(mine.sheets.flatMap((s) => s.conditional ?? []).filter((r) => r.kind === "iconSet" && r.custom).length);
    });
  }
});

describe("lists that read another workbook, as Excel keeps them (kit files 23 and 34)", () => {
  it("never writes a source Excel turns into #REF!: the file has the items kept, and Pli's extension the whole rule", () => {
    const files = unzipSync(written(sample("53-validation-external-forms.xlsx")));
    const sheet = strFromU8(files["xl/worksheets/sheet2.xml"]!);
    expect(sheet).not.toContain("x14:dataValidation");
    expect(sheet).not.toMatch(/Prices\.xlsx\][^<]*!\$A\$1:\$A\$3<\/xm:f>/);
    expect(sheet).toContain('<formula1>"Pens,Paper,Ink"</formula1>');
  });

  it("comes back as the rule that reads the other workbook, with the cells kept", () => {
    const { workbook, warnings } = fromXlsx(written(sample("53-validation-external-forms.xlsx")));
    expect(warnings).toEqual([]);
    const rules = workbook.sheets.find((s) => s.name === "Lists")!.validations!;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ kind: "list", source: "[Prices.xlsx]Sheet1!$A$1:$A$3", snapshot: { items: ["Pens", "Paper", "Ink"] } });
    expect(rules[1]).toMatchObject({ kind: "decimal", values: ["[Prices.xlsx]Sheet1!$B$1"] });
    expect(workbook.sheets.find((s) => s.name === "Lists")!.cells["B2"]?.control).toBeUndefined(); // not read as a dropdown cell
  });

  it("still reads the forms older Pli files and Excel's own copies have: [1], quoted, with a folder", () => {
    const s = new SheetSession(createWorkbook("t", ["Sheet1"]));
    s.setExternalCells("Prices.xlsx", "Sheet1", { B2: 2.5, A1: "Pens", A2: "Paper" });
    s.setCell("Sheet1", "A1", "=[Prices.xlsx]Sheet1!B2*2");
    const files = unzipSync(toXlsx(s.state));
    const name = "xl/worksheets/sheet1.xml";
    files[name] = new TextEncoder().encode(strFromU8(files[name]!).replace("<f>[1]Sheet1!B2*2</f>", "<f>'/Users/me/[Prices.xlsx]Sheet1'!B2*2</f>"));
    expect(fromXlsx(zipSync(files)).workbook.sheets[0]!.cells["A1"]?.f).toBe("[Prices.xlsx]Sheet1!B2*2");
  });

  const excel = back("23-validation-more.xlsx");
  it.skipIf(!excel)("opens Excel's own copy, where every source was turned into #REF!, without a crash", () => {
    const { workbook } = fromXlsx(excel!);
    expect(workbook.sheets.length).toBeGreaterThan(1);
  });
});
